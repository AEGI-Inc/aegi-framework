-- 위협 예외 범위에 목적지 전체(destination)를 더한다 (src/model/exception.ts ExceptionScope).
-- 목적지 전체 예외는 subject_key 에 조직 밖 목적지 키, subject_label 에 목적지 이름을 둔다.
-- SQLite 는 CHECK 를 바꿀 수 없어 같은 열로 새 표를 만들고 옮긴다.
-- 이력 표(threat_exception_events)가 예외 표를 가리키므로 이력을 잠시 옮겨 두고 예외 표를 바꾼 뒤 같은 seq 로 되돌린다.

CREATE TABLE threat_exceptions_next (
  id              TEXT PRIMARY KEY,
  dataset         TEXT NOT NULL CHECK (dataset IN ('measured', 'measured-v2')),
  scope           TEXT NOT NULL CHECK (scope IN ('occurrence', 'subject', 'finding', 'destination')),
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
  -- { subjectAccountKeys, observationIds, snapshot, approver, decisionId }
  detail          TEXT NOT NULL
);

INSERT INTO threat_exceptions_next (id, dataset, scope, rule_id, scenario_key, fingerprint, subject_key, subject_label, reason_category, reason,
  reference, actor, created_at, expires_at, revoked_at, revoked_by, revoke_reason, updated_at, detail)
SELECT id, dataset, scope, rule_id, scenario_key, fingerprint, subject_key, subject_label, reason_category, reason,
  reference, actor, created_at, expires_at, revoked_at, revoked_by, revoke_reason, updated_at, detail
FROM threat_exceptions;

CREATE TABLE threat_exception_events_keep AS SELECT seq, exception_id, at, action, actor, note FROM threat_exception_events;

DROP TABLE threat_exception_events;

DROP TABLE threat_exceptions;

ALTER TABLE threat_exceptions_next RENAME TO threat_exceptions;

CREATE INDEX IF NOT EXISTS idx_threat_exceptions_dataset ON threat_exceptions (dataset, fingerprint);

CREATE TABLE threat_exception_events (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  exception_id TEXT NOT NULL REFERENCES threat_exceptions (id),
  at           TEXT NOT NULL,
  action       TEXT NOT NULL,
  actor        TEXT,
  note         TEXT
);

INSERT INTO threat_exception_events (seq, exception_id, at, action, actor, note)
SELECT seq, exception_id, at, action, actor, note FROM threat_exception_events_keep ORDER BY seq;

DROP TABLE threat_exception_events_keep;

CREATE INDEX IF NOT EXISTS idx_threat_exception_events ON threat_exception_events (exception_id, seq);
