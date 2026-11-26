-- Splunk 이벤트 페이지 캐시를 지운다 (aegi-knowledge architecture D-splunk-cache).
-- Timeline 은 2026-10-30, AI event_context 는 2026-11-01 부터 D1 로그 캐시(log_*)를 읽어 이 테이블을 읽고 쓰는 코드가 없다.
-- 적용된 0006 은 고치지 않고 이 파일을 더한다.
DROP INDEX IF EXISTS idx_splunk_event_cache_expires;
DROP TABLE IF EXISTS splunk_event_cache;
