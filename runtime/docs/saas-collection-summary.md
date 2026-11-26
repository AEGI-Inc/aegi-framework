# 6대 SaaS 수집 세팅 요약표

> OAuth 연결과 API Key·자격증명 직접 입력을 모두 지원합니다. 기업 환경에서 세팅이 간편한 경로를 1순위로 배치했습니다.
> 추가 지원 3개 SaaS(**Microsoft 365**, **Google Cloud / Gemini Enterprise**, **1Password**)의 연결 방법은 대시보드 **Adapters** 메뉴의 연결 창 안내를 따릅니다.

## 1. GitHub
| 수집 방법 (우선순위 순) | 필요한 계정 (후순위까지) | 발급 방법 |
| :--- | :--- | :--- |
| **1순위**: 자체 GitHub App 생성 (Manifest · 권한 40종)<br>*(보조: Enterprise Owner Classic PAT)*<br>• **기업이 직접 해야 하는 일**: 대시보드 `[새 GitHub App 생성 (Manifest)]` 클릭 → 대상 조직(·엔터프라이즈) Install 승인 1회 *(SAML `"Overwrite your linked identity?"`가 뜨면 멈추고 관리자에게 확인)* | **1순위**: Enterprise Owner + Org Owner<br>**2순위**: Organization Owner<br>**후순위**: Organization Member (설치 불가) | • **App**: 대시보드 `[새 GitHub App 생성 (Manifest)]` → App ID·PEM 자동 저장 → 조직/엔터프라이즈 Install<br>• **보조 PAT**: `Settings > Developer settings > PAT (classic)` 발급 후 SSO Authorize |
| **2순위**: 자체 GitHub OAuth App 로그인 (기본 10개 scope) | **1순위**: Organization Owner<br>**후순위**: Organization Member (부분 수집) | `Settings > Developer settings > OAuth Apps` 생성 → Client ID/Secret 입력 후 OAuth 로그인 |

## 2. Okta
| 수집 방법 (우선순위 순) | 필요한 계정 (후순위까지) | 발급 방법 |
| :--- | :--- | :--- |
| **1순위**: API Token (SSWS 직접 입력)<br>• **기업이 직접 해야 하는 일**: Okta 콘솔에서 Read-only Admin 이상 계정으로 허용 네트워크(`Any IP` 등)를 지정해 API 토큰 1개 발급 | **1순위**: Read-only Admin / Super Admin<br>**후순위**: Org / Group / Report Admin (부분 수집) | `Okta Admin Console > Security > API > Tokens > Create token` (허용 네트워크 `Any IP` 또는 회사 영역 선택 필수) |
| **2순위**: OIDC Native App (PKCE OAuth, scope 59개) | **앱 생성**: Super Admin<br>**로그인**: Read-only Admin 이상 | `Applications > Create App Integration > OIDC + Native App` 생성 → `Okta API Scopes` 59개 Grant → 계정 배정 후 OAuth 로그인 |
| **3순위**: API Services App (`private_key_jwt` + DPoP, scope 59개) | **1순위**: Super Admin | `Applications > API Services` 생성 → PEM 키 생성 → `Okta API Scopes` 59개 Grant + `Admin Roles`에 Read-only Admin 부여 |

## 3. Slack
| 수집 방법 (우선순위 순) | 필요한 계정 (후순위까지) | 발급 방법 |
| :--- | :--- | :--- |
| **1순위**: 자체 Slack App OAuth (기본 scope 23개: Bot 7 + User 16)<br>*(보조: App Config Token)*<br>• **기업이 직접 해야 하는 일**: Manifest로 사내 앱 생성 → 대시보드에 Client ID·Secret 입력 후 OAuth Allow + **(Enterprise Grid) 조직 관리에서 `Add to more workspaces` > `Who can use?` > `Save`** | **1순위(Grid)**: Enterprise Grid Org Owner / Admin<br>**1순위(일반)**: Workspace Owner / Admin<br>**후순위**: Workspace Member (관리자 API 불가) | • **OAuth**: `api.slack.com/apps > From a manifest` 생성(Redirect: `https://127.0.0.1:5199/__aegi/oauth/callback`) → Client ID/Secret 입력 후 `[OAuth로 연결 시작]` → Allow<br>• **보조 토큰**: `api.slack.com/apps` 하단 `Your App Configuration Tokens > Generate Token` |
| **2순위**: App Manifest 자체 앱 설치 후 토큰 직접 입력 | **1순위**: Workspace Owner / Admin (또는 Org Admin) | `api.slack.com/apps > Create New App > From a manifest` → Install 후 `xoxb-`, `xoxp-` 토큰 복사 |

