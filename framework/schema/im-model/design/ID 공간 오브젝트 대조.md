# ID 공간과 오브젝트 대조 (2026-10-18)

## 요약

- 「ID 공간 = 오브젝트」로 놓고 확정 오브젝트 목록(`aegi-schema/data/AEGI_Object_List_Final_2026-09-20.xlsx`, Final_Reconciliation 후보 748건)과 맞췄다. 목록이 있는 SaaS는 GitHub, Okta, Slack, Google 넷이다.
- 후보와 공간은 이름이 아니라 근거 API로 이었다. 근거 API의 경로를 IR 동작의 경로 틀에 맞추고, Slack과 Google은 메서드 이름과 Discovery 메서드 id(같은 출처의 식별자)로 맞췄다. 조사 코드는 `candidate-extraction/ir2/object_audit.py`, 결과는 `ir2/out2/object_audit.json`이다.
- **누락**의 가장 큰 원인은 수집 범위다. Okta Privileged Access, Okta AI 에이전트와 MCP 서버 API, Google의 Discovery 문서 8종이 IR에 없다. 그다음은 규칙 빈틈으로, Slack RPC 레코드와 부모 아래 단일 하위 자원이다.
- **불필요**의 가장 큰 원인은 「키가 있으면 공간」이라는 기준이다. GitHub GraphQL 타입 281개가 공간이 됐다. 그다음은 설정과 하위 자원 공간, 목록이 일부러 제외한 대상(로그, 공개 데이터, 설정)이다. ID 공간은 오브젝트 후보의 상위 집합이고, 오브젝트가 되려면 기준이 더 필요하다.

| SaaS | 포함 후보 | 공간에 닿음 | 누락 | 한 공간에 포함 후보 여럿 | 공간 | 포함 후보가 안 닿은 공간 |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub | 64 | 58 | 6 | 7 | 460 | 393 (그중 GraphQL 타입 282) |
| Okta | 127 | 69 | 58 | 6 | 172 | 99 |
| Slack | 30 | 9 | 21 | 4 | 44 | 33 |
| Google | 60 | 37 | 23 | 2 | 69 | 31 |

Slack 포함 후보가 30인 것은 Final_Reconciliation 시트 기준이다(Slack 시트 57건과 수가 다르다. Slack 후보 원본은 별도 시트에 있다).

## 1. 누락 (포함 후보인데 공간이 아님)

| 원인 | 단계 | 사례 | 수 |
| --- | --- | --- | --- |
| 근거 API가 IR에 없음: 받지 않은 API | 수집 | Okta Privileged Access(`/v1/teams/{team_name}/…`: 서버, 프로젝트, 비밀, 게이트웨이 등), Okta resource-servers(MCP 서버, API 서버), workload-principals(AI 에이전트, 위임 링크), 다중 조직(`/{accountId}/api/v1/orgs`) | Okta 약 45 |
| | 수집 | Google Discovery 미수집: drivelabels, gmailpostmastertools, vault, forms, people, chromemanagement, meet, script | Google 약 16 |
| | 수집 | Slack 토큰(bot, user, app token)과 trigger: Web API 응답이 아니라 설치 시점 1회 값이나 감사 로그로만 보인다 | Slack 4 |
| 동작은 있으나 응답이 공간이 아님: RPC 레코드 | 규칙 | Slack bot, workflow, workflow-step, function, role-assignment, role, permission, datastore 등 | Slack 16 |
| | 원인 | 이 레코드들의 ID 접두사(`Wf`, `Fn`, `Rl`)는 원문 ID 정의(`defs_*`)에 없다. 사전의 추가 접두사(`extra_prefixes`)를 뺀 대가다. bot(`B…`)은 정의가 있으나 문서 응답 모양과 이어지지 않았다 | |
| 동작은 있으나 응답이 공간이 아님: 부모 아래 단일 하위 자원 | 규칙 | GitHub Branch Protection(`/repos/{o}/{r}/branches/{b}/protection`), GitHub Pages(`/repos/{o}/{r}/pages`). 경로 끝이 파라미터가 아니고 같은 경로에 GET, PUT, DELETE가 있다 | GitHub 2 |
| | 규칙 | Okta stream(SSF), AgentPool, OAuth2Client 목록: 원소 모양의 단건 위치가 없다 | Okta 3 |
| | 규칙 | Gmail 자동 전달과 IMAP 설정: 사용자 아래 단일 설정 | Google 2 |
| 근거 API가 비어 있음 | 비교 기준 | Okta Application, PolicyRule, team, EmailDomain, WorkloadRole. 공간은 있다(`apps/{}` 등). 목록 쪽 빈칸이다 | Okta 5 |

## 2. 한 공간에 포함 후보가 여럿 (합쳐짐)

