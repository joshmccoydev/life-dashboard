import { getDashboard, getDemoDashboard } from "@/adapters";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const demo = new URL(request.url).searchParams.get("demo") === "true";
    return Response.json(
      {
        data: await (demo ? getDemoDashboard() : getDashboard()),
        serverTime: new Date().toISOString(),
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
