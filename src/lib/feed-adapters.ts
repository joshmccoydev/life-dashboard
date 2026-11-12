import type {
  AITelemetryState,
  AIProvider,
  SystemState,
} from "@/domains/models";
import { stripPrivate } from "@/lib/privacy";

type FeedRecord = Record<string, unknown>;

function isFeedRecord(value: unknown): value is FeedRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const cleaned = stripPrivate(String(value));
  return cleaned.length ? cleaned : undefined;
}

export function hostToSystemState(data: unknown): SystemState | null {
  if (!isFeedRecord(data)) return null;
  if ("machine" in data) return data as SystemState;

  const host = data as {
    uptimeSeconds?: number | null;
    loadavg?: number[];
    cpuPercent?: number | null;
    memoryPercent?: number | null;
    disk?: { usedPct?: number | null } | null;
    crons?: number;
  };

  return {
    machine: {
      id: "box",
      name: "Box",
      status: "online",
      latencyMs: null,
      uptimeSeconds: host.uptimeSeconds ?? null,
      cpuPercent: typeof host.cpuPercent === "number" && Number.isFinite(host.cpuPercent) ? host.cpuPercent : null,
      memoryPercent: typeof host.memoryPercent === "number" && Number.isFinite(host.memoryPercent) ? host.memoryPercent : null,
      diskPercent: host.disk?.usedPct ?? null,
      detail: `load ${host.loadavg?.[0]} · ${host.crons} crons`,
    },
    endpoints: [],
  };
}


/** Needs Josh only when an open [ASK] was counted, or (for ledger / older
 *  feeds without `open_asks`) when needs_josh is a non-empty string. */
export function botOperationalStatus(
  value: FeedRecord,
): AIProvider["status"] {
  const openAsks =
    typeof value.open_asks === "number" && Number.isFinite(value.open_asks)
      ? value.open_asks
      : null;
  const needsJosh = text(value.needs_josh);
  const hasAsk = openAsks !== null ? openAsks > 0 : Boolean(needsJosh);
  if (hasAsk) return "waiting";

  const workingOn = text(value.working_on);
  const nextUp = text(value.next_up);
  if (
    /\bblocked\s*:/i.test(`${workingOn ?? ""} ${nextUp ?? ""}`) ||
    (workingOn != null && /(?:^|\s)blocked(?:\s|$)/i.test(workingOn))
  ) {
    return "blocked";
  }
  if (!workingOn || /^(idle|retired|none)\b/i.test(workingOn)) return "idle";
  return "running";
}

export function botsToAiState(data: unknown): AITelemetryState | null {
  if (!isFeedRecord(data)) return null;
  if ("providers" in data) return data as AITelemetryState;
  if (!Array.isArray(data.bots)) return null;

  const providers: AIProvider[] = [];
  for (const value of data.bots) {
    if (!isFeedRecord(value)) return null;
    const workingOn = text(value.working_on);
    const nextUp = text(value.next_up);
    const needsJosh = text(value.needs_josh);
    const status = botOperationalStatus(value);
    const waiting = status === "waiting";

    const updatedAt =
      typeof value.updated === "string" && value.updated.trim()
        ? value.updated.trim()
        : null;
    providers.push({
      name: text(value.bot) ?? String(value.bot ?? ""),
      status,
      remainingPercent: null,
      detail: waiting
        ? `waiting on Josh: ${needsJosh}`
        : (workingOn ?? nextUp),
      value: waiting ? "needs Josh" : undefined,
      updatedAt,
      requestsToday: null,
      tokensToday: null,
      costToday: null,
      jobsCompleted: null,
      errors: null,
    });
  }

  return { providers };
}
