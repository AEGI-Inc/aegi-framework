import type { Point } from './layoutAnchors'
import { orderedProviders, providerSlot } from './layoutAnchors'
import type { SemanticEdge, SemanticLevel, SemanticNode } from './types'
import { providerName } from '../findings/providers'
import { measureLabel } from './labelFit'
import { splitScopeLabel } from './nodeGlyphs'
import { ZOOM_STEPS, type WorldRect } from './viewport'

/* =========================================================================
   SaaS, 조직, 그룹 표시 수준의 원 그래프

   세 단계도 개별 항목 단계처럼 원과 선으로 그린다(전에는 네모 카드와 네모 묶음이라
   단계마다 모양이 달랐다). 원 크기는 안에 든 객체 수다.

   SaaS 자리는 모든 단계가 같은 계획(providerPlan)을 따른다. 다른 SaaS와 이어진 SaaS는
   가운데에 모으고, 연결이 없는 SaaS는 오른쪽 한 줄에 둔다. 단계마다 묶음 크기가 달라
   계획을 그 크기만큼 벌린다(spreadPlan). 그래서 확대해 내려가도 같은 SaaS가 같은 쪽에 남는다.

   이름표는 화면에서 같은 크기로 읽히게 그린다(배율이 작을수록 월드에서는 크다). 그래서 자리를
   잡을 때 화면 맞춤 배율을 먼저 정하고(layoutCircleLevel), 그 배율에서 이름표가 차지할 자리를 비운다.
   ========================================================================= */

export const CIRCLE_LEVELS: ReadonlySet<SemanticLevel> = new Set(['ecosystem', 'tenant', 'scope'])
export const isCircleLevel = (level: SemanticLevel) => CIRCLE_LEVELS.has(level)

/** 원 반지름(월드). 자리를 잡으며 정한 반지름(조직 단계)이 있으면 그 값. 객체가 아주 많은 SaaS가 화면을 다 차지하지 않게 400개에서 멈춘다 */
export function circleRadius(node: Pick<SemanticNode, 'level' | 'objectCount' | 'radius'>): number {
  if (node.radius) return node.radius
  const n = Math.min(Math.max(node.objectCount, 1), 400)
  if (node.level === 'ecosystem') return Math.round(58 + 6.5 * Math.sqrt(n))
  if (node.level === 'tenant') return Math.round(50 + 5 * Math.sqrt(n))
  return Math.round(44 + 7.5 * Math.sqrt(Math.min(n, 100)))
}

/** 조직, 그룹 단계에서 SaaS 묶음 가운데 원 */
export const HUB_RADIUS = 80
/** 가운데 SaaS 원 둘레에 조직이나 그룹을 두르는 단계 */
const ORBIT_LEVELS: ReadonlySet<SemanticLevel> = new Set(['tenant', 'scope'])
/**
 * 조직 단계 원 크기(화면 px). 조직은 몇 개뿐이라 이름표처럼 화면 맞춤 배율에서 이 크기로 잡는다.
 * 월드 크기로 두면 이름표 자리에 밀려 화면 맞춤 배율이 내려가 원이 점처럼 작아진다
 */
const TENANT_PX = { base: 14, perRoot: 1.2, hub: 26 }

/** 조직 이름표 아래 줄: 그 SaaS의 무엇인지(SaaS 이름은 가운데 원에 있다) */
const TENANT_KIND: Record<string, string> = {
  'okta|org': '조직',
  'gws|Customer': '도메인',
  'slack|enterprise': '엔터프라이즈',
  'slack|workspace': '워크스페이스',
  'github|Organization': '조직',
  'github|Enterprise': '엔터프라이즈',
  'atlassian|site': '사이트',
  'salesforce|Organization': '조직',
}
export function tenantKind(node: SemanticNode): string {
  if (node.service) return '서비스'
  const type = node.rawObject?.canonical.object_type
  return (type && TENANT_KIND[`${node.provider}|${type}`]) ?? '조직'
}

export type ProviderLink = [string, string, number]

