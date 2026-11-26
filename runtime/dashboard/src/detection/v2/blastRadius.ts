/**
 * 피해범위 (blast radius) — 자격증명 하나가 새면 공격자가 어디까지 닿는가.
 *
 * 두 가정을 따로 계산한다.
 * - token (토큰 권한만): 새어 나간 것은 그 자격증명 하나다. 토큰의 scope 가 허락하는 것만 쓴다.
 *   Okta 관리 API 읽기 scope 면 주인의 Okta 관리 역할을 읽기로만 쓰고, SSO 로그인은 하지 못한다.
 * - account (소유 계정 탈취): 자격증명의 주인(사람 계정 또는 앱)을 공격자가 차지했다고 본다.
 *   역할, 그룹, SSO 앱 할당, 그 계정으로 도는 자동화를 모두 쓴다.
 *
 * 확산은 저장된 것으로만 한다.
 * - 관계(Relation): authenticates_with, owned_by, acts_as, receives_into, has_role_on, member_of, runs_as, contained_in
 * - 신원 판단(Link): SSO 로 넘어간 SaaS 에서 어느 계정인지, 같은 자동화가 다른 SaaS 에 가진 신원
 * - Effective Access 행: 탐지 룰이 이미 계산한 교차 경로 (계정 장악 가정에서만)
 * - 위임 쓰기(delegated_write): 앱이 다른 SaaS 신원으로 하는 쓰기. 적재 때 엔진(aegi-adapter-engine)이 위협 판정 그래프에서 잇고
 *   화면은 그 결과(derived.blast)를 읽는다. 브라우저에서 세는 경우(derived 없는 로컬 데이터셋)는 잇지 않는다
 *
 * SaaS 경계는 Link 만으로 넘지 않는다. 같은 사람이라는 판단은 접근 수단이 아니다.
 * 넘는 수단(Okta SSO 앱 할당, 같은 자동화 런타임, EA 행)이 있을 때 Link 는 "어느 계정인지"만 정한다.
 * 약한 Link(possibly_same 등)를 거친 노드는 「추정」이고, 거기서 다시 Link 를 타지 않는다 (weak Link 전이 금지).
 */
import type { GraphStoreV2 } from '../../model/graph'
import type { FixtureObject, Provider } from '../../model/object'
import type { ResolvedRelation } from '../../model/relation'
import type { EffectiveAccessRow } from './effectiveAccess/types'
import { roleRank } from './access'
import { identityLinkOf, levelGrade, linkPairGrade, principalKind } from './identity'

export type BlastMode = 'token' | 'account'
export type BlastCertainty = 'confirmed' | 'inferred'
/** 닿은 객체에 대해 얻는 권한. use 는 로그인, 소속처럼 권한 수준을 말할 수 없는 것 */
export type BlastLevel = 'admin' | 'write' | 'read' | 'use'

export type BlastHopKind =
  /** 자격증명 → 그것으로 인증하는 계정 */
  | 'holder'
  /** 자격증명 → 그것을 가진 앱 */
  | 'owner_app'
  /** 앱 → 앱이 쓰는 봇 계정 */
  | 'acts_as'
  /** 웹훅 → 메시지를 받는 채널 */
  | 'delivers_to'
  /** 계정 → 그룹, 채널, 조직 소속 */
  | 'member_of'
  /** 계정이나 그룹 → 역할을 가진 대상 */
  | 'role'
  /** 상위 폴더 권한이 안의 파일로 내려간다 */
  | 'contains'
  /** 계정 → 그 계정 권한으로 실행되는 자동화 */
  | 'runs_as'
  /** Okta 앱 할당 → 그 앱으로 로그인하는 다른 SaaS 계정 */
  | 'sso'
  /** 같은 자동화가 다른 SaaS 에 가진 신원 */
  | 'automation_link'
  /** 관리자 역할로 다른 계정의 비밀번호, 인증 요소를 초기화해 차지한다 */
  | 'takeover'
  /** Effective Access 행이 계산한 경로 */
  | 'effective_access'
  /** 앱이 쓰는 다른 SaaS 자격증명으로 한 쓰기 (위임 경로) */
  | 'delegated_write'

export interface BlastHop {
  id: string
  from: string
  to: string
  kind: BlastHopKind
  certainty: BlastCertainty
  /** to 에 대해 얻는 권한 */
  level?: BlastLevel
  /** 역할 이름 (기본 제공 역할 이름 또는 역할 객체 이름) */
  roleName?: string
  relationKeys: string[]
  /** sso 는 거친 Okta 앱, takeover 는 관리 역할을 가진 조직 */
  throughKey?: string
  linkId?: string
  linkLevel?: string
  eaRowId?: string
}

export interface BlastNode {
  key: string
  provider: Provider
  depth: number
  certainty: BlastCertainty
  level?: BlastLevel
  roleName?: string
  /** 조직(Tenant) 단위 권한인가 */
  tenantWide: boolean
  /** 공격자가 이 계정으로 행동할 수 있다 (더 퍼질 수 있는 노드) */
  controlled: boolean
  /** 들어온 홉. 시작 자격증명은 null */
  via: string | null
}

