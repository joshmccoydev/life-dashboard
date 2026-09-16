import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Adapter, DataState, WeatherState } from "../src/domains/models";
import { modeAt, isStale, zonedDateTime, localDateKey } from "../src/lib/time";
import { evaluateAlerts } from "../src/lib/alerts";
import { refreshAdapter, AdapterCache, readState } from "../src/lib/cache";
import { normalizeWeather, weatherCondition } from "../src/adapters/weather";
import { normalizeGitHub } from "../src/adapters/github";
import { selectAdapter, getDemoDashboard } from "../src/adapters";
import { checkEndpoint } from "../src/adapters/systems";
const modes = { morning: 6, day: 9, evening: 17, night: 22 };
const zone = "America/Chicago";
test("modes change at each configured boundary in display timezone", () => {
  for (const [hour, expected] of [
    [0, "night"],
    [5, "night"],
    [6, "morning"],
    [8, "morning"],
    [9, "day"],
    [16, "day"],
    [17, "evening"],
    [21, "evening"],
    [22, "night"],
    [23, "night"],
  ] as const)
    assert.equal(
      modeAt(zonedDateTime("2026-09-15", hour, 0, zone), zone, modes),
      expected,
    );
  assert.equal(
    modeAt(zonedDateTime("2026-09-15", 7, 0, zone), zone, {
      morning: 7,
      day: 10,
      evening: 18,
      night: 23,
    }),
    "morning",
  );
});
test("local day boundaries handle winter, summer and daylight-saving transitions", () => {
  assert.equal(
    zonedDateTime("2026-01-15", 0, 0, zone).toISOString(),
    "2026-01-15T06:00:00.000Z",
  );
  assert.equal(
    zonedDateTime("2026-09-15", 0, 0, zone).toISOString(),
    "2026-09-15T05:00:00.000Z",
  );
  assert.equal(
    localDateKey(new Date("2026-09-16T02:00:00Z"), zone),
    "2026-09-15",
  );
  assert.equal(modeAt(new Date("2026-11-01T08:00:00Z"), zone, modes), "night");
});
test("staleness uses twice the configured interval and missing success is stale", () => {
  const success = "2026-09-15T12:00:00Z";
  assert.equal(
    isStale(success, new Date("2026-09-15T12:02:00Z"), 60000),
    false,
  );
  assert.equal(isStale(success, new Date("2026-09-15T12:02:01Z"), 60000), true);
  assert.equal(isStale(null, new Date(success), 60000), true);
});
test("weather normalization validates observations and maps weather codes", () => {
  const result = normalizeWeather({
    current: {
      temperature_2m: 72.6,
      apparent_temperature: 73.2,
      weather_code: 63,
      is_day: 1,
    },
    daily: { temperature_2m_max: [80.2], temperature_2m_min: [61.8] },
  });
  assert.equal(result.temperature, 73);
  assert.equal(result.condition, "Rain");
  assert.equal(result.low, 62);
  assert.equal(weatherCondition(95), "Thunderstorms");
  assert.throws(() => normalizeWeather({ current: { temperature_2m: 0 } }));
  assert.throws(() => normalizeWeather({ current: { temperature_2m: NaN } }));
});
test("GitHub counts actual contributions and exposes nullable last activity", () => {
  const normalized = normalizeGitHub({
    data: {
      user: {
        login: "j",
        pullRequests: { totalCount: 2 },
        contributionsCollection: {
          totalCommitContributions: 5,
          commitContributionsByRepository: [
            {
              repository: { nameWithOwner: "j/project" },
              contributions: { totalCount: 5 },
            },
          ],
        },
        repositories: { nodes: [{ pushedAt: null }] },
      },
    },
  });
  assert.equal(normalized.commitsToday, 5);
  assert.equal(normalized.activeRepos, 1);
  assert.equal(normalized.openPRs, 2);
  assert.equal(normalized.lastActivity, null);
  assert.throws(() => normalizeGitHub({ errors: [{ message: "rate limit" }] }));
  assert.throws(() => normalizeGitHub({ data: { user: null } }));
});
const real: Adapter<{ value: number }> = {
  provider: "Real",
  source: "real",
  fetch: async () => ({ value: 42 }),
};
const mock: Adapter<{ value: number }> = {
  provider: "Demo",
  source: "mock",
  fetch: async () => ({ value: 7 }),
};
test("selection falls back without credentials and respects demo override", () => {
  assert.equal(selectAdapter(real, mock, "auto", false), real);
  assert.equal(selectAdapter(null, mock, "auto", false), mock);
  assert.equal(selectAdapter(real, mock, "auto", true), mock);
  assert.equal(selectAdapter(real, mock, "mock", false), mock);
});
test("failure retains last known real data, then recovers on success", async () => {
  const now = new Date("2026-09-15T12:00:00Z");
  const good = await refreshAdapter(real, mock, undefined, now, 60000);
  const failed = {
    ...real,
    fetch: async () => {
      throw new Error("Timed out");
    },
  };
  const stale = await refreshAdapter(
    failed,
    mock,
    good,
    new Date(now.getTime() + 60000),
    60000,
  );
  assert.equal(stale.data.value, 42);
  assert.equal(stale.source, "real");
  assert.equal(stale.status, "stale");
  assert.equal(stale.lastSuccess, good.lastSuccess);
  const recovered = await refreshAdapter(
    real,
    mock,
    stale,
    new Date(now.getTime() + 120000),
    60000,
  );
  assert.equal(recovered.status, "ready");
  assert.equal(recovered.error, null);
  assert.equal(
    readState(good, new Date(now.getTime() + 180000)).status,
    "stale",
  );
});
test("cold failure shows labeled demo without claiming a real success", async () => {
  const failed = {
    ...real,
    fetch: async () => {
      throw new Error("Unreachable");
    },
  };
  const result = await refreshAdapter(
    failed,
    mock,
    undefined,
    new Date(),
    60000,
  );
  assert.equal(result.source, "mock");
  assert.equal(result.data.value, 7);
  assert.equal(result.lastSuccess, null);
  assert.equal(result.status, "error");
});
test("cache deduplicates simultaneous calls and respects refresh interval", async () => {
  let count = 0;
  const cache = new AdapterCache(
    "test",
    {
      ...real,
      fetch: async () => {
        count++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { value: count };
      },
    },
    mock,
    60000,
    false,
  );
  const now = new Date();
  const [a, b] = await Promise.all([cache.get(now), cache.get(now)]);
  assert.equal(count, 1);
  assert.deepEqual(a, b);
  await cache.get(new Date(now.getTime() + 59000));
  assert.equal(count, 1);
  await cache.get(new Date(now.getTime() + 60000));
  assert.equal(count, 2);
});
test("deterministic alerts cover offline service, disk, overdue, meeting, bill and stale feeds", async () => {
  const now = new Date();
  const data = await getDemoDashboard();
  data.systems.data.machine.diskPercent = 91;
  data.systems.data.endpoints[0].status = "offline";
  data.calendar.data.events = [
    {
      id: "next",
      title: "Sync",
      start: new Date(now.getTime() + 10 * 60000).toISOString(),
      end: new Date(now.getTime() + 40 * 60000).toISOString(),
      calendar: "work",
    },
  ];
  data.finance.data.bills = [
    {
      title: "Insurance",
      amount: 100,
      due: new Date(now.getTime() + 86400000).toISOString(),
    },
  ];
  data.weather.lastSuccess = new Date(
    now.getTime() - data.weather.refreshMs * 3,
  ).toISOString();
  const alerts = evaluateAlerts(data, now);
  for (const id of [
    "disk-machine",
    "offline-internet",
    "overdue",
    "meeting",
    "bill-Insurance",
    "stale-weather",
  ])
    assert.ok(
      alerts.some((a) => a.id === id),
      id,
    );
  assert.equal(alerts[0].level, "critical");
  data.systems.data.machine.diskPercent = 90;
  assert.ok(!evaluateAlerts(data, now).some((a) => a.id === "disk-machine"));
});
test("calm data emits no attention alerts", async () => {
  const now = new Date();
  const data = await getDemoDashboard();
  data.reminders.data.items = [];
  data.calendar.data.events = [];
  data.finance.data.bills = [];
  assert.deepEqual(evaluateAlerts(data, now), []);
});
test("HTTP checks recognize healthy, failed and timed-out endpoints without throwing", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/slow") return;
    response.writeHead(request.url === "/bad" ? 503 : 200);
    response.end("health");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const good = await checkEndpoint(
      { name: "Healthy", url: base, timeoutMs: 2000 },
      "test-good",
    );
    assert.equal(good.status, "online");
    assert.ok(good.latencyMs !== null);
    assert.equal(
      (await checkEndpoint({ name: "Failed", url: `${base}/bad` }, "test-bad"))
        .status,
      "offline",
    );
    const timeout = await checkEndpoint(
      { name: "Slow", url: `${base}/slow`, timeoutMs: 50 },
      "test-slow",
    );
    assert.equal(timeout.status, "offline");
    assert.equal(timeout.detail, "Timed out");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("mock weather is never represented as live", async () => {
  const data = await getDemoDashboard();
  const weather: DataState<WeatherState> = data.weather;
  assert.equal(weather.source, "mock");
  assert.equal(weather.provider, "Demo weather");
});

test("Codex uses the codex bucket and leaves unreported activity unknown", async () => {
  const { normalizeCodex } = await import("../src/adapters/codex");
  const result = normalizeCodex({
    rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300 } },
    rateLimitsByLimitId: {
      codex: {
        primary: {
          usedPercent: 39,
          windowDurationMins: 300,
          resetsAt: 1789541207,
        },
        secondary: { usedPercent: 6, windowDurationMins: 10080 },
      },
    },
    rateLimitResetCredits: {
      availableCount: 2,
      credits: [
        { status: "available", expiresAt: 1791076543 },
        { status: "available", expiresAt: 1791154892 },
      ],
    },
  });
  assert.equal(result.providers[0].remainingPercent, 61);
  assert.equal(result.providers[1].name, "Codex weekly");
  assert.equal(result.providers[1].remainingPercent, 94);
  assert.equal(result.providers[0].tokensToday, null);
  assert.equal(result.providers[0].status, "unknown");
  assert.equal(result.providers[2].name, "Codex resets");
  assert.equal(result.providers[2].value, "2 available");
  assert.equal(result.providers[2].availableCount, 2);
  assert.equal(
    result.providers[2].expiresAt,
    new Date(1791076543 * 1000).toISOString(),
  );
  assert.throws(() => normalizeCodex({ rateLimits: null }));
});
test("local AI usage snapshot normalizes Cursor and Grok Bot without inventing data", async () => {
  const { normalizeAIUsageSnapshot } = await import("../src/adapters/ai-usage");
  const now = new Date("2026-09-16T03:00:00Z");
  const result = normalizeAIUsageSnapshot(
    {
      updatedAt: "2026-09-16T02:55:00Z",
      cursor: { usedPercent: 18, resetAt: "2026-10-01T00:00:00Z" },
      grokbot: { requestsRemaining: 42, detail: "SuperGrok-linked grant" },
    },
    now,
  );
  assert.equal(result[0].name, "Cursor monthly");
  assert.equal(result[0].remainingPercent, 82);
  assert.equal(result[1].value, "42 left");
  assert.throws(() =>
    normalizeAIUsageSnapshot(
      { updatedAt: "2026-09-14T00:00:00Z", cursor: { usedPercent: 18 } },
      now,
    ),
  );
});
test("public GitHub refuses partial search counts", async () => {
  const { normalizePublicGitHub } = await import("../src/adapters/github");
  const commit = {
    sha: "abc",
    repository: { full_name: "user/repo" },
    commit: { committer: { date: "2026-09-15T12:00:00Z" } },
  };
  const data = normalizePublicGitHub(
    { total_count: 1, incomplete_results: false, items: [commit] },
    { total_count: 2, incomplete_results: false },
    "user",
  );
  assert.equal(data.scope, "public");
  assert.equal(data.activeRepos, 1);
  assert.equal(data.openPRs, 2);
  assert.throws(() =>
    normalizePublicGitHub(
      { total_count: 101, incomplete_results: false, items: [commit] },
      { total_count: 0, incomplete_results: false },
      "user",
    ),
  );
});
test("Apple bridge validates freshness, permission and undated reminders", async () => {
  const { normalizeAppleSnapshot } = await import("../src/adapters/apple");
  const now = new Date("2026-09-15T12:00:00Z");
  const snapshot = {
    version: 1,
    capturedAt: now.toISOString(),
    permissions: { calendar: false, reminders: true },
    reminders: {
      items: [{ id: "a", title: "Undated", due: null, completed: false }],
    },
  };
  assert.equal(
    (normalizeAppleSnapshot(snapshot, "reminders", now) as { items: unknown[] })
      .items.length,
    1,
  );
  assert.throws(
    () => normalizeAppleSnapshot(snapshot, "calendar", now),
    /Grant/,
  );
  assert.throws(
    () =>
      normalizeAppleSnapshot(
        snapshot,
        "reminders",
        new Date(now.getTime() + 181000),
      ),
    /stale/,
  );
});

