/**
 * 관계 행 → 간선: 개념 사전 효과 표(relation_semantics.yaml relations 의 effects, conditions)를 읽는다 (관계 명세 6단계 A6).
 * 위협 판정 간선(edges.ts buildEdges 의 관계 절)이 이 표로 관계 행을 읽는다. 표는 사전 사본에서 src/ontology/generated.ts RELATION_EFFECTS 로 생성한다.
 *
 * 읽는 법 (relation_semantics.yaml 머리말)
 *   칸        관계 행 하나의 interface 칸(출발 interface>도착 interface)마다 본다. 객체가 interface 를 여럿 가지면 칸도 여럿이다
 *   갈래      그 칸을 적은 조건 갈래 가운데 위에서 처음 맞는 것의 emits. 맞는 갈래가 없으면 effects 에서 그 칸을 적은 묶음의 emits 전부
 *   from, to  source, target 은 관계 양 끝, everyone 은 누구나(@everyone), grant 는 properties.via_grant 의 객체,
 *             tenant 는 출발의 테넌트(사전 resolvers.tenant_of 로 찾는다. 못 찾으면 간선이 없다)
 *             resource_set 은 properties.resource_set 의 리소스 세트가 덮는 객체 전부(사전 providers.yaml resource_set_coverage, resourceSetCovers). 여럿이면 간선도 여럿.
 *             resource_set_unexpanded 는 그 세트에 펴지 못한 대상이 있으면 관계 도착, 다 폈으면 없음
 *   펼친 도착  칸의 narrowed 는 맞은 갈래가 resource_set · resource_set_unexpanded 끝을 적었다는 뜻이다. Effective Access 실행기의 관계 홉은 그때
 *             관계 도착 대신 그 끝들을 도착으로 쓴다(reach.ts relation 의 targets) — 위협 간선과 EA 가 같은 펴기 하나를 쓴다
 *   rank      수는 그대로. role 은 relationRoleCapability(사전 capabilities 의 role_rank_order 대로), membership 은 provider 소속 규칙(membershipRank)
 *   조건식     ontology match.py 를 옮긴 src/model/match.ts. 자리는 source, target, role, relation, via_assignment.
 *             in_table 의 표는 사전의 container_bound_automations, judged_or_property 의 profile 은 Profile 상수
 *             (오브젝트 모델 v1 묶음은 fixture_meta.model_v1.profile_constants, IM Profile 정규화 묶음은 fixture_meta.im_profile.profile_constants)
 *   override  사람이 확인한 값으로 갈래를 끈다. confirmed_resource_sets 에 든 Okta 리소스 세트면 그 갈래가 안 걸린다(엔진 overrides)
 *   계산 칸   relation 자리의 resource_set_scope 는 관계 행에 적힌 값이 아니라 여기서 계산한 값이다(resourceSetScope). 정규화 시점에 굳히지 않아
 *             규칙이 바뀌어도 원본 없이 스냅샷을 다시 판정하면 된다. 관계 행에 옛 정규화가 적은 값이 있어도 쓰지 않는다
 * 안 읽는 것: references, rules, resolvers 블록(객체 참조와 사전 표 규칙. edges.ts 가 따로 만든다). 관계 양 끝 객체가 없는 행은 칸이 없어 간선도 없다.
 */
import type { GraphStoreV2 } from '../../../model/graph'
import type { FixtureObject } from '../../../model/object'
import type { ResolvedRelation } from '../../../model/relation'
import { holds, MatchCtx, resolve, roleMatchKey, type MatchObject, type MatchRelation } from '../../../model/match'
import { RELATION_EFFECTS, RELATION_RESOLVERS, RESOURCE_SET_COVERAGE, ROLE_RANK_ORDER, type EffectEmit, type RelationEffects } from '../../../ontology/generated'
import { CONTAINER_BOUND_AUTOMATIONS, roleCapability, type Capability } from './accessModel'
import type { EngineOverrides } from './types'

/** 누구나 (anyone 공유 · 폼 응답자) */
export const EVERYONE = '@everyone'

