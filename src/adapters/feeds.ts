import type { Adapter, FinanceState, HealthState } from "@/domains/models";

export const moneyFeed: Adapter<FinanceState> = {
  provider: "Local demo finance",
  source: "mock",
  async fetch(now) {
    const { mockFinance } = await import("./mock.ts");
    return mockFinance.fetch(now);
  },
};

export const healthFeed: Adapter<HealthState> = {
  provider: "Apple Health",
  source: "real",
  observedAt: (data) =>
    data.syncedAt ? data.sampledAt || data.syncedAt : data.importedAt || null,
  async fetch(now) {
    const { healthAdapter } = await import("./health.ts");
    return healthAdapter.fetch(now);
  },
};
