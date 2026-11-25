# Effective Access Schema v1

> **v1이다(2026-10-29 Relation 담당 결정으로 초안을 벗었다, 아래 「초안을 벗는 조건」).** 형식의 확정 상태와 구현 여부는 구분하고, 「아직 안 정한 것」의 미결은 그대로 남는다. 현재 엔진은 이 형식의 effective_access.json을 생성하며 규격의 미결 어휘는 그대로 남아 있다. `effect` 어휘는 **일부러 비워 뒀다**(아래 「어휘를 이번 판에서 만들지 않는다」).
>
> **2026-09-27 — 실 API 검증 결과를 반영했다.** 근거는 `reports/EA_Validation_Report_v2.md`와 `data/` 의 원 응답이고, 본문의 「§」는 그 보고서의 절이다. 끊어 보고 확인한 결정적 인스턴스가 **시험 둘**(Okta 단독 · Okta→Slack 교차) 생겼지만 **둘 다 우리가 만든 구성이라 초안을 벗는 판정은 미결로 뒀다.** 2026-10-29에 근거를 두 칸(벤더 집행, 조직 사용)으로 나눠 v1으로 정했다.
>
> **2026-10-26 — 약한 신원 간선 규칙을 다시 적었다.** 앞 판은 "strong 링크만 via 로 건넌다"였고 엔진은 different 밖 간선을 몇 개든 이어 붙였다(`reports/EA_Rule_Diagnosis_v1.md` 5장 2번). 정답 대조로 다시 정했다: Link 경로의 단계는 가장 약한 간선의 단계이고, 약한 간선은 경로에 하나까지만 쓴다. 약한 간선을 지난 경로는 지우지 않고 `indeterminate`로 남긴다(아래 「단계」, `Link_Schema_v3` 「두 계정 사이의 단계」).

**"실제로 할 수 있는가"를 계산한 결론**을 담는다. 관계와도 Link와도 다른 파일, 다른 저장소다.

- Object 행의 모양은 `Object_Schema_v4.1.md`
- 벤더가 준 권한 사실은 `Relation_Schema_v3.md`
- provider 사이의 신원 판단은 `Link_Schema_v3.md`

```yaml
EffectiveAccess
├ effect            무엇을 할 수 있나. 어휘 미정이라 지금은 언제나 null
├ effect_query      그 질의를 사람 말로. effect 가 null 이면 필수
├ references{}      source, target
├ level             어느 근거로 나온 결론인가
├ via[]             어느 저장 관계·Link 를 타서 나왔나
├ cut[]             무엇을 지우면 회수되나
├ undecomposed[]    회수 지점을 못 댄 구간
├ stale_at          입력이 바뀌어 낡았다고 판정된 시각
└ source            언제, 어느 규칙 판으로 계산했나
```

**`transitive`는 행에 없다.** `level` 네 값이 전부 전이 금지라, 행마다 적으면 같은 상수를 복사하는 것이고 행이 `true`를 적었을 때의 뜻이 정의되지 않는다. 불변식 한 줄로 둔다.

아래 예시는 **실재하는 타입과 실재하는 규칙으로 썼다.** `slack.workflow --runs_as--> slack.user --member_of--> slack.channel`은 아래에서 세는 타입 조합 셋 중 하나이고, `runs_as_inherits`는 이 문서가 정의한 유일한 합성 규칙이다. **식별자 값만 지어냈다.**

```yaml
- effect: null                       # 어휘 미정. 질의 이름만 적어 둔다
  effect_query: "이 채널을 읽을 수 있는가"
  references:
    source: { provider: slack, object_type: workflow, value: Wf0A1B2C3 }
    target: { provider: slack, object_type: channel,  value: C0C0PGN5TGV }
  level: computed
  via:
    - { kind: relation, relation_type: runs_as,
        source: slack:workflow:Wf0A1B2C3, target: slack:user:U0BTRNDU62F }
    - { kind: relation, relation_type: member_of,
        source: slack:user:U0BTRNDU62F, target: slack:channel:C0C0PGN5TGV }
  cut:
    - { kind: relation, relation_type: runs_as,
        source: slack:workflow:Wf0A1B2C3, target: slack:user:U0BTRNDU62F }
  undecomposed: []
  source:
    rule: runs_as_inherits
    view_version: 3
    computed_at: 2026-09-24T10:00:00Z
    inputs_view_version: 3
```

`cut`이 `runs_as` 홉인 것에 주목한다. **실행 신원을 바꾸면 회수되고, 그 사람을 채널에서 빼도 회수된다** — 둘 다 맞지만 전자가 워크플로 하나만 건드리므로 더 좁은 조치다.

---

## 왜 관계와 분리하는가

어휘 17종은 전부 **벤더가 준 사실**이다. "실제로 할 수 있다"는 그 사실들을 **우리가 합쳐 낸 결론**이다.

같은 저장소에 넣으면 네 군데가 동시에 막힌다.

| 막는 곳 | 왜 |
| --- | --- |
| `relation_type` 17종 | 어휘는 동결 대상이다. 승격 절차가 따로 있고 분기 1회다 (`Relation_Schema_v3` 「닫힌 어휘를 늘리는 절차」) |
| `properties.basis` | `computed`는 **벤더가** 합쳐 준 것을 뜻한다. 우리가 합친 것을 같은 값에 넣으면 "누가 못 푸는가"를 잃는다 |
| `source{}` | `api`·`record`·`produced_by`가 필수이고 `produced_by`의 모든 값이 실재하는 Profile 참조를 가리켜야 한다. 계산 결과에는 API 호출이 없다 |
| `removed_at` · `view_version` | diff가 "권한이 바뀐 것"과 "우리 어휘가 바뀐 것"을 가른다. 여기에 "우리 계산이 바뀐 것"이 섞이면 원인이 셋이 되어 **diff가 조용히 틀린다** |

세 번째가 제일 단단하다. 관계 한 행은 **어느 응답의 어느 자리에서 나왔는지**를 반드시 들고 다닌다. 그게 이 스키마의 반증 장치다. 계산 간선은 그 자리를 못 채우므로, 억지로 넣으면 **반증할 수 없는 행이 반증 가능한 행들 사이에 섞인다.**

## 왜 Link에 넣지 않는가

Link는 **집합 모델**이다. `members[]`는 "이것들이 같은 실체다"이고 `level` 다섯 값도 전부 같음의 정도다.

```yaml
members:
  - { provider: slack, object_type: user, value: User2 }
  - { provider: slack, object_type: app,  value: Bot A }     # "User2 가 곧 Bot A 다"
```

쓰고 싶은 건 "User2가 Bot A를 부를 수 있다"인데 집합에 넣으면 **"User2가 곧 Bot A다"**가 된다. 이름만 어색한 게 아니다. Link 자신이 인용한 OWL `sameAs` 규칙 — *"전이일 뿐 아니라 속성까지 갈아탄다. 잘못된 엣지 하나가 두 동치류를 통째로 합치고 양쪽 속성을 서로 오염시킨다"* — 이 그대로 발동해서, User2의 Okta 계정까지 Bot A와 한 덩어리가 된다.

**Link는 집합, Effective Access는 간선이다. 한 파일에 못 들어간다.**

빌려 오는 것은 파일이 아니라 **설계**다. Link가 이미 푼 문제가 "우리가 만든 사실을 벤더가 준 사실과 안 섞으면서 근거를 반박 가능하게 남기는 법"이고, 그 풀이가 여기 그대로 맞는다.

```
별도 저장소                   그대로
질의가 명시적으로 켜야 함       그대로
숫자 신뢰도 금지, 규칙 + 근거   그대로
근거를 지우지 않음             그대로
전이 금지가 기본               그대로, 더 강하게 (아래)
```

---

## 이 저장소가 필요한 근거는 어디서 왔나

**화면 스케치가 아니다.** 그런데 근거의 층위를 정확히 해야 한다. 이 저장소가 새로 푸는 것은 **관계 두 개 이상을 이어야만 나오는 결론**이고, 단일 행 문제는 여기 근거가 못 된다.

### 단일 행 문제는 이미 자리가 있다 — 근거로 쓰지 않는다

전에 이 절이 벤더 사례 넷을 근거로 들었는데, **넷 다 관계 한 행 안에서 끝나고 담을 자리가 이미 있다.**

| 사례 | 이미 담는 자리 |
| --- | --- |
| GitHub `role_name`을 벤더가 못 가름 | `properties.decomposable: false` + `undecomposed[]` |
| Entra PIM 자격 / 활성 분리 | `validity.effect: eligible` |
| Salesforce 공유 압축·미저장 | `completeness: provider_partial` |
| Okta `AppUser.scope: GROUP` | 같은 모양. 단일 행 |

넷째는 인용 자체가 어긋났다. `Okta_Profiles_v3`에서 그 문장은 「교차 SaaS 관점에서 중요한 필드」에 있고 **"형식 문제가 아니라 Okta 쪽 구멍이다"**라고 명시한다. 스키마 구멍의 근거로 쓸 수 없다.

**이 넷을 근거로 들면 `governs`와 같은 실수가 된다** — 자리를 먼저 만들고 그 자리를 채울 사례를 나중에 못 찾는 것이다. 어휘에는 그 규율을 적용해 놓고(`effect: null`) 저장소에는 안 적용했었다.

