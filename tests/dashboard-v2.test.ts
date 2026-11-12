import test from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { Dashboard } from "../src/components/dashboard";
import type {
  AITelemetryState,
  DashboardData,
  DataState,
  DisplayConfig,
  HealthState,
} from "../src/domains/models";

const NOW = "2026-11-01T16:30:00.000Z";
const UPDATED = "2026-11-01T16:25:00.000Z";
const STALE_SINCE = "2026-11-01T16:00:00.000Z";

const display: DisplayConfig = {
  timezone: "America/Chicago",
  locale: "en-US",
  currency: "USD",
  rotationSeconds: 25,
  pixelShift: false,
  modes: { morning: 6, day: 9, evening: 17, night: 22 },
};

const PANEL_TITLES = [
  "Bots",
  "Money",
  "Health",
  "Schedule",
  "Reminders",
  "GitHub",
  "Goals",
  "Projects",
  "Systems",
] as const;

function feed<T>(
  data: T | null,
  overrides: Partial<DataState<T>> = {},
): DataState<T> {
  return {
    loading: false,
    data,
    source: "real",
    provider: "Synthetic dashboard feed",
    status: data === null ? "error" : "ready",
    lastSuccess: data === null ? null : UPDATED,
    lastAttempt: UPDATED,
    error: data === null ? "Synthetic feed unavailable" : null,
    refreshMs: 30 * 60_000,
    ...overrides,
  };
}

function fixture(): DashboardData {
  const bots = {
    providers: [
      {
        name: "Builder",
        status: "running",
        detail: "Last action: tests passed",
        remainingPercent: 80,
        value: "RUNNING",
        requestsToday: 4,
        tokensToday: 1200,
        costToday: 0.12,
        jobsCompleted: 2,
        errors: 0,
      },
      {
        name: "Planner",
        status: "waiting",
        detail: "Waiting on Josh to approve the dashboard copy",
        remainingPercent: 60,
        value: "WAITING",
        requestsToday: 2,
        tokensToday: 800,
        costToday: 0.08,
        jobsCompleted: 1,
        errors: 0,
      },
    ],
  } as unknown as AITelemetryState;

  const health = {
    date: "2026-11-01",
    steps: 8421,
    stepGoal: 10000,
    sleepMinutes: 452,
    activityPercent: 73,
    exerciseMinutes: 38,
    exerciseGoal: 30,
    standHours: 10,
    standGoal: 12,
    workout: "Outdoor run",
    week: { steps: 52311, goal: 70000, activeDays: 6 },
    streak: { days: 7, label: "Movement streak" },
  } as unknown as HealthState;

  return {
    weather: feed({
      temperature: 61,
      feelsLike: 59,
      condition: "Partly cloudy",
      code: 2,
      unit: "F",
      high: 66,
      low: 48,
      location: "Chicago",
      isDay: true,
    }),
    calendar: feed({
      events: [
        {
          id: "standup",
          title: "Team stand-up",
          start: "2026-11-01T18:00:00.000Z",
          end: "2026-11-01T18:30:00.000Z",
          calendar: "work",
          calendarName: "Work",
        },
      ],
    }),
    reminders: feed({
      items: [
        {
          id: "passport",
          title: "Renew passport",
          due: "2026-11-02T18:00:00.000Z",
          completed: false,
          listName: "Reminders",
        },
      ],
    }),
    finance: feed(
      {
        checking: 2450,
        savings: 0,
        emergencyFund: 1000,
        emergencyTarget: 5000,
        payday: "2026-11-06T15:00:00.000Z",
        spending: 1500,
        spendingBudget: 1200,
        investments: 4567,
        investmentChange: 12,
        bills: [
          {
            title: "Internet",
            amount: 89,
            due: "2026-11-03T15:00:00.000Z",
          },
        ],
      },
      { status: "stale", lastSuccess: STALE_SINCE },
    ),
    health: feed(health),
    build: feed({
      username: "synthetic-dev",
      commitsToday: 12,
      activeRepos: 3,
      openPRs: 1,
      lastActivity: "2026-11-01T16:20:00.000Z",
      repositories: [{ name: "life-dash", commits: 12 }],
    }),
    ai: feed(bots, { status: "stale", lastSuccess: STALE_SINCE }),
    systems: feed({
      machine: {
        id: "mac-mini",
        name: "Mac mini",
        status: "online",
        latencyMs: 12,
        uptimeSeconds: 86400,
        cpuPercent: 21,
        memoryPercent: 42,
        diskPercent: 51,
      },
      endpoints: [],
    }),
    habits: feed({
      date: "2026-11-01",
      habits: [
        {
          id: "stretch",
          title: "Stretch",
          trackingMethod: "custom",
          occurrences: [
            {
              date: "2026-11-01",
              completed: true,
              completedAt: UPDATED,
            },
          ],
        },
      ],
    }),
    goals: feed({
      goals: [
        {
          id: "dashboard",
          title: "Ship dashboard",
          current: 7,
          target: 10,
          unit: "slices",
        },
      ],
      projects: [
        {
          id: "mobile",
          name: "Mobile rollout",
          detail: "Finish the card layout",
          progress: 65,
        },
      ],
    }),
  };
}

