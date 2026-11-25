# 복잡계 모델링 방식과 Object 판정 기준

- 작성일: 2026-10-13
- 질문: SaaS 환경을 빠짐없이 표현하려면 Object를 어떤 기준으로 정하고 구성해야 하나
- 한계: 아래 출처는 검색 요약과 공개 문서 개요로 확인했다. 논문 원문 전체를 읽고 검증한 것은 아니다.

## 요약

- 「완전한 표현」은 절대 기준이 없다. 연구 쪽은 완전성을 두 가지로 나눠 잰다. 메타모델에 세계의 기본 구성 요소(사물, 속성, 상태, 사건, 결합)가 다 있는가(BWW 존재론적 완전성), 그리고 정해 둔 질문에 다 답할 수 있는가(역량 질문, Competency Questions)다.
- 팔란티어식 「필요할 때 만든다」는 두 번째만 본다. 지금의 「넓게 뽑고 거른다」는 첫 번째에 가깝다. 둘을 합치면 된다. 후보 전수 목록으로 빠짐을 막고, 질문 목록(위협 판정 규칙)으로 남길 것을 고른다.
- 결정론적 판정은 형식 존재론(OntoClean, BFO, UFO)의 검사 항목을 API 사실에 대응시키면 된다. 식별자가 있는가, 혼자 생기고 없어지는가, 둘 이상을 잇는 매개물인가, 인스턴스가 들어갔다 나올 수 있는 분류인가.
- 보안 의미는 권한 모델(Zanzibar, Cedar)이 기준을 준다. 권한 검사의 주체나 대상이 될 수 있으면 보안 대상이다. 권한 어휘(OAuth scope, 역할)와 감사 로그의 대상 필드에서 기계적으로 뽑을 수 있다.
- LLM은 문서에서 사실을 표준 양식으로 옮기는 데만 쓰고, 판정은 그 사실 위의 규칙으로 한다. 그러면 결정론과 SaaS 간 반복 적용을 같이 얻는다.

## 1. 완전성을 어떻게 재는가

### 1.1 메타모델 쪽: BWW 존재론적 완전성

Wand와 Weber가 Bunge의 존재론으로 만든 BWW 모델은 정보 시스템 모델링 언어를 평가하는 데 널리 쓰였다. 기준은 「모델링 언어가 BWW 구성 요소(thing, property, state, event, transformation, coupling 등)를 모두 표현할 수 있는가」다.

AEGI에 대입하면 다음을 점검할 수 있다.

| BWW 구성 요소 | AEGI에서 대응하는 것 | 점검 |
| --- | --- | --- |
| Thing | Object | 있음 |
| Property | Object 속성, interface 계약 필드 | 있음 |
| Coupling (사물 간 상호작용) | Relation, Link | 있음 |
| State, State law | 계정 상태, 설정값과 정책 | 상태를 속성으로 두는지, 별도로 두는지 정해야 함 |
| Event, Transformation | 감사 로그, 웹훅 | Object와 사건의 연결 방식이 규격에 있는지 확인 필요 |
| History | 시점별 관계와 상태 | 시간축 표현 범위 확인 필요 |

### 1.2 질문 쪽: 역량 질문

Grüninger와 Fox(1995)는 온톨로지가 답해야 할 질문 목록으로 범위를 정했다. NeOn 방법론과 테스트 주도 온톨로지 개발도 이 질문을 범위 결정과 검증 시험으로 쓴다.

AEGI에는 이미 질문 목록이 있다. 위협 판정 규칙과 Effective Access 질의가 그것이다. 판정식 하나하나가 「이 답을 내려면 어떤 Object, 속성, 관계가 있어야 하는가」로 바뀐다. 판정식이 참조하지 않는 후보는 지우지 않고 「질문 없음」으로 남긴다.

### 1.3 두 가지를 합친 완전성 점검

