# Snowflake 위협 매핑

Snowflake 객체 40종 중 34종에 위협 61건을 매핑한 초안. 2026-09 표 157건을 Snowflake 객체 기준으로 하나씩 다시 검토하고 Snowflake 고유 위협 3건을 더함.

- 버전 v0, 상태 초안, 담당자 검토 전, 2026-11-25 작성
- 범위: [snowflake-rest-api-specs](https://github.com/snowflakedb/snowflake-rest-api-specs/tree/990e25d97236a11826c9eed40e587c2b859e5680/specifications) 990e25d(2026-09-10) 명세에서 뽑은 구성 객체 40종. 위협이 없는 객체 6종도 objects.csv에 남김. 관계 5종(Grant, GrantOf, GrantOn, TagAssignment, ServiceRoleGrantTo)은 객체로 세지 않고 notes의 판단 필드에만 씀. 실행 건, 저장 내용, 응답 값 객체 12종은 범위 밖
- 만든 방법: 범주별 초안 팀 5개, 팀마다 적대적 검증 1회, 위협 없는 객체 보완 2회와 그 검증, 팀 간 교차 검증. 객체, 속성, 권한은 REST 명세와 Snowflake 공식 문서를 직접 열어 확인. 현실성 근거는 공개 사고 보고와 보안 업체 연구 글을 직접 열어 확인
- 9월 표 위협을 쓴 행은 이름, 종류, 범주, 그룹, 출처를 9월 값 그대로 두고 설명, 원리, 범주 이유는 Snowflake 객체와 속성으로 다시 씀. 출처 주소는 9월 값
- 관리자 신뢰 전제: 관리 역할은 ACCOUNTADMIN, SECURITYADMIN, USERADMIN, ORGADMIN과 이를 물려받은 역할. 9월 IDA-54 관리자의 남의 비밀번호 재설정, IDA-66 관리자의 SAML 설정 교체는 해당 없음. 역할 부여 행은 관리 역할 밖 역할이 한 부여로 좁힘

## 칸 채운 규칙

| 칸 | 규칙 |
| --- | --- |
| `threat_id` | 범주 안 순서대로 새 번호. 9월 ID는 `legacy_ids` |
| `target_object` | 행마다 주 객체 하나. 나머지는 `notes`의 「함께 보는 객체」 |
| `aegi_object` | 빈칸. 현재 판에는 Snowflake 수집기와 overlay가 없으며 수집기 엔진 연동 예정(SNOW-01~SNOW-03) |
| `collection_status`, `collection_path` | 행 61건, 객체 40종 모두 `미수집(API 있음)`. 경로는 REST 명세의 목록 경로(예: `/api/v2/users`) |
| `observation` | STATE, DIFF, EVENT 밖에 이 SaaS 작업 값 셋을 그대로 둠. `STATE+DIFF`는 스냅샷 하나로 상태가 보이고 두 스냅샷 차이로 변경도 보임. `조건부`는 수집기 공백 속성이나 수집 역할 권한이 채워져야 판정됨. `NOT_OBSERVABLE`은 구성 수집으로 안 보이고 로그도 없음 |
| `actor`, `engine_threat_type`, `cross_saas` | 다른 SaaS v0에서 같은 9월 ID에 붙은 값의 다수결. Snowflake 행의 적용 SaaS에 다른 SaaS가 있으면 `cross_saas`는 direct. 다른 SaaS v0에 같은 9월 ID 값이 없는 4건은 직접 판정 |
| `notes` | 원래 비고, 함께 보는 객체, 판단 필드, 이벤트, 판정 단서, 사례 근거, 미확인, Cross-SaaS 상대 순서. ` / `로 나눔 |

`조건부`가 많은 이유

- 예정된 수집 역할에 MANAGE GRANTS가 없음. SHOW USERS, DESCRIBE USER 문서 기준 그 경우 다른 User의 name 밖 칸이 NULL이고, SHOW GRANTS, SHOW ROLES는 수집 역할이 권한을 가진 객체만 돌려줄 수 있음
- 계정 파라미터, authentication policy, session policy, OAuth와 SCIM security integration, PAT 목록이 REST 명세나 이슈 #539 호출 목록에 없어 SQL로만 보임

## 요약

| 구분 | 건수 |
| --- | --- |
| 범주 | Identity / Access 35, Policy / Configuration 14, Integration / Automation 6, Resource 6 |
| 수집 상태 | 행 61건, 객체 40종 모두 미수집(API 있음) |
| 관측 | 조건부 37, NOT_OBSERVABLE 9, STATE 6, DIFF 3, STATE+DIFF 3, EVENT 3 |
| 엔진 유형 후보 | unauthorized_access 22, posture 20, privilege_escalation 12, data_exfiltration 7 |
| Cross-SaaS | direct 14, possible 12, none 35 |
| 9월 표 대응 | 157건 중 58건 대응, 99건 해당 없음. 이유는 legacy_map.csv |
| Snowflake 고유 위협 | SNOW-POL-07 Cortex AI Guardrails 미적용, SNOW-POL-13 EGRESS 네트워크 규칙 전체 허용, SNOW-RES-03 데이터 보호용 뷰와 UDF의 비secure 정의 |
| 위협 없는 객체 | Warehouse, ComputePool, CatalogIntegration, ImageRepository, Pipe, Stream |

## Cross-SaaS 시나리오로 키울 후보

- SNOW-IDA-01, SNOW-IDA-09: Okta 비활성화나 부서 이동 뒤에도 남는 Snowflake User와 역할 부여
- SNOW-IDA-25, SNOW-IDA-26: Okta SSO 전환 뒤 남은 Snowflake 비밀번호 로그인과 Okta를 거치지 않는 PAT 로그인
- SNOW-IDA-31: Okta 계정 하나 장악으로 같은 이름의 Snowflake User와 그 역할 범위 도달
- SNOW-IDA-32: SCIM access token이나 Okta provisioner role로 Okta 콘솔 밖에서 Snowflake User, Role 생성
- SNOW-IDA-19: Salesforce Case, Slack 메시지에 평문으로 남은 Snowflake 비밀번호, PAT
- SNOW-INT-02: 같은 연동 업체가 Snowflake 계정 여러 개와 Salesforce에 함께 붙어 업체 한 곳 침해가 한꺼번에 번짐
- SNOW-POL-14: 검증 범위가 넓은 GitHub Actions OIDC 신뢰로 Snowflake service 사용자 인증
- SNOW-RES-05: COPY INTO로 조직이 통제하지 않는 S3 등 외부 클라우드 저장소에 언로드

## 남은 일

- 담당자 검토 뒤 v1
- 이슈 #539 수집기가 들어오면 `aegi_object`, `collection_status`, `collection_path` 다시 채움
- SQL로만 보이는 계정 파라미터, authentication policy, session policy, security integration, PAT 목록 수집 방안
- 수집 역할 MANAGE GRANTS 여부 결정. 없으면 `조건부` 37건 대부분이 판정 안 됨
- 각 행 `notes`의 「미확인」 항목 확인. 반출 차단 계정 파라미터의 실제 기본값, SECURITYADMIN의 서비스 생성 가능 여부, REST 응답에도 SHOW 명령 거름이 걸리는지 포함
