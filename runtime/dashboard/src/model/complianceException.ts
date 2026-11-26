import type { ExceptionDataset } from './exception'

/**
 * 컴플라이언스 예외 (항목 또는 점검 단위).
 *
 * 확인사항 판정이 위반(fail)일 때 보완 통제, 위험 수용, 적용 제외, 조치 예정 사유와 만료일을 적어 예외로 둔다.
 * 화면은 판정을 새로 하거나 「충족」으로 바꾸지 않고, 유효한 예외가 위반 점검을 모두 덮으면 「예외」로만 보인다.
 */

export type ComplianceExceptionScope = 'item' | 'check'
export type ComplianceExceptionReason = 'compensating_control' | 'risk_accepted' | 'not_applicable' | 'planned_fix'

export const COMPLIANCE_EXCEPTION_SCOPES: ComplianceExceptionScope[] = ['item', 'check']
export const COMPLIANCE_EXCEPTION_REASONS: ComplianceExceptionReason[] = ['compensating_control', 'risk_accepted', 'not_applicable', 'planned_fix']
export const COMPLIANCE_EXCEPTION_SCOPE_LABEL: Record<ComplianceExceptionScope, string> = { item: '항목', check: '점검' }
export const COMPLIANCE_EXCEPTION_REASON_LABEL: Record<ComplianceExceptionReason, string> = {
  compensating_control: '보완 통제',
  risk_accepted: '위험 수용',
  not_applicable: '적용 제외',
  planned_fix: '조치 예정',
}

export const MAX_CE_ACTOR = 40
export const MIN_CE_REASON = 10
export const MAX_CE_REASON = 500
export const MAX_CE_REFERENCE = 200
export const CE_DEFAULT_EXPIRY_DAYS = 90
export const CE_MAX_EXPIRY_DAYS = 365
export const CE_EXPIRING_SOON_DAYS = 30

export interface ComplianceExceptionEvent {
  at: string
  actor: string
  action: 'register' | 'revoke'
  reason: string
  expiresAt?: string
}

export interface ComplianceException {
  dataset: ExceptionDataset
  /** complianceExceptionKey(scope, target) */
  id: string
  scope: ComplianceExceptionScope
  /** item: 확인사항 키(`ISMS-P:2.5.3-01`), check: 점검 id(`gws-031`) */
  target: string
  /** 화면에 적을 이름. item: `ISMS-P 2.5.3 <항목 이름>`, check: 점검 문장 */
  label: string
  reasonCategory: ComplianceExceptionReason
  reason: string
  reference?: string
  /** ISO 시각. 필수 */
  expiresAt: string
  /** 등록(마지막 수정) 당시 위반 점검 id. item 은 그 확인사항의 fail_findings, check 는 [target] */
  failFindings: string[]
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
  revokedAt?: string
  revokedBy?: string
  history: ComplianceExceptionEvent[]
}

export interface ComplianceExceptionChange {
  scope: ComplianceExceptionScope
  target: string
  label: string
  reasonCategory: ComplianceExceptionReason
  /** 등록이면 예외 처리 근거, 취소면 취소 사유 */
  reason: string
  reference?: string
  expiresAt: string
  failFindings: string[]
  actor: string
  expectedUpdatedAt?: string
  revoke?: boolean
}

export const complianceExceptionKey = (scope: ComplianceExceptionScope, target: string) => `${scope}|${target.trim()}`

/** 문제 문장에 적을 칸 이름(입력 창이 그대로 보인다) */
const FIELD_NAME = { target: '대상', label: '대상 이름', actor: '예외 처리자', reason: '예외 처리 근거' } as const

export function complianceExceptionChangeProblem(value: unknown, now: Date): string | null {
  if (!value || typeof value !== 'object') return '형식'
  const v = value as Record<string, unknown>
  if (!COMPLIANCE_EXCEPTION_SCOPES.includes(v.scope as ComplianceExceptionScope)) return 'scope'
  if (!COMPLIANCE_EXCEPTION_REASONS.includes(v.reasonCategory as ComplianceExceptionReason)) return 'reasonCategory'
  for (const key of ['target', 'label', 'actor', 'reason'] as const) {
    if (typeof v[key] !== 'string' || !(v[key] as string).trim()) return `${FIELD_NAME[key]} 없음`
  }
  const target = (v.target as string).trim()
  if (target.length > 300 || (v.label as string).trim().length > 400) return '길이'
  if ((v.actor as string).trim().length > MAX_CE_ACTOR) return '처리자 이름이 김'
  if (v.reference !== undefined && (typeof v.reference !== 'string' || v.reference.trim().length > MAX_CE_REFERENCE)) return '증빙이 김'
  if (!Array.isArray(v.failFindings) || v.failFindings.length > 200) return 'failFindings'
  for (const f of v.failFindings) {
    if (typeof f !== 'string' || f.length > 120) return 'failFindings'
  }
  if (v.expectedUpdatedAt !== undefined && typeof v.expectedUpdatedAt !== 'string') return 'expectedUpdatedAt'
  if (v.revoke !== undefined && typeof v.revoke !== 'boolean') return 'revoke'

  const reason = (v.reason as string).trim()
  if (v.revoke === true) {
    if (v.expectedUpdatedAt === undefined) return '없는 예외는 취소할 수 없음'
    if (reason.length > MAX_CE_REASON) return '사유가 김'
    return null
  }

  if (reason.length < MIN_CE_REASON) return `근거 ${MIN_CE_REASON}자 이상 필요`
  if (reason.length > MAX_CE_REASON) return '근거가 김'
  if (typeof v.expiresAt !== 'string' || !v.expiresAt.trim()) return '만료일 없음'
  const exp = new Date(v.expiresAt)
  if (Number.isNaN(exp.getTime())) return '만료일 형식'
  if (exp.getTime() <= now.getTime()) return '만료일은 미래여야 함'
  if (exp.getTime() > now.getTime() + (CE_MAX_EXPIRY_DAYS + 1) * 86_400_000) return `만료일은 최대 ${CE_MAX_EXPIRY_DAYS}일`
  if (v.scope === 'check') {
    const ff = v.failFindings as string[]
    if (ff.length !== 1 || ff[0] !== target) return '점검 예외의 위반 점검 목록이 맞지 않음'
  }
  return null
}

export function applyComplianceExceptionChange(
  previous: ComplianceException | undefined,
  change: ComplianceExceptionChange,
  dataset: ExceptionDataset,
  at: string,
): ComplianceException {
  const actor = change.actor.trim()
  const reason = change.reason.trim()
  const target = change.target.trim()
  if (change.revoke && previous) {
    return {
      ...previous,
      updatedAt: at,
      updatedBy: actor,
      revokedAt: at,
      revokedBy: actor,
      history: [...previous.history, { at, actor, action: 'revoke', reason }],
    }
  }
  const ref = change.reference?.trim()
  const expiresAt = change.expiresAt.trim()
  const failFindings = [...new Set(change.failFindings.map(f => f.trim()).filter(Boolean))].sort()
  return {
    dataset,
    id: complianceExceptionKey(change.scope, target),
    scope: change.scope,
    target,
    label: change.label.trim(),
    reasonCategory: change.reasonCategory,
    reason,
    ...(ref ? { reference: ref } : {}),
    expiresAt,
    failFindings,
    createdAt: previous?.createdAt ?? at,
    createdBy: previous?.createdBy ?? actor,
    updatedAt: at,
    updatedBy: actor,
    history: [...(previous?.history ?? []), { at, actor, action: 'register', reason, expiresAt }],
  }
}
