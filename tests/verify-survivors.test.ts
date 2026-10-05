// Verifier-written tests that kill the rev1 survivors X04, X07, X09, X11, X15, X21, X24, X28.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { DataState, Domain } from "../src/domains/models";
import {
  createCollector,
  DEFAULT_DOMAIN_TIMEOUT_MS,
  setCollector,
  type CacheLike,
} from "../src/server/collector";
import { GET } from "../src/app/api/dashboard/stream/route";
import { streamClientCount } from "../src/server/sse";
import { createSnapshotStore, saveSnapshot } from "../src/server/snapshot-store";

const DOMAINS: Domain[] = ["weather", "calendar", "reminders", "finance", "health", "build", "ai", "systems", "habits", "goals"];
const FIXED = "2026-10-03T12:00:00.000Z";
const URL = "http://127.0.0.1/api/dashboard/stream";
let originalFetch: typeof fetch;
before(() => {
  originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = (() => { throw new Error("network forbidden in tests"); }) as typeof fetch;
});
after(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; setCollector(null); });

const ok = (data: unknown): DataState<unknown> => ({ loading: false, data, source: "real", provider: "t", status: "ready", lastSuccess: FIXED, lastAttempt: FIXED, error: null, refreshMs: 1000 });
const never = (): Promise<DataState<unknown>> => new Promise(() => {});
function caches(over: Partial<Record<Domain, CacheLike>> = {}): Record<Domain, CacheLike> {
  const c = {} as Record<Domain, CacheLike>;
  for (const d of DOMAINS) c[d] = { get: async () => ok({ d }) };
  return Object.assign(c, over);
}
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// X07: the FIRST domain (weather) hangs; the LAST domains must still publish at once.
test("X07: a hung first domain does not delay later domains (refresh is concurrent)", async () => {
  const collector = createCollector({ caches: caches({ weather: { get: never } }), domainTimeoutMs: 60_000 });
  void collector.tick();
  await tick(150);
  const d = collector.latest()!.data;
  assert.notEqual(d.systems.data, null, "systems (after weather in key order) was not refreshed while weather hung");
  assert.notEqual(d.goals.data, null);
  assert.equal(d.weather.data, null);
  assert.equal(d.weather.source, "real");
});

// X24: the default per-domain deadline is 30 s, not infinite.
test("X24: default domain deadline is 30000 ms and fires", async (t) => {
  assert.equal(DEFAULT_DOMAIN_TIMEOUT_MS, 30000);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const collector = createCollector({ caches: caches({ calendar: { get: never } }) });
    void collector.tick();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    t.mock.timers.tick(29_999);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(collector.latest()!.data.calendar.error, "Awaiting first refresh");
    t.mock.timers.tick(1);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(collector.latest()!.data.calendar.error, "adapter timed out");
    assert.equal(collector.latest()!.data.calendar.data, null);
  } finally { t.mock.timers.reset(); }
});

// X04: the pre-first-tick placeholder must carry a wall-clock seq, never 1.
test("X04: placeholder snapshot before the first tick has a wall-clock seq", async () => {
  const hang = Object.fromEntries(DOMAINS.map((d) => [d, { get: never }])) as unknown as Record<Domain, CacheLike>;
  const collector = createCollector({ caches: hang, store: null });
  await collector.start();
  const seq = collector.latest()!.seq;
  collector.stop();
  assert.ok(Math.abs(seq - Date.now()) < 60_000, `seq ${seq} is not wall-clock seeded`);
});

// X28: a persisted seq that is AHEAD of the clock must still win.
test("X28: persisted seq ahead of the wall clock is honoured after restart", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "x28-"));
  try {
    const store = createSnapshotStore(dir);
    const ahead = Date.now() + 10 * 86_400_000;
    const data = Object.fromEntries(DOMAINS.map((d) => [d, ok({ d })])) as never;
    await store.save({ data, serverTime: FIXED, seq: ahead, history: [] });
    const hang = Object.fromEntries(DOMAINS.map((d) => [d, { get: never }])) as unknown as Record<Domain, CacheLike>;
    const collector = createCollector({ caches: hang, store });
    await collector.start();
    assert.ok(collector.latest()!.seq >= ahead, "persisted seq was ignored");
    collector.stop();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// X11: concurrent writers into one directory must not collide on the temp name.
test("X11: concurrent saves into one directory never collide on a temp file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "x11-"));
  const lines: string[] = [];
  const orig = console.info; console.info = (...a: unknown[]) => { lines.push(String(a[0])); };
  try {
    const data = Object.fromEntries(DOMAINS.map((d) => [d, ok({ d })])) as never;
    await Promise.all(Array.from({ length: 40 }, (_, i) => saveSnapshot(dir, { data, serverTime: FIXED, seq: i + 1, history: [] })));
  } finally { console.info = orig; }
  try {
    assert.deepEqual(lines.filter((l) => l.includes("snapshot_write_failed")), []);
    assert.deepEqual((await readdir(dir)).sort(), ["snapshot.json"]);
    JSON.parse(await readFile(path.join(dir, "snapshot.json"), "utf8"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// X15: demo streams must not occupy live client slots.
test("X15: demo streams do not take live client slots", async () => {
  const controllers: AbortController[] = [];
  try {
    for (let i = 0; i < 20; i++) {
      const c = new AbortController(); controllers.push(c);
      const res = await GET(new Request(`${URL}?demo=true`, { signal: c.signal }));
      assert.equal(res.status, 200, `demo stream #${i + 1}`);
    }
    assert.equal(streamClientCount(), 0);
  } finally { controllers.forEach((c) => c.abort()); await tick(20); }
  assert.equal(streamClientCount(), 0);
});

// X21: a Last-Event-ID in the FUTURE must still receive a snapshot.
test("X21: a future Last-Event-ID still gets the initial snapshot", async () => {
  const collector = createCollector({ caches: caches(), now: () => new Date(FIXED) });
  await collector.tick(); setCollector(collector);
  const c = new AbortController();
  const res = await GET(new Request(URL, { signal: c.signal, headers: { "Last-Event-ID": String(collector.latest()!.seq + 1000) } }));
  const reader = res.body!.getReader(); const dec = new TextDecoder();
  let text = "";
  for (let i = 0; i < 2; i++) {
    const r = await Promise.race([reader.read(), tick(500).then(() => null)]);
    if (!r || r.done) break; text += dec.decode(r.value);
  }
  c.abort(); await tick(20); setCollector(null);
  assert.match(text, /event: snapshot/, "future Last-Event-ID suppressed the snapshot");
});

// X09: instrumentation.ts must keep Node-only modules behind dynamic import (Turbopack Edge warnings).
test("X09: instrumentation.ts has no static import of Node-only modules", () => {
  const src = readFileSync(path.join(process.cwd(), "src/instrumentation.ts"), "utf8");
  const staticImports = [...src.matchAll(/^import\s+(?!type\b)(?:[^;]*?\sfrom\s+)?["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.deepEqual(staticImports.filter((s) => s !== "@/config"), []);
  assert.match(src, /await import\(\s*["']@\/server\/collector["']\s*\)/);
});
