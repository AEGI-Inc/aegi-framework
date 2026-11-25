# 오브젝트 모델 v2 작업 정리 (1~6단계, 판단표 3차)


작성일: 2026-10-19. 브랜치 `feat/object-model-v2`(origin/main `f0ef4b8` 기준, push 전). v1 고정 기록(`model_v1_freeze.json`, `relation_decisions_step4.json`)은 바꾸지 않았다. 결정 정본은 `candidate-extraction/ir2/v2/relation_decisions_v2.json`이다.

## 요약

- v1 종합 감사 보고서(다른 AI 작성)의 주장 28개를 대조했다. 사실 19개, 일부만 사실 6개, 틀림 3개다. 처리할 항목을 6단계로 나눠 진행했다.
- 기준을 aegi-schema 최신판(`c067b02`)으로 올렸다(그 전 v1은 2026-09-27판 `5e160f0`).
- 결정 모순 4건과 연구 재검토 21건을 판단표 두 개로 정리했고, 사용자가 모두 권고대로 정했다(결정 30건).
- 기존 오브젝트 목록, Cartography, IM v1을 대조한 뒤 IM 수집 Profile이 없는 기존 「포함」 223개를 판단표 3차로 나눴다(V2-P1 ~ P7, 결정 누계 37건). 기록만 했고 구현은 다음 작업이다.
- 대시보드 v1 모델 데이터셋(기존 4개 SaaS 스냅샷)의 결과는 다음과 같다. 탐지 ID는 바뀌지 않았다.

| 항목 | v1 고정 | v2 브랜치 |
| --- | ---: | ---: |
| 객체 | 297 | 294 |
| 활성 관계 | 267 | 272 |
| 보류 관계 | 18 | 0 |
| 실행 Profile | 74 | 75 |
| Effective Access 규칙 | 4 | 5 |
| 연구 Object 타입 | 1,973 | 1,977 |
| Cartography 직접 공간 쌍 | 86 | 90 |
| 연구 검토 항목(열린 것) | 627(0) | 630(0) |

- 남은 일은 V2-P1 수집 추가 20개 구현, 연구 후속 4건(V2-OPEN-19 ~ 21, 24), Salesforce, Jira, Confluence 실측(7단계)이다. 실측은 환경이 준비된 뒤에 한다.

## 0. 출발점: v1 정정과 기준판 갱신

| 결정 | 내용 | 커밋 |
| --- | --- | --- |
| E11 근거 정정 | Okta 그룹 소유자는 기본 권한이 없고 접근 요청 승인과 접근 검토를 맡는다(Okta 도움말). `owned_by` Principal → Principal 제안은 유지. aegi-schema 이슈 #20 | `8733aea` |
| C1 정정 | Slack trigger를 일괄 Endpoint로 보지 않는다. 웹훅 트리거의 수신 URL만 Endpoint, 이벤트, 예약, 링크 트리거는 Object가 아니다(aegi-schema 최신 Interface_Spec). 종류를 모르면 보류 | `cb799f6` |
| V2-D01 | aegi-schema 기준을 `c067b02`로 올린다. 기준 사본 4개 교체(`triggered_by` 끝점 Resource, Integration 추가, 트리거 Endpoint 판정 절), 대시보드 개념 사전 사본 갱신 | `c1871b7`, `1b1e5d9` |

연구 재생성에서 바뀐 것은 `triggered_by` 템플릿뿐이었다.

## 1단계: 감사 보고서 검토와 대장 정리

- 감사 주장을 결정 대장, 정규화 코드, 산출물에 대조했다. 검토 결과는 `docs/study/model-v1/AUDIT_REVIEW_AND_FIX_PLAN.md`(원래 체크아웃, 커밋 전)에 있다.
- 처리할 13개를 `open_items`(V2-OPEN-06 ~ 18)로, 틀린 주장 3개를 `audit_not_applicable`로 남겼다(`9c6b166`).

| 틀린 주장 | 확인한 사실 |
| --- | --- |
| Salesforce 15자 id 해시 충돌 | 15자 id는 대소문자를 그대로 쓰는 정본 id다. 소문자로 바꾸는 곳은 이름과 이메일뿐이다 |
| Slack 토큰 식별자 관리 포기 | R2a로 봇, 사용자, 설정 토큰과 웹훅이 복합키 Credential 9행이 됐다. app-token만 속성이다 |
| 뿌리 단일 자원이 고아가 됨 | 1단계 D1로 Jira serverInfo, Okta SSF stream은 singleton 공간이다 |

