import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Setup ────────────────────────────────────────────────────────────────

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-10628-"));
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
const searchRoute = await import("../../src/app/api/v1/search/route.ts");

// ── Fake upstream via fetch mock ─────────────────────────────────────────
// The repo convention (search-route.test.ts) is to mock `globalThis.fetch`
// instead of running a real HTTP server — real loopback servers trip a libuv
// assertion on Windows (UV_HANDLE_CLOSING) during teardown.

const FAKE_RESULTS = [
  { title: "Open WebUI Docs", link: "https://docs.openwebui.com", snippet: "Official docs" },
  { title: "GitHub Repo", link: "https://github.com/open-webui/open-webui", snippet: "149k stars" },
];

const FAKE_PAYLOAD = JSON.stringify({
  organic: FAKE_RESULTS,
  searchParameters: { totalResults: 2 },
});

const originalFetch = globalThis.fetch;

function makeOrganicResults(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    title: `Result ${i + 1}`,
    link: `https://example.com/${i + 1}`,
    snippet: `Snippet ${i + 1}`,
  }));
}

function installFakeUpstream() {
  globalThis.fetch = (async (url: any, init: any = {}) => {
    // Serper sends the query in the POST JSON body (`q`). Route on it so edge
    // cases are deterministic (each query gets its own cache key), returning
    // Serper-shaped `organic` payloads.
    let q = "";
    try {
      q = String(JSON.parse(String(init?.body ?? "{}")).q ?? "");
    } catch {
      /* non-JSON body */
    }
    if (q.includes("empty")) {
      return new Response(JSON.stringify({ organic: [] }), { status: 200 });
    }
    if (q.includes("missing-url")) {
      return new Response(JSON.stringify({ organic: [{ title: "No URL", snippet: "No link" }] }), {
        status: 200,
      });
    }
    if (q.includes("null-url")) {
      return new Response(
        JSON.stringify({ organic: [{ title: "Null URL", link: null, snippet: "No link" }] }),
        { status: 200 }
      );
    }
    if (q.includes("ten-results")) {
      return new Response(JSON.stringify({ organic: makeOrganicResults(10) }), { status: 200 });
    }
    if (q.includes("three-results")) {
      return new Response(JSON.stringify({ organic: makeOrganicResults(3) }), { status: 200 });
    }
    return new Response(FAKE_PAYLOAD, { status: 200 });
  }) as typeof fetch;
}

test.before(async () => {
  installFakeUpstream();
  await providersDb.createProviderConnection({
    provider: "serper-search",
    authType: "apikey",
    name: "10628-openwebui-probe",
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

function makeSearchRequest(format?: string, query = "open webui test") {
  const url = new URL("http://localhost/v1/search");
  if (format) url.searchParams.set("format", format);
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      provider: "serper-search",
      max_results: 5,
      search_type: "web",
    }),
  });
}

/**
 * Build a request shaped exactly like Open WebUI's `search_external`
 * (backend/open_webui/retrieval/web/external.py): a POST with
 * `Authorization: Bearer <key>` and body `{ query, count }` — no provider,
 * no max_results. This is the real-world contract from the #10628 report.
 */
function makeOwuiSearchRequest(format: string | undefined, query: string, count: number) {
  const url = new URL("http://localhost/v1/search");
  if (format) url.searchParams.set("format", format);
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer probe-key",
    },
    body: JSON.stringify({ query, count }),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

test("POST /v1/search without format param returns standard wrapped response", async () => {
  const response = await searchRoute.POST(makeSearchRequest());
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  // Standard response has a wrapper with id, provider, results, etc.
  assert.equal(typeof body.id, "string", "should have an id field");
  assert.equal(typeof body.provider, "string", "should have a provider field");
  assert.ok(Array.isArray(body.results), "should have a results array");
  assert.equal(body.results.length, 2);
  // Standard format uses 'url' not 'link'
  assert.equal(body.results[0].url, "https://docs.openwebui.com");
  assert.equal(body.results[0].link, undefined, "standard format should NOT have 'link' field");
});

test("POST /v1/search?format=openwebui returns flat array with link field", async () => {
  const response = await searchRoute.POST(makeSearchRequest("openwebui"));
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  // Open WebUI format: flat array of { link, title, snippet }
  assert.ok(Array.isArray(body), "response should be a flat array");
  assert.equal(body.length, 2);

  // First result
  assert.equal(body[0].link, "https://docs.openwebui.com", "should use 'link' not 'url'");
  assert.equal(body[0].title, "Open WebUI Docs");
  assert.equal(body[0].snippet, "Official docs");

  // Second result
  assert.equal(body[1].link, "https://github.com/open-webui/open-webui");
  assert.equal(body[1].title, "GitHub Repo");
  assert.equal(body[1].snippet, "149k stars");

  // Should NOT have extra fields
  assert.equal(body[0].url, undefined, "should NOT have 'url' field");
  assert.equal(body[0].position, undefined, "should NOT have 'position' field");
  assert.equal(body[0].score, undefined, "should NOT have 'score' field");
  assert.equal(body[0].citation, undefined, "should NOT have 'citation' field");
});

