import type { FindingV2 } from '../model/findingV2'
import type { EvidenceStore } from '../model/evidence'
import { scenarioTag, findingTagKey } from './scenarioTags'
import { severityLabel } from './severity'
import { sortByPriority } from './remediationMeta'
import { formatKst } from '../utils/time'

/**
 * 보고서에 그대로 붙일 수 있는 위협 한 줄.
 *
 * 전에는 판정 근거를 줄로 이은 글(「확인: 연동이 대상을 바꾼 실행 기록, obs:OBS-… → customer-api / …」)이라
 * 제목, 심각도, 조치, 수집 시각이 빠지고 내부 ID 가 들어가, 붙이기 전에 매번 다시 썼다.
 * 틀: [심각도, 분류] 제목. 근거. 권장 조치. 수집 시각.
 */
export function reportSentence(finding: FindingV2, evidence: EvidenceStore, collectedAt?: string): string {
  const parts: string[] = []
  parts.push(`[${severityLabel(finding.severity)}, ${scenarioTag(findingTagKey(finding)).label}] ${finding.title}.`)
  const observations = finding.evidenceObservationIds.map(id => evidence.observationsById.get(id)).filter(Boolean)
  const measured = observations.filter(o => o!.provenance.record === 'measured').length
  const synthetic = observations.length - measured
  if (observations.length) {
    const kinds = [measured ? `실측 ${measured}` : '', synthetic ? `합성 ${synthetic}` : ''].filter(Boolean).join(', ')
    parts.push(`활동 증적 ${observations.length}건: ${kinds}.`)
  }
  const first = sortByPriority(finding.remediation)[0]
  if (first) parts.push(`권장 조치: ${first.title}.`)
  if (collectedAt) parts.push(`수집 ${formatKst(collectedAt)}.`)
  return parts.join(' ')
}
