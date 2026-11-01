import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DECISIONS_PATH = "03 Resources/_Meta/Decisions.md";
const STATUS_PATH = "00 Home/Bots/Status.md";
const REMINDERS_PATH = "00 Home/Bots/Reminders.md";

export type DecisionCard = {
  id: string;
  source: string;
  bot: string;
  question: string;
  rec: string;
  context: string;
  link: string;
  createdAt: string | null;
  due: string | null;
  blocking: boolean;
};

export type SnapshotCard = DecisionCard & {
  ageMin: number | null;
};

export type Snapshot = {
  generatedAt: string;
  count: number;
  cards: SnapshotCard[];
};

type SnapshotOptions = {
  vaultDir: string;
  remindersFile: string;
  now: Date;
};

type AnswerInput = {
  id: string;
  bot: string;
  question: string;
  choice: string;
  reply: string;
  at: Date;
};

const centralFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function decisionId(source: string, raw: string): string {
  const digest = createHash("sha256")
    .update(`${source}|${raw.trim()}`)
    .digest("hex");
  return `d_${digest.slice(0, 12)}`;
}

function parseClockTimestamp(
  value: string,
  plainOffsetHours = 6,
): string | null {
  const match = value.match(
    /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?\s*(?:CT)?/i,
  );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  const meridiem = match[6]?.toUpperCase();

  if (meridiem === "PM") {
    if (hour < 12) hour += 12;
  } else if (meridiem === "AM") {
    hour += 5;
  } else {
    hour += plainOffsetHours;
  }

  return new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString();
}

export function parseAskLine(
  raw: string,
  source: string,
  plainOffsetHours = 6,
): DecisionCard | null {
  const line = raw.trim();
  const match =
    line.match(/^-\s+\[ \]\s+\[ASK\]\s+(.+)$/i) ??
    line.match(/^-\s+\[ASK\]\s+(.+)$/i);
  if (!match) return null;

  const segments = match[1].split("|").map((segment) => segment.trim());
  const createdAt = parseClockTimestamp(segments[0] ?? "", plainOffsetHours);
  const fields = new Map<string, string>();

  for (const segment of segments.slice(1)) {
    const separator = segment.indexOf(":");
    if (separator < 0) continue;
    const key = segment.slice(0, separator).trim().toLowerCase();
    const value = segment.slice(separator + 1).trim();
    fields.set(key, value);
  }

  const dueValue = fields.get("due");
  return {
    id: decisionId(source, line),
    source,
    bot: fields.get("owner") ?? "",
    question: fields.get("q") ?? "",
    rec: fields.get("rec") ?? "",
    context: (fields.get("ctx") ?? "").slice(0, 300),
    link:
      source === "decisions"
        ? DECISIONS_PATH
        : (fields.get("link") ?? ""),
    createdAt,
    due: dueValue && dueValue.toLowerCase() !== "none" ? dueValue : null,
    blocking: fields.get("blocking")?.toLowerCase() === "yes",
  };
}

function parseLegacyDecision(
  raw: string,
  source: string,
): DecisionCard | null {
  const line = raw.trim();
  const match = line.match(
    /^-\s+\[ \]\s+(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM))?\s*CT)\s*(?:\|(.*))?$/i,
  );
  if (!match) return null;

  const segments = (match[2] ?? "")
    .split("|")
    .map((segment) => segment.trim());
  const ownerIndex = segments.findIndex((segment) =>
    /^owner\s*:/i.test(segment),
  );
  const owner =
    ownerIndex >= 0
      ? segments[ownerIndex].replace(/^owner\s*:/i, "").trim()
      : "";
  const question =
    ownerIndex >= 0 ? segments.slice(ownerIndex + 1).join(" | ").trim() : "";

  return {
    id: decisionId(source, line),
    source,
    bot: owner.split(/[,+&]/)[0]?.trim() ?? "",
    question,
    rec: "",
    context: "",
    link: "",
    createdAt: parseClockTimestamp(match[1]),
    due: null,
    blocking: false,
  };
}

export function parseDecisions(
  text: string,
  sourcePath: string,
): DecisionCard[] {
  const cards: DecisionCard[] = [];

  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*-\s+\[[ xX]\]/.test(line)) continue;

    const ask = parseAskLine(line, "decisions");
    if (ask) {
      const link = line.match(/\|\s*link\s*:\s*([^|]*)/i)?.[1]?.trim();
      cards.push({ ...ask, link: link || sourcePath });
      continue;
    }

    const legacy = parseLegacyDecision(line, "decisions");
    if (legacy) cards.push({ ...legacy, link: sourcePath });
  }

  return cards;
}

