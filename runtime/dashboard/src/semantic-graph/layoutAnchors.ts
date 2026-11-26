import type { FixtureObject, Provider } from '../model/object'
import type { GraphStore } from '../model/graph'
import type { SemanticHierarchy } from './types'
import { SEMANTIC_NODE_BOX, SEMANTIC_NODE_GAP } from './viewport'
import { objectChipWidth, objectDisplayName, objectShortNames } from './objectChip'

export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; width: number; height: number }

export interface ProviderZone extends Rect {
  provider: Provider
  label: string
  fill: string
  stroke: string
  labelColor: string
}

export const WORLD_SIZE = { width: 2400, height: 1800 }

/**
 * 좌표표에서 테넌트 자리를 가리키는 키.
 *
 * 테넌트 id는 그 테넌트를 나타내는 객체의 fixture_key를 그대로 쓴다.
 * 그런데 L4에서 모든 객체가 자기 fixture_key로 좌표를 적기 때문에,
 * 한 표에 같이 담으면 나중에 도는 L4가 L2 자리를 덮어썼다. 실제로
 * 테넌트 8칸 중 4칸이 L4 격자 좌표에 놓여 서로 겹쳐 있었다.
 */
export const tenantAnchorKey = (tenantId: string): string => `tenant:${tenantId}`

export const PROVIDER_ZONES: Record<'okta' | 'github' | 'gws' | 'slack', ProviderZone> = {
  okta: {
    provider: 'okta',
    label: 'Okta',
    x: 70,
    y: 70,
    width: 1060,
    height: 760,
    fill: '#dbeafe',
    stroke: '#2563eb',
    labelColor: '#1746a2',
  },
  github: {
    provider: 'github',
    label: 'GitHub',
    x: 1270,
    y: 70,
    width: 1060,
    height: 760,
    fill: '#e5e7eb',
    stroke: '#111827',
    labelColor: '#111827',
  },
  gws: {
    provider: 'gws',
    label: 'Google Workspace',
    x: 70,
    y: 970,
    width: 1060,
    height: 760,
    fill: '#dcfce7',
    stroke: '#16a34a',
    labelColor: '#166534',
  },
  slack: {
    provider: 'slack',
    label: 'Slack',
    x: 1270,
    y: 970,
    width: 1060,
    height: 760,
    fill: '#fce7f3',
    stroke: '#db2777',
    labelColor: '#9d174d',
  },
}

export const PROVIDER_QUADRANT_CENTERS: Record<string, Point> = Object.fromEntries(
  Object.entries(PROVIDER_ZONES).map(([provider, zone]) => [
    provider,
    { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 },
  ])
)

/* =========================================================================
   상세 단계(L3 · L4)의 SaaS 묶음

   L1·L2는 사분면 네 개가 고정 크기(1060x760)라도 칸이 여덟 개뿐이라
   들어간다. L3부터는 칸 수가 SaaS마다 크게 달라 고정 사분면이 맞지
   않는다. GitHub은 보안 범위가 25개인데 사분면이 내주는 폭은 한 칸에
   194px, 칸 자체는 228px이라 가로로 34px씩 겹쳤다.

   그래서 상세 단계에서는 칸 크기에서 묶음 크기를 거꾸로 잡는다. 겹침은
   격자 한 칸이 노드보다 작아질 수 없다는 사실에서 사라진다.
   ========================================================================= */

export type ProviderKey = Provider

/** 모든 표시 수준이 공유하는 SaaS 자리. 항목 수와 묶음 크기로 순서를 바꾸지 않는다. */
export const PROVIDER_GRID: readonly (readonly ProviderKey[])[] = [
  ['okta', 'github'],
  ['gws', 'slack'],
]

