import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleHelp, Eye, EyeOff, FileText, ShieldCheck, Upload } from 'lucide-react'
import { CREDENTIAL_GUIDES, OAUTH_REGISTRATION_GUIDES, PROVIDER_REQUIRED_ACCOUNTS } from './credentialGuides'

const ENABLED = import.meta.env.VITE_AEGI_COLLECTOR_STATUS !== 'off'
const ENDPOINT = '/__aegi/local-token'
const TEST_ENDPOINT = '/__aegi/local-token-test'
const OAUTH_START_ENDPOINT = '/__aegi/oauth/start'
const COLLECT_ENDPOINT = '/__aegi/collect'
const COLLECT_STATUS_ENDPOINT = '/__aegi/collect-status'

interface FieldSpec {
  env: string
  label: string
  placeholder: string
  secret?: boolean
  multiline?: boolean
  optional?: boolean
}

interface GroupSpec {
  id: string
  label: string
  fields: FieldSpec[]
}

interface OAuthScopeSpec {
  scope: string
  label: string
  defaultChecked?: boolean
}

interface OAuthSpec {
  urlEnv?: string
  urlLabel?: string
  urlPlaceholder?: string
  urlOptional?: boolean
  clientIdEnv: string
  clientIdLabel: string
  clientIdPlaceholder: string
  clientSecretEnv: string
  clientSecretLabel: string
  clientSecretOptional?: boolean
  refreshTokenEnv: string
  scopes: OAuthScopeSpec[]
}

function oktaAdminUrl(orgUrl: string, path: string): string {
  const trimmed = orgUrl.trim().replace(/\/+$/, '')
  try {
    const u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    if (u.hostname.endsWith('.okta.com') && !u.hostname.endsWith('-admin.okta.com')) {
      u.hostname = u.hostname.replace(/\.okta\.com$/, '-admin.okta.com')
    } else if (u.hostname.endsWith('.oktapreview.com') && !u.hostname.endsWith('-admin.oktapreview.com')) {
      u.hostname = u.hostname.replace(/\.oktapreview\.com$/, '-admin.oktapreview.com')
    } else if (u.hostname.endsWith('.okta-emea.com') && !u.hostname.endsWith('-admin.okta-emea.com')) {
      u.hostname = u.hostname.replace(/\.okta-emea\.com$/, '-admin.okta-emea.com')
    }
    return `${u.origin}${path.startsWith('/') ? path : `/${path}`}`
  } catch {
    return `${trimmed}${path.startsWith('/') ? path : `/${path}`}`
  }
}

const OAUTH_SPECS: Record<'okta' | 'salesforce' | 'gws' | 'slack' | 'github' | 'atlassian' | 'gcp', OAuthSpec> = {
  okta: {
    urlEnv: 'OKTA_ORG_URL',
    urlLabel: 'Okta 조직 주소 (Org URL)',
    urlPlaceholder: 'https://<company>.okta.com',
    clientIdEnv: 'OKTA_COLLECTOR_CLIENT_ID',
    clientIdLabel: '앱 등록 Client ID (OIDC Native Application)',
    clientIdPlaceholder: '0oa...',
    clientSecretEnv: 'OKTA_COLLECTOR_CLIENT_SECRET',
    clientSecretLabel: 'Client Secret (선택 — Native PKCE 앱 등록은 비워 둠)',
    clientSecretOptional: true,
    refreshTokenEnv: 'OKTA_COLLECTOR_REFRESH_TOKEN',
    scopes: [
      { scope: 'okta.orgs.read', label: '조직 기본 설정 조회 (OK-01)', defaultChecked: true },
      { scope: 'okta.users.read', label: '사용자, 인증 수단, 위임 토큰 조회 (OK-02, 04, 09)', defaultChecked: true },
      { scope: 'okta.groups.read', label: '그룹, 멤버, 그룹 규칙 조회 (OK-03, 11, 13)', defaultChecked: true },
      { scope: 'okta.roles.read', label: '관리자 역할, 리소스 세트, 배정 조회 (OK-05, 06)', defaultChecked: true },
      { scope: 'okta.apps.read', label: '앱, 앱 사용자, 그룹 배정 조회 (OK-07, 08, 13)', defaultChecked: true },
      { scope: 'okta.clients.read', label: 'OAuth 클라이언트, 공개 키 조회 (OK-08)', defaultChecked: true },
      { scope: 'okta.policies.read', label: '인증, 사인온 정책 규칙 조회 (OK-10)', defaultChecked: true },
      { scope: 'okta.logs.read', label: 'System Log 감사 로그 조회 (OK-12)', defaultChecked: true },
      { scope: 'okta.schemas.read', label: '사용자 프로필 스키마 조회 (OK-14)', defaultChecked: true },
      { scope: 'okta.oauthIntegrations.read', label: 'API 서비스 통합 인스턴스 조회 (OK-15)', defaultChecked: true },
      { scope: 'okta.apiTokens.read', label: 'API 토큰 메타데이터 조회 (OK-16)', defaultChecked: true },
      { scope: 'okta.eventHooks.read', label: '이벤트 훅 조회 (OK-17)', defaultChecked: true },
      { scope: 'okta.inlineHooks.read', label: '인라인 훅 조회 (OK-17)', defaultChecked: true },
      { scope: 'okta.logStreams.read', label: '로그 스트림 조회 (OK-17)', defaultChecked: true },
      { scope: 'okta.idps.read', label: '외부 IdP, 서명 키 조회 (OK-18, 20)', defaultChecked: true },
      { scope: 'okta.profileMappings.read', label: '프로필 매핑 식 조회 (OK-19)', defaultChecked: true },
      { scope: 'okta.authenticators.read', label: '인증기 설정 조회 (OK-22)', defaultChecked: true },
      { scope: 'okta.trustedOrigins.read', label: '신뢰 출처 조회 (OK-22)', defaultChecked: true },
      { scope: 'okta.deviceAssurance.read', label: '기기 보증 정책 조회 (OK-22)', defaultChecked: true },
      { scope: 'okta.networkZones.read', label: '네트워크 영역 조회 (OK-22)', defaultChecked: true },
      { scope: 'okta.agentPools.read', label: '에이전트 풀 조회 (OK-23)', defaultChecked: true },
      { scope: 'okta.securityEventsProviders.read', label: '보안 이벤트(SSF) 제공자 조회 (OK-21)', defaultChecked: true },
      { scope: 'ssf.read', label: 'Shared Signals Framework(SSF) 스트림 조회 (OK-21)', defaultChecked: true },
      { scope: 'okta.emailServers.read', label: '이메일 서버 설정 조회 (OK-21)', defaultChecked: true },
      { scope: 'okta.accessRequests.request.read', label: '접근 요청(Access Requests) 조회', defaultChecked: true },
      { scope: 'okta.aiAgents.read', label: 'AI 에이전트 조회', defaultChecked: true },
      { scope: 'okta.appGrants.read', label: '앱 OAuth Grant 조회', defaultChecked: true },
      { scope: 'okta.authorizationServers.read', label: '인증 서버(Authorization Servers) 조회', defaultChecked: true },
      { scope: 'okta.behaviors.read', label: '행위 탐지(Behavior Detection) 규칙 조회', defaultChecked: true },
      { scope: 'okta.brands.read', label: '브랜드·커스텀 테마 조회', defaultChecked: true },
      { scope: 'okta.captchas.read', label: 'CAPTCHA 설정 조회', defaultChecked: true },
      { scope: 'okta.customTelephonyProvider.read', label: '커스텀 텔레포니 제공자 조회', defaultChecked: true },
      { scope: 'okta.deviceIntegrations.read', label: '기기 통합(EDR/MDM) 설정 조회', defaultChecked: true },
      { scope: 'okta.devicePostureChecks.read', label: '기기 상태 점검(Posture Checks) 조회', defaultChecked: true },
      { scope: 'okta.devices.read', label: '등록 기기(Devices) 목록 조회', defaultChecked: true },
      { scope: 'okta.domains.read', label: '커스텀 도메인 조회', defaultChecked: true },
      { scope: 'okta.emailDomains.read', label: '이메일 도메인 조회', defaultChecked: true },
      { scope: 'okta.governance.accessCertifications.read', label: '거버넌스 접근 인증(Access Certifications) 조회', defaultChecked: true },
      { scope: 'okta.governance.accessRequests.read', label: '거버넌스 접근 요청 조회', defaultChecked: true },
      { scope: 'okta.governance.admin.read', label: '거버넌스 관리자 설정 조회', defaultChecked: true },
      { scope: 'okta.governance.labels.read', label: '거버넌스 라벨 조회', defaultChecked: true },
      { scope: 'okta.governance.riskRule.read', label: '거버넌스 위험 규칙 조회', defaultChecked: true },
      { scope: 'okta.linkedObjects.read', label: '연결 객체(Linked Objects) 정의 조회', defaultChecked: true },
      { scope: 'okta.principalRateLimits.read', label: '주체별 요청 한도(Principal Rate Limits) 조회', defaultChecked: true },
      { scope: 'okta.pushProviders.read', label: '푸시 제공자(Push Providers) 조회', defaultChecked: true },
      { scope: 'okta.rateLimits.read', label: '조직 요청 한도(Rate Limits) 설정 조회', defaultChecked: true },
      { scope: 'okta.realmAssignments.read', label: '영역 배정(Realm Assignments) 조회', defaultChecked: true },
      { scope: 'okta.realms.read', label: '영역(Realms) 목록 조회', defaultChecked: true },
      { scope: 'okta.resourceServers.apiServers.read', label: '리소스 서버(API Servers) 조회', defaultChecked: true },
      { scope: 'okta.resourceServers.clientAuthSettings.read', label: '리소스 서버 클라이언트 인증 설정 조회', defaultChecked: true },
      { scope: 'okta.resourceServers.mcpServers.read', label: '리소스 서버(MCP Servers) 조회', defaultChecked: true },
      { scope: 'okta.resourceServers.read', label: '리소스 서버 목록 조회', defaultChecked: true },
      { scope: 'okta.resourceServers.virtualMcpServers.read', label: '가상 MCP 서버 조회', defaultChecked: true },
      { scope: 'okta.serviceAccounts.okta.read', label: 'Okta 서비스 계정 조회', defaultChecked: true },
      { scope: 'okta.serviceAccounts.read', label: '서비스 계정 목록 조회', defaultChecked: true },
      { scope: 'okta.templates.read', label: '알림·SMS 템플릿 조회', defaultChecked: true },
      { scope: 'okta.threatInsights.read', label: 'ThreatInsight 설정 조회', defaultChecked: true },
      { scope: 'okta.uischemas.read', label: 'UI 스키마 조회', defaultChecked: true },
      { scope: 'okta.userTypes.read', label: '사용자 유형(User Types) 조회', defaultChecked: true },
    ],
  },
  salesforce: {
    urlEnv: 'SALESFORCE_INSTANCE_URL',
    urlLabel: 'My Domain 주소 (Instance URL)',
    urlPlaceholder: 'https://<company>.my.salesforce.com',
    urlOptional: true,
    clientIdEnv: 'SALESFORCE_COLLECTOR_CLIENT_ID',
    clientIdLabel: '앱 등록 Consumer Key (Client ID)',
    clientIdPlaceholder: '3MVG9...',
    clientSecretEnv: 'SALESFORCE_COLLECTOR_CLIENT_SECRET',
    clientSecretLabel: 'Consumer Secret (선택 — Require Secret 해제 시 비워 둠)',
    clientSecretOptional: true,
    refreshTokenEnv: 'SALESFORCE_COLLECTOR_REFRESH_TOKEN',
    scopes: [
      { scope: 'api', label: 'REST / Tooling API SOQL 읽기 조회 (SF-01~10, SFS-01, SF-90)', defaultChecked: true },
      { scope: 'refresh_token', label: '오프라인 갱신 토큰 발급 (refresh_token)', defaultChecked: true },
    ],
  },
  gws: {
    clientIdEnv: 'GWS_COLLECTOR_CLIENT_ID',
    clientIdLabel: 'Google Cloud OAuth 2.0 Client ID',
    clientIdPlaceholder: '1234567890-abc.apps.googleusercontent.com',
    clientSecretEnv: 'GWS_COLLECTOR_CLIENT_SECRET',
    clientSecretLabel: 'Client Secret (필수 — Google Desktop OAuth 토큰 교환에 필요)',
    clientSecretOptional: false,
    refreshTokenEnv: 'GWS_COLLECTOR_REFRESH_TOKEN',
    scopes: [
      { scope: 'https://www.googleapis.com/auth/admin.directory.customer.readonly', label: '고객(Customer) 정보 조회 (GW-01)', defaultChecked: true },
      { scope: 'https://www.googleapis.com/auth/admin.directory.domain.readonly', label: '도메인 목록 조회 (GW-02)', defaultChecked: true },
      { scope: 'https://www.googleapis.com/auth/admin.directory.user.readonly', label: '사용자 디렉터리 조회 (GW-03)', defaultChecked: true },
      { scope: 'https://www.googleapis.com/auth/admin.directory.group.readonly', label: '그룹 목록 조회 (GW-04)', defaultChecked: true },
      { scope: 'https://www.googleapis.com/auth/admin.directory.group.member.readonly', label: '그룹 멤버 조회 (GW-04)', defaultChecked: true },
      { scope: 'https://www.googleapis.com/auth/admin.directory.user.security', label: '사용자 승인 서드파티 토큰, 앱 비밀번호 조회 (GW-05, 18)', defaultChecked: true },
      { scope: 'https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly', label: '관리자 역할, 배정 조회 (GW-06)', defaultChecked: true },
      { scope: 'https://www.googleapis.com/auth/admin.reports.audit.readonly', label: 'Reports 감사 로그 조회 (GW-10, 14)', defaultChecked: true },
      { scope: 'https://www.googleapis.com/auth/cloud-identity.inboundsso.readonly', label: '인바운드 SAML/OIDC SSO 프로필, 배정 조회 (GW-17)', defaultChecked: true },
      { scope: 'https://www.googleapis.com/auth/drive.readonly', label: '공유 드라이브 목록 조회 (GW-19)', defaultChecked: true },
      { scope: 'https://www.googleapis.com/auth/drive.metadata.readonly', label: '공유 드라이브 권한 메타데이터 조회 (GW-19)', defaultChecked: true },
      { scope: 'https://www.googleapis.com/auth/admin.directory.orgunit.readonly', label: '조직 단위(OrgUnit) 조회 (GW-20)', defaultChecked: true },
      { scope: 'https://www.googleapis.com/auth/apps.groups.settings', label: '그룹 외부 공유, 접근 설정 조회 (GW-21)', defaultChecked: true },
      { scope: 'https://www.googleapis.com/auth/cloud-identity.allowlisteddomains.readonly', label: '외부 공유 허용 도메인 조회 (GW-23)', defaultChecked: true },
      { scope: 'https://www.googleapis.com/auth/cloud-identity.policies.readonly', label: 'Cloud Identity 관리 정책 조회 (GW-24)', defaultChecked: true },
    ],
  },
  slack: {
    urlEnv: 'SLACK_TEAM_ID',
    urlLabel: 'Slack 워크스페이스 Team ID (선택 — 비워두면 동의 화면에서 선택)',
    urlPlaceholder: '비워두면 동의 창에서 워크스페이스 선택 (예: T0123456789)',
    urlOptional: true,
    clientIdEnv: 'SLACK_CLIENT_ID',
    clientIdLabel: 'Slack 앱 등록 Client ID',
    clientIdPlaceholder: '1234567890.1234567890',
    clientSecretEnv: 'SLACK_CLIENT_SECRET',
    clientSecretLabel: 'Slack 앱 등록 Client Secret (필수)',
    clientSecretOptional: false,
    refreshTokenEnv: 'SLACK_COLLECTOR_USER_TOKEN',
    scopes: [
      { scope: 'bot:users:read', label: '[Bot] 워크스페이스 사용자, 봇 목록 조회 (SL-02, 07)', defaultChecked: true },
      { scope: 'bot:channels:read', label: '[Bot] 공개 채널 목록, 멤버 조회 (SL-03, 04)', defaultChecked: true },
      { scope: 'bot:groups:read', label: '[Bot] 비공개 채널 목록, 멤버 조회 (SL-03, 04)', defaultChecked: true },
      { scope: 'bot:channels:history', label: '[Bot] 공개 채널 메시지, 봇 활동 지문 조회 (SL-05)', defaultChecked: true },
      { scope: 'bot:groups:history', label: '[Bot] 비공개 채널 메시지, 봇 활동 지문 조회 (SL-05)', defaultChecked: true },
      { scope: 'bot:team:read', label: '[Bot] 워크스페이스 기본 정보 조회 (SL-00)', defaultChecked: true },
      { scope: 'bot:usergroups:read', label: '[Bot] 사용자 그룹 및 멤버 조회 (SL-06, 15)', defaultChecked: true },
      { scope: 'bot:conversations.connect:manage', label: '[Bot] Slack Connect 외부 팀·초대 조회 (선택)', defaultChecked: false },
      { scope: 'users:read', label: '[User] 사용자 프로필, 권한 조회 (SL-01, 02)', defaultChecked: true },
      { scope: 'users.profile:read', label: '[User] 사용자 프로필 상세 조회 (users.profile.get)', defaultChecked: true },
      { scope: 'channels:read', label: '[User] 공개 채널 조회 (SL-03)', defaultChecked: true },
      { scope: 'groups:read', label: '[User] 비공개 채널 조회 (SL-03)', defaultChecked: true },
      { scope: 'usergroups:read', label: '[User] 사용자 그룹 조회 (SL-06)', defaultChecked: true },
      { scope: 'team:read', label: '[User] 팀 정보 조회 (SL-00)', defaultChecked: true },
      { scope: 'admin', label: '[Enterprise Grid] 조직 통합 관리 및 연동 로그 조회 (SL-01, 08, 09)', defaultChecked: true },
      { scope: 'admin.users:read', label: '[Enterprise Grid] 조직 사용자 관리 조회 (SL-01)', defaultChecked: true },
      { scope: 'admin.conversations:read', label: '[Enterprise Grid] 조직 전체 채널 검색 (SL-03)', defaultChecked: true },
      { scope: 'admin.teams:read', label: '[Enterprise Grid] 조직 워크스페이스 목록 조회 (SL-00)', defaultChecked: true },
      { scope: 'admin.usergroups:read', label: '[Enterprise Grid] IdP 사용자 그룹 조회 (SL-06, 13)', defaultChecked: true },
      { scope: 'admin.apps:read', label: '[Enterprise Grid] 승인, 제한 앱 목록 조회 (SL-08)', defaultChecked: true },
      { scope: 'admin.roles:read', label: '[Enterprise Grid] 관리자 역할 배정 조회 (SL-16)', defaultChecked: true },
      { scope: 'admin.workflows:read', label: '[Enterprise Grid] 워크플로, 권한 조회 (SL-17)', defaultChecked: true },
      { scope: 'admin.barriers:read', label: '[Enterprise Grid] 정보 차단(Information Barrier) 조회 (SL-18)', defaultChecked: true },
      { scope: 'auditlogs:read', label: '[Enterprise Grid] 조직 감사 로그(Audit Logs) 조회 (SL-11)', defaultChecked: true },
    ],
  },
  github: {
    urlEnv: 'GITHUB_ORG',
    urlLabel: '수집 대상 GitHub 조직 이름 (Organization slug)',
    urlPlaceholder: 'my-org',
    clientIdEnv: 'GITHUB_OAUTH_CLIENT_ID',
    clientIdLabel: 'GitHub OAuth App (또는 GitHub App) Client ID',
    clientIdPlaceholder: 'Ov23li... 또는 Iv1...',
    clientSecretEnv: 'GITHUB_OAUTH_CLIENT_SECRET',
    clientSecretLabel: 'GitHub OAuth App Client Secret (필수)',
    clientSecretOptional: false,
    refreshTokenEnv: 'GITHUB_COLLECTOR_OAUTH_TOKEN',
    scopes: [
      { scope: 'repo', label: '저장소, 브랜치 보호, 협업자, 커밋, PR 읽기 (GH-05~12, 24~26, 30)', defaultChecked: true },
      { scope: 'read:org', label: '조직, 멤버, 팀, 역할 읽기 (GH-01~04, 07, 21, 27, 29)', defaultChecked: true },
      { scope: 'admin:org', label: '조직 설정, 러너, 변수, 시크릿 메타데이터 조회 (GH-14, 25, 31, 32, 34)', defaultChecked: true },
      { scope: 'admin:org_hook', label: '조직 웹훅 메타데이터 조회 (GH-15)', defaultChecked: true },
      { scope: 'read:user', label: '사용자 프로필 조회 (GH-03)', defaultChecked: true },
      { scope: 'user:email', label: '사용자 이메일 조회 (GH-03, 21)', defaultChecked: true },
      { scope: 'read:packages', label: '조직 패키지 목록 조회 (GH-33)', defaultChecked: true },
      { scope: 'read:audit_log', label: '조직, 엔터프라이즈 감사 로그 조회 (GH-17, 19)', defaultChecked: true },
      { scope: 'read:enterprise', label: '엔터프라이즈 GraphQL, SAML 신원 조회 (GH-20, 23)', defaultChecked: true },
      { scope: 'manage_runners:enterprise', label: '엔터프라이즈 커스텀 이미지·러너 조회', defaultChecked: true },
    ],
  },
  atlassian: {
    urlEnv: 'ATLASSIAN_SITE_URL',
    urlLabel: 'Atlassian 사이트 주소 (선택 — 동의 시 자동 감지)',
    urlPlaceholder: 'https://<site>.atlassian.net',
    urlOptional: true,
    clientIdEnv: 'ATLASSIAN_COLLECTOR_CLIENT_ID',
    clientIdLabel: 'Atlassian OAuth 2.0 (3LO) Client ID',
    clientIdPlaceholder: 'Atlassian Developer Console Client ID',
    clientSecretEnv: 'ATLASSIAN_COLLECTOR_CLIENT_SECRET',
    clientSecretLabel: 'Atlassian OAuth 2.0 (3LO) Secret (필수)',
    clientSecretOptional: false,
    refreshTokenEnv: 'ATLASSIAN_COLLECTOR_REFRESH_TOKEN',
    scopes: [
      { scope: 'read:jira-user', label: 'Jira 사용자 조회 (JI-02)', defaultChecked: true },
      { scope: 'read:jira-work', label: 'Jira 프로젝트, 필터, 작업 데이터 조회 (AT-01, JI-04, JI-07)', defaultChecked: true },
      { scope: 'manage:jira-configuration', label: 'Jira 권한 스킴, 역할, 그룹 구성 조회 (JI-03, JI-05, JI-06)', defaultChecked: true },
      { scope: 'read:space:confluence', label: 'Confluence 스페이스 목록 조회 (CF-01)', defaultChecked: true },
      { scope: 'read:space-details:confluence', label: 'Confluence 스페이스 권한 상세 조회 (CF-02)', defaultChecked: true },
      { scope: 'read:audit-log:confluence', label: 'Confluence 감사 기록 조회 (CF-90)', defaultChecked: true },
    ],
  },
  gcp: {
    clientIdEnv: 'GCP_COLLECTOR_CLIENT_ID',
    clientIdLabel: 'GCP OAuth 2.0 Client ID',
    clientIdPlaceholder: '1234567890-abc.apps.googleusercontent.com',
    clientSecretEnv: 'GCP_COLLECTOR_CLIENT_SECRET',
    clientSecretLabel: 'Client Secret (필수 — Desktop 클라이언트는 토큰 교환에 필요)',
    clientSecretOptional: false,
    refreshTokenEnv: 'GCP_COLLECTOR_REFRESH_TOKEN',
    scopes: [
      { scope: 'https://www.googleapis.com/auth/cloud-platform', label: 'GCP IAM · Cloud Asset · Discovery Engine(Gemini Enterprise) 읽기 조회 (GCP-01~06, 수집기는 GET만 전송)', defaultChecked: true },
    ],
  },
}

