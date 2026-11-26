-- 수집 자격증명·계정 대장 (#credentials · server/credentials.ts · src/model/collectionCredential.ts).
-- 비밀값은 여기에 두지 않는다 — 발급자·권한·보관 위치·만료·폐기 계획만. 서버가 토큰·키처럼 보이는 글자를 거절한다.
-- 위협 예외와 같은 D1(EXCEPTIONS_DB)에 둔다. `npm run measured -- exceptions-setup` 이 이 파일도 적용한다. 몇 번 돌려도 같다.

-- 한 항목 = 한 행. 목록·필터에 쓰는 값은 열로, 나머지(권한·이력 포함 레코드 전체)는 detail(JSON)로 둔다.
-- 고칠 때는 본 적 있는 updated_at 이 지금 값과 같을 때만 바꾼다 (동시 수정 409).
CREATE TABLE IF NOT EXISTS collection_credentials (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('credential', 'account')),
  status      TEXT NOT NULL CHECK (status IN ('planned', 'active', 'revoked')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  detail      TEXT NOT NULL
);
