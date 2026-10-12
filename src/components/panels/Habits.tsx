import type { DashboardData, DisplayConfig } from "@/domains/models";
import { habitWeek } from "@/lib/habits";
import { DomainSection } from "@/components/shared/DomainSection";

export function Habits({
  data,
  now,
  display,
}: {
  data: DashboardData;
  now: Date;
  display: DisplayConfig;
}) {
  const habits = (data.habits.data?.habits ?? []).map((habit) => ({
    habit,
    week: habitWeek(habit, now, display.timezone),
  }));
  const today = habits.filter(({ week }) => week.today);
  return (
    <DomainSection label="Habits · this week" source={data.habits} now={now}>
      <div className="domain-habits">
        {data.habits.data === null ? (
          <div className="domain-empty">No data</div>
        ) : (
          <>
            {habits.length ? (
              <div className="domain-habit-days" aria-hidden="true">
                <span />
                <div>
                  {Array.from("MTWTFSS", (day, index) => (
                    <i key={`${day}-${index}`}>{day}</i>
                  ))}
                </div>
                <span />
              </div>
            ) : null}
            {habits.slice(0, 4).map(({ habit, week }) => (
              <div className="domain-habit-row" key={habit.id}>
                <span>{habit.title}</span>
                <div
                  className="habit-week"
                  aria-label={`${habit.title}: ${week.completed} of ${week.scheduled}`}
                >
                  {week.days.map(({ date, occurrence }) => (
                    <i
                      key={date}
                      className={
                        occurrence
                          ? occurrence.completed
                            ? "done"
                            : "missed"
                          : "unscheduled"
                      }
                    />
                  ))}
                </div>
                <strong>
                  {week.completed}/{week.scheduled}
                </strong>
              </div>
            ))}
            {!habits.length ? (
              <div className="domain-empty">No habits in the Habits list</div>
            ) : (
              <div className="domain-section-summary">
                {today.length
                  ? `Today · ${today.filter(({ week }) => week.today?.completed).length} of ${today.length} scheduled complete`
                  : "No habits scheduled today"}
              </div>
            )}
          </>
        )}
      </div>
    </DomainSection>
  );
}