const GROUPS: Record<string, GroupSpec[]> = {
  okta: [{
    id: 'CRED-OK-01',
    label: 'API 토큰',
    fields: [
      { env: 'OKTA_ORG_URL', label: 'Org URL', placeholder: 'https://<org>.okta.com' },
      { env: 'OKTA_API_TOKEN', label: 'API Token', placeholder: '00...', secret: true },
    ],
  }],
  gws: [{
    id: 'CRED-GW-01',
    label: '3단계. 최고 관리자 이메일 입력 및 저장',
    fields: [
      { env: 'GWS_ADMIN_SUBJECT', label: '관리자 이메일', placeholder: 'admin@company.com' }, // rules-ok: 예시 메일
      { env: 'GWS_COLLECTOR_SA_KEY', label: '서비스 계정 JSON 키 (DWD 필수)', placeholder: '{"type":"service_account",...}', secret: true, multiline: true },
    ],
  }],
  github: [
    {
      id: 'CRED-GH-00',
      label: '대상 테넌트',
      fields: [
        { env: 'GITHUB_ORG', label: 'Organization', placeholder: 'my-org', optional: true },
        { env: 'GITHUB_ENTERPRISE', label: 'Enterprise (선택)', placeholder: 'my-enterprise', optional: true },
      ],
    },
    {
      id: 'CRED-GH-02',
      label: 'PAT',
      fields: [
        { env: 'GITHUB_OWNER_TOKEN', label: 'Personal Access Token', placeholder: 'ghp_...', secret: true, optional: true },
      ],
    },
    {
      id: 'CRED-GH-01',
      label: 'GitHub App',
      fields: [
        { env: 'GITHUB_APP_ID', label: 'App ID', placeholder: '123456' },
        { env: 'GITHUB_APP_INSTALLATION_ID', label: 'Organization Installation ID', placeholder: '12345678', optional: true },
        { env: 'GITHUB_APP_ENTERPRISE_INSTALLATION_ID', label: 'Enterprise Installation ID (선택)', placeholder: '12345678', optional: true },
        { env: 'GITHUB_APP_PRIVATE_KEY', label: 'Private Key (PEM)', placeholder: '-----BEGIN RSA PRIVATE KEY-----', secret: true, multiline: true },
      ],
    },
  ],
  slack: [
    {
      id: 'CRED-SL-02',
      label: '봇 토큰',
      fields: [
        { env: 'SLACK_COLLECTOR_BOT_TOKEN', label: 'Bot Token', placeholder: 'xoxb-...', secret: true },
      ],
    },
    {
      id: 'CRED-SL-01',
      label: '관리자 사용자 토큰',
      fields: [
        { env: 'SLACK_COLLECTOR_USER_TOKEN', label: 'User Token', placeholder: 'xoxp-...', secret: true },
      ],
    },
    {
      id: 'CRED-SL-03',
      label: '앱 매니페스트 토큰 (선택)',
      fields: [
        { env: 'SLACK_CONFIG_TOKEN', label: 'Config Access Token', placeholder: 'xoxe.xoxp-...', secret: true, optional: true },
        { env: 'SLACK_CONFIG_REFRESH_TOKEN', label: 'Config Refresh Token', placeholder: 'xoxe-1-...', secret: true, optional: true },
      ],
    },
  ],
  salesforce: [{
    id: 'CRED-SF-01',
    label: 'Connected App',
    fields: [
      { env: 'SALESFORCE_INSTANCE_URL', label: 'Instance URL', placeholder: 'https://<domain>.my.salesforce.com' },
      { env: 'SALESFORCE_COLLECTOR_CLIENT_ID', label: 'Consumer Key', placeholder: '3MVG9...' },
      { env: 'SALESFORCE_COLLECTOR_CLIENT_SECRET', label: 'Consumer Secret', placeholder: '...', secret: true },
    ],
  }],
  atlassian: [
    {
      id: 'CRED-AT-ORG-02',
      label: '1단계 · 조직 & Guard (조직 전체 호출 9종 포함 · 미입력 시 skipped)',
      fields: [
        { env: 'ATLASSIAN_ORG_ID', label: 'Organization ID (admin.atlassian.com/o/<orgId>)', placeholder: '12345678-abcd-ef01-2345-6789abcdef01' },
        { env: 'ATLASSIAN_ORG_AUDIT_API_KEY', label: 'Organization API Key (read:orgs:admin, read:directories:admin, read:groups:admin, read:events:admin, read:domains:admin, read:policies:admin, read:service-accounts-tokens:admin)', placeholder: 'admin.atlassian.com 조직 API 키', secret: true },
      ],
    },
    {
      id: 'CRED-AT-01',
      label: '2단계 · 사이트 API 토큰 (필수)',
      fields: [
        { env: 'ATLASSIAN_SITE_URL', label: 'Site URL', placeholder: 'https://<site>.atlassian.net' },
        { env: 'ATLASSIAN_COLLECTOR_EMAIL', label: '관리자 이메일', placeholder: 'admin@company.com' },
        { env: 'ATLASSIAN_COLLECTOR_API_TOKEN', label: 'API 토큰', placeholder: 'ATATT...', secret: true },
      ],
    },
  ],
  gcp: [
    {
      id: 'CRED-GCP-01',
      label: 'GCP / Gemini Enterprise OAuth (자체 OAuth 클라이언트 필요 · IAM 역할 7종 + listUserLicenses 맞춤 역할 + 7개 API 활성화)',
      fields: [
        { env: 'GCP_COLLECTOR_CLIENT_ID', label: 'OAuth Client ID', placeholder: '1234567890-abc.apps.googleusercontent.com' },
        { env: 'GCP_COLLECTOR_CLIENT_SECRET', label: 'OAuth Client Secret (선택)', placeholder: 'GOCSPX-...', secret: true, optional: true },
        { env: 'GCP_COLLECTOR_REFRESH_TOKEN', label: 'OAuth Refresh Token', placeholder: '1//...', secret: true },
        { env: 'GCP_PROJECTS', label: '대상 GCP 프로젝트 ID (쉼표 구분, 비우면 자동 탐색)', placeholder: 'my-gcp-project-id', optional: true },
        { env: 'GCP_DISCOVERY_LOCATIONS', label: 'Discovery Engine 위치 (선택, 기본 global)', placeholder: 'global, us', optional: true },
        { env: 'GCP_REGIONS', label: 'Agent Platform 리전 (선택)', placeholder: 'us-central1', optional: true },
      ],
    },
  ],
  onepassword: [
    {
      id: 'CRED-OP-01',
      label: '1단계 · 서비스 계정 토큰 (OP-01, OP-02 — 웹 콘솔 로그인 시 계정 Secret Key 필요, 아래 칸에는 ops_... 토큰만 입력)',
      fields: [
        { env: 'ONEPASSWORD_SERVICE_ACCOUNT_TOKEN', label: 'Service Account Token (금고별 Read Items)', placeholder: 'ops_...', secret: true },
        { env: 'ONEPASSWORD_ACCOUNT_ID', label: '기대 계정 UUID (선택)', placeholder: '비워두면 op whoami 결과 사용', optional: true },
      ],
    },
    {
      id: 'CRED-OP-02',
      label: '2단계 · Events Reporting 토큰 (선택, OP-03 — 감사 이벤트·항목 사용·로그인 시도 3종 모두 켜기)',
      fields: [
        { env: 'ONEPASSWORD_EVENTS_TOKEN', label: 'Events Reporting Token (Audit Events · Item Usages · Sign-in Attempts)', placeholder: 'eyJ...', secret: true, optional: true },
        { env: 'ONEPASSWORD_EVENTS_HOST', label: 'Events API Host (선택)', placeholder: 'https://events.1password.com', optional: true },
      ],
    },
  ],
  microsoft: [
    {
      id: 'CRED-M365-01',
      label: 'Microsoft Entra ID 앱 등록 (Client Credentials · Graph 애플리케이션 권한 20종 관리자 동의 · 로그인 기록은 Entra ID P1 이상)',
      fields: [
        { env: 'M365_TENANT_ID', label: 'Directory (Tenant) ID', placeholder: '00000000-0000-0000-0000-000000000000' },
        { env: 'M365_CLIENT_ID', label: 'Application (Client) ID', placeholder: '00000000-0000-0000-0000-000000000000' },
        { env: 'M365_CLIENT_SECRET', label: 'Client Secret', placeholder: '...', secret: true },
      ],
    },
  ],
  snowflake: [
    {
      id: 'CRED-SNOW-01',
      label: 'Snowflake Key-Pair JWT (엔진 수집기 머지 대기 중 · 입력 칸 선반영)',
      fields: [
        { env: 'SNOWFLAKE_ACCOUNT', label: 'Account Identifier (<org>-<account>)', placeholder: 'orgname-accountname' },
        { env: 'SNOWFLAKE_COLLECTOR_USER', label: 'Collector Service User (TYPE=SERVICE)', placeholder: 'AEGI_COLLECTOR' },
        { env: 'SNOWFLAKE_COLLECTOR_PRIVATE_KEY', label: 'RSA Private Key (PEM)', placeholder: '-----BEGIN PRIVATE KEY-----\n...', secret: true, multiline: true },
        { env: 'SNOWFLAKE_HOST', label: 'Custom Host (선택)', placeholder: 'https://<account>.snowflakecomputing.com', optional: true },
      ],
    },
  ],
  aws: [
    {
      id: 'CRED-AWS-01',
      label: 'AWS 수집 전용 IAM 사용자 Access Key (최소 정책 17종 또는 ReadOnlyAccess)',
      fields: [
        { env: 'AWS_ACCESS_KEY_ID', label: 'AWS Access Key ID', placeholder: 'AKIA...' },
        { env: 'AWS_SECRET_ACCESS_KEY', label: 'AWS Secret Access Key', placeholder: '...', secret: true },
        { env: 'AWS_REGION', label: '기본 리전 (선택, 기본 ap-northeast-2)', placeholder: 'ap-northeast-2', optional: true },
        { env: 'AWS_ACCOUNT_ID', label: 'AWS 계정 ID (선택 — STS 자동 감지)', placeholder: '123456789012', optional: true },
      ],
    },
  ],
}

interface StatusPayload {
  configured: Record<string, boolean>
  hints?: Record<string, string>
  port?: number
  defaultPort?: number
  redirectUri?: string
  portWarning?: string | null
  collecting?: boolean
  opCli?: { installed: boolean; version?: string }
}

type StatusMap = Record<string, boolean>
type HintMap = Record<string, string>
type CheckResult = { ok: boolean; detail: string; ssoUrl?: string; org?: string; orgId?: string; sites?: Array<{ url: string; name?: string }> }

const BUILTIN_OAUTH_DEFAULTS: Record<string, {
  orgUrl: string
  clientId: string
  scopes: string[]
  appLabel: string
}> = {
  salesforce: {
    orgUrl: '',
    clientId: '3MVG9XgkMlifdwVC2KGgsPx_jmaIdSrBFcz1YMZaHv3UTHiVVJS6nic1njLHq669vVQ43ynEHTbNe9oydrXbk',
    scopes: ['api', 'refresh_token'],
    appLabel: '내장 OAuth 앱(AEGI Collector - PKCE)',
  },
}

const GWS_CLOUD_SHELL_SCRIPT = `# 1. AEGI 전용 GCP 프로젝트('AEGI Collector') 확인 또는 신규 생성 (기존 다른 프로젝트는 건드리지 않음)
echo "==> AEGI 전용 GCP 프로젝트('AEGI Collector') 확인 중..."
PROJECT_ID=\$(gcloud projects list --filter="name=\\"AEGI Collector\\"" --format="value(projectId)" --limit=1 2>/dev/null || true)
if [ -n "\$PROJECT_ID" ]; then
  echo "==> 기존 전용 프로젝트 재사용: \$PROJECT_ID"
else
  PROJECT_ID="aegi-gws-\$(date +%s)"
  echo "==> 전용 프로젝트 신규 생성 중: \$PROJECT_ID (이름: AEGI Collector) ..."
  gcloud projects create "\$PROJECT_ID" --name="AEGI Collector" || {
    echo "[ERROR] GCP 프로젝트 생성에 실패했습니다. 권한 또는 프로젝트 한도가 부족한 경우 https://console.cloud.google.com/projectcreate 에서 'AEGI Collector' 프로젝트를 먼저 생성해 주세요."
    exit 1
  }
fi
gcloud config set project "\$PROJECT_ID"
echo "선택된 프로젝트: \$PROJECT_ID"

# 2. AEGI 수집에 필요한 13개 API 일괄 활성화 (약관 미동의 시 자동 감지 및 안내)
echo "==> Google Workspace 관련 API 활성화 중 (약 10~20초 소요)..."
APIS=(
  "admin.googleapis.com"
  "drive.googleapis.com"
  "cloudidentity.googleapis.com"
  "groupssettings.googleapis.com"
  "gmail.googleapis.com"
  "calendar-json.googleapis.com"
  "script.googleapis.com"
  "forms.googleapis.com"
  "alertcenter.googleapis.com"
  "chromemanagement.googleapis.com"
  "vault.googleapis.com"
  "licensing.googleapis.com"
  "drivelabels.googleapis.com"
)

while true; do
  ENABLE_OUT=\$(gcloud services enable "\${APIS[@]}" 2>&1 || true)
  if echo "\$ENABLE_OUT" | grep -qi "UREQ_TOS_NOT_ACCEPTED"; then
    TOS_ID=\$(echo "\$ENABLE_OUT" | grep -o 'tos_id=[^& ]*' | head -n1 | cut -d'=' -f2)
    [ -z "\$TOS_ID" ] && TOS_ID="appsadmin"
    echo ""
    echo "================================================================="
    echo "[필수 약관 동의] Google Cloud API 약관(\$TOS_ID) 동의가 필요합니다."
    echo "브라우저에서 아래 링크를 열어 약관에 동의(Accept)해 주세요:"
    echo "https://console.developers.google.com/terms/\${TOS_ID}?project=\${PROJECT_ID}"
    echo "================================================================="
    read -p "약관 동의 완료 후 엔터(Enter)를 누르면 계속 진행됩니다: " _DUMMY
  elif echo "\$ENABLE_OUT" | grep -qi "ERROR:"; then
    echo "\$ENABLE_OUT"
    echo "[ERROR] API 활성화에 실패했습니다. 위의 오류를 확인해 주세요."
    exit 1
  else
    echo "==> 모든 필수 API 활성화 완료!"
    break
  fi
done

# 3. AEGI 전용 수집 서비스 계정 생성 (이미 존재하는 경우 재사용)
SA_NAME="aegi-collector"
SA_EMAIL="\${SA_NAME}@\${PROJECT_ID}.iam.gserviceaccount.com"
echo "==> 서비스 계정 확인 및 생성 중 (\$SA_EMAIL)..."
if ! gcloud iam service-accounts describe "\$SA_EMAIL" >/dev/null 2>&1; then
  gcloud iam service-accounts create \$SA_NAME \\
    --display-name="AEGI SaaS Security Collector"
fi

# 4. 서비스 계정 고유 Client ID 및 이메일 조회
CLIENT_ID=\$(gcloud iam service-accounts describe "\${SA_EMAIL}" --format="value(uniqueId)")

# 5. 비공개 JSON 키 생성 및 다운로드 (조직 보안 정책 차단 자동 해제 시도)
KEY_FILE="aegi-sa-key.json"
rm -f "\$KEY_FILE"
echo "==> 서비스 계정 비공개 키 생성 중..."

# 5-1. 신규 조직 기본 보안 정책(iam.managed.disableServiceAccountKeyCreation / iam.disableServiceAccountKeyCreation) 자동 해제
relax_sa_key_policy() {
  local org_id me
  org_id=\$(gcloud organizations list --format="value(name)" --limit=1 2>/dev/null || true)
  me=\$(gcloud config get-value account 2>/dev/null || true)
  if [ -n "\$org_id" ] && [ -n "\$me" ]; then
    gcloud organizations add-iam-policy-binding "\$org_id" --member="user:\$me" --role="roles/orgpolicy.policyAdmin" >/dev/null 2>&1 || true
  fi
  gcloud services enable orgpolicy.googleapis.com --project="\$PROJECT_ID" >/dev/null 2>&1 || true
  cat <<EOF > /tmp/aegi-sa-key-policy.yaml
name: projects/\${PROJECT_ID}/policies/iam.managed.disableServiceAccountKeyCreation
spec:
  rules:
  - enforce: false
EOF
  gcloud org-policies set-policy /tmp/aegi-sa-key-policy.yaml >/dev/null 2>&1 || true
  cat <<EOF > /tmp/aegi-sa-key-legacy.yaml
name: projects/\${PROJECT_ID}/policies/iam.disableServiceAccountKeyCreation
spec:
  rules:
  - enforce: false
EOF
  gcloud org-policies set-policy /tmp/aegi-sa-key-legacy.yaml >/dev/null 2>&1 || true
  gcloud resource-manager org-policies disable-enforce iam.disableServiceAccountKeyCreation --project="\$PROJECT_ID" >/dev/null 2>&1 || true
  rm -f /tmp/aegi-sa-key-policy.yaml /tmp/aegi-sa-key-legacy.yaml
}

POLICY_TRIED=0
NF_TRIES=0
while true; do
  KEY_OUT=\$(gcloud iam service-accounts keys create "\$KEY_FILE" --iam-account="\${SA_EMAIL}" 2>&1 || true)
  if [ -s "\$KEY_FILE" ]; then
    echo "==> 키 파일(\$KEY_FILE) 생성 성공!"
    break
  fi

  if echo "\$KEY_OUT" | grep -qi "disableServiceAccountKeyCreation"; then
    if [ "\$POLICY_TRIED" -eq 0 ]; then
      POLICY_TRIED=1
      echo "==> 조직 기본 보안 정책(키 생성 제한)을 이 프로젝트에서만 자동 해제 중..."
      relax_sa_key_policy
      for _i in 1 2 3 4 5 6; do
        sleep 5
        KEY_OUT=\$(gcloud iam service-accounts keys create "\$KEY_FILE" --iam-account="\${SA_EMAIL}" 2>&1 || true)
        if [ -s "\$KEY_FILE" ]; then
          echo "==> 키 파일(\$KEY_FILE) 생성 성공!"
          break 2
        fi
      done
    fi
    echo ""
    echo "================================================================="
    echo "[조직 보안 정책 차단] 자동 해제에 실패했습니다 (조직 관리자 권한 필요)."
    echo "아래 링크를 브라우저에서 열어 이 프로젝트의 정책을 해제해 주세요:"
    echo "1) 링크 접속: https://console.cloud.google.com/iam-admin/orgpolicies/iam-managed-disableServiceAccountKeyCreation?project=\${PROJECT_ID}"
    echo "2) 상단 [정책 관리(EDIT)] 클릭 (비활성 시 조직 IAM에서 '조직 정책 관리자' 역할 추가)"
    echo "3) '상위 정책 재정의(Override parent policy)' 선택"
    echo "4) '적용 안함(Not enforced / Off)' 선택 후 [정책 저장(SET POLICY)] 클릭"
    echo "================================================================="
    read -p "정책 변경 후 엔터(Enter)를 누르면 키 생성을 다시 시도합니다: " _DUMMY
  elif echo "\$KEY_OUT" | grep -Eqi "NOT_FOUND|does not exist" && [ "\$NF_TRIES" -lt 6 ]; then
    NF_TRIES=\$((NF_TRIES + 1))
    echo "==> 서비스 계정 전파 대기 중 (5초 후 재시도 \${NF_TRIES}/6)..."
    sleep 5
    continue
  else
    echo "\$KEY_OUT"
    echo "[ERROR] 키 파일 생성에 실패했습니다."
    exit 1
  fi
done

ADMIN_EMAIL=\$(gcloud config get-value account 2>/dev/null || true)
if [ -n "\$ADMIN_EMAIL" ] && command -v python3 >/dev/null 2>&1; then
  python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["admin_subject"]=sys.argv[2]; json.dump(d,open(p,"w"),indent=2)' "\$KEY_FILE" "\$ADMIN_EMAIL" 2>/dev/null || true
fi

echo ""
echo "================================================================="
echo "서비스 계정: \${SA_EMAIL}"
[ -n "\$ADMIN_EMAIL" ] && echo "최고 관리자 이메일 (자동 감지): \${ADMIN_EMAIL}"
echo "Google Workspace 관리 콘솔(admin.google.com) DWD 등록용 Client ID:"
echo "\${CLIENT_ID}"
echo "================================================================="
echo "키 파일(\$KEY_FILE)을 다운로드합니다."
cloudshell download "\$KEY_FILE" 2>/dev/null || echo "(브라우저 팝업 차단 시 상단 메뉴의 [파일] > [파일 다운로드]에서 \$KEY_FILE 입력)"
`

