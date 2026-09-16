import settings from "./dashboard.json";
import type { DisplayConfig, Domain } from "@/domains/models";
export type HealthEndpoint = { name: string; url: string; timeoutMs?: number };
const number = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  const n = value?.trim() ? Number(value) : fallback;
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
function workCalendars(): string[] {
  try {
    const value: unknown = JSON.parse(process.env.WORK_CALENDARS || '["Work"]');
    return Array.isArray(value) &&
      value.every((name) => typeof name === "string")
      ? value
      : [];
  } catch {
    return [];
  }
}
function timezone() {
  const candidate =
    process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "America/Chicago";
  }
}
export function healthEndpoints(): HealthEndpoint[] {
  try {
    const parsed: unknown = process.env.SYSTEM_HEALTH_ENDPOINTS
      ? JSON.parse(process.env.SYSTEM_HEALTH_ENDPOINTS)
      : settings.services;
    if (!Array.isArray(parsed)) throw new Error();
    return parsed.map((item: HealthEndpoint) => {
      const url = new URL(item.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        !item.name?.trim()
      )
        throw new Error();
      return {
        name: item.name,
        url: url.toString(),
        timeoutMs: number(String(item.timeoutMs || 5000), 5000, 500, 15000),
      };
    });
  } catch {
    console.error(
      JSON.stringify({
        event: "configuration_invalid",
        field: "SYSTEM_HEALTH_ENDPOINTS",
        message:
          "Use an array of named HTTP(S) URLs without embedded credentials.",
      }),
    );
    return [];
  }
}
export const config = {
  display: {
    timezone: timezone(),
    locale: settings.display.locale,
    currency: settings.display.currency,
    rotationSeconds: number(
      process.env.ROTATION_SECONDS,
      settings.display.rotationSeconds,
      10,
      300,
    ),
    pixelShift: settings.display.pixelShift,
    modes: {
      morning: number(process.env.MORNING_START, settings.modes.morning, 0, 23),
      day: number(process.env.DAY_START, settings.modes.day, 0, 23),
      evening: number(process.env.EVENING_START, settings.modes.evening, 0, 23),
      night: number(process.env.NIGHT_START, settings.modes.night, 0, 23),
    },
  } satisfies DisplayConfig,
  latitude: number(process.env.LIFEDASH_LATITUDE, 41.8781, -90, 90),
  longitude: number(process.env.LIFEDASH_LONGITUDE, -87.6298, -180, 180),
  location: process.env.LIFEDASH_LOCATION || "Chicago",
  weatherUnit:
    process.env.WEATHER_UNIT === "C" ? ("C" as const) : ("F" as const),
  demo: process.env.LIFEDASH_DEMO === "true",
  workCalendars: workCalendars(),
  habitsListName: process.env.HABITS_LIST_NAME?.trim() || "Habits",
  goalsListName: process.env.GOALS_LIST_NAME?.trim() || "Goals",
  projectsListName: process.env.PROJECTS_LIST_NAME?.trim() || "Projects",
  githubToken: process.env.GITHUB_TOKEN,
  githubUsername: process.env.GITHUB_USERNAME,
  intervals: Object.fromEntries(
    Object.entries(settings.refreshSeconds).map(([key, value]) => [
      key,
      number(
        process.env[`REFRESH_${key.toUpperCase()}_SECONDS`],
        value,
        15,
        86400,
      ) * 1000,
    ]),
  ) as Record<Domain, number>,
  adapters: settings.adapters,
  services: healthEndpoints(),
  finance: settings.finance,
  goals: settings.goals,
  projects: settings.projects,
};
