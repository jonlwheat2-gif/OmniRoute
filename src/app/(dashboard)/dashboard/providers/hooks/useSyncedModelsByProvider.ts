"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import type { LiveModelsByProviderId } from "../providerPageUtils";

async function fetchSyncedModelsByProvider(): Promise<LiveModelsByProviderId> {
  const res = await fetch("/api/synced-available-models");
  if (!res.ok) return {};
  const data: unknown = await res.json();
  if (!data || typeof data !== "object") return {};
  return data as LiveModelsByProviderId;
}

export function useSyncedModelsByProvider(options?: {
  queryFn?: () => Promise<LiveModelsByProviderId>;
}): LiveModelsByProviderId {
  const query = useQuery({
    queryKey: queryKeys.providers.syncedModels(),
    queryFn: options?.queryFn ?? fetchSyncedModelsByProvider,
    retry: false,
  });

  return query.data ?? {};
}
