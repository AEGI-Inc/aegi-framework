# AEGI Schema

여러 SaaS에 흩어진 권한을 **하나의 그래프**로 만들어, "이 사람이 무엇을 할 수 있나"를 SaaS 경계를 넘어 물을 수 있게 하는 것이 목표다.

기본 자료는 **Object**(대상 하나가 한 행)와 **Relation**(대상 사이의 사실 하나가 한 행)이다. 동일인 판단(Link), 계산된 접근(Effective Access), 계보는 성격과 저장을 구분한다.

이 문서는 현재 문서의 안내다. 아래 Profile와 실측 수치는 해당 문서를 작성한 당시 결과이며 현재 테넌트 건수가 아니다. 전체 [자료 지도](../docs/reference/materials.md)와 [개발 아키텍처](../docs/architecture/README.md)를 함께 본다.

## 문서 지도

데이터 형식, 객체 계약과 수집 설정을 구분한다. 규격과 초안의 상태는 각 문서를 따른다.

### 저장되는 것 — 실제 데이터

| 문서 | 무엇을 정하나 |
| --- | --- |
| [Object_Schema_v4.1](specs/Object_Schema_v4.1.md) | 노드의 모양. 수집한 대상 하나가 한 행 |
| [Relation_Schema_v3](specs/Relation_Schema_v3.md) | 간선의 모양. 어휘 17종 (부여 16 + 구조 1) |
| [Relation_Semantic_Layer_v1](specs/Relation_Semantic_Layer_v1.md) | **v1 (2026-11-11).** 관계의 두 층. 기록 층 = 관계 17종(그대로), 의미 층 = 사실 9종 + 능력 10종(엔진이 계산할 때 읽는 정식 어휘, SaaS 차이는 표에만). 배정 자리 선언 표, 지면 시험에서 나온 칸 8가지 |
| [Link_Schema_v3](specs/Link_Schema_v3.md) | provider 사이의 신원 판단. **Relation과 별개 저장소** |
| [Effective_Access_Schema_v1](specs/Effective_Access_Schema_v1.md) | **v1 (2026-10-29).** "실제로 할 수 있는가"를 계산한 결론. 또 다른 별개 저장소 |
| [Lineage_Storage_v1](specs/Lineage_Storage_v1.md) | 데이터 계보(기능 C)의 D1 테이블. 관계 어휘가 아니라 F 간선에서 파생된 기록 |

Relation은 벤더가 준 사실이고, Link와 Effective Access는 **우리가 만든 결론**이다. 뒤의 둘은 질의가 명시적으로 켜야 넘어간다. 추정이나 계산이 확실한 사실처럼 답에 섞이면 안 되기 때문이다. 계보 저장은 관계 어휘를 늘리지 않고 흐름에서 파생된 기록을 담는다.

### 저장 안 되는 것 — 계약과 설정

| 문서 | 무엇을 정하나 |
| --- | --- |
| [Interface_Spec_v3](specs/Interface_Spec_v3.md) | interface 9종. Object에 붙는 태그이자 지켜야 할 계약 |
| [Profile_Schema_v4.2](specs/Profile_Schema_v4.2.md) | 수집기의 입력. object_type 하나당 하나 |
| [Path_Rule_Schema_v1](specs/Path_Rule_Schema_v1.md) | **초안.** 관계 경로와 조건으로 결론을 내는 규칙의 형식. Effective Access 합성 규칙과 이벤트 연결 규칙이 같이 쓴다. 지금 EA 코드를 옮겨 본 결과는 [EA 진단표](reports/EA_Rule_Diagnosis_v1.md) |
| [Cut_Action_Schema_v1](specs/Cut_Action_Schema_v1.md) | **초안.** 4층 조치. 위험한 길을 막으려면 무엇을 끊나를 동사로 적는 형식과 동사 16개(13개는 닫음, 3개는 열어 두고 작업). 회수 지점(EA `cut`)마다 어느 SaaS 의 어느 API 나 화면으로 끊는지, 되돌릴 수 있는지, 누가 할 수 있는지 |
| [catalog](catalog/README.md) | **이전 기록.** 옛 카탈로그의 색인, 검토 파일, 연구 근거. Profile 121개는 지웠고 현행 Profile은 engine `scripts/collect/profile-binding/`에 있다 |
| [Activity_Schema_v1](specs/Activity_Schema_v1.md) | **초안.** 사건 기록 Activity. 「언제 누가 무엇을 했나」를 Splunk 정규 이벤트와 엔진 관측을 합친 한 모양으로 적고, SaaS 차이는 사건 사전(`ontology/activity_types.yaml`)에 모은다. 사건은 관계 행을 만들지 않는다 |
| [Activity_Usage_v1](specs/Activity_Usage_v1.md) | **초안.** 사건으로 본 출처와 사용. 관계 행 `provenance`·`usage`, EA `exercised`·`unused_in`, 격차 `exercised_by`, 새 판정 `unexplained_activity`, 로그 점수판. 설정상 가능(관계)과 실제 사용을 섞지 않고, 로그에 없음은 권한 없음이 아니다 |
| [Splunk_Normalized_Event_Contract_v1](specs/Splunk_Normalized_Event_Contract_v1.md) | 감사 이벤트의 행위, 결과, 위험 신호, 표시 이름 계약. Schema의 Object나 Relation 어휘를 추가하지 않음 |

