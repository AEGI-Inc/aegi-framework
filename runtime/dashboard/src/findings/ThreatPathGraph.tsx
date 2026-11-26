import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Mail, UserRound, Users } from 'lucide-react'
import ProviderLogo from '../ProviderLogo'
import { objectGlyph } from '../semantic-graph/nodeGlyphs'
import { EDGE_COLORS } from '../semantic-graph/edgeColors'
import { providerLogoId, providerName } from './providers'
import { measureLabel } from '../semantic-graph/labelFit'
import { NODE_RADIUS, type ThreatPathEdge, type ThreatPathLayout, type ThreatPathNode } from './threatPathModel'

type Point = { x: number; y: number }
type PointerMode =
  | { kind: 'pan'; pointerId: number; start: Point; origin: Point }
  | { kind: 'node'; pointerId: number; nodeId: string; start: Point; origin: Point }
  | null

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.5
/** 이름이 아래에 붙는 노드에서 이름 두 줄이 차지하는 높이. 세로 선은 이름 아래에서 나간다 */
const LABEL_BELOW = 40
/** 판 아래 확대, 축소 단추 자리(화면 px). 판을 줄여도 단추가 마지막 SaaS 상자 테두리를 가리지 않는다 */
const CONTROLS_SPACE = 44

export interface ThreatPathGraphProps {
  layout: ThreatPathLayout
  selectedId: string | null
  onSelect: (id: string) => void
  onClearSelection: () => void
  /** 선 id 마다 차단 지점 번호(위협 판정 V2). 선 이름표 앞에 「차단 N」 배지를 단다 */
  cutMarks?: Map<string, number[]>
  /** 노드 id 마다 차단 지점 번호. 간선이 자기 자신인 조치(실행 신원을 호출자 권한으로)는 노드 이름 앞에 단다 */
  nodeCutMarks?: Map<string, number[]>
  /** 차단 지점 목록에서 고른 번호. 그 차단 지점의 선과 양 끝 노드만 빨갛게 두고 나머지는 흐리게 한다 */
  hotCut?: number | null
}

/**
 * 탐지 경로 그림(관측 경로, 잠재 경로 공통).
 *
 * 판은 SaaS 상자 × 단계 칸이다(threatPathModel). 노드와 이름은 HTML, 선은 SVG 로 그린다.
 * 노드 모양과 선 색은 Cross-SaaS Graph 와 같다: SaaS 색 테두리의 원 안에 종류 그림, 관계는
 * 회청색 선, 탐지 경로는 빨간 선. 관측된 선은 실선과 차례 번호, 가능한 선은 점선이다.
 *
 * 끌어서 화면을 옮기고, Ctrl(Mac 은 Cmd)을 누른 채 휠을 굴리거나 + − 단추로 확대, 축소한다.
 * 노드도 끌어 옮길 수 있고 Fit 을 누르면 처음 배치로 돌아간다.
 */
