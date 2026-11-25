# Relation Schema v3

Object 사이의 사실 하나가 한 행이다. Object Schema와 같은 키 이름을 쓴다.

- Object 행의 모양은 `Object_Schema_v4.1.md`
- provider 사이의 신원 판단은 `Link_Schema_v3.md`
- interface 정의와 계약은 `Interface_Spec_v3.md`
- object_type별 수집 방법은 `Profile_Schema_v4.2.md`

```yaml
Relation
├ provider
├ relation_type
├ template
├ references{}      # source, target, (role)
├ properties{}
└ source{}
```

```yaml
provider: slack
relation_type: has_role_on
template: Principal --[Policy]--> Resource

references:
  source: { object_type: user,         value: U0BTRNDU62F, kind: direct_id, status: confirmed }
  role:   { object_type: role,         value: Rl0A,        kind: direct_id, status: confirmed }
  target: { object_type: channel,      value: C0C0PGN5TGV, kind: direct_id, status: confirmed }

properties:
  date_create: 1789021384
  lifecycle: revocable

source:
  api: GET /api/admin.roles.listAssignments
  params: {}
  record: role_assignments[]
  schema_version: 1
  collected_at: 2026-09-10T16:21:53Z
  first_seen_at: 2026-08-01T09:00:00Z
  last_seen_at: 2026-09-10T16:21:53Z
  produced_by:
    - slack.role_assignment.principal
```

| 항목 | 의미 |
| --- | --- |
| provider | 이 사실을 어느 SaaS에서 수집했는지 |
| relation_type | 무슨 사실인지 |
| template | 양끝이 각각 어떤 interface여야 하는지 |
| references{} | source, target, 그리고 3항일 때 role |
| properties{} | 이 사실 자체의 성질 |
| source{} | 어느 요청에서 언제 수집했고 어느 규칙이 만들었는지 |

---

## Object의 references와 무엇이 다른가

Object의 `references{}`는 한 항목이 여러 대상을 가리킬 수 있다. Relation은 아니다. **관계 하나는 source 하나와 target 하나로 정의된다.**

그래서 Object에서 target이 여러 개인 참조는 Relation 여러 행으로 펴진다. Okta Group Rule의 `actions.assignUserToGroups.groupIds`에 그룹이 셋 들어 있으면 Object에는 target 세 개짜리 참조 하나로, Relation에는 세 행으로 남는다.

항목의 모양은 Object의 target과 같다 — `object_type`, `value`, `kind`, `status`, 필요하면 `identifier_type`, `scope`, `provider`.

---

## Object에서 관계 꺼내기

`references`의 항목 이름은 provider 응답의 뜻을 담은 이름이다. 그 이름을 `relation_type`으로 바꾸는 표는 **Profile이 쥔다.**

```yaml
# Object
references:
  groups: { targets: [{ object_type: usergroup, value: S0C0… }] }

# Profile
references:
  groups:
    path: enterprise_user.teams
    object_type: usergroup
    relation_type: member_of

# Relation
relation_type: member_of
references:
  source: { object_type: user,      value: U0BT… }   # Object의 identifiers.primary
  target: { object_type: usergroup, value: S0C0… }   # 항목의 target
```

### 왜 Object에 relation_type을 박지 않는가

박아도 수집 때 드는 일은 같다. `manager` 항목을 쓰려면 이미 "이 필드는 이 사용자의 관리자를 가리킨다"를 알아야 했다. 이름만 다르게 적는 것이다.

문제는 **시점**이다. Object 행은 수집할 때 만들어져 저장되고, `relation_type` 어휘는 우리가 설계하는 것이라 계속 바뀐다. 참조 키에 어휘를 박으면 **어휘를 고칠 때마다 저장된 Object 행을 전부 고쳐야 한다.** 버전 규칙상 그때마다 스키마 판이 올라간다.

Profile은 저장된 데이터가 아니라 설정이다. 고쳐도 마이그레이션이 없다.

Profile에 없는 참조는 관계가 되지 않는다. 관계가 안 되는 이유가 하나가 아니라 **셋을 구분한다.**

| 표기 | 뜻 | 나중에 바뀌나 |
| --- | --- | --- |
| `relation_type`이 아예 없음 | 아직 안 봤다 | 봐야 한다 |
| `relation_type: null` | 봤는데 어휘에 자리가 없다 | 어휘가 늘면 풀린다 |
| `relation_type: no_relation` | 봤고 관계가 아니라고 판정했다 | **안 바뀐다** |

Slack 채널의 `creator`가 `no_relation`이다. 만든 기록일 뿐 권한이 아니고, 어휘가 늘어도 이 판정은 안 바뀐다. `null`과 섞으면 "어휘가 생기면 풀릴 것"과 "끝난 것"이 구분되지 않아 미결 목록이 영영 안 줄어든다.

`no_relation`은 Profile에만 있는 값이다. Relation 행에는 나타나지 않는다.

`no_relation`을 적을 때는 **판정 근거와 일자를 같이 적는다.** 판정 기준이 provider 성질이 아니라 테넌트 설정에 달린 경우가 있어서, 영구 선언을 근거 없이 두면 반증도 감사도 안 된다.

### 이름이 방향을 담는다

`references`는 구조상 **언제나 "나 → 상대"**다. Object가 자기 안에 포인터를 담기 때문이다. 그런데 `relation_type`은 방향이 정해져 있어서 어긋나는 경우가 생긴다.

```
Group Object의 members[]      그룹 → 사용자
member_of의 template          사용자 → 그룹
```

그대로 옮기면 "그룹이 사용자에 속한다"가 된다.

**그래서 Profile이 뒤집기를 적는다.**

```yaml
# user Profile
references:
  groups:  { path: groups, object_type: usergroup, relation_type: member_of }

# usergroup Profile
references:
  members: { path: members, object_type: user, relation_type: member_of, reverse: true }
```

`reverse: true`면 Object의 `identifiers.primary`가 target이 되고, 항목의 target이 source가 된다.

**행에는 언제나 정방향 이름 하나만 남는다.** 역방향을 별개 `relation_type`으로 만들면 같은 사실이 두 행이 되고, 어느 Object를 수집했느냐에 따라 모양이 달라져서 동일성 튜플이 둘을 못 합친다.

실측이 이 경우다. SCIM `Groups`의 `members[]`에서 3건, SCIM `Users`의 `groups[]`에서 3건이 나왔고 **같은 3건**이다. 역방향을 별개 `relation_type`으로 뒀으면 6행이 됐다.

`reverse`는 Profile마다 따로 판단한다. 같은 `relation_type`이라도 어느 object_type에서 수집하느냐에 따라 방향이 달라지기 때문이다.

---

## 닫힌 어휘를 늘리는 절차 — A단계 / B단계

**이 절은 `relation_type` 전용이 아니다.** 우리가 만드는 닫힌 어휘가 이미 셋이고 전부 같은 절차를 탄다. 절차가 어느 한 어휘의 절 안에 있으면 나머지가 남의 것을 빌려 쓰는 모양이 되므로 여기 따로 둔다.

| 어휘 | 어디 | 지금 |
| --- | --- | --- |
| `relation_type` 17종 | `Relation_Schema_v3` (이 문서) | B단계를 네 번 돌았다 |
| `effect` | `Effective_Access_Schema_v1` | **A단계.** 아직 한 항도 없다 |
| Link `level` 5종 | `Link_Schema_v3` | 확정 |

interface 9종은 이 절차를 안 탄다. **아홉 개로 고정이고 늘리지 않는다**고 `Interface_Spec_v3`이 따로 못 박았다.

### 절차

추가만 한다고 해도 **아무 때나 더하면 안 된다.** provider가 늘 때마다 어휘를 손보면 재작업이 provider 수에 비례한다.

**A단계 — 격리.** 새 SaaS나 새 질의를 **기존 어휘로만** 매핑한다. 안 맞는 것은 `null`로 두고 대기열에 넣는다. **공용 파일은 한 글자도 안 고친다.**

**B단계 — 승격 회의, 분기 1회.** 대기열에서 **임계치를 넘은 패턴만** 승격하고, 그때만 전체 재검증을 돌린다.

**재작업이 SaaS 수가 아니라 회의 수에 비례한다.** 이게 이 절차의 전부다.

### 승격 기준

**provider 둘 이상에서 같은 모양으로 요구될 때**다. 한 provider의 사례 하나로 어휘를 만들면 `governs`가 된다 — 데이터가 0건인데도 문서 재작성 2회와 재검증 2회를 먹였고, 결론은 **만들었다 지우는 게 안 만들고 나중에 만드는 것보다 훨씬 비싸다**였다.

폭발 반경도 쟀다. 어휘 하나를 지울 때 `contained_in`은 **157건 / Object 107개**, interface 하나를 바꿀 때 `Resource`는 **44개**다. **이 둘은 사실상 동결 대상이다.** (구 워크북 139건 기준이고 그 파일은 저장소에 없다.)

### 셋을 구분한다

어휘에 자리가 없는 것과 관계가 아닌 것과 아직 안 본 것은 다르다. 이 표기가 대기열을 줄어들게 만든다.

| 표기 | 뜻 | 대기열 |
| --- | --- | --- |
| 키 없음 | 아직 안 봤다 | 들어간다 |
| `null` | 봤는데 어휘에 자리가 없다 | **들어간다** |
| `no_relation` | 봤고 어휘 문제가 아니라고 판정했다 | **안 들어간다. 안 바뀐다** |

`no_relation`을 적을 때는 판정 근거와 일자를 같이 적는다. 섞으면 "어휘가 생기면 풀릴 것"과 "끝난 것"이 구분되지 않아 **미결 목록이 영영 안 줄어든다.**

---

## relation_type

**이름을 `source 이름 target` 순서로 읽으면 방향이 나온다.** `owned_by`는 "X가 Y에게 소유된다"이므로 source가 소유당하는 쪽이다. 이 규칙을 안 세워서 한 번 거꾸로 넣은 적이 있다.

### 이름은 바꾸지 않는다. 추가만 한다

`Slack_Profiles_v3.md`에서 `relation_type`이 적힌 줄이 **23줄**이다. 이름 하나를 바꾸면 provider마다 그만큼 고쳐야 하고, 쌓인 행도 전부 다시 만들어야 한다.

> **어휘는 이름을 바꾸지 않는다. 새 항을 더하고, 안 쓰게 된 것은 `deprecated`로 표시해 남긴다.**

v1.2에서 `has_role`→`has_role_on`, `governs`→`applies_to`로 바꾼 것이 마지막이다. 그때는 저장된 행이 0건이었다.

지금 시점의 근거가 하나 더 있다. **17종 중 Slack이 실제로 쓰는 것은 7종이고, 그중 2종은 관측이 1건이다.**

```
has_role_on 52   member_of 47   contained_in 40   shared_with 30
authenticates_with 19   runs_as 1   triggered_by 1
미도달 10종
```

**어휘가 아직 제대로 시험된 적이 없다.** 그래서 앞으로 흔들릴 여지가 크고, 흔들릴수록 이름 변경 금지가 값어치 있다.

새 항을 더하는 절차는 `relation_type`만의 것이 아니라 `effect`와 Link `level`도 같이 다스린다. 그래서 위 「닫힌 어휘를 늘리는 절차」로 따로 뺐다.

### 부여 층 — 16종

