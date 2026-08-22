/**
 * Persistence Error Classification Tests
 *
 * Verifies that classifyError correctly categorizes raw driver errors
 * into PersistenceError codes, matching the PR4 requirements from #8075.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { PersistenceError, classifyError } from "@/lib/db/backends/errors";

test("classifyError: connection reset → TRANSIENT_CONNECTION", () => {
  const err = classifyError(new Error("Connection reset by peer"), "postgres");
  assert.equal(err.code, "TRANSIENT_CONNECTION");
  assert.equal(err.retryable, true);
});

test("classifyError: connection refused → TRANSIENT_CONNECTION", () => {
  const err = classifyError(new Error("connect ECONNREFUSED 127.0.0.1:5432"), "postgres");
  assert.equal(err.code, "TRANSIENT_CONNECTION", `got ${err.code} for message: ${err.message}`);
  assert.equal(err.retryable, true);
});

test("classifyError: timeout → TRANSIENT_TIMEOUT", () => {
  const err = classifyError(new Error("query timeout exceeded"), "postgres");
  assert.equal(err.code, "TRANSIENT_TIMEOUT");
  assert.equal(err.retryable, true);
});

test("classifyError: timed out → TRANSIENT_TIMEOUT", () => {
  const err = classifyError(new Error("operation timed out"), "mysql");
  assert.equal(err.code, "TRANSIENT_TIMEOUT");
  assert.equal(err.retryable, true);
});

test("classifyError: deadlock → TRANSIENT_DEADLOCK", () => {
  const err = classifyError(new Error("deadlock detected"), "postgres");
  assert.equal(err.code, "TRANSIENT_DEADLOCK");
  assert.equal(err.retryable, true);
});

test("classifyError: unique violation → CONSTRAINT_UNIQUE", () => {
  const err = classifyError(
    new Error("duplicate key value violates unique constraint"),
    "postgres"
  );
  assert.equal(err.code, "CONSTRAINT_UNIQUE");
  assert.equal(err.retryable, false);
});

test("classifyError: duplicate entry (MySQL) → CONSTRAINT_UNIQUE", () => {
  const err = classifyError(new Error("Duplicate entry 'foo' for key 'PRIMARY'"), "mysql");
  assert.equal(err.code, "CONSTRAINT_UNIQUE");
  assert.equal(err.retryable, false);
});

test("classifyError: conflict (SQLite) → CONSTRAINT_UNIQUE", () => {
  const err = classifyError(new Error("UNIQUE constraint failed: combos.name"), "sqlite");
  assert.equal(err.code, "CONSTRAINT_UNIQUE");
  assert.equal(err.retryable, false);
});

test("classifyError: foreign key violation → CONSTRAINT_FOREIGN_KEY", () => {
  const err = classifyError(new Error("violates foreign key constraint"), "postgres");
  assert.equal(err.code, "CONSTRAINT_FOREIGN_KEY");
  assert.equal(err.retryable, false);
});

test("classifyError: check constraint → CONSTRAINT_CHECK", () => {
  const err = classifyError(new Error("new row violates check constraint"), "postgres");
  assert.equal(err.code, "CONSTRAINT_CHECK");
  assert.equal(err.retryable, false);
});

test("classifyError: password auth → AUTHENTICATION", () => {
  const err = classifyError(new Error("password authentication failed for user"), "postgres");
  assert.equal(err.code, "AUTHENTICATION");
  assert.equal(err.retryable, false);
});

test("classifyError: permission denied → AUTHENTICATION", () => {
  const err = classifyError(new Error("permission denied for table key_value"), "postgres");
  assert.equal(err.code, "AUTHENTICATION");
  assert.equal(err.retryable, false);
});

test("classifyError: migration lock → MIGRATION_LOCK", () => {
  const err = classifyError(new Error("migration lock acquisition failed"), "postgres");
  assert.equal(err.code, "MIGRATION_LOCK");
  assert.equal(err.retryable, false);
});

test("classifyError: migration version mismatch → MIGRATION_VERSION", () => {
  const err = classifyError(new Error("migration version mismatch expected 42 got 43"), "postgres");
  assert.equal(err.code, "MIGRATION_VERSION");
  assert.equal(err.retryable, false);
});

test("classifyError: unknown error → UNKNOWN", () => {
  const err = classifyError(new Error("something weird happened"), "postgres");
  assert.equal(err.code, "UNKNOWN");
  assert.equal(err.retryable, false);
});

test("PersistenceError: has correct name and message", () => {
  const err = new PersistenceError("CONSTRAINT_UNIQUE", "test message");
  assert.equal(err.name, "PersistenceError");
  assert.equal(err.message, "test message");
  assert.equal(err.code, "CONSTRAINT_UNIQUE");
});

test("PersistenceError: cause is preserved", () => {
  const cause = new Error("original");
  const err = new PersistenceError("UNKNOWN", "wrapped", cause);
  assert.equal(err.cause, cause);
});
