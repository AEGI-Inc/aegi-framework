# IR 설계 (2026-10-15)

## 요약

- IR은 Information Map의 재료다. 그래서 「Information Map을 만드는 공통 규칙이 무엇을 읽는가」에서 거꾸로 정했다(2절). 규칙이 읽는 사실만 IR에 두고, 규칙이 내리는 판단(공간, 매핑)은 IR에 두지 않는다.
- 지금 IR은 「동작별 응답 자리 목록」이다. 공통인 것은 자리뿐이고, 키, 참조, 다형, 근거 등급은 provider마다 다른 키로 흩어져 있거나 사전과 규칙 코드 안에 있다(5절).
- 새 IR은 사실 단위의 개체 11종이다: 출처, 동작, 모양, 키 선언, ID 형식, 참조 선언, 파라미터 바인딩, 카탈로그 항목, 권한 어휘, 인스턴스, 구멍(3절). 모든 사실에 출처, 위치, 근거 등급, 수명 상태가 붙는다.
- 변환기는 SaaS마다 다르지만 출력은 이 11종뿐이다. 원문에 없는 것을 변환기가 만들면 등급이 「변환 추론」이고, 사람이 정한 것은 「사전」이다. 규칙은 등급을 보고 쓸지 정한다.

## 1. 범위와 수명 (2026-10-15 결정)

| SaaS | 범위 |
| --- | --- |
| GitHub | 테스트 환경 기준: GitHub Enterprise Cloud(github.com 호스팅, 엔터프라이즈 계정, SAML). GHEC REST, GHEC GraphQL, 웹훅, 감사 로그. GHES 전용은 뺀다 |
| Salesforce | Object Reference 전체, REST, Platform Events, CDC, EventLogFile, Metadata API |
| Okta | Management, OAuth, IdP, Identity Governance 포함 |
| Google Workspace | 받은 Discovery 11종 전부. 나중에 덜어낸다 |
| Slack | Web API, Enterprise Grid 관리 API, SCIM, 감사 API 전부 |
| Jira, Confluence | Jira 전체(Service Management 포함), Confluence v1과 v2 둘 다. v1과 v2가 같은 대상을 다른 동작으로 다루는 중복을 표시해 둔다 |
| 공통 | 아직 쓸 수 있으면 deprecated여도 넣는다. 쓸 수 없으면(제거됨, 종료일 지남) 뺀다 |

수명 상태: `active`, `deprecated`(쓸 수 있음, 종료일이 있으면 기록), `removed`(뺀다). 판정 근거는 원문 표시(`deprecated: true`, 종료 공지와 날짜)이고, 출처를 남긴다.

자료 순위: 1 API 스키마, 2 API 문서, 3 로그와 이벤트 문서, 4 테넌트 자료(실측). 순위는 같은 사실을 두 자료가 다르게 말할 때 쓰는 규칙이다(4.3).

## 2. 역설계: 규칙이 읽는 사실

Information Map의 산출물과 그것을 만드는 공통 규칙, 그 규칙이 IR에서 읽어야 하는 사실이다.

| 산출물 | 공통 규칙 | IR에 있어야 하는 사실 |
| --- | --- | --- |
| 레코드 | 키가 있는 객체 모양의 출현 | 모양(객체, 속성 목록), 키 선언(어느 속성, 전역인지 부모 안인지 조합인지) |
| ID 공간 (동치류) | 단건 왕복: 경로 위치의 값으로 조회하면 그 모양이 돌아온다 | 동작의 종류(단건 조회, 목록, 생성, 수정, 삭제, 동작), 경로 템플릿과 파라미터 위치, 응답 모양 |
| | 목록 왕복: 컬렉션 목록의 원소가 단건 위치의 모양이다 | 위와 같음, 응답 안 원소 위치 |
| | 같은 모양: 이름이 다른 같은 모양 | 모양별 속성(이름, 타입) 집합. 다형 대안끼리 섞이지 않아야 한다 |
| | 다형: 「A 또는 B」 | 대안 목록, 판별자(속성, 값 표), 대안이 하위 유형인지 서로 다른 대상인지(원문에 있으면) |
| | ID 형식: 값 모양이 공간을 말한다 | ID 형식(패턴, 접두사, 인코딩, 자원 이름 템플릿)과 그 형식이 붙은 자리 |
| | 명시 바인딩: 파라미터가 어떤 키의 값을 받는다 | 바인딩(OpenAPI links, GraphQL 인자 타입 등 원문에 있을 때만) |
| | 사전: 사람이 정한 같음 | 사전 사실(출처는 사전 파일, 이유) |
| | 반대 근거: 타입이 다르면 합치지 않는다 | 인스턴스에서 해독한 타입(node_id), 키 값 |
| 범위 안 공간, 조합 공간 (ID × ID) | 부모 위치 아래의 단건 위치, 두 대상을 가리키고 자기 키가 없는 모양 | 파라미터 위치의 순서, 참조 선언, 키 선언의 꼴(조합이면 구성 요소) |
| 정보 항목 | 값 자리를 가장 가까운 바깥 레코드의 공간에 매핑 | 모양 안 속성 경로, 모양이 나오는 용기(동작 응답, 이벤트 payload, 감사 레코드) |
| 참조 간선 | 레코드 안의 다른 공간 레코드, 참조 필드 | 참조 선언(대상 모양, 대상 ID 형식, 다형) |
| 쓰기 짝 | 요청 본문 경로 = 응답 경로 | 요청 모양, 쓰기 전용 표시, 동작 대상 |
| 필터 | 조회 동작의 질의 인자가 응답 항목을 거른다 | 질의 인자(이름, 타입, 값 목록), 인자 바인딩이 있으면 그것 |
| 감사 연결 | 감사 action의 대상 공간 | 카탈로그 항목(기계 키, 표시 이름, 범주, 대상 선언, 필드 모양) |
| 권한 | 동작별 필요 권한 | 권한 어휘와 동작 바인딩 |
| 출처와 신뢰 | 모든 판단에 근거 등급 | 모든 사실의 출처, 위치, 등급, 판, 수명 |

