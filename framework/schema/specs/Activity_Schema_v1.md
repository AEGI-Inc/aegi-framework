# 사건 기록 Activity v1 (초안)

Activity 는 「언제 누가 무엇을 했나」를 담는 1급 기록이다. 관계(Relation)는 「지금 이어져 있다」는 상태(스냅샷)이고, Activity 는 그 사이에 일어난 일이다. 둘은 Activity 의 `effects` 로 잇는다.

지금까지 사건은 두 갈래로 따로 있었다. Splunk 정규 이벤트([Splunk_Normalized_Event_Contract_v1](Splunk_Normalized_Event_Contract_v1.md), 화면과 AI 가 읽음)와 엔진 관측(`EvidenceObservation`, 그래프 증거). 칸 이름이 다르고 서로를 몰랐다. Activity 는 이 둘을 한 모양으로 합친다. 겹치는 칸은 Splunk 계약의 이름과 뜻을 그대로 쓴다.

상태: 초안. 2026-11-11 작성. 정본 사전은 `ontology/activity_types.yaml`, 검사는 `validation/check_activity_types.py`(시험 `validation/test_activity_types.py`). 사전의 줄은 11-04 운영 수집본 로그 418종(17,231건)을 종류마다 손으로 분류한 결과를 씨앗으로 옮겼다.

## 원칙

1. **사건은 관계 행을 만들지 않는다.** 효과(`effects`)는 「이 사건이 이 관계를 만들었다, 지웠다, 썼다」는 뜻일 뿐이다. 관계 행은 지금처럼 스냅샷에서 만든다. 사건에서 뽑은 요약(누가 언제 부여했나, 언제 마지막으로 썼나)은 관계 행의 `provenance`, `usage` 칸으로만 붙는다([Activity_Usage_v1](Activity_Usage_v1.md)).
2. **로그에 없다고 관계가 없다고 보지 않는다.** 로그 보관 기간 밖이거나, 수집하지 않았거나, 벤더가 기록하지 않는 일이 많다. 「안 썼다」는 보관 기간과 함께 회수 추천으로만 쓴다.
3. **로그가 없는 환경은 결과가 같다.** Activity 가 0 건이어도 간선, EA, 격차, 위협 판정이 지금과 같아야 한다. 이번 단계(아래 「단계」)는 로그가 있어도 결과가 같다.
4. **SaaS 마다 다른 것은 사전 한 곳에 둔다.** 엔진은 사전(`provider|event_type` → 행위, 효과, 원본 칸 위치)만 읽고 SaaS 이름으로 갈라지지 않는다. 새 SaaS 는 사전에 호출 한 줄과 종류 줄을 더한다.

## 칸

