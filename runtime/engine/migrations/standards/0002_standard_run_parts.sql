-- Assessment documents larger than one D1 row are stored as ordered text parts. standard_runs.detail is 'null' for such runs.
CREATE TABLE standard_run_parts (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 0),
  body TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