1. 후보 전수 판정: 4종 자료에서 뽑은 후보마다 판정 결과(Object, 속성, 관계, 사건, 제외와 사유, 모름)가 하나씩 있다.
2. 사건 대상 대응: 감사 로그와 웹훅의 모든 eventType에서 대상(target, resource) 종류가 Object 종류 하나에 대응한다.
3. 권한 어휘 대응: 모든 scope와 역할 이름에 등장하는 명사가 Object 종류 하나에 대응한다.
4. 질문 응답: 모든 위협 판정 규칙이 Object 카탈로그만으로 계산 가능하다.

1~3은 「SaaS를 빠짐없이 봤는가」, 4는 「필요한 것이 다 있는가」를 잰다.

## 2. 결정론적 판정 기준: 형식 존재론

### 2.1 OntoClean의 네 메타속성

Guarino와 Welty의 OntoClean은 분류 체계의 오류를 네 가지 메타속성으로 잡는다.

| 메타속성 | 뜻 | API 사실로 바꾸면 |
| --- | --- | --- |
| Identity (+I) | 인스턴스를 구별하는 기준이 있다 | 안정된 id 필드와 id로 조회하는 끝점이 있다 |
| Unity (+U) | 경계가 분명한 하나의 전체다 | 하나의 응답 객체로 나온다. 다른 객체 안의 조각이 아니다 |
| Rigidity (+R/~R) | 인스턴스가 그 분류에서 벗어날 수 없다 | 종류(type)는 바뀌지 않는다. 역할, 상태는 바뀐다 |
| Dependence (+D) | 다른 것이 있어야만 존재한다 | 부모 경로 아래에만 있고 부모와 함께 사라진다 |

OntoClean은 사람이 메타속성을 붙이는 비용이 커서 잘 안 쓰인다는 평가가 있다. AEGI는 이 값을 API 명세와 로그 카탈로그에서 기계적으로 읽을 수 있어서 그 약점을 피할 수 있다.

### 2.2 BFO: 지속하는 것과 일어나는 것

BFO는 최상위를 continuant(시간 속에 지속하며 변하는 것)와 occurrent(시간 속에 펼쳐지는 사건, 과정)로 나눈다. continuant는 다시 독립(사물)과 의존(속성, 역할, 성향)으로 나눈다. 역할(role)은 외부 상황 때문에 생기며, 잃어도 대상 자체는 변하지 않는다.

AEGI 적용:

- 계정, 저장소, 채널, 앱: 독립 continuant → Object
- 관리자 여부, 2FA 여부, 외부 공유 여부: 의존 continuant → 속성
- 「관리자」, 「게스트」: 역할 → 종류가 아니라 속성이나 관계
- 로그인, 권한 부여, 토큰 발급: occurrent → 사건. Object가 아니라 Object를 참조하는 기록

### 2.3 UFO/OntoUML: kind, role, phase, relator

UFO는 개념 모델링용 기초 존재론이고 OntoUML이 그 언어다. 핵심 구분은 다음과 같다.

- Kind: 식별 기준을 주는 종류. 예: 사용자 계정
- Phase: 내재 속성에 따라 들어가고 나오는 분류. 예: 정지된 계정
- Role: 관계 때문에 생기는 분류. 예: 저장소 관리자
- Relator: 둘 이상을 잇고 스스로 속성과 생애를 갖는 것. 예: 멤버십, OAuth 권한 부여, 앱 설치

보안에서 relator가 특히 중요하다. 위험은 대부분 계정 자체보다 「누가 무엇에 어떤 권한으로 묶였는가」에 있다.

UFO에서 material relation은 relator에서 파생된다. relator가 사실의 근거이고, 관계는 그 relator가 잇는 양끝을 읽은 결과다. 현재 aegi-schema가 이 구조에 가깝다(원격 main `6220163`, 2026-10-12 기준. `Relation_Schema_v3`, `Interface_Spec_v3`, `Profile_Schema_v4.2`).

