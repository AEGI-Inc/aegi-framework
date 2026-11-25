import type { FindingV2 } from '../model/findingV2'
import { daysUntil, decisionKeyOf, EXPIRING_SOON_DAYS, REVIEW_EXPIRY_DAYS, type ThreatException } from '../model/exception'
import { SEVERITY_RANK } from '../findings/severity'
import { destinationKeysOf, exfilOnlyDestinationKeys } from '../findings/outsideDestinations'

/**
 * 탐지 결과에 예외를 적용한다 (docs/spec/AEGI_THREAT_EXCEPTION_PLAN_V1.md 2.4·2.5·6.6).
 *
 * 엔진 판정 결과(derived)는 건드리지 않는다. 화면으로 넘기기 직전에 한 번 거른다.
 * 판정하지 못하는 경우는 늘 "다시 탐지하는 쪽"으로 기운다 — 지문이 다르면 절대 가리지 않는다.
 * 위협 판정 V2 위협에는 옛 위반 대상(subjects)이 없어 위협 전체와 목적지 전체만 가린다.
 * 저장된 옛 범위(이번 발생, 선택 대상) 예외는 읽기만 하고 가리는 위협이 없어 「대상 없음」으로 보인다.
 */

export type ExceptionStatus = 'active' | 'unmatched' | 'expired' | 'revoked'

export const STATUS_LABELS: Record<ExceptionStatus, string> = {
  active: '적용 중',
  unmatched: '대상 없음',
  expired: '만료',
  revoked: '취소됨',
}

export interface ExceptionInfo {
  status: ExceptionStatus
  /** 가리기는 유지하고 표시만 하는 재검토 신호 */
  reviewReasons: string[]
  /** 지금 이 예외가 가리고 있는 대상 키. 목적지 전체 예외는 가린 위협 ID */
  matchedSubjectKeys: string[]
  /** 지금 지문이 같은 Finding */
  findingId?: string
}

export interface FindingView {
  /** 화면에 넘길 Finding. 가렸으면 status = accepted 인 사본 */
  finding: FindingV2
  original: FindingV2
  state: 'open' | 'excepted'
  /** 이 Finding 에 지금 걸린 예외 */
  applied: ThreatException[]
}

/**
 * 예외 수. active, expiringSoon, review, unmatched 는 결정(한 번에 등록한 묶음) 단위로 센다.
 * 전에는 기록 단위라, 17명을 한 번에 가린 결정 둘이 「적용 중 34」, 「재검토 필요 17건」으로 부풀었다.
 */
export interface ExceptionSummary {
  active: number
  expiringSoon: number
  review: number
  unmatched: number
  /** 적용 중인 기록 수 (가린 대상 수) */
  activeRecords: number
  exceptedFindings: number
}

export interface ExceptionResult {
  visibleFindings: FindingV2[]
  views: FindingView[]
  viewsById: Map<string, FindingView>
  info: Map<string, ExceptionInfo>
  summary: ExceptionSummary
}

export function fingerprintOf(finding: FindingV2): string {
  return finding.fingerprint ?? `${finding.ruleId}|finding=${finding.id}`
}

export function isExceptionActive(exc: ThreatException, now: Date): boolean {
  if (exc.revokedAt) return false
  return exc.expiresAt === null || new Date(exc.expiresAt).getTime() > now.getTime()
}

function checkStates(finding: FindingV2): Record<string, string> {
  return Object.fromEntries((finding.checks ?? []).map(c => [c.id, c.state]))
}

