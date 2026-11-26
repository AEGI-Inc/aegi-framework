import { fallbackPipaLocation } from './frameworkModel'
import { guidanceFor } from './guidance'
import { type FindingRemediation, remediationFor } from './remediations'

export type ObjectRemediationView =
  | { kind: 'card'; remediation: FindingRemediation }
  | { kind: 'insufficient' }
  | null

export function objectRemediationView(findingId: string): ObjectRemediationView {
  const remediation = remediationFor(findingId)
  if (!remediation) return null
  if (remediation.review === '근거 부족') return { kind: 'insufficient' }
  return { kind: 'card', remediation }
}

export function parseComplianceItemLabel(itemKey: string): { frameworkName: string; itemNumber: string } {
  const colon = itemKey.indexOf(':')
  const prefix = colon >= 0 ? itemKey.slice(0, colon) : ''
  const rest = colon >= 0 ? itemKey.slice(colon + 1) : itemKey
  if (prefix === 'ISMS-P') return { frameworkName: 'ISMS-P', itemNumber: rest }
  if (prefix === 'ISO27001') return { frameworkName: 'ISO 27001', itemNumber: rest }
  if (prefix === 'PIPA') {
    const loc = guidanceFor(itemKey)?.location || fallbackPipaLocation(rest)
    return { frameworkName: 'PIPA', itemNumber: loc }
  }
  return { frameworkName: prefix || '컴플라이언스', itemNumber: rest }
}

export function buildObjectRemediationQuestion(
  itemKey: string,
  objectName: string,
  failFindingIds: string[],
): string {
  const { frameworkName, itemNumber } = parseComplianceItemLabel(itemKey)
  const ids = failFindingIds.join(', ')
  return `${frameworkName} ${itemNumber} 기준으로 ${objectName}의 위반 점검 ${failFindingIds.length}개(${ids})를 어떤 순서로 어떻게 조치할지 추천해줘. compliance_item 의 조치 데이터와 기준 근거만 근거로 쓰고, 조치 카드가 없는 점검은 없다고 말해줘.`
}
