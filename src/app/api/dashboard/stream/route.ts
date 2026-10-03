import { getDashboard, getDemoDashboard } from "@/adapters";
import { log } from "@/lib/log";
import {
  STREAM_PROTOCOL_VERSION,
  type DashboardSnapshotEvent,
} from "@/lib/dashboard-protocol";
import type { DashboardData } from "@/domains/models";
import { getCollector } from "@/server/collector";
import { createHistory } from "@/server/history";
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

function snapshotFromData(data: DashboardData): DashboardSnapshotEvent {
  const history = createHistory();
  history.push(data.systems);
  return {
    v: STREAM_PROTOCOL_VERSION,
    seq: 1,
    serverTime: new Date().toISOString(),
    data,
    history: { systems: history.samples() },
  };
}

function demoSnapshot(data: DashboardData): DashboardSnapshotEvent {
  return {
    v: STREAM_PROTOCOL_VERSION,
    seq: 1,
    serverTime: new Date().toISOString(),
    data,
    history: { systems: [] },
  };
}

/**
 * Server-Sent Events feed for the display. With a running collector this
 * follows its snapshots; otherwise it emits one snapshot built the same way as
 * GET /api/dashboard. `?demo=true` never touches or subscribes to the
 * collector. The 17th concurrent client is refused.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const demo = url.searchParams.get("demo") === "true";
  const lastEventId = parseLastEventId(request.headers.get("last-event-id"));

  if (!acquireStreamClient())
    return Response.json(
      { error: "Too many stream clients" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );

  try {
    const collector = demo ? null : getCollector();
    const initialSnapshot = demo
      ? demoSnapshot(await getDemoDashboard())
      : (collector?.latest() ?? snapshotFromData(await getDashboard()));
    log("sse_client_connected", { clients: streamClientCount() });
    const stream = createSseStream({
      source: collector,
      initialSnapshot,
      lastEventId,
      signal: request.signal,
      onClose: () => {
        releaseStreamClient();
        log("sse_client_disconnected", { clients: streamClientCount() });
      },
    });
    return new Response(stream, { headers: STREAM_HEADERS });
  } catch {
    releaseStreamClient();
    log("sse_client_disconnected", { clients: streamClientCount() });
    return Response.json(
      { error: "Dashboard stream unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
