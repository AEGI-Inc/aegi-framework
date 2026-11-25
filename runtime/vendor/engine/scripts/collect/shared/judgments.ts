/**
 * 판단표 G4(2026-10-21)의 공통 판정값. 모든 SaaS 정규화가 끝난 뒤 한 번 돈다.
 * 규격: aegi-knowledge schema/specs/Interface_Spec_v3.md 「모든 interface 공통 값」, 「Principal」, 「Policy」.
 * 결정 기록: aegi-knowledge docs/decisions/OBJECT_MODEL_G4_2026-10-21.md
 *
 * - origin (G4-Q04): 원본 필드로 정할 수 있을 때만 둔다. 정할 수 없으면 비운다(지어내지 않는다).
 * - account_kind (G4-Q07): 정규화기가 원본 필드로 이미 둔 값은 덮지 않는다. 여기서는 봇 객체처럼 타입으로 정해지는 것만 채운다.
 *   앱으로 보는 값은 동일인 연결(crosswalk natural_key)이 사람이 아닌 계정을 거르는 칸과 같게 둔다(Relation 주담당 2026-11-01 결정,
 *   aegi-knowledge crosswalk.yaml decided.app_account_filter): Salesforce UserType 은 그 목록, Slack 은 is_bot 만. 거기에 더해
 *   Salesforce 가 조직마다 만드는 Chatter Expert 계정은 Chatter Free(CsnOnly)여도 사람이 아니라 app 으로 따로 가른다.
 * - activation (G4-Q06): Salesforce 권한 세트 Type: Session. 그 권한 세트를 역할 칸에 둔 관계에도 같은 값을 둔다.
 * - assignment_count (G4-Q05): origin 이 있는 객체만 센다. 역할 칸에 둔 관계와 양끝으로 둔 관계 수이고,
 *   그 객체가 상위 범위에 속한다는 contained_in, registered_in(그 객체에서 나가는 것)은 세지 않는다.
 * - 관계 속성 binding: ambient (Relation 담당 10-29 결정 C3, aegi-knowledge#106 Effective_Access_Schema_v1 「인스턴스 층」): Okta 는 「전원」을
 *   BUILT_IN 그룹 Everyone 을 include 하는 모양으로 적는다. 그 그룹으로 가는 applies_to 는 겉모양(Profile 의 explicit)과 달리 전원이다.
 *   고르는 그룹은 origin platform_builtin 을 받는 Okta 그룹과 같다(type BUILT_IN, 이름 Everyone).
 *   그룹 목록(OK-03)을 못 읽어 그룹 객체가 빈 껍데기면 고르지 못하고 explicit 그대로 둔다. excludes, 앱 배정은 C3 밖이라 건드리지 않는다.
 */
import type { FixtureObject } from '../../../src/model/object'
import type { DatasetV2 } from './dataset'
import { SEMANTIC_RECORDS } from '../../../src/ontology/generated'

type Origin = 'platform_builtin' | 'platform_default' | 'tenant_custom'

/**
 * Atlassian 사이트 기본 그룹(<제품>-admins-<사이트>, -user-access-admins-, -users-, -guests-): 사전 semantic_mapping.yaml records 의
 * Atlassian 그룹 규칙(basis vendor_default) name_regex 를 그대로 쓴다. 기본 그룹 권한을 내는 규칙과 기본 그룹 판정(origin)이 같은 정규식이다.
 * 그 규칙이 고르는 객체 종류(FoundGroup, 프로필 정규화의 Jira 그룹)와 Group(Confluence 그룹, 옛 정규화기)을 그룹으로 본다
 */
