import ProviderLogo from '../ProviderLogo'
import type { ProviderId } from '../providerOverviewData'
import { providerName } from '../findings/providers'
import { circleLabel, circleRadius, hubLabel, hubLabelPx, LABEL_MIN_SCREEN_PX, LABEL_PX, labelPx, type LabelLine, type LabelSide } from './circleLevels'
import { GRAPH_FONT_FAMILY } from './labelFit'
import { scopeGlyph } from './nodeGlyphs'
import type { SemanticNode } from './types'

const BADGE_PX = 12

const logoId = (provider: string) => (provider === 'gws' ? 'google-workspace' : provider) as ProviderId

/* 이름표 글자. 선이 글자 뒤로 지나가도 읽히게 흰 테두리를 먼저 칠한다 */
function LabelText({ line, lp }: { line: LabelLine; lp: number }) {
  return <text x={line.x} y={line.y} textAnchor={line.anchor} fontFamily={GRAPH_FONT_FAMILY} fontSize={line.size} fontWeight={line.weight}
    fill="#0f172a" stroke="#ffffff" strokeWidth={3 * lp} strokeLinejoin="round" paintOrder="stroke">{line.text}</text>
}

/**
 * SaaS, 조직, 그룹 단계의 노드. 개별 항목 단계처럼 원으로 그린다(전에는 네모 카드).
 * 흰 원에 SaaS 색 테두리, 안에 로고(SaaS, 조직) 또는 종류 그림(그룹). 원 크기는 안에 든 객체 수.
 * 이름표 자리는 circleLevels 가 정한다: SaaS는 side 쪽, 조직, 그룹은 SaaS 가운데에서 바깥쪽(angle).
 */
export default function GraphSummaryCard({ node, color, side, angle, selected, neighbor, finding, showBadge, query, path, zoom }: {
  node: SemanticNode
  color: string
  side: LabelSide
  /** 조직, 그룹 단계: SaaS 가운데에서 이 원 쪽 각 */
  angle?: number
  selected: boolean
  neighbor?: boolean
  finding: boolean
  showBadge: boolean
  query: boolean
  path: boolean
  zoom: number
}) {
  const r = circleRadius(node)
  const px = 1 / Math.max(zoom, 0.05)
  // 이름표는 바닥 배율보다 멀리서 그래프와 함께 작아진다. 화면에서 너무 작으면 읽을 수 없어 그리지 않는다(커서를 올리면 이름이 뜬다)
  const lp = labelPx(node.level, zoom)
  const readable = LABEL_PX.scope * lp * zoom >= LABEL_MIN_SCREEN_PX
  const stroke = finding ? '#b42318' : query ? 'var(--color-graph-query)' : path ? 'var(--color-text-primary)' : color
  const strokeWidth = (finding || selected ? 3.4 : neighbor ? 3 : 2.4) * px
  const Glyph = scopeGlyph(node.scopeKind)
  const icon = node.level === 'scope' ? r * 1.3 : r * 1.2
  const label = readable ? circleLabel(node, side, angle, lp).lines.map((line, i) => <LabelText key={i} line={line} lp={lp} />) : null
  const badgeH = 20 * px
  const badgeW = (String(node.findingCount).length * 7.5 + 11) * px
  const bx = r * Math.SQRT1_2, by = -r * Math.SQRT1_2
  return <g className={['fg-circle-node', `level-${node.level}`, selected && 'selected', neighbor && !selected && 'is-neighbor', finding && 'has-finding'].filter(Boolean).join(' ')}>
    {selected && <circle r={r + 7 * px} fill="none" stroke="var(--color-select)" strokeWidth={3 * px} />}
    {neighbor && !selected && <circle r={r + 6 * px} fill="none" stroke="var(--color-text-primary)" strokeWidth={2 * px} />}
    {(query || path) && <circle r={r + 6 * px} fill="none" stroke={query ? 'var(--color-graph-query)' : 'var(--color-text-primary)'}
      strokeWidth={2.6 * px} strokeDasharray={path && !query ? `${5 * px} ${3 * px}` : undefined} />}
    <circle className="fg-circle-body" r={r} fill="#ffffff" stroke={stroke} strokeWidth={strokeWidth} />
    {node.level === 'scope'
      ? <Glyph className="fg-circle-icon" x={-icon / 2} y={-icon / 2} width={icon} height={icon} color={color} strokeWidth={2.2} aria-hidden="true" />
      : <foreignObject className="fg-circle-icon" x={-icon / 2} y={-icon / 2} width={icon} height={icon}>
          <div className="fg-circle-logo"><ProviderLogo provider={node.logoId ?? logoId(node.provider)} /></div>
        </foreignObject>}
    {label}
    {showBadge && <g transform={`translate(${bx - badgeW / 2}, ${by - badgeH / 2})`}>
      <title>{`위협 ${node.findingCount}건`}</title>
      <rect width={badgeW} height={badgeH} fill="#b42318" />
      <text x={badgeW / 2} y={badgeH / 2 + BADGE_PX * px * 0.36} textAnchor="middle" fontFamily={GRAPH_FONT_FAMILY} fontSize={BADGE_PX * px} fontWeight={700} fill="#ffffff">{node.findingCount}</text>
    </g>}
  </g>
}

/** 조직, 그룹 단계 SaaS 가운데 원: 로고와 이름. 누르면 그 SaaS 쪽으로 화면을 옮긴다 */
export function GraphProviderHub({ provider, radius, zoom, onClick }: { provider: string; radius: number; zoom: number; onClick: () => void }) {
  const px = 1 / Math.max(zoom, 0.05)
  const lp = hubLabelPx(zoom)
  const name = hubLabel(provider, lp, radius)
  const color = `var(--color-provider-${provider}, #475569)`
  const icon = radius * 1.2
  return <g className="fg-provider-hub" data-provider={provider} onClick={event => { event.stopPropagation(); onClick() }}>
    <title>{`${providerName(provider)}: 누르면 해당 위치로 이동`}</title>
    <circle r={radius} fill="#ffffff" stroke={color} strokeWidth={3 * px} />
    <foreignObject x={-icon / 2} y={-icon / 2} width={icon} height={icon}>
      <div className="fg-circle-logo"><ProviderLogo provider={logoId(provider)} /></div>
    </foreignObject>
    <LabelText line={{ text: name.text, x: 0, y: name.y, size: name.size, weight: 700, anchor: 'middle' }} lp={lp} />
  </g>
}