## 3. IR 개체

파일 하나에 개체 종류 하나다(`ir/<종류>.jsonl`). 모든 행은 공통 머리를 가진다.

```
id        provider 안에서 유일한 사실 ID
src       {source, locator, rank(1~4), snapshot}
grade     stated | transform | example | curated | observed
life      {state: active|deprecated, sunset?}
ext       {}   provider 고유 정보. 규칙은 읽지 않는다
```

`grade`: stated는 원문이 직접 말함, transform은 원문의 일반 규칙을 변환기가 펼침(Salesforce 「모든 sObject는 /sobjects/{객체}/{Id}」), example은 문서 예시에서 나옴, curated는 사람이 정함, observed는 테넌트 실측.

### 3.1 source

수집 단계의 기록. `id, kind(api_schema|api_doc|log_doc|event_doc|tenant), rank, url, fetched_at, sha256, version, naming(rest_json|graphql|soql|...)`. `naming`은 이름 비교를 같은 명명 체계 안으로 묶는 데 쓴다.

### 3.2 operation

```
surface    rest | rpc | graphql | scim
name       원문 이름 (operationId, 메서드 이름, 필드 이름)
method     GET|POST|... (rpc는 원문 표시가 없으면 null)
kind       read_one | read_many | create | update | delete | action | search  + kind_grade
path       {template: "orgs/{org}/teams/{team_slug}", positions: [{param, index, after_word}]}
params     [{name, in(path|query|header|body), shape, required, enum?}]
request    모양 ID
responses  [{status, media, shape}]
grants     [권한 어휘 ID]
```

- `kind`는 원문이 말하면 stated(GraphQL query와 mutation, Discovery의 메서드 이름 규약은 transform), REST에서 메서드와 경로 끝으로 정하면 transform.
- 본문 인자는 `request` 모양에만 둔다. `params`에 다시 쓰지 않는다.
- rpc는 `path`가 없다. 대신 바인딩과 ID 형식이 위치 역할을 한다.

### 3.3 shape (모양)

```
name       원문 스키마 이름. 인라인이면 null
origin     named | inline | example_derived
kind       object | array | union | map | scalar
props      [{name, shape|scalar, format, enum, required, read_only, write_only, nullable}]
items      배열 원소 모양
alts       union 대안 모양 목록
discriminator {prop, map: {값: 모양}}  원문에 있을 때만
alt_kind   subtype | distinct | unknown   원문에 있을 때만 (GraphQL union은 distinct, interface는 구현 타입)
```

- 인라인 모양의 ID는 첫 출현 위치(용기, 경로)로 만든다. 구조가 같은지는 규칙이 지문으로 본다(IR이 합치지 않는다).
- anyOf, oneOf 대안은 `union`으로 남긴다. 대안 속성을 한 경로에 펼치지 않는다. 자리 목록(지금의 fields)은 규칙 단계에서 모양을 펼쳐 만든다. 그래야 다형 자리의 node_id를 어느 대안의 것인지 안다.
- allOf는 합쳐 하나의 모양으로 두고 `ext.allOf`에 구성 요소를 남긴다.

### 3.4 key_decl (키 선언)

```
shape      모양 ID
props      ["id"] 또는 조합 ["channel", "ts"]
form       global | local(부모 모양) | composite
evidence   원문 근거: "sObject 필드 타입 id", "GraphQL ID! + Node", "Slack defs_*_id", "Discovery 응답 키" ...
```

- 원문이 말하는 키(Salesforce `id` 타입, GraphQL `id: ID!`와 Node 구현, Okta `kid` 의 RFC 근거)는 stated.
- 이름 규약으로 정한 키(`id` 라는 이름의 문자열 속성)는 curated이고 사전 파일에 규약과 이유를 쓴다. 지금 `record_key_fields`가 이 자리로 옮겨 온다.

### 3.5 id_format

```
name       defs_user_id, github_node_id, gcp_resource_name ...
match      {pattern?, prefixes?, encoding?(base64_typed|msgpack_prefixed), template?}
decodes    [type, db_id]   값에서 꺼낼 수 있는 것
applies    [{shape, prop}] 또는 [{param}]   이 형식이 붙은 자리
```

Slack `defs_*` 패턴과 접두사, GitHub node_id, Google 자원 이름 템플릿, Salesforce 3자리 접두사(테넌트 describe에서 오면 observed).

### 3.6 ref_decl (참조 선언)

```
from       {shape, prop}
to         {shapes: [...]} | {id_format} | {key_decl}
poly       true | false
```

원문 근거: Salesforce Refers To, OpenAPI `$ref`로 들어온 키 있는 모양(그 자체가 레코드 출현이라 따로 쓰지 않는다), Slack 정의 참조 필드, GraphQL 필드 타입, Okta 이벤트 targets.

