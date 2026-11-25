# Profile Schema v4.2

object_type 하나당 하나씩 쓰는 명세다. 수집기가 응답을 보고 "이 필드가 식별자인지, 참조인지, 버릴 값인지"를 판단하는 근거가 여기 있다.

Profile은 **수집기의 입력**이고 Object는 **출력**이다. Profile은 수십 개, Object는 수만 건이 된다.

- 나오는 Object 행의 모양은 `Object_Schema_v4.1.md`
- provider 사이의 신원 판단은 `Link_Schema_v3.md`
- interface 정의와 계약은 `Interface_Spec_v3.md`

---

## v3에서 정한 것 — provider가 늘어도 기존 Profile을 안 고친다

Okta, GitHub, Google Workspace, Snowflake, Microsoft Entra 다섯 곳의 공식 문서에 이 형식을 대 보고 **구멍 12개**를 찾았다. 그 12개를 Slack Profile에 대고 세어 보니 **기존 줄을 고치게 하는 것은 2개, 580줄 중 21줄(3.6%)**이었다. 나머지 10개는 전부 **새 선택 키**라서 안 적으면 그만이다.

그 2개도 피할 수 있다는 것이 v3의 설계다. 아래 세 규칙이 그것을 보장한다.

### 규칙 1. 새 능력은 새 선택 키로만 넣는다

**생략했을 때의 뜻은 영구히 고정한다.** 나중에 값이 추가되어도 안 적은 Profile의 의미는 안 바뀐다.

이 규칙을 v1.4에서 한 번 어겼다. `basis`의 기본값을 `stated`에서 "생략 불가"로 바꿨고, **그 한 줄이 기존 Profile 전부를 무효로 만들었다.** 옵션을 더한 게 아니라 침묵의 뜻을 바꿨기 때문이다.

v4에서 또 어겼다. `enumerable: parent_fanout`이면 `fanout`이 있어야 한다는 불변식을 **spec 게이트 없이** 넣었다. `enumerable`은 v3 키이고 `fanout`은 v4 키라, `spec: 3`으로 쓴 Profile이 못 적는 키를 요구받는다. 실제로 **20개 중 5개**가 그 줄 하나에 깨졌다(`okta.app_user`, `okta.role_assignment`, `github.organization`, `github.deploy_key`, `google_workspace.asp`). v4.2에서 `spec >= 4` 게이트를 붙여 고쳤다.

> **새 판의 키를 요구하는 불변식에는 그 판의 `spec` 게이트를 함께 적는다.** 안 적으면 규칙 1을 어긴다.

키가 있을 때만 발화하는 불변식(`partition`이 있으면 …, `fanout[]`의 각 항목은 …)은 게이트가 필요 없다. 낮은 판의 Profile에는 그 키가 아예 없어서 발화하지 않는다. **위험한 것은 낮은 판의 키를 조건으로 삼아 높은 판의 키를 요구하는 줄이다.**

두 번 다 사람 눈으로는 안 잡혔다. `validation/check_profiles.py`가 이 모양을 기계로 찾는다 — 불변식마다 "요구하는 키가 처음 생긴 판"을 적어 두고, 그보다 낮은 판의 Profile이 걸리면 규칙 1 위반으로 보고한다.

### 규칙 2. 이름을 바꾸지 않는다. 키를 다른 자리로 옮기지 않는다

바꿔야 하면 **옛 이름을 별칭으로 영구히 남긴다.** v3에서 `listable`이 그렇게 처리됐다.

### 규칙 3. 기본값을 바꾸지 않는다

새 값을 목록에 더하는 것은 괜찮다. 이미 있는 값의 뜻을 바꾸는 것은 안 된다.

### 규칙으로 못 막는 것 하나

**어휘 이름을 바꾸면 provider마다 고쳐야 한다.** Slack Profile에서 `relation_type`이 적힌 줄이 23줄이다. 그래서 `Relation_Schema_v3.md`가 **어휘 이름 변경을 금지**한다. 추가만 하고, 안 쓰게 된 것은 `deprecated`로 남긴다.

### spec

Profile마다 자기가 어느 판으로 쓰였는지 적는다.

```yaml
provider: okta
spec: 4
```

수집기는 여러 판을 동시에 읽는다. **새 provider는 최신 판으로 쓰고, 기존 provider는 고칠 이유가 생길 때까지 안 고친다.**

생략하면 `spec: 1`로 본다. 규칙 1 그대로다.

`Slack_Profiles_v3.md` 8종은 `spec: 3`인 채로 둔다. v4의 새 키를 하나도 안 쓰므로 고칠 이유가 없다.

**`spec`은 파일 이름의 소수점을 따라가지 않는다.** v4와 v4.1은 둘 다 `spec: 4`다. v4.1에서 더해진 `service`와 `conditional`은 안 적으면 v4와 같은 뜻이라, v4로 쓴 Profile이 그대로 유효하다.

---

## v4에서 정한 것 — 318건 실측이 형식을 절반 밖으로 밀어냈다

GitHub 67 · Okta 134 · Slack 57 · Google Workspace 60, 합계 **318건**의 확정 object 목록에 이 형식을 대 봤다. 근거 엔드포인트를 전부 파싱해서 "로스터를 부르려면 무엇이 필요한가"로 나눴다.

```
A. 루트 로스터        85   33%   파라미터 없음
B. 테넌트만           39   15%   값이 하나
C. 부모 1단 순회     101   40%   객체마다 반복해야 한다
D. 부모 다단 순회     29   11%
```

**A와 B는 v3 형식으로 된다. C와 D 130건(51%)은 적을 자리가 없었다.**

v3이 이 구멍을 못 잡은 이유가 측정된다. 기존 Slack Profile 8종의 `role: primary` 엔드포인트를 전수로 보면 이렇다.

```
user              /scim/v2/Users                     경로 파라미터 0
channel           /api/admin.conversations.search    0
team              /api/admin.teams.list              0
enterprise        /api/auth.test                     0
usergroup         /scim/v2/Groups                    0
role_assignment   /api/admin.roles.listAssignments   0
session           /api/admin.users.session.list      0
workflow          /api/admin.workflows.search        0
```

**8종 전부 루트 로스터다.** Slack만으로는 이 구멍이 드러나지 않는다.

### v4가 더하는 것

| 키 | 무엇을 푸나 |
| --- | --- |
| `collect.endpoints[].id` | 같은 뜻의 여러 URL을 이름 하나로 묶는다 |
| `collect.endpoints[].fanout[]` | 로스터를 부르는 데 필요한 부모 값이 어디서 오나 |
| `collect.endpoints[].partition` | 로스터가 여러 엔드포인트로 쪼개질 때 |
| `collect.endpoints[].completeness` | 그 조각이 전수인지 최선인지 |
| `references[].when` | 이 참조가 어느 관측에서만 유효한가 |
| `identifiers.<키>.const` | 부모와 상수가 곧 키인 객체 |
| `root_tenant: conditional` | 루트인지가 배포마다 다를 때 |
| `service` | 한 벤더가 파는 제품이 여럿이고 `object_type` 이름이 겹칠 때 |

**전부 선택 키이고, 안 적으면 v3과 똑같이 동작한다.** 규칙 1 그대로다. 실제로 구현해서 확인했다 — Slack 8종이 새 키를 한 줄도 안 쓰고 같은 답을 냈다.

```
기준선       Object 127노드, Relation 189행
v4 구현 후   동일. objects/relations 가 정규화 후 바이트 단위로 같다
```

`service`는 동일성 키를 바꾸는 유일한 변경이라 따로 확인했다. Slack 8종이 `service`를 안 쓰고 같은 127 / 189를 냈고, `service`만 다른 두 행을 합성해 넣으면 갈린다.

### 대조는 정규화한 뒤에 한다

판을 올릴 때 결과를 대조한다는 규칙이 v3에 있다. 그 규칙에 빠진 조건이 하나 있었다.

같은 입력으로 수집기를 다섯 번 돌린 결과다.

```
run1  원본 1f0e54246cfb   정규화 198531d89596
run2  원본 3882f0d15168   정규화 198531d89596
run3  원본 a213e64f8ece   정규화 198531d89596
run4  원본 c1a9814d3b26   정규화 198531d89596
run5  원본 a360ba7033b0   정규화 198531d89596
```

**속성 키의 순서가 실행마다 바뀐다.** 내용은 같다. 파일 해시로 대조하면 아무것도 안 바뀌었는데 매번 달라졌다고 나온다.

> **대조는 키를 정렬한 뒤에 한다. 파일 해시로 하지 않는다.**

### v4.1에서 더한 것

v4를 쓴 뒤, 같은 object 목록에 v3 형식을 6종 대 본 `Pilot_Profiles_v3.md`(2026-09-21)와 대조해서 둘을 더했다.

| 무엇 | 어디서 왔나 |
| --- | --- |
| `root_tenant: conditional` | 양쪽이 따로 같은 결론에 도달했다. v4의 잠정 이름 `per_row`를 버리고 이 이름으로 맞췄다 |
| `service` | `Pilot_Profiles_v3.md`가 찾았다. v4에 자리가 없던 것이다 |

**`service`만 동일성 키를 바꾼다.** 그래서 `Object_Schema_v4.1.md`도 같이 올라갔다. 나머지 v4 키는 전부 Profile 안에서 끝난다.

### v4.2에서 더한 것

형식은 그대로고 **판정 하나를 기록했다.** 범위와 1:1인 설정 묶음은 별개 Profile을 만들지 않고 그 범위 object_type의 속성으로 흡수한다. 아래 "설정 묶음은 별개 Profile을 만들지 않는다"에 있다.

새 키가 없으므로 v4·v4.1로 쓴 Profile은 그대로 유효하다. `spec`은 셋 다 `4`다.

위 문장은 v4.2를 처음 쓸 때의 것이다. 그 뒤 2026-10-29에 선택 키 하나를 더했다. 관계 선언의 `membership_enforced`(아래 「membership_enforced — 그룹이 받은 부여가 소속을 따라가나」). 안 적으면 「모름」이라 그 전에 쓴 Profile은 그대로 유효하고 `spec`도 그대로다.

---

## 왜 따로 있나

Object의 `references{}`는 이런 모양이다.

```yaml
manager:
  kind: direct_id
  targets:
    - { object_type: User, value: 00u456 }
```

수집기가 응답에서 `"managerId": "00u456"`을 보고 이걸 만들려면, `profile.managerId`가 User를 가리킨다는 걸 알아야 한다. 그 문장을 수만 행에 반복할 이유가 없다. Profile에 한 번 적는다.

값에서 타입 정보를 뺀 대신, 그 정보가 앉을 자리가 필요해서 생긴 층이다.

---

## 구조

```yaml
provider: okta
object_type: User

interfaces:
  - Principal

collect:
  endpoints:
    - role: primary
      method: GET
      path: /api/v1/users
      params: {}
    - role: detail
      method: GET
      path: /api/v1/users/{id}
      params: { expand: "" }
  record: (root)
  envelope: none
  paging: cursor
  listable: true
  completeness: full

identifiers:
  primary: [id]
  id:
    path: id
    stability: undocumented
  login:
    path: profile.login
    stability: mutable
    normalization: [lowercase, trim]

references:
  tenant:
    from: $request.org
    object_type: Org
    kind: direct_id
    status: confirmed
  manager:
    path: profile.managerId
    object_type: User
    kind: direct_id
    status: inferred
    relation_type: null            # 아직 어휘에 자리가 없다

properties:
  keep: [status, created, activated, lastLogin]
  drop: [_links, _embedded]
  tenant_defined: [profile.*]

judged:
  principal_kind: per_row

redact:
  - credentials.password
  - credentials.recovery_question

confidence: confirmed
open_issues:
  - managerId 값이 id인지 login인지 미확인
```

---

### service — 한 벤더가 제품을 여럿 판다