function isEmptyStatusAnswer(value: string): boolean {
  return /^(?:none(?:\s+yet)?|nothing(?:\s+planned)?|n\/?a|no)[.!]?$/i.test(
    value.trim(),
  );
}

export function parseStatus(
  text: string,
  sourcePath: string,
): DecisionCard[] {
  const cards: DecisionCard[] = [];
  let currentBot = "";
  let updatedAt: string | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      currentBot = heading[1].trim();
      updatedAt = null;
      continue;
    }

    if (/^updated\s*:/i.test(line)) {
      updatedAt = parseClockTimestamp(line);
      continue;
    }

    const ask = parseAskLine(line, "status", 5);
    if (ask) {
      cards.push(ask);
      continue;
    }

    const need = line.match(/^needs_josh\s*:\s*(.*)$/i);
    if (!need) continue;
    const question = need[1].trim();
    if (!question || isEmptyStatusAnswer(question) || !currentBot) continue;

    cards.push({
      id: decisionId("status", line),
      source: "status",
      bot: currentBot,
      question,
      rec: "",
      context: "",
      link: sourcePath,
      createdAt: updatedAt,
      due: null,
      blocking: false,
    });
  }

  return cards;
}

export function parseReminders(
  text: string,
  sourcePath: string,
): DecisionCard[] {
  const cards: DecisionCard[] = [];
  const visibleText = text.replace(/<!--[\s\S]*?-->/g, "");
  let inQueue = false;

  for (const raw of visibleText.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^##\s+/.test(line)) {
      inQueue = /^##\s+Queue\s*$/i.test(line);
      continue;
    }
    if (!inQueue) continue;

    const match = line.match(
      /^-\s+\[ \]\s+[^|]*\|\s*([^:|]+):\s*([^|]*?)\s*\|\s*due\s+([^|]+?)\s*(?:\|\s*done when\s+(.*))?$/i,
    );
    if (!match) continue;

    const due = match[3].trim();
    cards.push({
      id: decisionId("reminders", line),
      source: "reminders",
      bot: match[1].trim(),
      question: match[2].trim(),
      rec: "",
      context: match[4] ? `done when ${match[4].trim()}` : "",
      link: sourcePath,
      createdAt: null,
      due: due.toLowerCase() === "none" ? null : due,
      blocking: false,
    });
  }

  return cards;
}

export function parseApprovals(
  text: string,
  sourcePath: string,
): DecisionCard[] {
  const cards: DecisionCard[] = [];
  let createdAt: string | null = null;
  let dropped = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^##\s+Dropped\s*$/i.test(line)) {
      dropped = true;
      continue;
    }
    if (dropped) continue;

    if (/^updated\s*:/i.test(line)) {
      createdAt = parseClockTimestamp(line);
      continue;
    }

    const match = line.match(
      /^-\s+\[\s\]\s+(?:\d+\.\s*)?([^:]+):\s*(.*)$/,
    );
    if (!match) continue;

    const bot = match[1].split(/[,+&]/)[0].trim();
    const body = match[2].trim();
    const waitIndex = body.toLowerCase().indexOf("if he waits:");
    const question =
      waitIndex >= 0 ? body.slice(0, waitIndex).trim() : body.trim();
    const context = waitIndex >= 0 ? body.slice(waitIndex).trim() : "";

    cards.push({
      id: decisionId("approvals", line),
      source: "approvals",
      bot,
      question,
      rec: "",
      context: context.slice(0, 300),
      link: sourcePath,
      createdAt,
      due: null,
      blocking: false,
    });
  }

  return cards;
}

function compareOptionalText(
  left: string | null,
  right: string | null,
): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}

export function sortCards(cards: DecisionCard[]): DecisionCard[] {
  const unique: DecisionCard[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    unique.push(card);
  }

  return unique.sort((left, right) => {
    const dueOrder = compareOptionalText(left.due, right.due);
    if (dueOrder !== 0) return dueOrder;

    if (left.blocking !== right.blocking) return left.blocking ? -1 : 1;

    const createdOrder = compareOptionalText(left.createdAt, right.createdAt);
    if (createdOrder !== 0) return createdOrder;

    return left.id.localeCompare(right.id);
  });
}