### 3.7 binding (파라미터 바인딩)

`{operation, param, to: {key_decl | id_format | shape.prop}}`. 원문에 있을 때만 stated(OpenAPI links, GraphQL 인자 타입 `ID!`와 대상, Slack 인자 정의 참조). 왕복으로 얻는 바인딩은 IR에 쓰지 않는다. 규칙이 만든다.

### 3.8 catalog (감사, 이벤트, 로그 유형)

```
catalog    audit | event | log_type
key        기계 키 (없으면 null)
display    표시 이름
category   원문 범주 그대로
payload    모양 ID (필드 목록만 있으면 example_derived 모양)
targets    [{shape | type_name, role}]   원문이 대상을 말할 때만 (Okta targets, GitHub 필드 이름 목록은 아님)
```

- 기계 키가 없고 표시 이름만 있으면(Atlassian) `key: null`. 테넌트 자료(4순위)가 오면 같은 항목에 observed 키를 붙인다.
- 지금의 가짜 동작 `audit:<필드 이름>`은 없앤다. 감사 필드는 payload 모양의 속성이다.

### 3.9 grant (권한 어휘)

`{kind(oauth_scope|app_permission|role|privilege), name, operations: [...]}`. 지금 `grant_vocab`과 같다.

### 3.10 instance (예시와 실측 값)

```
of         {operation, status} | {shape} | {catalog}
value      JSON 원문 그대로 (객체 단위)
```

- 예시를 자리별 값 목록으로 쪼개지 않는다. 한 객체 안의 `id`와 `node_id`, 요청 경로 값과 응답 키 값을 짝지어 보려면 객체 단위여야 한다(반대 근거, 예시 공출현, 예시 왕복).
- 문서 예시는 example, 테넌트 응답은 observed. 같은 개체다.

### 3.11 hole (구멍)

모양을 알 수 없는 곳: `open_map`, `object_no_props`, `doc_only_example`, `pdf_table_unparsed` 등. 위치와 이유. 완성도 계산에 쓴다.

## 4. 정규화 규칙

### 4.1 변환기가 지킬 것

1. 출력은 3절 개체뿐이다. provider 고유 정보는 `ext`에만 둔다.
2. 이름은 원문 그대로 둔다. 대소문자, 복수형, 접사를 바꾸지 않는다.
3. 원문이 말하지 않은 것을 만들면 `grade: transform`이고, 근거가 된 원문 규칙을 `src.locator`에 쓴다.
4. union을 펼치지 않는다. 예시를 쪼개지 않는다.
5. 판단을 쓰지 않는다. 공간, 공간 이름, 매핑, 감사 대상 공간은 IR에 없다.
6. 사전(lexicon)에 있는 사실도 IR 개체로 낸다(`grade: curated`). 규칙 코드가 사전을 직접 읽지 않게 한다. 사전에 남는 것은 변환 설정(자료 위치, 경로 접두사 벗기기, 래퍼 이름)뿐이다.

### 4.2 검증기 (정규화 끝 게이트)

| 검사 | 내용 |
| --- | --- |
| 참조 무결성 | 모든 모양, 키 선언, ID 형식 참조가 있다 |
| 머리 | 모든 행에 src, grade, life가 있다 |
| union 보존 | 대안을 가진 원문 스키마가 union 모양으로 남았다 |
| 이름 보존 | 모양과 속성 이름이 원문과 같다(표본 대조) |
| 수명 | removed가 출력에 없다 |
| 완성도 보고 | 응답 모양 없는 동작, 키 선언 없는 레코드형 모양, 기계 키 없는 카탈로그, 대상 선언 없는 감사 항목, 구멍 수 |

완성도 보고가 「수집이 끝났는가」의 판정 근거다. 빈 곳이 테넌트 자료(4순위)로 메울 목록이 된다.

### 4.3 자료가 겹칠 때

같은 사실(같은 동작의 응답 모양, 같은 감사 키)을 두 출처가 말하면 둘 다 남기고, 규칙이 순위와 등급으로 고른다. 출처 순위가 높아도 판이 오래되었으면(Slack 구판 OpenAPI) 검증기가 어긋남을 보고한다. 덮어쓰지 않는다.

## 5. 원문 형식별 채우는 법

| 원문 | 모양 | 키 | ID 형식 | 참조 | 동작 종류 | 카탈로그 |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAPI (GitHub, Okta, Jira, Confluence, Atlassian) | components, 인라인 | 이름 규약(curated), Okta `kid` | pattern 있으면 | `$ref` 레코드 출현 | transform | 웹훅 절 |
| Discovery (Google) | schemas | 이름 규약, 「대상 + Id」, 자원 이름 | 자원 이름 템플릿 | `$ref` | 메서드 이름 규약 transform | 없음 |
| GraphQL SDL (GitHub) | type, interface, union | `ID!` + Node (stated) | node_id (stated) | 필드 타입 (stated) | query, mutation (stated) | 없음 |
| PDF 필드 표 (Salesforce) | sObject | 필드 타입 `id` (stated) | 접두사(observed) | Refers To (stated) | REST 일반 규칙 transform | EventLogFile, Platform Events |
| 문서와 예시 (Slack) | 예시에서 (example_derived), 구판 OpenAPI | ID 정의 | `defs_*` 패턴 (stated) | 정의 참조 | 메서드 이름 (rpc) | 감사 문서, Events API |
| 이벤트 JSON (Okta) | targets 스키마 | | | targets (stated) | | System Log 유형 |
| 표시 이름 목록 (Atlassian 감사) | | | | | | key null |
| 테넌트 응답 (4순위) | instance | | 접두사, describe | 값 공출현 | | 기계 키 |

