import type {
  Adapter,
  WeatherState,
  CalendarState,
  ReminderState,
  FinanceState,
  HealthState,
  BuildState,
  AITelemetryState,
  SystemState,
  GoalState,
  HabitState,
} from "@/domains/models";
import { config } from "@/config";
import { dayKeyOffset, localDateKey, zonedDateTime } from "@/lib/time";
import { habitWeekDates } from "@/lib/habits";
const mock = <T>(provider: string, fetch: (now: Date) => T): Adapter<T> => ({
  provider,
  source: "mock",
  fetch: async (now) => fetch(now),
});
const at = (now: Date, offset: number, hour: number, minute = 0) =>
  zonedDateTime(
    dayKeyOffset(now, offset, config.display.timezone),
    hour,
    minute,
    config.display.timezone,
  ).toISOString();
export const mockWeather = mock<WeatherState>("Demo weather", () => ({
  temperature: config.weatherUnit === "C" ? 23 : 74,
  feelsLike: config.weatherUnit === "C" ? 23 : 73,
  condition: "Partly cloudy",
  code: 2,
  unit: config.weatherUnit,
  high: config.weatherUnit === "C" ? 26 : 78,
  low: config.weatherUnit === "C" ? 16 : 61,
  location: config.location,
  isDay: true,
}));
export const mockCalendar = mock<CalendarState>("Demo calendar", (now) => ({
  events: [
    {
      id: "standup",
      title: "Team stand-up",
      start: at(now, 0, 9, 30),
      end: at(now, 0, 9, 45),
      calendar: "work",
      location: "Teams",
    },
    {
      id: "focus",
      title: "Build · focused time",
      start: at(now, 0, 13),
      end: at(now, 0, 14, 30),
      calendar: "personal",
    },
    {
      id: "review",
      title: "Project sync",
      start: at(now, 0, 16),
      end: at(now, 0, 16, 30),
      calendar: "work",
      location: "Teams",
    },
    {
      id: "run",
      title: "Evening run",
      start: at(now, 0, 18),
      end: at(now, 0, 18, 45),
      calendar: "personal",
    },
    {
      id: "tomorrow",
      title: "Product review",
      start: at(now, 1, 10),
      end: at(now, 1, 11),
      calendar: "work",
      location: "Teams",
    },
    {
      id: "coffee",
      title: "Coffee with Alex",
      start: at(now, 1, 12, 30),
      end: at(now, 1, 13, 30),
      calendar: "personal",
    },
    {
      id: "weekend",
      title: "Trail run",
      start: at(now, 3, 8),
      end: at(now, 3, 9),
      calendar: "personal",
    },
  ],
}));
export const mockReminders = mock<ReminderState>("Demo reminders", (now) => ({
  items: [
    {
      id: "groceries",
      title: "Pick up groceries",
      due: at(now, 0, 21),
      completed: false,
      listName: "Reminders",
    },
    {
      id: "insurance",
      title: "Review insurance renewal",
      due: at(now, -1, 17),
      completed: false,
      listName: "Reminders",
    },
    {
      id: "internet-bill",
      title: "Internet bill",
      due: at(now, 3, 9),
      completed: false,
      listName: "Payments",
    },
    {
      id: "credit-card",
      title: "Credit card payment",
      due: at(now, 8, 9),
      completed: false,
      listName: "Payments",
    },
  ],
}));
export const mockHabits = mock<HabitState>("Demo habits", (now) => {
  const weekDates = habitWeekDates(now, config.display.timezone);
  const makeHabit = (id: string, title: string, completed: boolean[]) => ({
    id,
    title,
    trackingMethod: "reminder" as const,
    sourceId: id,
    occurrences: completed.map((done, index) => {
      const date = weekDates[index];
      return {
        date,
        completed: done,
        completedAt: done
          ? zonedDateTime(date, 20, 0, config.display.timezone).toISOString()
          : null,
      };
    }),
  });
  return {
    date: localDateKey(now, config.display.timezone),
    habits: [
      makeHabit("vitamins", "Vitamins", [
        true,
        true,
        true,
        true,
        true,
        true,
        false,
      ]),
      makeHabit("read", "Read 30 minutes", [
        true,
        true,
        false,
        true,
        true,
        true,
        false,
      ]),
      makeHabit("exercise", "Exercise", [
        true,
        false,
        true,
        false,
        true,
        false,
        false,
      ]),
    ],
  };
});
export const mockFinance = mock<FinanceState>("Local demo finance", (now) => {
  const weekday = new Date(
    `${localDateKey(now, config.display.timezone)}T12:00:00Z`,
  ).getUTCDay();
  return {
    ...config.finance,
    payday: at(now, (config.finance.paydayDayOfWeek - weekday + 7) % 7, 9),
    bills: [{ title: "Internet", amount: 65, due: at(now, 5, 9) }],
  };
});
export const mockHealth = mock<HealthState>("Demo Apple Health", () => ({
  steps: 8421,
  stepGoal: 10000,
  sleepMinutes: 452,
  activityPercent: 73,
  exerciseMinutes: 38,
  exerciseGoal: 30,
  standHours: 10,
  standGoal: 12,
  workout: "Outdoor run · 32 min",
}));
export const mockBuild = mock<BuildState>("Demo GitHub", (now) => ({
  username: "demo",
  commitsToday: 12,
  activeRepos: 3,
  openPRs: 1,
  lastActivity: new Date(now.getTime() - 8 * 60000).toISOString(),
  repositories: [
    { name: "lifedash", commits: 7 },
    { name: "homelab", commits: 3 },
    { name: "personal-site", commits: 2 },
  ],
}));
export const mockAI = mock<AITelemetryState>("Demo AI telemetry", (now) => ({
  providers: [
    {
      name: "Codex 5h",
      status: "idle",
      remainingPercent: 64,
      resetAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      requestsToday: 86,
      tokensToday: 1800000,
      costToday: null,
      jobsCompleted: 24,
      errors: 0,
    },
    {
      name: "Codex weekly",
      status: "idle",
      remainingPercent: 91,
      resetAt: new Date(now.getTime() + 6 * 86400000).toISOString(),
      requestsToday: null,
      tokensToday: null,
      costToday: null,
      jobsCompleted: null,
      errors: null,
    },
    {
      name: "Codex resets",
      status: "idle",
      remainingPercent: null,
      value: "2 available",
      availableCount: 2,
      expiresAt: new Date(now.getTime() + 18 * 86400000).toISOString(),
      requestsToday: null,
      tokensToday: null,
      costToday: null,
      jobsCompleted: null,
      errors: null,
    },
    {
      name: "Cursor monthly",
      status: "idle",
      remainingPercent: 82,
      requestsToday: 32,
      tokensToday: 1000000,
      costToday: null,
      jobsCompleted: 13,
      errors: 0,
    },
    {
      name: "Grok Bot weekly",
      status: "idle",
      remainingPercent: 73,
      requestsToday: null,
      tokensToday: null,
      costToday: null,
      jobsCompleted: null,
      errors: null,
    },
  ],
}));
export const mockSystems = mock<SystemState>("Demo infrastructure", () => ({
  machine: {
    id: "machine",
    name: "Mac",
    status: "online",
    latencyMs: null,
    uptimeSeconds: 345600,
    cpuPercent: 14,
    memoryPercent: 42,
    diskPercent: 38,
  },
  endpoints: [
    {
      id: "internet",
      name: "Internet / API",
      status: "online",
      latencyMs: 14,
      uptimeSeconds: null,
      cpuPercent: null,
      memoryPercent: null,
      diskPercent: null,
    },
    {
      id: "vps",
      name: "VPS",
      status: "online",
      latencyMs: 24,
      uptimeSeconds: 2678400,
      cpuPercent: 8,
      memoryPercent: 32,
      diskPercent: 61,
    },
  ],
}));
export const mockGoals = mock<GoalState>("Local demo goals", () => ({
  goals: config.goals,
  projects: config.projects,
}));
