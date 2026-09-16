import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export function normalizeMacMemory(output: string, total: number): number {
  const pageSize = Number(output.match(/page size of (\d+) bytes/)?.[1]);
  const pages = [
    "Pages active",
    "Pages wired down",
    "Pages occupied by compressor",
  ].map((label) =>
    Number(output.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1]),
  );
  if (!pageSize || total <= 0 || pages.some((value) => !Number.isFinite(value)))
    throw new Error("macOS memory statistics unavailable");
  return Math.round(
    Math.max(
      0,
      Math.min(
        100,
        ((pages.reduce((a, b) => a + b, 0) * pageSize) / total) * 100,
      ),
    ),
  );
}
async function memoryPercent(total: number) {
  if (os.platform() !== "darwin")
    return Math.round((1 - os.freemem() / total) * 100);
  try {
    const { stdout } = await execFileAsync("/usr/bin/vm_stat", [], {
      timeout: 2000,
      maxBuffer: 16000,
    });
    return normalizeMacMemory(stdout, total);
  } catch {
    return null;
  }
}
import { statfs } from "node:fs/promises";
import type { Adapter, SystemMetric, SystemState } from "@/domains/models";
import { config, type HealthEndpoint } from "@/config";
import { log } from "@/lib/log";
let previous: { idle: number; total: number } | null = null;
const knownStatuses = new Map<string, SystemMetric["status"]>();
function cpu() {
  const aggregate = os.cpus().reduce(
    (a, c) => ({
      idle: a.idle + c.times.idle,
      total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0),
    }),
    { idle: 0, total: 0 },
  );
  const old = previous;
  previous = aggregate;
  if (!old || aggregate.total <= old.total) return null;
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (1 - (aggregate.idle - old.idle) / (aggregate.total - old.total)) * 100,
      ),
    ),
  );
}
export async function checkEndpoint(
  endpoint: HealthEndpoint,
  id: string,
): Promise<SystemMetric> {
  const start = performance.now();
  let status: SystemMetric["status"] = "offline";
  let detail = "Request failed";
  try {
    const response = await fetch(endpoint.url, {
      signal: AbortSignal.timeout(endpoint.timeoutMs || 5000),
      cache: "no-store",
      redirect: "follow",
    });
    status = response.ok ? "online" : "offline";
    detail = response.ok ? "HTTP healthy" : `HTTP ${response.status}`;
    await response.body?.cancel();
  } catch (error) {
    detail =
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
        ? "Timed out"
        : "Unreachable";
  }
  const old = knownStatuses.get(id);
  if (old && old !== status)
    log("service_state_changed", {
      service: endpoint.name,
      from: old,
      to: status,
    });
  knownStatuses.set(id, status);
  return {
    id,
    name: endpoint.name,
    status,
    latencyMs: Math.round(performance.now() - start),
    uptimeSeconds: null,
    cpuPercent: null,
    memoryPercent: null,
    diskPercent: null,
    detail,
  };
}
export const systemsAdapter: Adapter<SystemState> = {
  provider: "Node OS + HTTP checks",
  source: "real",
  async fetch() {
    const total = os.totalmem();
    const disks = await statfs(process.cwd()).catch(() => null);
    const machine: SystemMetric = {
      id: "machine",
      name:
        process.env.LIFEDASH_MACHINE_NAME ||
        (os.platform() === "darwin" ? "Mac" : "Host"),
      status: "online",
      latencyMs: null,
      uptimeSeconds: os.uptime(),
      cpuPercent: cpu(),
      memoryPercent: await memoryPercent(total),
      diskPercent:
        disks && disks.blocks > 0
          ? Math.round((1 - disks.bavail / disks.blocks) * 100)
          : null,
      detail: "Dashboard host",
    };
    const endpoints = await Promise.all(
      [
        {
          name: "Internet / API",
          url: "https://api.github.com",
          timeoutMs: 5000,
        },
        ...config.services,
      ].map((e, i) => checkEndpoint(e, i === 0 ? "internet" : `service-${i}`)),
    );
    return { machine, endpoints };
  },
};
