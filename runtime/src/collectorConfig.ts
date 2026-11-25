/**
 * .env 의 tenant 식별값으로 엔진 수집 설정(collector.config.json)을 만든다. 고객은 JSON 을 고치지 않고 .env 만 채운다.
 * 시나리오용 목록(저장소, 채널, Drive 사용자)은 비워 두면 수집기가 전부 찾는다.
 */
import type { CollectorConfig } from '../vendor/engine/scripts/collect/config.ts'
import { normalizeOktaOrgUrl, normalizeSalesforceUrl } from '../vendor/engine/scripts/collect/lib/auth.ts'

const list = (v: string | undefined) => (v ?? '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
const host = (url: string | undefined) => { try { return url ? new URL(url).host : undefined } catch { return undefined } }

export const DEFAULT_SINCE_DAYS = 30
export const DEFAULT_GWS_GRANTED_SCOPES = [
  'script.deployments.readonly',
  'gmail.settings.basic',
  'apps.groups.settings',
  'admin.datatransfer.readonly',
  'admin.directory.device.chromebrowsers.readonly',
  'admin.directory.device.mobile.readonly',
  'admin.directory.resource.calendar.readonly',
  'apps.alerts',
  'calendar.readonly',
  'chrome.management.appdetails.readonly',
  'chrome.management.profiles.readonly',
  'chrome.management.reports.readonly',
  'chrome.management.telemetry.readonly',
  'cloud-identity.devices.readonly',
  'drive.labels.readonly',
  'ediscovery.readonly',
  'apps.licensing',
  'gmail.labels',
  'drive.apps.readonly',
  'drive.readonly',
  'admin.chrome.printers.readonly',
  'chrome.management.connectors.readonly',
  'admin.directory.device.chromeos.readonly',
]

export const DEFAULT_OKTA_SCOPES = [
  'okta.orgs.read',
  'okta.users.read',
  'okta.groups.read',
  'okta.roles.read',
  'okta.apps.read',
  'okta.clients.read',
  'okta.policies.read',
  'okta.logs.read',
  'okta.schemas.read',
  'okta.oauthIntegrations.read',
  'okta.apiTokens.read',
  'okta.eventHooks.read',
  'okta.inlineHooks.read',
  'okta.logStreams.read',
  'okta.idps.read',
  'okta.profileMappings.read',
  'okta.authenticators.read',
  'okta.trustedOrigins.read',
  'okta.deviceAssurance.read',
  'okta.networkZones.read',
  'okta.agentPools.read',
  'okta.securityEventsProviders.read',
  'ssf.read',
  'okta.emailServers.read',
  'okta.accessRequests.request.read',
  'okta.aiAgents.read',
  'okta.appGrants.read',
  'okta.authorizationServers.read',
  'okta.behaviors.read',
  'okta.brands.read',
  'okta.captchas.read',
  'okta.customTelephonyProvider.read',
  'okta.deviceIntegrations.read',
  'okta.devicePostureChecks.read',
  'okta.devices.read',
  'okta.domains.read',
  'okta.emailDomains.read',
  'okta.governance.accessCertifications.read',
  'okta.governance.accessRequests.read',
  'okta.governance.admin.read',
  'okta.governance.labels.read',
  'okta.governance.riskRule.read',
  'okta.linkedObjects.read',
  'okta.principalRateLimits.read',
  'okta.pushProviders.read',
  'okta.rateLimits.read',
  'okta.realmAssignments.read',
  'okta.realms.read',
  'okta.resourceServers.apiServers.read',
  'okta.resourceServers.clientAuthSettings.read',
  'okta.resourceServers.mcpServers.read',
  'okta.resourceServers.read',
  'okta.resourceServers.virtualMcpServers.read',
  'okta.serviceAccounts.okta.read',
  'okta.serviceAccounts.read',
  'okta.templates.read',
  'okta.threatInsights.read',
  'okta.uischemas.read',
  'okta.userTypes.read',
]

export function collectorConfig(env: Record<string, string>, now = new Date()): CollectorConfig {
  const since = env.AEGI_COLLECT_SINCE || new Date(now.getTime() - Number(env.AEGI_COLLECT_DAYS || DEFAULT_SINCE_DAYS) * 86400_000).toISOString().replace(/\.\d+Z$/, 'Z')
  const gwsScopes = list(env.GWS_GRANTED_SCOPES).map(s => s.replace('https://www.googleapis.com/auth/', ''))
  const hasGwsKey = Boolean(env.GWS_COLLECTOR_SA_KEY || env.GWS_COLLECTOR_SA_KEY_FILE)
  const gwsGrantedScopes = gwsScopes.length ? gwsScopes : (hasGwsKey ? [...DEFAULT_GWS_GRANTED_SCOPES] : [])
  const rawGithubOrgs = env.GITHUB_ORGS || env.GITHUB_ORG || ''
  const githubOrgsList = list(rawGithubOrgs)
  const config: CollectorConfig = {
    since,
    github: {
      org: githubOrgsList[0] ?? (env.GITHUB_ORG ?? ''),
      orgs: githubOrgsList,
      enterprise: env.GITHUB_ENTERPRISE ?? '',
      repos: list(env.GITHUB_REPOS),
      maxCommitDetails: 50,
    },
    okta: {
      orgHost: host(env.OKTA_ORG_URL ? normalizeOktaOrgUrl(env.OKTA_ORG_URL) : undefined),
      scopes: list(env.OKTA_SCOPES).length ? list(env.OKTA_SCOPES) : [...DEFAULT_OKTA_SCOPES],
      policyTypes: [
        'OKTA_SIGN_ON',
        'ACCESS_POLICY',
        'MFA_ENROLL',
        'PASSWORD',
        'IDP_DISCOVERY',
        'PROFILE_ENROLLMENT',
        'POST_AUTH_SESSION',
        'ENTITY_RISK',
      ],
    },
    slack: {
      teamId: env.SLACK_TEAM_ID?.trim() || '',
      enterpriseId: env.SLACK_ENTERPRISE_ID?.trim() || '',
      extraChannels: list(env.SLACK_EXTRA_CHANNELS),
      integrationLogs: env.SLACK_INTEGRATION_LOGS !== '0',
    },
    gws: {
      adminSubject: env.GWS_ADMIN_SUBJECT ?? '',
      driveUsers: list(env.GWS_DRIVE_USERS),
      reportApplications: list(env.GWS_REPORT_APPLICATIONS).length ? list(env.GWS_REPORT_APPLICATIONS) : ['drive', 'token:authorize', 'login', 'admin', 'groups'],
      grantedScopes: gwsGrantedScopes,
    },
    worker: { baseUrl: '', tables: [] },
  }
  if (env.SALESFORCE_INSTANCE_URL) config.salesforce = { apiVersion: env.SALESFORCE_API_VERSION || '61.0', instanceHost: host(normalizeSalesforceUrl(env.SALESFORCE_INSTANCE_URL)), auditDays: 180 }
  if (env.ATLASSIAN_SITE_URL) {
    config.atlassian = {
      jira: env.ATLASSIAN_JIRA !== '0',
      confluence: env.ATLASSIAN_CONFLUENCE !== '0',
      audit: env.ATLASSIAN_JIRA_AUDIT !== '0',
      ...(env.ATLASSIAN_ORG_ID ? { orgId: env.ATLASSIAN_ORG_ID } : {}),
      ...(env.ATLASSIAN_ORG_ID && env.ATLASSIAN_ORG_AUDIT_API_KEY ? { orgAudit: { orgId: env.ATLASSIAN_ORG_ID } } : {}),
    }
  }
  if (env.GCP_PROJECTS || env.GCP_DISCOVER_PROJECTS === '1' || env.GCP_COLLECTOR_REFRESH_TOKEN) {
    const projects = list(env.GCP_PROJECTS)
    const discoveryLocations = list(env.GCP_DISCOVERY_LOCATIONS)
    const regions = list(env.GCP_REGIONS)
    config.gcp = {
      ...(projects.length ? { projects } : {}),
      discoverProjects: env.GCP_DISCOVER_PROJECTS === '1',
      ...(discoveryLocations.length ? { discoveryLocations } : {}),
      ...(regions.length ? { regions } : {}),
    }
  }
  if (env.ONEPASSWORD_SERVICE_ACCOUNT_TOKEN || env.ONEPASSWORD_EVENTS_TOKEN || env.ONEPASSWORD_ACCOUNT_ID) {
    config.onepassword = {
      ...(env.ONEPASSWORD_ACCOUNT_ID?.trim() ? { accountId: env.ONEPASSWORD_ACCOUNT_ID.trim() } : {}),
      ...(env.ONEPASSWORD_EVENTS_HOST?.trim() ? { eventsHost: env.ONEPASSWORD_EVENTS_HOST.trim() } : {}),
    }
  }
  if (env.M365_TENANT_ID?.trim()) {
    config.microsoft = {
      tenantId: env.M365_TENANT_ID.trim(),
    }
  }
  return config
}

/** 자격증명은 있는데 식별값이 비어 수집이 실패할 SaaS. doctor 와 collect 가 미리 알린다 */
export function missingIdentifiers(env: Record<string, string>, only?: string): string[] {
  const has = (...names: string[]) => names.every(n => env[n] || env[`${n}_FILE`])
  const onlySet = only ? new Set(only.split(',').map(s => s.trim()).filter(Boolean)) : null
  const wants = (p: string) => !onlySet || onlySet.has(p)
  const out: string[] = []
  if (wants('github') && (has('GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY') || has('GITHUB_OWNER_TOKEN')) && !env.GITHUB_ORG && !env.GITHUB_ORGS) {
    out.push('GITHUB_ORG (GitHub 조직 login)')
  }
  if (wants('slack') && (has('SLACK_COLLECTOR_USER_TOKEN') || has('SLACK_COLLECTOR_BOT_TOKEN')) && !env.SLACK_TEAM_ID) {
    out.push('SLACK_TEAM_ID (T 로 시작하는 워크스페이스 id — 워크스페이스 id 없음)')
  }
  if (wants('gws') && has('GWS_COLLECTOR_SA_KEY') && !env.GWS_ADMIN_SUBJECT) {
    out.push('GWS_ADMIN_SUBJECT (DWD 로 가장할 관리자 이메일)')
  }
  return out
}
