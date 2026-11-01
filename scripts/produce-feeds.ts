import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type Entry = {
  data: unknown;
  updatedAt: string | null;
  source: string;
  error?: string;
};

export type Snapshot = {
  bots: Entry;
  money: Entry;
  health: Entry;
  host: Entry;
  apple: Entry;
};

export const MONEY_ALLOWED_KEYS = [
  "cashOnHand",
  "billsDueTotal",
  "billsDueCount",
  "depositTarget",
  "status",
] as const;

export type MoneySummary = {
  cashOnHand: number | null;
  billsDueTotal: number | null;
  billsDueCount: number;
  depositTarget: number | null;
  status: "ok" | "alert" | "unknown";
};

type FeedPaths = {
  status: string;
  board: string;
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
  board: "/workspace/vault/00 Home/Bots/Board.md",
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
    depositTarget:
      isRecord(depositGoal) && typeof depositGoal.target === "number"
        ? depositGoal.target
        : null,
    status:
      source === null
        ? "unknown"
        : Array.isArray(alerts) && alerts.length > 0
          ? "alert"
          : "ok",
  };
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

function countLines(markdown: string): number {
  if (!markdown) return 0;
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const withoutFinalNewline = normalized.endsWith("\n")
    ? normalized.slice(0, -1)
    : normalized;
  return withoutFinalNewline.split("\n").length;
}

export function buildBots(
  paths: Pick<FeedPaths, "status" | "board">,
  readFile: ReadFile = fs.readFileSync,
  stat: Stat = fs.statSync,
): Entry {
  let statusMarkdown: string;
  try {
    statusMarkdown = toText(readFile(paths.status));
  } catch (error) {
    return {
      data: null,
      updatedAt: null,
      source: "box:status",
      error: `status ${readErrorReason(error).toLowerCase()}`,
    };
  }

  let updatedAt: string | null = null;
  try {
    updatedAt = stat(paths.status).mtime.toISOString();
  } catch {
    updatedAt = null;
  }

  let board: number | null = null;
  const errors: string[] = [];
  try {
    board = countLines(toText(readFile(paths.board)));
  } catch {
    errors.push("board missing");
  }

  return {
    data: { bots: parseStatus(statusMarkdown), board },
    updatedAt,
    source: "box:status",
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
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
    };
  }
}

export function buildSnapshot(
  opts: {
    paths?: Partial<FeedPaths>;
    readFile?: ReadFile;
    run?: RunCommand;
    uptime?: () => number;
    loadavg?: () => number[];
    now?: Date;
  } = {},
): Snapshot {
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
  const money = readJsonEntry(paths.money, "box:buffett", readFile);

  return {
    bots: buildBots(paths, readFile),
    money:
      money.data === null
        ? money
        : { ...money, data: summarizeMoney(money.data) },
    health: readJsonEntry(paths.health, "box:arnold", readFile),
    host: buildHost({ run, uptime, loadavg, now }),
    apple: buildApple(paths, readFile),
  };
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
  const entry = (current: Entry, source: "box" | "mac") =>
    current.data === null
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
    };
  };

  return {
    bots: summarizeEntry(snapshot.bots),
    money: summarizeEntry(snapshot.money),
    health: summarizeEntry(snapshot.health),
    host: summarizeEntry(snapshot.host),
    apple: summarizeEntry(snapshot.apple),
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

function printSummary(snapshot: Snapshot): void {
  process.stdout.write(`${JSON.stringify(summarize(snapshot))}\n`);
}

export function main(argv: string[]): void {
  const snapshot = buildSnapshot();
  if (argv.includes("--dry-run")) {
    printSummary(snapshot);
    return;
  }

  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "life-dash-feeds-"),
  );
  const tempFile = path.join(tempDirectory, "feeds.json");

  try {
    fs.writeFileSync(tempFile, JSON.stringify(toKvPayload(snapshot)), {
      encoding: "utf8",
      mode: 0o600,
    });
    execFileSync("npx", planKvPut(tempFile), {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }

  printSummary(snapshot);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