/** 단계의 선에서 SaaS 사이 연결(서로 다른 SaaS를 잇는 선)과 그 수 */
export function providerLinks(nodes: SemanticNode[], edges: SemanticEdge[]): ProviderLink[] {
  const providerOf = new Map(nodes.map(node => [node.id, node.provider as string]))
  const weight = new Map<string, number>()
  for (const edge of edges) {
    const a = providerOf.get(edge.sourceSemanticNodeId)
    const b = providerOf.get(edge.targetSemanticNodeId)
    if (!a || !b || a === b) continue
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    weight.set(key, (weight.get(key) ?? 0) + Math.max(1, edge.findingCount + edge.relationCount + edge.resolutionCount))
  }
  return [...weight].map(([key, w]) => {
    const [a, b] = key.split('|')
    return [a, b, w] as ProviderLink
  })
}

/** SaaS 자리 계획. at 은 정규화 좌표(간격 1 안팎), column 은 오른쪽 줄에 둔 SaaS(위에서 아래 순) */
export interface ProviderPlan {
  at: Map<string, Point>
  column: string[]
  /** 연결이 하나도 없어 예전 두 줄 격자를 쓴다 */
  grid: boolean
  /** 이어진 두 SaaS(pairKey) */
  pairs: Set<string>
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * SaaS 자리 계획.
 * - 이어진 SaaS: 정다각형 꼭짓점. 왼쪽 위에서 시작해 반시계로(셋이면 왼쪽 위, 아래, 오른쪽)
 * - 연결 없는 SaaS: 이어진 묶음 오른쪽 한 줄, 위에서 아래로
 * - 연결이 하나도 없으면 예전 두 줄 격자
 */
export function providerPlan(present: Iterable<string>, links: ProviderLink[]): ProviderPlan {
  const order = orderedProviders(present)
  const linked = new Set(links.flatMap(([a, b]) => [a, b]))
  const ring = order.filter(provider => linked.has(provider))
  const alone = order.filter(provider => !linked.has(provider))
  const at = new Map<string, Point>()
  const pairs = new Set(links.map(([a, b]) => pairKey(a, b)))
  if (!ring.length) {
    for (const provider of order) {
      const { row, column } = providerSlot(provider, order)
      at.set(provider, { x: column * 1.3, y: row })
    }
    return { at, column: [], grid: true, pairs }
  }
  if (ring.length === 1) at.set(ring[0], { x: 0, y: 0 })
  else {
    const radius = ring.length === 2 ? 0.55 : 0.62 + 0.06 * (ring.length - 3)
    ring.forEach((provider, i) => {
      const angle = (-135 - (i * 360) / ring.length) * (Math.PI / 180)
      at.set(provider, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
    })
  }
  const xs = [...at.values()].map(p => p.x)
  const ys = [...at.values()].map(p => p.y)
  const columnX = Math.max(...xs) + 1.05
  const top = Math.min(...ys, -0.6)
  const bottom = Math.max(...ys, 0.6)
  alone.forEach((provider, i) => {
    const y = alone.length === 1 ? (top + bottom) / 2 : top + ((bottom - top) * i) / (alone.length - 1)
    at.set(provider, { x: columnX, y })
  })
  return { at, column: alone, grid: false, pairs }
}

/** 가운데에서 왼쪽, 오른쪽, 위, 아래로 차지하는 길이 */
export interface Reach { l: number; r: number; t: number; b: number }

const unionReach = (a: Reach, b: Reach): Reach => ({ l: Math.max(a.l, b.l), r: Math.max(a.r, b.r), t: Math.max(a.t, b.t), b: Math.max(a.b, b.b) })
const shiftReach = (reach: Reach, at: Point): Reach => ({ l: reach.l - at.x, r: reach.r + at.x, t: reach.t - at.y, b: reach.b + at.y })

/**
 * 계획을 월드 좌표로 벌린다. 묶음마다 가운데에서 네 방향으로 차지하는 길이(reach)를 받아, 어느 두 묶음도
 * 사각형이 겹치지 않는 가장 작은 배율을 찾는다(가로나 세로 중 한쪽으로만 떨어지면 된다).
 * pairGap 은 두 묶음 사이 틈(선 위 배지가 들어갈 자리처럼 쌍마다 다를 때)
 */
export function spreadPlan(at: ReadonlyMap<string, Point>, reach: ReadonlyMap<string, Reach>, gap: number, pairGap?: (a: string, b: string) => number): Map<string, Point> {
  const ids = [...at.keys()].filter(id => reach.has(id))
  const base = gap
  let scale = 1
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = at.get(ids[i])!, b = at.get(ids[j])!
      const ra = reach.get(ids[i])!, rb = reach.get(ids[j])!
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y)
      const gap = pairGap ? Math.max(base, pairGap(ids[i], ids[j])) : base
      const needX = dx > 1e-6 ? ((a.x < b.x ? ra.r + rb.l : rb.r + ra.l) + gap) / dx : Infinity
      const needY = dy > 1e-6 ? ((a.y < b.y ? ra.b + rb.t : rb.b + ra.t) + gap) / dy : Infinity
      scale = Math.max(scale, Math.min(needX, needY))
    }
  }
  return new Map(ids.map(id => [id, { x: at.get(id)!.x * scale, y: at.get(id)!.y * scale }]))
}

