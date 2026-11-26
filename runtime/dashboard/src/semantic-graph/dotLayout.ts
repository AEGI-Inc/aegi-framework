import type { SemanticNode } from './types'

type Point = { x: number; y: number }

/**
 * 점 모드(멀리서 본 L4)의 동그라미 자리.
 *
 * 칸 배치는 칸(높이 44)에 맞춰 위아래 이웃을 62만큼만 띄운다. 멀리서는 칸 대신
 * 반지름 32~40(월드)짜리 동그라미를 그리므로, 메시지처럼 한 줄로 쌓인 칸은 동그라미가
 * 서로 덮고, 테두리 주인의 옅은 고리는 이웃 동그라미를 가렸다.
 * 칸 자리에서 시작해 겹친 동그라미끼리 가운데를 잇는 방향으로 필요한 만큼만 떼어 낸다.
 * 같은 SaaS 안에서만 본다(묶음끼리는 이미 멀다). 무작위 없이 같은 입력이면 같은 자리다.
 */
export function separateDots(
  nodes: readonly SemanticNode[],
  radiusOf: (node: SemanticNode) => number,
  gap: number,
): Map<string, Point> {
  const byProvider = new Map<string, SemanticNode[]>()
  for (const node of nodes) byProvider.set(node.provider, [...(byProvider.get(node.provider) ?? []), node])

  const result = new Map<string, Point>()
  for (const members of byProvider.values()) {
    const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id))
    const pos = sorted.map(node => ({ x: node.x, y: node.y }))
    const radius = sorted.map(radiusOf)
    for (let pass = 0; pass < 200; pass++) {
      let moved = false
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const dx = pos[j].x - pos[i].x
          const dy = pos[j].y - pos[i].y
          const need = radius[i] + radius[j] + gap
          const d = Math.hypot(dx, dy)
          if (d >= need) continue
          // 두 가운데가 같으면 순서로 정한 방향으로 뗀다.
          const angle = (i * 7 + j * 13) % 360 * Math.PI / 180
          const ux = d > 1e-6 ? dx / d : Math.cos(angle)
          const uy = d > 1e-6 ? dy / d : Math.sin(angle)
          const push = (need - d) / 2 + 0.01
          pos[i].x -= ux * push
          pos[i].y -= uy * push
          pos[j].x += ux * push
          pos[j].y += uy * push
          moved = true
        }
      }
      if (!moved) break
    }
    sorted.forEach((node, i) => result.set(node.id, pos[i]))
  }
  return result
}
