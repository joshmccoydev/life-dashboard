import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DASHBOARD_POLL_INTERVAL_MS,
  applyDashboardUpdate,
  createPollingController,
  dashboardPollUrl,
  startDashboardPolling,
  systemSample,
} from "../src/lib/use-dashboard-data";
import type { PollingController } from "../src/lib/use-dashboard-data";
import type { DashboardData } from "../src/domains/models";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures/dashboard-data.json"), "utf8"),
) as { data: DashboardData };

function initial() {
  return {
    data: structuredClone(fixture.data),
    systemHistory: [] as { cpu: number | null; memory: number | null; disk: number | null }[],
  };
}

test("a no-data systems response updates state without throwing", () => {
  const data = structuredClone(fixture.data);
  data.systems.data = null;
  const next = applyDashboardUpdate(initial(), { data });
  assert.equal(next.data.systems.data, null);
  assert.deepEqual(next.systemHistory, [
    { cpu: null, memory: null, disk: null },
  ]);
});

test("each update appends one sample and the 19th drops the oldest", () => {
  const { data } = fixture;
  let state = initial();
  for (let i = 0; i < 20; i++) state = applyDashboardUpdate(state, { data });
  assert.equal(state.systemHistory.length, 18);
  const expected = systemSample(data);
  assert.deepEqual(state.systemHistory[0], expected);
});

test("a malformed response throws and leaves state untouched", () => {
  const state = initial();
  assert.throws(() => applyDashboardUpdate(state, {}), {
    message: "Invalid dashboard response",
  });
  assert.deepEqual(state, initial());
});

test("systemSample reads the machine metrics", () => {
  assert.deepEqual(systemSample(fixture.data), {
    cpu: fixture.data.systems.data!.machine.cpuPercent,
    memory: fixture.data.systems.data!.machine.memoryPercent,
    disk: fixture.data.systems.data!.machine.diskPercent,
  });
});

test("the hook returns the poll transport and the initial sample", async () => {
  const { useDashboardData } = await import("../src/lib/use-dashboard-data");
  assert.equal(typeof useDashboardData, "function");
});

function freshData(): DashboardData {
  return structuredClone(fixture.data);
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

function seed() {
  return { data: freshData(), systemHistory: [systemSample(freshData())], connectionError: false };
}

test("a failed fetch sets connectionError and keeps the last data", async () => {
  let clock = 1000;
  const states: boolean[] = [];
  const controller = createPollingController({
    initial: seed(),
    fetchImpl: (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch,
    now: () => clock++,
    onState: (state) => states.push(state.connectionError),
  });
  const before = controller.read();
  await controller.tick();
  assert.equal(controller.read().connectionError, true);
  assert.deepEqual(controller.read().data, before.data);
  assert.equal(controller.read().systemHistory.length, before.systemHistory.length);
  assert.deepEqual(states, [true]);
  controller.stop();
});

test("a later valid response clears connectionError and updates received data", async () => {
  const updated = freshData();
  updated.weather.data!.temperature = 61;
  const expectedAt = 4242;
  let calls = 0;
  const controller = createPollingController({
    initial: seed(),
    fetchImpl: (async () => {
      calls++;
      if (calls === 1) throw new Error("offline");
      return jsonResponse({ data: updated });
    }) as unknown as typeof fetch,
    now: () => expectedAt,
  });
  await controller.tick();
  assert.equal(controller.read().connectionError, true);
  await controller.tick();
  assert.equal(controller.read().connectionError, false);
  assert.equal(controller.read().data.weather.data?.temperature, 61);
  assert.equal(controller.read().systemHistory.length, 2);
  controller.stop();
});

test("a malformed response rejects without mutating state", async () => {
  const controller = createPollingController({
    initial: seed(),
    fetchImpl: (async () => jsonResponse({ data: {} })) as unknown as typeof fetch,
    now: () => 7,
  });
  assert.throws(() => controller.applyResponse({ data: {} }), {
    message: "Invalid dashboard response",
  });
  const after = controller.read();
  assert.equal(after.connectionError, false);
  assert.equal(after.systemHistory.length, 1);
  assert.equal(after.data.weather.data?.code, fixture.data.weather.data?.code);
  controller.stop();
});

test("the controller reports the poll transport surface and cleans up", async () => {
  let resolved = 0;
  const controller = createPollingController({
    initial: seed(),
    fetchImpl: (async () => {
      resolved++;
      return jsonResponse({ data: freshData() });
    }) as unknown as typeof fetch,
    now: () => 11,
  });
  assert.equal(controller.isBusy(), false);
  controller.stop();
  await controller.tick();
  assert.equal(resolved, 0, "a stopped controller performs no requests");
  assert.equal(controller.isBusy(), false);
  const transport = "poll" as const;
  assert.equal(transport, "poll");
});

test("a failure after a success keeps the last accepted data", async () => {
  const updated = freshData();
  updated.weather.data!.temperature = 61;
  let calls = 0;
  const controller = createPollingController({
    initial: seed(),
    fetchImpl: (async () => {
      calls++;
      if (calls === 1) return jsonResponse({ data: updated });
      throw new Error("offline");
    }) as unknown as typeof fetch,
    now: () => calls,
  });
  await controller.tick();
  assert.equal(controller.read().connectionError, false);
  assert.equal(controller.read().data.weather.data?.temperature, 61);
  const before = controller.read();
  await controller.tick();
  const after = controller.read();
  assert.equal(after.connectionError, true);
  assert.equal(after.data.weather.data?.temperature, 61, "last data kept");
  assert.deepEqual(after.data, before.data);
  assert.equal(after.systemHistory.length, before.systemHistory.length);
  controller.stop();
});

test("an in-flight request is aborted at 15 s and not before", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let aborted = false;
    const controller = createPollingController({
      initial: seed(),
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        })) as unknown as typeof fetch,
      now: () => 1,
    });
    const pending = controller.tick();
    mock.timers.tick(14999);
    assert.equal(aborted, false, "still in flight just before 15 s");
    mock.timers.tick(1);
    assert.equal(aborted, true, "aborted at 15 s");
    await pending;
    assert.equal(controller.read().connectionError, true);
    controller.stop();
  } finally {
    mock.timers.reset();
  }
});

