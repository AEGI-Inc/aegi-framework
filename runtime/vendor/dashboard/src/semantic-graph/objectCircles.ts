import type { SemanticEdge, SemanticNode } from './types'
import { measureLabel } from './labelFit'
import { findingBadgeWidth } from './objectChip'
import { placeProviders, providerPlan, type ProviderLink, type Reach } from './circleLevels'
import { providerRows } from './layoutAnchors'
import { providerName } from '../findings/providers'
import type { ContainerFrame } from './containment'

/* =========================================================================
   객체 단계 원 배치

   SaaS, 조직, 그룹 단계처럼 객체 단계도 원으로 그린다. 전에는 사각 테두리 안에
   사각 칸이 들어가, 위 단계에서 원으로 보던 것이 객체 단계에서만 상자로 바뀌었다.
   - 개별 객체: 작은 원(종류 그림)과 원 아래 이름
   - 상위 객체(조직, 폴더, 그룹, 채널, 저장소 …): 원 테두리와 테두리 맨 위에 걸친 이름표
   - SaaS: SaaS 색 원 테두리와 로고 이름표
   안에 든 것은 원 채우기(d3-hierarchy packSiblings 와 같은 앞줄 방식)로 놓는다.
   이름표까지 둘레의 자리로 잡아(pr) 옆 원이 이름표를 덮지 않는다.
   ========================================================================= */

/** 개별 객체 원 반지름(월드) */
export const OBJECT_CIRCLE_R = 24
/** 원 아래 이름 글자 크기와 최대 폭(월드). 배치는 이 크기로 자리 폭을 재고, 화면은 이보다 크게 그리지 않는다(배율 0.8에서 화면 13px) */
export const OBJECT_CIRCLE_LABEL = 16
export const OBJECT_CIRCLE_LABEL_MAX = 180
/** 원 아래 끝에서 이름 기준선까지 */
export const OBJECT_CIRCLE_LABEL_GAP = 17
/** 원과 이름을 한 덩어리로 보면 가운데가 원 가운데보다 이만큼 아래다 */
const SLOT_DY = 12
/** 상위 객체 이름표 높이와 제목 글자 크기 */
export const RING_LEGEND_H = 40
/** 이름표 폭을 잴 때의 제목 크기. 화면에서 그리는 크기의 최댓값과 같아, 그 아래 크기에서는 이름이 다 들어간다 */
export const RING_TITLE = 20
const RING_TITLE_MAX = 300
/** SaaS 이름표 높이 */
export const SAAS_LEGEND_H = 52
const RING_PAD = 26
const SAAS_PAD = 34
const CHILD_GAP = 10
const ROOT_GAP = 16
const PROVIDER_GAP = 240

export function ringLegendWidth(label: string, findingCount: number): number {
  return 12 + 22 + 10 + Math.min(measureLabel(label, RING_TITLE) * 1.08, RING_TITLE_MAX) + (findingCount > 0 ? findingBadgeWidth(findingCount) + 10 : 0) + 20
}
export function saasLegendWidth(provider: string, count: number): number {
  // 화면의 이름표(fullGraph.css .fg-cluster-head: 여백 20, 로고 34, 틈 12, 이름 29px, 개수 22px)와 같은 폭
  return 20 + 34 + 12 + measureLabel(providerName(provider), 29) * 1.08 + 12 + measureLabel(`항목 ${count}`, 22) + 20
}

/** 개별 객체 자리 폭: 이름 폭 + 여백, 원 지름보다 넉넉히. 화면의 이름도 이 폭을 넘지 않는다 */
export function leafSlotWidth(label: string): number {
  return Math.max(84, Math.min(measureLabel(label, OBJECT_CIRCLE_LABEL), OBJECT_CIRCLE_LABEL_MAX) + 16)
}

type Circle = { r: number; x: number; y: number }