| 칸 | 뜻 |
| --- | --- |
| `id` | 기록 id. 같은 원본 레코드는 같은 id 다 |
| `provider`, `event_type` | 원본 종류 그대로. 키는 `provider|event_type`(Splunk 계약, 행위 이름 사전과 같은 키) |
| `occurred_at` | 일어난 한 시점(ISO 8601, UTC) |
| `source` | `{call, record_ref, mapping_version}`. 수집 호출(OK-12 등), 원본 레코드 자리(파일과 순번), 사전을 읽어 만든 판 |
| `job` | `{id, step}`. 한 과정이 여러 사건을 남길 때(Okta transaction, 인증 단계, 가져오기, 워크플로 실행) |
| `session` | `{id, root_id, auth_method}`. 세션은 interface 가 아니라 사건 칸이다(수명이 짧고 스냅샷에 없다) |
| `actor` | `{ref \| unmatched, kind, native, matched_on, tenant}`. 행위자. `ref` 는 그래프 객체 키, 못 찾으면 `unmatched` 에 이유. `tenant` 는 행위자가 속한 테넌트(다른 조직의 게스트, Entra 다른 테넌트의 앱처럼 대상 테넌트와 다를 수 있다). `directory_ref` 는 사전 `actor.directory` 가 있는 호출에서 이 SaaS 계정과 같은 디렉터리 계정을 둘 다 찾았을 때 그 디렉터리 계정 키다(같은 신원. 그룹 · 도메인으로 받은 권한은 디렉터리 계정 쪽에서만 닿아, 판정이 행위자 계정으로 설명이 안 되면 이것으로도 묻는다) |
| `reported_actor` | `{ref \| unmatched, native}` 또는 없음. 원본이 행위자라고 적은 것이 실제 행위자와 다를 때만(서비스 계정이 사람 대신 적힌 것, 위임 대행에서 사람 이름이 적힌 것). 이때 `actor` 는 실제로 한 쪽이다 |
| `via[]` | `{ref \| unmatched, as, native}`. 행위자와 대상 사이를 지난 것(사람 → 앱 → 대상). **순서가 있다**: 앞이 행위자 가까이다. 대리 사슬(OBO, 앱이 앱을 부름)은 원소 여럿이 된다. `as` 는 아래 어휘 |
| `correlation_id` | 원본이 여러 레코드를 한 요청으로 묶는 id(요청 id, 추적 id). `job.id` 와 다르면 둘 다 둔다 |
| `count` | 원본이 같은 사건 여럿을 한 레코드로 묶어 적은 횟수(Atlassian 묶음 감사, Salesforce 집계). 없으면 1 |
| `action.verb` | 행위 하나(아래 어휘) |
| `action.verb_raw` | 원본의 행위 말 그대로(`access_url`, `PermSetAssign` 같은 것). 사전이 행위를 추정한 줄을 사람이 확인할 때 쓴다 |
| `targets[]` | `{ref \| unmatched, slot, native, matched_on}`. 대상. `slot` 은 이 대상이 사건에서 맡은 자리 |
| `outcome`, `outcome_reason` | `success`, `failure`, `unknown`, `success_implied` 와 짧은 실패 사유(Splunk 계약과 같은 뜻, 근거가 없으면 `unknown`). `success_implied` 는 결과 칸이 없지만 그 로그가 끝난 변경만 적는 것(감사 기록, 설정 변경 이력)이라 성공으로 보는 것이다. Splunk 계약으로 옮길 때는 `unknown` 이다 |
| `deny_kind` | 실패일 때 무엇이 막았나. `policy`(정책 판정), `no_relation`(권한 없음), `app_code`(앱이 거절), `protocol`(요청 형식, 만료 토큰) |
| `decision` | `{policy, rule, result}`. 정책이 이 시도에 낸 판정(`allow`, `deny`, `challenge`) |
| `change[]` | `{field, before, after}`. 범위, 설정, 식별자의 전후. 원본에 칸 이름만 있으면 `before`, `after` 가 없다 |
| `effects[]` | `{kind, relation_type?, slots?, interface?, refs?}`. 사전의 효과를 이 사건에 맞춘 것(아래 「효과 읽는 법」) |
| `self` | AEGI 수집기 자신의 활동인지. Splunk 계약의 `attributes.aegi_self` 와 같은 기준(환경 registry 의 수집기 자격증명 식별자)이다. 기준을 받지 못하면 `false` |
| `signal` | `{kind, source, value}` 또는 `null`. 결과와 따로 있는 단일 관측 신호(Splunk 계약과 같다) |

`native` 는 원본에 적힌 식별자 하나(`{id, type, field}`)다. 표시 이름과 원문 전체는 싣지 않는다.

### 그래프와 같았던 값 (Splunk 계약과 같은 말)

- `matched_on` 은 `{event_field, identifier, same}` 이다. 그래프 객체를 찾을 때 같았던 원본 칸, 객체 식별자 칸, 비교 방법(`exact`, `casefold`)이다. 점수는 매기지 않는다
- `unmatched` 는 `not_in_graph`(식별자로 찾았지만 그 값을 가진 객체가 없다), `ambiguous`(둘 이상이 같은 값), `name_only`(원본에 이름만 있어 찾지 않았다)다. 어느 것도 객체가 없다는 뜻이 아니다. 그래프를 받지 못했으면 이유를 적지 않는다
- 객체는 식별자 칸(id, login, email 같은 것)으로만 찾는다. 표시 이름으로는 찾지 않는다

