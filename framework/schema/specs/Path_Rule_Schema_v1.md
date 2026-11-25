# 경로 규칙 형식 v1 (초안)

경로 규칙은 "이런 관계 경로가 있고 이런 조건이면 이런 결론을 낸다"를 적는 형식이다. Effective Access의 합성 규칙과 이벤트 연결 규칙이 같은 형식을 쓴다. 형식은 하나, 규칙 묶음은 둘이다.

상태: 초안. 2026-10-25 작성. 2026-10-26에 첫 규칙 파일 `ontology/access_rules.yaml`(EA 규칙 5개, 초안, aegi-adapter-engine `23098e0` + 고칠 거리 2의 손코드에서 옮김)과 검사 `validation/check_path_rules.py`를 더했다. 엔진에는 이 형식의 일부 문법을 읽는 실행기와 ea:rules-compare가 aegi-adapter-engine#130(10-27 머지)부터 있고, #136(10-28 머지)부터 운영 정규화마다 그림자로 돌아 손코드와 비교한다. 미지원 문법은 보고한다. #147(10-29 머지)부터 운영 EA의 `runs_as_inherits` 일반 행은 실행기 결과이고(`scripts/accessRules/production.ts`), 손코드는 그림자가 견줄 쪽으로 남는다. 다른 규칙은 운영에서도 손코드 결과다. 지금 EA 코드를 이 형식으로 옮겨 본 결과는 EA 진단표 v1에 있다. 기존 파일에 대한 서술은 aegi-knowledge `4fb8aec`, aegi-adapter-engine `d78062d` 기준이고, 별도 검토 에이전트가 대조했다.

## 왜 필요한가

관계 명세는 관계마다 "양끝에 올 수 있는 interface"(template)와 "만드는 간선"(effects)을 파일에 적고, 엔진이 그것을 읽는다. 그런데 관계를 두 홉 이상 이어서 내리는 결론은 아직 파일에 없다.

| 결론 | 지금 | 문제 |
| --- | --- | --- |
| Effective Access ("실제로 할 수 있는가") | aegi-adapter-engine `src/detection/v2/effectiveAccess/`의 손코드 규칙 5개와 시나리오 질문 3개 | 시나리오에 맞춘 경우만 잡는다. 규칙의 관계 종류와 조건이 코드에 박혀 있다 |
| 이벤트 연결 (Event Timeline의 앞뒤 잇기) | aegi-adapter-engine `src/events/eventLinks.ts`의 근거 6개: 원인 명시, 같은 세션, Okta SSO 인계, 같은 사람과 IP, 같은 사람과 시간, 같은 객체 | 원본 값, 동일인 연결, 시간만 본다. 관계 그래프를 쓰지 않는다 |

두 결론은 모양이 같다. 관계 경로를 따라가고, 조건을 보고, 결론과 그 근거를 남긴다. 그래서 형식을 하나로 만든다.

[Effective_Access_Schema_v1](Effective_Access_Schema_v1.md)은 이미 "여러 홉을 잇고 싶으면 그 합성을 규칙으로 명시해서 `rule`에 적는다. 자동으로 닫지 않는다"고 정했다. 이 문서는 그 규칙을 적는 모양을 정한다.

## 재료

새 어휘를 만들지 않는다. 이미 있는 것만 쓴다.

| 재료 | 정본 | 이 형식에서 쓰는 곳 |
| --- | --- | --- |
| 관계 17종과 방향 | `ontology/relation_types.yaml` | `relation` 홉 |
| 관계가 만드는 간선 (M, U, G, T, A, F)과 방향 | `ontology/relation_semantics.yaml` effects | `edge` 홉 |
| 동일인 연결 단계 | `ontology/identity.yaml` link_levels | `link` 홉, 결론 강도 |
| 조건식 | `ontology/match.py` | `where`, `uncertain_if`, `skip_if` |
| interface 9종 | `ontology/interfaces.yaml` | 홉의 끝점 제한 |

## 규칙 하나의 모양

