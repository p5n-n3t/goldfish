PRAGMA foreign_keys = ON;

-- Sanitized operational telemetry. Request payloads, credentials, cookies, and
-- response bodies do not belong in this table. Only bounded diagnostic fields do.
CREATE TABLE IF NOT EXISTS request_events (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  agent_id TEXT,
  session_id TEXT,
  app_id TEXT,
  api_key_id TEXT REFERENCES api_keys(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'api',
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'error')),
  latency_ms REAL NOT NULL CHECK (latency_ms >= 0),
  auth_mode TEXT,
  trace_id TEXT,
  query_preview TEXT,
  error_code TEXT,
  input_count INTEGER NOT NULL DEFAULT 0 CHECK (input_count >= 0),
  output_count INTEGER NOT NULL DEFAULT 0 CHECK (output_count >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS request_memory_links (
  request_id TEXT NOT NULL REFERENCES request_events(id) ON DELETE CASCADE,
  memory_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('created', 'returned', 'fetched', 'matched', 'updated', 'deleted', 'restored', 'summarized', 'source')),
  ordinal INTEGER,
  relevance_score REAL CHECK (relevance_score IS NULL OR (relevance_score >= 0 AND relevance_score <= 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (request_id, memory_record_id, link_type)
);

CREATE TABLE IF NOT EXISTS project_profiles (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  display_name TEXT,
  canonical_folder_slug TEXT,
  repository_name TEXT,
  purpose TEXT,
  context_text TEXT,
  stable_profile TEXT,
  dynamic_profile TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  related_sources_json TEXT NOT NULL DEFAULT '[]',
  classification_rules_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_summaries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  summary_type TEXT NOT NULL DEFAULT 'project_brief' CHECK (summary_type IN ('project_brief', 'selection', 'periodic', 'checkpoint')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'superseded', 'failed')),
  title TEXT,
  content TEXT NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  source_memory_ids_json TEXT NOT NULL DEFAULT '[]',
  generated_by TEXT,
  model_id TEXT,
  prompt_version TEXT,
  period_start TEXT,
  period_end TEXT,
  replaces_summary_id TEXT REFERENCES project_summaries(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at TEXT
);

CREATE TABLE IF NOT EXISTS memory_relations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_memory_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
  target_memory_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('updates', 'extends', 'derives', 'related', 'supports', 'contradicts')),
  confidence REAL NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (source_memory_id <> target_memory_id),
  UNIQUE (project_id, source_memory_id, target_memory_id, relationship_type)
);

-- Versioned snapshots of the global/project agent instruction files. A local
-- companion performs filesystem synchronization. The Worker stores no OS secrets.
CREATE TABLE IF NOT EXISTS workflow_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
  document_kind TEXT NOT NULL CHECK (document_kind IN ('agents', 'claude', 'gemini', 'commandork', 'other')),
  variant TEXT NOT NULL DEFAULT 'canonical',
  canonical_path TEXT,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'drifted', 'failed')),
  sync_error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT,
  UNIQUE (scope, project_id, document_kind, variant, version)
);

-- Capability metadata only. Full tokens remain one-time values. The database
-- continues to persist only the existing prefix and hash.
ALTER TABLE api_keys ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '["memory:read","memory:write"]';
ALTER TABLE api_keys ADD COLUMN allowed_project_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE api_keys ADD COLUMN expires_at TEXT;
ALTER TABLE api_keys ADD COLUMN rate_limit_max INTEGER CHECK (rate_limit_max IS NULL OR rate_limit_max > 0);
ALTER TABLE api_keys ADD COLUMN rate_limit_window_seconds INTEGER CHECK (rate_limit_window_seconds IS NULL OR rate_limit_window_seconds > 0);

