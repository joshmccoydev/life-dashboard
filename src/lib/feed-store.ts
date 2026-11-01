export const FEED_DOMAINS = [
  "bots",
  "money",
  "health",
  "host",
  "apple",
] as const;

export type FeedDomain = (typeof FEED_DOMAINS)[number];
export type FeedSource = "box" | "mac";

export type FeedEntry = {
  data: unknown;
  updatedAt: string | null;
  stale: boolean;
  source: FeedSource | null;
};

export type FeedSnapshot = Record<FeedDomain, FeedEntry>;

const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const FEEDS_KV_KEY = "feeds";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEntry(value: unknown, now: Date): FeedEntry | null {
  if (
    !isRecord(value) ||
    !("data" in value) ||
    !("updatedAt" in value) ||
    typeof value.stale !== "boolean" ||
    !("source" in value)
  ) {
    return null;
  }

  const { data, updatedAt, source } = value;
  if (updatedAt !== null && typeof updatedAt !== "string") return null;
  if (source !== null && source !== "box" && source !== "mac") return null;

  const updatedAtMs = updatedAt === null ? null : Date.parse(updatedAt);
  if (updatedAtMs !== null && Number.isNaN(updatedAtMs)) return null;

  return {
    data,
    updatedAt,
    stale: updatedAtMs !== null && now.getTime() - updatedAtMs > STALE_AFTER_MS,
    source,
  };
}

function emptyEntry(): FeedEntry {
  return { data: null, updatedAt: null, stale: false, source: null };
}

export function mergeFeeds(
  prev: FeedSnapshot | null,
  incoming: unknown,
  now: Date,
): FeedSnapshot {
  const source = isRecord(incoming) ? incoming : {};
  const merged = {} as FeedSnapshot;

  for (const domain of FEED_DOMAINS) {
    const next = normalizeEntry(source[domain], now);
    const previous = prev?.[domain];
    merged[domain] = next ?? (previous ? { ...previous } : emptyEntry());
  }

  return merged;
}

export async function readKvFeeds(
  kv: { get(key: string): Promise<string | null> } | undefined,
): Promise<unknown | null> {
  if (!kv) return null;

  try {
    const stored = await kv.get(FEEDS_KV_KEY);
    return stored === null ? null : (JSON.parse(stored) as unknown);
  } catch {
    return null;
  }
}
