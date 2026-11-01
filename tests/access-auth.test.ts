import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as A from "../src/lib/access-auth.ts";

const NOW = Date.parse("2026-11-01T17:00:00.000Z");
const TEAM_DOMAIN = "https://twilight-wildflower-b227.cloudflareaccess.com";
const AUDIENCE =
  "664b2ba4711405313275fbc48ce565c87fa257899dd5ee5e93679eccff36d4c7";
const ALLOWED_EMAIL = "hi@joshmccoy.dev";

type AccessJwk = JsonWebKey & { kid: string };

let signingKeys: CryptoKeyPair;
let trustedJwk: AccessJwk;

before(async () => {
  signingKeys = await generateKeyPair();
  trustedJwk = {
    ...(await crypto.subtle.exportKey("jwk", signingKeys.publicKey)),
    kid: "k1",
  };
});

beforeEach(() => {
  A.__resetAccessCertCache();
});

async function generateKeyPair(): Promise<CryptoKeyPair> {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  return keys as CryptoKeyPair;
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

function claims(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    iss: TEAM_DOMAIN,
    aud: AUDIENCE,
    email: ALLOWED_EMAIL,
    iat: Math.floor(NOW / 1000) - 10,
    nbf: Math.floor(NOW / 1000) - 10,
    exp: Math.floor(NOW / 1000) + 3600,
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

function options() {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ keys: [trustedJwk] }), {
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  return { fetchImpl, now: NOW };
}

test("verifyAccessJwt accepts a valid token for the allowed email", async () => {
  const token = await makeToken(signingKeys, claims());

  assert.deepEqual(await A.verifyAccessJwt(token, options()), {
    ok: true,
    email: ALLOWED_EMAIL,
  });
});

test("verifyAccessJwt reports a missing token", async () => {
  assert.deepEqual(await A.verifyAccessJwt(null, options()), {
    ok: false,
    reason: "missing",
  });
});

test("verifyAccessJwt reports a malformed token", async () => {
  assert.deepEqual(await A.verifyAccessJwt("not-a-jwt", options()), {
    ok: false,
    reason: "malformed",
  });
});

test("verifyAccessJwt rejects a token signed by another key", async () => {
  const otherKeys = await generateKeyPair();
  const token = await makeToken(otherKeys, claims());

  assert.deepEqual(await A.verifyAccessJwt(token, options()), {
    ok: false,
    reason: "signature",
  });
});

test("verifyAccessJwt rejects the wrong audience", async () => {
  const token = await makeToken(signingKeys, claims({ aud: "other-audience" }));

  assert.deepEqual(await A.verifyAccessJwt(token, options()), {
    ok: false,
    reason: "aud",
  });
});

test("verifyAccessJwt rejects the wrong email", async () => {
  const token = await makeToken(
    signingKeys,
    claims({ email: "someone-else@example.com" }),
  );

  assert.deepEqual(await A.verifyAccessJwt(token, options()), {
    ok: false,
    reason: "email",
  });
});

test("verifyAccessJwt rejects an expired token", async () => {
  const token = await makeToken(
    signingKeys,
    claims({ exp: Math.floor(NOW / 1000) - 120 }),
  );

  assert.deepEqual(await A.verifyAccessJwt(token, options()), {
    ok: false,
    reason: "expired",
  });
});

test("isAccessAuthorized checks the Cloudflare Access JWT header", async () => {
  const token = await makeToken(signingKeys, claims());
  const authorized = new Request("https://dashboard.example/", {
    headers: { "cf-access-jwt-assertion": token },
  });
  const missing = new Request("https://dashboard.example/");

  assert.equal(await A.isAccessAuthorized(authorized, options()), true);
  assert.equal(await A.isAccessAuthorized(missing, options()), false);
});
