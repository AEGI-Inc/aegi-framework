import type { GraphStore, GraphStoreV2 } from '../model/graph'
import type { SemanticEdge, EdgeBundleKind, SemanticLevel, SemanticHierarchy, ExtraLinkEdge } from './types'
import type { IdentityEvidenceEdge } from '../assistant/types'
import {persistedServicePaths} from './servicePaths'

/**
 * Projects edges for a given semantic zoom level using the computed object hierarchy.
 *
 * Requirements (Implementation Spec):
 * - Must strictly separate canonical Relations from identity Resolutions/Links.
 * - For L4 ('object'), each Relation is a direct edge and each Identity Link is an identity resolution edge.
 * - For L1/L2/L3 ('ecosystem', 'tenant', 'scope'), multiple relations/resolutions between the same semantic node pair are bundled.
 */
// 관계의 근거 객체: 역할(roleKey)과 배정 행(via_assignment 등). 이 객체들은 관계의 시작, 끝이 아니라서 보조 간선으로 잇는다
export const BASIS_PROPERTIES = ['via_assignment', 'via_grant', 'session_activation', 'via_group'] as const
function basisObjectKeys(rel: { roleKey?: string; properties?: Record<string, unknown> }, objectsByKey: Map<string, unknown>): string[] {
  const out = new Set<string>()
  if (rel.roleKey && objectsByKey.has(rel.roleKey)) out.add(rel.roleKey)
  for (const name of BASIS_PROPERTIES) {
    const v = rel.properties?.[name]
    for (const x of Array.isArray(v) ? v : [v]) if (typeof x === 'string' && objectsByKey.has(x)) out.add(x)
  }
  return [...out]
}

