# 범용 접근 엔진 v1 — Effective Access · 권한 차집합을 하나의 계산으로 (2026-09-29)

이력 문서: 위협 판정 부분은 [`AEGI_THREAT_JUDGMENT_V2.md`](AEGI_THREAT_JUDGMENT_V2.md)가 대체했다. 본문은 당시 기준이다.

현재 게시 진입점은 `scripts/loader/engine.ts`, 위협 판정은 `src/detection/threat/`(위협 판정 V2)다. 아래 과거의 normalize:v2와 validate:data 단계는 현행 명령이 아니다.

EA(`src/detection/v2/effectiveAccess/`)와 권한 차집합(`src/detection/v2/accessGap.ts`)은 따로 만들어졌다.
그런데 둘은 같은 질문 — 「누가 무엇에 닿는가」 — 을 서로 다른 정의로 푼다.
이 엔진은 그 질문을 **간선 표 하나 + 범용 규칙 + 3값(예 · 모름 · 아니오) 경로 질의**로 한 번에 푼다.
권한 차집합은 **같은 규칙을 원래 간선만으로 한 번, 연동 간선까지 넣어 한 번 푼 결과의 차**다.

- **상태(2026-10-28): 일반 위협 판정은 AccessEngine을 사용한다. Access Gaps는 별도 계산 경로이고 EA 규칙 파일 실행기는 손코드 EA 옆에서 그림자로 실행한다.** 아래 세대 전환 절차와 수치는 2026-09-29 설계 기록이다. AEGI 질문 v2는 한 쌍 권한 질의를 사용한다. 브라우저에 coverage가 없으면 빈 coverage를 명시해 목록 누락을 미확인으로 처리한다. 합성(`validate:data` Stage 8)과 실측(`normalize -- --raw <원본> --run <완료된-run> --out <데이터셋>`)에서 기존 판정과 나란히 계산해 맞춰 본다(§6).
  실데이터에서 대조가 깨끗해지면 판정을 넘겨받는다(§9).