| # | relation_type | 형태 | Slack 아닌 근거 |
| --- | --- | --- | --- |
| 1 | has_role_on | Principal \| Policy \| Credential \| Integration --[Policy]--> Resource \| Tenant \| Integration \| Automation | Entra `unifiedRoleAssignment`, Snowflake `GRANTS_TO_USERS`, GitHub PAT `permissions`, Okta `ApiServiceIntegration.granted_scopes` |
| 2 | permits | Policy \| Credential --> Resource | Snowflake `GRANTS_TO_ROLES`, GitHub deploy key |
| 3 | member_of | Principal --> Tenant \| Principal \| Resource | GitHub org members, Graph group members |
| 4 | owned_by | Endpoint \| Automation \| Credential --> Integration \| Tenant ; Resource --> Principal ; Principal --> Integration | Graph `subscription.applicationId`, Drive `File.owners`, Okta `Group.external_source_app_id` |
| 5 | registered_in | Integration --> Tenant | Graph `servicePrincipal`, GitHub App installation |
| 6 | registered_by | Integration --> Principal | Graph `createdObjects` |
| 7 | acts_as | Integration --> Principal | Graph `servicePrincipal.appId` |
| 8 | authenticates_with | Principal \| Endpoint \| Integration --> Credential | Snowflake PAT, Okta 앱 키, Graph `application.keyCredentials` |
| 9 | runs_as | Automation --> Principal \| Credential | Azure Automation `identity.principalId` |
| 10 | triggered_by | Automation --> Principal \| Endpoint \| Resource \| Integration | GitHub `actor`, `repository_dispatch`, ServiceNow Business Rule `table`, Azure Logic Apps `ApiConnection` 트리거 |
| 11 | receives_into | Endpoint --> Tenant \| Resource | Azure Monitor DCR `workspaceResourceId` |
| 12 | shared_with | Resource --> Tenant | Drive `permissions type:domain` |
| 13 | applies_to | Policy --> Principal \| Integration \| Resource \| Tenant | Okta `conditions.people`, Entra `conditionalAccessUsers`, GitHub ruleset `conditions` |
| 14 | excludes | Policy --> Principal \| Integration \| Credential \| Policy | Okta `conditions.people.*.exclude`, GitHub ruleset `bypass_actors` |
| 15 | evaluates | Policy --> Policy | Entra `conditionalAccessGrantControls.authenticationStrength`, Okta `conditions.network.include` |
| 16 | trusts | Tenant --> Tenant | Entra `crossTenantAccessPolicy`, Slack `team.externalTeams.list` |

### 구조 층 — 1종

| relation_type | 형태 | 근거 |
| --- | --- | --- |
| 17 contained_in | any --> any | GCP `Project.parent`, Drive `File.parents`, Okta `ApplicationKeyCredential` |

**항목마다 Slack이 아닌 provider에서 공식 문서 근거를 하나 이상 확인했다.** 근거를 못 댄 항목은 남기지 않았다.

### v1.4에서 고친 것

v1.3을 Slack 실측 189행과 충돌 행렬 양쪽에 다시 걸었다. 다섯 가지가 나왔고 전부 고쳤다.

#### 1. `has_role`을 `has_role_on`에 합쳤다 — 19종에서 18종으로

예전에는 둘이었고, **같은 Policy가 슬롯을 옮겨 다녔다.**

```
has_role      source=alice  target=analyst(Policy)
has_role_on   source=alice  role=ChannelManager(Policy)  target=C123
```

한 번은 `target`에 앉고 한 번은 `role`에 앉는다. 이름도 전치사 하나 차이라 읽는 사람이 구분을 못 했다.

합치고 **Policy를 언제나 `role` 슬롯에 고정한다.** `target`은 그 역할이 미치는 범위다.

```
alice가 analyst 역할            source=alice  role=analyst         target=<account>
alice가 C123의 Channel Manager   source=alice  role=ChannelManager  target=C123
```

**대상이 없는 배정은 테넌트를 가리킨다.** 벤더가 범위를 안 주는 역할은 실제로 조직 전역이기 때문이다. Okta 관리자 역할은 기본이 조직 전역이고 `/users/{userId}/roles/{roleAssignmentId}/targets/groups`를 붙여야 좁아진다. Snowflake 계정 역할도 같다. 범위 없는 역할이 전역이 아닌 벤더가 있으면 그 Profile이 `open_issues`에 적고 `status: inferred`로 둔다.

역할 중첩은 `GRANT ROLE r1 TO ROLE r2`를 `source=r2 role=r1 target=<account>`로 읽는다. r2가 r1의 권한을 물려받으므로 r2가 가진 쪽이다.

합치면서 얻은 것이 하나 더 있다. **`has_role_on`은 언제나 3항이고 나머지는 2항이라, 같은 interface 칸에 앉아도 `role` 슬롯의 유무가 먼저 가른다.** 항수가 판별자가 된다.

#### 2. `governs`를 `applies_to`에 합쳤다 — 18종에서 17종으로

v1.3은 "합치면 조용히 넓게 답한다"를 근거로 이름을 나눴다. **그 논거가 성립하지 않는다.**

`excludes`를 따로 둔 이유는 **부정**이기 때문이다. 극성을 안 읽으면 제외된 사람을 "걸린다"고 답한다 — 참값이 뒤집힌다. `applies_to`와 `governs`는 **둘 다 긍정문**이라 합쳐도 참인 행이 늘 뿐 거짓이 생기지 않는다.

그리고 구조적으로도 불가능하다. v1.3에서 `applies_to`의 대상은 `Principal | Integration`이고 `governs`는 `Tenant | Resource`다. **겹치지 않는다.** "이 사용자에게 명시적으로 걸린 정책"은 Principal 대상으로 거르므로 Tenant를 가리키는 `governs` 행을 애초에 못 만난다.

구분 자체는 실재한다. 그래서 **속성으로 옮긴다.**

```yaml
properties:
  binding: explicit | ambient
```

`explicit`은 누가 그 대상을 명시적으로 지정한 것이고 `ambient`는 범위 안에 있어서 그냥 걸리는 것이다. 같은 문서가 `inherited`, `lifecycle`, `row_cause`를 전부 `properties`에 둔 것과 같은 종류의 사실이다.

`applies_to`의 대상은 `Resource`와 `Tenant`까지 넓혔다. GitHub 룰셋 `conditions`에 **사람이 한 명도 없다** — 전부 브랜치와 저장소다. 정책이 사람에게만 걸린다는 가정이 provider 하나에서 바로 깨졌다.

`excludes`도 같이 넓혔다. `bypass_actors[].actor_type`이 `DeployKey`(Credential)와 `RepositoryRole`(Policy)을 받는다. **`applies_to`와 `excludes`는 항상 같이 넓힌다.** 한쪽만 넓히면 "제외한다"는 쓸 수 있고 "적용한다"는 못 쓰는 비대칭이 생긴다.

#### 3. `owned_by`의 출발점을 다시 좁혔다

v1.3이 근거로 든 필드들이 **v1.3 자신의 판정 기준을 통과하지 못한다.**

> 판정 기준은 필드 이름이 아니라 **그 사람이 그 자원에 대해 무언가 할 수 있는가**다.

| 필드 | 실제 | 판정 |
| --- | --- | --- |
| `CodeScanningAlert.dismissed_by` | 경고를 닫은 사람. 다시 닫으려면 `security_events` 쓰기 권한이 필요하고, 닫았던 사실은 아무 권한도 안 준다 | 탈락 |
| `RepositoryInvitation.inviter` | 초대를 지우려면 저장소 admin이 필요하다. 보낸 사실이 아니라 | 탈락 |
| `DeployKey.added_by` | GitHub이 설명 없는 nullable 문자열로 준다. 사용자 id가 아니다 | 탈락 |
| `Group.external_source_app_id` | 앱이 마스터하는 그룹은 그 앱이 실제로 고친다 | 통과 |

**셋 다 Slack `channels[].creator`와 같은 모양이다.** 한 행위의 기록이지 소유가 아니다. 같은 문서가 한쪽에서 빼놓고 다른 쪽에서 넣었다.

즉 **끝점 위반 14건은 검사가 제대로 작동한 것**이었다. 참 음성을 거짓 음성으로 읽고 검사를 지운 셈이다.

행위 기록을 그래프에 남기고 싶으면 `owned_by`가 아니라 자기 이름을 줘야 한다. 지금은 Object의 `properties`에 남긴다.

#### 4. `owned_by`를 접근 등급으로 옮겼다

v1.3은 `owned_by`를 구조 등급에 넣어 기본 접힘으로 뒀다. 그런데 같은 문서가 이렇게 쓴다.

> **자원의 소유자에게 실제 권한이 붙는 SaaS가 많다.** 역할 배정 테이블에는 안 나타나는데 권한은 있다.

**역할 배정에 안 나타나는 권한을 기본 화면에서 지우는 것이다.** 퇴사자가 아직 무엇을 소유하고 있는지, 주인 없는 소유권이 남았는지가 기본 뷰에서 사라진다.

접는 근거도 `contained_in` 것을 빌려 쓴 것이다. "접어도 정보 손실이 없다. 같은 값이 Object의 `scope`와 `references.parent`에 이미 있다" — 이건 `contained_in`에만 해당한다. **`owned_by`는 어디에도 중복이 없다.**

충돌 행렬로 재면 두 조치가 한 묶음이어야 한다는 게 나온다.

**여기는 「기본 펼침」 기준이고, 수치는 지금 어휘로 다시 센 값이다.** 아래 충돌 행렬이 구조 **층** 밖을 세는 것과 다르다. 이 표는 "기본 화면에 보이는 관계끼리 몇 칸이 모호한가"를 재는 것이라 **등급**이 기준이고, 그래서 `owned_by`를 접으면 그 칸이 안 세어진다.

| | 기본 펼침 관계끼리의 충돌 칸 |
| --- | --- |
| v1.3 배치 (`owned_by` 접힘, 출발점 넓음) | 6 |
| `owned_by`만 접근으로 옮김 | **14** |
| `owned_by` 접근 + 출발점 좁힘 (v1.4 배치) | **8** |

따로 옮기는 것보다 출발점도 함께 좁힐 때 충돌이 줄어든다. 그래서 3번과 4번은 하나의 결정이다.

> **v1.4 당시의 값은 6 / 13 / 7이다.** 세 번째 줄은 원래 6이라고 적혀 있었고 틀렸다. `owned_by`를 펼치면 `Endpoint --> Tenant`(`owned_by` vs `receives_into`)가 살아나서 7이었다.

> **2026-10-12 이후 재현값은 6 / 14 / 8이다.** `triggered_by` 끝점 확장이 아래 두 줄에 `Automation --> Integration` 한 칸씩을 더한다. 위 표와 `validation/check_power.py`는 모두 지금 어휘 기준이다.

#### 5. `contained_in`에 검사를 되살렸다

`any --> any`는 유지한다. 소속이 interface를 가린다는 근거가 없다는 v1.3 판단이 맞다.

다만 **이 스키마의 유일한 구조 검사가 `template`이다.** 동일성 튜플은 의미를 안 보고 등급은 명시적으로 검사 제외다. `any --> any`는 어떤 쌍도 거절할 수 없으므로 `contained_in`은 **반증 불가능한 어휘**가 된다.

이런 것이 통과한다.

```
Organization --contained_in--> Repository    방향이 뒤집혔는데 통과
User         --contained_in--> ApiToken      authenticates_with여야 하는데 통과
```

interface 제약 대신 **값으로 검사한다.**

> `contained_in`의 target은 그 source Object의 `scope` 또는 `references.parent`에 실재해야 한다.

v1.3이 "접어도 정보 손실이 없다"고 쓴 근거를 관찰이 아니라 **검사**로 바꾼 것이다. 중복이 실제로 있다면 대조가 되고, 없으면 그 행은 `contained_in`이 아니다.

#### 6. `evaluates`의 근거를 바꿨다

관계 자체는 남긴다. 근거로 든 객체가 Policy가 아니다.

| 객체 | 실제 필드 | 판정 |
| --- | --- | --- |
| Okta `NetworkZone` | `id, name, type, usage, status` + CIDR/ASN 목록 | 조건 데이터. `conditions`도 `actions`도 없다 |
| Okta `BehaviorRule` | `id, name, type, status, settings(velocityKph 등)` | 행동 필드가 없다 |
| Okta `Authenticator` | `id, key, name, type, settings, provider` | 인증수단 카탈로그다 |
| Entra `namedLocation` | `id, displayName, createdDateTime` | 문서 표현으로 "정책에 **쓰이는**" 규칙이다 |

넷 다 조건 객체이지 정책이 아니다. 이것들을 Policy로 타이핑하면 **interface 검사가 판별력을 잃는다.** Authenticator가 Policy이면서 Credential 쪽 template도 만족하게 된다.

진짜 `Policy --> Policy`가 따로 있다. Entra `conditionalAccessGrantControls.authenticationStrength`는 `authenticationStrengthPolicy`를 가리키고, 그건 `policyType`과 `allowedCombinations`를 가진 실제 정책이다.

그래서 근거를 그것으로 바꾸고, **조건 객체를 무엇으로 볼지는 Interface 쪽 과제로 남긴다.** 지금 9개 안에 조건 객체를 담을 자리가 없다.

