import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";

import {
  DecisionsPageContent,
  type DecisionsPageDependencies,
} from "../src/app/decisions/page";
import type { Snapshot, SnapshotCard } from "../src/lib/decisions";

const NOW = new Date("2026-11-01T16:30:00.000Z");
const GENERATED_AT = "2026-11-01T16:30:00.000Z";
const UPDATED_AT = "2026-11-01T16:29:00.000Z";

function syntheticCard(title: string): SnapshotCard {
  return {
    id: `fixture-${title.toLowerCase().replaceAll(" ", "-")}`,
    source: "reminders",
    bot: "analyst",
    question: title,
    rec: "",
    context: "",
    link: "synthetic-reminders.md",
    createdAt: null,
    due: "2026-11-03",
    blocking: false,
    ageMin: null,
  };
}

function emptySnapshot(): Snapshot {
  return {
    generatedAt: GENERATED_AT,
    count: 0,
    cards: [],
  };
}

function kvPayload(snapshot: Snapshot): string {
  return JSON.stringify({
    decisions: {
      data: snapshot,
      updatedAt: UPDATED_AT,
      stale: false,
      source: "box",
    },
  });
}

async function renderPage(
  dependencies: DecisionsPageDependencies,
): Promise<string> {
  return renderToString(await DecisionsPageContent(dependencies));
}

test("verified page uses the KV decisions snapshot when disk is empty", async () => {
  const alpha = syntheticCard("Synthetic decision alpha");
  const beta = syntheticCard("Synthetic decision beta");
  const kvSnapshot: Snapshot = {
    generatedAt: GENERATED_AT,
    count: 2,
    cards: [alpha, beta],
  };

  const html = await renderPage({
    accessJwt: "synthetic-access-jwt",
    verify: async () => ({ ok: true }),
    snapshot: async () => emptySnapshot(),
    env: {
      FEEDS_KV: {
        async get(key: string): Promise<string | null> {
          assert.equal(key, "feeds");
          return kvPayload(kvSnapshot);
        },
      },
    },
    now: NOW,
  });

  assert.match(html, /Synthetic decision alpha/);
  assert.match(html, /Synthetic decision beta/);
  assert.doesNotMatch(html, /no decisions waiting/);
});

test("disk decisions win over the KV snapshot", async () => {
  const diskCard = syntheticCard("Synthetic decision from disk");
  const diskSnapshot: Snapshot = {
    generatedAt: GENERATED_AT,
    count: 1,
    cards: [diskCard],
  };
  const kvSnapshot: Snapshot = {
    generatedAt: GENERATED_AT,
    count: 1,
    cards: [syntheticCard("Synthetic decision from KV")],
  };

  const html = await renderPage({
    accessJwt: "synthetic-access-jwt",
    verify: async () => ({ ok: true }),
    snapshot: async () => diskSnapshot,
    env: {
      FEEDS_KV: {
        async get(key: string): Promise<string | null> {
          assert.equal(key, "feeds");
          assert.fail("KV must not be read when disk has decisions");
        },
      },
    },
    now: NOW,
  });

  assert.match(html, /Synthetic decision from disk/);
  assert.doesNotMatch(html, /Synthetic decision from KV/);
});

test("KV read failures render the disk empty state", async () => {
  const html = await renderPage({
    accessJwt: "synthetic-access-jwt",
    verify: async () => ({ ok: true }),
    snapshot: async () => emptySnapshot(),
    env: {
      FEEDS_KV: {
        async get(key: string): Promise<string | null> {
          assert.equal(key, "feeds");
          throw new Error("synthetic KV failure");
        },
      },
    },
    now: NOW,
  });

  assert.match(html, /no decisions waiting/);
});

test("failed access verification renders unauthorized", async () => {
  const html = await renderPage({
    accessJwt: "synthetic-access-jwt",
    verify: async () => ({ ok: false }),
    snapshot: async () => emptySnapshot(),
    now: NOW,
  });

  assert.equal(html, "unauthorized");
});
