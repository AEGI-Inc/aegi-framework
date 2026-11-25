# Relation Semantic Layer v1 — 관계의 두 층

**한 줄.** 관계는 두 층으로 둔다. **기록 층**은 지금 관계 17종이다(수집 · 정규화 · 화면 · Effective Access 가 쓴다, 그대로 둔다).
**의미 층**은 사실 9종과 능력 10종이다(엔진이 계산할 때 읽는 정식 어휘). SaaS 마다 다른 것은 표에만 있고 엔진 코드에는 없다.
목표는 **어느 SaaS 든 코드 수정 없이 표 줄만 더해 붙는** 공통 스키마다.

- 표: `ontology/semantic_mapping.yaml`(기록 층 → 의미 층), `ontology/capabilities.yaml` 끝의 「의미 층 능력 목록」
- 검사: `validation/check_semantic_layer.py`(run_all), 시험 `validation/test_semantic_layer.py`
- 기록 층: `Relation_Schema_v3`(행 모양), `ontology/relation_types.yaml` · `relation_semantics.yaml`(17종과 효과)

## 0. 왜 두 층인가 — 잰 것

2026-11-11, 11-04 운영 수집본(객체 2,242 · 관계 1,737)과 운영 로그 418종 17,231건으로 두 안을 같은 잣대로 쟀다.

| 잣대 | 지금(main) | 17종 보완(K) | 의미 층 9종(P) |
|---|---|---|---|
| 로그 행위 설명률(두 끝이 붙은 2,333건, 원래 권한) | 1,722 (74%) | 1,971 (84%) | **2,120 (91%)** |
| 같은 것, Okta 토큰 발급 236건을 빼고 셈 | 1,722/2,097 (82%) | 1,971/2,097 (94%) | 1,972/2,097 (94%) |
| 점수판(격차 쌍 · 정답 위협 · 사람 라벨 · 끊기) | 17 · 6/8 · 9/0/5 · 11/11 | main 과 같음 | main 과 같음 |
| 엔진 관계 계산 안 SaaS 이름 조건 | 4 | 4 | **0** |
| 관계 → 간선 조합 | 20 | 20 | **7** |
| SaaS 떼고 붙이기 | — | 코드 수정 듦(Okta) | 표 줄만(Salesforce 8줄, Okta 22줄, 코드 0줄) |

같은 기준에서 설명률은 둘 다 94% 로 같았다. 차이는 **엔진이 SaaS 를 모르고도 계산하느냐**다. 그래서 17종을 버리지 않고(수집 · 화면 · EA 가 이미 쓴다) 그 위에 의미 층을 얹는다.

처음 보는 SaaS 둘(Microsoft 365 · Entra ID 요소 103개, Notion 요소 72개)을 문서만으로 의미 층에 대 봤다(지면 시험). **새 관계 0, 새 객체 0.** 새로 나온 패턴 18개는 관계 위의 칸 8가지로 묶였다(4장).

## 1. 두 층의 경계

| | 기록 층 | 의미 층 |
|---|---|---|
| 무엇 | SaaS 가 준 사실을 잃지 않고 적는다 | 그 사실이 「누가 무엇을 할 수 있나」에서 무슨 뜻인지 |
| 어휘 | 관계 17종, interface 9종 | 사실 9종, 능력 10종, 근거 5종, 칸 8가지 |
| 누가 쓰나 | 어댑터 · 정규화 · 대시보드 · Effective Access · 사건 기록(Activity) | 엔진 간선 계산(위협 판정 · 격차 · 끊기) |
| SaaS 차이 | 관계 행의 칸 · 역할 이름 | `semantic_mapping.yaml` · `capabilities.yaml` 표 줄에만 |
| 바꾸는가 | 이번에 안 바꾼다 | 새로 정한다 |

