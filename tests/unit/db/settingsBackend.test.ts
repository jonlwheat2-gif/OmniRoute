/**
 * Unit tests for the settings module using DatabaseBackend abstraction.
 *
 * Verifies that getSettings/updateSettings work correctly through the
 * new backend abstraction with SQLite (the default driver).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-settings-backend-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const { resetDatabaseBackend } = await import("@/lib/db/backends");
const { resetDbInstance } = await import("@/lib/db/core");

function resetDb() {
  resetDatabaseBackend();
  resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

const { getSettings, updateSettings, getSettingsRevision } = await import("@/lib/db/settings.ts");

test("getSettings returns default settings via DatabaseBackend", async () => {
  resetDb();
  const settings = await getSettings();
  assert.equal(settings.cloudEnabled, true);
  assert.equal(settings.tailscaleEnabled, false);
  assert.equal(settings.promptCacheAffinityEnabled, true);
  assert.equal(settings.comboStrategy, "fallback");
});

test("getSettings reads persisted values", async () => {
  resetDb();
  await updateSettings({ customSystemPrompt: "hello world", hidePaidModels: true });

  const settings = await getSettings();
  assert.equal(settings.customSystemPrompt, "hello world");
  assert.equal(settings.hidePaidModels, true);
});

test("getSettingsRevision returns 0 on fresh DB", async () => {
  resetDb();
  const revision = await getSettingsRevision();
  assert.equal(revision, 0);
});

test("getSettingsRevision increments after updateSettings", async () => {
  resetDb();
  await updateSettings({ testKey: "value1" });
  const rev1 = await getSettingsRevision();
  assert.equal(rev1, 1);

  await updateSettings({ testKey: "value2" });
  const rev2 = await getSettingsRevision();
  assert.equal(rev2, 2);
});

test("updateSettings respects expectedRevision for optimistic concurrency", async () => {
  resetDb();
  await updateSettings({ optimistic: true });
  const rev = await getSettingsRevision();

  // Correct revision — should succeed
  await updateSettings({ optimistic: false }, { expectedRevision: rev });

  // Wrong revision — should throw
  const currentRev = await getSettingsRevision();
  await assert.rejects(
    updateSettings({ optimistic: true }, { expectedRevision: currentRev + 1 }),
    /Settings revision mismatch/
  );
});

test("getSettingsRevision is read through the backend (not raw getDbInstance)", async () => {
  resetDb();
  await updateSettings({ _settingsRevisionTest: true });
  const rev = await getSettingsRevision();
  assert.equal(rev, 1);

  // Verify the revision was stored in the key_value table via the backend
  const { getDatabaseBackend } = await import("@/lib/db/backends");
  const backend = await getDatabaseBackend();
  const row = await backend.queryOne(
    "SELECT value FROM key_value WHERE namespace = 'settings' AND key = ?",
    ["_settingsRevision"]
  );
  assert.ok(row !== null);
  const parsed = JSON.parse(row!.value as string);
  assert.equal(parsed, 1);
});

test.after(() => {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});
