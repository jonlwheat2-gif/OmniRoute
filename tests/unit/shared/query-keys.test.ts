import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { queryKeys } from "@/shared/query/keys";

describe("queryKeys", () => {
  it("names the providers page cache entry", () => {
    assert.deepEqual(queryKeys.providers.page(), ["providers", "page"]);
  });

  it("scopes provider connections by id", () => {
    assert.deepEqual(queryKeys.providers.connections("openai"), [
      "providers",
      "connections",
      "openai",
    ]);
  });

  it("names the synced models catalog", () => {
    assert.deepEqual(queryKeys.providers.syncedModels(), ["providers", "synced-models"]);
  });

  it("keeps sibling surfaces on distinct keys", () => {
    assert.deepEqual(queryKeys.combos.list(), ["combos"]);
    assert.deepEqual(queryKeys.batch.files(), ["batch", "files"]);
    assert.deepEqual(queryKeys.memory.engine(), ["memory", "engine"]);
    assert.deepEqual(queryKeys.memory.settings(), ["memory", "settings"]);
  });
});
