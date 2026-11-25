/**
 * 저장된 사실 → 간선 7종 (설계서 §2-1).
 *
 * 입력: 관계(relations) · 객체 참조(references) · Identity Link · 증거 링크(evidence_links) · 관측(observations) · provider 권한 모델.
 * 판정 규칙은 여기 없다 — 간선마다 확실성(uncertain 사유)·회수 가능·관측 여부만 붙인다.
 * 상관 ID 는 읽지 않는다 (D-12).
 */
import type { EvidenceObservation, EvidenceStore } from '../../../model/evidence'
import type { GraphStoreV2 } from '../../../model/graph'
import type { FixtureObject } from '../../../model/object'
import type { ResolvedRelation } from '../../../model/relation'
import { isGroupPrincipal } from '../audience'
import { isMeasurementMembership, linkPairGrade, principalKind } from '../identity'
import {
  CONTAINER_BOUND_AUTOMATIONS,
  COVERAGE_CALLS,
  ENTRY_POINTS,
  OPEN_RESPONDENT_RESOURCES,
  RANK,
  VISIBILITY_SCOPED,
  membershipRank,
  roleCapability,
  type Capability,
  type CoverageFamily,
} from './accessModel'
import type { CoverageFile, Edge, EdgeKind, EdgeRef, EngineOverrides, EngineWarning, GrantSource, TriggerMode } from './types'
import { RELATION_EFFECTS } from '../../../ontology/generated'
import { EVERYONE, RelationEffectReader, relationRoleCapability, type RelationEmit } from './relationEffects'
import { buildSemanticEdges, semanticMode, type SemanticFact } from './semantic/facts'
import { assignmentCaps, rankOf } from './semantic/capability'
import { buildCeilings, edgeCaps, type Ceiling } from './semantic/ceiling'

/** 누구나 (anyone 공유 · 폼 응답자). 관계 효과 표 읽기(relationEffects.ts)와 같이 쓴다 */
export { EVERYONE }
/** 관측된 실행 하나를 행위자로 둘 때의 노드 (자동화 객체가 없는 실행 — 예: AI 에이전트 세션) */
export const OBS_PREFIX = 'obs:'

export interface NodeInfo {
  key: string
  name: string
  provider?: string
  type?: string
  interfaces: string[]
  virtual: boolean
}

type EdgeDraft = Omit<Edge, 'id' | 'uncertain' | 'revocable' | 'observed' | 'refs'> & {
  uncertain?: string[]
  revocable?: boolean
  observed?: boolean
  refs?: EdgeRef[]
}

export interface EdgeIndexOptions {
  coverage?: CoverageFile
  overrides?: EngineOverrides
}

export class EdgeIndex {
  readonly edges = new Map<string, Edge>()
  readonly out = new Map<string, Edge[]>()
  readonly in = new Map<string, Edge[]>()
  readonly warnings: EngineWarning[] = []
  /** 자원별로 목록이 열린 사유 (권한 배정 받는 쪽이 객체가 아님 등) */
  readonly extraOpen = new Map<string, string[]>()
  /** 엔드포인트 → 관측된 요청 채널 */
  readonly requestChannels = new Map<string, Set<string>>()
  /** 엔드포인트 → 요청이 채널 때문에 거부된 채널 (관측). 성공 채널과 겹치지 않으면 채널 제한이 있다는 증거다 */
  readonly deniedChannels = new Map<string, Set<string>>()
  /** 역할 객체 → 제외하는 주체 */
  readonly roleExcludes = new Map<string, Set<string>>()
  /**
   * 간선 출처마다 그 출처가 낸 불확실 사유(`간선 id|출처 종류:출처 id` → 사유). 같은 간선을 여러 출처가 내면 간선에는 더 단단한 쪽만 남으므로,
   * 출처(관계 행)마다 한 걸음씩 묻는 닿음 핵심 질의면(reach.ts)이 이것을 읽는다
   */
  readonly refUncertain = new Map<string, string[]>()
  /** 측정 도구 계정이 출발이거나 측정 도구 소속이라 간선을 내지 않은 관계 행 */
  readonly skippedRelations = new Set<string>()
  /** 관계 의미 층 사실 (기본 켬, AEGI_REL_MODEL=record 면 없음. semantic/facts.ts) */
  semanticFacts?: SemanticFact[]
  /** 보유자 → 상한(conditions requires 사실). 질의가 실효 능력 = 권한 ∩ 상한으로 읽는다 (semantic/ceiling.ts) */
  ceilings?: Map<string, Ceiling[]>
  private readonly coverageOpen = new Map<string, string[]>()
  readonly coverageSource: 'file' | 'none'
  private readonly observations = new Map<string, EvidenceObservation>()

  constructor(readonly graph: GraphStoreV2, readonly evidence: EvidenceStore, readonly options: EdgeIndexOptions = {}) {
    this.coverageSource = options.coverage ? 'file' : 'none'
    for (const o of evidence.observationsById.values()) this.observations.set(o.id, o)
    this.buildCoverage()
    buildEdges(this)
  }

  // ---- 노드 ----

  obj(key: string): FixtureObject | undefined {
    return this.graph.objectsByKey.get(key)
  }

  has(key: string, iface: string): boolean {
    return !!this.obj(key)?.canonical.interfaces.includes(iface as never)
  }

  type(key: string): string | undefined {
    return this.obj(key)?.canonical.object_type.toLowerCase()
  }

  provider(key: string): string | undefined {
    return this.obj(key)?.canonical.provider
  }

  isTenant(key: string): boolean {
    return this.has(key, 'Tenant')
  }

  isGroupLike(key: string): boolean {
    return key === EVERYONE || this.isTenant(key) || (!!this.obj(key) && isGroupPrincipal(key, this.graph))
  }

  /** 사람 비교에 들어가는 계정 — 주체이고 자동화가 아니고 측정 도구가 아닌 것 */
  isPerson(key: string): boolean {
    const o = this.obj(key)
    if (!o || !o.canonical.interfaces.includes('Principal') || this.isGroupLike(key)) return false
    if (o.fixture_meta?.demo_role === 'measurement_principal') return false
    // 감사 로그 행위자로만 나온 플랫폼 행위자(account_kind system)는 사람으로 세지 않는다(knowledge crosswalk decided.audit_only_actor_system)
    if (o.canonical.judged?.account_kind === 'system') return false
    return principalKind(o) !== 'service'
  }

  node(key: string): NodeInfo {
    if (key === EVERYONE) return { key, name: '누구나', interfaces: [], virtual: true }
    if (key.startsWith(OBS_PREFIX)) {
      const o = this.observations.get(key.slice(OBS_PREFIX.length))
      const a = o?.attributes ?? {}
      const label = str(a.agent_product) ?? str(a.workflow_name) ?? str(a.command) ?? o?.title ?? o?.kind ?? key
      return { key, name: `실행 ${label}`, interfaces: ['Automation'], virtual: true }
    }
    const o = this.obj(key)
    return {
      key,
      name: String(o?.fixture_meta?.display_name ?? o?.canonical.properties.name ?? key),
      provider: o?.canonical.provider,
      type: o?.canonical.object_type,
      interfaces: [...(o?.canonical.interfaces ?? [])],
      virtual: false,
    }
  }