export type BlastNoteCode =
  /** 인증 요소 하나로는 로그인할 수 없다 */
  | 'factor_alone'
  /** 토큰 scope 가 관리 API 를 포함하지 않는다 */
  | 'scope_identity_only'
  /** 토큰 scope 를 모른다 */
  | 'scope_unknown'
  /** 토큰 scope 가 읽기 전용이다 */
  | 'scope_read_only'
  /** 그래프에 노드가 없는 권한 (메일함, 외부 요청 등) */
  | 'scope_outside_graph'
  /** 역할 객체의 권한 목록을 수집하지 않았다 */
  | 'role_permissions_unknown'
  /** SSO 로 넘어가지만 그 SaaS 의 어느 계정인지 연결이 없다 */
  | 'sso_account_unknown'
  /** 약한 연결 뒤에서 다시 연결을 타지 않았다 */
  | 'weak_link_stopped'
  /** 자격증명이 활성 상태가 아니다 */
  | 'credential_inactive'
  /** 노드 수 한도에 닿아 탐색을 멈췄다 */
  | 'truncated'

export interface BlastNote {
  code: BlastNoteCode
  /** 관련 객체 */
  objectKey?: string
  detail?: string
}

export interface BlastProviderSummary {
  provider: Provider
  count: number
  highest?: BlastLevel
}

export interface BlastRadius {
  credentialKey: string
  mode: BlastMode
  /** 자격증명 주인 (사람 계정 또는 앱). 없으면 null */
  ownerKey: string | null
  nodes: BlastNode[]
  hops: BlastHop[]
  providers: BlastProviderSummary[]
  /** 다른 SaaS 로 퍼졌는가 */
  crossProvider: boolean
  /** 가장 센 권한을 얻은 노드 */
  highest: BlastNode | null
  /** 조직(Tenant) 단위 관리 권한에 닿은 노드. SaaS 마다 하나, 확인 경로 우선 */
  tenantAdmins: BlastNode[]
  /** 가장 센 권한까지의 경로가 확인인가 */
  certainty: BlastCertainty
  /** 계산하지 못했거나 일부만 계산한 이유 */
  incomplete: boolean
  notes: BlastNote[]
}

/* ───────────── 상수표 ───────────── */

/**
 * Okta 앱이 로그인시키는 SaaS. 앱에서 다른 SaaS 테넌트로 가는 registered_in(crosswalk tenant_pointer, 앱 설정이 가리킨 테넌트)이
 * 있으면 그 테넌트의 SaaS 다. 없으면 SAML 서비스 제공자 주소, 그다음 OIN 앱 이름으로 찾는다. 모두 없으면 SSO 홉을 만들지 않는다.
 * Atlassian 은 사이트가 아니라 공용 로그인 서비스(auth.atlassian.com)가 SAML 을 받아 앱 설정에 사이트가 없다. 수집하는 Atlassian
 * 관리 API 에도 SAML 설정이 없어 registered_in 은 못 만들지만, 어느 SaaS 인지는 이 주소로 확실하다
 */
function oktaAppProvider(app: FixtureObject, graph: GraphStoreV2): Provider | undefined {
  for (const rel of graph.outgoingRelationsByObject.get(app.fixture_key) ?? []) {
    if (rel.relationType !== 'registered_in') continue
    const provider = graph.objectsByKey.get(rel.targetKey)?.canonical.provider
    if (provider && provider !== 'okta') return provider
  }
  const signOn = (app.canonical.properties.settings as { signOn?: Record<string, unknown> } | undefined)?.signOn
  for (const url of [signOn?.audience, signOn?.ssoAcsUrl]) {
    if (typeof url !== 'string') continue
    let host = ''
    try { host = new URL(url).hostname.toLowerCase() } catch { continue }
    if (host === 'auth.atlassian.com') return 'atlassian'
  }
  const name = String(app.canonical.properties.name ?? '').toLowerCase()
  if (name === 'google' || name.startsWith('google')) return 'gws'
  if (name === 'slack' || name.startsWith('slack')) return 'slack'
  if (name.startsWith('github') || name.startsWith('ghe')) return 'github'
  return undefined
}

/** 로그인을 대신해 주는 방식. OIDC 사용자 앱, 북마크는 다른 SaaS 계정으로 넘어가지 않는다 */
const SSO_SIGN_ON = new Set(['SAML_2_0', 'SAML_1_1', 'BROWSER_PLUGIN', 'SECURE_PASSWORD_STORE', 'WS_FEDERATION', 'AUTO_LOGIN'])

/** 다른 계정의 비밀번호, 인증 요소를 초기화할 수 있는 Okta 표준 역할. HELP_DESK 는 관리자가 아닌 계정만 */
const OKTA_TAKEOVER_ALL = new Set(['super_admin', 'org_admin'])
const OKTA_TAKEOVER_NON_ADMIN = new Set(['help_desk_admin', 'user_admin'])

