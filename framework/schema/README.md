# AEGI Schema

여러 SaaS에 흩어진 권한을 **하나의 그래프**로 모아, 「이 사람이 무엇을 할 수 있나」를 SaaS 경계를 넘어 묻는 것이 목표다.

기본 자료는 **Object**(대상 하나가 한 행)와 **Relation**(대상 사이의 사실 하나가 한 행)이다. 동일인 판단(Link), 계산된 접근(Effective Access), 계보는 성격과 저장을 구분한다.

이 문서는 현재 문서의 안내다. 아래 Profile과 실측 수치는 해당 문서를 작성한 당시 결과이며 현재 테넌트 건수가 아니다. 전체 자료 지도와 개발 아키텍처를 함께 본다.

## 문서 지도

데이터 형식, 객체 계약과 수집 설정을 구분한다. 규격과 초안의 상태는 각 문서를 따른다.

### 저장되는 실제 데이터

| 문서 | 무엇을 정하나 |
| --- | --- |
| [Object_Schema_v4.1](specs/Object_Schema_v4.1.md) | 노드의 모양. 수집한 대상 하나가 한 행 |
| [Relation_Schema_v3](specs/Relation_Schema_v3.md) | 간선의 모양. 어휘 17종 (부여 16 + 구조 1) |
| [Relation_Semantic_Layer_v1](specs/Relation_Semantic_Layer_v1.md) | **v1 (2026-11-11).** 관계의 두 층. 기록 층은 관계 17종 그대로, 의미 층은 엔진이 계산할 때 읽는 정식 어휘인 사실 9종과 능력 10종. SaaS 차이는 표에만 둔다. 배정 자리 선언 표, 지면 시험에서 나온 칸 8가지 |
| [Link_Schema_v3](specs/Link_Schema_v3.md) | provider 사이의 신원 판단. **Relation과 별개 저장소** |
| [Effective_Access_Schema_v1](specs/Effective_Access_Schema_v1.md) | **v1 (2026-10-29).** "실제로 할 수 있는가"를 계산한 결론. 또 다른 별개 저장소 |
| [Lineage_Storage_v1](specs/Lineage_Storage_v1.md) | 데이터 계보(기능 C)의 D1 테이블. 관계 어휘가 아니라 F 간선에서 파생된 기록 |

Relation은 벤더가 준 사실이고, Link와 Effective Access는 **우리가 만든 결론**이다. 뒤의 둘은 질의가 명시적으로 켜야 넘어간다. 추정이나 계산이 확실한 사실처럼 답에 섞이면 안 되기 때문이다. 계보 저장은 관계 어휘를 늘리지 않고 흐름에서 파생된 기록을 담는다.

### 저장하지 않는 계약과 설정

| 문서 | 무엇을 정하나 |
| --- | --- |
| [Interface_Spec_v3](specs/Interface_Spec_v3.md) | interface 9종. Object에 붙는 태그이자 지켜야 할 계약 |
| [Profile_Schema_v4.2](specs/Profile_Schema_v4.2.md) | 수집기의 입력. object_type 하나당 하나 |
| [Path_Rule_Schema_v1](specs/Path_Rule_Schema_v1.md) | **초안.** 관계 경로와 조건으로 결론을 내는 규칙의 형식. Effective Access 합성 규칙과 이벤트 연결 규칙이 같이 쓴다. 지금 EA 코드를 옮겨 본 결과는 EA 진단표 |
| [Cut_Action_Schema_v1](specs/Cut_Action_Schema_v1.md) | **초안.** 4층 조치. 위험한 길을 막으려면 무엇을 끊나를 동사로 적는 형식과 동사 16개(13개는 닫음, 3개는 열어 두고 작업). 회수 지점(EA `cut`)마다 어느 SaaS 의 어느 API 나 화면으로 끊는지, 되돌릴 수 있는지, 누가 할 수 있는지 |
| `runtime/engine/scripts/collect/profile-binding/` | 현행 실행용 IM Profile·Overlay 정본 (구 카탈로그 Profile 121개는 대체됨) |
| [Activity_Schema_v1](specs/Activity_Schema_v1.md) | **초안.** 사건 기록 Activity. 「언제 누가 무엇을 했나」를 Splunk 정규 이벤트와 엔진 관측을 합친 한 모양으로 적고, SaaS 차이는 사건 사전(`ontology/activity_types.yaml`)에 모은다. 사건은 관계 행을 만들지 않는다 |
| [Activity_Usage_v1](specs/Activity_Usage_v1.md) | **초안.** 사건으로 본 출처와 사용. 관계 행 `provenance`, `usage`, EA `exercised`, `unused_in`, 격차 `exercised_by`, 새 판정 `unexplained_activity`, 로그 점수판. 설정상 가능(관계)과 실제 사용을 섞지 않고, 로그에 없음은 권한 없음이 아니다 |
| [Splunk_Normalized_Event_Contract_v1](specs/Splunk_Normalized_Event_Contract_v1.md) | 감사 이벤트의 행위, 결과, 위험 신호, 표시 이름 계약. Schema의 Object나 Relation 어휘를 추가하지 않음 |

### 참고용 초기 Profile 예시

아래 세 문서는 스키마 초안 검증 당시 작성된 참고용 예시이며, 실제 런타임 실행용 Profile은 `runtime/engine/scripts/collect/profile-binding/`에 있다.

| 문서 | 근거 | 무게 |
| --- | --- | --- |
| [Slack_Profiles_v3](specs/Slack_Profiles_v3.md) | 초기 실측 응답 기반 (8종, 127노드 / 191관계) | 제일 무거움 |
| [Okta_Profiles_v3](specs/Okta_Profiles_v3.md) | OpenAPI 규격 764 오퍼레이션 기반 (API 호출 0, 6종) | 중간 |
| [Pilot_Profiles_v3](specs/Pilot_Profiles_v3.md) | 초기 Object List 기반 (6종, 전부 `inferred`) | 제일 가벼움 |

## 개념 사전

| 경로 | 역할 |
| --- | --- |
| [ontology/](ontology/) | Interface 9종, Relation 17종, 간선, 능력, 불확실성, 정책, 판정, Crosswalk 연결 규칙을 기계 판독 YAML로 관리한다 |

## IM 모델의 도출 근거

| 경로 | 역할 |
| --- | --- |
| [im-model/](im-model/README.md) | Information Map·ID 공간 도출 도구(Python), v1/v2 조사 기록, 현행 고정본 **IM Object Model V3.2**(`im-model/model/v3.2/`) |

## 무결성 검증

저장소 루트에서 아래 명령으로 공개 안전성, 문서 링크, IM V3.2 고정본(40개 파일) 해시 무결성을 검증한다.

```bash
npm run verify          # 안전성 검사 + 문서 링크 검사 + IM V3.2 해시 검증
npm run verify:freeze   # IM Object Model V3.2 고정본 무결성만 단독 검증
```

> 특정 테넌트의 실측 원자료(Slack 원본 응답 등)는 외부 공개 안전성을 위해 이 저장소에 포함하지 않는다. 규격과 온톨로지 변경은 이 저장소(`aegi-framework`)에서 직접 관리한다.