/** 이름표 글자 크기(화면 px) */
export const LABEL_PX = { name: 15, meta: 12.5, scope: 12.5, gap: 8 }

/**
 * 이름표 바닥 배율. 이보다 가까이서는 이름표가 화면에서 늘 같은 크기, 이보다 멀리서는 그래프와 함께 작아진다.
 * 그룹 단계는 그룹이 수십 개라 모든 이름표를 화면 크기로 둘 자리가 없다. 멀리서는 원과 SaaS 이름으로 보고
 * 가까이 가면 그룹 이름을 읽는다(개별 항목 단계와 같다). 그룹 단계 SaaS 이름은 더 멀리서도 화면 크기로 둔다.
 */
export const LABEL_FLOOR: Record<SemanticLevel, number> = { ecosystem: 0.2, tenant: 0.1, scope: 0.4, object: 1 }
export const HUB_LABEL_FLOOR = 0.1
/** 화면 1px 의 월드 길이(이름표 바닥 배율을 적용) */
export const labelPx = (level: SemanticLevel, zoom: number) => 1 / Math.max(zoom, LABEL_FLOOR[level], 0.01)
export const hubLabelPx = (zoom: number) => 1 / Math.max(zoom, HUB_LABEL_FLOOR)
/** 화면에서 이보다 작은 이름표는 읽을 수 없어 그리지 않는다(커서를 올리면 이름이 뜬다) */
export const LABEL_MIN_SCREEN_PX = 7.5

/** 원 이름표: 위 줄 굵게(무엇인지), 아래 줄 보충. 조직은 이름과 「종류 객체 수」 두 줄, 그룹은 「이름 객체 수」 한 줄 */
export function circleLabelLines(node: SemanticNode): [string, string] {
  if (node.level === 'ecosystem') return [node.label, `객체 ${node.objectCount}, 관계 ${node.relationCount}`]
  if (node.level === 'tenant') {
    const name = node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label
    return [name, `${tenantKind(node)} ${node.objectCount}`]
  }
  const scope = splitScopeLabel(node.label, node.scopeKind)
  const name = scope.name.length > 14 ? `${scope.name.slice(0, 13)}…` : scope.name
  return [`${name} ${node.objectCount}`, '']
}

/** 궤도 이름표(조직, 그룹)의 폭(화면 px)과 줄 수 */
function orbitLabelSize(node: SemanticNode): { width: number; lines: number } {
  const [name, meta] = circleLabelLines(node)
  return { width: Math.max(measureLabel(name, LABEL_PX.scope), meta ? measureLabel(meta, LABEL_PX.scope) : 0), lines: meta ? 2 : 1 }
}

export type LabelSide = 'below' | 'above' | 'right' | 'left'
type Anchor = 'start' | 'middle' | 'end'
export interface LabelLine { text: string; x: number; y: number; size: number; weight: number; anchor: Anchor }

/* 글자 상자: 기준선 위로 글자 크기의 0.82, 아래로 0.25. 굵은 글씨 폭은 measureLabel(600)보다 조금 넓다 */
const ASCENT = 0.82
const DESCENT = 0.25
const BOLD_WIDTH = 1.04

function textReach(lines: LabelLine[], width: number): Reach {
  const { x, anchor } = lines[0]
  const left = anchor === 'middle' ? x - width / 2 : anchor === 'start' ? x : x - width
  const first = lines[0], last = lines[lines.length - 1]
  return { l: -left, r: left + width, t: -(first.y - first.size * ASCENT), b: last.y + last.size * DESCENT }
}

