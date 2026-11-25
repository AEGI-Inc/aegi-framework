# Object Schema v4.1

**수집한 대상 하나가 한 행이다.** 같은 대상을 여러 엔드포인트에서 봤어도 행은 하나다. 행의 모양만 여기서 정한다.

- 어떤 값을 어느 경로에서 뽑는지는 `Profile_Schema_v4.2.md`
- `interfaces[]`와 `judged{}`에 무엇이 들어가는지는 `Interface_Spec_v3.md`
- 관계는 `Relation_Schema_v3.md`
- provider 사이의 신원 판단은 `Link_Schema_v3.md`

## v3에서 바뀐 것 — 동일성 키에 `service`가 들어간다

**이 판에서 바뀌는 것은 그 한 자리뿐이다.** 나머지는 v3과 같다.

```
v3   (provider, object_type, identifiers[primary] 전부, references.parent ?? references.tenant)
v4   (provider, service, object_type, identifiers[primary] 전부, references.parent ?? references.tenant)
```

확정된 object 목록 318건(GitHub 67 · Okta 134 · Slack 57 · Google Workspace 60)에서 **같은 provider 안에 `object_type` 이름이 겹치는 쌍이 8개** 나왔다.

| provider | 이름 | 서비스 A | 서비스 B |
| --- | --- | --- | --- |
| Okta | `User` | management | opa |
| Okta | `Group` | management | opa |
| Okta | `Policy` | management | oag |
| Okta | `Project` | asa | opa |
| Okta | `Server` | asa | opa |
| Okta | `ServerEnrollmentToken` | asa | opa |
| Google Workspace | `User` | admin | gmailpostmastertools |
| Google Workspace | `Group` | admin | cloudidentity |

우연한 충돌이 아니다. **한 벤더가 제품을 여럿 팔고, 제품마다 자기 API 표면과 자기 `User`·`Group`이 있다.**

```
Okta `User` 두 개
  management   GET /api/v1/apps/{appId}/users/{userId}   식별자 id, realmId
  opa          GET /v1/teams/{team_name}/users/{user_name}   식별자 id, name, oauth_client_application_id
```

**경로도 식별자도 부모도 다르다.** 같은 사람일 수는 있어도 같은 레코드가 아니다. Google Workspace `User` 둘은 interface까지 다르다 — `directory.users`는 `Principal`, `gmailpostmastertools.domains.users`는 `Assignment`다.

`service`가 키에 없으면 `okta` + `user` + `id=00u1`이 두 제품에서 나올 때 한 노드로 합쳐진다. **두 제품의 id가 같은 값 공간인지 모르는 채로 합친다는 것이 문제다.** 합치면 두 제품의 권한이 한 주체에 붙고, 안 합치면 같은 사람이 둘로 갈린다. 어느 쪽이 맞는지 지금 근거가 없다.

`service` 값은 Profile이 선언한다. **생략하면 `null`이고, `null`끼리는 v3과 똑같이 합쳐진다.** 자세한 것은 `Profile_Schema_v4.2.md`의 `service` 항목에 있다.

**v4.1은 내용이 같다.** 짝이 되는 `Profile_Schema`가 v4.1에서 v4.2로 올라가 참조만 바뀌었다. `schema_version`은 **3 그대로**다.

### 이 변경이 기존 행을 깨는가

깬다. **`service`는 동일성 키를 바꾸는 유일한 변경이므로, 이미 쌓인 행은 다시 만들어야 한다.**

`Profile_Schema_v4.2.md`의 호환 규칙 1~3은 **Profile**이 안 고쳐지는 것을 보장한다. 저장된 **Object 행**까지 보장하지는 않는다. 둘은 다른 약속이다.

지금 쌓인 행이 Slack 127개뿐이고 저장된 증거에서 1.4초에 다시 만들어지므로 이 시점에 치르는 값이 가장 싸다.

실제로 구현해서 확인했다.

```
Slack 8종 (service 없음)   127노드 / 189관계.  v3과 정규화 후 바이트 동일
합성 시험
  okta/management/user/00u1  vs  okta/opa/user/00u1   ->  갈림
  service 없는 두 행                                    ->  합쳐짐
```

### 구현할 때 조심할 것

키에 자리를 하나 끼워 넣으면 **키를 위치로 읽던 코드가 전부 한 칸씩 밀린다.**

우리 수집기에서 9곳이 밀렸고, 첫 실행이 **127노드 대신 168노드**를 냈다. 합치기 검사가 `object_type` 자리에서 `service`를 읽고 있었는데 **오류는 한 건도 안 났다.** 노드가 41개 늘어난 것만이 신호였다.

회귀 기준선이 없었으면 못 잡는다. 이 판을 적용하는 수집기는 **키를 위치가 아니라 이름으로 읽도록 고치는 것**을 권한다.

---

## v1에서 바뀐 것

v1은 **엔드포인트 하나가 행 하나**였다. 같은 사용자를 세 곳에서 봤으면 세 행이 되고, 그 사람을 그리면 노드가 셋이 된다. 이건 우리가 만들려던 그래프가 아니다.

| | v1 | v2 |
| --- | --- | --- |
| 행의 단위 | 관측 하나 | **대상 하나** |
| `source{}` | 객체 하나 | **`observations[]` 배열** |
| 소스마다 값이 다른 키 | 다른 행에 따로 | **`per_source` 배열 하나** |

실측 대조다. Slack 수집 결과가 **213행에서 125노드**가 되고, 참조로만 나온 대상 2개가 더해져 **127노드**다.

| object_type | v1 행 | v2 노드 |
| --- | --- | --- |
| user | 93 | 33 |
| channel | 68 | 40 |
| role_assignment | 28 | 28 |
| session | 19 | 19 |
| team | 2 | 2 |
| enterprise / usergroup / workflow | 각 1 | 각 1 |

`role_assignment`와 `session`은 하나도 안 줄었다. 원래 관측이 하나씩이었다. **합치기는 중복이 있는 곳에서만 일어난다.**

`schema_version`은 **3**이다. v4에서 행에 `service` 자리가 생겼고 동일성 키가 바뀌었으므로 아래 "명세 버전" 절의 기준에 걸린다. Relation 행은 모양이 안 바뀌어서 **1 그대로**다. 두 층이 서로 다른 번호를 쓴다.

```yaml
Object
├ provider
├ service
├ object_type
├ interfaces[]
├ identifiers{}
├ references{}
├ properties{}
├ judged{}
└ source{}
```

```yaml
provider: github
service: null
object_type: Repository

interfaces:
  - Resource

identifiers:
  primary: [id]
  id:
    value: 123456
    stability: undocumented
  node_id:
    value: R_abc123
    stability: unstable
  full_name:
    value: AEGI/test
    stability: mutable

references:
  tenant:
    kind: direct_id
    targets:
      - { object_type: Organization, identifier_type: login, value: AEGI, status: confirmed }
  owner:
    kind: direct_id
    targets:
      - { object_type: Organization, value: 999, status: confirmed }

properties:
  private: true
  archived: false

judged:
  principal_kind: human

source:
  api: GET /repos/{owner}/{repo}
  params: {}
  record: (root)
  schema_version: 3
  collected_at: 2026-09-17T10:00:00Z
  first_seen_at: 2026-08-01T09:00:00Z
  last_seen_at: 2026-09-17T10:00:00Z
  revision: 7
```

