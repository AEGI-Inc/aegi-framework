import type { GraphStore, GraphStoreV2 } from '../model/graph'
import type { FixtureObject, ObjectReferenceWrapper } from '../model/object'
import type { SemanticEdge, SemanticNode } from './types'
import { resolveReferenceObjects } from './hierarchy'
import { CLUSTER_HEADER, CLUSTER_PAD, LABEL_STRIP_PX, labelSafeRowGap, MIN_FIT_CANVAS, providerRows } from './layoutAnchors'
import { placeProviders, providerPlan, type ProviderLink, type Reach } from './circleLevels'
import { providerName } from '../findings/providers'
import { measureLabel } from './labelFit'
import { findingBadgeWidth } from './objectChip'

type Graph = GraphStore | GraphStoreV2
type Box = { width: number; height: number }

/**
 * L4 칸의 "무엇 안에 들어 있나".
 *
 * 채널은 워크스페이스 안에, 메시지는 채널 안에, 커밋은 저장소 안에 있다.
 * 전에는 칸을 첫 번째 member_of 대상 주위에 둘렀다. 사용자는 채널 여러 곳에
 * 속하므로 #helpdesk 가 한가운데 앉고 정작 워크스페이스는 그 옆 칸 하나였다.
 *
 * 근거는 순서대로 contained_in 관계 → references.parent → 소속(member_of)이 한 곳뿐인
 * 그룹·채널·팀 → references.tenant.
 * 소속은 여러 곳에 동시에 걸릴 수 있다. 한 곳뿐일 때만 그 그룹 테두리 안에 넣고,
 * 두 곳 이상이면 어느 한 곳을 고르지 않고 테넌트 안에 둔 채 소속을 선으로 남긴다 —
 * 하나를 골라 넣으면 그 그룹에만 속한 것처럼 읽힌다.
 * 전원이 들어 있는 그룹(Okta Everyone 등)은 아무것도 가르지 않으므로 소속으로 세지 않는다.
 * 여기서 관계를 새로 만들지 않는다(D-13). 칸을 어느 테두리 안에 둘지만 정한다.
 */
type Container = { key: string; via: 'structure' | 'membership' }

/** 같은 SaaS 에서 소속이 있는 주체의 90% 이상(3명 이상)을 담은 그룹. */
function everyoneGroups(graph: Graph): Set<string> {
  const members = new Map<string, number>()
  const principals = new Map<string, Set<string>>()
  for (const rels of graph.outgoingRelationsByObject.values()) {
    for (const rel of rels) {
      if (rel.relationType !== 'member_of') continue
      const provider = graph.objectsByKey.get(rel.sourceKey)?.canonical.provider ?? ''
      members.set(rel.targetKey, (members.get(rel.targetKey) ?? 0) + 1)
      principals.set(provider, (principals.get(provider) ?? new Set()).add(rel.sourceKey))
    }
  }
  const result = new Set<string>()
  for (const [group, count] of members) {
    const provider = graph.objectsByKey.get(group)?.canonical.provider ?? ''
    const total = principals.get(provider)?.size ?? 0
    if (count >= 3 && count >= total * 0.9) result.add(group)
  }
  return result
}

