/** Screen coordinates: labels keep their size while the graph camera zooms. */
export interface LabelRect { x: number; y: number; width: number; height: number }
export interface LabelCandidate {
  id: string
  x: number
  y: number
  radius: number
  width: number
  height: number
  priority: number
}
export interface PlacedLabel extends LabelRect { id: string }

export function overlaps(a: LabelRect, b: LabelRect, gap = 3): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
}

/** Never move the graph to make room for a label, or cover another label/node. */
export function placeReadableLabels(
  candidates: readonly LabelCandidate[], bounds: LabelRect, obstacles: readonly LabelRect[] = [], limit = 60,
): PlacedLabel[] {
  const placed: PlacedLabel[] = []
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
  for (const item of ordered) {
    if (placed.length >= limit) break
    const r = item.radius + 6
    const positions = [
      { x: item.x + r, y: item.y - item.height / 2 },
      { x: item.x - r - item.width, y: item.y - item.height / 2 },
      { x: item.x - item.width / 2, y: item.y - r - item.height },
      { x: item.x - item.width / 2, y: item.y + r },
    ]
    const found = positions.map(at => ({ ...at, width: item.width, height: item.height })).find(rect =>
      rect.x >= bounds.x && rect.y >= bounds.y && rect.x + rect.width <= bounds.x + bounds.width &&
      rect.y + rect.height <= bounds.y + bounds.height &&
      ![...obstacles, ...placed].some(other => overlaps(rect, other)))
    if (found) placed.push({ id: item.id, ...found })
  }
  return placed
}
