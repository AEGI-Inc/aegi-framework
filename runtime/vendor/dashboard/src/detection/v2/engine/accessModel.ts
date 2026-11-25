/**
 * provider 권한 모델 — 엔진 코드가 아니라 데이터다. SaaS 를 더하면 이 표만 늘린다.
 *
 * 설계서 §3 「provider 권한 모델」. 값마다 근거(벤더 문서·끊어 보기)를 주석으로 단다.
 * 끊어 보기로 확인한 것처럼 조직마다 다른 사실은 여기가 아니라 데이터셋 옆 access_engine_overrides.json 에 적는다.
 *
 * 표의 값은 개념 사전(aegi-schema ontology/)에서 생성한 src/ontology/generated.ts 에서 온다.
 * 값을 바꾸려면 사전(capabilities.yaml, providers.yaml, uncertainty.yaml)을 고치고 npm run ontology:sync 로 가져온다.
 * 근거 주석은 여기 둔다.
 */
import type { FixtureObject } from '../../../model/object'
import type { GraphStoreV2 } from '../../../model/graph'
import type { ResolvedRelation } from '../../../model/relation'
import * as onto from '../../../ontology/generated'
import { roleRank } from '../access'
import type { EngineOverrides } from './types'

/** 이 모델 판. 판정이 바뀌는 수정이면 올린다 */
export const MODEL_VERSION = onto.MODEL_VERSION

export const RANK = onto.RANK

/**
 * 테넌트(조직) 수준 역할이 그 안의 객체로 내려가는가.
 * - okta: 관리자 역할은 org 전체에 걸린다(리소스 세트가 없으면)
 * - github: 조직 owner·admin 역할은 저장소 전체에 걸린다
 * - slack: 워크스페이스 관리자·소유자도 비공개 채널을 읽지 못한다
 * - gws: Workspace 관리자 역할은 Drive ACL 이 아니다
 */
export const TENANT_GRANTS_INHERIT = onto.TENANT_GRANTS_INHERIT

/** 상위에서 내려올 때 능력 상한. Slack 채널 멤버는 채널 메시지를 읽지만(read) 남의 메시지를 고치지는 못한다 */
export const INHERIT_CAPS = onto.INHERIT_CAPS

export function inheritCap(provider: string | undefined, parentType: string | undefined, childType: string | undefined): number {
  const hit = INHERIT_CAPS.find(c => c.provider === provider && c.parent === parentType && c.child === childType)
  return hit ? hit.cap : Infinity
}

/** member_of 가 자원(그룹·테넌트가 아닌 것)을 가리킬 때 그 멤버십이 주는 능력. Slack 채널 멤버는 읽고 쓴다 */
export function membershipRank(provider: string | undefined, targetType: string | undefined): number {
  if (provider === 'slack' && targetType === 'conversation') return RANK.write
  return RANK.read
}

/**
 * Okta 표준 관리자 역할 (developer.okta.com Roles 가이드). applies_to = 역할이 바꿀 수 있는 객체 종류(소문자 object_type).
 * 역할 이름으로만 아는 것이라 리소스 세트·그룹 한정 배정이면 범위가 좁을 수 있다 — 그 경우 간선에 사유를 붙인다.
 * super_admin, org_admin 은 admin. app_admin, user_admin, group_membership_admin, help_desk_admin, mobile_admin,
 * api_access_management_admin 은 write. read_only_admin, report_admin 은 read.
 */
const OKTA_STANDARD_ROLES = onto.OKTA_STANDARD_ROLES

/** Okta 사용자 정의 역할 권한 이름 → 객체 종류 (okta.users.credentials.resetFactors 등) */
const OKTA_PERMISSION_TYPES = onto.OKTA_PERMISSION_TYPES

