-- Independent assessment history. Source snapshot is provenance, never a cascading FK.
CREATE TABLE standard_runs (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  generated_at TEXT NOT NULL,
  published_at TEXT NOT NULL,
  source_snapshot_id TEXT,
  standards_count INTEGER NOT NULL,
  findings_count INTEGER NOT NULL,
  detail TEXT NOT NULL CHECK (json_valid(detail))
);
CREATE INDEX standard_runs_published ON standard_runs(published_at DESC, id DESC);
CREATE TABLE standard_head (
  name TEXT PRIMARY KEY CHECK (name = 'current'),
  run_id TEXT NOT NULL REFERENCES standard_runs(id),
  previous_run_id TEXT REFERENCES standard_runs(id),
  updated_at TEXT NOT NULL
);
