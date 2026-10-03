import type { DataState } from "@/domains/models";
import { ageLabel } from "@/lib/time";
import { isWidgetStale } from "@/components/widgets/contract";

export function feedBadge(state: DataState<unknown>) {
  if (state.source === "mock") return "DEMO";
  if (
    state.provider === "Apple Health" &&
    !(state.data as { syncedAt?: string } | null)?.syncedAt
  )
    return "IMPORT";
  return "LIVE";
}

export function Feed({ state, now }: { state: DataState<unknown>; now: Date }) {
  const noData = state.source === "real" && state.data === null;
  const stale = state.status !== "ready" || isWidgetStale(state, now);
  return (
    <span className={`feed ${stale ? "feed-stale" : ""}`} title={state.error || `${state.provider} ${String.fromCharCode(183)} ${ageLabel(state.lastSuccess, now)}`}>
      {noData ? "NO DATA" : feedBadge(state)}
      {stale && !noData ? (
        <>
          <span className="feed-divider">/</span>
          {state.lastSuccess
            ? `STALE ${ageLabel(state.lastSuccess, now).replace(" ago", "")}`
            : "UNAVAILABLE"}
        </>
      ) : !noData && state.source === "real" ? (
        <i />
      ) : null}
    </span>
  );
}
