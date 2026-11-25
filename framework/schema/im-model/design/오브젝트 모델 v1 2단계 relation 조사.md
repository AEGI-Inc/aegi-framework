# 오브젝트 모델 v1 2단계: ID × ID relation 누락과 중복 조사

<!-- model-v1-followup:begin -->
## 13. 전수 재생성과 원문 보정 (2026-10-19)

8개 SaaS의 중복 결과까지 모두 현재 공개 요청 형식과 맞춰 다시 만들었다. GitHub 10개, Jira 1개, Slack 14개와 Salesforce 53개 중복 요청을 추가 채점했으며 응답 대기는 없다. Google의 이메일과 OAuth clientId는 외부 locator로 보존한다. source_same과 source_distinct는 모델보다 먼저 적용하고 Q1~Q3 사람 결정이 최우선이다.

원문으로 고친 항목은 GitHub 조직 초대와 User의 분리, 팀의 username과 repo 대상, Google DeviceUser와 Meet Member의 자기 키, Delegate 이메일 대상과 외부 forwarding 이메일, OAuth client locator, Jira issue type 대상, Atlassian accountId 자기 키다. Slack의 같은 usergroups.list 응답을 두 명세가 각각 usergroup와 objs_subteam으로 부른 부분도 원문 같음 근거로 묶었다. 이전 모델 응답은 남겨 둔다.

직접 공간 쌍은 86개이며 나머지 42개의 D 18, E 24 분류와 생성 계약도 유지한다. 해시 시드 1, 2에서 지도, 모든 중복과 대조 39개 파일이 일치했고 8개 IR 검증을 통과했다. 전체 연구 회귀 검사는 71개이며 [현재 단계](오브젝트%20모델%20v1%20진행%20현황.md)와 [4단계 적용](오브젝트%20모델%20v1%204단계%20relation%20적용.md)에 이어진다.
<!-- model-v1-followup:end -->


- 작성일: 2026-10-18 (1차, 중간 보고)
- 마지막 갱신: 2026-10-19
- 질문: 정보 지도의 ID 공간 쌍으로 relation을 만든다고 할 때, 기존 자료와 Cartography가 가진 relation 중 빠지는 것과 겹치는 것은 무엇인가
- 스크립트: `candidate-extraction/ir2/rel_audit.py` (Cartography 대조), `rel_audit.py profiles` (aegi-schema Profile 대조)
- 결과: `out2/rel_audit.json`, `out2/rel_audit_profiles.json`
- 1단계 결정: `decisions_step1.json` (69건, 권고대로, 빼는 권고는 남기는 쪽으로)

## 결론 (최신, 잔여 관계 조사와 판정 보정)

- 직접 공간 쌍 대조는 86개다. 이미지와 태그를 패키지 버전 ID로 보던 오판 2개를 고쳐 직전 88개를 정정했다.
- 직접 쌍이 없는 42개는 D 18개와 E 24개로 모두 근거와 생성 규칙을 기록했다. 미분류는 0개이며, 직접 관계 누락이 0개라는 뜻은 아니다.
- 13개 관계에는 로컬 연산 또는 참조 파서를 구현했다. 29개는 수집 계약과 보류 조건까지 정리했으며 전체 실행 구현과 실측 수집은 남아 있다. 결과와 한계는 12절을 따른다.
- Okta 중복 판정의 미정 3개와 기존 공간 없음 1개를 원문으로 정리했고 Q1~Q3은 유지했다. 회귀 검사 39개, IR 검증 8개와 재생성 파일 30개 일치를 확인했다.

## 직전 결론 (원인 B 마무리와 원인 C 반영)

- Cartography 공간 쌍 대조는 있음 88, 빠짐 19, 노드 미매핑 21이다. 직전 79개에서 원인 B 4개와 원인 C 5개가 늘었다.
- 원인 B로 남았던 5개 중 4개는 원문 참조로 반영했다. Salesforce 앱과 사용자 1개는 Cartography의 이름 조인이므로 원인 D로 정정했다. 처음 B로 분류한 13개는 직접 공간 쌍 12개와 D 1개로 정리됐다.
- Jira 원인 C 5개는 판별값에 따른 대상과 조건을 지도에 보존한다. 알 수 없는 종류와 동적 권한 보유자는 직접 ID로 해석하지 않는다.
- `Permission.permissionType`과 `IamRole`의 잘못된 병합은 원문 다름 근거로 막았다. Q1~Q3 사람 결정은 유지한다. 구현, 근거와 검증은 11절을 따른다.

## 직전 결론 (원인 B 재개 뒤, 2026-10-18)

- Q1~Q3은 사람 결정으로 적용하고 재생성 뒤에도 유지되는지 검사했다. GitHub `Team`은 조직 팀, Jira 그룹 넷은 한 대상, Google 두 그룹 API도 한 대상이다(7.1절).
- Cartography 비테넌트 간선 128개의 공간 쌍 대조는 있음 79, 빠짐 28, 노드 미매핑 21이다. Q1~Q3 반영 직후 71개에서 Okta 정책 관련 8개가 늘었다. 원인 B 13개 중 공간 쌍 기준 8개를 해소했고 5개는 남았다(10절).
- 기반 모양에 상속된 판별자 표를 다시 따라가던 반복 탐색을 고쳤다. 요청과 스키마 예시도 실제 자리에 맞춰 참조 판정에 쓰며, 모든 값 규칙을 적용한 뒤 남은 필드에만 Jev 결과를 붙인다.
- 이 대조는 방향과 관계 종류를 구분하지 않는다. 「있음」은 ID 공간 쌍이 있다는 뜻이며, `include`와 `exclude` 각각의 의미까지 검증했다는 뜻은 아니다.

## 이전 결론 (중복 공간 판정 뒤, Q1~Q3 결정 전)

- 같은 대상을 가리키는 공간을 57개 묶음으로 묶었다(GitHub 31, Okta 19, Slack 4, Jira 2, Google 1). 지도 공간은 그대로 두고, 묶음마다 대표 공간을 정해 relation 대조가 대표로 읽는다(`out2/<p>/map/same_entity.json`).
- 판정 정확도: GitHub 정답표 27쌍에서 맞음 26, 놓침 1(`content-file`과 `contents`), 잘못 같음 0. 정답표는 제가 만든 것이고 사용자 확인 전이다.
- Cartography relation 대조는 64 → 67개로 늘었다. 빠짐 40개 중 원인 A(중복)로 남은 것은 Google 그룹 9개다. Directory 그룹과 Cloud Identity 그룹은 키가 다르고(id, 이메일과 `groups/{id}`) 문서 예시가 없어 같은 대상 신호가 하나도 없다.
- 사람이 정해야 할 것 셋은 7절에 있다.

## 결론 (1차, 중복 판정 전)

- Cartography 간선 128개(테넌트 소속 간선 제외) 중 64개가 우리 공간 쌍에 있다. 21개는 노드가 API 밖(파일 파싱, AWS)이라 비교 대상이 아니고, 43개가 빠진다.
- 빠지는 43개의 원인은 다섯 가지다.

