import type { GraphStore, GraphStoreV2 } from '../model/graph'

/** Search, neighborhood and path all use the same canonical GraphStore as the canvas. */
export type InvestigationGraph = GraphStore | GraphStoreV2
export interface InvestigationStep {
  from: string
  to: string
  edgeId: string
  kind: 'relation' | 'identity_link'
  relationType?: string
  forward?: boolean
}
export interface InvestigationPath {
  objects: string[]
  steps: InvestigationStep[]
  /** 수집된 관계에 없어 steps 로 못 넣은 객체 사이 연결(Explorer 의 엔진 간선). 그래프가 선으로 그린다 */
  links?: Array<{ from: string; to: string; relationTypes: string[] }>
}
export interface InvestigationOptions {
  maxHops?: number
  includeIdentityLinks?: boolean
  directed?: boolean
  relationTypes?: ReadonlySet<string>
  /** Explicit pairs prevent an identity set from becoming an invented complete graph. */
  identityPairs?: ReadonlyArray<{ from: string; to: string; edgeId: string }>
  maxStates?: number
}

export function searchObjects(graph: InvestigationGraph, term: string, limit = 50): string[] {
  const query = term.trim().toLocaleLowerCase()
  if (!query) return []
  const result: string[] = []
  for (const [key, object] of graph.objectsByKey) {
    const values = [key, object.fixture_meta?.display_name, object.canonical.provider, object.canonical.object_type,
      object.canonical.properties.name, object.canonical.properties.email, object.canonical.properties.login]
    if (values.some(value => value !== undefined && String(value).toLocaleLowerCase().includes(query))) {
      result.push(key)
      if (result.length >= limit) break
    }
  }
  return result
}

export function neighbors(graph: InvestigationGraph, key: string, options: InvestigationOptions = {}): InvestigationStep[] {
  if (!graph.objectsByKey.has(key)) return []
  const steps: InvestigationStep[] = []
  for (const rel of graph.outgoingRelationsByObject.get(key) ?? []) {
    if (options.relationTypes && !options.relationTypes.has(rel.relationType)) continue
    steps.push({ from: key, to: rel.targetKey, edgeId: rel.relationKey, kind: 'relation', relationType: rel.relationType, forward: true })
  }
  if (!options.directed) {
    for (const rel of graph.incomingRelationsByObject.get(key) ?? []) {
      if (options.relationTypes && !options.relationTypes.has(rel.relationType)) continue
      steps.push({ from: key, to: rel.sourceKey, edgeId: rel.relationKey, kind: 'relation', relationType: rel.relationType, forward: false })
    }
  }
  if (options.includeIdentityLinks) {
    if (options.identityPairs) {
      for (const pair of options.identityPairs) {
        const to = pair.from === key ? pair.to : pair.to === key ? pair.from : undefined
        if (to && graph.objectsByKey.has(to)) steps.push({ from: key, to, edgeId: pair.edgeId, kind: 'identity_link' })
      }
      return steps
    }
    for (const id of graph.linkIdsByObject?.get(key) ?? []) {
      const link = graph.linksById?.get(id)
      for (const member of link?.set ?? []) {
        if (member.object_key !== key && graph.objectsByKey.has(member.object_key)) {
          steps.push({ from: key, to: member.object_key, edgeId: id, kind: 'identity_link' })
        }
      }
    }
  }
  return steps
}

/** Returns a structural connection, never an effective-access or observed-activity claim. */
export function findInvestigationPath(
  graph: InvestigationGraph, source: string, target: string, options: InvestigationOptions = {}
): InvestigationPath | null {
  if (!graph.objectsByKey.has(source) || !graph.objectsByKey.has(target)) return null
  if (source === target) return { objects: [source], steps: [] }
  const maxHops = Math.max(0, Math.min(options.maxHops ?? 6, 12))
  const queue: InvestigationPath[] = [{ objects: [source], steps: [] }]
  const visited = new Set([source])
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]
    if (current.steps.length >= maxHops) continue
    const last = current.objects[current.objects.length - 1]
    for (const step of neighbors(graph, last, options)) {
      if (visited.has(step.to)) continue
      const next = { objects: [...current.objects, step.to], steps: [...current.steps, step] }
      if (step.to === target) return next
      visited.add(step.to)
      queue.push(next)
    }
  }
  return null
}

/** Returns several simple structural paths so the caller can let the analyst choose one. */
export function findInvestigationPaths(
  graph: InvestigationGraph, source: string, target: string, options: InvestigationOptions = {}, limit = 8
): InvestigationPath[] {
  return findBoundedInvestigationPaths(graph, source, target, options, limit).paths
}

export function findBoundedInvestigationPaths(
  graph: InvestigationGraph, source: string, target: string, options: InvestigationOptions = {}, limit = 8
): { paths: InvestigationPath[]; truncated: boolean } {
  if (!graph.objectsByKey.has(source) || !graph.objectsByKey.has(target)) return { paths: [], truncated: false }
  if (source === target) return { paths: [{ objects: [source], steps: [] }], truncated: false }
  const maxHops = Math.max(1, Math.min(options.maxHops ?? 6, 12))
  const maxStates = Math.max(1, Math.min(options.maxStates ?? 5000, 20000))
  limit = Math.max(1, Math.min(limit, 20))
  const queue: InvestigationPath[] = [{ objects: [source], steps: [] }]
  const found: InvestigationPath[] = []
  let truncated = false
  for (let index = 0; index < queue.length && found.length < limit; index++) {
    const current = queue[index]
    if (current.steps.length >= maxHops) continue
    const last = current.objects[current.objects.length - 1]
    for (const step of neighbors(graph, last, options)) {
      if (current.objects.includes(step.to)) continue
      const next = { objects: [...current.objects, step.to], steps: [...current.steps, step] }
      if (step.to === target) found.push(next)
      else if (queue.length < maxStates) queue.push(next)
      else truncated = true
      if (found.length >= limit) { truncated = true; break }
    }
  }
  return { paths: found.sort((a, b) => a.steps.length - b.steps.length), truncated }
}
