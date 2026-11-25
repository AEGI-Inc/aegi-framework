/**
 * SaaS 연결 창(SaasConnect.tsx)의 입력 칸마다 붙는 발급 안내 및 OAuth 앱 등록·설치, 동의 안내.
 * 용어 규칙: 앱 등록 / 등록 위치 / 설치 / 동의 / 토큰 / aegi-demo 를 구분하여 표기한다.
 */
export interface CredentialGuide {
  /** 마우스를 올렸을 때 보이는 한 줄 */
  summary: string
  /** 콘솔에서 따라 할 순서 */
  steps: string[]
  /** 값이 화면 어디에 보이는지, 형식, 주의할 점 */
  notes?: string[]
  sources: Array<{ title: string; url: string }>
}

export interface RequiredAccountRole {
  /** 권장 로그인/발급 계정 역할 */
  role: string
  /** 해당 역할이 필요한 이유 */
  reason: string
  /** 권한 부족 시 발생하는 증상 */
  warning?: string
}

export interface OAuthRegistrationGuide {
  /** 등록 위치 (고객 관리 콘솔 / 프로젝트) */
  registrationLocation: string
  /** 콘솔 바로가기 링크 (입력된 테넌트 도메인 치환 가능) */
  consoleUrl?: string
  /** 바로가기 버튼 텍스트 */
  consoleActionLabel?: string
  /** 앱 등록 유형 및 필수 설정 요약 */
  registrationSummary: string
  /** 권장 연결 계정 역할 정보 */
  requiredRole?: RequiredAccountRole
  /** 앱 등록 → 설치 → 동의 단계별 안내 */
  steps: string[]
  /** 권한·역할·범위 한계 및 주의사항 */
  notes: string[]
  sources: Array<{ title: string; url: string }>
}

const OKTA_DOC = { title: 'Okta: Implement OAuth for Okta with a service app', url: 'https://developer.okta.com/docs/guides/implement-oauth-for-okta-serviceapp/main/' }
const OKTA_OIDC = { title: 'Okta: Implement OAuth for Okta (User / OIDC App)', url: 'https://developer.okta.com/docs/guides/implement-oauth-for-okta/main/' }
const OKTA_ROLES = { title: 'Okta: Administrator role comparison', url: 'https://help.okta.com/en-us/content/topics/security/administrators-admin-comparison.htm' }
const OKTA_APP_STEPS = [
  'Admin Console > Applications > Create App Integration 이동',
  'API Services 선택 후 앱 이름 입력 및 Save',
]

const GCP_KEYS = { title: 'Google Cloud: Create and delete service account keys', url: 'https://docs.cloud.google.com/iam/docs/keys-create-delete' }
const GWS_CREDS = { title: 'Google Workspace: Create access credentials', url: 'https://developers.google.com/workspace/guides/create-credentials' }
const GWS_DWD = { title: 'Google Workspace: Control API access with domain-wide delegation', url: 'https://knowledge.workspace.google.com/admin/apps/control-api-access-with-domain-wide-delegation' }

