import { execFile } from "node:child_process";
import {
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseActions,
  type DecisionAction,
} from "../src/lib/decision-actions";
import { formatAnswerLine } from "../src/lib/decisions";

type PullDependencies = {
  readRaw: () => Promise<string | null>;
  vaultDir: string;
  statePath: string;
  now: Date;
};

type ProcessedStatus = DecisionAction["status"];

const DECISIONS_PATH = path.join("03 Resources", "_Meta", "Decisions.md");
const ACTIONS_PATH = path.join(
  "03 Resources",
  "_Meta",
  "Decision Actions.md",
);
const ACTIONS_HEADER = "# Decision Actions";

const centralFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isProcessedStatus(value: unknown): value is ProcessedStatus {
  return value === "chosen" || value === "undone";
}

function missingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function readTextIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (missingFile(error)) return null;
    throw error;
  }
}

async function readProcessedState(
  statePath: string,
): Promise<Map<string, ProcessedStatus>> {
  const raw = await readTextIfPresent(statePath);
  if (raw === null) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }

  if (!isRecord(parsed)) return new Map();

  const state = new Map<string, ProcessedStatus>();
  for (const [decisionId, status] of Object.entries(parsed)) {
    if (isProcessedStatus(status)) state.set(decisionId, status);
  }
  return state;
}

async function writeProcessedState(
  statePath: string,
  state: Map<string, ProcessedStatus>,
): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  const object = Object.fromEntries(state);
  await writeFile(statePath, `${JSON.stringify(object, null, 2)}\n`, "utf8");
}

async function appendLine(file: string, line: string): Promise<void> {
  const content = (await readTextIfPresent(file)) ?? "";
  await mkdir(path.dirname(file), { recursive: true });
  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  await appendFile(file, `${separator}${line}\n`, "utf8");
}

async function ensureActionsFile(file: string): Promise<void> {
  const content = await readTextIfPresent(file);
  if (content === null || content.trim() === "") {
    await appendLine(file, ACTIONS_HEADER);
  }
}

function centralStamp(value: Date): string {
  const values = new Map(
    centralFormatter
      .formatToParts(value)
      .map((part) => [part.type, part.value]),
  );
  return `${values.get("year")}-${values.get("month")}-${values.get("day")} ${values.get("hour")}:${values.get("minute")} CT`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function chosenActionLine(
  action: DecisionAction,
  stamp: string,
): string {
  const reply = oneLine(action.reply);
  const replySuffix = reply.length > 0 ? `: "${reply}"` : "";
  return `- [ ] ${stamp} \u2014 to: ${oneLine(action.bot)} \u2014 non-priority \u2014 Josh chose ${action.choice}${replySuffix} on: ${oneLine(action.question)} [id:${action.decisionId}]`;
}

function undoneLines(
  action: DecisionAction,
  stamp: string,
): { decisions: string; actions: string } {
  const bot = oneLine(action.bot);
  const question = oneLine(action.question);
  return {
    decisions: `- [x] ${stamp} \u2014 owner: ${bot} \u2014 undo: stop | q: ${question} | via: dash [id:${action.decisionId}]`,
    actions: `- [ ] ${stamp} \u2014 to: ${bot} \u2014 non-priority \u2014 undo: stop \u2014 on: ${question} [id:${action.decisionId}]`,
  };
}

export async function pullActions(
  deps: PullDependencies,
): Promise<{ appended: number }> {
  const actions = parseActions(await deps.readRaw());
  if (actions.length === 0) return { appended: 0 };

  const processed = await readProcessedState(deps.statePath);
  const decisionsFile = path.join(deps.vaultDir, DECISIONS_PATH);
  const actionsFile = path.join(deps.vaultDir, ACTIONS_PATH);
  const stamp = centralStamp(deps.now);
  let appended = 0;

  for (const action of actions) {
    if (processed.get(action.decisionId) === action.status) continue;

    if (action.status === "chosen") {
      await appendLine(
        decisionsFile,
        formatAnswerLine({
          id: action.decisionId,
          bot: action.bot,
          question: action.question,
          choice: action.choice,
          reply: action.reply,
          at: deps.now,
        }),
      );
      await ensureActionsFile(actionsFile);
      await appendLine(actionsFile, chosenActionLine(action, stamp));
    } else {
      const lines = undoneLines(action, stamp);
      await appendLine(decisionsFile, lines.decisions);
      await ensureActionsFile(actionsFile);
      await appendLine(actionsFile, lines.actions);
    }

    processed.set(action.decisionId, action.status);
    await writeProcessedState(deps.statePath, processed);
    appended += 1;
  }

  return { appended };
}

function readRemoteActions(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile(
      "npx",
      [
        "wrangler",
        "kv",
        "key",
        "get",
        "decision-actions",
        "--binding",
        "FEEDS_KV",
        "--remote",
      ],
      { encoding: "utf8" },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        const raw = stdout.trim();
        resolve(raw.length > 0 ? raw : null);
      },
    );
  });
}

async function runDirect(): Promise<void> {
  const result = await pullActions({
    readRaw: readRemoteActions,
    vaultDir: "/workspace/vault",
    statePath: "/workspace/state/decision-actions.json",
    now: new Date(),
  });
  process.stdout.write(`${result.appended}\n`);
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  path.resolve(entrypoint) === fileURLToPath(import.meta.url)
) {
  void runDirect().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