async function readTextIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function relativeLink(vaultDir: string, file: string): string {
  if (!path.isAbsolute(file)) return file;
  return path.relative(vaultDir, file);
}

async function loadCurrentApprovals(
  vaultDir: string,
): Promise<Array<{ sourcePath: string; text: string }>> {
  const botsDir = path.join(vaultDir, "00 Home", "Bots");
  let entries;
  try {
    entries = await readdir(botsDir, { withFileTypes: true });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const loaded: Array<{ sourcePath: string; text: string }> = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const approvalsDir = path.join(botsDir, entry.name, "Approvals");
    let files;
    try {
      files = await readdir(approvalsDir);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }

    const current = files
      .filter((file) => file.toLowerCase().endsWith(".md"))
      .sort()
      .at(-1);
    if (!current) continue;

    const absolute = path.join(approvalsDir, current);
    const content = await readTextIfPresent(absolute);
    if (content === null) continue;
    loaded.push({
      sourcePath: relativeLink(vaultDir, absolute),
      text: content,
    });
  }

  return loaded;
}

export async function buildSnapshot(
  options: SnapshotOptions,
): Promise<Snapshot> {
  const decisionsText =
    (await readTextIfPresent(path.join(options.vaultDir, DECISIONS_PATH))) ?? "";
  const statusText =
    (await readTextIfPresent(path.join(options.vaultDir, STATUS_PATH))) ?? "";
  const remindersAbsolute = path.isAbsolute(options.remindersFile)
    ? options.remindersFile
    : path.join(options.vaultDir, options.remindersFile);
  const remindersText = (await readTextIfPresent(remindersAbsolute)) ?? "";

  const cards: DecisionCard[] = [
    ...parseReminders(
      remindersText,
      relativeLink(options.vaultDir, remindersAbsolute),
    ),
    ...parseDecisions(decisionsText, DECISIONS_PATH).map((card) => ({
      ...card,
      link: DECISIONS_PATH,
    })),
    ...parseStatus(statusText, STATUS_PATH),
  ];

  for (const approvals of await loadCurrentApprovals(options.vaultDir)) {
    cards.push(...parseApprovals(approvals.text, approvals.sourcePath));
  }

  const answeredIds = new Set<string>();
  for (const match of decisionsText.matchAll(/\[id:(d_[0-9a-f]{12})\]/gi)) {
    answeredIds.add(match[1]);
  }

  const sorted = sortCards(
    cards.filter((card) => !answeredIds.has(card.id)),
  );
  const nowMs = options.now.getTime();
  const snapshotCards = sorted.map((card) => {
    const elapsedMin =
      card.createdAt === null
        ? null
        : Math.floor((nowMs - Date.parse(card.createdAt)) / 60_000);
    const ageMin =
      elapsedMin === null ? null : ((elapsedMin % 1_440) + 1_440) % 1_440;
    return { ...card, ageMin };
  });

  return {
    generatedAt: options.now.toISOString(),
    count: snapshotCards.length,
    cards: snapshotCards,
  };
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function centralStamp(value: Date): string {
  const parts = centralFormatter.formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")} ${values.get("hour")}:${values.get("minute")} CT`;
}

export function formatAnswerLine(input: AnswerInput): string {
  const question = oneLine(input.question);
  const reply = oneLine(input.reply) || input.choice;
  return `- [x] ${centralStamp(input.at)} \u2014 owner: ${input.bot} \u2014 Josh: "${reply}" | choice: ${input.choice} | q: ${question} | via: decisions app [id:${input.id}]`;
}

export async function appendAnswer(input: {
  decisionsFile: string;
  line: string;
  id: string;
}): Promise<{ added: boolean }> {
  let content = "";
  try {
    content = await readFile(input.decisionsFile, "utf8");
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      throw error;
    }
  }

  if (content.includes(`[id:${input.id}]`)) return { added: false };

  await mkdir(path.dirname(input.decisionsFile), { recursive: true });
  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  await writeFile(
    input.decisionsFile,
    `${content}${separator}${input.line}\n`,
    "utf8",
  );
  return { added: true };
}

export function checkToken(
  candidate: string | undefined,
  expected: string | undefined,
): boolean {
  if (!candidate || !expected) return false;
  return candidate === expected;
}

export { DECISIONS_PATH, REMINDERS_PATH, STATUS_PATH };
