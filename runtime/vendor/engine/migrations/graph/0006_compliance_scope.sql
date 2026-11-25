-- 컴플라이언스 항목별 대상 판정 (knowledge compliance/scope, S6). 스냅샷마다 둔다.
-- 규칙 밖(out/rule) 쌍은 싣지 않는다. 점수가 있는 out 은 다음 게시에서 점수를 다시 쓰려고 싣는다.
CREATE TABLE IF NOT EXISTS compliance_scope (
  snapshot_id  TEXT NOT NULL,
  framework    TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  target_key   TEXT NOT NULL,
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('object', 'relation')),
  decision     TEXT NOT NULL CHECK (decision IN ('in', 'review', 'out')),
  grade        TEXT NOT NULL CHECK (grade IN ('rule', 'model', 'human')),
  score        REAL,
  state_sha256 TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, framework, item_id, target_key)
);
CREATE INDEX IF NOT EXISTS idx_cscope_target ON compliance_scope(snapshot_id, target_key);
CREATE INDEX IF NOT EXISTS idx_cscope_decision ON compliance_scope(snapshot_id, decision);

CREATE TABLE IF NOT EXISTS compliance_scope_runs (
  snapshot_id      TEXT PRIMARY KEY,
  knowledge_commit TEXT,
  rules_sha256     TEXT NOT NULL,
  counts           TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
