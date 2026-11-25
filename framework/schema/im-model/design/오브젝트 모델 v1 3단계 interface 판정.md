# 오브젝트 모델 v1 3단계: interface 판정

<!-- model-v1-current:begin -->
## 현재 결과 (2026-10-19)

8개 SaaS 2,993개 후보를 모두 현재 요청 해시로 채점했다. 모델 응답 대기 0건, Object 후보 2,024개, 제외 968개, 인터페이스 미정 1개다. 아래의 2026-10-18 기록은 당시 4개 SaaS의 1차 결과다.

| SaaS | 후보 | Object 후보 | Object 제외 | 인터페이스 미정 | 응답 대기 |
| --- | ---: | ---: | ---: | ---: | ---: |
| github | 459 | 235 | 178 | 46 | 0 |
| okta | 369 | 295 | 34 | 40 | 0 |
| slack | 105 | 80 | 12 | 13 | 0 |
| gws | 119 | 84 | 16 | 19 | 0 |
| jira | 171 | 107 | 23 | 41 | 0 |
| confluence | 51 | 40 | 3 | 8 | 0 |
| salesforce | 1,703 | 1,130 | 334 | 239 | 0 |
| atlassian | 16 | 14 | 1 | 1 | 0 |
| 합계 | 2,993 | 2,024 | 968 | 1 | 0 |

원본 모양이 없는 부모 위치, 참조 ID 형식, 자격증명 값 자리는 구조 근거를 함께 보존했다. 같은 대상 묶음의 대표 판정은 직접 읽는 엔티티 정의를 먼저 보고, 배정 레코드의 참조 ID에 붙은 Assignment가 User 같은 실제 대상 타입을 바꾸지 않게 했다.

### 이번 수정

- 예전 공간명만 같은 점수는 재사용하지 않는다. 현재 공개 요청 본문 해시가 같고 13개 진술과 10개 선택지의 응답이 모두 유효할 때만 완료로 센다. HTTP 인증, 호출 제한 오류와 연속 실패는 전송을 멈춘다.
- 식별자 부재 N2를 Credential 규칙보다 먼저 적용한다. Git commit의 SHA, tree와 parents, 별도 생성과 읽기 API를 원문으로 확인해 실행 이벤트 오판을 고쳤다. 외부 이메일과 OAuth client locator는 독립 테넌트 Object에서 제외한다.
- 인터페이스 계약과 Object v4.1을 고정 소스에 묶었다. 원본 필드의 권한, URL, 비밀값은 관계, Endpoint와 감춤 대상으로 분리할 과제로 기록한다. 실제 투영 행의 계약 검사 통과는 0개이며 미수집이다.

임계값은 기존 4개 SaaS의 포함 기준표 229개 공간으로 맞췄다. 같은 기준표에 대한 완전 일치는 158/229이며 독립 검증 정확도가 아니다. 다른 4개 SaaS에는 같은 기준을 적용했지만 별도 정답표가 없다. 낮은 확률의 판정을 반복 호출해 확정으로 바꾸지 않았다.

구체적 근거와 다음 확인은 [진행 현황](오브젝트%20모델%20v1%20진행%20현황.md), `out2/v1/review_queue.json`, `out2/iface_contract_audit.json`을 따른다. 남은 1개를 인터페이스 확정으로 세지 않는다.

## 이전 1차 기록
<!-- model-v1-current:end -->


- 작성일: 2026-10-18
- 상태: 4개 SaaS 1차 판정 끝 (2026-10-18). Jira, Confluence, Salesforce, Atlassian 은 다음 차례
- 입력: 정보 지도 `candidate-extraction/ir2/out2/<p>/map/info_map.json` (읽기만 한다. `map3.py`는 2단계 세션이 고친다), 2단계의 같은 대상 묶음 `same_entity.json`
- 기준: `aegi-schema/docs/Interface_Spec_v3.md`(interface 9종의 판별 기준과 계약), `Object_Schema_v4.1.md`(Object가 아닌 것, 버리는 정보)

## 요약

1차 결과(GitHub, Okta, Slack, Google Workspace, 오브젝트 후보 공간 1,052개)

