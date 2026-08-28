"use client";

/**
 * TanStack Query provider for the dashboard.
 *
 * Wraps the dashboard tree in a single `QueryClientProvider` so page clients
 * can deduplicate fetches, cache server-passed `initialData`, and revalidate
 * with `useQuery` instead of ad-hoc `useEffect` + `fetch` waterfalls
 * (Phase 1 RSC migration — vercel `client-swr-dedup`).
 *
 * A single QueryClient is created per mount (useState initializer) so HMR and
 * tests get a fresh cache, while the dashboard session keeps one instance.
 * Defaults are tuned for a management dashboard: data stays fresh for 30s,
 * no refetch on window focus (the dashboard already has live-refresh
 * surfaces), single retry.
 */

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const DASHBOARD_QUERY_DEFAULTS = {
  queries: {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  },
} as const;

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: DASHBOARD_QUERY_DEFAULTS }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
