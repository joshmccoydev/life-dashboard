import type { DisplayConfig } from "@/domains/models";

export function time(value: string, display: DisplayConfig) {
  return new Intl.DateTimeFormat(display.locale, {
    timeZone: display.timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function weekday(value: string, display: DisplayConfig) {
  return new Intl.DateTimeFormat(display.locale, {
    timeZone: display.timezone,
    weekday: "short",
  })
    .format(new Date(value))
    .toUpperCase();
}

export function workCalendarLabel(value: string | undefined) {
  const name = value || "Work";
  return name.replace(/^work\s*[-–—:]?\s*/i, "") || "Work";
}

export function personalCalendarLabel(value: string | undefined) {
  return (value || "Personal").replace(/\s+schedule$/i, "");
}

export function workCalendarTone(value: string | undefined) {
  const hash = Array.from(value || "Work").reduce(
    (total, character) => (total * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  return `tone-${hash % 3}`;
}

export function remainingTone(value: number | null) {
  return value === null
    ? "metric-neutral"
    : value >= 60
      ? "metric-good"
      : value >= 25
        ? "metric-mid"
        : "metric-low";
}

export function resetTone(value: number | undefined) {
  return value === undefined
    ? "metric-neutral"
    : value >= 3
      ? "metric-good"
      : value === 2
        ? "metric-mid"
        : "metric-low";
}

export function usageTone(value: number | null) {
  return value === null
    ? "metric-neutral"
    : value < 60
      ? "metric-good"
      : value < 85
        ? "metric-mid"
        : "metric-low";
}

export function goalDue(value: string | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
      }).format(new Date(value))
    : null;
}
