# 6대 SaaS 어댑터 우선순위별 필수 권한 스코프(Scope) 정리

수집 엔진과 카탈로그 수집기가 요구하는 **SaaS별 · 연결 우선순위별 권한 스코프** 전체 목록입니다.

---

## 1. GitHub

| 우선순위 | 연결 방식 | 구분 | 필수 권한 / 스코프 (Scopes & Permissions) | 대응 수집 항목 |
| :---: | :--- | :--- | :--- | :--- |
| **1순위** | **자체 GitHub App (Manifest 생성)**<br>(`CRED-GH-01`, 총 **40개 권한**) | **Manifest `default_permissions` (40개)**<br>*(읽기 중심 + API 요구 3종 `write` 포함)* | `metadata: read`, `contents: read`, `pull_requests: read`, `administration: read`, `actions: read`, `actions_variables: read`, `repository_hooks: read`, `members: read`, `organization_administration: write`, `organization_custom_roles: read`, `organization_personal_access_tokens: read`, `organization_personal_access_token_requests: read`, `organization_hooks: read`, `organization_events: read`, `organization_self_hosted_runners: read`, `organization_custom_org_roles: read`, `organization_custom_properties: read`, `organization_actions_variables: read`, `environments: read`, `packages: read`, `deployments: read`, `secrets: read`, `dependabot_secrets: read`, `organization_secrets: read`, `organization_dependabot_secrets: read`, `organization_campaigns: read`, `code_quality: read`, `organization_code_scanning_dismissal_requests: read`, `organization_dependabot_dismissal_requests: read`, `organization_copilot_spaces: read`, `organization_copilot_seat_management: read`, `issue_fields: read`, `issue_types: read`, `organization_projects: read`, `organization_private_registries: read`, `organization_codespaces_secrets: read`, `codespaces_secrets: write`, `repository_advisories: write`, `vulnerability_alerts: read`, `security_events: read` | `GH-01~17`, `GH-21`, `GH-24~34`, `GH-90` + 카탈로그 저장소·조직 API |
| | | **Enterprise Permissions**<br>(Enterprise 설치 시 `Read-only`) | `Enterprise custom roles`, `Members`, `Organization installation`, `Audit log` (지원 플랜) | `GH-19` (Enterprise 감사 로그) |
| **2순위** | **Personal Access Token (Classic PAT)**<br>또는 **자체 OAuth App** (`CRED-GH-01` / `CRED-GH-02`) | **OAuth Scopes (10개)** | `repo`, `read:org`, `admin:org`, `admin:org_hook`, `read:user`, `user:email`, `read:packages`, `read:audit_log`, `read:enterprise`, `manage_runners:enterprise` | `GH-01~34` 전체 + `GH-19`, `GH-20`(SAML SSO 매핑), `GH-22`, `GH-23`, 엔터프라이즈 러너 |
| **3순위** | **Fine-grained PAT** | **Repository / Org Permissions** | 1순위 GitHub App 40개 권한과 동일 (단, GraphQL SAML `externalIdentities` 및 Enterprise API는 Classic PAT 필요) | 조직·저장소 REST 수집 (`GH-01~17`, `GH-24~34`) |

---

## 2. Okta

| 우선순위 | 연결 방식 | 구분 | 필수 권한 / 스코프 (Scopes & Roles) | 대응 수집 항목 |
| :---: | :--- | :--- | :--- | :--- |
| **1순위** | **SSWS API Token**<br>(`OKTA_API_TOKEN`, `CRED-OK-01`) | **관리자 역할 상속**<br>(별도 Scope 체크 불필요) | 토큰 발급 계정에 **`Read-only Administrator`** (또는 `Super Administrator`) 역할 부여 | `OK-01~23` + 카탈로그 Management API 전체 (Scope 누락 스킵 없음) |
| **2순위** | **OAuth 2.0 PKCE (OIDC 앱)**<br>(`OKTA_COLLECTOR_REFRESH_TOKEN`) | **전체 요청 Scope (59개)**<br>(`Okta API Scopes` 탭 Grant: `okta.*.read` 58개 + `ssf.read`) | `okta.orgs.read`, `okta.users.read`, `okta.groups.read`, `okta.roles.read`, `okta.apps.read`, `okta.clients.read`, `okta.policies.read`, `okta.logs.read`, `okta.schemas.read`, `okta.oauthIntegrations.read`, `okta.apiTokens.read`, `okta.eventHooks.read`, `okta.inlineHooks.read`, `okta.logStreams.read`, `okta.idps.read`, `okta.profileMappings.read`, `okta.authenticators.read`, `okta.trustedOrigins.read`, `okta.deviceAssurance.read`, `okta.networkZones.read`, `okta.agentPools.read`, `okta.securityEventsProviders.read`, `ssf.read`, `okta.emailServers.read`, `okta.accessRequests.request.read`, `okta.aiAgents.read`, `okta.appGrants.read`, `okta.authorizationServers.read`, `okta.behaviors.read`, `okta.brands.read`, `okta.captchas.read`, `okta.customTelephonyProvider.read`, `okta.deviceIntegrations.read`, `okta.devicePostureChecks.read`, `okta.devices.read`, `okta.domains.read`, `okta.emailDomains.read`, `okta.governance.accessCertifications.read`, `okta.governance.accessRequests.read`, `okta.governance.admin.read`, `okta.governance.labels.read`, `okta.governance.riskRule.read`, `okta.linkedObjects.read`, `okta.principalRateLimits.read`, `okta.pushProviders.read`, `okta.rateLimits.read`, `okta.realmAssignments.read`, `okta.realms.read`, `okta.resourceServers.apiServers.read`, `okta.resourceServers.clientAuthSettings.read`, `okta.resourceServers.mcpServers.read`, `okta.resourceServers.read`, `okta.resourceServers.virtualMcpServers.read`, `okta.serviceAccounts.okta.read`, `okta.serviceAccounts.read`, `okta.templates.read`, `okta.threatInsights.read`, `okta.uischemas.read`, `okta.userTypes.read` | `OK-01~23` + `okta_management_openapi` 카탈로그 전체 |
| **3순위** | **API Services 앱 (`private_key_jwt` + DPoP)** | **Okta API Scopes + Admin Role** | 2순위와 동일한 **59개 Scope** Grant + 앱의 `Admin Roles` 탭에 `Read-only Administrator` 배정 | `OK-01~23` + 카탈로그 전체 |

