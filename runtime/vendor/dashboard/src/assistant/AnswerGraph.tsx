import { useEffect, useRef, useState } from 'react'
import ProviderLogo from '../ProviderLogo'
import type { GraphStoreV2 } from '../model/graph'
import { objectGlyph } from '../semantic-graph/nodeGlyphs'
import { relationLabel } from '../semantic-graph/edgeExplain'
import { EDGE_COLORS } from '../semantic-graph/edgeColors'
import { providerLogoId, providerName } from '../findings/providers'
import { kindNoun } from '../utils/objectPhrase'
import { objectLabel } from './lookup'
import { fitAnswerGraph, type AnswerGraphLayout, type AnswerGraphNode } from './answerGraphLayout'

/** 노드 원 반지름과 이름 두 줄 높이 */
const R = 15
const NAME = 30
/** 같은 통로를 지나는 선 묶음 사이, 한 노드에 나눠 들어가는 선 사이 간격 */
const LANE_GAP = 8

interface Rect { x1: number; y1: number; x2: number; y2: number }
type Anchor = 'start' | 'middle' | 'end'
type Point = [number, number]

/**
 * 선은 가로와 세로로만 꺾어 칸 사이 빈 통로를 지나게 한다. 사선은 아래 노드 이름을 가로질렀다.
 * 원 옆에서 가로로 나와 통로에서 세로로 내려가고, 도착 노드 옆으로 가로로 들어간다.
 * 같은 칸 안 노드끼리는 칸 오른쪽 통로로 돌아 들어간다.
 */
function route(a: AnswerGraphNode, b: AnswerGraphNode, nodes: AnswerGraphNode[], columnWidth: number, offset: number, dy: number): Point[] {
  // dy: 도착 노드에 관계 이름이 다른 선이 여럿 들어오면 원 위아래로 조금씩 나눠 들어간다
  const into = (dir: number): Point => [b.x - dir * (Math.sqrt(R * R - dy * dy) + 4), b.y + dy]
  if (a.column === b.column) {
    const cx = a.x + columnWidth / 2 + offset
    return [[a.x + R + 2, a.y], [cx, a.y], [cx, b.y + dy], into(-1)]
  }
  const dir = b.x > a.x ? 1 : -1
  const lo = Math.min(a.column, b.column), hi = Math.max(a.column, b.column)
  // 가로 선이 사이 칸 노드의 원이나 이름을 지나는지
  const blocked = (y: number) => nodes.some(n => n.column > lo && n.column < hi && y > n.y - R - 2 && y < n.y + R + NAME)
  const start: Point = [a.x + dir * (R + 2), a.y]
  if (a.y === b.y && !dy && !blocked(a.y)) return [start, into(dir)]
  const nearTarget = b.x - dir * columnWidth / 2 + offset, nearSource = a.x + dir * columnWidth / 2 + offset
  const cx = !blocked(a.y) ? nearTarget : !blocked(b.y + dy) ? nearSource : nearTarget
  return [start, [cx, a.y], [cx, b.y + dy], into(dir)]
}

/**
 * 같은 노드에 같은 이름으로 모이는 선은 한 줄로 모으고, 이름이 다른 선은 통로도 도착 지점도 나눈다.
 * 같은 통로를 지나는 묶음이 여럿이면 조금씩 벌린다.
 */
