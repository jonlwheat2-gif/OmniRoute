/**
 * SqlDialect — SQLite → PostgreSQL/MySQL SQL translation.
 *
 * Domain modules write SQLite-flavored SQL (positional `?` params,
 * `INSERT OR REPLACE`, `PRAGMA table_info`, etc.). The dialect compiler
 * rewrites these into the target backend's dialect so the same domain
 * module code works unchanged across SQLite, PostgreSQL, and MySQL.
 *
 * Translation rules:
 * 1. `?` placeholders → `$1, $2, ...` (PostgreSQL) or kept as `?` (MySQL)
 * 2. `INSERT OR REPLACE INTO` → `INSERT INTO ... ON CONFLICT (pk) DO UPDATE SET ...`
 * 3. `INSERT OR IGNORE INTO` → `INSERT INTO ... ON CONFLICT DO NOTHING`
 * 4. `PRAGMA table_info(table)` → `information_schema.columns` query (Postgres/MySQL)
 * 5. String literal safety — `?` inside `'...'` is never translated
 */

import { getTablePrimaryKey } from "./schemaRegistry";
import type { DbDialect } from "./types";

export class SqlDialect {
  readonly dialect: DbDialect;

  constructor(dialect: DbDialect) {
    this.dialect = dialect;
  }

  /**
   * Translate a SQLite-flavored SQL string + params into the target dialect.
   * Returns { sql, params } — params are unchanged (only the placeholder
   * syntax in the SQL string is rewritten).
   */
  translate(sql: string, params: unknown[] = []): { sql: string; params: unknown[] } {
    let translated = sql;

    translated = this.rewriteInsertOrReplace(translated);
    translated = this.rewriteInsertOrIgnore(translated);
    translated = this.rewritePragmaTableInfo(translated);

    if (this.dialect === "postgres") {
      translated = this.convertPlaceholders(translated);
    }

    return { sql: translated, params };
  }

  /**
   * Convert `?` placeholders to PostgreSQL `$1, $2, ...` style.
   * Skips `?` characters that appear inside single-quoted string literals.
   */
  private convertPlaceholders(sql: string): string {
    let result = "";
    let i = 0;
    let paramIndex = 0;

    while (i < sql.length) {
      const char = sql[i];
      if (char === "'") {
        // Copy the entire string literal verbatim (handle '' escapes)
        result += char;
        i++;
        while (i < sql.length) {
          const c = sql[i];
          result += c;
          if (c === "'") {
            // Check for escaped single quote ''
            if (i + 1 < sql.length && sql[i + 1] === "'") {
              result += sql[i + 1];
              i += 2;
              continue;
            }
            i++;
            break;
          }
          i++;
        }
        continue;
      }

      if (char === "?") {
        paramIndex++;
        result += `$${paramIndex}`;
        i++;
        continue;
      }

      result += char;
      i++;
    }

    return result;
  }

