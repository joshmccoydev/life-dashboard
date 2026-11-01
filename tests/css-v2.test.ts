import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeMediaBlocks(source: string) {
  let stripped = source;

  while (true) {
    const start = stripped.indexOf("@media");
    if (start === -1) return stripped;

    const openingBrace = stripped.indexOf("{", start);
    assert.notEqual(openingBrace, -1, "media query must have a block");

    let depth = 0;
    let closingBrace = -1;
    for (let index = openingBrace; index < stripped.length; index += 1) {
      if (stripped[index] === "{") depth += 1;
      if (stripped[index] === "}") depth -= 1;
      if (depth === 0) {
        closingBrace = index;
        break;
      }
    }

    assert.notEqual(closingBrace, -1, "media query block must be closed");
    stripped = stripped.slice(0, start) + stripped.slice(closingBrace + 1);
  }
}

function ruleBodies(source: string, selector: string) {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`,
    "g",
  );
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function mediaBlock(source: string, query: string) {
  const start = source.indexOf(query);
  if (start === -1) return undefined;

  const openingBrace = source.indexOf("{", start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  return undefined;
}

function slice7FixedClasses() {
  const directories = [
    join(root, "src/components/panels"),
    join(root, "src/components/shared"),
  ];
  const sources = directories.flatMap((directory) =>
    readdirSync(directory)
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => readFileSync(join(directory, file), "utf8")),
  );
  const classNames = new Set<string>();
  const attributePattern = /className=(?:"([^"]+)"|\{`([^`]+)`\})/g;

  for (const source of sources) {
    for (const match of source.matchAll(attributePattern)) {
      const expression = match[1] ?? match[2] ?? "";
      const staticText = expression.replace(/\$\{[^}]*\}/g, " ");
      for (const className of staticText.split(/\s+/)) {
        if (className) classNames.add(className);
      }
    }
  }

  return [...classNames].sort();
}

test("phone styles define the dashboard columns in a single base column", () => {
  const baseCss = removeMediaBlocks(css);
  const declarations = ruleBodies(baseCss, ".domain-columns");

  assert.ok(
    declarations.some((body) =>
      /grid-template-columns\s*:\s*1fr\s*;/.test(body),
    ),
    "base .domain-columns must use one phone-sized column",
  );
});

test("the TV breakpoint is min-width 1024px and restores three columns", () => {
  const query = "@media (min-width: 1024px)";
  assert.ok(css.includes(query), `globals.css must declare ${query}`);

  const tvCss = mediaBlock(css, query);
  assert.ok(tvCss, "the TV media query must have a block");
  assert.ok(
    ruleBodies(tvCss, ".domain-columns").some((body) =>
      /grid-template-columns\s*:\s*1\.15fr\s+1fr\s+0\.88fr\s*;/.test(body),
    ),
    "the TV breakpoint must restore the three-column layout",
  );
});

test("globals.css styles every fixed Slice 7 component class", () => {
  const classes = slice7FixedClasses();
  assert.ok(classes.length > 0, "component class discovery must not be empty");

  for (const className of classes) {
    assert.match(
      css,
      new RegExp(`\\.${escapeRegExp(className)}(?![\\w-])`),
      `globals.css must style .${className}`,
    );
  }
});
