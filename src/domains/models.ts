export type SourceMode = "real" | "mock";
export type DataState<T> = {
  loading: boolean;
  data: T;
  source: SourceMode;
  provider: string;
  status: "ready" | "stale" | "error";
  lastSuccess: string | null;
  lastAttempt: string;
  error: string | null;
  refreshMs: number;
};
export type WeatherState = {
  temperature: number;
  feelsLike: number;
  condition: string;
  code: number;
  unit: "F" | "C";
  high: number;
  low: number;
  location: string;
  isDay: boolean;
};
export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  calendar: "personal" | "work";
  allDay?: boolean;
  calendarName?: string;
  calendarId?: string;
  location?: string;
};
export type CalendarState = { events: CalendarEvent[] };
export type ReminderState = {
  items: {
    id: string;
    title: string;
    due: string | null;
    completed: boolean;
    listName?: string;
  }[];
};
export type FinanceState = {
  checking: number;
  savings: number;
  emergencyFund: number;
  emergencyTarget: number;
  payday: string;
  spending: number;
  spendingBudget: number;
  investments: number;
  investmentChange: number;
  bills: { title: string; amount: number; due: string }[];
};
export type HealthState = {
  date?: string;
  importedAt?: string;
  syncedAt?: string;
  activeEnergy?: number | null;
  sampledAt?: string;
  stepSource?: string;
  steps: number | null;
  stepGoal: number | null;
  sleepMinutes: number | null;
  activityPercent: number | null;
  exerciseMinutes: number | null;
  exerciseGoal: number | null;
  standHours: number | null;
  standGoal: number | null;
  workout: string | null;
};
export type BuildState = {
  scope?: "public" | "authenticated";
  username: string;
  commitsToday: number;
  activeRepos: number;
  openPRs: number;
  lastActivity: string | null;
  repositories: { name: string; commits: number }[];
};
export type AIProvider = {
  name: string;
  status: "running" | "idle" | "offline" | "unknown";
  remainingPercent: number | null;
  value?: string;
  availableCount?: number;
  resetAt?: string;
  expiresAt?: string;
  detail?: string;
  requestsToday: number | null;
  tokensToday: number | null;
  costToday: number | null;
  jobsCompleted: number | null;
  errors: number | null;
};
export type AITelemetryState = { providers: AIProvider[] };
export type SystemMetric = {
  id: string;
  name: string;
  status: "online" | "offline" | "unknown";
  latencyMs: number | null;
  uptimeSeconds: number | null;
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
  detail?: string;
};
export type SystemState = { machine: SystemMetric; endpoints: SystemMetric[] };
export type GoalState = {
  goals: { title: string; current: number; target: number; unit: string }[];
  projects: { name: string; detail: string; progress: number }[];
};
export type HabitState = {
  habits: {
    id: string;
    title: string;
    trackingMethod: "reminder" | "health" | "github" | "custom";
    sourceId?: string;
    occurrences: {
      date: string;
      completed: boolean;
      completedAt: string | null;
    }[];
  }[];
  date: string;
};
export type HomeState = {
  sensors: { name: string; value: number | string; unit: string }[];
};
export type DashboardData = {
  weather: DataState<WeatherState>;
  calendar: DataState<CalendarState>;
  reminders: DataState<ReminderState>;
  finance: DataState<FinanceState>;
  health: DataState<HealthState>;
  build: DataState<BuildState>;
  ai: DataState<AITelemetryState>;
  systems: DataState<SystemState>;
  habits: DataState<HabitState>;
  goals: DataState<GoalState>;
};
export type Domain = keyof DashboardData;
export type Mode = "morning" | "day" | "evening" | "night";
export type DisplayConfig = {
  timezone: string;
  locale: string;
  currency: string;
  rotationSeconds: number;
  pixelShift: boolean;
  modes: { morning: number; day: number; evening: number; night: number };
};
export type Adapter<T> = {
  provider: string;
  source: SourceMode;
  observedAt?: (data: T) => string | null;
  fetch: (now: Date) => Promise<T>;
};