### 진짜 근거 — 규격이 이미 "두 홉은 질의가 탄다"고 정해 놨다

`Relation_Schema_v3`이 **세 군데에서** 두 홉을 명시적으로 요구한다. 전부 "합쳐서 저장하지 않는다"는 결정이고, 그 결정의 반대편이 곧 이 저장소다.

| 어디 | 무엇 | 그 문서의 말 |
| --- | --- | --- |
| 「조건이 id 목록이 아닐 때」 | 정책이 그룹을 가리키면 **멤버까지 펼치지 않는다** | *"`member_of`가 이미 있으니 **질의에서 두 홉 타면 되고**, 펼쳐 두면 그룹 멤버가 바뀔 때마다 전부 다시 써야 한다"* |
| `has_role_on` / `permits` 분리 | Snowflake는 역할 부여와 자원 허용이 **별개 API**다 | *"`GRANT ROLE r TO USER alice`는 대상 자원을 담지 않는다. 자원은 `GRANT SELECT ON … TO ROLE r`에 있다. **두 단계를 하나로 합치면 두 번째 단계가 사라진다**"* |
| `has_role_on` 합침 절 | 역할 중첩 `GRANT ROLE r1 TO ROLE r2` | *"r2가 r1의 권한을 물려받으므로 r2가 가진 쪽이다"* |

**규격이 두 홉을 질의에 넘겼는데 그 질의 결과를 담을 자리가 없다.** 그게 이 저장소다.

### 얼마나 있나 — Profile이 선언한 것으로 세면 3개

저장소의 Profile 20개가 선언한 간선으로 2홉 조합을 전수로 세면 이렇다(2026-10-25, `validation/check_twohop.py`).

```
선언 간선                                    22개   references 16, as_relation 5, assignment 1
2홉 조합                                     12개   정방향 12, role슬롯 0, 역member_of 0
그중 둘째 홉이 가운데에서 나가는 G 간선인 것    3개   <- 접근 결론이 되는 것
```

**둘째 홉이 가운데에서 나가는 G(권한) 간선이어야 접근 결론이다.** 어느 관계가 어느 방향으로 G 를 내는지는 `ontology/relation_semantics.yaml` effects 가 끝점 interface 마다 정한다. 소속(M), 상위 범위(U), 대행(A), 흐름(F)을 이으면 새 결론이 없거나 뜻이 달라진다. 끝점에 Profile 이 없어 interface 를 모르면 9종 전부로 보고, 그래도 G 가 안 나면 뺀다(`slack.app`, `slack.trigger`).

뺀 아홉 중 넷이 특히 헷갈린다.

```
user --member_of--> channel --shared_with--> team          [G 가 가운데에서 안 남]
   shared_with 의 G 는 팀에서 채널로 난다. 채널의 노출이지 사용자가 팀에 무엇을 할 수 있다는 뜻이 아니다

workflow --runs_as--> user --authenticates_with--> session [G 없음]
   워크플로가 사람 신원으로 도는 것과 그 사람의 로그인 세션을 쥐는 것은 다르다

workflow --runs_as--> user --member_of--> team             [M]
workflow --runs_as--> user --member_of--> usergroup        [M]
   테넌트, 그룹으로 가는 member_of 는 소속이다. 워크플로가 그 그룹에 무엇을 할 수 있다는 뜻이 아니다
```

**둘째 것이 정확히 이 문서가 경계한 "자동으로 닫으면 거짓"이다.** 처음 판에서 앞의 둘을 산문으로 손수 뺐었고, 그다음 판은 화면용 「접근 등급」(`relation_types.yaml` grades)으로 걸렀다. 등급은 관계 이름을 묶은 것이라 뒤의 둘(`member_of`는 접근 등급이다)이 새어 들어왔다. **검사가 effects 를 읽어야 문서 수와 검사 수가 같아진다.** 지금은 effects 로 기계가 거른다(2026-10-25에 바꿨다).

남은 셋은 **전부 `runs_as`로 시작한다.**

```
slack.workflow --runs_as--> slack.user --member_of-->   slack.channel
slack.workflow --runs_as--> slack.user --has_role_on--> slack.team
slack.workflow --runs_as--> slack.user --has_role_on--> slack.enterprise
```

마지막 하나는 `as_relation`(`enterprise_user.is_owner` 등)을 읽으면서 새로 잡힌 것이다.

워크플로가 사람 신원으로 돌면서 그 사람의 접근을 물려받는 것이고, 같은 문서가 *"권한 오남용 판정이 `runs_as`와 `triggered_by` 두 값의 비교로 성립한다"*고 쓴 바로 그 판정이 이 조합을 탄다.

계산은 `validation/check_twohop.py`가 한다. **조합이 0개가 되면 검사가 실패한다** — 그때는 이 저장소의 근거가 선언 수준에서도 없다는 뜻이라 이 절을 다시 봐야 한다.

### 규격 세 곳은 지금 자료에서 0개다 — 그걸 확인했다

**셋과 규격 세 곳이 겹치는 패턴이 하나도 없다.** 처음엔 검사가 정방향 이진 사슬만 잇는 탓인 줄 알았는데, **검사를 고쳐 보니 자료 쪽이었다.**

검사에 셋을 더했다.

| 더한 것 | 왜 | 결과 |
| --- | --- | --- |
| `assignment` 블록과 `as_relation`을 읽는다 | 3항 관계의 `role` 슬롯이 거기 있다. 안 읽으면 **자료가 없어서가 아니라 검사 모양 때문에** 0이 나온다 | 간선 14 → **20** (그 뒤 references 가 늘어 지금은 22) |
| `role` 슬롯을 탄다 | 규격 2·3번이 이 슬롯을 탄다 | **0개** |
| 역방향 `member_of`를 탄다 | 규격 1번이 이걸 탄다 | **0개** |

**규격 1번이 0인 이유:** `applies_to`·`excludes`·`permits`가 **저장소 어디에도 선언돼 있지 않다.** 정책이 그룹을 가리키는 간선 자체가 없어서 뒤집을 앞 홉이 없다.

**규격 2·3번이 0인 이유:** `role` 슬롯이 있는 간선은 `google_workspace.user --has_role_on[role]--> org_unit` 하나인데, 그 역할(`google_workspace.role`)에서 나가는 간선이 없다. `permits`가 0건이라 이을 짝이 없다.

> 그래서 **셋이라는 수는 이제 검사 모양 탓이 아니다.** 규격 패턴을 담으려면 자료를 고쳐야 하고, 그 자료가 Okta다 — `okta.policy.included_groups → group`이 규격 1번 재료인데 **Okta Profile 7개의 참조 22개 전부 `relation_type`이 없다.**

#### 역방향 `member_of`에는 가드가 둘 필요하다

그냥 뒤집으면 **권한이 아닌 것이 권한 경로가 된다.** 실제로 샜다.

```
slack.user --has_role_on--> slack.team --member_of⁻¹--> slack.user
   "같은 팀에 속한 동료" 가 권한 경로로 나온다
```

역방향 조합은 둘째 홉의 G 간선 판정을 따로 하지 않고 이 가드로만 거른다(정책이 그룹을 가리키면 그 멤버까지 간다는 규격 1번의 모양이라서다). 그래서 가드 둘을 다 걸어야 한다.

```
앞 홉이   applies_to · excludes · has_role_on · permits 중 하나이고
가운데가  Principal 이어야 한다        <- slack.team 은 Tenant 라 여기서 걸린다
```

둘째 가드가 **Okta 작업의 선행 조건**이기도 하다. Okta Profile은 `interfaces`를 아예 선언하지 않아서, 지금 상태로는 `okta.group`이 Principal인지 검사가 모른다.

### 근거를 세 층으로 적는다

**층을 안 나누면 부풀리거나 깎게 된다.** 위 셋은 **타입 수준** 조합이고, 인스턴스로 내려가면 하나에 매달린다.

```
규격이 요구함       3곳    Relation_Schema_v3 에 명시돼 있다
타입 조합           3개    Profile 선언으로 기계가 셌다. 전부 runs_as 로 시작한다
인스턴스 기반       1행    그 조합들의 첫 홉이 실측에서 몇 행인가
```

**부풀리면 안 되고 깎아서도 안 된다.** 규격 요구 3곳과 타입 조합 3개는 실재한다. 2026-10-25 전 판은 화면용 등급으로 걸러 타입 조합을 5개로 셌다.

### 인스턴스 층은 「결정적 인스턴스」만 센다

**모양만 세면 부풀려진다.** 실 API 로 재보니 모양은 많은데 끊어도 아무것도 안 바뀌는 것이 대부분이었다(§3.3, §5.3, §6.1, §8).

| | 모양 | **끊으면 권한이 바뀌는 것** | 왜 |
| --- | --- | --- | --- |
| Okta 테넌트 1 기본 정책 | 21 | **0** | 전부 `Everyone`(BUILT_IN) 경유 |
| GitHub lab 팀 → 저장소 | 36 | **0** | 멤버 전원이 org owner — 팀과 무관하게 모든 저장소 admin |
| Slack run2 `runs_as` 경로 | 1 | **0** | 둘째 홉이 워크스페이스 멤버십(사실상 전원). 2026-10-25 규칙으로는 테넌트 소속(M)이라 애초에 `runs_as_inherits` 경로가 아니다 |

