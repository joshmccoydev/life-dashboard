import {
  encodeSseEvent,
  encodeSseHeartbeat,
  encodeSseRetry,
  STREAM_HEARTBEAT_MS,
  type DashboardSnapshotEvent,
} from "@/lib/dashboard-protocol";
import { log } from "@/lib/log";

/** Home-LAN cap; the 17th concurrent stream is refused with 503. */
export const MAX_STREAM_CLIENTS = 16;

/**
 * Per-client backpressure cap. A client that does not read (a half-open TCP
 * connection) would otherwise grow the server's queue without bound; once its
 * unread queue reaches this many bytes it is dropped and its slot released.
 */
export const MAX_QUEUED_BYTES = 512 * 1024;

export type SnapshotSource = {
  latest(): DashboardSnapshotEvent | null;
  subscribe(listener: (event: DashboardSnapshotEvent) => void): () => void;
};

export type SseStreamOptions = {
  /** Collector to follow, or `null` for a heartbeat-only stream (demo/off). */
  source?: SnapshotSource | null;
  initialSnapshot: DashboardSnapshotEvent | null;
  lastEventId?: number | null;
  heartbeatMs?: number;
  signal: AbortSignal;
  onClose?: () => void;
};

type ClientHolder = typeof globalThis & { lifedashStreamClients?: number };

const clientHolder = globalThis as ClientHolder;

export function streamClientCount(): number {
  return clientHolder.lifedashStreamClients ?? 0;
}

/** Reserve a client slot; false when the cap is already reached. */
export function acquireStreamClient(): boolean {
  const count = streamClientCount();
  if (count >= MAX_STREAM_CLIENTS) return false;
  clientHolder.lifedashStreamClients = count + 1;
  return true;
}

export function releaseStreamClient(): void {
  clientHolder.lifedashStreamClients = Math.max(0, streamClientCount() - 1);
}

/**
 * Encode the SSE response body: `retry:` then the initial snapshot (unless the
 * client already has that `seq`), then one `snapshot` event per new `seq`, plus
 * a heartbeat frame every `heartbeatMs` (`: hb` comment plus a named
 * `heartbeat` event so the client watchdog resets). Cleanup runs on request
 * abort, stream cancel, write failure and an unread client that exceeds
 * `MAX_QUEUED_BYTES`, so no subscriber, slot or timer is leaked.
 */
export function createSseStream(
  options: SseStreamOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const heartbeatMs = options.heartbeatMs ?? STREAM_HEARTBEAT_MS;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let cleaned = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const cleanup = (close: boolean) => {
    if (cleaned) return;
    cleaned = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    const off = unsubscribe;
    unsubscribe = null;
    if (off) off();
    options.onClose?.();
    if (close && controllerRef) {
      try {
        controllerRef.close();
      } catch {
        // The stream may already be closed by the runtime.
      }
    }
  };

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controllerRef = controller;
        const write = (text: string) => {
          if (cleaned) return;
          const bytes = encoder.encode(text);
          if (
            controller.desiredSize !== null &&
            bytes.byteLength > controller.desiredSize
          ) {
            // The client stopped reading: drop it instead of buffering forever.
            log("sse_client_slow", { capBytes: MAX_QUEUED_BYTES });
            cleanup(true);
            return;
          }
          try {
            controller.enqueue(bytes);
          } catch {
            cleanup(false);
          }
        };
        write(encodeSseRetry());
        const initial = options.initialSnapshot;
        const lastEventId = options.lastEventId ?? null;
        if (initial && !(lastEventId !== null && lastEventId === initial.seq))
          write(encodeSseEvent(initial));
        if (options.source)
          unsubscribe = options.source.subscribe((event) =>
            write(encodeSseEvent(event)),
          );
        heartbeat = setInterval(() => write(encodeSseHeartbeat()), heartbeatMs);
        (heartbeat as unknown as { unref?: () => void }).unref?.();
        options.signal.addEventListener("abort", () => cleanup(true), {
          once: true,
        });
        if (options.signal.aborted) cleanup(true);
      },
      cancel() {
        cleanup(false);
      },
    },
    // Count queued bytes, not chunks, so the cap is a real memory bound.
    new ByteLengthQueuingStrategy({ highWaterMark: MAX_QUEUED_BYTES }),
  );
}