---

## 3. Slack

| 우선순위 | 연결 방식 | 구분 | 필수 권한 / 스코프 (Scopes · 기본 OAuth 총 **23개**) | 대응 수집 항목 |
| :---: | :--- | :--- | :--- | :--- |
| **1순위** | **자체 앱 OAuth** 또는 **App Manifest 토큰 발급**<br>(`CRED-SL-01` User + `CRED-SL-02` Bot) | **Bot Token Scopes (`xoxb-`, 기본 7개 + 선택 1개)** | `users:read`, `channels:read`, `groups:read`, `channels:history`, `groups:history`, `team:read`, `usergroups:read`<br>*(선택·기본 해제: `conversations.connect:manage` — Slack Connect `team.externalTeams.list` 조회용)* | `SL-00`, `SL-02~07`, `SL-15`, `SL-90`, Slack Connect |
| | | **User Token Scopes (`xoxp-`, 기본 6개)** | `users:read`, `users.profile:read`, `channels:read`, `groups:read`, `usergroups:read`, `team:read` | 일반 워크스페이스 사용자·프로필·채널·팀 검증 |
| | | **User Token Scopes (Enterprise Grid 10개)** | `admin`, `admin.users:read`, `admin.conversations:read`, `admin.teams:read`, `admin.usergroups:read`, `admin.apps:read`, `admin.roles:read`, `admin.workflows:read`, `admin.barriers:read`, `auditlogs:read` | `SL-00`(조직 팀 목록), `SL-01`, `SL-03`(비공개 채널 검색), `SL-08`, `SL-09`, `SL-11`(Audit Logs), `SL-13`, `SL-16~18` |
| **보조 (선택)** | **App Configuration Token**<br>(`CRED-SL-03`, `xoxe.xoxp-...` / `xoxe-1-...`) | **Configuration Token (`app_configurations:read`)** | OAuth scope가 아닌 Configuration 전용 토큰 — `api.slack.com/apps` 하단 `Your App Configuration Tokens`에서 발급 | `SL-10` (`apps.manifest.export`), `functions.distributions.permissions.list` |

---

## 4. Google Workspace

| 우선순위 | 연결 방식 | 구분 | 필수 권한 / 스코프 (`https://www.googleapis.com/auth/...`) 및 활성화 API | 대응 수집 항목 |
| :---: | :--- | :--- | :--- | :--- |
| **1순위 (전체 수집)** | **서비스 계정 JSON 키 + 도메인 전체 위임 (DWD)**<br>(`CRED-GW-01`, 위임 scope **40개** · 활성화 API **13개**) | **GCP 프로젝트 활성화 API (13개)** | `admin.googleapis.com`, `drive.googleapis.com`, `cloudidentity.googleapis.com`, `groupssettings.googleapis.com`, `gmail.googleapis.com`, `calendar-json.googleapis.com`, `script.googleapis.com`, `forms.googleapis.com`, `alertcenter.googleapis.com`, `chromemanagement.googleapis.com`, `vault.googleapis.com`, `licensing.googleapis.com`, `drivelabels.googleapis.com` | 전수 수집 및 `SERVICE_DISABLED` 방지 |
| | | **도메인 전체 위임(DWD) Scope (40개)** | • **관리자 OAuth 15개**: `admin.directory.customer.readonly`, `admin.directory.domain.readonly`, `admin.directory.user.readonly`, `admin.directory.group.readonly`, `admin.directory.group.member.readonly`, `admin.directory.user.security`, `admin.directory.rolemanagement.readonly`, `admin.reports.audit.readonly`, `cloud-identity.inboundsso.readonly`, `drive.readonly`, `drive.metadata.readonly`, `admin.directory.orgunit.readonly`, `apps.groups.settings`, `cloud-identity.allowlisteddomains.readonly`, `cloud-identity.policies.readonly`<br>• **DWD 확장·사용자 가장 25개**: `forms.body.readonly`, `script.projects.readonly`, `script.processes`, `script.deployments.readonly`, `gmail.settings.basic`, `gmail.labels`, `calendar.acls.readonly`, `calendar.readonly`, `admin.datatransfer.readonly`, `admin.directory.device.chromebrowsers.readonly`, `admin.directory.device.chromeos.readonly`, `admin.directory.device.mobile.readonly`, `admin.directory.resource.calendar.readonly`, `admin.chrome.printers.readonly`, `apps.alerts`, `apps.licensing`, `chrome.management.appdetails.readonly`, `chrome.management.connectors.readonly`, `chrome.management.profiles.readonly`, `chrome.management.reports.readonly`, `chrome.management.telemetry.readonly`, `cloud-identity.devices.readonly`, `cloud-identity.groups.readonly`, `drive.apps.readonly`, `drive.labels.readonly`, `ediscovery.readonly` *(중복 제외 총 40개, 대시보드 `[DWD Scope 목록 일괄 복사]` 기준)* | `GW-01~24` 전체 + 카탈로그 확장 API |
| **2순위 (관리자 OAuth)** | **자체 GCP Desktop OAuth 2.0**<br>(`GWS_COLLECTOR_REFRESH_TOKEN`) | **관리자 동의 Scope (15개)** | 위 **관리자 OAuth 15개** (DWD 전용 사용자 가장 호출은 자동 건너뜀) | 관리자 호출 15개 즉시 수집 |