| 항목 | 의미 |
| --- | --- |
| provider | 어느 SaaS에서 수집했는지 |
| service | 그 벤더의 어느 제품 표면인지. 하나뿐이면 `null` |
| object_type | 이게 무엇인지. provider가 부르는 이름 그대로 |
| interfaces[] | SaaS를 가로질러 공통으로 하는 역할 |
| identifiers{} | 자기 자신을 식별하는 값들 |
| references{} | 다른 Object를 가리키는 값들 |
| properties{} | 자기 상태와 설정. 벤더가 준 것 |
| judged{} | 우리가 판정한 값 |
| source{} | 어느 요청에서 언제 수집했는지 |

---

## provider

소문자 한 단어. `slack` `github` `okta` `gws` `servicenow` `snowflake` `salesforce` `datadog` `tfc`.

## service

**벤더가 별도 제품으로 파는 API 표면의 이름이다.** 없으면 `null`이다.

```yaml
provider: okta
service: opa
object_type: user
```

값은 벤더가 쓰는 이름을 그대로 쓴다. 지어내지 않는다. Okta는 `management` / `opa` / `asa` / `oag` / `aerial`, Google Workspace는 `admin` / `cloudidentity` / `gmail` / `drive` / `vault`가 그것이다.

**`null`은 "그 provider의 기본 표면"이다. "모른다"가 아니다.** Slack처럼 표면이 하나뿐인 provider는 전부 `null`이다.

쓰지 않는 경우가 있다. GitHub의 API 태그 24종(`orgs`, `repos`, `actions`…)은 **제품이 아니라 문서 분류**다. 같은 객체를 나누는 축이 아니므로 `service`를 붙이지 않는다. `github` / `null` / `repository` 하나다.

판별 기준은 이것이다.

> **그 표면을 따로 사거나 따로 켜야 하는가. 그리고 그 표면의 `User`가 다른 표면의 `User`와 다른 레코드인가.**

둘 다 예일 때만 쓴다. 하나라도 아니면 `null`이다.

## object_type

**provider가 부르는 이름을 그대로 쓴다.** 합치거나 고치지 않는다.

Slack의 workflow-step은 `workflow-step`이다. GitHub은 `Repository`, Okta는 `GroupRule`. 표기법도 provider를 따르므로 kebab-case와 PascalCase가 섞인다.

타입이 많아져도 상관없다. SaaS를 가로지르는 통일은 `interfaces[]`가 한다. object_type을 억지로 줄이면 provider가 실제로 구분해 다루는 걸 우리가 뭉개는 것이고, 그 손실은 복구가 안 된다.

**벤더가 더 구체적인 타입을 알려주면 그걸 쓴다.** ServiceNow는 부모 클래스와 자식 클래스가 한 테이블 한 행을 공유한다. `incident` 레코드가 `task`로도 조회되고 `sys_id`가 같다. 조회한 테이블 이름을 쓰면 같은 레코드가 두 행이 되므로, `sys_class_name`이 알려주는 실제 클래스를 쓴다.

JSON:API를 쓰는 provider는 `data.type`이 그 값이다. Terraform은 `"type": "workspaces"`, Datadog은 `"type": "users"`.

### 벤더가 두 이름으로 부를 때

"provider가 부르는 이름"만으로는 안 갈리는 경우가 흔하다. 같은 대상을 메서드 경로에서 한 이름으로, 응답 필드에서 다른 이름으로 부른다.

Slack이 그렇다.

| 대상 | 메서드 경로 | 응답 필드 | 감사 로그 entity |
| --- | --- | --- | --- |
| 채널 | `conversations.*` | `channels[]` | `channel` |
| 워크스페이스 | `admin.teams.*` | `team` | `workspace` |
| 사용자 그룹 | `usergroups.*` | `usergroups[]` | `usergroup`, SCIM은 `Group` |

**우선순위로 정한다.**

1. 응답 필드 이름 (`channels[]` → `channel`)
2. 감사 로그나 이벤트의 entity 이름
3. 메서드 경로 이름

응답 필드가 실제 데이터에 붙은 이름이고, 메서드 경로는 제품 용어에 가장 가깝다. Slack은 UI에서 "워크스페이스"라고 부르지만 모든 응답 필드가 `team`이다.

이 순서로도 안 갈리면 **한쪽을 골라 Profile의 `open_issues`에 왜 골랐는지 남긴다.** 조용히 고르지 않는다.

## interfaces[]

아홉 개로 고정이다. 늘리지 않는다.

`Tenant` `Principal` `Integration` `Credential` `Assignment` `Policy` `Endpoint` `Resource` `Automation`

정의와 판별 기준은 `Interface_Spec_v3.md`에 있다.

한 Object가 여러 개를 가질 수 있다. 단 **같은 interface를 두 번 갖지는 못한다.** 배열이 필요해지면 Object를 나누라는 뜻이다. GitHub App 하나에 webhook URL, callback URL, setup URL이 있으면 Endpoint를 세 번 갖는 게 아니라 Endpoint Object가 세 개 생긴다. 주소 하나가 Object 하나다.

## identifiers{}

자기를 식별하는 값들과, 그중 무엇을 키로 쓸지.

```yaml
identifiers:
  primary: [id]
  id:
    value: 00u1f96ECLNVOKVMUSEA
    stability: undocumented
  login:
    value: isaac.brock@example.com
    stability: mutable
    normalization: [lowercase, trim]
```

### primary 성분이 응답에 없을 수 있다

다섯 provider를 확인한 결과 **grant 성격의 객체는 자기 id가 없는 경우가 흔하다.** 그때 키의 한 성분이 응답 본문이 아니라 **요청**에서 온다.

```yaml
identifiers:
  primary: [app_id, user_id]
  app_id:  { value: 0oa2v0el0gP90aqjJ0g7, from: $request.appId }
  user_id: { value: 00ub0oNGTSWTBKOLGLNR, path: id }
```

Okta AppUser가 그렇다. 레코드의 `id`는 "Okta **사용자**의 식별자"라서 본문만으로는 배정을 특정하지 못한다. Google Drive permission도 같다 — `permissionId`는 받는 쪽의 **전역** id라 파일을 빼면 유일하지 않다.

**응답에 있든 요청에 있든 `identifiers`에 적히면 키가 될 수 있다.** 이 구분은 `source.observations[]`에 남으므로 되짚을 수 있다.

### primary는 목록이다

대부분 길이 1이지만, **식별자가 아예 없는 대상이 많다.**

