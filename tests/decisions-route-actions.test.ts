import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, type TestContext } from "node:test";

import { POST } from "@/app/api/decisions/route";
import { __resetAccessCertCache } from "@/lib/access-auth";

const POST_URL = "https://example.test/api/decisions";
const POST_ORIGIN = new URL(POST_URL).origin;
const ACCESS_TEAM_DOMAIN =
  "https://twilight-wildflower-b227.cloudflareaccess.com";
const ACCESS_AUD =
  "664b2ba4711405313275fbc48ce565c87fa257899dd5ee5e93679eccff36d4c7";
const ACCESS_CERTS_URL = `${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
const ALLOWED_EMAIL = "hi@joshmccoy.dev";
const ISSUED_AT = Date.parse("2026-11-01T17:00:00.000Z") / 1000;
const NOT_BEFORE = ISSUED_AT - 10;
const EXPIRES_AT = 4_102_444_800;
const DECISION_ID = "d_aaaaaaaaaaaa";
const ACTIONS_KEY = "decision-actions";
const GENERATED_AT = "2026-11-01T16:30:00.000Z";
const QUESTION = "Synthetic decision alpha?";

type AccessJwk = JsonWebKey & { kid: string };

type PutRecord = {
  key: string;
  value: string;
};

type FakeKvBinding = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

type FakeKv = {
  binding: FakeKvBinding;
  values: Map<string, string>;
  puts: PutRecord[];
};

type Snapshot = {
  generatedAt: string;
  count: number;
  cards: Array<{
    id: string;
    source: string;
    bot: string;
    question: string;
    rec: string;
    context: string;
    link: string;
    createdAt: string | null;
    due: string | null;
    blocking: boolean;
    ageMin: number | null;
  }>;
};

const syntheticSnapshot: Snapshot = {
  generatedAt: GENERATED_AT,
  count: 1,
  cards: [
    {
      id: DECISION_ID,
      source: "decisions",
      bot: "analyst",
      question: QUESTION,
      rec: "Use the synthetic fixture.",
      context: "",
      link: "03 Resources/_Meta/Decisions.md",
      createdAt: "2026-11-01T16:20:00.000Z",
      due: null,
      blocking: false,
      ageMin: 10,
    },
  ],
};

const feedsValue = JSON.stringify({
  decisions: {
    data: syntheticSnapshot,
    updatedAt: "2026-11-01T16:29:00.000Z",
    stale: false,
    source: "box",
  },
});

let signingKeys: CryptoKeyPair;
let trustedJwk: AccessJwk;
let isolatedRoot = "";
let originalDecisionsVault: string | undefined;
let originalDecisionsReminders: string | undefined;

before(async () => {
  signingKeys = await generateKeyPair();
  trustedJwk = {
    ...(await crypto.subtle.exportKey("jwk", signingKeys.publicKey)),
    kid: "k1",
  };

  isolatedRoot = await mkdtemp(
    path.join(tmpdir(), "decisions-route-actions-test-"),
  );
  originalDecisionsVault = process.env.DECISIONS_VAULT;
  originalDecisionsReminders = process.env.DECISIONS_REMINDERS;
  process.env.DECISIONS_VAULT = isolatedRoot;
  process.env.DECISIONS_REMINDERS = path.join(
    isolatedRoot,
    "missing-reminders.md",
  );
});

after(async () => {
  if (originalDecisionsVault === undefined) {
    delete process.env.DECISIONS_VAULT;
  } else {
    process.env.DECISIONS_VAULT = originalDecisionsVault;
  }

  if (originalDecisionsReminders === undefined) {
    delete process.env.DECISIONS_REMINDERS;
  } else {
    process.env.DECISIONS_REMINDERS = originalDecisionsReminders;
  }

  await rm(isolatedRoot, { recursive: true, force: true });
});

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

function base64UrlEncode(value: string | ArrayBuffer): string {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function accessClaims(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    iss: ACCESS_TEAM_DOMAIN,
    aud: ACCESS_AUD,
    email: ALLOWED_EMAIL,
    iat: ISSUED_AT,
    nbf: NOT_BEFORE,
    exp: EXPIRES_AT,
    ...overrides,
  };
}

async function makeToken(
  keys: CryptoKeyPair,
  payload: Record<string, unknown>,
): Promise<string> {
  const encodedHeader = base64UrlEncode(
    JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }),
  );
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function installAccessCertFetch(t: TestContext): void {
  const originalFetch = globalThis.fetch;
  __resetAccessCertCache();

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), ACCESS_CERTS_URL);
    return new Response(JSON.stringify({ keys: [trustedJwk] }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
    __resetAccessCertCache();
  });
}

function createFakeKv(): FakeKv {
  const values = new Map<string, string>([["feeds", feedsValue]]);
  const puts: PutRecord[] = [];

  return {
    values,
    puts,
    binding: {
      async get(key: string): Promise<string | null> {
        return values.get(key) ?? null;
      },
      async put(key: string, value: string): Promise<void> {
        puts.push({ key, value });
        values.set(key, value);
      },
    },
  };
}

function contextFor(kv: FakeKv) {
  return {
    snapshot: async (): Promise<Snapshot> => ({
      generatedAt: GENERATED_AT,
      count: 0,
      cards: [],
    }),
    env: { FEEDS_KV: kv.binding },
  };
}

async function accessToken(): Promise<string> {
  return makeToken(signingKeys, accessClaims());
}

async function postJson(
  kv: FakeKv,
  values: { id: string; choice: string; reply: string },
  options: { origin?: string | null; token?: string | null } = {},
): Promise<Response> {
  const token =
    options.token === undefined ? await accessToken() : options.token;
  const origin =
    options.origin === undefined ? POST_ORIGIN : options.origin;
  const headers = new Headers({ "content-type": "application/json" });
  if (origin !== null) headers.set("origin", origin);
  if (token !== null) headers.set("cf-access-jwt-assertion", token);

  return POST(
    new Request(POST_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(values),
    }),
    contextFor(kv),
  );
}

function storedActions(kv: FakeKv): unknown[] {
  const stored = kv.values.get(ACTIONS_KEY);
  assert.ok(stored, "expected decision actions in KV");
  const parsed: unknown = JSON.parse(stored);
  assert.ok(Array.isArray(parsed));
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findAction(kv: FakeKv, decisionId: string): Record<string, unknown> {
  const action = storedActions(kv).find(
    (value) => isRecord(value) && value.decisionId === decisionId,
  );
  assert.ok(isRecord(action));
  return action;
}

test("JSON choice uses the KV decision snapshot and records a chosen action", async (t) => {
  installAccessCertFetch(t);
  const kv = createFakeKv();

  const response = await postJson(kv, {
    id: DECISION_ID,
    choice: "yes",
    reply: "",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "chosen" });
  const action = findAction(kv, DECISION_ID);
  assert.equal(action.choice, "yes");
  assert.equal(action.status, "chosen");
  assert.equal(action.bot, "analyst");
  assert.equal(action.question, QUESTION);
});

test("JSON choice returns decision not found for an unknown KV card", async (t) => {
  installAccessCertFetch(t);
  const kv = createFakeKv();

  const response = await postJson(kv, {
    id: "d_bbbbbbbbbbbb",
    choice: "yes",
    reply: "",
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "decision not found" });
  assert.equal(kv.puts.length, 0);
});

test("foreign Origin is rejected without writing an action", async (t) => {
  installAccessCertFetch(t);
  const kv = createFakeKv();

  const response = await postJson(
    kv,
    { id: DECISION_ID, choice: "yes", reply: "" },
    { origin: "https://foreign.example" },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "cross-origin" });
  assert.equal(kv.puts.length, 0);
});

test("POST without an Access JWT returns 401", async (t) => {
  installAccessCertFetch(t);
  const kv = createFakeKv();

  const response = await postJson(
    kv,
    { id: DECISION_ID, choice: "yes", reply: "" },
    { token: null },
  );

  assert.equal(response.status, 401);
  assert.equal(kv.puts.length, 0);
});

test("undo marks a chosen action as undone", async (t) => {
  installAccessCertFetch(t);
  const kv = createFakeKv();

  const chosen = await postJson(kv, {
    id: DECISION_ID,
    choice: "yes",
    reply: "",
  });
  assert.equal(chosen.status, 200);

  const response = await postJson(kv, {
    id: DECISION_ID,
    choice: "undo",
    reply: "",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "undone" });
  const action = findAction(kv, DECISION_ID);
  assert.equal(action.status, "undone");
  assert.equal(typeof action.undoneAt, "string");
});

test("form POST records the choice and redirects to /decisions", async (t) => {
  installAccessCertFetch(t);
  const kv = createFakeKv();
  const token = await accessToken();
  const form = new URLSearchParams({
    id: DECISION_ID,
    choice: "yes",
    reply: "",
  });

  const response = await POST(
    new Request(POST_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: POST_ORIGIN,
        "cf-access-jwt-assertion": token,
      },
      body: form,
    }),
    contextFor(kv),
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/decisions");
  assert.equal(findAction(kv, DECISION_ID).status, "chosen");
});
