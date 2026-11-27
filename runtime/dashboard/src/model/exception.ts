import type { TagKey } from '../findings/scenarioTags'
import type { FindingCheck, FindingV2 } from './findingV2'

/**
 * 위협 예외 (docs/spec/AEGI_THREAT_EXCEPTION_PLAN_V1.md).
 *
 * 보안 담당자가 탐지된 위협을 "운영상 의도된 상황"으로 판단해 사유와 함께 가린 기록이다.
 * 탐지 엔진은 그대로 돌고, 화면에 넘기기 직전에 applyExceptions 가 거른다.
 * 취소해도 지우지 않고 revokedAt 을 채워 이력으로 남긴다.
 */

/** 데이터셋 이름. datasetBootstrap 의 DatasetKind 와 같은 값이다 (모델이 부트스트랩을 import 하지 않도록 따로 둔다). */
export type ExceptionDataset = 'synthetic' | 'measured' | 'measured-v2' | 'measured-im'

/**
 * 예외 범위
 * - occurrence: 이번 발생. 대상의 증적이 새로 생기면 다시 뜬다
 * - subject: 선택한 위반 대상. 같은 구성에서 이 사람은 더 뜨지 않는다
 * - finding: 위협 전체. 앞으로 생기는 대상까지 가린다 (만료 필수)
 * - destination: 목적지 전체. 이 조직 밖 목적지로 가는 데이터 반출 위협을 모두 가린다 (만료 필수).
 *   subjectKey 는 목적지 키(findings/outsideDestinations.ts destinationKeysOf), subjectLabel 은 목적지 이름이다
 */
export type ExceptionScope = 'occurrence' | 'subject' | 'finding' | 'destination'

export type ExceptionReasonCategory =
  | 'business_justified'
  | 'compensating_control'
  | 'false_positive'
  | 'risk_accepted'
  | 'test_environment'

export type ExceptionAction = 'created' | 'extended' | 'edited' | 'revoked' | 'reapplied'

export interface ExceptionHistoryEntry {
  at: string
  action: ExceptionAction
  actor?: string
  note?: string
}

export interface ThreatException {
  id: string
  dataset: ExceptionDataset
  scope: ExceptionScope
  ruleId: string
  /**
   * 분류 키. 위협 판정 V2 위협은 큰 분류 키(findings/scenarioTags.ts ThreatGroupKey), 옛 범용 판정은 분류(escalation 등).
   * 저장된 기록(D1 scenario_key 칸)과 맞추려 이름은 그대로 둔다. 분류가 없는 옛 키는 화면에 「기타」로 보인다
   */
  scenarioKey: TagKey
  fingerprint: string
  /** scope 가 subject, occurrence 이면 사람, destination 이면 조직 밖 목적지 키 */
  subjectKey?: string
  subjectAccountKeys?: string[]
  subjectLabel?: string
  /** scope 가 occurrence 일 때: 예외 당시 대상의 증적 */
  observationIds?: string[]
  reasonCategory: ExceptionReasonCategory
  reason: string
  reference?: string
  actor: string
  /** 승인자. 위험 수용, 위협 전체, 목적지 전체 예외는 필수이고 처리자와 다른 사람이어야 한다 (approverProblem) */
  approver?: string
  /** 한 번에 등록한 묶음(결정). 등록 창에서 여러 대상을 고르면 같은 값이다. 없는 옛 기록은 decisionKeyOf 가 묶는다 */
  decisionId?: string
  createdAt: string
  /** null = 무기한 */
  expiresAt: string | null
  revokedAt?: string
  revokedBy?: string
  revokeReason?: string
  /** 서버(D1)에 저장된 예외만: 마지막으로 바뀐 시각. 두 사람이 같은 예외를 동시에 고치면 늦은 쪽을 거절하는 데 쓴다 */
  updatedAt?: string
  /** 등록 당시 모습 — 재검토 신호와 이력 표시용 */
  snapshot: {
    findingId: string
    title: string
    severity: FindingV2['severity']
    subjectKeys: string[]
    checkStates: Record<string, FindingCheck['state']>
    /** 오탐 판정 재사용(exceptions/falsePositiveHints.ts)에 쓰는 원인 후보. 경로가 없는 옛 판정과 옛 기록은 없다 */
    pattern?: FalsePositivePattern
  }
  history: ExceptionHistoryEntry[]
}

/**
 * 예외 등록 당시 위협의 원인 후보. 지문이 바뀌어도 비슷한 위협을 찾을 수 있게 지문과 따로 둔다.
 * D1 에는 detail JSON 의 snapshot 안에 들어가 마이그레이션이 없다.
 */
export interface FalsePositivePattern {
  /** 연동 지점과 대상 키(엔진 계약 point, target) */
  point: string
  target: string
  primaryType: string
  /** 경로 간선 종류 순서 */
  hopKinds: string[]
  /** 판정 근거 이름 전부와 그 가운데 확인이 아닌 것(모름, 추정) */
  reasons: string[]
  uncertain: string[]
  /** 새로 권한이 생기는 사람(누구나 뺌). 많으면 앞 MAX_PATTERN_PERSONS 명 */
  persons: string[]
  occurrence: '발생 가능' | '발생'
  certainty: '확정' | '미확정'
}