| 대상 | 키 |
| --- | --- |
| Slack 앱 설치 | `app_id` + 테넌트. `installation_id`라는 필드가 없다 |
| Okta 리소스셋 바인딩 | `(resourceSetId, roleId)`. 응답의 `id` 필드는 **역할의 id**다 |
| Okta 그룹 멤버십 | `(groupId, userId)`. 멤버십 객체 자체가 없고 응답이 204다 |
| Snowflake grant | `(privilege, granted_on, name, grantee_name)`. `SHOW GRANTS`에도 `ACCOUNT_USAGE`에도 id 컬럼이 없다 |
| GWS 그룹 멤버십 | `(groupKey, memberKey)` |
| Salesforce AccountShare | `(AccountId, UserOrGroupId, RowCause)`. 문서의 필드 목록에 `Id`가 없다 |

`id`라는 이름의 필드가 있다고 그게 이 객체의 id인 것도 아니다. Okta `AppUser.id`는 **사용자의 id**, `ApplicationGroupAssignment.id`는 **그룹의 id**다. 그대로 받으면 배정 행이 조용히 합쳐진다.

### stability

| 값 | 언제 |
| --- | --- |
| stable | 변하지 않는다고 문서가 **명시**했다 |
| mutable | 변할 수 있다. 이름·이메일·주소 |
| unstable | 벤더가 "값이 유지된다고 보장 못 한다"고 **직접 썼다** |
| undocumented | 문서에 아무 말이 없다 |

**`readOnly`를 `stable`의 근거로 쓰면 안 된다.** `readOnly`는 "클라이언트가 설정할 수 없다"는 뜻이고 "절대 안 변한다"가 아니다. Okta는 스펙 전체에서 "immutable"이라는 단어를 OIDC `client_id`에 딱 한 번 쓴다. `User.id` 설명은 "The unique key for the user"가 전부다. **필요할 때는 쓴다는 뜻이고, 없는 건 실수가 아니다.**

`unstable`의 실례가 둘 있다. Salesforce Tooling API `EntityDefinition.DurableId`는 "쓰기 전에 항상 다시 조회하라, 릴리스가 바뀌어도 같은 값이라는 보장이 없다"고 적혀 있다. GitHub `node_id`는 전역 ID 마이그레이션으로 **값이 바뀐다** — 같은 객체가 `MDQ6VXNlcjM0MDczMDM=`와 `U_kgDOADP9xw` 두 형태로 나오고, 어느 쪽이 나오는지는 요청 헤더에 달렸다. `node_id`는 더 강한 키가 아니라 더 약한 키다.

### 이메일은 primary가 될 수 없다

변해서가 아니라 **다른 사람에게 넘어가기 때문이다.** Google Workspace 문서: 계정 삭제 20일 후 주소가 제거되지만, 그 전에는 다른 관리 사용자에게 재할당할 수 있다.

### normalization

같은 값이 형태만 다르게 오는 경우에만 쓴다.

Salesforce ID는 15자와 18자 두 형태다. 15자는 대소문자를 구분하고, 18자는 뒤 3자가 앞 15자의 대소문자를 인코딩한 검사값이다. **API는 항상 18자를 돌려준다.** 15자로 저장해 두고 18자와 비교하면 전부 불일치하고, 15자를 대소문자 무시하고 비교하면 서로 다른 레코드가 충돌한다. 정규화 방향은 15 → 18이다.

### 식별자를 만들 수 없는 대상은 수집하지 않는다

Okta `GET /users/{id}/appLinks`가 그런 경우다. `id` 필드는 그 **사용자의** id라 목록의 모든 행에 똑같이 들어 있고, `appAssignmentId`는 다른 어디에도 없는 별도 id 공간인데 공식 예시에서 두 개의 서로 다른 앱 링크가 같은 값을 갖는다. 어떤 조합으로도 유일해지지 않는다. Profile에서 제외로 표시한다.

## references{}

다른 Object를 가리키는 값. 항목 하나가 **여러 대상을 가리킬 수 있다.**

```yaml
references:
  manager:
    kind: direct_id
    path: profile.managerId
    targets:
      - { object_type: User, value: 00u456, status: inferred }

  assign_to_groups:
    kind: direct_id
    path: actions.assignUserToGroups.groupIds
    targets:
      - { object_type: Group, value: 00g111, status: confirmed }
      - { object_type: Group, value: 00g222, status: confirmed }

  condition_people:
    kind: direct_id
    targets:
      - { object_type: User,  value: 00u789, status: inferred }
      - { object_type: Group, value: 00g333, status: inferred }
```

**항목**은 그 필드가 어떻게 가리키는지를 담는다 — `kind`, `path` 또는 `from`, `resolution_context_required`.
**target**은 누구를 가리키는지를 담는다 — `object_type`, `value`, `identifier_type`, `scope`, `provider`, `status`.

`status`가 target 쪽에 있는 이유는 한 필드 안에서 하나는 풀리고 하나는 안 풀릴 수 있기 때문이다. 세 번째 예시처럼 한 필드가 User와 Group을 섞어 가리키는 경우도 이걸로 담긴다.

관계를 Relation으로 뽑는 것은 그다음이다. Object가 먼저 "누구와 이어져 있는지"를 다 들고 있어야 한다.

### kind

| kind | 언제 |
| --- | --- |
| direct_id | 대상의 식별자를 그대로 담고 있다 |
| name_key | 이름으로 가리킨다. 문맥 없으면 중복될 수 있다 |
| provider_urn | 대상 종류가 문자열 안에 들어 있다. Okta ORN 같은 것 |
| external_locator | 수집 대상 밖을 가리킨다 |
| unknown_id | 가리키는 건 맞는데 대상을 못 정하겠다 |
| expression | 파서가 있어야 푼다 |

`external_locator`가 중요하다. Event Hook의 외부 URL, Log Stream이 내보내는 AWS 계정 — 데이터가 나가는 목적지다. `properties{}`에 그냥 문자열로 두면 "밖으로 나가는 곳 전부"를 물을 때 모든 행의 속성을 뒤져야 한다.

`expression`과 `unknown_id`는 **값은 남기되 관계는 만들지 말라**는 표시다.

### status

`source{}`는 값이 어디서 왔는지를 적고, `status`는 **그 값이 뭘 가리키는지에 대한 확신**을 적는다. 응답에서 확실히 받은 값이라도 그게 무엇을 가리키는지는 추측일 수 있다.

`confirmed`는 대상 종류와 의미를 문서나 응답으로 확인한 것, `inferred`는 추론한 것, `unresolved`는 아직 닫히지 않은 것이다.

#### unresolved_reason

`unresolved`만 적으면 나중에 다시 시도해야 하는지를 모른다. 그래서 이유를 같이 적는다. 네 값뿐이다.

| 값 | 언제 | 나중에 풀리나 |
| --- | --- | --- |
| `unknown_prefix` | 값은 받았는데 대상 종류를 못 정했다 | 해석 규칙을 추가하면 풀린다 |
| `value_not_returned` | 대상 종류는 확실한데 벤더가 값을 안 준다 | **안 풀린다.** 다시 불러도 같다 |
| `needs_parser` | `kind: expression`이라 파서가 있어야 한다 | 파서를 만들면 풀린다 |
| `outside_scope` | 대상이 수집 범위 밖이다 | 범위를 넓히면 풀린다 |

