"use client";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
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
} from "@/domains/models";
import {
  ageLabel,
  asOfLabel,
  dayKeyOffset,
  isStale,
  localDateKey,
  modeAt,
} from "@/lib/time";
import { stripPrivate } from "@/lib/privacy";
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
import { Goals } from "@/components/panels/Goals";
import { Habits } from "@/components/panels/Habits";
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

type FinanceSummary = {
  cashOnHand: number | null;
  billsDueTotal: number | null;
  billsDueCount: number;
  depositTarget: number | null;
  status: "ok" | "alert" | "unknown";
};

function isFinanceSummary(data: unknown): data is FinanceSummary {
  return isRecord(data) && "cashOnHand" in data;
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
            <strong className="dashboard-panel-status">Stale</strong>
          ) : null}
        </div>
      </header>
      <div className="dashboard-panel-body">{children}</div>
    </section>
  );
}

function BotsPanel({ data, now }: { data: DashboardData; now: Date }) {
  const providers = [...(data.ai.data?.providers ?? [])].sort((left, right) => {
    const leftStatus = left.status as string;
    const rightStatus = right.status as string;
    const leftWaiting =
      leftStatus === "waiting" ||
      left.detail?.toLowerCase().includes("waiting on josh");
    const rightWaiting =
      rightStatus === "waiting" ||
      right.detail?.toLowerCase().includes("waiting on josh");
    return Number(rightWaiting) - Number(leftWaiting);
  });

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
        <div className="domain-empty">No data</div>
      ) : providers.length ? (
        <div className="dashboard-bot-list">
          {providers.map((provider) => {
            const status = provider.status as string;
            const waiting =
              status === "waiting" ||
              provider.detail?.toLowerCase().includes("waiting on josh");
            return (
              <div
                className={`dashboard-bot-row${waiting ? " waiting highlight attention" : ""}`}
                data-waiting={waiting ? "true" : undefined}
                key={provider.name}
              >
                <div>
                  <strong>{stripPrivate(provider.name)}</strong>
                  <p>{stripPrivate(provider.detail || "No recent action")}</p>
                </div>
                <span>{stripPrivate(String(provider.value || provider.status))}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="domain-empty">No bot activity</div>
      )}
      <Feed state={data.ai} now={now} />
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
  type FinanceSummary = {
    cashOnHand: number | null;
    billsDueTotal: number | null;
    billsDueCount: number;
    depositTarget: number | null;
    status: "ok" | "alert" | "unknown";
  };

  const finance = data.finance.data;
  const financeSummary =
    finance !== null &&
    typeof finance === "object" &&
    "cashOnHand" in finance
      ? (finance as unknown as FinanceSummary)
      : null;
  const money = new Intl.NumberFormat(display.locale, {
    style: "currency",
    currency: display.currency,
    maximumFractionDigits: 0,
  });
  const bills = [...(finance?.bills ?? [])].sort(
    (left, right) => Date.parse(left.due) - Date.parse(right.due),
  );
  const goal =
    finance && finance.emergencyTarget > 0
      ? Math.round((finance.emergencyFund / finance.emergencyTarget) * 100)
      : 0;
  const overBudget = finance
    ? finance.spending > finance.spendingBudget
    : false;

  return (
    <DashboardCard
      id="money"
      title="Money"
      icon={DollarSign}
      source={data.finance}
      now={now}
      className="dashboard-card-money"
    >
      {finance === null ? (
        <div className="domain-empty">No data</div>
      ) : financeSummary ? (
        <div className="dashboard-money-grid">
          <div>
            <span>Cash on hand</span>
            <strong>
              {financeSummary.cashOnHand === null
                ? "—"
                : money.format(financeSummary.cashOnHand)}
            </strong>
          </div>
          <div>
            <span>Bills due</span>
            <strong>
              {financeSummary.billsDueTotal === null
                ? "—"
                : money.format(financeSummary.billsDueTotal)}
            </strong>
            <p>{financeSummary.billsDueCount} bills</p>
          </div>
          <div>
            <span>Deposit target</span>
            <strong>
              {financeSummary.depositTarget === null
                ? "—"
                : money.format(financeSummary.depositTarget)}
            </strong>
          </div>
          <div>
            <span>Status</span>
            <strong
              className={
                financeSummary.status === "ok"
                  ? "metric-good"
                  : financeSummary.status === "alert"
                    ? "metric-critical"
                    : undefined
              }
            >
              {financeSummary.status === "ok"
                ? "On track"
                : financeSummary.status === "alert"
                  ? "Alert"
                  : "Unknown"}
            </strong>
          </div>
        </div>
      ) : (
        <div className="dashboard-money-grid">
          <div>
            <span>Cash</span>
            <strong>{money.format(finance.checking)}</strong>
          </div>
          <div>
            <span>Next bills</span>
            {bills.length ? (
              bills.slice(0, 2).map((bill) => (
                <p key={`${bill.title}-${bill.due}`}>
                  {bill.title} <strong>{money.format(bill.amount)}</strong>
                </p>
              ))
            ) : (
              <p>No upcoming payments</p>
            )}
          </div>
          <div>
            <span>Goal</span>
            <strong>{goal}%</strong>
            <p>Emergency fund</p>
          </div>
          <div>
            <span>Alerts</span>
            <strong className={overBudget ? "metric-critical" : "metric-good"}>
              {overBudget ? "Over budget" : "On track"}
            </strong>
          </div>
        </div>
      )}
    </DashboardCard>
  );
}

function habitStreak(data: DashboardData, now: Date, timezone: string) {
  const completed = new Set(
    (data.habits.data?.habits ?? []).flatMap((habit) =>
      habit.occurrences
        .filter((occurrence) => occurrence.completed)
        .map((occurrence) => occurrence.date),
    ),
  );
  const today = localDateKey(now, timezone);
  let streak = 0;
  for (let offset = 0; offset < 366; offset++) {
    if (!completed.has(dayKeyOffset(now, -offset, timezone))) break;
    streak++;
  }
  return { today, streak };
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
  const healthStreak = habitStreak(data, now, display.timezone);
  const completedThisWeek = (data.habits.data?.habits ?? []).reduce(
    (total, habit) =>
      total +
      habit.occurrences.filter(
        (occurrence) =>
          occurrence.completed &&
          occurrence.date >= dayKeyOffset(now, -6, display.timezone) &&
          occurrence.date <= healthStreak.today,
      ).length,
    0,
  );
  const weekLabel = health?.week
    ? `${health.week.activeDays ?? 0} active days${
        health.week.steps !== undefined && health.week.goal
          ? ` · ${health.week.steps.toLocaleString(display.locale)}/${health.week.goal.toLocaleString(display.locale)} steps`
          : ""
      }`
    : `${completedThisWeek} habit check-ins`;
  const streakDays = health?.streak?.days ?? healthStreak.streak;
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
          <div>
            <span>This week</span>
            <strong>{weekLabel}</strong>
          </div>
          <div>
            <span>Streak</span>
            <strong>
              {streakDays} {streakDays === 1 ? "day" : "days"}
            </strong>
            <p>{streakLabel}</p>
          </div>
        </div>
      )}
      {isLive(data.habits) ? (
        <Habits data={data} now={now} display={display} />
      ) : null}
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
  const cards = (payload?.cards ?? []).slice(0, 8);
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
            <div>
              <strong>{stripPrivate(card.bot)}</strong>
              <p>{stripPrivate(card.question)}</p>
            </div>
            {card.blocking ? <span>blocking</span> : null}
          </div>
        ))}
      </div>
      <a className="dashboard-decisions-link" href="/decisions">
        <span>
          {total > cards.length
            ? `Open all ${total} in the inbox`
            : "Open the decisions inbox"}
        </span>
        <ArrowRight aria-hidden="true" />
      </a>
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
  const reminders = [...(data.reminders.data?.items ?? [])].sort(
    (left, right) => {
      if (left.completed !== right.completed)
        return Number(left.completed) - Number(right.completed);
      return (left.due ?? "").localeCompare(right.due ?? "");
    },
  );

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
      ) : reminders.length ? (
        <div className="dashboard-reminder-list">
          {reminders.slice(0, 5).map((reminder) => (
            <div className="domain-list-row" key={reminder.id}>
              <span>{reminder.title}</span>
              <strong>{reminder.completed ? "Complete" : "Open"}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="domain-empty">No upcoming payments</div>
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
        border-bottom: 1px solid var(--color-border);
      }

      .dashboard-tab {
        padding: var(--space-2) var(--space-3);
        border: 1px solid transparent;
        border-radius: 0.4rem;
        background: transparent;
        color: var(--color-text-muted);
        cursor: pointer;
        font: inherit;
        font-size: var(--type-detail);
        text-decoration: none;
      }

      .dashboard-tab[aria-current="page"] {
        border-color: var(--color-border-strong);
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
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
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
        border-bottom: 1px solid var(--color-border);
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
        border-top: 1px solid var(--color-border);
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
        gap: var(--space-2);
        min-width: 0;
      }

      .dashboard-decision-row {
        display: flex;
        justify-content: space-between;
        gap: var(--space-3);
        min-width: 0;
      }

      .dashboard-decision-row div {
        min-width: 0;
      }

      .dashboard-decision-row p {
        margin-top: var(--space-1);
        color: var(--color-text-secondary);
        font-size: var(--type-detail);
        overflow-wrap: anywhere;
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

      @media (min-width: 640px) {
        .dashboard-home {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .dashboard-card-bots,
        .dashboard-card-health,
        .dashboard-card-systems,
        .dashboard-card-money,
        .dashboard-card-decisions {
          grid-column: span 2;
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

        .dashboard-card-decisions {
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
  useData = useDashboardData,
}: {
  initial: DashboardData;
  renderedAt: string;
  display: DisplayConfig;
  demo: boolean;
  forcedMode?: string;
  paused: boolean;
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
    .filter(([domain]) => domain !== "health" && domain !== "finance")
    .map(([, state]) => state);
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
  const status = critical
    ? "SYSTEM ATTENTION"
    : connectionError || sourceProblems
      ? "FEED ATTENTION"
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
            <div
              className={`global-status ${critical ? "critical" : sourceProblems || connectionError ? "caution" : ""}`}
            >
              <i />
              {status}
            </div>
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
        role="tablist"
        aria-label="Dashboard views"
      >
        <button
          type="button"
          className="dashboard-tab"
          role="tab"
          aria-selected="true"
        >
          Home
        </button>
        <a className="dashboard-tab" href="/decisions" role="tab">
          Decisions
        </a>
      </nav>
      <SystemHistoryContext.Provider value={systemHistory}>
        <div
          className="domain-columns dashboard-home"
          data-layout="single-column"
          data-breakpoint="640"
        >
          {isLive(data.ai) ? (
            <PanelBoundary name="Bots">
              <BotsPanel data={data} now={clockNow} />
            </PanelBoundary>
          ) : null}
          {showMoney(data) ? (
            <PanelBoundary name="Money">
              <MoneyPanel data={data} display={display} now={clockNow} />
            </PanelBoundary>
          ) : null}
          {showHealth(data) ? (
            <PanelBoundary name="Health">
              <HealthPanel data={data} display={display} now={clockNow} />
            </PanelBoundary>
          ) : null}
          {isLive(data.calendar) ? (
            <PanelBoundary name="Schedule">
              <SchedulePanel data={data} display={display} now={clockNow} />
            </PanelBoundary>
          ) : null}
          {isLive(data.reminders) ? (
            <PanelBoundary name="Reminders">
              <RemindersPanel data={data} now={clockNow} />
            </PanelBoundary>
          ) : null}
          {isLive(data.build) ? (
            <PanelBoundary name="GitHub">
              <DashboardCard
                id="github"
                title="GitHub"
                icon={Code2}
                source={data.build}
                now={clockNow}
                className="dashboard-card-github"
              >
                <Build data={data} now={clockNow} />
              </DashboardCard>
            </PanelBoundary>
          ) : null}
          {isLive(data.goals) && (data.goals.data?.goals?.length ?? 0) > 0 ? (
            <PanelBoundary name="Goals">
              <DashboardCard
                id="goals"
                title="Goals"
                icon={Target}
                source={data.goals}
                now={clockNow}
                className="dashboard-card-goals"
              >
                <Goals data={data} now={clockNow} />
              </DashboardCard>
            </PanelBoundary>
          ) : null}
          {isLive(data.goals) && (data.goals.data?.projects?.length ?? 0) > 0 ? (
            <PanelBoundary name="Projects">
              <DashboardCard
                id="projects"
                title="Projects"
                icon={Folder}
                source={data.goals}
                now={clockNow}
                className="dashboard-card-projects"
              >
                <Projects data={data} now={clockNow} />
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
          {showDecisions(data) ? (
            <PanelBoundary name="Decisions">
              <DecisionsPanel data={data} now={clockNow} />
            </PanelBoundary>
          ) : null}
        </div>
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
