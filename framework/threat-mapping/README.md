# SaaS 객체별 위협 매핑

SaaS마다 객체(계정, 앱, 정책, 자원)별로 생길 수 있는 위협을 같은 형식의 CSV로 모으는 곳이다. 팀이 SaaS를 나눠 맡아 채우고, 이 표를 바탕으로 Cross-SaaS 시나리오와 엔진 위협 판정 규칙을 만든다.

- 상태: 형식 초안(2026-11-24). [microsoft/](microsoft/README.md)(M365), [okta/](okta/README.md), [gws/](gws/README.md), [slack/](slack/README.md), [github/](github/README.md), [salesforce/](salesforce/README.md), [snowflake/](snowflake/README.md), [atlassian/](atlassian/README.md)(Jira, Confluence, Loom, 조직 공통), [onepassword/](onepassword/README.md)(1Password), [gemini/](gemini/README.md)(Gemini Enterprise)가 v0로 있다. okta, gws, slack, github 네 개는 9월 표를 옮기고 보완한 것이고 salesforce, snowflake는 9월 표 157건을 그 SaaS 객체에 맞춰 다시 쓰고 검증한 것이다. atlassian, onepassword는 2026-11-24 우리 환경 실측 목록을 이 형식으로 옮기고 9월 표와 공식 문서로 보완한 것이다. gemini는 Gemini Enterprise 객체 30종을 OWASP, MITRE ATT&CK 등 공개 자료로 매핑한 것이다.
- 위협 유형의 뜻은 [`schema/ontology/threat_types.yaml`](../schema/ontology/threat_types.yaml), 판정 절차는 Adapter Engine [위협 판정 명세 V2](../../specs/AEGI_THREAT_JUDGMENT_V2.md)를 따른다. 이 폴더는 판정 규칙이 아니라 규칙을 만들 재료 목록이다.
- 출발 자료는 2026-09 「AEGI_Threat_Mapping」(Identity, Integration, Policy, Resource 4갈래 157건, 공유 드라이브 `위협매핑`)이다. 열 이름은 그 표를 따르고 판정에 필요한 칸을 더했다.

## 폴더와 파일

```text
threat-mapping/
├── README.md              # 이 형식 규칙
├── scenarios-backlog/     # 끝점 폴더로 나누기 전의 기존 시나리오 모음
└── <provider>/            # SaaS 하나. 이름은 engine overlay 폴더 이름 (okta, gws, slack, github, salesforce, atlassian, aws, microsoft …)
    ├── README.md          # 버전, 상태, 담당, 범위, 출처, 남은 일
    ├── threats.csv        # 위협 목록 (필수)
    ├── objects.csv        # 대상 객체와 수집 상태 (필수)
    ├── legacy_map.csv     # 9월 표 ID 대응 (있으면)
    └── scenarios.csv      # 이 SaaS에서 끝나는 Cross-SaaS 시나리오 (있으면)
```

- 버전은 `<provider>/README.md` 맨 위에 적는다. 파일 이름에 버전을 붙이지 않고 git 이력으로 남긴다. v0 초안, 검토를 반영한 v1, 시나리오와 규칙에 맞춘 v2 순서로 올린다.
- 인코딩 UTF-8(BOM 없음), 줄바꿈 LF, 구분자 쉼표, 따옴표는 RFC 4180. 한 칸 안에 값이 여럿이면 `; `로 나눈다.
- 실명, 이메일, 테넌트 ID, 비밀값을 넣지 않는다.

## threats.csv