/* 원 채우기: 주어진 순서대로 앞줄에 붙인다(d3-hierarchy packSiblings 와 같은 방식) */
function place(b: Circle, a: Circle, c: Circle): void {
  const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy
  if (d2) {
    const a2 = (a.r + c.r) ** 2, b2 = (b.r + c.r) ** 2
    if (a2 > b2) {
      const x = (d2 + b2 - a2) / (2 * d2), y = Math.sqrt(Math.max(0, b2 / d2 - x * x))
      c.x = b.x - x * dx - y * dy
      c.y = b.y - x * dy + y * dx
    } else {
      const x = (d2 + a2 - b2) / (2 * d2), y = Math.sqrt(Math.max(0, a2 / d2 - x * x))
      c.x = a.x + x * dx - y * dy
      c.y = a.y + x * dy + y * dx
    }
  } else {
    c.x = a.x + c.r
    c.y = a.y
  }
}
const intersects = (a: Circle, b: Circle) => {
  const dr = a.r + b.r - 1e-6, dx = b.x - a.x, dy = b.y - a.y
  return dr > 0 && dr * dr > dx * dx + dy * dy
}
type Chain = { c: Circle; next: Chain; previous: Chain }
const score = (node: Chain) => {
  const a = node.c, b = node.next.c, ab = a.r + b.r
  const dx = (a.x * b.r + b.x * a.r) / ab, dy = (a.y * b.r + b.y * a.r) / ab
  return dx * dx + dy * dy
}
function packSiblings(circles: Circle[]): void {
  const n = circles.length
  if (!n) return
  circles[0].x = 0
  circles[0].y = 0
  if (n < 2) return
  circles[0].x = -circles[1].r
  circles[1].x = circles[0].r
  circles[1].y = 0
  if (n < 3) return
  place(circles[1], circles[0], circles[2])
  let a = { c: circles[0] } as Chain, b = { c: circles[1] } as Chain, c = { c: circles[2] } as Chain
  a.next = c.previous = b
  b.next = a.previous = c
  c.next = b.previous = a
  pack: for (let i = 3; i < n; ++i) {
    place(a.c, b.c, circles[i])
    c = { c: circles[i] } as Chain
    let j = b.next, k = a.previous, sj = b.c.r, sk = a.c.r
    do {
      if (sj <= sk) {
        if (intersects(j.c, c.c)) { b = j; a.next = b; b.previous = a; --i; continue pack }
        sj += j.c.r
        j = j.next
      } else {
        if (intersects(k.c, c.c)) { a = k; a.next = b; b.previous = a; --i; continue pack }
        sk += k.c.r
        k = k.previous
      }
    } while (j !== k.next)
    c.previous = a
    c.next = b
    a.next = b.previous = b = c
    let aa = score(a)
    while ((c = c.next) !== b) {
      const ca = score(c)
      if (ca < aa) { a = c; aa = ca }
    }
    b = a.next
  }
}
/** 원들을 감싸는 원. 하나씩 넓혀 가며 세 번 훑는다(가장 작은 원에 가깝다) */
function enclose(circles: Circle[]): Circle {
  let e = { ...circles[0] }
  for (let pass = 0; pass < 3; pass++) {
    for (const c of circles) {
      const d = Math.hypot(c.x - e.x, c.y - e.y)
      if (d + c.r <= e.r + 1e-6) continue
      const r = (d + c.r + e.r) / 2
      const t = d ? (r - e.r) / d : 0
      e = { x: e.x + (c.x - e.x) * t, y: e.y + (c.y - e.y) * t, r }
    }
  }
  return e
}

interface Packed {
  /** 그리는 원의 반지름(개별 객체는 OBJECT_CIRCLE_R, 상위 객체는 테두리) */
  r: number
  /** 이름(표)까지 담은 자리의 반지름 */
  pr: number
  /** 부모 원 가운데에서 본 자리 가운데 */
  dx: number
  dy: number
  container: boolean
  legend: number
}
export interface ObjectCirclePack {
  byId: Map<string, Packed>
  providers: Map<string, { r: number; pr: number; legend: number; count: number; roots: string[] }>
  children: Map<string, string[]>
}

