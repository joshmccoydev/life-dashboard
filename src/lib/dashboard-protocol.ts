import type { DashboardData } from "@/domains/models";

/**
 * Wire contract for GET /api/dashboard/stream. This module is isomorphic: it is
 * imported by the Node collector/route and by the browser stream client, so it
 * must not import `node:*` or React.
 */
export const STREAM_PROTOCOL_VERSION = 1;
export const STREAM_RETRY_MS = 5000;
export const STREAM_HEARTBEAT_MS = 15000;
export const HISTORY_LIMIT = 18;

export type SystemSample = {
  cpu: number | null;
  memory: number | null;
  disk: number | null;
};

export type DashboardSnapshotEvent = {
  v: typeof STREAM_PROTOCOL_VERSION;
  seq: number;
  serverTime: string;
  data: DashboardData;
  history: { systems: SystemSample[] };
};

export type SnapshotValidator = (data: unknown) => DashboardData;

export function encodeSseRetry(ms: number = STREAM_RETRY_MS): string {
  return `retry: ${ms}\n\n`;
}

export function encodeSseComment(text: string): string {
  return `: ${text}\n\n`;
}

/** A comment keeps the wire heartbeat while the named event resets EventSource clients' watchdogs. */
export function encodeSseHeartbeat(): string {
  return ": hb\nevent: heartbeat\ndata: hb\n\n";
}

export function encodeSseEvent(event: DashboardSnapshotEvent): string {
  return `event: snapshot\nid: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
}

function normalizeSample(value: unknown): SystemSample {
  if (!value || typeof value !== "object")
    throw new Error("Invalid snapshot history sample");
  const sample = value as Partial<SystemSample>;
  const metric = (input: unknown) =>
    typeof input === "number" && Number.isFinite(input) ? input : null;
  return {
    cpu: metric(sample.cpu),
    memory: metric(sample.memory),
    disk: metric(sample.disk),
  };
}

/**
 * Parse one SSE `data:` payload into a snapshot event. Throws on invalid JSON,
 * a wrong protocol version, missing required fields, or a validator failure.
 */
export function parseSnapshotEvent(
  raw: string,
  validate: SnapshotValidator,
): DashboardSnapshotEvent {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object")
    throw new Error("Invalid snapshot event");
  const event = value as Partial<DashboardSnapshotEvent>;
  if (event.v !== STREAM_PROTOCOL_VERSION)
    throw new Error("Unsupported snapshot protocol version");
  if (
    typeof event.seq !== "number" ||
    !Number.isInteger(event.seq) ||
    event.seq < 1
  )
    throw new Error("Invalid snapshot sequence");
  if (typeof event.serverTime !== "string")
    throw new Error("Invalid snapshot serverTime");
  if (!("data" in event)) throw new Error("Missing snapshot data");
  if (
    !event.history ||
    typeof event.history !== "object" ||
    !Array.isArray((event.history as { systems?: unknown }).systems)
  )
    throw new Error("Missing snapshot history");
  const data = validate(event.data);
  return {
    v: STREAM_PROTOCOL_VERSION,
    seq: event.seq,
    serverTime: event.serverTime,
    data,
    history: {
      systems: (event.history as { systems: unknown[] }).systems.map(
        normalizeSample,
      ),
    },
  };
}
