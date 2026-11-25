# Atlassian 위협 매핑

Atlassian 객체 226종에 위협 176건을 매핑한 초안이다. 대상은 조직 관리, Atlassian Guard, API 토큰·앱, Rovo, Automation, Jira, Confluence, Loom 이다. 2026-11-24 우리 환경에서 실측해 정리한 목록 108건을 옮기고, 9월 표에서 19건, 공식 문서와 공격 기법 자료에서 47건, 시나리오를 만들며 찾은 빈 곳 2건(ATL-INT-59, ATL-INT-60)을 더했다. 끝점이 Atlassian 인 Cross-SaaS 시나리오는 [scenarios.csv](scenarios.csv)에 있다(아래 「시나리오」).

- 버전 v0, 상태 초안(검토 전), 2026-11-25 작성, 같은 날 시나리오와 위협 2건 추가
- 범위: engine overlay 는 `atlassian`, `jira`, `confluence` 셋이지만 API 와 조직이 하나이고 대시보드도 하나로 묶으므로 한 폴더에 둔다. 제품은 `threat_group` 앞머리(조직, Guard, API, OAuth·Marketplace, Rovo, Automation, Jira, Confluence, Loom 등)로 나눈다. 우리 플랜(Teamwork Collection Premium, Guard Standard 와 Premium 애드온, Guard Detect)에 없는 기능(Enterprise 전용, JSM)도 넣고 notes 에 「우리 플랜에 없음」을 적었다.
- 출처: Atlassian 공식 문서(support.atlassian.com, developer.atlassian.com), MITRE ATT&CK, Push Security Browser & Identity Attacks Matrix, OWASP NHI Top 10 (2025), OWASP Top 10 for Agentic AI, 사고 보고(인포스틸러로 얻은 Jira 자격 사건 등), 9월 AEGI_Threat_Mapping. `source_url` 은 모두 2026-11-25 에 직접 열어 확인했다.
  - ATT&CK 는 2026-11 현재 번호를 쓴다. 번호가 바뀐 기법이 있다(예: 클라우드 로그 끄기 T1562.008 → T1685.002, 사칭 T1656 → T1684.001).
  - Push Security 저장소는 `pushsecurity/saas-attacks` 에서 `pushsecurity/browser-identity-attacks-matrix` 로 옮겨졌다. 기법 문서 주소를 쓴다.
- 수집 상태: engine main 305acb9 의 api-list(approved·legacy·blocked), overlay, 2026-11-24 4회차 운영 정규화 출력과 대조했다. 호출과 정규화가 있는데 4회차 출력에 그 타입이 없으면 경로 끝에 `[11-24 출력 0건]` 을 붙였다. 다른 SaaS 쪽에서 수집하는 연동(예: GCP 의 Gemini 커넥터)은 이 SaaS 기준 상태로 쓰고 상대 수집은 notes 에 적었다.
- notes 앞머리: `11-24 실측 목록`(우리 환경 실측 목록에서 옮김, 실측 값은 개수와 칸 이름만), `9월 표`(9월 위협을 이 SaaS 행으로 새로 옮김), `11-25 보완`(이번에 새로 찾음). 같은 위협이 여러 제품에 걸치면 한 행으로 합치고 notes 끝에 「합친 행」을 남겼다.
- 엔진 유형 후보는 Adapter Engine 위협 판정 명세 V2 를 그대로 따랐다. 관리자 신뢰·관리자 우회(스스로 권한 주기), 사람 본인 권한의 잔존, 파괴·피싱처럼 넷에 안 드는 것은 `posture` 이고, 데이터 반출은 조직 밖 목적지로 흐를 때만이다. 그래서 9월 표에서 옮긴 일부 행이 팀원 행과 다르다(검토할 것 1).
- 검증: 행마다 쓴 사람과 다른 사람이 근거 문서, 판정, 수집 칸, 9월 표 대응을 다시 봤다. 빠진 위협 찾기도 같이 했다. 근거가 무너져 뺀 행은 없다.

## 요약

| 구분 | 건수 |
| --- | --- |
| 범주 | Identity / Access 44, Integration / Automation 60, Policy / Configuration 36, Resource 36 |
| 제품 | 조직·Guard·API·앱 등 공통 72, Jira 45, Confluence 33, Loom 13, Rovo 11, JSM 1, 그 밖 1 |
| 수집 상태 | 수집 중 55, 미수집(API 있음) 25, API 밖 71, 필드 없음 9, 로그만 16 |
| 관측 | STATE 120, DIFF 21, EVENT 35 |
| 종류 | Technique 94, Misconfiguration 82 |
| 엔진 유형 후보 | unauthorized_access 42, privilege_escalation 16, data_exfiltration 14, accountability_loss 8, posture 96 |
| Cross-SaaS | direct 33, possible 33, none 110 |
| 9월 표 대응 | 157건 중 131건 대응, 26건은 해당 없음(코드·CI 영역, 다른 SaaS 고유 기능, 문서 확인 못 함. 이유는 legacy_map.csv) |
| 객체 | 226종 중 위협이 걸린 것 102종, 수집 범위를 보이려고 남긴 위협 0건 객체 124종 |

