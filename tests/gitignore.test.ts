import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test(".gitignore excludes Next.js and Wrangler build artifacts", () => {
  const lines = readFileSync(".gitignore", "utf8").split(/\r?\n/);

  assert.ok(lines.includes(".open-next/"));
  assert.ok(lines.includes(".wrangler/"));
});