- Assignment interface가 relator 자리다. 판별 기준은 속성 유무나 id 유무가 아니라 「이것만 지우면 권한만 사라지고 주체와 대상은 남는가」(독립 회수 가능성)다.
- Assignment Object(예: `ApplicationGrant`)는 관계의 끝점이 되지 않는다. Object 하나가 관계 하나이고, `slot`(source, role, target)으로 3항 `has_role_on`이 된다. 배정 레코드의 만료, 부여자, 부여 시각은 펴진 관계 행에 복사된다.
- 관계에 붙는 조건(`grant_option`, `granted_by`, 범위)과 효력(`effect`, `end`, `condition`)은 Object로 승격하지 않고 Relation의 `qualifiers`, `validity`, `properties`에 둔다.

그래서 「관계에 데이터가 있으면 Object로 승격」은 현재 규격의 규칙이 아니다. 승격 기준은 독립 회수 가능성이다.

### 2.4 Tenant 문제

메모에서 애매하다고 한 Tenant(organization, enterprise, workspace)는 위 기준으로 다음과 같다.

- 식별자가 있다(+I), 독립 생애가 있다(-D) → Object
- 다른 Object를 담는 범위이고, 정책이 걸리는 대상이다 → Zanzibar의 namespace나 Cedar의 계층 엔터티처럼 「범위」 역할
- group은 다르다. 구성원이 바뀌어도 같은 것으로 남는 집합(UFO의 collective)이고, 권한을 받는 주체다. Tenant와 같은 interface로 묶지 않는 편이 맞다

## 3. 보안 의미 기준: 권한 모델

### 3.1 Zanzibar와 Cedar

- Zanzibar는 모든 권한을 `namespace:object#relation@user` 튜플로 저장한다. namespace 설정이 「이 종류의 대상에 어떤 관계가 가능한가」를 정한다. 파생 권한은 저장하지 않고 userset rewrite 규칙으로 계산한다.
- Cedar는 스키마에서 엔터티 종류, 속성, 허용되는 (principal, action, resource) 조합을 선언한다. 엔터티는 `Type::"id"` 형식이고 계층을 가진다.

공통점: 권한 검사의 주체(principal)나 대상(resource)이 될 수 있는 것이 Object 종류다. 이 규칙은 결정론적이다.

AEGI 적용:

- 권한 어휘 카탈로그(OAuth scope, 역할 권한 목록)에서 대상 명사를 뽑는다. 예: Slack `channels:read`의 channel, GitHub `repo`, Google `drive.file`
- 감사 로그의 actor, target 필드에 나오는 종류를 뽑는다
- 두 목록에 나온 종류는 보안 대상으로 확정한다. 나머지 후보는 「보안 근거 없음」으로 남긴다

Zanzibar의 「파생 권한은 계산한다」는 AEGI의 Relation과 Effective Access 분리와 같은 방향이다.

### 3.2 보안 분야의 기존 모델

| 모델 | Object 정하는 방식 | AEGI에 주는 것 |
| --- | --- | --- |
| OCSF | 엔터티(Object: User, Device, Process 등)와 사건(Event class)을 분리. 사건이 엔터티를 actor, target으로 참조. Profile로 속성을 덧붙임 | 사건과 Object의 분리, actor/target 고정 필드 |
| MITRE D3FEND | 공격 기법과 방어 기법을 같은 Digital Artifact(파일, 프로세스, 네트워크 트래픽 등)에 묶어 추론 | 「공격 판정과 방어 판정이 모두 참조하는 것」이 핵심 Object라는 기준 |
| BloodHound OpenGraph | 확장마다 JSON 스키마로 노드, 간선 종류와 간선의 traversable 여부를 선언. GitHub, Okta 확장이 기본 포함 | 간선마다 「공격 경로로 넘어갈 수 있는가」를 선언하는 방식 |
| Microsoft Exposure Graph | 노드(장치, 신원, 그룹, 클라우드 자산)와 간선(contains, routes traffic to 등)을 범주 배열로 분류 | 하나의 노드가 여러 범주를 갖는 다중 분류 |
| Cartography | provider 노드에 의미 이름표를 붙임 | 기존 비교 문서 [cartography-ontology-comparison.md](cartography-ontology-comparison.md) 참고 |