### 구현 — 형식을 실제로 채운 것

| 문서 | 근거 | 무게 |
| --- | --- | --- |
| [Slack_Profiles_v3](specs/Slack_Profiles_v3.md) | run2 **실제 응답**. 8종 → 127노드 / 191관계 | 제일 무거움 |
| [Okta_Profiles_v3](specs/Okta_Profiles_v3.md) | OpenAPI 규격 764 오퍼레이션. **API 호출 0**. 6종 | 중간 |
| [Pilot_Profiles_v3](specs/Pilot_Profiles_v3.md) | 최종 Object List 워크북 네 열. 6종, 전부 `inferred` | 제일 가벼움 |

**셋을 같은 무게로 읽으면 안 된다.** 문서들이 스스로 그렇게 적어 놨다.

## 원자료와 회귀 기준선

`schema/data/`는 `0eae77a`에서 추적 대상에서 제거되었다. 과거 문서의 Object 목록 320건과 Slack 원 응답 101건은 현재 checkout에 제공되지 않는다. 실측 원본의 현재 보관 위치도 이 저장소에서 보장하지 않는다.

당시 내용과 `data/README.md`는 삭제 전 커밋 `0eae77a^`의 이력에 남아 있다. 이력의 원자료를 현재 환경의 자료로 사용하지 않는다.

[fixtures/slack/](fixtures/slack/)에는 회귀 기준선 **127노드, 191관계**와 재생 코드가 남아 있다. 기대 결과가 남아 있는 것과 원본부터 재현할 수 있는 것은 다르다. 입력과 검증의 제약은 [자료 지도](../docs/reference/materials.md)에 정리했다.

## 개념 사전

| | 무엇 |
| --- | --- |
| [ontology/](ontology/) | interface, 관계, 간선, 능력, 불확실성, 정책, 판정과 연결 규칙을 기계가 읽는 YAML로 관리한다. 이후 변경과 초안은 각 파일의 상태를 따른다 |
| [catalog/splunk-event-labels-v1.json](catalog/splunk-event-labels-v1.json) | 공급자와 원본 행위 이름별 한국어 표시 이름 사전. 원본 이벤트 이름은 보존 |

검사와 Slack 수집기가 어휘를 여기서 읽는다. 명세 문서의 같은 표와 다르면 `validation/check_ontology.py` 가 실패한다.

## IM 모델의 도출 근거

| | 무엇 |
| --- | --- |
| [im-model/](im-model/README.md) | IM 모델이 도출된 과정(후보 추출, ID 공간, Information Map, v1 단계별 조사), v1과 v2 판별 기록, 도출 도구(Python). 규격의 정본은 아니다 |

## 검사

| | 무엇 |
| --- | --- |
| [validation/](validation/) | 문서와 사전, Profile, 원자료를 대조하는 스크립트와 당시 기준선. 일부 입력은 제거됨 |

```bash
# 저장소 루트에서 실행하는 기본 검사
npm test
npm run build
npm run lint
```

추가 Python 검사는 `python schema/validation/run_all.py`, Slack 재생은 `python schema/fixtures/slack/run.py`다. `pyyaml`, `openpyxl`과 필요한 원자료를 확보한 뒤 실행한다. `run_all.py`는 `validation/baseline.txt`와 대조하며, 입력이 없거나 검사가 끝까지 돌지 못하면 통과로 볼 수 없다. 현재 npm 검사 범위와 CI 상태는 [개발 안내](../docs/development/README.md)에 있다.

**검사가 없던 동안 같은 실수가 두 번 났다** — `basis` 의 기본값을 바꾼 것과, `parent_fanout` 불변식을 `spec` 게이트 없이 넣은 것. 둘 다 침묵의 뜻을 바꿔서 기존 Profile 을 무효로 만들었고 사람 눈으로는 안 잡혔다. `validation/README.md` 에 무엇을 재는지와 지금 남은 위반 62건이 있다.

## 요약 문서

- [SUMMARY_docs.md](SUMMARY_docs.md) — 문서 아홉 개를 하나씩 요약
- [SUMMARY_session.md](SUMMARY_session.md) — 2026-09-20~24 작업 세션 요약. 검증 결과와 미결 항목

## 변경과 전달

처음에는 로컬 작업 문서를 공유하기 위한 사본으로 시작했지만, 현재 규격의 정본은 `aegi-knowledge`다. 개인 vault를 고쳤다는 이유로 이 규격이 바뀌지는 않는다. 규격 변경은 이 저장소에서 검토하고 [저장소 관리 절차](../docs/repositories/README.md)로 구현 저장소에 전달한다.
