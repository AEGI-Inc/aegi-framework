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
import type { GraphStoreV2 } from '../../../model/graph'
import type { FixtureObject } from '../../../model/object'
import * as onto from '../../../ontology/generated'
import { roleRank } from '../access'
import type { EngineOverrides } from './types'

/** 이 모델 판. 판정이 바뀌는 수정이면 올린다 */
export const MODEL_VERSION = onto.MODEL_VERSION

export const RANK = onto.RANK

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
  source: 'override' | 'permissions' | 'role_name' | 'okta_standard' | 'okta_permissions' | 'permission_summary' | 'scope' | 'privileges' | 'permission_flags' | 'role_type' | 'role_grants' | 'base_role' | 'assignment' | 'unknown'
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

/**
 * 역할 객체의 권한 이름 목록(Google Workspace 관리자 역할 properties.privileges, 「serviceId:privilegeName」) → 세기 (capabilities.yaml privilege_rank).
 * 이름마다 위에서부터 처음 맞는 줄의 rank, 그 가운데 가장 센 값. 맞는 이름이 하나도 없거나 그 provider 표나 목록이 없으면 undefined
 */
function privilegeRank(provider: string, role: FixtureObject | undefined): number | undefined {
  const table = onto.PRIVILEGE_RANK[provider]
  const raw = role?.canonical.properties.privileges
  if (!table || !Array.isArray(raw)) return undefined
  const ranks = raw.map(p => table.find(row => new RegExp(row.match).test(String(p)))?.rank).filter((r): r is number => r !== undefined)
  return ranks.length ? Math.max(...ranks) : undefined
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
    // permissions(관계 행의 권한 키 목록)는 관계 행을 봐야 해서 부르는 쪽(relationEffects.ts relationRoleCapability)이 먼저 본다
    if (how === 'permissions') continue
    const cap = how === 'name' ? (name ? nameCapability(provider, name) : undefined)
      : how === 'scopes' ? ranked(scopeRank(provider, roleObject), 'scope')
      : how === 'privileges' ? ranked(privilegeRank(provider, roleObject), 'privileges')
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

// ---- 자동화 범위(사전 semantic_mapping.yaml automation_scopes, 칸 ceiling 의 범위 갈래. 2026-11-17 aegi-knowledge#311)
// 범위가 수집된 자동화는 실행 신원 권한을 그 범위 안에서만 쓴다. 쓰는 곳이 모두 아래 두 함수를 읽는다(같은 거름을 따로 들지 않는다):
//   automationScopeReaches   범위 안. 접근 규칙 automation_scope 홉(EA), 위협 판정 편집 범위
//   automationActionReaches  범위 안 가운데 동작이 고치는 제품 자원. 위협 판정 호출 범위, 닿음 질의 구조 경로

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : []
}

type AutomationScope = (typeof onto.AUTOMATION_SCOPES)[number]

/** 자동화 객체에 맞는 범위 표 줄 */
function scopeRow(automation: FixtureObject | undefined): AutomationScope | undefined {
  const c = automation?.canonical
  return c ? onto.AUTOMATION_SCOPES.find(r => r.select.provider === c.provider && r.select.object_type === c.object_type) : undefined
}

/** 'properties.x' → properties.x, 'identifiers' → identifiers 의 값 전부 */
function fieldValues(o: FixtureObject, field: string): unknown[] {
  if (field === 'identifiers') return Object.values(o.canonical.identifiers ?? {}).map(v => (v && typeof v === 'object' && 'value' in v ? (v as { value?: unknown }).value : v))
  if (field.startsWith('properties.')) return [o.canonical.properties[field.slice('properties.'.length)]]
  return []
}

/** 범위 객체(Jira 프로젝트)면 그 id 들 */
function scopeObjectIds(o: FixtureObject, row: AutomationScope): string[] {
  if (o.canonical.provider !== row.select.provider || o.canonical.object_type !== row.scope.object_type) return []
  return row.scope.ids.flatMap(f => fieldValues(o, f)).filter((v): v is string | number => typeof v === 'string' || typeof v === 'number').map(String)
}

/** 범위가 수집된 자동화면 그 범위 id 목록. 표에 없거나 칸이 비면 undefined(자르지 않는다) */
function scopeIds(automation: FixtureObject | undefined, row = scopeRow(automation)): string[] | undefined {
  if (!automation || !row) return undefined
  const ids = stringList(automation.canonical.properties[row.scope.property.replace(/^properties\./, '')])
  return ids.length ? ids : undefined
}

/** 범위가 수집된 자동화인가 — 범위 표에 줄이 있고 범위 칸이 비지 않음 */
export function automationHasScope(automation: FixtureObject | undefined): boolean {
  return !!scopeIds(automation)
}