`object_type`이 같은 provider 안에서 **다른 객체를 가리키는 경우**가 있다. 318건에서 **8쌍**이 나왔다.

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

우연한 이름 충돌이 아니다. **한 벤더가 제품을 여러 개 팔고, 제품마다 자기 API 표면과 자기 `User`·`Group`이 있다.**

```
Okta               management 70   opa 23   asa 10   aiagents-* 14
                   governance-* 11   aerial 4   idp 1   oag 1
Google Workspace   admin 14   cloudidentity 12   gmail 6   drive 4   vault 3 ...
Slack              하나
```

Okta `User` 둘을 펼치면 이렇다.

```
management   GET /api/v1/apps/{appId}/users/{userId}
             식별자 id, realmId
             부모   App, Device, External, Group, Id, IdentitySource...

opa          GET /v1/teams/{team_name}/users/{user_name}
             식별자 id, name, oauth_client_application_id
             부모   Group_name, Team_name, User_name
```

**경로도 식별자도 부모도 다르다.** 같은 사람일 수는 있어도 같은 레코드가 아니다.

Google Workspace `User` 둘은 interface까지 다르다. `directory.users`는 `Principal`이고 `gmailpostmastertools.domains.users`는 `Assignment`다. 뒤쪽은 사람이 아니라 **도메인의 발신 실적**에 가깝다.

### service 는 동일성 키에 들어간다

v3까지의 동일성 키는 이랬다.

```
(provider, object_type, identifiers.primary[] 값, references.parent ?? tenant)
```

**`service`가 없어서** `okta` + `user` + `id=00u1`이 두 제품에서 나오면 한 노드로 합쳐진다. 두 제품의 id가 같은 값 공간인지 아닌지 **모르는 채로 합친다**는 것이 문제다. 합치면 두 제품의 권한이 한 주체에 붙고, 안 합치면 같은 사람이 둘로 갈린다.

```
(provider, service, object_type, identifiers.primary[] 값, references.parent ?? tenant)
```

```yaml
provider: okta
service: opa           # 생략하면 이 provider 의 기본 표면
object_type: user
```

**생략하면 `null`이고, `null`끼리는 v3과 똑같이 합쳐진다.** 구현해서 확인했다 — Slack 8종이 `service`를 안 쓰고 127노드 / 189관계를 그대로 냈다. 합성 시험에서 `service`가 다른 두 행은 갈렸다.

**GitHub에는 쓰지 않는다.** GitHub의 24종은 제품이 아니라 REST 태그(`orgs`, `repos`, `actions`)라 같은 객체를 나누는 축이 아니다. `service`는 **벤더가 별도 제품으로 파는 표면**에만 쓴다.

값은 벤더가 쓰는 이름을 그대로 쓴다. 지어내지 않는다.

### provider_term

`object_type`과 **다를 때만 적는다.** 같으면 생략한다.

`object_type`은 "provider가 부르는 이름"을 우선순위로 골라 정한 **하나**다. 응답 필드 > 감사 로그 entity > 메서드 경로. 벤더가 같은 대상을 두 이름으로 부를 때, `provider_term`은 **고르지 않은 쪽**을 남긴다. 벤더 문서에서 그 이름으로 찾는 사람이 연결고리를 잃지 않게 한다.

```yaml
object_type: team
provider_term: workspace      # UI 와 감사 로그가 부르는 이름
```

같은 값을 반복하면 **다른 자리가 눈에 안 띈다.** 8종 중 하나만 다른데 나머지 일곱이 같은 값을 적고 있으면 그 하나가 안 보인다. 그래서 다르면 적고 같으면 비운다.

**우선순위로도 안 갈려서 한쪽을 골랐으면 `open_issues`에 이유를 적는다.** 조용히 고르지 않는다. 규칙에서 벗어난 이름도 마찬가지다.

## collect

어디서 어떻게 가져오는지.

### endpoints

`role`은 `primary`, `enrichment`, `detail` 셋이다. **축 두 개로 갈린다.**

| | 한 번에 여러 건 | 한 번에 한 건 |
| --- | --- | --- |
| **명부를 정한다** | `primary` | 불가능 |
| **정하지 않는다** | `enrichment` | `detail` |

**축 1 — 명부를 정하는가.** "이 엔드포인트에 안 나오면 그 객체는 없는 것인가"에 답이 `예`면 `primary`다. object_type 하나에 **정확히 하나** 있어야 한다.

**축 2 — 한 번 호출에 이 object_type 행이 최대 몇 개 나오는가.** 1이면 `detail`, 여럿이면 목록이다. 기계적으로는 **`params`에 이 object_type의 식별자 자리가 있는가**로 갈린다.

```yaml
- role: enrichment
  path: /api/users.list
  params: { team_id: "<workspace>", limit: "200" }   # <workspace> 는 범위다
- role: detail
  path: /api/users.info
  params: { user: "<id>" }                           # <id> 는 이 사용자다
```

둘 다 자리 표시자가 있지만 뜻이 다르다. `<workspace>`는 **어디서 찾을지**고 `<id>`는 **누구를 찾을지**다. 후자가 있으면 `detail`이고, **`primary`가 id 목록을 주기 전에는 부를 수 없다.**

오른쪽 위 칸이 비어 있는 게 우연이 아니다. **단건 조회는 명부를 정할 수 없다.** 누구를 물어볼지 알려면 이미 명부가 있어야 한다.

#### id — 같은 뜻의 URL을 하나로 묶는다

엔드포인트마다 이름을 붙인다.

```yaml
collect:
  endpoints:
    - id: user.roster
      role: primary
      method: GET
      path: /scim/v2/Users
      params: {}
    - id: user.groups
      role: enrichment
      method: GET
      path: /api/v1/users/{userId}/groups
      params: {}
```

**안 적으면 `"METHOD path"`가 id다.** 영구 별칭이므로 기존 Profile은 그대로다.

이름이 필요한 이유는 **경로 문자열이 엔드포인트를 가리키는 안정적인 키가 아니기 때문**이다. 다섯 가지로 깨진다.

| 깨지는 곳 | 무엇이 다른가 |
| --- | --- |
| 페이징 | Okta는 `Link` 헤더의 불투명 URL을 준다. 문서가 **커서 형식이 예고 없이 바뀔 수 있으니 직접 만들지 말라**고 적는다 |
| 자기 참조 별칭 | Microsoft Graph `/me/memberOf`에는 `{id}`가 **아예 없다**. 같은 뜻인데 파라미터가 없다 |
| 판 | `/v1.0/groups/{id}/members`와 `/beta/...`가 같은 뜻이다 |
| RPC | Slack은 경로가 아니라 `conversations.list` 같은 메서드 이름이다 |
| GraphQL | 경로가 `POST /graphql` 하나뿐이다 |

id는 Profile 저자가 붙이므로 이 다섯을 전부 흡수한다. 물리 URL이 여럿이어도 뜻이 같으면 한 id다.

**질의 파라미터가 뜻을 바꾸는 경우는 id가 따로 생긴다.** `params`가 필수라서 파라미터가 다르면 엔드포인트 항목이 다르고, 항목이 다르면 id가 다르다.

```yaml
    - id: repo.collaborators.direct
      path: /repos/{owner}/{repo}/collaborators
      params: { affiliation: direct }
    - id: repo.collaborators.outside
      path: /repos/{owner}/{repo}/collaborators
      params: { affiliation: outside }
```

GitHub 문서가 `outside`를 "조직 소유 저장소의 외부 협업자 전원", `direct`를 "조직 멤버십과 무관하게 권한을 가진 협업자 전원"으로 갈라 놓는다. 기본값 `all`은 둘을 섞는다. 경로는 하나인데 뜻이 셋이다.

Google Cloud Identity `groups.memberships.list`의 `includeDerivedMembership`도 같다. 켜면 하위 그룹의 구성원까지 펼쳐서, 같은 `member_of`가 직접 멤버십에서 전이 멤버십으로 바뀐다.

#### fanout — 로스터를 부르는 데 필요한 부모 값

`enumerable: parent_fanout`은 "부모마다 따로 불러야 한다"까지만 말한다. **무엇을 순회하는지 적는 자리가 없었다.**

```yaml
collect:
  enumerable: parent_fanout
  endpoints:
    - id: asp.roster
      role: primary
      method: GET
      path: /admin/directory/v1/users/{userKey}/asps
      params: {}
      fanout:
        - param: userKey
          from: { object_type: user, identifier: id }
```

여러 단이면 목록이 길어진다.

```yaml
      path: /repos/{owner}/{repo}/branches/{branch}/protection
      fanout:
        - { param: owner,  from: { object_type: org,        identifier: login } }
        - { param: repo,   from: { object_type: repository, identifier: name, scoped_by: owner } }
        - { param: branch, from: { object_type: branch,     identifier: name, scoped_by: repo } }
```

**`scoped_by`가 필요한 이유** — 저장소 이름은 조직 안에서만 유일하다. 전역 목록을 돌리면 안 되고 부모마다 자식을 돌려야 한다.

**`identifier`를 fanout 항목마다 적는 이유가 있다.** 같은 object_type이라도 엔드포인트마다 받는 형태가 다르다. Google 문서가 직접 적는다 — `userKey`는 기본 이메일, 별칭 이메일, 고유 사용자 ID 중 무엇이어도 된다. Okta도 사용자 식별자를 id, login, login shortname 셋으로 받고 **shortname의 합법성은 다른 사용자와 충돌하느냐에 달려 있다.** 테넌트 상태에 따라 달라지는 값이므로 형식이 고정할 수 없다.

#### fanout 이 경로 파라미터가 아닐 때

두 경우가 더 있다.

**① 상수다.**

```yaml
      fanout:
        - { param: customer, const: my_customer }
```

Google Directory `users.list`의 `customer`는 리터럴 `my_customer`를 받는다. 이건 어떤 객체의 식별자도 아니고 토큰이 정하는 범위다. Microsoft Graph의 `/me`도 같다.

**② 질의로 범위가 걸린다.**

```yaml
      fanout:
        - param: folder_id
          from: { object_type: folder, identifier: id }
          into: { query: q, template: "'{value}' in parents" }
```

Google Drive `files.list`에는 부모 경로 파라미터가 없다. 부모 범위는 `q`에 `'<folderId>' in parents`로 넣는다. `into`가 없으면 Drive 계열을 아예 못 적는다.

#### fanout 으로 수집 순서가 자동으로 정해지지는 않는다

318건의 부모 파라미터 161개를 object 목록에 대 봤다.

```
단일 해석   93   58%
모호        39   24%   후보가 여럿이다
못 찾음     29   18%
```

**58%만 자동이다.** 나머지는 Profile 저자가 짝을 지어야 한다. `fanout`은 그 판단을 적는 자리이지 판단을 대신하는 장치가 아니다.

못 찾은 쪽에서 새 유형이 하나 나왔다. `{+parent}`, `{+name}` 같은 Google의 리소스 이름 문자열, `{sendAsEmail}` 같은 다른 형태의 식별자, 그리고 **자기 id가 아예 없는 객체**다. GitHub Pages와 Branch Protection Rule이 그렇다. 부모당 하나뿐이라 부모와 상수가 곧 키다.

#### partition — 로스터가 쪼개질 때

`role: primary`가 정확히 하나라는 규칙이 Okta에서 깨진다. 역할 배정에 조직 전체 로스터가 없다.

```yaml
collect:
  enumerable: parent_fanout
  endpoints:
    - id: ra.by_user
      role: primary
      path: /api/v1/users/{userId}/roles
      partition: principal=user
      completeness: exhaustive
      partition_verified_on: 2026-09-21
      fanout: [{ param: userId, from: { object_type: user, identifier: id } }]
    - id: ra.by_group
      role: primary
      path: /api/v1/groups/{groupId}/roles
      partition: principal=group
      completeness: exhaustive
      partition_verified_on: 2026-09-21
      fanout: [{ param: groupId, from: { object_type: group, identifier: id } }]
    - id: ra.by_client
      role: primary
      path: /api/v1/oauth2/v1/clients/{clientId}/roles
      partition: principal=client
      completeness: exhaustive
      partition_verified_on: 2026-09-21
      fanout: [{ param: clientId, from: { object_type: app, identifier: id } }]
```

