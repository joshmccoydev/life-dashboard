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

/**
 * Read the font's own `name` table ID 0 (copyright) out of the committed bytes
 * so the license-year assertion compares against the real artifact instead of a
 * literal that could drift.
 */
function embeddedCopyright(ttf: Buffer): string {
  const numTables = ttf.readUInt16BE(4);
  let nameTable = -1;
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (ttf.toString("latin1", record, record + 4) === "name") {
      nameTable = ttf.readUInt32BE(record + 8);
      break;
    }
  }
  if (nameTable < 0) throw new Error("font has no name table");
  const count = ttf.readUInt16BE(nameTable + 2);
  const stringOffset = nameTable + ttf.readUInt16BE(nameTable + 4);
  let fallback = "";
  for (let i = 0; i < count; i++) {
    const record = nameTable + 6 + i * 12;
    const platformID = ttf.readUInt16BE(record);
    if (ttf.readUInt16BE(record + 6) !== 0) continue;
    const length = ttf.readUInt16BE(record + 8);
    const offset = ttf.readUInt16BE(record + 10);
    const bytes = Buffer.from(
      ttf.subarray(stringOffset + offset, stringOffset + offset + length),
    );
    if (platformID === 3) {
      bytes.swap16();
      return bytes.toString("utf16le").trim();
    }
    fallback = bytes.toString("latin1").trim();
  }
  return fallback;
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

test("the license header year matches the font's embedded copyright year", () => {
  const embedded = embeddedCopyright(ttf);
  const embeddedYear = embedded.match(/Copyright\s+(\d{4})/)?.[1];
  const headerYear = ofl.match(/Copyright\s+(\d{4})/)?.[1];
  assert.ok(embeddedYear, `no year in embedded copyright: ${embedded}`);
  assert.equal(headerYear, embeddedYear);
  assert.ok(
    provenance.includes(embedded),
    "PROVENANCE.md records the font's embedded copyright string",
  );
});
