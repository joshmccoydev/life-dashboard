import test from "node:test";
import assert from "node:assert/strict";
import * as accessAuth from "../src/lib/access-auth.ts";

const NOW = Date.parse("2026-11-01T17:00:00.000Z");
const FORCED_REFRESH_COOLDOWN_MS = 60_000;
const TEAM_DOMAIN = "https://twilight-wildflower-b227.cloudflareaccess.com";
const AUDIENCE =
  "664b2ba4711405313275fbc48ce565c87fa257899dd5ee5e93679eccff36d4c7";
const ALLOWED_EMAIL = "hi@joshmccoy.dev";

type AccessJwk = JsonWebKey & { kid: string };

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

function claims(): Record<string, unknown> {
  return {
    iss: TEAM_DOMAIN,
    aud: AUDIENCE,
    email: ALLOWED_EMAIL,
    iat: Math.floor(NOW / 1000) - 10,
    nbf: Math.floor(NOW / 1000) - 10,
    exp: Math.floor(NOW / 1000) + 3600,
  };
}

async function makeToken(
  keys: CryptoKeyPair,
  kid: string,
): Promise<string> {
  const encodedHeader = base64UrlEncode(
    JSON.stringify({ alg: "RS256", kid, typ: "JWT" }),
  );
  const encodedPayload = base64UrlEncode(JSON.stringify(claims()));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

test("unknown-kid certificate refreshes are limited by a 60s cooldown", async () => {
  accessAuth.__resetAccessCertCache();

  const signingKeys = await generateKeyPair();
  const trustedJwk: AccessJwk = {
    ...(await crypto.subtle.exportKey("jwk", signingKeys.publicKey)),
    kid: "trusted-key",
  };
  let certFetchCount = 0;
  const fetchImpl = (async () => {
    certFetchCount += 1;
    return new Response(JSON.stringify({ keys: [trustedJwk] }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const validToken = await makeToken(signingKeys, trustedJwk.kid);
  const options = { fetchImpl, now: NOW };

  assert.deepEqual(await accessAuth.verifyAccessJwt(validToken, options), {
    ok: true,
    email: ALLOWED_EMAIL,
  });
  assert.equal(certFetchCount, 1, "the valid token should load certificates");

  for (let index = 0; index < 5; index += 1) {
    const unknownToken = await makeToken(signingKeys, `unknown-${index}`);
    assert.deepEqual(
      await accessAuth.verifyAccessJwt(unknownToken, {
        ...options,
        now: NOW + index * 1_000,
      }),
      { ok: false, reason: "signature" },
    );
  }

  assert.equal(
    certFetchCount,
    2,
    "five unknown kids inside the cooldown should cause one forced refresh",
  );

  const postCooldownToken = await makeToken(signingKeys, "unknown-after");
  assert.deepEqual(
    await accessAuth.verifyAccessJwt(postCooldownToken, {
      ...options,
      now: NOW + FORCED_REFRESH_COOLDOWN_MS + 1,
    }),
    { ok: false, reason: "signature" },
  );
  assert.equal(
    certFetchCount,
    3,
    "one more forced refresh should be allowed after the cooldown",
  );

  assert.deepEqual(
    await accessAuth.verifyAccessJwt(validToken, {
      ...options,
      now: NOW + FORCED_REFRESH_COOLDOWN_MS + 1,
    }),
    { ok: true, email: ALLOWED_EMAIL },
  );
});
