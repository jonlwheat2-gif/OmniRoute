// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryProvider } from "@/shared/components/QueryProvider";
import {
  EMPTY_COMBO_PAGE_DATA,
  type ComboPageData,
} from "@/app/(dashboard)/dashboard/combos/comboPageData";

const PAGE_DATA: ComboPageData = {
  ...EMPTY_COMBO_PAGE_DATA,
  combos: [{ id: "c1", name: "Primary" }],
  activeProviders: [{ id: "p1" }],
  metrics: { c1: { hits: 3 } },
  providerNodes: [{ id: "n1" }],
  comboConfigMode: "expert",
  promptCompressionEnabled: true,
};

const cleanup: Array<() => void> = [];

async function renderHook(queryFn: () => Promise<ComboPageData>) {
  const { useComboPageData } =
    await import("@/app/(dashboard)/dashboard/combos/hooks/useComboPageData");
  type HookResult = ReturnType<typeof useComboPageData>;
  let latest: HookResult | null = null;

  function Probe() {
    latest = useComboPageData({ queryFn });
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

describe("useComboPageData", () => {
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
    let resolveFetch!: (value: ComboPageData) => void;
    const pending = new Promise<ComboPageData>((resolve) => {
      resolveFetch = resolve;
    });
    const hook = await renderHook(() => pending);

    expect(hook.get()!.loading).toBe(true);
    expect(hook.get()!.combos).toEqual([]);

    await act(async () => {
      resolveFetch(PAGE_DATA);
    });
    await hook.waitUntil(() => hook.get()!.loading === false);

    expect(hook.get()!.combos).toEqual([{ id: "c1", name: "Primary" }]);
    expect(hook.get()!.comboConfigMode).toBe("expert");
    expect(hook.get()!.promptCompressionEnabled).toBe(true);
  });

  it("surfaces a fetcher failure through error", async () => {
    const hook = await renderHook(async () => {
      throw new Error("combos unavailable");
    });
    await hook.waitUntil(() => hook.get()!.loading === false);

    expect(hook.get()!.error?.message).toBe("combos unavailable");
    expect(hook.get()!.combos).toEqual([]);
  });

  it("refetch reloads the page payload", async () => {
    let calls = 0;
    const hook = await renderHook(async () => {
      calls += 1;
      return {
        ...PAGE_DATA,
        combos: [{ id: `c${calls}`, name: `Combo ${calls}` }],
      };
    });
    await hook.waitUntil(() => hook.get()!.combos[0]?.id === "c1");

    await act(async () => {
      await hook.get()!.refetch();
    });
    await hook.waitUntil(() => hook.get()!.combos[0]?.id === "c2");

    expect(calls).toBe(2);
  });
});
