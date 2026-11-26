/**
 * 관계 의미 층 — 기록 층(관계 17종 행 · 배정 객체 · 벤더 기본 객체) → 사실 9종 → 엔진 간선 (명세 aegi-knowledge Relation_Semantic_Layer_v1).
 *
 * 켜기   기본이 켬이다. AEGI_REL_MODEL=record 로 끄면 edges.ts 관계 절은 기록 층 효과 표 길 그대로다(비교용 · 되돌리기용).
 * 변환기 관계 행마다 사전 semantic_mapping.yaml 의 갈래(routes_first + aliases − drop_routes, 생성 SEMANTIC_EFFECTS)를 본다. 갈래 고르기
 *        (interface 칸, match 식, 끝 찾기, 리소스 세트 펼치기)는 효과 표 읽기(relationEffects.ts RelationEffectReader)를 그대로 쓴다.
 *        다음 레코드 규칙(SEMANTIC_RECORDS)과 배정 자리 표의 emit 줄(SEMANTIC_ASSIGNMENTS)이 객체 하나에서 사실을 낸다.
 *        모든 사실에 거름(SEMANTIC_FILTERS)을 한 번 건다.
 * 빌더   사실 하나에 간선 하나(SEMANTIC_FACT_EDGES). grants 의 rank 는 능력 목록에서 계산한다. holds 는 쥐면 그 신원으로 동작할 때만 간선이다.
 *        conditions · trusts 는 간선이 아니다(사실로만 남는다 — 상한 ceiling 은 conditions requires 사실).
 *        identity caller 인 triggers(위임 호출: 불린 쪽이 부른 사람 자신의 권한으로 동작)도 간선이 아니다. 부른 사람이 원래 할 수 있는 것을
 *        넘지 않으므로 격차를 만들지 않는다. 로그 설명(usage.ts 호출 판정)만 delegatedCalls 로 읽는다.
 * SaaS 이름은 표에만 있다. 이 파일과 capability.ts 에는 provider 이름 분기가 없다.
 * 설정(할 수 있다)만 사실이 된다. 사용(실제로 했다)은 섞지 않는다 — 간선 observed 와 관측 간선은 edges.ts 증거 절 그대로다.
 */
import type { GraphStoreV2 } from '../../../../model/graph'
import type { FixtureObject } from '../../../../model/object'
import type { ResolvedRelation } from '../../../../model/relation'
import { holds as holdsExpr, MatchCtx, resolve, type MatchObject } from '../../../../model/match'
import {
  RELATION_RESOLVERS, RELATION_SEMANTICS, SEMANTIC_ASSIGNMENTS, SEMANTIC_EFFECTS, SEMANTIC_FACT_EDGES, SEMANTIC_FILTERS, SEMANTIC_PROVENANCE_ONLY,
  SEMANTIC_RECORDS, TOKEN_SCOPES, type RelationEffects, type SemanticEmit, type SemanticFactType,
} from '../../../../ontology/generated'
import { EVERYONE, interfacesOf, RelationEffectReader } from '../relationEffects'
import type { Edge, EdgeKind, EdgeRef, EngineOverrides, GrantSource, TriggerMode } from '../types'
import { assignmentCaps, capsOfRank, expandCaps, membershipCaps, rankOf, relationRoleCaps, type Caps } from './capability'
import { convertSettings } from './settings'

/** 관계 의미 층을 켰나. 기본 켬, AEGI_REL_MODEL=record 면 끔(기록 층 효과 표 길) */
export const semanticMode = (): boolean => process.env.AEGI_REL_MODEL !== 'record'