/**
 * 칸을 정하는 interface. 정규화가 interface 를 비운 객체(10-27, 10-30 실측의 GitHub simple-user. runtime rule 객체가 모델의 non_object 판정을
 * 받아 비었다)는 Profile 이 적은 interface(fixture_meta.im_profile.profile_interfaces)로 읽는다. 손코드는 관계 종류로만 간선을 만들어
 * 그 객체의 역할, 소속 간선을 냈다. 정규화가 고쳐지면 이 길은 쓰이지 않는다
 */
export function interfacesOf(o: FixtureObject): string[] {
  if (o.canonical.interfaces.length) return [...o.canonical.interfaces]
  const profile = (o.fixture_meta as { im_profile?: { profile_interfaces?: unknown } } | undefined)?.im_profile?.profile_interfaces
  return Array.isArray(profile) ? profile.map(String) : []
}

/** 효과 표가 관계 행 하나의 칸 하나에서 낸 간선 하나. branch 는 맞은 조건 갈래 이름, 없으면 effects */
export interface RelationEmit {
  pair: string
  branch: string
  emit: EffectEmit
  from: string
  to: string
}

type Expr = Record<string, any>

export class RelationEffectReader {
  private readonly objects: Record<string, MatchObject> = {}
  private readonly relations: MatchRelation[] = []
  private readonly relationsFrom = new Map<string, MatchRelation[]>()
  private readonly tables = { container_bound_automations: CONTAINER_BOUND_AUTOMATIONS.map(c => ({ provider: c.provider, objectType: c.objectType })) }

  constructor(private readonly graph: GraphStoreV2, private readonly semantics: Record<string, RelationEffects> = RELATION_EFFECTS, private readonly overrides?: EngineOverrides) {
    for (const [k, o] of graph.objectsByKey) {
      const c = o.canonical
      const meta = (o.fixture_meta ?? {}) as Record<string, any>
      this.objects[k] = {
        k, p: c.provider, t: c.object_type, i: interfacesOf(o), props: c.properties, ids: c.identifiers as Record<string, unknown>,
        judged: (c.judged ?? {}) as Record<string, unknown>, profile: { ...meta.model_v1?.profile_constants, ...meta.im_profile?.profile_constants }, meta,
        refs: Object.fromEntries(Object.entries(c.references ?? {}).map(([n, v]) => [n, (v?.targets ?? []).map(t => String(t.value))])),
      }
    }
    for (const list of graph.relationsByType.values()) {
      for (const r of list) {
        const m: MatchRelation = { rt: r.relationType, s: r.sourceKey, d: r.targetKey, role: roleMatchKey(r), props: r.properties }
        this.relations.push(m)
        this.relationsFrom.set(m.s, [...(this.relationsFrom.get(m.s) ?? []), m])
      }
    }
  }

  /** 조건식이 보는 관계 속성. resource_set 이 있으면 resource_set_scope 를 수집한 대상으로 계산해 넣는다(못 정하면 뺀다) */
  private relationProps(rel: ResolvedRelation): Record<string, unknown> {
    if (rel.properties.resource_set === undefined) return rel.properties
    const { resource_set_scope: _stored, ...rest } = rel.properties
    const scope = resourceSetScope(this.graph, rel.provider, rel.properties.resource_set)
    return scope ? { ...rest, resource_set_scope: scope } : rest
  }

  /** 관계 행 하나의 간선. 칸 차례(출발 interface × 도착 interface), 그 안에서 emits 차례다. 끝이 없거나 양 끝이 같으면 뺀다 */
  emits(rel: ResolvedRelation): RelationEmit[] {
    return this.cells(rel).flatMap(c => c.emits)
  }

