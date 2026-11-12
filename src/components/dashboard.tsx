"use client";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  Gauge,
  CalendarDays,
  Check,
  Code2,
  DollarSign,
  Folder,
  HeartPulse,
  Network,
  Server,
  Target,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type {
  DashboardData,
  DataState,
  DisplayConfig,
  DecisionsHomeState,
  HealthState,
  Mode,
  UsageRow,
} from "@/domains/models";
import {
  ageLabel,
  asOfLabel,
  isStale,
  modeAt,
} from "@/lib/time";
import { stripPrivate } from "@/lib/privacy";
import { parseChicagoStamp } from "@/lib/bots-ledger";
import {
  OPEN_DECISIONS_HOME_LIMIT,
} from "@/lib/open-decisions";
import {
  usageCostLabel,
  usageResetLabel,
  usageTag,
} from "@/lib/usage";
import { usageTone } from "@/components/shared/format";
import { evaluateAlerts, attentionView } from "@/lib/alerts";
import { useDashboardData } from "@/lib/use-dashboard-data";
import { normalizeDashboardResponse } from "@/lib/dashboard-response";
import { Clock } from "@/components/shared/Clock";
import { PanelBoundary } from "@/components/shared/PanelBoundary";
import {
  SystemHistoryContext,
  clockAt,
  startClockTick,
} from "@/components/shared/client-state";
import { Weather } from "@/components/panels/Weather";
import { Feed } from "@/components/shared/feed";
import { Build } from "@/components/panels/Build";
import { Projects } from "@/components/panels/Projects";
import { Systems } from "@/components/panels/Systems";
import type { UseDashboardData } from "@/lib/use-dashboard-data";

export { normalizeDashboardResponse };

