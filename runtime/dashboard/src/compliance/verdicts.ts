import type {
  ComplianceVerdictItem,
  ComplianceVerdictStatus,
  StandardResults,
} from '../config-findings/standardResultsStore'

export const VERDICT_LABEL: Record<ComplianceVerdictStatus, string> = {
  fail: '위반',
  pass: '충족',
  partial: '일부 확인',
  unknown: '판정 불가',
  manual: '직접 확인 필요',
  no_check: '점검 없음',
}

export const VERDICT_ORDER: readonly ComplianceVerdictStatus[] = [
  'fail',
  'partial',
  'unknown',
  'manual',
  'no_check',
  'pass',
]

/**
 * results.compliance.items 에서 itemKey 와 일치하는 판정 항목을 찾는다.
 * compliance 칸이 없거나 항목이 없으면 undefined 를 돌려준다.
 */
export function verdictFor(
  results: StandardResults | undefined,
  itemKey: string,
): ComplianceVerdictItem | undefined {
  return results?.compliance?.items?.find(item => item.key === itemKey)
}

/**
 * 확인사항 판정 목록 또는 상태 목록에서 가장 나쁜 판정 상태를 고른다.
 * 표시 우선순위: fail > partial > unknown > no_check > pass
 */
export function worstVerdict(
  items: Array<ComplianceVerdictItem | ComplianceVerdictStatus | undefined | null>,
): ComplianceVerdictStatus | undefined {
  const statuses = items
    .map(x => (x && typeof x === 'object' && 'status' in x ? x.status : x))
    .filter((s): s is ComplianceVerdictStatus => typeof s === 'string' && s in VERDICT_LABEL)

  for (const candidate of VERDICT_ORDER) {
    if (statuses.includes(candidate)) return candidate
  }
  return undefined
}
