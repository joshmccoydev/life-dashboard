import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { pullActions } from "../scripts/pull-decision-actions";
import type { DecisionAction } from "../src/lib/decision-actions";

const NOW = new Date("2026-11-02T15:19:00.000Z");

type PullFixture = {
  root: string;
  vaultDir: string;
  statePath: string;
  decisionsPath: string;
  actionsPath: string;
};

async function createPullFixture(
  t: TestContext,
  prefix: string,
): Promise<PullFixture> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const vaultDir = path.join(root, "vault");
  const decisionsPath = path.join(
    vaultDir,
    "03 Resources",
    "_Meta",
    "Decisions.md",
  );
  await mkdir(path.dirname(decisionsPath), { recursive: true });
  await writeFile(decisionsPath, "# Synthetic Decisions\n", "utf8");

  return {
    root,
    vaultDir,
    statePath: path.join(root, "state", "decision-actions.json"),
    decisionsPath,
    actionsPath: path.join(
      vaultDir,
      "03 Resources",
      "_Meta",
      "Decision Actions.md",
    ),
  };
}

function requireMatchingLine(
  content: string,
  patterns: readonly RegExp[],
): string {
  const line = content
    .split(/\r?\n/)
    .find((candidate) => patterns.every((pattern) => pattern.test(candidate)));
  assert.ok(
    line,
    `expected one line matching ${patterns.map(String).join(", ")}`,
  );
  return line;
}

test("pullActions appends chosen and undone actions once", async (t) => {
  const fixture = await createPullFixture(t, "pull-decision-actions-");
  const actions: DecisionAction[] = [
    {
      decisionId: "d_synthetic_chosen",
      bot: "Woz",
      question: "Synthetic decision alpha?",
      choice: "yes",
      reply: "Synthetic reply alpha",
      ts: "2026-11-02T15:15:00.000Z",
      status: "chosen",
    },
    {
      decisionId: "d_synthetic_undone",
      bot: "Synthetic Reviewer",
      question: "Synthetic decision beta?",
      choice: "no",
      reply: "",
      ts: "2026-11-02T15:16:00.000Z",
      status: "undone",
      undoneAt: "2026-11-02T15:17:00.000Z",
    },
  ];
  const readRaw = async (): Promise<string> => JSON.stringify(actions);

  const first = await pullActions({
    readRaw,
    vaultDir: fixture.vaultDir,
    statePath: fixture.statePath,
    now: NOW,
  });

  assert.equal(first.appended, 2);

  const decisions = await readFile(fixture.decisionsPath, "utf8");
  const choiceLine = requireMatchingLine(decisions, [
    /\[id:d_synthetic_chosen\]/,
    /choice:\s*yes/i,
  ]);
  assert.match(choiceLine, /Synthetic decision alpha\?/);

  const undoLine = requireMatchingLine(decisions, [
    /\[id:d_synthetic_undone\]/,
    /undo:\s*stop/i,
  ]);
  assert.match(undoLine, /Synthetic Reviewer/i);

  const actionLog = await readFile(fixture.actionsPath, "utf8");
  assert.match(actionLog, /^# Decision Actions\s*$/m);
  const chosenActionLine = requireMatchingLine(actionLog, [
    /\[id:d_synthetic_chosen\]/,
    /to:\s*Woz/i,
    /non-priority/i,
  ]);
  assert.match(chosenActionLine, /chose\s+yes/i);
  requireMatchingLine(actionLog, [
    /\[id:d_synthetic_undone\]/,
    /undo:\s*stop/i,
    /to:\s*Synthetic Reviewer/i,
  ]);

  const second = await pullActions({
    readRaw,
    vaultDir: fixture.vaultDir,
    statePath: fixture.statePath,
    now: NOW,
  });

  assert.equal(second.appended, 0);
  assert.equal(
    await readFile(fixture.decisionsPath, "utf8"),
    decisions,
  );
  assert.equal(await readFile(fixture.actionsPath, "utf8"), actionLog);
});

test("pullActions ignores malformed raw data without throwing", async (t) => {
  const fixture = await createPullFixture(t, "pull-decision-actions-bad-");

  const result = await pullActions({
    readRaw: async () => "{",
    vaultDir: fixture.vaultDir,
    statePath: fixture.statePath,
    now: NOW,
  });

  assert.equal(result.appended, 0);
  assert.equal(
    await readFile(fixture.decisionsPath, "utf8"),
    "# Synthetic Decisions\n",
  );
});
