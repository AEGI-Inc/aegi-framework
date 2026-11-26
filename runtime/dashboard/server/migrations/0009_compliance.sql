CREATE TABLE IF NOT EXISTS compliance_policies (
  workspace TEXT NOT NULL, check_id TEXT NOT NULL, policy TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace, check_id)
);
CREATE TABLE IF NOT EXISTS compliance_runs (
  id TEXT PRIMARY KEY, workspace TEXT NOT NULL, check_id TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, snapshot_id TEXT NOT NULL,
  policy TEXT NOT NULL, result TEXT, error TEXT, lease_token TEXT, lease_until TEXT
);
CREATE INDEX IF NOT EXISTS idx_compliance_runs_workspace ON compliance_runs(workspace, check_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_runs_queue ON compliance_runs(workspace, status, created_at);
