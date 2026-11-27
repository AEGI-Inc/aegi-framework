import type { FindingV2 } from '../model/findingV2'
import { MAX_PATTERN_PERSONS, MAX_REASON_LENGTH, type FalsePositivePattern, type ThreatException } from '../model/exception'
import { fingerprintOf, type FindingView } from './applyExceptions'

/**
 * 오탐 판정 재사용 (docs/AEGI_THREAT_EXCEPTION_PLAN_V1.md 6.7).
 *
 * 사람이 「오탐」으로 예외를 건 위협의 원인 후보(연동 지점, 경로 모양, 모름이나 추정 근거, 사람)를 저장해 두고,
 * 아직 열린 위협 가운데 같은 원인을 공유하는 것에 「오탐 가능성」을 표시한다. 가리지는 않는다. 사람이 확인하고 예외를 건다.
 *
 * 비슷함은 점수 하나가 아니라 강한 순서의 단계로 가른다. 단계마다 「왜 비슷한지」를 문장으로 보일 수 있어야 해서다.
 *   same-threat  연동 지점, 대상, 유형이 같다. 지문만 바뀐 같은 위협
 *   same-point   연동 지점, 경로 간선 순서, 유형이 같고 대상만 다르다. 같은 자동화의 과대 추정이 대상마다 따로 뜬 경우
 *   same-person  원래 오탐에 같은 사람 연결 약함/없음 근거가 있고, 새 위협이 같은 사람과 같은 근거를 갖는다
 *   same-pattern 연동 지점 종류, 간선 순서, 대상 종류, 유형이 같다. 원래 오탐에 모름이나 추정 근거가 있을 때만
 *
 * 놓침을 막는 규칙(표시하지 않음):
 *   - 유형이 다르다
 *   - 원래 오탐은 「발생 가능」인데 새 위협은 로그로 「발생」이 확인됐다
 *   - 전제 검사: 원래 오탐의 모름, 추정 근거가 새 위협에 모두 있지 않다(새 위협은 그 부분을 확인했다)
 *   - 반대 증거: 같은 단계로 맞는 위협을 사람이 실제 위협으로 처리 중이거나 처리했다 → 「판단 엇갈림」
 *   - 취소된 오탐 예외는 쓰지 않는다. 만료된 것은 사람 판단이 그대로라 쓴다
 */

export type FalsePositiveMatchLevel = 'same-threat' | 'same-point' | 'same-person' | 'same-pattern'

export const MATCH_LEVEL_ORDER: FalsePositiveMatchLevel[] = ['same-threat', 'same-point', 'same-person', 'same-pattern']

export const MATCH_LEVEL_LABELS: Record<FalsePositiveMatchLevel, string> = {
  'same-threat': '같은 위협',
  'same-point': '같은 연동 지점',
  'same-person': '같은 사람, 같은 약한 연결',
  'same-pattern': '같은 판정 패턴',
}

/** 같은 사람 계정 연결 근거(findings/threatV2.ts REASON 의 label) */
const IDENTITY_REASONS = new Set(['같은 사람 계정 연결이 약함', '같은 사람 계정 연결 없음'])

export interface FalsePositiveMatch {
  exception: ThreatException
  level: FalsePositiveMatchLevel
  /** 왜 비슷한지. 상세에 그대로 보인다 */
  because: string
}

export interface FalsePositiveHint {
  /** likely: 1, 2단계 / possible: 3, 4단계 / contested: 같은 단계로 실제 위협 처리한 건이 있음 */
  strength: 'likely' | 'possible' | 'contested'
  /** 가장 강한 단계부터. 같은 단계면 최근 예외부터 */
  matches: FalsePositiveMatch[]
  /** contested 일 때 실제 위협으로 처리한 위협 ID */
  counterFindingIds: string[]
}

/** 실제 위협으로 다룬 처리 상태. 진행 중, 완료 */
export type RealHandlingState = 'doing' | 'done'

/** 키에서 종류: im:gws:Project:… → gws:Project, mail:…, outside:… 같은 가상 노드는 앞 칸 */
export function keyKind(key: string): string {
  const parts = key.split(':')
  if (parts[0] === 'im' && parts.length >= 3) return `${parts[1]}:${parts[2]}`
  return parts[0] ?? key
}

/** 오탐으로 등록할 때 저장할 원인 후보. 경로가 없는 옛 판정은 저장하지 않는다 */
export function falsePositivePatternOf(finding: FindingV2): FalsePositivePattern | undefined {
  const path = finding.threatPath
  if (!path || !finding.primaryType) return undefined
  const checks = finding.checks ?? []
  return {
    point: path.point,
    target: path.target,
    primaryType: finding.primaryType,
    hopKinds: path.hops.map(h => h.kind),
    reasons: checks.map(c => c.label),
    uncertain: checks.filter(c => c.state !== 'confirmed').map(c => c.label),
    persons: (finding.threatSubjects ?? []).map(s => s.person).filter(p => p !== '@everyone').slice(0, MAX_PATTERN_PERSONS),
    occurrence: finding.occurrence ?? '발생 가능',
    certainty: finding.threatCertainty ?? '확정',
  }
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i])

/**
 * 오탐 하나(pattern)와 위협 하나를 견준다. 맞으면 가장 강한 단계, 아니면 null.
 */
