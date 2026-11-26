-- graph_events, graph_event_links 삭제 (2026-11-01)
-- 이벤트는 D1 로그 캐시(log_*)에서 읽는다. 이 두 표를 읽고 쓰는 코드는 지웠다.
-- 0002, 0004 는 이력으로 둔다.

DROP INDEX IF EXISTS idx_evl_from;
DROP INDEX IF EXISTS idx_evl_to;
DROP INDEX IF EXISTS idx_evl_occurred;
DROP TABLE IF EXISTS graph_event_links;

DROP INDEX IF EXISTS idx_evt_occurred;
DROP INDEX IF EXISTS idx_evt_actor;
DROP TABLE IF EXISTS graph_events;
