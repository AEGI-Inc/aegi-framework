import type { SemanticLevel, SemanticNode } from './types'

export interface ViewportSize {
  width: number
  height: number
}

export interface SafeInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface GraphBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface WorldRect {
  x: number
  y: number
  width: number
  height: number
}

/* 화면 맞춤, 표시 수준 이동처럼 카메라를 다시 잡을 때는 이 값들 중 하나로 멈춘다. 13%, 17%처럼 어중간한 숫자가 남지 않게 한다.
   원 단계 자리 잡기(circleLevels)도 이 배율 중 하나에 맞춰 이름표 자리를 비운다 */
export const ZOOM_STEPS = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32]

export interface CameraTransform {
  zoom: number
  pan: { x: number; y: number }
}

/**
 * 노드 한 칸이 차지하는 월드 크기.
 *
 * 화면 맞춤이 이 값으로 여백을 잡으므로 실제로 그리는 크기와 같아야 한다.
 * 예전에는 렌더러가 130x44를 그리는데 여기서는 136x52로 셌다.
 * L4 칸은 146이면 그림과 Finding 수를 빼고 이름이 네댓 글자만 남아(「Norma…」) 240으로 넓혔다.
 * L4 칸은 이름 길이에 맞춰 칸마다 폭이 다르다(objectChip.ts). 240은 폭을 모를 때의 기본값이다.
 */
export const SEMANTIC_NODE_BOX: Record<SemanticLevel, { width: number; height: number }> = {
  ecosystem: { width: 376, height: 104 },
  tenant: { width: 460, height: 112 },
  scope: { width: 268, height: 84 },
  object: { width: 240, height: 48 },
}

/**
 * 칸과 칸 사이에 두는 최소 간격.
 *
 * 자리 계산이 이 간격을 빼고 격자를 나누면 칸끼리 겹친다. 실제로 L3는
 * 한 칸에 194px만 내주면서 228px짜리 칸을 그려, GitHub 사분면에서만
 * 스무 쌍이 가로로 34px씩 포개져 있었다.
 */
export const SEMANTIC_NODE_GAP: Record<SemanticLevel, { x: number; y: number }> = {
  ecosystem: { x: 0, y: 0 },
  tenant: { x: 0, y: 0 },
  scope: { x: 22, y: 20 },
  object: { x: 20, y: 18 },
}

export function semanticNodeVisualSize(level: SemanticLevel): { width: number; height: number } {
  return SEMANTIC_NODE_BOX[level]
}

/**
 * 화면에 맞출 범위.
 *
 * `frames`는 노드 말고도 실제로 그리는 사각형(상세 단계의 SaaS 묶음
 * 테두리)을 받는다. 그리지 않는 사각형을 여기에 넣으면 있지도 않은
 * 여백까지 맞추느라 배율만 깎인다.
 * 원 단계(SaaS, 조직, 그룹)는 칸 크기 대신 frames(원과 이름표)만 센다(nodeBox false).
 */
export function computeProjectedBounds(nodes: SemanticNode[], frames: WorldRect[] = [], nodeBox = true): GraphBounds | null {
  if (nodes.length === 0) return null
  if (!nodeBox && frames.length) return {
    minX: Math.min(...frames.map(frame => frame.x)),
    minY: Math.min(...frames.map(frame => frame.y)),
    maxX: Math.max(...frames.map(frame => frame.x + frame.width)),
    maxY: Math.max(...frames.map(frame => frame.y + frame.height)),
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  const isEcosystem = nodes[0]?.level === 'ecosystem'

  for (const node of nodes) {
    const size = semanticNodeVisualSize(node.level)
    minX = Math.min(minX, node.x - size.width / 2)
    minY = Math.min(minY, node.y - size.height / 2)
    maxX = Math.max(maxX, node.x + size.width / 2)
    maxY = Math.max(maxY, node.y + size.height / 2)
  }

  const pad = isEcosystem ? { x: 60, y: 40 } : { x: 40, y: 32 }
  minX -= pad.x
  minY -= pad.y
  maxX += pad.x
  maxY += pad.y

  for (const frame of frames) {
    minX = Math.min(minX, frame.x)
    minY = Math.min(minY, frame.y)
    maxX = Math.max(maxX, frame.x + frame.width)
    maxY = Math.max(maxY, frame.y + frame.height)
  }

  return { minX, minY, maxX, maxY }
}

export function computeFitToView(
  nodes: SemanticNode[],
  viewport: ViewportSize,
  insets: SafeInsets,
  options?: { minZoom?: number; maxZoom?: number; worldPadding?: number; frames?: WorldRect[]; nodeBox?: boolean }
): CameraTransform | null {
  const bounds = computeProjectedBounds(nodes, options?.frames ?? [], options?.nodeBox ?? true)
  if (!bounds || viewport.width <= 0 || viewport.height <= 0) return null

  const minZoom = options?.minZoom ?? 0.001
  const maxZoom = options?.maxZoom ?? 1.1
  const worldPadding = options?.worldPadding ?? 28
  const availableWidth = Math.max(viewport.width - insets.left - insets.right, 180)
  const availableHeight = Math.max(viewport.height - insets.top - insets.bottom, 180)
  const worldWidth = Math.max(bounds.maxX - bounds.minX + worldPadding * 2, 1)
  const worldHeight = Math.max(bounds.maxY - bounds.minY + worldPadding * 2, 1)
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min(
    availableWidth / worldWidth,
    availableHeight / worldHeight
  )))
  const minX = bounds.minX - worldPadding
  const minY = bounds.minY - worldPadding
  const pan = {
    x: insets.left + (availableWidth - worldWidth * zoom) / 2 - minX * zoom,
    y: insets.top + (availableHeight - worldHeight * zoom) / 2 - minY * zoom,
  }
  return { zoom, pan }
}
