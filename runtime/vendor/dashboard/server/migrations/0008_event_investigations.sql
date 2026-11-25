-- 조사 보드 팀 공유 저장소 (src/model/investigation.ts · server/investigations.ts).
-- 실측 데이터셋(measured · measured-v2)의 조사만 여기에 둔다. 합성 데이터셋은 브라우저에만 저장한다.
-- `npm run measured -- exceptions-setup` 이 이 파일도 적용한다. 몇 번 돌려도 같다.

-- 조사 하나(id)에 한 행. 제목과 상태, 담당자, 결론, 직렬화된 보드가 들어간다.
CREATE TABLE IF NOT EXISTS event_investigations (
  dataset      TEXT NOT NULL CHECK (dataset IN ('measured', 'measured-v2')),
  id           TEXT NOT NULL,
  title        TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('open', 'doing', 'closed')),
  owner        TEXT,
  conclusion   TEXT,
  board        TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  updated_by   TEXT,
  PRIMARY KEY (dataset, id)
);

-- 이력은 지우지 않고 쌓는다. 시각은 서버가 찍는다
CREATE TABLE IF NOT EXISTS event_investigation_events (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset      TEXT NOT NULL,
  id           TEXT NOT NULL,
  at           TEXT NOT NULL,
  state        TEXT NOT NULL,
  actor        TEXT,
  owner        TEXT,
  note         TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_investigation_events ON event_investigation_events (dataset, id, seq);
