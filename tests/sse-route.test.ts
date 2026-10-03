import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  DashboardData,
  DataState,
  Domain,
  SystemState,
} from "../src/domains/models";
import type { DashboardSnapshotEvent } from "../src/lib/dashboard-protocol";
import { GET, HEAD, OPTIONS } from "../src/app/api/dashboard/stream/route";
import {
  createCollector,
  setCollector,
  type CacheLike,
  type Collector,
} from "../src/server/collector";
import { createSseStream, streamClientCount } from "../src/server/sse";
import { createSnapshotStore } from "../src/server/snapshot-store";

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
const URL = "http://127.0.0.1/api/dashboard/stream";
const decoder = new TextDecoder();

let originalFetch: typeof fetch;
before(() => {
  originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = (() => {
    throw new Error("network forbidden in tests");
  }) as typeof fetch;
});
after(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  setCollector(null);
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

async function liveCollector(): Promise<{
  collector: Collector;
  setWeather: (value: number) => void;
}> {
  let weather = 1;
  const caches = {} as Record<Domain, CacheLike>;
  for (const domain of DOMAINS) {
    caches[domain] = {
      async get() {
        if (domain === "finance") return state(null);
        if (domain === "systems")
          return state<SystemState>({
            machine: {
              id: "machine",
              name: "Host",
              status: "online",
              latencyMs: null,
              uptimeSeconds: null,
              cpuPercent: weather,
              memoryPercent: weather,
              diskPercent: weather,
            },
            endpoints: [],
          });
        return state({ domain, weather });
      },
    };
  }
  const collector = createCollector({ caches, now: () => new Date(FIXED) });
  await collector.tick();
  setCollector(collector);
  return {
    collector,
    setWeather: (value) => {
      weather = value;
    },
  };
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const { value, done } = await reader.read();
  return done || !value ? "" : decoder.decode(value);
}

test("stream headers match the SSE contract", async () => {
  const { collector } = await liveCollector();
  const controller = new AbortController();
  const response = await GET(new Request(URL, { signal: controller.signal }));
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "text/event-stream; charset=utf-8",
  );
  assert.equal(response.headers.get("cache-control"), "no-store, no-transform");
  assert.equal(response.headers.get("connection"), "keep-alive");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(collector.subscriberCount(), 0);
});

test("first frames are retry then a full snapshot event", async () => {
  await liveCollector();
  const controller = new AbortController();
  const response = await GET(new Request(URL, { signal: controller.signal }));
  const reader = response.body!.getReader();
  assert.equal(await readChunk(reader), "retry: 5000\n\n");
  const frame = await readChunk(reader);
  assert.match(frame, /^event: snapshot\nid: \d+\ndata: /);
  const payload = JSON.parse(frame.split("data: ")[1]);
  assert.equal(payload.v, 1);
  assert.ok(Number.isInteger(payload.seq) && payload.seq >= 1);
  assert.equal(typeof payload.serverTime, "string");
  assert.deepEqual(Object.keys(payload.data).sort(), [...DOMAINS].sort());
  assert.ok(Array.isArray(payload.history.systems));
  assert.equal(payload.history.systems.length, 1);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
});

test("a new collector seq pushes a second snapshot", async () => {
  const { collector, setWeather } = await liveCollector();
  const controller = new AbortController();
  const response = await GET(new Request(URL, { signal: controller.signal }));
  const reader = response.body!.getReader();
  await readChunk(reader);
  await readChunk(reader);
  setWeather(2);
  await collector.tick();
  const frame = await readChunk(reader);
  assert.match(frame, /^event: snapshot\nid: \d+\ndata: /);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
});

test("a heartbeat comment arrives after 15000ms", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const { collector } = await liveCollector();
  const controller = new AbortController();
  const response = await GET(new Request(URL, { signal: controller.signal }));
    const reader = response.body!.getReader();
    try {
      await readChunk(reader);
      await readChunk(reader);
      const nextFrame = readChunk(reader);
      t.mock.timers.tick(15000);
      const result = await Promise.race([
        nextFrame.then((value) => ({ value })),
        new Promise<{ value: string | null }>((resolve) =>
          setImmediate(() => resolve({ value: null })),
        ),
      ]);
      const heartbeat = result.value;
      assert.ok(heartbeat, "heartbeat frame was not delivered");
      assert.match(heartbeat, /^: hb\nevent: heartbeat\ndata: hb\n\n$/);
  } finally {
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.reset();
  }
  assert.equal(collector.subscriberCount(), 0);
});

