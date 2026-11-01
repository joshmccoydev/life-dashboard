import type {
  AITelemetryState,
  AIProvider,
  SystemState,
} from "@/domains/models";

type FeedRecord = Record<string, unknown>;

function isFeedRecord(value: unknown): value is FeedRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    const workingOn = value.working_on as string | null | undefined;
    const nextUp = value.next_up as string | null | undefined;
    const needsJosh = value.needs_josh as string | null | undefined;

    providers.push({
      name: value.bot as string,
      status: workingOn ? "running" : "idle",
      remainingPercent: null,
      detail: workingOn ?? nextUp ?? undefined,
      value: needsJosh ? "needs Josh" : undefined,
      requestsToday: null,
      tokensToday: null,
      costToday: null,
      jobsCompleted: null,
      errors: null,
    });
  }

  return { providers };
}