function directContainer(graph: Graph, obj: FixtureObject, everyone: ReadonlySet<string>): Container | undefined {
  const provider = obj.canonical.provider
  const outgoing = graph.outgoingRelationsByObject.get(obj.fixture_key) ?? []
  const sameProvider = (key: string) => key !== obj.fixture_key && graph.objectsByKey.get(key)?.canonical.provider === provider
  const contained = outgoing
    .filter(rel => rel.relationType === 'contained_in')
    .map(rel => rel.targetKey)
    .filter(sameProvider)
    .sort()[0]
  if (contained) return { key: contained, via: 'structure' }

  const references = obj.canonical.references
  const reference = (wrapper: ObjectReferenceWrapper | undefined) =>
    resolveReferenceObjects(wrapper, obj, graph as GraphStore).find(candidate => candidate.fixture_key !== obj.fixture_key)
  const parent = reference(references?.parent)
  if (parent) return { key: parent.fixture_key, via: 'structure' }

  // 조직(테넌트) 소속은 아래 tenant 참조가 이미 말한다.
  const groups = [...new Set(outgoing
    .filter(rel => rel.relationType === 'member_of')
    .map(rel => rel.targetKey)
    .filter(sameProvider)
    .filter(key => !everyone.has(key) && !graph.objectsByKey.get(key)?.canonical.interfaces.includes('Tenant')))]
  if (groups.length === 1) return { key: groups[0], via: 'membership' }

  const tenant = reference(references?.tenant)
  if (tenant) return { key: tenant.fixture_key, via: 'structure' }
  return undefined
}

type Containment = { parentOf: Map<string, string>; membership: Set<string> }
const containmentCache = new WeakMap<Graph, Containment>()

function containment(graph: Graph): Containment {
  const cached = containmentCache.get(graph)
  if (cached) return cached

  const everyone = everyoneGroups(graph)
  const parentOf = new Map<string, string>()
  const membership = new Set<string>()
  for (const obj of graph.objectsByKey.values()) {
    const container = directContainer(graph, obj, everyone)
    if (!container) continue
    parentOf.set(obj.fixture_key, container.key)
    if (container.via === 'membership') membership.add(obj.fixture_key)
  }
  for (const key of [...parentOf.keys()].sort()) {
    const seen = new Set([key])
    let current = parentOf.get(key)
    while (current !== undefined) {
      if (seen.has(current)) {
        parentOf.delete(key)
        break
      }
      seen.add(current)
      current = parentOf.get(current)
    }
  }
  for (const key of membership) if (!parentOf.has(key)) membership.delete(key)
  const result = { parentOf, membership }
  containmentCache.set(graph, result)
  return result
}

/** 객체 → 바로 위 상위 객체. 순환이 있으면 순환을 닫는 쪽을 끊는다. */
export function buildContainment(graph: Graph): ReadonlyMap<string, string> {
  return containment(graph).parentOf
}

/** 그룹 테두리 안에 소속(member_of)으로 들어간 객체들. */
export function membershipNested(graph: Graph): ReadonlySet<string> {
  return containment(graph).membership
}

/** 가장 바깥부터 바로 위까지의 상위 객체들. */
export function containerAncestors(parentOf: ReadonlyMap<string, string>, key: string): string[] {
  const chain: string[] = []
  const seen = new Set([key])
  let current = parentOf.get(key)
  while (current !== undefined && !seen.has(current)) {
    chain.unshift(current)
    seen.add(current)
    current = parentOf.get(current)
  }
  return chain
}

/**
 * 화면에 보이는 칸끼리의 포함. 바로 위 객체가 조사 범위 밖이면 그 위의
 * 보이는 조상을 쓴다. 보이는 조상이 없으면 SaaS 묶음 바로 아래에 놓인다.
 */
export function visibleContainment(
  parentOf: ReadonlyMap<string, string>, visible: ReadonlySet<string>
): Map<string, string> {
  const result = new Map<string, string>()
  for (const id of visible) {
    const seen = new Set([id])
    let current = parentOf.get(id)
    while (current !== undefined && !visible.has(current) && !seen.has(current)) {
      seen.add(current)
      current = parentOf.get(current)
    }
    if (current !== undefined && visible.has(current) && current !== id) result.set(id, current)
  }
  return result
}

/* 포함 거품(둥근 사각형)의 치수(월드 좌표). 배치와 거품 그리기가 같은 값을 써야
   거품이 칸을 정확히 감싼다. */