> **결정적 인스턴스 = 그 경로를 끊으면 실제 권한이 바뀌는 것.** 가능하면 **끊어 봐서** 확인한다.

**전원에게 걸리는 경로는 세지 않는다.** 그건 권한 경로가 아니라 배경이다.

```
Okta     Everyone (BUILT_IN)
GitHub   default_repository_permission · org owner
Slack    워크스페이스 멤버십
```

여기에 함정이 하나 있다. **Okta는 "전원"을 `Everyone` 그룹을 명시적으로 include 하는 모양으로 표현한다**(§3.2). 겉모양만 보면 `binding: explicit`으로 잘못 판정된다.

> **정함 (2026-10-29, Relation 담당 결정) — Okta 그룹이 `type: BUILT_IN`이고 이름이 `Everyone`이면 전원(`binding: ambient`)으로 본다.** Drive 「누구나」 공유처럼 한 덩어리로 다루고 사람마다 `x_member_grant` 행을 펴지 않는다(질문 모드 손코드 `memberGrant.ts`가 도메인 공유와 anyone 공유를 배경으로 보고 행을 내지 않는 것과 같은 자리). provider마다 표현이 달라 겉모양으로는 못 가르므로 provider마다 규칙을 둔다. 이 규칙이 고르는 그룹은 이미 `judged.origin: platform_builtin`으로 표시돼 있다(Interface_Spec_v3 `origin`, 판단표 G4-Q03, G4-Q04). 다른 `BUILT_IN` 그룹 하나는 `platform_default`다.

> **함정은 이미 데이터에 있다.** 10-29에 받은 D1 current(10-27 게시)와 10-03 정규화본 모두 정책 → `Everyone` `applies_to` 3행이 `binding: explicit`이다. 지금 엔진에는 `binding`을 읽는 코드가 없어 EA 답은 아직 바뀌지 않는다. 구현할 몫은 둘이다. 이 `applies_to`를 `ambient`로 내는 것(엔진 후속), 그 그룹이 권한을 받는 관계가 수집에 생길 때 사람마다 행을 펴지 않는 것. 같은 D1에서 Okta `BUILT_IN` 그룹은 2개(그 가운데 `Everyone` 1개), 들어오는 관계는 정책 `applies_to` 3과 사용자 `member_of` 9, 그 그룹에서 나가는 권한 관계는 0이다.

### 초안을 벗는 조건

"자라면 벗는다"는 검사할 수 없으므로 **기준을 빌려 온다.** `Relation_Schema_v3`의 「닫힌 어휘를 늘리는 절차」가 이미 정한 것을 그대로 쓴다.

> **provider 둘 이상에서 같은 모양으로 요구될 때.**

**다만 어느 층에서 세는지를 같이 정해야 한다.** Okta Profile은 실 API 호출 없이 규격만 읽고 쓴 것이라(`Okta_Profiles_v3`이 "이 파일은 아직 수집에 쓰면 안 된다"고 적었다) 아무리 고쳐도 **타입 층까지만** 나온다. Slack은 인스턴스 층이다. 층을 안 가리고 세면 **Slack 인스턴스와 Okta 타입을 섞어서 둘로 세게 된다.**

```
타입 층에서 provider 둘      ->  합성 규칙 파일을 확정한다
인스턴스 층에서 provider 둘   ->  초안을 벗는다
```

#### 실측으로 모양은 채워졌다 (2026-09-27)

앞 판이 "지금은 한 provider(Slack)뿐", "인스턴스 기반 1행"이라고 적었는데 **둘 다 낡았다.** 실 API 로 **끊어 보고** 확인한 결정적 인스턴스가 **시험 둘**이다.

| | 무엇 | 경로가 보임 | 끊어 봄 | 근거 |
| --- | --- | --- | --- | --- |
| **Okta 단독** | `test_group` → Cloudflare One 앱 배정 | 09-26 | 09-27 **막혔다** | §4.1, §7.1 |
| **Okta → Slack 교차** | Okta `HelpDesk-Admins` → Push Groups → Slack IdP 그룹 → `#aegi-idp-helpdesk` | 09-27 | 09-27 **Okta에서 빼자 Slack 채널 접근이 사라졌다** | §7.5 |

**Slack 단독 시험은 없다.** 그 Slack IdP 그룹은 Okta 가 push 해서 생긴 것이라, Slack 쪽 경로(IdP 그룹 → 제한 채널)는 교차 시험의 뒤쪽 절반으로만 관측됐다. 따로 세면 같은 시험을 두 번 세는 것이다.

**둘째가 크다.** 두 provider를 가로지르는 경로가 실제로 집행된다는 것이 확인됐고, 그게 이 저장소가 존재하는 이유 그 자체다.

앞 판의 "Okta 가 더 가까운 길"은 **맞았다** — Okta 단독 경로가 하루 먼저(09-26) 보였고, 끊는 시험도 같은 날 교차보다 먼저(§7.1 → §7.5) 했다.

> **정함 (2026-10-29, Relation 담당 결정) — 이것으로 조건을 채운 것으로 보고 v1으로 확정한다.** 승격 근거를 두 칸으로 나눠 센다.
>
> **벤더 집행 근거**(인스턴스 층, 우리가 구성한 시험도 센다): Okta 단독(§7.1), Okta → Slack 교차(§7.5). **조직 사용 근거**(따로 센다): 지금 없다. 근거의 한계: **둘 다 우리가 만든 구성이다.** "벤더가 이 경로를 집행한다"의 근거로는 확실하고 "실제 조직이 이렇게 쓴다"의 근거로는 약하다. Slack은 교차 시험의 뒤쪽 절반으로만 관측됐다(Slack 단독 시험 없음). 「아직 안 정한 것」의 다른 미결은 그대로 미결이다.

1행짜리 근거로 저장소를 실제로 만들면 그게 `governs`다. **지금은 1행이 아니지만, 그 두 시험이 우리 손으로 만든 것이다.**

## 무엇을 답하는 저장소인가

질문이 둘이고, **둘째가 없으면 첫째도 값이 없다.**

```
1. 누가 실제로 할 수 있나
2. 무엇을 지우면 회수되나
```

보안 담당자가 화면을 보는 이유는 대개 둘째다. 첫째만 답하면 이렇게 된다.

```
"User2 가 이 봇을 쓸 수 있습니다"          <- 말해준다
"그럼 어떻게 막죠?"                       <- 침묵
```

그래서 `cut[]`이 선택 항목이 아니다. **회수 지점을 못 대면 그 사실을 행에 적어야 한다** — `undecomposed[]`가 그 자리다.

근거가 벤더 문서에 있다. GitHub 협업자 응답의 `role_name`은 "모든 부여 출처를 고려한 뒤 배정된 가장 높은 역할"이고 출처가 저장소·팀·조직·엔터프라이즈 넷인데, 같은 문서가 이렇게 쓴다.

> "현재 이 엔드포인트 응답만으로는 조직 수준 부여와 저장소 수준 부여를 구분할 방법이 없다"

Okta는 다르다. `AppUser.scope`가 `GROUP`이면 `_links.group`이 어느 그룹 때문인지 준다. **다만 그룹 둘로 배정되면 우선순위 높은 하나만 가리킨다(보고서 §7.7).** 경로가 둘이면 하나가 가려진다.

**둘 다 "할 수 있다"는 알 수 있고 "무엇을 지우면 되는지"는 모르는 경우다.** 그 상태를 표현할 자리가 없으면 화면이 없는 답을 있다고 한다.

---

## 전부 미리 계산하지 않는다

이 저장소는 **색인이 아니라 답한 기록이다.**

### 이유는 규모가 아니라 정확성이다

규모부터 적으면 논거가 약해진다. 318건 목록으로 재면 `Principal` 24종 × `Resource` 65종 = **1,560 쌍**이고 Slack 샌드박스 127노드의 쌍은 **16,129**인데, **이 정도는 미리 계산해도 아무 문제가 없다.** 규모로 반대하면 "장비를 키우면 되지 않나"에 답이 없다.

**진짜 이유는 미리 만든 답이 낡기 때문이다.**

```
어제 계산     alice 가 이 저장소를 읽을 수 있다
오늘 아침     alice 의 member_of 가 회수됐다
오늘 질의     저장소는 여전히 "읽을 수 있다" 고 답한다
```

**낡은 권한 답은 회수된 사람에게 "된다"고 말한다.** 보안 판정에서 이 방향의 오답이 가장 위험하고, 같은 이유로 이 규격이 `excludes`를 별개 어휘로 두고 `validity.effect: eligible`을 따로 뒀다.

관계 행은 이 문제가 없다. **관측 시각이 행에 붙어 있고 `removed_at`이 사라짐을 표현하기 때문**이다. 파생 결론은 관측이 아니라 계산이라 그 장치가 안 통한다 — 입력이 바뀌면 결론이 조용히 틀려 있다.

Zanzibar도 같은 이유로 전부 실체화하지 않는다. 검사는 요청 때 풀고, Leopard 인덱스는 **비싸고 잘 안 변하는 집합 멤버십만** 미리 만든다. `Relation_Schema_v3`이 그 인덱스를 인용하며 적은 대목이 정확히 이것이다 — **증분 층에 timestamp와 삭제 표식을 다는 이유가 성능이 아니라 정확성이다.**

그래서 이렇게 정한다.

