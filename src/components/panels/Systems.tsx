import type { DashboardData } from "@/domains/models";
import { DomainSection } from "@/components/shared/DomainSection";
import { Progress } from "@/components/shared/Progress";
import { usageTone } from "@/components/shared/format";
import { useSystemHistory } from "@/components/shared/client-state";
import type { SystemSample } from "@/lib/use-dashboard-data";

export function SystemSparkline({
  values,
  tone,
}: {
  values: (number | null)[];
  tone: string;
}) {
  const readings = values.filter((value): value is number => value !== null);
  const chart = readings.length === 1 ? [readings[0], readings[0]] : readings;
  const points = chart
    .map(
      (value, index) =>
        `${(index / Math.max(1, chart.length - 1)) * 100},${22 - (value / 100) * 20}`,
    )
    .join(" ");
  return (
    <svg
      className={`system-sparkline ${tone}`}
      viewBox="0 0 100 24"
      aria-hidden="true"
    >
      <line x1="0" y1="22" x2="100" y2="22" />
      {points ? <polyline points={points} /> : null}
    </svg>
  );
}

export function Systems({ data, now }: { data: DashboardData; now: Date }) {
  const systems = data.systems.data;
  const history: SystemSample[] = useSystemHistory();
  if (!systems)
    return (
      <DomainSection
        label="Systems & network"
        source={data.systems}
        now={now}
        className="domain-grow"
      >
        <div className="domain-empty">No data</div>
      </DomainSection>
    );
  const metrics = [
    ["CPU", systems.machine.cpuPercent, history.map((sample) => sample.cpu)],
    [
      "RAM",
      systems.machine.memoryPercent,
      history.map((sample) => sample.memory),
    ],
    ["DISK", systems.machine.diskPercent, history.map((sample) => sample.disk)],
  ] as const;
  return (
    <DomainSection
      label={`${systems.machine.name} & network`}
      source={data.systems}
      now={now}
      className="domain-grow"
    >
      <div className="domain-status-list">
        {[systems.machine, ...systems.endpoints].slice(0, 3).map((system) => (
          <div className="domain-status-row" key={system.id}>
            <i className={`status-dot ${system.status}`} />
            <span>{system.name}</span>
            <strong>
              {system.latencyMs !== null
                ? `${system.latencyMs} ms`
                : system.uptimeSeconds !== null
                  ? `${Math.floor(system.uptimeSeconds / 86400)}d uptime`
                  : system.status}
            </strong>
          </div>
        ))}
      </div>
      <div className="domain-metrics three system-metrics">
        {metrics.map(([label, value, values]) => (
          <div key={label}>
            <strong className={usageTone(value)}>
              {value ?? "—"}
              {value !== null ? "%" : ""}
            </strong>
            <span>{label}</span>
            <Progress value={value || 0} className={usageTone(value)} />
            <SystemSparkline values={values} tone={usageTone(value)} />
          </div>
        ))}
      </div>
    </DomainSection>
  );
}