검사 규칙이 이렇게 바뀐다.

```
옛   role: primary 가 정확히 하나
새   partition 없는 primary 는 정확히 하나
     partition 있는 primary 는 여럿 가능하되 값이 서로 달라야 한다
```

**기존 Profile에는 `partition`이 없으므로 옛 규칙 그대로다.**

#### partition 이 위험한 이유 두 가지

**① 조용히 낡는다.**

partition 목록은 정적 선언이다. 벤더가 네 번째 주체 유형을 추가하면 **선언한 셋은 계속 200을 주고, 새 것은 영영 안 불리고, 오류가 안 난다.** 로스터는 멀쩡해 보이고 동기화 시각도 정상인데 특권 주체 한 부류가 통째로 빠진다.

`enumerable: full`이면 그 엔드포인트가 깨질 때 오류라도 난다. partition은 안 난다.

탐지할 방법이 없으므로 **눈에 띄게만 만든다.**

```
completeness              exhaustive | best_effort | unknown
partition_verified_on     마지막으로 벤더 문서를 확인한 날
```

`partition_verified_on`이 6개월보다 오래되면 lint 경고다.

`completeness: best_effort`는 벤더가 조각을 다 안 주는 경우다. GitHub 협업자 조회가 그렇다 — 문서가 **"이 엔드포인트 응답으로는 조직 수준 부여와 저장소 수준 부여를 구분할 방법이 없다"**고 적는다. 여기에 `partition: source=team` 같은 걸 쓰면 **벤더 API가 채울 수 없는 구분을 지어내는 것**이 된다. 그런 경우는 partition을 만들지 않고 `Relation_Schema_v3.md`의 `decomposable: false`로 간다.

**② partition은 신원이 아니다.**

Okta에서 역할 부여를 직접 부여에서 그룹 경유로 바꾸면, 행이 `partition=user`에서 사라지고 `partition=group`에 나타난다. 권한은 그대로인데 **"없어졌으니 회수됐다"가 거짓이 된다.**

> **삭제 판정은 `(object_type, primary)` 기준이다. `partition`은 보지 않는다.**

**Entra PIM의 자격/활성은 partition이 아니다.** `roleEligibilityScheduleInstances`와 `roleAssignmentScheduleInstances`는 서로 다른 모집단이 아니라 **같은 부여의 두 상태**다. 같은 주체·역할 쌍이 양쪽에 동시에 있을 수 있다. 그건 `Relation_Schema_v3.md`의 `validity.effect`가 담는다.

#### listable 판정은 primary에만 건다

**`collect.listable`의 효력은 `role: primary`인 엔드포인트에만 미친다.**

"목록에 안 나왔으니 회수됐다"는 판정을 `enrichment`에 걸면 거짓이 된다. Slack 사용자를 세 엔드포인트로 재 봤더니 이렇다.

```
GET  /scim/v2/Users          32명   <- primary
POST /api/users.list         30명   <- enrichment
POST /api/admin.users.list   24명   <- enrichment
셋 다 나온 사람               24명
```

**32명 중 8명이 엔드포인트마다 들쭉날쭉하다.** `enrichment`에 판정을 걸면 그 8명이 회수된 것으로 찍힌다. 실제로는 그 API가 원래 그만큼만 주는 것이다.

반대도 있다. `USLACKBOT`은 SCIM에 없고 Web에만 있다. `primary`가 명부이므로 **SCIM 기준으로 없는 계정**이고, Web에서 얻은 값은 보강으로만 붙는다. 둘을 동급으로 두면 "32명인가 30명인가"에 답이 없다.

`detail`에는 애초에 안 건다. 목록이 아니다.

#### 하나로 못 합치는 이유

"제일 많이 주는 것 하나만 쓰면 되지 않나" — 안 된다. **주는 필드가 다르다.**

```
SCIM              meta.created 있음,  tz 없음,  enterprise_user.teams 없음
users.list        meta.created 없음,  tz 있음,  enterprise_user.teams 있음
admin.users.list  roles[] 있음
```

SCIM만 쓰면 소속이 통째로 사라지고, `users.list`만 쓰면 SCIM에만 있는 3명이 사라진다.

**`params`가 필수다.** 응답의 모양이 파라미터에 따라 달라지기 때문이다.

| provider | 파라미터 | 무엇이 달라지나 |
| --- | --- | --- |
| Okta | `expand` | `_embedded`가 있고 없고 |
| Datadog | `include` | `included`가 있고 없고 |
| ServiceNow | `sysparm_display_value` | 참조 필드의 모양 자체가 바뀐다 |
| GitHub | 없음 | 대신 목록과 단건의 필드 집합이 다르다 |

ServiceNow는 특히 위험하다. `sysparm_display_value=true`로 부르면 **sys_id 자리에 사람이 읽는 문자열이 들어온다.** 에러도 안 나고 조용히 바뀐다. `false`나 `all`로 고정하고 그 값을 여기 적는다.

같은 대상을 여러 경로로 수집하면 **어느 경로가 어느 식별자를 주는지도 달라진다.** Snowflake `SHOW USERS`에는 id 컬럼이 없고 `ACCOUNT_USAGE.USERS`에만 `USER_ID`가 있다. Google Workspace 그룹 멤버십은 Directory API에서는 복합 키뿐이고 Cloud Identity API에서는 자체 id가 있다. 그래서 `identifiers`의 각 키가 어느 엔드포인트에서 오는지를 이 목록과 맞춰 둬야 한다.

### envelope

응답에서 레코드를 꺼내는 방법.

| 값 | 의미 | 예 |
| --- | --- | --- |
| none | 레코드가 맨 위에 있다 | GitHub, Okta |
| jsonapi | `data.attributes`가 속성, `data.id`가 식별자, `data.type`이 object_type, `data.relationships`가 참조 | Terraform, Datadog |
| result | `{"result": [...]}` | ServiceNow |
| records | `{"records": [...]}` + 레코드마다 `attributes: {type, url}` | Salesforce |
| resultset | 타입 있는 컬럼의 행 | Snowflake |

Google Workspace는 래퍼가 없지만 `kind`와 `etag`가 진짜 필드와 같은 깊이에 섞여 있다. 그런 필드는 `properties.drop`에 적는다.

### enumerable

`listable`을 대신한다. **불리언으로는 부족하다는 것이 다섯 provider에서 확인됐다.**

| 값 | 뜻 | 예 |
| --- | --- | --- |
| `full` | 파라미터 없이 전수가 나온다 | Slack `users.list` |
| `required_params` | 필수 파라미터를 순회해야 전수다 | Okta `GET /api/v1/policies` — `type`이 required이고 enum 13종 |
| `parent_fanout` | 부모마다 따로 불러야 한다 | Okta `/apps/{appId}/users`, GitHub deploy key |
| `caller_dependent` | 부르는 주체에 따라 결과가 다르다 | Okta `Everyone` 그룹이 group admin에게는 안 보인다 |
| `none` | 목록 API가 없다 | Okta Session, Google 도메인 전체 위임 |

`required_params`면 무엇을 어떤 값으로 순회하는지 적는다.

```yaml
enumerable: required_params
enumerate_by:
  param: type
  values: [OKTA_SIGN_ON, PASSWORD, MFA_ENROLL, ACCESS_POLICY]
```

#### listable은 별칭으로 영구히 남는다

```
listable: true    ==  enumerable: full
listable: false   ==  enumerable: none
```

**기존 Profile을 고치지 않는다.** 규칙 2 그대로다. 새로 쓰는 Profile은 `enumerable`을 쓴다.

**삭제 판정은 `enumerable: full`일 때만 허용한다.** 나머지 넷은 "안 나왔다"가 "없어졌다"를 뜻하지 않는다.

### listable

목록 조회가 가능한지.

**수집 결과가 0건인 것과 애초에 물어볼 수 없는 것은 다르다.** 구분하지 않으면 "자격증명이 없는 통합" 같은 질의가 조용히 거짓을 답한다.

| 대상 | 상태 |
| --- | --- |
| Okta API 토큰 | 생성 엔드포인트가 없다. 콘솔에서만 만든다. 조회와 폐기는 API로 된다 |
| GWS 도메인 전체 위임 | 목록 API가 없다. 변경 이벤트만 감사 로그에 남는다 |
| Terraform 조직 토큰 | 조회 엔드포인트가 아예 없다. 만들면 기존 게 대체된다 |
| Terraform 사용자 토큰 | 조직 전체 열거가 안 된다. 자기 것만 보인다 |
| Salesforce consumer secret | 어떤 API로도 못 읽는다. Setup 화면에서 본인 확인을 거쳐야 한다 |

GWS에는 함정이 하나 있다. `directory.tokens.list`가 이름만 보면 맞아 보이는데, 문서에 "사용자가 서드파티 앱에 발급한 토큰"이라고 쓰여 있다. 사용자별 OAuth 동의지 도메인 전체 위임이 아니다.

#### 열거가 되는데도 안 나오는 경우

`listable: true`라고 끝이 아니다. 목록 API가 멀쩡히 있는데 **벤더가 기본 질의에서 일부를 걸러내는** 경우가 있다.

Salesforce가 그렇다. `PermissionSetAssignment`의 만료된 행은 소프트 삭제로 취급되어 평범한 SOQL에 나오지 않는다. 보려면 `ALL ROWS`를 붙여야 하고, 벤더 문서의 예시 자체가 `WHERE IsRevoked=true ALL ROWS`다.

그냥 돌리면 **만료된 권한 부여가 "삭제됨"으로 기록된다.** `Object_Schema_v4.1.md`에는 "목록 조회가 되는데 이번 수집에 안 나왔으면 없어진 것"이라는 규칙이 있는데, 여기서는 그 규칙이 틀린 답을 낸다.

막는 방법은 이미 있다. `collect.endpoints[].params`가 필수라는 규칙이다. `ALL ROWS`를 거기 적어 두면 다음 사람이 같은 함정에 빠지지 않는다. 적지 않으면 아무도 모른다.

#### 같은 대상이 API 표면마다 다르게 보인다

목록이 비었다고 없는 게 아니라, **다른 API로 물으면 나오는** 경우가 있다.

| 대상 | 안 보이는 곳 | 보이는 곳 |
| --- | --- | --- |
| Slack 사용자 그룹 | Web API `usergroups.list`가 `ok=true`에 0건 | SCIM `Groups`에 멤버까지 다 나온다 |
| GWS 그룹 멤버십 만료 | Directory API `members`에 만료 필드가 아예 없다 | Cloud Identity `groups.memberships`의 `roles[].expiryDetail.expireTime` |

Slack 쪽이 특히 위험하다. **에러가 아니라 빈 목록이라서** 수집기가 성공으로 기록한다.

그래서 `listable`은 object_type의 성질이 아니라 **어느 API로 물었느냐의 성질**이다. Profile이 `collect.endpoints[]`에서 올바른 경로를 고르는 것으로 해결한다. 못 보는 경로는 목록에 넣지 않는다. 왜 뺐는지는 `open_issues`에 남긴다.

### completeness

목록이 되더라도 **벤더가 일부를 저장하지 않는 경우**가 있다.

| 값 | 의미 |
| --- | --- |
| full | 열거하면 다 나온다 |
| provider_partial | 벤더가 일부를 저장하지 않는다 |
| not_collectable | 식별자를 만들 수 없어 수집하지 않는다 |

