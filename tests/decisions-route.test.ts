import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { GET, POST } from "@/app/api/decisions/route";

const DECISIONS_PATH = path.join("03 Resources", "_Meta", "Decisions.md");
const OPEN_ASK =
  "- [ ] [ASK] 2026-11-01 09:30 CT | owner: Woz | q: Merge PR 2?";
const POST_URL = "https://example.test/api/decisions";

const ENV_KEYS = [
  "DECISIONS_VAULT",
  "DECISIONS_REMINDERS",
  "DECISIONS_TOKEN",
] as const;

type TestFixture = {
  decisionsFile: string;
  originalBytes: Buffer;
  id: string;
};

async function createFixture(t: TestContext): Promise<TestFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "decisions-route-"));
  const decisionsFile = path.join(root, DECISIONS_PATH);
  const remindersFile = path.join(root, "missing-reminders.md");
  const originalEnv = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;

  t.after(async () => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    await rm(root, { recursive: true, force: true });
  });

  await mkdir(path.dirname(decisionsFile), { recursive: true });
  await writeFile(decisionsFile, OPEN_ASK);

  process.env.DECISIONS_VAULT = root;
  process.env.DECISIONS_REMINDERS = remindersFile;
  process.env.DECISIONS_TOKEN = "test-token";

  const originalBytes = await readFile(decisionsFile);
  const response = await GET(new Request(`${POST_URL}?t=test-token`));
  assert.equal(response.status, 200);

  const snapshot = (await response.json()) as {
    cards?: Array<{ id?: unknown }>;
  };
  const id = snapshot.cards?.[0]?.id;
  if (typeof id !== "string") {
    assert.fail("GET did not return a decision id");
  }

  return { decisionsFile, originalBytes, id };
}

function submission(id: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, choice: "yes", reply: "ship it" }),
  };
}

test("POST without a token returns 401 and preserves the decisions file", async (t) => {
  const fixture = await createFixture(t);

  const response = await POST(new Request(POST_URL, submission(fixture.id)));

  assert.equal(response.status, 401);
  assert.deepEqual(
    await readFile(fixture.decisionsFile),
    fixture.originalBytes,
  );
});

test("POST with a wrong header and query token returns 401 and preserves the decisions file", async (t) => {
  const fixture = await createFixture(t);
  const init = submission(fixture.id);

  const response = await POST(
    new Request(`${POST_URL}?t=nope`, {
      ...init,
      headers: {
        ...init.headers,
        "x-decisions-token": "nope",
      },
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(
    await readFile(fixture.decisionsFile),
    fixture.originalBytes,
  );
});

test("POST returns 401 when DECISIONS_TOKEN is unset and preserves the decisions file", async (t) => {
  const fixture = await createFixture(t);
  delete process.env.DECISIONS_TOKEN;

  try {
    const response = await POST(
      new Request(`${POST_URL}?t=test-token`, {
        ...submission(fixture.id),
        headers: {
          "content-type": "application/json",
          "x-decisions-token": "test-token",
        },
      }),
    );

    assert.equal(response.status, 401);
    assert.deepEqual(
      await readFile(fixture.decisionsFile),
      fixture.originalBytes,
    );
  } finally {
    process.env.DECISIONS_TOKEN = "test-token";
  }
});

test("GET without a token returns 401 without exposing decision text", async (t) => {
  await createFixture(t);

  const response = await GET(new Request(POST_URL));
  const body = await response.text();

  assert.equal(response.status, 401);
  assert.equal(body.includes("Merge PR 2?"), false);
});

test("POST with a valid token appends the answer and preserves the original ASK line", async (t) => {
  const fixture = await createFixture(t);

  const response = await POST(
    new Request(`${POST_URL}?t=test-token`, submission(fixture.id)),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, added: true });

  const updatedBytes = await readFile(fixture.decisionsFile);
  assert.deepEqual(
    updatedBytes.subarray(0, fixture.originalBytes.length),
    fixture.originalBytes,
  );

  const appended = updatedBytes
    .subarray(fixture.originalBytes.length)
    .toString("utf8");
  assert.equal(appended.startsWith("\n"), true);

  const appendedLines = appended.slice(1).split("\n");
  assert.equal(appendedLines.length, 2);
  assert.equal(appendedLines[1], "");
  assert.equal(appendedLines[0].includes('Josh: "ship it"'), true);
  assert.equal(appendedLines[0].includes("owner: Woz"), true);
  assert.equal(appendedLines[0].includes("via: dash"), true);

  const updatedText = updatedBytes.toString("utf8");
  assert.equal(updatedText.startsWith(OPEN_ASK), true);
  assert.equal(updatedText.includes(OPEN_ASK), true);
});
