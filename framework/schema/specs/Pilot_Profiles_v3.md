# Pilot Profiles v3 (시험용)

버전 안내: 아래 Profile_Schema_v3.md는 이 예시를 작성한 과거 형식 이름이다. 현재 형식 정본은 [Profile Schema v4.2](Profile_Schema_v4.2.md)이며, 이 예시 전체를 현재 운영 Profile이나 v4.2 준수 검증 결과로 해석하지 않는다.

`Profile_Schema_v3.md` 형식을 **최종 Object List 318건**에 처음 대 본 것이다. 6종만 골랐다.

- 대상 목록: `AEGI_Object_List_Final_2026-09-20.xlsx` (GitHub 67 / Okta 134 / Slack 57 / GWS 60)
- 어휘: `Relation_Schema_v1.4.md` 17종
- interface: `Interface_Spec_v1.md` 9종

## 무엇을 근거로 썼고 무엇을 안 썼나

**워크북의 네 열만 근거로 썼다.** `식별자 필드`, `참조 필드`, `부모 컨텍스트`, `근거 엔드포인트`.

**응답 샘플이 없다.** Slack을 뺀 세 provider는 실제 응답을 한 번도 보지 못했다. 그래서 전부 `confidence: inferred`이고, 워크북에 이름이 없는 필드는 **한 개도 적지 않았다.**

그 결과 `properties.keep`이 거의 비어 있다. 비워 둔 것이지 없는 것이 아니다. **응답 샘플을 받기 전에는 이 Profile로 수집하면 안 된다.**

**Slack은 제외했다.** `Slack_Profiles_v2.1.md`가 이미 run2 실측으로 8종을 채웠고, 워크북의 Slack 행 57개 중 31개는 식별자 열이 비어 있어 그보다 얇다.

## 왜 이 여섯인가

| # | object_type | 무엇을 시험하나 |
| --- | --- | --- |
| 1 | `github.enterprise` | `root_tenant`, 목록 API가 없는 테넌트 |
| 2 | `github.organization` | 부모가 있을 수도 없을 수도 있는 Tenant |
| 3 | `github.deploy_key` | 부모 소유 Credential, `no_relation` 판정 |
| 4 | `okta.org_setting` | 범위와 1:1인 설정 묶음 |
| 5 | `gws.role_assignment` | 3항 `has_role_on`의 슬롯 셋 |
| 6 | `gws.asp` | 복합 키의 성분이 부모이기도 한 경우 |

---

## 1. github.enterprise

```yaml
provider: github
object_type: enterprise
spec: 3
interfaces: [Tenant]
root_tenant: true

collect:
  endpoints:
    - role: primary
      method: POST
      path: /graphql
      params: { query: "enterprise(slug: <slug>)" }
  record: data.enterprise
  envelope: none
  paging: cursor
  enumerable: none
  completeness: full

identifiers:
  primary: [slug]
  slug:
    from: $path.enterprise
    stability: undocumented
  node_id:
    path: id
    stability: undocumented

references:
  organizations:
    path: organizations
    object_type: organization
    kind: direct_id
    status: inferred
    relation_type: contained_in
    reverse: true
    basis: stated
  teams:
    path: teams
    object_type: enterprise_team
    kind: direct_id
    status: inferred
    relation_type: contained_in
    reverse: true
    basis: stated

properties:
  keep: []
  drop: []

confidence: inferred
open_issues:
  - 응답 샘플 없음. properties.keep 미작성
  - 엔터프라이즈 목록 API가 없다. enumerable 을 none 으로 두었고 삭제 판정을 못 한다
  - 워크북이 근거로 든 것은 "REST /enterprises/{enterprise}/*" 와 "GraphQL Enterprise" 뿐이다.
    REST 에 단건 조회 경로가 있는지 확인하지 못해 primary 를 GraphQL 로 두었다
  - slug 의 불변성이 문서에 없다. stability 를 undocumented 로 두었다
```

`root_tenant: true`라서 `references.tenant`가 없다. v3가 요구한 대로 **선언으로 남겼다.** 참조가 비어 있는 것으로 추론하지 않는다.

