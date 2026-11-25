# aegi-schema 기준 재추출 vs 우리 어댑터 — 2026-09-28

`AEGI-Inc/aegi-schema`(2026-09-27 `4742e79`)의 규격으로 **우리 실측 원본(`collected/`)에서 Object·Relation·Link 를 다시 뽑고**,
지금 정규화 어댑터(`scripts/collect/normalize/`)가 만든 `src/data/aegi_inc_measured_v1/` 과 행 단위로 맞댔다.

- 입력은 같다 — 원본 11회 실행분, 호출 선택 규칙도 `raw.ts` 와 같다 (상태 호출은 쓸 만하게 끝난 최근 실행, 로그는 전 실행)
- 재추출기: `scripts/schema-reextract/` (Profile 46종 `profiles.yaml` + 엔진). 결과는 `collected/schema-reextract/`(git 제외)
- 수치는 전부 재추출기가 다시 낸다. 이 문서와 어긋나면 그쪽이 맞다

## 1. 결론

1. **객체 선정과 interface 는 맞다.** 우리 카탈로그 51종이 aegi-schema 확정 목록(318건)과 이름·interface 모두 일치한다. 차이는 **무엇을 관계로 만드느냐**와 **식별·테넌트 규칙**에 있다
2. **관계는 절반만 겹친다.** 우리 305행 중 155행이 규격과 같고, 27행은 역할 자리가 빠졌고, **123행은 규격이 만들지 않는 행**이다. 규격 쪽에는 우리에게 없는 216행이 있다
3. **우리 305행이 전부 `basis: stated` 다.** 어댑터가 basis 를 적지 않고 `dataset.ts` 가 기본값을 채운다. 규격이 명시적으로 금지한 패턴이다 — GitHub 협업자 `role_name` 처럼 벤더가 합친 값(`computed`)도 회수 가능한 부여 기록처럼 보인다
4. **Link 는 level 을 집합 하나에 하나만 둔다.** email 로 붙은 Slack 하나 때문에 벤더 외래키로 확정되는 GWS 연결까지 `candidate` 로 내려간다. 반대로 탐지 룰은 level 을 **아예 안 본다**. 규격은 간선마다 level 을 두고 다른 level 을 섞어 전이로 닫지 않는다
5. **시나리오 C·D 의 격차 집합이 규격에서는 달라진다.** 수집 봇(측정 도구)과 MFA Reset 봇 사용자가 격차에 들어온다. 규격에는 측정 도구 계정을 빼는 규칙이 없고, 봇을 사용자 식별자(U…)로 잡기 때문이다 (§6)

## 2. aegi-schema 가 정하는 것 (요약)

저장되는 것 셋, 저장 안 되는 것 둘.

| | 문서 | 핵심 |
| --- | --- | --- |
| 저장 | Object_Schema_v4.1 | 대상 하나 = 한 행. 동일성 키 `(provider, service, object_type, primary 전부, parent ?? tenant)`, **2단계 합치기**(스코프 없는 관측은 쪼개지 않는다). 참조로만 나온 id 는 껍데기(stub) 노드. **감사 로그에만 나온 id 는 노드로 만들지 않는다** |
| 저장 | Relation_Schema_v3 | 어휘 17종 동결. `has_role_on` 만 3항이고 역할은 **언제나 role 슬롯**, 범위 없으면 테넌트. `basis`(stated/computed/flag) **생략 불가**. Assignment 객체는 끝점이 아니라 **관계 자신**. 교차 provider 관계는 출발점이 Integration·Automation·Credential·Endpoint 이고 stated 일 때만 |
| 저장 | Link_Schema_v3 | 신원 판단은 Relation 과 **다른 저장소**. IdP 허브 경유만, 간선마다 level(disclosed_relation / resolved / possibly_same / possibly_related / different), **resolved 만 허브 안에서 전이**, 숫자 신뢰도 금지, 질의가 켜야 넘어간다 |
| 계약 | Interface_Spec_v3 | 9종 고정. Integration 은 **권한·스코프 목록 필드를 갖지 않는다**(권한은 Assignment/`has_role_on` 으로) |
| 계약 | Profile_Schema_v4.2 | 참조 → 관계 매핑은 Profile 이 쥔다. **tenant·parent 는 기본이 관계 아님**(명시해야 관계). `relation_type` 세 상태: 없음 / `null`(어휘에 자리 없음, 대기열) / `no_relation`(관계 아님 판정) |

