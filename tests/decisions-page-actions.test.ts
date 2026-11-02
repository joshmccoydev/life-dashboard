import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";

import { DecisionsPageContent } from "../src/app/decisions/page";

const GENERATED_AT = "2026-11-01T16:30:00.000Z";
const FIRST_SENTENCE =
  "Synthetic decision alpha should update the routing notes for tomorrow.";
const QUESTION =
  `${FIRST_SENTENCE} The second synthetic sentence asks whether the dashboard ` +
  "should show the complete explanation. The third synthetic sentence records " +
  "the remaining review context.";
const CARD = {
  id: "d_syntheticactions",
  source: "decisions",
  bot: "analyst",
  question: QUESTION,
  rec: "Use the synthetic fixture.",
  context: "Synthetic context only.",
  link: "03 Resources/_Meta/Decisions.md",
  createdAt: "2026-11-01T16:20:00.000Z",
  due: null,
  blocking: false,
  ageMin: 10,
};

function actionPayload(status: "chosen" | "undone"): string {
  return JSON.stringify([
    {
      decisionId: CARD.id,
      bot: CARD.bot,
      question: CARD.question,
      choice: "yes",
      reply: "",
      ts: "2026-11-01T16:29:00.000Z",
      status,
      ...(status === "undone"
        ? { undoneAt: "2026-11-01T16:30:00.000Z" }
        : {}),
    },
  ]);
}

test("decision card shows its first sentence, full details, and choice buttons", async () => {
  const html = renderToString(
    await DecisionsPageContent({
      verify: async () => ({ ok: true }),
      snapshot: async () => ({
        generatedAt: GENERATED_AT,
        count: 1,
        cards: [CARD],
      }),
      env: {
        FEEDS_KV: {
          async get(): Promise<string | null> {
            return null;
          },
        },
      },
    }),
  );

  assert.ok(html.includes(FIRST_SENTENCE));
  const details = html.match(/<details[^>]*>[\s\S]*?<\/details>/);
  assert.ok(details);
  assert.match(details[0], /<summary[^>]*>more<\/summary>/);
  assert.ok(details[0].includes(QUESTION));
  assert.match(
    html,
    /<button(?=[^>]*name="choice")(?=[^>]*value="yes")[^>]*>yes<\/button>/,
  );
});

test("chosen decision shows its choice and undo button instead of choice buttons", async () => {
  const html = renderToString(
    await DecisionsPageContent({
      verify: async () => ({ ok: true }),
      snapshot: async () => ({
        generatedAt: GENERATED_AT,
        count: 1,
        cards: [CARD],
      }),
      env: {
        FEEDS_KV: {
          async get(key: string): Promise<string | null> {
            return key === "decision-actions" ? actionPayload("chosen") : null;
          },
        },
      },
    }),
  );

  assert.match(html, /chosen: yes/);
  assert.match(
    html,
    /<button(?=[^>]*name="choice")(?=[^>]*value="undo")[^>]*>undo<\/button>/,
  );
  assert.doesNotMatch(html, /value="yes"/);
});

test("undone decision restores the choice buttons", async () => {
  const html = renderToString(
    await DecisionsPageContent({
      verify: async () => ({ ok: true }),
      snapshot: async () => ({
        generatedAt: GENERATED_AT,
        count: 1,
        cards: [CARD],
      }),
      env: {
        FEEDS_KV: {
          async get(key: string): Promise<string | null> {
            return key === "decision-actions" ? actionPayload("undone") : null;
          },
        },
      },
    }),
  );

  assert.doesNotMatch(html, /chosen: yes/);
  assert.doesNotMatch(html, /value="undo"/);
  for (const choice of ["yes", "no", "later", "reply"]) {
    assert.match(
      html,
      new RegExp(
        `<button(?=[^>]*name="choice")(?=[^>]*value="${choice}")[^>]*>${choice}</button>`,
      ),
    );
  }
});
