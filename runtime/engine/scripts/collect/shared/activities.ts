/**
 * 사건 기록(Activity): 로그 사건을 사건 사전(aegi-knowledge schema/ontology/activity_types.yaml, 생성 표 ACTIVITY_CALLS, ACTIVITY_TYPES)으로
 * 한 모양으로 만든다. 명세는 aegi-knowledge schema/specs/Activity_Schema_v1.md.
 *
 * - SaaS 이름으로 갈라지지 않는다. 호출마다 원본 칸이 어디 있는지(ACTIVITY_CALLS)와 종류마다 행위, 효과(ACTIVITY_TYPES)만 읽는다
 * - 이 단계는 보관만 한다. 간선, EA, 격차, 위협 판정은 Activity 를 읽지 않는다. 로그가 없으면 0 건이고 다른 결과는 같다
 * - 행위자, 대상은 그래프 객체의 식별자 칸으로만 찾는다(Splunk 와 같은 EntityResolver). 표시 이름으로는 찾지 않는다
 *   호출 모양에 kinds(원본 종류 → IM 객체 종류)가 있으면 대상은 그 종류 안에서만 찾는다. 같은 값을 다른 종류가 id 로 가질 때다
 * - 사전에 없는 종류는 기록을 만들지 않고 건수만 센다. 칸 위치(records)를 아직 적지 않은 호출은 건너뛰고 건수만 센다
 *
 * 경로 문법(명세 「칸 위치의 경로 문법」): a.b 내려가기, a[] 펼치기, =값 상수, $parent. 바깥 레코드, $env. 원본 봉투, param:이름, . 원소 자신
 */
import crypto from 'node:crypto'
import { ACTIVITY_CALLS, ACTIVITY_TYPES, ACTIVITY_VOCABULARY, ONTOLOGY_SOURCE, type ActivityCallShape, type ActivityTypeRow } from '../../../src/ontology/generated'
import { EntityResolver } from '../../stream/splunk/resolver'
import type { EventProvider, MatchedOn, Unmatched } from '../../stream/splunk/types'
import type { Envelope } from '../lib/store'
import { itemsOf, type RawSet } from './raw'
import { to18 } from './sfid'

export const ACTIVITY_MAPPING_VERSION = `activity-map/1@${ONTOLOGY_SOURCE.commit.slice(0, 7)}`

export interface ActivityRef {
  /** 그래프 객체 키. 못 찾으면 null */
  ref: string | null
  unmatched?: Unmatched
  matched_on?: MatchedOn
  /** 원본에 적힌 식별자 하나. 표시 이름은 싣지 않는다 */
  native: { id: string; type: string | null; field: string }
}

export interface ActivityEffect {
  kind: string
  relation_type?: string
  /** 사전의 자리: actor | targets[slot]. 원본에 없는 끝은 사전이 비워 둔다. role 은 3항 관계의 역할 */
  slots?: { from?: string; to?: string; role?: string; at?: string }
  interface?: string
  /** 그 자리에서 찾은 객체 키. 끝을 다 찾지 못하면 없다 */
  refs?: { from?: string; to?: string; role?: string; at?: string }
}

export interface Activity {
  id: string
  provider: string
  event_type: string
  occurred_at: string | null
  source: { call: string; record_ref: string; mapping_version: string }
  job: { id: string | null; step: string | null } | null
  session: { id: string | null; root_id: string | null; auth_method: string | null } | null
  /** directory_ref: 이 SaaS 계정도 찾았고, 사전 actor.directory 의 같은 디렉터리 계정도 있을 때 그 키(같은 신원의 다른 객체. 판정이 둘 다 본다) */
  actor: (ActivityRef & { kind: string | null; directory_ref?: string }) | null
  via: Array<ActivityRef & { as: string }>
  action: { verb: string }
  targets: Array<ActivityRef & { slot: string }>
  outcome: 'success' | 'failure' | 'unknown' | 'success_implied'
  outcome_reason: string | null
  deny_kind: string | null
  decision: { policy: string | null; rule: string | null; result: string | null } | null
  change: Array<{ field: string; before?: unknown; after?: unknown }>
  effects: ActivityEffect[]
  self: boolean
  signal: { kind: 'suspicious'; source: string; value: string } | null
}

