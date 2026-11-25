import type { FindingV2 } from '../model/findingV2'

export type Severity = FindingV2['severity']

/**
 * 심각도 배지 표시 규칙.
 *
 * 화면 곳곳에서 'HIGH'를 문자열로 박아 두고 있었는데, 그러면 데이터의
 * severity가 바뀌어도 화면은 계속 HIGH를 보여준다. 표시는 반드시
 * finding.severity에서 나와야 하므로 매핑을 한 곳에 모은다.
 */
export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
  info: 'INFO',
}

export function severityLabel(severity: Severity): string {
  return SEVERITY_LABELS[severity] ?? String(severity).toUpperCase()
}

/** 배지에 붙일 수식 클래스. CSS는 .fn-severity-badge.<level> 로 정의한다. */
export function severityClass(severity: Severity): string {
  return severity
}

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
}

/**
 * Finding 목록은 심각도가 높은 것부터 본다. 같은 심각도 안에서는 새로 접근하는 사람이 많은 것부터(위협 판정 V2),
 * 그다음 ID 순으로 고정해, 목록을 다시 그려도 줄 순서가 흔들리지 않게 한다.
 */
export function sortBySeverity<T extends { severity: Severity; id: string; threatHeadline?: { people: number } }>(findings: T[]): T[] {
  return [...findings].sort((a, b) => {
    const diff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (diff !== 0) return diff
    const people = (b.threatHeadline?.people ?? 0) - (a.threatHeadline?.people ?? 0)
    return people !== 0 ? people : a.id.localeCompare(b.id)
  })
}
