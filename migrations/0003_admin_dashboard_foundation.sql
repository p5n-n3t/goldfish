PRAGMA foreign_keys = ON;

-- Per-project policy and presentation controls for the administrative dashboard.
CREATE TABLE IF NOT EXISTS project_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  retention_days INTEGER,
  auto_curation_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_curation_enabled IN (0, 1)),
  auto_summarize_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_summarize_enabled IN (0, 1)),
  auto_delete_gibberish_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_delete_gibberish_enabled IN (0, 1)),
  curation_policy_json TEXT NOT NULL DEFAULT '{}',
  dashboard_preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (retention_days IS NULL OR retention_days >= 0)
);

CREATE TABLE IF NOT EXISTS project_categories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, slug),
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS memory_feedback (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  memory_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
  actor_id TEXT,
  feedback_type TEXT NOT NULL,
  rating INTEGER,
  comment TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CHECK (feedback_type IN ('positive', 'negative', 'very_negative', 'helpful', 'unhelpful', 'flag', 'correction', 'rating', 'note'))
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'concept',
  description TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, canonical_name, entity_type)
);

CREATE TABLE IF NOT EXISTS memory_entities (
  memory_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mention_text TEXT,
  relationship_type TEXT NOT NULL DEFAULT 'mentions',
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (memory_record_id, entity_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS entity_edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (source_entity_id <> target_entity_id),
  UNIQUE(project_id, source_entity_id, target_entity_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS memory_assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  memory_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
  storage_provider TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  content_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (byte_size IS NULL OR byte_size >= 0),
  UNIQUE(project_id, storage_provider, storage_key)
);

CREATE TABLE IF NOT EXISTS curation_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  mode TEXT NOT NULL DEFAULT 'suggest',
  scope_json TEXT NOT NULL DEFAULT '{}',
  policy_json TEXT NOT NULL DEFAULT '{}',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  triggered_by TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  CHECK (mode IN ('suggest', 'apply'))
);

CREATE TABLE IF NOT EXISTS curation_candidates (
  id TEXT PRIMARY KEY,
  curation_run_id TEXT NOT NULL REFERENCES curation_runs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  memory_record_id TEXT REFERENCES memory_records(id) ON DELETE SET NULL,
  proposed_action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  rationale TEXT,
  proposal_json TEXT NOT NULL DEFAULT '{}',
  reviewed_by TEXT,
  reviewed_at TEXT,
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (proposed_action IN ('keep', 'archive', 'delete', 'summarize', 'merge', 'reclassify')),
  CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'dismissed'))
);

CREATE TABLE IF NOT EXISTS copilot_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_call_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (role IN ('system', 'user', 'assistant', 'tool'))
);

CREATE INDEX IF NOT EXISTS project_categories_project_order_idx
  ON project_categories(project_id, sort_order, name);
CREATE INDEX IF NOT EXISTS memory_feedback_memory_created_idx
  ON memory_feedback(memory_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_feedback_project_created_idx
  ON memory_feedback(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS entities_project_type_name_idx
  ON entities(project_id, entity_type, name);
CREATE INDEX IF NOT EXISTS memory_entities_project_entity_idx
  ON memory_entities(project_id, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS entity_edges_project_source_idx
  ON entity_edges(project_id, source_entity_id, relationship_type);
CREATE INDEX IF NOT EXISTS entity_edges_project_target_idx
  ON entity_edges(project_id, target_entity_id, relationship_type);
CREATE INDEX IF NOT EXISTS memory_assets_memory_created_idx
  ON memory_assets(memory_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS curation_runs_project_status_created_idx
  ON curation_runs(project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS curation_candidates_run_status_idx
  ON curation_candidates(curation_run_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS curation_candidates_project_memory_idx
  ON curation_candidates(project_id, memory_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS copilot_messages_project_conversation_created_idx
  ON copilot_messages(project_id, conversation_id, created_at);
