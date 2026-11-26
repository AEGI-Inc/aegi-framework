import type { GraphStore, GraphStoreV2 } from '../model/graph'
import { objectDisplayName } from './objectChip'
import { getPrimaryIdentifierValue } from '../utils/identifier'
export type CanonicalGraph = GraphStore | GraphStoreV2
export interface ObjectCondition { alias: string; provider?: string; objectType?: string; property?: string; value?: string }
export interface RelationshipCondition { from: string; to: string; type?: string; kind: 'relation' | 'identity' }
export interface GraphQueryMatch { objects: Record<string,string>; relationKeys: string[]; linkIds: string[] }
export interface GraphQueryResult { matches: GraphQueryMatch[]; truncated: boolean; error?: string }

/** Name/ID entry point, with no silent truncation or dependency on fixture metadata. */
export function matchObjectNames(graph: CanonicalGraph, term: string): string[] {
  const query = term.trim().toLocaleLowerCase()
  if (!query) return []
  return [...graph.objectsByKey.values()].filter(object => [object.fixture_key, objectDisplayName(object),
    object.canonical.properties.name, object.canonical.properties.email, object.canonical.properties.login,
    getPrimaryIdentifierValue(object)].some(value => value !== undefined && String(value).toLocaleLowerCase().includes(query)))
    .map(object => object.fixture_key)
}

export function validateGraphQuery(objects: ObjectCondition[], relationships: RelationshipCondition[]): string | null {
  if (!objects.length) return 'Add at least one Object condition.'
  if (objects.length > 6) return 'Advanced Query supports up to 6 Object aliases.'
  if (objects.some(object => !object.alias.trim())) return 'Every Object condition needs an alias.'
  if (new Set(objects.map(object => object.alias)).size !== objects.length) return 'Object aliases must be unique.'
  if (objects.some(object => object.value?.trim() && !object.property)) {
    return 'Choose a property before entering a value.'
  }
  if (objects.some(object => !object.provider && !object.objectType && !object.property && !object.value?.trim())) {
    return 'Each Object alias needs at least one condition.'
  }
  if (relationships.some(relation => !objects.some(object => object.alias === relation.from) || !objects.some(object => object.alias === relation.to))) {
    return 'Every Relation condition must reference an existing Object alias.'
  }
  if (relationships.some(relation => relation.from === relation.to)) {
    return 'A Relation condition must connect two different Object aliases.'
  }
  return null
}
export function matchObjects(graph: CanonicalGraph, condition: ObjectCondition): string[] {
  return [...graph.objectsByKey.values()].filter(object => {
    if (condition.provider && object.canonical.provider !== condition.provider) return false
    if (condition.objectType && object.canonical.object_type !== condition.objectType) return false
    const value = condition.property === 'fixture_key' ? object.fixture_key
      : condition.property === 'display_name' ? object.fixture_meta?.display_name
      : condition.property ? object.canonical.properties[condition.property] : undefined
    if (condition.property && (value === undefined || value === null)) return false
    return !condition.value || String(value).toLowerCase().includes(condition.value.toLowerCase())
  }).map(o => o.fixture_key)
}

export function executeGraphQueryResult(graph: CanonicalGraph, objects: ObjectCondition[], relationships: RelationshipCondition[], limit = 60): GraphQueryResult {
  const error = validateGraphQuery(objects, relationships)
  if (error) return { matches: [], truncated: false, error }
  const candidates = objects.map(o => matchObjects(graph, o))
  const assignment: Record<string, string> = {}
  const used = new Set<string>()
  const matches: GraphQueryMatch[] = []
  function verify(partial: boolean): { relationKeys: string[]; linkIds: string[] } | null {
    const relationKeys: string[] = []
    const linkIds: string[] = []
    for (const r of relationships) {
      const from = assignment[r.from]
      const to = assignment[r.to]
      if (!from || !to) { if (partial) continue; return null }
      if (r.kind === 'relation') {
        const relation = (graph.outgoingRelationsByObject.get(from) ?? []).find(rel =>
          rel.targetKey === to && (!r.type || r.type === rel.relationType))
        if (!relation) return null
        relationKeys.push(relation.relationKey)
      } else {
        const link = [...(graph.linksById?.values() ?? [])].find(item =>
          item.set.some(m => m.object_key === from) && item.set.some(m => m.object_key === to))
        if (!link) return null
        linkIds.push(link.link_id)
      }
    }
    return { relationKeys, linkIds }
  }
  function visit(i: number): void {
    if (matches.length > limit) return
    if (i === objects.length) {
      const evidence = verify(false)
      if (evidence) matches.push({ objects: { ...assignment }, ...evidence })
      return
    }
    for (const key of candidates[i]) {
      if (used.has(key)) continue
      assignment[objects[i].alias] = key
      used.add(key)
      if (verify(true)) visit(i + 1)
      used.delete(key)
      delete assignment[objects[i].alias]
      if (matches.length > limit) return
    }
  }
  visit(0)
  const truncated = matches.length > limit
  return { matches: matches.slice(0, limit), truncated }
}