// 엔진 GWS_COLLECT_SCOPES 와 같게 둔다
const SCOPE_ENV_BY_PROVIDER: Record<string, string> = {
  okta: 'OKTA_SCOPES',
  gws: 'GWS_GRANTED_SCOPES',
  slack: 'SLACK_OAUTH_SCOPES',
  github: 'GITHUB_OAUTH_SCOPES',
  atlassian: 'ATLASSIAN_OAUTH_SCOPES',
}

const SLACK_ENTERPRISE_SCOPES = [
  'admin',
  'admin.users:read',
  'admin.conversations:read',
  'admin.teams:read',
  'admin.usergroups:read',
  'admin.apps:read',
  'admin.roles:read',
  'admin.workflows:read',
  'admin.barriers:read',
  'auditlogs:read',
]

const SLACK_ENTERPRISE_SET = new Set(SLACK_ENTERPRISE_SCOPES)

function buildSlackAppManifest(
  redirectUri: string,
  enterprise: boolean,
  selectedScopes?: Record<string, boolean>,
): string {
  const httpsRedirect = redirectUri.replace(/^http:\/\//i, 'https://')
  const chosen = selectedScopes
    ? Object.entries(selectedScopes)
        .filter(([, v]) => v)
        .map(([k]) => k)
    : []
  const chosenBot = chosen
    .filter(s => s.startsWith('bot:'))
    .map(s => s.slice(4))
  const chosenUser = chosen.filter(s => !s.startsWith('bot:'))
  const baseUser = chosenUser.length
    ? chosenUser
    : ['users:read', 'users.profile:read', 'channels:read', 'groups:read', 'usergroups:read', 'team:read']
  const userScopes = Array.from(
    new Set(enterprise ? [...baseUser, ...SLACK_ENTERPRISE_SCOPES] : baseUser),
  )
  const botScopes = chosenBot.length
    ? chosenBot
    : [
        'users:read',
        'channels:read',
        'groups:read',
        'channels:history',
        'groups:history',
        'team:read',
        'usergroups:read',
        'conversations.connect:manage',
      ]
  return JSON.stringify(
    {
      display_information: {
        name: 'AEGI Collector',
        description: 'AEGI SaaS Security Posture & Identity Graph Collector (Read-Only)',
        background_color: '#1e293b',
      },
      features: {
        bot_user: {
          display_name: 'aegi-collector',
          always_online: false,
        },
      },
      oauth_config: {
        redirect_urls: [httpsRedirect],
        scopes: {
          user: userScopes,
          bot: botScopes,
        },
      },
      settings: {
        org_deploy_enabled: enterprise,
        socket_mode_enabled: false,
        token_rotation_enabled: false,
      },
    },
    null,
    2,
  )
}

const GWS_DWD_EXTRA_SCOPES: Array<{ scope: string; label: string }> = [
  { scope: 'https://www.googleapis.com/auth/forms.body.readonly', label: 'Google Forms 구조 조회 (GW-08)' },
  { scope: 'https://www.googleapis.com/auth/script.projects.readonly', label: 'Apps Script 프로젝트·코드 조회 (GW-09)' },
  { scope: 'https://www.googleapis.com/auth/script.processes', label: 'Apps Script 실행 이력 조회 (GW-09, 13, 16)' },
  { scope: 'https://www.googleapis.com/auth/script.deployments.readonly', label: 'Apps Script 웹앱·API 배포 조회 (GW-11)' },
  { scope: 'https://www.googleapis.com/auth/gmail.settings.basic', label: 'Gmail 자동 전달·전달 주소·위임 조회 (GW-15)' },
  { scope: 'https://www.googleapis.com/auth/calendar.acls.readonly', label: '기본 캘린더 공유 규칙(ACL) 조회 (GW-22)' },
  { scope: 'https://www.googleapis.com/auth/calendar.readonly', label: '캘린더 목록·설정 조회' },
  { scope: 'https://www.googleapis.com/auth/admin.datatransfer.readonly', label: '데이터 이전(Data Transfer) 조회' },
  { scope: 'https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly', label: 'Chrome 브라우저 기기 조회' },
  { scope: 'https://www.googleapis.com/auth/admin.directory.device.mobile.readonly', label: '모바일 기기 조회' },
  { scope: 'https://www.googleapis.com/auth/admin.directory.resource.calendar.readonly', label: '캘린더 리소스 조회' },
  { scope: 'https://www.googleapis.com/auth/apps.alerts', label: 'Alert Center 보안 알림 조회' },
  { scope: 'https://www.googleapis.com/auth/chrome.management.appdetails.readonly', label: 'Chrome 앱 상세 조회' },
  { scope: 'https://www.googleapis.com/auth/chrome.management.profiles.readonly', label: 'Chrome 프로필 조회' },
  { scope: 'https://www.googleapis.com/auth/chrome.management.reports.readonly', label: 'Chrome 관리 리포트 조회' },
  { scope: 'https://www.googleapis.com/auth/chrome.management.telemetry.readonly', label: 'Chrome 텔레메트리 조회' },
  { scope: 'https://www.googleapis.com/auth/cloud-identity.devices.readonly', label: 'Cloud Identity 기기 조회' },
  { scope: 'https://www.googleapis.com/auth/drive.labels.readonly', label: 'Drive 라벨 조회' },
  { scope: 'https://www.googleapis.com/auth/ediscovery.readonly', label: 'Google Vault(eDiscovery) 조회' },
  { scope: 'https://www.googleapis.com/auth/apps.licensing', label: 'Enterprise License Manager 라이선스 배정 조회 (GW-25)' },
  { scope: 'https://www.googleapis.com/auth/gmail.labels', label: 'Gmail 사용자 라벨 조회' },
  { scope: 'https://www.googleapis.com/auth/drive.apps.readonly', label: 'Drive 서드파티 앱 조회' },
  { scope: 'https://www.googleapis.com/auth/admin.chrome.printers.readonly', label: 'Chrome 프린터·프린트 서버 조회' },
  { scope: 'https://www.googleapis.com/auth/chrome.management.connectors.readonly', label: 'Chrome 커넥터 설정 조회' },
  { scope: 'https://www.googleapis.com/auth/admin.directory.device.chromeos.readonly', label: 'ChromeOS 기기 조회 (GW-90)' },
]

const GWS_DWD_EXTRA_SET = new Set(GWS_DWD_EXTRA_SCOPES.map(s => s.scope))

const GWS_DWD_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.customer.readonly',
  'https://www.googleapis.com/auth/admin.directory.domain.readonly',
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.member.readonly',
  'https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly',
  'https://www.googleapis.com/auth/admin.directory.user.security',
  'https://www.googleapis.com/auth/admin.reports.audit.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/forms.body.readonly',
  'https://www.googleapis.com/auth/script.projects.readonly',
  'https://www.googleapis.com/auth/script.processes',
  'https://www.googleapis.com/auth/script.deployments.readonly',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/cloud-identity.inboundsso.readonly',
  'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
  'https://www.googleapis.com/auth/apps.groups.settings',
  'https://www.googleapis.com/auth/calendar.acls.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/cloud-identity.allowlisteddomains.readonly',
  'https://www.googleapis.com/auth/cloud-identity.policies.readonly',
  'https://www.googleapis.com/auth/admin.datatransfer.readonly',
  'https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly',
  'https://www.googleapis.com/auth/admin.directory.device.mobile.readonly',
  'https://www.googleapis.com/auth/admin.directory.resource.calendar.readonly',
  'https://www.googleapis.com/auth/apps.alerts',
  'https://www.googleapis.com/auth/chrome.management.appdetails.readonly',
  'https://www.googleapis.com/auth/chrome.management.profiles.readonly',
  'https://www.googleapis.com/auth/chrome.management.reports.readonly',
  'https://www.googleapis.com/auth/chrome.management.telemetry.readonly',
  'https://www.googleapis.com/auth/cloud-identity.devices.readonly',
  'https://www.googleapis.com/auth/drive.labels.readonly',
  'https://www.googleapis.com/auth/ediscovery.readonly',
  'https://www.googleapis.com/auth/apps.licensing',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/drive.apps.readonly',
  'https://www.googleapis.com/auth/admin.chrome.printers.readonly',
  'https://www.googleapis.com/auth/chrome.management.connectors.readonly',
  'https://www.googleapis.com/auth/admin.directory.device.chromeos.readonly',
].join(', ')

function hasOAuthSupport(provider: string): provider is 'okta' | 'salesforce' | 'gws' | 'slack' | 'github' | 'atlassian' | 'gcp' {
  return (
    provider === 'okta' ||
    provider === 'salesforce' ||
    provider === 'gws' ||
    provider === 'slack' ||
    provider === 'github' ||
    provider === 'atlassian' ||
    provider === 'gcp'
  )
}

