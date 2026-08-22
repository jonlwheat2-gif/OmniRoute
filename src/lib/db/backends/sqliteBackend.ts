/**
 * SqliteBackend — async-compatible DatabaseBackend wrapping the existing
 * better-sqlite3 / SqliteAdapter sync infrastructure.
 *
 * This backend preserves zero-config SQLite behavior. All sync operations
 * are wrapped in resolved Promises — no behavioral change, but the interface
 * is uniform with PostgresBackend so domain modules can be dialect-agnostic.
 *
 * SQLite-specific features (WAL, PRAGMA, file backup, sqlite-vec) remain
 * SQLite-only — these are intentionally NOT exposed on the DatabaseBackend
 * interface. Callers that need SQLite-specific operations continue to use
 * getDbInstance() directly (e.g. WAL checkpoint, PRAGMA tuning, backup).
 *
 * Transaction model:
 *   SQLite is single-connection synchronous. The async transaction wrapper
 *   uses manual BEGIN/COMMIT/ROLLBACK via db.exec(). The busy_timeout (2s,
 *   set in core.ts) provides concurrency safety — concurrent transactions
 *   on the same SQLite file will wait for the lock rather than corrupt state.
 */

import type { SqliteAdapter } from "../adapters/types";
import { closeDbInstance, getDbInstance } from "../core";
import type {
  DatabaseBackend,
  DbDialect,
  DbResult,
  DbExecResult,
  DbRow,
  TransactionHandle,
} from "./types";

export class SqliteBackend implements DatabaseBackend {
  readonly dialect: DbDialect = "sqlite";
  readonly isExternal = false;

  private get db(): SqliteAdapter {
    return getDbInstance();
  }

  query(sql: string, params: unknown[] = []): Promise<DbResult> {
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as DbRow[];
    return Promise.resolve({ rows, rowCount: rows.length, lastInsertId: undefined });
  }

  queryOne(sql: string, params: unknown[] = []): Promise<DbRow | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as DbRow | undefined;
    return Promise.resolve(row ?? null);
  }

  execute(sql: string, params: unknown[] = []): Promise<DbExecResult> {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params) as { changes: number; lastInsertRowid: unknown };
    return Promise.resolve({ changes: result.changes, lastInsertId: result.lastInsertRowid });
  }

  async transaction<T>(fn: (tx: TransactionHandle) => Promise<T>): Promise<T> {
    const txHandle: TransactionHandle = {
      query: (sql: string, params: unknown[] = []) => this.query(sql, params),
      queryOne: (sql: string, params: unknown[] = []) => this.queryOne(sql, params),
      execute: (sql: string, params: unknown[] = []) => this.execute(sql, params),
    };

    // Manual transaction — better-sqlite3's native sync transaction can't
    // wrap an async fn. busy_timeout (2s) provides lock-wait safety.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn(txHandle);
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // rollback may fail if the error already aborted the transaction
      }
      throw err;
    }
  }

  tableExists(table: string): Promise<boolean> {
    const result = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(table) as { name: string } | undefined;
    return Promise.resolve(!!result);
  }

  async getTableColumns(table: string): Promise<string[]> {
    try {
      // PRAGMA does not accept parameterized table names in better-sqlite3.
      // Quote the identifier to prevent injection (table names come from
      // internal code, never user input).
      const escaped = table.replace(/"/g, '""');
      const rows = this.db.prepare(`PRAGMA table_info("${escaped}")`).all() as Array<{
        name: string;
      }>;
      return rows.map((r) => r.name);
    } catch {
      return [];
    }
  }

  healthCheck(): Promise<boolean> {
    try {
      const result = this.db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
      return Promise.resolve(result?.ok === 1);
    } catch {
      return Promise.resolve(false);
    }
  }

  async close(): Promise<void> {
    closeDbInstance();
  }
}