`behavior_ids`와 `condition_scopes`도 근거에서 뺐다. 앞은 문서화된 필드가 아니라 예시에만 빈 배열로 나오고, 뒤는 `"include": ["*"]`처럼 와일드카드가 오는 이름 문자열이라 이 문서 규칙대로면 `kind: expression`이 되어 행을 안 만든다.

#### 지금 어휘 기준 충돌 행렬

```
전체 17종            충돌 칸 30개 / 81칸
구조 층 밖            충돌 칸  8개
```

**「구조 층」이지 「구조 등급」이 아니다.** `contained_in`을 빼는 이유는 `any --> any`라 모든 칸에서 경쟁하기 때문이고, 그건 template의 성질 — 즉 **층** — 이다. 화면에서 접느냐 펴느냐(**등급**)와는 무관하다. 지금은 구조 등급과 구조 층이 같은 한 종이라 어느 쪽으로 읽어도 8이지만, 둘은 갈라질 수 있다. `validation/check_power.py`의 G3이 갈라지는 순간을 잡는다.

남은 8칸은 전부 판별 기준이 문서에 있다. v1.4 당시에는 전체 29칸 / 구조 층 밖 7칸이었다. 2026-10-12 `triggered_by` 끝점 확장으로 `Automation --> Integration` 한 칸이 늘어 지금은 30칸 / 8칸이다.

| 칸 | 경쟁 | 판별 |
| --- | --- | --- |
| Automation --> Principal | runs_as, triggered_by | 별개 필드. 「절대 합치지 않는다」 절 |
| Integration --> Principal | acts_as, registered_by | 봇 신원 필드 vs 등록자 필드 |
| Policy --> Principal \| Integration | applies_to, excludes | include 배열 vs exclude 배열 |
| Policy --> Resource | applies_to, permits | 부여 흔적이 있으면 permits |
| Policy --> Policy | evaluates, excludes | 조건 목록 vs 우회 허용 목록 |
| Endpoint --> Tenant | owned_by, receives_into | 소유 필드 vs 전달 목적지 필드 |
| Automation --> Integration | owned_by, triggered_by | 자동화가 속한 앱 필드(Slack workflow `app_id`) vs 트리거 정의 필드(Slack `trigger_types[].subtype`, Logic Apps `inputs.host.connection`) |

### v1.2에서 고친 것 — 이력

**아래는 v1.2가 한 일의 기록이고, v1.4가 그중 넷을 되돌리거나 바꿨다.** 왜 그렇게 됐는지를 남기려고 지우지 않았다.

| v1.2가 한 것 | v1.4의 처리 |
| --- | --- |
| 3. `evaluates` 신설 | 관계는 유지, **근거 교체** — 인용한 객체들이 Policy가 아니었다 |
| 5. `governs` 신설 | **`applies_to`에 흡수** — 분리 논거가 성립하지 않았다 |
| 6. `has_role`에 Integration 추가 | **`has_role_on`에 합침** |
| 2. `owned_by` 출발점 제약 제거 | **되돌림** — 근거 필드가 자기 판정 기준을 통과 못 했다 |

아래 수치는 v1.2 당시 것이며 분모가 일정하지 않다. 그대로 인용하지 않는다.

Okta 48개와 GitHub 91개 Profile의 참조 **270건**을 v1의 17개에 씌워봤다. 끝점 위반 **63건**, 17개 어디에도 안 들어가는 것 **62건**이 나왔다. 원인이 여섯 가지였고 전부 이번에 고쳤다.

#### 1. `contained_in`의 대상을 `any`로 열었다

Object Schema는 `references.parent`를 1급으로 두는데, 그걸 받을 관계가 이것 하나다. 그런데 대상이 `Tenant | Resource`로 묶여 있어서 **부모 참조 111건 중 23건이 갈 곳을 잃었다.**

```
ApplicationKeyCredential → Application   (Integration)
PolicyRule               → Policy
AuthenticatorEnrollment  → User          (Principal)
Job                      → WorkflowRun   (Automation)
WebhookDelivery          → Webhook       (Endpoint)
```

Okta 앱 키가 어느 앱 것인지를 그래프에 담을 수 없었다. Object Schema가 `parent`로 푸는 대표 사례(같은 `kid` 값이 앱마다 겹치는 문제)가 바로 이 객체다.

**소속은 interface를 가리지 않는다.** 제약을 둘 근거가 없었다.

#### 2. `owned_by`의 출발점 제약을 없앴다

"누가 만들었나 / 누구 것인가"도 종류를 가리지 않는다. 실측 끝점 위반 14건이 전부 이 이유였다.

```
RepositoryInvitation.inviter    Assignment  → Principal
Group.external_source_app_id    Principal   → Integration
CodeScanningAlert.dismissed_by  Observation → Principal
DeployKey.added_by              Credential  → Principal
```

**소유 판정 기준은 그대로다.** 필드 이름이 아니라 그 사람이 그 대상에 대해 무언가 할 수 있는가로 본다. Slack `creator`처럼 기록만 남는 것은 여전히 관계로 만들지 않는다. 넓힌 것은 출발점의 interface뿐이다.

#### 3. `evaluates`를 새로 만들었다 (Policy --> Policy)

정책이 **무엇을 조건으로 쓰는지**를 담을 어휘가 없었다.

```
PolicyRule.network_zone_include → NetworkZone
PolicyRule.behavior_ids         → BehaviorRule
PolicyRule.authenticator_keys   → Authenticator
AuthorizationServerPolicyRule.condition_scopes → AuthorizationServerScope
```

`applies_to`는 "이 정책이 **누구에게** 적용되는가"이고, 이것은 "이 규칙이 **무엇을 보고** 판정하는가"다. 방향이 아니라 대상의 성격이 다르다.

`has_role`로 밀 수도 없다. "규칙이 네트워크 존 역할을 가진다"가 되어 문장이 성립하지 않는다.

**"MFA 없이 통과 가능한 경로"** 같은 질의가 정확히 이 간선을 탄다. 어느 네트워크 존에서 들어오면 어느 인증기를 건너뛰는지가 이 관계로만 이어진다.

#### 4. 자격증명 귀속은 `authenticates_with` + `reverse`다

"이 토큰은 누구 것인가"를 담는 참조가 8건 있었는데 처리 규칙이 없어서 전부 미분류로 빠졌다.

```
ApiToken.user_id
OAuthRefreshToken.user_id
AuthenticatorEnrollment.owner_user_id
UserFactor.owner_user_id
```

새 어휘가 필요한 게 아니다. `authenticates_with`가 이미 `Principal --> Credential`이고, 이 참조들은 자격증명 쪽에서 사람을 가리키므로 **Profile에 `reverse: true`를 적으면 된다.**

```yaml
# ApiToken Profile
references:
  user_id:
    path: userId
    object_type: User
    relation_type: authenticates_with
    reverse: true
```

행에는 `User --> ApiToken` 정방향 하나만 남는다. 사람 쪽에서 수집한 것과 자격증명 쪽에서 수집한 것이 같은 행으로 모인다.

**이 규칙을 명시해 두는 이유는 이 간선이 "이 토큰이 유출되면 누구를 사칭하는가"에 답하기 때문이다.** 빠뜨리면 자격증명이 주인 없이 떠 있게 된다.

#### 5. `governs`를 새로 만들었다 (Policy --> Tenant | Resource)

설정 하나가 아니라 **설정 묶음 자체**가 Object인 경우가 있다. 두 종류가 섞여 있어서 먼저 가른다.

| | 모양 | 예 | 처리 |
| --- | --- | --- | --- |
| A | 범위와 1:1. 자기 id가 없다 | Okta 조직 설정, GitHub 조직 Actions 권한, Slack `team.info` prefs | **이번에 추가** |
| B | 이름과 id가 있고 여러 대상에 붙는다 | GitHub Repository ruleset, Okta Device Assurance Policy | 기존 어휘로 충분 |

**B는 새 문제가 아니다.** 이미 Policy이고 `contained_in`(어디 사는지) + `applies_to`(누구에게 거는지)로 이미 담긴다.

**A가 구멍이었다.** 정체성은 이미 풀려 있다 — `identifiers.primary`가 비어 있으므로 Object Schema의 동일성 키가 `(provider, object_type, scope)`로 자연히 축약된다. 조직 하나에 행 하나다.

문제는 관계다. `contained_in`은 "조직을 지우면 뭐가 같이 사라지나"에 답하는 것이지 **"이 저장소에 지금 걸려 있는 설정이 무엇인가"**에 답하지 않는다. `applies_to`는 대상이 `Principal | Integration`뿐이라 Tenant도 Resource도 못 받는다.

`applies_to`의 대상을 넓히지 않고 이름을 나눈 이유는 `excludes`와 같다. `applies_to`는 **누가 명시적으로 그 대상을 지정한 것**이고 `governs`는 **범위 안에 있어서 그냥 걸리는 것**이다. 합치면 "이 사용자에게 명시적으로 걸린 정책"을 묻는 질의가 조직 기본 설정까지 끌고 와서 **조용히 넓게 답한다.** 보안 판정에서 가장 위험한 방향이고, 극성을 `properties`에 넣지 않은 것과 같은 이유다.

**A는 `governs`만 만들고 `contained_in`은 만들지 않는다.** 판정은 기계적으로 된다 — `identifiers.primary`가 비어 있으면 범위가 곧 정체성이므로 포함 질의가 의미를 갖지 않는다. 반대로 `BranchProtectionRule`처럼 id가 따로 있고 저장소당 여럿인 것은 `contained_in`(parent 필드)과 `governs`(적용 범위 필드)가 서로 다른 근거에서 나오므로 둘 다 남긴다.

> **이 모양의 Object가 아직 인벤토리에 거의 없다.** Okta 48개 중 0개, GitHub 91개 중 `GitHubPages` 하나뿐이다. 실제 provider에는 조직 Actions 권한, ThreatInsight 설정, 워크스페이스 prefs처럼 흔한데 Object 선정 단계에서 빠졌다. 그래서 지금은 "이 조직이 MFA를 강제하는가"를 그래프로 물을 수 없다. 어휘는 이번에 마련했으니 남은 것은 Object 쪽 과제다.

#### 6. `has_role`의 출발점에 Integration을 넣었다

v1은 `Principal | Policy | Credential`만 허용했다. 그런데 **연동 자체가 권한을 직접 들고 있는 경우**가 있다.

```
Okta ApiServiceIntegration.granted_scopes → AuthorizationServerScope
```

이미 `Credential --> Policy`를 허용한 이유(GitHub fine-grained PAT가 `permissions`를 직접 들고 있다)와 같은 문장이다. 권한을 쥐는 주체가 사람일 수도, 역할일 수도, 자격증명일 수도, 연동일 수도 있다. 넷 중 셋만 허용할 근거가 없었다.

#### 고친 효과 — 재해석 필요

같은 270건을 v1.2로 다시 돌린 결과다. **다만 아래 0은 측정이 아니라 정의상 참이다.**

`contained_in: any --> any`는 어떤 쌍도 거절할 수 없는 template이다. 그러므로 "어휘에 안 들어가는 참조 = 0"은 무작위 쌍을 넣어도 0이 나온다. 62건을 갈라 보면 새 어휘가 실제로 담은 것은 **5건**(evaluates 4 + governs 1)이고 나머지 57건은 제약을 풀어서 흡수한 것이다. v1.4는 `contained_in`에 값 기반 검사를 되살려 이 구멍을 막았다.

| | v1 | v1.2 |
| --- | --- | --- |
| 끝점 위반 | 63 | **5** |
| 어휘에 안 들어가는 참조 | 62 | **0** |
| relation_type 수 | 17 | 19 |

**미분류 62건은 전부 사라졌다.** 마지막까지 남았던 발급 경계 참조 4건(`OAuthRefreshToken.client_id`, `issuer` 등)도 새 어휘 없이 기존 항목으로 담긴다. `client_id`는 "이 토큰은 이 클라이언트 것이다"이므로 `owned_by`(출발점 제약을 없앴으므로 Credential에서 출발할 수 있다)이고, `issuer`는 "이 발급자 아래에 산다"이므로 `contained_in`이다.

**남은 위반 5건은 relation 어휘 탓이 아니다.**

| 건수 | 어디 | 원인 |
| --- | --- | --- |
| 3 | `ApplicationGrant` | 3항 `has_role_on`의 재료로 `slot`을 통해 펴지는 Assignment다. 이 객체 자체는 관계의 끝점이 아니다 |
| 2 | `RunnerGroup` | interface가 `ExecutionHost`다. 확정 9개 밖의 구어휘라 GitHub Profile 재매핑이 끝나야 검사할 수 있다 |

