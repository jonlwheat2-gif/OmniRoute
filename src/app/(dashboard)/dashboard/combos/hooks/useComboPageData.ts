"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import {
  EMPTY_COMBO_PAGE_DATA,
  loadComboPageData,
  type ComboPageData,
  type ComboRecord,
} from "../comboPageData";

type CombosUpdater = ComboRecord[] | ((prev: ComboRecord[]) => ComboRecord[]);

export function useComboPageData(options?: { queryFn?: () => Promise<ComboPageData> }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.combos.page(),
    queryFn: options?.queryFn ?? (() => loadComboPageData()),
    retry: false,
  });

  const data: ComboPageData = query.data ?? EMPTY_COMBO_PAGE_DATA;

  const setCombos = (updater: CombosUpdater) => {
    queryClient.setQueryData<ComboPageData>(queryKeys.combos.page(), (prev) => {
      const base = prev ?? EMPTY_COMBO_PAGE_DATA;
      const combos = typeof updater === "function" ? updater(base.combos) : updater;
      return { ...base, combos };
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
    combos: data.combos,
    activeProviders: data.activeProviders,
    metrics: data.metrics,
    providerNodes: data.providerNodes,
    comboConfigMode: data.comboConfigMode,
    routingSettings: data.routingSettings,
    promptCompressionEnabled: data.promptCompressionEnabled,
    proxyConfig: data.proxyConfig,
    refetch: query.refetch,
    setCombos,
  };
}
