import type { SemanticNode, ProjectedGraphData } from './types'

export type Point = { x: number; y: number }

export function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2
}

export function relatedCentroid(node: SemanticNode, from: ProjectedGraphData): Point {
  const wanted = new Set(node.memberObjectKeys)
  let weightedX = 0
  let weightedY = 0
  let totalWeight = 0

  for (const previous of from.nodes) {
    let overlap = 0
    for (const key of previous.memberObjectKeys) {
      if (wanted.has(key)) overlap += 1
    }
    if (overlap === 0) continue
    weightedX += previous.x * overlap
    weightedY += previous.y * overlap
    totalWeight += overlap
  }

  if (totalWeight === 0) return { x: node.x, y: node.y }
  return { x: weightedX / totalWeight, y: weightedY / totalWeight }
}