## 4. 사건에서 Object를 뽑는 방식: OCEL 2.0

프로세스 마이닝 표준 OCEL 2.0은 이벤트 로그를 사건, Object, 사건 종류, Object 종류, 속성, 관계로 나눈다. 관계는 두 가지다.

- E2O: 사건이 어떤 Object에 어떤 자격(qualifier)으로 관여했는가
- O2O: Object 사이의 관계와 그 자격

Object 속성의 시점별 변화도 담는다. AEGI의 감사 로그 카탈로그와 웹훅 카탈로그는 이 구조로 그대로 옮길 수 있다. eventType마다 「관여하는 Object 종류와 자격」을 적으면, 1.3의 사건 대상 대응 점검이 자동으로 된다.

## 5. 복잡계 관점에서 본 것

- 복잡성은 Object 개수보다 결합(coupling)에서 나온다. SaaS 환경에서 결합 지점은 SSO 연동, OAuth 권한 부여, 앱 설치, 토큰, 웹훅, 외부 공유다. 이들이 대부분 2.3의 relator다. relator를 빠뜨리면 SaaS 간 위협을 볼 수 없다.
- SaaS마다 층을 두고 신원 연결을 층 사이 간선으로 보는 다층 네트워크 구조가 맞는다. 층 사이 간선의 확실성을 따로 다루는 것은 AEGI Link 규격과 같은 방향이다.
- 창발 성질(실제 접근 가능 범위)은 저장하지 않고 계산한다. Zanzibar의 rewrite 규칙, AEGI의 Effective Access가 같은 원리다.
- 범주론 기반 olog(Spivak, Kent)는 서로 다른 모델을 함수자(functor)로 비교하고 용어 번역을 자동으로 만든다. SaaS별 카탈로그를 공통 interface로 옮기는 일을 수학적으로 다루는 틀이다. 당장 쓰기보다는 「SaaS별 모델에서 공통 모델로 가는 사상이 구조를 보존하는가」를 점검하는 관점으로 참고할 만하다.

## 6. 제안: 결정론적 판정 절차

LLM은 문서를 아래 사실 항목으로 옮기는 추출만 한다. 판정은 규칙이 한다.

추출할 사실(후보 하나당):

- id 필드 유무, id 조회 끝점 유무
- 생성, 삭제 끝점이나 생성, 삭제 사건 유무
- 부모 경로 (예: `/orgs/{org}/repos/{repo}`)
- 다른 후보 두 개 이상을 참조하는 필드 유무
- 값이 바뀌는 열거형 필드 (상태, 역할)
- 권한 어휘에 등장하는지, 감사 로그 actor/target에 등장하는지

판정 규칙(순서대로):

| 단계 | 질문 | 아니오 | 예 |
| --- | --- | --- | --- |
| 1 | 안정된 식별자나 복합키가 있는가 (Slack 앱 설치는 id 없이 `app_id, team_id` 복합키) | 속성이나 값 | 2로 |
| 2 | 주체와 권한을 잇고, 이것만 지우면 권한만 사라지는가 (Assignment 판별 기준) | 3으로. 조건과 효력은 Relation의 `qualifiers`, `validity`에 | Assignment Object |
| 3 | 부모 없이 생기고 없어지는가 | 부모의 부분 Object 또는 속성 | 독립 Object |
| 4 | 이 분류에 인스턴스가 들어갔다 나올 수 있는가 | 종류로 확정 | 종류가 아니라 상태, 역할 속성 |
| 5 | 권한 어휘나 감사 로그 actor/target에 나오는가 | 카탈로그에 남기고 「보안 근거 없음」 | 보안 대상 |
| 6 | interface 9종 중 계약을 만족하는 것이 있는가 | 「interface 없음」으로 기록 | interface 부여 |

