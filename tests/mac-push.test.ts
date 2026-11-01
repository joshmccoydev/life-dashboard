import test from "node:test";
import assert from "node:assert/strict";
import { runMacPush } from "../scripts/mac-push.ts";

const FIXED_NOW = "2026-11-01T16:30:00.000Z";
const ENDPOINT = "https://dashboard.test/api/machines/heartbeat";
const TOKEN = "synthetic-mac-push-token";
const MAC_ID = "synthetic-mac-mini";
const MAC_NAME = "Synthetic Mac mini";

const MAC_READING = {
  cpuPercent: 21,
  memoryPercent: 43,
  diskPercent: 67,
  battery: { percent: 82, charging: false },
} as const;

function recordRequest() {
  const requests: Array<{
    url: string;
    init?: RequestInit;
  }> = [];

  return {
    requests,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url:
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        init,
      });
      return new Response(null, { status: 204 });
    }) as typeof fetch,
  };
}

test("runMacPush posts an authenticated Mac heartbeat", async () => {
  const { requests, fetchImpl } = recordRequest();
  let nowCalls = 0;

  await runMacPush({
    endpoint: ENDPOINT,
    token: TOKEN,
    machineId: MAC_ID,
    machineName: MAC_NAME,
    now: () => {
      nowCalls += 1;
      return new Date(FIXED_NOW);
    },
    collect: async () => MAC_READING,
    fetchImpl,
  });

  assert.equal(requests.length, 1);
  assert.equal(nowCalls, 1);
  assert.equal(requests[0]?.url, ENDPOINT);
  assert.equal(requests[0]?.init?.method, "POST");

  const headers = new Headers(requests[0]?.init?.headers);
  assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    machine: {
      id: MAC_ID,
      name: MAC_NAME,
      status: "online",
      cpuPercent: 21,
      memoryPercent: 43,
      diskPercent: 67,
      battery: { percent: 82, charging: false },
      lastSeenAt: FIXED_NOW,
    },
  });
});

test("runMacPush preserves unavailable desktop readings as null", async () => {
  const { requests, fetchImpl } = recordRequest();

  await runMacPush({
    endpoint: ENDPOINT,
    token: TOKEN,
    machineId: MAC_ID,
    machineName: MAC_NAME,
    now: () => new Date(FIXED_NOW),
    collect: async () => ({
      cpuPercent: null,
      memoryPercent: 58,
      diskPercent: 71,
      battery: null,
    }),
    fetchImpl,
  });

  const body = JSON.parse(String(requests[0]?.init?.body));
  assert.equal(body.machine.cpuPercent, null);
  assert.equal(body.machine.battery, null);
});

test("runMacPush rejects a failed hosted response without exposing the token", async () => {
  await assert.rejects(
    () =>
      runMacPush({
        endpoint: ENDPOINT,
        token: TOKEN,
        machineId: MAC_ID,
        machineName: MAC_NAME,
        now: () => new Date(FIXED_NOW),
        collect: async () => MAC_READING,
        fetchImpl: async () => new Response("unavailable", { status: 503 }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Mac push failed: 503");
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    },
  );
});
