import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  interpretKvGet,
  pullActions,
} from "../scripts/pull-decision-actions";

test("interpretKvGet treats a missing decision-actions key as no actions", () => {
  const result = interpretKvGet(
    {
      message: "Command failed",
      stderr:
        "Failed to fetch https://example.test/values/decision-actions - 404: Not Found",
    },
    "",
  );

  assert.equal(result, null);
});

test("interpretKvGet returns trimmed stdout when the key exists", () => {
  assert.equal(interpretKvGet(null, "  [] \n"), "[]");
});

test("interpretKvGet returns null for empty stdout", () => {
  assert.equal(interpretKvGet(null, ""), null);
});

test("interpretKvGet rethrows errors that are not missing-key errors", () => {
  assert.throws(() =>
    interpretKvGet({ message: "Authentication error 10000" }, ""),
  );
});

test("pullActions does not create an actions file when the key is missing", async (t) => {
  const vaultDir = await mkdtemp(
    path.join(tmpdir(), "pull-actions-missing-key-"),
  );
  t.after(async () => {
    await rm(vaultDir, { recursive: true, force: true });
  });

  const result = await pullActions({
    readRaw: async () => null,
    vaultDir,
    statePath: path.join(vaultDir, "decision-actions.json"),
    now: new Date("2026-11-02T15:19:00.000Z"),
  });

  assert.deepEqual(result, { appended: 0 });
  await assert.rejects(
    access(
      path.join(
        vaultDir,
        "03 Resources",
        "_Meta",
        "Decision Actions.md",
      ),
    ),
    { code: "ENOENT" },
  );
});