## 6. 지금 IR과의 차이

| 지금 | 새 IR |
| --- | --- |
| `fields` 한 행 = (동작, 쪽, 경로) 자리. 모양은 펼친 결과로만 있다 | `shape`가 1급. 자리는 규칙 단계에서 펼친다 |
| anyOf 대안의 속성이 한 경로에 섞인다 | `union` 모양으로 남는다 |
| 예시가 `example`, `examples`, `samples`, `from_example`으로 흩어지고 자리별로 쪼개진다 | `instance` 하나, 객체 단위 |
| 참조가 `ref_def`, `ref_targets`, 스키마 이름으로 흩어진다 | `ref_decl` 하나 |
| 키가 사전 `record_key_fields`, `record_key_named_id`, `local_key_fields` | `key_decl` (stated 또는 curated) |
| ID 형식이 Slack `id_defs`와 v2 코드의 node_id 해독 | `id_format` |
| 경로 위치를 v2가 경로 문자열에서 다시 파싱 | `operation.path.positions` |
| 본문 인자가 `params`와 `fields(request)` 두 곳 | `request` 모양 한 곳 |
| 감사 필드가 가짜 동작 `audit:<이름>` | 카탈로그 payload 모양 |
| 출처 위치와 등급이 일부만 | 모든 행에 src, grade, life |
| 변환기가 만든 Salesforce 경로가 원문 경로와 같은 모양 | `grade: transform` |

## 7. 옮기는 순서 (제안)

1. 3절 개체의 JSON 스키마와 검증기(4.2)를 먼저 만든다.
2. GitHub, Okta 변환기를 새 IR로 옮긴다. OpenAPI와 SDL이 개체 대부분을 채워 형식 검증에 좋다.
3. v2 규칙이 새 IR을 읽게 바꾼다. 같은 결과가 나오는지 지금 v2 출력과 대조한다.
4. Slack(예시와 ID 정의), Salesforce(PDF, transform 경로), Google(Discovery), Atlassian 세 provider 순으로 옮긴다.
5. 사전의 판단성 항목(키 규약, param_space, 감사 별칭)을 curated 개체로 옮기고 규칙에서 사전 읽기를 지운다.

## 8. 세 단계의 되먹임

수집, 정규화, Information Map 만들기는 한 방향으로 끝나지 않는다. 뒤 단계에서 생긴 문제마다 「앞 단계에 무엇이 있었으면 풀렸나」를 적고, 그 앞 단계의 할 일로 돌려보낸다.

문제 기록 형식(`issues.jsonl`, 단계마다 하나):

```
stage      collect | normalize | map
kind       문제 종류
subject    대상 (동작, 모양, 카탈로그 항목, 공간)
needs      {stage: collect|normalize, fact: IR 개체 종류 또는 자료 종류, detail}
evidence   근거 (경로, 값, 간선)
```

문제 종류와 거슬러 올라가는 곳:

| 단계 | 문제 | 필요한 앞 단계 사실 | 돌려보낼 곳 |
| --- | --- | --- | --- |
| map | 경로 단독 공간 (응답이 없어 키를 모름) | 그 동작의 응답 모양 | 정규화(모양 파싱 실패) 또는 수집(응답 스키마가 있는 자료) |
| map | 단건 조회는 있는데 돌려준 레코드에 키가 없다 | key_decl | 정규화(원문 키 근거) 또는 사전 |
| map | 인라인 레코드가 공간에 대응하지 않는다 | 이름 있는 모양, 예시 인스턴스, ID 형식 | 수집(예시, 다른 명세) 또는 정규화 |
| map | 표현 스키마끼리 합칠 근거가 없다 (Jira User, UserDetails) | 키 값 인스턴스 공출현 | 수집(테넌트 4순위) |
| map | 감사 action이 공간에 이어지지 않는다 | catalog.targets, 기계 키 | 수집(대상 선언 있는 자료, 테넌트) |
| map | 타입 충돌 항목 | 모양 속성 타입 | 정규화(union 보존) |
| normalize | 응답 모양 없는 동작, 키 없는 레코드형 모양, 기계 키 없는 카탈로그 | 원문 | 수집 |
| normalize | 출처 둘이 같은 사실을 다르게 말한다 | 판과 날짜 | 수집(판 고정) |
| collect | 받지 못한 주소 (403, JS 렌더링) | 대체 공식 경로 | 수집 사다리(9절) |

되먹임 보고는 단계마다 「문제 수, 앞 단계로 보낸 수, 앞 단계가 고쳐 사라진 수」를 남긴다. 한 바퀴 돌 때마다 이 수가 줄어야 한다.

## 9. 수집 사다리 (403과 JS 렌더링 대응)

봇 차단(403)과 JS로 그리는 쪽은 앞으로도 흔하다. 주소마다 아래 순서로 내려가고, 성공한 방법을 출처에 남긴다(`source.fetch_method`).

