/**
 * Schema Registry — table-level metadata for SQL dialect translation.
 *
 * Used by the SqlDialect compiler to translate SQLite-specific constructs
 * (e.g. `INSERT OR REPLACE`) into dialect-correct equivalents
 * (`ON CONFLICT ... DO UPDATE` for PostgreSQL, `ON DUPLICATE KEY UPDATE` for MySQL).
 *
 * Primary key columns are extracted from the initial schema (core.ts SCHEMA_SQL)
 * and subsequent migration files. Each entry maps a table name to its PK column(s).
 */

export interface TableInfo {
  primaryKey: string[];
  columns: string[];
}

// ── Tables that use INSERT OR REPLACE in domain modules ──
// Extracted from core.ts SCHEMA_SQL and migrações.
// Only tables that actually need upsert translation are listed here;
// the compiler falls back to a generic ON CONFLICT (all non-null columns)
// if a table is not registered.

const TABLE_REGISTRY: Record<string, TableInfo> = {
  key_value: {
    primaryKey: ["namespace", "key"],
    columns: ["namespace", "key", "value"],
  },
  provider_connections: {
    primaryKey: ["id"],
    columns: ["id", "provider", "auth_type", "name", "email", "priority", "is_active"],
  },
  provider_nodes: {
    primaryKey: ["id"],
    columns: ["id", "type", "name", "prefix"],
  },
  combos: {
    primaryKey: ["id"],
    columns: ["id", "name", "data", "sort_order", "created_at", "updated_at"],
  },
  api_keys: {
    primaryKey: ["id"],
    columns: ["id", "name", "key", "machine_id", "allowed_models", "no_log", "created_at"],
  },
  db_meta: {
    primaryKey: ["key"],
    columns: ["key", "value"],
  },
  usage_history: {
    primaryKey: ["id"],
    columns: ["id", "provider", "model", "connection_id"],
  },
  call_logs: {
    primaryKey: ["id"],
    columns: ["id", "timestamp", "method", "path"],
  },
  proxy_logs: {
    primaryKey: ["id"],
    columns: ["id", "timestamp"],
  },
  settings: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  provider_limits_cache: {
    primaryKey: ["provider"],
    columns: ["provider"],
  },
  quota_pools: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  quota_groups: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  quota_snapshot: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  model_intelligence: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  registered_keys: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  sync_tokens: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  upstream_proxy_config: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  webhooks: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  webhook_deliveries: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  skills: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  plugins: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  files: {
    primaryKey: ["id"],
    columns: ["id", "name", "content_type", "size_bytes"],
  },
  batches: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  batch_items: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  sessions: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  feature_flags: {
    primaryKey: ["key"],
    columns: ["key"],
  },
  version_manager: {
    primaryKey: ["name"],
    columns: ["name"],
  },
  model_aliases: {
    primaryKey: ["provider", "alias"],
    columns: ["provider", "alias", "target_provider", "target_model"],
  },
  compression: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  compression_combos: {
    primaryKey: ["combo_id"],
    columns: ["combo_id"],
  },
  semantic_cache: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  reasoning_cache: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  free_proxies: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  relay_tokens: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  relay_logs: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  interceptor_hooks: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  session_account_affinity: {
    primaryKey: ["session_id", "provider"],
    columns: ["session_id", "provider"],
  },
  gamification: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  gamification_leaderboard: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  gamification_badges: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  gamification_xp: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  gamification_tokens: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  gamification_invites: {
    primaryKey: ["code"],
    columns: ["code"],
  },
  gamification_servers: {
    primaryKey: ["key_hash"],
    columns: ["key_hash"],
  },
  agent_bridge_mappings: {
    primaryKey: ["agent_id", "source_model"],
    columns: ["agent_id", "source_model"],
  },
  agent_bridge_state: {
    primaryKey: ["agent_id"],
    columns: ["agent_id"],
  },
  agent_bridge_bypass: {
    primaryKey: ["source"],
    columns: ["source"],
  },
  inspector_custom_hosts: {
    primaryKey: ["host"],
    columns: ["host"],
  },
  inspector_sessions: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  omp_tokens: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  memory_vec_meta: {
    primaryKey: ["key"],
    columns: ["key"],
  },
  context_handoffs: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  middleware_hooks: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  hook_logs: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  quota_consumption: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  token_limits: {
    primaryKey: ["id"],
    columns: ["id"],
  },
  token_window_state: {
    primaryKey: ["id"],
    columns: ["id"],
  },
};

export function getTableInfo(table: string): TableInfo | undefined {
  return TABLE_REGISTRY[table];
}

export function getTablePrimaryKey(table: string): string[] {
  const info = TABLE_REGISTRY[table];
  return info?.primaryKey ?? [];
}

export function getTableColumnList(table: string): string[] {
  const info = TABLE_REGISTRY[table];
  return info?.columns ?? [];
}

export function isRegisteredTable(table: string): boolean {
  return table in TABLE_REGISTRY;
}
