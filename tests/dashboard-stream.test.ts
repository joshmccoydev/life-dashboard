import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { DashboardData, DataState, Domain } from "../src/domains/models";
import type { DashboardSnapshotEvent } from "../src/lib/dashboard-protocol";
import {
  openDashboardStream,
  type OpenDashboardStreamOptions,
} from "../src/lib/dashboard-stream";

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

type Handler = (event: { data?: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  onerror: ((event: unknown) => void) | null = null;
  private listeners = new Map<string, Set<Handler>>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, handler: Handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
  }
  removeEventListener(type: string, handler: Handler) {
    this.listeners.get(type)?.delete(handler);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data?: string) {
    for (const handler of [...(this.listeners.get(type) ?? [])])
      handler({ data });
  }
  listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }
}

const passThrough = (data: unknown) => data as DashboardData;

function domainState<T>(data: T | null): DataState<T> {
  return {
    loading: false,
    data,
    source: "real",
    provider: "test",
    status: data === null ? "error" : "ready",
    lastSuccess: data === null ? null : FIXED,
    lastAttempt: FIXED,
    error: null,
    refreshMs: 1000,
  };
}

function snapshotData(): DashboardData {
  const data = {} as Record<Domain, DataState<unknown>>;
  for (const domain of DOMAINS)
    data[domain] =
      domain === "finance" ? domainState(null) : domainState({ domain });
  return data as DashboardData;
}

function snapshotEvent(seq: number): DashboardSnapshotEvent {
  return {
    v: 1,
    seq,
    serverTime: FIXED,
    data: snapshotData(),
    history: { systems: [] },
  };
}

function open(overrides: Partial<OpenDashboardStreamOptions> = {}) {
  FakeEventSource.instances = [];
  return openDashboardStream({
    url: "/api/dashboard/stream",
    validate: passThrough,
    onSnapshot: () => {},
    EventSourceImpl: FakeEventSource,
    ...overrides,
  });
}

test("a valid snapshot is delivered once", () => {
  const seen: DashboardSnapshotEvent[] = [];
  const stream = open({ onSnapshot: (event: DashboardSnapshotEvent) => seen.push(event) });
  const source = FakeEventSource.instances[0];
  source.emit("snapshot", JSON.stringify(snapshotEvent(1)));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].seq, 1);
  stream.close();
});

test("duplicate or lower seq values are ignored", () => {
  const seen: DashboardSnapshotEvent[] = [];
  const stream = open({ onSnapshot: (event: DashboardSnapshotEvent) => seen.push(event) });
  const source = FakeEventSource.instances[0];
  source.emit("snapshot", JSON.stringify(snapshotEvent(2)));
  source.emit("snapshot", JSON.stringify(snapshotEvent(2)));
  source.emit("snapshot", JSON.stringify(snapshotEvent(1)));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].seq, 2);
  stream.close();
});

test("invalid payloads are dropped and reported without closing the stream", () => {
  const seen: DashboardSnapshotEvent[] = [];
  const errors: unknown[] = [];
  const stream = open({
    validate: (data: unknown) => {
      if (!(data as { valid?: boolean }).valid) throw new Error("invalid data");
      return data as DashboardData;
    },
    onSnapshot: (event: DashboardSnapshotEvent) => seen.push(event),
    onError: (error: unknown) => errors.push(error),
  });
  const source = FakeEventSource.instances[0];
  source.emit("snapshot", "not json");
  source.emit("snapshot", JSON.stringify({ ...snapshotEvent(1), v: 2 }));
  source.emit("snapshot", JSON.stringify(snapshotEvent(1)));
  assert.equal(seen.length, 0);
  assert.equal(errors.length, 3);
  assert.equal(source.closed, false);
  const valid = snapshotEvent(3);
  (valid.data as unknown as { valid?: boolean }).valid = true;
  source.emit("snapshot", JSON.stringify(valid));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].seq, 3);
  stream.close();
});

test("watchdog marks stale and recreates the source", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const statuses: string[] = [];
  const stream = open({
    watchdogMs: 1000,
    onStatus: (status: string) => statuses.push(status),
  });
  try {
    t.mock.timers.tick(1000);
    assert.equal(FakeEventSource.instances.length, 2);
    assert.equal(FakeEventSource.instances[0].closed, true);
    assert.ok(statuses.includes("stale"));
  } finally {
    stream.close();
    t.mock.timers.reset();
  }
});

test("heartbeats reset the watchdog", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stream = open({ watchdogMs: 1000 });
  try {
    t.mock.timers.tick(900);
    FakeEventSource.instances[0].emit("heartbeat");
    t.mock.timers.tick(900);
    assert.equal(FakeEventSource.instances.length, 1);
    t.mock.timers.tick(200);
    assert.equal(FakeEventSource.instances.length, 2);
  } finally {
    stream.close();
    t.mock.timers.reset();
  }
});

test("close() removes timers and listeners", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stream = open({ watchdogMs: 1000 });
  const source = FakeEventSource.instances[0];
  try {
    stream.close();
    assert.equal(source.closed, true);
    assert.equal(source.listenerCount(), 0);
    t.mock.timers.tick(5000);
    assert.equal(FakeEventSource.instances.length, 1);
  } finally {
    t.mock.timers.reset();
  }
});
