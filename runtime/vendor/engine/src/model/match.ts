/**
 * 조건식 — aegi-knowledge schema/ontology/match.py 를 옮겼다. crosswalk.yaml 의 skip_if · where · places · when 을 기계가 읽는다.
 *
 * 식
 *   {all: [식, ...]} · {any: [식, ...]} · {not: 식}
 *   {exists_relation: {type, source, target, role, target_interface, property}}  이런 관계 행이 있다. 값의 $자리 는 그 자리 객체의 키.
 *     role 은 관계 행의 역할 키(역할 객체 키, 이름만 있는 역할은 name:이름)가 그 자리 키와 같다
 *   {자리: {검사: 값, ...}}  그 자리 객체에 검사가 전부 맞는다 (자리가 없으면 거짓, 목록이면 하나라도)
 * 검사  provider · object_type · interface · property · judged_or_property · meta · in_table · table_property · refs_missing
 * 값    그대로면 같은지, 목록이면 그중 하나인지, present 있음, missing 없음, {not: 값} 반대
 *
 * 모양 검사(errors)는 aegi-knowledge 검사(S8 · S9)가 한다. 여기서는 대 보기만 한다.
 */

/** 식이 보는 객체 모양. 비어 있는 칸은 없다고 본다 */
export interface MatchObject {
  k: string
  p: string
  t: string
  /** interfaces */
  i?: string[]
  props?: Record<string, unknown>
  ids?: Record<string, unknown>
  judged?: Record<string, unknown>
  profile?: Record<string, unknown>
  meta?: Record<string, unknown>
  /** 참조 이름 → 가리키는 객체 키 */
  refs?: Record<string, string[]>
}

/** 관계 행 (rt 관계 이름, s 출발, d 도착) */
export interface MatchRelation {
  rt: string
  s: string
  d: string
  /** 역할 키 — 역할 객체 키, 이름만 있는 역할(references.role kind name_key)은 name:이름. exists_relation.role 이 본다 */
  role?: string
  props?: Record<string, unknown>
}

export type Expr = Record<string, any>
type Place = MatchObject | MatchObject[] | null | undefined

export const CHECKS = ['provider', 'object_type', 'interface', 'in_table', 'property', 'judged_or_property', 'meta', 'table_property', 'refs_missing'] as const

export class MatchCtx {
  /** in_table 로 맞은 표 행 */
  row: Record<string, any> | null = null
  constructor(
    readonly places: Record<string, Place>,
    readonly relations: readonly MatchRelation[] = [],
    readonly tables: Record<string, Array<Record<string, any>>> = {},
    readonly objects: Record<string, MatchObject> = {},
  ) {}
  place(name: string): Place {
    return this.places[name]
  }
}

const lower = (s: unknown) => (typeof s === 'string' ? s.toLowerCase() : s)
const scalar = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as object) ? (v as { value: unknown }).value : v)
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

export function valueOk(actual: unknown, want: unknown): boolean {
  if (want && typeof want === 'object' && !Array.isArray(want) && Object.keys(want).length === 1 && has(want, 'not')) return !valueOk(actual, (want as { not: unknown }).not)
  if (Array.isArray(want)) return want.some(w => valueOk(actual, w))
  if (want === 'present') return actual !== undefined && actual !== null
  if (want === 'missing') return actual === undefined || actual === null
  // match.py 는 없는 칸을 None 으로 읽는다 — 없는 값과 null 을 같게 본다
  return (actual === undefined ? null : actual) === want
}

function check(obj: MatchObject, name: string, want: any, ctx: MatchCtx): boolean {
  const props = obj.props ?? {}
  switch (name) {
    case 'provider':
      return valueOk(obj.p, want)
    case 'object_type':
      return valueOk(lower(obj.t), Array.isArray(want) ? want.map(lower) : lower(want))
    case 'interface':
      return (Array.isArray(want) ? want : [want]).some(i => (obj.i ?? []).includes(i))
    case 'property':
      return Object.entries(want).every(([n, w]) => valueOk(props[n], w))
    case 'judged_or_property': {
      const judged = obj.judged ?? {}
      const profile = obj.profile ?? {}
      return Object.entries(want).every(([n, w]) => valueOk(scalar(has(props, n) ? props[n] : has(judged, n) ? judged[n] : profile[n]), w))
    }
    case 'meta':
      return Object.entries(want).every(([n, w]) => valueOk((obj.meta ?? {})[n], w))
    case 'in_table':
      for (const row of ctx.tables[want] ?? []) {
        if (row.provider === obj.p && lower(row.objectType) === lower(obj.t)) {
          ctx.row = row
          return true
        }
      }
      return false
    case 'table_property':
      return !!ctx.row && 'property' in ctx.row && valueOk(props[ctx.row.property], want)
    case 'refs_missing':
      return !(obj.refs ?? {})[want]?.length
    default:
      throw new Error(`모르는 검사 ${name}`)
  }
}

