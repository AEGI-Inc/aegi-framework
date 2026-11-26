import { useEffect, useRef, useState } from 'react'
import { ShieldOff, X } from 'lucide-react'
import {
  CE_DEFAULT_EXPIRY_DAYS,
  CE_MAX_EXPIRY_DAYS,
  COMPLIANCE_EXCEPTION_REASON_LABEL,
  COMPLIANCE_EXCEPTION_REASONS,
  COMPLIANCE_EXCEPTION_SCOPE_LABEL,
  MAX_CE_ACTOR,
  MAX_CE_REASON,
  MAX_CE_REFERENCE,
  MIN_CE_REASON,
  complianceExceptionChangeProblem,
  type ComplianceException,
  type ComplianceExceptionChange,
  type ComplianceExceptionReason,
  type ComplianceExceptionScope,
} from '../model/complianceException'
import { addDays } from '../model/exception'
import { loadActor, saveActor } from '../exceptions/store'
import { isActiveException } from './exceptionStatus'

function dateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toExpiryIso(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(`${dateStr}T23:59:59`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

export interface ComplianceExceptionDialogProps {
  scope: ComplianceExceptionScope
  target: string
  label: string
  failFindings: string[]
  existing?: ComplianceException
  linkedCount?: number
  onSubmit: (change: ComplianceExceptionChange) => Promise<boolean>
  onClose: () => void
}

export default function ComplianceExceptionDialog({
  scope,
  target,
  label,
  failFindings,
  existing,
  linkedCount,
  onSubmit,
  onClose,
}: ComplianceExceptionDialogProps) {
  const [now] = useState(() => new Date())
  const active = existing ? isActiveException(existing, now) : false
  const [reasonCategory, setReasonCategory] = useState<ComplianceExceptionReason>(
    active && existing ? existing.reasonCategory : 'compensating_control',
  )
  const [reason, setReason] = useState(active && existing ? existing.reason : '')
  const [reference, setReference] = useState(active && existing ? (existing.reference ?? '') : '')
  const [expiryDate, setExpiryDate] = useState(() =>
    active && existing
      ? dateInputValue(new Date(existing.expiresAt))
      : dateInputValue(addDays(now, CE_DEFAULT_EXPIRY_DAYS)),
  )
  const [actor, setActor] = useState(loadActor)
  const [busy, setBusy] = useState(false)
  // 오류 문장은 등록을 한 번 누른 뒤에 보인다(위협 예외 입력 창과 같다)
  const [touched, setTouched] = useState(false)
  const firstField = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    firstField.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const change: ComplianceExceptionChange = {
    scope,
    target,
    label,
    reasonCategory,
    reason,
    ...(reference.trim() ? { reference: reference.trim() } : {}),
    expiresAt: toExpiryIso(expiryDate),
    failFindings: scope === 'check' ? [target] : failFindings,
    actor,
    ...(existing ? { expectedUpdatedAt: existing.updatedAt } : {}),
  }
  const problem = complianceExceptionChangeProblem(change, now)

  const handleSubmit = async () => {
    setTouched(true)
    if (problem || busy) return
    setBusy(true)
    const ok = await onSubmit(change)
    setBusy(false)
    if (ok) {
      saveActor(actor.trim())
      onClose()
    }
  }

  return (
    <div className="ex-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="ex-dialog" role="dialog" aria-modal="true" aria-labelledby="comp-ex-dialog-title">
        <header className="ex-dialog-head">
          <span className="ex-dialog-icon" aria-hidden="true"><ShieldOff size={16} strokeWidth={2} /></span>
          <div className="ex-dialog-title">
            <h2 id="comp-ex-dialog-title">{active ? '컴플라이언스 예외 수정' : '컴플라이언스 예외 처리'}</h2>
            <p>{COMPLIANCE_EXCEPTION_SCOPE_LABEL[scope]} | {label}</p>
            {scope === 'check' && linkedCount !== undefined && (
              <p>이 점검이 이어진 항목 {linkedCount}개에 함께 적용</p>
            )}
          </div>
          <button type="button" className="ex-icon-btn" aria-label="닫기" onClick={onClose}>
            <X size={16} strokeWidth={2} />
          </button>
        </header>

        <div className="ex-dialog-body">
          <label className="ex-field">
            <span className="ex-label">사유 분류</span>
            <select
              ref={firstField}
              className="ex-select"
              value={reasonCategory}
              onChange={event => setReasonCategory(event.target.value as ComplianceExceptionReason)}
            >
              {COMPLIANCE_EXCEPTION_REASONS.map(r => (
                <option key={r} value={r}>{COMPLIANCE_EXCEPTION_REASON_LABEL[r]}</option>
              ))}
            </select>
          </label>

          <label className="ex-field">
            <span className="ex-label">예외 처리 근거 <em>필수, {MIN_CE_REASON}자 이상</em></span>
            <textarea
              className="ex-input"
              rows={3}
              maxLength={MAX_CE_REASON}
              value={reason}
              placeholder="예: 보완 통제 내용, 위험 수용 근거, 조치 예정 일정 등"
              onChange={event => setReason(event.target.value)}
            />
          </label>

          <label className="ex-field">
            <span className="ex-label">증빙 <em>선택</em></span>
            <input
              className="ex-input"
              maxLength={MAX_CE_REFERENCE}
              value={reference}
              placeholder="티켓 번호 또는 https:// 문서 주소"
              onChange={event => setReference(event.target.value)}
            />
          </label>

          <div className="ex-two">
            <label className="ex-field">
              <span className="ex-label">만료일 <em>필수, 최대 {CE_MAX_EXPIRY_DAYS}일</em></span>
              <input
                type="date"
                className="ex-input ex-date"
                value={expiryDate}
                min={dateInputValue(addDays(now, 1))}
                max={dateInputValue(addDays(now, CE_MAX_EXPIRY_DAYS))}
                onChange={event => setExpiryDate(event.target.value)}
              />
            </label>
            <label className="ex-field">
              <span className="ex-label">예외 처리자 <em>필수</em></span>
              <input
                className="ex-input"
                maxLength={MAX_CE_ACTOR}
                value={actor}
                placeholder="이름"
                onChange={event => setActor(event.target.value)}
              />
            </label>
          </div>

          {touched && problem && <p className="ex-errors" role="alert">{problem}</p>}
        </div>

        <footer className="ex-dialog-foot">
          <button type="button" className="ex-btn" onClick={onClose}>취소</button>
          <button type="button" className="ex-btn primary" disabled={(touched && Boolean(problem)) || busy} onClick={() => void handleSubmit()}>
            {active ? '수정' : '등록'}
          </button>
        </footer>
      </section>
    </div>
  )
}