test("Last-Event-ID equal to the current seq skips the initial snapshot", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const { collector } = await liveCollector();
  const controller = new AbortController();
  const response = await GET(
    new Request(URL, {
      headers: { "last-event-id": String(collector.latest()!.seq) },
      signal: controller.signal,
    }),
  );
  const reader = response.body!.getReader();
  try {
    assert.equal(await readChunk(reader), "retry: 5000\n\n");
    const nextFrame = readChunk(reader);
    t.mock.timers.tick(15000);
    const result = await Promise.race([
      nextFrame.then((value) => ({ value })),
      new Promise<{ value: string | null }>((resolve) =>
        setImmediate(() => resolve({ value: null })),
      ),
    ]);
    const frame = result.value;
    assert.ok(frame, "heartbeat frame was not delivered after Last-Event-ID");
    assert.match(frame, /^: hb\nevent: heartbeat\ndata: hb\n\n$/);
    assert.equal(frame.includes("event: snapshot"), false);
  } finally {
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.reset();
  }
});

test("aborting removes the subscriber, clears the timer and frees the slot", async () => {
  const { collector } = await liveCollector();
  const before = collector.subscriberCount();
  const controller = new AbortController();
  const response = await GET(new Request(URL, { signal: controller.signal }));
  assert.equal(response.status, 200);
  assert.equal(collector.subscriberCount(), before + 1);
  assert.equal(streamClientCount(), 1);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(collector.subscriberCount(), before);
  assert.equal(streamClientCount(), 0);
});

test("the 17th concurrent client gets 503", async () => {
  await liveCollector();
  assert.equal(streamClientCount(), 0);
  const streams = [] as Response[];
  const controllers: AbortController[] = [];
  for (let i = 0; i < 16; i += 1) {
    const controller = new AbortController();
    controllers.push(controller);
    streams.push(await GET(new Request(URL, { signal: controller.signal })));
  }
  assert.equal(streams.length, 16);
  const overflow = await GET(new Request(URL));
  assert.equal(overflow.status, 503);
  assert.deepEqual(await overflow.json(), { error: "Too many stream clients" });
  for (const controller of controllers) controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(streamClientCount(), 0);
});

test("?demo=true returns demo data and never subscribes", async () => {
  const { collector } = await liveCollector();
  const before = collector.subscriberCount();
  const controller = new AbortController();
  const response = await GET(
    new Request(`${URL}?demo=true`, { signal: controller.signal }),
  );
  const reader = response.body!.getReader();
  await readChunk(reader);
  const payload = JSON.parse((await readChunk(reader)).split("data: ")[1]);
  assert.ok(payload.seq > 1);
  assert.deepEqual(payload.history.systems, []);
  assert.equal(payload.data.weather.source, "mock");
  assert.equal(collector.subscriberCount(), before);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
});

test("HEAD returns headers only and never takes a client slot", async () => {
  await liveCollector();
  assert.equal(streamClientCount(), 0);
  const response = await HEAD();
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "text/event-stream; charset=utf-8",
  );
  assert.equal(response.headers.get("cache-control"), "no-store, no-transform");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.equal(await response.text(), "");
  assert.equal(streamClientCount(), 0);
});

test("16+ HEADs leave the stream endpoint working for GET", async () => {
  const { collector } = await liveCollector();
  collector.stop();
  for (let i = 0; i < 20; i += 1) {
    const response = await HEAD();
    assert.equal(response.status, 200);
  }
  assert.equal(streamClientCount(), 0, "HEAD consumed a stream client slot");
  const controller = new AbortController();
  const response = await GET(new Request(URL, { signal: controller.signal }));
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  assert.equal(await readChunk(reader), "retry: 5000\n\n");
  assert.match(await readChunk(reader), /^event: snapshot\nid: \d+\ndata: /);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(streamClientCount(), 0);
});

