// #16208 — GET /v1beta/models bypasses requireAuthForModels (unauthenticated catalog)
//
// Regression guard: the Gemini-format catalog must apply the SAME model-catalog
// auth gate as its sibling /v1/models.
//
// Before the fix, the handler was `export async function GET()` — no `request`
// argument — so it could not inspect credentials and made no
// `requireAuthForModels` check. Any anonymous caller that could reach the
// server received the full provider/model inventory even when the operator had
// enabled "require auth for models". The authz pipeline does not cover this:
// /v1beta/* classifies as CLIENT_API, and clientApiPolicy allows anonymous
// traffic whenever REQUIRE_API_KEY is off (the default).
//
// Seam: the public route handler — the same seam
// tests/unit/v1-models-auth-leak-9320.test.ts uses for /v1/models.
// Observable behavior only (status + body); no internal collaborators mocked.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-16208-v1beta-auth-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "test-secret-16208";

const core = await import("../../src/lib/db/core.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const settingsModule = await import("../../src/lib/db/settings.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const v1betaModelsRoute = await import("../../src/app/api/v1beta/models/route.ts");

async function addActiveConnection(provider: string) {
  await providersDb.createProviderConnection({
    provider,
    authType: "apikey",
    apiKey: `test-key-${provider}`,
    testStatus: "active",
  });
}

async function resetStorage() {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

async function enableModelCatalogAuth() {
  await settingsModule.updateSettings({
    password: "test-password-16208",
    requireLogin: true,
    requireAuthForModels: true,
  });
}

async function createApiKeyRawValue(name: string): Promise<string> {
  await apiKeysDb.createApiKey(name, "test-machine-16208");
  const keys = await apiKeysDb.getApiKeys();
  type ApiKeyRecord = Awaited<ReturnType<typeof apiKeysDb.getApiKeys>>[number];
  const created = Array.isArray(keys) ? keys.find((k: ApiKeyRecord) => k.name === name) : undefined;
  assert.ok(created, `API key "${name}" must have been created`);
  return created.key;
}

test.beforeEach(async () => {
  await resetStorage();
  // At least one active provider connection, so a 200 would carry a real catalog
  // and the anonymous assertion cannot pass by accident on an empty listing.
  await addActiveConnection("openai");
});

test.after(async () => {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("#16208 FIXED: anonymous GET /v1beta/models returns 401 when requireAuthForModels is on", async () => {
  await enableModelCatalogAuth();

  const res = await v1betaModelsRoute.GET(new Request("http://test.example.com/v1beta/models"));

  assert.equal(res.status, 401, `expected 401 for anonymous request, got ${res.status}`);
  const body = (await res.json()) as { error?: { message?: string }; models?: unknown };
  assert.ok(body.error, "401 response must carry an error object");
  assert.equal(body.models, undefined, "no model catalog may be disclosed to an anonymous caller");
});

test("#16208: valid API key returns 200 with the Gemini-format catalog", async () => {
  await enableModelCatalogAuth();
  const apiKey = await createApiKeyRawValue("test-key-16208-bearer");

  const res = await v1betaModelsRoute.GET(
    new Request("http://test.example.com/v1beta/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  );

  assert.equal(res.status, 200);
  const body = (await res.json()) as { models?: Array<{ name?: string }> };
  assert.ok(Array.isArray(body.models), "authenticated callers still receive the catalog");
  assert.ok(body.models.length > 0, "catalog must not be empty for an active connection");
});

test("#16208: x-goog-api-key authenticates the Gemini-native credential (#7034)", async () => {
  await enableModelCatalogAuth();
  const apiKey = await createApiKeyRawValue("test-key-16208-goog");

  const res = await v1betaModelsRoute.GET(
    new Request("http://test.example.com/v1beta/models", {
      headers: { "x-goog-api-key": apiKey },
    })
  );

  assert.equal(res.status, 200, "x-goog-api-key must satisfy the catalog gate");
  const body = (await res.json()) as { models?: unknown[] };
  assert.ok(Array.isArray(body.models));
});

test("#16208: invalid API key returns 401 rather than the catalog", async () => {
  await enableModelCatalogAuth();

  const res = await v1betaModelsRoute.GET(
    new Request("http://test.example.com/v1beta/models", {
      headers: { Authorization: "Bearer sk-not-a-real-key-16208" },
    })
  );

  assert.equal(res.status, 401);
  const body = (await res.json()) as { error?: { message?: string } };
  assert.ok(body.error, "invalid-key response must carry an error object");
});

test("#16208: requireAuthForModels=false leaves /v1beta/models open to anonymous callers", async () => {
  // Explicit opt-out must keep working — the gate is not unconditional.
  await settingsModule.updateSettings({
    password: "test-password-16208",
    requireLogin: true,
    requireAuthForModels: false,
  });

  const res = await v1betaModelsRoute.GET(new Request("http://test.example.com/v1beta/models"));

  assert.equal(res.status, 200, "requireAuthForModels=false must not gate the Gemini catalog");
});

test("#16208: no-arg in-process invocation stays a trusted local caller", async () => {
  // The route is invoked with no Request by the provider-journey Gemini contract
  // suite (STEP 6/7) and by unit tests. Next.js always supplies a real Request on
  // the HTTP path, so an absent one can only be a direct in-process call.
  await enableModelCatalogAuth();

  const res = await v1betaModelsRoute.GET();

  assert.equal(res.status, 200, "trusted in-process invocation must not be gated");
});
