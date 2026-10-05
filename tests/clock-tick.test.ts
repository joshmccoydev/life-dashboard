import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { installFakeDom } from "./fake-dom";
import { Dashboard } from "../src/components/dashboard";
import { clockAt, startClockTick } from "../src/components/shared/client-state";
import type { DashboardData, DisplayConfig } from "../src/domains/models";

// Guards for the display clock (CTO-0015 rev2): the 15 s tick, the
// forward-only `clockAt`, and every consumer of the ticking clock (feed
// staleness, alerts, mode, weather and widget `now`).
const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures/dashboard-data.json"), "utf8"),
) as { data: DashboardData };
const display: DisplayConfig = {
  timezone: "America/Chicago", locale: "en-US", currency: "USD",
  rotationSeconds: 25, pixelShift: false,
  modes: { morning: 6, day: 9, evening: 17, night: 22 },
};

const T = Date.parse("2026-10-03T04:00:00.000Z"); // 23:00 CDT: night
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Fixture feeds all last refreshed at `lastSuccessMs`; `refreshMs` overrides the per-feed cadence. */
function feedsAt(lastSuccessMs: number, refreshMs?: number): DashboardData {
  const data = structuredClone(fixture.data);
  for (const state of Object.values(data)) {
    if (refreshMs !== undefined) state.refreshMs = refreshMs;
    state.status = "ready";
    state.lastSuccess = new Date(lastSuccessMs).toISOString();
  }
  return data;
}
const squash = (html: string) => html.replace(/<!-- -->/g, "");
const stripHeaderClock = (html: string) =>
  squash(html).replace(
    /<div class="clock-block">.*?<div class="header-right">/s,
    '<div class="header-right">',
  );

/** SSR the dashboard at `renderedAt` with the hook reporting `receivedAt`. */
function ssr(
  renderedAt: number,
  receivedAt: number | null,
  { connectionError = false, forcedMode }: { connectionError?: boolean; forcedMode?: string } = {},
) {
  const data = feedsAt(T - SECOND);
  return renderToString(
    Dashboard({
      initial: data,
      renderedAt: new Date(renderedAt).toISOString(),
      display,
      demo: false,
      paused: true,
      forcedMode,
      useData: () => ({
        data, systemHistory: [], connectionError, receivedAt, transport: "poll",
      }),
    }),
  );
}

// ---- clockAt: pure and forward-only ------------------------------------------
test("clockAt: null, older and equal receivedAt keep the ticking clock", () => {
  const now = new Date(T);
  assert.equal(clockAt(now, null), now);
  assert.equal(clockAt(now, T - 1), now);
  assert.equal(clockAt(now, T), now);
});

test("clockAt: a newer receivedAt moves the clock forward and never back", () => {
  const now = new Date(T);
  assert.equal(clockAt(now, T + 5 * SECOND).getTime(), T + 5 * SECOND);
  const adopted = clockAt(now, T + 5 * SECOND);
  // the tick later passes receivedAt: the ticking clock wins again
  assert.equal(clockAt(new Date(T + 20 * SECOND), T + 5 * SECOND).getTime(), T + 20 * SECOND);
  assert.equal(clockAt(adopted, T).getTime(), T + 5 * SECOND);
});

// ---- startClockTick: the 15 s timer, without a DOM ---------------------------
test("startClockTick sets the current time every 15 s and not before", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: T });
  try {
    const seen: number[] = [];
    const stop = startClockTick((d) => seen.push(d.getTime()));
    mock.timers.tick(14_999);
    assert.deepEqual(seen, [], "no tick before 15 s");
    mock.timers.tick(1);
    assert.deepEqual(seen, [T + 15_000]);
    mock.timers.tick(15_000);
    mock.timers.tick(15_000);
    assert.deepEqual(seen, [T + 15_000, T + 30_000, T + 45_000]);
    stop();
    mock.timers.tick(10 * MINUTE);
    assert.equal(seen.length, 3, "the cleanup stops the tick");
  } finally {
    mock.timers.reset();
  }
});

// ---- consumers of the ticking clock, via the real Dashboard ------------------
// With `renderedAt` set to the ticked time and a stale `receivedAt`, the page must
// equal one whose hook has no receive time at all: nothing may read `receivedAt`
// as "now". Covers feed staleness, alerts, mode, Weather and every widget.
test("every consumer of the dashboard clock follows the ticking clock", () => {
  for (const advance of [10 * MINUTE, 7 * HOUR]) {
    const ticked = stripHeaderClock(ssr(T + advance, T, { connectionError: true }));
    const reference = stripHeaderClock(ssr(T + advance, null, { connectionError: true }));
    assert.equal(ticked, reference, `+${advance / MINUTE} min`);
  }
});

