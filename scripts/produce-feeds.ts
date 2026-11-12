import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildSnapshot as buildDecisionSnapshot,
  type Snapshot as DecisionSnapshot,
} from "../src/lib/decisions";
import { stripPrivate } from "../src/lib/privacy";
import {
  USAGE_DEFAULT_PATHS,
  allowlistedUsageRow,
  buildUsageState,
  newestUsageAsOf,
  usageHasAnyData,
} from "../src/lib/usage";
import {
  OPEN_DECISIONS_PATH,
  openDecisionsToFeed,
  readOpenDecisions,
} from "../src/lib/open-decisions";
import {
  LEDGER_JSON_PATH,
  parseChicagoStamp,
  readLedgerBots,
} from "../src/lib/bots-ledger";

export type Entry = {
  data: unknown;
  updatedAt: string | null;
  source: string;
  error?: string;
  note?: string;
};

export type Snapshot = {
  bots: Entry;
  money: Entry;
  health: Entry;
  host: Entry;
  apple: Entry;
  decisions?: Entry;
  usage?: Entry;
  weather?: Entry;
  build?: Entry;
};

export type KvDeps = {
  kvGet: () => string | null;
  kvPut: (json: string) => void;
  build?: () => Snapshot | Promise<Snapshot>;
  out?: (line: string) => void;
};

export type DecisionsResult = {
  ok: boolean;
  data: DecisionSnapshot | null;
  updatedAt: string | null;
  source: "box:decisions" | "box:open-decisions";
  error?: string;
};

export type BuiltSnapshot = Snapshot & {
  decisions: DecisionsResult;
};

type BuildSnapshotOptions = {
  paths?: Partial<FeedPaths>;
  readFile?: ReadFile;
  run?: RunCommand;
  uptime?: () => number;
  loadavg?: () => number[];
  cpuMemory?: () => { cpuPercent: number | null; memoryPercent: number | null };
  now?: Date;
};

export const DECISIONS_LIMIT = 50;

export const MONEY_ALLOWED_KEYS = [
  "cashOnHand",
  "billsDueTotal",
  "billsDueCount",
  "depositTarget",
  "status",
  "bills",
] as const;

export type MoneyBill = {
  name: string;
  due: string | null;
  amount: number | null;
};

export const HEALTH_ALLOWED_KEYS = [
  "trainingDoneToday",
  "streak",
  "nextSession",
  "lastWeighIn",
] as const;

export type MoneySummary = {
  cashOnHand: number | null;
  billsDueTotal: number | null;
  billsDueCount: number;
  depositTarget: number | null;
  status: "ok" | "alert" | "unknown";
  bills: MoneyBill[];
};

export type HealthSummary = {
  trainingDoneToday: "y" | "n" | null;
  streak: number | null;
  nextSession: string | null;
  lastWeighIn?: string | number | null;
};

type FeedPaths = {
  status: string;
  money: string;
  health: string;
  apple: string;
  openDecisions: string;
  grokPrimary: string;
  grokFallback: string;
  chatgpt: string;
  opencode: string;
  nous: string;
  costSheet: string;
  ledger: string;
  weather: string;
  calendar: string;
  build: string;
  reminders: string;
  habits: string;
  goals: string;
};

type ReadFile = (path: string) => string | Buffer;
type RunCommand = (cmd: string, args: string[]) => string;
type Stat = (path: string) => { mtime: Date };
type StatusKey =
  "updated" | "working_on" | "last_done" | "next_up" | "needs_josh";

type StatusItem = {
  bot: string;
  updated: string | null;
  working_on: string | null;
  last_done: string | null;
  next_up: string | null;
  needs_josh: string | null;
  open_asks: number;
};

