/**
 * Unit tests for SqliteBackend — async-compatible SQLite DatabaseBackend.
 *
 * Uses an isolated DATA_DIR per run and a fresh SQLite database.
 * Verifies that the backend correctly wraps the sync better-sqlite3 adapter
 * behind the async DatabaseBackend interface.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-sqlite-backend-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const { resetDatabaseBackend, getDatabaseBackend } = await import("@/lib/db/backends");
const { resetDbInstance } = await import("@/lib/db/core");

function resetDb() {
  resetDatabaseBackend();
  resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test("SqliteBackend: query returns rows", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  // The schema is auto-created by getDbInstance()
  const { rows } = await backend.query(
    "SELECT key, value FROM key_value WHERE namespace = 'settings'"
  );
  assert.ok(Array.isArray(rows));
});

test("SqliteBackend: queryOne returns single row or null", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  const row = await backend.queryOne("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1");
  assert.ok(row !== null);
});

test("SqliteBackend: execute runs INSERT OR REPLACE", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  const result = await backend.execute(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
    ["test", "counter", "42"]
  );
  assert.ok(result.changes >= 0);

  const row = await backend.queryOne(
    "SELECT value FROM key_value WHERE namespace = ? AND key = ?",
    ["test", "counter"]
  );
  assert.equal(row?.value, "42");
});

test("SqliteBackend: transaction commits on success", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  await backend.execute(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
    ["tx-test", "before", "1"]
  );

  await backend.transaction(async (tx) => {
    await tx.execute("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)", [
      "tx-test",
      "during",
      "2",
    ]);
    return { ok: true };
  });

  const row = await backend.queryOne(
    "SELECT value FROM key_value WHERE namespace = ? AND key = ?",
    ["tx-test", "during"]
  );
  assert.equal(row?.value, "2");
});

test("SqliteBackend: transaction rolls back on error", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  await backend.execute(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
    ["rollback-test", "before", "1"]
  );

  try {
    await backend.transaction(async (tx) => {
      await tx.execute(
        "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
        ["rollback-test", "during", "2"]
      );
      throw new Error("rollback trigger");
    });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.equal((err as Error).message, "rollback trigger");
  }

  // The "during" row should NOT exist (transaction was rolled back)
  const row = await backend.queryOne(
    "SELECT value FROM key_value WHERE namespace = ? AND key = ?",
    ["rollback-test", "during"]
  );
  assert.equal(row, null);
});

test("SqliteBackend: tableExists returns boolean", async () => {
  resetDb();
  const backend = await getDatabaseBackend();
  assert.equal(await backend.tableExists("key_value"), true);
  assert.equal(await backend.tableExists("__nonexistent__"), false);
});

test("SqliteBackend: healthCheck returns true", async () => {
  resetDb();
  const backend = await getDatabaseBackend();
  assert.equal(await backend.healthCheck(), true);
});

test("SqliteBackend: close works without error", async () => {
  resetDb();
  const backend = await getDatabaseBackend();
  await backend.close();
  // Backend should be closed; getDatabaseBackend will create a new one
  resetDatabaseBackend();
  resetDbInstance();
});

test("SqliteBackend: INSERT OR REPLACE translates correctly via dialect", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  // SQLite backend should handle INSERT OR REPLACE natively
  await backend.execute(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
    ["upsert", "count", "1"]
  );

  // Upsert the same row
  await backend.execute(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
    ["upsert", "count", "2"]
  );

  const row = await backend.queryOne(
    "SELECT value FROM key_value WHERE namespace = ? AND key = ?",
    ["upsert", "count"]
  );
  assert.equal(row?.value, "2");
});

test.after(() => {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});