구현이 실제로 있는 것은 Slack 뿐이다(`collect/slack/`, 127노드 / 190행 기준선). Okta 는 OpenAPI 로만 쓴 초안(`relation_type` 미기재), GitHub·GWS 는 파일럿 5종이다.

## 3. 방법

`profiles.yaml` 46종. 출처를 행마다 적었다.

| 출처 | 종 | 무엇 |
| --- | --- | --- |
| `slack_v3` | 5 | Slack_Profiles_v3 선언 그대로 (enterprise, team, user, channel, usergroup) |
| `okta_v3` | 6 | Okta_Profiles_v3 의 식별자·참조에 Relation_Schema_v3 규칙으로 `relation_type` 을 채움 |
| `pilot_v3` | 4 | Pilot_Profiles_v3 (github.enterprise·organization, okta.org, gws.customer) |
| `derived` | 31 | 규격에 Profile 이 없어 규격 본문이 인용한 근거로 씀. `confidence: inferred` |

엔진은 aegi-schema `collect/slack/collect.py`·`relate.py` 를 일반화했다 — 2단계 합치기, 껍데기, `as_relation`(관측 범위 안에서만), Assignment slot, `basis` 우선순위(stated > computed > flag), L1 template 검사(contained_in 제외), 끝점 검사.

**규격으로 못 적어서 엔진을 넓힌 곳**(`x_` 접두사). 이것 자체가 규격 쪽 결과다(§7).

| 확장 | 왜 |
| --- | --- |
| 하위 리소스 엔드포인트에서 부모 id 를 요청에서 받기 (`x_or_from`, `x_id_by`) | `/groups/{id}/users`, `conversations.members`, `/teams/{slug}/members`, 협업자, PAT 저장소 등 **10곳**(Slack 2, Okta 2, GitHub 5, GWS 1). Okta_Profiles_v3 가 「가장 큰 구멍」이라 적은 6번이 Okta 밖에서도 나온다 |
| 레코드마다 다른 역할 이름 (`x_policy_path`) | GitHub 협업자·팀 저장소 `role_name`. `policy.const` 로는 못 적는다 |
| 행마다 다른 relation_type (`assignment.x_when`) | Drive 권한 `type: domain` 은 `shared_with`, 나머지는 `has_role_on` |
| 같은 provider 안에서 email/login 참조를 id 로 풀기 | Drive `owners[].emailAddress`, GH-22 `login` |

## 4. Object

| | 우리 | 규격 |
| --- | --- | --- |
| 행 | 242 | **330** (껍데기 16) |
| 같은 대상 | 242 전부 규격에도 있다 | — |

규격에만 있는 88행:

| 무엇 | 행 | 왜 |
| --- | --- | --- |
| `github.credential_authorization` | 26 | **GH-22 를 수집하고도 정규화하지 않는다.** SSO 승인 자격증명 — `didwl-aegi` 의 **Copilot SWE Agent** 토큰 3건이 여기 있다(시나리오 A 보류 경로의 흔적) |
| `okta.policy_rule` | 14 | 어댑터가 `/policies/{id}/rules` 페이지를 거른다(`okta.ts` 의 `!e.request_params.policy`). 수집은 됐다 |
| `okta.role_assignment` | 12 | 우리는 배정을 관계로만 만든다. 규격(Okta_Profiles_v3)은 Assignment 객체 → 관계 |
| `okta.role_binding` | 3 | 리소스셋 바인딩. 키 `(resourceSetId, roleId)` (Object_Schema_v4.1 예시) |
| `slack.app` | 14 | 11 = `bots.info` 의 `app_id`, 3 = 껍데기. 우리는 `admin.apps.approved.list` 가 비어 앱 객체 0 |
| `slack.user` | +15 | **봇 사용자(U…)를 user 로 둔다.** 우리는 봇을 `bot`(B…) 하나로만 둔다. 수집 봇·Slackbot 포함 |
| 껍데기 | 4 | GitHub web-flow(19864447), Drive 폴더, Okta 앱 1(리프레시 토큰의 클라이언트), Slack 봇 `B01` |

