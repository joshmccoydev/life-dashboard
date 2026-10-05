"use client";
import { useEffect, useState } from "react";
import { Activity, Check, Network, TriangleAlert } from "lucide-react";
import type { DashboardData, DisplayConfig, Mode } from "@/domains/models";
import { isStale, modeAt } from "@/lib/time";
import { evaluateAlerts, attentionView } from "@/lib/alerts";
import { useDashboardData } from "@/lib/use-dashboard-data";
import { normalizeDashboardResponse } from "@/lib/dashboard-response";
import { Clock } from "@/components/shared/Clock";
import { PanelBoundary } from "@/components/shared/PanelBoundary";
import { DomainColumn } from "@/components/shared/DomainColumn";
import { SystemHistoryContext, clockAt, startClockTick } from "@/components/shared/client-state";
import { Weather } from "@/components/panels/Weather";
import { COLUMNS } from "@/components/widgets/layout";
import { WIDGETS } from "@/components/widgets/definitions";
import type { UseDashboardData } from "@/lib/use-dashboard-data";

export { normalizeDashboardResponse };

function LiveDashboard({
  initial,
  renderedAt,
  display,
  demo,
  forcedMode,
  paused,
  useData = useDashboardData,
}: {
  initial: DashboardData;
  renderedAt: string;
  display: DisplayConfig;
  demo: boolean;
  forcedMode?: string;
  paused: boolean;
  /**
   * The live data hook. Overridable so the clock derivation below can be
   * exercised without a DOM renderer; production always uses the real hook.
   */
  useData?: (options: {
    initial: DashboardData;
    demo: boolean;
  }) => UseDashboardData;
}) {
  const { data, systemHistory, connectionError, receivedAt } = useData({
    initial,
    demo,
  });
  const [now, setNow] = useState(() => new Date(renderedAt));
  const [rotation, setRotation] = useState(0);
  useEffect(() => startClockTick(setNow), []);
  // `now` keeps ticking every 15 s; a fresher refresh time only moves it forward.
  const clockNow = clockAt(now, receivedAt);
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(
      () => setRotation((i) => i + 1),
      display.rotationSeconds * 1000,
    );
    return () => clearInterval(timer);
  }, [display.rotationSeconds, paused]);
  const mode =
    (forcedMode as Mode | undefined) ||
    modeAt(clockNow, display.timezone, display.modes);
  const alerts = evaluateAlerts(data, clockNow, { includeDemo: demo });
  if (connectionError)
    alerts.unshift({
      id: "connection",
      level: "warning",
      message: "Connection interrupted · retaining last readings",
    });
  const attention = attentionView(alerts, mode, rotation);
  const critical = alerts.some((a) => a.level === "critical");
  const visibleFeeds = Object.entries(data)
    .filter(([domain]) => domain !== "health" && domain !== "finance")
    .map(([, state]) => state);
  const live = visibleFeeds.filter(
    (state) => state.source === "real" && state.data !== null,
  ).length;
  const demoCount = visibleFeeds.filter(
    (state) => state.source === "mock",
  ).length;
  const noData = visibleFeeds.filter(
    (state) => state.source === "real" && state.data === null,
  ).length;
  const sourceProblems = visibleFeeds.some(
    (d) => d.status !== "ready" || isStale(d.lastSuccess, clockNow, d.refreshMs),
  );
  const status =
    critical
      ? "SYSTEM ATTENTION"
      : connectionError || sourceProblems
        ? "FEED ATTENTION"
        : "SYSTEMS NORMAL";
  return (
    <main
      className={`dashboard mode-${mode} ${display.pixelShift ? `pixel-shift-${rotation % 4}` : ""}`}
    >
      <header className="header">
        <Clock display={display} initialTime={renderedAt} />
        <div className="header-right">
          <Weather data={data} now={clockNow} />
          <div className="identity">
            <div className="wordmark">
              <span className="logo">
                <Activity />
              </span>
              lifedash
            </div>
            <div
              className={`global-status ${critical ? "critical" : sourceProblems || connectionError ? "caution" : ""}`}
            >
              <i />
              {status}
            </div>
            <div className="mode-label">
              {mode.toUpperCase()} MODE <span>/</span>{" "}
              {
                new Intl.DateTimeFormat(display.locale, {
                  timeZone: display.timezone,
                  timeZoneName: "short",
                })
                  .formatToParts(clockNow)
                  .find((part) => part.type === "timeZoneName")?.value
              }
            </div>
          </div>
        </div>
      </header>
      <SystemHistoryContext.Provider value={systemHistory}>
        <div className="domain-columns">
          {COLUMNS.map((column) => (
            <PanelBoundary key={column.id} name={column.title}>
              <DomainColumn
                title={column.title}
                subtitle={column.subtitle}
                icon={column.icon}
                className={column.className}
              >
                {column.widgetIds.map((id) => {
                  const widget = WIDGETS[id];
                  if (!widget) return null;
                  const Widget = widget.Component;
                  return (
                    <Widget
                      key={id}
                      data={data}
                      now={clockNow}
                      display={display}
                      mode={mode}
                    />
                  );
                })}
              </DomainColumn>
            </PanelBoundary>
          ))}
        </div>
      </SystemHistoryContext.Provider>
      <footer className="footer">
        <div
          className={`attention ${attention.alert ? "has-alerts" : ""} ${critical ? "critical" : ""}`}
          aria-live="polite"
        >
          {attention.alert ? (
            <>
              <TriangleAlert />
              <span>{attention.alert.message}</span>
              {attention.count > 1 ? (
                <small>+{attention.count - 1}</small>
              ) : null}
            </>
          ) : (
            <>
              <Check />
              <span>No urgent attention needed</span>
            </>
          )}
        </div>
        <div className="feed-summary">
          <Network />
          <span>
            {live} LIVE <span className="footer-divider">/</span>{" "}
            {demoCount}
            {noData > 0
              ? ` DEMO / ${noData} NO DATA FEEDS`
              : " DEMO FEEDS"}
          </span>
          <span className="footer-divider">·</span>
          <span>AUTOMATIC REFRESH</span>
        </div>
      </footer>
    </main>
  );
}
export function Dashboard(props: Parameters<typeof LiveDashboard>[0]) {
  return (
    <PanelBoundary name="LifeDash">
      <LiveDashboard {...props} />
    </PanelBoundary>
  );
}
