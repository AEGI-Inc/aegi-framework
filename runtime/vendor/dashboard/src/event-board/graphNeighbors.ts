/**
 * 그래프 이웃 객체 탐색 및 조회 범위 계산.
 * BFS 양방향 탐색, 최단 경로, 관계 키 순 정렬, 허브 건너뛰기, 순수 함수.
 */
import { MAX_SCOPE_OBJECTS } from '../timeline/timelineAnalysis'
import type { ResolvedRelation } from '../model/relation'

export interface PathStep {
  relationKey: string
  type: string
  from: string
  to: string
}

export interface NeighborObject {
  key: string
  hop: 0 | 1 | 2
  path: PathStep[]
  relationNeighbors?: number
}

export interface NeighborExpansion {
  objects: NeighborObject[]
  typeCounts: Record<string, number>
  hubsSkipped: string[]
}

export interface ExpandNeighborsOptions {
  hops: 1 | 2
  relationTypes?: string[]
  hubLimit?: number
}

export interface GraphLike {
  relationsByKey?: Map<string, ResolvedRelation>
  outgoingRelationsByObject?: Map<string, ResolvedRelation[]>
  incomingRelationsByObject?: Map<string, ResolvedRelation[]>
  objectsByKey?: Map<string, unknown>
}

/** 객체의 관계 이웃 수 (방향 불문, 중복 제외, 자기 자신 제외) */
export function getRelationNeighborCount(graph: GraphLike, key: string): number {
  const neighbors = new Set<string>()
  for (const r of graph.outgoingRelationsByObject?.get(key) ?? []) {
    const other = r.targetKey
    if (other && other !== key) neighbors.add(other)
  }
  for (const r of graph.incomingRelationsByObject?.get(key) ?? []) {
    const other = r.sourceKey
    if (other && other !== key) neighbors.add(other)
  }
  return neighbors.size
}

function comparePaths(a: PathStep[], b: PathStep[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const cmp = a[i]!.relationKey.localeCompare(b[i]!.relationKey)
    if (cmp !== 0) return cmp
  }
  return a.length - b.length
}

/**
 * 시작 객체들로부터 1~2단계 이웃 객체를 양방향 너비 우선으로 탐색한다.
 * 최단 경로를 보존하며 길이가 같으면 관계 키 순으로 결정적 타이브레이크를 한다.
 */
