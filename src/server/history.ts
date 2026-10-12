import type { DataState, SystemState } from "@/domains/models";
import {
  HISTORY_LIMIT,
  type SystemSample,
} from "@/lib/dashboard-protocol";

export type History = {
  /** Append at most one sample per distinct `systems` refresh. */
  push(state: DataState<SystemState> | undefined): void;
  /** Oldest first, never longer than HISTORY_LIMIT. */
  samples(): SystemSample[];
  size(): number;
  restore(samples: SystemSample[], lastAttempt?: string): void;
};

/**
 * In-memory ring of the last HISTORY_LIMIT system samples. A sample is only
 * appended for a real `systems` reading with a `lastAttempt` we have not seen
 * yet, so a single refresh never produces duplicate points and a `data: null`
 * state invents nothing.
 */
export function createHistory(limit: number = HISTORY_LIMIT): History {
  const entries: SystemSample[] = [];
  let lastAttempt: string | null = null;
  return {
    push(state) {
      if (!state) return;
      const machine = state.data?.machine;
      if (!machine) return;
      if (state.lastAttempt === lastAttempt) return;
      lastAttempt = state.lastAttempt;
      entries.push({
        cpu: machine.cpuPercent ?? null,
        memory: machine.memoryPercent ?? null,
        disk: machine.diskPercent ?? null,
      });
      while (entries.length > limit) entries.shift();
    },
    samples() {
      return entries.map((entry) => ({ ...entry }));
    },
    size() {
      return entries.length;
    },
    restore(samples, lastSampledAttempt) {
      entries.splice(
        0,
        entries.length,
        ...samples.slice(-limit).map((entry) => ({ ...entry })),
      );
      lastAttempt = lastSampledAttempt ?? null;
    },
  };
}
