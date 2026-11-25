# IM 모델 (오브젝트 모델 v1) 안내

> 상태: 과거 기록. 이 판은 지금 수집, 정규화, 탐지의 기준이 아니다. 지금 기준은 고정본 [IM Object Model V3.2](v3.2/README.md)와 엔진 Profile 단일 경로 [`scripts/collect/profile-binding/`](https://github.com/AEGI-Inc/aegi-adapter-engine/tree/main/scripts/collect/profile-binding)([IM Profile 파이프라인](https://github.com/AEGI-Inc/aegi-adapter-engine/blob/main/docs/IM_PROFILE_PIPELINE.md))다. 아래 본문의 「팀 작업은 이 판을 기준」 문장과 `scripts/collect/model-v1/definitions.ts`, `scripts/collect/normalize-v2/`, `npm run model:compile`, `npm run normalize:model-v1` 같은 경로와 명령은 지금 엔진에 없다. 본문은 2026-10-19 기록 그대로 둔다.

새 오브젝트 모델의 공식 명칭을 **IM 모델**(Information Map 기반 오브젝트 모델)로 명명한다. 오브젝트 모델 v1은 2026-10-19 사용자 결정으로 고정했다(PR #117). 팀의 수집, 정규화, 탐지 작업은 이 판을 기준으로 한다. 모델을 더 발전시키는 일은 v2로 따로 진행하고, v1 파일은 새 결정 없이 바꾸지 않는다.

v2 작업(브랜치 `feat/object-model-v2`, 2026-10-19 사용자 결정): 기준 문서 사본을 aegi-schema `c067b02`판으로 올렸다. v1 고정판(`5e160f0`, 2026-09-27)과 달라진 점은 `triggered_by` 끝점에 Resource와 Integration이 더해진 것과 트리거의 Endpoint 판정 절이다. 같은 날 판단표 1차, 2차의 v2 결정을 적용했다. 연구 Object 타입은 1,977개(같은 대상 분리 4), Cartography 자동 매핑 3개를 바로잡았고, 실행 Profile은 122개(판단표 3차 V2-P1 GitHub 8개, Okta 7개, Google Workspace 7개, V2-P2 GitHub 9개, Okta 10개, Google Workspace 3개, Slack 3개 포함), v1 모델 데이터셋은 객체 294, 관계 272, 보류 0이다. 결정은 `candidate-extraction/ir2/v2/relation_decisions_v2.json`, 기계 적용 꼴은 `v2/research_overrides_v2.json`에 있다.

지금 바로 알아야 할 것은 세 가지다.

- 실측 수집에 쓰는 실행 Profile은 6개 수집 provider(GitHub, Okta, Slack, Google Workspace, Salesforce, Atlassian)의 122개다(v2 브랜치에서 Google 메일 위임 Delegate와 SSO 프로필 2종, IdP 인증서, SSO 배정, 앱 비밀번호, 공유 드라이브, 조직 단위, GitHub 배포 환경, 비밀값 4종, 배포 키, 조직 역할, 외부 그룹, Okta API 서비스 연동, 연동 비밀값, API 토큰, 이벤트 훅, 인라인 훅, 로그 스트림, 외부 IdP, GitHub 조직 초대, 배포 브랜치 정책, 배포 보호 규칙, IP 허용 목록, 조직 SAML IdP, 검증 도메인, 러너 그룹, 자체 호스팅 러너, 패키지, Okta 프로필 매핑, IdP 서명 키, 보안 이벤트 수신, SSF 송신 스트림, 메일 서버, 인증기, 신뢰 출처, 기기 보증 정책, 네트워크 영역, 에이전트 풀, Google 캘린더 공유 규칙, 외부 공유 허용 도메인, 관리 정책, Slack 워크플로, 워크플로 협업자, 정보 차단을 더했다). Salesforce, Jira, Confluence 수집기와 Profile은 2026-10-19에 추가했고 가짜 SaaS 시험만 거쳤다. 새 환경에서 처음 실측할 때 4.1절의 확인을 한다.
- 타입 수준 연구 카탈로그는 8개 SaaS의 타입 1,973개를 담는다. 새 Profile은 이 카탈로그의 타입과 원본 모양에서 고른다.
- 관계는 닫힌 어휘 17종만 쓴다. interface는 9종으로 고정이다. 템플릿에 맞지 않는 관계는 활성 그래프에 넣지 않고 보류한다.

## 1. 무엇이 고정됐나

| 대상 | 파일 | 설명 |
| --- | --- | --- |
| interface 9종 | `candidate-extraction/ir2/collect/interface_contracts/Interface_Spec_v3.md.source` | Tenant, Principal, Integration, Credential, Assignment, Policy, Endpoint, Resource, Automation. 판별 기준과 행 계약 필드 |
| relation 17종 | `candidate-extraction/ir2/collect/interface_contracts/Relation_Schema_v3.md.source` | 아래 2절 |
| 실행 카탈로그 | `docs/spec/model-v1/runtime-catalog.json` | 수집 Profile 122개, Link 재료 전용 타입, 관계 템플릿. 대시보드 수집과 정규화가 읽는 유일한 모델 파일 |
| 고정 연구 묶음 | `docs/spec/model-v1/research-v1.bundle.json` | 8개 SaaS의 연구 타입, 원본 모양 id, 공간 이름. 연구 산출물 없이 카탈로그를 다시 만들 때 쓴다 |
| 수집 Profile 정의 | `scripts/collect/model-v1/definitions.ts` | 실측 타입마다 interface, 원본 모양, 상수, 근거 |
| 사람 결정 | `candidate-extraction/ir2/relation_decisions_step4.json`, `same_entity_decisions.json`, `decisions_step1.json`, `model_v1_freeze.json` | 판단표 610건, 같은 대상 Q1~Q3, 1단계 69건, 고정 결정 |

## 2. 관계 어휘 17종

| 관계 | 템플릿 | 예 |
| --- | --- | --- |
| `has_role_on` | Principal, Policy, Credential, Integration --[Policy 역할]--> Resource, Tenant, Integration, Automation | GitHub 팀의 저장소 write, Okta 관리자 역할, Jira 권한 스킴 줄 |
| `member_of` | Principal → Tenant, Principal, Resource | 팀 회원, 그룹 회원(OWNER 같은 역할은 속성) |
| `owned_by` | Endpoint, Automation, Credential → Integration, Tenant / Resource → Principal / Principal → Integration | 개인 저장소 소유자, 원천 앱이 만든 Okta 그룹 |
| `contained_in` | 아무 interface → 아무 interface. 단, 경로나 부모 필드가 소속을 증명해야 한다 | 브랜치, 환경, 비밀값, 웹훅 → 저장소나 조직 |
| `applies_to` | Policy → Principal, Integration, Resource, Tenant | 룰셋 → 저장소, Okta 정책 → 그룹 |
| `excludes` | Policy → Principal, Integration, Credential, Policy | Okta 정책 제외 그룹 |
| `permits` | Policy, Credential → Resource | 배포 키 → 저장소 |
| `authenticates_with` | Principal, Endpoint, Integration → Credential | 사용자 → 인증 요소, 앱 비밀번호 |
| `runs_as` | Automation → Principal, Credential | 워크플로 실행 신원 |
| `triggered_by` | Automation → Principal, Endpoint, Resource, Integration | 웹훅 트리거 수신 주소, 이벤트를 일으킨 채널이나 연동 앱 |
| `registered_in`, `registered_by` | Integration → Tenant, Principal | 앱 설치 |
| `acts_as` | Integration → Principal | 앱이 쓰는 봇 사용자 |
| `receives_into` | Endpoint → Tenant, Resource | 수신 웹훅 |
| `shared_with` | Resource → Tenant | 도메인 전체 공유 |
| `evaluates` | Policy → Policy | 정책이 다른 정책을 평가 |
| `trusts` | Tenant → Tenant | 조직 사이 신뢰, Slack Connect |

판정 규칙:

- `has_role_on`은 역할 칸에 실제 Policy 객체가 있어야 한다. 이름만 있는 역할은 정규화가 이름 역할 Policy를 만들어 잇는다. 역할 없이 2항으로 줄이지 않는다.
- 행위 기록(만든 사람, 커밋한 사람, 닫은 사람)은 관계가 아니라 속성이다. Slack `creator`가 기준 사례다.
- 같은 사람인지 판단(SAML, SCIM 외부 신원, 이메일 일치)은 관계가 아니라 신원 연결(Link)이다. GitHub ExternalIdentity는 Object로 만들지 않고 Link 재료로만 쓴다. 재료 레코드는 데이터셋의 `link_material.json`에 그래프 밖으로 남긴다.
- 중첩 그룹 상속, Jira 프로젝트 리드처럼 다른 관계에서 계산되는 결과는 Effective Access가 계산한다. 저장하는 관계로 만들지 않는다.
- 조건(Okta 네트워크 영역, API 토큰 허용 영역)은 필드 참조로 보존하고 관계로 만들지 않는다.

## 3. SaaS별 준비 상태

| SaaS | 연구 타입 | 실행 Profile | 수집기 | 7개 SaaS 실측 전에 할 일 |
| --- | ---: | ---: | --- | --- |
| GitHub | 235 | 15 | 있음 | 없음. 새 환경 자격증명으로 수집 |
| Okta | 281 | 14 | 있음 | 없음 |
| Slack | 75 | 11 | 있음 | 없음 |
| Google Workspace | 85 | 11 | 있음 | 없음 |
| Salesforce | 1,135 | 10 | 있음(SF-01 ~ SF-07, SF-90) | Connected App과 읽기 전용 통합 사용자 준비(4.1절). 조직, 사용자, 프로필, 권한 집합과 배정, 역할 계층, 공개 그룹과 큐, Connected App, 사용자 OAuth 승인 |
| Jira | 105 | 9 | 있음(AT-01, JI-02 ~ JI-07, JI-90) | 수집 전용 Atlassian 계정 준비(4.1절). 사이트, 사용자, 그룹과 회원, 프로젝트, 프로젝트 역할과 구성원, 권한 스킴과 줄, 필터와 공유 |
| Confluence | 40 | 2 | 있음(CF-01, CF-02) | Jira와 같은 계정. 스페이스, 스페이스 권한 |
| Atlassian 조직 | 15 | 0 | 없음 | 조직 관리 API(도메인, 관리 계정)는 v1 밖. Jira, Confluence 사용자와 그룹은 사이트 디렉터리로 수집한다 |
| Splunk | 연구 범위 밖 | 0 | 없음 | 로그 수신처다. 다른 SaaS의 로그 스트림 Endpoint 대상으로만 다룬다 |

연구 타입 수는 같은 대상 묶음을 반영한 Object 타입 후보다. Salesforce는 실측이 없어 표준 객체 대부분(상태 값, 현지화, 분석 지표, 이벤트)을 v1에서 뺐다.

## 4. 새 SaaS의 수집 Profile 추가 절차

### 4.1 Salesforce, Jira, Confluence 수집 준비

| SaaS | 자격증명 (`.env.collector`) | 준비 | 설정 (`collector.config.json`) |
| --- | --- | --- | --- |
| Salesforce | `CRED-SF-01`: `SALESFORCE_INSTANCE_URL`(My Domain 주소), `SALESFORCE_COLLECTOR_CLIENT_ID`, `SALESFORCE_COLLECTOR_CLIENT_SECRET` | Connected App에서 Client Credentials 흐름을 켜고 실행 사용자를 읽기 전용 통합 사용자로 지정한다. 그 사용자에게 API Enabled, View Setup and Configuration, View All Users를 준다. Connected App 목록(SF-07)은 Manage Connected Apps 권한이 없으면 partial로 남는다 | `"salesforce": { "apiVersion": "61.0", "auditDays": 180 }` |
| Jira, Confluence | `CRED-AT-01`: `ATLASSIAN_SITE_URL`(https://<사이트>.atlassian.net), `ATLASSIAN_COLLECTOR_EMAIL`, `ATLASSIAN_COLLECTOR_API_TOKEN` | 수집 전용 Atlassian 계정의 API 토큰. 권한 스킴, 프로젝트 역할 구성원, 감사 기록은 Jira 관리자여야 보인다. Confluence는 그 계정이 볼 수 있는 스페이스만 나온다 | `"atlassian": { "jira": true, "confluence": true, "audit": false }` |

설정에 블록이 없으면 그 SaaS 호출은 `not_configured`로 건너뛴다. 수집기는 GET만 보낸다(토큰 교환 제외). 처음 실측할 때 확인할 것은 다음과 같다.

- Salesforce 18자, 15자 id가 섞여 와도 같은 대상으로 묶이는지(정규화가 15자로 맞춘다)
- 사용자 OAuth 승인(OauthToken)이 Connected App과 이름으로만 이어진다. 이름이 같은 앱이 둘이면 관계를 만들지 않고 외부 locator로 남긴다
- Jira 권한 줄의 보유자 중 anyone, applicationRole, projectLead 같은 동적 보유자는 관계가 아니라 줄의 속성이다. Effective Access가 풀어야 한다
- Jira 감사 기록은 한 번에 1,000건까지다. 넘치면 `audit_truncated`로 partial이 된다

### 4.2 일반 절차

1. `scripts/collect/providers/`에 읽기 전용 수집기를 만들고, `scripts/collect/normalize-v2/`에 원본 레코드를 객체와 관계로 읽는 판독기를 만든다. 기존 4개 SaaS의 파일이 본보기다.
2. `docs/spec/model-v1/research-v1.bundle.json`의 `providers.<saas>.types`에서 수집할 타입을 고른다. 각 타입의 `interfaces`와 `source_shapes`가 Profile의 출발점이다.
3. `scripts/collect/model-v1/definitions.ts`의 `PROFILES`에 타입마다 한 줄을 더한다. `interfaces`, `source_shape`(또는 `source_space`), 행 계약 상수, 원문 근거(`evidence`)를 적는다. 연구와 다른 interface를 쓰면 근거에 이유를 적는다. 카탈로그에 `reviewed_override`로 기록된다.
4. `npm run model:compile`로 카탈로그를 다시 만든다. 연구 산출물이 없는 PC에서는 고정 연구 묶음만 읽는다. 묶음에 없는 원본 모양이나 공간을 가리키면 실패한다.
5. `npm run normalize:model-v1`, `npm run validate:model-v1`, `npm run test:model-v1`을 돌린다. 승인된 Profile이 없는 타입이 들어오면 예전 카탈로그로 대체하지 않고 실패한다. 템플릿에 맞지 않는 관계는 `model_report.json`의 `quarantined_relations`에 사유와 함께 남는다.
6. 화면 확인은 `npm run dev:model-v1`로 한다. 실측 데이터 폴더(`src/data/aegi_inc_measured_*`)는 git에 넣지 않는다.

새 환경에서 바로 실측하려면 원본부터 정규화한다.

```bash
npm run collect -- --only github,okta
npm run normalize:model-v1 -- --from-raw --raw collected-g2 --config scripts/collect/collector.config.g2.json --out src/data/aegi_inc_measured_model_v1_latest
npm run validate:model-v1 -- src/data/aegi_inc_measured_model_v1_latest
```

자세한 실행 계약과 현재 수치는 [실측 적용 문서](AEGI_OBJECT_MODEL_V1_RUNTIME.md)에 있다.

## 5. 검증과 재현

| 명령 | 확인하는 것 |
| --- | --- |
| `npm run test:model-v1` | Profile 122개, GitHub/Okta/GWS V2-P1, 4개 SaaS V2-P2, Slack 역할 배정과 Google 그룹 설정 V2-P3 수집에서 투영까지, Salesforce, Jira, Confluence 수집에서 투영까지의 종단 시험, 관계 17종, 템플릿과 역할 칸, Link 재료 제외, 만료와 비밀값 처리 |
| `npm run validate:model-v1` | 활성 관계의 끝점과 템플릿, 신원 연결과 관측 보존, 기존 탐지 ID 유지 |
| `npm run build` | 위 검사를 포함한 전체 빌드 |
| `python candidate-extraction/ir2/verify_model_v1.py` | 연구 회귀 71개와 재생성 일치. 연구 산출물(`out2`)이 있는 PC에서만 돈다 |

연구 산출물 `candidate-extraction/ir2/out2/`에는 테넌트 실측 값과 모델 응답 캐시가 섞여 있어 git에 넣지 않는다. 연구를 다시 만들어야 하면 이 폴더를 가진 사람에게 요청한다. 팀원의 Profile 추가와 카탈로그 재생성에는 필요하지 않다.

## 6. 알려진 한계와 v2로 넘긴 일

- Okta OAuth2Client와 Okta Application이 같은 앱을 가리키는지 판정하지 않았다. 지금은 같은 클라이언트 id의 Integration이 둘이다.
- aegi-schema에 낼 제안 2건: Slack 워크플로 → 앱 `owned_by`(Profile null만 고치면 된다), Okta 그룹 소유자 `owned_by` Principal → Principal(템플릿 추가).
- Okta 앱 배정은 역할 이름이 없어 앱별 기본 접근 Policy를 역할 칸에 둔다.
- 기기는 Resource로 통일했다. 보류한 Salesforce `SfdcPartnerTenant` 1건이 남아 있다.
- 실제 관계 행은 실측 수집으로 쌓는다. 연구 카탈로그의 참조 5,293개와 부모 규칙 430개는 타입 수준이다.

## 7. 더 읽을 문서

| 문서 | 내용 |
| --- | --- |
| [진행 현황](../design/오브젝트%20모델%20v1%20진행%20현황.md) | 1~5단계 결과 요약과 수치 |
| [1단계 누락 조사](../design/오브젝트%20모델%20v1%201단계%20누락%20조사.md), [2단계 relation 조사](../design/오브젝트%20모델%20v1%202단계%20relation%20조사.md) | ID 공간 지도와 Cartography 대조 |
| [3단계 interface 판정](../design/오브젝트%20모델%20v1%203단계%20interface%20판정.md), [4단계 relation 적용](../design/오브젝트%20모델%20v1%204단계%20relation%20적용.md), [5단계 검증](../design/오브젝트%20모델%20v1%205단계%20검증.md) | 판정 기준, 사용자 결정, 검증 |
| [실측 적용](AEGI_OBJECT_MODEL_V1_RUNTIME.md) | 실행 명령, 4개 SaaS 적용 결과, 보류 관계와 계약 필드 |
| [연구 코드 안내](../extraction/ir2/README.md) | 연구 스크립트와 재생성 순서 |