`organizations`와 `teams`는 부모가 자식 목록을 담는 모양이라 `reverse: true`다. 뒤집으면 organization → enterprise 방향이 되고, organization의 부모 컨텍스트가 `enterprise | none`이므로 `contained_in` 값 검사를 통과한다.

---

## 2. github.organization

```yaml
provider: github
object_type: organization
spec: 3
interfaces: [Tenant]

collect:
  endpoints:
    - role: primary
      method: GET
      path: /orgs/{org}
      params: {}
  record: (root)
  envelope: none
  paging: none
  enumerable: parent_fanout
  completeness: full

identifiers:
  primary: [id]
  id:
    path: id
    stability: undocumented
  node_id:
    path: node_id
    stability: unstable
  login:
    path: login
    stability: mutable
    normalization: [lowercase, trim]

references:
  tenant:
    from: $request.enterprise
    object_type: enterprise
    kind: direct_id
    status: inferred
  owner:
    path: owner
    object_type: "@resolve"
    resolve: { by: sibling_field, field: type }
    kind: direct_id
    status: inferred
    relation_type: owned_by
    basis: stated

properties:
  keep: []
  drop: [repos_url, hooks_url, issues_url]

confidence: inferred
open_issues:
  - 응답 샘플 없음. properties.keep 미작성
  - 부모 컨텍스트가 "enterprise | none" 이다. 엔터프라이즈에 안 속한 조직은 tenant 가 없는데,
    v3 불변식은 root_tenant 가 아니면 tenant 를 요구한다. 스키마와 충돌한다
  - owner 가 응답에 실재하는지, 어떤 종류를 가리키는지 확인 못 했다.
    workbook 의 참조 열에만 있다
  - enumerable 을 parent_fanout 으로 둔 근거는 조직 목록이 엔터프라이즈별이라는 것뿐이다.
    사용자 소유 조직까지 전수가 되는지 확인 못 했다
```

`*_url` 세 개는 참조가 아니라 **API 항해 링크**라 `drop`으로 보냈다. 워크북의 참조 열에 함께 적혀 있지만 다른 Object를 식별하는 값이 아니다.

---

## 3. github.deploy_key

```yaml
provider: github
object_type: deploy_key
spec: 3
interfaces: [Credential]

collect:
  endpoints:
    - role: primary
      method: GET
      path: /repos/{owner}/{repo}/keys
      params: {}
    - role: detail
      method: GET
      path: /repos/{owner}/{repo}/keys/{key_id}
      params: { key_id: "<id>" }
  record: (root)
  envelope: none
  paging: cursor
  enumerable: parent_fanout
  completeness: full

identifiers:
  primary: [id]
  id:
    path: id
    stability: undocumented
    endpoint: primary

references:
  tenant:
    from: $request.org
    object_type: organization
    kind: direct_id
    status: inferred
  parent:
    from: $path.repo
    object_type: repository
    kind: direct_id
    status: confirmed
  added_by:
    path: added_by
    object_type: user_account
    kind: direct_id
    status: unresolved
    unresolved_reason: needs_api_sample
    relation_type: no_relation
    # 2026-09-21. owned_by 판정 기준 미통과: 등록한 사실이 그 키에 대한 권한을 주지 않는다.
    # Relation_Schema_v1.4 가 이 필드를 "설명 없는 nullable 문자열" 로 이미 기각했다

properties:
  keep: [key]
  drop: []

judged:
  material_location: counterparty_side
  credential_kind: key_pair

confidence: inferred
open_issues:
  - 응답 샘플 없음. properties.keep 에 워크북이 이름을 준 key 하나만 있다
  - key 는 공개키 절반이라 redact 대상이 아니라고 보았으나 팀 판단이 필요하다.
    Object_Schema 의 자격증명 실물 금지 규칙과 경계가 붙어 있다
  - expires_at 을 못 채웠다. Interface_Spec 이 Credential 에 요구하는데 이 객체에 만료가 있는지 모른다
  - rotation 미확인
```

`added_by`가 `no_relation`의 실제 사례다. v3가 요구한 대로 **판정 근거와 일자를 주석으로** 남겼다. 어휘가 늘어도 이 판정은 안 바뀐다.