test("Apple habits group recurring reminder history by title and local date", async () => {
  const { normalizeAppleSnapshot } = await import("../src/adapters/apple");
  const now = new Date("2026-09-16T02:00:00Z");
  const habits = normalizeAppleSnapshot(
    {
      version: 1,
      capturedAt: now.toISOString(),
      permissions: { calendar: false, reminders: true },
      habits: {
        items: [
          {
            id: "vitamins-old",
            title: "Vitamins",
            due: "2026-09-15T13:00:00Z",
            completed: true,
            completedAt: "2026-09-15T13:04:00Z",
          },
          {
            id: "vitamins-current",
            title: "Vitamins",
            due: "2026-09-16T13:00:00Z",
            completed: false,
            completedAt: null,
          },
        ],
      },
    },
    "habits",
    now,
  );
  assert.equal("habits" in habits && habits.habits.length, 1);
  assert.deepEqual(
    "habits" in habits
      ? habits.habits[0].occurrences.map((item) => [item.date, item.completed])
      : [],
    [
      ["2026-09-15", true],
      ["2026-09-16", false],
    ],
  );
});

test("completed habits use completion day instead of an earlier due day", async () => {
  const { normalizeAppleSnapshot } = await import("../src/adapters/apple");
  const now = new Date("2026-09-16T12:00:00Z");
  const habits = normalizeAppleSnapshot(
    {
      version: 1,
      capturedAt: now.toISOString(),
      permissions: { calendar: false, reminders: true },
      habits: {
        items: [
          {
            id: "read-late",
            title: "Read 20 minutes",
            due: "2026-09-15T05:00:00Z",
            completed: true,
            completedAt: "2026-09-16T05:22:50Z",
          },
        ],
      },
    },
    "habits",
    now,
  );
  assert.deepEqual(
    "habits" in habits
      ? habits.habits[0].occurrences.map((item) => [item.date, item.completed])
      : [],
    [["2026-09-16", true]],
  );
});

