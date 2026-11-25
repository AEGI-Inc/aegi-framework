# 조치 동사 형식 v1 (초안)

조치 동사는 "위험한 길을 막으려면 무엇을 끊나"를 사람이 하는 일로 적는다. EA 행의 `cut`과 범용 접근 엔진의 회수 후보는 "어느 관계 행을 끊으면 길이 무너지나"까지만 말한다. 동사는 그 관계 행을 실제로 끊는 손이다. 어느 SaaS의 어느 API나 화면으로 하는지, 되돌릴 수 있는지, 누가 할 수 있는지, 끊으면 무엇이 같이 끊기는지를 적는다.

상태: 초안. 2026-10-31 작성, 2026-11-01 「정할 것」 여섯을 정했다(아래 「정한 것」). 정본은 `ontology/cut_actions.yaml`(동사 16개. **열어 두고 작업하다가 닫는다. 2026-11-02 에 셋, 2026-11-03 에 여덟을 닫았다**, 아래 「닫은 동사」, 「문장틀」), 검사는 `validation/check_cut_actions.py`. 재료는 aegi-knowledge `566a551`, aegi-adapter-engine `9755454`에서 읽었다. 엔진은 동사와 EA 회수 지점 문장틀을 사본의 생성 표로 읽는다(aegi-adapter-engine `src/detection/cutActions.ts`).

## 층에서의 자리

Relation 명세는 네 층으로 다시 짜는 중이다.

| 층 | 묻는 것 | 정본 |
| --- | --- | --- |
| 1층 사실 | 무엇이 무엇과 이어져 있나 | 관계 17종(`ontology/relation_types.yaml`), Link |
| 2층 권한 | 누가 무엇에 읽기, 쓰기, 관리 권한을 갖나 | 권한 방식 13개(`ontology/access_patterns.yaml`) |
| 3층 경로 | 봇, 트리거, 데이터 흐름을 건너는 길 | 접근 규칙(`ontology/access_rules.yaml`), 형식 [Path_Rule_Schema_v1](Path_Rule_Schema_v1.md) |
| **4층 조치** | **위험한 길을 막으려면 무엇을 끊나** | **이 문서와 `ontology/cut_actions.yaml`** |

2층이 "관계를 조합해 권한이 생기는 방식"을 공통 양식으로 한 번 적고 SaaS마다 다른 값을 빈칸에 둔 것처럼, 4층도 "끊는 방식"을 공통 양식으로 한 번 적고 SaaS마다 다른 값(API, 화면, 필요 권한, 되돌리기)을 빈칸에 둔다.

## 왜 필요한가

지금 엔진은 조치를 세 곳에서 따로 말한다. 같은 일을 다른 말로 하고, 벤더 값은 정책 문구 안에 화면 경로 일부만 있다.

| 곳 | 무엇을 내나 | 벤더 값(API, 권한, 되돌리기) |
| --- | --- | --- |
| EA 손코드 `effectiveAccess/compute.ts` | `cut[].x_scope.note`: "실행 신원을 바꾸면 이 자동화만 영향", "멤버 N명 모두 영향" | 없음 |
| 범용 위협 판정 `generic/index.ts` `cutStep`. 지금은 없다(2026-11-18 지움) | 회수 후보 간선을 문장으로: "멤버 제거", "역할 회수", "사용 범위 제한", 나머지는 "연결 해제" | 없음 |
| 정책 위협 `generic/policies.ts`. 지금은 없고 정책 고정 문구는 쓰지 않는다 | 고정 조치 문구 11개(메일 전달, 외부 공유, 웹앱 실행 권한, 조건 속성, 토큰) | 문구 안에 화면 경로 일부 |

EA 명세는 「`via`는 감사용이고 `cut`은 조치용이다」라고 정했다. 그런데 `cut`이 가리키는 것은 관계 행이고, 사람이 그 관계 행을 지우는 방법은 SaaS마다 다르다. Okta 그룹에서 빼는 것과 GitHub 팀에서 빼는 것은 같은 `member_of`를 끊지만 API, 필요 권한, 같이 사라지는 것이 다르다. 그 차이를 적을 자리가 없어 범용 판정은 "연결 해제"라고만 말한다.

## 동사 하나의 모양

```yaml
- id: remove_group_member          # 동사 이름. 화면, 보고서, AI 가 이 이름으로 부른다
  name: 그룹에서 빼기
  status: open                     # open(팀이 정할 일) | adopted
  says: 주체를 그룹에서 뺀다. 그 그룹을 거쳐 받은 권한이 그 주체에게서만 사라진다
  cuts:                            # 끊는 사실 (아래 「끊는 사실의 종류」)
    - {relation: member_of, pairs: [Principal>Principal]}
  patterns: [group_membership]     # 끊는 권한 방식 (2층)
  ea_cuts: [x_member_grant.m]      # 끊는 접근 규칙의 회수 지점 (3층 cut 홉)
  reversible: 'yes'                # 공통 기본값. SaaS 빈칸이 덮는다
  cascades: [...]                  # SaaS 와 상관없이 같이 끊기는 것
  now:                             # 지금 엔진에서 이 동사를 말하는 곳
    - {where: ea_note, rule: x_member_grant, via: 0}
  saas:                            # SaaS 빈칸 (아래)
    - provider: okta
      cut: {relation: member_of, pair: Principal>Principal}
      api: DELETE /api/v1/groups/{groupId}/users/{userId}
      ui: ...
      who: ...
      reversible: 'yes'
      undo: ...
      cascades: [...]
      doc: [https://...]
      checked: doc                 # doc | inferred | blank
```

