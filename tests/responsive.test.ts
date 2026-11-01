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

function mediaBodyAt(
  source: string,
  openingPattern: RegExp,
  label: string,
): string {
  const opening = openingPattern.exec(source);
  assert.ok(opening, `${label} is missing`);

  const start = opening.index + opening[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}") depth--;
    if (depth === 0) return source.slice(start, index);
  }
  assert.fail(`${label} is not closed`);
}

function mediaBody(source: string, minWidth: number): string {
  const label = `@media (min-width: ${minWidth}px)`;
  return mediaBodyAt(
    source,
    new RegExp(
      `@media\\s*\\(\\s*min-width\\s*:\\s*${minWidth}px\\s*\\)\\s*\\{`,
      "i",
    ),
    label,
  );
}

function maxWidthMediaBody(source: string, maxWidth: number): string {
  const label = `@media (max-width: ${maxWidth}px)`;
  return mediaBodyAt(
    source,
    new RegExp(
      `@media\\s*\\(\\s*max-width\\s*:\\s*${maxWidth}px\\s*\\)\\s*\\{`,
      "i",
    ),
    label,
  );
}

function rulesMatchingSelector(source: string, selector: string): CssRule[] {
  return rules(source).filter((rule) =>
    selectorParts(rule.selector).includes(selector),
  );
}

function assertDeclaration(
  source: string,
  selector: string,
  property: string,
  expected: string,
): void {
  const matchingRules = rulesMatchingSelector(source, selector);
  assert.ok(matchingRules.length > 0, `${selector} is missing`);
  assert.ok(
    matchingRules.some(
      (rule) => declaration(rule, property)?.toLowerCase() === expected,
    ),
    `${selector} needs ${property}: ${expected}`,
  );
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

test("max-width media parsing returns the balanced 639px block", () => {
  const fixture = `
    @media (max-width: 320px) {
      .unrelated { display: none; }
    }
    @media (max-width: 639px) {
      .phone {
        color: red;
      }
      @supports (display: grid) {
        .nested { display: grid; }
      }
    }
    @media (max-width: 1000px) {
      .after { display: none; }
    }
  `;

  const body = maxWidthMediaBody(fixture, 639);
  assert.match(body, /\.phone\s*\{/);
  assert.match(body, /\.nested\s*\{/);
  assert.doesNotMatch(body, /\.unrelated\s*\{/);
  assert.doesNotMatch(body, /\.after\s*\{/);
});

test("phone weather summary can wrap and shrink", () => {
  const phoneRules = maxWidthMediaBody(css, 639);
  assertDeclaration(phoneRules, ".weather", "flex-wrap", "wrap");
  assertDeclaration(phoneRules, ".weather-main", "min-width", "0");
  assertDeclaration(phoneRules, ".weather-main", "flex-wrap", "wrap");
});

test("phone weather copy can wrap", () => {
  const phoneRules = maxWidthMediaBody(css, 639);
  const wrappingRules = [
    ...rulesMatchingSelector(phoneRules, ".weather-main p"),
    ...rulesMatchingSelector(phoneRules, ".weather-main > span"),
  ];

  assert.ok(
    wrappingRules.length > 0,
    ".weather-main p or .weather-main > span is missing",
  );
  assert.ok(
    wrappingRules.some(
      (rule) => declaration(rule, "white-space")?.toLowerCase() === "normal",
    ),
    ".weather-main p or .weather-main > span needs white-space: normal",
  );
});

test("phone weather feed aligns to the top", () => {
  const phoneRules = maxWidthMediaBody(css, 639);
  assertDeclaration(phoneRules, ".weather-feed", "align-items", "flex-start");
});

test("phone shell sections fit within the viewport", () => {
  const phoneRules = maxWidthMediaBody(css, 639);

  for (const selector of [".header", ".dashboard-tabs", ".domain-columns"]) {
    assertDeclaration(phoneRules, selector, "max-width", "100%");
    assertDeclaration(phoneRules, selector, "min-width", "0");
  }
});
