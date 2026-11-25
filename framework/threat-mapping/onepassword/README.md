# 1Password 위협 매핑

1Password Business 객체 54종에 위협 45건을 매핑한 초안이다. 2026-11-24 우리 환경에서 실측해 정리한 목록 28건을 옮기고, 9월 표에서 9건, 공식 문서와 공격 기법 자료에서 8건을 더했다. 끝점이 1Password 인 Cross-SaaS 시나리오는 [scenarios.csv](scenarios.csv)에 있다(아래 「시나리오」).

- 버전 v0, 상태 초안(검토 전), 2026-11-25 작성, 같은 날 시나리오 추가
- 범위: 1Password Business 의 계정, 사용자·그룹, 금고와 항목, 공유·내보내기, 인증(Secret Key, Emergency Kit, Unlock with SSO), 프로비저닝(SCIM bridge, 자동 프로비저닝), 개발자 기능(서비스 계정, Connect, CLI, SSH agent, Environments, Kubernetes Operator, Terraform), 감사(Events API), 연동(Slack, SaaS Manager), 브라우저 확장. 9월 표에는 1Password 가 적힌 행이 없지만, 같은 위협이 1Password 에서도 성립하면 `legacy_ids` 를 달았다. 우리 플랜은 Business 이상으로 보이나 관리 화면으로 확인하지 못했다.
- 출처: 1Password 공식 문서(support.1password.com, www.1password.dev, developer.1password.com, 1Password 보안 설계 백서), MITRE ATT&CK(T1555.005 등, 2026-11 현재 번호), Push Security Browser & Identity Attacks Matrix, OWASP NHI Top 10 (2025), NIST SP 800-53 r5, 사고 보고(2023 Okta 지원 시스템 침해에 대한 1Password 글, 2025 비밀번호 관리자 확장 클릭재킹 발표와 1Password 글), 9월 AEGI_Threat_Mapping. `source_url` 은 모두 2026-11-25 에 직접 열어 확인했다.
- 수집 상태: 1Password 는 api-list·bindings 에 줄이 없고 engine 수집기(`scripts/collect/providers/onepassword.ts`)의 호출 셋으로 모은다. OP-01 은 사용자·그룹·그룹 구성원, OP-02 는 금고·금고 접근·항목 목록(메타데이터만, 값은 안 읽음), OP-03 은 Events API 감사 사건이다. overlay 는 `Account`, `Group`, `Item`, `ServiceAccount`, `User`, `Vault` 여섯이고 2026-11-24 4회차 운영 출력에 모두 있다. 서비스 계정은 수집 토큰 자신만, 금고는 그 토큰이 받은 금고만 보인다.
- notes 앞머리: `11-24 실측 목록`(우리 환경 실측 목록에서 옮김, 실측 값은 개수와 칸 이름만), `9월 표`(9월 위협을 이 SaaS 행으로 새로 옮김), `11-25 보완`(이번에 새로 찾음).
- 엔진 유형 후보는 Adapter Engine 위협 판정 명세 V2 를 그대로 따랐다. 1Password 가 직접 준 권한의 잔존(퇴사·이동), 관리자 행위, 파괴는 `posture` 다. 다른 SaaS 자격이 항목에 담긴 경로는 명세의 자격 보관(credential custody)으로 본다.
- 검증: 행마다 쓴 사람과 다른 사람이 근거 문서, 판정, 수집 칸, 9월 표 대응을 다시 봤다. 빠진 위협 찾기도 같이 했다. 근거가 무너져 뺀 행은 없다. 1Password 항목의 비밀 값은 열지 않았다.

## 요약

| 구분 | 건수 |
| --- | --- |
| 범주 | Identity / Access 18, Integration / Automation 11, Policy / Configuration 5, Resource 11 |
| 수집 상태 | 수집 중 23, API 밖 19, 로그만 3 |
| 관측 | STATE 31, DIFF 6, EVENT 8 |
| 종류 | Technique 25, Misconfiguration 20 |
| 엔진 유형 후보 | unauthorized_access 18, privilege_escalation 2, accountability_loss 2, posture 23 |
| Cross-SaaS | direct 19, possible 14, none 12 |
| 9월 표 대응 | 157건 중 102건 대응, 55건은 해당 없음(OAuth 앱·웹훅·AI 에이전트·메일·CRM·DB 처럼 1Password 에 없는 객체. 이유는 legacy_map.csv) |
| 객체 | 54종 중 위협이 걸린 것 40종, 수집 범위를 보이려고 남긴 위협 0건 객체 14종 |

2026-11-24 대시보드 「위협」 탭의 1Password 위협은 0건이다. 1Password 는 다른 SaaS 자격을 담는 곳이라 대부분 다른 SaaS 와 이어진다(direct 19).

## Cross-SaaS 시나리오로 키울 후보

- 1P-RES-01: 금고 항목 안 다른 SaaS 자격증명을 꺼내 씀
- 1P-RES-02: SSH 키 항목의 개인 키로 GitHub·서버에 접근
- 1P-INT-02: GitHub Actions 저장소 비밀에 둔 서비스 계정 토큰으로 금고를 읽음
- 1P-IDA-04, 1P-IDA-05: IdP(Okta·Entra·Google) 계정·그룹으로 Unlock with SSO 사용자의 금고와 1Password 그룹을 얻음
- 1P-IDA-03, 1P-IDA-09: 메일함을 쥔 사람이 계정 복구·초대 메일로 금고를 엶
- 1P-INT-06, 1P-INT-07, 1P-INT-10: Kubernetes Secret 사본, AWS Secrets Manager 동기화, Terraform 상태 파일에 남는 항목 값
- 1P-INT-09: SaaS Manager 오프보딩 흐름으로 다른 SaaS 계정과 자료를 넘김

