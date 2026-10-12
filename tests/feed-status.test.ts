import test from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { Feed } from "../src/components/shared/feed";
import type { DataState } from "../src/domains/models";

const now = new Date("2026-10-03T12:00:00.000Z");

function feed(status: DataState<unknown>["status"]) {
  const state: DataState<unknown> = {
    loading: false,
    data: {},
    source: "real",
    provider: "Test",
    status,
    lastSuccess: new Date(now.getTime() - 1000).toISOString(),
    lastAttempt: now.toISOString(),
    error: status === "ready" ? null : "boom",
    refreshMs: 30000,
  };
  return renderToString(Feed({ state, now })).replace(/<!-- -->/g, "");
}

test("a feed that is not ready reads STALE even when lastSuccess is fresh", () => {
  for (const status of ["error", "stale"] as const) {
    const html = feed(status);
    assert.ok(html.includes("feed-stale"), `${status}: ${html}`);
    assert.ok(html.includes("STALE"), `${status}: ${html}`);
  }
});

test("a ready feed with a fresh lastSuccess is plain LIVE", () => {
  const html = feed("ready");
  assert.ok(!html.includes("feed-stale"), html);
  assert.ok(!html.includes("STALE"), html);
  assert.ok(html.includes("LIVE"), html);
});