export const DEFAULT_PATHS: FeedPaths = {
  status: "/workspace/vault/00 Home/Bots/Status.md",
  money: "/workspace/exports/buffett-dash.json",
  health: "/workspace/exports/arnold-dash.json",
  apple: "/workspace/exports/apple-dash.json",
  openDecisions: OPEN_DECISIONS_PATH,
  grokPrimary: USAGE_DEFAULT_PATHS.grokPrimary,
  grokFallback: USAGE_DEFAULT_PATHS.grokFallback,
  chatgpt: USAGE_DEFAULT_PATHS.chatgpt,
  opencode: USAGE_DEFAULT_PATHS.opencode,
  nous: USAGE_DEFAULT_PATHS.nous,
  costSheet: USAGE_DEFAULT_PATHS.costSheet,
  ledger: LEDGER_JSON_PATH,
  weather: "/workspace/exports/life-dash/weather.json",
  calendar: "/workspace/exports/life-dash/calendar.json",
  build: "/workspace/exports/life-dash/build.json",
  reminders: "/workspace/exports/life-dash/reminders.json",
  habits: "/workspace/exports/life-dash/habits.json",
  goals: "/workspace/exports/life-dash/goals.json",
};

function toText(contents: string | Buffer): string {
  return typeof contents === "string" ? contents : contents.toString("utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function billAmount(value: unknown): number | null {
  const amount = isRecord(value) ? value.amount : value;
  if (typeof amount === "number") {
    return Number.isFinite(amount) ? amount : null;
  }
  if (typeof amount !== "string" || amount.trim() === "") return null;

  const parsed = Number(amount);
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizeBill(value: unknown): MoneyBill {
  if (isRecord(value)) {
    const rawName = typeof value.name === "string" ? value.name.trim() : "";
    const name = rawName ? stripPrivate(rawName) || "—" : "—";
    const due =
      typeof value.due === "string" && value.due.trim() !== ""
        ? value.due.trim()
        : null;
    return { name, due, amount: billAmount(value) };
  }
  return { name: "—", due: null, amount: billAmount(value) };
}

export function summarizeMoney(raw: unknown): MoneySummary {
  const source = isRecord(raw) ? raw : null;
  const cash = source?.cash_on_hand;
  const bills = source?.next_bills;
  const depositGoal = source?.deposit_goal;
  const alerts = source?.alerts;

  let billsDueTotal: number | null = null;
  if (Array.isArray(bills)) {
    const rawTotal = bills.reduce((total, value) => {
      const amount = billAmount(value);
      return amount === null ? total : total + amount;
    }, 0);
    billsDueTotal = Math.round(rawTotal * 100) / 100;
  }

  return {
    cashOnHand: isRecord(cash) ? finiteNumber(cash.amount) : null,
    billsDueTotal,
    billsDueCount: Array.isArray(bills) ? bills.length : 0,
    depositTarget: isRecord(depositGoal)
      ? finiteNumber(depositGoal.target)
      : null,
    status:
      source === null
        ? "unknown"
        : Array.isArray(alerts) && alerts.length > 0
          ? "alert"
          : "ok",
    bills: Array.isArray(bills) ? bills.map(summarizeBill) : [],
  };
}

function firstMatching(
  source: Record<string, unknown>,
  keys: readonly string[],
  matches: (value: unknown) => boolean,
): unknown {
  for (const key of keys) {
    if (Object.hasOwn(source, key) && matches(source[key])) {
      return source[key];
    }
  }
  return undefined;
}

function trainingDone(value: unknown): "y" | "n" | null {
  if (value === true) return "y";
  if (value === false) return "n";
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  return normalized === "y" || normalized === "yes"
    ? "y"
    : normalized === "n" || normalized === "no"
      ? "n"
      : null;
}

function streakDays(value: unknown): number | null {
  const numeric = finiteNumber(value);
  if (numeric !== null) return numeric;
  return isRecord(value) ? finiteNumber(value.days) : null;
}

export function summarizeHealth(raw: unknown): HealthSummary {
  const source = isRecord(raw) ? raw : null;
  if (source === null) {
    return {
      trainingDoneToday: null,
      streak: null,
      nextSession: null,
    };
  }

  const training = firstMatching(
    source,
    ["trainingDoneToday", "training_done_today"],
    (value) => trainingDone(value) !== null,
  );
  const nextSession = firstMatching(
    source,
    ["nextSession", "next_session"],
    (value) => typeof value === "string",
  );
  const summary: HealthSummary = {
    trainingDoneToday: trainingDone(training),
    streak: streakDays(source.streak),
    nextSession: typeof nextSession === "string" ? nextSession : null,
  };

  const lastWeighIn = firstMatching(
    source,
    ["lastWeighIn", "last_weigh_in"],
    (value) => typeof value === "string" || finiteNumber(value) !== null,
  );
  const lastWeighInNumber = finiteNumber(lastWeighIn);
  if (typeof lastWeighIn === "string") {
    summary.lastWeighIn = lastWeighIn;
  } else if (lastWeighInNumber !== null) {
    summary.lastWeighIn = lastWeighInNumber;
  }

  return summary;
}

function readErrorReason(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "read failed";
}

export async function buildDecisions(options: {
  vaultDir?: string;
  remindersFile?: string;
  now: Date;
}): Promise<DecisionsResult> {
  const vaultDir =
    options.vaultDir ?? process.env.DECISIONS_VAULT ?? "/workspace/vault";
  const remindersFile =
    options.remindersFile ??
    process.env.DECISIONS_REMINDERS ??
    "/workspace/reminders-queue.md";

  try {
    const snapshot = await buildDecisionSnapshot({
      vaultDir,
      remindersFile,
      now: options.now,
    });
    const cards = snapshot.cards.slice(0, DECISIONS_LIMIT).map((card) => ({
      ...card,
      question: stripPrivate(card.question),
      rec: stripPrivate(card.rec),
      context: stripPrivate(card.context),
    }));

    return {
      ok: true,
      data: { ...snapshot, cards, count: cards.length },
      updatedAt: options.now.toISOString(),
      source: "box:decisions",
    };
  } catch {
    return {
      ok: false,
      data: null,
      updatedAt: null,
      source: "box:decisions",
      error: "decisions build failed",
    };
  }
}

function jsonEntry(
  filePath: string,
  source: string,
  contents: string | Buffer,
): Entry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(toText(contents));
  } catch {
    return {
      data: null,
      updatedAt: null,
      source,
      error: "invalid JSON",
    };
  }

  let updatedAt: string | null = null;
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    typeof (parsed as Record<string, unknown>).updated_at === "string"
  ) {
    updatedAt = (parsed as Record<string, string>).updated_at;
  } else {
    try {
      updatedAt = fs.statSync(filePath).mtime.toISOString();
    } catch {
      updatedAt = null;
    }
  }

  return { data: parsed, updatedAt, source };
}

