import type { GraphStoreV2 } from '../model/graph'
import type { IdentityLink } from '../model/link'
import type { FixtureObject } from '../model/object'
import { judgeSamePerson, principalKind } from '../detection/v2/identity'
import { searchObjects } from '../semantic-graph/investigationQuery'
import { CANDIDATE_LIMIT, type AssistantFocus, type AssistantPlan } from './plan'
import type { AssistantCandidates, IdentityEvidenceEdge } from './types'

export const objectName = (object: FixtureObject | undefined, key: string): string =>
  String(object?.fixture_meta?.display_name || object?.canonical.properties.name || object?.canonical.properties.login || object?.canonical.properties.email || key)
export const objectLabel = (graph: GraphStoreV2, key: string): string => objectName(graph.objectsByKey.get(key), key)
export const providerLabel = (provider: string) => ({ github: 'GitHub', slack: 'Slack', okta: 'Okta', gws: 'Google Workspace', atlassian: 'Atlassian', salesforce: 'Salesforce' })[provider] ?? provider

export function assistantCandidates(graph: GraphStoreV2, plan: AssistantPlan, focus: AssistantFocus = {}): AssistantCandidates {
  if (!('entity' in plan) || !plan.entity) return { keys: [], truncated: false }
  const entity = plan.entity
  if (entity.reference) {
    const key = entity.reference === 'source' ? focus.sourceKey : focus.targetKey
    return { keys: key && graph.objectsByKey.has(key) ? [key] : [], truncated: false }
  }
  const text = entity.text.trim().toLocaleLowerCase()
  const candidates = searchObjects(graph, entity.text, graph.objectsByKey.size).filter(key => {
    const object = graph.objectsByKey.get(key)!
    return (!entity.provider || object.canonical.provider === entity.provider) && (plan.intent !== 'identity_lookup' || principalKind(object) === 'human')
  })
  const exact = candidates.filter(key => {
    const obj = graph.objectsByKey.get(key)!
    return [key, objectLabel(graph, key), obj.canonical.properties.email, obj.canonical.properties.login].some(v => typeof v === 'string' && v.toLocaleLowerCase() === text)
  })
  const result = exact.length ? exact : candidates
  return { keys: result.slice(0, CANDIDATE_LIMIT), truncated: result.length > CANDIDATE_LIMIT }
}

const samePersonLevel = (level: string) => ['resolved', 'disclosed_relation', 'candidate', 'inferred', 'possibly_same'].includes(level)

/** Keep actual per-pair edges; set membership alone is never a v2 direct connection. */
export function identityEvidenceEdges(graph: GraphStoreV2, link: IdentityLink, scope: 'person' | 'all' = 'person'): IdentityEvidenceEdge[] {
  if (scope === 'person' && link.meta?.kind && link.meta.kind !== 'person') return []
  const members = new Set(link.set.filter(m => graph.objectsByKey.has(m.object_key) && (scope === 'all' || principalKind(graph.objectsByKey.get(m.object_key)) === 'human')).map(m => m.object_key))
  const raw = link.meta?.edges
  if (Array.isArray(raw)) return raw.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const edge = value as { a?: unknown; b?: unknown; level?: unknown }
    if (typeof edge.a !== 'string' || typeof edge.b !== 'string' || typeof edge.level !== 'string' || !(samePersonLevel(edge.level) || (scope === 'all' && ['different', 'possibly_related'].includes(edge.level))) || edge.a === edge.b || !members.has(edge.a) || !members.has(edge.b)) return []
    if (scope === 'person' && !judgeSamePerson(edge.a, edge.b, graph).same) return []
    return [{ linkId: link.link_id, from: edge.a, to: edge.b, level: edge.level }]
  })
  // Legacy complete person sets disclose membership, not a collected pair. Mark the set's provenance in the evidence.
  if (scope === 'person' && !samePersonLevel(link.level)) return []
  const keys = [...members]
  return keys.slice(1).filter(key => scope === 'all' || judgeSamePerson(keys[0], key, graph).same).map(key => ({ linkId: link.link_id, from: keys[0], to: key, level: link.level }))
}