/**
 * 데이터에 있는 SaaS의 자리 줄. 앞 네 SaaS는 늘 같은 2x2 자리(없으면 빈자리)이고,
 * 그 밖의 SaaS(Atlassian 등)는 이름순으로 아래에 두 개씩 줄을 더한다.
 * 전에는 네 SaaS만 자리가 있어 새로 들어온 SaaS가 SaaS 요약에서 빠지고 상세 단계에서는 한 점에 겹쳤다.
 */
export function providerRows(present: Iterable<string>): ProviderKey[][] {
  const known = new Set<string>(PROVIDER_GRID.flat())
  const extra = [...new Set(present)].filter(provider => !known.has(provider)).sort() as ProviderKey[]
  const rows = PROVIDER_GRID.map(row => [...row])
  for (let i = 0; i < extra.length; i += 2) rows.push(extra.slice(i, i + 2))
  return rows
}

/** 데이터에 있는 SaaS를 자리 순서(왼쪽 위부터)로 */
export function orderedProviders(present: Iterable<string>): ProviderKey[] {
  const set = new Set(present)
  return providerRows(set).flat().filter(provider => set.has(provider))
}

/** SaaS 요약(L1) 자리 칸: 줄과 열. 줄에 혼자인 더한 SaaS는 두 열 가운데(0.5)에 둔다. */
export function providerSlot(provider: string, present: Iterable<string>): { row: number; column: number } {
  const rows = providerRows(present)
  for (let row = 0; row < rows.length; row++) {
    const column = rows[row].indexOf(provider as ProviderKey)
    if (column < 0) continue
    return { row, column: row >= PROVIDER_GRID.length && rows[row].length === 1 ? 0.5 : column }
  }
  return { row: rows.length, column: 0.5 }
}

/** SaaS 요약(L1) 칸 가운데. 네 SaaS는 예전 자리((820, 580) 기준 가로 760, 세로 640 간격) 그대로다. */
export function ecosystemAnchor(provider: string, present: Iterable<string>): Point {
  const { row, column } = providerSlot(provider, present)
  return { x: 820 + column * 760, y: 580 + row * 640 }
}

/** 조직(L2) 칸을 펼치는 SaaS 구역. 네 SaaS는 PROVIDER_ZONES 자리 그대로다. */
export function providerZoneRect(provider: string, present: Iterable<string>): Rect {
  const { row, column } = providerSlot(provider, present)
  return { x: 70 + column * 1200, y: 70 + row * 900, width: 1060, height: 760 }
}

/** 왼쪽 줄 · 오른쪽 줄. L1 자리를 그대로 물려받아, 단계를 오가도 같은 SaaS가 화면의 같은 쪽에 남는다. */
const clusterColumns = (present: Iterable<string>): ProviderKey[][] => {
  const rows = providerRows(present)
  return [0, 1].map(column => rows.map(row => row[column]).filter((provider): provider is ProviderKey => provider !== undefined))
}

/** 묶음 테두리와 칸 사이 */
export const CLUSTER_PAD = 24
/** 묶음 머리글(로고 · 이름 · 개수) 줄 높이 */
export const CLUSTER_HEADER = 58
/** 묶음과 묶음 사이 */
export const CLUSTER_GUTTER = 66

/* 멀리서 볼 때(배율 0.42 아래) SaaS 이름표(「Okta 37」, 화면 24px + 위아래 여백)는
   묶음 테두리 윗부분에 앉는다. 윗부분은 머리글 자리(CLUSTER_HEADER)에 바로 위 묶음과의
   틈을 더한 만큼까지만 늘릴 수 있다(UnifiedFullGraph clusterLabelStrips).
   틈을 월드 값으로 고정해 두면, 항목이 늘어 화면 맞춤 배율이 작아질수록 틈이 화면에서
   좁아져 이름표가 아랫줄 묶음의 맨 윗줄 칸을 덮는다. 그래서 위아래 묶음 사이 틈을
   그래프 크기에 비례해 잡는다: 화면 맞춤 배율 z에서 틈 + 머리글이 화면 48px 이상
   (이름표 36px + 여백 6px + 화면 맞춤 어림의 오차 6px).
   캔버스는 이보다 작지 않다고 본다(1280×720 창에서 Findings 패널을 연 크기). */
