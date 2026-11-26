import type { FindingV2 } from '../model/findingV2'
import type { Provider } from '../model/object'
import type { Item, StandardResults } from '../config-findings/standardResultsStore'
import { fingerprintOf } from '../exceptions/applyExceptions'
import { classificationSearchTerms, findingGroupKey, findingTagKey, scenarioTag, type ThreatGroupKey } from './scenarioTags'
import { providerName } from './providers'
import { SEVERITY_RANK, type Severity } from './severity'

/**
 * 통합 위협 목록의 한 줄(#222). 엔진이 찾은 위협(접근 격차)과 Config Findings 기준별 판정의 위반(설정)을
 * 같은 모양으로 바꿔 한 목록에서 정렬하고 거른다. 한쪽에만 있는 값(경로, 증적, 예외, 위반 항목)은 engine, config 에 둔다.
 */
export type ThreatSource = 'engine' | 'config'
/** 관측됨(발생), 추정(발생 가능)은 엔진 판정의 occurrence, 설정값은 설정 판정 */
export type ThreatBasis = 'observed' | 'structural' | 'config'
export const SOURCE_LABEL: Record<ThreatSource, string> = { engine: '접근 격차', config: '설정' }

export interface ConfigThreat {
  findingId: string
  provider: Provider
  /** 이 finding 에서 위반(fail)으로 판정된 기준 항목 */
  failItems: Item[]
}

export interface ThreatRow {
  /** 행 식별자. 엔진 행은 위협 id, 설정 행은 cfg|<SaaS>|<finding id> */
  key: string
  source: ThreatSource
  title: string
  group: ThreatGroupKey | 'other'
  severity: Severity
  providers: Provider[]
  targetKeys: string[]
  basis?: ThreatBasis
  /** 처리 상태 저장 키(threat_handling.fingerprint) */
  fingerprint: string
  /** 검색어와 견주는 소문자 글 */
  searchText: string
  engine?: FindingV2
  config?: ConfigThreat
}

export function engineRow(finding: FindingV2): ThreatRow {
  return {
    key: finding.id,
    source: 'engine',
    title: finding.title,
    group: findingGroupKey(finding) ?? 'other',
    severity: finding.severity,
    providers: finding.providerSet,
    targetKeys: finding.involvedObjectKeys,
    // 위협 판정 V2 는 발생(실행 기록으로 확인)과 발생 가능(구성)을 같은 칩에 싣는다
    basis: finding.occurrence === '발생' ? 'observed' : finding.occurrence === '발생 가능' ? 'structural' : undefined,
    fingerprint: fingerprintOf(finding),
    searchText: [
      finding.title, finding.summary, finding.id, finding.ruleId,
      ...classificationSearchTerms(findingTagKey(finding)),
      ...finding.providerSet.map(providerName), ...finding.providerSet,
      SOURCE_LABEL.engine,
    ].join(' ').toLowerCase(),
    engine: finding,
  }
}

/** 기준 등급 → 심각도. 실측 기준은 1, 2등급뿐이다 */
const TIER_SEVERITY: Record<number, Severity> = { 1: 'high', 2: 'medium', 3: 'low' }

/** 기준별 판정에서 위반(fail) 항목이 하나라도 있는 finding 을 한 줄씩. 판정 이력이 없으면 빈 목록 */
export function configRows(results: StandardResults | undefined): ThreatRow[] {
  if (!results) return []
  const tierOf = new Map(results.standards.map(s => [s.id, s.tier]))
  return results.findings.flatMap(f => {
    const failItems = f.items.filter(i => i.status === 'fail')
    if (failItems.length === 0) return []
    const tiers = failItems.map(i => tierOf.get(i.standard)).filter((t): t is number => typeof t === 'number')
    const severity = (tiers.length ? TIER_SEVERITY[Math.min(...tiers)] : undefined) ?? 'low'
    const standards = [...new Set(failItems.map(i => i.standard))]
    const key = `cfg|${f.provider}|${f.id}`
    const row: ThreatRow = {
      key,
      source: 'config',
      title: f.text,
      group: 'config_gap',
      severity,
      providers: [f.provider],
      targetKeys: [...new Set(failItems.flatMap(i => i.targets.map(t => t.key)))],
      basis: 'config',
      fingerprint: key,
      searchText: [f.text, f.id, ...standards, scenarioTag('config_gap').label, providerName(f.provider), f.provider, SOURCE_LABEL.config].join(' ').toLowerCase(),
      config: { findingId: f.id, provider: f.provider, failItems },
    }
    return [row]
  })
}

/** 설정 위반 상세가 보일 finding. 같은 id 가 SaaS 마다 있을 수 있어 SaaS 도 맞춘다. 없거나 위반 항목이 없으면 undefined */
export function findConfigFinding(results: StandardResults | undefined, ref: { provider: string; findingId: string }): StandardResults['findings'][number] | undefined {
  const finding = results?.findings.find(f => f.provider === ref.provider && f.id === ref.findingId)
  return finding?.items.some(i => i.status === 'fail') ? finding : undefined
}

/** 심각도가 높은 것부터, 같으면 새로 접근하는 사람이 많은 것부터, 그다음 key 순으로 고정한다 */
export function sortRows(rows: ThreatRow[]): ThreatRow[] {
  const people = (r: ThreatRow) => r.engine?.threatHeadline?.people ?? 0
  return [...rows].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || people(b) - people(a) || a.key.localeCompare(b.key))
}
