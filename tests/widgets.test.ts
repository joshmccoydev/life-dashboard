import test from "node:test";
import assert from "node:assert/strict";
import { isStale } from "../src/lib/time";
import { isWidgetStale } from "../src/components/widgets/contract";
import { COLUMNS } from "../src/components/widgets/layout";
import { WIDGETS } from "../src/components/widgets/definitions";

const now = new Date("2026-10-03T04:08:00.000Z");
const refreshMs = 30000;
const DAY = 24 * 60 * 60 * 1000;

test("isWidgetStale is exactly isStale, including a feed that is stale by default", () => {
  for (const lastSuccess of [
    "2026-10-03T04:07:59.000Z", // 1 s old: fresh
    new Date(now.getTime() - DAY + 1000).toISOString(), // just under 24h: fresh
    new Date(now.getTime() - DAY).toISOString(), // exactly 24h: fresh (`>` not `>=`)
    new Date(now.getTime() - DAY - 1000).toISOString(), // just over 24h: stale
    "2026-10-01T04:08:00.000Z", // two days: stale
    null,
  ]) {
    const state = { lastSuccess, refreshMs };
    assert.equal(isWidgetStale(state, now), isStale(lastSuccess, now, refreshMs));
  }
  // Pin the 24h contract: just over 24h is stale; just under is fresh.
  assert.equal(
    isWidgetStale({ lastSuccess: new Date(now.getTime() - DAY - 1).toISOString(), refreshMs }, now),
    true,
  );
  assert.equal(
    isWidgetStale({ lastSuccess: new Date(now.getTime() - DAY + 1).toISOString(), refreshMs }, now),
    false,
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
