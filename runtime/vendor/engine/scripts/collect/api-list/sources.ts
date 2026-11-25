/**
 * IR 출처(공식 문서 묶음)마다 실제로 부를 호스트, 자격증명, 페이지 방식을 정한다.
 *
 * Profile binding 의 operation ID 는 `op:<출처>:<operation>` 모양이다. 출처가 같으면 호스트와 인증이 같다.
 * 호스트는 이 표에서만 나온다. 데이터나 Profile 의 문자열로 호스트를 만들지 않는다(SSRF 방지).
 * 표에 없거나 `blocked` 가 있는 출처의 operation 은 수집 API 목록에 후보로만 남고 실행되지 않는다.
 */
import type { Paginate } from '../lib/runner'
import type { Provider } from '../lib/store'
import type { CredentialId } from '../config'

export type AuthKind = 'github_app' | 'okta' | 'gws' | 'slack_org' | 'salesforce' | 'atlassian' | 'atlassian_org'

export interface SourceSpec {
  provider: Provider
  /** 호출 ID 접두사 (RG-<prefix>-…) */
  prefix: string
  auth: AuthKind
  credential: CredentialId
  /** 고정 호스트. 테넌트별 호스트는 hostFrom 으로 받는다 */
  base?: string
  /** 테넌트 호스트를 읽는 자격증명 이름과 붙일 경로 */
  hostFrom?: { credential: string; suffix?: string }
  paginate: Paginate
  /** GWS: 이 출처 호출에 쓸 DWD scope (scope 이름, https 접두사 없이). 경로로 고르는 경우 gwsScopeFor */
  gwsScope?: string
  /** 실행을 막는 이유. 있으면 후보로만 남는다 */
  blocked?: string
}

const OKTA = (blocked?: string): Omit<SourceSpec, 'prefix'> => ({ provider: 'okta', auth: 'okta', credential: 'CRED-OK-01', hostFrom: { credential: 'OKTA_ORG_URL' }, paginate: { kind: 'link' }, ...(blocked ? { blocked } : {}) })
const GWS = (base: string, gwsScope?: string, blocked?: string): Omit<SourceSpec, 'prefix'> => ({ provider: 'gws', auth: 'gws', credential: 'CRED-GW-01', base, paginate: { kind: 'google' }, ...(gwsScope ? { gwsScope } : {}), ...(blocked ? { blocked } : {}) })
const JIRA: Omit<SourceSpec, 'prefix'> = { provider: 'atlassian', auth: 'atlassian', credential: 'CRED-AT-01', hostFrom: { credential: 'ATLASSIAN_SITE_URL' }, paginate: { kind: 'offset', pageSize: 50 } }
// 조직 관리 API 는 본문 links.next 로 넘기는데 그 방식이 runner 에 없어 첫 쪽만 받는다
const ATLASSIAN_ORG = (base: string): Omit<SourceSpec, 'prefix'> => ({ provider: 'atlassian', auth: 'atlassian_org', credential: 'CRED-AT-ORG-01', base, paginate: { kind: 'none' } })

