import type { DashboardData } from "@/domains/models";
import { DomainSection } from "@/components/shared/DomainSection";
import { remainingTone, resetTone } from "@/components/shared/format";

export function AI({ data, now }: { data: DashboardData; now: Date }) {
  const providers = data.ai.data?.providers ?? [];
  const until = (value: string | undefined, label: string) => {
    if (!value) return null;
    const minutes = Math.max(
      0,
      Math.ceil((Date.parse(value) - now.getTime()) / 60000),
    );
    const text =
      minutes >= 1440
        ? `${Math.floor(minutes / 1440)}d`
        : minutes >= 60
          ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
          : `${minutes}m`;
    return `${label} ${text}`;
  };
  return (
    <DomainSection label="AI telemetry" source={data.ai} now={now}>
      <div className="domain-provider-list">
        {providers.slice(0, 5).map((provider) => (
          <div
            className="domain-list-row"
            key={provider.name}
            title={provider.detail}
          >
            <span>{provider.name}</span>
            <div className="domain-provider-value">
              <strong
                className={
                  provider.availableCount !== undefined
                    ? resetTone(provider.availableCount)
                    : remainingTone(provider.remainingPercent)
                }
              >
                {provider.value ||
                  (provider.remainingPercent !== null
                    ? `${provider.remainingPercent}% left`
                    : provider.status.toUpperCase())}
              </strong>
              {provider.resetAt || provider.expiresAt ? (
                <small>
                  {provider.resetAt
                    ? until(provider.resetAt, "RESET")
                    : until(provider.expiresAt, "EXPIRES")}
                </small>
              ) : null}
            </div>
          </div>
        ))}
        {!providers.length ? <div className="domain-empty">No data</div> : null}
      </div>
    </DomainSection>
  );
}