| SaaS | 후보 | 오브젝트 | 오브젝트 불가 | 미정 | 정답표 완전 일치 |
| --- | --- | --- | --- | --- | --- |
| GitHub | 459 | 233 | 179 | 47 | 50/59 |
| Okta | 369 | 296 | 32 | 41 | 69/109 |
| Slack | 105 | 83 | 9 | 13 | 7/12 |
| Google Workspace | 119 | 86 | 14 | 19 | 29/47 |
| 합계 | 1,052 | 698 | 234 | 120 | 155/227 (68%) |

- 정답표와 다른 72곳은 대부분 해석이 갈리는 경우다(장치를 Resource로 볼지 Endpoint로 볼지, 도메인을 Tenant로 볼지 Resource로 볼지, NetworkZone을 Policy로 볼지 Endpoint로 볼지). 사람이 볼 목록으로 남긴다(6.4절).
- 오브젝트 불가 234개 중 GitHub 152개가 GraphQL 타임라인 이벤트와 감사 항목이다(N1).
- 기존 자료가 「제외」한 공간 99개 중 오브젝트 불가로 나온 것은 9개다. 기존 「제외」는 범위 판단이지 「오브젝트가 될 수 없음」이 아니었다.

결정(2026-10-18): Q1(N5 조회, 집계 결과를 오브젝트 불가 기준에 넣음, aegi-schema 반영 후보로 표시), Q2(4개 SaaS 먼저) 모두 권고대로.

3단계는 세 가지를 판정한다.

1. 어떤 ID 공간이 오브젝트가 될 수 없는가 (오브젝트 불가)
2. 오브젝트가 되는 공간에 어떤 interface가 붙는가 (9종, 여러 개 가능, 같은 것 두 번은 안 됨)
3. 어떤 정보를 버려도 되는가 (속성 단위)

판정은 원문 구조로 정할 수 있는 것은 규칙으로, 판별 기준이 뜻을 묻는 것은 Jev 진술로 한다. Jev 기준 확률은 기존 자료의 interface 판정(정답표)으로 맞춘다.

## 1. 오브젝트 불가

aegi-schema가 Object가 아니라고 정한 것만 쓴다.

| 번호 | 기준 | 원문 근거 | 지도에서 알아보는 법 |
| --- | --- | --- | --- |
| N1 | 실행 인스턴스와 감사 이벤트는 Object가 아니다 | Interface_Spec Automation 절 「workflow run, job, function invocation은 감사 이벤트 평면이다」, Slack_Profiles 「감사 로그는 Object가 아니다」 | 이벤트 기록 레코드(`catalog:record`), GraphQL 타임라인 이벤트와 감사 항목(F1), 실행 기록 공간. 앞의 둘은 구조로, 실행 기록은 Jev로 |
| N2 | 식별자를 만들 수 없는 대상은 수집하지 않는다 | Object_Schema 「식별자를 만들 수 없는 대상은 수집하지 않는다」 | 키가 빈 복합키(G11, G12, G14, G17~G20), 값 정체성 공간 중 키가 안 잡힌 것 |
| N3 | 봉투와 전송 메타데이터는 버린다 | Object_Schema properties 2절 | 봉투 결정자(`envelope:`), 응답 상태 자리. 이미 지도에 있다 |
| N4 | 벤더 전역 아티팩트는 테넌트 Object가 아니다 | Interface_Spec Integration 절 「provider 아티팩트는 `references.provider_artifact`에 `kind: external_locator`」 | 테넌트 맥락 없이 전역으로 읽히는 레코드(GitHub App 원본, Marketplace 목록). Jev로 |

명세에 직접 없지만 1단계 판단표와 리뷰에서 나온 것 하나를 따로 둔다. 결정이 필요하다.

| 번호 | 후보 기준 | 예 |
| --- | --- | --- |
| N5 | 다른 오브젝트를 조회하거나 집계한 결과 (검색, 통계, 보고서, 메타 정보) | GitHub `search/*`, `server-statistics`, `rate-limit-overview`, Google Chrome 사용 보고 |

## 2. interface 부여

### 2.1 규칙으로 정하는 신호