export function projectEdges(
  graph: GraphStore | GraphStoreV2,
  hierarchyMap: Map<string, SemanticHierarchy>,
  level: SemanticLevel,
  identityEdges?: IdentityEvidenceEdge[],
  extraLinks?: ExtraLinkEdge[]
): SemanticEdge[] {
  function getNodeForObject(objKey: string): string | null {
    const h = hierarchyMap.get(objKey)
    if (!h) return null
    if (level === 'ecosystem') return h.ecosystemNodeId
    if (level === 'tenant') return h.tenantNodeId
    if (level === 'scope') return h.scopeNodeId
    return h.objectNodeId
  }

  function servicePathEdges():SemanticEdge[]{
    const groups=new Map<string,SemanticEdge>()
    for(const p of persistedServicePaths(graph)){
      const source=getNodeForObject(p.source_object_key),target=getNodeForObject(p.target_object_key)
      if(!source||!target||source===target)continue
      const id=level==='object'?p.id:`service-path:${source}->${target}`
      const edge=groups.get(id)??{id,sourceSemanticNodeId:source,targetSemanticNodeId:target,relationTypes:['service_path'],relationKeys:[],resolutionIds:[],relationCount:0,resolutionCount:0,findingIds:[],findingCount:0,kind:'service_path',servicePaths:[]}
      edge.servicePaths!.push(p);groups.set(id,edge)
    }
    return [...groups.values()]
  }
  if (level === 'object') {
    const edges: SemanticEdge[] = []

    // 1. Canonical relations
    if (graph.relationsByKey) {
      for (const rel of graph.relationsByKey.values()) {
        edges.push({
          id: rel.relationKey,
          sourceSemanticNodeId: rel.sourceKey,
          targetSemanticNodeId: rel.targetKey,
          relationTypes: [rel.relationType],
          relationKeys: [rel.relationKey],
          resolutionIds: [],
          relationCount: 1,
          resolutionCount: 0,
          findingIds: [],
          findingCount: 0,
          kind: 'canonical_bundle',
        })

        // 근거 객체(역할, 배정 행) -> 시작, 끝 보조 간선. 역할은 옛 id(:role->src)를 유지한다
        for (const basisKey of basisObjectKeys(rel, graph.objectsByKey)) {
          const tag = basisKey === rel.roleKey ? 'role' : `basis:${basisKey}`
          // Connect Role -> Source (Role assigned to Team / Principal). 근거가 끝점 자신이면 자기 고리라 그리지 않는다
          if (basisKey !== rel.sourceKey) edges.push({
            id: `${rel.relationKey}:${tag}->src`,
            sourceSemanticNodeId: basisKey,
            targetSemanticNodeId: rel.sourceKey,
            relationTypes: ['policy_assignment'],
            relationKeys: [rel.relationKey],
            resolutionIds: [],
            relationCount: 1,
            resolutionCount: 0,
            findingIds: [],
            findingCount: 0,
            kind: 'policy_assignment',
          })
          // Connect Role -> Target (Role granting access to Resource / Tenant)
          if (basisKey !== rel.targetKey) edges.push({
            id: `${rel.relationKey}:${tag}->tgt`,
            sourceSemanticNodeId: basisKey,
            targetSemanticNodeId: rel.targetKey,
            relationTypes: ['policy_assignment'],
            relationKeys: [rel.relationKey],
            resolutionIds: [],
            relationCount: 1,
            resolutionCount: 0,
            findingIds: [],
            findingCount: 0,
            kind: 'policy_assignment',
          })
        }
      }
    }

    // 1-2. 넘겨받은 연결 선(ExtraLinkEdge). 같은 두 객체 사이에 수집된 관계가 있으면 그 선을 쓴다
    if (extraLinks?.length) {
      const pairs = new Set(edges.flatMap(e => [`${e.sourceSemanticNodeId}|${e.targetSemanticNodeId}`, `${e.targetSemanticNodeId}|${e.sourceSemanticNodeId}`]))
      for (const [index, link] of extraLinks.entries()) {
        if (!graph.objectsByKey.has(link.from) || !graph.objectsByKey.has(link.to) || pairs.has(`${link.from}|${link.to}`)) continue
        pairs.add(`${link.from}|${link.to}`).add(`${link.to}|${link.from}`)
        edges.push({ id: `extra-link:${index}:${link.from}->${link.to}`, sourceSemanticNodeId: link.from, targetSemanticNodeId: link.to,
          relationTypes: link.relationTypes, relationKeys: [], resolutionIds: [], relationCount: 0, resolutionCount: 0,
          findingIds: [], findingCount: 0, kind: 'canonical_bundle' })
      }
    }

    // 2. Identity Links (v2)
    if (identityEdges !== undefined) {
      for (const [index, edge] of identityEdges.entries()) {
        const link = graph.linksById?.get(edge.linkId)
        if (!link || !graph.objectsByKey.has(edge.from) || !graph.objectsByKey.has(edge.to)) continue
        const raw = link.meta?.edges
        if (!Array.isArray(raw) || !raw.some(e => e.a === edge.from && e.b === edge.to && e.level === edge.level)) continue
        edges.push({ id: `${edge.linkId}:evidence:${index}`, identityLevel: edge.level, sourceSemanticNodeId: edge.from, targetSemanticNodeId: edge.to,
          relationTypes: ['identity_resolution'], relationKeys: [], resolutionIds: [edge.linkId], relationCount: 0, resolutionCount: 1,
          findingIds: [], findingCount: 0, kind: 'resolution_bundle' })
      }
    } else if (graph.linksById) {
      for (const link of graph.linksById.values()) {
        const members = link.set ?? []
        for (let i = 0; i < members.length - 1; i++) {
          edges.push({
            id: `${link.link_id}-${i}`,
            sourceSemanticNodeId: members[i].object_key,
            targetSemanticNodeId: members[i + 1].object_key,
            relationTypes: ['identity_resolution'],
            relationKeys: [],
            resolutionIds: [link.link_id],
            relationCount: 0,
            resolutionCount: 1,
            findingIds: [],
            findingCount: 0,
            kind: 'resolution_bundle',
          })
        }
      }
    }

    // 3. Legacy Cross-SaaS resolutions (if present)
    if (graph.resolutionsById) {
      for (const res of graph.resolutionsById.values()) {
        if (res.members && res.members.length >= 2) {
          const keys = res.members.map(m => m.fixture_key)
          for (let i = 0; i < keys.length - 1; i++) {
            edges.push({
              id: `${res.resolution_id}-${i}`,
              sourceSemanticNodeId: keys[i],
              targetSemanticNodeId: keys[i + 1],
              relationTypes: [res.resolution_type],
              relationKeys: [],
              resolutionIds: [res.resolution_id],
              relationCount: 0,
              resolutionCount: 1,
              findingIds: [],
              findingCount: 0,
              kind: 'resolution_bundle',
            })
          }
        }
      }
    }

    return [...edges,...servicePathEdges()]
  }

  // At L1, L2, L3, bundle edges by (sourceNode, targetNode, kind)
  const bundleMap = new Map<string, {
    source: string
    target: string
    relationTypes: Set<string>
    relationKeys: string[]
    resolutionIds: string[]
    hasRelations: boolean
    hasResolutions: boolean
    isPolicyAssignment: boolean
  }>()

  // 1. Canonical Relations & Policy Assignments
  if (graph.relationsByKey) {
    for (const rel of graph.relationsByKey.values()) {
      const srcNode = getNodeForObject(rel.sourceKey)
      const tgtNode = getNodeForObject(rel.targetKey)
      if (srcNode && tgtNode && srcNode !== tgtNode) {
        const bundleKey = `canon:${srcNode}->${tgtNode}`
        let bundle = bundleMap.get(bundleKey)
        if (!bundle) {
          bundle = {
            source: srcNode,
            target: tgtNode,
            relationTypes: new Set(),
            relationKeys: [],
            resolutionIds: [],
            hasRelations: true,
            hasResolutions: false,
            isPolicyAssignment: false,
          }
          bundleMap.set(bundleKey, bundle)
        }
        bundle.relationTypes.add(rel.relationType)
        bundle.relationKeys.push(rel.relationKey)
      }

      // 근거 객체(역할, 배정 행)의 노드를 시작, 끝 노드와 보조 간선으로 묶는다
      for (const basisKey of basisObjectKeys(rel, graph.objectsByKey)) {
        const roleNode = getNodeForObject(basisKey)
        if (roleNode && srcNode && roleNode !== srcNode) {
          const policySrcBundleKey = `policy:${roleNode}->${srcNode}`
          let pBundle = bundleMap.get(policySrcBundleKey)
          if (!pBundle) {
            pBundle = {
              source: roleNode,
              target: srcNode,
              relationTypes: new Set(),
              relationKeys: [],
              resolutionIds: [],
              hasRelations: false,
              hasResolutions: false,
              isPolicyAssignment: true,
            }
            bundleMap.set(policySrcBundleKey, pBundle)
          }
          pBundle.relationTypes.add('policy_assignment')
          if (!pBundle.relationKeys.includes(rel.relationKey)) {
            pBundle.relationKeys.push(rel.relationKey)
          }
        }

        if (roleNode && tgtNode && roleNode !== tgtNode) {
          const policyTgtBundleKey = `policy:${roleNode}->${tgtNode}`
          let pBundle = bundleMap.get(policyTgtBundleKey)
          if (!pBundle) {
            pBundle = {
              source: roleNode,
              target: tgtNode,
              relationTypes: new Set(),
              relationKeys: [],
              resolutionIds: [],
              hasRelations: false,
              hasResolutions: false,
              isPolicyAssignment: true,
            }
            bundleMap.set(policyTgtBundleKey, pBundle)
          }
          pBundle.relationTypes.add('policy_assignment')
          if (!pBundle.relationKeys.includes(rel.relationKey)) {
            pBundle.relationKeys.push(rel.relationKey)
          }
        }
      }
    }
  }

  // 2. Identity Links (v2)
  if (graph.linksById) {
    for (const link of graph.linksById.values()) {
      const members = link.set ?? []
      for (let i = 0; i < members.length - 1; i++) {
        const srcNode = getNodeForObject(members[i].object_key)
        const tgtNode = getNodeForObject(members[i + 1].object_key)
        if (!srcNode || !tgtNode || srcNode === tgtNode) continue

        const [k1, k2] = [srcNode, tgtNode].sort()
        const bundleKey = `res:${k1}<->${k2}`
        let bundle = bundleMap.get(bundleKey)
        if (!bundle) {
          bundle = {
            source: k1,
            target: k2,
            relationTypes: new Set(),
            relationKeys: [],
            resolutionIds: [],
            hasRelations: false,
            hasResolutions: true,
            isPolicyAssignment: false,
          }
          bundleMap.set(bundleKey, bundle)
        }
        bundle.relationTypes.add('identity_resolution')
        if (!bundle.resolutionIds.includes(link.link_id)) {
          bundle.resolutionIds.push(link.link_id)
        }
      }
    }
  }

  // 3. Legacy Cross-SaaS Resolutions
  if (graph.resolutionsById) {
    for (const res of graph.resolutionsById.values()) {
      if (res.members && res.members.length >= 2) {
        const keys = res.members.map(m => m.fixture_key)
        for (let i = 0; i < keys.length - 1; i++) {
          const srcNode = getNodeForObject(keys[i])
          const tgtNode = getNodeForObject(keys[i + 1])
          if (!srcNode || !tgtNode) continue
          if (srcNode === tgtNode) continue

          // Symmetric key for undirected resolution bundle
          const [k1, k2] = [srcNode, tgtNode].sort()
          const bundleKey = `res:${k1}<->${k2}`
          let bundle = bundleMap.get(bundleKey)
          if (!bundle) {
            bundle = {
              source: k1,
              target: k2,
              relationTypes: new Set(),
              relationKeys: [],
              resolutionIds: [],
              hasRelations: false,
              hasResolutions: true,
              isPolicyAssignment: false,
            }
            bundleMap.set(bundleKey, bundle)
          }
          bundle.relationTypes.add(res.resolution_type)
          if (!bundle.resolutionIds.includes(res.resolution_id)) {
            bundle.resolutionIds.push(res.resolution_id)
          }
        }
      }
    }
  }

  const result: SemanticEdge[] = []
  for (const [id, bundle] of bundleMap.entries()) {
    let kind: EdgeBundleKind = 'canonical_bundle'
    if (bundle.isPolicyAssignment) kind = 'policy_assignment'
    else if (bundle.hasResolutions && bundle.hasRelations) kind = 'mixed_bundle'
    else if (bundle.hasResolutions) kind = 'resolution_bundle'

    result.push({
      id,
      sourceSemanticNodeId: bundle.source,
      targetSemanticNodeId: bundle.target,
      relationTypes: Array.from(bundle.relationTypes),
      relationKeys: bundle.relationKeys,
      resolutionIds: bundle.resolutionIds,
      relationCount: bundle.relationKeys.length,
      resolutionCount: bundle.resolutionIds.length,
      findingIds: [],
      findingCount: 0,
      kind,
    })
  }

  return [...result,...servicePathEdges()]
}
