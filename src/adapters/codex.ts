import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { Adapter, AITelemetryState, AIProvider } from "@/domains/models";
import { readAIUsageSnapshot } from "./ai-usage";
export const codexBinary =
  process.env.CODEX_BINARY ||
  (existsSync("/Applications/ChatGPT.app/Contents/Resources/codex")
    ? "/Applications/ChatGPT.app/Contents/Resources/codex"
    : null);
type Window = {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt?: number;
};
type Limits = {
  rateLimits?: { primary?: Window; secondary?: Window };
  rateLimitsByLimitId?: Record<
    string,
    { primary?: Window; secondary?: Window }
  >;
  rateLimitResetCredits?: {
    availableCount?: number;
    credits?: { status?: string; expiresAt?: number }[];
  };
};
export function normalizeCodex(payload: unknown): AITelemetryState {
  const body = payload as Limits;
  const bucket = body?.rateLimitsByLimitId?.codex || body?.rateLimits;
  const providers: AIProvider[] = [];
  for (const window of [bucket?.primary, bucket?.secondary]) {
    if (
      !window ||
      !Number.isFinite(window.usedPercent) ||
      !Number.isFinite(window.windowDurationMins)
    )
      continue;
    const mins = window.windowDurationMins;
    providers.push({
      name: `Codex ${mins >= 10080 ? "weekly" : mins >= 60 ? `${mins / 60}h` : `${mins}m`}`,
      status: "unknown",
      remainingPercent: Math.round(
        Math.max(0, Math.min(100, 100 - window.usedPercent)),
      ),
      resetAt: window.resetsAt
        ? new Date(window.resetsAt * 1000).toISOString()
        : undefined,
      requestsToday: null,
      tokensToday: null,
      costToday: null,
      jobsCompleted: null,
      errors: null,
    });
  }
  const resetCredits = body?.rateLimitResetCredits;
  if (resetCredits && Number.isFinite(resetCredits.availableCount)) {
    const expirations = (resetCredits.credits || [])
      .filter((credit) => credit.status === "available")
      .map((credit) => credit.expiresAt)
      .filter((value): value is number => Number.isFinite(value));
    providers.push({
      name: "Codex resets",
      status: "idle",
      remainingPercent: null,
      value: `${resetCredits.availableCount} available`,
      availableCount: resetCredits.availableCount,
      expiresAt: expirations.length
        ? new Date(Math.min(...expirations) * 1000).toISOString()
        : undefined,
      requestsToday: null,
      tokensToday: null,
      costToday: null,
      jobsCompleted: null,
      errors: null,
    });
  }
  if (!providers.length)
    throw new Error(
      "Codex quota windows unavailable; sign in to Codex with ChatGPT",
    );
  return { providers };
}
// Only the initialization handshake and quota read are allowed here. No threads or turns.
export async function readCodexQuota(binary: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let buffer = "",
      settled = false;
    const finish = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error("Codex telemetry timed out")),
      12000,
    );
    const send = (message: unknown) =>
      child.stdin.write(JSON.stringify(message) + "\n");
    child.on("error", () => finish(new Error("Codex executable unavailable")));
    child.on("exit", () =>
      finish(new Error("Codex telemetry connection closed")),
    );
    child.stdin.on("error", () =>
      finish(new Error("Codex telemetry connection closed")),
    );
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 1_000_000)
        return finish(new Error("Codex telemetry response too large"));
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.id === 0) {
            if (message.error)
              return finish(new Error("Codex telemetry initialization failed"));
            send({ method: "initialized" });
            send({ id: 1, method: "account/rateLimits/read" });
          } else if (message.id === 1)
            finish(
              message.error
                ? new Error("Codex quota unavailable; check your Codex sign-in")
                : null,
              message.result,
            );
        } catch {
          /* Ignore non-protocol output. */
        }
      }
    });
    send({
      id: 0,
      method: "initialize",
      params: {
        clientInfo: {
          name: "lifedash",
          title: "LifeDash read-only telemetry",
          version: "1.0.0",
        },
      },
    });
  });
}
export const codexAdapter: Adapter<AITelemetryState> = {
  provider: "Codex account quotas",
  source: "real",
  async fetch(now) {
    if (!codexBinary) throw new Error("Configure CODEX_BINARY");
    const codex = normalizeCodex(await readCodexQuota(codexBinary));
    return {
      providers: [...codex.providers, ...(await readAIUsageSnapshot(now))],
    };
  },
};
