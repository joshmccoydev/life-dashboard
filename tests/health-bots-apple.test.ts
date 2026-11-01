import test from "node:test";
import assert from "node:assert/strict";
import {
  HEALTH_ALLOWED_KEYS,
  buildApple,
  buildBots,
  buildSnapshot,
  summarize,
  summarizeHealth,
  type Entry,
  type Snapshot,
} from "../scripts/produce-feeds.ts";

const HOUR_MS = 60 * 60 * 1_000;
const NOW = new Date("2026-10-31T12:00:00.000Z");
const STATUS_PATH = "/synthetic/vault/Status.md";
const BOARD_PATH = "/synthetic/vault/Board.md";
const HEALTH_PATH = "/synthetic/exports/arnold-dash.json";
const APPLE_PATH = "/synthetic/exports/apple-dash.json";

function emptyEntry(source: string): Entry {
  return { data: null, updatedAt: null, source };
}

function snapshotWithBots(bots: Entry): Snapshot {
  return {
    bots,
    money: emptyEntry("box:buffett"),
    health: emptyEntry("box:arnold"),
    host: emptyEntry("box:host"),
    apple: emptyEntry("mac:not-wired"),
  };
}

test("summarizeHealth strips extra health fields and normalizes booleans", () => {
  const privateValues = {
    note: "synthetic-private-note-value",
    heartRate: "synthetic-private-heart-rate-value",
    weightKg: "synthetic-private-weight-value",
    meds: "synthetic-private-meds-value",
    updatedAt: "2026-10-31T11:00:00.000Z",
  };
  const output = summarizeHealth({
    trainingDoneToday: true,
    streak: { days: 9 },
    nextSession: "Synthetic mobility session",
    note: privateValues.note,
    heart_rate: privateValues.heartRate,
    weight_kg: privateValues.weightKg,
    meds: privateValues.meds,
    updated_at: privateValues.updatedAt,
  });

  const outputKeys = Object.keys(output);
  assert.ok(
    outputKeys.every((key) =>
      (HEALTH_ALLOWED_KEYS as readonly string[]).includes(key),
    ),
  );
  assert.equal(output.trainingDoneToday, "y");
  assert.equal(Object.hasOwn(output, "lastWeighIn"), false);

  const serialized = JSON.stringify(output);
  for (const forbidden of [
    "note",
    "heart_rate",
    "weight_kg",
    "meds",
    "updated_at",
    ...Object.values(privateValues),
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("summarizeHealth includes lastWeighIn only when the source has one", () => {
  const withoutWeight = summarizeHealth({
    training_done_today: false,
    streak: 4,
    next_session: "Synthetic recovery session",
  });
  const withWeight = summarizeHealth({
    training_done_today: "yes",
    last_weigh_in: 183.25,
  });

  assert.equal(Object.hasOwn(withoutWeight, "lastWeighIn"), false);
  assert.equal(withWeight.trainingDoneToday, "y");
  assert.equal(withWeight.lastWeighIn, 183.25);
});

test("buildSnapshot limits health data to the exported allowlist", () => {
  const health = {
    training_done_today: true,
    streak: 6,
    next_session: "Synthetic strength session",
    last_weigh_in: 182.5,
    note: "synthetic-snapshot-note",
    heart_rate: 77,
    weight_kg: 82.8,
    meds: ["synthetic-med-a"],
    updated_at: "2026-10-31T11:30:00.000Z",
  };
  const files = new Map([[HEALTH_PATH, JSON.stringify(health)]]);
  const snapshot = buildSnapshot({
    paths: { health: HEALTH_PATH },
    readFile: (path) => {
      const contents = files.get(path);
      if (contents === undefined) {
        throw new Error(`synthetic file missing: ${path}`);
      }
      return contents;
    },
    run: () => "",
    uptime: () => 0,
    loadavg: () => [0, 0, 0],
    now: NOW,
  });

  const healthData = snapshot.health.data;
  assert.ok(healthData !== null && typeof healthData === "object");
  assert.equal(Array.isArray(healthData), false);
  assert.ok(
    Object.keys(healthData).every((key) =>
      (HEALTH_ALLOWED_KEYS as readonly string[]).includes(key),
    ),
  );
});

test("fresh Status stays healthy without reading Board", () => {
  const readFile = (path: string): string => {
    if (path === BOARD_PATH) {
      throw new Error("synthetic Board reads are forbidden");
    }
    assert.equal(path, STATUS_PATH);
    return "## Arnold\nupdated: 2026-10-31T10:00:00.000Z";
  };
  const stat = (path: string) => {
    assert.equal(path, STATUS_PATH);
    return { mtime: new Date(NOW.getTime() - HOUR_MS) };
  };

  const bots = buildBots({ status: STATUS_PATH }, readFile, stat, NOW);
  const summary = summarize(snapshotWithBots(bots)).bots;

  assert.equal(summary.ok, true);
  assert.equal(Object.hasOwn(summary, "error"), false);
});

test("stale Status is unhealthy after 25 hours", () => {
  const readFile = (path: string): string => {
    if (path === BOARD_PATH) {
      throw new Error("synthetic Board reads are forbidden");
    }
    assert.equal(path, STATUS_PATH);
    return "## Arnold\nupdated: 2026-10-30T11:00:00.000Z";
  };
  const stat = (path: string) => {
    assert.equal(path, STATUS_PATH);
    return { mtime: new Date(NOW.getTime() - 25 * HOUR_MS) };
  };

  const bots = buildBots({ status: STATUS_PATH }, readFile, stat, NOW);
  const summary = summarize(snapshotWithBots(bots)).bots;

  assert.notEqual(bots.data, null);
  assert.equal(summary.ok, false);
  assert.equal(summary.error, "status stale");
});

test("missing Status is unhealthy", () => {
  const readFile = (path: string): string => {
    assert.equal(path, STATUS_PATH);
    throw new Error("synthetic Status file missing");
  };
  const stat = () => {
    throw new Error("synthetic Status stat should not run");
  };

  const bots = buildBots({ status: STATUS_PATH }, readFile, stat, NOW);
  const summary = summarize(snapshotWithBots(bots)).bots;

  assert.equal(summary.ok, false);
  assert.equal(summary.error, "status missing");
});

test("missing apple export summarizes as not connected", () => {
  const apple = buildApple({ apple: APPLE_PATH }, () => {
    throw new Error("synthetic apple file missing");
  });
  const summary = summarize({
    ...snapshotWithBots(emptyEntry("box:status")),
    apple,
  });

  assert.deepEqual(apple, {
    data: null,
    updatedAt: null,
    source: "mac:not-wired",
    note: "not connected",
  });
  assert.equal(
    (summary.apple as typeof summary.apple & { note?: string }).note,
    "not connected",
  );
});
