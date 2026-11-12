import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  normalizeGitHub,
  normalizePublicGitHub,
} from "@/adapters/github";
import { normalizeWeather } from "@/adapters/weather";
import { config } from "@/config";
import {
  mergeFeeds,
  readKvFeeds,
  type FeedEntry,
  type FeedSnapshot,
} from "@/lib/feed-store";
import { botsToAiState, hostToSystemState } from "@/lib/feed-adapters";
import type {
  BuildState,
  DashboardData,
  DataState,
  DecisionsHomeState,
  UsageProviderId,
  UsageRow,
  UsageState,
  WeatherState,
} from "@/domains/models";
import { localDateKey, zonedDateTime } from "@/lib/time";

export type KvBinding = {
  get(key: string): Promise<string | null>;
};

export type LiveDashboardDependencies = {
  env?: { FEEDS_KV?: KvBinding };
  fetchImpl?: typeof fetch;
  now?: () => Date;
  getCloudflareContext?: () =>
    | { env: { FEEDS_KV?: KvBinding } }
    | Promise<{ env: { FEEDS_KV?: KvBinding } }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKvBinding(value: unknown): value is KvBinding {
  return isRecord(value) && typeof value.get === "function";
}

async function resolveEnv(
  dependencies: LiveDashboardDependencies,
): Promise<LiveDashboardDependencies["env"]> {
  if (dependencies.env) return dependencies.env;

  try {
    const context = await (
      dependencies.getCloudflareContext ?? getCloudflareContext
    )();
    if (!isRecord(context) || !isRecord(context.env)) return undefined;
    return {
      FEEDS_KV: isKvBinding(context.env.FEEDS_KV)
        ? context.env.FEEDS_KV
        : undefined,
    };
  } catch {
    return undefined;
  }
}

function liveErrorState<T>(
  provider: string,
  now: Date,
  refreshMs: number,
  error: unknown,
): DataState<T> {
  return {
    loading: false,
    data: null,
    source: "real",
    provider,
    status: "error",
    lastSuccess: null,
    lastAttempt: now.toISOString(),
    error: error instanceof Error ? error.message : "Live feed failed",
    refreshMs,
  };
}

function liveReadyState<T>(
  data: T,
  provider: string,
  now: Date,
  refreshMs: number,
): DataState<T> {
  return {
    loading: false,
    data,
    source: "real",
    provider,
    status: "ready",
    lastSuccess: now.toISOString(),
    lastAttempt: now.toISOString(),
    error: null,
    refreshMs,
  };
}

async function fetchWeatherState(
  dependencies: LiveDashboardDependencies,
  now: Date,
  refreshMs: number,
): Promise<DataState<WeatherState>> {
  const provider = "Open-Meteo";
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(config.latitude),
      longitude: String(config.longitude),
      current: "temperature_2m,apparent_temperature,weather_code,is_day",
      daily: "temperature_2m_max,temperature_2m_min",
      temperature_unit: config.weatherUnit === "F" ? "fahrenheit" : "celsius",
      timezone: config.display.timezone,
      forecast_days: "1",
    }).toString();
    const response = await (dependencies.fetchImpl ?? fetch)(url, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Weather HTTP ${response.status}`);
    return liveReadyState(
      normalizeWeather(await response.json()),
      provider,
      now,
      refreshMs,
    );
  } catch (error) {
    return liveErrorState(provider, now, refreshMs, error);
  }
}

async function fetchGitHubState(
  dependencies: LiveDashboardDependencies,
  now: Date,
  refreshMs: number,
): Promise<DataState<BuildState>> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const provider = config.githubToken
    ? "GitHub authenticated"
    : "GitHub public";
  try {
    const from = zonedDateTime(
      localDateKey(now, config.display.timezone),
      0,
      0,
      config.display.timezone,
    ).toISOString();
    if (config.githubToken || dependencies.fetchImpl) {
      const response = await fetchImpl("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          ...(config.githubToken
            ? { Authorization: `Bearer ${config.githubToken}` }
            : {}),
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
        body: JSON.stringify({
          query:
            "query($login: String!, $from: DateTime!, $to: DateTime!) { user(login:$login) { login pullRequests(states:OPEN) { totalCount } contributionsCollection(from:$from, to:$to) { totalCommitContributions commitContributionsByRepository(maxRepositories:100) { repository { nameWithOwner } contributions { totalCount } } } repositories(first:1, orderBy:{field:PUSHED_AT,direction:DESC}, ownerAffiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER]) { nodes { pushedAt } } } }",
          variables: {
            login: config.githubUsername,
            from,
            to: now.toISOString(),
          },
        }),
      });
      if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
      return liveReadyState(
        normalizeGitHub(await response.json()),
        provider,
        now,
        refreshMs,
      );
    }

    const search = async (kind: string, query: string) => {
      const url = new URL(`https://api.github.com/search/${kind}`);
      url.searchParams.set("q", query);
      url.searchParams.set("per_page", "100");
      const response = await fetchImpl(url, {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`GitHub public HTTP ${response.status}`);
      return response.json();
    };
    const [commits, prs] = await Promise.all([
      search(
        "commits",
        `author:${config.githubUsername} committer-date:${from}..${now.toISOString()}`,
      ),
      search("issues", `author:${config.githubUsername} is:pr is:open`),
    ]);
    return liveReadyState(
      normalizePublicGitHub(
        commits as Parameters<typeof normalizePublicGitHub>[0],
        prs as Parameters<typeof normalizePublicGitHub>[1],
        config.githubUsername!,
      ),
      provider,
      now,
      refreshMs,
    );
  } catch (error) {
    return liveErrorState(provider, now, refreshMs, error);
  }
}

