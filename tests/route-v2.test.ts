import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../src/app/api/dashboard/route";

const FIXED = "2026-11-01T16:30:00.000Z";
const RECENT = "2026-11-01T16:25:00.000Z";

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

type InvokeRoute = (
  request: Request,
  dependencies?: RouteDependencies,
) => Promise<Response>;

const invokeRoute = GET as unknown as InvokeRoute;

const weatherPayload = {
  current: {
    temperature_2m: 63.4,
    apparent_temperature: 61.2,
    weather_code: 3,
    is_day: 1,
  },
  daily: {
    temperature_2m_max: [68.2],
    temperature_2m_min: [52.1],
  },
};

const githubGraphqlPayload = {
  data: {
    user: {
      login: "synthetic-dev",
      pullRequests: { totalCount: 4 },
      contributionsCollection: {
        totalCommitContributions: 11,
        commitContributionsByRepository: [
          {
            repository: { nameWithOwner: "synthetic/life-dash" },
            contributions: { totalCount: 7 },
          },
          {
            repository: { nameWithOwner: "synthetic/home" },
            contributions: { totalCount: 4 },
          },
        ],
      },
      repositories: {
        nodes: [{ pushedAt: "2026-11-01T16:20:00.000Z" }],
      },
    },
  },
};

const githubCommitsPayload = {
  total_count: 2,
  incomplete_results: false,
  items: [
    {
      sha: "a1",
      repository: { full_name: "synthetic/life-dash" },
      commit: { committer: { date: "2026-11-01T16:20:00.000Z" } },
    },
    {
      sha: "a2",
      repository: { full_name: "synthetic/life-dash" },
      commit: { committer: { date: "2026-11-01T16:21:00.000Z" } },
    },
  ],
};

const githubPrsPayload = {
  total_count: 3,
  incomplete_results: false,
  items: [],
};

const host = {
  machine: {
    id: "cloud-host",
    name: "KV telemetry host",
    status: "online",
    latencyMs: 12,
    uptimeSeconds: 987654,
    cpuPercent: 17,
    memoryPercent: 29,
    diskPercent: 43,
    detail: "Synthetic Cloudflare KV reading",
  },
  endpoints: [
    {
      id: "service-kv",
      name: "KV service",
      status: "online",
      latencyMs: 23,
      uptimeSeconds: null,
      cpuPercent: null,
      memoryPercent: null,
      diskPercent: null,
      detail: "HTTP 200",
    },
  ],
};

const finance = {
  checking: 2345,
  savings: 6789,
  emergencyFund: 1000,
  emergencyTarget: 5000,
  payday: "2026-11-06T15:00:00.000Z",
  spending: 321,
  spendingBudget: 900,
  investments: 4567,
  investmentChange: 12,
  bills: [],
};

const health = {
  date: "2026-11-01",
  steps: 6543,
  stepGoal: 10000,
  sleepMinutes: 451,
  activityPercent: 66,
  exerciseMinutes: 31,
  exerciseGoal: 30,
  standHours: 9,
  standGoal: 12,
  workout: null,
};

const ai = {
  providers: [
    {
      name: "Synthetic bot",
      status: "running",
      remainingPercent: 77,
      requestsToday: 8,
      tokensToday: 1200,
      costToday: 0.42,
      jobsCompleted: 2,
      errors: 0,
    },
  ],
};

const apple = {
  calendar: {
    events: [
      {
        id: "event-kv",
        title: "Synthetic KV event",
        start: "2026-11-01T18:00:00.000Z",
        end: "2026-11-01T18:30:00.000Z",
        calendar: "personal",
      },
    ],
  },
  reminders: {
    items: [
      {
        id: "reminder-kv",
        title: "Synthetic reminder",
        due: null,
        completed: false,
      },
    ],
  },
  habits: {
    date: "2026-11-01",
    habits: [
      {
        id: "habit-kv",
        title: "Synthetic habit",
        trackingMethod: "custom",
        occurrences: [
          { date: "2026-11-01", completed: true, completedAt: RECENT },
        ],
      },
    ],
  },
  goals: {
    goals: [{ title: "Synthetic goal", current: 2, target: 5 }],
    projects: [
      {
        name: "Synthetic project",
        detail: "KV-backed project",
        progress: 40,
      },
    ],
  },
};

const feedEntries = {
  bots: { data: ai, updatedAt: RECENT, stale: false, source: "box" },
  money: { data: finance, updatedAt: RECENT, stale: false, source: "box" },
  health: { data: health, updatedAt: RECENT, stale: false, source: "box" },
  host: { data: host, updatedAt: RECENT, stale: false, source: "mac" },
  apple: { data: apple, updatedAt: RECENT, stale: false, source: "mac" },
} as const;

