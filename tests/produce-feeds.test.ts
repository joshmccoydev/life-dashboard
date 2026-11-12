import test from "node:test";
import assert from "node:assert/strict";
import {
  buildApple,
  buildBots,
  buildHost,
  DEFAULT_PATHS,
  buildSnapshot,
  parseStatus,
  planKvPut,
  readJsonEntry,
  summarize,
  type Snapshot,
} from "../scripts/produce-feeds.ts";

const PATHS = {
  status: "/synthetic/vault/Status.md",
  board: "/synthetic/vault/Board.md",
  money: "/synthetic/exports/buffett-dash.json",
  health: "/synthetic/exports/arnold-dash.json",
  apple: "/synthetic/exports/apple-dash.json",
};

function inlineReadFile(files: Record<string, string>) {
  return ((path: string): string => {
    if (!Object.hasOwn(files, path)) {
      const error = new Error(`ENOENT: synthetic file missing: ${path}`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return files[path];
  }) as typeof import("node:fs").readFileSync;
}

test("parseStatus returns one entry per section and nulls missing keys", () => {
  const markdown = [
    "# Bot status",
    "",
    "## Buffett",
    "updated: 2026-10-31T08:00:00.000Z",
    "working_on: Reviewing filings",
    "last_done: Sent the summary",
    "next_up: Check the ledger",
    "",
    "## Arnold",
    "updated: 2026-10-31T09:00:00.000Z",
    "working_on: Recovery plan",
    "last_done: Completed the workout",
    "next_up: Sleep",
  ].join("\n");

  assert.deepEqual(parseStatus(markdown), [
    {
      bot: "Buffett",
      updated: "2026-10-31T08:00:00.000Z",
      working_on: "Reviewing filings",
      last_done: "Sent the summary",
      next_up: "Check the ledger",
      needs_josh: null,
      open_asks: 0,
    },
    {
      bot: "Arnold",
      updated: "2026-10-31T09:00:00.000Z",
      working_on: "Recovery plan",
      last_done: "Completed the workout",
      next_up: "Sleep",
      needs_josh: null,
      open_asks: 0,
    },
  ]);
});

test("parseStatus counts open [ASK] rows and ignores [DONE] and the needs_josh line", () => {
  const markdown = [
    "## Chief",
    "needs_josh: approve the box delete list",
    "- [ASK] 2026-11-06 | q: park forge.relay?",
    "- [ASK] 2026-11-06 | q: WARN not ESCALATE?",
    "- [DONE] 2026-11-05 | q: already answered",
    "",
    "## Scout",
    "needs_josh: resume scout's grok-side routine",
    "- [DONE] 2026-11-02 | q: approve more first touches",
    "",
    "## Dolly",
    "needs_josh:",
    "- [ASK] 2026-11-12 | q: real lease signing times?",
  ].join("\n");
  const items = parseStatus(markdown);
  assert.equal(items[0]?.bot, "Chief");
  assert.equal(items[0]?.open_asks, 2);
  assert.equal(items[0]?.needs_josh, "approve the box delete list");
  assert.equal(items[1]?.bot, "Scout");
  assert.equal(items[1]?.open_asks, 0);
  assert.equal(items[1]?.needs_josh, "resume scout's grok-side routine");
  assert.equal(items[2]?.bot, "Dolly");
  assert.equal(items[2]?.open_asks, 1);
  assert.equal(items[2]?.needs_josh, null);
});

test("readJsonEntry parses valid JSON and uses its updated_at", () => {
  const path = "/synthetic/money.json";
  const entry = readJsonEntry(
    path,
    "box:buffett",
    inlineReadFile({
      [path]: JSON.stringify({
        updated_at: "2026-10-31T10:00:00.000Z",
        cash: 42,
      }),
    }),
  );

  assert.deepEqual(entry, {
    data: {
      updated_at: "2026-10-31T10:00:00.000Z",
      cash: 42,
    },
    updatedAt: "2026-10-31T10:00:00.000Z",
    source: "box:buffett",
  });
});

test("readJsonEntry reports a missing file without throwing", () => {
  const entry = readJsonEntry(
    "/synthetic/missing.json",
    "box:missing",
    inlineReadFile({}),
  );

  assert.equal(entry.data, null);
  assert.equal(entry.updatedAt, null);
  assert.equal(entry.source, "box:missing");
  assert.equal(typeof entry.error, "string");
  assert.ok(entry.error);
});

test("readJsonEntry reports invalid JSON without throwing", () => {
  const path = "/synthetic/invalid.json";
  const entry = readJsonEntry(
    path,
    "box:invalid",
    inlineReadFile({ [path]: "{not-json" }),
  );

  assert.equal(entry.data, null);
  assert.equal(entry.updatedAt, null);
  assert.equal(entry.source, "box:invalid");
  assert.equal(typeof entry.error, "string");
  assert.ok(entry.error);
});

test("buildBots parses Status without Board.md", () => {
  const status = [
    "## Buffett",
    "updated: 2026-10-31T08:00:00.000Z",
    "working_on: Reviewing filings",
  ].join("\n");
  const statusMtime = new Date("2026-10-31T12:00:00.000Z");
  const now = new Date("2026-10-31T12:01:00.000Z");
  const entry = buildBots(
    PATHS,
    inlineReadFile({
      [PATHS.status]: status,
    }),
    () => ({ mtime: statusMtime }),
    now,
  );

  assert.equal(entry.source, "box:status");
  assert.equal(entry.updatedAt, statusMtime.toISOString());
  assert.deepEqual(entry.data, {
    bots: parseStatus(status),
  });
  assert.equal(entry.error, undefined);
});

test("buildHost parses uptime, disk, and crontab output", () => {
  const now = new Date("2026-10-31T12:00:00.000Z");
  const run = (cmd: string, args: string[]): string => {
    if (cmd === "df" && args.length === 2 && args[0] === "-P" && args[1] === "/") {
      return [
        "Filesystem 1024-blocks Used Available Capacity Mounted on",
        "/dev/sda1 100 42 58 42% /",
      ].join("\n");
    }
    if (cmd === "crontab" && args.length === 1 && args[0] === "-l") {
      return [
        "# managed crons",
        "",
        "0 * * * * /synthetic/hourly",
        "# disabled cron",
        "15 2 * * * /synthetic/daily",
      ].join("\n");
    }
    throw new Error(`unexpected synthetic command: ${cmd}`);
  };

  const entry = buildHost({
    run,
    uptime: () => 12_345,
    loadavg: () => [0.25, 0.5, 0.75],
    now,
  });

  assert.equal(entry.source, "box:host");
  assert.equal(entry.updatedAt, now.toISOString());
  assert.deepEqual(entry.data, {
    uptimeSeconds: 12_345,
    loadavg: [0.25, 0.5, 0.75],
    cpuPercent: null,
    memoryPercent: null,
    disk: { usedPct: 42 },
    crons: 2,
  });
});

test("buildHost turns failing commands into null fields", () => {
  const now = new Date("2026-10-31T13:00:00.000Z");
  const entry = buildHost({
    run: () => {
      throw new Error("synthetic command failure");
    },
    uptime: () => 67,
    loadavg: () => [0.1, 0.2, 0.3],
    now,
  });

  assert.equal(entry.source, "box:host");
  assert.equal(entry.updatedAt, now.toISOString());
  assert.deepEqual(entry.data, {
    uptimeSeconds: 67,
    loadavg: [0.1, 0.2, 0.3],
    cpuPercent: null,
    memoryPercent: null,
    disk: { usedPct: null },
    crons: null,
  });
});

test("buildHost copies injected CPU and memory metrics", () => {
  const entry = buildHost({ run: () => "", uptime: () => 1, loadavg: () => [], cpuMemory: () => ({ cpuPercent: 24, memoryPercent: 61 }), now: new Date("2026-10-31T00:00:00.000Z") });
  assert.equal((entry.data as { cpuPercent: number }).cpuPercent, 24);
  assert.equal((entry.data as { memoryPercent: number }).memoryPercent, 61);
});

test("buildApple composes an allowlisted calendar from life-dash files", () => {
  const paths = { apple: "/no/apple.json", calendar: "/calendar.json", reminders: "/reminders.json", habits: "/habits.json", goals: "/goals.json" };
  const entry = buildApple(paths, inlineReadFile({ [paths.calendar]: JSON.stringify({ as_of: "2026-10-31T12:00:00.000Z", events: [{ title: "Review", start: "2026-10-31T13:00:00Z", end: "2026-10-31T14:00:00Z", calendar: "WORK", attendees: ["private@example.test"], location: "private" }, { title: "bad", start: "bad", end: "2026-10-31", calendar: "else" }] }) }));
  assert.equal(entry.source, "box:life-dash");
  assert.deepEqual(entry.data, { calendar: { events: [{ id: "Review:2026-10-31T13:00:00Z", title: "Review", start: "2026-10-31T13:00:00Z", end: "2026-10-31T14:00:00Z", calendar: "work" }] }, reminders: null, habits: null, goals: null });
  assert.equal(entry.updatedAt, "2026-10-31T12:00:00.000Z");
});

test("buildApple stays not wired when no life-dash sources are valid", () => {
  const paths = { apple: "/missing/apple.json", calendar: "/missing/calendar.json", reminders: "/missing/reminders.json", habits: "/missing/habits.json", goals: "/missing/goals.json" };
  assert.equal(buildApple(paths, inlineReadFile({})).source, "mac:not-wired");
});

test("buildWeather and buildGitHub map only supported feed fields", async (t) => {
  const { buildWeather, buildGitHub } = await import("../scripts/produce-feeds.ts");
  const weatherPath = DEFAULT_PATHS.weather;
  const buildPath = DEFAULT_PATHS.build;
  const read = inlineReadFile({ [weatherPath]: JSON.stringify({ as_of: "2026-10-31T12:00:00Z", now: 70, feels_like: 68, high: 75, low: 60, condition: "Clear", code: 0, unit: "F", location: "Elsewhere", is_day: true, phone: "excluded" }), [buildPath]: JSON.stringify({ as_of: "2026-10-31T12:00:00Z", username: "user", commits_today: 2, active_repos: 1, open_prs: 3, last_activity: "today", repositories: [{ name: "repo", commits: 2 }], secret: "excluded", wowTitle: "wow" }) });
  assert.equal((buildWeather(weatherPath, read).data as { temperature: number }).temperature, 70);
  const buildData = buildGitHub(buildPath, read).data as Record<string, unknown>;
  assert.equal(buildData.commitsToday, 2);
  assert.equal(Object.hasOwn(buildData, "secret"), false);
});

test("buildApple marks a missing apple export as not wired", () => {
  const entry = buildApple(PATHS, inlineReadFile({}));

  assert.deepEqual(entry, {
    data: null,
    updatedAt: null,
    source: "mac:not-wired",
    note: "not connected",
  });
});

test("buildSnapshot assigns the requested source to every entry", () => {
  const now = new Date("2026-10-31T14:00:00.000Z");
  const files = {
    [PATHS.status]: "## Buffett\nupdated: 2026-10-31T14:00:00.000Z",
    [PATHS.board]: "# Board\nFirst line\nSecond line",
    [PATHS.money]: JSON.stringify({
      updated_at: "2026-10-31T13:30:00.000Z",
      value: 100,
    }),
    [PATHS.health]: JSON.stringify({
      updated_at: "2026-10-31T13:45:00.000Z",
      value: 80,
    }),
  };
  const snapshot = buildSnapshot({
    paths: PATHS,
    readFile: inlineReadFile(files),
    run: (cmd) => {
      if (cmd === "df") {
        return [
          "Filesystem 1024-blocks Used Available Capacity Mounted on",
          "/dev/sda1 100 20 80 20% /",
        ].join("\n");
      }
      return "0 * * * * /synthetic/hourly";
    },
    uptime: () => 1_000,
    loadavg: () => [0, 0, 0],
    now,
  });

  assert.equal(snapshot.bots.source, "box:status");
  assert.equal(snapshot.money.source, "box:buffett");
  assert.equal(snapshot.health.source, "box:arnold");
  assert.equal(snapshot.host.source, "box:host");
  assert.equal(snapshot.apple.source, "mac:not-wired");
});

test("summarize counts top-level data without exposing data values", () => {
  const snapshot: Snapshot = {
    bots: {
      data: { bots: [{ bot: "Buffett" }], board: 3 },
      updatedAt: "2026-10-31T10:00:00.000Z",
      source: "box:status",
    },
    money: {
      data: [{ amount: 10 }, { amount: 20 }],
      updatedAt: "2026-10-31T10:01:00.000Z",
      source: "box:buffett",
    },
    health: {
      data: { sleep: 8, recovery: 90 },
      updatedAt: "2026-10-31T10:02:00.000Z",
      source: "box:arnold",
    },
    host: {
      data: null,
      updatedAt: "2026-10-31T10:03:00.000Z",
      source: "box:host",
      error: "commands unavailable",
    },
    apple: {
      data: null,
      updatedAt: null,
      source: "mac:not-wired",
    },
  };

  const summary = summarize(snapshot);

  assert.deepEqual(summary.bots, {
    ok: true,
    updatedAt: "2026-10-31T10:00:00.000Z",
    source: "box:status",
    count: 2,
  });
  assert.equal(summary.money.count, 2);
  assert.equal(summary.health.count, 2);
  assert.deepEqual(summary.host, {
    ok: false,
    updatedAt: "2026-10-31T10:03:00.000Z",
    source: "box:host",
    count: 0,
    error: "commands unavailable",
  });
  assert.deepEqual(summary.apple, {
    ok: false,
    updatedAt: null,
    source: "mac:not-wired",
    count: 0,
  });

  for (const entry of Object.values(summary)) {
    assert.equal(Object.hasOwn(entry, "data"), false);
  }
});

test("planKvPut returns the exact wrangler argv", () => {
  assert.deepEqual(planKvPut("/tmp/synthetic-feeds.json"), [
    "wrangler",
    "kv",
    "key",
    "put",
    "feeds",
    "--binding",
    "FEEDS_KV",
    "--remote",
    "--path",
    "/tmp/synthetic-feeds.json",
  ]);
});
