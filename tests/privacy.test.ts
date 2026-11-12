import test from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { Dashboard } from "../src/components/dashboard";
import { containsForbidden, stripPrivate } from "../src/lib/privacy";
import { botsToAiState } from "../src/lib/feed-adapters";
import type { DashboardData, DataState, DisplayConfig } from "../src/domains/models";

test("stripPrivate removes WoW, phone numbers, secrets, and account numbers", () => {
  const dirty =
    "review Board Ready card for WoW/Inbox move, call 361-986-1117, token=sk-live-abc, account 1234-5678-9012-3456";
  const clean = stripPrivate(dirty);
  assert.equal(containsForbidden(clean), false);
  assert.doesNotMatch(clean, /\bWoW\b/i);
  assert.doesNotMatch(clean, /361-986-1117/);
  assert.doesNotMatch(clean, /sk-live-abc/);
  assert.doesNotMatch(clean, /1234-5678-9012-3456/);
  assert.match(clean, /Inbox/);
});

test("botsToAiState strips WoW from needs_josh and marks waiting", () => {
  const state = botsToAiState({
    bots: [
      {
        bot: "Archive",
        working_on: null,
        next_up: null,
        needs_josh: "review Board Ready card for WoW/Inbox move",
      },
    ],
  });
  assert.equal(state?.providers[0]?.status, "waiting");
  assert.equal(state?.providers[0]?.value, "needs Josh");
  const detail = state?.providers[0]?.detail ?? "";
  assert.match(detail, /waiting on Josh/i);
  assert.doesNotMatch(detail, /\bWoW\b/i);
  assert.match(detail, /Inbox/);
});

const display: DisplayConfig = {
  timezone: "America/Chicago",
  locale: "en-US",
  currency: "USD",
  rotationSeconds: 25,
  pixelShift: false,
  modes: { morning: 6, day: 9, evening: 17, night: 22 },
};

function feed<T>(data: T | null, source: "real" | "mock" = "real"): DataState<T> {
  return {
    loading: false,
    data,
    source,
    provider: source === "mock" ? "Mock" : "Real",
    status: data === null ? "error" : "ready",
    lastSuccess: data === null ? null : "2026-11-12T16:18:00.000Z",
    lastAttempt: "2026-11-12T16:18:00.000Z",
    error: data === null ? "none" : null,
    refreshMs: 3_600_000,
  };
}

function emptyData(): DashboardData {
  const empty = feed(null);
  return {
    weather: empty,
    calendar: empty,
    reminders: empty,
    finance: empty,
    health: empty,
    build: empty,
    ai: empty,
    systems: empty,
    habits: empty,
    goals: empty,
  } as unknown as DashboardData;
}

function render(data: DashboardData, page: "home" | "money" = "home") {
  return renderToString(
    Dashboard({
      initial: data,
      renderedAt: "2026-11-12T16:30:00.000Z",
      display,
      demo: false,
      forcedMode: "day",
      paused: true,
      page,
      useData: () => ({
        data,
        systemHistory: [],
        connectionError: false,
        receivedAt: Date.parse("2026-11-12T16:30:00.000Z"),
        transport: "poll",
      }),
    }),
  ).replace(/<!-- -->/g, "");
}

test("privacy strip is applied in rendered bot and decision text", () => {
  const data = emptyData();
  data.ai = feed({
    providers: [
      {
        name: "Archive",
        status: "waiting",
        remainingPercent: null,
        detail: "waiting on Josh: review Board Ready card for WoW/Inbox move",
        value: "needs Josh",
        requestsToday: null,
        tokensToday: null,
        costToday: null,
        jobsCompleted: null,
        errors: null,
      },
    ],
  });
  data.decisions = feed({
    count: 1,
    cards: [
      {
        bot: "Archive",
        question: "Move the WoW hub and restore Inbox?",
        blocking: true,
      },
    ],
  });
  const html = render(data);
  assert.doesNotMatch(html, /\bWoW\b/i);
  assert.doesNotMatch(html, /World of Warcraft/i);
  assert.match(html, /Inbox/);
  assert.match(html, /Archive/);
});

test("money and health summaries render real values with as-of, mocks stay hidden", () => {
  const data = emptyData();
  data.finance = feed({
    cashOnHand: 694.9,
    billsDueTotal: 415.95,
    billsDueCount: 4,
    depositTarget: 2600,
    status: "alert",
  }) as unknown as DashboardData["finance"];
  data.health = feed({
    trainingDoneToday: null,
    streak: null,
    nextSession:
      "Waiting on Josh: pick an eye exam time, or a dentist path. Call 361-986-1117.",
  }) as unknown as DashboardData["health"];
  const home = render(data, "home");
  const html = render(data, "money");
  assert.match(html, /Cash on hand/);
  assert.match(html, /\$694\.90/);
  assert.match(html, /Bills due/);
  assert.match(html, /\$415\.95/);
  assert.match(html, /4 bills/);
  assert.match(html, /Cash covers bills by \$278\.95/);
  assert.match(html, /Left after bills/);
  assert.match(html, /as of Nov 12, 10:18 AM CT/);
  assert.match(home, /1 alert/);
  assert.match(home, /href="\/money"/);
  assert.doesNotMatch(home, /Cash on hand/);
  assert.match(home, /Waiting on Josh: pick an eye exam time/);
  assert.match(home, /as of Nov 12, 10:18 AM CT/);
  assert.doesNotMatch(html, /361-986-1117/);
  assert.doesNotMatch(home, /361-986-1117/);
  assert.doesNotMatch(html, /— steps/);
  assert.doesNotMatch(html, /0 min exercise/);
  assert.doesNotMatch(html, /4,284/);
  assert.doesNotMatch(html, /Run 100 miles/);
  assert.doesNotMatch(html, /Homelab refresh/);

  const mocked = emptyData();
  mocked.finance = feed(
    {
      checking: 4284,
      savings: 6120,
      emergencyFund: 7620,
      emergencyTarget: 10000,
      payday: "2026-11-13",
      spending: 1842,
      spendingBudget: 2800,
      investments: 28460,
      investmentChange: 2.4,
      bills: [],
    },
    "mock",
  );
  mocked.health = feed(
    { steps: 100, exerciseMinutes: 0, workout: null } as never,
    "mock",
  );
  mocked.goals = feed(
    {
      goals: [{ title: "Run 100 miles", current: 68, target: 100, unit: "mi" }],
      projects: [
        { name: "Homelab refresh", detail: "Backups", progress: 45 },
      ],
    },
    "mock",
  );
  const mockHtml = render(mocked);
  assert.doesNotMatch(mockHtml, /4,284/);
  assert.doesNotMatch(mockHtml, /Run 100 miles/);
  assert.doesNotMatch(mockHtml, /Homelab refresh/);
  assert.doesNotMatch(mockHtml, /id="money-title"/);
  assert.doesNotMatch(mockHtml, /id="health-title"/);
  assert.doesNotMatch(mockHtml, /id="goals-title"/);

  const emptyHealth = emptyData();
  emptyHealth.health = feed({
    trainingDoneToday: null,
    streak: null,
    nextSession: null,
  }) as unknown as DashboardData["health"];
  const emptyHtml = render(emptyHealth);
  assert.doesNotMatch(emptyHtml, /id="health-title"/);
});
