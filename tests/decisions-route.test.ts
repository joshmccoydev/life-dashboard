import test, { before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { __resetAccessCertCache } from "@/lib/access-auth";
import { GET, POST } from "@/app/api/decisions/route";

const DECISIONS_PATH = path.join("03 Resources", "_Meta", "Decisions.md");
const OPEN_ASK =
  "- [ ] [ASK] 2026-11-01 09:30 CT | owner: Woz | q: Merge PR 2?";
const POST_URL = "https://example.test/api/decisions";
const ACCESS_TEAM_DOMAIN =
  "https://twilight-wildflower-b227.cloudflareaccess.com";
const ACCESS_AUD =
  "664b2ba4711405313275fbc48ce565c87fa257899dd5ee5e93679eccff36d4c7";
const ACCESS_CERTS_URL = `${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
const ALLOWED_EMAIL = "hi@joshmccoy.dev";
const ISSUED_AT = Date.parse("2026-11-01T17:00:00.000Z") / 1000;
const NOT_BEFORE = ISSUED_AT - 10;
const EXPIRES_AT = 4_102_444_800;

const ENV_KEYS = [
  "DECISIONS_VAULT",
  "DECISIONS_REMINDERS",
  "DECISIONS_TOKEN",
] as const;

type AccessJwk = JsonWebKey & { kid: string };

type TestFixture = {
  decisionsFile: string;
  originalBytes: Buffer;
  id: string;
};

let signingKeys: CryptoKeyPair;
let trustedJwk: AccessJwk;

before(async () => {
  signingKeys = await generateKeyPair();
  trustedJwk = {
    ...(await crypto.subtle.exportKey("jwk", signingKeys.publicKey)),
    kid: "k1",
  };
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

function accessHeaders(token: string): HeadersInit {
  return { "cf-access-jwt-assertion": token };
}

async function createFixture(t: TestContext): Promise<TestFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "decisions-route-"));
  const decisionsFile = path.join(root, DECISIONS_PATH);
  const remindersFile = path.join(root, "missing-reminders.md");
  const originalEnv = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;

  t.after(async () => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    await rm(root, { recursive: true, force: true });
  });

  await mkdir(path.dirname(decisionsFile), { recursive: true });
  await writeFile(decisionsFile, OPEN_ASK);

  process.env.DECISIONS_VAULT = root;
  process.env.DECISIONS_REMINDERS = remindersFile;
  delete process.env.DECISIONS_TOKEN;

  const digest = createHash("sha256")
    .update(`decisions|${OPEN_ASK.trim()}`)
    .digest("hex");

  return {
    decisionsFile,
    originalBytes: await readFile(decisionsFile),
    id: `d_${digest.slice(0, 12)}`,
  };
}

function submission(id: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, choice: "yes", reply: "ship it" }),
  };
}

test("GET without a Cloudflare Access header returns 401 without decision text", async (t) => {
  installAccessCertFetch(t);
  await createFixture(t);

  const response = await GET(new Request(POST_URL));
  const body = await response.text();

  assert.equal(response.status, 401);
  assert.equal(body.includes("Merge PR 2?"), false);
});

test("GET with a bad-signature JWT returns 401", async (t) => {
  installAccessCertFetch(t);
  await createFixture(t);
  const otherKeys = await generateKeyPair();
  const token = await makeToken(otherKeys, accessClaims());

  const response = await GET(
    new Request(POST_URL, { headers: accessHeaders(token) }),
  );

  assert.equal(response.status, 401);
});

test("GET with the wrong audience returns 401", async (t) => {
  installAccessCertFetch(t);
  await createFixture(t);
  const token = await makeToken(
    signingKeys,
    accessClaims({ aud: "wrong-audience" }),
  );

  const response = await GET(
    new Request(POST_URL, { headers: accessHeaders(token) }),
  );

  assert.equal(response.status, 401);
});

test("GET with the wrong email returns 401", async (t) => {
  installAccessCertFetch(t);
  await createFixture(t);
  const token = await makeToken(
    signingKeys,
    accessClaims({ email: "someone-else@example.com" }),
  );

  const response = await GET(
    new Request(POST_URL, { headers: accessHeaders(token) }),
  );

  assert.equal(response.status, 401);
});

test("GET with a valid Cloudflare Access JWT returns 200 JSON", async (t) => {
  installAccessCertFetch(t);
  await createFixture(t);
  const token = await makeToken(signingKeys, accessClaims());

  const response = await GET(
    new Request(POST_URL, { headers: accessHeaders(token) }),
  );
  const body = (await response.json()) as {
    cards?: Array<{ question?: unknown }>;
  };

  assert.equal(response.status, 200);
  assert.equal(
    body.cards?.some((card) => card.question === "Merge PR 2?"),
    true,
  );
});

test("POST without a Cloudflare Access header returns 401 and preserves the decisions file", async (t) => {
  installAccessCertFetch(t);
  const fixture = await createFixture(t);

  const response = await POST(new Request(POST_URL, submission(fixture.id)));

  assert.equal(response.status, 401);
  assert.deepEqual(
    await readFile(fixture.decisionsFile),
    fixture.originalBytes,
  );
});

test("POST with a valid Cloudflare Access JWT appends the answer and preserves the original ASK line", async (t) => {
  installAccessCertFetch(t);
  const fixture = await createFixture(t);
  const token = await makeToken(signingKeys, accessClaims());
  const init = submission(fixture.id);

  const response = await POST(
    new Request(POST_URL, {
      ...init,
      headers: {
        ...init.headers,
        ...accessHeaders(token),
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, added: true });

  const updatedBytes = await readFile(fixture.decisionsFile);
  assert.deepEqual(
    updatedBytes.subarray(0, fixture.originalBytes.length),
    fixture.originalBytes,
  );

  const appended = updatedBytes
    .subarray(fixture.originalBytes.length)
    .toString("utf8");
  assert.equal(appended.startsWith("\n"), true);

  const appendedLines = appended.slice(1).split("\n");
  assert.equal(appendedLines.length, 2);
  assert.equal(appendedLines[1], "");
  assert.equal(appendedLines[0].includes('Josh: "ship it"'), true);
  assert.equal(appendedLines[0].includes("owner: Woz"), true);
  assert.equal(appendedLines[0].includes("via: dash"), true);

  const updatedText = updatedBytes.toString("utf8");
  assert.equal(updatedText.startsWith(OPEN_ASK), true);
  assert.equal(updatedText.includes(OPEN_ASK), true);
});

test("form POST with a valid Cloudflare Access JWT redirects to /decisions without a token query", async (t) => {
  installAccessCertFetch(t);
  const fixture = await createFixture(t);
  const token = await makeToken(signingKeys, accessClaims());
  const form = new URLSearchParams({
    id: fixture.id,
    choice: "yes",
    reply: "ship it",
  });

  const response = await POST(
    new Request(POST_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...accessHeaders(token),
      },
      body: form,
    }),
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/decisions");
});

test("a valid query token alone does not authorize access", async (t) => {
  installAccessCertFetch(t);
  await createFixture(t);
  process.env.DECISIONS_TOKEN = "test-token";

  const response = await GET(new Request(`${POST_URL}?t=test-token`));
  const body = await response.text();

  assert.equal(response.status, 401);
  assert.equal(body.includes("Merge PR 2?"), false);
});
