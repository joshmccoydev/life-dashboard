import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderToString } from "react-dom/server";
import { Dashboard } from "../src/components/dashboard";
import { Feed } from "../src/components/shared/feed";
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

test("with-data SSR output has deterministic LifeDash navigation in every mode", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date(fixture.serverTime) });
  try {
    for (const mode of MODES) {
      const first = renderFixture(fixture.data, mode);
      const second = renderFixture(fixture.data, mode);
      assert.equal(first, second, mode);
      assert.match(first, /aria-label="LifeDash navigation"/);
      assert.match(first, /href="https:\/\/agents\.j0sh\.wtf\/"/);
      assert.match(first, /class="dashboard-tabs"/);
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

test("a real feed with null data hides those panels and is not counted LIVE", () => {
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
  for (const id of [
    "bots",
    "money",
    "health",
    "schedule",
    "reminders",
    "github",
    "goals",
    "projects",
    "systems",
  ]) {
    assert.ok(
      !html.includes(`id="${id}-title"`),
      `${id} panel should be hidden when its feed is null`,
    );
  }
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

test("null feeds are hidden and empty-but-present lists keep their copy", () => {
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
  assert.ok(!nullHtml.includes('id="schedule-title"'));
  assert.ok(!nullHtml.includes('id="reminders-title"'));
  assert.ok(!nullText.includes("No upcoming payments"));
  assert.ok(!nullText.includes("No work events ahead"));
  assert.ok(!nullText.includes("No personal events ahead"));
  assert.ok(!nullText.includes("No habits in the Habits list"));

  const emptyData = structuredClone(fixture.data);
  emptyData.calendar.data = { events: [] };
  emptyData.reminders.data = { items: [] };
  emptyData.habits.data = { habits: [], date: emptyData.habits.data!.date };
  emptyData.goals.data = { goals: [], projects: [] };
  const emptyHtml = renderFixture(emptyData, "day");
  const emptyText = text(emptyHtml);
  // Empty Apple-backed lists remain visible with their explicit empty copy.
  assert.ok(!emptyHtml.includes('id="schedule-title"'));
  assert.ok(emptyHtml.includes('id="reminders-title"'));
  assert.ok(emptyHtml.includes('id="habits-title"'));
  assert.ok(emptyHtml.includes('id="goals-title"'));
  assert.ok(emptyText.includes("No reminders"));
  assert.ok(emptyText.includes("No habits in the Habits list"));
  assert.ok(emptyText.includes("No goals"));
  assert.ok(!emptyText.includes("No work events ahead"));
});

test("a NO DATA feed never picks up a stale suffix", () => {
  const html = renderToString(
    Feed({
      state: {
        loading: false,
        data: null,
        source: "real",
        provider: "Demo",
        status: "error",
        lastSuccess: null,
        lastAttempt: "2026-10-03T04:08:00.000Z",
        error: "Unavailable",
        refreshMs: 60000,
      },
      now: new Date("2026-10-03T04:20:00.000Z"),
    }),
  );
  assert.equal(html.match(/>NO DATA</g)?.length, 1);
  assert.ok(!html.includes("UNAVAILABLE"), html);
  assert.ok(!html.includes("STALE"), html);
  assert.ok(!html.includes("feed-divider"), html);
});

// The last accepted refresh is 25 hours behind the ticking clock, and the
// feeds are 1 second old at that refresh: deriving the clock straight from
// `receivedAt` reports a fresh dashboard, the ticking clock reports stale feeds.
const CLOCK_RECEIVED_AT = Date.parse("2026-10-03T04:00:00.000Z");
const CLOCK_NOW = CLOCK_RECEIVED_AT + 25 * 60 * 60_000;

function clockFixture(): DashboardData {
  const data = structuredClone(fixture.data);
  for (const state of Object.values(data)) {
    state.refreshMs = 30000;
    state.status = "ready";
    state.lastSuccess = new Date(CLOCK_RECEIVED_AT - 1000).toISOString();
  }
  return data;
}

test("the dashboard clock keeps ticking past the last refresh", () => {
  const data = clockFixture();
  const html = renderToString(
    Dashboard({
      initial: data,
      renderedAt: new Date(CLOCK_NOW).toISOString(),
      display,
      demo: false,
      forcedMode: "day",
      paused: true,
      useData: () => ({
        data,
        systemHistory: [],
        connectionError: false,
        receivedAt: CLOCK_RECEIVED_AT,
        transport: "poll",
      }),
    }),
  );
  assert.ok(html.includes("STALE"), "the ticking clock drives staleness");
  assert.ok(!html.includes("FEED ATTENTION"), "stale feeds do not set FEED ATTENTION");
});
