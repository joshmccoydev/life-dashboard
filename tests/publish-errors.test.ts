import test from "node:test";
import assert from "node:assert/strict";
import {
  main,
  mergeForPublish,
  type Entry,
  type Snapshot,
} from "../scripts/produce-feeds.ts";

const UPDATED_AT = "2026-11-01T16:20:00.000Z";

function entry(data: unknown, source = "box"): Entry {
  return { data, updatedAt: UPDATED_AT, source };
}

function unavailable(source: string): Entry {
  return { data: null, updatedAt: null, source };
}

test("mergeForPublish retains an existing entry when its snapshot has an error", () => {
  const oldBots = {
    data: { bots: [{ bot: "Existing Bot" }] },
    updatedAt: "2026-10-01T00:00:00.000Z",
    stale: false,
    source: "box",
  };
  const snapshot: Snapshot = {
    bots: {
      ...entry({ bots: [] }, "box:status"),
      error: "status stale",
    },
    money: entry({ cashOnHand: 900 }, "box:buffett"),
    health: unavailable("box:arnold"),
    host: unavailable("box:host"),
    apple: unavailable("mac:not-wired"),
  };

  const result = mergeForPublish({ bots: oldBots }, snapshot);

  assert.equal(result.published.includes("bots"), false);
  assert.equal(result.kept.includes("bots"), true);
  assert.deepEqual(result.payload.bots, oldBots);
});

test("main does not write when every domain with data has an error", (t) => {
  const originalExitCode = process.exitCode;
  t.after(() => {
    process.exitCode = originalExitCode;
  });

  const snapshot: Snapshot = {
    bots: {
      ...entry({ bots: [] }, "box:status"),
      error: "status stale",
    },
    money: unavailable("box:buffett"),
    health: unavailable("box:arnold"),
    host: unavailable("box:host"),
    apple: unavailable("mac:not-wired"),
  };
  let putCalls = 0;

  const code = main([], {
    build: () => snapshot,
    kvGet: () => null,
    kvPut: () => {
      putCalls += 1;
    },
    out: (_line: string) => undefined,
  });

  assert.equal(code, 1);
  assert.equal(putCalls, 0);
});