| 원인 | 수 | 예 | 고칠 방법 |
| --- | --- | --- | --- |
| A. 같은 대상의 공간이 여럿이라 relation이 다른 쪽 공간에 있다 | 12 | Google 그룹 회원은 Directory `Group`(+`Member.memberKey`)에 있는데 Cartography는 Cloud Identity `Group_2`로 수집. Okta 앱 사용자는 `AppUser.userId`(D5로 세운 대상)에 있고 사용자 공간과 안 합쳐짐 | 2단계 다음 작업: 중복 공간 판정과 합치기 |
| B. 참조 자리는 있는데 대상이 안 정해졌다 | 13 | Okta 정책 규칙의 `conditions.people.groups.include`(예시 값 없음), `user.type.id`, Salesforce `UserRole.ParentRoleId`(원문 Refers To 없음) | Jev 필드 대상 판정을 모든 「대상 모름」 참조로 넓힌다. 테넌트 실측으로 접두사를 더 배운다 |
| C. 종류 필드로 대상이 갈리는 다형 참조 | 5 | Jira `PermissionGrant.holder`(`type`이 group, user, projectRole), 프로젝트 역할 행위자 | 판별 필드 값과 대상 공간을 잇는 규칙 |
| D. 다른 relation을 거치거나 계산해야 나오는 relation | 7 | GitHub 브랜치 보호 → 브랜치 → 저장소, Google 상속 그룹 회원, Jira 관리자 권한 | 지도 밖. aegi-schema `contained_in` 연쇄와 Effective Access 계산의 몫 |
| E. API 밖 자료(파일 파싱, 레지스트리)가 근거 | 6 | GitHub 워크플로 → 비밀값, 컨테이너 이미지 연쇄, 언어 | 1단계 결정(D 묶음 보류)에 따른다 |

- 조사 중 지도 규칙 빈틈 셋을 고쳤다. 이 셋과 대조 쪽 보강(경로 맥락, RPC 맥락, 같은 공간끼리 쌍)으로 Cartography 대조가 45 → 64개로 늘었다.
  1. 문자열 ID 배열(`members`, `groupIds`)을 값 판정과 정보 항목에서 아예 버리고 있었다.
  2. Okta처럼 원문 ID 형식이 없는 provider는 참조 대상을 못 정했다. 공간 키 값에서 접두사를 배우는 규칙을 더했다.
  3. 공간의 자기 키 필드를 원문이 말하지 않으면 키 값을 모을 수 없었다. Jev로 공간 444개의 자기 식별자 필드를 판정했다.
- 중복 신호는 이미 여러 개 쌓였다. 다음 작업은 이 신호들로 중복 공간을 판정하는 것이다.

| 신호 | GitHub | Okta | Slack | Google | Jira |
| --- | --- | --- | --- | --- | --- |
| GraphQL과 REST 같은 대상 (node_id 해독) | 29 | | | | |
| 같은 접두사의 키 값을 가진 공간 묶음 | 2 | 43 | 6 | | 2 |
| 같은 원문 ID 형식의 Jev 키 (format_twins) | | | 5 | | |
| D5로 세운 대상 (기존 공간과 같은지 미확인) | 2 | 12 | | 8 | 1 |
| 기존 중복 후보 규칙 | 28 | 15 | 2 | 0 | 2 |

## 1. 방법

### 1.1 우리 쪽 ID × ID 쌍

정보 지도에서 두 공간을 잇는 것을 모두 쌍으로 본다. 같은 공간끼리도 쌍이다(팀의 상위 팀).

| 방식 | 내용 |
| --- | --- |
| ref | 한 공간 레코드의 필드가 다른 공간을 가리킨다 |
| relation | 자기 id 없는 조합 레코드가 여러 공간을 잇는다 (R1) |
| parent | 부모 안 공간과 부모 |
| link | D5 연결 레코드 |
| composite | 복합키 자격증명의 키 자리 (R2a) |
| path | 부모 위치 아래 동작이 다른 공간의 레코드를 돌려준다 (`GET /groups/{id}/users` → 그룹 × 사용자) |
| rpc | 경로 없는 동작의 맥락 공간 × 응답이 가리키는 공간 (Slack `conversations.members` → 채널 × 사용자) |

### 1.2 기준

| 기준 | 범위 | 잇는 방법 |
| --- | --- | --- |
| Cartography 간선 | 노드에 붙은 간선과 노드에 안 붙은 간선(matchlink) 190개. 이 중 테넌트 소속(`RESOURCE`) 62개는 따로 둔다 | 노드와 공간은 1단계 `carto_audit` 결과(API 대조)로 잇는다. 이름 비교 없음 |
| aegi-schema Profile | Slack 8, Okta 6, Pilot 6개 Profile의 `references` | Profile의 수집 엔드포인트를 1단계와 같은 방식으로 공간에 잇고, 참조 경로를 그 공간 모양에서 따라간다 |

## 2. Cartography 대조 결과

| provider | 있음 | 빠짐 | 비교 대상 아님 |
| --- | --- | --- | --- |
| GitHub | 35 | 12 | 16 |
| Okta | 13 | 12 | 4 |
| Slack | 8 | 1 | 0 |
| Google | 0 | 9 | 1 |
| Jira | 3 | 7 | 0 |
| Salesforce | 5 | 2 | 0 |
| 합계 | 64 | 43 | 21 |

테넌트 소속 간선은 우리 지도가 모든 레코드의 맥락(테넌트)으로 묵시하므로 relation 쌍으로 세지 않았다.

### 2.1 빠진 43개

| provider | Cartography 간선 | 원인 |
| --- | --- | --- |
| GitHub | DependencyGraphManifest → Repository | A: GraphQL 쪽 공간(`Repository`)과 REST `full-repository`가 같은 대상 |
| GitHub | ExternalIdentity → User | A: 같은 이유(GraphQL `User`와 `simple-user`) |
| GitHub | Team → Team (상위 팀) 2 | A: `team-full.parent`가 `enterprise-team-with-member-count` 공간을 가리킨다. 팀 공간이 갈려 있다 |
| GitHub | BranchProtectionRule → Repository | D: 보호 → 브랜치 → 저장소 두 단계 부모 |
| GitHub | RulesetRule → Ruleset | D: 규칙에 자기 id가 없어 룰셋 안에 있다(1단계 E2) |
| GitHub | 컨테이너 이미지 4, 워크플로 → 비밀값, 언어 | E |
| Google | Group 회원, 소유자 4 | A: 회원은 Directory `Group` 아래 `Member`(D5, `Member.memberKey`)에 있다. Cartography는 Cloud Identity `Group_2`로 본다 |
| Google | Device → User | A: Cloud Identity `DeviceUser` 연결 레코드의 `deviceUsersId`로 세운 대상이 사용자 공간과 안 합쳐졌다 |
| Google | 상속 회원, 상속 소유자 4 | D: Cloud Identity가 계산해 주는 관계 |
| Jira | PermissionGrant → User, Group, ProjectRole 3 | C: `holder.type`으로 대상이 갈린다 |
| Jira | ProjectRole → User, Group 2 | C: 역할 행위자(`actors[].actorUser`, `actorGroup`) |
| Jira | User → Group | A: 그룹 공간이 넷(`Group`, `GroupDetails`, `GroupName`, `FoundGroup`) |
| Jira | Group → 테넌트 (관리자) | D: `mypermissions`로 계산한 권한 |
| Okta | Application → User | A: `AppUser.userId`(D5)와 사용자 공간 |
| Okta | ApiToken → NetworkZone 2 | B: `network.include` 예시 값이 대상을 못 정한다 |
| Okta | Policy → Group 2, PolicyRule → Group, User, NetworkZone 6 | B: 조건의 `include`, `exclude` 배열에 예시 값이 없다 |
| Okta | UserType → User | B: `type.id`의 접두사(`oty`) 키 값이 2개뿐이라 배우지 못했다 |
| Salesforce | ConnectedApp → User | B: Cartography는 `OAuthToken` sObject로 잇는데 받은 object reference에 `OAuthToken`이 없다 |
| Salesforce | UserRole → UserRole (상위 역할) | B: `ParentRoleId`가 reference인데 원문에 Refers To가 없다(hole) |
| Slack | usergroup → channel | A: `objs_subteam.channels`는 `objs_channel`을 가리키는데 Cartography 채널은 `200.channel`로 잡힌다. 채널 공간이 갈려 있다 |