/** 관리 역할 이름 (순위표에 없고 조직 단위 역할로 쓰이는 것) */
const ADMIN_ROLE_NAMES = new Set([
  'super_admin', 'org_admin', 'app_admin', 'user_admin', 'help_desk_admin', 'group_membership_admin',
  'api_access_management_admin', 'report_admin', 'mobile_admin', 'access_certifications_admin', 'access_requests_admin',
  'owner', 'primary_owner', 'admin', '_seed_admin_role',
])

const LEVEL_RANK: Record<BlastLevel, number> = { use: 0, read: 1, write: 2, admin: 3 }

export function blastLevelRank(level: BlastLevel | undefined): number {
  return level ? LEVEL_RANK[level] : -1
}

function minLevel(a: BlastLevel, cap: BlastLevel | undefined): BlastLevel {
  if (!cap) return a
  return LEVEL_RANK[a] <= LEVEL_RANK[cap] ? a : cap
}

/* ───────────── 토큰이 허락하는 것 ───────────── */

interface Capability {
  /** 이 주체로 얻는 권한의 상한. 없으면 제한 없음 */
  cap?: BlastLevel
  tenantRoles: boolean
  resourceRoles: boolean
  /** Okta 앱으로 다른 SaaS 에 로그인 */
  sso: boolean
  /** 다른 계정 초기화 */
  takeover: boolean
  /** 그 계정 권한으로 도는 자동화를 바꾼다, 같은 자동화의 다른 신원 */
  automations: boolean
  /** EA 행을 쓴다 */
  effectiveAccess: boolean
  /** 채널 소속으로 얻는 권한. 없으면 채널을 쓰지 못한다 */
  channelLevel?: BlastLevel
}

/** 계정을 차지했다. 채널 멤버는 읽고 쓴다 */
const FULL: Capability = { tenantRoles: true, resourceRoles: true, sso: true, takeover: true, automations: true, effectiveAccess: true, channelLevel: 'write' }
const NONE: Capability = { tenantRoles: false, resourceRoles: false, sso: false, takeover: false, automations: false, effectiveAccess: false }

function scopesOf(obj: FixtureObject): string[] | undefined {
  const raw = obj.canonical.properties.scopes ?? obj.canonical.properties.scope
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') return raw.split(/[\s,]+/).filter(Boolean)
  return undefined
}

/** 토큰 하나만 새었을 때 주인 계정으로 할 수 있는 것 */
function tokenCapability(cred: FixtureObject, notes: BlastNote[]): Capability {
  const c = cred.canonical
  const type = c.object_type.toLowerCase()
  const scopes = scopesOf(cred)

  // 웹훅 주소는 그 채널에 글을 쓰는 것 말고는 아무것도 못 한다 (receives_into 로 따로 센다)
  if (c.provider === 'slack' && type === 'incoming-webhook') return NONE
  if (c.provider === 'okta' && type === 'userfactor') {
    notes.push({ code: 'factor_alone', objectKey: cred.fixture_key })
    return NONE
  }
  if (!scopes) {
    notes.push({ code: 'scope_unknown', objectKey: cred.fixture_key })
    return { ...FULL, sso: false, takeover: false, effectiveAccess: false }
  }

  if (c.provider === 'okta') {
    const mgmt = scopes.filter(s => /^okta\.[a-z]/i.test(s) && !/^okta\.internal\./i.test(s))
    const manage = mgmt.filter(s => s.endsWith('.manage'))
    const read = mgmt.filter(s => s.endsWith('.read'))
    if (!manage.length && !read.length) {
      notes.push({ code: 'scope_identity_only', objectKey: cred.fixture_key })
      return NONE
    }
    if (!manage.length) notes.push({ code: 'scope_read_only', objectKey: cred.fixture_key })
    return {
      ...NONE,
      cap: manage.length ? 'admin' : 'read',
      tenantRoles: true,
      takeover: manage.some(s => s.startsWith('okta.users.') || s.startsWith('okta.factors.')),
    }
  }

  if (c.provider === 'gws') {
    const short = scopes.map(s => s.replace('https://www.googleapis.com/auth/', ''))
    const directory = short.filter(s => s.startsWith('admin.directory.'))
    const drive = short.filter(s => s === 'drive' || s === 'drive.readonly' || s.startsWith('drive.metadata'))
    const outside = short.filter(s => /^(gmail|mail\.|calendar|script\.external_request|contacts)/.test(s) || s === 'https://mail.google.com/')
    if (outside.length) notes.push({ code: 'scope_outside_graph', objectKey: cred.fixture_key, detail: outside.join(', ') })
    const writes = [...directory, ...drive].some(s => !s.endsWith('.readonly') && !s.includes('metadata'))
    if (!directory.length && !drive.length) {
      if (!outside.length) notes.push({ code: 'scope_identity_only', objectKey: cred.fixture_key })
      return NONE
    }
    if (!writes) notes.push({ code: 'scope_read_only', objectKey: cred.fixture_key })
    return {
      ...NONE,
      cap: writes ? 'admin' : 'read',
      tenantRoles: directory.length > 0,
      resourceRoles: drive.length > 0,
      takeover: directory.some(s => s === 'admin.directory.user' || s === 'admin.directory.user.security'),
    }
  }

  if (c.provider === 'slack') {
    const read = scopes.some(s => /:(history|read)$/.test(s) && /^(channels|groups|im|mpim)/.test(s))
    const write = scopes.some(s => s === 'chat:write' || s === 'chat:write.public')
    const admin = scopes.some(s => s.startsWith('admin'))
    if (!read && !write && !admin) {
      notes.push({ code: 'scope_identity_only', objectKey: cred.fixture_key })
      return NONE
    }
    if (!write && !admin) notes.push({ code: 'scope_read_only', objectKey: cred.fixture_key })
    return {
      ...NONE,
      cap: admin ? 'admin' : write ? 'write' : 'read',
      tenantRoles: admin,
      channelLevel: write ? 'write' : 'read',
    }
  }

  return { ...FULL, sso: false, takeover: false, effectiveAccess: false }
}

