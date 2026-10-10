// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryProvider } from "@/shared/components/QueryProvider";
import type { LiveModelsByProviderId } from "@/app/(dashboard)/dashboard/providers/providerPageUtils";

const cleanup: Array<() => void> = [];

async function renderHook(queryFn: () => Promise<LiveModelsByProviderId>) {
  const { useSyncedModelsByProvider } = await import("@/app/(dashboard)/dashboard/providers/hooks/useSyncedModelsByProvider");
  let latest: LiveModelsByProviderId | null = null;

  function Probe() {
    latest = useSyncedModelsByProvider({ queryFn });
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

describe("useSyncedModelsByProvider", () => {
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

  it("returns an empty map until the catalog arrives", async () => {
    let resolveFetch!: (value: LiveModelsByProviderId) => void;
    const pending = new Promise<LiveModelsByProviderId>((resolve) => {
      resolveFetch = resolve;
    });
    const hook = await renderHook(() => pending);

    expect(hook.get()).toEqual({});

    await act(async () => {
      resolveFetch({ openai: [{ id: "gpt-4o" }] });
    });
    await hook.waitUntil(() => (hook.get()?.openai?.length ?? 0) === 1);

    expect(hook.get()).toEqual({ openai: [{ id: "gpt-4o" }] });
  });

  it("fails soft to an empty map when the fetcher throws", async () => {
    const hook = await renderHook(async () => {
      throw new Error("catalog down");
    });
    await hook.waitUntil(() => hook.get() !== null);

    expect(hook.get()).toEqual({});
  });
});