function renderDashboard(data: DashboardData): string {
  return renderToString(
    Dashboard({
      initial: data,
      renderedAt: NOW,
      display,
      demo: false,
      forcedMode: "day",
      paused: true,
      useData: () => ({
        data,
        systemHistory: [],
        connectionError: false,
        receivedAt: Date.parse(NOW),
        transport: "poll",
      }),
    }),
  );
}

/** Keep assertions focused on rendered copy instead of markup attributes. */
function visibleText(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

type Panel = {
  openingTag: string;
  html: string;
  text: string;
};

/**
 * Slice 7 panels are card sections. Resolve each panel from its exact heading
 * so state assertions cannot be satisfied by a header or a different feed.
 */
function panel(html: string, title: string): Panel {
  const headings = Array.from(
    html.matchAll(/<(h[1-4])\b[^>]*>([\s\S]*?)<\/\1>/gi),
  );
  const heading = headings.find(
    (candidate) => visibleText(candidate[2]).trim() === title,
  );
  assert.ok(heading?.index !== undefined, `${title} panel heading is missing`);

  const openingTags = Array.from(
    html.slice(0, heading.index).matchAll(/<(section|article|div)\b[^>]*>/gi),
  ).filter(([tag]) =>
    /(?:class="[^"]*(?:dashboard-)?card[^"]*"|data-card(?:="true")?|role="(?:region|group)")/i.test(
      tag,
    ),
  );
  const opening = openingTags.at(-1);
  assert.ok(opening?.index !== undefined, `${title} is not a card panel`);

  const start = opening.index;
  const close = html.indexOf(`</${opening[1]}>`, heading.index);
  assert.ok(close >= 0, `${title} card is not closed`);
  const markup = html.slice(start, close + opening[1].length + 3);
  return {
    openingTag: opening[0],
    html: markup,
    text: visibleText(markup),
  };
}

test("dashboard uses a mobile-first card shell with a sticky clock and weather bar", () => {
  const html = renderDashboard(fixture());
  const text = visibleText(html);
  const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "";
  const mobileLayout =
    html.match(
      /<[^>]*(?:data-layout|data-mobile-layout)="single-column"[^>]*>/,
    )?.[0] ?? "";

  assert.ok(mobileLayout, "the dashboard needs a single-column layout marker");
  assert.match(
    mobileLayout,
    /(?:data-breakpoint|data-mobile-breakpoint)="640"/,
  );
  assert.match(
    header,
    /(?:class="[^"]*(?:sticky|topbar|top-bar)|style="[^"]*position:\s*sticky|data-sticky="true")/,
    "clock and weather belong in the sticky top bar",
  );
  assert.match(text, /\b10:30\b/);
  assert.match(text, /\b61\b/);
  assert.match(text, /\bChicago\b/);

  assert.match(html, /role="tablist"/);
  const homeTab =
    html.match(
      /<(?:a|button)\b[^>]*role="tab"[^>]*>[\s\S]*?Home[\s\S]*?<\/(?:a|button)>/,
    )?.[0] ?? "";
  const decisionsTab =
    html.match(
      /<(?:a|button)\b[^>]*role="tab"[^>]*>[\s\S]*?Decisions[\s\S]*?<\/(?:a|button)>/,
    )?.[0] ?? "";
  assert.match(homeTab, /aria-(?:selected="true"|current="page")/);
  assert.ok(decisionsTab, "the Decisions tab must be rendered");

  for (const title of PANEL_TITLES) {
    assert.match(
      panel(html, title).openingTag,
      /(?:class="[^"]*(?:dashboard-)?card[^"]*"|data-card(?:="true")?|role="(?:region|group)")/i,
      `${title} should be presented as a card`,
    );
  }
});

