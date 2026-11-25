# v3 수집 자격증명과 권한 보완 목록

완전 수집을 위해 지금 추가 확보가 확정된 비밀값은 **Slack 앱 설정 토큰 `SLACK_CONFIG_TOKEN`**이다. GitHub Enterprise 설치 ID와 소유자 토큰은 수집 대상에 따라 필요한 조건부 항목이다. 기존 Slack·GitHub·Okta·Google Workspace 수집 자격증명은 확보되어 있으며, 일부 호출의 권한 오류를 새 토큰 누락으로 해석하면 안 된다.

확인일: 2026-10-23. 이 문서는 코드의 자격증명 매핑과 기존 로컬 준비 상태를 대조한 결과이며, 새 수집이나 외부 권한 변경을 실행하지 않았다. 원본 실측 응답, 개인 정보, 실제 테넌트 식별자와 비밀값은 포함하지 않는다. 아래 권한은 공식 문서와 코드에서 확인한 요구 사항이며, **실제 테넌트에서 필요한 최소 관리자 역할까지 검증한 것은 아니다.**

## 1. 추가 확보할 항목

| 구분 | 정확한 이름 | 필요한 대상과 용도 | 준비할 내용·조건 |
| --- | --- | --- | --- |
| 필수: 앱 매니페스트 수집 대상 | `SLACK_CONFIG_TOKEN` (`CRED-SL-03`) | `SL-10`: 발견한 Slack 앱의 매니페스트, slash command 설정, 요청 scope 조회 | 대상 워크스페이스에서 해당 앱을 관리할 수 있는 개발자의 **App Configuration Access Token**. 사용자 OAuth 토큰이나 봇 토큰으로 대체하지 않는다. 여러 개발자가 소유한 앱을 전부 내보낼 수 있는지 별도로 확인한다. |
| 조건부: Enterprise 감사 로그 | `GITHUB_APP_ENTERPRISE_INSTALLATION_ID` (`CRED-GH-01-ENT`) | `GH-19`: `/enterprises/{enterprise}/audit-log` | **토큰이 아닌 설치 ID**다. 대상이 실제 Enterprise 계정인지, 수집 앱을 그 Enterprise에 설치했는지 먼저 확인한다. 기존 `GITHUB_APP_ID`와 `GITHUB_APP_PRIVATE_KEY`를 함께 사용해 설치 토큰을 만드는 현재 코드 경로다. 설치 ID만 추가하면 API 인증이 해결된다는 보장은 없다. |
| 조건부: SAML 승인 조회·Enterprise 외부 신원 | `GITHUB_OWNER_TOKEN` (`CRED-GH-02`) | `GH-22`: 조직 SAML 자격증명 승인 목록. `GH-20`: Enterprise SAML 외부 신원 조회에 있으면 우선 사용 | `GH-22`는 현재 코드에서 선택 호출이다. 조직 SAML SSO를 사용하고 이 데이터가 완료 범위에 포함될 때 준비한다. `GH-20`은 토큰이 없으면 기본 App 인증으로 시도한다. Enterprise SAML을 쓰는 경우에는 소유자 인증이 필요한지 확인한다. |

