/**
 * Event Board 타임라인 레이아웃 계산.
 * SaaS 레인별 순서, 겹침 방지 행 배치, 반복 이벤트 묶기, 줌 밀도 계산.
 */
import type { TimelineEvent } from '../timeline/timelineAnalysis'
import type { Axis } from './timeAxis'

export interface EventGroup {
  key: string
  events: TimelineEvent[]
  provider: string
  t: number
  tEnd: number
  title: string
  count: number
}

export interface Placed {
  key: string
  x: number
  y: number
  w: number
  h: number
  laneProvider: string
  row: number
}

export interface Lane {
  provider: string
  y: number
  height: number
  rows: number
}

export type LayoutDensity = 'card' | 'mini'

export interface BoardLayout {
  lanes: Lane[]
  placed: Placed[]
  density: LayoutDensity
  width: number
  height: number
}

export interface GroupRepeatsResult {
  groups: EventGroup[]
  untimed: TimelineEvent[]
}

/** 같은 행위자, 같은 종류, 같은 결과의 반복 이벤트를 묶는다 */
export function groupRepeats(
  events: TimelineEvent[],
  windowMs = 10 * 60_000,
): GroupRepeatsResult {
  const timed: Array<{ e: TimelineEvent; t: number }> = []
  const untimed: TimelineEvent[] = []

  for (const e of events) {
    if (!e.occurred_at) {
      untimed.push(e)
      continue
    }
    const t = Date.parse(e.occurred_at)
    if (Number.isNaN(t)) {
      untimed.push(e)
    } else {
      timed.push({ e, t })
    }
  }

  timed.sort((a, b) => a.t - b.t || a.e.origin_key.localeCompare(b.e.origin_key))

  const groups: EventGroup[] = []
  const openGroups = new Map<string, EventGroup>()

  for (const { e, t } of timed) {
    const actorKey = e.actor?.object_key || e.actor?.native_id || ''
    const matchKey = `${e.provider}|${actorKey}|${e.event_type}|${e.outcome}`

    const cur = openGroups.get(matchKey)
    if (cur && t - cur.tEnd <= windowMs) {
      cur.events.push(e)
      cur.tEnd = t
      cur.count = cur.events.length
    } else {
      const group: EventGroup = {
        key: `group:${e.origin_key}`,
        events: [e],
        provider: e.provider,
        t,
        tEnd: t,
        title: e.title || e.event_type,
        count: 1,
      }
      openGroups.set(matchKey, group)
      groups.push(group)
    }
  }

  return { groups, untimed }
}

/** 보드 전체의 SaaS 레인 및 카드 배치 계산 */
export function layoutBoard(
  groups: EventGroup[],
  axis: Axis,
  opts?: { cardWidth?: number; minLaneHeight?: number },
): BoardLayout {
  const count = groups.length
  let density: LayoutDensity = 'card'
  let w = opts?.cardWidth ?? 160
  let h = 44

  // 많아도 점으로 줄이지 않는다. 작은 카드로 바꾸고, 겹치는 만큼 SaaS 줄 칸을 늘린다
  if (count <= 60) {
    density = 'card'
    w = opts?.cardWidth ?? 160
    h = 44
  } else {
    density = 'mini'
    w = opts?.cardWidth ?? 100
    h = 22
  }

  // provider별 그룹 묶기
  const groupsByProvider = new Map<string, EventGroup[]>()
  for (const g of groups) {
    let list = groupsByProvider.get(g.provider)
    if (!list) {
      list = []
      groupsByProvider.set(g.provider, list)
    }
    list.push(g)
  }

  // 첫 이벤트 시각 오름차순으로 레인 정렬
  const providerList = [...groupsByProvider.keys()].sort((a, b) => {
    const minA = Math.min(...groupsByProvider.get(a)!.map(g => g.t))
    const minB = Math.min(...groupsByProvider.get(b)!.map(g => g.t))
    return minA - minB || a.localeCompare(b)
  })

  let curY = 0
  const lanes: Lane[] = []
  const placed: Placed[] = []

  for (const provider of providerList) {
    const provGroups = groupsByProvider.get(provider)!
    provGroups.sort((a, b) => a.t - b.t || a.key.localeCompare(b.key))

    // 행 배치: 가로 6px 여백을 두고 겹치지 않는 첫 행에 배치
    const rowRightEdges: number[] = []
    const placedInLane: Array<{ group: EventGroup; x: number; row: number }> = []

    for (const g of provGroups) {
      const x = axis.x(g.t)
      let targetRow = -1

      for (let r = 0; r < rowRightEdges.length; r++) {
        if (x >= rowRightEdges[r]! + 6) {
          targetRow = r
          break
        }
      }

      if (targetRow === -1) {
        // 빈 칸이 없으면 새 칸을 연다. 카드는 겹치지 않고 줄 높이가 늘어난다
        targetRow = rowRightEdges.length
        rowRightEdges.push(x + w)
      } else {
        rowRightEdges[targetRow] = x + w
      }

      placedInLane.push({ group: g, x, row: targetRow })
    }

    const rowCount = Math.max(1, rowRightEdges.length)
    // 연결선 꺾은선과 라벨 글귀가 카드 테두리에 가려지지 않도록 행 간격을 20px로 확보한다
    const rowGap = 20
    const laneHeight = Math.max(opts?.minLaneHeight ?? 0, rowCount * (h + rowGap) + 16)

    lanes.push({
      provider,
      y: curY,
      height: laneHeight,
      rows: rowCount,
    })

    for (const item of placedInLane) {
      placed.push({
        key: item.group.key,
        x: item.x,
        y: curY + 28 + item.row * (h + rowGap),
        w,
        h,
        laneProvider: provider,
        row: item.row,
      })
    }

    curY += laneHeight
  }

  return {
    lanes,
    placed,
    density,
    width: axis.width,
    height: curY > 0 ? 28 + curY : 0,
  }
}