- 기록 층 행은 그대로 저장한다. 의미 층 사실은 저장하지 않고 엔진이 표로 **계산**한다(같은 입력이면 같은 사실).
- 의미 층은 설정(스냅샷)에서만 나온다. 사건(Activity)은 사실을 만들지 않는다 — `basis: logged` 는 칸만 정했다(4.8).
- 표에 그 SaaS · 역할의 줄이 없으면 **틀린 답이 아니라 「모름」**이다(5장).

## 2. 사실 9종

| 사실 | 뜻 | 출발 → 도착 interface | 간선 |
|---|---|---|---|
| member_of | A 는 B 의 구성원 | Principal · Tenant → Principal · Tenant · Resource | M |
| contained_in | A 는 B 안에 있다. 위 권한이 내려오는 길 | 9종 → 9종 | U |
| grants | A 는 B 에 능력 caps 를 가진다 | Tenant · Principal · Integration · Credential · Policy · Endpoint → Tenant · Integration · Resource · Automation | G |
| holds | A 는 자격증명 B 를 쥔다 | Principal · Integration · Automation → Credential | A(뒤집어서, 쥐면 그 신원으로 동작할 때만) |
| acts_as | A 는 B 로서 동작한다 | Integration · Automation · Credential · Endpoint → Principal · Integration · Credential · Tenant | A |
| triggers | A 가 B 를 부른다(테넌트가 출발이면 그 구성원 누구나, 도착이 앱이면 설치된 앱을, 도착이 테넌트면 조직 기능을 부름) | Principal · Tenant · Resource · Integration · Endpoint → Automation · Integration · Tenant | T(신원 `caller` 면 없음, 4.9) |
| flows_to | A 의 내용이 B 로 흘러간다 | (Tenant 빼고 8종) → Tenant · Credential · Resource · Automation | F |
| conditions | 정책 · 설정 A 가 B 에 조건을 건다(포함 · 제외 · 요구) | Tenant · Policy · Integration · Credential · Assignment → Principal · Integration · Credential · Resource · Tenant | 없음(정보) |
| trusts | 테넌트 A 가 B 의 신원 주장을 믿는다 | Tenant · Integration → Tenant · Integration | 없음(정보) |

- 사실 하나에 간선 하나다. 지금 효과 표는 관계 종류 × 간선 종류 조합이 20 이지만 의미 층은 7 이다.
- 출발 · 도착 interface 목록은 표(`facts.from` · `to`)에 있고, 표 줄이 내는 사실의 끝이 그 밖이면 검사(SL4)가 잡는다.
- 기록 층 17종 → 9종은 **별칭 표**다(`semantic_mapping.yaml aliases`). 지금 효과 표(`relation_semantics.yaml`)에서 기계로 만든다:
  간선 M→member_of, U→contained_in, G→grants, A→acts_as(authenticates_with 의 A 는 holds), T→triggers, F→flows_to, rank 숫자 → 능력 묶음.
  다시 만든 것이 파일과 같아야 한다(SL1, 차이 0). 효과 표를 고치면 `python schema/ontology/tools/gen_semantic_aliases.py` 를 돌린다.
- 별칭 표 위에 손 줄을 얹는다: `routes_first`(먼저 볼 갈래), `drop_routes`(뺄 갈래), `filters`(모든 사실에 한 번 거는 거름), `records`(객체 하나가 사실을 말하는 규칙), `assignments`(배정 자리 선언, 3장).

### 사실 한 줄의 칸

```yaml
{ p: grants, from: <끝>, to: <끝>, caps: <능력>, basis: <근거>, mode: <호출 방식>, identity: own|caller, polarity: include|exclude|requires, uncertain: [사유], impersonate: true }
```

끝은 효과 표와 같다(source · target · everyone · grant · tenant · resource_set · resource_set_unexpanded). 레코드 규칙은 self · tenant · ref:<참조 칸> · tenant_of_from 을 쓴다.

## 3. 능력 10종과 묶음