export const LABEL_STRIP_PX = 48
export const MIN_FIT_CANVAS = { width: 660, height: 480 }

/**
 * 위아래 묶음 사이 틈(월드). 가로 전체 폭과, 틈을 뺀 세로 높이, 한 열에 쌓이는 틈의
 * 개수에서 화면 맞춤 배율을 어림하고, 그 배율에서 이름표 자리가 남는 틈을 찾는다.
 * 틈이 커지면 전체 높이가 커져 배율이 다시 줄므로 몇 번 되풀이해 맞춘다.
 */
export function labelSafeRowGap(minGap: number, totalWidth: number, contentHeight: number, gapsInColumn: number): number {
  if (gapsInColumn <= 0) return minGap
  let gap = minGap
  for (let i = 0; i < 12; i++) {
    const totalHeight = contentHeight + gap * gapsInColumn
    const zoom = Math.min(MIN_FIT_CANVAS.width / Math.max(totalWidth, 1), MIN_FIT_CANVAS.height / Math.max(totalHeight, 1))
    gap = Math.max(minGap, LABEL_STRIP_PX / zoom - CLUSTER_HEADER)
  }
  return Math.ceil(gap)
}

/* 묶음 하나의 목표 가로세로비. 네 묶음을 2x2로 놓으므로 전체 월드도
   대체로 이 비율이 된다. 그래프 화면이 대략 1.25:1이라 같은 값을 쓴다. */
const CLUSTER_TARGET_ASPECT = 1.25

export interface ClusterGrid {
  columns: number
  /** 열마다 폭(칸 + 틈). 없으면 모든 열이 box.width + gap.x 다. */
  cellWidths?: number[]
  /** 칸이 놓이는 안쪽 영역. 머리글은 여기 포함되지 않는다. */
  body: Rect
}

/** 칸 수를 목표 비율에 가장 가깝게 나누는 열 수 */
function packColumns(count: number, cellWidth: number, cellHeight: number): number {
  let best = 1
  let bestScore = Number.POSITIVE_INFINITY
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns)
    const ratio = (columns * cellWidth) / (rows * cellHeight)
    const score = Math.abs(Math.log(ratio / CLUSTER_TARGET_ASPECT))
    if (score < bestScore - 1e-9) {
      bestScore = score
      best = columns
    }
  }
  return best
}

/**
 * SaaS별 칸 수에서 묶음 네 개의 자리를 잡는다.
 *
 * 한 칸은 언제나 `box + gap` 이상을 받으므로 격자 안에서 칸이 겹칠 수
 * 없다. itemWidths(놓일 순서대로 칸 폭)를 주면 열마다 그 열에서 가장 넓은 칸만큼
 * 폭을 준다(이름 길이에 맞춘 L4 칸). 묶음끼리 옆으로는 CLUSTER_GUTTER만큼, 위아래로는 멀리서 볼 때 SaaS 이름표가
 * 들어갈 만큼(labelSafeRowGap) 떨어뜨린다.
 */