  /**
   * 관계 행 하나의 interface 칸마다: 효과 표가 그 칸을 적었나(defined), 맞은 조건 갈래가 효과 없음이라 막혔나(blocked), 낸 간선.
   * 닿음 핵심 질의면(reach.ts)이 관계 홉이 서는지 이것으로 본다(막히지 않은 칸이 있으면 선다. 칸을 하나도 안 적은 관계는 관계 행이 있으면 선다)
   */
  cells(rel: ResolvedRelation): Array<{ pair: string; defined: boolean; blocked: boolean; narrowed: boolean; emits: RelationEmit[] }> {
    const src = this.objects[rel.sourceKey]
    const tgt = this.objects[rel.targetKey]
    if (!src || !tgt) return []
    const sem = this.semantics[rel.relationType]
    if (!sem) return (src.i ?? []).flatMap(si => (tgt.i ?? []).map(ti => ({ pair: `${si}>${ti}`, defined: false, blocked: false, narrowed: false, emits: [] })))
    const via = typeof rel.properties.via_assignment === 'string' ? this.objects[rel.properties.via_assignment] : undefined
    const relationPlace: MatchObject = { k: rel.relationKey, p: rel.provider, t: rel.relationType, props: this.relationProps(rel) }
    const ctx = new MatchCtx({ source: src, target: tgt, role: rel.roleKey ? this.objects[rel.roleKey] : undefined, relation: relationPlace, via_assignment: via }, this.relations, this.tables, this.objects)
    const matched = new Map<string, boolean>()
    const matches = (c: RelationEffects['conditions'][number]) => {
      if (!matched.has(c.name)) matched.set(c.name, !!c.match && !this.overridden(c.override, rel) && holds(c.match as Expr, ctx))
      return matched.get(c.name)!
    }
    const out: Array<{ pair: string; defined: boolean; blocked: boolean; narrowed: boolean; emits: RelationEmit[] }> = []
    for (const si of src.i ?? []) {
      for (const ti of tgt.i ?? []) {
        const pair = `${si}>${ti}`
        const cond = (sem.conditions ?? []).find(c => c.cases.some(x => x.pair === pair) && matches(c))
        const blocks = (sem.effects ?? []).filter(b => b.pairs.includes(pair))
        const emits = cond ? cond.cases.find(x => x.pair === pair)!.emits : blocks.flatMap(b => b.emits)
        const narrowed = emits.some(e => NARROWING_ENDS.has(e.to))
        const cell = { pair, defined: !!cond || blocks.length > 0 || (sem.conditions ?? []).some(c => c.cases.some(x => x.pair === pair)), blocked: !!cond && emits.length === 0, narrowed, emits: [] as RelationEmit[] }
        for (const emit of emits) {
          for (const from of this.endsOf(emit.from, rel)) {
            for (const to of this.endsOf(emit.to, rel)) {
              if (from === to) continue
              cell.emits.push({ pair, branch: cond?.name ?? 'effects', emit, from, to })
            }
          }
        }
        out.push(cell)
      }
    }
    return out
  }

  /**
   * 이 관계 행의 interface 칸 가운데 효과 표(effects 나 조건 갈래)가 적은 칸이 있나. 효과가 있는 관계 종류인데 칸이 하나도 없으면
   * template 밖 행이다 — 손코드는 관계 종류만 보고 간선을 냈고, 효과 표는 내지 않는다(엔진 경고 relation_outside_effects)
   */
  covered(rel: ResolvedRelation): { hasEffects: boolean; pairs: string[]; covered: boolean } {
    const sem = this.semantics[rel.relationType]
    const src = this.objects[rel.sourceKey]
    const tgt = this.objects[rel.targetKey]
    const pairs = (src?.i ?? []).flatMap(si => (tgt?.i ?? []).map(ti => `${si}>${ti}`))
    const known = new Set([...(sem?.effects ?? []).flatMap(b => b.pairs), ...(sem?.conditions ?? []).flatMap(c => c.cases.map(x => x.pair))])
    return { hasEffects: known.size > 0, pairs, covered: pairs.some(p => known.has(p)) }
  }

  /** 사람이 확인한 값으로 갈래를 끄나 */
  private overridden(override: string | undefined, rel: ResolvedRelation): boolean {
    if (!override) return false
    if (override === 'confirmed_resource_sets') return !!this.overrides?.confirmed_resource_sets?.includes(String(rel.properties.resource_set))
    throw new Error(`효과 표 갈래의 모르는 override: ${override}`)
  }

