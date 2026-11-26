-- Splunk 조회 결과 캐시 (scripts/stream/splunk/query/logStore.ts). 원본은 Splunk 이고 여기는 캐시다.
-- 공통 조회 서비스(Connector)가 Splunk 에서 읽은 정규화 이벤트를 SaaS × 1시간 구간으로 둔다.
-- 설계: aegi-knowledge docs/architecture/splunk-d1-cache-design.md

-- 구간 하나를 Splunk 에서 다 읽었다는 표시. 만료 전이고 그래프 버전이 같으면 다시 검색하지 않는다.
CREATE TABLE IF NOT EXISTS log_bucket (
  provider           TEXT NOT NULL,
  bucket_start       INTEGER NOT NULL,
  graph_snapshot_id  TEXT NOT NULL,
  fetched_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,
  PRIMARY KEY (provider, bucket_start)
);

-- 정규화 이벤트 하나. origin_key 로 한 번만 둔다. object_keys 는 행위자와 대상의 그래프 객체 키(JSON 배열).
CREATE TABLE IF NOT EXISTS log_event (
  origin_key         TEXT PRIMARY KEY,
  provider           TEXT NOT NULL,
  event_type         TEXT NOT NULL,
  at_ms              INTEGER NOT NULL,
  object_keys        TEXT NOT NULL,
  body               TEXT NOT NULL,
  graph_snapshot_id  TEXT NOT NULL,
  expires_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_event_provider_at ON log_event (provider, at_ms);
CREATE INDEX IF NOT EXISTS idx_log_event_expires ON log_event (expires_at);

-- 이벤트 사이 연결. 조회 하나가 끝날 때 그 범위로 계산해 연결 id 로 한 번만 둔다.
CREATE TABLE IF NOT EXISTS log_event_link (
  id                 TEXT PRIMARY KEY,
  from_key           TEXT NOT NULL,
  to_key             TEXT NOT NULL,
  body               TEXT NOT NULL,
  graph_snapshot_id  TEXT NOT NULL,
  expires_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_event_link_to ON log_event_link (to_key);
CREATE INDEX IF NOT EXISTS idx_log_event_link_expires ON log_event_link (expires_at);
