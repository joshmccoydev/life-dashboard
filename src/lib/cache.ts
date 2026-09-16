import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { Adapter, DataState } from "@/domains/models";
import { isStale } from "./time";
import { log } from "./log";
export async function refreshAdapter<T>(
  adapter: Adapter<T>,
  fallback: Adapter<T>,
  previous: DataState<T> | undefined,
  now: Date,
  refreshMs: number,
): Promise<DataState<T>> {
  try {
    const data = await adapter.fetch(now);
    const observed = adapter.observedAt?.(data) || now.toISOString();
    if (previous?.status !== "ready")
      log("adapter_recovered", { provider: adapter.provider });
    return {
      loading: false,
      data,
      source: adapter.source,
      provider: adapter.provider,
      status: isStale(observed, now, refreshMs) ? "stale" : "ready",
      lastSuccess: observed,
      lastAttempt: now.toISOString(),
      error: null,
      refreshMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Adapter failed";
    log("adapter_fetch_failed", { provider: adapter.provider, message });
    if (previous)
      return {
        ...previous,
        loading: false,
        status: previous.lastSuccess ? "stale" : "error",
        error: message,
        lastAttempt: now.toISOString(),
        refreshMs,
      };
    log("adapter_switched_to_mock", { provider: adapter.provider });
    return {
      loading: false,
      data: await fallback.fetch(now),
      source: "mock",
      provider: fallback.provider,
      status: "error",
      lastSuccess: null,
      lastAttempt: now.toISOString(),
      error: message,
      refreshMs,
    };
  }
}
export function readState<T>(state: DataState<T>, now: Date): DataState<T> {
  return {
    ...state,
    status: state.error
      ? state.lastSuccess
        ? "stale"
        : "error"
      : isStale(state.lastSuccess, now, state.refreshMs)
        ? "stale"
        : "ready",
  };
}
export class AdapterCache<T> {
  private state?: DataState<T>;
  private pending?: Promise<DataState<T>>;
  private initialized = false;
  constructor(
    private name: string,
    private adapter: Adapter<T>,
    private fallback: Adapter<T>,
    private interval: number,
    private persist = true,
  ) {}
  async get(now = new Date()): Promise<DataState<T>> {
    if (this.pending) return this.pending;
    if (
      this.initialized &&
      this.state &&
      now.getTime() - Date.parse(this.state.lastAttempt) < this.interval
    )
      return readState(this.state, now);
    this.pending = this.update(now).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async update(now: Date) {
    if (!this.initialized) {
      if (this.persist) {
        try {
          const raw = JSON.parse(
            await readFile(
              path.join(process.cwd(), ".lifedash", `${this.name}.json`),
              "utf8",
            ),
          ) as DataState<T>;
          if (
            raw.source === this.adapter.source &&
            raw.provider === this.adapter.provider &&
            raw.lastSuccess &&
            !Number.isNaN(Date.parse(raw.lastAttempt))
          )
            this.state = raw;
        } catch {}
      }
      this.initialized = true;
      log("adapter_initialized", {
        domain: this.name,
        provider: this.adapter.provider,
        source: this.adapter.source,
      });
    }
    if (
      this.state &&
      now.getTime() - Date.parse(this.state.lastAttempt) < this.interval
    )
      return readState(this.state, now);
    const old = this.state;
    this.state = await refreshAdapter(
      this.adapter,
      this.fallback,
      this.state,
      now,
      this.interval,
    );
    if (this.state.status === "ready" && this.adapter.source === "real")
      log("adapter_fetch_succeeded", { domain: this.name });
    if (old?.status === "ready" && this.state.status !== "ready")
      log("data_became_stale", { domain: this.name });
    if (
      this.persist &&
      this.state.lastSuccess &&
      this.state.source === "real"
    ) {
      try {
        const folder = path.join(process.cwd(), ".lifedash");
        await mkdir(folder, { recursive: true });
        const file = path.join(folder, `${this.name}.json`);
        await writeFile(`${file}.tmp`, JSON.stringify(this.state));
        await rename(`${file}.tmp`, file);
      } catch {
        log("cache_write_failed", { domain: this.name });
      }
    }
    return this.state;
  }
}
