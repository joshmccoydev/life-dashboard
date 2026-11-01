import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldPublish,
  summarizeMoney,
  type Entry,
  type Snapshot,
} from "../scripts/produce-feeds.ts";

function entry(data: unknown): Entry {
  return {
    data,
    updatedAt: "2026-11-01T12:00:00.000Z",
    source: "synthetic:test",
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    bots: entry({ bots: [{ bot: "Synthetic bot" }] }),
    money: entry({ depositTarget: 1000 }),
    health: entry({ streak: 4 }),
    host: entry({ uptime: "1 hour" }),
    apple: entry({ location: "Synthetic location" }),
    ...overrides,
  };
}

test("shouldPublish allows data for wired domains with an unwired Apple feed", () => {
  assert.deepEqual(shouldPublish(snapshot({ apple: entry(null) })), {
    ok: true,
    failed: [],
  });
});

test("shouldPublish reports missing money data", () => {
  assert.deepEqual(shouldPublish(snapshot({ money: entry(null) })), {
    ok: false,
    failed: ["money"],
  });
});

test("shouldPublish reports every missing required domain", () => {
  assert.deepEqual(
    shouldPublish(snapshot({ health: entry(null), host: entry(null) })),
    {
      ok: false,
      failed: ["health", "host"],
    },
  );
});

test("summarizeMoney nulls non-finite deposit targets", () => {
  for (const target of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const summary = summarizeMoney({ deposit_goal: { target } });
    assert.equal(summary.depositTarget, null);
  }
});
