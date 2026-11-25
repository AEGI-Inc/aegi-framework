# GitHub 위협 매핑

GitHub 객체 39종에 위협 83건을 매핑한 초안이다. 2026-09 표의 GitHub 해당분 72건을 옮기고 11건을 보완했다.

- 버전 v0, 상태 초안(검토 전), 2026-11-25 작성
- 범위: 9월 표 「AEGI_Threat_Mapping」에서 적용 SaaS 에 GitHub 가 적힌 위협. 
- 9월 표의 이름, 설명, 원리, 출처는 그대로 옮겼다. 출처 주소는 9월 값이며 이번에 다시 확인하지 않았다. 보완 위협은 notes 가 `11-25 보완` 으로 시작하고, 관련 9월 ID 는 legacy_ids 가 아니라 notes 에 있다.
- 범주, 대상 객체, 엔진 유형, 행위자, Cross-SaaS 구분은 이번에 붙인 값이다. Resource 행위자와 관측은 9월 비고를 따랐다(관측 조건부와 STATIC, BOTH 는 STATE, DYNAMIC 과 NOT_OBSERVABLE, OUT 은 EVENT).
- 수집 상태는 engine main 305acb99 의 호출 목록과 api-list(approved), overlay 필드와 대조했다. `수집 중` 은 호출과 정규화가 있다는 뜻이고, 11-17 운영 정규화 출력에 그 타입이 없으면 경로 끝에 `[11-17 출력 0건]` 을 붙였다(9종). 위협별 필드 유무는 일부만 확인했다.

## 요약

| 구분 | 건수 |
| --- | --- |
| 범주 | Identity / Access 24, Integration / Automation 28, Policy / Configuration 11, Resource 20 |
| 수집 상태 | 수집 중 78, 미수집(API 있음) 3, 필드 없음 1, 로그만 1 |
| 관측 | STATE 47, DIFF 15, EVENT 21 |
| 엔진 유형 후보 | unauthorized_access 25, privilege_escalation 18, data_exfiltration 17, accountability_loss 4, posture 19 |
| Cross-SaaS | direct 8, possible 22, none 53 |
| 9월 표 대응 | 157건 중 72건 |

## Cross-SaaS 시나리오로 키울 후보

- GH-IDA-04: IT 통제 밖 로컬/미관리 계정 유지 (Shadow IAM)
- GH-INT-03: 타 SaaS API 토큰 및 클라우드 자격증명을 하드코딩한 App
- GH-INT-13: 타 SaaS 배포 및 프로비저닝을 연쇄 트리거하는 복합 Workflow 악용
- GH-INT-18: SaaS 연동 커넥터 간 권한 격차(Privilege Disparity) 악용
- GH-RES-07: 개인 계정으로 자료 이관
- GH-RES-08: 외부 클라우드로 자료 반출
- GH-INT-24: 공개 저장소에 self-hosted runner
- GH-INT-28: Copilot 에이전트·MCP 서버의 저장소 권한

## 남은 일

- 담당자 검토 후 v1. 11-17 출력 0건 타입은 실제 수집 여부를 다시 확인
- 시나리오와 판정 규칙, 시험 테넌트 재현
