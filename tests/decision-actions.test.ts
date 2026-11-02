import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTIONS_KEY,
  isSameOrigin,
  parseActions,
  recordChoice,
  summarize,
  undoChoice,
  type ActionsKv,
} from "../src/lib/decision-actions";

class FakeActionsKv implements ActionsKv {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

test("parseActions drops invalid payloads and malformed entries", () => {
  assert.deepEqual(parseActions("{"), []);
  assert.deepEqual(parseActions("{}"), []);
  assert.deepEqual(
    parseActions(
      JSON.stringify([{ decisionId: "d_synthetic", bot: "Synthetic Bot" }]),
    ),
    [],
  );
});

test("recordChoice stores an ISO chosen action and replaces the same decision", async () => {
  const kv = new FakeActionsKv();
  const firstNow = new Date("2026-11-02T15:19:00.000Z");
  const replacementNow = new Date("2026-11-02T15:20:00.000Z");

  const first = await recordChoice(
    kv,
    {
      decisionId: "d_synthetic_choice",
      bot: "Synthetic Bot",
      question: "Synthetic decision alpha?",
      choice: "yes",
      reply: "Synthetic reply alpha",
    },
    firstNow,
  );

  assert.equal(first.status, "chosen");
  assert.equal(first.ts, "2026-11-02T15:19:00.000Z");
  assert.match(
    first.ts,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );

  await recordChoice(
    kv,
    {
      decisionId: "d_synthetic_choice",
      bot: "Synthetic Bot",
      question: "Synthetic decision alpha?",
      choice: "no",
      reply: "Synthetic reply beta",
    },
    replacementNow,
  );

  const raw = kv.values.get(ACTIONS_KEY);
  assert.ok(raw);
  const actions = parseActions(raw);
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.decisionId, "d_synthetic_choice");
  assert.equal(actions[0]?.choice, "no");
  assert.equal(actions[0]?.reply, "Synthetic reply beta");
  assert.equal(actions[0]?.ts, "2026-11-02T15:20:00.000Z");
});

test("undoChoice marks a chosen action undone and returns null for unknown ids", async () => {
  const kv = new FakeActionsKv();
  const decisionId = "d_synthetic_undo";

  await recordChoice(
    kv,
    {
      decisionId,
      bot: "Synthetic Bot",
      question: "Synthetic decision undo?",
      choice: "later",
      reply: "",
    },
    new Date("2026-11-02T15:21:00.000Z"),
  );

  const undone = await undoChoice(
    kv,
    decisionId,
    new Date("2026-11-02T15:22:00.000Z"),
  );

  assert.ok(undone);
  assert.equal(undone.status, "undone");
  assert.equal(undone.undoneAt, "2026-11-02T15:22:00.000Z");

  const raw = kv.values.get(ACTIONS_KEY);
  assert.ok(raw);
  assert.deepEqual(
    parseActions(raw).map(({ decisionId: id, status, undoneAt }) => ({
      id,
      status,
      undoneAt,
    })),
    [
      {
        id: decisionId,
        status: "undone",
        undoneAt: "2026-11-02T15:22:00.000Z",
      },
    ],
  );

  assert.equal(
    await undoChoice(
      kv,
      "d_synthetic_unknown",
      new Date("2026-11-02T15:23:00.000Z"),
    ),
    null,
  );
});

test("summarize keeps the first sentence, caps long text, and preserves short text", () => {
  assert.equal(
    summarize(
      "Synthetic decision alpha. Synthetic decision beta. Synthetic decision gamma.",
    ),
    "Synthetic decision alpha.",
  );

  const longText = `Synthetic decision ${"alpha ".repeat(20).trim()}`;
  const capped = summarize(longText);
  assert.ok(capped.endsWith("…"));
  assert.ok(capped.length <= 91);

  const shortText = "Synthetic short decision";
  assert.equal(summarize(shortText), shortText);
});

test("isSameOrigin accepts matching and same-origin fetch requests only", () => {
  const url = "https://dash.example.test/api/decisions";

  assert.equal(
    isSameOrigin(
      new Request(url, {
        headers: { origin: "https://dash.example.test" },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOrigin(
      new Request(url, {
        headers: { origin: "https://foreign.example.test" },
      }),
    ),
    false,
  );
  assert.equal(
    isSameOrigin(
      new Request(url, {
        headers: { "sec-fetch-site": "same-origin" },
      }),
    ),
    true,
  );
  assert.equal(isSameOrigin(new Request(url)), false);
});
