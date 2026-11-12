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

test("a +25 hour outage shows ten stale feed sources and +10 alerts", () => {
  const html = squash(ssr(T + 25 * HOUR, T, { connectionError: true }));
  assert.ok(!html.includes("FEED ATTENTION"), "FEED ATTENTION was replaced by the money alert chip");
  assert.ok(html.includes("Connection interrupted"));
  // All ten fixture feeds are past the 24h window. Night mode shows connection
  // plus stale-* alerts; the chip is the further-alert count after the one in view.
  assert.ok(html.includes("<small>+10</small>"), "ten further alerts");
  assert.ok(((html.match(/STALE 1d/g) ?? []).length) >= 1, "stale age appears on the ticking clock");
  assert.equal((html.match(/data stale/g) ?? []).length, 0, "night mode shows one rotating alert");
});

test("a +7 hour outage reads MORNING MODE and is still inside the 24h window", () => {
  const html = squash(ssr(T + 7 * HOUR, T, { connectionError: true }));
  assert.ok(html.includes("MORNING MODE"), "unforced mode follows the clock");
  assert.ok(!html.includes("STALE"), "7h is inside the 24h stale window");
  assert.ok(squash(ssr(T, T)).includes("NIGHT MODE"), "control: night at t0");
});

test("a refresh newer than the ticking clock is adopted at once", () => {
  // receivedAt is 25h after lastSuccess (~T); a clock stuck at T would not
  // mark feeds stale, so STALE 1d proves receivedAt was adopted.
  const html = squash(ssr(T, T + 25 * HOUR));
  assert.ok(html.includes("STALE 1d"), "feeds age against receivedAt immediately");
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
    // from here every poll fails; lastSuccess stays at T+29 s, stale after 24h
    online = false;
    await page.advance(45_000, 15_000); // to T+75 s
    assert.ok(page.text().includes("Connection interrupted"), "failure surfaces");
    assert.ok(!page.text().includes("STALE"), "24h window not crossed yet");
    await page.advance(24 * HOUR); // age ~24h+46s → stale, ageLabel 1d
    assert.ok(page.text().includes("STALE 1d"), "the 15 s tick aged the feeds past 24h");
    assert.ok(!page.text().includes("FEED ATTENTION"), "stale feeds do not set FEED ATTENTION");
    await page.advance(7 * HOUR);
    assert.ok(page.text().includes("MORNING MODE"), "mode follows the ticking clock");
    assert.ok(page.text().includes("STALE 1d"));
  } finally {
    await page.unmount();
    globalThis.fetch = realFetch;
    mock.timers.reset();
  }
});

test("the mounted dashboard adopts a newer receivedAt, then advances with the tick", async () => {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: T });
  // 23.5h old at receivedAt T: inside the 24h window. The seeded renderedAt
  // (T-1h) would already be stale (24.5h). After 30m15s the tick crosses 24h.
  const data = feedsAt(T - (23 * HOUR + 30 * MINUTE), 30 * SECOND);
  const page = await mount(
    createElement(Dashboard, {
      initial: data,
      renderedAt: new Date(T - HOUR).toISOString(), // seeded behind the receive time
      display, demo: false, paused: true,
      useData: () => ({ data, systemHistory: [], connectionError: false, receivedAt: T, transport: "poll" as const }),
    }),
  );
  try {
    assert.ok(!page.text().includes("STALE"), "adopted receivedAt, not the seeded hour-old clock");
    await page.advance(30 * MINUTE); // exact 24h: still fresh (`>` not `>=`)
    assert.ok(!page.text().includes("STALE"), "exact 24h is still fresh");
    await page.advance(15_000); // 24h+15s
    assert.ok(page.text().includes("STALE 1d"), "the tick moved past 24h");
  } finally {
    await page.unmount();
    mock.timers.reset();
  }
});