| 열 | 뜻 | 값 |
| --- | --- | --- |
| `threat_id` | 위협 ID | `<SAAS>-<범주>-<번호>`. SAAS 약어는 아래 표, 범주는 IDA, INT, POL, RES, 번호는 두 자리부터. 한 번 쓴 ID는 지워도 다시 쓰지 않는다 |
| `saas` | provider id | 폴더 이름과 같다 |
| `object_category` | 객체 범주 | `Identity / Access`, `Integration / Automation`, `Policy / Configuration`, `Resource` 중 하나. ID의 범주와 맞춘다 |
| `threat_group` | 위협 그룹 | 자유. SaaS 안에서 묶는 이름 |
| `target_object` | 위협 대상 객체 | 그 SaaS API의 타입 이름 |
| `aegi_object` | AEGI 정규화 객체 | engine overlay `object_type`. 정규화가 없으면 빈칸 |
| `collection_status` | 수집 상태 | `수집 중`, `필드 없음`(호출은 있으나 정규화에 필드 없음), `권한 없음`(수집 권한 부족), `미수집(API 있음)`, `API 밖`(공식 API 없음, 관리 콘솔, PowerShell 등), `로그만`(객체 없이 로그로만 보임) |
| `collection_path` | 수집 경로 | engine 호출 ID(예: M365-05, api-list 의 RG-…) 또는 API 경로. 호출은 있지만 최근 출력에 없으면 끝에 `[날짜 출력 0건]` |
| `threat_name` | 위협명 | 한 줄 |
| `threat_type` | 위협 종류 | `Technique`(행위) 또는 `Misconfiguration`(상태) |
| `description` | 무엇이 일어나나 | 한두 문장 |
| `mechanism` | 왜 성립하나 | 한두 문장 |
| `mapping_reason` | 이 범주에 둔 이유 | 한 문장 |
| `actor` | 누가 하는가 | `악의적 내부자`, `부주의 내부자`, `외부 협력자(게스트)`, `계정 탈취·외부 공격자` 중 하나 이상 |
| `observation` | 판정에 필요한 관측 | `STATE`(스냅샷 하나), `DIFF`(두 스냅샷 차이), `EVENT`(로그 필요) |
| `engine_threat_type` | 엔진 위협 유형 후보 | `threat_types.yaml`의 id(`unauthorized_access`, `privilege_escalation`, `data_exfiltration`, `accountability_loss`) 또는 `posture`(경로를 넓히는 설정이라 그 자체로 사람과 대상 판정이 안 나옴) |
| `cross_saas` | 다른 SaaS 관여 | `direct`(다른 SaaS 객체가 경로에 들어감), `possible`(조건에 따라), `none` |
| `legacy_ids` | 9월 표 대응 ID | `IDA-01; IDA-21`. 없으면 빈칸 |
| `source` | 출처 이름 | MITRE ATT&CK, CISA ScubaGear, Push Security, OWASP NHI, SigmaHQ, 벤더 문서, 사고 보고 등 |
| `source_id` | 출처 안 ID | T1098.003, MS.AAD.7.4v1, SAT1010, NHI5:2025 등 |
| `source_url` | 출처 주소 | 확인한 주소만 |
| `notes` | 비고 | 판정 단서, 수집 빈틈, Cross-SaaS 상대 SaaS |

### SAAS 약어

| provider id | 약어 | provider id | 약어 |
| --- | --- | --- | --- |
| microsoft | M365 | salesforce | SF |
| okta | OKTA | atlassian | ATL |
| gws | GWS | aws | AWS |
| slack | SLACK | github | GH |
| snowflake | SNOW | onepassword | 1P |
| gemini | GEM | | |

목록에 없는 SaaS는 PR에서 약어를 더한다.

## objects.csv

`saas`, `object_category`, `target_object`, `aegi_object`, `collection_status`, `collection_path`, `threat_count`. 값은 threats.csv와 같은 규칙이다. 위협이 0건인 객체도 남겨 수집 범위를 보이게 한다.

## legacy_map.csv

`legacy_id`, `legacy_name`, `legacy_saas`, `threat_ids`, `not_applicable_reason`. 9월 표 157건 각각에 이 SaaS의 대응 위협 ID를 적고, 없으면 이유를 적는다.

## scenarios.csv

