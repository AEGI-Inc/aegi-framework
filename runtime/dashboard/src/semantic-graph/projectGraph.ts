import type { Provider } from '../model/object'
import type { GraphStore, GraphStoreV2 } from '../model/graph'
import type { FindingV2 } from '../model/findingV2'
import type { SemanticLevel, ProjectedGraphData } from './types'
import { buildObjectHierarchy } from './hierarchy'
import { computeSemanticAnchors } from './layoutAnchors'
import { projectNodes } from './projectNodes'
import { projectEdges } from './projectEdges'
import { aggregateFindings } from './aggregateFindings'
import { filterEdgesByLens, type RelationLens } from './relationLens'
import { neighbors, searchObjects } from './investigationQuery'
import type { IdentityEvidenceEdge } from '../assistant/types'
import type { ExtraLinkEdge } from './types'

export interface GraphFilterOptions {
  identityEdges?: IdentityEvidenceEdge[]
  /** 수집된 관계 밖에서 넘겨받아 그리는 객체 사이 선(ExtraLinkEdge) */
  extraLinks?: ExtraLinkEdge[]
  provider?: 'all' | Provider
  providers?: ReadonlySet<Provider>
  threatOnly?: boolean
  searchQuery?: string
  selectedFindingIds?: string[]
  relationLens?: RelationLens
  includeIdentityLinks?: boolean
}

/**
 * Core projection pipeline:
 * CurrentGraph + Findings + SemanticLevel + Filters -> ProjectedGraphData
 */
export function projectSemanticGraph(
  graph: GraphStore | GraphStoreV2,
  findingsOrEvaluations: FindingV2[],
  level: SemanticLevel,
  filters?: GraphFilterOptions
): ProjectedGraphData {
  // 1. Build hierarchy for all objects
  const hierarchyMap = buildObjectHierarchy(graph as any)

  // 2. Compute stable layout anchors
  const anchors = computeSemanticAnchors(graph as any, hierarchyMap)

  // 3. Project nodes for requested level
  const rawNodes = projectNodes(graph as any, hierarchyMap, level, anchors).filter(n=>!n.memberObjectKeys.length||!n.memberObjectKeys.every(k=>graph.objectsByKey.get(k)?.canonical.properties.presentation_role==='intermediary'))
  const displayedNodeIds=new Set(rawNodes.map(n=>n.id))

  // 4. Project edge bundles for requested level
  const rawEdges = filterEdgesByLens(projectEdges(graph as any, hierarchyMap, level, filters?.identityEdges, filters?.extraLinks), filters?.relationLens ?? 'all', filters?.includeIdentityLinks ?? true, new Map(Array.from(graph.relationsByKey.values(), r => [r.relationKey, r.relationType]))).filter(e=>displayedNodeIds.has(e.sourceSemanticNodeId)&&displayedNodeIds.has(e.targetSemanticNodeId))

  // 5. Aggregate findings hierarchically
  const { nodes: aggregatedNodes, edges: aggregatedEdges, globalFindings, v2Findings } = aggregateFindings(
    rawNodes,
    rawEdges,
    findingsOrEvaluations,
    hierarchyMap,
    level,
    filters?.selectedFindingIds || []
  )

  let finalNodes = aggregatedNodes
  let finalEdges = aggregatedEdges

  // 6. Apply filters
  if (filters?.providers) {
    const allowed = filters.providers
    finalNodes = finalNodes.filter(n => allowed.has(n.provider as any))
    const visibleNodeIds = new Set(finalNodes.map(n => n.id))
    finalEdges = finalEdges.filter(
      e => visibleNodeIds.has(e.sourceSemanticNodeId) && visibleNodeIds.has(e.targetSemanticNodeId)
    )
  } else if (filters?.provider && filters.provider !== 'all') {
    const p = filters.provider
    finalNodes = finalNodes.filter(n => n.provider === p)
    const visibleNodeIds = new Set(finalNodes.map(n => n.id))
    finalEdges = finalEdges.filter(
      e => visibleNodeIds.has(e.sourceSemanticNodeId) && visibleNodeIds.has(e.targetSemanticNodeId)
    )
  }

  if (filters?.threatOnly) {
    const threatNodeIds = new Set<string>()
    const threatEdges = finalEdges.filter(e => e.findingCount > 0)
    finalNodes.forEach(n => {
      if (n.findingCount > 0) threatNodeIds.add(n.id)
    })
    threatEdges.forEach(e => {
      threatNodeIds.add(e.sourceSemanticNodeId)
      threatNodeIds.add(e.targetSemanticNodeId)
    })

    finalNodes = finalNodes.filter(n => threatNodeIds.has(n.id))
    finalEdges = finalEdges.filter(
      e => threatNodeIds.has(e.sourceSemanticNodeId) && threatNodeIds.has(e.targetSemanticNodeId)
    )
  }

  if (filters?.searchQuery && filters.searchQuery.trim()) {
    // Search focuses the matching objects AND their direct neighbors. Unlike
    // the old label-only filter, it does not strand the matching node by
    // removing every edge and every connected context node.
    const matches = searchObjects(graph, filters.searchQuery, 100)
    const visibleObjects = new Set(matches)
    for (const key of matches) {
      for (const step of neighbors(graph, key, { includeIdentityLinks: filters.includeIdentityLinks ?? true })) {
        visibleObjects.add(step.to)
      }
    }
    const visibleNodeIds = new Set(finalNodes.filter(node =>
      node.memberObjectKeys.some(key => visibleObjects.has(key))
    ).map(node => node.id))
    finalNodes = finalNodes.filter(node => visibleNodeIds.has(node.id))
    finalEdges = finalEdges.filter(edge =>
      visibleNodeIds.has(edge.sourceSemanticNodeId) && visibleNodeIds.has(edge.targetSemanticNodeId)
    )
  }

  return {
    level,
    nodes: finalNodes,
    edges: finalEdges,
    hierarchyByObject: hierarchyMap,
    globalFindings,
    v2Findings,
  }
}
