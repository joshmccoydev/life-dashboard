"use client";
import { Component, memo, useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  Check,
  Cloud,
  CloudRain,
  CloudSnow,
  Code2,
  Moon,
  Network,
  Server,
  Sun,
  Terminal,
  TriangleAlert,
  Wind,
} from "lucide-react";
import type {
  DashboardData,
  DataState,
  DisplayConfig,
  Mode,
} from "@/domains/models";
import { ageLabel, isStale, modeAt } from "@/lib/time";
import { todayView } from "@/lib/today";
import { habitWeek } from "@/lib/habits";
import { upcomingPayments } from "@/lib/payments";
import { evaluateAlerts, attentionView } from "@/lib/alerts";

function Feed({ state, now }: { state: DataState<unknown>; now: Date }) {
  const stale =
    state.status !== "ready" ||
    isStale(state.lastSuccess, now, state.refreshMs);
  return (
    <span
      className={`feed ${stale ? "feed-stale" : ""}`}
      title={
        state.error || `${state.provider} · ${ageLabel(state.lastSuccess, now)}`
      }
    >
      {state.source === "mock"
        ? "DEMO"
        : state.provider === "Apple Health" &&
            !(state.data as { syncedAt?: string }).syncedAt
          ? "IMPORT"
          : "LIVE"}
      {stale ? (
        <>
          <span className="feed-divider">/</span>
          {state.lastSuccess
            ? `STALE ${ageLabel(state.lastSuccess, now).replace(" ago", "")}`
            : "UNAVAILABLE"}
        </>
      ) : state.source === "real" ? (
        <i />
      ) : null}
    </span>
  );
}
function Progress({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <div
      className={`progress ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}
function time(value: string, display: DisplayConfig) {
  return new Intl.DateTimeFormat(display.locale, {
    timeZone: display.timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
function weekday(value: string, display: DisplayConfig) {
  return new Intl.DateTimeFormat(display.locale, {
    timeZone: display.timezone,
    weekday: "short",
  })
    .format(new Date(value))
    .toUpperCase();
}
function workCalendarLabel(value: string | undefined) {
  const name = value || "Work";
  return name.replace(/^work\s*[-–—:]?\s*/i, "") || "Work";
}
function workCalendarTone(value: string | undefined) {
  const hash = Array.from(value || "Work").reduce(
    (total, character) => (total * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  return `tone-${hash % 3}`;
}
function remainingTone(value: number | null) {
  return value === null
    ? "metric-neutral"
    : value >= 60
      ? "metric-good"
      : value >= 25
        ? "metric-mid"
        : "metric-low";
}
function resetTone(value: number | undefined) {
  return value === undefined
    ? "metric-neutral"
    : value >= 3
      ? "metric-good"
      : value === 2
        ? "metric-mid"
        : "metric-low";
}
function usageTone(value: number | null) {
  return value === null
    ? "metric-neutral"
    : value < 60
      ? "metric-good"
      : value < 85
        ? "metric-mid"
        : "metric-low";
}
const Clock = memo(function Clock({
  display,
  initialTime,
}: {
  display: DisplayConfig;
  initialTime: string;
}) {
  const [now, setNow] = useState(() => new Date(initialTime));
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const formatted = now
    ? new Intl.DateTimeFormat(display.locale, {
        timeZone: display.timezone,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).formatToParts(now)
    : [];
  return (
    <div className="clock-block">
      <div className="clock">
        <span>
          {now
            ? formatted
                .filter((p) => p.type !== "dayPeriod")
                .map((p) => p.value)
                .join("")
                .trim()
            : "—:—"}
        </span>
        <small>
          {formatted.find((p) => p.type === "dayPeriod")?.value || " "}
        </small>
      </div>
      <div className="date">
        {now
          ? new Intl.DateTimeFormat(display.locale, {
              timeZone: display.timezone,
              weekday: "long",
              month: "short",
              day: "numeric",
            })
              .format(now)
              .toUpperCase()
          : "LIFEDASH / LOCAL TIME"}
      </div>
    </div>
  );
});
function Weather({ data, now }: { data: DashboardData; now: Date }) {
  const weather = data.weather.data;
  const Icon =
    weather.code >= 95
      ? Wind
      : (weather.code >= 71 && weather.code <= 77) ||
          weather.code === 85 ||
          weather.code === 86
        ? CloudSnow
        : weather.code >= 51
          ? CloudRain
          : weather.code >= 1
            ? Cloud
            : weather.isDay
              ? Sun
              : Moon;
  return (
    <div className="weather">
      <div className="weather-main">
        <Icon />
        <span>
          {weather.temperature}°<small>{weather.unit}</small>
        </span>
        <div>
          <strong>{weather.condition}</strong>
          <p>
            {weather.location} <span>·</span> H {weather.high}° / L{" "}
            {weather.low}°
          </p>
        </div>
      </div>
      <div className="weather-feed">
        <Feed state={data.weather} now={now} />
        <span>Feels like {weather.feelsLike}°</span>
      </div>
    </div>
  );
}
function DomainColumn({
  title,
  subtitle,
  icon: Icon,
  className,
  children,
}: {
  title: string;
  subtitle: string;
  icon: typeof Activity;
  className: string;
  children: ReactNode;
}) {
  return (
    <section className={`domain-column ${className}`} aria-label={title}>
      <header className="domain-column-header">
        <Icon aria-hidden="true" />
        <div>
          <h2>{title}</h2>
          <span>{subtitle}</span>
        </div>
      </header>
      <div className="domain-column-content">{children}</div>
    </section>
  );
}

function DomainSection({
  label,
  source,
  now,
  className = "",
  children,
}: {
  label: string;
  source?: DataState<unknown>;
  now: Date;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`domain-section ${className}`}>
      <div className="domain-section-header">
        <h3>{label}</h3>
        {source ? <Feed state={source} now={now} /> : null}
      </div>
      {children}
    </section>
  );
}

function DomainSchedule({
  kind,
  data,
  now,
  display,
  mode,
}: {
  kind: "personal" | "work";
  data: DashboardData;
  now: Date;
  display: DisplayConfig;
  mode: Mode;
}) {
  const events = data.calendar.data.events.filter(
    (event) => event.calendar === kind,
  );
  const view = todayView(
    events,
    [],
    now,
    display.timezone,
    mode,
    0,
    display.modes.morning,
  );
  const next = view.next;
  const upcoming = events
    .filter((event) => !event.allDay && Date.parse(event.end) > now.getTime())
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const agendaLabel = view.previewTomorrow ? "Tomorrow" : "Today";
  return (
    <DomainSection
      label={kind === "personal" ? agendaLabel : "Work schedule"}
      source={data.calendar}
      now={now}
      className="domain-schedule"
    >
      <div
        className={`domain-next-event ${kind === "work" ? "work-next-event" : ""}`}
      >
        <strong>
          {next && kind === "work" ? (
            <small>{weekday(next.start, display)}</small>
          ) : null}
          {next ? time(next.start, display) : "All clear"}
        </strong>
        <div>
          <h4>
            {kind === "work" && next?.calendarName
              ? workCalendarLabel(next.calendarName)
              : next?.title || "Nothing scheduled"}
          </h4>
          <span>
            {kind === "work" && next
              ? `${next.title}${next.location ? ` · ${next.location}` : ""}`
              : next?.calendarName || next?.location || `${kind} calendar`}
          </span>
        </div>
      </div>
      {kind === "work" ? (
        <div className="domain-event-list">
          {upcoming
            .filter((event) => event !== next)
            .slice(0, 4)
            .map((event) => (
              <div
                className="domain-list-row"
                key={`${event.id}-${event.start}`}
              >
                <span className="work-event-name">
                  <i
                    className={`work-calendar ${workCalendarTone(event.calendarName)}`}
                  >
                    {workCalendarLabel(event.calendarName)}
                  </i>
                  {event.title}
                </span>
                <strong>
                  {weekday(event.start, display)} · {time(event.start, display)}
                </strong>
              </div>
            ))}
          {!upcoming.length ? (
            <div className="domain-empty">No work events ahead</div>
          ) : null}
        </div>
      ) : null}
    </DomainSection>
  );
}

function DomainHabits({
  data,
  now,
  display,
}: {
  data: DashboardData;
  now: Date;
  display: DisplayConfig;
}) {
  const habits = data.habits.data.habits.map((habit) => ({
    habit,
    week: habitWeek(habit, now, display.timezone),
  }));
  const today = habits.filter(({ week }) => week.today);
  return (
    <DomainSection label="Habits · this week" source={data.habits} now={now}>
      <div className="domain-habits">
        {habits.length ? (
          <div className="domain-habit-days" aria-hidden="true">
            <span />
            <div>
              {Array.from("MTWTFSS", (day, index) => (
                <i key={`${day}-${index}`}>{day}</i>
              ))}
            </div>
            <span />
          </div>
        ) : null}
        {habits.slice(0, 4).map(({ habit, week }) => (
          <div className="domain-habit-row" key={habit.id}>
            <span>{habit.title}</span>
            <div
              className="habit-week"
              aria-label={`${habit.title}: ${week.completed} of ${week.scheduled}`}
            >
              {week.days.map(({ date, occurrence }) => (
                <i
                  key={date}
                  className={
                    occurrence
                      ? occurrence.completed
                        ? "done"
                        : "missed"
                      : "unscheduled"
                  }
                />
              ))}
            </div>
            <strong>
              {week.completed}/{week.scheduled}
            </strong>
          </div>
        ))}
        {!habits.length ? (
          <div className="domain-empty">No habits in the Habits list</div>
        ) : (
          <div className="domain-section-summary">
            {today.length
              ? `Today · ${today.filter(({ week }) => week.today?.completed).length} of ${today.length} scheduled complete`
              : "No habits scheduled today"}
          </div>
        )}
      </div>
    </DomainSection>
  );
}

function DomainPayments({
  data,
  now,
  display,
}: {
  data: DashboardData;
  now: Date;
  display: DisplayConfig;
}) {
  const payments = upcomingPayments(
    data.reminders.data.items,
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
      {payments.slice(0, 2).map((payment) => (
        <div className="domain-list-row" key={payment.id}>
          <span>{payment.title}</span>
          <strong>{date(payment.due!)}</strong>
        </div>
      ))}
      {!payments.length ? (
        <div className="domain-empty">No upcoming payments</div>
      ) : null}
    </DomainSection>
  );
}

function DomainBuild({ data, now }: { data: DashboardData; now: Date }) {
  const build = data.build.data;
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

function goalDue(value: string | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
      }).format(new Date(value))
    : null;
}

function DomainGoals({ data, now }: { data: DashboardData; now: Date }) {
  const goals = data.goals.data;
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

function DomainProjects({ data, now }: { data: DashboardData; now: Date }) {
  const projects = data.goals.data.projects;
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

function DomainAI({ data, now }: { data: DashboardData; now: Date }) {
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
        {data.ai.data.providers.slice(0, 5).map((provider) => (
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
      </div>
    </DomainSection>
  );
}

type SystemSample = {
  cpu: number | null;
  memory: number | null;
  disk: number | null;
};

function SystemSparkline({
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

function DomainSystems({
  data,
  now,
  history,
}: {
  data: DashboardData;
  now: Date;
  history: SystemSample[];
}) {
  const systems = data.systems.data;
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
class PanelBoundary extends Component<
  { children: ReactNode; name: string },
  { failed: boolean }
> {
  state = { failed: false };
  private retryTimer?: ReturnType<typeof setTimeout>;
  componentWillUnmount() {
    clearTimeout(this.retryTimer);
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.setState({ failed: false }), 30000);
    console.error(
      JSON.stringify({
        event: "panel_render_failed",
        panel: this.props.name,
        message: error.message,
      }),
    );
  }
  render() {
    return this.state.failed ? (
      <section className="panel panel-error">
        <TriangleAlert />
        <h2>{this.props.name}</h2>
        <p>
          This panel is temporarily unavailable. Retrying automatically in 30
          seconds.
        </p>
      </section>
    ) : (
      this.props.children
    );
  }
}
function LiveDashboard({
  initial,
  renderedAt,
  display,
  demo,
  forcedMode,
  paused,
}: {
  initial: DashboardData;
  renderedAt: string;
  display: DisplayConfig;
  demo: boolean;
  forcedMode?: string;
  paused: boolean;
}) {
  const [data, setData] = useState(initial);
  const [systemHistory, setSystemHistory] = useState<SystemSample[]>(() => [
    {
      cpu: initial.systems.data.machine.cpuPercent,
      memory: initial.systems.data.machine.memoryPercent,
      disk: initial.systems.data.machine.diskPercent,
    },
  ]);
  const [now, setNow] = useState(() => new Date(renderedAt));
  const [rotation, setRotation] = useState(0);
  const [connectionError, setConnectionError] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(
      () => setRotation((i) => i + 1),
      display.rotationSeconds * 1000,
    );
    return () => clearInterval(timer);
  }, [display.rotationSeconds, paused]);
  useEffect(() => {
    let busy = false;
    let stopped = false;
    let controller: AbortController | null = null;
    async function refresh() {
      if (busy || stopped) return;
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15000);
      try {
        const response = await fetch(
          `/api/dashboard${demo ? "?demo=true" : ""}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("Refresh failed");
        const json = await response.json();
        if (!json.data?.systems?.data?.machine)
          throw new Error("Invalid dashboard response");
        if (!stopped) {
          setData(json.data);
          setSystemHistory((history) =>
            [
              ...history,
              {
                cpu: json.data.systems.data.machine.cpuPercent,
                memory: json.data.systems.data.machine.memoryPercent,
                disk: json.data.systems.data.machine.diskPercent,
              },
            ].slice(-18),
          );
          setConnectionError(false);
          setNow(new Date());
        }
      } catch {
        if (!stopped) setConnectionError(true);
      } finally {
        clearTimeout(timeout);
        busy = false;
      }
    }
    const interval = setInterval(() => void refresh(), 30000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      controller?.abort();
      clearInterval(interval);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [demo]);
  const mode =
    (forcedMode as Mode | undefined) ||
    modeAt(now, display.timezone, display.modes);
  const alerts = evaluateAlerts(data, now, { includeDemo: demo });
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
  const live = visibleFeeds.filter((state) => state.source === "real").length;
  const totalFeeds = visibleFeeds.length;
  const sourceProblems = visibleFeeds.some(
    (d) => d.status !== "ready" || isStale(d.lastSuccess, now, d.refreshMs),
  );
  const offline = data.systems.data.endpoints.some(
    (e) => e.status === "offline",
  );
  const status =
    critical || offline
      ? "SYSTEM ATTENTION"
      : connectionError || sourceProblems
        ? "FEED ATTENTION"
        : "SYSTEMS NORMAL";
  return (
    <main
      className={`dashboard mode-${mode} ${display.pixelShift ? `pixel-shift-${rotation % 4}` : ""}`}
    >
      <header className="header">
        <Clock display={display} initialTime={renderedAt} />
        <div className="header-right">
          <Weather data={data} now={now} />
          <div className="identity">
            <div className="wordmark">
              <span className="logo">
                <Activity />
              </span>
              lifedash
            </div>
            <div
              className={`global-status ${critical || offline ? "critical" : sourceProblems || connectionError ? "caution" : ""}`}
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
                  .formatToParts(now)
                  .find((part) => part.type === "timeZoneName")?.value
              }
            </div>
          </div>
        </div>
      </header>
      <div className="domain-columns">
        <PanelBoundary name="Personal">
          <DomainColumn
            title="Personal"
            subtitle="Calendar · habits · payments · goals"
            icon={Activity}
            className="personal-column"
          >
            <DomainSchedule
              kind="personal"
              data={data}
              now={now}
              display={display}
              mode={mode}
            />
            <DomainHabits data={data} now={now} display={display} />
            <DomainPayments data={data} now={now} display={display} />
            <DomainGoals data={data} now={now} />
          </DomainColumn>
        </PanelBoundary>
        <PanelBoundary name="Work and Build">
          <DomainColumn
            title="Work & Build"
            subtitle="Schedule · projects · GitHub"
            icon={Code2}
            className="work-column"
          >
            <DomainSchedule
              kind="work"
              data={data}
              now={now}
              display={display}
              mode={mode}
            />
            <DomainProjects data={data} now={now} />
            <DomainBuild data={data} now={now} />
          </DomainColumn>
        </PanelBoundary>
        <PanelBoundary name="Digital">
          <DomainColumn
            title="Digital"
            subtitle="Mac · network · AI"
            icon={Server}
            className="digital-column"
          >
            <DomainSystems data={data} now={now} history={systemHistory} />
            <DomainAI data={data} now={now} />
          </DomainColumn>
        </PanelBoundary>
      </div>
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
            {live} LIVE <span className="footer-divider">/</span>{" "}
            {totalFeeds - live} DEMO FEEDS
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