/* ───────────── 역할 해석 ───────────── */

interface RoleReading {
  level: BlastLevel
  roleName?: string
  /** 권한 목록을 몰라 수준을 짐작했다 */
  guessed: boolean
  /** 다른 계정을 차지할 수 있는 범위 */
  takeover?: 'all' | 'non_admin'
}

function roleObjectName(obj: FixtureObject | undefined): string | undefined {
  const p = obj?.canonical.properties ?? {}
  const value = p.role_name ?? p.roleName ?? p.name ?? p.label
  return typeof value === 'string' && value ? value : undefined
}

export function readRole(rel: ResolvedRelation, graph: GraphStoreV2): RoleReading | null {
  const roleObject = rel.roleKey ? graph.objectsByKey.get(rel.roleKey) : undefined
  const name = rel.roleName ?? roleObjectName(roleObject)
  const target = graph.objectsByKey.get(rel.targetKey)

  if (target?.canonical.provider === 'okta' && target.canonical.object_type === 'Application') {
    return { level: 'use', roleName: name, guessed: false }
  }

  if (roleObject && roleObject.canonical.properties.definition_kind !== 'vendor_named_role') {
    const p = roleObject.canonical.properties
    if (p.isSuperAdminRole === true) return { level: 'admin', roleName: name, guessed: false, takeover: rel.provider === 'gws' ? 'all' : undefined }
    if (Array.isArray(p.privileges)) {
      const privileges = p.privileges.map(String)
      const readOnly = privileges.length > 0 && privileges.every(v => /(_RETRIEVE|_READ|_READONLY)$/.test(v))
      return { level: readOnly ? 'read' : 'write', roleName: name, guessed: false }
    }
    // 사용자 정의 역할인데 권한 목록이 없다 (Okta IamRole 의 permissions 는 따로 수집해야 한다)
    return { level: 'write', roleName: name, guessed: true }
  }

  if (!name) return { level: 'write', guessed: true }
  const lower = name.trim().toLowerCase()
  const rank = roleRank(lower)
  if (rank !== undefined) {
    if (rank === 0) return null
    return { level: rank >= 5 ? 'admin' : rank >= 3 ? 'write' : 'read', roleName: name, guessed: false }
  }
  if (ADMIN_ROLE_NAMES.has(lower)) {
    const takeover = rel.provider === 'okta' ? (OKTA_TAKEOVER_ALL.has(lower) ? 'all' : OKTA_TAKEOVER_NON_ADMIN.has(lower) ? 'non_admin' : undefined) : rel.provider === 'gws' && lower === '_seed_admin_role' ? 'all' : undefined
    return { level: 'admin', roleName: name, guessed: false, takeover }
  }
  return { level: 'write', roleName: name, guessed: true }
}

/* ───────────── 계산 ───────────── */

export interface BlastInput {
  graph: GraphStoreV2
  /** Effective Access 행 (denied 는 쓰지 않는다) */
  eaRows?: readonly EffectiveAccessRow[]
  /** 노드 수 한도 */
  maxNodes?: number
}

interface State {
  key: string
  cap: Capability
  certainty: BlastCertainty
  /** 약한 Link 를 이미 거쳤다 */
  weak: boolean
  depth: number
}

const isTenant = (obj: FixtureObject | undefined) => !!obj?.canonical.interfaces.includes('Tenant')

function tenantOf(obj: FixtureObject): string | undefined {
  const target = obj.canonical.references?.tenant?.targets?.[0]
  return target ? String(target.value) : undefined
}

/** 조직 관리 역할이 있는 계정인가. 그룹으로 받은 역할도 본다 */
function hasAdminRole(key: string, graph: GraphStoreV2): boolean {
  const holders = [key, ...(graph.outgoingRelationsByObject.get(key) ?? []).filter(r => r.relationType === 'member_of').map(r => r.targetKey)]
  return holders.some(holder => (graph.outgoingRelationsByObject.get(holder) ?? []).some(rel => {
    if (rel.relationType !== 'has_role_on') return false
    if (!isTenant(graph.objectsByKey.get(rel.targetKey))) return false
    const level = readRole(rel, graph)?.level
    return level === 'admin' || level === 'write'
  }))
}

