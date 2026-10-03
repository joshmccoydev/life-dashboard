import { getCaches } from "@/adapters";
import { config } from "@/config";
import { createCollector, getCollector, setCollector } from "@/server/collector";
import { createHistory } from "@/server/history";
import { createSnapshotStore } from "@/server/snapshot-store";

/**
 * Start the always-on collector with the Next.js server instance. Only the
 * Node.js runtime, when the collector is enabled and demo mode is off, runs it;
 * `LIFEDASH_COLLECTOR=off` restores today's on-demand refresh behavior.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!config.collector.enabled) return;
  if (config.demo) return;
  if (getCollector()) return;
  const collector = createCollector({
    caches: getCaches(),
    tickMs: config.collector.tickMs,
    store: createSnapshotStore(),
    history: createHistory(),
  });
  setCollector(collector);
  await collector.start();
}
