import test, { before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  main,
  mergeForPublish,
  type Entry,
  type Snapshot,
} from "../scripts/produce-feeds.ts";
import { mergeFeeds } from "../src/lib/feed-store.ts";

const DOMAINS = ["bots", "money", "health", "host", "apple"] as const;
const NEW_UPDATED_AT = "2026-11-01T16:20:00.000Z";
const OLD_UPDATED_AT = "2026-10-01T00:00:00.000Z";
const NOW = new Date("2026-11-01T16:30:00.000Z");

type Domain = (typeof DOMAINS)[number];
type Source = "box" | "mac";

type StoredEntry = {
  data: unknown;
  updatedAt: string | null;
  stale: boolean;
  source: Source | null;
};

before(() => {
  assert.equal(
    typeof mergeForPublish,
    "function",
    "mergeForPublish must be exported before these tests run",
  );
});

function entry(data: unknown, source = "box"): Entry {
  return { data, updatedAt: NEW_UPDATED_AT, source };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    bots: entry({ bot: "synthetic" }),
    money: entry({ cashOnHand: 1234 }),
    health: entry({ streak: 7 }),
    host: entry({ uptime: "2 hours" }),
    apple: entry({ calendar: ["synthetic"] }, "mac"),
    ...overrides,
  };
}

function oldEntry(): StoredEntry {
  return {
    data: { old: true },
    updatedAt: OLD_UPDATED_AT,
    stale: false,
    source: "box",
  };
}

function oldFeeds(): Record<Domain, StoredEntry> {
  return {
    bots: oldEntry(),
    money: oldEntry(),
    health: oldEntry(),
    host: oldEntry(),
    apple: oldEntry(),
  };
}

function inMemoryKv(existing: unknown | null) {
  const puts: string[] = [];
  return {
    puts,
    deps: {
      kvGet: () => (existing === null ? null : JSON.stringify(existing)),
      kvPut: (json: string) => {
        puts.push(json);
      },
      out: (_line: string) => undefined,
    },
  };
}

function restoreExitCode(t: TestContext): void {
  const original = process.exitCode;
  t.after(() => {
    process.exitCode = original;
  });
}

function expectedPayloadEntry(current: Entry, source: "box" | "mac") {
  return {
    data: current.data,
    updatedAt: current.updatedAt,
    stale: false,
    source,
  };
}

test("main publishes available domains and retains failed existing domains", (t) => {
  restoreExitCode(t);

  const current = snapshot({
    money: {
      data: null,
      updatedAt: null,
      source: "box:buffett",
      error: "synthetic money read failure",
    },
    apple: {
      data: null,
      updatedAt: null,
      source: "mac:not-wired",
      note: "not connected",
    },
  });
  const existing = oldFeeds();
  const kv = inMemoryKv(existing);

  const code = main([], { ...kv.deps, build: () => current });

  assert.equal(code, 0);
  assert.equal(process.exitCode, 0);
  assert.equal(kv.puts.length, 1);

  const written = JSON.parse(kv.puts[0]) as Record<Domain, StoredEntry>;
  assert.deepEqual(written.money, existing.money);
  assert.deepEqual(written.apple, existing.apple);
  assert.deepEqual(written.bots, expectedPayloadEntry(current.bots, "box"));
  assert.deepEqual(written.health, expectedPayloadEntry(current.health, "box"));
  assert.deepEqual(written.host, expectedPayloadEntry(current.host, "box"));

  const parsed = mergeFeeds(null, JSON.parse(kv.puts[0]), NOW);
  assert.deepEqual(parsed.money.data, { old: true });
});

test("main skips publication when every domain is down", (t) => {
  restoreExitCode(t);

  const unavailable = (source: string): Entry => ({
    data: null,
    updatedAt: null,
    source,
  });
  const kv = inMemoryKv(null);
  const current = snapshot({
    bots: unavailable("box"),
    money: unavailable("box"),
    health: unavailable("box"),
    host: unavailable("box"),
    apple: unavailable("mac"),
  });

  const code = main([], { ...kv.deps, build: () => current });

  assert.equal(code, 1);
  assert.equal(process.exitCode, 1);
  assert.equal(kv.puts.length, 0);
});

test("main writes only available domains when the key is absent", (t) => {
  restoreExitCode(t);

  const unavailable = (source: string): Entry => ({
    data: null,
    updatedAt: null,
    source,
  });
  const current = snapshot({
    bots: entry({ bot: "available" }),
    money: entry({ cashOnHand: 900 }),
    health: unavailable("box"),
    host: unavailable("box"),
    apple: unavailable("mac"),
  });
  const kv = inMemoryKv(null);

  const code = main([], { ...kv.deps, build: () => current });

  assert.equal(code, 0);
  assert.equal(kv.puts.length, 1);
  const written = JSON.parse(kv.puts[0]) as Record<string, StoredEntry>;
  assert.deepEqual(Object.keys(written).sort(), ["bots", "money"]);
  assert.deepEqual(written.bots, expectedPayloadEntry(current.bots, "box"));
  assert.deepEqual(written.money, expectedPayloadEntry(current.money, "box"));
});

test("main returns 1 without writing when the KV read fails", (t) => {
  restoreExitCode(t);

  let putCalls = 0;
  const code = main([], {
    kvGet: () => {
      throw new Error("synthetic KV read failure");
    },
    kvPut: () => {
      putCalls += 1;
    },
    build: () => snapshot(),
    out: (_line: string) => undefined,
  });

  assert.equal(code, 1);
  assert.equal(process.exitCode, 1);
  assert.equal(putCalls, 0);
});

test("main dry-run exits 0 without reading or writing KV", (t) => {
  restoreExitCode(t);

  const code = main(["--dry-run"], {
    kvGet: () => {
      assert.fail("dry-run must not call kvGet");
    },
    kvPut: () => {
      assert.fail("dry-run must not call kvPut");
    },
    build: () => snapshot(),
    out: (_line: string) => undefined,
  });

  assert.equal(code, 0);
  assert.equal(process.exitCode, 0);
});

test("mergeForPublish preserves extra keys and reports each domain", () => {
  const existing = {
    ...oldFeeds(),
    extra: { preserved: true },
  };
  const current = snapshot({
    money: { data: null, updatedAt: null, source: "box:buffett" },
    health: { data: null, updatedAt: null, source: "box:arnold" },
    host: { data: null, updatedAt: null, source: "box:host" },
    apple: { data: null, updatedAt: null, source: "mac:not-wired" },
  });

  const result = mergeForPublish(existing, current);

  assert.deepEqual(result.published, ["bots"]);
  assert.deepEqual(result.kept, ["money", "health", "host", "apple", "decisions", "usage", "weather", "build"]);
  assert.deepEqual(result.payload.extra, { preserved: true });
  assert.deepEqual(
    result.payload.bots,
    expectedPayloadEntry(current.bots, "box"),
  );
  assert.deepEqual(result.payload.money, existing.money);
});
