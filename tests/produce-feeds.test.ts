import test from "node:test";
import assert from "node:assert/strict";
import {
  buildApple,
  buildBots,
  buildHost,
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
    },
    {
      bot: "Arnold",
      updated: "2026-10-31T09:00:00.000Z",
      working_on: "Recovery plan",
      last_done: "Completed the workout",
      next_up: "Sleep",
      needs_josh: null,
    },
  ]);
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

test("buildBots keeps parsed bots and notes a missing board", () => {
  const status = [
    "## Buffett",
    "updated: 2026-10-31T08:00:00.000Z",
    "working_on: Reviewing filings",
  ].join("\n");
  const entry = buildBots(
    PATHS,
    inlineReadFile({
      [PATHS.status]: status,
    }),
  );

  assert.equal(entry.source, "box:status");
  assert.deepEqual(entry.data, {
    bots: parseStatus(status),
    board: null,
  });
  assert.match(entry.error ?? "", /board missing/i);
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
    disk: { usedPct: null },
    crons: null,
  });
});

test("buildApple marks a missing apple export as not wired", () => {
  const entry = buildApple(PATHS, inlineReadFile({}));

  assert.deepEqual(entry, {
    data: null,
    updatedAt: null,
    source: "mac:not-wired",
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