function oktaCustomRole(role: FixtureObject | undefined): { rank: number; applies_to: string[] } | undefined {
  const raw = role?.canonical.properties.permissions
  if (!Array.isArray(raw) || !raw.length) return undefined
  let rank = 0
  const types = new Set<string>()
  for (const p of raw) {
    const name = typeof p === 'string' ? p : typeof p === 'object' && p ? String((p as Record<string, unknown>).label ?? (p as Record<string, unknown>).permission ?? '') : ''
    if (!name) continue
    rank = Math.max(rank, name.endsWith('.read') ? RANK.read : RANK.write)
    for (const [prefix, t] of OKTA_PERMISSION_TYPES) if (name.startsWith(prefix)) t.forEach(x => types.add(x))
  }
  return rank ? { rank, applies_to: [...types] } : undefined
}

/** GitHub 세분화 PAT 권한 요약 "contents:write,metadata:read" → 가장 높은 수준 */
function permissionSummaryRank(roleName: string): number | undefined {
  if (!roleName.includes(':')) return undefined
  let rank: number | undefined
  for (const part of roleName.split(',')) {
    const level = part.split(':')[1]?.trim().toLowerCase()
    const r = level === 'admin' ? RANK.admin : level === 'write' ? RANK.write : level === 'read' ? RANK.read : undefined
    if (r !== undefined) rank = Math.max(rank ?? 0, r)
  }
  return rank
}

export interface Capability {
  rank?: number
  applies_to?: string[]
  /** 어디서 알았나 (보고서) */
  source: 'override' | 'role_name' | 'okta_standard' | 'okta_permissions' | 'permission_summary' | 'scope' | 'permission_flags' | 'role_type' | 'role_grants' | 'base_role' | 'assignment' | 'unknown'
}

/**
 * 이름 없는 역할 객체(Slack bot-token 권한 묶음)의 scope 목록 → 세기 (capabilities.yaml scope_rank).
 * 맞는 줄 가운데 가장 센 rank, 하나도 안 맞으면 0 — commands 같은 scope 는 데이터에 닿지 않는다. 그 provider 표나 scope 목록이 없으면 undefined.
 */
function scopeRank(provider: string, role: FixtureObject | undefined): number | undefined {
  const table = onto.SCOPE_RANK[provider]
  const raw = role?.canonical.properties.scopes
  const scopes = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[\s,]+/).filter(Boolean) : undefined
  if (!table || !scopes) return undefined
  return Math.max(0, ...scopes.flatMap(s => table.filter(row => new RegExp(row.match).test(s)).map(row => row.rank)))
}

/** provider 별 역할 이름 → 세기 (capabilities.yaml role_name_rank). Jira 권한 키, Confluence 동작:대상, Salesforce OAuth 승인 */
function providerNameRank(provider: string, name: string): number | undefined {
  return onto.ROLE_NAME_RANK[provider]?.find(row => new RegExp(row.match).test(name.trim()))?.rank
}

/**
 * 역할 객체의 권한 칸(참, 거짓) → 세기 (capabilities.yaml role_flag_rank). Salesforce 프로필, 권한 집합.
 * 참인 칸 가운데 가장 센 값, 칸은 있는데 참이 없으면 0(조직 전체 권한이 없다). 칸이 하나도 없으면 undefined.
 */
function flagRank(provider: string, role: FixtureObject | undefined): number | undefined {
  const table = onto.ROLE_FLAG_RANK[provider]
  const props = role?.canonical.properties
  if (!table || !props) return undefined
  const seen = table.filter(row => row.field.replace(/^properties\./, '') in props)
  if (!seen.length) return undefined
  return Math.max(0, ...seen.filter(row => props[row.field.replace(/^properties\./, '')] === true).map(row => row.rank))
}

/** 역할 객체 종류 → 세기 (capabilities.yaml role_type_rank). Salesforce 역할 계층 자리(UserRole) 0 */
function typeRank(provider: string, role: FixtureObject | undefined): number | undefined {
  return role ? onto.ROLE_TYPE_RANK[provider]?.[role.canonical.object_type] : undefined
}

/** 역할이 놓인 자리. 같은 대상에 받은 권한 줄로 세기를 정할 때 엔진이 그래프에서 찾아 준다 */
export interface RoleContext {
  /** 그 역할 객체가 출발이고 도착이 같은 has_role_on 줄들의 세기 */
  grantRanks?: () => Array<number | undefined>
}