## 3. aegi-schema Profile 대조 (참고)

| provider | 있음 | 대상 모름 | 대상이 다른 공간 | 필드를 못 찾음 |
| --- | --- | --- | --- | --- |
| Slack | 8 | 5 | 1 | 6 |
| Okta | 2 (+대상 Profile 없음 4) | 4 | 1 | 4 |
| GitHub, Google | 0 | 5 | 0 | 1 |

「필드를 못 찾음」 대부분은 대조 쪽 한계다. SCIM 응답 경로(`groups[].value`), 조합 레코드가 출처인 Profile(Slack `role_assignment`), Okta `_embedded` 확장 필드는 지금 방식으로 따라가지 못한다. 「대상이 다른 공간」 둘(Slack 사용자 그룹 → `objs_subteam`과 `Groups`, Okta app_user → `AppUser`)은 원인 A와 같은 중복이다. 「대상 모름」(Okta `manager`, `type.id`, Google 역할 배정의 `assignedTo`, `roleId`, Slack 워크플로의 `app`, `triggers`)은 원인 B다.

## 4. 조사 중 고친 지도 규칙

| 규칙 | 전 | 후 |
| --- | --- | --- |
| 문자열 ID 배열 | 값 판정(`walk`)과 정보 항목(`props_of`)에서 버렸다 | 원소마다 그 필드의 값으로 본다. Okta `groupIds` → 그룹, Slack `members` → 사용자 |
| 학습한 접두사 | 원문 ID 형식이 없으면 참조 대상을 못 정했다 | 공간 자기 키 값에서 접두사(3글자)를 배운다. 조건: 그 공간 키 값의 80% 이상이 같은 접두사, 실측 값이 있거나 서로 다른 값 5개 이상, 숫자와 URL 제외, 전역 단건 위치가 있는 공간만. 여러 공간이 같은 접두사면 다형 참조(Okta `0oa` → 앱, IdP, 로그 스트림, API 서비스 통합) |
| 공간의 자기 키 필드 | 위치로 선 공간인데 원문이 키 필드를 말하지 않으면 키 값이 없었다 | Jev 「자기 식별자 필드」 판정(0.7 이상). Okta 169, GitHub 132, Jira 60, Slack 10, Atlassian 1 공간 |

Okta 학습 접두사 20개(예: `00u` 사용자, `00g` 그룹, `nzo` 네트워크 영역, `00T` API 토큰, `0pr` 그룹 규칙). Okta 참조 대상이 정해진 자리가 2 → 157개, 지도 참조 간선이 397개가 됐다. 두 번 돌려 8개 지도의 sha256이 같다.

학습 접두사의 한계: 원문 형식이 아니라 값에서 배운 것이다. 문서 자리 표시(`abc...`)는 실측 값이나 값 5개 조건으로 걸렀지만 완전하지 않다. `verify.learned_prefix`에 남긴다.

## 5. 다음 작업 (2단계 안)

1. 중복 공간 판정 (원인 A, 12개): 위 신호 다섯 가지로 같은 대상인 공간 묶음을 만들고, 같은 대상이면 relation을 한 쪽으로 모은다. 같은 접두사 키 값(Okta `00u`가 13개 공간)과 GraphQL node_id 해독은 결정론 근거, format_twins와 기존 중복 후보는 Jev로 확인한다.
2. 대상 모름 참조 (원인 B, 13개): Jev 필드 대상 판정을 넓힌다. 선택지는 학습 접두사 공간과 전역 공간.
3. 다형 참조 (원인 C, 5개): 판별 필드(`type`)의 원문 enum 값과 대상 공간을 잇는다.
4. D, E는 지도 밖으로 두고 3, 4단계에서 다룬다.


## 6. 중복 공간 판정 (`dup_audit.py`)

### 6.1 신호와 판정

| 신호 | 근거 | 세기 |
| --- | --- | --- |
| S1 node_id | GitHub REST 예시의 node_id를 해독한 GraphQL 타입 | REST 공간의 node_id가 한 타입으로만 풀리면 강함, 여러 타입이면(다형, `simple-user`는 User, Organization, Team) 후보 |
| S2 같은 키 값 | 두 공간의 자기 키 값이 같다 | 실측 값이 겹치면 강함, 문서 예시만 겹치면 후보. 부모 안 공간(키가 부모마다 따로)과 D5 연결 레코드(키가 상대 id)는 뺀다 |
| S3 D5 대상 | D5로 세운 대상의 연결 레코드 키 값이 다른 공간의 원문 또는 학습 형식에 맞는다 | 강함. 못 정하면 Jev Choice(전역 공간 중 하나, none) 0.7 이상 |
| S4 형식 쌍 | Jev 키 예시 값이 다른 공간의 원문 ID 형식에 맞는다 | 후보 |
| S5 기존 규칙 | map3 중복 후보(값 쌍, 왕복) | 후보 |
| S6 같은 접두사 | 학습 접두사 키 값을 가진 다른 공간 | 후보 |

후보는 Jev 네 진술로 확인한다. 판정은 「같은 대상」 0.8 이상이고 「하위 유형」 0.6 미만일 때 같음이다. 「같은 id로 식별된다」 진술은 공간 설명에 id 필드가 드러나지 않아 같은 대상이 확실한 쌍(GitHub Team과 team-full, 같은 대상 0.93)도 0.41이 나와 판정에서 뺐다. 네 진술 합친 값은 기록으로 남긴다.

묶을 때는 강한 근거부터 묶고, 「다름」으로 판정한 두 공간이 한 묶음에 들어가게 되는 합치기는 하지 않는다(`same_refused`).

### 6.2 결과

| provider | 판정한 쌍 | 같음 | 다름 | 보기나 하위 유형 | 합치기 거절 | 미정 | 묶음 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GitHub | 74 | 39 | 13 | 19 | 1 | 2 | 31 |
| Okta | 164 | 24 | 108 | 28 | 0 | 4 | 19 |
| Slack | 16 | 5 | 10 | 1 | 0 | 0 | 4 |
| Jira | 11 | 4 | 4 | 0 | 2 | 1 | 2 |
| Google | 8 | 3 | 0 | 0 | 0 | 5 | 1 |
| Confluence | 4 | 0 | 1 | 3 | 0 | 0 | 0 |

주요 묶음

| provider | 대표 공간 | 같이 묶인 공간 |
| --- | --- | --- |
| GitHub | `full-repository` | `team-repository`, GraphQL `Repository` |
| GitHub | `public-user` | `invitations`, GraphQL `User` (`simple-user`는 다형이라 따로) |
| GitHub | 그 밖 27개 | GraphQL 타입과 REST 공간 짝 (Issue, PullRequest, Commit 등) |
| Okta | `UserGetSingleton` (사용자) | `UserResponseSchema`, `AppUser.userId` |
| Okta | `Group` | `ApplicationGroupAssignment.groupId` |
| Okta | `AuthorizationServer` | MCP, API 서버의 `authorizationServerId` 3개 |
| Okta | 거버넌스 공간 짝 13개 | v1과 v2 명세가 같은 대상을 따로 정의 (`security-access-review`와 `_2` 등) |
| Slack | `200.conversations[*]` (채널) | `200.channel`, `objs_channel` |
| Slack | `objs_file` | `200.file` |
| Google | `User` | `LicenseAssignment.userId`, `Member.memberKey`, Postmaster `User_2.usersId` |
| Jira | `FoundGroup` | `GroupDetails`, `GroupName` |

