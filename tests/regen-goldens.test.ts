import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";

test("regen-goldens renders deterministic dashboard modes without writing fixtures", async () => {
  const fixtureUrl = new URL("./fixtures/dashboard-day.html", import.meta.url);
  const beforeImport = await stat(fixtureUrl);

  const { renderGoldens, MODES } = await import("../scripts/regen-goldens.ts");

  const afterImport = await stat(fixtureUrl);
  assert.equal(afterImport.mtimeMs, beforeImport.mtimeMs);
  assert.deepEqual(MODES, ["morning", "day", "evening", "night"]);

  const first = renderGoldens();
  const second = renderGoldens();

  assert.deepEqual(Object.keys(first).sort(), [...MODES].sort());
  for (const mode of MODES) {
    assert.equal(typeof first[mode], "string");
    assert.ok(first[mode].length > 0);
    assert.ok(first[mode].startsWith("<"));
    assert.equal(second[mode], first[mode]);
  }
});
