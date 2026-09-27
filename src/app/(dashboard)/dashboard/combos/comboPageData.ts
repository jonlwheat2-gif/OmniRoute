import { isEligibleActiveConnection } from "@/lib/combos/builderDraft";
import { normalizeComboConfigMode, type ComboConfigMode } from "@/shared/constants/comboConfigMode";

export type ComboRecord = any;

export interface ComboPageData {
  combos: ComboRecord[];
  activeProviders: any[];
  metrics: Record<string, any>;
  providerNodes: any[];
  comboConfigMode: ComboConfigMode;
  routingSettings: Record<string, unknown> | null;
  promptCompressionEnabled: boolean;
  proxyConfig: unknown;
}

export const EMPTY_COMBO_PAGE_DATA: ComboPageData = {
  combos: [],
  activeProviders: [],
  metrics: {},
  providerNodes: [],
  comboConfigMode: "guided",
  routingSettings: null,
  promptCompressionEnabled: false,
  proxyConfig: null,
};

async function readJson(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; body: unknown }> {
  try {
    const res = await fetchImpl(url, init);
    const body = await res.json().catch(() => null);
    return { ok: res.ok, body };
  } catch {
    return { ok: false, body: null };
  }
}

export async function loadComboPageData(
  fetchImpl: typeof fetch = globalThis.fetch as typeof fetch
): Promise<ComboPageData> {
  const [combosRes, providersRes, metricsRes, nodesRes, settingsRes, compressionRes, proxyRes] =
    await Promise.all([
      readJson(fetchImpl, "/api/combos"),
      readJson(fetchImpl, "/api/providers"),
      readJson(fetchImpl, "/api/combos/metrics"),
      readJson(fetchImpl, "/api/provider-nodes"),
      readJson(fetchImpl, "/api/settings"),
      readJson(fetchImpl, "/api/settings/compression"),
      readJson(fetchImpl, "/api/settings/proxy"),
    ]);

  const combosBody = combosRes.body as { combos?: ComboRecord[] } | null;
  const providersBody = providersRes.body as { connections?: unknown[] } | null;
  const metricsBody = metricsRes.body as { metrics?: Record<string, unknown> } | null;
  const nodesBody = nodesRes.body as { nodes?: unknown[] } | null;
  const settingsBody = settingsRes.ok ? (settingsRes.body as Record<string, unknown> | null) : null;
  const compressionBody = compressionRes.body as { enabled?: boolean } | null;

  return {
    combos: combosRes.ok ? (combosBody?.combos || []).filter((combo) => !combo.isHidden) : [],
    activeProviders: providersRes.ok
      ? (providersBody?.connections || []).filter((connection) =>
          isEligibleActiveConnection(
            connection as { isActive?: boolean | null; testStatus?: string | null }
          )
        )
      : [],
    metrics: metricsRes.ok ? metricsBody?.metrics || {} : {},
    providerNodes: nodesBody?.nodes || [],
    comboConfigMode: normalizeComboConfigMode(settingsBody?.comboConfigMode),
    routingSettings: settingsBody,
    promptCompressionEnabled: compressionBody?.enabled === true,
    proxyConfig: proxyRes.ok ? proxyRes.body : null,
  };
}
