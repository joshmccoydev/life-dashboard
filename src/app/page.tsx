import { getDemoDashboard } from "@/adapters";
import { config } from "@/config";
import { Dashboard } from "@/components/dashboard";
import { loadLiveDashboard } from "@/lib/live-dashboard";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const demo = query.demo === "true" || config.demo;
  const mode = ["morning", "day", "evening", "night"].includes(
    String(query.mode),
  )
    ? String(query.mode)
    : undefined;
  return (
    <Dashboard
      initial={await (demo ? getDemoDashboard() : loadLiveDashboard())}
      renderedAt={new Date().toISOString()}
      display={config.display}
      demo={demo}
      forcedMode={mode}
      paused={query.pause === "true"}
    />
  );
}