- **상태(2026-11-17): 다리 단위 격차 계산(§2-4 ~ §2-6, `policies.ts`, `accessGap.ts`, `publishedGaps.ts`)과 원인 질의 `cause`, `know`, 다리 대조를 지웠다(aegi-adapter-engine#452).** Access Gap 은 위협 판정 V2 의 위협마다 벤이다(`docs/spec/AEGI_THREAT_JUDGMENT_V2.md` 8절). 이 엔진은 간선 표(`EdgeIndex`), 한 쌍 질의 `can`, `acts`, 사건 기록 대조의 원래 권한 질의, EA 줄 대조를 맡는다. 연동으로 닿는지는 위협 판정의 파생 접근(`derivedAt`)으로 묻는다. §1, §2-3 의 `cause`, `know` 와 §2-4 ~ §2-6, §5, §9 는 설계 기록이다.
- 코드: `src/detection/v2/engine/` · 검증 스크립트: `scripts/accessEngine.ts` (`npm run engine:verify`)
- 실데이터 검증 절차는 **§7**. 처음 보는 사람은 §1 → §7 만 읽어도 된다.

## 1. 문제를 포함 검사 두 개로

| 정책 | 지켜야 할 식 | 격차 | 시나리오 |
| --- | --- | --- | --- |
| 기밀성 | 사본을 볼 수 있는 사람 ⊆ 원본을 볼 수 있는 사람 | `know(S @ 사본 위치) − can[read](S)` | D (시트 → 스크립트 → 웹훅 → 채널), A (메시지 → 에이전트 → PR) |
| 무결성 | 연동으로 바꿀 수 있는 사람 ⊆ 직접 바꿀 수 있는 사람 | `cause(행위자 → x) − can[write](x)` | A (작성자 → 에이전트 → 저장소), B (채널 → /devbot → PAT → 저장소), C (채널 → /mfa-reset → Okta 클라이언트 → 사용자), D (폼 → 스크립트 → 채널) |

- `can` 은 원래 권한, `cause`(일으킬 수 있다) · `know`(내용을 볼 수 있다)는 연동으로 생긴 효과다.
  EA 규격 「부른 사람은 자동화의 권한을 갖지 않는다」를 그대로 지킨다 — 부른 사람에게 권한을 붙이지 않고 효과를 따로 센다.
- 질문은 **바인딩이 아니라 연동 간선에서** 나온다. F 간선이 나가는 원본마다 기밀성 묶음, T 간선이 들어오는 행위자마다 무결성 묶음을 만든다.
  그래서 시나리오에 없던 경로(합성 A 의 기밀성, 실측 C 의 봇 → #helpdesk 게시)도 자동으로 나온다.

## 2. 알고리즘

### 2-1. 간선 7종 (`edges.ts`)

저장된 사실을 전부 간선으로 옮긴다. 간선마다 **확실성**(불확실 사유 코드), **회수 가능**(`basis: stated`, 합친 값 아님), **관측 여부**(증거·관측에서 왔나)를 붙인다.

| 종류 | 뜻 | 원천 | 원래/연동 |
| --- | --- | --- | --- |
| M 소속 | 주체 → 그룹·테넌트 | `member_of`(→ 그룹·테넌트), `references.tenant`(주체), 테넌트 `contained_in` 테넌트 | 원래 |
| U 범위 | 자원 → 상위 | `contained_in`, `references.parent/parent_file/tenant`, `registered_in` | 원래 |
| G 권한 | 주체 → 자원, 순위(read 1 · write 3 · admin 5) | `has_role_on`(역할 능력 §2-2), `owned_by`, 권한 배정(`grantee` → `parent`), `member_of`(→ 자원, Slack 채널은 write), `shared_with`(anyone 은 `@everyone`), `references.author`(write)·`owner`, 채널 공개 여부, 관측된 쓰기(`attributed_as`, `credential_use`, 요청이 기록된 자동화 주체) | 원래 |
| T 호출·입력 | 주체·자원 → 행위자 | 요청 관측(`slash_request`·`request_log`)의 요청자, `agent_run` 시킨 사람, `context_used_by`(입력 자원의 쓰기 권한자가 결과에 영향), `triggered_by`, 폼 제출, 컨테이너 바인딩 스크립트(편집자 = `modify`), 진입점 모델(슬래시 명령 = 테넌트 멤버, 게이트 모름) | 연동 |
| A 대행 | 행위자 → 실행 신원 | `runs_as`, `acts_as`, `owned_by`(엔드포인트 → 앱, 앱 → 봇. 받는 곳(`receives_into`)이 정해진 엔드포인트는 빼고, Slack 수신 웹훅은 그 채널에 올릴 뿐이다), 자동화 Identity Link, `delivered_to`, 효과의 `attributed_as`, 요청 관측에 기록된 자동화 주체, 자격증명 사용 | 연동 |
| F 사본 | 데이터가 옮겨 가는 곳 | `context_used_by`, `delivered_to`, `receives_into`, `runs_as`(→ 웹훅), `produced`, 전송 관측(`delivery`), 담긴 자동화(구조상) | 연동 |
| E 효과 | 행위자 → 바꾼 객체 | `produced`·`correlates_by`(관측 → 객체), 요청의 `target_object`·`correlated_commit`, 에이전트 결과, 전송된 메시지 | 연동 |

- **행위자**: 요청을 받은 엔드포인트(`requested_via` 또는 관측의 Endpoint) → 관측이 적은 자동화 → 둘 다 없으면 실행 자체(가상 노드 `obs:<관측 id>`, 예: AI 에이전트 세션).
- **가상 노드 `@everyone`**: 누구나(anyone 공유, 폼 응답자). 사람 목록으로 셀 수 없어 결과에 「누구나」 한 줄로 나온다.
- 시나리오 키·바인딩·상관 ID 는 읽지 않는다(D-12). 탐지 코드에 데이터셋 키 0개(Stage 4)도 그대로 지킨다.

### 2-2. provider 권한 모델 (`accessModel.ts`) — 코드가 아니라 데이터

| 표 | 내용 |
| --- | --- |
| 역할 능력 `roleCapability` | ① overrides. 그다음은 사전 `capabilities.yaml` `role_rank_order` 순서이고, 앞 방법이 못 정하면(이름은 있는데 표에 없어도) 다음 방법으로 간다. ② 이름 — Okta 표준 역할(적용 객체 종류 포함 — HELP_DESK_ADMIN 은 user, userfactor), Okta 앱 배정, provider 별 이름 표(`role_name_rank`: Jira 권한 키 36개, 필터 공유 view, edit, Confluence `동작:대상`, Salesforce OAuth 승인), 이름 순위(`access.ts` roleRank: GitHub read~admin, pull/push, Drive reader~owner), 권한 요약(`contents:write,metadata:read`) ③ 역할 객체의 `scopes`(Slack bot-token. `scope_rank`: `admin*` 5, `chat:write` 3, 채널 읽기 1, 그 밖은 0) ④ 역할 객체의 권한 칸(Salesforce 프로필, 권한 집합 `perm_*`. `role_flag_rank`: Modify All Data, Manage Users, Author Apex 5, View All Data 1, 칸은 있는데 참이 없으면 0) ⑤ 역할 객체 종류(`role_type_rank`: Salesforce `UserRole` 0) ⑥ 같은 대상에 받은 권한 줄(`role_rank_from_grants`: Jira 프로젝트 역할은 그 프로젝트에서 받은 권한 키 중 가장 센 것, 한 단계만) ⑦ Okta 사용자 정의 역할 `permissions`(`okta.users.*` → user, userfactor …) ⑧ GitHub 사용자 정의 역할 `base_role`. **모르면 순위가 없다** — 간선을 불확실(`role_rank_unknown`)로 둔다. 지금 코드처럼 권한 있음으로 치지 않는다 |
| 테넌트 권한 상속 | okta·github 는 조직 역할이 안으로 내려간다. slack·gws 는 아니다 |
| 상속 상한 | Slack 채널 → 메시지는 read 까지 (채널 멤버가 남의 메시지를 고치지는 못한다) |
| 공개 여부 | Slack 채널 `is_private`: false 면 테넌트 멤버 read(확실), 없으면 불확실(`channel_visibility_unknown`), true 면 없음 |
| 진입점 | Slack 슬래시 명령: 테넌트 멤버 누구나 부를 수 있다 — [슬래시 명령은 어느 대화에서나 부를 수 있고](https://api.slack.com/tutorials/your-first-slash-command) 채널 제한은 앱 코드다. 확인 전에는 불확실(`invoker_gate_not_stored`) |
| 컨테이너 바인딩 | Apps Script 프로젝트, GitHub Actions 워크플로: 담긴 파일(저장소)의 편집자가 코드를 고친다(`modify`). 다른 자동화를 거쳐 컨테이너를 바꾸는 사람은 `input` 으로 센다. 그 자동화의 자격증명이 코드까지 고친다는 근거가 없다(GitHub 은 workflow 파일 수정에 `workflows` 권한을 따로 요구) |
| 응답자 모름 | Google Forms: `@everyone` 이 쓸 수 있다(불확실 `form_responders_unknown`) |
| 수집 완결성 `COVERAGE_CALLS` | 호출 → 그 호출이 다 가져와야 닫히는 사실 묶음 (§3-1) |

### 2-3. 질의 (`query.ts`) — 0-1 BFS 경로 질의

```
can[need](x)   : M* · G[능력 ≥ need, 적용 종류] · U⁻¹*          원래. 연동 간선을 절대 타지 않는다
cause[need](x) : 호출자(T, M*) · 행위자 · ( E  |  A* · can[need](x) )
know(S)        : can[read](d) · F⁻¹* (S)                      d = S 에서 F 로 닿는 사본 위치
```

- 확실한 간선 비용 0, 불확실한 간선 비용 1. 비용이 작은 것부터(버킷 큐) 퍼뜨려서 **가장 덜 불확실한 경로가 곧 근거(witness)**다.
- 비용 0 으로 닿으면 **yes**, 비용이 있으면 **unknown**(경로 위 사유를 모은다).
- 못 닿으면: 지나온 소속·권한 목록이 **모두 닫혀 있을 때만 no**, 하나라도 열렸으면 unknown(§3-1). 「없다고 단정하지 않는다」를 알고리즘을 바꾸지 않고 지킨다.
- 역할의 `excludes` 는 그 역할을 받은 그룹의 멤버를 펼 때 뺀다.
- **구조상 대행의 벌점**: 관측된 효과(E) 없이 실행 신원의 권한(A*·can)으로만 이으면, 코드를 고칠 수 있는 사람(`modify`)이 아닌 한 `automation_behavior_unknown` 를 더한다. 부를 수 있다고 자동화가 그 권한을 다 쓰지는 않는다. 대행과 권한이 모두 관측이면(그 신원으로 그 대상에 쓴 기록) 벌점이 없다.
- **효과는 안으로 번진다**: 저장소에 대한 cause 는 저장소 안 커밋에 대한 효과도 센다. PR → 커밋처럼 이어서 만들어진 객체로도 번진다.

### 2-4. 사람 단위 3값 차집합 (`policies.ts` `diffPeople`)

```
gap(p) = 연동(p) ∧ ¬∃b [ 같은사람(p, b) ∧ 원래(b) ]        (Kleene 3값 논리)
```

| 같은사람(a, b) | 값 |
| --- | --- |
| 같은 계정 · 강한 링크(`resolved`·`disclosed_relation`)로 같은 사람 | yes |
| 약한 링크(`possibly_same`)로 같은 사람 | unknown — 「약한 연결로 같은 사람」(칸은 **둘 다**, 세기 weak) |
| 같은 SaaS 의 다른 계정 · `different` · 사람↔자동화 · 강한 링크로 다른 사람 | no |
| 연결 기록이 없거나 약해서 다르다고 단정 못 함 (`judgeSamePerson` weak) | unknown — 「다른 사람이라고 단정 못 함」 |

| 연동 \ 원래 | no | unknown | yes |
| --- | --- | --- | --- |
| yes | **확정 격차** `gap` | 추정 격차 `gap_inferred` | 둘 다 `both` |
| unknown | 추정 격차 | 추정 격차 | 둘 다 |

- 사람 비교에는 주체이고 자동화가 아니고 측정 도구가 아닌 계정만 넣는다. 자동화 계정은 경로(대행)에만 나온다.
- 원래 집합에 `@everyone` 이 확실히 있으면 격차가 없다. 연동에만 `@everyone` 이 있으면 「누구나」가 격차에 한 줄로 나온다.
- 원래 집합에 사람이 한 명도 없고(`@everyone` 도 없음) 목록도 닫혀 있으면 원래 쪽을 no 가 아니라 unknown 으로 둔다. 사유 `native_holders_missing`. 권한자 0명은 「아무도 권한이 없다」보다 정규화나 역할 전개 공백일 때가 많다. 2026-11-08 실측에서 GitHub 사용자가 Principal 없이 정규화돼 저장소 쓰기 권한자 0명, Okta 관리자 역할이 사용자 쓰기로 펼쳐지지 않아 0명이 나와 HIGH 3건이 확인 인원으로 부풀었다.
- 무결성에서 자동화가 **새로 만든 것**(메시지·커밋·PR)은 그 객체가 아니라 담긴 곳에 쓰는 권한으로 원래 집합을 센다: `can[write](x) ∪ can[write](대표 범위, x 의 종류로)`.

### 2-5. 묶음과 대표 범위

- 기밀성 묶음 = (원본 S, 사본 위치의 대표 범위). 무결성 묶음 = (행위자, 대상의 대표 범위). 무결성 대상 = 관측된 효과 객체 ∪ 실행 신원이 쓰기 권한을 가진 범위(구조상, 행위자당 50개까지).
- **대표 범위** `representative()`: 자기 권한 설정이 있는 첫 객체 → 없으면 가장 위의 테넌트 아닌 자원 → 테넌트 → 자기 자신. 메시지 → 채널, 커밋 → 저장소, Okta 사용자·인증 수단 → Okta 조직.
- 원본 자신이나 원본의 상위로 돌아오는 흐름은 사본으로 치지 않는다.
- 묶음 안에서 사람마다 가장 나쁜 칸을 남긴다(대상 여럿 중 하나라도 격차면 격차).

### 2-6. 회수 지점 — 반사실로 잰다 (`cutOptions`)

격차 인원의 근거 경로와 행위자의 실행 신원 경로 위에 있는 **회수 가능 간선**(stated)을 최대 8개 골라, 하나씩 **끊고 묶음을 다시 푼다**.

| 칸 | 뜻 |
| --- | --- |
| 격차 닫힘 | 연동 쪽이 no 가 된 격차 인원 |
| 추정으로만 내려감 | yes → unknown (예: 공개 여부를 모르는 채널에서 멤버십만 끊음) |
| 같이 잃음 | 연동을 정당하게 쓰던 사람(둘 다) · 원래 권한자 |

- 끊은 문맥에서는 **관측된 효과·관측된 쓰기가 설정 권한에 기댄 경우 그 설정이 사라지면 인정하지 않는다** — 역할을 거두면 자동화가 다시는 그 일을 못 한다. 끊기 전에도 설정 경로가 없었으면(무엇으로 했는지 모름) 관측을 그대로 둔다.
- 이미 올라간 사본은 채널 안 자원(메시지)이라 웹훅을 끊어도 `know` 가 남는다. EA D 규칙에 손으로 적은 「웹훅은 회수가 아니다」가 규칙 없이 나온다.
- 모든 경로를 끊는 최소 집합은 풀지 않는다(하나씩만 끊는다). 한 사람에게 경로가 여럿이면 「닫힘」이 0 으로 나올 수 있다 — 그 경우 보고서의 근거 경로를 보고 여러 곳을 같이 끊는다.

### 2-7. EA 와의 대응

| EA | 엔진 |
| --- | --- |
| `level` computed / computed_cross / indeterminate / denied | witness 비용 0·provider 하나 / 비용 0·provider 여럿 / 비용 > 0 / no |
| `via` | witness 간선 (관계·Link 뿐 아니라 증거·관측·모델 간선도 — `refs` 에 원천) |
| `undecomposed` | 경로 위 불확실 사유 |
| `cut` | §2-6 반사실 결과 |
| 규칙 `x_member_grant` · `runs_as_inherits` | 경로 모양 `M·G` · `A·G` |
| 「관계 한 줄로 끝나는 권한은 줄이 없다」 | 엔진은 줄 없이도 답(yes/no)을 낸다 — 차집합에 필요하다 |

EA 파일(`effective_access.json`)은 지금 모듈이 그대로 만든다. 엔진은 같은 질문을 다시 풀어 대조만 한다(§6).

## 3. 입력 파일 (데이터셋 폴더 옆, 선택)

### 3-1. `coverage.json` — 수집 완결성

`npm run normalize`(IM Profile 단일 파이프라인)가 수집 실행 기록에서 만든다(`scripts/collect/shared/coverage.ts`).

```json
{ "format": "aegi-coverage/v1", "generated_at": "…", "calls": [ { "provider": "slack", "call_id": "SL-04", "completeness": "partial", "reasons": ["bot_not_member"], "run_id": "…" } ] }
```

`COVERAGE_CALLS` 가 호출을 사실 묶음에 잇는다. 호출이 `full` 이 아니거나 파일에 없으면 그 묶음이 **열린다**.

| 호출 | 닫는 묶음 |
| --- | --- |
| SL-01 · SL-02 | slack workspace·enterprise 멤버 |
| SL-04 | slack conversation 권한(멤버) |
| SL-06 · SL-15 | slack usergroup 멤버 |
| GH-02 | github organization 멤버 |
| GH-04 | github team 멤버, repository 권한(팀) |
| GH-06 | github repository 권한(협업자) |
| OK-02 · OK-03 | okta org 멤버, group 멤버 |
| OK-06 · OK-07 | okta org 권한(관리자 역할), application 권한(앱 배정) |
| GW-03 · GW-04 · GW-07 | gws customer 멤버, group 멤버, file 권한 |

- PAT 승인(GH-13)은 넣지 않았다 — PAT 권한은 주인 권한을 넘지 못해 권한자 집합을 넓히지 않는다.
- 파일과 관계없이 **멤버가 하나도 없는 그룹**은 열린다(`group_members_empty`), **받는 쪽이 객체가 아닌 권한 배정**(외부 이메일)은 그 자원의 권한 목록을 연다(`grantee_unresolved`), **외부 공유 채널**도 연다(`ext_shared`).
- 파일이 없으면 모든 목록을 닫힌 것으로 보고 경고를 낸다. 합성 데이터셋은 파일이 없다(사람 표·목록이 완결된 합성 데이터라서).

### 3-2. `access_engine_overrides.json` — 확인한 사실

끊어 보기·벤더 문서로 확인한 것을 **데이터로** 적는다. 예시: `docs/spec/access_engine_overrides.example.json`.

| 키 | 값 | 효과 |
| --- | --- | --- |
| `entry_point_gates.<엔드포인트 키>` | `channel_membership` · `none` · `unknown` | 호출자: 관측된 요청 채널의 멤버만(확실) · 테넌트 멤버 누구나(확실) · 기본(불확실) |
| `role_capabilities.<역할 객체 키 또는 provider:역할이름>` | `{ rank, applies_to? }` | 역할 능력을 정한다 (`role_rank_unknown` 해소) |
| `confirmed_resource_sets` | Okta 리소스 세트 id 목록 | `resource_set_not_expanded` 해소 |
| `notes` | 문자열 | 언제·어떻게 확인했는지 |

## 4. 코드

```
src/detection/v2/engine/
  types.ts        간선·답·결과 타입, coverage·overrides 파일 모양
  accessModel.ts  provider 권한 모델 (§2-2), 수집 완결성 표 (§3-1), 사유 문구·푸는 법
  edges.ts        저장된 사실 → 간선 (§2-1). EdgeIndex
  query.ts        can · members · witness (§2-3). QueryContext
  usage.ts        사건 기록 대조(원래 권한 질의, 호출 판정. 연동은 위협 판정의 파생 접근으로 묻는다)
  parity.ts       EA 줄 대조 (§6)
  report.ts       markdown 보고서 · 콘솔 요약
  index.ts        AccessEngine.run() · askCan · actsCan
scripts/accessEngine.ts                    npm run engine:verify
scripts/collect/shared/coverage.ts         coverage.json
```

```ts
const { engine, result } = runAccessEngine({ graph, evidence, coverage, overrides })
result.edges         // 간선 종류마다 확실, 불확실 수
engine.askCan('SLK-U-UB', 'write', repoKey)   // 한 쌍 질의 → { verdict, witness, open }
```

결과는 결정적이다(같은 입력 → 같은 JSON, Stage 8 이 확인).

## 5. 지금 결과

### 합성 데이터셋 (`npm run engine:verify`)

간선 M 78 · U 96 · G 26(+불확실 15) · T 9(+2) · A 7(+1) · F 6(+6) · E 7. 묶음 6개.

| 묶음 | 확정 격차 | 추정 격차 | 기존 판정 |
| --- | --- | --- | --- |
| 무결성 · /devbot → internal-ops-tools | user-d | 16 (워크스페이스 멤버, 게이트 모름) | 룰 B 위반 대상 user-d ✓ |
| 무결성 · /mfa-reset → Okta 조직 | user-a | 16 (같은 이유) | 룰 C user-a ✓ · user-b 는 둘 다 |
| 기밀성 · 응답 시트 → #sales-customer-intake | user-f | 16 (채널 공개 여부 없음) | 룰 D user-f ✓ · user-e 둘 다 |
| 무결성 · Copilot 실행 → customer-api | **user-b** | 0 | 룰 A user-b ✓ — **기존 범용 차집합은 A 를 못 찾았다** |
| 무결성 · 스크립트 → #sales-customer-intake | 0 | 누구나 1 (폼 응답자) | 새로 나온 경로 |
| 기밀성 · A 메시지 → customer-api | 0 | 1 (결과물 내용 미확인) | 새로 나온 경로 |

섀도 대조: Finding 4/4 확정 · 기존 다리 3/3 · EA 줄 같음 4 · 엔진이 더 단단함 2 (D 사본 노출 — 전송 관측이 있어 엔진은 성립, EA 는 웹훅 관계가 없어 판정 보류).

합성 데이터에 보탠 것 (실측 v2 정규화가 이미 만드는 자리): A 메시지 `references.author`, GitHub 사용자 정의 역할 `base_role: write`, Okta 헬프데스크 역할 `permissions`.

### 실측 모양 (`npm run engine:verify -- --fixture`, 정규화 테스트 원본)

묶음 5개, 전부 추정 — Slack 이메일 링크(`possibly_same`)라 「다른 사람」을 단정하지 못한다. 기존 판정도 같은 이유로 추정이다.
섀도 대조 통과(Finding 3/3 · 다리 3/3 · EA 같음 4 · 엔진이 더 단단함 2 · 엔진이 더 약함 1).
더 단단함 2 는 C 봇 경유 줄 — EA 는 호출 게이트를 몰라 판정 보류지만, 엔진은 그 사람의 성공한 호출(SL-12)과 효과가 관측돼 성립으로 본다. 더 약함 1 은 UB 의 헬프데스크 권한 — 원본의 역할 cr1 에 권한 목록이 없고 리소스 세트가 걸려 있다.
GH-04(팀) 호출이 원본에 없어 저장소 권한 목록이 열린다 — 엔진은 그걸 「모름」으로 올린다.

회수 지점: C 는 「Helpdesk Action 의 역할 cr1 회수 → 격차 7명 닫힘」, B 는 「PAT 권한 회수 → 격차 6명 닫힘, 봇 쓰던 1명(주인)도 잃음」, D 는 「F 를 채널에서 뺀다 → 1명 닫힘」.

예시 overrides(`/mfa-reset` 채널 게이트 확인 · cr1 능력 · 리소스 세트 확인)를 넣으면 C 추정 격차 7 → 1(a, 신원 연결만 약함), b 는 둘 다, EA 대조 같음 5 · 더 단단함 2 (모순 0).

수집 호출 하나를 partial 로 만든 가짜 `collected/` 로 `normalize -- --raw <원본> --run <완료된-run> --out <데이터셋>` → `engine:verify --dataset` 까지 돌려, `coverage.json` 이 쓰이고 그 묶음이 열리는 것(`grants|slack|conversation — SL-04:partial`)을 확인했다.

규모: 사용자 1,500명(공개 채널·워크스페이스 전원)을 더한 원본에서 엔진 150ms.

## 6. 섀도 대조 (`parity.ts`)

| 대조 | 통과 조건 | 어긋남 |
| --- | --- | --- |
| EA 줄 | 같은 질문(can · acts)의 3값이 모순 없음 | `conflict`: 있다 ↔ 없다 (막음) · `engine_stronger` / `engine_weaker` (보고) |

Finding 위반 대상 대조와 기존 권한 차집합 다리(`detectAccessGaps`) 대조는 옛 판정과 다리 단위 격차를 지우며 없앴다(2026-11-17).

- EA 줄의 질문 세기(`parity.ts` eaParity): `runs_as_inherits` acts(read). `x_member_grant` 는 시나리오 질문이면 그 문구의 세기(D 는 read, A·C 는 write)이고, 규칙 파일 행(일반 규칙)은 「그 소속으로 그 역할을 가지는가」라 부여 관계의 역할 세기로 묻는다(엔진이 그 간선에 다는 세기, 모르면 read). 2026-11-03 전에는 규칙 파일 행도 write 로 물어, 읽기 세기 역할(Okta 앱 배정 `assigned`)의 그룹 부여가 `conflict` 로 보였다.

- **합성** `validate:data` Stage 8: 대조 통과 + A~D 위반 대상이 전부 확정 격차 + 결정적. 어긋나면 빌드가 실패한다.
- **실측** `normalize -- --raw <원본> --run <완료된-run> --out <데이터셋>`: 계산해서 요약만 찍는다(막지 않는다). `coverage.json` 을 같이 쓴다.

## 7. 실데이터 검증 절차

실측 원본(`collected/`)과 `scripts/collect/collector.config.json` 이 있는 PC 에서 한다. 결과물에는 실명·이메일이 있으니 **커밋하지 않는다**(`engine-reports/` 는 git 제외).

### 7-1. 돌리기

```bash
npm run collect                      # 필요하면 수집부터
npm run normalize -- --raw collected --run <완료된-run> --out datasets/<dataset-id>
npm run engine:verify -- --dataset datasets/<dataset-id> --out engine-reports/verify
```

`engine-reports/verify/` 에 셋이 생긴다: `access_engine_report.md`(사람이 읽는다) · `access_engine.json`(간선 수, 수집 완결성, 경고) · `access_engine_parity.json`(EA 대조).
`coverage.json` 이 없다는 경고가 나오면 `normalize -- --raw <원본> --run <완료된-run> --out <데이터셋>` 를 이 판으로 다시 돌린다.

### 7-2. 보고서에서 볼 것 (순서대로)

1. **§1 요약 — EA 대조가 「통과」인가.** 아니면 §2 표에서 `conflict` 줄을 먼저 본다. 이것은 엔진이나 간선 표의 버그다 — 7-4 로 보고한다.
2. **§1 열린 수집 묶음.** 목록에 있는 호출이 정말 실패·생략됐는지 수집 실행 기록과 맞춘다. 켤 수 있는 호출이면 다시 수집한다.
3. **§2 EA 줄.** `engine_stronger`(엔진이 판정 보류를 풀었다)는 근거 경로의 관측이 실제 있는지 확인한다. `engine_weaker` 는 사유 칸에 적힌 것을 7-3 으로 푼다.
4. 위협과 Access Gap 은 이 보고서가 아니라 위협 판정(`npm run gt:threat`, 성능 점수판 `npm run gt:board`)으로 본다.

### 7-3. 추정을 푸는 법 — 확인해서 overrides 에 적는다

| 사유 | 할 일 | 적는 곳 |
| --- | --- | --- |
| `invoker_gate_not_stored` | 시험 계정을 요청 채널에서 빼고 슬래시 명령을 부른다. 막히면 `channel_membership`, 다른 채널에서도 되면 `none` | `entry_point_gates` |
| `role_rank_unknown` | 역할 권한 목록 확인 (Okta `iam_role.permissions` 수집, GitHub 사용자 정의 역할 `base_role`) | `role_capabilities` |
| `resource_set_not_expanded` | Okta 리소스 세트 `resources` 에 대상이 들어 있는지 | `confirmed_resource_sets` |
| `channel_visibility_unknown` | `conversations.info` `is_private` 수집 | 수집 (overrides 아님) |
| `identity_weak` | IdP(Okta) 기준 강한 링크 — SAML NameID · 앱 배정 userName | 정규화 링크 규칙 |
| `automation_behavior_unknown` | 자동화 코드·실행 기록으로 실제로 그 권한을 쓰는지 | 판단을 보고서에 메모 |
| `not_collected:*` · `coverage:*` | 해당 호출을 켜고 다시 수집 | 수집 |

```bash
cp docs/spec/access_engine_overrides.example.json datasets/<dataset-id>/access_engine_overrides.json   # 고쳐서 쓴다
npm run engine:verify -- --dataset datasets/<dataset-id> --out engine-reports/verify-ov
```

`normalize -- --raw <원본> --run <완료된-run> --out <데이터셋>` 도 같은 폴더의 overrides 를 읽는다. 데이터셋 폴더는 git 제외라 overrides 도 커밋되지 않는다 — 확인한 사실은 이 문서 §8 이나 팀 문서에 옮겨 적는다.

### 7-4. 한 쌍만 따져 보기

```bash
npm run engine:verify -- --dataset datasets/<dataset-id> --ask can   --who <계정 키> --cap write --on <객체 키>
npm run engine:verify -- --dataset datasets/<dataset-id> --ask acts  --who <자동화 키> --cap read --on <객체 키>
npm run engine:verify -- --dataset datasets/<dataset-id> --ask derived --who <계정 키> --cap write --on <객체 키>   # 위협 판정의 파생 접근
```

can, acts 는 답(yes · unknown · no), 근거 경로 간선, 못 닿았을 때 열린 목록을 찍는다. derived 는 확정, 미확정, 없음과 파생 접근 길을 찍는다. 옛 `know`, `cause`, `--gap`, `--no-cuts` 는 지웠다(2026-11-17).

### 7-5. 보고할 것

- 보고서 §1·§2 (요약, EA 대조 결과) — 실명은 지우고
- 어긋남마다: EA 행 규칙, 주체와 대상 id, 근거 경로 간선 id, 원본에서 확인한 사실
- 끊어 보기 결과(무엇을, 언제, 어떤 시험 계정으로, 막혔나)

## 8. 한계 · 정할 것

1. **슬래시 명령 호출자 = 테넌트 전원(불확실)** 이 추정 격차의 대부분이다. 게이트를 끊어 보기로 확인하기 전에는 줄지 않는다. 화면에 올릴 때는 확정·관측 격차와 따로 보여야 한다.
2. 구조상 무결성 묶음(예: 봇이 #helpdesk 에 올릴 수 있다)은 실제 동작 여부를 모른다(`automation_behavior_unknown`). 같은 SaaS 안 연동도 범용이라 나온다 — 거를지 정해야 한다.
3. 회수 지점은 하나씩만 끊는다. 모든 경로를 끊는 최소 집합(hitting set)은 다음 판.
4. Okta 리소스 세트·그룹 한정 관리자 역할의 범위를 객체로 펴지 않는다 — 불확실로 둔다.
5. Slack 게스트(`is_restricted`)를 공개 채널 열람자에서 빼지 않는다 — 속성을 수집하면 더한다.
6. GitHub 조직 기본 권한(base permission)은 수집하지 않아 조직 멤버의 저장소 읽기를 모른다.
7. 폼 응답자를 `@everyone`(불확실)로 둔다 — 도메인 한정 설정을 수집하면 테넌트로 좁힌다.
8. EA 파일 형식으로 내보내지 않는다(대조만). 컷오버 때 witness → EA 줄 변환과 lint 를 맞춘다.

## 9. 컷오버 순서

| 단계 | 내용 | 조건 |
| --- | --- | --- |
| 1 (이 판) | 섀도 계산 · 대조 · 검증 스크립트 · coverage · overrides | — |
| 2 | Access Gaps 화면에 엔진 결과를 나란히 (확정·관측 / 추정 나눔, 회수 지점) | 실측 대조에 `missing`·`conflict` 없음 |
| 3 | `accessGap.ts`·`audience.ts` 집합 계산을 엔진으로 바꾼다. 룰 C·D 의 집합 계산도 | 2 에서 화면 확인 |
| 4 | EA 파일을 엔진 witness 로 만든다 (규칙 이름 = 경로 모양) | EA lint 통과 |
| 5 | 룰 A~D 는 「어느 격차를 Finding 으로 보일지」 고르는 필터만 남긴다 | — |