```yaml
- id: member_grant              # 규칙 이름. 결론 행의 source.rule 에 들어간다
  for: access                   # access (Effective Access) | event (이벤트 연결)
  status: draft                 # production(운영이 돌림) | draft(적어 두고 시험만) | off(끔). 2026-11-18
  says: 그룹에 소속되어 그 그룹의 역할을 받는다
  path:                         # 홉 목록. from 은 앞에서 묶인 변수다(보통 앞 홉의 도착. 갈래 모양이면 더 앞의 변수)
    - {as: m, relation: member_of, from: $p, to: $g}
    - {as: h, relation: has_role_on, from: $g, to: $x}
  distinct: [$p, $g, $x]        # 세 자리는 서로 다른 객체여야 한다
  where:                        # 경로가 성립하는 조건 (match.py 식)
    not:
      any:
        - {exists_relation: {type: excludes, source: $h.role, target: $p}}
        - {exists_relation: {type: excludes, source: $h.role, target: $g}}
  skip_if:                      # 맞으면 결론을 내지 않는다 (측정 계정, 측정용 소속)
    any:
      - {$p: {meta: {demo_role: measurement_principal}}}
      - {$m: {property: {measurement_principal: true}}}
  yields:                       # 결론
    source: $p
    target: $x
    capability: {rank_from: h}  # 능력 순위는 이 홉에서 (capabilities.yaml)
    query: "{$p} 이 {$g} 소속으로 {$x} 에 {h.role} 역할을 가지는가"
  cut:                          # 회수 지점 후보. 공통 규칙(아래)을 통과한 홉만 된다
    - {hop: m, affects: source_only, when: {$h: {property: {membership_enforced: true}}}}   # 집행 표시는 부여 관계 행에 (아래 「조건식의 자리」)
    - {hop: h, affects: group}
  undecomposed_if:              # 맞으면 단계는 그대로 두고 그 홉을 못 푼 구간으로 남긴다
    - {hop: m, reason: enforcement_unknown, when: {not: {$h: {property: {membership_enforced: true}}}}}
  tests:                        # 만든 세계 시험. 맞는 예와 틀린 예를 둘 다 둔다
    - {world: tests/member_grant_basic.yaml, expect: rows}
    - {world: tests/member_grant_excluded.yaml, expect: none}
```

### 홉의 종류

| 홉 | 모양 | 뜻 | 쓰는 곳 |
| --- | --- | --- | --- |
| 관계 | `{relation: member_of, from: $a, to: $b}` | 저장된 관계 행 하나. 방향은 관계 어휘 방향 그대로 | 뜻이 정해진 관계를 콕 집을 때 |
| 간선 | `{edge: G, from: $a, to: $b}` | 그 방향으로 이 간선을 만드는 관계 아무거나. 어느 관계가 어느 방향 간선을 만드는지는 effects가 정한다. `skip_uncertain: [사유]`를 달면 그 사유가 붙은 간선은 따라가지 않는다. `relation_to_interface: <interface>`는 간선을 낸 관계의 도착이 그 interface 인 간선만 고른다(조직에 걸린 역할이 리소스 세트로 좁혀져 도착이 덮는 대상이어도 따라간다). `scopes_of: $토큰`은 그 토큰의 scope 가 덮는 간선만 고르고(capabilities.yaml `token_scopes`), 세기는 역할과 scope 가운데 작은 것이며 결론 행의 `x_capability`에 적는다. 이때 앞 홉의 `token_scope_limited`는 풀린다. `skip_caps_only: [능력]`은 간선의 능력 목록(관계 의미 층 caps, capabilities.yaml `capability_vocabulary` 이름)이 그 능력 안에만 있으면 따라가지 않는다. 로그인 · 동의만 주는 부여(`authenticate`)를 대신 동작하는 앱이 물려받지 않게 할 때 쓴다. 능력을 모르는 간선은 따라간다. `automation_scope: $자동화`는 그 자동화의 범위 안에 도착하는 간선만 고른다(semantic_mapping.yaml `automation_scopes`. 범위가 수집되지 않은 자동화는 자르지 않는다) | "접근을 주는 아무 관계"처럼 넓게 받을 때 |
| 역방향 | `{relation: member_of, from: $a, to: $b, reverse: true, why: "..."}` | 관계를 도착에서 출발로 거슬러 간다. `why`가 꼭 있어야 한다 | 공동 소속처럼 꼭 필요할 때만 |
| 동일인 | `{link: strong, from: $a, to: $b}` | 동일인 연결 한 단계. `strong`은 resolved, disclosed_relation만. `any`는 different 밖 전부. 허브를 거쳐 간선 둘이 되면 경로의 단계는 가장 약한 간선이고, 약한 간선은 하나까지만 쓴다 | SaaS를 건너는 사람 |
| 참조 | `{ref: lead, from: $a, to: $b}` | 객체 참조 칸(`references.lead`) | 관계가 아니라 참조로 정해지는 보유자 |
| 속성 줄 | `{item: properties.permissions, from: $a, as: line}` | 객체 속성 목록의 한 줄. 줄 칸은 `$line.holder_type`처럼 읽는다 | 권한 스킴 줄 같은 배정 레코드 |
| 빈 구간 | `{gap: script_webhook_by_url_fingerprint, from: $a, to: $b}` | 저장된 사실이 없는 구간. 결론은 언제나 indeterminate. 관계 홉에 `else_gap: <사유>`를 달면 그 관계가 없을 때 그 자리를 빈 구간으로 본다 | 지금은 관계로 못 잇는 구간을 정직하게 적을 때 |

