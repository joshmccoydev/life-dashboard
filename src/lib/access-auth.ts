const ACCESS_TEAM_DOMAIN =
  "https://twilight-wildflower-b227.cloudflareaccess.com";
const ACCESS_AUDIENCE =
  "664b2ba4711405313275fbc48ce565c87fa257899dd5ee5e93679eccff36d4c7";
const ALLOWED_EMAIL = "hi@joshmccoy.dev";
const ACCESS_CERTS_URL = `${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
export const CERT_CACHE_TTL_MS = 3_600_000;
export const FORCED_REFRESH_COOLDOWN_MS = 60_000;
const RS256 = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
} as const;

export type AccessJwtFailureReason =
  | "missing"
  | "malformed"
  | "certificates"
  | "signature"
  | "issuer"
  | "aud"
  | "email"
  | "not-before"
  | "expired";

export type AccessJwtResult =
  { ok: true; email: string } | { ok: false; reason: AccessJwtFailureReason };

export type AccessAuthOptions = {
  fetchImpl: typeof fetch;
  now: number;
};

type JwkWithId = JsonWebKey & { kid: string };
type DecodedJwt = {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array<ArrayBuffer>;
};

type CertificateCacheEntry = {
  keys: Promise<Map<string, JwkWithId>>;
  cachedAt: number;
};

let certificateCache: CertificateCacheEntry | null = null;
let lastForcedRefreshAt: number | null = null;

export function __resetAccessCertCache(): void {
  certificateCache = null;
  lastForcedRefreshAt = null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("Invalid base64url");
  }

  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function decodeJsonObject(value: string): Record<string, unknown> {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    decodeBase64Url(value),
  );
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("JWT segment is not an object");
  return parsed;
}

function decodeJwt(token: string): DecodedJwt | null {
  const segments = token.split(".");
  if (
    segments.length !== 3 ||
    segments.some((segment) => segment.length === 0)
  ) {
    return null;
  }

  try {
    const header = decodeJsonObject(segments[0]);
    const payload = decodeJsonObject(segments[1]);
    const signature = decodeBase64Url(segments[2]);

    if (
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      header.kid.length === 0
    ) {
      return null;
    }

    return {
      header,
      payload,
      signingInput: `${segments[0]}.${segments[1]}`,
      signature,
    };
  } catch {
    return null;
  }
}

function isJwkWithId(value: unknown): value is JwkWithId {
  return (
    isRecord(value) && typeof value.kid === "string" && value.kid.length > 0
  );
}

async function fetchAccessKeys(
  fetchImpl: typeof fetch,
): Promise<Map<string, JwkWithId>> {
  const response = await fetchImpl(ACCESS_CERTS_URL, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("Unable to fetch Access certificates");

  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.keys)) {
    throw new Error("Invalid Access certificate response");
  }

  const keys = new Map<string, JwkWithId>();
  for (const value of body.keys) {
    if (!isJwkWithId(value)) continue;
    keys.set(value.kid, value);
  }

  if (keys.size === 0) throw new Error("No usable Access certificates");
  return keys;
}

function getAccessKeys(
  fetchImpl: typeof fetch,
  refresh: boolean,
  now: number,
): Promise<Map<string, JwkWithId>> {
  if (
    !refresh &&
    certificateCache &&
    now - certificateCache.cachedAt < CERT_CACHE_TTL_MS
  ) {
    return certificateCache.keys;
  }

  const entry: CertificateCacheEntry = {
    cachedAt: now,
    keys: fetchAccessKeys(fetchImpl).catch((error: unknown) => {
      if (certificateCache === entry) certificateCache = null;
      throw error;
    }),
  };
  certificateCache = entry;
  return entry.keys;
}

async function findSigningKey(
  kid: string,
  fetchImpl: typeof fetch,
  now: number,
): Promise<JsonWebKey | null> {
  if (
    certificateCache === null &&
    lastForcedRefreshAt !== null &&
    now - lastForcedRefreshAt < FORCED_REFRESH_COOLDOWN_MS
  ) {
    throw new Error("Certificate refresh is cooling down");
  }

  let keys = await getAccessKeys(fetchImpl, false, now);
  let key = keys.get(kid);

  if (!key) {
    if (
      lastForcedRefreshAt !== null &&
      now - lastForcedRefreshAt < FORCED_REFRESH_COOLDOWN_MS
    ) {
      return null;
    }

    lastForcedRefreshAt = now;
    keys = await getAccessKeys(fetchImpl, true, now);
    key = keys.get(kid);
  }

  return key ?? null;
}

function claimMatchesAudience(value: unknown): boolean {
  return (
    value === ACCESS_AUDIENCE ||
    (Array.isArray(value) && value.some((entry) => entry === ACCESS_AUDIENCE))
  );
}

function validateClaims(
  payload: Record<string, unknown>,
  now: number,
): AccessJwtResult {
  if (payload.iss !== ACCESS_TEAM_DOMAIN) {
    return { ok: false, reason: "issuer" };
  }
  if (!claimMatchesAudience(payload.aud)) {
    return { ok: false, reason: "aud" };
  }
  if (payload.email !== ALLOWED_EMAIL) {
    return { ok: false, reason: "email" };
  }

  const nowSeconds = now / 1000;
  if (typeof payload.exp !== "number" || nowSeconds >= payload.exp) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.nbf === "number" && nowSeconds < payload.nbf) {
    return { ok: false, reason: "not-before" };
  }

  return { ok: true, email: ALLOWED_EMAIL };
}

async function verifySignature(
  jwk: JsonWebKey,
  jwt: DecodedJwt,
): Promise<boolean> {
  const key = await crypto.subtle.importKey("jwk", jwk, RS256, false, [
    "verify",
  ]);
  return crypto.subtle.verify(
    RS256,
    key,
    jwt.signature,
    new TextEncoder().encode(jwt.signingInput),
  );
}

export async function verifyAccessJwt(
  token: string | null,
  options: AccessAuthOptions,
): Promise<AccessJwtResult> {
  if (!token) return { ok: false, reason: "missing" };

  const jwt = decodeJwt(token);
  if (!jwt) return { ok: false, reason: "malformed" };

  try {
    const kid = jwt.header.kid as string;
    const jwk = await findSigningKey(
      kid,
      options.fetchImpl,
      options.now,
    );
    if (!jwk) return { ok: false, reason: "signature" };

    if (await verifySignature(jwk, jwt)) {
      return validateClaims(jwt.payload, options.now);
    }

    const cacheAge =
      certificateCache === null
        ? null
        : options.now - certificateCache.cachedAt;
    if (
      cacheAge === null ||
      cacheAge < FORCED_REFRESH_COOLDOWN_MS ||
      (lastForcedRefreshAt !== null &&
        options.now - lastForcedRefreshAt < FORCED_REFRESH_COOLDOWN_MS)
    ) {
      return { ok: false, reason: "signature" };
    }

    lastForcedRefreshAt = options.now;
    const refreshedKeys = await getAccessKeys(
      options.fetchImpl,
      true,
      options.now,
    );
    const refreshedJwk = refreshedKeys.get(kid);
    if (!refreshedJwk || !(await verifySignature(refreshedJwk, jwt))) {
      return { ok: false, reason: "signature" };
    }
  } catch {
    return { ok: false, reason: "certificates" };
  }

  return validateClaims(jwt.payload, options.now);
}

export async function isAccessAuthorized(
  request: Request,
  options: AccessAuthOptions,
): Promise<boolean> {
  const token = request.headers.get("cf-access-jwt-assertion");
  return (await verifyAccessJwt(token, options)).ok;
}
