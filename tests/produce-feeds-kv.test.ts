import test from "node:test";
import assert from "node:assert/strict";
import * as produceFeeds from "../scripts/produce-feeds.ts";
import { mergeFeeds } from "../src/lib/feed-store.ts";
import type { Snapshot } from "../scripts/produce-feeds.ts";

const DOMAINS = ["bots", "money", "health", "host", "apple"] as const;
const NOW = new Date("2026-11-01T16:30:00.000Z");
const PATHS = {
  status: "/synthetic/vault/Status.md",
  board: "/synthetic/vault/Board.md",
  money: "/synthetic/exports/buffett-dash.json",
  health: "/synthetic/exports/arnold-dash.json",
  apple: "/synthetic/exports/apple-dash.json",
};

type Domain = (typeof DOMAINS)[number];
type ReadFile = (path: string) => string | Buffer;
type Stat = (path: string) => { mtime: Date };
type PayloadEntry = {
  data: unknown;
  updatedAt: string | null;
  stale: boolean;
  source: "box" | "mac" | null;
};
type ToKvPayload = (snapshot: Snapshot) => Record<Domain, PayloadEntry>;

function inlineReadFile(files: Record<string, string>): ReadFile {
  return (filePath) => {
    if (!Object.hasOwn(files, filePath)) {
      const error = new Error(
        `ENOENT: synthetic file missing: ${filePath}`,
      ) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return files[filePath];
  };
}

function requireToKvPayload(): ToKvPayload {
  const candidate = (
    produceFeeds as typeof produceFeeds & { toKvPayload?: ToKvPayload }
  ).toKvPayload;

  assert.equal(typeof candidate, "function", "toKvPayload must be exported");
  if (typeof candidate !== "function") assert.fail("toKvPayload is missing");
  return candidate;
}

function snapshotFromFiles(files: Record<string, string>): Snapshot {
  return produceFeeds.buildSnapshot({
    paths: PATHS,
    readFile: inlineReadFile(files),
    run: (cmd) => {
      if (cmd === "df") {
        return [
          "Filesystem 1024-blocks Used Available Capacity Mounted on",
          "/dev/sda1 100 25 75 25% /",
        ].join("\n");
      }
      if (cmd === "crontab") return "0 * * * * /synthetic/hourly";
      throw new Error(`unexpected synthetic command: ${cmd}`);
    },
    uptime: () => 12_345,
    loadavg: () => [0.1, 0.2, 0.3],
    now: NOW,
  });
}

function syntheticSnapshot(): Snapshot {
  return snapshotFromFiles({
    [PATHS.status]: [
      "## Buffett",
      "updated: 2026-11-01T16:20:00.000Z",
      "working_on: Reviewing the synthetic ledger",
    ].join("\n"),
    [PATHS.board]: "# Synthetic board\nFirst line\nSecond line",
    [PATHS.money]: JSON.stringify({
      updated_at: "2026-11-01T16:15:00.000Z",
      cash_on_hand: { amount: 1250 },
      next_bills: [{ amount: 125 }, { amount: "75" }],
      deposit_goal: { target: 500 },
      alerts: [],
    }),
    [PATHS.health]: JSON.stringify({
      updated_at: "2026-11-01T16:10:00.000Z",
      recovery: 82,
    }),
    [PATHS.apple]: JSON.stringify({
      updated_at: "2026-11-01T16:05:00.000Z",
      calendar: [{ title: "Synthetic event" }],
      reminders: [{ title: "Synthetic reminder" }],
      habits: [{ name: "Synthetic habit" }],
      goals: [{ name: "Synthetic goal" }],
      extra: "must not reach the feed",
    }),
  });
}

test("toKvPayload emits feed-store entries and preserves money data", () => {
  const snapshot = syntheticSnapshot();
  const payload = requireToKvPayload()(snapshot);

  for (const domain of DOMAINS) {
    assert.deepEqual(
      Object.keys(payload[domain]).sort(),
      ["data", "source", "stale", "updatedAt"],
      `${domain} must have the exact FeedEntry keys`,
    );
    assert.equal(payload[domain].stale, false, `${domain}.stale`);
    assert.equal(
      payload[domain].source,
      domain === "apple" ? "mac" : "box",
      `${domain}.source`,
    );
  }

  assert.notEqual(snapshot.money.data, null);
  const merged = mergeFeeds(null, payload, NOW);
  assert.notEqual(merged.money.data, null);
  assert.deepEqual(merged.money.data, snapshot.money.data);
});

test("toKvPayload maps missing money and apple files to unavailable entries", () => {
  const snapshot = snapshotFromFiles({
    [PATHS.status]: "## Buffett\nupdated: 2026-11-01T16:20:00.000Z",
    [PATHS.board]: "First line\nSecond line",
    [PATHS.health]: JSON.stringify({
      updated_at: "2026-11-01T16:10:00.000Z",
      recovery: 82,
    }),
  });
  const payload = requireToKvPayload()(snapshot);
  const unavailableEntry = {
    data: null,
    updatedAt: null,
    stale: false,
    source: null,
  };

  assert.match(snapshot.money.error ?? "", /ENOENT/);
  assert.deepEqual(payload.money, unavailableEntry);
  assert.deepEqual(payload.apple, unavailableEntry);
  assert.notEqual(payload.health.data, null);
  assert.equal(payload.health.source, "box");
});

test("buildApple passes only the four allowlisted data keys", () => {
  const readFile = inlineReadFile({
    [PATHS.apple]: JSON.stringify({
      calendar: [1],
      reminders: [],
      extra: "x",
    }),
  });

  const entry = produceFeeds.buildApple(PATHS, readFile);
  assert.ok(entry.data !== null && typeof entry.data === "object");
  const data = entry.data as Record<string, unknown>;

  assert.deepEqual(Object.keys(data).sort(), [
    "calendar",
    "goals",
    "habits",
    "reminders",
  ]);
  assert.deepEqual(data, {
    calendar: [1],
    reminders: { as_of: null, items: [] },
    habits: { as_of: null, habits: [] },
    goals: { as_of: null, goals: [] },
  });
  assert.equal(Object.hasOwn(data, "extra"), false);
});

test("buildBots uses the injected status file mtime", () => {
  const readFile = inlineReadFile({
    [PATHS.status]: "## Buffett\nupdated: 2026-11-01T16:20:00.000Z",
    [PATHS.board]: "First line\nSecond line",
  });
  const mtime = new Date("2026-11-01T16:25:00.000Z");
  let statPath: string | null = null;
  const stat: Stat = (filePath) => {
    statPath = filePath;
    return { mtime };
  };
  const buildBotsWithStat = produceFeeds.buildBots as unknown as (
    paths: typeof PATHS,
    readFile: ReadFile,
    stat: Stat,
  ) => { updatedAt: string | null };

  const entry = buildBotsWithStat(PATHS, readFile, stat);

  assert.equal(statPath, PATHS.status);
  assert.equal(entry.updatedAt, mtime.toISOString());
});
