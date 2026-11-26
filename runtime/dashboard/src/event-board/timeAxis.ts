/**
 * Event Board 타임라인 시간축 계산.
 * 생략 구간(gaps), 실제 시간 비례(linear), 순서대로(ordinal) 축을 계산하는 순수 함수.
 */
import { ticks } from '../timeline/ticks'

export interface Segment {
  start: number
  end: number
  count: number
}

export interface AxisSegment {
  start: number
  end: number
  x0: number
  x1: number
}

export interface AxisGap {
  index: number
  from: number
  to: number
  x0: number
  x1: number
  label: string
  dayChange: string | null
}

export interface AxisTick {
  t: number
  x: number
  label: string
}

export interface Axis {
  x(t: number): number
  invert(x: number): number | null
  width: number
  segments: AxisSegment[]
  gaps: AxisGap[]
  ticks: AxisTick[]
}

export interface AxisOptions {
  expanded?: number[]
  minSegmentPx?: number
  gapPx?: number
  padPx?: number
  /** 구간 오른쪽 끝에 비워 둘 폭(카드가 생략 칸을 넘지 않게). 생략 있음 보기에서만 쓴다 */
  tailPx?: number
  /** 드래그 영역 확대로 고정할 표시 시간 범위 */
  domainRange?: [number, number]
}

const KST_OFFSET = 9 * 3600_000

/** KST 날짜 표기 (MM-DD) */
export function kstDateStr(t: number): string {
  const d = new Date(t + KST_OFFSET)
  return d.toISOString().slice(5, 10)
}

/** KST 시분 표기 (HH:mm) */
export function kstTimeStr(t: number): string {
  const d = new Date(t + KST_OFFSET)
  return d.toISOString().slice(11, 16)
}

/** KST 시분초 표기 (HH:mm:ss) */
export function kstSecTimeStr(t: number): string {
  const d = new Date(t + KST_OFFSET)
  return d.toISOString().slice(11, 19)
}

