-- AEGI 스냅샷 저장소 (docs/spec/AEGI_D1_SNAPSHOT_STORE_V1.md)
-- 그래프 행은 모두 snapshot_id 를 가진다. 새 스냅샷을 다 넣고 검증한 뒤 graph_head 한 줄만 바꾼다.
-- ord 는 데이터셋 파일 안의 순서다. KV 번들을 D1 에서 다시 만들 때 원래 순서를 지킨다.

CREATE TABLE IF NOT EXISTS graph_snapshots (
  id                 TEXT PRIMARY KEY,
  dataset_sha256     TEXT NOT NULL,
  dataset_created_at TEXT,
  dataset_name       TEXT,
  status             TEXT NOT NULL CHECK (status IN ('loading', 'verifying', 'ready', 'failed')),
  counts             TEXT NOT NULL,
  engine_version     TEXT,
  knowledge_version  TEXT,
  note               TEXT,
  created_at         TEXT NOT NULL,
  loaded_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_snap_status ON graph_snapshots(status);

-- 현재 스냅샷 포인터. 한 줄만 있다
CREATE TABLE IF NOT EXISTS graph_head (
  name                 TEXT PRIMARY KEY CHECK (name = 'current'),
  snapshot_id          TEXT NOT NULL,
  previous_snapshot_id TEXT,
  updated_at           TEXT NOT NULL,
  reason               TEXT
);

CREATE TABLE IF NOT EXISTS snap_objects (
  snapshot_id  TEXT NOT NULL,
  id           TEXT NOT NULL,
  ord          INTEGER NOT NULL,
  provider     TEXT NOT NULL,
  display_name TEXT NOT NULL,
  interfaces   TEXT NOT NULL,
  context      TEXT,
  detail       TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, id)
);
CREATE INDEX IF NOT EXISTS idx_sobj_provider ON snap_objects(snapshot_id, provider);
CREATE INDEX IF NOT EXISTS idx_sobj_name ON snap_objects(snapshot_id, display_name);

CREATE TABLE IF NOT EXISTS snap_relations (
  snapshot_id   TEXT NOT NULL,
  id            TEXT NOT NULL,
  ord           INTEGER NOT NULL,
  type          TEXT NOT NULL,
  from_key      TEXT NOT NULL,
  to_key        TEXT NOT NULL,
  reverse_type  TEXT,
  confidence    TEXT,
  evidence_refs TEXT,
  detail        TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, id)
);
CREATE INDEX IF NOT EXISTS idx_srel_from ON snap_relations(snapshot_id, from_key);
CREATE INDEX IF NOT EXISTS idx_srel_to ON snap_relations(snapshot_id, to_key);
CREATE INDEX IF NOT EXISTS idx_srel_type ON snap_relations(snapshot_id, type);

CREATE TABLE IF NOT EXISTS snap_links (
  snapshot_id TEXT NOT NULL,
  id          TEXT NOT NULL,
  ord         INTEGER NOT NULL,
  from_key    TEXT,
  to_key      TEXT,
  detail      TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, id)
);
CREATE INDEX IF NOT EXISTS idx_slink_from ON snap_links(snapshot_id, from_key);
CREATE INDEX IF NOT EXISTS idx_slink_to ON snap_links(snapshot_id, to_key);

CREATE TABLE IF NOT EXISTS snap_observations (
  snapshot_id TEXT NOT NULL,
  id          TEXT NOT NULL,
  ord         INTEGER NOT NULL,
  kind        TEXT,
  detail      TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, id)
);

CREATE TABLE IF NOT EXISTS snap_evidence_links (
  snapshot_id TEXT NOT NULL,
  id          TEXT NOT NULL,
  ord         INTEGER NOT NULL,
  from_key    TEXT,
  to_key      TEXT,
  detail      TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, id)
);

-- 엔진이 탐지한 위협 (화면에 보이는 위협과 같은 계산)
CREATE TABLE IF NOT EXISTS snap_findings (
  snapshot_id TEXT NOT NULL,
  id          TEXT NOT NULL,
  ord         INTEGER NOT NULL,
  rule_id     TEXT NOT NULL,
  category    TEXT NOT NULL,
  severity    TEXT NOT NULL,
  status      TEXT NOT NULL,
  target_keys TEXT NOT NULL,
  path_json   TEXT,
  detail      TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, id)
);
CREATE INDEX IF NOT EXISTS idx_sfind_severity ON snap_findings(snapshot_id, severity);