  private endsOf(end: string, rel: ResolvedRelation): string[] {
    const one = (k: string | undefined) => (k ? [k] : [])
    if (end === 'source') return [rel.sourceKey]
    if (end === 'target') return [rel.targetKey]
    if (end === 'everyone') return [EVERYONE]
    if (end === 'grant') {
      const g = rel.properties.via_grant
      return one(typeof g === 'string' && this.objects[g] ? g : undefined)
    }
    if (end === 'tenant') return one(resolve(RELATION_RESOLVERS.tenant_of, rel.sourceKey, this.objects, this.relationsFrom)[0])
    if (end === 'resource_set') return resourceSetCovers(this.graph, rel.provider, rel.properties.resource_set).objects
    if (end === 'resource_set_unexpanded') return resourceSetCovers(this.graph, rel.provider, rel.properties.resource_set).unexpanded.length ? [rel.targetKey] : []
    throw new Error(`효과 표의 모르는 간선 끝: ${end}`)
  }
}

/** 관계 도착 대신 펼친 대상을 가리키는 간선 끝 */
export const NARROWING_ENDS: ReadonlySet<string> = new Set(['resource_set', 'resource_set_unexpanded'])

/** orn 모양({org}, {id}, 다른 {이름} 자리는 콜론 없는 한 마디)을 정규식으로. {id} 만 잡는다 */
function ornPattern(orn: string): RegExp {
  const esc = orn.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
  return new RegExp(`^${esc.replace(/\{id\}/g, '(?<id>[^:]+)').replace(/\{[a-z_]+\}/g, '[^:]+')}$`)
}

const coverCache = new WeakMap<GraphStoreV2, Map<string, { objects: string[]; unexpanded: string[] }>>()

const idOf = (o: FixtureObject) => {
  const v = (o.canonical.identifiers as Record<string, any>)?.id
  return String((v && typeof v === 'object' ? v.value : v) ?? '')
}

const coverageRows = (provider: string) => RESOURCE_SET_COVERAGE.filter(r => r.provider === provider).map(r => ({ ...r, re: ornPattern(r.orn) }))

const ornCache = new WeakMap<GraphStoreV2, Map<string, string[]>>()

/** 리소스 세트 하나의 수집한 대상 orn. 세트 객체(ResourceSet, identifiers id)를 parent_scope 로 가리키는 대상(ResourceSetResource)의 properties.orn */
export function resourceSetOrns(graph: GraphStoreV2, provider: string, setId: unknown): string[] {
  if (typeof setId !== 'string' || !setId) return []
  let cache = ornCache.get(graph)
  if (!cache) ornCache.set(graph, (cache = new Map()))
  const key = `${provider}|${setId}`
  const hit = cache.get(key)
  if (hit) return hit
  const set = [...graph.objectsByKey.values()].find(o => o.canonical.provider === provider && o.canonical.object_type === 'ResourceSet' && idOf(o) === setId)
  const orns = set ? [...graph.objectsByKey.values()]
    .filter(o => o.canonical.provider === provider && (o.canonical.references?.parent_scope?.targets ?? []).some(t => String(t.value) === set.fixture_key))
    .map(o => o.canonical.properties.orn)
    .filter((x): x is string => typeof x === 'string') : []
  cache.set(key, orns)
  return orns
}

/**
 * 리소스 세트 하나의 범위(효과 표 조건 칸 resource_set_scope). 수집한 대상 가운데 사전 RESOURCE_SET_COVERAGE 의 org_wide 줄에 맞는 것이 하나라도 있으면 org,
 * 대상은 있는데 하나도 없으면 partial, 대상을 못 모았으면 undefined(조건 갈래 okta_resource_set 로 가서 펼치지 않음 사유가 남는다).
 * 줄 고르기는 resourceSetCovers 와 같다(위에서부터 처음 맞는 줄)
 */
export function resourceSetScope(graph: GraphStoreV2, provider: string, setId: unknown): 'org' | 'partial' | undefined {
  const orns = resourceSetOrns(graph, provider, setId)
  if (!orns.length) return undefined
  const rows = coverageRows(provider)
  return orns.some(orn => rows.find(r => r.re.test(orn))?.org_wide) ? 'org' : 'partial'
}