test("a +10 minute outage shows six stale feed sources and +6 alerts", () => {
  const html = squash(ssr(T + 10 * MINUTE, T, { connectionError: true }));
  assert.ok(html.includes("FEED ATTENTION"));
  assert.ok(html.includes("Connection interrupted"));
  assert.ok(html.includes("<small>+6</small>"), "six further alerts");
  // six feed sources are past 2 x refreshMs; calendar shows in two widgets
  assert.equal((html.match(/STALE 10m/g) ?? []).length, 7);
  assert.equal((html.match(/data stale/g) ?? []).length, 0, "night mode shows one rotating alert");
  assert.ok(!html.includes("SYSTEMS NORMAL"));
});

test("a +7 hour outage reads MORNING MODE with +11 alerts", () => {
  const html = squash(ssr(T + 7 * HOUR, T, { connectionError: true }));
  assert.ok(html.includes("MORNING MODE"), "unforced mode follows the clock");
  assert.ok(html.includes("<small>+11</small>"), "eleven further alerts");
  assert.ok(html.includes("STALE 7h"));
  assert.ok(squash(ssr(T, T)).includes("NIGHT MODE"), "control: night at t0");
});

test("a refresh newer than the ticking clock is adopted at once", () => {
  const html = squash(ssr(T, T + 5 * MINUTE));
  assert.ok(html.includes("STALE 5m"), "feeds age against receivedAt immediately");
});

// ---- the mounted component and real hook -------------------------------------
type Mounted = {
  text: () => string;
  /** Move the fake clock; `step` splits it so timers fire at their own times (node's mock reads Date at the end of a tick). */
  advance: (ms: number, step?: number) => Promise<void>;
  unmount: () => Promise<void>;
};

async function mount(
  element: ReturnType<typeof createElement>,
): Promise<Mounted> {
  installFakeDom();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return {
    text: () => container.textContent,
    advance: async (ms, step = ms) => {
      for (let left = ms; left > 0; left -= step)
        await act(async () => { mock.timers.tick(Math.min(step, left)); await settle(); });
    },
    unmount: () => act(async () => root.unmount()),
  };
}

test("the mounted dashboard keeps ticking through failures after a refresh", async () => {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: T });
  const realFetch = globalThis.fetch;
  let online = true;
  const respond = () => {
    if (!online) return Promise.reject(new Error("offline"));
    // lastSuccess is 29 s before the first poll lands at T+30 s, then it freezes
    const body = { data: feedsAt(T + 29 * SECOND, 30 * SECOND), serverTime: new Date(T + 30 * SECOND).toISOString() };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
  globalThis.fetch = respond as unknown as typeof fetch;
  const page = await mount(
    createElement(Dashboard, {
      initial: feedsAt(T - SECOND, 30 * SECOND), renderedAt: new Date(T).toISOString(),
      display, demo: false, paused: true,
    }),
  );
  try {
    assert.ok(page.text().includes("SYSTEMS NORMAL"));
    // successful refresh at T+30 s (the real hook, polling every 30 s)
    await page.advance(30_000);
    assert.ok(page.text().includes("SYSTEMS NORMAL"), "refresh accepted");
    assert.ok(!page.text().includes("Connection interrupted"));
    // from here every poll fails; lastSuccess stays at T+29 s, stale after 60 s
    online = false;
    await page.advance(45_000, 15_000); // to T+75 s: ticks at 45, 60, 75 (age 46 s)
    await page.advance(14_999); // T+89.999 s: the next tick is 1 ms away
    assert.ok(page.text().includes("Connection interrupted"), "failure surfaces");
    assert.ok(!page.text().includes("STALE"), "no tick has aged the feeds yet");
    await page.advance(1); // T+90 s: the 15 s tick lands, age 61 s
    assert.ok(page.text().includes("STALE 1m"), "the 15 s tick aged the feeds");
    await page.advance(10 * MINUTE);
    assert.ok(page.text().includes("STALE 11m"));
    assert.ok(page.text().includes("FEED ATTENTION"));
    await page.advance(7 * HOUR);
    assert.ok(page.text().includes("MORNING MODE"), "mode follows the ticking clock");
    assert.ok(page.text().includes("STALE 7h"));
  } finally {
    await page.unmount();
    globalThis.fetch = realFetch;
    mock.timers.reset();
  }
});

test("the mounted dashboard adopts a newer receivedAt, then advances with the tick", async () => {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: T });
  const data = feedsAt(T - 119 * SECOND, 30 * SECOND); // 119 s old at T
  const page = await mount(
    createElement(Dashboard, {
      initial: data,
      renderedAt: new Date(T - HOUR).toISOString(), // seeded behind the receive time
      display, demo: false, paused: true,
      useData: () => ({ data, systemHistory: [], connectionError: false, receivedAt: T, transport: "poll" as const }),
    }),
  );
  try {
    assert.ok(page.text().includes("STALE 1m"), "adopted receivedAt, not the seeded hour-old clock");
    await page.advance(14_999);
    assert.ok(page.text().includes("STALE 1m"), "no tick yet");
    await page.advance(1);
    assert.ok(page.text().includes("STALE 2m"), "the tick moved past receivedAt (134 s)");
  } finally {
    await page.unmount();
    mock.timers.reset();
  }
});
