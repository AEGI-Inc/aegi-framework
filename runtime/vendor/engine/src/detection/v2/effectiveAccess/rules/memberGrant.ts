/**
 * x_member_grant (로컬 규칙, 적용안 §3.2) — P --member_of--> G ∧ G --has_role_on[r]--> X.
 *
 * 그룹 한 단계를 거친 권한을 행으로 남긴다. Relation_Schema_v3 「member_of 가 이미 있으니 질의에서 두 홉 타면 된다」.
 * 같은 질문에서 직접 부여·소유·배정·전원 공유를 먼저 본다 — 그건 관계 한 행으로 끝나서 EA 행을 만들지 않는다
 * (EA 규격 「vendor_stated 를 뺐다」). 아무 경로도 없으면 denied 를 남긴다 — 무엇을 보고 아니라고 했는지와 함께.
 */
import type { GraphStoreV2 } from '../../../../model/graph'
import type { ResolvedRelation } from '../../../../model/relation'
import type { EaCut, EaUndecomposed, EaVia, EffectiveAccessRow } from '../types'
import { grantHolds, identityVias, inheritedUndecomposed, isRevocable, makeRow, membershipEnforced, nameOf, relationVia, type RowContext } from '../common'
import { dynamicHolder } from './dynamicHolder'
import { eaCutNote } from '../../../cutActions'

export interface GrantQuestion {
  /** 자원과 같은 provider 의 계정 */
  principal: string
  resource: string
  /** has_role_on 후보 중 질문에 맞는 것 (역할·최소 수준) */
  matches: (rel: ResolvedRelation) => boolean
  effectQuery: string
  askedBy: { rule_id: string; check_id?: string }
  /** 룰이 출발한 계정 (다른 provider). denied 의 via 에 그 계정을 찾은 링크를 적는다 */
  anchor?: string
  /** Jira 프로젝트를 물을 때 권한 줄의 권한 키 중 질문에 맞는 것. 있으면 동적 보유자(x_dynamic_holder)도 본다 */
  matchesPermission?: (permission: string) => boolean
}

export type GrantOutcome =
  /** 관계 한 행으로 성립 — EA 행 없음 */
  | 'direct'
  /** 그룹을 거쳐 성립 — x_member_grant 행 */
  | 'group'
  /** 권한 스킴의 동적 보유자로 성립하거나 정하지 못함 — x_dynamic_holder 행 */
  | 'dynamic'
  /** 전원 공유(도메인·anyone)로 성립 — 배경이라 행을 만들지 않는다 (EA 규격 「전원에게 걸리는 경로는 세지 않는다」) */
  | 'ambient'
  /** 없다 — denied 행 */
  | 'denied'
  /** 답하지 않았다 — 한 단계 넘게 중첩된 그룹이 있거나 확인한 관계가 없다. 행을 만들지 않는다 */
  | 'unanswered'

export interface GrantAnswer {
  outcome: GrantOutcome
  rows: EffectiveAccessRow[]
  /** outcome direct 일 때 그 관계(또는 배정 객체) 키 */
  direct: string[]
}

function refValues(key: string, slot: string, graph: GraphStoreV2): string[] {
  return (graph.objectsByKey.get(key)?.canonical.references?.[slot]?.targets ?? []).map(t => String(t.value))
}

/** 자원에 붙은 권한 배정(Assignment) 중 이 주체를 받는 쪽으로 가리키는 것. v1 은 contained_in, v2 는 references.parent */
function assignmentGrants(principal: string, resource: string, graph: GraphStoreV2): string[] {
  const keys = new Set<string>()
  for (const rel of graph.incomingRelationsByObject.get(resource) ?? []) {
    if (rel.relationType === 'contained_in' && graph.objectsByKey.get(rel.sourceKey)?.canonical.interfaces.includes('Assignment')) keys.add(rel.sourceKey)
  }
  for (const obj of graph.objectsByInterface.get('Assignment') ?? []) {
    if (refValues(obj.fixture_key, 'parent', graph).includes(resource)) keys.add(obj.fixture_key)
  }
  return [...keys].filter(k => graph.objectsByKey.get(k)?.canonical.properties.deleted !== true && refValues(k, 'grantee', graph).includes(principal))
}

function tenantOf(key: string, graph: GraphStoreV2): string | undefined {
  return refValues(key, 'tenant', graph)[0]
}

/** 소속 회수 지점의 설명(사전 phrases.ea_cut). 손코드 일반 규칙과 운영 입구(scripts/accessRules/production.ts)도 같이 쓴다 */
export function memberLeaveNote(principal: string, group: string, graph: GraphStoreV2): string {
  return eaCutNote('x_member_grant.m', { 주체: nameOf(principal, graph), 그룹: nameOf(group, graph) })
}

/** 그룹 부여 회수 지점의 설명 */
export function groupGrantNote(group: string, size: number, graph: GraphStoreV2): string {
  return eaCutNote('x_member_grant.h', { 그룹: nameOf(group, graph), 인원: size })
}

/** 그룹 인원(member_of 로 들어온 수). 회수 지점 x_scope.count */
export function groupSize(group: string, graph: GraphStoreV2): number {
  return (graph.incomingRelationsByObject.get(group) ?? []).filter(r => r.relationType === 'member_of').length
}