export const SOURCES: Record<string, SourceSpec> = {
  // GitHub REST. GraphQL 은 질의 문서가 있어야 해서 막는다
  gh_rest_ghec_next_2026_03_10_latest: { provider: 'github', prefix: 'GH', auth: 'github_app', credential: 'CRED-GH-01', base: 'https://api.github.com', paginate: { kind: 'link' } },
  gh_graphql_ghec_2026_10_13: { provider: 'github', prefix: 'GH', auth: 'github_app', credential: 'CRED-GH-01', base: 'https://api.github.com', paginate: { kind: 'none' }, blocked: 'graphql_query_document_required' },

  // Okta: 관리 API 와 같은 조직 호스트를 쓰는 출처만 실행한다
  okta_management_openapi: { prefix: 'OK', ...OKTA() },
  okta_oauth_openapi: { prefix: 'OK', ...OKTA() },
  okta_iga_openapi: { prefix: 'OK', ...OKTA() },
  okta_iga_requests_v1_openapi: { prefix: 'OK', ...OKTA() },
  okta_iga_requests_v2_openapi: { prefix: 'OK', ...OKTA() },
  okta_ai_resource_servers_a2aserverregistration: { prefix: 'OK', ...OKTA() },
  okta_ai_resource_servers_apiserverregistration: { prefix: 'OK', ...OKTA() },
  okta_ai_resource_servers_mcpserverregistration: { prefix: 'OK', ...OKTA() },
  okta_ai_resource_servers_resourceserverclientauthsettings: { prefix: 'OK', ...OKTA() },
  okta_ai_resource_servers_virtualmcpserverresource: { prefix: 'OK', ...OKTA() },
  okta_ai_workload_principals_agentconnections: { prefix: 'OK', ...OKTA() },
  okta_ai_workload_principals_agentproviders: { prefix: 'OK', ...OKTA() },
  okta_ai_workload_principals_agentpublickey: { prefix: 'OK', ...OKTA() },
  okta_ai_workload_principals_agentregistration: { prefix: 'OK', ...OKTA() },
  okta_ai_workload_principals_delegationlinks: { prefix: 'OK', ...OKTA() },
  okta_ai_workload_principals_virtualmcpconnections: { prefix: 'OK', ...OKTA() },
  okta_ai_workload_principals_virtualmcpregistration: { prefix: 'OK', ...OKTA() },
  okta_ai_workload_principals_workloadprincipaloperations: { prefix: 'OK', ...OKTA() },
  // 최종 사용자 본인 문맥 API 는 서비스 앱 토큰으로 의미가 없다
  okta_idp_openapi: { prefix: 'OK', ...OKTA('end_user_context_api') },
  okta_iga_enduser_openapi: { prefix: 'OK', ...OKTA('end_user_context_api') },
  // 조직 호스트와 다른 제품 호스트(Okta Privileged Access, Advanced Server Access, Aerial)
  okta_opa_openapi: { prefix: 'OK', ...OKTA('separate_product_host_not_configured') },
  okta_asa_openapi: { prefix: 'OK', ...OKTA('separate_product_host_not_configured') },
  okta_aerial_openapi: { prefix: 'OK', ...OKTA('separate_product_host_not_configured') },

  // Google Workspace: 출처마다 서비스 호스트가 다르다. DWD 에 허용된 scope 만 실행된다
  gws_directory: { prefix: 'GW', ...GWS('https://admin.googleapis.com') },
  gws_datatransfer: { prefix: 'GW', ...GWS('https://admin.googleapis.com', 'admin.datatransfer.readonly') },
  gws_drive: { prefix: 'GW', ...GWS('https://www.googleapis.com/drive/v3', 'drive.metadata.readonly') },
  gws_calendar: { prefix: 'GW', ...GWS('https://www.googleapis.com/calendar/v3', 'calendar.readonly') },
  gws_gmail: { prefix: 'GW', ...GWS('https://gmail.googleapis.com', 'gmail.settings.basic') },
  gws_cloudidentity: { prefix: 'GW', ...GWS('https://cloudidentity.googleapis.com') },
  gws_alertcenter: { prefix: 'GW', ...GWS('https://alertcenter.googleapis.com', 'apps.alerts') },
  gws_groupssettings: { prefix: 'GW', ...GWS('https://www.googleapis.com/groups/v1/groups', 'apps.groups.settings') },
  gws_people: { prefix: 'GW', ...GWS('https://people.googleapis.com', 'contacts.readonly') },
  gws_forms: { prefix: 'GW', ...GWS('https://forms.googleapis.com', 'forms.body.readonly') },
  gws_script: { prefix: 'GW', ...GWS('https://script.googleapis.com', 'script.projects.readonly') },
  gws_drivelabels: { prefix: 'GW', ...GWS('https://drivelabels.googleapis.com', 'drive.labels.readonly') },
  // scope 가 자원마다 다르다 (gwsScopeFor)
  gws_chromemanagement: { prefix: 'GW', ...GWS('https://chromemanagement.googleapis.com') },
  gws_meet: { prefix: 'GW', ...GWS('https://meet.googleapis.com', 'meetings.space.readonly') },
  gws_vault: { prefix: 'GW', ...GWS('https://vault.googleapis.com', 'ediscovery.readonly') },
  gws_workspaceevents: { prefix: 'GW', ...GWS('https://workspaceevents.googleapis.com', undefined, 'subscription_owner_context_required') },

  // Atlassian 사이트 API (기본 인증). 조직 관리 API 는 조직 API 키(CRED-AT-ORG-01)로 부른다. SCIM 은 디렉터리 SCIM 키가 따로 있어야 한다.
  // 사용자 관리 API 는 범위 없는 조직 키(manage:org)만 받는다. 범위 지정 키는 범위를 전부 줘도 403 insufficientScope (2026-10-30)
  jira_openapi_v3: { prefix: 'JI', ...JIRA },
  jira_software_openapi: { prefix: 'JI', ...JIRA },
  jsm_openapi: { prefix: 'JI', ...JIRA },
  confluence_openapi_v1: { prefix: 'CF', ...JIRA, paginate: { kind: 'none' } },
  confluence_openapi_v2: { prefix: 'CF', ...JIRA, hostFrom: { credential: 'ATLASSIAN_SITE_URL', suffix: '/wiki/api/v2' }, paginate: { kind: 'confluence' } },
  atlassian_admin_organization: { prefix: 'AT', ...ATLASSIAN_ORG('https://api.atlassian.com/admin') },
  atlassian_admin_api_access: { prefix: 'AT', ...ATLASSIAN_ORG('https://api.atlassian.com/admin/api-access/v1') },
  atlassian_admin_user_management: { prefix: 'AT', ...ATLASSIAN_ORG('https://api.atlassian.com'), blocked: 'unscoped_org_key_required' },
  atlassian_admin_user_provisioning: { prefix: 'AT', ...JIRA, base: 'https://api.atlassian.com', hostFrom: undefined, blocked: 'scim_directory_key_not_configured' },

  // Salesforce: sObject 는 SOQL query 하나로 읽는다(FIELDS(STANDARD))
  sf_object_reference: { provider: 'salesforce', prefix: 'SF', auth: 'salesforce', credential: 'CRED-SF-01', hostFrom: { credential: 'SALESFORCE_INSTANCE_URL' }, paginate: { kind: 'salesforce' } },

  // Slack Web API (메서드 이름 = 경로). 조직 사용자 토큰
  slack_docs_methods: { provider: 'slack', prefix: 'SL', auth: 'slack_org', credential: 'CRED-SL-01', base: 'https://slack.com/api', paginate: { kind: 'slack' } },
  slack_openapi_legacy: { provider: 'slack', prefix: 'SL', auth: 'slack_org', credential: 'CRED-SL-01', base: 'https://slack.com/api', paginate: { kind: 'slack' } },
  slack_docs_legal_hold: { provider: 'slack', prefix: 'SL', auth: 'slack_org', credential: 'CRED-SL-01', base: 'https://slack.com/api', paginate: { kind: 'slack' }, blocked: 'legal_hold_admin_scope' },
  slack_inventory: { provider: 'slack', prefix: 'SL', auth: 'slack_org', credential: 'CRED-SL-01', base: 'https://slack.com/api', paginate: { kind: 'slack' }, blocked: 'scim_api_not_web_api' },
}

