# 연결 방법 목록

SaaS 두 개가 서로 이어지는 방법 297가지를 한 표로 줄였다. 방법마다 "무엇이 같으면 이어진 것으로 보는가"를 적었다. API 이름, 필드, 확인 순서, 출처는 `connection-rules/` 폴더의 YAML 에 있다.

표 읽는 법:

- **방법**: 규칙 YAML 의 `id`. 이름일 뿐이고 뜻은 옆 칸에 있다.
- **같아야 하는 값**: 이 값이 양쪽에서 같으면 이어진 것이다. 괄호는 근거의 세기다.
  - ID: 한쪽 설정에 상대의 ID 가 적혀 있다 (가장 셈)
  - 이름: 한쪽 설정에 상대의 이름이나 도메인이 적혀 있다
  - 지문: 비밀 주소나 인증서의 해시가 양쪽에서 같다
  - 사람: 같은 사람의 계정이라는 것으로만 이어진다
  - 로그: 감사 로그의 ID 나 시각이 맞는다 (가장 약함)
- **시험 환경**: 2026-10 시험 환경에서 확인한 결과. 연결됨, 설정만(설정은 있는데 쓴 기록이 없음), 안 씀, 안 보임(본 로그 기간 안에 흔적 없음), 모름(필요한 값을 아직 못 읽음), 환경 밖(상대가 시험 환경 밖), 만들 수 없음, 테넌트 없음(Atlassian·Salesforce·Workday. 아직 시험 테넌트 없음)

## Okta ↔ GitHub

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| enterprise_saml_sso | Okta 가 GitHub 엔터프라이즈 로그인 (SAML) | 앱 githubEnterprise = 엔터프라이즈 slug (이름), GitHub IdP issuer = Okta entityID (ID), IdP 인증서 (지문), SAML nameId = Okta login (사람) | 연결됨. 신원 5개 중 3개 연결, 2개 환경 밖 |
| org_saml_sso | 같은 SAML 을 조직 단위로 | 앱 githubOrg = 조직 login (이름), 조직 IdP issuer (ID), 인증서 (지문) | 모름 |
| scim_provisioning | Okta 가 GitHub 계정 생성·삭제 | 배정 externalId = SCIM ID (ID), SCIM username = Okta login (사람) | 안 씀 |
| team_sync | GitHub 팀 구성원을 Okta 그룹으로 | 팀 동기화 group_id = Okta 그룹 ID (ID) | 만들 수 없음 (엔터프라이즈 SAML 이 Okta 라 조직 팀 동기화 불가, 엔터프라이즈 수준은 Entra ID 만. 팀 동기화 API 403) |
| workflows_github_connector | Okta Workflows 가 GitHub API 호출 | GitHub 승인 앱 이름 Okta Workflows (이름), 연결 생성과 승인 시각 (로그) | 안 보임 |
| webhook_to_workflows | GitHub 웹훅 → Okta Workflows 흐름 | 웹훅 호스트 = `<조직>.workflows.okta.com` (이름) | 연결됨 (2026-10-05 시험용 연동, 팀원이 만든 조직 웹훅 → 시험 흐름) |
| shared_external_server | 같은 외부 서버가 GitHub 웹훅을 받고 Okta API 호출 | Okta 쪽에 서버 주소가 없어 같은 값 없음 | 모름 (review) |
| verified_domain_email | 같은 사람 | GitHub 검증 도메인 이메일 = Okta login (사람) | 안 씀 |
| content_ref | 본문 링크 | 커밋·PR 본문의 Okta 주소 호스트 | 모름 |
| actions_to_workflows | GitHub Actions → Okta Workflows 흐름 주소 | 워크플로 파일의 호출 호스트 = `<조직>.workflows.okta.com` (이름), 실행 시각 (로그) | 모름 (파일 미수집) |
| actions_calls_okta | GitHub Actions 가 Okta API 토큰으로 Okta 호출 | 파일의 호출 호스트 = Okta 조직, 비밀 이름 (이름), 실행 시각 (로그) | 모름 |
| copilot_okta_mcp | GitHub Copilot(VS Code)이 Okta MCP 서버로 Okta 관리 작업 | mcp.json 의 client ID = Okta OIDC 앱 client ID (ID) | 모름 (2026-10-26 더함) |

## Okta ↔ GWS

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| saml_sso | Okta 가 GWS 로그인 (SAML) | 앱 domain = GWS 도메인 (이름), GWS SSO 프로필 entityId = Okta entityID (ID), 인증서 (지문) | 환경 밖 (옛 aegi.site 앱) |
| swa_sign_on | Okta 가 Google 비밀번호를 대신 입력 | 앱 domain = GWS 도메인 (이름) | 설정만 (aegi.men 앱) |
| provisioning_push | Okta → GWS 계정 생성·수정 | 배정 externalId = GWS 사용자 ID (ID), GWS 토큰 목록의 Okta (이름) | 안 씀 |
| import | GWS 사용자를 Okta 로 가져오기 | 배정 externalId = GWS 사용자 ID (ID), 배정 userName = GWS 이메일 (사람) | 연결됨 (aegi.men), 환경 밖 (aegi.site) |
| oidc_sso | OIDC 로 GWS 로그인 | GWS OIDC 프로필 clientId = Okta 앱 client_id (ID), issuer = Okta 주소 (이름) | 안 씀 |
| google_idp_for_okta | Google 계정으로 Okta 로그인 | Okta IdP 클라이언트 ID = Google OAuth 클라이언트 (ID) | 안 씀 |
| workflows_gws_connector | Okta Workflows 가 GWS 관리 API 호출 | Okta 연결 alternateId googledirectory, GWS 토큰 감사 app_name Okta Workflows (이름), 연결 생성·승인 시각과 사람 (로그) | 연결됨 (2026-10-05 사용자가 만든 workflows-gws-admin) |
| script_calls_okta | Apps Script → Okta, 또는 Okta Event Hook → Apps Script | 코드의 Okta 주소, 훅 주소 = 웹앱 배포 주소 (이름) | 안 씀 |
| workflows_http_to_apps_script | Okta Workflows HTTP 카드 → Apps Script 웹앱 | 카드 URL = 웹앱 배포 주소 (ID, 콘솔), 실행 시각 (로그) | 안 씀 (흐름 3개에 HTTP 카드 없음) |
| apps_script_to_workflows | Apps Script → Okta Workflows 흐름 주소 | 코드의 호출 호스트 = `<조직>.workflows.okta.com` (이름), 실행 시각 (로그) | 안 씀 |
| workflows_google_user_connectors | Okta Workflows 의 Gmail·Drive·Calendar·Sheets·Docs 커넥터 (사용자 OAuth) | GWS 토큰 감사 app_name·client_id (이름), 연결 생성과 승인 시각·사람 (로그) | 모름 (2026-10-14 더함. 우리 로그의 연결은 googledirectory 만) |
| gemini_agent_import | Okta 가 Google 의 Gemini Enterprise Agent Platform 에이전트를 가져와 등록 | Okta 에 넣은 OAuth Client ID = Google OAuth 클라이언트 ID (ID), 리디렉션 URI 의 Okta 주소 = Okta 조직 주소 (이름) | 모름 (2026-10-26 더함) |

## Okta ↔ Slack

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| saml_sso | Okta 가 Slack 로그인 (Business+·Enterprise) | 앱 domain = Slack 도메인 (이름), Slack IdP issuer = Okta entityID (ID, 관리 화면만) | 환경 밖 (옛 Slack), aegico 는 안 씀 |
| swa_sign_on | 비밀번호 대신 입력 | 앱 domain = Slack 도메인 (이름) | 환경 밖 |
| scim_provisioning | Okta → Slack 계정·그룹 | 배정 externalId = Slack 사용자 ID (ID), 그룹 푸시 매핑 = 사용자 그룹 (ID) | 환경 밖, aegico 는 안 씀 |
| import | Slack 사용자를 Okta 로 | 배정 externalId = Slack 사용자 ID (ID) | 환경 밖 |
| workflows_slack_connector | Okta Workflows 가 Slack 메시지 받기·보내기 | Slack 의 Okta Workflows 앱 (이름), 연결과 설치 시각 (로그), 흐름 실행 기록의 Team ID (ID) | 환경 밖 (slack-helpdesk = 예전 팀 T0C2NC3C892), aegico 는 안 씀 |
| slash_command_to_workflows | Slack 명령이 Okta Workflows 흐름 주소를 직접 호출 | 명령 주소 호스트 = `<조직>.workflows.okta.com` (이름), 흐름 실행 기록의 team_id·앱 ID (로그), 실행과 Okta 초기화 시각 (로그) | 연결됨 (2026-10-05 시험용 연동, /conn-wf → 시험 흐름), 예전 팀 /reset-mfa 는 환경 밖 |
| slash_command_via_server | Slack 명령 → 외부 서버 → Okta API | 명령 주소 호스트 (이름), 서버 기록 okta_client_id = Okta 앱 ID (로그) | 연결됨 (/mfa-reset) |
| email_match | 같은 사람 | Slack 이메일 = Okta login (사람) | 연결됨 |
| workflows_http_to_slack_webhook | Okta Workflows HTTP 카드 → Slack 수신 웹훅·워크플로 트리거 | 카드 URL 지문 = Slack 웹훅 지문 (지문, 콘솔), 실행과 메시지 시각 (로그) | 안 씀 |
| workflows_slack_admin_connector | Okta Workflows Slack Admin 커넥터 (사용자·그룹 관리) | Slack 의 Okta OAuth 앱 (이름), 연결과 설치 시각·사람 (로그) | 모름 (2026-10-14 더함) |
| ema_slack_mcp | Okta 가 AI 클라이언트의 Slack MCP 서버 접근을 승인 (XAA, ID-JAG) | Slack 의 ID-JAG issuer URL = Okta 조직 주소 (이름), id_jag 발급 ↔ mcp_slack_* 호출 시각 (로그 시각) | 모름 (2026-10-26 더함) |