export const NEST_PAD = 18
export const NEST_GAP = 18
/* 테두리 제목 줄. 상위 객체(워크스페이스 · 채널 · 그룹 …)는 가운데 칸이 아니라 자기 테두리
   맨 위 제목 줄로 그린다. 전에는 칸이 테두리 한가운데에 앉고 이름이 그 아래 붙어, 테두리가
   어디부터 어디까지인지, 제목이 무엇인지가 안 보였다. 줄 높이 · 제목 글자의 가장 큰 크기 ·
   Finding 수 칸(objectChip findingBadgeWidth, 월드). 줄 폭은 제목이 가장 큰 글자로도 다 들어가게 잡는다(최대 NEST_HEADER_MAX_WIDTH). */
export const NEST_HEADER = 52
export const NEST_TITLE_MAX = 26
const NEST_HEADER_MAX_WIDTH = 640

/** 이 제목 줄의 폭: 그림 칸 · 제목 · Finding 수 칸. 제목은 700 굵기라 조금 넉넉히 잰다. */
export function nestHeaderWidth(label: string, findingCount: number): number {
  const title = Math.ceil(measureLabel(label, NEST_TITLE_MAX) * 1.08)
  return Math.min(NEST_HEADER_MAX_WIDTH, NEST_HEADER + 12 + title + 16 + (findingCount > 0 ? findingBadgeWidth(findingCount) + 10 : 0))
}
const PROVIDER_GAP = 120
/* SaaS 묶음 머리글(로고 · 'Google Workspace' · 항목 수)이 테두리 밖으로 나가지 않을 폭. */
export const PROVIDER_MIN_CONTENT = 400
const RELAX_STEPS = 240

/** 칸·가운데 칸·거품 모두 사각형(가운데 좌표와 반폭·반높이)이다. */
type Shape = { x: number; y: number; hw: number; hh: number }

/**
 * 테두리 전체: 맨 위 제목 줄(가운데가 상위 객체 자리 hub) 아래에 안에 든 것들(content,
 * 여백 포함)이 온다. 폭은 둘 중 넓은 쪽에 맞추고 hub 를 가운데로 둔다.
 */
function frameShape(hubX: number, hubY: number, headerWidth: number, content: Shape): Shape {
  const top = hubY - NEST_HEADER / 2
  const bottom = Math.max(content.y + content.hh, hubY + NEST_HEADER / 2)
  const hw = Math.max(headerWidth / 2, content.x + content.hw - hubX, hubX - (content.x - content.hw))
  return { x: hubX, y: (top + bottom) / 2, hw, hh: (bottom - top) / 2 }
}

function leafShape(box: Box, x: number, y: number): Shape {
  return { x, y, hw: box.width / 2, hh: box.height / 2 }
}

/**
 * 모양들을 감싸는 거품(여백 NEST_PAD 포함). 원으로 감싸면 내용이 길쭉할 때 빈자리가
 * 커서, 딱 맞는 둥근 사각형으로 감싼다. 배치와 거품 그리기가 이 함수 하나를 같이 쓴다.
 */
function enclose(shapes: Shape[]): Shape {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of shapes) {
    minX = Math.min(minX, s.x - s.hw)
    maxX = Math.max(maxX, s.x + s.hw)
    minY = Math.min(minY, s.y - s.hh)
    maxY = Math.max(maxY, s.y + s.hh)
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, hw: (maxX - minX) / 2 + NEST_PAD, hh: (maxY - minY) / 2 + NEST_PAD }
}

/** B 를 A 에서 떼어 놓을 벡터(겹치지 않으면 null). A 기준으로 B 가 움직일 방향이다. */
function overlap(A: Shape, B: Shape, fallbackSign: number): [number, number] | null {
  const dx = B.x - A.x
  const dy = B.y - A.y
  const ox = A.hw + B.hw + NEST_GAP - Math.abs(dx)
  const oy = A.hh + B.hh + NEST_GAP - Math.abs(dy)
  if (ox <= 0 || oy <= 0) return null
  // 짧은 축으로만 밀면 칸이 한 줄로 쌓인다. 두 가운데를 잇는 방향으로, 그 방향으로
  // 떨어지는 데 필요한 만큼만 민다(마인드맵처럼 둘레로 퍼진다).
  const d = Math.hypot(dx, dy)
  if (d < 1e-6) return [0, (oy + 0.01) * fallbackSign]
  const ux = dx / d
  const uy = dy / d
  const t = Math.min(
    Math.abs(ux) > 1e-6 ? ox / Math.abs(ux) : Infinity,
    Math.abs(uy) > 1e-6 ? oy / Math.abs(uy) : Infinity,
  )
  return [ux * t, uy * t]
}

