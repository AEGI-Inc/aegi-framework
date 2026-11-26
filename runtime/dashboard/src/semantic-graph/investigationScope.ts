import type { GraphStore, GraphStoreV2 } from '../model/graph'
import type { FindingV2 } from '../model/findingV2'
import type { ProjectedGraphData } from './types'
import { neighbors } from './investigationQuery'
import { buildContainment, containerAncestors } from './containment'
import { relationMatchesAnyLens, type RelationLensGroup } from './relationLens'
import { objectDisplayName } from './objectChip'

type Graph = GraphStore | GraphStoreV2

export interface ScopeOptions {
  findings: FindingV2[]
  selectedFindingIds: string[]
  focus: string
  target: string
  expanded: string[]
  queryObjects: string[]
  pathObjects: string[]
  includeLinks: boolean
  selectedProviders?: ReadonlySet<string>
  relationLenses?: ReadonlySet<RelationLensGroup>
  selectedObjectKey?: string
}

export interface ScopeResult {
  visible: ReadonlySet<string>
  mandatory: ReadonlySet<string>
  expanded: ReadonlySet<string>
  expansionCandidates: string[]
  remainingCandidateCount: number
  excludedEvidenceCount: number
}

const SCOPE_LIMIT = 110

/** 1회 확장 시 추가할 최대 신규 후보 수 */
export const INVESTIGATION_EXPANSION_BATCH_SIZE = 10

/**
 * 필수 근거와 선택적 주변 정보를 분리하고, 단계적 확장 후보와 제외 통계를 계산한다.
 */
