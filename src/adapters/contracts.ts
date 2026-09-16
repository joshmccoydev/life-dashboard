import type {
  Adapter,
  CalendarState,
  ReminderState,
  HealthState,
  HabitState,
  GoalState,
  SystemMetric,
  HomeState,
  FinanceState,
  AITelemetryState,
} from "@/domains/models";
// Versioned bridge and future provider boundaries.
export type AppleBridgeSnapshot = {
  version: 1;
  capturedAt: string;
  permissions: { calendar: boolean; reminders: boolean };
  calendar?: CalendarState;
  reminders?: ReminderState;
  machine?: SystemMetric;
  health?: HealthState;
};
export type MicrosoftWorkSnapshot = {
  capturedAt: string;
  calendar: CalendarState;
  workday: { start: string; end: string } | null;
};
export type CalendarAdapter = Adapter<CalendarState>;
export type ReminderAdapter = Adapter<ReminderState>;
export type AppleHealthAdapter = Adapter<HealthState>;
export type HabitAdapter = Adapter<HabitState>;
export type GoalAdapter = Adapter<GoalState>;
export type FinanceAdapter = Adapter<FinanceState>;
export type AITelemetryAdapter = Adapter<AITelemetryState>;
export type HomeAssistantAdapter = Adapter<HomeState>;
