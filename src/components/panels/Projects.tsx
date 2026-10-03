import type { DashboardData } from "@/domains/models";
import { DomainSection } from "@/components/shared/DomainSection";
import { Progress } from "@/components/shared/Progress";
import { goalDue } from "@/components/shared/format";

export function Projects({ data, now }: { data: DashboardData; now: Date }) {
  const projects = data.goals.data?.projects;
  if (!projects)
    return (
      <DomainSection
        label="Projects"
        source={data.goals}
        now={now}
        className="domain-projects"
      >
        <div className="domain-empty">No data</div>
      </DomainSection>
    );
  return (
    <DomainSection
      label="Projects"
      source={data.goals}
      now={now}
      className="domain-projects"
    >
      <div className="domain-project-list">
        {projects.slice(0, 4).map((project) => (
          <article className="domain-project" key={project.id || project.name}>
            <div className="domain-list-row">
              <span>{project.name}</span>
              <strong>
                {project.progress !== undefined
                  ? `${project.progress}%`
                  : project.due
                    ? `DUE ${goalDue(project.due)}`
                    : "ACTIVE"}
              </strong>
            </div>
            {project.progress !== undefined ? (
              <Progress value={project.progress} />
            ) : null}
            <p>{project.detail}</p>
          </article>
        ))}
        {!projects.length ? (
          <div className="domain-empty">No active projects</div>
        ) : null}
      </div>
    </DomainSection>
  );
}
