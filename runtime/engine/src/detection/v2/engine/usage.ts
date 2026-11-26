/**
 * 사건으로 본 사용과 출처 — aegi-knowledge schema/specs/Activity_Usage_v1.md.
 *
 * 관계·간선·EA level·격차 판정은 설정(스냅샷)으로만 정한다. 이 모듈은 그 판정이 다 끝난 뒤에 사건 기록(Activity)을 읽어
 * 「실제로 썼나」를 옆 칸에 붙이는 별도 단계다. 간선을 만드는 규칙(edges.ts)과 질의(query.ts)는 바꾸지 않는다.
 *
 * - 사건마다 행위(verb)를 능력으로 바꿔(VERB_CAPABILITY) 엔진에 묻는다. 근거 경로가 지난 간선이 그 사건을 쓴 것이다
 * - 사건이 0 건이면 아무것도 붙이지 않는다(로그가 없는 환경은 결과가 같다)
 * - 「안 썼다」는 그 provider 사건의 관측 창과 함께만 낸다. 로그에 없음은 권한 없음이 아니다
 * - 수집기 자신의 사건(Activity self, 또는 받은 수집기 객체 키·식별자)은 세지 않는다
 */
import { RANK } from './accessModel'
import { ACTIVITY_REVIEW_TYPES, ACTIVITY_TYPES } from '../../../ontology/generated'
import type { AccessEngine } from './index'
import { EVERYONE, OBS_PREFIX } from './edges'
import { needOf } from './semantic/ceiling'
import type { Edge } from './types'
import { delegatedCalls } from './semantic/facts'

/** 엔진이 읽는 사건 기록 칸만 (scripts/collect/shared/activities.ts Activity 의 부분) */
export interface ActivityLike {
  id: string
  provider: string
  event_type: string
  occurred_at: string | null
  action: { verb: string }
  /** directory_ref: 같은 신원의 디렉터리 계정(사전 actor.directory). 행위자 계정으로 설명이 안 되면 이것으로도 묻는다 */
  actor: { ref: string | null; native?: { id: string }; directory_ref?: string } | null
  via?: Array<{ ref: string | null; native?: { id: string } }>
  targets: Array<{ ref: string | null; slot: string; native?: { id: string } }>
  outcome: string
  self?: boolean
  effects?: Array<{ kind: string; relation_type?: string; refs?: { from?: string; to?: string; at?: string } }>
}

export type AskedCapability = 'read' | 'write' | 'admin' | 'invoke' | 'member' | 'authenticate'

/** 행위 → 물을 능력. 명세 Activity_Usage_v1 「행위 → 물을 능력」 표와 같다(knowledge 시험이 표가 사전 행위를 다 덮는지 본다) */
export const VERB_CAPABILITY: Record<string, AskedCapability> = {
  read: 'read', export: 'read',
  write: 'write', create: 'write', delete: 'write', send: 'write',
  grant: 'admin', revoke: 'admin', configure: 'admin', activate: 'admin',
  execute: 'invoke', request: 'member', authenticate: 'authenticate',
}

const TARGET_SLOTS = new Set(['target', 'object', 'container', 'destination'])
const CREATE_OR_DELETE = new Set(['create', 'delete'])
const SUCCESS = new Set(['success', 'success_implied'])

export type ActivityClass =
  /** 원래 권한(M*·G·U⁻¹*) 또는 구성원·호출 경로로 설명됨 */
  | 'native'
  /** 위협 판정의 파생 접근(자동화, 앱, 토큰을 거쳐 닿음) 또는 자동화의 실행 신원 권한으로만 설명됨 */
  | 'integration'
  /** 두 끝을 찾았는데 그래프에 길이 없다 (unexplained_activity 후보) */
  | 'none'
  /** 행위자나 대상을 그래프에서 못 찾았다 */
  | 'unattached'
  /** 인증(토큰 발급, SSO). 묻지 않고 따로 센다 */
  | 'authenticate'
  /** 실패했거나 결과를 모른다. 사용으로 세지 않는다 */
  | 'not_success'
  /** 수집기 자신 */
  | 'self'

