import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  normalizeDashboardResponse,
} from "../src/lib/dashboard-response";
import { normalizeDashboardResponse as fromFacade } from "../src/components/dashboard";
import type { DashboardData } from "../src/domains/models";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures/dashboard-data.json"), "utf8"),
) as { data: DashboardData };

function clone(): DashboardData {
  return structuredClone(fixture.data);
}

test("accepts the demo fixture and a null systems payload", () => {
  assert.equal(normalizeDashboardResponse({ data: clone() }).weather.data?.code, 2);
  const data = clone();
  data.systems.data = null;
  assert.equal(normalizeDashboardResponse({ data }).systems.data, null);
});

test("rejects malformed dashboards", () => {
  for (const value of [
    {},
    { data: { systems: clone().systems } },
    { data: {} },
  ]) {
    assert.throws(() => normalizeDashboardResponse(value), {
      message: "Invalid dashboard response",
    });
  }
});

test("rejects a feed without a data key", () => {
  const data = clone() as unknown as Record<string, Record<string, unknown>>;
  delete data.weather.data;
  assert.throws(() => normalizeDashboardResponse({ data }), {
    message: "Invalid dashboard response",
  });
});

test("rejects missing feed keys", () => {
  const data = clone() as unknown as Record<string, unknown>;
  delete data.goals;
  assert.throws(() => normalizeDashboardResponse({ data }), {
    message: "Invalid dashboard response",
  });
});

test("rejects structurally wrong payloads", () => {
  const systems = clone();
  systems.systems.data = {} as never;
  assert.throws(() => normalizeDashboardResponse({ data: systems }), {
    message: "Invalid dashboard response",
  });

  const ai = clone();
  ai.ai.data = {} as never;
  assert.throws(() => normalizeDashboardResponse({ data: ai }), {
    message: "Invalid dashboard response",
  });

  const calendar = clone();
  calendar.calendar.data = { events: "x" } as never;
  assert.throws(() => normalizeDashboardResponse({ data: calendar }), {
    message: "Invalid dashboard response",
  });
});

test("the dashboard re-export is the same function", () => {
  assert.equal(fromFacade, normalizeDashboardResponse);
});

test("rejects a non-numeric cpuPercent and a feed without refreshMs", () => {
  const cpu = clone();
  cpu.systems.data!.machine.cpuPercent = "42" as never;
  assert.throws(() => normalizeDashboardResponse({ data: cpu }), {
    message: "Invalid dashboard response",
  });

  const noRefresh = clone() as unknown as Record<
    string,
    Record<string, unknown>
  >;
  delete noRefresh.weather.refreshMs;
  assert.throws(() => normalizeDashboardResponse({ data: noRefresh }), {
    message: "Invalid dashboard response",
  });
});

test("rejects string memoryPercent and diskPercent but accepts null", () => {
  for (const field of ["memoryPercent", "diskPercent"] as const) {
    const bad = clone();
    bad.systems.data!.machine[field] = "42" as never;
    assert.throws(() => normalizeDashboardResponse({ data: bad }), {
      message: "Invalid dashboard response",
    });
    const nullable = clone();
    nullable.systems.data!.machine[field] = null;
    assert.doesNotThrow(() => normalizeDashboardResponse({ data: nullable }));
  }
});

test("rejects a string refreshMs", () => {
  const data = clone() as unknown as Record<string, Record<string, unknown>>;
  data.weather.refreshMs = "30000";
  assert.throws(() => normalizeDashboardResponse({ data }), {
    message: "Invalid dashboard response",
  });
});

test("rejects a feed missing or mistyping status, source or lastSuccess", () => {
  for (const field of ["status", "source", "lastSuccess"]) {
    const missing = clone() as unknown as Record<string, Record<string, unknown>>;
    delete missing.weather[field];
    assert.throws(() => normalizeDashboardResponse({ data: missing }), {
      message: "Invalid dashboard response",
    }, `missing ${field}`);
  }
  for (const [field, value] of [
    ["status", "bogus"],
    ["source", "bogus"],
    ["lastSuccess", 42],
  ] as const) {
    const bad = clone() as unknown as Record<string, Record<string, unknown>>;
    bad.weather[field] = value;
    assert.throws(() => normalizeDashboardResponse({ data: bad }), {
      message: "Invalid dashboard response",
    }, `bad ${field}`);
  }
  const never = clone();
  never.weather.lastSuccess = null;
  assert.doesNotThrow(() => normalizeDashboardResponse({ data: never }));
});