const ATLASSIAN_SITE_GROUP_RULES = SEMANTIC_RECORDS.filter(r => {
  const src = r.select.source as { provider?: string; object_type?: string } | undefined
  return src?.provider === 'atlassian' && !!src.object_type && !!r.name_regex?.name && r.emit.some(e => e.basis === 'vendor_default')
})
export const ATLASSIAN_SITE_DEFAULT_GROUP = ATLASSIAN_SITE_GROUP_RULES.map(r => new RegExp(r.name_regex!.name))
export const ATLASSIAN_GROUP_TYPES = new Set(['Group', ...ATLASSIAN_SITE_GROUP_RULES.map(r => (r.select.source as { object_type: string }).object_type)])
/**
 * 사이트 역할을 주지 않는(사전 records 가 권한을 내지 않는) Atlassian 이 만드는 그룹. 이름이 고정이다.
 * - 앱 사용자 그룹 atlassian-addons, atlassian-addons-admin: Atlassian 이 관리하며 Jira 관리자 전역 권한을 가진다(그 권한은 수집한 전역 권한으로 따로 들어온다).
 *   이전 도구가 권한 상승을 막으려고 옮기지 않는 관리 그룹 목록에 있다 https://support.atlassian.com/migration/docs/reassign-admins-to-blocklisted-admin-groups/
 *   https://support.atlassian.com/jira/kb/unable-to-add-jira-add-on-cannot-make-atlassian-addons-admin-an-administrator-group/
 * - 조직·사이트 관리 그룹과 2021-08 이전 이름(사이트 꼬리 없음) https://support.atlassian.com/user-management/docs/default-groups-and-permissions/
 *   statuspage-adminstrators 는 문서 철자 그대로다. developers 는 2014-02 이전 Jira 의 jira-developers 이름이다
 */
const ATLASSIAN_SYSTEM_GROUP_NAMES = new Set(['atlassian-addons', 'atlassian-addons-admin', 'system-administrators', 'site-admins', 'org-admins', 'administrators', 'users', 'trusted-users', 'jira-users', 'jira-administrators', 'jira-software-users', 'jira-developers', 'developers', 'service-desk-agents', 'confluence-users', 'confluence-administrators', 'opsgenie-users', 'statuspage-users', 'statuspage-adminstrators'])
/**
 * origin 만 정하는 사이트 기본 그룹 꼴. Atlassian 이 만들지만 사전 records 가 사이트 권한을 일부러 내지 않는 것(같은 문서):
 * jira-servicemanagement-customers(고객 포털만), focus-viewers(보기만), guard-detect-users(쓰이지 않고 권한 없음),
 * trusted-users(없어진 역할. 옛 권한은 넓은 -users- 꼴에 우연히 걸린 것이라 records 에서 빠졌다, 검증 세션 11-18)
 */
const ATLASSIAN_ORIGIN_ONLY_GROUP = /^(jira-servicemanagement-customers|focus-viewers|guard-detect-users|trusted-users)-.+$/
/** Jira 가 만드는 프로젝트 역할 (회사 관리형 기본 + 팀 관리형 프로젝트마다 생기는 것) */
const JIRA_DEFAULT_ROLES = new Set(['Administrators', 'Developers', 'Users', 'Service Desk Team', 'Service Desk Customers', 'atlassian-addons-project-access', 'Administrator', 'Member', 'Viewer', 'jira-guest-member'])
/** Jira 기본 권한 스킴과 팀 관리형 프로젝트가 만드는 스킴 */
const JIRA_DEFAULT_SCHEME = /^(Default .*[Ss]cheme|.+: Simplified Permission Scheme)$/
/**
 * Salesforce 에서 사람이 아닌 UserType. crosswalk natural_key 의 Salesforce 줄이 빼는 목록과 같다(judgments.test.ts 가 맞춰 본다).
 * Chatter Free(CsnOnly)는 사람이다(aegi-knowledge ontology/README.md, S9 시험의 SF-C)
 */
export const SF_APP_USER_TYPES = new Set(['AutomatedProcess', 'CloudIntegrationUser', 'Guest'])

/**
 * Chatter Expert: Salesforce 가 Chatter 안내 글을 올리려고 조직마다 만드는 계정이다(Chatter REST API 「User Summary」 userType System).
 * UserType 은 CsnOnly 다. 이름은 관리자가 바꿀 수 있어 사용자 이름 앞부분(chatty.)도 같이 본다(10-27 실측 계정에서 둘 다 맞음)
 */