이 구분이 있어야 **재시도할 것과 포기할 것을 가른다.** `value_not_returned`를 수집 실패로 보고 계속 재시도하는 게 제일 흔한 낭비다.

### tenant와 parent

`tenant`는 필수이고 target이 정확히 하나다. 최상위 테넌트 자신만 비어 있다.

`parent`는 이 Object가 다른 Object에 속해서 그 안에서만 식별될 때 쓴다. target은 하나다. Okta 앱 키의 `kid`는 앱이 다르면 같은 값이라도 다른 키다. `parent`가 없으면 두 앱의 같은 `kid`가 한 행으로 합쳐진다.

계층이 여러 단이어도 `parent`에는 **직속 하나만** 담는다.

### 타입은 아는데 id가 없는 참조

Okta에서 나왔다. `_links.assignee.href`는 **대상 타입은 링크 스키마로 정해지는데 id를 주는 필드가 아예 없다.** href 경로를 파싱해야 값이 나온다.

`_links[].type`은 쓸 수 없다. 규격이 그걸 **미디어 타입**(`application/json`)으로 정의한다. 대상 객체의 종류가 아니다.

```yaml
assignee:
  path: _links.assignee.href
  object_type: "@resolve"
  resolve: { by: link_path, pattern: "/api/v1/{type}/{id}" }
```

`@resolve`의 기존 용법(종류를 모름)과 **다른 문제**다. 여기서는 종류는 아는데 값이 구조 안에 숨어 있다.

### 값은 해석해서 넣는다

원본 값만 두면 뭘 가리키는지 알 수 없다. Slack 채널 목록의 `context_team_id`는 이름과 달리 DM이면 워크스페이스(`T…`)가 아니라 엔터프라이즈(`E…`)를 준다.

참조가 필드가 아니라 링크 안에 있는 경우도 있다. Okta 바인딩 멤버는 자기 id(`irb…`)가 사용자 id도 그룹 id도 아니고, 누구인지는 `_links.self`의 `/api/v1/users/00u…`를 파싱해야만 나온다. 이런 추출 방법은 Profile이 정한다.

## properties{}

벤더가 준 이 객체의 속성. 일곱 가지 규칙이 있다.

### 1. 모양은 소스를 따른다

문서를 돌려주는 소스(GitHub, Okta, Salesforce, ServiceNow, Google)는 **중첩과 키 이름을 그대로** 둔다. 평탄화하지 않고, 대소문자를 고치지 않는다.

Slack 유저 응답이 이렇게 오면

```json
{ "id": "USLACKBOT", "real_name": "Slackbot",
  "profile": { "real_name": "Slackbot", "title": "" } }
```

`properties`도 `profile`을 중첩으로 담는다. `profile.real_name`처럼 점을 찍어 펴지 않는다. 점 표기는 **필드를 가리킬 때만** 쓴다 — `source.fields`, Profile의 `path`, `redact`. 저장 구조가 아니라 주소다.

결과셋을 돌려주는 소스는 **이미 평평하다.** Snowflake의 `SHOW USERS`와 `ACCOUNT_USAGE` 뷰는 타입이 있는 컬럼의 행이지 문서가 아니다. 컬럼 하나가 키 하나가 되고, 컬럼 이름은 소스가 쓴 대로 둔다. `SHOW`는 소문자(`created_on`), `ACCOUNT_USAGE`는 대문자(`CREATED_ON`)다. **평평한 게 결함이 아니므로 중첩을 지어내지 않는다.**

값이 VARIANT나 ARRAY인 컬럼은 파싱한 구조를 그 키의 값으로 둔다. Snowflake `ACCESS_HISTORY.base_objects_accessed`가 객체 배열인 것이 그런 경우다.

### 2. 봉투와 전송 메타데이터는 버린다

`properties{}`는 **레코드 자체**만 담는다.

| provider | 버리는 것 |
| --- | --- |
| Terraform, Datadog | JSON:API 봉투. `properties`는 `data.attributes`의 내용이다. `data.id`는 identifiers로, `data.type`은 object_type으로, `data.relationships`는 references로 |
| ServiceNow | `{"result": [...]}` 래퍼 |
| Salesforce | `{"records": [...], "totalSize", "done", "nextRecordsUrl"}` 래퍼, 그리고 레코드마다 붙는 `attributes: {type, url}` |
| Google Workspace | 래퍼는 없지만 `kind`와 `etag`가 진짜 필드와 같은 깊이에 섞여 있다 |
| 전부 | 목록 래퍼와 페이지네이션. GitHub `{total_count, repositories[]}` 같은 것 |

Google이 보여주듯 봉투를 벗기는 것만으로는 부족하다. **전송 메타데이터가 레코드 안에 섞여 들어오기도 한다.**

### 3. 모든 층이 열린 맵이다

테넌트가 키 이름을 정하는 경우가 있고, 그때 **키 경로 자체가 데이터다.**

Google Workspace `customSchemas`는 `customSchemas.<스키마이름>.<필드이름>` 꼴이고 둘 다 고객이 정한다. 계정당 스키마 100개, 필드 100개까지 가능하다.

Okta `UserProfile`은 `additionalProperties`로 열려 있고 **접두사 규칙이 없다.** 고객이 만든 `department`와 기본 `department`가 모양으로 구분되지 않는다. 더 나아가 `visibility.appLinks.testorgone_customsaml20app_1_link`처럼 **키 이름에 앱 인스턴스 이름이 들어가기도** 한다.

그러므로 키 이름으로 keep 목록을 만들면 절대 완전해지지 않는다. 테넌트가 정한 키는 그대로 저장하되 그렇게 표시한다. ServiceNow `u_*`, Salesforce `*__c`도 같다.

### 4. 참조처럼 생긴 건 참조다

벤더가 중첩 속성 모양으로 보내도, 다른 객체를 식별하는 값이면 `references{}`로 간다.

ServiceNow Table API는 참조 필드를 두 키짜리 객체로 준다.

```json
"opened_by": { "link": "https://…/api/now/table/sys_user/glide.maint",
               "value": "glide.maint" }
```

이건 참조다. `properties{}`에 그대로 두지 않는다.

### 5. 타입도 이름도 통일하지 않는다

같은 키가 object_type마다 다른 타입일 수 있다. GitHub `permissions`는 저장소에서 `{"pull": true}` 불리언이고 설치에서 `{"checks": "write"}` 문자열이다. 온 대로 저장한다.

같은 개념이 엔드포인트마다 다른 이름으로 올 수도 있다. Snowflake는 `SHOW GRANTS`가 `granted_on`, `ACCOUNT_USAGE`가 `GRANTED_ON`, `SHOW FUTURE GRANTS`가 `grant_on`이다. 사용자 만료도 `expires_at_time`과 `EXPIRES_AT`으로 갈린다. **이름을 고쳐 맞추지 않는다.** 정규화는 `judged{}`와 interface 층에서 한다.