Salesforce 공유가 `provider_partial`의 예다. 문서에 "sharing set 같은 일부 공유 메커니즘은 공유 항목이 **아예 저장되지 않는다**"고 적혀 있고, 여러 RowCause 값은 "가장 높은 접근 수준 하나로 압축된다". 그리고 벤더가 직접 "이 공유 항목의 존재에 의존하는 커스터마이징을 만들지 마라"고 권고한다. 우리가 수집을 못 하는 게 아니라 **권한은 실재하는데 행이 어디에도 없다.**

`not_collectable`의 예는 Okta `appLinks`다. `id` 필드가 그 사용자의 id라 모든 행에 똑같이 들어 있고, 공식 예시에서 서로 다른 두 앱 링크가 `appInstanceId`와 `appAssignmentId`를 둘 다 공유한다. 어떤 조합으로도 유일해지지 않는다.

---

## identifiers

각 식별자가 응답 어느 경로에 있는지, 무엇이 primary인지, 얼마나 안정적인지.

```yaml
identifiers:
  primary: [id]                    # 목록. 대부분 길이 1
  id:
    path: id
    stability: undocumented
    endpoint: primary              # 이 키를 주는 collect.endpoints[].role
  node_id:
    path: node_id
    stability: unstable
```

복합 키는 원소를 다 적는다.

```yaml
# Snowflake grant
primary: [privilege, granted_on, name, grantee_name]

# Okta 리소스셋 바인딩
primary: [resource_set_id, role_id]
```

`stability` 값은 `stable` / `mutable` / `unstable` / `undocumented`다. **`readOnly`를 `stable`의 근거로 쓰지 않는다.** 판정 기준은 `Object_Schema_v4.1.md`에 있다.

`normalization`은 같은 값이 형태만 다르게 오는 경우에만 쓴다. Salesforce는 `[to_18_char]`, 이메일은 `[lowercase, trim]`.

---

### primary는 복합키일 수 있고, 요청에서 올 수도 있다

grant 성격의 객체는 **자기 id가 없는 경우가 흔하다.** 다섯 provider에서 전부 나왔다.

| provider | 객체 | 키 |
| --- | --- | --- |
| Slack | role_assignment | `(role_id, entity_id, user_id)` |
| Okta | AppUser | `(app_id, user_id)` — `id`는 "Okta **user**의 식별자"다 |
| Okta | 커스텀 롤 바인딩 | `(principal, resource_set, custom_role)` 3중 |
| GitHub | org membership, repo collaborator 권한 | `(부모, 주체)` |
| Google | Drive permission | `(fileId, permissionId)` — `permissionId`는 **받는 쪽의 전역 id**다 |
| Snowflake | grant | `(privilege, granted_on, name, granted_to, grantee_name)` |

**키의 한 성분이 응답 본문이 아니라 요청에서 올 수 있다.**

```yaml
identifiers:
  primary: [app_id, user_id]
  app_id: { from: $request.appId }      # 경로 파라미터
  user_id: { path: id }                 # 본문
```

`primary`의 모든 성분은 `identifiers`에 실재해야 한다. `from`이든 `path`든 상관없다.

### 부모와 상수가 곧 키인 객체

자기 id가 아예 없고 부모당 하나뿐인 객체가 있다. GitHub Pages와 Branch Protection Rule이 그렇다.

```yaml
identifiers:
  primary: [repo, _kind]
  repo:  { from: $request.repo }
  _kind: { const: pages }
```

`const`는 응답에도 요청에도 없는 고정값이다. **이게 없으면 부모가 같은 여러 싱글턴이 한 노드로 합쳐진다.**

### primary를 후보 여럿에서 고르는 기준

318건 중 식별자 후보가 둘 이상인 것이 **174건**이다. 후보 이름을 세면 이렇다.

```
id 119   name 109   node_id 23   email 7   externalId 6   slug 4   login 2
```

**`name`이 109번 나온다.** 목록의 "식별자 필드"는 키가 아니라 "식별자처럼 생긴 필드"다. 고르는 일이 아니라 **거르는** 일이 대부분이다.

등급은 여섯이다.

| 등급 | 무엇 | 자동인가 |
| --- | --- | --- |
| A | 고유 `id` | **자동** |
| B | 접미사 id — `user_id`, `codeId`, `sha`, `number` | 사람 확인 |
| C | 표면 한정 id — `node_id` | 사람 확인 |
| D | 변경 가능한 이름 — `name`, `slug`, `login` | 사람 확인 |
| E | 연락처 — `email`, `phoneNumber` | 사람 확인 |
| F | 외부 발급 — `externalId`, `issuer` | 사람 확인 |

318건에 대 보면 **A가 62%, 나머지가 38%**다.

**B를 자동에 넣지 않는 이유가 Okta `AppUser`다.** 필드 이름이 `id`인데 값은 Okta **user**의 식별자다. 이름만 보고 고르면 다른 객체의 키를 이 객체의 키로 쓰게 되고, 그러면 노드가 잘못 합쳐진다. 그 오류는 수집 시점에 아무 신호도 안 낸다.

**C를 따로 둔 이유** — GitHub `node_id`는 GraphQL 표면에서만 유효하고 REST 정수 `id`와 별개다. 같은 객체가 표면마다 다른 키를 갖는다.

**F가 최하위인 이유** — SCIM RFC 7643이 `externalId`를 클라이언트가 붙이는 값으로 정의하고 **서버가 유일성을 강제하지 않는다.** Slack 실측에서 32명 전원이 비어 있었다.

## references

어느 경로가 다른 Object를 가리키는지.

```yaml
references:
  tenant:
    from: $request.org             # 응답에 없고 요청 스코프에서 온다
    object_type: Org
    kind: direct_id
    status: confirmed
  parent:
    from: $path.appId              # 요청 경로에서 온다
    object_type: Application
    kind: direct_id
    status: confirmed
  assign_to_groups:
    path: actions.assignUserToGroups.groupIds
    object_type: Group
    kind: direct_id                # 배열이면 target이 여러 개가 된다
  target:
    path: entity_id
    object_type: "@resolve"        # 행마다 다르다
    resolve: { by: id_prefix }
    kind: direct_id
  principal:
    from: $link.self               # 링크 URL에서 뽑는다
    parse: /api/v1/{type}/{id}
    kind: direct_id
  webhook_url:
    path: channel.config.uri
    object_type: null
    kind: external_locator
```

### relation_type과 reverse

이 참조가 어떤 관계가 되는지도 여기 적는다. 항목 이름은 provider 응답의 뜻을 담은 이름이고, 어휘로 옮기는 일은 Profile이 한다.

```yaml
references:
  groups:
    path: groups
    object_type: Group
    kind: direct_id
    status: confirmed
    relation_type: member_of

  members:
    path: members
    object_type: User
    kind: direct_id
    status: confirmed
    relation_type: member_of
    reverse: true

  condition_people_include:
    path: conditions.people.users.include
    object_type: User
    kind: direct_id
    status: confirmed
    relation_type: applies_to
    reverse: true                  # 정책 → 사람. 이 Object가 정책이면 정방향

  condition_people_exclude:
    path: conditions.people.users.exclude
    object_type: User
    kind: direct_id
    status: confirmed
    relation_type: excludes
    reverse: true

  condition_all:
    path: conditions.people.users.include
    object_type: null
    kind: expression               # "All" 같은 와일드카드. 관계를 만들지 않는다
    status: unresolved
```

**모든 참조 항목이 `kind`와 `status`를 적어야 한다.** Object 행의 `references`에 이 둘이 필수인데, 값을 공급하는 곳이 Profile뿐이다. 여기 없으면 Object가 만들어질 수 없다.

| 필드 | 의미 |
| --- | --- |
| `relation_type` | 이 참조가 만드는 관계. 값이 셋으로 갈린다. 아래 참조 |
| `reverse` | `true`면 이 Object가 target이 되고 참조 대상이 source가 된다 |
| `provider` | 다른 SaaS를 가리킬 때만. 생략하면 이 Profile의 provider다 |
| `basis` | 이 관계의 근거가 어떤 종류인지. `stated`, `computed`, `flag` 중 하나. **생략할 수 없다** |
| `binding` | `applies_to`와 `excludes`에만. 명시적으로 지정됐으면 `explicit`, 범위로 걸리면 `ambient` |
| `policy` | 3항 관계의 역할 자리. `properties.as_relation`과 같은 표기를 쓴다 |

**Object에 `relation_type`을 박지 않는 이유**는 시점이 다르기 때문이다. Object 행은 수집할 때 만들어져 저장되고, 어휘는 우리가 설계하는 것이라 계속 바뀐다. 참조 키에 어휘를 박으면 어휘를 고칠 때마다 저장된 Object 행을 전부 고쳐야 한다. Profile은 설정이라 고쳐도 마이그레이션이 없다.

`reverse`는 Profile마다 따로 판단한다. 같은 관계라도 어느 object_type에서 수집하느냐에 따라 방향이 달라진다. 위 예시의 `groups`와 `members`가 같은 사실이고 방향만 반대다.

### when — 이 참조가 어느 관측에서만 유효한가

v3까지 수집기는 object_type당 `references` 한 벌을 **모든 관측에 전부 적용**했다. 엔드포인트별 구분이 없었다.

Okta에서 이게 깨진다.

```
/api/v1/users/{userId}/groups                        이 사용자가 속한 그룹
/api/v1/users/{userId}/roles/{raId}/targets/groups   이 역할 배정이 미치는 그룹
```

둘 다 Group 레코드를 주고 둘 다 요청에 `userId`가 있다. **같은 `from: $request.userId` 참조가 양쪽에서 발화한다.** 뜻이 전혀 다른데 구분할 방법이 없다.

```yaml
references:
  member_of_user:
    from: $request.userId
    object_type: user
    kind: direct_id
    status: confirmed
    when: { endpoint: [user.groups] }
    relation_type: member_of
    reverse: true
    basis: stated

  role_scope_of_user:
    from: $request.userId
    object_type: user
    kind: direct_id
    status: confirmed
    when: { endpoint: [role.targets.groups] }
    relation_type: has_role_on
    reverse: true
    basis: stated
```

**`when`을 생략하면 전 관측에 적용된다.** v3 동작 그대로다.

`endpoint` 값은 `collect.endpoints[].id`다. 경로 문자열이 아니다. 그 이유는 `collect` 장의 `id` 항목에 있다.

#### 응답 값이 판별자일 때

요청이 아니라 **응답 필드**가 뜻을 정하는 경우가 있다.

```yaml
references:
  group_owner:
    path: id
    object_type: user
    kind: direct_id
    status: confirmed
    when:
      endpoint: [group.members]
      field: { path: role, in: [OWNER] }
    relation_type: has_role_on
    reverse: true
    policy: { const: owner, kind: name_key }
    basis: stated
```

Google Directory `Members.list`가 그렇다. 응답의 `role`이 `OWNER` / `MANAGER` / `MEMBER`로 갈리고, 요청은 하나다. 어느 관계인지는 레코드를 읽어야만 안다.

`field.in`의 값 중 하나와 맞으면 발화하고, 아니면 이 참조는 그 레코드에 안 붙는다.

**`properties.as_relation`과 다르다.** 저쪽은 불리언 속성에서 관계를 유도하고 `basis`가 `flag`로 고정이다. 이쪽은 참조 자체를 값으로 거르는 것이고 `basis`를 명시한다.

### 다른 provider를 가리키는 참조

참조가 **다른 SaaS의 객체를 가리키는 경우**가 있다. 그때만 `provider`를 적는다. 생략하면 이 Profile의 `provider`다.

```yaml
references:
  source_app:
    path: external_source_app_id
    provider: "@resolve"        # 값만으로는 어느 SaaS인지 모른다
    object_type: application
    kind: direct_id
    status: confirmed
    relation_type: owned_by
    basis: stated
```

