import type { DashboardData } from "@/domains/models";

const FEED_KEYS: (keyof DashboardData)[] = [
  "weather",
  "calendar",
  "reminders",
  "finance",
  "health",
  "build",
  "ai",
  "systems",
  "habits",
  "goals",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasDataKey(value: unknown): value is { data: unknown } {
  return isObject(value) && "data" in value;
}

function isNullableNumber(value: unknown): boolean {
  return value === null || typeof value === "number";
}

function hasRefreshMs(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.refreshMs === "number" &&
    Number.isFinite(value.refreshMs)
  );
}

function isArray(value: unknown): boolean {
  return Array.isArray(value);
}

/**
 * Minimal shape checks for a non-null feed payload. Feeds with `data: null`
 * stay valid so a live source that has no reading yet is still accepted
 * (CTO-0007 rev2 behavior: no-data systems must not freeze refresh).
 */
function isFeedPayloadValid(key: keyof DashboardData, payload: unknown): boolean {
  if (payload === null) return true;
  if (!isObject(payload)) return false;
  switch (key) {
    case "systems":
      return (
        isObject(payload.machine) &&
        isNullableNumber(payload.machine.cpuPercent) &&
        isArray(payload.endpoints)
      );
    case "ai":
      return isArray(payload.providers);
    case "goals":
      return isArray(payload.goals) && isArray(payload.projects);
    case "calendar":
      return isArray(payload.events);
    case "reminders":
      return isArray(payload.items);
    case "habits":
      return isArray(payload.habits);
    case "weather":
    case "build":
    case "finance":
    case "health":
      return true;
    default:
      return false;
  }
}

export function normalizeDashboardResponse(value: unknown): DashboardData {
  if (!isObject(value) || !hasDataKey(value))
    throw new Error("Invalid dashboard response");
  const data = value.data;
  if (!isObject(data)) throw new Error("Invalid dashboard response");
  if (
    !FEED_KEYS.every((key) => {
      const feed = data[key];
      return (
        hasDataKey(feed) &&
        hasRefreshMs(feed) &&
        isFeedPayloadValid(key, feed.data)
      );
    })
  )
    throw new Error("Invalid dashboard response");
  return data as unknown as DashboardData;
}