export interface ActivityVerdict {
  id: string
  provider: string
  event_type: string
  at: string | null
  capability: AskedCapability
  cls: ActivityClass
  /** 근거 경로에 불확실 간선 또는 열린 목록이 있다 */
  uncertain: boolean
  /** 짧은 근거나 원인 짐작(값 없이 종류만) */
  why: string
  actor: string | null
  /** 물은 대상(관리 행위는 그 provider 테넌트 포함) */
  asked: string[]
  /** 근거 경로가 지난 간선 id */
  edges: string[]
  /** 근거 경로의 관계 가운데 간선 id 로 못 잇는 것(판정 그래프의 실행 신원 사슬). 연동(integration) 판정만 */
  relations?: string[]
}

export interface EdgeUsage {
  count: number
  first_at: string | null
  last_at: string | null
  /** 그 간선을 지난 사건의 행위자(계정 키) */
  actors: Set<string>
  /** 행위자 → 그 행위자의 사건 id (5개까지) */
  byActor: Map<string, string[]>
}

export interface RelationUsage {
  first_at: string | null
  last_at: string | null
  count: number
  window: Window | null
  source: 'activity'
}

export interface RelationProvenance {
  granted_by: string | null
  granted_at: string | null
  /** Activity id. 마지막 부여가 앞 */
  evidence: string[]
}

export interface Window { from: string; to: string }

export interface GrantPair {
  relation_type: string
  from: string
  to: string
  last: 'add' | 'remove'
  events: number
  /** 이 쌍을 낸 사건 종류(provider|event_type) */
  event_types: string[]
  /** 창 안에서 부여 뒤 제거됐다 */
  transient: boolean
  /** 스냅샷에 같은 종류의 관계가 있다(방향 무관) */
  present: boolean
  /** 같은 종류는 없지만 두 끝 사이 다른 관계가 있거나, 두 끝을 함께 가리키는 배정 객체(Assignment)가 있다 */
  presentOtherType: boolean
}

export interface LogUsage {
  verdicts: ActivityVerdict[]
  edges: Map<string, EdgeUsage>
  relations: Map<string, { usage?: RelationUsage; provenance?: RelationProvenance }>
  /** provider → 그 provider 사건(수집기 자신 뺌)의 처음·마지막 시각 */
  windows: Record<string, Window>
  grants: GrantPair[]
  /** (행위자|객체) → 그 객체에 한 설명된 사건 (EA exercised 가 읽는다) */
  exercisedOn: Map<string, Array<{ id: string; at: string | null }>>
  /** 효과를 믿지 않아(사전 review 줄) 출처·부여 대조·관계 사용에 쓰지 않은 사건 수 */
  untrustedEffects: number
  /** 테넌트 객체에 쓰기 이상 권한 간선(설정 출처)을 가진 계정. 그룹은 구성원으로 편다. 수집기 자신 뺌 (점수판 「안 쓰인 테넌트 권한」) */
  holdings: Array<{ account: string; tenant: string; provider: string; need: number; edges: string[] }>
  edgeStats: { observedTotal: number; withUsage: number; observedWithUsage: number; gWithUsage: number; gObservedWithUsage: number }
}

export interface LogUsageOptions {
  /** 수집기 자신의 그래프 객체 키 (행위자나 경유가 이것이면 뺀다) */
  selfKeys?: ReadonlySet<string>
  /** 수집기 자신의 원본 식별자 (registry 의 수집기 자격증명 식별자, AEGI_GWS_SELF_CLIENT_IDS 와 같은 기준) */
  selfIds?: ReadonlySet<string>
  /** 효과를 믿지 않는 사건 종류(provider|event_type). 기본은 사전에서 사람 확인(review)이 남은 줄 */
  untrustedTypes?: ReadonlySet<string>
  /**
   * 원래 권한에 없을 때 연동으로 닿는지 묻는 곳(위협 판정 파생 접근, scripts/loader/engine.ts derivedQuery).
   * 없으면 연동 판정을 하지 않는다(원래 권한 아니면 none)
   */
  derived?: DerivedQuery
}

/** 위협 판정의 파생 접근으로 묻는다. 사람은 파생 접근, 자동화는 고정 실행 신원 권한. sure 면 확정, 아니면 불확실 */
export interface DerivedQuery {
  at(account: string, cap: 'read' | 'write' | 'admin', target: string): { sure: boolean; edges: string[]; relations: string[] } | undefined
}

