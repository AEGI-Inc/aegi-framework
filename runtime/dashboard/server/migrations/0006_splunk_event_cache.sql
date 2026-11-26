-- Splunk 이벤트 조회 캐시 (server/splunkEvents.ts). 이벤트를 누적하지 않고, 한 번 받은 조회 결과 페이지만 24시간 둔다.
-- 행 하나가 한 조회(cache_key: workspace, 기간, 객체 조건의 해시)의 한 페이지다. 만료된 행은 다음 첫 페이지 조회 때 지운다.

CREATE TABLE IF NOT EXISTS splunk_event_cache (
  cache_key   TEXT NOT NULL,
  page        INTEGER NOT NULL,
  body        TEXT NOT NULL,
  query_id    TEXT NOT NULL,
  next_token  TEXT,
  fetched_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  PRIMARY KEY (cache_key, page)
);

CREATE INDEX IF NOT EXISTS idx_splunk_event_cache_expires ON splunk_event_cache (expires_at);
