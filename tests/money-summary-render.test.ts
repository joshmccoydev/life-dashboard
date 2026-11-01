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

test("the money card renders the trimmed finance summary", () => {
  const data = structuredClone(fixture.data);
  const summary = {
    cashOnHand: 1234,
    billsDueTotal: 321,
    billsDueCount: 2,
    depositTarget: 5000,
    status: "ok",
  };
  (data.finance as unknown as { data: typeof summary }).data = summary;

  const html = text(
    renderToString(
      Dashboard({
        initial: data,
        renderedAt: fixture.serverTime,
        display,
        demo: false,
        forcedMode: "day",
        paused: true,
      }),
    ),
  );

  for (const expected of [
    "Cash on hand",
    "$1,234",
    "Bills due",
    "$321",
    "2 bills",
    "On track",
  ]) {
    assert.ok(html.includes(expected), `expected dashboard to include ${expected}`);
  }

  const moneyCardStart = html.indexOf("dashboard-card-money");
  assert.notEqual(moneyCardStart, -1, "money card should be rendered");
  const moneyCardEnd = html.indexOf("</section>", moneyCardStart);
  assert.notEqual(moneyCardEnd, -1, "money card should have a closing section");
  const moneyCard = html.slice(moneyCardStart, moneyCardEnd);
  assert.ok(!moneyCard.includes("No data"), moneyCard);
});
