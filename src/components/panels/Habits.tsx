import type { DashboardData } from "@/domains/models";
import { DomainSection } from "@/components/shared/DomainSection";

export function Habits({
  data,
  now,
}: {
  data: DashboardData;
  now: Date;
}) {
  const habits = data.habits.data?.habits ?? [];
  return (
    <DomainSection label="Habits" source={data.habits} now={now}>
      <div className="domain-habits">
        {data.habits.data === null ? (
          <div className="domain-empty">No data</div>
        ) : (
          habits.length ? habits.map((habit, index) => (
            <div className="domain-list-row" key={habit.id || `${habit.title}-${index}`}>
              <span>{habit.title}</span>
            </div>
          )) : <div className="domain-empty">No habits in the Habits list</div>
        )}
      </div>
    </DomainSection>
  );
}
