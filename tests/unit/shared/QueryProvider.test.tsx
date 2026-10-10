// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useQueryClient } from "@tanstack/react-query";
import { QueryProvider } from "@/shared/components/QueryProvider";

const cleanup: Array<() => void> = [];

function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  cleanup.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

describe("QueryProvider", () => {
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

  it("renders children", () => {
    const container = render(
      <QueryProvider>
        <span data-testid="child">ready</span>
      </QueryProvider>
    );

    expect(container.querySelector('[data-testid="child"]')?.textContent).toBe("ready");
  });

  it("exposes one QueryClient to descendants across Strict Mode remount", () => {
    const seen: unknown[] = [];

    function Probe() {
      seen.push(useQueryClient());
      return null;
    }

    render(
      <React.StrictMode>
        <QueryProvider>
          <Probe />
        </QueryProvider>
      </React.StrictMode>
    );

    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen).size).toBe(1);
  });
});
