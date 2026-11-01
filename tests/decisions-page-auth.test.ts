import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/app/decisions/page.tsx", import.meta.url),
  "utf8",
);

test("decisions page is protected by the Cloudflare Access JWT", () => {
  assert.doesNotMatch(pageSource, /\bcheckToken\b/);
  assert.doesNotMatch(pageSource, /\bDECISIONS_TOKEN\b/);
  assert.doesNotMatch(pageSource, /\bquery\s*\.\s*t\b/);
  assert.doesNotMatch(
    pageSource,
    /\b(?:query|searchParams)\s*\[\s*["']t["']\s*\]/,
  );
  assert.doesNotMatch(pageSource, /\.get\s*\(\s*["']t["']\s*\)/);
  assert.doesNotMatch(pageSource, /\bname\s*=\s*["']t["']/);

  assert.match(
    pageSource,
    /import\s*\{[^}]*\bverifyAccessJwt\b[^}]*\}\s*from\s*["']@\/lib\/access-auth["'];/s,
  );
  assert.match(
    pageSource,
    /import\s*\{[^}]*\bheaders\b[^}]*\}\s*from\s*["']next\/headers["'];/s,
  );
  assert.match(pageSource, /\.get\s*\(\s*["']cf-access-jwt-assertion["']\s*\)/);
});

test("decisions page content fits phones", () => {
  const hasResponsiveRule = pageSource.includes("@media");
  const hasPhoneWidth =
    /\bwidth\s*:\s*["']100%["']/.test(pageSource) &&
    pageSource.includes("maxWidth");

  assert.ok(
    hasResponsiveRule || hasPhoneWidth,
    "expected a responsive rule or a full-width container with maxWidth",
  );
  assert.ok(pageSource.includes("maxWidth"));
  assert.ok(pageSource.includes("overflowWrap"));
});