**관측한 쪽 Profile에 적는다.** Okta 그룹이 다른 앱에서 동기화됐다는 사실은 Okta 응답이 알려준 것이므로 Okta Profile에 적는다. 반대쪽 provider는 이 사실을 모를 수 있고, 몰라도 된다.

`provider`도 `object_type`처럼 `"@resolve"`를 쓸 수 있다. 값 모양이나 별도 필드로 푸는 것이라 3단계가 처리하고, 못 풀면 `status: unresolved` + `unresolved_reason: unknown_prefix`다. **관계는 그대로 만든다** — 포인터가 있다는 사실이 참이기 때문이다.

**양끝 어느 응답에도 안 나오는 연결은 여기 적지 않는다.** "이 Slack 봇과 저 GitHub App이 같은 앱이다" 같은 판정은 우리가 내리는 것이라 `judged{}` 영역이고, 근거 규칙이 정해지기 전에는 만들지 않는다.

### basis는 생략할 수 없다

같은 `relation_type`이라도 근거의 종류가 다르다. 필드 모양이 같아서 Object 행만 보면 구분되지 않는다. 그래서 Profile이 선언한다.

| 값 | 뜻 |
| --- | --- |
| `stated` | 벤더가 부여 기록을 그대로 준다 |
| `computed` | 여러 경로를 합쳐 낸 결과이고 그 경로가 응답에 없다 |
| `flag` | 속성 불리언에서 유도했다 |

**`computed` 행은 직접 회수할 수 없다.** "이 권한을 없애려면 무엇을 지워야 하나"를 물으면 `stated` 행에는 답이 있고 `computed` 행에는 없다.

**기본값이 없다.** 예전에는 "안 적으면 `stated`"였는데, 합칠 때 `stated`가 이기므로 **빠뜨린 행이 자동으로 최우선이 되어** 근거 없이 회수 가능한 기록이 있다고 주장하게 됐다. 지금은 빠지면 lint 오류다.

`properties.as_relation`에서 나온 관계는 `flag`로 고정이다. 불리언에서 유도했다는 사실이 표기 자체로 정해진다. 그것 말고는 전부 명시한다.

합칠 때는 `stated > computed > flag` 순으로 이긴다. 덮어쓰기가 아니라 우선순위다. 자세한 근거는 `Relation_Schema_v3.md`에 있다.

### basis_when — 같은 사실이 요청에 따라 근거가 달라질 때

Okta에서 확인된 것이다. 같은 그룹 멤버십이 이렇게 갈린다.

```
GET /groups/{id}/users                      규칙 유래인지 알 수 없다
GET /groups/{id}/users?expand=group-rules   _embedded 에 그 규칙이 온다
```

**`basis`가 참조의 고정 속성이 아니다.** 어떻게 물었느냐에 따라 `stated`도 되고 `computed`도 된다. Google `includeDerivedMembership`도 같은 모양이다.

`basis`를 옮기지 않는다. **덮어쓰기를 더한다.**

```yaml
references:
  group_members:
    path: ...
    object_type: user
    relation_type: member_of
    basis: stated                    # 기본. 아무 조건에도 안 걸리면 이 값
    basis_when:                      # 선택. 관측이 조건에 걸리면 덮어쓴다
      - { if: { expand: group-rules }, then: computed }
```

`if`의 키는 그 관측의 **요청 판별자**와 맞춰 본다. 파라미터, 헤더, 가장한 주체 전부 여기 들어간다.

**`basis_when`이 없는 Profile은 아무것도 안 바뀐다.** Slack Profile 13곳의 `basis`가 그대로 유효하다. 규칙 1 그대로다.

### membership_enforced — 그룹이 받은 부여가 소속을 따라가나

2026-10-29에 더했다. `Effective_Access_Schema_v1` 「집행되는 경로와 권한이 생긴 이력은 다르다」의 결정(표시는 Profile의 참조에 둔다)이다.

그룹에 준 권한은 두 가지다. **그룹에서 빼면 사라지는 것(집행)**과 **넣을 때 한 번 주고 끝나서 빼도 남는 것(이력)**. 둘 다 「그룹 → 자원」 모양이라 행만 보면 구분이 안 된다. 끊어 봐야 안다.

```yaml
# 발췌. v4 표기
provider: okta
object_type: application_group_assignment
interfaces: [Assignment]

assignment:
  relation_type: has_role_on
  basis: stated
  membership_enforced: true   # 2026-09-27 EA 검증 보고서 §7.1. 그룹에서 빼자 15초 안에 그 사람의 앱 배정이 404, 다시 넣자 복귀

references:
  group: { path: id, object_type: group, kind: direct_id, status: confirmed, slot: source }
  app:   { from: $path.appId, object_type: application, kind: direct_id, status: confirmed, slot: target }
```

| 판 | 적는 곳 |
| --- | --- |
| v4, 참조에서 관계가 나올 때 | 그 참조 항목의 `relation_type`, `basis` 옆 |
| v4, Assignment인 object_type | 위처럼 `assignment:` 아래 `relation_type`, `basis` 옆 |
| 카탈로그 `spec: 5`와 엔진 Profile | 관계를 `relations` 목록에 적으므로 그 항목의 `basis` 옆 |

| 값 | 뜻 | Effective Access에서 |
| --- | --- | --- |
| `true` | 집행. 그룹에서 빼면 그 사람에게서 이 부여가 사라진다. **끊어 보고 확인한 것만** 적는다 | 소속 홉이 회수 지점(`cut`)이 된다 |
| `false` | 이력. 빼도 남는다 | 소속 홉은 회수 지점이 아니다. 사유는 지금 모름과 같이 `enforcement_unknown`으로 남는다. 이력의 사유를 따로 둘지는 미결이다(지금 `false`인 부여가 없다) |
| 생략 | **모름.** 이 뜻은 영구히 고정이다(규칙 1) | 소속 홉은 회수 지점이 아니다. 못 푼 구간 `enforcement_unknown`으로 간다 |

**부여 관계에만 적는다.** 묻는 것이 「그룹에 속했나」가 아니라 「그 그룹이 받은 부여가 소속을 따라가나」라서다. 같은 Okta 그룹이 앱 배정(집행)과 관리자 역할(모름)을 같이 받으므로, 그룹 쪽 Profile에 값 하나로는 못 적는다. 적는 곳은 출발이 그룹일 수 있는 부여 관계다. 소속 관계(`member_of`)에 적으면 오류로 본다(검사기는 아직 없다).

**값은 Profile이 정하고 관계 행은 사본을 가진다.** 정규화는 이 값을 관계 행 `properties.membership_enforced`로 옮긴다(`basis`가 관계 행 `properties.basis`로 들어가듯). 접근 규칙은 부여 홉의 그 속성을 읽는다(`Path_Rule_Schema_v1` 「조건식의 자리」). 판정을 고치면 Profile만 고치고 다시 정규화한다. `Interface_Spec_v3`의 판별선(「두 행에서 값이 달라질 수 있으면 행, 아니면 Profile」) 그대로다. **엔진 정규화가 이 값을 옮기는 일은 아직 없다**(aegi-adapter-engine 후속). 그 전까지 규칙 파일 실행기는 모든 부여를 모름으로 읽는다(운영 EA의 `x_member_grant`는 손코드 결과라 코드 안 표로 소속 홉을 끊는다).

**`true`, `false`에는 근거와 일자를 주석으로 단다.** 아래 `no_relation`과 같은 이유다. 영구 선언을 근거 없이 두면 반증도 감사도 안 된다.

키가 있을 때만 걸리는 검사라 `spec` 게이트가 필요 없다(규칙 1). 안 적은 Profile은 전부 모름이므로 지금 있는 Profile은 하나도 안 바뀐다.

적을 값은 아래와 같다. 엔진 Profile에 실제로 적는 일은 후속이다.

| 부여 | 값 | 근거 |
| --- | --- | --- |
| Okta 앱 그룹 배정 (그룹 → 앱) | `true` | EA 검증 보고서 §7.1. 그룹 둘로 배정하면 하나를 빼도 다른 그룹 경로로 남는다(§7.7). 경로마다는 집행이다 |
| GitHub 팀 → 저장소 | 생략 | 끊어 본 기록이 없다. lab 조직은 멤버 전원이 owner라 팀을 끊어 봐도 차이를 볼 수 없다(§5.1, §5.3) |
| Okta 그룹 → 관리자 역할, GitHub 팀 → 조직 역할 | 생략 | 끊어 본 기록이 없다 |
| Slack 사용자 그룹의 기본 채널(`prefs.channels`) | 해당 없음 | 이력이지만 관계로 만들지 않는다(`Slack_Profiles_v3` 「`prefs.channels` 는 접근 관계가 아니다」) |
| Slack IdP 그룹 → 접근 제한 비공개 채널 | 해당 없음 | 끊어 보고 집행을 확인했다(§7.5). 그런데 관계가 아니다(`relation_type: null`, `Slack_Profiles_v3` 「접근 제한」). 담을 관계가 생기면 `true` 후보다 |

Relation 속성 `lifecycle`(revocable, immutable, inherited)과 다르다. 저쪽은 「그 행 자체를 지울 수 있나」이고, 이쪽은 「그룹에서 빼면 그 그룹의 부여가 그 사람에게서 사라지나」다.

### relation_type의 세 가지 상태

관계가 안 되는 이유가 하나가 아니다. 셋을 구분한다.

| 표기 | 뜻 | 나중에 바뀌나 |
| --- | --- | --- |
| 아예 없음 | 아직 안 봤다 | 봐야 한다 |
| `null` | 봤는데 어휘에 자리가 없다 | 어휘가 늘면 풀린다 |
| `no_relation` | 봤고 관계가 아니라고 판정했다 | **안 바뀐다.** 다시 볼 필요 없다 |

`unresolved_reason`을 나눈 것과 같은 이유다. **재검토할 것과 끝난 것을 가른다.** 셋을 안 나누면 미결 목록이 영영 안 줄어든다.

`no_relation`의 예가 Slack 채널의 `creator`다. 만든 사람을 기록할 뿐이고 그 사람이 채널에 대해 할 수 있는 일이 따로 없다. `Relation_Schema_v3.md`의 `owned_by` 판정 기준으로 걸러진 것이라, 어휘가 늘어도 이 판정은 안 바뀐다.

`no_relation`은 Profile에만 있는 값이다. Relation 행에는 절대 나타나지 않는다.

**`no_relation`을 적을 때는 판정 근거와 일자를 주석으로 같이 적는다.** 판정 기준이 provider 성질이 아니라 테넌트 설정에 달린 경우가 있어서, 영구 선언을 근거 없이 두면 반증도 감사도 안 된다.

```yaml
  creator:
    path: creator
    object_type: user
    kind: direct_id
    status: confirmed
    relation_type: no_relation   # 2026-09-20. owned_by 판정 기준 미통과: 생성자에게 따로 붙는 권한이 없다
```

### 3항 관계의 역할 자리

`relation_type`이 3항이면 역할 자리를 채워야 하는데, **역할 이름이 응답에 없고 필드 이름에만 있는 경우**가 있다. 그때 `policy`를 상수로 적는다.

```yaml
references:
  primary_owner:
    path: primary_owner.user_id
    object_type: user
    kind: direct_id
    status: confirmed
    relation_type: has_role_on
    reverse: true
    policy: { const: primary_owner, kind: name_key }
```

`properties.as_relation`이 쓰는 표기와 같다. 불리언에서 나오든 참조에서 나오든 역할 자리를 채우는 문제는 같아서 표기를 따로 만들지 않았다.

`policy`는 `relation_type`이 3항일 때만 쓴다. 2항 관계에 적으면 갈 곳이 없다.

**어휘에서 3항은 `has_role_on` 하나다.** 나머지 16종은 전부 2항이다. 그래서 `policy`가 있으면 곧 `has_role_on`이고, 역할은 언제나 `role` 슬롯에 있고 `target`은 그 역할이 미치는 범위다. 범위가 응답에 없으면 테넌트를 가리킨다.

