import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tokensPath = join(root, "src/styles/tokens.css");
const tokens = readFileSync(tokensPath, "utf8");

test("shared Dracula tokens and LifeDash aliases are present", () => {
  for (const token of [
    "--bg: #282A36",
    "--surface: #44475A",
    "--surface-hover: #515365",
    "--fg: #F8F8F2",
    "--fg-muted: #B2BACE",
    "--focus-ring: 2px solid #FF79C6",
    "--font-ui: \"Inter\"",
    "--font-mono: \"JetBrains Mono\"",
    "--color-canvas: var(--bg)",
    "--color-text: var(--fg)",
  ]) assert.ok(tokens.includes(token), `missing ${token}`);
});

test("Inter and JetBrains Mono use the shipped SIL OFL font files", () => {
  const globals = readFileSync(join(root, "src/app/globals.css"), "utf8");
  const fonts = [
    "inter-latin-400.woff2",
    "inter-latin-500.woff2",
    "inter-latin-600.woff2",
    "jetbrains-mono-latin-400.woff2",
    "jetbrains-mono-latin-500.woff2",
  ];
  for (const font of fonts) {
    assert.ok(readFileSync(join(root, "public/fonts", font)).byteLength > 0, font);
    assert.ok(globals.includes(font), `${font} should be registered`);
  }
  assert.match(readFileSync(join(root, "public/fonts/OFL-Inter.txt"), "utf8"), /SIL OPEN FONT LICENSE/i);
  assert.match(readFileSync(join(root, "public/fonts/OFL-JetBrainsMono.txt"), "utf8"), /SIL OPEN FONT LICENSE/i);
});

test("UI source has no raw hex colors outside the shared token file", () => {
  const scan = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return scan(path);
      return /\.(?:css|tsx?|jsx?)$/.test(entry.name) ? [path] : [];
    });
  const files = scan(join(root, "src")).filter((path) => path !== tokensPath);
  const matches = files.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return [...source.matchAll(/#[\da-f]{3,8}\b/gi)].map((match) => `${relative(root, path)}:${match[0]}`);
  });
  assert.deepEqual(matches, []);
});
