/**
 * 직접 권한 (2026-11-16 결정, aegi-adapter-engine#435, 사전 aegi-knowledge#308).
 *
 * 직접 권한 = 사람(또는 실행 신원)마다, 그 계정들이 소속(M), 권한(G), 범위 내려가기(U) 간선만으로 닿는 객체와 수준.
 * 자동화, 실행 신원, 토큰을 거치는 길은 파생 접근이다(여기서 안 본다).
 *
 * 규칙은 이 파일 하나에 있다. 위협 판정(judge.ts, 사람 기준으로 앞으로 편다)과 Access Gap 엔진(query.ts can, 대상 기준으로 거꾸로 찾는다)이
 * 같은 규칙 함수를 부른다.
 *   수준       능력 수준 표(capabilities.yaml capability_levels). 읽기, 쓰기, 관리가 따로 켜진다. 쓰기만 있으면 게시 전용.
 *              로그인(authenticate)과 권한 주기(grant)는 수준이 아니다
 *   테넌트     권한 간선의 도착이 테넌트면 테넌트 아래로 내려가는 범위를 출처 종류와 객체 종류(내용, 설정, 계정)로 정한다(providers.yaml tenant_scope).
 *              테넌트 객체 자체는 그 권한 수준을 그대로 받는다. 하위 테넌트로는 내려가지 않는다
 *   범위       같은 SaaS 안에서만 내려간다. 상위에서 내려올 때 문턱(inherit_caps, Slack 채널에서 메시지는 읽기까지)과 역할 적용 범위(appliesTo)를 본다
 *   상한       앱 신원의 토큰 상한과 설정 깎기(semantic/ceiling.ts underCeiling)
 *   상태       확정, 모름(수준 모르는 권한, 불확실 간선, 상한을 확인 못 함), 추정(약한 연결 계정으로만 닿음)
 *   누구나     누구나 공유는 모든 사람의 직접 권한이다(공개 문서)
 *   로그       로그에서 확인한 권한(grantSource observed)도 직접 권한이다. 근거 출처에 그렇게 적는다
 */
import { CAPABILITY_LEVELS, ROLE_FLAG_REACH, TENANT_SCOPE, type DirectLevel, type ObjectClass, type TenantReach } from '../../../ontology/generated'
import { inheritCap } from './accessModel'
import type { EdgeIndex } from './edges'
import { EVERYONE, interfacesOf } from './relationEffects'
import { edgeCaps, needOf, underCeiling } from './semantic/ceiling'
import type { Edge } from './types'

export type { DirectLevel, ObjectClass } from '../../../ontology/generated'
export type Level = DirectLevel | 'post'
export type State = 'confirmed' | 'unknown' | 'inferred'

export const READ = 1
export const WRITE = 2
export const ADMIN = 4
const LEVEL_BIT: Record<DirectLevel, number> = { read: READ, write: WRITE, admin: ADMIN }
export const LEVEL_RANK: Record<DirectLevel, number> = { read: 1, write: 3, admin: 5 }
const LEVELS: readonly DirectLevel[] = ['read', 'write', 'admin']
const CLASSES: readonly ObjectClass[] = ['content', 'config', 'account']

// ---- 수준 ----

/** 능력 목록 → 수준 비트 */
export function capsBits(caps: readonly string[]): number {
  let b = 0
  for (const c of caps) {
    const l = CAPABILITY_LEVELS[c]
    if (l && l !== 'none') b |= LEVEL_BIT[l]
  }
  return b
}

/** 비트 → 수준 이름. 쓰기만 있으면 게시 전용 */
export function bitsLevel(b: number): Level | undefined {
  if (b & ADMIN) return 'admin'
  if (b & WRITE) return b & READ ? 'write' : 'post'
  if (b & READ) return 'read'
  return undefined
}

// ---- 객체 종류, 테넌트 범위 ----

/** interface 로 객체 종류. 위에서부터 처음 맞는 줄(providers.yaml tenant_scope classes) */
export function objectClassOf(interfaces: readonly string[], groupLike: boolean): ObjectClass | undefined {
  for (const c of TENANT_SCOPE.classes) {
    if (c.group !== undefined && c.group !== groupLike) continue
    if (c.interfaces.some(i => interfaces.includes(i))) return c.class
  }
  return undefined
}

