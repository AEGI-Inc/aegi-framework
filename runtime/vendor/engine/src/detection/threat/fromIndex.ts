// 실데이터 그래프(EdgeIndex)를 판정 그래프로 옮긴다 (docs/spec/AEGI_THREAT_JUDGMENT_V2.md 3, 5절)
//
// 노드 종류는 object 스키마 interface 로 정한다. 내용 객체는 Resource, 제어 객체는 Policy, Assignment, Integration, Endpoint.
// 조직 경계와 승인 목록은 입력으로 받는다. 입력이 없으면 수집한 테넌트의 계정은 조직 안, 「누구나」는 조직 밖으로 본다.
import { judgedValue, type EdgeIndex } from '../v2/engine/edges'
import { EVERYONE } from '../v2/engine/relationEffects'
import { ADMIN, SUBMIT_ONLY, WRITE, buildVocabulary, type VocabEdge } from './vocabulary'
import type { JudgeEdge, JudgeGraph, JudgeNode, Level } from './judge'
import type { HopRef } from './contract'
import { addVendorEdges } from './vendorEdges'
import { isCompletePersonTable, linkPairGrade, principalKind } from '../v2/identity'
import { automationActionReaches, automationHasScope, automationScopeReaches } from '../v2/engine/accessModel'
import { edgeTenantReach, objectClass } from '../v2/engine/directAccess'
import { needOf, underCeiling } from '../v2/engine/semantic/ceiling'
import type { Edge } from '../v2/engine/types'

export interface ThreatInputs {
  /** 조직 밖 계정(게스트 등) */
  outside?: Set<string>
  /** 조직 안 밖을 모르는 계정 */
  unknown?: Set<string>
  /** 승인 목록에 있는 조직 밖 계정과 출처 */
  approved?: Map<string, 'customer' | 'saas' | 'both'>
  /** 공개 의도로 등록한 대상 */
  publicByDesign?: Set<string>
}

const CONTROL = ['Policy', 'Assignment', 'Integration', 'Endpoint']

/**
 * 실물(개인 키)이 SaaS 밖에 있는 자격증명 종류(Profile 상수 credential_kind). SaaS 에는 공개 부분만 있어 담긴 자원을 읽어도 꺼내지 못한다.
 * 배포 키: 「the private part of the key remains on your server」 https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys
 * 인증서: 개인 키는 상대가 가진다(relation_semantics.yaml owned_by.public_certificate)
 */
const HELD_ELSEWHERE: ReadonlySet<string> = new Set(['ssh_key', 'key_pair', 'certificate'])

function nodeOf(ix: EdgeIndex, key: string, inputs: ThreatInputs): JudgeNode {
  if (key === EVERYONE) return { kind: 'person', org: 'out', multi: 2 }
  if (ix.isTenant(key)) return { kind: 'tenant' }
  if (ix.isPerson(key)) {
    const org = inputs.outside?.has(key) ? 'out' : inputs.unknown?.has(key) ? 'unknown' : 'in'
    const approved = inputs.approved?.get(key)
    return { kind: 'person', org, ...(approved ? { approved } : {}) }
  }
  if (ix.isGroupLike(key)) return { kind: 'group' }
  if (ix.has(key, 'Automation')) return { kind: 'auto' }
  if (ix.has(key, 'Credential')) {
    const o = ix.obj(key)
    const kind = o ? judgedValue(o, 'credential_kind') : undefined
    return { kind: 'identity', credential: true, ...(typeof kind === 'string' && HELD_ELSEWHERE.has(kind) ? { heldElsewhere: true } : {}) }
  }
  if (ix.has(key, 'Principal')) return { kind: 'identity' }
  if (ix.has(key, 'Resource')) return { kind: 'res', cls: 'content', ...(inputs.publicByDesign?.has(key) ? { public_by_design: true } : {}) }
  if (CONTROL.some(i => ix.has(key, i))) return { kind: 'res', cls: 'control' }
  return { kind: 'identity' }
}

function levelOf(e: VocabEdge): Level | undefined {
  if (e.postOnly) return 'post'
  if (e.level & ADMIN) return 'admin'
  if (e.level & WRITE) return 'write'
  if (e.level) return 'read'
  return undefined
}