export function parseStatus(markdown: string): StatusItem[] {
  const items: StatusItem[] = [];
  let current: StatusItem | null = null;
  const seen = new Set<StatusKey>();

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (current) items.push(current);
      current = {
        bot: heading[1].trim(),
        updated: null,
        working_on: null,
        last_done: null,
        next_up: null,
        needs_josh: null,
        open_asks: 0,
      };
      seen.clear();
      continue;
    }

    if (!current) continue;

    // Open asks are the `- [ASK]` rows, not the free-text needs_josh: line.
    if (/^\s*-\s*\[ASK\]/i.test(line)) {
      current.open_asks += 1;
      continue;
    }

    const keyLine = line.match(
      /^\s*(updated|working_on|last_done|next_up|needs_josh):\s*(.*?)\s*$/,
    );
    if (!keyLine) continue;

    const key = keyLine[1] as StatusKey;
    if (seen.has(key)) continue;
    seen.add(key);
    current[key] = keyLine[2] || null;
  }

  if (current) items.push(current);
  return items;
}

export function readJsonEntry(
  filePath: string,
  source: string,
  readFile: ReadFile = fs.readFileSync,
): Entry {
  try {
    return jsonEntry(filePath, source, readFile(filePath));
  } catch (error) {
    return {
      data: null,
      updatedAt: null,
      source,
      error: readErrorReason(error),
    };
  }
}

