import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildSnapshot,
  main,
} from "../scripts/produce-feeds.ts";

const TIMEOUT_MS = 3_000;

function withinThreeSeconds<T>(
  operation: PromiseLike<T>,
  description: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${description} exceeded ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
  });

  return Promise.race<T>([Promise.resolve(operation), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function syntheticDecisionsEnvironment(
  t: TestContext,
): Promise<void> {
  const vaultDir = await mkdtemp(
    path.join(os.tmpdir(), "decisions-snapshot-await-"),
  );
  const remindersFile = path.join(vaultDir, "missing-reminders.md");
  const originalVault = process.env.DECISIONS_VAULT;
  const originalReminders = process.env.DECISIONS_REMINDERS;
  const originalExitCode = process.exitCode;

  process.env.DECISIONS_VAULT = vaultDir;
  process.env.DECISIONS_REMINDERS = remindersFile;

  t.after(async () => {
    if (originalVault === undefined) {
      delete process.env.DECISIONS_VAULT;
    } else {
      process.env.DECISIONS_VAULT = originalVault;
    }

    if (originalReminders === undefined) {
      delete process.env.DECISIONS_REMINDERS;
    } else {
      process.env.DECISIONS_REMINDERS = originalReminders;
    }

    process.exitCode = originalExitCode;
    await rm(vaultDir, { recursive: true, force: true });
  });
}

test("await buildSnapshot resolves to a plain snapshot with decisions", async (t) => {
  await syntheticDecisionsEnvironment(t);

  const result: unknown = await withinThreeSeconds(
    Promise.resolve(buildSnapshot()),
    "buildSnapshot",
  );

  assert.equal(typeof result, "object");
  assert.notEqual(result, null);
  if (typeof result !== "object" || result === null) {
    assert.fail("buildSnapshot result must be an object");
  }

  const snapshot = result as Record<string, unknown>;
  assert.equal(typeof snapshot.then, "undefined");
  assert.equal(Object.hasOwn(snapshot, "decisions"), true);
});

test("main dry-run resolves with the default build", async (t) => {
  await syntheticDecisionsEnvironment(t);

  const result: unknown = await withinThreeSeconds(
    Promise.resolve(
      main(["--dry-run"], {
        kvGet: () => null,
        kvPut: () => {},
        out: () => {},
      }),
    ),
    "main dry-run",
  );

  assert.equal(typeof result, "number");
  assert.equal(result, 0);
});