식별·테넌트 차이:

| | 우리 | 규격 |
| --- | --- | --- |
| Slack 테넌트 | 워크스페이스 `T0EXAMPLE03` | **엔터프라이즈 `E0EXAMPLE03`** (Slack_Profiles_v3: `team_id` 는 우리가 물어본 곳이지 객체 성질이 아니다) |
| Slack 봇 | `bot` B… 한 노드 | `user` U…(채널 멤버십·`acts_as` 대상) + `bot` B…(`bots.info`) 두 노드. 둘을 잇는 어휘는 없다(`null`) |
| Okta 클라이언트 | `OAuth2Client` 와 `Application` 을 같은 0oa… 로 두 번 | 같음. 역할 배정의 주체를 규격은 `app` 으로 받는다 — 벤더가 두 이름으로 부르는 대상, 규격도 미결 |
| Okta `service` | `management` | `null` (단일 표면이면 null) |
| 감사 로그에만 나온 Slack 그룹 | 노드로 만든다(`seen_in: audit_log`) | 만들지 않는다. 이번 원본에서는 SL-06·SL-15 에도 나와 결과는 같다 |

## 5. Relation

```
우리 305 / 규격 399
  같은 행            155   (그중 basis 가 다른 것 5)
  역할 자리만 다름     27   우리는 role 이 비어 있다
  우리에만          123
  규격에만          216   (+ 규격의 PAT -> 저장소 1행)
```

### 5.1 우리에만 있는 123행 — 전부 규칙 차이로 설명된다

| 행 | 무엇 | 규격 근거 |
| --- | --- | --- |
| 40 | `contained_in X → 테넌트` (그룹 7, 정책 9, 저장소 6, 파일 4 …) | Profile_Schema_v4.2 「tenant 와 parent 는 기본이 관계 아님」. `references.tenant` 에 이미 있다 |
| 3 | `contained_in usergroup → 워크스페이스` | 테넌트가 엔터프라이즈 |
| 31 | `contained_in Assignment → 대상` (AppUser 26, ApplicationGroupAssignment 1, Drive Permission 4) | Assignment 는 관계 자신. 같은 사실을 `has_role_on` 이 담는다 |
| 36 | `contained_in UserFactor/RefreshToken → User` | v1.2 #4: 자격증명 귀속은 `authenticates_with` + reverse (규격 쪽 36행과 짝) |
| 9 | `member_of bot(B…) → channel` | 규격은 봇 사용자 U… 가 멤버 |
| 3 | `has_role_on OAuth2Client → org` | 규격은 같은 id 를 `app` 으로 |
| 1 | `has_role_on 사용자 --[PAT 권한]--> 조직` | 규격은 **선택된 저장소**로 편다(`internal-ops-tools`). slot target 이 배열이면 행을 편다 |

### 5.2 규격에만 있는 216행

