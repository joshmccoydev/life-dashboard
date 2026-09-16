import type { HealthState } from "@/domains/models";
import { localDateKey, zonedDateTime } from "./time";
import { timingSafeEqual } from "node:crypto";
export function healthAuthorized(
  header: string | null,
  token: string | undefined,
) {
  if (!token || token.length < 32 || !header?.startsWith("Bearer "))
    return false;
  const supplied = Buffer.from(header.slice(7)),
    expected = Buffer.from(token);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
const fields = [
  "steps",
  "sleepMinutes",
  "activityPercent",
  "exerciseMinutes",
  "exerciseGoal",
  "standHours",
  "standGoal",
  "stepGoal",
  "activeEnergy",
] as const;
export type HealthDay = Partial<HealthState> & { date: string };
function validDay(date: string, timezone: string, now: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = zonedDateTime(date, 12, 0, timezone);
  return (
    Number.isFinite(parsed.getTime()) &&
    localDateKey(parsed, timezone) === date &&
    date <= localDateKey(now, timezone) &&
    now.getTime() - parsed.getTime() < 16 * 86400000
  );
}
export function normalizeHealthSync(
  payload: unknown,
  timezone: string,
  now: Date,
): HealthDay[] {
  if (!payload || typeof payload !== "object")
    throw new Error("Expected JSON Health metrics");
  const body = payload as {
    date?: string;
    data?: { metrics?: unknown[] };
    metrics?: unknown[];
    [key: string]: unknown;
  };
  if (body.date) {
    if (!validDay(body.date, timezone, now))
      throw new Error("Health date must be within the last 15 days");
    const day: HealthDay = { date: body.date };
    let count = 0;
    for (const key of fields)
      if (body[key] !== undefined) {
        const value = body[key];
        if (
          value !== null &&
          (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        )
          throw new Error(`Invalid ${key}`);
        day[key] = value as number | null;
        count++;
      }
    if (!count) throw new Error("No supported Health metrics supplied");
    return [day];
  }
  const metrics = body.data?.metrics || body.metrics;
  if (!Array.isArray(metrics) || metrics.length > 30)
    throw new Error("Expected a Health Auto Export metrics array");
  const days = new Map<string, HealthDay>();
  const seen = new Set<string>();
  const names: Record<string, keyof HealthState> = {
    step_count: "steps",
    apple_exercise_time: "exerciseMinutes",
    apple_stand_hour: "standHours",
    stand_hours: "standHours",
    active_energy: "activeEnergy",
  };
  for (const raw of metrics) {
    const metric = raw as {
      name: string;
      units: string;
      data: {
        date: string;
        qty?: number;
        totalSleep?: number;
        asleep?: number;
      }[];
    };
    if (!metric || !(metric.name in names || metric.name === "sleep_analysis"))
      continue;
    if (!Array.isArray(metric.data) || metric.data.length > 16)
      throw new Error("Enable daily aggregation and export the last two days");
    for (const sample of metric.data) {
      if (typeof sample?.date !== "string")
        throw new Error("Missing Health metric date");
      const date = /^\d{4}-\d{2}-\d{2}$/.test(sample.date)
        ? sample.date
        : localDateKey(new Date(sample.date), timezone);
      if (!validDay(date, timezone, now))
        throw new Error("Health date must be within the last 15 days");
      const identity = `${metric.name}/${date}`;
      if (seen.has(identity))
        throw new Error(
          "Enable daily aggregation; multiple totals for one metric/day are ambiguous",
        );
      seen.add(identity);
      const day = days.get(date) || { date };
      let value =
        metric.name === "sleep_analysis"
          ? (sample.totalSleep ?? sample.asleep)
          : sample.qty;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw new Error(
          "Invalid Health quantity; sleep needs daily aggregation",
        );
      if (metric.name === "sleep_analysis") {
        if (!["hr", "min"].includes(metric.units))
          throw new Error("Sleep unit must be hr or min");
        day.sleepMinutes = Math.round(value * (metric.units === "hr" ? 60 : 1));
      } else {
        const field = names[metric.name];
        if (field === "steps" && metric.units !== "count")
          throw new Error("Step unit must be count");
        if (field === "exerciseMinutes" && metric.units !== "min")
          throw new Error("Exercise unit must be min");
        if (field === "activeEnergy") {
          if (!["kcal", "kJ"].includes(metric.units))
            throw new Error("Active energy unit must be kcal or kJ");
          value = metric.units === "kJ" ? value / 4.184 : value;
        }
        (day as Record<string, unknown>)[field] = Math.round(value);
      }
      days.set(date, day);
    }
  }
  if (!days.size) throw new Error("No supported Health metrics supplied");
  return [...days.values()];
}
export function mergeHealthDays(
  previous: HealthDay[],
  updates: HealthDay[],
  receivedAt: string,
  timezone: string,
): HealthState[] {
  const defaults = {
    steps: null,
    stepGoal: null,
    sleepMinutes: null,
    activityPercent: null,
    exerciseMinutes: null,
    exerciseGoal: null,
    standHours: null,
    standGoal: null,
    activeEnergy: null,
    workout: null,
  };
  const days = new Map(previous.map((day) => [day.date, day]));
  for (const update of updates) {
    const observed =
      update.date === localDateKey(new Date(receivedAt), timezone)
        ? receivedAt
        : zonedDateTime(update.date, 23, 59, timezone).toISOString();
    days.set(update.date, {
      ...defaults,
      ...days.get(update.date),
      ...update,
      syncedAt: receivedAt,
      sampledAt: observed,
      stepSource: "iPhone Health sync",
    });
  }
  return [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-15) as HealthState[];
}