/**
 * 역할 객체가 같은 대상에 받은 권한 줄로 세기 (capabilities.yaml role_rank_from_grants). Jira 프로젝트 역할은 그 프로젝트의 권한 스킴이
 * 그 역할에 준 권한 키 중 가장 센 것이다. 줄이 없으면 undefined — 스킴 수집이 빠졌을 수 있어 0 으로 치지 않는다.
 */
function grantsRank(provider: string, role: FixtureObject | undefined, context: RoleContext | undefined): number | undefined {
  if (!role || !onto.ROLE_RANK_FROM_GRANTS[provider]?.includes(role.canonical.object_type)) return undefined
  const known = (context?.grantRanks?.() ?? []).filter((r): r is number => r !== undefined)
  return known.length ? Math.max(...known) : undefined
}

/** 이름 → 세기. Okta 표준 역할 → Okta 앱 배정 → provider 표 → 이름 순위표(access.ts roleRank) → 권한 요약 문자열 */
function nameCapability(provider: string, name: string): Capability | undefined {
  const lower = name.trim().toLowerCase()
  if (provider === 'okta' && OKTA_STANDARD_ROLES[lower]) return { ...OKTA_STANDARD_ROLES[lower], source: 'okta_standard' }
  // Okta 앱 배정(AppUser) — 앱을 쓸 수 있다
  if (provider === 'okta' && lower === 'assigned') return { rank: RANK.read, source: 'assignment' }
  const p = providerNameRank(provider, name)
  if (p !== undefined) return { rank: p, source: 'role_name' }
  const r = roleRank(name)
  if (r !== undefined) return { rank: r, source: 'role_name' }
  const summary = permissionSummaryRank(name)
  if (summary !== undefined) return { rank: summary, source: 'permission_summary' }
  return undefined
}

/**
 * 역할 하나의 능력. overrides 다음은 사전 capabilities.yaml role_rank_order 순서다 — 이름 → scope 목록 → 권한 칸 → 객체 종류 → 같은 대상의
 * 권한 줄. 앞 방법이 못 정하면 다음 방법으로 간다(이름은 있는데 표에 없어도). 그 뒤 Okta 사용자 정의 역할 permissions → GitHub 기반 역할.
 * 모르면 rank 가 없다 — 엔진은 그 간선을 불확실(role_rank_unknown)로 둔다. 권한 있음으로 치지 않는다.
 */
export function roleCapability(provider: string, roleName: string | undefined, roleKey: string | undefined, roleObject: FixtureObject | undefined, overrides?: EngineOverrides, context?: RoleContext): Capability {
  const o = (roleKey && overrides?.role_capabilities?.[roleKey]) || (roleName && overrides?.role_capabilities?.[`${provider}:${roleName}`])
  if (o) return { rank: o.rank, applies_to: o.applies_to?.map(t => t.toLowerCase()), source: 'override' }
  const name = roleName ?? (typeof roleObject?.canonical.properties.role_name === 'string' ? String(roleObject.canonical.properties.role_name) : undefined)
  const ranked = (rank: number | undefined, source: Capability['source']): Capability | undefined => (rank === undefined ? undefined : { rank, source })
  for (const how of onto.ROLE_RANK_ORDER) {
    const cap = how === 'name' ? (name ? nameCapability(provider, name) : undefined)
      : how === 'scopes' ? ranked(scopeRank(provider, roleObject), 'scope')
      : how === 'flags' ? ranked(flagRank(provider, roleObject), 'permission_flags')
      : how === 'object_type' ? ranked(typeRank(provider, roleObject), 'role_type')
      : ranked(grantsRank(provider, roleObject, context), 'role_grants')
    if (cap) return cap
  }
  if (provider === 'okta') {
    const custom = oktaCustomRole(roleObject)
    if (custom) return { ...custom, source: 'okta_permissions' }
  }
  // GitHub 사용자 정의 저장소 역할은 기반 역할(base_role) 이상이다 (GH-07)
  const base = roleObject?.canonical.properties.base_role
  if (typeof base === 'string' && roleRank(base) !== undefined) return { rank: roleRank(base), source: 'base_role' }
  return { source: 'unknown' }
}

