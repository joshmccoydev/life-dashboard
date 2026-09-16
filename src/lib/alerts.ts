import type { DashboardData, Mode } from "@/domains/models";
import { isStale } from "./time";
export type Alert = {
  id: string;
  level: "critical" | "warning" | "info";
  message: string;
};
export function evaluateAlerts(
  data: DashboardData,
  now: Date,
  options: { includeDemo?: boolean } = {},
): Alert[] {
  const includeDemo = options.includeDemo ?? true;
  const alerts: Alert[] = [];
  const time = now.getTime();
  const systems = data.systems.data;
  for (const s of includeDemo || data.systems.source === "real"
    ? [systems.machine, ...systems.endpoints]
    : []) {
    if (s.status === "offline")
      alerts.push({
        id: `offline-${s.id}`,
        level: "critical",
        message: `${s.name} is offline`,
      });
    if (s.diskPercent !== null && s.diskPercent > 90)
      alerts.push({
        id: `disk-${s.id}`,
        level: "critical",
        message: `${s.name} disk ${Math.round(s.diskPercent)}% full`,
      });
  }
  const overdue = data.reminders.data.items.filter(
    (r) => !r.completed && r.due !== null && Date.parse(r.due) < time,
  );
  if (overdue.length && (includeDemo || data.reminders.source === "real"))
    alerts.push({
      id: "overdue",
      level: "warning",
      message: `${overdue.length} overdue ${overdue.length === 1 ? "reminder" : "reminders"}${data.reminders.source === "mock" ? " · demo" : ""}`,
    });
  const meeting = data.calendar.data.events.find(
    (e) =>
      !e.allDay &&
      Date.parse(e.start) >= time &&
      Date.parse(e.start) - time <= 15 * 60000,
  );
  if (meeting && (includeDemo || data.calendar.source === "real"))
    alerts.push({
      id: "meeting",
      level: "info",
      message: `${meeting.title} in ${Math.ceil((Date.parse(meeting.start) - time) / 60000)} min${data.calendar.source === "mock" ? " · demo" : ""}`,
    });
  for (const bill of includeDemo || data.finance.source === "real"
    ? data.finance.data.bills
    : []) {
    const delta = Date.parse(bill.due) - time;
    if (delta >= 0 && delta < 48 * 3600000)
      alerts.push({
        id: `bill-${bill.title}`,
        level: "warning",
        message: `${bill.title} due ${delta < 24 * 3600000 ? "within 24h" : "tomorrow"}${data.finance.source === "mock" ? " · demo" : ""}`,
      });
  }
  for (const [key, source] of Object.entries(data)) {
    if (
      source.status !== "ready" ||
      isStale(source.lastSuccess, now, source.refreshMs)
    )
      alerts.push({
        id: `stale-${key}`,
        level: "warning",
        message: `${key[0].toUpperCase() + key.slice(1)} ${source.lastSuccess ? "data stale" : "unavailable"}${source.source === "mock" ? " · showing demo" : ""}`,
      });
  }
  return alerts.sort(
    (a, b) =>
      ({ critical: 0, warning: 1, info: 2 })[a.level] -
      { critical: 0, warning: 1, info: 2 }[b.level],
  );
}

export function attentionView(alerts: Alert[], mode: Mode, rotation: number) {
  const critical = alerts.filter((alert) => alert.level === "critical");
  const visible = critical.length
    ? critical
    : mode === "night"
      ? alerts.filter(
          (alert) => alert.id === "connection" || alert.id.startsWith("stale-"),
        )
      : alerts;
  return {
    alert: visible.length ? visible[rotation % visible.length] : null,
    count: visible.length,
  };
}