/** 사실 하나 */
export interface SemanticFact {
  p: SemanticFactType
  from: string
  to: string
  caps?: string[]
  capsSource?: string
  /** 상한: 능력은 읽었는데 닿는 객체 종류를 모르는 scope 의 능력 */
  capsUnresolved?: string[]
  appliesTo?: string[]
  /** grants: 아래 객체로 내려갈 때 남는 능력(역할 능력표 below). 없으면 caps 그대로 */
  capsBelow?: string[]
  /** grants: 테넌트에 거는 권한의 출처 종류(레코드 규칙 emit 의 tenant_grant) */
  tenantGrant?: string
  basis: string
  mode?: string
  polarity?: string
  uncertain: string[]
  impersonate?: boolean
  /** triggers: 불린 쪽이 누구의 권한으로 동작하나. caller = 부른 사람 자신(위임 호출, 간선 없음). 없으면 own(자기 실행 신원) */
  identity?: 'own' | 'caller'
  origin: { kind: 'relation' | 'record'; id: string; route: string; relationType?: string }
  /** 갈래 표의 출발 끝 이름(source · target · grant · everyone · tenant …). 기록 층 설명 글을 고를 때 쓴다 */
  fromEnd?: string
  /** 설명 글(설정 조건 표의 label) */
  title?: string
  /** conditions(exclude): 능력을 깎을 대상 객체 (설정 조건 표, settings.ts) */
  targets?: string[]
  roleKey?: string
  roleName?: string
  revocable: boolean
}

type EdgeDraft = Omit<Edge, 'id' | 'uncertain' | 'revocable' | 'observed' | 'refs'> & { uncertain?: string[]; revocable?: boolean; observed?: boolean; refs?: EdgeRef[] }

const GRANT_SOURCE: Record<string, GrantSource> = { stated: 'config', computed: 'config', flag: 'config', vendor_default: 'model', logged: 'observed' }
const FACT_LABEL: Record<SemanticFactType, string> = {
  member_of: '소속', contained_in: '상위 범위', grants: '권한', holds: '자격증명을 쥔 사람으로 동작', acts_as: '대신 동작',
  triggers: '호출', flows_to: '흐름', conditions: '조건', trusts: '신뢰',
}

export class SemanticConverter {
  readonly reader: RelationEffectReader
  readonly facts: SemanticFact[] = []
  readonly stats = { relations: 0, records: 0, filtered: 0, provenanceOnly: 0, byRoute: {} as Record<string, number> }
  /** 설정 조건 표가 낸 roleKey → 테넌트 소속을 펼 때 뺄 구성원 (edges.ts 가 roleExcludes 에 더한다) */
  readonly settingExcludes = new Map<string, Set<string>>()
  readonly settingStats: Record<string, unknown> = {}
  private readonly objects: Record<string, MatchObject> = {}
  private readonly relationsFrom = new Map<string, any[]>()

  constructor(readonly graph: GraphStoreV2, readonly overrides?: EngineOverrides) {
    this.reader = new RelationEffectReader(graph, SEMANTIC_EFFECTS as unknown as Record<string, RelationEffects>, overrides)
    for (const [k, o] of graph.objectsByKey) {
      const c = o.canonical
      const meta = (o.fixture_meta ?? {}) as Record<string, any>
      this.objects[k] = {
        k, p: c.provider, t: c.object_type, i: interfacesOf(o), props: c.properties, ids: c.identifiers as Record<string, unknown>,
        judged: (c.judged ?? {}) as Record<string, unknown>, profile: { ...meta.model_v1?.profile_constants, ...meta.im_profile?.profile_constants }, meta,
        refs: Object.fromEntries(Object.entries(c.references ?? {}).map(([n, v]) => [n, (v?.targets ?? []).map(t => String(t.value))])),
      }
    }
    for (const list of graph.relationsByType.values()) for (const r of list) this.relationsFrom.set(r.sourceKey, [...(this.relationsFrom.get(r.sourceKey) ?? []), { rt: r.relationType, s: r.sourceKey, d: r.targetKey, props: r.properties }])
  }

  /** 거름: 사실의 양 끝 가운데 Principal 인 객체에 principal_end 식(자리 source)이 맞으면 사실을 내지 않는다 */
  private filtered(f: SemanticFact): boolean {
    for (const flt of SEMANTIC_FILTERS) {
      if (!flt.p.includes(f.p)) continue
      for (const k of [f.from, f.to]) {
        const o = this.objects[k]
        if (o && (o.i ?? []).includes('Principal') && holdsExpr(flt.principal_end as Record<string, any>, new MatchCtx({ source: o }, [], {}, this.objects))) return true
      }
    }
    return false
  }

