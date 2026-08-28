import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveRequestOrigin,
  buildServerFetch,
} from "@/app/(dashboard)/dashboard/providers/providerPageServer";

test("resolveRequestOrigin prefers x-forwarded-proto/host over the Host header", () => {
  const headers = new Headers({
    host: "localhost:20128",
    "x-forwarded-proto": "https",
    "x-forwarded-host": "proxy.example.com",
  });
  assert.equal(resolveRequestOrigin(headers), "https://proxy.example.com");
});

test("resolveRequestOrigin falls back to the Host header and http", () => {
  const headers = new Headers({ host: "10.0.0.5:9999" });
  assert.equal(resolveRequestOrigin(headers), "http://10.0.0.5:9999");
});

test("resolveRequestOrigin defaults to localhost:20128 when no host header", () => {
  assert.equal(resolveRequestOrigin(new Headers()), "http://localhost:20128");
});

test("buildServerFetch resolves relative URLs against the origin", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const serverFetch = buildServerFetch("http://localhost:20128", "", "");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const res = await serverFetch("/api/providers", { headers: { "x-test": "1" } });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://localhost:20128/api/providers");
    assert.equal(calls[0].init?.cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildServerFetch forwards the dashboard session cookie", async () => {
  let capturedCookie: string | null = null;
  const serverFetch = buildServerFetch("http://localhost:20128", "", "auth_token=abc.123");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedCookie = new Headers(init?.headers).get("cookie");
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await serverFetch("/api/settings");
    assert.equal(capturedCookie, "auth_token=abc.123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildServerFetch does not forward a cookie header when the session is empty", async () => {
  let capturedCookie: string | null = "unset";
  const serverFetch = buildServerFetch("http://localhost:20128", "", "");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedCookie = new Headers(init?.headers).get("cookie");
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await serverFetch("/api/providers");
    assert.equal(capturedCookie, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildServerFetch applies the deploy basePath to relative URLs", async () => {
  const calls: Array<{ url: string }> = [];
  const serverFetch = buildServerFetch("http://localhost:20128", "/omniroute", "");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    calls.push({ url: String(input) });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await serverFetch("/api/providers");
    assert.equal(calls[0].url, "http://localhost:20128/omniroute/api/providers");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