type Item = Shape & { id: string; type: string }

/**
 * 한 거품 안의 배치. 가운데 칸(hub)은 제자리에 있고 안에 든 것들이 그 둘레에 선다.
 * 1) 큰 거품부터, 종류끼리 이어지게 줄 세워 가운데부터 고리 모양으로 두르고
 * 2) 관계선으로 이어진 것은 당기고, 같은 종류는 모으고, 가운데로 모으면서 겹치면 민다.
 * 무작위 없이 같은 입력이면 같은 자리다.
 */
function arrangeAround(items: Item[], hub: Shape | null, links: Array<[number, number, number]>): void {
  if (!items.length) return
  if (items.length === 1 && !hub) return
  // 1) 고리
  const hubR = hub ? Math.hypot(hub.hw, hub.hh) : 0
  const size = (item: Item) => (item.hw + item.hh) / 2
  let ring = hubR + NEST_GAP + size(items[0])
  let used = 0
  let ringMax = 0
  let ringIndex = 0
  for (const item of items) {
    const step = (2 * size(item) + NEST_GAP) / ring
    if (used > 0 && used + step > Math.PI * 2) {
      ring += ringMax + NEST_GAP + size(item)
      used = 0
      ringMax = 0
      ringIndex++
    }
    const theta = -Math.PI / 2 + ringIndex * 0.9 + used + step / 2
    item.x = Math.cos(theta) * ring
    item.y = Math.sin(theta) * ring
    used += step
    ringMax = Math.max(ringMax, size(item))
  }

  // 2) 풀기
  const byType = new Map<string, number[]>()
  items.forEach((item, index) => byType.set(item.type, [...(byType.get(item.type) ?? []), index]))
  for (let step = 0; step < RELAX_STEPS; step++) {
    const cool = 1 - step / RELAX_STEPS
    for (const [a, b, w] of links) {
      const A = items[a]
      const B = items[b]
      const dx = B.x - A.x
      const dy = B.y - A.y
      const d = Math.hypot(dx, dy) || 1
      const rest = size(A) + size(B) + NEST_GAP * 2
      if (d <= rest) continue
      const move = (d - rest) * 0.05 * w * cool
      A.x += dx / d * move
      A.y += dy / d * move
      B.x -= dx / d * move
      B.y -= dy / d * move
    }
    for (const members of byType.values()) {
      if (members.length < 2) continue
      let cx = 0
      let cy = 0
      for (const m of members) { cx += items[m].x; cy += items[m].y }
      cx /= members.length
      cy /= members.length
      for (const m of members) {
        items[m].x += (cx - items[m].x) * 0.03 * cool
        items[m].y += (cy - items[m].y) * 0.03 * cool
      }
    }
    // 가운데로 모은다. 겹침 풀기가 다시 밀어내므로 빈틈만 줄어든다.
    for (const item of items) {
      item.x -= item.x * 0.06 * cool
      item.y -= item.y * 0.06 * cool
    }
    separate(items, hub)
  }
  for (let pass = 0; pass < 120; pass++) if (!separate(items, hub)) break
}

