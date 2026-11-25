/**
 * 화면의 시각 표기. 모든 시각을 KST(UTC+9)로 적고 시간대를 붙인다.
 * 원문(UTC)은 title 로 보인다(utcTitle).
 */
const pad = (value: number) => String(value).padStart(2, '0')

export function formatKst(iso: string | undefined | null): string {
  if (!iso) return '시각 없음'
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return iso
  const d = new Date(time + 9 * 3600e3)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} KST`
}

/** 이름에 붙이는 짧은 KST 시각. 예: 11월 10일 14:32 */
export function kstMonthDayTime(ms: number): string {
  const d = new Date(ms + 9 * 3600e3)
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** 커서를 올리면 보이는 원문 (UTC) */
export function utcTitle(iso: string | undefined | null): string | undefined {
  if (!iso) return undefined
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return undefined
  return `원문 ${new Date(time).toISOString().replace('.000Z', 'Z')}`
}

/** 지금부터 며칠 전인지 (오늘이면 0) */
export function daysAgo(iso: string | undefined | null, now: Date = new Date()): number | null {
  if (!iso) return null
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return null
  return Math.max(0, Math.floor((now.getTime() - time) / 864e5))
}