/**
 * 원 이름표의 줄과 자리(원 가운데 기준 월드 좌표). lp 는 화면 1px 의 월드 길이.
 * SaaS: side 쪽에 두 줄. 조직, 그룹: SaaS 가운데에서 바깥쪽(angle)에 한 줄.
 * reach 는 원과 이름표를 함께 담는 길이(자리 잡기와 화면 맞춤이 같은 값을 쓴다), text 는 이름표 글자만 담는 길이.
 */
export function circleLabel(node: SemanticNode, side: LabelSide, angle: number | undefined, lp: number): { lines: LabelLine[]; reach: Reach; text: Reach } {
  const radius = circleRadius(node)
  const circle = { l: radius, r: radius, t: radius, b: radius }
  const [name, meta] = circleLabelLines(node)
  const gap = LABEL_PX.gap * lp
  if (ORBIT_LEVELS.has(node.level)) {
    const a = angle ?? Math.PI / 2
    const c = Math.cos(a), s = Math.sin(a)
    const size = LABEL_PX.scope * lp
    // 두 줄이면 원 쪽 줄(아래 원은 위 줄, 위 원은 아래 줄, 옆 원은 두 줄 가운데)을 한 줄일 때 자리에 둔다
    const lineGap = meta ? size * 1.3 : 0
    // 조직 원은 작아 오른쪽 위 위협 배지가 위 이름표에 닿는다. 위 이름표를 배지 위로 올린다
    const lift = node.level === 'tenant' ? 8 * lp : 0
    const x = c * (radius + gap)
    const y = s * (radius + gap) + (s > 0.35 ? size * 0.9 : s < -0.35 ? -2 * lp - lineGap - lift : size * 0.35 - lineGap / 2)
    const anchor: Anchor = Math.abs(c) < 0.35 ? 'middle' : c > 0 ? 'start' : 'end'
    const lines: LabelLine[] = [{ text: name, x, y, size, weight: 600, anchor }]
    if (meta) lines.push({ text: meta, x, y: y + lineGap, size, weight: 500, anchor })
    const text = textReach(lines, orbitLabelSize(node).width * lp)
    return { lines, reach: unionReach(circle, text), text }
  }
  const nameSize = LABEL_PX.name * lp, metaSize = LABEL_PX.meta * lp
  const lineGap = meta ? metaSize * 1.35 : 0
  const width = Math.max(measureLabel(name, LABEL_PX.name) * BOLD_WIDTH, meta ? measureLabel(meta, LABEL_PX.meta) : 0) * lp
  const [x, y, anchor]: [number, number, Anchor] =
    side === 'above' ? [0, -radius - gap - lineGap - nameSize * DESCENT, 'middle']
      : side === 'right' ? [radius + gap, nameSize * ASCENT - (nameSize + lineGap) / 2, 'start']
        : side === 'left' ? [-radius - gap, nameSize * ASCENT - (nameSize + lineGap) / 2, 'end']
          : [0, radius + gap + nameSize * ASCENT, 'middle']
  const lines: LabelLine[] = [{ text: name, x, y, size: nameSize, weight: 700, anchor }]
  if (meta) lines.push({ text: meta, x, y: y + lineGap, size: metaSize, weight: 500, anchor })
  const text = textReach(lines, width)
  return { lines, reach: unionReach(circle, text), text }
}

/** 조직, 그룹 단계 SaaS 가운데 원 아래 이름(가운데 원 기준). box 는 이름 글자만, reach 는 가운데 원까지 담는 길이 */
export function hubLabel(provider: string, lp: number, radius = HUB_RADIUS): { text: string; y: number; size: number; box: Reach; reach: Reach } {
  const text = providerName(provider)
  const size = LABEL_PX.name * lp
  const y = radius + LABEL_PX.gap * lp + size * ASCENT
  const half = (measureLabel(text, LABEL_PX.name) * BOLD_WIDTH * lp) / 2
  const box = { l: half, r: half, t: -(y - size * ASCENT), b: y + size * DESCENT }
  return { text, y, size, box, reach: unionReach(box, { l: radius, r: radius, t: radius, b: radius }) }
}