5와 6은 판정이 아니라 표시다. 지우지 않고 남겨서 나중에 새 판정식이 생기면 다시 쓴다.

## 7. 남은 질문

- 1.1 표의 State, Event, History를 현재 aegi-schema가 어디까지 다루는지 원문으로 확인해야 한다.
- 단계 3의 「부분 Object」(예: 저장소의 브랜치 보호 규칙)를 독립 Object로 둘지, 부모의 속성 묶음으로 둘지 정해야 한다.
- 단계 5에서 권한 어휘 명사와 API 리소스 이름이 다를 때(예: Google scope와 Drive API 리소스) 대응 규칙이 필요하다.

## 출처

- Palantir Foundry: [Core concepts](https://www.palantir.com/docs/foundry/ontology/core-concepts), [Interfaces](https://palantir.com/docs/foundry/interfaces), [Link types](https://palantir.com/docs/foundry/object-link-types/link-types-overview/)
- BWW: [Fettke, 존재론적 완전성 평가](https://komponenten.cs.uni-magdeburg.de/docs/wcem/fettke.pdf), [Ontological analysis of BPM](https://arxiv.org/pdf/1905.00499)
- 역량 질문: [Types of Competency Questions](https://arxiv.org/pdf/2412.13688), [Toronto EIL Enterprise Modelling Methodology](https://eil.mie.utoronto.ca/theory/enterprise-modelling/entmethod)
- OntoClean: [AEON 자동 평가](https://www.aifb.kit.edu/images/archive/7/73/20090816102959%212008_1692_V%C3%B6lker_AEON_-_An_Appro_1.pdf), [Engineering Conceptual Data Models from Domain Ontologies](https://arxiv.org/pdf/cs/0601119)
- BFO: [Common Core Ontologies](https://arxiv.org/pdf/2404.17758), [Dispositions and Roles of Generically Dependent Entities](https://arxiv.org/html/2506.17085v1)
- UFO/OntoUML: [Guizzardi 자료](https://kizi.vse.cz/wp-content/uploads/old/guizzardi.pdf), [Types and taxonomic structures in conceptual modeling](https://research.utwente.nl/en/publications/types-and-taxonomic-structures-in-conceptual-modeling-a-novel-ont/)
- Zanzibar: [논문 PDF](https://pdos-csail-mit-edu.ezproxy.canberra.edu.au/6.824/papers/zanzibar.pdf), [Reading Zanzibar](https://macwright.com/2025/05/02/reading-zanzibar)
- Cedar: [Verified Permissions와 Cedar 용어](https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/terminology-differences-avp-cedar.html)
- OCSF: [Understanding OCSF](https://github.com/ocsf/ocsf-docs/blob/main/overview/understanding-ocsf.md)
- D3FEND: [Taxonomies](https://d3fend.mitre.org/taxonomies)
- BloodHound OpenGraph: [Graph definition](https://bloodhound.specterops.io/opengraph/developer/graph-definition), [Schema](https://bloodhound.specterops.io/opengraph/schema)
- Microsoft Exposure Graph: [ExposureGraphNodes](https://learn.microsoft.com/en-us/defender-xdr/advanced-hunting-exposuregraphnodes-table), [ExposureGraphEdges](https://learn.microsoft.com/en-us/defender-xdr/advanced-hunting-exposuregraphedges-table)
- OCEL 2.0: [Specification](https://arxiv.org/pdf/2403.01975)
- OpenAPI에서 리소스 추론: [CRUDinfer (ICSE 2026)](https://conf.researchr.org/details/icse-2026/icse-2026-research-track/298/CRUDinfer-Automated-CRUD-Semantics-Inference-for-REST-APIs-Through-Black-box-Testing)
- Ologs: [Spivak, Kent](https://arxiv.org/abs/1102.1889)
