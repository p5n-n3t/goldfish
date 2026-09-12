-- A workspace key is for this single owner's local coding-agent fleet. It is
-- deliberately distinct from dashboard-issued project keys, which stay scoped.
ALTER TABLE api_keys ADD COLUMN access_scope TEXT NOT NULL DEFAULT 'project'
  CHECK (access_scope IN ('project', 'workspace'));

CREATE INDEX IF NOT EXISTS api_keys_scope_idx
  ON api_keys(access_scope, revoked_at, created_at DESC);
