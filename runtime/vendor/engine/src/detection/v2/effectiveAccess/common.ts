/**
 * Effective Access 규칙이 같이 쓰는 것 — via 항목 만들기, 동일성 키, 집행 표, 등급.
 * 규칙은 관계와 Link 만 읽는다. EA 행을 입력으로 쓰지 않는다 (두 행을 이어 세 번째 행을 만들지 않는다).
 */
import type { GraphStoreV2 } from '../../../model/graph'
import type { IdentityLink } from '../../../model/link'
import type { ResolvedRelation } from '../../../model/relation'
import type { EaCut, EaLevel, EaLinkVia, EaRelationVia, EaRuleId, EaUndecomposed, EaVia, EffectiveAccessRow } from './types'
import { isGroupPrincipal } from '../audience'
import { isMeasurementMembership, levelGrade } from '../identity'

/**
 * 이 규칙 판. 규칙 의미가 바뀌면 올린다 — 올리면 이전 파일의 행은 낡은 것이 된다.
 * 2: runs_as_inherits 둘째 홉을 접근 등급에서 G 간선으로 (aegi-knowledge Effective_Access_Schema_v1 「첫 규칙」)
 * 3: 동일인 경로의 약한 간선은 하나까지, 그 경로를 지난 긍정 행은 indeterminate 로 (같은 명세 「단계」)
 * 4: 역할 홉의 조건 갈래(제외된 역할, 지운 배정)를 그룹 규칙과 대리 실행에도, 사본 노출의 읽는 길은 G 간선으로 (access_rules.yaml)
 */
export const EA_VIEW_VERSION = 4

export interface AccessHop {
  /** 둘째 홉 관계. owned_by 는 자원 → 주체로 들어오는 관계다 */
  rel: ResolvedRelation
  /** 주체가 닿는 객체 */
  resource: string
}

/**
 * 주체에서 나가는 G(권한) 간선을 만드는 관계 — runs_as_inherits 의 둘째 홉.
 * aegi-knowledge relation_semantics.yaml effects 를 따르고, 범용 접근 엔진 edges.ts buildEdges 와 같은 판단이다.
 * 화면용 접근 등급(grades)을 쓰지 않는다: 그룹, 테넌트로 가는 member_of 는 소속(M), 앱으로 가는 owned_by 는 대행(A)이다.
 *  - has_role_on  주체 → 대상. 역할이 주체를 excludes 로 뺐거나 지운 배정을 거친 것은 G 가 없다
 *  - member_of    주체 → 자원. 그룹, 테넌트로 가는 것은 소속이라 뺀다
 *  - owned_by     자원 → 주체로 들어온다(effects 의 Resource>Principal). G 는 주인에서 자원으로 난다.
 *                 같은 자원에 has_role_on 이 이미 있으면 같은 벤더 사실(GWS 파일 소유자 역할)이라 한 번만 센다
 * 측정 계정과 측정용 관계는 보지 않는다(edges.ts 와 같다). 끝 객체가 그래프에 없는 관계도 뺀다.
 * 저장된 관계만 via 에 들어가므로, 관계가 아닌 G(권한 배정 객체의 grantee, 참조 owner, author)는 여기 없다.
 * effects 가 정하지 않은 shared_with Resource>Principal 도 없다.
 */
export function accessHops(principal: string, graph: GraphStoreV2): AccessHop[] {
  if (isMeasurementAccount(principal, graph)) return []
  const hops: AccessHop[] = []
  const has = (key: string, iface: string) => !!graph.objectsByKey.get(key)?.canonical.interfaces.includes(iface as never)
  for (const rel of graph.outgoingRelationsByObject.get(principal) ?? []) {
    if (isMeasurementMembership(rel) || !graph.objectsByKey.has(rel.targetKey)) continue
    if (rel.relationType === 'has_role_on' && grantHolds(rel, principal, graph)) hops.push({ rel, resource: rel.targetKey })
    if (rel.relationType === 'member_of' && !has(rel.targetKey, 'Tenant') && !isGroupPrincipal(rel.targetKey, graph)) hops.push({ rel, resource: rel.targetKey })
  }
  const byRole = new Set(hops.filter(h => h.rel.relationType === 'has_role_on').map(h => h.resource))
  for (const rel of graph.incomingRelationsByObject.get(principal) ?? []) {
    if (rel.relationType !== 'owned_by' || isMeasurementMembership(rel)) continue
    const s = rel.sourceKey
    if (!has(s, 'Resource') || has(s, 'Endpoint') || has(s, 'Credential') || has(s, 'Automation') || byRole.has(s)) continue
    hops.push({ rel, resource: s })
  }
  return hops
}

