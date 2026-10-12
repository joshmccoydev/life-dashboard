import {
  parseSnapshotEvent,
  type DashboardSnapshotEvent,
  type SnapshotValidator,
} from "@/lib/dashboard-protocol";

export type DashboardStreamStatus =
  | "connecting"
  | "open"
  | "stale"
  | "closed";

export type DashboardStreamEvent = { data?: string };

export type DashboardEventSource = {
  addEventListener(
    type: string,
    listener: (event: DashboardStreamEvent) => void,
  ): void;
  removeEventListener?(
    type: string,
    listener: (event: DashboardStreamEvent) => void,
  ): void;
  close(): void;
  onerror?: ((event: unknown) => void) | null;
};

export type DashboardEventSourceFactory = new (
  url: string,
) => DashboardEventSource;

export type OpenDashboardStreamOptions = {
  url: string;
  validate: SnapshotValidator;
  onSnapshot: (event: DashboardSnapshotEvent) => void;
  onStatus?: (status: DashboardStreamStatus) => void;
  onError?: (error: unknown) => void;
  watchdogMs?: number;
  EventSourceImpl?: DashboardEventSourceFactory;
};

export type DashboardStream = { close(): void };

const DEFAULT_WATCHDOG_MS = 45000;

function defaultEventSourceFactory(): DashboardEventSourceFactory {
  const impl = (globalThis as { EventSource?: unknown }).EventSource;
  if (typeof impl !== "function")
    throw new Error("EventSource is unavailable in this environment");
  return impl as DashboardEventSourceFactory;
}

/**
 * Subscribe to the snapshot SSE feed. Duplicate or older `seq` values are
 * ignored; an invalid payload is reported and dropped without closing the
 * stream. A watchdog marks the stream `stale` and rebuilds the `EventSource`
 * when nothing (snapshot or heartbeat) arrives for `watchdogMs`. No DOM global
 * is touched until the function is called.
 */
export function openDashboardStream(
  options: OpenDashboardStreamOptions,
): DashboardStream {
  const watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS;
  const createSource = options.EventSourceImpl ?? defaultEventSourceFactory();
  const attached: {
    type: string;
    handler: (event: DashboardStreamEvent) => void;
  }[] = [];

  let source: DashboardEventSource | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let lastSeq = 0;
  let status: DashboardStreamStatus = "connecting";

  const emitStatus = (next: DashboardStreamStatus) => {
    if (status === next) return;
    status = next;
    options.onStatus?.(next);
  };

  const clearWatchdog = () => {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };

  const armWatchdog = () => {
    clearWatchdog();
    if (closed) return;
    watchdog = setTimeout(() => {
      watchdog = null;
      if (closed) return;
      emitStatus("stale");
      restart();
    }, watchdogMs);
    (watchdog as unknown as { unref?: () => void }).unref?.();
  };

  const onOpen = () => {
    if (closed) return;
    emitStatus("open");
    armWatchdog();
  };

  const onHeartbeat = () => {
    if (closed) return;
    armWatchdog();
  };

  const onSnapshot = (event: DashboardStreamEvent) => {
    if (closed) return;
    armWatchdog();
    try {
      const parsed = parseSnapshotEvent(
        String(event.data ?? ""),
        options.validate,
      );
      if (parsed.seq <= lastSeq) return;
      lastSeq = parsed.seq;
      options.onSnapshot(parsed);
    } catch (error) {
      options.onError?.(error);
    }
  };

  const attach = (
    es: DashboardEventSource,
    type: string,
    handler: (event: DashboardStreamEvent) => void,
  ) => {
    attached.push({ type, handler });
    es.addEventListener(type, handler);
  };

  function connect() {
    const es = new createSource(options.url);
    source = es;
    attach(es, "open", onOpen);
    attach(es, "snapshot", onSnapshot);
    attach(es, "heartbeat", onHeartbeat);
    es.onerror = () => {
      if (closed) return;
      emitStatus("connecting");
      armWatchdog();
    };
    armWatchdog();
  }

  function detach() {
    const es = source;
    source = null;
    if (!es) return;
    for (const { type, handler } of attached) {
      es.removeEventListener?.(type, handler);
    }
    attached.length = 0;
    es.onerror = null;
    es.close();
  }

  function restart() {
    if (closed) return;
    detach();
    emitStatus("connecting");
    connect();
  }

  connect();

  return {
    close() {
      if (closed) return;
      closed = true;
      clearWatchdog();
      detach();
      status = "closed";
      options.onStatus?.("closed");
    },
  };
}
