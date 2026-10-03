import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  DataState,
  Domain,
  SystemState,
} from "../src/domains/models";
import { createCollector, type CacheLike } from "../src/server/collector";
import { createHistory } from "../src/server/history";
import {
  createSnapshotStore,
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

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

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

function systemSample(metric: number): SystemState {
  return {
    machine: {
      id: "machine",
      name: "Host",
      status: "online",
      latencyMs: null,
      uptimeSeconds: null,
      cpuPercent: metric,
      memoryPercent: metric,
      diskPercent: metric,
    },
    endpoints: [],
  };
}

function makeCaches(
  overrides: Partial<Record<Domain, CacheLike>> = {},
): { caches: Record<Domain, CacheLike>; calls: Record<Domain, number> } {
  const calls = {} as Record<Domain, number>;
  const caches = {} as Record<Domain, CacheLike>;
  for (const domain of DOMAINS) {
    calls[domain] = 0;
    caches[domain] = {
      async get() {
        calls[domain] += 1;
        return domain === "finance" ? state(null) : state({ domain });
      },
    };
  }
  Object.assign(caches, overrides);
  return { caches, calls };
}

test("tick() calls get(now) on every domain", async () => {
  const { caches, calls } = makeCaches();
  const collector = createCollector({ caches, now: () => new Date(FIXED) });
  const pending = collector.tick();
  for (let i = 0; i < 200 && !collector.latest(); i += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  const snapshot = collector.latest() ?? (await pending);
  for (const domain of DOMAINS) assert.equal(calls[domain], 1);
  assert.ok(snapshot!.seq >= Date.parse(FIXED));
  assert.deepEqual(Object.keys(snapshot!.data).sort(), [...DOMAINS].sort());
});

test("one rejecting domain keeps its previous state and does not block others", async () => {
  let systemsCalls = 0;
  const { caches } = makeCaches({
    systems: {
      async get() {
        systemsCalls += 1;
        if (systemsCalls === 1) return state(systemSample(10));
        throw new Error("systems down");
      },
    },
  });
  const collector = createCollector({ caches, now: () => new Date(FIXED) });
  const first = await collector.tick();
  assert.ok(first?.data.systems.data);
  const second = await collector.tick();
  assert.deepEqual(second?.data.systems, first?.data.systems);
  assert.ok(second?.data.weather.data);
});

test("a hanging domain times out without blocking the other domains", async () => {
  let hanging = false;
  const { caches } = makeCaches({
    calendar: {
      get: () =>
        hanging
          ? new Promise<DataState<unknown>>(() => {})
          : Promise.resolve(state({ domain: "calendar" })),
    },
  });
  const collector = createCollector({
    caches,
    now: () => new Date(FIXED),
    domainTimeoutMs: 5,
  });
  const first = await collector.tick();
  hanging = true;
  const snapshot = await collector.tick();
  assert.ok(snapshot);
  assert.ok(snapshot.data.weather.data);
  assert.deepEqual(snapshot.data.calendar, first?.data.calendar);
});

test("overlapping tick() calls never double-fetch an in-flight domain", async () => {
  const releases: (() => void)[] = [];
  const { caches } = makeCaches({
    weather: {
      get: () =>
        new Promise<DataState<unknown>>((resolve) =>
          releases.push(() => resolve(state({ ok: true }))),
        ),
    },
  });
  const collector = createCollector({ caches, now: () => new Date(FIXED) });
  const pending = collector.tick();
  for (let i = 0; i < 50 && releases.length === 0; i += 1) await flush();
  assert.equal(releases.length, 1, "weather cache was never called once");
  const second = collector.tick();
  await flush();
  const callsDuringOverlap = releases.length;
  releases.forEach((release) => release());
  const [done] = await Promise.all([pending, second]);
  assert.equal(callsDuringOverlap, 1, "a second tick re-fetched an in-flight domain");
  assert.ok(done);
  assert.ok(done.seq >= 1);
});

test("seq increments only when the serialized data changes", async () => {
  let value = 1;
  const { caches } = makeCaches({
    weather: {
      async get() {
        return state({ n: value });
      },
    },
  });
  const collector = createCollector({ caches, now: () => new Date(FIXED) });
  const snapshots: number[] = [];
  collector.subscribe((snapshot) => snapshots.push(snapshot.seq));
  const first = (await collector.tick())!.seq;
  const countAfterFirst = snapshots.length;
  assert.ok(first >= 1);
  assert.equal((await collector.tick())!.seq, first);
  assert.equal(snapshots.length, countAfterFirst, "unchanged data emitted another snapshot");
  value = 2;
  assert.equal((await collector.tick())!.seq, first + 1);
});

test("a failed null refresh preserves a persisted last-known value as stale", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cto-0014-stale-seed-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const saved = state({ marker: "last-good" });
  const store = createSnapshotStore(dir);
  await store.save({ data: { weather: saved } as never, serverTime: FIXED, seq: Date.parse(FIXED) });
  const collector = createCollector({
    caches: makeCaches({ weather: { async get() { return state(null); } } }).caches,
    store,
    now: () => new Date(FIXED),
  });
  await collector.tick();
  assert.deepEqual(collector.latest()?.data.weather.data, { marker: "last-good" });
  assert.equal(collector.latest()?.data.weather.status, "stale");
  for (let i = 0; i < 100 && !(await store.load()); i += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  await new Promise((resolve) => setTimeout(resolve, 25));
});

test("a slow domain does not delay the other domains' snapshots", async () => {
  let releaseSlow: (() => void) | null = null;
  const slow = new Promise<DataState<unknown>>((resolve) => {
    releaseSlow = () => resolve(state({ domain: "calendar" }));
  });
  const { caches } = makeCaches({ calendar: { get: () => slow } });
  const collector = createCollector({ caches, now: () => new Date() });
  (caches.calendar as CacheLike).get = () => slow;
  const published: number[] = [];
  collector.subscribe((event) => published.push(event.data.weather.data ? 1 : 0));
  const started = Date.now();
  const pending = collector.tick();
  for (let i = 0; i < 200 && published.length === 0; i += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(
    published.length > 0,
    "fast domains published no snapshot while one domain was slow",
  );
  assert.ok(Date.now() - started < 1000);
  assert.equal(collector.latest()!.data.calendar.data, null);
  releaseSlow!();
  await pending;
  assert.deepEqual(collector.latest()?.data.calendar.data, { domain: "calendar" });
});

test("a first-tick failure still yields ten keys and a null, real, non-mock domain", async () => {
  const { caches } = makeCaches({
    calendar: { async get() { throw new Error("calendar offline"); } },
  });
  const collector = createCollector({ caches, now: () => new Date(FIXED) });
  const pending = collector.tick();
  for (let i = 0; i < 200 && !collector.latest(); i += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  const snapshot = collector.latest() ?? (await pending);
  assert.ok(snapshot);
  assert.deepEqual(Object.keys(snapshot.data).sort(), [...DOMAINS].sort());
  assert.equal(snapshot.data.calendar.data, null);
  assert.equal(snapshot.data.calendar.source, "real");
  assert.equal(snapshot.data.calendar.status, "error");
  assert.ok(snapshot.data.weather.data);
});

test("seq never goes backwards across a restart with nothing persisted", async () => {
  // A real process restart: fresh module state, same injected wall clock +1s.
  const first = createCollector({
    caches: makeCaches().caches,
    now: () => new Date(FIXED),
  });
  const firstSeq = (await first.tick())!.seq;
  const restarted = createCollector({
    caches: makeCaches().caches,
    now: () => new Date(Date.parse(FIXED) + 1000),
  });
  const secondSeq = (await restarted.tick())!.seq;
  assert.ok(
    secondSeq > firstSeq,
    `seq regressed across restart: ${firstSeq} -> ${secondSeq}`,
  );
});

test("seq stays increasing after persisted state is deleted", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cto-0014-delete-state-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = createCollector({
    caches: makeCaches().caches,
    store: createSnapshotStore(dir),
    now: () => new Date(FIXED),
  });
  const previous = (await first.tick())!.seq;
  for (let i = 0; i < 100 && !(await createSnapshotStore(dir).load()); i += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await rm(dir, { recursive: true, force: true });
  const later = createCollector({
    caches: makeCaches().caches,
    now: () => new Date(Date.parse(FIXED) + 1000),
  });
  assert.ok((await later.tick())!.seq > previous);
});

test("seq does not regress across a real process restart (child processes)", () => {
  const script = (delayMs: number) =>
    `await new Promise((r) => setTimeout(r, ${delayMs}));` +
    'const { createCollector } = await import("./src/server/collector.ts");' +
    "const domains = [" +
    DOMAINS.map((domain) => `"${domain}"`).join(",") +
    "];" +
    "const caches = Object.fromEntries(domains.map((d) => [d, { get: async () => ({ loading: false, data: { d }, source: \"mock\", provider: \"p\", status: \"ready\", lastSuccess: \"2026-10-03T12:00:00.000Z\", lastAttempt: \"2026-10-03T12:00:00.000Z\", error: null, refreshMs: 1000 }) }]));" +
    "const c = createCollector({ caches });" +
    'const s = await c.tick();' +
    'console.log("RESULT:" + JSON.stringify({ seq: s.seq }));';
  const first = runScript(script(0), {});
  const second = runScript(script(20), {});
  assert.ok(
    (second.seq as number) > (first.seq as number),
    `seq regressed: ${first.seq} -> ${second.seq}`,
  );
});

test("start() seeds latest() from the persisted snapshot before the first tick", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cto-0014-seed-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const seeded = state(
    { domain: "weather" },
    { lastSuccess: "2026-10-01T00:00:00.000Z" },
  );
  const store = createSnapshotStore(dir);
  await store.save({
    data: { weather: seeded } as never,
    serverTime: "2026-10-01T00:00:00.000Z",
    seq: 5,
    history: [{ cpu: 1, memory: 2, disk: 3 }],
  });
  // Hold cache refreshes so start() can be inspected after hydration but
  // before any domain has completed its first refresh.
  const caches = makeCaches().caches;
  for (const domain of DOMAINS) caches[domain] = { get: () => new Promise(() => {}) };
  const seededCollector = createCollector({ caches, store, now: () => new Date(FIXED) });
  await seededCollector.start();
  seededCollector.stop();
  const latest = seededCollector.latest();
  assert.ok(latest, "latest() was not seeded at start()");
  assert.deepEqual(latest.data.weather.data, { domain: "weather" });
  assert.equal(latest.data.weather.status, "stale");
  assert.deepEqual(latest.history.systems, [{ cpu: 1, memory: 2, disk: 3 }]);
});

test("a store whose load() throws does not break ticks", async () => {
  const collector = createCollector({
    caches: makeCaches().caches,
    store: {
      dir: "x",
      load: async () => {
        throw new Error("load failed");
      },
      save: async () => {},
    },
    now: () => new Date(FIXED),
  });
  assert.ok(await collector.tick());
});

test("collector_domain_failed and collector_tick_skipped are logged", async () => {
  const logs: string[] = [];
  const original = console.info;
  console.info = (line: unknown) => {
    logs.push(String(line));
  };
  try {
    const { caches } = makeCaches({
      ai: {
        async get() {
          throw new Error("ai offline");
        },
      },
    });
    const collector = createCollector({ caches, now: () => new Date(FIXED) });
    await collector.tick();
    assert.ok(
      logs.some((line) => line.includes("collector_domain_failed")),
      "collector_domain_failed was not logged",
    );
    let release: (() => void) | null = null;
    const blocking = makeCaches({
      weather: {
        get: () =>
          new Promise<DataState<unknown>>((resolve) => {
            release = () => resolve(state({ ok: true }));
          }),
      },
    });
    const second = createCollector({
      caches: blocking.caches,
      now: () => new Date(FIXED),
    });
    const pending = second.tick();
    for (let i = 0; i < 50 && !release; i += 1) await flush();
    await second.tick();
    assert.ok(
      logs.some((line) => line.includes("collector_tick_skipped")),
      "collector_tick_skipped was not logged",
    );
    release!();
    await pending;
  } finally {
    console.info = original;
  }
});

test("snapshot.json is only rewritten when the snapshot changes", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cto-0014-write-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const collector = createCollector({
    caches: makeCaches().caches,
    store: createSnapshotStore(dir),
    now: () => new Date(FIXED),
  });
  const firstTick = collector.tick();
  const file = path.join(dir, "snapshot.json");
  for (let i = 0; i < 200; i += 1) {
    try {
      await access(file);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  await firstTick;
  const first = await readFile(file, "utf8");
  await new Promise((resolve) => setTimeout(resolve, 10));
  await collector.tick();
  assert.equal(await readFile(file, "utf8"), first);
});

test("data: null passes through unchanged and no mock appears in live mode", async () => {
  const { caches } = makeCaches({
    calendar: { async get() { return state(null); } },
  });
  const collector = createCollector({ caches, now: () => new Date(FIXED) });
  const snapshot = await collector.tick();
  assert.equal(snapshot?.data.calendar.data, null);
  assert.equal(snapshot?.data.calendar.source, "real");
  assert.equal(snapshot?.data.calendar.provider, "test");
});

test("start() is idempotent and stop() clears the timer", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let created = 0;
  let cleared = 0;
  let unrefed = 0;
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    created += 1;
    const handle = originalSetInterval(...args) as unknown as {
      unref?: () => void;
    };
    const originalUnref = handle.unref?.bind(handle);
    handle.unref = () => {
      unrefed += 1;
      return originalUnref?.();
    };
    return handle as never;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((handle?: unknown) => {
    cleared += 1;
    return originalClearInterval(handle as never);
  }) as typeof clearInterval;
  try {
    const { caches } = makeCaches();
    const collector = createCollector({ caches, now: () => new Date(FIXED) });
    await collector.start();
    await collector.start();
    assert.equal(created, 1);
    assert.equal(collector.isRunning(), true);
    assert.ok(unrefed >= 1, "collector timer was not unref()ed");
    collector.stop();
    assert.equal(cleared, 1);
    assert.equal(collector.isRunning(), false);
    collector.stop();
    assert.equal(cleared, 1);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    t.mock.timers.reset();
  }
});

test("collector refreshes with zero subscribers and no HTTP requests", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  try {
    const { caches, calls } = makeCaches();
    const collector = createCollector({
      caches,
      now: () => new Date(FIXED),
      tickMs: 5000,
    });
    await collector.start();
    t.mock.timers.tick(5000);
    await flush();
    assert.equal(collector.subscriberCount(), 0);
    for (const domain of DOMAINS) assert.ok(calls[domain] >= 1);
  } finally {
    t.mock.timers.reset();
  }
});

test("history appends one sample per distinct lastAttempt and caps at 18", () => {
  const history = createHistory();
  const attempt = (n: number) =>
    `2026-10-03T00:00:${String(n).padStart(2, "0")}.000Z`;
  for (let i = 1; i <= 19; i += 1)
    history.push(state(systemSample(i), { lastAttempt: attempt(i) }));
  const samples = history.samples();
  assert.equal(samples.length, 18);
  assert.deepEqual(samples[0], { cpu: 2, memory: 2, disk: 2 });
  assert.deepEqual(samples.at(-1), { cpu: 19, memory: 19, disk: 19 });
  history.push(state(systemSample(19), { lastAttempt: attempt(19) }));
  assert.equal(history.size(), 18);
});

test("history ignores a repeated lastAttempt before the ring reaches capacity", () => {
  const history = createHistory();
  const sample = state(systemSample(1), { lastAttempt: FIXED });
  history.push(sample);
  history.push(state(systemSample(2), { lastAttempt: FIXED }));
  assert.equal(history.size(), 1);
  assert.deepEqual(history.samples(), [{ cpu: 1, memory: 1, disk: 1 }]);
});

test("getDashboard returns the running collector snapshot", () => {
  const result = runScript(
    'const { createCollector, setCollector } = await import("./src/server/collector.ts");' +
      'const { getDashboard } = await import("./src/adapters/index.ts");' +
      'const ds = ["weather","calendar","reminders","finance","health","build","ai","systems","habits","goals"];' +
      'const caches = Object.fromEntries(ds.map((d) => [d, { get: async () => ({ loading:false, data:{ marker:"collector", d }, source:"real", provider:"test", status:"ready", lastSuccess:"2026-10-03T12:00:00.000Z", lastAttempt:"2026-10-03T12:00:00.000Z", error:null, refreshMs:1000 }) }]));' +
      'const c = createCollector({ caches }); await c.tick(); await c.start(); setCollector(c);' +
      'const data = await getDashboard(); c.stop(); setCollector(null);' +
      'console.log("RESULT:" + JSON.stringify({ marker:data.weather.data.marker }));',
    { LIFEDASH_DEMO: "false", LIFEDASH_COLLECTOR: "on" },
  );
  assert.deepEqual(result, { marker: "collector" });
});

test("history appends nothing when systems data is null", () => {
  const history = createHistory();
  history.push(
    state<SystemState>(null, { lastAttempt: "2026-10-03T00:00:01.000Z" }),
  );
  history.push(undefined);
  assert.equal(history.size(), 0);
  assert.deepEqual(history.samples(), []);
});

function runScript(
  script: string,
  env: Record<string, string>,
): Record<string, unknown> {
  const out = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      'globalThis.fetch = () => { throw new Error("network forbidden in tests") };' +
        script,
    ],
    { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: "utf8" },
  );
  const line = out
    .trim()
    .split("\n")
    .find((entry) => entry.startsWith("RESULT:"));
  assert.ok(line, "child process produced no RESULT line");
  return JSON.parse(line.slice("RESULT:".length)) as Record<string, unknown>;
}

