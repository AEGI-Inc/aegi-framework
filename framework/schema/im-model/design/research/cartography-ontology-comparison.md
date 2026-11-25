# Cartography 온톨로지와 AEGI 스키마 비교

- 작성일: 2026-10-12
- 비교 대상: Cartography 문서 [ontology](https://docs.cartography.dev/modules/ontology/index.html), [schema](https://docs.cartography.dev/modules/ontology/schema.html), [config](https://docs.cartography.dev/modules/ontology/config.html)와 코드 [`cartography-cncf/cartography@be8ff40`](https://github.com/cartography-cncf/cartography/tree/be8ff40b7dd91899a269f01cba911e7a0f56c1c6) (main, 2026-10-11)
- 우리 기준: `aegi-schema` (Object, Relation_Schema_v3, Link_Schema_v3, Effective_Access_Schema_v1, Interface_Spec_v3)

## 요약

- Cartography 온톨로지는 수십 개 provider의 노드에 같은 이름표(`UserAccount`, `APIKey` 등)를 붙이는 **넓은 정규화 층**이다. AEGI는 SaaS 4종을 대상으로 **사실(Relation), 신원 추정(Link), 계산 결론(Effective Access)을 따로 저장하는 깊은 권한 모델**이다.
- Cartography의 캐논 `User` 노드는 **id가 email 문자열**이다. 계정 연결 간선 `HAS_ACCOUNT`에는 근거나 등급이 없고, 그 위에 권한 간선(`AUTHORIZED`, `OWNS`)을 새로 만든다. AEGI Link 규격이 금지한 "추정이 권한 경로를 만드는" 구조다.
- Cartography는 관계를 따로 판정하지 않는다. 수집 코드가 API 응답에서 대상 id를 꺼내면, 적재기가 키가 같은 노드를 찾아 간선을 건다. 대상이 없으면 간선을 만들지 않고 흔적도 남기지 않는다.
- 가져올 것: 필드 정규화 처리기(`OntologyFieldMapping`), 기준 출처 지정(`eligible_for_source`), 유일 후보 매칭 규칙, `RelConstraint`와 테스트 짝, 매칭 방식 선언(`PropertyRef`).
- AEGI의 차별점: 사실, 추정, 계산의 분리, 회수 지점(`cut`) 계산, SaaS 간 위협 유형 분류, 「모름」 보존, provider 간 `stated` 관계.

## 1. 전체 비교

| 항목 | Cartography 온톨로지 | AEGI |
| --- | --- | --- |
| 범위 | 의미 이름표 45종 이상. 클라우드, k8s, 장치, 취약점, 저장소, SaaS까지 수십 개 provider | SaaS 4종(Slack, GitHub, Okta, GWS), interface 9종, 관계 어휘 17종 |
| 정규화 방식 | provider 노드에 이름표를 붙이고 필드를 `_ont_*` 속성으로 매핑 | interface는 태그이면서 지켜야 할 계약. 위반은 `validation/`이 잡음 |
| 신원 | 캐논 `User`(id = email)를 만들고 `HAS_ACCOUNT`로 연결. 확실한 간선처럼 다룸 | Link를 별도 저장소에 둠. `level`, `rule`을 남기고 전이를 막음. 질의가 명시적으로 켜야 넘어감 |
| 관계 | provider별 자유 이름. 온톨로지 쪽은 `RelConstraint` 약 30개로 이름만 검증 | 닫힌 어휘 17종. 항목마다 Slack 밖 공식 근거가 있음. 추가만 허용 |
| 결론 | 그래프 자체가 결과. 판단은 질의 작성자 몫 | Effective Access의 `via`, `cut`, `undecomposed`. 위협 유형 판정 |
| 저장소 | Neo4j | 관계 행, Link, EA를 각각 별개 저장소로 둠 |

## 2. 온톨로지 구조 (문서와 코드)

### 2.1 이름표와 추상 노드

- provider 노드에 `UserAccount`, `DNSRecord` 같은 의미 이름표를 추가로 붙인다.
- `User`, `Device`, `PublicIP`, `Package`는 별도의 추상 노드다. 여러 provider 노드를 모아 하나로 만든다.
- 이름표 목록은 `cartography/models/ontology/mapping/data/`에 파일별로 있다. 예: `useraccounts.py`, `groups.py`, `roles.py`, `apikeys.py`, `thirdpartyapps.py`, `tenants.py`.

### 2.2 필드 매핑 (`models/ontology/mapping/specs.py`)

`OntologyFieldMapping(ontology_field, node_field, required, special_handling, extra, indexed)`로 필드 하나를 매핑한다.

| 처리기 | 하는 일 |
| --- | --- |
| `invert_boolean` | 불리언을 뒤집음 |
| `to_boolean` | 값이 있으면 True |
| `or_boolean` | 여러 필드를 OR로 결합 |
| `nor_boolean` | 여러 필드를 NOR로 결합 |
| `equal_boolean` | 지정한 값과 같은지 |
| `static_value` | 고정값 |
| `mapping` | provider 값을 정규 어휘로 바꿈. **매핑에 없는 값은 NULL** |
| `coalesce` | 여러 필드 중 첫 non-null 값 |

`OntologyNodeMapping.eligible_for_source`가 False이면 그 노드는 캐논 노드를 만들 수 없고, 이미 있는 캐논 노드에 붙기만 한다. 예: AWS IAM 사용자는 email이 없어서 False다.

### 2.3 기준 출처 지정

```
cartography --selected-modules okta,duo,jamf,tailscale,ontology \
  --ontology-users-source okta,duo \
  --ontology-devices-source jamf,tailscale
```

지정한 모듈만 캐논 `User`, `Device`를 만든다. 나머지 모듈은 이미 있는 캐논 노드에 연결만 한다. 지정하지 않으면 매핑이 있는 모든 모듈이 출처가 된다(`intel/ontology/utils.py`의 `get_source_nodes_from_graph`).

### 2.4 SaaS 4종 매핑 현황

| 이름표 | Slack | GitHub | Okta | GWS |
| --- | --- | --- | --- | --- |
| UserAccount | `SlackUser` (email 선택) | `GitHubUser` | `OktaUser` | `GoogleWorkspaceUser` |
| UserGroup | `SlackGroup` | `GitHubTeam` | `OktaGroup` | `GoogleWorkspaceGroup` |
| ThirdPartyApp | `SlackBot` | `GitHubAppInstallation` | `OktaApplication` | `GoogleWorkspaceOAuthApp` |
| Tenant | `SlackTeam` | `GitHubOrganization` | `OktaOrganization` | `GoogleWorkspaceTenant` |
| APIKey | 없음 | `GitHubPersonalAccessToken` | `OktaApiToken` | 없음 |
| PermissionRole | 없음 | 확인 안 함 | `OktaUserRole`, `OktaGroupRole` | 없음 |

## 3. 신원 연결 (코드로 확인)

### 3.1 email 하나로 결정한다

- `models/ontology/user.py`: `User.id = PropertyRef("email")`. 캐논 사용자 키가 email 문자열 그 자체다.
- 같은 파일의 `UserToUserAccountRel`: `UserAccount.email`이 정확히 같을 때 `HAS_ACCOUNT`를 건다. 간선 속성은 `lastupdated` 하나다. 근거, 규칙, 신뢰 등급이 없다.
- `intel/ontology/utils.py`의 `_run_source_node_single_query`: 같은 id의 레코드를 합친다. 먼저 들어온 값이 이기고, 충돌은 debug 로그만 남는다. 값의 출처 provider는 남지 않는다.
- `normalized_email`(소문자, 공백 제거) 필드가 있지만 id와 `HAS_ACCOUNT` 매칭은 원래 값을 쓴다. 대소문자만 다른 email은 연결이 빠질 수 있다. **실제 데이터로 재현하지는 않았다.**

### 3.2 신중한 예외: GitHub SAML 연결

`analysis/ontology/analysis.py`의 `USER_HAS_GITHUB_ACCOUNT` 두 번째 문장은 다음 조건을 모두 만족할 때만 연결한다.

- SAML `name_id`의 정규화 email과 같은 User 후보가 정확히 하나 (`size(candidates) = 1`)
- 그 GitHub 사용자의 다른 email이 다른 User와 겹치지 않음

모호한 경우를 거부하는 유일한 규칙이다. 결과는 여전히 등급 없는 `HAS_ACCOUNT` 하나로 저장된다.

### 3.3 신원 연결 위에 권한 경로를 만든다

| 분석 잡 | 패턴 | 만드는 간선 |
| --- | --- | --- |
| `USER_AUTHORIZED_THIRD_PARTY_APP` | `User -HAS_ACCOUNT-> UserAccount -AUTHORIZED\|APPLICATION-> ThirdPartyApp` | `User -AUTHORIZED-> ThirdPartyApp` (scopes 복사) |
| 같은 잡 | `User -HAS_ACCOUNT-> OktaUser -MEMBER_OF-> OktaGroup -APPLICATION-> ThirdPartyApp` | `User -AUTHORIZED-> ThirdPartyApp` |
| `USER_OWNS_API_KEY` | `User -HAS_ACCOUNT-> UserAccount <-OWNED_BY- APIKey` | `User -OWNS-> APIKey` |

email 추정으로 만든 `HAS_ACCOUNT` 위에 권한 간선을 새로 만든다. 결과 간선만 봐서는 어느 구간이 추정인지 알 수 없다. AEGI Link_Schema_v3의 다음 예시와 같은 구조다.

```
okta:00u1 --same_principal--> slack:U1     email 로 추정
slack:U1  --has_role_on-->    team T1      확실
답:   00u1 은 T1 의 owner                   <- 추정이 사실처럼 나온다
```

## 4. 관계 처리 방식

### 4.1 구조

1. **관계는 노드 스키마 안에 있다** (`models/core/nodes.py`)
   - `sub_resource_relationship`: 소속 간선 하나. 보통 `RESOURCE`이고 org나 계정을 가리킨다.
   - `other_relationships`: 나머지 간선 목록.
   - 노드를 적재할 때 간선도 같이 `MERGE`된다.
2. **간선 하나는 클래스 하나다** (`models/core/relationships.py`의 `CartographyRelSchema`)
   - `rel_label`(자유 문자열), `direction`, `target_node_label`, `target_node_matcher`, `properties`를 정의한다.
3. **간선만 넣는 길도 있다** (`load_matchlinks`, `MatchLinkSubResource`). 이미 있는 두 노드 사이에 간선만 건다.
4. **추론 관계는 분석 잡이 만든다**. Cypher `MATCH` 뒤 `AddRelationship`. 수집한 간선과 같은 그래프, 같은 형태로 들어간다.
5. **수명은 `lastupdated`가 정한다**. 이번 수집에서 갱신되지 않은 간선은 정리 잡(`GraphJob`)이 지운다. 효력 기간이나 이력은 없다.

### 4.2 판정 흐름

관계를 판정하는 별도 단계는 없다. 세 단계로 만들어진다.

**1단계: 수집 코드가 대상 키를 꺼낸다** (`intel/<provider>/*.py`의 transform)

- Okta 정책: `_include_exclude()`가 `conditions.people.groups`의 include와 exclude를 나눠 `group_exclude_ids`를 만든다(`intel/okta/policies.py:42`).
- GitHub 저장소: 협업자의 `permission`(`ADMIN`, `MAINTAIN`, `WRITE`, `TRIAGE`, `READ`)별로 사용자를 나눈다(`intel/github/repos.py:1195`). 권한 수준마다 간선 이름이 달라진다.

"이 필드가 어떤 관계인가"는 이 코드 안에서 정해진다. 규칙 문서나 설정은 없다.

**2단계: 스키마가 매칭 키를 선언한다** (`target_node_matcher`)

```python
make_target_node_matcher({"id": PropertyRef("group_exclude_ids", one_to_many=True)})
```

비교 방식은 네 가지다(`graph/querybuilder.py:716`).

| 방식 | 뜻 |
| --- | --- |
| 기본 | 정확히 같음 |
| `ignore_case` | 대소문자 무시 |
| `fuzzy_and_ignore_case` | 부분 일치 |
| `one_to_many` | 목록 안에 있음 |

**3단계: 적재기가 Cypher로 바꿔 실행한다** (`graph/querybuilder.py:960`)

```
OPTIONAL MATCH (n0:OktaGroup) WHERE n0.id IN item.group_exclude_ids
WITH i, item, n0 WHERE n0 IS NOT NULL
MERGE (i)-[r0:EXCLUDES]->(n0)
ON CREATE SET r0.firstseen = timestamp()
SET r0._module_name, r0._module_version, r0.lastupdated ...
```

대상 노드가 있으면 간선이 생기고, 없으면 조용히 건너뛴다.

### 4.3 관계 이름

- 온톨로지 쪽 `RelConstraint`(`models/ontology/constraints.py`)는 이름표 쌍마다 간선 이름을 강제한다. 예: `User → UserAccount = HAS_ACCOUNT`, `UserAccount → PermissionRole = HAS_ROLE`, `UserAccount → UserGroup = MEMBER_OF`. 테스트 `test_ontology_rel_constraints`가 검사한다. 간선을 만들지는 않는다.
- provider 쪽 간선 이름은 자유다. Slack, GWS, Okta 모델만 세어도 `RESOURCE` 26회, `MEMBER_OF` 8회, `APPLIES_TO`, `EXCLUDES`, `OWNER_OF`, `INHERITED_MEMBER_OF`, `MEMBER_OF_OKTA_GROUP` 등이 섞여 있다.
- GitHub 모델에는 `READ`, `WRITE`, `TRIAGE`, `DIRECT_COLLAB_ADMIN`, `MEMBER_OF_TEAM`, `CODEOWNER` 등 권한 수준이 간선 이름에 들어 있다.

### 4.4 AEGI Relation과 비교

| 항목 | Cartography | AEGI Relation |
| --- | --- | --- |
| 저장 | 노드에 딸린 Neo4j 간선 | Object와 별개인 관계 행 |
| 무엇이 관계인가 | provider별 수집 코드가 정함 | Profile이 필드마다 `relation_type`을 선언 |
| 어휘 | 자유 문자열 | 닫힌 17종(부여 16, 구조 1). 이름 변경 금지 |
| 권한 수준 | 간선 이름에 넣음 | `has_role_on`의 Policy 자리와 `qualifiers` |
| 끝점 검증 | 대상 라벨만 지정 | template이 interface 단위로 제한 |
| 대상이 없을 때 | 간선을 만들지 않음 | 「모름」 또는 `target_kind`로 남김 |
| 근거 | `_module_name`만 있음. 수집과 추론이 구분 안 됨 | `basis`(`stated`/`inferred`), 추정은 Link |
| 조건과 효력 | 간선 속성에 임의로 둠(예: `scopes`) | `qualifiers`, `validity`, `decomposable` |
| provider 간 | 분석 잡이 자유롭게 만듦 | `stated`이고 출발점이 Principal이 아닐 때만 |
| 소속 | `RESOURCE` 간선 하나로 통일 | `references.tenant`, `contained_in`(화면에서 기본으로 접음) |

**가장 큰 차이는 "대상이 없으면 건너뛴다"다.** 수집 권한이 없어 그룹을 못 읽으면 `EXCLUDES` 간선이 사라지고, "제외 없음"과 구별되지 않는다. 보안 판정에서는 오탐이나 미탐으로 이어진다.

## 5. SaaS 4종 모듈의 권한 깊이

모델 파일 목록과 관계 이름으로 판단했다. 각 수집 함수가 읽는 API 필드는 확인하지 않았다.

| SaaS | Cartography가 담는 것 | 빠진 것 |
| --- | --- | --- |
| Slack | team, user, channel, group, bot. 관리자 여부는 `is_admin`, `is_owner` 속성 | 워크플로, 앱 승인 정책, Connect 공유 채널, 외부 팀 신뢰 |
| GWS | user, group, device, OAuth 앱, tenant | Drive 공유, 도메인 전체 위임(DWD), 관리자 역할 |
| Okta | user, group, app, policy와 rule(`APPLIES_TO`, `EXCLUDES`), API 토큰, network zone, log stream, device | Okta 앱이 어느 SaaS 테넌트에 붙는지 (AWS SAML만 있음) |
| GitHub | org, team, user, App 설치, PAT, webhook, SAML 외부 신원, 저장소 협업자 권한 | 확인 안 함 |

Okta 앱과 Slack 팀, GitHub org를 잇는 SSO 간선은 코드에 없다. AEGI가 `stated` provider 간 관계로 허용한 자리가 바로 이곳이다.

## 6. 가져올 수 있는 것

1. **필드 정규화 처리기 8종** (`mapping/specs.py`). Profile의 `judged` 값(`operational_state`, `principal_kind` 등)을 코드 대신 선언으로 적을 수 있다. 특히 `mapping`이 모르는 값을 NULL로 돌리는 점은 AEGI의 `unknown` 원칙과 맞는다.
2. **기준 출처 지정과 `eligible_for_source`**. "Okta만 사람 실체를 만들고 나머지 SaaS는 붙기만 한다"를 Link 기준 집합을 고르는 규칙으로 쓸 수 있다. 붙는 간선에는 AEGI `level`을 그대로 남긴다.
3. **유일 후보 매칭 규칙** (GitHub SAML 연결). Link의 자연키 규칙에 "후보 하나, 충돌 없음" 조건으로 쓸 수 있다.
4. **`RelConstraint`와 테스트 짝**. 닫힌 어휘 17종과 template을 테스트 게이트로 묶는 방식의 참고 사례.
5. **매칭 방식 선언** (`PropertyRef`의 `one_to_many`, `ignore_case`). Profile에서 `references`를 해석하는 규칙을 같은 형태로 적을 수 있다.
6. **수집 회차로 오래된 간선을 정리하는 방식** (`lastupdated` + `GraphJob`). `validity`와 EA `stale_at` 운영 기준으로 참고. 지우기 전에 이력을 남길지는 따로 정해야 한다.
7. **빈 타입**. `Device`, `APIKey.expires_at`, `SecurityIssue`. Okta 장치 신뢰나 GWS 장치를 다룰 때 `Device`가 필요해질 수 있다.
8. **수집기 재사용 검토**. Okta `policies`, GitHub `external_identities`, `personal_access_tokens`는 AEGI Profile 입력과 비교할 가치가 있다. 필요한 필드 깊이를 채우는지는 미확인.

**가져오면 안 되는 것**: email 기반 캐논 `User`와 그 위에 권한 간선을 합성하는 방식. AEGI Link 규격의 핵심 금지 사항과 정면으로 충돌한다.

## 7. AEGI의 차별점

| 차별점 | 근거 |
| --- | --- |
| 사실, 추정, 계산을 저장소부터 분리 | Relation, Link, Effective Access. 답에 추정 구간이 표시된다 |
| 신원 판단에 등급과 규칙을 남기고 병합하지 않음 | Link `level` 다섯 값, `rule`, 전이 금지. Cartography는 충돌을 조용히 합친다 |
| 회수 지점 계산 | EA `cut[]`, `undecomposed[]`. "무엇을 지우면 이 접근이 사라지나" |
| SaaS 간 위협 분류 | 위협 유형 4개와 판정 조건 |
| 「모름」 보존 | `principal_kind: unknown`, `basis`, `validity`, `target_kind`. Cartography는 대상이 없으면 간선을 생략한다 |
| provider 간 `stated` 관계 | Okta 앱 → SaaS 테넌트 같은 SSO 연결. Cartography에는 AWS SAML 말고 없다 |
| 시나리오 재료 수집 | Slack 워크플로, GWS Drive 공유 등. Cartography는 수집하지 않는다 |

## 8. AEGI의 약점

- provider 수, 커뮤니티, 운영 실적은 Cartography가 훨씬 앞선다.
- Effective Access는 아직 초안이다. 결정적 시험은 우리가 만든 구성 두 개뿐이다.
- 관계 어휘 17종도 충분히 시험되지 않았다고 규격 스스로 적어 두었다.

## 9. 확인하지 않은 것

- Cartography 수집 함수가 실제로 읽는 API 필드와 범위 (5절 표는 모델 파일 기준)
- email 대소문자 불일치로 연결이 빠지는지 실제 데이터 재현
- Slack 사용자처럼 email이 선택 필드인 경우 email 없는 레코드가 캐논 노드 적재에서 어떻게 처리되는지
- GitHub의 PermissionRole 매핑 여부
