# AEGI IM Object Model V3

**2026-10-25에 고정한 IM Object Model이다. v1(2026-10-19 고정)에 v2 사용자 결정과 r1 개정(실측 근거 연결, 고아, 중복, Object, Relation 정리)을 반영했다.** Object 타입 1,980개(Object 1,971, non_object 9), Relation 어휘 17종, 결정 기반 Relation binding 13건이다. 모든 판정에는 근거 코드나 미결 사유가 붙어 있다.

이 저장소에는 이 README만 있다. 고정 파일 40개와 `verify-freeze.mjs`는 aegi-knowledge `schema/im-model/model/v3/`에 있고, 그 저장소 루트에서 `node schema/im-model/model/v3/verify-freeze.mjs`로 SHA-256을 확인한다. 만든 과정과 재현 방법은 원 작업 공간 `im-model-revision/README.md`에 있고 이 저장소에는 없다. 새 판단은 이 폴더를 고치지 않고 다음 버전 폴더에서 한다.

## 1. 구성

| 폴더 | 내용 | 행 수 |
| --- | --- | ---: |
| `objects/` | Object 타입 판정. disposition, interface, 결정 근거, 이번 run 실측 여부, 계약 검증 상태 | 1,980 |
| `identity/` | 조건부 alias, split, 추가 공간 3개, 동일성 근거, v2 반영 same_entity(provider별), 중복 판단 323쌍의 출처 | - |
| `relations/` | 어휘 17종(현행 Relation_Schema_v3), 결정 기반 binding, typed reference 5,293개의 처리 결과 | 13 / 5,293 |
| `information/` | 연구 정보 고아 4,669항목의 귀속 결과나 미결 사유 | 4,669 |
| `evidence/` | 실측 페이지 510개와 IR operation, record selector 연결, observed IR 대조, shape 충돌 | 510 |
| `graph/` | 정규화 스냅샷의 그래프 고아 1,081개 분류 | 1,081 |
| `decisions/` | 결정 R1-D01~D14와 판정 규칙 설정 | - |

## 2. v1 대비 바뀐 점

- **동일성:** v2 split 5건(V2-S3~S6)을 재생성으로 반영했다. GitHub `team-membership.username`은 `public-user`의 login 참조로 옮겼다(R1-D09). Okta Application/OAuth2Client는 client_id가 맞을 때만 조건부 alias다(V2-D05).
- **Object:**
  - GitHub 사용자 타입의 대표 공간을 `public-user`로, Jira 타입은 `RemoteIssueLink`로 옮겼다(R1-D13).
  - non_object로 바꾼 것: `simple-user`(다형 참조), Okta `UserResponseSchema`(O7 신원 Link 재료), GWS `Member.memberKey`(다형 참조), Jira `PermissionGrant`(G4-Q02 Policy 내용), Jira `{}_2`(주소 키), Okta `Client`(Application의 view).
  - 추가한 것: `slack:SlashCommandRequestEndpoint`, `confluence:SpacePermission`(Object), `gws:DriveGrantee`(참조 공간).
- **Relation:**
  - Drive owner 권한은 `owned_by`만 만든다(R1-D01).
  - Q01, Q04, Q05, Confluence SpacePermission, Jira 프로젝트 역할의 binding을 정했다.
  - `triggered_by` 템플릿은 현행 규격(대상에 Resource, Integration 포함)을 따른다.
  - GWS `permissionId` 참조 11개는 DriveGrantee를 가리킨다(R1-D02).

## 3. 상태 축과 수치

| 축 | 수치 |
| --- | --- |
| Object 실측 | 이번 run에서 record가 나온 타입 73개. 나머지는 미관측(없다는 뜻 아님) |
| Object 계약 검증 | 1,976개 `requires_projected_row`(v1과 같음). 운영 계약 검증은 끝나지 않았다 |
| 고아 정보 | 귀속 3,691(부모 속성 1,862, wrapper와 보기 704, 쓰기 응답 전용 905, 관측 157, 벤더 카탈로그 52, 공간 11), 미결 978 |
| 고아 판정 근거 | 결정 반영 208(R1-D03, D04, D06, D07), 규칙 적용 1,613, 거친 규칙 적용 1,839(`rule_applied_coarse`), 관측 wrapper 자동 규칙 31 |
| typed reference | object_reference 3,734(이 중 3,606은 v1 자동 탐지 그대로), property 1,455, relation 1, 미결 103 |
| 중복 판단 | 323쌍 중 모델 점수만으로 병합한 쌍 13개(`model_only_merge`) |
| 그래프 고아 | 이후 결정이 반영되지 않은 투영 898, 정상 미연결 119, binding 누락 33, 간접 참조 27, 미결 4 |

## 4. 알려진 한계

- **R1-D06~D14는 사용자 일괄 승인 아래 이 세션이 정했다**(`decided_by: agent_under_user_blanket_approval`). 다음 버전에서 사람이 다시 볼 대상이다.
- `rule_applied_coarse`(S-P, S-T, S-N 규칙)는 경로 낱말을 쓰지 않는다. 그래서 사건 기록(예: Chrome telemetry events)이 부모 속성으로 분류될 수 있다.
- typed reference 3,606개는 v1 자동 탐지를 Relation으로 올리지 않고 참조로만 유지했다. Relation 매핑 검토는 다음 과제다.
- 실측은 한 코호트(run `20261023T070520Z-42c1`)뿐이다. 다음 분기는 미관측이다: identity-source User, GWS Member, Drive About, GitHub Bot, 비어 있지 않은 Slack 앱 승인 목록.
- 운영 정규화기(normalize-v2)는 아직 R1-D01과 Slack 승인 속성(`last_resolved_by`, `scopes[]`)을 반영하지 않았다. Profile 컴파일 또는 정규화기 작업에서 맞춰야 한다.

## 5. 사용

- Profile 컴파일러의 입력:
  - `objects/object-types.jsonl`
  - `identity/space-aliases.jsonl`, `identity/space-splits.jsonl`, `identity/space-additions.jsonl`
  - `relations/relation-bindings.jsonl`
  - `evidence/observation-operation-links.jsonl`
- 동일성 판단은 pinned out2가 아니라 `identity/same-entity/*.json`을 쓴다.
- 실제 ID와 이메일은 이 폴더에 없다. pinned out2 에서 온 same_entity 신호의 실측 예시 값 1건은 고정 때 가렸다(FREEZE.json 의 transform). 실측 값은 원 작업 공간 `im-model-revision/private/`에만 있고 공개 저장소에 올리지 않는다.
