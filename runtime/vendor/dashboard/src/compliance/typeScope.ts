import type { GraphStoreV2 } from '../model/graph'
import type { FixtureObject } from '../model/object'
import rawJevExcluded from './jevExcluded.snapshot.json'
import rawSnapshot from './typeScope.snapshot.json'

export interface TypeScopeItem {
  key: string
  framework: string
  id: string
  location: string
  title: string
  summary: string
  companyInput: string[]
  ismspLinks: string[]
  pairs: [number, number, number[], number][]
  /** 항목 등급(knowledge item-tiers.jsonl): auto 자동 판정, evidence 근거 제공, exclude 제외 */
  tier?: ItemTier
  tierReason?: string
}

export type ItemTier = 'auto' | 'evidence' | 'exclude'

export interface TypeScopeSnapshot {
  version: string
  source: { repo: string; commit: string; path: string }
  status: string
  note: string
  tags: { tag: string; name: string }[]
  types: string[]
  /** 값 → 태그 표. 키는 소문자 종류 키, field 는 canonical.properties 아래 점 경로, map 은 값 → 태그 번호 */
  values?: Record<string, { field: string; map: Record<string, number[]> }>
  items: TypeScopeItem[]
}

export interface ScopeGroup {
  typeKey: string
  provider: string
  objectType: string
  unit: 'object' | 'type'
  tags: string[] /* 태그 우리말 이름 */
  objects: FixtureObject[]
  /** 값 → 태그 표로 좁혔을 때: 좁힌 필드와 좁히기 전 객체 수 */
  narrowed?: { field: string; total: number }
  /** 값 → 태그 표에 없는 값이라 좁히지 못한 객체 묶음 */
  unknownValues?: boolean
}
export interface ScopeTargets {
  item?: { key: string; title: string; summary: string }
  mappedTypes: number
  groups: ScopeGroup[]
  objectCount: number
  reviewTypes: number
  review: ScopeGroup[]
  reviewObjectCount: number
}

const defaultSnapshot = rawSnapshot as unknown as TypeScopeSnapshot
const defaultExcludedByItem = new Map<string, Set<string>>(
  Object.entries((rawJevExcluded as { byItem: Record<string, string[]> }).byItem).map(([k, list]) => [k, new Set(list.map(t => t.toLowerCase()))]),
)
const graphIndexCache = new WeakMap<GraphStoreV2, Map<string, FixtureObject[]>>()
const itemIndexCache = new WeakMap<TypeScopeSnapshot, Map<string, TypeScopeItem>>()

function indexGraphByType(graph: GraphStoreV2): Map<string, FixtureObject[]> {
  let index = graphIndexCache.get(graph)
  if (index) return index
  index = new Map<string, FixtureObject[]>()
  for (const obj of graph.objectsByKey.values()) {
    const key = `${obj.canonical.provider}:${obj.canonical.object_type}`.toLowerCase()
    const list = index.get(key)
    if (list) list.push(obj)
    else index.set(key, [obj])
  }
  graphIndexCache.set(graph, index)
  return index
}

function valueAt(props: unknown, field: string): unknown {
  let v: unknown = props
  for (const k of field.split('.')) {
    if (!v || typeof v !== 'object') return undefined
    v = (v as Record<string, unknown>)[k]
  }
  return v
}

// 값 → 태그 표가 있는 종류의 객체를 쌍의 태그(via)와 겹치는 값만 남긴다. 표에 없는 값은 좁히지 않고 따로 돌려준다.
function narrowByValue(objects: FixtureObject[], table: { field: string; map: Record<string, number[]> }, via: number[]) {
  const matched: FixtureObject[] = []
  const unknown: FixtureObject[] = []
  for (const obj of objects) {
    const value = valueAt(obj.canonical.properties, table.field)
    const tags = typeof value === 'string' && Object.prototype.hasOwnProperty.call(table.map, value) ? table.map[value] : undefined
    if (!tags) unknown.push(obj)
    else if (tags.some(t => via.includes(t))) matched.push(obj)
  }
  return { matched, unknown }
}

function indexItems(data: TypeScopeSnapshot): Map<string, TypeScopeItem> {
  let map = itemIndexCache.get(data)
  if (map) return map
  map = new Map(data.items.map(item => [item.key, item]))
  itemIndexCache.set(data, map)
  return map
}