export function askGrant(q: GrantQuestion, graph: GraphStoreV2, ctx: RowContext): GrantAnswer {
  const { principal, resource } = q
  const outgoing = graph.outgoingRelationsByObject.get(principal) ?? []
  const incoming = graph.incomingRelationsByObject.get(resource) ?? []
  const resourceOut = graph.outgoingRelationsByObject.get(resource) ?? []

  // 1. 관계 한 행: 직접 부여 · 소유 · 배정
  const direct = [
    ...outgoing.filter(r => r.relationType === 'has_role_on' && r.targetKey === resource && q.matches(r) && grantHolds(r, principal, graph)).map(r => r.relationKey),
    ...resourceOut.filter(r => r.relationType === 'owned_by' && r.targetKey === principal).map(r => r.relationKey),
    ...assignmentGrants(principal, resource, graph),
  ]
  if (direct.length) return { outcome: 'direct', rows: [], direct }

  // 2. 그룹 한 단계
  const rows: EffectiveAccessRow[] = []
  const memberships = outgoing.filter(r => r.relationType === 'member_of' && r.targetKey !== resource)
  for (const membership of memberships) {
    const group = membership.targetKey
    for (const grant of graph.outgoingRelationsByObject.get(group) ?? []) {
      if (grant.relationType !== 'has_role_on' || grant.targetKey !== resource || !q.matches(grant)) continue
      if (!grantHolds(grant, [principal, group], graph)) continue
      const via: EaVia[] = [relationVia(membership, graph), relationVia(grant, graph)]
      const enforced = membershipEnforced(grant)
      const size = groupSize(group, graph)
      const cut: EaCut[] = []
      const undecomposed: EaUndecomposed[] = []
      if (enforced && isRevocable(membership)) cut.push({ via: 0, x_scope: { affects: 'source_only', note: memberLeaveNote(principal, group, graph) } })
      else if (!enforced) undecomposed.push({ at: 'via[0]', from: 'computation', reason: 'enforcement_unknown' })
      const fromMembership = inheritedUndecomposed(membership, 0)
      if (fromMembership) undecomposed.push(fromMembership)
      if (isRevocable(grant)) cut.push({ via: 1, x_scope: { affects: 'group', count: size, note: groupGrantNote(group, size, graph) } })
      const fromGrant = inheritedUndecomposed(grant, 1)
      if (fromGrant) undecomposed.push(fromGrant)
      const cross = via.some(v => v.kind === 'relation' && v.x_cross_provider)
      rows.push(makeRow({ rule: 'x_member_grant', effect_query: q.effectQuery, source: principal, target: resource, level: cross ? 'computed_cross' : 'computed', via, cut, undecomposed, asked_by: q.askedBy }, ctx))
    }
  }
  if (rows.length) return { outcome: 'group', rows, direct: [] }

  // 2b. Jira 권한 스킴의 동적 보유자. 리드로 성립하면 그 행, 전원(anyone)이면 배경, 이슈 단위면 정하지 못한 행
  if (q.matchesPermission) {
    const dyn = dynamicHolder({ principal, resource, matchesPermission: q.matchesPermission, effectQuery: q.effectQuery, askedBy: q.askedBy }, graph, ctx)
    const resolved = dyn.rows.filter(r => r.level !== 'indeterminate')
    if (resolved.length) return { outcome: 'dynamic', rows: resolved, direct: [] }
    if (dyn.ambient) return { outcome: 'ambient', rows: [], direct: [] }
    if (dyn.rows.length) return { outcome: 'dynamic', rows: dyn.rows, direct: [] }
  }

  // 3. 전원 공유 (도메인·anyone). 배경이라 행이 없다
  const tenant = tenantOf(principal, graph)
  const ambient = resourceOut.some(r => r.relationType === 'shared_with' && (r.properties.target_kind === 'set' || r.targetKey === tenant || outgoing.some(m => m.relationType === 'member_of' && m.targetKey === r.targetKey)))
  if (ambient) return { outcome: 'ambient', rows: [], direct: [] }

  // 4. 없다. 한 단계 넘게 중첩된 그룹은 보지 않았으니 없다고 말하지 않는다
  const nested = memberships.some(m => (graph.outgoingRelationsByObject.get(m.targetKey) ?? []).some(r => r.relationType === 'member_of'))
  const checked = [
    ...incoming.filter(r => r.relationType === 'has_role_on' && q.matches(r)),
    ...resourceOut.filter(r => r.relationType === 'owned_by' || r.relationType === 'shared_with'),
    ...incoming.filter(r => r.relationType === 'contained_in' && graph.objectsByKey.get(r.sourceKey)?.canonical.interfaces.includes('Assignment')),
  ]
  if (nested || !checked.length) return { outcome: 'unanswered', rows: [], direct: [] }
  const via: EaVia[] = [...(q.anchor && q.anchor !== principal ? identityVias(q.anchor, principal, graph) : []), ...checked.map(r => relationVia(r, graph))]
  return { outcome: 'denied', rows: [makeRow({ rule: 'x_member_grant', effect_query: q.effectQuery, source: principal, target: resource, level: 'denied', via, cut: [], undecomposed: [], asked_by: q.askedBy }, ctx)], direct: [] }
}