/** 대상에서 below 관계(contained_in)를 따라 올라간 객체들(자기 자신 포함). 그래프마다 메모 */
const containersMemo = new WeakMap<object, Map<string, string[]>>()
function containers(graph: GraphStoreV2, key: string, relation: string): string[] {
  let memo = containersMemo.get(graph)
  if (!memo) containersMemo.set(graph, (memo = new Map()))
  const k = `${relation}|${key}`
  const hit = memo.get(k)
  if (hit) return hit
  const out = [key]
  for (let i = 0; i < out.length && out.length < 64; i++) {
    for (const r of graph.outgoingRelationsByObject.get(out[i]) ?? []) if (r.relationType === relation && !out.includes(r.targetKey)) out.push(r.targetKey)
  }
  memo.set(k, out)
  return out
}

/** 다른 제품(canonical.service)인가 — 둘 다 값이 있고 다를 때만. 값이 없으면 같은 제품으로 본다 */
function otherProduct(a: FixtureObject, b: FixtureObject): boolean {
  const x = a.canonical.service, y = b.canonical.service
  return !!x && !!y && x !== y
}

/**
 * 범위 안: 자동화가 실행 신원 권한으로 이 대상에 닿을 수 있는가(범위만 본다. 규칙을 고칠 수 있는 사람이 닿는 곳과 같다).
 * 범위가 수집되지 않았거나 다른 SaaS 대상이면 자르지 않는다. own_product 면 다른 제품(Jira 규칙에서 Confluence) 대상도 자르지 않는다.
 * 다만 other_product_interface 가 있으면 다른 제품 대상은 그 interface 일 때만 안이다(Confluence 동작은 내용을 고칠 뿐 권한 설정 · 역할 · 자동화는 못 고친다).
 * 같은 제품 대상은 범위 객체이거나 below 관계로 그 아래일 때만
 */
export function automationScopeReaches(graph: GraphStoreV2, automationKey: string, targetKey: string): boolean {
  const a = graph.objectsByKey.get(automationKey)
  const t = graph.objectsByKey.get(targetKey)
  const row = scopeRow(a)
  const ids = scopeIds(a, row)
  if (!a || !t || !row || !ids) return true
  if (t.canonical.provider !== a.canonical.provider) return true
  if (row.own_product && otherProduct(a, t)) return !row.other_product_interface || (t.canonical.interfaces ?? []).includes(row.other_product_interface as never)
  return containers(graph, targetKey, row.below).some(k => {
    const o = graph.objectsByKey.get(k)
    return !!o && scopeObjectIds(o, row).some(id => ids.includes(id))
  })
}

/**
 * 동작이 고치는 제품(canonical.service). 'all' 은 제품을 가리지 않음.
 * 동작 목록이 없거나 동작이 하나도 없거나 표에 없는 동작이 있으면 'all'(모름은 자르지 않는다). 밖으로 보내기와 기록만 있으면 빈 집합
 */
function modifiedProducts(automation: FixtureObject, row: AutomationScope): Set<string> | 'all' {
  const act = row.actions
  if (!act) return 'all'
  const components = automation.canonical.properties[act.from.replace(/^properties\./, '')]
  if (!Array.isArray(components)) return 'all'
  const nonAction = act.non_action?.match ? new RegExp(act.non_action.match, 'i') : undefined
  const triggers = new Set(act.non_action?.types ?? [])
  const passive = new Set([...(act.outbound ?? []), ...(act.record_only ?? [])])
  const actions = components
    .map(c => (c && typeof c === 'object' ? (c as { type?: unknown }).type : undefined))
    .filter((type): type is string => typeof type === 'string' && !nonAction?.test(type) && !triggers.has(type))
  if (!actions.length) return 'all'
  const out = new Set<string>()
  for (const type of actions) {
    if (passive.has(type)) continue
    const product = act.product[type.split('.')[0]]
    if (!product) return 'all'
    out.add(product)
  }
  return out
}

/**
 * 동작 범위: 규칙을 그대로 돌릴 때 이 대상이 바뀌는가 — 범위 안 가운데 동작이 고치는 제품 자원만.
 * 밖 SaaS 로 보내는 경로는 그대로 둔다. 범위 표에 없는 자동화는 자르지 않는다
 */
export function automationActionReaches(graph: GraphStoreV2, automationKey: string, targetKey: string): boolean {
  if (!automationScopeReaches(graph, automationKey, targetKey)) return false
  const a = graph.objectsByKey.get(automationKey)
  const t = graph.objectsByKey.get(targetKey)
  const row = scopeRow(a)
  if (!a || !t || !row || t.canonical.provider !== a.canonical.provider) return true
  const products = modifiedProducts(a, row)
  return products === 'all' || products.has(String(t.canonical.service ?? ''))
}

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