| 능력 | 세기 | 뜻 | 11-04 로그 사건 수 |
|---|---:|---|---:|
| authenticate | 1 | 로그인 · 토큰 받기 · SSO | 6,786 |
| read | 1 | 보기 · 읽기 | 886 |
| write | 3 | 있는 것을 고치기 | 412 |
| create | 3 | 새로 만들기 | 390 |
| delete | 3 | 지우기 | 32 |
| share | 3 | 공유 · 내보내기 | 79 |
| send | 3 | 메시지 · 메일 보내기 | 73 |
| execute | 3 | 자동화 · 스크립트 · 명령 실행 | 70 |
| configure | 3 | 설정 · 정책 바꾸기 | 402 |
| grant | 5 | 남에게 권한 · 소속 · 역할 주기 | 405 |

묶음: **use** = [read], **edit** = [read, write, create, delete], **manage** = edit + [share, configure, grant], none = [].

- 능력 목록은 **지금 세기 표에서 계산한다**(`rank_capabilities`: 0 none, 1 use, 2 use, 3 edit, 4 edit, 5 manage). 표를 두 벌로 적지 않는다.
- 능력 목록의 세기 = 가장 센 능력의 세기. 세기 2(triage) · 4(maintain, organizer)는 1 · 3 으로 접힌다. 판정 문턱이 1 · 3 · 5 라서 결과가 같다(점수판 main 과 같음). 검사 SL5 가 접힘을 본다.
- 세기로 못 가르는 것은 목록을 바로 적는다: Okta 앱 배정 = [authenticate, read], Slack 채널 소속 = [read, write, send], Atlassian 사이트 사용자 = [read, authenticate].
- 아래로 내려가는 능력이 다르면 `{caps, below}` 로 적는다(2026-11-20). 간선 도착 자체에는 caps 전부, 상위 범위에서 내려간 아래 객체에는 below 만 남는다. Gemini Enterprise 앱 사용자 = `{caps: [read, create], below: use}`: 앱 안에 세션 · 에이전트를 새로 만들지만, 앱 아래 위젯 설정 · 남의 에이전트를 고치지는 못한다. below 없이 [read, create] 로 두면 만들기(쓰기 수준)가 아래로 내려가 3회차 실측에서 틀린 위협 2개가 생겼다.
- 역할 하나의 능력을 정하는 차례는 `capability_order`(지금 `role_rank_order` 에 사용자 정의 역할 권한 이름 단계를 base_role 앞에 끼운 것). 이름 단계가 볼 표의 차례는 `capability_name_steps`. 엔진은 provider 이름으로 가르지 않고 이 차례로 표를 본다.
- 지금 엔진 질의는 세기로 묻는다. 능력 이름으로 묻기(「만들 수는 있지만 읽지는 못한다」 같은 Notion 통합)는 칸과 계산까지 두고 질의는 후속이다.

### 근거(basis)

| basis | 뜻 |
|---|---|
| stated | 수집한 설정에 그대로 적힌 것 |
| computed | 설정 여럿을 합쳐 계산한 것(리소스 세트 펼치기, 같은 대상 권한 줄의 최댓값) |
| flag | 객체의 참 · 거짓 칸(Salesforce 권한 칸) |
| vendor_default | 설정이 아니라 벤더 기본값(기본 그룹, 기본 앱, Slack 워크스페이스의 조직 소속과 설치된 앱 호출). 조직이 바꿨으면 틀릴 수 있다 |
| logged | 스냅샷에 없고 로그 사건으로만 안 것. 관측 창 밖은 모름 |

판정은 근거로 갈리지 않는다. 권한 출처 표시와 회수 가능 여부만 다르다.

## 3-1. 배정 자리 선언 표

기록 층 명세는 「Assignment 객체 = 관계 한 행」이다. 실제로는 11-04 수집본 Assignment 472개 가운데 많은 수가 관계가 되지 않았다. 그래서 **Assignment 종류마다 한 줄**로 어떤 자리가 관계가 되는지, 왜 안 되는지를 적는다.

