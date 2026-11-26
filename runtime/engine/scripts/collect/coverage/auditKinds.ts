/**
 * 감사 로그 감지 — 수집 목록 밖의 종류가 테넌트에서 생기거나 바뀌면 알린다.
 *
 * 수집은 정해진 호출 목록으로 종류를 본다. 목록에 없는 종류(예: Okta 이벤트 훅)는 객체 목록에 나오지 않는다.
 * 감사 로그는 종류를 가리지 않고 변경을 남기므로, 변경 이벤트의 대상 종류를 규격 종류에 맞춰 보고
 * - 수집하지 않는 종류가 바뀌었다 (uncollected)
 * - 수집이 막힌 종류가 바뀌었다 (blocked)
 * - 규격 종류에 맞출 수 없는 처음 보는 종류 (unknown)
 * 를 낸다. 로그인, 토큰 발급, 정책 평가 같은 일상 이벤트는 대상 종류만 세고 경보에서 뺀다.
 *
 * 입력은 수집한 감사 로그 원본 전부다: Okta System Log(OK-12), GitHub 조직 감사 로그(GH-17, GH-19), Slack Audit Logs(SL-11), GWS Reports(GW-10).
 */
import type { RawSet } from '../shared/raw'
import { streamRows } from '../shared/observations'
import type { CollectorProvider, CoverageStatus, ProviderCoverage } from './catalogCoverage'

export interface AuditKind {
  provider: CollectorProvider
  /** 로그가 적은 대상 종류 (Okta target.type, GitHub action 앞부분, Slack entity.type, GWS 앱:이벤트 묶음) */
  kind: string
  /** 맞춘 규격 종류 이름. 없으면 처음 보는 종류 */
  catalogName?: string
  status?: CoverageStatus
  changes: number
  routine: number
  examples: string[]
  firstAt?: string
  lastAt?: string
  alert?: 'uncollected' | 'blocked' | 'unknown'
}

/** 대상 종류 → 규격 종류 이름. null 은 객체가 아닌 것 (토큰 발급 기록, 메일 발송 등) */
const OKTA_TARGET: Record<string, string | null> = {
  AppInstance: 'Application', AppUser: 'AppUser', AppGroup: 'ApplicationGroupAssignment', User: 'User', UserGroup: 'Group',
  PolicyRule: 'PolicyRule', Rule: 'PolicyRule', PolicyEntity: 'Policy', ResourceSet: 'ResourceSet', RESOURCE_SET: 'ResourceSet',
  Role: 'IamRole', ROLE: 'IamRole', CUSTOM_ROLE: 'IamRole', ProfileMapping: 'ProfileMapping', GroupPushMapping: 'GroupPushMapping',
  AuthenticatorEnrollment: 'AuthenticatorEnrollment', AuthenticatorMethod: 'AuthenticatorEnrollment', refresh_token: 'OAuth2RefreshToken',
  EventHook: 'EventHook', InlineHook: 'InlineHook', IdentityProvider: 'IdentityProvider', AuthorizationServer: 'AuthorizationServer',
  NetworkZone: 'zones', Zone: 'zones', TrustedOrigin: 'TrustedOrigin', Token: 'ApiToken', ApiToken: 'ApiToken', LogStream: 'LogStream', Device: 'Device',
  access_token: null, id_token: null, code: null, email: null, Session: null, DeprovisionTask: null,
}
/** Okta 이벤트 종류 앞부분 → 규격 종류 (대상 종류가 없거나 모호할 때) */
const OKTA_FAMILY: Array<[RegExp, string]> = [
  [/^event_hook\./, 'EventHook'], [/^inline_hook\./, 'InlineHook'], [/^system\.idp\./, 'IdentityProvider'], [/^(app\.)?oauth2\.as\./, 'AuthorizationServer'],
  [/^zone\./, 'zones'], [/^security\.trusted_origin\./, 'TrustedOrigin'], [/^system\.api_token\./, 'ApiToken'], [/^system\.log_stream\./, 'LogStream'],
  [/^iam\.role\./, 'IamRole'], [/^iam\.resourceset\./, 'ResourceSet'], [/^group\.user_membership\./, 'Group'], [/^application\./, 'Application'],
]
const OKTA_ROUTINE = /^(user\.authentication|user\.session|policy\.evaluate|app\.oauth2\.(token|authorize)|system\.email|user\.account\.subscriptions|system\.import)/