## 2단계: 결정 모순 해소 (판단표 1차)

판단표: https://claude.ai/artifact/RDB53hnW3KDUcDMqsJpyCx (권고대로)

| 결정 | 내용 | 지금 데이터 반영 |
| --- | --- | --- |
| V2-D02 | Okta PolicyRule `excludes` NetworkZone(B1)만 관계로 만든다. B2 `applies_to`는 Policy를 대상으로 받지 않아 조건 참조로 유지 | NetworkZone 수집 Profile을 더할 때 |
| V2-D03 | Slack 채널 접근 제한(D1)은 두 번째 SaaS 근거를 찾은 뒤 aegi-schema에 제안. D3, D4는 공백 유지 | 해당 없음 |
| V2-D04 | 기기 → 사용자 `owned_by`(기기가 Resource로 정해져 보류 근거가 사라짐) | 기기 수집 Profile을 더할 때 |
| V2-D05 | Okta OAuth2Client를 같은 `credentials.oauthClient.client_id`의 Application에 합침 | 반영(3단계) |

## 3단계: 정규화 수정 (`79018ae`)

| 항목 | 결과 |
| --- | --- |
| Okta 앱 통합(V2-D05) | 클라이언트 3개를 앱에 합쳤다. 관계, 참조, 신원 연결, 관측, 증거 연결, 시나리오 바인딩을 앱 키로 옮기고 `model_report.json`의 `merged_objects`에 남긴다 |
| Google Token(V2-OPEN-11) | `authenticates_with`를 만들지 않는다. 저장된 스냅샷의 13건은 `retired_relations` |
| Slack bot-token(V2-OPEN-12) | Policy인 bot-token의 `owned_by`를 `contained_in`(앱 설치)으로 바꾼다. 5건, `converted_relations` |
| Okta 그룹 배정(V2-OPEN-02) | `_links.group`의 그룹을 `via_group`에 남긴다. 그룹 배정 2건 모두 복원 |
| Salesforce 그룹 멤버(V2-OPEN-14) | 사용자, 그룹이 아닌 멤버는 기록을 남기고 건너뛴다 |

정규화 코드는 앞으로 수집할 때 올바른 관계를 만들고, 투영은 저장된 스냅샷에 같은 결정을 적용하면서 결정 코드와 함께 기록한다.

## 4단계: Jira 동적 보유자 Effective Access (`4133de0`, V2-D06 `e175d12`)

- 새 로컬 규칙 `x_dynamic_holder`. `askGrant`가 Jira 프로젝트를 권한 키(`matchesPermission`)와 함께 물을 때만 푼다.

| 보유자 | 처리 |
| --- | --- |
| projectLead | Project.lead 참조가 그 주체면 성립(computed) |
| anyone | 전원 배경, 행 없음 |
| applicationRole | 제품 접근 그룹 미수집, 판정 보류 |
| reporter, assignee, userCustomField, groupCustomField, sd.customer.portal.only | 이슈마다 정해져 판정 보류 |

- 경로는 PermissionScheme → Project `applies_to` 한 홉이다(V2-D06). 보유자 근거는 행의 `x_holders`에 둔다. 이 규칙만 행 동일성에 권한 줄 키를 더한다.
- 지금 Jira를 묻는 탐지 룰이 없어 화면에 새 행은 없다.

## 5단계: 연구 선별 재검토 (판단표 2차)

판단표: https://claude.ai/artifact/3qsLkTwJZsJVL5DkunKfTe (권고대로). 결정은 `5411c4e`, 연구 적용은 `c317b09`, 수집 추가는 `c57fbd5`.

### Object에서 뺀 보안 관련 항목

| 결정 | 내용 | 상태 |
| --- | --- | --- |
| V2-R1 | Google 메일 위임: GW-15에서 delegates를 읽고 Delegate를 Assignment Profile로(75번째). 관계는 만들지 않는다 | 구현. 저장된 실행에 원본 없음 |
| V2-R2 | Google 이메일 별칭: User, Group 속성, 참조 해석과 Okta Google 앱 신원 연결의 대체 후보 | 구현. 사용자 9명 |
| V2-R3 | Salesforce 사용자 MFA 방식(TwoFactorMethodsInfo): User `mfa_methods` | 구현. 실측 때 권한 확인 |
| V2-R4, R5 | Okta 지원팀 접근 설정(SUPER_ADMIN 필요), Jira 사용자 이메일 API(승인된 앱 전용)는 수집 한계로 기록 | 기록 |
| V2-R6 ~ R8 | Jira 기본 공유 범위(사용자별 값), 세션 4종, Salesforce Security Center 6종은 빼는 결정 유지 | 변경 없음 |

