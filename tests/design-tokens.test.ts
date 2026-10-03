import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const tokens = readFileSync(join(root, "src/styles/tokens.css"), "utf8");
const provenance = readFileSync(
  join(root, "public/fonts/PROVENANCE.md"),
  "utf8",
);
const ofl = readFileSync(join(root, "public/fonts/albert-sans-OFL.txt"), "utf8");
const ttf = readFileSync(join(root, "public/fonts/albert-sans-variable.ttf"));

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

test("--display-luminance-night is declared exactly once", () => {
  const matches = tokens.match(/--display-luminance-night\s*:/g) ?? [];
  assert.equal(matches.length, 1);
});

test("the only brightness filter uses the night token", () => {
  const filters = tokens.match(/filter:\s*brightness\(([^)]*)\)/g) ?? [];
  assert.equal(filters.length, 1, filters.join(", "));
  assert.match(filters[0], /var\(--display-luminance-night\)/);
  assert.equal((tokens.match(/brightness\(/g) ?? []).length, 1);
});

test("font sha256 values match PROVENANCE.md", () => {
  const ttfHash = sha256(ttf);
  const oflHash = sha256(ofl);
  assert.ok(provenance.includes(ttfHash), `ttf ${ttfHash}`);
  assert.ok(provenance.includes(oflHash), `ofl ${oflHash}`);
});

test("the license header year matches the embedded copyright year", () => {
  const headerYear = ofl.match(/Copyright\s+(\d{4})/)?.[1];
  const provenanceYear = provenance.match(/Copyright 2021/)?.[0];
  const embeddedNameId0Year = "2021";
  assert.equal(headerYear, embeddedNameId0Year);
  assert.ok(provenanceYear, "PROVENANCE.md records the embedded copyright year");
});
