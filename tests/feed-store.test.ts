import test from "node:test";
import assert from "node:assert/strict";
import { mergeFeeds, readKvFeeds } from "../src/lib/feed-store.ts";

const DOMAINS = [
  "bots",
  "money",
  "health",
  "host",
  "apple",
  "decisions",
  "usage",
  "weather",
  "build",
] as const;
const NOW = new Date("2026-11-01T16:30:00.000Z");
const RECENT = "2026-11-01T16:20:00.000Z";
const OLDER_THAN_THIRTY_MINUTES = "2026-11-01T15:59:59.999Z";
const EXACTLY_TWENTY_FOUR_HOURS_OLD = "2026-10-31T16:30:00.000Z";
const TWENTY_THREE_HOURS_OLD = "2026-10-31T17:30:00.000Z";
const OLDER_THAN_TWENTY_FOUR_HOURS = "2026-10-31T16:29:59.999Z";

type Domain = (typeof DOMAINS)[number];
type Source = "box" | "mac";

function feedEntry(
  label: string,
  updatedAt: string = RECENT,
  source: Source = "mac",
) {
  return {
    data: { fixture: `${label}-data` },
    updatedAt,
    stale: false,
    source,
  };
}

function feeds(
  label: string,
  updatedAt: string = RECENT,
): Record<Domain, ReturnType<typeof feedEntry>> {
  return Object.fromEntries(
    DOMAINS.map((domain, index) => [
      domain,
      feedEntry(`${label}-${domain}`, updatedAt, index % 2 ? "box" : "mac"),
    ]),
  ) as Record<Domain, ReturnType<typeof feedEntry>>;
}

test("merges valid incoming entries for every supported domain", () => {
  const incoming = feeds("incoming");
  const merged = mergeFeeds(null, incoming, NOW);

  for (const domain of DOMAINS) {
    assert.deepEqual(merged[domain], incoming[domain]);
  }
});

test("marks only entries older than 24 hours as stale", () => {
  const atBoundary = feeds("boundary", EXACTLY_TWENTY_FOUR_HOURS_OLD);
  const twentyThreeHoursOld = feeds("twenty-three-hours-old", TWENTY_THREE_HOURS_OLD);
  const older = feeds("older", OLDER_THAN_TWENTY_FOUR_HOURS);

  const boundaryResult = mergeFeeds(null, atBoundary, NOW);
  const twentyThreeHoursOldResult = mergeFeeds(null, twentyThreeHoursOld, NOW);
  const olderResult = mergeFeeds(null, older, NOW);

  for (const domain of DOMAINS) {
    assert.equal(boundaryResult[domain].stale, false, domain);
    assert.equal(twentyThreeHoursOldResult[domain].stale, false, domain);
    assert.equal(olderResult[domain].stale, true, domain);
  }
});

test("uses valid incoming entries and retains the previous copy per domain", () => {
  const previous = feeds("previous", OLDER_THAN_THIRTY_MINUTES);
  const freshBots = feedEntry("fresh-bots", RECENT, "mac");
  const freshApple = feedEntry("fresh-apple", RECENT, "box");
  const invalidIncoming = {
    bots: freshBots,
    money: null,
    health: { data: { fixture: "missing timestamp" }, source: "mac" },
    host: {
      data: { fixture: "invalid source" },
      updatedAt: RECENT,
      source: "web",
    },
    apple: freshApple,
  };

  const merged = mergeFeeds(previous, invalidIncoming, NOW);

  assert.deepEqual(merged.bots, freshBots);
  assert.deepEqual(merged.apple, freshApple);
  for (const domain of ["money", "health", "host"] as const) {
    assert.deepEqual(merged[domain], previous[domain]);
  }
});

test("readKvFeeds returns null without a binding or stored value", async () => {
  assert.equal(await readKvFeeds(undefined), null);
  assert.equal(
    await readKvFeeds({
      async get() {
        return null;
      },
    }),
    null,
  );
});

test("readKvFeeds returns parsed JSON from the binding", async () => {
  const stored = feeds("kv");
  let requestedKey: string | undefined;
  const result = await readKvFeeds({
    async get(key) {
      requestedKey = key;
      return JSON.stringify(stored);
    },
  });

  assert.equal(typeof requestedKey, "string");
  assert.deepEqual(result, stored);
});

test("readKvFeeds returns null when stored JSON cannot be parsed", async () => {
  const result = await readKvFeeds({
    async get() {
      return "{not-json";
    },
  });

  assert.equal(result, null);
});
