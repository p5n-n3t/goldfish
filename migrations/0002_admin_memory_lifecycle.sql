-- Dashboard administration keeps historical memory versions and uses soft deletion.
ALTER TABLE memory_records ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE memory_records ADD COLUMN deleted_at TEXT;
ALTER TABLE memory_records ADD COLUMN deleted_by TEXT;
ALTER TABLE memory_records ADD COLUMN created_by TEXT;
ALTER TABLE memory_versions ADD COLUMN changed_by TEXT;
ALTER TABLE memory_versions ADD COLUMN change_summary TEXT;

CREATE INDEX memory_records_admin_filter_idx
  ON memory_records(project_id, lifecycle_status, updated_at DESC);
CREATE INDEX memory_records_admin_agent_idx
  ON memory_records(project_id, agent_id, updated_at DESC);
CREATE INDEX memory_records_admin_session_idx
  ON memory_records(project_id, session_id, updated_at DESC);
CREATE INDEX memory_records_admin_deleted_idx
  ON memory_records(project_id, deleted_at);
