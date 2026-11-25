import type { MutableRefObject } from 'react'
import { formatKstFull } from '../timeline/timelineAnalysis'

/** 관리자 인증 보호와 관리자 권한 부여 경고 설정, 두 검사 카드가 함께 쓰는 이름과 표시 */
const LABELS: Record<string, string> = {
  pass: '충족', fail: '위반', unknown: '판정 불가', not_collected: '미수집',
  compliant: '회사 기준 부합', noncompliant: '회사 기준 위반', not_required: '회사 기준 적용 제외',
}
export const labelOf = (status?: string) => LABELS[status ?? 'unknown'] ?? '판정 불가'

/** 결과 배지. 위반과 회사 기준 위반만 빨강 */
export function statusBadge(label: string, extra = '') {
  return <span key={label + extra} className={`cfg-status tl-badge${label === '위반' || label === '회사 기준 위반' ? ' is-failure' : ''}`}>{label}{extra}</span>
}

/** Config Findings 판정 시각과 같은 「2026-11-04 21:25:18」 */
export function checkTime(value?: string | null) {
  if (!value) return '시각 없음'
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? value : formatKstFull(t)
}

/** 검사 서버에 닿지 못했을 때 제목 줄 배지. 로컬은 서버를 띄우지 않은 상태 */
export const connectionLabel = () => import.meta.env.DEV ? '검사 서버 연결 전' : '검사 서버 응답 없음'

/** 응답을 기다리는 동안 꺼진 단추가 포커스를 잃었으면 그 단추로 되돌린다 */
export function rememberFocus(control: MutableRefObject<HTMLElement | null>) {
  const target = control.current
  control.current = null
  if (target && target.isConnected && (document.activeElement === document.body || document.activeElement === null)) target.focus()
}