/** 원 크기와 부모 안 자리. 자리(위치)와 무관해 배치와 그리기가 같은 값을 다시 얻는다 */
export function packObjectCircles(nodes: SemanticNode[], parentOf: ReadonlyMap<string, string>): ObjectCirclePack {
  const byNode = new Map(nodes.map(node => [node.id, node]))
  const parentIn = (id: string) => {
    const parent = parentOf.get(id)
    return parent !== undefined && byNode.has(parent) && parent !== id ? parent : undefined
  }
  const children = new Map<string, string[]>()
  const roots = new Map<string, string[]>()
  for (const node of nodes) {
    const parent = parentIn(node.id)
    if (parent !== undefined) children.set(parent, [...(children.get(parent) ?? []), node.id])
    else roots.set(node.provider, [...(roots.get(node.provider) ?? []), node.id])
  }
  const byId = new Map<string, Packed>()
  const order = (ids: string[]) => [...ids].sort((a, b) =>
    byId.get(b)!.pr - byId.get(a)!.pr ||
    (byNode.get(a)!.objectType ?? '').localeCompare(byNode.get(b)!.objectType ?? '') ||
    byNode.get(a)!.label.localeCompare(byNode.get(b)!.label) || a.localeCompare(b))
  const packInto = (ids: string[], gap: number) => {
    const circles = order(ids).map(id => ({ id, r: byId.get(id)!.pr + gap / 2, x: 0, y: 0 }))
    packSiblings(circles)
    const e = enclose(circles)
    for (const c of circles) {
      const p = byId.get(c.id)!
      // 개별 객체는 자리 가운데보다 원이 SLOT_DY 위에 있다
      p.dx = c.x - e.x
      p.dy = c.y - e.y - (p.container ? 0 : SLOT_DY)
    }
    return e.r
  }
  const visiting = new Set<string>()
  const measure = (id: string) => {
    if (byId.has(id) || visiting.has(id)) return
    visiting.add(id)
    const node = byNode.get(id)!
    const inside = (children.get(id) ?? []).filter(child => !visiting.has(child))
    for (const child of inside) measure(child)
    if (!inside.length) {
      byId.set(id, { r: OBJECT_CIRCLE_R, pr: leafSlotWidth(node.label) / 2, dx: 0, dy: 0, container: false, legend: 0 })
      return
    }
    const legend = ringLegendWidth(node.label, node.findingCount)
    const inner = packInto(inside, CHILD_GAP)
    const r = Math.max(inner + RING_PAD, legend / 2 + 30)
    byId.set(id, { r, pr: Math.max(r + 14, Math.hypot(legend / 2, r + RING_LEGEND_H / 2) + 6), dx: 0, dy: 0, container: true, legend })
  }
  const providers = new Map<string, { r: number; pr: number; legend: number; count: number; roots: string[] }>()
  const counts = new Map<string, number>()
  for (const node of nodes) counts.set(node.provider, (counts.get(node.provider) ?? 0) + 1)
  for (const [provider, ids] of roots) {
    for (const id of ids) measure(id)
    const legend = saasLegendWidth(provider, counts.get(provider) ?? 0)
    const inner = packInto(ids, ROOT_GAP)
    const r = Math.max(inner + SAAS_PAD, legend / 2 + 40)
    providers.set(provider, { r, pr: Math.max(r + 22, Math.hypot(legend / 2, r + SAAS_LEGEND_H / 2) + 6), legend, count: counts.get(provider) ?? 0, roots: ids })
  }
  return { byId, providers, children }
}

/**
 * 객체 단계 자리. 개별 객체는 원 가운데, 상위 객체는 자기 테두리 맨 위 이름표 가운데에 놓는다.
 * SaaS 원 자리는 다른 단계와 같은 계획(providerPlan)을 따르고, 이어진 SaaS가 없으면 두 줄 격자다.
 */
export function layoutObjectCircles(
  nodes: SemanticNode[], parentOf: ReadonlyMap<string, string>, _edges: SemanticEdge[] = [], links: ProviderLink[] = [],
): SemanticNode[] {
  const pack = packObjectCircles(nodes, parentOf)
  const centers = providerCenters(pack, links)
  const positions = new Map<string, { x: number; y: number }>()
  // (cx, cy) = 이 객체 원 가운데
  const put = (id: string, cx: number, cy: number) => {
    const p = pack.byId.get(id)!
    positions.set(id, p.container ? { x: cx, y: cy - p.r } : { x: cx, y: cy })
    for (const child of pack.children.get(id) ?? []) {
      const c = pack.byId.get(child)
      if (c && !positions.has(child)) put(child, cx + c.dx, cy + c.dy)
    }
  }
  for (const [provider, info] of pack.providers) {
    const center = centers.get(provider) ?? { x: 0, y: 0 }
    for (const id of info.roots) {
      const p = pack.byId.get(id)!
      put(id, center.x + p.dx, center.y + p.dy)
    }
  }
  return nodes.map(node => ({ ...node, ...(positions.get(node.id) ?? { x: node.x, y: node.y }) }))
}

