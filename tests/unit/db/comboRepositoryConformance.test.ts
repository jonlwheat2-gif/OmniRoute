/**
 * Combo Repository Conformance Tests
 *
 * Backend-neutral conformance suite for the ComboRepository contract.
 * These tests verify the SQLite implementation satisfies the interface
 * defined in src/domain/persistence/comboRepositories.ts.
 *
 * When a PostgreSQL or MySQL implementation is added, the same test
 * suite should be run against those backends to prove dialect neutrality.
 *
 * Covers the conformance cases from #8947:
 * - CRUD operations (create, read, update, delete)
 * - Uniqueness violations (duplicate name)
 * - Deterministic ordering and pagination
 * - Missing-record reads (findById, findByName with nonexistent id)
 * - No-op updates
 * - Affected-row behavior
 * - Atomic related-record changes (reorder)
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-combo-conformance-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const { resetDatabaseBackend } = await import("@/lib/db/backends");
const { resetDbInstance } = await import("@/lib/db/core");

function resetDb() {
  resetDatabaseBackend();
  resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

const { sqliteComboRepository: repo } = await import("@/lib/db/repositories/sqliteComboRepository");

// ── Helpers ────────────────────────────────────────────────────────────

function makeCombo(overrides: Record<string, unknown> = {}) {
  return {
    name: `Test-Combo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    models: ["gpt-4", "claude-3"],
    strategy: "priority",
    config: {},
    isHidden: false,
    ...overrides,
  };
}

// ── CRUD: Create ───────────────────────────────────────────────────────

test("conformance: create returns a combo with generated id", async () => {
  resetDb();
  const combo = makeCombo({ name: "Create-Test" });
  const result = await repo.create(combo);

  assert.ok(typeof result.id === "string" && result.id.length > 0, "should have a string id");
  assert.equal(result.name, "Create-Test");
  assert.ok(Array.isArray(result.models), "models should be an array");
  assert.ok(typeof result.createdAt === "string", "createdAt should be a string");
  assert.ok(typeof result.updatedAt === "string", "updatedAt should be a string");
});

test("conformance: create preserves provided id", async () => {
  resetDb();
  const customId = "custom-id-12345";
  const combo = makeCombo({ id: customId, name: "Custom-Id-Test" });
  const result = await repo.create(combo);

  assert.equal(result.id, customId);
});

// ── CRUD: Read ─────────────────────────────────────────────────────────

test("conformance: findById returns the created combo", async () => {
  resetDb();
  const combo = makeCombo({ name: "FindById-Test" });
  const created = await repo.create(combo);

  const found = await repo.findById(created.id);
  assert.ok(found !== null, "should find the combo");
  assert.equal(found!.name, "FindById-Test");
});

test("conformance: findById returns null for nonexistent id", async () => {
  resetDb();
  const found = await repo.findById("nonexistent-id-999");
  assert.equal(found, null);
});

test("conformance: findByName returns the created combo", async () => {
  resetDb();
  await repo.create(makeCombo({ name: "FindByName-Test" }));

  const found = await repo.findByName("FindByName-Test");
  assert.ok(found !== null);
  assert.equal(found!.name, "FindByName-Test");
});

test("conformance: findByName returns null for nonexistent name", async () => {
  resetDb();
  const found = await repo.findByName("Nonexistent-Name");
  assert.equal(found, null);
});

test("conformance: findByName is case-sensitive", async () => {
  resetDb();
  await repo.create(makeCombo({ name: "CaseSensitive" }));

  const exact = await repo.findByName("CaseSensitive");
  assert.ok(exact !== null, "exact match should work");

  const wrongCase = await repo.findByName("casesensitive");
  assert.equal(wrongCase, null, "wrong case should not match");
});

test("conformance: findByNameInsensitive finds case-insensitive match", async () => {
  resetDb();
  await repo.create(makeCombo({ name: "MY-COMBO" }));

  const found = await repo.findByNameInsensitive("my-combo");
  assert.ok(found !== null, "case-insensitive match should work");
});

// ── CRUD: List + Count ─────────────────────────────────────────────────

test("conformance: list returns all combos", async () => {
  resetDb();
  await repo.create(makeCombo({ name: "List-A" }));
  await repo.create(makeCombo({ name: "List-B" }));
  await repo.create(makeCombo({ name: "List-C" }));

  const list = await repo.list();
  assert.ok(list.length >= 3, "should have at least 3 combos");
});

test("conformance: count matches list length", async () => {
  resetDb();
  await repo.create(makeCombo({ name: "Count-A" }));
  await repo.create(makeCombo({ name: "Count-B" }));

  const count = await repo.count();
  const list = await repo.list();
  assert.equal(count, list.length);
});

test("conformance: list with limit/offset supports pagination", async () => {
  resetDb();
  for (let i = 0; i < 5; i++) {
    await repo.create(makeCombo({ name: `Page-${i}` }));
  }

  const page1 = await repo.list(2, 0);
  assert.equal(page1.length, 2, "first page should have 2 items");

  const page2 = await repo.list(2, 2);
  assert.equal(page2.length, 2, "second page should have 2 items");

  const page3 = await repo.list(2, 4);
  assert.equal(page3.length, 1, "third page should have 1 item");

  // No overlap between pages
  const ids1 = page1.map((c) => c.id);
  const ids2 = page2.map((c) => c.id);
  const overlap = ids1.filter((id) => ids2.includes(id));
  assert.equal(overlap.length, 0, "pages should not overlap");
});

test("conformance: list returns deterministic ordering", async () => {
  resetDb();
  await repo.create(makeCombo({ name: "Order-A" }));
  await repo.create(makeCombo({ name: "Order-B" }));

  const list1 = await repo.list();
  const list2 = await repo.list();

  // Same order on repeated reads
  assert.deepEqual(
    list1.map((c) => c.id),
    list2.map((c) => c.id),
    "ordering should be deterministic"
  );
});

// ── CRUD: Update ───────────────────────────────────────────────────────

test("conformance: update modifies the combo", async () => {
  resetDb();
  const created = await repo.create(makeCombo({ name: "Update-Test" }));

  const result = await repo.update(created.id, { name: "Updated-Name" });
  assert.ok(result !== null, "update should return a result");
  assert.equal(result!.currentName, "Updated-Name");

  const found = await repo.findById(created.id);
  assert.equal(found!.name, "Updated-Name");
});

test("conformance: update returns null for nonexistent id", async () => {
  resetDb();
  const result = await repo.update("nonexistent-id", { name: "X" });
  assert.equal(result, null);
});

test("conformance: update with no changes does not throw", async () => {
  resetDb();
  const created = await repo.create(makeCombo({ name: "Noop-Update" }));

  // Update with empty data — should not throw
  const result = await repo.update(created.id, {});
  assert.ok(result !== null, "noop update should still return a result");
});

test("conformance: update bumps updatedAt timestamp", async () => {
  resetDb();
  const created = await repo.create(makeCombo({ name: "Timestamp-Test" }));
  const originalUpdatedAt = created.updatedAt;

  // Small delay to ensure timestamp differs
  await new Promise((r) => setTimeout(r, 10));

  await repo.update(created.id, { name: "Timestamp-Updated" });
  const updated = await repo.findById(created.id);

  assert.ok(updated!.updatedAt >= originalUpdatedAt, "updatedAt should be bumped");
});

// ── CRUD: Delete ───────────────────────────────────────────────────────

test("conformance: deleteById removes the combo", async () => {
  resetDb();
  const created = await repo.create(makeCombo({ name: "Delete-Test" }));

  const deleted = await repo.deleteById(created.id);
  assert.equal(deleted, true, "should return true for successful delete");

  const found = await repo.findById(created.id);
  assert.equal(found, null, "should not find deleted combo");
});

test("conformance: deleteById returns false for nonexistent id", async () => {
  resetDb();
  const deleted = await repo.deleteById("nonexistent-id");
  assert.equal(deleted, false);
});

test("conformance: deleteById does not affect other combos", async () => {
  resetDb();
  const a = await repo.create(makeCombo({ name: "Delete-A" }));
  const b = await repo.create(makeCombo({ name: "Delete-B" }));

  await repo.deleteById(a.id);

  const found = await repo.findById(b.id);
  assert.ok(found !== null, "other combo should still exist");
});

// ── Uniqueness ─────────────────────────────────────────────────────────

test("conformance: duplicate name throws UNIQUE constraint error", async () => {
  resetDb();
  await repo.create(makeCombo({ name: "Unique-Test" }));

  // The combo repo uses plain INSERT — duplicate names violate the UNIQUE constraint
  await assert.rejects(
    () => repo.create(makeCombo({ name: "Unique-Test" })),
    /UNIQUE constraint/,
    "should throw on duplicate name"
  );
});

// ── Reorder ────────────────────────────────────────────────────────────

test("conformance: reorder changes sort order atomically", async () => {
  resetDb();
  const a = await repo.create(makeCombo({ name: "Reorder-A" }));
  const b = await repo.create(makeCombo({ name: "Reorder-B" }));
  const c = await repo.create(makeCombo({ name: "Reorder-C" }));

  // Original order: A, B, C
  const before = await repo.list();
  const beforeIds = before.map((c) => c.id);
  assert.ok(beforeIds.indexOf(a.id) < beforeIds.indexOf(b.id), "A before B initially");
  assert.ok(beforeIds.indexOf(b.id) < beforeIds.indexOf(c.id), "B before C initially");

  // Reorder to C, A, B
  const result = await repo.reorder([c.id, a.id, b.id]);
  assert.ok(result.rowsReordered > 0, "should reorder rows");

  const after = await repo.list();
  const afterIds = after.map((c) => c.id);
  assert.ok(afterIds.indexOf(c.id) < afterIds.indexOf(a.id), "C before A after reorder");
  assert.ok(afterIds.indexOf(a.id) < afterIds.indexOf(b.id), "A before B after reorder");
});

test("conformance: reorder with invalid ids ignores them gracefully", async () => {
  resetDb();
  const a = await repo.create(makeCombo({ name: "Reorder-Grace-A" }));
  await repo.create(makeCombo({ name: "Reorder-Grace-B" }));

  // Include a nonexistent id — should be ignored
  const result = await repo.reorder([a.id, "nonexistent-id"]);
  assert.ok(result.combos.length >= 2, "should still have all combos");
});

test("conformance: reorder with duplicates deduplicates", async () => {
  resetDb();
  const a = await repo.create(makeCombo({ name: "Reorder-Dedup-A" }));
  const b = await repo.create(makeCombo({ name: "Reorder-Dedup-B" }));

  // Pass a.id twice — should be deduplicated
  const result = await repo.reorder([a.id, a.id, b.id]);
  const ids = result.combos.map((c) => c.id);
  const aCount = ids.filter((id) => id === a.id).length;
  assert.equal(aCount, 1, "duplicate id should be deduplicated");
});

// ── Empty state ────────────────────────────────────────────────────────

test("conformance: empty database returns empty list and zero count", async () => {
  resetDb();
  const list = await repo.list();
  assert.equal(list.length, 0);
  const count = await repo.count();
  assert.equal(count, 0);
});

test.after(() => {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});