Slack 설정 토큰은 [Slack 앱 설정 페이지](https://api.slack.com/apps)의 **Your App Configuration Tokens → Generate Token**에서 만든다. 토큰은 사용자와 워크스페이스에 연결되고 12시간 뒤 만료하므로 수집 직전에 준비한다. 수집기는 refresh token을 자동으로 회전하지 않는다. [Slack 설정 토큰 안내](https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests)

`apps.manifest.export`의 공식 요구 사항은 configuration token의 `app_configurations:read`다. 공식 현재 문서는 POST를 명시하지만 기존 수집기는 GET으로 호출하므로, 토큰 확보 후에도 요청 방식과 앱별 접근 가능 여부를 검증해야 한다. 설정 토큰을 얻었다는 사실만으로 전체 앱 조회 완료를 선언하지 않는다. [Slack 매니페스트 내보내기](https://docs.slack.dev/reference/methods/apps.manifest.export/)

GitHub 소유자 토큰의 권한은 용도별로 다르다.

| 용도 | 공식 문서에서 확인한 조건 | 이 저장소에서의 판단 |
| --- | --- | --- |
| `GH-22` 조직 SAML 승인 목록 | 조직 소유자. classic PAT·OAuth 토큰은 `read:org`. 문서는 App user token·설치 토큰·fine-grained PAT와 조직 `Administration: read`도 지원한다고 명시한다. | 현재 구현은 `GITHUB_OWNER_TOKEN`이 있어야 실행한다. 조직 소유자의 `read:org` classic PAT가 명확한 준비 경로지만, 기존 App의 `Administration: read`를 활용하는 코드 개선 가능성도 남아 있다. 무조건 새 PAT를 발급할 필요가 있다고 단정하지 않는다. [공식 REST 문서](https://docs.github.com/en/enterprise-cloud@latest/rest/orgs/orgs#list-saml-sso-authorizations-for-an-organization) |
| `GH-20` Enterprise SAML 외부 신원 | Enterprise SAML 외부 신원은 Enterprise 소유자 또는 그 소유자의 classic PAT `read:enterprise`·`admin:enterprise`로 볼 수 있다. | 이 호출만 필요하면 읽기 권한 `read:enterprise`가 우선 검토 대상이다. `GH-22`와 같은 토큰을 사용하려면 필요한 조건을 각각 충족해야 한다. [공식 GraphQL 안내](https://docs.github.com/en/graphql/reference/enterprise-admin) |
| `GH-19` Enterprise 감사 로그 | 문서에는 classic PAT·OAuth 토큰의 `read:audit_log`와 Enterprise 관리자 조건이 명시돼 있다. 같은 페이지에 classic PAT 한정 안내와 App 설치 토큰의 `Enterprise administration: read` 지원 표가 함께 있어 설명이 일치하지 않는다. | Enterprise 적용 여부와 설치·권한을 확인한 뒤 지원 인증 방식을 검증한다. 현재 코드는 소유자 PAT를 `GH-19`에 사용하지 않으므로, PAT 대체 경로를 택하면 코드 수정도 필요하다. [공식 감사 로그 문서](https://docs.github.com/en/enterprise-cloud@latest/rest/enterprise-admin/audit-log#get-the-audit-log-for-an-enterprise) |

## 2. 이미 확보한 수집 자격증명

아래 항목은 기존 준비 상태에서 존재가 확인됐다. 이번 문서 작성 중 실제 값을 읽거나 재인증하지 않았으므로 현재 유효기간·폐기 여부를 보장하지는 않는다.

| 서비스 | 현재 수집 코드가 읽는 이름 | 인증 방식 |
| --- | --- | --- |
| GitHub | `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` | App JWT → 조직 설치 access token 자동 발급. Enterprise 설치 ID와 별개다. |
| Slack | `SLACK_COLLECTOR_USER_TOKEN`, `SLACK_COLLECTOR_BOT_TOKEN` | 조직 설치 사용자 OAuth 토큰과 같은 수집 앱의 봇 OAuth 토큰. 기존 검사에서는 대상 조직·워크스페이스가 일치했다. |
| Okta | `OKTA_ORG_URL`, `OKTA_COLLECTOR_CLIENT_ID`, `OKTA_COLLECTOR_KEY_ID`, `OKTA_COLLECTOR_PRIVATE_KEY` | OAuth 서비스 앱의 `client_credentials` + `private_key_jwt`; 수집기는 DPoP도 처리한다. access token은 실행 중 자동 발급한다. |
| Google Workspace | `GWS_COLLECTOR_SA_KEY` | 수집 전용 서비스 계정 JSON + Domain-Wide Delegation(DWD). 관리자 또는 대상 사용자를 가장해 API별 access token을 발급한다. |
| Salesforce | `SALESFORCE_INSTANCE_URL`, `SALESFORCE_COLLECTOR_CLIENT_ID`, `SALESFORCE_COLLECTOR_CLIENT_SECRET` | Connected App OAuth client credentials. |
| Atlassian | `ATLASSIAN_SITE_URL`, `ATLASSIAN_COLLECTOR_EMAIL`, `ATLASSIAN_COLLECTOR_API_TOKEN` | 전용 계정 이메일 + API 토큰의 Basic 인증. |
| Atlassian 조직 | `ATLASSIAN_COLLECTOR_ORG_API_KEY` (조직 id 는 설정 `atlassian.orgId`) | admin.atlassian.com 조직 API 키(SCOPED, 읽기 범위만)의 Bearer 인증. 레지스트리의 조직 관리 API 호출에만 쓴다. |
| Worker | `WORKER_COLLECTOR_TOKEN` | 수집용 bearer token. |

`OKTA_API_TOKEN`, `GWS_SA_KEY_FILE`, `SLACK_SETUP_TOKEN` 등은 세팅 도구의 자격증명이며 위 수집 전용 값과 구분한다. 관리자 보충 조회가 필요하더라도 기존 수집 계정에 상시 최고 관리자 권한을 부여하는 방식을 기본 해결책으로 삼지 않는다.

## 3. 새 토큰 발급보다 먼저 확인할 권한

### Slack

| 호출 | 막힌 종류 | 필요한 조치 |
| --- | --- | --- |
| `SL-04`, `SL-05` | 수집 봇이 일부 채널의 멤버가 아님 | 수집 범위에 포함할 채널을 확정하고 기존 수집 봇의 참여 여부를 보완한다. 메시지 이력은 봇이 참여한 채널과 관련 `*:history` scope가 있어야 읽을 수 있다. 토큰 재발급만으로 채널 가입을 대체할 수 없다. [공식 이력 조회 문서](https://docs.slack.dev/reference/methods/conversations.history/) |
| `SL-09` | `team.integrationLogs`의 `missing_scope` | 기존 사용자 토큰에 legacy `admin` scope가 있는지 확인한다. 이 API는 관리자 사용자와 `admin`을 요구하며, `admin.apps:read` 같은 granular scope와 다르다. 실제 앱에서 해당 scope를 승인할 수 있는지 확인한 뒤 재설치·재승인 필요 여부를 결정한다. [공식 연동 기록 문서](https://docs.slack.dev/reference/methods/team.integrationLogs/) |
| `SL-90` | 외부 팀 조회의 `not_allowed_token_type` | 사용자 토큰을 쓰는 기존 코드부터 확인한다. 현행 공식 문서는 bot token과 `conversations.connect:manage`·`team:read`를 표시한다. 새 사용자 토큰 요청으로 해결할 항목이 아니다. 쓰기 성격의 scope가 포함되므로 bot 경로에서 기존 scope로 가능한 범위를 먼저 검증한다. [공식 외부 팀 문서](https://docs.slack.dev/reference/methods/team.externalTeams.list/) |

기존 수집 앱 매니페스트의 사용자 scope는 `admin.teams:read`, `admin.users:read`, `admin.conversations:read`, `admin.apps:read`, `admin.usergroups:read`, `auditlogs:read`다. 봇 scope는 `team:read`, `users:read`, `users:read.email`, `channels:read`, `groups:read`, `channels:history`, `groups:history`, `usergroups:read`, `files:read`다. 이는 저장소의 설정 목록이며 모든 현재 수집 호출의 최소 권한을 보증하는 목록이 아니다. 앱 매니페스트를 수정하는 것과 설치 토큰에 실제 권한을 반영하는 것은 별도로 확인해야 한다.

### Okta

403이 난 항목은 기존 수집 서비스 앱의 **scope grant와 관리자 역할·리소스 접근 범위**를 함께 확인한다. `config.okta.scopes`에 문자열을 추가하는 것만으로 서버의 grant가 생기지 않는다. 서비스 앱에 Okta scope를 발급하는 인증은 `private_key_jwt`이며, scope grant와 별도로 관리자 역할이 필요하다. [공식 서비스 앱 안내](https://developer.okta.com/docs/guides/implement-oauth-for-okta-serviceapp/)

| 호출 | 확인할 scope | 아직 확정하지 못한 점 |
| --- | --- | --- |
| `OK-14` 사용자 스키마 | `okta.schemas.read` | 기본 Read-only Administrator로 해당 스키마를 볼 수 있는지, 역할·리소스 범위가 부족한지 |
| `OK-15` API 서비스 통합 | `okta.oauthIntegrations.read` | 해당 API의 실제 관리자 역할 및 테넌트 기능 조건 |
| `OK-17` 로그 스트림 | `okta.logStreams.read` | scope가 있어도 403이면 역할·기능 조건 확인 |
| `OK-19` 프로필 매핑 상세 | `okta.profileMappings.read` | 목록과 개별 매핑에 적용되는 리소스 접근 차이 |
| `OK-21` 보안 이벤트 제공자 | `okta.securityEventsProviders.read` | scope와 관리자 역할·기능 조건 |
| `OK-90` Realm 존재 확인 | `okta.realms.read` | App grant와 해당 기능 사용 여부 |

이 scope 명칭과 읽기 용도는 [Okta 공식 scope 목록](https://developer.okta.com/docs/api/oauth2/)에서 확인했다. 테넌트별 최소 역할은 미확정이므로 새 개인키 발급이나 최고 관리자 역할 부여를 필수로 요청하지 않는다. `scripts/setup/collectorScopes.ts`는 일부 추가 읽기 grant를 점검하는 기존 도구지만 모든 역할 문제를 해결하지는 않는다.

### Google Workspace

기존 서비스 계정의 서명 키, DWD 허용 scope, 실행 코드의 요청 scope, 가장 대상 관리자의 실제 권한은 서로 다른 확인 항목이다. DWD는 서비스 계정의 client ID에 허용 scope를 등록하는 방식이므로, **scope·관리자 권한 오류만으로 새 서비스 계정 JSON 키가 필요하다고 단정하지 않는다.** [공식 DWD 안내](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority)

| 호출 | 확인할 전체 scope | 필요한 확인 |
| --- | --- | --- |
| `GW-02` 도메인 | `https://www.googleapis.com/auth/admin.directory.domain.readonly` | DWD 허용 및 가장 대상 관리자의 도메인 조회 권한. [공식 API](https://developers.google.com/workspace/admin/directory/reference/rest/v1/domains/list) |
| `GW-06` 관리자 역할·배정 | `https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly` | DWD 허용 및 관리자 역할 조회 권한. [공식 API](https://developers.google.com/workspace/admin/directory/reference/rest/v1/roles/list) |
| `GW-19` 공유 드라이브 목록 | `https://www.googleapis.com/auth/drive.readonly` | 기존 `drive.metadata.readonly`는 공식 `drives.list` 허용 scope에 없다. 코드에서 목록 요청 scope를 분리하고 DWD와 `gws.grantedScopes`에 `drive.readonly`를 허용해야 한다. 이 scope는 파일 내용 읽기도 허용하므로 승인 범위를 분명히 한다. 새 키 발급은 요구하지 않는다. [공식 API](https://developers.google.com/workspace/drive/api/reference/rest/v3/drives/list) |
| `GW-24` 정책 | `https://www.googleapis.com/auth/cloud-identity.policies.readonly` | scope 외에 정책 접근 권한과 기능·라이선스 조건을 확인한다. 현 상태만으로 최소 관리자 역할은 확정할 수 없다. [공식 API](https://docs.cloud.google.com/identity/docs/reference/rest/v1/policies/list) |
| `GW-90` 모바일 기기 존재 확인 | `https://www.googleapis.com/auth/admin.directory.device.mobile.readonly` | 코드가 요구하는 DWD scope와 가장 대상의 기기 조회 권한을 대조한다. |
| `GW-05`, `GW-18` 사용자 보안 정보 | `https://www.googleapis.com/auth/admin.directory.user.security` | 일부 사용자 401은 전체 서비스 계정 키 실패와 구분한다. 수집 대상의 관리자 계층 및 가장 대상 권한을 확인한다. |

## 4. 토큰으로 해결되지 않는 잔여 항목

- 원본 v3 수집 설정과 보충 데이터가 아직 대조되지 않았다. 실제 수집 대상, 기간, 숨은 Apps Script 등 API 목록으로 발견할 수 없는 대상의 힌트를 확정해야 한다.
- Slack의 `usergroup_not_found`, `bot_not_found`, `feature_not_enabled`는 각각 ID 종류·대상 존재·기능 사용 여부를 확인해야 한다. Salesforce MFA 조회의 400, GitHub 조직 설정 조회의 권한 오류와 패키지 조회 오류도 각 API의 계약·인증을 점검해야 하며 새 토큰 목록으로 묶지 않는다.
- Salesforce Named Credential 등 현재 수집 기능이 없는 설정, 감사 로그만 남은 시나리오, SaaS 간 연결 규칙 누락은 코드·보충 증거·회귀 검증을 따로 보완해야 한다. 데이터 게시만으로 해결되지 않는다.

## 5. 전달과 완료 확인

비밀값은 채팅·문서·이슈에 붙이지 않고 `npm run secret -- set <KEY_NAME> <VALUE>` 또는 `npm run secret -- set-file <KEY_NAME> <FILE_PATH>`로 Secret Vault에 등록한다. 수집기는 `NAME` 또는 `NAME_FILE` 입력을 지원하지만 실제 값·개인키·서비스 계정 JSON을 커밋하지 않는다. 세팅용 자격증명과 수집용 자격증명을 혼용하지 않는다.

자격증명 준비 완료는 이름이 채워진 상태를 뜻한다. 완전 수집 완료는 요청 범위와 실제 권한을 대조하고, 필수 호출의 미해결 누락을 해소하며, 대상 없음·기능 미사용·API 한계에는 근거를 남긴 상태다. 이 문서를 작성한 것만으로 재수집이나 대시보드 노출 검증이 완료되지는 않는다.

코드 근거: `scripts/collect/config.ts`, `scripts/collect/lib/auth.ts`, `scripts/collect/providers/{slack,github,okta,gws}.ts`, `scripts/setup/collectorScopes.ts`, `scripts/setup/assets/slack-collector-app.manifest.json`.
