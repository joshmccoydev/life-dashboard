/**
 * Adapter from the CTO-0279 shared work ledger (GET /ledger.json) into the
 * Status.md-shaped bots list LifeDash already consumes.
 *
 * Until a box-readable ledger snapshot exists, produce-feeds keeps using
 * Status.md. This module does not call agents.j0sh.wtf — the hourly script
 * cannot satisfy HMAC / Access on its own, and secrets must not be read here.
 *
 * Contract: /workspace/cto/evidence/CTO-0279/contract.md
 */
import { stripPrivate } from "@/lib/privacy";

export const LEDGER_JSON_PATH = "/workspace/exports/life-dash/ledger.json";

export type LedgerLink = { label: string; url: string };

export type LedgerItem = {
  work_id: string;
  title: string;
  owner_bot: string;
  team: string;
  status: string;
  next_step?: string;
  needs_josh: boolean;
  needs_josh_ask?: string;
  links?: LedgerLink[];
  updated_at: string;
  updated_by?: string;
};

export type LedgerFile = {
  as_of: string;
  items: LedgerItem[];
};

export type StatusBot = {
  bot: string;
  updated: string | null;
  working_on: string | null;
  last_done: string | null;
  next_up: string | null;
  needs_josh: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = stripPrivate(value).trim();
  return cleaned.length ? cleaned : null;
}

function isLedgerItem(value: unknown): value is LedgerItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.work_id === "string" &&
    typeof value.title === "string" &&
    typeof value.owner_bot === "string" &&
    typeof value.updated_at === "string"
  );
}

export function parseLedgerFile(raw: unknown): LedgerFile | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.as_of !== "string" || raw.as_of.trim() === "") return null;
  if (!Array.isArray(raw.items)) return null;
  const items: LedgerItem[] = [];
  for (const entry of raw.items) {
    if (!isLedgerItem(entry)) continue;
    const needsJosh =
      entry.needs_josh === true || entry.needs_josh === ("true" as never);
    items.push({
      work_id: entry.work_id,
      title: entry.title,
      owner_bot: entry.owner_bot,
      team: typeof entry.team === "string" ? entry.team : "",
      status: typeof entry.status === "string" ? entry.status : "",
      next_step: text(entry.next_step) ?? undefined,
      needs_josh: Boolean(needsJosh),
      needs_josh_ask: text(entry.needs_josh_ask) ?? "",
      updated_at: entry.updated_at,
      updated_by: text(entry.updated_by) ?? undefined,
    });
  }
  return { as_of: raw.as_of, items };
}

function stamp(item: LedgerItem): number {
  const ms = Date.parse(item.updated_at);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * One row per owner_bot. Last run is the newest updated_at for that bot.
 * Needs Josh if any of the bot's items has needs_josh=true. Does not invent
 * a Paused status.
 */
export function ledgerToStatusBots(items: LedgerItem[]): StatusBot[] {
  const groups = new Map<string, LedgerItem[]>();
  for (const item of items) {
    const name = item.owner_bot.trim();
    if (!name) continue;
    const list = groups.get(name) ?? [];
    list.push(item);
    groups.set(name, list);
  }

  const bots: StatusBot[] = [];
  for (const [bot, list] of groups) {
    const ordered = [...list].sort((left, right) => stamp(right) - stamp(left));
    const latest = ordered[0];
    const needing = ordered.find((item) => item.needs_josh);
    const doing = ordered.find((item) => item.status === "doing");
    const working = doing ?? latest;
    bots.push({
      bot,
      updated: latest?.updated_at ?? null,
      working_on: text(working?.next_step) ?? text(working?.title),
      last_done: null,
      next_up: text(latest?.next_step),
      needs_josh: needing
        ? (text(needing.needs_josh_ask) ?? "Needs Josh")
        : null,
    });
  }

  bots.sort((left, right) => {
    if (Boolean(left.needs_josh) !== Boolean(right.needs_josh)) {
      return left.needs_josh ? -1 : 1;
    }
    return left.bot.localeCompare(right.bot);
  });
  return bots;
}

export function readLedgerBots(
  readFile: (path: string) => string | Buffer,
  filePath: string = LEDGER_JSON_PATH,
): { bots: StatusBot[]; asOf: string } | null {
  let raw: string;
  try {
    const contents = readFile(filePath);
    raw = typeof contents === "string" ? contents : contents.toString("utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const file = parseLedgerFile(parsed);
  if (!file) return null;
  return { bots: ledgerToStatusBots(file.items), asOf: file.as_of };
}


function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Parse Status.md stamps like "2026-11-12 10:55 AM CT" or "2026-11-12 07:52 CT"
 * (and ISO) into a UTC ISO string. "CT" is America/Chicago, with CST/CDT
 * chosen so the local wall time matches.
 */
export function parseChicagoStamp(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();
  const instant = Date.parse(trimmed);
  if (!Number.isNaN(instant)) return new Date(instant).toISOString();

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?\s*(?:CT|CST|CDT)?$/i,
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  const meridiem = match[6]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const matchesLocal = (date: Date) => {
    const parts = formatter.formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    return (
      get("year") === year &&
      get("month") === month &&
      get("day") === day &&
      get("hour") === hour &&
      get("minute") === minute
    );
  };

  for (const offset of ["-06:00", "-05:00"] as const) {
    const iso = `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00${offset}`;
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime()) && matchesLocal(date)) {
      return date.toISOString();
    }
  }
  return new Date(
    `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00-06:00`,
  ).toISOString();
}
