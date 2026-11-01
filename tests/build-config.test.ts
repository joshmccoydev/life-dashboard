import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("tsconfig enables TypeScript extension imports without emitting files", () => {
  const source = readFileSync(
    new URL("../tsconfig.json", import.meta.url),
    "utf8",
  );
  const config = JSON.parse(source) as {
    compilerOptions?: {
      allowImportingTsExtensions?: boolean;
      noEmit?: boolean;
    };
  };

  assert.equal(config.compilerOptions?.noEmit, true);
  assert.equal(config.compilerOptions?.allowImportingTsExtensions, true);
});

test("dashboard route GET accepts Next 16 route context", () => {
  const source = readFileSync(
    new URL("../src/app/api/dashboard/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /export async function GET\(\s*request:[^,]+,\s*context\?:[^)]*params\?:/s,
  );
});
