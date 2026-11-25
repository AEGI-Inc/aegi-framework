import { linkedFindings } from './controlStatus'
import { buildFramework, type FrameworkId } from './frameworkModel'

/** 설정 점검 하나가 연결된 범위 안 컴플라이언스 항목 */
export interface FindingComplianceRef { framework: FrameworkId; label: string; controlId: string; title: string; subtitle: string }

const FRAMEWORKS: FrameworkId[] = ['isms-p', 'iso27001', 'pipa']
let index: Map<string, FindingComplianceRef[]> | null = null

/** 점검 id → 그 점검이 연결된 항목(세 기준, 화면에 보이는 범위 안 항목만) */
export function complianceForFinding(findingId: string): FindingComplianceRef[] {
  if (!index) {
    index = new Map()
    for (const id of FRAMEWORKS) {
      const fw = buildFramework(id)
      for (const c of fw.controls) {
        const ids = new Set(c.requirements.flatMap(r => linkedFindings(r.key)))
        for (const fid of ids) {
          const list = index.get(fid) ?? []
          list.push({ framework: fw.id, label: fw.label, controlId: c.id, title: c.title, subtitle: c.subtitle })
          index.set(fid, list)
        }
      }
    }
  }
  return index.get(findingId) ?? []
}

export const complianceHash = (ref: Pick<FindingComplianceRef, 'framework' | 'controlId'>) =>
  `#compliance?${new URLSearchParams({ framework: ref.framework, criterion: ref.controlId })}`
