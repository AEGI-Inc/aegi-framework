import { daysUntil } from '../model/exception'
import { formatKst } from '../utils/time'

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 사람이 한 일의 시각. 다른 화면과 같이 KST 로 적고 시간대를 붙인다 (전에는 시간대 없는 이 기기 시각) */
export function formatDateTime(iso: string): string {
  return formatKst(iso)
}

/** "12-27 (90일 남음)" · "무기한" · "만료됨" */
export function expiryText(iso: string | null, now: Date): string {
  if (iso === null) return '무기한'
  const days = daysUntil(iso, now)
  if (days <= 0) return `${formatDate(iso)}, 만료됨`
  return `${formatDate(iso)}, ${days}일 남음`
}
