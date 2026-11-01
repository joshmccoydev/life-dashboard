import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function stripJsonComments(source: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (inLineComment) {
      if (character === "\n" || character === "\r") {
        inLineComment = false;
        result += character;
      }
      continue;
    }

    if (inBlockComment) {
      if (character === "*" && nextCharacter === "/") {
        inBlockComment = false;
        index += 1;
      } else if (character === "\n" || character === "\r") {
        result += character;
      }
      continue;
    }

    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
    } else if (character === "/" && nextCharacter === "/") {
      inLineComment = true;
      index += 1;
    } else if (character === "/" && nextCharacter === "*") {
      inBlockComment = true;
      index += 1;
    } else {
      result += character;
    }
  }

  return result;
}

test("preview wrangler config targets the OpenNext worker without exposing secrets", () => {
  const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(stripJsonComments(source)) as Record<string, unknown>;

  assert.equal(config.name, "life-dash-preview");
  assert.equal(config.main, ".open-next/worker.js");
  assert.deepEqual(config.assets, {
    directory: ".open-next/assets",
  });
  assert.deepEqual(config.compatibility_flags, ["nodejs_compat"]);
  assert.deepEqual(config.kv_namespaces, [
    {
      binding: "FEEDS_KV",
      id: "REPLACE_WITH_PREVIEW_KV_ID",
    },
  ]);
  assert.equal(config.workers_dev, true);

  for (const key of ["route", "routes", "custom_domains"]) {
    assert.equal(Object.hasOwn(config, key), false, `unexpected ${key}`);
  }

  for (const key of ["secrets", "vars"]) {
    assert.equal(Object.hasOwn(config, key), false, `unexpected ${key}`);
  }
});

test("wrangler compatibility date is a supported ISO date", () => {
  const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(stripJsonComments(source)) as Record<string, unknown>;
  const compatibilityDate = config.compatibility_date;

  assert.equal(typeof compatibilityDate, "string");
  assert.match(compatibilityDate as string, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok((compatibilityDate as string) >= "2024-09-23");
  assert.ok((compatibilityDate as string) <= "2026-11-01");
});