export default function SaasConnect({
  provider,
  name,
  onConnectionChange,
  onStartCollect,
}: {
  provider: string
  name: string
  onConnectionChange?: (provider: string, connected: boolean) => void
  onStartCollect?: (provider: string) => void
}) {
  const groups = GROUPS[provider]
  const oauthSpec = hasOAuthSupport(provider) ? OAUTH_SPECS[provider] : null
  const oauthGuide = hasOAuthSupport(provider) && provider in OAUTH_REGISTRATION_GUIDES
    ? OAUTH_REGISTRATION_GUIDES[provider as keyof typeof OAUTH_REGISTRATION_GUIDES]
    : null
  const builtinApp = BUILTIN_OAUTH_DEFAULTS[provider] ?? null

  const [tab, setTab] = useState<'oauth' | 'manual'>(provider === 'okta' || provider === 'gws' || provider === 'github' || provider === 'atlassian' || !oauthSpec ? 'manual' : 'oauth')
  const [status, setStatus] = useState<StatusMap>({})
  const configured = status
  const [hints, setHints] = useState<HintMap>({})
  const [serverMeta, setServerMeta] = useState<{ port: number; redirectUri: string; portWarning: string | null; collecting: boolean; opCli?: { installed: boolean; version?: string } }>({
    port: Number(window.location.port || 5199),
    redirectUri: `${window.location.origin}/__aegi/oauth/callback`,
    portWarning: window.location.port && window.location.port !== '5199'
      ? `현재 포트(${window.location.port})가 기본 포트(5199)와 다릅니다. 각 SaaS 앱 등록의 Redirect URI에 ${window.location.origin}/__aegi/oauth/callback 가 등록되어 있는지 확인하세요.`
      : null,
    collecting: false,
  })
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [selectedScopes, setSelectedScopes] = useState<Record<string, boolean>>(() => {
    if (!oauthSpec) return {}
    const base = builtinApp
      ? Object.fromEntries(oauthSpec.scopes.map(s => [s.scope, new Set(builtinApp.scopes).has(s.scope)]))
      : Object.fromEntries(oauthSpec.scopes.map(s => [s.scope, s.defaultChecked !== false]))
    if (provider === 'gws') {
      return { ...base, ...Object.fromEntries(GWS_DWD_EXTRA_SCOPES.map(s => [s.scope, true])) }
    }
    return base
  })
  const [saving, setSaving] = useState(false)
  const [scopesDirty, setScopesDirty] = useState(false)
  const [oauthWaiting, setOauthWaiting] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [collectResult, setCollectResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [oauthNotice, setOauthNotice] = useState<{
    ok: boolean
    text: string
    ssoUrl?: string
    org?: string
    cleanupLinks?: Array<{ label: string; url: string }>
  } | null>(null)
  const [popupUrl, setPopupUrl] = useState<string | null>(null)
  const [copiedUri, setCopiedUri] = useState(false)
  const [copiedScript, setCopiedScript] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [saKeyInfo, setSaKeyInfo] = useState<string | null>(null)
  const [githubOrgs, setGithubOrgs] = useState<Array<{ login: string; name?: string; description?: string; avatarUrl?: string; installationId?: string; targetType?: string }>>([])
  const [loadingGithubOrgs, setLoadingGithubOrgs] = useState(false)
  const lastFetchedPatRef = useRef<string>('')
  const [atlassianSites, setAtlassianSites] = useState<Array<{ url: string; name?: string }>>([])

  const focusField = useCallback((envKey: string, msg?: string) => {
    if (msg) setError(msg)
    const el = (document.getElementById(`sc-${envKey}`) ||
      document.querySelector(`[data-env="${envKey}"], [name="${envKey}"]`)) as HTMLInputElement | HTMLTextAreaElement | null
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus()
      el.classList.add('sc-field-error-highlight')
      setTimeout(() => el.classList.remove('sc-field-error-highlight'), 3000)
    }
  }, [])

  // GitHub App Manifest 폼에 붙일 일회용 state. 서버는 이 state 와 함께 돌아온 code 만 변환한다(다른 사이트의 CSRF 방지).
  // state 는 10분 동안 한 번만 쓰이므로 9분마다, 그리고 폼을 보낸 뒤에 새로 받는다.
  const [manifestState, setManifestState] = useState<string | null>(null)
  const refreshManifestState = useCallback(async () => {
    if (provider !== 'github') return
    try {
      const res = await fetch('/__aegi/github/manifest-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = res.ok ? ((await res.json()) as { state?: string }) : null
      setManifestState(typeof data?.state === 'string' ? data.state : null)
    } catch {
      setManifestState(null)
    }
  }, [provider])
  useEffect(() => {
    if (provider !== 'github') return
    void refreshManifestState()
    const timer = window.setInterval(() => { void refreshManifestState() }, 9 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [provider, refreshManifestState])

  const loadGithubOrgs = useCallback(async (tokenOverride?: string) => {
    if (provider !== 'github') return
    setLoadingGithubOrgs(true)
    try {
      const res = tokenOverride
        ? await fetch('/__aegi/github/orgs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: tokenOverride }),
          })
        : await fetch('/__aegi/github/orgs')
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; orgs: typeof githubOrgs }
        if (data.ok && Array.isArray(data.orgs)) {
          setGithubOrgs(data.orgs)
          if (data.orgs.length === 1 && !values.GITHUB_ORG && !hints.GITHUB_ORG) {
            setValues(prev => ({ ...prev, GITHUB_ORG: data.orgs[0].login }))
          }
        }
      }
    } catch {
      // pass
    } finally {
      setLoadingGithubOrgs(false)
    }
  }, [provider, values.GITHUB_ORG, hints.GITHUB_ORG])

  useEffect(() => {
    if (!open || provider !== 'github' || tab !== 'manual') return
    const tok = (values.GITHUB_OWNER_TOKEN || '').trim()
    if (tok.length < 20 || tok === lastFetchedPatRef.current) return
    const timer = window.setTimeout(() => {
      lastFetchedPatRef.current = tok
      void loadGithubOrgs(tok)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [open, provider, tab, values.GITHUB_OWNER_TOKEN, loadGithubOrgs])

  const [collectProgress, setCollectProgress] = useState<string | null>(null)
  const collectJobRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pemInputRef = useRef<HTMLInputElement | null>(null)
  const [copiedScopes, setCopiedScopes] = useState(false)
  const [copiedDwdClientId, setCopiedDwdClientId] = useState(false)
  const [copiedSlackManifest, setCopiedSlackManifest] = useState<'ws' | 'ent' | null>(null)
  const [openGuide, setOpenGuide] = useState<string | null>(null)
  const [showCustomApp, setShowCustomApp] = useState(false)
  const [showOAuthSteps, setShowOAuthSteps] = useState(false)
  const [showScopes, setShowScopes] = useState(false)
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({})
  const [checking, setChecking] = useState<string | null>(null)
  const [checked, setChecked] = useState<Record<string, CheckResult>>({})
  const dialogRef = useRef<HTMLDialogElement>(null)

  const applyPayload = useCallback((data: StatusPayload) => {
    setStatus(data.configured ?? {})
    if (data.hints) {
      setHints(data.hints)
      const scopeEnv = SCOPE_ENV_BY_PROVIDER[provider]
      const rawSaved = scopeEnv ? data.hints[scopeEnv] : undefined
      if (rawSaved && oauthSpec) {
        const savedSet = new Set(
          rawSaved
            .split(/[\s,]+/)
            .map(s => s.trim())
            .filter(Boolean),
        )
        if (savedSet.size > 0) {
          const baseEntries = oauthSpec.scopes.map(s => [
            s.scope,
            savedSet.has(s.scope) ||
              savedSet.has(s.scope.replace('https://www.googleapis.com/auth/', '')),
          ])
          if (provider === 'gws') {
            const hasSavedDwdExtra = GWS_DWD_EXTRA_SCOPES.some(
              s => savedSet.has(s.scope) || savedSet.has(s.scope.replace('https://www.googleapis.com/auth/', '')),
            )
            const keepDwdDefault = !data.configured?.GWS_COLLECTOR_SA_KEY && !hasSavedDwdExtra
            const extraEntries = GWS_DWD_EXTRA_SCOPES.map(s => [
              s.scope,
              keepDwdDefault
                ? true
                : savedSet.has(s.scope) || savedSet.has(s.scope.replace('https://www.googleapis.com/auth/', '')),
            ])
            setSelectedScopes(Object.fromEntries([...baseEntries, ...extraEntries]))
          } else {
            setSelectedScopes(Object.fromEntries(baseEntries))
          }
          setScopesDirty(false)
        }
      }
      if (data.hints) {
        setValues(prev => {
          const next = { ...prev }
          for (const [k, v] of Object.entries(data.hints!)) {
            if (typeof v === 'string' && v.trim() && !next[k]) {
              next[k] = v.trim()
            }
          }
          return next
        })
        if (provider === 'atlassian') {
          const rawUrls = (data.hints.ATLASSIAN_SITE_URLS || data.hints.ATLASSIAN_SITE_URL || '').trim()
          if (rawUrls) {
            const parsed = rawUrls
              .split(/[\s,]+/)
              .map(u => u.trim())
              .filter(u => /^https:\/\/[^/]+\.atlassian\.net$/i.test(u))
              .map(url => ({ url }))
            if (parsed.length > 0) {
              setAtlassianSites(prev => (prev.length > 0 ? prev : parsed))
            }
          }
        }
      }
    }
    setServerMeta(prev => ({
      port: data.port ?? prev.port,
      redirectUri: data.redirectUri ?? prev.redirectUri,
      portWarning: data.portWarning !== undefined ? data.portWarning : prev.portWarning,
      collecting: Boolean(data.collecting),
      opCli: data.opCli ?? prev.opCli,
    }))
  }, [provider, oauthSpec])

  const load = useCallback(() => {
    if (!ENABLED || !groups) return
    void fetch(ENDPOINT)
      .then(r => (r.ok ? r.json() : null))
      .then((d: StatusPayload | null) => {
        if (d?.configured) applyPayload(d)
      })
      .catch(() => undefined)
  }, [groups, applyPayload])

  useEffect(() => {
    load()
    if (provider === 'github') {
      void loadGithubOrgs()
      void fetch(TEST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: 'CRED-GH-02', values: {} }),
      })
        .then(r => r.json())
        .then((body: CheckResult) => {
          if (body?.ssoUrl) {
            setOauthNotice({ ok: body.ok, text: body.detail, ssoUrl: body.ssoUrl, org: body.org })
          }
        })
        .catch(() => undefined)
    } else if (provider === 'atlassian') {
      void fetch(TEST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: 'CRED-AT-01', values: {} }),
      })
        .then(r => r.json())
        .then((body: CheckResult) => {
          if (body?.ok) setChecked(prev => ({ ...prev, 'CRED-AT-01': body }))
        })
        .catch(() => undefined)
      void fetch(TEST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: 'CRED-AT-ORG-02', values: {} }),
      })
        .then(r => r.json())
        .then((body: CheckResult) => {
          if (body?.ok) {
            setChecked(prev => ({ ...prev, 'CRED-AT-ORG-02': body }))
            if (Array.isArray(body.sites) && body.sites.length > 0) {
              setAtlassianSites(body.sites)
            }
          }
        })
        .catch(() => undefined)
    }
  }, [load, provider, loadGithubOrgs, open])

  // GitHub SAML SSO 승인 팝업에서 돌아왔을 때 자동 재확인
  useEffect(() => {
    if (!open || provider !== 'github') return
    const onFocus = () => {
      if (oauthNotice?.ssoUrl) {
        void fetch(TEST_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentialId: 'CRED-GH-02', values: {} }),
        })
          .then(r => r.json())
          .then((body: CheckResult) => {
            if (body && !body.ssoUrl && body.ok) {
              setOauthNotice({ ok: true, text: 'SAML SSO 승인이 확인되었습니다! 정상적으로 수집을 진행할 수 있습니다.' })
            }
          })
          .catch(() => undefined)
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [open, provider, oauthNotice?.ssoUrl])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // 팝업 postMessage 및 BroadcastChannel 수신 (origin 검증: http/https 127.0.0.1 과 localhost 루프백 교차 허용)
  useEffect(() => {
    if (!open) return
    const handleDonePayload = (payload: { type?: string; provider?: string; ok?: boolean; fingerprint?: string; error?: string } | null | undefined) => {
      if (!payload || payload.type !== 'aegi-oauth-done') return
      if (payload.provider && payload.provider !== provider) return
      setOauthWaiting(false)
      if (payload.ok) {
        setOauthNotice({
          ok: true,
          text: `OAuth 동의 및 토큰 저장 완료${payload.fingerprint ? ` (토큰 지문: ${payload.fingerprint})` : ''}`,
        })
        setError(null)
      } else {
        setOauthNotice({
          ok: false,
          text: payload.error || 'OAuth 동의 또는 토큰 교환에 실패했습니다.',
        })
      }
      load()
      if (provider === 'github') void loadGithubOrgs()
    }
    const onMessage = (event: MessageEvent) => {
      const portSuffix = window.location.port ? `:${window.location.port}` : ''
      const allowedOrigins = new Set([
        window.location.origin,
        `http://127.0.0.1${portSuffix}`,
        `http://localhost${portSuffix}`,
        `https://127.0.0.1${portSuffix}`,
        `https://localhost${portSuffix}`,
      ])
      if (!allowedOrigins.has(event.origin)) return
      handleDonePayload(event.data)
    }
    window.addEventListener('message', onMessage)
    let bc: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('aegi-oauth')
        bc.onmessage = (event: MessageEvent) => handleDonePayload(event.data)
      }
    } catch {
      bc = null
    }
    return () => {
      window.removeEventListener('message', onMessage)
      try { bc?.close() } catch { /* ignore */ }
    }
  }, [open, provider, load])

  // 팝업 Cross-Origin 탐색 후 window.opener 단절 대비 2초 폴링 보조 경로
  useEffect(() => {
    if (!open || !oauthWaiting || !oauthSpec) return
    const timer = window.setInterval(() => {
      void fetch(ENDPOINT)
        .then(r => (r.ok ? r.json() : null))
        .then((d: StatusPayload | null) => {
          if (!d?.configured) return
          applyPayload(d)
          if (
            d.configured[oauthSpec.refreshTokenEnv] ||
            (provider === 'slack' && d.configured.SLACK_COLLECTOR_BOT_TOKEN)
          ) {
            setOauthWaiting(false)
            setOauthNotice({ ok: true, text: 'OAuth 동의 및 갱신 토큰 저장이 확인되었습니다.' })
          }
        })
        .catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [open, oauthWaiting, oauthSpec, provider, applyPayload])


  // 수집 상태 2초 폴링 및 화면 열림/복귀 시 진행 상태 복원
  useEffect(() => {
    if (!open && !collecting) return
    let active = true

    const pollStatus = async () => {
      try {
        const res = await fetch(COLLECT_STATUS_ENDPOINT)
        if (!res.ok) return
        const d = (await res.json()) as {
          state: 'idle' | 'running' | 'done' | 'failed'
          jobId?: string | null
          startedAt?: string
          step?: string
          error?: string
        }
        if (!active) return

        if (d.state === 'running') {
          if (!collectJobRef.current && d.jobId) collectJobRef.current = d.jobId
          setCollecting(true)
          const started = d.startedAt ? new Date(d.startedAt).getTime() : Date.now()
          const elapsedSec = Math.max(0, Math.floor((Date.now() - started) / 1000))
          const timeStr = elapsedSec < 60 ? `${elapsedSec}초` : `${Math.floor(elapsedSec / 60)}분 ${elapsedSec % 60}초`
          const stepStr = d.step || '수집 진행 중'
          setCollectProgress(`${stepStr} (${timeStr})`)
        } else if (collecting && collectJobRef.current && d.jobId === collectJobRef.current) {
          collectJobRef.current = null
          setCollecting(false)
          setCollectProgress(null)
          if (d.state === 'done') {
            setCollectResult({
              ok: true,
              text: `${name} 수집 및 분석 갱신이 완료되었습니다. 페이지를 새로고침하면 최신 그래프가 반영됩니다.`,
            })
          } else if (d.state === 'failed') {
            setCollectResult({
              ok: false,
              text: d.error || '수집 실행 실패',
            })
          }
          load()
        }
      } catch {
        // 네트워크 일시 오류 무시
      }
    }

    void pollStatus()
    const timer = window.setInterval(() => { void pollStatus() }, 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [open, collecting, name, load])

  const handleKeyFile = (file: File) => {
    setError(null)
    const reader = new FileReader()
    reader.onload = e => {
      const text = String(e.target?.result || '')
      try {
        const json = JSON.parse(text) as { client_email?: string; admin_subject?: string }
        if (json.client_email) {
          setSaKeyInfo(json.client_email)
          setValues(prev => ({
            ...prev,
            GWS_COLLECTOR_SA_KEY: text,
            ...(json.admin_subject && !prev.GWS_ADMIN_SUBJECT ? { GWS_ADMIN_SUBJECT: json.admin_subject } : {}),
          }))
          setOauthNotice({
            ok: true,
            text: json.admin_subject
              ? `서비스 계정 키 파일(${json.client_email})과 관리자 이메일(${json.admin_subject})이 자동으로 입력되었습니다.`
              : `서비스 계정 키 파일(${json.client_email})이 성공적으로 입력되었습니다.`,
          })
        } else {
          setError('올바른 서비스 계정 JSON 키 파일이 아닙니다 (client_email 필드 없음).')
        }
      } catch {
        setError('JSON 파일 형식이 올바르지 않습니다.')
      }
    }
    reader.readAsText(file)
  }

  const handlePemFile = (file: File) => {
    setError(null)
    const reader = new FileReader()
    reader.onload = e => {
      const text = String(e.target?.result || '').trim()
      if (!text.includes('BEGIN') || !text.includes('PRIVATE KEY')) {
        setError('올바른 PEM 개인키 파일이 아닙니다.')
        return
      }
      setValues(prev => ({ ...prev, GITHUB_APP_PRIVATE_KEY: text }))
      setOauthNotice({ ok: true, text: `개인키 파일(${file.name})이 입력되었습니다.` })
    }
    reader.readAsText(file)
  }

  const handleDisconnect = async () => {
    if (isBusyCollecting) return
    const confirmed = window.confirm(
      `정말 ${name} 연동을 해제하시겠습니까?\nSaaS 서버에 발급된 OAuth 토큰 폐기(또는 GitHub App 설치 제거)를 요청하고 등록된 모든 자격증명을 완전히 삭제합니다.`
    )
    if (!confirmed) return
    const keysToWipe: Record<string, string> = {}
    for (const group of groups) {
      for (const f of group.fields) keysToWipe[f.env] = ''
    }
    if (oauthSpec) {
      if (oauthSpec.refreshTokenEnv) keysToWipe[oauthSpec.refreshTokenEnv] = ''
      if (oauthSpec.clientIdEnv) keysToWipe[oauthSpec.clientIdEnv] = ''
      if (oauthSpec.clientSecretEnv) keysToWipe[oauthSpec.clientSecretEnv] = ''
    }
    if (provider === 'github') {
      keysToWipe.GITHUB_APP_INSTALLATION_ID = ''
      keysToWipe.GITHUB_APP_ENTERPRISE_INSTALLATION_ID = ''
      keysToWipe.GITHUB_ENTERPRISE = ''
      keysToWipe.GITHUB_APP_ID = ''
      keysToWipe.GITHUB_APP_PRIVATE_KEY = ''
      keysToWipe.GITHUB_COLLECTOR_REFRESH_TOKEN = ''
    }
    if (provider === 'okta') {
      keysToWipe.OKTA_API_TOKEN = ''
      keysToWipe.OKTA_COLLECTOR_REFRESH_TOKEN = ''
    }
    if (provider === 'gws') {
      keysToWipe.GWS_COLLECTOR_SA_KEY = ''
    }
    if (provider === 'slack') {
      keysToWipe.SLACK_COLLECTOR_BOT_TOKEN = ''
      keysToWipe.SLACK_COLLECTOR_USER_TOKEN = ''
      keysToWipe.SLACK_CONFIG_TOKEN = ''
      keysToWipe.SLACK_CONFIG_REFRESH_TOKEN = ''
      keysToWipe.SLACK_TEAM_ID = ''
      keysToWipe.SLACK_ENTERPRISE_ID = ''
    }
    if (provider === 'atlassian') {
      keysToWipe.ATLASSIAN_CLOUD_ID = ''
      keysToWipe.ATLASSIAN_ORG_ID = ''
      keysToWipe.ATLASSIAN_COLLECTOR_ORG_API_KEY = ''
      keysToWipe.ATLASSIAN_ORG_AUDIT_API_KEY = ''
    }

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disconnect: true, provider, values: keysToWipe }),
      })
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as StatusPayload & {
          disconnectOutcome?: {
            revoked?: string[]
            warnings?: string[]
            manualCleanup?: Array<{ label: string; url: string }>
          }
        }
        if (data?.configured) applyPayload(data)
        setChecked({})
        setCollectResult(null)
        setValues({})
        setSaKeyInfo(null)
        const revokedMsg = data?.disconnectOutcome?.revoked?.length
          ? ` (${data.disconnectOutcome.revoked.join(', ')})`
          : ''
        setOauthNotice({
          ok: true,
          text: `${name} 원격 토큰/설치 폐기 및 자격증명 삭제가 완료되었습니다${revokedMsg}.`,
          cleanupLinks: data?.disconnectOutcome?.manualCleanup,
        })
        load()
      }
    } catch {
      setError('로컬 서버에 연결하지 못했습니다.')
    }
  }

  const requiredGroups = groups?.filter(g => g.fields.some(f => !f.optional)) ?? []
  const manualReady =
    Boolean(groups) && (
      (provider === 'okta' && Boolean(status.OKTA_ORG_URL && (status.OKTA_API_TOKEN || (status.OKTA_COLLECTOR_CLIENT_ID && status.OKTA_COLLECTOR_KEY_ID && status.OKTA_COLLECTOR_PRIVATE_KEY)))) ||
      (provider === 'github' && Boolean(status.GITHUB_OWNER_TOKEN)) ||
      (provider === 'slack' && Boolean(status.SLACK_COLLECTOR_BOT_TOKEN || status.SLACK_COLLECTOR_USER_TOKEN)) ||
      (requiredGroups.length > 0 && requiredGroups.every(g => g.fields.filter(f => !f.optional).every(f => status[f.env])))
    )
  const oauthReady = Boolean(
    (provider === 'github' && (status.GITHUB_APP_INSTALLATION_ID || status.GITHUB_APP_ENTERPRISE_INSTALLATION_ID)) ||
    (provider === 'slack' && Boolean(status.SLACK_CLIENT_ID && (status.SLACK_COLLECTOR_USER_TOKEN || status.SLACK_COLLECTOR_BOT_TOKEN))) ||
    (oauthSpec &&
      status[oauthSpec.refreshTokenEnv] &&
      status[oauthSpec.clientIdEnv] &&
      (!oauthSpec.urlEnv || oauthSpec.urlOptional || status[oauthSpec.urlEnv]))
  )
  const ready = oauthReady || manualReady
  const isBusyCollecting = serverMeta.collecting || collecting

  useEffect(() => { onConnectionChange?.(provider, ready) }, [onConnectionChange, provider, ready])

  if (!ENABLED || !groups) return null

  const openModal = () => {
    const initial: Record<string, string> = {}
    for (const [k, v] of Object.entries(hints)) {
      if (v) {
        // urlOptional인 경우(예: Slack Team ID), 이전 워크스페이스 값을 기본 입력하지 않아 동의 화면에서 샌드박스 등 새 워크스페이스를 선택할 수 있게 합니다.
        if (oauthSpec?.urlOptional && k === oauthSpec.urlEnv) continue
        initial[k] = v
      }
    }
    if (builtinApp && oauthSpec) {
      if (oauthSpec.urlEnv && !initial[oauthSpec.urlEnv]) {
        initial[oauthSpec.urlEnv] = builtinApp.orgUrl
      }
      if (!initial[oauthSpec.clientIdEnv]) {
        initial[oauthSpec.clientIdEnv] = builtinApp.clientId
      }
    }
    setValues(initial)
    setError(null)
    setOauthNotice(null)
    setCollectResult(null)
    setOpenGuide(null)
    setChecked({})
    setOpen(true)
  }

  const copyRedirectUri = (uri: string) => {
    void navigator.clipboard?.writeText(uri).then(() => {
      setCopiedUri(true)
      window.setTimeout(() => setCopiedUri(false), 1800)
    })
  }

  const startOAuth = async () => {
    if (!oauthSpec) return
    if (isBusyCollecting) {
      setError('수집 실행 중에는 자격증명을 바꿀 수 없습니다.')
      return
    }
    const useCustom = showCustomApp || !builtinApp
    const urlVal = oauthSpec.urlEnv ? ((values[oauthSpec.urlEnv] ?? '').trim() || builtinApp?.orgUrl) : undefined
    const clientIdVal = useCustom
      ? ((values[oauthSpec.clientIdEnv] ?? '').trim() || builtinApp?.clientId || '')
      : builtinApp.clientId
    const clientSecretVal = useCustom ? (values[oauthSpec.clientSecretEnv] ?? '').trim() : ''

    if (provider !== 'github' && oauthSpec.urlEnv && !oauthSpec.urlOptional && !urlVal && !status[oauthSpec.urlEnv]) {
      setError(`${oauthSpec.urlLabel} 값을 입력해 주세요.`)
      return
    }
    if (!clientIdVal && !status[oauthSpec.clientIdEnv]) {
      setShowCustomApp(true)
      setError(`아래 OAuth 앱 설정에서 ${oauthSpec.clientIdLabel} 값을 입력해 주세요.`)
      return
    }
    if (!oauthSpec.clientSecretOptional && !clientSecretVal && !status[oauthSpec.clientSecretEnv]) {
      setShowCustomApp(true)
      setError(`아래 OAuth 앱 설정에서 ${oauthSpec.clientSecretLabel} 값을 입력해 주세요.`)
      return
    }
    const chosenScopes = oauthSpec.scopes.filter(s => selectedScopes[s.scope]).map(s => s.scope)
    if (chosenScopes.length === 0) {
      setError('최소 1개 이상의 읽기 권한 범위(Scope)를 선택해 주세요.')
      return
    }

    setError(null)
    setOauthNotice(null)
    setOauthWaiting(true)
    setPopupUrl(null)
    const popup = window.open('about:blank', `aegi_oauth_${provider}`, 'width=640,height=760,noopener=no')
    try {
      const res = await fetch(OAUTH_START_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          orgUrl: urlVal || undefined,
          clientId: clientIdVal || undefined,
          clientSecret: clientSecretVal || undefined,
          scopes: chosenScopes,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.authorizeUrl) {
        if (popup && !popup.closed) popup.close()
        setOauthWaiting(false)
        setError(body.detail || body.error || `OAuth 시작 실패 (HTTP ${res.status})`)
        return
      }
      setPopupUrl(body.authorizeUrl)
      if (popup && !popup.closed) {
        popup.location.href = body.authorizeUrl
      } else {
        window.open(body.authorizeUrl, `aegi_oauth_${provider}`, 'width=640,height=760,noopener=no')
      }
    } catch {
      if (popup && !popup.closed) popup.close()
      setOauthWaiting(false)
      setError('로컬 서버에 연결하지 못했습니다.')
    }
  }

  const submitManual = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isBusyCollecting) {
      setError('수집 실행 중에는 자격증명을 바꿀 수 없습니다.')
      return
    }

    // 선행 절차 검증 및 Focus 처리
    if (provider === 'okta') {
      const orgUrl = (values.OKTA_ORG_URL ?? hints.OKTA_ORG_URL ?? '').trim()
      if (!orgUrl && !status.OKTA_ORG_URL) {
        focusField('OKTA_ORG_URL', '1단계: Okta 조직 주소(https://조직.okta.com)를 먼저 입력해야 합니다.')
        return
      }
      const apiToken = (values.OKTA_API_TOKEN ?? hints.OKTA_API_TOKEN ?? '').trim()
      if (!apiToken && !status.OKTA_API_TOKEN) {
        focusField('OKTA_API_TOKEN', '2단계: 발급받은 API 토큰(Token Value)을 입력해야 합니다.')
        return
      }
    } else if (provider === 'github' && tab === 'manual') {
      const pat = (values.GITHUB_OWNER_TOKEN ?? hints.GITHUB_OWNER_TOKEN ?? '').trim()
      if (!pat && !status.GITHUB_OWNER_TOKEN) {
        focusField('GITHUB_OWNER_TOKEN', '1단계: Personal Access Token을 먼저 입력해야 합니다.')
        return
      }
    } else if (provider === 'slack' && tab === 'manual') {
      const botToken = (values.SLACK_COLLECTOR_BOT_TOKEN ?? hints.SLACK_COLLECTOR_BOT_TOKEN ?? '').trim()
      const hasConfigToken = Boolean((values.SLACK_CONFIG_TOKEN ?? '').trim() || (values.SLACK_CONFIG_REFRESH_TOKEN ?? '').trim())
      if (!botToken && !status.SLACK_COLLECTOR_BOT_TOKEN && !hasConfigToken) {
        focusField('SLACK_COLLECTOR_BOT_TOKEN', '1단계: Bot Token(xoxb-)을 먼저 입력해야 합니다.')
        return
      }
    }

    const updates: Record<string, string> = {}
    for (const [k, v] of Object.entries(values)) {
      if (v.trim()) updates[k] = v.trim()
    }

    // GitHub PAT인 경우 조직 자동 지정
    if (provider === 'github' && tab === 'manual') {
      if (!updates.GITHUB_ORG && !status.GITHUB_ORG && githubOrgs.length > 0) {
        const all = githubOrgs.map(o => o.login).join(',')
        updates.GITHUB_ORG = all
        updates.GITHUB_ORGS = all
      }
    }

    const hasManualScopeSelector = provider === 'gws' || provider === 'slack' || provider === 'github'
    const scopeEnv = SCOPE_ENV_BY_PROVIDER[provider]
    if (hasManualScopeSelector && scopeEnv && oauthSpec) {
      const items = provider === 'gws' && tab === 'manual' ? [...oauthSpec.scopes, ...GWS_DWD_EXTRA_SCOPES] : oauthSpec.scopes
      const chosen = items
        .filter(s => Boolean(selectedScopes[s.scope]))
        .map(s => s.scope)
      if (chosen.length > 0) {
        updates[scopeEnv] = chosen.join(provider === 'gws' ? ' ' : ',')
      }
    }
    await saveCredentialUpdates(updates)
  }

  /** 입력한 환경변수 맵을 로컬 서버(/__aegi/credentials)에 저장하고 UI 상태를 갱신한다. */
  const saveCredentialUpdates = async (updates: Record<string, string>) => {
    if (Object.keys(updates).length === 0) {
      setError('입력한 항목이 없습니다.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: updates }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.detail || body.error || `저장하지 못했습니다 (HTTP ${res.status}).`)
        return
      }
      setValues({})
      if (body.configured) applyPayload(body as StatusPayload)
      if (SCOPE_ENV_BY_PROVIDER[provider] && SCOPE_ENV_BY_PROVIDER[provider]! in updates) {
        setScopesDirty(false)
      }
      setOauthNotice({ ok: true, text: '자격증명이 저장되었습니다.' })
      if (provider === 'github') {
        const savedToken = updates.GITHUB_OWNER_TOKEN || hints.GITHUB_OWNER_TOKEN
        void loadGithubOrgs(savedToken)
      }
    } catch {
      setError('로컬 서버에 연결하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const checkGroup = async (group: GroupSpec) => {
    // 선행 검증
    if (provider === 'okta') {
      const orgUrl = (values.OKTA_ORG_URL ?? hints.OKTA_ORG_URL ?? '').trim()
      if (!orgUrl && !status.OKTA_ORG_URL) {
        focusField('OKTA_ORG_URL', '1단계: Okta 조직 주소(https://조직.okta.com)를 먼저 입력해야 합니다.')
        return
      }
    } else if (group.id === 'CRED-GH-02') {
      const pat = (values.GITHUB_OWNER_TOKEN ?? hints.GITHUB_OWNER_TOKEN ?? '').trim()
      if (!pat && !status.GITHUB_OWNER_TOKEN) {
        focusField('GITHUB_OWNER_TOKEN', '1단계: Personal Access Token을 먼저 입력해야 합니다.')
        return
      }
    }

    setChecking(group.id)
    setError(null)
    const draft: Record<string, string> = {}
    for (const f of group.fields) {
      if (values[f.env]?.trim()) draft[f.env] = values[f.env].trim()
    }
    if (provider === 'github') {
      if (values.GITHUB_ORG?.trim()) draft.GITHUB_ORG = values.GITHUB_ORG.trim()
      if (values.GITHUB_ORGS?.trim()) draft.GITHUB_ORGS = values.GITHUB_ORGS.trim()
      if (values.GITHUB_ENTERPRISE?.trim()) draft.GITHUB_ENTERPRISE = values.GITHUB_ENTERPRISE.trim()
    }
    try {
      const res = await fetch(TEST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: group.id, mode: 'manual', values: draft }),
      })
      const body = (await res.json()) as CheckResult
      setChecked(prev => ({ ...prev, [group.id]: body }))
      setOauthNotice({ ok: body.ok, text: body.detail, ssoUrl: body.ssoUrl, org: body.org })
      if (body.ok && group.id === 'CRED-AT-ORG-02') {
        if (body.orgId) {
          setValues(prev => ({ ...prev, ATLASSIAN_ORG_ID: body.orgId! }))
        }
        if (Array.isArray(body.sites) && body.sites.length > 0) {
          setAtlassianSites(body.sites)
          const allUrls = body.sites.map(s => s.url).join(',')
          const curSite = (values.ATLASSIAN_SITE_URL || '').trim()
          const looksBroken = !curSite || !/^https:\/\/[^/]+\.atlassian\.net$/i.test(curSite)
          if (body.sites.length === 1 || looksBroken) {
            setValues(prev => ({
              ...prev,
              ATLASSIAN_SITE_URL: body.sites![0]!.url,
              ATLASSIAN_SITE_URLS: allUrls,
            }))
          }
        }
      }
      if (body.ok && (group.id === 'CRED-AT-ORG-02' || group.id === 'CRED-AT-01' || group.id === 'CRED-GW-01')) {
        if (group.id === 'CRED-AT-ORG-02') {
          setValues(prev => {
            const next = { ...prev }
            delete next.ATLASSIAN_ORG_AUDIT_API_KEY
            return next
          })
        } else if (group.id === 'CRED-AT-01') {
          setValues(prev => {
            const next = { ...prev }
            delete next.ATLASSIAN_COLLECTOR_API_TOKEN
            return next
          })
        }
        load()
      }
    } catch {
      const fail = { ok: false, detail: '로컬 서버에 연결하지 못했습니다.' }
      setChecked(prev => ({ ...prev, [group.id]: fail }))
      setOauthNotice({ ok: false, text: fail.detail })
    } finally {
      setChecking(null)
    }
  }

  /** 특정 단계(그룹)에 입력한 값만 즉시 저장한다. */
  const saveGroup = async (group: GroupSpec) => {
    if (isBusyCollecting) {
      setError('수집 실행 중에는 자격증명을 바꿀 수 없습니다.')
      return
    }
    const updates: Record<string, string> = {}
    for (const f of group.fields) {
      if (values[f.env]?.trim()) updates[f.env] = values[f.env].trim()
    }
    if (group.id === 'CRED-AT-01' && values.ATLASSIAN_SITE_URLS?.trim()) {
      updates.ATLASSIAN_SITE_URLS = values.ATLASSIAN_SITE_URLS.trim()
    }
    const scopeEnv = SCOPE_ENV_BY_PROVIDER[provider]
    const hasManualScopeSelector = provider === 'gws' || provider === 'slack' || provider === 'github'
    if (hasManualScopeSelector && scopeEnv && oauthSpec) {
      const items = provider === 'gws' ? [...oauthSpec.scopes, ...GWS_DWD_EXTRA_SCOPES] : oauthSpec.scopes
      const chosen = items
        .filter(s => Boolean(selectedScopes[s.scope]))
        .map(s => s.scope)
      if (chosen.length > 0) {
        const nextScopes = chosen.join(provider === 'gws' ? ' ' : ',')
        if (Object.keys(updates).length > 0 || scopesDirty || nextScopes !== (hints[scopeEnv] ?? '').trim()) {
          updates[scopeEnv] = nextScopes
        }
      }
    }
    if (Object.keys(updates).length === 0) {
      setError('이 단계에서 새로 입력한 항목이 없습니다.')
      return
    }
    await saveCredentialUpdates(updates)
  }

  const resolvePrimaryGroup = (mode: 'oauth' | 'manual'): GroupSpec | undefined => {
    if (!groups?.length) return undefined
    if (provider === 'atlassian') {
      return groups.find(g => g.id === 'CRED-AT-01') ?? groups[0]
    }
    if (provider === 'github') {
      if (mode === 'oauth') {
        return groups.find(g => g.id === 'CRED-GH-01') ?? groups[0]
      }
      return groups.find(g => g.id === 'CRED-GH-02') ?? groups.find(g => g.id !== 'CRED-GH-00') ?? groups[0]
    }
    if (provider === 'slack') {
      const hasUser = Boolean(values.SLACK_COLLECTOR_USER_TOKEN?.trim() || status.SLACK_COLLECTOR_USER_TOKEN)
      const hasBot = Boolean(values.SLACK_COLLECTOR_BOT_TOKEN?.trim() || status.SLACK_COLLECTOR_BOT_TOKEN)
      if (hasUser && !hasBot) {
        return groups.find(g => g.id === 'CRED-SL-01') ?? groups[0]
      }
      return groups.find(g => g.id === 'CRED-SL-02') ?? groups[0]
    }
    return groups.find(g => g.id !== 'CRED-GH-00') ?? groups[0]
  }

  const checkOAuthConnection = async () => {
    const credId = resolvePrimaryGroup('oauth')?.id
    if (!credId) return
    setChecking(credId)
    setError(null)
    try {
      const res = await fetch(TEST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: credId, mode: 'oauth', values }),
      })
      const body = (await res.json()) as CheckResult
      setChecked(prev => ({
        ...prev,
        [credId]: body,
      }))
      setOauthNotice({ ok: body.ok, text: body.detail, ssoUrl: body.ssoUrl, org: body.org })
      if (body.ok) load()
    } catch {
      const fail = { ok: false, detail: '로컬 서버에 연결하지 못했습니다.' }
      setChecked(prev => ({ ...prev, [credId]: fail }))
      setOauthNotice({ ok: false, text: fail.detail })
    } finally {
      setChecking(null)
    }
  }

  const runProviderCollect = async () => {
    if (isBusyCollecting) return
    if (onStartCollect) {
      setOpen(false)
      onStartCollect(provider)
      return
    }
    setCollecting(true)
    setCollectProgress('1/4 수집 시작 중…')
    collectJobRef.current = null
    setCollectResult(null)
    setError(null)
    try {
      const res = await fetch(COLLECT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || (res.status !== 202 && !body.ok)) {
        setCollecting(false)
        setCollectProgress(null)
        setCollectResult({
          ok: false,
          text: body.detail || body.error || `수집 실행 실패 (HTTP ${res.status})`,
        })
      } else {
        collectJobRef.current = typeof body.jobId === 'string' ? body.jobId : null
      }
    } catch {
      setCollecting(false)
      setCollectProgress(null)
      setCollectResult({ ok: false, text: '로컬 서버에 연결하지 못했습니다.' })
    }
  }

  const saveScopesToEnv = async () => {
    if (!oauthSpec) return
    const scopeEnv = SCOPE_ENV_BY_PROVIDER[provider]
    if (!scopeEnv) return
    const isDwd = provider === 'gws' && tab === 'manual'
    const items = isDwd ? [...oauthSpec.scopes, ...GWS_DWD_EXTRA_SCOPES] : oauthSpec.scopes
      const chosen = items
        .filter(s => Boolean(selectedScopes[s.scope]))
        .map(s => s.scope)
      if (chosen.length === 0) {
        setError('최소 1개 이상의 수집 권한 범위를 선택해 주세요.')
        return
      }
      setSaving(true)
      setError(null)
      try {
        const sep = provider === 'okta' || provider === 'gws' || provider === 'atlassian' ? ' ' : ','
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: { [scopeEnv]: chosen.join(sep) } }),
        })
        const body = await res.json().catch(() => ({}))
        if (res.ok) {
          if (body.configured) applyPayload(body as StatusPayload)
          setScopesDirty(false)
          setOauthNotice({ ok: true, text: `수집 권한 범위(${chosen.length}개)가 .env(${scopeEnv})에 저장되었습니다.` })
        } else {
          setError(body.detail || body.error || '권한 범위를 저장하지 못했습니다.')
        }
      } catch {
        setError('로컬 서버에 연결하지 못했습니다.')
      } finally {
        setSaving(false)
      }
    }

  const renderScopeSelector = () => {
    if (!oauthSpec) return null
    const isDwd = provider === 'gws' && tab === 'manual'
    const items = isDwd ? [...oauthSpec.scopes, ...GWS_DWD_EXTRA_SCOPES] : oauthSpec.scopes
    const selectedCount = items.filter(s => Boolean(selectedScopes[s.scope])).length
    const scopeEnv = SCOPE_ENV_BY_PROVIDER[provider]
    return (
      <fieldset className="sc-group" style={{ marginTop: '8px' }}>
        <div className="sc-redirect-box" style={{ background: '#f8fafc', margin: 0 }}>
          <div>
            <strong>
              수집 권한 범위 ({selectedCount}/{items.length}{isDwd ? ' · DWD' : ''})
            </strong>
            {scopesDirty && scopeEnv && (
              <span className="sc-subtext" style={{ marginLeft: '8px', color: '#b45309', fontWeight: 600 }}>
                · 미저장 변경
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button type="button" className="ex-btn" onClick={() => setShowScopes(s => !s)}>
              {showScopes ? '권한 목록 접기 ▲' : '권한 선택 / 수정 ▾'}
            </button>
            {scopeEnv && (
              <button
                type="button"
                className={`ex-btn ${scopesDirty ? 'primary' : ''}`}
                disabled={saving || isBusyCollecting}
                onClick={() => void saveScopesToEnv()}
              >
                {scopesDirty ? '권한 범위 저장 (.env 반영)' : '권한 범위 저장'}
              </button>
            )}
          </div>
        </div>
        {showScopes && (
          <div style={{ marginTop: '8px' }}>
            <div className="sc-scope-actions">
              {provider === 'slack' && (
                <>
                  <button
                    type="button"
                    className="ex-btn"
                    disabled={isBusyCollecting}
                    onClick={() => {
                      setSelectedScopes(prev => ({
                        ...prev,
                        ...Object.fromEntries(items.map(s => [s.scope, !SLACK_ENTERPRISE_SET.has(s.scope)])),
                      }))
                      setScopesDirty(true)
                    }}
                  >
                    일반 워크스페이스 (12개)
                  </button>
                  <button
                    type="button"
                    className="ex-btn"
                    disabled={isBusyCollecting}
                    onClick={() => {
                      setSelectedScopes(prev => ({
                        ...prev,
                        ...Object.fromEntries(items.map(s => [s.scope, true])),
                      }))
                      setScopesDirty(true)
                    }}
                  >
                    Enterprise Grid (22개)
                  </button>
                </>
              )}
              <button
                type="button"
                className="ex-btn"
                disabled={isBusyCollecting}
                onClick={() => {
                  setSelectedScopes(prev => ({ ...prev, ...Object.fromEntries(items.map(s => [s.scope, true])) }))
                  setScopesDirty(true)
                }}
              >
                전체 선택
              </button>
              <button
                type="button"
                className="ex-btn"
                disabled={isBusyCollecting}
                onClick={() => {
                  setSelectedScopes(prev => ({ ...prev, ...Object.fromEntries(items.map(s => [s.scope, false])) }))
                  setScopesDirty(true)
                }}
              >
                전체 해제
              </button>
              <button
                type="button"
                className="ex-btn"
                disabled={isBusyCollecting}
                onClick={() => {
                  setSelectedScopes(prev => ({
                    ...prev,
                    ...Object.fromEntries(
                      items.map(s => [
                        s.scope,
                        (isDwd && GWS_DWD_EXTRA_SET.has(s.scope)) ||
                          (builtinApp ? builtinApp.scopes.includes(s.scope) : true),
                      ]),
                    ),
                  }))
                  setScopesDirty(true)
                }}
              >
                기본 권한 복원
              </button>
            </div>
            <div className="sc-scope-list">
              {items.map(item => (
                <label key={item.scope} className="sc-scope-item">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedScopes[item.scope])}
                    disabled={isBusyCollecting}
                    onChange={e => {
                      setSelectedScopes(prev => ({ ...prev, [item.scope]: e.target.checked }))
                      setScopesDirty(true)
                    }}
                  />
                  <code>{item.scope.replace('https://www.googleapis.com/auth/', '')}</code>
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </fieldset>
    )
  }

  const renderField = (field: FieldSpec) => {
    const isSet = Boolean(status[field.env])
    const guide = CREDENTIAL_GUIDES[field.env]
    const guideOpen = openGuide === field.env
    const Input = field.multiline ? 'textarea' : 'input'
    const isSecretSingleLine = Boolean(field.secret && !field.multiline)
    const revealed = Boolean(revealedSecrets[field.env])
    const oktaRaw = field.env === 'OKTA_ORG_URL' ? (values.OKTA_ORG_URL ?? '').trim() : ''
    const oktaBad =
      Boolean(oktaRaw) &&
      (oktaRaw.includes('-admin.') || !/^https:\/\/[^/\s]+\.(okta|oktapreview|okta-emea)\.com\/?$/i.test(oktaRaw))

    return (
      <div key={field.env} className="sc-field">
        <div className="sc-field-head">
          <label htmlFor={`sc-${field.env}`}>{field.label}</label>
          {guide && (
            <button
              type="button"
              className="sc-help"
              title={guide.summary}
              aria-label={`${field.label} 발급 방법`}
              aria-expanded={guideOpen}
              onClick={() => setOpenGuide(guideOpen ? null : field.env)}
            >
              <CircleHelp size={14} aria-hidden="true" />
            </button>
          )}
          <code>{field.env}{isSet ? ' (설정됨)' : field.optional ? ' (선택)' : ''}</code>
          {isSecretSingleLine && (
            <button
              type="button"
              className="ex-btn"
              style={{ marginLeft: 'auto', padding: '1px 7px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              onClick={() => setRevealedSecrets(prev => ({ ...prev, [field.env]: !prev[field.env] }))}
            >
              {revealed ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
              <span>{revealed ? '숨김' : '보기'}</span>
            </button>
          )}
          {field.env === 'GITHUB_APP_PRIVATE_KEY' && (
            <>
              <input
                ref={pemInputRef}
                type="file"
                accept=".pem,.key,text/plain"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) handlePemFile(f)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="ex-btn"
                disabled={isBusyCollecting}
                style={{ marginLeft: 'auto', padding: '1px 7px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                onClick={() => pemInputRef.current?.click()}
              >
                <Upload size={12} aria-hidden="true" />
                <span>.pem 파일</span>
              </button>
            </>
          )}
        </div>
        {guide && guideOpen && (
          <div className="sc-guide" role="region" aria-label={`${field.label} 발급 안내`}>
            <p>{guide.summary}</p>
            {guide.steps.length > 0 && <ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol>}
            {guide.notes && guide.notes.length > 0 && <ul>{guide.notes.map(note => <li key={note}>{note}</li>)}</ul>}
            {guide.sources.length > 0 && (
              <p className="sc-guide-src">
                발급·공식 문서:{' '}
                {guide.sources.map((s, i) => (
                  <span key={s.url}>
                    {i > 0 && ', '}
                    <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
        <Input
          id={`sc-${field.env}`}
          className="ex-input"
          rows={field.multiline ? 3 : undefined}
          type={!field.multiline && field.secret ? (revealed ? 'text' : 'password') : undefined}
          autoComplete="off"
          disabled={isBusyCollecting}
          placeholder={isSet ? '저장됨 (바꾸려면 새 값 입력)' : field.placeholder}
          value={values[field.env] ?? ''}
          onChange={e => setValues(prev => ({ ...prev, [field.env]: e.target.value }))}
          onDragOver={field.env === 'GITHUB_APP_PRIVATE_KEY' ? e => e.preventDefault() : undefined}
          onDrop={
            field.env === 'GITHUB_APP_PRIVATE_KEY'
              ? e => {
                  e.preventDefault()
                  const f = e.dataTransfer.files?.[0]
                  if (f) handlePemFile(f)
                }
              : undefined
          }
        />
        {oktaBad && (
          <div className="sc-subtext" style={{ color: '#b45309', marginTop: '3px', fontSize: '11px' }}>
            예: <code>https://company.okta.com</code> (-admin 제외, https:// 포함)
          </div>
        )}
      </div>
    )
  }

  const effectiveCheckMode: 'oauth' | 'manual' = oauthSpec && (tab === 'oauth' || (!manualReady && oauthReady)) ? 'oauth' : 'manual'
  const primaryCredId = resolvePrimaryGroup(effectiveCheckMode)?.id || groups[0]?.id || ''
  const oauthCheckResult = checked[primaryCredId]

  const stateLabel = provider === 'okta'
    ? (manualReady ? 'API 토큰 설정됨' : oauthReady ? 'OAuth 연결됨' : '연결 안 됨')
    : provider === 'github'
    ? (oauthReady ? 'GitHub App 설치됨' : manualReady ? (status.GITHUB_OWNER_TOKEN ? 'PAT 설정됨' : '키 설정됨') : '연결 안 됨')
    : provider === 'gws'
    ? (manualReady ? '서비스 계정(DWD) 설정됨' : oauthReady ? 'OAuth 연결됨' : '연결 안 됨')
    : provider === 'onepassword'
    ? (manualReady ? (serverMeta.opCli?.installed === false ? '토큰 설정됨 · op CLI 없음' : '토큰 설정됨') : (serverMeta.opCli?.installed === false ? 'op CLI 미설치' : '연결 안 됨'))
    : provider === 'snowflake'
    ? (manualReady ? '키 저장됨 (수집기 대기)' : '수집기 머지 대기')
    : (oauthReady ? 'OAuth 연결됨' : manualReady ? '키 설정됨' : '연결 안 됨')

  return (
    <div className="sc-row">
      <span className={`sc-state ${ready ? 'is-ok' : ''}`}>
        {stateLabel}
      </span>
      <button type="button" className={`ex-btn ${ready ? '' : 'primary'}`} onClick={openModal}>
        {ready ? '연결 관리' : '연결'}
      </button>
      <dialog ref={dialogRef} className="sc-dialog" onClose={() => setOpen(false)}>
        <header>
          <div>
            <h2>{name} 연결 ({ready ? stateLabel : '미연결'})</h2>

          </div>
          <button type="button" className="ex-btn" onClick={() => setOpen(false)}>닫기</button>
        </header>
        <div className={`sc-hero-banner ${ready ? 'is-connected' : 'is-disconnected'}`}>
          <div className="sc-hero-banner-main">
            <div className="sc-hero-status-pill">
              <span className="sc-hero-dot" />
              <strong>{ready ? '연동 활성화됨' : '미연동 상태'}</strong>
            </div>
            <div className="sc-hero-desc">
              {ready ? (
                provider === 'github'
                  ? (status.GITHUB_OWNER_TOKEN
                      ? `GitHub PAT 등록됨${hints.GITHUB_ORG ? ` (조직: ${hints.GITHUB_ORG})` : ''}`
                      : `GitHub App 설치됨 (설치 ID: ${status.GITHUB_APP_INSTALLATION_ID || '등록됨'}${hints.GITHUB_ORG ? `, 조직: ${hints.GITHUB_ORG}` : ''})`)
                  : provider === 'okta'
                    ? (status.OKTA_API_TOKEN ? `Okta SSWS API 토큰 등록됨 (${hints.OKTA_ORG_URL || ''})` : `Okta OAuth 연결됨 (${hints.OKTA_ORG_URL || ''})`)
                    : provider === 'gws'
                      ? (status.GWS_COLLECTOR_SA_KEY ? `서비스 계정 DWD 등록됨 (${hints.GWS_ADMIN_SUBJECT || '관리자 위임'})` : 'Google Workspace OAuth 연결됨')
                      : `${name} 연동 자격증명이 등록되어 있습니다.`
              ) : (
                provider === 'onepassword' && serverMeta.opCli?.installed === false
                  ? '로컬 PC에 1Password CLI(op)가 설치되어 있지 않습니다. 수집 전 op CLI를 설치해 주세요 (Windows: winget install AgileBits.1Password.CLI / macOS: brew install 1password-cli).'
                  : provider === 'snowflake'
                    ? 'Snowflake 수집기는 엔진 main 머지 대기 중입니다. 계정·서비스 사용자·RSA 개인키 입력 및 저장은 미리 가능합니다.'
                    : '권장 방식을 선택해 연결한 뒤 [연결 점검]으로 확인하세요.'
              )}
            </div>
          </div>
          {ready && (
            <div className="sc-hero-banner-actions">
              <button
                type="button"
                className="ex-btn"
                disabled={checking !== null || isBusyCollecting}
                onClick={() => {
                  if (effectiveCheckMode === 'oauth') {
                    void checkOAuthConnection()
                  } else {
                    const g = resolvePrimaryGroup('manual')
                    if (g) void checkGroup(g)
                  }
                }}
              >
                {checking !== null ? '점검 중…' : '연결 점검'}
              </button>
              <button
                type="button"
                className="ex-btn sc-disconnect-btn"
                disabled={isBusyCollecting}
                onClick={() => void handleDisconnect()}
                title="이 SaaS의 모든 자격증명과 연결을 해제합니다"
              >
                연결 해제
              </button>
            </div>
          )}
        </div>

        {PROVIDER_REQUIRED_ACCOUNTS[provider] && (
          <div className="sc-account-role-box">
            <div className="sc-account-role-icon">
              <ShieldCheck size={18} />
            </div>
            <div className="sc-account-role-content">
              <div className="sc-account-role-title-row">
                <span className="sc-account-role-label">필요 연결 계정 권한:</span>
                <span className="sc-account-role-badge">
                  {PROVIDER_REQUIRED_ACCOUNTS[provider].role}
                </span>
              </div>
              <p className="sc-account-role-desc">
                {PROVIDER_REQUIRED_ACCOUNTS[provider].reason}
              </p>
              {PROVIDER_REQUIRED_ACCOUNTS[provider].warning && (
                <p className="sc-account-role-warning">
                  ⚠️ {PROVIDER_REQUIRED_ACCOUNTS[provider].warning}
                </p>
              )}
            </div>
          </div>
        )}



        {serverMeta.portWarning && (
          <div className="sc-banner is-warn" role="alert">
            <strong>포트 변경 감지:</strong> {serverMeta.portWarning}
          </div>
        )}

        {oauthNotice?.ssoUrl && (
          <div
            className="sc-banner is-bad"
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
              padding: '12px 16px',
              marginBottom: '16px',
              background: '#fef2f2',
              border: '1px solid #f87171',
              borderRadius: '6px',
            }}
          >
            <span style={{ fontWeight: 600, color: '#991b1b', fontSize: 'var(--font-size-sm)' }}>
              ⚠️ {oauthNotice.text}
            </span>
            <a
              href={oauthNotice.ssoUrl}
              target="_blank"
              rel="noreferrer"
              className="ex-btn primary"
              style={{
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                background: '#dc2626',
                color: '#ffffff',
                padding: '6px 14px',
                borderRadius: '4px',
                fontWeight: 600,
                fontSize: 'var(--font-size-sm)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
              }}
            >
              🔑 {oauthNotice.org || 'GitHub'} SAML SSO 1회 승인 ↗
            </a>
          </div>
        )}

        {isBusyCollecting && (
          <div className="sc-banner is-warn" role="status">
            <strong>수집 실행 중:</strong> 수집 실행 중에는 자격증명을 바꿀 수 없습니다. 수집이 끝난 뒤 다시 시도하세요.
          </div>
        )}

        {oauthSpec && (
          <div className="sc-tabs" role="tablist" aria-label="연결 방식 선택">
            {provider === 'okta' ? (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'manual'}
                  className={`sc-tab ${tab === 'manual' ? 'is-active' : ''}`}
                  onClick={() => { setTab('manual'); setError(null) }}
                >
                  API 토큰 (권장)
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'oauth'}
                  className={`sc-tab ${tab === 'oauth' ? 'is-active' : ''}`}
                  onClick={() => { setTab('oauth'); setError(null) }}
                >
                  OAuth
                </button>
              </>
            ) : provider === 'github' ? (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'manual'}
                  className={`sc-tab ${tab === 'manual' ? 'is-active' : ''}`}
                  onClick={() => { setTab('manual'); setError(null) }}
                >
                  PAT
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'oauth'}
                  className={`sc-tab ${tab === 'oauth' ? 'is-active' : ''}`}
                  onClick={() => { setTab('oauth'); setError(null) }}
                >
                  GitHub App (권장)
                </button>
              </>
            ) : provider === 'gws' ? (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'manual'}
                  className={`sc-tab ${tab === 'manual' ? 'is-active' : ''}`}
                  onClick={() => { setTab('manual'); setError(null) }}
                >
                  서비스 계정 DWD (권장)
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'oauth'}
                  className={`sc-tab ${tab === 'oauth' ? 'is-active' : ''}`}
                  onClick={() => { setTab('oauth'); setError(null) }}
                >
                  OAuth
                </button>
              </>
            ) : provider === 'atlassian' ? (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'manual'}
                  className={`sc-tab ${tab === 'manual' ? 'is-active' : ''}`}
                  onClick={() => { setTab('manual'); setError(null) }}
                >
                  API 토큰 (권장)
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'oauth'}
                  className={`sc-tab ${tab === 'oauth' ? 'is-active' : ''}`}
                  onClick={() => { setTab('oauth'); setError(null) }}
                >
                  OAuth
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'oauth'}
                  className={`sc-tab ${tab === 'oauth' ? 'is-active' : ''}`}
                  onClick={() => { setTab('oauth'); setError(null) }}
                >
                  OAuth (권장)
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'manual'}
                  className={`sc-tab ${tab === 'manual' ? 'is-active' : ''}`}
                  onClick={() => { setTab('manual'); setError(null) }}
                >
                  {provider === 'salesforce' ? 'Connected App' : '직접 입력'}
                </button>
              </>
            )}
          </div>
        )}

        {oauthSpec && tab === 'oauth' ? (
          <div className="sc-oauth-pane">
            {provider === 'github' ? (
              <div className="sc-guide-card">
                <div className="sc-guide-card-head">
                  <strong className="sc-guide-card-title">
                    GitHub App 연동
                  </strong>
                  <span className={`sc-guide-card-badge ${configured.GITHUB_APP_PRIVATE_KEY && configured.GITHUB_APP_ID ? 'is-green' : ''}`}>
                    {configured.GITHUB_APP_PRIVATE_KEY && configured.GITHUB_APP_ID ? '등록됨 ✓' : '100% 읽기 전용'}
                  </span>
                </div>
                <ol style={{ margin: '8px 0 10px 18px', padding: 0, fontSize: 'var(--font-size-xs)', lineHeight: 1.6 }}>
                  <li><strong>[새 GitHub App 생성 (Manifest)]</strong>으로 앱·PEM 생성 (또는 기존 PEM 붙여넣고 저장)</li>
                  <li><strong>[GitHub App 설치]</strong> 클릭 후 수집 대상 조직에 <strong>Install</strong></li>
                  <li>아래 감지된 조직 확인 후 <strong>[설정 저장]</strong></li>
                </ol>
                <div className="sc-subtext" style={{ margin: '0 0 8px', fontSize: 'var(--font-size-xs)', lineHeight: 1.5 }}>
                  <div>• <strong>권한 안내:</strong> 일부 읽기 API(조직 룰셋·Codespaces 비밀값·조직 보안 권고)는 GitHub 스펙상 쓰기 권한(<code>write</code>)을 요구해 Manifest에 포함했으나, 수집기 전송 계층은 코드로 <code>GET</code> 조회만 허용합니다.</div>
                  <div>• <strong>기존 설치 앱 재승인:</strong> 이미 설치된 앱의 권한을 바꾼 경우, 조직 소유자가 <strong>Organization Settings → GitHub Apps → Configure → Accept new permissions</strong>에서 재승인해야 적용됩니다.</div>
                </div>

                <div style={{ marginTop: '10px', padding: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {(() => {
                      const targetOrg = (values.GITHUB_ORG || hints.GITHUB_ORG || '').trim()
                      const manifestAction = targetOrg
                        ? `https://github.com/organizations/${encodeURIComponent(targetOrg)}/settings/apps/new`
                        : 'https://github.com/settings/apps/new'
                      const manifestPayload = JSON.stringify({
                        name: targetOrg ? `aegi-collector-${targetOrg.toLowerCase().replace(/[^a-z0-9-]/g, '-')}` : 'aegi-collector-local',
                        url: 'http://127.0.0.1:5199',
                        description: 'AEGI 보안 진단 실측 수집기 (Read-only)',
                        public: false,
                        hook_attributes: { url: 'https://example.invalid/unused', active: false },
                        redirect_url: `http://127.0.0.1:${serverMeta.port}/__aegi/oauth/callback`,
                        setup_url: `http://127.0.0.1:${serverMeta.port}/__aegi/oauth/callback`,
                        default_permissions: {
                          metadata: 'read',
                          contents: 'read',
                          pull_requests: 'read',
                          administration: 'read',
                          actions: 'read',
                          actions_variables: 'read',
                          repository_hooks: 'read',
                          members: 'read',
                          organization_administration: 'write',
                          organization_custom_roles: 'read',
                          organization_personal_access_tokens: 'read',
                          organization_personal_access_token_requests: 'read',
                          organization_hooks: 'read',
                          organization_events: 'read',
                          organization_self_hosted_runners: 'read',
                          organization_custom_org_roles: 'read',
                          organization_custom_properties: 'read',
                          organization_actions_variables: 'read',
                          environments: 'read',
                          packages: 'read',
                          deployments: 'read',
                          secrets: 'read',
                          dependabot_secrets: 'read',
                          organization_secrets: 'read',
                          organization_dependabot_secrets: 'read',
                          organization_campaigns: 'read',
                          code_quality: 'read',
                          organization_code_scanning_dismissal_requests: 'read',
                          organization_dependabot_dismissal_requests: 'read',
                          organization_copilot_spaces: 'read',
                          organization_copilot_seat_management: 'read',
                          issue_fields: 'read',
                          issue_types: 'read',
                          organization_projects: 'read',
                          organization_private_registries: 'read',
                          organization_codespaces_secrets: 'read',
                          codespaces_secrets: 'write',
                          repository_advisories: 'write',
                          vulnerability_alerts: 'read',
                          security_events: 'read',
                        },
                        default_events: [],
                      })
                      return (
                        <form
                          action={manifestState ? `${manifestAction}?state=${encodeURIComponent(manifestState)}` : manifestAction}
                          method="post"
                          target="_blank"
                          style={{ margin: 0 }}
                          onSubmit={event => {
                            if (!manifestState) { event.preventDefault(); return }
                            window.setTimeout(() => { void refreshManifestState() }, 0)
                          }}
                        >
                          <input type="hidden" name="manifest" value={manifestPayload} />
                          <button type="submit" className="ex-btn primary" disabled={!manifestState}>
                            새 GitHub App 생성 (Manifest) ↗
                          </button>
                        </form>
                      )
                    })()}
                  </div>
                  <div className="sc-subtext" style={{ marginBottom: '6px' }}>
                    참고: SAML SSO가 켜진 조직 설치 중 <code>Overwrite your linked identity?</code> 화면이 나오면 멈추고 조직 관리자에게 기존 SAML 연결을 덮어써도 되는지 확인하세요.
                  </div>

                  {loadingGithubOrgs ? (
                    <div className="sc-subtext" style={{ marginBottom: '8px' }}>
                      설치된 대상 목록을 불러오는 중…
                    </div>
                  ) : githubOrgs.length > 0 ? (
                    <div style={{ marginBottom: '8px', padding: '6px', border: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: 'var(--font-size-xs)' }}>
                        감지된 설치 대상 (클릭 시 자동 선택):
                      </span>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                        {githubOrgs.map(org => {
                          const isEnterprise = org.targetType === 'Enterprise'
                          const isSelected = isEnterprise
                            ? (values.GITHUB_ENTERPRISE || hints.GITHUB_ENTERPRISE) === org.login
                            : (values.GITHUB_ORG || hints.GITHUB_ORG) === org.login
                          return (
                            <button
                              key={`${org.targetType}-${org.login}`}
                              type="button"
                              className={`ex-btn ${isSelected ? 'primary' : ''}`}
                              onClick={() => {
                                setValues(prev => ({
                                  ...prev,
                                  ...(isEnterprise
                                    ? {
                                        GITHUB_ENTERPRISE: org.login,
                                        ...(org.installationId ? { GITHUB_APP_ENTERPRISE_INSTALLATION_ID: org.installationId } : {}),
                                      }
                                    : {
                                        GITHUB_ORG: org.login,
                                        ...(org.installationId ? { GITHUB_APP_INSTALLATION_ID: org.installationId } : {}),
                                      }),
                                }))
                              }}
                            >
                              {org.login} ({isEnterprise ? '엔터프라이즈' : '조직'}) {isSelected ? '✓' : ''}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div style={{ display: 'grid', gap: '8px' }}>
                    {renderField({
                      env: 'GITHUB_ORG',
                      label: '수집 대상 조직 이름 (Organization slug)',
                      placeholder: '예: my-org (App 설치 시 자동 채움)',
                      optional: true,
                    })}
                    {renderField({
                      env: 'GITHUB_APP_PRIVATE_KEY',
                      label: 'GitHub App Private Key (PEM)',
                      placeholder: '-----BEGIN RSA PRIVATE KEY-----',
                      secret: true,
                      multiline: true,
                      optional: true,
                    })}
                  </div>
                </div>

                {/* 2. Enterprise 전사 감사 로그 (선택) */}
                <div style={{ marginTop: '12px', padding: '8px', border: '1px solid var(--border-color)' }}>
                  <div className="sc-guide-step-title">
                    <strong>2. 엔터프라이즈 전사 감사 로그 (선택)</strong>
                  </div>
                  <p style={{ margin: '4px 0 6px', fontSize: 'var(--font-size-xs)' }}>
                    전사 감사 로그(GH-19)·SAML(GH-20) 수집 시에만 입력
                  </p>
                  <fieldset className="sc-group" style={{ margin: 0, padding: 0, border: 'none', display: 'grid', gap: '8px' }}>
                    {renderField({
                      env: 'GITHUB_ENTERPRISE',
                      label: '엔터프라이즈 이름 (Enterprise slug)',
                      placeholder: '예: my-enterprise',
                      optional: true,
                    })}
                    {renderField({
                      env: 'GITHUB_OWNER_TOKEN',
                      label: '엔터프라이즈 소유자 Classic PAT (GITHUB_OWNER_TOKEN)',
                      placeholder: 'ghp_... (read:audit_log, read:enterprise, admin:org)',
                      optional: true,
                    })}
                  </fieldset>
                  <div style={{ marginTop: '6px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <a
                      href="https://github.com/settings/enterprises"
                      target="_blank"
                      rel="noreferrer"
                      className="sc-guide-link"
                    >
                      내 엔터프라이즈 목록 확인 ↗
                    </a>
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo,read:org,admin:org,admin:org_hook,read:user,user:email,read:packages,read:audit_log,read:enterprise&description=AEGI%20Collector"
                      target="_blank"
                      rel="noreferrer"
                      className="sc-guide-link"
                    >
                      소유자 PAT 1클릭 발급 ↗
                    </a>
                  </div>
                </div>
                <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="ex-btn primary"
                    disabled={saving || isBusyCollecting}
                    onClick={() => {
                      const updates: Record<string, string> = {}
                      for (const key of [
                        'GITHUB_ORG',
                        'GITHUB_APP_INSTALLATION_ID',
                        'GITHUB_APP_PRIVATE_KEY',
                        'GITHUB_ENTERPRISE',
                        'GITHUB_APP_ENTERPRISE_INSTALLATION_ID',
                        'GITHUB_OWNER_TOKEN',
                      ]) {
                        const v = (values[key] ?? '').trim()
                        if (v) updates[key] = v
                      }
                      void saveCredentialUpdates(updates)
                    }}
                  >
                    {saving ? '저장 중…' : '설정 저장'}
                  </button>
                </div>
              </div>
            ) : oauthSpec.urlEnv && (!oauthSpec.urlOptional || provider === 'salesforce') ? (
              <fieldset className="sc-group">
                {provider === 'salesforce' && (
                  <div className="sc-subtext" style={{ marginBottom: '8px', padding: '8px 10px', border: '1px solid var(--border-color)', borderRadius: '6px', lineHeight: 1.5 }}>
                    <div><strong>1단계 · AEGI Collector 패키지 설치 (조직당 최초 1회)</strong></div>
                    <div>
                      아래 설치 링크를 열어 대상 조직에 패키지를 설치한 뒤 2단계 <strong>[계정 연결]</strong>을 진행하세요. (Sandbox 조직은 <code>login.salesforce.com</code>을 <code>test.salesforce.com</code>으로 바꿔 접속)
                    </div>
                    <div style={{ marginTop: '4px' }}>
                      <a
                        href="https://login.salesforce.com/packaging/installPackage.apexp?p0=04taj000000rlATAAY"
                        target="_blank"
                        rel="noreferrer"
                        className="sc-guide-link"
                      >
                        Salesforce 패키지 설치 페이지 열기 ↗
                      </a>
                    </div>
                  </div>
                )}
                {renderField({
                  env: oauthSpec.urlEnv,
                  label: oauthSpec.urlLabel!,
                  placeholder: oauthSpec.urlPlaceholder!,
                  optional: Boolean(oauthSpec.urlOptional),
                })}
                {provider === 'okta' && (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '-2px' }}>
                    <a
                      href="https://login.okta.com"
                      target="_blank"
                      rel="noreferrer"
                      className="ex-btn"
                      style={{ textDecoration: 'none' }}
                    >
                      Okta 로그인 / 조직 찾기 ↗
                    </a>
                  </div>
                )}
              </fieldset>
            ) : (
              <div className="sc-redirect-box">
                <div>
                  <strong>{provider === 'gcp' ? '자체 GCP OAuth 클라이언트로 연결 (1순위)' : `${name} 계정으로 바로 연결`}</strong>
                  {provider === 'gcp' && (
                    <div className="sc-subtext" style={{ marginTop: '4px' }}>
                      내장 GCP OAuth 앱이 없습니다. 아래 [커스텀 OAuth 앱 설정]에서 직접 만든 GCP OAuth 2.0 Client ID(데스크톱 앱)와 <strong>Client Secret</strong>을 입력한 뒤 [계정 연결]을 누르세요. (Desktop 클라이언트는 토큰 교환에 Secret이 필수입니다. 만든 직후 화면에서 복사하고, 창을 닫아 놓쳤다면 클라이언트에서 새 보안 비밀번호를 추가하세요.)
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="sc-oauth-actions">
              <div className="sc-check">
                <span className={`sc-state ${oauthReady ? 'is-ok' : oauthWaiting ? 'is-wait' : ''}`}>
                  {oauthWaiting ? (
                    <>
                      브라우저 팝업에서 설치 또는 로그인을 완료해 주세요 (자동 감지 중)…
                      {popupUrl && (
                        <div style={{ marginTop: '6px' }}>
                          <a
                            href={popupUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="sc-guide-link"
                          >
                            팝업이 차단되었거나 안 열렸다면 여기를 클릭하여 직접 열기 ↗
                          </a>
                        </div>
                      )}
                    </>
                  ) : oauthReady
                    ? (provider === 'github'
                        ? `GitHub App 연결됨 (조직 ID: ${status.GITHUB_APP_INSTALLATION_ID || '등록됨'}${status.GITHUB_APP_ENTERPRISE_INSTALLATION_ID ? `, 엔터프라이즈 ID: ${status.GITHUB_APP_ENTERPRISE_INSTALLATION_ID}` : ''})`
                        : `OAuth 연결됨 (${oauthSpec.refreshTokenEnv})`)
                    : (provider === 'github'
                        ? '엔터프라이즈 또는 조직에 App을 설치하세요'
                        : builtinApp
                          ? '계정 로그인 및 권한 동의를 진행하세요'
                          : '계정 로그인 및 권한 동의를 진행하세요')}
                </span>
                <div className="sc-action-btns">
                  <button
                    type="button"
                    className="ex-btn primary"
                    disabled={isBusyCollecting}
                    onClick={() => void startOAuth()}
                  >
                    {provider === 'github'
                      ? (oauthReady ? 'GitHub App 다시 설치' : 'GitHub App 설치')
                      : (oauthReady ? '다시 연결' : '계정 연결')}
                  </button>
                  {oauthReady && (
                    <button
                      type="button"
                      className="ex-btn"
                      disabled={checking !== null || isBusyCollecting}
                      onClick={() => void checkOAuthConnection()}
                    >
                      {checking === primaryCredId ? '확인 중…' : '연결 확인'}
                    </button>
                  )}
                  {provider !== 'github' && (
                    <button
                      type="button"
                      className="ex-btn"
                      onClick={() => setShowCustomApp(s => !s)}
                    >
                      {showCustomApp ? '앱 설정 접기 ▲' : '커스텀 OAuth 앱 설정 (Client ID) ▾'}
                    </button>
                  )}
                </div>
              </div>
              {oauthCheckResult && (
                <p className={`sc-state ${oauthCheckResult.ok ? 'is-ok' : 'is-bad'}`}>
                  {oauthCheckResult.detail}
                </p>
              )}
            </div>

            {provider !== 'github' && renderScopeSelector()}

            {provider !== 'github' && showCustomApp && (
              <fieldset className="sc-group" style={{ marginTop: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <legend style={{ margin: 0 }}>커스텀 OAuth 앱 설정 (Client ID 직접 입력)</legend>
                  {builtinApp && (
                    <button
                      type="button"
                      className="ex-btn"
                      onClick={() => {
                        setValues(prev => ({
                          ...prev,
                          ...(oauthSpec.urlEnv ? { [oauthSpec.urlEnv]: builtinApp.orgUrl } : {}),
                          [oauthSpec.clientIdEnv]: builtinApp.clientId,
                        }))
                        const allowed = new Set(builtinApp.scopes)
                        setSelectedScopes(prev => ({
                          ...prev,
                          ...Object.fromEntries(oauthSpec.scopes.map(s => [s.scope, allowed.has(s.scope)])),
                        }))
                        setScopesDirty(true)
                        setError(null)
                      }}
                    >
                      내장 기본값 복원
                    </button>
                  )}
                </div>

                <div className="sc-redirect-box" style={{ marginBottom: '8px' }}>
                  <div>
                    <strong>콜백 주소 (Redirect URI)</strong>
                    <code>{provider === 'salesforce' ? serverMeta.redirectUri.replace('127.0.0.1', 'localhost') : serverMeta.redirectUri}</code>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="ex-btn"
                      onClick={() => copyRedirectUri(provider === 'salesforce' ? serverMeta.redirectUri.replace('127.0.0.1', 'localhost') : serverMeta.redirectUri)}
                    >
                      {copiedUri ? '복사됨 ✓' : '콜백 주소 복사'}
                    </button>
                    {oauthGuide?.consoleUrl && (
                      <a
                        href={(() => {
                          const base = (values[oauthSpec.urlEnv ?? ''] || (status[oauthSpec.urlEnv ?? ''] ? hints[oauthSpec.urlEnv ?? ''] : ''))?.trim().replace(/\/+$/, '')
                          if (oauthGuide.consoleUrl.startsWith('http')) return oauthGuide.consoleUrl
                          if (provider === 'okta' && base) return oktaAdminUrl(base, oauthGuide.consoleUrl)
                          return base ? `${base}${oauthGuide.consoleUrl}` : undefined
                        })()}
                        target="_blank"
                        rel="noreferrer"
                        className="ex-btn"
                        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                        onClick={e => {
                          const base = (values[oauthSpec.urlEnv ?? ''] || (status[oauthSpec.urlEnv ?? ''] ? hints[oauthSpec.urlEnv ?? ''] : ''))?.trim()
                          if (!oauthGuide.consoleUrl?.startsWith('http') && !base) {
                            e.preventDefault()
                            setError(`위에 ${oauthSpec.urlLabel || '주소'}를 먼저 입력하시면 콘솔 페이지로 바로 이동합니다.`)
                          }
                        }}
                      >
                        {oauthGuide.consoleActionLabel || '콘솔 열기'} ↗
                      </a>
                    )}
                    {provider === 'okta' && (values.OKTA_ORG_URL || hints.OKTA_ORG_URL) && (
                      <a
                        href={oktaAdminUrl(values.OKTA_ORG_URL || hints.OKTA_ORG_URL, '/admin/access/api/trusted-origins')}
                        target="_blank"
                        rel="noreferrer"
                        className="ex-btn"
                        style={{ textDecoration: 'none' }}
                      >
                        Trusted Origins (콜백 허용) ↗
                      </a>
                    )}
                    {provider === 'slack' && (
                      <>
                        <button
                          type="button"
                          className="ex-btn"
                          onClick={() => {
                            void navigator.clipboard.writeText(buildSlackAppManifest(serverMeta.redirectUri, false, selectedScopes))
                            setCopiedSlackManifest('ws')
                            setTimeout(() => setCopiedSlackManifest(null), 2500)
                          }}
                        >
                          {copiedSlackManifest === 'ws' ? '매니페스트 복사됨 ✓' : 'App Manifest 복사 (일반 워크스페이스)'}
                        </button>
                        <button
                          type="button"
                          className="ex-btn"
                          onClick={() => {
                            void navigator.clipboard.writeText(buildSlackAppManifest(serverMeta.redirectUri, true, selectedScopes))
                            setCopiedSlackManifest('ent')
                            setTimeout(() => setCopiedSlackManifest(null), 2500)
                          }}
                        >
                          {copiedSlackManifest === 'ent' ? 'Enterprise 매니페스트 복사됨 ✓' : 'App Manifest 복사 (Enterprise Grid)'}
                        </button>
                        <a
                          href="https://api.slack.com/apps?new_app=1"
                          target="_blank"
                          rel="noreferrer"
                          className="ex-btn"
                          style={{ textDecoration: 'none' }}
                        >
                          새 Slack App 만들기 (From a manifest) ↗
                        </a>
                      </>
                    )}
                    {provider === 'gws' && (
                      <a
                        href="https://console.cloud.google.com/apis/credentials/consent"
                        target="_blank"
                        rel="noreferrer"
                        className="ex-btn"
                        style={{ textDecoration: 'none' }}
                      >
                        OAuth 동의 화면 ↗
                      </a>
                    )}
                    {provider === 'atlassian' && (
                      <a
                        href="https://admin.atlassian.com/"
                        target="_blank"
                        rel="noreferrer"
                        className="ex-btn"
                        style={{ textDecoration: 'none' }}
                      >
                        Atlassian 관리자 콘솔 ↗
                      </a>
                    )}
                    {provider === 'salesforce' && (() => {
                      const sfBase = (values.SALESFORCE_INSTANCE_URL || hints.SALESFORCE_INSTANCE_URL || '').trim().replace(/\/+$/, '')
                      return sfBase ? (
                        <>
                          <a
                            href={`${sfBase}/lightning/setup/NavigationMenus/page?address=%2Flightning%2Fsetup%2FAppManager%2Fhome`}
                            target="_blank"
                            rel="noreferrer"
                            className="ex-btn"
                            style={{ textDecoration: 'none' }}
                          >
                            App Manager ↗
                          </a>
                          <a
                            href={`${sfBase}/lightning/settings/personal/ResetApiToken/home`}
                            target="_blank"
                            rel="noreferrer"
                            className="ex-btn"
                            style={{ textDecoration: 'none' }}
                          >
                            내 보안 토큰 재설정 ↗
                          </a>
                        </>
                      ) : (
                        <a
                          href="https://login.salesforce.com"
                          target="_blank"
                          rel="noreferrer"
                          className="ex-btn"
                          style={{ textDecoration: 'none' }}
                        >
                          Salesforce 로그인 ↗
                        </a>
                      )
                    })()}
                    {oauthGuide && (
                      <button type="button" className="ex-btn" onClick={() => setShowOAuthSteps(s => !s)}>
                        {showOAuthSteps ? '등록 방법 닫기 ▲' : '앱 등록 방법 ▾'}
                      </button>
                    )}
                  </div>
                </div>

                {oauthGuide && showOAuthSteps && (
                  <div className="sc-guide sc-oauth-guide" style={{ marginBottom: '8px' }}>
                    <p className="sc-guide-summary"><strong>{oauthGuide.registrationLocation}</strong> — {oauthGuide.registrationSummary}</p>
                    <ol>{oauthGuide.steps.map(step => <li key={step}>{step}</li>)}</ol>
                    {oauthGuide.notes.length > 0 && <ul>{oauthGuide.notes.map(note => <li key={note}>{note}</li>)}</ul>}
                  </div>
                )}

                {oauthSpec.urlEnv && oauthSpec.urlOptional && provider !== 'salesforce' && renderField({
                  env: oauthSpec.urlEnv,
                  label: oauthSpec.urlLabel!,
                  placeholder: oauthSpec.urlPlaceholder!,
                  optional: true,
                })}
                {provider === 'slack' && (
                  <div className="sc-subtext" style={{ marginTop: '4px', lineHeight: 1.5 }}>
                    <strong>Enterprise Grid 참고:</strong> OAuth 승인 후 Slack 조직 관리(<code>Manage organization &gt; Integrations &gt; Installed apps &gt; AEGI Collector</code>)에서 <strong>Add to more workspaces</strong>로 대상 워크스페이스를 추가하고, 이어지는 <strong>Who can use AEGI Collector?</strong> 창에서 <strong>Save</strong>(기본 <code>Everyone</code>)까지 완료해야 워크스페이스 호출이 동작합니다.
                  </div>
                )}
                {renderField({
                  env: oauthSpec.clientIdEnv,
                  label: oauthSpec.clientIdLabel,
                  placeholder: oauthSpec.clientIdPlaceholder,
                })}
                {renderField({
                  env: oauthSpec.clientSecretEnv,
                  label: oauthSpec.clientSecretLabel,
                  placeholder: oauthSpec.clientSecretOptional ? '비워 두면 PKCE(Secret 없음)로 연결' : 'Client Secret 입력',
                  secret: true,
                  optional: oauthSpec.clientSecretOptional,
                })}


              </fieldset>
            )}

            {provider === 'slack' && (() => {
              const cfgGroup = groups.find(g => g.id === 'CRED-SL-03')
              if (!cfgGroup) return null
              const cfgRes = checked[cfgGroup.id]
              const isCheckingCfg = checking === cfgGroup.id
              return (
                <fieldset className="sc-group" style={{ marginTop: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px', flexWrap: 'wrap' }}>
                    <legend style={{ margin: 0 }}>앱 매니페스트 토큰 (선택 · SL-10)</legend>
                    <a
                      href="https://api.slack.com/apps"
                      target="_blank"
                      rel="noreferrer"
                      className="ex-btn"
                      style={{ textDecoration: 'none', fontSize: 'var(--font-size-xs)' }}
                    >
                      Config Token 발급 (페이지 하단 Generate Token) ↗
                    </a>
                  </div>
                  {cfgGroup.fields.map(renderField)}
                  <div className="sc-check">
                    <span className={`sc-state ${cfgRes ? (cfgRes.ok ? 'is-ok' : 'is-bad') : isCheckingCfg ? 'is-wait' : ''}`}>
                      {isCheckingCfg ? '확인 중…' : cfgRes ? cfgRes.detail : ''}
                    </span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        className="ex-btn"
                        disabled={checking !== null || isBusyCollecting}
                        onClick={() => void checkGroup(cfgGroup)}
                      >
                        연결 확인
                      </button>
                      <button
                        type="button"
                        className="ex-btn primary"
                        disabled={saving || isBusyCollecting}
                        onClick={() => {
                          const updates: Record<string, string> = {}
                          for (const f of cfgGroup.fields) {
                            const v = (values[f.env] ?? '').trim()
                            if (v) updates[f.env] = v
                          }
                          void saveCredentialUpdates(updates)
                        }}
                      >
                        {saving ? '저장 중…' : 'Config Token 저장'}
                      </button>
                    </div>
                  </div>
                </fieldset>
              )
            })()}
          </div>
        ) : (
          <form onSubmit={submitManual}>
            {provider === 'github' && (
              <div className="sc-guide-card">
                <div className="sc-guide-card-head">
                  <strong className="sc-guide-card-title">
                    PAT 연동
                  </strong>
                  <span className={`sc-guide-card-badge ${configured.GITHUB_OWNER_TOKEN ? 'is-green' : ''}`}>
                    {configured.GITHUB_OWNER_TOKEN ? '등록됨 ✓' : '9개 권한 자동 체크'}
                  </span>
                </div>
                <ol style={{ margin: '8px 0 10px 18px', padding: 0, fontSize: 'var(--font-size-xs)', lineHeight: 1.6 }}>
                  <li><strong>[PAT 발급 페이지 열기 ↗]</strong>에서 토큰 생성 (SSO 사용 시 조직 <strong>Authorize</strong>)</li>
                  <li>아래 <code>Personal Access Token</code> 칸에 붙여넣기</li>
                  <li><strong>[연결 확인]</strong> → <strong>[키 저장]</strong></li>
                </ol>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <a
                    href={`https://github.com/settings/tokens/new?scopes=${encodeURIComponent((oauthSpec ? oauthSpec.scopes.filter(s => selectedScopes[s.scope]).map(s => s.scope) : ['repo','read:org','admin:org','admin:org_hook','read:user','user:email','read:packages','read:audit_log','read:enterprise']).join(','))}&description=AEGI%20Collector`}
                    target="_blank"
                    rel="noreferrer"
                    className="ex-btn primary sc-guide-link"
                    style={{ textDecoration: 'none' }}
                  >
                    PAT 발급 페이지 열기 ↗
                  </a>
                </div>
              </div>
            )}
            {provider === 'slack' && (
              <div className="sc-guide-card">
                <div className="sc-guide-card-head">
                  <strong className="sc-guide-card-title">
                    토큰 연동
                  </strong>
                  <span className={`sc-guide-card-badge ${configured.SLACK_COLLECTOR_BOT_TOKEN ? 'is-green' : ''}`}>
                    {configured.SLACK_COLLECTOR_BOT_TOKEN ? '등록됨 ✓' : 'App Manifest 지원'}
                  </span>
                </div>
                <ol style={{ margin: '8px 0 10px 18px', padding: 0, fontSize: 'var(--font-size-xs)', lineHeight: 1.6 }}>
                  <li><strong>[App Manifest 복사]</strong> 후 <strong>[Slack 앱 콘솔 열기 ↗]</strong>에서 <strong>From a manifest</strong>로 생성</li>
                  <li>Install 후 <code>Bot Token(xoxb-)</code>·<code>User Token(xoxp-)</code> 복사 (Enterprise Grid는 <code>Add to more workspaces</code>로 대상 워크스페이스 추가)</li>
                  <li>아래 칸에 붙여넣고 <strong>[연결 확인]</strong> → <strong>[키 저장]</strong></li>
                </ol>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="ex-btn primary"
                    onClick={() => {
                      void navigator.clipboard.writeText(buildSlackAppManifest(serverMeta.redirectUri, false, selectedScopes))
                      setCopiedSlackManifest('ws')
                      setTimeout(() => setCopiedSlackManifest(null), 2500)
                    }}
                  >
                    {copiedSlackManifest === 'ws' ? '매니페스트 복사됨 ✓' : 'App Manifest 복사'}
                  </button>
                  <button
                    type="button"
                    className="ex-btn"
                    onClick={() => {
                      void navigator.clipboard.writeText(buildSlackAppManifest(serverMeta.redirectUri, true, selectedScopes))
                      setCopiedSlackManifest('ent')
                      setTimeout(() => setCopiedSlackManifest(null), 2500)
                    }}
                  >
                    {copiedSlackManifest === 'ent' ? 'Enterprise 매니페스트 복사됨 ✓' : 'Enterprise용 Manifest 복사'}
                  </button>
                  <a
                    href="https://api.slack.com/apps?new_app=1"
                    target="_blank"
                    rel="noreferrer"
                    className="ex-btn sc-guide-link"
                    style={{ textDecoration: 'none' }}
                  >
                    Slack 앱 콘솔 열기 ↗
                  </a>
                </div>
              </div>
            )}
            {provider === 'salesforce' && (() => {
              const sfBase = (values.SALESFORCE_INSTANCE_URL || hints.SALESFORCE_INSTANCE_URL || '').trim().replace(/\/+$/, '')
              const sfReady = Boolean(configured.SALESFORCE_INSTANCE_URL && configured.SALESFORCE_COLLECTOR_CLIENT_ID && configured.SALESFORCE_COLLECTOR_CLIENT_SECRET)
              return (
                <div className="sc-guide-card">
                  <div className="sc-guide-card-head">
                    <strong className="sc-guide-card-title">
                      Connected App 연동
                    </strong>
                    <span className={`sc-guide-card-badge ${sfReady ? 'is-green' : ''}`}>
                      {sfReady ? '등록됨 ✓' : 'Connected App'}
                    </span>
                  </div>
                  <ol style={{ margin: '8px 0 10px 18px', padding: 0, fontSize: 'var(--font-size-xs)', lineHeight: 1.6 }}>
                    <li>Setup → <strong>App Manager</strong>에서 <code>Consumer Key</code> / <code>Consumer Secret</code> 확인</li>
                    <li>아래 칸에 입력 후 <strong>[연결 확인]</strong> → <strong>[키 저장]</strong></li>
                  </ol>
                  <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {sfBase ? (
                      <>
                        <a
                          href={`${sfBase}/lightning/setup/NavigationMenus/page?address=%2Flightning%2Fsetup%2FAppManager%2Fhome`}
                          target="_blank"
                          rel="noreferrer"
                          className="ex-btn sc-guide-link"
                          style={{ textDecoration: 'none' }}
                        >
                          App Manager 바로가기 ↗
                        </a>
                        <a
                          href={`${sfBase}/lightning/setup/NavigationMenus/page?address=%2Flightning%2Fsetup%2FExternalClientApp%2Fhome`}
                          target="_blank"
                          rel="noreferrer"
                          className="ex-btn sc-guide-link"
                          style={{ textDecoration: 'none' }}
                        >
                          External Client App 바로가기 ↗
                        </a>
                        <a
                          href={`${sfBase}/lightning/settings/personal/ResetApiToken/home`}
                          target="_blank"
                          rel="noreferrer"
                          className="ex-btn sc-guide-link"
                          style={{ textDecoration: 'none' }}
                        >
                          내 보안 토큰 재설정 바로가기 ↗
                        </a>
                        <a
                          href={`${sfBase}/lightning/setup/NavigationMenus/page?address=%2Flightning%2Fsetup%2FCorsSetupPage%2Fhome`}
                          target="_blank"
                          rel="noreferrer"
                          className="ex-btn sc-guide-link"
                          style={{ textDecoration: 'none' }}
                        >
                          CORS 허용 목록 바로가기 ↗
                        </a>
                      </>
                    ) : (
                      <a
                        href="https://login.salesforce.com"
                        target="_blank"
                        rel="noreferrer"
                        className="ex-btn sc-guide-link"
                        style={{ textDecoration: 'none' }}
                      >
                        Salesforce 로그인 ↗
                      </a>
                    )}
                  </div>
                </div>
              )
            })()}
            {provider === 'okta' && (
              <div className="sc-guide-card">
                <div className="sc-guide-card-head">
                  <strong className="sc-guide-card-title">
                    API 토큰 연동
                  </strong>
                  <span className={`sc-guide-card-badge ${configured.OKTA_ORG_URL && configured.OKTA_API_TOKEN ? 'is-green' : ''}`}>
                    {configured.OKTA_ORG_URL && configured.OKTA_API_TOKEN ? '등록됨 ✓' : '전체 수집'}
                  </span>
                </div>
                <ol style={{ margin: '8px 0 10px 18px', padding: 0, fontSize: 'var(--font-size-xs)', lineHeight: 1.6 }}>
                  <li><code>Okta Org URL</code> 입력 후 <strong>[Okta 토큰 콘솔 열기 ↗]</strong> 클릭</li>
                  <li><strong>[Create token]</strong>으로 토큰 생성 후 <code>Token Value</code> 복사</li>
                  <li>아래 <code>API Token</code>에 붙여넣고 <strong>[연결 확인]</strong> → <strong>[키 저장]</strong></li>
                </ol>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {(values.OKTA_ORG_URL || hints.OKTA_ORG_URL) ? (
                    <a
                      href={oktaAdminUrl(values.OKTA_ORG_URL || hints.OKTA_ORG_URL, '/admin/access/api/tokens')}
                      target="_blank"
                      rel="noreferrer"
                      className="ex-btn primary sc-guide-link"
                      style={{ textDecoration: 'none' }}
                    >
                      Okta 토큰 콘솔 열기 ↗
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="ex-btn primary sc-guide-link"
                      onClick={() => focusField('OKTA_ORG_URL', '1단계: Okta 조직 주소(https://조직.okta.com)를 먼저 입력해 주세요.')}
                    >
                      Okta 토큰 콘솔 열기 ↗
                    </button>
                  )}
                  <a
                    href="https://login.okta.com"
                    target="_blank"
                    rel="noreferrer"
                    className="ex-btn"
                    style={{ textDecoration: 'none' }}
                  >
                    Okta 로그인 / 조직 찾기 ↗
                  </a>
                </div>
              </div>
            )}
            {provider === 'gws' && (() => {
              let parsedClientId = ''
              const rawSa = (values.GWS_COLLECTOR_SA_KEY || '').trim()
              if (rawSa) {
                try {
                  const parsed = JSON.parse(rawSa) as { client_id?: string }
                  if (typeof parsed.client_id === 'string') parsedClientId = parsed.client_id.trim()
                } catch {
                  // ignore partial JSON while typing
                }
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px' }}>
                  <div className="sc-guide-card" style={{ marginBottom: 0 }}>
                    <div className="sc-guide-card-head">
                      <strong className="sc-guide-card-title">
                        1단계. GCP 서비스 계정 및 JSON 키 등록
                      </strong>
                      <span className={`sc-guide-card-badge ${configured.GWS_COLLECTOR_SA_KEY || parsedClientId ? 'is-green' : ''}`}>
                        {configured.GWS_COLLECTOR_SA_KEY ? '등록됨 ✓' : parsedClientId ? 'JSON 선택됨 ✓' : '필수'}
                      </span>
                    </div>
                    <div className="sc-guide-step-desc" style={{ marginTop: '4px' }}>
                      Cloud Shell 명령어로 서비스 계정 키(<code>aegi-sa-key.json</code>)를 만든 뒤 아래에 끌어다 놓으세요. 전용 프로젝트 <code>AEGI Collector</code>를 만들어 씁니다(이미 있으면 그것을 재사용). 처음 사용하는 계정이면 <code>welcome/new</code> 온보딩을 마친 뒤 콘솔 우측 상단 Cloud Shell(<code>&gt;_</code>) 버튼을 누르세요.
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                      <button
                        type="button"
                        className="ex-btn"
                        onClick={() => {
                          void navigator.clipboard.writeText(GWS_CLOUD_SHELL_SCRIPT)
                          setCopiedScript(true)
                          setTimeout(() => setCopiedScript(false), 2500)
                        }}
                      >
                        {copiedScript ? '명령어 복사됨 ✓' : 'Cloud Shell 명령어 복사'}
                      </button>
                      <a
                        href="https://shell.cloud.google.com"
                        target="_blank"
                        rel="noreferrer"
                        className="ex-btn sc-guide-link"
                        style={{ textDecoration: 'none' }}
                      >
                        Google Cloud Shell 열기 ↗
                      </a>
                      <a
                        href="https://console.cloud.google.com/iam-admin/serviceaccounts"
                        target="_blank"
                        rel="noreferrer"
                        className="ex-btn sc-guide-link"
                        style={{ textDecoration: 'none' }}
                      >
                        GCP 서비스 계정 콘솔 ↗
                      </a>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) handleKeyFile(f)
                      }}
                    />
                    <div
                      className={`sc-dropzone ${isDragging ? 'is-dragover' : ''}`}
                      style={{ marginTop: '8px' }}
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={e => {
                        e.preventDefault()
                        setIsDragging(true)
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={e => {
                        e.preventDefault()
                        setIsDragging(false)
                        const f = e.dataTransfer.files?.[0]
                        if (f) handleKeyFile(f)
                      }}
                    >
                      <FileText size={20} />
                      <div className="sc-dropzone-text">
                        <strong>aegi-sa-key.json 파일을 여기로 끌어다 놓거나 클릭해서 선택하세요</strong>
                      </div>
                      {(saKeyInfo || parsedClientId) && (
                        <div className="sc-dropzone-file">
                          {saKeyInfo ? <>선택된 서비스 계정: <strong>{saKeyInfo}</strong></> : null}
                          {parsedClientId ? <> · Client ID: <code>{parsedClientId}</code></> : null}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="sc-guide-card" style={{ marginBottom: 0 }}>
                    <div className="sc-guide-card-head">
                      <strong className="sc-guide-card-title">
                        2단계. Google Workspace DWD 콘솔에서 위임 승인
                      </strong>
                      <span className={`sc-guide-card-badge ${configured.GWS_ADMIN_SUBJECT && configured.GWS_COLLECTOR_SA_KEY ? 'is-green' : ''}`}>
                        {configured.GWS_ADMIN_SUBJECT && configured.GWS_COLLECTOR_SA_KEY ? '등록됨 ✓' : '필수 · DWD 위임'}
                      </span>
                    </div>
                    <div className="sc-guide-step-desc" style={{ marginTop: '4px' }}>
                      <strong>[Workspace DWD 콘솔 열기 ↗]</strong> → <strong>[새로 추가]</strong>에 아래 <code>Client ID</code>와 <code>Scope</code>를 붙여넣고 <strong>[승인]</strong>하세요.
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                      <a
                        href="https://admin.google.com/ac/owl/domainwidedelegation"
                        target="_blank"
                        rel="noreferrer"
                        className="ex-btn primary sc-guide-link"
                        style={{ textDecoration: 'none' }}
                      >
                        Workspace DWD 콘솔 열기 ↗
                      </a>
                      <button
                        type="button"
                        className="ex-btn"
                        onClick={() => {
                          if (!parsedClientId) {
                            focusField('GWS_COLLECTOR_SA_KEY', '1단계에서 서비스 계정 JSON 키를 먼저 등록하면 Client ID가 자동 추출됩니다.')
                            return
                          }
                          void navigator.clipboard.writeText(parsedClientId)
                          setCopiedDwdClientId(true)
                          setTimeout(() => setCopiedDwdClientId(false), 2500)
                        }}
                      >
                        {copiedDwdClientId
                          ? 'Client ID 복사됨 ✓'
                          : parsedClientId
                            ? `Client ID 복사 (${parsedClientId})`
                            : 'Client ID 복사 (1단계 JSON 필요)'}
                      </button>
                      <button
                        type="button"
                        className="ex-btn"
                        onClick={() => {
                          void navigator.clipboard.writeText(
                            Array.from(
                              new Set([
                                ...GWS_DWD_SCOPES.split(', ').filter(s => Boolean(selectedScopes[s])),
                                ...(oauthSpec ? oauthSpec.scopes.filter(s => selectedScopes[s.scope]).map(s => s.scope) : []),
                              ]),
                            ).join(', '),
                          )
                          setCopiedScopes(true)
                          setTimeout(() => setCopiedScopes(false), 2500)
                        }}
                      >
                        {copiedScopes ? 'Scope 목록 복사됨 ✓' : 'DWD Scope 목록 일괄 복사'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })()}
            {(provider === 'github' || provider === 'slack') && renderScopeSelector()}
            {(provider === 'github' && tab === 'manual'
              ? groups.filter(g => g.id === 'CRED-GH-02') // PAT 탭에서는 GitHub App 및 수동 테넌트 숨기고 오직 PAT만 노출!
              : groups
            ).map(group => {
              const result = checked[group.id]
              const isChecking = checking === group.id
              const reqFields = group.fields.filter(f => !f.optional)
              const groupRegistered = group.id === 'CRED-AT-ORG-02'
                ? Boolean(configured.ATLASSIAN_ORG_AUDIT_API_KEY || configured.ATLASSIAN_COLLECTOR_ORG_API_KEY)
                : reqFields.length > 0
                  ? reqFields.every(f => Boolean(configured[f.env]))
                  : group.fields.some(f => Boolean(configured[f.env]))
              return (
                <fieldset key={group.id} className="sc-group">
                  <legend>
                    {group.label}
                    {groupRegistered && (
                      <span className="sc-guide-card-badge is-green" style={{ marginLeft: '8px' }}>
                        등록됨 ✓
                      </span>
                    )}
                  </legend>
                  {provider === 'atlassian' && group.id === 'CRED-AT-ORG-02' && (() => {
                    const atlassianOrgId = (values.ATLASSIAN_ORG_ID || hints.ATLASSIAN_ORG_ID || '').trim()
                    const orgKeyReady = Boolean(configured.ATLASSIAN_ORG_AUDIT_API_KEY || configured.ATLASSIAN_COLLECTOR_ORG_API_KEY)
                    return (
                      <div className="sc-guide-card" style={{ marginBottom: '10px' }}>
                        <div className="sc-guide-card-head">
                          <strong className="sc-guide-card-title" style={{ fontSize: 'var(--font-size-xs)' }}>
                            조직 API 키 발급
                          </strong>
                          <span className={`sc-guide-card-badge ${orgKeyReady ? 'is-green' : ''}`}>
                            {orgKeyReady ? '등록됨 ✓' : '사이트 자동 감지'}
                          </span>
                        </div>
                        <div className="sc-guide-step-desc" style={{ marginTop: '4px' }}>
                          <code>Settings → API keys → Create API key</code>(<code>without scopes</code>) 입력 후 <strong>[연결 확인]</strong> 시 Org ID·Site URL 자동 입력
                        </div>
                        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                          <a
                            href={
                              atlassianOrgId
                                ? `https://admin.atlassian.com/o/${atlassianOrgId}/api-keys`
                                : 'https://admin.atlassian.com/'
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="ex-btn sc-guide-link"
                            style={{ textDecoration: 'none' }}
                          >
                            조직 API 키 발급 콘솔 ↗
                          </a>
                          {atlassianOrgId && (
                            <span className="sc-subtext" style={{ fontSize: 'var(--font-size-xs)' }}>
                              감지된 Org ID: <code>{atlassianOrgId}</code>
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                  {provider === 'atlassian' && group.id === 'CRED-AT-01' && (() => {
                    const atlassianSite = (values.ATLASSIAN_SITE_URL || hints.ATLASSIAN_SITE_URL || '').trim().replace(/\/+$/, '')
                    const atlassianReady = Boolean(configured.ATLASSIAN_SITE_URL && configured.ATLASSIAN_COLLECTOR_EMAIL && configured.ATLASSIAN_COLLECTOR_API_TOKEN)
                    return (
                      <div className="sc-guide-card" style={{ marginBottom: '10px' }}>
                        <div className="sc-guide-card-head">
                          <strong className="sc-guide-card-title" style={{ fontSize: 'var(--font-size-xs)' }}>
                            사이트 API 토큰 발급
                          </strong>
                          <span className={`sc-guide-card-badge ${atlassianReady ? 'is-green' : ''}`}>
                            {atlassianReady ? '등록됨 ✓' : 'Jira · Confluence'}
                          </span>
                        </div>
                        <ol style={{ margin: '6px 0 8px 18px', padding: 0, fontSize: 'var(--font-size-xs)', lineHeight: 1.55 }}>
                          <li><strong>[API 토큰 발급 ↗]</strong>에서 <strong>Create API token</strong> 생성 (<code>with scopes</code> 제외)</li>
                          <li>아래 입력 후 <strong>[연결 확인]</strong> → <strong>[키 저장]</strong></li>
                        </ol>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <a
                            href={atlassianSite || 'https://start.atlassian.com/'}
                            target="_blank"
                            rel="noreferrer"
                            className="ex-btn sc-guide-link"
                            style={{ textDecoration: 'none' }}
                          >
                            {atlassianSite ? '내 Atlassian 사이트 바로가기 ↗' : '내 Atlassian 사이트 확인 ↗'}
                          </a>
                          <a
                            href="https://id.atlassian.com/manage-profile/security/api-tokens"
                            target="_blank"
                            rel="noreferrer"
                            className="ex-btn primary sc-guide-link"
                            style={{ textDecoration: 'none' }}
                          >
                            API 토큰 발급 ↗
                          </a>
                        </div>
                      </div>
                    )
                  })()}
                  {group.fields.map(renderField)}
                  {provider === 'atlassian' && group.id === 'CRED-AT-01' && atlassianSites.length > 0 && (() => {
                    const currentRaw = (values.ATLASSIAN_SITE_URLS || values.ATLASSIAN_SITE_URL || hints.ATLASSIAN_SITE_URLS || hints.ATLASSIAN_SITE_URL || '').trim()
                    const selectedSet = new Set(
                      currentRaw ? currentRaw.split(/[\s,]+/).map(s => s.trim().replace(/\/+$/, '')).filter(Boolean) : []
                    )
                    const toggleSite = (siteUrl: string) => {
                      const next = new Set(selectedSet)
                      if (next.has(siteUrl)) {
                        if (next.size > 1) next.delete(siteUrl)
                      } else {
                        next.add(siteUrl)
                      }
                      const list = Array.from(next)
                      setValues(prev => ({
                        ...prev,
                        ATLASSIAN_SITE_URL: list[0] ?? '',
                        ATLASSIAN_SITE_URLS: list.join(','),
                      }))
                    }
                    const selectAllSites = () => {
                      const list = atlassianSites.map(s => s.url)
                      setValues(prev => ({
                        ...prev,
                        ATLASSIAN_SITE_URL: list[0] ?? '',
                        ATLASSIAN_SITE_URLS: list.join(','),
                      }))
                    }
                    return (
                      <div style={{ marginTop: '8px', padding: '8px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: '#1e293b' }}>
                            감지된 조직 사이트 (다중 선택 가능 · {selectedSet.size}/{atlassianSites.length}개 선택됨):
                          </span>
                          {atlassianSites.length > 1 && (
                            <button type="button" className="ex-btn" style={{ fontSize: '11px', padding: '2px 8px' }} onClick={selectAllSites}>
                              전체 선택 ({atlassianSites.length}개)
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {atlassianSites.map(site => {
                            const isSelected = selectedSet.has(site.url)
                            return (
                              <button
                                key={site.url}
                                type="button"
                                className={`ex-btn ${isSelected ? 'primary' : ''}`}
                                style={{ fontSize: '11px', padding: '3px 10px' }}
                                onClick={() => toggleSite(site.url)}
                              >
                                {isSelected ? '☑' : '☐'} {site.name ? `${site.name} (${site.url})` : site.url}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}
                  {provider === 'github' && tab === 'manual' && group.id === 'CRED-GH-02' && (() => {
                    const currentRaw = (values.GITHUB_ORGS || values.GITHUB_ORG || hints.GITHUB_ORGS || hints.GITHUB_ORG || '').trim()
                    const selectedSet = new Set(
                      currentRaw ? currentRaw.split(/[\s,]+/).map(s => s.toLowerCase()).filter(Boolean) : []
                    )
                    const toggleOrg = (login: string) => {
                      const lower = login.toLowerCase()
                      const next = new Set(selectedSet)
                      if (next.has(lower)) {
                        if (next.size > 1) next.delete(lower)
                      } else {
                        next.add(lower)
                      }
                      const joined = Array.from(next).join(',')
                      setValues(prev => ({ ...prev, GITHUB_ORG: joined, GITHUB_ORGS: joined }))
                    }
                    const selectAll = () => {
                      const all = githubOrgs.map(o => o.login.toLowerCase()).join(',')
                      setValues(prev => ({ ...prev, GITHUB_ORG: all, GITHUB_ORGS: all }))
                    }

                    return (
                      <div style={{ marginTop: '10px', padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                          <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'bold', color: '#1e293b' }}>
                            수집 대상 조직 (다중 선택 가능 {githubOrgs.length > 0 ? `· ${selectedSet.size}/${githubOrgs.length}개 선택됨` : ''}):
                          </span>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            {githubOrgs.length > 1 && (
                              <button
                                type="button"
                                className="ex-btn"
                                style={{ fontSize: '11px', padding: '2px 8px' }}
                                onClick={selectAll}
                              >
                                전체 선택 ({githubOrgs.length}개)
                              </button>
                            )}
                            <button
                              type="button"
                              className="ex-btn"
                              style={{ fontSize: '11px', padding: '2px 8px' }}
                              onClick={() => {
                                const curToken = (values.GITHUB_OWNER_TOKEN || hints.GITHUB_OWNER_TOKEN || '').trim()
                                void loadGithubOrgs(curToken || undefined)
                              }}
                            >
                              {loadingGithubOrgs ? '확인 중…' : '조직 다시 확인'}
                            </button>
                          </div>
                        </div>
                        {loadingGithubOrgs ? (
                          <div className="sc-subtext" style={{ fontSize: 'var(--font-size-xs)' }}>PAT로 소속 조직을 조회하는 중…</div>
                        ) : githubOrgs.length > 0 ? (
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                            {githubOrgs.map(org => {
                              const isChecked = selectedSet.has(org.login.toLowerCase())
                              return (
                                <button
                                  key={org.login}
                                  type="button"
                                  className={`ex-btn ${isChecked ? 'primary' : ''}`}
                                  style={{
                                    fontSize: 'var(--font-size-xs)',
                                    padding: '4px 10px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                    fontWeight: isChecked ? 'bold' : 'normal',
                                  }}
                                  onClick={() => toggleOrg(org.login)}
                                >
                                  <span>{isChecked ? '☑' : '☐'}</span>
                                  <span>{org.login}</span>
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="sc-subtext" style={{ fontSize: 'var(--font-size-xs)' }}>
                            PAT를 입력하고 저장하거나 [조직 다시 확인]을 누르면 소속 조직이 자동 감지됩니다.
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  <div className="sc-check">
                    <span className={`sc-state ${result ? (result.ok ? 'is-ok' : 'is-bad') : isChecking ? 'is-wait' : ''}`}>
                      {isChecking ? '확인 중…' : result ? result.detail : ''}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginLeft: 'auto' }}>
                      {result?.ssoUrl && (
                        <a
                          href={result.ssoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="ex-btn primary"
                          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#dc2626', color: '#ffffff', fontWeight: 600, padding: '4px 12px' }}
                        >
                          🔑 {result.org || '조직'} SAML SSO 1회 승인 ↗
                        </a>
                      )}
                      <button
                        type="button"
                        className="ex-btn"
                        disabled={checking !== null || isBusyCollecting}
                        onClick={() => void checkGroup(group)}
                      >
                        연결 확인
                      </button>
                      {groups.length > 1 && (
                        <button
                          type="button"
                          className="ex-btn"
                          disabled={saving || isBusyCollecting}
                          onClick={() => void saveGroup(group)}
                        >
                          {saving ? '저장 중…' : '저장'}
                        </button>
                      )}
                    </div>
                  </div>
                </fieldset>
              )
            })}
            <div className="ex-dialog-actions">
              <button type="submit" className="ex-btn primary" disabled={saving || isBusyCollecting}>
                {saving ? '저장 중…' : '키 저장'}
              </button>
            </div>
            {provider === 'gws' && renderScopeSelector()}
          </form>
        )}

        {oauthNotice && (
          <div className={`sc-banner ${oauthNotice.ok ? 'is-ok' : 'is-bad'}`} role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <span>{oauthNotice.text}</span>
            {oauthNotice.cleanupLinks && oauthNotice.cleanupLinks.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {oauthNotice.cleanupLinks.map(link => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ex-btn"
                    style={{ textDecoration: 'none', whiteSpace: 'nowrap', fontSize: 'var(--font-size-xs)' }}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            )}
            {oauthNotice.ssoUrl && (
              <a
                href={oauthNotice.ssoUrl}
                target="_blank"
                rel="noreferrer"
                className="ex-btn primary"
                style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
              >
                🔑 {oauthNotice.org || '조직'} SAML SSO 1회 승인 ↗
              </a>
            )}
          </div>
        )}
        {error && <p className="ex-error" role="alert">{error}</p>}

        <footer className="sc-footer">
          <div className="sc-collect-bar">
            <span>
              {ready
                ? `${name} 연결됨 — 지금 바로 수집할 수 있습니다.`
                : '자격증명 연결 후 수집을 실행할 수 있습니다.'}
            </span>
            <button
              type="button"
              className="ex-btn primary"
              disabled={!ready || isBusyCollecting}
              onClick={() => void runProviderCollect()}
            >
              {isBusyCollecting ? '수집 실행 중…' : `이 SaaS 수집 실행`}
            </button>
          </div>

          {isBusyCollecting && (
            <div className="sc-stepper" role="status" aria-label="수집 진행 상태">
              <div className="sc-stepper-track">
                <div className={`sc-stepper-step ${(collectProgress?.includes('1/4') || collectProgress?.includes('시작') || !collectProgress) ? 'is-active' : ''}`}>
                  <span className="sc-stepper-num">1</span>
                  <span className="sc-stepper-label">수집 요청</span>
                </div>
                <div className="sc-stepper-arrow">→</div>
                <div className={`sc-stepper-step ${(collectProgress?.includes('2/4') || collectProgress?.includes('수집')) ? 'is-active' : ''}`}>
                  <span className="sc-stepper-num">2</span>
                  <span className="sc-stepper-label">로그 및 객체 수집</span>
                </div>
                <div className="sc-stepper-arrow">→</div>
                <div className={`sc-stepper-step ${collectProgress?.includes('3/4') ? 'is-active' : ''}`}>
                  <span className="sc-stepper-num">3</span>
                  <span className="sc-stepper-label">그래프 분석</span>
                </div>
                <div className="sc-stepper-arrow">→</div>
                <div className={`sc-stepper-step ${collectProgress?.includes('4/4') ? 'is-active' : ''}`}>
                  <span className="sc-stepper-num">4</span>
                  <span className="sc-stepper-label">완료 반영</span>
                </div>
              </div>
              <div className="sc-stepper-msg">
                <span className="sc-pulse-dot" />
                <span>{collectProgress || '수집 처리 중…'}</span>
              </div>
            </div>
          )}
          {collectResult && (
            <p className={`sc-state ${collectResult.ok ? 'is-ok' : 'is-bad'}`} role="status">
              {collectResult.text}
            </p>
          )}
        </footer>
      </dialog>
    </div>
  )
}
