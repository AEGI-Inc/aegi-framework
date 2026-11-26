import type { FindingV2 } from '../model/findingV2'
import type { ThreatHandling } from '../model/handling'
import { HANDLING_LABEL } from '../model/handling'
import { scenarioTag } from './scenarioTags'
import { severityLabel } from './severity'
import { providerName } from './providers'
import { formatKst } from '../utils/time'
import { toCsv } from '../utils/csv'
import type { ThreatRow } from './threatRows'

/**
 * 위협 목록 CSV. 경영 보고와 감사 자료에 고치지 않고 붙이도록, 화면의 거른 목록을 한 줄에 한 위협으로 적는다.
 * 열: ID, 심각도, 분류, 제목, SaaS, 예외, 처리 상태, 담당자, 수집 시각
 * 설정 행은 엔진 위협에만 있는 예외 열을 비운다.
 */
export interface ThreatCsvContext {
  handling: Map<string, ThreatHandling>
  /** 예외 상태 글(「예외 처리됨」, 「일부 예외 1/17」). 없으면 빈 글 */
  exceptionOf: (finding: FindingV2) => string
  collectedAt?: string
  /** 설정 판정을 만든 시각(standard_results.generated_at) */
  configCollectedAt?: string
}

const HEAD = ['ID', '심각도', '분류', '제목', 'SaaS', '예외', '처리 상태', '담당자', '수집 시각']

export function threatCsv(rows: ThreatRow[], context: ThreatCsvContext): string {
  const engineAt = context.collectedAt ? formatKst(context.collectedAt) : ''
  const configAt = context.configCollectedAt ? formatKst(context.configCollectedAt) : ''
  return toCsv([
    HEAD,
    ...rows.map(row => {
      const finding = row.engine
      const handling = context.handling.get(row.fingerprint)
      return [
        finding?.id ?? row.config?.findingId ?? row.key,
        severityLabel(row.severity),
        scenarioTag(row.group === 'other' ? undefined : row.group).label,
        row.title,
        row.providers.map(providerName).join(' → '),
        finding ? context.exceptionOf(finding) : '',
        HANDLING_LABEL[handling?.state ?? 'new'],
        handling?.owner ?? '',
        row.source === 'config' ? configAt : engineAt,
      ]
    }),
  ])
}