/** 생략 구간 시간차 한글 표기 */
export function formatGapDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}분`
  const totalHours = Math.floor(totalMinutes / 60)
  const remMinutes = totalMinutes % 60
  if (totalHours < 24) {
    return remMinutes > 0 ? `${totalHours}시간 ${remMinutes}분` : `${totalHours}시간`
  }
  const days = Math.floor(totalHours / 24)
  const remHours = totalHours % 24
  return remHours > 0 ? `${days}일 ${remHours}시간` : `${days}일`
}

/** 긴 빈 구간을 기준으로 시간 구간 나누기 */
export function timeSegments(times: number[], opts?: { minGapMs?: number; gapRatio?: number }): Segment[] {
  if (!times.length) return []
  const sorted = [...times].sort((a, b) => a - b)
  if (sorted.length === 1) {
    return [{ start: sorted[0]!, end: sorted[0]!, count: 1 }]
  }

  const minGapMs = opts?.minGapMs ?? 30 * 60_000
  const gapRatio = opts?.gapRatio ?? 0.1
  const totalSpan = sorted[sorted.length - 1]! - sorted[0]!
  const threshold = Math.max(minGapMs, gapRatio * totalSpan)

  const segments: Segment[] = []
  let segStart = sorted[0]!
  let prev = sorted[0]!
  let count = 1

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!
    const gap = cur - prev
    if (gap > threshold) {
      segments.push({ start: segStart, end: prev, count })
      segStart = cur
      count = 1
    } else {
      count++
    }
    prev = cur
  }
  segments.push({ start: segStart, end: prev, count })

  return segments
}

function buildSegmentTicks(
  seg: { start: number; end: number; x0: number; x1: number },
  xFn: (t: number) => number,
): AxisTick[] {
  const segW = seg.x1 - seg.x0
  const count = Math.max(3, Math.round(segW / 68))
  let tickTimes = ticks(seg.start, seg.end, count)
  if (tickTimes.length === 0) {
    tickTimes = [seg.start]
    if (seg.end > seg.start && xFn(seg.end) - xFn(seg.start) >= 56) {
      tickTimes.push(seg.end)
    }
  }
  const showSeconds =
    (tickTimes.length > 1 && tickTimes[1]! - tickTimes[0]! < 60_000) ||
    (seg.end > seg.start && seg.end - seg.start < 60_000)
  const result: AxisTick[] = []
  let lastX = -Infinity
  let lastLabelLen = 0

  for (let i = 0; i < tickTimes.length; i++) {
    const t = tickTimes[i]!
    const px = xFn(t)
    const isFirst = result.length === 0
    const dayChanged = !isFirst && kstDateStr(t) !== kstDateStr(result[result.length - 1]!.t)
    const timePart = showSeconds ? kstSecTimeStr(t) : kstTimeStr(t)
    const label = isFirst || dayChanged ? `${kstDateStr(t)} ${timePart}` : timePart
    const minSpacing = lastLabelLen * 6.8 + 10
    if (!isFirst && px - lastX < minSpacing) continue
    result.push({
      t,
      x: px,
      label,
    })
    lastX = px
    lastLabelLen = label.length
  }

  return result
}

/** 타임라인 시간축 계산 */
export function buildAxis(
  times: number[],
  mode: 'gaps' | 'linear' | 'ordinal',
  width: number,
  opts?: AxisOptions,
): Axis {
  const minSegmentPx = opts?.minSegmentPx ?? 160
  const gapPx = opts?.gapPx ?? 28
  const padPx = opts?.padPx ?? 24
  const expanded = new Set(opts?.expanded ?? [])
  const tailPx = opts?.tailPx ?? 0
  const domainRange = opts?.domainRange && opts.domainRange[0] < opts.domainRange[1] ? opts.domainRange : undefined
  const baseTimes = domainRange ? [...times, domainRange[0], domainRange[1]] : times

  if (!baseTimes.length) {
    const totalW = Math.max(width, padPx * 2)
    return {
      x: () => padPx,
      invert: () => null,
      width: totalW,
      segments: [],
      gaps: [],
      ticks: [],
    }
  }

  const sorted = [...baseTimes].sort((a, b) => a - b)
  const minTime = sorted[0]!
  const maxTime = sorted[sorted.length - 1]!

  if (mode === 'linear') {
    const minNeeded = padPx * 2 + minSegmentPx
    const totalW = Math.max(width, minNeeded)
    const plotW = totalW - padPx * 2
    const span = Math.max(1, maxTime - minTime)

    const x = (t: number): number => {
      if (t <= minTime) return padPx
      if (t >= maxTime) return totalW - padPx
      return padPx + ((t - minTime) / span) * plotW
    }

    const invert = (px: number): number | null => {
      const clamped = Math.max(padPx, Math.min(totalW - padPx, px))
      if (maxTime === minTime) return minTime
      return minTime + ((clamped - padPx) / Math.max(1, plotW)) * (maxTime - minTime)
    }

    const seg: AxisSegment = {
      start: minTime,
      end: maxTime,
      x0: padPx,
      x1: totalW - padPx,
    }

    const segTicks = buildSegmentTicks(seg, x)

    return {
      x,
      invert,
      width: totalW,
      segments: [seg],
      gaps: [],
      ticks: segTicks,
    }
  }

  if (mode === 'ordinal') {
    const distinct = [...new Set(sorted)].sort((a, b) => a - b)
    const stepCount = Math.max(1, distinct.length - 1)
    const minNeeded = padPx * 2 + stepCount * 24
    const totalW = Math.max(width, minNeeded)
    const plotW = totalW - padPx * 2
    const stepPx = plotW / stepCount

    const x = (t: number): number => {
      if (t <= distinct[0]!) return padPx
      if (t >= distinct[distinct.length - 1]!) return totalW - padPx
      if (distinct.length === 1) return padPx + plotW / 2

      // 인접한 두 시각 사이에서 선형 보간
      for (let i = 0; i < distinct.length - 1; i++) {
        const t0 = distinct[i]!
        const t1 = distinct[i + 1]!
        if (t >= t0 && t <= t1) {
          const frac = t1 > t0 ? (t - t0) / (t1 - t0) : 0
          return padPx + (i + frac) * stepPx
        }
      }
      return totalW - padPx
    }

    const invert = (px: number): number | null => {
      if (distinct.length === 1) return distinct[0]!
      const clamped = Math.max(padPx, Math.min(totalW - padPx, px))
      const pos = (clamped - padPx) / Math.max(1e-9, stepPx)
      const idx = Math.min(distinct.length - 2, Math.max(0, Math.floor(pos)))
      const frac = Math.max(0, Math.min(1, pos - idx))
      return distinct[idx]! + frac * (distinct[idx + 1]! - distinct[idx]!)
    }

    const seg: AxisSegment = {
      start: distinct[0]!,
      end: distinct[distinct.length - 1]!,
      x0: padPx,
      x1: totalW - padPx,
    }

    // 촘촘한 눈금 생성 (3개 이하면 첫 시각만 표시)
    const ordinalTicks: AxisTick[] = []
    let lastDate: string | null = null
    for (let i = 0; i < distinct.length; i += 3) {
      const t = distinct[i]!
      const curDate = kstDateStr(t)
      const isFirst = i === 0
      const dayChanged = lastDate !== null && curDate !== lastDate
      const label = isFirst || dayChanged ? `${curDate} ${kstTimeStr(t)}` : kstTimeStr(t)
      lastDate = curDate
      ordinalTicks.push({
        t,
        x: padPx + i * stepPx,
        label,
      })
    }

    return {
      x,
      invert,
      width: totalW,
      segments: [seg],
      gaps: [],
      ticks: ordinalTicks,
    }
  }

  // mode === 'gaps'
  const initialSegments = timeSegments(sorted)
  if (initialSegments.length === 1) {
    const seg = initialSegments[0]!
    const minNeeded = padPx * 2 + minSegmentPx
    const totalW = Math.max(width, minNeeded)
    const plotW = totalW - padPx * 2
    const span = Math.max(1, seg.end - seg.start)

    const x = (t: number): number => {
      if (t <= seg.start) return padPx
      if (t >= seg.end) return totalW - padPx
      if (seg.end === seg.start) return padPx + plotW / 2
      return padPx + ((t - seg.start) / span) * plotW
    }

    const invert = (px: number): number | null => {
      if (seg.end === seg.start) return seg.start
      const clamped = Math.max(padPx, Math.min(totalW - padPx, px))
      return seg.start + ((clamped - padPx) / Math.max(1, plotW)) * (seg.end - seg.start)
    }

    const axisSeg: AxisSegment = {
      start: seg.start,
      end: seg.end,
      x0: padPx,
      x1: totalW - padPx,
    }

    const segTicks = buildSegmentTicks(axisSeg, x)

    return {
      x,
      invert,
      width: totalW,
      segments: [axisSeg],
      gaps: [],
      ticks: segTicks,
    }
  }

  // expanded 에 포함된 생략 구간은 합치고, 아닌 구간만 folded gap 으로 유지
  interface IntermediateSeg {
    start: number
    end: number
    count: number
  }

  interface IntermediateGap {
    index: number
    from: number
    to: number
    label: string
    dayChange: string | null
  }

  const mergedSegments: IntermediateSeg[] = []
  const foldedGaps: IntermediateGap[] = []

  let curSeg: IntermediateSeg = { ...initialSegments[0]! }

  for (let i = 0; i < initialSegments.length - 1; i++) {
    const nextSeg = initialSegments[i + 1]!
    const gapFrom = curSeg.end
    const gapTo = nextSeg.start

    if (expanded.has(i)) {
      // 펼쳐진 구간은 이웃 구간과 합침
      curSeg.end = nextSeg.end
      curSeg.count += nextSeg.count
    } else {
      // 접힌 구간
      mergedSegments.push(curSeg)
      const dayFrom = kstDateStr(gapFrom)
      const dayTo = kstDateStr(gapTo)
      foldedGaps.push({
        index: i,
        from: gapFrom,
        to: gapTo,
        label: formatGapDuration(gapTo - gapFrom),
        dayChange: dayFrom !== dayTo ? `${dayFrom} → ${dayTo}` : null,
      })
      curSeg = { ...nextSeg }
    }
  }
  mergedSegments.push(curSeg)

  const mCount = mergedSegments.length
  const fCount = foldedGaps.length
  const minNeeded = padPx * 2 + fCount * gapPx + mCount * (minSegmentPx + tailPx)
  const totalW = Math.max(width, minNeeded)
  const availSegW = totalW - padPx * 2 - fCount * gapPx - mCount * tailPx

  // 각 구간에 최소 minSegmentPx를 보장하며 길이에 비례한 너비 배분
  const totalDur = mergedSegments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0)
  const segWidths = new Array<number>(mCount).fill(minSegmentPx)

  if (availSegW > mCount * minSegmentPx) {
    const remaining = availSegW - mCount * minSegmentPx
    for (let i = 0; i < mCount; i++) {
      const dur = Math.max(0, mergedSegments[i]!.end - mergedSegments[i]!.start)
      const share = totalDur > 0 ? (dur / totalDur) * remaining : remaining / mCount
      segWidths[i] = minSegmentPx + share
    }
  }
  for (let i = 0; i < mCount; i++) segWidths[i] = segWidths[i]! + tailPx

  // 좌표 배치
  let curX = padPx
  const axisSegments: AxisSegment[] = []
  const axisGaps: AxisGap[] = []

  for (let i = 0; i < mCount; i++) {
    const s = mergedSegments[i]!
    const w = segWidths[i]!
    const x0 = curX
    const x1 = curX + w
    axisSegments.push({
      start: s.start,
      end: s.end,
      x0,
      x1,
    })
    curX = x1

    if (i < fCount) {
      const g = foldedGaps[i]!
      const gx0 = curX
      const gx1 = curX + gapPx
      axisGaps.push({
        ...g,
        x0: gx0,
        x1: gx1,
      })
      curX = gx1
    }
  }

  const x = (t: number): number => {
    if (t <= axisSegments[0]!.start) return axisSegments[0]!.x0
    const lastSeg = axisSegments[axisSegments.length - 1]!
    if (t >= lastSeg.end) return lastSeg.x1 - tailPx

    // 구간 안(양 끝 포함)이면 비례 위치. 끝 쪽 tailPx 는 카드 폭만큼 비워 둔다
    for (const s of axisSegments) {
      if (t >= s.start && t <= s.end) {
        const right = s.x1 - tailPx
        if (s.end === s.start) return s.x0 + (right - s.x0) / 2
        return s.x0 + ((t - s.start) / (s.end - s.start)) * (right - s.x0)
      }
    }

    // 접힌 구간 안이면 그 칸 가운데
    for (const g of axisGaps) {
      if (t > g.from && t < g.to) return (g.x0 + g.x1) / 2
    }

    return axisSegments[0]!.x0
  }

  const invert = (px: number): number | null => {
    const firstSeg = axisSegments[0]!
    const lastSeg = axisSegments[axisSegments.length - 1]!
    if (px <= firstSeg.x0) return firstSeg.start
    if (px >= lastSeg.x1 - tailPx) return lastSeg.end

    for (const s of axisSegments) {
      if (px >= s.x0 && px <= s.x1) {
        const right = Math.max(s.x0 + 1, s.x1 - tailPx)
        if (px >= right || s.end === s.start) return s.end
        return s.start + ((px - s.x0) / (right - s.x0)) * (s.end - s.start)
      }
    }

    for (const g of axisGaps) {
      if (px >= g.x0 && px <= g.x1) {
        return g.from + ((px - g.x0) / Math.max(1, g.x1 - g.x0)) * (g.to - g.from)
      }
    }

    return firstSeg.start
  }

  const allTicks: AxisTick[] = []
  for (const seg of axisSegments) {
    const segTicks = buildSegmentTicks(
      { start: seg.start, end: seg.end, x0: seg.x0, x1: Math.max(seg.x0 + 1, seg.x1 - tailPx) },
      x,
    )
    allTicks.push(...segTicks)
  }

  return {
    x,
    invert,
    width: totalW,
    segments: axisSegments,
    gaps: axisGaps,
    ticks: allTicks,
  }
}