const GH_INSTALL = { title: 'GitHub: Installing your own GitHub App', url: 'https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app' }
const GH_AUTH = { title: 'GitHub: Authenticating as a GitHub App installation', url: 'https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation' }
const GH_KEYS = { title: 'GitHub: Managing private keys for GitHub Apps', url: 'https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps' }
const GH_PAT = { title: 'GitHub: Managing your personal access tokens', url: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens' }
const GH_APP_STEPS = [
  '오른쪽 위 프로필 사진 > Your organizations > 대상 조직의 Settings로 갑니다.',
  'Developer settings > GitHub Apps > New GitHub App을 누릅니다.',
  'Permissions에서 항목마다 Read-only 또는 No access를 고릅니다. 필요한 항목은 AEGI가 따로 안내합니다.',
]

const SLACK_TOKENS = { title: 'Slack: Using the Web API with Postman (토큰 받기)', url: 'https://docs.slack.dev/apis/web-api/using-web-api-with-postman' }
const SLACK_MANIFEST = { title: 'Slack: Configuring apps with app manifests', url: 'https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests/' }
const SLACK_ROTATE = { title: 'Slack: tooling.tokens.rotate', url: 'https://docs.slack.dev/reference/methods/tooling.tokens.rotate/' }
const SLACK_HISTORY = { title: 'Slack: conversations.history', url: 'https://docs.slack.dev/reference/methods/conversations.history/' }
const SLACK_APP_STEPS = [
  'api.slack.com/apps 에서 Create New App > From a manifest로 앱 생성',
  'Enterprise면 Org Level Apps에서 Install to Organization 승인 후 워크스페이스 추가',
  '일반 워크스페이스면 OAuth & Permissions에서 Install to Workspace 승인',
  'OAuth & Permissions의 토큰 복사',
]

const SF_ECA = { title: 'Salesforce: Create an External Client App', url: 'https://developer.salesforce.com/docs/ai/automate-resume-processing/guide/aes-create-external-client-app.html' }
const SF_KEYS = { title: 'Salesforce: Authorize an org using an External Client App', url: 'https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-auth-eca.html' }
const SF_PKCE = { title: 'Salesforce: OAuth 2.0 Web Server Flow with PKCE', url: 'https://help.salesforce.com/s/articleView?id=xcloud.remoteaccess_oauth_web_server_flow.htm&type=5' }
const SF_DOMAIN = { title: 'Salesforce: Retrieve your Salesforce domain URL', url: 'https://developer.salesforce.com/docs/ai/automate-resume-processing/guide/aes-retrieve-sf-domain-url.html' }
const SF_APP_STEPS = [
  'Setup의 Quick Find에 External Client App Manager를 입력하고 New External Client App을 누릅니다.',
  'Basic Information에 앱 등록 이름과 Contact Email을 넣습니다.',
  'API (Enable OAuth Settings)에서 Enable OAuth를 체크하고, OAuth Scopes에서 Manage user data via APIs (api)를 Selected로 옮깁니다.',
  'Flow Enablement에서 Enable client credentials flow를 체크하고 Create합니다.',
  '만든 앱 등록의 Policies 탭 > Edit에서 Enable Client Credentials Flow를 체크하고, Run As (Username)에 수집 전용 통합 사용자를 넣고 Save합니다.',
]

const ATL_TOKENS = { title: 'Atlassian: Manage API tokens for your Atlassian account', url: 'https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/' }
const ATL_BASIC = { title: 'Atlassian: Basic auth for REST APIs (Jira)', url: 'https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/' }

const SPLUNK_TOKENS = { title: 'Splunk: Create authentication tokens', url: 'https://docs.splunk.com/Documentation/Splunk/latest/Security/CreateAuthTokens' }
const SPLUNK_TOKEN_AUTH = { title: 'Splunk: Enable or disable token authentication', url: 'https://docs.splunk.com/Documentation/Splunk/latest/Security/EnableTokenAuth' }
const SPLUNK_ROLES = { title: 'Splunk: Create and manage roles with Splunk Web', url: 'https://docs.splunk.com/Documentation/Splunk/latest/Security/Addandeditroles' }
const SPLUNK_TLS_DOC = { title: 'Splunk: Introduction to securing the Splunk platform with TLS', url: 'https://docs.splunk.com/Documentation/Splunk/latest/Security/AboutsecuringyourSplunkconfigurationwithSSL' }
const SPLUNK_TLS_NOTE = '시험은 저장된 값으로 합니다. 고친 뒤 설정 저장을 누르고 연결 시험을 누릅니다.'

const CLAUDE_KEY = { title: 'Claude: Get your Claude API key', url: 'https://platform.claude.com/docs/en/get-api-key' }
const OPENAI_KEY = { title: 'OpenAI: API keys', url: 'https://developers.openai.com/api/docs/guides/api-keys' }
const GEMINI_KEY = { title: 'Gemini API: Using Gemini API keys', url: 'https://aistudio.google.com/docs/api-key' }
const AI_KEY_NOTES = [
  '키는 이 PC의 aegi-demo .env 에 AEGI_ASSISTANT_API_KEY 로 저장됩니다. 화면에는 저장 여부만 보입니다.',
  '연결 시험은 칸에 넣은 키로 시험하고, 칸이 비어 있으면 저장된 키로 시험합니다. 저장된 키가 다른 공급자의 키면 키를 넣어야 합니다.',
  '설정 저장을 눌러야 AI 질문에 쓰입니다.',
]

/** SaaS OAuth 지원 출처(Okta, Salesforce, Google Workspace, Slack, GitHub, Atlassian)의 앱 등록·설치, 동의 안내 */
export const OAUTH_REGISTRATION_GUIDES: Record<'okta' | 'salesforce' | 'gws' | 'slack' | 'github' | 'atlassian', OAuthRegistrationGuide> = {
  okta: {
    registrationLocation: 'Okta Admin Console',
    requiredRole: {
      role: 'Read-only Admin 이상 (Super Admin 권장)',
      reason: '사용자, 그룹, 앱, 역할 및 System Log 수집',
      warning: '일반 사용자 계정은 접근이 거부(403)됩니다.',
    },
    consoleUrl: '/admin/apps/active',
    consoleActionLabel: 'Okta 콘솔 열기',
    registrationSummary: 'OIDC Native App',
    steps: [
      'Applications > Create App Integration (OIDC / Native App 선택)',
      'Grant type (Authorization Code, Refresh Token) 체크 및 Redirect URI 등록',
      'Okta API Scopes 탭에서 필요한 okta.*.read 항목 Grant 및 관리자 계정 배정',
      'Client ID를 복사하여 아래에 입력 후 [계정 연결]',
    ],
    notes: [],
    sources: [OKTA_OIDC, OKTA_ROLES],
  },
  salesforce: {
    registrationLocation: 'Salesforce Setup',
    requiredRole: {
      role: 'System Administrator (시스템 관리자)',
      reason: '사용자 프로필, 권한 세트, 세션 정책, Connected App 목록 및 Setup 감사 이력을 SOQL로 조회하기 위해 필요합니다.',
      warning: 'View All Data 및 API Enabled 권한이 없는 프로필 계정은 데이터 조회가 차단됩니다.',
    },
    consoleUrl: '/lightning/setup/NavigationMenus/page?address=%2Flightning%2Fsetup%2FAppManager%2Fhome',
    consoleActionLabel: 'Salesforce 콘솔 열기',
    registrationSummary: 'Connected App (Web Server Flow + PKCE)',
    steps: [
      'Setup > App Manager > New Connected App에서 "Enable OAuth Settings"를 체크하고 Callback URL에 위 콜백 주소를 넣습니다.',
      'OAuth Scopes에 "api"와 "refresh_token, offline_access"를 추가하고 PKCE를 체크합니다.',
      '저장 후 Consumer Key를 복사해 아래에 입력합니다 (미설치 상태면 Connected Apps OAuth Usage에서 Install).',
    ],
    notes: [],
    sources: [SF_PKCE, SF_ECA],
  },
  gws: {
    registrationLocation: 'Google Cloud Console',
    requiredRole: {
      role: '최고 관리자 (Super Admin)',
      reason: '도메인 전체 디렉터리(사용자/그룹/역할) 및 Reports 감사 로그 조회를 위해 최고 관리자 권한이 필수입니다.',
      warning: '일반 관리자나 사용자 계정으로 로그인 시 Admin SDK 디렉터리 API 접근이 거부(403)됩니다.',
    },
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    consoleActionLabel: 'Google Cloud 콘솔 열기',
    registrationSummary: 'OAuth 2.0 Client ID (Internal 동의 화면)',
    steps: [
      'APIs & Services > Library에서 Admin SDK, Google Drive, Cloud Identity, Groups Settings API를 켭니다.',
      'OAuth consent screen을 "Internal(내부)"로 설정합니다.',
      'Credentials > Create OAuth client ID(Web application)에 위 콜백 주소를 등록하고 Client ID / Secret을 복사합니다.',
    ],
    notes: [
      '관리자 OAuth는 관리자 호출 15개를 수집합니다 (개인 Gmail, Calendar 등 9개 호출은 서비스 계정 DWD 필요).',
    ],
    sources: [GWS_CREDS, GWS_DWD],
  },
  slack: {
    registrationLocation: 'Slack API 콘솔',
    requiredRole: {
      role: 'Workspace Primary Owner / Admin (Enterprise는 Org Admin)',
      reason: '봇 설치, 사용자 목록, 채널 메타데이터, 앱 승인 목록 수집',
      warning: '비공개 채널 조사는 수집 봇(@aegi-collector) 초대가 필요합니다.',
    },
    consoleUrl: 'https://api.slack.com/apps',
    consoleActionLabel: 'Slack 콘솔 열기',
    registrationSummary: 'Slack App (OAuth v2)',
    steps: [
      'api.slack.com/apps 에서 Create New App 생성',
      'OAuth & Permissions > Redirect URLs에 콜백 주소 등록',
      'Basic Information의 Client ID, Client Secret을 아래에 입력 후 [계정 연결]',
    ],
    notes: [],
    sources: [SLACK_TOKENS],
  },
  github: {
    registrationLocation: 'GitHub Developer Settings',
    requiredRole: {
      role: 'Organization Owner (조직 소유자)',
      reason: '조직 내 전체 저장소, 브랜치 보호 규칙, 팀, 멤버 권한, Actions 설정 및 조직 감사 로그를 읽기 위해 필요합니다.',
      warning: '조직 Member 권한으로 연결 시 비공개 저장소와 조직 설정, 감사 로그 조회가 누락됩니다.',
    },
    consoleUrl: 'https://github.com/settings/developers',
    consoleActionLabel: 'GitHub 콘솔 열기',
    registrationSummary: 'GitHub OAuth App',
    steps: [
      'Developer settings > OAuth Apps > New OAuth App을 누릅니다.',
      'Authorization callback URL에 위 콜백 주소를 붙여 넣고 등록합니다.',
      'Client ID와 Client Secret을 생성하고 복사해 아래에 입력합니다.',
    ],
    notes: [],
    sources: [GH_PAT],
  },
  atlassian: {
    registrationLocation: 'Atlassian Developer Console',
    requiredRole: {
      role: 'Jira Administrator 및 Confluence Administrator (Site Admin)',
      reason: 'Jira 프로젝트 권한 스킴, 역할별 멤버 배정, Confluence 스페이스 권한 및 사이트 감사 기록 조회를 위해 필요합니다.',
      warning: '일반 멤버 계정으로 연결하면 본인이 접근 가능한 일부 프로젝트/스페이스만 부분 수집됩니다.',
    },
    consoleUrl: 'https://developer.atlassian.com/console/myapps/',
    consoleActionLabel: 'Atlassian 콘솔 열기',
    registrationSummary: 'OAuth 2.0 (3LO) 통합',
    steps: [
      'Create > OAuth 2.0 integration을 만들고 Permissions에서 Jira / Confluence 읽기 권한을 추가합니다.',
      'Authorization > Callback URL에 위 콜백 주소를 등록합니다.',
      'Settings에서 Client ID와 Secret을 복사해 아래에 입력합니다.',
    ],
    notes: [],
    sources: [ATL_TOKENS],
  },
}

export const CREDENTIAL_GUIDES: Record<string, CredentialGuide> = {
  OKTA_ORG_URL: {
    summary: 'Okta 조직 도메인 (예: https://example.okta.com)',
    steps: [],
    sources: [OKTA_DOC],
  },
  OKTA_API_TOKEN: {
    summary: 'Okta SSWS API 토큰 (Security > API > Tokens · 네트워크 존 지정 필요)',
    steps: [],
    sources: [OKTA_ROLES],
  },
  OKTA_COLLECTOR_CLIENT_ID: {
    summary: 'Okta 앱 등록 Client ID (General 탭)',
    steps: [],
    sources: [OKTA_DOC],
  },
  OKTA_COLLECTOR_CLIENT_SECRET: {
    summary: '선택: Web Application 앱의 Client Secret (PKCE 전용이면 생략)',
    steps: [],
    sources: [OKTA_OIDC],
  },
  OKTA_COLLECTOR_KEY_ID: {
    summary: 'API Services 앱 공개키 JWK의 kid 값',
    steps: [],
    sources: [OKTA_DOC],
  },
  OKTA_COLLECTOR_PRIVATE_KEY: {
    summary: 'API Services 앱 키 쌍의 개인키 (PEM/JWK)',
    steps: [],
    sources: [OKTA_DOC, OKTA_ROLES],
  },
  GWS_COLLECTOR_CLIENT_ID: {
    summary: 'Google Cloud OAuth 2.0 클라이언트 ID (.apps.googleusercontent.com)',
    steps: [],
    sources: [
      { title: 'Google Cloud Credentials 콘솔 ↗', url: 'https://console.cloud.google.com/apis/credentials' },
      GWS_CREDS,
    ],
  },
  GWS_COLLECTOR_CLIENT_SECRET: {
    summary: 'Google Cloud OAuth 2.0 Client Secret',
    steps: [],
    sources: [
      { title: 'Google Cloud Credentials 콘솔 ↗', url: 'https://console.cloud.google.com/apis/credentials' },
      GWS_CREDS,
    ],
  },
  GWS_ADMIN_SUBJECT: {
    summary: 'DWD 위임 대상 Google Workspace 최고 관리자 이메일',
    steps: [],
    sources: [
      { title: 'Google Admin 콘솔 ↗', url: 'https://admin.google.com/' },
      GWS_DWD,
    ],
  },
  GWS_COLLECTOR_SA_KEY: {
    summary: 'DWD용 GCP 서비스 계정 JSON 키 (상단 Cloud Shell 스크립트로 생성)',
    steps: [],
    sources: [GWS_CREDS, GCP_KEYS, GWS_DWD],
  },
  GITHUB_ENTERPRISE: {
    summary: '선택: GitHub Enterprise slug (github.com/enterprises/{slug})',
    steps: [],
    sources: [
      { title: 'GitHub Enterprises ↗', url: 'https://github.com/settings/enterprises' },
      { title: 'Enterprise 문서', url: 'https://docs.github.com/en/enterprise-cloud@latest/admin/overview/about-enterprise-accounts' },
    ],
  },
  GITHUB_APP_ID: {
    summary: '자체 GitHub App의 App ID(숫자)',
    steps: [],
    sources: [
      { title: 'GitHub Apps 설정 ↗', url: 'https://github.com/settings/apps' },
      GH_INSTALL,
    ],
  },
  GITHUB_APP_INSTALLATION_ID: {
    summary: '조직 설치 ID(숫자 · URL /installations/{id})',
    steps: [],
    sources: [GH_INSTALL, GH_AUTH],
  },
  GITHUB_APP_PRIVATE_KEY: {
    summary: 'GitHub App 개인키(.pem) — Manifest 생성 시 자동 저장',
    steps: [],
    sources: [
      { title: 'GitHub Apps 설정 ↗', url: 'https://github.com/settings/apps' },
      GH_KEYS,
    ],
  },
  GITHUB_OWNER_TOKEN: {
    summary: '선택: 조직 소유자 classic PAT (read:org, read:audit_log)',
    steps: [],
    sources: [
      { title: 'GitHub Classic PAT 발급 ↗', url: 'https://github.com/settings/tokens' },
      GH_PAT,
    ],
  },
  SLACK_COLLECTOR_BOT_TOKEN: {
    summary: 'Slack Bot User OAuth Token (xoxb-)',
    steps: [],
    sources: [
      { title: 'Slack Apps 콘솔 ↗', url: 'https://api.slack.com/apps' },
      SLACK_TOKENS,
    ],
  },
  SLACK_COLLECTOR_USER_TOKEN: {
    summary: 'Slack User OAuth Token (xoxp- · 관리자 권한 필요)',
    steps: [],
    sources: [
      { title: 'Slack Apps 콘솔 ↗', url: 'https://api.slack.com/apps' },
      SLACK_TOKENS,
    ],
  },
  SLACK_CONFIG_TOKEN: {
    summary: '선택: App Configuration Access Token (xoxe.xoxp-)',
    steps: [],
    sources: [
      { title: 'Slack Apps 콘솔 ↗', url: 'https://api.slack.com/apps' },
      SLACK_MANIFEST,
    ],
  },
  SLACK_CONFIG_REFRESH_TOKEN: {
    summary: '선택: App Configuration Refresh Token (xoxe-1-)',
    steps: [],
    sources: [
      { title: 'Slack Apps 콘솔 ↗', url: 'https://api.slack.com/apps' },
      SLACK_ROTATE,
    ],
  },
  SALESFORCE_INSTANCE_URL: {
    summary: 'My Domain 주소 (예: https://<회사>.my.salesforce.com)',
    steps: [],
    sources: [SF_DOMAIN],
  },
  SALESFORCE_COLLECTOR_CLIENT_ID: {
    summary: 'Connected App / External Client App Consumer Key',
    steps: [],
    sources: [SF_ECA, SF_KEYS],
  },
  SALESFORCE_COLLECTOR_CLIENT_SECRET: {
    summary: 'Connected App / External Client App Consumer Secret (PKCE 전용이면 생략)',
    steps: [],
    sources: [SF_KEYS],
  },
  ATLASSIAN_SITE_URL: {
    summary: 'Jira / Confluence 사이트 주소 (예: https://<사이트>.atlassian.net)',
    steps: [],
    sources: [ATL_BASIC],
  },
  ATLASSIAN_COLLECTOR_EMAIL: {
    summary: 'API 토큰 발급 계정의 Atlassian 이메일',
    steps: [],
    sources: [ATL_BASIC],
  },
  ATLASSIAN_COLLECTOR_API_TOKEN: {
    summary: 'Atlassian 일반 API 토큰 (Create API token · with scopes 제외)',
    steps: [],
    sources: [
      { title: 'Atlassian API 토큰 발급 ↗', url: 'https://id.atlassian.com/manage-profile/security/api-tokens' },
      ATL_TOKENS,
    ],
  },
  ATLASSIAN_ORG_ID: {
    summary: '선택: Atlassian 조직 ID (admin.atlassian.com/o/{orgId})',
    steps: [],
    sources: [
      { title: 'Atlassian Admin 콘솔 ↗', url: 'https://admin.atlassian.com/' },
      ATL_BASIC,
    ],
  },
  ATLASSIAN_ORG_AUDIT_API_KEY: {
    summary: 'Atlassian Guard 조직 API 키 (Settings > API keys · 읽기 7개 범위)',
    steps: [],
    sources: [
      { title: 'Atlassian Admin 콘솔 ↗', url: 'https://admin.atlassian.com/' },
      ATL_TOKENS,
    ],
  },
  ONEPASSWORD_SERVICE_ACCOUNT_TOKEN: {
    summary: '1Password 서비스 계정 토큰 (ops_... · Developer > Directory > Service Accounts)',
    steps: [],
    sources: [
      { title: '1Password 서비스 계정 콘솔 ↗', url: 'https://my.1password.com/developer-tools/infrastructure-secrets/serviceaccount' },
      { title: 'Service Accounts 문서', url: 'https://developer.1password.com/docs/service-accounts/get-started/' },
    ],
  },
  ONEPASSWORD_EVENTS_TOKEN: {
    summary: '1Password Events Reporting 토큰 (Integrations > Events Reporting)',
    steps: [],
    sources: [
      { title: '1Password Events Reporting 콘솔 ↗', url: 'https://my.1password.com/integrations/events-reporting' },
      { title: 'Events API 문서', url: 'https://developer.1password.com/docs/events-api/' },
    ],
  },
  M365_TENANT_ID: {
    summary: 'Microsoft Entra ID 테넌트 ID (GUID)',
    steps: [],
    sources: [{ title: 'Microsoft Entra 관리 센터 ↗', url: 'https://entra.microsoft.com/' }],
  },
  M365_CLIENT_ID: {
    summary: 'Entra 앱 등록 Application (Client) ID (Graph 애플리케이션 권한 20종 + 관리자 동의)',
    steps: [],
    sources: [{ title: 'Entra 앱 등록 콘솔 ↗', url: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' }],
  },
  M365_CLIENT_SECRET: {
    summary: 'Entra 앱 등록 클라이언트 암호 값 (Value)',
    steps: [],
    sources: [{ title: 'Entra 앱 등록 콘솔 ↗', url: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' }],
  },
  AWS_ACCESS_KEY_ID: {
    summary: '수집 전용 IAM 사용자 Access Key ID (최소 읽기 17개 액션 또는 ReadOnlyAccess)',
    steps: [],
    sources: [
      { title: 'AWS IAM 사용자 콘솔 ↗', url: 'https://console.aws.amazon.com/iam/home#/users' },
      { title: 'AWS 액세스 키 문서', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html' },
    ],
  },
  AWS_SECRET_ACCESS_KEY: {
    summary: '수집 전용 IAM 사용자 Secret Access Key',
    steps: [],
    sources: [{ title: 'AWS IAM 사용자 콘솔 ↗', url: 'https://console.aws.amazon.com/iam/home#/users' }],
  },
  GCP_COLLECTOR_CLIENT_ID: {
    summary: 'GCP OAuth 2.0 데스크톱 클라이언트 ID (cloud-platform 범위)',
    steps: [],
    sources: [{ title: 'Google Cloud Credentials 콘솔 ↗', url: 'https://console.cloud.google.com/apis/credentials' }],
  },
  GCP_COLLECTOR_REFRESH_TOKEN: {
    summary: 'GCP OAuth Refresh Token (1//...)',
    steps: [],
    sources: [{ title: 'Google Cloud Credentials 콘솔 ↗', url: 'https://console.cloud.google.com/apis/credentials' }],
  },
  GCP_PROJECTS: {
    summary: '선택: 수집 대상 GCP 프로젝트 ID (쉼표 구분 · 비우면 자동 탐색)',
    steps: [],
    sources: [],
  },
  SNOWFLAKE_ACCOUNT: {
    summary: 'Snowflake Account Identifier (<조직명>-<계정명>)',
    steps: [],
    sources: [{ title: 'Snowsight 콘솔 ↗', url: 'https://app.snowflake.com/' }],
  },
  SNOWFLAKE_COLLECTOR_USER: {
    summary: 'Snowflake 수집 전용 서비스 사용자 (TYPE = SERVICE · ACCOUNT_USAGE 읽기 권한)',
    steps: [],
    sources: [
      { title: 'Snowsight 콘솔 ↗', url: 'https://app.snowflake.com/' },
      { title: 'Snowflake Key-Pair 인증 문서', url: 'https://docs.snowflake.com/en/user-guide/key-pair-auth' },
    ],
  },
  SNOWFLAKE_COLLECTOR_PRIVATE_KEY: {
    summary: 'Snowflake 서비스 사용자 RSA 개인키 (PEM)',
    steps: [],
    sources: [{ title: 'Snowflake Key-Pair 인증 문서', url: 'https://docs.snowflake.com/en/user-guide/key-pair-auth' }],
  },
  SNOWFLAKE_HOST: {
    summary: '선택: 커스텀 호스트 (PrivateLink 사용 시에만 입력)',
    steps: [],
    sources: [],
  },
  ATLASSIAN_COLLECTOR_ORG_API_KEY: {
    summary: 'Atlassian 조직 관리 API 키 (Settings > API keys)',
    steps: [],
    sources: [
      { title: 'Atlassian Admin 콘솔 ↗', url: 'https://admin.atlassian.com/' },
      ATL_TOKENS,
    ],
  },
  SPLUNK_URL: {
    summary: 'Splunk 관리 포트(검색 REST) 주소입니다. 예: https://splunk.example.com:8089',
    steps: [
      'Splunk 관리 포트 주소 앞에 https:// 를 붙여 넣습니다. 관리 포트는 보통 8089입니다.',
      '웹 화면 주소(보통 8000 포트)가 아닙니다.',
    ],
    notes: [
      'https 주소만 받습니다. 주소에 계정 이름이나 비밀번호를 넣지 않습니다.',
      'AEGI는 검색 작업(/services/search/jobs)만 부릅니다. HEC 전송은 쓰지 않습니다.',
      SPLUNK_TLS_NOTE,
    ],
    sources: [SPLUNK_TOKENS],
  },
  SPLUNK_TOKEN: {
    summary: 'Splunk 인증 토큰입니다. 감사 로그 index를 읽을 수 있는 검색 전용 계정으로 만듭니다.',
    steps: [
      'Splunk Web에 관리자 계정으로 로그인하고 Settings > Tokens로 갑니다.',
      'Token authentication is currently disabled가 보이면 Enable Token Authentication을 누릅니다.',
      'New Token을 누르고 User에 검색 전용 계정, Audience에 용도(예: aegi-demo)를 넣습니다. Expiration은 골라도 됩니다.',
      'Create를 누르고 Token 칸의 값을 전부 복사해 붙여 넣습니다.',
    ],
    notes: [
      '토큰 값은 New Token 창을 닫으면 다시 볼 수 없습니다.',
      '토큰은 그 계정의 역할 권한으로 동작합니다. Settings > Roles에서 역할의 Capabilities 탭에 search가 있고, Indexes 탭에 감사 로그 index가 골라져 있어야 합니다.',
      '토큰 인증을 켜려면 edit_tokens_settings, 자기 토큰을 만들려면 edit_tokens_own capability가 필요합니다.',
      SPLUNK_TLS_NOTE,
    ],
    sources: [SPLUNK_TOKENS, SPLUNK_TOKEN_AUTH, SPLUNK_ROLES],
  },
  /** 데모 Splunk 카드의 인증서 확인 방법 */
  SPLUNK_TLS: {
    summary: 'Splunk 관리 포트 HTTPS 인증서를 어떻게 확인할지입니다.',
    steps: [
      '시스템 신뢰 저장소: 공인 CA나 OS 신뢰 저장소에 설치된 인증서면 바로 연결됩니다.',
      '지문 직접 입력: 자체 서명 인증서일 때 인증서 SHA-256 지문(64자리)을 붙여 넣습니다.',
      'CA 파일 지정: 사내 사설 CA 인증서(PEM) 파일 경로를 넣습니다.',
    ],
    notes: [
      'HTTPS 검증을 끄지 않고 지문이나 CA로 안전하게 확인합니다.',
      SPLUNK_TLS_NOTE,
    ],
    sources: [SPLUNK_TLS_DOC],
  },
  SPLUNK_TLS_SHA256: {
    summary: 'Splunk 관리 포트 서버 인증서의 SHA-256 지문입니다. 자체 서명 인증서일 때 씁니다.',
    steps: ['Splunk 관리자에게 관리 포트 인증서의 SHA-256 지문을 받아 붙여 넣습니다.'],
    notes: ['인증서를 바꾸면 지문도 바뀝니다. 새 지문을 넣고 다시 저장합니다.'],
    sources: [SPLUNK_TLS_DOC],
  },
  SPLUNK_CA_FILE: {
    summary: 'Splunk 인증서를 발급한 사내 CA 인증서(PEM) 파일 경로입니다.',
    steps: ['CA 인증서 파일을 이 PC에 두고 경로를 넣습니다.'],
    notes: ['상대 경로는 aegi-demo .env 가 있는 폴더 기준입니다.'],
    sources: [SPLUNK_TLS_DOC],
  },
  SPLUNK_SOURCES_FILE: {
    summary: '어느 index, sourcetype이 어느 SaaS 감사 로그인지 적는 출처 설정 파일입니다. 기본은 .env 옆 splunk.sources.json 입니다.',
    steps: [
      '출처 설정 복사를 누르면 splunk.sources.example.json 을 splunk.sources.json 으로 복사합니다. 이미 있으면 덮어쓰지 않습니다.',
      'splunk.sources.json 을 열어 출처마다 index, sourcetype을 회사 Splunk 값으로 바꿉니다.',
      '연결 시험을 누르면 출처마다 최근 7일 이벤트 수와 마지막 시각이 보입니다.',
    ],
    notes: [
      'URL과 토큰이 저장돼 있으면 연결 시험도 파일이 없을 때 예시 파일을 복사합니다.',
      'tenant 필드로 거르는 출처는 index 전체 이벤트 수가 보입니다.',
    ],
    sources: [],
  },
  /** 데모 AI 카드의 공급자 선택 */
  AEGI_ASSISTANT_PROVIDER: {
    summary: 'AI 질문에 쓸 AI 회사입니다.',
    steps: [
      '공급자를 고르고 그 공급자의 API 키를 넣습니다.',
      '설정 저장을 누르면 공급자와 키가 함께 저장됩니다.',
    ],
    notes: [
      'AI 질문 때 질문, 이전 대화, 지금 화면과 고른 대상, AI가 읽은 그래프와 로그 결과가 이 PC에서 고른 공급자 API로 전송됩니다.',
      '공급자를 바꾸면 모델과 추론 강도 칸이 비워지고, 그 공급자의 기본값을 씁니다.',
    ],
    sources: [CLAUDE_KEY, OPENAI_KEY, GEMINI_KEY],
  },
  ANTHROPIC_API_KEY: {
    summary: 'Claude API 키입니다. sk-ant- 로 시작합니다.',
    steps: [
      'https://platform.claude.com/settings/keys 에 로그인합니다.',
      'Create key를 누르고 이름, 만료, Linked account를 고릅니다. workspace도 고릅니다.',
      '한 번만 보이는 키를 복사해 붙여 넣습니다.',
    ],
    notes: [
      'AEGI는 anthropic-workspace-id 헤더를 보내지 않습니다. workspace를 고른 키를 씁니다.',
      ...AI_KEY_NOTES,
    ],
    sources: [CLAUDE_KEY],
  },
  OPENAI_API_KEY: {
    summary: 'OpenAI API 키입니다.',
    steps: [
      'https://platform.openai.com/api-keys 에 로그인합니다.',
      '새 키를 만들고 한 번만 보이는 값을 복사해 붙여 넣습니다.',
    ],
    notes: AI_KEY_NOTES,
    sources: [OPENAI_KEY],
  },
  GEMINI_API_KEY: {
    summary: 'Gemini API 키입니다. Google AI Studio에서 만듭니다.',
    steps: [
      'https://aistudio.google.com/apikey 에 로그인합니다.',
      'Create API key를 누르고 만든 키를 복사해 붙여 넣습니다.',
    ],
    notes: [
      'Gemini API는 제한 없는 일반 키를 거부합니다. AI Studio에서 새로 만든 키를 씁니다.',
      ...AI_KEY_NOTES,
    ],
    sources: [GEMINI_KEY],
  },
  AEGI_ASSISTANT_MODEL: {
    summary: '쓸 모델 이름입니다. 비우면 공급자 기본 모델을 씁니다.',
    steps: [
      '모델 목록 불러오기를 누르면 칸에 넣은 키(비어 있으면 저장된 키)로 공급자의 모델 목록을 받아 칸의 선택지로 보여 줍니다.',
      '목록에서 고르거나 모델 이름을 직접 넣습니다.',
      '연결 시험으로 그 모델이 답하는지 봅니다. 성공하면 실제로 답한 모델 이름과 걸린 시간이 보입니다.',
    ],
    notes: [
      '기본 모델: Claude claude-sonnet-5-5, OpenAI gpt-5.5, Gemini gemini-3.6-flash',
      '설정 저장을 누르면 칸 값을 그대로 저장합니다. 칸을 비우고 저장하면 기본 모델로 돌아갑니다.',
    ],
    sources: [CLAUDE_KEY, OPENAI_KEY, GEMINI_KEY],
  },
  AEGI_ASSISTANT_REASONING_EFFORT: {
    summary: '모델이 답하기 전에 얼마나 오래 추론할지입니다. 고를 수 있는 값은 공급자와 모델에 따라 다릅니다.',
    steps: [
      '자동이면 괄호 안의 값을 씁니다.',
      '추론 강도를 받지 않는 모델이면 칸이 꺼집니다.',
    ],
    notes: ['설정 저장을 누르면 칸 값을 그대로 저장합니다. 자동으로 두고 저장하면 저장된 값이 지워집니다.'],
    sources: [CLAUDE_KEY, OPENAI_KEY, GEMINI_KEY],
  },
}

export const PROVIDER_REQUIRED_ACCOUNTS: Record<string, RequiredAccountRole> = {
  okta: {
    role: 'Read-only Admin 이상 (권장: 전용 서비스 계정)',
    reason: '100% 읽기 전용 · 사용자·그룹·앱·정책·System Log 조회',
    warning: 'OAuth 스코프(24개) Grant는 Super Admin 필요',
  },
  github: {
    role: 'Organization Owner (Enterprise 감사로그는 Enterprise Owner)',
    reason: '100% 읽기 전용 · 저장소·팀·Actions·감사 로그 조회',
    warning: 'SAML SSO 조직은 PAT 발급 후 Configure SSO > Authorize 필수',
  },
  slack: {
    role: 'Workspace Admin/Owner (Enterprise Grid는 Org Admin)',
    reason: '100% 읽기 전용 · 사용자·채널·앱·감사 로그 조회',
    warning: 'Enterprise Grid Org 앱은 대상 워크스페이스에도 앱 추가(Add to more workspaces) 필요',
  },
  gws: {
    role: 'Super Admin (최고 관리자)',
    reason: '100% 읽기 전용 · Admin SDK 디렉터리·Reports·DWD 위임 조회',
  },
  atlassian: {
    role: 'Jira · Confluence Admin (Guard 감사는 Org Admin)',
    reason: '100% 읽기 전용 · 프로젝트·권한 스킴·스페이스·감사 로그 조회',
  },
  salesforce: {
    role: 'System Admin 또는 API Only (View All Data · View Health Check)',
    reason: '100% 읽기 전용 · SOQL/Tooling 메타데이터 조회만 수행하며 절대 쓰지 않음',
    warning: '앱 설정 변경 후 활성화까지 1~2분 걸릴 수 있음',
  },
  snowflake: {
    role: 'ACCOUNTADMIN 또는 SECURITYADMIN (서비스 사용자 생성 및 ACCOUNT_USAGE 읽기 권한 부여)',
    reason: '100% 읽기 전용 · TYPE=SERVICE 계정과 RSA Key-Pair JWT로 계정·사용자·역할·권한·접근 기록 조회',
    warning: '현재 엔진 Snowflake 수집기 머지 대기 중 (입력·키 형식 검증은 미리 가능)',
  },
};
