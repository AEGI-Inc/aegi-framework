import type { ComplianceVerdictItem, ComplianceVerdictStatus, StandardResults } from '../config-findings/standardResultsStore'
import { CE_EXPIRING_SOON_DAYS, type ComplianceException } from '../model/complianceException'
import { VERDICT_LABEL, verdictFor } from './verdicts'

export type EffectiveStatus = ComplianceVerdictStatus | 'excepted'
export const EFFECTIVE_LABEL: Record<EffectiveStatus, string> = { ...VERDICT_LABEL, excepted: '예외' }
export const EFFECTIVE_ORDER: readonly EffectiveStatus[] = ['fail', 'partial', 'unknown', 'manual', 'no_check', 'excepted', 'pass']

export const isActiveException = (e: ComplianceException, now: Date): boolean =>
  !e.revokedAt && new Date(e.expiresAt).getTime() > now.getTime()

export interface EffectiveVerdict {
  status: EffectiveStatus
  /** 이 확인사항에 걸린 유효한 항목 예외 */
  itemException?: ComplianceException
  /** 유효한 예외가 덮은 위반 점검 id */
  covered: string[]
  /** 예외가 덮지 않은 위반 점검 id */
  uncovered: string[]
}

export function effectiveVerdict(
  verdict: ComplianceVerdictItem | undefined,
  exceptions: ComplianceException[],
  now: Date,
): EffectiveVerdict | undefined {
  if (!verdict) return undefined
  const active = exceptions.filter(e => isActiveException(e, now))
  const itemException = active.find(e => e.scope === 'item' && e.target === verdict.key)
  if (verdict.status !== 'fail') {
    return { status: verdict.status, ...(itemException ? { itemException } : {}), covered: [], uncovered: [] }
  }
  const checkTargets = new Set(active.filter(e => e.scope === 'check').map(e => e.target))
  const itemCovered = new Set(itemException?.failFindings ?? [])
  const covered: string[] = []
  const uncovered: string[] = []
  for (const f of verdict.fail_findings) {
    if (checkTargets.has(f) || itemCovered.has(f)) covered.push(f)
    else uncovered.push(f)
  }
  const allCovered = uncovered.length === 0 && (verdict.fail_findings.length > 0 || Boolean(itemException))
  return {
    status: allCovered ? 'excepted' : 'fail',
    ...(itemException ? { itemException } : {}),
    covered,
    uncovered,
  }
}

export function worstEffective(
  items: Array<EffectiveVerdict | EffectiveStatus | undefined | null>,
): EffectiveStatus | undefined {
  const statuses = items
    .map(x => (x && typeof x === 'object' && 'status' in x ? x.status : x))
    .filter((s): s is EffectiveStatus => typeof s === 'string' && s in EFFECTIVE_LABEL)
  for (const candidate of EFFECTIVE_ORDER) {
    if (statuses.includes(candidate)) return candidate
  }
  return undefined
}

export type ExceptionState = 'active' | 'expiring' | 'expired' | 'revoked'
export const EXCEPTION_STATE_LABEL: Record<ExceptionState, string> = {
  active: '적용 중',
  expiring: '만료 임박',
  expired: '만료',
  revoked: '취소',
}

export function exceptionState(e: ComplianceException, now: Date): ExceptionState {
  if (e.revokedAt) return 'revoked'
  const remaining = new Date(e.expiresAt).getTime() - now.getTime()
  if (remaining <= 0) return 'expired'
  if (remaining <= CE_EXPIRING_SOON_DAYS * 86_400_000) return 'expiring'
  return 'active'
}

/** 대상이 지금 위반인가. item: 그 키의 판정이 fail, check: 어느 판정이든 fail_findings 에 target 이 있음. 판정(compliance)이 없으면 true */
export function exceptionTargetFailing(e: ComplianceException, results: StandardResults | undefined): boolean {
  if (!results?.compliance) return true
  if (e.scope === 'item') return verdictFor(results, e.target)?.status === 'fail'
  return results.compliance.items.some(item => item.fail_findings.includes(e.target))
}