const GITHUB_PREFIX: Record<string, string> = {
  repo: 'Repository', org: 'Organization', hook: 'Webhook', personal_access_token: 'Organization Programmatic Access Grant',
  org_credential_authorization: 'Credential Authorization', integration_installation: 'GitHub App Installation Registration', team: 'Team',
  protected_branch: 'Branch Protection Rule', repository_ruleset: 'Repository ruleset', workflows: 'Workflow', public_key: 'Deploy Key',
  deploy_key: 'Deploy Key', environment: 'Environment', codespaces: 'Codespace', packages: 'Package', ip_allow_list: 'IpAllowListEntry',
  ip_allow_list_entry: 'IpAllowListEntry', audit_log_streaming: 'Audit log stream', private_repository_forking: 'Repository', business: 'Enterprise',
}
const GITHUB_SECRET: Array<[RegExp, string]> = [[/actions_secret/, 'Actions Secret'], [/dependabot_secret/, 'Dependabot Secret'], [/codespaces_secret/, 'Codespaces Secret'], [/self_hosted_runner/, 'Self hosted runners'], [/runner_group/, 'Runner Group']]

const SLACK_ENTITY: Record<string, string | null> = {
  channel: 'conversation', user: 'user', app: 'Slack App Installation Registration', workflow: 'workflow', workspace: 'workspace', enterprise: 'enterprise',
  role: 'role', account_type_role: 'role-assignment', file: 'File', usergroup: 'usergroup', canvas: 'canvas', message: 'Message', barrier: 'barrier',
  function: 'function', trigger: 'trigger', datastore: 'datastore', list: 'Slack List', huddle: null,
}
const SLACK_ROUTINE = /^(user_login|user_logout|user_channel_join|user_channel_leave|file_downloaded|file_uploaded)$/

const GWS_ADMIN: Array<[RegExp, string]> = [
  [/API_CLIENT|DOMAIN_WIDE_DELEGATION/, 'DomainWideDelegation'], [/ORG_UNIT/, 'OrgUnit'], [/PRIVILEGE|ROLE/, 'RoleAssignment'], [/GROUP/, 'Group'],
  [/SSO|SAML/, 'InboundSamlSsoProfile'], [/TRUSTED_DOMAIN|ALLOWLIST/, 'AllowlistedDomain'], [/DOMAIN/, 'Domains'], [/MOBILE/, 'MobileDevice'],
  [/CHROME/, 'ChromeOsDevice'], [/TOKEN|OAUTH/, 'Token'], [/APPLICATION_SETTING|SETTING/, 'Policy'], [/USER|PASSWORD|LICENSE/, 'User'],
]

function okta(row: any): Array<{ kind: string; name?: string | null; label: string; routine: boolean }> {
  const type = String(row.eventType ?? '')
  const routine = OKTA_ROUTINE.test(type) || row.outcome?.result === 'FAILURE'
  const family = OKTA_FAMILY.find(([re]) => re.test(type))?.[1]
  const targets = (row.target ?? []) as Array<{ type?: string }>
  if (!targets.length) return [{ kind: family ?? `event:${type.split('.').slice(0, 2).join('.')}`, name: family, label: type, routine }]
  return targets.map(t => {
    const kind = String(t.type ?? '')
    const mapped = kind in OKTA_TARGET ? OKTA_TARGET[kind] : kind.startsWith('ROLE_') ? 'IamRole' : family
    return { kind, name: mapped, label: type, routine }
  })
}

function github(row: any) {
  const action = String(row.action ?? '')
  const secret = GITHUB_SECRET.find(([re]) => re.test(action))
  const prefix = action.split('.')[0]
  const kind = secret ? secret[1] : prefix
  return [{ kind, name: secret?.[1] ?? GITHUB_PREFIX[prefix], label: action, routine: false }]
}

function slack(row: any) {
  const kind = String(row.entity?.type ?? 'unknown')
  const action = String(row.action ?? '')
  return [{ kind, name: kind in SLACK_ENTITY ? SLACK_ENTITY[kind] : undefined, label: action, routine: SLACK_ROUTINE.test(action) }]
}

