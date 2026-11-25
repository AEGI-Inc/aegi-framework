import { useMemo } from 'react'
import type { GraphStoreV2 } from '../model/graph'
import { blastPathTo, type BlastHop, type BlastNode, type BlastRadius } from '../detection/v2/blastRadius'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId, providerName } from '../findings/providers'
import { CERTAINTY_LABEL, levelLabel, viaKind, hopKindLabel, objectLabel, objectTypeLabel, providerRank, reachedNodes } from './blastLabels'

/* 칸 크기. 열은 시작 자격증명에서 몇 단계 떨어졌는가, 열 안은 SaaS 순서 */
const COL_W = 290
const NODE_W = 200
const NODE_H = 46
const ROW_H = 60
const PAD_X = 16
const PAD_Y = 16

/** 고른 경로에서 선 위에 이름을 적는 홉. SaaS 나 계정 경계를 넘는 것만 적는다 */
const LABELED = new Set<BlastHop['kind']>(['sso', 'takeover', 'automation_link', 'effective_access'])

interface Placed {
  node: BlastNode
  x: number
  y: number
}

export interface BlastRadiusGraphProps {
  radius: BlastRadius
  graph: GraphStoreV2
  selectedKey: string
  onSelect: (key: string) => void
}

/**
 * 피해범위 그림. 노드는 HTML 단추(글자가 또렷하고 키보드로 고를 수 있다), 선은 그 아래 SVG 한 장이다.
 * 고른 노드까지의 경로를 굵게 칠하고, 나머지 선은 옅은 무채색으로 둔다.
 */
