import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSnapshot,
  main,
  type Snapshot,
} from "../scripts/produce-feeds.ts";

const UPDATED_AT = "2026-11-01T00:00:00Z";
const NOW = new Date("2026-11-01T00:05:00Z");
const PATHS = {
  status: "/synthetic/bots-status.md",
  money: "/synthetic/money.json",
  health: "/synthetic/health.json",
  apple: "/synthetic/apple.json",
};

function deterministicSnapshot(moneyJson: string): Snapshot {
  return buildSnapshot({
    paths: PATHS,
    readFile: (filePath) => {
      if (filePath === PATHS.status) {
        throw new Error("synthetic status unavailable");
      }
      if (filePath === PATHS.money) {
        return moneyJson;
      }
      if (filePath === PATHS.health) {
        return JSON.stringify({
          updated_at: UPDATED_AT,
          training_done_today: true,
          streak: 2,
        });
      }
      if (filePath === PATHS.apple) {
        return JSON.stringify({ updated_at: UPDATED_AT });
      }
      throw new Error(`unexpected synthetic path: ${filePath}`);
    },
    run: (command, args) => {
      assert.match([command, ...args].join(" "), /^(df -P \/|crontab -l)$/);
      return command === "df"
        ? [
            "Filesystem 1024-blocks Used Available Capacity Mounted on",
            "synthetic 100 40 60 40% /",
          ].join("\n")
        : "";
    },
    uptime: () => 120,
    loadavg: () => [0.1, 0.2, 0.3],
    now: NOW,
  });
}

test("buildSnapshot rejects money data without the required shape", () => {
  const snapshot = deterministicSnapshot(
    JSON.stringify({ updated_at: UPDATED_AT, note: "x" }),
  );

  assert.equal(snapshot.money.data, null);
  assert.equal(snapshot.money.error, "money shape invalid");
  assert.equal(snapshot.money.updatedAt, UPDATED_AT);
  assert.equal(snapshot.money.source, "box:buffett");
});

test("buildSnapshot accepts valid synthetic money data", () => {
  const snapshot = deterministicSnapshot(
    JSON.stringify({
      updated_at: UPDATED_AT,
      cash_on_hand: { amount: 10 },
      next_bills: [],
    }),
  );

  assert.notEqual(snapshot.money.data, null);
  assert.deepEqual(snapshot.money.data, {
    cashOnHand: 10,
    billsDueTotal: 0,
    billsDueCount: 0,
    depositTarget: null,
    status: "ok",
    bills: [],
  });
  assert.equal(snapshot.money.error, undefined);
});

test("main returns 1 without leaking a KV write error", (t) => {
  const originalExitCode = process.exitCode;
  t.after(() => {
    process.exitCode = originalExitCode;
  });

  const snapshot: Snapshot = {
    bots: {
      data: { bots: [] },
      updatedAt: UPDATED_AT,
      source: "box:status",
    },
    money: {
      data: null,
      updatedAt: null,
      source: "box:buffett",
    },
    health: {
      data: null,
      updatedAt: null,
      source: "box:arnold",
    },
    host: {
      data: null,
      updatedAt: null,
      source: "box:host",
    },
    apple: {
      data: null,
      updatedAt: null,
      source: "mac:not-wired",
    },
  };
  const lines: string[] = [];
  let result: number | undefined;

  assert.doesNotThrow(() => {
    result = main([], {
      build: () => snapshot,
      kvGet: () => null,
      kvPut: () => {
        throw new Error("boom");
      },
      out: (line) => {
        lines.push(line);
      },
    });
  });

  assert.equal(result, 1);
  assert.equal(process.exitCode, 1);
  const output = lines.join("\n");
  assert.match(output, /kv write failed/);
  assert.doesNotMatch(output, /boom/);
});
