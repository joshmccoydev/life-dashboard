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
      cpuPercent: null,
      memoryPercent: null,
      diskPercent: host.disk?.usedPct ?? null,
      detail: `load ${host.loadavg?.[0]} · ${host.crons} crons`,
    },
    endpoints: [],
  };
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
    const waiting = Boolean(needsJosh);

    providers.push({
      name: text(value.bot) ?? String(value.bot ?? ""),
      status: waiting ? "waiting" : workingOn ? "running" : "idle",
      remainingPercent: null,
      detail: waiting
        ? `waiting on Josh: ${needsJosh}`
        : (workingOn ?? nextUp),
      value: waiting ? "needs Josh" : undefined,
      requestsToday: null,
      tokensToday: null,
      costToday: null,
      jobsCompleted: null,
      errors: null,
    });
  }

  return { providers };
}