function providerCenters(pack: ObjectCirclePack, links: ProviderLink[]): Map<string, { x: number; y: number }> {
  const present = [...pack.providers.keys()]
  const plan = providerPlan(present, links.filter(([a, b]) => pack.providers.has(a) && pack.providers.has(b)))
  if (!plan.grid) {
    const reach = new Map<string, Reach>(present.map(provider => {
      const pr = pack.providers.get(provider)!.pr
      return [provider, { l: pr, r: pr, t: pr, b: pr }]
    }))
    return placeProviders(plan, reach, PROVIDER_GAP)
  }
  const out = new Map<string, { x: number; y: number }>()
  let y = 0
  for (const row of providerRows(present)) {
    const height = Math.max(0, ...row.map(provider => 2 * (pack.providers.get(provider)?.pr ?? 0)))
    let x = 0
    for (const provider of row) {
      const pr = pack.providers.get(provider)?.pr ?? 0
      out.set(provider, { x: x + pr, y: y + height / 2 })
      x += 2 * pr + PROVIDER_GAP
    }
    if (height) y += height + PROVIDER_GAP
  }
  return out
}

/** 원 테두리. 사각 테두리(ContainerFrame)와 같은 자리에 둘러싼 사각(x, y, width, height)도 둔다 */
export interface CircleFrame extends ContainerFrame { cx: number; cy: number; r: number; legend: number }
export interface ProviderCircle { provider: string; cx: number; cy: number; r: number; legend: number; count: number }

/** 놓인 칸에서 상위 객체 원과 SaaS 원을 잰다. 배치와 같은 packObjectCircles 를 쓴다 */
export function objectCircleFrames(
  nodes: SemanticNode[], parentOf: ReadonlyMap<string, string>, memberChildren: ReadonlySet<string> = new Set(),
): { frames: CircleFrame[]; providers: ProviderCircle[] } {
  const pack = packObjectCircles(nodes, parentOf)
  const byNode = new Map(nodes.map(node => [node.id, node]))
  const centerOf = (id: string) => {
    const node = byNode.get(id)!
    const p = pack.byId.get(id)!
    return p.container ? { x: node.x, y: node.y + p.r } : { x: node.x, y: node.y }
  }
  const frames: CircleFrame[] = []
  const walk = (id: string, depth: number): number => {
    const inside = pack.children.get(id) ?? []
    let count = 0
    for (const child of inside) count += 1 + walk(child, depth + 1)
    const p = pack.byId.get(id)!
    if (p.container) {
      const node = byNode.get(id)!
      const c = centerOf(id)
      frames.push({
        id, provider: node.provider, label: node.label, objectType: node.objectType, depth,
        descendantCount: count, memberCount: inside.filter(child => memberChildren.has(child)).length,
        hubX: node.x, hubY: node.y, cx: c.x, cy: c.y, r: p.r, legend: p.legend,
        x: c.x - p.r, y: c.y - p.r - RING_LEGEND_H / 2, width: 2 * p.r, height: 2 * p.r + RING_LEGEND_H / 2,
      })
    }
    return count
  }
  const providers: ProviderCircle[] = []
  for (const [provider, info] of pack.providers) {
    for (const id of info.roots) walk(id, 0)
    const first = info.roots[0]
    if (first === undefined) continue
    const c = centerOf(first)
    const p = pack.byId.get(first)!
    // 개별 객체 뿌리는 원이 자리보다 SLOT_DY 위라, 자리에서 본 차이(dx, dy)를 그대로 되돌린다
    providers.push({ provider, cx: c.x - p.dx, cy: c.y - p.dy, r: info.r, legend: info.legend, count: info.count })
  }
  frames.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id))
  return { frames, providers }
}