/** 역할 객체가 이 주체를 excludes 로 빼는가 */
export function roleExcludes(role: string | undefined, who: string, graph: GraphStoreV2): boolean {
  return !!role && (graph.outgoingRelationsByObject.get(role) ?? []).some(r => r.relationType === 'excludes' && r.targetKey === who)
}

/** 지운 권한 배정(via_assignment 객체가 deleted)을 거친 관계인가 */
export function isDeletedAssignment(rel: ResolvedRelation, graph: GraphStoreV2): boolean {
  const via = rel.properties.via_assignment
  return typeof via === 'string' && graph.objectsByKey.get(via)?.canonical.properties.deleted === true
}

/**
 * has_role_on 이 받는 쪽(그룹을 거치면 그룹과 사람 둘 다)에게 권한을 주는가. relation_semantics.yaml has_role_on 의 조건 갈래
 * excluded(역할이 받는 쪽을 뺌), deleted_assignment(지운 배정)를 따른다 (aegi-knowledge Path_Rule_Schema_v1 공통 규칙 「조건 갈래」)
 */
export function grantHolds(rel: ResolvedRelation, holders: string | string[], graph: GraphStoreV2): boolean {
  if (isDeletedAssignment(rel, graph)) return false
  return !(Array.isArray(holders) ? holders : [holders]).some(who => roleExcludes(rel.roleKey, who, graph))
}

export function providerOf(key: string, graph: GraphStoreV2): string | undefined {
  return graph.objectsByKey.get(key)?.canonical.provider
}

export function nameOf(key: string, graph: GraphStoreV2): string {
  const obj = graph.objectsByKey.get(key)
  return String(obj?.fixture_meta?.display_name ?? obj?.canonical.properties.name ?? key)
}

export function relationVia(rel: ResolvedRelation, graph: GraphStoreV2): EaRelationVia {
  const cross = rel.properties.cross_provider === true || providerOf(rel.sourceKey, graph) !== providerOf(rel.targetKey, graph)
  return {
    kind: 'relation',
    ref: rel.relationKey,
    relation_type: rel.relationType,
    source: rel.sourceKey,
    target: rel.targetKey,
    ...(rel.roleKey || rel.roleName ? { role: rel.roleKey ?? rel.roleName } : {}),
    basis: rel.properties.basis,
    ...(cross ? { x_cross_provider: true as const } : {}),
  }
}

interface RawEdge {
  a: string
  b: string
  level: IdentityLink['level']
  rule?: string
  shared_mailbox_suspected?: boolean
}

/** 링크 간선이 강한 근거인가. 공용 주소 의심 간선은 단계가 강해도 약하다(판정 identity.ts linkPairGrade 와 같은 기준) */
const strongEdge = (e: RawEdge) => levelGrade(e.level) === 'strong' && !e.shared_mailbox_suspected
/** EA via 의 동일인 간선이 강한가(suspected 는 약함) */
export const viaStrong = (v: EaLinkVia) => levelGrade(v.level) === 'strong' && !v.suspected

function edgesOf(link: IdentityLink): RawEdge[] {
  const raw = link.meta?.edges
  if (!Array.isArray(raw)) return []
  return raw.filter((e): e is RawEdge => !!e && typeof e.a === 'string' && typeof e.b === 'string' && typeof e.level === 'string' && e.level !== 'different')
}

/**
 * 간선을 적은 링크(실측 v2)인가. 적은 간선이 전부 different 거나 모양이 틀려(배열이 아님, 원소가 틀림) 쓸 간선이 없어도
 * v1·합성처럼 집합으로 잇지 않는다. 칸이 없거나 빈 배열이면 간선을 적지 않은 링크다
 */
function recordsEdges(link: IdentityLink): boolean {
  const raw = link.meta?.edges
  return raw !== undefined && raw !== null && !(Array.isArray(raw) && raw.length === 0)
}

