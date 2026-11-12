import test from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import {
  botsToAiState,
  hostToSystemState,
} from "../src/lib/feed-adapters";
import { evaluateAlerts } from "../src/lib/alerts";
import { mergeFeeds } from "../src/lib/feed-store";
import { isStale } from "../src/lib/time";
import { GET } from "../src/app/api/dashboard/route";
import { Dashboard } from "../src/components/dashboard";
import type {
  AITelemetryState,
  DashboardData,
  DataState,
  DisplayConfig,
  SystemState,
} from "../src/domains/models";

const FIXED_NOW_ISO = "2026-11-01T16:30:00.000Z";
const RECENT_ISO = "2026-11-01T16:25:00.000Z";
const FIXED_NOW = new Date(FIXED_NOW_ISO);
const HOUR_MS = 60 * 60 * 1000;

const display: DisplayConfig = {
  timezone: "America/Chicago",
  locale: "en-US",
  currency: "USD",
  rotationSeconds: 25,
  pixelShift: false,
  modes: { morning: 6, day: 9, evening: 17, night: 22 },
};

const PRODUCER_SNAPSHOT = {
  bots: {
    data: {
      bots: [
        {
          bot: "Synthetic alpha",
          last_done: null,
          needs_josh: "review fixture",
          next_up: "queued fixture",
          updated: RECENT_ISO,
          working_on: null,
        },
        {
          bot: "Synthetic beta",
          last_done: "completed fixture",
          needs_josh: null,
          next_up: null,
          updated: RECENT_ISO,
          working_on: "building fixture",
        },
      ],
    },
    updatedAt: RECENT_ISO,
    stale: false,
    source: "box",
  },
  money: {
    data: {
      cashOnHand: 1234,
      billsDueTotal: 321,
      billsDueCount: 2,
      depositTarget: 5000,
      status: "ok",
    },
    updatedAt: RECENT_ISO,
    stale: false,
    source: "box",
  },
  health: {
    data: {
      trainingDoneToday: "y",
      streak: 3,
      nextSession: "synthetic mobility",
    },
    updatedAt: RECENT_ISO,
    stale: false,
    source: "box",
  },
  host: {
    data: {
      uptimeSeconds: 86400,
      loadavg: [0.25, 0.5, 0.75],
      disk: { usedPct: 41 },
      crons: 3,
    },
    updatedAt: RECENT_ISO,
    stale: false,
    source: "box",
  },
  apple: {
    data: null,
    updatedAt: null,
    stale: false,
    source: null,
  },
} as const;

