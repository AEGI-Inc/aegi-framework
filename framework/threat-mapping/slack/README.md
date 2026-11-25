# Slack 위협 매핑

Slack 객체 37종에 위협 86건을 매핑한 초안이다. 2026-09 표의 Slack 해당분 77건을 옮기고 9건을 보완했다.

- 버전 v0, 상태 초안(검토 전), 2026-11-25 작성
- 범위: 9월 표 「AEGI_Threat_Mapping」에서 적용 SaaS 에 Slack 이 적힌 위협.
- 9월 표의 이름, 설명, 원리, 출처는 그대로 옮겼다. 출처 주소는 9월 값이며 이번에 다시 확인하지 않았다. 보완 위협은 notes 가 `11-25 보완` 으로 시작하고, 관련 9월 ID 는 legacy_ids 가 아니라 notes 에 있다.
- 범주, 대상 객체, 엔진 유형, 행위자, Cross-SaaS 구분은 이번에 붙인 값이다. Resource 행위자와 관측은 9월 비고를 따랐다(관측 조건부와 STATIC, BOTH 는 STATE, DYNAMIC 과 NOT_OBSERVABLE, OUT 은 EVENT).
- 수집 상태는 engine main 305acb99 의 호출 목록과 api-list(approved), overlay 필드와 대조했다. `수집 중` 은 호출과 정규화가 있다는 뜻이고, 11-17 운영 정규화 출력에 그 타입이 없으면 경로 끝에 `[11-17 출력 0건]` 을 붙였다(4종). 위협별 필드 유무는 일부만 확인했다.

## 요약

| 구분 | 건수 |
| --- | --- |
| 범주 | Identity / Access 38, Integration / Automation 28, Policy / Configuration 6, Resource 14 |
| 수집 상태 | 수집 중 62, 미수집(API 있음) 4, API 밖 8, 필드 없음 11, 로그만 1 |
| 관측 | STATE 51, DIFF 13, EVENT 22 |
| 엔진 유형 후보 | unauthorized_access 31, privilege_escalation 11, data_exfiltration 19, accountability_loss 5, posture 20 |
| Cross-SaaS | direct 12, possible 18, none 56 |
| 9월 표 대응 | 157건 중 77건 |

## Cross-SaaS 시나리오로 키울 후보

- SLACK-IDA-06: IT 통제 밖 로컬/미관리 계정 유지 (Shadow IAM)
- SLACK-IDA-18: 통합에 저장된 API 시크릿을 읽어 횡적 이동
- SLACK-IDA-21: 조직이 쓰지 않는 IdP의 소셜 로그인으로 SSO 우회
- SLACK-IDA-28: 외부 협업 경계 완화로 게스트 범위 과다
- SLACK-IDA-29: 페더레이션 신원으로 타 SaaS 관리 평면 진입
- SLACK-INT-03: 타 SaaS API 토큰 및 클라우드 자격증명을 하드코딩한 App
- SLACK-INT-12: 타 SaaS 배포 및 프로비저닝을 연쇄 트리거하는 복합 Workflow 악용
- SLACK-INT-17: iPaaS(Zapier, n8n) 커넥터를 통한 무인가 cross-SaaS 데이터 동기화

## 남은 일

- 담당자 검토 후 v1. 11-17 출력 0건 타입은 실제 수집 여부를 다시 확인
- 시나리오와 판정 규칙, 시험 테넌트 재현