| 단 | 방법 | 쓰는 곳 |
| --- | --- | --- |
| 0 | 같은 내용의 기계용 원본을 찾는다: 명세 저장소, 문서 저장소의 원본 데이터, 문서 API, 공식 PDF | Okta 이벤트 JSON, docs.github.com `api/article/body`, Salesforce PDF |
| 1 | HTTP 받기 (정직한 User-Agent, 재시도와 간격, 조건부 요청) | 대부분 |
| 2 | 헤드리스 브라우저로 그린다. 화면 대신 그 쪽이 부르는 네트워크 JSON을 먼저 저장하고, 없으면 그려진 DOM을 저장한다 | JS 렌더링 쪽 |
| 3 | 사람이 쓰는 실제 브라우저를 CLI로 조종한다 (CDP로 붙은 Chrome, 에이전틱 브라우저). 사람의 세션과 같은 조건으로 연다 | 단 1, 2에서 막힌 쪽 |
| 4 | 사람에게 넘긴다. 받을 주소 목록을 주고, 사람이 저장한 파일을 받는 폴더에 넣으면 해시와 함께 등록한다 | 확인 문제(CAPTCHA), 로그인 필요 |

하지 않는 것: CAPTCHA 풀기, 브라우저 지문 위장, 차단을 피하려는 프록시 돌리기. 사이트 약관이 자동 수집을 막으면 단 0의 대체 경로나 단 4로 간다.

브라우저 단(2, 3)은 어댑터 하나로 감싼다: `fetch(url) -> {status, final_url, body, network_json[], method}`. Playwright, CDP로 붙은 Chrome, CLI를 가진 에이전틱 브라우저를 같은 꼴로 끼운다. 어느 것을 썼는지 출처에 남는다.

## 10. 구현 현황 (2026-10-15)

> 이 절의 수치는 사전 판단을 빼기 전 첫 구현 기준이다. 사전 제거, 테넌트 실측 추가 뒤 수치는 `정보 지도 작업 정리.md` 5절.

### 요약

- 코드는 `candidate-extraction/ir2/`에 있다(실행과 파일 표는 `ir2/README.md`). 8개 provider 전부를 3절의 개체 11종으로 옮겼다. 옛 파이프라인과 `out/`은 건드리지 않았다.
- 검증기(4.2) 결과 8개 모두 통과: 머리 위반 0, 참조 누락 0, union 보존 전부(GitHub 117, Okta 17, Jira 7, Slack 3, Confluence 2, Atlassian 2), 이름 표본 전부 일치, removed 0, id 충돌 0.
- 같은 입력으로 두 번 돌려 `out2`와 출처 등록부 131개 파일의 sha256이 같다.
- 옛 IR과 대조하면 잃은 정보는 없다. 차이는 모두 원인이 있다(아래 「옛 IR 대조」): 판이 바뀌어 없어진 동작, 수명 규칙으로 뺀 동작, 이름을 원문대로 되돌린 인자, 따로 옮겨 둔 자리, PDF 읽기 차이로 빠진 필드 3개.
- 새로 받은 자료 6개: Okta Identity Governance 명세 2종, Jira Service Management, Jira Software, 최신 GHEC REST 2종(OpenAPI 3.1과 3.0.3). Salesforce 도움말 1쪽은 사다리 끝까지 가서 사람 몫(4단)으로 넘겼다.

### provider별 개체 수

| provider | source | operation | shape | key_decl | id_format | ref_decl | binding | catalog | grant | instance | hole |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| github | 10 | 1765 | 13480 | 1718 | 2 | 2060 | 2 | 3622 | 177 | 4490 | 3436 |
| okta | 9 | 962 | 4678 | 502 | 0 | 796 | 0 | 1660 | 268 | 16814 | 152 |
| slack | 13 | 561 | 2790 | 417 | 23 | 141 | 0 | 1412 | 155 | 2288 | 17 |
| salesforce | 6 | 6586 | 7481 | 1728 | 0 | 2212 | 0 | 194 | 28 | 0 | 1404 |
| gws | 70 | 418 | 2079 | 113 | 15 | 0 | 0 | 1226 | 118 | 0 | 36 |
| jira | 10 | 791 | 3007 | 355 | 0 | 0 | 0 | 304 | 334 | 1614 | 227 |
| confluence | 7 | 348 | 1258 | 132 | 0 | 0 | 0 | 167 | 124 | 9 | 43 |
| atlassian | 6 | 103 | 583 | 53 | 0 | 0 | 0 | 343 | 8 | 207 | 6 |

provider별 내용:

| provider | 내용 |
| --- | --- |
| GitHub | REST 1472(최신 3.1판), GraphQL query와 mutation 293. key_decl stated 290(Node + `id: ID!`), ref_decl 2060(필드 타입, interface와 union 대상은 poly 329), 바인딩 2(`node`, `nodes`). node_id 형식 2개(옛 base64, 새 접두사)가 1117자리에 붙는다(curated, 사전 node_id_field). 감사 카탈로그는 2026-09-03 기계 목록 1159와 2026-10-13 문서 3쪽(2153)을 출처마다 따로 둔다 |
| Okta | 명세 5종(Management 731, IGA 114, OAuth 44, IdP 40, IGA 최종 사용자 33). System Log 유형 1321, 이벤트 훅 339. 대상(targets)이 있는 유형은 catalog.targets와 ref_decl(LogEvent.target 원소) 796. 동작별 관리자 권한(x-okta-iam-permissions)과 역할도 grant로 묶었다. JWK 모양 20개는 kid가 stated(RFC 7517) |
| Slack | 출처마다 동작 행: 문서 쪽, 구판 OpenAPI, 문서 캐시, 메서드 목록, SCIM 정리본. defs_* 18개 -> id_format(stated), id 속성이 defs_*를 가리키는 객체 26 -> key_decl(stated), 그 밖 defs_* 참조 141 -> ref_decl. 테넌트 실측 instance 260(observed), 감사 action 실측 773, 문서판 486 |
| Salesforce | sObject 1728. key_decl 1728 전부 stated(System Fields의 Id), Refers To 2212(poly 498). 동작 6586 중 sObject 동작은 REST 안내서 규칙을 펼친 transform. 플랫폼 이벤트 120, EventLogFile 유형 73(기계 키 null) |
| Google Workspace | Discovery 11종 메서드 418, 스키마 전부. 자원 이름 템플릿 15개(경로 인자의 pattern에서, stated). Reports 활동 이벤트 1162(기계 키, 표시 이름, 범주, 인자 타입), Workspace Events 유형 64 |
| Jira | 플랫폼 611, Software 105, JSM 75. x-changes의 removed 날짜가 지난 11개를 뺐다. 감사 카탈로그는 표시 이름뿐(key null 246) |
| Confluence | v1 130, v2 218. 같은 메서드와 같은 granular scope 집합을 가진 32개 동작에 `ext.dup_v1_v2`로 상대 동작을 적었다 |
| Atlassian 조직 | 조직 API 4종 103. 조직 감사 활동 343(key null) |

### 검증기 완성도 (수집이 끝났는가)

| provider | 응답 모양 없는 동작 | 본문 없음(원문 명시) | 키 없는 레코드형 모양 | 기계 키 없는 카탈로그 | 대상 없는 감사 항목 | 구멍 | key_decl stated/curated | removed로 뺀 것 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| github | 9/1765 | 331 | 354/821 | 0/3622 | 3312/3312 | 3436 | 290/1428 | 1282 |
| okta | 13/962 | 218 | 108/268 | 0/1660 | 525/1321 | 152 | 20/482 | 0 |
| slack | 43/561 | 0 | 128/173 | 0/1412 | 1259/1259 | 17 | 26/391 | 0 |
| salesforce | 97/6586 | 2137 | 19/1721 | 74/194 | 0/0 | 1404 | 1728/0 | 0 |
| gws | 0/418 | 64 | 21/78 | 0/1226 | 1162/1162 | 36 | 0/113 | 0 |
| jira | 161/791 | 104 | 131/239 | 246/304 | 246/246 | 227 | 0/355 | 11 |
| confluence | 2/348 | 64 | 47/100 | 102/167 | 102/102 | 43 | 0/132 | 0 |
| atlassian | 0/103 | 28 | 23/37 | 343/343 | 343/343 | 6 | 0/53 | 0 |

- 레코드형 모양은 read_one 응답 객체와 read_many, search 응답의 원소(객체 래퍼면 안 배열의 원소)다.
- 본문 없음은 2xx 응답이 본문 없이 끝난다고 원문이 말한 동작이다(204 등). 빈 곳으로 세지 않는다.
- GitHub removed 1282는 REST 47(x-github removalDate 지남, Classroom 등)과 GraphQL 필드 1235(「Removal on」 날짜 지남)다.
- GitHub 구멍 대부분(3312)은 감사 필드 목록에 타입이 없는 것(untyped_field_list), Salesforce 구멍 1404는 Refers To가 없는 reference 필드다.

### 수집으로 돌려보낸 문제 (issues.jsonl, 8절)

| 문제 | 수 | 어디 | 필요한 것 |
| --- | --- | --- | --- |
| 키 없는 레코드형 모양 | 831 | GitHub 354, Jira 131, Slack 128, Okta 108 | 원문 키 근거, 사전 한 줄, 테넌트 키 값 |
| 기계 키 없는 카탈로그 | 765 | Atlassian 343, Jira 246, Confluence 102, Salesforce 74 | Atlassian `event-actions`, Salesforce EventLogFile `EventType` 값 (테넌트 4순위) |
| 응답 모양 없는 동작 | 325 | Jira 161, Salesforce 97(REST 안내서 리소스), Slack 43 | 응답 스키마가 있는 자료, 예시, 테넌트 응답 |
| 높은 순위 출처의 판이 더 오래됨 | 170 | Slack 164(구판 OpenAPI와 2026 문서), Jira 4, Okta 2 | 판 고정 또는 새 명세 |
| 대상 없는 감사 항목 (출처 단위) | 65 | GWS 54쪽, 그 밖 출처마다 하나 | 대상 선언이 있는 자료, 테넌트 감사 로그 |
| 판 어긋남 | 2 | GitHub(2026-09-03과 2026-10-15 사이 동작 47 추가), Slack(구판에만 있는 메서드 10) | 수명 표시 확인 |
| 권한 문서와 명세 어긋남 | 1 | GitHub 권한 문서 86행이 최신 명세에 없는 엔드포인트 | 같은 날짜의 문서와 명세 |
| 실측 파일 못 읽음 | 2 | Slack SCIM Schemas 응답 2개(빈 파일) | 다시 받기 |

### 수집 사다리 결과 (2026-10-15)

