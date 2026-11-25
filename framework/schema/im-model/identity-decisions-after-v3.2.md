# V3.2 고정 뒤 같은 실체 결정

V3.2(`model/v3.2`)는 고정본이라 고치지 않는다(`FREEZE.json`). 그 뒤 사람이 정한 같은 실체 판정은 여기에 적고, 다음 모델 판에서 `identity/duplicate-dispositions.jsonl`에 반영한다.

| 날짜 | provider | 쌍 | V3.2 판정 | 새 판정 | 근거 | 엔진 반영 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-01 | okta | `RoleAssignedUser`, `UserGetSingleton`(User) | `different`(모델 점수 0.46, 사람 근거 없음) | **same** | `iam/assignees/users` 응답의 `id`와 `orn`이 사용자 것이다. 사용자 결정 | aegi-adapter-engine PR #220 overlay `okta-roleassigneduser` `merge_into: User` |
| 2026-11-01 | github | `public-user`, `simple-user` | V2-S4(사람 결정): `simple-user`는 조직도 나타내므로 `type`이 User, Bot일 때만 `public-user`(User)의 별칭 | **V2-S4 유지** | 엔진 PR #220 초안이 `public-user`를 `simple-user`로 무조건 합쳤다. V2-S4와 대표 타입이 반대라 빼기로 사용자가 정했다 | 합치지 않음. 조건부 합치기(`simple-user[type=User/Bot]` → `public-user`)는 후속이다. 그 전까지 같은 사용자 3명이 두 타입으로 나온다 |
