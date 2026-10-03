import type { DashboardData } from "@/domains/models";
import { DomainSection } from "@/components/shared/DomainSection";
import { goalDue } from "@/components/shared/format";

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
        {goals.goals.slice(0, 3).map((goal) => (
          <div key={goal.id || goal.title}>
            <div className="domain-list-row">
              <span>{goal.title}</span>
              <strong>
                {goal.current !== undefined && goal.target !== undefined
                  ? `${goal.current}/${goal.target} ${goal.unit || ""}`
                  : goalDue(goal.due) || "ACTIVE"}
              </strong>
            </div>
            {goal.current === undefined && goal.detail ? (
              <div className="domain-project-detail">{goal.detail}</div>
            ) : null}
          </div>
        ))}
        {!goals.goals.length ? (
          <div className="domain-empty">No active goals</div>
        ) : null}
      </div>
    </DomainSection>
  );
}
