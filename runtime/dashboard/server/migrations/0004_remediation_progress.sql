-- 조치 진행 상태 (src/model/remediationProgress.ts · server/remediationProgress.ts).
-- 위협(지문) 하나와 조치 하나의 짝마다 한 행. 실측 데이터셋(measured · measured-v2)만 둔다.
-- `npm run measured -- exceptions-setup` 이 이 파일도 적용한다. 몇 번 돌려도 같다.

CREATE TABLE IF NOT EXISTS remediation_progress (
  dataset          TEXT NOT NULL CHECK (dataset IN ('measured', 'measured-v2')),
  fingerprint      TEXT NOT NULL,
  remediation_id   TEXT NOT NULL,
  finding_id       TEXT NOT NULL,
  title            TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed', 'verified')),
  owner            TEXT,
  due              TEXT,
  completed_steps  TEXT NOT NULL,
  verified_by      TEXT,
  verified_at      TEXT,
  updated_at       TEXT NOT NULL,
  updated_by       TEXT,
  PRIMARY KEY (dataset, fingerprint, remediation_id)
);

CREATE TABLE IF NOT EXISTS remediation_progress_events (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset         TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  remediation_id  TEXT NOT NULL,
  at              TEXT NOT NULL,
  status          TEXT NOT NULL,
  actor           TEXT,
  owner           TEXT,
  due             TEXT
);

CREATE INDEX IF NOT EXISTS idx_remediation_progress_events ON remediation_progress_events (dataset, fingerprint, remediation_id, seq);
