import {
  getDashboard,
  getDemoDashboard,
} from "@/adapters";
import { log } from "@/lib/log";
import {
  monotonicSeq,
  STREAM_PROTOCOL_VERSION,
  type DashboardSnapshotEvent,
} from "@/lib/dashboard-protocol";
import type { DashboardData } from "@/domains/models";
import { getCollector } from "@/server/collector";
import { createHistory } from "@/server/history";
import { loadSnapshot } from "@/server/snapshot-store";
import {
  acquireStreamClient,
  createSseStream,
  releaseStreamClient,
  streamClientCount,
} from "@/server/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STREAM_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

function parseLastEventId(value: string | null): number | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Persisted sequence at the last write, so a restart never regresses. */
async function persistedSeq(): Promise<number> {
  const loaded = await loadSnapshot().catch(() => null);
  return loaded?.seq ?? 0;
}

function snapshotFromData(
  data: DashboardData,
  baseSeq: number,
): DashboardSnapshotEvent {
  const history = createHistory();
  history.push(data.systems);
  return {
    v: STREAM_PROTOCOL_VERSION,
    seq: monotonicSeq(baseSeq, Date.now()),
    serverTime: new Date().toISOString(),
    data,
    history: { systems: history.samples() },
  };
}

function demoSnapshot(data: DashboardData): DashboardSnapshotEvent {
  return {
    v: STREAM_PROTOCOL_VERSION,
    seq: Date.now(),
    serverTime: new Date().toISOString(),
    data,
    history: { systems: [] },
  };
}

/**
 * Server-Sent Events feed for the display. With a running collector this
 * follows its snapshots; otherwise it emits one snapshot built the same way as
 * GET /api/dashboard. `?demo=true` never touches or subscribes to the
 * collector. Live streams share a 16-client cap; demo streams do not take
 * live client slots.
 */
export function HEAD(): Response {
  // Health checks, `curl -I` and proxies must not consume a client slot or
  // start a stream: headers only, same shape as GET, no body.
  return new Response(null, { status: 200, headers: STREAM_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: { Allow: "GET, HEAD, OPTIONS" },
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const demo = url.searchParams.get("demo") === "true";
  const lastEventId = parseLastEventId(request.headers.get("last-event-id"));

  if (!demo && !acquireStreamClient())
    return Response.json(
      { error: "Too many stream clients" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );

  try {
    const collector = demo ? null : getCollector();
    let initialSnapshot: DashboardSnapshotEvent | null;
    if (demo) {
      initialSnapshot = demoSnapshot(await getDemoDashboard());
    } else {
      const latest = collector?.latest() ?? null;
      initialSnapshot = latest
        ? latest
        : collector
          ? null
          : snapshotFromData(await getDashboard(), await persistedSeq());
    }
    if (!demo) log("sse_client_connected", { clients: streamClientCount() });
    const stream = createSseStream({
      source: collector,
      initialSnapshot,
      lastEventId,
      signal: request.signal,
      onClose: () => {
        if (!demo) releaseStreamClient();
        if (!demo) log("sse_client_disconnected", { clients: streamClientCount() });
      },
    });
    return new Response(stream, { headers: STREAM_HEADERS });
  } catch {
    if (!demo) releaseStreamClient();
    if (!demo) log("sse_client_disconnected", { clients: streamClientCount() });
    return Response.json(
      { error: "Dashboard stream unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