/** 테넌트에 걸린 권한의 출처 종류. 레코드 규칙의 tenant_grant 가 먼저, 없으면 관계 종류 */
export function tenantKindOf(tenantGrant: string | undefined, relationTypes: readonly string[]): string | undefined {
  for (const k of TENANT_SCOPE.kinds) {
    if (tenantGrant) {
      if (k.from.record === tenantGrant) return k.kind
    } else if (k.from.relation?.some(r => relationTypes.includes(r))) return k.kind
  }
  return undefined
}

const reachRank = (v: TenantReach[ObjectClass]): number => (v === undefined || v === 'none' ? 0 : v === 'level' ? Infinity : LEVEL_RANK[v])

/** 권한 칸 표(capabilities.yaml role_flag_reach)로 종류마다 세기 문턱. 참인 칸이 없으면 전부 0 */
function flagReach(provider: string, props: Record<string, unknown> | undefined): Record<ObjectClass, number> {
  const r: Record<ObjectClass, number> = { content: 0, config: 0, account: 0 }
  for (const row of ROLE_FLAG_REACH[provider] ?? []) {
    if (props?.[row.field.replace(/^properties\./, '')] !== true) continue
    for (const c of CLASSES) if (row[c]) r[c] = Math.max(r[c], LEVEL_RANK[row[c]!])
  }
  return r
}

/**
 * 테넌트에 걸린 권한 하나가 객체 종류마다 내려가는 세기 문턱. 0 은 안 내려감, Infinity 는 그 권한 자기 수준.
 * 출처 종류를 모르면 전부 0(정하지 않은 테넌트 권한은 내려가지 않는다)
 */
export function tenantReach(provider: string | undefined, kind: string | undefined, caps: readonly string[] | undefined, roleProps?: Record<string, unknown>): Record<ObjectClass, number> {
  const base = kind ? TENANT_SCOPE.reach[kind] : undefined
  let r: Record<ObjectClass, number> = { content: reachRank(base?.content), config: reachRank(base?.config), account: reachRank(base?.account) }
  for (const x of TENANT_SCOPE.exceptions) {
    if (x.provider !== provider || x.kind !== kind) continue
    if (x.when.caps && !(caps && x.when.caps.every(c => caps.includes(c)))) continue
    // IAM 정책(*:*)은 아직 안 읽는다. 그 권한은 수준을 몰라 모름으로 남는다
    if (x.when.policy) continue
    if (x.when.flag) { r = flagReach(provider!, roleProps); continue }
    for (const c of CLASSES) if (x.reach?.[c] !== undefined) r[c] = reachRank(x.reach[c])
  }
  return r
}

/** 내용 예외가 있는 SaaS. 테넌트 권한이 내용으로 내려갈 수 있다(수집 목록 미완결 사유를 붙일지 정할 때) */
export const CONTENT_REACH_PROVIDERS: ReadonlySet<string> = new Set(TENANT_SCOPE.exceptions.filter(x => x.reach?.content !== undefined || x.when.flag).map(x => x.provider))

// ---- EdgeIndex 위 규칙 ----

/** 객체 종류. 테넌트와 누구나는 없음 */
export function objectClass(ix: EdgeIndex, k: string): ObjectClass | undefined {
  if (k === EVERYONE || ix.isTenant(k)) return undefined
  const o = ix.obj(k)
  return o ? objectClassOf(interfacesOf(o), ix.isGroupLike(k)) : undefined
}

const reachMemo = new WeakMap<EdgeIndex, Map<string, Record<ObjectClass, number>>>()

