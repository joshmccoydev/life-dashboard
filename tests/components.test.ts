import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderToString } from "react-dom/server";
import { Dashboard } from "../src/components/dashboard";
import type { DashboardData, DisplayConfig, Mode } from "../src/domains/models";

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

const MODES: Mode[] = ["morning", "day", "evening", "night"];

function renderFixture(data: DashboardData, mode: Mode, renderedAt = fixture.serverTime) {
  return renderToString(
    Dashboard({
      initial: data,
      renderedAt,
      display,
      demo: false,
      forcedMode: mode,
      paused: true,
    }),
  );
}

/** React splits interpolated text with `<!-- -->` markers; strip them for assertions. */
function text(html: string) {
  return html.replace(/<!-- -->/g, "");
}

test("with-data SSR output is byte-identical to the origin/main goldens", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date(fixture.serverTime) });
  try {
    for (const mode of MODES) {
      const golden = readFileSync(
        join(here, `fixtures/dashboard-${mode}.html`),
        "utf8",
      );
      assert.equal(renderFixture(fixture.data, mode), golden, mode);
    }
  } finally {
    mock.timers.reset();
  }
});

function withAllFeeds<T>(data: DashboardData, mutate: (state: T) => void) {
  const copy = structuredClone(data) as unknown as Record<string, T>;
  for (const state of Object.values(copy)) mutate(state);
  return copy as unknown as DashboardData;
}

test("a real feed with null data shows NO DATA and is not counted LIVE", () => {
  const data = withAllFeeds<Record<string, unknown>>(fixture.data, (state) => {
    state.data = null;
    state.source = "real";
    state.status = "error";
    state.lastSuccess = null;
    state.error = "Unavailable";
  });
  const html = renderFixture(data, "day");
  const feeds = Object.keys(data);
  const visible = feeds.filter((key) => key !== "health" && key !== "finance");
  assert.equal(feeds.length, 10, "fixture has ten feeds");
  assert.equal(visible.length, feeds.length - 2, "health and finance excluded");
  assert.equal(
    html.match(/>NO DATA</g)?.length,
    visible.length + 2,
    "eight section badges, the weather header badge, and one in the footer",
  );
  assert.ok(!html.includes(">LIVE"));
  assert.ok(!html.includes("LIVE / UNAVAILABLE"));
  assert.ok(!html.includes("NO DATA / UNAVAILABLE"));
  assert.ok(!html.includes("NO DATA<i"));
  assert.ok(
    html.includes(
      `0<!-- --> LIVE <span class="footer-divider">/</span> <!-- -->0<!-- --> DEMO / ${visible.length} NO DATA FEEDS`,
    ),
  );
});

test("an all-demo dashboard still reads N LIVE / M DEMO FEEDS", () => {
  const data = withAllFeeds<Record<string, unknown>>(fixture.data, (state) => {
    state.source = "mock";
    state.status = "ready";
  });
  const html = renderFixture(data, "day");
  const visible = Object.keys(data).filter(
    (key) => key !== "health" && key !== "finance",
  ).length;
  assert.ok(
    html.includes(
      `0<!-- --> LIVE <span class="footer-divider">/</span> <!-- -->${visible}<!-- --> DEMO FEEDS`,
    ),
  );
  assert.ok(!html.includes("NO DATA"));
});

test("a mixed dashboard counts each feed exactly once", () => {
  const keys = Object.keys(fixture.data).filter(
    (key) => key !== "health" && key !== "finance",
  );
  const data = withAllFeeds<Record<string, unknown>>(fixture.data, (state) => {
    state.status = "ready";
    state.lastSuccess = fixture.serverTime;
    state.source = "mock";
    state.data = state.data ?? null;
  });
  const recordData = data as unknown as Record<string, Record<string, unknown>>;
  recordData[keys[0]].source = "real";
  recordData[keys[1]].source = "real";
  recordData[keys[0]].data = null;
  const html = renderFixture(data, "day");
  const live = 1;
  const demo = keys.length - 2;
  const noData = 1;
  assert.ok(
    html.includes(
      `${live}<!-- --> LIVE <span class="footer-divider">/</span> <!-- -->${demo}<!-- --> DEMO / ${noData} NO DATA FEEDS`,
    ),
  );
});

test("null feeds render 'No data' and empty-but-present lists keep their copy", () => {
  const nullData = withAllFeeds<Record<string, unknown>>(
    fixture.data,
    (state) => {
      state.data = null;
      state.source = "real";
      state.status = "error";
      state.lastSuccess = null;
    },
  );
  const nullHtml = renderFixture(nullData, "day");
  const nullText = text(nullHtml);
  assert.ok(nullHtml.includes('class="domain-empty">No data</div>'));
  assert.ok(!nullText.includes("No upcoming payments"));
  assert.ok(!nullText.includes("No work events ahead"));
  assert.ok(!nullText.includes("No personal events ahead"));
  assert.ok(!nullText.includes("No habits in the Habits list"));

  const emptyData = structuredClone(fixture.data);
  emptyData.calendar.data = { events: [] };
  emptyData.reminders.data = { items: [] };
  emptyData.habits.data = { habits: [], date: emptyData.habits.data!.date };
  const emptyHtml = renderFixture(emptyData, "day");
  const emptyText = text(emptyHtml);
  assert.ok(emptyText.includes("No upcoming payments"));
  assert.ok(emptyText.includes("No work events ahead"));
  assert.ok(emptyText.includes("No personal events ahead"));
  assert.ok(emptyText.includes("No habits in the Habits list"));
});
