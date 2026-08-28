import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

// Phase 1 RSC migration: the interactive shell (incl. the Learn more CTA)
// moved from page.tsx into ProvidersClient.tsx; page.tsx is now a thin server
// component. Both files together must keep the doc-link contract.
const providersPage = readFileSync(
  join(repoRoot, "src/app/(dashboard)/dashboard/providers/page.tsx"),
  "utf8"
);
const providersClient = readFileSync(
  join(repoRoot, "src/app/(dashboard)/dashboard/providers/ProvidersClient.tsx"),
  "utf8"
);

test("provider Learn more link uses the maintained documentation entry point", () => {
  assert.match(
    providersClient,
    /href="https:\/\/github\.com\/diegosouzapw\/OmniRoute#-documentation"/,
    "the provider help CTA should open the maintained GitHub documentation section"
  );
});

test("provider Learn more link does not use the retired documentation host", () => {
  assert.doesNotMatch(
    providersClient,
    /https:\/\/docs\.omniroute\.io\/providers/,
    "docs.omniroute.io/providers is no longer reachable"
  );
});

test("providers page is a server component that seeds the client shell with initialData", () => {
  assert.match(
    providersPage,
    /loadProviderPageData\(/,
    "the server page must fetch the page data server-side"
  );
  assert.match(
    providersPage,
    /initialData=/,
    "the server page must pass the fetched snapshot to the client shell"
  );
  assert.match(
    providersClient,
    /ProvidersClient\(\{ initialData \}: \{ initialData: ProviderPageData \}\)/,
    "the client shell must accept the server snapshot as initialData"
  );
});
