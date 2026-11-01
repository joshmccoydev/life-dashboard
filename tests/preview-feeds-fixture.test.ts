import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeFeeds } from "../src/lib/feed-store.ts";
import { normalizeMoney, normalizeHealth } from "../src/adapters/feeds.ts";

type Domain = "bots" | "money" | "health" | "host" | "apple";

type PreviewFeeds = Record<
  Domain,
  {
    data: unknown;
    updatedAt: string;
    source: "box" | "mac";
  }
>;

const fixtureUrl = new URL("./fixtures/preview-feeds.json", import.meta.url);
const parsed = JSON.parse(readFileSync(fixtureUrl, "utf8")) as PreviewFeeds;

test("preview feeds fixture satisfies the dashboard feed contracts", () => {
  const merged = mergeFeeds(
    null,
    parsed,
    new Date(Date.parse(parsed.bots.updatedAt)),
  );
  const domains: Domain[] = ["bots", "money", "health", "host", "apple"];

  for (const domain of domains) {
    assert.notEqual(merged[domain].data, null, `${domain} data`);
  }

  for (const domain of ["bots", "money", "host"] as const) {
    assert.equal(merged[domain].source, "box", `${domain} source`);
  }

  for (const domain of ["health", "apple"] as const) {
    assert.equal(merged[domain].source, "mac", `${domain} source`);
  }

  assert.ok(Array.isArray(merged.bots.data), "bots data is an array");
  for (const bot of merged.bots.data) {
    assert.equal(typeof bot, "object", "each bot entry is an object");
    assert.notEqual(bot, null, "each bot entry is non-null");
    assert.equal(
      typeof (bot as Record<string, unknown>).bot,
      "string",
      "each bot entry has a string bot name",
    );
  }

  assert.doesNotThrow(() => normalizeMoney(parsed.money.data));
  assert.doesNotThrow(() => normalizeHealth(parsed.health.data));

  const serialized = JSON.stringify(parsed);
  assert.match(serialized, /\bfixture\b/i);
  assert.ok(!serialized.includes("@"), "fixture contains no email addresses");
});
