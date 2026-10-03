import {
  Activity,
  Code2,
  Server,
  type LucideIcon,
} from "lucide-react";

export type ColumnLayout = {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  className: string;
  widgetIds: string[];
};

export const HEADER_WIDGET_IDS = ["clock", "weather"] as const;

export const COLUMNS: ColumnLayout[] = [
  {
    id: "personal",
    title: "Personal",
    subtitle: "Calendar · habits · payments · goals",
    icon: Activity,
    className: "personal-column",
    widgetIds: [
      "schedule-personal",
      "habits",
      "payments",
      "goals",
    ],
  },
  {
    id: "work",
    title: "Work & Build",
    subtitle: "Schedule · projects · GitHub",
    icon: Code2,
    className: "work-column",
    widgetIds: ["schedule-work", "projects", "build"],
  },
  {
    id: "digital",
    title: "Digital",
    subtitle: "Mac · network · AI",
    icon: Server,
    className: "digital-column",
    widgetIds: ["systems", "ai"],
  },
];