`parent`가 `$path.repo`에서 온다. 응답 본문에 저장소가 없어서, 이게 없으면 같은 `id`가 저장소마다 충돌한다.

---

## 4. okta.org_setting

```yaml
provider: okta
object_type: org_setting
spec: 3
interfaces: [Tenant]          # 워크북 값 그대로. 아래 open_issues 참조

collect:
  endpoints:
    - role: primary
      method: GET
      path: /api/v1/org
      params: {}
  record: (root)
  envelope: none
  paging: none
  enumerable: full
  completeness: full

identifiers:
  primary: [id]
  id:
    path: id
    stability: undocumented

references:
  tenant:
    from: $request.org
    object_type: org
    kind: direct_id
    status: inferred

properties:
  keep:
    - address1, address2, city, state, postalCode, country
    - phoneNumber, supportPhoneNumber
    - website, endUserSupportHelpURL
  drop: [_links]

confidence: inferred
open_issues:
  - 응답 샘플 없음
  - 워크북의 참조 열에 address1, city, country, website 등 11개가 적혀 있는데
    이들은 다른 Object 를 가리키는 값이 아니라 속성이다. properties.keep 으로 옮겼다.
    _links 는 API 항해 링크라 drop 이다
  - 워크북의 식별자 열에 phoneNumber, supportPhoneNumber 가 있는데 식별자가 아니다.
    primary 는 id 하나로 두었다
  - interface 를 Tenant 로 둔 것이 문제다. 이 객체는 조직 자체가 아니라 조직의 설정 묶음이다.
    조직당 하나뿐이고 권한의 주체도 대상도 아니다. Policy 가 맞는지 팀 판단이 필요하다
  - Tenant 로 두면 parent 가 org(also Tenant) 라서 테넌트가 테넌트 안에 사는 모양이 된다
```

**이 행이 시험에서 제일 많이 걸렸다.** 워크북의 세 열이 전부 다른 뜻으로 채워져 있다 — 참조 열에 속성이, 식별자 열에 전화번호가, interface 에 Tenant 가 들어갔다.

객체 자체는 실재한다. `GET /api/v1/org`는 조직당 하나를 돌려주고, 그건 앞서 논의한 **범위와 1:1인 설정 묶음**이다. 그 모양을 담을 자리는 있다 — `identifiers.primary`가 사실상 스코프와 같으므로 동일성이 자연히 `(provider, object_type, tenant)`로 축약된다.

---

## 5. gws.role_assignment

```yaml
provider: google_workspace
object_type: role_assignment
spec: 3
interfaces: [Assignment]

collect:
  endpoints:
    - role: primary
      method: GET
      path: /admin/directory/v1/customer/{customer}/roleassignments
      params: {}
    - role: detail
      method: GET
      path: /admin/directory/v1/customer/{customer}/roleassignments/{roleAssignmentId}
      params: { roleAssignmentId: "<id>" }
  record: items[]
  envelope: none
  paging: cursor
  enumerable: full
  completeness: full

identifiers:
  primary: [roleAssignmentId]
  roleAssignmentId:
    path: roleAssignmentId
    stability: undocumented

assignment:
  relation_type: has_role_on
  basis: stated

references:
  tenant:
    from: $path.customer
    object_type: customer
    kind: direct_id
    status: confirmed
  assigned_to:
    path: assignedTo
    object_type: user
    kind: direct_id
    status: inferred
    slot: source
  role:
    path: roleId
    object_type: role
    kind: direct_id
    status: inferred
    slot: role
  scope:
    path: orgUnitId
    object_type: org_unit
    kind: direct_id
    status: inferred
    slot: target

properties:
  keep: []
  drop: []

confidence: inferred
open_issues:
  - 응답 샘플 없음
  - orgUnitId 가 없는 배정(고객 전체 범위)이 있는지 확인 못 했다.
    있다면 target 슬롯이 비고, Relation_Schema 규칙대로 tenant 를 가리켜야 한다
  - assignedTo 가 사용자만 가리키는지 그룹도 가리키는지 확인 못 했다.
    그룹도 가리키면 object_type 을 "@resolve" 로 바꿔야 한다
  - roleAssignmentId 를 키로 쓰지만, Relation_Schema 는 벤더 배정 id 를 관계 키로 쓰지 않는다.
    Object 의 키로만 쓰고 관계는 세 슬롯 값으로 동일성을 잡는다
```

