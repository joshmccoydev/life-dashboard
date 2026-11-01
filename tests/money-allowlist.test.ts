import assert from "node:assert/strict";
import test from "node:test";
import {
  MONEY_ALLOWED_KEYS,
  buildSnapshot,
  summarizeMoney,
} from "../scripts/produce-feeds.ts";

const MONEY_PATH = "/synthetic/exports/buffett-dash.json";
const FORBIDDEN_FIELDS = [
  "transactions",
  "account_number",
  "payee",
  "iban",
] as const;
const SYNTHETIC_PAYEE = "SYNTHETIC_PAYEE_7f4c";
const SYNTHETIC_ACCOUNT = "SYNTHETIC_ACCOUNT_91e2";
const SYNTHETIC_IBAN = "SYNTHETIC_IBAN_44a8";
const SYNTHETIC_TRANSACTION_AMOUNT = "987654321.12345";

function syntheticMoneyFixture() {
  return {
    updated_at: "2026-11-01T15:30:00.000Z",
    cash_on_hand: {
      amount: 1200.5,
      as_of: "2026-11-01",
      source: "synthetic ledger",
    },
    next_bills: [
      {
        name: "Synthetic utility",
        amount: 10,
        due: "2026-11-03",
        estimate: false,
      },
      {
        name: "Synthetic subscription",
        amount: "5.5",
        due: "2026-11-05",
        estimate: false,
      },
      {
        name: "Synthetic unparsed bill",
        amount: "n/a",
        due: "2026-11-07",
        estimate: true,
      },
    ],
    deposit_goal: {
      target: 2500,
      due: "2026-11-15",
      note: "Synthetic goal note",
    },
    transactions: [
      {
        payee: SYNTHETIC_PAYEE,
        amount: SYNTHETIC_TRANSACTION_AMOUNT,
      },
    ],
    account_number: SYNTHETIC_ACCOUNT,
    payee: SYNTHETIC_PAYEE,
    iban: SYNTHETIC_IBAN,
  };
}

test("summarizeMoney returns exactly the allowed keys", () => {
  const output = summarizeMoney(syntheticMoneyFixture());

  assert.deepEqual(
    Object.keys(output).sort(),
    [...MONEY_ALLOWED_KEYS].sort(),
  );
});

test("summarizeMoney omits sensitive fields and values", () => {
  const serialized = JSON.stringify(summarizeMoney(syntheticMoneyFixture()));
  const forbiddenText = [
    ...FORBIDDEN_FIELDS,
    SYNTHETIC_PAYEE,
    SYNTHETIC_ACCOUNT,
    SYNTHETIC_IBAN,
    SYNTHETIC_TRANSACTION_AMOUNT,
  ];

  for (const value of forbiddenText) {
    assert.equal(
      serialized.includes(value),
      false,
      `summary unexpectedly exposed ${value}`,
    );
  }
});

test("summarizeMoney totals numeric bills and counts every bill", () => {
  const output = summarizeMoney({
    next_bills: [10, "5.5", "n/a"],
    alerts: [],
  });

  assert.equal(output.billsDueTotal, 15.5);
  assert.equal(output.billsDueCount, 3);
});

test("summarizeMoney marks non-empty alerts", () => {
  const output = summarizeMoney({
    alerts: ["synthetic alert"],
  });

  assert.equal(output.status, "alert");
});

test("summarizeMoney returns unknown with null money fields for non-objects", () => {
  assert.deepEqual(summarizeMoney(null), {
    cashOnHand: null,
    billsDueTotal: null,
    billsDueCount: 0,
    depositTarget: null,
    status: "unknown",
  });
});

test("buildSnapshot allowlists the money data shape", () => {
  const readFile = ((filePath: string): string => {
    if (filePath === MONEY_PATH) {
      return JSON.stringify(syntheticMoneyFixture());
    }

    const error = new Error(
      `ENOENT: synthetic file missing: ${filePath}`,
    ) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }) as typeof import("node:fs").readFileSync;

  const snapshot = buildSnapshot({
    paths: {
      status: "/synthetic/Bots/Status.md",
      board: "/synthetic/Bots/Board.md",
      money: MONEY_PATH,
      health: "/synthetic/exports/arnold-dash.json",
      apple: "/synthetic/exports/apple-dash.json",
    },
    readFile,
    run: (cmd) => {
      if (cmd === "df") {
        return [
          "Filesystem 1024-blocks Used Available Capacity Mounted on",
          "/dev/synthetic 100 25 75 25% /",
        ].join("\n");
      }
      return "";
    },
    uptime: () => 100,
    loadavg: () => [0.1, 0.2, 0.3],
    now: new Date("2026-11-01T16:00:00.000Z"),
  });

  const moneyData = snapshot.money.data;
  assert.ok(
    moneyData !== null &&
      typeof moneyData === "object" &&
      !Array.isArray(moneyData),
  );

  const allowed = new Set<string>(MONEY_ALLOWED_KEYS);
  assert.deepEqual(
    Object.keys(moneyData as Record<string, unknown>).filter(
      (key) => !allowed.has(key),
    ),
    [],
  );
});