function routes<E extends { key: string; text: string; a: AnswerGraphNode; b: AnswerGraphNode }>(edges: E[], nodes: AnswerGraphNode[], columnWidth: number) {
  const bundle = (e: { text: string; b: AnswerGraphNode }) => `${e.b.key}|${e.text}`
  const spread = (list: string[], item: string) => list.length > 1 ? (list.indexOf(item) - (list.length - 1) / 2) * LANE_GAP : 0
  const into = new Map<string, string[]>()
  for (const e of edges) {
    const list = into.get(e.b.key) ?? []
    if (!list.includes(bundle(e))) list.push(bundle(e))
    into.set(e.b.key, list)
  }
  const dyOf = (e: { text: string; b: AnswerGraphNode }) => Math.max(-(R - 4), Math.min(R - 4, spread(into.get(e.b.key)!, bundle(e))))
  const first = edges.map(e => ({ ...e, points: route(e.a, e.b, nodes, columnWidth, 0, dyOf(e)) }))
  const channels = new Map<number, { id: string; y: number }[]>()
  for (const e of first) {
    if (e.points.length < 4) continue
    const list = channels.get(e.points[1]![0]) ?? []
    if (!list.some(c => c.id === bundle(e))) list.push({ id: bundle(e), y: e.b.y + dyOf(e) })
    channels.set(e.points[1]![0], list)
  }
  return first.map(e => {
    if (e.points.length < 4) return e
    const ids = channels.get(e.points[1]![0])!.slice().sort((p, q) => p.y - q.y).map(c => c.id)
    const offset = spread(ids, bundle(e))
    return offset ? { ...e, points: route(e.a, e.b, nodes, columnWidth, offset, dyOf(e)) } : e
  })
}

/** 글자 폭 어림. 한글은 글자 크기만큼, 나머지는 그 0.6 배 */
const FONT = 11
const textWidth = (text: string) => [...text].reduce((w, ch) => w + (/[ㄱ-힣]/.test(ch) ? FONT : FONT * 0.6), 0)
const overlaps = (a: Rect, b: Rect) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2
const segments = (points: Point[]) => points.slice(1).map((p, i) => [points[i]!, p] as const)

/** 선 이름 후보 자리. 도착 쪽 가로 선 위, 세로 선 양옆, 출발 쪽 가로 선 위 차례 */
function spots(points: Point[], width: number) {
  const segs = segments(points)
  const order = segs.length > 1 ? [segs[segs.length - 1]!, ...segs.slice(1, -1), segs[0]!] : segs
  return order.flatMap(([[x1, y1], [x2, y2]]) => {
    if (y1 === y2) return Math.abs(x2 - x1) >= width + 6 ? [{ x: (x1 + x2) / 2, y: y1 - 5, anchor: 'middle' as Anchor }] : []
    return [0.5, 0.3, 0.7].flatMap(t => {
      const y = y1 + (y2 - y1) * t + 4
      return [{ x: x1 + 5, y, anchor: 'start' as Anchor }, { x: x1 - 5, y, anchor: 'end' as Anchor }]
    })
  })
}

/** 노드 원, 노드 이름, 모든 선, 먼저 놓은 선 이름과 겹치지 않는 첫 자리에 선 이름을 둔다. 같은 노드로 모이는 같은 이름 선은 이름을 한 번만 단다. 자리가 없으면 빼고 선에 마우스를 올려 보게 한다 */
function placeLabels(nodes: AnswerGraphNode[], drawn: { key: string; text: string; to: string; points: Point[] }[], nameWidth: number) {
  const taken: Rect[] = [
    ...nodes.flatMap(n => [
      { x1: n.x - R, y1: n.y - R, x2: n.x + R, y2: n.y + R },
      { x1: n.x - nameWidth / 2, y1: n.y + R, x2: n.x + nameWidth / 2, y2: n.y + R + NAME },
    ]),
    ...drawn.flatMap(d => segments(d.points).map(([[x1, y1], [x2, y2]]) => ({ x1: Math.min(x1, x2) - 1, y1: Math.min(y1, y2) - 1, x2: Math.max(x1, x2) + 1, y2: Math.max(y1, y2) + 1 }))),
  ]
  const placed = new Map<string, { x: number; y: number; anchor: Anchor }>()
  const done = new Set<string>()
  for (const { key, text, to, points } of drawn) {
    const bus = `${to}|${text}`
    if (done.has(bus)) continue
    const w = textWidth(text)
    for (const spot of spots(points, w)) {
      const left = spot.anchor === 'start' ? spot.x : spot.anchor === 'end' ? spot.x - w : spot.x - w / 2
      const rect = { x1: left - 2, y1: spot.y - FONT, x2: left + w + 2, y2: spot.y + 3 }
      if (taken.some(r => overlaps(r, rect))) continue
      taken.push(rect)
      placed.set(key, spot)
      done.add(bus)
      break
    }
  }
  return placed
}

