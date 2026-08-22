/**
 * Unit tests for the SQL dialect compiler (SqlDialect).
 *
 * Verifies SQLite → PostgreSQL/MySQL SQL translation:
 * - `?` placeholder → `$1, $2, ...` (PostgreSQL)
 * - `INSERT OR REPLACE INTO` → `ON CONFLICT DO UPDATE` (PostgreSQL) / `ON DUPLICATE KEY` (MySQL)
 * - `PRAGMA table_info` → information_schema query (external backends)
 * - DDL type mapping (`AUTOINCREMENT` → `SERIAL`, `BLOB` → `BYTEA`, etc.)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { SqlDialect } from "@/lib/db/backends/sqlDialect";

// ── Placeholder translation ──────────────────────────────────────────────

test("postgres: converts `?` placeholders to `$1, $2, ...`", () => {
  const dialect = new SqlDialect("postgres");
  const { sql } = dialect.translate("SELECT * FROM key_value WHERE namespace = ? AND key = ?", [
    "settings",
    "_rev",
  ]);
  assert.equal(sql, "SELECT * FROM key_value WHERE namespace = $1 AND key = $2");
});

test("postgres: does not convert `?` inside string literals", () => {
  const dialect = new SqlDialect("postgres");
  const { sql } = dialect.translate("SELECT * FROM key_value WHERE value = 'what?' OR key = ?", [
    "test",
  ]);
  assert.equal(sql, "SELECT * FROM key_value WHERE value = 'what?' OR key = $1");
});

test("postgres: handles escaped single quotes in string literals", () => {
  const dialect = new SqlDialect("postgres");
  const { sql } = dialect.translate("SELECT * FROM t WHERE col = 'it''s ?'", []);
  assert.equal(sql, "SELECT * FROM t WHERE col = 'it''s ?'");
});

test("mysql: preserves `?` placeholders", () => {
  const dialect = new SqlDialect("mysql");
  const { sql } = dialect.translate("SELECT * FROM key_value WHERE namespace = ?", ["settings"]);
  assert.equal(sql, "SELECT * FROM key_value WHERE namespace = ?");
});

test("sqlite: preserves `?` placeholders", () => {
  const dialect = new SqlDialect("sqlite");
  const { sql } = dialect.translate("SELECT * FROM key_value WHERE namespace = ?", ["settings"]);
  assert.equal(sql, "SELECT * FROM key_value WHERE namespace = ?");
});

// ── INSERT OR REPLACE translation ────────────────────────────────────────

test("postgres: rewrites INSERT OR REPLACE with pk conflict target", () => {
  const dialect = new SqlDialect("postgres");
  const { sql } = dialect.translate(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
    ["settings", "_rev", "1"]
  );
  assert.equal(
    sql,
    "INSERT INTO key_value (namespace, key, value) VALUES ($1, $2, $3) " +
      "ON CONFLICT (namespace, key) DO UPDATE SET value = EXCLUDED.value"
  );
});

test("postgres: rewrites INSERT OR REPLACE with literal values (no params)", () => {
  const dialect = new SqlDialect("postgres");
  const { sql } = dialect.translate(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('settings', 'setupComplete', 'true')",
    []
  );
  assert.equal(
    sql,
    "INSERT INTO key_value (namespace, key, value) VALUES ('settings', 'setupComplete', 'true') " +
      "ON CONFLICT (namespace, key) DO UPDATE SET value = EXCLUDED.value"
  );
});

test("mysql: rewrites INSERT OR REPLACE to ON DUPLICATE KEY UPDATE", () => {
  const dialect = new SqlDialect("mysql");
  const { sql } = dialect.translate(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
    ["settings", "_rev", "1"]
  );
  assert.equal(
    sql,
    "INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE value = VALUES(value)"
  );
});

test("sqlite: preserves INSERT OR REPLACE unchanged", () => {
  const dialect = new SqlDialect("sqlite");
  const original = "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)";
  const { sql } = dialect.translate(original, ["a", "b", "c"]);
  assert.equal(sql, original);
});

test("postgres: handles multiple INSERT OR REPLACE in one string", () => {
  const dialect = new SqlDialect("postgres");
  const { sql } = dialect.translate(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('a', 'b', 'c');" +
      "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('d', 'e', 'f')",
    []
  );
  assert.ok(sql.includes("ON CONFLICT"));
  assert.ok(sql.includes("ON CONFLICT").toString()); // appears twice
  const conflictCount = (sql.match(/ON CONFLICT/g) || []).length;
  assert.equal(conflictCount, 2);
});

test("postgres: INSERT OR REPLACE on unregistered table falls back to DO NOTHING", () => {
  const dialect = new SqlDialect("postgres");
  const { sql } = dialect.translate(
    "INSERT OR REPLACE INTO some_unknown_table (col1, col2) VALUES (?, ?)",
    ["a", "b"]
  );
  assert.ok(sql.includes("ON CONFLICT DO NOTHING"));
});

// ── INSERT OR IGNORE translation ─────────────────────────────────────────

test("postgres: rewrites INSERT OR IGNORE to ON CONFLICT DO NOTHING", () => {
  const dialect = new SqlDialect("postgres");
  const { sql } = dialect.translate(
    "INSERT OR IGNORE INTO _omniroute_migrations (version, name) VALUES ('001', 'init')",
    []
  );
  assert.equal(
    sql,
    "INSERT INTO _omniroute_migrations (version, name) VALUES ('001', 'init') ON CONFLICT DO NOTHING"
  );
});

test("mysql: rewrites INSERT OR IGNORE to INSERT IGNORE", () => {
  const dialect = new SqlDialect("mysql");
  const { sql } = dialect.translate(
    "INSERT OR IGNORE INTO _omniroute_migrations (version, name) VALUES ('001', 'init')",
    []
  );
  assert.equal(
    sql,
    "INSERT IGNORE INTO _omniroute_migrations (version, name) VALUES ('001', 'init')"
  );
});

test("sqlite: preserves INSERT OR IGNORE unchanged", () => {
  const dialect = new SqlDialect("sqlite");
  const original = "INSERT OR IGNORE INTO t (a, b) VALUES (?, ?)";
  const { sql } = dialect.translate(original, ["x", "y"]);
  assert.equal(sql, original);
});

// ── PRAGMA table_info translation ────────────────────────────────────────

test("postgres: rewrites PRAGMA table_info to information_schema query", () => {
  const dialect = new SqlDialect("postgres");
  const { sql } = dialect.translate("PRAGMA table_info(api_keys)", []);
  assert.ok(sql.includes("information_schema.columns"));
  assert.ok(sql.includes("table_name = 'api_keys'"));
});

test("mysql: rewrites PRAGMA table_info to information_schema query", () => {
  const dialect = new SqlDialect("mysql");
  const { sql } = dialect.translate("PRAGMA table_info(combos)", []);
  assert.ok(sql.includes("information_schema.columns"));
  assert.ok(sql.includes("table_name = 'combos'"));
});

test("sqlite: preserves PRAGMA table_info", () => {
  const dialect = new SqlDialect("sqlite");
  const original = "PRAGMA table_info(api_keys)";
  const { sql } = dialect.translate(original, []);
  assert.equal(sql, original);
});

// ── DDL translation ──────────────────────────────────────────────────────

test("postgres: translates AUTOINCREMENT to SERIAL PRIMARY KEY", () => {
  const dialect = new SqlDialect("postgres");
  const ddl = "CREATE TABLE usage_history (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT);";
  const translated = dialect.translateDdl(ddl);
  assert.ok(translated.includes("SERIAL PRIMARY KEY"));
  assert.ok(!translated.includes("AUTOINCREMENT"));
});

test("postgres: translates BLOB to BYTEA", () => {
  const dialect = new SqlDialect("postgres");
  const ddl = "CREATE TABLE files (data BLOB);";
  const translated = dialect.translateDdl(ddl);
  assert.ok(translated.includes("BYTEA"));
  assert.ok(!translated.includes("BLOB"));
});

test("postgres: translates datetime('now') to NOW()", () => {
  const dialect = new SqlDialect("postgres");
  const ddl =
    "CREATE TABLE _omniroute_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));";
  const translated = dialect.translateDdl(ddl);
  assert.ok(translated.includes("NOW()"));
  assert.ok(!translated.includes("datetime('now')"));
});

test("mysql: translates AUTOINCREMENT to INT AUTO_INCREMENT PRIMARY KEY", () => {
  const dialect = new SqlDialect("mysql");
  const ddl = "CREATE TABLE usage_history (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT);";
  const translated = dialect.translateDdl(ddl);
  assert.ok(translated.includes("INT AUTO_INCREMENT PRIMARY KEY"));
});

test("mysql: translates BLOB to LONGBLOB", () => {
  const dialect = new SqlDialect("mysql");
  const ddl = "CREATE TABLE files (data BLOB);";
  const translated = dialect.translateDdl(ddl);
  assert.ok(translated.includes("LONGBLOB"));
});

test("sqlite: DDL translation is identity", () => {
  const dialect = new SqlDialect("sqlite");
  const ddl = "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT);";
  assert.equal(dialect.translateDdl(ddl), ddl);
});

// ── Combined translation (translateMigration) ────────────────────────────

test("postgres: translateMigration handles multi-statement", () => {
  const dialect = new SqlDialect("postgres");
  const migration =
    "CREATE TABLE IF NOT EXISTS key_value (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (namespace, key));" +
    "INSERT OR IGNORE INTO _omniroute_migrations (version, name) VALUES ('001', 'initial_schema');";
  const translated = dialect.translateMigration(migration);
  assert.ok(translated.includes("CREATE TABLE"));
  assert.ok(translated.includes("ON CONFLICT DO NOTHING"));
});