| interface | 신호 | 근거 |
| --- | --- | --- |
| Tenant | 부모 사슬의 맨 위 공간, 다른 공간이 소속으로 가리키는 공간(`references.tenant` 자리) | 판별 기준 「이게 사라지면 소속 Object의 식별자가 의미를 잃는가」 |
| Assignment | R1 relation 레코드(조합 레코드, 목록 부모 relation, D5 연결) | 「주체와 권한을 잇는 개별 배정」. Assignment는 관계 자신이다 |
| Credential | R2a 복합키(자격증명 값 자리). 자격증명 보유 대상(H)은 신호만, 부여는 따로 | 「유출되면 사칭이 성립하는가」, 계약 `material_location` |
| Policy | 레코드를 만들고 고치고 지우는 동작이 따로 있다 | 「규칙이 독립적으로 CRUD 되는가」 |
| Endpoint | 레코드가 테넌트 밖 주소를 담는다(URL 자리), 주소 하나가 Object 하나 | 「경계를 넘는 주소인가」 |

규칙 신호는 후보를 좁히는 데 쓰고 그것만으로 확정하지 않는다. 예: CRUD가 있는 Resource(저장소)도 많다.

### 2.2 Jev 진술

9종의 판별 기준을 진술문으로 바꿔 공간마다 한 요청에 보낸다(원자 진술 9개 + 오브젝트 불가 진술 N1, N4, N5). 보낼 것은 공개 명세 값뿐이다: 단건 위치, 스키마 이름, 속성 이름, 동작 종류. criteria 예시는 우리 SaaS 밖 분야에서 고른다.

| interface | 진술 (요지) |
| --- | --- |
| Tenant | 이 기록이 없어지면 그 아래 기록들의 식별자가 의미를 잃는 조직 경계다 |
| Principal | 「___가 X 권한을 가진다」의 빈칸에 들어가는 신원이다 |
| Integration | 벤더 소프트웨어가 이 테넌트에 등록, 설치됐다는 사실이다 |
| Credential | 유출되면 다른 주체를 사칭할 수 있는 자격증명이다 |
| Assignment | 이것만 지우면 권한만 사라지고 주체와 대상은 남는다 |
| Policy | 접근, 보안, 동작 조건의 정의이고 따로 만들고 고치고 지운다 |
| Endpoint | 테넌트 경계를 넘어 데이터가 오가는 주소다 |
| Resource | 사람이 만들고 열고 고치는 업무 대상이고 「X에 대한 권한」이 자연스럽다 |
| Automation | 테넌트 안에서 실행되어 다른 기록을 바꾸는 로직 정의다 |

### 2.3 정답표와 기준 확률

기존 자료(확정 목록 Final_Reconciliation)의 판정을 1단계 대조(`object_audit.json`)로 공간에 붙인 것을 정답표로 쓴다.

| SaaS | 「포함」 라벨이 붙은 공간 | 여러 interface | 「제외」, 「보류」 행이 닿은 수 |
| --- | --- | --- | --- |
| GitHub | 66 | 4 | 31 |
| Okta | 127 | 6 | 39 |
| Slack | 30 | 7 | 15 |
| Google Workspace | 53 | 2 | 42 |

interface마다 Jev 확률의 기준값을 정답표에서 고르고(정밀도 우선), 맞힌 비율과 틀린 사례를 보고한다. 정답표 자체가 틀린 경우가 있으므로(1단계에서 근거 칸 오류 13건), 어긋난 사례는 사람이 본다.

Jira, Confluence, Salesforce, Atlassian은 정답표가 없다. 네 SaaS에서 맞춘 기준값을 그대로 쓰고, 표본을 사람이 본다.

## 3. 버릴 정보 (속성 단위)

| 기준 | 원문 근거 | 처리 |
| --- | --- | --- |
| 봉투, 전송 메타데이터 | Object_Schema properties 2절 | 버림. 지도의 `envelope:`, 응답 메타 |
| 자격증명 값, 아이콘 URL | properties 6절 | 저장 안 함 (redact) |
| 테넌트마다 달라지는 값, 권한, 스코프 목록 | properties 6절 | 속성이 아니라 Relation |
| 다른 걸 가리키는 값 | properties 4, 6절 | references |
| 남은 고아 정보 | (1단계 남은 것) | N5 후보는 버릴 정보로, 나머지는 사람이 본다 |