CREATE INDEX IF NOT EXISTS request_events_project_created_idx ON request_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS request_events_project_operation_created_idx ON request_events(project_id, operation, created_at DESC);
CREATE INDEX IF NOT EXISTS request_events_project_outcome_created_idx ON request_events(project_id, outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS request_events_trace_idx ON request_events(trace_id);
CREATE INDEX IF NOT EXISTS request_memory_links_project_memory_idx ON request_memory_links(project_id, memory_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_summaries_project_status_created_idx ON project_summaries(project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_relations_project_source_idx ON memory_relations(project_id, source_memory_id, relationship_type);
CREATE INDEX IF NOT EXISTS memory_relations_project_target_idx ON memory_relations(project_id, target_memory_id, relationship_type);
CREATE INDEX IF NOT EXISTS workflow_documents_scope_kind_idx ON workflow_documents(scope, project_id, document_kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS api_keys_expiry_idx ON api_keys(expires_at, revoked_at);

-- Register the user's canonical local project namespaces. Empty projects are
-- intentional: they make the selector and classification rules ready before
-- the first memory arrives.
INSERT OR IGNORE INTO projects (id, name) VALUES
  ('goldfish', 'Goldfish'),
  ('trumpfiles.fun-new', 'Trumpstein Files'),
  ('myhayat_new', 'MyHayat'),
  ('myhayat', 'MyHayat Legacy'),
  ('ziopsyop', 'Ziopsyop'),
  ('dr-greenthumb', 'Dr. Greenthumb'),
  ('cannabis', 'Cannabis'),
  ('icvacation', 'IC Vacation'),
  ('superagy-redteam-poc', 'SuperAGI'),
  ('knowledge', 'Knowledge'),
  ('rathlove', 'Rathlove'),
  ('commandork', 'Commandork'),
  ('local-general', 'Local General'),
  ('local-setup', 'Local Setup'),
  ('local-research', 'Local Research'),
  ('local-script', 'Local Scripts'),
  ('legacy-mem0-unassigned', 'Legacy Mem0 · Unassigned');

INSERT OR IGNORE INTO project_profiles
  (project_id, display_name, canonical_folder_slug, repository_name, purpose, aliases_json, related_sources_json)
VALUES
  ('goldfish', 'Goldfish', 'goldfish', 'goldfish', 'Cloudflare-native project memory ledger and Memory Aquarium.', '["Goldfish Memory Aquarium"]', '[]'),
  ('trumpfiles.fun-new', 'Trumpstein Files', 'trumpfiles.fun-new', 'trumpfiles.fun-new', 'Trumpstein Files website and its evidence-oriented project memory.', '["Trump Files","Trumpstein","trumpfiles.fun"]', '["trump_claims"]'),
  ('myhayat_new', 'MyHayat', 'myhayat_new', 'myhayat_new', 'Current MyHayat application.', '["MyHayat New"]', '[]'),
  ('myhayat', 'MyHayat Legacy', 'myhayat', 'myhayat', 'Predecessor MyHayat repository; linked but never merged automatically.', '["Old MyHayat"]', '[]'),
  ('ziopsyop', 'Ziopsyop', 'ziopsyop', 'ziopsyop', 'Ziopsyop website and media/data workflows.', '["ziopsyop-new"]', '[]'),
  ('dr-greenthumb', 'Dr. Greenthumb', 'dr-greenthumb', 'dr-greenthumb', NULL, '["Doctor Greenthumb","Doctor Greenson"]', '[]'),
  ('cannabis', 'Cannabis', 'cannabis', 'cannabis', NULL, '[]', '[]'),
  ('icvacation', 'IC Vacation', 'icvacation', 'icvacation', NULL, '["IC Vacation"]', '[]'),
  ('superagy-redteam-poc', 'SuperAGI', 'superagy-redteam-poc', 'superagy-redteam-poc', NULL, '["Super AGI","SuperAGI Retheme"]', '[]'),
  ('knowledge', 'Knowledge', 'knowledge', 'knowledge', NULL, '[]', '[]'),
  ('rathlove', 'Rathlove', 'rathlove', 'rathlove', NULL, '["Rush Love"]', '[]'),
  ('commandork', 'Commandork', 'commandork', 'commandork', 'Local multi-provider orchestration layer.', '["Command Work","Command Dork"]', '[]'),
  ('legacy-mem0-unassigned', 'Legacy Mem0 · Unassigned', 'legacy-mem0-unassigned', NULL, 'Quarantined historical records without trustworthy project evidence; excluded from normal retrieval.', '[]', '[]');
