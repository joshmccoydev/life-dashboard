"use client";
import { useEffect, useRef, useState } from "react";
import type { DashboardData } from "@/domains/models";
import { normalizeDashboardResponse } from "./dashboard-response";

export type SystemSample = {
  cpu: number | null;
  memory: number | null;
  disk: number | null;
};

export type DashboardTransport = "poll" | "sse";

export type UseDashboardData = {
  data: DashboardData;
  systemHistory: SystemSample[];
  connectionError: boolean;
  /** epoch ms of the last accepted update, null before the first one */
  receivedAt: number | null;
  transport: DashboardTransport;
};

export function systemSample(data: DashboardData): SystemSample {
  const machine = data.systems.data?.machine;
  return {
    cpu: machine?.cpuPercent ?? null,
    memory: machine?.memoryPercent ?? null,
    disk: machine?.diskPercent ?? null,
  };
}

const HISTORY_LIMIT = 18;

/**
 * Pure state transition for one accepted dashboard response. Throws
 * `Invalid dashboard response` (from the validator) on malformed input, in
 * which case the caller keeps the previous state untouched.
 */
export function applyDashboardUpdate(
  prev: { data: DashboardData; systemHistory: SystemSample[] },
  response: unknown,
): { data: DashboardData; systemHistory: SystemSample[] } {
  const data = normalizeDashboardResponse(response);
  return {
    data,
    systemHistory: [...prev.systemHistory, systemSample(data)].slice(
      -HISTORY_LIMIT,
    ),
  };
}

export type PollingState = {
  data: DashboardData;
  systemHistory: SystemSample[];
  connectionError: boolean;
};

export type PollingController = {
  /** Trigger one refresh; resolves when the attempt has finished. */
  tick: () => Promise<void>;
  /** Bypass the in-flight guard (used by the tests and a future SSE seam). */
  applyResponse: (response: unknown) => void;
  /** Latest state, safe to read outside render. */
  read: () => PollingState;
  /** Stop the controller; any in-flight response is discarded. */
  stop: () => void;
  /** Whether an attempt is currently in flight. */
  isBusy: () => boolean;
};

export type PollingControllerOptions = {
  /** Starting state (usually seeded from the server render). */
  initial: PollingState;
  /** URL to poll; defaults to the demo-aware dashboard endpoint. */
  url?: string;
  /** Injected fetch so tests never touch the network. */
  fetchImpl?: typeof fetch;
  /** Injected clock for `receivedAt`. */
  now?: () => number;
  /** Injected per-attempt abort timeout. */
  abortAfterMs?: number;
  /** Called after every state change (accepted update or failure). */
  onState?: (state: PollingState, receivedAt: number | null) => void;
};

/**
 * React-free polling state machine. `useDashboardData` only maps its state into
 * React; the network, the in-flight guard and the error flag live here so the
 * previously untested closure (F7-4) can be exercised deterministically.
 */
export function createPollingController({
  initial,
  url = "/api/dashboard",
  fetchImpl = fetch,
  now = Date.now,
  abortAfterMs = 15000,
  onState,
}: PollingControllerOptions): PollingController {
  let state = initial;
  let busy = false;
  let stopped = false;
  let controller: AbortController | null = null;
  let receivedAt: number | null = null;

  function publish(next: PollingState, at: number | null) {
    state = next;
    receivedAt = at;
    onState?.(next, at);
  }

  function applyResponse(response: unknown) {
    if (stopped) return;
    const next = applyDashboardUpdate(state, response);
    publish(
      { ...next, connectionError: false },
      now(),
    );
  }

  async function tick() {
    if (busy || stopped) return;
    busy = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), abortAfterMs);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Refresh failed");
      const payload = await response.json();
      if (!stopped) applyResponse(payload);
    } catch {
      if (!stopped) publish({ ...state, connectionError: true }, receivedAt);
    } finally {
      clearTimeout(timeout);
      busy = false;
    }
  }

  return {
    tick,
    applyResponse,
    read: () => state,
    stop: () => {
      stopped = true;
      controller?.abort();
    },
    isBusy: () => busy,
  };
}

export function useDashboardData({
  initial,
  demo,
}: {
  initial: DashboardData;
  demo: boolean;
}): UseDashboardData {
  const [data, setData] = useState(initial);
  const [systemHistory, setSystemHistory] = useState<SystemSample[]>(() => [
    systemSample(initial),
  ]);
  const [connectionError, setConnectionError] = useState(false);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const controllerRef = useRef<PollingController | null>(null);

  useEffect(() => {
    const controller = createPollingController({
      initial: { data, systemHistory, connectionError: false },
      url: `/api/dashboard${demo ? "?demo=true" : ""}`,
      onState: (next, at) => {
        setData(next.data);
        setSystemHistory(next.systemHistory);
        setConnectionError(next.connectionError);
        setReceivedAt(at);
      },
    });
    controllerRef.current = controller;
    const tick = () => void controller.tick();
    const interval = setInterval(tick, 30000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    window.addEventListener("online", tick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.stop();
      controllerRef.current = null;
      clearInterval(interval);
      window.removeEventListener("online", tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // The controller is seeded once and only rebuilt when the polling target
    // changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  return { data, systemHistory, connectionError, receivedAt, transport: "poll" };
}