## GitHub ↔ Slack

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| github_app_for_slack | GitHub 공식 Slack 앱 | GitHub 설치 앱 slack ↔ Slack 의 GitHub 앱 (이름) | 설정만 (Slack 쪽 상대 없음) |
| slack_enterprise_search | Slack 검색이 GitHub 저장소 읽기 | GitHub 설치 앱 slack-enterprise-search-for-github (이름) | 설정만 |
| github_webhook_to_slack | GitHub 웹훅 → Slack 웹훅 직접 | 웹훅 주소 sha256 = Slack 웹훅 지문 (지문) | 안 씀 |
| actions_to_slack | Actions 가 Slack 에 게시 | 비밀 이름, 워크플로 파일의 Slack 주소 지문 (이름, 지문) | 모름 |
| slack_workflow_connector_github | Slack 워크플로의 GitHub 단계 | GitHub 승인 앱, Slack 워크플로 단계 (이름) | 안 씀 |
| slash_command_via_server | Slack 명령 → 외부 서버 → GitHub 커밋 | 명령 주소 호스트 = 웹훅 호스트 (이름), 서버 기록 커밋 SHA = GitHub 커밋 (로그) | 연결됨 (/devbot) |
| person_link | 같은 사람 | 커밋 이메일 = Slack 이메일, SAML → Okta → Slack (사람) | 연결됨 |
| content_ref | 본문 링크 | Slack 메시지의 github.com 주소 | 모름 |
| github_webhook_to_slack_workflow | GitHub 웹훅 → Slack 워크플로 웹훅 트리거 | 웹훅 주소 지문 = 트리거 주소 지문 (지문, 트리거 주소 API 없음), 배달과 실행 시각 (로그) | 안 씀 |
| copilot_cloud_agent_in_slack | Slack 의 GitHub 앱에서 Copilot 클라우드 에이전트에게 작업을 시킴 | GitHub 설치 앱 접근 저장소 = 채널 기본 저장소 (이름), 같은 사람 (사람), 설치 시각 (로그 시각) | 모름 (2026-10-26 더함) |
| copilot_connector_slack | GitHub Copilot 이 GitHub 검증 Slack 커넥터로 Slack 을 부름 (public preview) | 같은 사람 (사람). 양쪽 흔적은 문서에 없음 | 모름 (2026-10-30 더함) |

## GitHub ↔ GWS

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| google_saml_idp | GWS 를 IdP 로 GitHub 로그인 | GitHub IdP issuer 의 idpid = GWS 고객 ID (ID), nameId = GWS 이메일 (사람) | 안 씀 |
| github_oidc_to_google_cloud | Actions OIDC 로 Google Cloud 사용 | Google Cloud 제공자 조건의 저장소·조직 = GitHub 저장소·조직 (이름) | 모름 |
| secret_in_actions | Google 서비스 계정 키를 Actions 비밀에 | 비밀 이름만 (이름) | 모름 |
| apps_script_calls_github | Apps Script → api.github.com | 코드의 호출 호스트 (이름) | 모름 |
| github_webhook_to_apps_script | GitHub 웹훅 → Apps Script 웹앱 | 웹훅 주소 = 웹앱 배포 주소 (ID) | 안 씀 |
| person_link | 같은 사람 | 커밋·검증 이메일 = GWS 이메일, SAML → Okta → GWS ID (사람) | 연결됨 |
| content_ref | 본문 링크 | 이슈·커밋의 Drive 주소 | 모름 |
| actions_to_apps_script | GitHub Actions → Apps Script 웹앱 | 파일의 호출 주소 지문 = 웹앱 배포 주소 (ID), 실행 시각 (로그) | 모름 (파일 미수집) |
| github_for_google_chat | Google Chat 의 GitHub 앱 (Marketplace) | GWS 설치 앱 = GitHub 승인 OAuth 앱 (이름), 구독 저장소 (이름), 같은 사람 (사람) | 모름 (2026-10-14 더함) |
| google_chat_incoming_webhook | GitHub Actions → Google Chat 수신 웹훅 | 파일의 URL 지문 (지문, chat.googleapis.com) 또는 시크릿 이름 (이름), workflows.completed_workflow_run 감사 시각 (로그) | 모름 (2026-10-15 더함) |
| gemini_github_integration | Gemini 가 GitHub 저장소를 읽고 씀 (Marketplace GitHub Integration + google-integrations 앱) | GitHub 설치 앱 google-integrations = GWS 설치 앱 GitHub Integration (이름), 같은 사람 (사람), ADD_APPLICATION APP_ID = 556146275714 (로그 ID), 설치 ↔ 토큰 발급 시각 (로그 시각) | 설정만 |
| gemini_enterprise_github | Gemini Enterprise GitHub 데이터 저장소가 GitHub 를 읽고 씀 | Organization Name = GitHub 조직 (이름), Client ID (ID), SetUpDataConnector ↔ 앱 설치 시각 (로그 시각) | 모름 (2026-10-26 더함) |
| clasp_credentials_in_actions | GitHub Actions 가 clasp 자격 증명(사용자 OAuth 갱신 토큰)으로 Apps Script 를 배포 | 비밀 넣은 사람 = clasp login 한 Google 사용자 (사람), 실행 구간 ↔ 버전 생성 시각 (로그 시각) | 모름 (2026-10-28 더함) |