v0 처음 판(2026-11-25 오전)의 수집 상태 칸은 Gemini 커넥터 행 하나를 고치기 전 값이라 수집 중 56, API 밖 70 으로 적혀 있었다. 지금 값이 맞다.

## 엔진이 지금 잡는 것

2026-11-24 대시보드 「위협」 탭의 Atlassian 43건은 모두 자동화 규칙 경로다.

- ATL-INT-13(규칙 actor 이름만 남아 호출자가 사라짐, 추적성 상실): 40건
- ATL-INT-18(자동화가 Slack·Teams 채널에 씀, 비인가 접근): 2건
- 권한 상승 1건: ATL-INT-10, ATL-INT-11, ATL-INT-20 중 하나(어느 행인지 확인 못 함)

나머지 행은 수집, 정규화, 판정 규칙 중 무엇이 모자라는지를 notes 에 적었다. 데이터 반출 행은 자동화 요청 목적지의 조직 밖 판정(engine#509)이 있어야 선다.

## Cross-SaaS 시나리오로 키울 후보

- ATL-IDA-04: IdP(Okta·Entra) 그룹 동기화로 Atlassian 그룹·역할 얻기
- ATL-IDA-28: IdP 관리자가 SSO 신뢰로 Atlassian 사용자로 들어옴
- ATL-IDA-29: 메일함(Google Workspace·M365)을 쥔 사람이 비밀번호 재설정으로 Atlassian 계정을 가져감
- ATL-INT-15, ATL-INT-19: 다른 SaaS 사건이 Jira 자동화를 부르고, 자동화 연결로 Okta·Entra ID 를 바꿈
- ATL-INT-18, ATL-INT-36, ATL-INT-50: 자동화·앱이 Slack·Teams 채널에 이슈·페이지 내용을 펼침
- ATL-INT-28, ATL-INT-29, ATL-INT-30: Rovo·Teamwork Graph CLI·Rovo Dev 가 외부 MCP 서버와 코딩 에이전트에 내용을 넘김
- ATL-INT-44, ATL-INT-45, ATL-INT-53, ATL-INT-54: Gemini Enterprise·Salesforce Data 360 커넥터가 Jira·Confluence 권한을 못 지키고 읽어 감
- ATL-RES-02: 이슈·페이지에 적힌 다른 SaaS 토큰·키

## 시나리오

[scenarios.csv](scenarios.csv) 는 마지막 위협이 Atlassian 에서 일어나는 Cross-SaaS 시나리오 45줄이다(시나리오 32, 제외 13). 2026-11-25 작성.

- 출처: [scenarios-backlog](../scenarios-backlog/README.md) 에서 끝점이 Atlassian 인 줄을 다듬어 옮긴 것 31줄(같은 시나리오를 합치고 `saas_path` 를 바로잡음, 옮긴 줄은 백로그에서 지움), 새로 만든 것 14줄. 새 줄은 이 폴더 위협 가운데 다른 SaaS 가 경로에 드는 행을 「들어오는 문」으로 잡고, 다른 폴더 위협에서 그 문을 여는 앞 고리를 찾아 이었다.
- 들어오는 문: IdP 신원·그룹(Okta·Entra·Google 그룹 동기화, SCIM, SSO 신뢰), 메일함(비밀번호 재설정, 수신 메일), 다른 SaaS 에 둔 Atlassian 토큰(Salesforce Named Credential, Apps Script 속성, GitHub Actions 비밀, 중계 Worker, 채널·문서), 다른 SaaS 자동화가 Jira·Confluence 에 씀(Salesforce Flow, Workspace Studio, Slack 워크플로, Gemini 에이전트), 연동(GitHub for Atlassian), Rovo·Loom.
- 상태: 성립 2(4회차: SC-ATL-06 Salesforce 자동화가 비공개 영업 기회를 Confluence 에 올림, SC-ATL-12 저장소 쓰기 권한자가 Actions 비밀의 남의 Atlassian 토큰으로 Jira 를 부름), 후보 30, 제외 13. 2~3회차에 성립한 줄은 양식대로 `후보` 로 두고 결과를 `evidence` 에 적었다.
- 대표 유형(제외 빼고): 비인가 접근 23, 권한 상승 5, 비정상 설정 3, 추적성 상실 1.
- 제외 13: Atlassian 하나만 거치는 줄 9, 세션 장악이 전제인 줄 1, 공식 문서로 확인되지 않는 줄 2, 다른 줄(SC-ATL-18)에 합친 줄 1. 백로그에서 옮기며 시나리오로 세지 않기로 한 판단과 이유를 남기려고 지우지 않고 `제외` 로 두었다.
- 위협 보완: 「다른 SaaS 에 둔 사람 API 토큰으로 토큰 주인의 권한을 씀」(ATL-INT-59), 「다른 SaaS 자동화가 원본 내용을 Jira·Confluence 로 옮겨 원본 권한 없는 사람이 읽음」(ATL-INT-60) 을 이 작업에서 더했다. 이 둘이 없으면 시나리오 11줄이 비인가 접근으로 서지 않았다.
- 끝점 기준: 사람이 마지막으로 내용을 보거나 쓰는 SaaS 를 끝점으로 봤다(Gemini 폴더와 같은 기준). Atlassian 내용이 다른 SaaS 에서 읽히는 3줄(Rovo Slack 공유 계정, Jira·Confluence·Loom 의 Slack·Teams 알림, Salesforce Data 360 커넥터)은 백로그 BL-268~270 으로 넘겼다.
- 엔진: 사슬 전체를 지금 잡는 줄은 없다. 줄마다 notes 에 모자란 수집·간선·판정을 적었다.

## 검토할 것

1. 엔진 유형 기준. 9월 표에서 옮긴 퇴사·이동 잔존, 휴면 계정, 부계정, 탈취 자격 대량 수집 같은 행을 명세대로 `posture` 로 두었다. 팀원 행(M365·GWS·Okta)은 같은 9월 위협을 `unauthorized_access`·`accountability_loss` 로 붙였다. 폴더 사이에서 어느 기준으로 맞출지.
2. `actor` 허용값에 앱·연동이 없어 공급자 쪽 위협은 `계정 탈취·외부 공격자` 로 썼다. 허용값을 늘릴지.
3. ATL-IDA-01(조직 관리자의 「다른 사용자로 로그인」)을 명세의 관리자 신뢰대로 `posture` 로 둘지, 예외로 비인가 접근으로 셀지.
4. 데이터 반출 판정에 쓸 조직 밖 목적지 기준(자동화 요청 host, 메일 도메인, 승인 목록)과 Rovo 의 외부 LLM·MCP 사용을 반출로 셀지(ATL-INT-08, ATL-INT-28).
5. 수집을 넓힐지. 후보: 시스템 웹훅·워크플로 전이 규칙, 토큰·키·서비스 계정 자격(`/admin/api-access/v1`), 프로젝트 역할 기본 구성원, Jira 앱 옵션(`application-properties`). Loom 은 공개 API 가 없어 Loom 행이 모두 `API 밖` 이다. Atlassian MCP 의 Loom 도구로 수집할지.
6. 우리 환경 값 확인. 인증 정책에 SSO 를 끈 구성원이 있고, 승인 도메인이 「모든 도메인」인 앱이 있다. 사이트가 역할 전환 모드인지, Loom 등급과 관리 워크스페이스 여부는 아직 못 봤다.
7. 시나리오 끝점 기준(사람이 마지막으로 보거나 쓰는 SaaS)이 팀 기준과 맞는지. 맞으면 BL-268~270 은 Slack·Salesforce 담당 몫이다.
8. 앞 고리에 맞는 위협 행이 다른 폴더에 없는 시나리오가 있다(notes 에 「위협 행 없음」). 조직 안 누구나 가입하는 Google 그룹(SC-ATL-20), 메일함을 Jira 에 OAuth 로 잇기(SC-ATL-29), 다른 SaaS 권한 회수 뒤 Rovo 사본이 늦게 따라감(SC-ATL-31), 캘린더 연결(SC-ATL-32). 그 폴더 담당에게 행을 요청할지.
9. 프롬프트 주입이 전제인 SC-ATL-30 을 시나리오로 셀지.

## 남은 일

- 검토 반영 후 v1
- 수집 빈틈(필드 없음·미수집·API 밖) 메우기와 정규화 보강(누구나 노드, 공유 권한 간선, 자동화 간선의 스페이스 범위)
- 판정 규칙, 시나리오의 시험 환경 세팅과 실행(후보 30줄)