---

## 5. Salesforce

| 우선순위 | 연결 방식 | 구분 | 필수 권한 / 스코프 (OAuth Scopes & System Permissions) | 대응 수집 항목 |
| :---: | :--- | :--- | :--- | :--- |
| **1순위** | **OAuth 2.0 (PKCE)**<br>(`SALESFORCE_COLLECTOR_REFRESH_TOKEN`) | **내장 PKCE 패키지 설치 또는 자체 Connected App OAuth Scopes (2개)** | 내장 앱 사용 시 먼저 패키지 설치(`https://login.salesforce.com/packaging/installPackage.apexp?p0=04taj000000rlATAAY`, Sandbox는 `test.salesforce.com`) 후 OAuth 동의: `api` (`Manage user data via APIs`), `refresh_token` (`Perform requests at any time / offline_access`) | `SF-01~10`, `SFS-01`, `SF-90` + 카탈로그 `sObjects` 전체 |
| | | **로그인 계정 프로필/권한셋 권한** | `API Enabled`, `View Setup and Configuration`, `View All Users`, `View Roles and Role Hierarchy`, `View All Profiles`, `View All Data` (또는 `Minimum Access - API Only` + 읽기 권한셋) | `Organization`, `User`, `Profile`, `PermissionSet`, `SamlSsoConfig`, `AuthProvider`, `Flow`, `ApexClass`, `NamedCredential` SOQL/Tooling 조회 |
| **2순위** | **Client Credentials (Connected App / ECA)**<br>(`CRED-SF-01`) | **Connected App / ECA 설정** | OAuth Scope `api` + Policies → `Enable Client Credentials Flow` 체크 및 `Run As (Username)`에 위 읽기 권한 통합 사용자 지정 | 1순위와 동일 (`SF-01~10`, `SF-90` 전체) |

---

## 6. Atlassian

| 우선순위 | 연결 방식 | 구분 | 필수 권한 / 스코프 (Scopes & Roles) | 대응 수집 항목 |
| :---: | :--- | :--- | :--- | :--- |
| **1순위** | **사이트 API Token (권장)**<br>(`CRED-AT-01`, Basic Auth) | **토큰 종류 및 계정 역할** | 일반 API 토큰(`Create API token`, Unscoped) + **Jira Administrators** + **Confluence Administrators** + **Site / Org Admin** | `AT-01`, `JI-02~08`, `CF-01~03`, `JI-90`, `CF-90` + 카탈로그 전체 |
| **보조 (조직 감사)** | **Organization Admin API Key**<br>(`CRED-AT-ORG-01/02`) | **조직 API Key Scope (7개)** | `read:orgs:admin`, `read:directories:admin`, `read:groups:admin`, `read:events:admin`, `read:domains:admin`, `read:policies:admin`, `read:service-accounts-tokens:admin` | 조직 정보·디렉터리·그룹·도메인·정책·OAuth 클라이언트 및 `AT-90` 조직 감사 이벤트 (`/v1/orgs/{orgId}/events`) |
| **2순위** | **자체 OAuth 2.0 (3LO) 앱 연동**<br>(`ATLASSIAN_COLLECTOR_REFRESH_TOKEN`) | **3LO 핵심 OAuth Scopes (6개 + `offline_access`)** | `read:jira-user`, `read:jira-work`, `manage:jira-configuration`, `read:space:confluence`, `read:space-details:confluence`, `read:audit-log:confluence`, `offline_access` | `AT-01`, `JI-02~07`, `CF-01~02`, `CF-90` |