### 6.3 알려진 오판과 한계

- Okta `Permission.permissionType`이 `IamRole`에 묶였다. 권한 종류(`okta.users.read`)는 역할이 아니다. Jev 판정(0.7 이상)의 오판이며 11.3절에서 수정했다.
- Slack 채널은 두 묶음으로 남았다(`200.conversations[*]` 묶음과 `200.channel|1` 묶음). 둘 사이는 Jev가 같은 대상 0.76이라 기준에 못 미쳤다.
- Google `Member.memberKey`는 사용자뿐 아니라 그룹도 될 수 있는데 사용자에 묶였다(다형).
- Jira `{}_2`(이름 없는 공간)가 `RemoteIssueLink`와 묶였다. 공간 이름을 정하지 못한 경우다.
- 고아 정보 세션 패치로 생긴 「부모로만 쓰이는 위치」 공간(Gmail `users/{}` 등 45개)은 아직 중복 신호에 들어가지 않는다.
- GitHub 정답표는 제가 만든 30쌍이다. 사용자 확인 전이라 정확도 수치는 잠정이다.

## 7. 사람 결정

아래 표의 「지금」은 결정 전 상태다. 세 권고 모두 승인됐으며 현재 판정은 7.1절을 따른다.

| 번호 | 질문 | 지금 | 권고 |
| --- | --- | --- | --- |
| Q1 | GitHub GraphQL `Team`은 `team-full`(조직 팀)과 `enterprise-team-with-member-count`(엔터프라이즈 팀) 중 어느 쪽과 같은가 | node_id 해독(S1)으로 엔터프라이즈 팀에 먼저 묶였고, Jev가 조직 팀과 같다(0.93)고 했지만 두 팀 공간이 「다름」이라 거절됐다 | 조직 팀. 엔터프라이즈 팀 예시의 node_id가 Team으로 풀린 것은 문서 예시 재사용으로 보인다 |
| Q2 | Jira 그룹 공간 넷(`Group`, `GroupDetails`, `GroupName`, `FoundGroup`)을 하나로 볼까 | `Group`만 따로(Jev가 `FoundGroup`과 다르다고 판정) | 하나로 본다. 모두 그룹 이름과 `groupId`로 같은 그룹을 가리킨다 |
| Q3 | Google Directory 그룹과 Cloud Identity 그룹을 같은 대상으로 둘까 | 신호가 없어 따로 | 같은 대상으로 둔다. 근거는 Google 문서(Cloud Identity 그룹 키가 그룹 이메일)라 원문 판단 근거로 기록한다 |

### 7.1 결정 (2026-10-18, 사용자: 권고대로)

Q1 GitHub GraphQL `Team` = `team-full`(조직 팀), 엔터프라이즈 팀과는 다름. Q2 Jira 그룹 공간 넷은 하나. Q3 Google Directory 그룹 = Cloud Identity 그룹. `candidate-extraction/ir2/same_entity_decisions.json`에 사람 결정(등급 human)으로 기록했고, `dup_audit.py`가 규칙과 Jev 판정보다 먼저 쓴다. 반영 뒤 Cartography 공간 쌍 대조는 67 → 71개(Google 그룹 회원과 소유자 4개). 이번 재생성에서도 세 결정과 Q1의 다름 조건을 모두 검사했다.

## 8. 고아 정보 세션에서 넘어온 항목 (2026-10-18, 1단계 문서 13절)

| 항목 | 내용 | 처리 |
| --- | --- | --- |
| parent_only 공간 45개 | 부모로만 쓰이는 위치 공간과 기존 공간의 같음. Gmail `users/{}`와 Directory `User`, chromemanagement, directory, cloudidentity의 `customers/{}`와 `Customer`, ASA `v1/teams/{}`와 OPA 팀, GitHub `enterprises/{}`와 GraphQL `Enterprise` | 중복 신호에 넣는다 (원인 A 다음 차례) |
| 복합키 자격증명 같은 종류 묶기 | 권고: 한 행 = 설치 × 자격증명 종류, 토큰 인스턴스와 회전은 상태와 이력 | 사용자 결정 대기 |
| Okta `OAuth2ClientSecret` | 앱 비밀값과 API 서비스 통합 비밀값이 한 공간(부모 두 종류) | 같은 공간 유지(권고, 근거 약함) |
| 목록 원소 relation 중 사건 기록 | GitHub 이슈 타임라인 원소가 relation이 됐다 | relation 대조에서 표시만, 3단계에서 거른다 |
| Slack canvas와 파일, `defs_app_id`와 앱 레코드 공간 | format_twins, ref_only 공간 | 6절 판정에서 Jev가 canvas와 파일은 「다름」(0.07). 앱은 신호가 없어 미판정 |

## 9. 복합키 자격증명을 「설치 × 자격증명 종류」 한 행으로 (2026-10-18)

사용자 결정(1단계 문서 13.6): 한 행 = 설치 × 자격증명 종류, 토큰 인스턴스와 회전은 그 행의 상태와 이력. `dup_audit.py --credentials`, 결과는 `out2/<p>/map/credential_rows.json`.

묶는 규칙

1. 종류 = 발급 계열 × 값 접두사의 기본형. 발급 계열은 RPC 메서드 이름의 첫 조각(`oauth`, `tooling`, `openid`, `apps`)이나 REST 경로의 마지막 글자 조각. 접두사는 회전 표시(`xoxe.`)를 뗀다. 같은 `xoxp`라도 `tooling` 계열은 앱 설정 토큰, `oauth` 계열은 사용자 토큰이다. 접두사가 없으면 값 자리 이름(`client_secret`, `url`)을 쓴다.
2. 갱신 토큰(`refresh_token`, `xoxe-`)은 같은 레코드에 있는 접근 토큰 행의 상태다.
3. 키 없는 자리(토큰 회전 응답)는 같은 종류에 키 있는 자리가 있으면 그 행의 상태와 이력이다.

결과: Slack 복합키 16개 → 9행, Okta 4개 → 1행.

| provider | 행 | 행을 이루는 자리 | 상태와 이력 | 키 |
| --- | --- | --- | --- | --- |
| Slack | 봇 토큰 (`oauth:xoxb`) | `oauth.v2.access.access_token`, 구형 `oauth.access.bot.bot_access_token` | 봇 갱신 토큰 | 앱, 팀, enterprise, 봇 사용자 |
| Slack | 사용자 토큰 (`oauth:xoxp`) | `oauth.v2.access.authed_user.access_token`, `oauth.v2.user.access.access_token` | 사용자 갱신 토큰, 회전 응답 2 | 앱, 팀, enterprise, 사용자 |
| Slack | 구형 설치 토큰 (`oauth:xoxa+xoxp`) | 구형 `oauth.access.access_token` | | 앱, 팀, 사용자 |
| Slack | incoming webhook (`oauth:url`) | 구형 `oauth.access.incoming_webhook.url` | | 앱, 팀, 사용자 |
| Slack | 앱 설정 토큰 (`tooling:xoxp`) | `tooling.tokens.rotate.token` | 갱신 토큰 | 팀, 사용자 |
| Slack | Sign in with Slack 토큰 (`openid:xoxp`) | `openid.connect.token.access_token` | | 키 없음 |
| Slack | 앱 비밀값 3행 | `apps.manifest.create`의 `client_secret`, `signing_secret`, `verification_token` | | 앱 |
| Okta | OAuth 토큰 (`token:access_token`) | 사용자 정의 인가 서버 `tokenCustomAS.access_token` | 기본 인가 서버의 접근 토큰, 갱신 토큰 2 | 인가 서버(`parent:oauth2/{}`, 고아 정보 세션 패치의 부모 위치 공간) |

