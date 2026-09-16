import type { HabitState } from "@/domains/models";
import { dayKeyOffset, localDateKey } from "./time";

export function habitWeekDates(now: Date, timezone: string) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(now);
  const mondayOffset =
    (
      {
        Sun: -6,
        Mon: 0,
        Tue: -1,
        Wed: -2,
        Thu: -3,
        Fri: -4,
        Sat: -5,
      } as Record<string, number>
    )[weekday] ?? 0;
  return Array.from({ length: 7 }, (_, index) =>
    dayKeyOffset(now, mondayOffset + index, timezone),
  );
}

export function habitWeek(
  habit: HabitState["habits"][number],
  now: Date,
  timezone: string,
) {
  const today = localDateKey(now, timezone);
  const dates = habitWeekDates(now, timezone);
  const byDate = new Map(habit.occurrences.map((item) => [item.date, item]));
  const days = dates.map((date) => ({ date, occurrence: byDate.get(date) }));
  const scheduled = habit.occurrences
    .filter((item) => item.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  let currentStreak = 0;
  for (const item of [...scheduled].reverse()) {
    if (!item.completed) break;
    currentStreak++;
  }
  let run = 0;
  let bestStreak = 0;
  for (const item of scheduled) {
    run = item.completed ? run + 1 : 0;
    bestStreak = Math.max(bestStreak, run);
  }
  return {
    days,
    completed: days.filter((day) => day.occurrence?.completed).length,
    scheduled: days.filter((day) => day.occurrence).length,
    today: byDate.get(today),
    currentStreak,
    bestStreak,
  };
}