> **질의가 물으면 계산하고, 계산한 것과 그 근거를 남긴다. 안 물은 쌍은 이 저장소에 없다.**

### 그러면 왜 저장하나

계산만 하고 버려도 화면은 그려진다. 남기는 이유는 둘이다.

| | |
| --- | --- |
| **감사** | 보안 판단은 실행된다. 우리가 그때 무엇을 근거로 그렇게 답했는지가 남아야 한다 |
| **diff** | "지난주 대비 누가 새로 할 수 있게 됐나"는 두 시점이 있어야 답한다 |

### 값은 「결론」이 아니라 「경로와 차단점」에 있다

실측이 이걸 분명하게 했다(§4.1). **Okta는 결론을 이미 준다** — `AppUser` 행이 "이 사람이 이 앱에 들어간다"를 그대로 알려준다. 우리가 계산할 게 없다.

그런데 그 행이 그룹 배정이면 이렇게만 적힌다.

```json
{ "scope": "GROUP", "status": "ACTIVE", "externalId": null }
```

그룹은 `_links.group`으로 준다(위 발췌는 `_links`를 지운 것이다 — 보고서 정정 기록). **그런데 그룹 둘로 배정되면 우선순위 높은 하나만 가리킨다(보고서 §7.7)** — 응답이 그룹 하나일 때와 해시까지 같고, 한 그룹에서 빼도 배정이 남는다. 경로를 다 펴려면 `/apps/{id}/groups`와 `/users/{id}/groups`를 **합쳐야** 한다.

> **벤더가 결론을 줄 때도 이 저장소의 값은 `via`와 `cut`에 있다.** 결론만 필요하면 벤더 응답을 그대로 쓰면 되고, 이 저장소는 만들 이유가 없다.

이게 「무엇을 답하는 저장소인가」의 둘째 질문(무엇을 지우면 회수되나)이 첫째보다 중요한 이유다. 첫째는 벤더가 답해 주는 경우가 있지만 **둘째는 아무도 안 답해 준다.**

### 없는 것이 없다는 뜻이 아니다

**이 저장소는 "아무도 못 한다"를 절대 답하지 않는다.** 물어본 것만 들어 있기 때문이다.

같은 규율이 이미 `Relation_Schema_v3`의 「화면이 구분해야 하는 모름」에 있다 — `enumerable: none`이나 `completeness: provider_partial`이면 "없음"을 결론으로 못 쓴다. 여기서는 **저장소 전체가 그 성질**이다.

