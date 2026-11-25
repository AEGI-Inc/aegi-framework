# ontology — 개념 사전

명세 문서와 대시보드 코드에 따로 있던 개념 표를 **기계가 읽는 한 곳**에 모은다. 무엇이 있고(타입), 어떻게 이어지며(관계), 이으면 무엇이 되는지(간선 · 능력 · 판정)를 정한 표다.

명세는 "왜 이렇게 정했나"를 설명하고, 사전은 값을 쥐고, 검사는 둘이 같은지 본다. 이 문서의 0단계 결과는 과거 이력이다. 이후 관계 의미, 연결 규칙과 역할 표가 추가되었으며 초안과 미결 상태는 각 블록의 표시를 따른다.

## 파일

| 파일 | 무엇 | 어디서 옮겼나 |
| --- | --- | --- |
| `interfaces.yaml` | interface 9종, 계약 필드와 값 | 명세 `Interface_Spec_v3` |
| `relation_types.yaml` | 관계 17종(template · 근거), 표현 등급 | 명세 `Relation_Schema_v3` |
| | 관계 → 간선 (`engine_probe`). **규칙이 아니라 엔진에 시험 입력을 넣어 본 결과다** — 아래 | 대시보드 `edges.ts` |
| `access_patterns.yaml` | **권한이 생기는 방식 13개** (초안) — 관계를 조합해 권한 · 대행 · 흐름이 생기는 규칙과, SaaS 마다 채우는 빈칸. 아래 「권한 방식」 | **이 파일이 정본** (3단계 초안) |
| `relation_semantics.yaml` | 관계 17종의 의미 — 양방향 이름 · 한 문장 · 역관계 · 성질 · 경로 역할 · **효과(무엇을 만드는가)**. 아래 「관계의 의미」. 객체 참조(tenant · parent 등)와 사전 표 규칙의 뜻도 여기 있다 — 아래 「객체 참조의 뜻」 · 「사전 표 · 속성 규칙의 뜻」 |
| `access_rules.yaml` | **접근 규칙 묶음** (초안) — 관계를 둘 이상 이어 "A 가 X 에 닿는다"를 내는 Effective Access 합성 규칙 6개. 형식은 명세 `Path_Rule_Schema_v1`, 검사는 `validation/check_path_rules.py`. 엔진은 사본을 접근 규칙 실행기 `scripts/accessRules/executor.ts`로 읽어 운영 EA를 계산한다(`scripts/accessRules/production.ts`, 규칙 6개 모두). `differs` 칸은 옛 손코드와의 차이 기록 | **이 파일이 정본** (초안). 엔진 손코드에서 옮겼다 |
| `cut_actions.yaml` | **조치 동사 16개** (4층 초안, 13개는 `adopted`, 3개는 `open`) — 회수 지점을 끊는 사람의 일. 공통 양식(끊는 사실, 회수 지점, 되돌리기, 같이 끊기는 것)과 SaaS 빈칸(API, 화면, 필요 권한, 벤더 문서). 형식은 명세 `Cut_Action_Schema_v1`, 검사는 `validation/check_cut_actions.py`. 엔진은 사본에서 생성한 `CUT_ACTIONS`, `CUT_PHRASES`(`src/ontology/generated.ts`)를 `src/detection/cutActions.ts`로 읽어 조치 문장을 만든다 | **이 파일이 정본** (초안). 엔진의 조치 문구 네 곳과 벤더 문서에서 모았다 |
| `match.py` | 조건식 문법 · 평가기. `relation_semantics.yaml` 의 `match` · `select` 같은 칸을 기계가 읽는다 — 아래 「조건식」 | **이 파일이 정본** (2단계). 효과는 `engine_probe` 에서 옮겼다 |
| `crosswalk.yaml` | **SaaS 를 넘는 연결 규칙** — 키 종류 12개(비밀 값 지문 · 테넌트 가리킴 · 요청 주소가 가리키는 배포 · M1–M4 등, SaaS 이름 없이 interface 로만)와 칸 표시 68줄(어느 SaaS 의 어느 칸이 어느 키 종류인가) — 아래 「SaaS 를 넘는 연결 규칙」 | 명세 `Link_Schema_v3`, `Relation_Schema_v3`. 옛 대시보드 `normalize-v2/cross.ts`, `identity.ts`(지금 없음)에서 옮겼다. 엔진 `scripts/collect/shared/crosswalk.ts`가 이 파일을 바로 읽는다 |
| `join.py` | 키 종류 + 칸 표시대로 실제로 잇는다 — 관계 · Link 와 「못 이은 이유」 | **이 파일이 정본** |
| `effects.yaml` | 간선 7종, 그중 원래 권한 3종 | 대시보드 |
| `capabilities.yaml` | 능력 순위(read 1 · write 3 · admin 5), 역할 → 능력. 끝에 **의미 층 능력 목록**(능력 10종 · 묶음 · 세기 → 묶음, 2026-11-11) | 대시보드 |
| `semantic_mapping.yaml` | **관계 의미 층** — 기록 층(관계 17종) → 의미 층(사실 9종). 사실 정의 · 근거 · 칸(지면 시험의 일반 개념 8가지) · 거름 · 레코드 규칙 · **배정 자리 선언 표** · 별칭 표(생성 부분). 명세 `Relation_Semantic_Layer_v1`, 검사 `validation/check_semantic_layer.py`. 별칭 표는 `tools/gen_semantic_aliases.py` 가 `relation_semantics.yaml` 에서 만든다 | **이 파일이 정본** (손 줄). 별칭 표는 생성 |
| `providers.yaml` | 벤더마다 다른 동작 — 테넌트 상속, 채널 멤버 능력, 진입점, 공개 여부, 수집 호출 → 사실 묶음 | 대시보드 |
| `uncertainty.yaml` | 「모름」 15행과 원본 enum 셋 | 명세 `Relation_Schema_v3` · `Object_Schema_v4.1` · `Profile_Schema_v4.2` |
| | 엔진의 불확실, 열림 사유 (`engine_reasons`). EA 못 푼 구간 사유 넷은 엔진 `effectiveAccess/types.ts`에서 | 대시보드, adapter-engine |
| `activities.yaml` | 관측 9종, 증거 관계 7종 | 대시보드 |
| `activity_types.yaml` | **사건 사전** (초안) — 원본 사건 종류(`provider|event_type`) 449줄마다 행위, 효과(관계 17종 이름과 자리), 그리고 수집 호출마다 원본 칸 위치. 형식은 명세 `Activity_Schema_v1`, 검사는 `validation/check_activity_types.py`. 엔진은 생성 코드로 읽어 사건 기록(Activity)과 Okta 감사 관측을 만든다 | **이 파일이 정본** (초안). 11-04 운영 로그 418종 분류를 씨앗으로 옮겼다 |
| `threat_types.yaml` | **위협 유형 넷**. 비인가 접근, 권한 상승, 데이터 반출, 추적성 상실의 뜻, 기준선, 방향, 가르는 기준과 대표 유형 순서, 조직 밖 표시. 엔진은 사본에서 생성한 `THREAT_TYPES`, `THREAT_TYPE_ORDER`로 읽는다 | **이 파일이 정본** (aegi-knowledge#346, 2026-11-19). 그 전에는 엔진 `contract.ts`와 위협 판정 명세 5절 「유형 표」 |
| `policies.yaml` | 위협 제목 규칙과 제목 검사. 위협 판정은 엔진 [위협 판정 명세 V2](../../../specs/AEGI_THREAT_JUDGMENT_V2.md)를 따른다 | 대시보드, adapter-engine 위협 제목 |
| `judgments.yaml` | EA level 넷 | 명세 `Effective_Access_Schema_v1` |
| | 답 · 사람 구분 · 호출 방식 · 권한 출처 | 대시보드 |
| `identity.yaml` | Link level 다섯(전이 여부 포함) | 명세 `Link_Schema_v3` |
| | level → 강함 · 약함 (`engine_level_grades`) | 대시보드 |
| `vocabulary.yaml` | 이름 바꾸기 검사가 바꾸는 필드, 안 바꾸는 구조 칸 | 대시보드 |

파일마다 맨 위 `sources` 에 **블록별 출처**가 있다. 대시보드에서 옮긴 블록은 커밋(`@ 0ee565f`)까지 적었다.

## 누가 읽나

- `validation/lib.py` — interface 9종, 계약, 관계 17종, 등급, 「모름」 표, 원본 enum. 전에는 문서 표를 직접 파싱했다
- `validation/check_semantics.py` — `relation_semantics.yaml` 을 검사한다(S1–S4 · S6–S8, 아래 「관계의 의미」 · 「객체 참조의 뜻」 · 「사전 표 · 속성 규칙의 뜻」 · 「조건식」). `crosswalk.yaml` 도 여기서 본다(S9)
- `collect/slack/relate.py` — template 표. **전에는 손으로 옮겨 적은 표였다**(옛 표와 사전에서 편 표가 17종 전부 같은 것을 확인하고 바꿨다)
- 대시보드 — **사전에서 생성한 코드**로 읽는다(1단계, aegi-dashboard#96. 팀 결정 #1, 2026-10-03 — 사전은 aegi-knowledge 에 두고, 대시보드는 런타임 로드가 아니라 코드 생성). 대시보드 저장소에 사본 `ontology/` 와 생성 파일 `src/ontology/generated.ts` 가 있고, 가져온 커밋은 사본의 `source.json` 에 남는다. 표 타입은 대시보드 원래 선언을 따르고 근거 주석도 대시보드 원래 파일에 남아 있다

```python
import ontology                      # 저장소 루트가 sys.path 에 있어야 한다
ontology.interfaces()                # ['Tenant', 'Principal', ...]
ontology.template_pairs()['owned_by']
ontology.load('capabilities')['rank']
```

## 고치는 법

- **명세에서 옮긴 블록**은 사전 파일과 문서 표를 같이 고친다. 하나만 고치면 `validation/check_ontology.py` 가 실패한다(CI 가 돈다). 문서 머리글이나 열 이름이 바뀌어 표를 못 읽어도 실패한다
- **대시보드에서 옮긴 블록**도 1단계(aegi-dashboard#96)부터는 사전이 정본이다. 여기서 고치고, aegi-adapter-engine 의 `scripts/ontology/generate.ts` 로 가져와 사본과 생성 파일을 같이 커밋한다. 대시보드는 생성 파일이 사본과 다르면 빌드가 멈춘다. 단 `engine_probe` 는 엔진에 넣어 본 결과라 사전에서 고치는 것이 아니다 — 엔진이 바뀌면 덤프를 다시 떠서 대조한다
- 새 블록을 넣으면 `sources` 에 출처를 적는다. 없으면 `check_ontology.py` 가 실패한다

```bash
python validation/run_all.py                                    # 명세 쪽 대조가 여기 들어 있다
npm run build                                                   # 온톨로지 사전 컴파일 (index.ts 최신화)
npm run test                                                    # 온톨로지 무결성 검증
```

온톨로지 개념 사전의 정본은 이 디렉터리다. 현재 Adapter Engine은 사전을 자체 `ontology/`에 복사하고 출처 커밋을 기록한 뒤 `src/ontology/generated.ts`를 만든다. Knowledge의 `index.ts` 빌드만으로 모든 구현 저장소가 자동 동기화되지는 않는다. 현재 전달 절차는 저장소 관리에 있다. 아래 단계별 명령과 결과는 해당 시점의 기록이며, Python 검사의 원자료 제약은 자료 지도를 확인한다.



## 관계의 의미 (`relation_semantics.yaml`, 2단계)

`relation_types.yaml` 은 관계가 **무엇을 잇는가**(template)를 쥐고, `relation_semantics.yaml` 은 **무엇을 만드는가**를 쥔다. 전에는 후자가 대시보드 `edges.ts` 의 switch 문 안에만 있어서, 명세 등급과 엔진이 다른 말을 해도 아무 검사도 못 잡았다(`reports/Relation_Diagnosis_v1.md`). 엔진이 이 표(effects, conditions)로 간선을 만들면 위협 판정의 손코드 간선과 어디가 다른지는 `reports/Relation_Effects_Diagnosis_v1.md` 에 있다(엔진 그림자 `npm run relation:effects-compare`).

| 칸 | 뜻 |
| --- | --- |
| `names` | 양방향 이름. `forward` = 출발에서 도착을, `reverse` = 도착에서 출발을 부르는 이름 |
| `description` | 한 문장 |
| `inverse` | 반대 방향 관계 이름. 저장은 한 방향만 한다 |
| `characteristics` | `irreflexive` · `asymmetric` · `functional`. 실데이터에 행이 있고 예외가 0 인 것만 적었다 |
| `role_in_graph` | `path`(경로에 쓰인다) · `ingredient`(다른 관계를 거른다 · 합쳐진다) · `info`(정보로만 둔다) |
| `effects` · `conditions` · `filters` | template 칸에서 만드는 간선(종류 · 방향 · rank)과 조건이 붙을 때의 갈래 |

**값은 아직 안 바꿨다.** 효과는 `engine_probe` 를 그대로 옮겼고, 시험 입력 때문에 생긴 값 둘만 규칙으로 적었다 — `has_role_on` 의 rank(시험에 역할이 없었다 → `rank: role`), `member_of` · `shared_with` 의 기본 rank 1(시험 provider 가 `probe` 였다 → `rank: membership`).

| 검사 (`validation/check_semantics.py`) | 보는 것 |
| --- | --- |
| S1 | 17종 전부 선언이 있고 칸이 다 찼나. 효과가 없으면 `effects: []` 로 적어야 한다. 효과는 template 칸 안에서만 |
| S2 | `effects` 에서 계산한 표현 등급(`grade_of_kind`) == 명세 「등급」 표. **지금 5종이 다르다 — 기준선에 있다** |
| S3 | 선언한 효과 == `engine_probe` (간선 종류 · 방향 · 조건 갈래. rank 는 안 본다). 대시보드 엔진 ==D1== `engine_probe` ==S3== 선언 |
| S4 | `characteristics` 를 Slack 회귀 기준선 행에 건다. `AEGI_MEASURED=<대시보드 실측 번들 json>` 을 주면 그 실측 행에도 건다(git 밖 데이터라 CI 에서는 건너뜀) |
| S6 | 객체 참조의 뜻 블록 모양, Slack 기준선 참조 칸이 저마다 어디서 뜻을 받나. `AEGI_ENGINE=<aegi-adapter-engine 클론>` 을 주면 엔진이 읽는 참조 칸과 같은가 |
| S7 | 사전 표, 속성 규칙 블록 모양, 표와 권한 방식이 실재하나. `AEGI_ENGINE` 을 주면 엔진의 간선 함수, 표 순회가 빠짐없이 `rules` 나 `rules_outside` 에 있나 |
| S8 | 기계가 읽는 조건식(아래 「조건식」)의 모양 · 좁은 갈래가 넓은 갈래 뒤에 숨지 않았나 · 조건 갈래마다 Slack 기준선(그리고 `AEGI_MEASURED` 실측)에서 몇 행에 걸리나 |
| S9 | SaaS 를 넘는 연결 규칙(`crosswalk.yaml`, 아래)의 칸, 만드는 관계에 그 칸의 효과가 있나, Relation_Schema_v3 경계(Principal 출발은 Link, 교차 관계는 stated 만), 식 모양, 칸 표시 모양과 키 종류마다 양쪽 칸이 다 있나. `AEGI_ENGINE` 을 주면 엔진 사본이 정본과 같은가와 엔진이 명세와 일부러 다르게 읽는 곳(덮어쓰기)이 명세의 칸, 키 종류, 결정을 가리키나, `AEGI_MEASURED` 를 주면 명세(키 종류 + 칸 표시, `join.py`)로 다시 만든 연결이 대시보드가 이은 것과 같은가, 못 이은 이유, 단계 차이 |

S2 의 5종은 이 파일이 만든 문제가 아니라 숨어 있던 것이 드러난 것이다. 결정마다 PR 하나씩(3단계) 풀고 기준선에서 지운다. `grade_of_kind`(간선 종류 → 등급)는 `effects.yaml` 의 원래 권한 / 연동 구분을 따른 **제안**이다.

## 객체 참조의 뜻 (`relation_semantics.yaml` 의 `references`, 2026-10-16)

데이터에서 「연결」이 적히는 곳은 두 군데다. **관계 행**(relations 목록의 한 줄)과 **객체 참조**(객체 안 `references.tenant` · `references.parent` 같은 칸). 관계 17종의 효과는 앞의 것만 정했고, 뒤의 것은 뜻이 없었다. 그런데 대시보드 엔진은 뒤의 것도 읽어 간선을 만든다. 예: Okta 사용자 sales.sumin 은 「org 안에 있다」는 관계 행이 없고 객체 안에 `references.tenant = org` 만 있다. 엔진은 이 칸으로 「sumin 은 org 소속」 간선을 만들고, 그래야 org 에 걸린 관리자 권한이 sumin 에 닿는다.

그 뜻을 `references` 블록에 적었다 — **Object 행은 바꾸지 않고 읽는 법만 정한다.** `tenant` · `parent` · `parent_file` 은 `contained_in` 한 줄이 있는 것처럼 읽고(`as: contained_in`), `owner` · `author` · `grantee`(배정 객체) 는 효과를 직접 적었다. 값은 엔진(`edges.ts @ 1b5481c`)과 같고, `contained_in` 으로 읽어서 엔진과 갈리는 칸은 `differs` 에 적었다.

g2 실측(2026-10-02 판)에서 계산에 쓴 간선 565개 중 302개가 이 칸에서 나온다. 이 블록만으로 계산해도 정답 위협 C(Slack `/mfa-reset` → Okta 사용자)를 찾고, 블록을 빼면 놓친다.

## 사전 표 · 속성 규칙의 뜻 (`relation_semantics.yaml` 의 `rules`, 2026-10-16)

관계 행도 객체 참조도 아닌데 간선을 만드는 규칙이 여섯 개 있다. `providers.yaml` 의 표는 「어느 SaaS 의 어느 객체인지」만 쥐고, 그 표가 무슨 간선을 만드는지는 엔진 코드에만 있었다. 예: `entry_points` 표는 「Slack 슬래시 명령」만 적고, 「워크스페이스 멤버 누구나 부를 수 있다(T, 게이트 모름)」는 뜻은 코드에 있었다.

| 규칙 | 보고 거는 것 | 만드는 간선 | 권한 방식 |
| --- | --- | --- | --- |
| `visibility_scoped` | 표 — Slack 대화의 `is_private` | 테넌트 → 대화 읽기(1). 값이 없으면 판단 불가 | 범위 공개 |
| `open_respondent_resources` | 표 — Google 설문 | 누구나 → 설문 쓰기(3), 판단 불가 | 범위 공개 |
| `entry_points` | 표 — Slack 슬래시 명령 | 테넌트 → 입구 시작시킴(T), 판단 불가 | 시작 권한 |
| `deployments` | 속성 — Apps Script 배포 접근 | ANYONE 누구나 / DOMAIN 테넌트 / MYSELF 주인 → 시작시킴 | 시작 권한 |
| `outbound_hooks` | 속성 — 밖으로 보내는 웹훅 | 범위 → 웹훅 데이터 흐름(F) | 데이터 흐름 |
| `automation_links` | Link — 같은 자동화 | 두 신원 사이 대행(A) 양방향 | 대행 |

g2 에서 이 규칙이 만드는 간선은 15개다. 이제 계산에 쓰는 간선은 전부 `relation_semantics.yaml` 의 세 블록(관계 · 참조 · 규칙)에서 나온다. 엔진의 관측 규칙(실행 · 전송 기록으로 만드는 간선)은 일부러 옮기지 않았다(`rules_outside`).

**엔진은 슬래시 명령의 채널 제한(gate)을 알 수 있는 길이 셋 있다** — 사람이 확인한 값(`overrides.entry_point_gates`), 코드(정규화가 입구를 받는 Worker 배포 코드의 채널 거름을 읽어 입구의 `properties.invoker_gate` 에 적은 값, 2026-11-09), 관측(다른 채널 요청이 거부된 기록). 셋 다 이 명세의 select 밖이라, 명세만으로는 「테넌트 전원 + 판단 불가」다. g2 의 `/mfa-reset` 은 거부 기록이 없어서 엔진도 워크스페이스 전원으로 뒀다 — 정답 위협 C 에서 4명을 더 잡는 것이 이것이고, 대시보드 정답 대조 문서의 「넓게 봄 1건」과 같다. Worker 코드가 수집되면 코드 길로 #helpdesk 멤버만 부른다(`access_patterns.yaml` gate 방식에 적었다).

## 조건식 (`ontology/match.py`, 2026-10-16)

조건 갈래의 `when`(「provider slack, 도착이 conversation」), 규칙의 `applies`(「표의 provider · objectType 객체 전부」) 같은 문장은 사람만 읽을 수 있었다. 계산하려면 누군가 문장을 읽고 코드로 옮겨야 했고, 문장과 코드가 어긋나도 아무 검사도 못 잡았다. 그래서 같은 뜻을 정해진 모양의 식으로 옆에 적었다 — 문장은 사람용으로 남긴다.

```yaml
- name: member_of.slack_conversation
  when: provider slack, 도착이 conversation                       # 사람이 읽는다
  match: {all: [{relation: {provider: slack}}, {target: {object_type: conversation}}]}   # 기계가 읽는다
```

| 어디 | 기계가 읽는 칸 |
| --- | --- |
| 관계의 조건 갈래 18개 | `match` |
| 객체 참조 | `grantee.skip_if` |
| 사전 표 · 속성 규칙 6개 | `select`(걸 객체) · `items`(돌 목록) · `cases[].match` · `ends`(간선 끝 찾기) · `uncertain_if` |
| 간선 끝 찾기 | `resolvers` — `tenant_of` · `tenants_of` · `owner` · `scope` |
| SaaS 를 넘는 연결 (`crosswalk.yaml`) | `skip_if` · 키 종류의 `where` · `makes.link[].when`. 자리는 양쪽 객체 `a` · `b` 와 `places`(끝 찾기로 구한 자리 — 여럿이면 그중 하나라도) |

문법과 평가기는 `ontology/match.py` 하나다. 자리(source · target · relation · role …)마다 검사(provider · object_type · interface · property · in_table …)를 거는 모양이고, `all` · `any` · `not` · `exists_relation` 으로 묶는다. 조건 갈래는 위에서부터 먼저 맞는 하나를 쓰므로 더 좁은 갈래를 위에 둔다(S8 이 본다). `exists_relation` 의 `target_interface` 는 그 관계 도착의 interface 를 본다(2026-10-21, 결정 반영 2호 초안이 「조직 소유인 토큰」을 「앱 소유인 토큰」과 가르려고 더했다).

S8 이 조건 갈래마다 데이터에서 몇 행에 걸리는지 센다. **Slack 기준선에서는 18개가 하나도 안 걸린다** — Slack 조건 5개는 데이터가 있는데도 0 이다. 기준선의 Slack Profile 은 채널을 `channel` 로 부르고 조건은 `conversation` 을 찾기 때문이다. g2 실측에서는 18개 중 10개가 걸린다.

## SaaS 를 넘는 연결 규칙 (`crosswalk.yaml`, 2026-10-18)

SaaS 를 넘는 연결은 옛 대시보드 코드 `normalize-v2/cross.ts`, `identity.ts`(지금 없음. 엔진 `scripts/collect/shared/crosswalk.ts`가 이 파일을 읽는다)에 **SaaS 짝마다** 따로 있었다 — 「gws Apps Script ↔ slack 웹훅」, 「okta 앱 githubOrg ↔ github 조직」처럼. 짝으로 쓰면 SaaS 가 N개일 때 규칙이 N×N 으로 늘고, 명세에는 원칙(Link_Schema_v3 M1–M5, Relation_Schema_v3 「교차 provider 관계는 stated 만」)만 있었다. Link_Schema_v3 는 이 파일 이름을 정해 두고 「두 번째 provider 를 수집한 뒤에 채운다」며 비워 뒀다 — g2 는 SaaS 4개다.

그래서 **키 종류**(`kinds`)마다 한 줄로 적었다. SaaS 이름은 없고 interface 로만 쓴다. 어느 SaaS 의 어느 칸이 어느 종류인지는 **칸 표시**(`fields`)에 따로 적었다 — 새 SaaS 는 칸 표시만 늘리면 되고 키 종류는 그대로다. 둘을 읽어 실제로 잇는 것이 `join.py` 다.

| 키 종류 | a → b | 만드는 것 | 근거 | 대시보드 규칙 |
| --- | --- | --- | --- | --- |
| `secret_fingerprint` | Automation → Credential | 관계 `runs_as` | stated | `cross.ts` runs_as (웹훅 URL 지문) |
| `tenant_pointer` | Integration → Tenant | 관계 `registered_in` | stated | `cross.ts` registered_in (Okta 앱 설정 4칸) |
| `request_target` | Automation → Endpoint | 관계 `triggered_by` | stated | 없음 — 엔진이 이 파일로 바로 잇는다 (2026-10-22, 아래) |
| `vendor_foreign_key` (M1) | Principal ↔ Principal | Link `disclosed_relation` | stated | `okta_appuser_external_id` |
| `federated_subject` (M2) | Principal ↔ Principal | Link `resolved` — IdP 가 대상 테넌트에 붙어 있을 때. 아니면 `possibly_same` | stated | `saml_external_identity` · `okta_app_assignment_username` · `okta_app_assignment_salesforce` |
| `natural_key` (M3) | Principal ↔ Principal | Link `possibly_same`, `valid_from` 을 남긴다. Slack · Salesforce · Atlassian · GitHub | stated | `natural_key_email` (Slack 만) |
| `log_correlation` (M4) | Principal ↔ Principal | Link `possibly_same` (자동화) | observed | `worker_log_correlation` |

관계와 Link 의 경계는 새로 정하지 않았다 — 출발이 Principal 이면 Link, 교차 관계는 stated 만(S9 가 본다). 관계의 효과도 이미 있다(`runs_as` Automation>Credential, `registered_in` Integration>Tenant). 다리만 놓이면 기존 계산이 그대로 이어진다. 여기서 만든 관계 행에는 `cross_provider: true` 를 단다(`relation_marks`) — GitHub 앱 설치 → 조직 같은 SaaS 안 `registered_in` 과 가르려고.

### 칸 표시 (`fields`)

```yaml
- {kind: secret_fingerprint, side: a, provider: gws,   object_type: Project,          path: properties.webhook_url_sha256, pointer: true}
- {kind: secret_fingerprint, side: b, provider: slack, object_type: incoming-webhook, path: properties.webhook_url_sha256}
```

한 줄 = 「이 SaaS 의 이 객체의 이 칸은 이 키 종류의 a(또는 b) 쪽 값이다」. 값이 다른 객체를 위해 있으면 `end`(예: Okta 앱 배정의 `externalId` 는 `references.grantee` 인 Okta 사용자의 값), 상대가 정해져 있으면 `to`(예: Okta 앱의 `githubOrg` 는 GitHub 조직만), 가리키는 칸이면 `pointer`(상대가 없으면 「못 이은 이유」에 남는다). 대시보드 규칙 7개가 읽던 칸에 GWS 별칭 2줄, 요청 주소 2줄, 새 SaaS 이메일 5줄, Salesforce 앱 배정 3줄을 더해 37줄이었다. 지금은 80줄이다: atlassian 8, github 11, gws 21, okta 18, salesforce 8, slack 12, worker 1, 실행 기록 대조 1. gws 12줄은 메일 디렉터리 허브 줄이다(2026-11-13, `hubs` — GWS 주 메일 · 별칭이 a 쪽, 상대는 Okta 줄과 같은 b 칸). 같은 사람 Link 가 시작하는 계정 종류와 순서는 `hubs` 가 정한다(Okta 사용자 다음 GWS 사용자).

**g2 실측(2026-10-02 판)으로 다시 만들어 보면** — 대시보드가 이은 Link 간선 19개 중 **18개를 명세만으로 똑같이** 만든다. 명세에만 있는 연결은 0. 남은 1개는 M4 로, 봇 요청 로그(worker SL-12)가 실측 묶음에 없어 다시 계산하지 못한다. SaaS 를 넘는 관계는 대시보드도 명세도 0행이고, 못 이은 이유가 나온다.

| 키 종류 | 못 이은 이유 |
| --- | --- |
| `secret_fingerprint` | Apps Script 2개의 지문 칸이 비었다 — 주소가 코드가 아니라 스크립트 속성에 있다. 정답 위협 D · H 가 여기서 끊긴다 |
| `tenant_pointer` | Okta 의 Slack 앱 3개가 가리키는 Slack 이 수집한 목록에 없다. `githubEnterprise` · `googleDomain` 칸은 이 판이 나온 다음 날(10-03) 대시보드 정규화에 생겨서 값이 없다 |
| `vendor_foreign_key` | Google 앱 배정 3개는 `externalId` 가 비었고(프로비저닝 꺼짐), 1개는 수집한 GWS 에 없는 계정을 가리킨다 |
| `federated_subject` | GitHub SAML 신원 2개는 그 이름의 Okta 사용자가 없고, Google 앱 배정 1개는 그 username 의 GWS 사용자가 없다 |

두 값을 채우면 이어지는 것도 확인했다(가정 — 메모리에서만): Apps Script 코드 지문 → `runs_as` 2행(D · H 의 다리), Okta GitHub 앱의 `githubEnterprise` → `registered_in` 1행 → 그 덕에 SAML 3건이 `resolved` 로 올라간다.

**M3 에 `valid_from` 이 없다.** 이메일로 이은 7개 전부 비었다 — 대시보드 Slack 정규화가 `date_created` 를 안 남긴다. Link_Schema_v3 「M3 에는 유효창이 필수다」에 어긋난다.

### 오브젝트 모델 v1 에 맞춤 (2026-10-19)

대시보드가 오브젝트 모델 v1 을 고정했다(aegi-dashboard PR #117 · `docs/spec/AEGI_OBJECT_MODEL_V1.md`). 이 파일에 걸리는 것이 둘이다.

| 바뀐 것 | 맞춘 것 |
| --- | --- |
| GitHub ExternalIdentity(SAML nameId 를 가진 객체)가 Object 가 아니라 **Link 재료**다 — 투영에서 빠져 묶음에 없다 | 그 칸 표시에 `link_material: true`. `join.py` 는 묶음 밖 Link 재료(`materials`, 묶음의 `link_material`)에서도 찾고, 둘 다 없으면 「Link 재료 없음」으로 남긴다. S9 는 그 종류의 연결을 실패가 아니라 「다시 계산 못 함」으로 센다 |
| Okta OAuth2Client 가 Principal 에서 Integration 으로 | `log_correlation` 의 a 쪽에 Integration. 그 전 묶음(g2)은 Principal 이라 둘 다 둔다 |

대시보드 투영 코드(`projectModelV1`)로 g2 를 v1 로 옮겨 S9 를 돌렸다(저장소 밖). 재료가 없으면 18개 중 15개가 같고 SAML 3개는 「재료 없음」, 재료를 붙이면 다시 18개 — 실패 0. Link 재료를 v1 묶음에 남길지(`link_material_kept`)는 2026-10-19 대시보드 PR #120 으로 정해졌다 — v1 묶음이 `link_material.json` 으로 따로 남긴다(`decided`).

**대시보드와 다르게 적은 것 하나 — M2 를 `resolved` 로 올리는 근거.** 대시보드는 Okta 앱 이름(ghec · github)으로 대신 본다. 명세는 `tenant_pointer` 가 만든 `registered_in` 이 b 의 테넌트에 있어야 한다(Link_Schema_v3 M2 의 키 「앱 ↔ 대상 테넌트」). 그래서 g2 의 SAML 3건이 명세대로면 `possibly_same` 이다. 그 관계 한 줄을 넣어 보면 `resolved` 로 돌아온다. 팀 결정 `open.federated_proof` 로 남겼다.

팀이 정할 것은 `open` 에 적었다 — 실행 기록만 근거로 한 교차 관계(정답 위협 B), 상대가 없는 벤더 연결, `registered_in` 이름, M2 근거, 그룹 push. 정해진 것은 `decided` 로 옮긴다 — 지금 9개(Link 재료 보존, GWS 별칭 단계, Okta 클라이언트 = 앱, 앱 계정 거르기, 같은 이메일은 같은 사람, 같은 provider 계정 여럿, 사람 메일 주소를 쓰는 서비스 계정, Slack 프로필은 계정 아님, 감사 로그에만 나오는 시스템 행위자).

### GWS 별칭과 `level_cap` (2026-10-19)

대시보드 오브젝트 모델 v2 가 Okta Google 앱 배정의 username 을 GWS 주 이메일뿐 아니라 별칭(`aliases` · `nonEditableAliases`)으로도 맞추자고 했다(이슈 #20, V2-R2). 받았다. 다만 별칭만 맞았을 때는 `possibly_same` 이고, 두 계정의 사람 이름까지 같아야 `resolved` 였다. 2026-11-03 부터는 별칭이 맞아도 `resolved` 다(`decided.alias_level`, `decided.email_same_person`).

- Link 단계는 「같은 사람인가」만 말한다. 별칭으로 Google SSO 로그인이 되는지는 단계와 상관없다.
- 별칭이 주 이메일보다 약한 이유는 주소가 사람 사이를 옮겨 다니는 데 있다. 퇴사자 계정을 지우고 그 주소를 팀장 계정의 별칭으로 붙이는 일이 흔하다. Okta 쪽 퇴사자 배정이 남아 있으면 그 별칭과 맞아 「퇴사자 = 팀장」이 되고, `resolved` 면 두 사람이 한 사람으로 합쳐져 권한이 섞인다.
- 반대로 이름을 바꾼 사람의 옛 주소도 Google 이 별칭으로 남긴다. 이때는 진짜 같은 사람이다. 값만으로는 둘을 못 가르고, 사람 이름이 같으면 이름 바꾸기 쪽이다.

칸 표시 두 개로 적었다. `level_cap` — 이 칸으로 맞춘 Link 는 이 단계보다 세지 않다(같은 두 끝을 cap 없는 칸, 곧 주 이메일도 이으면 그 칸이 먼저다). `cap_unless_same` — 연결의 두 끝에서 이 칸까지 같으면 cap 을 풀어 준다. S9 가 만든 세계 하나로 본다 — 주 이메일이면 `resolved`, 별칭이고 이름이 같으면 `resolved`, 이름이 다르면 `possibly_same`. 사람 이름까지 바뀐 경우는 `possibly_same` 으로 남지만 연결은 된다.

### Okta 클라이언트는 Okta 앱에서 읽는다 (2026-10-20)

대시보드 오브젝트 모델 v2 가 main 에 들어왔다(aegi-dashboard PR #127, 결정 V2-D05). Okta OAuth2Client 는 같은 `client_id` 의 Okta 앱을 클라이언트 API 로 본 것이라, 투영이 앱 하나로 합치고 클라이언트를 가리키던 관계 · 참조 · Link 를 앱으로 옮긴다. 그래서 M4(봇 요청 로그) 의 a 쪽 칸 표시를 `OAuth2Client` `identifiers.id` 에서 `Application` `properties.client_id` 로 바꿨다(`decided.okta_client_view`). 이슈 #20 답변에서 v2 가 들어오면 바꾸기로 한 줄이다.

- 두 줄을 같이 두지 않는다. 옛 묶음(g2 등)에는 앱과 OAuth2Client 가 둘 다 있어서, 같은 봇 연결이 두 번 생긴다. 옛 g2 의 Okta 앱 3개도 `properties.client_id` 를 가져 앱 줄만으로 읽힌다.
- 키 종류의 a 쪽 interface 는 `[Integration, Principal]` 그대로다. Principal 은 옛 묶음에서 대시보드가 OAuth2Client(Principal) 끝으로 이은 연결을 읽으려고 남긴다.
- S9 가 만든 세계 하나로 본다 — 봇 로그 한 행의 Okta 클라이언트 id 가 앱의 `client_id` 와 같으면 앱과 Slack 봇을 한 번 잇고, 같은 id 의 OAuth2Client 는 쓰지 않는다. 옛 줄로 되돌리거나 두 줄을 같이 두면 이 시험이 잡는다.
- 실측 g2 는 옛 판 · v1 판(PR #127 투영) 모두 S9 결과가 같다(18개 같음, 봇 로그는 기록이 묶음에 없어 「다시 계산 못 함」 1). 대시보드 쪽 차이 목록(`crosswalkDifferences.ts`)의 V2-D05 줄은 이 변경이 대시보드 사본에 들어갈 때 지운다.

### 요청 주소가 가리키는 배포 — `request_target` (2026-10-22)

ground-truth 연결 방법 `gws-slack slack_request_to_apps_script` 의 config_id 줄을 키 종류로 옮겼다. Slack 앱의 슬래시 명령 요청 주소가 Apps Script 웹앱이면, Slack 이 그 스크립트를 직접 부른다. 웹앱 주소는 `script.google.com/macros/s/<배포 ID>/exec`(Workspace 도메인이면 `/a/macros/<도메인>/s/<배포 ID>/exec`)라, 주소 경로의 `s` 다음 조각이 Apps Script 배포 목록(GW-11)의 `deploymentId` 와 같으면 잇는다.

- 만드는 것은 관계 `triggered_by`(Apps Script 프로젝트 → Slack 요청 주소)다. 출발이 Automation 이고 두 값 모두 벤더 설정이라 교차 관계 조건(stated)에 맞는다. 효과는 이미 있다 — `triggered_by` Automation>Endpoint 의 T(input). 그 명령을 칠 수 있는 사람이 스크립트를 시작시키고, 스크립트는 배포 `executeAs` 신원으로 돈다.
- 칸 표시에 두 문법을 더했다. path `<이름>[].<칸>` 은 객체 목록의 원소마다 그 칸이다(배포 목록의 `deploymentId`). transform `{path_segment_after: 글자}` 는 주소 경로를 `/` 로 나눠 그 글자인 첫 조각의 바로 다음 조각이다. 호스트가 `script.google.com` 인 주소만 본다(칸 표시 `where`).
- 수집한 배포 목록에 없는 배포 ID 는 잇지 않고 「가리킨 상대 없음」으로 남긴다(`target_missing: report`). 다른 Workspace 의 스크립트이거나 GW-11 을 그 프로젝트에 못 돈 경우다.
- Slack 의 이벤트 구독 · 상호작용 요청 주소도 같은 방법이지만 엔진 정규화가 아직 객체로 만들지 않아 칸 표시에 없다.
- 옛 대시보드에 없던 규칙이라 `now_in` 이 없다. 엔진이 이 파일을 바로 읽은 뒤(aegi-adapter-engine PR #27)라 손으로 쓴 규칙이 필요 없다. 그래서 `now_in` 은 이제 적어도 되고 안 적어도 되는 칸이다. 실측 대조(`AEGI_MEASURED`)는 그 뒤 묶음을 읽을 때 관계 행의 `crosswalk_kind` · Link 간선 규칙 이름을 키 종류 이름으로 읽는다.
- S9 가 만든 세계 하나로 본다 — 일반 주소와 Workspace 도메인 주소 둘 다 잇고, 다른 호스트는 안 보고, 배포 목록에 없는 ID 는 「가리킨 상대 없음」으로 남는다. 경로 조각 · 호스트 조건 · 방향 · `[]` 문법 · `target_missing` 을 하나씩 바꾸면 이 시험이나 모양 검사가 잡는다.

### 새 SaaS 의 이메일로 같은 사람 잇기 — `natural_key` (2026-10-22)

ground-truth 연결 방법 `okta-salesforce email_match` · `okta-atlassian email_match` 를 칸 표시로 옮겼다. 키 종류는 그대로 `natural_key`(M3, `possibly_same`)이고 칸 표시만 5줄 늘었다.

| 칸 표시 | 값 | 빼는 계정 | `valid_from` |
| --- | --- | --- | --- |
| Okta `User` login → Salesforce `User` | `identifiers.email`, `identifiers.username` (SF-02, 소문자) | `user_type` 이 AutomatedProcess, CloudIntegrationUser, Guest | `properties.created` (CreatedDate) |
| Okta `User` login → Atlassian `User` | `identifiers.email` (JI-02, Jira 가 보여 준 것만) | `account_type` 이 atlassian 이 아닌 것 (앱 계정 등) | 없음 (생성일을 수집하지 않는다) |

- 봇 칸(`is_bot`)이 없는 SaaS 라서 칸 표시 `where` 로 사람이 아닌 계정을 뺀다. Salesforce 시스템 사용자는 email 이 사람 주소와 같아도 그 사람이 아니고, 무엇을 넣는지는 조직마다 달라 값이 아니라 계정 종류로 막는다. Chatter Free(CsnOnly) 사용자는 사람이라 잇는다.
- 같은 email 의 Salesforce 사람 계정이 둘이면 둘 다 잇는다(같은 키 종류는 여럿, 이슈 #28 4번).
- Jira 사용자 검색(`/rest/api/3/users/search`)은 사용자의 개인정보 설정에 따라 email 을 비워 준다. ground-truth 규칙이 쓰는 조직 관리 API(`/admin/v1/orgs/{orgId}/users`)를 수집하면 다 채워진다. 지금은 보이는 것만 잇는다.
- 실측 묶음(adapter-engine `src/data/aegi_inc_measured_v2`)에 걸어 보면 Link 가 14개에서 19개가 된다 — Salesforce 계정 4개(Okta 사람 3명), Atlassian 1개. 빠진 연결 · 바뀐 관계는 없다. 이어진 Salesforce 계정은 모두 Standard 이고 `valid_from` 이 4개 모두 있다. Atlassian 사람 계정 5개 중 email 이 보이는 것은 1개다.
- 그 Salesforce 4개 중 1개는 사람이 아니라 통합 사용자(서비스 계정)다. 계정 종류가 Standard 이고 email 이 관리자 메일함이라(SC-O 때문에 그렇게 만들었다) 관리자와 「같은 사람일 수도」로 이어진다. 계정 종류로는 못 가른다. 그대로 둘지는 팀 결정으로 남겼고, 2026-11-03 그대로 잇기로 정했다(`decided.service_account_email`).
- S9 가 만든 세계 하나로 본다 — Email 로 잇고, Username 으로도 잇고, 시스템 사용자 · 앱 계정은 같은 email 이어도 안 잇고, Okta → Slack 줄이 Salesforce 를 잇지 않는다(`to`). 조건 · 줄 · `valid_from` 칸 · `to` 를 하나씩 바꾸면 이 시험이 잡는다.

### GitHub 조직 확인 도메인 메일로 같은 사람 잇기 — `natural_key` (2026-10-23)

GitHub 계정은 SAML 외부 신원(`federated_subject`)이 없는 조직에서 Okta 사람과 이어지지 않았다. 조직이 확인한 도메인의 메일(`verified_domain_emails`, GraphQL `organizationVerifiedDomainEmails`)을 `natural_key` 칸 표시 2줄로 더했다.

| 칸 표시 | 값 | 빼는 계정 | `valid_from` |
| --- | --- | --- | --- |
| Okta `User` login → GitHub `User Account` | `properties.verified_domain_emails` (여럿, 대소문자 무시) | `type` 이 User 가 아닌 것 (Bot) | 없음 (GitHub 이 알려 주지 않는다) |

- 실측 g4 묶음에서 GitHub 사람 계정 3개가 Okta 사람과 이어진다. 이 연결이 있어야 이벤트 연결(adapter-engine `docs/spec/AEGI_EVENT_LINKS_V1.md`)이 GitHub 행위를 같은 사람의 흐름에 놓는다.
- S9 가 만든 세계 하나로 본다 — 여러 메일 중 하나만 같아도 잇고, 대소문자를 가리지 않고, 봇은 안 잇고, 조직 확인이 아닌 `email` 칸은 안 본다.

### Okta Salesforce 앱 배정으로 같은 사람 잇기 — `federated_subject` (2026-10-22)

ground-truth 연결 방법 `okta-salesforce saml_sso` 의 via_person 줄(「salesforce User.FederationIdentifier (IdentityMapping = FederationId 일 때) 또는 Username = okta 배정 사용자」)을 칸 표시로 옮겼다. 키 종류는 그대로 `federated_subject`(M2)이고 칸 표시만 3줄 늘었다.

| 칸 표시 | 값 |
| --- | --- |
| a — Okta `AppUser` `properties.userName`, 끝은 `references.grantee`(Okta 사용자) | 부모 앱의 `name` 이 `salesforce`(Okta OIN 키 이름 「Salesforce.com」)인 배정만. 상대는 Salesforce `User` 만(`to`) |
| b — Salesforce `User` `identifiers.federation_id` | `User.FederationIdentifier` (SF-02, 소문자). SAML 주장의 Subject 와 맞춰 로그인시키는 값 |
| b — Salesforce `User` `identifiers.username` | `User.Username` (SF-02, 소문자). SSO 설정이 Username 방식일 때 |

- 어느 b 줄이 맞는지는 그 조직의 SSO 설정(`SamlSsoConfig.IdentityMapping` 이 `FederationId` · `Username` · `UserId`)이 정한다. 칸 표시의 `where` 는 자기 객체와 부모만 보므로 조직 설정으로 못 가린다. 그래서 둘 다 적었다. Okta 배정의 username 은 Okta 관리자가 그 Salesforce 계정을 가리키려고 넣은 값이라, 어느 칸과 맞아도 그 계정을 가리킨다.
- 단계는 `possibly_same` 이다. `resolved` 는 Okta Salesforce 앱 → Salesforce 조직 `registered_in` 이 있어야 하는데(`open.federated_proof`), 그 테넌트 가리킴 칸은 아직 없다. Okta 앱 `settings.app.loginUrl` 이 Salesforce SSO 설정의 Login URL 이라 조직 id 가 들어 있을 수 있다 — 다음 후보다.
- 앱 배정으로 이은 Okta 사용자는 같은 Salesforce 의 email 연결(M3)을 안 쓴다. 키 종류 순서가 `federated_subject` 먼저이고 `link_one_per_provider` 라서다.
- 시스템 사용자를 빼지 않는다. 이메일과 달리 Okta 관리자가 그 계정을 골라 배정한 것이라 우연히 같은 값이 아니다.
- 수집은 aegi-adapter-engine 이 더한다 — SF-02 에 `SELECT Id, FederationIdentifier FROM User`, SF-01 에 `SamlSsoConfig`(Issuer · IdentityMapping 등, View Setup and Configuration 권한). 둘 다 실패해도 나머지 수집은 그대로 돈다.
- S9 가 만든 세계 하나로 본다 — FederationIdentifier 로 잇고, Username 으로도 잇고, Google 앱 배정은 같은 값이어도 Salesforce 를 안 잇고, 이은 사람의 email 연결은 가리고, 상대가 없는 배정은 「못 이은 이유」에 남는다.
- 벤더 문서: Salesforce Object Reference `User.FederationIdentifier`(「the value that must be listed in the Subject element of a SAML … assertion」), `SamlSsoConfig`(IdentityMapping 값 Username · FederationId · UserId, query 지원, View Setup and Configuration). Okta Management API 「Application」(Salesforce 앱 키 이름 `salesforce`, `settings.app` 의 instanceType · integrationType · loginUrl · logoutUrl).

## 오브젝트 모델 v1 과 관계 명세를 맞춰 본 결과 (2026-10-19)

g2 실측(2026-10-02 판)을 옛 모양 그대로 한 번, 대시보드 투영 코드(`projectModelV1`, aegi-dashboard @ f0ef4b8)로 v1 로 옮겨 한 번 — 같은 데이터 두 판에 이 명세를 똑같이 걸었다(저장소 밖).

**맞는 것.** 관계 template 17종 중 16종이 v1 카탈로그(`docs/spec/model-v1/runtime-catalog.json`)와 같다. 관계 성질 20개는 v1 260행에서도 예외 0(S4). SaaS 를 넘는 연결은 위 절대로 18개가 같다(S9). 사람 계정 32개가 닿는 범위는 아래 둘을 고치면 줄어든 곳이 없다.

**명세가 v1 을 못 읽던 곳 둘 — 고쳤다.**

| v1 에서 바뀐 것 | 명세에서 끊긴 곳 | 고친 것 |
| --- | --- | --- |
| 기본 제공 역할(GitHub `admin`, Okta `SUPER_ADMIN` …)도 역할 객체가 됐다 — `has_role_on` 의 역할 자리가 이름이 아니라 NamedRole(Policy) 객체이고 이름은 그 객체의 `properties.role_name` 에만 있다 | `rank: role` 이 「역할 이름으로 찾는다」고만 했고 이름을 어디서 읽는지 없었다. 이름 자리만 읽으면 v1 에서 54행 중 이름을 아는 행이 0 이다 | `capabilities.yaml` `role_name_from` — 이름 자리, 아니면 역할 객체의 `properties.role_name`. 대시보드 엔진(`accessModel.ts` roleCapability)과 같다. S5 가 모양을 보고, 데이터마다 이름 · 세기를 몇 행에서 아는지 센다 — 옛 판(자리 47 + 객체 3)과 v1(객체 50) 모두 이름 50 · 세기 44 |
| `object_type` 만으로 정해지는 판정값(`direction` · `credential_kind` · `rotation` · `grant_target`)을 행의 `judged` 에서 빼 Profile 상수로 옮겼다(Object_Schema_v4.1 「judged{}」 그대로). v1 묶음은 객체마다 `fixture_meta.model_v1.profile_constants` 에 남긴다 | 사전 규칙 `outbound_hooks` 가 행에서만 `direction: out` 을 찾아 GitHub 조직 웹훅의 「내용이 밖으로 나간다」 간선을 놓쳤다 | 조건식 `judged_or_property` 가 properties → judged → Profile 상수 순서로 찾는다(`match.py` 의 객체에 `profile` 칸). S8 이 사전 규칙마다 select 가 맞는 객체 수를 센다 — v1 에서 `outbound_hooks` 0 → 1, 옛 판과 같다. 대시보드 엔진(`edges.ts` buildOutboundHooks)은 아직 행만 읽어 v1 묶음에서 이 간선을 놓친다(`differs`) |

**오브젝트 쪽과 정할 것 — 처리 현황.**

| 무엇 | 지금 |
| --- | --- |
| Slack `bot-token` 이 Credential 에서 Policy(권한 묶음)로 | `owned_by` bot-token → 앱 5행이 template 밖이라 투영에서 빠져 앱과 끊겼다. aegi-dashboard 이슈 #123 — 지금은 `applies_to`(bot-token → 앱, 정보 관계)로 잇자고 했다. 「앱 `has_role_on` 테넌트, 역할 = bot-token」으로 가는 데 필요한 두 결정은 아래 「결정 반영 1호」로 명세에 넣었다 |
| v1 투영의 새 규칙 「`contained_in` 은 출발 객체의 parent · tenant 참조가 도착을 가리켜야 인정」 | 해결 — aegi-dashboard PR #122(머지). Slack 정규화가 채널의 `context_team_id` 워크스페이스를 `references.parent` 로도 남긴다. v1 투영에서 7행이 돌아오고(260 → 267) 조건 갈래 `contained_in.slack_conversation.is_private_false` 가 다시 걸린다. Slack Profile 의 참조 이름도 `context_team` → `parent` 로 맞췄다(2026-10-22) |
| `triggered_by` template | v1 카탈로그는 2026-10-12 이전 Relation_Schema 사본이라 도착에 Resource · Integration 이 없다. 지금 데이터에는 행이 0 이라 영향이 없지만, 그런 행이 생기면 투영이 버린다 aegi-dashboard 이슈 #123 으로 사본 갱신을 제안했다 |
| 역할 객체가 도달 대상으로 보인다 | NamedRole 16개가 tenant 참조를 가져서 관리자가 「역할 정의」에 닿는 것으로 계산된다(예: GitHub 조직 owner → 역할 `admin`). 해롭지 않지만 도달 목록이 시끄럽다 |

의도된 변화라 그대로 둔 것: GWS `Token` 이 Assignment 만 남아 `authenticates_with` 사용자 → 토큰 13행이 빠졌다(원래 간선을 안 만들던 행이다). Okta OAuth2Client 가 Integration 이 되어 org 소속(M)이 등록(U)으로 바뀌었다(대시보드 결정 GC). 좋아진 것: GWS Apps Script `Project` 가 Resource 도 되어 묶인 문서 편집자가 스크립트도 고칠 수 있다는 길(관리 5)이 새로 보인다.

## 결정 반영 1호 — 수신 웹훅과 scope 세기 (2026-10-19)

재설계 5단계(결정 반영)의 첫 값 변경이다. Slack bot-token 을 「앱이 테넌트에 갖는 역할」로 이으려고(aegi-dashboard 이슈 #123) g2 실측에 넣어 보니 거짓 탐지가 하나 생겼다 — 「Apps Script 를 거쳐 Slack 조직 전체에서 관리 작업」. 경로는 Apps Script → (전송 기록) 수신 웹훅 → (`owned_by` 의 대행 A) 앱 → (새 역할) 엔터프라이즈였다. 틀린 곳이 둘이라 둘 다 정했다.

| 결정 | 명세 | 왜 |
| --- | --- | --- |
| 받는 곳이 정해진 통로는 주인 앱으로 동작하지 않는다 | `relation_semantics.yaml` `owned_by.delivery_endpoint` — 출발이 Endpoint 이고 `receives_into` 가 있으면 `owned_by` 의 A 를 만들지 않는다 | 수신 웹훅 주소를 쥐면 그 채널에 글을 올릴 뿐 앱의 bot token 권한은 못 쓴다. 그 힘은 `receives_into` 가 따로 준다. 대시보드 `blastRadius.ts` 도 수신 웹훅을 「아무것도 못 함」으로 본다 |
| 역할 객체에 이름이 없으면 scope 로 세기를 정한다 | `capabilities.yaml` `role_scopes_from`(properties.scopes) · `scope_rank`(Slack: `admin…` 5, `chat:write(.public)` 3, 채널 `history` · `read` 1, 나머지 0) | 세기를 모르면 엔진이 「관리 작업일 수도」로 계산한다. 규칙은 대시보드 `blastRadius.ts` tokenCapability() 의 Slack 갈래를 그대로 옮겼다 |

같은 실측에서 명세대로 다시 계산하면 수신 웹훅의 대행 선이 0 이 되고 Apps Script 는 엔터프라이즈에 닿지 않는다. 앱 다섯의 역할 세기는 DevBot · MFA Reset 3, SLACK-API-TESTER 1, 나머지 둘 0 이다. S5 가 scope 시험 예 6개를, S8 이 새 갈래가 실측에서 걸리는 수(수신 웹훅 3)를 센다.

엔진은 aegi-dashboard PR #125(2026-10-20 머지)부터 둘 다 같다. 웹훅 갈래는 처음에 S3 이 엔진과 다르다고 잡아 기준선에 올렸다가(65 → 66), 엔진이 따라온 뒤 `engine_probe` 에 이 갈래 시험(받는 곳이 있는 웹훅, Endpoint + Credential 출발 포함)을 더해 다시 뜨고 뺐다(66 → 65). `receives_into` 가 `owned_by` 를 거르는 셈이라 `filters` 에도 적었다. 이제 대시보드가 bot-token 을 「앱 `has_role_on` 테넌트, 역할 = bot-token」으로 이어도 거짓 탐지가 안 생긴다.

## 새 SaaS 역할 세기 표 — Salesforce · Jira · Confluence (2026-10-20, 4단계)

대시보드가 세 SaaS 의 수집기 · 정규화 · v1 Profile 을 갖췄고(aegi-dashboard PR #118), 1회차 실습 환경도 만들었다(PR #124). 실측 수집은 아직이다. 그런데 명세에는 이 SaaS 들의 역할 세기가 하나도 없어서, 데이터가 들어오면 역할이 전부 「모름」이 된다. 대시보드 엔진도 같다. 그래서 데이터보다 먼저 표를 채웠다.

**세기를 정하는 순서** — `capabilities.yaml` `role_rank_order`. 위에서부터 보고 처음 정한 방법을 쓴다.

| 방법 | 표 | 쓰는 곳 |
| --- | --- | --- |
| 이름 | `okta_standard_roles` · `capability_names` · **`role_name_rank`(새로)** · `role_rank` | 이름이 세기를 말하는 역할. 새 표는 provider 별 정규식이고 안 맞으면 모름이다(모르는 이름을 0 으로 치지 않는다) |
| scope | `role_scopes_from` · `scope_rank` | Slack bot-token (결정 반영 1호) |
| 권한 칸 | **`role_flag_rank`(새로)** | Salesforce 프로필 · 권한 집합 — 사용자 정의 프로필은 이름이 아무거나라 이름 대신 권한 칸(참 · 거짓)을 본다 |
| 객체 종류 | **`role_type_rank`(새로)** | Salesforce 역할 계층 자리(`UserRole`) |
| 권한 줄 | **`role_rank_from_grants`(새로)** | Jira 프로젝트 역할 — 「Developers」는 이름이 세기를 말하지 않는다. 그 프로젝트의 권한 스킴이 그 역할에 준 권한 키 중 가장 센 것이 세기다 |

**값과 근거.**

| SaaS | 역할 자리 | 세기 |
| --- | --- | --- |
| Jira | 권한 스킴 줄의 권한 키 (기본 제공 36개) | `ADMINISTER_PROJECTS` 5(프로젝트 설정 · 역할 구성원을 바꾼다). `EDIT_WORKFLOW` · `EDIT_ISSUE_LAYOUT` 3(문서는 관리 권한으로 묶지만 누가 들어오는지는 못 바꾼다). `BROWSE_PROJECTS` · `VIEW_*` 1. `ASSIGNABLE_USER` 0. 이슈 · 댓글 · 첨부 · 작업 기록 · 스프린트 · 서비스 요청 응대(`SERVICEDESK_AGENT`) 3. 앱이 더한 키는 모름 |
| Jira | 필터 공유 | `view` 1 · `edit` 3 |
| Jira | 프로젝트 역할 | 권한 줄에서 — 그 프로젝트에 줄이 없으면 모름(스킴 수집이 빠졌을 수 있어 0 으로 치지 않는다) |
| Confluence | 스페이스 권한 `동작:대상` | `administer:space` 5. `read:space` · `export:space` 1. 쪽 · 블로그 · 댓글 · 첨부 · 화이트보드를 만들고 고치고 옮기고 지우고 막는 동작(`restrict_content` 포함) 3. 사이트 단위인 `use` · `create_space` 는 모름 |
| Salesforce | 프로필 · 권한 집합 | Modify All Data · Manage Users · Author Apex 5, View All Data 1, API Enabled 0. 칸은 있는데 참이 없으면 0 — 조직 전체 권한이 없다 |
| Salesforce | 역할 계층 자리 | 0 — 아래 사람 레코드를 보는 힘은 공유 설정에 달려 Effective Access 가 푼다 |
| Salesforce | OAuth 승인 `authorized` | 1 — Okta 앱 배정과 같다 |

**근거** (2026-10-20 벤더 문서를 직접 열어 확인했다, 줄마다 `capabilities.yaml` 주석).

- Jira — Jira Cloud REST v3 명세(developer.atlassian.com `swagger-v3`)의 `GET /rest/api/3/permissionscheme` 설명에 있는 기본 제공 프로젝트 권한 36개. 처음 판(검색 요약으로 적은 모양 정규식)과 견주면 `SERVICEDESK_AGENT` 가 모름이었고, 관리 권한으로 묶인 `EDIT_WORKFLOW` · `EDIT_ISSUE_LAYOUT` 을 따로 적었다. 정규식도 36개 이름 그대로로 좁혔다 — 문서에 없는 키는 모름이다.
- Confluence — Confluence Cloud REST v2 명세(`openapi-v2`)의 `SpacePermissionAssignment` — 동작 키 15개 · 대상 11개 enum. `restrict_content` 는 맞았다. 대상 이름에 대문자(`userProfile`)가 있어 정규식을 넓혔고 `purge_version` 을 더했다. 보유자 종류에 `role`(스페이스 역할)이 있는데 대시보드 정규화가 안 받는다(아래).
- Salesforce — Object Reference `PermissionSet`(권한마다 `Permissions<이름>` 참 · 거짓 칸), Security Implementation Guide 「View All and Modify All Permissions Overview」(View All Data · Modify All Data 는 「조직 전체 관리자」용, 공유되지 않은 것까지 본다 · 고친다), 「User Permissions」(API Enabled 는 API 에 들어올 수 있다), Apex Developer Guide 「Enforce Object and Field Permissions」(Apex 는 시스템 모드로 돌면 사용자 권한을 건너뛴다). 처음 판의 「Author Apex 는 Modify All Data 가 있어야 켜진다」는 공식 문서에서 못 찾아 지웠다(세기 5 는 그대로). Manage Users 는 help.salesforce.com 이 자바스크립트로만 그려져 검색 요약으로 확인했다.

**검사.** S5 가 새 표의 모양과 시험 예 29개(실제 정규화가 만드는 역할 자리 모양 그대로)를 보고, 벤더 문서의 이름 49개(Jira 권한 36 · Confluence 동작 13)가 빠짐없이 세기를 받는지 본다. 표를 일부러 망가뜨린 26가지를 모두 잡는다. 대시보드의 가짜 시험 데이터(`scripts/collect/model-v1/saas3.test.ts`, 지금 없음)를 v1 로 투영해 걸면 역할 13행 중 12행이 세기를 얻는다 — 남은 1행은 가짜 레코드에 권한 칸이 없어서다. 이건 모양 확인일 뿐 근거가 아니다(검증은 실측으로만 한다). g2 실측(4개 SaaS)의 숫자는 그대로다.

**아직 모자란 것** (`access_patterns.yaml` 빈칸 「모으지 않는 권한」).

- Salesforce 권한 칸을 5개만 모은다. Salesforce 가 관리자급으로 꼽는 Customize Application, 프로필 · 권한 집합 관리, 권한 집합 배정, 객체별 View All · Modify All Records 는 안 모아서 「참이 없으면 0」이 낮게 잡힐 수 있다 — 대시보드 수집기 SOQL 에 칸을 더하자고 제안할 것.
- Jira 전역 권한(사이트 관리)과 Atlassian 조직 관리자는 관계가 없다. anyone · projectLead 같은 동적 보유자는 Effective Access 몫이다.
- Confluence 스페이스 권한을 스페이스 역할(`role`)로 받은 것은 대시보드 정규화가 관계로 안 만든다 — 대시보드에 제안할 것.
- 엔진(`accessModel.ts` roleCapability)은 새 표를 아직 안 읽는다. 엔진은 이름이 있으면 scope 를 안 보지만 명세는 이름으로 못 정하면 다음 방법으로 간다 — 지금 데이터에서 갈리는 행은 없고, 엔진에 새 표를 넣을 때 같이 맞춘다.

### 오브젝트 모델 v2 로 들어온 역할 (2026-10-21)

v2(aegi-dashboard PR #127)가 새로 모으는 역할 가운데 세기를 모르던 것을 채웠다. 기준은 Okta 표(`okta_standard_roles`)와 같다 — 관리 역할을 나눠 주면 5, 사람 · 앱 · 설정을 관리하지만 누가 관리자인지는 못 바꾸면 3(Okta `user_admin` · `app_admin`), 보기만 하면 1.

| 역할 | 세기 | 근거 |
| --- | --- | --- |
| Slack 관리 역할 Roles Admin (`Rl02`) | 5 | 누가 관리 역할을 받는지 정한다 |
| Slack Channel Admin · Channel Manager · User Admin · Security Admin · Integrations Manager · Workflow Admin · DLP Admin · Legal Holds Admin · Exports Admin · Sales Admin | 3 | 채널 · 사용자 · 앱 · 워크플로 · 설정 관리 |
| Slack Audit Logs Admin · Analytics Admin · Message Activity Manager | 1 | 보기만 |
| Slack Conversation Admin (`Rl05`) · Slack Platform Developer (`Rl0B`) | 모름 | 공개된 권한 설명을 못 찾았다 |
| Slack 워크플로 관리자 (`collaborator`) | 3 | 워크플로를 고치고 내리고 지우고, 다른 관리자를 더한다 |
| Slack 최고 소유자 (`primary_owner`) | 5 | 소유자(`owner` 5)와 같다 — 명세 · 엔진 모두 몰랐다 (blastRadius 만 관리자로 봤다) |
| GitHub Security manager · CI/CD admin · App Manager | 3 | 보안 기능 · Actions · GitHub App 관리. 구성원은 못 바꾼다 |
| GitHub Moderator | 1 | 댓글 숨기기 · 바깥 기여자 차단 |
| GitHub 저장소 전체 역할 · 사용자 정의 역할 | `base_role` | API 가 주는 기반 역할(read 1 · triage 2 · write 3 · maintain 4 · admin 5) |

- Slack 관리 역할은 이름 API 가 없어 대시보드가 번호(`role_id`)를 이름으로 쓴다. 번호표는 docs.slack.dev `admin.roles.addAssignments` 「Admin Roles」 표 16개다. 역할 뜻은 Slack 도움말이 이 환경에서 안 열려 검색으로 확인했다.
- `role_rank_order` 맨 뒤에 `base_role` 단계를 붙였다. 엔진은 이미 마지막에 읽던 단계라 명세가 엔진을 따라간 것이다. GitHub 기본 조직 역할의 API `name` 표기는 문서에 없어 `security_manager` 와 `Security manager` 를 다 받는다.
- S5 시험 예를 29개에서 42개로 늘렸다. Slack 번호표 16개는 표의 번호가 문서에 있는지(오타)와, 문서의 번호가 세기를 받거나 일부러 뺀 목록에 있는지를 본다.
- g2 실측에서 세기를 아는 역할 줄이 44 → 45 (Slack 최고 소유자 1줄). 엔진은 사본을 올리면 이름 표를 바로 읽는다. `base_role` 단계는 엔진 roleCapability 의 순서 고리에 갈래 하나를 더해야 한다(지금은 고리 밖에서 읽는다).

## 결정 반영 2호 — 「조직 소유」의 뜻 (2026-10-21 초안, 2026-11-01 정함)

**정한 것 (2026-11-01 Relation 주담당).** 아래 추천을 그대로 받았다. 권고가 「미룬다」였던 Okta 리프레시 토큰은 10-30 실측으로 재고
대행을 토큰 → 앱에서 **토큰을 준 사람**으로 바꿨다(받은 scope 만큼이라 모름 사유 `token_scope_limited`). 같은 날 판단표 G4-Q03(Atlassian
특수 주체: 익명은 누구나, 모든 라이선스 사용자는 테넌트 전원, 역할 묶음은 모름), G4-Q06(세션 권한: 켜진 세션만 그대로, 나머지는 모름
`session_activation`), 조직 단위 소속(소속 M)도 정했다. 모두 `relation_semantics.yaml` 의 조건 갈래와 `rules.outbound_hooks.decided` 에 있고
`open` 에서 뺐다. 시험은 `validation/check_semantics.py` S8 「결정 시험 세계」다.

- 10-30 실측(운영 current 와 같은 판)에서 지금 걸리는 것은 세션 권한 5행, 특수 주체 관계 14행, 조직 단위 소속 8행이다. 조직 소유 갈래와
  리프레시 토큰 갈래는 0행이다 — IM Profile 정규화 산출(`fixture_meta.im_profile.profile_constants`)에 아래 상수가 아직 없다(Okta 훅 ·
  스트림 · 메일 서버의 `direction`, 프로필 매핑 · 워크플로의 `run_as_resolution`). 토큰은 `credential_kind` 가 계약 밖 값 `api_token` 이다.
  상수는 이 저장소 카탈로그(`catalog/*/research.json` 의 `decision.constants`)에 있고, 엔진 IM Profile 로 옮기는 것은 aegi-adapter-engine 몫이다.

오브젝트 모델 v2(aegi-dashboard PR #127)가 새로 모은 것 중 10종이 `owned_by` → 조직으로 들어온다. 이 명세는 그것을 「소유 주체로 동작」(A, 대행)으로 읽는다. 쥐면 조직으로 행세한다는 뜻이다. 벤더 문서로 보면 대부분 맞지 않는다. 팀이 정할 일이라 `relation_semantics.yaml` 의 `open` 에 **적기만 했다** — 값은 그대로이고 기준선도 그대로(65)다.

| 종류 | 실제로는 | 추천 (`open` id) |
| --- | --- | --- |
| Okta 이벤트 훅 · 로그 스트림 · SSF 송신 스트림 · 메일 서버 | 조직이 내용을 밖으로 보내는 통로다. 주소를 쥐어도 조직의 힘은 못 쓴다 | 대행 빼고 소속만. 흐름(F)은 `outbound_hooks` 가 이미 만든다 (`owned_by.outbound_endpoint`) |
| Okta 인라인 훅 | Okta 가 멈추고 답을 기다렸다 따른다 | 대행 유지 + 나가는 흐름(F) 더하기 (`outbound_hooks.both_way`) |
| Okta API 토큰 · Google 앱 비밀번호 | 만든 사람의 권한 그대로다 | 대행을 조직 → **만든 사람**으로 (`owned_by.org_bearer_token`) |
| Okta IdP 서명 키 | 바깥 IdP 의 공개 인증서다. 개인키는 상대가 가진다 | 대행 빼고 소속만 (`owned_by.public_certificate`) |
| 앱 없는 Okta 프로필 매핑 · Slack 워크플로 | 실행 신원을 모른다 | 대행 빼고 소속만 (`owned_by.unknown_runner_tenant`) |

- 종류를 이름으로 고르지 않는다. 대시보드 오브젝트 모델 v1 카탈로그의 Profile 상수 — `direction` (out · both · in), `credential_kind` (bearer_token · certificate), `run_as_resolution` (unknown) — 로 고른다. 같은 상수를 가진 새 종류도 같이 걸린다.
- 같은 상수라도 걸리면 안 되는 것이 있다. Okta 리프레시 토큰과 사용자 인증 요소도 `bearer_token` 이지만 조직 소유가 아니다. 앱 주소(RoutedEndpoint)도 `out` 이지만 앱 소유다. 토큰 갈래는 「조직 소유인 것만」 고르려고 `exists_relation.target_interface` 를 더했다.
- 메일 서버를 쥐고 재설정 메일을 가로채면 계정을 차지할 수 있다. 지금 대행 → 조직은 이 위험을 말하지 못한다. 새 방식으로 둘지는 `recovery_mail_path` 로 따로 남겼다.
- 10종 밖이지만 같은 모양: Okta 리프레시 토큰은 앱 소유라 대행이 토큰 → 앱이다. 대시보드 blastRadius 는 토큰 주인 사람 + scope 로 센다. g2 실측에 10개 있어 정하면 결과가 바뀐다 (`owned_by.app_refresh_token`).

**결과 차이 (저장소 밖 시뮬레이션).** 대시보드 시험의 V2-P1 · V2-P2 수집 기록으로 10종을 만들고, 토큰을 만든 사람에게 Okta 최고 관리자 역할을 준 묶음을 엔진에 넣었다. 제안은 엔진 코드를 안 바꾸고 데이터를 바꿔 흉내 냈다.

| | 지금 | 제안 |
| --- | --- | --- |
| 대행(A) → 조직 | 10종 모두 | 인라인 훅만 |
| 쥐었을 때 닿는 곳 (10종 각각) | 모두 0 — 조직 자체가 가진 권한이 없어 대행 선은 아무것도 안 물려준다 | API 토큰 23개(관리), 나머지 0 |
| 나가는 흐름(F) | 이벤트 훅 · 로그 스트림 · SSF · 메일 서버 | + 인라인 훅 |
| 탐지 | 4건 | 4건 (같은 것) |

지금 대행 선은 그래프에 「이걸 쥐면 조직으로 움직인다」는 틀린 설명만 남긴다. 조직이 구성원 모두에게 주는 권한(공개 채널 읽기 같은)이 있는 데이터에서는 틀린 권한이 된다. 반대로 Okta API 토큰은 지금 「아무것도 못 함」으로 나오는데 실제로는 만든 관리자 권한 그대로다. 대시보드 blastRadius 는 이미 그렇게 센다 — 결정 반영 1호 때와 같은 모양이다. g2 실측에는 10종이 없어 결과가 같다.

S8 이 `open` 의 모양(id · question · why · options · recommend)과 초안 식을 보고, 만든 세계 하나(25개 객체: 10종 + 같은 상수지만 걸리면 안 되는 것)에서 초안이 걸리는 행을 맞춰 본다. 일부러 틀린 초안 7개(조직 소유 조건 빼기, 양방향까지 넓히기, 칸 바꾸기, 추천 지우기, 틀 밖 칸, 간선 종류 오타, 없는 규칙)를 모두 잡는다.

## 권한 방식 (`access_patterns.yaml`, 3단계 초안)

SaaS 마다 데이터 모양은 달라도 "누가 무엇에 닿게 되는 방식"은 몇 가지뿐이다. Slack 공개 채널과 Drive 도메인 공유는 둘 다 **범위 공개**고, 다른 것은 그 뜻을 알려 주는 칸(`is_private` / `type: domain`)뿐이다. 그래서 방식을 한 번만 정의하고 SaaS 는 빈칸만 채우게 하려는 목록이다 — 관계는 단어, 권한 방식은 문법, SaaS 빈칸은 사투리 사전.

방식마다 `covers`(엔진 효과 중 어느 것을 이 방식이 만드나)와 `blanks`(SaaS 가 채우는 빈칸, 지금 값이 어디 있나)를 적었다. **값은 안 바꿨다.** `validation/check_semantics.py` S5 가 엔진 효과 · 조건 갈래가 빠짐없이 어느 방식에 들어갔는지, `providers.yaml` · `capabilities.yaml` 의 표가 빠짐없이 어느 빈칸(또는 `not_patterns`)에 들어갔는지 본다.

빈칸의 `where` 가 다음 할 일을 보여 준다. `dictionary`(사전 표에 있음)는 이미 빈칸 방식이고, `code`(대시보드 코드에 SaaS 이름으로 박혀 있음)는 빈칸으로 꺼내야 할 곳, `measured`(실측만 있음) · `none` 은 아직 담을 자리가 없는 곳이다.

`tools/diagnose_relations.py` 는 관계 17종을 명세(template · 등급) · 엔진(`engine_probe`) · 데이터(Profile 선언, Slack 실측, 대시보드 합성)가 각각 어떻게 보는지 한 줄씩 나란히 놓는다. 값은 안 바꾸고 측정만 한다. 결과는 `reports/Relation_Diagnosis_v1.md` 이고, `--dashboard <aegi-dashboard>` 를 주면 합성 데이터 열이 채워진다.

## 관계 → 간선은 시험 결과다 (`engine_probe`)

대시보드는 관계를 간선으로 바꾸는 규칙을 표가 아니라 `edges.ts` 의 switch 문으로 쥐고 있다. 글자로 읽을 수 없어서 **엔진에 넣어 봤다** — 객체 둘과 관계 하나짜리 그래프를 만들어 엔진이 실제로 내는 간선을 적었다. 관계 17종 × interface 9 × 9 칸, 그리고 조건이 붙으면 달라지는 18가지(지운 배정, 제외 정책, Okta resource set, 측정 계정, 부른 사람 권한으로 도는 자동화, `anyone` 공유, Slack 채널 멤버 능력 · 공개 여부, 컨테이너에 묶인 스크립트 등).

**그래서 이 블록은 엔진의 규칙이 아니라 시험 결과다.** 블록 안에 시험 입력(`inputs`)과 입력에 따라 달라지는 것(`depends_on_inputs`)을 같이 적었다. 예를 들어 `has_role_on` 기본 행은 늘 `role_rank_unknown` 인데, 엔진이 rank 를 역할로 정하고 시험에는 역할이 없었기 때문이다. `member_of` 의 M · G 도 interface 쌍이 아니라 도착이 그룹 같은가(`isGroupLike`)로 정해진다. 1단계에서 대시보드가 이 블록을 규칙으로 읽으면 안 된다.

```yaml
member_of:
  use: edges          # edges 간선을 만든다 · filter 다른 관계를 거른다 · unread 읽지 않는다
  edges:
  - pairs: [Principal>Tenant, Principal>Principal]
    emits:
    - {kind: M, from: source, to: target}
  - pairs: [Principal>Resource]
    emits:
    - {kind: G, from: source, to: target, rank: 1}
  outside_template: {cells: 78, with_edges: 78}
```

template 이 받는 칸만 `edges` 에 적었고, 받지 않는 칸에서 간선이 나온 수는 `outside_template` 에 센다. 결과는 **간선을 만드는 것 10종, 거르기만 하는 것 1종(`excludes`), 안 읽는 것 6종**이다.

## 0단계 확인 (2026-10-03)

| 확인 | 결과 |
| --- | --- |
| `validation/run_all.py` | 위반 60건, 기준선 그대로. **새 검사 절 말고는 출력이 한 글자도 안 바뀌었다** |
| `collect/slack/run.py` | 127노드 / 190행 같다. 출력 전체가 같다 |
| `check_dashboard.py`(2026-10-21 `e6b9e3b`에서 지움) | 대시보드 블록 29개, 차이 0 — 옮긴 `0ee565f` 와 그 뒤 main(`bde24b0`) 둘 다 |
| 대시보드 `npm run engine:verify` | 대시보드 코드는 안 고쳤다. 1단계 비교용 값: 합성 데이터셋에서 묶음 6개(격차 6), 섀도 대조 통과 |
| 대시보드 정답 대조 · 이름 바꾸기 | 대시보드 코드를 안 고쳐서 그대로다. 실측 데이터셋과 `truth.json` 이 저장소에 없어 여기서는 못 돌렸다 |

검사가 정말 잡는지 일부러 깨뜨려 봤다.

| 깨뜨린 것 | 잡은 것 |
| --- | --- |
| 사전만 고침 — 구조 등급 기본 `접힘` → `펼침` | `check_ontology` O1 |
| 문서만 고침 — `rotation` 값 하나 추가 | `check_ontology` O1 |
| 사전 안에서 어긋남 — `permits` 의 form 만 고침 | `check_ontology` O1 + O3 |
| 출처 없는 블록 추가 | `check_ontology` O2 |
| 문서 머리글 `### 등급` → `### 표현 등급표` | `check_ontology` O1 「문서 표를 못 읽어 대조하지 못했다」. **처음엔 검사가 죽기만 해서 `run_all` 이 「기준선 그대로」로 통과했다**(리뷰가 찾았다) |
| 사전 YAML 문법 깨뜨리기 | `run_all` 「끝까지 못 돈 검사 4개」로 실패. 그 상태의 `--update` 는 기준선을 안 고친다 |
| 대시보드 블록 · 시험 결과를 손으로 고침 | `check_dashboard` D1(지금 없음) |
| 사전이 있는데 `bootstrap.py` 를 다시 돌림 | `--force` 없이는 덮지 않는다 |
| 사전 template 에서 `member_of → Resource` 빼기 | `collect/slack/run.py` — 위반 기준선(`relation_checks.json`) 1건 → 11건으로 실패. 처음엔 행만 비교해서 127/190 이 같다고 통과했다 |

## 0단계에서 알게 된 것 — 고치지 않았다

옮기기만 하는 단계라 아래는 그대로 두었다.

| 무엇 | 언제 |
| --- | --- |
| 계약 필드 `rotation` · `grant_target` 이 대시보드 계약값 표(`INTERFACE_CONTRACT_VALUES`)에 없다 | **의도로 정리했다(1단계).** 대시보드는 Profile 이 없어 행(judged)에서 판정할 필드를 고른다 — 행 필드에 `direction` · `credential_kind` 를 더한 9개. 허용값은 사전에서 오고, 고르는 목록은 대시보드 `scripts/ontology/generate.ts` 의 `JUDGED_FIELDS` 다. 두 필드를 넣으면 대시보드 정규화와 검증 결과가 바뀐다 |
| 대시보드는 Link level 로 v1 값 `candidate` · `inferred` 도 받는다(약한 쪽으로 본다). 명세에는 없다 | 2단계 신원 등급 합치기 |
| 엔진이 안 읽는 관계 6종 — `permits` · `registered_by` · `authenticates_with` · `applies_to` · `evaluates` · `trusts` | 팀 결정 #4 (읽는다 / 정보 관계 / 보류) |
| **엔진은 template 을 따지지 않는다.** template 밖 1,244칸 중 574칸에서 간선을 낸다(`has_role_on` · `member_of` · `registered_in` · `acts_as` · `runs_as` · `receives_into` · `shared_with` 는 거의 전부). 대시보드 데이터 검사(`validate:data`)도 관계 이름 · 참조 · 역할 자리만 본다. `check_power` 가 재는 template 의 거부력은 이 저장소의 Slack 수집기에서만 작동하고, 거기서도 위반을 출력만 한다 | template 검사를 어디에 걸지 정한다 |
| **표현 등급과 엔진이 관계를 다르게 나눈다** — 아래 표 | 2단계 효과 종류 합치기 |
| `engine_probe` 대조 도구 `check_dashboard.py`는 2026-10-21(`e6b9e3b`)에 지웠다. 지금 대조하는 도구가 없어 엔진이 바뀌어도 `engine_probe`는 따라 바뀌지 않는다 | 대시보드 CI 에 넣을지 정한다 — 넣으면 엔진 동작을 바꿀 때마다 사전도 고쳐야 한다(1단계 PR 에서는 뺐다) |

등급과 엔진 간선을 나란히 놓으면 이렇다 (지운 `check_dashboard.py` D2 가 같은 표를 냈다).

| 등급 (기본 표시) | 관계 → 엔진이 만드는 간선 |
| --- | --- |
| 구조 (접힘) | `contained_in` → A · F · M · U, 조건에 따라 G(Slack 공개 채널) · T(컨테이너 바인딩) |
| 접근 (펼침) | `has_role_on` G · `member_of` M · G · `owned_by` A · G · `excludes` 거르기만 · `permits` · `applies_to` · `evaluates` 안 읽음 |
| 신뢰 (펼침, 강조) | `shared_with` G · `receives_into` G · F · `runs_as` A · F · `acts_as` A · `triggered_by` T · `registered_in` U · `authenticates_with` · `trusts` · `registered_by` 안 읽음 |

- 명세는 `contained_in` 을 **"접어도 정보 손실이 없다"**고 한다(`Relation_Schema_v3` 「`contained_in`은 기본으로 접는다」). 같은 값이 Object 쪽에 있다는 뜻으로는 맞다. 그런데 엔진은 이 관계에서 소속(M) · 대행(A) · 흐름(F) 간선을 만들고, Slack 공개 채널이면 테넌트 전원 읽기(G)까지 낸다. 화면에서 접으면 그 결론의 근거가 안 보인다
- `shared_with` · `receives_into` 는 신뢰 등급("이 신원이 무엇으로 성립하나")인데 엔진은 권한(G)으로 쓴다. `check_twohop` 이 2홉 둘째에서 `shared_with` 를 뺀 것(사용자 → 채널 → 팀은 사용자의 권한이 아니다)은 방향이 달라 엔진과도 맞다. 어긋나는 것은 등급 이름이다
- 재정립이 풀려는 문제가 이것이다. 관계마다 무엇을 만드는지(효과)를 사전 한 곳에 선언하고, 화면 등급과 엔진이 둘 다 그것을 읽게 한다

## 아직 안 옮긴 것

- **결론 경로 식(can · cause · know)** — 엔진에 표가 아니라 탐색 코드로 있다. 경로 식으로 적는 것은 정책을 술어로 다시 쓸 때(3단계)
- **정본 참조 형식**(`provider:type:key=value`, 타입별 키) — 팀 결정 #6 뒤
- **벤더별 파일**(`providers/<벤더>.yaml`)과 항목별 출처 종류, **우리 실측 사실**(Okta 그룹 → 앱 끊기, Slack 기본 채널 기록뿐, IdP 그룹 채널 제한, Okta → Slack 교차 전달) — 2단계
- **효과 종류의 문 · 차단 · 기록뿐**, **「모름」 명세 15행 + 엔진 사유 19개를 한 목록으로** — 2단계
- **명세 문서의 표를 사전 가리키기로 바꾸기** — 사전을 정본으로 두기로 정했다(결정 #1). 지금은 문서 표와 사전이 둘 다 있고 검사가 묶어 둔다. 문서 표를 사전 가리키기로 바꾸는 일이 남았다