const min = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a < b ? a : b)
const max = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b)

export function isSelfActivity(a: ActivityLike, opts: LogUsageOptions = {}): boolean {
  if (a.self) return true
  const keys = opts.selfKeys, ids = opts.selfIds
  const ends = [a.actor, ...(a.via ?? [])]
  if (keys?.size && ends.some(e => e?.ref && keys.has(e.ref))) return true
  if (ids?.size && [...ends, ...a.targets].some(e => e?.native?.id && ids.has(e.native.id))) return true
  return false
}

/** 사건마다 엔진에 묻고, 근거 경로의 간선·관계에 사용을, 부여 사건으로 관계에 출처를 모은다 */
export function collectLogUsage(engine: AccessEngine, activities: readonly ActivityLike[], opts: LogUsageOptions = {}): LogUsage {
  const ix = engine.ix, ctx = engine.ctx
  const graph = engine.input.graph
  const tenantsOf = new Map<string, string[]>()
  for (const o of graph.objectsByKey.values()) {
    if (!ix.isTenant(o.fixture_key)) continue
    const p = o.canonical.provider
    tenantsOf.set(p, [...(tenantsOf.get(p) ?? []), o.fixture_key])
  }
  const OPEN = { cost: 0, path: [], reasons: [], observed: false }
  // 위임 호출(identity caller): 호출 간선(T)이 없고, 호출 사건은 부른 사람이 그 출발의 구성원(M*)이면 설명된다
  const delegated = delegatedCalls(ix.semanticFacts)
  /**
   * 이 행위자가 자동화 t 를 돌릴 수 있는가. 들어오는 호출 간선(T)마다 부르는 사람(출발의 구성원), 입력을 넣는 사람(입력 자원 쓰기 권한자),
   * 다른 자동화를 거쳐 입력 자원에 쓰는 사람(위협 판정 파생 접근 opts.derived)을 본다. 직접 쓰기 권한이 불확실하면 파생 접근도 묻고 확실한 쪽을 쓴다.
   * 호출 간선이 불확실하거나 근거에 불확실 간선, 열린 목록이 있으면 모름이다. 파생 접근으로 설명되면 그 근거 관계도 돌려준다(관계 사용).
   */
  const invokeOf = (t: string, who: string): { verdict: 'yes' | 'unknown' | 'no'; edges: string[]; relations: string[] } => {
    const best: { verdict: 'yes' | 'unknown' | 'no'; edges: string[]; relations: string[] } = { verdict: 'no', edges: [], relations: [] }
    const take = (sure: boolean, ids: string[], rels: string[] = []) => {
      if (best.verdict === 'yes' || (!sure && best.verdict === 'unknown' && best.edges.length)) return
      best.verdict = sure ? 'yes' : 'unknown'
      best.edges = ids
      best.relations = rels
    }
    for (const e of ix.inOf(t, 'T')) {
      const src = e.from
      const tSure = !e.uncertain.length
      // 출발이 사람, 그룹, 누구나면 부르는 사람(구성원). 그 밖(입력 자원, 관측 행위자)은 입력을 넣는 사람(쓰기 권한자)
      const callers = src === EVERYONE || ix.isGroupLike(src) || (ix.has(src, 'Principal') && !src.startsWith(OBS_PREFIX))
      const set = callers ? ctx.members(src, OPEN) : ctx.can(needOf('write'), src)
      const h = set.hits.get(who) ?? set.everyone
      const hSure = !!h && tSure && h.cost === 0
      if (h) take(hSure, [...ctx.witness(h).edges.map(x => x.id), e.id])
      if (!hSure) {
        const r = callers ? undefined : opts.derived?.at(who, 'write', src)
        if (r) take(tSure && r.sure, [...r.edges, e.id], r.relations)
        else if (!h && set.open.length) take(false, [])
      }
      if (best.verdict === 'yes') break
    }
    return best
  }

  const cache = new Map<string, Omit<ActivityVerdict, 'id' | 'provider' | 'event_type' | 'at' | 'actor'>>()
  const ask = (cap: AskedCapability, actor: string, asked: string[]): Omit<ActivityVerdict, 'id' | 'provider' | 'event_type' | 'at' | 'actor'> => {
    const key = `${cap}|${actor}|${asked.join(',')}`
    const hit = cache.get(key)
    if (hit) return hit
    let out: Omit<ActivityVerdict, 'id' | 'provider' | 'event_type' | 'at' | 'actor'>
    if (cap === 'member') {
      const ok = asked.some(t => ctx.members(t, OPEN).hits.has(actor))
      out = { capability: cap, cls: ok ? 'native' : 'none', uncertain: false, why: ok ? '테넌트 구성원(M*)' : '테넌트 소속(M) 없음', asked, edges: [] }
    } else if (cap === 'invoke') {
      let best: 'yes' | 'unknown' | 'no' = 'no'
      let viaDelegated = false
      const edges = new Set<string>(), rels = new Set<string>()
      for (const t of asked) {
        const tr = invokeOf(t, actor)
        if (tr.verdict !== 'no') {
          if (tr.verdict === 'yes') best = 'yes'; else if (best === 'no') best = 'unknown'
          for (const id of tr.edges) edges.add(id)
          for (const k of tr.relations) rels.add(k)
        }
        if (best !== 'yes') {
          for (const f of delegated.get(t) ?? []) {
            const m = ctx.members(f.from, OPEN)
            const dh = m.hits.get(actor) ?? m.everyone
            if (!dh) continue
            viaDelegated = true
            if (dh.cost === 0) best = 'yes'; else if (best === 'no') best = 'unknown'
            for (const e of ctx.witness(dh).edges) edges.add(e.id)
            if (best === 'yes') break
          }
        }
        if (best !== 'yes') {
          const c = engine.askCan(actor, 'read', t)
          if (c.verdict !== 'no') { best = c.verdict === 'yes' ? 'yes' : best === 'no' ? 'unknown' : best; for (const e of c.witness?.edges ?? []) edges.add(e.id) }
        }
      }
      out = best === 'no'
        ? { capability: cap, cls: 'none', uncertain: false, why: asked.some(t => ix.inOf(t, 'T').length) ? '호출 간선은 있으나 이 행위자가 그 출발에 안 듦' : '이 자동화로 들어오는 호출 간선(T) 없음', asked, edges: [] }
        : { capability: cap, cls: 'native', uncertain: best === 'unknown', why: viaDelegated ? '위임 호출(부른 사람 자신의 권한, 구성원 M*)' : '호출 경로(T) 또는 읽기', asked, edges: [...edges], ...(rels.size ? { relations: [...rels] } : {}) }
    } else {
      const c = cap as 'read' | 'write' | 'admin'
      let native: 'yes' | 'unknown' | 'no' = 'no', integ: 'yes' | 'unknown' | 'no' = 'no'
      let nEdges: string[] = [], iEdges: string[] = [], iRels: string[] = []
      for (const t of asked) {
        const r = engine.askCan(actor, c, t)
        if (r.verdict === 'yes' || (r.verdict === 'unknown' && native === 'no')) { native = r.verdict; nEdges = (r.witness?.edges ?? []).map(e => e.id) }
        if (native === 'yes') break
      }
      // 연동: 위협 판정의 파생 접근(사람은 자동화, 앱, 토큰을 거쳐 닿는 곳, 자동화는 고정 실행 신원 권한)
      if (native !== 'yes' && opts.derived) {
        for (const t of asked) {
          const r = opts.derived.at(actor, c, t)
          if (r && (r.sure || integ === 'no')) { integ = r.sure ? 'yes' : 'unknown'; iEdges = r.edges; iRels = r.relations }
          if (integ === 'yes') break
        }
      }
      out = native !== 'no'
        ? { capability: cap, cls: 'native', uncertain: native === 'unknown', why: '원래 권한 M*·G·U⁻¹*', asked, edges: nEdges }
        : integ !== 'no'
          ? { capability: cap, cls: 'integration', uncertain: integ === 'unknown', why: '파생 접근(위협 판정) 또는 실행 신원 권한', asked, edges: iEdges, ...(iRels.length ? { relations: iRels } : {}) }
          : { capability: cap, cls: 'none', uncertain: false, why: diagnose(engine, actor, c, asked), asked, edges: [] }
    }
    cache.set(key, out)
    return out
  }

  // 행위자 계정으로 묻고, 원래 권한으로 확실히 설명되지 않으면 같은 신원의 디렉터리 계정(사전 actor.directory)으로도 묻는다.
  // 같은 계정이 그룹 · 도메인으로 받은 권한은 디렉터리 계정 쪽에서만 닿는다. 더 좋은 답이면 그 계정을 행위자로 적는다(via)
  const grade = (o: { cls: string; uncertain: boolean }) => o.cls === 'native' ? (o.uncertain ? 3 : 4) : o.cls === 'integration' ? (o.uncertain ? 1 : 2) : 0
  const askBoth = (cap: AskedCapability, actor: { ref: string | null; directory_ref?: string }, asked: string[]) => {
    const out = ask(cap, actor.ref!, asked)
    if (!actor.directory_ref || grade(out) === 4) return { out }
    const alt = ask(cap, actor.directory_ref, asked)
    return grade(alt) > grade(out) ? { out: alt, via: actor.directory_ref } : { out }
  }

  const untrusted = opts.untrustedTypes ?? new Set(ACTIVITY_REVIEW_TYPES)
  const trusted = (a: ActivityLike) => !untrusted.has(`${a.provider}|${a.event_type}`)
  let untrustedEffects = 0
  const verdicts: ActivityVerdict[] = []
  const windows: Record<string, Window> = {}
  for (const a of activities) {
    const base = { id: a.id, provider: a.provider, event_type: a.event_type, at: a.occurred_at, actor: a.actor?.ref ?? null }
    const capability = VERB_CAPABILITY[a.action.verb] ?? 'read'
    if (isSelfActivity(a, opts)) { verdicts.push({ ...base, capability, cls: 'self', uncertain: false, why: '수집기 자신', asked: [], edges: [] }); continue }
    if (a.occurred_at) {
      const w = windows[a.provider]
      windows[a.provider] = w ? { from: min(w.from, a.occurred_at)!, to: max(w.to, a.occurred_at)! } : { from: a.occurred_at, to: a.occurred_at }
    }
    if (!SUCCESS.has(a.outcome)) { verdicts.push({ ...base, capability, cls: 'not_success', uncertain: false, why: `결과 ${a.outcome}`, asked: [], edges: [] }); continue }
    if (capability === 'authenticate') { verdicts.push({ ...base, capability, cls: 'authenticate', uncertain: false, why: '인증(묻지 않음)', asked: [], edges: [] }); continue }
    if (!a.actor?.ref) { verdicts.push({ ...base, capability, cls: 'unattached', uncertain: false, why: '행위자 객체 없음', asked: [], edges: [] }); continue }
    // 자기 계정 행위(사전 self_service): 관리 권한 대신 그 테넌트 구성원인지를 묻는다. 남의 계정에 한 같은 행위는 아래 표대로
    const selfService = ACTIVITY_TYPES[`${a.provider}|${a.event_type}`]?.self_service
    if (selfService === 'actor' || (selfService === 'target' && a.targets.some(t => t.slot === 'target' && t.ref === a.actor!.ref))) {
      const tenants = tenantsOf.get(a.provider) ?? []
      if (!tenants.length) { verdicts.push({ ...base, capability: 'member', cls: 'unattached', uncertain: false, why: '테넌트 객체 없음', asked: [], edges: [] }); continue }
      const m = askBoth('member', a.actor, tenants)
      // 물은 능력은 구성원(member)으로 적는다. 관리 능력을 쓴 것으로 세지 않는다(안 쓰인 테넌트 권한)
      verdicts.push({ ...base, ...(m.via ? { actor: m.via } : {}), ...m.out, why: m.out.cls === 'native' ? '자기 계정(구성원 M*)' + (m.via ? ' · 같은 디렉터리 계정' : '') : '자기 계정인데 테넌트 소속(M) 없음' })
      continue
    }
    const found = [...new Set(a.targets.filter(t => t.ref && TARGET_SLOTS.has(t.slot)).map(t => t.ref as string))]
    const anyFound = [...new Set(a.targets.filter(t => t.ref).map(t => t.ref as string))]
    const tenants = tenantsOf.get(a.provider) ?? []
    // 관리 행위는 그 provider 테넌트에 묻는다(대상을 찾았으면 그것도, 좋은 답). 구성원 행위는 테넌트 소속만 본다
    // 만들기·지우기는 만든(지운) 객체 자신보다 그것이 들어갈 곳의 권한이 필요하다: 대상과 그 provider 테넌트 중 좋은 답
    const asked = capability === 'admin' ? [...new Set([...tenants, ...anyFound])] : capability === 'member' ? tenants
      : CREATE_OR_DELETE.has(a.action.verb) ? [...new Set([...found, ...tenants])] : found
    if (!asked.length) { verdicts.push({ ...base, capability, cls: 'unattached', uncertain: false, why: capability === 'admin' || capability === 'member' ? '테넌트 객체 없음' : '대상 객체 없음', asked: [], edges: [] }); continue }
    const r = askBoth(capability, a.actor, asked)
    verdicts.push({ ...base, ...(r.via ? { actor: r.via } : {}), ...r.out, ...(r.via ? { why: `${r.out.why} · 같은 디렉터리 계정` } : {}) })
  }

  // 간선·관계 사용, 행위자가 한 객체
  const edges = new Map<string, EdgeUsage>()
  const relations = new Map<string, { usage?: RelationUsage; provenance?: RelationProvenance }>()
  const exercisedOn = new Map<string, Array<{ id: string; at: string | null }>>()
  const useRelation = (key: string, at: string | null, provider: string) => {
    const r = relations.get(key) ?? {}
    const u = r.usage ?? { first_at: null, last_at: null, count: 0, window: windows[provider] ?? null, source: 'activity' as const }
    u.count++; u.first_at = min(u.first_at, at); u.last_at = max(u.last_at, at)
    r.usage = u
    relations.set(key, r)
  }
  const relIndex = new Map<string, string[]>()
  for (const [k, r] of graph.relationsByKey) {
    for (const key of [`${r.relationType}|${r.sourceKey}|${r.targetKey}`, `*|${r.sourceKey}|${r.targetKey}`, `*|${r.targetKey}|${r.sourceKey}`]) relIndex.set(key, [...(relIndex.get(key) ?? []), k])
  }
  const byId = new Map(activities.map(a => [a.id, a]))
  for (const v of verdicts) {
    if (v.cls !== 'native' && v.cls !== 'integration') continue
    const a = byId.get(v.id)!
    const touched = new Set<string>(v.asked)
    const relKeys = new Set<string>()
    for (const id of v.edges) {
      const e = ix.edges.get(id)
      if (!e) continue
      const u = edges.get(id) ?? { count: 0, first_at: null, last_at: null, actors: new Set<string>(), byActor: new Map<string, string[]>() }
      u.count++; u.first_at = min(u.first_at, v.at); u.last_at = max(u.last_at, v.at)
      if (v.actor) {
        u.actors.add(v.actor)
        const l = u.byActor.get(v.actor) ?? []
        if (l.length < 5) l.push(v.id)
        u.byActor.set(v.actor, l)
      }
      edges.set(id, u)
      touched.add(e.to)
      for (const r of e.refs) if (r.type === 'relation') relKeys.add(r.id)
    }
    for (const k of v.relations ?? []) relKeys.add(k)
    // 사전 효과가 exercised 인 관계는 두 끝 관계에 바로 센다
    for (const ef of trusted(a) ? a.effects ?? [] : []) {
      if (ef.kind !== 'exercised' || !ef.relation_type || !ef.refs?.from || !ef.refs?.to) continue
      for (const k of relIndex.get(`${ef.relation_type}|${ef.refs.from}|${ef.refs.to}`) ?? []) relKeys.add(k)
    }
    for (const k of relKeys) useRelation(k, v.at, v.provider)
    if (v.actor) for (const t of touched) {
      const key = `${v.actor}|${t}`
      const l = exercisedOn.get(key) ?? []
      l.push({ id: v.id, at: v.at })
      exercisedOn.set(key, l)
    }
  }

  // 출처와 부여 쌍: 관계 효과 두 끝을 다 찾은 사건만 (수집기 자신 뺌, 결과 모름도 센다 — 부여 기록은 끝난 변경이다)
  const skip = new Set(verdicts.filter(v => v.cls === 'self' || (v.cls === 'not_success' && byId.get(v.id)!.outcome === 'failure')).map(v => v.id))
  const pairEvents = new Map<string, Array<{ op: 'add' | 'remove'; at: string | null; id: string; actor: string | null; type: string; from: string; to: string; et: string }>>()
  for (const a of activities) {
    if (skip.has(a.id)) continue
    if (!trusted(a)) { if ((a.effects ?? []).some(ef => ef.relation_type && ef.refs?.from && ef.refs?.to)) untrustedEffects++; continue }
    for (const ef of a.effects ?? []) {
      if (!ef.relation_type || !ef.refs?.from || !ef.refs?.to) continue
      const op = ef.kind === 'relation_created' || ef.kind === 'relation_modified' ? 'add' : ef.kind === 'relation_removed' ? 'remove' : null
      if (!op) continue
      const pk = `${ef.relation_type}|${ef.refs.from}|${ef.refs.to}`
      const l = pairEvents.get(pk) ?? []
      l.push({ op, at: a.occurred_at, id: a.id, actor: a.actor?.ref ?? null, type: ef.relation_type, from: ef.refs.from, to: ef.refs.to, et: `${a.provider}|${a.event_type}` })
      pairEvents.set(pk, l)
    }
  }
  // 두 끝을 함께 가리키는 배정 객체(Okta AppUser, Salesforce PermissionSetAssignment 같은 것). 관계 행이 아니라 객체로 들어온 부여다
  const assignOf = new Map<string, Set<string>>()
  for (const o of graph.objectsByKey.values()) {
    const refs = (o.canonical as { references?: Record<string, { targets?: Array<{ value?: unknown }> }> }).references ?? {}
    const vals = new Set(Object.values(refs).flatMap(slot => (slot?.targets ?? []).map(t => String(t?.value ?? ''))).filter(Boolean))
    if (!o.canonical.interfaces.includes('Assignment' as never) && vals.size < 2) continue
    for (const v of vals) assignOf.set(v, (assignOf.get(v) ?? new Set()).add(o.fixture_key))
  }
  const sharedAssignment = (a: string, b: string) => { const x = assignOf.get(a), y = assignOf.get(b); return !!x && !!y && [...x].some(k => y.has(k)) }
  const grants: GrantPair[] = []
  for (const [pk, evs] of pairEvents) {
    evs.sort((x, y) => String(x.at).localeCompare(String(y.at)) || x.id.localeCompare(y.id))
    const last = evs[evs.length - 1]
    const same = [...(relIndex.get(pk) ?? []), ...(relIndex.get(`${last.type}|${last.to}|${last.from}`) ?? [])]
    const other = [...(relIndex.get(`*|${last.from}|${last.to}`) ?? []), ...(relIndex.get(`*|${last.to}|${last.from}`) ?? [])]
    grants.push({
      relation_type: last.type, from: last.from, to: last.to, last: last.op, events: evs.length, event_types: [...new Set(evs.map(e => e.et))].sort(),
      transient: last.op === 'remove' && evs.some(e => e.op === 'add'), present: same.length > 0, presentOtherType: !same.length && (other.length > 0 || sharedAssignment(last.from, last.to)),
    })
    if (last.op !== 'add') continue
    const adds = evs.filter(e => e.op === 'add').reverse()
    for (const k of relIndex.get(pk) ?? []) {
      const r = relations.get(k) ?? {}
      r.provenance = { granted_by: adds[0].actor, granted_at: adds[0].at, evidence: adds.map(e => e.id).slice(0, 10) }
      relations.set(k, r)
    }
  }
  const held = new Map<string, LogUsage['holdings'][number]>()
  for (const e of ix.edges.values()) {
    if (e.kind !== 'G' || (e.rank ?? 0) < RANK.write || e.grantSource !== 'config' || !ix.isTenant(e.to) || ix.isTenant(e.from) || e.from === '@everyone') continue
    const accounts = ix.isGroupLike(e.from) ? [...ctx.members(e.from, OPEN).hits.keys()] : [e.from]
    for (const account of accounts) {
      if (!ix.has(account, 'Principal') || opts.selfKeys?.has(account) || opts.selfKeys?.has(e.from)) continue
      const k = `${account}|${e.to}`
      const h = held.get(k) ?? { account, tenant: e.to, provider: graph.objectsByKey.get(e.to)?.canonical.provider ?? '?', need: 0, edges: [] }
      h.need = Math.max(h.need, (e.rank ?? 0) >= RANK.admin ? RANK.admin : RANK.write)
      h.edges.push(e.id)
      held.set(k, h)
    }
  }
  const all = [...ix.edges.values()]
  const used = all.filter(e => edges.has(e.id))
  const edgeStats = {
    observedTotal: all.filter(e => e.observed).length, withUsage: used.length, observedWithUsage: used.filter(e => e.observed).length,
    gWithUsage: used.filter(e => e.kind === 'G').length, gObservedWithUsage: used.filter(e => e.kind === 'G' && e.observed).length,
  }
  return { verdicts, edges, relations, windows, grants, exercisedOn, untrustedEffects, holdings: [...held.values()].sort((a, b) => a.account.localeCompare(b.account) || a.tenant.localeCompare(b.tenant)), edgeStats }
}