## 어휘

사전 `ontology/activity_types.yaml` 의 `vocabulary` 와 같다. 한쪽만 고치면 `validation/test_activity_types.py` 가 실패한다.

| 이름 | 값 |
| --- | --- |
| `verbs` | read, write, create, delete, grant, revoke, configure, authenticate, execute, send, export, request, activate |
| `effect_kinds` | relation_created, relation_removed, relation_modified, object_created, object_removed, object_state_changed, object_attr_changed, setting_changed, exercised, denied, none |
| `actor_kinds` | human, integration, automation, credential, system, anonymous |
| `via_as` | app, token, bot, automation, agent, delegation |
| `slots` | target, source, role, assignment, container, policy, destination, credential, object, counterparty |
| `outcomes` | success, failure, unknown, success_implied |
| `deny_kinds` | policy, no_relation, app_code, protocol |
| `decision_results` | allow, deny, challenge |
| `unmatched` | not_in_graph, ambiguous, name_only |
| `fits` | fits, fits_with_attr, no_fit, n/a |
| `snapshot_gaps` | not_collected, not_extracted, identity |
| `self_services` | actor, target |

- 행위(`verbs`)의 `activate` 는 이미 있는 자격을 이 세션 동안 켜는 것이다(PIM 역할 활성화, Salesforce 세션 권한 집합 켜기). 관계를 만들지 않고 `activation: once | session` 인 관계를 쓴 것이다(`exercised`)
- 자리(`slots`): `target` 사건이 직접 다룬 것, `source` 옮겨 온 곳, `role` 부여한 역할, `assignment` 부여 기록(Okta AppUser, 동의 기록 같은 것), `container` 그것이 들어간 곳이나 권한이 걸린 곳(그룹, 앱, 조직, 저장소, 권한을 준 파일), `policy` 판정하거나 바뀐 정책·설정·한도, `destination` 보낸 곳, `credential` 사건이 다룬 자격증명(토큰, 인가 코드, 인증 수단, 비밀), `object` 행위가 만든·바꾼 내용 자체(메시지, 커밋, 파일 판), `counterparty` 상대편(공유 받은 바깥 조직, 연합 상대 테넌트, 메시지 받는 사람)
- 맞음 정도(`fits`): 씨앗 분류의 결과다. `fits` 지금 관계와 interface 로 효과를 적을 수 있다, `fits_with_attr` 관계와 객체는 있으나 사건 정보(범위 전후, 경유, 판정)를 담을 칸이 관계 쪽에 없다, `no_fit` 맞는 관계가 없다, `n/a` 그래프와 무관하다

## 사전 (`ontology/activity_types.yaml`)

블록 넷이다.

| 블록 | 무엇 |
| --- | --- |
| `vocabulary` | 위 어휘 |
| `calls` | 수집 호출마다 원본 칸이 어디 있나(레코드 배열, 중복 거르는 칸, 종류 칸, 시각, 행위자, 경유, 대상, 자리 표, 결과, 세션, 과정, 전후, 판정) |
| `types` | 키 `provider|event_type` 마다 행위, 효과, 맞음 정도. 그 종류만 다른 칸이 있으면 여기서 덮는다(`outcome`, `slots`) |
| `sources` | 블록별 출처 |

### 종류 줄의 칸

