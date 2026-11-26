import type { KgFact } from './chatProtocol'
import type { AssistantEventGraph, AssistantEventNode, AssistantEventEdge } from './types'

const string = (value: unknown) => typeof value === 'string' ? value : ''
const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
const unique = (values: string[]) => [...new Set(values)]
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const at = (node: AssistantEventNode) => node.occurredAt && Number.isFinite(Date.parse(node.occurredAt)) ? Date.parse(node.occurredAt) : Infinity
const sortNodes = (nodes: AssistantEventNode[]) => nodes.sort((a, b) => at(a) - at(b) || compare(a.key, b.key))

/** Only facts that survived the model-output cap become visible graph evidence. */
export function eventGraphFromFacts(facts: readonly KgFact[], truncated = false): AssistantEventGraph {
  const graph: AssistantEventGraph = { nodes: [], edges: [], scopes: [] }
  for (const fact of facts) {
    const d = fact.data ?? {}
    const actor = d.actor && typeof d.actor === 'object' ? d.actor as Record<string, unknown> : {}
    const targets = Array.isArray(d.targets) ? d.targets : []
    const participants: AssistantEventNode['participants'] = []
    if (string(actor.objectKey)) participants.push({ objectKey: string(actor.objectKey), role: 'actor' })
    for (const target of targets) if (target && typeof target === 'object' && string(target.objectKey)) {
      if (!participants.some(p => p.objectKey === target.objectKey && p.role === 'target')) participants.push({ objectKey: target.objectKey, role: 'target' })
    }
    if (fact.kind === 'event') graph.nodes.push({ key: fact.ref, label: fact.label, provider: string(d.provider), occurredAt: string(d.occurredAt) || null,
      outcome: string(d.outcome), suspicious: d.suspicious === true, detail: fact.detail ?? fact.label, evidenceIds: [fact.id], participants, participantsTruncated: d.targetsTruncated === true })
    else if (fact.kind === 'event_link' && typeof d.from === 'string' && typeof d.to === 'string') graph.edges.push({ key: fact.ref, from: d.from, to: d.to, label: fact.label,
      basis: string(d.basis), bases: strings(d.bases), strength: d.strength === 'confirmed' ? 'confirmed' : 'review', detail: fact.detail ?? fact.label,
      missingEndpoints: strings(d.missingEndpoints), evidenceIds: [fact.id] })
    else if (fact.ref.startsWith('logs:') && d.queryId) graph.scopes.push({ evidenceId: fact.id, available: !d.error && d.state !== 'failed', total: typeof d.storedCount === 'number' ? d.storedCount : null,
      nextOffset: typeof d.offset === 'number' && typeof d.shown === 'number' && typeof d.storedCount === 'number' && d.offset + d.shown < d.storedCount ? d.offset + d.shown : null, detail: fact.detail ?? fact.label, truncated })
    else if (fact.ref.startsWith('events:')) graph.scopes.push({ evidenceId: fact.id, eventKey: string(d.eventKey) || undefined, available: d.available === true,
      ...(typeof d.linksAvailable === 'boolean' ? { linksAvailable: d.linksAvailable } : {}), ...(typeof d.eventFound === 'boolean' ? { eventFound: d.eventFound } : {}),
      total: typeof d.total === 'number' ? d.total : null, nextOffset: typeof d.nextOffset === 'number' ? d.nextOffset : null, detail: fact.detail ?? fact.label, truncated })
  }
  return { ...graph, nodes: sortNodes(graph.nodes) }
}

export function mergeEventGraphs(graphs: readonly AssistantEventGraph[]): AssistantEventGraph {
  const nodes = new Map<string, AssistantEventNode>(), edges = new Map<string, AssistantEventEdge>()
  for (const graph of graphs) {
    for (const n of graph.nodes) nodes.set(n.key, { ...n, evidenceIds: unique([...(nodes.get(n.key)?.evidenceIds ?? []), ...n.evidenceIds]) })
    for (const e of graph.edges) edges.set(e.key, { ...e, evidenceIds: unique([...(edges.get(e.key)?.evidenceIds ?? []), ...e.evidenceIds]) })
  }
  const known = new Set(nodes.keys())
  return { nodes: sortNodes([...nodes.values()]), edges: [...edges.values()].map(e => ({ ...e, missingEndpoints: [e.from, e.to].filter(k => !known.has(k)) })),
    scopes: [...new Map(graphs.flatMap(g => g.scopes).map(s => [s.evidenceId, s])).values()] }
}

/** Keep only event nodes cited in the answer and edges whose endpoints remain; fall back to full graph if none match. */
export function citedEventGraph(graph: AssistantEventGraph, citedIds: ReadonlySet<string>): AssistantEventGraph {
  if (!citedIds.size) return graph
  const nodes = graph.nodes.filter(node => node.evidenceIds.some(id => citedIds.has(id)))
  if (!nodes.length) return graph
  const known = new Set(nodes.map(node => node.key))
  const edges = graph.edges
    .filter(edge => known.has(edge.from) && known.has(edge.to))
    .map(edge => ({ ...edge, missingEndpoints: [edge.from, edge.to].filter(k => !known.has(k)) }))
  return { ...graph, nodes, edges }
}

/** Join only published object keys. Never infer identity from labels or provider names. */
export function matchEventsToObjects(graph: AssistantEventGraph, objects: ReadonlyMap<string, unknown>) {
  const byObject = new Map<string, AssistantEventNode[]>()
  const unmatched: AssistantEventNode[] = [], partial: AssistantEventNode[] = []
  for (const event of graph.nodes) {
    const keys = unique(event.participants.map(p => p.objectKey))
    const matched = keys.filter(key => objects.has(key))
    if (!matched.length) unmatched.push(event)
    else if (matched.length < keys.length || event.participantsTruncated) partial.push(event)
    for (const key of matched) byObject.set(key, [...(byObject.get(key) ?? []), event])
  }
  return { byObject, unmatched, partial }
}

/** Aggregate member objects without counting the same event twice. */
export function eventsForObjects(byObject: ReadonlyMap<string, AssistantEventNode[]>, keys: readonly string[]) {
  return sortNodes([...new Map(keys.flatMap(key => byObject.get(key) ?? []).map(event => [event.key, event])).values()])
}