**늘린 것은 둘뿐이고 나머지 넷은 제약을 푼 것이다.**

#### 검증이 Object 쪽에서 찾아낸 것

끝점 위반 중 넷은 relation이 아니라 **Object Profile의 interface 배정** 문제였다. 두 번째 interface를 주자 그대로 사라졌다.

| object_type | 지금 | 권고 | 왜 |
| --- | --- | --- | --- |
| `GroupRule` | Automation | **Automation, Policy** | 조건(`conditions`)과 행동(`actions`)을 함께 담는다. 조건 부분은 정책 문장이라 `applies_to`가 여기서 출발한다 |
| `IdentityProvider` | Policy | **Policy, Integration** | 외부 IdP는 판정 규칙이면서 동시에 연동이다. 서명 키를 들고 있으므로 `authenticates_with`가 출발한다 |

선례가 있다. `OAuthClient`는 `Integration, Principal`이고 `GitHubApp`도 `Principal, Integration`이다. **한 Object가 둘 이상의 계약을 만족하는 것은 예외가 아니다.**

이 둘은 Object Profile을 고쳐야 하는 일이라 이 문서의 범위 밖이다.

### GitHub으로 확인한 결과

두 번째 provider로 GitHub 공식 문서를 훑었다. 기대보다 덜 채워졌고 그 사실을 적어 둔다.

| relation_type | GitHub 근거 |
| --- | --- |
| `permits` | **확인.** deploy key — "단일 저장소에 접근을 부여하는 SSH 키" |
| `has_role_on` | **확인.** 협업자 `role_name`, fine-grained PAT `permissions` |
| `registered_in` | **확인.** `AppInstallation.account` + `target_id` |
| `excludes` | **확인.** 룰셋 `bypass_actors[]` — "이 룰셋의 규칙을 우회할 수 있는 행위자" |
| `applies_to` | **확인.** 룰셋 `conditions` — 단, 대상이 전부 브랜치·저장소다 |
| `triggered_by` | **확인.** WorkflowRun `actor`, `triggering_actor` |
| `acts_as` | **없다.** App에도 AppInstallation에도 봇 필드가 없다. `@jenkins[bot]`은 산문 예시뿐이다 |
| `registered_by` | **없다.** AppInstallation에 `created_by`가 아예 없다. 사람 값은 `suspended_by` 하나인데 뜻이 다르다 |
| `runs_as` | **없다.** WorkflowRun 응답에 실행 신원 필드가 0개다. Job의 `runner_id`는 기계지 신원이 아니다 |

**`acts_as`와 `registered_by`는 아직 Graph 한 곳 근거다.** GitHub이 채워 줄 거라고 봤는데 아니었다. 어휘에서 빼지는 않는다 — Graph 근거는 확실하다. 다만 provider 두 곳을 못 채운 항목으로 표시해 둔다.

`runs_as`는 다르다. 관계 자체는 Slack 실측으로 나왔고 Azure Automation 문서 근거도 있다. **GitHub Actions가 REST로 안 줄 뿐이다.** 어휘 문제가 아니라 그 provider의 `completeness` 문제다.

**GitHub에는 Enterprise Object가 없다.** `GET /enterprises/{enterprise}`가 없고 목록도 없다. Organization 응답에 엔터프라이즈를 가리키는 필드도 없다. 그래서 GitHub의 최상위 테넌트는 Organization이다. Slack은 enterprise였다. **같은 자리가 provider마다 다른 object_type에 붙는다.**

### 아직 자리가 없는 것

**자동화가 다른 자동화를 호출하는 사실**을 담을 어휘가 없다. 네 번 반복해서 걸린 자리다.

```
4개 SaaS 목록 검증   Automation -> Automation 12건
Slack Profile        workflow 참조 7개 중 3개
GitHub              WorkflowRun.referenced_workflows[]
```

GitHub 쪽 근거는 약하다. 실행된 run에만 있고, 대상이 워크플로 id가 아니라 파일 경로이며, 문서에 설명 문장이 0개다. 정적 선언(`jobs.<id>.uses`)을 주는 REST 엔드포인트가 없다. Slack `workflow_function_id`도 호출이 아니라 워크플로 자신의 함수 핸들일 가능성이 있어 확인 중이다.

**근거가 정리되기 전에는 어휘를 만들지 않는다.**

### 지운 것

| 예전 | 왜 |
| --- | --- |
| `approved_with_scope: Principal --[Policy]--> Tenant` | **테넌트 끝점이 실재하지 않는다.** Graph `oAuth2PermissionGrant`는 `clientId`(앱) → `resourceId`(대상 API)이고 테넌트 필드가 없다. GWS `users/{id}/tokens`도 User → Integration이다. `has_role_on`의 Integration 대상으로 흡수했다 |
| `sends_to: Endpoint --> (모델 밖)` | 한쪽 끝이 Object가 아니라 이 문서 첫 줄을 어긴다. provider 9곳을 확인했지만 **원격 목적지를 독립 객체로 두는 곳이 없다.** 목적지는 `references`의 `kind: external_locator`로만 남긴다 |
| `owned_by`의 `Endpoint --> Resource` | GitHub 웹훅 객체에 소유 필드가 없다. **경로로만** 소속이 표현되므로 그건 `contained_in`이다 |
| `triggered_by`의 Policy 가지 | Purview DLP 룰 액션이 문서엔 있으나 **바인딩을 노출하는 API 필드가 없다.** 채울 수 없는 어휘는 두지 않는다 |

### 끝점을 넓혀서 담은 것

새 이름을 만드는 대신 기존 항목의 끝점을 넓혔다. 같은 문장이기 때문이다.

- `has_role_on`에 `Policy` 출발점 — Snowflake `GRANT ROLE`은 사용자에게든 역할에게든 같은 명령이다. "Granting a role to another role creates a 'parent-child' relationship between the roles"
- `has_role_on`에 `Credential` 출발점 — GitHub fine-grained PAT가 `permissions`를 직접 들고 있다
- `has_role_on`에 `Integration` 출발점 — Okta `ApiServiceIntegration.granted_scopes`. 권한을 쥐는 주체가 사람일 수도 역할일 수도 자격증명일 수도 연동일 수도 있다
- `has_role_on`에 `Automation` 대상 — 워크플로 편집 권한처럼 자동화를 대상으로 하는 역할이 있다
- `permits`에 `Credential --> Resource` — GitHub deploy key는 "an SSH key that grants access to a single repository"
- `authenticates_with`에 `Integration` — Okta `/apps/{appId}/credentials/keys`, Graph `application.keyCredentials`
- `has_role_on`에 `Tenant` — 조직 전역 역할. 실측에서 이게 없으면 Slack 행 55건 중 31건이 위반이 된다
- `triggered_by`에 `Resource` 대상 (2026-10-12) — 주소 없이 **자원에서 난 이벤트**로 시작하는 자동화가 있다. ServiceNow Business Rule은 "the name of the table on which the business rule runs"를 따로 들고, 그 테이블의 레코드가 생기거나 바뀔 때 돈다. Slack 워크플로의 이벤트 트리거(채널에 글이 올라옴)도 같은 모양이다
- `triggered_by`에 `Integration` 대상 (2026-10-12) — **연동이 보낸 이벤트**로 시작하는 자동화가 있다. Azure Logic Apps `ApiConnection` 트리거는 `inputs.host.connection`으로 커넥터 연결을 가리키고 그 연결을 통해 외부 서비스를 폴링한다. Slack `trigger_types[].subtype`의 `#` 앞이 app_id인 것(`A050QFW22F5#/trigger_types/issue_created`)도 같은 모양이다

