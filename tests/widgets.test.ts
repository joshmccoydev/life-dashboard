import test from "node:test";
import assert from "node:assert/strict";
import { isStale } from "../src/lib/time";
import { isWidgetStale } from "../src/components/widgets/contract";
import { COLUMNS, HEADER_WIDGET_IDS } from "../src/components/widgets/layout";
import { WIDGETS } from "../src/components/widgets/definitions";

const now = new Date("2026-10-03T04:08:00.000Z");
const refreshMs = 30000;

test("isWidgetStale delegates to isStale by default", () => {
  for (const lastSuccess of [
    "2026-10-03T04:07:59.000Z",
    "2026-10-03T04:07:00.000Z",
    null,
  ]) {
    const state = { lastSuccess, refreshMs };
    assert.equal(
      isWidgetStale(null, state, now),
      isStale(lastSuccess, now, refreshMs),
    );
    assert.equal(
      isWidgetStale({}, state, now),
      isStale(lastSuccess, now, refreshMs),
    );
  }
});

test("an explicit staleAfterMs overrides the default threshold", () => {
  const state = { lastSuccess: "2026-10-03T04:07:00.000Z", refreshMs };
  assert.equal(isStale(state.lastSuccess, now, refreshMs), false);
  assert.equal(isWidgetStale({ staleAfterMs: 1000 }, state, now), true);
  assert.equal(
    isWidgetStale({ staleAfterMs: (ms) => ms * 10 }, state, now),
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
  assert.deepEqual([...HEADER_WIDGET_IDS], ["clock", "weather"]);
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
