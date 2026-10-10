export const queryKeys = {
  providers: {
    page: () => ["providers", "page"] as const,
    connections: (id: string) => ["providers", "connections", id] as const,
    syncedModels: () => ["providers", "synced-models"] as const,
  },
  combos: { list: () => ["combos"] as const },
  batch: { files: () => ["batch", "files"] as const },
  memory: {
    engine: () => ["memory", "engine"] as const,
    settings: () => ["memory", "settings"] as const,
  },
};