export function applyExceptions(findings: FindingV2[], exceptions: ThreatException[], now: Date): ExceptionResult {
  const info = new Map<string, ExceptionInfo>()
  const matched = new Map<string, Set<string>>()
  const matchedFinding = new Map<string, string>()

  /* 지문 하나에 걸린 예외와 목적지 하나에 걸린 예외를 한 번만 모은다. 위협마다 예외 전체를 훑지 않는다 */
  const byFingerprint = new Map<string, ThreatException[]>()
  const byDestination = new Map<string, ThreatException[]>()
  const push = (map: Map<string, ThreatException[]>, key: string, exc: ThreatException) => {
    const list = map.get(key)
    if (list) list.push(exc)
    else map.set(key, [exc])
  }
  for (const exc of exceptions) {
    if (exc.scope === 'destination') {
      if (exc.subjectKey) push(byDestination, exc.subjectKey, exc)
    } else push(byFingerprint, exc.fingerprint, exc)
  }
  const activeDestination = new Map<string, ThreatException[]>()
  for (const [key, items] of byDestination) {
    const live = items.filter(exc => isExceptionActive(exc, now))
    if (live.length) activeDestination.set(key, live)
  }
  /* 목적지가 위협에 있지만 다른 유형이나 예외 아닌 목적지가 섞여 가리지 못한 목적지 예외 */
  const mixedDestination = new Set<string>()
  const views: FindingView[] = []

  for (const finding of findings) {
    const fp = fingerprintOf(finding)
    const own = byFingerprint.get(fp) ?? []
    const mine = own.filter(exc => isExceptionActive(exc, now))
    for (const exc of own) matchedFinding.set(exc.id, finding.id)
    const whole = mine.filter(exc => exc.scope === 'finding')

    // 목적지 전체: 위협의 모든 사람이 데이터 반출만 얻고, 그 목적지가 모두 예외면 위협 전체를 가린다
    const exfilKeys = activeDestination.size ? exfilOnlyDestinationKeys(finding) : null
    const byDest = exfilKeys && exfilKeys.every(key => activeDestination.has(key)) ? exfilKeys.flatMap(key => activeDestination.get(key)!) : []
    if (activeDestination.size && byDest.length === 0) {
      for (const key of destinationKeysOf(finding)) for (const exc of activeDestination.get(key) ?? []) mixedDestination.add(exc.id)
    }

    const applied = [...whole, ...byDest]
    for (const exc of whole) matched.set(exc.id, new Set())
    for (const exc of byDest) {
      if (!matched.has(exc.id)) matched.set(exc.id, new Set())
      matched.get(exc.id)!.add(finding.id)
      if (!matchedFinding.has(exc.id)) matchedFinding.set(exc.id, finding.id)
    }

    const state: FindingView['state'] = applied.length > 0 ? 'excepted' : 'open'

    views.push({
      finding: state === 'excepted' ? { ...finding, status: 'accepted' } : finding,
      original: finding,
      state,
      applied,
    })
  }

  const viewsById = new Map(views.map(v => [v.original.id, v]))

  for (const exc of exceptions) {
    // 목적지 전체는 등록한 위협이 지금 있으면 그 위협과 견준다. 없으면 지금 가린 첫 위협
    const findingId = exc.scope === 'destination' && viewsById.has(exc.snapshot.findingId) ? exc.snapshot.findingId : matchedFinding.get(exc.id)
    const view = findingId ? viewsById.get(findingId) : undefined
    const keys = [...(matched.get(exc.id) ?? [])]
    let status: ExceptionStatus
    if (exc.revokedAt) status = 'revoked'
    else if (!isExceptionActive(exc, now)) status = 'expired'
    else if (keys.length > 0 || (exc.scope === 'finding' && view) || mixedDestination.has(exc.id)) status = 'active'
    else status = 'unmatched'

    const reviewReasons: string[] = []
    if (status === 'active') {
      if (exc.expiresAt) {
        const days = daysUntil(exc.expiresAt, now)
        if (days <= REVIEW_EXPIRY_DAYS) reviewReasons.push(`만료 ${days}일 전.`)
      }
      if (mixedDestination.has(exc.id)) reviewReasons.push('이 목적지로 가는 위협 가운데 다른 유형이나 다른 목적지가 섞인 위협은 계속 탐지 중.')
      // 목적지 전체는 등록한 위협 하나와 견주지 않는다. 가리는 위협이 그때그때 다르다
      if (view && exc.scope !== 'destination') {
        const current = view.original
        if (SEVERITY_RANK[current.severity] > SEVERITY_RANK[exc.snapshot.severity]) {
          reviewReasons.push(`규칙 심각도가 ${exc.snapshot.severity.toUpperCase()}에서 ${current.severity.toUpperCase()}로 상승.`)
        }
        const states = checkStates(current)
        const firmed = Object.entries(exc.snapshot.checkStates).filter(([id, was]) => was === 'inferred' && states[id] === 'confirmed')
        if (firmed.length > 0) {
          reviewReasons.push(
            `등록 당시 추정이던 판정 근거 ${firmed.length}개가 확인으로 바뀜${exc.reasonCategory === 'false_positive' ? ', 오탐 사유의 전제가 무너졌을 수 있음' : ''}.`
          )
        }
      }
    }
    info.set(exc.id, { status, reviewReasons, matchedSubjectKeys: keys, findingId })
  }

  const activeKeys = new Set<string>()
  const soon = new Set<string>()
  const review = new Set<string>()
  const unmatched = new Set<string>()
  let activeRecords = 0
  for (const exc of exceptions) {
    const i = info.get(exc.id)!
    const key = decisionKeyOf(exc)
    if (i.status === 'active') {
      activeKeys.add(key)
      activeRecords += 1
      if (exc.expiresAt && daysUntil(exc.expiresAt, now) <= EXPIRING_SOON_DAYS) soon.add(key)
    }
    if (i.status === 'unmatched') unmatched.add(key)
    if (i.reviewReasons.length > 0) review.add(key)
  }
  const summary: ExceptionSummary = {
    active: activeKeys.size,
    expiringSoon: soon.size,
    review: review.size,
    unmatched: unmatched.size,
    activeRecords,
    exceptedFindings: views.filter(v => v.state === 'excepted').length,
  }

  return {
    visibleFindings: views.filter(v => v.state !== 'excepted').map(v => v.finding),
    views,
    viewsById,
    info,
    summary,
  }
}
