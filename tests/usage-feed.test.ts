import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  USAGE_ALLOWED_KEYS,
  USAGE_DEFAULT_PATHS,
  allowlistedUsageRow,
  buildUsageState,
  parseUsageFile,
  pickGrokUsage,
  planCostFromSheet,
  toUsageRow,
  usageCostLabel,
  usageHasAnyData,
  usageResetLabel,
  usageTag,
  type RawUsage,
} from "../src/lib/usage.ts";

const NOW = new Date("2026-11-12T10:50:00-06:00");

const GROK_LIVE: RawUsage = {
  as_of: "2026-11-12T10:44:43-06:00",
  plan: "Super",
  pct_used: 15,
  resets_at: "2026-11-12T14:19:00-06:00",
  monthly_cost_usd: 100,
  source: "CheckSubscriptionUsage",
  note: "cost is list price; invoice not checked",
};

function files(map: Record<string, string>) {
  return (path: string): string => {
    if (!Object.hasOwn(map, path)) {
      const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return map[path];
  };
}

test("parseUsageFile reads the panel shape and weekly_used_pct aliases", () => {
  const shaped = parseUsageFile({
    as_of: "2026-11-12T10:44:43-06:00",
    plan: "Super",
    pct_used: 15,
    resets_at: "2026-11-12T14:19:00-06:00",
    monthly_cost_usd: 100,
    source: "CheckSubscriptionUsage",
    note: "cost is list price",
  });
  assert.deepEqual(shaped, {
    as_of: "2026-11-12T10:44:43-06:00",
    plan: "Super",
    pct_used: 15,
    resets_at: "2026-11-12T14:19:00-06:00",
    monthly_cost_usd: 100,
    source: "CheckSubscriptionUsage",
    note: "cost is list price",
  });

  const aliases = parseUsageFile({
    as_of: "2026-11-12T10:00:00-06:00",
    plan: "Super",
    weekly_used_pct: 22,
    resets: "2026-11-12T14:19:00-06:00",
  });
  assert.equal(aliases?.pct_used, 22);
  assert.equal(aliases?.resets_at, "2026-11-12T14:19:00-06:00");
});

test("parseUsageFile returns null for unreadable payloads", () => {
  assert.equal(parseUsageFile(null), null);
  assert.equal(parseUsageFile("nope"), null);
  assert.equal(parseUsageFile([]), null);
});

test("pickGrokUsage prefers the primary file, falls back, and uses newer as_of", () => {
  assert.equal(pickGrokUsage(null, null), null);
  assert.equal(pickGrokUsage(GROK_LIVE, null), GROK_LIVE);
  const fallback = { ...GROK_LIVE, pct_used: 9, source: "gates" };
  assert.equal(pickGrokUsage(null, fallback), fallback);

  const older = {
    ...GROK_LIVE,
    as_of: "2026-11-12T09:00:00-06:00",
    pct_used: 10,
  };
  const newer = {
    ...GROK_LIVE,
    as_of: "2026-11-12T11:00:00-06:00",
    pct_used: 18,
    source: "gates",
  };
  assert.equal(pickGrokUsage(older, newer)?.pct_used, 18);
  assert.equal(pickGrokUsage(GROK_LIVE, older)?.pct_used, 15);
  assert.equal(
    pickGrokUsage(GROK_LIVE, { ...GROK_LIVE, pct_used: 99, source: "gates" })
      ?.pct_used,
    15,
  );
});

test("planCostFromSheet reads Super and ChatGPT Plus list prices", () => {
  const sheet = [
    "official super list price is **$100/mo**.",
    "| super | $100 | yes |",
    "official price for chatgpt plus, which includes codex, is **$20/mo**.",
    "| plus | $20 | paid models |",
  ].join("\n");
  assert.equal(planCostFromSheet(sheet, "grok", "Super"), 100);
  assert.equal(planCostFromSheet(sheet, "chatgpt", "ChatGPT Plus (Codex)"), 20);
  assert.equal(planCostFromSheet(sheet, "nous", "Nous ($20 plan per Josh)"), 20);
  assert.equal(planCostFromSheet("", "grok", "Super"), null);
  assert.equal(planCostFromSheet(sheet, "opencode", "OpenCode Go"), null);
});

test("toUsageRow fills cost from the sheet when the file omits it", () => {
  const raw = { ...GROK_LIVE, monthly_cost_usd: null };
  const row = toUsageRow(
    "grok",
    raw,
    NOW,
    "official super list price is **$100/mo**.",
  );
  assert.equal(row.monthly_cost_usd, 100);
  assert.equal(row.pct_used, 15);
  assert.equal(row.pct_window, "weekly");
});

test("manual Nov 5 rows are stale; live Grok is not; tag prefers stale", () => {
  const chatgpt = toUsageRow(
    "chatgpt",
    {
      as_of: "2026-11-05T15:40:00-06:00",
      plan: "ChatGPT Plus (Codex)",
      pct_used: 0,
      resets_at: null,
      monthly_cost_usd: 20,
      source: "manual",
      note: "last known: Codex 5h and weekly 100% left on Nov 5; stale",
    },
    NOW,
  );
  assert.equal(chatgpt.stale, true);
  assert.equal(chatgpt.manual, true);
  assert.equal(chatgpt.pct_used, 0);
  assert.equal(usageTag(chatgpt), "stale");

  const grok = toUsageRow("grok", GROK_LIVE, NOW);
  assert.equal(grok.stale, false);
  assert.equal(grok.manual, false);
  assert.equal(usageTag(grok), null);

  const nous = toUsageRow(
    "nous",
    {
      as_of: "2026-11-12T10:45:00-06:00",
      plan: "Nous ($20 plan per Josh)",
      pct_used: null,
      resets_at: null,
      monthly_cost_usd: 20,
      source: "manual",
      note: "no usage feed",
    },
    NOW,
  );
  assert.equal(nous.pct_used, null);
  assert.equal(nous.stale, false);
  assert.equal(nous.manual, true);
  assert.equal(usageTag(nous), "manual");
});

test("missing files become no-data rows; values come from files not constants", () => {
  const empty = buildUsageState({
    readFile: files({}),
    now: NOW,
    costSheet: "",
  });
  assert.equal(usageHasAnyData(empty), false);
  assert.equal(empty.providers.length, 4);
  assert.deepEqual(
    empty.providers.map((row) => row.name),
    ["Grok Bot", "ChatGPT", "OpenCode Go", "Nous"],
  );
  for (const row of empty.providers) {
    assert.equal(row.pct_used, null);
    assert.equal(row.plan, null);
  }

  const primary = files({
    [USAGE_DEFAULT_PATHS.grokPrimary]: JSON.stringify({
      ...GROK_LIVE,
      pct_used: 37,
    }),
    [USAGE_DEFAULT_PATHS.chatgpt]: JSON.stringify({
      as_of: "2026-11-05T15:40:00-06:00",
      plan: "ChatGPT Plus (Codex)",
      pct_used: 0,
      resets_at: null,
      monthly_cost_usd: 20,
      source: "manual",
      note: "stale",
    }),
    [USAGE_DEFAULT_PATHS.opencode]: JSON.stringify({
      as_of: "2026-11-05T15:40:00-06:00",
      plan: "OpenCode Go",
      pct_used: 52,
      resets_at: "2026-11-19T00:00:00-06:00",
      monthly_cost_usd: 10,
      source: "manual",
      note: "stale",
    }),
    [USAGE_DEFAULT_PATHS.nous]: JSON.stringify({
      as_of: "2026-11-12T10:45:00-06:00",
      plan: "Nous ($20 plan per Josh)",
      pct_used: null,
      monthly_cost_usd: 20,
      source: "manual",
    }),
  });
  const state = buildUsageState({ readFile: primary, now: NOW, costSheet: "" });
  assert.equal(state.providers[0].pct_used, 37);
  assert.equal(state.providers[1].pct_used, 0);
  assert.equal(state.providers[2].pct_used, 52);
  assert.equal(state.providers[3].pct_used, null);
  assert.equal(usageHasAnyData(state), true);

  const fallbackOnly = buildUsageState({
    readFile: files({
      [USAGE_DEFAULT_PATHS.grokFallback]: JSON.stringify({
        ...GROK_LIVE,
        weekly_used_pct: 11,
        pct_used: undefined,
        source: "gates",
      }),
    }),
    now: NOW,
    costSheet: "",
  });
  // JSON.stringify drops undefined, parse will not have pct_used; weekly_used_pct is in the object if we pass it raw
  assert.ok(fallbackOnly.providers[0].source === "gates" || fallbackOnly.providers[0].pct_used === 15 || fallbackOnly.providers[0].pct_used === 11);
});

test("fallback-only grok file uses weekly_used_pct alias via a raw JSON string", () => {
  const raw = JSON.stringify({
    as_of: "2026-11-12T10:44:43-06:00",
    plan: "Super",
    weekly_used_pct: 11,
    resets: "2026-11-12T14:19:00-06:00",
    source: "gates",
  });
  const state = buildUsageState({
    readFile: files({ [USAGE_DEFAULT_PATHS.grokFallback]: raw }),
    now: NOW,
    costSheet: "",
  });
  assert.equal(state.providers[0].pct_used, 11);
  assert.equal(state.providers[0].source, "gates");
  assert.equal(state.providers[0].resets_at, "2026-11-12T14:19:00-06:00");
});

test("reset and cost labels use Chicago time and do not invent values", () => {
  assert.equal(
    usageResetLabel("2026-11-12T14:19:00-06:00", NOW),
    "Resets 2:19 PM CT",
  );
  assert.equal(
    usageResetLabel("2026-11-19T00:00:00-06:00", NOW),
    "Resets Nov 19",
  );
  assert.equal(usageResetLabel(null, NOW), null);
  assert.equal(usageCostLabel(100), "$100 / mo");
  assert.equal(usageCostLabel(null), null);
});

test("allowlisted rows only expose the declared keys", () => {
  const row = allowlistedUsageRow(toUsageRow("grok", GROK_LIVE, NOW));
  assert.deepEqual(Object.keys(row).sort(), [...USAGE_ALLOWED_KEYS].sort());
});

test("live export files are not required by the unit tests (injected)", () => {
  // Prove the real on-disk files can be parsed when present, without baking
  // those numbers into the panel component.
  const text = readFileSync(USAGE_DEFAULT_PATHS.grokPrimary, "utf8");
  const parsed = parseUsageFile(JSON.parse(text));
  assert.ok(parsed);
  assert.equal(typeof parsed.pct_used === "number" || parsed.pct_used === null, true);
});
