import test from "node:test";
import assert from "node:assert/strict";
import * as feeds from "../src/adapters/feeds.ts";

type FeedAdapter = {
  fetch?: unknown;
};

function hasAdapterFor(domain: "money" | "health"): boolean {
  return Object.entries(feeds).some(([name, value]) => {
    if (!name.toLowerCase().includes(domain)) return false;
    if (typeof value === "function") return true;
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as FeedAdapter).fetch === "function"
    );
  });
}

test("feeds module exports a money adapter", () => {
  assert.equal(hasAdapterFor("money"), true);
});

test("feeds module exports a health adapter", () => {
  assert.equal(hasAdapterFor("health"), true);
});