/** 수집 API 목록 실행이 허용하는 호스트. 만든 URL 의 호스트가 여기 없으면 부르지 않는다 */
export function trustedHost(provider: Provider, host: string): boolean {
  const h = host.toLowerCase()
  switch (provider) {
    case 'github': return h === 'api.github.com'
    case 'okta': return /\.(okta|oktapreview|okta-emea)\.com$/.test(h)
    case 'gws': return h === 'www.googleapis.com' || /^[a-z]+\.googleapis\.com$/.test(h)
    case 'slack': return h === 'slack.com'
    case 'salesforce': return /\.(salesforce|force)\.com$/.test(h)
    case 'atlassian': return h.endsWith('.atlassian.net') || h === 'api.atlassian.com'
    default: return false
  }
}

/**
 * Directory API 는 자원마다 scope 가 다르다. 경로의 자원 이름으로 고른다.
 * 모르는 자원은 null (실행하지 않고 후보로 남긴다).
 */
export function gwsScopeFor(source: string, template: string): string | null {
  const spec = SOURCES[source]
  // 원천 기본 scope 로는 403 insufficient_scope 인 호출. 응답 www-authenticate 가 요구한 scope 중 읽기 쪽을 고른다 (2026-11-19 실측)
  if (source === 'gws_gmail' && /\/labels\b/.test(template)) return 'gmail.labels' // 요구 목록에 readonly·metadata 도 있으나 메일 내용·머리글까지 열린다
  if (source === 'gws_drive' && /\/apps\b/.test(template)) return 'drive.apps.readonly'
  if (source === 'gws_drive' && /\/teamdrives\b/.test(template)) return 'drive.readonly' // 요구 목록이 drive, drive.readonly 뿐이다
  if (spec?.gwsScope) return spec.gwsScope
  if (source === 'gws_cloudidentity') {
    if (template.includes('/inboundSamlSsoProfiles') || template.includes('/inboundSsoAssignments')) return 'cloud-identity.inboundsso.readonly'
    if (template.includes('/policies')) return 'cloud-identity.policies.readonly'
    if (template.includes('/allowlistedDomains')) return 'cloud-identity.allowlisteddomains.readonly'
    if (template.includes('/devices')) return 'cloud-identity.devices.readonly'
    if (template.includes('/groups')) return 'cloud-identity.groups.readonly'
    return null
  }
  if (source === 'gws_chromemanagement') {
    // Discovery 문서의 메서드별 scope (2026-11-02). 하나의 reports scope 로는 telemetry, profiles, apps 가 ACCESS_TOKEN_SCOPE_INSUFFICIENT 다
    if (template.includes('/telemetry/')) return 'chrome.management.telemetry.readonly'
    if (template.includes('/profiles')) return 'chrome.management.profiles.readonly'
    if (template.includes('/apps')) return 'chrome.management.appdetails.readonly'
    if (template.includes('/securityInsights')) return 'chrome.management.securityinsights.readonly'
    // Discovery 에 scope 가 없다. 실측(2026-11-02)으로 이 scope 만 토큰 scope 오류가 아닌 권한 판정까지 갔다
    if (/\/(chromeBrowsers|enrollmentTokens)\b/.test(template)) return 'admin.directory.device.chromebrowsers.readonly'
    if (template.includes('/connectorConfigs')) return 'chrome.management.connectors.readonly' // 2026-11-19 실측 403 insufficient_scope 가 요구
    return 'chrome.management.reports.readonly'
  }
  if (source !== 'gws_directory') return null
  const t = template.replace('/admin/directory/v1', '')
  const rules: Array<[RegExp, string]> = [
    [/\/(asps|tokens|verificationCodes)\b/, 'admin.directory.user.security'],
    [/\/users\/\{[^}]+\}\/(aliases|photos)\b/, 'admin.directory.user.readonly'],
    [/^\/users\b/, 'admin.directory.user.readonly'],
    [/\/groups\/\{[^}]+\}\/(members|hasMember)\b/, 'admin.directory.group.member.readonly'],
    [/^\/groups\b/, 'admin.directory.group.readonly'],
    [/\/(roles|roleassignments)\b/, 'admin.directory.rolemanagement.readonly'],
    [/\/orgunits\b/, 'admin.directory.orgunit.readonly'],
    [/\/domains\b|\/domainaliases\b/, 'admin.directory.domain.readonly'],
    [/\/schemas\b/, 'admin.directory.userschema.readonly'],
    [/\/resources\b/, 'admin.directory.resource.calendar.readonly'],
    [/\/devices\/chromeos\b/, 'admin.directory.device.chromeos.readonly'],
    [/\/devices\/mobile\b/, 'admin.directory.device.mobile.readonly'],
    [/\/chrome\/(printers|printServers)\b/, 'admin.chrome.printers.readonly'], // 2026-11-19 실측 403 insufficient_scope 가 요구
    [/^\/customers?\b/, 'admin.directory.customer.readonly'],
  ]
  for (const [re, scope] of rules) if (re.test(t)) return scope
  return null
}