test("Apple goals and projects use dedicated reminder lists and notes", async () => {
  const { normalizeAppleSnapshot } = await import("../src/adapters/apple");
  const now = new Date("2026-09-16T12:00:00Z");
  const snapshot = {
    version: 1,
    capturedAt: now.toISOString(),
    permissions: { calendar: false, reminders: true },
    reminders: {
      items: [
        {
          id: "goal",
          title: "Read 24 books",
          notes: "Finish the current book",
          due: "2026-12-31T06:00:00Z",
          completed: false,
          listName: "Goals",
        },
        {
          id: "project",
          title: "LifeDash",
          notes: "Add durable habit history",
          due: null,
          completed: false,
          listName: "Projects",
        },
        {
          id: "ordinary",
          title: "Buy coffee",
          notes: null,
          due: null,
          completed: false,
          listName: "Reminders",
        },
      ],
    },
  };
  const goals = normalizeAppleSnapshot(snapshot, "goals", now);
  assert.deepEqual(
    "goals" in goals
      ? {
          goals: goals.goals.map((goal) => [goal.title, goal.detail, goal.due]),
          projects: goals.projects.map((project) => [
            project.name,
            project.detail,
            project.due,
          ]),
        }
      : {},
    {
      goals: [
        ["Read 24 books", "Finish the current book", "2026-12-31T06:00:00Z"],
      ],
      projects: [["LifeDash", "Add durable habit history", null]],
    },
  );
  const reminders = normalizeAppleSnapshot(snapshot, "reminders", now);
  assert.deepEqual(
    "items" in reminders
      ? reminders.items.map((item) => [item.title, item.dashboardRole])
      : [],
    [
      ["Read 24 books", "goal"],
      ["LifeDash", "project"],
      ["Buy coffee", "ordinary"],
    ],
  );
});

