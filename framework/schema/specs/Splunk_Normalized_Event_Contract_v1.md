# Splunk 정규 이벤트 계약 v1

이 문서는 Splunk에서 받은 감사 이벤트의 공통 의미를 정한다. Adapter Engine이 수집·정규화하며 Dashboard는 이 결과를 읽는다. 감사 이벤트는 Schema의 새 Object나 Relation이 아니다.

사건의 공통 모양은 [Activity_Schema_v1](Activity_Schema_v1.md)(사건 기록 Activity)이 정한다. 이 계약의 정규 이벤트는 Activity 의 한 표현이고, 겹치는 칸(`outcome`, `matched_on`, `unmatched`, `aegi_self` 등)은 두 문서에서 같은 이름, 같은 뜻이다. 칸 대응은 그 문서 「기존 Splunk 계약과의 관계」에 있다. SaaS 마다 다른 사건의 행위, 효과, 원본 칸 위치는 사건 사전 [`../ontology/activity_types.yaml`](../ontology/activity_types.yaml)에 모은다(2026-11-11).

## 안정적인 필드

- `event_type`은 `provider:source_action` 또는 원본의 정규 event type이며 검색, 상관 분석, CSV 내보내기에서 바꾸지 않는다.
- `title`은 화면에 표시할 한국어 행위 이름이다. 이름 사전에 항목이 없으면 `event_type`의 원본 행위 이름을 쓴다. 대상 문서명 같은 원본 데이터는 제목에 합치지 않는다.
- `outcome`은 `success`, `failure`, `unknown` 중 하나다. 근거가 없는 경우 `unknown`을 유지한다. 실패 사유는 짧은 `outcome_reason`에 기록한다.
- `signal`은 결과와 독립적인 단일 관측 신호 또는 `null`이다. 신호는 `{kind, source, value}`이며 `kind`는 `suspicious`처럼 계약된 분류를 쓴다. 원본 근거가 없으면 신호를 만들지 않는다.
- `category`는 기존 이벤트 분류 어휘를 사용한다. 조회·검색·조사 행위를 계정 또는 그룹 변경으로 분류하지 않는다.
- `targets`는 자원 식별자, 자원 종류, 표시 이름과 그래프 객체 키를 분리한다. 비밀값과 원문 전체를 포함하지 않는다.
- `mapping_version`은 재처리 호환성에 쓰며, 표시 이름이나 원본 이벤트 식별자의 대체값이 아니다.

## 그래프와 같았던 값 (2026-11-02)

이벤트와 그래프 객체·관계가 **같다는 사실만** 적는다. 그 뜻은 읽는 사람과 AI가 판단한다. 숫자 신뢰도는 쓰지 않는다([Link_Schema_v3](Link_Schema_v3.md) 「숫자 신뢰도를 쓰지 않는다」).