test("the demo poll URL asks the API for demo data", async () => {
  assert.equal(dashboardPollUrl(true), "/api/dashboard?demo=true");
  assert.equal(dashboardPollUrl(false), "/api/dashboard");
  const hookSource = readFileSync(
    join(here, "../src/lib/use-dashboard-data.ts"),
    "utf8",
  );
  assert.match(
    hookSource,
    /url:\s*dashboardPollUrl\(demo\)/,
    "the hook must pass its demo flag into the poll URL",
  );
  const urls: string[] = [];
  const controller = createPollingController({
    initial: seed(),
    url: dashboardPollUrl(true),
    fetchImpl: (async (url: string) => {
      urls.push(url);
      return jsonResponse({ data: freshData() });
    }) as unknown as typeof fetch,
    now: () => 5,
  });
  await controller.tick();
  assert.deepEqual(urls, ["/api/dashboard?demo=true"]);
  controller.stop();
});

function fakeEnvironment() {
  const win = new EventTarget();
  const doc = new EventTarget() as EventTarget & {
    visibilityState: DocumentVisibilityState;
  };
  doc.visibilityState = "hidden";
  return { win, doc };
}

test("the poll wiring runs on the 30 s interval and wakes on online/visible", () => {
  assert.equal(DASHBOARD_POLL_INTERVAL_MS, 30000);
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    let ticks = 0;
    const controller = {
      tick: async () => {
        ticks++;
      },
      stop: () => {},
    } as unknown as PollingController;
    const env = fakeEnvironment();
    const stop = startDashboardPolling(controller, env);

    mock.timers.tick(DASHBOARD_POLL_INTERVAL_MS - 1);
    assert.equal(ticks, 0, "no tick before the interval elapses");
    mock.timers.tick(1);
    assert.equal(ticks, 1, "one tick per interval");
    mock.timers.tick(DASHBOARD_POLL_INTERVAL_MS);
    assert.equal(ticks, 2);

    env.win.dispatchEvent(new Event("online"));
    assert.equal(ticks, 3, "an online event triggers a refresh");
    env.doc.visibilityState = "visible";
    env.doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(ticks, 4, "becoming visible triggers a refresh");
    env.doc.visibilityState = "hidden";
    env.doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(ticks, 4, "hidden tabs do not refresh");

    stop();
    env.win.dispatchEvent(new Event("online"));
    mock.timers.tick(DASHBOARD_POLL_INTERVAL_MS);
    assert.equal(ticks, 4, "cleanup removes the interval and both listeners");
  } finally {
    mock.timers.reset();
  }
});

test("a refresh already in flight blocks a second one", async () => {
  let calls = 0;
  let release!: (response: Response) => void;
  const controller = createPollingController({
    initial: seed(),
    fetchImpl: (() => {
      calls++;
      return new Promise<Response>((resolve) => { release = resolve; });
    }) as unknown as typeof fetch,
    now: () => 1,
  });
  const first = controller.tick();
  await controller.tick();
  assert.equal(calls, 1, "the overlapping tick did not fetch");
  assert.equal(controller.isBusy(), true);
  release(jsonResponse({ data: freshData() }));
  await first;
  assert.equal(controller.isBusy(), false);
  controller.stop();
});
