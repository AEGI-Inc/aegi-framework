-- AI 검색(SPL) 결과 캐시 (scripts/stream/splunk/query/logStore.ts). 원본은 Splunk 이고 여기는 캐시다.
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