function gws(row: any) {
  const app = String(row.id?.applicationName ?? '')
  return ((row.events ?? []) as Array<{ name?: string }>).map(ev => {
    const name = String(ev.name ?? '')
    if (app === 'login') return { kind: 'login', name: 'User', label: name, routine: true }
    if (app === 'token') return { kind: 'token', name: 'Token', label: name, routine: name === 'authorize' }
    if (app === 'drive') return { kind: /acl|access|visibility|permission|share/i.test(name) ? 'drive:permission' : 'drive:file', name: /acl|access|visibility|permission|share/i.test(name) ? 'Permission' : 'File', label: name, routine: /^(view|search|access_item_content|download|preview)$/.test(name) }
    if (app === 'admin') {
      const hit = GWS_ADMIN.find(([re]) => re.test(name))
      return { kind: `admin:${hit?.[1] ?? name}`, name: hit?.[1], label: name, routine: false }
    }
    return { kind: `${app}:${name}`, name: undefined, label: name, routine: false }
  })
}

const at = (provider: CollectorProvider, row: any): string | undefined =>
  provider === 'okta' ? row.published : provider === 'github' ? (row['@timestamp'] ? new Date(row['@timestamp']).toISOString() : undefined) : provider === 'slack' ? (row.date_create ? new Date(row.date_create * 1000).toISOString() : undefined) : row.id?.time

export function auditKinds(raw: RawSet, coverage: ProviderCoverage[]): AuditKind[] {
  // 같은 이름의 규격 종류가 여럿일 수 있다 (GWS User 는 Directory 사용자와 Postmaster 사용자). 가장 잘 아는 쪽을 쓴다
  const RANK: CoverageStatus[] = ['collected', 'absorbed', 'basic', 'empty', 'blocked', 'not_collected', 'no_api']
  const statusOf = (provider: CollectorProvider, name?: string | null) => {
    if (!name) return undefined
    const all = coverage.find(c => c.provider === provider)?.types.filter(x => x.name.toLowerCase() === name.toLowerCase()) ?? []
    return all.map(t => t.status).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0]
  }
  const known = (provider: CollectorProvider, name?: string | null) => !!name && !!coverage.find(c => c.provider === provider)?.types.some(x => x.name.toLowerCase() === name.toLowerCase())
  const sources: Array<[CollectorProvider, any[], (row: any) => Array<{ kind: string; name?: string | null; label: string; routine: boolean }>]> = [
    ['okta', streamRows(raw, 'okta', 'OK-12', 'uuid'), okta],
    ['github', [...streamRows(raw, 'github', 'GH-17', '_document_id'), ...streamRows(raw, 'github', 'GH-19', '_document_id')], github],
    ['slack', streamRows(raw, 'slack', 'SL-11', 'id', 'entries'), slack],
    ['gws', streamRows(raw, 'gws', 'GW-10', 'etag', 'items'), gws],
  ]
  const kinds = new Map<string, AuditKind>()
  for (const [provider, rows, read] of sources) {
    for (const row of rows) {
      const when = at(provider, row)
      for (const hit of read(row)) {
        if (hit.name === null) continue
        const key = `${provider}|${hit.kind}`
        const k = kinds.get(key) ?? { provider, kind: hit.kind, catalogName: known(provider, hit.name) ? hit.name! : undefined, changes: 0, routine: 0, examples: [] }
        if (hit.routine) k.routine++
        else {
          k.changes++
          if (k.examples.length < 4 && !k.examples.includes(hit.label)) k.examples.push(hit.label)
        }
        if (when && (!k.firstAt || when < k.firstAt)) k.firstAt = when
        if (when && (!k.lastAt || when > k.lastAt)) k.lastAt = when
        kinds.set(key, k)
      }
    }
  }
  for (const k of kinds.values()) {
    k.status = statusOf(k.provider, k.catalogName)
    if (!k.changes) continue
    if (!k.catalogName) k.alert = 'unknown'
    else if (k.status === 'not_collected' || k.status === 'no_api') k.alert = 'uncollected'
    else if (k.status === 'blocked') k.alert = 'blocked'
  }
  return [...kinds.values()].sort((a, b) => Number(!!b.alert) - Number(!!a.alert) || b.changes - a.changes)
}