## GWS ↔ Slack

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| google_saml_idp_for_slack | GWS 를 IdP 로 Slack 로그인 | Slack IdP issuer = Google SAML 앱 (ID, Slack 은 관리 화면만), Slack 이메일 = GWS 이메일 (사람) | 안 씀 |
| slack_app_google_oauth | Slack 의 Google Drive·Calendar 앱 | GWS 토큰 목록의 앱 = Slack 설치 앱 (이름) | 안 씀 |
| apps_script_webhook | Apps Script → Slack 웹훅 | 코드·속성의 웹훅 지문 = Slack 웹훅 지문 (지문), 이름 (이름), 스크립트 소유자 = 앱 설치자 (사람) | 연결됨 (Customer Intake Sync, Team Directory), 환경 밖 (옛 웹훅) |
| gmail_forward_to_slack | Gmail 자동 전달 → Slack 채널 메일 | 전달 주소 = Slack 채널 이메일 (이름) | 안 씀 |
| slack_workflow_google | Slack 워크플로의 Google 단계 | GWS 토큰 이름, Slack 워크플로 (이름) | 안 씀 |
| person_link | 같은 사람 | Slack 이메일 = GWS 이메일 (사람) | 연결됨 |
| content_ref | 본문 링크, Drive 권한 | Slack 메시지의 Drive 주소, Drive 권한 이메일 = Slack 이메일 | 모름 |
| slack_request_to_apps_script | Slack 슬래시 명령·이벤트·상호작용 → Apps Script 웹앱 | 요청 주소(호스트+경로) = 웹앱 배포 주소 (ID), 실행 시각 (로그) | 연결됨 (2026-10-05 시험용 연동, /conn-gas → AEGI Conn Test) |
| apps_script_slack_api | Apps Script 가 Slack 토큰으로 Web API 호출 | 코드의 호출 호스트 slack.com (이름), 소유자 = 앱 설치자 (사람), 실행과 메시지 시각 (로그) | 안 씀 (코드 기준) |
| slack_for_gmail_addon | Gmail 부가기능 Slack for Gmail (Marketplace) | GWS 설치 앱·토큰 범위 (이름), 같은 사람 (사람) | 모름 (2026-10-14 더함) |
| google_auth_signin | Slack 이 Google Auth (OAuth 2.0) 로 로그인 받음 | GWS 토큰 감사의 Slack 클라이언트 (이름), 이메일 (사람) | 모름 (2026-10-14 더함. aegico 는 Enterprise 라 해당 없음) |
| gemini_enterprise_slack_datastore | Gemini Enterprise 가 Slack 을 읽고 씀 (데이터 저장소) | Team ID = Slack team_id (ID), 같은 사람 (사람), SetUpDataConnector ↔ 앱 설치 시각 (로그 시각) | 모름 (2026-10-26 더함) |
| gemini_enterprise_app_for_slack | Slack 안에서 Gemini Enterprise 검색을 씀 | 등록한 워크스페이스 ID = Slack team_id (ID), 설치 앱 이름 (이름) | 모름 (2026-10-26 더함) |
| workspace_studio_slack | Workspace Studio 흐름의 Slack 연동 단계 (베타) | Studio 커넥터 설정 = On (이름), Studio 흐름 소유자 = Slack 앱 설치자 (사람), Studio 단계 실행 시각 안에 Slack 메시지의 앱 = Google Integration (로그 시각) | 연결됨 (2026-10-26 시험용 흐름 → #eng-support) |
| slack_domain_wide_google_auth | Slack 의 Google Calendar·Drive 앱을 도메인 전체로 자동 연결 | Slack 앱의 Domain-wide Authentication 도메인 = GWS 도메인 (이름), 멤버 email = GWS 사용자 (사람) | 모름 (2026-10-28 더함) |

## Okta ↔ Atlassian

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| saml_sso | Okta 가 Atlassian 로그인 (SAML, Guard) | Atlassian IdP Entity ID = Okta entityID (ID), SP Unique ID (ID), SSO URL·Base URL (이름), 인증서 (지문), 이메일 (사람) | 테넌트 없음 |
| scim_provisioning | Okta → Atlassian 디렉터리 사용자·그룹 | SCIM base URL 디렉터리 ID (ID), 배정 externalId (ID), email = 관리 계정 email (사람) | 테넌트 없음 |
| workflows_atlassian_connector | Okta Workflows Atlassian Admin 커넥터 | 연결의 Directory ID (ID), 감사 actor.auth 토큰 (로그) | 테넌트 없음 |
| email_match | 같은 사람 | Okta login = Atlassian 계정 email (사람) | 테넌트 없음 |
| ema_atlassian_mcp | Okta 가 AI 클라이언트의 Atlassian MCP 서버 접근을 승인 (XAA, ID-JAG) | Atlassian 에 넣은 IdP URL = Okta 조직 주소 (이름), Okta Resource 앱 Audience = Atlassian cloudId (ID), id_jag 발급 ↔ Invoked tool 시각 (로그 시각) | 모름 (2026-10-26 더함) |

## GitHub ↔ Atlassian

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| github_for_atlassian_app | GitHub for Atlassian (GitHub App) 이 Jira 에 개발 정보 전달 | GitHub 설치 조직 = Jira 연결 조직 (이름), app_slug (이름), 설치 시각 (로그) | 테넌트 없음 |
| dvcs_connector_legacy | Jira DVCS 계정 (GHE OAuth 앱, 레거시) | Client ID (ID), callback = Jira base URL (이름) | 테넌트 없음 |
| actions_to_jira | GitHub Actions 가 Atlassian API 토큰으로 Jira 호출 | 비밀 이름·호출 호스트 (이름), 토큰 소유자 (사람), 토큰 ID·시각 (로그) | 테넌트 없음 |
| jira_automation_to_github | Jira Automation Send web request → api.github.com | 룰 URL (이름), GitHub 토큰 동작 시각 (로그) | 테넌트 없음 |
| github_webhook_to_jira_automation | GitHub 웹훅 → Jira Automation Incoming webhook | 웹훅 주소 지문 = 트리거 URL 지문 (지문), 배달과 실행 시각 (로그) | 테넌트 없음 |
| smart_links_github | 본문의 github.com Smart Link | 본문 주소 = 저장소 (이름) | 테넌트 없음 |
| confluence_github_marketplace_apps | Confluence 용 제3자 GitHub 앱 | 설치 앱 이름 (이름) | 테넌트 없음 |
| person_link | 같은 사람 | GitHub nameId·이메일 = Atlassian 이메일 (사람) | 테넌트 없음 |
| confluence_automation_to_github | Confluence Automation Send web request → api.github.com, 또는 GitHub 웹훅 → Incoming webhook | 플로우 URL (이름), 토큰 동작 시각 (로그), 웹훅 주소 지문 (지문) | 테넌트 없음 |
| bitbucket_import_from_github | Bitbucket 이 GitHub PAT 로 저장소를 가져옴 (한 번 복제) | 커밋 SHA (이름), 토큰 동작과 생성 시각 (로그) | 테넌트 없음 |
| copilot_for_jira | Jira 에서 GitHub Copilot 코딩 에이전트를 시작 | GitHub 설치 앱 = Jira 설치 앱 GitHub Copilot for Jira (이름), 같은 사람 (사람), 설치 시각 (로그 시각) | 모름 (2026-10-26 더함) |
| rovo_connector_github | Atlassian Teamwork Graph 가 GitHub 를 색인해 Rovo 검색에 씀 (Rovo Search for GitHub) | Atlassian 커넥터의 GitHub 조직 = GitHub for Atlassian 설치 조직 (이름), 같은 사람 (사람), 커넥터 연결 ↔ 앱 설치 시각 (로그 시각) | 연결됨 |
| rovo_dev_code_review | Rovo Dev 가 GitHub PR 을 자동 리뷰 | Rovo Dev 설정의 저장소 = GitHub 저장소 (이름) | 모름 (2026-10-26 더함) |
| copilot_agent_atlassian_mcp | GitHub Copilot 이 Atlassian MCP 서버로 Jira·Confluence 를 읽음 | 저장소 MCP 구성의 서버 URL = Atlassian MCP 주소 (이름), MCP 구성 변경 ↔ Invoked tool 시각 (로그 시각) | 모름 (2026-10-26 더함) |
| copilot_connector_atlassian_rovo | GitHub Copilot 이 GitHub 검증 Atlassian Rovo 커넥터로 Atlassian 을 부름 (public preview) | 같은 사람 (사람). 양쪽 흔적은 문서에 없음 | 모름 (2026-10-30 더함) |

## GWS ↔ Atlassian

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| google_login | Atlassian 계정에 Google 로그인 (Third-party login 정책) | GWS 토큰 감사의 Atlassian 클라이언트 (이름), 이메일 (사람) | 테넌트 없음 |
| google_saml_idp | GWS 를 IdP 로 Atlassian 로그인 (Google 앱 Atlassian Cloud) | Entity ID·ACS URL (ID), SSO URL (이름), 인증서 (지문), 이메일 (사람) | 테넌트 없음 |
| google_workspace_directory_sync | Atlassian 이 GWS 디렉터리를 4시간마다 동기화 | GWS 토큰 감사 authorize (이름), 검증 도메인 = 주 도메인 (이름), 사용자·그룹 (사람) | 테넌트 없음 |
| jira_cloud_for_sheets | Sheets 부가기능 Jira Cloud for Sheets | GWS 설치 앱 (이름), 같은 사람 (사람) | 테넌트 없음 |
| jira_cloud_for_gmail | Gmail 부가기능 Atlassian | GWS 설치 앱 (이름), 같은 사람 (사람) | 테넌트 없음 |
| confluence_for_google_chat | Google Chat 앱 Confluence (Marketplace 앱 Atlassian) | 설치 사이트 = Atlassian 사이트 (이름), 앱 ID 331162826608 (로그 ID), Chat 사용자 = 설치한 Atlassian 사용자 (사람), 토큰 승인 ↔ 설치 시각 (로그 시각) | 연결됨 (2026-10-27 aegi.men Chat) |
| smart_links_google_drive | 본문의 Drive Smart Link, Google 계정 OAuth 연결 | 토큰 displayText·clientId (이름), 본문 주소 (이름) | 테넌트 없음 |
| apps_script_to_atlassian_api | Apps Script 가 API 토큰으로 Jira·Confluence 호출 | 코드의 호출 호스트 (이름), 소유자 = 토큰 소유자 (사람), 실행 시각 (로그) | 테넌트 없음 |
| person_link | 같은 사람 | GWS 이메일 = Atlassian 이메일 (사람) | 테넌트 없음 |
| bitbucket_google_cloud_build | Google Cloud Build 가 Bitbucket 토큰·웹훅으로 빌드 | Workspace ID (ID), remote-uri = 저장소 URL (이름), 토큰 범위·웹훅 호스트 (이름) | 테넌트 없음 |
| bitbucket_pipelines_oidc_to_google_cloud | Pipelines OIDC → Google Cloud Workload Identity | issuerUri·audience = Identity provider URL·Audience (ID) | 테넌트 없음 |
| rovo_connector_google_workspace | Atlassian Rovo 가 Google Drive·Gmail·Calendar 를 읽음 (도메인 전체 위임) | 위임 client ID = Atlassian 커넥터 Client ID (ID), 위임 scope (이름), 위임 승인 = AUTHORIZE_API_CLIENT_ACCESS (로그 ID), 사용자 연결 authorize = Atlassian 사용자 (사람), 연결 ↔ 위임 승인 시각 (로그 시각) | 연결됨 (2026-10-26 aegi.men Drive) |
| gemini_enterprise_jira | Gemini Enterprise 가 Jira 를 읽고 씀 | 3LO 앱 Client ID (ID), 콜백 URL 이 vertexaisearch (이름), SetUpDataConnector ↔ jira_accessed_api 시각 (로그 시각) | 모름 (2026-10-26 더함) |
| gemini_enterprise_confluence | Gemini Enterprise 가 Confluence 를 읽고 씀 | 3LO 앱 Client ID (ID), SetUpDataConnector ↔ confluence_accessed_api 시각 (로그 시각) | 모름 (2026-10-26 더함) |
| rovo_agent_in_gemini_enterprise | Gemini Enterprise 에서 Atlassian Rovo 에이전트를 부름 (A2A) | 설치된 Rovo Agent = Atlassian A2A 연결 허용 (이름), 같은 사람 (사람) | 모름 (2026-10-26 더함) |
| gemini_marketplace_atlassian_rovo | Marketplace 의 Atlassian Rovo Integration 을 Gemini 에서 씀 | ADD_APPLICATION APP_ID = 668350057935 (로그 ID), 토큰 승인 ↔ Atlassian 호출 시각 (로그 시각) | 모름 (2026-10-26 더함) |
| workspace_studio_atlassian | Workspace Studio 흐름의 Jira·Confluence 연동 단계 (베타) | Studio 커넥터 설정 = On (이름), Studio 흐름 소유자 = Atlassian 앱 설치자 (사람), Studio 단계 실행 시각 안에 Jira 댓글 (로그 시각) | 연결됨 (2026-10-26 시험용 흐름 → Jira 댓글) |

## Slack ↔ Atlassian

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| jira_cloud_for_slack | Slack 앱 Jira Cloud (A2RPP3NFR) | Slack 앱 ID ↔ Jira Slack 연동의 워크스페이스 (ID), 구독 프로젝트 (이름), 이메일 (사람) | 테넌트 없음 |
| confluence_cloud_for_slack | Slack 앱 Confluence Cloud | /confluence list = 스페이스 구독 목록 (이름), 이메일 (사람) | 테넌트 없음 |
| jsm_chat_assist | JSM Chat 의 Slack 앱 Assist | 채널 이름 (이름), 이메일 (사람, 요건) | 테넌트 없음 |
| jira_automation_slack_webhook | Jira Automation Send Slack message → 수신 웹훅 | Webhook URL 지문 = Slack 웹훅 지문 (지문), 실행과 메시지 시각 (로그) | 테넌트 없음 |
| jira_automation_slack_api | Jira Automation Send web request → Slack Web API (Bearer) | URL 호스트 slack.com (이름), 앱 설치 범위·시각 | 테넌트 없음 |
| slack_workflow_connector_jira | Slack 워크플로의 Jira Cloud 커넥터 | 워크플로 단계 ↔ Connected apps 항목 (이름) | 테넌트 없음 |
| person_link | 같은 사람 | Slack 이메일 = Atlassian 이메일 (사람) | 테넌트 없음 |
| content_ref | 본문 링크 | Slack 메시지의 atlassian.net 주소 | 테넌트 없음 |
| confluence_automation_slack_webhook | Confluence Automation Send Slack message → 수신 웹훅 | Webhook URL 지문 = Slack 웹훅 지문 (지문), 실행과 메시지 시각 (로그) | 테넌트 없음 |
| bitbucket_cloud_for_slack | Bitbucket 저장소 ↔ Slack 채널 구독 (/bitbucket) | /bitbucket list = 저장소 (이름), 예전 웹훅 지문 (지문), 사용자 (사람) | 테넌트 없음 |
| slack_workflow_connector_bitbucket | Slack 워크플로의 Atlassian Bitbucket 커넥터 | 워크플로 단계 ↔ OAuth integrated applications (이름) | 테넌트 없음 |
| enterprise_search_jira_confluence | Slack 엔터프라이즈 검색이 Jira·Confluence 를 검색 | 데이터 소스의 서브도메인 = Atlassian 사이트 서브도메인 (이름), 같은 사람 (사람) | 모름 (2026-10-26 더함) |
| slackbot_mcp_atlassian_rovo | Slackbot 이 Atlassian Rovo MCP 서버에 붙음 | Slackbot 의 MCP 서버 = Atlassian MCP 주소 (이름), 도구 호출 ↔ Invoked tool 시각 (로그 시각) | 모름 (2026-10-26 더함) |
| rovo_app_for_slack | Slack 의 Atlassian Rovo 앱으로 Jira·Confluence 를 다룸 | Slack 에서 연결 승인한 사람 = Rovo 질문한 사람 (사람), 질문 시각 ↔ surface = slack 감사 행 (로그 시각) | 연결됨 (2026-10-26 AEGI Company) |
| rovo_connector_slack | Atlassian Teamwork Graph 가 Slack 메시지를 Rovo 에 씀 | 연결한 사람 = Slack 앱 설치자 (사람), Atlassian 연결 ↔ Slack 앱 설치 시각 (로그 시각) | 연결됨 (2026-10-26 AEGI Company) |

## Okta ↔ Salesforce

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| saml_sso | Okta 가 Salesforce 로그인 (SAML, OIN Salesforce.com) | SamlSsoConfig.Issuer = Okta entityID (ID), LoginUrl·My Domain (이름), 인증서 (지문), FederationIdentifier = login (사람), LoginHistory.AuthenticationServiceId (로그 ID), SSO 시각 (로그) | 테넌트 없음 |
| provisioning | Okta → Salesforce 사용자 생성·변경·비활성화 (API 사용자 username + 비밀번호·토큰) | API 계정 username (이름), externalId = User.Id (ID), userName (사람), push 와 API 로그인 시각 (로그) | 테넌트 없음 |
| workflows_salesforce_connector | Okta Workflows Salesforce 커넥터 (OAuth) | OauthToken.AppName·UserId (이름), 연결 생성 시각 (로그) | 테넌트 없음 |
| salesforce_as_idp_for_okta | Salesforce 계정으로 Okta 로그인 (Okta IdP 유형 Salesforce) | IdP client_id = connected app consumerKey (ID), callbackUrl (이름) | 테넌트 없음 |
| email_match | 같은 사람 | Okta login = Username·Email·FederationIdentifier (사람) | 테넌트 없음 |
| agentforce_agent_import | Okta 가 Salesforce Agentforce 에이전트를 가져와 등록 | Okta 앱의 Consumer Key = 외부 클라이언트 앱 Consumer Key (ID), Login URL = My Domain (이름), 가져오기 완료 ↔ LoginHistory 시각 (로그 시각) | 모름 (2026-10-26 더함) |
| agentforce_agent_discovery | Okta ISPM 이 Agentforce 에이전트를 찾아 목록에 올림 | Discovered agents 의 에이전트 이름 = Agentforce 에이전트 이름 (이름) | 모름 (2026-10-26 더함) |
| data360_okta_connector | Salesforce Data 360 이 Okta Core 지표를 수집 | Data 360 Okta 커넥션의 Okta 조직 주소 = Okta 조직 주소 (이름) | 모름 (2026-10-26 더함) |
| agentforce_registry_okta_mcp | Salesforce Agentforce 가 Agentforce Registry 에 등록한 Okta MCP 서버를 부름 | Registry MCP 서버 URL = Okta MCP 서버 주소 (이름), 외부 자격 증명 Client ID = Okta OAuth 앱 (ID), 같은 사람 (사람), System Log 시각 (로그 시각) | 모름 (2026-10-29 더함) |

## GitHub ↔ Salesforce

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| devops_center | DevOps Center 가 GitHub 승인으로 저장소 관리 | GitHub 승인 앱 (이름), 저장소 (이름), 승인 시각 (로그) | 테넌트 없음 |
| actions_sf_cli_jwt | GitHub Actions 가 Salesforce CLI JWT 로 로그인 | 인증서 = 비밀의 개인키 짝 (지문), consumerKey (ID), 실행과 로그인 시각 (로그) | 테넌트 없음 |
| auth_provider_github | Salesforce Auth. Provider(GitHub) 로 GitHub API 호출 | ConsumerKey = GitHub OAuth 앱 client_id (ID), callback (이름) | 테넌트 없음 |
| person_link | 같은 사람 | GitHub nameId·이메일 = Salesforce Email (사람) | 테넌트 없음 |
| data360_github_connector | Salesforce Data 360 이 GitHub 저장소 내용을 수집 | 커넥션 API URL = GitHub 호스트 (이름), 토큰·OAuth App 소유 계정 (사람) | 모름 (2026-10-26 더함) |
| agentforce_registry_github_mcp | Salesforce Agentforce 가 Agentforce Registry 에 등록한 GitHub 원격 MCP 서버를 부름 | Registry MCP 서버 URL = api.githubcopilot.com/mcp (이름), 외부 자격 증명 Client ID = GitHub OAuth 앱 (ID), 같은 사람 (사람) | 모름 (2026-10-29 더함) |

## GWS ↔ Salesforce

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| google_saml_idp | GWS 를 IdP 로 Salesforce 로그인 (Google 앱 Salesforce) | Entity ID = Issuer (ID), SSO URL = LoginUrl (이름), 인증서 (지문), 이메일 (사람), saml 감사와 LoginHistory 시각 (로그) | 테넌트 없음 |
| google_login_auth_provider | Google 계정으로 Salesforce 로그인 (Auth. Provider Google) | ConsumerKey = Google OAuth 클라이언트 (ID), AuthenticationServiceId (로그 ID) | 테넌트 없음 |
| files_connect_google_drive | Files Connect 로 Google Drive 연결 | ConsumerKey = OAuth 클라이언트 (ID), Redirect URI (이름), token 감사 client_id (로그 ID) | 테넌트 없음 |
| einstein_activity_capture | Einstein Activity Capture 가 Gmail·Calendar 동기화 | token 감사 app_name (이름), 같은 사람 (사람) | 테넌트 없음 |
| lightning_sync_domain_wide_delegation | Lightning Sync 서비스 계정 도메인 전체 위임 (2027 종료) | 위임 client ID = 서비스 계정 (ID) | 테넌트 없음 |
| sheets_salesforce_connector | Sheets 부가기능 Salesforce Connector (Google 제작) | OauthToken.AppName (이름), 같은 사람 | 테넌트 없음 |
| marketplace_salesforce_apps | Salesforce for Google Chat, Salesforce integration (Gemini) | 설치 앱 ↔ OauthToken.AppName (이름) | 테넌트 없음 |
| person_link | 같은 사람 | GWS 이메일 = Salesforce Email·FederationIdentifier (사람) | 테넌트 없음 |
| data360_google_drive_connector | Salesforce Data 360 이 Google Drive 파일을 수집 (서비스 계정, 도메인 위임) | 위임 client ID = 커넥션 Client ID (ID), 서비스 계정 이메일 (이름), token 감사 client_id = 위임 API_CLIENT_NAME (로그 ID) | 모름 (2026-10-26 더함) |
| gemini_enterprise_salesforce | Gemini Enterprise 가 Salesforce 를 검색하고 씀 | 외부 클라이언트 앱 Consumer Key = 커넥터 Consumer Key (ID), SetUpDataConnector ↔ LoginHistory 시각 (로그 시각) | 모름 (2026-10-26 더함) |
| workspace_studio_salesforce | Workspace Studio 흐름의 Salesforce 연동 단계 (베타) | Studio 커넥터 설정 = On (이름), Studio 단계 실행 시각에 Salesforce Task, LoginHistory Application = Google Integration (로그 시각) | 연결됨 (2026-10-26 시험용 흐름 → Salesforce Task) |
| gmail_integration_chrome_extension | Salesforce Gmail 통합 Chrome 확장으로 Gmail 에서 Salesforce 레코드를 봄 | 같은 사람 (사람), token authorize ↔ LoginHistory 시각 (로그 시각) | 모름 (2026-10-28 더함) |
| agentforce_registry_google_workspace_mcp | Salesforce Agentforce 가 Agentforce Registry 에 등록한 Google Workspace MCP 서버(Gmail·Drive·Calendar·Chat)를 부름 | Registry MCP 서버 URL = *mcp.googleapis.com/mcp/v1 (이름), 외부 자격 증명 Client ID = Google Cloud OAuth 클라이언트 (ID), 같은 사람 (사람), OAuth 로그 시각 (로그 시각) | 모름 (2026-10-29 더함) |

## Slack ↔ Salesforce

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| salesforce_org_connection | Slack 워크스페이스 ↔ Salesforce 조직 연결 (모든 플랜) | org URL = My Domain (이름), Email·SAML NameID 매핑 (사람), 감사 salesforce_org_upserted 시각 (로그) | 테넌트 없음 |
| salesforce_for_slack_apps | Salesforce 제작 Slack 연동 앱 (옛 Slack 제작 앱은 신규 설치 불가) | Slack 앱 ↔ 설치 패키지 (이름), OauthToken.AppName (이름) | 테넌트 없음 |
| flow_slack_action | Salesforce Flow 가 Slack 동작 실행 | 감사 app_flows_execute_slack_action 시각 (로그) | 테넌트 없음 |
| named_credential_to_slack_api | Auth. Provider·Named Credential 로 Slack Web API 호출 | ConsumerKey = Slack 앱 Client ID (ID), Redirect URL (이름) | 테넌트 없음 |
| apex_slack_sdk_app | Salesforce Platform 에서 만든 Slack 앱 (Apex SDK) | 매니페스트 url 의 앱 ID (ID) | 테넌트 없음 |
| slack_workflow_connector_salesforce | Slack 워크플로의 Salesforce 커넥터 | 워크플로 단계 ↔ OauthToken (이름) | 테넌트 없음 |
| person_link | 같은 사람 | Slack 이메일 = Salesforce Email (사람) | 테넌트 없음 |
| slackbot_salesforce_mcp | Slackbot 이 Salesforce MCP 서버로 Salesforce 를 조회·수정 | Slack 의 MCP 서버 항목 = Salesforce Hosted MCP 서버 (이름), 활성화 ↔ LoginHistory 시각 (로그 시각) | 모름 (2026-10-26 더함) |
| agentforce_in_slack | Salesforce Agentforce 에이전트를 Slack 에 배포 | Agentforce 에이전트의 Slack 연결 = Slack 설치 에이전트 앱 (이름), 연결 추가 ↔ SetupAuditTrail 시각 (로그 시각) | 모름 (2026-10-26 더함) |
| salesforce_record_channel | Salesforce 레코드에 Slack 채널을 만들거나 연결 (Salesforce channels) | Slack Channel configurations 의 객체 = Salesforce Slack Channels for Records 의 객체 (이름), 채널 멤버 = 레코드 접근 권한 있는 사용자 (사람) | 모름 (2026-10-28 더함) |

## Atlassian ↔ Salesforce

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| marketplace_connector_apps | 제3자 Jira–Salesforce 앱 (Appfire, Korvex 등) | 설치 앱 ↔ 패키지·OauthToken (이름), consumerKey (ID) | 테넌트 없음 |
| auth_provider_atlassian | Salesforce Auth. Provider(Bitbucket, Confluence3LO) 로 API 호출 | ConsumerKey = Bitbucket consumer·3LO Client ID (ID), callback (이름) | 테넌트 없음 |
| smart_links_salesforce | 본문의 Salesforce Smart Link | 본문 주소 = My Domain (이름) | 테넌트 없음 |
| person_link | 같은 사람 | Atlassian 이메일 = Salesforce Email (사람) | 테넌트 없음 |
| rovo_connector_salesforce_synced | Atlassian Rovo 가 Salesforce 를 색인 (Synced, Atlassian Links 앱) | Connected Apps OAuth Usage 의 Atlassian Links = Atlassian 커넥터 (이름), OauthToken·LoginHistory 앱 이름 (로그 ID), 연결 ↔ 로그인 시각 (로그 시각) | 모름 (2026-10-26 더함) |
| rovo_connector_salesforce_direct | Atlassian Rovo 가 Salesforce MCP 를 실시간 호출 (Direct) | Direct 커넥터의 Salesforce 도메인 URL = My Domain (이름), 같은 사람 (사람), Rovo Salesforce 사용 ↔ Atlassian Links 로그인 시각 (로그 시각) | 연결됨 (2026-10-26) |
| data360_confluence_connector | Salesforce Data 360 이 Confluence 내용을 수집 | 커넥션의 Cloud ID = Atlassian cloudId (ID), 같은 사람 (사람) | 모름 (2026-10-26 더함) |
| data360_jira_connector | Salesforce Data 360 이 Jira 내용을 수집 | 커넥션의 Jira URL = Atlassian 사이트 도메인 (이름), 같은 사람 (사람) | 모름 (2026-10-26 더함) |
| jsm_salesforce_service_cloud_integration | Salesforce Service Cloud 케이스로 JSM 알림을 만들고 상태를 주고받음 (Apex 트리거) | JSM 통합 API URL = Salesforce 원격 사이트 JSM 의 URL (이름), 알림 생성 ↔ 케이스 생성 시각 (로그 시각) | 모름 (2026-10-28 더함) |
| agentforce_registry_atlassian_mcp | Salesforce Agentforce 가 Agentforce Registry 에 등록한 Atlassian Rovo MCP 서버를 부름 | Registry MCP 서버 엔드포인트 = mcp.atlassian.com (이름), 외부 자격 증명 Client ID (ID), 같은 사람 (사람), Invoked tool 시각 (로그 시각) | 모름 (2026-10-28 더함) |
| named_credential_atlassian_token | Salesforce Named Credential 에 Atlassian 계정 이메일과 API 토큰을 넣고 Apex, Flow 가 Jira, Confluence REST 를 부름 | Named Credential URL 호스트 = Atlassian 사이트 (이름), 자격의 계정 = 토큰 주인 (사람), ApexCallout URL 호스트 (로그 ID), 토큰 동작 ↔ 호출 시각 (로그 시각) | 연결됨 (2026-10-29 더함. v3 결과는 salesforce-external named_credential 에 적힘) |
| sync_via_server | 밖의 서버가 Salesforce 연결 앱(client credentials)과 Atlassian API 토큰을 함께 들고 한쪽에서 읽어 다른 쪽에 씀 | 연결 앱 이름, 토큰 이름 = 서버 (이름), 서버 기록의 레코드 id, 페이지 id (로그 ID), 연결 앱 로그인 ↔ 토큰 동작 시각 (로그 시각) | 연결됨 (2026-10-29 더함. v3 결과는 salesforce-external external_client_app, atlassian-external user_api_token 에 적힘) |

## Okta ↔ Workday

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| saml_sso | Okta 가 Workday 로그인 (SAML) | Workday IdP 행 Issuer = Okta entityID (ID), IdP SSO Service URL·Your Workday site URL (이름), 인증서 (지문), Workday Account = login (사람), 로그인 기록의 SAML IdP (로그 ID), SSO 시각 (로그) | 테넌트 없음 |
| workday_profile_source_import | Okta 가 Workday 직원을 가져옴 (프로필 원천, ISU 로 Web Services 호출) | API Username = ISU@tenant (이름), WebServices Endpoint (이름), employeeNumber = Employee_ID (사람), 가져오기와 ISU 로그인 시각 (로그) | 테넌트 없음 |
| workday_writeback | Okta → Workday 연락처 되쓰기 (Early Access) | Work Contact Change 보안 정책의 ISU 그룹 (이름), 업무 프로세스 시각 (로그) | 테넌트 없음 |
| workday_real_time_sync | Workday 업무 프로세스 → Okta API (Real-Time Sync) | 연동 속성 Okta API Endpoint 호스트 (이름)·IdP ID = Okta Issuer (ID), 토큰 이름 (이름), 연동 실행 시각 (로그) | 테넌트 없음 |
| workflows_workday_connector | Okta Workflows Workday 커넥터 (Workday API 클라이언트) | Client ID (ID), Redirection URI = Okta Workflows 셀 (이름), 로그인 기록의 API_Client_ID (로그 ID) | 테넌트 없음 |
| email_match | 같은 사람 | Okta login·employeeNumber = Workday Account·Employee_ID (사람) | 테넌트 없음 |
| okta_ai_agent_import_workday | Okta 가 Workday ASOR 에이전트를 가져옴 (OAuth 2.0 API 클라이언트) | Workday API 클라이언트 ID (ID), 토큰 주소 (이름), import.complete 시각 (로그 시각) | 모름 (2026-10-30 더함) |

## GitHub ↔ Workday

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| person_link | 같은 사람 (직접 연동 문서 없음) | GitHub nameId·이메일 = Workday 업무 이메일 (사람) | 테넌트 없음 |

## GWS ↔ Workday

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| google_saml_idp | Google 이 Workday 로그인 (SAML, Workday Web (SAML)) | Workday IdP 행 Issuer = Google Entity ID (ID), SSO URL·ACS URL (이름), 인증서 (지문), primaryEmail (사람), 로그인 기록의 SAML IdP (로그 ID) | 테넌트 없음 |
| workday_for_google_chat | Google Chat 의 Workday 앱 (Marketplace, Google 개발) | 설치 앱 (이름), 같은 사람 (사람) | 테넌트 없음 |
| workday_for_google_sheets | Sheets 부가기능 Workday for Google Sheets (Adaptive Planning) | 설치 앱 (이름) | 테넌트 없음 |
| learning_google_calendar | Workday Learning → Google Calendar 초대 (Service Owners Key, 메일함 하나) | Mailbox = Google 계정 (이름), 키의 프로젝트 (ID), 실행 시각 (로그) | 테넌트 없음 |
| interview_scheduling_google_calendar | Workday 면접 일정 → Google Calendar | 쓰는 Google 계정 (이름) | 테넌트 없음 |
| person_link | 같은 사람 | primaryEmail = Workday 업무 이메일 (사람) | 테넌트 없음 |
| workday_a2a_gemini_enterprise | Gemini Enterprise 같은 외부 플랫폼이 A2A 로 Workday Self-Service Agent 를 부름 | Workday 통합 API 클라이언트 ID = Gemini Enterprise OAuth client ID (ID), Agent Card 주소 (이름), 같은 사람 (사람) | 모름 (2026-10-30 더함) |

## Slack ↔ Workday

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| workday_for_slack | Slack 앱 Workday (Workday 게시, Workday Everywhere) | 앱 ID ABH43V9RN (이름), 테넌트 별칭 (이름), 같은 사람 (사람), 설치와 로그인 시각 (로그) | 테넌트 없음 |
| person_link | 같은 사람 | Slack email = Workday 업무 이메일 (사람) | 테넌트 없음 |
| content_ref | 메시지의 Workday 링크 | workday.com 호스트·테넌트 (이름) | 테넌트 없음 |

## Atlassian ↔ Workday

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| workato_hris_to_jsm | Workday 입사 → 자동화 플랫폼(Workato) → JSM 티켓 | API 클라이언트 Redirection URL = 플랫폼 콜백 (이름), 티켓 생성 계정 (이름), 입사와 티켓 시각 (로그) | 테넌트 없음 |
| person_link | 같은 사람 | Atlassian email = Workday 업무 이메일 (사람) | 테넌트 없음 |
| rovo_connector_workday | Atlassian Teamwork Graph 가 Workday 보고서 JSON 주소로 데이터를 가져옴 (ISU) | 보고서 JSON 주소 = Workday 보고서 웹 서비스 주소 (이름) | 모름 (2026-10-30 더함) |

## Salesforce ↔ Workday

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| mulesoft_workday_connector | MuleSoft Workday 커넥터 (Basic·OAuth·x.509) | 호스트·테넌트 (이름), User Name = ISU (이름), Consumer Key = Client ID (ID), 로그인 기록 (로그 ID) | 테넌트 없음 |
| person_link | 같은 사람 | Salesforce Email = Workday 업무 이메일 (사람) | 테넌트 없음 |
| agentforce_registry_workday_mcp | Salesforce Agentforce 가 Agentforce Registry 에 등록한 Workday MCP 서버를 부름 (Workday Extend Professionals 전용) | Registry MCP 서버 URL = us.agent.workday.com/mcp (이름), 외부 자격 증명 Client ID = Workday External Agent (ID), Agent System User (사람) | 모름 (2026-10-29 더함) |
| data360_workday_connector | Salesforce Data 360 이 Workday 데이터를 가져옴 (배치 GA, Zero Copy 베타) | Workday 테넌트 주소 (이름), 연결이 쓰는 Workday 사용자 (사람) | 모름 (2026-10-30 더함) |

## Okta ↔ 밖

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| oauth_service_app | 외부 서버가 개인키로 Okta API 호출 | 앱 공개키 = 서버 개인키의 짝 (지문), 서버 기록 client_id = 앱 ID (로그) | 연결됨 (Helpdesk, 수집기), 설정만 (Workflows API Endpoint) |
| user_delegated_client | 사용자가 OIDC 앱에 동의해 토큰 제공 | redirect 호스트 (이름), 토큰 폐기 주체 = 앱 ID (로그) | 연결됨 (Okta Workflows) |
| api_token | API 토큰을 밖이 보관 | 토큰 이름만 (이름) | 연결됨 (splunk-addon 등) |
| event_hook | Okta → 지정 주소로 이벤트 | 훅 주소 호스트 (이름) | 안 씀 |
| log_stream | System Log → Splunk·AWS | 설정의 계정·호스트 (ID) | 안 씀 (콘솔 확인. 수집기 역할로는 403) |
| identity_provider | 밖의 IdP 로 Okta 로그인 | IdP 클라이언트 ID, issuer (ID) | 안 씀 |
| bookmark_app | Okta 대시보드의 밖 링크 | 링크 주소 (이름) | 환경 밖 (Finance Portal) |
| trusted_origin | Trusted Origins 의 밖 주소 (CORS·리다이렉트·iframe) | origin 호스트 (이름) | 모름 (2026-10-14 더함. 미수집) |
| authenticator_provider | 밖의 인증 제공자를 Okta 인증기로 | provider 설정 (ID) | 모름 (2026-10-14 더함. 미수집) |
| okta_ai_agent_import_claude | Okta 가 Claude 플랫폼의 에이전트를 가져옴 (Claude API 키, 실험적 베타 API) | okta 앱의 Anthropic URL = Claude API 주소 (이름), API 키 (지문, 비밀이라 못 읽음), import.complete 시각 (로그 시각) | 모름 (2026-10-30 더함) |
| okta_mcp_server_third_party_client | Claude Desktop 같은 외부 AI 클라이언트가 Okta MCP 서버로 Okta 를 부름 | MCP 서버용 OAuth 앱 client ID (ID), 같은 사람 (사람), System Log 시각 (로그 시각) | 모름 (2026-10-30 더함) |

## Slack ↔ 밖

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| incoming_webhook | 밖이 Slack 웹훅 주소로 게시 | 보관한 주소 지문 (지문), 메시지 bot_id = 웹훅 봇 (로그) | 연결됨 |
| slash_command | 슬래시 명령 → 앱 주소 | 명령 주소 호스트 (이름), 서버 기록 앱 ID (로그) | 연결됨 |
| event_subscription | Events API → 앱 주소 | 요청 주소 호스트 (이름) | 안 씀 |
| interactivity | 버튼·모달 → 앱 주소 | 요청 주소 호스트 (이름) | 안 씀 |
| oauth_redirect | 앱 설치 OAuth → redirect 주소 | redirect 호스트 (이름), 서버의 웹훅 지문 (지문) | 연결됨 (Worker) |
| third_party_app | 외부 업체 앱 설치 | 감사 로그의 앱 이름·범위 (이름) | 연결됨 (Slack Tooling Tokens Vendor) |
| slack_connect | 다른 조직과 채널 공유 | 연결된 팀 ID (ID) | 안 씀 |
| audit_reader | 밖이 감사 로그 읽기 | 앱 범위 auditlogs:read (이름) | 연결됨 (AEGI Setup, SLACK-API-TESTER) |
| socket_mode | 외부 앱이 WebSocket (WSS) Socket Mode 로 이벤트·상호작용 수신 | Socket Mode 활성화 (설정 이름), app_installed 와 WSS 연결 시각 (로그) | 모름 (2026-10-15 더함) |
| slack_mcp_server_external_ai | Claude·Cursor 같은 MCP 클라이언트가 Slack MCP 서버(mcp.slack.com)에 OAuth 로 붙음 | Slack 앱 client ID = 클라이언트 client ID (ID), 같은 사람 (사람), 앱 설치 시각 (로그 시각) | 모름 (2026-10-30 더함) |
| slackbot_mcp_client_external_server | Slackbot 이 Slack 앱에 등록한 외부 MCP 서버를 부름 | 앱 설정의 서버 주소 = 서버 주소 (이름), OAuth client ID (ID), 같은 사람 (사람) | 모름 (2026-10-30 더함) |
| rts_api_external_app | 외부 앱·AI 가 Real-time Search API 로 Slack 을 검색 | Slack 앱 client ID = 외부 서비스 client ID (ID), 사용자 토큰 주인 = 서비스 사용자 (사람) | 모름 (2026-10-30 더함) |

## GitHub ↔ 밖

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| webhook | 웹훅 → 밖의 주소 | 주소 호스트 (이름), 서버 기록 hook_id (로그) | 연결됨 (Worker, 2026-10-05 Okta Workflows 시험 흐름도) |
| github_app_install | GitHub App 설치 | 앱 slug·권한 (이름) | 연결됨 (claude, aegi-collector) |
| user_authorization | 사용자의 OAuth 앱 승인 | SSO 승인 목록의 앱 이름 (이름) | 연결됨 |
| personal_access_token | PAT 를 밖이 보관 | 토큰 주인 (이름), token_id·커밋 = 서버 기록 (로그) | 연결됨 (didwl-tok, jiwon-pat) |
| deploy_key | 저장소 SSH 키 | 공개키 = 서버 개인키의 짝 (지문) | 모름 |
| actions_outbound | Actions 가 밖을 호출 | 비밀 이름, 파일의 주소, OIDC 신뢰 조건 (이름) | 모름 |
| audit_log_stream | 감사 로그 스트리밍 | 스트림 대상 (이름) | 모름 |
| actions_variables | Actions 변수에 둔 밖의 주소 (값이 그대로 보임) | 변수 value 의 호스트 (이름) | 모름 (2026-10-14 더함. 미수집) |
| github_mcp_server_third_party_clients | IDE·외부 AI 클라이언트가 GitHub 원격 MCP 서버에 OAuth 또는 PAT 로 붙음 | 클라이언트 설정의 서버 주소 = api.githubcopilot.com/mcp (이름), 같은 사람 (사람) | 모름 (2026-10-30 더함) |

## GWS ↔ 밖

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| third_party_oauth_app | 사용자가 외부 앱에 OAuth 권한 | 토큰 목록의 앱 이름·클라이언트 ID·범위 (이름) | 연결됨 (Okta, Google Cloud SDK, 스크립트 등) |
| domain_wide_delegation | 서비스 계정에 도메인 전체 위임 | 위임 클라이언트 ID = 서비스 계정 ID (ID) | 연결됨 (collector, aegi-setup) |
| apps_script_web_app | 웹앱으로 배포 | 배포 주소 (ID), 접근 범위·실행 신원 (이름) | 연결됨 (Team Directory, 2026-10-05 AEGI Conn Test) |
| apps_script_outbound | 스크립트가 밖을 호출 | 코드·속성의 주소 (이름) | 연결됨 |
| gmail_forwarding | 자동 전달로 밖에 메일 | 전달 주소 (이름) | 연결됨 (dev.junsik → 개인 Gmail) |
| drive_external_share | Drive 파일을 밖에 공유 | 권한의 이메일·도메인 (이름) | 안 씀 |
| inbound_sso | 밖의 IdP 가 GWS 로그인 | SSO 프로필 entityId·issuer (ID) | 안 씀 |
| google_as_idp | GWS 가 밖 앱의 IdP | SAML 감사의 앱 이름 (이름) | 안 씀 |
| marketplace_app | Marketplace 앱 설치 | 앱 이름·ID (이름) | 안 보임 |
| workspace_studio_webhook_step | Workspace Studio 흐름의 Send a webhook 단계가 밖의 주소로 요청을 보냄 | Webhook 허용 목록 호스트 = 단계 URL 호스트 (이름), Start/End step ↔ 받는 쪽 로그 시각 (로그 시각) | 모름 (2026-10-28 더함) |
| gws_workspace_mcp_external_clients | Claude 같은 MCP 클라이언트가 Google Workspace 원격 MCP 서버(Developer Preview)에 붙음 | OAuth 클라이언트 ID (ID), 리디렉션 URI (이름), 같은 사람 (사람), Reports API token 활동 (로그 시각) | 모름 (2026-10-30 더함) |

## Atlassian ↔ 밖

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| jira_admin_webhook | Jira 관리자 웹훅 → 밖의 주소 | url 호스트·경로 (이름), url 지문 (지문) | 테넌트 없음 |
| jira_app_webhook | Connect·OAuth 앱이 REST 로 등록한 웹훅 (30일) | url = 앱 baseUrl (이름) | 테넌트 없음 |
| jira_automation_web_request | Automation Send web request → 밖 | 룰의 URL 호스트 (이름) | 테넌트 없음 |
| jira_automation_incoming_webhook | 밖 → Automation Incoming webhook URL | 트리거 URL 지문 (지문) | 테넌트 없음 |
| confluence_connect_webhook | Confluence Connect 앱 웹훅 (디스크립터만) | baseUrl + url (이름) | 테넌트 없음 |
| connect_app | Connect 앱 서버 (baseUrl, clientKey) | baseUrl 호스트 (이름), app key·clientKey (ID) | 테넌트 없음 |
| forge_app_egress | Forge 앱의 외부 도메인 호출 | 매니페스트 도메인 (이름) | 테넌트 없음 |
| oauth_3lo_app | OAuth 2.0 (3LO) 앱 동의 | Client ID·redirect_uri (ID), 감사 actor.app.id (로그) | 테넌트 없음 |
| user_api_token | 사용자 API 토큰을 밖이 보관 | 토큰 이름·소유자 (이름), 감사 actor.auth.tokenId (로그) | 테넌트 없음 |
| admin_api_key | 조직 관리자 API 키를 밖이 보관 | 키 id·label (이름), 감사 actor.auth (로그) | 테넌트 없음 |
| service_account_token | 서비스 계정 토큰 | 서비스 계정 이름 (이름) | 테넌트 없음 |
| audit_log_webhook | 조직 감사 로그 → 밖의 도구 웹훅 | 웹훅 URL 호스트 (이름) | 테넌트 없음 |
| application_link | Application links 로 다른 서버 연결 | 상대 URL (이름) | 테넌트 없음 |
| org_audit_api_reader | 밖이 관리자 API 키로 감사 로그·사용자 읽기 | 키 이름·스코프 (이름) | 테넌트 없음 |
| confluence_automation_web_request | Confluence Automation Send web request → 밖 (email·Teams 액션도 같은 플로우) | 플로우의 URL 호스트 (이름) | 테넌트 없음 |
| confluence_automation_incoming_webhook | 밖 → Confluence Automation Incoming webhook URL (+secret 헤더) | 트리거 URL 지문 (지문) | 테넌트 없음 |
| bitbucket_repository_webhook | Bitbucket 저장소 웹훅 → 밖 (X-Hub-Signature) | url 호스트·events (이름), url 지문 (지문) | 테넌트 없음 |
| bitbucket_workspace_webhook | 워크스페이스 웹훅 → 밖 (REST 로만, owner) | url·events (이름), url 지문 (지문) | 테넌트 없음 |
| bitbucket_deploy_key | 저장소·프로젝트·워크스페이스 SSH 키를 밖이 씀 | 공개키 = 서버 개인키의 짝 (지문), label (이름) | 테넌트 없음 |
| bitbucket_oauth_consumer | 워크스페이스 OAuth consumer 로 밖의 앱이 API 호출 | Callback URL·Name (이름), 사용자 OAuth integrated applications (이름) | 테넌트 없음 |
| bitbucket_access_token | 저장소·프로젝트·워크스페이스 access token 을 밖이 보관 | 토큰 이름·범위 (이름) | 테넌트 없음 |
| bitbucket_pipelines_variables | Pipelines 변수에 둔 비밀·주소 | 변수 이름, 보통 변수 값 (이름) | 테넌트 없음 |
| bitbucket_pipelines_oidc | Pipelines OIDC 토큰으로 밖의 클라우드 사용 | Identity provider URL·Audience = 상대 issuer·audience (ID), UUID (ID) | 테넌트 없음 |
| bitbucket_installed_app | 워크스페이스 설치 앱 (Connect·Forge) | 앱 이름·consumer (이름) | 테넌트 없음 |
| rovo_mcp_oauth_client | 외부 AI 클라이언트가 Atlassian Rovo MCP 서버에 OAuth 2.1 로 붙음 | MCP 허용 도메인 = 클라이언트 리디렉션 호스트 (이름), Invoked tool 사용자 = Connected apps 동의자 (사람) | 모름 (2026-10-28 더함) |
| rovo_dev_cli_mcp_client | Rovo Dev CLI 가 ~/.rovodev/mcp.json 의 외부 MCP 서버를 부름 | mcp.json 서버 주소 = 서버 주소 (이름). 파일은 사용자 PC 에만 있음 | 모름 (2026-10-30 더함) |
| rovo_admin_external_mcp_server | 관리자가 Connected apps 에 등록한 외부 MCP 서버를 Rovo 가 부름 (OAuth 2.1, PKCE, DCR) | Connected apps 의 서버 주소 = 서버 주소 (이름), 같은 사람 (사람) | 모름 (2026-10-30 더함) |
| rovo_mcp_forge_module | 외부 MCP 클라이언트가 Forge 앱 rovo:mcp 모듈의 도구에 붙음 (Preview) | 앱 ID = 접속 주소의 앱 ID (ID), 같은 사람 (사람) | 모름 (2026-10-30 더함) |
| rovo_mcp_api_token_client | 외부 AI 클라이언트가 API 토큰으로 Rovo MCP 서버에 붙음 (관리자 허용 시) | API 토큰 인증 허용 = Authorization 헤더 (이름), 토큰 만든 사람 = 클라이언트 사용자 (사람) | 모름 (2026-10-30 더함) |

## Salesforce ↔ 밖

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| connected_app | connected app 으로 밖의 앱이 API 호출 (Drift 사건 경로) | consumerKey (ID), callbackUrl 호스트 (이름), OauthToken.AppName (이름), LoginHistory SourceIp (로그 ID) | 테넌트 없음 |
| external_client_app | external client app 으로 OAuth | label·orgScopedExternalApp (이름), OauthToken.AppName (이름) | 테넌트 없음 |
| named_credential | Named Credential 로 밖의 엔드포인트 호출 | URL 호스트 (이름) | 테넌트 없음 |
| remote_site_setting | Remote Site Settings 의 밖 URL 로 callout | url 호스트 (이름) | 테넌트 없음 |
| csp_trusted_site | CSP Trusted Sites 의 밖 도메인 | EndpointUrl 호스트 (이름) | 테넌트 없음 |
| cors_allowlist | CORS 허용 origin | UrlPattern (이름) | 테넌트 없음 |
| outbound_message | Outbound Message → 밖 endpoint (세션 ID 선택) | endpoint URL 호스트 (이름) | 테넌트 없음 |
| event_relay | Event Relay → Amazon EventBridge | DestinationResourceName 의 Named Credential (ID) | 테넌트 없음 |
| auth_provider_external | Auth. Provider 로 밖의 IdP·API 연결 | ConsumerKey·IdTokenIssuer (ID), AuthenticationServiceId (로그 ID) | 테넌트 없음 |
| installed_package | AppExchange 관리 패키지 | 패키지 이름·네임스페이스 (이름) | 테넌트 없음 |
| api_user_password_token | username + 비밀번호·보안 토큰으로 API 로그인 | LoginHistory SourceIp·Application (로그 ID), Username (이름) | 테넌트 없음 |
| hosted_mcp_server | 외부 AI 클라이언트가 Salesforce 호스팅 MCP 서버를 부름 (External Client App OAuth) | ECA Consumer Key = 클라이언트 설정 Consumer Key (ID), API_CLIENT_CATEGORY = SALESFORCE_HOSTED_MCP 행 ↔ LoginHistory (로그 시각), 같은 사람 (사람) | 모름 (2026-10-28 더함) |

## Workday ↔ 밖

| 방법 | 무슨 연동 | 같아야 하는 값 | 시험 환경 |
|---|---|---|---|
| entra_inbound_provisioning | Microsoft Entra 가 Workday 직원을 가져옴 (ISU 기본 인증) | Workday Username = ISU@tenant (이름), Web Services URL (이름), 프로비저닝과 ISU 로그인 시각 (로그) | 테넌트 없음 |
| entra_writeback | Microsoft Entra → Workday 이메일·전화 되쓰기 | Admin Username·Tenant URL (이름), 업무 프로세스 시각 (로그) | 테넌트 없음 |
| entra_saml_sso | Microsoft Entra 가 Workday 로그인 (SAML) | IdP 행 Issuer = Entra entityID (ID), 인증서 (지문), Sign-on URL (이름), 로그인 기록의 SAML IdP (로그 ID) | 테넌트 없음 |
| iga_connector | IGA·연동 도구(SailPoint 등)가 Workday 계정 관리 | 서비스 계정 = ISU (이름), Client ID (ID), 로그인 기록 (로그 ID) | 테넌트 없음 |
| oauth_api_client | 밖의 앱이 Workday API 클라이언트로 호출 | Client ID (ID), Redirection URL 호스트 (이름), Scope (이름), 로그인 기록의 API_Client_ID (로그 ID) | 테넌트 없음 |
| isu_password_integration | 밖의 시스템이 ISU 비밀번호로 Web Services·RaaS 호출 | ISU 이름 (이름), 로그인 IP·시각 (로그) | 테넌트 없음 |
| sftp_file_delivery | Workday 연동 → 밖 SFTP 서버 | SFTP 대상 호스트 (이름), 연동 실행 시각 (로그) | 테넌트 없음 |
| outbound_subscription | 업무 프로세스 이벤트 구독 → 밖 엔드포인트 | 엔드포인트 호스트·Subscription_User_Name (이름), 실행 시각 (로그) | 테넌트 없음 |
| orchestrate_send_http | Orchestrate·Extend 의 Send HTTP Request → 밖 API | 대상 호스트 (이름), 자격 이름 (이름) | 테넌트 없음 |
| activity_log_reader | 밖이 Workday 로그인 기록·사용자 활동 읽기 | ISU·클라이언트 이름 (이름), 로그인 기록 (로그 ID) | 테넌트 없음 |
| workday_mcp_external_client | 외부 AI 클라이언트가 Workday MCP 서버(agent.workday.com)에 Agent System User OAuth 로 붙음 (Extend Professionals 전용) | MCP 서버 주소 (이름), 외부 에이전트 OAuth client ID (ID), 같은 사람 (사람) | 모름 (2026-10-30 더함) |
| workday_adaptive_planning_mcp_server | 고객 AI 에이전트가 Adaptive Planning MCP 서버를 부름 (Limited Availability) | 감사 로그의 MCP 도구 호출 사용자 = 에이전트 사용자 (사람), 호출 시각 (로그 시각) | 모름 (2026-10-30 더함) |