test("LIFEDASH_COLLECTOR=off means register() does not start a collector", () => {
  const result = runScript(
    'const { register } = await import("./src/instrumentation.ts");' +
      'const { getCollector } = await import("./src/server/collector.ts");' +
      'await register();' +
      'console.log("RESULT:" + JSON.stringify({ started: getCollector() !== null }));',
    {
      LIFEDASH_COLLECTOR: "off",
      LIFEDASH_DEMO: "false",
      NEXT_RUNTIME: "nodejs",
    },
  );
  assert.deepEqual(result, { started: false });
});

test("the collector is enabled unless LIFEDASH_COLLECTOR is exactly off", () => {
  const script =
    'const { config } = await import("./src/config/index.ts");' +
    'console.log("RESULT:" + JSON.stringify({ enabled: config.collector.enabled }));';
  assert.deepEqual(runScript(script, { LIFEDASH_COLLECTOR: "" }), {
    enabled: true,
  });
  assert.deepEqual(runScript(script, { LIFEDASH_COLLECTOR: "on" }), {
    enabled: true,
  });
  assert.deepEqual(runScript(script, { LIFEDASH_COLLECTOR: "0" }), {
    enabled: true,
  });
  assert.deepEqual(runScript(script, { LIFEDASH_COLLECTOR: "off" }), {
    enabled: false,
  });
  assert.deepEqual(runScript(script, { LIFEDASH_COLLECTOR: " OFF " }), {
    enabled: false,
  });
});