### 6. 여기 안 들어가는 것

| | 어디로 | 왜 |
| --- | --- | --- |
| 테넌트마다 달라지는 값 (`is_owner`, `is_admin`) | Relation | 같은 사람이 워크스페이스 A에선 소유자고 B에선 아니다. 둘 다 참이라 하나만 못 고른다 |
| 권한·스코프 목록 | Relation | 권한은 주체와 대상을 잇는 사실이다 |
| 다른 걸 가리키는 값 | references | 외부 URL이나 표현식도 포함 |
| 우리가 판정한 값 | judged | 벤더 응답과 대조가 안 되게 된다 |
| 자격증명 값, 아이콘 URL | 저장 안 함 | Profile의 `redact` 참조 |

### 7. 소스마다 값이 다른 키는 배열이다

한 행이 여러 관측을 담으므로 **같은 키에 값이 둘 이상 올 수 있다.** 그런 키는 Profile이 `properties.per_source`에 미리 적고, 값이 항상 배열이 된다.

```yaml
properties:
  is_owner: true
  tz: Asia/Seoul
  date_created:                       # per_source 에 선언된 키
    - { value: 1788199948, obs: 0 }
    - { value: 1789021383, obs: 1 }
```

`obs`는 `source.observations[]`의 인덱스다.

**선언한 키는 관측이 하나뿐이어도 배열이다.** 데이터에 따라 모양이 바뀌면 읽는 쪽이 두 경우를 다 처리해야 한다.

**선언하지 않은 키에서 값이 갈리면 오류다.** 조용히 하나를 고르지 않는다. 합치기가 멈추고, 사람이 Profile에 그 키를 추가한 뒤 다시 돌린다. `basis`의 기본값을 없앤 것과 같은 이유다 — 빠뜨린 것이 자동으로 어떤 답이 되면 안 된다.

실측에서 갈린 키는 Slack 125노드 전체에 **`user.date_created` 하나, 3노드**뿐이다.

| user | 값 | 차이 |
| --- | --- | --- |
| U0BTRNDU62F | 1788199948 / 1789021383 | 약 9일 |
| U0BUVKSFMR6 | 1788232409 / 1789021385 | 약 9일 |
| U0C0RPPRZ0W | 1789031020 / 1789031022 | 2초 |

**두 값 다 `POST /api/admin.users.list`에서 왔다.** API 이름이 같고 워크스페이스만 다르다. 그래서 관측을 API 이름으로 구분할 수 없다. `observations[]`가 요청 단위여야 하는 이유가 이것이다.

### 같은 이름이 한 응답 안에서 갈린다

위 표의 첫 줄이 보기보다 까다롭다. **같은 이름의 필드가 한 응답에 두 번 나오면서 스코프가 다를 수 있다.**

Slack `users.list` 응답이 그렇다.

```json
{ "id": "U0BTRNDU62F",
  "is_admin": true,
  "enterprise_user": { "enterprise_id": "E0EXAMPLE01", "is_admin": false } }
```

루트의 `is_admin`은 **요청한 워크스페이스에서** 관리자라는 뜻이다. 다른 워크스페이스로 같은 호출을 하면 값이 달라진다. `enterprise_user.is_admin`은 엔터프라이즈 전체에 대한 값이다.

우리 테넌트는 엔터프라이즈다. 그러므로

- `enterprise_user.is_admin` → 테넌트 안에서 하나로 정해진다. **`properties{}`**
- 루트 `is_admin` → 테넌트 안에서 워크스페이스마다 갈린다. **Relation**

판별선은 이름이 아니라 **범위**다.

> 이 값이 이 Object의 테넌트 안에서 하나로 정해지면 `properties{}`, 테넌트 안의 무엇에 따라 갈리면 Relation.

이름이 같다고 같이 취급하면 둘 중 하나가 조용히 사라진다. 어느 경로가 어느 범위인지는 Profile이 적는다.

## judged{}

interface 계약이 요구하는 값. **벤더가 준 게 아니라 우리가 내린 판정이다.**

GitHub webhook 응답에 `direction`이라는 필드는 없다. 밖으로 내보낸다는 판단은 우리가 한 것이다.

**평면 맵이다.** interface 이름으로 중첩하지 않는다.

```yaml
judged:
  endpoint_owner: provider_hosted
  blocking: none
  material_location: counterparty_side
```

이름이 거의 안 겹치기 때문이다. interface를 가장 많이 겹쳐 가진 Slack IncomingWebhook(Endpoint + Credential)이 겹치는 필드를 들고도 충돌이 없다. 어느 필드가 어느 interface 것인지는 `Interface_Spec_v3.md`가 기록한다.

**두 interface가 같은 이름을 선언하는 경우가 하나 있다.** Credential과 Assignment가 둘 다 `expires_at`을 요구한다. 한 Object가 둘 다 가질 수 있다 — GitHub fine-grained PAT 부여는 토큰이면서 조직에 대한 부여다.

이럴 때 규칙은 이렇다.

> 두 interface가 같은 이름을 선언하면 **그 값은 같은 사실이어야 한다.** 다른 사실이면 Object를 둘로 나눈다.

PAT 부여에서는 토큰이 만료되는 시점과 부여가 끝나는 시점이 같은 사실이라 한 칸으로 충분하다. 만약 자격증명 자체의 수명과 그것이 실어 나르는 권한의 수명이 벤더에서 따로 관리되는 경우가 나오면, 그때는 한 행에 담지 않는다.

**object_type만으로 값이 정해지는 건 여기 안 온다.** GitHub webhook은 언제나 `direction: out`이다. 그런 상수는 Profile에 한 번만 적는다.

## source{}

어느 요청에서 언제 수집했는지.

```yaml
source:
  schema_version: 3                   # 이 행을 만든 명세의 버전
  first_seen_at: 2026-08-01T09:00:00Z
  last_seen_at: 2026-09-17T10:00:00Z
  revision: 7
  redacted: []
  observations:                       # 이 대상을 본 요청 전부. 순서가 곧 인덱스다
    - api: GET /repos/{owner}/{repo}
      params: { expand: "" }          # 응답 모양을 바꾸는 파라미터. 값을 그대로 적는다
      record: (root)                  # 응답 안의 위치. members[] 같은 것
      collected_at: 2026-09-17T10:00:00Z
      file: 20260917_213114_repos.json
    - api: GET /orgs/{org}/repos
      params: { per_page: "100" }
      record: (root)
      collected_at: 2026-09-17T10:00:02Z
      file: 20260917_213116_org_repos.json
```

`observations[]`는 **요청 단위지 API 단위가 아니다.** 같은 API를 파라미터만 바꿔 여러 번 부르면 항목도 여러 개다. Slack `admin.users.list`를 워크스페이스 두 곳에 부른 것이 그 경우고, 거기서 `date_created`가 갈렸다.

`params`에는 **실제 값**을 적는다. `<workspace>` 같은 자리표시자를 적으면 두 관측이 구분되지 않는다.