/** 겹친 모양을 떼고 가운데 칸 밖으로 민다. 움직인 게 있으면 true. */
function separate(items: Item[], hub: Shape | null): boolean {
  let moved = false
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i]
      const B = items[j]
      const push = overlap(A, B, 1)
      if (!push) continue
      // 큰 쪽이 덜 움직인다
      const sa = A.hw * A.hh
      const sb = B.hw * B.hh
      const wa = sb / (sa + sb)
      const wb = sa / (sa + sb)
      A.x -= push[0] * wa
      A.y -= push[1] * wa
      B.x += push[0] * wb
      B.y += push[1] * wb
      moved = true
    }
  }
  if (hub) {
    for (const item of items) {
      const push = overlap(hub, item, 1)
      if (!push) continue
      item.x += push[0]
      item.y += push[1]
      moved = true
    }
  }
  return moved
}

/**
 * 포함 관계대로 칸을 마인드맵처럼 겹겹이 놓는다. 상위 객체 칸 둘레에 안에 든 칸과
 * 작은 거품이 서고, 그 전체를 거품이 감싼다. 같은 종류는 모이고, 관계선으로 이어진
 * 것끼리는 가까워진다(다른 거품 안의 칸과 이어져 있으면 그 거품 쪽으로).
 */
export function layoutNested(
  nodes: SemanticNode[], parentOf: ReadonlyMap<string, string>, box: Box, edges: SemanticEdge[] = [],
  boxes: ReadonlyMap<string, Box> = new Map(),
  links: ProviderLink[] = [],
): SemanticNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  // 칸 크기는 칸마다 다를 수 있다(이름 길이에 맞춘 L4 칸). 없으면 box.
  const boxOf = (id: string) => boxes.get(id) ?? box
  const parentIn = (id: string) => {
    const parent = parentOf.get(id)
    return parent !== undefined && byId.has(parent) ? parent : undefined
  }
  const children = new Map<string, SemanticNode[]>()
  const roots = new Map<string, SemanticNode[]>()
  for (const node of nodes) {
    const parent = parentIn(node.id)
    if (parent !== undefined) children.set(parent, [...(children.get(parent) ?? []), node])
    else roots.set(node.provider, [...(roots.get(node.provider) ?? []), node])
  }
  // 조상 사슬(바깥 → 자기)
  const chains = new Map<string, string[]>()
  for (const node of nodes) {
    const chain = [node.id]
    const seen = new Set([node.id])
    let current = parentIn(node.id)
    while (current !== undefined && !seen.has(current)) {
      chain.unshift(current)
      seen.add(current)
      current = parentIn(current)
    }
    chains.set(node.id, chain)
  }
  // 관계선의 두 끝을 공통 조상 바로 아래 형제로 올려, 같은 거품 안의 형제끼리 잇는다.
  const siblingLinks = new Map<string, Map<string, number>>()
  const degree = new Map<string, number>()
  for (const edge of edges) {
    const a = chains.get(edge.sourceSemanticNodeId)
    const b = chains.get(edge.targetSemanticNodeId)
    if (!a || !b) continue
    const provider = byId.get(a[0])!.provider
    if (provider !== byId.get(b[0])!.provider) continue
    let k = 0
    while (k < a.length && k < b.length && a[k] === b[k]) k++
    if (k >= a.length || k >= b.length) continue // 한쪽이 다른 쪽을 품고 있다 — 포함 자체
    const scope = k === 0 ? `root:${provider}` : a[k - 1]
    const key = a[k] < b[k] ? `${a[k]}|${b[k]}` : `${b[k]}|${a[k]}`
    const bucket = siblingLinks.get(scope) ?? new Map<string, number>()
    bucket.set(key, (bucket.get(key) ?? 0) + 1)
    siblingLinks.set(scope, bucket)
    degree.set(a[k], (degree.get(a[k]) ?? 0) + 1)
    degree.set(b[k], (degree.get(b[k]) ?? 0) + 1)
  }

  // 거품: 반폭·반높이와, 거품 가운데에서 본 가운데 칸 자리
  const bubble = new Map<string, { hw: number; hh: number; hubX: number; hubY: number }>()
  const offset = new Map<string, { x: number; y: number }>() // 부모 가운데 칸 기준, 칸이면 칸 자리·거품이면 거품 가운데

  const arrange = (scope: string, inside: SemanticNode[], hub: Shape | null): Item[] => {
    const sizeOf = (node: SemanticNode) => {
      const b = bubble.get(node.id)
      if (b) return b.hw * b.hh
      const own = boxOf(node.id)
      return own.width * own.height / 4
    }
    const ordered = [...inside].sort((a, b) =>
      sizeOf(b) - sizeOf(a) ||
      (a.objectType ?? '').localeCompare(b.objectType ?? '') ||
      (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
      b.findingCount - a.findingCount ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id))
    const items: Item[] = ordered.map(node => {
      const b = bubble.get(node.id)
      const shape = b ? { x: 0, y: 0, hw: b.hw, hh: b.hh } : leafShape(boxOf(node.id), 0, 0)
      return { ...shape, id: node.id, type: node.objectType ?? '' }
    })
    const index = new Map(items.map((item, i) => [item.id, i]))
    const links: Array<[number, number, number]> = []
    for (const [key, w] of siblingLinks.get(scope) ?? []) {
      const [a, b] = key.split('|')
      const ia = index.get(a)
      const ib = index.get(b)
      if (ia !== undefined && ib !== undefined) links.push([ia, ib, Math.min(3, 1 + Math.log1p(w))])
    }
    arrangeAround(items, hub, links)
    return items
  }

  // 안쪽 거품부터 크기를 정한다.
  const measure = (node: SemanticNode): void => {
    const inside = children.get(node.id)
    if (!inside?.length) return
    for (const child of inside) measure(child)
    // 안에 든 것들을 먼저 모으고, 그 위에 제목 줄(상위 객체 자리)을 얹는다.
    const items = arrange(node.id, inside, null)
    const content = enclose(items)
    const hubX = content.x
    const hubY = content.y - content.hh - NEST_HEADER / 2
    for (const item of items) offset.set(item.id, { x: item.x - hubX, y: item.y - hubY })
    const e = frameShape(hubX, hubY, nestHeaderWidth(node.label, node.findingCount), content)
    bubble.set(node.id, { hw: e.hw, hh: e.hh, hubX: hubX - e.x, hubY: hubY - e.y })
  }

  const positions = new Map<string, { x: number; y: number }>()
  // (x, y) = 이 칸의 자리(거품이면 가운데 칸 자리)
  const place = (node: SemanticNode, x: number, y: number) => {
    positions.set(node.id, { x, y })
    for (const child of children.get(node.id) ?? []) {
      const o = offset.get(child.id)!
      const b = bubble.get(child.id)
      // 거품은 거품 가운데가 o 에 있다. 가운데 칸은 그로부터 hubX/Y 만큼 떨어져 있다.
      place(child, x + o.x + (b?.hubX ?? 0), y + o.y + (b?.hubY ?? 0))
    }
  }

  // SaaS 묶음: 뿌리들을 가운데 칸 없는 거품으로 두르고, 머리글과 여백은 화면의
  // 묶음 테두리(clusterFrames)와 같은 값을 둔다.
  const providerBlocks = [...roots.entries()].map(([provider, rootNodes]) => {
    for (const node of rootNodes) measure(node)
    const items = arrange(`root:${provider}`, rootNodes, null)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const item of items) {
      minX = Math.min(minX, item.x - item.hw)
      maxX = Math.max(maxX, item.x + item.hw)
      minY = Math.min(minY, item.y - item.hh)
      maxY = Math.max(maxY, item.y + item.hh)
    }
    const byItem = new Map(items.map(item => [item.id, item]))
    return {
      provider,
      width: Math.max(maxX - minX, PROVIDER_MIN_CONTENT) + CLUSTER_PAD * 2,
      height: CLUSTER_HEADER + (maxY - minY) + CLUSTER_PAD,
      place: (x: number, y: number) => {
        for (const node of rootNodes) {
          const item = byItem.get(node.id)!
          const b = bubble.get(node.id)
          place(node, x + CLUSTER_PAD - minX + item.x + (b?.hubX ?? 0), y + CLUSTER_HEADER - minY + item.y + (b?.hubY ?? 0))
        }
      },
    }
  })

  const byProvider = new Map(providerBlocks.map(block => [block.provider, block]))
  // SaaS, 조직, 그룹 단계와 같은 자리 계획(circleLevels.providerPlan): 다른 SaaS와 이어진 SaaS는 가운데,
  // 연결 없는 SaaS는 오른쪽 한 줄. 멀리서 본 SaaS 이름표(UnifiedFullGraph visibleClusterLabels: 묶음 왼쪽 위,
  // 폭은 그림과 이름, 개수)가 위나 옆 묶음과 겹치지 않게, 화면 맞춤 배율을 어림해 그 배율에서 이름표가 차지할
  // 자리(위로 머리글 + 틈이 화면 LABEL_STRIP_PX, 오른쪽으로 이름표 폭)와 묶음 사이 틈(화면 24px)을 비운다.
  // 자리가 커지면 배율이 다시 줄어 몇 번 되풀이해 맞춘다.
  const plan = providerPlan(byProvider.keys(), links.filter(([a, b]) => byProvider.has(a) && byProvider.has(b)))
  if (!plan.grid) {
    const counts = new Map<string, number>()
    for (const node of nodes) counts.set(node.provider, (counts.get(node.provider) ?? 0) + 1)
    const labelPx = (provider: string) => 6 + 46 + measureLabel(providerName(provider), 12) * 1.08 + measureLabel(String(counts.get(provider) ?? 0), 12) + 8
    let zoom = 0
    let centers = new Map<string, { x: number; y: number }>()
    for (let i = 0; i < 12; i++) {
      const strip = zoom ? Math.max(0, LABEL_STRIP_PX / zoom - CLUSTER_HEADER) : 0
      const reach = new Map<string, Reach>(providerBlocks.map(block => [block.provider, {
        l: block.width / 2,
        r: Math.max(block.width / 2, zoom ? labelPx(block.provider) / zoom - block.width / 2 : 0),
        t: block.height / 2 + strip,
        b: block.height / 2,
      }]))
      centers = placeProviders(plan, reach, Math.max(PROVIDER_GAP, zoom ? 24 / zoom : 0))
      const xs = providerBlocks.flatMap(block => [centers.get(block.provider)!.x - reach.get(block.provider)!.l, centers.get(block.provider)!.x + reach.get(block.provider)!.r])
      const ys = providerBlocks.flatMap(block => [centers.get(block.provider)!.y - reach.get(block.provider)!.t, centers.get(block.provider)!.y + reach.get(block.provider)!.b])
      const next = Math.min(MIN_FIT_CANVAS.width / Math.max(Math.max(...xs) - Math.min(...xs), 1), MIN_FIT_CANVAS.height / Math.max(Math.max(...ys) - Math.min(...ys), 1))
      if (zoom && Math.abs(next - zoom) / zoom < 0.02) break
      zoom = next
    }
    for (const block of providerBlocks) {
      const c = centers.get(block.provider)!
      block.place(c.x - block.width / 2, c.y - block.height / 2)
    }
    return nodes.map(node => ({ ...node, ...(positions.get(node.id) ?? { x: node.x, y: node.y }) }))
  }
  // 이어진 SaaS가 없으면 두 줄 격자. 큰 묶음 때문에 다른 SaaS가 자리를 바꾸지 않는다.
  // 격자에 없는 SaaS(Atlassian 등)는 아래에 두 개씩 줄을 더한다(providerRows). 전에는 자리를 받지 못해
  // 그 SaaS 칸이 모두 한 점에 겹쳤다.
  const grid = providerRows(byProvider.keys()).map(row => row.map(provider => byProvider.get(provider)))
  const columnWidths = [0, 1].map(column => Math.max(0, ...grid.map(row => row[column]?.width ?? 0)))
  const rowHeights = grid.map(row => Math.max(0, ...row.map(block => block?.height ?? 0)))
  // 위아래 줄 사이 틈은 멀리서 볼 때 아랫줄 SaaS 이름표가 들어갈 만큼(labelSafeRowGap).
  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0) + PROVIDER_GAP
  const rowGap = labelSafeRowGap(PROVIDER_GAP, totalWidth, rowHeights.reduce((a, b) => a + b, 0),
    rowHeights.filter(height => height > 0).length - 1)
  let cursorY = 0
  grid.forEach((line, lineIndex) => {
    let cursorX = 0
    line.forEach((block, column) => {
      block?.place(cursorX + (columnWidths[column] - block.width) / 2, cursorY + (rowHeights[lineIndex] - block.height) / 2)
      cursorX += columnWidths[column] + PROVIDER_GAP
    })
    if (rowHeights[lineIndex]) cursorY += rowHeights[lineIndex] + rowGap
  })

  return nodes.map(node => ({ ...node, ...(positions.get(node.id) ?? { x: node.x, y: node.y }) }))
}

