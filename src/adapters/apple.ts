import { readFile } from "node:fs/promises";
import { config } from "@/config";
import { resolve } from "node:path";
import type {
  Adapter,
  CalendarState,
  HabitState,
  ReminderState,
} from "@/domains/models";
import { localDateKey } from "@/lib/time";
export const appleBridgePath =
  process.env.APPLE_BRIDGE_PATH ||
  (process.platform === "darwin"
    ? resolve(".lifedash/apple-bridge.json")
    : null);
export function normalizeAppleSnapshot(
  payload: unknown,
  domain: "calendar" | "reminders" | "habits",
  now: Date,
): CalendarState | ReminderState | HabitState {
  type HabitReminder = {
    id: string;
    title: string;
    due: string | null;
    completed: boolean;
    completedAt: string | null;
  };
  const body = payload as {
    version: number;
    capturedAt: string;
    permissions: Record<string, boolean>;
    calendar?: CalendarState;
    reminders?: ReminderState;
    habits?: { items: HabitReminder[] };
  };
  const captured = Date.parse(body?.capturedAt);
  if (
    body?.version !== 1 ||
    !Number.isFinite(captured) ||
    now.getTime() - captured > 180000 ||
    captured > now.getTime() + 60000
  )
    throw new Error("Apple bridge snapshot stale; restart the bridge");
  const permission = domain === "habits" ? "reminders" : domain;
  if (!body.permissions?.[permission])
    throw new Error(
      `Grant LifeDash Bridge ${domain} access in macOS Privacy & Security`,
    );
  if (domain === "calendar") {
    if (
      !Array.isArray(body.calendar?.events) ||
      body.calendar.events.some(
        (e) =>
          !e.id ||
          typeof e.title !== "string" ||
          !Number.isFinite(Date.parse(e.start)) ||
          !Number.isFinite(Date.parse(e.end)),
      )
    )
      throw new Error("Apple calendar snapshot invalid");
    return {
      events: body.calendar.events
        .map((e) => ({
          ...e,
          calendar: (config.workCalendars.some(
            (name) => name.toLowerCase() === e.calendarName?.toLowerCase(),
          )
            ? "work"
            : e.calendarName
              ? "personal"
              : e.calendar) as "work" | "personal",
        }))
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    };
  }
  if (domain === "habits") {
    if (
      !Array.isArray(body.habits?.items) ||
      body.habits.items.some(
        (item) =>
          !item.id ||
          typeof item.title !== "string" ||
          typeof item.completed !== "boolean" ||
          (item.due !== null && !Number.isFinite(Date.parse(item.due))) ||
          (item.completedAt !== null &&
            !Number.isFinite(Date.parse(item.completedAt))),
      )
    )
      throw new Error(
        `Apple habits snapshot invalid; create a Reminders list named ${config.habitsListName}`,
      );
    const today = localDateKey(now, config.display.timezone);
    const grouped = new Map<
      string,
      HabitState["habits"][number] & {
        occurrenceMap: Map<
          string,
          HabitState["habits"][number]["occurrences"][number]
        >;
      }
    >();
    for (const item of body.habits.items) {
      const title = item.title.trim();
      if (!title) continue;
      const key = title.toLocaleLowerCase(config.display.locale);
      const date =
        item.completed && item.completedAt
          ? localDateKey(new Date(item.completedAt), config.display.timezone)
          : item.due
            ? localDateKey(new Date(item.due), config.display.timezone)
            : today;
      const habit = grouped.get(key) || {
        id: key,
        title,
        trackingMethod: "reminder" as const,
        sourceId: item.id,
        occurrences: [],
        occurrenceMap: new Map(),
      };
      const previous = habit.occurrenceMap.get(date);
      if (!previous || item.completed) {
        habit.occurrenceMap.set(date, {
          date,
          completed: item.completed,
          completedAt: item.completedAt,
        });
      }
      grouped.set(key, habit);
    }
    return {
      date: today,
      habits: [...grouped.values()]
        .map(({ occurrenceMap, ...habit }) => ({
          ...habit,
          occurrences: [...occurrenceMap.values()].sort((a, b) =>
            a.date.localeCompare(b.date),
          ),
        }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    };
  }
  if (
    !Array.isArray(body.reminders?.items) ||
    body.reminders.items.some(
      (r) =>
        !r.id ||
        typeof r.title !== "string" ||
        typeof r.completed !== "boolean" ||
        (r.due !== null && !Number.isFinite(Date.parse(r.due))),
    )
  )
    throw new Error("Apple reminders snapshot invalid");
  return {
    items: [...body.reminders.items].sort(
      (a, b) =>
        (a.due ? Date.parse(a.due) : Infinity) -
        (b.due ? Date.parse(b.due) : Infinity),
    ),
  };
}
function appleAdapter<T extends CalendarState | ReminderState | HabitState>(
  domain: "calendar" | "reminders" | "habits",
): Adapter<T> {
  return {
    provider: `Apple ${domain} bridge`,
    source: "real",
    async fetch(now) {
      if (!appleBridgePath) throw new Error("Configure APPLE_BRIDGE_PATH");
      let payload: unknown;
      try {
        payload = JSON.parse(
          await readFile(/* turbopackIgnore: true */ appleBridgePath, "utf8"),
        );
      } catch {
        throw new Error("Start Apple bridge with npm run bridge:apple");
      }
      return normalizeAppleSnapshot(payload, domain, now) as T;
    },
  };
}
export const appleCalendarAdapter = appleAdapter<CalendarState>("calendar");
export const appleRemindersAdapter = appleAdapter<ReminderState>("reminders");
export const appleHabitsAdapter = appleAdapter<HabitState>("habits");
