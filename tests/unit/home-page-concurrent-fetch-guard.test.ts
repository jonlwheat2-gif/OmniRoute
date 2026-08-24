import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * #9985/#36 regression guard for the home page data fetch.
 *
 * Contract: getSettings() and getMachineId() must START concurrently
 * (both promises created before either is awaited). This regressed once
 * when a feature merge reintroduced sequential awaits — this static
 * assertion makes that failure mode impossible to merge silently.
 */
test("home page starts settings and machineId fetches concurrently", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../src/app/(dashboard)/home/page.tsx", import.meta.url)),
    "utf8"
  );

  const startSettings = src.indexOf("const settingsPromise = getSettings();");
  const startMachine = src.indexOf("const machineIdPromise = getMachineId();");
  const awaitSettings = src.indexOf("await settingsPromise");
  const awaitMachine = src.indexOf("await machineIdPromise");

  assert.ok(startSettings !== -1, "settings promise must be declared up front");
  assert.ok(startMachine !== -1, "machineId promise must be declared up front");
  assert.ok(awaitSettings !== -1, "settings must still be awaited before use");
  assert.ok(awaitMachine !== -1, "machineId must be consumed via its promise");

  assert.ok(
    startSettings < awaitSettings && startMachine < awaitSettings,
    "both promises must be CREATED before settings is awaited (concurrent start)"
  );
  assert.ok(
    Math.max(startSettings, startMachine) <
      Math.min(
        awaitSettings === -1 ? Infinity : awaitSettings,
        awaitMachine === -1 ? Infinity : awaitMachine
      ),
    "no await may appear between promise creation and consumption"
  );
});