export function hasTypeScope(itemKey: string, data: TypeScopeSnapshot = defaultSnapshot): boolean {
  const item = indexItems(data).get(itemKey)
  return Boolean(item && item.pairs.length > 0)
}

/** 관련 점검(Config Finding) 타겟 키(`im:<provider>:<object_type>:<id>`)에서 객체 종류 목록을 추출한다. */
export function findingTargetTypes(matches: readonly { item: { targets?: readonly { key: string }[] } }[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of matches) {
    for (const t of m.item.targets ?? []) {
      const parts = t.key.split(':')
      if (parts.length < 3 || !parts[1] || !parts[2]) continue
      const typeKey = `${parts[1]}:${parts[2]}`
      const lower = typeKey.toLowerCase()
      if (seen.has(lower)) continue
      seen.add(lower)
      out.push(typeKey)
    }
  }
  return out
}

export function scopeTargets(
  graph: GraphStoreV2,
  itemKey: string,
  data: TypeScopeSnapshot = defaultSnapshot,
  _extraTypes?: Iterable<string>,
  excludedByItem?: ReadonlyMap<string, ReadonlySet<string>>,
): ScopeTargets {
  const item = indexItems(data).get(itemKey)
  const byType = indexGraphByType(graph)
  const groups: ScopeGroup[] = []
  const review: ScopeGroup[] = []
  const excludedSet = excludedByItem?.get(itemKey) ?? (data === defaultSnapshot ? defaultExcludedByItem.get(itemKey) : undefined)
  let mappedTypes = 0
  let reviewTypes = 0
  for (const [typeIdx, unitCode, tagIndices, reviewCode] of item?.pairs ?? []) {
    const typeKey = data.types[typeIdx]
    if (!typeKey) continue
    if (excludedSet?.has(typeKey.toLowerCase())) continue
    const isReview = reviewCode === 1
    if (isReview) reviewTypes++
    else mappedTypes++
    const objects = byType.get(typeKey.toLowerCase())
    if (!objects?.length) continue
    const colon = typeKey.indexOf(':')
    const provider = colon >= 0 ? typeKey.slice(0, colon) : typeKey
    const objectType = colon >= 0 ? typeKey.slice(colon + 1) : ''
    const unit: 'object' | 'type' = unitCode === 1 ? 'type' : 'object'
    const tags = tagIndices.map(i => data.tags[i]?.name ?? '').filter(Boolean)
    const table = unit === 'object' ? data.values?.[typeKey.toLowerCase()] : undefined
    if (!table) {
      const entry: ScopeGroup = { typeKey, provider, objectType, unit, tags, objects }
      if (isReview) review.push(entry)
      else groups.push(entry)
      continue
    }
    const { matched, unknown } = narrowByValue(objects, table, tagIndices)
    const narrowed = { field: table.field, total: objects.length }
    if (matched.length) {
      const entry: ScopeGroup = { typeKey, provider, objectType, unit, tags, objects: matched, narrowed }
      if (isReview) review.push(entry)
      else groups.push(entry)
    }
    if (unknown.length) review.push({ typeKey, provider, objectType, unit, tags, objects: unknown, narrowed, unknownValues: true })
  }
  const sortGroup = (a: ScopeGroup, b: ScopeGroup) => b.objects.length - a.objects.length || (a.typeKey < b.typeKey ? -1 : a.typeKey > b.typeKey ? 1 : 0)
  groups.sort(sortGroup)
  review.sort(sortGroup)
  const objectCount = groups.reduce((sum, g) => sum + g.objects.length, 0)
  const reviewObjectCount = review.reduce((sum, g) => sum + g.objects.length, 0)
  return {
    ...(item ? { item: { key: item.key, title: item.title, summary: item.summary } } : {}),
    mappedTypes,
    groups,
    objectCount,
    reviewTypes,
    review,
    reviewObjectCount,
  }
}

export type UnifiedStatus = 'fail' | 'unknown' | 'person' | 'pass' | 'uninspected'

export interface UnifiedMatchLike {
  key: string
  f: { id: string; provider: string; text: string; items: { status: string }[] }
  item: {
    standard: string
    item_id: string
    status: string
    threshold?: string
    note?: string
    rule: { source: string; field: string; condition: string; combine: string }
    targets: { key: string; name: string; status: string; in_graph: boolean; value: unknown }[]
  }
  limit: string
}