여기서 Integration으로 보는 대상은 **테넌트에 등록된 커넥터 연결의 정체성**이다. `inputs.host.connection.name`은 `$connections`의 `connectionId`를 참조하며 토큰 값이 아니다([Microsoft 트리거 규격](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-workflow-actions-triggers#apiconnection-trigger)). 연결 등록과 OAuth 인증은 분리되므로, 연결이 쓰는 자격증명 레코드를 수집할 때는 Credential로 나누고 `authenticates_with`로 잇는다([연결 리소스와 OAuth 인증](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-azure-resource-manager-templates-overview#authenticate-connections)). 원본 연결에 비밀값·URL·권한이 함께 있어도 Integration에 복사하지 않는다. 이 참조만으로 `Automation --> Credential` 트리거를 추가할 근거는 없다.

트리거 자체를 Object로 세울지는 [Interface_Spec_v3의 Endpoint 판정](Interface_Spec_v3.md#트리거의-endpoint-판정)을 따른다.

### applies_to와 has_role_on은 다르다

모양이 서로 뒤집혀 있어서 헷갈리기 쉽다. **부여 행위의 흔적이 있으면 `has_role_on`, 조건 표현 안에서 나왔으면 `applies_to`다.**

```
Snowflake  GRANT ROLE analyst TO USER alice
           준 사람과 준 시각이 있다. 회수할 수 있다          → has_role_on

Okta       policy.rule.conditions.people.users.include
           준 사람이 없다. 회수하려면 정책을 고쳐야 한다      → applies_to
```

**같은 기준이 `permits`와 `applies_to` 사이에도 그대로 쓰인다.** 둘 다 `Policy --> Resource`에 앉는다. Snowflake `GRANTS_TO_ROLES`는 부여 기록이라 `permits`이고, GitHub 룰셋 `conditions.ref_name.include`는 적용 범위라 `applies_to`다.

### excludes를 따로 둔 이유

극성을 `properties`에 넣지 않고 별개 항목으로 뒀다. 넣으면 **극성을 안 읽는 질의가 조용히 넓게 답한다.** 제외된 사람을 "걸린다"고 답하는 것이고, 보안 판정에서 이 방향의 오답이 가장 위험하다. 항목을 나누면 빠뜨려도 좁게 답한다.

방향은 `applies_to`와 같게 `Policy -->`로 맞췄다. 반대로 두면 "이 정책이 건드리는 사람 전부"를 물을 때 나가는 간선과 들어오는 간선을 둘 다 봐야 한다.

### 조건이 id 목록이 아닐 때

정책 조건에는 id 말고 다른 것도 들어온다.

| 조건 모양 | 처리 |
| --- | --- |
| id 목록 (`includeUsers: [id, id]`) | `applies_to` 행을 만든다 |
| 그룹 id (`includeGroups`) | 그룹을 대상으로 행 하나. **멤버까지 펼치지 않는다** |
| 와일드카드 (`"All"`) | `kind: expression`. 행을 만들지 않는다 |
| 동적 그룹 규칙 | `kind: expression`. 행을 만들지 않는다 |

멤버를 미리 펼치지 않는 이유는 원본에 없는 사실이기 때문이다. `member_of`가 이미 있으니 질의에서 두 홉 타면 되고, 펼쳐 두면 그룹 멤버가 바뀔 때마다 전부 다시 써야 한다.

`has_role_on`과 `permits`가 따로 있는 이유는, 대부분의 SaaS에서 주체에게 역할을 주는 행위와 그 역할이 무엇을 허용하는지가 별개의 API에 있기 때문이다. Snowflake에서 `GRANT ROLE r TO USER alice`는 대상 자원을 담지 않는다. 자원은 `GRANT SELECT ON … TO ROLE r`에 있다. 두 단계를 하나로 합치면 두 번째 단계가 사라진다.

`member_of`에 `Principal --> Resource`가 있는 이유는, **자원에 대한 멤버십이 SaaS 전반에 흔하기 때문이다.** Slack 채널 멤버, GitHub 저장소 협업자, Google Drive 공유 대상, Notion 페이지 게스트가 전부 같은 모양이다.

`contained_in`으로 대신할 수 없다. 그건 "안에 담겨 있다"는 뜻인데 사용자는 채널의 일부가 아니다. 채널이 사라져도 사용자는 남는다. 반대로 `has_role_on`도 아니다. 멤버라는 것 자체는 역할이 아니고, 역할은 그 위에 따로 붙는다.

**한 레코드 안에서는 둘 중 하나만 만든다.** 레코드가 역할을 담고 있으면 `has_role_on`, 아니면 `member_of`다. GitHub 협업자 응답은 `role_name`을 담으므로 `has_role_on` 하나만 나오고, Slack `conversations.members`는 역할이 없으므로 `member_of` 하나만 나온다.

**다른 레코드에서 나온 것은 둘 다 남긴다.** 같은 (사람, 채널) 쌍이 멤버이면서 그 채널에 역할을 가질 수 있다. 실측에서 36쌍이 그랬다. 역할을 회수해도 멤버십은 남으므로 두 사실을 합치면 안 된다.

`owned_by`에 `Resource --> Principal`이 있는 이유도 같은 종류다. **자원의 소유자에게 실제 권한이 붙는 SaaS가 많다.** GitHub 저장소 소유자와 Google Drive 파일 소유자는 삭제할 수 있고 권한을 줄 수 있다. 역할 배정 테이블에는 안 나타나는데 권한은 있다.

그래서 소유는 `has_role_on`과 다르다. 부여받은 것이 아니라 만든 결과로 따라온 것이고, 회수하려면 소유권을 넘겨야 한다. 별개 관계로 둔다.

**단, 소유자에게 권한이 없는 provider도 있다.** Slack `channels[].creator`는 만든 사람을 기록할 뿐이고 그 사람이 채널에 대해 할 수 있는 일이 따로 없다. 이런 경우는 관계로 만들지 않고 Object의 `properties`에 남긴다. 판정 기준은 필드 이름이 아니라 **그 사람이 그 자원에 대해 무언가 할 수 있는가**다.

`runs_as`와 `triggered_by`는 **절대 합치지 않는다.** 자동화가 무엇에 의해 시작되는지와 무엇의 권한으로 실행되는지는 별개의 사실이고, 권한 오남용 판정이 그 두 값의 비교로 성립한다. Slack도 워크플로 자체에는 실행 정책이 없고 규칙은 연결된 트리거에 있다고 쓴다.

---

## 3항으로 못 담는 것 — qualifiers와 validity

`(relation_type, source, role, target)` 네 자리로 담기지 않는 사실이 다른 provider에 있다. **자리를 늘리지 않고 열린 맵 두 개를 더한다.**

### qualifiers — 관계에 붙는 조건

```yaml
qualifiers:
  grant_option: true                 # Snowflake. 받은 쪽이 다시 부여할 수 있다
  granted_by: SECURITYADMIN          # Snowflake. 누가 승인했나
  directory_scope: "/au-12345"       # Entra. 역할이 미치는 범위
  org_unit: "/Sales/APAC"            # Google. 대상 객체가 아니라 트리 노드
  view: published                    # Google Drive. role 과 직교하는 두 번째 축
```

**`grant_option`을 버리면 "권한을 퍼뜨릴 수 있는 주체"가 그래프에서 사라진다.** 권한 그래프에서 그건 가장 중요한 축 중 하나다.

`qualifiers`는 **동일성 튜플에 들어가지 않는다.** 같은 (type, source, role, target)인데 `grant_option`만 다르면 한 행이고, 합칠 때 값이 갈리면 `open_issues`에 남긴다. 동일성에 넣으면 조건 하나 바뀔 때마다 새 관계가 생긴 것처럼 보인다.

### validity — 지금 효력이 있는가

Entra PIM이 이걸 강제한다. **`roleEligibilityScheduleInstances`(자격만 있음)와 `roleAssignmentScheduleInstances`(실제 활성)가 별개 엔드포인트**다.

```yaml
validity:
  effect: active | eligible | expired      # 생략하면 active
  activated_from: <관계 id>                 # eligible 을 활성화해서 생긴 행
  start: 2026-09-01T00:00:00Z
  end:   2026-12-31T00:00:00Z
  condition: "user.country == 'KR'"        # Google roleAssignment.condition (CEL)
```

**`effect`를 안 적으면 `active`다.** 기존 행은 전부 그 뜻이었으므로 규칙 1 그대로다.

`eligible`을 `active`처럼 세면 **없는 권한을 있다고 보고**하고, 빼면 **권한 상승 경로를 놓친다.** 둘 다 틀리므로 자리가 필요하다.

### target_kind — 대상이 노드가 아닐 때

```
node    기본. 생략하면 이것
set     주체가 개별 객체가 아니라 집합
```

Google Drive `type: anyone`, Google Directory 멤버 `type: CUSTOMER`, Entra `oauth2PermissionGrant.consentType: AllPrincipals`가 그렇다. **`anyone`은 식별자 자체가 문서에 없다.**

```yaml
target: { kind: set, set: anyone, provider: google }
```

껍데기 노드를 만들면 **없는 주체를 하나 지어내는 것**이 된다. 집합은 집합으로 둔다.

### decomposable — computed 를 풀 수 있는가

GitHub이 문서에 명시한다 — 조직 수준 부여와 저장소 수준 부여를 **이 엔드포인트 응답으로는 구분할 방법이 없다**고.

```yaml
properties:
  basis: computed
  decomposable: false               # 생략하면 모름
  undecomposed: [org_base, enterprise]   # 못 푼 경로
```

**`basis: computed`가 "나중에 풀면 된다"를 뜻하지 않는다.** 못 푸는 경우가 있고, 그때는 "무엇을 지우면 회수되나"에 답이 없다는 사실 자체가 답이다.

## 교차 provider 관계는 stated 만

`references`에서 나온 관계는 **provider를 못 건넌다.** 건너는 것은 `external_refs`에서만 나오고, 조건이 붙는다.

```
허용   source 의 interface 가 Integration, Automation, Credential, Endpoint 중 하나이고
       basis 가 stated 일 때
금지   source 의 interface 가 Principal 일 때
```

**왜 Principal만 막는가.** 측정된 교차 provider 사실 넷 중 셋이 Principal↔Principal이고, 그것들은 전부 **우리가 추정한 것**이다.

| 사실 | 성격 |
| --- | --- |
| Okta 앱 → 그 앱이 붙은 SaaS 테넌트 | 벤더가 기록해 준다. **stated** |
| Okta `AppUser.externalId` → 대상 앱의 사용자 | 우리가 맞춘다. **inferred** |
| Slack SCIM `externalId` → IdP 사용자 | 우리가 맞춘다. **inferred** |
| Google Drive 권한이 외부 도메인 사용자에게 | 우리가 맞춘다. **inferred** |

추정을 관계로 넣으면 이렇게 된다.

```
okta:00u1 --same_principal--> slack:U1     email 로 추정
slack:U1  --has_role_on-->    team T1      확실

질의: 00u1 이 무엇을 할 수 있나
답:   T1 의 owner            <- 추정이 확실한 사실처럼 나온다
```

**추정 하나가 권한 경로를 만들어낸다.** 그래서 어휘 17종에 "같은 사람이다"를 넣지 않는다. 신원 추정은 `Link_Schema_v3.md`로 가고, 질의가 명시적으로 켜야 넘어간다.

**예외 — 명단이 같은 원장의 그룹 · 도메인을 식별자로 가리킬 때(2026-11-20).** Google Cloud IAM 명단의 `group:{메일}` 은 Google 그룹을, `domain:{도메인}` 은 그 Workspace 도메인 계정 전부를 벤더가 적은 식별자로 가리킨다(Cloud Resource Manager v3 `Binding.members`). 사람 계정 둘이 같은지 맞추는 추정이 아니므로 stated 다. 이 경우에만 원장 쪽 그룹 · 계정 → 명단 주체 `member_of` 를 교차 관계로 만든다(`crosswalk.yaml` `kinds.directory_principal`, `directory_reference: true`, 근거 `config_id`). 사람 계정끼리는 여전히 Link 다.

## 표현 등급

**저장과 표현은 다른 문제다.** 저장은 전부 편다. 접는 것은 화면에서만 한다.

한 번의 행위가 관계 여럿을 만든다. GitHub App 하나를 설치하면 이만큼 나온다.

```
registered_in       AppInstallation → Organization      설치됐다
registered_by       GitHubApp       → UserAccount       누가 등록했다
acts_as             AppInstallation → bot Principal     이 신분으로 행동한다
has_role            AppInstallation → permissions       이 권한을 받았다
permits             permissions     → Repository        그 권한이 여기에 닿는다
authenticates_with  AppInstallation → Credential        이걸로 인증한다
contained_in        AppInstallation → Organization      여기 산다
```

일곱 행을 하나로 합치지 않는다. **수명이 다르다** — 권한이 바뀌어도 설치는 남고, 등록한 사람이 퇴사해도 앱은 돈다. **출처가 다르다** — `produced_by`가 전부 다른 엔드포인트라 권한 조회만 실패해도 나머지 여섯은 살아야 한다. **되돌릴 수 없다** — 펴놓은 것은 언제든 접지만 접어서 저장한 것은 못 편다. 그룹 멤버를 미리 펼치지 않는 것과 같은 방향의 판단이다.

대신 화면이 산발적으로 보이는 문제를 여기서 푼다.

### 왜 산발적으로 보이는가

관계가 많아서가 아니라 **배선이 섞여 있기 때문이다.**

Slack 실측이다. 저장된 관계 **190행**을 등급별로 나눈 것이다(2026-09-27 에 189 → 190. `fixtures/slack/README.md` 「기준선 이력」).

| 등급 | 건수 | 비율 | 내역 |
| --- | --- | --- | --- |
| 구조 | 40 | 21% | contained_in 40 |
| 접근 | 99 | 52% | has_role_on 52, member_of 47 |
| 신뢰 | 51 | 27% | shared_with 30, authenticates_with 19, runs_as 1, triggered_by 1 |

**v1.3이 적었던 82%는 이 수치가 아니다.** 그건 Okta·GitHub **Profile 참조 목록**을 센 것이고 이건 실제로 만들어진 **관계 행**을 센 것이다. 참조는 아직 관계가 아니다 — `relation_type: null`도 `no_relation`도 참조에는 있고 관계에는 없다.

v1.3의 그 수치는 분모가 일정하지 않아 쓰지 않는다. 198/270은 73%이고 82%는 198/241이다. 270과 241 사이에서 29건이 설명 없이 사라지고, 226행은 원래 Slack 수집 숫자라 Okta·GitHub 집계와 섞여 있다. **해당 데이터로 다시 세야 한다.**

### `contained_in`은 기본으로 접는다

**접어도 정보 손실이 없다.** 같은 값이 Object의 `scope`와 `references.parent`에 이미 있다. 화면에서 빼도 아무것도 사라지지 않고, 노드를 중첩해서 그리면(조직 상자 안에 저장소 상자) 오히려 더 잘 보인다.

Slack 실측 기준으로 190행이 **150행**이 된다.

**`owned_by`는 접지 않는다.** 접어도 되는 근거가 `contained_in`에만 해당하기 때문이다. `owned_by`에는 Object 쪽 중복이 없고, 이 문서가 아래에서 "역할 배정 테이블에는 안 나타나는데 권한은 있다"고 쓰는 바로 그 사실이다. 접으면 퇴사자가 아직 무엇을 소유하고 있는지가 기본 화면에서 사라진다.

### 등급

| 등급 | perspective | relation_type | Slack 실측 | 기본 |
| --- | --- | --- | --- | --- |
| **구조** | `Structure` | contained_in | 40 | 접힘 |
| **접근** | `Authority` | has_role_on, permits, member_of, owned_by, applies_to, excludes, evaluates | 98 | 펼침 |
| **신뢰** | `Trust` | authenticates_with, runs_as, triggered_by, acts_as, trusts, registered_in, registered_by, receives_into, shared_with | 51 | 펼침, 강조 |

`perspective`는 화면에서 이 등급을 부르는 이름이다. **등급과 1:1이라 구현이 매핑을 따로 만들 필요가 없다.** 이 표가 정본이고, 구현이 이 표와 어긋나면 표가 맞다.

**등급은 행에 저장하지 않는다.** `relation_type`당 한 번 정하는 조회표이고 이 절이 그 표다. 그래서 등급을 고쳐도 저장된 행은 그대로다. `relation_type`을 Object가 아니라 Profile에 둔 것과 같은 이유다 — **우리가 계속 바꿀 값은 데이터에 박지 않는다.**

등급은 `template`과 달리 **행을 검사하지 않는다.** 틀려도 행이 잘못되지 않고 화면만 달라진다. 다만 **표 자체는 검사한다** — 어휘 17종이 전부 배정됐는지, 폐기된 이름이 남았는지, 구조 등급이 구조 층과 같은지. 배정을 빠뜨리면 그 관계가 어느 perspective에도 안 걸려 **화면에서 조용히 사라지는데**, 행은 멀쩡히 만들어지고 다른 검사도 전부 통과해서 잡을 방법이 없었다. `validation/check_power.py`가 그걸 본다.

#### `신뢰`를 `Authority`에 합치지 않는다

부여 층 16종을 한 화면에 다 펼치면 산발적으로 보인다. 그래서 둘로 갈랐는데, 다시 합치자는 말이 나올 자리라 근거를 적어 둔다.

```
접근   "누가 무엇을 할 수 있나"        has_role_on, permits, member_of …
신뢰   "이 신원이 무엇으로 성립하나"    authenticates_with, runs_as, trusts …
```

**묻는 사람이 다르다.** `has_role_on`(이 사람이 이 채널에서 뭘 할 수 있나)과 `authenticates_with`(이 앱이 뭘로 인증하나)는 같이 볼 이유가 없다. 그리고 `trusts`나 `registered_in`은 권한을 **주는** 사실이 아니라 권한이 **성립하는 바탕**이다.

기본 표시도 다르다 — 접근은 `펼침`이고 신뢰는 `펼침, 강조`다. 합치면 그 강조가 갈 곳이 없다.

분량도 근거가 된다. Slack 실측에서 신뢰가 51행(27%)이다. 접근 98행에 섞으면 149행 한 덩어리가 되어 **가른 의미가 없어진다.**

`구조`만 `접힘`인 것도 그대로다. 같은 값이 Object의 `scope`와 `references.parent`에 이미 있어서 접어도 손실이 없기 때문이고, 그 근거는 `contained_in`에만 해당한다.

### 화면이 구분해야 하는 「모름」

등급이 **무엇을 보여줄까**를 정한다면 이건 **무엇을 모르는지 어떻게 보여줄까**다. 모름의 표기가 세 문서에 흩어져 있어서 여기 모은다. 이 표는 어휘를 새로 만들지 않는다 — **이미 있는 값을 화면 기준으로 묶기만 한다.**

| 표기 | 정의 | 뜻 | 나중에 풀리나 | 화면에서 |
| --- | --- | --- | --- | --- |
| `relation_type` 키 없음 | Relation | 아직 안 봤다 | 봐야 한다 | 간선 없음 · 작업 남음 |
| `relation_type: null` | Relation | 봤는데 어휘에 자리가 없다 | 어휘가 늘면 풀린다 | 간선 없음 · 승격 대기열 |
| `relation_type: no_relation` | Relation | 관계가 아니라고 판정했다 | **안 바뀐다** | 간선 없음 · 다시 묻지 않는다 |
| `status: inferred` | Object | 대상 종류·의미를 추론했다 | 근거를 찾으면 확정 | 간선을 그리되 추론 표시 |
| `unresolved_reason: unknown_prefix` | Object | 값은 있는데 종류를 못 정했다 | 해석 규칙을 더하면 | 한쪽 끝이 열린 간선 |
| `unresolved_reason: needs_parser` | Object | 파서가 있어야 한다 | 파서를 만들면 | 한쪽 끝이 열린 간선 |
| `unresolved_reason: outside_scope` | Object | 대상이 수집 범위 밖이다 | 범위를 넓히면 | 끝이 모델 밖 |
| `unresolved_reason: value_not_returned` | Object | 벤더가 값을 안 준다 | **안 풀린다** | 한쪽 끝이 열린 간선 · **재시도 금지** |
| `confidence: inferred` | Profile | Profile 자체가 추론이다 | 실 응답을 보면 | 그 Profile에서 나온 전부에 표시 |
| `enumerable: required_params` | Profile | 파라미터를 순회해야 전수다 | 순회를 다 하면 전수 | 순회를 마쳤으면 "없음"을 쓸 수 있다 |
| `enumerable: parent_fanout` | Profile | 부모마다 따로 불러야 전수다 | 부모 목록이 완전하면 전수 | 부모 사슬이 끊기면 통째로 빠진다 |
| `enumerable: caller_dependent` | Profile | 부르는 주체에 따라 결과가 다르다 | **안 풀린다** | 토큰을 바꾸면 답이 달라진다 |
| `enumerable: none` | Profile | 목록 API가 없다 | **안 풀린다** | **"없음"을 결론으로 못 쓴다** |
| `completeness: provider_partial` | Profile | 권한은 실재하는데 행이 어디에도 없다 | **안 풀린다** | **"없음"을 결론으로 못 쓴다** |
| `completeness: not_collectable` | Profile | 식별자를 못 만들어 행을 안 만든다 | — | 노드 자체가 없다 |

`enumerable` 넷을 "`full`이 아님" 하나로 묶지 않은 이유가 있다. **`required_params`는 순회를 마치면 전수이고 `none`은 영원히 전수가 아니다.** 묶으면 둘이 같아 보이는데, 앞은 "없음"을 결론으로 쓸 수 있고 뒤는 절대 못 쓴다. `parent_fanout`은 또 다르다 — 부모 사슬이 한 군데만 끊겨도 그 아래가 **통째로** 빠지는데 화면에는 빈칸으로 보인다.

열다섯이지만 화면이 다르게 해야 할 일은 셋이다.

```
1. 간선이 없는데 이유가 다르다        relation_type 세 상태
2. 간선은 있는데 끝이 안 닫혔다       unresolved_reason 넷 + status: inferred
3. 안 나온 것이 없는 것이 아니다      enumerable · completeness · confidence
```

**셋째가 제일 위험하다.** 앞의 둘은 화면에 뭔가 이상한 게 보이지만 셋째는 **아무것도 안 보이는 것이 정상처럼 보인다.** Slack `usergroups.list`가 그 예다 — 에러가 아니라 `ok=true`에 빈 목록으로 오기 때문에 수집기가 성공으로 기록한다. 이걸 표시 안 하면 "자격증명 없는 통합"이나 "MFA 안 쓰는 계정" 같은 질의가 **조용히 거짓을 답한다.**

그래서 셋을 한 색으로 뭉개면 안 된다. 특히 `value_not_returned`와 `unknown_prefix`는 생김새가 같지만 **하나는 재시도 대상이고 하나는 영구 포기**다. `no_relation`과 `relation_type: null`도 마찬가지로, 섞으면 미결 목록이 영영 안 줄어든다.

표에 적은 값이 원본 enum과 어긋나는지는 `validation/check_seams.py`가 본다. 새 `unresolved_reason`이 생겼는데 이 표에 안 들어오면 **화면이 그 상태를 조용히 빠뜨리게 되므로** 검사가 잡는다.

### 한 행위를 묶는 id는 두지 않는다

일곱 행이 한 번의 설치에서 나왔다는 표시를 넣고 싶어지지만, **응답에 그런 id가 없다.** 대부분의 관계는 감사 로그가 아니라 상태 조회 API에서 나오고 거기엔 행위 표시가 없다. 만들면 우리가 지어내는 값이 된다.

필요도 없다. 위 일곱 행이 전부 `AppInstallation`이라는 **Object 하나를 지난다.** 그 Object를 중심으로 조회하면 묶음이 그대로 나온다. 조인 키는 이미 있다.

## template

양끝을 `object_type`이 아니라 **interface로 선언한다.** 그래야 provider가 늘어나도 같은 규칙이 성립한다. `Principal --> Policy`라고 쓰면 Slack의 사용자든 Okta의 그룹이든 GitHub의 팀이든 같은 규칙이 적용된다.

3항은 가운데에 대괄호로 쓴다.

```
Principal --[Policy]--> Resource
```

### `Assignment`는 어떤 template의 끝점도 아니다 — 의도다

9종을 template 끝점으로 세면 이렇게 나온다.

```
Tenant       source  1  target  8        Policy       source  5  target  2  role 1
Principal    source  4  target  8        Endpoint     source  3  target  1
Integration  source  5  target  5        Resource     source  2  target  6
Credential   source  3  target  3        Automation   source  3  target  1
Assignment   source  0  target  0   <-
```

**`Assignment`만 0이다.** 구멍이 아니라 이 interface의 정의 자체다.

`Assignment`는 **주체와 권한을 잇는 배정**이고, 그 배정이 곧 관계 한 행이다. `Profile_Schema`의 「Assignment인 object_type」이 그 변환을 적는다 — `interfaces`에 `Assignment`가 있으면 Object 하나가 관계 하나가 되고, 참조 항목은 `slot: source | role | target`으로 그 관계의 자리를 채운다.

즉 Assignment Object는 **관계의 끝점이 아니라 관계 자신**이다. 끝점이 되면 "배정에 배정을 준다"가 되어 문장이 성립하지 않는다. v1.2 검증에서 남은 끝점 위반 5건 중 3건이 `ApplicationGrant`였던 것이 같은 이야기다.

**대신 구멍이 하나 생긴다.** Assignment Object가 자기 자신에 대해 갖는 참조 — `RepositoryInvitation.inviter`처럼 "누가 이 배정을 만들었나" — 는 `slot` 셋 어디에도 안 들어가고 끝점도 못 되므로 **어느 관계로도 안 남는다.**

관계로는 남기지 않는다. 같은 문서가 `owned_by`의 출발점을 다시 좁히면서 `inviter`·`dismissed_by`·`added_by`를 전부 탈락시켰다 — 한 행위의 기록이지 소유가 아니다. 이 판단은 그대로다.

**다만 손실은 아니다(2026-11-11 고침).** 예전에는 「행위 기록은 Object의 `properties`에 남는다」고 하고 끝냈다. 11-04 운영 로그를 대 보니 관계를 만든·바꾼 사건이 284종 3,903건이었고, SaaS 6개 모두에서 그 사건이 갈 곳이 없었다. 이제 행위는 사건 기록 [Activity](Activity_Schema_v1.md)로 남고, 그 사건이 만든 관계 행의 **`provenance`**(`granted_by`, `granted_at`, `evidence`)가 그것을 가리킨다. 행위 기록은 관계가 아니라 **관계의 출처**다. 칸 정의는 [Activity_Usage_v1](Activity_Usage_v1.md) 「관계 행에 붙는 칸」.

검사는 `validation/check_power.py`가 한다. `Assignment` 말고 다른 종이 0이 되면 그건 진짜 구멍이다.

---

## references

`source`와 `target`은 필수다. `role`은 template이 3항일 때만 있다.

각 슬롯은 `provider`를 가질 수 있다. **다른 SaaS를 가리킬 때만 적고, 생략하면 행의 `provider`다.**

```yaml
source:
  object_type: group          # provider 생략 = okta
  value: 00g1x9zPQ
target:
  provider: slack             # 다른 SaaS
  object_type: app
  value: B0BUJ7984P7
```

`provider`를 못 푸는 경우도 있다. 값이 어느 SaaS 것인지 모를 때다. 그때는 `status: unresolved`, `unresolved_reason: unknown_prefix`이고 **관계는 만든다.**

### 다형 참조

필드 이름만으로는 대상 종류를 알 수 없는 경우가 있다. Slack 역할 배정 응답이 그렇다.

```json
{ "role_id": "Rl0A", "entity_id": "C0C0PGN5TGV", "user_id": "U0BTRNDU62F" }
```

실측 27건 중 채널이 23건, 엔터프라이즈가 4건이었다. 접두사로 판정한다. 실패하면 이렇게 남긴다.

```yaml
target:
  object_type: null
  value: Xj93kdMM
  kind: unknown_id
  status: unresolved
  unresolved_reason: unknown_prefix
```

**포인터가 있다는 사실은 남는다.** 해석 규칙을 나중에 추가하면 이 행이 살아난다.

`unresolved_reason`은 네 값뿐이고 정의는 `Object_Schema_v4.1.md`에 있다. `unknown_prefix`(종류를 못 정함), `value_not_returned`(벤더가 값을 안 줌), `needs_parser`(파서가 필요함), `outside_scope`(모델 밖). **이 구분이 재시도할 것과 포기할 것을 가른다.**

### 값을 못 읽는 관계

위는 값은 있고 종류를 모르는 경우다. 반대도 있다. **종류는 확실한데 벤더가 값을 안 준다.**

Salesforce `consumerSecret`이 그렇다. 문서 표현으로 "설정되어 있을 때 그 값은 Metadata API 응답에 돌아오지 않는다". Okta 앱 키도 같다.

```yaml
target:
  object_type: credential
  value: null
  kind: direct_id
  status: unresolved
  unresolved_reason: value_not_returned
```

**관계는 만든다.** "자격증명이 있다"는 사실 자체가 보안 질의의 답이기 때문이다. 안 만들면 "시크릿 없는 웹훅"을 물을 때 조용히 거짓을 답한다.

`value_not_returned`는 **수집 실패가 아니다.** 다시 불러도 안 나온다. 재시도 대상에서 뺀다.

**깃허브 웹훅 `config.secret`은 이 예에서 뺐다.** 한동안 "쓰기 전용이라 안 나온다"고 적어 뒀는데 공식 문서에 **가려진다는 문장이 없다.** 오히려 응답 스키마 표에 문자열 속성으로 실려 있다. `********`가 나오는 곳은 조직 웹훅 **요청** 예시 하나뿐이고 응답 예시가 아니다. 근거를 못 대면 예로 쓰지 않는다.

### 이름으로 가리키는 쪽이 섞이는 문제

같은 사실이 어떤 엔드포인트에서는 id로, 다른 엔드포인트에서는 이름으로 온다.

GitHub 감사 로그는 저장소를 `repo`/`repository` **이름 문자열**로만 담는다. 저장소 id가 없다. Snowflake 역시 `SHOW GRANTS`와 `GRANTS_TO_ROLES` 모두 대상 객체를 **이름으로만** 주고, `TABLE_ID`가 있는 `ACCOUNT_USAGE.TABLES`와 직접 이어지지 않는다.

`value`가 이름이면 `kind: name_key`로 표시하고, 같은 사실의 id 기반 행과 **별개 행이 된다.** 합치는 건 이름→id 해석이 가능해진 뒤에 한다. 이름은 재사용되므로 자동으로 합치면 안 된다.

수집 경로를 고를 수 있으면 **id를 주는 쪽을 쓴다.**

---

## properties

**양끝 어느 쪽에도 둘 수 없는 사실**이 들어간다.

같은 사용자를 여러 워크스페이스에서 관측하면 `is_owner`, `is_admin`, `team_id`가 서로 다르게 나온다. 수집 오류가 아니라 워크스페이스마다 값이 실제로 다르다. 어느 쪽을 버려도 거짓이라 Object에 둘 수 없다.

실측에서 83개 Object 중 79개가 둘 이상의 응답에 나타났고, 값이 충돌한 필드는 **전부** 이런 테넌트 상대적 필드였다. 나머지 필드는 충돌이 한 건도 없었다.

| 필드 | 붙는 관계 | 이유 |
| --- | --- | --- |
| is_owner, is_admin, is_primary_owner | member_of | 워크스페이스마다 다르다 |
| granted_at, expires_at | has_role_on | 부여 시각은 주체 것도 대상 것도 아니다 |
| applies_to_descendants | permits | 아직 없는 하위 항목까지 적용되는지. 역할의 성질도 자원의 성질도 아니고 부여 행위의 성질이다 |
| row_cause | has_role_on | 왜 이 권한이 생겼는지. 아래 참조 |
| inherited, inh_count | has_role_on | 상속으로 생긴 것인지 |
| lifecycle | 전부 | revocable, immutable, inherited |
| basis | 전부 | 벤더가 준 부여 기록인지 계산한 결과인지 |
| binding | applies_to, excludes | 명시적으로 지정됐는지 범위로 걸리는지 |

### 벤더가 합쳐 버리는 경우

Salesforce는 한 사용자가 여러 경로로 같은 레코드에 접근하면 **공유 항목을 하나로 압축한다.** 문서 표현으로는 "가장 높은 접근 수준 하나의 레코드로 압축된다". 그래서 `row_cause`가 하나만 보인다고 다른 경로가 없는 것이 아니다.

더 나아가 "sharing set 같은 일부 공유 메커니즘은 공유 항목이 **아예 저장되지 않는다**". 권한은 실재하는데 행이 없다. 이런 종류는 Profile에서 `completeness: provider_partial`로 표시하고, 그 사실을 바탕으로 한 질의는 "없음"을 결론으로 쓰지 않는다.

### 벤더가 쪼개 버리는 경우

반대도 있다. ServiceNow는 상속된 역할을 **개별 행으로** 넣는다. 문서 표현으로는 "다른 역할에서 상속된 역할이 개별 항목으로 추가되어 한 역할에 중복 항목이 생길 수 있다". Role Management V2를 켜면 한 번만 상속되고 읽기 전용 `inh_count`가 붙는다.

즉 **같은 (user, role)의 행 수가 플러그인 설정에 따라 달라진다.** 우리 동일성 기준으로는 한 행으로 모이는 게 맞고, 상속 횟수는 `inh_count`로 남긴다.

### basis — 준 값인가 계산한 값인가

같은 `relation_type`이라도 어떤 provider는 부여 기록을 그대로 주고 어떤 provider는 여러 경로를 합쳐 낸 결과만 준다. 필드 모양이 같아서 행만 보면 구분되지 않는다.

| 값 | 뜻 | 예 |
| --- | --- | --- |
| `stated` | 벤더가 부여 기록을 그대로 준다 | Snowflake `GRANTS_TO_ROLES`, Entra `roleAssignment` |
| `computed` | 벤더가 여러 경로를 합쳐 낸 결과다 | GitHub 협업자의 `role_name` |
| `flag` | 속성 불리언에서 유도했다 | Slack `is_owner` |

GitHub 협업자 응답이 이 값을 정확히 설명한다. 문서 표현으로 **`role_name`은 "모든 부여 출처를 고려한 뒤 협업자에게 배정된 가장 높은 역할"** 이고 그 출처는 "저장소, 팀, 조직, 엔터프라이즈" 넷이다. 같은 응답의 `permissions` 해시는 "협업자의 기본 역할 권한"이라고 따로 적힌 **다른 값**이다.

결정적인 문장은 따로 있다.

> "현재 이 엔드포인트 응답만으로는 조직 수준 부여와 저장소 수준 부여를 구분할 방법이 없다"

**벤더가 직접 못 구분한다고 적었다.**

**`computed` 행은 직접 회수할 수 없다.** "이 권한을 없애려면 무엇을 지워야 하나"를 물으면 `stated` 행에는 답이 있고 `computed` 행에는 없다. 구분이 없으면 질의가 없는 답을 있다고 한다.

**기본값이 없다. 생략하면 lint 오류다.** 예전에는 "안 적으면 `stated`"였는데, 합칠 때 `stated`가 이기므로 **빠뜨린 행이 자동으로 최우선이 되어** 근거 없이 회수 가능한 기록이 있다고 주장하게 됐다.

합칠 때는 `stated > computed > flag` 순으로 이긴다. 한 경로에서라도 부여 기록을 찾았으면 "무엇을 지워야 하나"에 답이 있기 때문이다. 반대로 근거가 `flag`뿐인데 `stated`로 적으면 없는 부여 기록을 찾으라고 시킨다. 그래서 우선순위이지 덮어쓰기가 아니다.

동일성 튜플에는 들어가지 않는다. 같은 사실의 성질이지 다른 사실이 아니다.

**`logged` 는 아직 값이 아니다.** 스냅샷에 없고 사건으로만 아는 관계(설치자, SSO 신뢰, 기간 안에 생겼다 사라진 부여, 권한 목록 API 가 없는 SaaS)는 `basis: logged` 와 관측 창(`observed_window`)으로 만들기로 했다. 만드는 것은 3단계이고 그때까지 lint 는 세 값만 받는다. 「로그에 없음」은 「권한 없음」이 아니다 — [Activity_Usage_v1](Activity_Usage_v1.md) 「원칙」.

---

## source

```yaml
source:
  api: GET /api/admin.roles.listAssignments
  params: {}
  record: role_assignments[]
  schema_version: 1
  collected_at: 2026-09-10T16:21:53Z
  first_seen_at: 2026-08-01T09:00:00Z
  last_seen_at: 2026-09-10T16:21:53Z
  produced_by:
    - slack.user.teams
    - slack.user.queried_team
```

### 시간과 삭제 표식

미리 만든 행으로 **"지난주 대비 무엇이 사라졌나"**에 답하려면 세 가지가 더 필요하다.

```yaml
source:
  schema_version: 1
  view_version: 3                    # 이 행을 만든 어휘·매핑의 판
  first_seen_at: 2026-08-01T09:00:00Z
  last_seen_at:  2026-09-21T10:00:00Z
  removed_at:    null                # 사라진 것이 확인된 시각
  produced_by: [...]
```

**`removed_at`이 삭제 표식이다.** 행을 지우지 않는다. 지우면 "없어졌다"를 표현할 대상이 사라진다.

**`view_version`이 없으면 diff가 조용히 틀린다.** 두 시점 사이에 우리 어휘가 바뀌었으면, diff가 "권한이 바뀐 것"과 "우리가 분류를 바꾼 것"을 구분하지 못한다. 그래서 **diff는 같은 `view_version`끼리만 돈다.** 다르면 양쪽을 같은 판으로 다시 만든 뒤 비교한다.

이건 성능이 아니라 **정확성** 문제다. Zanzibar의 Leopard 인덱스도 같은 이유로 오프라인 인덱스에 timestamp와 삭제 표식을 단 증분 층을 얹는다.

### 소스별 신선도

`ACCOUNT_USAGE` 뷰는 최대 **120분** 늦고 `ORGANIZATION_USAGE.ACCOUNTS`는 **24시간** 늦는다. Microsoft Graph의 advanced query는 인덱스가 최신이 아닐 수 있다고 문서가 적는다.

```yaml
produced_by:
  - { path: snowflake.grant.(assignment), lag: PT2H }
```

**같은 시점에 두 소스가 다른 답을 주는 것이 정상인 경우가 있다.** 안 적으면 그걸 변경으로 오해한다.

---

`schema_version`은 이 행을 만든 명세가 몇 번째 판이었는지고, 올리는 기준은 `Object_Schema_v4.1.md`의 "명세 버전" 절에 있다.

**Relation 행과 Object 행의 번호는 따로 간다.** Object는 행의 단위가 관측에서 대상으로 바뀌어 2가 됐고, Relation 행의 모양은 그대로라 1이다. 그래서 번호를 행 안에 적는다. 파일 이름의 v2는 문서 묶음의 번호이고, 행의 `schema_version`과 다른 값일 수 있다.

`params`를 기록하는 이유는 Object와 같다. 응답의 모양이 파라미터에 따라 달라지므로, 대조 기준은 "그 API"가 아니라 **"기록된 그 요청"**이다.

`produced_by`는 **목록이다.** 값은 `<provider>.<object_type>.<references 항목 이름>` 꼴로, 이 행을 만든 Profile 참조를 가리킨다. 서로 다른 Profile 항목이 같은 사실을 만들어낼 수 있다.

실측이 그랬다. SCIM `Groups`의 `members[]`와 SCIM `Users`의 `groups[]`가 같은 3건을 만들었고, `users.list` r0와 r1이 같은 소속을 두 번 만들었다. 226행 중 23행이 이렇게 합쳐졌다.

관계의 정체성은 어느 Profile 항목이 만들었는지가 아니라 `references`가 결정한다.

**사라졌다는 판단은 그 행을 만든 Profile의 `role: primary`인 엔드포인트가 `collect.listable: true`일 때만 허용한다.** `enrichment`와 `detail`에는 안 건다 — 그쪽은 명부가 아니라서 안 나오는 것이 정상이다. 목록 조회가 되는데 이번 수집에 안 나왔으면 회수된 것이다. `listable`은 object_type의 성질이 아니라 **어느 엔드포인트로 물었느냐의 성질**이므로, Profile이 그 엔드포인트를 고른 결과를 본다. 판정 근거와 함정은 `Profile_Schema_v4.2.md`의 `listable` 절에 있다.

---

## 같은 사실인지 판단하기

```
(relation_type,
 source.provider, source.object_type, source.value, source.scope,
 role.provider,   role.object_type,   role.value,
 target.provider, target.object_type, target.value, target.scope)
```

**`provider`가 행 전체에서 양끝으로 내려왔다.** 한 행이 두 SaaS를 이을 수 있기 때문이다. 슬롯의 `provider`를 생략하면 행의 `provider`를 쓴다.

행 머리의 `provider`는 남지만 뜻이 바뀐다. **소유자가 아니라 이 사실을 관측한 쪽이다.** Slack 응답이 알려준 연결은 반대편이 GitHub이어도 `provider: slack`이다. GitHub에 물어 같은 사실을 얻으면 그것은 **별개 관측**이고, 양끝이 같으므로 동일성 튜플이 한 행으로 합치며 `produced_by`에 둘 다 남는다.

**옛 행을 고칠 필요는 없다.** 슬롯 `provider`는 생략 가능하고 생략의 뜻이 지금까지의 동작과 같다. `schema_version`은 그대로 1이다.

3항이 아니면 `role` 자리는 비운다. `scope`는 대상이 부모 스코프 자식일 때만 쓴다.

`properties{}`는 여기 안 들어간다. 부여 시각이나 만료가 바뀌었다고 다른 사실이 되는 것이 아니라 같은 사실의 상태가 변한 것이다.

### 벤더 id를 키로 쓰지 않는 이유

배정에 자체 id가 있어도 쓰지 않는다. **그 id가 사실보다 수명이 짧은 경우가 있다.**

Google Workspace `roleAssignments`는 수정 메서드가 없다. `insert`, `delete`, `get`, `list`뿐이라 조건이나 범위를 바꾸려면 지우고 다시 만들어야 하고 그때마다 `roleAssignmentId`가 바뀐다. Salesforce `PermissionSetAssignment`도 문서가 "수정하려면 기존 배정을 지우고 새로 넣어라"라고 안내한다. Salesforce `SetupEntityAccess`는 `update()` 자체가 없다.

권한 사실은 그대로인데 벤더 id만 바뀌는 것이다. 튜플로 키를 잡으면 그 변화에 흔들리지 않는다.

반대로 id가 **이 객체의 것이 아닌** 경우도 있다. Okta `AppUser.id`는 사용자의 id고 `ApplicationGroupAssignment.id`는 그룹의 id다. 리소스셋 바인딩의 `id`는 역할의 id다. 그대로 받으면 서로 다른 배정이 한 행으로 합쳐진다.

---

## 헷갈리는 이름들

읽다 막히는 자리가 몇 군데 있어서 정리한다.

### 바꾼 것

| 예전 | 지금 | 왜 |
| --- | --- | --- |
| `lifecycle: derived` | `lifecycle: inherited` | 그때 Object 쪽 키도 `derived{}`여서 같은 단어가 두 뜻으로 쓰였다. 저쪽은 "우리가 판정한 값"이고 이쪽은 "상속으로 따라온 권한"이다 |
| `class` | `extraction` | 무엇의 class인지 이름만 봐서는 안 보였다. 응답의 어디서 건져냈는지를 뜻한다 |
| `request_scope` | `request_param` | 값이 요청 파라미터에서 온다는 게 이름에 드러나게 했다 |
| `fanout: true` | `per_item: true` | fanout은 엔지니어끼리 쓰는 말이다 |
| `expect: { coverage: … }` | `coverage: …` | 한 겹 더 감싸도 뜻이 안 늘었다 |
| `all_matching_rows` | `matching_rows` | all이 군더더기였다 |
| `enumerable` | `listable` | 목록 조회가 되느냐는 뜻인데 이름이 그걸 안 보여줬다 |
| `vendor_partial` | `provider_partial` | 다른 데서는 전부 provider라고 쓰는데 여기만 vendor였다 |
| `kind: opaque` | `kind: unknown_id` | 나머지 `kind` 값은 전부 "무엇인지"를 말하는데 이것만 형용사였다 |
| `derived{}` | `judged{}` | 어디서 유도됐는지만 보이고 **누가** 판정했는지가 안 보였다. 벤더가 준 값이 아니라 우리 규칙이 내린 판정이다 |
| `approved_with_scope` | (삭제) | 테넌트 끝점이 실재하지 않았다. `has_role_on`의 Integration 대상으로 흡수 |
| `sends_to` | (삭제) | 한쪽 끝이 Object가 아니었다. `kind: external_locator`로만 남긴다 |
| 「추출 규칙」 절 | (삭제) | 매핑을 Profile이 쥐게 되면서 죽은 절이 됐다. `extraction`, `class`, `coverage`, `derive:` 표기가 여기 있었다 |

### 남긴 것과 그 이유

**`template`** — 양끝이 어떤 interface여야 하는지를 적은 틀이다. 채워 넣는 서식이 아니라 **지켜야 할 모양**이라는 뜻으로 읽으면 된다.

**`@resolve`** — 값을 보기 전에는 대상 종류를 못 정한다는 표시다. `@`를 붙인 건 이 자리에 들어갈 진짜 `object_type`이 아니라 **판정을 미루라는 지시**이기 때문이다. Object, Profile, Relation 세 곳이 같은 표기를 쓴다.

**`row_cause`, `inh_count`** — 각각 Salesforce와 ServiceNow가 쓰는 이름 그대로다. 우리가 고치면 벤더 문서와 대조가 안 된다.

**`id_and_name`** — 벤더가 id와 이름을 **둘 다** 주는 경우다. Entra가 그렇다. `roleDefinitionId`가 GUID이고 빌트인 역할의 GUID는 공표된 상수다(Global Administrator `62e90394-69f5-4237-9190-012177145e10`). 이때는 이름 기반 행과 id 기반 행을 **대조할 수 있다.**

Slack과 Snowflake는 못 한다. Slack은 역할 이름을 어디에도 안 주고, Snowflake 권한은 문자열뿐이다. **`name_key`와 `direct_id`가 별개 행으로 남는 것은 provider의 성질이지 우리 선택이 아니다.**

**`name_key`, `direct_id`** — 이름으로 가리키느냐 식별자로 가리키느냐다. Object의 `references.kind`와 같은 어휘라 여기만 바꿀 수 없다.

---

## 이 파일이 지켜야 할 것

모양에 관한 것만 여기 둔다.

- `references.role`은 template이 3항일 때만 있다
- 슬롯의 `provider`는 행의 `provider`와 다를 때만 있다. 같은 값을 적으면 오류다
- 양끝 `provider`가 다른 행은 그 사실을 관측한 쪽이 행의 `provider`다
- `references`의 모든 항목이 `object_type`, `value`, `kind`, `status`를 갖는다
- `object_type`이 `null`이면 `status`는 `unresolved`다
- `relation_type`은 위 17개 안의 값이다. 부여 층 16종 + 구조 층 1종
- `has_role_on`의 Policy는 언제나 `role` 슬롯에 있다. `target`은 범위다
- `contained_in`의 target은 source Object의 `scope` 또는 `references.parent`에 실재한다
- `contained_in`은 template의 interface 검사(L1)에서 뺀다. `any --> any`라 거부력이 0이 된다
- `Assignment`는 어떤 template의 끝점도 아니다. 나머지 8종은 적어도 한 자리에 쓰인다
- 부여 층과 구조 층이 같은 interface 칸을 쓰는 것은 충돌이 아니다
- `properties.basis`는 `stated`, `computed`, `flag` 중 하나이고 생략할 수 없다
- `validity.effect`는 `active`, `eligible`, `expired` 중 하나다. 생략하면 `active`다
- `target.kind`는 `node` 또는 `set`이다. 생략하면 `node`다. `set`이면 `set` 이름이 있다
- `qualifiers`는 동일성 튜플에 들어가지 않는다
- `properties.decomposable`이 `false`면 `undecomposed`가 비어 있지 않다
- `source.view_version`이 있다. diff는 같은 값끼리만 돈다
- `source.removed_at`이 있는 행은 지우지 않는다
- source의 provider와 target의 provider가 다르면, source의 interface가 Integration, Automation, Credential, Endpoint 중 하나이고 `basis`가 `stated`다
- source의 interface가 Principal인데 target의 provider가 다르면 오류다
- `status`가 `unresolved`이면 `unresolved_reason`이 있고 네 값 중 하나다
- `value`가 `null`이면 `status`는 `unresolved`이고 이유는 `value_not_returned`다
- `source.produced_by`의 모든 값이 실재하는 Profile 참조 항목을 가리킨다
- `source.schema_version`이 있고, 이 파일 이름의 버전과 같다
- `identifiers.primary`가 빈 Policy는 `applies_to`를 `binding: ambient`로 만들고 `contained_in`을 만들지 않는다
- `kind`가 `external_locator` 또는 `expression`이면 관계를 만들지 않는다. 이 값들은 Object의 `references`에만 존재한다

`unknown_id`는 위 목록에 **없다.** 대상 종류를 못 정한 것뿐이고 포인터는 실재하므로 행을 만든다. `object_type: null` + `status: unresolved`로 남기고, 나중에 해석 규칙이 생기면 그 행이 살아난다. `external_locator`와 `expression`은 다르다 — 앞은 대상이 모델 밖이고 뒤는 파서가 있어야 풀린다.

### interface 검사

`source`와 `target`의 `object_type`이 template이 요구하는 interface를 구현하는지 검사한다. 판정 근거는 `Interface_Spec_v3.md`에 있다.

#### `contained_in`은 이 검사에서 뺀다

`contained_in: any --> any`가 81칸을 전부 덮으므로, **어휘에 넣어 둔 채로 두면 이 검사의 거부력이 0이 된다.** 어떤 (source, target) 조합을 넣어도 `contained_in` 후보가 남아 통과한다.

81칸 전수로 재면 이렇다.

| | 거부 가능(후보 0종) | 유일 결정 | 모호(2종+) |
| --- | --- | --- | --- |
| 지금 | **0** | 45 | 36 |
| `contained_in`을 이 검사에서 뺀다 | **45** | 20 | 16 |

`triggered_by` 끝점 확장으로 `Automation --> Resource`가 후보 0종에서 1종으로 바뀌어 거부 가능 칸이 46 → 45로 줄었다. `Automation --> Integration`은 유일 결정에서 모호로 바뀌었다. 새 이벤트 경로를 담는 대신 L1의 거부력이 한 칸 줄어든 비용이다.

`contained_in`을 어휘에서 지우는 게 아니다. **검사 층을 나누는 것**이다.

```
L1  형태   template 의 interface 끝점 검사   <- contained_in 은 여기서 뺀다
L2  값     contained_in 의 target 이 source 의 scope 나 references.parent 에 실재하는가
L3  왕복   상대편 object_type 에 Profile 이 있는가
```

`contained_in`은 L1이 아니라 **L2가 잡는다.** 「`contained_in`에 검사를 되살렸다」 절이 그 검사를 정의했고, 그 절이 든 예 두 개가 정확히 L1이 못 잡고 L2가 잡는 것이다.

```
Organization --contained_in--> Repository    L1 통과, L2 에서 걸린다
User         --contained_in--> ApiToken      L1 통과, L2 에서 걸린다
```

**그래서 L1 단독으로는 검증이 안 된다.** L1만 돌리면 거부 가능 칸이 0이므로 아무것도 안 걸러진다. 세 층을 다 돌려야 한다.

모호 16칸 중 항수(`has_role_on`만 3항)로도 안 갈리는 것은 **8칸**이고, 전부 지금 어휘 기준 충돌 행렬에 판별 기준이 적혀 있다.

계산은 `validation/check_power.py`가 한다.

참조 항목에는 `object_type`만 있고 `interfaces`는 없으므로, **`object_type → interfaces` 표가 필요하다.** 표는 Profile이 선언한 값을 모아 만든다. 대부분은 이 표만으로 끝난다.

**행마다 interface가 갈리는 object_type은 예외다.** Datadog은 사용자 레코드의 `service_account` 불리언으로 같은 object_type 안에서 Principal 종류가 갈린다. Profile이 그런 object_type을 표시하면, 그 경우에만 대상 Object 행을 찾아 읽는다.

**`object_type`이 `null`이면 검사를 건너뛴다. 실패가 아니다.** 종류를 모르면 interface도 모르니 검사할 근거가 없다. 실패로 처리해 행을 버리면 "포인터가 있다는 사실은 남는다"가 깨진다.

### 대상 Object가 없는 관계

`relation_type`이 선언된 참조의 상대편 object_type에 **Profile이 없으면 경고한다.** 그 관계는 만들어지자마자 허공을 가리킨다.

실측에서 226행 중 26행이 그랬다. `acts_as` 19건은 출발점인 app의 Profile이 없어서 나갔고, `has_role_on` 4건은 role Profile이 없어서 도착점이 비었다. 전체의 11%다.

Object 행이 아직 안 만들어진 것과 **Profile 자체가 없는 것은 다르다.** 앞은 수집 순서 문제이고 뒤는 설계 구멍이다. 이 검사는 뒤를 잡는다.