export const MAX_PATTERN_PERSONS = 200

export const SCOPE_LABELS: Record<ExceptionScope, string> = {
  occurrence: '이번 발생',
  subject: '선택 대상',
  finding: '위협 전체',
  destination: '목적지 전체',
}

export const SCOPE_HINTS: Record<ExceptionScope, string> = {
  occurrence: '이 대상에게 새 증적이 생기면 다시 탐지',
  subject: '같은 구성에서 이 대상만 위협 표시 제외, 다른 대상은 계속 탐지',
  finding: '앞으로 이 구성에 새로 들어오는 대상까지 제외, 만료일 필수',
  destination: '이 조직 밖 목적지로 가는 데이터 반출 위협 모두 제외, 만료일 필수',
}

export const REASON_LABELS: Record<ExceptionReasonCategory, string> = {
  business_justified: '업무상 필요',
  compensating_control: '보완 통제',
  false_positive: '오탐',
  risk_accepted: '위험 수용',
  test_environment: '테스트, 데모 환경',
}

export const REASON_HINTS: Record<ExceptionReasonCategory, string> = {
  business_justified: '조직의 업무 방식상 의도된 권한, 흐름',
  compensating_control: '리뷰, 승인 절차 같은 다른 통제가 위험을 차단',
  false_positive: '데이터나 동일인 연결 오류로 위협이 아닌데 탐지됨, 규칙 개선 근거로 수집',
  risk_accepted: '위험을 알고 수용, 정해진 날짜까지 조치, 만료일 필수',
  test_environment: '테스트, 데모용 계정이나 리소스',
}

/** 기본 만료 기간(일) */
export const DEFAULT_EXPIRY_DAYS = 90
/** 무기한을 막는 경우의 최대 기간(일) */
export const MAX_RESTRICTED_EXPIRY_DAYS = 180
/** 사유 최소 글자 수 */
export const MIN_REASON_LENGTH = 10
/** 만료 임박으로 볼 기간(일) */
export const EXPIRING_SOON_DAYS = 30
/** 재검토 신호를 낼 만료 임박 기간(일) */
export const REVIEW_EXPIRY_DAYS = 7

/** 위협 하나보다 넓게 가리는 범위. 무기한을 막고 승인자를 받는다 */
export const isWideScope = (scope: ExceptionScope): boolean => scope === 'finding' || scope === 'destination'

/** 위험 수용, 위협 전체, 목적지 전체 예외는 무기한을 막고 최대 180일까지 둔다. */
export function expiryRestricted(scope: ExceptionScope, reason: ExceptionReasonCategory): boolean {
  return isWideScope(scope) || reason === 'risk_accepted'
}

/** 기간 제한 문구에 쓰는 이름 */
export const RESTRICTED_NAMES = '위험 수용, 위협 전체, 목적지 전체 예외'

const DAY = 24 * 60 * 60 * 1000

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY)
}

/** 만료 값 검사. 문제가 없으면 null */
export function validateExpiry(
  expiresAt: string | null,
  scope: ExceptionScope,
  reason: ExceptionReasonCategory,
  now: Date
): string | null {
  const restricted = expiryRestricted(scope, reason)
  if (expiresAt === null) return restricted ? `${RESTRICTED_NAMES}는 무기한 불가` : null
  const at = new Date(expiresAt)
  if (Number.isNaN(at.getTime())) return '만료일 형식 오류'
  if (at.getTime() <= now.getTime()) return '만료일은 오늘 이후만 가능'
  if (restricted && at.getTime() > addDays(now, MAX_RESTRICTED_EXPIRY_DAYS).getTime() + DAY) {
    return `${RESTRICTED_NAMES}는 최대 ${MAX_RESTRICTED_EXPIRY_DAYS}일`
  }
  return null
}

export function daysUntil(iso: string, now: Date): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY)
}

export const EXCEPTION_DATASETS: ExceptionDataset[] = ['synthetic', 'measured', 'measured-v2']
export const EXCEPTION_SCOPES: ExceptionScope[] = ['occurrence', 'subject', 'finding', 'destination']
export const REASON_CATEGORIES = Object.keys(REASON_LABELS) as ExceptionReasonCategory[]
export const MAX_REASON_LENGTH = 2000
export const MAX_REFERENCE_LENGTH = 500
export const MAX_ACTOR_LENGTH = 80

const isStr = (v: unknown): v is string => typeof v === 'string'
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr)
const isIso = (v: unknown): v is string => isStr(v) && !Number.isNaN(new Date(v).getTime())

/**
 * 예외 레코드 모양 검사. 브라우저(가져오기·저장소 읽기)와 서버(D1 API)가 같이 쓴다.
 * 문제가 없으면 null, 있으면 무엇이 틀렸는지 한 줄.
 */