한계

- Okta 기본 인가 서버(`/oauth2/v1/token`)의 토큰은 키가 없어 사용자 정의 인가 서버 행의 상태로 들어갔다. 실제로는 다른 인가 서버다.
- 구형 `oauth.access`는 `xoxa`(폐지된 워크스페이스 앱 토큰)와 `xoxp`가 한 자리에 섞여 있어 따로 한 행이다.
- 봇 토큰 키의 「봇 사용자」는 `bot_user_id`가 사용자 공간(`200.self`)을 가리켜서 잡혔다. 사용자 토큰과 키 공간 구성이 같아 보이지만 자리(필드)가 다르다(`key_fields`).

## 10. 원인 B 재개 결과 (2026-10-18)

### 10.1 고친 규칙

| 문제 | 수정 |
| --- | --- |
| `AccessPolicyRule` 등 하위 모양에 기반의 discriminator 표가 상속돼 형제 모양을 반복 방문 | 판별자 표에 나오면서 해당 기반을 `allOf`로 직접 가지는 모양만 확장한다. 별도 단건 위치를 가진 공간의 약한 병합 거절은 유지한다 |
| 같은 속성 경로에서 첫 하위 모양의 property가 다른 하위 모양의 참조를 가림 | 원본 슬롯과 역할을 보존한다. 같은 정보 항목에 대상이 여럿이면 대상 집합으로 남긴다 |
| 요청 예시를 응답 모양으로 읽고 스키마와 속성 예시를 참조 판정에서 놓침 | IR의 `of.shape`, `of.prop`, 요청 상태와 응답 상태를 따라 실제 자리로 읽는다. ID 형식에 맞는 대문자 ID는 예약 상수로 버리지 않는다 |
| Jev 결과가 URL 값 규칙보다 먼저 적용되고 후보를 다시 수집할 때 자기 결과가 입력을 바꿈 | 모든 값 규칙 뒤에 Jev 참조를 적용한다. 후보 수집은 앞선 Jev 참조를 제외한 상태로 고정한다 |
| 일부 모양 재시도나 통신 실패가 완료한 판정을 지울 수 있음 | `reffields --shapes ... --targets ...`로 범위를 한정하고, 두 단계 응답이 완료된 항목만 갱신한다. 나머지 판정과 캐시는 보존한다 |

### 10.2 Okta 판정과 남은 원인 B

정책의 그룹 참조와 규칙의 그룹, 사용자 참조가 지도에 도달하면서 공간 쌍 대조 6개가 늘었다. 네트워크 조건 2개는 공개 필드 이름과 문서 예시로 Jev에 추가 판정했다. 대상 선택지는 이번 조사 범위의 `NetworkZone`, `UserType`, `UserGetSingleton`, `Group`과 `none`이며, 원문 확정이 아닌 model 등급이다.

| 필드 | 다른 대상의 ID 확률 | 대상 선택 확률 | 처리 |
| --- | --- | --- | --- |
| `PolicyNetworkCondition.include` | 0.81 | NetworkZone 0.94 | model 참조 |
| `PolicyNetworkCondition.exclude` | 0.75 | NetworkZone 0.92 | model 참조 |
| `UserCondition.include` | 0.76 | UserGetSingleton 0.87 | model 참조 |
| `AuthorizationServerPolicyRuleUserCondition.include` | 0.72 | UserGetSingleton 0.90 | model 참조 |

기준은 두 단계 모두 0.7 이상으로 유지했다. 공개 필드 판정 추가 요청은 6건이며, 테넌트 실측 값은 보내지 않았다. 원문의 네트워크 예시에 사용자 ID와 네트워크 영역 ID가 섞여 있어 값 규칙만으로 대상을 확정하지 않았다.

| 남은 Cartography 항목 | 수 | 근거와 다음 조치 |
| --- | --- | --- |
| ApiToken → NetworkZone | 2 | 별도 모양 `ApiToken.network`의 include 0.46, exclude 0.29로 기준 미달. 같은 이름의 정책 조건에서 결과를 복사하지 않는다. 원문 참조 선언이나 실측이 필요하다 |
| UserType → User | 1 | `User.type.id` 0.49, `UserGetSingleton.type.id` 0.39. `oty` 키 예시가 부족해 학습 접두사도 정하지 못했다 |
| Salesforce ConnectedApp → User | 1 | 대조가 쓰는 `OAuthToken` sObject가 받은 원문에 없다. 수집 보강이 필요하다 |
| Salesforce UserRole → 상위 UserRole | 1 | `ParentRoleId`의 원문 Refers To가 비어 있다. 원문 참조 선언이나 실측이 필요하다 |

원인 B 13개 중 공간 쌍 기준 8개를 해소하고 5개를 보류한다. 정책의 `include`와 `exclude`는 같은 공간 쌍으로 집계되므로 세부 관계 의미의 검증은 별도 과제다. 원인 C의 판별값 기반 다형 참조 구현은 이번 범위에서 진행하지 않았다.

### 10.3 대조와 검증

| provider | 있음 | 빠짐 | 노드 미매핑 |
| --- | --- | --- | --- |
| GitHub | 35 | 12 | 16 |
| Google | 4 | 5 | 1 |
| Jira | 4 | 6 | 0 |
| Okta | 22 | 3 | 4 |
| Salesforce | 5 | 2 | 0 |
| Slack | 9 | 0 | 0 |
| 합계 | 79 | 28 | 21 |

8개 지도를 재생성했다. 회귀 검사 `test_map3.py` 9개는 판별자 확장, 원본 슬롯 보존, 별도 위치 병합 거절, 요청과 스키마 예시 자리, 값 규칙 우선순위, 미완료 재시도 보존과 실제 Okta 참조 도달을 검사한다. 재생성 해시와 IR 검증 결과는 `out2/stage2_verification.json`에 남긴다.

추가 승인 전에는 중복 공간을 로컬 캐시로 다시 대조했다. 입력이 바뀌어 새 캐시가 없는 Okta 쌍 19개는 pending으로 남았고, 단일 대상 미정은 10개였다. 자동 승인 검토가 중복 후보 추가 전송을 실측 식별자 노출 가능성 때문에 거절해 당시 요청은 실행하지 않았다. 이후 사용자 승인과 완료 결과는 10.4~10.5절에 기록한다. Q1~Q3은 계속 사람 결정으로 적용한다.

### 10.4 중복 후보 전송 준비와 승인 상태 (2026-10-18)

사용자는 「명시적으로 승인, 크레덴셜 원문이 아니면 진행」으로 전송 범위를 승인했다. 전송 본문은 API 경로 템플릿, 스키마명, 필드명과 판정 질문으로 제한했다. `duplicate_state`가 신호 설명에서 추출한 문자열을 양쪽 스키마의 실제 필드 이름과 대조하므로 예시 ID와 자격증명 값은 본문에 들어가지 않는다. 인스턴스 값 자체를 보내지 않는다.

