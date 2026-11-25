// 사례 시험(scripts/threat/cases.json)의 그래프를 판정 그래프로 옮겨 판정한다
import { judge, type JudgeEdge, type JudgeGraph, type JudgeNode } from './judge'

export interface CaseGraph {
  nodes: Record<string, unknown>[]
  edges: Record<string, unknown>[]
}

export function judgeCaseGraph(graph: CaseGraph) {
  const g: JudgeGraph = { nodes: {}, edges: graph.edges as unknown as JudgeEdge[] }
  for (const n of graph.nodes) {
    const { id, ...rest } = n as unknown as { id: string } & JudgeNode
    g.nodes[id] = rest
  }
  const { threats, trace } = judge(g)
  return {
    threats: threats.map(({ person, target, types, certainty, external }) => ({ person, target, types, certainty, ...(external ? { external } : {}) })),
    trace,
  }
}