export function exceptionProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object') return '객체가 아님'
  const v = value as Record<string, unknown>
  if (!isStr(v.id) || !/^EXC-[A-Z0-9]{4,32}$/.test(v.id)) return 'id 형식'
  if (!EXCEPTION_DATASETS.includes(v.dataset as ExceptionDataset)) return 'dataset'
  if (!EXCEPTION_SCOPES.includes(v.scope as ExceptionScope)) return 'scope'
  if (!isStr(v.ruleId) || !v.ruleId) return 'ruleId'
  if (!isStr(v.scenarioKey) || !/^([A-Z]|[a-z][a-z_]{2,29})$/.test(v.scenarioKey)) return 'scenarioKey'
  if (!isStr(v.fingerprint) || !v.fingerprint || v.fingerprint.length > 1000) return 'fingerprint'
  if (v.scope !== 'finding' && (!isStr(v.subjectKey) || !v.subjectKey)) return 'subjectKey'
  if (v.subjectAccountKeys !== undefined && !isStrArray(v.subjectAccountKeys)) return 'subjectAccountKeys'
  if (v.observationIds !== undefined && !isStrArray(v.observationIds)) return 'observationIds'
  if (!REASON_CATEGORIES.includes(v.reasonCategory as ExceptionReasonCategory)) return 'reasonCategory'
  if (!isStr(v.reason) || v.reason.trim().length < MIN_REASON_LENGTH || v.reason.length > MAX_REASON_LENGTH) return 'reason'
  if (v.reference !== undefined && (!isStr(v.reference) || v.reference.length > MAX_REFERENCE_LENGTH)) return 'reference'
  if (!isStr(v.actor) || !v.actor.trim() || v.actor.length > MAX_ACTOR_LENGTH) return 'actor'
  if (v.approver !== undefined && (!isStr(v.approver) || v.approver.length > MAX_ACTOR_LENGTH)) return 'approver'
  if (v.decisionId !== undefined && (!isStr(v.decisionId) || !/^DEC-[A-Z0-9]{4,32}$/.test(v.decisionId))) return 'decisionId'
  if (!isIso(v.createdAt)) return 'createdAt'
  if (v.expiresAt !== null && !isIso(v.expiresAt)) return 'expiresAt'
  if (v.revokedAt !== undefined && !isIso(v.revokedAt)) return 'revokedAt'
  const snap = v.snapshot as Record<string, unknown> | undefined
  if (!snap || typeof snap !== 'object' || !isStr(snap.findingId) || !isStr(snap.title) || !isStr(snap.severity) || !isStrArray(snap.subjectKeys) || !snap.checkStates || typeof snap.checkStates !== 'object') return 'snapshot'
  if (snap.pattern !== undefined && !isPattern(snap.pattern)) return 'snapshot'
  if (!Array.isArray(v.history) || v.history.some(h => !h || typeof h !== 'object' || !isIso((h as ExceptionHistoryEntry).at) || !isStr((h as ExceptionHistoryEntry).action))) return 'history'
  return null
}

/**
 * 같은 결정으로 등록한 예외를 묶는 열쇠.
 * 결정 ID 가 없는 옛 기록은 한 번에 등록할 때 같아지는 값(구성, 등록 시각, 처리자, 사유)으로 묶는다.
 */
export function decisionKeyOf(exc: ThreatException): string {
  return exc.decisionId ?? `legacy|${exc.fingerprint}|${exc.createdAt}|${exc.actor}|${exc.reasonCategory}|${exc.reason}`
}

/** 승인자가 있어야 하는 예외: 위험 수용, 위협 전체, 목적지 전체 (위협 하나보다 넓게 가리거나 위험을 그대로 두는 결정) */
export function approverRequired(scope: ExceptionScope, reason: ExceptionReasonCategory): boolean {
  return reason === 'risk_accepted' || isWideScope(scope)
}

/**
 * 승인자 규칙. 처리자 혼자 위험을 받아들이지 않게, 필요한 예외는 다른 사람의 이름을 받는다.
 * 문제가 없으면 null. 등록 창과 서버(새 등록)가 같이 쓴다. 가져오기(옛 기록 옮기기)에는 걸지 않는다.
 */
export function approverProblem(scope: ExceptionScope, reason: ExceptionReasonCategory, actor: string, approver?: string): string | null {
  const name = approver?.trim() ?? ''
  if (!name) return approverRequired(scope, reason) ? `${RESTRICTED_NAMES}는 승인자 이름 필요` : null
  if (name === actor.trim()) return '승인자는 처리자와 다른 사람이어야 함'
  return null
}

function isPattern(value: unknown): value is FalsePositivePattern {
  const p = value as Record<string, unknown> | null
  if (!p || typeof p !== 'object') return false
  if (![p.point, p.target, p.primaryType].every(v => isStr(v) && v.length <= 1000)) return false
  if (![p.hopKinds, p.reasons, p.uncertain].every(v => isStrArray(v) && v.length <= 100)) return false
  if (!isStrArray(p.persons) || p.persons.length > MAX_PATTERN_PERSONS) return false
  return (p.occurrence === '발생 가능' || p.occurrence === '발생') && (p.certainty === '확정' || p.certainty === '미확정')
}

export function isThreatException(value: unknown): value is ThreatException {
  return exceptionProblem(value) === null
}
