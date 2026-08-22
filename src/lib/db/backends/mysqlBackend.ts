/**
 * MysqlBackend — DatabaseBackend for MySQL 8.0+.
 *
 * V1 implementation note: this backend is scaffolded as part of the
 * pluggable DB abstraction but is not the primary target for the first
 * milestone (PostgreSQL-first, per issue #8037 co-proposal).
 *
 * mysql2 is used as the driver — it supports `?` placeholders natively
 * (no translation needed), so only DDL type mapping differs from SQLite.
 *
 * Required env:
 *   DATABASE_URL=mysql://user:pass@host:port/dbname
 *   or individual DATABASE_HOST/PORT/NAME/USER/PASSWORD vars
 */

import mysql from "mysql2/promise";
import type {
  DatabaseBackend,
  DbDialect,
  DbResult,
  DbExecResult,
  DbRow,
  TransactionHandle,
} from "./types";
import { SqlDialect } from "./sqlDialect";
import type { DatabaseBackendConfig } from "./config";

export class MysqlBackend implements DatabaseBackend {
  readonly dialect: DbDialect = "mysql";
  readonly isExternal = true;
  private readonly pool: mysql.Pool;
  private readonly dialectCompiler: SqlDialect;

  constructor(config: DatabaseBackendConfig) {
    this.dialectCompiler = new SqlDialect("mysql");

    const connectionConfig: mysql.PoolOptions = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl === true ? { rejectUnauthorized: false } : undefined,
      connectionLimit: config.poolSize,
      queueLimit: 0,
    };

    if (config.connectionString) {
      // Parse connection string — mysql2 accepts URL format
      connectionConfig.uri = config.connectionString;
    }

    this.pool = mysql.createPool(connectionConfig);
  }

  private async getConnection(): Promise<mysql.PoolConnection> {
    return this.pool.getConnection();
  }

  private normalizeRow(row: Record<string, unknown>): DbRow {
    const normalized: DbRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[this.toCamelCase(key)] = value;
    }
    return normalized;
  }

  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  async query(sql: string, params: unknown[] = []): Promise<DbResult> {
    const { sql: translated } = this.dialectCompiler.translate(sql, params);
    const conn = await this.getConnection();
    try {
      const [rows] = await conn.execute(translated, params as never);
      const dbRows: DbRow[] = Array.isArray(rows)
        ? rows.map((r) => this.normalizeRow(r as Record<string, unknown>))
        : [];
      return { rows: dbRows, rowCount: dbRows.length, lastInsertId: undefined };
    } finally {
      conn.release();
    }
  }

  async queryOne(sql: string, params: unknown[] = []): Promise<DbRow | null> {
    const result = await this.query(sql, params);
    return result.rows[0] ?? null;
  }

  async execute(sql: string, params: unknown[] = []): Promise<DbExecResult> {
    const { sql: translated } = this.dialectCompiler.translate(sql, params);
    const conn = await this.getConnection();
    try {
      const result = (await conn.execute(translated, params as never)) as unknown as {
        affectedRows: number;
        insertId?: unknown;
      };
      return { changes: result.affectedRows ?? 0, lastInsertId: result.insertId };
    } finally {
      conn.release();
    }
  }

  async transaction<T>(fn: (tx: TransactionHandle) => Promise<T>): Promise<T> {
    const conn = await this.getConnection();
    const txHandle: TransactionHandle = {
      query: async (sql: string, params: unknown[] = []) => {
        const { sql: translated } = this.dialectCompiler.translate(sql, params);
        const [rows] = await conn.execute(translated, params as never);
        const dbRows: DbRow[] = Array.isArray(rows)
          ? rows.map((r) => this.normalizeRow(r as Record<string, unknown>))
          : [];
        return { rows: dbRows, rowCount: dbRows.length, lastInsertId: undefined };
      },
      queryOne: async (sql: string, params: unknown[] = []) => {
        const result = await txHandle.query(sql, params);
        return result.rows[0] ?? null;
      },
      execute: async (sql: string, params: unknown[] = []) => {
        const { sql: translated } = this.dialectCompiler.translate(sql, params);
        const result = (await conn.execute(translated, params as never)) as unknown as {
          affectedRows: number;
          insertId?: unknown;
        };
        return { changes: result.affectedRows ?? 0, lastInsertId: result.insertId };
      },
    };

    try {
      await conn.beginTransaction();
      const result = await fn(txHandle);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async tableExists(table: string): Promise<boolean> {
    const conn = await this.getConnection();
    try {
      const result = await conn.execute(
        "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND TABLE_NAME = ?",
        [table]
      );
      const rows = result[0] as Array<{ TABLE_NAME: string }>;
      return rows.length > 0;
    } finally {
      conn.release();
    }
  }

  async getTableColumns(table: string): Promise<string[]> {
    const conn = await this.getConnection();
    try {
      const result = await conn.execute(
        "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_name = ? AND table_schema = DATABASE() ORDER BY ordinal_position",
        [table]
      );
      const rows = result[0] as Array<{ COLUMN_NAME: string }>;
      return rows.map((r) => r.COLUMN_NAME);
    } finally {
      conn.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    const conn = await this.getConnection();
    try {
      await conn.query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      conn.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
