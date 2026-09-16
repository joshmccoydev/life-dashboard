import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AIProvider } from "@/domains/models";

type UsageValue = {
  remainingPercent?: number;
  usedPercent?: number;
  requestsRemaining?: number;
  value?: string;
  resetAt?: string;
  detail?: string;
};

type UsageSnapshot = {
  updatedAt?: string;
  cursor?: UsageValue;
  grokbot?: UsageValue;
};

const snapshotPath =
  process.env.AI_USAGE_PATH ||
  path.join(process.cwd(), ".lifedash", "ai-usage.json");

function emptyProvider(name: string): AIProvider {
  return {
    name,
    status: "unknown",
    remainingPercent: null,
    value: "setup needed",
    detail: "No supported personal usage API; configure the local snapshot",
    requestsToday: null,
    tokensToday: null,
    costToday: null,
    jobsCompleted: null,
    errors: null,
  };
}

function normalizeValue(name: string, value: UsageValue): AIProvider {
  const rawPercent = Number.isFinite(value.remainingPercent)
    ? value.remainingPercent
    : Number.isFinite(value.usedPercent)
      ? 100 - Number(value.usedPercent)
      : null;
  const remainingPercent =
    rawPercent === null
      ? null
      : Math.round(Math.max(0, Math.min(100, Number(rawPercent))));
  if (
    remainingPercent === null &&
    !Number.isFinite(value.requestsRemaining) &&
    !value.value
  )
    throw new Error(`${name} usage value missing`);
  const resetAt = value.resetAt ? new Date(value.resetAt) : null;
  if (resetAt && !Number.isFinite(resetAt.getTime()))
    throw new Error(`${name} reset time invalid`);
  return {
    name,
    status: "idle",
    remainingPercent,
    value:
      value.value ||
      (Number.isFinite(value.requestsRemaining)
        ? `${value.requestsRemaining} left`
        : undefined),
    resetAt: resetAt?.toISOString(),
    detail: value.detail,
    requestsToday: null,
    tokensToday: null,
    costToday: null,
    jobsCompleted: null,
    errors: null,
  };
}

export function normalizeAIUsageSnapshot(
  payload: unknown,
  now: Date,
): AIProvider[] {
  const snapshot = payload as UsageSnapshot;
  const updatedAt = new Date(snapshot?.updatedAt || "");
  if (!Number.isFinite(updatedAt.getTime()))
    throw new Error("AI usage snapshot time missing");
  if (now.getTime() - updatedAt.getTime() > 24 * 60 * 60 * 1000)
    throw new Error("AI usage snapshot is more than 24 hours old");
  return [
    snapshot.cursor
      ? normalizeValue("Cursor monthly", snapshot.cursor)
      : emptyProvider("Cursor monthly"),
    snapshot.grokbot
      ? normalizeValue("Grok Bot weekly", snapshot.grokbot)
      : emptyProvider("Grok Bot weekly"),
  ];
}

export async function readAIUsageSnapshot(now: Date): Promise<AIProvider[]> {
  try {
    return normalizeAIUsageSnapshot(
      JSON.parse(
        await readFile(/* turbopackIgnore: true */ snapshotPath, "utf8"),
      ),
      now,
    );
  } catch {
    return [emptyProvider("Cursor monthly"), emptyProvider("Grok Bot weekly")];
  }
}