  name(key: string): string {
    return this.node(key).name
  }

  observation(id: string): EvidenceObservation | undefined {
    return this.observations.get(id)
  }

  // ---- 간선 ----

  add(d: EdgeDraft): Edge | undefined {
    // 제자리 간선은 받지 않는다. 테넌트가 자기 구성원에게 거는 권한(tenantGrant 가 있는 G)만 예외
    if (d.from === d.to && !(d.kind === 'G' && d.tenantGrant)) return undefined
    const draft: Edge = {
      ...d,
      id: '',
      uncertain: [...new Set(d.uncertain ?? [])],
      revocable: d.revocable ?? false,
      observed: d.observed ?? false,
      // 간선마다 제 목록을 갖는다. 부르는 쪽이 한 목록을 두 간선에 넘겨도(has_role_on 의 사람, 자격증명 간선) 아래 합치기가 다른 간선 근거에 새지 않는다
      refs: [...(d.refs ?? [])],
    }
    const sig = `${d.kind}|${d.from}|${d.to}|${d.rank ?? ''}|${d.mode ?? ''}|${(d.appliesTo ?? []).join(',')}`
    draft.id = `${d.kind}:${hashId(sig)}`
    for (const r of draft.refs) {
      const k = `${draft.id}|${r.type}:${r.id}`
      const had = this.refUncertain.get(k)
      if (!had || draft.uncertain.length < had.length) this.refUncertain.set(k, draft.uncertain)
    }
    const prev = this.edges.get(draft.id)
    if (prev) {
      // 같은 사실이 여러 출처에서 오면 더 단단한 쪽: 확실 > 불확실, 관측 · 회수 가능은 합친다
      // 설명은 더 단단한 출처의 것으로 (구조상 → 전송 기록)
      const keepConfigLabel = d.kind === 'G' && prev.grantSource === 'config' && draft.grantSource !== 'config'
      const takeConfigLabel = d.kind === 'G' && draft.grantSource === 'config' && prev.grantSource !== 'config'
      if (takeConfigLabel || (!keepConfigLabel && ((prev.uncertain.length && !draft.uncertain.length) || (draft.observed && !prev.observed)))) prev.label = draft.label
      if (!draft.uncertain.length || (prev.uncertain.length && draft.uncertain.length < prev.uncertain.length)) prev.uncertain = draft.uncertain
      prev.observed ||= draft.observed
      prev.revocable ||= draft.revocable
      for (const r of draft.refs) if (!prev.refs.some(x => x.type === r.type && x.id === r.id)) prev.refs.push(r)
      if (draft.grantSource === 'config' && prev.grantSource !== 'config') prev.grantSource = 'config'
      if (draft.tenantGrant && !prev.tenantGrant) prev.tenantGrant = draft.tenantGrant
      // 의미 층: 같은 세기의 두 사실이면 능력을 합친다(한쪽이 세기뿐이면 세기에서 편 목록)
      // 아래로 내려가는 능력: 한쪽만 줄였으면 다른 쪽의 능력 전부와 합친다(줄이지 않은 근거가 있으면 그만큼 내려간다)
      if (prev.capsBelow || draft.capsBelow) prev.capsBelow = [...new Set([...(prev.capsBelow ?? edgeCaps(prev) ?? []), ...(draft.capsBelow ?? edgeCaps(draft) ?? [])])]
      if (prev.caps || draft.caps) prev.caps = [...new Set([...(edgeCaps(prev) ?? []), ...(edgeCaps(draft) ?? [])])]
      return prev
    }
    this.edges.set(draft.id, draft)
    push(this.out, draft.from, draft)
    push(this.in, draft.to, draft)
    return draft
  }

  private byKind?: Map<EdgeKind, Edge[]>
  /** 종류별 간선 (만든 뒤에만 부른다 — 첫 호출에 굳힌다) */
  ofKind(kind: EdgeKind): Edge[] {
    if (!this.byKind) {
      this.byKind = new Map()
      for (const e of this.edges.values()) push(this.byKind, e.kind, e)
    }
    return this.byKind.get(kind) ?? []
  }

  outOf(key: string, kind?: EdgeKind): Edge[] {
    const list = this.out.get(key) ?? []
    return kind ? list.filter(e => e.kind === kind) : list
  }

  inOf(key: string, kind?: EdgeKind): Edge[] {
    const list = this.in.get(key) ?? []
    return kind ? list.filter(e => e.kind === kind) : list
  }

  noteOpen(key: string, reason: string): void {
    const list = this.extraOpen.get(key) ?? []
    if (!list.includes(reason)) list.push(reason)
    this.extraOpen.set(key, list)
  }

  // ---- 수집 완결성 (설계서 §2-4 열린 완결성) ----

  /** 목록 호출이 끝까지 받은 소속 family (빈 그룹이 정말 비었다고 말할 수 있다) */
  private readonly coverageClosed = new Set<string>()

  private buildCoverage(): void {
    const file = this.options.coverage
    if (!file) return
    const byCall = new Map(file.calls.map(c => [c.call_id, c]))
    for (const [callId, families] of Object.entries(COVERAGE_CALLS)) {
      const call = byCall.get(callId)
      const reason = !call ? `not_collected:${callId}` : call.completeness !== 'full' ? `coverage:${callId}:${call.completeness}` : undefined
      if (!reason) {
        for (const f of families) for (const t of f.objectTypes) this.coverageClosed.add(`${f.family}|${f.provider}|${t}`)
        continue
      }
      for (const f of families) {
        for (const t of f.objectTypes) {
          const k = `${f.family}|${f.provider}|${t}`
          const list = this.coverageOpen.get(k) ?? []
          list.push(reason)
          this.coverageOpen.set(k, list)
        }
      }
    }
  }

  /** 이 노드로 들어오는 소속·권한 목록이 열렸나 */
  openReasons(family: CoverageFamily, key: string): string[] {
    const reasons = [...(this.coverageOpen.get(`${family}|${this.provider(key)}|${this.type(key)}`) ?? [])]
    if (family === 'grants') reasons.push(...(this.extraOpen.get(key) ?? []))
    // 멤버가 하나도 없는 그룹: 멤버 목록 호출이 끝까지 받았으면 정말 빈 그룹이고, 아니면 못 받은 것일 수 있다
    const closed = this.coverageClosed.has(`members|${this.provider(key)}|${this.type(key)}`) && !(this.coverageOpen.get(`members|${this.provider(key)}|${this.type(key)}`) ?? []).length
    if (family === 'members' && key !== EVERYONE && !this.isTenant(key) && this.obj(key) && !this.inOf(key, 'M').length && !closed) reasons.push(`group_members_empty:${key}`)
    return reasons
  }

