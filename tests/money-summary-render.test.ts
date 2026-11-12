import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderToString } from "react-dom/server";
import { Dashboard } from "../src/components/dashboard";
import type { DashboardData, DisplayConfig } from "../src/domains/models";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures/dashboard-data.json"), "utf8"),
) as { serverTime: string; data: DashboardData };

const display: DisplayConfig = {
  timezone: "America/Chicago",
  locale: "en-US",
  currency: "USD",
  rotationSeconds: 25,
  pixelShift: false,
  modes: { morning: 6, day: 9, evening: 17, night: 22 },
};

/** React splits interpolated text with `<!-- -->` markers; strip them for assertions. */
function text(html: string) {
  return html.replace(/<!-- -->/g, "");
}

function render(data: DashboardData, page: "home" | "money" = "home") {
  return text(
    renderToString(
      Dashboard({
        initial: data,
        renderedAt: fixture.serverTime,
        display,
        demo: false,
        forcedMode: "day",
        paused: true,
        page,
      }),
    ),
  );
}

test("the money card renders the trimmed finance summary on the Money page", () => {
  const data = structuredClone(fixture.data);
  const summary = {
    cashOnHand: 1234,
    billsDueTotal: 321,
    billsDueCount: 2,
    depositTarget: 5000,
    status: "ok" as const,
    bills: [
      { name: "Synthetic utility", due: "2026-11-03", amount: 200 },
      { name: "Synthetic subscription", due: "2026-11-05", amount: 121 },
    ],
  };
  (data.finance as unknown as { data: typeof summary }).data = summary;

  const html = render(data, "money");

  for (const expected of [
    "Cash on hand",
    "$1,234.00",
    "Bills due",
    "$321.00",
    "2 bills",
    "Synthetic utility",
    "Nov 3",
    "Synthetic subscription",
    "Nov 5",
    "$200.00",
    "$121.00",
  ]) {
    assert.ok(html.includes(expected), `expected money page to include ${expected}`);
  }
  assert.ok(!html.includes("On track"), "no four-up status word on the Money page");
  assert.ok(!html.includes("EXAMPLE"), "no EXAMPLE chips");
  assert.ok(html.includes("dashboard-bills"), "bills table is rendered");
  assert.match(html, /<th class="due">Due<\/th>/);
  assert.match(html, /<td class="due">Nov 3<\/td>/);
  const moneyCardStart = html.indexOf("dashboard-card-money");
  assert.notEqual(moneyCardStart, -1, "money card should be rendered");
  const moneyCardEnd = html.indexOf("</section>", moneyCardStart);
  assert.notEqual(moneyCardEnd, -1, "money card should have a closing section");
  const moneyCard = html.slice(moneyCardStart, moneyCardEnd);
  assert.ok(!moneyCard.includes("No data"), moneyCard);
});

test("Home does not include the Money panel; the header chip links to /money when alerting", () => {
  const data = structuredClone(fixture.data);
  const summary = {
    cashOnHand: 100,
    billsDueTotal: 200,
    billsDueCount: 1,
    depositTarget: null,
    status: "alert" as const,
    bills: [{ name: "Synthetic rent", due: "2026-11-12", amount: 200 }],
  };
  (data.finance as unknown as { data: typeof summary }).data = summary;

  const home = render(data, "home");
  assert.ok(!home.includes('id="money-title"'), "Money is not a Home panel");
  assert.ok(!home.includes("Synthetic rent"), "bill names do not appear on Home");
  assert.match(home, /href="\/money"/);
  assert.match(home, /1 alert/);
  assert.ok(!home.includes("FEED ATTENTION"));
  assert.ok(!home.includes("EXAMPLE"));

  const money = render(data, "money");
  assert.ok(money.includes("dashboard-card-money"));
  assert.ok(money.includes("dashboard-card-money alert") || money.includes("alert"));
  assert.ok(money.includes("Bills due exceed cash by $100.00."));
  assert.ok(money.includes("Left after bills"));
  assert.ok(money.includes("-$100.00") || money.includes("−$100.00"));
  assert.ok(!money.includes(">Alert.<") && !money.includes("Alert.</"));
  assert.ok(money.includes("Synthetic rent"));
  assert.match(money, /1 alert/);
});

test("Money empty state is a one-line message, not invented figures", () => {
  const data = structuredClone(fixture.data);
  data.finance = {
    ...data.finance,
    data: null,
    source: "real",
    status: "error",
    lastSuccess: null,
    error: "missing",
  };
  const html = render(data, "money");
  assert.ok(html.includes("No money data yet."));
  assert.ok(!html.includes("EXAMPLE"));
  assert.ok(!html.includes("$1,200"));
});

test("Money sorts past-due first, labels No date and Amount ?, and states leftover cash", () => {
  const data = structuredClone(fixture.data);
  const summary = {
    cashOnHand: 1407.9,
    billsDueTotal: 1405.85,
    billsDueCount: 4,
    depositTarget: null,
    status: "alert" as const,
    bills: [
      { name: "Upcoming sub", due: "2026-11-15", amount: 21.64 },
      { name: "Past dated", due: "2026-11-10", amount: 5.4 },
      { name: "No date bill", due: "unknown", amount: 288.91 },
      { name: "Overdue loan", due: "past due", amount: null },
    ],
  };
  (data.finance as unknown as { data: typeof summary }).data = summary;
  const money = render(data, "money");
  assert.ok(money.includes("Cash covers bills by $2.05."));
  assert.ok(money.includes("Left after bills"));
  assert.ok(money.includes("$2.05"));
  assert.ok(money.includes("No date"));
  assert.ok(!money.includes("Unknown"));
  assert.ok(money.includes("Amount ?"));
  assert.ok(money.includes("past-due"));
  // Past due and overdue first: Overdue loan (explicit past due) then Past dated (Nov 10), then Upcoming, then no date.
  const order = ["Overdue loan", "Past dated", "Upcoming sub", "No date bill"].map((name) =>
    money.indexOf(name),
  );
  assert.ok(order.every((i) => i >= 0), "all four bill names render");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "bills render in past-due-first order");
});
