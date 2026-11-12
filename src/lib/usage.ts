import { stripPrivate } from "@/lib/privacy";

export const USAGE_PROVIDER_IDS = [
  "grok",
  "chatgpt",
  "opencode",
  "nous",
] as const;

export type UsageProviderId = (typeof USAGE_PROVIDER_IDS)[number];

export const USAGE_ALLOWED_KEYS = [
  "id",
  "name",
  "plan",
  "monthly_cost_usd",
  "pct_used",
  "pct_window",
  "resets_at",
  "as_of",
  "source",
  "note",
  "stale",
  "manual",
] as const;

export type UsageRow = {
  id: UsageProviderId;
  name: string;
  plan: string | null;
  monthly_cost_usd: number | null;
  pct_used: number | null;
  pct_window: "weekly" | null;
  resets_at: string | null;
  as_of: string | null;
  source: string | null;
  note: string | null;
  stale: boolean;
  manual: boolean;
};

export type UsageState = { providers: UsageRow[] };

export type RawUsage = {
  as_of: string | null;
  plan: string | null;
  pct_used: number | null;
  resets_at: string | null;
  monthly_cost_usd: number | null;
  source: string | null;
  note: string | null;
};

export const USAGE_DEFAULT_PATHS: {
  grokPrimary: string;
  grokFallback: string;
  chatgpt: string;
  opencode: string;
  nous: string;
  costSheet: string;
} = {
  grokPrimary: "/workspace/exports/usage/grokbot-usage.json",
  grokFallback: "/workspace/gates/state/grok-usage.json",
  chatgpt: "/workspace/exports/usage/chatgpt.json",
  opencode: "/workspace/exports/usage/opencode.json",
  nous: "/workspace/exports/usage/nous.json",
  costSheet:
    "/workspace/vault/00 Home/Bots/Chief/Platform Cost Sheet - 2026-11-12.md",
};

export const USAGE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const PROVIDER_META: Record<
  UsageProviderId,
  { name: string; pctWindow: "weekly" | null }
> = {
  grok: { name: "Grok Bot", pctWindow: "weekly" },
  chatgpt: { name: "ChatGPT", pctWindow: null },
  opencode: { name: "OpenCode Go", pctWindow: null },
  nous: { name: "Nous", pctWindow: null },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = stripPrivate(value).trim();
  return text.length ? text : null;
}

function validStamp(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? value : null;
}

/** Parse one provider file. Accepts both the panel shape and Chief's aliases. */
export function parseUsageFile(payload: unknown): RawUsage | null {
  if (!isRecord(payload)) return null;
  return {
    as_of: validStamp(cleanString(payload.as_of ?? payload.asOf)),
    plan: cleanString(payload.plan),
    pct_used: finiteNumber(
      payload.pct_used ??
        payload.weekly_used_pct ??
        payload.pctUsed ??
        payload.weeklyUsedPct,
    ),
    resets_at: validStamp(
      cleanString(payload.resets_at ?? payload.resets ?? payload.resetsAt),
    ),
    monthly_cost_usd: finiteNumber(
      payload.monthly_cost_usd ?? payload.monthlyCostUsd,
    ),
    source: cleanString(payload.source),
    note: cleanString(payload.note),
  };
}

