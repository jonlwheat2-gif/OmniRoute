/**
 * Backend Factory — lazy singleton factory for DatabaseBackend.
 *
 * Follows the same pattern as src/lib/quota/storeFactory.ts (QUOTA_STORE_DRIVER).
 *
 * Driver selection precedence (highest to lowest):
 *   1. Env `DATABASE_DRIVER` (sqlite | postgres | mysql)
 *   2. Default: "sqlite" (zero-config, unchanged behavior)
 *
 * For PostgreSQL/MySQL, connection params come from DATABASE_URL or
 * individual env vars (DATABASE_HOST, DATABASE_PORT, etc.).
 *
 * The singleton is initialised on first call to getDatabaseBackend()
 * (lazy async import to avoid circular deps and to keep the module
 * loadable in environments without a DB). Use resetDatabaseBackend()
 * in tests.
 */

import { createLogger } from "@/shared/utils/logger";
import type { DatabaseBackend } from "./types";

const log = createLogger("db:backend");

let _backend: DatabaseBackend | null = null;

/** Reset the singleton (test-only). */
export function resetDatabaseBackend(): void {
  if (_backend) {
    _backend.close().catch((err) => {
      log.warn({ err }, "Failed to close backend during reset");
    });
  }
  _backend = null;
}

/**
 * Return the singleton DatabaseBackend, initialising it on first call.
 *
 * This function is async because PostgreSQL/MySQL connection setup is async.
 * After the first call it returns from the cached singleton.
 */
export async function getDatabaseBackend(): Promise<DatabaseBackend> {
  if (_backend) return _backend;

  const { loadDatabaseBackendConfig } = await import("./config");
  const { SqliteBackend } = await import("./sqliteBackend");

  const config = loadDatabaseBackendConfig();

  if (config.driver === "sqlite") {
    log.info("DatabaseBackend: using SQLite driver");
    _backend = new SqliteBackend();
    return _backend;
  }

  // External backend (PostgreSQL or MySQL)
  if (config.driver === "postgres") {
    const { PostgresBackend } = await import("./postgresBackend");
    try {
      _backend = new PostgresBackend(config);
      await _backend.healthCheck();
      log.info("DatabaseBackend: using PostgreSQL driver");
      return _backend;
    } catch (err) {
      log.error(
        { err: (err as Error)?.message },
        "DatabaseBackend: PostgreSQL connection failed — falling back to SQLite"
      );
      _backend = new SqliteBackend();
      return _backend;
    }
  }

  if (config.driver === "mysql") {
    const { MysqlBackend } = await import("./mysqlBackend");
    try {
      _backend = new MysqlBackend(config);
      await _backend.healthCheck();
      log.info("DatabaseBackend: using MySQL driver");
      return _backend;
    } catch (err) {
      log.error(
        { err: (err as Error)?.message },
        "DatabaseBackend: MySQL connection failed — falling back to SQLite"
      );
      _backend = new SqliteBackend();
      return _backend;
    }
  }

  // Fallback (shouldn't reach here due to config validation)
  _backend = new SqliteBackend();
  return _backend;
}

/**
 * Synchronous version for callers that know the backend has been initialised.
 * Throws if called before getDatabaseBackend() has resolved.
 */
export function getDatabaseBackendSync(): DatabaseBackend {
  if (!_backend) {
    throw new Error(
      "DatabaseBackend has not been initialised yet. Call getDatabaseBackend() first."
    );
  }
  return _backend;
}
