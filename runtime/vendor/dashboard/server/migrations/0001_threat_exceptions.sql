-- 위협 예외 (docs/spec/AEGI_THREAT_EXCEPTION_PLAN_V1.md 5.2절 · server/exceptions.ts).
-- 실측 데이터셋(measured · measured-v2)의 예외만 여기에 둔다. 합성 데이터셋은 공개 사이트라 브라우저에만 저장한다.
-- `npm run measured -- exceptions-setup` 이 D1 데이터베이스를 만들고 이 파일을 적용한다. 몇 번 돌려도 같다.

-- 예외 한 건 = 한 행. 바뀌는 값(사유·만료·취소)은 열로, 등록 때 정해지고 바뀌지 않는 값은 detail(JSON)로 둔다.
CREATE TABLE IF NOT EXISTS threat_exceptions (
  id              TEXT PRIMARY KEY,
  dataset         TEXT NOT NULL CHECK (dataset IN ('measured', 'measured-v2')),
  scope           TEXT NOT NULL CHECK (scope IN ('occurrence', 'subject', 'finding')),
  rule_id         TEXT NOT NULL,
  scenario_key    TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  subject_key     TEXT,
  subject_label   TEXT,
  reason_category TEXT NOT NULL,
  reason          TEXT NOT NULL,
  reference       TEXT,
  actor           TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  expires_at      TEXT,
  revoked_at      TEXT,
  revoked_by      TEXT,
  revoke_reason   TEXT,
  updated_at      TEXT NOT NULL,
  -- { subjectAccountKeys, observationIds, snapshot }
  detail          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_threat_exceptions_dataset ON threat_exceptions (dataset, fingerprint);

-- 이력은 지우지 않고 쌓는다 (등록·연장·수정·취소·다시 적용). 시각은 서버가 찍는다.
CREATE TABLE IF NOT EXISTS threat_exception_events (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  exception_id TEXT NOT NULL REFERENCES threat_exceptions (id),
  at           TEXT NOT NULL,
  action       TEXT NOT NULL,
  actor        TEXT,
  note         TEXT
);

CREATE INDEX IF NOT EXISTS idx_threat_exception_events ON threat_exception_events (exception_id, seq);