/** 테넌트에 걸린 권한 간선의 종류별 문턱. 관계 행이면 관계 종류, 배정 객체(Assignment)면 has_role_on, 레코드 규칙이면 tenant_grant */
export function edgeTenantReach(ix: EdgeIndex, e: Edge): Record<ObjectClass, number> {
  let memo = reachMemo.get(ix)
  if (!memo) reachMemo.set(ix, (memo = new Map()))
  const hit = memo.get(e.id)
  if (hit) return hit
  const relTypes = new Set<string>()
  for (const r of e.refs) {
    if (r.type === 'relation') { const t = ix.graph.relationsByKey.get(r.id)?.relationType; if (t) relTypes.add(t) }
    else if (r.type === 'reference' && ix.has(r.id, 'Assignment')) relTypes.add('has_role_on')
  }
  const props = e.roleKey ? (ix.obj(e.roleKey)?.canonical.properties as Record<string, unknown> | undefined) : undefined
  const out = tenantReach(ix.provider(e.to), tenantKindOf(e.tenantGrant, [...relTypes]), edgeCaps(e), props)
  memo.set(e.id, out)
  return out
}

/**
 * 테넌트 y 에 걸린 권한 e 가 그 아래 대상 x 에 닿는 세기 문턱. 엔진 can 이 테넌트를 지날 때 부른다.
 * asType 으로 물으면(그 안에 새로 만드는 것) 테넌트 자체를 물을 때는 내용으로 본다
 */
export function tenantLimit(ix: EdgeIndex, e: Edge, x: string, asType?: string): number {
  const cls = asType && ix.isTenant(x) ? 'content' : objectClass(ix, x)
  return cls ? edgeTenantReach(ix, e)[cls] : 0
}

// ---- 앞으로 펴기 (사람, 신원 기준) ----

export interface Subject {
  kind: 'person' | 'identity'
  key: string
  /** 같은 사람 계정. 약한 연결이면 그 계정으로만 닿는 것은 추정 */
  accounts: ReadonlyArray<{ key: string; link: 'strong' | 'weak' }>
}

/** 근거 하나: 권한 간선 하나와 거쳐 온 소속 줄 */
export interface GrantBasis {
  /** 권한 간선 id */
  edge: string
  /** 출발 계정 */
  account: string
  /** 계정에서 권한을 가진 주체까지 소속 간선 id */
  via: string[]
  bits: number
  state: State
  /** config 설정, log 로그에서 확인한 권한, model 모델 기본, author 작성자 */
  source: 'config' | 'log' | 'model' | 'author'
  reasons: string[]
}

export interface DirectEntry {
  target: string
  /** 확정 근거로 낸 수준. 확정 근거가 없으면 모든 근거의 수준 */
  level: Level
  bits: number
  state: State
  /** 이 대상에 닿게 한 권한 간선 전부 */
  grants: GrantBasis[]
}

export interface DirectPermissions {
  subject: Subject
  entries: Map<string, DirectEntry>
}

/** 펴기가 읽는 그래프. EdgeIndex 와 판정 그래프(judge.ts)가 각자 맞춘다 */
export interface GrantView {
  id: string
  from: string
  to: string
  appliesTo?: readonly string[]
  roleKey?: string
  uncertain: readonly string[]
  source: GrantBasis['source']
  /** 수준을 안다(능력 목록이나 세기가 있다) */
  known: boolean
  /** 도착이 테넌트일 때 종류별 문턱. 없으면 막지 않는다(사례 시험의 추상 그래프) */
  reach?: Partial<Record<ObjectClass, number>>
}

export interface DirectSource {
  memberOf(k: string): ReadonlyArray<{ id: string; to: string }>
  grantsOf(k: string): ReadonlyArray<GrantView>
  childrenOf(k: string): ReadonlyArray<{ id: string; child: string }>
  /** 테넌트 소속 계정(그룹 아닌 주체) */
  tenantAccounts(t: string): ReadonlyArray<{ id: string; account: string }>
  provider(k: string): string | undefined
  type(k: string): string | undefined
  isTenant(k: string): boolean
  objectClass(k: string): ObjectClass | undefined
  roleExcluded(role: string | undefined, member: string): boolean
  /** 권한 g 가 대상 x 에서 이 수준을 내나(상한, 깎기 포함). limit 은 범위 문턱 세기. 못 내면 undefined */
  grantAt(g: GrantView, x: string, level: DirectLevel, limit: number): { reasons: string[] } | undefined
}

