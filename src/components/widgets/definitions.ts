import type { WidgetDefinition, WidgetProps } from "./contract";
import type { ComponentType } from "react";
import { Schedule } from "@/components/panels/Schedule";
import { Habits } from "@/components/panels/Habits";
import { Payments } from "@/components/panels/Payments";
import { Goals } from "@/components/panels/Goals";
import { Projects } from "@/components/panels/Projects";
import { Build } from "@/components/panels/Build";
import { Systems } from "@/components/panels/Systems";
import { AI } from "@/components/panels/AI";

function withSchedule(kind: "personal" | "work"): ComponentType<WidgetProps> {
  function Bound({ data, now, display, mode }: WidgetProps) {
    return Schedule({ kind, data, now, display, mode });
  }
  Bound.displayName = `Schedule(${kind})`;
  return Bound;
}

export const WIDGETS: Record<string, WidgetDefinition> = {
  "schedule-personal": {
    id: "schedule-personal",
    domain: "calendar",
    title: "Personal calendar",
    Component: withSchedule("personal"),
  },
  "schedule-work": {
    id: "schedule-work",
    domain: "calendar",
    title: "Work schedule",
    Component: withSchedule("work"),
  },
  habits: {
    id: "habits",
    domain: "habits",
    title: "Habits",
    Component: Habits,
  },
  payments: {
    id: "payments",
    domain: "reminders",
    title: "Upcoming payments",
    Component: Payments,
  },
  goals: {
    id: "goals",
    domain: "goals",
    title: "Goals",
    Component: Goals,
  },
  projects: {
    id: "projects",
    domain: "goals",
    title: "Projects",
    Component: Projects,
  },
  build: {
    id: "build",
    domain: "build",
    title: "GitHub today",
    Component: Build,
  },
  systems: {
    id: "systems",
    domain: "systems",
    title: "Systems & network",
    Component: Systems,
  },
  ai: {
    id: "ai",
    domain: "ai",
    title: "AI telemetry",
    Component: AI,
  },
};