  private capsFor(e: SemanticEmit, ctx: { rel?: ResolvedRelation; record?: FixtureObject; to: string }): Caps {
    if (e.caps === undefined) return { source: 'none' }
    if (e.caps === 'role' && ctx.rel) return relationRoleCaps(ctx.rel, this.graph, this.overrides)
    if (e.caps === 'membership') return { caps: membershipCaps(ctx.rel?.provider ?? ctx.record?.canonical.provider, this.graph.objectsByKey.get(ctx.to)?.canonical.object_type), source: 'membership' }
    const subject = ctx.record ?? (ctx.rel ? this.graph.objectsByKey.get(ctx.rel.sourceKey) : undefined)
    if (e.caps === 'assignment') return subject ? assignmentCaps(subject, this.graph, this.overrides) : { source: 'unknown' }
    if (typeof e.caps === 'string' && e.caps.startsWith('scope:')) return scopeCaps(subject, e.caps.slice('scope:'.length))
    return { caps: expandCaps(e.caps), source: 'table' }
  }

  private push(e: SemanticEmit, from: string, to: string, origin: SemanticFact['origin'], c: Caps, extra: { revocable: boolean; roleKey?: string; roleName?: string }) {
    const f: SemanticFact = {
      p: e.p, from, to, fromEnd: e.from, basis: e.basis ?? 'stated', mode: e.mode, polarity: e.polarity, impersonate: e.impersonate, ...(e.identity ? { identity: e.identity } : {}), origin, revocable: extra.revocable,
      roleKey: extra.roleKey, roleName: extra.roleName, caps: c.caps, capsSource: c.source, appliesTo: c.applies_to, ...(c.below ? { capsBelow: c.below } : {}), ...(e.tenant_grant ? { tenantGrant: e.tenant_grant } : {}), ...(c.unresolved ? { capsUnresolved: c.unresolved } : {}),
      uncertain: [...(e.p === 'grants' && e.caps !== undefined && c.caps === undefined ? ['role_rank_unknown'] : []), ...(e.uncertain ?? [])],
    }
    if (this.filtered(f)) { this.stats.filtered++; return }
    this.facts.push(f)
    const k = `${origin.relationType ?? 'record'}.${origin.route}`
    this.stats.byRoute[k] = (this.stats.byRoute[k] ?? 0) + 1
  }

  convertRelation(rel: ResolvedRelation, revocable: boolean): void {
    this.stats.relations++
    let any = false
    for (const cell of this.reader.cells(rel)) {
      for (const em of cell.emits) {
        const e = em.emit as unknown as SemanticEmit
        any = true
        this.push(e, em.from, em.to, { kind: 'relation', id: rel.relationKey, route: em.branch.replace(`${rel.relationType}.`, ''), relationType: rel.relationType }, this.capsFor(e, { rel, to: em.to }), { revocable, roleKey: rel.roleKey, roleName: rel.roleName })
      }
    }
    if (!any && SEMANTIC_PROVENANCE_ONLY.includes(rel.relationType)) this.stats.provenanceOnly++
  }

  /** 레코드 규칙과 배정 자리 표의 emit 줄: 객체 하나가 사실을 말할 때 */
  convertRecords(skip?: (key: string) => boolean): void {
    const fromAssignments = SEMANTIC_ASSIGNMENTS.filter(a => a.emit).map(a => ({
      name: `assignment:${a.provider}:${a.object_type}`,
      select: { all: [{ source: { provider: a.provider, object_type: a.object_type } }, ...(a.emit!.when ? [{ source: { property: a.emit!.when } }] : [])] },
      name_regex: undefined as Record<string, string> | undefined,
      emit: [
        { p: 'grants', from: a.emit!.holder, to: a.emit!.target, caps: a.emit!.caps, ...(a.emit!.basis ? { basis: a.emit!.basis } : {}) },
        ...(a.emit!.ceiling ? [{ p: 'conditions', from: 'self', to: a.emit!.holder, polarity: 'requires', caps: `scope:${a.emit!.ceiling}` }] : []),
      ] as SemanticEmit[],
    }))
    for (const rule of [...SEMANTIC_RECORDS, ...fromAssignments]) {
      for (const [k, mo] of Object.entries(this.objects)) {
        if (skip?.(k)) continue
        if (!holdsExpr(rule.select as Record<string, any>, new MatchCtx({ source: mo, target: mo }, [], {}, this.objects))) continue
        if (rule.name_regex && !Object.entries(rule.name_regex).every(([field, rx]) => new RegExp(rx).test(String(mo.props?.[field] ?? '')))) continue
        const o = this.graph.objectsByKey.get(k)!
        for (const e of rule.emit) {
          for (const from of this.ends(e.from, k)) for (const to of this.ends(e.to, k, from)) {
            // 테넌트가 자기 구성원에게 거는 권한(GitHub 조직 기본 권한)은 출발과 도착이 같다. 출발 테넌트는 구성원으로 펴지고 도착 테넌트는 범위다
            if (from === to && !(e.tenant_grant && e.p === 'grants')) continue
            this.stats.records++
            this.push(e, from, to, { kind: 'record', id: k, route: rule.name }, this.capsFor(e, { record: o, to }), { revocable: false })
          }
        }
      }
    }
  }