export interface ContainerFrame {
  id: string
  provider: SemanticNode['provider']
  label: string
  objectType?: string
  depth: number
  descendantCount: number
  /** 바로 안에 소속(member_of)으로 들어온 칸 수 */
  memberCount: number
  /** 상위 객체 자리 = 제목 줄 가운데. 제목 줄은 테두리 맨 위, 높이 NEST_HEADER, 폭은 테두리 폭. */
  hubX: number
  hubY: number
  /** 테두리 */
  x: number
  y: number
  width: number
  height: number
}

/**
 * 놓인 칸에서 포함 테두리를 잰다. 배치(layoutNested)와 같은 감싸기(enclose · frameShape)를 쓰므로
 * 테두리는 맨 위 제목 줄과 안에 든 칸을 딱 맞게 감싼다. 바깥부터 정렬해 돌려준다.
 */
export function containerFrames(
  nodes: SemanticNode[], parentOf: ReadonlyMap<string, string>, box: Box,
  memberChildren: ReadonlySet<string> = new Set(), boxes: ReadonlyMap<string, Box> = new Map(),
): ContainerFrame[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const boxOf = (id: string) => boxes.get(id) ?? box
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    const parent = parentOf.get(node.id)
    if (parent !== undefined && byId.has(parent)) children.set(parent, [...(children.get(parent) ?? []), node.id])
  }
  const frames = new Map<string, ContainerFrame>()
  const depthOf = (id: string): number => {
    let depth = 0
    let current = parentOf.get(id)
    const seen = new Set([id])
    while (current !== undefined && byId.has(current) && !seen.has(current)) {
      seen.add(current)
      depth++
      current = parentOf.get(current)
    }
    return depth
  }
  const measure = (id: string): { shape: Shape; count: number } => {
    const node = byId.get(id)!
    const inside = children.get(id)
    if (!inside?.length) return { shape: leafShape(boxOf(id), node.x, node.y), count: 0 }
    const shapes: Shape[] = []
    let count = 0
    for (const child of inside) {
      const sub = measure(child)
      shapes.push(sub.shape)
      count += 1 + sub.count
    }
    const e = frameShape(node.x, node.y, nestHeaderWidth(node.label, node.findingCount), enclose(shapes))
    frames.set(id, {
      id,
      provider: node.provider,
      label: node.label,
      objectType: node.objectType,
      depth: depthOf(id),
      descendantCount: count,
      memberCount: inside.filter(child => memberChildren.has(child)).length,
      hubX: node.x,
      hubY: node.y,
      x: e.x - e.hw,
      y: e.y - e.hh,
      width: e.hw * 2,
      height: e.hh * 2,
    })
    return { shape: e, count }
  }
  for (const node of nodes) if (!parentOf.has(node.id) || !byId.has(parentOf.get(node.id)!)) measure(node.id)
  return [...frames.values()].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id))
}