/**
 * 한 링크 안에서 두 계정을 잇는 간선들 (허브를 거치면 둘 이상). 간선이 없는 링크(v1·합성)는 집합 자체를 간선 하나로 적는다.
 * 간선을 적었는데 쓸 간선이 없으면(전부 different) 잇지 않는다.
 * 경로의 단계는 가장 약한 간선이고, 약한 간선은 하나까지만 쓴다 (aegi-knowledge Link_Schema_v3 「두 계정 사이의 단계」).
 * strong 간선만으로 된 경로가 먼저다. 없으면 약한 간선 하나를 가운데 두고 양쪽을 strong 간선으로 잇는 가장 짧은 경로.
 * 약한 간선 둘 이상을 거쳐야 하면 잇지 않는다(10-29 결정 C2, 막힌 쌍 수는 linkPairCounts). 약한 간선을 지난 행의 단계는 부르는 쪽이 weakLinkUndecomposed 로 내린다.
 * 이을 수 없으면 빈 배열.
 */
export function linkVias(link: IdentityLink, from: string, to: string): EaLinkVia[] {
  if (from === to) return []
  const edges = edgesOf(link)
  if (!edges.length) {
    const members = new Set(link.set.map(m => m.object_key))
    if (recordsEdges(link) || !members.has(from) || !members.has(to) || link.level === 'different') return []
    return [{ kind: 'link', ref: link.link_id, a: from, b: to, level: link.level, rule: link.source?.method ?? 'unknown' }]
  }
  const toVia = (e: RawEdge): EaLinkVia => ({ kind: 'link', ref: link.link_id, a: e.a, b: e.b, level: e.level, rule: e.rule ?? link.source?.method ?? 'unknown', ...(e.shared_mailbox_suspected ? { suspected: true as const } : {}) })
  const strongEdges = edges.filter(strongEdge)
  const strong = shortestPath(strongEdges, from, to)
  if (strong) return strong.map(toVia)
  const strongPath = (x: string, y: string) => (x === y ? [] : shortestPath(strongEdges, x, y))
  let best: RawEdge[] | undefined
  for (const weak of edges) {
    if (strongEdge(weak)) continue
    for (const [x, y] of [[weak.a, weak.b], [weak.b, weak.a]] as Array<[string, string]>) {
      const head = strongPath(from, x)
      const tail = strongPath(y, to)
      if (head && tail && (!best || head.length + 1 + tail.length < best.length)) best = [...head, weak, ...tail]
    }
  }
  return best ? best.map(toVia) : []
}

/** 링크 안 계정 쌍을 linkVias 로 나눈 수. 키와 이름은 없고 막힌 쌍의 SaaS 짝만 있다 */
export interface LinkPairCounts {
  links: number
  pairs: number
  /** strong 간선만으로 이어진다 */
  strong: number
  /** 약한 간선 하나를 지나 이어진다 (그 경로를 지난 긍정 행은 indeterminate) */
  one_weak: number
  /** 간선으로는 이어지는데 약한 간선 둘 이상을 거쳐야 해서 linkVias 가 잇지 않는다 */
  blocked: number
  /** 간선으로도 이어지지 않는다 */
  unconnected: number
  /** 막힌 쌍의 SaaS 짝 (provider-provider, 문자 코드순) */
  blocked_by_providers: Record<string, number>
}

/**
 * 링크 안 계정 쌍마다 linkVias 가 어떻게 잇는지 센다. 약한 간선 둘 이상을 거치는 쌍은 막는다(Relation 담당 10-29 결정 C2,
 * aegi-knowledge#106 이 Link_Schema_v3 「정한 것」에 적는다). 그 결정의 다시 볼 조건이 blocked 다 — 0 이 아니면 다시 본다.
 * 정규화 실행 보고서(runner-report.json identity_link_pairs)가 이 수를 남긴다.
 * 사람 링크와 자동화 링크를 센다. 그룹 링크와 different 링크는 같은 주체 묶음이 아니라 세지 않는다(identityVias 와 같다).
 * 링크마다 센다. 두 계정이 링크 둘에 같이 있으면 두 번 세고, 한 링크에서 막혀도 identityVias 는 다른 링크로 이을 수 있다
 * (crosswalk 링크는 허브 하나에 계정이 붙는 모양이라 한 계정이 허브 둘에 걸릴 때만 생긴다).
 */