export function holds(expr: Expr, ctx: MatchCtx): boolean {
  for (const [key, val] of Object.entries(expr)) {
    let ok: boolean
    if (key === 'all') ok = (val as Expr[]).every(e => holds(e, ctx))
    else if (key === 'any') ok = (val as Expr[]).some(e => holds(e, ctx))
    else if (key === 'not') ok = !holds(val, ctx)
    else if (key === 'exists_relation') ok = exists(val, ctx)
    else {
      const place = ctx.place(key)
      if (!place) return false
      const objs = Array.isArray(place) ? place : [place]
      // in_table 이 table_property 보다 먼저 돌도록 CHECKS 순서로 본다
      ok = objs.some(o => CHECKS.filter(c => c in val).every(c => check(o, c, val[c], ctx)))
    }
    if (!ok) return false
  }
  return true
}

function keyOf(ctx: MatchCtx, ref: unknown): unknown {
  if (typeof ref === 'string' && ref.startsWith('$')) {
    const place = ctx.place(ref.slice(1))
    if (Array.isArray(place)) return place.map(o => o.k)
    return place ? place.k : null
  }
  return ref
}

/** 관계 행의 역할 키(MatchRelation.role). 역할 객체가 있으면 그 키, 이름만 있으면 name:이름 */
export function roleMatchKey(rel: { roleKey?: string; roleName?: string }): string | undefined {
  return rel.roleKey ?? (rel.roleName ? `name:${rel.roleName}` : undefined)
}

const isKey = (value: unknown, key: unknown) => (Array.isArray(key) ? key.includes(value) : value === key)

/** 관계 행을 종류별로 묶어 둔다(같은 목록이면 한 번만, 길이가 바뀌면 다시). exists_relation 이 목록 전부를 훑지 않게 한다 */
const byTypeCache = new WeakMap<readonly MatchRelation[], { n: number; m: Map<string, MatchRelation[]> }>()
function relationsOfType(all: readonly MatchRelation[], type: string): MatchRelation[] {
  let c = byTypeCache.get(all)
  if (!c || c.n !== all.length) {
    const m = new Map<string, MatchRelation[]>()
    for (const r of all) {
      const l = m.get(r.rt)
      if (l) l.push(r)
      else m.set(r.rt, [r])
    }
    c = { n: all.length, m }
    byTypeCache.set(all, c)
  }
  return c.m.get(type) ?? []
}

function exists(spec: Expr, ctx: MatchCtx): boolean {
  const src = 'source' in spec ? keyOf(ctx, spec.source) : null
  const tgt = 'target' in spec ? keyOf(ctx, spec.target) : null
  const wantProps = Object.fromEntries(Object.entries(spec.property ?? {}).map(([n, w]) => [n, keyOf(ctx, w)]))
  return relationsOfType(ctx.relations, spec.type).some(r => {
    if ('source' in spec && !isKey(r.s, src)) return false
    if ('target' in spec && !isKey(r.d, tgt)) return false
    if ('role' in spec && !isKey(r.role, keyOf(ctx, spec.role))) return false
    if ('target_interface' in spec && !(ctx.objects[r.d]?.i ?? []).includes(spec.target_interface)) return false
    return Object.entries(wantProps).every(([n, w]) => valueOk((r.props ?? {})[n], w))
  })
}

/** 끝 찾기 — relation_semantics.yaml resolvers 한 줄(refs · relations · depth · want · take)대로 start 에서 끝을 찾는다 */
export function resolve(spec: Expr, start: string, objects: Record<string, MatchObject>, relationsFrom: Map<string, MatchRelation[]>): string[] {
  const want = spec.want ?? 'any'
  const take = spec.take ?? 'all'
  const depth = spec.depth ?? 1
  const found: string[] = []
  const seen = new Set<string>()
  let frontier = [start]
  for (let step = 0; step < depth; step++) {
    const next: string[] = []
    for (const k of frontier) {
      if (seen.has(k) || !objects[k]) continue
      seen.add(k)
      const cands = [
        ...((spec.refs ?? []) as string[]).flatMap(name => objects[k].refs?.[name] ?? []),
        ...(relationsFrom.get(k) ?? []).filter(r => ((spec.relations ?? []) as string[]).includes(r.rt)).map(r => r.d),
      ]
      for (const t of cands) {
        if (!objects[t]) continue
        if (want === 'any' || (objects[t].i ?? []).includes(want)) {
          if (take === 'first') return [t]
          if (!found.includes(t)) found.push(t)
        } else next.push(t)
      }
    }
    frontier = next
  }
  return found
}