| provider | 행 | 무엇 | 우리 쪽 상태 |
| --- | --- | --- | --- |
| Slack | 23 | `member_of user → team` (`enterprise_user.teams` stated / 조회 워크스페이스 computed) | 없음 |
| Slack | 12 | `has_role_on user --[owner·admin·primary_owner]--> team/enterprise` (`is_*` 불리언, basis flag) | `is_admin` 등이 속성으로만 있다. **"누가 워크스페이스 관리자인가" 가 그래프에 없다** |
| Slack | 16 | `shared_with channel → team` (`internal_team_ids`) | 없음 |
| Slack | 14 + 11 | `acts_as app → 봇 user`, `registered_in app → enterprise` | 앱 객체가 없다 |
| Slack | 17 | `owned_by bot/bot-token/slash/webhook → app` | **어댑터가 만들었다가 끝점(앱) 없음으로 버린다** (`normalize_report.json` dropped 17). 규격은 껍데기로 살린다 |
| Slack | 15 | `member_of user → channel` | 9 = 봇 식별자 차이, **6 = 수집 봇**(우리는 측정 도구라 뺀다) |
| Okta | 36 | `authenticates_with user → factor/refresh_token` | 5.1 의 36행과 짝 |
| Okta | 14 + 1 | `owned_by refresh_token → app`, `owned_by group → app`(앱이 마스터하는 그룹) | 참조로만 |
| Okta | 14 | `contained_in policy_rule → policy` | 규칙 객체 없음 |
| Okta | 3 | `has_role_on app → org` | 5.1 의 3행과 짝 |
| GitHub | 26 | `authenticates_with user_account → credential_authorization` | GH-22 미정규화 |
| GitHub | 3 | `member_of user_account → enterprise` (ExternalIdentity 는 Assignment) | 객체만 |
| GitHub | 2 | `has_role_on app_installation --[권한]--> org` | 설치 객체 속성 `permissions` — **Integration 계약 위반**(권한 목록 필드 금지) |
| GitHub | 1 | `has_role_on --[admin]--> org` | `member_of` + 속성 `org_role: admin`. 역할이 관계에 없다 |
| GWS | 4 | `owned_by file → user` (Drive `owners`, owned_by 의 대표 근거) | 참조로만 |
| GWS | 4 | `contained_in file → 폴더` | 우리는 `file → customer` |

### 5.3 역할 자리 27행과 basis 5행

- **Okta 앱 배정 27행**(`AppUser` 26 + 그룹 1) — 우리는 `has_role_on` 에 역할이 없다. 규격은 `has_role_on` 이 **언제나 3항**이라 L1 검사에서 걸린다. Okta 앱 배정에는 역할 개념이 없어서 재추출기는 `assigned`(name_key) 상수를 넣었다 — **규격도 답이 없는 자리**다(§7)
- **basis 5행** — GitHub 협업자 4행은 `role_name` 이 「모든 부여 출처를 고려한 가장 높은 역할」이라 `computed`(Relation_Schema_v3 basis 절이 이 필드를 예로 든다). Okta `/users/{id}/roles` 가 `assignmentType: GROUP` 으로 주는 1행(화민의 헬프데스크 커스텀 역할)도 그룹 배정을 벤더가 펼친 것이라 `computed`. **둘 다 "이 행을 지우면 회수되나" 에 답이 없다**

## 6. Link 와 탐지 영향

### 6.1 간선 비교

| 방법 | 간선 | 우리 |
| --- | --- | --- |
| M1 `disclosed_relation` — Okta `AppUser.externalId` | **8** (GWS 7, Slack 1) | 안 쓴다. GWS 는 `credentials.userName = primaryEmail` 로 잇는다 |
| M2 `resolved` — GitHub 엔터프라이즈 SAML IdP = Okta `ghecenterprisesaml` 앱, `nameId = login` | 3 | 같은 근거, `resolved` |
| M3 `possibly_same` — Slack email = Okta login | 6 | `candidate` |
| M4 `possibly_same` — Worker 로그(SL-12) 앱 id ↔ Okta 클라이언트 | 1 | `inferred` (규격에 없는 level) |
| 그룹 push | 2 | `resolved`/`candidate`. 규격은 **미결**(키가 끊겨 단계를 못 정한다고 적었다) |

- **Okta Google 앱의 7명 전원이 `externalId` = GWS 사용자 id, `syncState: SYNCHRONIZED` 다.** Link_Schema_v3 가 「M1 은 프로비저닝이 켜진 앱에서만」이라 적은 조건이 여기서는 충족된다. 이메일 규칙보다 강한 근거를 우리는 안 쓰고 있다. Slack 브라우저 플러그인 앱에도 1명(화민)이 `externalId` = Slack id 로 있다
- 우리는 **집합에 level 하나**라, 한 사람의 GWS(disclosed)·GitHub(resolved) 간선이 Slack(email) 하나 때문에 전부 `candidate` 로 기록된다(8명 중 7명)