/** 권한 간선이 직접 권한 규칙에 넘기는 것(directAccess.ts edgeIndexSource 와 같은 값) */
function grantFields(ix: EdgeIndex, e: Edge): Partial<JudgeEdge> {
  // 폼 응답자 모름은 누구나 게시 간선으로 이미 옮겼다(판정 어휘 게시 전용)
  const unsure = e.uncertain.filter(r => !SUBMIT_ONLY.has(r.split(':')[0]))
  return {
    ...(e.roleKey ? { roleKey: e.roleKey } : {}),
    ...(ix.isTenant(e.to) ? { reach: edgeTenantReach(ix, e) } : {}),
    known: e.caps !== undefined || e.rank !== undefined,
    ...(unsure.length ? { grantUnsure: unsure } : {}),
    source: e.grantSource === 'observed' ? 'log' : e.grantSource === 'model' ? 'model' : e.grantSource === 'author' ? 'author' : 'config',
  }
}

/** 간선 근거(관계, 연결, 관측, 증거 등). 명세 3절 출처 */
const relRefs = (e: VocabEdge): HopRef[] => e.refs.map(r => ({ type: r.type, id: r.id }))
/** 벤더가 적어 준 부여(basis stated, decomposable 이 false 아님). 엔진 edges.ts isStatedRevocable 과 같은 기준 */
const statedRevocable = (rel?: { properties?: { basis?: string; decomposable?: unknown } }) => rel?.properties?.basis === 'stated' && rel.properties.decomposable !== false
/** 같은 근거는 한 번만 */
const uniqRefs = (rs: HopRef[]): HopRef[] => [...new Map(rs.map(r => [`${r.type}\u0000${r.id}`, r])).values()]

/** 간선 목록을 따라 한 걸음 이상 닿는 노드. block 은 닿아도 더 넘어가지 않는다 */
function reach(from: string, adj: Map<string, VocabEdge[]>, end: (e: VocabEdge) => string, block?: string): Set<string> {
  const seen = new Set<string>()
  const st = [from]
  while (st.length) {
    for (const e of adj.get(st.pop()!) ?? []) {
      const x = end(e)
      if (seen.has(x)) continue
      seen.add(x)
      if (x !== block) st.push(x)
    }
  }
  return seen
}

/** 실행 신원 간선을 이어 붙인다. 자동화, 자격, 계정으로 이어지는 사슬을 자동화에서 각 신원으로 한 걸음씩.
 * 근거는 출발에서 그 신원까지 가는 모든 사슬의 간선을 합친다. 사슬은 출발로 되돌아오지 않고 그 신원을 지나쳐 가지 않는다.
 * 간선 u>v 는 u 가 출발이거나 그 신원을 거치지 않고 출발에서 닿고, v 가 그 신원이거나 출발을 거치지 않고 그 신원에 닿을 때 어느 사슬 위에 있다.
 * 출발로 되돌아오는 고리(출발이 곧 그 신원)와 사슬 중간의 고리는 고리 위 간선도 합친다.
 * unsure: 확실한 간선만으로는 그 신원에 못 닿을 때, 사슬 위 불확실 간선의 사유(약한 자동화 연결 등)
 */
export function runAsTargets(vocab: VocabEdge[]): Map<string, Map<string, RunAsChain>> {
  const next = new Map<string, VocabEdge[]>()
  const prev = new Map<string, VocabEdge[]>()
  const sureNext = new Map<string, VocabEdge[]>()
  for (const e of vocab) {
    if (e.name !== '실행 신원') continue
    next.set(e.from, [...(next.get(e.from) ?? []), e])
    prev.set(e.to, [...(prev.get(e.to) ?? []), e])
    if (e.certain) sureNext.set(e.from, [...(sureNext.get(e.from) ?? []), e])
  }
  const out = new Map<string, Map<string, RunAsChain>>()
  for (const start of next.keys()) {
    const seen = new Map<string, RunAsChain>()
    const sure = reach(start, sureNext, e => e.to)
    for (const t of reach(start, next, e => e.to)) {
      const loop = t === start
      const fwd = reach(start, next, e => e.to, loop ? undefined : t)
      const into = reach(t, prev, e => e.from, loop ? undefined : start)
      const on = (e: VocabEdge) => (e.from === start || fwd.has(e.from)) && (e.to === t || into.has(e.to)) && (loop || (e.from !== t && e.to !== start))
      const chain = [...new Set([start, ...fwd])].flatMap(x => next.get(x) ?? []).filter(on)
      const unsure = sure.has(t) ? [] : [...new Set(chain.flatMap(e => e.reasons))].sort()
      seen.set(t, { refs: uniqRefs(chain.flatMap(relRefs)), ...(unsure.length ? { unsure } : {}) })
    }
    out.set(start, seen)
  }
  return out
}