관계를 만든 관측은 그 사실도 같이 적는다.

```yaml
    - api: POST /api/users.list
      params: { team_id: T0EXAMPLE01, limit: "200" }
      record: members
      as_relation_fired: [is_owner, is_admin, enterprise_user.is_admin]
```

**`as_relation_fired`가 관측마다 다르다.** 위 셋 중 `enterprise_user.is_admin`은 `users.list`에서만 발동한다. `admin.users.list`에는 `enterprise_user`가 아예 없다. 행 하나에 하나만 적으면 "왜 이 관계가 생겼나"를 되짚을 수 없다.

**v1의 `apis[]`와 `fields{}`는 없앴다.** `apis[]`는 문자열 목록이라 같은 API의 다른 요청을 구분 못 했다. `fields{}`는 "주 요청"이 있어야 성립하는데, 합친 뒤에는 주 요청이 없다.

**그 대신 잃는 것이 있다.** 값이 갈리지 않는 키는 어느 관측에서 왔는지 더 이상 안 남는다. `tz: Asia/Seoul`이 세 관측 중 어디서 왔는지 모른다. 값이 같으므로 답이 달라지지 않는다고 보고 받아들였다. 갈리는 키는 `per_source`가 전부 기록한다.

### 명세 버전

`schema_version`은 **이 행을 만든 명세가 몇 번째 판이었는지**다. **파일 이름의 버전과 다르다.** 행의 모양이 안 바뀌면 문서 판이 올라가도 이 번호는 그대로다.

```
v1    schema_version 1
v2    schema_version 2    엔드포인트당 한 행 -> 대상당 한 행
v2.1  schema_version 2    모양 안 바뀜
v3    schema_version 2    모양 안 바뀜
v4    schema_version 3    service 자리가 생기고 동일성 키가 바뀜
```

올리는 기준은 하나다.

> **이미 저장된 행을 고쳐야 하면 올린다. 옛 행이 그대로 유효하면 안 올린다.**

| 바뀐 것 | 어떻게 |
| --- | --- |
| 키를 새로 추가했는데 없어도 되는 값 | 그대로 v1 |
| 규칙을 더 명확히 썼는데 행의 모양은 같음 | 그대로 v1 |
| 키 이름이 바뀜 | v2 |
| 값의 모양이 바뀜 (문자열이 객체가 되는 식) | v2 |
| 필수 키가 생김 | v2 |

예를 들어 이 명세를 쓰는 동안 참조를 문자열 하나(`provider:type:scope:id`)로 적다가 `{kind, targets[]}` 구조로 바꿨다. 행이 쌓이기 전이라 번호를 안 올렸다.

그래서 **번호는 명세를 몇 번 고쳤는지가 아니라 마이그레이션을 몇 번 했는지를 센다.**

**v2로 올린 이유는 위 표의 두 줄에 걸리기 때문이다.** `source`가 객체에서 배열이 됐고(값의 모양), `per_source` 키가 스칼라에서 배열이 됐다. v1 행을 그대로 두면 읽는 쪽이 두 모양을 다 처리해야 한다.

**Relation 행은 v1 그대로다.** 관계의 모양은 안 바뀌었다. 두 층의 번호가 갈리는 것이 정상이고, 그래서 번호를 행 안에 적는다.

섞여 쌓인 행을 나중에 구분하려면 이 값이 행 안에 있어야 한다. 파일 이름에만 있으면 수집기가 돌고 난 뒤에는 알 수 없다.

### 대조 기준은 "그 API"가 아니라 "그 요청"이다

같은 저장소의 응답이 최소 세 가지다. `GET /repos/{owner}/{repo}`는 `organization`, `parent`, `source`, `temp_clone_token`을 주지만 목록 응답은 그 필드들이 아예 없다. `/installation/repositories`에서는 `{total_count, repositories[]}` 안에 들어간다.

Okta `_embedded`는 `expand`를 붙였을 때만 나오고, Datadog `included`는 `include`를 붙였을 때만 나온다. ServiceNow는 `sysparm_display_value` 값에 따라 참조 필드의 모양 자체가 바뀐다.

그래서 **`params`를 기록한다.** 그리고 이렇게 읽는다:

> 필드가 없다는 건 **"이 요청이 안 돌려줬다"**는 뜻이지 **"객체에 없다"**가 아니다.

### 시간

관측 시각과 변경 시각은 다르다. 수집을 하루 한 번 돌면 `last_seen_at`은 하루 단위로만 움직인다. 벤더가 `lastUpdated`를 주면 그게 진짜 변경 시점이고, 안 주는 벤더도 많다. 벤더 시각은 `properties`에 원본 그대로 두고 여기는 우리 관측만 적는다.

**사라졌다는 판단은 그 행을 만든 Profile의 `collect.listable`이 `true`일 때만 허용한다.** `listable`은 object_type의 성질이 아니라 어느 엔드포인트로 물었느냐의 성질이고, 목록이 되는데도 벤더가 일부를 걸러내는 경우가 있다. 함정은 `Profile_Schema_v3.md`의 `listable` 절에 있다. 원래 규칙은 목록 조회가 되는데 이번 수집에 안 나왔으면 없어진 것이다. Google Workspace의 도메인 전체 위임처럼 목록 API가 없는 종류는 영원히 그 판단을 할 수 없다.

`observations`가 목록인 건 같은 Object가 여러 요청에 나타나기 때문이다. Slack 실측에서 125노드 중 **58노드가 둘 이상의 관측**을 가졌다. 나머지 67노드는 한 곳에서만 나왔다.

`judged{}`의 값은 응답에서 온 게 아니라서 `fields`에 안 적는다. `references`에서 `from: $path.*`로 표시한 값도 마찬가지다.

---

## 같은 Object인지 판단하기

```
(provider, service, object_type, identifiers[primary] 전부, references.parent ?? references.tenant)
```

문자열로 조립하지 않는다. 컬럼 단위로 조인한다. **자리 이름으로 읽고 위치로 읽지 않는다.**

**provider** — SaaS가 다르면 다른 거다.

**service** — 같은 벤더가 파는 다른 제품이면 다른 거다. `null`은 기본 표면이고, `null`끼리는 같은 값으로 친다. 318건에서 이름이 겹치는 쌍이 8개 나왔고 전부 이 축에서 나왔다.

**object_type** — 같은 provider의 다른 종류가 같은 식별자 값을 가질 수 있다. 없으면 무관한 두 행이 합쳐진다.

**primary 전부** — 목록이므로 원소를 다 쓴다. 전체 `identifiers{}`를 쓰지 않는 이유는 관측마다 식별자 집합이 다르기 때문이다. 같은 저장소를 한 엔드포인트에서 보면 `node_id`가 오고 다른 목록에선 안 온다.

**parent ?? tenant** — 두 가지를 한꺼번에 막는다. 하나는 전역 식별자다. Slack 앱의 `A…`는 전역값이라 워크스페이스 세 곳에 설치하면 세 행의 식별자가 같다. 다른 하나는 부모 스코프 자식이다. Okta 앱 키의 `kid`는 앱 안에서만 유일하다.

