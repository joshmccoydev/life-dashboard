import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const previewDocPath = join(here, "..", "docs", "PREVIEW.md");

function loadPreviewDoc(): string {
  assert.ok(
    existsSync(previewDocPath),
    "docs/PREVIEW.md must exist before these documentation checks can pass",
  );
  return readFileSync(previewDocPath, "utf8");
}

function sectionBody(doc: string, heading: RegExp, description: string): string {
  const lines = doc.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line));

  assert.notEqual(
    start,
    -1,
    `docs/PREVIEW.md needs a ${description} section`,
  );

  const level = lines[start].match(/^(#{1,6})\s+/)?.[1].length ?? 0;
  const end = lines.findIndex((line, index) => {
    if (index <= start) return false;
    const nextLevel = line.match(/^(#{1,6})\s+/)?.[1].length;
    return nextLevel !== undefined && nextLevel <= level;
  });

  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

test("documents the preview build command", () => {
  const doc = loadPreviewDoc();

  const body = sectionBody(
    doc,
    /^#{1,6}\s+.*\bPreview build\b.*$/i,
    "preview build",
  );

  assert.match(body, /npx opennextjs-cloudflare build/);
});

test("documents uploading a preview version and using its URL", () => {
  const doc = loadPreviewDoc();

  const body = sectionBody(
    doc,
    /^#{1,6}\s+.*\b(?:Deploy preview|Deploy(?:ing)? a preview|Preview deploy|Preview deployment)\b.*$/i,
    "preview deploy",
  );

  assert.match(body, /wrangler versions upload/);
  assert.match(body, /\bpreview URL\b/i);
});

test("documents Cloudflare Access and Josh's approval requirement", () => {
  const doc = loadPreviewDoc();

  const body = sectionBody(
    doc,
    /^#{1,6}\s+.*\bCloudflare Access\b.*$/i,
    "Cloudflare Access",
  );

  assert.match(body, /\bin front\b/i);
  assert.match(body, /\bJosh(?:'s)?\s+(?:yes|approval)\b/i);
});

test("documents the proposed five-minute KV export cron as uninstalled", () => {
  const doc = loadPreviewDoc();

  const body = sectionBody(
    doc,
    /^#{1,6}\s+.*\b(?:cron|KV export)\b.*$/i,
    "proposed KV export cron",
  );

  assert.match(body, /\*\/5 \* \* \* \*/);
  assert.match(body, /scripts\/kv-export\.ts/);
  assert.match(body, /\b(?:every 5 minutes?|five minutes?)\b/i);
  assert.match(body, /\b(?:proposal|proposed)\b/i);
  assert.match(
    body,
    /\b(?:not installed|not been installed|not implemented|do not install)\b/i,
  );
});

test("documents Mac push through launchd as a proposal only", () => {
  const doc = loadPreviewDoc();

  const body = sectionBody(
    doc,
    /^#{1,6}\s+.*\b(?:Mac push|launchd)\b.*$/i,
    "Mac push",
  );

  assert.match(body, /\bMac push\b/i);
  assert.match(body, /\blaunchd\b/i);
  assert.match(body, /\b(?:proposal|proposed)\b/i);
  assert.match(
    body,
    /\b(?:not installed|not implemented|do not (?:install|enable)|not yet (?:installed|implemented))\b/i,
  );
});

test("prohibits deploy, Access, and DNS changes without Josh's yes", () => {
  const doc = loadPreviewDoc();
  const normalized = doc.replace(/\s+/g, " ");
  const approvalGuard = normalized.split(/[.!?]\s+/).some(
    (statement) =>
      /\b(?:no|not|do not|don't)\b/i.test(statement) &&
      /\bdeploy(?:ment)?s?\b/i.test(statement) &&
      /\baccess\b/i.test(statement) &&
      /\bdns\b/i.test(statement) &&
      /\b(?:without|unless)\b/i.test(statement) &&
      /\bJosh(?:'s)?\s+(?:explicit\s+)?(?:yes|approval)\b/i.test(statement),
  );

  assert.ok(
    approvalGuard,
    "docs/PREVIEW.md must state one rule covering deploy, Access, and DNS approval",
  );
});