/** 이어 붙인 실행 신원 사슬 하나. refs: 모든 사슬의 근거. unsure: 확실한 사슬이 없을 때 불확실 사유 */
export interface RunAsChain {
  refs: HopRef[]
  unsure?: string[]
}

/**
 * 출발에서 그 신원까지 가는 사슬이 모두 회수 가능한 간선을 하나 이상 지나는지. 그러면 그 간선 하나를 회수해 이 실행 신원 간선이 사라진다.
 * 회수 가능한 간선을 지우고도 출발에서 그 신원에 닿으면 회수로 못 끊는다
 */
export function runAsRevocable(vocab: VocabEdge[]): (from: string, to: string) => boolean {
  const next = new Map<string, VocabEdge[]>()
  for (const e of vocab) if (e.name === '실행 신원' && !e.revocable) next.set(e.from, [...(next.get(e.from) ?? []), e])
  const memo = new Map<string, Set<string>>()
  return (from, to) => {
    let r = memo.get(from)
    if (!r) { r = reach(from, next, e => e.to); memo.set(from, r) }
    return !r.has(to)
  }
}

export function judgeGraphFromIndex(ix: EdgeIndex, inputs: ThreatInputs = {}): JudgeGraph {
  const vocab = buildVocabulary(ix)
  const g: JudgeGraph = { nodes: {}, edges: [] }
  const touch = (k: string) => {
    if (g.nodes[k]) return
    const type = ix.type(k)
    const provider = ix.provider(k)
    const dclass = ix.obj(k) ? objectClass(ix, k) ?? 'none' : undefined
    g.nodes[k] = { ...nodeOf(ix, k, inputs), ...(type ? { type } : {}), ...(provider ? { provider } : {}), ...(dclass ? { dclass } : {}) }
  }
  const runAs = runAsTargets(vocab)
  const runAsCut = runAsRevocable(vocab)
  const runAsDone = new Set<string>()
  const add = (e: JudgeEdge) => { touch(e.from); touch(e.to); g.edges.push(e) }
  for (const e of vocab) {
    const level = levelOf(e)
    if (e.name === '실행 신원') {
      for (const [to, { refs, unsure }] of runAs.get(e.from) ?? []) {
        const k = `${e.from}>${to}`
        if (runAsDone.has(k)) continue
        runAsDone.add(k)
        add({ kind: '실행 신원', from: e.from, to, ...(refs.length ? { refs } : {}), ...(runAsCut(e.from, to) ? { revocable: true } : {}), ...(unsure ? { chainUnsure: unsure } : {}) })
      }
      continue
    }
    // 자원 안에 든 자격증명의 범위 간선은 담은 관계를 회수하면(자격증명을 빼면) 끊긴다. 관계가 벤더가 적어 준 부여일 때만
    const held = e.name === '범위' && ix.has(e.from, 'Credential') && e.refs.some(r => r.type === 'relation' && statedRevocable(ix.graph.relationsByKey.get(r.id)))
    add({ kind: e.name, from: e.from, to: e.to, id: e.id, ...(level ? { level } : {}), ...(e.appliesTo ? { appliesTo: e.appliesTo } : {}),
      ...(e.allowedCallers === 'unknown' ? { uncertain: e.reasons } : {}), ...(relRefs(e).length ? { refs: relRefs(e) } : {}), ...(e.revocable || held ? { revocable: true } : {}),
      ...(e.name === '권한' ? grantFields(ix, ix.edges.get(e.id)!) : {}), ...(e.name === '데이터 흐름' && ix.edges.get(e.id)?.observed ? { observed: true as const } : {}) })
  }
  // 묻는 능력(의미 층 켬 여부는 환경 변수)은 판정 그래프를 만들 때 한 번 정한다. 권한 간선과 대상마다 부르는 훅이라
  // 환경 변수를 매번 읽으면 다시 판정이 많은 차단 지점 확인에서 느리다(Windows 에서 process.env 읽기가 비싸다)
  const need = { read: needOf('read'), write: needOf('write'), admin: needOf('admin') }
  g.direct = {
    grantAt: (je, x, lv, limit) => {
      const e = je.id ? ix.edges.get(je.id) : undefined
      return e ? underCeiling(ix, ix.ceilings, e, x, undefined, need[lv], limit) : null
    },
    tenantAccount: k => ix.has(k, 'Principal') && !ix.isGroupLike(k),
    roleExcluded: (role, m) => !!role && !!ix.roleExcludes.get(role)?.has(m),
  }
  for (const k of ix.graph.objectsByKey.keys()) touch(k)
  // 호출받거나 실행 신원으로 도는 객체는 자동화로 판정한다(Slack 앱, Apps Script 프로젝트 등).
  // 벤더 표가 이미 있는 흐름을 알아보도록 표 앞에서 한 번, 표가 더한 간선에 한 번 더
  const promote = () => {
    for (const e of g.edges) {
      if (e.kind === '실행 신원' && g.nodes[e.from].kind === 'res') g.nodes[e.from] = { ...g.nodes[e.from], kind: 'auto', cls: undefined }
      if (e.kind === '호출' && g.nodes[e.to].kind === 'res') g.nodes[e.to] = { ...g.nodes[e.to], kind: 'auto', cls: undefined }
    }
  }
  promote()
  addVendorEdges(ix.graph, g)
  promote()
  // 자동화가 직접 가진 권한은 자동화 자신이 고정 실행 신원이다(엔드포인트, 웹훅이 받는 게시 권한 등)
  for (const k of Object.keys(g.nodes)) {
    if (g.nodes[k].kind !== 'auto') continue
    if (!g.edges.some(e => e.kind === '권한' && e.from === k)) continue
    if (g.edges.some(e => e.kind === '실행 신원' && e.from === k && e.to === k)) continue
    g.edges.push({ kind: '실행 신원', from: k, to: k })
  }
  addRuleScopes(ix, g)
  addSamePerson(ix, g, inputs)
  return g
}