어휘 17종의 정의와 근거는 `Relation_Schema_v3.md`에 있다. 16종이 부여 층, `contained_in` 하나가 구조 층이다.

### tenant와 parent는 기본이 관계 아님

둘은 관계이기 전에 **식별자의 일부**다. 없으면 값이 무슨 뜻인지 모른다. Okta 앱 키의 `kid`는 앱이 다르면 같은 값이라도 다른 키다.

실용적인 이유가 더 크다. **모든 Object가 `tenant`를 갖는다.** 관계로 만들면 Object 수만큼 행이 늘어나는데 얻는 정보가 없다. `Object.references.tenant`를 보면 이미 답이 나온다.

그래서 `relation_type`을 안 적는 게 기본이다. 관계로도 쓸 이유가 있는 Profile만 명시한다.

#### 그 대가 — 테넌트로 들어가는 간선이 provider마다 갈린다

이 기본값 때문에 **테넌트로 들어가는 간선이 명시 참조를 쓴 Profile에만 생긴다.** 검증에서 Okta 테넌트가 통째로 떠 있는 것이 관측됐다 — 테넌트로 들어가는 간선이 전부 GitHub이고 Okta는 0건이었다. GitHub은 명시 참조로 우회했고, Okta는 객체 대부분이 조직 바로 밑이라 우회로가 없다.

제안된 수정은 이렇다.

> `contained_in`은 **직속 상위 하나**에 걸고, 직속 상위가 없으면 그게 테넌트다.

**받지 않았다. 두 가지가 먼저 정해져야 한다.**

**1. 규칙 1에 정면으로 걸린다.** 위 절이 "`relation_type`을 안 적는다"의 뜻을 「관계 아님」으로 고정해 놨다. 제안은 그 침묵을 「`contained_in` 간선 하나」로 바꾼다. 새 선택 키를 더하는 게 아니라 **침묵의 뜻을 바꾸는 것**이다. `basis`의 기본값과 `parent_fanout` 불변식에 이어 같은 실수의 세 번째가 된다. 받으려면 `spec` 게이트나 Profile 단위 옵트인이 함께 가야 한다.

**2. 회귀 기준선을 깬다.** 저장소의 Profile 20개에 걸어 보면 새로 간선이 생기는 자리가 **14개**다(Okta 7 · Slack 5 · GitHub 1 · GWS 1). 그중 **Slack이 5종**이라 `Slack 8종 -> 127노드 / 190행` 기준선이 그대로일 수 없다. 이 문서가 「이 숫자가 바뀌면 판을 올리지 않는다」고 적으므로, 제안과 기준선 규칙 중 하나를 먼저 정해야 한다.

**그리고 Okta 쪽 증가량은 아직 재현이 안 된다.** "+30간선"은 저장소에 없는 구 워크북에서 나온 값이고, 318건 목록의 Okta `부모 컨텍스트`는 경로 파라미터 이름이라 부모 사슬을 못 만든다(134건 중 이름으로 풀리는 것 21건, 16%). **Okta 부모 컨텍스트 정규화가 이 제안의 선행 작업이다.**

측정은 `validation/check_contained_in.py`가 한다.

### Assignment인 object_type

`interfaces`에 `Assignment`가 있으면 **Object 하나가 관계 하나**다. 참조 항목마다 관계가 생기는 게 아니다.

```yaml
provider: slack
object_type: role_assignment
interfaces: [Assignment]

assignment:
  relation_type: has_role_on

references:
  user_id:   { path: user_id,   object_type: user, kind: direct_id, slot: source }
  role_id:   { path: role_id,   object_type: role, kind: direct_id, slot: role }
  entity_id: { path: entity_id, object_type: "@resolve", resolve: { by: id_prefix }, kind: direct_id, slot: target }
```

`relation_type`은 `assignment` 아래에 한 번 적고, 참조는 `slot`만 말한다. `slot` 값은 `source`, `role`, `target`이다. Relation 행의 참조 키와 같은 이름을 쓴다.

**interface로 자리를 추론하지 않는다.** 지금은 3항 관계가 `has_role_on` 하나뿐이라 추론이 되는 것처럼 보이지만, 양끝이 같은 3항이 하나만 생겨도 못 쓴다. 그리고 다른 매핑은 전부 Profile이 쥐는데 여기만 추론이면 규칙이 둘이 된다.

`slot`이 없는 참조는 이 관계에 안 들어간다. 배정 레코드에 딸린 다른 포인터는 그냥 참조로만 남는다.

**`slot: target`인 참조가 배열이면 관계를 여러 행으로 편다.** 대상 하나마다 한 행이다. 한 행에 대상 목록을 담지 않는다. 동일성 튜플이 `target` 값 하나를 전제하고 있어서, 목록을 담으면 "이 자원에 누가 접근하나"를 물을 때 목록 안을 들여다보는 질의를 따로 써야 하고 대상이 하나 늘 때마다 같은 행이 다른 행이 된다.

배정 레코드의 다른 값(만료, 부여자, 부여 시각)은 펴진 행 전부에 그대로 복사된다. 원본이 하나였다는 사실은 `source`에 남는다.

### 값을 어디서 가져오나

| 표기 | 의미 |
| --- | --- |
| `path:` | 응답 본문의 경로 |
| `from: $request.*` | 요청 스코프. 응답에 안 나오는 테넌트 같은 것 |
| `from: $path.*` | 요청 URL의 경로 파라미터 |
| `from: $link.*` + `parse:` | 링크 URL을 파싱해서 |

마지막 것이 필요한 이유가 있다. Okta 리소스셋 바인딩의 멤버는 자기 id(`irb…`)를 갖는데 그게 사용자 id도 그룹 id도 아니다.

```json
{ "id": "irb1qe6PGuMc7Oh8N0g4",
  "_links": { "self": { "href": ".../api/v1/users/00uuk41Hjga5qGfQ30g3" } } }
```

**누구인지는 URL을 파싱해야만 나온다.** 필드에 없다.

`from: $path.*`도 마찬가지로 빠지면 안 된다. `/api/v1/apps/{appId}/credentials/keys` 응답에는 appId가 없어서, 이게 없으면 부모 소유 자식이 소유자 참조를 못 만든다.

### @resolve

`resolve.by`는 **목록이다.** 접두사는 그중 하나일 뿐이고, 다섯 provider 중 접두사가 통하는 곳은 Slack 하나였다.

| 값 | 무엇으로 푸나 | 그렇게 하는 provider |
| --- | --- | --- |
| `id_prefix` | 값의 접두사 | Slack `U…`/`C…`/`T…` |
| `sibling_field` | 옆에 있는 타입 필드 | Google Drive `type: user\|group\|domain\|anyone`, GitHub `target_type`, Okta `assignmentType` |
| `link_path` | `_links` href의 경로 | Okta `_links.assignee.href` — **타입은 아는데 id 필드가 없다** |
| `orn` | 타입이 박힌 복합 식별자 | Okta `orn:{partition}:{service}:{orgId}:{objectType}:{objectId}` |
| `declared` | Profile이 경로마다 고정 기재 | GitHub 감사 로그의 맨 정수 id |
| `none` | 풀지 않는다 | — |

`sibling_field`와 `link_path`는 추가 정보를 적는다.

```yaml
entity:
  path: assignee.id
  object_type: "@resolve"
  resolve: { by: sibling_field, field: assignmentType }

assignee:
  path: _links.assignee.href
  object_type: "@resolve"
  resolve: { by: link_path, pattern: "/api/v1/{type}/{id}" }
```

**Okta 접두사는 문서화돼 있지 않고 자기 예제 안에서 이미 충돌한다.** `0pr…`이 그룹 규칙과 정책 규칙 양쪽에 쓰이고, 그룹 id 예시가 `00g…`와 `0gabcd1234` 두 모양이다. 그래서 `id_prefix`를 아무 provider에나 쓰면 안 된다.

기존 `resolve: { by: id_prefix }`는 그대로 유효하다. 규칙 2 그대로다.

#### 옛 설명

Profile이 타입을 못 정하는 경우다. Slack `entity_id`는 채널일 수도 엔터프라이즈일 수도 있고, Okta ORN은 타입이 문자열 안에 들어 있다. 수집기가 행마다 판정하고, 실패하면 `object_type: null` + `status: unresolved`로 남긴다.

| resolve.by | 방법 |
| --- | --- |
| id_prefix | 값의 접두사로 판정 |
| urn | 문자열 안의 타입을 파싱 |
| sibling_field | 옆 필드가 타입을 알려줌 |

### 다른 provider를 가리키는 참조는 구역을 나눈다

`references`는 **이 provider 안만** 가리킨다. 다른 provider를 가리키면 구역이 다르다.

```yaml
references:              # 이 provider 안. 여기서 나온 관계는 provider를 못 건넌다
  teams:        { path: enterprise_user.teams, object_type: team }

external_refs:           # 다른 provider. 어디인지 안다
  idp_app:      { path: ..., provider: okta, object_type: app }

external_unknown:        # 다른 provider. 어디인지 모른다
  idp_subject:  { path: externalId, provider: "@resolve", resolve: { by: issuer } }
```

**세 번째 구역이 필요한 이유가 실측에 있다.** SCIM `externalId`의 대상 provider는 선언 시점에 모른다. 어느 IdP가 프로비저닝하느냐에 따라 달라지고 값에도 안 적혀 있다.

이렇게 나누면 검사 규칙 하나가 성립한다.

> **`references`에서 나온 관계가 provider를 건너면 오류다.**

지금은 `provider` 키를 아무 참조에나 붙일 수 있어서, 한 줄 실수로 교차 SaaS 엣지가 조용히 생긴다.

**`external_refs`와 `external_unknown`은 관계를 만들지 않는다.** 신원 추정이라 `Link_Schema_v3.md`로 간다. 예외는 하나다 — `basis: stated`이고 출발점이 Integration, Automation, Credential, Endpoint 중 하나일 때. 그건 벤더가 "이 앱은 저 시스템에 붙어 있다"고 기록해 준 것이라 보통 관계다.

**출발점이 Principal인 교차 provider 관계는 금지다.** 그건 "같은 사람"이고, 추정이다.

### 참조처럼 생긴 속성

벤더가 중첩 속성 모양으로 보내도 다른 객체를 식별하는 값이면 여기 적는다. ServiceNow Table API의 `{"link": …, "value": "<sys_id>"}`가 그렇다. `properties.keep`에 두면 안 된다.

---

## properties

`keep`에 적은 것만 담는다. `drop`은 명시적으로 버릴 것.

```yaml
properties:
  keep: [status, created, activated]
  drop: [_links, _embedded, kind, etag]
  tenant_defined: [profile.*, customSchemas.*, settings.app.*]
```

`keep`에 적은 키는 그 엔드포인트의 응답에 실재해야 한다. 없으면 Profile이 낡았다는 뜻이고, 벤더가 이름을 바꿨을 때 여기서 잡힌다.

### 관계를 담은 불리언

권한 사실이 `references`가 아니라 불리언으로 오는 경우가 있다. 이건 따로 적는다.

```yaml
properties:
  keep: [is_owner, is_admin]

  as_relation:
    is_owner:
      relation_type: has_role_on
      when: true
      policy: { const: owner, kind: name_key }
      target: { ref: tenant }
```

`target: { ref: tenant }`가 핵심이다. **응답이나 요청을 다시 읽지 않고 이미 만들어진 참조를 가리킨다.** Object를 만들 때 이미 `$request`에서 `references.tenant`를 채웠으므로, 여기서 또 읽으면 경로가 둘이 되고 둘이 어긋나면 어느 게 맞는지 모른다.

`as_relation`에 적은 키는 `keep`에도 있어야 한다. 값은 속성으로도 남는다.

