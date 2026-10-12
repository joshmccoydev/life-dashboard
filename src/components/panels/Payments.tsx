import type { DashboardData, DisplayConfig } from "@/domains/models";
import { upcomingPayments } from "@/lib/payments";
import { DomainSection } from "@/components/shared/DomainSection";

export function Payments({
  data,
  now,
  display,
}: {
  data: DashboardData;
  now: Date;
  display: DisplayConfig;
}) {
  const payments = upcomingPayments(
    data.reminders.data?.items ?? [],
    now,
    display.timezone,
  );
  const date = (value: string) =>
    new Intl.DateTimeFormat(display.locale, {
      timeZone: display.timezone,
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  return (
    <DomainSection
      label="Upcoming payments"
      source={data.reminders}
      now={now}
      className="domain-payments"
    >
      {data.reminders.data === null ? (
        <div className="domain-empty">No data</div>
      ) : (
        <>
          {payments.slice(0, 2).map((payment) => (
            <div className="domain-list-row" key={payment.id}>
              <span>{payment.title}</span>
              <strong>{date(payment.due!)}</strong>
            </div>
          ))}
          {!payments.length ? (
            <div className="domain-empty">No upcoming payments</div>
          ) : null}
        </>
      )}
    </DomainSection>
  );
}