-- 데이터셋의 정답지. 검증 보고에만 쓴다
CREATE TABLE IF NOT EXISTS snap_expected_findings (
  snapshot_id TEXT NOT NULL,
  id          TEXT NOT NULL,
  ord         INTEGER NOT NULL,
  rule_id     TEXT,
  severity    TEXT,
  detail      TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, id)
);

CREATE TABLE IF NOT EXISTS snap_effective_access (
  snapshot_id TEXT NOT NULL,
  id          TEXT NOT NULL,
  ord         INTEGER NOT NULL,
  subject_key TEXT NOT NULL,
  target_key  TEXT NOT NULL,
  level       TEXT,
  paths_json  TEXT NOT NULL,
  detail      TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, id)
);
CREATE INDEX IF NOT EXISTS idx_sea_subject ON snap_effective_access(snapshot_id, subject_key);
CREATE INDEX IF NOT EXISTS idx_sea_target ON snap_effective_access(snapshot_id, target_key);

CREATE TABLE IF NOT EXISTS snap_access_gaps (
  snapshot_id TEXT NOT NULL,
  id          TEXT NOT NULL,
  ord         INTEGER NOT NULL,
  gap_count   INTEGER NOT NULL,
  detail      TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, id)
);

-- 자격증명별 피해 범위. token 은 자격증명만 빼앗긴 가정, account 는 소유 계정 장악 가정
CREATE TABLE IF NOT EXISTS snap_blast_radius (
  snapshot_id   TEXT NOT NULL,
  id            TEXT NOT NULL,
  ord           INTEGER NOT NULL,
  provider      TEXT NOT NULL,
  token_level   TEXT,
  account_level TEXT,
  detail        TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, id)
);

-- 화면 집계 (SaaS별 객체 수, SaaS 쌍 관계 수, 위협 분포 등)
CREATE TABLE IF NOT EXISTS snap_aggregates (
  snapshot_id TEXT NOT NULL,
  id          TEXT NOT NULL,
  ord         INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  detail      TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, id)
);

-- 표가 아닌 자료 한 덩어리씩 (manifest, scenario_bindings, coverage, lineage_events, finding_rules, effective_access).
-- id '_files' 는 데이터셋에 있던 파일 목록이다 (번들을 원래 구성 그대로 다시 만들 때 쓴다)
CREATE TABLE IF NOT EXISTS snap_documents (
  snapshot_id TEXT NOT NULL,
  id          TEXT NOT NULL,
  ord         INTEGER NOT NULL,
  detail      TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, id)
);

-- 이전 그래프 테이블을 같은 이름, 같은 열의 뷰로 바꾼다. 대시보드(server/graph.ts)는 그대로 읽는다
DROP TABLE IF EXISTS graph_objects;
DROP TABLE IF EXISTS graph_relations;
DROP TABLE IF EXISTS graph_findings;
DROP TABLE IF EXISTS graph_effective_access;

CREATE VIEW IF NOT EXISTS graph_objects AS
  SELECT o.id, o.provider, o.display_name, o.interfaces, o.context, o.detail, h.updated_at
  FROM snap_objects o JOIN graph_head h ON h.name = 'current' AND o.snapshot_id = h.snapshot_id;

CREATE VIEW IF NOT EXISTS graph_relations AS
  SELECT r.id, r.type, r.from_key, r.to_key, r.reverse_type, r.confidence, r.evidence_refs, r.detail, h.updated_at
  FROM snap_relations r JOIN graph_head h ON h.name = 'current' AND r.snapshot_id = h.snapshot_id;

CREATE VIEW IF NOT EXISTS graph_findings AS
  SELECT f.id, f.rule_id, f.category, f.severity, f.status, f.target_keys, f.path_json, f.detail, h.updated_at
  FROM snap_findings f JOIN graph_head h ON h.name = 'current' AND f.snapshot_id = h.snapshot_id;

CREATE VIEW IF NOT EXISTS graph_effective_access AS
  SELECT e.id, e.subject_key, e.target_key, e.level, e.paths_json, e.detail, h.updated_at
  FROM snap_effective_access e JOIN graph_head h ON h.name = 'current' AND e.snapshot_id = h.snapshot_id;
