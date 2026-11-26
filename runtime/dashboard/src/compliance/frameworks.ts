import { isDemoMode } from '../demoMode'

export type Framework = 'isms-p' | 'pipa' | 'iso27001'

const FRAMEWORKS: { id: Framework; label: string; description: string }[] = [
  { id: 'isms-p', label: 'ISMS-P', description: '정보보호 및 개인정보보호 관리체계' },
  { id: 'pipa', label: 'PIPA', description: '개인정보 보호법' },
  { id: 'iso27001', label: 'ISO 27001', description: '정보보호 관리체계 국제표준' },
]

/** Compliance 기준 목록. 데모에서는 ISO 27001 을 뺀다 */
export function complianceFrameworks(demo = isDemoMode()) {
  return demo ? FRAMEWORKS.filter(f => f.id !== 'iso27001') : FRAMEWORKS
}