/**
 * has_role_on 관계 한 줄의 능력. 판단표 G4-Q01: 역할 칸이 묶음이면(권한 키 목록 permissions) 그중 가장 높은 등급이다. 목록이 비면 역할로 정한다.
 * 역할 객체가 같은 대상에 받은 권한 줄(Jira 프로젝트 역할 → 그 프로젝트의 권한 스킴 줄)은 한 단계만 본다. 엔진 간선(edges.ts)과 AI 도구가 같이 쓴다
 */
export function roleRelationCapability(graph: GraphStoreV2, rel: ResolvedRelation, overrides?: EngineOverrides): Capability {
  const obj = (key: string) => graph.objectsByKey.get(key)
  const grantRanks = () => (rel.roleKey ? graph.outgoingRelationsByObject.get(rel.roleKey) ?? [] : [])
    .filter(g => g.relationType === 'has_role_on' && g.targetKey === rel.targetKey)
    .map(g => roleCapability(g.provider, g.roleName, g.roleKey, g.roleKey ? obj(g.roleKey) : undefined, overrides).rank)
  const permissions = (Array.isArray(rel.properties.permissions) ? rel.properties.permissions : [])
    .map(p => roleCapability(rel.provider, String(p), undefined, undefined, overrides))
    .filter((c): c is Capability & { rank: number } => c.rank !== undefined)
  if (permissions.length) {
    const top = permissions.reduce((a, b) => (b.rank > a.rank ? b : a))
    return { rank: top.rank, applies_to: undefined, source: top.source }
  }
  return roleCapability(rel.provider, rel.roleName, rel.roleKey, rel.roleKey ? obj(rel.roleKey) : undefined, overrides, { grantRanks })
}

/**
 * 사람이 자동화를 부르는 진입점. invokers = 누가 부를 수 있나.
 * Slack 슬래시 명령은 워크스페이스 어느 대화에서나 부를 수 있고(api.slack.com 「your first slash command」),
 * 채널로 거르는 것은 앱 코드다 — 확인 전에는 워크스페이스 멤버 전원이 불확실한 호출자다.
 */
export const ENTRY_POINTS = onto.ENTRY_POINTS

/** 컨테이너에 묶인 자동화 — 컨테이너 편집자가 코드를 고칠 수 있다 (Apps Script 컨테이너 바인딩 스크립트) */
export const CONTAINER_BOUND_AUTOMATIONS = onto.CONTAINER_BOUND_AUTOMATIONS

/** 응답자를 수집할 수 없는 자원 — 누구나 쓸 수 있다고 불확실하게 둔다 (Google Forms 응답자) */
export const OPEN_RESPONDENT_RESOURCES = onto.OPEN_RESPONDENT_RESOURCES

/** 멤버십이 곧 읽기인 자원 — 공개 여부 속성이 있다 (Slack 채널) */
export const VISIBILITY_SCOPED = onto.VISIBILITY_SCOPED

export type CoverageFamily = 'members' | 'grants'

/**
 * 수집 호출 → 그 호출이 목록을 다 가져와야 닫히는 사실 묶음.
 * members = 그 종류 객체로 들어오는 소속(M), grants = 그 종류 객체로 들어오는 권한(G).
 * 호출이 full 이 아니면(partial·failed·skipped) 또는 coverage 파일에 없으면 그 묶음은 열린다 — 목록에 없는 사람을 no 로 말하지 않는다.
 * PAT 승인(GH-13)은 넣지 않는다: PAT 권한은 주인 권한을 넘지 못해 권한자 집합을 넓히지 않는다.
 */
export const COVERAGE_CALLS = onto.COVERAGE_CALLS

/** 불확실·열림 사유 → 보고서 문구와 푸는 법 */
export const REASON_LABELS = onto.REASON_LABELS

/** 사유 코드 → 문구. 'coverage:GH-06:partial' 처럼 붙은 값은 앞 코드로 찾는다 */
export function reasonLabel(code: string): string {
  const [head, ...rest] = code.split(':')
  const base = REASON_LABELS[head]?.label ?? head
  return rest.length ? `${base} (${rest.join(':')})` : base
}
