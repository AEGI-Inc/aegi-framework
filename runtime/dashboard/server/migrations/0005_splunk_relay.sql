-- Splunk 커넥터 중계 대기열 (server/splunkRelay.ts D1Relay).
-- AI 검색 요청 하나가 한 행이다. 커넥터가 가져가면 taken, 답을 올리면 answered, 요청한 쪽이 답을 읽으면 지운다.
-- 행은 길어야 몇십 초 산다. 만료된 행은 다음 요청 때 지운다.

CREATE TABLE IF NOT EXISTS splunk_relay (
  id            TEXT PRIMARY KEY,
  request       TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('queued', 'taken', 'answered')),
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  reply_status  INTEGER,
  reply_body    TEXT
);

CREATE INDEX IF NOT EXISTS idx_splunk_relay_state ON splunk_relay (state, created_at);
