import type { DisplayConfig, Mode } from "@/domains/models";
export function localHour(now: Date, timezone: string) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
}
export function modeAt(
  now: Date,
  timezone: string,
  modes: DisplayConfig["modes"],
): Mode {
  const hour = localHour(now, timezone);
  const entries = Object.entries(modes) as [Mode, number][];
  entries.sort((a, b) => a[1] - b[1]);
  return (
    [...entries].reverse().find(([, start]) => hour >= start)?.[0] ||
    entries.at(-1)![0]
  );
}
export function localDateKey(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function zonedDateTime(
  key: string,
  hour: number,
  minute: number,
  timezone: string,
) {
  const target = Date.parse(
    `${key}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`,
  );
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (key: string) => parts.find((p) => p.type === key)!.value;
    const rendered = Date.parse(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`,
    );
    guess += target - rendered;
  }
  return new Date(guess);
}
export function dayKeyOffset(now: Date, offset: number, timezone: string) {
  const key = localDateKey(now, timezone);
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
export function ageLabel(value: string | null, now: Date) {
  if (!value) return "not updated";
  const seconds = Math.max(0, (now.getTime() - Date.parse(value)) / 1000);
  return seconds < 60
    ? "just now"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h ago`
        : `${Math.floor(seconds / 86400)}d ago`;
}
export function isStale(
  lastSuccess: string | null,
  now: Date,
  refreshMs: number,
) {
  return (
    !lastSuccess || now.getTime() - Date.parse(lastSuccess) > refreshMs * 2
  );
}