export interface UnifiedObjectCheck<M extends UnifiedMatchLike = UnifiedMatchLike> {
  match: M
  targetStatus: string
  value: unknown
}

export interface UnifiedObjectTarget<M extends UnifiedMatchLike = UnifiedMatchLike> {
  key: string
  inGraph: boolean
  provider: string
  objectType: string
  name: string
  tags: string[]
  status: UnifiedStatus
  checks: UnifiedObjectCheck<M>[]
}

export interface UnifiedSaasGroup<M extends UnifiedMatchLike = UnifiedMatchLike> {
  provider: string
  counts: Record<UnifiedStatus, number>
  inspectedCount: number
  objects: UnifiedObjectTarget<M>[]
}

export interface UnifiedSaasTargets<M extends UnifiedMatchLike = UnifiedMatchLike> {
  totalObjects: number
  inspectedObjects: number
  counts: Record<UnifiedStatus, number>
  saasGroups: UnifiedSaasGroup<M>[]
  untargetedBySaas: Map<string, M[]>
  review: ScopeGroup[]
  reviewObjectCount: number
}

const UNIFIED_ORDER: Record<UnifiedStatus, number> = { fail: 0, unknown: 1, person: 2, pass: 3, uninspected: 4 }

function toUnifiedStatus(status: string): UnifiedStatus {
  if (status === 'fail' || status === 'pass' || status === 'unknown') return status
  if (status === 'manual' || status === 'org_policy') return 'person'
  return 'unknown'
}

function emptyUnifiedCounts(): Record<UnifiedStatus, number> {
  return { fail: 0, pass: 0, unknown: 0, person: 0, uninspected: 0 }
}

/**
 * TypeScope 대상 객체와 Config Finding 점검 결과를 SaaS → 개별 객체 단위로 통합한다.
 * 객체에 연결된 점검이 있으면 판정 상태를 합산하고, 없으면 uninspected(미점검)로 표시한다.
 */
export function buildUnifiedSaasTargets<M extends UnifiedMatchLike>(
  graph: GraphStoreV2,
  itemKey: string,
  matches: readonly M[],
  labelOf: (key: string) => string,
  data: TypeScopeSnapshot = defaultSnapshot,
): UnifiedSaasTargets<M> {
  const activeMatches = matches.filter(m => m.item.status !== 'not_collected')
  const scope = scopeTargets(graph, itemKey, data)
  const byObject = new Map<string, UnifiedObjectTarget<M>>()

  const upsertObject = (key: string, provider: string, objectType: string, name: string, inGraph: boolean, tags: string[]) => {
    const existing = byObject.get(key)
    if (existing) {
      for (const tag of tags) if (!existing.tags.includes(tag)) existing.tags.push(tag)
      return existing
    }
    const entry: UnifiedObjectTarget<M> = {
      key,
      inGraph,
      provider,
      objectType,
      name,
      tags: [...tags],
      status: 'uninspected',
      checks: [],
    }
    byObject.set(key, entry)
    return entry
  }

  for (const g of scope.groups) {
    for (const obj of g.objects) {
      upsertObject(obj.fixture_key, g.provider, g.objectType, labelOf(obj.fixture_key), true, g.tags)
    }
  }

  const untargetedBySaas = new Map<string, M[]>()
  for (const m of activeMatches) {
    if (!m.item.targets.length) {
      const list = untargetedBySaas.get(m.f.provider) ?? []
      list.push(m)
      untargetedBySaas.set(m.f.provider, list)
      continue
    }
    for (const t of m.item.targets) {
      if (t.status === 'not_collected') continue
      const parts = t.key.split(':')
      const provider = parts[1] || m.f.provider
      const objectType = parts[2] || ''
      const inGraph = Boolean(t.in_graph && graph.objectsByKey.has(t.key))
      const tags = byObject.has(t.key) ? [] : ['점검 연결']
      const target = upsertObject(t.key, provider, objectType, inGraph ? labelOf(t.key) : t.name, inGraph, tags)
      target.checks.push({ match: m, targetStatus: t.status, value: t.value })
    }
  }

  const totalCounts = emptyUnifiedCounts()
  const bySaas = new Map<string, UnifiedSaasGroup<M>>()
  let inspectedObjects = 0

  for (const obj of byObject.values()) {
    if (obj.checks.length > 0) {
      inspectedObjects++
      obj.checks.sort((a, b) => UNIFIED_ORDER[toUnifiedStatus(a.targetStatus)] - UNIFIED_ORDER[toUnifiedStatus(b.targetStatus)])
      obj.status = obj.checks.reduce<UnifiedStatus>((worst, ch) => {
        const s = toUnifiedStatus(ch.targetStatus)
        return UNIFIED_ORDER[s] < UNIFIED_ORDER[worst] ? s : worst
      }, 'pass')
    }
    totalCounts[obj.status]++
    let group = bySaas.get(obj.provider)
    if (!group) {
      group = { provider: obj.provider, counts: emptyUnifiedCounts(), inspectedCount: 0, objects: [] }
      bySaas.set(obj.provider, group)
    }
    group.counts[obj.status]++
    if (obj.checks.length > 0) group.inspectedCount++
    group.objects.push(obj)
  }

  const saasGroups = [...bySaas.values()].sort(
    (a, b) => b.counts.fail - a.counts.fail || b.inspectedCount - a.inspectedCount || b.objects.length - a.objects.length,
  )
  for (const g of saasGroups) {
    g.objects.sort((a, b) => UNIFIED_ORDER[a.status] - UNIFIED_ORDER[b.status] || a.name.localeCompare(b.name))
  }

  return {
    totalObjects: byObject.size,
    inspectedObjects,
    counts: totalCounts,
    saasGroups,
    untargetedBySaas,
    review: scope.review,
    reviewObjectCount: scope.reviewObjectCount,
  }
}

