import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import type {
  DataState,
  Domain,
  SystemState,
} from "../src/domains/models";
import { createCollector, type CacheLike } from "../src/server/collector";
import { createHistory } from "../src/server/history";

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
  const snapshot = await collector.tick();
  for (const domain of DOMAINS) assert.equal(calls[domain], 1);
  assert.equal(snapshot?.seq, 1);
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

test("overlapping tick() calls are skipped", async () => {
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
  const cacheCallsDuringOverlap = releases.length;
  releases.forEach((release) => release());
  const [done, skipped] = await Promise.all([pending, second]);
  assert.equal(cacheCallsDuringOverlap, 1);
  assert.equal(skipped, null);
  assert.equal(done?.seq, 1);
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
  assert.equal((await collector.tick())?.seq, 1);
  assert.equal((await collector.tick())?.seq, 1);
  value = 2;
  assert.equal((await collector.tick())?.seq, 2);
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
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    created += 1;
    return originalSetInterval(...args);
  }) as typeof setInterval;
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
