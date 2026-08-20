import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Setup ────────────────────────────────────────────────────────────────

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-10628-fetch-"));
process.env.DATA_DIR = dataDir;
process.env.REQUIRE_API_KEY = "false";
process.env.DASHBOARD_PASSWORD = "";
process.env.INITIAL_PASSWORD = "";
delete process.env.JWT_SECRET;
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.ALL_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.all_proxy;
process.env.NO_PROXY = "";
process.env.no_proxy = "";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const fetchRoute = await import("../../src/app/api/v1/web/fetch/route.ts");

// ── Fake upstream via fetch mock ─────────────────────────────────────────
// Repo convention (search-route.test.ts / 10628-openwebui-format.test.ts):
// mock `globalThis.fetch` instead of running a real HTTP server — real
// loopback servers trip a libuv assertion on Windows during teardown.
// Jina Reader is a plain GET https://r.jina.ai/<url> — easy to fake.

const originalFetch = globalThis.fetch;

function installFakeUpstream() {
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const urlStr = String(url);
    if (urlStr.startsWith("https://r.jina.ai/")) {
      const target = decodeURIComponent(urlStr.replace("https://r.jina.ai/", ""));
      if (target.includes("fail")) {
        return new Response("upstream boom", { status: 500 });
      }
      return new Response(
        JSON.stringify({
          data: {
            content: `Content of ${target}`,
            title: `Title of ${target}`,
            description: `Description of ${target}`,
            links: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

test.before(async () => {
  installFakeUpstream();
  await providersDb.createProviderConnection({
    provider: "jina-reader",
    authType: "apikey",
    name: "10628-fetch-probe",
    apiKey: "probe-key",
    isActive: true,
    testStatus: "active",
  });
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  core.resetDbInstance();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows may still hold SQLite handles briefly; the temp dir is
    // under the OS temp root and will be reclaimed.
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────

function makeFetchRequest(format: string | undefined, body: Record<string, unknown>) {
  const url = new URL("http://localhost/v1/web/fetch");
  if (format) url.searchParams.set("format", format);
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer probe-key" },
    body: JSON.stringify(body),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

test("native /v1/web/fetch (no format, single url) returns the wrapped object", async () => {
  const response = await fetchRoute.POST(
    makeFetchRequest(undefined, { url: "https://a.example.com/page" })
  );
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.equal(typeof body, "object");
  assert.ok(!Array.isArray(body), "native format must stay a wrapped object");
  assert.equal(body.url, "https://a.example.com/page");
  assert.equal(typeof body.content, "string");
  assert.equal(body.page_content, undefined, "native format must NOT have page_content");
});

test("OWUI exact payload ({urls} + Bearer, ?format=openwebui) returns flat [{page_content, metadata}]", async () => {
  const response = await fetchRoute.POST(
    makeFetchRequest("openwebui", {
      urls: ["https://a.example.com/1", "https://a.example.com/2"],
    })
  );
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body), "must be a flat array for ExternalWebLoader iteration");
  assert.equal(body.length, 2);
  assert.equal(body[0].page_content, "Content of https://a.example.com/1");
  assert.equal(body[0].metadata.source, "https://a.example.com/1");
  assert.equal(body[1].page_content, "Content of https://a.example.com/2");
  assert.equal(body[1].metadata.source, "https://a.example.com/2");
  assert.equal(body[0].url, undefined, "must NOT leak native url field");
  assert.equal(body[0].links, undefined, "must NOT leak native links field");
});

test("OWUI mode with a single `url` also returns the flat array", async () => {
  const response = await fetchRoute.POST(
    makeFetchRequest("openwebui", { url: "https://a.example.com/single" })
  );
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 1);
  assert.equal(body[0].page_content, "Content of https://a.example.com/single");
});

test("OWUI mode skips per-URL failures (continue_on_failure semantics)", async () => {
  const response = await fetchRoute.POST(
    makeFetchRequest("openwebui", {
      urls: ["https://a.example.com/ok", "https://a.example.com/fail", "https://a.example.com/ok2"],
    })
  );
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 2, "a failing url must be skipped, not fail the whole batch");
  assert.ok(body.every((r: any) => typeof r.page_content === "string" && r.metadata?.source));
});

test("format param is case/whitespace insensitive", async () => {
  for (const raw of ["OPENWEBUI", " OpenWebUI "]) {
    const response = await fetchRoute.POST(
      makeFetchRequest(raw, { urls: ["https://a.example.com/1"] })
    );
    const body = (await response.json()) as any;
    assert.ok(Array.isArray(body), `format=${JSON.stringify(raw)} must be treated as openwebui`);
    assert.equal(body.length, 1);
    assert.equal(body[0].page_content, "Content of https://a.example.com/1");
  }
});

test("urls without format returns the native per-URL objects as an array", async () => {
  const response = await fetchRoute.POST(
    makeFetchRequest(undefined, { urls: ["https://a.example.com/1"] })
  );
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 1);
  assert.equal(body[0].url, "https://a.example.com/1");
  assert.equal(typeof body[0].content, "string");
});

test("body with neither url nor urls is rejected", async () => {
  const response = await fetchRoute.POST(makeFetchRequest(undefined, { provider: "jina-reader" }));
  assert.equal(response.status, 400);
});
