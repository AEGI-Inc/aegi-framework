import type { GraphStoreV2 } from '../model/graph'
import type { AssistantEvidence } from './types'

/**
 * 답변 말풍선 안의 작은 연결 그래프 배치.
 *
 * 모델이 그리지 않는다. 답변이 인용한 관계 근거만으로 코드가 만든다. 그래서 없는 연결은 그려지지 않는다.
 * SaaS 마다 가로 줄을 하나 두고(처음 나온 순서), 관계를 따라 왼쪽에서 오른쪽으로 칸을 매긴다.
 * 같은 칸이 줄을 바꾸면 세로 선이 되어 SaaS 를 넘는 지점이 바로 보인다.
 */
/** members: 묶은 노드의 객체 키. 같은 대상에 같은 관계로만 이어진 같은 종류 노드는 하나로 묶는다(위협 경로 그림의 「나머지 N명」과 같은 방식) */
export interface AnswerGraphNode { key: string; provider: string; column: number; row: number; x: number; y: number; members?: string[] }
export interface AnswerGraphEdge { key: string; from: string; to: string; relationType: string; roleName?: string }
export interface AnswerGraphLane { provider: string; top: number; height: number }
export interface AnswerGraphLayout { nodes: AnswerGraphNode[]; edges: AnswerGraphEdge[]; lanes: AnswerGraphLane[]; width: number; height: number; columns: number; columnWidth: number }

/** 관계가 이보다 적으면 그림이 글보다 나을 게 없어 띄우지 않는다 */
export const ANSWER_GRAPH_MIN_EDGES = 2
/** 묶은 뒤에도 이보다 많으면 말풍선 안에서 읽을 수 없어 「근거 그래프 열기」에 맡긴다 */
export const ANSWER_GRAPH_MAX_NODES = 12
const GUTTER = 52
const COLUMN = 96
/** 창이 좁을 때 칸 사이를 이만큼까지 줄인다. 더 좁으면 옆으로 민다 */
const MIN_COLUMN = 68
/** 창이 넓으면 칸 사이를 이만큼까지 넓혀 칸 사이 통로에 선과 선 이름이 들어갈 자리를 만든다 */
const MAX_COLUMN = 170
const END = 48
const ROW = 84
/** 줄 위쪽에서 노드 가운데까지. 줄 이름 아래로 노드를 내린다 */
const NODE_TOP = 42

export function answerGraphLayout(graph: GraphStoreV2, cited: readonly AssistantEvidence[]): AnswerGraphLayout | null {
  const edges: AnswerGraphEdge[] = []
  const seen = new Set<string>()
  for (const item of cited) {
    if (item.kind !== 'relation' || seen.has(item.ref)) continue
    const rel = graph.relationsByKey.get(item.ref)
    if (!rel || rel.sourceKey === rel.targetKey || !graph.objectsByKey.has(rel.sourceKey) || !graph.objectsByKey.has(rel.targetKey)) continue
    seen.add(item.ref)
    edges.push({ key: rel.relationKey, from: rel.sourceKey, to: rel.targetKey, relationType: rel.relationType, ...(rel.roleName ? { roleName: rel.roleName } : {}) })
  }
  if (edges.length < ANSWER_GRAPH_MIN_EDGES) return null
  const grouped = groupLeaves(graph, edges)
  const keys = [...new Set(grouped.edges.flatMap(e => [e.from, e.to]))]
  if (keys.length > ANSWER_GRAPH_MAX_NODES) return null

  // 가장 긴 경로로 칸을 매긴다. 고리가 있어도 노드 수만큼만 돌려 멈춘다
  const column = new Map(keys.map(k => [k, 0]))
  for (let i = 0; i < keys.length; i++) {
    let changed = false
    for (const e of grouped.edges) {
      const next = Math.min(column.get(e.from)! + 1, keys.length - 1)
      if (next > column.get(e.to)!) { column.set(e.to, next); changed = true }
    }
    if (!changed) break
  }
  // 들어오는 선이 없는 노드는 가장 가까운 도착 노드 바로 왼쪽으로 당긴다. 멀리 왼쪽에 두면 긴 사선이 다른 선을 가로질렀다
  for (const key of keys) {
    if (grouped.edges.some(e => e.to === key)) continue
    const targets = grouped.edges.filter(e => e.from === key).map(e => column.get(e.to)!)
    if (targets.length) column.set(key, Math.max(column.get(key)!, Math.min(...targets) - 1))
  }
  const used = [...new Set(column.values())].sort((a, b) => a - b)
  const providerOf = (key: string) => String(graph.objectsByKey.get(grouped.members.get(key)?.[0] ?? key)!.canonical.provider)
  const providers = [...new Set(keys.map(providerOf))]

  // 같은 줄 같은 칸에 노드가 여럿이면 줄 안에서 아래로 쌓는다. 이웃 노드 줄 순서의 평균으로 차례를 정해 선이 덜 엇갈리게 한다
  const colOf = (key: string) => used.indexOf(column.get(key)!)
  const order = new Map(keys.map((k, i) => [k, i]))
  const neighbors = (key: string) => grouped.edges.flatMap(e => e.from === key ? [e.to] : e.to === key ? [e.from] : [])
  const rank = (key: string) => providers.indexOf(providerOf(key)) * 1000 + order.get(key)!
  for (let sweep = 0; sweep < 4; sweep++) {
    const next = new Map(keys.map(k => {
      const near = neighbors(k).filter(n => colOf(n) !== colOf(k))
      return [k, near.length ? near.reduce((sum, n) => sum + rank(n), 0) / near.length : rank(k)] as const
    }))
    keys.slice().sort((a, b) => next.get(a)! - next.get(b)!).forEach((k, i) => order.set(k, i))
  }
  const rowsIn = new Map<string, number>()
  const placed = keys.slice().sort((a, b) => order.get(a)! - order.get(b)!).map(key => {
    const provider = providerOf(key)
    const col = colOf(key)
    const slot = `${provider}|${col}`
    const row = rowsIn.get(slot) ?? 0
    rowsIn.set(slot, row + 1)
    const members = grouped.members.get(key)
    return { key, provider, column: col, row, ...(members ? { members } : {}) }
  })
  let top = 0
  const lanes = providers.map(provider => {
    const rows = Math.max(...placed.filter(n => n.provider === provider).map(n => n.row + 1))
    // 마지막 줄 이름이 줄 아래 선에 닿지 않게 조금 띄운다
    const lane = { provider, top, height: rows * ROW + 8 }
    top += lane.height
    return lane
  })
  const laneTop = new Map(lanes.map(l => [l.provider, l.top]))
  const nodes = placed.map(n => ({ ...n, x: GUTTER + n.column * COLUMN, y: laneTop.get(n.provider)! + NODE_TOP + n.row * ROW }))
  return { nodes, edges: grouped.edges, lanes, width: GUTTER + (used.length - 1) * COLUMN + END, height: top, columns: used.length, columnWidth: COLUMN }
}

