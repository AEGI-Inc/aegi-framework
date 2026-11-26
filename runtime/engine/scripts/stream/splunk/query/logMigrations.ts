/**
 * D1 log cache migrations (migrations/splunk-log), embedded so the single-file connector bundle carries them:
 * on the server the bundle has no migrations folder next to it. logStore.test checks this list matches the folder.
 * Add a migration file there and its exact text here.
 */
export const LOG_MIGRATIONS: Array<{ name: string; text: string }> = [
  { name: '0001_log_cache.sql', text: `-- Splunk 조회 결과 캐시 (scripts/stream/splunk/query/logStore.ts). 원본은 Splunk 이고 여기는 캐시다.
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
` },
  { name: '0002_spl_results.sql', text: `-- AI 검색(SPL) 결과 캐시 (scripts/stream/splunk/query/logStore.ts). 원본은 Splunk 이고 여기는 캐시다.
-- 같은 SPL(검색 기간 포함)은 만료 전이면 다시 검색하지 않는다.

-- 검색 하나의 결과. kind=rows 는 log_spl_result 의 행 묶음, kind=events 는 log_query_event 가 가리키는 정규화 이벤트다.
CREATE TABLE IF NOT EXISTS log_query (
  result_id     TEXT PRIMARY KEY,
  query_hash    TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('rows', 'events')),
  columns       TEXT NOT NULL,
  row_count     INTEGER NOT NULL,
  reasons       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_query_hash ON log_query (query_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_log_query_expires ON log_query (expires_at);

-- 행 결과 묶음. 한 행에 결과 여러 줄을 JSON 배열로 둔다(D1 행 상한 2MB 아래).
CREATE TABLE IF NOT EXISTS log_spl_result (
  result_id     TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  first_row     INTEGER NOT NULL,
  rows          TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  PRIMARY KEY (result_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_log_spl_result_expires ON log_spl_result (expires_at);

-- 이벤트 결과의 순서. 이벤트 본문은 log_event 에 한 번만 둔다.
CREATE TABLE IF NOT EXISTS log_query_event (
  result_id     TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  origin_key    TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  PRIMARY KEY (result_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_log_query_event_expires ON log_query_event (expires_at);
` },
  { name: '0003_incremental_read.sql', text: `-- 로그 캐시 쓰기 줄이기 (scripts/stream/splunk/query/logStore.ts).
-- 끝난 지 얼마 안 된 구간은 다시 확인할 때 index_watermark 뒤에 색인된 것만 검색한다.
-- 이벤트는 그래프 버전이 바뀐 경우에만 다시 쓴다. 그래서 이벤트 행은 살아 있는 구간이나 AI 결과가 가리키는 동안 지우지 않는다.

-- index_watermark: 이 시각(ms) 전에 색인된 이벤트는 다 읽었다. 0 이면 전체를 다시 읽는다.
ALTER TABLE log_bucket ADD COLUMN index_watermark INTEGER NOT NULL DEFAULT 0;
-- final: 늦게 들어올 이벤트를 기다릴 시간(끝난 뒤 2시간)이 지난 뒤 읽은 구간. 만료되면 처음부터 다시 읽는다.
ALTER TABLE log_bucket ADD COLUMN final INTEGER NOT NULL DEFAULT 0;

-- 정리 때 AI 결과가 가리키는 이벤트를 찾는다.
CREATE INDEX IF NOT EXISTS idx_log_query_event_key ON log_query_event (origin_key);
` },
]