테넌트가 키에 들어 있어서 막히는 것이 실제로 있다. Salesforce 샌드박스를 갱신하면 **레코드 Id는 복사되고 조직 Id만 바뀐다.** ServiceNow는 Update Set이나 XML로 옮긴 레코드의 `sys_id`가 그대로다. 두 경우 다 같은 식별자가 여러 테넌트에 동시에 존재한다.

### 합치는 법

**스코프는 키에 바로 넣지 않는다.** 두 단계로 나눈다.

```
1단계   (provider, service, object_type, primary 전부) 로만 모은다
2단계   그 묶음 안에 서로 다른 스코프가 둘 이상일 때만 쪼갠다
```

한 단계로 하면 **어떤 엔드포인트가 그 참조를 안 준다는 이유만으로 같은 대상이 두 노드로 갈린다.** 없는 것과 다른 것은 다르다.

Slack `team`이 그 자리다. `enterprise_id`는 `team.info`에만 있고 `admin.teams.list`에는 없다. 두 엔드포인트를 다 부르면 한 관측은 스코프가 있고 한 관측은 없다.

| | 한 단계 | 두 단계 |
| --- | --- | --- |
| `team.info`를 추가로 부름 | 2노드 | **1노드** |
| 같은 전역 id가 테넌트 두 곳에 설치됨 | 2노드 | **2노드** |

둘 다 맞아야 한다. 전역 식별자를 막으려고 스코프를 키에 넣은 것이므로, 스코프가 **실제로 갈릴 때는 여전히 쪼개져야 한다.**

**스코프가 둘 이상인데 스코프 없는 관측이 섞이면 오류다.** 그 관측을 어느 쪽에 넣을지 정할 근거가 없다. 조용히 한쪽에 붙이지 않는다.


키가 같은 행이 여럿이면 **한 행으로 만든다.** 자리마다 규칙이 다르다.

| 자리 | 규칙 | 안 맞으면 |
| --- | --- | --- |
| `identifiers` | 합집합 | 같은 키에 값이 다르면 오류 |
| `references` | 이름별로 `targets[]` 합집합. target마다 `obs[]` | `kind`·`relation_type`·`basis`가 다르면 오류 |
| `interfaces[]` | 같아야 한다 | 오류 |
| `judged{}`, `root_tenant` | 같아야 한다 | 오류 |
| `properties` | 값이 같으면 하나로 | 다르면 `per_source`에 선언돼 있어야 한다 |
| `source` | `observations[]`에 이어 붙인다 | — |

Slack 실측에서 실제로 걸린 것은 **`properties` 한 자리뿐**이다.

- `identifiers` 충돌 0건. `username`은 SCIM만 주고 Web은 안 줘서 합집합으로 끝난다
- `references` 메타 불일치 0건. 이름이 같으면 같은 Profile 항목에서 나오므로 당연하다
- `properties` 충돌 `user.date_created` 3노드

**참조의 `targets[]`가 늘어나는 것은 충돌이 아니다.** `user.queried_team`이 4노드에서 늘었는데, 워크스페이스 두 곳에서 같은 사람을 조회했다는 뜻이다. 소속이 둘인 게 맞다.

`references.tenant`와 `references.parent`는 target이 하나여야 하므로, 여기서 늘어나면 **동일성 키가 틀렸다는 신호**다. 그 둘은 키에 들어 있어서 원래 늘어날 수 없다.

#### target마다 어느 관측에서 왔는지 남긴다

합치면서 `targets[]`가 늘어나므로, **각 target이 어느 관측에서 나왔는지**를 같이 적는다.

```yaml
references:
  queried_team:
    kind: direct_id
    status: confirmed
    relation_type: member_of
    basis: computed
    targets:
      - { value: T0EXAMPLE01, object_type: team, obs: [1, 2] }
      - { value: T0EXAMPLE02, object_type: team, obs: [3] }
```

**`properties.as_relation`이 이걸 필요로 한다.** 불리언은 그 관측의 범위에서만 참이다. Slack 루트 `is_admin`은 **그 호출에 쓴 워크스페이스**에서 관리자라는 뜻이고, 다른 워크스페이스로 같은 호출을 하면 값이 달라진다.

`obs`가 없으면 관측 3에서만 참인 `is_admin`이 워크스페이스 두 곳 모두에 붙는다. **없는 권한을 지어낸다.**

지금 테넌트에서는 갈리는 사례가 0건이다. 사용자 30명의 `is_owner`·`is_admin`·`is_primary_owner`를 워크스페이스 두 곳에서 대조했고 전부 같았다. **그래도 남긴다.** 이 응답 필드의 정의상 갈릴 수 있고, 갈리는 순간 조용히 틀리기 때문이다.

### 참조로만 나온 대상도 노드가 된다

관계의 대상으로만 등장하고 **어느 목록에도 안 나온 id**가 있다. 그냥 두면 그래프에 **끝이 없는 화살표**가 남는다.

그런 id에도 노드를 만든다. `stub: true`로 표시한다.

```yaml
provider: slack
object_type: channel
interfaces: [Resource]
identifiers: { id: C0BV82HEX7B, primary: [id] }
references:
  tenant:
    kind: direct_id
    status: inferred                  # 가리킨 쪽에서 물려받았다. 관측이 아니다
    targets: [{ value: E0EXAMPLE01, object_type: enterprise, obs: [0] }]
properties: {}
stub: true
source:
  schema_version: 3
  observations:
    - api: POST /api/admin.roles.listAssignments
      params: { limit: "100" }
      record: role_assignments
      file: 20260917_212924_admin.roles.listAssignments_r0.json
      via: slack.role_assignment.scope     # 어느 참조가 이 id 를 가리켰나
```

`observations[]`가 비어 있지 않다. **그 id를 실제로 본 요청이 있다.** 다른 대상의 응답 안에서 봤을 뿐이다. `via`가 어느 참조였는지 적는다.

**만드는 조건이 셋이다.**

- 그 `object_type`의 Profile이 있다. 없으면 무엇인지 모르므로 만들지 않는다
- 그 Profile의 `primary`가 키 하나다. 복합 키는 값 하나로 못 만든다
- `kind`가 `external_locator`나 `expression`이 아니다. 이 둘은 대상이 모델 밖이거나 파서가 필요하다

**`properties`는 비어 있다.** 지어내지 않는다. `tenant`만 가리킨 쪽에서 물려받고 `status: inferred`로 적는다.

Slack 실측에서 2개 나왔다.

| 대상 | 어디서 왔나 |
| --- | --- |
| `channel C0BV82HEX7B` | 역할이 배정된 채널인데 채널 목록에 없다 |
| `user USLACK` | DM 상대인데 사용자 목록에 없다 |

**감사 로그에만 나오는 id는 만들지 않는다.** Slack `logs.audit`의 `USALESFORCE`, `USLACKUSER` 같은 것이 그렇다. 참조의 대상이 아니라 로그의 등장인물이고, 벤더 내부 표기라 주체로 세우면 없는 계정을 지어낸다.