**세 슬롯이 전부 채워지는 첫 사례다.** 워크북의 참조 열 `assignedTo, orgUnitId, roleId`가 그대로 `source / target / role`에 대응한다.

대상 셋이 목록에 실재한다 — `User`(Principal), `Role`(Policy), `OrgUnit`(Resource). 그래서 `Principal --[Policy]--> Resource` 템플릿을 만족한다.

---

## 6. gws.asp

```yaml
provider: google_workspace
object_type: asp
spec: 3
interfaces: [Credential]

collect:
  endpoints:
    - role: primary
      method: GET
      path: /admin/directory/v1/users/{userKey}/asps
      params: {}
    - role: detail
      method: GET
      path: /admin/directory/v1/users/{userKey}/asps/{codeId}
      params: { codeId: "<id>" }
  record: items[]
  envelope: none
  paging: none
  enumerable: parent_fanout
  completeness: full

identifiers:
  primary: [userKey, codeId]
  userKey:
    from: $path.userKey
    stability: undocumented
  codeId:
    path: codeId
    stability: undocumented

references:
  tenant:
    from: $request.customer
    object_type: customer
    kind: direct_id
    status: inferred
  parent:
    from: $path.userKey
    object_type: user
    kind: direct_id
    status: confirmed
  owner:
    path: userKey
    object_type: user
    kind: direct_id
    status: inferred
    relation_type: authenticates_with
    reverse: true
    basis: stated

properties:
  keep: [name]
  drop: []

judged:
  material_location: tenant_side
  credential_kind: bearer_token

confidence: inferred
open_issues:
  - 응답 샘플 없음
  - codeId 가 사용자 안에서만 유일한지 전역인지 확인 못 해 복합 키로 두었다
  - userKey 가 identifiers 와 references 양쪽에 있다. 키의 성분이면서 부모라서 그렇다.
    v3 가 이 모양을 허용하지만(primary 성분이 $path 에서 올 수 있다) 중복 표기를 줄일지 검토 필요
  - credential_kind 를 bearer_token 으로 본 근거는 앱 비밀번호라는 설명뿐이다.
    material_location 도 마찬가지로 추정이다
  - expires_at 미확인
```

`owner`가 `authenticates_with` + `reverse: true`다. 자격증명이 주인을 가리키는 참조는 뒤집어서 **user → asp 정방향 한 종류만** 남긴다. Relation_Schema v1.4에서 규칙으로 명시한 자리다.

---

## 원자료에서 발견한 문제

318건 전수를 훑고 나온 것이다. Profile 을 쓰는 데 직접 걸린 순서로 적는다.

### 1. 같은 provider 안에서 provider_term 이 겹친다 — 8건

```
Okta  user   OKTA-v1-2614 / OKTA-v1-3110
Okta  group  OKTA-v1-2040 / OKTA-v1-3008
Okta  policy OKTA-v1-2405 / OKTA-v1-2805
Okta  project, server, serverenrollmenttoken
GWS   user   GWS-v3-0198 / GWS-v3-2596
GWS   group  GWS-v3-0174 / GWS-v3-1517
```

**Profile 은 object_type 하나당 하나**이고 Object 동일성 키가 `(provider, object_type, ...)`이라, 이름이 겹치면 두 객체가 한 행으로 합쳐진다.

GWS `user` 둘은 특히 분명하다. `GWS-v3-0198`은 `directory.users`(Principal)이고 `GWS-v3-2596`은 `gmailpostmastertools.domains.users`(Assignment)다. **서로 다른 객체인데 이름이 같고 interface 도 다르다.**

### 2. Okta 의 부모 컨텍스트가 정규화되지 않았다 — 100가지

```
Org                                     19건
Id                                       4건
Project_id, Resource_group_id, Team_name 3건
Saas_app_instance_id, Team_name          3건
```

