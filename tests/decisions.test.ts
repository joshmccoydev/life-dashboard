import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const M: any = await import(["..", "src", "lib", "decisions.ts"].join("/"));

const NOW = new Date("2026-11-01T17:00:00.000Z");
const DECISIONS_PATH = "03 Resources/_Meta/Decisions.md";
const STATUS_PATH = "00 Home/Bots/Status.md";
const REMINDERS_PATH = "00 Home/Bots/Reminders.md";
const CARD_KEYS = [
  "blocking",
  "bot",
  "context",
  "createdAt",
  "due",
  "id",
  "link",
  "question",
  "rec",
  "source",
];

type Card = {
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
};

function makeCard(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    source: "ask",
    bot: "Woz",
    question: "Question?",
    rec: "",
    context: "",
    link: "",
    createdAt: null,
    due: null,
    blocking: false,
    ...overrides,
  };
}

function assertCardShape(card: Card): void {
  assert.deepEqual(Object.keys(card).sort(), CARD_KEYS);
  assert.match(card.id, /^d_[0-9a-f]{12}$/);
  assert.ok(card.context.length <= 300);
}

async function temporaryDirectory(t: TestContext, prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function writeVaultFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

test("parseAskLine parses checkbox and checkboxless ASK cards", () => {
  const raw =
    "- [ ] [ASK] 2026-11-01 09:30 CT | owner: Woz | blocking: yes | due: 2026-11-03 | q: Merge PR 2? | rec: yes | ctx: tests green | link: https://example.com/pr/2";
  const card = M.parseAskLine(raw, "ask") as Card;

  assert.deepEqual(card, {
    id: "d_db47878051bb",
    source: "ask",
    bot: "Woz",
    question: "Merge PR 2?",
    rec: "yes",
    context: "tests green",
    link: "https://example.com/pr/2",
    createdAt: "2026-11-01T15:30:00.000Z",
    due: "2026-11-03",
    blocking: true,
  });
  assertCardShape(card);

  const withoutCheckbox =
    "- [ASK] 2026-11-01 09:30 CT | owner: Woz | q: Merge PR 2? | due: none";
  assert.deepEqual(M.parseAskLine(withoutCheckbox, "ask"), {
    id: "d_69ef4833ab52",
    source: "ask",
    bot: "Woz",
    question: "Merge PR 2?",
    rec: "",
    context: "",
    link: "",
    createdAt: "2026-11-01T15:30:00.000Z",
    due: null,
    blocking: false,
  });
});

test("parseAskLine rejects non-ASK and checked lines", () => {
  assert.equal(
    M.parseAskLine(
      "- [ ] 2026-11-01 09:30 CT | owner: Woz | q: Legacy?",
      "ask",
    ),
    null,
  );
  assert.equal(
    M.parseAskLine(
      "- [x] [ASK] 2026-11-01 09:30 CT | owner: Woz | q: Merge PR 2?",
      "ask",
    ),
    null,
  );
});

test("parseAskLine keeps context at or below 300 characters", () => {
  const raw = `- [ASK] 2026-11-01 09:30 CT | owner: Woz | q: Long? | ctx: ${"x".repeat(320)}`;
  const card = M.parseAskLine(raw, "ask") as Card;
  assert.equal(card.context.length, 300);
});

test("parseDecisions combines current ASK rows and legacy unchecked rows", () => {
  const text = [
    "# Decisions",
    "- [ ] [ASK] 2026-11-01 10:00 CT | owner: Woz | q: Ship it? | rec: yes | ctx: ready | link: https://example.com/ship",
    "- [ ] 2026-11-01 10:07 CT | owner: Don | rest",
    '- [ ] 2026-11-01 10:04 CT | from: Alfred | owner: Woz, Elon | "quoted" | affects: x',
    "- [x] [ASK] 2026-11-01 10:00 CT | owner: Don | q: Already done?",
    "- [x] 2026-11-01 09:00 CT | owner: Alfred | old",
  ].join("\n");

  const cards = M.parseDecisions(text, DECISIONS_PATH) as Card[];
  assert.equal(cards.length, 3);
  for (const card of cards) assertCardShape(card);

  assert.deepEqual(
    cards.map(({ id: _id, ...card }) => card),
    [
      {
        source: "decisions",
        bot: "Woz",
        question: "Ship it?",
        rec: "yes",
        context: "ready",
        link: "https://example.com/ship",
        createdAt: "2026-11-01T16:00:00.000Z",
        due: null,
        blocking: false,
      },
      {
        source: "decisions",
        bot: "Don",
        question: "rest",
        rec: "",
        context: "",
        link: DECISIONS_PATH,
        createdAt: "2026-11-01T16:07:00.000Z",
        due: null,
        blocking: false,
      },
      {
        source: "decisions",
        bot: "Woz",
        question: '"quoted" | affects: x',
        rec: "",
        context: "",
        link: DECISIONS_PATH,
        createdAt: "2026-11-01T16:04:00.000Z",
        due: null,
        blocking: false,
      },
    ],
  );
  assert.equal(new Set(cards.map((card) => card.id)).size, 3);
});

test("parseStatus reads needs_josh and ASK rows while filtering empty answers", () => {
  const text = [
    "## Woz",
    "updated: 2026-11-01 9:30 AM CT",
    "needs_josh: Review deploy?",
    "",
    "## Elon",
    "updated: 2026-11-01 10:00 CT",
    "needs_josh: NoNe yet",
    "",
    "## Alfred",
    "needs_josh: NOTHING planned",
    "",
    "## Don",
    "needs_josh: n/a",
    "",
    "- [ASK] 2026-10-31 10:00 CT | owner: Don | q: October follow-up?",
  ].join("\n");

  const cards = M.parseStatus(text, STATUS_PATH) as Card[];
  assert.equal(cards.length, 2);
  for (const card of cards) assertCardShape(card);

  const { id: _statusId, ...status } = cards[0];
  assert.deepEqual(status, {
    source: "status",
    bot: "Woz",
    question: "Review deploy?",
    rec: "",
    context: "",
    link: STATUS_PATH,
    createdAt: "2026-11-01T14:30:00.000Z",
    due: null,
    blocking: false,
  });

  const { id: _askId, ...ask } = cards[1];
  assert.deepEqual(ask, {
    source: "status",
    bot: "Don",
    question: "October follow-up?",
    rec: "",
    context: "",
    link: "",
    createdAt: "2026-10-31T15:00:00.000Z",
    due: null,
    blocking: false,
  });

  const [withoutUpdated] = M.parseStatus(
    "## Woz\nneeds_josh: Follow up?",
    STATUS_PATH,
  ) as Card[];
  assert.equal(withoutUpdated.createdAt, null);
});

test("parseReminders reads only unanswered Queue items and ignores comments", () => {
  const text = [
    "# Reminders",
    "## Queue",
    "<!--",
    "- [ ] Bots | Elon: Hidden question? | due 2026-10-30 | done when never",
    "-->",
    "- [x] Bots | Alfred: Finished question? | due 2026-10-30 | done when done",
    "- [ ] Bots | Woz: OK to merge? | due 2026-10-31 | done when yes",
    "## Later",
    "- [ ] Bots | Don: Too late? | due 2026-11-10 | done when tomorrow",
  ].join("\n");

  const cards = M.parseReminders(text, REMINDERS_PATH) as Card[];
  assert.equal(cards.length, 1);
  const card = cards[0];
  assertCardShape(card);
  assert.deepEqual(
    { ...card, id: "d_placeholder" },
    {
      id: "d_placeholder",
      source: "reminders",
      bot: "Woz",
      question: "OK to merge?",
      rec: "",
      context: "done when yes",
      link: REMINDERS_PATH,
      createdAt: null,
      due: "2026-10-31",
      blocking: false,
    },
  );
});

test("parseApprovals uses frontmatter, splits bot names, and stops at Dropped", () => {
  const text = [
    "---",
    "updated: 2026-10-31 11:55 AM CT",
    "---",
    "- [ ] 3. Woz: question text. If he waits: consequence.",
    "- [ ] 4. Elon + Woz: Ship it? If he waits: hold.",
    "- [x] 5. Alfred: Already handled. If he waits: nothing.",
    "## Dropped",
    "- [ ] 6. Don: Ignore this. If he waits: forever.",
  ].join("\n");

  const cards = M.parseApprovals(text, "approvals/2026-10-31.md") as Card[];
  assert.equal(cards.length, 2);
  for (const card of cards) assertCardShape(card);

  assert.deepEqual(
    cards.map(({ id: _id, ...card }) => card),
    [
      {
        source: "approvals",
        bot: "Woz",
        question: "question text.",
        rec: "",
        context: "If he waits: consequence.",
        link: "approvals/2026-10-31.md",
        createdAt: "2026-10-31T16:55:00.000Z",
        due: null,
        blocking: false,
      },
      {
        source: "approvals",
        bot: "Elon",
        question: "Ship it?",
        rec: "",
        context: "If he waits: hold.",
        link: "approvals/2026-10-31.md",
        createdAt: "2026-10-31T16:55:00.000Z",
        due: null,
        blocking: false,
      },
    ],
  );
});

test("sortCards orders by due, blocking, createdAt, and removes duplicate ids", () => {
  const cards = [
    makeCard("d_due_open", {
      due: "2026-11-01",
      createdAt: "2026-10-31T15:00:00.000Z",
    }),
    makeCard("d_due_block", {
      due: "2026-11-01",
      createdAt: "2026-10-31T16:00:00.000Z",
      blocking: true,
    }),
    makeCard("d_tomorrow", {
      due: "2026-11-02",
      createdAt: "2026-10-30T01:00:00.000Z",
    }),
    makeCard("d_null_block", { blocking: true }),
    makeCard("d_null_early", {
      createdAt: "2026-10-30T10:00:00.000Z",
    }),
    makeCard("d_null_late", {
      createdAt: "2026-10-30T12:00:00.000Z",
    }),
    makeCard("d_null_missing"),
    makeCard("d_due_open", { question: "Duplicate" }),
  ];

  const sorted = M.sortCards(cards) as Card[];
  assert.deepEqual(
    sorted.map((card) => card.id),
    [
      "d_due_block",
      "d_due_open",
      "d_tomorrow",
      "d_null_block",
      "d_null_early",
      "d_null_late",
      "d_null_missing",
    ],
  );
  assert.equal(sorted.length, new Set(sorted.map((card) => card.id)).size);
});

test("buildSnapshot merges vault sources, relative links, ages, and exclusions", async (t) => {
  const root = await temporaryDirectory(t, "cto-decisions-snapshot-");
  const excludedRaw =
    "- [ ] [ASK] 2026-11-01 09:00 CT | owner: Alfred | q: Excluded? | ctx: obsolete";
  const includedRaw =
    "- [ ] [ASK] 2026-11-01 09:30 CT | owner: Woz | due: 2026-11-02 | q: Included? | rec: yes | ctx: open | link: https://example.com/included";
  const excluded = M.parseAskLine(excludedRaw, "decisions") as Card;
  const included = M.parseAskLine(includedRaw, "decisions") as Card;

  await writeVaultFile(
    root,
    DECISIONS_PATH,
    [
      "# Decisions",
      excludedRaw,
      `Answered elsewhere [id:${excluded.id}]`,
      includedRaw,
    ].join("\n"),
  );
  await writeVaultFile(
    root,
    STATUS_PATH,
    [
      "## Woz",
      "updated: 2026-11-01 4:20 PM CT",
      "needs_josh: Status question?",
    ].join("\n"),
  );
  await writeVaultFile(
    root,
    "00 Home/Bots/Alfred/Approvals/2026-10-30.md",
    [
      "---",
      "updated: 2026-10-30 11:55 AM CT",
      "---",
      "- [ ] 1. Don: Old approval? If he waits: skip.",
    ].join("\n"),
  );
  const currentApprovals = [
    "---",
    "updated: 2026-10-31 4:10 PM CT",
    "---",
    "- [ ] 1. Woz: Current approval? If he waits: hold.",
  ].join("\n");
  await writeVaultFile(
    root,
    "00 Home/Bots/Alfred/Approvals/2026-10-31.md",
    currentApprovals,
  );
  const reminders = [
    "## Queue",
    "- [ ] Bots | Don: Due first? | due 2026-10-31 | done when yes",
  ].join("\n");
  await writeVaultFile(root, REMINDERS_PATH, reminders);

  const snapshot = await M.buildSnapshot({
    vaultDir: root,
    remindersFile: path.join(root, REMINDERS_PATH),
    now: NOW,
  });

  const reminderCard = (M.parseReminders(reminders, REMINDERS_PATH) as Card[])[0];
  const approvalCard = (
    M.parseApprovals(
      currentApprovals,
      "00 Home/Bots/Alfred/Approvals/2026-10-31.md",
    ) as Card[]
  )[0];
  const statusCard = (
    M.parseStatus(
      [
        "## Woz",
        "updated: 2026-11-01 4:20 PM CT",
        "needs_josh: Status question?",
      ].join("\n"),
      STATUS_PATH,
    ) as Card[]
  )[0];

  assert.deepEqual(snapshot, {
    generatedAt: "2026-11-01T17:00:00.000Z",
    count: 4,
    cards: [
      { ...reminderCard, ageMin: null },
      { ...included, ageMin: 90 },
      { ...approvalCard, ageMin: 50 },
      { ...statusCard, ageMin: 40 },
    ],
  });
  assert.equal(
    snapshot.cards.some((card: Card) => card.id === excluded.id),
    false,
  );
  assert.equal(
    snapshot.cards.some((card: Card) => card.question === "Old approval?"),
    false,
  );
  assert.deepEqual(
    snapshot.cards.map((card: Card) => card.link),
    [
      REMINDERS_PATH,
      DECISIONS_PATH,
      "00 Home/Bots/Alfred/Approvals/2026-10-31.md",
      STATUS_PATH,
    ],
  );
});

test("buildSnapshot skips missing files", async (t) => {
  const root = await temporaryDirectory(t, "cto-decisions-missing-");
  const snapshot = await M.buildSnapshot({
    vaultDir: root,
    remindersFile: path.join(root, "missing-reminders.md"),
    now: NOW,
  });
  assert.deepEqual(snapshot, {
    generatedAt: "2026-11-01T17:00:00.000Z",
    count: 0,
    cards: [],
  });
});

test("formatAnswerLine renders the canonical answer format", () => {
  assert.equal(
    M.formatAnswerLine({
      id: "d_abc",
      bot: "Woz",
      question: "Merge PR 2?",
      choice: "yes",
      reply: "ship it",
      at: new Date("2026-11-01T16:05:00.000Z"),
    }),
    '- [x] 2026-11-01 10:05 CT — owner: Woz — Josh: "ship it" | choice: yes | q: Merge PR 2? | via: decisions app [id:d_abc]',
  );

  assert.equal(
    M.formatAnswerLine({
      id: "d_empty",
      bot: "Elon",
      question: "Proceed?",
      choice: "no",
      reply: " \n ",
      at: new Date("2026-11-01T16:05:00.000Z"),
    }),
    '- [x] 2026-11-01 10:05 CT — owner: Elon — Josh: "no" | choice: no | q: Proceed? | via: decisions app [id:d_empty]',
  );

  assert.equal(
    M.formatAnswerLine({
      id: "d_newline",
      bot: "Alfred",
      question: "Ship\nnext?",
      choice: "yes",
      reply: "ship\n\n it",
      at: new Date("2026-11-01T16:05:00.000Z"),
    }),
    '- [x] 2026-11-01 10:05 CT — owner: Alfred — Josh: "ship it" | choice: yes | q: Ship next? | via: decisions app [id:d_newline]',
  );
});

test("appendAnswer preserves bytes and avoids duplicate ids", async (t) => {
  const root = await temporaryDirectory(t, "cto-decisions-append-");
  const withoutNewline = path.join(root, "without-newline.md");
  const withNewline = path.join(root, "with-newline.md");
  const duplicate = path.join(root, "duplicate.md");
  const lineA = "- [x] answer A [id:d_append_a]";
  const lineB = "- [x] answer B [id:d_append_b]";
  const duplicateContent = "Header\n- [x] old [id:d_append_dup]\nTail bytes";

  await writeFile(withoutNewline, "Header");
  assert.deepEqual(
    await M.appendAnswer({
      decisionsFile: withoutNewline,
      line: lineA,
      id: "d_append_a",
    }),
    { added: true },
  );
  assert.equal(
    await readFile(withoutNewline, "utf8"),
    `Header\n${lineA}\n`,
  );

  await writeFile(withNewline, "Header\n\n");
  assert.deepEqual(
    await M.appendAnswer({
      decisionsFile: withNewline,
      line: lineB,
      id: "d_append_b",
    }),
    { added: true },
  );
  assert.equal(await readFile(withNewline, "utf8"), `Header\n\n${lineB}\n`);

  await writeFile(duplicate, duplicateContent);
  assert.deepEqual(
    await M.appendAnswer({
      decisionsFile: duplicate,
      line: "- [x] replacement",
      id: "d_append_dup",
    }),
    { added: false },
  );
  assert.equal(await readFile(duplicate, "utf8"), duplicateContent);
});

test("checkToken accepts only exact non-empty matches", () => {
  assert.equal(M.checkToken(undefined, "expected"), false);
  assert.equal(M.checkToken("candidate", undefined), false);
  assert.equal(M.checkToken("candidate", ""), false);
  assert.equal(M.checkToken("expected", "expected"), true);
  assert.equal(M.checkToken("expected ", "expected"), false);
  assert.equal(M.checkToken("wrong", "expected"), false);
});