| 대상 | 성공한 단 | fetch_method | 비고 |
| --- | --- | --- | --- |
| Okta Identity Governance (관리자) | 0 | machine_alt | 문서 쪽(Redocly)의 쪽 데이터가 가리키는 명세 원본 `_spec/.../governance-production-reference.yaml` |
| Okta Identity Governance (최종 사용자) | 0 | machine_alt | 같은 방법 |
| Jira Service Management | 1 | http | `cloud/jira/service-desk/swagger.v3.json` |
| Jira Software | 1 | http | `cloud/jira/software/swagger.v3.json` |
| GHEC REST 2026-03-10 (OpenAPI 3.1, descriptions-next) | 1 | http | 정규화에 쓴다. 웹훅 절이 있다 |
| GHEC REST 2026-03-10 (OpenAPI 3.0.3, descriptions) | 1 | http | 판 비교용. 웹훅은 x-webhooks |
| Salesforce Mobile SDK scope 쪽 (403) | 0 | machine_alt | 같은 표가 이미 받은 공식 PDF에 있다 |
| Salesforce 설정 감사 도움말 (JS 쪽) | 4 | human | 1단은 본문 없는 쪽, 2단 Playwright 없음, 3단 CDP와 에이전틱 브라우저 설정 없음. `collect/inbox/pending.jsonl`에 적었다 |

판 어긋남 기록: 2026-10-13에 받은 `ghec.json`은 기본 API 판(OpenAPI 3.0.3) 계열이었다. 최신 날짜판 2026-03-10을 따로 받았고, 2026-09-03 판과 비교해 동작 47이 새로 생기고 47이 removalDate로 빠졌다. 웹훅도 최신 3.1판에서 읽었다(최신판에 웹훅 절이 있다). 2026-09-03 판은 비교에만 쓴다.

### 옛 IR 대조 (compare_v2.py)

| provider | 동작 | 응답 자리 | 요청 자리 | 인자 | 레코드 키 | 예시 값 | 카탈로그 | 권한 어휘 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| github | 1427/1472 | 65278/65278 | 3152/3157 | 5477/5482 | 2264/2264 | 3602/3647 | 1453/1453 | 119/120 |
| okta | 731/731 | 13249/13249 | 3446/3446 | 2039/2039 | 500/500 | 268/268 | 1654/1654 | 199/199 |
| slack | 388/388 | 7807/7927 | - | 1240/1240 | 199/199 | 1462/1462 | 945/945 | 151/151 |
| salesforce | 6570/6606 | 47908/48148 | 19078/19211 | 17012/20848 | 3266/3284 | - | 175/175 | 28/28 |
| gws | 417/417 | 8947/8947 | 3915/3915 | 2922/2922 | 364/364 | - | 1226/1226 | 118/118 |
| jira | 611/622 | 10514/10514 | 3363/3363 | 1945/1945 | 678/678 | 71/71 | 289/289 | 240/240 |
| confluence | 346/346 | 18427/18427 | 1166/1166 | 1259/1259 | 318/318 | 1/1 | 167/167 | 124/124 |
| atlassian | 103/103 | 1172/1172 | 397/397 | 471/479 | 54/54 | 73/73 | 337/337 | 8/8 |

응답 자리는 새 모양을 펼친 경로(union은 대안 전부)에 옛 자리 경로가 있는지 본 것이다. Slack은 옛 IR이 대안 목록 `items[]`를 `[*]` 없이 펼쳐, 배열 표기를 빼고 맞춘 것도 찾음으로 센다.

차이의 원인:

- GitHub 동작 45, 요청 자리 5, 인자 5, 예시 값 45: 최신판에서 removalDate가 지나 뺀 동작(Classroom 등)과 판이 바뀐 요청 본문(billing/update-budget). 권한 어휘 1(`repository:Workflows:read`)은 지금 받은 권한 문서에 그 행이 없다.
- Jira 동작 11: x-changes removed 날짜가 지났다.
- Slack 응답 자리 120: App manifest 설정 경로를 옛 IR은 `apps.manifest.export` 응답에 붙였고, 새 IR은 문서 출처의 모양(`app_manifest`)으로 따로 둔다. 연결은 판단이라 규칙 단계에 맡긴다.
- Salesforce 동작 36과 자리 약 370: 옛 IR이 Metadata API 설정 유형 12종을 sObject 동작으로 만든 것(원문에 없는 동작)을 새 IR은 모양으로만 둔다. 인자 3836 차이는 경로 인자 이름을 REST 안내서 표기 `{id}`로 둔 것(옛 IR `Id`)이다. 필드 3개(ApprovalSubmissionDetail 2, SfdcPartnerProductLicense 1)는 PDF 읽기 차이로 빠졌다(아래).
- Atlassian 인자 8: 옛 IR이 SCIM 경로의 인자 이름을 바꿨다(scimUserId). 새 IR은 원문 이름(userId, id)을 둔다.
- 참조: 옛 IR의 ref_def와 ref_targets는 동작별로 펼친 자리 수(Slack 1651, Salesforce 4276)이고, 새 ref_decl은 모양 속성 단위(Slack 141, Salesforce 2212)라 수를 바로 비교하지 않는다. 대상 목록은 모두 옮겼다.

### PDF 읽기

