import type { Provider } from '../model/object'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId } from '../findings/providers'
import type { ProjectedGraphData } from '../semantic-graph/types'
import { ecosystemEdgeRestStyle } from '../semantic-graph/EcosystemParts'
import { GRAPH_FONT_FAMILY } from '../semantic-graph/labelFit'

type DashboardProvider = Provider

type HomeEcosystemGraphProps = {
  /** projectSemanticGraph(ecosystem) 결과. Overview가 영향 경로 카드와 같이 쓰려고 한 번만 뽑아 넘긴다. */
  projected: ProjectedGraphData
  onOpenGraph: (context?: { provider?: DashboardProvider; sourceProvider?: DashboardProvider; targetProvider?: DashboardProvider; findingIds?: string[] }) => void
}

/* Overview 왼쪽의 SaaS 연결 그림. 어떤 SaaS가 서로 이어져 있는지만 보인다.
   SaaS는 로고 동그라미와 그 아래 이름이다. 선은 Cross-SaaS Graph 화면의 객체 선과 같은
   색과 점선(연결 종류별)이고 두 동그라미를 곧게 잇는다. 이름 글자는 바탕색 테두리를 둘러
   지나가는 선 위에서도 읽힌다. 위협 표시(빨간 선, 숫자 배지)는 빼고 그 화면에서 본다.
   위협이 많은 SaaS일수록 동그라미 테두리가 굵고 붉게 번진다(가장 많은 SaaS 기준).
   SaaS는 가로로 긴 타원 위에 같은 각도 간격으로 놓는다(첫 SaaS가 맨 위, 시계 방향). 보이는 범위는 그 자리에서 잡는다. */
const VIEW_PAD = { left: 220, right: 220, top: 130, bottom: 150 }
const RING_RX = 640
const RING_RY = 420
const RADIUS = 72
const LOGO = 78
const EDGE_WIDTH = 2.4
/** 이름 글자가 화면에서 이보다 작아지지 않게 한다 (px) */
const MIN_LABEL_PX = 14
const LABEL_SIZE = 22

function threatLevel(count: number, max: number) {
  if (count <= 0 || max <= 0) return 0
  return count / max
}

/** 타원 위 index 번째 자리. 맨 위에서 시작해 시계 방향 */
function ringPosition(index: number, count: number) {
  const angle = ((-90 + (360 * index) / count) * Math.PI) / 180
  return { x: RING_RX * Math.cos(angle), y: RING_RY * Math.sin(angle) }
}

export default function HomeEcosystemGraph({ projected, onOpenGraph }: HomeEcosystemGraphProps) {
  const nodes = useMemo(() => projected.nodes.map((node, index, all) => ({ ...node, ...ringPosition(index, all.length) })), [projected])
  const nodesById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])
  const maxFindings = useMemo(() => Math.max(0, ...nodes.map(node => node.findingCount)), [nodes])
  const VIEW = useMemo(() => {
    const xs = nodes.map(node => node.x)
    const ys = nodes.map(node => node.y)
    if (!xs.length) return { x: 600, y: 450, width: 1200, height: 920 }
    const x = Math.min(...xs) - VIEW_PAD.left
    const y = Math.min(...ys) - VIEW_PAD.top
    return { x, y, width: Math.max(...xs) + VIEW_PAD.right - x, height: Math.max(...ys) + VIEW_PAD.bottom - y }
  }, [nodes])

  /* 그림은 칸에 맞춰 줄어들므로, 칸이 작으면 이름 글자를 키워 화면에서 MIN_LABEL_PX 아래로 줄지 않게 한다 */
  const svgRef = useRef<SVGSVGElement>(null)
  const [labelSize, setLabelSize] = useState(LABEL_SIZE)
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg || typeof ResizeObserver === 'undefined') return
    const fit = () => {
      const scale = Math.min(svg.clientWidth / VIEW.width, svg.clientHeight / VIEW.height)
      if (scale > 0) setLabelSize(Math.max(LABEL_SIZE, MIN_LABEL_PX / scale))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [VIEW])

  return (
    <svg ref={svgRef} className="home-eco-graph" viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        {nodes.map(node => {
          const level = threatLevel(node.findingCount, maxFindings)
          if (level === 0) return null
          return (
            <filter key={node.id} id={`home-eco-glow-${node.id}`} x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="0" stdDeviation={6 + 16 * level} floodColor="#dc2626" floodOpacity={0.35 + 0.5 * level} />
            </filter>
          )
        })}
      </defs>

      {projected.edges.map(edge => {
        const src = nodesById.get(edge.sourceSemanticNodeId)
        const tgt = nodesById.get(edge.targetSemanticNodeId)
        if (!src || !tgt || src === tgt) return null
        const style = ecosystemEdgeRestStyle(edge)
        return (
          <g
            key={edge.id}
            className="home-eco-edge"
            role="button"
            aria-label={`${src.label}, ${tgt.label} 사이 그래프 보기`}
            onClick={() => onOpenGraph({ sourceProvider: src.provider as DashboardProvider, targetProvider: tgt.provider as DashboardProvider, findingIds: edge.findingIds })}
          >
            <line x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y} strokeWidth={EDGE_WIDTH} {...style} />
            <line x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y} stroke="transparent" strokeWidth={18} />
          </g>
        )
      })}

      {nodes.map(node => {
        const level = threatLevel(node.findingCount, maxFindings)
        const label = node.findingCount > 0 ? `${node.label}, 위협 ${node.findingCount}건` : node.label
        return (
          <g
            key={node.id}
            className="home-eco-node"
            transform={`translate(${node.x}, ${node.y})`}
            role="button"
            aria-label={label}
            data-threat-level={level.toFixed(2)}
            onClick={() => onOpenGraph({ provider: node.provider as DashboardProvider })}
          >
            <title>{label}</title>
            <circle
              r={RADIUS}
              fill="#ffffff"
              stroke={level > 0 ? '#dc2626' : '#cbd5e1'}
              strokeOpacity={level > 0 ? 0.45 + 0.55 * level : 1}
              strokeWidth={level > 0 ? 3 + 7 * level : 2}
              filter={level > 0 ? `url(#home-eco-glow-${node.id})` : undefined}
            />
            <foreignObject x={-LOGO / 2} y={-LOGO / 2} width={LOGO} height={LOGO}>
              <div className="home-eco-logo">
                <ProviderLogo provider={providerLogoId(node.provider)} />
              </div>
            </foreignObject>
            <text
              y={RADIUS + 14 + labelSize}
              textAnchor="middle"
              fontFamily={GRAPH_FONT_FAMILY}
              fontSize={labelSize}
              fontWeight="700"
              fill="#0f172a"
              stroke="#f8fafc"
              strokeWidth={10}
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              {node.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
