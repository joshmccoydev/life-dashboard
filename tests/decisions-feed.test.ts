import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { GET } from "@/app/api/decisions/route";
import {
  FEED_DOMAINS,
  mergeFeeds,
} from "../src/lib/feed-store.ts";
import * as produceFeeds from "../scripts/produce-feeds.ts";

const NOW = new Date("2026-11-01T16:30:00.000Z");
const GENERATED_AT = "2026-11-01T16:30:00.000Z";
const UPDATED_AT = "2026-11-01T16:29:00.000Z";

type SyntheticCard = {
  id: string;
  source: string;
  bot: string;
  question: string;
  rec: string;
  context: string;
  link: string;
  createdAt: string | null;
  due: string | null;
  blocking: boolean;
  ageMin: number | null;
};

type SyntheticSnapshot = {
  generatedAt: string;
  count: number;
  cards: SyntheticCard[];
};

type DecisionsResult = {
  ok: boolean;
  data: SyntheticSnapshot | null;
  error?: string;
};

type BuildDecisions = (options: {
  vaultDir: string;
  remindersFile: string;
  now: Date;
}) => Promise<DecisionsResult>;

type DecisionsRouteDependencies = {
  env?: {
    FEEDS_KV?: {
      get(key: string): Promise<string | null>;
    };
  };
  snapshot?: () => Promise<SyntheticSnapshot>;
};

function syntheticCard(label: string): SyntheticCard {
  return {
    id: `fixture-${label}`,
    source: "reminders",
    bot: "analyst",
    question: `Synthetic decision ${label}?`,
    rec: "",
    context: "",
    link: "synthetic-reminders.md",
    createdAt: null,
    due: "2026-11-03",
    blocking: false,
    ageMin: null,
  };
}

function requireBuildDecisions(): BuildDecisions {
  const candidate = (
    produceFeeds as typeof produceFeeds & {
      buildDecisions?: BuildDecisions;
    }
  ).buildDecisions;

  assert.equal(
    typeof candidate,
    "function",
    "buildDecisions must be exported",
  );
  if (typeof candidate !== "function") {
    assert.fail("buildDecisions is missing");
  }
  return candidate;
}

function requireDecisionsLimit(): number {
  const candidate = (
    produceFeeds as typeof produceFeeds & {
      DECISIONS_LIMIT?: number;
    }
  ).DECISIONS_LIMIT;

  assert.equal(candidate, 50, "DECISIONS_LIMIT must be exported as 50");
  if (typeof candidate !== "number") {
    assert.fail("DECISIONS_LIMIT is missing");
  }
  return candidate;
}

async function temporaryDirectory(
  t: TestContext,
  prefix: string,
): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function restoreEnvironment(
  t: TestContext,
  keys: readonly string[],
): void {
  const original = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );

  t.after(() => {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test("FEED_DOMAINS includes decisions and mergeFeeds keeps a valid decisions entry", () => {
  assert.ok(
    (FEED_DOMAINS as readonly string[]).includes("decisions"),
    "decisions must be a supported feed domain",
  );

  const decisions = {
    data: {
      generatedAt: GENERATED_AT,
      count: 1,
      cards: [syntheticCard("merge")],
    },
    updatedAt: UPDATED_AT,
    stale: false,
    source: "box" as const,
  };
  const merged = mergeFeeds(null, { decisions }, NOW);

  assert.deepEqual(merged.decisions, decisions);
});

test("buildDecisions returns synthetic reminder cards capped at DECISIONS_LIMIT", async (t) => {
  const vaultDir = await temporaryDirectory(t, "decisions-feed-build-");
  const remindersFile = path.join(vaultDir, "reminders-queue.md");
  const reminderLines = Array.from({ length: 57 }, (_, index) => {
    const label = String(index + 1).padStart(2, "0");
    return `- [ ] synthetic ${label} | analyst: Synthetic decision ${label}? | due 2026-11-03 | done when reviewed`;
  });

  await writeFile(
    remindersFile,
    ["## Queue", ...reminderLines, ""].join("\n"),
    "utf8",
  );

  const limit = requireDecisionsLimit();
  const buildDecisions = requireBuildDecisions();
  const result = await buildDecisions({
    vaultDir,
    remindersFile,
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.ok(result.data, "a successful result must include snapshot data");
  assert.equal(result.data.cards.length, limit);
  assert.equal(result.data.count, limit);
  assert.equal(result.data.generatedAt, GENERATED_AT);
});

test("buildDecisions tolerates a missing synthetic vault", async (t) => {
  const parent = await temporaryDirectory(t, "decisions-feed-missing-");
  const vaultDir = path.join(parent, "does-not-exist");
  const buildDecisions = requireBuildDecisions();
  const result = await buildDecisions({
    vaultDir,
    remindersFile: path.join(vaultDir, "missing-reminders.md"),
    now: NOW,
  });

  assert.equal(typeof result.ok, "boolean");
  if (result.ok) {
    assert.deepEqual(result.data?.cards, []);
    assert.equal(result.data?.count, 0);
  } else {
    assert.equal(result.data, null);
    assert.equal(typeof result.error, "string");
  }
});

test("decisions GET returns the KV decisions snapshot when disk has no cards", async (t) => {
  const vaultDir = await temporaryDirectory(t, "decisions-feed-route-");
  restoreEnvironment(t, [
    "DECISIONS_VAULT",
    "DECISIONS_REMINDERS",
    "DECISIONS_TOKEN",
  ]);
  process.env.DECISIONS_VAULT = vaultDir;
  process.env.DECISIONS_REMINDERS = path.join(
    vaultDir,
    "missing-reminders.md",
  );
  process.env.DECISIONS_TOKEN = "synthetic-decisions-token";

  const kvSnapshot = {
    generatedAt: GENERATED_AT,
    count: 2,
    cards: [syntheticCard("one"), syntheticCard("two")],
  };
  const feeds = {
    decisions: {
      data: kvSnapshot,
      updatedAt: UPDATED_AT,
      stale: false,
      source: "box",
    },
  };
  const context: DecisionsRouteDependencies = {
    snapshot: async () => ({
      generatedAt: GENERATED_AT,
      count: 0,
      cards: [],
    }),
    env: {
      FEEDS_KV: {
        async get(): Promise<string | null> {
          return JSON.stringify(feeds);
        },
      },
    },
  };
  const get = GET as unknown as (
    request: Request,
    context?: DecisionsRouteDependencies,
  ) => Promise<Response>;

  const response = await get(
    new Request(
      "https://example.test/api/decisions?t=synthetic-decisions-token",
    ),
    context,
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as SyntheticSnapshot;
  assert.deepEqual(body.cards, [syntheticCard("one"), syntheticCard("two")]);
  assert.equal(body.count, 2);
});

test("decisions GET without a token returns 401", async (t) => {
  restoreEnvironment(t, ["DECISIONS_TOKEN"]);
  process.env.DECISIONS_TOKEN = "synthetic-decisions-token";

  const response = await GET(
    new Request("https://example.test/api/decisions"),
  );

  assert.equal(response.status, 401);
});