| 칸 | 뜻 |
| --- | --- |
| `calls` | 이 종류가 나오는 수집 호출. 같은 키가 두 호출에서 나오면(Jira 와 Confluence 의 같은 문구) 둘 다 적는다 |
| `verb` | 행위 |
| `effects` | `{kind, relation_type?, from?, to?, role?, at?, interface?}`. `relation_type` 은 관계 17종 이름. 자리 `from`, `to`, `role`, `at` 은 `actor` 또는 `targets[<자리>]` |
| `outcome` | 원본에 결과 칸이 없는데 종류 자체가 실패인 것(로그인 실패 같은 것)은 `failure` |
| `decision`, `deny_kind` | 정책 판정 종류면 `decision: true` 이고 실패는 `deny_kind: policy` |
| `signal`, `self_possible` | 탐지 신호가 나오는 종류, 수집기 자신이 남길 수 있는 종류 |
| `self_service` | 자기 계정에 하는 행위(비밀번호, MFA, 내 정보, 내 자격증명 SSO 인가). `actor` 는 늘 행위자 자신의 계정이고, `target` 은 대상(`targets[target]`)이 행위자일 때만이다. 남의 계정에 한 같은 종류는 그대로 둔다 |
| `observation` | 엔진이 이 종류로 관측(`activities.yaml` 의 `observation_kinds`)도 만든다. 아래 「관측과의 관계」 |
| `fit`, `cluster`, `missing` | 씨앗 분류의 맞음 정도, 묶음(TOKEN, CONSENT 같은 것), 담을 칸이 없는 정보 |
| `review` | 기계가 정한 값이 있어 사람이 확인해야 하는 까닭. 확신 없는 줄도 넣고 이 칸으로 표시한다 |
| `snapshot_gap` | `{관계 종류: {kind, note}}`. 이 줄의 부여·회수 효과와 같은 관계가 스냅샷에 없는 까닭이 사전 밖일 때 적는다. `kind` 는 `not_collected`(그런 관계를 수집하지 않음), `not_extracted`(원본에는 있으나 관계·참조로 뽑지 않음), `identity`(관계는 있으나 사건 끝이 같은 것의 다른 객체로 붙음). 사전 자리는 사건 원본대로 두고 억지로 스냅샷에 맞추지 않는다 |

### 칸 위치의 경로 문법

`calls` 의 칸 위치는 레코드 하나에서 값을 꺼내는 경로다.

- `a.b.c` 점으로 내려간다. `a[]` 는 배열을 펼친다
- `=값` 은 상수다(`type: '=user'`)
- `$parent.` 는 바깥 레코드다. `children` 이 있는 호출(GWS 는 레코드 하나에 사건 여럿)에서 쓴다
- `param:이름` 은 GWS 처럼 `[{name, value}]` 목록으로 온 값 중 그 이름의 값이다(`params` 가 목록 자리와 값 칸을 정한다)
- `.` 은 원소 자신이다(`details.affected_users[]` 의 원소)
- `id` 는 후보 경로 목록이다. 앞에서부터 값이 있는 것으로 객체를 찾는다
- 대상 칸은 `{each?, id, join?, type, slot?, regex?, normalize?, name_only?}` 다. `normalize` 는 꺼낸 값을 그래프 식별자 꼴로 바꾼다(Profile identity 의 normalization 과 같은 이름: `to_18_char`, `lowercase`, `trim`. Salesforce Display 문장의 사용자 id 는 15자라 18자로). `join` 은 여러 경로의 값을 이어 붙인 복합 식별자다(GWS Token 은 그래프에서 `사용자|클라이언트` 로 찾는다). `each` 는 대상 배열, `type` 은 원본 종류(자리 표 `slots` 로 자리를 정한다, 없으면 `target`), `regex` 는 글 안의 식별자를 꺼낸다(Salesforce Display 문장의 사용자 id), `name_only` 는 이름만 있어 찾지 않는다. `slot_by: {path, map}` 은 원소의 칸 값으로 자리를 고른다(Okta 매핑 사건에서 `detailEntry.previousPolicy` 가 `true` 인 정책은 옮기기 전 정책이라 `source`)
- 호출의 `kinds` 는 원본 대상 종류 → 객체 종류(object_type) 목록이다. 적으면 그 대상은 그 종류의 객체 안에서만 찾는다. 같은 값을 다른 종류가 식별자로 가질 때 쓴다(GWS 사용자 메일은 같은 사용자의 Calendar id 이기도 하고, Jira 프로젝트 id 는 같은 숫자의 Filter id 이기도 하다). 그 종류에 없으면 다른 종류로 넘어가지 않고 `not_in_graph` 다
- 호출의 `id_alias: [{match, kinds, from, to}]` 는 원본이 같은 객체를 그래프와 다른 식별자로 적어 대상 경로의 앞부분이 다를 때 쓴다. 대상 값이 `match` 에 맞고 그 첫 묶음이 `kinds` 객체의 `from` 식별자 값이면, 맞은 부분을 그 객체의 `to` 식별자 값으로 바꿔 찾는다(Gemini 로그의 `projects/<프로젝트 id>/…` → 그래프의 `projects/<번호>/…`). 두 객체가 같은 `from` 값을 가지면 바꾸지 않는다. `native.id` 는 원본 값 그대로다
- 행위자 종류 `kind` 는 규칙 목록이다. `{path, map}`, `{path, regex, kind}`, `{kind}` 를 위에서부터 보고 처음 정해지는 것을 쓴다
- 결과는 `{path, map, default}` 다. map 에 없으면 `default`, 그것도 없으면 `unknown`