`reversible`의 `'yes'`, `'no'`는 따옴표로 쓴다. YAML 1.1 읽기가 맨 `yes`, `no`를 참거짓으로 바꾼다(검사가 처음 돌 때 10곳에서 잡았다).

### 끊는 사실의 종류

| `cuts`의 종류 | 뜻 | 예 |
| --- | --- | --- |
| `relation` | 관계 행 하나를 지운다. 칸(`pairs`)은 그 관계의 template 안이어야 한다. `has_role_on`에는 역할 이름(`role`)을 붙여 그 역할의 부여만 맡을 수 있다 | 그룹에서 빼기는 `member_of Principal>Principal`. 소유권 넘기기는 `has_role_on Principal>Resource`의 `role: owner`(Drive 파일 주인) |
| `rule` | `relation_semantics.yaml` `rules`의 표가 만드는 간선의 값을 바꾼다 | 호출 권한 제한는 `deployments`(Apps Script 배포 접근 범위) |
| `object` | 객체 하나를 지우거나 끈다. 그 객체에 걸린 관계가 다 같이 사라진다 | 토큰 폐기는 `Credential` |
| `setting` | 객체 속성 값을 바꾼다. 관계 행은 그대로다. 어느 속성인지는 SaaS 빈칸이 적는다 | 메일 자동 전달 끄기는 `Principal`의 메일 전달 설정 |

`rule`, `object`, `setting`이 있는 까닭: 정책 위협(메일 자동 전달, 본인이 편집하는 조건 속성)과 범용 엔진의 배포 접근 간선은 관계 행이 아니라 객체 속성과 사전 표에서 나온다. 그것을 관계로 만들면 관계 어휘가 늘어나므로, 동사가 끊는 자리를 넷으로 나눴다.

### SaaS 빈칸

| 칸 | 뜻 |
| --- | --- |
| `provider` | SaaS. 엔진 `src/model/object.ts` `Provider`와 같은 이름(`gws`, `okta` …) |
| `cut` | 이 행이 맡는 사실. `relation`이면 `{relation, pair, role}`(`role`은 골라 쓴다), 나머지는 `{rule}`이나 `{object|setting, type, property}`. `role`이 있는 줄은 그 역할 이름의 부여에만 맞고, 같은 칸의 `role` 없는 줄보다 먼저 고른다. 역할 이름은 `capabilities.yaml` `role_name_from`대로 읽는다 |
| `follow_with` | 이 동사 하나로는 그 주체의 길이 닫히지 않을 때 이어서 해야 하는 동사. 예: Drive 소유권을 넘겨도 옛 주인이 편집자로 남아 공유 끊기를 이어서 한다 |
| `api`, `ui` | 벤더 API(메서드와 경로, 또는 메서드 이름)와 관리 화면 경로 |
| `who` | 할 수 있는 사람(필요 권한) |
| `reversible`, `undo` | 되돌릴 수 있나. `yes`(같은 것으로 되돌림), `partial`(되돌리지만 같지 않음), `no`, `unknown`. 같지 않은 점은 `undo`에 |
| `cascades` | 끊으면 같이 끊기거나 멈추는 것(벤더 문서가 적은 것) |
| `doc`, `checked` | 벤더 문서 주소와 확인 정도. `doc`(문서를 열어 확인), `inferred`(문서에 그대로 적혀 있지 않음), `blank`(아직 안 채움) |

칸 이름의 뜻은 엔진 `src/domain/remediation.ts` `ConfigurationTarget`의 `permissionsRequired`(`who`), `rollback`(`undo`), `documentationUrl`(`doc`)과 맞췄다.

## 공통 규칙

| 규칙 | 내용 | 근거 |
| --- | --- | --- |
| 동사는 관계 어휘가 아니다 | 동사는 사람이 하는 일이다. 관계 17종, interface 9종을 늘리지 않는다. 끊는 사실은 있는 관계, 사전 규칙, interface 로만 가리킨다 | `WORKRULE.md` Schema 「닫힌 어휘」, Splunk 이벤트의 `action`을 Interface로 만들지 않는다는 규칙 |
| 회수 지점마다 동사가 있다 | `access_rules.yaml`의 `cut` 홉마다 그 홉을 끊는 동사가 하나 이상 있다. 관계 홉이면 그 관계를 홉의 끝 interface 와 맞는 칸으로, 간선 홉이면 그 간선을 만드는 관계를 간선이 나오는 끝이 맞는 칸으로 끊는다. 홉의 끝 interface 는 규칙의 `from_interface`, `to_interface`와 경로의 관계 template 으로 좁힌다 | 검사 A3 |
| 한 사실에 한 동사 | 같은 SaaS의 같은 사실(관계와 칸과 역할 이름, 규칙, 속성)은 SaaS 빈칸 한 줄, 동사 하나가 맡는다. 다른 동사가 그 사실을 같이 지우는 것(토큰을 폐기하면 그 토큰의 부여가 사라지는 것)은 `cascades`에 적는다. 이 규칙은 SaaS 빈칸 줄 사이에서만 지켜진다. 공통 `cuts`는 겹칠 수 있다(`has_role_on` Principal>Resource 는 역할 회수, 공유 끊기, 소유권 넘기기의 owner 가 같이 갖는다). 그래서 SaaS 줄이 없는 SaaS(Salesforce 등)의 회수 지점에는 동사 후보가 여럿 나온다 | 검사 A5. 회수 지점에서 동사를 고르는 답이 하나여야 한다 |
| 한 동사로 안 닫히는 곳을 적는다 | 동사 하나로 그 주체의 길이 닫히지 않으면 SaaS 빈칸에 `follow_with`로 이어서 할 동사를 적는다. 잴 때 따로 센다 | 검토(2026-10-31)가 찾은 Drive 파일 주인 |
| 통로를 끊는 것은 회수가 아니다 | 웹훅 끄기, 메일 자동 전달 끄기는 앞으로의 흐름을 막을 뿐 이미 간 사본은 남는다. 그래서 `ea_cuts`가 비어 있다 | `ontology/cut_actions.yaml` `disable_webhook` `cascades` 「이미 보낸 사본은 남는다」 |
| 누가 같이 잃나와 무엇이 같이 끊기나는 다르다 | 회수 지점의 `affects`(그 source만, 그룹 전원, 모든 호출자)는 경로의 성질이고 규칙 파일에 있다. 동사의 `cascades`는 그 손을 대면 벤더가 같이 지우는 것이다(프로비저닝 해제, 토큰 폐기) | EA 명세 「한 경로 안에서 어느 홉을 cut 에 넣나」 |
| 정함과 사실을 가른다 | 모든 동사는 `open`이다(열어 두고 작업하다가 나중에 닫는다). 벤더 값은 행마다 `checked`로 확인 정도를 적는다. 문서를 열지 못한 값은 `inferred`나 `blank`로 둔다 | 「정한 것」 2번 |