function feedState<T>(
  entry: FeedEntry,
  now: Date,
  refreshMs: number,
  data: T | null = entry.data as T | null,
): DataState<T> {
  return {
    loading: false,
    data,
    source: "real",
    provider: entry.source ? `Cloudflare KV (${entry.source})` : "Cloudflare KV",
    status: entry.stale ? "stale" : data === null ? "error" : "ready",
    lastSuccess: entry.updatedAt,
    lastAttempt: entry.updatedAt ?? now.toISOString(),
    error: data === null ? "Feed unavailable" : null,
    refreshMs,
  };
}

function applePart(feeds: FeedSnapshot, key: string): unknown {
  const entry = feeds.apple;
  return isRecord(entry.data) ? (entry.data[key] ?? null) : null;
}

function applePanelState<T>(
  entry: FeedEntry,
  value: unknown,
  now: Date,
  refreshMs: number,
): DataState<T> {
  const panel = isRecord(value) ? value : null;
  const stamp = panel && typeof panel.as_of === "string" ? panel.as_of : entry.updatedAt;
  const stampMs = stamp ? Date.parse(stamp) : NaN;
  const stale = !Number.isFinite(stampMs) || now.getTime() - stampMs > 24 * 60 * 60 * 1000;
  const data = value as T | null;
  return {
    loading: false,
    data,
    source: "real",
    provider: entry.source ? `Cloudflare KV (${entry.source})` : "Cloudflare KV",
    status: stale ? "stale" : data === null ? "error" : "ready",
    lastSuccess: stamp ?? null,
    lastAttempt: stamp ?? now.toISOString(),
    error: data === null ? "Feed unavailable" : null,
    refreshMs,
  };
}

function decisionsState(
  entry: FeedEntry,
  now: Date,
): DataState<DecisionsHomeState> {
  const raw = entry.data;
  if (!isRecord(raw) || !Array.isArray(raw.cards)) {
    return feedState<DecisionsHomeState>(entry, now, Math.max(config.intervals.ai, 3600000), null);
  }
  const cards = raw.cards
    .filter(isRecord)
    .map((card) => ({
      id: typeof card.id === "string" ? card.id : undefined,
      bot: String(card.bot ?? ""),
      question: String(card.question ?? ""),
      rec: typeof card.rec === "string" ? card.rec : undefined,
      blocking: Boolean(card.blocking),
      source: typeof card.source === "string" ? card.source : undefined,
    }));
  const data: DecisionsHomeState = {
    generatedAt:
      typeof raw.generatedAt === "string" ? raw.generatedAt : undefined,
    count: typeof raw.count === "number" ? raw.count : cards.length,
    cards,
  };
  return feedState(entry, now, Math.max(config.intervals.ai, 3600000), data);
}


function isUsageId(value: unknown): value is UsageProviderId {
  return (
    value === "grok" ||
    value === "chatgpt" ||
    value === "opencode" ||
    value === "nous"
  );
}

