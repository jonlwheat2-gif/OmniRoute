/**
 * DatabaseBackend barrel — pluggable DB persistence abstraction.
 *
 * Public API:
 *   getDatabaseBackend()      — lazy singleton factory (async)
 *   getDatabaseBackendSync()  — sync accessor after init
 *   resetDatabaseBackend()    — test-only reset
 *
 * The abstraction decouples domain modules from the storage engine.
 * SQLite is the default (zero-config); PostgreSQL and MySQL are opt-in
 * via DATABASE_DRIVER env var.
 *
 * Usage:
 *   import { getDatabaseBackend } from "@/lib/db/backends";
 *   const db = await getDatabaseBackend();
 *   const { rows } = await db.query("SELECT * FROM key_value WHERE namespace = ?", ["settings"]);
 */

export { getDatabaseBackend, getDatabaseBackendSync, resetDatabaseBackend } from "./factory";
export type {
  DatabaseBackend,
  DbDialect,
  DbResult,
  DbExecResult,
  DbRow,
  TransactionHandle,
} from "./types";
export { SqlDialect, createDialect } from "./sqlDialect";
export type { TableInfo } from "./schemaRegistry";
export {
  getTableInfo,
  getTablePrimaryKey,
  getTableColumnList,
  isRegisteredTable,
} from "./schemaRegistry";
export { loadDatabaseBackendConfig, isExternalBackend } from "./config";
export type { DatabaseBackendConfig } from "./config";
export { runBackendMigrations, loadMigrationFiles, resolveMigrationsDir } from "./migrations";
export type { MigrationFile } from "./migrations";
export { exportSqliteToDialect } from "./export";
export type { ExportResult, ExportedTable } from "./export";
export { PersistenceError, classifyError } from "./errors";
export type { PersistenceErrorCode } from "./errors";
export { acquireMigrationLock, releaseMigrationLock, isMigrationLocked } from "./migrationLock";
export type { MigrationLock } from "./migrationLock";