## 동사 16개

| 동사 | 끊는 것 | 회수 지점(`ea_cuts`) | 되돌리기 | 지금 엔진 |
| --- | --- | --- | --- | --- |
| 그룹에서 빼기 `remove_group_member` | `member_of` Principal>Principal | `x_member_grant.m` | yes | EA note, cutStep(M) |
| 자원 멤버에서 빼기 `remove_resource_member` | `member_of` Principal>Resource | `runs_as_inherits.h` | yes | EA note, cutStep "멤버 제거" |
| 역할 회수 `revoke_role` | `has_role_on` Principal·Integration>Resource·Tenant | `x_member_grant.h`, `runs_as_inherits.h` | yes | EA note 둘, cutStep "역할 회수", 정책 1 |
| 앱 배정 지우기 `unassign_app` | `has_role_on` Principal>Integration | `x_member_grant.h` | partial | EA note |
| 공유 끊기 `remove_share` | `shared_with`, `has_role_on` Principal>Resource(파일 공유) | `runs_as_inherits.h` | partial | EA note, cutStep "역할 회수", 정책 1 |
| 소유권 넘기기 `transfer_ownership` | `owned_by` Resource>Principal, `has_role_on` Principal>Resource 의 `role: owner` | `runs_as_inherits.h` | partial | EA note, cutStep "owner 역할 회수" |
| 실행 신원 바꾸기 `change_run_as` | `runs_as` Automation>Principal | `runs_as_inherits.r` | yes | EA note, cutStep, 정책 1 |
| 호출 권한 제한 `restrict_invokers` | 규칙 `deployments`, `entry_points`, `triggered_by` | 없음 | yes | cutStep "사용 범위 제한", 회수 후보 없는 격차의 기본 조치 |
| 앱 설치 지우기 `uninstall_app` | `acts_as` Integration>Principal, Integration 객체 | 없음 | partial | cutStep "연결 해제"(A) |
| 토큰 폐기 `revoke_token` | Credential 객체, `authenticates_with` | 없음 | no | 정책 2 |
| 권한 범위 줄이기 `narrow_scope` | Credential·Integration·Automation 설정 | 없음 | partial | 정책 2 |
| 웹훅 끄기 `disable_webhook` | Endpoint 객체, `receives_into`, 규칙 `outbound_hooks` | 없음 | partial | 없음 |
| 메일 자동 전달 끄기 `stop_mail_forwarding` | Principal 설정 | 없음 | yes | 정책 2 |
| 조건 속성 잠그기 `lock_condition_attribute` | Principal·Policy 설정 | 없음 | yes | 정책 2 |
| 권한 스킴 바꾸기 `change_permission_scheme` | `applies_to` Policy>Resource | `x_dynamic_holder.s` | yes | EA note |
| 공개 범위 줄이기 `narrow_visibility` | 규칙 `visibility_scoped` | 없음 | partial | 없음 |

「지금 엔진」 칸의 EA note 는 EA 손코드가 회수 지점에 붙이는 설명, cutStep 은 범용 위협 판정이 회수 후보 간선을 옮긴 문장, 정책은 정책 위협의 고정 문구다. cutStep 뒤 괄호의 글자는 범용 접근 엔진의 간선 종류다(M 소속, G 권한, A 대행, T 호출. 엔진 `src/detection/v2/engine/types.ts`). 그 문장의 제목은 G 의 멤버와 역할, T 의 누구나 부름만 따로 있고 나머지는 「연결 해제」다.

## SaaS 빈칸

34줄을 채웠다. 벤더 문서를 열어 API를 확인한 줄 30, API가 문서에 그대로 없는 줄(추정) 3, 아직 안 채운 줄 1이다(2026-10-31 확인). 2026-11-01 결정으로 Google Workspace 조직 단위를 옮기는 줄(추정)을 지웠다(「정한 것」 4번). 행마다 `doc`에 연 문서 주소가 있고, 화면 경로나 필요 권한처럼 한 칸만 추정이면 `note`에 적었다. 아래 표의 빈 칸은 그 SaaS 줄이 아직 없다는 뜻이다. Salesforce는 한 줄도 없다.