test("Bots, Money, and Health expose the Slice 7 summaries", () => {
  const html = renderDashboard(fixture());
  const bots = panel(html, "Bots");
  const money = panel(html, "Money");
  const health = panel(html, "Health");

  const waiting = bots.text.indexOf("Waiting on Josh");
  const lastAction = bots.text.indexOf("Last action: tests passed");
  assert.ok(waiting >= 0, "the waiting bot needs visible context");
  assert.ok(lastAction >= 0, "the last bot action must be visible");
  assert.ok(waiting < lastAction, "bots waiting on Josh sort first");
  const waitingTags = Array.from(
    bots.html
      .slice(0, bots.html.indexOf("Waiting on Josh"))
      .matchAll(/<[a-z][^>]*>/gi),
  )
    .slice(-6)
    .map(([tag]) => tag)
    .join(" ");
  assert.match(
    waitingTags,
    /(?:data-waiting="true"|class="[^"]*(?:waiting|highlight|attention)[^"]*")/,
    "the waiting-on-Josh row must be highlighted",
  );

  assert.match(money.text, /\bCash\b/);
  assert.match(money.text, /2,450/);
  assert.match(money.text, /\bNext bills?\b/i);
  assert.match(money.text, /\bInternet\b/);
  assert.match(money.text, /\bGoal\b/);
  assert.match(money.text, /\b20%/);
  assert.match(money.text, /\bAlerts?\b/i);
  assert.match(money.text, /over budget/i);

  assert.match(health.text, /\bToday\b/);
  assert.match(health.text, /\b(?:This\s+)?week\b/i);
  assert.match(health.text, /\bStreak\b/i);
});

test("Home preserves the existing schedule, reminders, GitHub, goal, project, and systems panels", () => {
  const html = renderDashboard(fixture());

  for (const title of PANEL_TITLES) {
    panel(html, title);
  }
  assert.match(panel(html, "Schedule").text, /Team stand-up/);
  assert.match(panel(html, "Reminders").text, /Renew passport/);
  assert.match(panel(html, "GitHub").text, /\b12\b[\s\S]*commits?/i);
  assert.match(panel(html, "Goals").text, /Ship dashboard/);
  assert.match(panel(html, "Projects").text, /Mobile rollout/);
  assert.match(panel(html, "Systems").text, /Mac mini/);
});

test("every panel shows an updated time and stale or empty states stay explicit", () => {
  const data = fixture();
  const freshHtml = renderDashboard(data);
  for (const title of PANEL_TITLES) {
    assert.match(
      panel(freshHtml, title).text,
      /\bUpdated\b[\s\S]{0,24}(?:just now|today|\d{1,2}:\d{2}|\d+\s*(?:s|m|h|d))/i,
      `${title} needs its updated time`,
    );
  }

  const stale = structuredClone(data);
  for (const state of Object.values(stale)) {
    state.status = "stale";
    state.lastSuccess = STALE_SINCE;
  }
  const staleHtml = renderDashboard(stale);
  for (const title of PANEL_TITLES) {
    assert.match(panel(staleHtml, title).text, /\bstale\b/i);
  }

  const empty = structuredClone(data);
  for (const state of Object.values(empty)) {
    state.data = null;
    state.status = "error";
    state.lastSuccess = null;
  }
  const emptyHtml = renderDashboard(empty);
  for (const title of PANEL_TITLES) {
    assert.doesNotMatch(
      emptyHtml,
      new RegExp(`>(?:${title})<`),
      `${title} should be hidden when it has no real data`,
    );
  }
});

test("Decisions home list shows real cards and the inbox stays linked", () => {
  const html = renderDashboard(fixture());
  const text = visibleText(html);

  assert.match(html, /href="\/decisions"/);
  assert.doesNotMatch(text, /decisions coming from feat\/decisions/i);
  // Fixture has no decisions payload: the home slot is hidden, the tab remains.
  assert.doesNotMatch(html, /id="decisions-title"/);

  const withDecisions = structuredClone(fixture());
  withDecisions.decisions = feed({
    count: 3,
    generatedAt: UPDATED,
    cards: [
      {
        id: "d_one",
        bot: "Forge",
        question: "Merge the life-dashboard real-data PR?",
        blocking: true,
      },
      {
        id: "d_two",
        bot: "Coach",
        question: "Pick an eye exam time",
        blocking: false,
      },
    ],
  });
  const decisionsHtml = renderDashboard(withDecisions);
  const decisions = panel(decisionsHtml, "Decisions");
  assert.match(decisions.text, /3 open items/);
  assert.match(decisions.text, /Forge/);
  assert.match(decisions.text, /Merge the life-dashboard real-data PR/);
  assert.match(decisions.text, /Coach/);
  assert.match(decisions.text, /Pick an eye exam time/);
  assert.match(decisions.html, /href="\/decisions"/);
  assert.match(decisions.text, /as of/i);
});
