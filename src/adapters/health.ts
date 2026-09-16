import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Adapter, HealthState } from "@/domains/models";
import { config } from "@/config";
import { localDateKey } from "@/lib/time";
export const healthImportPath =
  process.env.HEALTH_IMPORT_PATH || resolve(".lifedash/health-import.json");
export function normalizeHealthImport(
  payload: unknown,
  now: Date,
): HealthState {
  const snapshot = payload as {
    version: number;
    importedAt: string;
    timezone: string;
    days: (HealthState & { date: string })[];
  };
  if (
    snapshot?.version !== 1 ||
    !Number.isFinite(Date.parse(snapshot.importedAt)) ||
    !Array.isArray(snapshot.days) ||
    !snapshot.days.length ||
    Date.parse(snapshot.importedAt) > now.getTime() + 60000
  )
    throw new Error("Health import snapshot invalid");
  if (snapshot.timezone !== config.display.timezone)
    throw new Error("Reimport Health data using the dashboard timezone");
  const today = localDateKey(now, config.display.timezone);
  const days = snapshot.days
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const data = days.at(-1);
  if (!data) throw new Error("No past or current Health data in import");
  for (const key of [
    "steps",
    "stepGoal",
    "sleepMinutes",
    "activityPercent",
    "exerciseMinutes",
    "exerciseGoal",
    "standHours",
    "standGoal",
  ] as const)
    if (data[key] !== null && (!Number.isFinite(data[key]) || data[key]! < 0))
      throw new Error("Health import metrics invalid");
  if (
    data.activeEnergy !== undefined &&
    data.activeEnergy !== null &&
    (!Number.isFinite(data.activeEnergy) || data.activeEnergy < 0)
  )
    throw new Error("Health energy invalid");
  return { ...data, importedAt: snapshot.importedAt, date: data.date };
}
export const healthAdapter: Adapter<HealthState> = {
  provider: "Apple Health",
  source: "real",
  observedAt: (data) =>
    data.syncedAt ? data.sampledAt || data.syncedAt : data.importedAt || null,
  async fetch(now) {
    let payload: unknown;
    try {
      const sync = JSON.parse(
        await readFile(
          resolve(process.cwd(), ".lifedash/health-sync.json"),
          "utf8",
        ),
      );
      return normalizeHealthImport(sync, now);
    } catch {
      /* Fall back to optional manual import. */
    }
    try {
      payload = JSON.parse(
        await readFile(/* turbopackIgnore: true */ healthImportPath, "utf8"),
      );
    } catch {
      throw new Error("Connect iPhone Health sync, or import a Health export");
    }
    return normalizeHealthImport(payload, now);
  },
};
