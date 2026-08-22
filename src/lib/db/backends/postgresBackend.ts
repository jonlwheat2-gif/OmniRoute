/**
 * PostgresBackend — DatabaseBackend for PostgreSQL (pg + pg-pool).
 *
 * True async implementation using connection pooling. SQL written in
 * SQLite flavor is automatically translated via the SqlDialect compiler
 * (placeholder conversion `?` → `$1, $2`, INSERT OR REPLACE → ON CONFLICT,
 * PRAGMA table_info → information_schema).
 *
 * Connection config is read from env:
 *   DATABASE_URL (preferred) or DATABASE_HOST/PORT/NAME/USER/PASSWORD
 *   DATABASE_SSL, DATABASE_POOL_SIZE, DATABASE_STATEMENT_TIMEOUT_MS
 *
 * Transaction model:
 *   pg manages an explicit transaction per connection (BEGIN / COMMIT /
 *   ROLLBACK). The async closure receives a TransactionHandle bound to the
 *   pool client, so all operations within the closure share the same
 *   transaction.
 */

import pg from "pg";
const { Pool } = pg;

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

export class PostgresBackend implements DatabaseBackend {
  readonly dialect: DbDialect = "postgres";
  readonly isExternal = true;

  private readonly pool: pg.Pool;
  private readonly dialectTranslator: SqlDialect;
  private readonly defaultClient: pg.PoolClient;

  constructor(config: DatabaseBackendConfig) {
    this.dialectTranslator = new SqlDialect("postgres");

    const poolConfig: pg.PoolConfig = {
      connectionString: config.connectionString,
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl === true ? { rejectUnauthorized: false } : undefined,
      max: config.poolSize,
      statement_timeout: config.statementTimeoutMs,
      idleTimeoutMillis: config.idleTimeoutMs,
      // PostgreSQL defaults: 1 connection pool is too small for a proxy;
      // the config default of 10 is reasonable for most deployments.
    };

    this.pool = new Pool(poolConfig);

    // Test the connection
    this.pool.on("error", (err) => {
      console.error("[DB:postgres] Pool error:", err.message);
    });
  }

  /** Get a client, ensuring the pool is initialized. */
  private async getClient(): Promise<pg.PoolClient> {
    return this.pool.connect();
  }

  async query(sql: string, params: unknown[] = []): Promise<DbResult> {
    const { sql: translated } = this.dialectTranslator.translate(sql, params);
    const client = await this.getClient();
    try {
      const result = await client.query(translated, params);
      const rows: DbRow[] = result.rows.map((row) => this.normalizeRow(row));
      return {
        rows,
        rowCount: result.rowCount ?? rows.length,
        lastInsertId: result.rows[0]?._internal_insert_id ?? undefined,
      };
    } finally {
      client.release();
    }
  }

  async queryOne(sql: string, params: unknown[] = []): Promise<DbRow | null> {
    const result = await this.query(sql, params);
    return result.rows[0] ?? null;
  }

  async execute(sql: string, params: unknown[] = []): Promise<DbExecResult> {
    const { sql: translated } = this.dialectTranslator.translate(sql, params);
    const client = await this.getClient();
    try {
      const result = await client.query(translated, params);
      // For non-SELECT queries, PostgreSQL doesn't return rows.
      // lastInsertId is not natively available; callers should use RETURNING
      // clauses where they need the inserted ID.
      return {
        changes: result.rowCount ?? 0,
        lastInsertId: undefined,
      };
    } finally {
      client.release();
    }
  }

  async transaction<T>(fn: (tx: TransactionHandle) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    const txHandle: TransactionHandle = {
      query: async (sql: string, params: unknown[] = []) => {
        const { sql: translated } = this.dialectTranslator.translate(sql, params);
        const result = await client.query(translated, params);
        const rows: DbRow[] = result.rows.map((row) => this.normalizeRow(row));
        return { rows, rowCount: result.rowCount ?? rows.length, lastInsertId: undefined };
      },
      queryOne: async (sql: string, params: unknown[] = []) => {
        const result = await txHandle.query(sql, params);
        return result.rows[0] ?? null;
      },
      execute: async (sql: string, params: unknown[] = []) => {
        const { sql: translated } = this.dialectTranslator.translate(sql, params);
        const result = await client.query(translated, params);
        return { changes: result.rowCount ?? 0, lastInsertId: undefined };
      },
    };

    try {
      await client.query("BEGIN");
      const result = await fn(txHandle);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("[DB:postgres] Rollback failed:", (rollbackErr as Error)?.message);
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async tableExists(table: string): Promise<boolean> {
    const sql = "SELECT to_regclass($1::regclass) AS exists_flag";
    const client = await this.getClient();
    try {
      const result = await client.query(sql, [table]);
      return result.rows.length > 0 && result.rows[0].exists_flag !== null;
    } finally {
      client.release();
    }
  }

  async getTableColumns(table: string): Promise<string[]> {
    const sql =
      "SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position";
    const client = await this.getClient();
    try {
      const result = await client.query(sql, [table]);
      return result.rows.map((row: Record<string, unknown>) => row.column_name as string);
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.getClient();
      try {
        await client.query("SELECT 1");
        return true;
      } finally {
        client.release();
      }
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Normalize PostgreSQL row keys to match the camelCase convention
   * used by the SQLite layer (via rowToCamel in core.ts).
   * PostgreSQL returns columns as-is from the SQL query; domain modules
   * expect camelCase keys. This applies the same snake_case → camelCase
   * transformation.
   */
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
}