본문 필터 변경으로 캐시 키가 바뀌는 항목을 포함해 전송 대기는 52건이다. 정확한 요청 본문은 `out2/okta/map/dup_send_payloads.json`, 목적지와 해시 검토 기록은 `dup_send_review.json`이다. 추가 회귀 검사로 원문 필드 이름은 유지하고 예시 ID와 자격증명 값은 제외하는지 확인했다(전체 10개 통과).

목적지 `https://api.typesafe.ai/v1/systemone`으로 실행을 시도했으나, 자동 승인 검토가 「목적지와 구체적 payload의 명시 승인 부재」를 이유로 다시 거절했다. 당시 요청은 전송되지 않았고 적용 중인 중복 판정은 준비 전 결과로 유지했다. 이후 목적지, 본문 범위와 건수를 명시한 질문에 사용자가 「해당 목적지와 전송 내용 승인」으로 답했고, 이 승인으로 전송을 진행했다.

### 10.5 승인 후 중복 판정 완료 (2026-10-18)

준비한 52건을 Jev에 전송해 52건 모두 응답을 캐시했다. 크레덴셜 원문과 인스턴스 값은 본문에서 제외했다. 각 요청 본문의 해시가 검토 파일과 같고 해당 해시의 응답이 캐시에 있는지 검사했다. 전송 기록은 `out2/okta/map/dup_send_review.json`을 따른다.

| 항목 | 결과 |
| --- | --- |
| Okta 판정 행 | 160개 |
| 같음 | 24개 |
| 다름 | 104개 |
| 보기나 하위 유형 | 28개 |
| 확률 기준 미달 | 3개 |
| 기존 공간 없음 | 1개 |
| 응답 대기 pending | 0개 |
| 같은 대상 묶음 | 17 → 19개 |
| Cartography 공간 쌍 대조 | 79개 유지 |

주요 보강은 인가 서버 연결 레코드 3종을 `AuthorizationServer`로 모으고, `my-resource-connections.agentId`를 `AIAgent` 묶음에 넣은 것이다. 판정은 기존 model 기준을 유지했다. 아래 셋은 기준에 못 미쳐 합치지 않았다.

| 자리 | 선택 결과 | 확률 |
| --- | --- | --- |
| `ResourceSetBindingMember.memberId` | none | 0.50 |
| `Subscription.notificationType` | none | 0.61 |
| `User.user_name` | Client | 0.33 |

`server_users.user_name`은 none 0.75로 「기존 공간 없음」이다. 기존 오판인 `Permission.permissionType` → `IamRole`도 0.76으로 다시 나왔다. 당시 자동 결과에 남았던 이 오판은 11절에서 원문 다름 근거로 고쳤다.

검증: 회귀 검사 10개 통과. 네트워크 호출 없이 서로 다른 해시 시드 두 개로 다시 생성한 Okta 중복 판정 파일의 해시가 같다. 기존 지도 파일 24개의 해시는 변경되지 않았다. Q1~Q3의 같음과 Q1의 다름 조건도 유지한다. Cartography와 Profile 대조를 다시 실행했으며 수치 변동은 없다. 원인 B의 미해결 5개는 10.2절을 따른다.

## 11. 원인 B 마무리, 오판 수정과 원인 C 구현 (2026-10-19)

### 11.1 출처가 명시한 참조를 적용하는 방식

`source_reference_facts.json`에 기존 원문의 참조 14개와 다름 근거 1개를 출처 ID, 위치와 스냅샷 해시로 고정했다. 설명문 전체를 자동 해석하는 규칙은 추가하지 않았다. 명시된 문서 단락을 전사한 항목만 `stated` 참조로 적용하며, 근거 스냅샷이나 모양, 필드, 대상이 달라지면 실패한다. 제공자나 필드 이름의 유사도로 추론하지 않는다.

조건부 참조는 `cases`에 판별 경로, 값과 대상을 남긴다. 실제 레코드를 해석할 때는 일치한 분기만 고르고, 배열은 같은 원소의 판별값과 참조값을 대조한다. 정보 항목에도 출처와 위치를 보존한다. 원문 참조는 값 규칙과 모델 판정보다 우선하지만 사람 결정 파일과 섞지 않는다.

### 11.2 남은 원인 B 5개의 처리