/**
 * 리소스 세트 하나가 덮는 객체(효과 표 간선 끝 resource_set). 세트 객체(ResourceSet, identifiers id)의 대상(ResourceSetResource, references.parent_scope 가
 * 그 세트, properties.orn)을 사전 RESOURCE_SET_COVERAGE 의 위에서부터 처음 맞는 줄로 편다. unexpanded 는 맞는 줄이 없거나 서비스 전체인데 덮는 객체 종류를
 * 모으지 않은 대상의 orn — 그 세트는 다 펴지 못한 것이다
 */
export function resourceSetCovers(graph: GraphStoreV2, provider: string, setId: unknown): { objects: string[]; unexpanded: string[] } {
  if (typeof setId !== 'string' || !setId) return { objects: [], unexpanded: [] }
  let cache = coverCache.get(graph)
  if (!cache) coverCache.set(graph, (cache = new Map()))
  const key = `${provider}|${setId}`
  const hit = cache.get(key)
  if (hit) return hit
  const orns = resourceSetOrns(graph, provider, setId)
  const rows = coverageRows(provider)
  const objects = new Set<string>()
  const unexpanded: string[] = []
  const ofTypes = (types: string[]) => [...graph.objectsByKey.values()].filter(o => o.canonical.provider === provider && types.includes(o.canonical.object_type))
  for (const orn of orns) {
    const row = rows.find(r => r.re.test(orn))
    const id = row ? orn.match(row.re)?.groups?.id : undefined
    if (!row || ((row.covers === 'service' || row.covers === 'kind') && !row.object_types.length)) {
      unexpanded.push(orn)
      continue
    }
    if (row.covers === 'kind' || row.covers === 'service') for (const o of ofTypes(row.object_types)) objects.add(o.fixture_key)
    else {
      const owners = ofTypes(row.object_types).filter(o => idOf(o) === id)
      if (row.covers === 'object') for (const o of owners) objects.add(o.fixture_key)
      else {
        const kinds = row.member_types ?? []
        for (const g of owners) {
          for (const r of graph.relationsByType.get('member_of') ?? []) {
            if (r.targetKey !== g.fixture_key) continue
            const m = graph.objectsByKey.get(r.sourceKey)
            if (m && (!kinds.length || kinds.includes(m.canonical.object_type))) objects.add(r.sourceKey)
          }
        }
      }
    }
  }
  const out = { objects: [...objects].sort(), unexpanded }
  cache.set(key, out)
  return out
}

/**
 * 효과 표 rank: role — has_role_on 역할 칸의 세기. 사전 role_rank_order 의 permissions 단계(관계 행의 권한 키 목록 properties.permissions,
 * 판단표 G4-Q01)는 관계 행을 봐야 해서 여기서 먼저 본다. 아는 키가 없으면 역할로 정한다(roleCapability, 그 안의 grants 단계는 역할 객체가
 * 같은 대상에 받은 has_role_on 줄). 모르면 rank 가 없다.
 */
export function relationRoleCapability(rel: ResolvedRelation, graph: GraphStoreV2, overrides?: EngineOverrides): Capability {
  const obj = (k: string | undefined): FixtureObject | undefined => (k ? graph.objectsByKey.get(k) : undefined)
  if ((ROLE_RANK_ORDER as readonly string[]).includes('permissions')) {
    const ranks = (Array.isArray(rel.properties.permissions) ? rel.properties.permissions : [])
      .map(p => roleCapability(rel.provider, String(p), undefined, undefined, overrides).rank)
      .filter((r): r is number => r !== undefined)
    if (ranks.length) return { rank: Math.max(...ranks), applies_to: undefined, source: 'permissions' }
  }
  const grantRanks = () => (rel.roleKey ? graph.outgoingRelationsByObject.get(rel.roleKey) ?? [] : [])
    .filter(g => g.relationType === 'has_role_on' && g.targetKey === rel.targetKey)
    .map(g => roleCapability(g.provider, g.roleName, g.roleKey, obj(g.roleKey), overrides).rank)
  return roleCapability(rel.provider, rel.roleName, rel.roleKey, obj(rel.roleKey), overrides, { grantRanks })
}
