/** 시간축 눈금. 구간 길이에 맞춰 간격을 고른다 */
export function ticks(start: number, end: number, count: number): number[] {
  const steps = [
    10_000,
    30_000,
    60_000,
    2 * 60_000,
    5 * 60_000,
    10 * 60_000,
    15 * 60_000,
    30 * 60_000,
    3600_000,
    2 * 3600_000,
    3 * 3600_000,
    6 * 3600_000,
    12 * 3600_000,
    86400_000,
    7 * 86400_000,
  ]
  const span = Math.max(1, end - start)
  const step = steps.find(s => span / s <= count) ?? steps[steps.length - 1]!
  const out: number[] = []
  const kst = 9 * 3600_000
  for (let t = Math.ceil((start + kst) / step) * step - kst; t <= end; t += step) out.push(t)
  return out
}