export interface ActivitySummary {
  mapping_version: string
  records: number
  types: number
  /** 사전에 없는 종류: 건수 */
  unknown_types: Record<string, number>
  /** 칸 위치를 아직 적지 않은 호출: 원본 행 수 */
  calls_without_shape: Record<string, number>
  by_call: Record<string, { records: number; types: number }>
  actor: { present: number; matched: number }
  targets: { total: number; matched: number; name_only: number }
  /** 두 끝(또는 at)을 다 찾은 효과 / 자리가 있는 효과 */
  effects: { with_slots: number; resolved: number }
  self: number
}

interface GraphObjectLike { fixture_key: string; canonical?: { provider?: string; object_type?: string; identifiers?: Record<string, unknown>; properties?: Record<string, unknown> } }

interface Ctx { rec: any; parent?: any; env: Envelope; params?: Map<string, unknown> }

const present = (v: unknown) => v !== undefined && v !== null && v !== ''

/** 점으로 나눈 칸 이름. 큰따옴표로 감싼 조각은 점이 들어도 한 칸이다(labels."event.name", "gen_ai.agent.name"[]) */
export function pathSegments(rest: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < rest.length) {
    if (rest[i] === '"') {
      const j = rest.indexOf('"', i + 1)
      if (j < 0) { out.push(rest.slice(i)); break }
      let seg = rest.slice(i + 1, j)
      i = j + 1
      if (rest.startsWith('[]', i)) { seg += '[]'; i += 2 }
      out.push(seg)
      if (rest[i] === '.') i++
      continue
    }
    const j = rest.indexOf('.', i)
    const k = j < 0 ? rest.length : j
    out.push(rest.slice(i, k))
    i = k + 1
  }
  return out
}

/** 경로 하나의 값들. 배열은 [] 로만 펼친다 */
export function pathValues(path: string, ctx: Ctx, base: any = ctx.rec): unknown[] {
  if (path.startsWith('=')) return [path.slice(1)]
  if (path === '.') return present(base) ? [base] : []
  if (path.startsWith('param:')) {
    const v = ctx.params?.get(path.slice('param:'.length))
    return Array.isArray(v) ? v.filter(present) : present(v) ? [v] : []
  }
  let rest = path
  let cur: any[] = [base]
  if (rest.startsWith('$parent.')) { cur = [ctx.parent]; rest = rest.slice('$parent.'.length) } else if (rest.startsWith('$env.')) { cur = [ctx.env]; rest = rest.slice('$env.'.length) }
  if (rest === '') return cur.filter(present)
  for (const seg of pathSegments(rest)) {
    const spread = seg.endsWith('[]')
    const name = spread ? seg.slice(0, -2) : seg
    let next = cur.flatMap(o => (o && typeof o === 'object' && name in o ? [o[name]] : []))
    if (spread) next = next.flatMap(v => (Array.isArray(v) ? v : []))
    cur = next.filter(v => v !== undefined && v !== null)
  }
  return cur.filter(present)
}

const first = (path: string | undefined, ctx: Ctx, base?: any): unknown => (path ? pathValues(path, ctx, base)[0] : undefined)
const str = (v: unknown): string | null => (present(v) && typeof v !== 'object' ? String(v) : null)

