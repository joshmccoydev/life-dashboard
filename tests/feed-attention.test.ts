import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { installFakeDom } from "./fake-dom";
import { Dashboard } from "../src/components/dashboard";
import type { DashboardData, DataState, DisplayConfig } from "../src/domains/models";

// CTO-0031 (follow-up F1 of CTO-0015 rev2): the header status must read
// FEED ATTENTION for a visible feed whose status is not "ready" even when its
// lastSuccess is fresh. Mounted Dashboard with the real hook, fake timers and a
// fake fetch, as in clock-tick.test.ts. The machine is healthy and there is no
// connection error, so only the feed status can move the header.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures/dashboard-data.json"), "utf8"),
) as { data: DashboardData };
const display: DisplayConfig = {
  timezone: "America/Chicago", locale: "en-US", currency: "USD",
  rotationSeconds: 25, pixelShift: false,
  modes: { morning: 6, day: 9, evening: 17, night: 22 },
};

const T = Date.parse("2026-10-03T04:00:00.000Z");
const SECOND = 1000;
const POLL_MS = 30 * SECOND;

type FeedKey = keyof DashboardData;

/** Every feed ready with lastSuccess 1 s before `atMs`; `override` sets one feed's status. */
function feedsAt(atMs: number, override?: { feed: FeedKey; status: DataState<unknown>["status"] }) {
  const data = structuredClone(fixture.data);
  for (const state of Object.values(data)) {
    state.status = "ready";
    state.error = null;
    state.lastSuccess = new Date(atMs - SECOND).toISOString();
  }
  if (override) {
    data[override.feed].status = override.status;
    data[override.feed].error = "boom";
  }
  return data;
}

type El = { className?: string; childNodes: El[]; textContent: string };
function findByClass(node: El, cls: string): El | null {
  if ((node.className ?? "").split(/\s+/).includes(cls)) return node;
  for (const child of node.childNodes) {
    const hit = findByClass(child, cls);
    if (hit) return hit;
  }
  return null;
}

/** Mount the Dashboard at T with the real hook; fetch returns fresh feeds with the same override. */
async function mountDashboard(override?: { feed: FeedKey; status: DataState<unknown>["status"] }) {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: T });
  const realFetch = globalThis.fetch;
  let polls = 0;
  globalThis.fetch = (() => {
    polls++;
    const body = { data: feedsAt(Date.now(), override), serverTime: new Date(Date.now()).toISOString() };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  }) as unknown as typeof fetch;
  installFakeDom();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(Dashboard, {
        initial: feedsAt(T, override), renderedAt: new Date(T).toISOString(),
        display, demo: false, paused: true,
      }),
    );
  });
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return {
    header: () => {
      const el = findByClass(container as unknown as El, "global-status");
      assert.ok(el, "header status element is rendered");
      return el.textContent.trim();
    },
    text: () => container.textContent,
    polls: () => polls,
    advance: (ms: number) => act(async () => { mock.timers.tick(ms); await settle(); }),
    close: async () => {
      await act(async () => root.unmount());
      globalThis.fetch = realFetch;
      mock.timers.reset();
    },
  };
}

async function assertHeader(
  override: { feed: FeedKey; status: DataState<unknown>["status"] } | undefined,
  expected: string,
) {
  const page = await mountDashboard(override);
  const label = override ? `${override.feed}=${override.status}` : "all ready";
  try {
    assert.equal(page.header(), expected, `${label}: at mount`);
    if (expected !== "FEED ATTENTION")
      assert.notEqual(page.header(), "FEED ATTENTION", `${label}: header is not FEED ATTENTION`);
    assert.ok(!page.text().includes("Connection interrupted"), `${label}: no connection error`);
    // one successful poll lands with fresh lastSuccess and the same statuses
    await page.advance(POLL_MS);
    assert.ok(page.polls() >= 1, `${label}: the fake fetch was polled`);
    assert.ok(!page.text().includes("Connection interrupted"), `${label}: poll accepted`);
    assert.equal(page.header(), expected, `${label}: after a fresh poll`);
  } finally {
    await page.close();
  }
}

test("header reads FEED ATTENTION for a feed with status error and fresh lastSuccess", async () => {
  const machine = fixture.data.systems.data?.machine;
  assert.equal(machine?.status, "online", "precondition: machine healthy");
  await assertHeader({ feed: "calendar", status: "error" }, "FEED ATTENTION");
});

test("header reads FEED ATTENTION for a feed with status stale and fresh lastSuccess", async () => {
  await assertHeader({ feed: "build", status: "stale" }, "FEED ATTENTION");
});

test("control: all feeds ready and fresh, header is not FEED ATTENTION", async () => {
  await assertHeader(undefined, "SYSTEMS NORMAL");
});
