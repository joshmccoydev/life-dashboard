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

const HOME_TITLES = [
  "Bots",
  "Health",
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

function renderDashboard(
  data: DashboardData,
  page: "home" | "money" = "home",
): string {
  return renderToString(
    Dashboard({
      initial: data,
      renderedAt: NOW,
      display,
      demo: false,
      forcedMode: "day",
      paused: true,
      page,
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
  assert.doesNotMatch(text, /\bChicago\b/, "banned weather city must not appear");

  assert.match(html, /aria-label="LifeDash navigation"/);
  assert.match(html, /<a class="dashboard-tab" href="\/" aria-current="page">Home<\/a>/);
  assert.match(html, /<a class="dashboard-tab" href="\/decisions">Decisions<\/a>/);
  assert.match(html, /<a class="dashboard-tab" href="https:\/\/agents\.j0sh\.wtf\/">Agents<\/a>/);

  for (const title of HOME_TITLES) {
    assert.match(
      panel(html, title).openingTag,
      /(?:class="[^"]*(?:dashboard-)?card[^"]*"|data-card(?:="true")?|role="(?:region|group)")/i,
      `${title} should be presented as a card`,
    );
  }
  assert.match(html, />Money</, "Money tab is present");
  assert.ok(!html.includes('id="money-title"'), "Money panel is not on Home");
});

test("Apple lists render with explicit reminder groups and names-only habits and goals", () => {
  const data = fixture();
  data.reminders = feed({ items: [
    { id: "overdue", title: "Overdue reminder", due: "2026-10-31", listName: "Personal" },
    { id: "due", title: "Due reminder", due: "2026-11-02", listName: "Tasks" },
    { id: "no-date", title: "Undated reminder", due: null, listName: "Tasks" },
  ] }) as unknown as DashboardData["reminders"];
  data.habits = feed({ habits: [
    { id: "habit", title: "Habit title", trackingMethod: "custom", occurrences: [] },
  ] }) as unknown as DashboardData["habits"];
  data.goals = feed({ goals: [
    { title: "Goal title", current: 3, target: 9, due: "2026-12-01", detail: "excluded" },
  ], projects: [] }) as unknown as DashboardData["goals"];
  const html = renderDashboard(data);
  const reminders = panel(html, "Reminders");
  const habits = panel(html, "Habits");
  const goals = panel(html, "Goals");

  for (const group of ["Overdue", "Due", "No date"]) assert.match(reminders.text, new RegExp(group));
  assert.match(reminders.text, /Overdue reminder[\s\S]*Due reminder[\s\S]*Undated reminder/);
  assert.doesNotMatch(reminders.text, /\b(?:Open|Complete)\b/);
  assert.match(habits.text, /Habit title/);
  assert.doesNotMatch(habits.text, /\b(?:complete|missed|streak|\d+\/\d+)\b/i);
  assert.match(goals.text, /Goal title/);
  assert.doesNotMatch(goals.text, /3\/9|2026|excluded|ACTIVE/);
});

test("Bots, Money, and Health follow the v2 Home / Money split", () => {
  const data = fixture();
  data.finance = feed({
    cashOnHand: 2450,
    billsDueTotal: 80,
    billsDueCount: 1,
    depositTarget: null,
    status: "ok",
    bills: [{ name: "Internet", due: "2026-11-05", amount: 80 }],
  }) as unknown as DashboardData["finance"];

  const home = renderDashboard(data);
  const moneyPage = renderDashboard(data, "money");
  const bots = panel(home, "Bots");
  const health = panel(home, "Health");
  const money = panel(moneyPage, "Money");

  assert.match(bots.html, /aria-label="Needs Josh"/);
  assert.match(bots.html, /dashboard-bots-grid/);
  assert.doesNotMatch(bots.text, /Waiting on Josh/);
  assert.doesNotMatch(bots.text, /Last action:/);

  assert.match(money.text, /Cash on hand/);
  assert.match(money.text, /2,450/);
  assert.match(money.text, /Bills due/);
  assert.match(money.text, /Internet/);
  assert.ok(!home.includes('id="money-title"'));
  assert.match(home, /href="\/money"/);

  assert.match(health.text, /\bToday\b/);
  assert.match(health.text, /\b(?:This\s+)?week\b/i);
  assert.match(health.text, /\bStreak\b/i);
});

test("Home leads with Bots, Health, and Systems; Money is its own page", () => {
  const html = renderDashboard(fixture());
  for (const title of HOME_TITLES) {
    panel(html, title);
  }
  assert.ok(!html.includes('id="money-title"'), "Money is not a Home panel");
  assert.match(html, /href="\/money"/);
  assert.match(panel(html, "Systems").text, /Mac mini/);
  assert.ok(!html.includes('id="schedule-title"'));
  assert.ok(html.includes('id="reminders-title"'));
  assert.ok(html.includes('id="habits-title"'));
  assert.ok(html.includes('id="goals-title"'));
  assert.ok(!html.includes('id="github-title"'));
});

test("every Home panel shows an updated time and stale or empty states stay explicit", () => {
  const data = fixture();
  const freshHtml = renderDashboard(data);
  const applePanels = [...HOME_TITLES, "Reminders", "Habits", "Goals"];
  for (const title of applePanels) {
    assert.match(
      panel(freshHtml, title).text,
      /\bUpdated\b[\s\S]{0,24}(?:just now|today|\d{1,2}:\d{2}|\d+\s*(?:s|m|h|d))/i,
      `${title} needs its updated time`,
    );
  }

  const stale = structuredClone(data);
  for (const state of Object.values(stale)) {
    if (!state || typeof state !== "object" || !("status" in state)) continue;
    (state as { status: string; lastSuccess: string }).status = "stale";
    (state as { status: string; lastSuccess: string }).lastSuccess = STALE_SINCE;
  }
  const staleHtml = renderDashboard(stale);
  for (const title of applePanels) {
    assert.match(panel(staleHtml, title).text, /\bstale\b/i);
  }

  const empty = structuredClone(data);
  for (const state of Object.values(empty)) {
    if (!state || typeof state !== "object" || !("status" in state)) continue;
    (state as { data: unknown; status: string; lastSuccess: string | null }).data = null;
    (state as { status: string }).status = "error";
    (state as { lastSuccess: string | null }).lastSuccess = null;
  }
  const emptyHtml = renderDashboard(empty);
  for (const title of HOME_TITLES) {
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
