# Salesforce 위협 매핑

Salesforce 객체 227종 중 133종에 위협 117건을 매핑한 초안. 2026-09 표 157건을 Salesforce 객체 기준으로 하나씩 다시 검토하고 Salesforce 고유 위협 4건을 더함.

- 버전 v0, 상태 초안, 담당자 검토 전, 2026-11-25 작성
- 범위: 엔진이 수집 대상으로 판정한 Salesforce 객체 227종. 위협이 없는 객체 94종도 objects.csv에 남김
- 만든 방법: 범주별 초안 팀 5개, 팀마다 적대적 검증 1회, 위협 없는 객체 보완 2회, 팀 간 교차 검증. 객체, 필드, 동작은 Salesforce Object Reference와 Help 문서를 직접 열어 확인. 현실성 근거는 공개 사고 보고와 보안 업체 연구 글을 직접 열어 확인
- 9월 표 위협을 쓴 행은 이름, 종류, 범주, 그룹, 출처를 9월 값 그대로 두고 설명, 원리, 범주 이유는 Salesforce 객체와 필드로 다시 씀. 출처 주소는 9월 값
- 관리자 신뢰 전제: 9월 IDA-31 관리자의 Login As, IDA-54 관리자의 남의 비밀번호 재설정, IDA-66 관리자의 SAML 설정 교체는 해당 없음. IDA-24 자기 권한 상승은 Modify All Data 없이 배정 권한만 가진 사용자로 좁힘

## 칸 채운 규칙

| 칸 | 규칙 |
| --- | --- |
| `threat_id` | 범주 안 순서대로 새 번호. 9월 ID는 `legacy_ids`. 해당 없음으로 뺀 SF-IDA-55는 다시 쓰지 않음 |
| `target_object` | 행마다 주 객체 하나. 나머지는 `notes`의 「함께 보는 객체」 |
| `aegi_object`, `collection_status`, `collection_path` | 주 객체 기준. engine main 305acb99의 Salesforce 호출 SF-01~SF-12, SF-90, api-list approved, profile-binding overlay와 대조. 2026-11-15 실측 출력에 그 객체가 없으면 경로 끝에 `[11-15 출력 0건]` |
| `observation` | STATE, DIFF, EVENT 밖에 이 SaaS 작업 값 셋을 그대로 둠. `STATE+DIFF`는 스냅샷 하나로 상태가 보이고 두 스냅샷 차이로 변경도 보임. `조건부`는 수집기 공백 필드나 설정이 채워져야 판정됨. `NOT_OBSERVABLE`은 구성 수집으로 안 보이고 로그도 없음 |
| `actor`, `engine_threat_type`, `cross_saas` | 다른 SaaS v0에서 같은 9월 ID에 붙은 값의 다수결. Salesforce 행의 적용 SaaS에 다른 SaaS가 있으면 `cross_saas`는 direct. 9월 대응이 없는 5건은 직접 판정 |
| `notes` | 원래 비고, 함께 보는 객체, 판단 필드, 이벤트, 판정 단서, 사례 근거, 미확인, Cross-SaaS 상대 순서. ` / `로 나눔 |

## 요약

| 구분 | 건수 |
| --- | --- |
| 범주 | Identity / Access 64, Integration / Automation 23, Policy / Configuration 19, Resource 11 |
| 수집 상태 | 행 117건 모두 수집 중. 객체 227종 중 191종은 11-15 출력 0건 |
| 관측 | STATE 46, STATE+DIFF 27, 조건부 22, DIFF 16, EVENT 4, NOT_OBSERVABLE 2 |
| 엔진 유형 후보 | posture 35, unauthorized_access 34, privilege_escalation 22, data_exfiltration 21, accountability_loss 5 |
| Cross-SaaS | direct 19, possible 20, none 78 |
| 9월 표 대응 | 157건 중 116건 대응, 41건 해당 없음. 이유는 legacy_map.csv |

## Cross-SaaS 시나리오로 키울 후보

- SF-IDA-01: Okta 비활성화 뒤에도 남는 Salesforce User
- SF-IDA-36: IdP SAML 서명 키로 assertion을 위조해 임의 Salesforce 사용자로 로그인
- SF-IDA-39, SF-IDA-52: SSO 전환 뒤 남은 Salesforce 비밀번호 로그인과 Okta 세션과 무관한 refresh token
- SF-IDA-57: Okta 신원 하나 장악으로 FederationIdentifier에 묶인 Salesforce 관리 권한 도달
- SF-IDA-59: Okta JIT 프로비저닝과 등록 handler로 관리 화면 밖 Salesforce 사용자 생성
- SF-INT-07: IT 지원 사칭 전화로 공격자 Connected App 승인 유도와 토큰으로 데이터 반출
- SF-INT-14: Outbound Message endpointUrl을 외부 서버로 두어 레코드 필드와 세션 ID 전송
- SF-INT-17: iPaaS, 데이터 이동 서비스 연결로 Google Workspace, Slack 쪽에 레코드 자동 복사
- SF-INT-18: Named Credential 한 계정의 외부 시스템 권한을 Salesforce 사용자가 대신 사용
- SF-RES-10: Case 본문에 남은 AWS, Snowflake 자격증명

## 남은 일

- 담당자 검토 뒤 v1
- 수집기 공백: DelegateGroup, ContentDistribution, Network, Report, UserAccessChange, PermissionSet.PermissionsAssignPermissionSets
- 11-15 출력 0건 객체 191종의 실제 수집 여부 재확인
- 각 행 `notes`의 「미확인」 항목 확인
