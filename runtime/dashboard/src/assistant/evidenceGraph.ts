import { buildGraphStoreV2 } from '../data/datasetStore'
import type { GraphStoreV2 } from '../model/graph'
import type { EvidenceGraphSelection, IdentityEvidenceEdge } from './types'
import { identityEvidenceEdges } from './query'

const blank = (): EvidenceGraphSelection => ({ objectKeys: [], relationKeys: [], linkIds: [], identityEdges: [] })

/** Page complete evidence packets rather than cutting off relation endpoints or silently losing evidence. */
export function evidenceGraphPages(graph: GraphStoreV2, selection: EvidenceGraphSelection, nodeLimit = 40, edgeLimit = 80): EvidenceGraphSelection[] {
  const pages: EvidenceGraphSelection[] = []
  let page = blank()
  const insert = (objects: string[], relation?: string, edge?: IdentityEvidenceEdge) => {
    const keys = [...new Set(objects)].filter(k => graph.objectsByKey.has(k))
    const combined = [...new Set([...page.objectKeys, ...keys])]
    if (page.objectKeys.length && (combined.length > nodeLimit || page.relationKeys.length + page.identityEdges.length + Number(!!relation || !!edge) > edgeLimit)) {
      pages.push(page); page = blank()
    }
    page.objectKeys = [...new Set([...page.objectKeys, ...keys])]
    if (relation) page.relationKeys.push(relation)
    if (edge) { page.identityEdges.push(edge); if (!page.linkIds.includes(edge.linkId)) page.linkIds.push(edge.linkId) }
  }
  for (const key of [...new Set(selection.relationKeys)]) {
    const rel = graph.relationsByKey.get(key)
    if (rel) insert([rel.sourceKey, rel.targetKey, ...(rel.roleKey ? [rel.roleKey] : [])], key)
  }
  for (const edge of selection.identityEdges) insert([edge.from, edge.to], undefined, edge)
  const used = new Set([...pages.flatMap(p => p.objectKeys), ...page.objectKeys])
  for (const key of selection.objectKeys) if (!used.has(key)) { insert([key]); used.add(key) }
  if (page.objectKeys.length) pages.push(page)
  return pages
}

/** Rebuild every index. Retaining the full graph's adjacency would leak unselected neighbors. */
export function buildEvidenceGraph(graph: GraphStoreV2, selection: EvidenceGraphSelection): GraphStoreV2 {
  const keys = new Set(selection.objectKeys)
  const objects = [...keys].flatMap(key => { const object = graph.objectsByKey.get(key); return object ? [object] : [] })
  const relations = [...new Set(selection.relationKeys)].flatMap(key => {
    const rel = graph.relationsByKey.get(key)
    return rel && keys.has(rel.sourceKey) && keys.has(rel.targetKey) && (!rel.roleKey || keys.has(rel.roleKey)) ? [rel.raw] : []
  })
  const links = [...new Set(selection.linkIds)].flatMap(id => {
    const link = graph.linksById.get(id)
    if (!link) return []
    const valid = identityEvidenceEdges(graph, link, 'all')
    const edges = selection.identityEdges.filter(e => e.linkId === id && keys.has(e.from) && keys.has(e.to) && valid.some(v => v.from === e.from && v.to === e.to && v.level === e.level))
    if (!edges.length) return []
    const members = new Set(edges.flatMap(e => [e.from, e.to]))
    return [{ ...link, set: link.set.filter(m => members.has(m.object_key)), meta: { ...link.meta, edges: edges.map(e => ({ a: e.from, b: e.to, level: e.level })) } }]
  })
  return buildGraphStoreV2(objects, relations, links)
}