export default function BlastRadiusGraph({ radius, graph, selectedKey, onSelect }: BlastRadiusGraphProps) {
  const { placed, width, height } = useMemo(() => {
    const shown = [radius.nodes.find(n => n.key === radius.credentialKey)!, ...reachedNodes(radius)]
    const columns = new Map<number, BlastNode[]>()
    for (const n of shown) {
      const list = columns.get(n.depth) ?? []
      list.push(n)
      columns.set(n.depth, list)
    }
    const placedMap = new Map<string, Placed>()
    let maxRows = 1
    for (const [depth, list] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
      list.sort((a, b) => providerRank(a.provider) - providerRank(b.provider) || objectLabel(a.key, graph).localeCompare(objectLabel(b.key, graph)))
      maxRows = Math.max(maxRows, list.length)
      list.forEach((n, i) => placedMap.set(n.key, { node: n, x: PAD_X + depth * COL_W, y: PAD_Y + i * ROW_H }))
    }
    const maxDepth = Math.max(...shown.map(n => n.depth))
    return { placed: placedMap, width: PAD_X * 2 + maxDepth * COL_W + NODE_W, height: PAD_Y * 2 + (maxRows - 1) * ROW_H + NODE_H }
  }, [radius, graph])

  /* 고른 노드까지의 경로. SSO, 계정 초기화는 거친 앱, 조직에서 선이 나가므로 그 노드와 그 노드에 닿은 홉도 칠한다 */
  const { pathHops, pathNodes } = useMemo(() => {
    const hops = new Set<string>()
    const keys = new Set<string>([selectedKey])
    const byId = new Map(radius.hops.map(h => [h.id, h]))
    const nodeVia = new Map(radius.nodes.map(n => [n.key, n.via]))
    for (const hop of blastPathTo(radius, selectedKey)) {
      hops.add(hop.id)
      keys.add(hop.from)
      keys.add(hop.to)
      if (hop.throughKey) {
        keys.add(hop.throughKey)
        const via = nodeVia.get(hop.throughKey)
        const reachedBy = via ? byId.get(via) : undefined
        if (reachedBy && keys.has(reachedBy.from)) hops.add(reachedBy.id)
      }
    }
    return { pathHops: hops, pathNodes: keys }
  }, [radius, selectedKey])

  // 선은 거친 앱, 조직이 그림에 있으면 거기서 나간다 (관리자 계정 하나에서 수십 개가 부채꼴로 나가지 않게)
  const edges = radius.hops
    .map(hop => {
      const visualFrom = hop.throughKey && placed.has(hop.throughKey) ? hop.throughKey : hop.from
      return { hop, a: placed.get(visualFrom), b: placed.get(hop.to) }
    })
    .filter((e): e is { hop: BlastHop; a: Placed; b: Placed } => !!e.a && !!e.b)
  // 이름표는 고른 경로의 선에만. 선이 여러 갈래로 겹치는 자리에 이름표가 쌓이지 않는다
  const labeled = edges.filter(e => LABELED.has(e.hop.kind) && pathHops.has(e.hop.id) && e.b.x > e.a.x)
  // 고른 경로의 선을 마지막에 그려 다른 선 위에 오게 한다
  edges.sort((x, y) => Number(pathHops.has(x.hop.id)) - Number(pathHops.has(y.hop.id)))

  const curve = (a: Placed, b: Placed) => {
    const x1 = a.x + NODE_W
    const y1 = a.y + NODE_H / 2
    const x2 = b.x
    const y2 = b.y + NODE_H / 2
    // 같은 열(초기화로 같은 단계의 계정을 차지)은 오른쪽으로 돌아 들어간다
    if (x2 <= x1) {
      const bend = a.x + NODE_W + 28
      return `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${b.x + NODE_W} ${y2}`
    }
    const mid = (x1 + x2) / 2
    return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
  }

  return (
    <div className="br-graph-scroll">
      <div className="br-graph" style={{ width, height }}>
        <svg className="br-graph-edges" width={width} height={height} aria-hidden="true">
          <defs>
            <marker id="br-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#64748b" />
            </marker>
            <marker id="br-arrow-on" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--color-select, #1d4ed8)" />
            </marker>
          </defs>
          {edges.map(({ hop, a, b }) => {
            const on = pathHops.has(hop.id)
            return (
              <path
                key={hop.id}
                d={curve(a, b)}
                className={`br-edge ${on ? 'is-on' : ''} ${hop.certainty === 'inferred' ? 'is-inferred' : ''}`}
                markerEnd={on ? 'url(#br-arrow-on)' : 'url(#br-arrow)'}
              >
                <title>{hopKindLabel(hop.kind)}</title>
              </path>
            )
          })}
        </svg>

        {/* 경계를 넘는 홉의 이름. 선 위에 흰 바탕으로 얹어 선이 글자를 가리지 않게 한다 */}
        {labeled.map(({ hop, a, b }) => (
          <span
            key={`label-${hop.id}`}
            className="br-edge-label is-on"
            style={{ left: (a.x + NODE_W + b.x) / 2, top: (a.y + b.y) / 2 + NODE_H / 2 }}
          >
            {hopKindLabel(hop.kind)}
          </span>
        ))}

        {[...placed.values()].map(({ node, x, y }) => {
          const start = node.key === radius.credentialKey
          const label = objectLabel(node.key, graph)
          return (
            <button
              type="button"
              key={node.key}
              className={`br-node ${node.key === selectedKey ? 'is-selected' : ''} ${pathNodes.has(node.key) ? 'is-path' : ''} ${start ? 'is-start' : ''}`}
              style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
              onClick={() => onSelect(node.key)}
              title={`${providerName(node.provider)} ${objectTypeLabel(node.key, graph)}\n${label}`}
            >
              <span className="br-node-logo"><ProviderLogo provider={providerLogoId(node.provider)} /></span>
              <span className="br-node-text">
                <b>{label}</b>
                <small>{objectTypeLabel(node.key, graph)}</small>
              </span>
              {node.level && node.level !== 'use' && (
                <em className={`br-level is-${node.level}`}>{node.tenantWide ? `조직 ${levelLabel(node.level, viaKind(node))}` : levelLabel(node.level, viaKind(node))}</em>
              )}
              {node.certainty === 'inferred' && <em className="br-certainty">{CERTAINTY_LABEL.inferred}</em>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
