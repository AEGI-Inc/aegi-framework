-- 이벤트 연결 (docs/spec/AEGI_EVENT_LINKS_V1.md)
-- graph_events 처럼 스냅샷에 묶지 않는다. 게시할 때 D1 의 전체 이벤트와 current 동일인 연결로 다시 계산해 맞춘다.
-- 한 행 = 앞 이벤트(from_id) → 뒤 이벤트(to_id) 한 쌍. id 는 두 origin_key 로 만든 고정 값이다.

CREATE TABLE IF NOT EXISTS graph_event_links (
  id           TEXT PRIMARY KEY,
  from_id      TEXT NOT NULL,
  to_id        TEXT NOT NULL,
  basis        TEXT NOT NULL,
  strength     TEXT NOT NULL CHECK (strength IN ('confirmed', 'review')),
  cross_saas   INTEGER NOT NULL,
  occurred_at  TEXT NOT NULL,
  detail       TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evl_from ON graph_event_links(from_id);
CREATE INDEX IF NOT EXISTS idx_evl_to ON graph_event_links(to_id);
CREATE INDEX IF NOT EXISTS idx_evl_occurred ON graph_event_links(occurred_at);
