/**
 * Classified persistence errors for the DatabaseBackend contract.
 *
 * Every backend operation that fails must throw an error whose `code` falls
 * into one of these categories. Domain modules and retry logic can switch
 * on `code` without coupling to a specific driver's error shapes.
 *
 * Classification follows the PR4 requirements from issue #8075:
 * - transient: safe to retry (connection reset, timeout, deadlock)
 * - constraint: data integrity violation (unique, foreign key, check)
 * - authentication: credential / permission failure
 * - migration: schema version mismatch or lock contention
 * - unknown: unexpected failure (log and classify downstream)
 */

export type PersistenceErrorCode =
  | "TRANSIENT_CONNECTION"
  | "TRANSIENT_TIMEOUT"
  | "TRANSIENT_DEADLOCK"
  | "CONSTRAINT_UNIQUE"
  | "CONSTRAINT_FOREIGN_KEY"
  | "CONSTRAINT_CHECK"
  | "AUTHENTICATION"
  | "MIGRATION_LOCK"
  | "MIGRATION_VERSION"
  | "UNKNOWN";

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly cause?: Error;
  readonly retryable: boolean;

  constructor(code: PersistenceErrorCode, message: string, cause?: Error) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
    this.cause = cause;
    this.retryable = isRetryable(code);
  }
}

/** Determine if a persistence error is safe to retry. */
function isRetryable(code: PersistenceErrorCode): boolean {
  switch (code) {
    case "TRANSIENT_CONNECTION":
    case "TRANSIENT_TIMEOUT":
    case "TRANSIENT_DEADLOCK":
      return true;
    default:
      return false;
  }
}

/**
 * Classify a raw driver error into a PersistenceError.
 * Each backend implements its own classifier since error shapes differ.
 */
export function classifyError(raw: Error, dialect: string): PersistenceError {
  const msg = raw.message.toLowerCase();

  // Transient / retryable
  if (
    (msg.includes("connection") || msg.includes("connect")) &&
    (msg.includes("reset") ||
      msg.includes("refused") ||
      msg.includes("econnrefused") ||
      msg.includes("terminated"))
  ) {
    return new PersistenceError("TRANSIENT_CONNECTION", raw.message, raw);
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return new PersistenceError("TRANSIENT_TIMEOUT", raw.message, raw);
  }
  if (msg.includes("deadlock")) {
    return new PersistenceError("TRANSIENT_DEADLOCK", raw.message, raw);
  }

  // Constraint violations
  if (
    msg.includes("unique") ||
    msg.includes("duplicate key") ||
    msg.includes("duplicate entry") ||
    msg.includes("conflict")
  ) {
    return new PersistenceError("CONSTRAINT_UNIQUE", raw.message, raw);
  }
  if (msg.includes("foreign key") || msg.includes("violates foreign key")) {
    return new PersistenceError("CONSTRAINT_FOREIGN_KEY", raw.message, raw);
  }
  if (msg.includes("check constraint") || msg.includes("violates check")) {
    return new PersistenceError("CONSTRAINT_CHECK", raw.message, raw);
  }

  // Authentication
  if (
    msg.includes("password authentication") ||
    msg.includes("permission denied") ||
    msg.includes("access denied")
  ) {
    return new PersistenceError("AUTHENTICATION", raw.message, raw);
  }

  // Migration
  if (msg.includes("migration") && msg.includes("lock")) {
    return new PersistenceError("MIGRATION_LOCK", raw.message, raw);
  }
  if (msg.includes("migration") && msg.includes("version")) {
    return new PersistenceError("MIGRATION_VERSION", raw.message, raw);
  }

  return new PersistenceError("UNKNOWN", raw.message, raw);
}
