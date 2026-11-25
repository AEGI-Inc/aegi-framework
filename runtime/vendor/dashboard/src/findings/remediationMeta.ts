import type { RemediationCategory, RemediationPriority } from '../domain/remediation'
import type { FindingRemediationItem } from '../model/findingV2'
import { remediationGuide } from './remediationGuide'

/**
 * 조치의 종류와 급한 정도를 화면 표기로 옮긴다.
 *
 * 조치 데이터에는 category와 priority가 이미 들어 있는데 화면에는
 * 제목과 설명만 나와서, 목록을 훑을 때 "무엇부터 손대야 하는지"가
 * 보이지 않았다. 분류는 지어내지 않고 조치 상세(guide)의 값을 그대로 쓴다.
 */
export const CATEGORY_LABELS: Record<RemediationCategory, string> = {
  access: '접근 권한',
  policy: '정책',
  credential: '자격증명',
  automation: '자동화',
  configuration: '설정',
  monitoring: '모니터링',
}

export const PRIORITY_LABELS: Record<RemediationPriority, string> = {
  critical: '긴급',
  high: '높음',
  medium: '보통',
  low: '낮음',
}

const PRIORITY_RANK: Record<RemediationPriority, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
}

export interface RemediationMeta {
  category: RemediationCategory
  categoryLabel: string
  priority: RemediationPriority
  priorityLabel: string
  rank: number
}

export interface RemediationRef {
  id: string
  title: string
  guide?: FindingRemediationItem['guide']
}

/**
 * 조치의 분류와 우선순위를 찾는다.
 *
 * 조치 상세(remediationGuide)가 없으면 null 을 돌려준다.
 */
export function remediationMeta(item: RemediationRef): RemediationMeta | null {
  const action = remediationGuide(item)
  if (!action) return null

  return {
    category: action.category,
    categoryLabel: CATEGORY_LABELS[action.category] ?? action.category,
    priority: action.priority,
    priorityLabel: PRIORITY_LABELS[action.priority] ?? action.priority,
    rank: PRIORITY_RANK[action.priority] ?? 0,
  }
}

/**
 * 급한 것부터 위로 올린다.
 *
 * 분류를 믿을 수 없는 항목은 '보통'으로 두고 원래 자리를 지키게 한다.
 * 어느 항목도 목록에서 빠지지 않는다.
 */
export function sortByPriority<T extends RemediationRef>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index, rank: remediationMeta(item)?.rank ?? 1 }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map(entry => entry.item)
}
