import type { GraphStore, GraphStoreV2 } from '../model/graph'
import type { EffectiveAccessRow } from '../detection/v2/effectiveAccess/types'
import { explainEaRow } from '../findings/eaExplain'
import { describeObject, providerProfile, SCOPE_KIND_MEANING, type ObjectFact } from './nodeInsight'
import type { SemanticNode } from './types'

export interface HoverDetails {
  title: string
  direction: string
  summary: string
  /** 한 줄로 읽는 규모 (「관계 3」, 「탐지 1」). 탐지가 있으면 강조한다 */
  stats?: Array<{ label: string; value: number; alert?: boolean }>
  /** 이름표와 값 (상세 패널 개요와 같은 사실) */
  facts?: ObjectFact[]
  notes: Array<{ kind: string; text: string }>
}
type Graph = GraphStore | GraphStoreV2

export function nodeHoverDetails(graph: Graph, node: SemanticNode, rows: EffectiveAccessRow[]): HoverDetails {
  const single = node.level === 'object' || node.level === 'tenant'
  const object = single ? describeObject(graph, node.rawObject?.fixture_key ?? node.id) : null
  const summary = object?.summary ?? (node.level === 'ecosystem' ? providerProfile(node.provider)?.points.join(', ')
    : node.scopeKind && SCOPE_KIND_MEANING[node.scopeKind]) ?? '그룹'
  // 개별 항목은 객체가 늘 1개라 세지 않고, 관계는 묶음 안쪽 수(늘 0) 대신 이 항목에 이어진 수를 센다
  const key = node.rawObject?.fixture_key ?? node.id
  const linked = (graph.outgoingRelationsByObject.get(key)?.length ?? 0) + (graph.incomingRelationsByObject.get(key)?.length ?? 0)
  const stats = [
    ...(single ? [] : [{ label: '객체', value: node.objectCount }]),
    { label: '관계', value: single ? linked : node.relationCount },
    { label: '탐지', value: node.findingCount, alert: node.findingCount > 0 },
  ]
  const facts = (object?.facts ?? []).slice(0, 3)
  const members = new Set(node.memberObjectKeys)
  const access = rows.filter(row => row.level !== 'denied' && (members.has(row.references.source) || members.has(row.references.target)))
  if (access.length) {
    const pending = access.filter(row => row.level === 'indeterminate').length
    facts.push({ label: 'Effective Access 결과', value: `${access.length}건 (확인 ${access.length - pending}, 미확정 ${pending})` })
  }
  // SaaS와 표시 수준은 그래프의 묶음 칸과 표시 수준 막대가 이미 보여 주므로 툴팁에 다시 쓰지 않는다
  return { title: node.label, direction: '', summary, stats, facts, notes: [] }
}

export function accessHoverDetails(graph: Graph, rows: EffectiveAccessRow[], source: SemanticNode, target: SemanticNode): HoverDetails {
  const pending = rows.filter(row => row.level === 'indeterminate').length
  const internal = source.id === target.id
  const notes = [{ kind: 'verdict', text: `확인 ${rows.length - pending}건, 미확정 ${pending}건` }]
  for (const row of rows.slice(0, 3)) {
    const explanation = explainEaRow(graph, row)
    notes.push({ kind: row.id, text: `${explanation.source.name} → ${explanation.target.name}: ${explanation.question}${explanation.verdict ? ` (${explanation.verdict})` : ''}` })
  }
  if (rows.length > 3) notes.push({ kind: 'more', text: `외 ${rows.length - 3}건` })
  return {
    title: `Effective Access 결과 ${rows.length}건`,
    direction: internal ? `${source.label} 묶음 내부` : `${source.label} → ${target.label}`,
    summary: internal ? '그룹 안 서로 다른 항목 사이의 Effective Access 결과'
      : '저장된 권한과 연결로 계산한 Effective Access 결과, 실제 실행 여부는 증적으로 별도 확인',
    notes,
  }
}

export interface CurvePoint { x: number; y: number }
/** 일반 관계선과 분리된 EA 곡선. 같은 요약 칸 안의 결론은 내부 연결을 나타내는 고리다. */
export function accessCurve(a: CurvePoint, b: CurvePoint, zoom: number, loop?: { hw: number; hh: number }) {
  const scale = 1 / Math.max(zoom, 0.04)
  if (loop) {
    const start = { x: a.x + loop.hw * 0.45, y: a.y - loop.hh }
    const end = { x: a.x - loop.hw * 0.45, y: a.y - loop.hh }
    const right = { x: a.x + loop.hw + 24 * scale, y: start.y - 56 * scale }
    const left = { x: a.x - loop.hw - 24 * scale, y: end.y - 56 * scale }
    return { d: `M ${start.x} ${start.y} C ${right.x} ${right.y} ${left.x} ${left.y} ${end.x} ${end.y}`,
      anchor: { x: a.x, y: start.y - 42 * scale }, tangent: left, end }
  }
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.max(1, Math.hypot(dx, dy))
  const bend = Math.min(64 * scale, length * 0.45)
  const control = { x: (a.x + b.x) / 2 - dy / length * bend, y: (a.y + b.y) / 2 + dx / length * bend }
  return { d: `M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}`,
    anchor: { x: (a.x + b.x) / 4 + control.x / 2, y: (a.y + b.y) / 4 + control.y / 2 }, tangent: control, end: b }
}
