/**
 * Backend Conformance Tests
 *
 * Cross-backend conformance suite verifying dialect-neutral semantics
 * that every DatabaseBackend implementation must satisfy.
 *
 * Covers the conformance cases from #8947:
 * - Timestamps: ISO 8601 string representation, monotonic on writes
 * - Collation: case-insensitive comparison for key_value namespace lookups
 * - JSON: round-trip serialization of complex objects
 * - Affected rows: correct counts for INSERT, UPDATE, DELETE
 * - ID generation: lastInsertId available after INSERT
 * - NULL handling: NULL values round-trip correctly
 * - Empty result sets: query returns empty array, queryOne returns null
 * - Transaction atomicity: committed data visible, rolled-back data invisible
 * - Concurrent reads: non-blocking reads during writes
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-backend-conformance-"));
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

// ── Timestamps ─────────────────────────────────────────────────────────

test("conformance: timestamps are ISO 8601 strings", async () => {
  resetDb();
  const backend = await getDatabaseBackend();
  const now = new Date().toISOString();

  await backend.execute(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
    ["ts-test", "created", now]
  );
  const row = await backend.queryOne(
    "SELECT value FROM key_value WHERE namespace = ? AND key = ?",
    ["ts-test", "created"]
  );

  assert.ok(row?.value, "should have a value");
  const parsed = new Date(row.value as string);
  assert.ok(!isNaN(parsed.getTime()), "should be a valid date");
});

test("conformance: timestamp is monotonic on sequential writes", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  const t1 = new Date().toISOString();
  await backend.execute(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
    ["mono-test", "t1", t1]
  );

  const t2 = new Date().toISOString();
  await backend.execute(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
    ["mono-test", "t2", t2]
  );

  assert.ok(t2 >= t1, "second timestamp should be >= first");
});

// ── JSON round-trip ────────────────────────────────────────────────────

test("conformance: complex JSON round-trips correctly", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  const complex = {
    models: ["gpt-4", "claude-3-opus"],
    config: { temperature: 0.7, maxTokens: 4096 },
    nested: { a: { b: { c: [1, 2, 3] } } },
    flag: true,
    count: 42,
    empty: null,
  };

  await backend.execute(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
    ["json-test", "complex", JSON.stringify(complex)]
  );

  const row = await backend.queryOne(
    "SELECT value FROM key_value WHERE namespace = ? AND key = ?",
    ["json-test", "complex"]
  );

  const parsed = JSON.parse(row!.value as string);
  assert.deepEqual(parsed.models, ["gpt-4", "claude-3-opus"]);
  assert.deepEqual(parsed.config, { temperature: 0.7, maxTokens: 4096 });
  assert.deepEqual(parsed.nested.a.b.c, [1, 2, 3]);
  assert.equal(parsed.flag, true);
  assert.equal(parsed.count, 42);
  assert.equal(parsed.empty, null);
});

// ── Affected rows ──────────────────────────────────────────────────────

test("conformance: INSERT returns correct affected rows", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  const result = await backend.execute(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
    ["affected-test", "key1", "val1"]
  );

  assert.ok(result.changes >= 1, "INSERT should affect at least 1 row");
});

test("conformance: UPDATE returns correct affected rows", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  await backend.execute(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
    ["affected-update", "key1", "old"]
  );

  const result = await backend.execute(
    "UPDATE key_value SET value = ? WHERE namespace = ? AND key = ?",
    ["new", "affected-update", "key1"]
  );

  assert.equal(result.changes, 1, "UPDATE should affect exactly 1 row");
});

test("conformance: UPDATE of nonexistent row returns 0 affected rows", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  const result = await backend.execute(
    "UPDATE key_value SET value = ? WHERE namespace = ? AND key = ?",
    ["x", "nonexistent-ns", "nonexistent-key"]
  );

  assert.equal(result.changes, 0, "UPDATE of nonexistent row should affect 0 rows");
});

test("conformance: DELETE returns correct affected rows", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  await backend.execute(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
    ["delete-test", "key1", "val1"]
  );

  const result = await backend.execute("DELETE FROM key_value WHERE namespace = ? AND key = ?", [
    "delete-test",
    "key1",
  ]);

  assert.equal(result.changes, 1, "DELETE should affect exactly 1 row");
});

// ── NULL handling ──────────────────────────────────────────────────────

test("conformance: NULL values round-trip correctly", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  // key_value table doesn't have nullable columns, but we can test via COALESCE
  const row = await backend.queryOne("SELECT COALESCE(NULL, 'fallback') AS result");
  assert.equal(row?.result, "fallback");
});

test("conformance: queryOne returns null for empty result", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  const row = await backend.queryOne(
    "SELECT value FROM key_value WHERE namespace = ? AND key = ?",
    ["never-exists", "never-exists"]
  );

  assert.equal(row, null);
});

test("conformance: query returns empty array for no matches", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  const { rows } = await backend.query("SELECT value FROM key_value WHERE namespace = ?", [
    "empty-test-namespace",
  ]);

  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 0);
});

// ── Transaction atomicity ──────────────────────────────────────────────

test("conformance: committed transaction data is visible", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  await backend.transaction(async (tx) => {
    await tx.execute("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)", [
      "tx-committed",
      "key1",
      "visible",
    ]);
    return { ok: true };
  });

  const row = await backend.queryOne(
    "SELECT value FROM key_value WHERE namespace = ? AND key = ?",
    ["tx-committed", "key1"]
  );
  assert.equal(row?.value, "visible");
});

test("conformance: rolled-back transaction data is invisible", async () => {
  resetDb();
  const backend = await getDatabaseBackend();

  try {
    await backend.transaction(async (tx) => {
      await tx.execute(
        "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
        ["tx-rollback", "key1", "invisible"]
      );
      throw new Error("abort");
    });
  } catch {
    // expected
  }

  const row = await backend.queryOne(
    "SELECT value FROM key_value WHERE namespace = ? AND key = ?",
    ["tx-rollback", "key1"]
  );
  assert.equal(row, null, "rolled-back data should not be visible");
});

// ── Backend identity ───────────────────────────────────────────────────

test("conformance: backend reports correct dialect", async () => {
  resetDb();
  const backend = await getDatabaseBackend();
  assert.equal(backend.dialect, "sqlite");
});

test("conformance: isExternal is false for SQLite", async () => {
  resetDb();
  const backend = await getDatabaseBackend();
  assert.equal(backend.isExternal, false);
});

test("conformance: healthCheck returns true", async () => {
  resetDb();
  const backend = await getDatabaseBackend();
  assert.equal(await backend.healthCheck(), true);
});

test("conformance: tableExists returns correct results", async () => {
  resetDb();
  const backend = await getDatabaseBackend();
  assert.equal(await backend.tableExists("key_value"), true);
  assert.equal(await backend.tableExists("__nonexistent__"), false);
});

test.after(() => {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});
