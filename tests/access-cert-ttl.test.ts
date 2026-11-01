import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as accessAuth from "../src/lib/access-auth.ts";

const NOW = Date.parse("2026-11-01T17:00:00.000Z");
const CERT_CACHE_TTL_MS = 3_600_000;
const TEAM_DOMAIN = "https://twilight-wildflower-b227.cloudflareaccess.com";
const AUDIENCE =
  "664b2ba4711405313275fbc48ce565c87fa257899dd5ee5e93679eccff36d4c7";
const ALLOWED_EMAIL = "hi@joshmccoy.dev";

type AccessJwk = JsonWebKey & { kid: string };

beforeEach(() => {
  accessAuth.__resetAccessCertCache();
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

async function publicJwk(
  keys: CryptoKeyPair,
  kid: string,
): Promise<AccessJwk> {
  return {
    ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
    kid,
  };
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

function claims(now: number): Record<string, unknown> {
  return {
    iss: TEAM_DOMAIN,
    aud: AUDIENCE,
    email: ALLOWED_EMAIL,
    iat: Math.floor(now / 1000) - 10,
    nbf: Math.floor(now / 1000) - 10,
    exp: Math.floor(now / 1000) + 86_400,
  };
}

async function makeToken(
  keys: CryptoKeyPair,
  kid: string,
  now: number,
): Promise<string> {
  const encodedHeader = base64UrlEncode(
    JSON.stringify({ alg: "RS256", kid, typ: "JWT" }),
  );
  const encodedPayload = base64UrlEncode(JSON.stringify(claims(now)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

test("Access certificates are refetched after the cache TTL expires", async () => {
  const signingKeys = await generateKeyPair();
  const trustedJwk = await publicJwk(signingKeys, "same-kid");
  const token = await makeToken(signingKeys, trustedJwk.kid, NOW);
  let certFetchCount = 0;
  const fetchImpl = (async () => {
    certFetchCount += 1;
    return new Response(JSON.stringify({ keys: [trustedJwk] }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  assert.deepEqual(
    await accessAuth.verifyAccessJwt(token, { fetchImpl, now: NOW }),
    { ok: true, email: ALLOWED_EMAIL },
  );
  assert.equal(certFetchCount, 1, "the first token should fetch certificates");

  assert.deepEqual(
    await accessAuth.verifyAccessJwt(token, {
      fetchImpl,
      now: NOW + CERT_CACHE_TTL_MS + 1,
    }),
    { ok: true, email: ALLOWED_EMAIL },
  );
  assert.equal(
    certFetchCount,
    2,
    "a cache older than its TTL should be refetched before lookup",
  );
});

test("a rotated key under the same kid is forced-refreshed after the cooldown", async () => {
  const oldKeys = await generateKeyPair();
  const newKeys = await generateKeyPair();
  const kid = "rotating-kid";
  const oldJwk = await publicJwk(oldKeys, kid);
  const newJwk = await publicJwk(newKeys, kid);
  let publishedJwk = oldJwk;
  let certFetchCount = 0;
  const fetchImpl = (async () => {
    certFetchCount += 1;
    return new Response(JSON.stringify({ keys: [publishedJwk] }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const oldToken = await makeToken(oldKeys, kid, NOW);
  assert.deepEqual(
    await accessAuth.verifyAccessJwt(oldToken, { fetchImpl, now: NOW }),
    { ok: true, email: ALLOWED_EMAIL },
  );
  assert.equal(certFetchCount, 1, "the initial token should cache the old key");

  publishedJwk = newJwk;
  const rotatedAt = NOW + accessAuth.FORCED_REFRESH_COOLDOWN_MS + 1;
  const newToken = await makeToken(newKeys, kid, rotatedAt);
  assert.deepEqual(
    await accessAuth.verifyAccessJwt(newToken, {
      fetchImpl,
      now: rotatedAt,
    }),
    { ok: true, email: ALLOWED_EMAIL },
  );
  assert.equal(
    certFetchCount,
    2,
    "a cached-key verification failure after the cooldown should force one refetch",
  );
});