/** 설명되지 않은 원인 짐작 (값 없이 종류만). 측정(11-11 logmeasure)과 같은 순서 */
function diagnose(engine: AccessEngine, actor: string, cap: 'read' | 'write' | 'admin', asked: string[]): string {
  const ix = engine.ix
  if (cap !== 'read' && asked.some(t => engine.askCan(actor, 'read', t).verdict !== 'no')) return `읽기까지만 닿음(${cap} 근거 없음)`
  if (cap === 'admin' && asked.some(t => engine.askCan(actor, 'write', t).verdict !== 'no')) return '쓰기까지만 닿음(관리 근거 없음)'
  let grants = 0
  const seen = new Set([actor]); let frontier = [actor]
  for (let d = 0; d < 5 && frontier.length; d++) {
    const next: string[] = []
    for (const k of frontier) {
      grants += ix.outOf(k, 'G').length
      for (const e of ix.outOf(k, 'M')) if (!seen.has(e.to)) { seen.add(e.to); next.push(e.to) }
    }
    frontier = next
  }
  if (!grants) return `행위자에게 권한(G)이 하나도 없음 (${ix.type(actor) ?? '?'})`
  if (!asked.some(t => ix.inOf(t, 'G').length)) return `대상에 들어오는 권한(G)이 하나도 없음 (${ix.type(asked[0]) ?? '?'})`
  return '행위자의 권한(G)이 다른 객체에만 있고 이 대상에 안 닿음'
}