function isChatterExpert(p: Record<string, unknown>): boolean {
  return p.user_type === 'CsnOnly' && (p.name === 'Chatter Expert' || String(p.username ?? '').startsWith('chatty.'))
}

/** Microsoft 퍼스트 파티 앱을 게시하는 서비스 테넌트 id(learn.microsoft.com 「Verify first-party Microsoft applications in sign-in reports」) */
const MICROSOFT_SERVICES_TENANT = 'f8cdef31-a31e-4b4a-93e4-5f571e91255a'

export function originOf(o: FixtureObject): Origin | undefined {
  const c = o.canonical, p = c.properties ?? {}, t = c.object_type, name = String(p.name ?? p.label ?? '')
  switch (c.provider) {
    case 'okta':
      if (t === 'Group') return p.type === 'BUILT_IN' ? (name === 'Everyone' ? 'platform_builtin' : 'platform_default') : p.type === 'OKTA_GROUP' ? 'tenant_custom' : undefined
      if (t === 'Policy') return p.system === true ? 'platform_default' : p.system === false ? 'tenant_custom' : undefined
      if (t === 'AuthenticatorBase') return typeof p.key === 'string' ? (p.key.startsWith('okta_') ? 'platform_default' : 'tenant_custom') : undefined
      return undefined
    case 'salesforce':
      if (t === 'PermissionSet') return p.type === 'Regular' ? 'tenant_custom' : p.type ? 'platform_default' : undefined
      // 프로필 소유 권한 세트의 IsCustom (overlay salesforce-profile 의 is_custom)
      if (t === 'Profile') return p.is_custom === true ? 'tenant_custom' : p.is_custom === false ? 'platform_default' : undefined
      return undefined
    case 'github':
      if (t === 'Organization Role') return p.source === 'Predefined' ? 'platform_default' : p.source === 'Organization' ? 'tenant_custom' : undefined
      if (t === 'Organization Custom Repository Role') return 'tenant_custom'
      return undefined
    case 'gws':
      if (t === 'Role') return p.isSystemRole === true ? 'platform_default' : p.isSystemRole === false ? 'tenant_custom' : undefined
      return undefined
    case 'microsoft':
      // Entra 역할 정의 isBuiltIn(Graph unifiedRoleDefinition). 기본 역할은 테넌트마다 같은 정의다
      if (t === 'DirectoryRole') return p.isBuiltIn === true ? 'platform_default' : p.isBuiltIn === false ? 'tenant_custom' : undefined
      // Microsoft 서비스 테넌트(f8cdef31-…)가 게시한 앱의 서비스 주체는 테넌트를 만들 때 Microsoft 가 넣는다. 그 밖의 게시자는 동의 · 추가해야 생긴다
      if (t === 'ServicePrincipal') return typeof p.appOwnerOrganizationId === 'string' ? (p.appOwnerOrganizationId === MICROSOFT_SERVICES_TENANT ? 'platform_default' : 'tenant_custom') : undefined
      return undefined
    case 'atlassian':
      if (t === 'SpecialPrincipal') return 'platform_builtin'
      if (ATLASSIAN_GROUP_TYPES.has(t)) return ATLASSIAN_SITE_DEFAULT_GROUP.some(r => r.test(name)) || ATLASSIAN_SYSTEM_GROUP_NAMES.has(name) || ATLASSIAN_ORIGIN_ONLY_GROUP.test(name) ? 'platform_default' : 'tenant_custom'
      if (t === 'ProjectRole') return JIRA_DEFAULT_ROLES.has(name) ? 'platform_default' : 'tenant_custom'
      if (t === 'PermissionScheme') return JIRA_DEFAULT_SCHEME.test(name) ? 'platform_default' : 'tenant_custom'
      return undefined
    default:
      return undefined
  }
}

/** Okta 의 전원 그룹 — 판단표가 platform_builtin 으로 두는 Okta 그룹(C3) */
function isOktaEveryone(o: FixtureObject): boolean {
  return o.canonical.provider === 'okta' && o.canonical.object_type === 'Group' && originOf(o) === 'platform_builtin'
}