| 줄의 상태 | 뜻 | 지금 |
|---|---|---:|
| relation | 정규화가 이미 관계 행으로 만든다. slot 은 관계 행이 이 객체를 가리키는 칸 | 15 |
| emit | 의미 층이 이 객체에서 사실을 만든다(보유자 자리, 대상 자리, 능력, 상한) | 3 |
| skip | 관계로 바꾸지 않는 까닭(중복 · 자리 없음 · 권한 아님) | 8 |
| unverified | 수집본에 행이 없어 자리를 아직 못 봤다 | 6 |

- 카탈로그(`catalog/*/index.yaml`)의 Assignment 19종이 모두 있어야 하고(누락), 같은 종류가 두 줄이면 안 된다(중복) — 검사 SL2.
- 중복을 막는 것도 이 표의 일이다. Okta 사용자 정의 역할(CustomRole)과 Salesforce 세션 권한 활성화는 이미 has_role_on 이 있어 다시 바꾸면 같은 권한이 둘이 된다(11-11 K 에서 확인).
- 엔진 쪽은 수집본의 Assignment 종류가 이 표에 모두 있는지를 시험으로 본다(정규화 이름이 열쇠).

## 4. 지면 시험에서 나온 일반 개념 — 칸

새 SaaS 의 새 패턴은 새 관계가 아니라 **관계 위의 칸**으로 푼다. `semantic_mapping.yaml patterns` 에 칸 이름, 값, 쓰는 사실, 상태(computed 지금 계산 · declared 뜻만 정함)를 적는다.