## 시나리오

[scenarios.csv](scenarios.csv) 는 마지막 위협이 1Password 에서 일어나는 Cross-SaaS 시나리오 15줄이다(제외 없음). 2026-11-25 작성.

- 출처: [scenarios-backlog](../scenarios-backlog/README.md) 에서 끝점이 1Password 인 줄 3줄을 다듬어 옮기고(옮긴 줄은 백로그에서 지움), 12줄은 새로 만들었다. 팀원 폴더에는 1Password 를 가리키는 위협 행이 없어, 이 폴더 위협 가운데 다른 SaaS 가 경로에 드는 행을 「들어오는 문」으로 잡고 다른 폴더의 「다른 SaaS 진입」, 「메일함 장악」, 「저장소 비밀 노출」 같은 행을 앞 고리로 이었다.
- 들어오는 문: GitHub Actions 비밀의 서비스 계정 토큰(1P-INT-02, 6줄: 워크플로 수정, 서드파티 액션 태그, 포크 PR, Gemini 커넥터로 원격 실행 등), IdP 그룹·SSO(1P-IDA-04·05, 5줄), 메일함으로 초대·복구(1P-IDA-09·03), 드라이브의 Emergency Kit(1P-IDA-16), IdP 정지 뒤 1Password 계정 잔존(1P-IDA-10).
- 상태: 성립 2(4회차: SC-1P-01 저장소 쓰기 권한자가 워크플로를 고쳐 금고 값을 개인 웹훅으로 뺌, SC-1P-02 금고 단위 토큰 범위로 참조하지 않던 배포 키까지 나감), 후보 13. 우리 GitHub 워크플로 하나가 1Password 서비스 계정 토큰을 쓰는 것은 실측 사실이지만, 워크플로 → 서비스 계정 간선은 엔진 그래프에 아직 없다.
- 대표 유형: 비인가 접근 13, 추적성 상실 1, 비정상 설정 1.
- 못 만든 문: SCIM bridge, Kubernetes Operator, AWS Secrets Manager, Google Workspace 프로비저닝 작업, Events Reporting 토큰. 앞 고리가 될 GCP·AWS·Kubernetes·SIEM 위협 목록이 아직 없다.
- 끝점 기준: 사람이 마지막으로 내용을 보거나 쓰는 SaaS 를 끝점으로 봤다. 1Password 내용이 다른 SaaS 에서 읽히는 2줄(Slack Connect 외부 구성원이 1Password 알림을 읽음, Terraform 상태에 남은 항목 값을 GitHub 에서 읽음)은 백로그 BL-271·272 로 넘겼다.
- 엔진: 지금 잡는 줄은 없다. 공통으로 빠진 것은 워크플로 → 1Password 서비스 계정 간선, IdP 그룹 → 1Password 그룹 대응이다.

## 검토할 것

1. `manage_vault` 만 가진 사람·그룹을 권한 부여(grant)로만 볼지(1P-IDA-01). 지금은 항목 접근이 없고 스스로 항목 권한을 주는 길이라 `posture`.
2. 금고 항목 안 자격증명을 다른 SaaS 계정에 어디까지 이을지(1P-RES-01 등). URL 호스트만, 사용자 이름 해시까지, 금고별 개수만 중 무엇을 남길지. 1Password 자신의 자격(서비스 계정 토큰 등)을 먼저 가를지.
3. 1Password SSH 키 항목을 명세의 `ssh_key` 예외에서 뺄지(1P-RES-02). 1Password 는 개인 키를 항목 안에 담는다.
4. 엔진 유형 기준. 퇴사·이동 잔존(1P-IDA-10, 1P-IDA-11)과 대량 정지·삭제(1P-IDA-15)를 `posture` 로 두었다. 팀원 M365·GWS 의 같은 9월 위협 행은 `unauthorized_access` 다. Atlassian 폴더와 같이 맞출지.
5. 같은 1Password 계정의 활동을 읽는 것을 위협으로 셀지(1P-INT-05 Slack 채널, 1P-INT-11 SIEM·관제 업체의 Events 토큰). 센다면 조직 밖 업체만 셀지.
6. 수집을 넓힐지와 그 권한. 후보: 그룹 계정 권한, 다른 서비스 계정 목록, Employee 금고, 사본 쪽 객체(Kubernetes, AWS, Terraform). SCIM bridge 와 SaaS Manager 는 먼저 우리가 쓰는지 확인한다.
7. SC-1P-08 의 Okta 갈래. Entra 동적 그룹을 1Password 로 프로비저닝하는 것은 문서로 서지만, Okta 그룹 규칙으로 채운 그룹을 push 하는 것은 직접 말한 문서를 찾지 못했다. Okta 를 남길지.
8. IdP 쪽 시나리오(SC-1P-07~10, 14, 15)는 시험 환경에서 1Password 자동 프로비저닝·Unlock with SSO 를 먼저 켜야 한다. 켤지.

## 남은 일

- 검토 반영 후 v1
- 관리 화면으로 플랜과 정책 값 확인(방화벽 규칙, 2단계 인증, 공유·내보내기 정책)
- 판정 규칙, 시나리오의 시험 환경 세팅과 실행(후보 13줄)
