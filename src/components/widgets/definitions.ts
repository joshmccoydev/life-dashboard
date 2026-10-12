import type { WidgetDefinition, WidgetProps } from "./contract";
import { createElement, type ComponentType } from "react";
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
    // Render Schedule as an element (not a plain call) so its hooks, if any,
    // mount in Schedule's own component slot.
    return createElement(Schedule, { kind, data, now, display, mode });
  }
  Bound.displayName = `Schedule(${kind})`;
  return Bound;
}

export const WIDGETS: Record<string, WidgetDefinition> = {
  "schedule-personal": {
    id: "schedule-personal",
    Component: withSchedule("personal"),
  },
  "schedule-work": {
    id: "schedule-work",
    Component: withSchedule("work"),
  },
  habits: {
    id: "habits",
    Component: Habits,
  },
  payments: {
    id: "payments",
    Component: Payments,
  },
  goals: {
    id: "goals",
    Component: Goals,
  },
  projects: {
    id: "projects",
    Component: Projects,
  },
  build: {
    id: "build",
    Component: Build,
  },
  systems: {
    id: "systems",
    Component: Systems,
  },
  ai: {
    id: "ai",
    Component: AI,
  },
};
