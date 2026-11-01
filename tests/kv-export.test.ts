import test from "node:test";
import assert from "node:assert/strict";
import { pushSnapshotToKv } from "../scripts/kv-export.ts";

const FIXED = "2026-11-01T16:30:00.000Z";
const ENDPOINT =
  "https://api.cloudflare.test/client/v4/accounts/synthetic-account/storage/kv/namespaces/synthetic-namespace/values/dashboard";
const TOKEN = "synthetic-test-token";

const SNAPSHOT = {
  version: 1,
  serverTime: FIXED,
  seq: 42,
  history: {
    systems: [{ cpu: 21, memory: 34, disk: 56 }],
  },
  data: {
    weather: {
      loading: false,
      data: { temperature: 71, condition: "Clear" },
      source: "real",
      provider: "Synthetic weather",
      status: "ready",
      lastSuccess: FIXED,
      lastAttempt: FIXED,
      error: null,
      refreshMs: 900000,
    },
  },
} as const;

test("pushes the local snapshot JSON to the configured KV value endpoint", async () => {
  const requests: Array<{
    url: string;
    init?: RequestInit;
  }> = [];

  await pushSnapshotToKv(SNAPSHOT, {
    endpoint: ENDPOINT,
    token: TOKEN,
    fetchImpl: async (input, init) => {
      requests.push({
        url:
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        init,
      });
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, ENDPOINT);
  assert.equal(requests[0]?.init?.method, "PUT");
  const headers = new Headers(requests[0]?.init?.headers);
  assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), SNAPSHOT);
});

test("does nothing when the box has no local snapshot", async () => {
  let calls = 0;

  const result = await pushSnapshotToKv(null, {
    endpoint: ENDPOINT,
    token: TOKEN,
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(result, false);
  assert.equal(calls, 0);
});

test("rejects a failed KV response without exposing the token", async () => {
  await assert.rejects(
    () =>
      pushSnapshotToKv(SNAPSHOT, {
        endpoint: ENDPOINT,
        token: TOKEN,
        fetchImpl: async () => new Response("unavailable", { status: 503 }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /KV export failed: 503/);
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    },
  );
});