## 4. Google Workspace
| 수집 방법 (우선순위 순) | 필요한 계정 (후순위까지) | 발급 방법 |
| :--- | :--- | :--- |
| **1순위**: 서비스 계정 JSON 키 + 도메인 전체 위임 (DWD, API 13개 · 위임 scope 40개)<br>• **기업이 직접 해야 하는 일**: Cloud Shell 스크립트 1회 실행(전용 프로젝트 `AEGI Collector`를 만들어 쓰며 이미 있으면 그것을 재사용 · 처음 계정이면 온보딩 후 우측 상단 `>_` 버튼 클릭) + 관리 콘솔 DWD(40개 scope) 등록 | **1순위**: Super Admin (최고 관리자)<br>**후순위**: 위임 관리자 / 일반 계정 (DWD 설정 불가) | 대시보드 `[Cloud Shell 명령어 복사]` → GCP Cloud Shell 실행 → `admin.google.com > 보안 > API 제어 > 도메인 전체 위임`에 Client ID 및 40개 스코프 등록 |
| **2순위**: 자체 GCP OAuth Client (Internal, 관리자 15개 scope) | **1순위**: GCP Owner/Editor + GWS Super Admin<br>**2순위**: User / Groups / Reports Admin (부분 수집) | `GCP Console > Credentials > Create OAuth client ID (데스크톱 앱)` 생성 → Client ID/Secret 입력 및 OAuth 로그인 |

## 5. Salesforce
| 수집 방법 (우선순위 순) | 필요한 계정 (후순위까지) | 발급 방법 |
| :--- | :--- | :--- |
| **1순위**: OAuth 2.0 (PKCE) 로그인 (`api`, `refresh_token`)<br>• **기업이 직접 해야 하는 일**: 내장 패키지(`04taj000000rlATAAY`, PKCE 무비밀) 1회 설치 또는 자체 Connected App 생성 후 대시보드에서 OAuth 로그인 및 관리자 Allow 1회 | **1순위**: System Administrator<br>**2순위**: 수집 전용 사용자 + 조회 Permission Set<br>**후순위**: Standard User (부분 수집) | • **내장 PKCE 앱**: 1) 패키지 설치(`https://login.salesforce.com/packaging/installPackage.apexp?p0=04taj000000rlATAAY`, Sandbox는 `test.salesforce.com`) → 2) `SALESFORCE_INSTANCE_URL` 확인/비움 후 `[계정 연결]`<br>• **자체 앱**: `Setup > App Manager > New Connected App` (PKCE 체크) 생성 → Consumer Key 입력 후 OAuth 로그인 |
| **2순위**: Client Credentials Flow (Key + Secret) | **1순위**: System Administrator (또는 읽기 전용 통합 사용자) | `Setup > External Client App / Connected App` 생성 → `Policies`에서 Client Credentials 활성화 및 `Run As` 계정 지정 → Consumer Key/Secret 복사 |

## 6. Atlassian (Jira & Confluence & Guard)
| 수집 방법 (우선순위 순) | 필요한 계정 (후순위까지) | 발급 방법 |
| :--- | :--- | :--- |
| **1순위**: 이메일 + 일반 API Token + **조직 ID · 조직 Admin API 키 (7개 범위)**<br>• **기업이 직접 해야 하는 일**: 사이트 일반 API 토큰 1개 + 조직 관리(`admin.atlassian.com`)에서 조직 ID 확인·조직 API 키 1개 발급 | **1순위**: Org / Site Admin + Jira Admin + Confluence Admin<br>**2순위**: 단일 제품 Admin / Project Admin (부분 수집)<br>**후순위**: 일반 사용자 (열람 가능 항목만) | • **조직 키 (1단계)**: `admin.atlassian.com > Settings > API keys > Create API key` (`read:orgs:admin`, `read:directories:admin`, `read:groups:admin`, `read:events:admin`, `read:domains:admin`, `read:policies:admin`, `read:service-accounts-tokens:admin`) + URL의 `orgId`<br>• **일반 토큰 (2단계)**: `id.atlassian.com/manage-profile/security/api-tokens > Create API token` |
| **2순위**: 자체 OAuth 2.0 (3LO) 로그인 | **1순위**: Site Admin + Jira Admin + Confluence Admin | `developer.atlassian.com/console/myapps > OAuth 2.0 integration` 생성 → Jira/Confluence 읽기 권한 및 Callback 등록 → Client ID/Secret 입력 후 OAuth 로그인 |