function usageState(entry: FeedEntry, now: Date): DataState<UsageState> {
  const raw = entry.data;
  const interval = Math.max(config.intervals.ai, 3600000);
  if (!isRecord(raw) || !Array.isArray(raw.providers)) {
    return feedState<UsageState>(entry, now, interval, null);
  }
  const providers: UsageRow[] = [];
  for (const item of raw.providers) {
    if (!isRecord(item) || !isUsageId(item.id)) continue;
    const pct =
      typeof item.pct_used === "number" && Number.isFinite(item.pct_used)
        ? item.pct_used
        : null;
    const cost =
      typeof item.monthly_cost_usd === "number" &&
      Number.isFinite(item.monthly_cost_usd)
        ? item.monthly_cost_usd
        : null;
    const id = item.id;
    const asOf = typeof item.as_of === "string" ? item.as_of : null;
    const staleAfterMs = id === "chatgpt" ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const ageStale = asOf !== null && Number.isFinite(Date.parse(asOf)) && now.getTime() - Date.parse(asOf) > staleAfterMs;
    providers.push({
      id,
      name: typeof item.name === "string" ? item.name : String(item.id),
      plan: typeof item.plan === "string" ? item.plan : null,
      monthly_cost_usd: cost,
      pct_used: pct,
      pct_window: item.pct_window === "weekly" ? "weekly" : null,
      resets_at: typeof item.resets_at === "string" ? item.resets_at : null,
      as_of: asOf,
      source: typeof item.source === "string" ? item.source : null,
      note: typeof item.note === "string" ? item.note : null,
      stale: Boolean(item.stale) || ageStale,
      manual: Boolean(item.manual),
    });
  }
  if (!providers.length) {
    return feedState<UsageState>(entry, now, interval, null);
  }
  const state = feedState(entry, now, interval, { providers });
  if (providers.some((provider) => provider.stale)) state.status = "stale";
  return state;
}

export function dashboardFromFeeds(
  feeds: FeedSnapshot,
  now: Date,
): Pick<
  DashboardData,
  | "calendar"
  | "reminders"
  | "finance"
  | "health"
  | "ai"
  | "systems"
  | "habits"
  | "goals"
  | "decisions"
  | "usage"
  | "weather"
  | "build"
> {
  return {
    calendar: feedState(
      feeds.apple,
      now,
      Math.max(config.intervals.calendar, 3600000),
      applePart(feeds, "calendar") as DashboardData["calendar"]["data"],
    ),
    reminders: applePanelState(
      feeds.apple,
      applePart(feeds, "reminders"),
      now,
      Math.max(config.intervals.reminders, 3600000),
    ),
    finance: feedState(
      feeds.money,
      now,
      Math.max(config.intervals.finance, 3600000),
    ),
    health: feedState(
      feeds.health,
      now,
      Math.max(config.intervals.health, 3600000),
    ),
    ai: feedState(
      feeds.bots,
      now,
      Math.max(config.intervals.ai, 3600000),
      botsToAiState(feeds.bots.data),
    ),
    systems: feedState(
      feeds.host,
      now,
      Math.max(config.intervals.systems, 3600000),
      hostToSystemState(feeds.host.data),
    ),
    habits: applePanelState(
      feeds.apple,
      applePart(feeds, "habits"),
      now,
      Math.max(config.intervals.habits, 3600000),
    ),
    goals: applePanelState(
      feeds.apple,
      applePart(feeds, "goals"),
      now,
      Math.max(config.intervals.goals, 3600000),
    ),
    decisions: decisionsState(feeds.decisions, now),
    usage: usageState(feeds.usage, now),
    weather: feedState(feeds.weather, now, config.intervals.weather),
    build: feedState(feeds.build, now, config.intervals.build),
  };
}

/** Live KV-backed dashboard. Never uses mock adapters. */
export async function loadLiveDashboard(
  dependencies: LiveDashboardDependencies = {},
): Promise<DashboardData> {
  const now = dependencies.now?.() ?? new Date();
  const env = await resolveEnv(dependencies);
  const incoming = await readKvFeeds(env?.FEEDS_KV);
  const feeds = mergeFeeds(null, incoming, now);

  const fromFeeds = dashboardFromFeeds(feeds, now);
  const [weather, build] = await Promise.all([
    feeds.weather.data !== null ? Promise.resolve(fromFeeds.weather) : fetchWeatherState(dependencies, now, config.intervals.weather),
    feeds.build.data !== null ? Promise.resolve(fromFeeds.build) : fetchGitHubState(dependencies, now, config.intervals.build),
  ]);

  return {
    ...fromFeeds,
    weather,
    build,
  };
}