### 선언한 object_type 과 식별자 접두사가 어긋나는지 본다

`@resolve`를 안 쓴 자리도 검사한다. **벤더가 필드 이름과 다른 종류를 넣는 일이 있다.**

Slack `conversations.list`의 `context_team_id`가 그렇다. 이름은 team인데 **40건 중 10건이 `E…`(엔터프라이즈)**다. DM인 행에서 그렇게 나온다.

Profile이 `object_type: team`이라고 적으면 그 10건이 엔터프라이즈 id를 가진 team 노드를 만든다. 검사가 그걸 잡는다.

```
channel.context_team: object_type 을 team 이라고 했는데 값 E0EXAMPLE01 의 접두사는 enterprise 다
```

고치는 방법은 Profile을 `object_type: "@resolve"`로 바꾸는 것이다. 접두사가 실제로 갈리는 자리면 고정할 수 없다.

### 안 들어가는 것

`properties{}`는 바뀌라고 있는 값이다. `judged{}`는 우리 판정이라 로직을 고치면 전부 새 Object가 된다. `interfaces[]`도 재분류가 대량 삭제·생성으로 기록된다.

### 실제로 이렇게 된다

| 일어난 일 | 같은 Object인가 |
| --- | --- |
| 저장소 이름 변경 | 맞다 |
| 사용자 이메일 변경 | 맞다 |
| 채널 보관 처리 | 맞다 |
| 앱을 다른 워크스페이스에 또 설치 | 아니다. tenant가 다르다 |
| 다른 앱에 같은 kid의 키 | 아니다. parent가 다르다 |
| webhook URL 회전 | 아니다. 의도한 결과다 |
| 삭제 후 같은 이름으로 재생성 | 아니다. 새 id가 나온다 |

---

## 감수하는 위험

**대부분의 provider는 식별자를 재사용하지 않는다고 보장하지 않는다.** Slack, GitHub, Okta, Google Workspace, Salesforce, ServiceNow, Snowflake, Terraform 여덟 곳의 고유 API를 확인했고 전부 침묵한다.

**예외가 하나 있다. SCIM은 보장한다.** RFC 7643이 서비스 제공자가 발급하는 `id`에 대해 이렇게 적는다 — 그 제공자의 전체 리소스 집합에서 유일해야 하고, **안정적이고 재할당 불가**한 식별자여야 하며, 같은 리소스를 다시 조회해도 바뀌지 않아야 한다.

그래서 SCIM 표면으로 들어오는 `id`는 `stability: stable`의 **인용 가능한 근거**를 갖는다. 고유 API의 id는 여전히 관측에만 기댄다.

**둘을 구분해서 적는다.**

| | 근거 |
| --- | --- |
| SCIM `id`는 재할당 안 된다 | **규격 보증.** RFC 7643 |
| 같은 provider의 고유 API가 같은 값을 준다 | **측정.** Slack은 32/32 일치. 보증 아님 |

반대로 `externalId`는 보장이 없다. 규격이 **프로비저닝 클라이언트가 발급하고 서비스 제공자가 지정해서는 안 된다**고 하며, **서버는 유일성을 강제하지 않는다.** 값을 넣는 클라이언트가 관리한다고 "가정"할 뿐이다. 그래서 교차 provider 조인에 쓸 때 확정이 아니라 **주장**으로 다룬다.

반대 방향은 문서에 있다. GitHub 사용자명은 90일 뒤 누구나 쓸 수 있고, 이름을 바꾸면 옛 이름은 즉시 claim 가능하다. Google Workspace 이메일은 20일 안에 재할당된다. Snowflake는 "객체가 삭제되고 같은 이름으로 재생성될 수 있기 때문에" ID 컬럼을 둔다고 직접 쓴다. ServiceNow가 말하는 것은 "같은 `sys_id`가 두 번 **생성되지는** 않는다"뿐이고 삭제 후 재사용은 언급이 없다.

즉 **이름은 재사용된다는 것이 확인된 사실이고, 숫자·불투명 id의 재사용 여부는 미확인**이다. 우리는 후자에 기대고 있다. 근거는 관측된 동작이지 문서화된 계약이 아니다.

`first_seen_at`과 `last_seen_at`이 이 위험을 완화한다. 같은 키가 긴 공백 뒤에 다시 나타나면 재사용을 의심할 수 있다.

---

## 이 파일이 지켜야 할 것

모양에 관한 것만 여기 둔다.

- `identifiers.primary`는 비어 있지 않고, 원소가 전부 `identifiers{}`에 실재한다
- `references{}`의 모든 항목은 `kind`와 `targets[]`를 갖고, 모든 target은 `object_type`, `value`, `status`를 갖는다
- `references.tenant`와 `references.parent`는 target이 정확히 하나다
- `status`가 `unresolved`이면 `unresolved_reason`이 있고, 위 네 값 중 하나다
- `object_type`이 `null`이고 `kind`가 `external_locator`가 아니면 `status`는 `unresolved`다. `external_locator`는 대상이 모델 밖이라 종류가 없는 것이지 못 정한 것이 아니므로 `confirmed`일 수 있다
- `kind`가 `external_locator`면 `object_type`은 `null`이다
- 한 Object에 같은 interface가 두 번 나오지 않는다
- `source.schema_version`이 있고 `3`이다. 파일 이름의 버전과 같지 않다
- `source.observations[]`가 비어 있지 않고, 항목마다 `api`와 `record`가 있다
- `source.observations[].params`에 자리표시자(`<...>`)가 없다. 실제 값이어야 한다
- 같은 동일성 키를 가진 행이 둘 이상이면 오류다. 합치기가 안 끝났다는 뜻이다
- `service`는 문자열이거나 `null`이다. 빈 문자열은 `null`과 다른 값이 되므로 쓰지 않는다
- 같은 `(provider, object_type)`에 `service`가 다른 행이 둘 이상이면, 그 provider의 Profile들이 `service`를 선언하고 있어야 한다. 한쪽만 선언했으면 오류다
- `properties`의 값이 배열-of-`{value, obs}` 꼴이면 그 키가 Profile의 `properties.per_source`에 있다
- `per_source`에 선언된 키는 관측이 하나여도 그 꼴이다
- `properties[].obs`가 `source.observations[]`의 범위 안이다
- `references[].targets[].obs`가 비어 있지 않고 `source.observations[]`의 범위 안이다
- `stub: true`인 노드는 `properties`가 비어 있다
- `stub: true`인 노드의 `references`는 `tenant` 하나뿐이고 `status`가 `inferred`다
- `stub`이 아닌 노드에 `via`를 가진 관측이 없다
- 참조 대상의 식별자 접두사가 알려진 것이면 선언한 `object_type`과 같다

interface가 요구하는 제약은 `Interface_Spec_v3.md`, 수집기가 지켜야 할 것은 `Profile_Schema_v4.2.md`에 있다.