export function calculateInvestigationScope(graph: Graph, options: ScopeOptions): ScopeResult {
  const parentOf = buildContainment(graph)

  // 1. 필수 근거: 선택된 Finding의 관련 객체와 활성 경로 객체
  const findingKeys = options.findings
    .filter(item => options.selectedFindingIds.includes(item.id))
    .flatMap(item => item.involvedObjectKeys)
    .filter(key => graph.objectsByKey.has(key))

  const validPathObjects = options.pathObjects.filter(key => graph.objectsByKey.has(key))

  const canIncludeStep = (toKey: string, step: ReturnType<typeof neighbors>[number]) => {
    if (!graph.objectsByKey.has(toKey)) return false
    const targetObj = graph.objectsByKey.get(toKey)!
    if (options.selectedProviders && options.selectedProviders.size > 0) {
      if (!options.selectedProviders.has(targetObj.canonical.provider)) return false
    }
    if (step.kind === 'relation' && options.relationLenses && options.relationLenses.size > 0) {
      if (step.relationType && !relationMatchesAnyLens(step.relationType, options.relationLenses)) return false
    }
    return true
  }

  // 필수 집합 (상한 제한 없이 화면에 유지)
  const mandatory = new Set<string>()
  if (options.focus && graph.objectsByKey.has(options.focus)) {
    mandatory.add(options.focus)
    for (const step of neighbors(graph, options.focus, { includeIdentityLinks: options.includeLinks })) {
      if (canIncludeStep(step.to, step)) mandatory.add(step.to)
    }
  }
  if (options.target && graph.objectsByKey.has(options.target)) {
    mandatory.add(options.target)
    for (const step of neighbors(graph, options.target, { includeIdentityLinks: options.includeLinks })) {
      if (canIncludeStep(step.to, step)) mandatory.add(step.to)
    }
  }
  if (options.selectedObjectKey && graph.objectsByKey.has(options.selectedObjectKey)) mandatory.add(options.selectedObjectKey)
  for (const k of findingKeys) mandatory.add(k)
  for (const k of validPathObjects) mandatory.add(k)

  // 동일인 연결이 켜져 있으면 필수 객체들의 확정 동일인 계정도 필수로 유지
  if (options.includeLinks) {
    const linkGraph = graph as Partial<GraphStoreV2>
    for (const key of [...mandatory]) {
      for (const linkId of linkGraph.linkIdsByObject?.get(key) ?? []) {
        for (const member of linkGraph.linksById?.get(linkId)?.set ?? []) {
          if (graph.objectsByKey.has(member.object_key)) mandatory.add(member.object_key)
        }
      }
    }
  }

  // 필수 객체의 상위 컨테이너도 필수로 유지 (테두리 렌더링 보장)
  for (const key of [...mandatory]) {
    for (const ancestor of containerAncestors(parentOf, key)) mandatory.add(ancestor)
  }

  // 2. 명시적으로 펼쳐둔 객체 집합 및 직속 1-hop 이웃
  const expanded = new Set<string>()
  for (const key of options.expanded) {
    if (graph.objectsByKey.has(key)) {
      expanded.add(key)
      for (const step of neighbors(graph, key, { includeIdentityLinks: options.includeLinks })) {
        if (canIncludeStep(step.to, step)) expanded.add(step.to)
      }
    }
  }
  // 펼친 객체의 컨테이너와 동일인 연결
  if (options.includeLinks) {
    const linkGraph = graph as Partial<GraphStoreV2>
    for (const key of [...expanded]) {
      for (const linkId of linkGraph.linkIdsByObject?.get(key) ?? []) {
        for (const member of linkGraph.linksById?.get(linkId)?.set ?? []) {
          if (graph.objectsByKey.has(member.object_key)) expanded.add(member.object_key)
        }
      }
    }
  }
  for (const key of [...expanded]) {
    for (const ancestor of containerAncestors(parentOf, key)) expanded.add(ancestor)
  }

  // 3. 진입 기준이나 검색이 전혀 없는 경우의 기본 시드 폴백 (기존 호환성)
  const roots = [...new Set([
    options.focus, options.target, ...options.expanded, ...options.queryObjects,
    ...options.pathObjects, ...findingKeys,
  ].filter(Boolean))]

  if (!roots.length) {
    const degree = (key: string) => (graph.outgoingRelationsByObject.get(key)?.length ?? 0) +
      (graph.incomingRelationsByObject.get(key)?.length ?? 0)
    const defaultKeys: string[] = []
    const seededProviders = new Set<string>()
    for (const key of [...graph.objectsByKey.keys()].sort((a, b) => degree(b) - degree(a) || a.localeCompare(b))) {
      const provider = graph.objectsByKey.get(key)?.canonical.provider ?? ''
      if (seededProviders.has(provider)) continue
      seededProviders.add(provider)
      defaultKeys.push(key)
    }
    const visible = new Set(defaultKeys)
    const active = defaultKeys
    const perSeed = Math.floor(SCOPE_LIMIT / Math.max(active.length, 1))
    for (const key of active) {
      let added = 0
      for (const step of neighbors(graph, key, { includeIdentityLinks: options.includeLinks })) {
        if (visible.size >= SCOPE_LIMIT || added >= perSeed) break
        if (!visible.has(step.to)) {
          visible.add(step.to)
          added++
        }
      }
    }
    if (options.includeLinks) {
      const linkGraph = graph as Partial<GraphStoreV2>
      for (const key of [...visible]) {
        for (const linkId of linkGraph.linkIdsByObject?.get(key) ?? []) {
          for (const member of linkGraph.linksById?.get(linkId)?.set ?? []) {
            if (graph.objectsByKey.has(member.object_key)) visible.add(member.object_key)
          }
        }
      }
    }
    for (const key of [...visible]) {
      for (const ancestor of containerAncestors(parentOf, key)) visible.add(ancestor)
    }
    return {
      visible,
      mandatory: new Set(defaultKeys),
      expanded: new Set(),
      expansionCandidates: [],
      remainingCandidateCount: 0,
      excludedEvidenceCount: 0,
    }
  }

  // 4. 표시 집합 구성 (필수 + 펼침 + 검색 결과)
  const visible = new Set<string>([...mandatory, ...expanded])
  for (const key of options.queryObjects) {
    if (graph.objectsByKey.has(key)) {
      visible.add(key)
      for (const ancestor of containerAncestors(parentOf, key)) visible.add(ancestor)
    }
  }

  // 5. 확장 후보 계산: 활성 기준(선택 객체 또는 focus)의 원본 직접 연결에서 도출
  const activeRoot = (options.selectedObjectKey && graph.objectsByKey.has(options.selectedObjectKey))
    ? options.selectedObjectKey
    : (options.focus && graph.objectsByKey.has(options.focus))
      ? options.focus
      : ''

  const candidateMap = new Map<string, { key: string; score: number; name: string }>()
  if (activeRoot) {
    const findingSet = new Set(findingKeys)
    const pathSet = new Set(validPathObjects)

    for (const step of neighbors(graph, activeRoot, { includeIdentityLinks: options.includeLinks })) {
      const toKey = step.to
      if (toKey === activeRoot || !graph.objectsByKey.has(toKey)) continue

      const targetObj = graph.objectsByKey.get(toKey)!
      // SaaS 필터 적용
      if (options.selectedProviders && options.selectedProviders.size > 0) {
        if (!options.selectedProviders.has(targetObj.canonical.provider)) continue
      }
      // 관계 렌즈 필터 적용
      if (step.kind === 'relation' && options.relationLenses && options.relationLenses.size > 0) {
        if (step.relationType && !relationMatchesAnyLens(step.relationType, options.relationLenses)) continue
      }

      let score = 0
      if (findingSet.has(toKey)) score += 10
      if (pathSet.has(toKey)) score += 5

      const name = objectDisplayName(targetObj)
      const existing = candidateMap.get(toKey)
      if (!existing || score > existing.score) {
        candidateMap.set(toKey, { key: toKey, score, name })
      }
    }
  }

  // 관련도 높은 순, 동률은 이름순, 객체 키순
  const sortedCandidates = [...candidateMap.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const cmpName = a.name.localeCompare(b.name)
    if (cmpName !== 0) return cmpName
    return a.key.localeCompare(b.key)
  })

  // 이미 캔버스에 표시된 객체는 남은 후보에서 제외
  const unexpandedCandidates = sortedCandidates
    .map(c => c.key)
    .filter(k => !visible.has(k))

  // 6. 필터로 인해 제외된 필수 근거 수 계산
  let excludedEvidenceCount = 0
  const allEvidenceKeys = new Set([...findingKeys, ...validPathObjects])
  if (options.selectedProviders && options.selectedProviders.size > 0) {
    for (const key of allEvidenceKeys) {
      const prov = graph.objectsByKey.get(key)?.canonical.provider
      if (prov && !options.selectedProviders.has(prov)) {
        excludedEvidenceCount++
      }
    }
  }

  // 선택된 Finding의 관계선 중 렌즈 필터로 제외된 항목 합산
  if (options.relationLenses && options.relationLenses.size > 0) {
    const selectedFindings = options.findings.filter(item => options.selectedFindingIds.includes(item.id))
    const relStore = (graph as GraphStoreV2).relationsByKey
    if (relStore) {
      const seenRels = new Set<string>()
      for (const finding of selectedFindings) {
        for (const relKey of finding.involvedRelationKeys) {
          if (seenRels.has(relKey)) continue
          seenRels.add(relKey)
          const rel = relStore.get(relKey)
          if (rel && !relationMatchesAnyLens(rel.relationType, options.relationLenses)) {
            excludedEvidenceCount++
          }
        }
      }
    }
  }

  return {
    visible,
    mandatory,
    expanded,
    expansionCandidates: unexpandedCandidates,
    remainingCandidateCount: unexpandedCandidates.length,
    excludedEvidenceCount,
  }
}

/** A stable limited investigation canvas rather than a 174-object inventory grid. */
export function investigationScope(graph: Graph, options: ScopeOptions): ReadonlySet<string> {
  return calculateInvestigationScope(graph, options).visible
}

export function restrictToInvestigationScope(
  data: ProjectedGraphData, objects: ReadonlySet<string>, fullOverview: boolean
): ProjectedGraphData {
  if (fullOverview) return data
  const nodes = data.nodes.filter(node => node.memberObjectKeys.some(key => objects.has(key)))
  const ids = new Set(nodes.map(node => node.id))
  const edges = data.edges.filter(edge => ids.has(edge.sourceSemanticNodeId) && ids.has(edge.targetSemanticNodeId))
  return { ...data, nodes, edges }
}
