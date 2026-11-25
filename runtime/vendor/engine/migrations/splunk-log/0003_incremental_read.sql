-- 로그 캐시 쓰기 줄이기 (scripts/stream/splunk/query/logStore.ts).
-- 끝난 지 얼마 안 된 구간은 다시 확인할 때 index_watermark 뒤에 색인된 것만 검색한다.
-- 이벤트는 그래프 버전이 바뀐 경우에만 다시 쓴다. 그래서 이벤트 행은 살아 있는 구간이나 AI 결과가 가리키는 동안 지우지 않는다.

-- index_watermark: 이 시각(ms) 전에 색인된 이벤트는 다 읽었다. 0 이면 전체를 다시 읽는다.
ALTER TABLE log_bucket ADD COLUMN index_watermark INTEGER NOT NULL DEFAULT 0;
-- final: 늦게 들어올 이벤트를 기다릴 시간(끝난 뒤 2시간)이 지난 뒤 읽은 구간. 만료되면 처음부터 다시 읽는다.
ALTER TABLE log_bucket ADD COLUMN final INTEGER NOT NULL DEFAULT 0;

-- 정리 때 AI 결과가 가리키는 이벤트를 찾는다.
CREATE INDEX IF NOT EXISTS idx_log_query_event_key ON log_query_event (origin_key);
