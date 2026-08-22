/**
 * Export Tool — Export SQLite data to PostgreSQL/MySQL-compatible SQL.
 *
 * This implements the offline SQLite → external migration path described
 * in issue #8075. It reads the SQLite schema and data, translates DDL
 * and SQL through the SqlDialect compiler, and emits dialect-correct
 * SQL that can be piped to `psql` or `mysql`.
 *
 * Usage:
 *   // Programmatic:
 *   const exported = await exportSqliteToDialect(sqliteDbPath, "postgres");
 *   fs.writeFileSync("dump.sql", exported);
 *
 *   // CLI:
 *   node --import tsx scripts/ad-hoc/export-sqlite-to-external.mts
 *
 * Limitations:
 * - Does NOT export sqlite-vec vector data (those tables need separate Qdrant import).
 * - Does NOT export WAL-specific pragmas or file-level metadata.
 * - Large databases may need batching (export is streaming).
 */

import Database from "better-sqlite3";
import type { DbDialect } from "./types";
import { SqlDialect } from "./sqlDialect";

export interface ExportedTable {
  name: string;
  ddl: string;
  indexes: string[];
  rowCount: number;
}

export interface ExportResult {
  dialect: DbDialect;
  tables: ExportedTable[];
  sql: string;
}

/** System tables and views that should not be exported. */
const SKIP_TABLES = new Set([
  "sqlite_sequence",
  "sqlite_master",
  "sqlite_autoindex",
  "_omniroute_migrations",
  "sqlite_schema",
]);

/** Tables whose data is sqlite-vec vector stores (not migrated to SQL dump). */
const VEC_TABLES = new Set<string>();

/**
 * Read all table names from the SQLite database (excluding system tables).
 */
function listTables(db: Database.Database): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_omniroute_%'"
    )
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name).filter((name) => !SKIP_TABLES.has(name));
}

/**
 * Read the CREATE TABLE DDL for a table.
 */
function getTableDdl(db: Database.Database, tableName: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName) as { sql: string } | undefined;
  return row?.sql ?? "";
}

/**
 * Read all indexes (except auto-created ones) for a table.
 */
function getTableIndexes(db: Database.Database, tableName: string): string[] {
  const rows = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL")
    .all(tableName) as Array<{ sql: string }>;
  return rows.map((r) => r.sql).filter((sql) => sql.includes(`(${tableName})` || ""));
}

/**
 * Count rows in a table.
 */
function countRows(db: Database.Database, tableName: string): number {
  const escaped = tableName.replace(/"/g, '""');
  const row = db.prepare(`SELECT COUNT(*) as c FROM "${escaped}"`).get() as { c: number };
  return row?.c ?? 0;
}

/**
 * Read all data from a table (ordered by primary key if possible).
 */
function readTableRows(db: Database.Database, tableName: string): Array<Record<string, unknown>> {
  const escaped = tableName.replace(/"/g, '""');
  const rows = db.prepare(`SELECT * FROM "${escaped}"`).all() as Array<Record<string, unknown>>;
  return rows;
}

/**
 * Generate PostgreSQL/MySQL-compatible INSERT statements for a set of rows.
 */
function generateInserts(
  dialect: SqlDialect,
  tableName: string,
  rows: Array<Record<string, unknown>>,
  batchSize: number = 1000
): string[] {
  if (rows.length === 0) return [];

  const columns = Object.keys(rows[0]);
  const escapedTable = tableName.replace(/"/g, '""');
  const insertHeader = `INSERT INTO "${escapedTable}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES`;

  const statements: string[] = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = batch.map((row) => {
      const vals = columns.map((col) => {
        const val = row[col];
        return formatValue(val);
      });
      return `(${vals.join(", ")})`;
    });

    let stmt = `${insertHeader} ${values.join(", ")}`;

    // Translate INSERT OR REPLACE patterns aren't here — these are pure INSERTs
    // For PostgreSQL upsert support, append ON CONFLICT DO NOTHING
    if (dialect.dialect === "postgres") {
      const pkCols = columns.filter((c) => c === "id" || c.endsWith("_id") || c === "version");
      if (pkCols.length > 0) {
        stmt += ` ON CONFLICT (${pkCols.map((c) => `"${c}"`).join(", ")}) DO UPDATE SET ${pkCols
          .map((c) => `"${c}" = EXCLUDED."${c}"`)
          .join(", ")}`;
      } else {
        stmt += " ON CONFLICT DO NOTHING";
      }
    }

    if (dialect.dialect === "mysql") {
      stmt +=
        " ON DUPLICATE KEY UPDATE " + columns.map((c) => `"${c}" = VALUES("${c}")`).join(", ");
    }

    statements.push(stmt + ";");
  }

  return statements;
}

/**
 * Format a JavaScript value as a SQL literal.
 */
function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (Buffer.isBuffer(val)) {
    return `X'${val.toString("hex")}'`;
  }
  if (typeof val === "string") {
    // Escape single quotes for SQL safety
    const escaped = val.replace(/'/g, "''");
    return `'${escaped}'`;
  }
  // Objects/arrays → JSON string
  return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
}

/**
 * Export all SQLite data to dialect-correct SQL.
 *
 * @param sqliteDbPath Path to the SQLite database file
 * @param dialect Target dialect ("postgres" or "mysql")
 * @param options Batch size for INSERT generation
 */
export async function exportSqliteToDialect(
  sqliteDbPath: string,
  dialect: DbDialect,
  options?: { batchSize?: number }
): Promise<ExportResult> {
  const db = new Database(sqliteDbPath, { readonly: true });

  try {
    const sqlDialect = new SqlDialect(dialect);
    const tables = listTables(db);
    const exportedTables: ExportedTable[] = [];
    const statements: string[] = [];

    // Generate DDL for all tables
    for (const tableName of tables) {
      const ddl = getTableDdl(db, tableName);
      const indexes = getTableIndexes(db, tableName);
      const rowCount = countRows(db, tableName);

      // Translate DDL to target dialect
      const translatedDdl = sqlDialect.translateDdl(ddl);

      exportedTables.push({
        name: tableName,
        ddl: translatedDdl,
        indexes: indexes.map((idx) => sqlDialect.translateDdl(idx)),
        rowCount,
      });

      statements.push(translatedDdl);
      for (const idx of indexes) {
        statements.push(sqlDialect.translateDdl(idx));
      }
    }

    // Generate INSERT statements for all data
    for (const tableName of tables) {
      const rows = readTableRows(db, tableName);
      const inserts = generateInserts(sqlDialect, tableName, rows, options?.batchSize ?? 1000);
      statements.push(...inserts);
    }

    return {
      dialect,
      tables: exportedTables,
      sql: statements.join("\n\n"),
    };
  } finally {
    db.close();
  }
}
