"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import { loadProviderPageData, type ProviderPageData } from "../providerPageUtils";

const EMPTY_PAGE_DATA: ProviderPageData = {
  connections: [],
  providerNodes: [],
  ccCompatibleProviderEnabled: false,
  expirations: null,
  blockedProviders: null,
  settings: null,
  openRouterProviderStats: [],
};

type ConnectionsUpdater =
  | ProviderPageData["connections"]
  | ((prev: ProviderPageData["connections"]) => ProviderPageData["connections"]);

type ProviderNodesUpdater =
  | ProviderPageData["providerNodes"]
  | ((prev: ProviderPageData["providerNodes"]) => ProviderPageData["providerNodes"]);

type BlockedProvidersUpdater = string[] | ((prev: string[]) => string[]);

export function useProviderPageData(options?: { queryFn?: () => Promise<ProviderPageData> }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.providers.page(),
    queryFn: options?.queryFn ?? (() => loadProviderPageData()),
    retry: false,
  });

  const data: ProviderPageData = query.data ?? EMPTY_PAGE_DATA;

  const setConnections = (updater: ConnectionsUpdater) => {
    queryClient.setQueryData<ProviderPageData>(queryKeys.providers.page(), (prev) => {
      const base = prev ?? EMPTY_PAGE_DATA;
      const connections = typeof updater === "function" ? updater(base.connections) : updater;
      return { ...base, connections };
    });
  };

  const setProviderNodes = (updater: ProviderNodesUpdater) => {
    queryClient.setQueryData<ProviderPageData>(queryKeys.providers.page(), (prev) => {
      const base = prev ?? EMPTY_PAGE_DATA;
      const providerNodes = typeof updater === "function" ? updater(base.providerNodes) : updater;
      return { ...base, providerNodes };
    });
  };

  const setBlockedProviders = (updater: BlockedProvidersUpdater) => {
    queryClient.setQueryData<ProviderPageData>(queryKeys.providers.page(), (prev) => {
      const base = prev ?? EMPTY_PAGE_DATA;
      const current = base.blockedProviders ?? [];
      const blockedProviders = typeof updater === "function" ? updater(current) : updater;
      return { ...base, blockedProviders };
    });
  };

  return {
    loading: query.isPending,
    error:
      query.error instanceof Error
        ? query.error
        : query.error
          ? new Error(String(query.error))
          : null,
    connections: data.connections,
    providerNodes: data.providerNodes,
    ccCompatibleProviderEnabled: data.ccCompatibleProviderEnabled,
    expirations: data.expirations,
    blockedProviders: data.blockedProviders ?? [],
    settings: data.settings,
    openRouterProviderStats: data.openRouterProviderStats,
    refetch: query.refetch,
    setConnections,
    setProviderNodes,
    setBlockedProviders,
  };
}
