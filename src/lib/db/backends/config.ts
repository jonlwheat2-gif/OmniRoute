/**
 * DatabaseBackendConfig — configuration parsing for the pluggable DB backend.
 *
 * Driver selection precedence (highest to lowest):
 *   1. Env `DATABASE_DRIVER` (sqlite | postgres | mysql)
 *   2. Default: "sqlite" (zero-config, unchanged behavior)
 *
 * Connection params (PostgreSQL/MySQL only):
 *   DATABASE_URL — standard connection string (preferred)
 *   DATABASE_HOST / DATABASE_PORT / DATABASE_NAME / DATABASE_USER / DATABASE_PASSWORD
 *   DATABASE_SSL — set to "true" to enable TLS
 *   DATABASE_POOL_SIZE — connection pool size (default: 10)
 *
 * SQLite remains the default for local/npm/Electron/Termux deployments.
 * External backends are opt-in for cluster/centralized deployments only.
 */

import type { DbDialect } from "./types";

export interface DatabaseBackendConfig {
  readonly driver: DbDialect;
  readonly connectionString?: string;
  readonly host?: string;
  readonly port?: number;
  readonly database?: string;
  readonly username?: string;
  readonly password?: string;
  readonly ssl?: boolean;
  readonly poolSize: number;
  readonly statementTimeoutMs: number;
  readonly idleTimeoutMs: number;
}

export function loadDatabaseBackendConfig(): DatabaseBackendConfig {
  const driver = (process.env.DATABASE_DRIVER ?? "sqlite").toLowerCase() as DbDialect;

  if (driver !== "sqlite" && driver !== "postgres" && driver !== "mysql") {
    console.warn(
      `[DB] Unknown DATABASE_DRIVER="${process.env.DATABASE_DRIVER}" — falling back to sqlite.`
    );
    return {
      driver: "sqlite",
      poolSize: 0,
      statementTimeoutMs: 0,
      idleTimeoutMs: 0,
    };
  }

  if (driver === "sqlite") {
    return {
      driver: "sqlite",
      poolSize: 0,
      statementTimeoutMs: 0,
      idleTimeoutMs: 0,
    };
  }

  const connectionString = process.env.DATABASE_URL;
  const host = process.env.DATABASE_HOST;
  const port = process.env.DATABASE_PORT ? parseInt(process.env.DATABASE_PORT, 10) : undefined;
  const database = process.env.DATABASE_NAME;
  const username = process.env.DATABASE_USER;
  const password = process.env.DATABASE_PASSWORD;
  const ssl = process.env.DATABASE_SSL
    ? /^(1|true|yes|on)$/i.test(process.env.DATABASE_SSL)
    : undefined;

  const poolSize = process.env.DATABASE_POOL_SIZE
    ? parseInt(process.env.DATABASE_POOL_SIZE, 10)
    : 10;
  const statementTimeoutMs = process.env.DATABASE_STATEMENT_TIMEOUT_MS
    ? parseInt(process.env.DATABASE_STATEMENT_TIMEOUT_MS, 10)
    : 30_000;
  const idleTimeoutMs = process.env.DATABASE_IDLE_TIMEOUT_MS
    ? parseInt(process.env.DATABASE_IDLE_TIMEOUT_MS, 10)
    : 10_000;

  return {
    driver,
    connectionString,
    host,
    port,
    database,
    username,
    password,
    ssl,
    poolSize,
    statementTimeoutMs,
    idleTimeoutMs,
  };
}

export function isExternalBackend(driver: DbDialect): boolean {
  return driver !== "sqlite";
}