`records` 가 없는 호출은 칸 위치를 아직 적지 않은 것이다. 엔진은 건너뛰고 몇 건인지만 센다.

## 효과 읽는 법

- `exercised` 는 관계를 썼다는 뜻이다. 사건 결과가 `failure` 면 기록의 효과는 `denied` 가 된다(같은 줄에 둘을 다 적지 않는다)
- 관계 효과의 `from`, `to` 는 **그 관계 행의** 출발과 도착이 사건의 어느 자리인가다. 행위자가 출발인 것은 행위자가 그 관계를 받거나 쓰는 사람일 때뿐이다(스스로 채널에 들어감, 토큰으로 인증함). 관리자가 남에게 준 권한은 받는 사람이 출발이다
- 원본 대상 칸에 그 끝이 없으면 그 칸을 비운다(그룹을 만든 사건의 사이트, 권한을 받은 사람이 바뀐 값에만 있는 사건). 비었다고 끝이 없다는 뜻이 아니다
- 3항 관계(역할이 있는 `has_role_on`)의 역할은 `role` 이다
- 객체를 만들거나 지우는 사건은 `object_created`, `object_removed` 로 적는다. 그 객체의 테넌트나 부모 소속(`contained_in`, 테넌트 `member_of`, `registered_in`)은 부모가 사건 대상에 있을 때만 관계 효과로 따로 적는다
- 행위(`verb`)는 사건이 그래프에 한 일로 고른다. 만들면 create, 지우면 delete, 권한·소속·공유·신뢰를 주면 grant, 거두면 revoke, 정책·설정이나 권한의 모양을 바꾸면 configure, 대기 중인 요청은 request, 작업 단계는 execute
- 기록은 그 자리에서 찾은 객체 키를 `refs` 에 둔다. 적힌 끝을 다 찾지 못하면 `refs` 를 비운다
- 객체 효과(`object_*`, `setting_changed`)의 `at` 은 바뀐 객체의 자리, `interface` 는 그 객체의 interface 다
- `none` 은 그래프와 무관한 사건이다(목록 조회, 알림 설정 같은 것). 기록은 남긴다
- 한 호출의 원본이 같은 자리에 여러 종류를 담으면(Atlassian 조직 감사 로그 `context` 의 그룹과 사용자) 줄의 `slots` 로 종류를 자리에 덮는다. 자리마다 처음 찾은 객체가 끝이 된다
- 부여·회수 효과의 관계가 스냅샷에 없으면 먼저 사전 자리가 스냅샷 관계 행의 출발·도착과 같은지 본다. 같은데도 없으면 까닭(수집 안 함, 뽑지 않음, 다른 객체로 붙음)을 `snapshot_gap` 에 적는다. 2026-11-12 11-04 수집본: 마지막이 부여인 204쌍 가운데 97쌍이 스냅샷에 있고, 나머지 107쌍은 모두 `snapshot_gap` 으로 적었다(수집 안 함 58, 뽑지 않음 42, 다른 객체로 붙음 7)

## 관측과의 관계 (`activities.yaml`)

`activities.yaml` 의 `observation_kinds`(agent_run, slash_request, audit_event, credential_use, content_change, delivery, request_log, access_snapshot, correlation)는 엔진이 위협 판정의 **증거**로 쓰는 관측의 종류다. 관측은 증거 관계(`evidence_link_types`)로 객체와 이어지고 화면의 근거 목록에 나온다.