**EA 는 실행 신원이 닿는 곳 전부도 아니다.** EA 행은 실행 신원에서 바로 나가는 설정 층 G 가운데 관계 행이 출처인 것만 담는다. 객체 참조와 사전 표 규칙이 출처인 G, 끝이 grant, everyone, tenant 인 효과는 EA 모양 밖이고 넣지 않는다(2026-11-16 결정, aegi-knowledge#311, `Path_Rule_Schema_v1` 「홉을 핵심에서 받는 법」). 사람이 자동화, 실행 신원, 토큰을 거쳐 닿는 곳은 엔진 파생 접근 층(`src/detection/threat/derived.ts`)이 직접 권한 모듈(`src/detection/v2/engine/directAccess.ts`) 위에서 구한다.

---

## 단계

**넷이다. 전부 전이가 아니다.**

| 단계 | 뜻 | 근거 |
| --- | --- | --- |
| `computed` | 한 provider 안에서 저장 관계만으로 풀었다 | 위 2홉 3개 |
| `computed_cross` | strong Link 경로를 탔거나 교차 관계(양 끝 provider가 다르거나 `cross_provider` 표시)를 지났다 | Link 쪽은 경로에 추정이 섞인다. 교차 관계 쪽은 Link 없이 provider를 건너 `computed`에 담기지 않는다 |
| `indeterminate` | 경로는 찾았는데 성립 여부를 못 정한다 | 조건이 `kind: expression`이라 행이 없다 |
| `denied` | 안 된다고 판정했다 | 아래 「안 된다는 기록도 남긴다」 |

`computed_cross`의 관계 쪽은 2026-10-29에 엔진에 맞춰 넓혔다(Relation 담당 결정, `Path_Rule_Schema_v1` 「정한 것」). 단계를 `indeterminate`로 내리는 조건이 먼저다.

**전이 여부를 단계별로 적지 않는다.** 넷이 전부 금지라 표로 두면 같은 값을 넷 복사하는 것이고, 하나를 나중에 `true`로 바꾸고 싶어지면 그건 표를 고칠 일이 아니라 이 문서를 다시 쓸 일이다. 불변식 한 줄로 둔다 — **어느 `level`도 전이가 아니다.**

### `vendor_stated`를 뺐다

처음엔 다섯이었고 `vendor_stated`(벤더가 유효 권한을 직접 답했다, GitHub `role_name`)가 있었다. **뺀다.**

그 행의 모양을 적어 보면 이유가 보인다. 벤더가 답한 것이므로 `via`는 그 답을 담은 관계 행 **하나**이고, 회수 지점은 벤더가 안 주므로 `cut: []` + `undecomposed`가 찬다. 즉 **관계 행 하나를 그대로 베끼고 이름만 바꾼 것**이 된다.

그리고 그 상태는 관계 쪽에 이미 있다 — `basis: computed` + `decomposable: false` + `undecomposed[]`가 정확히 같은 말이다. 같은 사실을 두 저장소에 두면 어느 쪽이 정본인지 묻게 되고, 그건 이 문서가 관계와 분리한 이유를 스스로 무너뜨린다.

**질의가 "유효 권한 전부"를 물으면 두 저장소를 합쳐 답한다.** 그건 질의 층의 일이지 저장 층의 일이 아니다.

`indeterminate`가 필요한 근거는 이미 어휘 쪽에 있다. 정책 조건이 와일드카드(`"All"`)이거나 동적 그룹 규칙이면 `kind: expression`이라 **관계 행 자체가 안 만들어진다.** 그 정책이 걸리는지 안 걸리는지를 우리가 못 정하는데, 그때 `computed`로 적으면 없는 확신을 만들고 빠뜨리면 경로를 놓친다. **둘 다 틀리므로 자리가 필요하다.**

**약한 동일인 간선을 지난 경로도 같은 자리다.** `possibly_same`처럼 약한 키로 맞춘 간선은 두 계정이 같은 주체라고 확정하지 못한다. 그 경로를 `computed_cross`로 적으면 없는 확신을 만들고, 빼면 실제 경로를 놓친다. 실측 데이터셋에도 있다: 채널 봇과 Okta 앱이 로그 상관 간선 하나로만 이어진 대리 실행 경로다. 그래서 `indeterminate`로 내고, 그 홉을 `undecomposed`에 `{ at: via[i], from: computation, reason: ... }`로 적는다. 사유는 `ontology/uncertainty.yaml` engine_reasons의 것이다: 자동화끼리의 연결은 `identity_link_weak`, 사람 연결은 `identity_weak`. 범용 접근 엔진도 약한 자동화 연결을 같은 사유로 표시하고 건넌다.

Link 경로가 허브를 거쳐 간선 둘이 되어도 같다. 경로의 단계는 가장 약한 간선의 단계이고, 약한 간선이 하나 있으면 위와 같이 `indeterminate`다. 강한 간선 너머로 옮긴 약한 간선은 바로 잇는 약한 간선만큼 맞았다(`Link_Schema_v3` 「두 계정 사이의 단계」의 정답 대조). 약한 간선 둘 이상을 거쳐야 이어지는 계정은 잇지 않는다(2026-10-29 정함, `Link_Schema_v3` 「정한 것」).

## 전이를 어느 단계에서도 안 닫는다

Link는 강한 두 단계(`resolved`, `disclosed_relation`)에 한해 허브 안 전이를 허용한다. **여기는 하나도 허용하지 않는다.**

```
A 가 B 를 할 수 있다
B 가 C 를 할 수 있다
─────────────────────
A 가 C 를 할 수 있다        <- 자동으로 닫으면 거짓이 된다
```

근거가 어휘 안에 이미 있다. `Relation_Schema_v3`이 `runs_as`와 `triggered_by`를 **절대 합치지 않는다**고 못 박은 이유가 그대로 이것이다.

> 자동화가 무엇에 의해 시작되는지와 무엇의 권한으로 실행되는지는 별개의 사실이고, 권한 오남용 판정이 그 두 값의 비교로 성립한다.

즉 A가 자동화 B를 트리거해도 **B는 B의 신원으로 돈다.** 두 홉을 이으면 A가 B의 권한을 가진 것처럼 된다. 가장 위험한 사례도 문서에 있다 — ServiceNow의 Scheduled Script Execution은 `run_as`가 비어 있으면 System으로 돌면서 **모든 ACL을 우회한다.** 그걸 트리거할 수 있는 사람이 System 권한을 가진 것으로 계산되면 그 결론은 정반대로 위험하다.

W3C도 같은 결정을 했다. SKOS에서 `exactMatch`는 전이이고 `closeMatch`는 전이가 아닌데, 규격이 이유를 **복합 오류**라고 적는다. `sameas.org`가 강한 링크와 약한 링크를 한 폐쇄에 넣었다가 "의미적으로 건전하지 않다"는 비판을 받은 사례도 Link 쪽에 인용돼 있다.

**여러 홉을 잇고 싶으면 그 합성을 규칙으로 명시해서 `rule`에 적는다.** 자동으로 닫지 않는다.

### 첫 규칙 — `runs_as_inherits`

`rule`을 모든 행에 요구하면서 정의된 규칙이 하나도 없으면 형식을 시험할 수가 없다. **첫 규칙을 위 2홉 조합에서 뽑는다.** 같은 자리에서 잇는 게 맞는 쌍과 틀린 쌍이 같이 나오기 때문에 시험이 된다.

```yaml
rule: runs_as_inherits
  compose:  Automation --runs_as--> Principal,  Principal 에서 나가는 G 간선 --> X
  yields:   Automation 이 X 에 대해 그 Principal 의 접근을 갖는다
  level:    computed
  cut:      runs_as 홉.  실행 신원을 바꾸면 회수된다
```

**맞는 이유:** `runs_as`가 "무엇의 권한으로 실행되는지"를 뜻한다고 `Interface_Spec_v3`이 정의했다. 자동화는 그 신원의 권한으로 도는 것이 맞다.

**둘째 홉을 「실행 신원에서 나가는 G(권한) 간선」으로 못 박은 것이 이 규칙의 핵심이다.** 어느 관계가 G 를 내는지와 그 방향은 `ontology/relation_semantics.yaml` effects 가 끝점 interface 마다 정한다. 관계의 방향이 아니라 간선의 방향을 본다.

| 둘째 홉 | effects | 이 규칙에서 |
| --- | --- | --- |
| 실행 신원 --`has_role_on`--> X | G, 신원에서 X 로 | 탄다. 역할이 신원을 `excludes`로 뺐거나 지운 배정을 거친 것은 G 가 없다(조건 갈래. relation_semantics.yaml 은 Principal>Resource 칸에 적었고, 엔진은 모든 칸에 같게 건다) |
| 실행 신원 --`has_role_on`--> X 이고 X --`owned_by`--> 실행 신원 | 같은 벤더 사실(GWS 파일 소유자 역할)이 두 관계로 온다 | 한 번만 탄다(`has_role_on`). 같은 결론을 두 경로로 세지 않는다 |
| 실행 신원 --`member_of`--> 자원 | G, 신원에서 자원으로 | 탄다 |
| 실행 신원 --`member_of`--> 그룹, 테넌트 | M (소속) | 안 탄다. 그룹에 무엇을 할 수 있다는 뜻이 아니다 |
| X --`owned_by`--> 실행 신원 (자원의 주인) | G, 주인(도착)에서 자원(출발)으로 | 탄다. 관계는 들어오지만 간선은 신원에서 나간다 |
| 실행 신원 --`owned_by`--> 앱 | A, 앱에서 신원으로 | 안 탄다. 앱이 그 신원으로 동작하는 것이다 |
| `excludes`, `applies_to`, `evaluates`, `permits` | 효과 없음 | 안 탄다 |
| `authenticates_with` | 효과 없음 | 안 탄다. 워크플로가 사람 신원으로 도는 것과 그 사람의 로그인 세션을 쥐는 것은 다르다 |

처음엔 이 조건을 적어 놓고도 세는 쪽에서 안 지켜서 `runs_as` + `authenticates_with`를 같이 셌다. 그다음 판은 둘째 홉을 화면용 「접근 등급」(`relation_types.yaml` grades)으로 정했는데, 등급은 관계 이름을 화면에서 묶은 것이라 위 표의 「안 탄다」 셋(그룹, 테넌트로 가는 `member_of`, 앱으로 가는 `owned_by`, 효과 없는 관계)이 새어 들어왔고 주인으로 들어오는 `owned_by`는 빠졌다. 2026-10-25에 effects 기준으로 바꿨다. `check_twohop.py`가 effects 를 읽어 거른다 — **규칙이 자기 정의를 어기는지 검사가 본다.**

**`triggered_by`로는 절대 같은 규칙을 만들지 않는다.** 위에 적은 그대로다 — 트리거한 사람은 자동화의 권한을 갖지 않는다. 두 어휘가 같은 칸(`Automation --> Principal`)에 앉는데 하나는 이어도 되고 하나는 안 되므로, **`template`만으로는 이 구분이 안 나온다.** 규칙을 사람이 적어야 하는 이유가 이것이다.

지금 이 규칙이 실측에서 탈 수 있는 행은 **1행**이다(Slack `runs_as` 관측 1건). 규칙이 맞는지 시험하기엔 충분하고, 저장소를 실제로 만들 근거로는 모자라다.

---

## 계산이 반드시 읽어야 하는 것

스키마에 이미 칸이 있는데 계산이 안 읽으면 **답이 조용히 틀린다.** 다섯이다.

| 읽을 것 | 안 읽으면 | 근거 |
| --- | --- | --- |
| `excludes` | 제외된 사람을 **"할 수 있다"**고 답한다 | 극성을 `properties`에 안 넣고 별개 어휘로 둔 이유가 이것이다 |
| `validity.effect: eligible` | **없는 권한을 있다**고 하거나 **권한 상승 경로를 놓친다** | Entra PIM은 자격과 활성이 **별개 엔드포인트**다 |
| `properties.binding` | "이 사람에게 명시적으로 걸린 정책"에 **조직 기본 설정까지 끌고 온다** | `explicit`과 `ambient`를 가른 이유 |
| `qualifiers.grant_option` | **권한을 퍼뜨릴 수 있는 주체**가 결과에서 사라진다 | Snowflake. 받은 쪽이 다시 부여할 수 있다 |
| `properties.decomposable` | "할 수 있다"만 말하고 **회수 지점에 침묵한다** | GitHub이 자기 문서에 못 푼다고 적었다 |

`excludes`가 제일 먼저다. **부정을 빠뜨린 결과는 틀린 게 아니라 뒤집힌 것**이고, 보안 판정에서 그 방향의 오답이 가장 위험하다.

### 벤더가 애초에 안 주는 경우

Salesforce는 한 사용자가 여러 경로로 같은 레코드에 닿으면 **공유 항목을 가장 높은 접근 수준 하나로 압축한다.** 더 나아가 "sharing set 같은 일부 공유 메커니즘은 공유 항목이 **아예 저장되지 않는다**".

**권한은 실재하는데 행이 없다.** 이런 provider에서는 `computed` 결과가 구조적으로 미달이므로, 입력 Profile의 `completeness: provider_partial`을 읽어 그 결론에 표시를 남긴다. 표시 없이 내보내면 "없음"을 결론으로 쓰게 된다.

---

## 회수 경로

```yaml
via:                 이 결론을 만든 저장 관계와 Link 전부. 읽은 순서대로
cut:                 그중 지우면 결론이 무너지는 것
undecomposed:        회수 지점을 못 댄 구간
```

`via`는 **감사용**이고 `cut`은 **조치용**이다. 둘은 다르다 — 경로에 다섯 홉이 있어도 실제로 끊어야 할 곳은 하나일 수 있고, 반대로 두 경로가 독립으로 성립하면 하나만 끊어서는 안 회수된다.

```
cut 이 차 있다                                   ->  항목 하나만 끊어도 그 경로가 무너진다. 항목끼리는 대안이다
cut 이 비고 undecomposed 가 차 있다              ->  "할 수 있는데 어디를 끊을지 모른다"
cut 도 undecomposed 도 비었는데 level: denied     ->  정상. 회수할 권한이 없다
cut 도 undecomposed 도 비었는데 그 밖의 level     ->  lint 오류
```

**한 경로는 사슬이다.** 홉이 전부 성립해야 결론이 성립하므로(∧), **어느 홉 하나만 끊어도 경로가 무너진다.** 그래서 `cut`의 각 항목은 **그것 하나로 충분**하고, 항목이 여럿이면 **골라 쓰는 대안**이다. 앞에 오는 것이 아래 「어느 홉을 `cut`에 넣나」의 기본(그 source 에게만 영향이 가는 홉)이다.

실측 반례로 절반이 확인된다. `#aegi-idp-helpdesk` 접근은 **채널 멤버십 ∧ IdP 그룹 멤버십**이다 — 접근 제한은 "문"이라 둘 다 있어야 들어간다. Okta 그룹에서 빼자 막혔고(§7.5), Slack 채널에서 내보내도 막힌다(끊어 보지는 않았다). **둘 다 끊어야 막히는 게 아니다.**

> 앞 판은 "`cut`이 차 있으면 전부 끊어야 회수된다"고 적었는데 **틀렸다.** 검증 쪽 제안을 그대로 받으면서 한 경로의 모양(∧)을 안 따져 봤다.

**`denied`가 예외인 이유는 회수할 것이 애초에 없기 때문이다.** "못 한다"는 결론에 "무엇을 지우면 회수되나"를 물을 수 없다. 처음 판에서 이 예외를 빠뜨려 **자기 예시가 자기 불변식을 어겼다.**

`indeterminate`는 반대로 **예외가 아니다.** 성립 여부를 못 정했다는 것은 회수 지점도 못 댔다는 뜻이므로 `cut`이 비면 `undecomposed`가 반드시 찬다. 못 정한 이유(대개 `kind: expression`)를 거기 적는다.

### 한 행은 한 경로다 — 독립 경로는 행이 나뉜다

같은 사람이 같은 대상에 **두 길로** 닿는 경우가 실측에서 나왔다. GitHub lab 에서 한 사람-저장소에 org owner · 팀 셋 · 기본 권한 `read`가 **동시에** 성립했다(§5.3).

새 표기를 만들지 않고 읽는 규칙으로 푼다.

> **한 행 = 한 경로.** 행 안의 `cut` 항목은 **각각 충분하다** — 하나만 끊어도 그 경로가 무너진다.
> 그 source-target을 **완전히 회수**하려면 **행마다 `cut` 항목을 하나씩** 끊는다.

경로끼리는 **또는(∨)** 이라 하나라도 남으면 접근이 남는다. 그래서 행마다 하나씩이 필요하고 충분하다. **모든 행의 `cut` 합집합을 끊어도 회수는 되지만 과하다** — 한 경로에서 대안 둘을 다 끊는 셈이고, 그중 범위가 넓은 홉(팀 → 저장소 같은)이 섞이면 **남까지 잃는다.**

```
경로 안   홉1 ∧ 홉2 ∧ …      ->  cut 항목 하나면 그 경로가 무너진다
경로 사이 경로1 ∨ 경로2 ∨ …    ->  행마다 하나씩 끊어야 쌍 전체가 회수된다
```

아래 행 동일성이 `via`를 포함하므로 **경로마다 행이 나뉘고**, 그래서 이 규칙이 표기 추가 없이 성립한다. 앞 판이 이걸 "사례 0건이라 나중에"로 미뤄 뒀는데 **사례가 생겼다.**

### 한 경로 안에서 어느 홉을 `cut`에 넣나

```
기본 = 그 source 에게만 영향이 가는 홉 (대개 첫 홉의 멤버십)
```

인턴 Bob의 팀 가입을 끊으면 **Bob만** 잃고, 팀 → 저장소를 끊으면 **팀 전원**이 잃는다. 둘 다 회수는 되지만 **조치 범위가 다르다.** 교차 SaaS 실측에서도 실제로 끊은 지점은 Okta의 `member_of HelpDesk-Admins`였고, 그걸 끊자 Slack 채널 접근이 사라졌다(§7.5).

범위가 넓은 홉밖에 없으면 그걸 적되, **그 사실이 읽히게 적는다** — "이걸 끊으면 팀 전원이 잃는다"는 조치하는 사람이 알아야 하는 정보다.

### 집행되는 경로와 권한이 생긴 이력은 다르다

**같은 "그룹 → 자원" 모양이 서비스마다 반대 뜻이었다.** 끊어 보고 확인했다(`reports/EA_Validation_Report_v2.md` §7.1~§7.3, §7.5).

| | 그룹에서 빼면 | 끊을 지점 | 근거 |
| --- | --- | --- | --- |
| Okta 그룹 → 앱 배정 | **즉시 사라진다**(AppUser 404), 다시 넣으면 복귀 | 그룹 멤버십 | `data/okta/trial-5102035/group_cycle_0927` |
| Okta 그룹 둘 → 같은 앱 | 하나를 빼도 **남는다**(다른 그룹으로) | 그룹 멤버십 **둘 다** | `data/okta/trial-5102035/two_groups_0928` |
| Slack 사용자 그룹 → 기본 채널 | **채널에 남는다**(5분 17초 관찰) | 채널 직접 멤버십 | `data/slack_v2/changes_0927`, `retest_default_channel_0928` |
| Slack IdP 그룹 → 제한된 비공개 채널 | 91초 뒤 채널 보관(`member_count: -1`)이 첫 분명한 변화, 다시 넣으면 복귀 | 그룹 멤버십 | `data/cross/okta_slack_idp_0927` |

가운데가 함정이다. Slack 사용자 그룹의 `prefs.channels`는 **가입할 때 한 번 초대하는 동작**이고, 권한은 그 뒤 채널 직접 멤버십으로 남는다. 이걸 `via`에 넣고 `cut`으로 내면 **끊어도 아무것도 안 막힌다.**

> **`cut[]`에는 「지금도 집행되는 관계」만 들어간다.** 한 번 실행되고 끝난 부여 이력은 `via`에 남겨 감사에 쓰되 `cut`에는 못 들어간다.

집행 여부를 **못 읽으면 `cut`에 넣지 않는다.** 그 홉은 `undecomposed`로 간다(`from: computation`). 안전한 방향이 한쪽뿐이라서다 — **안 막히는 것을 막힌다고 하는 쪽이 훨씬 위험하다.**

그리고 그룹에서 빠진 사람이 채널에 남는 것 **자체가 잔존 권한**이다. 실측에서 `hwamin`·`yaeji`가 그룹에 없는데 비공개 채널에 있었다. 이건 결론을 약하게 만드는 사실이 아니라 **이 저장소가 찾아야 할 종류의 사실**이다.

> **정함 (2026-10-29, Relation 담당 결정) — 이 표시는 Profile의 참조에 둔다.** 고른 것은 Relation 쪽 속성, Profile의 참조, EA의 `via` 항목 셋이었다.
>
> 까닭: `Interface_Spec_v3`의 판별선이 *"같은 object_type의 두 행에서 값이 달라질 수 있으면 행, 아니면 Profile"*인데, Okta 앱 그룹 배정은 **언제나** 집행되고 Slack `prefs.channels`는 **언제나** 이력이다. 행마다 갈리지 않는다.
>
> 칸: 그 부여를 만드는 Profile 관계 선언의 `membership_enforced`(`Profile_Schema_v4.2` 「`membership_enforced`」). `true`는 집행, `false`는 이력, **생략은 모름**이다. 정규화가 이 값을 관계 행 `properties`로 옮기고, 규칙은 부여 홉의 그 속성을 본다(`Path_Rule_Schema_v1` 「조건식의 자리」, `access_rules.yaml` `x_member_grant`). `true`가 아니면 위 규칙대로 `cut`에 넣지 않고 `undecomposed`(`enforcement_unknown`)로 보낸다. `false`의 사유를 따로 둘지는 미결이다.
>
> `true`를 적을 곳은 Okta 앱 그룹 배정 하나다. `false`를 적을 관계는 없다 — Slack `prefs.channels`는 처음부터 관계로 만들지 않는다(`Slack_Profiles_v3` 「`prefs.channels` 는 접근 관계가 아니다」). 그래서 위 「이력은 `via`에 남겨 감사에 쓴다」에 해당하는 행도 지금은 없다. 엔진 손코드(aegi-adapter-engine `effectiveAccess/common.ts` `membershipEnforced`)는 같은 판단을 코드 안 표로 하고 GitHub 팀과 저장소도 집행으로 보는데, 끊어 본 기록이 없어(§5.1, §5.3. 멤버 전원이 owner라 팀을 끊어 봐도 차이를 볼 수 없다) Profile에 적지 않는다.
>
> **아직 안 된 것.** 엔진 정규화는 Profile의 이 값을 관계 행에 싣지 않는다(aegi-adapter-engine 후속). 그때까지 규칙 파일을 읽는 실행기는 Okta 앱 그룹 배정도 모름으로 내고, 손코드는 소속 홉을 끊는다.

### `undecomposed`는 항목마다 출처를 달고 다닌다

관계 쪽에도 같은 이름이 있는데 **가리키는 단위가 다르다.**

```
Relation.properties.undecomposed    한 행 안에서 벤더가 못 가른 부여 경로의 이름
                                    예: [org_base, enterprise]

EffectiveAccess.undecomposed        우리가 이은 경로 중 회수 지점을 못 댄 구간
```

**`vendor_stated`를 빼면서 이게 선택이 아니라 필수가 됐다.** GitHub `role_name` 같은 관계가 이제 `computed` 결론의 `via`로 들어오는데, 그 관계 행의 `undecomposed`(벤더가 합친 부여 경로)가 결론의 `undecomposed`(우리 계산이 못 푼 구간)로 **그대로 흘러든다.** 한 칸에 단위가 다른 두 값이 섞인다.

그래서 항목마다 **어느 홉에서 왔고 왜 못 풀었는지**를 적는다.

```yaml
undecomposed:
  - { at: via[1], from: relation, vendor_paths: [org_base, enterprise] }
  - { at: via[2], from: computation, reason: expression }
```

| `from` | 뜻 | 고치려면 |
| --- | --- | --- |
| `relation` | **벤더가** 못 가른다. 관계 행에서 물려받았다 | 벤더가 API를 바꿔야 한다 |
| `computation` | **우리가** 못 푼다. 조건이 `kind: expression`이거나 규칙이 없다 | 파서나 규칙을 더하면 풀린다 |

**둘을 가르는 이유는 고칠 수 있는 것과 없는 것이 다르기 때문이다.** 섞어 두면 "언젠가 풀릴 것"과 "영영 안 풀릴 것"이 같아 보이고, 그건 `Relation_Schema_v3`의 「모름」 표가 `value_not_returned`와 `unknown_prefix`를 가른 것과 정확히 같은 구분이다.

---

## 숫자 신뢰도를 쓰지 않는다

`confidence: 0.7`을 안 쓴다. Link가 든 근거 그대로다 — **그 실수가 어디서 나오는지 근거가 없고 반박할 수 없다.**

대신 **규칙 식별자와 무엇을 탔는지**를 적는다.

```yaml
source:
  rule: runs_as_inherits              # 어느 합성 규칙이 발동했나
via: [...]                            # 무엇을 타고 왔나
```

`level`이 등급이고 `rule`과 `via`가 근거다. **셋 다 사람이 읽고 반박할 수 있다.**

## 실제로 쓰였나 — `exercised`, `unused_in`

`level` 은 설정(스냅샷)으로 정한 「가능하다」다. 로그가 있으면 그 옆에 「실제로 했다」를 적는다. 정의는 [Activity_Usage_v1](Activity_Usage_v1.md) 「EA 행」.

```yaml
exercised: { count: 3, last_at: "2026-11-03T09:12:00Z", activities: [ACT-OK-12-…] }   # 출발 주체가 대상에 한 성공 사건
unused_in: { window: { from: "2026-10-25T00:00:00Z", to: "2026-11-04T10:21:55Z" } }  # 그 창 안에 쓴 사건이 없다
```

- **`level` 을 바꾸지 않는다.** 쓴 것은 「이번에 됐다」이지 「구조상 늘 된다」가 아니다. 안 쓴 것은 「창 안에 안 보였다」이지 「못 한다」가 아니다
- 둘 다 없을 수 있다(그 provider 로그가 없으면 창이 없다). 로그가 없는 데이터셋은 이 칸이 하나도 없고 파일이 지금과 같다
- 동일성 키(`id`)에 들어가지 않는다. 같은 행의 사용 기록이다
- 이 파일(`effective_access.json`)에는 쓰지 않는다. 이 파일은 다시 계산해 바이트로 견주는 저장소라, 로그에 따라 달라지는 칸은 엔진 판정 결과의 옆 표(EA 행 `id` → 칸)로 둔다

## 안 된다는 기록도 남긴다

Link가 `different`를 남기는 이유가 여기도 그대로 있다 — 사람이 한 번 검토해서 아니라고 판정하면 그건 영구 자산이고, 안 남기면 다음에 같은 질문을 처음부터 다시 한다.

```yaml
- effect_query: "봇을 호출할 수 있는가"
  references:
    source: { provider: slack, object_type: user, value: U0C0X9ZZ1 }
    target: { provider: slack, object_type: app,  value: B0BUJ7984P7 }
  level: denied
  via: [...]                  # 무엇을 보고 아니라고 했는지도 남긴다
  cut: []                     # 회수할 권한이 없다
  undecomposed: []            # 마찬가지
```

**`denied`만 둘 다 빌 수 있다.** "못 한다"는 결론에는 회수할 것이 없기 때문이고, 위 「회수 경로」의 예외가 이것 하나다.

다만 **접근이 없는 것이 기본값이라, `denied`는 물어본 쌍에만 생긴다.** 이 저장소가 답한 기록이라는 성질이 여기서도 그대로다.

---

## 무효화 — 언제 다시 계산하나

파생은 입력이 바뀌면 썩는다. **`via[]`가 그 판정을 기계로 가능하게 한다.**

```
via 에 적힌 관계 중 하나라도 removed_at 이 생기거나 값이 바뀌면   ->  그 행은 낡았다
source.view_version 이 지금 규칙 판과 다르면                      ->  그 행은 낡았다
입력 Profile 의 spec 이나 confidence 가 바뀌면                    ->  그 행은 낡았다
```

**낡은 행을 지우지 않는다.** `Relation_Schema_v3`의 `removed_at`과 같은 이유다 — 지우면 "없어졌다"를 표현할 대상이 사라지고, 그때 그렇게 답했다는 감사 기록도 같이 사라진다. `stale_at`을 적고 남긴다.

**diff는 같은 `view_version`끼리만 돈다.** 여기서는 조건이 하나 더 붙는다 — `inputs_view_version`도 같아야 한다. 관계 어휘가 그대로여도 **우리 합성 규칙이 바뀌면** 같은 입력에서 다른 결론이 나오기 때문이다. 둘을 따로 적는 이유가 그것이다.

### 같은 결론인지 판단하기 — `via`가 키에 들어간다

**앞 판에 이 규칙이 아예 없었다.** 불변식 열아홉 줄 어디에도 "두 행이 같은 결론인가"가 없었고, 그래서 **권한이 올라간 것을 못 알아챘다.**

가상 회사 시험에서 측정됐다(§2.2). 인턴 Bob이 `platform` 팀(결제 저장소 쓰기)에 더해 `admin` 팀(결제 저장소 관리자)에 들어간 사고다.

| diff 키 | 새로 생긴 행 |
| --- | --- |
| `(source, target, source.rule)` | 4 |
| `(source, target, source.rule, via[] id 순서열)` | **6** |

**앞 키로는 "전에도 접근 가능"이라 변화 없음으로 나온다.** 빠진 2행이 결제·인증 저장소의 **관리자 승격**이다.

```
(references.source, references.target, source.rule, via[] 항목 id 의 순서열)
```

`effect`를 키에 넣는 방법도 있지만 **v1은 `effect`가 언제나 `null`이라 못 쓴다.** `via`를 넣으면 같은 수준의 **새 경로**까지 잡히므로 더 넓게 맞는다.

이 키가 위 「한 행은 한 경로다」를 떠받친다 — **경로가 다르면 행이 다르다.**

### 이 저장소가 못 잡는 것 — 객체 상태 변화

같은 시험의 다른 시나리오에서 **결론 변화가 0행**이었다(§2.3). 퇴사한 Charlie의 Okta 계정이 **정지**됐는데 GitHub·Slack·Google 권한이 남은 경우다.

권한 **관계**는 하나도 안 바뀌었고 바뀐 것은 **계정 상태** 하나인데, 위 무효화 규칙이 관계만 본다.

> **이건 이 저장소가 맡을 일이 아니다.** "정지됐는데 권한이 남았다"는 두 사실의 **비교**라 탐지 규칙이 맡는다.

다만 **못 잡는다는 사실 자체를 적어 둔다.** 안 적으면 화면이 "변화 없음"으로 안심시킨다 — 그리고 그 시나리오가 하필 데모의 주인공이다.

---

## 어휘를 이번 판에서 만들지 않는다

**`effect`를 비워 둔다.** `effect: null` + 질의 이름(`effect_query`)만 적고, 어휘 승격은 `Relation_Schema_v3`의 「닫힌 어휘를 늘리는 절차 — A단계 / B단계」를 그대로 탄다. **지금 `effect`는 A단계에 있다** — 기존 어휘로만 매핑하고 안 맞는 것은 대기열에 둔다.

근거가 없어서다. 지금 손에 있는 것은 이만큼이다.

```
can_invoke      근거 0건.  이름이 나온 자리가 "이런 느낌이면 좋겠다"는 스케치 한 장뿐이다
role 류          GitHub role_name 이 주는 것은 역할이지 행위가 아니다
```

**`can_invoke`는 약한 근거가 아니라 근거가 아니다.** 벤더 문서에서 나온 이름도 아니고 실 응답에서 본 것도 아니다. 이 문서가 그 이름을 예시에 쓰는 것은 **형식이 어떻게 생겼는지 보이려는 것**이지 그 어휘를 제안하는 것이 아니다.

같은 실수의 값을 이미 쟀다 — `governs`는 데이터가 0건인데도 문서 재작성 2회와 재검증 2회를 먹였고, 결론은 **만들었다 지우는 게 안 만들고 나중에 만드는 것보다 훨씬 비싸다**였다. 그때도 이름이 먼저 있었고 데이터가 나중에 없었다.

그래서 v1은 **모양만 정한다.** 어휘는 실제 질의가 둘 이상의 provider에서 같은 모양으로 요구될 때 승격한다. `relation_type: null`이 "봤는데 어휘에 자리가 없다"를 뜻하는 것과 정확히 같은 표기를 쓴다.

**이 판단이 이 문서에서 제일 중요하다.** 형식은 지금 정할 수 있고 어휘는 아직 못 정한다.

---

## 화면이 이 저장소를 저장 관계와 섞으면 안 된다

**화면 설계는 이 문서가 정하지 않는다.** 여기서 정하는 것은 하나뿐이다 — 파생 결론을 저장 관계와 **같은 것처럼 그리면 안 된다.**

축이 둘이고 겹치지 않는다.

```
축 1  어떤 relation_type 인가     구조 / 접근 / 신뢰     <- 표현 등급. 저장 관계만 해당
축 2  그 간선이 어디서 왔나        저장 / 파생            <- 이 저장소는 「파생」
```

`authenticates_with`(저장·신뢰)와 그걸 타고 나온 파생 결론은 **축 1이 같고 축 2가 다르다.** 둘을 한 채널(색이든 모양이든)에 몰아넣으면 그 사실이 안 보인다. 어느 채널을 어느 축에 줄지는 구현이 정하되, **두 축을 한 채널에 겹치지만 않으면 된다.**

`level`이 `indeterminate`인 행은 `Relation_Schema_v3`의 「모름」 표 셋째 종류다 — **아무것도 안 보이는 것이 정상처럼 보이는** 쪽이라 반드시 따로 표시한다. 이건 화면 취향이 아니라 **조용한 거짓을 막는 장치**라서 여기 적는다.

**같은 이유로 화면은 "변화 없음"을 안전 신호로 쓰면 안 된다.** 이 저장소는 **객체 상태 변화를 못 잡는다**(위 「이 저장소가 못 잡는 것」). 정지된 계정이 권한을 들고 있어도 관계가 안 바뀌었으면 diff가 0행이다. 그 0을 "괜찮다"로 그리면 **제일 위험한 경우에 제일 안심시키게 된다.**

---

## 이 파일이 지켜야 할 것

- `references.source`와 `references.target`이 있다. `role` 슬롯은 없다
- 각 슬롯은 실재하는 Object를 가리킨다
- **어느 `level`도 전이가 아니다.** 두 행을 이어 세 번째 행을 자동으로 만들지 않는다
- 행에 `transitive`를 적지 않는다. 전이 금지는 위 한 줄이 전부다
- `via[]`가 비어 있지 않다. 근거 없는 결론을 만들지 않는다
- `via[]`의 각 항목은 `kind`가 `relation` 또는 `link`다
- `kind: relation`인 항목은 실재하는 Relation 행을, `kind: link`인 항목은 실재하는 Link 집합을 가리킨다
- `cut[]`이 비어 있고 `undecomposed[]`도 비어 있으면 `level`은 `denied`다
- `level: indeterminate`이고 `cut[]`이 비면 `undecomposed[]`가 비어 있지 않다
- `cut[]`의 모든 항목이 `via[]`에도 있다
- **`cut[]`에는 「지금도 집행되는 관계」만 들어간다.** 집행 여부를 못 읽으면 `undecomposed`로 간다
- 행 동일성은 `(references.source, references.target, source.rule, via[] 항목 id 의 순서열)`이다. **diff 는 이 키로 돈다**
- **한 행은 한 경로다.** 같은 source-target 에 경로가 둘이면 행이 둘이다
- **`cut`의 각 항목은 그것 하나만 끊어도 그 경로가 무너진다.** 항목끼리는 대안이다
- 한 source-target 의 완전 회수는 **행마다 `cut` 항목 하나씩**이다. 합집합은 충분하지만 과하다
- `source.rule`이 있다. 숫자만 있는 신뢰도는 쓰지 않는다
- `source.view_version`과 `source.inputs_view_version`이 둘 다 있다. diff는 둘 다 같은 것끼리만 돈다
- `level`은 네 값 중 하나다. `vendor_stated`는 v1에서 뺐다
- `level: computed_cross`인 행은 `via[]`에 `kind: link`인 항목이나 교차 관계 항목(양 끝 provider가 다르거나 `cross_provider` 표시, 엔진 `x_cross_provider`)이 있다
- `level: computed`인 행은 양끝의 provider가 같고 `via[]`에 `kind: link`인 항목도, 교차 관계 항목도 없다
- `stale_at`이 있는 행은 지우지 않는다
- **이 저장소는 "없음"을 결론으로 쓰지 않는다.** 물어본 쌍만 들어 있다
- 질의는 기본으로 이 저장소를 타지 않는다. 명시적으로 켜야 한다
- `effect`가 `null`이면 `effect_query`가 있다
- **일반 규칙(General Access Graph) 계산 시 전수 denied 를 만들지 않는다.** 성립하는 긍정/미확정 경로(`computed`, `computed_cross`, `indeterminate`)만 행으로 생성한다
- **약한 신원 간선은 한 Link 경로에 하나까지만.** `via[]`에서 같은 Link로 이어진 간선들(두 계정을 잇는 경로) 가운데 약한 간선(`possibly_same`, `possibly_related`, `candidate`, `inferred`)은 많아야 하나다. 나머지는 `strong`(`resolved`, `disclosed_relation`)이다. 약한 간선 둘 이상은 잇지 않는다(2026-10-29 정함, `Link_Schema_v3` 「정한 것」)
- 약한 간선이 `via[]`에 있는 행의 `level`은 `indeterminate` 또는 `denied`다. `indeterminate`이면 `undecomposed[]`에 그 홉(`at: via[i]`, `reason: identity_link_weak` 또는 `identity_weak`)이 있다. `denied`는 단계를 내리지 않는다. 그 링크는 어느 계정에 물었는지를 적은 것이고 판정은 그 계정에 대한 것이다
- 일반 규칙으로 계산된 행의 `x_asked_by`는 손코드면 `{ rule_id: 'GENERAL_ACCESS_GRAPH', check_id: 'general-runs-as-inherits' }`처럼, 규칙 파일 실행기면 `{ rule_id: 'ACCESS_RULES', check_id: '<rule_id>' }`다. 운영의 `runs_as_inherits` 일반 행은 실행기 쪽이다(aegi-adapter-engine#147)

---

## 정한 것 (2026-10-29, Relation 담당 결정)

- **`effect` 어휘.** 위 절에 적은 대로 이번 판에서 안 만든다. 능력 순위(`ontology/capabilities.yaml` `rank`)만 쓴다. 승격 기준은 "provider 둘 이상에서 같은 모양의 질의"
- **합성 규칙을 어디에 쓰나.** access, event 두 파일(`ontology/access_rules.yaml`, `ontology/event_rules.yaml`). 2026-10-26에 초안 `access_rules.yaml`을 두었다(엔진 손코드의 규칙 5개, 형식은 `Path_Rule_Schema_v1`, 검사 `validation/check_path_rules.py`). 엔진 실행기가 그 사본을 aegi-adapter-engine#130부터 읽고, #136부터 운영 정규화에서 그림자로 돌리며, #147(10-29 머지)부터 운영 EA의 `runs_as_inherits` 일반 행을 계산한다. 형식 문서 「정할 것」은 10-29에 비었고, 남은 제안값과 규칙에 딸린 미결은 그 파일(`assumes`, 규칙의 `differs`와 `notes`)에 있다
- **집행 표시를 어디에 두나.** Profile의 참조(위 「집행되는 경로와 권한이 생긴 이력은 다르다」). 칸은 관계 선언의 `membership_enforced`이고, 규칙은 부여 관계 행의 속성으로 읽는다. 후속(aegi-adapter-engine): 정규화가 Profile 값을 관계 행에 싣기, Okta 앱 그룹 배정 Profile에 `true`, 개념 사전 사본 맞추기, 실행기의 `enforced` 갈래와 그 시험(`scripts/accessRulesExecutor.test.ts`의 모름 기록 단정) 정리
- **`computed_cross`의 범위.** 교차 관계(양 끝 provider가 다르거나 `cross_provider` 표시)로 건넌 것도 `computed_cross`다(위 「단계」, 「이 파일이 지켜야 할 것」)
- **초안 탈출 조건.** 채운 것으로 보고 v1으로 정했다. 근거를 벤더 집행(우리가 구성한 시험 둘)과 조직 사용(지금 없음) 두 칸으로 나눈다(위 「초안을 벗는 조건」)
- **`binding: ambient` 판정 규칙.** Okta는 `type: BUILT_IN`이고 이름이 `Everyone`인 그룹을 전원으로 본다. 한 덩어리로 다루고 사람마다 행을 펴지 않는다(위 「인스턴스 층은 「결정적 인스턴스」만 센다」). 지금 데이터의 정책 `applies_to` 3행이 `explicit`이라 그것부터 고친다(엔진 후속). 그룹이 권한을 받는 관계는 수집에 생길 때

## 아직 안 정한 것

- **규격 패턴이 0개다.** 검사는 고쳤고(`role` 슬롯 · 역방향 `member_of`) 이제 자료 쪽이다. `applies_to`·`excludes`·`permits`가 저장소 어디에도 선언돼 있지 않아 이을 짝이 없다
- **Okta 최소 두 조각 — 실 API 로 확인됐다.** ① `okta.policy`의 `included_groups`/`excluded_groups`에 `applies_to`/`excludes` ② `okta.group`에 멤버십 간선. 둘 다 `spec: 3 -> 4` 승격이 딸려 온다(기준선 45건 중 15건). 확인된 것:
  - 멤버십은 `/api/v1/groups/{id}/users` 와 `/api/v1/users/{id}/groups` **둘 다 동작한다**
  - 앱 그룹 배정은 `/api/v1/apps/{id}/groups`
  - **그룹 조건 자리가 둘이다** — 정책 수준 `conditions.people.groups.include`(§3.2)와 규칙 수준 같은 경로(§4.2). 둘 다 수집해야 한다
  - `people.users.exclude: []` — **키가 있고 빈 배열인 규칙과 키 자체가 없는 규칙이 같이 있다**(§3.4). 수집기가 둘을 구분해야 한다
  - `AppUser`의 `id`가 **사용자 id** 라 여러 앱에 같은 값이 나온다. 404 문구가 리소스 키를 `사용자id + 앱id`로 적는다 — 복합 키 확인(§3.6, §7.1)
  - **`Okta_Profiles_v3`의 "이 파일은 아직 수집에 쓰면 안 된다"를 다시 볼 수 있다.** 이제 실 호출이 있다
- **재계산 주기.** 질의 때마다 다시 푸는지, 낡은 행을 그대로 답하고 표시만 하는지
- **Assignment Object와의 관계.** Assignment는 관계 자신이라 끝점이 안 되는데, 파생 결론의 `via`에는 그 관계가 들어간다. 표기가 어긋나는지 확인 못 함
- **봇·앱이 source일 때.** Link가 못 잇는 것과 같은 구멍이다. Slack 실측에서 봇·앱 계정 21건은 어떤 방법으로도 안 이어진다
- **퇴사자 잔존 권한을 누가 잡나.** 이 저장소는 객체 상태를 안 봐서 못 잡는다. 탐지 규칙이 맡는다고 보지만 확정은 팀이 한다