export function linkPairCounts(links: IdentityLink[]): LinkPairCounts {
  const out: LinkPairCounts = { links: 0, pairs: 0, strong: 0, one_weak: 0, blocked: 0, unconnected: 0, blocked_by_providers: {} }
  const byProviders = new Map<string, number>()
  for (const link of links) {
    if (link.level === 'different' || link.meta?.kind === 'group') continue
    out.links += 1
    const members = [...new Map(link.set.map(m => [m.object_key, m.provider])).entries()]
    const edges = edgesOf(link)
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const [a, pa] = members[i]
        const [b, pb] = members[j]
        out.pairs += 1
        const vias = linkVias(link, a, b)
        if (vias.length) {
          if (vias.some(v => !viaStrong(v))) out.one_weak += 1
          else out.strong += 1
        } else if (edges.length && shortestPath(edges, a, b)) {
          out.blocked += 1
          const key = [pa, pb].sort().join('-')
          byProviders.set(key, (byProviders.get(key) ?? 0) + 1)
        } else out.unconnected += 1
      }
    }
  }
  for (const key of [...byProviders.keys()].sort()) out.blocked_by_providers[key] = byProviders.get(key)!
  return out
}

/** 너비 우선으로 가장 짧은 경로의 간선들. 없으면 undefined */
function shortestPath(edges: RawEdge[], from: string, to: string): RawEdge[] | undefined {
  const prev = new Map<string, { node: string; edge: RawEdge }>()
  const seen = new Set([from])
  const queue = [from]
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === to) break
    for (const e of edges) {
      const next = e.a === cur ? e.b : e.b === cur ? e.a : undefined
      if (!next || seen.has(next)) continue
      seen.add(next)
      prev.set(next, { node: cur, edge: e })
      queue.push(next)
    }
  }
  if (!prev.has(to)) return undefined
  const path: RawEdge[] = []
  for (let cur = to; cur !== from; ) {
    const step = prev.get(cur)!
    path.unshift(step.edge)
    cur = step.node
  }
  return path
}

/**
 * via 의 약한 동일인 간선마다 못 푼 구간 하나. 이게 있는 긍정 행은 indeterminate 를 넘지 않는다 (EA 규격 「단계」).
 * 사유는 개념 사전 uncertainty.yaml 의 것이다 — 자동화끼리 연결은 identity_link_weak(범용 접근 엔진 edges.ts 와 같다), 사람 연결은 identity_weak
 */
export function weakLinkUndecomposed(via: EaVia[], graph: GraphStoreV2): EaUndecomposed[] {
  return via.flatMap((v, i): EaUndecomposed[] => {
    if (v.kind !== 'link' || viaStrong(v)) return []
    const automation = graph.linksById.get(v.ref)?.meta?.kind === 'automation'
    return [{ at: `via[${i}]`, from: 'computation', reason: automation ? 'identity_link_weak' : 'identity_weak' }]
  })
}

/** 링크 via 가 가리키는 간선이 그 링크에 실제로 있는가 (lint) */
export function linkViaExists(via: EaLinkVia, graph: GraphStoreV2): boolean {
  const link = graph.linksById.get(via.ref)
  if (!link) return false
  const edges = edgesOf(link)
  if (!edges.length) {
    const members = new Set(link.set.map(m => m.object_key))
    return !recordsEdges(link) && members.has(via.a) && members.has(via.b)
  }
  return edges.some(e => e.a === via.a && e.b === via.b && e.level === via.level)
}

/** 계정 둘을 잇는 링크 via. 같은 링크에 없으면 빈 배열. 그룹 링크는 '같은 그룹'이지 같은 주체가 아니라 건너지 않는다 (identity.ts identityLinkOf 와 같다) */
export function identityVias(from: string, to: string, graph: GraphStoreV2): EaLinkVia[] {
  for (const id of graph.linkIdsByObject.get(from) ?? []) {
    const link = graph.linksById.get(id)
    if (!link || link.level === 'different' || link.meta?.kind === 'group' || !link.set.some(m => m.object_key === to)) continue
    const vias = linkVias(link, from, to)
    if (vias.length) return vias
  }
  return []
}