/** Slack 사용자 목록(users.list, admin.users.list)에서 읽은 계정인가. 관측의 api 로 본다 */
const SLACK_USER_LIST_API = /\/api\/(admin\.)?users\.list(\?|$)/
function inSlackUserList(o: FixtureObject): boolean {
  return (o.canonical.source?.observations ?? []).some(x => SLACK_USER_LIST_API.test(String((x as { api?: unknown }).api ?? '')))
}

/**
 * opts.slackUserListCollected: 이 수집본에 Slack 사용자 목록이 있다. 그때 목록에 없고 감사 로그 행위자로만 나온 Slack 계정은 system 이다
 * (Slack User, Salesforce System User 같은 플랫폼 행위자). 이름이 아니라 목록에 없다는 사실로 가른다.
 * 목록을 수집하지 못한 수집본에서는 가르지 않는다(aegi-knowledge crosswalk.yaml decided.audit_only_actor_system, 2026-11-10)
 */
export function accountKindOf(o: FixtureObject, opts: { slackUserListCollected?: boolean } = {}): 'human' | 'app' | 'system' | undefined {
  const c = o.canonical, p = c.properties ?? {}
  if (c.provider === 'slack' && c.object_type === 'bot') return 'app'
  if (c.provider === 'slack' && c.object_type === 'user' && opts.slackUserListCollected && !inSlackUserList(o)) return 'system'
  // is_app_user 는 「부르는 앱을 승인한 사용자」라 사람이다. 봇 사용자만 app (Profile slack-200_members 의 account_kind 와 같다)
  if (c.provider === 'slack' && c.object_type === 'user') return p.is_bot === true ? 'app' : 'human'
  if (c.provider === 'salesforce' && c.object_type === 'User') return SF_APP_USER_TYPES.has(String(p.user_type)) || isChatterExpert(p) ? 'app' : p.user_type ? 'human' : undefined
  if (c.provider === 'github' && c.object_type === 'User Account') return p.type === 'Bot' ? 'app' : p.type === 'User' ? 'human' : undefined
  return undefined
}

const STRUCTURAL_OUT = new Set(['contained_in', 'registered_in'])

export function applyG4Judgments(ds: DatasetV2): void {
  const objects = [...ds.objects.values()]
  const session = new Set<string>()
  const everyone = new Set(objects.filter(isOktaEveryone).map(o => o.fixture_key))
  const slackUserListCollected = objects.some(o => o.canonical.provider === 'slack' && o.canonical.object_type === 'user' && inSlackUserList(o))
  for (const o of objects) {
    const origin = originOf(o)
    if (origin) ds.setJudged(o.fixture_key, 'origin', origin)
    const kind = accountKindOf(o, { slackUserListCollected })
    if (kind) ds.setJudged(o.fixture_key, 'account_kind', kind)
    if (o.canonical.provider === 'salesforce' && o.canonical.object_type === 'PermissionSet' && o.canonical.properties.type) {
      const activation = o.canonical.properties.type === 'Session' ? 'session' : 'standing'
      ds.setJudged(o.fixture_key, 'activation', activation)
      if (activation === 'session') session.add(o.fixture_key)
    }
  }

  const count = new Map<string, number>()
  const bump = (k: string | undefined) => { if (k) count.set(k, (count.get(k) ?? 0) + 1) }
  for (const r of ds.allRelationInputs()) {
    const role = r.role && 'key' in r.role ? r.role.key : undefined
    bump(role)
    if (!STRUCTURAL_OUT.has(r.type)) bump(r.source)
    bump(r.target)
    if (role && session.has(role)) r.properties = { ...(r.properties ?? {}), activation: 'session' }
    if (r.type === 'applies_to' && everyone.has(r.target)) r.properties = { ...(r.properties ?? {}), binding: 'ambient' }
  }
  for (const o of objects) if (o.canonical.judged?.origin) ds.setJudged(o.fixture_key, 'assignment_count', count.get(o.fixture_key) ?? 0)
}