- Activity 는 로그 사건 전부의 기록이고, 관측은 그 가운데 증거로 쓰는 것이다. 관측의 한 종류 `audit_event` 는 Activity 한 건에서 나온다
- 사전 줄의 `observation` 칸이 「이 종류는 관측도 만든다」를 정한다. 지금은 Okta 감사 사건 9종(프로필 바꿈, 그룹·앱 배정 더하고 빼기, MFA 초기화·끔, 비밀번호 초기화)이 `audit_event` 를 만든다. 전에는 엔진 코드(`observations.ts`)에 이름 9개가 박혀 있었다
- 로그가 아닌 관측(`access_snapshot` 같은 설정 스냅샷, 봇 요청 로그의 `slash_request`, 스크립트 실행의 `agent_run`)은 Activity 와 따로 있다. 나중에 이것들도 Activity 로 옮길지는 다음 바퀴에 정한다

## 기존 Splunk 계약과의 관계

Splunk 정규 이벤트는 Activity 의 한 표현이다. 칸은 이렇게 대응한다.

| Splunk 정규 이벤트 | Activity |
| --- | --- |
| `provider`, `event_type`, `occurred_at`, `outcome`, `outcome_reason`, `signal`, `mapping_version` | 같은 이름, 같은 뜻(`mapping_version` 은 `source` 안) |
| `actor`, `targets` 의 `object_key`, `matched_on`, `unmatched` | `ref`, `matched_on`, `unmatched` |
| `correlation.session_id` | `session.id` |
| `correlation.transaction_id` | `job.id` |
| `correlation.caused_by` | `via[]` 또는 `job` |
| `attributes.aegi_self` | `self` |
| `relation_matches` | 두 끝이 그래프 관계와 같았다는 사실. Activity 의 `effects[].refs` 와 다르다. `effects` 는 사전이 정한 뜻이고 `relation_matches` 는 대조 결과다 |
| `category`, `title` | 화면용. Activity 에는 없다(행위는 `action.verb`) |

## 단계

| 단계 | 무엇 | 결과 |
| --- | --- | --- |
| 1 (이번) | 명세, 사전, 검사. 엔진이 사전으로 Okta 관측을 만들고, 나머지 사건은 Activity 로 만들어 보관만 한다 | 간선, EA, 격차, 위협 판정이 그대로다(엔진 점수판으로 잰다) |
| 2 | 관계 행에 출처(`granted_by`, `granted_at`), 사용(`first_at`, `last_at`, `count`) 칸. EA 행과 격차에 「실제로 쓰였나」. 명세 [Activity_Usage_v1](Activity_Usage_v1.md) | 판정은 그대로, 칸만 더한다 |
| 3 | 사건으로만 아는 관계(`basis: logged`), 설명되지 않는 사건 판정 | 판정이 바뀐다 |

## 정할 것

- `review` 가 남은 줄 16개: 칸 위치를 적지 않은 호출의 줄 12, 17종 갈래 밖 3(Atlassian 자동화 주인, Salesforce 외부 자격증명 권한, Slack 파일→채널 공유), 원본 칸으로 가르지 못하는 것 1(Salesforce 외부 앱 하위 객체). 씨앗의 기계 추정 211줄은 2026-11-11 원본 대상 칸 모양과 벤더 문서로 확인해 고쳤고, 2026-11-12 원본으로 5줄을 더 정했다(한도 풀 설정, GitHub 앱 만들기·비밀·SSO 인가는 끝을 비움, Slack 이상 사건은 세션 이상이라 인증)
- 칸 위치를 아직 적지 않은 호출(GWS 스크립트 실행, Slack 메시지, 봇 요청 로그, GitHub 웹훅 수신, 커밋, 알림)을 적는다
- 「17종 보완」과 「의미 중심 9종」 가운데 하나를 고르면 `relation_type` 을 그 이름으로 옮긴다(별칭 표)
