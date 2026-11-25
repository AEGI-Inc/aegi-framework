-- 컴플라이언스 항목별 대상 판정 (knowledge compliance/scope/catalog-mapping). 스냅샷마다 둔다.
-- 객체 단위 적재 시 행 수 급증(운영 6만 행+)을 막기 위해 (항목, 객체 종류) 및 그 종류의 객체 수 단위로 싣는다.
DROP TABLE IF EXISTS compliance_scope;
DROP TABLE IF EXISTS compliance_scope_runs;

CREATE TABLE IF NOT EXISTS compliance_scope (
  snapshot_id  TEXT NOT NULL,
  framework    TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  type_key     TEXT NOT NULL,
  unit         TEXT NOT NULL CHECK (unit IN ('object', 'type')),
  decision     TEXT NOT NULL CHECK (decision IN ('in', 'review')),
  score        REAL NOT NULL,
  via          TEXT NOT NULL,
  object_count INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, framework, item_id, type_key)
);
CREATE INDEX IF NOT EXISTS idx_cscope_type ON compliance_scope(snapshot_id, type_key);
CREATE INDEX IF NOT EXISTS idx_cscope_decision ON compliance_scope(snapshot_id, decision);

CREATE TABLE IF NOT EXISTS compliance_scope_runs (
  snapshot_id      TEXT PRIMARY KEY,
  knowledge_commit TEXT,
  rules_sha256     TEXT NOT NULL,
  counts           TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