| 공간 | 포함 후보 | 판단 |
| --- | --- | --- |
| GitHub `key` | Deploy Key, 사용자 SSH Key | 과합치기. 구조가 같은 다른 키 종류 |
| GitHub `release-asset` | Release, Release Asset | 과합치기. 릴리스와 첨부 파일 |
| GitHub `integration` | GitHub App, 사용자 정의 배포 보호 규칙(앱) | 과합치기. 보호 규칙의 응답이 앱을 박고 있어 근거 API가 앱 공간에 닿았다 |
| GitHub `enterprise-team-with-member-count` | Enterprise Team, Enterprise Role | 과합치기 의심 |
| GitHub `organization-custom-property` | 조직 사용자 정의 속성, 엔터프라이즈 속성 스키마 | 같은 대상의 두 범위일 수 있다 |
| GitHub `full-repository`, `simple-user` | Repository와 프로그램 접근 허용, User와 저장소 초대 | 비교 방법의 한계. 허용과 초대의 근거 API가 저장소, 사용자 목록을 돌려준다 |
| Okta `AppUser`, `ApplicationGroupAssignment` | 앱 할당과 User, Group | 비교 방법의 한계(할당 경로가 사용자, 그룹 위치를 지난다) |
| Slack 채널 공간 셋 | conversation, external-team | 채널 ID 형식 포함 관계(C ⊂ C, G, D)로 공간이 셋이다 |
| Okta `Group`, `Policy`, Google `Group` | 같은 이름 후보 두 행 | 목록에 같은 대상이 두 맥락으로 있다. 문제 아님 |

## 3. 불필요 (포함 후보가 닿지 않은 공간)

| 원인 | 단계 | 사례 | 수 |
| --- | --- | --- | --- |
| 원문 키만 있는 GraphQL 타입 | 규칙(공간 기준) | GitHub `AddedToMergeQueueEvent`, `AddedToProjectEvent` 등. `id: ID!`와 Node 구현이면 모두 공간이 된다. REST 동작이 돌려주지 않아 정보 항목도 거의 없다 | GitHub 281 |
| 설정과 하위 자원 | 오브젝트 기준 | GitHub `actions-policy`, Okta 브랜드 테마와 이메일 템플릿, 공격 방지 설정, 잠금 설정(단일 자원 16) | GitHub 60, Okta 37 |
| 목록이 일부러 제외하거나 보류한 대상 | 오브젝트 기준 | 로그와 기록(`hook-delivery`), 공개 데이터(`global-advisory`, `code-of-conduct`), 이주 작업(`migration`), 캐시, Google 도메인 별칭, 건물, 기능, 스키마, 데이터 이전, 알림 | GitHub 30, Okta 25, Google 22, Slack 3 |
| 값 정체성 공간의 값 객체 | 규칙 | Slack `activities[*]`, `created_entities[*]`, `policies[*]`, GitHub `commit.author`, `code-scanning-alert-instance` | Slack 25, GitHub 6, Okta 5 |
| 같은 대상이 두 공간 (중복) | 규칙 | GitHub `automations`와 `automations_2`, `tasks`와 `tasks_2`, `organization-simple` | 중복 후보 30쌍에 포함 |
| 원문 키만 있는 JWK 모양 | 규칙 | Okta `KeyEC`, `KeyRSA`, `ECKeyJWK` | Okta 11 |
| 목록 쪽 누락 | 비교 기준 | Google `Event`, `Message`, `Draft`는 공간이 있지만 목록 후보는 근거 API가 비어 있다(`NOT_IN_SOURCE`) | Google 3 |

## 4. 원인을 단계별로

