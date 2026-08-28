import { cookies, headers } from "next/headers";
import { loadProviderPageData } from "./providerPageUtils";
import { resolveRequestOrigin, buildServerFetch, getDeployBasePath } from "./providerPageServer";
import ProvidersClient from "./ProvidersClient";

export const dynamic = "force-dynamic";

/**
 * Server component (Phase 1 RSC migration).
 *
 * Renders the first paint of the providers dashboard: fetches
 * `loadProviderPageData()` on the server — time-bounded, each source degrading
 * to a default (see providerPageUtils) — and passes the snapshot to the client
 * shell as `initialData`. The client seeds its state from that snapshot, so
 * there is no client-side waterfall or skeleton flash.
 *
 * Cookie forwarding: Server Components do NOT forward cookies/headers to
 * same-origin route handlers automatically, and relative URLs are invalid
 * server-side. `buildServerFetch` resolves the request origin from the Host /
 * x-forwarded-* headers and re-attaches the dashboard session cookie so the
 * `/api/*` sources authenticate exactly like the browser fetch they replace.
 */
export default async function ProvidersPage() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieHeader = cookieStore.toString();
  const origin = resolveRequestOrigin(headerStore);
  const basePath = getDeployBasePath();

  const initialData = await loadProviderPageData(buildServerFetch(origin, basePath, cookieHeader));

  return <ProvidersClient initialData={initialData} />;
}
