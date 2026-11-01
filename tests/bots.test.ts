import test from "node:test";
import assert from "node:assert/strict";
import { parseBotStatus } from "../src/adapters/bots.ts";

test("parses bot fields into the dashboard shape", () => {
  const parsed = parseBotStatus([
    {
      name: "Alpha",
      status: "running",
      detail: "Reviewing the release",
    },
  ]);

  assert.deepEqual(parsed, [
    {
      name: "Alpha",
      status: "running",
      detail: "Reviewing the release",
    },
  ]);
});

test("matches field names case-insensitively", () => {
  const parsed = parseBotStatus([
    {
      NAME: "Bravo",
      Status: "waiting",
      DETAIL: "Queued for review",
    },
  ]);

  assert.deepEqual(parsed, [
    {
      name: "Bravo",
      status: "waiting",
      detail: "Queued for review",
    },
  ]);
});

test("treats none, a dash, and n/a as null details", () => {
  const parsed = parseBotStatus([
    { name: "Alpha", status: "idle", detail: "none" },
    { name: "Bravo", status: "idle", detail: "-" },
    { name: "Charlie", status: "idle", detail: "n/a" },
  ]);

  assert.deepEqual(
    parsed.map(({ detail }) => detail),
    [null, null, null],
  );
});

test("strips links from details", () => {
  const parsed = parseBotStatus([
    {
      name: "Alpha",
      status: "running",
      detail:
        "Review [pull request 42](https://example.test/pull/42) in <https://example.test/build|the build log>",
    },
  ]);

  assert.equal(
    parsed[0]?.detail,
    "Review pull request 42 in the build log",
  );
});

test("caps details at 200 characters", () => {
  const parsed = parseBotStatus([
    {
      name: "Alpha",
      status: "running",
      detail: "x".repeat(240),
    },
  ]);

  assert.equal(parsed[0]?.detail, "x".repeat(200));
});

test("sorts waiting bots first while preserving order within each group", () => {
  const parsed = parseBotStatus([
    { name: "Alpha", status: "running", detail: "Writing tests" },
    { name: "Bravo", status: "waiting", detail: "Queued next" },
    { name: "Charlie", status: "running", detail: "Reviewing output" },
    { name: "Delta", status: "waiting", detail: "Awaiting assignment" },
  ]);

  assert.deepEqual(
    parsed.map(({ name }) => name),
    ["Bravo", "Delta", "Alpha", "Charlie"],
  );
});

test("returns an empty array for empty input", () => {
  assert.deepEqual(parseBotStatus([]), []);
});