### 같은 대상 판정

| 결정 | 내용 |
| --- | --- |
| V2-S1, S2 | Okta 명세 간 같은 스키마 15쌍은 속성 일치(또는 부분 집합) 검사를 통과해 근거를 규칙으로 |
| V2-S3, S6 | Okta UserGetSingleton과 Identity Source 사용자, Jira RemoteIssueLink와 이름 없는 공간을 분리 |
| V2-S4, S5 | GitHub simple-user(type: User, Organization), Google Member.memberKey(type: USER, GROUP, CUSTOMER)는 판별값 조건부 공간 |
| V2-S7, S8 | Jira 그룹 3쌍은 사람 결정 Q2, Slack 예약 메시지 1쌍은 같은 속성 규칙 |
| V2-S9 | 나머지 13쌍은 모델 근거 유지, 실측 표본 확인 |

같음 쌍은 Okta 24 → 23, GitHub 40 → 38, Google 5 → 4, Jira 8 → 7이다. 대조 단계가 조건부 공간을 읽게 되어 Google 그룹 안 그룹 관계 4개가 새로 닿았다(직접 쌍 86 → 90).

### Cartography 자동 매핑과 interface

| 결정 | 내용 |
| --- | --- |
| V2-M1, M2 | Google 상속 회원 2개는 member_of가 아니라 Effective Access 계산 |
| V2-M3 | Slack 사용자 그룹 → 채널은 관계 아님(기본 채널 속성) |
| V2-T1 | Jira ServerInformation의 연구 interface를 Tenant로(실행 Profile site와 같아짐) |

v2 결정은 `candidate-extraction/ir2/v2/research_overrides_v2.json`에 기계 적용 꼴로 두고 `dup_audit.py`, `rel_audit.py`, `model_v1.py`가 v1 결정 다음에 적용한다. 결정과 맞는 연구 행이 없으면 생성이 멈춘다.

## 6단계: 개념 사전 의미 계층 연결 (`a79c2ae`)

- relation_semantics(관계 17종의 양방향 이름, 뜻, 역관계)와 crosswalk(SaaS를 넘는 연결 규칙 6종, 칸 표시)를 `src/ontology/generated.ts`에 생성한다. 동작과 화면은 바꾸지 않는다.
- `scripts/ontology.test.ts`가 crosswalk가 가리키는 대시보드 규칙과 정규화 속성이 있는지 본다. 일부러 다른 두 곳(V2-R2, V2-D05)은 `scripts/ontology/crosswalkDifferences.ts`에 결정 코드와 함께 둔다.
- 넣지 않은 것: 관계 효과(엔진 `edges.ts`가 정본), 권한 방식 13개(aegi-schema가 초안이라고 밝힘).
- V2-OPEN-22: crosswalk 반영 제안 2건을 aegi-schema 이슈 #20에 올렸다(https://github.com/AEGI-Inc/aegi-schema/issues/20#issuecomment-6265697962).
- V2-D07: 화면 문구는 지금 대시보드 문구를 유지한다.

## 판단표 3차: Profile 없는 기존 오브젝트 (`13989f1`)

세 모델 오브젝트 대조(기존 목록, Cartography 70노드, IM v1)에서 기존 「포함」 284개 중 IM 수집으로 이어진 것은 61개였다. 나머지 223개(IM 연구 타입 있음 181, 없음 42)를 사용자가 권고대로 정했다. 항목별 근거는 대장 `items`, 재생성 도구는 `candidate-extraction/ir2/v2/profile_triage/`에 있다.

| 결정 | 분류 | 수 | 내용 |
| --- | --- | ---: | --- |
| V2-P1 | 수집 추가(우선) | 20 | GitHub 비밀값, 배포 키, 조직 역할, 외부 그룹, 환경. Okta API 토큰, 외부 IdP, API 서비스 연동, 훅, 로그 스트림. Google SSO 프로필, IdP 인증서, SSO 배정, 앱 비밀번호, 공유 드라이브, 조직 단위 |
| V2-P2 | 수집 추가(다음) | 41 | 조건부 항목은 조건이 생길 때. Google 허용 도메인(B24)은 Policy |
| V2-P3 | 기존 타입에 붙임 | 3 | Slack 세부 관리 역할은 이름 역할과 has_role_on, Google 그룹 설정은 Group 속성 |
| V2-P4 | 이미 다룸 | 22 | 신원 Link 재료, 다른 호출의 속성, 관측 |
| V2-P5 | 조건부 보류 | 75 | Okta Privileged Access 30, AI 에이전트 14, Identity Governance 12 등. 제품을 쓰는 테넌트면 다시 연다 |
| V2-P6 | 수집 안 함 | 56 | 콘텐츠, 실행 기록, 표시 설정 |
| V2-P7 | 원문 확인 | 6 | V2-OPEN-24 |