| 단계 | 원인 | 고칠 곳 |
| --- | --- | --- |
| 수집 | 받지 않은 API: Okta Privileged Access, resource-servers, workload-principals, 다중 조직. Google Discovery 8종 | 수집 범위(1절 결정: Okta 전부, Google 전부)에 맞게 받는다. 되먹임 대기열에 올린다 |
| 정규화 | Google 경로 틀이 서비스 경로를 떼어 서로 다른 API 경로가 겹쳤다(Groups Settings가 `{groupUniqueId}`만 남음) | 2026-10-18 고침: 경로 틀 = API 이름 + 서비스 경로 + flatPath |
| 규칙 | 원문 키만 있으면 공간이 된다(GraphQL 타입 281, JWK 11) | 「원문 키만」 공간은 타입 목록으로 두고, REST 위치나 응답, 참조로 닿을 때만 오브젝트 후보로 올린다 |
| 규칙 | 부모 아래 단일 하위 자원(branch protection, pages, Gmail 설정)을 공간으로 못 만든다 | 위치 있는 경로에 GET과 쓰기가 함께 있고 경로 끝이 파라미터가 아니면 부모 안 단일 자원 |
| 규칙 | Slack RPC 레코드의 ID 형식이 원문에 없다(`Wf`, `Fn`, `Rl`) | 실측(4순위) 값 근거나 Jev 판정(model 등급)으로. 원문 근거가 없음을 그대로 둔다 |
| 규칙 | 지문과 값 쌍이 구조가 같은 다른 타입을 합친다(Deploy Key와 SSH Key, Release와 Asset) | Jev `variant_of_parent` 반대 근거, 실측 |
| 규칙 | 값 정체성 기준이 값 객체를 거르지 못한다 | 맥락 기준을 높이거나 자기 키 근거를 요구 |
| 오브젝트 기준 | ID 공간은 오브젝트의 상위 집합이다. 목록은 식별자 외에 관리 경계, 지속성, 재사용(G1~G4)과 테넌트 관측 가능성으로 걸렀다 | 오브젝트 추출 단계의 기준(interface 부여 가능성, 지속성)으로 줄인다. 이 대조표가 그 단계의 평가셋이 된다 |
| 비교 기준 | 목록의 근거 API가 비었거나(Okta 5, Google 3) 같은 대상이 두 행 | 목록 쪽 보완 |

## 5. 비교 방법의 한계

- 근거 API 경로를 끝에서부터 맞춘다. 글자 조각이 없는 틀은 맞추지 않는다. 위치로 닿은 공간을 응답 원소로 닿은 공간보다 먼저 본다. 그래도 할당, 허용, 초대처럼 다른 대상의 목록을 돌려주는 동작은 그 대상 공간에 닿는다(2절 일부)
- 근거 API가 자유 글(「REST network-configurations endpoints」)이면 맞추지 못한다
- 판정이 아니라 조사다. 이 결과로 공간을 바꾸지 않았다

## 6. 권고 적용 뒤 (2026-10-18, 루프 16~17)

세 가지를 적용했다.

| 적용 | 내용 |
| --- | --- |
| 수집 | Google Workspace Discovery 8종(drivelabels, gmailpostmastertools, vault, forms, people, chromemanagement, meet, script), Okta Privileged Access(`opa.yaml`), Okta Aerial(다중 조직), Okta for AI Agents(태그별 명세 16개, sitemap에서 태그 목록). 모두 사다리 0~1단(공용 Discovery, 서비스별 `$discovery`, 문서 사이트 `_spec`)으로 받았다. Okta 동작 962 → 1,363, Google 418 → 625 |
| 규칙: 부모 아래 단일 하위 자원 | 위치 있는 경로에서 끝이 파라미터가 아니고 같은 경로에 GET과 쓰기가 있으면 공간(`local_singleton`). 처음엔 GET과 PUT만 있는 설정까지 59개가 공간이 되어 조건을 더했다: 만들거나 지울 수 있을 때(POST, DELETE)만. 늘 있는 설정은 부모 공간의 속성으로 붙는다 |
| 규칙: 오브젝트 후보 표시 | 원문 키만 있는 공간은 REST/RPC 동작 응답에 나오거나 후보 공간이 참조할 때만 `object_candidate` |
| 정규화 (조사 중 발견) | Google 경로 틀에 API 이름과 서비스 경로를 남긴다 |

| SaaS | 포함 후보 공간에 닿음 (전 → 후) | 누락 | 오브젝트 후보 공간 / 전체 공간 | 포함 후보가 안 닿은 후보 공간 |
| --- | --- | --- | --- | --- |
| GitHub | 58 → 60 / 64 | 4 | 188 / 478 (GraphQL 타입 282 빠짐) | 125 |
| Okta | 69 → 103 / 127 | 24 | 241 / 250 | 134 |
| Slack | 9 / 30 | 21 | 44 / 44 | 33 |
| Google | 37 → 50 / 60 | 10 | 108 / 108 | 57 |

남은 누락:

- Slack 17: RPC 레코드(bot, workflow, role 등)의 ID 형식이 원문에 없다. 실측이나 Jev(model 등급)가 필요하다
- Okta 12와 Google 6: 근거 API가 아직 IR에 없다(Okta OAG, ASA 등 다른 제품, Google의 Cloud API 혼입)
- Okta 7, Google 4: 동작은 있으나 응답이 공간이 아니다(목록 원소에 단건 위치가 없음)

남은 불필요(후보 공간인데 포함 후보가 안 닿음)는 대부분 「목록이 일부러 제외」(GitHub 28, Okta 33, Google 35)와 「부모 안 하위 자원」(GitHub 60, Okta 41)이다. 오브젝트 추출 단계의 기준(지속성, 관리 경계, interface)으로 줄일 대상이다.