test("habit summaries distinguish scheduled days and calculate streaks", async () => {
  const { habitWeek } = await import("../src/lib/habits");
  const now = zonedDateTime("2026-09-15", 20, 0, zone);
  const result = habitWeek(
    {
      id: "read",
      title: "Read",
      trackingMethod: "reminder",
      occurrences: [
        { date: "2026-09-12", completed: true, completedAt: now.toISOString() },
        { date: "2026-09-13", completed: false, completedAt: null },
        { date: "2026-09-14", completed: true, completedAt: now.toISOString() },
        { date: "2026-09-15", completed: true, completedAt: now.toISOString() },
      ],
    },
    now,
    zone,
  );
  assert.equal(result.days[0].date, "2026-09-14");
  assert.equal(result.days[6].date, "2026-09-20");
  assert.equal(result.scheduled, 2);
  assert.equal(result.completed, 2);
  assert.equal(result.currentStreak, 2);
  assert.equal(result.bestStreak, 2);
  assert.equal(result.today?.completed, true);
});

test("upcoming payments come only from the Payments reminders list", async () => {
  const { upcomingPayments } = await import("../src/lib/payments");
  const now = zonedDateTime("2026-09-15", 20, 0, zone);
  const result = upcomingPayments(
    [
      {
        id: "payment",
        title: "Internet bill",
        due: zonedDateTime("2026-09-18", 9, 0, zone).toISOString(),
        completed: false,
        listName: "Payments",
      },
      {
        id: "ordinary",
        title: "Call Alex",
        due: zonedDateTime("2026-09-18", 9, 0, zone).toISOString(),
        completed: false,
        listName: "Reminders",
      },
      {
        id: "old-payment",
        title: "Old bill",
        due: zonedDateTime("2026-09-14", 9, 0, zone).toISOString(),
        completed: false,
        listName: "Payments",
      },
    ],
    now,
    zone,
  );
  assert.deepEqual(
    result.map((item) => item.title),
    ["Internet bill"],
  );
});