### 4.1 상속 규칙 — `inherit`, `replaces_inherited` (contained_in · grants, declared)
위에 걸린 능력이 아래로 내려가나, 얼마나. `inherit: all | none | 능력 목록 | only(조건식)`. 아래에서 상속을 끊는 고유 권한은 `replaces_inherited: true`.
M365 제한 관리 단위 · SharePoint 고유 권한, Notion 「관리자 역할은 페이지에 안 내려감」 · 하위 페이지 상속 끊기, 지금 GWS 공유 드라이브 · Slack 비공개 채널.
지금은 `providers.yaml tenant_grants_inherit · inherit_caps` 가 SaaS 단위로 계산한다. 2026-11-16 부터 테넌트 권한은 `providers.yaml tenant_scope` 가 권한 출처 종류(소속, 콘솔 역할, 제품 사용, 기본 권한)와 객체 종류(내용, 설정, 계정)마다 정한다(aegi-knowledge#308). 엔진이 옮기면 `tenant_grants_inherit` 는 지운다.

### 4.2 상한 일반화 — `ceiling{caps, targets, on}`, `scope_role` (grants · acts_as, computed)
이 사실은 다른 권한을 넘지 못한다. **실효 능력 = 보유자 권한 ∩ 상한.** `scope_role: ceiling`(기본, 상한만) 또는 `grant`(그 자체로 권한 — Notion 사용자 정보 capability, Admin API).
11-11 에 Okta 앱 scope 동의를 권한으로 내 보니 설명률은 올랐지만 정답 사람 라벨 하나가 틀렸다(K · P 둘 다). Okta 관리 API 는 「앱에 걸린 관리자 역할 ∩ 동의한 scope」다. 그래서 scope 는 권한이 아니라 상한이다. 배정 자리 표의 `ceiling` 칸이 `conditions(requires)` 사실을 낸다. 질의가 읽는 것은 후속.

**범위 갈래(`range`, computed).** 능력이 아니라 닿는 대상을 자르는 상한이다. 범위가 수집된 자동화는 실행 신원 권한을 그 범위 안에서만 쓴다(**실효 = 실행 신원이 닿는 곳 ∩ 자동화 범위**). `automation_scopes` 표 한 줄이 자동화 종류 하나다. 범위 칸, 범위 객체 아래로 보는 관계(`below`), 범위를 자기 제품 객체에만 거는지(`own_product`), 동작이 고치는 제품(`actions`)을 적는다. 엔진 `accessModel.ts` 한 곳이 표를 읽고 둘로 답한다.

- 범위 안: 접근 규칙 `runs_as_inherits` 의 `automation_scope` 홉(EA 행)과 위협 판정의 편집 범위(규칙을 고칠 수 있는 사람)가 쓴다.
- 동작 범위: 범위 안 가운데 동작이 고치는 제품 자원만이다. 위협 판정의 호출 범위(규칙을 부르는 사람)와 닿음 질의의 구조 경로가 쓴다.

2026-11-17 에 Jira 자동화 규칙 줄을 두었다. 그 전에는 EA 와 위협 판정이 이 거름을 코드로 따로 들고 뜻이 달랐다. EA 는 프로젝트 객체만 범위로 잘랐고, 판정은 같은 SaaS 객체를 범위 프로젝트와 그 아래만 남겼다(aegi-knowledge#311).

### 4.3 조건의 대상 · 층 — `conditions_on`: `on`, `level`, `precedence` (computed: 설정 조건 표)
조건이 누구에게 걸리나(`on: holder | recipient | target`), 어느 설정 층에서 오나(`level`: 조직 · 워크스페이스 · 팀스페이스), 겹치면 누가 이기나(`precedence`).
M365 조건부 액세스 포함 · 제외, Notion 받는 쪽 제한(게스트 막기), Slack 워크스페이스 설정(관리자 아닌 구성원의 앱 설치).

**설정 조건 표**(`semantic_mapping.yaml settings`, 11-13). 한 줄 = 테넌트 설정 하나 = 「누구에게 어떤 능력을 어디에 허용 · 제한하나」.

| 칸 | 뜻 |
|---|---|
| select | 설정이 붙는 객체(테넌트) |
| property · values | 설정 값을 담을 객체 칸과 값 → allow · deny. 정규화가 벤더 칸을 이 이름으로 옮긴다 |
| default · default_source | 칸이 없을 때(수집하지 않음) 벤더 기본값과 그 출처 |
| holder · except · exempt | 걸리는 사람(지금 `tenant` = 구성원 전원), 허용해도 빠지는 사람(게스트 · 봇), 막아도 그대로인 사람(관리자) |
| target · caps | 능력이 걸리는 곳(`tenant` 또는 `objects:<종류>` = 그 테넌트와 상위 테넌트 안의 그 종류 객체)과 능력 목록 |
| collect | 칸을 아직 수집하지 않았으면 무엇을 받아야 하나(재수집 목록) |

- **허용**이면 grants 사실 하나(출발 = 테넌트, 도착 = target). except 구성원은 테넌트 소속을 펼 때 뺀다(역할 제외와 같은 길).
- **막음**이면 구성원(exempt 빼고)마다 conditions(exclude) 사실. 간선이 아니다. 질의가 상한(4.2)과 같은 자리에서 그 사람의 다른 근거 권한에서 그 대상의 그 능력을 뺀다. 상한은 「이것만 남긴다」, 깎기는 「이것만 뺀다」.
- **근거**: 칸이 있으면 `flag`, 없으면 `vendor_default` 에 모름 사유 `setting_not_collected`(조직이 기본값을 바꿨으면 틀림 — 확실이 아니라 불확실로 센다).
- 대상을 고르는 까닭: 앱 설치는 「앱에 scope 를 주는 일」(grant)이다. 워크스페이스 자체에 grant 를 주면 구성원 전원이 관리자처럼 계산된다. 그래서 대상은 그 워크스페이스의 앱 객체다. 채널 만들기처럼 테넌트 자체에 거는 능력(create)은 구성원마다 간선이 되고 세기 3 이라 「쓰기 이상 테넌트 권한」으로 세여, 질의가 create 를 따로 묻게 된 뒤 줄로 둔다.
- 11-04 운영 수집본에는 Slack 워크스페이스 설정 값이 없다(`admin.teams.settings.info` 응답에 설정 칸이 없음). 그래서 지금은 모두 벤더 기본값이고, 막음은 시험으로만 확인했다. `level` · `precedence` 는 층 둘을 같이 수집한 SaaS 가 없어 declared 다.

### 4.4 잠재 관계 도출 — `derive` (member_of · holds · grants, declared)
지금 사실이 아니라 「이것을 바꿀 수 있으면 이렇게 된다」. 규칙 셋: 속성 규칙 소속(`attribute_membership`, M365 동적 그룹), 스스로 가입(`joinable`, Notion 공개 팀스페이스), 자격증명 발급 = 그 신원(`credential_issuer`, M365 앱 소유자가 비밀 발급, Okta API 토큰, GitHub deploy key). 사실에는 `potential: true` 를 단다.

### 4.5 신원 연동 사본 — flows_to `visible_to: linked_identity`, `lag` (declared)
내용이 다른 SaaS 로 가도 보는 사람은 연동된 원래 신원의 권한을 따른다. Notion AI 커넥터, Okta 가져오기, Slack ↔ Salesforce 동기화(로그 MIRROR 묶음).

### 4.6 공개 여부로 멤버십 넓히기 — `visibility`, `non_member_caps`, `joinable` (member_of, declared)
공개 자원은 구성원이 아닌 사람도 설정값만큼 할 수 있다. M365 팀 공개 · 비공개, Notion 팀스페이스 공개 수준, Slack 채널. 지금은 `providers.yaml visibility_scoped` 와 공개 여부 규칙이 계산한다.

### 4.7 세션 · 자격 활성화 — `activation: standing | session | once`, `active` (grants · member_of, declared)
켜야 쓰는 자격. member_of 에도 건다(M365 PIM for Groups). 지금 Salesforce 세션 권한 세트는 has_role_on 의 `activation · session_active` 칸을 별칭 표 조건 갈래가 읽는다.

### 4.8 logged 의 관측 창 — `observed_window{from, retention}` (모든 사실, declared)
`basis: logged` 사실은 관측 창과 같이 적는다. 창 밖은 모름이다. Notion 은 권한 목록 API 가 없어 grants 대부분이 logged 가 된다 — 그런 SaaS 는 로그가 주 원천이다.

### 4.9 위임 호출 — triggers `identity: own | caller` (computed)
불린 쪽이 **누구의 권한으로** 동작하나. 호출 방식(`mode`: 부름 · 입력 · 코드 고침)과 따로 적는다.

| identity | 뜻 | 엔진 |
|---|---|---|
| own(기본, 적지 않음) | 불린 쪽이 자기 실행 신원(acts_as)으로 동작한다. 부른 사람은 그 신원의 권한을 빌려 쓸 수 있다 | T 간선. 격차 계산이 「부른 사람 → 불린 쪽 → 실행 신원의 권한」으로 이어 간다 |
| caller | 불린 쪽이 부른 사람 자신의 권한으로, 그 안에서만 동작한다(위임, 사용자 대신) | 간선을 내지 않고 사실로만 둔다. 로그 설명(호출 사건)만 읽는다: 행위자가 출발의 구성원(M*)이면 원래 권한으로 설명된다 |

- caller 호출은 부른 사람이 원래 할 수 있는 것을 넘지 않는다. 그래서 새 격차를 만들지 않는다. 그래도 「누가 이 앱을 불렀나」는 설정에서 나온 사실이라 로그 설명에 쓴다.
- 11-04 수집본: Slack AI 가 앱의 MCP 도구를 부른 사건 5건은 앱 봇이 아니라 부른 사용자의 연동 신원으로 돌았다. own 으로 적으면 켬 점수판이 격차 경로 13 → 33, 사람-경로 쌍 17 → 139, 위협 6/8 → 4/9 로 바뀌었다. caller 로 적으면 5건이 설명되고 점수판은 main 과 같다.
- 같은 수집본의 「Slack AI 요약 요청」 8건은 대상이 조직(테넌트) 하나다. 「구성원은 조직 읽기」(grants)로 적으면 조직을 container 로 단 파일 내려받기 · 캔버스 열기 8건까지 사람 권한으로 바뀌었다(상속을 끊어도 같다). 「구성원은 조직 기능을 부른다」(triggers, caller)로 적으면 요약 8건만 설명된다.
- 두 줄을 더한 결과(11-13): 설명 안 된 사건 46 → 33, 바뀐 사건은 그 13건뿐(설명 안 됨 → 위임 호출), 점수판 모든 칸과 켬 간선이 main 과 같다.
- 한 앱이 두 신원으로 다 돌면(봇 토큰과 사용자 토큰) 줄을 둘로 적는다. 봇으로 도는 호출(슬래시 명령 · 이벤트 구독)은 엔진 호출 게이트 줄이 따로 낸다.
- 지면 시험에서도 같은 갈림이 나온다: M365 위임 권한(delegated) · 애플리케이션 권한, Notion 통합의 사용자 대신 동작.

## 5. 원칙

1. **표가 없으면 틀린 답이 아니라 「모름」.** 역할 줄이 없으면 간선은 `role_rank_unknown` 으로 불확실하고, 사실 줄이 없으면 사실이 없다는 보고가 남는다. 11-11 Salesforce 를 표에서 빼 보니 확실 426건 → 0, 틀린 답 0, 점수판 같음. 붙이면 그대로 돌아왔다.
2. **로그에 없음 ≠ 권한 없음.** 「안 썼다」는 관측 창과 같이 회수 추천으로만 쓴다.
3. **로그 없는 환경은 같은 결과.** 의미 층 사실은 설정에서만 나온다. 11-11 로그(관측 · 증거 · 계보)를 지운 수집본에서도 의미 층이 더한 간선 집합이 같았다.
4. **SaaS 이름은 표에만.** 엔진 의미 층 코드는 provider 를 표 열쇠로만 쓴다. 새 SaaS 는 별칭 표가 이미 덮고(관계 17종은 SaaS 공통), 역할 이름 · 기본값 · 배정 자리 줄만 더한다. 지면 시험 어림으로 SaaS 하나에 8 ~ 177줄, 그중 약 30% 는 문서 · API 에서 기계로 뽑는다.
5. **설명률만으로 고르지 않는다.** 점수판이 「설명률은 오르는데 판정이 틀어지는」 고침을 잡는다(4.2). 표를 고치면 로그 설명률과 점수판을 같이 잰다.

## 6. 엔진이 읽는 법

- 엔진은 사전 사본(`ontology/`)에서 의미 층 표를 생성하고(`npm run ontology:gen`), 관계 절을 의미 층으로 계산한다. 기본은 켬이고(엔진 #396), `AEGI_REL_MODEL=record` 로 끄면 기록 층 길과 바이트로 같다.
- 관계 행 → (별칭 표 + 손 줄) → 사실 → 간선. 간선의 rank 는 능력 목록에서 계산한다.
- 이번 판에 계산하는 칸: caps · applies_to · basis · mode · identity · polarity · uncertain · impersonate, 배정 자리의 ceiling(conditions requires 사실), 설정 조건 표(grants 와 conditions exclude, 4.3). 나머지 칸은 declared 다.
- 엔진 쪽 위치(11-13): 기본이 켬이고 `AEGI_REL_MODEL=record` 로 끈다(engine #396). 질의는 능력 이름과 상한을 읽는다(engine #390). 설정 조건은 `engine/semantic/settings.ts`, 깎기는 `ceiling.ts underCeiling`.

## 7. 아직 아닌 것

- 능력 이름으로 묻는 질의(지금은 세기). Notion 「만들기만」, M365 위임 권한의 능력별 상한이 그것을 요구한다.
- 상한(ceiling)을 질의에 반영하기, 잠재 관계 도출 계산, 상속 · 공개 여부를 의미 층 칸으로 옮기기(지금은 providers.yaml 표가 계산).
- Effective Access 와 엔진 밖 코드(규칙 · 화면)는 기록 층 17종을 그대로 읽는다. 의미 층으로 옮길지는 따로 정한다.
- `basis: logged` 사실 만들기(사건 기록 Activity 위에서).
