-- 위협 처리 상태 (src/model/handling.ts · server/handling.ts).
-- 실측 데이터셋(measured · measured-v2)의 처리 상태만 여기에 둔다. 합성 데이터셋은 브라우저에만 저장한다.
-- `npm run measured -- exceptions-setup` 이 이 파일도 적용한다. 몇 번 돌려도 같다.

-- 위협 하나(지문)에 한 행. 위협 ID 와 제목은 마지막으로 바꿀 때의 것이다
CREATE TABLE IF NOT EXISTS threat_handling (
  dataset      TEXT NOT NULL CHECK (dataset IN ('measured', 'measured-v2')),
  fingerprint  TEXT NOT NULL,
  finding_id   TEXT NOT NULL,
  title        TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('new', 'ack', 'doing', 'done')),
  owner        TEXT,
  note         TEXT,
  verified_by  TEXT,
  verified_at  TEXT,
  updated_at   TEXT NOT NULL,
  updated_by   TEXT,
  PRIMARY KEY (dataset, fingerprint)
);

-- 이력은 지우지 않고 쌓는다. 시각은 서버가 찍는다
CREATE TABLE IF NOT EXISTS threat_handling_events (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset      TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  at           TEXT NOT NULL,
  state        TEXT NOT NULL,
  actor        TEXT,
  owner        TEXT,
  note         TEXT
);

CREATE INDEX IF NOT EXISTS idx_threat_handling_events ON threat_handling_events (dataset, fingerprint, seq);