- 행위자와 대상의 `matched_on`은 그래프 객체 키를 찾을 때 같았던 원본 칸(`event_field`), 객체 식별자 칸(`identifier`), 비교 방법(`same`: `exact`, `casefold`. [crosswalk](../ontology/crosswalk.yaml) `same`)이다. 식별자 칸이 바뀔 수 있는 값(login, email 등)이면 그 사실이 그대로 보인다.
- `relation_matches`는 이벤트에서 찾은 객체 둘이 그래프 관계 하나의 출발과 도착과 같았다는 사실이다. 관계 id, 종류, 두 끝이 이벤트의 어느 칸(행위자, 대상 n)이었는지, 관계 role 객체도 이벤트에 있었으면 그 칸을 적는다. 이벤트가 그 관계를 만들었다, 지웠다, 썼다는 판단이 아니다. 한쪽 끝만 같은 것은 적지 않는다. 그래프 이웃 정보와 같기 때문이다.
- 맞는 관계가 없다는 것은 관계가 없다는 뜻이 아니다. 로그에 연결이 없다고 연결이 없다고 보지 않는다는 판정 규칙과 같다. 관계 일치는 Relation 행을 새로 만들지 않는다.
- `matched_snapshot`은 대조한 그래프 스냅샷과 그 데이터셋을 만든 시각이다. 그 뒤에 생기거나 지워진 관계는 대조에 없다.
- 대상은 원본에 있는 id(또는 그 종류의 식별자 칸)로만 찾는다. Salesforce 는 Display 문장 안의 사용자 id(005로 시작하는 15·18자), Confluence 그룹은 이름 안의 그룹 UUID와 「UUID; User: 계정 id」의 계정 id, Jira 그룹은 그룹 객체의 `name` 식별자, Jira 구성원 변경은 `changedValues` Users 의 전후 차이(칸 이름 `changedTo`·`changedFrom`으로 추가·제거가 보인다), GWS 토큰은 사용자 profileId 와 client_id 의 복합 primary(`u|c`), GitHub 웹훅은 `hook_id` 다. 표시 이름이나 Label 로는 찾지 않는다(2026-11-02).
- 이름으로 찾는 것은 종류를 정한 경우만이고, 같은 이름을 가진 객체가 둘 이상이면 찾지 않는다. Jira 그룹 `name`, Salesforce 권한 집합 `Label`(Action 이 권한 집합인 Display 문장), Flow `ApiName`(「고유 이름」)이 그렇다. 이 경우 `matched_on.identifier` 가 `name`·`Label`·`ApiName` 이라 id 일치와 구분된다. 정해 둔 문장 모양에 맞지 않는 Display(다른 언어 포함)는 대상을 만들지 않는다.
- 행위자·대상에 객체가 없으면 `unmatched` 에 이유를 적는다. `not_in_graph`: 식별자로 찾았지만 대조한 스냅샷에 그 값을 가진 객체가 없다. `ambiguous`: 그 종류 안에서 둘 이상의 객체가 같은 값을 가져 고르지 않았다. `name_only`: 원본에 이름만 있어 찾지 않았다. 어느 것도 객체가 없다는 뜻이 아니다. 그래프를 받지 못했으면 이유를 적지 않는다.
- `attributes.aegi_self` 는 AEGI 수집기 자신의 크레덴셜이 남긴 활동이다. 기준은 환경 registry 크레덴셜의 `identifiers`(GWS 는 CRED-GW-01 의 `gws_dwd_client_id`)이고 커넥터 환경 변수 `AEGI_GWS_SELF_CLIENT_IDS` 로 넘긴다. 같은 모양의 다른 client(예: 다른 SaaS 의 도메인 위임 커넥터)는 표시하지 않는다. 화면은 기본으로 숨기고 건수를 보이며, AI 근거에는 숨기지 않고 표시만 한다.
- 관계 경로를 따라 두 이벤트를 잇는 규칙은 [경로 규칙 형식](Path_Rule_Schema_v1.md) 「event 규칙의 모양」이 따로 정한다. 이 사실은 그 규칙의 입력이 될 수 있다.

로그인 이벤트의 성공·실패는 공급자 원본 결과에 근거해 매핑한다. 차단된 의심 로그인은 실패 결과와 의심 신호를 모두 가질 수 있다. 성공 로그인에 원본 의심 표시가 있으면 성공 결과를 유지하면서 의심 신호를 추가한다.

## 표시 이름 사전

기계 판독 가능한 사전은 [`../catalog/splunk-event-labels-v1.json`](../catalog/splunk-event-labels-v1.json)이다. 키는 `provider|event_type`이며 원본 키를 변경하지 않는다. 사전 항목은 검토된 한국어 행위 이름이고, 등록되지 않은 이벤트는 원본 행위 이름으로 표시한다. 항목별 `source`는 공식 공급자 문서를 가리킨다.

이 계약은 감사 이벤트의 소비자 간 의미만 정의한다. 수집 범위, D1 게시와 보존은 Adapter Engine의 운영 명세를 따른다.