test("demo mode does not start a collector", () => {
  const result = runScript(
    'const { register } = await import("./src/instrumentation.ts");' +
      'const { getCollector } = await import("./src/server/collector.ts");' +
      'await register();' +
      'console.log("RESULT:" + JSON.stringify({ started: getCollector() !== null }));',
    {
      LIFEDASH_COLLECTOR: "on",
      LIFEDASH_DEMO: "true",
      NEXT_RUNTIME: "nodejs",
    },
  );
  assert.deepEqual(result, { started: false });
});

test("a non-nodejs runtime does not start a collector", () => {
  const result = runScript(
    'const { register } = await import("./src/instrumentation.ts");' +
      'const { getCollector } = await import("./src/server/collector.ts");' +
      'await register();' +
      'console.log("RESULT:" + JSON.stringify({ started: getCollector() !== null }));',
    {
      LIFEDASH_COLLECTOR: "on",
      LIFEDASH_DEMO: "false",
      NEXT_RUNTIME: "edge",
    },
  );
  assert.deepEqual(result, { started: false });
});

test("collector tick seconds are clamped to 1..60 with a 5s default", () => {
  const script =
    'const { config } = await import("./src/config/index.ts");' +
    'console.log("RESULT:" + JSON.stringify({ tickMs: config.collector.tickMs }));';
  assert.deepEqual(
    runScript(script, { LIFEDASH_COLLECTOR_TICK_SECONDS: "999" }),
    { tickMs: 5000 },
  );
  assert.deepEqual(
    runScript(script, { LIFEDASH_COLLECTOR_TICK_SECONDS: "3" }),
    { tickMs: 3000 },
  );
});
