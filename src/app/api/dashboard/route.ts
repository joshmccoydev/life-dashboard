import { getDemoDashboard } from "@/adapters";
import {
  loadLiveDashboard,
  type LiveDashboardDependencies,
} from "@/lib/live-dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context?: { params?: Promise<unknown> } & Partial<LiveDashboardDependencies>,
): Promise<Response> {
  try {
    const demo = new URL(request.url).searchParams.get("demo") === "true";
    const now = context?.now?.() ?? new Date();
    return Response.json(
      {
        data: demo
          ? await getDemoDashboard()
          : await loadLiveDashboard(context ?? {}),
        serverTime: now.toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error(JSON.stringify({ event: "dashboard_request_failed" }));
    return Response.json(
      { error: "Dashboard refresh unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
