import type { GraphStoreV2 } from '../model/graph'
import type { BlastHop } from '../detection/v2/blastRadius'
import type { InvestigationPath, InvestigationStep } from './investigationQuery'

/*
 * 다른 화면에서 그래프로 넘길 사슬.
 *
 * 전에는 Access Gaps의 경로 사슬이나 Credentials 피해범위의 경로에서 「그래프에서 보기」를 누르면 객체 하나만
 * 넘겨, 그래프에서는 사슬이 사라지고 그 객체만 보였다. 사슬의 객체와 관계를 그래프의 경로(선택 경로)로 바꿔
 * 넘겨, 사슬 전체를 강조한 채 연다.
 */

/** 이웃한 두 객체를 잇는 한 단계. 넘겨받은 관계 중에서 먼저 찾고, 없으면 그래프의 관계, 동일인 연결 순으로 찾는다 */
function stepBetween(graph: GraphStoreV2, from: string, to: string, relationKeys: ReadonlySet<string>): InvestigationStep | null {
  const relations = [...(graph.outgoingRelationsByObject.get(from) ?? []), ...(graph.incomingRelationsByObject.get(from) ?? [])]
    .filter(rel => (rel.sourceKey === from && rel.targetKey === to) || (rel.sourceKey === to && rel.targetKey === from))
  const relation = relations.find(rel => relationKeys.has(rel.relationKey)) ?? relations[0]
  if (relation) return { from, to, edgeId: relation.relationKey, kind: 'relation', relationType: relation.relationType, forward: relation.sourceKey === from }
  for (const linkId of graph.linkIdsByObject.get(from) ?? []) {
    if (graph.linksById.get(linkId)?.set.some(member => member.object_key === to)) return { from, to, edgeId: linkId, kind: 'identity_link' }
  }
  return null
}

/** 순서대로 늘어선 객체와 그 사이 관계(Access Gaps의 연동 경로).
    넘겨받은 관계를 모두 단계로 쓰고, 관계로 이어지지 않은 이웃 객체 사이만 그래프에서 찾아 메운다 */
export function chainPath(graph: GraphStoreV2, objects: string[], relationKeys: string[]): InvestigationPath {
  const known = objects.filter(key => graph.objectsByKey.has(key))
  const steps: InvestigationStep[] = []
  const linked = new Set<string>()
  for (const key of relationKeys) {
    const relation = graph.relationsByKey.get(key)
    if (!relation) continue
    steps.push({ from: relation.sourceKey, to: relation.targetKey, edgeId: relation.relationKey, kind: 'relation', relationType: relation.relationType, forward: true })
    linked.add(`${relation.sourceKey}|${relation.targetKey}`).add(`${relation.targetKey}|${relation.sourceKey}`)
  }
  for (let i = 1; i < known.length; i++) {
    if (linked.has(`${known[i - 1]}|${known[i]}`)) continue
    const step = stepBetween(graph, known[i - 1], known[i], new Set())
    if (step) steps.push(step)
  }
  return { objects: known, steps }
}

/** 피해범위 경로(자격증명에서 고른 객체까지의 단계들) */
export function hopsPath(graph: GraphStoreV2, hops: BlastHop[]): InvestigationPath {
  if (!hops.length) return { objects: [], steps: [] }
  const objects = [hops[0].from, ...hops.map(hop => hop.to)].filter(key => graph.objectsByKey.has(key))
  const steps: InvestigationStep[] = []
  for (const hop of hops) {
    const relation = hop.relationKeys.map(key => graph.relationsByKey.get(key)).find(Boolean)
    if (relation) steps.push({ from: hop.from, to: hop.to, edgeId: relation.relationKey, kind: 'relation', relationType: relation.relationType, forward: relation.sourceKey === hop.from })
    else if (hop.linkId) steps.push({ from: hop.from, to: hop.to, edgeId: hop.linkId, kind: 'identity_link' })
    else {
      const step = stepBetween(graph, hop.from, hop.to, new Set())
      if (step) steps.push(step)
    }
  }
  return { objects, steps }
}