/** 화면 맞춤 배율을 어림할 때 쓰는 그래프 칸 크기(도구 막대, 여백을 뺀 크기) */
export interface LayoutView { width: number; height: number }
const DEFAULT_VIEW: LayoutView = { width: 1100, height: 680 }
/** SaaS 묶음 사이 틈(화면 px) */
const CLUSTER_GAP_PX = 48
/** SaaS 단계에서 이어진 두 SaaS 사이 틈(화면 px). 두 SaaS 사이 선이 여럿이어도 휜 선이 구별될 만큼 */
const LINK_GAP_PX = 96
/** 그룹 원 사이 틈(화면 px) */
const ORBIT_GAP_PX = 14
/** 화면 맞춤이 그림 둘레에 더하는 여백(월드, viewport.computeFitToView 의 worldPadding) */
const FIT_PADDING = 28

/**
 * 조직, 그룹 단계 SaaS 묶음: 가운데 원 둘레에 조직이나 그룹 원을 두르는 각과 궤도 반지름.
 * px 는 조직, 그룹 이름표, hubLp 는 SaaS 이름의 화면 1px 월드 길이.
 * 원마다 둘레 몫을 받는다: 지름, 위아래 원은 이름표가 가로로 놓이므로 이름표 폭. 몫만큼 각을 나눠
 * 이웃한 두 이름표가 겹치지 않게 한다. 위에서 시계 방향으로 두르고(홀수 개면 첫 원이 꼭대기),
 * 가운데 원 아래 SaaS 이름과 겹치는 원은 이름보다 아래나 이름 옆으로 밀어낸다.
 * 조직이 둘이면 위아래에 둔다. 좌우에 두면 이름표가 바깥으로 뻗어 묶음이 넓어지고 화면 맞춤 배율이 내려간다.
 */
function orbitLayout(children: SemanticNode[], px: number, hubName: Reach, hubLp: number, hubRadius: number): { angles: number[]; orbit: number } {
  const n = children.length
  const radii = children.map(circleRadius)
  const labels = children.map(orbitLabelSize)
  const gap = ORBIT_GAP_PX * px
  const even = n % 2 === 0 && !(n === 2 && children[0].level === 'tenant')
  let angles = children.map((_, i) => -Math.PI / 2 + ((i + (even ? 0.5 : 0)) / n) * Math.PI * 2)
  let total = 0
  for (let pass = 0; pass < 3; pass++) {
    const needs = children.map((_, i) => Math.max(radii[i] * 2, (Math.abs(Math.cos(angles[i])) < 0.35 ? labels[i].width : LABEL_PX.scope * 1.3 * labels[i].lines + 2) * px) + gap)
    total = needs.reduce((sum, need) => sum + need, 0)
    let at = -Math.PI / 2 - (even ? 0 : (needs[0] / 2 / total) * Math.PI * 2)
    angles = needs.map(need => {
      const angle = at + (need / 2 / total) * Math.PI * 2
      at += (need / total) * Math.PI * 2
      return angle
    })
  }
  // 둘레 몫은 호 길이라 현(두 원 사이 곧은 거리)보다 조금 길다. 그만큼 더 벌린다
  let orbit = Math.max(hubRadius + Math.max(0, ...radii) + 24 * px, n > 1 ? (total / (2 * Math.PI)) * 1.05 : 0)
  // SaaS 이름 글자 상자와 겹치는 원은 이름 위나 아래, 옆으로 밀어낸다(셋 중 가장 덜 미는 쪽)
  const clear = 6 * hubLp
  const top = -hubName.t, bottom = hubName.b, half = hubName.r
  for (let pass = 0; pass < 3; pass++) {
    angles.forEach((angle, i) => {
      const s = Math.sin(angle), c = Math.abs(Math.cos(angle)), r = radii[i]
      const fits = orbit * s + r <= top - clear || orbit * s - r >= bottom + clear || orbit * c - r >= half + clear
      if (fits) return
      orbit = Math.max(orbit, Math.min(
        c > 1e-6 ? (half + clear + r) / c : Infinity,
        s > 1e-6 ? (bottom + clear + r) / s : Infinity,
        s < -1e-6 ? (r - top + clear) / -s : Infinity,
      ))
    })
  }
  return { angles, orbit }
}

/** SaaS 단계 이름표 쪽: 이어진 묶음 바깥쪽(위나 아래가 먼저), 오른쪽 줄과 격자는 아래 */
function providerSide(plan: ProviderPlan, provider: string): LabelSide {
  if (plan.grid || plan.column.includes(provider)) return 'below'
  const ring = [...plan.at].filter(([id]) => !plan.column.includes(id)).map(([, p]) => p)
  if (ring.length < 2) return 'below'
  const cx = ring.reduce((sum, p) => sum + p.x, 0) / ring.length
  const cy = ring.reduce((sum, p) => sum + p.y, 0) / ring.length
  const p = plan.at.get(provider)!
  const dx = p.x - cx, dy = p.y - cy
  if (Math.abs(dy) < 0.2 * Math.hypot(dx, dy)) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'above' : 'below'
}

