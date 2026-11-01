import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderToString } from "react-dom/server";
import { Dashboard } from "../src/components/dashboard";
import type { DashboardData, DisplayConfig, Mode } from "../src/domains/models";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(scriptDirectory, "..");
const fixtureDirectory = join(repositoryRoot, "tests", "fixtures");
const fixture = JSON.parse(
  readFileSync(join(fixtureDirectory, "dashboard-data.json"), "utf8"),
) as { serverTime: string; data: DashboardData };

export const MODES: Mode[] = ["morning", "day", "evening", "night"];

const display: DisplayConfig = {
  timezone: "America/Chicago",
  locale: "en-US",
  currency: "USD",
  rotationSeconds: 25,
  pixelShift: false,
  modes: { morning: 6, day: 9, evening: 17, night: 22 },
};

export function renderGoldens(): Record<Mode, string> {
  const OriginalDate = globalThis.Date;
  const frozenTime = OriginalDate.parse(fixture.serverTime);

  class FrozenDate extends OriginalDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(frozenTime);
      } else {
        super(...(args as ConstructorParameters<DateConstructor>));
      }
    }

    static now(): number {
      return frozenTime;
    }
  }

  globalThis.Date = FrozenDate as DateConstructor;
  try {
    return Object.fromEntries(
      MODES.map((mode) => [
        mode,
        renderToString(
          Dashboard({
            initial: fixture.data,
            renderedAt: fixture.serverTime,
            display,
            demo: false,
            forcedMode: mode,
            paused: true,
          }),
        ),
      ]),
    ) as Record<Mode, string>;
  } finally {
    globalThis.Date = OriginalDate;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  const goldens = renderGoldens();
  for (const mode of MODES) {
    const outputPath = join(fixtureDirectory, `dashboard-${mode}.html`);
    writeFileSync(outputPath, goldens[mode], "utf8");
    console.log(outputPath);
  }
}
