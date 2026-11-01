import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as accessAuth from "../src/lib/access-auth.ts";

const NOW = Date.parse("2026-11-01T17:00:00.000Z");
const COOLDOWN_MS = accessAuth.FORCED_REFRESH_COOLDOWN_MS;
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

async function publicJwk(keys: CryptoKeyPair, kid: string): Promise<AccessJwk> {
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
  now = NOW,
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

function certificateResponse(jwk: AccessJwk): Response {
  return new Response(JSON.stringify({ keys: [jwk] }), {
    headers: { "content-type": "application/json" },
  });
}

test("a known-kid signature refresh shares its cooldown with unknown kids", async () => {
  const trustedKeys = await generateKeyPair();
  const untrustedKeys = await generateKeyPair();
  const trustedJwk = await publicJwk(trustedKeys, "shared-kid");
  const validToken = await makeToken(trustedKeys, trustedJwk.kid);
  const badSignatureToken = await makeToken(
    untrustedKeys,
    trustedJwk.kid,
    NOW + COOLDOWN_MS,
  );
  const unknownKidToken = await makeToken(
    trustedKeys,
    "unknown-after-refresh",
    NOW + COOLDOWN_MS + 3_000,
  );
  let certFetchCount = 0;
  const fetchImpl = (async () => {
    certFetchCount += 1;
    return certificateResponse(trustedJwk);
  }) as typeof fetch;

  assert.deepEqual(
    await accessAuth.verifyAccessJwt(validToken, { fetchImpl, now: NOW }),
    { ok: true, email: ALLOWED_EMAIL },
  );
  assert.equal(certFetchCount, 1);

  assert.deepEqual(
    await accessAuth.verifyAccessJwt(badSignatureToken, {
      fetchImpl,
      now: NOW + COOLDOWN_MS,
    }),
    { ok: false, reason: "signature" },
  );
  assert.equal(
    certFetchCount,
    2,
    "an aged signature failure should force one refresh",
  );

  for (const elapsed of [1_000, 2_000]) {
    assert.deepEqual(
      await accessAuth.verifyAccessJwt(badSignatureToken, {
        fetchImpl,
        now: NOW + COOLDOWN_MS + elapsed,
      }),
      { ok: false, reason: "signature" },
    );
  }
  assert.equal(
    certFetchCount,
    2,
    "repeated signature failures inside the cooldown should not refetch",
  );

  assert.deepEqual(
    await accessAuth.verifyAccessJwt(unknownKidToken, {
      fetchImpl,
      now: NOW + COOLDOWN_MS + 3_000,
    }),
    { ok: false, reason: "signature" },
  );
  assert.equal(
    certFetchCount,
    2,
    "the known-kid refresh should also cover the unknown-kid path",
  );
});

test("an unknown-kid refresh prevents a known-kid signature refresh in its cooldown", async () => {
  const trustedKeys = await generateKeyPair();
  const untrustedKeys = await generateKeyPair();
  const trustedJwk = await publicJwk(trustedKeys, "known-kid");
  const validToken = await makeToken(trustedKeys, trustedJwk.kid);
  const unknownKidToken = await makeToken(
    trustedKeys,
    "unknown-first",
    NOW + COOLDOWN_MS,
  );
  const badSignatureToken = await makeToken(
    untrustedKeys,
    trustedJwk.kid,
    NOW + COOLDOWN_MS + 30_000,
  );
  let certFetchCount = 0;
  const fetchImpl = (async () => {
    certFetchCount += 1;
    return certificateResponse(trustedJwk);
  }) as typeof fetch;

  assert.deepEqual(
    await accessAuth.verifyAccessJwt(validToken, { fetchImpl, now: NOW }),
    { ok: true, email: ALLOWED_EMAIL },
  );
  assert.deepEqual(
    await accessAuth.verifyAccessJwt(unknownKidToken, {
      fetchImpl,
      now: NOW + COOLDOWN_MS,
    }),
    { ok: false, reason: "signature" },
  );
  assert.equal(certFetchCount, 2);

  assert.deepEqual(
    await accessAuth.verifyAccessJwt(badSignatureToken, {
      fetchImpl,
      now: NOW + COOLDOWN_MS + 30_000,
    }),
    { ok: false, reason: "signature" },
  );
  assert.equal(
    certFetchCount,
    2,
    "a known-kid signature failure should honor the unknown-kid cooldown",
  );
});

for (const failureMode of ["non-ok response", "rejected fetch"] as const) {
  test(`a forced refresh records its cooldown after a ${failureMode}`, async () => {
    const trustedKeys = await generateKeyPair();
    const untrustedKeys = await generateKeyPair();
    const trustedJwk = await publicJwk(trustedKeys, "known-kid");
    const validToken = await makeToken(trustedKeys, trustedJwk.kid);
    const badSignatureToken = await makeToken(
      untrustedKeys,
      trustedJwk.kid,
      NOW + COOLDOWN_MS,
    );
    let certFetchCount = 0;
    const fetchImpl = (async () => {
      certFetchCount += 1;
      if (certFetchCount === 1) return certificateResponse(trustedJwk);
      if (failureMode === "rejected fetch") {
        throw new Error("synthetic certificate fetch rejection");
      }
      return new Response(null, { status: 503 });
    }) as typeof fetch;

    assert.deepEqual(
      await accessAuth.verifyAccessJwt(validToken, { fetchImpl, now: NOW }),
      { ok: true, email: ALLOWED_EMAIL },
    );
    assert.deepEqual(
      await accessAuth.verifyAccessJwt(badSignatureToken, {
        fetchImpl,
        now: NOW + COOLDOWN_MS,
      }),
      { ok: false, reason: "certificates" },
    );
    assert.equal(certFetchCount, 2);

    for (const elapsed of [1_000, 2_000]) {
      assert.deepEqual(
        await accessAuth.verifyAccessJwt(badSignatureToken, {
          fetchImpl,
          now: NOW + COOLDOWN_MS + elapsed,
        }),
        { ok: false, reason: "certificates" },
      );
    }
    assert.equal(
      certFetchCount,
      2,
      "a failed forced refresh should still start the shared cooldown",
    );
  });
}
