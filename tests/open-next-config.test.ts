import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("OpenNext Cloudflare config imports defineCloudflareConfig and has a default export", () => {
  const configUrl = new URL("../open-next.config.ts", import.meta.url);

  assert.equal(existsSync(configUrl), true, "open-next.config.ts should exist at the repo root");

  const source = readFileSync(configUrl, "utf8");

  assert.match(
    source,
    /import\s*\{[^}]*\bdefineCloudflareConfig\b[^}]*\}\s*from\s*["']@opennextjs\/cloudflare["']/,
    "defineCloudflareConfig should be imported from @opennextjs/cloudflare",
  );
  assert.match(source, /export\s+default\b/, "open-next.config.ts should have a default export");
});
