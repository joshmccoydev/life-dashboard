import type {
  DashboardData,
  DataState,
  Domain,
  SystemState,
} from "@/domains/models";
import { readState } from "@/lib/cache";
import { log } from "@/lib/log";
import {
  monotonicSeq,
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
 * State used when a domain fails and has no prior reading to keep. It is an
 * explicit "no data" state (never mock content), so a first-tick failure still
 * yields a complete ten-key snapshot. A domain that does have a previous value
 * keeps it unchanged, exactly as the cache left it.
 */
function unavailableState(
  previous: DataState<unknown> | undefined,
  at: Date,
  message: string,
): DataState<unknown> {
  return {
    loading: false,
    data: null,
    source: "real",
    provider: previous?.provider ?? "unknown",
    status: "error",
    lastSuccess: previous?.lastSuccess ?? null,
    lastAttempt: at.toISOString(),
    error: message,
    refreshMs: previous?.refreshMs ?? 0,
  };
}

/**
 * Polls every domain's cache on a timer, independent of browsers, and turns
 * each tick into one immutable snapshot that is pushed to subscribers only
 * when the serialized data changed. States pass through exactly as the caches
 * return them, so a `data: null` live state stays null and no mock appears.
 *
 * Every domain runs on its own deadline and its own in-flight slot, and each
 * settled domain publishes through `merge()`. One hung domain therefore never
 * delays the others' snapshots nor blocks the next tick for the healthy ones.
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
  const inflight = new Set<Domain>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let hydrated = false;
  let pendingSave: DashboardSnapshotEvent | null = null;
  let saving = false;
  let lastSavedSignature: string | null = null;

  function emptyState(at: Date): DataState<unknown> {
    return {
      loading: false,
      data: null,
      source: "real",
      provider: "pending",
      status: "error",
      lastSuccess: null,
      lastAttempt: at.toISOString(),
      error: "Awaiting first refresh",
      refreshMs: 0,
    };
  }

  function completeStates(
    states: PersistedStates,
    at: Date,
  ): PersistedStates {
    const complete: PersistedStates = { ...states };
    for (const domain of domains) complete[domain] ??= emptyState(at);
    return complete;
  }

  /**
   * Coalescing writer: only changed snapshots are queued, a burst of changes in
   * one tick collapses to the newest, and ordered writes keep the file current.
   */
  async function flushSaves(): Promise<void> {
    if (!store || saving) return;
    saving = true;
    try {
      while (pendingSave) {
        const snapshot = pendingSave;
        pendingSave = null;
        await store
          .save({
            data: snapshot.data,
            serverTime: snapshot.serverTime,
            seq: snapshot.seq,
            history: snapshot.history.systems,
          })
          .catch(() => {});
      }
    } finally {
      saving = false;
    }
  }

  async function hydrate() {
    if (hydrated) return;
    hydrated = true;
    const loaded = await (store?.load().catch(() => null) ?? null);
    const at = now();
    if (!loaded) {
      seeded = completeStates({}, at);
      const data = seeded as DashboardData;
      current = {
        v: STREAM_PROTOCOL_VERSION,
        seq: at.getTime(),
        serverTime: at.toISOString(),
        data,
        history: { systems: history.samples() },
      };
      signature = JSON.stringify(data);
      return;
    }
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
    // Seed latest() from the persisted snapshot so a restart serves last-known
    // values (re-marked stale) before the first tick finishes.
    const data = completeStates(states, at) as DashboardData;
    current = {
      v: STREAM_PROTOCOL_VERSION,
      seq: Math.max(loaded.seq, at.getTime()),
      serverTime: loaded.serverTime ?? at.toISOString(),
      data,
      history: { systems: history.samples() },
    };
    signature = JSON.stringify(data);
    lastSavedSignature = signature;
    seeded = completeStates(states, at);
  }

  function merge(
    domain: Domain,
    state: DataState<unknown>,
    at: Date,
  ): DashboardSnapshotEvent {
    const previous = (current?.data ?? seeded) as PersistedStates;
    const merged: PersistedStates = { ...previous, [domain]: state };
    const data = merged as DashboardData;
    if (domain === "systems")
      history.push(merged.systems as DataState<SystemState>);
    const nextSignature = JSON.stringify(data);
    const changed = signature === null || nextSignature !== signature;
    if (!changed && current) {
      return current;
    }
    signature = nextSignature;
    const previousSeq = current?.seq ?? seededSeq;
    const seq = changed ? monotonicSeq(previousSeq, at.getTime()) : previousSeq;
    const snapshot: DashboardSnapshotEvent = {
      v: STREAM_PROTOCOL_VERSION,
      seq,
      serverTime: at.toISOString(),
      data,
      history: { systems: history.samples() },
    };
    current = snapshot;
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
        // A bad subscriber must not poison the tick or other listeners.
      }
    }
    if (store && changed && nextSignature !== lastSavedSignature) {
      lastSavedSignature = nextSignature;
      pendingSave = snapshot;
      void flushSaves();
    }
    return snapshot;
  }

  async function refreshDomain(domain: Domain, at: Date): Promise<void> {
    inflight.add(domain);
    try {
      const state = await withDeadline(
        deps.caches[domain].get(at),
        domainTimeoutMs,
      );
      const previous = (current?.data ?? seeded) as PersistedStates;
      const prior = previous[domain];
      merge(
        domain,
        state.data === null && prior?.data != null
          ? {
              ...prior,
              status: "stale",
              error: state.error,
              lastAttempt: state.lastAttempt,
              refreshMs: state.refreshMs,
            }
          : state,
        at,
      );
    } catch (error) {
      const message = errorMessage(error);
      log("collector_domain_failed", { domain, message });
      const previous = (current?.data ?? seeded) as PersistedStates;
      const prior = previous[domain];
      merge(
        domain,
        prior && prior.data !== null && prior.data !== undefined
          ? prior
          : unavailableState(prior, at, message),
        at,
      );
    } finally {
      inflight.delete(domain);
    }
  }

  async function tick(): Promise<DashboardSnapshotEvent | null> {
    await hydrate();
    const at = now();
    const pending = domains.filter((domain) => !inflight.has(domain));
    if (!pending.length) {
      log("collector_tick_skipped", {});
      return current;
    }
    if (inflight.size > 0) log("collector_tick_skipped", {});
    await Promise.all(pending.map((domain) => refreshDomain(domain, at)));
    return current;
  }

  return {
    async start() {
      if (started) return;
      started = true;
      await hydrate();
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