/** 자격증명의 주인. 계정(authenticates_with) → 앱(owned_by) 순으로 본다 */
export function credentialOwner(credKey: string, graph: GraphStoreV2): { key: string; kind: 'holder' | 'owner_app'; relationKey?: string } | null {
  const holder = (graph.incomingRelationsByObject.get(credKey) ?? []).find(r => r.relationType === 'authenticates_with')
  if (holder) return { key: holder.sourceKey, kind: 'holder', relationKey: holder.relationKey }
  const owner = (graph.outgoingRelationsByObject.get(credKey) ?? []).find(r => r.relationType === 'owned_by')
  if (owner) {
    const target = graph.objectsByKey.get(owner.targetKey)
    // Okta 리프레시 토큰의 owned_by 는 토큰을 받은 클라이언트 앱이다. 주인 계정은 위에서 찾는다
    if (target?.canonical.interfaces.includes('Principal') || target?.canonical.interfaces.includes('Integration')) {
      return { key: owner.targetKey, kind: 'owner_app', relationKey: owner.relationKey }
    }
  }
  const parent = graph.objectsByKey.get(credKey)?.canonical.references?.parent?.targets?.[0]
  if (parent && graph.objectsByKey.has(String(parent.value))) return { key: String(parent.value), kind: 'holder' }
  return null
}

export function isActiveCredential(obj: FixtureObject): boolean {
  const status = String(obj.canonical.properties.status ?? '').toUpperCase()
  if (status && !['ACTIVE', 'ENABLED', 'VALID'].includes(status)) return false
  return obj.canonical.judged?.operational_state !== 'inactive' && obj.canonical.judged?.operational_state !== 'suspended'
}

export function listCredentials(graph: GraphStoreV2): FixtureObject[] {
  return [...(graph.objectsByInterface.get('Credential') ?? [])]
}

