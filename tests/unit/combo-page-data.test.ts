import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadComboPageData } from "@/app/(dashboard)/dashboard/combos/comboPageData";

function jsonFetch(map: Record<string, { status?: number; body: unknown }>): typeof fetch {
  return ((url: string | URL) => {
    const entry = map[String(url)] ?? { body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(entry.body), {
        status: entry.status ?? 200,
        headers: { "content-type": "application/json" },
      })
    );
  }) as unknown as typeof fetch;
}

describe("loadComboPageData", () => {
  test("returns visible combos and eligible active connections", async () => {
    const data = await loadComboPageData(
      jsonFetch({
        "/api/combos": {
          body: {
            combos: [
              { id: "keep", name: "Keep" },
              { id: "hidden", name: "Hidden", isHidden: true },
            ],
          },
        },
        "/api/providers": {
          body: {
            connections: [
              { id: "healthy", isActive: true, testStatus: "active" },
              { id: "disabled", isActive: false, testStatus: "active" },
            ],
          },
        },
        "/api/combos/metrics": { body: { metrics: { keep: { hits: 2 } } } },
        "/api/provider-nodes": { body: { nodes: [{ id: "n1" }] } },
        "/api/settings": { body: { comboConfigMode: "expert" } },
        "/api/settings/compression": { body: { enabled: true } },
        "/api/settings/proxy": { body: { global: "http://proxy" } },
      })
    );

    assert.deepEqual(
      data.combos.map((combo) => combo.id),
      ["keep"]
    );
    assert.deepEqual(
      (data.activeProviders as Array<{ id: string }>).map((connection) => connection.id),
      ["healthy"]
    );
    assert.deepEqual(data.metrics, { keep: { hits: 2 } });
    assert.deepEqual(data.providerNodes, [{ id: "n1" }]);
    assert.equal(data.comboConfigMode, "expert");
    assert.equal(data.promptCompressionEnabled, true);
    assert.deepEqual(data.proxyConfig, { global: "http://proxy" });
  });

  test("degrades to defaults when endpoints fail", async () => {
    const rejectFetch = (() =>
      Promise.reject(new Error("network down"))) as unknown as typeof fetch;
    const data = await loadComboPageData(rejectFetch);
    assert.deepEqual(data.combos, []);
    assert.deepEqual(data.activeProviders, []);
    assert.equal(data.comboConfigMode, "guided");
    assert.equal(data.promptCompressionEnabled, false);
    assert.equal(data.proxyConfig, null);
  });
});