export default function ThreatPathGraph({ layout, selectedId, onSelect, onClearSelection, cutMarks, nodeCutMarks, hotCut }: ThreatPathGraphProps) {
  const [hotEdges, hotNodes] = useMemo(() => {
    const edges = new Set<string>()
    const nodes = new Set<string>()
    if (!hotCut) return [edges, nodes]
    for (const [id, nos] of cutMarks ?? []) if (nos.includes(hotCut)) edges.add(id)
    for (const [id, nos] of nodeCutMarks ?? []) if (nos.includes(hotCut)) nodes.add(id)
    for (const e of layout.edges) if (edges.has(e.id)) { nodes.add(e.from); nodes.add(e.to) }
    return [edges, nodes]
  }, [hotCut, cutMarks, nodeCutMarks, layout])
  const initial = useMemo(() => new Map(layout.nodes.map(node => [node.id, { x: node.x, y: node.y }])), [layout])
  const [positions, setPositions] = useState(initial)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const pointerMode = useRef<PointerMode>(null)
  const moved = useRef(false)
  const [canvasWidth, setCanvasWidth] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const update = () => setCanvasWidth(canvas.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setPositions(initial)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [initial])

  // 판이 화면보다 넓으면 통째로 줄이고, 좁으면 가운데에 둔다
  const fit = canvasWidth > 0 ? Math.min(1, canvasWidth / layout.width) : 1
  const offsetX = canvasWidth > 0 ? Math.max(0, (canvasWidth - layout.width * fit) / 2) : 0
  const scale = zoom * fit

  const zoomAround = (next: number, cursor: Point) => {
    const clamped = clamp(next, ZOOM_MIN, ZOOM_MAX)
    const ratio = clamped / zoom
    setPan(prev => ({ x: cursor.x - (cursor.x - prev.x) * ratio, y: cursor.y - (cursor.y - prev.y) * ratio }))
    setZoom(clamped)
  }
  const zoomAroundRef = useRef(zoomAround)
  zoomAroundRef.current = zoomAround
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  // 그냥 휠은 화면을 내리고, Ctrl(Mac 은 Cmd)을 누른 채 굴릴 때만 확대한다. 그래프가 상세 한가운데라
  // 휠을 늘 확대에 쓰면 화면을 내리려다 그래프만 커졌다 작아진다. 브라우저 확대를 막으려고 passive 가 아닌 리스너를 단다
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const delta = Math.max(-40, Math.min(40, event.deltaY))
      zoomAroundRef.current(zoomRef.current * Math.exp(-delta * 0.006), { x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  const zoomFromButton = (next: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    zoomAround(next, { x: rect.width / 2, y: rect.height / 2 })
  }

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setPositions(initial)
  }

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    moved.current = false
    pointerMode.current = { kind: 'pan', pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: pan }
  }

  const onNodePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, nodeId: string) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    moved.current = false
    pointerMode.current = { kind: 'node', pointerId: event.pointerId, nodeId, start: { x: event.clientX, y: event.clientY }, origin: positions.get(nodeId) ?? { x: 0, y: 0 } }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const mode = pointerMode.current
    if (!mode || mode.pointerId !== event.pointerId) return
    const dx = event.clientX - mode.start.x
    const dy = event.clientY - mode.start.y
    if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true
    if (mode.kind === 'pan') {
      setPan({ x: mode.origin.x + dx, y: mode.origin.y + dy })
      return
    }
    setPositions(prev => new Map(prev).set(mode.nodeId, { x: mode.origin.x + dx / scale, y: mode.origin.y + dy / scale }))
  }

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerMode.current?.pointerId === event.pointerId) pointerMode.current = null
  }

  const nodeById = useMemo(() => new Map(layout.nodes.map(node => [node.id, node])), [layout])
  const at = (node: ThreatPathNode) => positions.get(node.id) ?? { x: node.x, y: node.y }
  const edgeSelected = (edge: ThreatPathEdge) => Boolean(selectedId && edge.refIds.includes(selectedId))

  const geometry = layout.edges
    .map(edge => {
      const from = nodeById.get(edge.from)
      const to = nodeById.get(edge.to)
      if (!from || !to) return null
      // 같은 칸의 위아래를 잇는 선이 사이의 다른 노드를 지나가면 옆으로 돌아간다
      const a = at(from)
      const b = at(to)
      const blocked = Math.abs(a.x - b.x) < 8 && layout.nodes.some(node => {
        if (node.id === from.id || node.id === to.id) return false
        const p = at(node)
        return Math.abs(p.x - a.x) < 30 && p.y > Math.min(a.y, b.y) && p.y < Math.max(a.y, b.y)
      })
      return { edge, ...edgePath(from, a, to, b, blocked) }
    })
    .filter((g): g is NonNullable<typeof g> => Boolean(g))

  const labels = spreadLabels(geometry, cutMarks)
  const height = Math.max(200, layout.height * fit + CONTROLS_SPACE)

  return (
    <div
      ref={canvasRef}
      className={`tpg-canvas ${layout.variant === 'v2' ? 'is-v2' : ''} ${hotCut ? 'has-hot' : ''}`}
      style={{ height }}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onClick={event => {
        if (!moved.current && !(event.target as HTMLElement).closest('button')) onClearSelection()
      }}
    >
      <div className="tpg-controls">
        <button type="button" onClick={() => zoomFromButton(zoom * 1.18)} aria-label="확대">+</button>
        <button type="button" onClick={() => zoomFromButton(zoom / 1.18)} aria-label="축소">−</button>
        <button type="button" onClick={resetView}>Fit</button>
      </div>

      <div
        className="tpg-world"
        style={{ width: layout.width, height: layout.height, transform: `translate(${offsetX + pan.x}px, ${pan.y}px) scale(${scale})` }}
      >
        {layout.lanes.map(lane => (
          <div key={lane.id} className="tpg-lane" data-provider={lane.provider} style={{ top: lane.top, height: lane.height }}>
            <span className="tpg-lane-name">
              {lane.provider ? (
                <i aria-hidden="true"><ProviderLogo provider={providerLogoId(lane.provider)} /></i>
              ) : (
                <i aria-hidden="true"><Mail size={16} strokeWidth={2} /></i>
              )}
              {lane.provider ? providerName(lane.provider) : lane.label}
            </span>
          </div>
        ))}
        {layout.columns.map(column => (
          <span key={column.label} className="tpg-column-name" style={{ left: column.x }}>{column.label}</span>
        ))}

        <svg className="tpg-lines" width={layout.width} height={layout.height} aria-hidden="true">
          <defs>
            {(['observed', 'possible', 'relation'] as const).map(kind => (
              <marker key={kind} id={`tpg-arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={kind === 'relation' ? EDGE_COLORS.relation : EDGE_COLORS.finding} />
              </marker>
            ))}
          </defs>
          {/* 관계 선을 먼저, 탐지 경로를 위에 그린다 */}
          {[...geometry].sort((a, b) => order(a.edge) - order(b.edge)).map(({ edge, d }) => (
            <g key={edge.id} className={`tpg-edge tpg-${edge.kind} ${edgeSelected(edge) ? 'is-selected' : ''} ${cutMarks?.has(edge.id) ? 'is-cut' : ''} ${hotEdges.has(edge.id) ? 'is-hot' : ''}`}>
              <path d={d} markerEnd={edge.kind === 'identity' ? undefined : `url(#tpg-arrow-${edge.kind})`} />
              <path
                className="tpg-edge-hit"
                d={d}
                onClick={event => {
                  event.stopPropagation()
                  onSelect(edge.refIds[0])
                }}
              />
            </g>
          ))}
        </svg>

        {geometry.map(({ edge }) => {
          const label = labels.get(edge.id)
          return label ? (
            <button
              type="button"
              key={`label-${edge.id}`}
              className={`tpg-edge-label tpg-${edge.kind} ${label.side ? 'is-side' : ''} ${edgeSelected(edge) ? 'is-selected' : ''} ${cutMarks?.has(edge.id) ? 'has-cut' : ''} ${hotEdges.has(edge.id) ? 'is-hot' : ''}`}
              style={{ left: label.x, top: label.y }}
              title={edge.title ?? edge.label}
              onClick={event => {
                event.stopPropagation()
                onSelect(edge.refIds[0])
              }}
            >
              {edge.step && <em aria-label={`${edge.step}번째`}>{edge.step}</em>}
              {(cutMarks?.get(edge.id) ?? []).map(no => <i key={no} className="tpg-cut-no">차단 {no}</i>)}
              <span>
                {edge.label && <b>{edge.label}</b>}
                {edge.time && <small>{edge.time}</small>}
              </span>
            </button>
          ) : null
        })}

        {layout.nodes.map(node => {
          const pos = at(node)
          const Glyph = node.id.startsWith('people-')
            ? Users
            : node.id.startsWith('person:')
              ? UserRound
              : node.role === 'external'
                ? Mail
                : objectGlyph(node.objectType, node.interfaces as never)
          const side = node.role === 'actor' || node.role === 'source' ? 'left' : node.role === 'reader' || node.role === 'external' ? 'right' : 'below'
          const provider = node.lane === 'external' ? undefined : node.lane
          return (
            <button
              type="button"
              key={node.id}
              className={`tpg-node is-${side} ${node.observed ? 'is-observed' : ''} ${node.isTarget ? 'is-target' : ''} ${node.refId === selectedId ? 'is-selected' : ''} ${hotNodes.has(node.id) ? 'is-hot' : ''}`}
              data-provider={provider}
              style={{ left: pos.x, top: pos.y }}
              title={node.title ?? (node.id.startsWith('people-rest') ? node.sub : undefined)}
              onPointerDown={event => onNodePointerDown(event, node.id)}
              onClick={event => {
                event.stopPropagation()
                if (!moved.current) onSelect(node.refId)
                moved.current = false
              }}
            >
              {node.isTarget && <span className="tpg-target-badge">위협 대상</span>}
              <span className="tpg-dot">
                <Glyph size={20} strokeWidth={2.2} aria-hidden="true" />
              </span>
              {nodeCutMarks?.has(node.id) && (
                <span className="tpg-node-cut">{nodeCutMarks.get(node.id)!.map(no => <i key={no} className="tpg-cut-no">차단 {no}</i>)}</span>
              )}
              <span className="tpg-name">
                <b title={node.label}>{node.label}</b>
                <small>
                  {node.id.startsWith('people-rest') ? '위반 대상' : node.sub}
                  {node.contents && `, ${node.contents}`}
                </small>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 선 이름이 서로 겹치지 않게 아래로 민다.
 *
 * 한 연동으로 모이는 선은 이름 자리가 가까워, 사람 둘의 관측 선 이름이 포개졌다. 이름 상자 크기를
 * 글자 수로 어림해(굵은 11px, 번호 칸) 앞 상자와 겹치는 만큼 내린다.
 */
function spreadLabels(geometry: Array<{ edge: ThreatPathEdge; label: { x: number; y: number; side: boolean } }>, cutMarks?: Map<string, number[]>) {
  const boxes = geometry
    .filter(({ edge }) => edge.label || edge.step || cutMarks?.has(edge.id))
    .map(({ edge, label }) => {
      const text = Math.max(measureLabel(edge.label ?? '', 11), edge.time ? measureLabel(edge.time, 11) : 0)
      const width = Math.min(260, text + 18 + (edge.step ? 26 : 0) + (cutMarks?.get(edge.id)?.length ?? 0) * 50)
      const height = edge.time ? 42 : 24
      const left = label.side ? label.x : label.x - width / 2
      return { id: edge.id, x: label.x, y: label.y, side: label.side, left, width, height }
    })
    .sort((a, b) => a.y - b.y)
  const placed: typeof boxes = []
  for (const box of boxes) {
    for (const other of placed) {
      const overlapX = box.left < other.left + other.width && other.left < box.left + box.width
      const gap = other.y + other.height / 2 + 4 - (box.y - box.height / 2)
      if (overlapX && gap > 0 && box.y >= other.y) box.y += gap
    }
    placed.push(box)
  }
  return new Map(placed.map(box => [box.id, { x: box.x, y: box.y, side: box.side }]))
}

const order = (edge: ThreatPathEdge) => ({ relation: 0, identity: 1, possible: 2, observed: 3 })[edge.kind]

/**
 * 두 노드를 잇는 선과 선 이름 자리.
 *
 * 칸이 다르면 양 끝을 가로로 눕힌 곡선(줄을 건너도 노드에서 수평으로 나가고 들어온다),
 * 같은 칸이면 위 노드의 이름 아래에서 아래 노드 위까지 곧은 세로 선이다.
 */
function edgePath(from: ThreatPathNode, a: Point, to: ThreatPathNode, b: Point, blocked: boolean) {
  const r = NODE_RADIUS
  if (blocked) {
    // 오른쪽으로 크게 돌아 사이의 노드와 이름을 피한다
    const out = 130
    const d = `M ${a.x + r + 4} ${a.y} C ${a.x + out} ${a.y}, ${b.x + out} ${b.y}, ${b.x + r + 8} ${b.y}`
    return { d, label: { x: a.x + out * 0.75 + 4, y: (a.y + b.y) / 2, side: true } }
  }
  if (Math.abs(a.x - b.x) < 8) {
    const down = b.y > a.y
    const fromBelow = from.role !== 'actor' && from.role !== 'source' && from.role !== 'reader' && from.role !== 'external'
    const y1 = down ? a.y + r + (fromBelow ? LABEL_BELOW : 4) : a.y - r - 22
    const y2 = down ? b.y - r - (to.isTarget ? 26 : 6) : b.y + r + LABEL_BELOW
    return { d: `M ${a.x} ${y1} L ${b.x} ${y2}`, label: { x: a.x + 12, y: (y1 + y2) / 2, side: true } }
  }
  const dir = b.x > a.x ? 1 : -1
  const x1 = a.x + dir * (r + 4)
  const x2 = b.x - dir * (r + 8)
  const bend = Math.max(40, Math.abs(x2 - x1) / 2)
  const d = `M ${x1} ${a.y} C ${x1 + dir * bend} ${a.y}, ${x2 - dir * bend} ${b.y}, ${x2} ${b.y}`
  return { d, label: { x: (x1 + x2) / 2, y: (a.y + b.y) / 2, side: false } }
}