  /** 설정 조건 표(칸 conditions_on): 허용이면 grants, 막음이면 conditions(exclude). 사실마다 거름을 한 번 건다 (settings.ts) */
  convertSettings(skip?: (key: string) => boolean): void {
    const got = convertSettings(this.graph, this.objects, this.relationsFrom, skip)
    for (const f of got.facts) {
      if (this.filtered(f)) { this.stats.filtered++; continue }
      this.facts.push(f)
      this.stats.byRoute[`record.${f.origin.route}`] = (this.stats.byRoute[`record.${f.origin.route}`] ?? 0) + 1
    }
    for (const [k, v] of got.excludes) this.settingExcludes.set(k, v)
    Object.assign(this.settingStats, got.stats)
  }

  /** 레코드 끝: self, everyone, ref:<칸>(| 는 여럿), tenant(그 객체의 테넌트), tenant_of_from · tenant_of_holder(앞 끝의 테넌트) */
  private ends(end: string, self: string, from?: string): string[] {
    if (end === 'self') return [self]
    if (end === 'everyone') return [EVERYONE]
    if (end.startsWith('ref:')) return end.slice(4).split('|').flatMap(slot => this.objects[self]?.refs?.[slot] ?? []).filter(k => this.graph.objectsByKey.has(k))
    const tenantOf = (k: string) => resolve(RELATION_RESOLVERS.tenant_of as Record<string, unknown>, k, this.objects, this.relationsFrom as any)
    if (end === 'tenant') return tenantOf(self).slice(0, 1)
    if (end === 'tenant_of_from' || end === 'tenant_of_holder') return from ? tenantOf(from).slice(0, 1) : []
    throw new Error(`관계 의미 층 레코드 규칙의 모르는 끝: ${end}`)
  }
}

/** 위임 호출: 불린 쪽이 부른 사람 자신의 권한으로 동작하는 triggers 사실. 간선을 내지 않는다 */
export const isDelegatedCall = (f: SemanticFact): boolean => f.p === 'triggers' && f.identity === 'caller'

/** 위임 호출 사실을 불린 쪽(도착) 키로 모은다. 로그 설명이 「이 행위자가 그 출발의 구성원인가」로 읽는다 */
export function delegatedCalls(facts: readonly SemanticFact[] | undefined): Map<string, SemanticFact[]> {
  const out = new Map<string, SemanticFact[]>()
  for (const f of facts ?? []) if (isDelegatedCall(f)) out.set(f.to, [...(out.get(f.to) ?? []), f])
  return out
}

/** 배정 객체 scope 칸 → 능력(상한). 토큰 scope 표(TOKEN_SCOPES)의 문법으로 자원 마디 · 능력 마디를 가른다 */
function scopeCaps(o: FixtureObject | undefined, field: string): Caps {
  const raw = o?.canonical.properties[field]
  const scopes = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : []
  const t = o ? TOKEN_SCOPES[o.canonical.provider] : undefined
  if (!t || !scopes.length) return { source: 'scope_unknown' }
  const caps = new Set<string>()
  const types = new Set<string>()
  const unresolved = new Set<string>()
  let known = false
  for (const s of scopes) {
    if (t.identity && new RegExp(t.identity).test(s)) { known = true; continue }
    const m = new RegExp(t.grammar).exec(s)
    const res = m ? t.resources[m[1]] : undefined
    // 능력 마디는 읽었는데 자원이 표에 없다: 능력은 알고 닿는 종류는 모름
    if (m && !res && t.abilities[m[2]] !== undefined) { capsOfRank(t.abilities[m[2]]).forEach(c => unresolved.add(c)); continue }
    if (!m || !res) continue
    known = true
    for (const c of capsOfRank(res.ranks?.[m[2]] ?? t.abilities[m[2]] ?? 0)) caps.add(c)
    res.object_types.forEach(x => types.add(x.toLowerCase()))
  }
  if (!known && !unresolved.size) return { source: 'scope_unknown' }
  return { caps: [...caps], applies_to: types.size ? [...types] : undefined, source: 'scope', ...(unresolved.size ? { unresolved: [...unresolved] } : {}) }
}

