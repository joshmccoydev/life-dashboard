import type {
  DashboardData,
  DataState,
  Domain,
  SystemState,
} from "@/domains/models";
import { readState } from "@/lib/cache";
import { log } from "@/lib/log";
import {
  STREAM_PROTOCOL_VERSION,
  type DashboardSnapshotEvent,
} from "@/lib/dashboard-protocol";
import { createHistory, type History } from "./history";
import type {
  PersistedStates,
  SnapshotStore,
} from "./snapshot-store";

export const DEFAULT_TICK_MS = 5000;
export const DEFAULT_DOMAIN_TIMEOUT_MS = 30000;

export type CacheLike = {
  get(now: Date): Promise<DataState<unknown>>;
};

export type CollectorDeps = {
  caches: Record<Domain, CacheLike>;
  now?: () => Date;
  tickMs?: number;
  domainTimeoutMs?: number;
  store?: SnapshotStore | null;
  history?: History;
};

export type Collector = {
  start(): Promise<void>;
  stop(): void;
  tick(): Promise<DashboardSnapshotEvent | null>;
  latest(): DashboardSnapshotEvent | null;
  subscribe(listener: (event: DashboardSnapshotEvent) => void): () => void;
  subscriberCount(): number;
  isRunning(): boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

/**
 * Reject if an adapter has not settled within `ms`. A hung adapter must not
 * stall a whole tick; the caller keeps the domain's previous state.
 */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => reject(new Error("adapter timed out")), ms);
    (handle as unknown as { unref?: () => void }).unref?.();
    promise.then(
      (value) => {
        clearTimeout(handle);
        resolve(value);
      },
      (error) => {
        clearTimeout(handle);
        reject(error);
      },
    );
  });
}

/**
 * Polls every domain's cache on a timer, independent of browsers, and turns
 * each tick into one immutable snapshot that is pushed to subscribers only
 * when the serialized data changed. States pass through exactly as the caches
 * return them, so a `data: null` live state stays null and no mock appears.
 */
export function createCollector(deps: CollectorDeps): Collector {
  const now = deps.now ?? (() => new Date());
  const tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
  const domainTimeoutMs = deps.domainTimeoutMs ?? DEFAULT_DOMAIN_TIMEOUT_MS;
  const history = deps.history ?? createHistory();
  const store = deps.store ?? null;
  const domains = Object.keys(deps.caches) as Domain[];
  const listeners = new Set<(event: DashboardSnapshotEvent) => void>();

  let seeded: PersistedStates = {};
  let seededSeq = 0;
  let current: DashboardSnapshotEvent | null = null;
  let signature: string | null = null;
  let ticking = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let hydrated = false;

  async function hydrate() {
    if (hydrated) return;
    hydrated = true;
    const loaded = await (store?.load().catch(() => null) ?? null);
    if (!loaded) return;
    const at = now();
    const states: PersistedStates = {};
    for (const [domain, state] of Object.entries(loaded.data) as [
      Domain,
      DataState<unknown>,
    ][])
      states[domain] = readState(state, at);
    seeded = states;
    seededSeq = loaded.seq;
    history.restore(
      loaded.history,
      loaded.data.systems?.lastAttempt,
    );
  }

  async function tick(): Promise<DashboardSnapshotEvent | null> {
    if (ticking) {
      log("collector_tick_skipped", {});
      return current;
    }
    ticking = true;
    try {
      await hydrate();
      const at = now();
      const results = await Promise.allSettled(
        domains.map(async (domain) => {
          const state = await withDeadline(
            deps.caches[domain].get(at),
            domainTimeoutMs,
          );
          return [domain, state] as const;
        }),
      );
      const previous = (current?.data ?? seeded) as PersistedStates;
      const merged: PersistedStates = { ...previous };
      results.forEach((result, index) => {
        const domain = domains[index];
        if (result.status === "fulfilled") merged[domain] = result.value[1];
        else
          log("collector_domain_failed", {
            domain,
            message: errorMessage(result.reason),
          });
      });
      const data = merged as DashboardData;
      history.push(merged.systems as DataState<SystemState> | undefined);
      const nextSignature = JSON.stringify(data);
      const changed = signature === null || nextSignature !== signature;
      signature = nextSignature;
      const seq = changed
        ? (current?.seq ?? seededSeq) + 1
        : (current?.seq ?? seededSeq);
      const snapshot: DashboardSnapshotEvent = {
        v: STREAM_PROTOCOL_VERSION,
        seq,
        serverTime: at.toISOString(),
        data,
        history: { systems: history.samples() },
      };
      current = snapshot;
      if (changed)
        for (const listener of [...listeners]) {
          try {
            listener(snapshot);
          } catch {
            // A bad subscriber must not poison the tick or other listeners.
          }
        }
      if (store)
        await store
          .save({
            data,
            serverTime: snapshot.serverTime,
            seq: snapshot.seq,
            history: snapshot.history.systems,
          })
          .catch(() => {});
      return snapshot;
    } finally {
      ticking = false;
    }
  }

  return {
    async start() {
      if (started) return;
      started = true;
      log("collector_started", { tickMs });
      void tick();
      timer = setInterval(() => {
        void tick();
      }, tickMs);
      (timer as unknown as { unref?: () => void }).unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (started) {
        started = false;
        log("collector_stopped", {});
      }
    },
    tick,
    latest: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscriberCount: () => listeners.size,
    isRunning: () => started,
  };
}

type CollectorHolder = typeof globalThis & {
  lifedashCollector?: Collector;
};

const holder = globalThis as CollectorHolder;

/**
 * The collector is a single `globalThis` instance because the instrumentation
 * module and the route-handler bundle are separate module graphs that share one
 * global object (verified in Step 0).
 */
export function getCollector(): Collector | null {
  return holder.lifedashCollector ?? null;
}

export function setCollector(collector: Collector | null): void {
  if (collector) holder.lifedashCollector = collector;
  else delete holder.lifedashCollector;
}