/**
 * 선이 하나뿐인 끝 노드 가운데 같은 SaaS, 같은 종류이고 같은 관계(역할 이름까지)로 같은 상대에 이어진 것을 하나로 묶는다.
 * 저장소 쓰기 권한자 세 명이 세 줄을 차지하던 것을 「계정 3개」 한 노드로 줄인다.
 */
function groupLeaves(graph: GraphStoreV2, edges: AnswerGraphEdge[]): { edges: AnswerGraphEdge[]; members: Map<string, string[]> } {
  const degree = new Map<string, number>()
  for (const e of edges) for (const k of [e.from, e.to]) degree.set(k, (degree.get(k) ?? 0) + 1)
  const bySig = new Map<string, AnswerGraphEdge[]>()
  for (const e of edges) {
    for (const [leaf, other, dir] of [[e.from, e.to, 'out'], [e.to, e.from, 'in']] as const) {
      if (degree.get(leaf) !== 1 || degree.get(other) === 1) continue
      const c = graph.objectsByKey.get(leaf)!.canonical
      const sig = `${dir}|${c.provider}|${c.object_type}|${e.relationType}|${e.roleName ?? ''}|${other}`
      bySig.set(sig, [...(bySig.get(sig) ?? []), e])
    }
  }
  const members = new Map<string, string[]>()
  const drop = new Set<AnswerGraphEdge>()
  const added: AnswerGraphEdge[] = []
  for (const [sig, group] of bySig) {
    if (group.length < 2) continue
    const out = sig.startsWith('out|')
    const keys = group.map(e => out ? e.from : e.to)
    const id = `group:${sig}`
    members.set(id, keys)
    group.forEach(e => drop.add(e))
    const first = group[0]!
    added.push({ ...first, key: id, from: out ? id : first.from, to: out ? first.to : id })
  }
  return { edges: [...edges.filter(e => !drop.has(e)), ...added], members }
}

/** 말풍선 폭에 맞춰 칸 사이를 줄이거나 넓힌다. 글자를 줄이지 않으려고 그림 전체를 축소하지 않는다 */
export function fitAnswerGraph(layout: AnswerGraphLayout, available: number): AnswerGraphLayout {
  if (layout.columns < 2 || !available) return layout
  const columnWidth = Math.min(MAX_COLUMN, Math.max(MIN_COLUMN, Math.floor((available - GUTTER - END) / (layout.columns - 1))))
  if (columnWidth === layout.columnWidth) return layout
  return { ...layout, columnWidth, width: GUTTER + (layout.columns - 1) * columnWidth + END, nodes: layout.nodes.map(n => ({ ...n, x: GUTTER + n.column * columnWidth })) }
}

/** 이 답변이 인용한 근거에 나온 SaaS. 처음 나온 순서 */
export function citedProviders(graph: GraphStoreV2, cited: readonly AssistantEvidence[]): string[] {
  const keys = cited.flatMap(item => {
    if (item.kind === 'relation') {
      const rel = graph.relationsByKey.get(item.ref)
      return rel ? [rel.sourceKey, rel.targetKey] : []
    }
    return item.kind === 'object' ? [item.ref] : []
  })
  return [...new Set(keys.flatMap(key => {
    const provider = graph.objectsByKey.get(key)?.canonical.provider
    return provider ? [String(provider)] : []
  }))]
}
