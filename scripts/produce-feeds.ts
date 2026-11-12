import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildSnapshot as buildDecisionSnapshot,
  type Snapshot as DecisionSnapshot,
} from "../src/lib/decisions";
import { stripPrivate } from "../src/lib/privacy";

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
  source: "box:decisions";
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
  now?: Date;
};

export const DECISIONS_LIMIT = 50;

export const MONEY_ALLOWED_KEYS = [
  "cashOnHand",
  "billsDueTotal",
  "billsDueCount",
  "depositTarget",
  "status",
] as const;

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
};

export const DEFAULT_PATHS: FeedPaths = {
  status: "/workspace/vault/00 Home/Bots/Status.md",
  money: "/workspace/exports/buffett-dash.json",
  health: "/workspace/exports/arnold-dash.json",
  apple: "/workspace/exports/apple-dash.json",
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

export function summarizeMoney(raw: unknown): MoneySummary {
  const source = isRecord(raw) ? raw : null;
  const cash = source?.cash_on_hand;
  const bills = source?.next_bills;
  const depositGoal = source?.deposit_goal;
  const alerts = source?.alerts;

  let billsDueTotal: number | null = null;
  if (Array.isArray(bills)) {
    billsDueTotal = bills.reduce((total, value) => {
      const amount = billAmount(value);
      return amount === null ? total : total + amount;
    }, 0);
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
      };
      seen.clear();
      continue;
    }

    if (!current) continue;

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
  paths: Pick<FeedPaths, "status">,
  readFile: ReadFile = fs.readFileSync,
  stat: Stat = fs.statSync,
  now: Date = new Date(),
): Entry {
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

export function buildHost({
  run,
  uptime,
  loadavg,
  now,
}: {
  run: RunCommand;
  uptime: () => number;
  loadavg: () => number[];
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

  return {
    data: {
      uptimeSeconds,
      loadavg: loads,
      disk: { usedPct },
      crons,
    },
    updatedAt: now.toISOString(),
    source: "box:host",
  };
}

export function buildApple(
  paths: Pick<FeedPaths, "apple">,
  readFile: ReadFile = fs.readFileSync,
): Entry {
  try {
    const entry = jsonEntry(paths.apple, "mac", readFile(paths.apple));
    if (entry.error) return entry;

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
    return {
      data: null,
      updatedAt: null,
      source: "mac:not-wired",
      note: "not connected",
    };
  }
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
    host: buildHost({ run, uptime, loadavg, now }),
    apple: buildApple(paths, readFile),
    decisions: {
      ok: false,
      data: null,
      updatedAt: null,
      source: "box:decisions",
      error: "decisions pending",
    },
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
  const snapshot = buildSnapshotSync({ ...opts, now });
  const decisions = await buildDecisions({ now });
  return { ...snapshot, decisions };
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
