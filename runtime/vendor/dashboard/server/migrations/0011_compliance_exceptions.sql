-- 컴플라이언스 예외 (src/model/complianceException.ts, server/complianceExceptions.ts).
-- 실측 데이터셋(measured, measured-v2)만 둔다. 합성 데이터셋은 브라우저에만 저장한다.
-- 확인사항 또는 점검 단위로 예외 사유와 만료일을 팀이 함께 기록한다. 몇 번 돌려도 같다.

-- 대상(범위, 대상 키) 하나에 한 행. 같은 대상을 다시 등록하면 사유와 만료일이 바뀌고 이력이 쌓인다
CREATE TABLE IF NOT EXISTS compliance_exceptions (
  dataset          TEXT NOT NULL CHECK (dataset IN ('measured', 'measured-v2')),
  id               TEXT NOT NULL,
  scope            TEXT NOT NULL CHECK (scope IN ('item', 'check')),
  target           TEXT NOT NULL,
  label            TEXT NOT NULL,
  reason_category  TEXT NOT NULL CHECK (reason_category IN ('compensating_control', 'risk_accepted', 'not_applicable', 'planned_fix')),
  reason           TEXT NOT NULL,
  reference        TEXT,
  expires_at       TEXT NOT NULL,
  fail_findings    TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  created_by       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  updated_by       TEXT NOT NULL,
  revoked_at       TEXT,
  revoked_by       TEXT,
  PRIMARY KEY (dataset, id)
);

-- 이력은 지우지 않고 쌓는다. 시각은 서버가 찍는다
CREATE TABLE IF NOT EXISTS compliance_exception_events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset     TEXT NOT NULL,
  id          TEXT NOT NULL,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('register', 'revoke')),
  reason      TEXT NOT NULL,
  expires_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_compliance_exception_events ON compliance_exception_events (dataset, id, seq);