type Spread = Map<string, { bits: number; reasons: string[] }>
const spreadMemo = new WeakMap<DirectSource, Map<string, Spread>>()

/** 권한 간선 하나가 아래로 내려가 닿는 대상과 비트. 사람과 상관없어 간선마다 한 번만 편다 */
export function spreadOf(src: DirectSource, g: GrantView): Spread {
  let memo = spreadMemo.get(src)
  if (!memo) spreadMemo.set(src, (memo = new Map()))
  const hit = memo.get(g.id)
  if (hit) return hit
  const out: Spread = new Map()
  const root = g.to
  const tenantRoot = src.isTenant(root)
  const best = new Map<string, number>()
  const st: Array<[string, number]> = [[root, Infinity]]
  while (st.length) {
    const [x, lim] = st.pop()!
    const prev = best.get(x)
    if (prev !== undefined && prev >= lim) continue
    best.set(x, lim)
    const inherited = x !== root
    let l = lim
    if (inherited && tenantRoot && g.reach) {
      const cls = src.objectClass(x)
      l = Math.min(l, cls ? g.reach[cls] ?? 0 : 0)
    }
    if (l > 0 && !(inherited && g.appliesTo?.length && !g.appliesTo.includes(src.type(x) ?? ''))) {
      let bits = 0
      const reasons = new Set<string>()
      for (const lv of LEVELS) {
        const ok = src.grantAt(g, x, lv, l)
        if (!ok) continue
        bits |= LEVEL_BIT[lv]
        for (const r of ok.reasons) reasons.add(r)
      }
      if (bits) {
        const had = out.get(x)
        out.set(x, { bits: (had?.bits ?? 0) | bits, reasons: [...new Set([...(had?.reasons ?? []), ...reasons])] })
      }
    }
    const p = src.provider(x)
    for (const c of src.childrenOf(x)) {
      if (src.isTenant(c.child) || src.provider(c.child) !== p) continue
      // inheritCap(provider, 위 종류, 아래 종류)
      st.push([c.child, Math.min(lim, inheritCap(p, src.type(x), src.type(c.child)))])
    }
    if (src.isTenant(x)) for (const a of src.tenantAccounts(x)) st.push([a.account, lim])
  }
  memo.set(g.id, out)
  return out
}

/** 소속을 펴서 닿은 권한 간선 하나. via 는 계정에서 권한을 가진 주체까지 소속 간선 id */
export interface ReachedGrant {
  account: Subject['accounts'][number]
  via: string[]
  grant: GrantView
}

/** 권한 간선 자체가 「모름」인가(수준 모름, 불확실 간선) */
export const grantUnsure = (g: GrantView): boolean => !g.known || g.uncertain.length > 0

/** 근거 하나의 상태. 상한을 확인 못 한 대상(reasons)도 모름 */
export const basisState = (g: GrantView, reasons: readonly string[], link: 'strong' | 'weak'): State =>
  grantUnsure(g) || reasons.length > 0 ? 'unknown' : link === 'weak' ? 'inferred' : 'confirmed'

/** 사람(또는 신원)의 계정마다 소속을 펴서 닿는 권한 간선. 역할에서 빠진 구성원을 거친 권한은 뺀다. 누구나는 기본으로 넣는다 */
export function reachedGrants(src: DirectSource, subject: Subject, opts: { everyone?: boolean } = {}): ReachedGrant[] {
  const out: ReachedGrant[] = []
  for (const acct of subject.accounts) {
    // 소속 펴기. 주체마다 처음 닿은 줄 하나(근거용)와 그 줄 위 구성원(역할 제외 판정용)
    const via = new Map<string, { ids: string[]; members: string[] }>([[acct.key, { ids: [], members: [] }]])
    const st = [acct.key]
    while (st.length) {
      const x = st.pop()!
      const at = via.get(x)!
      for (const m of src.memberOf(x)) {
        if (via.has(m.to)) continue
        via.set(m.to, { ids: [...at.ids, m.id], members: [...at.members, x] })
        st.push(m.to)
      }
    }
    if (opts.everyone !== false && !via.has(EVERYONE)) via.set(EVERYONE, { ids: [], members: [] })
    for (const [q, path] of via) for (const g of src.grantsOf(q)) {
      if (path.members.some(m => src.roleExcluded(g.roleKey, m))) continue
      out.push({ account: acct, via: path.ids, grant: g })
    }
  }
  return out
}

