import os from "node:os";
import { statfs } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Adapter, SystemMetric, SystemState } from "@/domains/models";
import { config, type HealthEndpoint } from "@/config";
import { log } from "@/lib/log";

const execFileAsync = promisify(execFile);

// Some hosts answer 403 to requests without a User-Agent, which is not an outage.
export const PROBE_USER_AGENT = "LifeDash/1.0 (+life-dashboard health probe)";
export const PROBE_BACKOFF_MS = 200;
// Any status below 5xx means the host answered; only 5xx means "down", and no
// answer at all (network failure or timeout) means "offline".
const DOWN_STATUS = 500;

export type ProbeTarget = { name: string; url: string };

// Independent hosts so one provider's throttle or outage is not mistaken for lost
// connectivity: a connectivity-check URL plus well-known hosts on separate networks.
export const INTERNET_TARGETS: ProbeTarget[] = [
  {
    name: "Google connectivity check",
    url: "https://www.gstatic.com/generate_204",
  },
  { name: "GitHub API", url: "https://api.github.com" },
  { name: "Cloudflare", url: "https://www.cloudflare.com/cdn-cgi/trace" },
];

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
function recordStatus(
  id: string,
  name: string,
  status: SystemMetric["status"],
) {
  const old = knownStatuses.get(id);
  if (old && old !== status)
    log("service_state_changed", { service: name, from: old, to: status });
  knownStatuses.set(id, status);
}
function failureDetail(error: unknown) {
  return error instanceof Error &&
    ["TimeoutError", "AbortError"].includes(error.name)
    ? "Timed out"
    : "Unreachable";
}
async function requestOnce(url: string, timeoutMs: number) {
  const start = performance.now();
  try {
    const response = await fetch(url, {
      headers: { "user-agent": PROBE_USER_AGENT, accept: "*/*" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      redirect: "follow",
    });
    await response.body?.cancel().catch(() => {});
    return {
      reachable: true,
      status: response.status,
      latencyMs: Math.round(performance.now() - start),
      detail: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      latencyMs: Math.round(performance.now() - start),
      detail: failureDetail(error),
    };
  }
}
export type ProbeResult = {
  target: ProbeTarget;
  reachable: boolean;
  status: number | null;
  latencyMs: number;
  detail: string;
};
// Retry once with backoff so a single dropped packet is not reported as offline.
export async function probeTarget(
  target: ProbeTarget,
  timeoutMs = 5000,
  retries = 1,
): Promise<ProbeResult> {
  let result = await requestOnce(target.url, timeoutMs);
  for (let attempt = 0; attempt < retries && !result.reachable; attempt++) {
    await new Promise((resolve) =>
      setTimeout(resolve, PROBE_BACKOFF_MS * (attempt + 1)),
    );
    result = await requestOnce(target.url, timeoutMs);
  }
  return { target, ...result };
}
// The internet is online when any probe host answers, degraded when some hosts
// fail, and offline only when every probe fails.
export async function checkInternet(
  targets: ProbeTarget[] = INTERNET_TARGETS,
): Promise<SystemMetric> {
  const results = await Promise.all(
    targets.map((target) => probeTarget(target)),
  );
  const reachable = results.filter((result) => result.reachable);
  const failed = results.filter((result) => !result.reachable);
  const status: SystemMetric["status"] =
    reachable.length === 0
      ? "offline"
      : failed.length === 0
        ? "online"
        : "unknown";
  const detail =
    reachable.length === 0
      ? `No connectivity (${failed.length}/${results.length} probes failed)`
      : failed.length === 0
        ? "Healthy"
        : `Degraded (${failed.length}/${results.length} probes failed: ${failed
            .map((result) => result.target.name)
            .join(", ")})`;
  recordStatus("internet", "Internet / API", status);
  return {
    id: "internet",
    name: "Internet / API",
    status,
    latencyMs: reachable.length
      ? Math.min(...reachable.map((result) => result.latencyMs))
      : null,
    uptimeSeconds: null,
    cpuPercent: null,
    memoryPercent: null,
    diskPercent: null,
    detail,
  };
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
      headers: { "user-agent": PROBE_USER_AGENT, accept: "*/*" },
      signal: AbortSignal.timeout(endpoint.timeoutMs || 5000),
      cache: "no-store",
      redirect: "follow",
    });
    // 2xx/3xx/4xx from a reachable host is not an outage; 5xx is.
    status = response.status < DOWN_STATUS ? "online" : "offline";
    detail = `HTTP ${response.status}`;
    await response.body?.cancel();
  } catch (error) {
    detail = failureDetail(error);
  }
  recordStatus(id, endpoint.name, status);
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
    const [internet, ...services] = await Promise.all([
      checkInternet(),
      ...config.services.map((endpoint, index) =>
        checkEndpoint(endpoint, `service-${index + 1}`),
      ),
    ]);
    return { machine, endpoints: [internet, ...services] };
  },
};