`Id` 나 `Project_id, Team_name` 은 **부모 객체 이름이 아니라 경로 파라미터 이름**이다. Profile 의 `scope_path.owner_object_type` 을 채울 수 없다.

GitHub 은 21가지, GWS 는 28가지인데 GWS 에는 `Parent` 라는 리터럴 10건과 `NOT_IN_SOURCE` 4건이 있다.

### 3. 참조 열에 참조가 아닌 것이 섞여 있다

`okta.org_setting` 이 극단이다. 참조 열 11개가 전부 속성이다. GitHub 은 `hooks_url`, `repos_url` 같은 **API 항해 링크**가 참조 열에 들어 있다.

이 둘은 성격이 다르다 — 앞은 속성이고 뒤는 링크다. 어느 쪽도 `references` 가 아니다.

### 4. Assignment 47건 중 6건이 슬롯을 못 채운다

```
Okta  ResourceConnection, OrgCrossAppAccessConnection
Slack app-installation, role-assignment, workflow-collaborator
GWS   User (gmailpostmastertools)
```

참조 열이 비어 있어서 `slot: source` 와 `slot: target` 을 채울 수 없다. v3 불변식이 둘 다 요구한다.

Slack 세 건은 `Slack_Profiles_v2.1.md` 에 이미 슬롯이 채워져 있어 워크북만 비어 있는 것이다.

### 5. 근거 엔드포인트가 없는 5건

```
Okta  team, Application, EmailDomainResponse, PolicyRule
```

`Application` 과 `PolicyRule` 은 Okta 에서 핵심 객체인데 수집 경로가 비어 있다. `collect.endpoints` 를 못 쓴다.

### 6. 식별자 열이 비어 있는 31건은 전부 Slack 이다

`user`, `workspace`, `enterprise`, `role-assignment` 처럼 **이미 v2.1 에 Profile 이 있는 것들**이 포함되어 있다. 워크북의 Slack 시트가 기존 작업보다 얇다.

---

## 이 시험이 스키마에 남긴 것

### 걸림 1. Tenant 인데 부모가 있을 수 있다

v3 불변식은 이렇다.

> `root_tenant: true` 가 아니면 `references` 에 `tenant` 가 있다

GitHub `organization` 은 Tenant 인데 부모가 `enterprise | none` 이다. 엔터프라이즈에 안 속한 조직은 **root 도 아니고 tenant 도 없다.** 지금 규칙으로는 쓸 수 없다.

`root_tenant` 를 불리언이 아니라 세 값(`always` / `never` / `conditional`)으로 두거나, 불변식을 "tenant 가 없으면 이유를 적는다" 로 완화해야 한다.

### 걸림 2. 설정 묶음을 담을 interface 가 없다

`okta.org_setting` 이 9종 중 어디에도 안 맞는다. 워크북은 Tenant 로 두었는데 그러면 테넌트가 테넌트 안에 사는 모양이 된다. Policy 가 그나마 가깝지만 판정 기준("규칙이 독립적으로 CRUD 되는가")에 걸린다.

318건 중 이 모양이 몇 개인지는 세지 않았다. 세어 봐야 한다.

### 걸림 3. Interface 계약을 채울 근거가 없다

여섯 중 셋이 Credential 또는 Assignment 인데, `expires_at` 을 **하나도 못 채웠다.** `material_location`, `credential_kind`, `rotation` 도 추정이다.

워크북에 그 정보가 없고 응답 샘플도 없다. **계약 필드는 응답을 봐야만 채워진다.** 이것이 Object 수집 단계의 선행 조건이다.

### 확인된 것

`Profile_Schema_v3` 의 형식 자체는 네 SaaS 에 다 들어갔다. 특히 이 셋이 제 몫을 했다.

- **`$path.*` 와 `$request.*`** — `deploy_key` 와 `asp` 는 부모가 응답에 없고 경로에만 있다. 이 표기가 없으면 키가 충돌한다
- **`slot`** — GWS `role_assignment` 의 세 참조가 그대로 3항 관계가 됐다
- **`no_relation` + 근거 주석** — `added_by` 를 영구 판정으로 닫으면서 근거를 남길 자리가 있었다
