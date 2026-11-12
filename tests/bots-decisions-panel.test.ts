import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";
import { Dashboard } from "../src/components/dashboard";
import type { AIProvider, DashboardData, DataState, DisplayConfig } from "../src/domains/models";

const NOW = "2026-11-12T16:50:00.000Z";
const UPDATED = "2026-11-12T16:36:00.000Z";

const display: DisplayConfig = {
  timezone: "America/Chicago",
  locale: "en-US",
  currency: "USD",
  rotationSeconds: 25,
  pixelShift: false,
  modes: { morning: 6, day: 9, evening: 17, night: 22 },
};

function feed<T>(data: T | null): DataState<T> {
  return {
    loading: false,
    data,
    source: "real",
    provider: "Synthetic",
    status: data === null ? "error" : "ready",
    lastSuccess: data === null ? null : UPDATED,
    lastAttempt: UPDATED,
    error: data === null ? "none" : null,
    refreshMs: 3_600_000,
  };
}

function base(): DashboardData {
  const nullFeed = feed(null);
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

function provider(
  name: string,
  status: AIProvider["status"],
  updatedAt: string | null,
  detail?: string,
): AIProvider {
  return {
    name,
    status,
    remainingPercent: null,
    value: status === "waiting" ? "needs Josh" : undefined,
    detail,
    updatedAt,
    requestsToday: null,
    tokensToday: null,
    costToday: null,
    jobsCompleted: null,
    errors: null,
  };
}

test("Bots is a compact two-column grid with a status dot and no paragraphs", () => {
  const data = base();
  data.ai = feed({
    providers: [
      provider(
        "Chief",
        "waiting",
        "2026-11-12T10:30:00-06:00",
        "waiting on Josh: confirm the lease — credential vault-token-xyz and $4,284 checking",
      ),
      provider("Archive", "running", "2026-11-12T10:35:00-06:00", "Wrote the open-decisions list"),
      provider("Woz", "idle", null, "No recent action"),
    ],
  });
  const html = render(data);
  const text = visible(html);
  assert.match(html, /dashboard-bots-grid/);
  assert.match(html, /dashboard-bot-dot ask/);
  assert.match(html, /aria-label="Needs Josh"/);
  assert.match(html, /title="Needs Josh"/);
  assert.match(html, /title="Working"/);
  assert.match(html, /title="Idle"/);
  assert.match(html, /dashboard-bot-dot working/);
  assert.match(html, /dashboard-bot-dot idle/);
  assert.match(html, /dashboard-bots-legend/);
  assert.match(html, /aria-label="Bot status"/);
  const legend = html.split('class="dashboard-bots-legend"')[1] ?? "";
  assert.match(legend, /working/);
  assert.match(legend, /idle/);
  assert.match(legend, /blocked/);
  assert.match(legend, /needs Josh/);
  assert.doesNotMatch(legend, /\bPaused\b/);
  assert.doesNotMatch(text, /\bPaused\b/);
  assert.match(text, /10:30 AM/);
  assert.match(text, /10:35 AM/);
  // Last run missing is an em dash, not invented.
  assert.match(html, /<span class="run">—<\/span>/);
  // No waiting-on paragraph, no credential or private money on the home glance.
  assert.doesNotMatch(text, /waiting on Josh: confirm the lease/);
  assert.doesNotMatch(text, /vault-token-xyz/);
  assert.doesNotMatch(text, /4,284/);
  assert.doesNotMatch(text, /Wrote the open-decisions list/);
  assert.doesNotMatch(text, /No recent action/);
});

test("Bots caps visible rows at 15 and then says N more", () => {
  const data = base();
  data.ai = feed({
    providers: Array.from({ length: 17 }, (_, i) =>
      provider(`Bot${i + 1}`, "idle", "2026-11-12T10:00:00-06:00"),
    ),
  });
  const html = render(data);
  assert.equal((html.match(/class="dashboard-bot-cell"/g) ?? []).length, 15);
  assert.match(visible(html), /2 more/);
  assert.doesNotMatch(visible(html), /Bot16/);
});

test("Decisions home shows at most 5 in file order, a See all control, and as-of", () => {
  const data = base();
  data.decisions = feed({
    count: 10,
    generatedAt: "2026-11-12T10:51:00-06:00",
    cards: [
      { id: "lease-first-month", bot: "Ledger", question: "Confirm the lease first month" },
      { id: "lease-appointment", bot: "Mailroom", question: "Pick a lease signing and move window" },
      { id: "chamber-awards-gala", bot: "Scout", question: "Chamber Awards Gala — nominate?" },
      { id: "lozano-shifts", bot: "Mailroom", question: "Confirm usual Lozano holds" },
      { id: "piba-venue-question", bot: "Mailroom", question: "Send the drafted PIBA venue question?" },
      { id: "trueaccord-dispute", bot: "Mailroom", question: "TrueAccord letter — dispute, pay, or ignore" },
      { id: "postiz-reinstall", bot: "Forge", question: "Reinstall the Postiz stack" },
    ],
  });
  const html = render(data);
  const text = visible(html);
  assert.match(text, /Confirm the lease first month/);
  assert.match(text, /Send the drafted PIBA venue question/);
  assert.doesNotMatch(text, /TrueAccord/);
  assert.doesNotMatch(text, /Reinstall the Postiz/);
  assert.match(text, /See all 10 open items/);
  assert.doesNotMatch(text, /Open all 10/);
  assert.match(text, /as of/i);
  assert.match(html, /href="\/decisions"/);
  // Stockpile leftovers must not be invented onto the panel.
  assert.doesNotMatch(text, /feat\/decisions/i);
  assert.equal((html.match(/class="dashboard-decision-row/g) ?? []).length, 5);
});