interface Laid {
  local: Map<string, Point>
  sides: Map<string, LabelSide>
  angles: Map<string, number>
  radii: Map<string, number>
  hubRadius: number
  centers: Map<string, Point>
  reach: Map<string, Reach>
  width: number
  height: number
}

function layoutOnce(byProvider: Map<string, SemanticNode[]>, level: SemanticLevel, plan: ProviderPlan, zoom: number): Laid {
  const px = labelPx(level, zoom)
  const hubLp = hubLabelPx(zoom)
  const local = new Map<string, Point>()
  const sides = new Map<string, LabelSide>()
  const angles = new Map<string, number>()
  const radii = new Map<string, number>()
  const reach = new Map<string, Reach>()
  const tenant = level === 'tenant'
  const hubRadius = tenant ? TENANT_PX.hub * px : HUB_RADIUS
  for (const [provider, all] of byProvider) {
    const list = tenant
      ? all.map(node => ({ ...node, radius: (TENANT_PX.base + TENANT_PX.perRoot * Math.sqrt(Math.min(Math.max(node.objectCount, 1), 400))) * px }))
      : all
    for (const node of list) if (node.radius) radii.set(node.id, node.radius)
    if (ORBIT_LEVELS.has(level)) {
      const hub = hubLabel(provider, hubLp, hubRadius)
      const { angles: around, orbit } = orbitLayout(list, px, hub.box, hubLp, hubRadius)
      let box = hub.reach
      list.forEach((node, i) => {
        const at = { x: Math.cos(around[i]) * orbit, y: Math.sin(around[i]) * orbit }
        local.set(node.id, at)
        angles.set(node.id, around[i])
        sides.set(node.id, 'below')
        box = unionReach(box, shiftReach(circleLabel(node, 'below', around[i], px).reach, at))
      })
      reach.set(provider, box)
      continue
    }
    // SaaS 단계: SaaS마다 원 하나
    const side = providerSide(plan, provider)
    for (const node of list) {
      local.set(node.id, { x: 0, y: 0 })
      sides.set(node.id, side)
    }
    reach.set(provider, circleLabel(list[0], side, undefined, px).reach)
  }
  const linkGap = level === 'ecosystem' ? (a: string, b: string) => (plan.pairs.has(pairKey(a, b)) ? LINK_GAP_PX * px : 0) : undefined
  const centers = placeProviders(plan, reach, CLUSTER_GAP_PX * px, linkGap)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [provider, c] of centers) {
    const e = reach.get(provider)!
    minX = Math.min(minX, c.x - e.l); maxX = Math.max(maxX, c.x + e.r)
    minY = Math.min(minY, c.y - e.t); maxY = Math.max(maxY, c.y + e.b)
  }
  return { local, sides, angles, radii, hubRadius, centers, reach, width: maxX - minX, height: maxY - minY }
}

/**
 * 계획을 월드 자리로(객체 단계의 SaaS 묶음 테두리도 같이 쓴다). 이어진 SaaS는 계획 모양 그대로 겹치지 않게 벌리고(spreadPlan),
 * 연결 없는 SaaS 줄은 실제 크기대로 위에서 아래로 쌓아 이어진 묶음 오른쪽에 붙인다.
 * 연결이 하나도 없으면(격자 계획) 계획 전체를 벌린다.
 */
