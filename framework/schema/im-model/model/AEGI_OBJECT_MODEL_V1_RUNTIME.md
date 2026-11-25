# IM 모델(오브젝트 모델 v1)의 실제 수집 적용

> 상태: 과거 기록. 지금 수집과 정규화는 고정본 [IM Object Model V3.2](v3.2/README.md)와 엔진 Profile 단일 경로 [`scripts/collect/profile-binding/`](https://github.com/AEGI-Inc/aegi-adapter-engine/tree/main/scripts/collect/profile-binding)([IM Profile 파이프라인](https://github.com/AEGI-Inc/aegi-adapter-engine/blob/main/docs/IM_PROFILE_PIPELINE.md))를 따른다. 아래 `npm run model:compile`, `npm run normalize:model-v1`, `scripts/collect/model-v1/definitions.ts` 같은 명령과 경로는 지금 엔진에 없다. 본문은 2026-10-19 기록 그대로 둔다.

IM 모델(오브젝트 모델 v1)은 2026-10-19에 고정했다. 무엇이 고정됐는지, SaaS별 준비 상태와 새 SaaS Profile 추가 절차는 [IM 모델(오브젝트 모델 v1) 안내](AEGI_OBJECT_MODEL_V1.md)를 먼저 읽는다. 이 문서는 실행 명령과 4개 SaaS 적용 결과를 다룬다.

기존 4개 SaaS 스냅샷에 새 모델의 수집 Profile을 적용했다. 현재 로컬 미리보기는 객체 297개, 관계 267개, 신원 연결 10개, 관측 28개와 탐지 11건을 표시한다. 전체 연구 후보를 일괄 확정한 모델이 아니라, 원문과 계약을 재검토한 수집 Profile(기존 4개 SaaS 53개, 2026-10-19 Salesforce와 Atlassian 21개 추가)의 실행 가능한 범위다.

2026-10-19 연구 결정 반영: GitHub ExternalIdentity 5개는 Object가 아니라 신원 연결(Link) 재료로만 쓴다. 카탈로그의 `link_only` 목록에 두고 투영에서 빼며 `model_report.json`의 `link_only_objects`에 키를 남긴다. 원본 레코드는 그래프 밖 `link_material.json`에 그대로 남겨, 신원 연결을 근거부터 다시 만들어 볼 수 있게 한다(aegi-schema `ontology/crosswalk.yaml`의 SAML 칸 표시가 읽는다). 신원 연결 10개는 투영 전에 이미 만들어지므로 그대로다. Okta OAuth2Client는 Principal에서 Integration으로 바꿨고, 관리 역할 `has_role_on` 3개는 Integration 출발로 그대로 유효하다.

종류만으로 정해지는 판정값(`direction`, `credential_kind`, `rotation`, `grant_target`)은 행의 `judged`에서 빠진다. 값은 Profile 상수로 정하고 객체마다 `fixture_meta.model_v1.profile_constants`에 적힌다. 탐지 엔진은 웹훅 방향을 행에 없으면 이 Profile 상수에서 찾는다(`edges.ts` buildOutboundHooks). 그래서 v1 데이터에서도 GitHub 조직 웹훅으로 나가는 흐름 간선이 옛 데이터와 같다.

`contained_in`은 출발 객체의 `references.parent`나 `references.tenant`가 도착을 가리켜야 투영을 통과한다(`scope_or_parent_not_proven`). Slack 채널은 `context_team_id` 워크스페이스를 `parent`로도 남기므로 채널 → 워크스페이스 관계가 v1에서도 남는다.

## v2 변경 (브랜치 `feat/object-model-v2`, 2026-10-19)

v2 결정을 투영에 적용했다. 결정과 근거는 `candidate-extraction/ir2/v2/relation_decisions_v2.json`에 있다.

| 변경 | 결정 | 결과 |
| --- | --- | --- |
| Okta OAuth2Client를 같은 client_id의 Application에 합침 | V2-D05 | 객체 297 → 294. 관계, 참조, 신원 연결, 관측, 시나리오 바인딩을 앱 키로 옮기고 `model_report.json`의 `merged_objects`에 남긴다 |
| Google Token의 authenticates_with를 만들지 않음 | V2-OPEN-11 | 저장된 스냅샷의 13건은 `retired_relations` |
| Slack bot-token(Policy)의 owned_by를 contained_in으로 | V2-OPEN-12 | 5건, `converted_relations` |
| Okta AppUser `_links.group` 복원 | V2-OPEN-02 | 그룹 배정 2건의 그룹을 `via_group`에 남긴다 |
| Google 이메일 별칭 저장과 신원 연결 대체 후보 | V2-R2 | 저장된 스냅샷은 원본에서 복원한다(사용자 9명) |
| GitHub 배포 환경, 비밀값, 배포 키, 조직 역할, 외부 그룹 수집(GH-24 ~ GH-28) | V2-P1 A01 ~ A05 | Profile 8개. 저장된 실행에는 새 호출 원본이 없어 지금 데이터에는 없다. 실측 미확인 |
| Okta API 서비스 연동, 연동 비밀값, API 토큰, 이벤트 훅, 인라인 훅, 로그 스트림, 외부 IdP 수집(OK-15 ~ OK-18) | V2-P1 A06 ~ A09 | Profile 7개. 저장된 실행에는 새 호출 원본이 없어 지금 데이터에는 없다. 실측 미확인 |
| Google Workspace SSO 프로필, IdP 인증서, SSO 배정, 앱 비밀번호, 공유 드라이브, 조직 단위 수집(GW-17 ~ GW-20) | V2-P1 A10 ~ A13 | Profile 7개. 저장된 실행에는 새 호출 원본이 없어 지금 데이터에는 없다. 실측 미확인 |
| GitHub 조직 초대, 배포 브랜치 정책과 보호 규칙, IP 허용 목록, 조직 SAML IdP, 검증 도메인, 러너 그룹과 자체 호스팅 러너, 패키지 수집(GH-29 ~ GH-33) | V2-P2 B01, B03, B05 ~ B09 | Profile 9개. 초대는 받기 전이라 접근 관계를 만들지 않는다. 도메인 확인 토큰, IdP 인증서는 받지 않는다. 저장된 실행에는 새 호출 원본이 없어 지금 데이터에는 없다. 실측 미확인 |
| Okta 프로필 매핑, IdP 서명 키, 보안 이벤트 수신, SSF 송신 스트림, 메일 서버, 인증기, 신뢰 출처, 기기 보증 정책, 네트워크 영역, 에이전트 풀 수집(OK-19 ~ OK-23) | V2-P2 B10 ~ B13, B15, B17 | Profile 10개. 범위가 허용된 종류만 부른다. IdP 인증서는 지문만, SMTP 비밀번호는 남기지 않는다. 저장된 실행에는 새 호출 원본이 없어 지금 데이터에는 없다. 실측 미확인 |
| Google 캘린더 공유 규칙, 외부 공유 허용 도메인, 관리 정책 수집(GW-22 ~ GW-24) | V2-P2 B21, B24, B25 | Profile 3개. 캘린더는 활성 사용자의 기본 캘린더 ACL만 읽고 접근 관계는 만들지 않는다. 정책은 조직 단위 또는 그룹 하나에 applies_to. 구독과 Forms watch(B23)는 V2-OPEN-27로 보류. 실측 미확인 |
| Slack 워크플로(협업자, 단계, 함수), 정보 차단 수집(SL-17, SL-18) | V2-P2 B19, B20 | Profile 3개. 단계와 함수는 워크플로 속성이고 단계 입력값은 이름만 남긴다. 협업자는 has_role_on[collaborator]. 실측 미확인 |
| Slack 관리 역할 배정(SL-16), Google 그룹 설정(GW-21) 수집 | V2-P3 C01, C02 | 새 Profile 없음. 역할 배정은 사용자 has_role_on[role_id] 조직, 워크스페이스, 채널(이름 역할 NamedRole), 그룹 설정은 Group 속성 `settings`. GW-21은 `apps.groups.settings`(쓰기 가능 범위, 예외)를 허용했을 때만 부른다. 저장된 실행에는 원본이 없어 지금 데이터에는 없다. 실측 미확인 |
| Google 메일 위임 수집(GW-15 delegates) | V2-R1 | Delegate(Assignment) Profile, 관계 없음. 저장된 실행에는 위임 원본이 없어 지금 데이터에는 없다 |
| Salesforce 사용자 MFA 방식(SF-02 TwoFactorMethodsInfo) | V2-R3 | User 속성 `mfa_methods`. 실측 전 |
| Jira 동적 보유자 Effective Access 규칙 | V2-OPEN-15 | `x_dynamic_holder`, 스킴 → 프로젝트 applies_to(V2-D06) |

보류 관계는 18 → 0, 활성 관계는 267 → 272다. 탐지 ID 변화는 0이다. 아래 본문의 수치는 v1 고정 때의 기록이다.

## 실행

```bash
# 저장된 연구 결과가 있을 때만 필요. 배포와 수집 실행은 고정된 카탈로그를 사용한다.
npm run model:compile

# 현재 화면의 4개 SaaS 스냅샷을 그대로 새 모델로 옮긴다.
npm run normalize:model-v1
npm run validate:model-v1
npm run dev:model-v1 -- --host 127.0.0.1 --port 5174 --strictPort
```

미리보기: `http://127.0.0.1:5174/#overview`, 그래프: `http://127.0.0.1:5174/#graph`.

새로 저장한 API 응답부터 실행할 때는 다음 명령을 쓴다. 정규화 자체는 SaaS API를 호출하지 않는다.

```bash
npm run normalize:model-v1 -- --from-raw --raw collected-g2 --config scripts/collect/collector.config.g2.json --out src/data/aegi_inc_measured_model_v1_latest
npm run validate:model-v1 -- src/data/aegi_inc_measured_model_v1_latest
```

기본 변환은 `src/data/aegi_inc_measured_v2/`의 동일한 스냅샷을 입력으로 사용한다. 원문 보강도 그 manifest의 수집 실행 14개로 한정해, 이후 실행에 나타난 상태 변경을 모델 변경과 섞지 않는다. `--from-raw`는 별도 모드이며 현재 저장된 실행 15개를 사용한다.

## 모델과 수집기의 경계

- `scripts/collect/model-v1/definitions.ts`는 실제 수집 타입의 인터페이스, 원문 모양과 판단 근거를 선언한다. 연구 후보와 다른 판단 14개(연구 타입 없이 레코드로 투영 10, 검토 뒤 재정의 4)는 `runtime-catalog.json`의 `research_agreement`와 근거로 확인한다. 2026-10-19 연구 결정 627건을 반영해 카탈로그를 다시 만들었고, 실행 Profile과 출력 수치는 바뀌지 않았다.
- `model:compile`은 연구 산출물(`out2`)이 있으면 코드와 입력 해시, Q1~Q3 및 회귀 검증 상태를 확인하고 고정 연구 묶음 `docs/spec/model-v1/research-v1.bundle.json`을 새로 쓴다. 연구 산출물이 없는 PC에서는 그 묶음만 읽는다. 두 경우 모두 `docs/spec/model-v1/runtime-catalog.json`을 만든다. 이 고정 파일에는 공개 명세 정보만 있다. 실제 데이터와 비밀값은 들어가지 않는다. UserFactor는 원문의 factorType으로 명시한 하위 계약을 고르며, 지원하지 않는 인증자 종류는 credential_kind를 추정하지 않고 미확인으로 남긴다.
- 기존 4개 SaaS의 API 레코드 판독기를 재사용하되, 출력의 카탈로그와 인터페이스는 새 Profile로 다시 부여한다. 승인된 Profile에 없는 타입은 예전 카탈로그로 대체하지 않고 실패한다.
- 객체 키는 유지한다. 이름 역할은 원문 이름과 범위로 식별되는 Policy 객체로 만들고 3항 관계의 role에 연결한다. 이미 선언된 이름 이상의 권한을 새로 추론하지 않는다. 이름만 admin인 사용자 정의 역할도 관리자 역할로 승격하지 않는다.
- 관계는 닫힌 어휘 17종, 각 끝점의 인터페이스, 실제 parent 또는 tenant, 역할 객체와 교차 SaaS 근거를 검증한 뒤 활성 그래프에 넣는다. `owned_by`의 템플릿 대안을 서로 섞지 않는다.

## 기존 스냅샷 적용 결과

| 항목 | 이전 | 새 모델 |
| --- | ---: | ---: |
| 객체 | 286 | 297 |
| 활성 관계 | 285 | 267 |
| 신원 연결 | 10 | 10 |
| 관측 | 28 | 28 |
| 탐지 | 11 | 11 |
| 실제 Policy로 분리한 이름 역할 | 관계의 이름 슬롯 | 16개 |
| 계산된 접근 관계 | 기존 계산 | 새 그래프에서 9행 재계산 |

원본 객체 286개 중 Link 재료로 뺀 GitHub ExternalIdentity 5개를 제외한 281개의 키와 신원 연결, 관측, 증거 연결을 모두 보존했다. 탐지 ID의 추가와 제거는 0건이다. 인터페이스는 27개 객체에서 바뀌었고 카탈로그 참조는 새 모델 Profile을 가리킨다.

### 보류한 관계 18개

Google `tokens.list`의 13개 Token 객체는 사용자와 OAuth client의 동의 기록이다. 실제 access token을 반환하는 레코드가 아니므로 Assignment로 분류하고 13개의 `authenticates_with`를 보류했다. 원문의 clientId는 테넌트 Integration으로 강제하지 않고 외부 locator로 유지한다.

Slack 매니페스트의 bot scope 설정 5개는 발급된 토큰의 증거가 아니다. 현재 스냅샷에서는 Policy로 표시하고 Credential에서 앱으로 향하던 `owned_by` 5개를 보류했다. 실제 OAuth bot 토큰의 저장된 지문이 확인되는 경우에만 Credential 분류를 적용한다. 객체를 삭제하지 않으며 보류한 관계 전체와 사유를 `model_report.json`에 보존한다.

### 계약 필드 9개는 미확인

현재 객체 297개 중 288개는 적용한 행 계약 필드를 모두 갖췄다. 나머지 9개는 다음 필드가 미확인이다.

| 대상 | 수 | 미확인 필드 |
| --- | ---: | --- |
| Google Drive Permission | 3 | expires_at |
| Google RoleAssignment | 3 | expires_at |
| GitHub Webhook | 1 | endpoint_owner |
| Slack 명령 Endpoint | 2 | endpoint_owner |

미확인을 무기한이나 자체 호스팅으로 바꾸지 않는다. `source.expiry_status`, `fixture_meta.model_v1.contract_status`, `unresolved_fields`와 보고서에 구분해 남긴다. 이는 부분 수집 상태이며 계약 필드가 완비된 객체로 세지 않는다. 식별자, 테넌트, 관계 끝점 누락, 잘못된 enum, 명시적으로 비밀 자재가 없는 Credential과 비밀값 누출은 오류로 처리한다.

## 결과와 검증

실측 출력은 git 제외 폴더 `src/data/aegi_inc_measured_model_v1/`에 저장한다.

| 파일 | 역할 |
| --- | --- |
| manifest.json | 새 모델 버전, 실행 카탈로그와 입력 스냅샷 해시 |
| objects.json, relations.json | 실제 투영 객체와 계약을 통과한 활성 관계 |
| model_profiles.json | 사용한 수집 Profile의 고정 사본 |
| model_report.json | 계약 미확인 필드, 분류 변경, 보류 관계와 원문 근거 |
| link_material.json | 그래프에 넣지 않은 신원 연결 재료(`link_only`)의 원본 레코드. 키는 `model_report.json`의 `link_only_objects`와 같다 |
| model_verification.json | 원본 키 보존, 탐지 차이, 참조 무결성과 산출물 해시 |
| effective_access.json | 기존 분석 질문에 대해 새 그래프에서 다시 계산한 결과 |

신원 연결 재료와 보고서의 키는 같은 코드 단위 순서로 정렬한다. 대소문자가 섞여도 로캘에 따라 순서가 달라지지 않으며, 입력 스냅샷 대조에도 같은 기준을 쓴다.

기존 `npm run dev`와 운영 데이터의 기본 경로는 유지한다. 새 모델 미리보기는 `dev:model-v1`로 명시해 실행하며 지정 데이터가 없으면 다른 데이터로 대체하지 않는다. production 빌드는 로컬 실측 데이터를 포함하지 않는다.

검사 명령은 다음과 같다.

```bash
npm run test:model-v1
npm run build
# PowerShell 예시. 실행 중인 새 모델 서버와 같은 경로를 지정한다.
$env:AEGI_DATASET_DIR='src/data/aegi_inc_measured_model_v1'
$env:AEGI_DEV_URL='http://127.0.0.1:5174'
$env:AEGI_SCREENSHOT_DIR='.codex-visual-check/model-v1'
npm run test:functional
```

2026-10-19 재검증(연구 결정 반영 뒤): 연구 회귀 71개, 수집 모델 회귀 20개, 전체 빌드와 객체 297개 데이터의 브라우저 기능 검사 235개 통과.

2026-10-19 첫 검증: 연구 회귀 68개, 수집 모델 회귀 18개, 전체 빌드와 브라우저 기능 검사 235개 통과. Overview와 그래프 세 수준의 캡처에서 수치, 색 대비, 겹침과 잘림을 확인했다. 새 데이터의 객체 302개 표시, 탐지 11건, 자격증명 30개와 계산된 접근 관계의 호버 및 상세 연결을 검사했다. 실행 로그와 화면은 `.codex-visual-check/model-v1/`에 남긴다.

운영 반영은 이 로컬 검토와 별도다. push, PR 생성이나 main 반영은 수행하지 않는다.