/** 간선에 사용 칸을 붙인다(판정이 끝난 뒤). 사용이 없는 간선은 칸을 두지 않는다 */
export function attachEdgeUsage(edges: Iterable<Edge>, usage: LogUsage): number {
  let n = 0
  for (const e of edges) {
    const u = usage.edges.get(e.id)
    if (!u) continue
    e.usage = { count: u.count, first_at: u.first_at, last_at: u.last_at, actors: u.actors.size }
    n++
  }
  return n
}

// ───────── EA 행의 「실제로 쓰였나」 (판정 칸은 그대로)
//
// effective_access.json 은 다시 계산해 바이트로 견주는 저장소(scripts/accessRules/production.ts)라 칸을 거기 넣지 않는다.
// 행 id 로 잇는 옆 표로 낸다(스냅샷 계산의 activityUsage).

export interface EaExercise { exercised?: { count: number; last_at: string | null; activities: string[] }; unused_in?: { window: Window } }

/** EA 행 id → exercised 또는 unused_in. 그 provider 사건이 없으면(창 없음) 그 행은 넣지 않는다 */
export function effectiveAccessUsage(rows: ReadonlyArray<{ id: string; references: { source: string; target: string } }>, usage: LogUsage, providerOf: (key: string) => string | undefined): Record<string, EaExercise> {
  const out: Record<string, EaExercise> = {}
  for (const r of rows) {
    const hits = usage.exercisedOn.get(`${r.references.source}|${r.references.target}`) ?? []
    if (hits.length) {
      const sorted = [...hits].sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.id.localeCompare(b.id))
      out[r.id] = { exercised: { count: hits.length, last_at: sorted[0].at, activities: sorted.slice(0, 5).map(h => h.id) } }
      continue
    }
    const w = usage.windows[providerOf(r.references.source) ?? '']
    if (w) out[r.id] = { unused_in: { window: w } }
  }
  return out
}