/** 사람(또는 신원) 하나의 직접 권한 */
export function directPermissions(src: DirectSource, subject: Subject, opts: { everyone?: boolean } = {}): DirectPermissions {
  const entries = new Map<string, DirectEntry>()
  for (const { account, via, grant: g } of reachedGrants(src, subject, opts)) {
    for (const [x, r] of spreadOf(src, g)) {
      const state = basisState(g, r.reasons, account.link)
      const basis: GrantBasis = { edge: g.id, account: account.key, via, bits: r.bits, state, source: g.source, reasons: [...new Set([...g.uncertain, ...r.reasons, ...(g.known ? [] : ['role_rank_unknown'])])] }
      const cur = entries.get(x)
      if (cur) cur.grants.push(basis)
      else entries.set(x, { target: x, level: 'read', bits: 0, state, grants: [basis] })
    }
  }
  for (const en of entries.values()) {
    const sure = en.grants.filter(b => b.state === 'confirmed')
    const inferred = en.grants.filter(b => b.state === 'inferred')
    const pick = sure.length ? sure : inferred.length ? inferred : en.grants
    en.state = sure.length ? 'confirmed' : inferred.length ? 'inferred' : 'unknown'
    en.bits = pick.reduce((b, x) => b | x.bits, 0)
    en.level = bitsLevel(en.bits) ?? 'read'
  }
  return { subject, entries }
}

// ---- EdgeIndex 맞춤 ----

const sourceOf = (e: Edge): GrantBasis['source'] => (e.grantSource === 'observed' ? 'log' : e.grantSource === 'model' ? 'model' : e.grantSource === 'author' ? 'author' : 'config')

/**
 * EdgeIndex 를 펴기 입력으로. excluded 는 끊어 볼 간선 id, configOnly 면 로그에서만 확인한 권한을 뺀다(엔진 can 의 설정 문맥과 같다)
 */
export function edgeIndexSource(ix: EdgeIndex, opts: { excluded?: ReadonlySet<string>; configOnly?: boolean } = {}): DirectSource {
  const ok = (e: Edge) => !opts.excluded?.has(e.id)
  const views = new Map<string, GrantView & { edge: Edge }>()
  const view = (e: Edge) => {
    let v = views.get(e.id)
    if (!v) {
      v = {
        id: e.id, from: e.from, to: e.to, ...(e.appliesTo?.length ? { appliesTo: e.appliesTo } : {}), ...(e.roleKey ? { roleKey: e.roleKey } : {}),
        uncertain: e.uncertain, source: sourceOf(e), known: e.caps !== undefined || e.rank !== undefined,
        ...(ix.isTenant(e.to) ? { reach: edgeTenantReach(ix, e) } : {}), edge: e,
      }
      views.set(e.id, v)
    }
    return v
  }
  return {
    memberOf: k => ix.outOf(k, 'M').filter(ok).map(e => ({ id: e.id, to: e.to })),
    grantsOf: k => ix.outOf(k, 'G').filter(e => ok(e) && !(opts.configOnly && e.grantSource === 'observed')).map(view),
    childrenOf: k => ix.inOf(k, 'U').filter(ok).map(e => ({ id: e.id, child: e.from })),
    tenantAccounts: t => ix.inOf(t, 'M').filter(e => ok(e) && ix.has(e.from, 'Principal') && !ix.isGroupLike(e.from)).map(e => ({ id: e.id, account: e.from })),
    provider: k => ix.provider(k),
    type: k => ix.type(k),
    isTenant: k => ix.isTenant(k),
    objectClass: k => objectClass(ix, k),
    roleExcluded: (role, m) => !!role && !!ix.roleExcludes.get(role)?.has(m),
    grantAt: (g, x, lv, limit) => underCeiling(ix, ix.ceilings, (g as GrantView & { edge: Edge }).edge, x, undefined, needOf(lv), limit),
  }
}
