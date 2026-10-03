import type { ComponentType } from "react";
import type {
  DashboardData,
  DataState,
  DisplayConfig,
  Domain,
  Mode,
} from "@/domains/models";
import { isStale } from "@/lib/time";
import type { SystemSample } from "@/lib/use-dashboard-data";

export type WidgetProps = {
  data: DashboardData;
  now: Date;
  display: DisplayConfig;
  mode: Mode;
  history: SystemSample[];
};

export type WidgetDefinition = {
  id: string;
  domain: Domain;
  title: string;
  staleAfterMs?: number | ((refreshMs: number) => number);
  Component: ComponentType<WidgetProps>;
};

/**
 * Staleness for a widget's feed. When the definition does not declare its own
 * staleness the result is exactly `isStale`, so no widget's badge changes.
 */
export function isWidgetStale(
  widget: Pick<WidgetDefinition, "staleAfterMs"> | null,
  state: Pick<DataState<unknown>, "lastSuccess" | "refreshMs">,
  now: Date,
) {
  const staleAfterMs = widget?.staleAfterMs;
  const threshold =
    staleAfterMs === undefined
      ? state.refreshMs
      : typeof staleAfterMs === "function"
        ? staleAfterMs(state.refreshMs)
        : staleAfterMs;
  if (threshold === state.refreshMs) {
    return isStale(state.lastSuccess, now, state.refreshMs);
  }
  return (
    !state.lastSuccess ||
    now.getTime() - Date.parse(state.lastSuccess) > threshold
  );
}
