import { withBasePath, getDeployBasePath } from "@/shared/utils/basePath";

/**
 * Server-side helpers for the providers dashboard (Phase 1 RSC migration).
 *
 * `page.tsx` is the server component that fetches `loadProviderPageData()`
 * for the first paint; these helpers make that fetch work in a Server
 * Component context:
 *
 * - Server Components do NOT forward cookies/headers to same-origin route
 *   handlers automatically, and relative URLs are invalid server-side.
 * - `buildServerFetch` resolves the request origin from the Host /
 *   x-forwarded-* headers and re-attaches the dashboard session cookie so the
 *   `/api/*` sources authenticate exactly like the browser fetch they replace.
 *
 * Kept in a plain module (no `next/headers`) so unit tests can exercise the
 * cookie-forwarding and absolute-URL behavior without a Next.js runtime.
 */

/** Build the absolute origin for server-side fetches from request headers. */
export function resolveRequestOrigin(headers: Headers): string {
  const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  const host =
    headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    headers.get("host") ||
    "localhost:20128";
  return `${proto}://${host}`;
}

/**
 * `loadProviderPageData` calls relative paths (`/api/providers`, …). On the
 * server those must be absolute (and, under a basePath deploy, prefixed), and
 * the session cookie must be re-attached so route handlers authenticate.
 *
 * Returns a `fetch`-compatible implementation that can be passed as the
 * `fetchImpl` argument to `loadProviderPageData`.
 */
export function buildServerFetch(
  origin: string,
  basePath: string,
  cookieHeader: string
): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const absoluteUrl = new URL(withBasePath(rawUrl, basePath, origin), origin).toString();
    const requestHeaders = new Headers(init?.headers);
    if (cookieHeader) requestHeaders.set("cookie", cookieHeader);
    return fetch(absoluteUrl, {
      ...init,
      // Dashboard data is request-scoped and cookie-authed — never let Next's
      // RSC fetch cache (force-cache by default) serve a stale snapshot.
      cache: "no-store",
      headers: requestHeaders,
    });
  };
}

/** Deploy basePath helper re-exported so callers share one source of truth. */
export { getDeployBasePath };
