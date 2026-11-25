import type { FindingV2 } from '../model/findingV2'
import type { GraphStoreV2 } from '../model/graph'
import type { EvidenceStore } from '../model/evidence'
import type { Provider } from '../model/object'
import { EdgeIndex } from '../detection/v2/engine'

export interface ThreatSpreadHop {
  key: string
  depth: number
  via?: string
}

export interface ThreatSpreadResult {
  origin: string
  hops: ThreatSpreadHop[]
  providers: Provider[]
  objectCount: number
  truncated?: boolean
}

export interface ThreatSpreadOptions {
  edgeIndex?: EdgeIndex
  maxDepth?: number
  maxObjects?: number
  noCache?: boolean
}

const DEFAULT_MAX_DEPTH = 3
const DEFAULT_MAX_OBJECTS = 200

/* 데이터셋(그래프)이 바뀌면 다시 계산한다 */
let spreadCache = new WeakMap<GraphStoreV2, Map<string, ThreatSpreadResult | null>>()
const edgeIndexCache = new WeakMap<GraphStoreV2, EdgeIndex>()

export function getOrBuildEdgeIndex(graph: GraphStoreV2, evidenceStore: EvidenceStore): EdgeIndex {
  let ix = edgeIndexCache.get(graph)
  if (!ix) {
    ix = new EdgeIndex(graph, evidenceStore)
    edgeIndexCache.set(graph, ix)
  }
  return ix
}

/**
 * 위협 상세가 쓰는 확산 범위. 게시본은 엔진이 위협 판정과 같은 간선으로 계산해 실은 값(finding.spread)을 쓰고,
 * 칸이 없을 때(로컬 데이터, 2026-11-12 이전 스냅샷)만 여기서 계산한다
 */
export function findingSpread(finding: FindingV2, graph: GraphStoreV2, evidenceStore: EvidenceStore): ThreatSpreadResult | null {
  return finding.spread !== undefined ? finding.spread : threatSpread(finding, graph, evidenceStore)
}

/**
 * 위협 확산 탐색 — AccessEngine 간선(EdgeIndex)으로 영향이 퍼지는 방향으로 최대 3홉 탐색.
 */
export function threatSpread(
  finding: FindingV2,
  graph: GraphStoreV2,
  evidenceStore: EvidenceStore,
  opts?: ThreatSpreadOptions,
): ThreatSpreadResult | null {
  const origin = finding.involvedObjectKeys?.[0]
  if (!origin) return null

  const cacheKey = finding.id
  let cache = spreadCache.get(graph)
  if (!cache) spreadCache.set(graph, (cache = new Map()))
  if (!opts?.noCache && cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null
  }

  const ix = opts?.edgeIndex ?? getOrBuildEdgeIndex(graph, evidenceStore)
  const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxObjects = opts?.maxObjects ?? DEFAULT_MAX_OBJECTS

  const seen = new Set<string>([origin])
  const hops: ThreatSpreadHop[] = []
  const queue: Array<{ key: string; depth: number }> = [{ key: origin, depth: 0 }]
  let truncated = false

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.depth >= maxDepth) continue

    // 영향이 퍼지는 방향:
    // 1. outOf: G(권한), T(트리거), A(대행), F(사본), E(효과), M(소속)
    const outEdges = ix.outOf(current.key).filter(e => e.kind !== 'U')
    // 2. inOf U: 상위 범위에서 하위 범위로 권한 전파
    const inU = ix.inOf(current.key, 'U')

    const nextCandidates: Array<{ key: string; via: string }> = []
    for (const e of outEdges) {
      if (graph.objectsByKey.has(e.to)) {
        nextCandidates.push({ key: e.to, via: e.kind })
      }
    }
    for (const e of inU) {
      if (graph.objectsByKey.has(e.from)) {
        nextCandidates.push({ key: e.from, via: 'U' })
      }
    }

    for (const next of nextCandidates) {
      if (seen.has(next.key)) continue
      seen.add(next.key)

      if (hops.length >= maxObjects) {
        truncated = true
        break
      }

      hops.push({
        key: next.key,
        depth: current.depth + 1,
        via: next.via,
      })
      queue.push({ key: next.key, depth: current.depth + 1 })
    }

    if (truncated) break
  }

  const providers = [
    ...new Set(
      hops
        .map(h => graph.objectsByKey.get(h.key)?.canonical.provider)
        .filter((p): p is Provider => Boolean(p)),
    ),
  ]

  const result: ThreatSpreadResult = {
    origin,
    hops,
    providers,
    objectCount: hops.length,
    ...(truncated ? { truncated: true } : {}),
  }

  if (!opts?.noCache) {
    cache.set(cacheKey, result)
  }

  return result
}
