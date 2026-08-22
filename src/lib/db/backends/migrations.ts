/**
 * Backend Migrations — Dialect-aware migration runner for external backends.
 *
 * For SQLite, the existing migrationRunner.ts is used (it handles the
 * 157 .sql migration files natively).
 *
 * For PostgreSQL/MySQL, this module:
 * 1. Reads the same .sql migration files from src/lib/db/migrations/
 * 2. Translates each migration's DDL + DML through the SqlDialect compiler
 * 3. Splits multi-statement migrations into individual statements
 * 4. Executes them via the DatabaseBackend
 * 5. Tracks applied versions in the `_omniroute_migrations` table
 *
 * The migration table schema:
 *   CREATE TABLE _omniroute_migrations (
 *     version TEXT PRIMARY KEY,
 *     name    TEXT NOT NULL,
 *     applied_at TIMESTAMP DEFAULT NOW()
 *   )
 *
 * Usage:
 *   const backend = await getDatabaseBackend();
 *   await runBackendMigrations(backend);
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDbInstance } from "../core";
import type { DatabaseBackend, TransactionHandle } from "./types";
import { SqlDialect } from "./sqlDialect";

export interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  sql: string;
}

const MIGRATION_DDL_TABLE = "_omniroute_migrations";

/**
 * Resolve the migrations directory path.
 * Reuses the same directory as the existing migrationRunner.ts.
 */
export function resolveMigrationsDir(): string {
  const configuredDir = process.env.OMNIROUTE_MIGRATIONS_DIR;
  if (typeof configuredDir === "string" && configuredDir.trim().length > 0) {
    return path.resolve(configuredDir);
  }

  let currentDir: string;
  try {
    currentDir = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    currentDir = process.cwd();
  }

  while (currentDir !== path.dirname(currentDir)) {
    const candidate = path.join(currentDir, "src", "lib", "db", "migrations");
    if (fs.existsSync(candidate)) return candidate;
    currentDir = path.dirname(currentDir);
  }

  // Fallback: check process.cwd and parent directories
  currentDir = process.cwd();
  while (currentDir !== path.dirname(currentDir)) {
    const candidate = path.join(currentDir, "src", "lib", "db", "migrations");
    if (fs.existsSync(candidate)) return candidate;
    currentDir = path.dirname(currentDir);
  }

  throw new Error(
    "[BackendMigration] Could not resolve migrations directory. Set OMNIROUTE_MIGRATIONS_DIR."
  );
}

/**
 * Split SQL migration text into individual statements.
 * Handles SQLite's statement separator (semicolon) while respecting
 * string literals and comments.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;
  let stringChar = "";
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      current += char;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        current += char + next;
        i++;
      } else {
        current += char;
      }
      continue;
    }

    if (inString) {
      current += char;
      if (char === stringChar) {
        // Check for escaped quote (doubled)
        if (next === stringChar) {
          current += next;
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (char === "-" && next === "-") {
      inLineComment = true;
      current += char + next;
      i++;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      current += char + next;
      i++;
      continue;
    }

    if (char === "'" || char === '"') {
      inString = true;
      stringChar = char;
      current += char;
      continue;
    }

    if (char === ";" && !inString && !inLineComment && !inBlockComment) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);

  return statements;
}

/**
 * Parse migration files from the migrations directory.
 * Files are named NNN_description.sql.
 */
export function loadMigrationFiles(): MigrationFile[] {
  const dir = resolveMigrationsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));

  const migrations: MigrationFile[] = [];
  for (const filename of files) {
    const match = filename.match(/^(\d+)_(.+)\.sql$/);
    if (!match) continue;

    const version = match[1];
    const name = match[2];
    const sql = fs.readFileSync(path.join(dir, filename), "utf-8");
    migrations.push({ version, name, filename, sql });
  }

  migrations.sort((a, b) => a.version.localeCompare(b.version));
  return migrations;
}

/**
 * Get the set of already-applied migration versions.
 */
async function getAppliedVersions(backend: DatabaseBackend): Promise<Set<string>> {
  try {
    const { rows } = await backend.query(`SELECT version FROM ${MIGRATION_DDL_TABLE}`);
    return new Set(rows.map((r) => String(r.version)));
  } catch {
    return new Set();
  }
}

/**
 * Ensure the migrations tracking table exists.
 */
async function ensureMigrationsTable(backend: DatabaseBackend): Promise<void> {
  await backend.execute(
    `CREATE TABLE IF NOT EXISTS ${MIGRATION_DDL_TABLE} (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    )`
  );
}

/**
 * Record a migration as applied.
 */
async function recordMigration(
  backend: DatabaseBackend,
  version: string,
  name: string
): Promise<void> {
  await backend.execute(`INSERT INTO ${MIGRATION_DDL_TABLE} (version, name) VALUES (?, ?)`, [
    version,
    name,
  ]);
}

/**
 * Run all pending migrations on the given backend.
 *
 * For SQLite, delegates to the existing migrationRunner.ts.
 * For PostgreSQL/MySQL, translates each migration's SQL through the
 * SqlDialect compiler and executes via the backend.
 */
export async function runBackendMigrations(
  backend: DatabaseBackend,
  options?: {
    dryRun?: boolean;
    maxVersion?: string;
  }
): Promise<{
  applied: Array<{ version: string; name: string }>;
  skipped: Array<{ version: string; name: string }>;
  errors: Array<{ version: string; name: string; error: string }>;
}> {
  const dialect = new SqlDialect(backend.dialect);
  const applied: Array<{ version: string; name: string }> = [];
  const skipped: Array<{ version: string; name: string }> = [];
  const errors: Array<{ version: string; name: string; error: string }> = [];

  // For SQLite, delegate to the existing migration runner
  if (backend.dialect === "sqlite") {
    const { runMigrations: runSqliteMigrations } = await import("../migrationRunner.ts");
    const db = getDbInstance();
    runSqliteMigrations(db, { isNewDb: !(await backend.tableExists(MIGRATION_DDL_TABLE)) });
    return { applied: [], skipped: [], errors: [] };
  }

  // For external backends
  await ensureMigrationsTable(backend);

  const appliedVersions = await getAppliedVersions(backend);
  const migrations = loadMigrationFiles();
  const maxVersion = options?.maxVersion;

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      skipped.push({ version: migration.version, name: migration.name });
      continue;
    }

    if (maxVersion && migration.version > maxVersion) {
      skipped.push({ version: migration.version, name: migration.name });
      continue;
    }

    try {
      if (options?.dryRun) {
        const translated = dialect.translateMigration(migration.sql);
        console.log(`[BackendMigration] DRY RUN: ${migration.filename}`);
        console.log(translated);
        applied.push({ version: migration.version, name: migration.name });
        continue;
      }

      // Translate the migration SQL to the target dialect
      const translated = dialect.translateMigration(migration.sql);
      const statements = splitStatements(translated);

      // Execute all statements in a transaction
      await backend.transaction(async (tx) => {
        for (const stmt of statements) {
          if (stmt.trim()) {
            await tx.execute(stmt);
          }
        }
      });

      await recordMigration(backend, migration.version, migration.name);
      applied.push({ version: migration.version, name: migration.name });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ version: migration.version, name: migration.name, error: message });
      console.error(
        `[BackendMigration] Failed to apply migration ${migration.version}_${migration.name}:`,
        message
      );
    }
  }

  return { applied, skipped, errors };
}
