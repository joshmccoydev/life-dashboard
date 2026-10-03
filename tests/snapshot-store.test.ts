import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  DashboardData,
  DataState,
  Domain,
} from "../src/domains/models";
import { createCollector, type CacheLike } from "../src/server/collector";
import {
  createSnapshotStore,
  loadSnapshot,
  saveSnapshot,
} from "../src/server/snapshot-store";

const DOMAINS: Domain[] = [
  "weather",
  "calendar",
  "reminders",
  "finance",
  "health",
  "build",
  "ai",
  "systems",
  "habits",
  "goals",
];
const FIXED = "2026-10-03T12:00:00.000Z";

let originalFetch: typeof fetch;
before(() => {
  originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = (() => {
    throw new Error("network forbidden in tests");
  }) as typeof fetch;
});
after(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

function state<T>(
  data: T | null,
  overrides: Partial<DataState<T>> = {},
): DataState<T> {
  return {
    loading: false,
    data,
    source: "real",
    provider: "test",
    status: data === null ? "error" : "ready",
    lastSuccess: data === null ? null : FIXED,
    lastAttempt: FIXED,
    error: data === null ? "no data" : null,
    refreshMs: 1000,
    ...overrides,
  };
}

function dashboard(
  overrides: Partial<Record<Domain, DataState<unknown>>> = {},
): DashboardData {
  const data = {} as Record<Domain, DataState<unknown>>;
  for (const domain of DOMAINS)
    data[domain] = domain === "finance" ? state(null) : state({ domain });
  Object.assign(data, overrides);
  return data as DashboardData;
}

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "cto-0014-snapshot-"));
}

test("round-trips persistable states through snapshot.json", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await saveSnapshot(dir, {
    data: dashboard(),
    serverTime: FIXED,
    seq: 4,
    history: [{ cpu: 22, memory: 31, disk: 40 }],
  });
  const loaded = await loadSnapshot(dir);
  assert.ok(loaded);
  assert.deepEqual(
    Object.keys(loaded.data).sort(),
    DOMAINS.filter((domain) => domain !== "finance").sort(),
  );
  assert.deepEqual(loaded.data.weather?.data, { domain: "weather" });
  assert.equal(loaded.seq, 4);
  assert.deepEqual(loaded.history, [{ cpu: 22, memory: 31, disk: 40 }]);
});

test("mock-source and null states are never written", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await saveSnapshot(dir, {
    data: dashboard({
      finance: state({ fixture: "mock" }, { source: "mock" }),
      calendar: state(null),
      health: state({ steps: 1 }, { lastSuccess: null }),
    }),
    serverTime: FIXED,
    seq: 1,
    history: [],
  });
  const stored = JSON.parse(
    await readFile(path.join(dir, "snapshot.json"), "utf8"),
  ) as { data: Record<string, unknown> };
  assert.equal("finance" in stored.data, false);
  assert.equal("calendar" in stored.data, false);
  assert.equal("health" in stored.data, false);
  const loaded = await loadSnapshot(dir);
  assert.ok(loaded);
  assert.equal("finance" in loaded.data, false);
  assert.equal("calendar" in loaded.data, false);
  assert.equal("health" in loaded.data, false);
  assert.ok(loaded.data.weather);
});

test("loadSnapshot drops persisted non-real domains", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(
    path.join(dir, "snapshot.json"),
    JSON.stringify({
      version: 1,
      serverTime: FIXED,
      data: {
        weather: state({ domain: "weather" }, { source: "mock" }),
        calendar: state({ domain: "calendar" }),
      },
    }),
  );
  const loaded = await loadSnapshot(dir);
  assert.ok(loaded);
  assert.equal("weather" in loaded.data, false);
  assert.ok(loaded.data.calendar);
});

test("missing, empty, truncated and wrong-version files return null", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "snapshot.json");
  assert.equal(await loadSnapshot(dir), null);
  await writeFile(file, "");
  assert.equal(await loadSnapshot(dir), null);
  await writeFile(file, '{"version":1,"data":{"weather":');
  assert.equal(await loadSnapshot(dir), null);
  await writeFile(file, JSON.stringify({ version: 2, data: {} }));
  assert.equal(await loadSnapshot(dir), null);
  // A wrong version must be rejected even when its payload looks valid.
  await writeFile(
    file,
    JSON.stringify({
      version: 2,
      serverTime: FIXED,
      data: { weather: state({ domain: "weather" }) },
    }),
  );
  assert.equal(await loadSnapshot(dir), null);
  await writeFile(file, JSON.stringify({ version: 1, data: {} }));
  assert.equal(await loadSnapshot(dir), null);
});

test("atomic write leaves no .tmp file behind", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await saveSnapshot(dir, { data: dashboard(), serverTime: FIXED });
  const files = await readdir(dir);
  assert.deepEqual(files, ["snapshot.json"]);
});

test("snapshot.json is swapped in place (atomic tmp+rename, not truncate-write)", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "snapshot.json");
  await saveSnapshot(dir, {
    data: dashboard(),
    serverTime: FIXED,
    seq: 1,
  });
  const first = await stat(file);
  await saveSnapshot(dir, {
    data: dashboard({ weather: state({ domain: "weather", n: 2 }) }),
    serverTime: FIXED,
    seq: 2,
  });
  const second = await stat(file);
  // A rename swaps a freshly written file into place, so the inode changes. A
  // direct truncate-write would keep the same inode.
  assert.notEqual(first.ino, second.ino);
  assert.deepEqual(await readdir(dir), ["snapshot.json"]);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("restart seeds the next snapshot with stale-flagged values", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const seeded = state(
    { domain: "calendar" },
    { lastSuccess: "2026-10-01T00:00:00.000Z" },
  );
  await saveSnapshot(dir, {
    data: dashboard({ calendar: seeded }),
    serverTime: "2026-10-01T00:00:00.000Z",
    seq: 8,
    history: [{ cpu: 11, memory: 22, disk: 33 }],
  });

  const calls = {} as Record<Domain, number>;
  const caches = {} as Record<Domain, CacheLike>;
  for (const domain of DOMAINS) {
    calls[domain] = 0;
    caches[domain] = {
      async get() {
        calls[domain] += 1;
        if (domain === "calendar") throw new Error("calendar offline");
        return state({ domain });
      },
    };
  }
  const collector = createCollector({
    caches,
    store: createSnapshotStore(dir),
    now: () => new Date(FIXED),
  });
  const snapshot = await collector.tick();
  assert.ok(snapshot);
  assert.deepEqual(snapshot.data.calendar.data, { domain: "calendar" });
  assert.equal(snapshot.data.calendar.status, "stale");
  assert.ok(snapshot.seq > 8, `seq did not advance past the persisted 8`);
  assert.deepEqual(snapshot.history.systems, [
    { cpu: 11, memory: 22, disk: 33 },
  ]);
  assert.equal(collector.latest()?.data.calendar.status, "stale");
});
