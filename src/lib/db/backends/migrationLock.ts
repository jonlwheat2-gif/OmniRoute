/**
 * Migration Lock — process-local migration ownership contract.
 *
 * In a single-replica deployment, this prevents concurrent migration
 * execution within the same process. In a multi-replica deployment,
 * this is a *seam* for a future distributed lock (e.g., PostgreSQL
 * advisory locks, Redis SETNX, or a database row lock).
 *
 * The current implementation is intentionally process-local:
 * it does NOT claim to provide cross-replica coordination.
 * Cross-replica migration ownership is explicitly out of scope for
 * the initial backend abstraction (PR4 per issue #8075).
 *
 * Usage:
 *   const lock = await acquireMigrationLock(backend);
 *   try {
 *     await runMigrations(backend);
 *   } finally {
 *     await releaseMigrationLock(lock);
 *   }
 */

import type { DatabaseBackend } from "./types";

export interface MigrationLock {
  readonly acquiredAt: Date;
  readonly holderId: string;
  readonly expiresAt: Date;
}

const LOCK_TABLE = "_omniroute_migration_lock";
const LOCK_KEY = "migration";
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Ensure the migration lock table exists.
 */
async function ensureLockTable(backend: DatabaseBackend): Promise<void> {
  await backend.execute(`
    CREATE TABLE IF NOT EXISTS ${LOCK_TABLE} (
      lock_key TEXT PRIMARY KEY,
      holder_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);
}

/**
 * Attempt to acquire the migration lock.
 *
 * Returns a MigrationLock on success, or null if another holder
 * currently owns the lock (and it hasn't expired).
 *
 * This is a process-local contract. The "holder_id" is a random
 * string unique to this process invocation. For distributed locking,
 * this would need to be replaced with a coordination service.
 */
export async function acquireMigrationLock(
  backend: DatabaseBackend
): Promise<MigrationLock | null> {
  await ensureLockTable(backend);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
  const holderId = `process-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Try to clean up expired locks first
  await backend.execute(`DELETE FROM ${LOCK_TABLE} WHERE expires_at < ?`, [now.toISOString()]);

  // Try to insert — if it fails, someone else holds the lock
  try {
    await backend.execute(
      `INSERT INTO ${LOCK_TABLE} (lock_key, holder_id, acquired_at, expires_at) VALUES (?, ?, ?, ?)`,
      [LOCK_KEY, holderId, now.toISOString(), expiresAt.toISOString()]
    );
    return { acquiredAt: now, holderId, expiresAt };
  } catch {
    // Lock is held by another process — check if it's expired
    const row = await backend.queryOne(`SELECT expires_at FROM ${LOCK_TABLE} WHERE lock_key = ?`, [
      LOCK_KEY,
    ]);
    if (row && new Date(row.expires_at as string) > now) {
      return null; // Still locked
    }
    // Expired — force-acquire
    await backend.execute(`DELETE FROM ${LOCK_TABLE} WHERE lock_key = ?`, [LOCK_KEY]);
    await backend.execute(
      `INSERT INTO ${LOCK_TABLE} (lock_key, holder_id, acquired_at, expires_at) VALUES (?, ?, ?, ?)`,
      [LOCK_KEY, holderId, now.toISOString(), expiresAt.toISOString()]
    );
    return { acquiredAt: now, holderId, expiresAt };
  }
}

/**
 * Release the migration lock. Only the holder who acquired it should
 * release it. In practice, the TTL provides automatic expiry for
 * crashed processes.
 */
export async function releaseMigrationLock(
  backend: DatabaseBackend,
  lock: MigrationLock
): Promise<void> {
  await backend.execute(`DELETE FROM ${LOCK_TABLE} WHERE lock_key = ? AND holder_id = ?`, [
    LOCK_KEY,
    lock.holderId,
  ]);
}

/**
 * Check if the migration lock is currently held.
 */
export async function isMigrationLocked(backend: DatabaseBackend): Promise<boolean> {
  try {
    await ensureLockTable(backend);
    const row = await backend.queryOne(
      `SELECT 1 FROM ${LOCK_TABLE} WHERE lock_key = ? AND expires_at > ?`,
      [LOCK_KEY, new Date().toISOString()]
    );
    return row !== null;
  } catch {
    return false;
  }
}