/** cyrb53 — 브라우저·Node 에서 같은 값을 내는 53비트 해시. 암호용이 아니라 동일성 키 압축용 */
function hash53(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0')
}

function viaIdentity(v: EaVia): string {
  return v.kind === 'relation' ? `relation:${v.ref}` : `link:${v.ref}#${v.a}~${v.b}`
}

/**
 * EA 규격 행 동일성: (references.source, references.target, source.rule, via[] 항목 id 의 순서열).
 * x_dynamic_holder 는 경로가 같은 스킴 적용 한 홉이라 권한 줄 키(x_holders.grant)를 더해 가른다. 다른 규칙의 id 는 그대로다
 */
export function rowIdentity(source: string, target: string, rule: EaRuleId, via: EaVia[], holders: string[] = []): string {
  return `EA-${hash53(JSON.stringify(holders.length ? [source, target, rule, via.map(viaIdentity), holders] : [source, target, rule, via.map(viaIdentity)]))}`
}

export interface RowContext {
  computedAt: string
  inputsViewVersion: number
}

export interface RowDraft {
  rule: EaRuleId
  effect_query: string
  source: string
  target: string
  level: EaLevel
  via: EaVia[]
  cut: EaCut[]
  undecomposed: EaUndecomposed[]
  asked_by: { rule_id: string; check_id?: string }
  observations?: string[]
  holders?: EffectiveAccessRow['x_holders']
  capability?: EffectiveAccessRow['x_capability']
}

export function makeRow(d: RowDraft, ctx: RowContext): EffectiveAccessRow {
  return {
    id: rowIdentity(d.source, d.target, d.rule, d.via, (d.holders ?? []).map(h => h.grant).sort()),
    effect: null,
    effect_query: d.effect_query,
    references: { source: d.source, target: d.target },
    level: d.level,
    via: d.via,
    cut: d.cut,
    undecomposed: d.undecomposed,
    source: { rule: d.rule, view_version: EA_VIEW_VERSION, computed_at: ctx.computedAt, inputs_view_version: ctx.inputsViewVersion },
    x_asked_by: d.asked_by,
    ...(d.observations?.length ? { x_observations: d.observations } : {}),
    ...(d.holders?.length ? { x_holders: d.holders } : {}),
    ...(d.capability ? { x_capability: d.capability } : {}),
  }
}

/** 관계 행이 벤더가 합친 값이면(basis computed·decomposable false) 그 undecomposed 를 물려받는다 */
export function inheritedUndecomposed(rel: ResolvedRelation, index: number): EaUndecomposed | undefined {
  if (rel.properties.basis !== 'computed' && rel.properties.decomposable !== false) return undefined
  const paths = Array.isArray(rel.properties.undecomposed) ? rel.properties.undecomposed.map(String) : []
  return { at: `via[${index}]`, from: 'relation', vendor_paths: paths.length ? paths : ['unknown'] }
}

/** cut 에 넣을 수 있는 관계 — 벤더가 적어 준 부여(stated)만. 합친 값·불리언 플래그는 지워서 회수할 수 있는 행이 아니다 */
export function isRevocable(rel: ResolvedRelation): boolean {
  return rel.properties.basis === 'stated' && rel.properties.decomposable !== false
}

/**
 * 그룹에서 빼면 그 그룹의 부여가 실제로 사라지는가 (EA 규격 「집행되는 경로와 권한이 생긴 이력은 다르다」).
 * 부여 관계 행의 membership_enforced 가 true 일 때만 그렇다. 정규화가 Profile 관계 선언의 값(aegi-knowledge #104, 끊어 보고 확인한 모양만
 * true)을 싣는다. 생략과 false 는 모른다 — cut 에 넣지 않는다. 접근 규칙 실행기도 규칙 파일의 부여 홉 속성으로 같은 값을 본다.
 * Profile 에 true 를 적은 것은 Okta 그룹 → 앱 배정뿐이라
 * GitHub 팀 → 저장소는 모름이 된다(끊어 본 기록이 없다).
 */
export function membershipEnforced(grant: ResolvedRelation): boolean {
  return grant.properties.membership_enforced === true
}

export function isMeasurementAccount(key: string, graph: GraphStoreV2): boolean {
  return graph.objectsByKey.get(key)?.fixture_meta?.demo_role === 'measurement_principal'
}
