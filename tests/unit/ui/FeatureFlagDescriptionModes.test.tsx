// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression guard for the feature-flag description display modes (#12739 / #12740).
//
// Before the fix every card description was hard-clamped to two lines
// (`line-clamp-2`) with no way to read the rest, so 23 of the 54 shipped cards
// silently lost text. The fix adds a per-page "On hover / Full text" control whose
// choice persists in localStorage.
//
// Two contracts must never regress, and are what this file pins down:
//
//   1. Both display modes actually render. "clamp" keeps the two-line clamp but
//      exposes the complete description through a tooltip wired via
//      `aria-describedby`; "full" drops the clamp and renders no tooltip.
//
//   2. Reading localStorage must NOT happen while rendering. The persisted mode is
//      applied from an effect, after hydration — reading it in the `useState`
//      initializer would make the first client render disagree with the SSR HTML
//      (a hydration mismatch) and leave the active pill stale. The server-render
//      test below pins that contract: the server-rendered pill is "On hover" even
//      when localStorage already holds "full".
//
// next-intl is deliberately NOT mocked locally. The global setup mock in
// tests/_setup/vitestUiPolyfills.ts renders the REAL en.json copy, so asserting on
// the pill labels doubles as a guard that the four new `featureFlags` keys resolve
// instead of silently falling back to their key names.
//
// Credit: the card-render harness and the long-description fixture below were
// carried over from @retroamx's #13189 (tests/unit/ui/FeatureFlagCard.test.tsx),
// which attacked the same #12739 truncation with a native `title` tooltip. What is
// asserted here is different — the aria-describedby tooltip wiring, the
// localStorage round-trip, and the SSR/hydration contract — none of which #13189
// covered.

import FeatureFlagCard from "@/app/(dashboard)/dashboard/settings/components/FeatureFlagCard";
import FeatureFlagsGrid from "@/app/(dashboard)/dashboard/settings/components/FeatureFlagsGrid";

const STORAGE_KEY = "ff-card-description-mode";

const LONG_DESCRIPTION =
  "A very long description that would normally overflow past two lines of text in the card and get visually cut off.";

const HOVER_LABEL = "On hover";
const FULL_LABEL = "Full text";

type Flag = React.ComponentProps<typeof FeatureFlagCard>["flag"];

function makeFlag(overrides: Partial<Flag> = {}): Flag {
  return {
    key: "SOME_FLAG",
    label: "Some Flag",
    description: LONG_DESCRIPTION,
    category: "runtime",
    type: "boolean",
    enumValues: null,
    effectiveValue: "false",
    source: "default",
    requiresRestart: false,
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const mounted: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = [];

function render(node: React.ReactElement): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  mounted.push({ root, el });
  act(() => {
    root.render(node);
  });
  return el;
}

// The grid schedules its initial load through `setTimeout(..., 0)` and then awaits
// fetch, so effects alone are not enough to settle it — yield two macrotasks.
async function settle(): Promise<void> {
  for (let i = 0; i < 2; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function radiosOf(scope: ParentNode): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
}

/** Text of the pill currently marked active, or "" when none is. */
function activeLabel(scope: ParentNode): string {
  const checked = radiosOf(scope).find((r) => r.getAttribute("aria-checked") === "true");
  return checked?.textContent ?? "";
}

function stubFlagsApi(flags: Flag[] = [makeFlag()]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        flags,
        summary: {
          total: flags.length,
          active: 0,
          inactive: flags.length,
          overriddenByDb: 0,
          overriddenByEnv: 0,
        },
      }),
    }))
  );
}

/** Parse a server-rendered HTML string into a queryable, detached DOM tree. */
function parseSsr(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

function descriptionParagraph(scope: ParentNode): HTMLParagraphElement | null {
  return scope.querySelector<HTMLParagraphElement>("p.line-clamp-2, p.text-pretty");
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  stubFlagsApi();
});