### 6.2 탐지 룰이 level 을 안 본다

`src/detection/v2/identity.ts` 에 level 을 읽는 코드가 없다. 규격의 전이 정책을 대면 이렇다.

- **시나리오 B** — 요청자 Slack → GitHub 계정은 Slack–Okta(`possibly_same`) + Okta–GitHub(`resolved`)를 **섞어 닫아야** 나온다. 규격 기본 질의에서는 안 닫힌다. 우리 룰은 클러스터에서 GitHub 계정이 나오기만 하면 이 check(`b-requester-account`)를 `confirmed` 로 낸다
- `confirmed`/`unknown` 설계와 맞물리는 자리다 — 링크 level 이 check 상태로 올라가야 한다

### 6.3 시나리오 C·D 집합을 두 그래프에서 다시 계산

룰 코드를 돌린 게 아니라 **룰의 집합 정의를 그대로** 두 그래프에 댔다(`scenarios.py`).

```
시나리오 C  gap = #helpdesk 멤버 − 헬프데스크 역할 보유자
  우리 어댑터 + 우리 링크                  gap 1   지원
  규격 + possibly_same 까지 옵트인         gap 3   지원 · 수집 봇 · MFA Reset 봇 사용자
  규격 + disclosed/resolved 만            gap 3   (같음)
  규격 + 링크 안 탐(기본)                  gap 4   + 화민

시나리오 D  gap = 수신 채널 멤버 − 원본 시트 권한 보유자
  우리 어댑터 + 우리 링크                  gap 1   F(testuser)
  규격 + possibly_same 까지 옵트인         gap 2   F · 수집 봇
  규격 + disclosed/resolved 만            gap 3   + 태욱(시트 주인 — email 로만 이어진다)
```

- **수집 봇**: 규격에는 측정 도구 계정 개념이 없다. 우리 어댑터는 관계를 **저장 단계에서 뺀다**(`measurementPrincipals`). 규격의 「저장은 전부 편다」와 맞추려면 저장은 하고 질의에서 빼는 편이 맞다
- **MFA Reset 봇**: 규격에서 채널 멤버는 봇 사용자 `U0C4A881YFN` 이고, 그 사용자와 앱은 `acts_as`(관계)로, 앱과 Okta 클라이언트는 Link(M4)로 이어진다. **관계 한 홉 + 링크 한 홉**이라 신원 클러스터로는 안 닫힌다. 우리는 봇을 B… 로 잡고 그 노드에 링크를 바로 걸어 이 문제를 피하고 있다

## 7. 규격 쪽에서 드러난 것 — aegi-schema 에 돌려줄 항목

1. **`parent ?? tenant` 키가 관측마다 갈린다.** Apps Script 프로젝트는 `projects/{id}` 가 `parentId` 를 주고 `projects/{id}/content` 는 안 준다 → 한 관측은 스코프가 파일, 한 관측은 테넌트라 2단계 합치기가 **두 노드로 쪼갠다**. 「없는 것과 다른 것은 다르다」가 tenant 대체 때문에 깨진다. 재추출기는 한 노드로 두고 기록만 남겼다
2. **하위 리소스 간선을 적을 자리가 없다** — Okta 만의 문제가 아니다. 우리 원본 10곳(Slack 2, Okta 2, GitHub 5, GWS 1)
3. **역할이 없는 배정** — Okta 앱 배정은 `has_role_on`(3항) 말고는 갈 곳이 없는데 역할이 없다
4. **`has_role_on` 대상에 Principal 이 없다** — Okta 헬프데스크 커스텀 역할의 범위(리소스셋 → 그룹 `AEGI MFA Test Users`), GitHub 팀 멤버의 `role`(maintainer). 시나리오 C 의 "그 역할이 누구에게 미치는가" 가 그래서 `null` 대기열에 있다
5. **측정 도구 계정** — 수집 앱이 채널에 들어가야 읽히는 SaaS(Slack)에서 관측 행위가 그래프를 바꾼다. 표기가 필요하다
6. **자동화의 교차 신원** — Link_Schema_v3 「허브를 안 거친 계정 — 현재 방법 없음」. 실측에서 Worker 로그가 앱 id ↔ Okta 클라이언트를 준다. level·rule 을 정해야 한다

