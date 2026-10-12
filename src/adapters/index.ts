import type {
  DashboardData,
  Domain,
  Adapter,
  DataState,
} from "@/domains/models";
import { config } from "@/config";
import * as mocks from "./mock";
import { weatherAdapter } from "./weather";
import { githubAdapter } from "./github";
import {
  appleBridgePath,
  appleCalendarAdapter,
  appleGoalsAdapter,
  appleHabitsAdapter,
  appleRemindersAdapter,
} from "./apple";
import { codexAdapter, codexBinary } from "./codex";
import { healthAdapter } from "./health";
import { systemsAdapter } from "./systems";
import { AdapterCache } from "@/lib/cache";
import { log } from "@/lib/log";
import { getCollector } from "@/server/collector";
import { createHash } from "node:crypto";

const DOMAIN_KEYS: readonly Domain[] = [
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

/** True when every dashboard domain is present (a seeded restart may not be). */
export function isCompleteDashboardData(
  data: Partial<DashboardData>,
): data is DashboardData {
  return DOMAIN_KEYS.every((key) => key in data);
}

export function selectAdapter<T>(
  real: Adapter<T> | null,
  mock: Adapter<T>,
  selection: string,
  demo: boolean,
) {
  return !demo && selection !== "mock" && real ? real : mock;
}
function make<T>(
  name: Domain,
  mock: Adapter<T>,
  real: Adapter<T> | null = null,
) {
  const identity =
    name === "weather"
      ? `${config.latitude}/${config.longitude}/${config.weatherUnit}/${config.location}/${config.display.timezone}`
      : name === "build"
        ? `${config.githubUsername}/${config.display.timezone}`
        : name;
  const cacheName = `${name}-${createHash("sha256").update(identity).digest("hex").slice(0, 12)}`;
  return new AdapterCache(
    cacheName,
    selectAdapter(real, mock, config.adapters[name], config.demo),
    mock,
    config.intervals[name],
    name === "weather" || name === "build",
  );
}
function createCaches() {
  log("application_started", {
    demo: config.demo,
    timezone: config.display.timezone,
  });
  return {
    weather: make("weather", mocks.mockWeather, weatherAdapter),
    calendar: make(
      "calendar",
      mocks.mockCalendar,
      appleBridgePath ? appleCalendarAdapter : null,
    ),
    reminders: make(
      "reminders",
      mocks.mockReminders,
      appleBridgePath ? appleRemindersAdapter : null,
    ),
    habits: make(
      "habits",
      mocks.mockHabits,
      appleBridgePath ? appleHabitsAdapter : null,
    ),
    finance: make("finance", mocks.mockFinance),
    health: make("health", mocks.mockHealth, healthAdapter),
    build: make(
      "build",
      mocks.mockBuild,
      config.githubUsername ? githubAdapter : null,
    ),
    ai: make("ai", mocks.mockAI, codexBinary ? codexAdapter : null),
    systems: make("systems", mocks.mockSystems, systemsAdapter),
    goals: make(
      "goals",
      mocks.mockGoals,
      appleBridgePath ? appleGoalsAdapter : null,
    ),
  };
}
const holder = globalThis as typeof globalThis & {
  lifedashCaches?: ReturnType<typeof createCaches>;
};
export function getCaches(): ReturnType<typeof createCaches> {
  return (holder.lifedashCaches ??= createCaches());
}
export async function getDashboard(): Promise<DashboardData> {
  const collector = getCollector();
  const snapshot = collector?.isRunning() ? collector.latest() : null;
  if (snapshot && isCompleteDashboardData(snapshot.data)) return snapshot.data;
  const caches = getCaches();
  // After a restart the collector is seeded with the persisted domains only;
  // fill the missing domains from the caches so the response keeps ten keys.
  const keys = snapshot
    ? DOMAIN_KEYS.filter(
        (key) => !(key in (snapshot.data as Record<string, unknown>)),
      )
    : (Object.keys(caches) as Domain[]);
  const values = await Promise.all(
    keys.map(async (key) => [key, await caches[key].get()] as const),
  );
  const fromCaches = Object.fromEntries(values) as Partial<DashboardData>;
  return (snapshot
    ? { ...fromCaches, ...snapshot.data }
    : fromCaches) as DashboardData;
}
export async function getDemoDashboard(): Promise<DashboardData> {
  const pairs = [
    ["weather", mocks.mockWeather],
    ["calendar", mocks.mockCalendar],
    ["reminders", mocks.mockReminders],
    ["habits", mocks.mockHabits],
    ["finance", mocks.mockFinance],
    ["health", mocks.mockHealth],
    ["build", mocks.mockBuild],
    ["ai", mocks.mockAI],
    ["systems", mocks.mockSystems],
    ["goals", mocks.mockGoals],
  ] as const;
  const now = new Date();
  return Object.fromEntries(
    await Promise.all(
      pairs.map(async ([key, adapter]) => [
        key,
        {
          loading: false,
          data: await adapter.fetch(now),
          source: "mock",
          provider: adapter.provider,
          status: "ready",
          lastSuccess: now.toISOString(),
          lastAttempt: now.toISOString(),
          error: null,
          refreshMs: config.intervals[key],
        } satisfies DataState<unknown>,
      ]),
    ),
  ) as DashboardData;
}