test("Mac memory counts physical active, wired and compressor pages", async () => {
  const { normalizeMacMemory } = await import("../src/adapters/systems");
  assert.equal(
    normalizeMacMemory(
      "page size of 16384 bytes\nPages active: 20.\nPages wired down: 10.\nPages occupied by compressor: 10.\nPages inactive: 60.",
      1638400,
    ),
    40,
  );
  assert.throws(() => normalizeMacMemory("missing", 1638400));
});

test("Today ignores all-day clutter and rotates every incomplete reminder", async () => {
  const { todayView } = await import("../src/lib/today");
  const now = new Date("2026-09-15T15:00:00Z");
  const events = [
    {
      id: "a",
      title: "Holiday",
      start: "2026-09-15T05:00:00Z",
      end: "2026-09-16T05:00:00Z",
      calendar: "personal" as const,
      allDay: true,
    },
    {
      id: "b",
      title: "Meeting",
      start: "2026-09-15T16:00:00Z",
      end: "2026-09-15T17:00:00Z",
      calendar: "work" as const,
    },
  ];
  const reminders = [
    { id: "1", title: "Undated", due: null, completed: false },
    {
      id: "2",
      title: "Overdue",
      due: "2026-09-14T12:00:00Z",
      completed: false,
    },
    { id: "3", title: "Future", due: "2026-09-16T12:00:00Z", completed: false },
    { id: "4", title: "Done", due: null, completed: true },
  ];
  const first = todayView(events, reminders, now, zone, "day", 0),
    second = todayView(events, reminders, now, zone, "day", 1);
  assert.equal(first.next?.id, "b");
  assert.equal(first.allDay.length, 1);
  assert.equal(first.work, 1);
  assert.equal(first.personal, 0);
  assert.deepEqual(
    first.reminders.map((r) => r.id),
    ["2", "3"],
  );
  assert.deepEqual(
    second.reminders.map((r) => r.id),
    ["1"],
  );
  assert.equal(todayView(events, reminders, now, zone, "day", 2).page, 0);
});
test("import freshness reflects import time rather than repeated file reads", async () => {
  const { normalizeHealthImport } = await import("../src/adapters/health");
  const now = new Date("2026-09-15T15:00:00Z");
  const data = normalizeHealthImport(
    {
      version: 1,
      importedAt: "2026-09-15T12:00:00Z",
      timezone: zone,
      days: [
        {
          date: "2026-09-15",
          steps: 1000,
          stepGoal: null,
          sleepMinutes: null,
          activityPercent: null,
          exerciseMinutes: null,
          exerciseGoal: null,
          standHours: null,
          standGoal: null,
          workout: null,
        },
      ],
    },
    now,
  );
  const adapter: Adapter<typeof data> = {
    provider: "import",
    source: "real",
    observedAt: (d) => d.importedAt!,
    fetch: async () => data,
  };
  const result = await refreshAdapter(adapter, adapter, undefined, now, 600000);
  assert.equal(result.lastSuccess, "2026-09-15T12:00:00Z");
  assert.equal(result.status, "stale");
  assert.equal(result.data.sleepMinutes, null);
});