/** 시각을 ISO 로. 숫자(또는 숫자 글)는 1e12 보다 크면 밀리초, 아니면 초 */
export function toIso(v: unknown): string | null {
  if (!present(v)) return null
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v))) {
    const n = Number(v)
    const d = new Date(n > 1e12 ? n : n * 1000)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const s = String(v)
  let t = Date.parse(s)
  if (Number.isNaN(t)) t = Date.parse(s.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'))
  if (Number.isNaN(t)) t = Date.parse(s.replace(' ', 'T') + 'Z')
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** 사전에서 이 호출, 이 관측 종류를 만드는 종류의 event_type 집합 (observations.ts 가 쓴다) */
export function observedActivityTypes(call: string, observation: string): Set<string> {
  const out = new Set<string>()
  for (const [key, row] of Object.entries(ACTIVITY_TYPES)) {
    if (row.observation === observation && row.calls.includes(call)) out.add(key.slice(key.indexOf('|') + 1))
  }
  return out
}

/** 같은 모양(same_as)의 호출은 한 모양과 한 중복 거르기 집합을 쓴다 */
function shapeOf(call: string): { name: string; shape: ActivityCallShape } {
  const s = ACTIVITY_CALLS[call]
  if (s?.same_as) return { name: s.same_as, shape: ACTIVITY_CALLS[s.same_as] }
  return { name: call, shape: s }
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20)

/** 대상 칸 normalize: 원본 값을 그래프 식별자 꼴로 (Profile identity normalization 과 같은 이름). 모르는 이름은 그대로 둔다 */
const NORMALIZERS: Record<string, (v: string) => string> = { to_18_char: to18, lowercase: v => v.toLowerCase(), trim: v => v.trim() }
const normalized = (v: string, names: readonly string[] | undefined) => (names ?? []).reduce((x, n) => NORMALIZERS[n]?.(x) ?? x, v)

export function buildActivities(raw: RawSet, objects: GraphObjectLike[], opts: { selfClientIds?: string[] } = {}): { records: Activity[]; summary: ActivitySummary } {
  const resolver = new EntityResolver(objects, [], { selfClientIds: opts.selfClientIds ?? [] })
  const self = new Set(opts.selfClientIds ?? [])
  const outcomes = new Set(ACTIVITY_VOCABULARY.outcomes)
  const records: Activity[] = []
  const summary: ActivitySummary = {
    mapping_version: ACTIVITY_MAPPING_VERSION, records: 0, types: 0, unknown_types: {}, calls_without_shape: {}, by_call: {},
    actor: { present: 0, matched: 0 }, targets: { total: 0, matched: 0, name_only: 0 }, effects: { with_slots: 0, resolved: 0 }, self: 0,
  }
  const seenBy = new Map<string, Set<string>>()
  const typesSeen = new Set<string>()

  // 복합 primary(GWS Token 의 사용자|클라이언트 같은 것). 종류를 모르는 색인이라 같은 값이 둘이면 모호로 둔다
  const composite = new Map<string, { key: string; identifier: string } | null>()
  for (const o of objects) {
    const ids = o.canonical?.identifiers ?? {}
    const primary = ids.primary
    if (!Array.isArray(primary) || primary.length < 2 || !o.canonical?.provider) continue
    const vals = primary.map(f => (ids[f as string] as { value?: unknown } | undefined)?.value)
    if (!vals.every(v => present(v) && typeof v !== 'object')) continue
    const k = `${o.canonical.provider}|${vals.join('|')}`
    composite.set(k, composite.has(k) && composite.get(k)?.key !== o.fixture_key ? null : { key: o.fixture_key, identifier: primary.join('|') })
  }
  // kinds: 사전 호출 모양의 kinds(원본 종류 → IM 객체 종류). 있으면 그 종류 안에서만 찾는다(같은 값을 id 로 가진 다른 종류로 붙지 않게)
  const lookup = (provider: string, candidates: Array<readonly [string, unknown]>, nameOnly = false, kinds?: readonly string[]): Pick<ActivityRef, 'ref' | 'unmatched' | 'matched_on'> => {
    if (!resolver.hasObjects) return { ref: null }
    if (nameOnly) return { ref: null, unmatched: 'name_only' }
    for (const [f, v] of candidates) {
      if (!f.startsWith('join(')) continue
      const hit = composite.get(`${provider}|${v}`)
      if (hit) return { ref: hit.key, matched_on: { event_field: f, identifier: hit.identifier, same: 'exact' } }
      if (hit === null) return { ref: null, unmatched: 'ambiguous' }
    }
    // 복합 primary 에 없으면 이은 값도 보통 식별자로 찾는다(원본이 id 를 조각으로 나눠 적은 것: 라벨 여럿을 이은 자원 이름)
    const plain = candidates
    const res = kinds?.length ? resolver.lookupOfTypes(provider as EventProvider, plain, kinds) : resolver.lookup(provider as EventProvider, plain)
    if (!res && candidates.some(([f]) => f.startsWith('join('))) return { ref: null, unmatched: 'not_in_graph' }
    if (!res) return { ref: null }
    if ('key' in res) return { ref: res.key, matched_on: res.matched_on }
    return { ref: null, unmatched: res.miss }
  }
  // 사전 id_alias: 원본이 같은 객체를 그래프와 다른 식별자로 적어 경로 앞부분이 다를 때(프로젝트 id 꼴 ↔ 번호 꼴), 맞은 부분을
  // 사전이 적은 종류 객체의 두 식별자(from 값 → to 값)로 바꿔 찾는다. 바꿀 값이 없거나 두 객체가 같은 from 을 가지면 그대로 둔다. 호출마다 표를 한 번 만든다
  const aliasTables = new Map<string, Array<{ rx: RegExp; map: Map<string, string | null> }>>()
  const aliased = (call: string, provider: string, shape: ActivityCallShape, cands: Array<readonly [string, unknown]>): Array<readonly [string, unknown]> => {
    if (!shape.id_alias?.length) return cands
    let tables = aliasTables.get(call)
    if (!tables) {
      tables = shape.id_alias.map(rule => {
        const map = new Map<string, string | null>()
        for (const o of objects) {
          if (o.canonical?.provider !== provider || !rule.kinds.includes(String(o.canonical?.object_type))) continue
          const ids = o.canonical.identifiers ?? {}
          const from = (ids[rule.from] as { value?: unknown } | undefined)?.value
          const to = (ids[rule.to] as { value?: unknown } | undefined)?.value
          if (!present(from) || !present(to) || typeof from === 'object' || typeof to === 'object') continue
          const k = String(from)
          map.set(k, map.has(k) && map.get(k) !== String(to) ? null : String(to))
        }
        return { rx: new RegExp(rule.match), map }
      })
      aliasTables.set(call, tables)
    }
    return cands.map(([f, v]) => {
      if (typeof v !== 'string') return [f, v] as const
      for (const t of tables!) {
        const m = t.rx.exec(v)
        const to = m && m[1] !== undefined ? t.map.get(m[1]) : undefined
        if (m && to) return [f, v.slice(0, m.index) + to + v.slice(m.index + m[0].length)] as const
      }
      return [f, v] as const
    })
  }
  const candidatesOf = (paths: readonly string[], ctx: Ctx, base?: any, join?: { paths: readonly string[]; sep: string }): Array<readonly [string, unknown]> => {
    const out: Array<readonly [string, unknown]> = []
    if (join) {
      const parts = join.paths.map(p => str(first(p, ctx, base)))
      if (parts.every(v => v !== null)) out.push([`join(${join.paths.join(',')})`, parts.join(join.sep)])
    }
    for (const p of paths) for (const v of pathValues(p, ctx, base)) if (typeof v !== 'object') out.push([p, v])
    return out
  }

  for (const call of Object.keys(ACTIVITY_CALLS)) {
    const { name, shape } = shapeOf(call)
    const declared = ACTIVITY_CALLS[call]
    const provider = shape?.provider ?? declared?.provider
    if (!provider) continue
    // 원본 봉투의 provider 칸: Atlassian 셋은 atlassian, 봇 요청 로그 같은 Worker 기록은 worker 다
    const envs = [...raw.pages(provider as any, call), ...(provider !== 'worker' ? raw.pages('worker' as any, call) : [])]
    if (!envs.length) continue
    if (!shape || shape.records === undefined) {
      summary.calls_without_shape[call] = envs.reduce((n, env) => n + itemsOf(env).length + Object.values((env.payload as any) ?? {}).filter(Array.isArray).reduce((m: number, a: any) => m + a.length, 0), 0)
      continue
    }
    const seen = seenBy.get(name) ?? new Set<string>()
    seenBy.set(name, seen)
    const stat = summary.by_call[call] ?? { records: 0, types: 0 }
    summary.by_call[call] = stat
    const callTypes = new Set<string>()
    for (const env of envs) {
      const rows = shape.records === '' ? itemsOf(env) : itemsOf(env, shape.records)
      rows.forEach((rec, recIndex) => {
        const keyVals = (shape.key ?? []).map(k => str(first(k, { rec, env })) ?? '')
        const dedupe = keyVals.join('\u0001')
        if (keyVals.some(Boolean)) {
          if (seen.has(dedupe)) return
          seen.add(dedupe)
        }
        const children = shape.children ? pathValues(shape.children, { rec, env }) : [rec]
        children.forEach((child, childIndex) => {
          const ctx: Ctx = shape.children ? { rec: child, parent: rec, env } : { rec, env }
          if (shape.params) {
            const m = new Map<string, unknown>()
            for (const p of pathValues(shape.params.list, ctx) as any[]) {
              const n = str(p?.[shape.params.name])
              if (!n) continue
              const v = shape.params.value.map(f => p?.[f]).find(present)
              if (present(v)) m.set(n, v)
            }
            ctx.params = m
          }
          const et = typeof shape.event_type === 'string' ? str(first(shape.event_type, ctx)) : shape.event_type
            ? shape.event_type.join.map(p => str(first(p, ctx)) ?? '').join(shape.event_type.sep) : null
          if (!et) return
          const key = `${provider}|${et}`
          const row: ActivityTypeRow | undefined = ACTIVITY_TYPES[key]
          if (!row || !row.calls.some(c => shapeOf(c).name === name)) {
            summary.unknown_types[key] = (summary.unknown_types[key] ?? 0) + 1
            return
          }
          records.push(buildOne(call, provider, et, row, shape, ctx, env, keyVals.some(Boolean) ? dedupe : `${env.payload_sha256 || env.page}#${recIndex}`, childIndex, shape.children !== undefined))
          typesSeen.add(key)
          callTypes.add(key)
          stat.records++
        })
      })
    }
    stat.types = callTypes.size
  }

  function buildOne(call: string, provider: string, et: string, row: ActivityTypeRow, shape: ActivityCallShape, ctx: Ctx, env: Envelope, recKey: string, childIndex: number, hasChildren: boolean): Activity {
    // 행위자
    let actor: Activity['actor'] = null
    if (shape.actor) {
      const cands = candidatesOf(shape.actor.id, ctx)
      if (cands.length) {
        let kind: string | null = null
        for (const rule of shape.actor.kind ?? []) {
          if (rule.path === undefined) { kind = rule.kind ?? null; break }
          const v = str(first(rule.path, ctx))
          if (v === null) continue
          if (rule.map) { if (rule.map[v] !== undefined) { kind = rule.map[v]; break } continue }
          if (rule.regex && new RegExp(rule.regex).test(v)) { kind = rule.kind ?? null; break }
        }
        // 행위자도 대상처럼 사전 kinds(원본 종류 → 객체 종류)가 있으면 그 종류 안에서만 찾는다(같은 메일을 id 로 가진 배정 객체에 붙지 않게)
        const actorType = str(first(shape.actor.type, ctx))
        let found = lookup(provider, cands, false, actorType !== null ? shape.kinds?.[actorType] : undefined)
        // 같은 디렉터리: 원본이 적은 행위자가 다른 provider 의 신원 원장 계정 그 자체일 때(사전 actor.directory). 추정 연결이 아니라 같은 식별자다.
        // 이 SaaS 에 그 계정 객체가 없을 때만, 사전이 적은 provider 의 그 종류 안에서만 찾는다(다른 SaaS 계정으로 넓히지 않는다)
        const dir = shape.actor.directory
        let directoryRef: string | undefined
        if (dir) {
          const other = lookup(dir.provider, cands, false, dir.kinds)
          // 이 SaaS 계정 객체(권한을 직접 받은 주체)도 있으면 그것이 행위자이고, 디렉터리 계정은 같은 신원으로 곁에 적는다.
          // 같은 계정이 그룹 · 도메인으로 받은 권한은 디렉터리 계정 쪽에서만 닿기 때문이다(판정 usage.ts 가 둘 다 본다)
          if (!found.ref && other.ref) found = other
          else if (found.ref && other.ref && other.ref !== found.ref) directoryRef = other.ref
        }
        actor = { ...found, native: { id: String(cands[0][1]), type: actorType, field: cands[0][0] }, kind, ...(directoryRef ? { directory_ref: directoryRef } : {}) }
      }
    }
    // 경유
    const via: Activity['via'] = []
    for (const v of shape.via ?? []) {
      if (v.when && !present(first(v.when, ctx))) continue
      const cands = candidatesOf(v.id, ctx, undefined, v.join)
      if (!cands.length) continue
      via.push({ ...lookup(provider, cands), native: { id: String(cands[0][1]), type: null, field: cands[0][0] }, as: v.as })
    }
    // 대상
    const targets: Activity['targets'] = []
    const seenT = new Set<string>()
    const slotOf = (type: string | null, fixed?: string) => fixed ?? (type !== null ? row.slots?.[type] ?? shape.slots?.[type] : undefined) ?? 'target'
    const pushTarget = (cands: Array<readonly [string, unknown]>, type: string | null, slot: string, nameOnly = false) => {
      if (!cands.length) return
      const plain = cands.find(([f]) => !f.startsWith('join(')) ?? cands[0]
      const id = String(plain[1])
      if (seenT.has(`${slot}|${id}`)) return
      seenT.add(`${slot}|${id}`)
      targets.push({ ...lookup(provider, aliased(call, provider, shape, cands), nameOnly, type !== null ? shape.kinds?.[type] : undefined), native: { id, type, field: plain[0] }, slot })
    }
    for (const spec of shape.targets ?? []) {
      if (spec.params) {
        for (const p of spec.params) for (const v of pathValues(`param:${p}`, ctx)) if (typeof v !== 'object') pushTarget([[`param:${p}`, v]], p, slotOf(p))
        continue
      }
      const elements = spec.each ? pathValues(spec.each, ctx) : [ctx.rec]
      for (const el of elements) {
        const type = spec.type ? str(first(spec.type, ctx, el)) : null
        const cands = candidatesOf(spec.id ?? [], ctx, el, spec.join)
        if (spec.regex) {
          const rx = new RegExp(spec.regex, 'g')
          for (const [f, v] of cands) for (const m of String(v).matchAll(rx)) pushTarget([[f, normalized(m[1] ?? m[0], spec.normalize)]], type, slotOf(type, spec.slot))
          continue
        }
        // slot_by: 원소의 칸 값으로 자리를 고른다(Okta 매핑의 옮기기 전 정책 detailEntry.previousPolicy=true → source)
        const by = spec.slot_by ? spec.slot_by.map[str(first(spec.slot_by.path, ctx, el)) ?? ''] : undefined
        pushTarget(spec.normalize ? cands.map(([f, v]) => [f, normalized(String(v), spec.normalize)] as typeof cands[number]) : cands, type, by ?? slotOf(type, spec.slot), spec.name_only === true)
      }
    }
    // 결과
    let outcome: Activity['outcome'] = 'unknown'
    if (row.outcome && outcomes.has(row.outcome)) outcome = row.outcome as Activity['outcome']
    else if (shape.outcome) {
      const v = str(first(shape.outcome.path, ctx))
      const mapped = v === null ? undefined : shape.outcome.map ? shape.outcome.map[v] : outcomes.has(v) ? v : undefined
      outcome = (mapped ?? shape.outcome.default ?? 'unknown') as Activity['outcome']
    }
    const pick = <K extends string>(spec: Partial<Record<K, string>> | undefined, keys: K[]) => {
      if (!spec) return null
      const o = Object.fromEntries(keys.map(k => [k, str(first(spec[k], ctx))])) as Record<K, string | null>
      return Object.values(o).some(v => v !== null) ? o : null
    }
    // 전후
    const change: Activity['change'] = []
    for (const c of shape.change ?? []) {
      if (c.names) {
        for (const v of pathValues(c.names, ctx)) for (const f of String(v).split(c.sep ?? ',').map(s => s.trim()).filter(Boolean)) change.push({ field: f })
        continue
      }
      for (const el of c.each ? pathValues(c.each, ctx) : [ctx.rec]) {
        const field = str(first(c.field, ctx, el))
        const before = first(c.before, ctx, el)
        const after = first(c.after, ctx, el)
        if (field && (before !== undefined || after !== undefined)) change.push({ field, ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) })
      }
    }
    // 효과: exercised 는 실패면 denied
    const endRef = (end?: string): string | undefined => {
      if (!end) return undefined
      if (end === 'actor') return actor?.ref ?? undefined
      const m = /^targets\[(\w+)\]$/.exec(end)
      return m ? targets.find(t => t.slot === m[1] && t.ref)?.ref ?? undefined : undefined
    }
    const effects: ActivityEffect[] = row.effects.map(e => {
      const kind = e.kind === 'exercised' && outcome === 'failure' ? 'denied' : e.kind
      const slots = { ...(e.from ? { from: e.from } : {}), ...(e.to ? { to: e.to } : {}), ...(e.role ? { role: e.role } : {}), ...(e.at ? { at: e.at } : {}) }
      const out: ActivityEffect = { kind, ...(e.relation_type ? { relation_type: e.relation_type } : {}), ...(Object.keys(slots).length ? { slots } : {}), ...(e.interface ? { interface: e.interface } : {}) }
      if (Object.keys(slots).length) {
        summary.effects.with_slots++
        const refs = { from: endRef(e.from), to: endRef(e.to), role: endRef(e.role), at: endRef(e.at) }
        const ok = (e.from ? refs.from : true) && (e.to ? refs.to : true) && (e.role ? refs.role : true) && (e.at ? refs.at : true)
        if (ok) {
          out.refs = Object.fromEntries(Object.entries(refs).filter(([, v]) => v)) as ActivityEffect['refs']
          summary.effects.resolved++
        }
      }
      return out
    })
    const decision = row.decision && shape.decision
      ? { policy: (targets.find(t => t.slot === 'policy')?.ref ?? targets.find(t => t.slot === 'policy')?.native.id) ?? null, rule: str(first(shape.decision.rule, ctx)),
          result: (() => { const v = str(first(shape.decision!.result?.path, ctx)); return v !== null ? shape.decision!.result?.map[v] ?? null : null })() }
      : null
    const isSelf = [actor?.native.id, ...via.map(v => v.native.id), ...targets.map(t => t.native.id)].some(id => id !== undefined && self.has(id))
    // 기록 수 세기
    if (actor) { summary.actor.present++; if (actor.ref) summary.actor.matched++ }
    for (const t of targets) { summary.targets.total++; if (t.ref) summary.targets.matched++; if (t.unmatched === 'name_only') summary.targets.name_only++ }
    if (isSelf) summary.self++
    return {
      id: `ACT-${call}-${sha(`${call}\u0001${recKey}`)}${hasChildren ? `-${childIndex}` : ''}`,
      provider, event_type: et, occurred_at: toIso(first(shape.occurred_at, ctx)),
      source: { call, record_ref: `${env.provider}:${env.call_id}#${env.payload_sha256 || env.page}`, mapping_version: ACTIVITY_MAPPING_VERSION },
      job: pick(shape.job, ['id', 'step']) as Activity['job'],
      session: pick(shape.session, ['id', 'root_id', 'auth_method']) as Activity['session'],
      actor, via, action: { verb: row.verb }, targets,
      outcome, outcome_reason: str(first(shape.outcome_reason, ctx)),
      deny_kind: outcome === 'failure' ? row.deny_kind ?? null : null,
      decision, change, effects, self: isSelf,
      signal: row.signal ? { kind: 'suspicious', source: 'event_type', value: et } : null,
    }
  }

  summary.records = records.length
  summary.types = typesSeen.size
  return { records: records.sort((a, b) => (a.occurred_at ?? '').localeCompare(b.occurred_at ?? '') || a.id.localeCompare(b.id)), summary }
}