export function matchFalsePositive(pattern: FalsePositivePattern, finding: FindingV2): { level: FalsePositiveMatchLevel; because: string } | null {
  const now = falsePositivePatternOf(finding)
  if (!now) return null
  if (now.primaryType !== pattern.primaryType) return null
  if (pattern.occurrence === '발생 가능' && now.occurrence === '발생') return null
  // 전제 검사: 원래 오탐이 기대던 모름, 추정 근거가 새 위협에도 모두 남아 있어야 한다
  const nowUncertain = new Set(now.uncertain)
  if (!pattern.uncertain.every(r => nowUncertain.has(r))) return null

  const sameHops = sameList(now.hopKinds, pattern.hopKinds)
  if (now.point === pattern.point && now.target === pattern.target) {
    return { level: 'same-threat', because: '연동 지점과 대상, 유형이 같음' }
  }
  if (now.point === pattern.point && sameHops) {
    return { level: 'same-point', because: '같은 연동 지점에서 같은 경로로 대상만 다름' }
  }
  const identity = pattern.uncertain.filter(r => IDENTITY_REASONS.has(r))
  if (identity.length > 0) {
    const persons = new Set(pattern.persons)
    if (now.persons.some(p => persons.has(p))) {
      return { level: 'same-person', because: `같은 사람이 들어 있고 근거 「${identity.join(', ')}」가 같음` }
    }
  }
  if (
    pattern.uncertain.length > 0 &&
    sameHops &&
    keyKind(now.point) === keyKind(pattern.point) &&
    keyKind(now.target) === keyKind(pattern.target)
  ) {
    return { level: 'same-pattern', because: `연동 지점 종류, 경로, 대상 종류가 같고 근거 「${pattern.uncertain.join(', ')}」가 같음` }
  }
  return null
}

const rank = (level: FalsePositiveMatchLevel) => MATCH_LEVEL_ORDER.indexOf(level)

/** 오탐 예외에서 원인 후보. 저장된 것이 없는 옛 기록은 지금 같은 지문의 위협에서 만든다 */
function patternsOf(exceptions: readonly ThreatException[], findingsByFingerprint: Map<string, FindingV2>) {
  const out: { exception: ThreatException; pattern: FalsePositivePattern }[] = []
  for (const exc of exceptions) {
    if (exc.reasonCategory !== 'false_positive' || exc.revokedAt) continue
    const pattern = exc.snapshot.pattern ?? (findingsByFingerprint.has(exc.fingerprint) ? falsePositivePatternOf(findingsByFingerprint.get(exc.fingerprint)!) : undefined)
    if (pattern) out.push({ exception: exc, pattern })
  }
  return out
}

/**
 * 열린 위협마다 오탐 가능성. 예외로 가려진 위협과 원래 오탐 자신은 뺀다.
 * handlingOf 는 지문으로 처리 상태를 돌려준다(진행 중, 완료면 사람이 실제 위협으로 본 것).
 */
export function falsePositiveHints(
  views: readonly FindingView[],
  exceptions: readonly ThreatException[],
  handlingOf: (fingerprint: string) => string | undefined,
): Map<string, FalsePositiveHint> {
  const byFingerprint = new Map(views.map(v => [fingerprintOf(v.original), v.original]))
  const patterns = patternsOf(exceptions, byFingerprint)
  const hints = new Map<string, FalsePositiveHint>()
  if (patterns.length === 0) return hints

  const isReal = (f: FindingV2) => {
    const state = handlingOf(fingerprintOf(f))
    return state === 'doing' || state === 'done'
  }
  /* 오탐 하나마다, 사람이 실제 위협으로 처리한 위협과 맞는 가장 강한 단계. 그 단계 이하로 맞는 위협은 판단이 엇갈린다 */
  const counter = new Map<string, { level: FalsePositiveMatchLevel; ids: string[] }[]>()
  for (const v of views) {
    if (!isReal(v.original)) continue
    for (const { exception, pattern } of patterns) {
      if (fingerprintOf(v.original) === exception.fingerprint) continue
      const m = matchFalsePositive(pattern, v.original)
      if (!m) continue
      const list = counter.get(exception.id) ?? []
      list.push({ level: m.level, ids: [v.original.id] })
      counter.set(exception.id, list)
    }
  }

  for (const v of views) {
    if (v.state === 'excepted' || isReal(v.original)) continue
    const fp = fingerprintOf(v.original)
    const matches: FalsePositiveMatch[] = []
    const counterIds = new Set<string>()
    for (const { exception, pattern } of patterns) {
      if (exception.fingerprint === fp) continue
      const m = matchFalsePositive(pattern, v.original)
      if (!m) continue
      // 반대 증거는 같은 단계이거나 더 강한 단계로 맞을 때만 센다. 같은 연동 지점 오탐을 패턴 수준 반례로 뒤집지 않는다
      for (const c of counter.get(exception.id) ?? []) if (rank(c.level) <= rank(m.level)) c.ids.forEach(id => counterIds.add(id))
      matches.push({ exception, level: m.level, because: m.because })
    }
    if (matches.length === 0) continue
    matches.sort((a, b) => rank(a.level) - rank(b.level) || b.exception.createdAt.localeCompare(a.exception.createdAt))
    const best = matches[0].level
    const strength: FalsePositiveHint['strength'] = counterIds.size > 0 ? 'contested' : best === 'same-threat' || best === 'same-point' ? 'likely' : 'possible'
    hints.set(v.original.id, { strength, matches, counterFindingIds: [...counterIds] })
  }
  return hints
}

export const HINT_LABELS: Record<FalsePositiveHint['strength'], string> = {
  likely: '오탐 가능성 높음',
  possible: '오탐 가능성',
  contested: '오탐 판단 엇갈림',
}

/** 「같은 사유로 예외」 창에 처음 채울 값. 사람이 고치고 확인한 뒤 등록한다 */
export function likeExceptionDraft(exception: ThreatException): { reasonCategory: 'false_positive'; reason: string; reference?: string } {
  const reason = `${exception.id}와 같은 원인의 오탐. ${exception.reason}`
  return { reasonCategory: 'false_positive', reason: reason.slice(0, MAX_REASON_LENGTH), ...(exception.reference ? { reference: exception.reference } : {}) }
}
