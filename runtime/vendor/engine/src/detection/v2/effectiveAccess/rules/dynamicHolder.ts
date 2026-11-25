/**
 * x_dynamic_holder (로컬 규칙, 오브젝트 모델 v2 V2-OPEN-15) — Jira 권한 스킴 줄의 동적 보유자.
 *
 * 권한 스킴 줄은 스킴(PermissionScheme)의 permissions 속성이다(판단표 G4-Q02). 보유자가 사람, 그룹, 프로젝트 역할이면 정규화가
 * 관계로 풀고, anyone, applicationRole 은 특수 주체 관계로도 잇는다(G4-Q03). 이 규칙은 스킴 속성의 줄을 그대로 읽는다.
 * 이 규칙이 물은 쌍(주체, 프로젝트, 권한)에 대해 그 보유자를 푼다. 전수로 계산하지 않는다.
 *
 *   projectLead      Project.lead 참조가 이 주체면 성립(computed). 리드는 권한이 아니고 이 보유자가 있을 때만 권한이 된다(KX3)
 *   anyone           로그인한 모든 사용자. 전원 공유와 같은 배경이라 행을 만들지 않는다
 *   applicationRole  제품 접근 그룹의 회원. 그 그룹을 수집하지 않아 indeterminate
 *   reporter, assignee, userCustomField, groupCustomField, sd.customer.portal.only
 *                    이슈마다 정해져 프로젝트 단위로 정할 수 없다. indeterminate
 *
 * via 는 스킴 → 프로젝트 applies_to 한 홉이다. 보유자가 이 주체가 되는 근거(참조, 레코드)는 x_holders 에 적는다.
 * 스킴 적용은 벤더가 적어 준 관계라 끊을 수 있지만, 끊으면 그 스킴으로 권한을 받은 모두가 영향을 받는다.
 */
import type { GraphStoreV2 } from '../../../../model/graph'
import type { ResolvedRelation } from '../../../../model/relation'
import type { EaCut, EaUndecomposed, EffectiveAccessRow } from '../types'
import { eaCutNote } from '../../../cutActions'
import { isRevocable, makeRow, nameOf, relationVia, type RowContext } from '../common'

export const JIRA_DYNAMIC_HOLDERS = new Set(['anyone', 'applicationRole', 'projectLead', 'reporter', 'assignee', 'userCustomField', 'groupCustomField', 'sd.customer.portal.only'])

export interface DynamicHolderQuestion {
  principal: string
  resource: string
  /** 권한 줄의 권한 키(BROWSE_PROJECTS 등) 중 질문에 맞는 것 */
  matchesPermission: (permission: string) => boolean
  effectQuery: string
  askedBy: { rule_id: string; check_id?: string }
}

export interface DynamicHolderAnswer {
  rows: EffectiveAccessRow[]
  /** anyone 보유자가 있다 — 전원에게 걸리는 배경 */
  ambient: boolean
}

function refValues(key: string, slot: string, graph: GraphStoreV2): string[] {
  return (graph.objectsByKey.get(key)?.canonical.references?.[slot]?.targets ?? []).map(t => String(t.value))
}

/** 스킴의 권한 줄 (스킴 객체의 permissions 속성). 줄 키는 `스킴 키#줄 id` 다 */
export function schemeLines(scheme: string, graph: GraphStoreV2): Array<{ key: string; type: string; permission: string }> {
  const lines = graph.objectsByKey.get(scheme)?.canonical.properties.permissions
  return (Array.isArray(lines) ? lines : []).map((l: any) => ({ key: `${scheme}#${l?.id ?? ''}`, type: String(l?.holder_type ?? ''), permission: String(l?.permission ?? '') }))
}

/** 스킴 안의 동적 보유자 권한 줄 (질문의 권한에 맞는 것) */
export function dynamicGrants(scheme: string, matchesPermission: (permission: string) => boolean, graph: GraphStoreV2) {
  return schemeLines(scheme, graph).filter(l => JIRA_DYNAMIC_HOLDERS.has(l.type) && matchesPermission(l.permission)).sort((a, b) => a.key.localeCompare(b.key))
}

/** 프로젝트 리드 보유자의 근거(x_holders[].evidence). 운영 입구가 실행기 행에도 붙인다 */
export const LEAD_HOLDER_EVIDENCE = '프로젝트 리드 참조(Project.lead)가 이 주체다'

/** 스킴 적용 회수 지점의 설명(사전 phrases.ea_cut). 운영 입구(scripts/accessRules/production.ts)가 실행기 행에도 붙인다 */
export function schemeCutNote(project: string, scheme: string, graph: GraphStoreV2): string {
  return eaCutNote('x_dynamic_holder.s', { 프로젝트: nameOf(project, graph), 스킴: nameOf(scheme, graph) })
}

export function dynamicHolder(q: DynamicHolderQuestion, graph: GraphStoreV2, ctx: RowContext): DynamicHolderAnswer {
  const project = graph.objectsByKey.get(q.resource)?.canonical
  if (project?.provider !== 'atlassian' || project.object_type !== 'Project') return { rows: [], ambient: false }
  const applied: ResolvedRelation[] = (graph.incomingRelationsByObject.get(q.resource) ?? [])
    .filter(r => r.relationType === 'applies_to' && graph.objectsByKey.get(r.sourceKey)?.canonical.object_type === 'PermissionScheme')
  const leads = refValues(q.resource, 'lead', graph)
  const rows: EffectiveAccessRow[] = []
  let ambient = false
  for (const rel of applied) {
    const grants = dynamicGrants(rel.sourceKey, q.matchesPermission, graph)
    if (grants.some(g => g.type === 'anyone')) ambient = true
    const lead = grants.filter(g => g.type === 'projectLead' && leads.includes(q.principal))
    const open = grants.filter(g => g.type !== 'anyone' && g.type !== 'projectLead')
    if (!lead.length && !open.length) continue
    const cut: EaCut[] = isRevocable(rel)
      ? [{ via: 0, x_scope: { affects: 'all_callers', note: schemeCutNote(q.resource, rel.sourceKey, graph) } }]
      : []
    const holders = [
      ...lead.map(g => ({ type: g.type, grant: g.key, permission: g.permission, evidence: LEAD_HOLDER_EVIDENCE })),
      ...open.map(g => ({ type: g.type, grant: g.key, permission: g.permission, evidence: g.type === 'applicationRole' ? '제품 접근 그룹을 수집하지 않았다' : '이슈마다 정해지는 보유자다' })),
    ]
    // 리드로 성립하면 그 한 줄로 충분하다. 아니면 이슈 단위, 제품 접근 보유자 때문에 정하지 못한다
    const resolved = lead.length > 0
    const undecomposed: EaUndecomposed[] = resolved ? [] : [{ at: 'via[0]', from: 'computation', reason: 'dynamic_holder_unresolved' }]
    if (!cut.length && !undecomposed.length) undecomposed.push({ at: 'via[0]', from: 'computation', reason: 'dynamic_holder_unresolved' })
    rows.push(makeRow({
      rule: 'x_dynamic_holder', effect_query: q.effectQuery, source: q.principal, target: q.resource,
      level: resolved ? 'computed' : 'indeterminate', via: [relationVia(rel, graph)], cut, undecomposed, asked_by: q.askedBy,
      holders: resolved ? holders.filter(h => h.type === 'projectLead') : holders,
    }, ctx))
  }
  return { rows, ambient }
}
