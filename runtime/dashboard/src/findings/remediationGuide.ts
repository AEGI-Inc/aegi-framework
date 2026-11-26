import type { RemediationAction } from '../domain/remediation'
import type { FindingRemediationItem } from '../model/findingV2'

/**
 * 권장 조치 항목의 조치 상세.
 *
 * 게시 때 엔진이 조치 틀을 그 위협의 객체로 채운 guide 만 쓴다(aegi-adapter-engine display-text/remediations).
 * guide 가 없으면 상세가 없다.
 */
export function remediationGuide(item: Pick<FindingRemediationItem, 'id' | 'title' | 'guide'>): RemediationAction | undefined {
  return item.guide
}