/**
 * 범위가 수집된 자동화 규칙(Jira 자동화)의 실행 신원 간선에 닿을 수 있는 대상을 단다(2026-11-15 결정, 명세 5절 규칙 9).
 * 범위 뜻은 사전 automation_scopes 한 곳이고, EA(접근 규칙 automation_scope 홉)와 같은 함수를 읽는다(2026-11-17 aegi-knowledge#311).
 *   편집자: 규칙에 관리 수준이 있는 사람만. Jira 규칙은 Administer Jira 또는 범위 프로젝트 관리자가 고친다.
 *     제품 접근 그룹이 사이트에서 받은 쓰기는 규칙을 고치는 권한이 아니다
 *     (https://support.atlassian.com/cloud-automation/docs/permissions-required-for-jira-cloud-automation-rules/)
 *     닿는 곳은 범위 안(automationScopeReaches): Jira 객체는 범위 프로젝트와 그 아래만. 규칙을 고쳐도 범위 밖(그룹, 다른 프로젝트)은 못 바꾼다.
 *     같은 SaaS 의 다른 제품(Confluence)은 내용 객체만(사전 other_product_interface), 다른 SaaS 대상은 범위가 자르지 않는다.
 *     범위는 규칙이 도는 프로젝트를 정하고, 프로젝트 범위 규칙도 Confluence 동작의 대상 space 를 고른다(https://jira.atlassian.com/browse/AUTO-2415)
 *   호출자: 그중 규칙 동작이 바꿀 수 있는 것(automationActionReaches. 밖으로만 보내는 동작은 같은 SaaS 객체를 못 바꾼다)
 * 추적성 상실은 거르지 않는다(judge.ts callerScope 설명)
 */
