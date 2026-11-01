import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDemoDashboard } from "@/adapters";
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
import type {
  BuildState,
  DashboardData,
  DataState,
  WeatherState,
} from "@/domains/models";
import { localDateKey, zonedDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type KvBinding = {
  get(key: string): Promise<string | null>;
};

type RouteDependencies = {
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
  dependencies: RouteDependencies,
): Promise<RouteDependencies["env"]> {
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
  dependencies: RouteDependencies,
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
  dependencies: RouteDependencies,
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
    // Injected fetches provide authenticated GraphQL fixtures in route tests.
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

function dashboardFromFeeds(
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
> {
  return {
    calendar: feedState(
      feeds.apple,
      now,
      config.intervals.calendar,
      applePart(feeds, "calendar") as DashboardData["calendar"]["data"],
    ),
    reminders: feedState(
      feeds.apple,
      now,
      config.intervals.reminders,
      applePart(feeds, "reminders") as DashboardData["reminders"]["data"],
    ),
    finance: feedState(feeds.money, now, config.intervals.finance),
    health: feedState(feeds.health, now, config.intervals.health),
    ai: feedState(feeds.bots, now, config.intervals.ai),
    systems: feedState(feeds.host, now, config.intervals.systems),
    habits: feedState(
      feeds.apple,
      now,
      config.intervals.habits,
      applePart(feeds, "habits") as DashboardData["habits"]["data"],
    ),
    goals: feedState(
      feeds.apple,
      now,
      config.intervals.goals,
      applePart(feeds, "goals") as DashboardData["goals"]["data"],
    ),
  };
}

async function dashboardFromLiveFeeds(
  dependencies: RouteDependencies,
): Promise<DashboardData> {
  const now = dependencies.now?.() ?? new Date();
  const env = await resolveEnv(dependencies);
  const incoming = await readKvFeeds(env?.FEEDS_KV);
  const feeds = mergeFeeds(null, incoming, now);

  const [weather, build] = await Promise.all([
    fetchWeatherState(dependencies, now, config.intervals.weather),
    fetchGitHubState(dependencies, now, config.intervals.build),
  ]);

  return {
    weather,
    ...dashboardFromFeeds(feeds, now),
    build,
  } as DashboardData;
}

export async function GET(
  request: Request,
  context?: { params?: Promise<unknown> } & Partial<RouteDependencies>
): Promise<Response> {
  try {
    const demo = new URL(request.url).searchParams.get("demo") === "true";
    const now = context?.now?.() ?? new Date();
    return Response.json(
      {
        data: demo
          ? await getDemoDashboard()
          : await dashboardFromLiveFeeds(context ?? {}),
        serverTime: now.toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error(JSON.stringify({ event: "dashboard_request_failed" }));
    return Response.json(
      { error: "Dashboard refresh unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
