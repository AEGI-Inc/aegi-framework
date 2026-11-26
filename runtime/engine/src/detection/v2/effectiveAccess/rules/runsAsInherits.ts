/**
 * runs_as_inherits (EA 규격의 유일한 합성 규칙) — Automation --runs_as--> Principal ∧ Principal 에서 나가는 G 간선 --> X.
 *
 * 자동화는 실행 신원의 권한으로 돈다(Interface_Spec_v3 runs_as). triggered_by 로는 절대 만들지 않는다 — 부른 사람은 자동화의 권한을 갖지 않는다.
 * 끝이 Principal 이 아닌 runs_as(스크립트 → Slack 웹훅, Credential)는 입력이 아니다.
 * 둘째 홉은 common.ts accessHops 다(관계 이름이나 화면용 등급이 아니라 effects 의 G).
 * runs_as 가 basis computed 면(설치형 트리거 실행이 없어 주인 권한이었는지 모름, v2.0.43) 그 홉을 cut 에 넣지 않고 indeterminate.
 */
import type { GraphStoreV2 } from '../../../../model/graph'
import type { ResolvedRelation } from '../../../../model/relation'
import type { EaCut, EaUndecomposed, EaVia, EffectiveAccessRow } from '../types'
import { eaCutNote } from '../../../cutActions'
import { accessHops, inheritedUndecomposed, isRevocable, makeRow, nameOf, relationVia, type RowContext } from '../common'
import { automationScopeReaches } from '../../engine/accessModel'

export interface RunsAsQuestion {
  automation: string
  resource: string
  matches: (rel: ResolvedRelation) => boolean
  effectQuery: string
  askedBy: { rule_id: string; check_id?: string }
}

export function isRunsAsInheritsInput(rel: ResolvedRelation, graph: GraphStoreV2): boolean {
  return rel.relationType === 'runs_as' && !!graph.objectsByKey.get(rel.targetKey)?.canonical.interfaces.includes('Principal')
}

export function runsAsInherits(q: RunsAsQuestion, graph: GraphStoreV2, ctx: RowContext): EffectiveAccessRow[] {
  const rows: EffectiveAccessRow[] = []
  if (!automationScopeReaches(graph, q.automation, q.resource)) return rows
  for (const runsAs of graph.outgoingRelationsByObject.get(q.automation) ?? []) {
    if (!isRunsAsInheritsInput(runsAs, graph)) continue
    const principal = runsAs.targetKey
    for (const { rel: hop, resource } of accessHops(principal, graph)) {
      if (resource !== q.resource) continue
      if (hop.relationType === 'has_role_on' && !q.matches(hop)) continue
      const via: EaVia[] = [relationVia(runsAs, graph), relationVia(hop, graph)]
      const cut: EaCut[] = []
      const undecomposed: EaUndecomposed[] = []
      if (isRevocable(runsAs)) cut.push({ via: 0, x_scope: { affects: 'source_only', note: eaCutNote('runs_as_inherits.r') } })
      const fromRunsAs = inheritedUndecomposed(runsAs, 0)
      if (fromRunsAs) undecomposed.push(fromRunsAs)
      if (isRevocable(hop)) cut.push({ via: 1, x_scope: { affects: 'group', note: eaCutNote('runs_as_inherits.h', { 주체: nameOf(principal, graph) }) } })
      const fromHop = inheritedUndecomposed(hop, 1)
      if (fromHop) undecomposed.push(fromHop)
      const cross = via.some(v => v.kind === 'relation' && v.x_cross_provider)
      const level = !isRevocable(runsAs) ? 'indeterminate' : cross ? 'computed_cross' : 'computed'
      rows.push(makeRow({ rule: 'runs_as_inherits', effect_query: q.effectQuery, source: q.automation, target: q.resource, level, via, cut, undecomposed, asked_by: q.askedBy }, ctx))
    }
  }
  return rows
}
