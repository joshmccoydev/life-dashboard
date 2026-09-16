import type { CalendarEvent, ReminderState, Mode } from "@/domains/models";
import { localDateKey, localHour, dayKeyOffset } from "./time";
export function todayView(
  events: CalendarEvent[],
  reminders: ReminderState["items"],
  now: Date,
  timezone: string,
  mode: Mode,
  rotation: number,
  morningStart = 6,
) {
  const today = localDateKey(now, timezone);
  const timed = events
    .filter((e) => !e.allDay)
    .sort(
      (a, b) =>
        Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id),
    );
  const remaining = timed.filter(
    (e) =>
      localDateKey(new Date(e.start), timezone) === today &&
      Date.parse(e.end) > now.getTime(),
  );
  const preview =
    mode === "night" || (mode === "evening" && remaining.length === 0);
  const previewTomorrow =
    preview && !(mode === "night" && localHour(now, timezone) < morningStart);
  const agendaDate = previewTomorrow ? dayKeyOffset(now, 1, timezone) : today;
  const agenda = preview
    ? timed.filter(
        (e) =>
          localDateKey(new Date(e.start), timezone) === agendaDate &&
          Date.parse(e.end) > now.getTime(),
      )
    : remaining;
  const next = preview
    ? agenda[0]
    : timed.find((e) => Date.parse(e.end) > now.getTime());
  const allDay = events.filter(
    (e) =>
      e.allDay &&
      localDateKey(new Date(e.start), timezone) <= agendaDate &&
      localDateKey(new Date(Date.parse(e.end) - 1), timezone) >= agendaDate,
  );
  const items = reminders
    .filter((r) => !r.completed)
    .sort(
      (a, b) =>
        (a.due ? Date.parse(a.due) : Infinity) -
          (b.due ? Date.parse(b.due) : Infinity) || a.id.localeCompare(b.id),
    );
  const pages = Math.max(1, Math.ceil(items.length / 2));
  const page = rotation % pages;
  return {
    next,
    remaining,
    agenda,
    previewTomorrow,
    allDay,
    work: agenda.filter((e) => e.calendar === "work").length,
    personal: agenda.filter((e) => e.calendar !== "work").length,
    reminders: items.slice(page * 2, page * 2 + 2),
    totalReminders: items.length,
    page,
    pages,
  };
}
