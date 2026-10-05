import { createContext, useContext } from "react";
import type { SystemSample } from "@/lib/use-dashboard-data";

export const SystemHistoryContext = createContext<SystemSample[]>([]);

export function useSystemHistory() {
  return useContext(SystemHistoryContext);
}

/**
 * The clock a refresh feeds the UI. It only ever moves forward: the ticking
 * `now` wins, and a refresh timestamp newer than the last tick is adopted so
 * the display clock never sits behind the data it just accepted.
 */
export function clockAt(now: Date, receivedAt: number | null): Date {
  return receivedAt !== null && receivedAt > now.getTime()
    ? new Date(receivedAt)
    : now;
}

/** Start the 15 s display-clock tick; returns the cleanup that stops it. */
export function startClockTick(setNow: (now: Date) => void, intervalMs = 15000) {
  const timer = setInterval(() => setNow(new Date()), intervalMs);
  return () => clearInterval(timer);
}