**이 장치가 없으면 실제로 누락된다.** Slack `admin.users.list` 24명 중 `is_owner`가 6명인데 같은 응답의 `roles[]`에는 4건뿐이다. 불리언을 버리면 소유자 2명이 사라지고 거기 최상위 소유자가 들어간다.

### per_source

**같은 키인데 관측마다 값이 다른 자리를 미리 적는다.**

```yaml
properties:
  keep: [date_created, tz]
  per_source: [date_created]
```

여기 적은 키는 Object에서 **항상 배열**이 된다.

```yaml
properties:
  tz: Asia/Seoul
  date_created:
    - { value: 1788199948, obs: 0 }
    - { value: 1789021383, obs: 1 }
```

## 왜 미리 적나

수집기가 알아서 "갈리면 배열"로 하면 **같은 키가 데이터에 따라 스칼라도 되고 배열도 된다.** 읽는 쪽이 두 경우를 다 처리해야 하고, 벤더가 어느 날 값을 어긋나게 주기 시작해도 아무도 모른다.

선언해 두면 반대가 된다. **선언 안 한 키에서 값이 갈리면 수집이 멈춘다.** 사람이 보고, 진짜 갈리는 자리면 여기 추가하고, 아니면 Profile의 경로가 틀린 것이다.

`basis`의 기본값을 없앤 것과 같은 판단이다. 빠뜨린 것이 자동으로 어떤 답이 되면 안 된다.

## 무엇을 적나

**측정된 것만 적는다.** 짐작으로 미리 채우면 스칼라여도 될 키가 전부 배열이 되어 읽기만 나빠진다.

Slack 실측에서 125노드 전체를 훑어 갈린 키는 `slack.user`의 `date_created` 하나였다. 그래서 그 Profile에만 있다.

**`per_source`에 적은 키는 `keep`에도 있어야 한다.** 버리는 키의 충돌은 처리할 값 자체가 없다.

### tenant_defined

**키 이름을 고객이 정하는 자리를 표시한다.** 여기서는 키 경로 자체가 데이터라서, 이름으로 keep 목록을 만들 수 없다.

Google Workspace `customSchemas`는 `customSchemas.<스키마이름>.<필드이름>` 꼴이고 둘 다 고객이 정한다. Okta `profile`은 `additionalProperties`로 열려 있고 **접두사 규칙이 없어서** 고객이 만든 `department`와 기본 `department`가 구분되지 않는다. Okta는 더 나아가 `visibility.appLinks.testorgone_customsaml20app_1_link`처럼 키 이름에 앱 인스턴스 이름을 넣기도 한다.

ServiceNow `u_*`와 Salesforce `*__c`도 같은 자리다.

---

## root_tenant

`Object_Schema_v4.1.md`는 모든 Object에 `tenant`가 필수라고 하면서 **최상위 테넌트 자신만 비어 있다**고 예외를 뒀다. 그 예외를 쓰는 Profile이 이 값을 적는다.

| 값 | 뜻 |
| --- | --- |
| `false` | 언제나 루트가 아니다. 생략하면 이것 |
| `true` | 언제나 루트다 |
| `conditional` | 테넌트 참조가 없는 행이 루트다 |

```yaml
interfaces: [Tenant]
root_tenant: true
references: {}
```

### conditional 가 필요한 이유

318건의 Tenant 판정 10건을 전부 보면 이렇다.

```
GitHub   Enterprise      부모 = none/global
GitHub   Organization    부모 = enterprise | none          <- 둘 다 된다
Okta     account-full    부모 = Account
Okta     org             부모 = Account, Group
Okta     org-group       부모 = Account, Group
Okta     OrgSetting      부모 = Org
Slack    enterprise      부모 = root
Slack    workspace       부모 = enterprise or standalone   <- 둘 다 된다
Slack    external-team   부모 = any workspace
GWS      Customer        부모 = CustomerKey
```

**GitHub `Organization`과 Slack `workspace`는 배포에 따라 루트이기도 하고 아니기도 하다.** Enterprise 없는 GitHub 조직에서는 조직이 루트고, standalone Slack 워크스페이스도 마찬가지다.

`true`/`false`는 Profile에 박는 정적 값인데 이 사실은 테넌트마다 달라진다. **standalone 워크스페이스를 수집하면 루트를 선언한 Profile이 하나도 없게 된다.**

`conditional`일 때만 참조 부재로 루트를 추론한다. **"예외는 선언해야 예외다"는 그대로**고, 추론해도 되는 경우를 선언하는 것으로 바뀐다.

v3 본문에 "provider 하나에 보통 하나뿐이다"라고 적었는데 **틀렸다.** Okta는 Tenant가 4건, Slack은 3건이다.

**참조가 비어 있는 것으로 추론하지 않는다.** 아직 참조를 안 쓴 Profile과 구분이 안 되기 때문이다. 예외는 선언해야 예외다.

provider 하나에 보통 하나뿐이다. Slack은 `enterprise`가 그것이다.

---

## judged

interface가 요구하는 값 중 **object_type만으로 정해지는 것**은 여기에 값을 그대로 적는다.

```yaml
judged:
  direction: out                   # GitHub webhook은 언제나 out
  credential_kind: key_pair
  rotation: console
  grant_target: true
```

행마다 갈리는 건 `per_row`로 표시하고 수집기가 판정한다.

### interface 둘이 같은 이름을 요구할 때

한 Object가 interface를 여럿 가질 수 있다. 그때 계약 필드 이름이 겹칠 수 있다.

9개 interface의 계약 필드 11개 중 **겹치는 것은 `expires_at` 하나**다. `Credential`과 `Assignment` 양쪽에 있다.

```
Credential.expires_at   이 자격증명이 언제 무효가 되나
Assignment.expires_at   이 부여가 언제 끝나나
```

가상의 걱정이 아니다. Google Workspace `Token`이 `Credential`과 `Assignment`를 둘 다 가진다. 그 객체에서는 둘이 같은 값이지만, Entra PIM에서는 다르다 — 활성화된 역할은 몇 시간 뒤 끝나도 자격은 남는다.

**겹치면 interface 이름을 접두사로 붙인다.**

```yaml
judged:
  credential.expires_at: { path: ... }
  assignment.expires_at: null          # 부여 자체는 만료가 없다
```

접두사 없는 `expires_at`은 **영구 별칭**이다. interface가 하나뿐이면 그쪽 뜻이다. 규칙 2 그대로다.

응답의 다른 필드를 봐야 정해지는 건 매핑을 적는다.

```yaml
judged:
  blocking:
    by: type
    map:
      com.okta.user.pre-registration:   blocking_fail_closed
      com.okta.import.transform:        blocking_fail_closed
      com.okta.oauth2.tokens.transform: blocking_fail_open
      com.okta.saml.tokens.transform:   blocking_fail_open
```

Okta는 훅 종류만 주고, 실패했을 때 흐름이 멈추는지 그냥 진행하는지는 문서에만 적혀 있다. 그 문서 내용이 여기 들어온다.

---

## redact

이 종류에서만 감춰야 할 필드. 어디서 나오든 항상 감추는 목록은 `Interface_Spec_v3.md`에 있다.

### 감춰야 하는 값이 키일 때

**주소 자체가 인증 수단인 객체가 있다.** Slack 웹훅 트리거가 그렇다. 목록에는 이렇게 적혀 있다.

```
Webhook Trigger Endpoint   Endpoint; Credential   식별자: trigger_id + webhook_url
```

설명이 직접 말한다 — "Webhook 트리거를 호출하는 URL이며 **URL 자체가 인증 수단이다**". 그리고 `hooks.slack.com/services/`를 포함하는 URL은 항상 감추는 목록에 있다.

**키로 써야 하는 값인데 저장하면 안 된다.**

> **`redact` 대상인 필드가 `identifiers.primary`에 있으면 해시가 키다.** 소금 없는 SHA-256을 쓰고, 원문 자리에 해시를 넣고, 필드 경로를 `source.redacted[]`에 남긴다. 그 필드를 가리키는 참조도 같은 해시로 맞춘다.

소금을 쓰지 않는 이유는 **두 번 수집했을 때 같은 값이 나와야** 하기 때문이다. 소금을 쓰면 수집할 때마다 새 노드가 생긴다.

이것이 `redact`의 첫 실제 용도다. Slack Profile 8종에 안 쓰인 것은 그 8종에 웹훅 객체가 없었기 때문이다.

---

## confidence · open_issues

`confirmed`는 공식 문서나 실제 응답으로 확인한 것, `inferred`는 추론이다. 실제 응답을 한 번도 못 본 Profile은 `inferred`로 둔다. 엔드포인트 이름만 보고 쓴 것도 마찬가지다.

확인하지 못한 것은 `open_issues`에 남긴다. 비워 두지 않는다.

**v4부터 수집기가 이 값을 읽는다.** `inferred`인 Profile이 섞여 있으면 수집을 시작하기 전에 목록을 찍고 멈춘다. `--allow-inferred`를 줘야 진행한다.

v3까지는 이 값을 아무도 안 읽었다. `Okta_Profiles_v3.md`가 본문에 "이 파일은 아직 수집에 쓰면 안 된다"고 적어 놓고도 막을 방법이 없었다. 6종 중 2종이 `inferred`다.

---

## 수집기가 지켜야 할 것

- `properties.keep`에 적힌 키는 실제 응답에 있어야 한다
- `collect.endpoints[].params`에 적힌 값으로 호출해야 한다. 특히 ServiceNow `sysparm_display_value`
- `identifiers.primary`의 원소를 모두 얻을 수 있는 엔드포인트로 수집해야 한다
- `source.fields{}`의 값은 `source.apis[]` 안에 있어야 한다
- `listable: false`인 종류는 수집 결과가 0건이어도 "없음"으로 결론 내지 않는다
- `completeness: not_collectable`인 종류는 행을 만들지 않는다
- 벤더가 기본 질의에서 거르는 행이 있으면 그 해제 파라미터를 `params`에 적는다. Salesforce `ALL ROWS`가 그것이다
- `references[].relation_type`은 `Relation_Schema_v3.md` 어휘 17종 안의 값이거나 `null` 또는 `no_relation`이다
- `references[].policy`는 `relation_type`이 3항 관계일 때만 있다
- `references[].provider`는 이 Profile의 `provider`와 다를 때만 있다. 같은 값을 적으면 오류다
- `references[].basis`는 `stated`, `computed`, `flag` 중 하나다. **생략할 수 없다.** 기본값이 없다
- `properties.as_relation`에서 나온 관계의 `basis`는 `flag`다
- `references[].binding`은 `relation_type`이 `applies_to`나 `excludes`일 때만 있고 `explicit` 또는 `ambient`다
- `relation_type: contained_in`인 참조의 값은 같은 Object의 `scope`나 `references.parent`에 실재한다
- `relation_type: no_relation`을 적은 참조는 판정 근거와 일자를 주석으로 갖는다
- `references[].policy`가 있으면 `relation_type`은 `has_role_on`이다. 3항은 그것 하나다
- `status: unresolved`를 적은 참조는 `unresolved_reason`도 적는다
- `interfaces`에 `Assignment`가 있으면 `assignment.relation_type`과 `assignment.basis`가 있고, `slot`이 `source`와 `target` 둘 다 채워진다
- `properties.as_relation`의 키는 `properties.keep`에도 있다
- `properties.per_source`의 키는 `properties.keep`에도 있다
- `properties.per_source`에 같은 키가 두 번 없다
- `spec`이 있으면 정수다. 없으면 1로 본다
- `enumerable`은 다섯 값 중 하나다. `listable`과 같이 적지 않는다
- `enumerable: required_params`면 `enumerate_by`가 있다
- `basis_when`의 `then`은 `stated`, `computed`, `flag` 중 하나다
- `resolve.by`는 여섯 값 중 하나다. `sibling_field`면 `field`가, `link_path`면 `pattern`이 있다
- `external_refs`와 `external_unknown`의 항목은 `provider`를 갖는다
- `references`의 항목은 `provider`를 갖지 않는다
- `identifiers.primary`의 모든 성분이 `identifiers`에 `path`, `from`, `const` 중 하나로 실재한다
- `collect.endpoints[].id`는 그 Profile 안에서 유일하다. 안 적으면 `"METHOD path"`가 id다
- `partition` 없는 `role: primary`는 정확히 하나다
- `partition` 있는 `role: primary`끼리 `partition` 값이 겹치지 않는다
- `partition`이 있으면 `completeness`와 `partition_verified_on`이 있다
- `partition_verified_on`이 오늘로부터 6개월보다 오래면 경고다
- `spec >= 4`이고 `enumerable: parent_fanout`이면 그 `role: primary`에 `fanout`이 있다
- `fanout[]`의 각 항목은 `from`, `const`, `into` 중 적어도 하나를 갖는다
- `fanout[].param`이 그 엔드포인트의 `path`나 `params`에 실재한다. `into`가 있으면 예외다
- `fanout[].from.object_type`에 Profile이 있다
- `fanout` 그래프에 순환이 없다
- `fanout[].scoped_by`가 가리키는 이름이 같은 `fanout` 목록의 다른 `param`이다
- `references[].when.endpoint`의 값이 그 Profile의 `collect.endpoints[].id` 중 하나다
- `references[].when.field`가 있으면 `path`와 `in`이 둘 다 있다
- `root_tenant`는 `true`, `false`, `conditional` 중 하나다. 생략하면 `false`다
- `service`는 벤더가 쓰는 이름을 그대로 적는다. 생략하면 `null`이고 그 provider의 기본 표면이다
- 같은 provider 안에서 `object_type`이 같은 Profile이 둘 이상이면 `service`가 서로 달라야 한다
- `judged`의 키가 두 interface의 계약에 함께 있으면 `interface.필드` 꼴로 적는다
- 범위와 1:1이고 키가 범위 객체와 같은 설정 묶음은 별개 Profile을 만들지 않는다. 그 범위 object_type의 `collect.endpoints`에 `role: enrichment`로 붙인다
- `identifiers.primary`의 성분이 `redact` 또는 전역 감춤 목록에 걸리면 해시가 키다
- `confidence: inferred`인 Profile은 `--allow-inferred` 없이 수집하지 않는다