## 검증

| 검사 | 결과 |
| --- | --- |
| 연구 2단계 재생성 | 39개 파일 두 해시 시드 일치, 회귀 39개 |
| 연구 3~4단계 재생성 | 25개 파일 두 해시 시드 일치, 회귀 71개, 열린 검토 0 |
| `npm run test:model-v1` | 31개(v1 고정 때 24개) |
| `scripts/ontology.test.ts` | 6개(v1 고정 때 2개) |
| `npm run build` | 통과 |
| `npm run test:functional` | 69/69, 기본 데이터셋과 v1 모델 데이터셋 |
| `npm run validate:model-v1` | 객체 294, 관계 272, 보류 0, 탐지 전후 9건, ID 변화 0 |

## 남은 일

| 항목 | 내용 |
| --- | --- |
| V2-OPEN-19 | Jira 이름 없는 공간 `{}_2`가 분리된 뒤 홀로 Integration 타입이 됐다. Object 여부부터 다시 본다 |
| V2-OPEN-20 | GitHub `team-membership.username`이 simple-user 쪽에 남아 사용자 묶음과 떨어졌다 |
| V2-OPEN-21 | Slack 채널, 파일 정의와 응답 보기 3쌍의 ID 형식 근거 |
| V2-P1 ~ P3 | 판단표 3차 수집 추가 구현. 순서는 인계 문서 |
| V2-OPEN-24 | 근거 API가 연구 원문에 없는 기존 오브젝트 6개의 스펙 보강과 재분류 |
| 7단계 실측 | Salesforce, Jira, Confluence 환경 준비 뒤: 같은 대상 13쌍 표본, MFA 조회 권한, Jira 제품 접근 그룹 수집, 정답표 없는 SaaS interface 표본 |
| aegi-schema | 이슈 #20(D2, E11, crosswalk 2건)의 반영 여부 |

## 커밋

| 커밋 | 내용 |
| --- | --- |
| `8733aea` | v2 결정 대장, E11 근거 정정 |
| `cb799f6` | C1 Slack trigger 정정 |
| `c1871b7` | 최신판과 비교한 검토 항목 |
| `1b1e5d9` | aegi-schema 최신판 기준(V2-D01) |
| `9c6b166` | 감사 검토 결과(1단계) |
| `79018ae` | 판단표 1차 결정과 정규화 수정(2, 3단계) |
| `4133de0` | Jira 동적 보유자 EA 규칙(4단계) |
| `e175d12` | 스킴 → 프로젝트 applies_to 결정(V2-D06) |
| `5411c4e` | 판단표 2차 결정 기록 |
| `c317b09` | 판단표 2차 연구 판정 |
| `c57fbd5` | 판단표 2차 수집 추가 |
| `a79c2ae` | 개념 사전 의미 계층 연결(6단계) |
| `cb67849` | 1~6단계 정리 문서, V2-OPEN-22, V2-D07 |
| `13989f1` | 판단표 3차 결정 기록(V2-P1 ~ P7) |
| (이 커밋) | 인계 문서, 대조와 판단표 3차 재생성 도구 |

## 파일

| 파일 | 내용 |
| --- | --- |
| `candidate-extraction/ir2/v2/relation_decisions_v2.json` | v2 결정 37건, 검토 항목 24개, 감사 해당 없음 3개, 단계별 검증 |
| `candidate-extraction/ir2/v2/profile_triage/` | 세 모델 대조와 판단표 3차 재생성 도구 |
| `candidate-extraction/ir2/v2/research_overrides_v2.json` | 연구 코드가 읽는 v2 결정 |
| `docs/spec/AEGI_OBJECT_MODEL_V1.md`, `AEGI_OBJECT_MODEL_V1_RUNTIME.md` | v2 변경 문단 |
| `scripts/ontology/crosswalkDifferences.ts` | crosswalk와 일부러 다른 곳 |
