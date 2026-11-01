import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

type CssRule = {
  selector: string;
  declarations: string;
};

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function rules(source: string): CssRule[] {
  return Array.from(
    source.matchAll(/([^{}]+)\{([^{}]*)\}/g),
    ([, selector, declarations]) => ({
      selector: normalize(selector),
      declarations,
    }),
  ).filter((rule) => !rule.selector.startsWith("@"));
}

function selectorParts(selector: string): string[] {
  return selector.split(",").map(normalize);
}

function hasClass(selector: string, className: string): boolean {
  return new RegExp(`\\.${className}(?![\\w-])`).test(selector);
}

function declaration(rule: CssRule, property: string): string | undefined {
  for (const value of rule.declarations.split(";")) {
    const separator = value.indexOf(":");
    if (separator === -1) continue;
    const name = normalize(value.slice(0, separator)).toLowerCase();
    if (name === property) return normalize(value.slice(separator + 1));
  }
  return undefined;
}

function mediaBody(source: string, minWidth: number): string {
  const opening = new RegExp(
    `@media\\s*\\(\\s*min-width\\s*:\\s*${minWidth}px\\s*\\)\\s*\\{`,
    "i",
  ).exec(source);
  assert.ok(opening, `@media (min-width: ${minWidth}px) is missing`);

  const start = opening.index + opening[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}") depth--;
    if (depth === 0) return source.slice(start, index);
  }
  assert.fail(`@media (min-width: ${minWidth}px) is not closed`);
}

test("html and body contain horizontal overflow with universal border-box sizing", () => {
  const documentRules = rules(css).filter(({ selector }) =>
    selectorParts(selector).includes("body"),
  );
  assert.ok(documentRules.length > 0, "a body rule is missing");
  assert.ok(
    documentRules.some(
      (rule) => declaration(rule, "overflow-x")?.toLowerCase() === "hidden",
    ),
    "a body rule needs overflow-x: hidden",
  );

  const universalRule = rules(css).find(({ selector }) =>
    selectorParts(selector).includes("*"),
  );
  assert.ok(universalRule, "a universal selector rule is missing");
  assert.equal(
    declaration(universalRule, "box-sizing")?.toLowerCase(),
    "border-box",
  );
});

test("dashboard columns use two minmax tracks from 640px", () => {
  const columnRule = rules(mediaBody(css, 640)).find(({ selector }) =>
    hasClass(selector, "domain-columns"),
  );
  assert.ok(columnRule, ".domain-columns is missing from the 640px layout");
  assert.equal(
    declaration(columnRule, "grid-template-columns")?.toLowerCase(),
    "repeat(2, minmax(0, 1fr))",
  );
});

test("dashboard columns use three minmax tracks from 1280px", () => {
  const columnRule = rules(mediaBody(css, 1280)).find(({ selector }) =>
    hasClass(selector, "domain-columns"),
  );
  assert.ok(columnRule, ".domain-columns is missing from the 1280px layout");

  const columns = declaration(columnRule, "grid-template-columns")
    ?.toLowerCase()
    .replace(/\s+/g, "");
  assert.ok(columns, "grid-template-columns is missing at 1280px");
  assert.match(columns, /^repeat\(3,minmax\(0,[^)]+\)\)$/);
});

test("dashboard shell is capped at 1680px and centered", () => {
  const cappedShell = rules(css).find((rule) => {
    if (!hasClass(rule.selector, "dashboard")) return false;
    return declaration(rule, "max-width")?.toLowerCase() === "1680px";
  });
  assert.ok(cappedShell, ".dashboard needs max-width: 1680px");

  const marginInline = declaration(cappedShell, "margin-inline")?.toLowerCase();
  const margin = declaration(cappedShell, "margin")
    ?.toLowerCase()
    .replace(/\s+/g, " ");
  assert.ok(
    marginInline === "auto" || margin === "0 auto",
    ".dashboard needs margin-inline: auto or margin: 0 auto",
  );
});

test("dashboard tabs scroll horizontally and provide a 44px hit target", () => {
  const tabList = rules(css).find(({ selector }) =>
    hasClass(selector, "dashboard-tabs"),
  );
  assert.ok(tabList, ".dashboard-tabs is missing");
  assert.equal(declaration(tabList, "overflow-x")?.toLowerCase(), "auto");

  const tab = rules(css).find(({ selector }) =>
    hasClass(selector, "dashboard-tab"),
  );
  assert.ok(tab, ".dashboard-tab is missing");
  assert.equal(declaration(tab, "min-height")?.toLowerCase(), "44px");
});

test("images and inline SVGs cannot exceed their containers", () => {
  const mediaRule = rules(css).find(({ selector }) => {
    const parts = selectorParts(selector);
    return parts.includes("img") && parts.includes("svg");
  });
  assert.ok(mediaRule, "an img, svg rule is missing");
  assert.equal(declaration(mediaRule, "max-width")?.toLowerCase(), "100%");
});

test("long words can break anywhere", () => {
  assert.match(css, /overflow-wrap\s*:\s*anywhere\s*;/i);
});