| 항목 | 처리 | 근거 |
| --- | --- | --- |
| ApiToken → NetworkZone 2개 | include, exclude를 원문 참조로 반영 | Okta 명세 `ApiToken.network`가 각각 포함, 제외 IP 네트워크 영역 목록으로 선언한다. [공식 API 문서](https://developer.okta.com/docs/reference/api/api-tokens/) |
| UserType → User 1개 | `User.type.id`, 상속된 `UserGetSingleton.type.id`의 대상을 UserType으로 반영 | 기존 명세 `User.type`이 User Types API를 연결하며 내부 id의 뜻을 명시한다. `UserGetSingleton`은 원문 allOf 상속을 따른다 |
| UserRole → 상위 UserRole 1개 | ParentRoleId의 자기 공간 참조를 반영 | 수집한 Salesforce Object Reference의 UserRole 절에서 부모 역할 ID라고 명시한다. 일반 자기 키 Id와 구분해 참조 간선에 센다 |
| ConnectedApp → User 1개 | 원인 D로 정정, 직접 ID 참조는 생성하지 않음 | 고정한 Cartography 커밋은 ConnectedApplication.Name과 OauthToken.AppName을 조인한다. [원본 구현](https://github.com/cartography-cncf/cartography/blob/d9944394187c405182145f982b3d26433e8cfd76/cartography/intel/salesforce/connectedapps.py) |

앞서 「OAuthToken을 수집하지 않았다」고 적은 판단은 틀렸다. 수집한 원문과 IR에는 `OauthToken`이 이미 있고, AppMenuItem과 User를 가리키는 Refers To도 있다. 대소문자로 찾으면서 놓쳤다. Cartography의 앱과 사용자 연결은 AppName 기반 조인이므로 단순 ID 참조 대상을 채우는 문제로 해결할 수 없다. 비교 노드도 OauthToken을 ConnectedApplication과 같은 개체로 취급하지 않도록 수정했다.

범위로 정한 B 13개는 직접 공간 쌍 12개와 D로 정정한 1개로 정리했다. 마지막 1개는 직접 참조가 해소된 수에 포함하지 않는다. 이름 조인 조건과 이름 변경, 중복 이름의 처리는 원인 D 설계에서 다룬다.

### 11.3 Permission과 IamRole 오판 수정

Okta 원문은 경로의 `roleIdOrLabel`과 `permissionType`을 별도 값으로 선언한다. `permissionType`은 Okta 권한이며 IamRole의 ID가 아니다. 이 원문 다름 근거로 Permission 공간과 그 D5 대상 `Permission.permissionType`이 IamRole과 합쳐지는 것을 막았다. 이전 모델 응답 0.76은 캐시와 판정 행에 보존하고, 최종 판정의 근거를 `stated`로 기록한다.

Okta 판정 행은 161개, 같음 23, 다름 106, 보기나 하위 유형 28, 미정 3, 기존 공간 없음 1이다. 묶음은 19개를 유지하지만 잘못 포함됐던 `Permission.permissionType`은 역할 묶음에서 빠졌다. Q1~Q3의 사람 결정은 그대로다.

### 11.4 원인 C: 판별값 기반 다형 참조

| 원문 위치 | 조건 | 대상 | 대조에서 해소한 수 |
| --- | --- | --- | --- |
| PermissionHolder.value, parameter | type = group, user, projectRole | Group, User, ProjectRole | PermissionGrant 관계 3개 |
| RoleActor.actorGroup.groupId | type = atlassian-group-role-actor | Group | ProjectRole 관계 1개 |
| RoleActor.actorUser.accountId | type = atlassian-user-role-actor | User | ProjectRole 관계 1개 |

[Jira 공식 Holder 표](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-permission-schemes/#holder-object)와 기존 명세의 RoleActor enum, ProjectRoleGroup, ProjectRoleUser 정의를 따른다. group의 parameter는 이름이고 value는 ID라는 차이도 `key_kind`로 남긴다. 두 값이 같다고 가정하지 않는다.

anyone, assignee, projectLead와 custom-field 유형은 위 세 대상의 직접 ID로 처리하지 않는다. 미지의 type이나 type 누락도 대상 없음으로 남긴다. RoleActor 배열에서는 한 원소의 그룹 조건이 다른 원소의 사용자 필드에 적용되지 않도록 검사한다.

RoleActor 자체의 공간은 유지한다. 원문이 명시한 `ProjectRole.actors[*]` 연결 경로만 ProjectRole의 관계로 투영하며 일반적인 간선 전이 규칙은 추가하지 않았다. Cartography의 JiraPermissionGrant 노드는 응답 루트 PermissionScheme이 아니라 실제 `permissions[*]` 레코드의 PermissionGrant 공간에 매핑했다.

### 11.5 최신 대조와 검증

| provider | 있음 | 빠짐 | 노드 미매핑 |
| --- | --- | --- | --- |
| GitHub | 35 | 12 | 16 |
| Google | 4 | 5 | 1 |
| Jira | 9 | 1 | 0 |
| Okta | 25 | 0 | 4 |
| Salesforce | 6 | 1 | 0 |
| Slack | 9 | 0 | 0 |
| 합계 | 88 | 19 | 21 |

대조는 ID 공간 쌍 기준이며 관계 방향과 모든 include/exclude 의미를 검증한 수는 아니다. 이번 원인 C의 분기 조건은 별도 회귀 검사와 지도 `cases`로 검증한다. 추가 Jev 요청은 없다.

회귀 검사 20개와 8개 provider IR 검증을 통과했다. 서로 다른 해시 시드에서 지도 파일 24개와 Okta 중복 판정, Cartography 노드 대조, relation 대조, Profile 대조 4개를 재생성해 28개 파일의 일치를 확인했다. 여러 공간 쌍이 동시에 맞는 대조 결과도 정렬해 출력 순서를 고정했다. 최신 수치, 해시와 검사 결과는 `out2/stage2_verification.json`에 남겼다.


## 12. 잔여 42개 조사와 실행 범위 (2026-10-19)

### 12.1 결론과 수치 정정

직접 쌍이 없던 40개를 조사하면서 직접 쌍으로 잘못 세던 2개도 발견했다. `GitHubContainerImage`는 OCI manifest digest, `GitHubContainerImageTag`는 태그 URI를 키로 쓴다. GitHub API의 패키지 버전 `id`와 같은 대상으로 매핑한 것이 잘못이었다. 이미지와 패키지, 태그와 패키지 두 간선을 직접 쌍에서 빼고 레지스트리 수집 계약으로 옮겼다. 따라서 88 → 86은 정확도 보정이며 관계 두 개를 모델에서 삭제한 것이 아니다.

`GitHubRulesetRule`은 응답 전체 `repository-ruleset` 대신 GraphQL `RepositoryRule`에 대응시켰다. REST `rules[]`에 원문 ID가 없으면 규칙 집합 맥락, 원소 위치와 내용 해시를 합성키로 쓰되 순서 변경 뒤의 동일성을 주장하지 않는다. SAML `ExternalIdentity`와 SCIM `User`의 근거 없는 같은 대상 대응도 제거했다.

| provider | 직접 쌍 있음 | 직접 쌍 빠짐 | API 노드 미매핑 | D 생성 규칙 | E 수집과 생성 규칙 |
| --- | --- | --- | --- | --- | --- |
| GitHub | 33 | 8 | 22 | 9 | 21 |
| Google Workspace | 4 | 5 | 1 | 6 | 0 |
| Jira | 9 | 1 | 0 | 1 | 0 |
| Okta | 25 | 0 | 4 | 1 | 3 |
| Salesforce | 6 | 1 | 0 | 1 | 0 |
| Slack | 9 | 0 | 0 | 0 | 0 |
| 합계 | 86 | 15 | 27 | 18 | 24 |

대조 분모는 기존과 같은 비테넌트 간선 클래스 128개다. D는 구조화된 응답 투영, 요청 맥락, 조인과 전이 연산이고 E는 파일, 레지스트리나 다른 시스템의 자료가 필요한 관계다. D 18 + E 24는 빠짐 15 + 노드 미매핑 27과 같은 42개를 다른 축으로 나눈 값이다. 직접 쌍 있음 86개는 종전처럼 공간 쌍의 존재만 확인한 것으로, 관계별 방향과 의미 전체를 검증한 수가 아니다.

### 12.2 근거가 고정된 처리 대장

`relation_contracts.py`는 고정 Cartography 커밋 `d9944394187c405182145f982b3d26433e8cfd76`의 모델 선언과 실제 변환 함수에서 관계를 전사한다. 공개 소스 스냅샷과 라이선스는 `collect/carto/snapshot/`, 파일 해시는 `snapshot_manifest.json`에 있다. 파일 해시나 지정한 클래스, 함수가 바뀌면 생성에 실패한다. 원문을 실행하거나 원문 전체를 모델에 보내지 않는다.

각 행에는 provider, 출처 노드, 간선 종류, 대상 노드, 클래스, 실제 방향, 연산, 입력 ID, 규칙, 보류 조건과 출처 위치를 둔다. `rel_audit.json`의 `resolution`에도 같은 판정을 붙인다. `status=found`로 덮어쓰지 않으므로 계약 정의와 실제 직접 관계를 혼동하지 않는다. 새 누락 간선에 처리 계약이 없으면 실패한다.

전체 42개 대장과 입력 38종의 수집 위치는 [처리 대장] (`candidate-extraction/ir2/out2/relation_resolution.md`, git에 없는 산출물), 자세한 출처와 해시는 [JSON] (`candidate-extraction/ir2/out2/relation_resolution.json`, git에 없는 산출물)이다. 대장의 `definition_status=source_backed`는 원문 근거가 있다는 뜻이고 `observation_status=not_collected`는 실제 테넌트 입력을 수집하지 않았다는 뜻이다.

| 관계 묶음 | 근거와 보류 조건 |
| --- | --- |
| GitHub 브랜치 보호, 외부 ID, 팀, 언어 | 저장소 맥락, `ExternalIdentity.user.url`, 조직 팀의 `childTeams`, 언어 이름 키를 보존한다. 언어 응답의 바이트 수를 ID로 읽지 않는다 |
| GitHub manifest와 dependency | manifest 키는 저장소와 파일 경로, dependency 키에는 생태계를 포함한다. 버전 범위는 확정 버전으로 바꾸지 않는다 |
| Google 그룹과 상속 | GROUP 종류와 이메일 별칭을 같은 고객 안에서 해소한다. 소유 상속은 `OWNER_OF` 뒤에 `MEMBER_OF+`가 오는 경로만 허용한다. 임의의 소유 연쇄는 허용하지 않는다 |
| Google 장치와 OAuth 앱 | 장치 resource name과 deviceId를 구별한다. APPROVED 사용자 여러 명의 소유 판정은 순서 근거가 없으면 보류한다. OAuth 앱 키는 토큰 레코드의 `clientId`이고 사용자 키는 요청 맥락이다 |
| Jira 관리자 그룹 | `group/bulk?accessType=admin`과 `site-admin`의 전체 페이지가 근거다. `mypermissions`는 수집자의 권한 검사일 뿐 관리자 그룹 목록을 말하지 않는다 |
| Okta ReplyUri, Salesforce 앱 사용자 | URI 값을 그대로 보존한다. Salesforce는 같은 조직과 스냅샷의 이름 조인이며 앱 이름이 중복이면 여러 앱에 퍼뜨리지 않는다 |
| 워크플로, CODEOWNERS, Python dependency | 파일과 저장소, ref, 내용 해시가 필요하다. 워크플로는 표현식을 실행하지 않고 비밀값 이름만 읽는다. CODEOWNERS는 파일 우선순위와 마지막 일치 규칙, 소유자 없는 덮어쓰기를 지켜야 한다. Python 파일을 실행하거나 패키지를 설치하지 않는다 |
| OCI 이미지, 태그, 레이어 | manifest/config 원문 digest를 검증한다. 압축 blob digest와 비압축 `diff_id`는 다른 키다. 레이어 순서만으로 부모 이미지를 추론하지 않는다 |
| Attestation, PACKAGED_FROM, PACKAGED_BY | subject와 digest를 묶고 서명 검증 여부를 별도로 기록한다. DSSE 해독은 서명 검증이 아니다. Dockerfile 유사도와 패키지 소유자 fallback은 provenance와 구별한다 |
| AWS 계정과 역할 | 별도 AWS 인벤토리, Okta AWS 앱 배정과 조직별 매핑 설정이 필요하다. 그룹 이름만 보고 역할을 만들지 않는다. ARN 전체를 확인한다 |

팀의 `MEMBER_OF_TEAM`과 `MEMBER_OF`, Okta AWS 역할의 `ALLOWED_BY`와 `HAS_ROLE`은 각각 구형 호환 간선과 새 간선이다. 기준 대조에서는 네 클래스를 유지하고 의미상 두 관계라는 사실을 `alias_group`으로 기록했다.

추가 한계도 확인했다. 현재 GitHub attestation 변환 함수는 `parent_image_digest=None`을 기록하므로 모델에 `BUILT_FROM` 선언이 있다는 이유만으로 실제 부모 이미지 관계가 만들어진다고 볼 수 없다. 외부 base-image 근거가 필요하다. `bundle_url`만 있는 지연 bundle도 현재 원문의 inline 변환으로 처리되지 않는다.

### 12.3 중복 미정과 기존 공간 없음의 정리

`source_reference_facts.json`에 D5 승격 보정 4개를 출처 해시와 함께 추가했다. 모델 응답 캐시는 지우지 않았다.

| 기존 자리 | 원문 판정 | 반영 |
| --- | --- | --- |
| `ResourceSetBindingMember.memberId` | 경로가 가리키는 binding-member 레코드 자신의 ID | 별도 대상 승격을 취소하고 원래 레코드를 유지 |
| `Subscription.notificationType` | `NotificationType`의 닫힌 enum | 별도 ID 대상으로 승격하지 않음 |
| `User.user_name` | ASA 팀 안 User를 username으로 주소 지정하는 자기 키 별칭 | 별도 대상으로 승격하지 않고 User 유지 |
| `server_users.user_name` | APIServerUser가 명시한 관련 User의 username | 같은 ASA 팀의 User 공간으로 원문 참조, `key_kind=name` 보존 |

Okta 판정은 같음 24, 다름 106, 보기나 하위 유형 28의 158행이고 같은 대상 묶음은 20개다. 미정과 기존 공간 없음은 모두 0개다. 과거 `none=0.75` 모델 응답도 `previous_jev_target`에 보존한다. Q1~Q3 사람 결정과 Permission/IamRole의 다름 판정은 유지했다. 테넌트 레코드에서 이름을 실제 사용자 UUID에 연결할 때는 같은 팀과 스냅샷에서 유일하게 맞는지 별도로 확인해야 한다.

### 12.4 구현과 검증 범위

`relation_ops.py`에 다음 로컬 연산을 구현했다. 네트워크, 운영 그래프 쓰기나 파일 실행은 없다.

- 테넌트와 스냅샷을 보존하는 유일 조인, 중복 이름의 보류와 Salesforce 사용자 → 앱 인가.
- 순환을 처리하는 그룹 상속과 소유 상속, Google OAuth 인가, Jira 관리자 그룹, Okta URI 투영.
- 워크플로 YAML의 literal action 참조와 비밀값 이름 추출. 주석, 표현식 안 문자열과 동적 인덱스는 실제 참조와 구별한다. 이름을 실제 secret metadata에 연결하는 단계는 별도다.
- OCI manifest와 config digest 검증, index의 이미지 포함 관계와 순서가 있는 레이어 구조.

이 연산이나 파서를 쓰는 계약은 13개다. 나머지 29개는 `implementation_status=collection_contract`로 표시하며, CODEOWNERS와 dependency 파일 수집, 외부 AWS 매핑, Dockerfile 점수 계산 등의 전체 수집기와 실행 어댑터를 구현 완료로 세지 않았다. 입력 38종도 실제 테넌트에서 받은 상태가 아니므로 전부 `not_collected`다. 현재 작업으로 완료한 것은 잔여 원인 조사, 타입 수준의 생성 규칙과 판정 보정이며, 42개를 실측 그래프에서 관측한 것은 아니다.

`verify_stage2.py`는 네트워크 호출 없이 지도 8개, Okta 중복 판정과 대조를 해시 시드 1과 2에서 다시 생성한다. 30개 파일이 바이트 단위로 같았고 모델 캐시는 변경되지 않았다. 회귀 검사 39개와 provider IR 검증 8개가 통과했다. 검사는 출처 변경, 새 미분류 간선, 잘못된 API 대응, 중복 키, 조직과 스냅샷 경계, 순환과 소유 연쇄, 동적 워크플로 참조, 변조된 manifest와 config, 레이어 수 불일치를 포함한다.

검증 결과는 [stage2_verification.json] (`candidate-extraction/ir2/out2/stage2_verification.json`, git에 없는 산출물), 직전 B/C 검증은 `stage2_verification_before_de.json`에 보존했다. 참고 Profile 대조는 다시 생성했으며, Profile 경로와 확장 응답을 따라가지 못하는 기존 한계는 3절대로 남아 있다. 대시보드 화면과 운영 데이터는 변경하지 않았고 추가 Jev 요청은 0건이다.

### 12.5 실행하려면 남아 있는 입력

실제 실행에는 대상 테넌트와 관측 스냅샷, API 전체 페이지, 고정 ref의 파일 본문, OCI manifest와 config, 기존 AWS 인벤토리와 조직별 매핑 설정이 필요하다. 계약의 `collection_plan`에 입력별 수집 위치를 기록했다. 임의의 테넌트를 골라 수집하거나 빠진 데이터를 예시로 만들어 관계가 생긴 것처럼 세지 않았다. 실제 자료가 없을 때의 결과는 0개 확정이 아니라 미수집이다.

출처 보조 확인: [GitHub CODEOWNERS 공식 문서](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners), [OCI image configuration 명세](https://github.com/opencontainers/image-spec/blob/main/config.md), [AWS ARN 공식 문서](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference-arns.html). 관계별 직접 근거는 처리 대장 JSON에 고정 커밋과 위치로 남겼다.