type ExtendedHealthState = HealthState & {
  week?: { steps?: number; goal?: number; activeDays?: number };
  streak?: { days?: number; label?: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLive(state: { source: string; data: unknown } | undefined): boolean {
  return Boolean(state && state.source !== "mock" && state.data !== null);
}

type MoneyBill = {
  name: string;
  due: string | null;
  amount: number | null;
};

type FinanceSummary = {
  cashOnHand: number | null;
  billsDueTotal: number | null;
  billsDueCount: number;
  depositTarget: number | null;
  status: "ok" | "alert" | "unknown";
  bills?: MoneyBill[];
};

function isFinanceSummary(data: unknown): data is FinanceSummary {
  return isRecord(data) && "cashOnHand" in data;
}

function moneyIsAlerting(summary: FinanceSummary | null | undefined): boolean {
  if (!summary) return false;
  if (summary.status === "alert") return true;
  return (
    summary.billsDueTotal != null &&
    summary.cashOnHand != null &&
    summary.billsDueTotal >= summary.cashOnHand
  );
}

function moneyLeftAfterBills(summary: FinanceSummary): number | null {
  if (summary.cashOnHand == null || summary.billsDueTotal == null) return null;
  return Math.round((summary.cashOnHand - summary.billsDueTotal) * 100) / 100;
}

function moneyAlertReason(
  summary: FinanceSummary,
  locale: string,
  currency: string,
): string | null {
  if (!moneyIsAlerting(summary)) return null;
  const left = moneyLeftAfterBills(summary);
  if (left === null) return "Money needs attention.";
  const abs = formatUsd(Math.abs(left), locale, currency);
  if (left < 0) return `Bills due exceed cash by ${abs}.`;
  if (left === 0) return "Bills due equal cash.";
  return `Cash covers bills by ${abs}.`;
}

function chicagoYmd(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function billIsPastDue(due: string | null, now: Date): boolean {
  if (!due || !due.trim()) return false;
  const raw = due.trim().toLowerCase();
  if (raw === "past due" || raw === "overdue") return true;
  if (raw === "unknown" || raw === "no date") return false;
  const ymd = due.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}` < chicagoYmd(now);
  return false;
}

function sortBills(bills: MoneyBill[], now: Date): MoneyBill[] {
  const rank = (bill: MoneyBill): [number, string] => {
    if (billIsPastDue(bill.due, now)) {
      const dated = (bill.due ?? "").match(/^\d{4}-\d{2}-\d{2}$/);
      return [0, dated ? (bill.due as string) : "0000-00-00"];
    }
    const dated = (bill.due ?? "").match(/^\d{4}-\d{2}-\d{2}$/);
    if (dated) return [1, bill.due as string];
    return [2, "9999-99-99"];
  };
  return [...bills].sort((left, right) => {
    const a = rank(left);
    const b = rank(right);
    return a[0] - b[0] || a[1].localeCompare(b[1]);
  });
}

function moneyAlertCount(data: DashboardData): number {
  const summary = isFinanceSummary(data.finance?.data)
    ? data.finance.data
    : null;
  return moneyIsAlerting(summary) ? 1 : 0;
}

function formatUsd(
  value: number,
  locale: string,
  currency: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatBillDue(due: string | null): string {
  if (!due || due.trim() === "") return "—";
  const raw = due.trim();
  const lower = raw.toLowerCase();
  if (lower === "unknown") return "No date";
  if (lower === "past due") return "Past due";
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const date = new Date(
      Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12),
    );
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(date);
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return raw;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  }).format(new Date(parsed));
}

function isLegacyFinance(data: unknown): boolean {
  return (
    isRecord(data) &&
    typeof data.checking === "number" &&
    !("cashOnHand" in data)
  );
}

function showMoney(data: DashboardData): boolean {
  return (
    isLive(data.finance) &&
    (isFinanceSummary(data.finance.data) || isLegacyFinance(data.finance.data))
  );
}

type HealthSummary = {
  trainingDoneToday?: "y" | "n" | null;
  streak?: number | null;
  nextSession?: string | null;
  lastWeighIn?: string | number | null;
};

function isHealthSummary(data: unknown): data is HealthSummary {
  return (
    isRecord(data) &&
    ("nextSession" in data ||
      "trainingDoneToday" in data ||
      "lastWeighIn" in data) &&
    !("steps" in data)
  );
}

function showHealth(data: DashboardData): boolean {
  if (!isLive(data.health)) return false;
  const health: unknown = data.health.data;
  if (isHealthSummary(health)) {
    return Boolean(
      health.nextSession ||
        health.trainingDoneToday === "y" ||
        health.trainingDoneToday === "n" ||
        (typeof health.streak === "number" && health.streak > 0) ||
        health.lastWeighIn != null,
    );
  }
  if (!isRecord(health)) return false;
  const streak = health.streak;
  return (
    typeof health.steps === "number" ||
    typeof health.exerciseMinutes === "number" ||
    Boolean(health.workout) ||
    (isRecord(streak) && typeof streak.days === "number")
  );
}

function showDecisions(data: DashboardData): boolean {
  const cards = data.decisions?.data?.cards;
  return Boolean(isLive(data.decisions) && Array.isArray(cards) && cards.length);
}


function DashboardCard({
  id,
  title,
  icon: Icon,
  source,
  now,
  children,
  className = "",
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  source: DataState<unknown>;
  now: Date;
  children: ReactNode;
  className?: string;
}) {
  const empty = source.data === null;
  const stale =
    !empty &&
    (source.status !== "ready" ||
      isStale(source.lastSuccess, now, source.refreshMs));

  return (
    <section
      className={`dashboard-card card ${className}`}
      aria-labelledby={`${id}-title`}
      role="region"
    >
      <header className="dashboard-panel-header">
        <div className="dashboard-panel-heading">
          <Icon aria-hidden="true" />
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
        <div className="dashboard-panel-meta">
          <span>Updated {ageLabel(source.lastSuccess, now)}</span>
          {source.lastSuccess ? (
            <span className="dashboard-as-of">
              {asOfLabel(source.lastSuccess)}
            </span>
          ) : null}
          {empty ? (
            <strong className="dashboard-panel-status">No data</strong>
          ) : stale ? (
            <span className="dash-tag stale">STALE</span>
          ) : null}
        </div>
      </header>
      <div className="dashboard-panel-body">{children}</div>
    </section>
  );
}


const BOTS_HOME_LIMIT = 15;

function chicagoParts(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
}

function part(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
) {
  return parts.find((entry) => entry.type === type)?.value ?? "";
}

function sameChicagoDay(left: Date, right: Date) {
  const a = chicagoParts(left);
  const b = chicagoParts(right);
  return (
    part(a, "year") === part(b, "year") &&
    part(a, "month") === part(b, "month") &&
    part(a, "day") === part(b, "day")
  );
}

function lastRunLabel(value: string | null | undefined, now: Date) {
  if (!value) return "—";
  const iso = parseChicagoStamp(value) ?? value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = chicagoParts(date);
  const time = `${part(parts, "hour")}:${part(parts, "minute")} ${part(parts, "dayPeriod")}`;
  if (sameChicagoDay(date, now)) return time;
  const days = Math.abs(now.getTime() - date.getTime()) / 86_400_000;
  if (days < 6) return `${part(parts, "weekday")} ${time}`;
  return `${part(parts, "month")} ${part(parts, "day")}`;
}

function botStatusBadge(provider: {
  status: string;
  detail?: string;
  value?: string;
}) {
  const waiting =
    provider.status === "waiting" ||
    provider.value?.toLowerCase() === "needs josh";
  if (waiting) return { label: "Needs Josh", kind: "ask" as const };
  if (provider.status === "blocked") {
    return { label: "Blocked", kind: "blocked" as const };
  }
  if (provider.status === "running") {
    return { label: "Working", kind: "working" as const };
  }
  return { label: "Idle", kind: "idle" as const };
}

function BotsPanel({ data, now }: { data: DashboardData; now: Date }) {
  const rank = (kind: string) =>
    ({ ask: 0, blocked: 1, working: 2, idle: 3 }[kind] ?? 4);
  const providers = [...(data.ai.data?.providers ?? [])].sort((left, right) => {
    return rank(botStatusBadge(left).kind) - rank(botStatusBadge(right).kind);
  });
  const visible = providers.slice(0, BOTS_HOME_LIMIT);
  const extra = providers.length - visible.length;

  return (
    <DashboardCard
      id="bots"
      title="Bots"
      icon={Bot}
      source={data.ai}
      now={now}
      className="dashboard-card-bots"
    >
      {data.ai.data === null ? (
        <div className="domain-empty">No bot status yet.</div>
      ) : visible.length ? (
        <>
          <ul className="dashboard-bots-grid">
            {visible.map((provider) => {
              const badge = botStatusBadge(provider);
              return (
                <li key={provider.name} className="dashboard-bot-cell">
                  <span className="name">{stripPrivate(provider.name)}</span>
                  <span className="run">
                    {lastRunLabel(provider.updatedAt, now)}
                  </span>
                  <span
                    className={`dashboard-bot-dot ${badge.kind}`}
                    title={badge.label}
                    aria-label={badge.label}
                    role="img"
                  />
                </li>
              );
            })}
          </ul>
          <ul className="dashboard-bots-legend" aria-label="Bot status">
            <li>
              <span className="dashboard-bot-dot working" aria-hidden="true" />
              working
            </li>
            <li>
              <span className="dashboard-bot-dot idle" aria-hidden="true" />
              idle
            </li>
            <li>
              <span className="dashboard-bot-dot blocked" aria-hidden="true" />
              blocked
            </li>
            <li>
              <span className="dashboard-bot-dot ask" aria-hidden="true" />
              needs Josh
            </li>
          </ul>
          {extra > 0 ? (
            <p className="dashboard-bots-more">
              {extra} more
            </p>
          ) : null}
        </>
      ) : (
        <div className="domain-empty">No bot status yet.</div>
      )}
    </DashboardCard>
  );
}

function MoneyPanel({
  data,
  display,
  now,
}: {
  data: DashboardData;
  display: DisplayConfig;
  now: Date;
}) {
  const finance: unknown = data.finance.data;
  const financeSummary = isFinanceSummary(finance) ? finance : null;
  const alerting = moneyIsAlerting(financeSummary);
  const reason = financeSummary
    ? moneyAlertReason(financeSummary, display.locale, display.currency)
    : null;
  const leftAfter = financeSummary ? moneyLeftAfterBills(financeSummary) : null;
  const bills: MoneyBill[] = financeSummary
    ? sortBills(financeSummary.bills ?? [], now)
    : [];
  const empty =
    finance === null ||
    (!financeSummary && !isLegacyFinance(finance));

  return (
    <DashboardCard
      id="money"
      title="Money"
      icon={DollarSign}
      source={data.finance}
      now={now}
      className={`dashboard-card-money${alerting ? " alert" : ""}`}
    >
      {empty || (!financeSummary && !isLegacyFinance(finance)) ? (
        <div className="domain-empty">No money data yet.</div>
      ) : financeSummary ? (
        <>
          <div className="dashboard-money-row">
            <div>
              <span>Cash on hand</span>
              <strong>
                {financeSummary.cashOnHand === null
                  ? "—"
                  : formatUsd(
                      financeSummary.cashOnHand,
                      display.locale,
                      display.currency,
                    )}
              </strong>
            </div>
            <div>
              <span>Bills due</span>
              <strong>
                {financeSummary.billsDueTotal === null
                  ? "—"
                  : formatUsd(
                      financeSummary.billsDueTotal,
                      display.locale,
                      display.currency,
                    )}
              </strong>
              <p>
                {financeSummary.billsDueCount}{" "}
                {financeSummary.billsDueCount === 1 ? "bill" : "bills"}
              </p>
            </div>
            {leftAfter !== null ? (
              <div>
                <span>Left after bills</span>
                <strong className={leftAfter < 0 ? "negative" : undefined}>
                  {formatUsd(leftAfter, display.locale, display.currency)}
                </strong>
              </div>
            ) : null}
          </div>
          {alerting && reason ? (
            <p className="alert-reason">{reason}</p>
          ) : null}
          {bills.length > 0 ? (
            <table className="dashboard-bills">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th className="due">Due</th>
                  <th className="amt">Amount</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill, index) => {
                  const pastDue = billIsPastDue(bill.due, now);
                  const dueLabel = formatBillDue(bill.due);
                  const noDate = dueLabel === "No date";
                  const noAmount = bill.amount === null;
                  return (
                    <tr
                      key={`${bill.name}-${bill.due ?? "none"}-${index}`}
                      className={pastDue ? "past-due" : undefined}
                    >
                      <td className="name">{bill.name}</td>
                      <td className={`due${noDate ? " muted" : ""}`}>
                        {pastDue ? (
                          <i className="due-dot" aria-hidden="true" />
                        ) : null}
                        {dueLabel}
                      </td>
                      <td className={`amt${noAmount ? " muted" : ""}`}>
                        {noAmount
                          ? "Amount ?"
                          : formatUsd(
                              bill.amount as number,
                              display.locale,
                              display.currency,
                            )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </>
      ) : (
        <div className="domain-empty">No money data yet.</div>
      )}
    </DashboardCard>
  );
}

function HealthPanel({
  data,
  display,
  now,
}: {
  data: DashboardData;
  display: DisplayConfig;
  now: Date;
}) {
  const raw = data.health.data;
  if (isHealthSummary(raw)) {
    return (
      <DashboardCard
        id="health"
        title="Health"
        icon={HeartPulse}
        source={data.health}
        now={now}
        className="dashboard-card-health"
      >
        <div className="dashboard-health-grid">
          {raw.nextSession ? (
            <div>
              <span>Next</span>
              <strong>{stripPrivate(raw.nextSession)}</strong>
            </div>
          ) : null}
          {raw.trainingDoneToday === "y" || raw.trainingDoneToday === "n" ? (
            <div>
              <span>Training today</span>
              <strong>{raw.trainingDoneToday === "y" ? "Done" : "Not yet"}</strong>
            </div>
          ) : null}
          {typeof raw.streak === "number" && raw.streak > 0 ? (
            <div>
              <span>Streak</span>
              <strong>
                {raw.streak} {raw.streak === 1 ? "day" : "days"}
              </strong>
            </div>
          ) : null}
          {raw.lastWeighIn != null ? (
            <div>
              <span>Last weigh-in</span>
              <strong>{stripPrivate(String(raw.lastWeighIn))}</strong>
            </div>
          ) : null}
        </div>
      </DashboardCard>
    );
  }

  const health = raw as ExtendedHealthState | null;
  const weekLabel = health?.week
    ? `${health.week.activeDays ?? 0} active days${
        health.week.steps !== undefined && health.week.goal
          ? ` · ${health.week.steps.toLocaleString(display.locale)}/${health.week.goal.toLocaleString(display.locale)} steps`
          : ""
      }`
    : undefined;
  const streakDays = health?.streak?.days;
  const streakLabel = health?.streak?.label || "Habit streak";

  return (
    <DashboardCard
      id="health"
      title="Health"
      icon={HeartPulse}
      source={data.health}
      now={now}
      className="dashboard-card-health"
    >
      {health === null ? (
        <div className="domain-empty">No data</div>
      ) : (
        <div className="dashboard-health-grid">
          {typeof health.steps === "number" ? (
            <div>
              <span>Today</span>
              <strong>
                {health.steps.toLocaleString(display.locale)} steps
              </strong>
              {typeof health.exerciseMinutes === "number" || health.workout ? (
                <p>
                  {typeof health.exerciseMinutes === "number"
                    ? `${health.exerciseMinutes} min exercise`
                    : ""}
                  {health.workout ? ` · ${health.workout}` : ""}
                </p>
              ) : null}
            </div>
          ) : null}
          {weekLabel ? (
            <div>
              <span>This week</span>
              <strong>{weekLabel}</strong>
            </div>
          ) : null}
          {typeof streakDays === "number" ? (
            <div>
              <span>Streak</span>
              <strong>
                {streakDays} {streakDays === 1 ? "day" : "days"}
              </strong>
              <p>{streakLabel}</p>
            </div>
          ) : null}
        </div>
      )}
    </DashboardCard>
  );
}

function DecisionsPanel({
  data,
  now,
}: {
  data: DashboardData;
  now: Date;
}) {
  const entry = data.decisions as
    | { data: DecisionsHomeState | null }
    | undefined;
  const payload = entry?.data;
  const cards = (payload?.cards ?? []).slice(0, OPEN_DECISIONS_HOME_LIMIT);
  const total = payload?.count ?? cards.length;
  const source = data.decisions!;

  return (
    <DashboardCard
      id="decisions"
      title="Decisions"
      icon={Bell}
      source={source}
      now={now}
      className="dashboard-card-decisions"
    >
      <p className="dashboard-decisions-count">
        {total} open {total === 1 ? "item" : "items"}
      </p>
      <div className="dashboard-decisions-list">
        {cards.map((card, index) => (
          <div
            className={`dashboard-decision-row${card.blocking ? " waiting highlight attention" : ""}`}
            key={card.id ?? `${card.bot}-${index}`}
          >
            <span className="dashboard-decision-bot">
              {stripPrivate(card.bot)}
            </span>
            <p className="dashboard-decision-q">
              {stripPrivate(card.question)}
            </p>
            {card.blocking ? (
              <span className="dashboard-decision-block">blocking</span>
            ) : null}
          </div>
        ))}
      </div>
      <a className="dashboard-decisions-link" href="/decisions">
        <span>
          {`See all ${total} open ${total === 1 ? "item" : "items"}`}
        </span>
        <ArrowRight aria-hidden="true" />
      </a>
    </DashboardCard>
  );
}


function UsagePanel({ data, now }: { data: DashboardData; now: Date }) {
  const source = data.usage;
  const providers = source?.data?.providers ?? [];
  if (!source) return null;

  const planLine = (row: UsageRow) => {
    const bits: string[] = [];
    if (row.plan) bits.push(row.plan);
    const cost = usageCostLabel(row.monthly_cost_usd);
    if (cost) bits.push(cost);
    const reset = usageResetLabel(row.resets_at, now);
    if (reset) bits.push(reset);
    return bits.join(" · ") || "—";
  };

  const asOfLine = (row: UsageRow) => {
    const asOf = row.as_of ? asOfLabel(row.as_of) : "—";
    if (!row.source) return asOf;
    return `${asOf} · ${row.source}`;
  };

  const pctLabel = (row: UsageRow) => {
    if (row.pct_used !== null) return `${row.pct_used}%`;
    const tag = usageTag(row);
    if (tag === "manual" || row.source === "manual") return "manual";
    return "—";
  };

  return (
    <DashboardCard
      id="usage"
      title="Usage"
      icon={Gauge}
      source={source}
      now={now}
      className="dashboard-card-usage"
    >
      {providers.length ? (
        <div className="dashboard-usage-grid">
          {providers.map((row) => {
            const tag = usageTag(row);
            const pct = row.pct_used;
            const high = pct !== null && pct >= 70;
            return (
              <article className="dashboard-usage-card" key={row.id}>
                <header>
                  <h3>{row.name}</h3>
                  {tag ? (
                    <span className={`dash-tag ${tag}`}>{tag}</span>
                  ) : null}
                </header>
                <div
                  className={`dashboard-usage-bar${high ? " high" : ""}`}
                  aria-hidden="true"
                >
                  <i
                    style={{
                      width: pct === null ? "0%" : `${Math.max(0, Math.min(100, pct))}%`,
                    }}
                  />
                </div>
                <div
                  className={`dashboard-usage-pct ${pct === null ? "empty" : usageTone(pct)}`}
                >
                  {pctLabel(row)}
                </div>
                <p className="dashboard-usage-plan">{planLine(row)}</p>
                <p className="dashboard-usage-asof">{asOfLine(row)}</p>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="domain-empty">
          No usage figures yet. Add a manual entry.
        </div>
      )}
    </DashboardCard>
  );
}

function SchedulePanel({
  data,
  display,
  now,
}: {
  data: DashboardData;
  display: DisplayConfig;
  now: Date;
}) {
  const events = data.calendar.data?.events ?? [];
  const format = (value: string) =>
    new Intl.DateTimeFormat(display.locale, {
      timeZone: display.timezone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  const group = (kind: "personal" | "work", label: string) => {
    const upcoming = events
      .filter(
        (event) =>
          event.calendar === kind &&
          !event.allDay &&
          Date.parse(event.end) > now.getTime(),
      )
      .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
    return (
      <div className="dashboard-schedule-group">
        <div className="domain-inline-label">
          <span>{label}</span>
          <Feed state={data.calendar} now={now} />
        </div>
        {data.calendar.data === null ? (
          <div className="domain-empty">No data</div>
        ) : upcoming.length ? (
          upcoming.slice(0, 3).map((event) => (
            <div className="domain-list-row" key={`${event.id}-${event.start}`}>
              <span>{event.title}</span>
              <strong>{format(event.start)}</strong>
            </div>
          ))
        ) : (
          <div className="domain-empty">No {kind} events ahead</div>
        )}
      </div>
    );
  };

  return (
    <DashboardCard
      id="schedule"
      title="Schedule"
      icon={CalendarDays}
      source={data.calendar}
      now={now}
      className="dashboard-card-schedule"
    >
      <div className="dashboard-schedule-grid">
        {group("personal", "Personal")}
        {group("work", "Work")}
      </div>
    </DashboardCard>
  );
}

function RemindersPanel({ data, now }: { data: DashboardData; now: Date }) {
  const today = chicagoYmd(now);
  const allReminders = data.reminders.data?.items ?? [];
  const groups = [
    { label: "Overdue", items: [] as typeof allReminders },
    { label: "Due", items: [] as typeof allReminders },
    { label: "No date", items: [] as typeof allReminders },
  ];
  for (const reminder of allReminders) {
    const due = reminder.due?.trim() ?? "";
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(due);
    const timestamp = due ? Date.parse(due) : NaN;
    const hasDue = Number.isFinite(timestamp) || /^(?:past due|overdue)$/i.test(due);
    const overdue = /^(?:past due|overdue)$/i.test(due) ||
      (dateOnly ? due < today : Number.isFinite(timestamp) && timestamp < now.getTime());
    const index = !hasDue ? 2 : overdue ? 0 : 1;
    groups[index]?.items.push(reminder);
  }

  return (
    <DashboardCard
      id="reminders"
      title="Reminders"
      icon={Bell}
      source={data.reminders}
      now={now}
      className="dashboard-card-reminders"
    >
      {data.reminders.data === null ? (
        <div className="domain-empty">No data</div>
      ) : groups.some((group) => group.items.length) ? (
        <div className="dashboard-reminder-list">
          {groups.map(({ label, items }) => items.length ? (
            <section className="dashboard-reminder-group" key={label} aria-label={label}>
              <h3>{label}</h3>
              {items.map((reminder) => (
                <div className="domain-list-row" key={reminder.id}>
                  <span>{reminder.title}</span>
                  {label === "No date" ? null : <strong>{formatBillDue(reminder.due)}</strong>}
                </div>
              ))}
            </section>
          ) : null)}
        </div>
      ) : (
        <div className="domain-empty">No reminders</div>
      )}
      <Feed state={data.reminders} now={now} />
    </DashboardCard>
  );
}

function DashboardStyles() {
  return (
    <style>{`
      .dashboard-topbar {
        position: sticky;
        z-index: 20;
        top: 0;
        padding: var(--space-3) var(--space-4);
        background: color-mix(in srgb, var(--color-canvas) 94%, transparent);
        backdrop-filter: blur(14px);
      }

      .dashboard-tabs {
        display: flex;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-4);
        border-bottom: var(--hairline);
      }

      .dashboard-tab {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: var(--space-2) var(--space-3);
        border: 1px solid transparent;
        border-radius: 0.4rem;
        background: transparent;
        color: var(--color-text-muted);
        cursor: pointer;
        font: inherit;
        font-size: var(--type-detail);
        font-weight: 600;
        text-decoration: none;
      }

      .dashboard-tab[aria-current="page"] {
        border-color: var(--comment);
        background: var(--color-surface-raised);
        color: var(--color-text);
      }

      .dashboard-home {
        grid-template-columns: 1fr;
        padding: var(--space-3) var(--space-4);
        align-items: start;
      }

      .dashboard-card {
        min-width: 0;
        overflow: hidden;
        border: var(--hairline);
        border-radius: var(--r);
        background: var(--color-surface);
      }

      .dashboard-panel-header,
      .dashboard-panel-heading,
      .dashboard-panel-meta {
        display: flex;
        align-items: center;
      }

      .dashboard-panel-header {
        justify-content: space-between;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: var(--space-3);
        padding: var(--space-3) var(--space-4);
        border-bottom: var(--hairline);
      }

      .dashboard-panel-heading {
        gap: var(--space-2);
        min-width: 0;
        flex: 0 0 auto;
      }

      .dashboard-panel-heading svg {
        width: 1.1rem;
        height: 1.1rem;
        color: var(--color-accent);
      }

      .dashboard-panel-heading h2 {
        color: var(--color-text);
        font-size: var(--type-tier-3);
        font-weight: 600;
        letter-spacing: 0;
        white-space: nowrap;
      }

      .dashboard-panel-meta {
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--space-1) var(--space-2);
        color: var(--color-text-muted);
        font-size: var(--type-micro);
      }

      .dashboard-panel-status {
        color: var(--color-state-caution);
        font-weight: 600;
        text-transform: uppercase;
      }

      .dashboard-panel-body {
        display: grid;
        gap: var(--space-3);
        padding: var(--space-3) var(--space-4);
      }

      .dashboard-panel-body > .domain-section {
        margin: calc(var(--space-3) * -1) calc(var(--space-4) * -1)
          calc(var(--space-3) * -1);
        border-top: var(--hairline);
      }

      .dashboard-bot-list,
      .dashboard-reminder-list,
      .dashboard-schedule-grid,
      .dashboard-health-grid,
      .dashboard-money-grid {
        display: grid;
        gap: var(--space-2);
      }

      .dashboard-bot-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--space-3);
        padding: var(--space-2);
        border: 1px solid var(--color-border);
        border-radius: 0.4rem;
      }

      .dashboard-bot-row.waiting {
        border-color: var(--color-state-caution);
        background: color-mix(
          in srgb,
          var(--color-state-caution) 10%,
          transparent
        );
      }

      .dashboard-bot-row div {
        min-width: 0;
      }

      .dashboard-bot-row p,
      .dashboard-money-grid p,
      .dashboard-health-grid p {
        margin-top: var(--space-1);
        color: var(--color-text-secondary);
        font-size: var(--type-detail);
      }

      .dashboard-bot-row > span,
      .dashboard-money-grid span,
      .dashboard-health-grid span {
        color: var(--color-text-muted);
        font-size: var(--type-micro);
        text-transform: uppercase;
      }

      .dashboard-money-grid,
      .dashboard-health-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .dashboard-money-grid > div,
      .dashboard-health-grid > div {
        min-width: 0;
        padding: var(--space-2);
        border: 1px solid var(--color-border);
        border-radius: 0.4rem;
      }

      .dashboard-money-grid strong,
      .dashboard-health-grid strong {
        display: block;
        margin-top: var(--space-1);
      }

      .metric-critical {
        color: var(--color-state-critical);
      }

      .dashboard-schedule-group {
        min-width: 0;
      }

      .dashboard-schedule-group + .dashboard-schedule-group {
        padding-top: var(--space-2);
        border-top: 1px solid var(--color-border);
      }

      .dashboard-panel-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.25rem 0.75rem;
        min-width: 0;
      }

      .dashboard-as-of {
        white-space: normal;
        overflow-wrap: anywhere;
      }

      .dashboard-decisions-count {
        margin: 0 0 var(--space-2);
        color: var(--color-text-secondary);
        font-size: var(--type-detail);
      }

      .dashboard-decisions-list {
        display: flex;
        flex-direction: column;
        gap: 0;
        min-width: 0;
      }

      .dashboard-decision-row {
        display: grid;
        grid-template-columns: 7.25rem minmax(0, 1fr);
        align-items: center;
        column-gap: 10px;
        min-width: 0;
        min-height: 44px;
        padding: 6px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }

      .dashboard-decision-row:last-child {
        border-bottom: 0;
      }

      .dashboard-decision-bot {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        align-self: center;
        justify-self: start;
        box-sizing: border-box;
        max-width: 100%;
        padding: 1px 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        color: var(--color-text-muted);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.04em;
        line-height: 18px;
        white-space: nowrap;
      }

      .dashboard-decision-q {
        margin: 0;
        min-width: 0;
        color: var(--color-text);
        font-size: 16px;
        font-weight: 500;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      .dashboard-decision-block {
        grid-column: 2;
        color: var(--color-state-critical);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .dashboard-decisions-link {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        margin-top: var(--space-3);
        padding: var(--space-3);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        color: inherit;
        text-decoration: none;
        min-height: 44px;
      }


      .dashboard-bots-table {
        width: 100%;
        border-collapse: collapse;
      }
      .dashboard-bots-table th {
        text-align: left;
        color: var(--color-text-muted);
        font-size: var(--type-micro, 12px);
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        padding: 0 8px 8px;
      }
      .dashboard-bots-table td {
        padding: 0 8px;
        height: 48px;
        border-top: 1px solid var(--color-border);
        font-size: 15px;
        vertical-align: middle;
      }
      .dashboard-bots-table td.name {
        font-weight: 600;
        white-space: nowrap;
      }
      .dashboard-bots-table td.run {
        color: var(--color-text-secondary);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .dashboard-bots-table td.status {
        width: 128px;
      }
      .dashboard-bots-table tbody tr:hover {
        background: var(--color-surface-raised);
      }
      .dashboard-bots-more {
        display: flex;
        align-items: center;
        min-height: 44px;
        margin: 8px 0 0;
        color: var(--color-accent);
        font-size: 15px;
        font-weight: 600;
      }
      .dashboard-bots-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        column-gap: 16px;
        row-gap: 0;
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .dashboard-bot-cell {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 8px;
        min-height: 28px;
        padding: 2px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 13px;
      }
      .dashboard-bot-cell .name {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dashboard-bot-cell .run {
        color: var(--color-text-secondary);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
        font-size: 12px;
      }
      .dashboard-bot-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .dashboard-bot-dot.ask { background: var(--color-state-critical); }
      .dashboard-bot-dot.working { background: var(--color-state-good); }
      .dashboard-bot-dot.idle { background: var(--color-text-muted); }
      .dashboard-bot-dot.blocked { background: var(--color-state-caution); }
      .dashboard-bots-legend {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 14px;
        list-style: none;
        margin: 8px 0 0;
        padding: 0;
        color: var(--color-text-muted);
        font-size: 11px;
        line-height: 1;
      }
      .dashboard-bots-legend li {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }

      .dash-tag {
        display: inline-flex;
        align-items: center;
        height: 20px;
        padding: 0 6px;
        border-radius: 4px;
        border: 1px solid var(--color-border-strong);
        color: var(--color-text-muted);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .dash-tag.manual {
        border-color: var(--color-text-muted);
      }
      .dash-tag.stale {
        border-color: var(--color-state-caution);
        color: var(--color-state-caution);
        background: rgba(224, 183, 118, 0.12);
      }
      .dash-tag.alert {
        border-color: var(--color-state-critical);
        color: var(--color-state-critical);
        background: rgba(223, 137, 132, 0.12);
      }
      .dash-tag.ok {
        border-color: var(--color-state-good);
        color: var(--color-state-good);
      }
      .dash-tag.idle,
      .dash-tag.paused {
        border-color: var(--color-border-strong);
      }

      .dashboard-usage-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }
      .dashboard-usage-card {
        background: var(--color-surface-raised);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        padding: 10px 12px;
        min-width: 0;
      }
      .dashboard-usage-card header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      .dashboard-usage-card h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
      }
      .dashboard-usage-bar {
        height: 8px;
        border-radius: 99px;
        background: var(--color-surface-emphasis);
        overflow: hidden;
      }
      .dashboard-usage-bar > i {
        display: block;
        height: 100%;
        background: var(--color-accent);
        border-radius: 99px;
      }
      .dashboard-usage-bar.high > i {
        background: var(--color-state-caution);
      }
      .dashboard-usage-pct {
        margin-top: 8px;
        font-size: 22px;
        font-weight: 600;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }
      .dashboard-usage-card p,
      .dashboard-usage-plan,
      .dashboard-usage-asof {
        margin: 4px 0 0;
        color: var(--color-text-muted);
        font-size: 12px;
        line-height: 1.35;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dashboard-usage-pct.empty {
        color: var(--color-text-muted);
        font-size: 16px;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: lowercase;
      }

      .dashboard-decision-q {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      a:focus-visible,
      button:focus-visible,
      .dashboard-tab:focus-visible,
      .dashboard-decisions-link:focus-visible,
      .alert-chip:focus-visible {
        outline: var(--focus-ring);
        outline-offset: 2px;
      }

      .dashboard-card {
        height: fit-content;
      }
      .dashboard-home {
        align-items: start;
      }
      .dashboard-card-money.alert {
        border-color: var(--color-state-critical);
        background: linear-gradient(
          180deg,
          rgba(223, 137, 132, 0.12),
          var(--color-surface) 48px
        );
        box-shadow: inset 4px 0 0 var(--color-state-critical);
        transition: box-shadow 160ms ease, border-color 160ms ease;
      }
      .alert-reason {
        margin: 12px 0 0;
        color: var(--color-state-critical);
        font-size: 15px;
        font-weight: 600;
      }
      .dashboard-money-row {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 12px;
      }
      .dashboard-money-row strong.negative {
        color: var(--color-state-critical);
      }
      .dashboard-money-row span {
        display: block;
        color: var(--color-text-muted);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .dashboard-money-row strong {
        display: block;
        margin-top: 4px;
        font-size: var(--type-tier-2, 36px);
        font-weight: 600;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
      }
      .dashboard-money-row p {
        margin: 4px 0 0;
        color: var(--color-text-secondary);
        font-size: 12px;
      }
      .dashboard-bills {
        width: 100%;
        border-collapse: collapse;
        margin-top: 16px;
      }
      .dashboard-bills th {
        text-align: left;
        color: var(--color-text-muted);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        padding: 0 8px 8px;
      }
      .dashboard-bills td {
        padding: 0 8px;
        height: 48px;
        border-top: 1px solid var(--color-border);
        font-size: 15px;
        vertical-align: middle;
      }
      .dashboard-bills td.name {
        font-weight: 600;
      }
      .dashboard-bills th.due,
      .dashboard-bills td.due {
        text-align: left;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        color: var(--color-text-secondary);
      }
      .dashboard-bills th.amt,
      .dashboard-bills td.amt {
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        font-weight: 600;
        color: var(--color-text);
      }
      .dashboard-bills tr.past-due td.due {
        color: var(--color-state-critical);
        font-weight: 600;
      }
      .dashboard-bills .due-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--color-state-critical);
        margin-right: 6px;
        vertical-align: middle;
      }
      .dashboard-bills td.due.muted,
      .dashboard-bills td.amt.muted {
        color: var(--color-text-muted);
        font-weight: 400;
      }
      .mode-label[hidden],
      .mode-label {
        display: none !important;
      }
      .alert-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        min-height: 44px;
        padding: 0 12px;
        border-radius: 999px;
        background: rgba(223, 137, 132, 0.12);
        border: 1px solid var(--color-state-critical);
        color: var(--color-state-critical);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        white-space: nowrap;
        text-decoration: none;
      }
      .dashboard-money-page {
        grid-template-columns: 1fr;
      }
      main.dashboard:has(.dashboard-money-page) {
        align-content: start;
        grid-template-rows: auto auto auto auto;
        height: auto;
        min-height: 0;
      }
      .dashboard-money-page .dashboard-card-money {
        grid-column: 1 / -1;
        height: fit-content;
      }

      /* iPad type scale and 8px grid. Do not use TV vw/svh clamps here. */
      @media (max-width: 1024px) {
        main.dashboard {
          --type-tier-1: 56px;
          --type-tier-2: 36px;
          --type-tier-3: 20px;
          --type-detail: 15px;
          --type-micro: 12px;
          --space-1: 4px;
          --space-2: 8px;
          --space-3: 12px;
          --space-4: 16px;
          --space-5: 24px;
          --space-6: 32px;
          max-width: 1024px;
          padding: 24px;
          gap: 16px;
          /* Tabs are a fourth row. Do not let the TV 3-row 1fr stretch them.
             align-content:start keeps auto rows from growing when the page
             (Money) is shorter than 100svh. */
          grid-template-rows: auto auto auto auto;
          height: auto;
          min-height: 0;
          align-content: start;
          overflow: visible;
        }
        .dashboard-tabs {
          display: flex;
          align-items: center;
          align-self: start;
          height: fit-content;
        }
        .dashboard-tab {
          align-self: center;
          height: 44px;
        }
        /* Identity (wordmark + money alert chip) is hidden below 1024 in
           globals.css. Keep the chip visible on iPad 820 and phone. */
        .identity {
          display: block;
          min-width: 0;
        }
        .dashboard-home {
          gap: 16px;
          padding: 0;
        }
        .dashboard-card {
          border-radius: 8px;
        }
        .dashboard-panel-header,
        .dashboard-panel-body {
          padding: 16px;
        }
        .dashboard-panel-heading h2 {
          font-size: 20px;
          line-height: 1.2;
          font-weight: 600;
          white-space: nowrap;
        }
        .clock {
          font-size: 56px;
          font-weight: 600;
          line-height: 1;
        }
        .clock small {
          font-size: 18px;
          font-weight: 500;
          color: var(--color-accent);
        }
        .date {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--color-accent);
        }
        .dashboard-tab,
        .dashboard-decisions-link,
        .dashboard-bots-more {
          min-height: 44px;
        }
      }
      @media (max-width: 900px) {
        main.dashboard {
          --type-tier-1: 48px;
          --type-tier-2: 32px;
          padding: 16px;
        }
        .clock {
          font-size: 48px;
        }
        .dashboard-usage-grid {
          grid-template-columns: 1fr 1fr;
        }
        .dashboard-home {
          grid-template-columns: 1fr;
        }
        .dashboard-card-decisions,
        .dashboard-card-usage,
        .dashboard-card-bots,
        .dashboard-card-health,
        .dashboard-card-systems,
        .dashboard-card-money {
          grid-column: 1 / -1;
          height: fit-content;
        }
        .dashboard-money-row {
          grid-template-columns: 1fr;
        }
        .dashboard-bots-grid {
          grid-template-columns: 1fr 1fr;
        }
        /* One-row header: clock+date left; weather, alert chip, brand right. */
        .header,
        .header.dashboard-topbar {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .header-right {
          display: flex;
          flex-direction: row;
          flex-wrap: nowrap;
          justify-content: flex-end;
          align-items: center;
          gap: 10px;
          width: 100%;
          flex: 1 1 auto;
          min-width: 0;
        }
        .weather {
          display: flex;
          width: auto;
          justify-content: flex-start;
          align-items: center;
          padding-right: 10px;
          border-right: 1px solid var(--color-border);
          flex: 0 1 auto;
          min-width: 0;
        }
        .weather-feed {
          display: none;
        }
        .weather-main p {
          display: none;
        }
        .weather-main {
          gap: 8px;
        }
        .weather-main > svg {
          width: 28px;
          height: 28px;
        }
        .weather-main > span {
          font-size: 28px;
        }
        .weather-main strong {
          font-size: 12px;
        }
        .identity {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 8px;
          min-width: 0;
          flex: 0 0 auto;
        }
        .identity .wordmark {
          order: 2;
          font-size: 16px;
        }
        .identity .alert-chip,
        .identity .global-status {
          order: 1;
          margin-top: 0;
          min-height: 36px;
          height: 36px;
          padding: 0 10px;
          font-size: 11px;
        }
        .identity .global-status {
          min-height: 0;
          height: auto;
        }
        .clock {
          font-size: 48px;
        }
        .decision-q, .dashboard-decision-q {
          font-size: 16px;
        }
      }
      @media (max-width: 480px) {
        main.dashboard {
          --type-tier-1: 40px;
          --type-tier-2: 28px;
          --type-tier-3: 18px;
          --type-detail: 14px;
          padding: 16px;
        }
        .clock {
          font-size: 40px;
        }
        .dashboard-panel-heading h2 {
          font-size: 18px;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        .header.dashboard-topbar { align-items: flex-start; }
        .header-right { justify-content: space-between; }
        .weather { width: 100%; border-right: 0; padding-right: 0; }
        .identity { width: 100%; justify-content: space-between; }
        .dashboard-usage-grid,
        .dashboard-bots-table td.run {
          /* keep last-run on phone unless it overflows; hide only run column at 360 per mock */
        }
        .dashboard-usage-grid {
          grid-template-columns: 1fr;
        }
        .dashboard-bots-table td.run {
          display: none;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .dashboard-card,
        .dashboard-card-money.alert,
        .dash-tag,
        .dashboard-usage-bar > i,
        .alert-chip {
          transition: none !important;
          animation: none !important;
        }
      }

      @media (min-width: 901px) {
        .dashboard-home {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: start;
        }

        .dashboard-card-bots,
        .dashboard-card-decisions,
        .dashboard-card-usage,
        .dashboard-card-money {
          grid-column: 1 / -1;
          height: fit-content;
        }

        .dashboard-card-health,
        .dashboard-card-systems {
          grid-column: span 1;
          height: fit-content;
          align-self: start;
        }

        .dashboard-schedule-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .dashboard-schedule-group + .dashboard-schedule-group {
          padding-top: 0;
          padding-left: var(--space-3);
          border-top: 0;
          border-left: 1px solid var(--color-border);
        }
      }

      @media (min-width: 1280px) {
        .dashboard-home {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .dashboard-card-bots,
        .dashboard-card-health,
        .dashboard-card-systems,
        .dashboard-card-money {
          grid-column: span 1;
        }

        .dashboard-card-decisions,
        .dashboard-card-usage {
          grid-column: span 2;
        }
      }
    `}</style>
  );
}

function LiveDashboard({
  initial,
  renderedAt,
  display,
  demo,
  forcedMode,
  paused,
  page = "home",
  useData = useDashboardData,
}: {
  initial: DashboardData;
  renderedAt: string;
  display: DisplayConfig;
  demo: boolean;
  forcedMode?: string;
  paused: boolean;
  page?: "home" | "money";
  /**
   * The live data hook. Overridable so the clock derivation below can be
   * exercised without a DOM renderer; production always uses the real hook.
   */
  useData?: (options: {
    initial: DashboardData;
    demo: boolean;
  }) => UseDashboardData;
}) {
  const { data, systemHistory, connectionError, receivedAt } = useData({
    initial,
    demo,
  });
  const [now, setNow] = useState(() => new Date(renderedAt));
  const [rotation, setRotation] = useState(0);
  useEffect(() => startClockTick(setNow), []);
  // `now` keeps ticking every 15 s; a fresher refresh time only moves it forward.
  const clockNow = clockAt(now, receivedAt);
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(
      () => setRotation((i) => i + 1),
      display.rotationSeconds * 1000,
    );
    return () => clearInterval(timer);
  }, [display.rotationSeconds, paused]);
  const mode =
    (forcedMode as Mode | undefined) ||
    modeAt(clockNow, display.timezone, display.modes);
  const alerts = evaluateAlerts(data, clockNow, { includeDemo: demo });
  if (connectionError)
    alerts.unshift({
      id: "connection",
      level: "warning",
      message: "Connection interrupted · retaining last readings",
    });
  const attention = attentionView(alerts, mode, rotation);
  const critical = alerts.some((a) => a.level === "critical");
  const visibleFeeds = Object.entries(data)
    .filter(([domain, state]) => {
      if (domain === "health" || domain === "finance" || domain === "decisions" || domain === "usage") {
        return false;
      }
      return Boolean(state && typeof state === "object" && "source" in state);
    })
    .map(([, state]) => state as { source: string; data: unknown; status: string; lastSuccess: string | null; refreshMs: number });
  const live = visibleFeeds.filter(
    (state) => state.source === "real" && state.data !== null,
  ).length;
  const demoCount = visibleFeeds.filter(
    (state) => state.source === "mock",
  ).length;
  const noData = visibleFeeds.filter(
    (state) => state.source === "real" && state.data === null,
  ).length;
  const sourceProblems = visibleFeeds.some(
    (d) =>
      d.status !== "ready" || isStale(d.lastSuccess, clockNow, d.refreshMs),
  );
  const alertCount = moneyAlertCount(data);
  const status = critical && alertCount === 0
    ? "SYSTEM ATTENTION"
    : "SYSTEMS NORMAL";
  return (
    <main
      className={`dashboard mode-${mode} ${display.pixelShift ? `pixel-shift-${rotation % 4}` : ""}`}
    >
      <DashboardStyles />
      <header className="header dashboard-topbar" data-sticky="true">
        <Clock display={display} initialTime={renderedAt} />
        <div className="header-right">
          <Weather data={data} now={clockNow} />
          <div className="identity">
            <div className="wordmark">
              <span className="logo">
                <Activity />
              </span>
              lifedash
            </div>
            {alertCount > 0 ? (
              <a className="alert-chip" href="/money">
                {alertCount === 1 ? "1 alert" : `${alertCount} alerts`}
              </a>
            ) : (
              <div
                className={`global-status ${critical ? "critical" : ""}`}
              >
                <i />
                {status}
              </div>
            )}
            <div className="mode-label">
              {mode.toUpperCase()} MODE <span>/</span>{" "}
              {
                new Intl.DateTimeFormat(display.locale, {
                  timeZone: display.timezone,
                  timeZoneName: "short",
                })
                  .formatToParts(clockNow)
                  .find((part) => part.type === "timeZoneName")?.value
              }
            </div>
          </div>
        </div>
      </header>
      <nav
        className="dashboard-tabs"
        aria-label="LifeDash navigation"
      >
        <a
          className="dashboard-tab"
          href="/"
          aria-current={page === "home" ? "page" : undefined}
        >
          Home
        </a>
        <a className="dashboard-tab" href="/decisions">
          Decisions
        </a>
        <a
          className="dashboard-tab"
          href="/money"
          aria-current={page === "money" ? "page" : undefined}
        >
          Money
        </a>
        <a className="dashboard-tab" href="https://agents.j0sh.wtf/">
          Agents
        </a>
      </nav>
      <SystemHistoryContext.Provider value={systemHistory}>
        {page === "money" ? (
          <div
            className="domain-columns dashboard-home dashboard-money-page"
            data-layout="single-column"
          >
            <PanelBoundary name="Money">
              <MoneyPanel data={data} display={display} now={clockNow} />
            </PanelBoundary>
          </div>
        ) : (
        <div
          className="domain-columns dashboard-home"
          data-layout="single-column"
          data-breakpoint="640"
        >
          {showDecisions(data) ? (
            <PanelBoundary name="Decisions">
              <DecisionsPanel data={data} now={clockNow} />
            </PanelBoundary>
          ) : null}
          {data.usage !== undefined ? (
            <PanelBoundary name="Usage">
              <UsagePanel data={data} now={clockNow} />
            </PanelBoundary>
          ) : null}
          {isLive(data.ai) ? (
            <PanelBoundary name="Bots">
              <BotsPanel data={data} now={clockNow} />
            </PanelBoundary>
          ) : null}
          {showHealth(data) ? (
            <PanelBoundary name="Health">
              <HealthPanel data={data} display={display} now={clockNow} />
            </PanelBoundary>
          ) : null}
          {isLive(data.reminders) ? (
            <PanelBoundary name="Reminders">
              <RemindersPanel data={data} now={clockNow} />
            </PanelBoundary>
          ) : null}
          {isLive(data.habits) ? (
            <PanelBoundary name="Habits">
              <DashboardCard
                id="habits"
                title="Habits"
                icon={Check}
                source={data.habits}
                now={clockNow}
                className="dashboard-card-habits"
              >
                {data.habits.data?.habits.length ? (
                  <div className="dashboard-habit-list">
                    {data.habits.data.habits.map((habit, index) => (
                      <div className="domain-list-row" key={habit.id || `${habit.title}-${index}`}>
                        <span>{habit.title}</span>
                      </div>
                    ))}
                  </div>
                ) : <div className="domain-empty">No habits in the Habits list</div>}
              </DashboardCard>
            </PanelBoundary>
          ) : null}
          {isLive(data.goals) ? (
            <PanelBoundary name="Goals">
              <DashboardCard
                id="goals"
                title="Goals"
                icon={Target}
                source={data.goals}
                now={clockNow}
                className="dashboard-card-goals"
              >
                {data.goals.data?.goals.length ? (
                  <div className="dashboard-goal-list">
                    {data.goals.data.goals.map((goal, index) => (
                      <div className="domain-list-row" key={goal.id || `${goal.title}-${index}`}>
                        <span>{goal.title}</span>
                      </div>
                    ))}
                  </div>
                ) : <div className="domain-empty">No goals</div>}
              </DashboardCard>
            </PanelBoundary>
          ) : null}
          {isLive(data.systems) ? (
            <PanelBoundary name="Systems">
              <DashboardCard
                id="systems"
                title="Systems"
                icon={Server}
                source={data.systems}
                now={clockNow}
                className="dashboard-card-systems"
              >
                <Systems data={data} now={clockNow} />
              </DashboardCard>
            </PanelBoundary>
          ) : null}
        </div>
        )}
      </SystemHistoryContext.Provider>
      <footer className="footer">
        <div
          className={`attention ${attention.alert ? "has-alerts" : ""} ${critical ? "critical" : ""}`}
          aria-live="polite"
        >
          {attention.alert ? (
            <>
              <TriangleAlert />
              <span>{attention.alert.message}</span>
              {attention.count > 1 ? (
                <small>+{attention.count - 1}</small>
              ) : null}
            </>
          ) : (
            <>
              <Check />
              <span>No urgent attention needed</span>
            </>
          )}
        </div>
        <div className="feed-summary">
          <Network />
          <span>
            {live} LIVE <span className="footer-divider">/</span> {demoCount}
            {noData > 0 ? ` DEMO / ${noData} NO DATA FEEDS` : " DEMO FEEDS"}
          </span>
          <span className="footer-divider">·</span>
          <span>AUTOMATIC REFRESH</span>
        </div>
      </footer>
    </main>
  );
}
export function Dashboard(props: Parameters<typeof LiveDashboard>[0]) {
  return (
    <PanelBoundary name="LifeDash">
      <LiveDashboard {...props} />
    </PanelBoundary>
  );
}
