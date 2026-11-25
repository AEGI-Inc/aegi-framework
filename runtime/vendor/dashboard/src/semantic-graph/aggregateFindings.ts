import type { SemanticLevel, SemanticNode, SemanticEdge, SemanticHierarchy, Severity } from './types'
import type { FindingV2 } from '../model/findingV2'

const SEVERITY_RANK: Record<Severity, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
  Info: 0,
}

function computeHighestSeverity(severities: Severity[]): Severity | undefined {
  if (severities.length === 0) return undefined
  let maxSev = severities[0]
  for (const s of severities) {
    if (SEVERITY_RANK[s] > SEVERITY_RANK[maxSev]) {
      maxSev = s
    }
  }
  return maxSev
}

/**
 * Aggregates findings (FindingV2[]) across semantic nodes and edges.
 * Guarantees strict deduplication (a Finding counts once per semantic node).
 */
export function aggregateFindings(
  nodes: SemanticNode[],
  edges: SemanticEdge[],
  findingsOrEvaluations: FindingV2[],
  hierarchyMap: Map<string, SemanticHierarchy>,
  level: SemanticLevel,
  selectedFindingIds: string[] = []
): {
  nodes: SemanticNode[]
  edges: SemanticEdge[]
  globalFindings: Array<{
    findingId: string
    ruleId: string
    ruleName: string
    severity: Severity
    score: number
    title: string
    evidenceKeys: string[]
  }>
  v2Findings: FindingV2[]
} {
  // Normalize findings list
  const v2Findings: FindingV2[] = findingsOrEvaluations

  const globalFindings = v2Findings.map(f => {
    const rawSev = f.severity || 'high'
    const severity = (rawSev.charAt(0).toUpperCase() + rawSev.slice(1).toLowerCase()) as Severity
    return {
      findingId: f.id,
      ruleId: f.ruleId,
      ruleName: f.title,
      severity,
      score: 8.0,
      title: f.title,
      evidenceKeys: f.involvedObjectKeys,
    }
  })

  // Map to store finding IDs & severities per semantic node ID
  const nodeFindingsMap = new Map<string, { ids: Set<string>; severities: Severity[] }>()
  for (const n of nodes) {
    nodeFindingsMap.set(n.id, { ids: new Set(), severities: [] })
  }

  for (const f of v2Findings) {
    const rawSev = f.severity || 'high'
    const severity = (rawSev.charAt(0).toUpperCase() + rawSev.slice(1).toLowerCase()) as Severity

    const involvedKeys = new Set(f.involvedObjectKeys)

    for (const objKey of involvedKeys) {
      const h = hierarchyMap.get(objKey)
      if (!h) continue

      let nodeId: string | undefined
      if (level === 'ecosystem') nodeId = h.ecosystemNodeId
      else if (level === 'tenant') nodeId = h.tenantNodeId
      else if (level === 'scope') nodeId = h.scopeNodeId
      else nodeId = h.objectNodeId

      if (nodeId && nodeFindingsMap.has(nodeId)) {
        const entry = nodeFindingsMap.get(nodeId)!
        if (!entry.ids.has(f.id)) {
          entry.ids.add(f.id)
          entry.severities.push(severity)
        }
      }
    }
  }

  // Apply to nodes
  const updatedNodes = nodes.map(node => {
    const entry = nodeFindingsMap.get(node.id)
    const findingIds = entry ? Array.from(entry.ids) : []
    const highestSeverity = entry ? computeHighestSeverity(entry.severities) : undefined
    const selectedInNode = findingIds.filter(id => selectedFindingIds.includes(id))

    return {
      ...node,
      findingIds,
      findingCount: findingIds.length,
      selectedFindingIds: selectedInNode,
      selectedFindingCount: selectedInNode.length,
      highestSeverity,
    }
  })

  // Apply to edges
  const updatedEdges = edges.map(edge => {
    const edgeFindingIds = new Set<string>()
    const edgeSeverities: Severity[] = []

    for (const f of v2Findings) {
      const rawSev = f.severity || 'high'
      const severity = (rawSev.charAt(0).toUpperCase() + rawSev.slice(1).toLowerCase()) as Severity

      let isAffected = false
      // Direct relation key match
      if (edge.relationKeys.some(rk => f.involvedRelationKeys.includes(rk))) {
        isAffected = true
      }
      // Link match
      if (edge.resolutionIds.some(lid => f.involvedLinkIds.includes(lid))) {
        isAffected = true
      }
      // Only explicit relation/link evidence is marked as a Finding edge.
      // Both endpoints participating in the same Finding does not prove that
      // every edge between them belongs to the evidence path.

      if (isAffected && !edgeFindingIds.has(f.id)) {
        edgeFindingIds.add(f.id)
        edgeSeverities.push(severity)
      }
    }

    const findingIds = Array.from(edgeFindingIds)
    const selectedInEdge = findingIds.filter(id => selectedFindingIds.includes(id))

    return {
      ...edge,
      findingIds,
      findingCount: findingIds.length,
      selectedFindingIds: selectedInEdge,
      selectedFindingCount: selectedInEdge.length,
      highestSeverity: computeHighestSeverity(edgeSeverities),
    }
  })

  return {
    nodes: updatedNodes,
    edges: updatedEdges,
    globalFindings,
    v2Findings,
  }
}
