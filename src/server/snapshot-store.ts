import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DashboardData, DataState, Domain } from "@/domains/models";
import { log } from "@/lib/log";
import { HISTORY_LIMIT, type SystemSample } from "@/lib/dashboard-protocol";

export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_FILE = "snapshot.json";

export type PersistedStates = Partial<Record<Domain, DataState<unknown>>>;

export type SnapshotPayload = {
  data: DashboardData;
  serverTime: string;
  seq?: number;
  history?: SystemSample[];
};

export type LoadedSnapshot = {
  data: PersistedStates;
  serverTime: string | null;
  seq: number;
  history: SystemSample[];
};

export type SnapshotStore = {
  dir: string;
  load(): Promise<LoadedSnapshot | null>;
  save(snapshot: SnapshotPayload): Promise<void>;
};

const DOMAINS: Domain[] = [
  "weather",
  "calendar",
  "reminders",
  "finance",
  "health",
  "build",
  "ai",
  "systems",
  "habits",
  "goals",
];

export function defaultSnapshotDir(): string {
  return path.join(process.cwd(), ".lifedash");
}

/**
 * Only real readings with a success are durable: mock/demo states and
 * `data: null` states must never reach disk (mirrors `src/lib/cache.ts`).
 */
export function persistableStates(data: DashboardData): PersistedStates {
  const states: PersistedStates = {};
  for (const domain of DOMAINS) {
    const state = data[domain] as DataState<unknown> | undefined;
    if (!state) continue;
    if (state.source !== "real") continue;
    if (!state.lastSuccess) continue;
    if (state.data === null || state.data === undefined) continue;
    states[domain] = state;
  }
  return states;
}

function isRealState(value: unknown): value is DataState<unknown> {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<DataState<unknown>>;
  return state.source === "real" && typeof state.lastAttempt === "string";
}

/**
 * Read a persisted snapshot. Never throws: a missing, empty, truncated,
 * corrupt or wrong-version file yields `null`, and any persisted domain whose
 * source is not `real` is dropped.
 */
export async function loadSnapshot(
  dir: string = defaultSnapshotDir(),
): Promise<LoadedSnapshot | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(dir, SNAPSHOT_FILE), "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const envelope = parsed as {
    version?: unknown;
    data?: unknown;
    serverTime?: unknown;
  };
  if (envelope.version !== SNAPSHOT_VERSION) return null;
  if (!envelope.data || typeof envelope.data !== "object") return null;
  const states: PersistedStates = {};
  for (const domain of DOMAINS) {
    const state = (envelope.data as Record<string, unknown>)[domain];
    if (!isRealState(state)) continue;
    if (state.data === null || state.data === undefined) continue;
    states[domain] = state;
  }
  if (!Object.keys(states).length) return null;
  const historyValue = (parsed as { history?: unknown }).history;
  const rawSamples =
    historyValue && typeof historyValue === "object"
      ? (historyValue as { systems?: unknown }).systems
      : undefined;
  const history = Array.isArray(rawSamples)
    ? rawSamples
        .filter(
          (sample): sample is SystemSample =>
            !!sample &&
            typeof sample === "object" &&
            ["cpu", "memory", "disk"].every((key) => {
              const metric = (sample as Record<string, unknown>)[key];
              return (
                metric === null ||
                (typeof metric === "number" && Number.isFinite(metric))
              );
            }),
        )
        .slice(-HISTORY_LIMIT)
    : [];
  const seqValue = (parsed as { seq?: unknown }).seq;
  return {
    data: states,
    serverTime:
      typeof envelope.serverTime === "string" ? envelope.serverTime : null,
    seq:
      typeof seqValue === "number" && Number.isInteger(seqValue) && seqValue > 0
        ? seqValue
        : 0,
    history,
  };
}

/**
 * Write `snapshot.json` atomically (`.tmp` then `rename`). Failures are logged
 * and swallowed so a bad disk never breaks a collector tick.
 */
export async function saveSnapshot(
  dir: string,
  snapshot: SnapshotPayload,
): Promise<void> {
  const data = persistableStates(snapshot.data);
  if (!Object.keys(data).length) return;
  try {
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, SNAPSHOT_FILE);
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({
        version: SNAPSHOT_VERSION,
        serverTime: snapshot.serverTime,
        seq: snapshot.seq ?? 0,
        history: { systems: (snapshot.history ?? []).slice(-HISTORY_LIMIT) },
        data,
      }),
      { mode: 0o600 },
    );
    await rename(temporary, file);
  } catch (error) {
    log("snapshot_write_failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
  }
}

export function createSnapshotStore(
  dir: string = defaultSnapshotDir(),
): SnapshotStore {
  return {
    dir,
    load: () => loadSnapshot(dir),
    save: (snapshot) => saveSnapshot(dir, snapshot),
  };
}