export function placeProviders(plan: ProviderPlan, reach: ReadonlyMap<string, Reach>, gap: number, pairGap?: (a: string, b: string) => number): Map<string, Point> {
  const column = plan.column.filter(id => reach.has(id))
  const ring = [...plan.at.keys()].filter(id => reach.has(id) && !column.includes(id))
  if (!column.length || !ring.length) return spreadPlan(plan.at, reach, gap, pairGap)
  const centers = ring.length > 1 ? spreadPlan(new Map(ring.map(id => [id, plan.at.get(id)!])), reach, gap, pairGap) : new Map([[ring[0], { x: 0, y: 0 }]])
  const ringRight = Math.max(...ring.map(id => centers.get(id)!.x + reach.get(id)!.r))
  const ringTop = Math.min(...ring.map(id => centers.get(id)!.y - reach.get(id)!.t))
  const ringBottom = Math.max(...ring.map(id => centers.get(id)!.y + reach.get(id)!.b))
  const total = column.reduce((sum, id) => sum + reach.get(id)!.t + reach.get(id)!.b, 0) + gap * (column.length - 1)
  const x = ringRight + gap + Math.max(...column.map(id => reach.get(id)!.l))
  let y = (ringTop + ringBottom) / 2 - total / 2
  for (const id of column) {
    const r = reach.get(id)!
    centers.set(id, { x, y: y + r.t })
    y += r.t + r.b + gap
  }
  return centers
}

export interface CircleLayout {
  nodes: SemanticNode[]
  /** 조직, 그룹 단계의 SaaS 가운데 자리(가운데 원과 이름) */
  hubs: Array<{ provider: string; x: number; y: number }>
  hubRadius: number
  /** 이름표 쪽(SaaS)과 SaaS 가운데에서 본 각(조직, 그룹) */
  sides: Map<string, LabelSide>
  angles: Map<string, number>
  /** 화면 맞춤이 담을 사각형(원과 이름표, SaaS 가운데 원과 이름) */
  frames: WorldRect[]
  /** 자리를 잡은 배율. 화면 맞춤이 이 배율 이상으로 맞춘다 */
  zoom: number
}

/**
 * SaaS, 조직, 그룹 단계의 자리. links 는 SaaS 단계 선에서 뽑은 SaaS 사이 연결(모든 단계가 같은 계획을 쓰게).
 * 화면 맞춤 배율 단계(ZOOM_STEPS) 중, 그 배율의 이름표 자리를 비우고도 그래프 칸(view)에 다 들어가는
 * 가장 큰 배율을 고른다. 화면 맞춤도 같은 단계로 내려 맞추므로 이름표 자리가 모자라지 않는다.
 */
export function layoutCircleLevel(nodes: SemanticNode[], level: SemanticLevel, links: ProviderLink[], view: LayoutView = DEFAULT_VIEW): CircleLayout {
  const byProvider = new Map<string, SemanticNode[]>()
  for (const node of nodes) byProvider.set(node.provider, [...(byProvider.get(node.provider) ?? []), node])
  for (const list of byProvider.values()) list.sort((a, b) => b.objectCount - a.objectCount || a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
  const plan = providerPlan(byProvider.keys(), links.filter(([a, b]) => byProvider.has(a) && byProvider.has(b)))
  const width = Math.max(view.width, 320), height = Math.max(view.height, 240)
  const steps = ZOOM_STEPS.filter(step => step <= 1).slice().reverse()
  let zoom = steps[steps.length - 1]
  let laid = layoutOnce(byProvider, level, plan, zoom)
  for (const step of steps) {
    const next = layoutOnce(byProvider, level, plan, step)
    if ((next.width + FIT_PADDING * 2) * step <= width && (next.height + FIT_PADDING * 2) * step <= height) {
      zoom = step
      laid = next
      break
    }
  }
  const px = labelPx(level, zoom)
  const hubLp = hubLabelPx(zoom)
  const positioned = nodes.map(node => {
    const c = laid.centers.get(node.provider) ?? { x: 0, y: 0 }
    const o = laid.local.get(node.id) ?? { x: 0, y: 0 }
    const radius = laid.radii.get(node.id)
    return { ...node, x: c.x + o.x, y: c.y + o.y, ...(radius ? { radius } : {}) }
  })
  const hubs = ORBIT_LEVELS.has(level) ? [...laid.centers].map(([provider, c]) => ({ provider, x: c.x, y: c.y })) : []
  const rect = (at: Point, r: Reach): WorldRect => ({ x: at.x - r.l, y: at.y - r.t, width: r.l + r.r, height: r.t + r.b })
  const frames = [
    ...positioned.map(node => rect(node, circleLabel(node, laid.sides.get(node.id) ?? 'below', laid.angles.get(node.id), px).reach)),
    ...hubs.map(hub => rect(hub, hubLabel(hub.provider, hubLp, laid.hubRadius).reach)),
  ]
  return { nodes: positioned, hubs, hubRadius: laid.hubRadius, sides: laid.sides, angles: laid.angles, frames, zoom }
}