export function computeBlastRadius(credKey: string, mode: BlastMode, input: BlastInput): BlastRadius {
  const { graph, eaRows } = input
  const maxNodes = input.maxNodes ?? 400
  const cred = graph.objectsByKey.get(credKey)
  if (!cred) throw new Error(`자격증명을 찾지 못했다: ${credKey}`)

  const notes: BlastNote[] = []
  const nodes = new Map<string, BlastNode>()
  const hops = new Map<string, BlastHop>()
  /** 계정별로 가장 센 능력으로 한 번씩만 펼친다 */
  const expanded = new Map<string, State>()
  const queue: State[] = []
  let truncated = false

  if (!isActiveCredential(cred)) notes.push({ code: 'credential_inactive', objectKey: credKey })

  nodes.set(credKey, {
    key: credKey, provider: cred.canonical.provider, depth: 0, certainty: 'confirmed',
    tenantWide: false, controlled: false, via: null,
  })

  const better = (a: { certainty: BlastCertainty; level?: BlastLevel; depth: number }, b: BlastNode) => {
    if (a.certainty !== b.certainty) return a.certainty === 'confirmed'
    if (blastLevelRank(a.level) !== blastLevelRank(b.level)) return blastLevelRank(a.level) > blastLevelRank(b.level)
    return a.depth < b.depth
  }

  /** 노드를 더하거나 더 나은 경로로 바꾼다. 바뀌었으면 true */
  const reach = (hop: Omit<BlastHop, 'id'>, depth: number, controlled: boolean): boolean => {
    const obj = graph.objectsByKey.get(hop.to)
    if (!obj) return false
    const prev = nodes.get(hop.to)
    const candidate = { certainty: hop.certainty, level: hop.level, depth }
    if (prev && !better(candidate, prev)) {
      // 경로는 그대로 두고, 이 계정으로 행동할 수 있다는 사실만 더한다
      if (controlled && !prev.controlled) {
        prev.controlled = true
        return true
      }
      return false
    }
    if (!prev && nodes.size >= maxNodes) {
      truncated = true
      return false
    }
    const id = `${hop.kind}:${hop.from}>${hop.to}${hop.eaRowId ? `#${hop.eaRowId}` : ''}`
    hops.set(id, { ...hop, id })
    nodes.set(hop.to, {
      key: hop.to,
      provider: obj.canonical.provider,
      depth,
      certainty: hop.certainty,
      level: hop.level,
      roleName: hop.roleName,
      tenantWide: isTenant(obj) && hop.level !== undefined && hop.level !== 'use',
      controlled: controlled || !!prev?.controlled,
      via: id,
    })
    return true
  }

  const control = (state: State) => {
    const prev = expanded.get(state.key)
    if (prev) {
      const prevScore = (prev.certainty === 'confirmed' ? 2 : 0) + (prev.cap.cap ? 0 : 1)
      const score = (state.certainty === 'confirmed' ? 2 : 0) + (state.cap.cap ? 0 : 1)
      if (score <= prevScore) return
    }
    expanded.set(state.key, state)
    queue.push(state)
  }

  /* 시작: 자격증명 → 주인 */
  const owner = credentialOwner(credKey, graph)
  // 계정 장악 가정에서는 인증 요소와 함께 비밀번호까지, 웹훅이면 웹훅을 만든 앱까지 새었다고 본다
  const startCap = mode === 'account' ? FULL : tokenCapability(cred, notes)

  // 웹훅은 주인 앱과 별개로 바로 채널에 글을 쓴다
  for (const rel of graph.outgoingRelationsByObject.get(credKey) ?? []) {
    if (rel.relationType !== 'receives_into') continue
    reach({ from: credKey, to: rel.targetKey, kind: 'delivers_to', certainty: 'confirmed', level: 'write', relationKeys: [rel.relationKey] }, 1, false)
  }

  if (owner) {
    const usable = startCap !== NONE
    reach({
      from: credKey, to: owner.key, kind: owner.kind, certainty: 'confirmed',
      level: usable ? 'use' : undefined,
      relationKeys: owner.relationKey ? [owner.relationKey] : [],
    }, 1, usable)
    if (usable) control({ key: owner.key, cap: startCap, certainty: 'confirmed', weak: false, depth: 1 })
  }

  /* 넓게 펼친다. 확인 경로를 먼저 */
  while (queue.length) {
    queue.sort((a, b) => (a.certainty === b.certainty ? a.depth - b.depth : a.certainty === 'confirmed' ? -1 : 1))
    const state = queue.shift()!
    if (expanded.get(state.key) !== state) continue
    const { key, cap, certainty, weak, depth } = state
    const self = graph.objectsByKey.get(key)
    if (!self) continue
    const next = depth + 1

    // 앱 → 봇 계정
    for (const rel of graph.outgoingRelationsByObject.get(key) ?? []) {
      if (rel.relationType !== 'acts_as') continue
      if (reach({ from: key, to: rel.targetKey, kind: 'acts_as', certainty, level: 'use', relationKeys: [rel.relationKey] }, next, true)) {
        control({ key: rel.targetKey, cap, certainty, weak, depth: next })
      }
    }

    expandGrants(key, state)

    // 소속
    for (const rel of graph.outgoingRelationsByObject.get(key) ?? []) {
      if (rel.relationType !== 'member_of') continue
      const target = graph.objectsByKey.get(rel.targetKey)
      if (!target) continue
      const type = target.canonical.object_type.toLowerCase()
      if (target.canonical.provider === 'slack' && type === 'conversation') {
        const level = cap.channelLevel
        if (!level) continue
        reach({ from: key, to: rel.targetKey, kind: 'member_of', certainty, level, relationKeys: [rel.relationKey] }, next, false)
        continue
      }
      if (isTenant(target)) {
        if (cap !== NONE) reach({ from: key, to: rel.targetKey, kind: 'member_of', certainty, level: 'use', relationKeys: [rel.relationKey] }, next, false)
        continue
      }
      // 그룹, 팀: 그룹이 가진 역할을 물려받는다. 그룹이 이미 닿았어도 SSO 계정은 사람마다 다르니 다시 펼친다
      reach({ from: key, to: rel.targetKey, kind: 'member_of', certainty, relationKeys: [rel.relationKey] }, next, false)
      expandGrants(rel.targetKey, { ...state, depth: next })
    }

    // 이 계정 권한으로 도는 자동화
    if (cap.automations) {
      for (const rel of graph.incomingRelationsByObject.get(key) ?? []) {
        if (rel.relationType !== 'runs_as') continue
        reach({ from: key, to: rel.sourceKey, kind: 'runs_as', certainty, level: 'write', relationKeys: [rel.relationKey] }, next, false)
      }
    }

    // 같은 자동화가 다른 SaaS 에 가진 신원
    if (cap.automations && principalKind(self) === 'service') {
      const link = identityLinkOf(key, graph)
      if (link && link.meta?.kind === 'automation') {
        for (const member of link.set) {
          if (member.object_key === key) continue
          const grade = linkPairGrade(link, key, member.object_key)
          if (!grade) continue
          if (weak && grade === 'weak') {
            notes.push({ code: 'weak_link_stopped', objectKey: member.object_key })
            continue
          }
          const c: BlastCertainty = certainty === 'confirmed' && grade === 'strong' ? 'confirmed' : 'inferred'
          if (reach({ from: key, to: member.object_key, kind: 'automation_link', certainty: c, level: 'use', relationKeys: [], linkId: link.link_id, linkLevel: pairLevel(link, key, member.object_key) }, next, true)) {
            control({ key: member.object_key, cap: FULL, certainty: c, weak: weak || grade === 'weak', depth: next })
          }
        }
      }
    }

    // Effective Access 행 (탐지 룰이 계산한 교차 경로)
    if (cap.effectiveAccess && eaRows) {
      for (const row of eaRows) {
        if (row.references.source !== key) continue
        if (row.level === 'denied') continue
        const linkVias = row.via.filter(v => v.kind === 'link')
        const rowWeak = linkVias.some(v => v.kind === 'link' && levelGrade(v.level) !== 'strong')
        if (weak && rowWeak) {
          notes.push({ code: 'weak_link_stopped', objectKey: row.references.target })
          continue
        }
        const c: BlastCertainty = certainty === 'confirmed' && !rowWeak && row.level !== 'indeterminate' ? 'confirmed' : 'inferred'
        const lastRole = [...row.via].reverse().find(v => v.kind === 'relation' && v.relation_type === 'has_role_on')
        const roleRel = lastRole?.kind === 'relation' ? graph.relationsByKey.get(lastRole.ref) : undefined
        const reading = roleRel ? readRole(roleRel, graph) : null
        reach({
          from: key, to: row.references.target, kind: 'effective_access', certainty: c,
          level: reading?.level ?? 'use', roleName: reading?.roleName,
          relationKeys: row.via.filter(v => v.kind === 'relation').map(v => v.ref),
          linkId: linkVias[0]?.ref, linkLevel: linkVias[0]?.kind === 'link' ? linkVias[0].level : undefined,
          eaRowId: row.id,
        }, next, false)
      }
    }
  }

  function pairLevel(link: NonNullable<ReturnType<typeof identityLinkOf>>, a: string, b: string): string {
    const edges = Array.isArray(link.meta?.edges) ? (link.meta!.edges as Array<{ a: string; b: string; level: string }>) : []
    const edge = edges.find(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))
    return edge?.level ?? link.level
  }

  /** key(계정이나 그룹)가 가진 역할을 펼친다 */
  function expandGrants(key: string, state: State) {
    const { cap, certainty, depth } = state
    const next = depth + 1
    for (const rel of graph.outgoingRelationsByObject.get(key) ?? []) {
      if (rel.relationType !== 'has_role_on') continue
      const target = graph.objectsByKey.get(rel.targetKey)
      if (!target) continue
      const reading = readRole(rel, graph)
      if (!reading) continue
      const tenant = isTenant(target)
      const app = target.canonical.provider === 'okta' && target.canonical.object_type === 'Application'
      if (app && !cap.sso) continue
      if (!app && tenant && !cap.tenantRoles) continue
      if (!app && !tenant && !cap.resourceRoles) continue
      if (reading.guessed) notes.push({ code: 'role_permissions_unknown', objectKey: rel.roleKey ?? rel.targetKey, detail: reading.roleName })
      const level = minLevel(reading.level, cap.cap)
      const c: BlastCertainty = reading.guessed ? 'inferred' : certainty
      reach({ from: key, to: rel.targetKey, kind: 'role', certainty: c, level, roleName: reading.roleName, relationKeys: [rel.relationKey] }, next, false)

      if (app) expandSso(key, target, rel, state)
      if (!tenant) expandContents(rel.targetKey, level, c, next, rel.relationKey)
      if (tenant && reading.takeover && cap.takeover && (!cap.cap || cap.cap === 'admin')) {
        expandTakeover(key, target, reading.takeover, rel, { ...state, certainty: c })
      }
    }
  }

  /** 폴더 권한은 안의 파일로 내려간다 */
  function expandContents(containerKey: string, level: BlastLevel, certainty: BlastCertainty, depth: number, viaRelation: string) {
    const stack: Array<[string, number]> = [[containerKey, depth]]
    const seen = new Set<string>([containerKey])
    while (stack.length) {
      const [cur, d] = stack.pop()!
      for (const rel of graph.incomingRelationsByObject.get(cur) ?? []) {
        if (rel.relationType !== 'contained_in' || seen.has(rel.sourceKey)) continue
        const child = graph.objectsByKey.get(rel.sourceKey)
        if (!child?.canonical.interfaces.includes('Resource')) continue
        // 메시지는 채널 열람에 포함된다. 하나씩 노드로 만들지 않는다
        if (child.canonical.object_type === 'Message') continue
        seen.add(rel.sourceKey)
        reach({ from: cur, to: rel.sourceKey, kind: 'contains', certainty, level, relationKeys: [rel.relationKey, viaRelation] }, d + 1, false)
        stack.push([rel.sourceKey, d + 1])
      }
    }
  }

  /** Okta 앱 할당 → 그 앱으로 로그인하는 SaaS 의 계정 */
  function expandSso(principalKey: string, app: FixtureObject, viaRel: ResolvedRelation, state: State) {
    const provider = oktaAppProvider(app, graph)
    const mode = String(app.canonical.properties.signOnMode ?? '')
    if (!provider || !SSO_SIGN_ON.has(mode)) return
    // 그룹이 앱을 받았으면 그 그룹을 통해 들어온 계정이 로그인한다
    const person = graph.objectsByKey.get(principalKey)?.canonical.object_type === 'Group' ? state.key : principalKey
    const link = identityLinkOf(person, graph)
    const accounts = link ? link.set.filter(m => m.provider === provider && m.object_key !== person) : []
    if (!link || !accounts.length) {
      notes.push({ code: 'sso_account_unknown', objectKey: app.fixture_key, detail: provider })
      return
    }
    for (const member of accounts) {
      const grade = linkPairGrade(link, person, member.object_key)
      if (!grade) continue
      if (state.weak && grade === 'weak') {
        notes.push({ code: 'weak_link_stopped', objectKey: member.object_key })
        continue
      }
      const c: BlastCertainty = state.certainty === 'confirmed' && grade === 'strong' ? 'confirmed' : 'inferred'
      if (reach({
        from: principalKey, to: member.object_key, kind: 'sso', certainty: c, level: 'use', throughKey: app.fixture_key,
        relationKeys: [viaRel.relationKey], linkId: link.link_id, linkLevel: pairLevel(link, person, member.object_key),
      }, state.depth + 2, true)) {
        control({ key: member.object_key, cap: FULL, certainty: c, weak: state.weak || grade === 'weak', depth: state.depth + 2 })
      }
    }
  }

  /** 조직 관리자 역할로 다른 계정을 초기화해 차지한다 */
  function expandTakeover(adminKey: string, tenant: FixtureObject, scope: 'all' | 'non_admin', viaRel: ResolvedRelation, state: State) {
    const provider = tenant.canonical.provider
    for (const obj of graph.objectsByProvider.get(provider) ?? []) {
      if (obj.fixture_key === adminKey || obj.fixture_key === state.key) continue
      if (!obj.canonical.interfaces.includes('Principal')) continue
      if (principalKind(obj) !== 'human') continue
      const t = tenantOf(obj)
      if (t && t !== tenant.fixture_key) continue
      if (scope === 'non_admin' && hasAdminRole(obj.fixture_key, graph)) continue
      if (reach({ from: adminKey, to: obj.fixture_key, kind: 'takeover', certainty: state.certainty, level: 'use', throughKey: tenant.fixture_key, relationKeys: [viaRel.relationKey] }, state.depth + 2, true)) {
        control({ key: obj.fixture_key, cap: FULL, certainty: state.certainty, weak: state.weak, depth: state.depth + 2 })
      }
    }
  }

  if (truncated) notes.push({ code: 'truncated', detail: String(maxNodes) })

  /* 남은 노드와 홉: 노드가 실제로 쓰는 홉만 */
  const nodeList = [...nodes.values()]
  const usedHops = new Set(nodeList.map(n => n.via).filter((v): v is string => !!v))
  const hopList = [...hops.values()].filter(h => usedHops.has(h.id))

  const reached = nodeList.filter(n => n.key !== credKey && (n.controlled || n.level !== undefined))
  const byProvider = new Map<Provider, BlastProviderSummary>()
  for (const n of reached) {
    const row = byProvider.get(n.provider) ?? { provider: n.provider, count: 0 }
    row.count += 1
    if (blastLevelRank(n.level) > blastLevelRank(row.highest)) row.highest = n.level
    byProvider.set(n.provider, row)
  }

  const scored = reached.filter(n => n.level && n.level !== 'use' && !(n.key === owner?.key))
  const highest = scored.sort((a, b) =>
    blastLevelRank(b.level) - blastLevelRank(a.level) ||
    Number(b.tenantWide) - Number(a.tenantWide) ||
    (a.certainty === b.certainty ? 0 : a.certainty === 'confirmed' ? -1 : 1) ||
    Number(b.provider !== cred.canonical.provider) - Number(a.provider !== cred.canonical.provider) ||
    a.depth - b.depth
  )[0] ?? null

  const tenantAdmins = new Map<Provider, BlastNode>()
  for (const n of reached) {
    if (!n.tenantWide || n.level !== 'admin') continue
    const prev = tenantAdmins.get(n.provider)
    if (!prev || (prev.certainty !== n.certainty ? n.certainty === 'confirmed' : n.depth < prev.depth)) tenantAdmins.set(n.provider, n)
  }

  const uniqueNotes = dedupeNotes(notes)
  const incompleteCodes = new Set<BlastNoteCode>(['scope_unknown', 'role_permissions_unknown', 'sso_account_unknown', 'weak_link_stopped', 'truncated'])

  return {
    credentialKey: credKey,
    mode,
    ownerKey: owner?.key ?? null,
    nodes: nodeList,
    hops: hopList,
    providers: [...byProvider.values()].sort((a, b) => b.count - a.count),
    crossProvider: reached.some(n => n.provider !== cred.canonical.provider),
    highest,
    tenantAdmins: [...tenantAdmins.values()],
    certainty: highest?.certainty ?? 'confirmed',
    incomplete: uniqueNotes.some(n => incompleteCodes.has(n.code)),
    notes: uniqueNotes,
  }
}

function dedupeNotes(notes: BlastNote[]): BlastNote[] {
  const seen = new Set<string>()
  return notes.filter(n => {
    const id = `${n.code}|${n.objectKey ?? ''}|${n.detail ?? ''}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/** 노드에서 시작 자격증명까지 거슬러 올라간 홉 순서 (시작 → 노드) */
export function blastPathTo(radius: BlastRadius, key: string): BlastHop[] {
  const nodes = new Map(radius.nodes.map(n => [n.key, n]))
  const hops = new Map(radius.hops.map(h => [h.id, h]))
  const path: BlastHop[] = []
  const seen = new Set<string>()
  let cur = nodes.get(key)
  while (cur?.via && !seen.has(cur.key)) {
    seen.add(cur.key)
    const hop = hops.get(cur.via)
    if (!hop) break
    path.unshift(hop)
    cur = nodes.get(hop.from)
  }
  return path
}
