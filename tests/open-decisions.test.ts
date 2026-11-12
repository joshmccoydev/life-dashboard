import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  OPEN_DECISIONS_HOME_LIMIT,
  OPEN_DECISIONS_PATH,
  openDecisionsToFeed,
  parseOpenDecisions,
  readOpenDecisions,
} from "../src/lib/open-decisions.ts";

test("parseOpenDecisions keeps file order and drops incomplete rows", () => {
  const parsed = parseOpenDecisions({
    as_of: "2026-11-12T10:51:00-06:00",
    items: [
      {
        id: "lease-first-month",
        title: "Confirm the lease first month",
        owner_bot: "Ledger",
        asked_on: "2026-11-12",
        why_open: "Due today.",
      },
      { id: "missing-title", owner_bot: "Forge" },
      {
        id: "lease-appointment",
        title: "Pick a lease signing and move window",
        owner_bot: "Mailroom",
        asked_on: "2026-11-12",
        why_open: "Due Nov 13.",
      },
    ],
  });
  assert.ok(parsed);
  assert.equal(parsed.as_of, "2026-11-12T10:51:00-06:00");
  assert.deepEqual(
    parsed.items.map((item) => item.id),
    ["lease-first-month", "lease-appointment"],
  );
});

test("parseOpenDecisions rejects a missing as_of or items", () => {
  assert.equal(parseOpenDecisions({ items: [] }), null);
  assert.equal(parseOpenDecisions({ as_of: "2026-11-12T10:51:00-06:00" }), null);
  assert.equal(parseOpenDecisions(null), null);
});

test("openDecisionsToFeed maps owner_bot and title, never stockpile fields", () => {
  const feed = openDecisionsToFeed({
    as_of: "2026-11-12T10:51:00-06:00",
    items: [
      {
        id: "lease-first-month",
        title: "Confirm the lease first month (and any deposit) before any money move",
        owner_bot: "Ledger",
        asked_on: "2026-11-12",
        why_open: "First month is likely due today.",
      },
    ],
  });
  assert.equal(feed.generatedAt, "2026-11-12T10:51:00-06:00");
  assert.equal(feed.count, 1);
  assert.equal(feed.cards[0].bot, "Ledger");
  assert.match(feed.cards[0].question ?? "", /lease first month/);
  assert.equal(feed.cards[0].source, "box:open-decisions");
});

test("Archive's on-disk list is 10 items, most urgent first, and home uses 5", () => {
  const file = readOpenDecisions((path) => readFileSync(path, "utf8"));
  assert.ok(file);
  assert.equal(file.as_of, "2026-11-12T10:51:00-06:00");
  assert.equal(file.items.length, 10);
  assert.equal(file.items[0].id, "lease-first-month");
  assert.equal(file.items[4].id, "piba-venue-question");
  assert.equal(OPEN_DECISIONS_HOME_LIMIT, 5);
  const home = file.items.slice(0, OPEN_DECISIONS_HOME_LIMIT);
  assert.deepEqual(
    home.map((item) => item.id),
    [
      "lease-first-month",
      "lease-appointment",
      "chamber-awards-gala",
      "lozano-shifts",
      "piba-venue-question",
    ],
  );
  // The sixth item must not be in the home five.
  assert.equal(home.some((item) => item.id === "trueaccord-dispute"), false);
});

test("a missing open-decisions file is null, not a Decisions.md fallback", () => {
  const missing = readOpenDecisions((path) => {
    const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }, "/synthetic/missing.json");
  assert.equal(missing, null);
});

test("the on-disk path is the Archive export, not Decisions.md", () => {
  assert.equal(
    OPEN_DECISIONS_PATH,
    "/workspace/exports/life-dash/open-decisions.json",
  );
  assert.doesNotMatch(OPEN_DECISIONS_PATH, /Decisions\.md/);
});
