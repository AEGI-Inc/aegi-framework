-- Splunk 에서 읽은 정규 이벤트 (docs/SPLUNK_TIMELINE_PLAN.md 3절)
-- 한 이벤트 = 한 행. id 는 origin_key. 시간순 조회용으로 발생 시각에 인덱스를 둔다.

CREATE TABLE IF NOT EXISTS graph_events (
  id           TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  occurred_at  TEXT,
  indexed_at   TEXT,
  actor_key    TEXT,
  target_keys  TEXT NOT NULL,
  detail       TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evt_occurred ON graph_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_evt_actor ON graph_events(actor_key);
