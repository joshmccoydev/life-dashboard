import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLedgerFile,
  ledgerToStatusBots,
  readLedgerBots,
  parseChicagoStamp,
} from "../src/lib/bots-ledger.ts";

// Contract-shaped fixture (CTO-0279). Invented ids and times; not live data.
const fixture = {
  as_of: "2026-11-12T17:00:00Z",
  items: [
    {
      work_id: "SYNTHETIC-1",
      title: "Shared work ledger on agents.j0sh.wtf",
      owner_bot: "Forge",
      team: "grok",
      status: "doing",
      next_step: "Upload a preview and send Chief the URL",
      needs_josh: false,
      needs_josh_ask: "",
      links: [{ label: "PR", url: "https://example.com/pr/0" }],
      updated_at: "2026-11-12T17:00:00Z",
      updated_by: "Forge",
    },
    {
      work_id: "SYNTHETIC-2",
      title: "Ask Josh about a photo",
      owner_bot: "Canvas",
      team: "grok",
      status: "blocked",
      next_step: "Wait for a new headshot",
      needs_josh: true,
      needs_josh_ask: "new headshot photo",
      updated_at: "2026-11-12T16:00:00Z",
      updated_by: "Canvas",
    },
    {
      work_id: "SYNTHETIC-3",
      title: "Older Canvas item",
      owner_bot: "Canvas",
      team: "grok",
      status: "queued",
      next_step: "Draft",
      needs_josh: false,
      needs_josh_ask: "",
      updated_at: "2026-11-11T16:00:00Z",
      updated_by: "Canvas",
    },
  ],
};

test("parseLedgerFile reads the CTO-0279 GET /ledger.json shape", () => {
  const file = parseLedgerFile(fixture);
  assert.ok(file);
  assert.equal(file.as_of, "2026-11-12T17:00:00Z");
  assert.equal(file.items.length, 3);
  assert.equal(file.items[1]?.needs_josh, true);
});

test("parseLedgerFile rejects missing as_of or items", () => {
  assert.equal(parseLedgerFile(null), null);
  assert.equal(parseLedgerFile({ items: [] }), null);
  assert.equal(parseLedgerFile({ as_of: "2026-11-12T17:00:00Z" }), null);
});

test("ledgerToStatusBots groups by owner_bot and flags Needs Josh", () => {
  const bots = ledgerToStatusBots(parseLedgerFile(fixture)!.items);
  const names = bots.map((bot) => bot.bot);
  assert.deepEqual(names, ["Canvas", "Forge"], "needs_josh first, then name");
  const canvas = bots.find((bot) => bot.bot === "Canvas");
  const forge = bots.find((bot) => bot.bot === "Forge");
  assert.equal(canvas?.updated, "2026-11-12T16:00:00Z");
  assert.equal(canvas?.needs_josh, "new headshot photo");
  assert.equal(forge?.needs_josh, null);
  assert.equal(forge?.updated, "2026-11-12T17:00:00Z");
  assert.equal(forge?.working_on, "Upload a preview and send Chief the URL");
});

test("readLedgerBots returns null when the snapshot file is missing", () => {
  const result = readLedgerBots(() => {
    throw new Error("ENOENT");
  }, "/synthetic/ledger.json");
  assert.equal(result, null);
});

test("readLedgerBots adapts a contract-shaped file", () => {
  const result = readLedgerBots(
    () => JSON.stringify(fixture),
    "/synthetic/ledger.json",
  );
  assert.ok(result);
  assert.equal(result.asOf, fixture.as_of);
  assert.equal(result.bots.length, 2);
});

test("parseChicagoStamp reads Status.md wall times as America/Chicago", () => {
  const morning = parseChicagoStamp("2026-11-12 07:52 CT");
  const afternoon = parseChicagoStamp("2026-11-12 10:55 AM CT");
  const iso = parseChicagoStamp("2026-11-12T16:55:00-06:00");
  assert.ok(morning);
  assert.ok(afternoon);
  assert.equal(morning, "2026-11-12T13:52:00.000Z");
  assert.equal(afternoon, "2026-11-12T16:55:00.000Z");
  assert.equal(iso, "2026-11-12T22:55:00.000Z");
  assert.equal(parseChicagoStamp(""), null);
  assert.equal(parseChicagoStamp("not a date"), null);
});