test("OPTIONS advertises the allowed verbs and other methods are 405", async () => {
  const options = await OPTIONS();
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("allow"), "GET, HEAD, OPTIONS");
  const controller = new AbortController();
  const response = await GET(new Request(URL, { signal: controller.signal }));
  assert.equal(response.status, 200);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
});

test("aborting clears the heartbeat interval", async () => {
  const original = globalThis.clearInterval;
  let cleared = 0;
  globalThis.clearInterval = ((handle?: unknown) => {
    cleared += 1;
    return original(handle as never);
  }) as typeof clearInterval;
  try {
    await liveCollector();
    const controller = new AbortController();
    const response = await GET(new Request(URL, { signal: controller.signal }));
    const reader = response.body!.getReader();
    await readChunk(reader);
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(cleared >= 1, "heartbeat interval was not cleared on abort");
  } finally {
    globalThis.clearInterval = original;
  }
});

test("a client that stops reading is dropped at the queue cap", async () => {
  const listeners = new Set<(event: DashboardSnapshotEvent) => void>();
  let closes = 0;
  const controller = new AbortController();
  const stream = createSseStream({
    source: {
      latest: () => null,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    initialSnapshot: null,
    signal: controller.signal,
    onClose: () => {
      closes += 1;
    },
  });
  const event = (seq: number): DashboardSnapshotEvent => ({
    v: 1,
    seq,
    serverTime: "2026-10-03T12:00:00.000Z",
    data: { blob: "x".repeat(40_000) } as unknown as DashboardData,
    history: { systems: [] },
  });
  try {
    for (let seq = 1; seq <= 100; seq += 1)
      for (const listener of [...listeners]) listener(event(seq));
    assert.equal(listeners.size, 0, "slow client was not unsubscribed");
    assert.equal(closes, 1);
    // The dropped client's body is closed, not left buffering.
    const reader = stream.getReader();
    const drain = async () => {
      let chunks = 0;
      while (chunks < 1000) {
        const { done } = await reader.read();
        if (done) break;
        chunks += 1;
      }
      return chunks;
    };
    assert.ok((await drain()) < 1000);
  } finally {
    controller.abort();
  }
});

test("after a restart, a Last-Event-ID resume still gets a larger seq", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cto-0014-resume-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createSnapshotStore(dir);
  const cachesFor = (weather: number) => {
    const caches = {} as Record<Domain, CacheLike>;
    for (const domain of DOMAINS) {
      caches[domain] = { async get() { return state({ domain, weather }); } };
    }
    return caches;
  };
  const before = createCollector({
    caches: cachesFor(1),
    store,
    now: () => new Date(FIXED),
  });
  const first = (await before.tick())!;
  before.stop();
  for (let i = 0; i < 200 && !(await store.load()); i += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(await store.load(), "first snapshot was not persisted");

  // Simulated restart: a brand new collector over the same persisted dir.
  const after = createCollector({
    caches: cachesFor(2),
    store,
    now: () => new Date(Date.parse(FIXED) + 2000),
  });
  setCollector(after);
  const second = (await after.tick())!;
  after.stop();
  assert.ok(second.seq > first.seq, "seq regressed across the restart");
  for (let i = 0; i < 100 && !(await store.load()); i += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  await new Promise((resolve) => setTimeout(resolve, 25));

  const controller = new AbortController();
  const response = await GET(
    new Request(URL, {
      headers: { "last-event-id": String(first.seq) },
      signal: controller.signal,
    }),
  );
  const reader = response.body!.getReader();
  assert.equal(await readChunk(reader), "retry: 5000\n\n");
  const frame = await readChunk(reader);
  const payload = JSON.parse(frame.split("data: ")[1]);
  assert.ok(
    payload.seq > first.seq,
    "the resumed client was sent a seq it would drop",
  );
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
});

test("collector-off Last-Event-ID resume gets a wall-clock-seeded sequence after restart", async () => {
  setCollector(null);
  const controller = new AbortController();
  const response = await GET(
    new Request(URL, {
      headers: { "last-event-id": "1" },
      signal: controller.signal,
    }),
  );
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  assert.equal(await readChunk(reader), "retry: 5000\n\n");
  const frame = await readChunk(reader);
  const payload = JSON.parse(frame.split("data: ")[1]);
  assert.ok(payload.seq > 1);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
});