test("Health sync authenticates and replaces daily totals without double counting", async () => {
  const { healthAuthorized, normalizeHealthSync, mergeHealthDays } =
    await import("../src/lib/health-sync");
  const token = "a".repeat(64),
    now = new Date("2026-09-15T15:00:00Z");
  assert.equal(healthAuthorized(null, token), false);
  assert.equal(healthAuthorized(`Bearer ${token}`, token), true);
  assert.equal(healthAuthorized(`Bearer ${"b".repeat(64)}`, token), false);
  const updates = normalizeHealthSync(
    {
      data: {
        metrics: [
          {
            name: "step_count",
            units: "count",
            data: [{ date: "2026-09-15 00:00:00 -0500", qty: 5000 }],
          },
          {
            name: "sleep_analysis",
            units: "hr",
            data: [{ date: "2026-09-15", totalSleep: 7.5, inBed: 9 }],
          },
          {
            name: "active_energy",
            units: "kJ",
            data: [{ date: "2026-09-15", qty: 418.4 }],
          },
        ],
      },
    },
    zone,
    now,
  );
  const days = mergeHealthDays([], updates, now.toISOString(), zone);
  assert.equal(days[0].steps, 5000);
  assert.equal(days[0].sleepMinutes, 450);
  assert.equal(days[0].activeEnergy, 100);
  assert.equal(days[0].stepGoal, null);
  assert.equal(
    mergeHealthDays(days as typeof updates, updates, now.toISOString(), zone)[0]
      .steps,
    5000,
  );
  const partial = mergeHealthDays(
    days as typeof updates,
    [{ date: "2026-09-15", steps: 6000 }],
    now.toISOString(),
    zone,
  );
  assert.equal(partial[0].sleepMinutes, 450);
  assert.equal(partial[0].steps, 6000);
  assert.throws(() =>
    normalizeHealthSync({ date: "2026-09-15", steps: -1 }, zone, now),
  );
  assert.throws(
    () =>
      normalizeHealthSync(
        {
          data: {
            metrics: [
              {
                name: "step_count",
                units: "count",
                data: [
                  { date: "2026-09-15", qty: 1 },
                  { date: "2026-09-15", qty: 2 },
                ],
              },
            ],
          },
        },
        zone,
        now,
      ),
    /daily aggregation/,
  );
});