type RouteDependencies = {
  env?: {
    FEEDS_KV?: {
      get(key: string): Promise<string | null>;
    };
  };
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

type DashboardPayload = {
  data: DashboardData;
  serverTime: string;
};

const invokeRoute = GET as unknown as (
  request: Request,
  dependencies: RouteDependencies,
) => Promise<Response>;

const unavailableFetch = (async () =>
  Response.json(
    { error: "synthetic unavailable" },
    { status: 503 },
  )) as typeof fetch;

async function requestDashboard(): Promise<{
  response: Response;
  payload: DashboardPayload;
}> {
  const response = await invokeRoute(
    new Request("https://dashboard.test/api/dashboard"),
    {
      env: {
        FEEDS_KV: {
          get: async () => JSON.stringify(PRODUCER_SNAPSHOT),
        },
      },
      fetchImpl: unavailableFetch,
      now: () => new Date(FIXED_NOW_ISO),
    },
  );
  return {
    response,
    payload: (await response.json()) as DashboardPayload,
  };
}

function snapshotUpdatedAt(updatedAt: string | null) {
  const copyEntry = <T extends { data: unknown }>(entry: T) => ({
    ...entry,
    updatedAt: entry.data === null ? null : updatedAt,
  });

  return {
    bots: copyEntry(PRODUCER_SNAPSHOT.bots),
    money: copyEntry(PRODUCER_SNAPSHOT.money),
    health: copyEntry(PRODUCER_SNAPSHOT.health),
    host: copyEntry(PRODUCER_SNAPSHOT.host),
    apple: copyEntry(PRODUCER_SNAPSHOT.apple),
  };
}

function alertData(systemsData: unknown): DashboardData {
  const state = <K extends Exclude<keyof DashboardData, "decisions" | "usage">>(
    data: NonNullable<DashboardData[K]["data"]> | null,
  ): DataState<NonNullable<DashboardData[K]["data"]>> => ({
    loading: false,
    data,
    source: "real",
    provider: "Synthetic fixture",
    status: "ready",
    lastSuccess: RECENT_ISO,
    lastAttempt: RECENT_ISO,
    error: null,
    refreshMs: HOUR_MS,
  });

  return {
    weather: state<"weather">(null),
    calendar: state<"calendar">({ events: [] }),
    reminders: state<"reminders">({ items: [] }),
    finance: state<"finance">(null),
    health: state<"health">(null),
    build: state<"build">(null),
    ai: state<"ai">(null),
    systems: state<"systems">(systemsData as SystemState | null),
    habits: state<"habits">(null),
    goals: state<"goals">(null),
  };
}

function panelHtml(html: string, id: string): string {
  const marker = `dashboard-card-${id}`;
  const elementMatch = new RegExp(
    `class="[^"]*\\bdashboard-card-${id}\\b[^"]*"`,
  ).exec(html);
  assert.ok(elementMatch, `${id} panel should be rendered`);
  const start = elementMatch.index;

  const mainEnd = html.indexOf("</main>", start);
  const nextPanel = html.indexOf('<section class="dashboard-card', start + marker.length);
  const end =
    mainEnd === -1
      ? html.length
      : nextPanel === -1 || nextPanel > mainEnd
        ? mainEnd
        : nextPanel;
  assert.ok(end > start, `${id} panel should have a visible boundary`);
  return html.slice(start, end);
}

test("hostToSystemState maps the producer host shape and preserves system states", () => {
  assert.deepEqual(hostToSystemState(PRODUCER_SNAPSHOT.host.data), {
    machine: {
      id: "box",
      name: "Box",
      status: "online",
      latencyMs: null,
      uptimeSeconds: 86400,
      cpuPercent: null,
      memoryPercent: null,
      diskPercent: 41,
      detail: `load 0.25 \u00b7 3 crons`,
    },
    endpoints: [],
  });

  const existing = {
    machine: {
      id: "existing",
      name: "Existing synthetic host",
      status: "online",
      latencyMs: 8,
      uptimeSeconds: 60,
      cpuPercent: 12,
      memoryPercent: 34,
      diskPercent: 56,
      detail: "already adapted",
    },
    endpoints: [],
  } satisfies SystemState;
  assert.strictEqual(hostToSystemState(existing), existing);

  for (const value of [null, "host", 42, []]) {
    assert.equal(hostToSystemState(value), null);
  }
});

test("hostToSystemState passes through numeric CPU and memory values", () => {
  const state = hostToSystemState({ uptimeSeconds: 1, loadavg: [0], cpuPercent: 12, memoryPercent: 45, disk: { usedPct: 3 }, crons: 0 });
  assert.equal(state?.machine.cpuPercent, 12);
  assert.equal(state?.machine.memoryPercent, 45);
  assert.equal(state?.machine.diskPercent, 3);
});

test("botsToAiState maps producer bots and preserves AI telemetry states", () => {
  assert.deepEqual(botsToAiState(PRODUCER_SNAPSHOT.bots.data), {
    providers: [
      {
        name: "Synthetic alpha",
        status: "waiting",
        remainingPercent: null,
        detail: "waiting on Josh: review fixture",
        value: "needs Josh",
        updatedAt: RECENT_ISO,
        requestsToday: null,
        tokensToday: null,
        costToday: null,
        jobsCompleted: null,
        errors: null,
      },
      {
        name: "Synthetic beta",
        status: "running",
        remainingPercent: null,
        detail: "building fixture",
        value: undefined,
        updatedAt: RECENT_ISO,
        requestsToday: null,
        tokensToday: null,
        costToday: null,
        jobsCompleted: null,
        errors: null,
      },
    ],
  });

  const existing = {
    providers: [
      {
        name: "Existing synthetic bot",
        status: "offline",
        remainingPercent: 0,
        requestsToday: 1,
        tokensToday: 2,
        costToday: 0,
        jobsCompleted: 3,
        errors: 4,
      },
    ],
  } satisfies AITelemetryState;
  assert.strictEqual(botsToAiState(existing), existing);

  for (const value of [null, "bots", 42, []]) {
    assert.equal(botsToAiState(value), null);
  }
});

test("evaluateAlerts tolerates producer system data missing machine or endpoints", () => {
  assert.deepEqual(evaluateAlerts(alertData({}), FIXED_NOW), []);

  const machineOnly = {
    machine: {
      id: "box",
      name: "Box",
      status: "online",
      latencyMs: null,
      uptimeSeconds: 60,
      cpuPercent: null,
      memoryPercent: null,
      diskPercent: 10,
    },
  };
  assert.deepEqual(evaluateAlerts(alertData(machineOnly), FIXED_NOW), []);
});

test("producer entries stay fresh for 24 hours and KV data keeps an hourly refresh floor", async () => {
  assert.equal(
    isStale(RECENT_ISO, FIXED_NOW, HOUR_MS),
    false,
    "a five-minute-old producer snapshot is fresh",
  );
  assert.equal(
    isStale("2026-10-31T16:30:00.000Z", FIXED_NOW, HOUR_MS),
    false,
    "the 24-hour boundary remains fresh",
  );
  assert.equal(
    isStale("2026-10-31T16:29:59.999Z", FIXED_NOW, HOUR_MS),
    true,
    "data older than 24 hours is stale",
  );

  const twentyThreeHours = mergeFeeds(
    null,
    snapshotUpdatedAt("2026-10-31T17:30:00.000Z"),
    FIXED_NOW,
  );
  const exactlyTwentyFourHours = mergeFeeds(
    null,
    snapshotUpdatedAt("2026-10-31T16:30:00.000Z"),
    FIXED_NOW,
  );
  const olderThanTwentyFourHours = mergeFeeds(
    null,
    snapshotUpdatedAt("2026-10-31T16:29:59.999Z"),
    FIXED_NOW,
  );

  for (const domain of ["bots", "money", "health", "host"] as const) {
    assert.equal(twentyThreeHours[domain].stale, false, domain);
    assert.equal(exactlyTwentyFourHours[domain].stale, false, domain);
    assert.equal(olderThanTwentyFourHours[domain].stale, true, domain);
  }

  const { response, payload } = await requestDashboard();
  assert.equal(response.status, 200);

  assert.deepEqual(
    payload.data.systems.data,
    hostToSystemState(PRODUCER_SNAPSHOT.host.data),
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(payload.data.ai.data)),
    JSON.parse(JSON.stringify(botsToAiState(PRODUCER_SNAPSHOT.bots.data))),
  );

  for (const domain of [
    "calendar",
    "reminders",
    "finance",
    "health",
    "ai",
    "systems",
    "habits",
    "goals",
  ] as const) {
    assert.ok(
      payload.data[domain].refreshMs >= HOUR_MS,
      `${domain} should use an hourly minimum refresh interval`,
    );
  }
});

