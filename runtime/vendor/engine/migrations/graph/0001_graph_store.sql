-- AEGI Graph Store 스키마 (오브젝트, 관계, 위협 탐지, 유효 접근)
-- 한 항목 = 한 행. 인덱스와 필터링용 핵심 식별자는 전용 열로 두고 전체 구조는 detail(JSON)로 저장합니다.

-- 1. 객체 테이블 (Objects)
CREATE TABLE IF NOT EXISTS graph_objects (
  id           TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  display_name TEXT NOT NULL,
  interfaces   TEXT NOT NULL,
  context      TEXT,
  detail       TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_obj_provider ON graph_objects(provider);
CREATE INDEX IF NOT EXISTS idx_obj_interfaces ON graph_objects(interfaces);

-- 2. 관계 테이블 (Relations)
CREATE TABLE IF NOT EXISTS graph_relations (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  from_key      TEXT NOT NULL,
  to_key        TEXT NOT NULL,
  reverse_type  TEXT,
  confidence    TEXT,
  evidence_refs TEXT,
  detail        TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rel_from ON graph_relations(from_key);
CREATE INDEX IF NOT EXISTS idx_rel_to ON graph_relations(to_key);
CREATE INDEX IF NOT EXISTS idx_rel_type ON graph_relations(type);
CREATE INDEX IF NOT EXISTS idx_rel_pair ON graph_relations(from_key, to_key);

-- 3. 위협 탐지 테이블 (Findings)
CREATE TABLE IF NOT EXISTS graph_findings (
  id          TEXT PRIMARY KEY,
  rule_id     TEXT NOT NULL,
  category    TEXT NOT NULL,
  severity    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  target_keys TEXT NOT NULL,
  path_json   TEXT,
  detail      TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_find_severity ON graph_findings(severity);
CREATE INDEX IF NOT EXISTS idx_find_rule ON graph_findings(rule_id);

-- 4. 유효 접근 테이블 (Effective Access)
CREATE TABLE IF NOT EXISTS graph_effective_access (
  id          TEXT PRIMARY KEY,
  subject_key TEXT NOT NULL,
  target_key  TEXT NOT NULL,
  level       TEXT,
  paths_json  TEXT NOT NULL,
  detail      TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ea_subject ON graph_effective_access(subject_key);
CREATE INDEX IF NOT EXISTS idx_ea_target ON graph_effective_access(target_key);
