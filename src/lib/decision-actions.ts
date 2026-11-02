export const ACTIONS_KEY = "decision-actions";

export type DecisionAction = {
  decisionId: string;
  bot: string;
  question: string;
  choice: "yes" | "no" | "later" | "reply";
  reply: string;
  ts: string;
  status: "chosen" | "undone";
  undoneAt?: string;
};

export type ActionsKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

type DecisionChoice = DecisionAction["choice"];
type DecisionStatus = DecisionAction["status"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChoice(value: unknown): value is DecisionChoice {
  return (
    value === "yes" ||
    value === "no" ||
    value === "later" ||
    value === "reply"
  );
}

function isStatus(value: unknown): value is DecisionStatus {
  return value === "chosen" || value === "undone";
}

function isIsoTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    return false;
  }

  return Number.isFinite(Date.parse(value));
}

function parseAction(value: unknown): DecisionAction | null {
  if (!isRecord(value)) return null;

  const {
    decisionId,
    bot,
    question,
    choice,
    reply,
    ts,
    status,
    undoneAt,
  } = value;

  if (
    typeof decisionId !== "string" ||
    typeof bot !== "string" ||
    typeof question !== "string" ||
    !isChoice(choice) ||
    typeof reply !== "string" ||
    !isIsoTimestamp(ts) ||
    !isStatus(status) ||
    (undoneAt !== undefined && !isIsoTimestamp(undoneAt))
  ) {
    return null;
  }

  return {
    decisionId,
    bot,
    question,
    choice,
    reply,
    ts,
    status,
    ...(undoneAt === undefined ? {} : { undoneAt }),
  };
}

export function parseActions(raw: string | null): DecisionAction[] {
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const actions: DecisionAction[] = [];
  for (const value of parsed) {
    const action = parseAction(value);
    if (action) actions.push(action);
  }
  return actions;
}

export async function recordChoice(
  kv: ActionsKv,
  input: Omit<DecisionAction, "ts" | "status" | "undoneAt">,
  now: Date,
): Promise<DecisionAction> {
  const action: DecisionAction = {
    ...input,
    ts: now.toISOString(),
    status: "chosen",
  };
  const actions = parseActions(await kv.get(ACTIONS_KEY)).filter(
    (existing) => existing.decisionId !== action.decisionId,
  );

  actions.push(action);
  await kv.put(ACTIONS_KEY, JSON.stringify(actions.slice(-200)));
  return action;
}

export async function undoChoice(
  kv: ActionsKv,
  decisionId: string,
  now: Date,
): Promise<DecisionAction | null> {
  const actions = parseActions(await kv.get(ACTIONS_KEY));
  const index = actions.findIndex(
    (action) =>
      action.decisionId === decisionId && action.status === "chosen",
  );
  if (index < 0) return null;

  const updated: DecisionAction = {
    ...actions[index],
    status: "undone",
    undoneAt: now.toISOString(),
  };
  actions[index] = updated;
  await kv.put(ACTIONS_KEY, JSON.stringify(actions.slice(-200)));
  return updated;
}

export function summarize(text: string, max = 90): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const sentenceBreak = collapsed.search(/[.?!]\s/);
  const firstSentence =
    sentenceBreak < 0 ? collapsed : collapsed.slice(0, sentenceBreak + 1);

  if (firstSentence.length <= max) return firstSentence;

  const limit = Math.max(0, Math.floor(max));
  const lastSpace = firstSentence.lastIndexOf(" ", limit);
  const prefix =
    lastSpace > 0
      ? firstSentence.slice(0, lastSpace).trimEnd()
      : firstSentence.slice(0, limit).trimEnd();
  return `${prefix}…`;
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    return origin === new URL(request.url).origin;
  }

  return request.headers.get("sec-fetch-site") === "same-origin";
}