test("dashboard SSR renders KV Money, Bots, and Systems data without staleness", async () => {
  const { response, payload } = await requestDashboard();
  assert.equal(response.status, 200);

  const renderPage = (page: "home" | "money") =>
    renderToString(
      Dashboard({
        initial: payload.data,
        renderedAt: payload.serverTime,
        display,
        demo: false,
        forcedMode: "day",
        paused: true,
        page,
      }),
    ).replace(/<!-- -->/g, "");
  const home = renderPage("home");
  const html = renderPage("money");

  const bots = panelHtml(home, "bots");
  assert.ok(bots.includes("Synthetic alpha"), bots);
  assert.ok(bots.includes("Synthetic beta"), bots);
  assert.ok(!bots.includes("No bot activity"), bots);

  const money = panelHtml(html, "money");
  assert.ok(money.includes("$1,234.00"), money);
  assert.ok(money.includes("$321.00"), money);
  assert.ok(money.includes("2 bills"), money);
  assert.ok(!money.includes(">No data<"), money);

  const systems = panelHtml(home, "systems");
  assert.ok(systems.includes("Box &amp; network"), systems);
  assert.ok(systems.includes("1d uptime"), systems);
  assert.ok(systems.includes("41%"), systems);
  assert.ok(!systems.includes(">No data<"), systems);

  for (const [name, panel] of [
    ["Bots", bots],
    ["Money", money],
    ["Systems", systems],
  ] as const) {
    assert.doesNotMatch(panel, />Stale</, `${name} should not be stale`);
    assert.doesNotMatch(panel, />STALE /, `${name} should not carry stale text`);
    assert.ok(
      !panel.includes("feed-stale"),
      `${name} should not carry a stale feed class`,
    );
  }
});
