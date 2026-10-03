// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryProvider } from "@/shared/components/QueryProvider";
import type { ProviderPageData } from "@/app/(dashboard)/dashboard/providers/providerPageUtils";

const PAGE_DATA: ProviderPageData = {
  connections: [{ id: "c1" }],
  providerNodes: [{ id: "n1" }],
  ccCompatibleProviderEnabled: true,
  expirations: { openai: "2030-01-01" },
  blockedProviders: ["openai"],
  settings: { blockedProviders: ["openai"] },
  openRouterProviderStats: [],
};

const cleanup: Array<() => void> = [];

async function renderHook(queryFn: () => Promise<ProviderPageData>) {
  const { useProviderPageData } = await import("@/app/(dashboard)/dashboard/providers/hooks/useProviderPageData");
  type HookResult = ReturnType<typeof useProviderPageData>;
  let latest: HookResult | null = null;

  function Probe() {
    latest = useProviderPageData({ queryFn });
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryProvider>
        <Probe />
      </QueryProvider>
    );
  });
  cleanup.push(() => {
    act(() => root.unmount());
    container.remove();
  });

  return {
    get: () => latest,
    waitUntil: async (predicate: () => boolean, timeoutMs = 1000) => {
      const start = Date.now();
      while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
          throw new Error("timed out waiting for hook state");
        }
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
    },
  };
}

describe("useProviderPageData", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    while (cleanup.length > 0) {
      cleanup.pop()?.();
    }
  });

  it("is loading until the fetcher resolves", async () => {
    let resolveFetch!: (value: ProviderPageData) => void;
    const pending = new Promise<ProviderPageData>((resolve) => {
      resolveFetch = resolve;
    });
    const hook = await renderHook(() => pending);

    expect(hook.get()!.loading).toBe(true);
    expect(hook.get()!.connections).toEqual([]);

    await act(async () => {
      resolveFetch(PAGE_DATA);
    });
    await hook.waitUntil(() => hook.get()!.loading === false);
    expect(hook.get()!.connections).toEqual([{ id: "c1" }]);
    expect(hook.get()!.ccCompatibleProviderEnabled).toBe(true);
    expect(hook.get()!.blockedProviders).toEqual(["openai"]);
  });

  it("surfaces a fetcher failure through error", async () => {
    const hook = await renderHook(async () => {
      throw new Error("providers unavailable");
    });
    await hook.waitUntil(() => hook.get()!.loading === false);

    expect(hook.get()!.loading).toBe(false);
    expect(hook.get()!.error).toBeInstanceOf(Error);
    expect(hook.get()!.error?.message).toBe("providers unavailable");
    expect(hook.get()!.connections).toEqual([]);
  });

  it("refetch reloads the page payload", async () => {
    let calls = 0;
    const hook = await renderHook(async () => {
      calls += 1;
      return {
        ...PAGE_DATA,
        connections: [{ id: `c${calls}` }],
      };
    });
    await hook.waitUntil(() => hook.get()!.connections[0]?.id === "c1");
    expect(hook.get()!.connections).toEqual([{ id: "c1" }]);

    await act(async () => {
      await hook.get()!.refetch();
    });
    await hook.waitUntil(() => hook.get()!.connections[0]?.id === "c2");

    expect(calls).toBe(2);
    expect(hook.get()!.connections).toEqual([{ id: "c2" }]);
  });
});