/** 답변 말풍선 안의 SaaS 별 줄 그래프. 노드와 이름은 HTML, 선은 SVG(위협 경로 그림과 같은 방식) */
export default function AnswerGraph({ graph, layout: base, onOpen, disabled }: { graph: GraphStoreV2; layout: AnswerGraphLayout; onOpen?: () => void; disabled?: boolean }) {
  const scroll = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)
  useEffect(() => {
    const el = scroll.current
    if (!el) return
    const update = () => setAvailable(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const layout = fitAnswerGraph(base, available)
  const byKey = new Map(layout.nodes.map(n => [n.key, n]))
  const nameWidth = Math.min(92, layout.columnWidth - 4)
  const drawn = routes(layout.edges.flatMap(edge => {
    const a = byKey.get(edge.from), b = byKey.get(edge.to)
    const text = relationLabel(edge.relationType)
    return a && b ? [{ key: edge.key, text, hint: edge.roleName ? `${text} ${edge.roleName}` : text, a, b }] : []
  }), layout.nodes, layout.columnWidth).map(({ key, text, hint, b, points }) => ({ key, to: b.key, text, hint, points }))
  const labels = placeLabels(layout.nodes, drawn, nameWidth)
  return (
    <figure className="assistant-answer-graph" aria-label="연결 그래프">
      <figcaption>
        <span>연결 그래프</span>
        {onOpen && <button type="button" disabled={disabled} onClick={onOpen}>크게 보기</button>}
      </figcaption>
      <div className="aag-scroll" tabIndex={0} ref={scroll}>
        <div className="aag-world" style={{ width: layout.width, height: layout.height }}>
          {layout.lanes.map(lane => (
            <div key={lane.provider} className="aag-lane" style={{ top: lane.top, height: lane.height }}>
              <span className="aag-lane-name"><ProviderLogo provider={providerLogoId(lane.provider)} />{providerName(lane.provider)}</span>
            </div>
          ))}
          <svg className="aag-edges" width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              <marker id="aag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L10 5L0 10z" fill={EDGE_COLORS.path} />
              </marker>
            </defs>
            {drawn.map(({ key, text, hint, points }) => {
              const label = labels.get(key)
              return (
                <g key={key}>
                  <polyline points={points.map(p => p.join(',')).join(' ')} fill="none" stroke={EDGE_COLORS.path} strokeWidth={1.6} strokeLinejoin="round" markerEnd="url(#aag-arrow)"><title>{hint}</title></polyline>
                  {label && <text x={label.x} y={label.y} textAnchor={label.anchor}>{text}<title>{hint}</title></text>}
                </g>
              )
            })}
          </svg>
          {layout.nodes.map(node => {
            const object = graph.objectsByKey.get(node.members?.[0] ?? node.key)
            const Glyph = objectGlyph(object?.canonical.object_type, object?.canonical.interfaces)
            const noun = kindNoun(object)
            const names = (node.members ?? [node.key]).map(key => objectLabel(graph, key))
            const name = node.members ? `${noun || '객체'} ${node.members.length}개` : names[0]!
            return (
              <div key={node.key} className="aag-node" data-provider={node.provider} style={{ left: node.x, top: node.y, width: nameWidth }}>
                <span className="aag-dot"><Glyph size={16} strokeWidth={2.2} aria-hidden="true" /></span>
                <span className="aag-name"><b title={names.join(', ')}>{name}</b><small title={names.join(', ')}>{node.members ? `${names[0]} 외 ${names.length - 1}` : noun}</small></span>
              </div>
            )
          })}
        </div>
      </div>
    </figure>
  )
}