test("POST /v1/search?format=other returns standard wrapped response", async () => {
  const response = await searchRoute.POST(makeSearchRequest("other"));
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  // Unknown format falls through to standard response
  assert.equal(typeof body.id, "string", "should have an id field (standard format)");
  assert.ok(Array.isArray(body.results), "should have results array (standard format)");
});

test("POST /v1/search?format=openwebui slices correctly like OWUI expects", async () => {
  const response = await searchRoute.POST(makeSearchRequest("openwebui"));
  const body = (await response.json()) as any;

  // This is the exact pattern Open WebUI uses in external.py:
  //   results = [SearchResult(...) for result in results[:count]]
  // If body is a dict (not array), results[:count] throws "unhashable type: 'slice'"
  assert.ok(Array.isArray(body), "must be an array for OWUI slicing");
  assert.doesNotThrow(() => {
    const _sliced = body.slice(0, 1);
  }, "body.slice(0, 1) must not throw");

  const sliced = body.slice(0, 1);
  assert.equal(sliced.length, 1);
  assert.equal(sliced[0].link, "https://docs.openwebui.com");
});

test("POST /v1/search?format=openwebui with empty results returns []", async () => {
  const response = await searchRoute.POST(makeSearchRequest("openwebui", "empty results probe"));
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body), "empty results must still be a flat array");
  assert.equal(body.length, 0);
});

test("POST /v1/search?format=openwebui drops results without a url", async () => {
  const response = await searchRoute.POST(
    makeSearchRequest("openwebui", "missing-url results probe")
  );
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 0, "results without a url must be filtered out");
});

test("POST /v1/search?format=openwebui drops results with a null url", async () => {
  const response = await searchRoute.POST(makeSearchRequest("openwebui", "null-url results probe"));
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 0, "results with a null url must be filtered out");
});

test("default format keeps url-less results (filter applies only to openwebui)", async () => {
  const response = await searchRoute.POST(
    makeSearchRequest(undefined, "missing-url results probe")
  );
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.equal(typeof body.id, "string");
  assert.ok(Array.isArray(body.results));
  assert.equal(body.results.length, 1, "default format must NOT filter url-less results");
  assert.equal(body.results[0].title, "No URL");
});

test("POST /v1/search?format=openwebui works on a cache hit", async () => {
  // First request populates the cache (default format, observed via `cached`).
  const first = await searchRoute.POST(makeSearchRequest(undefined, "cache probe query"));
  const firstBody = (await first.json()) as any;
  assert.equal(firstBody.cached, false, "first request should be a cache miss");

  // Same query with format=openwebui — served from cache but still flat.
  const second = await searchRoute.POST(makeSearchRequest("openwebui", "cache probe query"));
  const secondBody = (await second.json()) as any;
  assert.ok(Array.isArray(secondBody), "openwebui format must apply on a cache hit");
  assert.equal(secondBody.length, 2);
  assert.equal(secondBody[0].link, "https://docs.openwebui.com");
});

// ── Open WebUI real-world contract (#10628) ──────────────────────────────
// Mirrors backend/open_webui/retrieval/web/external.py:
//   requests.post(external_url, headers={Authorization: Bearer <key>},
//                 json={query, count})
//   results = [SearchResult(link=..., title=..., snippet=...)
//              for result in response.json()[:count]]

test("OWUI exact payload ({query, count} + Bearer, no provider) returns flat array honoring count", async () => {
  const response = await searchRoute.POST(
    makeOwuiSearchRequest("openwebui", "ten-results probe", 10)
  );
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body), "must be a flat array for OWUI's results[:count]");
  // count=10 must be honored — without the #10628 count alias this was capped at 5.
  assert.equal(body.length, 10, "count must map to max_results");
  assert.equal(body[0].link, "https://example.com/1");
  assert.equal(body[9].link, "https://example.com/10");
  assert.equal(body[0].url, undefined);
});

test("OWUI count alias works in the standard (wrapped) format too", async () => {
  const response = await searchRoute.POST(
    makeOwuiSearchRequest(undefined, "ten-results probe", 10)
  );
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.equal(typeof body.id, "string");
  assert.equal(body.results.length, 10, "count alias must apply without format=openwebui");
});

test("explicit max_results wins over OWUI count", async () => {
  const url = new URL("http://localhost/v1/search");
  url.searchParams.set("format", "openwebui");
  const response = await searchRoute.POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "ten-results probe",
        provider: "serper-search",
        max_results: 3,
        count: 10,
      }),
    })
  );
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 3, "native max_results must take precedence over count");
});

test("format param is case/whitespace insensitive", async () => {
  for (const raw of ["OPENWEBUI", " OpenWebUI ", "openwebui"]) {
    const response = await searchRoute.POST(makeSearchRequest(raw));
    const body = (await response.json()) as any;
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body), `format=${JSON.stringify(raw)} must be treated as openwebui`);
    assert.equal(body[0].link, "https://docs.openwebui.com");
  }
});
