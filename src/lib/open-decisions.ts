import { stripPrivate } from "@/lib/privacy";
import type { DecisionHomeCard, DecisionsHomeState } from "@/domains/models";

export const OPEN_DECISIONS_PATH =
  "/workspace/exports/life-dash/open-decisions.json";

export const OPEN_DECISIONS_HOME_LIMIT = 5;

export type OpenDecisionItem = {
  id: string;
  title: string;
  owner_bot: string;
  asked_on: string | null;
  why_open: string | null;
};

export type OpenDecisionsFile = {
  as_of: string;
  items: OpenDecisionItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = stripPrivate(value).trim();
  return cleaned.length ? cleaned : null;
}

/** Parse Archive's curated open-decisions list. File order is urgency order. */
export function parseOpenDecisions(payload: unknown): OpenDecisionsFile | null {
  if (!isRecord(payload)) return null;
  const asOf = text(payload.as_of);
  if (!asOf || Number.isNaN(Date.parse(asOf))) return null;
  if (!Array.isArray(payload.items)) return null;

  const items: OpenDecisionItem[] = [];
  for (const entry of payload.items) {
    if (!isRecord(entry)) continue;
    const id = text(entry.id);
    const title = text(entry.title);
    const owner = text(entry.owner_bot);
    if (!id || !title || !owner) continue;
    items.push({
      id,
      title,
      owner_bot: owner,
      asked_on: text(entry.asked_on),
      why_open: text(entry.why_open),
    });
  }

  return { as_of: asOf, items };
}

export function openDecisionsToFeed(
  file: OpenDecisionsFile,
): DecisionsHomeState & { cards: Array<DecisionHomeCard & { context?: string; createdAt?: string | null }> } {
  const cards = file.items.map((item) => ({
    id: item.id,
    bot: item.owner_bot,
    question: item.title,
    rec: undefined,
    blocking: false,
    source: "box:open-decisions",
    context: item.why_open ?? undefined,
    createdAt: item.asked_on,
  }));
  return {
    generatedAt: file.as_of,
    count: cards.length,
    cards,
  };
}

export function readOpenDecisions(
  readFile: (path: string) => string | Buffer,
  filePath = OPEN_DECISIONS_PATH,
): OpenDecisionsFile | null {
  let textValue: string;
  try {
    const contents = readFile(filePath);
    textValue =
      typeof contents === "string" ? contents : contents.toString("utf8");
  } catch {
    return null;
  }
  try {
    return parseOpenDecisions(JSON.parse(textValue) as unknown);
  } catch {
    return null;
  }
}
