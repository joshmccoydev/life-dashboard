import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { Dashboard } from "../src/components/dashboard";
import type { DashboardData, DataState, DisplayConfig, UsageState } from "../src/domains/models";
import { toUsageRow, type RawUsage } from "../src/lib/usage.ts";

const NOW = "2026-11-12T16:50:00.000Z";
const UPDATED = "2026-11-12T16:44:43.000Z";

const display: DisplayConfig = {
  timezone: "America/Chicago",
  locale: "en-US",
  currency: "USD",
  rotationSeconds: 25,
  pixelShift: false,
  modes: { morning: 6, day: 9, evening: 17, night: 22 },
};

function feed<T>(data: T | null, lastSuccess: string | null = UPDATED): DataState<T> {
  return {
    loading: false,
    data,
    source: "real",
    provider: "Synthetic",
    status: data === null ? "error" : "ready",
    lastSuccess,
    lastAttempt: lastSuccess ?? NOW,
    error: data === null ? "none" : null,
    refreshMs: 3_600_000,
  };
}

function emptyDashboard(): DashboardData {
  const nullFeed = feed(null, null);
  return {
    weather: nullFeed as unknown as DashboardData["weather"],
    calendar: nullFeed as unknown as DashboardData["calendar"],
    reminders: nullFeed as unknown as DashboardData["reminders"],
    finance: nullFeed as unknown as DashboardData["finance"],
    health: nullFeed as unknown as DashboardData["health"],
    build: nullFeed as unknown as DashboardData["build"],
    ai: nullFeed as unknown as DashboardData["ai"],
    systems: nullFeed as unknown as DashboardData["systems"],
    habits: nullFeed as unknown as DashboardData["habits"],
    goals: nullFeed as unknown as DashboardData["goals"],
  };
}

function render(data: DashboardData): string {
  return renderToString(
    Dashboard({
      initial: data,
      renderedAt: NOW,
      display,
      demo: false,
      forcedMode: "day",
      paused: true,
      useData: () => ({
        data,
        systemHistory: [],
        connectionError: false,
        receivedAt: Date.parse(NOW),
        transport: "poll",
      }),
    }),
  );
}

function visible(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function usageHtml(state: UsageState, lastSuccess = UPDATED): string {
  const data = emptyDashboard();
  data.usage = feed(state, lastSuccess);
  return render(data);
}

const NOW_DATE = new Date(NOW);

test("Usage panel renders four seats from props, not mock example figures", () => {
  const grokRaw: RawUsage = {
    as_of: "2026-11-12T10:44:43-06:00",
    plan: "Super",
    pct_used: 15,
    resets_at: "2026-11-12T14:19:00-06:00",
    monthly_cost_usd: 100,
    source: "CheckSubscriptionUsage",
    note: "cost is list price; invoice not checked",
  };
  const state: UsageState = {
    providers: [
      toUsageRow("grok", grokRaw, NOW_DATE),
      toUsageRow(
        "chatgpt",
        {
          as_of: "2026-11-05T15:40:00-06:00",
          plan: "ChatGPT Plus (Codex)",
          pct_used: 0,
          resets_at: null,
          monthly_cost_usd: 20,
          source: "manual",
          note: "last known Nov 5; stale",
        },
        NOW_DATE,
      ),
      toUsageRow(
        "opencode",
        {
          as_of: "2026-11-05T15:40:00-06:00",
          plan: "OpenCode Go",
          pct_used: 52,
          resets_at: "2026-11-19T00:00:00-06:00",
          monthly_cost_usd: 10,
          source: "manual",
          note: "stale",
        },
        NOW_DATE,
      ),
      toUsageRow(
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
        NOW_DATE,
      ),
    ],
  };

  const html = usageHtml(state, "2026-11-12T10:44:43-06:00");
  const text = visible(html);
  assert.match(text, /Grok Bot/);
  assert.match(text, /ChatGPT/);
  assert.match(text, /OpenCode Go/);
  assert.match(text, /Nous/);
  assert.match(text, /15%/);
  assert.match(text, /0%/);
  assert.match(text, /52%/);
  assert.match(text, /\$100 \/ mo/);
  assert.match(text, /\$20 \/ mo/);
  assert.match(text, /\$10 \/ mo/);
  assert.match(text, /Resets 2:19 PM CT/);
  assert.match(text, /Resets Nov 19/);
  assert.match(text, /CheckSubscriptionUsage/);
  assert.match(text, /as of/i);
  // Nous unknown percent is the word "manual" (empty track), not an invented number or a bare dash.
  assert.match(html, /dashboard-usage-pct[^>]*>manual</);
  // Prefer STALE on manual+stale ChatGPT/OpenCode; MANUAL on fresh Nous; none on live Grok.
  const grokCard = html.split("Grok Bot")[1].split("ChatGPT")[0];
  const chatgptCard = html.split("ChatGPT")[1].split("OpenCode Go")[0];
  const nousCard = html.split("Nous")[1];
  assert.doesNotMatch(grokCard, />stale</i);
  assert.doesNotMatch(grokCard, />manual</i);
  assert.match(chatgptCard, />stale</i);
  assert.match(nousCard, />manual</i);
  // Mock example figures and EXAMPLE chips must never ship.
  assert.doesNotMatch(text, /\b42%\b/);
  assert.doesNotMatch(text, /\bEXAMPLE\b/i);
  assert.doesNotMatch(html, /class="example"/);

  // Not baked in: changing the input changes the output.
  const changed = usageHtml({
    providers: [
      toUsageRow("grok", { ...grokRaw, pct_used: 37 }, NOW_DATE),
      state.providers[1],
      state.providers[2],
      state.providers[3],
    ],
  });
  assert.match(visible(changed), /37%/);
  assert.doesNotMatch(visible(changed), /15%/);
});

test("Usage panel is absent when the feed is not on the payload (no invented rows)", () => {
  const html = render(emptyDashboard());
  assert.doesNotMatch(html, /id="usage-title"/);
  assert.doesNotMatch(visible(html), /No usage figures yet/);
});

test("Usage panel source file has no baked live percentages", () => {
  const source = readFileSync(
    new URL("../src/components/dashboard.tsx", import.meta.url),
    "utf8",
  );
  const usageFn = source.split("function UsagePanel")[1]?.split("function SchedulePanel")[0] ?? "";
  assert.ok(usageFn.length > 100, "UsagePanel is in dashboard.tsx");
  assert.doesNotMatch(usageFn, /15%/);
  assert.doesNotMatch(usageFn, /2:19/);
  assert.doesNotMatch(usageFn, /42%/);
  assert.doesNotMatch(usageFn, /EXAMPLE/i);
});