## 8. 어댑터에 옮길 만한 것 (우선순위)

> **2026-09-28 — v1 은 그대로 두고 v2 어댑터(`scripts/collect/normalize-v2/`, `npm run normalize:v2`)로 1~8 을 옮겼다.** 1 은 저장(간선마다 level)까지 했고 탐지가 level 을 check 상태로 올리는 것은 아직이다. 4 는 룰 C·D 가 `measurement_principal` 을 뺀다. 9 는 v2 데이터에서 테넌트·Assignment `contained_in` 을 껐고, 탐지는 `has_role_on` 경로로 같은 Finding(영향 대상 v1 과 동일)을 낸다.

순서는 탐지·귀속 정확도에 미치는 크기로 매겼다.

| # | 무엇 | 효과 |
| --- | --- | --- |
| 1 | Link 를 **간선마다 level** 로 저장하고, 탐지 신원 대조가 level 을 check 상태로 올리게 | B 의 요청자 귀속, C·D 의 격차가 근거 세기와 함께 나온다 |
| 2 | Okta↔GWS 를 `AppUser.externalId`(M1)로, Okta↔Slack 도 `externalId` 가 있으면 M1 로 | 이메일보다 강한 근거. 화민은 Slack 까지 disclosed |
| 3 | `basis` 를 참조마다 명시하고 `dataset.ts` 의 기본값 `stated` 를 없앤다. 협업자·그룹 경유 역할은 `computed` | 회수 가능 여부가 거짓으로 나오지 않는다 |
| 4 | 수집 봇은 **저장하고 질의에서 뺀다**(객체에 표시) | 규격의 「저장은 전부」와 맞고, 뺀 사실이 그래프에 남는다 |
| 5 | Slack `is_admin/is_owner` → `has_role_on`(flag), `enterprise_user.teams` → `member_of team`, `internal_team_ids` → `shared_with` | 워크스페이스 관리자 질의가 된다 |
| 6 | 앱 id 로 참조된 Slack 앱을 껍데기로 만든다 | 버려지던 `owned_by` 17행이 산다 |
| 7 | GH-22 정규화, Okta 정책 규칙 정규화 | 이미 수집한 26 + 14 객체 |
| 8 | PAT 부여를 선택된 저장소로 편다 | 시나리오 B 대상 저장소가 관계로 직접 이어진다 |
| 9 | 테넌트·Assignment `contained_in` 을 끈다 | **탐지 코드가 의존한다** — `access.ts` `listAssignmentGrants`, `scope.ts` 테넌트 붙이기·`containmentDepth`. 먼저 그쪽을 `has_role_on`/`references.tenant` 로 바꿔야 한다 |

## 9. 재현

```bash
pip install pyyaml
python scripts/schema-reextract/engine.py      # collected/ -> collected/schema-reextract/{objects,relations,report}.json
python scripts/schema-reextract/compare.py     # 우리 어댑터 출력과 대조 -> compare.txt
python scripts/schema-reextract/links.py       # Link_Schema_v3 간선 -> links_schema.json
python scripts/schema-reextract/scenarios.py   # 시나리오 C·D 집합 재계산
```

- 원본(`collected/`)과 우리 어댑터 출력(`src/data/aegi_inc_measured_v1/`)이 있어야 돈다. 결과는 실측 파생물이라 git 에 넣지 않는다(D-15)
- 규격 원문은 `finding-nemo/aegi-schema/`(AEGI-Inc/aegi-schema 클론)