## 4. 결과물

- `candidate-extraction/ir2/iface_judge.py` (새 파일): 지도를 읽고 규칙 신호와 Jev 진술을 합쳐 공간마다 판정을 낸다. `map3.py`는 고치지 않는다.
- `out2/<p>/iface/` : 공간별 판정(오브젝트 불가 사유, interface 후보와 근거 등급), 정답표 대조.
- 판단표처럼 사람이 확인할 사례 표.

## 5. 정할 것

| 번호 | 질문 | 권고 |
| --- | --- | --- |
| Q1 | N5(조회, 집계 결과)를 오브젝트 불가 기준에 넣을까 | 넣는다. 다만 명세에 없는 기준이라 aegi-schema 반영 후보로 표시한다 |
| Q2 | 범위: 정답표가 있는 4개 SaaS 먼저, 나머지 4개는 그 뒤 | 4개 먼저 |


## 6. 1차 결과 (2026-10-18)

### 6.1 실행

- `iface_judge.py jev <p> --send`: 오브젝트 후보 공간마다 Jev 요청 하나. 진술 13개(interface 9, 오브젝트 불가 N1, N4, N5, 설정 묶음 S)와 Choice 하나(「가장 맞는 하나」, 9종과 none). 1,052개 공간, 캐시는 `out2/<p>/iface/jev_cache.jsonl`.
- `iface_judge.py calibrate`: 정답표로 진술별 기준값을 고른다(`out2/iface_calibration.json`).
- `iface_judge.py judge <p...>`: 규칙 신호와 합쳐 `out2/<p>/iface/judgement.json`, 요약 `out2/iface_summary.json`.

### 6.2 정답표

1단계 대조(`object_audit.json`)의 「포함」 판정을 공간에 붙였다. 잡음을 줄이려고 두 조건을 걸었다: 한 행이 공간 2개 이하에만 닿을 것, 같은 공간에 닿은 포함 행들의 interface가 같을 것. 227개 공간이 남았다(처음 조건 없이 247개였을 때는 Slack 채널 공간이 Credential로 라벨되는 식의 번짐이 있었다).

### 6.3 판정 규칙과 그렇게 정한 이유

| 단계 | 규칙 | 이유 |
| --- | --- | --- |
| 1 | 규칙 신호로 정하는 것: Credential(R2a 복합키), Assignment(D5 연결 레코드), Policy(원문 역할 목록), 오브젝트 불가 N2(키 재료 없음) | 원문 구조로 정해진다 |
| 2 | Choice가 고른 하나. none이면 진술 중 정답표 기준값을 넘은 것의 최고값, 넘은 것이 없으면 붙이지 않는다 | 진술별 기준값만 쓰면 완전 일치 0.51, Choice를 쓰면 0.70. 기준값 아래 최고값을 쓰면 Okta OrgCAPTCHASettings가 Tenant 0.39로 붙었다 |
| 3 | 진술 0.9 이상은 더 붙인다 (여러 interface) | 정답표의 여러 interface 공간 19개 |
| 4 | Tenant는 구조 신호가 있을 때만: 부모 사슬 맨 위이면서 자식 공간 3개 이상, 다른 공간 10개 이상이 가리킴, 참조로만 쓰이는 형식, 부모 위치 공간. 또는 Choice(0.9 이상)와 진술(0.7 이상)이 함께 Tenant | 단일 자원이라는 것만으로 열면 조직 설정, 호출 한도가 Tenant가 됐다 |
| 5 | 설정 묶음 진술 0.7 이상이면 model interface를 떼고 「부모의 속성 후보」(S) | 1단계 D2와 같은 종류. Okta OrgPreferences, GitHub branch protection 하위 설정 등 |
| 6 | Choice가 none이고 N1, N4, N5 중 0.7 이상이면 오브젝트 불가 | 정답표 「포함」 227 공간에서 N1, N4, N5가 0.7 이상인 것은 3개뿐 |