afterEach(() => {
  for (const { root, el } of mounted.splice(0)) {
    act(() => root.unmount());
    el.remove();
  }
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Display mode 1: clamped + hover tooltip ───────────────────────────────────

describe("FeatureFlagCard — 'clamp' mode (default)", () => {
  it("keeps the two-line clamp on the visible description", () => {
    const el = render(
      <FeatureFlagCard flag={makeFlag()} onToggle={() => {}} onReset={() => {}} saving={false} />
    );

    const description = descriptionParagraph(el);
    expect(description).not.toBeNull();
    expect(description!.className).toContain("line-clamp-2");
    expect(description!.textContent).toBe(LONG_DESCRIPTION);
  });

  it("reveals the full description through a tooltip linked by aria-describedby", () => {
    const flag = makeFlag();
    const el = render(
      <FeatureFlagCard flag={flag} onToggle={() => {}} onReset={() => {}} saving={false} />
    );

    const description = el.querySelector<HTMLParagraphElement>("p.line-clamp-2")!;
    const tooltip = el.querySelector<HTMLElement>('[role="tooltip"]');

    expect(tooltip).not.toBeNull();
    // The clamped text is only discoverable if the paragraph points at the tooltip.
    expect(description.getAttribute("aria-describedby")).toBe(tooltip!.id);
    // And the tooltip must carry the whole text, not a re-truncated copy.
    expect(tooltip!.textContent).toBe(LONG_DESCRIPTION);
  });

  it("scopes the tooltip id to the flag key so sibling cards do not collide", () => {
    const el = render(
      <div>
        <FeatureFlagCard
          flag={makeFlag({ key: "FLAG_ONE" })}
          onToggle={() => {}}
          onReset={() => {}}
        />
        <FeatureFlagCard
          flag={makeFlag({ key: "FLAG_TWO" })}
          onToggle={() => {}}
          onReset={() => {}}
        />
      </div>
    );

    const tooltips = Array.from(el.querySelectorAll<HTMLElement>('[role="tooltip"]'));
    expect(tooltips.map((n) => n.id)).toEqual(["desc-tooltip-FLAG_ONE", "desc-tooltip-FLAG_TWO"]);
    expect(new Set(tooltips.map((n) => n.id)).size).toBe(2);
  });
});

// ── Display mode 2: always full text ─────────────────────────────────────────

describe("FeatureFlagCard — 'full' mode", () => {
  it("drops the line clamp and renders the whole description", () => {
    const el = render(
      <FeatureFlagCard
        flag={makeFlag()}
        onToggle={() => {}}
        onReset={() => {}}
        descriptionMode="full"
      />
    );

    const description = descriptionParagraph(el);
    expect(description).not.toBeNull();
    expect(description!.className).not.toContain("line-clamp-2");
    expect(description!.textContent).toBe(LONG_DESCRIPTION);
  });

  it("renders no tooltip, since nothing is hidden", () => {
    const el = render(
      <FeatureFlagCard
        flag={makeFlag()}
        onToggle={() => {}}
        onReset={() => {}}
        descriptionMode="full"
      />
    );

    expect(el.querySelector('[role="tooltip"]')).toBeNull();
    expect(el.querySelector("p[aria-describedby]")).toBeNull();
  });
});

// ── Grid control: default, persistence, hydration safety ─────────────────────

describe("FeatureFlagsGrid — description mode control", () => {
  it("defaults to 'On hover' and persists the choice when 'Full text' is picked", async () => {
    const el = render(<FeatureFlagsGrid />);
    await settle();

    expect(radiosOf(el).map((r) => r.textContent)).toEqual([HOVER_LABEL, FULL_LABEL]);
    expect(activeLabel(el)).toBe(HOVER_LABEL);

    const fullPill = radiosOf(el)[1];
    await act(async () => {
      fullPill.click();
    });

    expect(activeLabel(el)).toBe(FULL_LABEL);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("full");

    // Switching back must persist too, not just flip in-memory state.
    await act(async () => {
      radiosOf(el)[0].click();
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("clamp");
  });

  it("adopts the persisted 'full' mode once mounted", async () => {
    window.localStorage.setItem(STORAGE_KEY, "full");

    const el = render(<FeatureFlagsGrid />);
    await settle();

    expect(activeLabel(el)).toBe(FULL_LABEL);
  });

  it("server-renders 'On hover' as active even when localStorage already holds 'full'", () => {
    // This is the hydration contract. renderToString runs no effects, so the
    // persisted mode cannot leak into the SSR markup. Reading localStorage in the
    // useState initializer instead would flip this assertion to "Full text" and
    // reintroduce the mismatch the fix was written to avoid.
    window.localStorage.setItem(STORAGE_KEY, "full");

    const html = renderToString(React.createElement(FeatureFlagsGrid));
    const ssr = parseSsr(html);

    expect(radiosOf(ssr).map((r) => r.textContent)).toEqual([HOVER_LABEL, FULL_LABEL]);
    expect(activeLabel(ssr)).toBe(HOVER_LABEL);
  });

  it("survives a localStorage that throws (private mode / disabled storage)", async () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });

    const el = render(<FeatureFlagsGrid />);
    await settle();

    // The control still renders and is operable — persistence is best-effort.
    expect(activeLabel(el)).toBe(HOVER_LABEL);
    await act(async () => {
      radiosOf(el)[1].click();
    });
    expect(activeLabel(el)).toBe(FULL_LABEL);

    getItem.mockRestore();
    setItem.mockRestore();
  });
});

// ── Wiring: the grid's choice reaches the cards ──────────────────────────────

describe("FeatureFlagsGrid — mode propagates to the rendered cards", () => {
  it("re-renders the cards from clamped to full when the mode changes", async () => {
    const el = render(<FeatureFlagsGrid />);
    await settle();

    const clamped = descriptionParagraph(el);
    expect(clamped).not.toBeNull();
    expect(clamped!.className).toContain("line-clamp-2");
    expect(el.querySelector('[role="tooltip"]')).not.toBeNull();

    await act(async () => {
      radiosOf(el)[1].click();
    });

    const expanded = descriptionParagraph(el);
    expect(expanded).not.toBeNull();
    expect(expanded!.className).not.toContain("line-clamp-2");
    expect(expanded!.textContent).toBe(LONG_DESCRIPTION);
    expect(el.querySelector('[role="tooltip"]')).toBeNull();
  });
});
