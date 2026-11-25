import type { Item, ItemStatus, Target } from './standardResultsStore'

/**
 * 기준별 판정의 항목 하나와 해당 대상. Threat 의 설정 위반 상세가 쓴다.
 */
export const STATUS_LABEL: Record<ItemStatus, string> = { fail: '위반', pass: '충족', unknown: '판정 불가', not_collected: '미수집', org_policy: '조직 정책 필요', manual: '사람 검토' }

/** 상태 배지. 플랫폼 .tl-badge 규격, 위반만 실패 배지 */
export const statusClass = (st: ItemStatus) => `cfg-status tl-badge is-${st}${st === 'fail' ? ' is-failure' : ''}`

/** 항목들의 대상을 key 로 한 번씩 */
export function uniqueTargets(items: Item[]): Target[] {
  return [...new Map(items.flatMap(i => i.targets).map(t => [t.key, t])).values()]
}

