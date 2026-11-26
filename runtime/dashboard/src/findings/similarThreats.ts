import type { FindingV2 } from '../model/findingV2'
import type { GraphStoreV2 } from '../model/graph'
import type { EvidenceStore } from '../model/evidence'
import { findingPathProviders } from './findingPath'
import { findingGroupKey } from './scenarioTags'
import { sortBySeverity } from './severity'

const MAX_SIMILAR_THREATS = 10

/**
 * 비슷한 위협 조회:
 * - 같은 ruleId
 * - 같은 분류 태그 (findingGroupKey)
 * - 같은 경로 모양 (findingPathProviders 의 SaaS 순서 일치)
 * - 자기 자신 제외
 * - 최대 10개
 * - 심각도 순
 */
export function similarThreats(
  finding: FindingV2,
  all: readonly FindingV2[],
  graph: GraphStoreV2,
  evidenceStore: EvidenceStore,
): FindingV2[] {
  const selfTag = findingGroupKey(finding)
  const selfLanes = findingPathProviders(finding, graph, evidenceStore)

  const matches = all.filter(other => {
    if (other.id === finding.id) return false

    if (other.ruleId !== finding.ruleId) return false

    const otherTag = findingGroupKey(other)
    if (selfTag !== otherTag) return false

    const otherLanes = findingPathProviders(other, graph, evidenceStore)
    if (selfLanes.length !== otherLanes.length) return false
    for (let i = 0; i < selfLanes.length; i++) {
      if (selfLanes[i] !== otherLanes[i]) return false
    }

    return true
  })

  return sortBySeverity(matches).slice(0, MAX_SIMILAR_THREATS)
}