export function computeProviderClusters(
  countsByProvider: Map<string, number>,
  box: { width: number; height: number },
  gap: { x: number; y: number },
  itemWidths?: ReadonlyMap<string, readonly number[]>
): Map<string, ClusterGrid> {
  const cellWidth = box.width + gap.x
  const cellHeight = box.height + gap.y

  const CLUSTER_COLUMNS = clusterColumns(countsByProvider.keys())
  const draft = new Map<string, { columns: number; width: number; height: number; cellWidths?: number[] }>()
  for (const provider of CLUSTER_COLUMNS.flat()) {
    const count = Math.max(countsByProvider.get(provider) ?? 0, 1)
    const widths = itemWidths?.get(provider)
    if (widths?.length) {
      const average = widths.reduce((sum, width) => sum + width, 0) / widths.length + gap.x
      const columns = packColumns(count, average, cellHeight)
      const cellWidths = Array.from({ length: columns }, () => 0)
      widths.forEach((width, index) => {
        cellWidths[index % columns] = Math.max(cellWidths[index % columns], width + gap.x)
      })
      const rows = Math.ceil(count / columns)
      draft.set(provider, { columns, width: cellWidths.reduce((sum, width) => sum + width, 0), height: rows * cellHeight, cellWidths })
      continue
    }
    const columns = packColumns(count, cellWidth, cellHeight)
    const rows = Math.ceil(count / columns)
    draft.set(provider, { columns, width: columns * cellWidth, height: rows * cellHeight })
  }

  const columnWidths = CLUSTER_COLUMNS.map(members =>
    Math.max(cellWidth, ...members.map(provider => draft.get(provider)?.width ?? 0)) + CLUSTER_PAD * 2
  )

  const columnX: number[] = []
  let cursorX = 0
  for (const width of columnWidths) {
    columnX.push(cursorX)
    cursorX += width + CLUSTER_GUTTER
  }
  const totalWidth = cursorX - CLUSTER_GUTTER

  const columnContentHeights = CLUSTER_COLUMNS.map(members => members.reduce((sum, provider) => {
    const grid = draft.get(provider)
    return grid ? sum + CLUSTER_HEADER + grid.height + CLUSTER_PAD : sum
  }, 0))
  const rowGap = labelSafeRowGap(CLUSTER_GUTTER, totalWidth, Math.max(...columnContentHeights),
    Math.max(...CLUSTER_COLUMNS.map(members => members.filter(provider => draft.has(provider)).length)) - 1)

  const result = new Map<string, ClusterGrid>()
  let totalHeight = 0
  CLUSTER_COLUMNS.forEach((members, columnIndex) => {
    let cursorY = 0
    for (const provider of members) {
      const grid = draft.get(provider)
      if (!grid) continue
      const width = columnWidths[columnIndex]
      result.set(provider, {
        columns: grid.columns,
        cellWidths: grid.cellWidths,
        body: {
          x: columnX[columnIndex] + (width - grid.width) / 2,
          y: cursorY + CLUSTER_HEADER,
          width: grid.width,
          height: grid.height,
        },
      })
      cursorY += CLUSTER_HEADER + grid.height + CLUSTER_PAD + rowGap
    }
    totalHeight = Math.max(totalHeight, cursorY - rowGap)
  })

  // L1·L2와 같은 월드 한가운데에 둔다. 단계를 바꿀 때 칸이 제자리에서
  // 갈라지고 모이도록 보이게 하는 값이다.
  const offsetX = WORLD_SIZE.width / 2 - totalWidth / 2
  const offsetY = WORLD_SIZE.height / 2 - totalHeight / 2
  for (const grid of result.values()) {
    grid.body.x += offsetX
    grid.body.y += offsetY
  }

  return result
}

/** 묶음 안 index번째 칸의 한가운데 */
function clusterCellCenter(
  cluster: ClusterGrid,
  index: number,
  box: { width: number; height: number },
  gap: { x: number; y: number }
): Point {
  const cellWidth = box.width + gap.x
  const cellHeight = box.height + gap.y
  const column = index % cluster.columns
  const row = Math.floor(index / cluster.columns)
  let x = cluster.body.x + (column + 0.5) * cellWidth
  if (cluster.cellWidths) {
    x = cluster.body.x + cluster.cellWidths[column] / 2
    for (let c = 0; c < column; c++) x += cluster.cellWidths[c]
  }
  return {
    x: Math.round(x),
    y: Math.round(cluster.body.y + (row + 0.5) * cellHeight),
  }
}
function gridRect(zone: Rect, count: number, index: number, maxColumns: number, topInset = 72): Rect {
  const paddingX = 44
  const paddingBottom = 36
  const availableWidth = zone.width - paddingX * 2
  const availableHeight = zone.height - topInset - paddingBottom
  const columns = Math.max(1, Math.min(maxColumns, Math.ceil(Math.sqrt(count))))
  const rows = Math.max(1, Math.ceil(count / columns))
  const col = index % columns
  const row = Math.floor(index / columns)
  const width = availableWidth / columns
  const height = availableHeight / rows
  return {
    x: zone.x + paddingX + col * width,
    y: zone.y + topInset + row * height,
    width,
    height,
  }
}