이 PC에서 PyMuPDF(fitz)의 원생 모듈이 Windows 보안(Smart App Control)에 막혀, Salesforce PDF는 순수 파이썬 pypdf 6.14.2로 읽었다(`ir2/pdftext.py`). 옛 구간 자르기 규칙을 옮기고, 마지막 쪽은 좌표 대신 다음 목차 제목 줄(뒤 6줄 안에 Supported Calls나 Fields가 오는 것)에서 자른다. pypdf는 머리 줄을 붙여 읽는다(「Field Name Details」가 「DetailsField Name」). 차이: sObject 1728개와 필드 목록은 옛 출력과 같고 필드 3개만 빠졌다. 플랫폼 이벤트의 Supported Calls 줄에 subscribe()가 보이지 않아, 이벤트 판정을 「Standard Platform Event Object List 아래 객체 전부」로 바꾸고 구독 채널을 ext에 남겼다. 첫 실행은 쪽 글자 추출에 몇 분 걸리고 이후는 `ir2/cache/`를 쓴다.

### 설계에 남은 질문

1. 스칼라 모양의 값 형식: 3.3에 자리가 없어 `shape.scalar` {scalar, format, enum, pattern}을 더했다(enum 타입, Slack defs_*, 스칼라 응답).
2. instance.of 확장: 속성 예시와 배열 원소 예시는 `{shape, prop}`(prop `[*]`), 인자 예시는 `{operation, param}`, 요청 본문 예시는 `{operation, status: "request"}`로 두었다. 3.10의 세 꼴만으로는 이 예시들(GitHub node_id 예시 등)을 잃는다.
3. 사전 출처: curated 사실의 src.source가 가리킬 출처 종류가 3.1에 없어 source.kind `lexicon`(순위 2)을 더했다.
4. 모양 속성의 수명: 속성 단위 deprecated와 sunset을 props 줄에 `deprecated`, `sunset`으로 두었다(life는 행 단위라).
5. 사전의 판단성 항목 중 키 규약(record_key_fields, record_key_named_id, local_key_fields), node_id_field, Slack extra_prefixes만 curated 개체로 옮겼다. param_space, field_space, audit_alias, schema_space는 공간 이름으로의 매핑이라 4.1의 5(판단을 쓰지 않는다)와 7절 5단계가 부딪친다. 공간 없이 쓰는 꼴(예: 「이 인자와 저 속성은 같은 대상」)을 정해야 옮길 수 있다.
6. id_format.applies가 경로 인자에도 붙는다(Google 자원 이름). 3.5의 `[{param}]`은 동작을 말하지 않아 `{operation, param}`으로 두었다.
7. Okta targets의 ref_decl은 「이 이벤트 유형일 때」만 성립한다. from이 `LogEvent.target[*]` 하나라 조건(유형)을 ext.catalog에 두었다. 조건부 참조를 개체로 둘지 정해야 한다.
8. Slack 구판 OpenAPI에만 있는 메서드 10개는 원문에 폐지 표시가 없어 active로 두었다(1절은 원문 표시만 근거로 한다). 문서에 없다는 사실을 수명 근거로 쓸지 정해야 한다.
9. Salesforce sObject 동작의 경로 인자 이름은 REST 안내서 표기 `{id}`를 따랐다. query()는 `GET query?q=SOQL`로 펼쳤다(옛 IR은 `GET /sobjects/<객체>`). 규칙이 둘 중 무엇을 읽을지 정해야 한다.
10. Confluence v1과 v2 중복 표시는 같은 HTTP 메서드와 같은 granular scope 집합으로만 정했다(32개). 응답 모양이 다른 같은 대상(예: content와 page)은 표시되지 않는다.
11. GitHub webhook-payload-samples 폴더는 payload 예시가 아니라 body 인자 문서였다. 그래서 웹훅 instance는 명세 안 예시(6개)뿐이고, 이 폴더는 같은 이벤트와 action의 카탈로그에 웹훅 종류(availability)를 붙이는 데 썼다(259개 맞음, 11개는 새 카탈로그).

## 11. 결정 기록 (2026-10-15)

| 항목 | 결정 |
| --- | --- |
| GitHub 판 | 최신 GHEC 3.1판 하나로 REST와 웹훅을 모두 읽는다. 2026-03-10 판은 판 비교에만 쓴다 |
| 수집 3단 브라우저 | Aside를 시험한다(설치 뒤 CLI 확인, `AgentCliAdapter`에 연결) |
| Slack 테넌트 실측 데이터 | 지금은 가리지 않는다. 공유하지 않는다 |
| I1 ID 겸 속성 (`login`, `email`, `name`, `slug`) | 둘 다 올린다. ID 쪽은 대체 키, 속성 쪽은 그 대상의 속성 |
| I2 URL 필드 | ID(참조)로 본다. 값을 동작 경로 템플릿에 맞춰 대상을 정한다. 맞는 템플릿이 없으면(브라우저용 `html_url`) 속성 |
| 사전 판단 | 모두 뺀다(2026-10-15). 4.1의 6(사전 사실을 curated 개체로 낸다)은 폐기한다. 새 IR은 curated 등급 행을 내지 않는다. 사전 파일에서 읽는 것은 자료 위치와 경로 접두사 벗기기 같은 변환 설정뿐이다. Slack RPC 동작 종류는 `unknown`. REST GET은 경로 끝이 파라미터면 read_one이 먼저이고, 목록 래퍼는 「객체 원소 배열 속성이 하나뿐인 객체」다(루프 1에서 고침, `Information Map 설계.md` 9절). 판정 설계는 `Information Map 설계.md` |