Cross-SaaS 시나리오 한 줄이 하나다(초안, 2026-11-25). 표만 보고 시험 환경에 세팅할 수 있게 적는다. 실행했든 안 했든 같은 칸을 채우고, 실행 여부는 `status`와 `evidence`에만 적는다. 파일은 마지막 위협이 일어나는 SaaS의 폴더에 둔다. 끝점 폴더로 나누기 전의 시나리오는 [scenarios-backlog/](scenarios-backlog/README.md)에 모아 두었다.

| 열 | 뜻 | 값 |
| --- | --- | --- |
| `scenario_id` | 시나리오 ID | `SC-<SAAS>-<번호>`. SAAS 약어는 끝점 SaaS |
| `name` | 이름 | 한 줄 |
| `saas_path` | 거치는 SaaS 순서 | provider id를 ` -> `로 잇는다. 한 단계에 여럿이면 `; `. 예: `okta -> gws -> gemini`. `external`은 테넌트 밖 |
| `threat_type` | 위협 유형 | `비인가 접근`, `권한 상승`, `데이터 반출`, `추적성 상실`(`threat_types.yaml`의 넷) 또는 `비정상 설정`(threats.csv의 `posture`). 여럿이면 대표 유형을 먼저 |
| `actor` | 시작하는 사람 | 역할로 적는다(개발자, 영업 담당, 외부인). 계정 이름을 쓰지 않는다 |
| `actor_must_lack` | 그 사람에게 없어야 하는 권한 | 이 권한이 있으면 시나리오가 성립하지 않는다 |
| `trigger` | 시작 행동 | 하나 |
| `path` | 경로 | ` -> `로 잇는다. 관계 이름(`triggered_by`, `runs_as` 등)을 쓰면 그대로 적는다 |
| `setup_objects` | 세팅할 객체 | `<provider>: 객체와 조건` 을 `; `로 나눈다 |
| `setup_relations` | 있어야 하는 관계 | `relation_types.yaml`의 이름 |
| `expected_result` | 성립하면 남는 것 | 무엇이 어디에, 누구 이름으로 |
| `premise` | 전제 | `프롬프트 주입`, `계정 이탈`, `출발 객체 없음` 등. 없으면 빈칸 |
| `end_threat_ids` | 끝점 위협 ID | 그 폴더 `threats.csv`의 `threat_id` |
| `status` | 상태 | 지금 시험 환경 기준으로 적는다. `후보`(세팅 전), `세팅됨`(객체는 있고 실행 전), `성립`, `불성립`, `제외`(시나리오로 세지 않기로 함). 예전 환경에서의 결과는 `evidence`에만 남긴다 |
| `evidence` | 세팅과 실행 기록 | `<환경 이름이나 회차> <날짜> <결과>` 꼴로 적고 환경이 여럿이면 `; `로 나눈다. 예: `2회차 2026-10-23 성립; 4회차 2026-11-25 봇 서버 무응답`. 기록이 없으면 빈칸. id와 값은 적지 않는다 |
| `notes` | 비고 | 경로에 든 다른 SaaS 폴더의 위협 ID, 성립을 가르는 조건 |

## 올리는 법

1. `<provider>/` 폴더를 만들고 세 파일과 README를 넣는다. 스프레드시트에서 만들었다면 열 이름을 위 표와 똑같이 맞춰 CSV(UTF-8)로 내보낸다.
2. 브랜치 `docs/threat-mapping-<provider>`로 PR을 연다. 제목은 `threat-mapping: <SaaS> v<버전>`.
3. 머지 전에 `npm run verify`를 통과시킨다. 같은 `threat_id` 중복, 허용값 밖의 값이 없는지 확인한다.
4. 시나리오는 위 `scenarios.csv` 양식으로 끝점 SaaS 폴더에 올린다. 판정 규칙(`rules.csv`) 형식은 SaaS별 매핑이 모인 뒤 이 문서에 더한다.