| 동사 | okta | github | slack | gws | atlassian | salesforce |
| --- | --- | --- | --- | --- | --- | --- |
| `remove_group_member` | 문서 | 문서 | 문서 | 문서 | 문서 |  |
| `remove_resource_member` |  |  | 문서 |  |  |  |
| `revoke_role` | 문서 2줄 | 문서 |  |  | 문서 |  |
| `unassign_app` | 문서 |  |  |  |  |  |
| `remove_share` |  |  |  | 문서 2줄 |  |  |
| `transfer_ownership` |  |  |  | 문서 2줄 |  |  |
| `change_run_as` |  |  |  | 추정 |  |  |
| `restrict_invokers` |  |  | 빈칸 | 추정 |  |  |
| `uninstall_app` |  | 문서 | 문서 |  |  |  |
| `revoke_token` | 문서 | 문서 | 문서 | 문서 2줄 |  |  |
| `narrow_scope` | 문서 |  |  |  |  |  |
| `disable_webhook` |  | 문서 | 추정 |  | 문서 |  |
| `stop_mail_forwarding` |  |  |  | 문서 |  |  |
| `lock_condition_attribute` | 문서 2줄 |  |  |  |  |  |
| `change_permission_scheme` |  |  |  |  | 문서 |  |
| `narrow_visibility` |  |  | 문서 |  |  |  |

되돌리기는 34줄 가운데 `yes` 11, `partial` 17, `no` 5, `unknown` 1이다. 「되돌릴 수 있다」고 생각하기 쉬운 조치가 같지 않게 돌아오는 경우가 많다.

### 벤더 문서에서 찾은 함정

조치하는 사람이 알아야 할 것이라 SaaS 빈칸의 `cascades`, `undo`, `note`에 적었다. 요약하면 이렇다.

| 함정 | 어디 |
| --- | --- |
| 남이 만든 앱은 API로 못 지운다. GitHub App 설치 지우기와 멈춤은 그 앱 자신의 JWT만, Slack `apps.uninstall`은 그 앱의 client_id와 secret만 받는다. 남은 화면이나 Slack Enterprise `admin.apps.uninstall`뿐이다 | `uninstall_app` |
| GitHub 조직의 fine-grained 개인 토큰 폐기 API는 GitHub App만 부른다. classic 개인 토큰은 이 길로 폐기할 수 없다 | `revoke_token` github |
| 되돌릴 수 없다: Slack 앱 지우기, Okta API 토큰 폐기, Jira 웹훅 지우기(문서가 끄기를 권한다), Okta 그룹 규칙을 지울 때 고른 `removeUsers` | 각 줄 `reversible: 'no'` 또는 `undo` |
| 같지 않게 돌아온다: Okta 앱 배정을 지우면 앱 프로필이 되살아나지 않는다. GitHub 협업자를 빼면 그 사람의 포크가 지워진다. Okta 규칙이 넣은 멤버를 손으로 빼면 규칙의 예외 목록에 고정된다 | `unassign_app`, `revoke_role` github, `remove_group_member` okta |
| 넘겨야 하고, 넘겨도 남는다: Drive 파일 주인은 벤더 문서가 넘기는 길만 적는다(그냥 지울 수 없다는 것은 추정). API 로 넘기면 옛 주인이 편집자로 남는다(콘솔로 넘겨도 접근은 그대로). 옛 주인의 길을 닫으려면 공유 끊기를 이어서 한다 | `transfer_ownership` gws(`follow_with`) |
| 효과가 오래가지 않거나 없다: Google Connected applications 에서 지운 OAuth 승인은 사람이 다시 로그인하면 돌아온다. Okta 그룹 규칙을 끄기만 하면 이미 들어간 멤버가 남는다 | `revoke_token` gws, `lock_condition_attribute` okta |
| 이 자리에서 못 끊는다: Drive의 위에서 내려온 권한, IdP와 동기화된 GitHub 팀(API 403), SCIM 으로 들어온 Atlassian 그룹, Google 동적 그룹, Okta에서 그룹으로 받은 앱 배정(사람 단위로 못 푼다) | 각 줄 `cascades` |
| 생각보다 넓게 끊는다: Slack 봇 토큰 폐기는 봇을 끄고 채널 멤버십과 그 토큰의 수신 웹훅을 모두 지운다. 수신 웹훅 하나만 끊는 API는 찾지 못했다 | `revoke_token` slack, `disable_webhook` slack |
| 목록을 통째로 바꿔 쓴다: Slack `usergroups.users.update`는 한 명만 빼는 메서드가 아니다. 읽고 빼고 다시 쓰는 사이에 다른 변경과 부딪힐 수 있다 | `remove_group_member` slack |

## 잰 것

2026-10-31, aegi-adapter-engine `9755454`에서 데이터셋마다(2026-11-01 조직 단위 줄을 지운 사전으로 다시 재서 아래 수로 고쳤다. 저장소 데이터는 엔진 main `9722972`, 실측 묶음은 `d6d1a40`에서 쟀다) 운영 EA(`scripts/accessRules/production.ts`)와 범용 위협 판정(`detectThreats`, 시나리오 조치 템플릿까지)을 다시 돌리고, 회수 지점과 조치 문구마다 이 사전의 동사를 짝지었다. 짝짓는 기준은 회수 지점 관계의 SaaS, 관계, 양 끝 interface 가 SaaS 빈칸 한 줄의 `cut`과 맞는가이고, 정책 조치와 시나리오 템플릿은 `now`의 조치 id 다. 객체 종류 이름(`object_type`)으로 짝짓지 않는다. 같은 Slack 사용자가 데이터셋에 따라 `user`나 `200.members[*]`로 찍혀서다. 이름과 키는 세지 않았고, 실측 묶음은 수만 옮겼다. 실측 묶음은 10-30 판이다(운영 D1 current `20261030T100035Z-efb39e56-314c97`과 같은 판, 11-01 에 바꿔 쟀다. 10-31 의 표는 10-27 판이었다).

