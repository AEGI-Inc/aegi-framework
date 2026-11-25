import '../assistant/eventGraph.css'

export default function GraphEventBadge({ count, zoom, x, y }: { count: number; zoom: number; x: number; y: number }) {
  if (!count) return null
  const scale = 1 / Math.max(zoom, 0.001), width = (48 + String(count).length * 7) * scale
  return <g className="graph-event-badge" data-event-count={count} transform={`translate(${x - width / 2}, ${y - 23 * scale})`}>
    <title>AI가 조회한 이벤트 {count}건</title>
    <rect width={width} height={20 * scale} strokeWidth={scale} />
    <text x={width / 2} y={14 * scale} textAnchor="middle" style={{ fontSize: `calc(var(--font-size-xs) * ${scale})` }}>이벤트 {count}</text>
  </g>
}