test("evening previews tomorrow, while late events today retain priority", async () => {
  const { todayView } = await import("../src/lib/today");
  const now = zonedDateTime("2026-09-15", 19, 0, zone);
  const tomorrow = {
    id: "tomorrow",
    title: "Morning",
    start: zonedDateTime("2026-09-16", 9, 0, zone).toISOString(),
    end: zonedDateTime("2026-09-16", 10, 0, zone).toISOString(),
    calendar: "work" as const,
  };
  const late = {
    id: "late",
    title: "Dinner",
    start: zonedDateTime("2026-09-15", 20, 0, zone).toISOString(),
    end: zonedDateTime("2026-09-15", 21, 0, zone).toISOString(),
    calendar: "personal" as const,
  };
  assert.equal(
    todayView([tomorrow], [], now, zone, "evening", 0).previewTomorrow,
    true,
  );
  assert.equal(
    todayView([tomorrow], [], now, zone, "evening", 0).next?.id,
    "tomorrow",
  );
  const withLate = todayView([tomorrow, late], [], now, zone, "evening", 0);
  assert.equal(withLate.previewTomorrow, false);
  assert.equal(withLate.next?.id, "late");
  const later = {
    ...tomorrow,
    id: "later",
    start: zonedDateTime("2026-09-18", 9, 0, zone).toISOString(),
    end: zonedDateTime("2026-09-18", 10, 0, zone).toISOString(),
  };
  assert.equal(todayView([later], [], now, zone, "night", 0).next, undefined);
});
test("night preview after midnight includes this morning instead of skipping a day", async () => {
  const { todayView } = await import("../src/lib/today");
  const now = zonedDateTime("2026-11-01", 1, 0, zone);
  const event = {
    id: "morning",
    title: "Morning",
    start: zonedDateTime("2026-11-01", 9, 0, zone).toISOString(),
    end: zonedDateTime("2026-11-01", 10, 0, zone).toISOString(),
    calendar: "personal" as const,
  };
  const view = todayView([event], [], now, zone, "night", 0);
  assert.equal(view.previewTomorrow, false);
  assert.equal(view.next?.id, "morning");
});
test("critical alerts stay visible and night suppresses routine alerts", async () => {
  const { attentionView } = await import("../src/lib/alerts");
  const alerts = [
    { id: "overdue", level: "warning" as const, message: "Reminder" },
    { id: "offline", level: "critical" as const, message: "Offline" },
    { id: "disk", level: "critical" as const, message: "Disk" },
  ];
  for (let rotation = 0; rotation < 8; rotation++)
    assert.equal(
      attentionView(alerts, "day", rotation).alert?.level,
      "critical",
    );
  assert.equal(attentionView(alerts, "night", 0).count, 2);
  assert.equal(attentionView([alerts[0]], "night", 0).alert, null);
  assert.equal(
    attentionView(
      [{ id: "stale-weather", level: "warning", message: "Stale" }],
      "night",
      0,
    ).count,
    1,
  );
});
test("live view suppresses fabricated demo urgency but still reports failed feeds", async () => {
  const now = new Date(),
    data = await getDemoDashboard();
  data.systems.data.machine.diskPercent = 99;
  data.reminders.data.items = [
    {
      id: "a",
      title: "Demo task",
      due: new Date(now.getTime() - 1000).toISOString(),
      completed: false,
    },
  ];
  data.calendar.data.events = [];
  data.finance.data.bills = [
    {
      title: "Demo bill",
      amount: 10,
      due: new Date(now.getTime() + 1000).toISOString(),
    },
  ];
  assert.deepEqual(evaluateAlerts(data, now, { includeDemo: false }), []);
  assert.ok(evaluateAlerts(data, now).length >= 3);
  data.weather.status = "error";
  data.weather.lastSuccess = null;
  assert.ok(
    evaluateAlerts(data, now, { includeDemo: false }).some(
      (a) => a.id === "stale-weather",
    ),
  );
});