function label(f: SemanticFact): string {
  const base = f.title ?? (f.p === 'grants' && f.roleName ? `역할 ${f.roleName}` : FACT_LABEL[f.p])
  const caps = f.p === 'grants' && f.caps ? ` (${f.caps.length ? f.caps.join(', ') : '능력 없음'})` : ''
  const why = f.title ? undefined : f.origin.relationType ? RELATION_SEMANTICS[f.origin.relationType as keyof typeof RELATION_SEMANTICS]?.forward : f.origin.route
  return `${base}${caps}${f.basis === 'vendor_default' ? ' — 벤더 기본' : ''}${why ? ` · ${why}` : ''}`
}

/**
 * 관계 행 전부와 레코드 규칙을 사실로 바꾸고 간선을 낸다. skip 은 관계 행을 건너뛰는 조건(측정 도구 계정), skipObject 는 레코드 규칙에서 뺄 객체,
 * revocable 은 관계 행에서 난 간선을 끊을 수 있나(edges.ts 와 같은 규칙)
 */
export interface SemanticDisplay { label: string; revocable: boolean; refs: EdgeRef[] }

/**
 * display 는 관계 행에서 난 간선의 설명 글 · 끊을 수 있나 · 출처를 기록 층과 같게 고른다(edges.ts relationDisplay). 관계 종류와 간선 종류로만 정해진다.
 * 상위 범위 · 등록 · 트리거 같은 구조 간선은 기록 층에서 끊기 후보가 아니다 — 같게 두지 않으면 끊기 제안과 조치 문구가 바뀐다
 */
export function buildSemanticEdges(graph: GraphStoreV2, add: (d: EdgeDraft) => unknown, opts: { overrides?: EngineOverrides; skip?: (rel: ResolvedRelation) => boolean; skipObject?: (key: string) => boolean; revocable: (rel: ResolvedRelation) => boolean; display?: (f: SemanticFact, kind: EdgeKind, from: string, to: string) => SemanticDisplay | undefined }): SemanticConverter {
  const conv = new SemanticConverter(graph, opts.overrides)
  for (const rel of graph.relationsByKey.values()) {
    if (!graph.objectsByKey.has(rel.sourceKey) || !graph.objectsByKey.has(rel.targetKey) || opts.skip?.(rel)) continue
    conv.convertRelation(rel, opts.revocable(rel))
  }
  conv.convertRecords(opts.skipObject)
  conv.convertSettings(opts.skipObject)
  for (const f of conv.facts) {
    const { edge, reverse } = SEMANTIC_FACT_EDGES[f.p]
    if (edge === 'none') continue
    if (f.p === 'holds' && !f.impersonate) continue
    if (isDelegatedCall(f)) continue
    const refs: EdgeRef[] = [f.origin.kind === 'relation' ? { type: 'relation', id: f.origin.id } : { type: 'reference', id: f.origin.id }]
    if (f.p === 'triggers' && f.mode === 'modify') refs.push({ type: 'model', id: 'container_bound' })
    const [from, to] = reverse ? [f.to, f.from] : [f.from, f.to]
    const shown = f.origin.kind === 'relation' ? opts.display?.(f, edge, from, to) : undefined
    add({
      kind: edge, from, to,
      ...(edge === 'G' ? { rank: rankOf(f.caps), ...(f.caps ? { caps: f.caps } : {}), ...(f.capsBelow ? { capsBelow: f.capsBelow } : {}), grantSource: GRANT_SOURCE[f.basis] ?? 'config', appliesTo: f.appliesTo, roleKey: f.roleKey, ...(f.tenantGrant ? { tenantGrant: f.tenantGrant } : {}) } : {}),
      ...(f.mode ? { mode: f.mode as TriggerMode } : {}),
      uncertain: f.uncertain, revocable: shown?.revocable ?? f.revocable, refs: shown?.refs ?? refs, label: shown?.label ?? label(f),
    })
  }
  return conv
}