export function addRuleScopes(ix: Pick<EdgeIndex, 'obj' | 'graph'>, g: JudgeGraph): void {
  const rules = g.edges.filter(e => e.kind === '실행 신원' && e.from !== e.to && automationHasScope(ix.obj(e.from)))
  if (!rules.length) return
  const keys = Object.keys(g.nodes).filter(k => ix.obj(k))
  for (const e of rules) {
    const editScope = keys.filter(t => automationScopeReaches(ix.graph, e.from, t))
    e.editScope = editScope
    e.editLevel = 'admin'
    e.callerScope = editScope.filter(t => automationActionReaches(ix.graph, e.from, t))
  }
}

/** 같은 사람 계정(Link). 단단한 연결은 same(직접 접근을 합침), 약한 연결은 weak(합쳐서 사라지면 미확정). 명세 4절 */
function addSamePerson(ix: EdgeIndex, g: JudgeGraph, inputs: ThreatInputs): void {
  const same = new Map<string, Set<string>>()
  const weak = new Map<string, Set<string>>()
  const put = (m: Map<string, Set<string>>, a: string, b: string) => { if (!m.has(a)) m.set(a, new Set()); m.get(a)!.add(b) }
  for (const link of ix.graph.linksById.values()) {
    // 같은 사람 연결로 사람 계정과 이어진 계정은 사람 계정이다(수집이 Principal 표시를 못 단 계정 포함).
    // 서비스 계정, 측정 계정, 연결 근거가 없거나 다른 사람으로 본 계정은 올리지 않는다(명세 13). 조직 경계는 입력을 따른다
    const members = link.set.map(m => m.object_key).filter(k => g.nodes[k])
    const people = members.filter(k => g.nodes[k].kind === 'person')
    for (const k of members) {
      if (g.nodes[k].kind !== 'identity' || !people.length) continue
      const obj = ix.graph.objectsByKey.get(k)
      if (obj?.fixture_meta?.demo_role === 'measurement_principal' || principalKind(obj) === 'service') continue
      if (!people.some(q => linkPairGrade(link, k, q) !== null)) continue
      const org = inputs.outside?.has(k) ? 'out' : inputs.unknown?.has(k) ? 'unknown' : 'in'
      g.nodes[k] = { ...g.nodes[k], kind: 'person', org }
    }
    const keys = members.filter(k => g.nodes[k]?.kind === 'person')
    for (const a of keys) for (const b of keys) {
      if (a === b) continue
      const grade = linkPairGrade(link, a, b)
      if (grade === 'strong') put(same, a, b)
      else if (grade === 'weak') put(weak, a, b)
    }
  }
  for (const [k, v] of same) g.nodes[k] = { ...g.nodes[k], same: [...v].sort() }
  // 허브 계정: 정규화가 만든 사람 Link(deterministic_rule)는 set 의 첫 계정이 그 Link 를 시작한 허브 계정이다
  // (scripts/collect/shared/crosswalk.ts writePersonLinks). 주소 허브(meta.hub address)는 계정이 아니라 주소가 기준이라 허브 계정이 없다
  for (const link of ix.graph.linksById.values()) {
    if (link.source?.method !== 'deterministic_rule' || (link.meta as { hub?: string } | undefined)?.hub === 'address') continue
    const h = link.set[0]?.object_key
    if (h && g.nodes[h]?.kind === 'person' && same.has(h)) g.nodes[h] = { ...g.nodes[h], hub: true }
  }
  for (const [k, v] of weak) {
    const w = [...v].filter(x => !same.get(k)?.has(x)).sort()
    if (w.length) g.nodes[k] = { ...g.nodes[k], weak: w }
  }
  // 사람 표가 완결(사람이 쓴 표, 합성)이 아니면 연결이 없는 것은 「다른 사람」이 아니라 「모름」이다. 판정이 미확정으로 가르게 표시한다.
  // 같은 SaaS 의 다른 계정이 연결됐으면(matched) 맞추기는 되는데 이 계정만 안 맞은 것이고, 아무도 연결 안 됐으면(open) 맞출 길이 없던 것이다
  if (isCompletePersonTable(ix.graph)) return
  const matched = new Set(Object.values(g.nodes).filter(n => n.kind === 'person' && (n.same || n.weak)).map(n => n.provider))
  for (const [k, n] of Object.entries(g.nodes)) {
    if (n.kind === 'person' && !n.multi && !n.same && !n.weak) g.nodes[k] = { ...n, nolink: matched.has(n.provider) ? 'matched' : 'open' }
  }
}