  coverageSummary(): Array<{ family: string; reason: string }> {
    return [...this.coverageOpen].flatMap(([family, reasons]) => reasons.map(reason => ({ family, reason })))
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

/** cyrb53 — 간선 id 압축 (암호용 아님) */
function hashId(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

function refValues(o: FixtureObject | undefined, slot: string): string[] {
  return (o?.canonical.references?.[slot]?.targets ?? []).map(t => String(t.value))
}

/** tenant 참조가 수집 안 된 다른 테넌트를 가리킨다 (원본 행이 테넌트 id 를 말했지만 그 테넌트 객체가 없다) */
function foreignTenant(o: FixtureObject | undefined): boolean {
  const targets = (o?.canonical.references?.tenant?.targets ?? []) as Array<{ status?: string; identifier_type?: string }>
  return targets.length > 0 && targets.every(t => t.status === 'unresolved' && t.identifier_type === 'native')
}

const relRef = (rel: ResolvedRelation): EdgeRef => ({ type: 'relation', id: rel.relationKey })
const isStatedRevocable = (rel: ResolvedRelation) => rel.properties.basis === 'stated' && rel.properties.decomposable !== false

// ---------------------------------------------------------------------------

function buildEdges(ix: EdgeIndex): void {
  const { graph, evidence, options } = ix
  const overrides = options.overrides
  const measurement = (key: string) => ix.obj(key)?.fixture_meta?.demo_role === 'measurement_principal'
  const isAutomation = (k: string) => ix.has(k, 'Automation')
  const isEndpoint = (k: string) => ix.has(k, 'Endpoint')
  const isPrincipal = (k: string) => ix.has(k, 'Principal')
  /** 이미 has_role_on 으로 편 권한 배정 객체 */
  const spread = new Set<string>()

  for (const rel of graph.relationsByKey.values()) {
    if (rel.relationType === 'excludes') {
      const set = ix.roleExcludes.get(rel.sourceKey) ?? new Set<string>()
      set.add(rel.targetKey)
      ix.roleExcludes.set(rel.sourceKey, set)
    }
    const via = rel.properties?.via_assignment
    if (rel.relationType === 'has_role_on' && typeof via === 'string') spread.add(via)
  }

  const containerBound = (k: string) => CONTAINER_BOUND_AUTOMATIONS.some(c => c.provider === ix.provider(k) && c.objectType === ix.type(k))

  /** 자동화가 자원 안에 있다 — 그 자원을 읽고(구조상), 묶인 스크립트면 자원 편집자가 코드를 고친다 */
  const automationIn = (automation: string, container: string, ref: EdgeRef) => {
    ix.add({ kind: 'F', from: container, to: automation, uncertain: ['flow_not_observed'], refs: [ref], label: '포함 자원 읽기 가능' })
    if (containerBound(automation)) ix.add({ kind: 'T', from: container, to: automation, mode: 'modify', refs: [ref, { type: 'model', id: 'container_bound' }], label: '컨테이너 편집자 코드 수정 가능' })
  }

  /** 위(부모·테넌트)로 잇는다 */
  const up = (child: string, parent: string, ref: EdgeRef) => {
    if (!ix.obj(parent)) return
    if (isAutomation(child) && !ix.isTenant(parent) && !isPrincipal(parent)) return automationIn(child, parent, ref)
    if (isEndpoint(child) && ix.has(parent, 'Integration')) {
      ix.add({ kind: 'A', from: child, to: parent, refs: [ref], label: '앱의 요청 처리' })
      return
    }
    if (ix.isTenant(parent) && isPrincipal(child) && !ix.isGroupLike(child)) {
      // 플랫폼 행위자(account_kind system)는 테넌트 사용자 목록에 없어 소속으로 잇지 않고 관측 기록의 행위자로만 남긴다
      if (!measurement(child) && ix.obj(child)?.canonical.judged?.account_kind !== 'system') ix.add({ kind: 'M', from: child, to: parent, refs: [ref], label: '테넌트 소속' })
      return
    }
    if (ix.isTenant(parent) && ix.isTenant(child)) ix.add({ kind: 'M', from: child, to: parent, refs: [ref], label: '상위 테넌트 소속' })
    ix.add({ kind: 'U', from: child, to: parent, refs: [ref], label: '상위 범위' })
  }

  // ---- 관계 (개념 사전 효과 표 relation_semantics.yaml, 읽는 법은 relationEffects.ts) ----
  // 간선 종류, 끝, rank, mode, 불확실 사유는 효과 표가 정한다. 여기서는 간선에 붙는 표시(label), 회수 가능, 권한 출처, 역할 키만 단다
  // 관계 의미 층(기본 켬, AEGI_REL_MODEL=record 로 끔): 관계 행 → 사실 9종(사전 semantic_mapping.yaml) → 간선. 끄면 아래 효과 표 길 그대로
  if (semanticMode()) {
    const conv = buildSemanticEdges(graph, d => ix.add(d), {
      overrides, revocable: isStatedRevocable, skipObject: measurement,
      // 관계 행에서 난 간선은 기록 층과 같은 설명 글 · 끊을 수 있나 · 출처. 기록 층이 정하지 않은 조합(관계 종류 이름이 그대로 나옴)은 의미 층 글
      display: (f, kind, from, to) => {
        const rel = graph.relationsByKey.get(f.origin.id)
        if (!rel) return undefined
        const d = relationDisplay(ix, rel, { pair: '', branch: f.origin.route, emit: { kind, from: f.fromEnd, uncertain: f.uncertain } as never, from, to }, { ref: relRef(rel), revocable: isStatedRevocable(rel) })
        return d.label === rel.relationType ? undefined : { label: d.label, revocable: d.revocable ?? false, refs: d.refs ?? [relRef(rel)] }
      },
      skip: rel => {
        const skip = isMeasurementMembership(rel) || measurement(rel.sourceKey)
        if (skip) ix.skippedRelations.add(rel.relationKey)
        return skip
      },
    })
    ix.semanticFacts = conv.facts
    ix.ceilings = buildCeilings(ix, ix.semanticFacts)
    // 설정 조건 표가 허용한 권한(출발 = 테넌트)은 테넌트 소속을 펼 때 except 구성원(게스트 · 봇)을 뺀다 — 역할 제외와 같은 길 (semantic/settings.ts)
    for (const [role, set] of conv.settingExcludes) ix.roleExcludes.set(role, new Set([...(ix.roleExcludes.get(role) ?? []), ...set]))
    // 효과 표 밖 칸의 관계 행은 간선을 내지 않고 경고로 드러낸다(기록 층과 같은 경고, 의미 층 갈래 표 기준)
    for (const rel of graph.relationsByKey.values()) {
      if (!ix.obj(rel.sourceKey) || !ix.obj(rel.targetKey) || ix.skippedRelations.has(rel.relationKey)) continue
      const cells = conv.reader.covered(rel)
      if (cells.hasEffects && !cells.covered) ix.warnings.push({ code: 'relation_outside_effects', message: `${rel.relationKey}: ${rel.relationType} 의 interface 칸(${cells.pairs.join(', ') || '없음'})이 효과 표에 없어 간선을 내지 않는다 (template 밖)` })
    }
  }
  const reader = new RelationEffectReader(graph, RELATION_EFFECTS, overrides)
  if (!semanticMode()) for (const rel of graph.relationsByKey.values()) {
    const { sourceKey: s, targetKey: t } = rel
    if (!ix.obj(s) || !ix.obj(t)) continue
    // 측정 도구 계정이 출발이거나 측정 도구 소속인 관계는 모든 관계 종류에서 건너뛴다(효과 표는 member_of 두 갈래에만 적었다)
    if (isMeasurementMembership(rel) || measurement(s)) {
      ix.skippedRelations.add(rel.relationKey)
      continue
    }
    const ref = relRef(rel)
    const revocable = isStatedRevocable(rel)
    let cap: Capability | undefined
    const cells = reader.covered(rel)
    if (cells.hasEffects && !cells.covered) ix.warnings.push({ code: 'relation_outside_effects', message: `${rel.relationKey}: ${rel.relationType} 의 interface 칸(${cells.pairs.join(', ') || '없음'})이 효과 표에 없어 간선을 내지 않는다 (template 밖)` })
    for (const e of reader.emits(rel)) {
      const { emit } = e
      if (emit.rank === 'role') cap ??= relationRoleCapability(rel, graph, overrides)
      const rank = typeof emit.rank === 'number' ? emit.rank : emit.rank === 'role' ? cap!.rank : emit.rank === 'membership' ? membershipRank(rel.provider, ix.type(e.to)) : undefined
      const uncertain = [...(emit.rank === 'role' && rank === undefined ? ['role_rank_unknown'] : []), ...(emit.uncertain ?? [])]
      ix.add({ kind: emit.kind, from: e.from, to: e.to, rank, ...(emit.mode ? { mode: emit.mode as TriggerMode } : {}), uncertain, ...relationDisplay(ix, rel, e, { ref, revocable, cap }) })
    }
  }

  // ---- 객체 참조 (v2 references) ----
  for (const o of graph.objectsByKey.values()) {
    const k = o.fixture_key
    if (measurement(k)) continue
    const ref: EdgeRef = { type: 'reference', id: k }
    if (o.canonical.interfaces.includes('Assignment')) {
      const parents = refValues(o, 'parent')
      const grantees = refValues(o, 'grantee')
      if (!parents.length || !grantees.length || spread.has(k) || o.canonical.properties.deleted === true) continue
      const role = str(o.canonical.properties.role)
      const semCaps = semanticMode() ? assignmentCaps(o, graph, overrides).caps : undefined
      const cap = semanticMode() ? { rank: rankOf(semCaps) } : role ? roleCapability(o.canonical.provider, role, undefined, undefined, overrides) : { rank: undefined }
      for (const p of parents) {
        for (const g of grantees) {
          if (!ix.obj(g)) {
            ix.noteOpen(p, 'grantee_unresolved')
            continue
          }
          ix.add({ kind: 'G', from: g, to: p, rank: cap.rank, ...(semCaps ? { caps: semCaps } : {}), uncertain: cap.rank === undefined ? ['role_rank_unknown'] : [], grantSource: 'config', refs: [ref], label: `권한 배정 ${role ?? ''}`.trim() })
        }
      }
      continue
    }
    for (const p of [...refValues(o, 'parent'), ...refValues(o, 'parent_file')]) up(k, p, ref)
    for (const t of refValues(o, 'tenant')) up(k, t, ref)
    for (const a of refValues(o, 'author')) if (ix.obj(a)) ix.add({ kind: 'G', from: a, to: k, rank: RANK.write, grantSource: 'author', refs: [ref], label: '작성자' })
    for (const w of refValues(o, 'owner')) if (ix.obj(w) && isPrincipal(w)) ix.add({ kind: 'G', from: w, to: k, rank: RANK.admin, grantSource: 'config', refs: [ref], label: '소유자' })
  }

  // ---- 공개 여부로 정해지는 열람 (Slack 채널) ----
  for (const v of VISIBILITY_SCOPED) {
    for (const o of graph.objectsByProvider.get(v.provider) ?? []) {
      const k = o.fixture_key
      if (o.canonical.object_type.toLowerCase() !== v.objectType) continue
      const value = o.canonical.properties[v.property]
      if (o.canonical.properties.is_ext_shared === true) ix.noteOpen(k, 'ext_shared')
      if (value === true) continue
      const tenants = new Set<string>()
      for (const rel of graph.outgoingRelationsByObject.get(k) ?? []) {
        if (rel.relationType === 'contained_in' && ix.isTenant(rel.targetKey)) tenants.add(rel.targetKey)
        if (rel.relationType === 'shared_with' && ix.isTenant(rel.targetKey)) tenants.add(rel.targetKey)
      }
      for (const t of [...refValues(o, 'parent'), ...refValues(o, 'tenant')]) if (ix.isTenant(t)) tenants.add(t)
      // 원본이 다른 워크스페이스라고 말한 채널(정규화가 tenant 참조를 못 푼 값으로 남김): 이 테넌트 멤버가 읽는다고 두지 않는다.
      // 그 워크스페이스 멤버는 수집 범위 밖이라 읽는 사람 목록이 열린다
      if (!tenants.size && foreignTenant(o)) { ix.noteOpen(k, 'channel_in_other_workspace'); continue }
      for (const t of tenants) {
        ix.add({
          kind: 'G', from: t, to: k, rank: RANK.read, grantSource: 'model',
          uncertain: value === false ? [] : ['channel_visibility_unknown'],
          refs: [{ type: 'model', id: `${v.provider}.${v.objectType}.${v.property}` }],
          label: value === false ? '공개 채널 — 테넌트 멤버 전원 열람 가능' : '공개 여부 미확인 — 테넌트 멤버 열람 가능성',
        })
      }
    }
  }

  // ---- 응답자를 모르는 자원 (폼) ----
  for (const r of OPEN_RESPONDENT_RESOURCES) {
    for (const o of graph.objectsByProvider.get(r.provider) ?? []) {
      if (o.canonical.object_type.toLowerCase() !== r.objectType) continue
      ix.add({ kind: 'G', from: EVERYONE, to: o.fixture_key, rank: RANK.write, grantSource: 'model', uncertain: [r.reason], refs: [{ type: 'model', id: `${r.provider}.${r.objectType}.respondents` }], label: '미상 응답자 내용 입력' })
    }
  }

  // ---- 자동화끼리의 신원 연결 (automation Identity Link) ----
  for (const link of graph.linksById.values()) {
    if (link.level === 'different' || link.meta?.kind !== 'automation') continue
    for (const a of link.set) {
      for (const b of link.set) {
        if (a.object_key === b.object_key || !ix.obj(a.object_key) || !ix.obj(b.object_key)) continue
        const grade = linkPairGrade(link, a.object_key, b.object_key)
        if (grade === null) continue
        ix.add({ kind: 'A', from: a.object_key, to: b.object_key, uncertain: grade === 'weak' ? ['identity_link_weak'] : [], refs: [{ type: 'link', id: link.link_id }], label: '같은 자동화의 동일인 연결' })
      }
    }
  }

  buildEvidenceEdges(ix, evidence)
  buildEntryPoints(ix, overrides)
  buildDeploymentEntries(ix)
  buildOutboundHooks(ix)
}

/**
 * 효과 표가 낸 관계 간선에 붙는 표시: 설명(label), 회수 가능, 권한 출처(grantSource), 역할 키와 적용 범위, 근거(refs).
 * 간선 종류, 끝, rank 는 효과 표가 정한다. 설명 글은 손코드 시절 그대로다 — 탐지 문구와 근거 보기가 이 글을 쓴다.
 * 표가 새 관계 종류나 새 간선을 내면 관계 이름을 설명으로 단다(그 글은 여기 더한다).
 */
function relationDisplay(ix: EdgeIndex, rel: ResolvedRelation, e: RelationEmit, at: { ref: EdgeRef; revocable: boolean; cap?: Capability }): Pick<EdgeDraft, 'label' | 'grantSource' | 'revocable' | 'appliesTo' | 'roleKey' | 'refs'> {
  const { ref, revocable, cap } = at
  const refs = [ref]
  const kind = e.emit.kind
  const config = 'config' as GrantSource
  switch (rel.relationType) {
    case 'has_role_on': {
      const role = rel.roleKey ? ix.obj(rel.roleKey) : undefined
      const roleLabel = rel.roleName ?? (role ? ix.name(role.fixture_key) : '역할')
      // 특수 주체(G4-Q03)의 역할은 누구나, 테넌트 전원에서 난다
      const label = e.emit.from === 'grant' ? `자격증명 권한 ${roleLabel}` : e.emit.from === 'everyone' ? `익명 공개 ${roleLabel}` : e.emit.from === 'tenant' ? `테넌트 전원 ${roleLabel}` : `역할 ${roleLabel}`
      return { appliesTo: cap?.applies_to, roleKey: rel.roleKey, grantSource: config, revocable, refs, label }
    }
    case 'member_of':
      return kind === 'M' ? { revocable, refs, label: '소속' } : { grantSource: config, revocable, refs, label: '멤버' }
    case 'owned_by':
      if (kind === 'G') return { grantSource: config, refs, label: '소유자' }
      return { refs, label: e.emit.from === 'target' ? '앱의 봇' : '소유 주체로 동작' }
    case 'contained_in':
    case 'registered_in':
      if (kind === 'F') return { refs, label: '포함 자원 읽기 가능' }
      if (kind === 'T') return { refs: [ref, { type: 'model', id: 'container_bound' }], label: '컨테이너 편집자 코드 수정 가능' }
      if (kind === 'A') return { refs, label: '앱의 요청 처리' }
      if (kind === 'M') return { refs, label: ix.isTenant(e.from) ? '상위 테넌트 소속' : '테넌트 소속' }
      if (kind === 'U') return { refs, label: '상위 범위' }
      break
    case 'runs_as':
      if (kind === 'F') return { refs, label: '구조상 자격으로 전송 가능' }
      return { revocable, refs, label: ix.has(e.to, 'Principal') ? '실행 신원' : '자격(웹훅, 토큰)으로 전송' }
    case 'acts_as':
      return { revocable, refs, label: '앱이 봇 계정으로 대리 실행' }
    case 'receives_into':
      return kind === 'G' ? { grantSource: config, revocable, refs, label: '수신 자원에 게시' } : { revocable, refs, label: '수신 내용 게시' }
    case 'shared_with':
      return { grantSource: config, revocable, refs, label: e.from === EVERYONE ? '누구나 공유' : '조직 공유' }
    case 'triggered_by':
      return { refs, label: '트리거' }
    case 'authenticates_with':
      // 토큰을 쥐면 그 사람으로 동작한다(결정 반영 2호). 앱이 받은 리프레시 토큰은 받은 scope 만큼이다
      return { revocable, refs, label: (e.emit.uncertain ?? []).includes('token_scope_limited') ? '토큰을 준 사람으로 동작 (scope 만큼)' : '토큰을 만든 사람으로 동작' }
  }
  return { ...(kind === 'G' ? { grantSource: config } : {}), refs, label: rel.relationType }
}

/**
 * 판정값 하나. 행(properties, judged)에 없으면 Profile 상수에서 찾는다.
 * 오브젝트 모델 v1 은 object_type 만으로 정해지는 값(direction 등)을 행에서 빼 fixture_meta.model_v1.profile_constants 에 둔다
 * (Object_Schema_v4.1 「judged{}」). IM Profile 정규화는 Profile 의 constants 를
 * fixture_meta.im_profile.profile_constants 에 둔다(scripts/collect/profile-binding/README.md 「속성」).
 */
export function judgedValue(o: FixtureObject, field: string): unknown {
  const judged = o.canonical.judged as Record<string, unknown> | undefined
  const model = o.fixture_meta?.model_v1 as { profile_constants?: Record<string, unknown> } | undefined
  const im = o.fixture_meta?.im_profile as { profile_constants?: Record<string, unknown> } | undefined
  return o.canonical.properties[field] ?? judged?.[field] ?? model?.profile_constants?.[field] ?? im?.profile_constants?.[field]
}

/**
 * 밖으로 보내는 웹훅 (GitHub 조직, 저장소 웹훅): 구독한 이벤트가 담긴 범위(저장소, 조직)의 내용이 웹훅 주소로 나간다.
 * 양방향 통로(direction both — Okta 인라인 훅, Slack 슬래시 명령 요청 주소)도 그 과정의 내용이 주소로 간다
 * (relation_semantics.yaml rules.outbound_hooks decided outbound_hooks.both_way)
 */
function buildOutboundHooks(ix: EdgeIndex): void {
  for (const o of ix.graph.objectsByKey.values()) {
    const p = o.canonical.properties
    const direction = judgedValue(o, 'direction')
    if ((direction !== 'out' && direction !== 'both') || p.active === false || !ix.has(o.fixture_key, 'Endpoint')) continue
    const scope = [...refValues(o, 'parent'), ...refValues(o, 'tenant')].find(k => ix.obj(k))
    if (!scope) continue
    const events = Array.isArray(p.events) ? p.events.join(', ') : ''
    ix.add({ kind: 'F', from: scope, to: o.fixture_key, refs: [{ type: 'reference', id: o.fixture_key }], label: `구독한 이벤트를 웹훅 주소로 보낸다${events ? ` (${events})` : ''}` })
  }
}

/**
 * 배포 설정이 정하는 호출자 (Apps Script 웹앱, 실행 API). 벤더가 적어 준 설정이라 확실한 간선이고, 접근 범위를 바꿔 끊을 수 있다(회수 가능).
 * DOMAIN → 테넌트 멤버, ANYONE/ANYONE_ANONYMOUS → 누구나, MYSELF → 주인. 버전 없는 배포(@HEAD 테스트 주소)는 편집자만 부르므로 뺀다
 */
function buildDeploymentEntries(ix: EdgeIndex): void {
  for (const o of ix.graph.objectsByKey.values()) {
    const deployments = o.canonical.properties.deployments
    if (!Array.isArray(deployments) || !ix.has(o.fixture_key, 'Automation')) continue
    const k = o.fixture_key
    const ref: EdgeRef = { type: 'reference', id: k }
    for (const d of deployments as Array<Record<string, unknown>>) {
      if (d.versionNumber === undefined || d.versionNumber === null) continue
      const access = String(d.access ?? '')
      const label = `배포 ${String(d.entryPointType ?? '')} 접근 ${access}`
      if (access === 'ANYONE' || access === 'ANYONE_ANONYMOUS') ix.add({ kind: 'T', from: EVERYONE, to: k, mode: 'invoke', revocable: true, refs: [ref], label: `${label} — 누구나 호출 가능` })
      else if (access === 'DOMAIN') {
        const tenant = tenantOf(ix, k)
        if (tenant) ix.add({ kind: 'T', from: tenant, to: k, mode: 'invoke', revocable: true, refs: [ref], label: `${label} — 조직 사용자 누구나 호출 가능` })
      } else if (access === 'MYSELF') {
        for (const rel of ix.graph.outgoingRelationsByObject.get(k) ?? []) {
          if (rel.relationType === 'owned_by' && ix.has(rel.targetKey, 'Principal')) ix.add({ kind: 'T', from: rel.targetKey, to: k, mode: 'invoke', revocable: true, refs: [ref, relRef(rel)], label: `${label} — 소유자만 호출 가능` })
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 증거·관측 → 연동 간선 (설계서 §2-1 T·A·F·E)
// ---------------------------------------------------------------------------

function buildEvidenceEdges(ix: EdgeIndex, evidence: EvidenceStore): void {
  const links = [...evidence.evidenceLinksById.values()]
  const requestedVia = new Map<string, string>()
  for (const l of links) if (l.evidenceType === 'requested_via' && l.from.kind === 'object' && l.to.kind === 'observation') requestedVia.set(l.to.id, l.from.id)

  const exists = (k: string | undefined): k is string => !!k && !!ix.obj(k)
  const obsRef = (o: EvidenceObservation): EdgeRef => ({ type: 'observation', id: o.id })
  const success = (o: EvidenceObservation) => o.attributes.result === undefined || o.attributes.result === 'success'

  /** 관측 하나의 행위자: 요청을 받은 엔드포인트 → 관측이 적은 자동화 → 실행 자체(가상 노드) */
  const actorOf = (o: EvidenceObservation): string => {
    const via = requestedVia.get(o.id)
    if (exists(via)) return via
    const auto = str(o.attributes.automation)
    if (exists(auto)) return auto
    if (o.kind === 'slash_request' || o.kind === 'request_log') {
      const ep = o.objectKeys.find(k => ix.has(k, 'Endpoint'))
      if (ep) return ep
    }
    return `${OBS_PREFIX}${o.id}`
  }

  const effects = new Map<string, Set<string>>() // actor → 효과 객체
  const addEffect = (actor: string, target: string, ref: EdgeRef, label = '실제 변경') => {
    if (!exists(target)) return
    ix.add({ kind: 'E', from: actor, to: target, observed: true, refs: [ref], label })
    const set = effects.get(actor) ?? new Set<string>()
    set.add(target)
    effects.set(actor, set)
  }
  const obsEffects = new Map<string, string[]>() // 관측 → 그 실행이 바꾼 객체
  const attributed = new Map<string, string[]>() // 효과 객체 → 그 이름으로 남은 주체
  const producedObjects: Array<[string, string, EdgeRef]> = []

  for (const l of links) {
    const ref: EdgeRef = { type: 'evidence', id: l.id }
    const fromObs = l.from.kind === 'observation' ? ix.observation(l.from.id) : undefined
    switch (l.evidenceType) {
      case 'context_used_by': {
        if (l.from.kind !== 'object' || !exists(l.from.id)) break
        const to = l.to.kind === 'observation' ? (ix.observation(l.to.id) ? actorOf(ix.observation(l.to.id)!) : undefined) : l.to.id
        if (!to || (!to.startsWith(OBS_PREFIX) && !exists(to))) break
        // 트리거 종류와 소유 관계로 추정한 입력(정규화가 basis inferred 로 남긴 것)은 불확실 간선이다
        const guessed = (l.attributes as { basis?: string } | undefined)?.basis === 'inferred' ? ['input_inferred'] : []
        ix.add({ kind: 'F', from: l.from.id, to, observed: true, uncertain: guessed, refs: [ref], label: guessed.length ? '입력으로 사용 추정' : '입력으로 사용됨' })
        ix.add({ kind: 'T', from: l.from.id, to, mode: 'input', observed: true, uncertain: guessed, refs: [ref], label: '입력자가 결과에 영향' })
        break
      }
      case 'delivered_to':
        if (l.from.kind === 'object' && l.to.kind === 'object' && exists(l.from.id) && exists(l.to.id)) {
          // 정규화가 이름·주인으로 추정한 전송(basis inferred, observations.ts same_name_same_owner)은 전송 기록이 아니다.
          // 옛 Access Gaps(accessGap.ts inferredEvidence, 2026-11-17 지움)처럼 구조상 흐름으로 두고 불확실 간선으로 센다
          const guessed = (l.attributes as { basis?: string } | undefined)?.basis === 'inferred'
          const uncertain = guessed ? ['flow_not_observed'] : []
          const label = guessed ? `보낸다고 추정했다 (${l.label})` : '전송 기록 있음'
          ix.add({ kind: 'A', from: l.from.id, to: l.to.id, observed: !guessed, uncertain, refs: [ref], label })
          ix.add({ kind: 'F', from: l.from.id, to: l.to.id, observed: !guessed, uncertain, refs: [ref], label })
        }
        break
      case 'produced':
      case 'correlates_by': {
        if (fromObs && l.to.kind === 'object') {
          const actor = actorOf(fromObs)
          addEffect(actor, l.to.id, ref)
          obsEffects.set(fromObs.id, [...(obsEffects.get(fromObs.id) ?? []), l.to.id])
          if (l.evidenceType === 'produced') {
            const delivery = fromObs.kind === 'delivery'
            ix.add({ kind: 'F', from: actor, to: l.to.id, observed: true, uncertain: delivery ? [] : ['derived_content_unverified'], refs: [ref], label: '결과물 생성' })
          }
        } else if (l.from.kind === 'object' && l.to.kind === 'object' && exists(l.from.id)) {
          producedObjects.push([l.from.id, l.to.id, ref])
          ix.add({ kind: 'F', from: l.from.id, to: l.to.id, observed: true, refs: [ref], label: '후속 생성' })
        } else if (l.from.kind === 'object' && l.to.kind === 'observation') {
          const o = ix.observation(l.to.id)
          const msg = str(o?.attributes.destination_message)
          if (o?.kind === 'delivery' && exists(msg) && exists(l.from.id)) ix.add({ kind: 'F', from: l.from.id, to: msg, observed: true, refs: [ref, obsRef(o)], label: '전송된 메시지' })
        }
        break
      }
      case 'attributed_as':
        if (l.from.kind === 'object' && l.to.kind === 'object' && exists(l.from.id) && exists(l.to.id)) {
          ix.add({ kind: 'G', from: l.to.id, to: l.from.id, rank: RANK.write, grantSource: 'observed', observed: true, refs: [ref], label: '이 주체 명의로 처리됨' })
          attributed.set(l.from.id, [...(attributed.get(l.from.id) ?? []), l.to.id])
        }
        break
      default:
        break
    }
  }

  const credentialUses: EvidenceObservation[] = []
  for (const o of evidence.observationsById.values()) {
    const a = o.attributes
    const ref = obsRef(o)
    // 거부된 요청: 행위자 권한은 쓰지 않았지만, 어느 채널에서 거부됐는지가 자동화의 호출 제한을 드러낸다
    if ((o.kind === 'slash_request' || o.kind === 'request_log') && !success(o)) {
      const endpoint = o.objectKeys.find(k => ix.has(k, 'Endpoint'))
      const reason = String(a.deny_reason ?? '')
      if (endpoint && /channel/i.test(reason)) {
        for (const ch of [str(a.request_channel), ...o.objectKeys].filter(exists)) {
          if (ix.type(ch) !== 'conversation') continue
          const set = ix.deniedChannels.get(endpoint) ?? new Set<string>()
          set.add(ch)
          ix.deniedChannels.set(endpoint, set)
        }
      }
      continue
    }
    if ((o.kind === 'slash_request' || o.kind === 'request_log') && success(o)) {
      const actor = actorOf(o)
      const requester = [str(a.requester_object), str(a.requester_slack_user)].find(exists)
      if (requester) ix.add({ kind: 'T', from: requester, to: actor, mode: 'invoke', observed: true, refs: [ref], label: '호출 요청 기록 있음' })
      const targets = [str(a.target_object), str(a.correlated_commit)].filter(exists)
      for (const t of targets) addEffect(actor, t, ref)
      const thisRun = [...new Set([...targets, ...(obsEffects.get(o.id) ?? [])])].filter(exists)
      for (const ch of [str(a.request_channel), str(a.request_channel_id), ...o.objectKeys].filter(exists)) {
        if (ix.type(ch) === 'conversation') {
          const set = ix.requestChannels.get(actor) ?? new Set<string>()
          set.add(ch)
          ix.requestChannels.set(actor, set)
        }
      }
      // 요청을 처리하며 다른 SaaS 에 기록된 자동화 주체 (예: Okta System Log 의 OAuth 클라이언트)
      const requesterProvider = requester ? ix.provider(requester) : undefined
      for (const k of o.objectKeys) {
        if (k === actor || !ix.has(k, 'Principal') || ix.isGroupLike(k) || principalKind(ix.obj(k)) !== 'service' || ix.provider(k) === requesterProvider) continue
        ix.add({ kind: 'A', from: actor, to: k, observed: true, refs: [ref], label: '이 자동화 주체로 처리된 기록 있음' })
        for (const t of thisRun) ix.add({ kind: 'G', from: k, to: t, rank: RANK.write, grantSource: 'observed', observed: true, refs: [ref], label: '이 주체 명의 쓰기 처리됨' })
      }
    } else if (o.kind === 'agent_run') {
      const actor = actorOf(o)
      // 실행을 시킨 사람: 에이전트 세션은 initiated_by_object, Apps Script 실행 기록은 caller(실행한 사용자)
      const initiator = str(a.initiated_by_object) ?? str(a.caller)
      if (exists(initiator)) ix.add({ kind: 'T', from: initiator, to: actor, mode: 'invoke', observed: true, refs: [ref], label: '실행 트리거' })
      const context = str(a.context_message_object)
      if (exists(context)) {
        ix.add({ kind: 'F', from: context, to: actor, observed: true, refs: [ref], label: '입력으로 사용됨' })
        ix.add({ kind: 'T', from: context, to: actor, mode: 'input', observed: true, refs: [ref], label: '입력자가 결과에 영향' })
      }
      for (const r of [str(a.result_pull_request), str(a.result_commit)].filter(exists)) {
        addEffect(actor, r, ref)
        ix.add({ kind: 'F', from: actor, to: r, observed: true, uncertain: ['derived_content_unverified'], refs: [ref], label: '결과물 생성' })
      }
    } else if (o.kind === 'delivery') {
      const x = str(a.automation) ?? o.objectKeys.find(k => ix.has(k, 'Automation'))
      if (!exists(x)) continue
      const withData: string[] = a.contains_source_data === false ? ['delivery_without_source_data'] : []
      const src = str(a.source_file)
      if (exists(src)) ix.add({ kind: 'F', from: src, to: x, observed: true, uncertain: withData, refs: [ref], label: '원본 읽기 후 전송 기록 있음' })
      const w = str(a.destination_endpoint)
      if (exists(w)) {
        ix.add({ kind: 'A', from: x, to: w, observed: true, refs: [ref], label: '전송 기록 있음' })
        ix.add({ kind: 'F', from: x, to: w, observed: true, uncertain: withData, refs: [ref], label: '전송 기록 있음' })
      }
      const msg = str(a.destination_message)
      if (exists(msg)) {
        if (exists(w)) ix.add({ kind: 'F', from: w, to: msg, observed: true, uncertain: withData, refs: [ref], label: '메시지로 게시됨' })
        addEffect(x, msg, ref, '메시지 게시')
      }
      const form = str(a.source_form)
      if (exists(form) && a.trigger === 'form_submit') ix.add({ kind: 'T', from: form, to: x, mode: 'input', observed: true, refs: [ref], label: '폼 제출로 실행 트리거' })
    } else if (o.kind === 'credential_use') {
      credentialUses.push(o)
      const owner = [str(a.credential_owner_object), str(a.native_github_actor)].find(exists)
      const grant = str(a.grant_object)
      const commits = Array.isArray(a.commits) ? a.commits.map(String) : []
      const resources = [...o.objectKeys.filter(k => ix.has(k, 'Resource')), ...commits].filter(exists)
      for (const r of new Set(resources)) {
        if (owner) ix.add({ kind: 'G', from: owner, to: r, rank: RANK.write, grantSource: 'observed', observed: true, refs: [ref], label: '자격증명 소유자 명의 쓰기 처리됨' })
        if (exists(grant)) ix.add({ kind: 'G', from: grant, to: r, rank: RANK.write, grantSource: 'observed', observed: true, refs: [ref], label: '자격증명으로 쓰기 처리됨' })
      }
    }
  }

  // 효과는 이어서 만들어진 객체로도 번진다 (PR → 커밋)
  for (const [from, to, ref] of producedObjects) {
    for (const [actor, set] of effects) if (set.has(from)) addEffect(actor, to, ref)
  }

  // 자격증명 사용 → 그 자격증명을 쓴 행위자 (확실히 이으면 행위자 → 주인 목록에 적어 둔다)
  const viaCredential = new Map<string, Set<string>>()
  for (const c of credentialUses) {
    const grant = str(c.attributes.grant_object)
    if (!exists(grant)) continue
    const owner = [str(c.attributes.credential_owner_object), str(c.attributes.native_github_actor)].find(exists)
    const listed = new Set([...c.objectKeys, ...(Array.isArray(c.attributes.commits) ? c.attributes.commits.map(String) : [])])
    const scopes = new Set(c.objectKeys.filter(k => ix.has(k, 'Resource')))
    for (const [actor, set] of effects) {
      for (const t of set) {
        if (listed.has(t)) {
          ix.add({ kind: 'A', from: actor, to: grant, observed: true, refs: [obsRef(c)], label: '이 자격증명으로 쓴 기록 있음' })
          if (owner) viaCredential.set(actor, new Set([...(viaCredential.get(actor) ?? []), owner]))
        } else if (owner && (attributed.get(t) ?? []).includes(owner) && parents(ix, t).some(p => scopes.has(p))) {
          ix.add({ kind: 'A', from: actor, to: grant, observed: true, uncertain: ['credential_link_by_scope'], refs: [obsRef(c)], label: '같은 소유자, 같은 범위의 자격증명 사용' })
        }
      }
    }
  }

  // 효과가 누구 이름으로 남았나 → 행위자가 그 주체로 동작했다.
  // 같은 효과를 그 주체의 자격증명으로 한 것이 확실하면(위) 주체 전체가 아니라 자격증명 권한만 쓴 것이라 주체로 잇지 않는다
  for (const [actor, set] of effects) {
    for (const t of set) {
      for (const p of attributed.get(t) ?? []) {
        if (viaCredential.get(actor)?.has(p)) continue
        ix.add({ kind: 'A', from: actor, to: p, observed: true, refs: [{ type: 'evidence', id: `attributed:${t}` }], label: '이 주체 명의로 결과 기록' })
      }
    }
  }
}

function parents(ix: EdgeIndex, key: string): string[] {
  const out: string[] = []
  let frontier = [key]
  for (let d = 0; d < 6 && frontier.length; d++) {
    const next: string[] = []
    for (const k of frontier) for (const e of ix.outOf(k, 'U')) if (!out.includes(e.to)) (out.push(e.to), next.push(e.to))
    frontier = next
  }
  return out
}

/** 엔드포인트가 속한 테넌트 (참조 tenant → 부모 앱의 registered_in·tenant·parent) */
function tenantOf(ix: EdgeIndex, key: string): string | undefined {
  const seen = new Set<string>()
  let frontier = [key]
  for (let d = 0; d < 5 && frontier.length; d++) {
    const next: string[] = []
    for (const k of frontier) {
      if (seen.has(k)) continue
      seen.add(k)
      const o = ix.obj(k)
      for (const t of [...refValues(o, 'tenant'), ...refValues(o, 'parent')]) {
        if (ix.isTenant(t)) return t
        next.push(t)
      }
      for (const rel of ix.graph.outgoingRelationsByObject.get(k) ?? []) {
        if (['registered_in', 'owned_by', 'contained_in'].includes(rel.relationType)) {
          if (ix.isTenant(rel.targetKey)) return rel.targetKey
          next.push(rel.targetKey)
        }
      }
    }
    frontier = next
  }
  return undefined
}

/** 정규화가 입구에 적은 코드 거름(properties.invoker_gate). 채널이 그래프에 없으면 없는 것으로 본다 */
function invokerGateOf(ix: EdgeIndex, o: FixtureObject): { channels: string[]; binding: string; worker: string; route: string } | undefined {
  const g = o.canonical.properties.invoker_gate as { kind?: string; basis?: string; channels?: unknown; via?: { binding?: string; object_key?: string; route?: string } } | undefined
  if (!g || g.kind !== 'channel_membership' || g.basis !== 'code' || !Array.isArray(g.channels)) return undefined
  const channels = g.channels.map(String).filter(ch => ix.type(ch) === 'conversation')
  if (!channels.length || channels.length !== g.channels.length) return undefined
  return { channels, binding: String(g.via?.binding ?? ''), worker: String(g.via?.object_key ?? ''), route: String(g.via?.route ?? '') }
}

function buildEntryPoints(ix: EdgeIndex, overrides?: EngineOverrides): void {
  for (const ep of ENTRY_POINTS) {
    for (const o of ix.graph.objectsByProvider.get(ep.provider) ?? []) {
      if (o.canonical.object_type.toLowerCase() !== ep.objectType) continue
      const k = o.fixture_key
      const channels = ix.requestChannels.get(k) ?? new Set<string>()
      const denied = ix.deniedChannels.get(k) ?? new Set<string>()
      // 코드로 아는 채널 제한: 정규화가 입구를 부르는 Worker 코드의 채널 거름을 읽어 invoker_gate 에 적었다(채널 객체까지 풀린 것만)
      const code = invokerGateOf(ix, o)
      // 관측으로 아는 채널 제한: 다른 채널의 요청이 「채널」 사유로 거부됐고, 거부된 채널과 성공한 채널이 겹치지 않는다
      const observedGate = !overrides?.entry_point_gates?.[k] && !code && channels.size > 0 && denied.size > 0 && [...denied].every(ch => !channels.has(ch))
      const gate = overrides?.entry_point_gates?.[k] ?? (code || observedGate ? 'channel_membership' : 'unknown')
      if (gate === 'channel_membership' && code && !overrides?.entry_point_gates?.[k]) {
        const label = `채널 멤버만 호출 가능, 코드가 요청 채널을 거름(${code.binding})`
        for (const ch of code.channels) ix.add({ kind: 'T', from: ch, to: k, mode: 'invoke', refs: [{ type: 'model', id: `invoker_gate:${code.worker}:${code.route}` }], label })
        continue
      }
      if (gate === 'channel_membership') {
        if (!channels.size) ix.warnings.push({ code: 'gate_without_channels', message: `${k}: channel_membership 게이트인데 관측된 요청 채널이 없다` })
        const ref = observedGate ? { type: 'observation' as const, id: `denied_requests:${k}` } : { type: 'override' as const, id: `entry_point_gates.${k}` }
        const label = observedGate ? `채널 멤버만 호출 가능, 다른 채널 요청 ${denied.size}곳 거부 기록` : '채널 멤버만 호출 가능 확인'
        for (const ch of channels) ix.add({ kind: 'T', from: ch, to: k, mode: 'invoke', observed: observedGate, refs: [ref], label })
        continue
      }
      const tenant = tenantOf(ix, k)
      if (!tenant) {
        ix.warnings.push({ code: 'entry_point_tenant', message: `${k}: 호출자를 셀 테넌트를 찾지 못했다` })
        continue
      }
      ix.add({
        kind: 'T', from: tenant, to: k, mode: 'invoke',
        uncertain: gate === 'none' ? [] : [ep.reason],
        refs: [gate === 'none' ? { type: 'override', id: `entry_point_gates.${k}` } : { type: 'model', id: `${ep.provider}.${ep.objectType}.invokers` }],
        label: gate === 'none' ? '테넌트 멤버 누구나 호출 가능 확인' : '테넌트 멤버 호출 가능성, 호출 제한 미확인',
      })
    }
  }
}

export type { TriggerMode }
