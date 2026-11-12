import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { Dashboard } from "../src/components/dashboard.tsx";
import { dashboardFromFeeds } from "../src/lib/live-dashboard.ts";
import { mergeFeeds } from "../src/lib/feed-store.ts";
import {
  buildSnapshotAsync,
  toKvPayload,
} from "./produce-feeds.ts";
import type { DashboardData, DisplayConfig } from "../src/domains/models.ts";
import { containsForbidden } from "../src/lib/privacy.ts";

const OUT_DIR = "/workspace/cto/evidence/LIFE-DASH-V2/local";

const display: DisplayConfig = {
  timezone: "America/Chicago",
  locale: "en-US",
  currency: "USD",
  rotationSeconds: 25,
  pixelShift: false,
  modes: { morning: 6, day: 9, evening: 17, night: 22 },
};

function emptyFeed(
  provider: string,
  now: Date,
  error: string,
): DashboardData["weather"] & DashboardData["build"] {
  return {
    loading: false,
    data: null,
    source: "real",
    provider,
    status: "error",
    lastSuccess: null,
    lastAttempt: now.toISOString(),
    error,
    refreshMs: 900_000,
  };
}

function pageHtml(body: string, title: string): string {
  const tokens = readFileSync(
    "/workspace/projects/wt-life-dash-usage/src/styles/tokens.css",
    "utf8",
  );
  const globals = readFileSync(
    "/workspace/projects/wt-life-dash-usage/src/app/globals.css",
    "utf8",
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>${title}</title>
<style>
html, body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font-ui); }
${tokens}
${globals}
</style>
</head>
<body>${body}</body>
</html>`;
}

function assertClean(html: string, label: string) {
  if (containsForbidden(html)) {
    throw new Error(`FORBIDDEN_CONTENT_IN_RENDER ${label}`);
  }
  if (/\bEXAMPLE\b/.test(html)) {
    throw new Error(`EXAMPLE_CHIP_IN_RENDER ${label}`);
  }
  if (/\bChicago\b/i.test(html)) {
    throw new Error(`BANNED_CITY_IN_RENDER ${label}`);
  }
  if (html.includes("FEED ATTENTION")) {
    throw new Error(`FEED_ATTENTION_IN_RENDER ${label}`);
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const now = new Date();
  const snapshot = await buildSnapshotAsync({ now });
  const incoming = toKvPayload(snapshot);
  const feeds = mergeFeeds(null, incoming, now);
  const fromFeeds = dashboardFromFeeds(feeds, now);
  const data: DashboardData = {
    ...fromFeeds,
    weather: fromFeeds.weather.data ? fromFeeds.weather : emptyFeed("Open-Meteo", now, "weather feed unavailable"),
    build: fromFeeds.build.data ? fromFeeds.build : emptyFeed("GitHub", now, "build feed unavailable") as DashboardData["build"],
  };

  const renderedAt = now.toISOString();
  const homeBody = renderToString(
    Dashboard({
      initial: data,
      renderedAt,
      display,
      demo: false,
      forcedMode: "day",
      paused: true,
      page: "home",
    }),
  );
  const moneyBody = renderToString(
    Dashboard({
      initial: data,
      renderedAt,
      display,
      demo: false,
      forcedMode: "day",
      paused: true,
      page: "money",
    }),
  );

  // Static preview only: point tabs and the alert chip at sibling HTML files.
  // The Next.js app itself keeps / and /money.
  function staticLinks(html: string): string {
    return html
      .replaceAll('href="/money"', 'href="money.html"')
      .replaceAll('href="/"', 'href="index.html"');
  }
  const home = pageHtml(staticLinks(homeBody), "LifeDash");
  const money = pageHtml(staticLinks(moneyBody), "LifeDash — Money");
  assertClean(home, "home");
  assertClean(money, "money");

  writeFileSync(`${OUT_DIR}/index.html`, home, "utf8");
  writeFileSync(`${OUT_DIR}/money.html`, money, "utf8");

  const finance = data.finance.data;
  const usage = data.usage?.data;
  console.log(
    JSON.stringify(
      {
        out: OUT_DIR,
        homeBytes: home.length,
        moneyBytes: money.length,
        renderedAt,
        money: finance,
        health: data.health.data,
        bots: data.ai.data?.providers?.length ?? 0,
        decisions: data.decisions?.data?.count ?? 0,
        usageProviders: usage?.providers?.map((row) => ({
          id: row.id,
          pct: row.pct_used,
          stale: row.stale,
          manual: row.manual,
          as_of: row.as_of,
        })),
        systems: Boolean(data.systems.data),
        hasExample: home.includes("EXAMPLE") || money.includes("EXAMPLE"),
        hasChicago: /Chicago/i.test(home) || /Chicago/i.test(money),
        hasAlertChip: home.includes("1 alert"),
        hasMoneyOnHome: home.includes('id="money-title"'),
        hasBills: money.includes("New-lease first month"),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