**EA 행**

| 데이터셋 | EA 행 | 회수 지점 없는 행 | 회수 지점(cut 항목) | 동사 있음: 문서 줄 / 추정 줄 / SaaS 줄 없음 | 그 가운데 이어서 할 동사가 필요한 곳 | 동사 없음 | 여러 행을 끊는 회수 지점 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/data/aegi_inc_environment_v2` (합성, 09-22) | 4 | 2 | 3 | 3 / 0 / 0 | 0 | 0 | 0 |
| `src/data/aegi_inc_measured_model_v1` (10-02) | 13 | 0 | 19 | 15 / 4 / 0 | 4 | 0 | 4곳(가장 많이 4행) |
| `src/data/aegi_inc_measured_model_v1_base` (10-12) | 3 | 0 | 5 | 5 / 0 / 0 | 0 | 0 | 0 |
| `src/data/aegi_inc_measured_v2` (10-20) | 6 | 0 | 6 | 5 / 0 / 1 | 4 | 0 | 0 |
| `adapter-auto-setup/local/normalized` (10-03) | 13 | 0 | 19 | 15 / 4 / 0 | 4 | 0 | 4곳(4행) |
| `adapter-auto-setup/local/pipeline-normalized` (10-03) | 13 | 0 | 19 | 15 / 4 / 0 | 4 | 0 | 4곳(4행) |
| 10-03 수집 원본을 다시 정규화 | 5 | 0 | 9 | 7 / 2 / 0 | 2 | 0 | 1곳(2행) |
| 10-30 실측 묶음(운영 current 와 같은 판, 수만) | 5 | 0 | 9 | 5 / 3 / 1 | 2 | 0 | 1곳(3행) |

「SaaS 줄 없음」 1곳씩은 Google Workspace 조직 단위 소속이다. 11-01 결정으로 회수 지점이 아니게 되어 SaaS 줄을 지웠고, 엔진 고침 뒤에는 그 행째 없어진다(아래 「조직 단위를 소속으로 세면」).

10-03 다시 정규화는 저장소 밖 작업 폴더에 만들었다. 입력은 엔진 저장소의 `adapter-auto-setup/local/pipeline-run` 회차 `20261003T004250Z-98b1`, 모델은 이 저장소 `schema/im-model/model/v3.2`다.

**위협**

| 데이터셋 | 범용 엔진 격차 | 회수 후보 없는 격차 | 회수 후보 간선: 문서 줄 / 추정 줄 | 그 가운데 이어서 할 동사가 필요한 곳 | 동사 없음 | 위협 | 조치 문구: 회수 후보 문장 / 동사로 짝 / 끊기 아님 / 짝 없음 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| environment_v2 | 6 | 4 | 3 / 0 | 0 | 0 | 6 | 3 / 6 / 2 / 0 |
| measured_model_v1 | 9 | 1 | 10 / 3 | 3 | 0 | 13 | 13 / 17 / 3 / 0 |
| measured_model_v1_base | 3 | 1 | 2 / 0 | 0 | 0 | 7 | 2 / 16 / 2 / 0 |
| measured_v2 | 0 | 0 | 0 / 0 | 0 | 0 | 1 | 0 / 4 / 0 / 0 |
| normalized, pipeline-normalized(같음) | 9 | 1 | 8 / 3 | 3 | 0 | 15 | 11 / 23 / 3 / 0 |
| 10-03 다시 정규화 | 8 | 1 | 6 / 3 | 0 | 0 | 15 | 9 / 25 / 2 / 0 |
| 10-30 실측 묶음 | 8 | 2 | 7 / 2 | 0 | 0 | 10 | 9 / 11 / 2 / 0 |

「회수 후보 문장」은 범용 엔진 회수 후보 간선을 `cutStep`이 옮긴 문장이라 위 「회수 후보 간선」 열에서 동사를 셌다. 「동사로 짝」은 정책 고정 문구, 시나리오 템플릿, 회수 후보 없는 격차의 기본 조치(`engine_gap_fallback`)다.

**조직 단위를 소속으로 세면** (11-01 결정 4번. 저장소 데이터는 엔진 `9722972`, 실측 묶음은 `d6d1a40` 바탕에서 잼)

| 데이터 | 지금 main: EA 행 / 회수 지점 | 엔진 고침과 조건 갈래 뒤: EA 행 / 회수 지점 | 위협 |
| --- | --- | --- | --- |
| `src/data/aegi_inc_measured_v2` (10-20) | 6 / 6 | 5 / 5 | 같음 |
| 10-30 실측 묶음(수만) | 5 / 9 | 4 / 7 | 같음 |
| 나머지 여섯(조직 단위 소속 없음) | | 같음 | 같음 |

빠지는 것은 두 데이터에서 `runs_as_inherits` 한 행씩이다(자동화가 실행 신원을 거쳐 조직 단위에 닿는다는 행). 10-30 실측 묶음에서는 그 행의 실행 신원도 회수 지점이라 회수 지점이 둘 준다. 범용 위협 판정은 세부까지 같다. 조직 단위로 가는 간선이 회수 후보에 없었기 때문이다. 엔진(손코드와 범용 엔진)만 먼저 고치면 운영 EA 는 그대로이고, 손코드 그림자에서 `runs_as_inherits`가 「운영만」 1행씩 생긴다. 운영 EA 는 실행기가 `relation_semantics.yaml` 사본을 읽으므로, 이 저장소에 조건 갈래가 들어가고 엔진이 사본을 맞춘 뒤 같아진다.

**읽는 법**

- **동사가 없는 회수 지점은 여덟 데이터셋 모두 0이다.** 다만 이 사전을 바로 이 데이터의 회수 지점 종류를 보고 만들었으니 0은 덮었다는 뜻이지 맞았다는 뜻이 아니다. 새 SaaS 나 새 규칙이 들어오면 다시 잰다. 재는 도구가 세는지는 일부러 틀린 사전 셋으로 봤다(아래 「확인」).
- **동사 하나로 안 닫히는 회수 지점**은 Drive 파일 주인이다. 주인 권한 줄(`has_role_on`, 역할 이름 owner)과 `owned_by`가 회수 지점인데, 벤더 문서는 주인을 넘기는 길만 적고(그냥 지울 수 없다는 것은 추정), 넘겨도 옛 주인이 편집자로 남는다. 그래서 「소유권 넘기기」 뒤에 「공유 끊기」를 이어서 해야 그 사람의 길이 닫힌다. 10-02와 10-03 데이터 EA 4곳과 위협 회수 후보 3개, 10-20 데이터 EA 4곳, 10-03 다시 정규화 EA 2곳, 10-30 실측 묶음 EA 2곳이다. 범용 엔진은 주인 권한 줄을 회수할 수 있는 간선으로 보고 「역할 회수」 문장을 낸다. 초안대로 두기로 정했고, 문장은 엔진이 사전을 읽을 때 바꾼다(「정한 것」 3, 5번).
- **추정 줄로만 끊기는 회수 지점**은 Apps Script 실행 신원과 배포 접근 범위 둘이다. 둘 다 API 칸이 문서에 그대로 없다. 10-31 에는 Google Workspace 조직 단위 소속(옮기기만 된다)도 추정 줄이었는데, 11-01 결정으로 회수 지점에서 빠진다(아래 「조직 단위를 소속으로 세면」).
- **회수 지점이 없는 EA 행**은 합성 데이터의 `x_delivery_exposure` 2행뿐이다. 채널 공개 여부를 모르고(`channel_visibility_unknown`) 스크립트와 웹훅이 주소 지문으로만 이어져(`script_webhook_by_url_fingerprint`) 끊을 홉이 없다. 동사가 아니라 사실이 모자란 곳이다.
- **회수 후보가 없는 위협 격차**는 실행 기록만 있는 격차다(10-30 실측 묶음 8개 가운데 2개). 엔진은 여기에 「호출 권한 제한」를 기본으로 넣는다. 동사는 있지만 끊을 사실이 그래프에 없다. 그대로 두기로 정했다(「정한 것」 6번).
- **동사 하나로 여러 행이 끊기는 곳**: 10-02와 10-03 데이터에서 Apps Script 하나의 실행 신원(`runs_as`) 한 줄이 EA 4행의 회수 지점이다. 채널 멤버십 두 줄이 각각 2행, Okta 서비스 앱 역할 한 줄이 2행(그 앱을 부르는 사람 둘)이다. 다시 정규화한 10-03에서는 실행 신원 한 줄이 2행이다. 10-30 실측 묶음에서는 실행 신원 한 줄이 3행이고, 조직 단위 행이 빠지면 2행이 된다.
- **10-30 실측 묶음에서 쓰인 동사**: EA 회수 지점은 실행 신원 바꾸기 3, 소유권 넘기기 2, 역할 회수 1, 그룹에서 빼기 1, 앱 배정 지우기 1이고, 나머지 1곳은 조직 단위 소속이다(결정으로 회수 지점이 아님). 위협 회수 후보는 앱 설치 지우기 3, 자원 멤버에서 빼기 3, 실행 신원 바꾸기 2, 역할 회수 1. 정책 고정 문구, 시나리오 템플릿, 기본 조치는 조건 속성 잠그기 3, 호출 권한 제한 3, 실행 신원 바꾸기 2, 권한 범위 줄이기 1, 토큰 폐기 1, 자원 멤버에서 빼기 1.
- **어느 데이터에도 안 나온 동사**는 셋이다. 웹훅 끄기, 권한 스킴 바꾸기(`x_dynamic_holder` 행이 어느 데이터셋에도 없다), 공개 범위 줄이기.

**확인**

- 재는 도구에 일부러 틀린 사전을 셋 넣었다(10-02 데이터). 그룹에서 빼기의 SaaS 줄을 지우면 회수 지점 2곳이 「동사는 있지만 SaaS 빈칸」, 소유권 넘기기를 지우면 2곳이 「동사 없음」, 정책 조치 `gen-mail-1`의 `now`를 지우면 「짝 없는 조치」 1로 바뀐다.
- 재는 도구는 엔진을 불러야 해서 이 저장소에 넣지 않았다. 엔진에 넣을지는 엔진이 이 사전을 읽게 할 때(「정한 것」 3번) 같이 본다.

## 헷갈리기 쉬운 것

| 낱말 | 이 문서 | 다른 곳 |
| --- | --- | --- |
| 조치 동사, cut action | 회수 지점을 끊는 사람의 일. `ontology/cut_actions.yaml` | Splunk 정규 이벤트의 행동(`action`) 칸은 감사 이벤트에서 일어난 일이다(`Splunk_Normalized_Event_Contract_v1`). Object의 Interface가 아니다 |
| 조치(remediation) | 이 문서는 쓰지 않는다 | 엔진 Finding 의 `remediation[]`(위협마다 보여 주는 조치 문구), 대시보드 `remediation_progress`(조치 진행 기록) |
| 회수 지점, cut | EA 행의 `cut[]`과 규칙 파일의 `cut` 홉. 동사가 끊는 자리 | 범용 접근 엔진의 `cuts`(`CutOption`, 끊어 보고 다시 푼 반사실 후보) |

## 정한 것 (2026-11-01, Relation 주담당 결정)

초안의 「정할 것」 여섯을 aegi-knowledge#149 에서 정했다. `ontology/cut_actions.yaml` `open`의 `decided`와 같다. 동사들의 `status`는 아직 `open`이다(2번).

| 무엇 | 정한 것 | 따라 바뀐 것, 할 일 |
| --- | --- | --- |
| 이름 | 조치 동사(cut action) 그대로. Splunk 이벤트의 `action`, 대시보드의 `remediation_progress`와 다른 것이다 | 없음 |
| 닫힌 어휘로 둘지 | 지금은 열어 두고 작업하다가 나중에 닫는다 | 닫을 때 동사의 `status`를 `adopted`로 옮기고, 그 뒤로는 바꿀 때 decision 이슈를 거친다 |
| 엔진이 이 사전을 읽을지 | 사전을 닫을 때 엔진이 읽게 한다. 그때 범용 위협 판정 `cutStep`의 「연결 해제」 문장부터 바꾼다 | 옛 네 곳(EA note, cutStep, 정책 고정 문구, 시나리오 템플릿)을 없앨 조건은 그때 `architecture/rules.yaml` `duplicates`에 적는다(R-no-new-parallel-path). 지금 엔진은 사본에서 생성한 `CUT_ACTIONS`를 `src/detection/cutActions.ts`(`cutStep`)로 읽는다. 정책 고정 문구는 쓰지 않는다 |
| 조직 단위 소속 | 소속으로 보고 EA 회수 지점에서 뺀다. 옮기기로 끊지 않는다 | 사전: 「자원 멤버에서 빼기」의 Google Workspace 조직 단위 줄을 지웠다. 엔진이 먼저 조직 단위로 가는 `member_of`를 소속(M)으로 세고(손코드 `accessHops`, 범용 엔진 `edges.ts`), 그 뒤 `relation_semantics.yaml` `member_of`에 조건 갈래를 두면 운영 EA 실행기가 사본으로 따라온다. 그러면 「자동화가 조직 단위에 닿는다」는 EA 행 자체가 없어진다(아래) |
| Drive 파일 주인 | 초안대로. 회수 지점으로 두고 「소유권 넘기기」 뒤 「공유 끊기」(`follow_with`) | 없음. 범용 엔진의 「owner 역할 회수」 문장은 3번(엔진이 읽을 때) 몫이다 |
| 회수 후보가 없는 격차 | 초안대로 그대로. 엔진이 「호출 권한 제한」를 기본으로 넣는다 | 없음 |

**조직 단위를 소속으로 세면 무엇이 바뀌나.** `runs_as_inherits`의 둘째 홉은 「실행 신원에서 나가는 G 간선」이다. 조직 단위 소속이 M 이 되면 그 홉이 서지 않으므로, 회수 지점만 빠지는 것이 아니라 「이 자동화가 조직 단위에 접근할 수 있는가」라는 행이 통째로 없어진다. 조직 단위는 정책 범위라 그 행의 질문 자체가 뜻이 없다. 데이터에서 잰 수는 「잰 것」의 조직 단위 표에 있다.

## 닫은 동사 (2026-11-02)

「정한 것」 2, 3번대로 사전은 열어 두고 작업하다가 닫고, 엔진은 닫은 동사부터 읽는다. 첫 몫으로 범용 위협 판정이 「연결 해제」라고만 말하던 문장을 대신할 동사를 닫았다.

**「연결 해제」는 동사 하나가 아니다.** 범용 판정(`cutStep`)은 회수 후보 간선의 제목을 G 의 멤버와 역할, T 의 「누구나 호출 가능」만 따로 쓰고 나머지는 모두 「X 와 Y 연결 해제」로 쓴다. 그 나머지를 데이터에서 사전 동사로 짝지으면 셋이 나온다(엔진 main `15cb046`, 저장소 데이터셋 다섯과 10-30 실측 묶음, 수만).

| 동사 | 끊는 사실 | 「연결 해제」 문장 | 그 가운데 10-30 실측 묶음 | SaaS 줄 |
| --- | --- | --- | --- | --- |
| 앱 설치 지우기 `uninstall_app` | Slack 앱 설치가 봇 사용자로 대행(`acts_as` Integration>Principal) | 7 | 3 | 문서 |
| 실행 신원 바꾸기 `change_run_as` | Apps Script 의 실행 신원(`runs_as` Automation>Principal) | 6 | 2 | 추정(API 칸) |
| 그룹에서 빼기 `remove_group_member` | GitHub 팀 소속(`member_of` Principal>Principal, M 간선) | 1 | 0 | 문서 |

그래서 「연결 해제」 하나를 닫는 대신 이 셋을 닫았다(`status: adopted`). 데이터의 「연결 해제」 문장 14개가 모두 이 셋으로 간다. 셋 말고 남은 동사는 `open`이다.

**닫는 기준.** (1) 데이터에서 그 동사가 맡는 사실이 SaaS 빈칸 한 줄로 하나씩 정해진다(「한 사실에 한 동사」). (2) 그 동사에 걸린 미결이 없다. (3) SaaS 빈칸 줄이 하나 이상 있고 `blank` 줄이 없다(검사 A6). 실행 신원 바꾸기의 Google Workspace 줄은 API 칸이 추정이지만(배포 설정에 실행 신원 칸이 없어 매니페스트를 고친 새 버전으로 바꾼다), 끊는 사실과 화면 경로는 분명해서 닫았다. 추정은 그 줄의 `checked`에 남는다.

**닫으면 무엇이 정해지나.** 동사의 `id`, 이름, 끊는 사실(`cuts`), 뜻(`says`)이다. 이것을 바꾸려면 decision 을 거친다. SaaS 빈칸의 벤더 값(API, 화면, 되돌리기, 문서)은 닫은 뒤에도 고친다. 벤더가 바뀌기 때문이다.

**엔진.** 엔진은 사본의 닫은 동사만 읽어, 끊는 곳(EA 행의 `cut`, 범용 엔진 회수 후보 간선)에 동사를 붙이는 판정을 그림자로 먼저 둔다(aegi-adapter-engine `feat/cut-action-shadow`). 운영 결과는 그대로이고, 정규화 실행 보고서에 붙은 수만 남긴다. 문장을 바꾸는 것은 그림자 수를 본 뒤다.

## 문장틀 (2026-11-03, 구조 개편 5단계)

EA 회수 지점 설명의 문장틀(`phrases.ea_cut`)만 남는다. 엔진(`src/detection/cutActions.ts` `eaCutNote`)은 틀에 값을 채우기만 하고 손 문장을 두지 않는다.

2026-11-18 에 범용 위협 판정의 회수 후보 문장(동사의 `phrase`, `now` 의 engine_cut_step 과 engine_gap_fallback 자리, 범용 틀 `cut_effect`, `cut_weakens`, `cut_collateral`, `ui`, `follow_with`, `unlink`, `invoke`)을 지웠다. 그 문장을 만들던 엔진 `cutStep`, `gapFallbackStep` 을 부르는 곳이 없어졌기 때문이다(aegi-adapter-engine #467).

**닫은 여덟.** 범용 판정의 나머지 제목(자원 멤버에서 빼기, 역할 회수, 공유 끊기, 소유권 넘기기)과 정책 위협 고정 문구 11개(메일 자동 전달 끄기, 공유 끊기, 실행 신원 바꾸기, 권한 범위 줄이기, 토큰 폐기, 조건 속성 잠그기, 역할 회수)가 쓰는 동사다. 「닫은 동사」의 닫는 기준을 모두 채운다(검사 A6). 호출 권한 제한(`restrict_invokers`)는 Slack 줄(`entry_points`)이 blank 라 열어 두었다가 2026-11-04 에 닫았다(아래).

**2026-11-04 에 닫은 둘.** 운영 current 에 남은 범용 문장 넷(「연결 해제」 둘, 「사용 범위 제한」 둘)을 대신한다. 「연결 해제」 둘은 같은 Slack 수신 웹훅에 걸린 간선이다(다른 SaaS 자동화가 그 웹훅 주소로 보내는 A, 그 웹훅이 채널에 올리는 G). 「사용 범위 제한」 둘은 회수 후보가 없는 격차의 행위자다(Slack 슬래시 명령, Google Workspace 웹앱).

| 동사 | 근거(벤더 문서) | Slack 줄 |
| --- | --- | --- |
| 웹훅 끄기 `disable_webhook` | Slack OAuth 설치 문서: 사용자가 자기 설정을 지우거나 봇 토큰을 폐기하거나 앱을 지우면 그 인증에 묶인 수신 웹훅이 지워진다. 화면은 앱 관리 도움말의 Authorizations > Revoke | 추정 → 문서 |
| 호출 권한 제한 `restrict_invokers` | Google: 웹앱 실행 권한 `access`(MYSELF, DOMAIN, ANYONE, ANYONE_ANONYMOUS)가 누가 부를 수 있는지 정한다. Slack: Enterprise 요금제에서 관리자가 앱과 상호작용을 시작할 사람(모두, 아무도, 특정 사람과 그룹)을 고른다 | blank → 추정(슬래시 명령까지 드는지는 문서에 없다. 다른 요금제에는 설정이 없어 앱 코드나 앱 설치 지우기) |

**자리 값.** `{이름}` 은 엔진이 채우는 값이고, `{이름|과/와}` 처럼 조사를 붙인다. 값이 빠지면 엔진이 멈춘다. 이름의 목록과 뜻은 `ontology/cut_actions.yaml` 머리말에 있고, 검사 A7 이 틀마다 이름과 조사를 본다.

**EA 회수 지점 설명.** `x_scope.note`(그 회수 지점에서 끊으면 누가 영향을 받나)는 `phrases.ea_cut` 에 회수 지점(`<규칙 id>.<홉 이름>`)마다 하나 둔다. 동사가 아니라 회수 지점에 매인다. 한 회수 지점을 SaaS 마다 다른 동사가 끊기 때문이다(`runs_as_inherits.h` 는 역할 회수, 공유 끊기, 소유권 넘기기). 엔진 운영 EA(`scripts/accessRules/production.ts`)와 손코드 규칙(`effectiveAccess/rules`)이 같은 틀을 부른다. 처음 옮길 때는 엔진 문구를 글자 그대로 옮겼다(운영 EA 바이트 그대로). 검사 A7 이 회수 지점과 키가 하나씩 맞는지 본다.

## 관련 문서

- [Effective_Access_Schema_v1](Effective_Access_Schema_v1.md) 「회수 경로」: `cut`은 조치용, 회수 지점은 지금도 집행되는 관계만
- [Path_Rule_Schema_v1](Path_Rule_Schema_v1.md): 규칙의 `cut` 칸과 `affects`
- `ontology/access_patterns.yaml`: 2층 권한 방식, 공통 양식과 SaaS 빈칸
- aegi-adapter-engine `docs/spec/AEGI_GENERIC_ACCESS_ENGINE_V1.md`: 범용 접근 엔진의 회수 후보(반사실)
