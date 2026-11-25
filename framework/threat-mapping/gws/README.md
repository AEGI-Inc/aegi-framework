# Google Workspace 위협 매핑

Google Workspace 객체 42종에 위협 103건을 매핑한 초안이다. 2026-09 표의 Google Workspace 해당분 92건을 옮기고 11건을 보완했다.

- 버전 v0, 상태 초안(검토 전), 2026-11-25 작성
- 범위: 9월 표 「AEGI_Threat_Mapping」에서 적용 SaaS 에 Google Workspace 가 적힌 위협. 해당 객체가 없어 뺀 1건은 legacy_map.csv 에 이유를 적었다.
- 9월 표의 이름, 설명, 원리, 출처는 그대로 옮겼다. 출처 주소는 9월 값이며 이번에 다시 확인하지 않았다. 보완 위협은 notes 가 `11-25 보완` 으로 시작하고, 관련 9월 ID 는 legacy_ids 가 아니라 notes 에 있다.
- 범주, 대상 객체, 엔진 유형, 행위자, Cross-SaaS 구분은 이번에 붙인 값이다. Resource 행위자와 관측은 9월 비고를 따랐다(관측 조건부와 STATIC, BOTH 는 STATE, DYNAMIC 과 NOT_OBSERVABLE, OUT 은 EVENT).
- 수집 상태는 engine main 305acb99 의 호출 목록과 api-list(approved), overlay 필드와 대조했다. `수집 중` 은 호출과 정규화가 있다는 뜻이고, 11-17 운영 정규화 출력에 그 타입이 없으면 경로 끝에 `[11-17 출력 0건]` 을 붙였다(3종). 위협별 필드 유무는 일부만 확인했다.

## 요약

| 구분 | 건수 |
| --- | --- |
| 범주 | Identity / Access 49, Integration / Automation 17, Policy / Configuration 19, Resource 18 |
| 수집 상태 | 수집 중 82, 미수집(API 있음) 9, API 밖 3, 필드 없음 5, 로그만 4 |
| 관측 | STATE 51, DIFF 31, EVENT 21 |
| 엔진 유형 후보 | unauthorized_access 34, privilege_escalation 15, data_exfiltration 23, accountability_loss 3, posture 28 |
| Cross-SaaS | direct 11, possible 20, none 72 |
| 9월 표 대응 | 157건 중 92건 |

## Cross-SaaS 시나리오로 키울 후보

- GWS-IDA-38: 검증 도메인 추가를 통한 신원 공간 확장
- GWS-IDA-39: 페더레이션 신원으로 타 SaaS 관리 평면 진입
- GWS-IDA-40: SCIM 프로비저닝 경로를 통한 계정 무단 생성
- GWS-INT-03: 타 SaaS API 토큰 및 클라우드 자격증명을 하드코딩한 App
- GWS-INT-11: iPaaS(Zapier, n8n) 커넥터를 통한 무인가 cross-SaaS 데이터 동기화
- GWS-RES-08: 개인 계정으로 자료 이관
- GWS-RES-09: 외부 클라우드로 자료 반출
- GWS-IDA-47: Google 그룹 공개 범위(누구나 가입·열람·게시)

## 남은 일

- 담당자 검토 후 v1. 11-17 출력 0건 타입은 실제 수집 여부를 다시 확인
- 시나리오와 판정 규칙, 시험 테넌트 재현