export function expandNeighbors(
  graph: GraphLike,
  seeds: string[],
  opts: ExpandNeighborsOptions,
): NeighborExpansion {
  const hops = opts.hops
  const hubLimit = opts.hubLimit ?? 40
  const allowedTypes = opts.relationTypes ? new Set(opts.relationTypes) : null

  // 고유 시작 객체 목록
  const uniqueSeeds: string[] = []
  const seedSet = new Set<string>()
  for (const s of seeds) {
    if (s && !seedSet.has(s)) {
      seedSet.add(s)
      uniqueSeeds.push(s)
    }
  }

  // 필터 적용 전 시작 객체 주변의 관계 종류별 수집
  const typeCounts: Record<string, number> = {}
  const seedRelKeys = new Set<string>()
  for (const s of uniqueSeeds) {
    for (const r of graph.outgoingRelationsByObject?.get(s) ?? []) {
      if (!seedRelKeys.has(r.relationKey)) {
        seedRelKeys.add(r.relationKey)
        typeCounts[r.relationType] = (typeCounts[r.relationType] ?? 0) + 1
      }
    }
    for (const r of graph.incomingRelationsByObject?.get(s) ?? []) {
      if (!seedRelKeys.has(r.relationKey)) {
        seedRelKeys.add(r.relationKey)
        typeCounts[r.relationType] = (typeCounts[r.relationType] ?? 0) + 1
      }
    }
  }

  // BFS 방문 기록
  const visited = new Map<string, { hop: 0 | 1 | 2; path: PathStep[]; relationNeighbors: number }>()
  for (const s of uniqueSeeds) {
    visited.set(s, {
      hop: 0,
      path: [],
      relationNeighbors: getRelationNeighborCount(graph, s),
    })
  }

  const hubsSkippedSet = new Set<string>()
  let currentFrontier = uniqueSeeds.slice()

  for (let currentHop = 0; currentHop < hops; currentHop++) {
    const nextHop = (currentHop + 1) as 1 | 2
    const nextFrontier: string[] = []

    for (const currKey of currentFrontier) {
      // 나가는 관계와 들어오는 관계 모두 수집
      const candidates: Array<{ rel: ResolvedRelation; neighborKey: string }> = []

      for (const r of graph.outgoingRelationsByObject?.get(currKey) ?? []) {
        if (!allowedTypes || allowedTypes.has(r.relationType)) {
          if (r.targetKey && r.targetKey !== currKey) {
            candidates.push({ rel: r, neighborKey: r.targetKey })
          }
        }
      }

      for (const r of graph.incomingRelationsByObject?.get(currKey) ?? []) {
        if (!allowedTypes || allowedTypes.has(r.relationType)) {
          if (r.sourceKey && r.sourceKey !== currKey) {
            candidates.push({ rel: r, neighborKey: r.sourceKey })
          }
        }
      }

      // 결정적 tie-break를 위해 관계 키 순 정렬
      candidates.sort((a, b) => a.rel.relationKey.localeCompare(b.rel.relationKey))

      const currPath = visited.get(currKey)!.path

      for (const { rel, neighborKey: v } of candidates) {
        if (seedSet.has(v)) continue

        const vDegree = getRelationNeighborCount(graph, v)
        if (vDegree > hubLimit) {
          hubsSkippedSet.add(v)
          continue
        }

        const candidateStep: PathStep = {
          relationKey: rel.relationKey,
          type: rel.relationType,
          from: rel.sourceKey,
          to: rel.targetKey,
        }
        const candidatePath = [...currPath, candidateStep]

        const existing = visited.get(v)
        if (!existing) {
          visited.set(v, {
            hop: nextHop,
            path: candidatePath,
            relationNeighbors: vDegree,
          })
          nextFrontier.push(v)
        } else if (existing.hop === nextHop) {
          if (comparePaths(candidatePath, existing.path) < 0) {
            existing.path = candidatePath
          }
        }
      }
    }

    currentFrontier = [...new Set(nextFrontier)]
  }

  const objects: NeighborObject[] = [...visited.entries()].map(([key, info]) => ({
    key,
    hop: info.hop,
    path: info.path,
    relationNeighbors: info.relationNeighbors,
  }))

  const hubsSkipped = [...hubsSkippedSet].sort((a, b) => a.localeCompare(b))

  return {
    objects,
    typeCounts,
    hubsSkipped,
  }
}

/**
 * 이웃 객체들을 정렬하여 질의 범위(최대 max개)와 상한 초과(dropped)로 나눈다.
 * 순서: 시작 객체(hop 0) → 1단계(hop 1) → 2단계(hop 2).
 * 같은 단계 안에서는 관계 이웃이 적은 객체(덜 허브) 우선, 그다음 키 순.
 */
export function neighborScope(
  exp: NeighborExpansion,
  max = MAX_SCOPE_OBJECTS,
): { objectKeys: string[]; dropped: string[] } {
  const byHop: Record<0 | 1 | 2, NeighborObject[]> = { 0: [], 1: [], 2: [] }
  for (const o of exp.objects) {
    if (byHop[o.hop]) byHop[o.hop].push(o)
  }

  const sortFn = (a: NeighborObject, b: NeighborObject) =>
    (a.relationNeighbors ?? 0) - (b.relationNeighbors ?? 0) || a.key.localeCompare(b.key)

  byHop[0].sort(sortFn)
  byHop[1].sort(sortFn)
  byHop[2].sort(sortFn)

  const ordered = [...byHop[0], ...byHop[1], ...byHop[2]].map(o => o.key)

  return {
    objectKeys: ordered.slice(0, max),
    dropped: ordered.slice(max),
  }
}
