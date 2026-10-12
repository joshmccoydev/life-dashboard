import type { DashboardData, DisplayConfig, Mode } from "@/domains/models";
import { todayView } from "@/lib/today";
import { DomainSection } from "@/components/shared/DomainSection";
import {
  personalCalendarLabel,
  time,
  weekday,
  workCalendarLabel,
  workCalendarTone,
} from "@/components/shared/format";

export function Schedule({
  kind,
  data,
  now,
  display,
  mode,
}: {
  kind: "personal" | "work";
  data: DashboardData;
  now: Date;
  display: DisplayConfig;
  mode: Mode;
}) {
  const events = (data.calendar.data?.events ?? []).filter(
    (event) => event.calendar === kind,
  );
  const view = todayView(
    events,
    [],
    now,
    display.timezone,
    mode,
    0,
    display.modes.morning,
  );
  const next = view.next;
  const upcoming = events
    .filter((event) => !event.allDay && Date.parse(event.end) > now.getTime())
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const later = upcoming.filter((event) => event !== next);
  return (
    <DomainSection
      label={kind === "personal" ? "Personal calendar" : "Work schedule"}
      source={data.calendar}
      now={now}
      className="domain-schedule"
    >
      {data.calendar.data === null ? (
        <div className="domain-empty">No data</div>
      ) : (
        <>
          <div
            className={`domain-next-event ${kind === "work" ? "work-next-event" : ""}`}
          >
            <strong>
              {next ? <small>{weekday(next.start, display)}</small> : null}
              {next ? time(next.start, display) : "All clear"}
            </strong>
            <div>
              <h4>
                {kind === "work" && next?.calendarName
                  ? workCalendarLabel(next.calendarName)
                  : next?.title || "Nothing scheduled"}
              </h4>
              <span>
                {kind === "work" && next
                  ? `${next.title}${next.location ? ` · ${next.location}` : ""}`
                  : next?.calendarName || next?.location || `${kind} calendar`}
              </span>
            </div>
          </div>
          {later.length ? (
            <div className="domain-event-list">
              {later.slice(0, kind === "work" ? 4 : 3).map((event) => (
                <div
                  className="domain-list-row"
                  key={`${event.id}-${event.start}`}
                >
                  <span className="work-event-name">
                    <i
                      className={`work-calendar ${kind === "personal" ? "personal-calendar" : workCalendarTone(event.calendarName)}`}
                    >
                      {kind === "work"
                        ? workCalendarLabel(event.calendarName)
                        : personalCalendarLabel(event.calendarName)}
                    </i>
                    {event.title}
                  </span>
                  <strong>
                    {weekday(event.start, display)} · {time(event.start, display)}
                  </strong>
                </div>
              ))}
            </div>
          ) : !upcoming.length ? (
            <div className="domain-empty">
              No {kind === "work" ? "work" : "personal"} events ahead
            </div>
          ) : null}
        </>
      )}
    </DomainSection>
  );
}