function centerOf(rect: Rect): Point {
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
}

function groupHierarchyBy(
  graph: GraphStore,
  hierarchyMap: Map<string, SemanticHierarchy>,
  selector: (h: SemanticHierarchy) => string
): Map<string, FixtureObject[]> {
  const groups = new Map<string, FixtureObject[]>()
  for (const obj of graph.objectsByKey.values()) {
    const h = hierarchyMap.get(obj.fixture_key)
    if (!h) continue
    const id = selector(h)
    const list = groups.get(id) ?? []
    list.push(obj)
    groups.set(id, list)
  }
  return groups
}

/**
 * Computes stable anchors for all four semantic levels.
 * L3 is provider-native Security Scope; L4 objects are laid out inside their
 * primary scope cell so zoom transitions preserve spatial lineage.
 */
export function computeSemanticAnchors(
  graph: GraphStore,
  hierarchyMap: Map<string, SemanticHierarchy>
): Map<string, Point> {
  const anchors = new Map<string, Point>()

  // L1: 데이터에 있는 SaaS마다 자리 가운데
  const present = new Set([...graph.objectsByKey.values()].map(obj => obj.canonical.provider))
  for (const provider of present) anchors.set(provider, ecosystemAnchor(provider, present))

  // L2: tenants are arranged inside their provider zone.
  const tenantGroups = groupHierarchyBy(graph, hierarchyMap, h => h.tenantNodeId)
  const tenantsByProvider = new Map<string, string[]>()
  for (const [tenantId, members] of tenantGroups.entries()) {
    const provider = members[0]?.canonical.provider
    if (!provider) continue
    const list = tenantsByProvider.get(provider) ?? []
    list.push(tenantId)
    tenantsByProvider.set(provider, list)
  }

  const tenantRects = new Map<string, Rect>()
  for (const [provider, tenantIds] of tenantsByProvider.entries()) {
    const zone = providerZoneRect(provider, tenantsByProvider.keys())
    tenantIds.sort()
    tenantIds.forEach((tenantId, index) => {
      const rect = gridRect(zone, tenantIds.length, index, 3, 98)
      tenantRects.set(tenantId, rect)
      anchors.set(tenantAnchorKey(tenantId), centerOf(rect))
    })
  }

  // L3: 보안 범위. 묶음을 칸 수에 맞춰 잡는다. 정렬 기준(테넌트 → 종류
  // → 이름)은 그대로 두어 어느 칸이 어디 있었는지가 바뀌지 않는다.
  const scopeGroups = groupHierarchyBy(graph, hierarchyMap, h => h.scopeNodeId)
  const scopesByProvider = new Map<string, string[]>()
  for (const [scopeId, members] of scopeGroups.entries()) {
    const h = hierarchyMap.get(members[0]?.fixture_key ?? '')
    if (!h) continue
    const list = scopesByProvider.get(h.provider) ?? []
    list.push(scopeId)
    scopesByProvider.set(h.provider, list)
  }

  const scopeBox = SEMANTIC_NODE_BOX.scope
  const scopeGap = SEMANTIC_NODE_GAP.scope
  const scopeClusters = computeProviderClusters(
    new Map([...scopesByProvider].map(([provider, ids]) => [provider, ids.length])),
    scopeBox,
    scopeGap
  )

  for (const [provider, scopeIds] of scopesByProvider.entries()) {
    const cluster = scopeClusters.get(provider)
    if (!cluster) continue
    scopeIds.sort((a, b) => {
      const ha = hierarchyMap.get(scopeGroups.get(a)?.[0]?.fixture_key ?? '')
      const hb = hierarchyMap.get(scopeGroups.get(b)?.[0]?.fixture_key ?? '')
      const tenantCmp = (ha?.tenantKey ?? '').localeCompare(hb?.tenantKey ?? '')
      if (tenantCmp !== 0) return tenantCmp
      const kindCmp = (ha?.scopeKind ?? '').localeCompare(hb?.scopeKind ?? '')
      if (kindCmp !== 0) return kindCmp
      return (ha?.scopeLabel ?? a).localeCompare(hb?.scopeLabel ?? b)
    })

    scopeIds.forEach((scopeId, index) => {
      anchors.set(scopeId, clusterCellCenter(cluster, index, scopeBox, scopeGap))
    })
  }

  // L4: 개별 객체. 정렬은 테넌트 → 보안 범위 → 범위를 대표하는 객체
  // 순으로, 한 단계 위에서 같이 있던 것끼리 계속 붙어 있게 한다.
  const objectsByProvider = new Map<string, FixtureObject[]>()
  for (const object of graph.objectsByKey.values()) {
    const list = objectsByProvider.get(object.canonical.provider) ?? []
    list.push(object)
    objectsByProvider.set(object.canonical.provider, list)
  }

  const objectBox = SEMANTIC_NODE_BOX.object
  const objectGap = SEMANTIC_NODE_GAP.object
  const orderedByProvider = new Map([...objectsByProvider].map(([provider, members]) => [provider, [...members].sort((a, b) => {
      const ha = hierarchyMap.get(a.fixture_key)
      const hb = hierarchyMap.get(b.fixture_key)
      const tenantCmp = (ha?.tenantKey ?? '').localeCompare(hb?.tenantKey ?? '')
      if (tenantCmp !== 0) return tenantCmp
      const scopeCmp = (ha?.scopeNodeId ?? '').localeCompare(hb?.scopeNodeId ?? '')
      if (scopeCmp !== 0) return scopeCmp
      const anchorA = ha?.scopeAnchorObjectKey === a.fixture_key ? 0 : 1
      const anchorB = hb?.scopeAnchorObjectKey === b.fixture_key ? 0 : 1
      if (anchorA !== anchorB) return anchorA - anchorB
      if (a.canonical.object_type !== b.canonical.object_type) {
        return a.canonical.object_type.localeCompare(b.canonical.object_type)
      }
      return a.fixture_key.localeCompare(b.fixture_key)
  })]))
  // 칸 폭은 그룹형과 같이 짧은 이름에 맞춘다. Finding 수는 여기서 모르므로 늘 그 자리를 둔다.
  const shortNames = objectShortNames([...graph.objectsByKey.values()].map(obj => ({
    id: obj.fixture_key, label: objectDisplayName(obj), provider: obj.canonical.provider.toLowerCase() as Provider,
  })))
  const objectClusters = computeProviderClusters(
    new Map([...orderedByProvider].map(([provider, members]) => [provider, members.length])),
    objectBox,
    objectGap,
    new Map([...orderedByProvider].map(([provider, members]) => [provider,
      members.map(obj => objectChipWidth(shortNames.get(obj.fixture_key) ?? objectDisplayName(obj), 1))])),
  )

  for (const [provider, ordered] of orderedByProvider.entries()) {
    const cluster = objectClusters.get(provider)
    if (!cluster) continue
    ordered.forEach((obj, index) => {
      anchors.set(obj.fixture_key, clusterCellCenter(cluster, index, objectBox, objectGap))
    })
  }

  return anchors
}
