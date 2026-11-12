import type { DashboardData } from "@/domains/models";
import { DomainSection } from "@/components/shared/DomainSection";

export function Goals({ data, now }: { data: DashboardData; now: Date }) {
  const goals = data.goals.data;
  if (!goals)
    return (
      <DomainSection label="Goals" source={data.goals} now={now}>
        <div className="domain-empty">No data</div>
      </DomainSection>
    );
  return (
    <DomainSection label="Goals" source={data.goals} now={now}>
      <div className="domain-progress-list">
        {goals.goals.map((goal, index) => (
          <div className="domain-list-row" key={goal.id || `${goal.title}-${index}`}>
            <span>{goal.title}</span>
          </div>
        ))}
        {!goals.goals.length ? (
          <div className="domain-empty">No active goals</div>
        ) : null}
      </div>
    </DomainSection>
  );
}