### 옛 Profile이 새 판에서 같은 답을 내는지 본다

규칙 1을 사람이 지키리라 믿으면 안 된다. **검사가 잡아야 한다.**

수집기는 판을 올릴 때마다 **옛 Profile을 새 판으로 읽어 결과를 대조한다.** 달라지면 규칙 1이나 3을 어긴 것이다.

```
기준선   Slack 8종 -> Object 127노드, Relation 191행
```

이 숫자가 바뀌면 판을 올리지 않는다.

**대조는 키를 정렬한 뒤에 한다.** 수집기의 속성 키 순서가 실행마다 달라서, 파일 해시로 비교하면 아무것도 안 바뀌었는데 매번 다르다고 나온다.

v3 -> v4에서 이 대조를 실제로 돌렸다. 새 키 세 개를 구현한 뒤에도 127노드 / 189행이 그대로이고, 정규화한 `objects`와 `relations`가 바이트 단위로 같다.
- `as_relation[].target.ref`가 가리키는 이름이 `references`에 실재한다
- `references`의 모든 항목이 `kind`와 `status`를 갖는다. Object 행의 필수 키인데 공급처가 여기뿐이다
- `relation_type`이 적힌 참조의 상대편 object_type에 Profile이 있다. 없으면 만들어지자마자 허공을 가리킨다
- `provider_term`은 `object_type`과 다를 때만 있다. 같은 값을 적으면 오류다
- `collect.endpoints`에 `role: primary`가 **정확히 하나** 있다
- `role: detail`인 엔드포인트는 `params`나 `path`에 이 object_type의 식별자 자리를 갖는다
- `role: enrichment`인 엔드포인트는 그 자리를 갖지 않는다. 가지면 `detail`이다
- `collect.listable`을 근거로 한 회수 판정은 `role: primary`인 엔드포인트에만 적용한다
- `object_type`이 응답 필드 이름 규칙에서 벗어나면 `open_issues`에 이유가 있다
- `interfaces`에 적은 값이 `Interface_Spec_v3.md`의 9개 안에 있다
- `root_tenant: true`가 아니면 `references`에 `tenant`가 있다

---

## v4가 정하지 않은 것

빈칸이 아니라 **선언**이다. 근거가 없어서 안 정했다.

| 무엇 | 왜 못 정하나 |
| --- | --- |
| GraphQL로만 열거되는 것 | GitHub은 enterprise 안의 org 목록을 REST로 안 준다. `endpoints[]`가 REST 모양이라 담을 자리가 없다 |
| `properties.keep` / `drop` 기준 | 응답 본문이 있어야 정한다. 지금 실 응답이 있는 provider는 Slack뿐이다 |
| `stability` 판정 기준 | 벤더 문서에 안 적힌 경우가 대부분이다 |
| 하위 타입이 있는 object_type | Okta `Application`이 `signOnMode`로 9종, `Policy`가 `type`으로 13종이다. `keep`이 평평해서 하위 타입별 필드 집합을 못 적는다. 실제 응답을 봐야 한다 |

넷 다 **실 수집 뒤에 정한다.** 그때 규칙 1대로 새 선택 키로 더한다.

---

## v4를 무엇으로 만들었나

| 판 | 증거 |
| --- | --- |
| v1 | Slack 실제 응답 |
| v2 | 수집 결과 측정. 213 관측 -> 125 노드 |
| v2.1 | 자체 적대적 검증에서 나온 버그 |
| v3 | 다섯 provider 공식 문서 대조. 구멍 12개 |
| **v4** | **318건 전수 파싱 + 외부 적대적 검증 3건 + 회귀 실행** |

v4에서 형식이 바뀐 것은 전부 아래 중 하나가 근거다.

**① 318건 실측** — 부모 순회 51%, primary 후보 다중 174건, Tenant 10건의 부모 관계.

**② 공식 문서로 공격받아 깨진 것** — 첫 설계는 `when_endpoint`에 경로 문자열을 쓰려 했다. Okta 페이징, Graph `/me`, Graph 판 구분, Slack 메서드 이름, GraphQL 다섯 가지로 깨져서 엔드포인트 id로 바꿨다.

**③ 이미 있던 자리를 다시 쓴 것** — 공격 둘은 받아들이지 않았다. Entra의 자격/활성은 `validity.effect`가, GitHub 협업자의 출처 미분리는 `decomposable: false`가 이미 담고 있다. 새 키를 더하면 뜻이 겹치는 자리가 둘이 된다.

**형식의 모양 자체는 판단이다.** 측정은 "여기 자리가 필요하다"까지만 말한다. `fanout`을 이 모양으로 쓴 것, `partition`을 별도 키로 둔 것, `expires_at`에 접두사를 붙인 것은 전부 다른 해법도 가능했다.

---

## 팀과 합의 대기 중인 것

`Pilot_Profiles_v3.md`(2026-09-21)가 같은 object 목록에 v3 형식을 6종 대 보고 찾은 것이다. 둘은 이 판에 반영했고 하나가 남았다.

| | 상태 |
| --- | --- |
| Tenant인데 부모가 있을 수 있다 | `root_tenant: conditional`로 반영 |
| `provider_term` 중복 8건 | `service`로 반영 |
| 설정 묶음을 담을 interface가 없다 | **새 interface를 안 만든다.** 아래 |

### 설정 묶음은 별개 Profile을 만들지 않는다

`okta.org_setting`이 대표다. `GET /api/v1/org`가 주는 것이 주소·전화번호·웹사이트라 **접근 통제가 아니다.** 9종 중 어디에도 안 맞는다.

```
Policy   "규칙이 독립적으로 CRUD 되는가"
         GET/PUT 되는 싱글턴이니 CRUD 는 된다. 그런데 주소는 규칙이 아니다

Tenant   "이게 사라지면 소속 Object 의 식별자가 의미를 잃는가"
         사라져도 아무 식별자도 안 죽는다
```

**그렇다고 새 interface를 만들지 않는다.** 이름이나 설명에 `setting`·`config`·`preference`가 걸리는 것 24건 중 진짜 설정 묶음은 9건이고, **8건은 이미 `Policy`로 잘 갔다.** `ClientAuthSettings`, `ThreatInsightConfiguration`, `ImapSettings`처럼 실제로 "누가 무엇을 할 수 있나"를 바꾸는 것들이다. **튀는 것은 `OrgSetting` 하나다.** 1건 때문에 9종 고정을 깨지 않는다.

> **범위와 1:1인 설정 묶음은 그 범위를 담은 object_type의 속성으로 흡수한다.**

```yaml
provider: okta
service: management
object_type: org
interfaces: [Tenant]

collect:
  endpoints:
    - id: org.roster
      role: primary
      method: GET
      path: /{accountId}/api/v1/orgs
      params: {}
    - id: org.settings          # org_setting 을 별개 Profile 로 두지 않는다
      role: enrichment
      method: GET
      path: /api/v1/org
      params: {}

properties:
  keep:
    - address1, address2, city, state, postalCode, country
    - phoneNumber, supportPhoneNumber
    - website, endUserSupportHelpURL
  drop: [_links]
```

**판정 기준은 식별자다.** 그 설정 묶음의 `identifiers.primary`가 범위 객체의 것과 같으면 별개 노드가 아니다. `okta.org_setting`의 키는 `id` 하나이고 그게 곧 Org의 `id`다. 별개 노드로 두면 Org와 1:1로 붙어 노드만 두 배가 되고 얻는 것이 없다.

**아예 빼지 않는 이유가 있다.** 빼면 "안 봤다"와 "보고 뺐다"가 구분되지 않는다. `properties.keep`에 넣고 안 쓰는 것은 `drop`에 적으면 판단이 기록으로 남는다.

**흡수하면 안 되는 경우를 가른다.**

```
흡수한다   범위와 1:1 이고, 그 설정의 키가 범위 객체의 키와 같다
안 한다    여러 벌 존재하거나(ImapSettings 는 사용자마다 하나),
           자기 키가 따로 있거나, 규칙으로서 켜고 끄는 대상이다
```

`ImapSettings`는 사용자마다 하나씩이지만 **접근을 실제로 바꾸는 규칙**이라 `Policy`로 남는다. 흡수 대상은 "범위의 신상 정보"에 해당하는 것뿐이다.

---

## 남은 미정

| 무엇 | 왜 못 정하나 |
| --- | --- |
| **`service`로 가른 것을 다시 잇는 자리** | `Link_Schema_v3.md`는 provider 사이의 신원만 다룬다. 같은 provider의 다른 표면 사이는 어느 문서도 안 다룬다. Okta 첫 수집에서 바로 부딪힌다 |
| GraphQL로만 열거되는 것 | GitHub은 enterprise 안의 org 목록을 REST로 안 준다 |
| `properties.keep` / `drop` 기준 | 응답 본문이 있어야 정한다. 지금 실 응답이 있는 provider는 Slack뿐이다 |
| `stability` 판정 기준 | 벤더 문서에 안 적힌 경우가 대부분이다 |
| 하위 타입이 있는 object_type | Okta `Application`이 `signOnMode`로 9종, `Policy`가 `type`으로 13종이다 |

첫 줄이 v4.1에서 새로 생긴 것이다. **`service`가 동일성을 가르기만 하고 잇지는 못한다.** 가르는 쪽이 안 가르는 쪽보다 안전해서 그대로 두지만 — 잘못 합치면 없는 권한이 생기고, 안 합치면 못 찾을 뿐이다 — 빈칸인 것은 사실이다.