/**
 * 한 항목(Control)의 확인사항들에 대한 TypeScope 객체 분포를 합산한다.
 * tier === 'exclude' 인 확인사항은 제외한다.
 */
export function aggregateRequirementCounts<M extends UnifiedMatchLike = UnifiedMatchLike>(
  requirements: readonly { key: string; tier?: string }[],
  graph: GraphStoreV2,
  matchesByReq: Map<string, readonly M[]> | ((key: string) => readonly M[]),
  labelOf: (key: string) => string = key => key,
  data?: TypeScopeSnapshot,
): { counts: Record<UnifiedStatus, number>; total: number } {
  const counts = emptyUnifiedCounts()
  let total = 0
  for (const r of requirements) {
    if (r.tier === 'exclude') continue
    const ms = typeof matchesByReq === 'function' ? matchesByReq(r.key) : (matchesByReq.get(r.key) ?? [])
    const u = buildUnifiedSaasTargets(graph, r.key, ms, labelOf, data)
    for (const k of ['fail', 'pass', 'unknown', 'person', 'uninspected'] as const) {
      counts[k] += u.counts[k]
    }
    total += u.totalObjects
  }
  return { counts, total }
}

/**
 * 확인사항 묶음(그룹 또는 항목)에 대한 고유 객체(fixture_key 기준 1개) 상태 분포를 집계한다.
 * 같은 객체가 여러 확인사항에 걸리면 가장 나쁜 상태(fail > unknown > person > pass > uninspected) 하나만 센다.
 * tier === 'exclude' 인 확인사항은 제외한다.
 */
export function aggregateUniqueObjectCounts<M extends UnifiedMatchLike = UnifiedMatchLike>(
  requirements: readonly { key: string; tier?: string }[],
  graph: GraphStoreV2,
  matchesByReq: Map<string, readonly M[]> | ((key: string) => readonly M[]),
  labelOf: (key: string) => string = key => key,
  data?: TypeScopeSnapshot,
): { counts: Record<UnifiedStatus, number>; total: number } {
  const byObject = new Map<string, UnifiedStatus>()
  for (const r of requirements) {
    if (r.tier === 'exclude') continue
    const ms = typeof matchesByReq === 'function' ? matchesByReq(r.key) : (matchesByReq.get(r.key) ?? [])
    const u = buildUnifiedSaasTargets(graph, r.key, ms, labelOf, data)
    for (const group of u.saasGroups) {
      for (const obj of group.objects) {
        const prev = byObject.get(obj.key)
        if (!prev || UNIFIED_ORDER[obj.status] < UNIFIED_ORDER[prev]) {
          byObject.set(obj.key, obj.status)
        }
      }
    }
  }
  const counts = emptyUnifiedCounts()
  for (const status of byObject.values()) {
    counts[status]++
  }
  return { counts, total: byObject.size }
}