  /**
   * Rewrite `INSERT OR REPLACE INTO table (cols) VALUES (...)` into
   * dialect-correct upsert:
   * - PostgreSQL: `INSERT INTO table (cols) VALUES (...) ON CONFLICT (pk) DO UPDATE SET ...`
   * - MySQL: `INSERT INTO table (cols) VALUES (...) ON DUPLICATE KEY UPDATE ...`
   * - SQLite: left as-is (INSERT OR REPLACE is native)
   *
   * Uses a regex that captures the table name, column list, and VALUES clause
   * (without nested-paren support — sufficient for the codebase's simple VALUES).
   */
  private rewriteInsertOrReplace(sql: string): string {
    if (this.dialect === "sqlite") return sql;

    // Match: INSERT OR REPLACE INTO table_name (col_list) VALUES (val_list)
    // [^;]* is greedy and captures up to the next semicolon or end of string.
    // The col/val lists use [^)]* — works for simple values without nested parens.
    const regex = /\binsert\s+or\s+replace\s+into\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]*)\)/gi;

    return sql.replace(
      regex,
      (_match: string, tableName: string, colList: string, valueList: string) => {
        const allColumns = colList
          .split(",")
          .map((c: string) => c.trim())
          .filter((c: string) => c.length > 0);

        const pkColumns = getTablePrimaryKey(tableName);
        const updateColumns =
          pkColumns.length > 0
            ? allColumns.filter((c: string) => !pkColumns.includes(c))
            : allColumns;

        if (this.dialect === "postgres") {
          if (pkColumns.length > 0) {
            const setClause = updateColumns
              .map((col: string) => `${col} = EXCLUDED.${col}`)
              .join(", ");
            const conflictCols = pkColumns.join(", ");
            return `INSERT INTO ${tableName} (${colList}) VALUES (${valueList}) ON CONFLICT (${conflictCols}) DO UPDATE SET ${setClause}`;
          }
          // No PK registered — fall back to DO NOTHING (can't determine conflict target)
          return `INSERT INTO ${tableName} (${colList}) VALUES (${valueList}) ON CONFLICT DO NOTHING`;
        }

        if (this.dialect === "mysql") {
          const setClause = updateColumns
            .map((col: string) => `${col} = VALUES(${col})`)
            .join(", ");
          return `INSERT INTO ${tableName} (${colList}) VALUES (${valueList}) ON DUPLICATE KEY UPDATE ${setClause}`;
        }

        return _match;
      }
    );
  }

  /**
   * Rewrite `INSERT OR IGNORE INTO table (cols) VALUES (...)` into:
   * - PostgreSQL: `INSERT INTO table (cols) VALUES (...) ON CONFLICT DO NOTHING`
   * - MySQL: `INSERT IGNORE INTO table (cols) VALUES (...)`
   */
  private rewriteInsertOrIgnore(sql: string): string {
    const regex = /\binsert\s+or\s+ignore\s+into\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]*)\)/gi;

    if (this.dialect === "postgres") {
      return sql.replace(regex, "INSERT INTO $1 ($2) VALUES ($3) ON CONFLICT DO NOTHING");
    }

    if (this.dialect === "mysql") {
      return sql.replace(regex, "INSERT IGNORE INTO $1 ($2) VALUES ($3)");
    }

    return sql;
  }

  /**
   * Rewrite `PRAGMA table_info(tableName)` into a dialect-correct column
   * introspection query:
   * - PostgreSQL: `SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'tableName'`
   * - MySQL: same information_schema query
   * - SQLite: left as-is (PRAGMA is native)
   */
  private rewritePragmaTableInfo(sql: string): string {
    const regex = /\bpragma\s+table_info\s*\(\s*['"]?(\w+)['"]?\s*\)/gi;
    const match = regex.exec(sql);
    if (!match) return sql;

    const tableName = match[1];

    if (this.dialect === "postgres" || this.dialect === "mysql") {
      // SQLite's PRAGMA table_info returns columns: cid, name, type, notnull, dflt_value, pk
      // We return name as the primary column, with synthetic columns to maintain shape
      const replacement =
        `SELECT cid AS cid, name AS name, type AS type, ` +
        `0 AS notnull, NULL AS dflt_value, 0 AS pk ` +
        `FROM information_schema.columns WHERE table_name = '${tableName}'`;
      return sql.replace(regex, replacement);
    }

    return sql;
  }

  /**
   * Translate a CREATE TABLE DDL statement from SQLite dialect to
   * PostgreSQL/MySQL. Handles:
   * - `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY` (Postgres) / `INT AUTO_INCREMENT PRIMARY KEY` (MySQL)
   * - `INTEGER PRIMARY KEY` → `INTEGER PRIMARY KEY` (same)
   * - `TEXT PRIMARY KEY` → `TEXT PRIMARY KEY` (same)
   * - `BLOB` → `BYTEA` (Postgres) / `LONGBLOB` (MySQL)
   */
  translateDdl(ddl: string): string {
    if (this.dialect === "postgres") {
      return ddl
        .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, "SERIAL PRIMARY KEY")
        .replace(/\bBLOB\b/gi, "BYTEA")
        .replace(/\bdatetime\('now'\)/gi, "NOW()")
        .replace(/DEFAULT\s+datetime\('now'\)/gi, "DEFAULT NOW()");
    }

    if (this.dialect === "mysql") {
      return ddl
        .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, "INT AUTO_INCREMENT PRIMARY KEY")
        .replace(/\bBLOB\b/gi, "LONGBLOB")
        .replace(/\bdatetime\('now'\)/gi, "NOW()");
    }

    return ddl;
  }

  /**
   * Translate a full migration file (which may contain multiple statements
   * separated by newlines/semicolons). Handles DDL + DML translation.
   */
  translateMigration(migrationSql: string): string {
    let result = this.translateDdl(migrationSql);
    // Apply DML-level translations (INSERT OR REPLACE, pragas, etc.)
    result = this.rewriteInsertOrReplace(result);
    result = this.rewriteInsertOrIgnore(result);
    result = this.rewritePragmaTableInfo(result);
    return result;
  }
}

export function createDialect(dialect: DbDialect): SqlDialect {
  return new SqlDialect(dialect);
}