진술 문구에서 고친 것: Credential을 「새면 사칭」만으로 물으면 deploy key, GPG 키(등록된 공개키 쪽)가 빠졌다. 명세는 이것도 Credential(key_pair)이라 「키 쌍이나 인증서의 등록된 쪽」을 넣었다. 그 뒤 Credential F1 0.64 → 0.91.

진술별 정답표 대조(기준값, 정밀도, 재현율): Credential 0.65, 0.96, 0.87 / Endpoint 0.6, 0.82, 0.75 / Tenant 0.55, 0.75, 0.75 / Policy 0.3, 0.69, 0.77 / Principal 0.8, 0.76, 0.68 / Assignment 0.75, 0.8, 0.63 / Automation 0.7, 1.0, 0.5 / Resource 0.35, 0.71, 0.42 / Integration 0.3, 0.32, 1.0. Integration과 Resource 진술은 따로는 약해서 Choice에 기댄다.

### 6.4 정답표와 다른 곳 (많은 순)

| 정답표 | 판정 | 수 | 예 | 성격 |
| --- | --- | --- | --- | --- |
| Policy | Integration | 6 | GitHub OrganizationIdentityProvider, Slack 앱 설정 `configs` | 해석이 갈림. SSO 설정은 정책이자 연동 |
| Policy | 미정 | 6 | GitHub VerifiableDomain, custom-property | Jev가 하나를 못 고름 |
| Resource | 미정 | 6 | Okta DomainResponse, Realm, Google Domain | 도메인, 영역의 성격 |
| Policy | Resource | 5 | Okta AuthorizationServer, DeviceAssurance | 해석이 갈림 |
| Assignment | Principal | 4 | GitHub ExternalIdentity, Okta IdP 앱 사용자 | 외부 신원 연결을 배정으로 볼지 신원으로 볼지 |
| Resource | Integration, Endpoint | 8 | Okta AgentPool, DeviceWithProviders, Google ChromeOsDevice | 장치, 에이전트의 성격 |
| Policy | Credential | 3 | Okta AuthenticatorBase, ClientAuthSettings | 인증 방식 정의 |
| Endpoint | Automation | 2 | Okta EventHook, InlineHook | 훅은 주소이자 흐름 개입 |
| Policy | Endpoint | 2 | Okta NetworkZone, TrustedOrigin | 주소 목록을 담은 정책 |

### 6.5 정보의 갈 곳 (속성 단위, 정보 항목 수)

| 갈 곳 | Slack | GitHub | Okta | Google |
| --- | --- | --- | --- | --- |
| properties (속성) | 1,307 | 3,072 | 5,874 | 2,936 |
| references (참조) | 278 | 378 | 541 | 41 |
| relation, 부모 안 레코드 | 318 | 147 | 63 | 7 |
| 이벤트 평면 (Relation 추출원, Object 아님) | 585 | 5,815 | 1,199 | 911 |
| 오브젝트 불가 공간의 정보 (N1, N4, N5, S) | 86 | 926 | 401 | 126 |
| 버림: 봉투, 응답 상태 | 8 | 12 | 53 | 15 |
| 저장 안 함: 자격증명 값 | 11 | 1 | 9 | 0 |
| 고아 (사람 확인) | 1,111 | 788 | 655 | 314 |

오브젝트 불가 공간의 정보는 성격에 따라 갈린다: N1(사건 기록)은 이벤트 평면, N5(조회, 집계)는 버림, N4(벤더 전역)는 `external_locator` 참조, S(설정 묶음)는 부모의 속성.

### 6.6 한계

- 정답표 자체가 기존 자료의 판정이라 그 판정의 해석 차이가 그대로 들어 있다. 일치율은 「기존 자료와 같은 해석」을 잰 것이지 정답률이 아니다.
- Jev에는 공간의 이름, 위치, 스키마, 필드 이름만 보낸다. 설명 글을 읽지 않으므로 이름이 불분명한 공간(Slack `200.*`)은 판정이 약하다.
- 미정 120개는 Choice가 none을 골랐고 오브젝트 불가 진술도 0.7을 넘지 않은 것이다. 사람이 보거나 Jira 등과 함께 2차로 본다.
- interface 계약(Integration의 「권한 목록 필드가 없어야 한다」 등) 검사는 아직 안 했다. 4단계(relation 적용) 전에 한다.
