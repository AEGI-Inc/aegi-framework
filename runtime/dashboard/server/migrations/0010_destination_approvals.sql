-- 조직 밖 목적지 승인, 공개 의도 (src/model/approval.ts, server/approvals.ts).
-- 실측 데이터셋(measured, measured-v2)만 둔다. 합성 데이터셋은 브라우저에만 저장한다.
-- 게시 때 엔진이 읽어 위협 판정에 쓴다. 몇 번 돌려도 같다.

-- 대상(목록, 종류, 대상 값) 하나에 한 행. 같은 대상을 다시 승인하면 사유와 수정 시각만 바뀐다
CREATE TABLE IF NOT EXISTS destination_approvals (
  dataset      TEXT NOT NULL CHECK (dataset IN ('measured', 'measured-v2')),
  id           TEXT NOT NULL,
  list         TEXT NOT NULL CHECK (list IN ('destination', 'public')),
  kind         TEXT NOT NULL CHECK (kind IN ('domain', 'address', 'object')),
  target       TEXT NOT NULL,
  label        TEXT NOT NULL,
  provider     TEXT,
  source       TEXT NOT NULL CHECK (source IN ('graph', 'customer', 'saas')),
  reason       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  updated_by   TEXT NOT NULL,
  -- 승인 취소. 값이 있으면 판정과 화면 목록에서 뺀다. 다시 승인하면 NULL
  revoked_at   TEXT,
  revoked_by   TEXT,
  PRIMARY KEY (dataset, id)
);

-- 이력은 지우지 않고 쌓는다. 시각은 서버가 찍는다
CREATE TABLE IF NOT EXISTS destination_approval_events (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset  TEXT NOT NULL,
  id       TEXT NOT NULL,
  at       TEXT NOT NULL,
  actor    TEXT NOT NULL,
  reason   TEXT NOT NULL,
  action   TEXT NOT NULL DEFAULT 'approve' CHECK (action IN ('approve', 'revoke'))
);

CREATE INDEX IF NOT EXISTS idx_destination_approval_events ON destination_approval_events (dataset, id, seq);