export function buildBots(
  paths: Pick<FeedPaths, "status"> & Partial<Pick<FeedPaths, "ledger">>,
  readFile: ReadFile = fs.readFileSync,
  stat: Stat = fs.statSync,
  now: Date = new Date(),
): Entry {
  const ledgerPath = paths.ledger ?? LEDGER_JSON_PATH;
  const ledger = readLedgerBots(readFile, ledgerPath);
  if (ledger) {
    return {
      data: { bots: ledger.bots },
      updatedAt: ledger.asOf,
      source: "box:ledger",
    };
  }

  let statusMarkdown: string;
  try {
    statusMarkdown = toText(readFile(paths.status));
  } catch {
    return {
      data: null,
      updatedAt: null,
      source: "box:status",
      error: "status missing",
    };
  }

  let updatedAt: string | null = null;
  let stale = false;
  try {
    const modifiedAt = stat(paths.status).mtime;
    updatedAt = modifiedAt.toISOString();
    stale = now.getTime() - modifiedAt.getTime() > 24 * 60 * 60 * 1_000;
  } catch {
    updatedAt = null;
  }

  const bots = parseStatus(statusMarkdown).map((item) => ({
    ...item,
    updated: item.updated
      ? (parseChicagoStamp(item.updated) ?? item.updated)
      : item.updated,
    working_on: item.working_on ? stripPrivate(item.working_on) : item.working_on,
    last_done: item.last_done ? stripPrivate(item.last_done) : item.last_done,
    next_up: item.next_up ? stripPrivate(item.next_up) : item.next_up,
    needs_josh: item.needs_josh ? stripPrivate(item.needs_josh) : item.needs_josh,
  }));

  return {
    data: { bots },
    updatedAt,
    source: "box:status",
    ...(stale ? { error: "status stale" } : {}),
  };
}

function parseDiskUsedPct(output: string): number | null {
  const lines = output.split(/\r?\n/);
  const columns = lines[1]?.trim().split(/\s+/);
  if (!columns || columns.length < 5) return null;

  const raw = columns[4];
  if (!/^\d+(?:\.\d+)?%$/.test(raw)) return null;
  const value = Number(raw.slice(0, -1));
  return Number.isFinite(value) ? value : null;
}

function countCrons(output: string): number {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#")).length;
}

function readProcMetrics(): { cpuPercent: number | null; memoryPercent: number | null } {
  try {
    const readCpu = () => {
      const line = fs.readFileSync("/proc/stat", "utf8").split(/\r?\n/, 1)[0];
      const values = line.trim().split(/\s+/).slice(1).map(Number);
      if (values.length < 4 || values.some((value) => !Number.isFinite(value))) return null;
      return { idle: values[3] + (values[4] ?? 0), total: values.reduce((sum, value) => sum + value, 0) };
    };
    const before = readCpu();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    const after = readCpu();
    let cpuPercent: number | null = null;
    if (before && after) {
      const total = after.total - before.total;
      const idle = after.idle - before.idle;
      if (total > 0) cpuPercent = Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)));
    }
    const mem = fs.readFileSync("/proc/meminfo", "utf8");
    const totalKb = Number(mem.match(/^MemTotal:\s+(\d+)/m)?.[1]);
    const availableKb = Number(mem.match(/^MemAvailable:\s+(\d+)/m)?.[1]);
    const memoryPercent = totalKb > 0 && Number.isFinite(availableKb)
      ? Math.max(0, Math.min(100, Math.round((1 - availableKb / totalKb) * 100)))
      : null;
    return { cpuPercent, memoryPercent };
  } catch {
    return { cpuPercent: null, memoryPercent: null };
  }
}

export function buildHost({
  run,
  uptime,
  loadavg,
  cpuMemory,
  now,
}: {
  run: RunCommand;
  uptime: () => number;
  loadavg: () => number[];
  cpuMemory?: () => { cpuPercent: number | null; memoryPercent: number | null };
  now: Date;
}): Entry {
  let uptimeSeconds: number | null = null;
  try {
    const value = uptime();
    uptimeSeconds = Number.isFinite(value) ? value : null;
  } catch {
    uptimeSeconds = null;
  }

  let loads: number[] = [];
  try {
    const value = loadavg();
    loads = Array.isArray(value) ? [...value] : [];
  } catch {
    loads = [];
  }

  let usedPct: number | null = null;
  try {
    usedPct = parseDiskUsedPct(run("df", ["-P", "/"]));
  } catch {
    usedPct = null;
  }

  let crons: number | null = null;
  try {
    crons = countCrons(run("crontab", ["-l"]));
  } catch {
    crons = null;
  }

  let cpuPercent: number | null = null;
  let memoryPercent: number | null = null;
  try {
    const metrics = cpuMemory?.();
    if (metrics) {
      cpuPercent = finiteNumber(metrics.cpuPercent);
      memoryPercent = finiteNumber(metrics.memoryPercent);
    }
  } catch {
    cpuPercent = null;
    memoryPercent = null;
  }

  return {
    data: {
      uptimeSeconds,
      loadavg: loads,
      cpuPercent,
      memoryPercent,
      disk: { usedPct },
      crons,
    },
    updatedAt: now.toISOString(),
    source: "box:host",
  };
}

