import { Terminal } from "lucide-react";
import type { DashboardData } from "@/domains/models";
import { ageLabel } from "@/lib/time";
import { DomainSection } from "@/components/shared/DomainSection";

export function Build({ data, now }: { data: DashboardData; now: Date }) {
  const build = data.build.data;
  if (!build)
    return (
      <DomainSection
        label="GitHub today"
        source={data.build}
        now={now}
        className="domain-grow"
      >
        <div className="domain-empty">No data</div>
      </DomainSection>
    );
  return (
    <DomainSection
      label="GitHub today"
      source={data.build}
      now={now}
      className="domain-grow"
    >
      <div className="domain-metrics three">
        <div>
          <strong>{build.commitsToday}</strong>
          <span>{build.scope === "public" ? "public commits" : "commits"}</span>
        </div>
        <div>
          <strong>{build.activeRepos}</strong>
          <span>active repos</span>
        </div>
        <div>
          <strong>{build.openPRs}</strong>
          <span>open PRs</span>
        </div>
      </div>
      <div className="domain-feature-row">
        <Terminal />
        <span>{build.repositories[0]?.name || build.username}</span>
        <strong>
          {build.lastActivity
            ? ageLabel(build.lastActivity, now)
            : "No recent activity"}
        </strong>
      </div>
    </DomainSection>
  );
}