갈래가 있으면 `path` 대신 `any_of: [path, path]`를 쓴다. 갈래마다 결론 행이 따로 나온다(EA 규격 "한 행은 한 경로다").

**"접근을 주는 아무 관계"는 간선 홉으로 받는다.** 관계 이름이나 화면용 표현 등급(`relation_types.yaml` grades)이 아니라 effects가 정한 간선과 방향을 따라가야 한다. 그래야 소속일 뿐인 관계(그룹이나 테넌트로 가는 `member_of`는 M), 방향이 뒤집힌 관계(`owned_by`는 주인에서 자원으로 G), 효과가 없는 관계(`excludes`, `applies_to`, `evaluates`, `permits`)를 접근으로 잘못 세지 않는다. EA 명세 「첫 규칙」과 `check_twohop.py`는 2026-10-25에 `runs_as_inherits`의 둘째 홉을 「접근 등급」에서 이 G 간선으로 바꿨고, 엔진도 같다(aegi-adapter-engine `e33a1dd`, #99). 바꾸기 전의 영향은 EA 진단표 5장에 있다.

### 규칙 칸

| 칸 | 뜻 |
| --- | --- |
| `distinct` | 이 자리들은 서로 다른 객체여야 한다 (그룹이 자기 자신에 역할을 갖는 행 같은 것을 뺀다) |
| `where` | 경로가 성립하는 조건. 거짓이면 결론이 없다 |
| `skip_if` | 참이면 결론을 내지 않는다. 측정 계정, 배경(전원 공유) 같은 것 |
| `uncertain_if` | 참이면 결론 단계가 indeterminate로 내려가고 사유가 남는다 |
| `undecomposed_if` | 참이면 단계는 그대로 두고 그 홉을 못 푼 구간(`undecomposed`)으로 남긴다. 회수 지점을 못 대는 것과 성립 여부를 못 정하는 것은 다르다(EA 규격 「집행되는 경로와 권한이 생긴 이력은 다르다」) |
| `cut` | 회수 지점 후보와 조건. 누가 같이 잃는지(`affects`)를 적는다 |

### 조건식의 자리

`where`, `skip_if`, `uncertain_if`, `cut.when`은 `ontology/match.py` 식을 그대로 쓴다. 자리 이름만 넓힌다.

| 자리 | 뜻 |
| --- | --- |
| `$p`, `$g` 같은 경로 변수 | 그 자리에 놓인 객체 |
| `$h` 같은 홉 이름 | 그 홉의 관계 행. `$h.role`은 그 관계의 역할 객체 |
| `$line` 같은 속성 줄 이름 | 속성 목록의 한 줄 |

match.py는 `exists_relation`의 `source`, `target`, `property` 값에서 이미 `$자리`를 받는다(`$role`, `$source` 같은 것). 검사(`errors`)는 부르는 쪽이 자리 목록을 넘긴다. 이 형식을 구현할 때 더할 것은 둘이다.

| 더할 것 | 왜 |
| --- | --- |
| 경로 변수를 식의 자리 키로 (`{$p: {meta: ...}}`) | 지금 자리 키는 고정된 이름(`source`, `target`, `role` 등)만 된다 |
| 점으로 잇는 참조 (`$h.role`) | 홉의 관계 행에서 역할 객체를 꺼낸다 |

**집행 표시는 부여 관계 행의 속성 `membership_enforced`다.** 그룹에서 빼면 그 그룹의 부여가 실제로 사라지는지는 부여 하나마다 정해지고, 그 부여를 만드는 Profile의 관계 선언이 적는다(`Profile_Schema_v4.2` 「`membership_enforced`」, 2026-10-29 결정). 정규화가 그 값을 관계 행 `properties`로 옮기고(`basis`가 `properties.basis`로 들어가듯), 규칙은 부여 홉의 속성을 보는 보통 식(`{$h: {property: {membership_enforced: true}}}`)으로 읽는다. 따로 집행 검사 식이나 표를 두지 않는다. `true`가 아닌 것(없음, `false`)은 모두 회수 지점이 아니다.

> 앞 판은 집행 검사 `enforced: {table, group, grant}`를 「더할 것」으로 두고, 그 표가 그룹과 부여 대상의 종류를 같이 봐야 한다고 적었다. 값이 부여 관계 행에 실리면 그 관계 하나로 답이 나온다(그 관계를 만든 Profile이 그룹 쪽을 이미 정했다). 그래서 뺐다.

`true`를 적을 곳은 Okta 앱 그룹 배정 하나다(그룹에서 빼자 15초 안에 앱 배정이 사라짐, `reports/EA_Validation_Report_v2.md` §7.1). 엔진 손코드(aegi-adapter-engine `src/detection/v2/effectiveAccess/common.ts` `membershipEnforced`)는 같은 판단을 코드 안 표로 한다. 거기서는 GitHub 팀과 저장소도 맞다고 보고, Okta 그룹의 부여가 배정 모양이면 대상 종류와 상관없이 맞다고 본다. 둘 다 끊어 본 기록이 없어 Profile에는 적지 않는다(`access_rules.yaml` `x_member_grant` differs. Okta 쪽은 지금 실측에서 그룹 → 앱 말고는 그런 행이 없어 잠재 차이다).

**아직 안 된 것.** 엔진 정규화가 Profile의 이 값을 관계 행에 싣는 일은 후속이다. 그 전까지 실행기는 모든 그룹 부여를 모름으로 읽는다.

### 결론

| 칸 | access | event |
| --- | --- | --- |
| 무엇을 남기나 | EA 행 (`references`, `level`, `via`, `cut`, `undecomposed`, `source.rule`) | 이벤트 연결 (`from`, `to`, `basis`, `strength`, `via`) |
| `via` | 경로의 홉이 가리키는 관계 행과 Link 간선. 순서대로 | 같음 |
| 강도 | `level`: computed, computed_cross, indeterminate | `strength`: confirmed, review |

## 공통 규칙 (형식이 정하고 규칙마다 다시 적지 않는다)

| 규칙 | 내용 | 근거 |
| --- | --- | --- |
| 자동으로 닫지 않는다 | 규칙에 적힌 경로만 잇는다. 결론 행을 다시 입력으로 쓰지 않는다 | EA 규격 「전이를 어느 단계에서도 안 닫는다」 |
| 결론 강도 | access: 빈 구간이 있거나, 약한 Link 간선을 지나거나(그 홉을 `identity_link_weak` 또는 `identity_weak`로 못 푼 구간에 남긴다), 규칙의 `uncertain_if`가 맞으면 indeterminate. 관계 홉과 간선 홉이 효과 표와 간선에서 받은 사유(조건 갈래의 불확실, 역할 세기를 모름)도 indeterminate로 내린다(2026-11-03, 아래 「닿음 핵심 위의 모양 거름」). basis가 computed인 관계 홉은 단계를 내리지 않고 그 못 푼 구간을 물려준다. event: basis가 computed나 flag인 홉, 약한 Link, 빈 구간이 하나라도 있으면 review | EA 규격 「undecomposed」(벤더가 합친 관계도 computed 결론의 via로 들어온다), 이벤트 연결 v1 |
| 약한 Link는 경로에 하나까지 | 동일인 홉의 단계는 그 경로에서 가장 약한 간선이다. 약한 간선은 하나까지만 쓰고, 둘 이상은 잇지 않는다(2026-10-29 정함, Link 「정한 것」). `link: any`로 약한 간선을 건너면 access 결론은 indeterminate, event 강도는 review로 내려간다 | EA 규격 「단계」, 「이 파일이 지켜야 할 것」, Link 「두 계정 사이의 단계」 |
| 회수 지점 | basis가 stated이고 `decomposable`이 false가 아닌 관계 홉만 `cut`에 들어갈 수 있다 | EA 규격 「회수 경로」("지금도 집행되는 관계"). 기준은 aegi-adapter-engine `effectiveAccess/common.ts` `isRevocable`과 범용 접근 엔진 §2-1 |
| 물려받는 못 푼 구간 | basis computed이거나 `decomposable: false`인 관계 홉은 그 `undecomposed`를 결론에 물려준다 | EA 규격 「undecomposed」 |
| SaaS를 건너면 | 경로가 Link를 타서 provider를 건너거나, 교차 관계 홉(양 끝 provider가 다르거나 `cross_provider` 표시)을 지나면 access 결론은 computed_cross. 단계를 indeterminate로 내리는 조건이 먼저다 (2026-10-29 정함, 아래 「정한 것」) | EA 규격 「단계」, 「이 파일이 지켜야 할 것」 |
| 부정을 먼저 본다 | access 규칙에서 역할을 거치는 홉은 그 역할의 `excludes`를 본다. 규칙이 따로 적지 않아도 실행기가 본다 | EA 규격 「계산이 반드시 읽어야 하는 것」 |
| 조건 갈래 | 관계 홉과 간선 홉 모두 그 관계와 칸의 조건 갈래(`relation_semantics.yaml` conditions: 제외된 역할, 지운 배정 등)를 따른다. 갈래가 효과 없음이면 그 홉은 성립하지 않고, 불확실이면 그 사유를 결론에 남기고 단계를 내린다(2026-11-03부터. 앞 판은 남기기만 했다) | `relation_semantics.yaml` conditions |
| 시나리오를 모른다 | 규칙에 시나리오 키, 바인딩, 데이터셋 이름을 쓰지 않는다. 시나리오는 규칙이 아니라 `tests`와 정답으로 간다 | aegi-adapter-engine `docs/spec/AEGI_GENERIC_ACCESS_ENGINE_V1.md` 「시나리오 키, 바인딩은 읽지 않는다」 |

## access와 event가 다른 곳

같은 관계라도 쓰임이 다르다. 그래서 규칙 묶음을 나눈다.

| 관계 | access 규칙에서 | event 규칙에서 |
| --- | --- | --- |
| `runs_as` | 쓴다. 자동화는 실행 신원의 권한으로 돈다 | 쓴다. 자동화 실행 이벤트 뒤에 실행 신원의 행위 이벤트가 온다 |
| `triggered_by` | **못 쓴다.** 트리거한 사람은 자동화의 권한을 갖지 않는다. 검사가 막는다 | 쓴다. 가장 중요한 인과 근거다 |
| `member_of` (그룹) | 쓴다. 그룹의 권한을 받는다 | 거의 안 쓴다. 같은 그룹이라는 것만으로 두 행위가 이어지지 않는다 |
| `contained_in` | 상위 범위로 권한이 내려갈 때만 | 같은 객체 안의 변경을 묶을 때 |

## event 규칙의 모양

event 규칙은 경로 양끝에 이벤트가 하나씩 붙는다. 이벤트는 Splunk 정규 이벤트(`Splunk_Normalized_Event_Contract_v1`)의 행위자(actor)와 대상(targets)으로 객체에 닿는다.

```yaml
- id: automation_runs_as
  for: event
  status: draft
  says: 자동화가 실행되고, 그 실행 신원이 행위를 한다
  path:
    - {as: r, relation: runs_as, from: $x, to: $p, from_interface: Automation, to_interface: Principal}
  events:
    first: {touches: $x, as: target}        # 앞 이벤트가 자동화 X 를 대상으로 한다
    then:  {touches: $p, as: actor}         # 뒤 이벤트의 행위자가 실행 신원 P 다
    window: 0s..30s
  yields:
    basis: relation:runs_as
    strength: confirmed                     # 공통 규칙에 따라 경로가 약하면 review 로 내려간다
```

`triggered_by`는 방향을 반대로 쓴다. 앞 이벤트의 행위자가 트리거 주체이고, 뒤 이벤트의 대상이 자동화다. 이벤트 연결 규칙의 목록과 지금 근거 6개와의 관계는 이벤트 연결 진단에서 따로 정한다.

이벤트 연결은 신원 근거로 다시 들어가지 않는다. 방향은 한쪽이다: 설정, 로그 한 줄의 두 id, 시간창 반복 → 신원 연결 → 이벤트 연결.

## 검사 (구현할 때)

| 검사 | 막는 것 |
| --- | --- |
| 모양 | 모르는 칸, 홉 종류, 변수를 쓰기 전에 묶지 않음, `distinct`에 없는 변수 |
| 효과와 어긋남 | 간선 홉이 아닌 관계 홉으로 "접근"을 받는데 그 관계와 방향이 G 간선을 만들지 않음 |
| 어휘 | 17종 밖 관계, effects에 없는 간선과 방향 |
| access 경로에 `triggered_by` | 트리거한 사람에게 권한을 주는 규칙 |
| 약한 Link 간선을 지난 access 결론이 indeterminate가 아님 (실행 결과) | 약한 근거 위의 확신 |
| 동일인 홉이 약한 간선을 둘 이상 지남 (실행 결과) | 약한 Link 전이 |
| 역방향 홉에 `why`가 없음 | 근거 없는 거슬러 가기 |
| `where` 식 | `match.py errors`로 모양 검사 |
| `tests` | 맞는 예에서 행이 나오고 틀린 예에서 안 나오는지 |

## 닿음 핵심 위의 모양 거름 (2026-11-03)

2026-11-03 구조 개편 2단계로 정했다(사용자 허락). 계산은 이렇게 나뉜다.

- **닿음 핵심.** 위협 엔진의 간선 7종과 그 위의 길 질의다.
  - 엔진 `engine/edges.ts`, `relationEffects.ts`, `query.ts`, `reach.ts` 가 맡는다.
  - 관계 행 하나의 뜻은 효과 표 읽기 하나가 정한다(`relation_semantics.yaml`, 엔진 `relationEffects.ts`).
- **EA 거름.** 규칙 파일의 규칙은 길을 스스로 찾지 않는다. 닿음 핵심이 내준 걸음 가운데 규칙이 적은 모양만 골라 EA 행을 만든다(엔진 `scripts/accessRules/executor.ts` 의 core 입력).
- **결과를 받아 쓰는 쪽.** Access Gaps, 피해범위, 조치는 지금처럼 결과를 받아 쓴다.

### 홉을 핵심에서 받는 법

| 홉 | 닿음 핵심에서 | 차이 |
| --- | --- | --- |
| 관계 | 그 관계 행이 홉이 가리키는 칸에서 서는지. 효과 표 칸이 막히지 않았으면 선다. 효과 표가 그 행의 칸을 하나도 적지 않았으면 관계 행이 있는 것으로 선다. 위협 간선이 건너뛴 행(측정 도구 계정이 출발이거나 측정 도구 소속)은 서지 않는다 | 사유는 그 행이 낸 간선마다 그 행이 단 것이다. 역할 세기를 모르면 간선이 `role_rank_unknown` 을 단다 |
| 간선 (`edge: G`) | 설정 층 G 간선 가운데 관계 행이 출처인 것. 차례는 출발 객체의 나가는 관계, 들어오는 관계 차례 | 객체 참조(owner, author, 권한 배정 객체), 사전 표 규칙(visibility_scoped, open_respondent_resources)이 출처인 G 와 끝이 grant, everyone, tenant 인 효과는 EA 모양에 넣지 않는다(2026-11-16 결정, aegi-knowledge#311). 넣으면 EA 행이 위협 판정처럼 늘어난다. 2026-11-03 측정에서 테넌트 소속 쌍만 데이터셋마다 150~2692쌍이었다. 사람 계정이 이 G 로 닿는 곳은 엔진 직접 권한 모듈(`src/detection/v2/engine/directAccess.ts`)이, 자동화, 실행 신원, 토큰을 거쳐 닿는 곳은 엔진 파생 접근 층(`src/detection/threat/derived.ts`)이 구한다 |
| 동일인, 참조, 속성 줄, 빈 구간 | 핵심에 간선이 없다. 실행기가 그래프를 직접 본다 | 핵심이 그 간선을 가지면 옮긴다(아래 「정할 것」) |

**걸음은 출처마다다.** 간선은 같은 두 끝, 종류, 세기면 출처를 합친다(더 단단한 사유만 남는다). EA는 「한 행은 한 경로」라서 핵심은 간선의 출처(관계 행)마다 걸음을 따로 내주고, 사유도 그 출처가 낸 것을 준다.

**층.**
- 설정 층: 출처가 관계, 참조, 사전 표 규칙, 링크, overrides 인 간선.
- 관측 층: 출처가 관측, 증거인 간선.
- 한 간선이 두 층의 출처를 같이 가질 수 있다.
- EA 규칙은 설정 층만 본다(아래 「정한 것」의 「관측을 근거로 쓰나」). 위협 질의는 두 층을 다 본다.
- 그래서 같은 쌍에 두 답이 남는다. EA 행은 설정만 본 결론이고, 위협 판정은 관측까지 본 결론이다.

### 규칙의 모양

간선 종류는 relation_semantics.yaml effects 가 그 관계, 그 칸에 적은 것이다(M 소속, G 권한, A 대행, F 사본, U 상위 범위).

| 규칙 | 간선 종류 차례 | 끝 객체 종류 | 층 | 핵심 밖 홉 |
| --- | --- | --- | --- | --- |
| `runs_as_inherits` | A(runs_as, 도착 Principal), G(관계 행 출처) | Automation에서 아무 객체로 | 설정 | 없음 |
| `x_member_grant` | M(member_of, 도착 Principal인 그룹), G(has_role_on) | Principal에서 아무 객체로 | 설정 | 없음 |
| `x_dynamic_holder` | applies_to(효과 없음이라 관계 행만), 참조 lead, 속성 줄 | 리드 Principal에서 Project로 | 설정 | 참조, 속성 줄 |

### 사유가 단계를 내리나

사유 이름은 `ontology/uncertainty.yaml` `engine_reasons` 하나다. 단계를 내리는지는 사유 이름이 아니라 그 사유가 어디서 왔나로 정한다(같은 파일 `reason_levels`).

| 자리 | 단계 | 뜻 |
| --- | --- | --- |
| 효과 표와 간선이 단 사유, `uncertain_if`, 빈 구간, 약한 Link | indeterminate로 내린다(위협 질의의 비용 1과 같다) | 그 권한이 정말 넘어가는지 모른다 |
| `undecomposed_if` 의 사유(`enforcement_unknown`, `public_channel`, `channel_visibility_unknown`), 벤더가 합친 관계의 펼친 길(EA 행의 `vendor_paths` 칸) | 그대로 | 닿는 것은 안다. 그 단계를 끊으면 막히는지(회수)를 모른다. 회수 지점에서 빠질 뿐이다 |

이렇게 하면 앞서 따로 놀던 셋이 정리된다.
- `enforcement_unknown`: 회수만 모르는 사유라 단계를 내리지 않는다. 위협 엔진은 소속 간선을 닿음으로 확실하게 보므로 같은 뜻이다.
- `vendor_paths`: 사유가 아니라 펼친 길 자료다. 그 관계의 사유는 효과 표가 단다(runs_as 는 `runs_as_computed`).
- `role_rank_unknown`: EA에도 붙고 단계를 내린다.

**그림자 결과** (2026-11-03, 엔진 `feat/reach-core-ea-shadow`, 커밋된 데이터셋 넷을 바인딩 없음과 있음으로, 10-30 실측 묶음):
- 행 수, id, 차례, via, 회수 지점, 질문 문구는 운영 EA와 같다.
- 다른 것은 둘이다.
  - 데이터셋마다 `x_member_grant` 1행(Okta 조직 역할의 그룹 부여)이 computed에서 indeterminate로 내려가고 `role_rank_unknown` 이 붙는다.
  - 바인딩 있음의 `x_deputy_invocation` 2행에 `role_rank_unknown` 이 붙는다(이미 indeterminate).

**전환.** 같은 엔진 브랜치의 다음 커밋에서 운영 EA를 이 결과로 바꿨다. 실행기가 효과 표를 따로 읽고 관계 홉과 G 홉을 스스로 걷던 길은 지웠다. 운영 EA 지문 변화는 그림자 차이와 같다. 시험의 작은 그래프는 역할에 세기(`role_name`)를 줬다. 세기를 모르는 역할은 이제 판정 보류다.

**계산 시점 하나** (2026-11-03, 구조 개편 4단계). 운영 EA를 만드는 함수는 엔진 `scripts/accessRules/production.ts` `datasetEffectiveAccess` 하나다. 데이터셋 파일을 받아 이 거름, 회수 지점 설명, 형식 검사, 계산 시각(`manifest.created_at`)까지 끝낸 EA를 돌려준다. 정규화, 게시, 검증이 이것만 부르고, 데이터셋의 `effective_access.json`은 그 결과를 담아 두는 곳이다(아키텍처 `R-ea-one-function`). 운영 결과는 바뀌지 않았다.

## 정한 것 (2026-10-29, Relation 담당 결정)

위의 다섯은 이날 새로 정했다(집행 표시의 제안은 EA 명세에 있었다. 계정 찾기와 범용 접근 엔진은 방향만 정했다). 아래의 넷은 이미 그렇게 쓰고 있던 것을 「정함」으로 옮겼다.

| 무엇 | 정한 것 | 근거 |
| --- | --- | --- |
| 관계로 SaaS를 건넌 결론의 단계 | 엔진 쪽으로 넓힌다. Link를 탔거나 교차 관계 홉(양 끝 provider가 다르거나 `cross_provider` 표시)을 지나면 computed_cross. 엔진은 관계의 basis를 보지 않지만, Relation_Schema_v3 「교차 provider 관계는 stated 만」이라 실제로 갈리지 않는다. indeterminate로 내리는 조건이 먼저다 | aegi-adapter-engine `effectiveAccess/common.ts` `relationVia`(양 끝 provider가 다르거나 `cross_provider`면 `x_cross_provider`. crosswalk가 만든 관계에는 `cross_provider`가 붙는다), `lint.ts` 머리말과 단계 검사, 실행기 `scripts/accessRules/executor.ts`도 같다. Link 없이 provider를 건너는 경로가 생기고, crosswalk가 만드는 교차 관계(runs_as, registered_in, triggered_by)가 늘어난다. EA 명세 「단계」와 불변식을 같이 고쳤다 |
| 질문 모드 | 일반 규칙은 성립하는 행만 낸다. 「없다」(denied)는 누가 물었을 때만, 지나온 소속과 권한 목록이 모두 닫혀 있을 때만 낸다 | aegi-adapter-engine `docs/spec/AEGI_GENERIC_ACCESS_ENGINE_V1.md` §2-3, EA 명세 「이 파일이 지켜야 할 것」(전수 denied를 만들지 않는다). 손코드 질문(`rules/memberGrant.ts` `askGrant`)은 중첩 그룹이 있거나 본 관계가 없으면 답하지 않지만, 수집이 닫혔는지는 보지 않아 이보다 넓게 denied를 낸다(후속). 질문 모드의 순서는 아직 규칙 파일에 없다(`access_rules.yaml` `x_member_grant` differs) |
| 집행 표시를 어디에 두나 | Profile의 참조. 칸은 관계 선언의 `membership_enforced`(true, false, 생략은 모름)이고, 규칙은 부여 홉의 관계 행 속성으로 읽는다(위 「조건식의 자리」) | EA 명세 「집행되는 경로와 권한이 생긴 이력은 다르다」, `Profile_Schema_v4.2` 「`membership_enforced`」 |
| 시나리오 질문의 계정 찾기 | 동일인 홉과 같은 기준. 약한 근거는 하나까지, 그것을 지난 결과는 「추정」으로 표시한다. 방향만 정했고 구현은 탐지, Access Gaps 담당과 같이 한다 | 지금 엔진은 different 밖 링크 묶음 전체에서 고른다(aegi-adapter-engine `identity.ts` `identityLinkOf`, `getIdentityCluster`). 같은 함수를 Access Gaps의 사람 묶기 `accessGap.ts`, 범용 엔진 `engine/policies.ts`, 탐지 `rules/scenario*.ts` 7개, `blastRadius.ts`, `scope.ts`가 쓰므로 구현은 이 모두에 닿는다. 정답 대조(Link_Schema_v3 「두 계정 사이의 단계」)에는 약한 간선 둘 이상인 쌍이 없어 묶음이 그대로다. 다만 10-29에 받은 대시보드 D1 current(10-27 게시)의 링크에는 그런 쌍이 47쌍 가운데 14쌍(링크 5개)이라, 구현하면 이 쌍이 묶음에서 빠진다 |
| 범용 접근 엔진과의 관계 | 2026-11-03에 바꿨다: 합친다. 범용 접근 엔진의 간선과 길 질의를 닿음 핵심으로 삼고, 규칙 파일은 그 위에서 고를 길 모양을 적는다(아래 「닿음 핵심 위의 모양 거름」). 10-29 판은 「지금 합치지 않고 그림자를 먼저 둔다」였다 | 범용 엔진은 간선 모양 질의(§2-3)로 같은 질문을 푼다. EA 줄과 견주는 섀도 대조는 이미 있지만 손으로 돌리는 명령이다(`npm run engine:verify`, 설계서 §6 `parity.ts`). 정규화마다 도는 그림자(#136)는 실행기와 손코드 EA만 견준다. 두 쪽이 다른 곳이 이미 있다(`edges.ts` `owned_by`의 G 갈래가 사전의 `Resource>Principal`보다 넓다) |
| 규칙 파일 위치 | 두 파일. `ontology/access_rules.yaml`, `ontology/event_rules.yaml`(event 규칙을 쓸 때 만든다) | 검사와 소비자가 다르다. 엔진 실행기(aegi-adapter-engine#130)가 사본 `ontology/access_rules.yaml`을 읽는다 |
| `runs_as_inherits` 둘째 홉 | 실행 신원에서 나가는 G 간선(effects 기준). 「접근 등급」이 아니다 | EA 명세 「첫 규칙」(2026-10-25에 바꿈), `validation/check_twohop.py`(effects를 읽음), aegi-adapter-engine `e33a1dd`(#99, `common.ts` `accessHops`) |
| 관측을 근거로 쓰나 | 쓰지 않는다. access 결론에는 붙임 정보(`x_observations`)로만 붙인다. 관측이 관계로 승격되는 길은 #28 3번(관측 관계)을 따른다 | 엔진 `common.ts` `makeRow`는 관측을 `x_observations`로만 붙이고, `lint.ts`는 `via`를 관계와 링크로만 받는다 |
| effect 어휘 | 이번 판에서도 만들지 않는다. 능력 순위(read 1, write 3, admin 5)만 쓴다 | EA 명세 「어휘를 이번 판에서 만들지 않는다」, `ontology/capabilities.yaml` `rank`, 엔진 `engine/accessModel.ts` `RANK`(사전에서 읽음) |

## 정할 것

닿음 핵심 위의 모양 거름(2026-11-03)에서 둘이 남았다.

- 핵심에 간선이 없는 홉(동일인, 참조, 속성 줄, 빈 구간)을 핵심 간선으로 옮길지. 옮기면 실행기가 그래프를 직접 보는 곳이 없어진다.
- 질문 모드 두 규칙의 답을 관측 층 위협 질의(know, cause)와 어떻게 나란히 보일지.

그 밖의 이 문서 미결은 없다. 규칙 파일 `access_rules.yaml`에는 넷이 남았다. `assumes`의 제안값 둘(갈래 모양 경로, 저장된 홉이 없을 수도 있는 자리. 위 본문의 `from`과 `else_gap`으로 적었지만 정함 표시는 없다)과 규칙에 딸린 미결 둘이다(`runs_as_inherits` differs의 interface 둘인 객체 소유, `x_member_grant` notes의 `false` 사유).

## 관련 문서

- [Effective_Access_Schema_v1](Effective_Access_Schema_v1.md): EA 행의 모양과 원칙
- [Relation_Schema_v3](Relation_Schema_v3.md), `ontology/relation_semantics.yaml`: 관계와 간선
- [Link_Schema_v3](Link_Schema_v3.md): 동일인 연결 단계
- EA 진단표 v1: 지금 EA 코드를 이 형식으로 옮겨 본 결과