export function buildApple(
  paths: Pick<FeedPaths, "apple"> & Partial<Pick<FeedPaths, "calendar" | "reminders" | "habits" | "goals">>,
  readFile: ReadFile = fs.readFileSync,
): Entry {
  try {
    const entry = jsonEntry(paths.apple, "mac", readFile(paths.apple));
    if (entry.error) throw new Error("apple export invalid");

    const parsed = isRecord(entry.data) ? entry.data : {};
    return {
      ...entry,
      data: {
        calendar: parsed.calendar ?? null,
        reminders: parsed.reminders ?? null,
        habits: parsed.habits ?? null,
        goals: parsed.goals ?? null,
      },
    };
  } catch {
    const filePaths = [paths.calendar, paths.reminders, paths.habits, paths.goals];
    const files = filePaths.map((filePath, index) => {
      if (!filePath) return null;
      const entry = readJsonEntry(filePath, "box:life-dash", readFile);
      if (entry.data === null || !isRecord(entry.data)) return null;
      const kind = ["calendar", "reminders", "habits", "goals"][index];
      let data: unknown = entry.data;
      if (kind === "calendar") {
        const events = Array.isArray(entry.data.events) ? entry.data.events : [];
        data = { events: events.map(allowlistedCalendarEvent).filter((event) => event !== null) };
      }
      return { kind, entry, data };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
    if (!files.length) return { data: null, updatedAt: null, source: "mac:not-wired", note: "not connected" };
    const data: Record<string, unknown> = { calendar: null, reminders: null, habits: null, goals: null };
    for (const file of files) data[file.kind] = file.data;
    const timestamps = files.map(({ entry }) => isRecord(entry.data) ? asOf(entry.data) ?? entry.updatedAt : entry.updatedAt).filter((value): value is string => !!value && Number.isFinite(Date.parse(value)));
    const updatedAt = timestamps.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
    return { data, updatedAt, source: "box:life-dash" };
  }
}

function allowlistedCalendarEvent(value: unknown): { id: string; title: string; start: string; end: string; calendar: "work" | "personal" } | null {
  if (!isRecord(value) || typeof value.title !== "string" || !value.title.trim() || typeof value.start !== "string" || typeof value.end !== "string") return null;
  if (!Number.isFinite(Date.parse(value.start)) || !Number.isFinite(Date.parse(value.end))) return null;
  const title = value.title.trim();
  const calendar = typeof value.calendar === "string" && value.calendar.toLowerCase() === "work" ? "work" : "personal";
  return { id: `${title}:${value.start}`, title, start: value.start, end: value.end, calendar };
}

function asOf(raw: Record<string, unknown>): string | null {
  for (const key of ["as_of", "updated_at"]) if (typeof raw[key] === "string" && Number.isFinite(Date.parse(raw[key] as string))) return raw[key] as string;
  return null;
}

export function buildWeather(filePath: string, readFile: ReadFile): Entry {
  const entry = readJsonEntry(filePath, "box:weather", readFile);
  if (!isRecord(entry.data)) return { data: null, updatedAt: null, source: "box:weather", note: "weather feed missing or invalid" };
  const raw = entry.data;
  return { data: { temperature: finiteNumber(raw.now), feelsLike: finiteNumber(raw.feels_like), high: finiteNumber(raw.high), low: finiteNumber(raw.low), condition: typeof raw.condition === "string" ? raw.condition : "", code: finiteNumber(raw.code), unit: raw.unit === "C" ? "C" : "F", location: typeof raw.location === "string" ? raw.location : "", isDay: raw.is_day === true }, updatedAt: asOf(raw), source: "box:weather" };
}

export function buildGitHub(filePath: string, readFile: ReadFile): Entry {
  const entry = readJsonEntry(filePath, "box:github", readFile);
  if (!isRecord(entry.data)) return { data: null, updatedAt: null, source: "box:github", note: "build feed missing or invalid" };
  const raw = entry.data;
  const repositories = Array.isArray(raw.repositories) ? raw.repositories.filter(isRecord).map((repo) => ({ name: typeof repo.name === "string" ? repo.name : "", commits: finiteNumber(repo.commits) ?? 0 })) : [];
  return { data: { ...(raw.scope === "authenticated" ? { scope: "authenticated" } : {}), username: typeof raw.username === "string" ? raw.username : "", commitsToday: finiteNumber(raw.commits_today) ?? 0, activeRepos: finiteNumber(raw.active_repos) ?? 0, openPRs: finiteNumber(raw.open_prs) ?? 0, lastActivity: typeof raw.last_activity === "string" ? raw.last_activity : null, repositories }, updatedAt: asOf(raw), source: "box:github" };
}

export function buildUsageEntry(
  paths: FeedPaths,
  readFile: ReadFile,
  now: Date,
): Entry {
  const state = buildUsageState({
    paths: {
      grokPrimary: paths.grokPrimary,
      grokFallback: paths.grokFallback,
      chatgpt: paths.chatgpt,
      opencode: paths.opencode,
      nous: paths.nous,
      costSheet: paths.costSheet,
    },
    readFile,
    now,
  });
  if (!usageHasAnyData(state)) {
    return {
      data: null,
      updatedAt: null,
      source: "box:usage",
      note: "no usage figures",
    };
  }
  return {
    data: {
      providers: state.providers.map(allowlistedUsageRow),
    },
    updatedAt: newestUsageAsOf(state) ?? now.toISOString(),
    source: "box:usage",
  };
}

export function buildOpenDecisionsEntry(
  readFile: ReadFile,
  filePath: string,
): DecisionsResult {
  const file = readOpenDecisions(readFile, filePath);
  if (!file) {
    return {
      ok: false,
      data: null,
      updatedAt: null,
      source: "box:open-decisions",
      error: "open-decisions missing",
    };
  }
  const feed = openDecisionsToFeed(file);
  const cards = feed.cards.map((card) => ({
    id: card.id ?? "",
    source: card.source ?? "box:open-decisions",
    bot: card.bot,
    question: card.question,
    rec: card.rec ?? "",
    context: "context" in card && typeof card.context === "string" ? card.context : "",
    link: "",
    createdAt: "createdAt" in card && typeof card.createdAt === "string" ? card.createdAt : null,
    due: null,
    blocking: Boolean(card.blocking),
    ageMin: null,
  }));
  return {
    ok: true,
    data: {
      generatedAt: feed.generatedAt ?? file.as_of,
      count: feed.count,
      cards,
    },
    updatedAt: file.as_of,
    source: "box:open-decisions",
  };
}

function buildSnapshotSync(opts: BuildSnapshotOptions): BuiltSnapshot {
  const paths: FeedPaths = { ...DEFAULT_PATHS, ...opts.paths };
  const readFile = opts.readFile ?? fs.readFileSync;
  const run: RunCommand =
    opts.run ??
    ((cmd, args) =>
      execFileSync(cmd, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }));
  const uptime = opts.uptime ?? os.uptime;
  const loadavg = opts.loadavg ?? os.loadavg;
  const now = opts.now ?? new Date();
  let money = readJsonEntry(paths.money, "box:buffett", readFile);
  if (money.data !== null) {
    const cash = isRecord(money.data) ? money.data.cash_on_hand : null;
    const hasValidCash = isRecord(cash) && finiteNumber(cash.amount) !== null;
    const hasBills =
      isRecord(money.data) && Array.isArray(money.data.next_bills);
    if (!hasValidCash || !hasBills) {
      money = {
        ...money,
        data: null,
        error: "money shape invalid",
      };
    }
  }
  const health = readJsonEntry(paths.health, "box:arnold", readFile);

  const snapshot: BuiltSnapshot = {
    bots: buildBots(paths, readFile, fs.statSync, now),
    money:
      money.data === null
        ? money
        : { ...money, data: summarizeMoney(money.data) },
    health:
      health.data === null
        ? health
        : { ...health, data: summarizeHealth(health.data) },
    host: buildHost({ run, uptime, loadavg, cpuMemory: opts.cpuMemory ?? readProcMetrics, now }),
    apple: buildApple(paths, readFile),
    weather: buildWeather(paths.weather, readFile),
    build: buildGitHub(paths.build, readFile),
    decisions: buildOpenDecisionsEntry(readFile, paths.openDecisions),
    usage: buildUsageEntry(paths, readFile, now),
  };
  return snapshot;
}

export function buildSnapshot(): Promise<BuiltSnapshot>;
export function buildSnapshot(opts: BuildSnapshotOptions): BuiltSnapshot;
export function buildSnapshot(
  opts?: BuildSnapshotOptions,
): Promise<BuiltSnapshot> | BuiltSnapshot {
  return opts === undefined ? buildSnapshotAsync() : buildSnapshotSync(opts);
}

export async function buildSnapshotAsync(
  opts: BuildSnapshotOptions = {},
): Promise<BuiltSnapshot> {
  const now = opts.now ?? new Date();
  // Open decisions and usage are read synchronously from box files.
  // Do not fall back to the Decisions.md stockpile.
  return buildSnapshotSync({ ...opts, now });
}

export function toKvPayload(snapshot: Snapshot): Record<
  keyof Snapshot,
  {
    data: unknown;
    updatedAt: string | null;
    stale: boolean;
    source: "box" | "mac" | null;
  }
> {
  const entry = (current: Entry | undefined, source: "box" | "mac") =>
    current === undefined || current.data === null
      ? {
          data: null,
          updatedAt: null,
          stale: false,
          source: null,
        }
      : {
          data: current.data,
          updatedAt: current.updatedAt,
          stale: false,
          source,
        };

  return {
    bots: entry(snapshot.bots, "box"),
    money: entry(snapshot.money, "box"),
    health: entry(snapshot.health, "box"),
    host: entry(snapshot.host, "box"),
    apple: entry(snapshot.apple, "mac"),
    decisions: entry(snapshot.decisions, "box"),
    usage: entry(snapshot.usage, "box"),
    weather: entry(snapshot.weather, "box"),
    build: entry(snapshot.build, "box"),
  };
}

export function summarize(snapshot: Snapshot): Record<
  keyof Snapshot,
  {
    ok: boolean;
    updatedAt: string | null;
    source: string;
    count: number;
    error?: string;
    note?: string;
  }
> {
  const summarizeEntry = (entry: Entry) => {
    const count = Array.isArray(entry.data)
      ? entry.data.length
      : entry.data !== null && typeof entry.data === "object"
        ? Object.keys(entry.data).length
        : 0;

    return {
      ok: entry.data !== null && !entry.error,
      updatedAt: entry.updatedAt,
      source: entry.source,
      count,
      ...(entry.error === undefined ? {} : { error: entry.error }),
      ...(entry.note === undefined ? {} : { note: entry.note }),
    };
  };

  const decisions =
    snapshot.decisions ??
    ({
      data: null,
      updatedAt: null,
      source: "box:decisions",
    } satisfies Entry);
  const decisionsSummary = summarizeEntry(decisions);
  const decisionsCount =
    isRecord(decisions.data) && Array.isArray(decisions.data.cards)
      ? decisions.data.cards.length
      : 0;

  return {
    bots: summarizeEntry(snapshot.bots),
    money: summarizeEntry(snapshot.money),
    health: summarizeEntry(snapshot.health),
    host: summarizeEntry(snapshot.host),
    apple: summarizeEntry(snapshot.apple),
    decisions: { ...decisionsSummary, count: decisionsCount },
    usage: summarizeEntry(
      snapshot.usage ?? {
        data: null,
        updatedAt: null,
        source: "box:usage",
      },
    ),
    weather: summarizeEntry(snapshot.weather ?? { data: null, updatedAt: null, source: "box:weather" }),
    build: summarizeEntry(snapshot.build ?? { data: null, updatedAt: null, source: "box:github" }),
  };
}

export function planKvPut(file: string): string[] {
  return [
    "wrangler",
    "kv",
    "key",
    "put",
    "feeds",
    "--binding",
    "FEEDS_KV",
    "--remote",
    "--path",
    file,
  ];
}

export function shouldPublish(snapshot: Snapshot): {
  ok: boolean;
  failed: string[];
} {
  const requiredDomains = ["bots", "money", "health", "host"] as const;
  const failed = requiredDomains.filter(
    (domain) => snapshot[domain].data === null,
  );

  return { ok: failed.length === 0, failed };
}

const FEED_DOMAINS = [
  "bots",
  "money",
  "health",
  "host",
  "apple",
  "decisions",
  "usage",
  "weather",
  "build",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function mergeForPublish(
  existing: unknown,
  snapshot: Snapshot,
): {
  payload: Record<string, unknown>;
  published: string[];
  kept: string[];
} {
  const payload: Record<string, unknown> = isPlainObject(existing)
    ? { ...existing }
    : {};
  const current = toKvPayload(snapshot);
  const published: string[] = [];
  const kept: string[] = [];

  for (const domain of FEED_DOMAINS) {
    const currentEntry = snapshot[domain];
    if (
      currentEntry !== undefined &&
      currentEntry.data !== null &&
      !currentEntry.error
    ) {
      payload[domain] = current[domain];
      published.push(domain);
    } else {
      kept.push(domain);
    }
  }

  return { payload, published, kept };
}

function defaultKvGet(): string | null {
  try {
    return execFileSync(
      "npx",
      [
        "wrangler",
        "kv",
        "key",
        "get",
        "feeds",
        "--binding",
        "FEEDS_KV",
        "--remote",
        "--text",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const output =
      error !== null && typeof error === "object"
        ? [
            "stdout" in error ? String(error.stdout) : "",
            "stderr" in error ? String(error.stderr) : "",
          ].join("\n")
        : String(error);
    if (output.toLowerCase().includes("not found")) return null;
    throw error;
  }
}

function defaultKvPut(json: string): void {
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "life-dash-feeds-"),
  );
  const tempFile = path.join(tempDirectory, "feeds.json");

  try {
    fs.writeFileSync(tempFile, json, { encoding: "utf8", mode: 0o600 });
    execFileSync("npx", planKvPut(tempFile), {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function runMain(argv: string[], snapshot: Snapshot, deps?: KvDeps): number {
  const out =
    deps?.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const finish = (code: number): number => {
    process.exitCode = code;
    return code;
  };

  if (argv.includes("--dry-run")) {
    out(JSON.stringify(summarize(snapshot)));
    return finish(0);
  }

  const kvGet = deps?.kvGet ?? defaultKvGet;
  const kvPut = deps?.kvPut ?? defaultKvPut;
  let existingText: string | null;
  try {
    existingText = kvGet();
  } catch {
    out(JSON.stringify(summarize(snapshot)));
    out(JSON.stringify({ skipped: "publish", reason: "kv read failed" }));
    return finish(1);
  }

  let existing: unknown = {};
  if (existingText !== null) {
    try {
      existing = JSON.parse(existingText);
    } catch {
      existing = {};
    }
  }

  const merged = mergeForPublish(existing, snapshot);
  if (merged.published.length === 0) {
    out(JSON.stringify(summarize(snapshot)));
    out(JSON.stringify({ skipped: "publish", published: [] }));
    return finish(1);
  }

  try {
    kvPut(JSON.stringify(merged.payload));
  } catch {
    out(JSON.stringify(summarize(snapshot)));
    out(JSON.stringify({ skipped: "publish", reason: "kv write failed" }));
    return finish(1);
  }
  out(JSON.stringify(summarize(snapshot)));
  out(
    JSON.stringify({
      published: merged.published,
      kept: merged.kept,
    }),
  );
  return finish(0);
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function main(
  argv: string[],
  deps: KvDeps & { build: () => Snapshot },
): number;
export function main(argv: string[], deps?: KvDeps): number | Promise<number>;
export function main(argv: string[], deps?: KvDeps): number | Promise<number> {
  const built = (deps?.build ?? buildSnapshotAsync)();
  if (isPromiseLike<Snapshot>(built)) {
    return Promise.resolve(built).then((snapshot) =>
      runMain(argv, snapshot, deps),
    );
  }
  return runMain(argv, built, deps);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = main(process.argv.slice(2));
  if (isPromiseLike<number>(result)) {
    void Promise.resolve(result).then((code) => {
      process.exitCode = code;
    });
  } else {
    process.exitCode = result;
  }
}
