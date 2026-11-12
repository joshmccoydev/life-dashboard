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
    "--bg: #191a21",
    "--text: #f8f8f2",
    "--elev: #282a36",
    "--muted-aaa: #adb5da",
    "--grok: #bd93f9",
    "--hermes: #8be9fd",
    "--font-sans: \"Geist\"",
    "--font-mono: \"Geist Mono\"",
    "--font-serif: \"Instrument Serif\"",
    "--fg: var(--text)",
    "--fg-muted: var(--muted-aaa)",
    "--surface: var(--elev)",
    "--font-ui: var(--font-sans)",
    "--focus-ring: 2px solid var(--accent)",
  ]) assert.ok(tokens.includes(token), `missing ${token}`);
});

test("Geist and Instrument Serif use the shipped SIL OFL font files", () => {
  const globals = readFileSync(join(root, "src/app/globals.css"), "utf8");
  const fonts = [
    "geist-latin-var.woff2",
    "geist-mono-latin-var.woff2",
    "instrument-serif-latin-regular.woff2",
    "instrument-serif-latin-italic.woff2",
  ];
  for (const font of fonts) {
    assert.ok(readFileSync(join(root, "public/fonts", font)).byteLength > 0, font);
    assert.ok(globals.includes(font) || tokens.includes(font), `${font} should be registered`);
  }
  assert.match(readFileSync(join(root, "public/fonts/OFL-Geist.txt"), "utf8"), /SIL OPEN FONT LICENSE/i);
  assert.match(readFileSync(join(root, "public/fonts/OFL-InstrumentSerif.txt"), "utf8"), /SIL OPEN FONT LICENSE/i);
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