function asOfMs(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * Prefer grokbot-usage.json. Fall back to gates/state/grok-usage.json if the
 * primary is missing. When both are readable, use the newer as_of; ties go
 * to the primary file.
 */
export function pickGrokUsage(
  primary: RawUsage | null,
  fallback: RawUsage | null,
): RawUsage | null {
  if (!primary) return fallback;
  if (!fallback) return primary;
  const primaryMs = asOfMs(primary.as_of);
  const fallbackMs = asOfMs(fallback.as_of);
  if (primaryMs === null && fallbackMs === null) return primary;
  if (primaryMs === null) return fallback;
  if (fallbackMs === null) return primary;
  return fallbackMs > primaryMs ? fallback : primary;
}

/** List prices from the Platform Cost Sheet text. Returns null if not found. */
export function planCostFromSheet(
  sheet: string,
  provider: UsageProviderId,
  plan: string | null,
): number | null {
  if (!sheet) return null;
  const planText = (plan ?? "").toLowerCase();

  const first = (patterns: RegExp[]): number | null => {
    for (const pattern of patterns) {
      const match = sheet.match(pattern);
      if (match) {
        const value = Number(match[1]);
        if (Number.isFinite(value)) return value;
      }
    }
    return null;
  };

  if (provider === "grok") {
    if (/\bultra\b/.test(planText)) {
      return first([
        /ultra[^\n]{0,60}\$(\d+)/i,
        /\|\s*ultra\s*\|\s*\$(\d+)/i,
      ]);
    }
    if (/\bpremium\b/.test(planText)) {
      return first([
        /premium[^\n]{0,60}\$(\d+)/i,
        /\|\s*premium\s*\|\s*\$(\d+)/i,
      ]);
    }
    return first([
      /super list price is \*\*\$(\d+)/i,
      /\|\s*super\s*\|\s*\$(\d+)/i,
      /official super[^\n]{0,80}\$(\d+)/i,
    ]);
  }

  if (provider === "chatgpt") {
    return first([
      /chatgpt plus[^\n]{0,100}\*\*\$(\d+)/i,
      /\|\s*chatgpt plus[^\|]*\|\s*\$(\d+)/i,
      /official price for chatgpt plus[^\n]{0,80}\*\*\$(\d+)/i,
    ]);
  }

  if (provider === "nous") {
    if (/\bultra\b/.test(planText)) {
      return first([/\|\s*ultra\s*\|\s*\$(\d+)/i]);
    }
    if (/\bsuper\b/.test(planText)) {
      return first([/\|\s*super\s*\|\s*\$(\d+)/i]);
    }
    return first([
      /\|\s*plus\s*\|\s*\$(\d+)/i,
      /nous[^\n]{0,40}plus[^\n]{0,40}\$(\d+)/i,
    ]);
  }

  if (provider === "opencode") {
    return first([
      /opencode go[^\n]{0,60}\$(\d+)/i,
      /\|\s*opencode go[^\|]*\|\s*\$(\d+)/i,
    ]);
  }

  return null;
}

export function isUsageManual(source: string | null): boolean {
  return (source ?? "").trim().toLowerCase() === "manual";
}

export function isUsageStale(
  raw: Pick<RawUsage, "as_of" | "note">,
  now: Date,
  staleAfterMs = USAGE_STALE_AFTER_MS,
): boolean {
  if (raw.note && /\bstale\b/i.test(raw.note)) return true;
  const stamp = asOfMs(raw.as_of);
  if (stamp === null) return false;
  return now.getTime() - stamp > staleAfterMs;
}

export function emptyUsageRow(id: UsageProviderId): UsageRow {
  const meta = PROVIDER_META[id];
  return {
    id,
    name: meta.name,
    plan: null,
    monthly_cost_usd: null,
    pct_used: null,
    pct_window: meta.pctWindow,
    resets_at: null,
    as_of: null,
    source: null,
    note: null,
    stale: false,
    manual: false,
  };
}

export function toUsageRow(
  id: UsageProviderId,
  raw: RawUsage | null,
  now: Date,
  costSheet = "",
): UsageRow {
  const base = emptyUsageRow(id);
  if (!raw) {
    return { ...base, manual: true };
  }
  let cost = raw.monthly_cost_usd;
  if (cost === null) {
    cost = planCostFromSheet(costSheet, id, raw.plan);
  }
  const manual = isUsageManual(raw.source);
  const stale = isUsageStale(raw, now);
  return {
    ...base,
    plan: raw.plan,
    monthly_cost_usd: cost,
    pct_used: raw.pct_used,
    resets_at: raw.resets_at,
    as_of: raw.as_of,
    source: raw.source,
    note: raw.note,
    stale,
    manual,
  };
}

export type UsageReadFile = (path: string) => string | Buffer;

function readPayload(
  readFile: UsageReadFile,
  filePath: string,
): RawUsage | null {
  let text: string;
  try {
    const contents = readFile(filePath);
    text = typeof contents === "string" ? contents : contents.toString("utf8");
  } catch {
    return null;
  }
  try {
    return parseUsageFile(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export type BuildUsageOptions = {
  paths?: Partial<typeof USAGE_DEFAULT_PATHS>;
  readFile: UsageReadFile;
  now: Date;
  costSheet?: string;
};

export function buildUsageState(options: BuildUsageOptions): UsageState {
  const paths = { ...USAGE_DEFAULT_PATHS, ...options.paths };
  const readFile = options.readFile;
  const now = options.now;
  let costSheet = options.costSheet;
  if (costSheet === undefined) {
    try {
      const contents = readFile(paths.costSheet);
      costSheet =
        typeof contents === "string" ? contents : contents.toString("utf8");
    } catch {
      costSheet = "";
    }
  }

  const grok = pickGrokUsage(
    readPayload(readFile, paths.grokPrimary),
    readPayload(readFile, paths.grokFallback),
  );

  const rawById: Record<UsageProviderId, RawUsage | null> = {
    grok,
    chatgpt: readPayload(readFile, paths.chatgpt),
    opencode: readPayload(readFile, paths.opencode),
    nous: readPayload(readFile, paths.nous),
  };

  return {
    providers: USAGE_PROVIDER_IDS.map((id) =>
      toUsageRow(id, rawById[id], now, costSheet),
    ),
  };
}

export function usageHasAnyData(state: UsageState): boolean {
  return state.providers.some(
    (row) =>
      row.plan !== null ||
      row.pct_used !== null ||
      row.monthly_cost_usd !== null ||
      row.as_of !== null ||
      row.resets_at !== null ||
      row.source !== null,
  );
}

export function newestUsageAsOf(state: UsageState): string | null {
  let best: { stamp: string; ms: number } | null = null;
  for (const row of state.providers) {
    const ms = asOfMs(row.as_of);
    if (ms === null) continue;
    if (!best || ms > best.ms) best = { stamp: row.as_of!, ms };
  }
  return best?.stamp ?? null;
}

const chicagoClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "numeric",
  minute: "2-digit",
});

const chicagoDay = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
});

const chicagoParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function chicagoDateKey(date: Date): string {
  const parts = chicagoParts.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function chicagoIsMidnight(date: Date): boolean {
  const parts = chicagoParts.formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  return hour === "00" && minute === "00";
}

/** Reset label in America/Chicago. Same day: time only; midnight: date only. */
export function usageResetLabel(
  resetsAt: string | null,
  now: Date,
): string | null {
  if (!resetsAt) return null;
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return null;
  if (chicagoDateKey(date) === chicagoDateKey(now)) {
    return `Resets ${chicagoClock.format(date)} CT`;
  }
  if (chicagoIsMidnight(date)) {
    return `Resets ${chicagoDay.format(date)}`;
  }
  return `Resets ${chicagoDay.format(date)}, ${chicagoClock.format(date)} CT`;
}

export function usageCostLabel(cost: number | null): string | null {
  if (cost === null) return null;
  return `$${cost} / mo`;
}

/** The visible tag: STALE wins when a row is both manual and stale. */
export function usageTag(
  row: Pick<UsageRow, "stale" | "manual">,
): "stale" | "manual" | null {
  if (row.stale) return "stale";
  if (row.manual) return "manual";
  return null;
}

export function allowlistedUsageRow(row: UsageRow): UsageRow {
  const next = emptyUsageRow(row.id);
  for (const key of USAGE_ALLOWED_KEYS) {
    (next as unknown as Record<string, unknown>)[key] = row[key];
  }
  return next;
}
