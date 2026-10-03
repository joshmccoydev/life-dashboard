import { config } from "@/config";

/**
 * Start the always-on collector with the Next.js server instance. Only the
 * Node.js runtime, when the collector is enabled and demo mode is off, runs it;
 * `LIFEDASH_COLLECTOR=off` restores today's on-demand refresh behavior.
 *
 * The Node-only modules are imported dynamically inside the runtime guard so
 * the Edge instrumentation bundle never pulls in `node:fs`, `node:os`,
 * `node:child_process` or `node:crypto` (which Turbopack warns about).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!config.collector.enabled) return;
  if (config.demo) return;
  const { createCollector, getCollector, setCollector } = await import(
    "@/server/collector"
  );
  if (getCollector()) return;
  const { getCaches } = await import("@/adapters");
  const { createHistory } = await import("@/server/history");
  const { createSnapshotStore } = await import("@/server/snapshot-store");
  const collector = createCollector({
    caches: getCaches(),
    tickMs: config.collector.tickMs,
    store: createSnapshotStore(),
    history: createHistory(),
  });
  setCollector(collector);
  await collector.start();
}
