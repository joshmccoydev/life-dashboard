import type { ComponentType } from "react";
import type {
  DashboardData,
  DataState,
  DisplayConfig,
  Mode,
} from "@/domains/models";
import { isStale } from "@/lib/time";

export type WidgetProps = {
  data: DashboardData;
  now: Date;
  display: DisplayConfig;
  mode: Mode;
};

export type WidgetDefinition = {
  id: string;
  Component: ComponentType<WidgetProps>;
};

/**
 * Staleness for a widget's feed. Exactly `isStale`, exposed at the widget layer
 * so `Feed` has one place to ask and tests can pin the default factor.
 */
export function isWidgetStale(
  state: Pick<DataState<unknown>, "lastSuccess" | "refreshMs">,
  now: Date,
) {
  return isStale(state.lastSuccess, now, state.refreshMs);
}
