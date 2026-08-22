/**
 * DatabaseBackend — async dialect-agnostic persistence interface.
 *
 * This abstraction decouples domain modules from the underlying storage engine.
 * SQLite remains the default (zero-config); PostgreSQL and MySQL are opt-in
 * for active-active cluster deployments via `DATABASE_DRIVER`.
 *
 * Design goals:
 * - Async-first interface (PostgreSQL/MySQL are inherently async; SQLite wraps
 *   its sync operations in resolved promises with zero behavioral change).
 * - Domain modules write SQLite-flavored SQL; the backend translates to the
 *   target dialect via the SqlDialect compiler.
 * - Transactions are async closures, matching PostgreSQL/MySQL commit/rollback
 *   semantics.
 */

export type DbDialect = "sqlite" | "postgres" | "mysql";

export interface DbRow {
  [key: string]: unknown;
}

export interface DbResult {
  rows: DbRow[];
  rowCount: number;
  lastInsertId: unknown;
}

export interface DbExecResult {
  changes: number;
  lastInsertId: unknown;
}

export interface TransactionHandle {
  query(sql: string, params?: unknown[]): Promise<DbResult>;
  queryOne(sql: string, params?: unknown[]): Promise<DbRow | null>;
  execute(sql: string, params?: unknown[]): Promise<DbExecResult>;
}

export interface DatabaseBackend {
  readonly dialect: DbDialect;
  readonly isExternal: boolean;

  query(sql: string, params?: unknown[]): Promise<DbResult>;
  queryOne(sql: string, params?: unknown[]): Promise<DbRow | null>;
  execute(sql: string, params?: unknown[]): Promise<DbExecResult>;

  transaction<T>(fn: (tx: TransactionHandle) => Promise<T>): Promise<T>;

  tableExists(table: string): Promise<boolean>;
  getTableColumns(table: string): Promise<string[]>;

  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}
