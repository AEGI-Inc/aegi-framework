# Microsoft 365 위협 매핑

M365(Entra ID, Exchange, SharePoint·OneDrive, Teams, Power Platform, Purview, Intune·Defender 기기) 객체 89개에 위협 209건을 매핑한 초안이다.

- 버전 v0, 상태 초안(검토 전), 2026-11-24 처음 작성, 2026-11-25 재검토로 객체 23개·위협 41건 추가
- 범위: 엔진이 지금 수집·정규화하는 20타입(engine `scripts/collect/profile-binding/overlays/microsoft/`)에, 수집하지 않지만 위협이 생기는 객체를 모두 넣었다. Graph v1.0 IR 객체 타입 468개 중 보안 관련 타입을 대조해 골랐고, Graph 밖(Exchange·SharePoint·Teams PowerShell, Power Platform, Defender for Endpoint, 온프레미스 AD) 객체도 넣었다. 모든 객체에 위협이 하나 이상 있다.
- 11-25 추가: Intune(스크립트·앱 배포, 원격 초기화, 준수 정책), 접근 패키지·접근 검토·수명 주기 워크플로, 토큰 발급 확장, B2B 직접 페더레이션·셀프 가입, Entra → 다른 SaaS 프로비저닝, PIM for Groups, 사용자 지정 역할·인증 강도·보안 특성, Exchange RBAC·커넥터·저널, SPFx, Power Pages, 공개 Copilot 에이전트, 회의 녹화, Outlook 클라이언트 지속성, 비밀번호 스프레이·MFA 피로·디렉터리 열거
- 출처: 9월 AEGI_Threat_Mapping 4갈래 157건, MITRE ATT&CK, CISA ScubaGear M365 기준(aad, exo, sharepoint, teams, securitysuite, powerplatform; 2026-11-24 main 원문과 대조), Push Security SaaS 공격 매트릭스, OWASP NHI Top 10 2025, SigmaHQ M365 룰, Microsoft 사고 보고(Midnight Blizzard 2024, Storm-1811, Storm-2372 등)

## 요약

| 구분 | 건수 |
| --- | --- |
| 범주 | Identity / Access 83, Integration / Automation 48, Policy / Configuration 47, Resource 31 |
| 수집 상태 | 수집 중 98, 미수집(API 있음) 63, API 밖 36, 권한 없음 7, 필드 없음 4, 로그만 1 |
| 관측 | STATE 106, DIFF 68, EVENT 35 |
| 엔진 유형 후보 | unauthorized_access 55, privilege_escalation 34, data_exfiltration 33, accountability_loss 10, posture 77 |
| Cross-SaaS | direct 37, possible 48, none 124 |
| 9월 표 대응 | 157건 중 130건 대응, 27건은 GitHub·Slack·CRM 고유라 해당 없음(이유는 legacy_map.csv) |

## Cross-SaaS 시나리오로 키울 후보

- M365-IDA-65: Entra 관리자가 SSO 앱 배정으로 다른 SaaS(AWS, GitHub, Salesforce) 관리자 획득
- M365-RES-21: 메일함 장악으로 다른 SaaS 비밀번호 재설정
- M365-INT-04: GitHub Actions OIDC 토큰으로 M365 앱 권한 획득(페더레이션 자격증명)
- M365-INT-31, M365-INT-32: Power Automate 흐름으로 외부 반출, 공유 연결로 남의 권한 사용
- M365-IDA-58, M365-INT-27: 같은 이메일의 다른 IdP 계정, 이메일 클레임으로 사용자를 찾는 앱
- M365-INT-41: Entra 프로비저닝(SCIM)으로 다른 SaaS 에 관리자 계정 생성
- M365-INT-42, M365-INT-47: 토큰 발급 확장의 외부 호출, 공개 Copilot 에이전트의 커넥터 데이터

## 남은 일

- 검토 반영 후 v1
- 수집 빈틈(필드 없음·권한 없음·미수집) 메우기: 앱 자격증명·리디렉트 URI 정규화, 정책·페더레이션·메일 규칙 호출 추가(engine 작업 진행 중)
- 시나리오와 판정 규칙, 시험 테넌트 재현