function fakeKv(value: unknown): KvBinding & { requestedKeys: string[] } {
  const requestedKeys: string[] = [];
  return {
    requestedKeys,
    async get(key) {
      requestedKeys.push(key);
      return JSON.stringify(value);
    },
  };
}

function fakeFetch(calls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push(url);

    if (url.startsWith("https://api.open-meteo.com/")) {
      return Response.json(weatherPayload);
    }
    if (url === "https://api.github.com/graphql") {
      return Response.json(githubGraphqlPayload);
    }
    if (url.startsWith("https://api.github.com/search/commits")) {
      return Response.json(githubCommitsPayload);
    }
    if (url.startsWith("https://api.github.com/search/issues")) {
      return Response.json(githubPrsPayload);
    }
    throw new Error(`Unexpected synthetic fetch: ${url}`);
  }) as typeof fetch;
}

async function withFetch<T>(
  fetchImpl: typeof fetch,
  run: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("combines live weather and GitHub with merged Cloudflare KV feeds", async () => {
  const kv = fakeKv(feedEntries);
  const fetchCalls: string[] = [];
  const fetchImpl = fakeFetch(fetchCalls);
  let contextCalls = 0;

  const response = await withFetch(fetchImpl, () =>
    invokeRoute(new Request("https://dashboard.test/api/dashboard"), {
      env: { FEEDS_KV: kv },
      fetchImpl,
      now: () => new Date(FIXED),
      getCloudflareContext: () => {
        contextCalls += 1;
        throw new Error("injected environment should bypass context lookup");
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(contextCalls, 0);
  assert.deepEqual(kv.requestedKeys, ["feeds"]);
  assert.ok(
    fetchCalls.some((url) => url.startsWith("https://api.open-meteo.com/")),
    "the route did not request live weather",
  );
  assert.ok(
    fetchCalls.some((url) => url.startsWith("https://api.github.com/")),
    "the route did not request live GitHub data",
  );

  const payload = (await response.json()) as {
    data: Record<string, { data: unknown; lastSuccess: string | null }>;
  };
  assert.equal(
    (payload.data.weather.data as { temperature: number }).temperature,
    63,
  );
  assert.deepEqual(payload.data.build.data, {
    scope: "authenticated",
    username: "synthetic-dev",
    commitsToday: 11,
    activeRepos: 2,
    openPRs: 4,
    lastActivity: "2026-11-01T16:20:00.000Z",
    repositories: [
      { name: "synthetic/life-dash", commits: 7 },
      { name: "synthetic/home", commits: 4 },
    ],
  });
  assert.deepEqual(payload.data.finance.data, finance);
  assert.deepEqual(payload.data.health.data, health);
  assert.deepEqual(payload.data.ai.data, ai);
  assert.deepEqual(payload.data.calendar.data, apple.calendar);
  assert.deepEqual(payload.data.reminders.data, apple.reminders);
  assert.deepEqual(payload.data.habits.data, apple.habits);
  assert.deepEqual(payload.data.goals.data, apple.goals);
});

test("host telemetry comes from the merged KV feed", async () => {
  const kv = fakeKv(feedEntries);
  const fetchImpl = fakeFetch([]);

  const response = await withFetch(fetchImpl, () =>
    invokeRoute(new Request("https://dashboard.test/api/dashboard"), {
      env: { FEEDS_KV: kv },
      fetchImpl,
      now: () => new Date(FIXED),
    }),
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: {
      systems: {
        data: unknown;
        lastSuccess: string | null;
        status: string;
      };
    };
  };
  assert.deepEqual(payload.data.systems.data, host);
  assert.equal(payload.data.systems.lastSuccess, RECENT);
  assert.equal(payload.data.systems.status, "ready");
});

test("falls back safely when Cloudflare context is unavailable", async () => {
  const fetchImpl = fakeFetch([]);
  let contextCalls = 0;

  const response = await withFetch(fetchImpl, () =>
    invokeRoute(new Request("https://dashboard.test/api/dashboard"), {
      fetchImpl,
      now: () => new Date(FIXED),
      getCloudflareContext: () => {
        contextCalls += 1;
        throw new Error("not running inside a Cloudflare Worker");
      },
    }),
  );

  assert.equal(contextCalls, 1);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: {
      weather: { data: { temperature: number } | null };
      build: { data: { username: string } | null };
    };
  };
  assert.equal(payload.data.weather.data?.temperature, 63);
  assert.equal(payload.data.build.data?.username, "synthetic-dev");
});
