/**
 * 노드 키 -> 그 노드에 걸린 기준별 설정 finding 역색인.
 * 선택한 판정 이력이나 로컬 파일이 없으면 빈 Map 이다(조용히 빠진다. 선택 문서).
 */
import { getStandardResults, type StandardResults } from './standardResultsStore'

export interface NodeFinding { standard: string; item_id: string; status: string; text: string; layer: string; group: string; findingId: string }

const STATUS_RANK: Record<string, number> = { fail: 0, unknown: 1, org_policy: 2, manual: 3, pass: 4, not_collected: 5 }

function build(loaded: StandardResults | undefined): Map<string, NodeFinding[]> {
  const idx = new Map<string, NodeFinding[]>()
  for (const f of loaded?.findings ?? []) {
    for (const i of f.items) {
      const keys = new Set(i.targets.map(t => t.key))
      for (const key of keys) {
        const list = idx.get(key) ?? []
        list.push({ standard: i.standard, item_id: i.item_id, status: i.status, text: f.text, layer: f.layer, group: f.group, findingId: f.id })
        idx.set(key, list)
      }
    }
  }
  for (const list of idx.values()) list.sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9))
  return idx
}

let index: { source: StandardResults | undefined; map: Map<string, NodeFinding[]> } | undefined

/** 이 노드 키에 걸린 기준별 finding. 위반(fail)이 먼저 오도록 정렬돼 있다. 판정 결과가 바뀌면 다시 만든다 */
export function nodeStandardFindings(key: string): NodeFinding[] {
  const source = getStandardResults()
  if (!index || index.source !== source) index = { source, map: build(source) }
  return index.map.get(key) ?? []
}
