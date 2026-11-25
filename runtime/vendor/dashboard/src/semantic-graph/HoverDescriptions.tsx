import { useMemo } from 'react'
import type { GraphStore, GraphStoreV2 } from '../model/graph'
import type { EffectiveAccessRow } from '../detection/v2/effectiveAccess/types'
import type { SemanticNode } from './types'
import { useHovered, type HoverStore } from './hoverStore'
import { nodeHoverDetails, accessHoverDetails, type accessCurve, type CurvePoint } from './hoverDetails'
import HoverTooltip from './HoverTooltip'

interface SharedProps {
  store: HoverStore; canvasRef: { current: HTMLDivElement | null }; graph: GraphStore | GraphStoreV2
  nodesById: ReadonlyMap<string, SemanticNode>; width: number; height: number; zoom: number; pan: CurvePoint
}
export function NodeHoverTooltip({ rows, ...props }: SharedProps & { rows: EffectiveAccessRow[] }) {
  const id = useHovered(props.store)
  const node = id ? props.nodesById.get(id) : undefined
  const tip = useMemo(() => node ? nodeHoverDetails(props.graph, node, rows) : null, [node, props.graph, rows])
  return <HoverTooltip {...props} tip={tip} kind="node" anchor={node && { x: node.x * props.zoom + props.pan.x, y: node.y * props.zoom + props.pan.y }} />
}
export function EaHoverTooltip({ edges, geometry, ...props }: SharedProps & {
  edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string; rows: EffectiveAccessRow[] }>
  geometry: (source: SemanticNode, target: SemanticNode) => ReturnType<typeof accessCurve>
}) {
  const id = useHovered(props.store)
  const edge = edges.find(item => item.id === id)
  const source = edge && props.nodesById.get(edge.sourceNodeId), target = edge && props.nodesById.get(edge.targetNodeId)
  const tip = useMemo(() => edge && source && target ? accessHoverDetails(props.graph, edge.rows, source, target) : null, [edge, source, target, props.graph])
  const anchor = source && target ? geometry(source, target).anchor : undefined
  return <HoverTooltip {...props} tip={tip} kind="effective-access" anchor={anchor && { x: anchor.x * props.zoom + props.pan.x, y: anchor.y * props.zoom + props.pan.y }} />
}
