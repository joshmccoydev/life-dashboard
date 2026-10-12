import test from "node:test";
import assert from "node:assert/strict";
import { isStale } from "../src/lib/time";
import { isWidgetStale } from "../src/components/widgets/contract";
import { COLUMNS } from "../src/components/widgets/layout";
import { WIDGETS } from "../src/components/widgets/definitions";

const now = new Date("2026-10-03T04:08:00.000Z");
const refreshMs = 30000;

test("isWidgetStale is exactly isStale, including a feed that is stale by default", () => {
  for (const lastSuccess of [
    "2026-10-03T04:07:59.000Z", // 1 s old: fresh
    "2026-10-03T04:07:00.000Z", // 2x refreshMs: still fresh at the boundary
    "2026-10-03T04:06:30.000Z", // 3x refreshMs: stale under the 2x default
    "2026-10-03T04:05:00.000Z", // 6x refreshMs: stale
    null,
  ]) {
    const state = { lastSuccess, refreshMs };
    assert.equal(isWidgetStale(state, now), isStale(lastSuccess, now, refreshMs));
  }
  // Pin the default factor: a 3x-refresh age must read stale, so widening the
  // factor to 3x or 5x fails here.
  assert.equal(
    isWidgetStale({ lastSuccess: "2026-10-03T04:06:30.000Z", refreshMs }, now),
    true,
  );
});

test("layout matches the current widget order", () => {
  assert.deepEqual(
    COLUMNS.map((column) => [column.id, ...column.widgetIds]),
    [
      ["personal", "schedule-personal", "habits", "payments", "goals"],
      ["work", "schedule-work", "projects", "build"],
      ["digital", "systems", "ai"],
    ],
  );
});

test("every referenced widget id exists and ids match keys", () => {
  for (const column of COLUMNS)
    for (const id of column.widgetIds) {
      assert.ok(WIDGETS[id], `missing widget ${id}`);
      assert.equal(WIDGETS[id].id, id);
    }
  assert.equal(
    new Set(COLUMNS.flatMap((column) => column.widgetIds)).size,
    Object.keys(WIDGETS).length,
  );
});
