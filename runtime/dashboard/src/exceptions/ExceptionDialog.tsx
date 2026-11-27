import { useEffect, useMemo, useRef, useState } from 'react'
import { ShieldOff, X } from 'lucide-react'
import {
  addDays,
  approverProblem,
  approverRequired,
  DEFAULT_EXPIRY_DAYS,
  expiryRestricted,
  isWideScope,
  MAX_RESTRICTED_EXPIRY_DAYS,
  MIN_REASON_LENGTH,
  REASON_HINTS,
  REASON_LABELS,
  SCOPE_HINTS,
  RESTRICTED_NAMES,
  SCOPE_LABELS,
  validateExpiry,
  type ExceptionDataset,
  type ExceptionReasonCategory,
  type ThreatException,
} from '../model/exception'
import type { OutsideDestination } from '../findings/outsideDestinations'
import { scenarioTag, findingTagKey, tagClass } from '../findings/scenarioTags'
import { severityClass, severityLabel } from '../findings/severity'
import { applyExceptions, type FindingView } from './applyExceptions'
import { buildExceptions, type DraftScope, type ExceptionDraft } from './useExceptions'
import { loadActor } from './store'

export type ExpiryChoice = '30' | '90' | '180' | 'custom' | 'none'

/** 만료 선택 → ISO. 날짜 지정은 그날 끝(현지 23:59)까지 */
export function expiryFromChoice(choice: ExpiryChoice, customDate: string, now: Date): string | null {
  if (choice === 'none') return null
  if (choice === 'custom') {
    if (!customDate) return ''
    const at = new Date(`${customDate}T23:59:59`)
    return Number.isNaN(at.getTime()) ? '' : at.toISOString()
  }
  return addDays(now, Number(choice)).toISOString()
}

export function dateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 만료 선택 칸. 예외 처리 창과 관리 화면의 연장·다시 적용이 같이 쓴다 */
export function ExpiryPicker({
  choice,
  customDate,
  restricted,
  now,
  onChange,
}: {
  choice: ExpiryChoice
  customDate: string
  restricted: boolean
  now: Date
  onChange: (choice: ExpiryChoice, customDate: string) => void
}) {
  const options: Array<[ExpiryChoice, string]> = [
    ['30', '30일'],
    ['90', `${DEFAULT_EXPIRY_DAYS}일`],
    ['180', '180일'],
    ['custom', '날짜 지정'],
    ['none', '무기한'],
  ]
  return (
    <div className="ex-expiry">
      <div className="ex-segment" role="radiogroup" aria-label="만료">
        {options.map(([value, label]) => (
          <button
            type="button"
            key={value}
            role="radio"
            aria-checked={choice === value}
            className={choice === value ? 'on' : ''}
            disabled={value === 'none' && restricted}
            title={value === 'none' && restricted ? `${RESTRICTED_NAMES}는 무기한 불가` : undefined}
            onClick={() => onChange(value, customDate || dateInputValue(addDays(now, DEFAULT_EXPIRY_DAYS)))}
          >
            {label}
          </button>
        ))}
      </div>
      {choice === 'custom' && (
        <input
          type="date"
          className="ex-input ex-date"
          aria-label="만료일"
          value={customDate}
          min={dateInputValue(addDays(now, 1))}
          max={restricted ? dateInputValue(addDays(now, MAX_RESTRICTED_EXPIRY_DAYS)) : undefined}
          onChange={event => onChange('custom', event.target.value)}
        />
      )}
      {restricted && <small className="ex-field-hint">{RESTRICTED_NAMES}는 최대 {MAX_RESTRICTED_EXPIRY_DAYS}일</small>}
    </div>
  )
}

export interface ExceptionDialogProps {
  view: FindingView
  dataset: ExceptionDataset
  now: Date
  onCancel: () => void
  onSubmit: (draft: ExceptionDraft) => void
  /** 이 위협이 닿는 조직 밖 목적지. 있으면 범위 「목적지 전체」를 둔다 */
  destinations?: OutsideDestination[]
  /** 이 예외를 더하면 새로 가려지는 위협 수. 목적지 전체는 다른 위협까지 가리므로 전체 위협으로 센다 */
  countHidden?: (drafts: ThreatException[]) => number
  /** 처음 채울 사유. 「같은 사유로 예외」가 전 오탐 예외의 사유를 넘긴다 */
  initial?: { reasonCategory: ExceptionReasonCategory; reason: string; reference?: string }
}

/** 고를 수 있는 범위. 저장된 옛 범위(이번 발생, 선택 대상)는 새로 만들지 않는다 */
const SCOPES: DraftScope[] = ['finding', 'destination']

export default function ExceptionDialog({ view, dataset, now, onCancel, onSubmit, destinations = [], countHidden, initial }: ExceptionDialogProps) {
  const finding = view.original

  // 기본은 '위협 전체'다.
  const defaultScope: DraftScope = 'finding'
  const [scope, setScope] = useState<DraftScope>(defaultScope)
  const [reasonCategory, setReasonCategory] = useState<ExceptionReasonCategory>(initial?.reasonCategory ?? 'business_justified')
  const [reason, setReason] = useState(initial?.reason ?? '')
  const [reference, setReference] = useState(initial?.reference ?? '')
  const [actor, setActor] = useState(loadActor)
  const [approver, setApprover] = useState('')
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>(String(DEFAULT_EXPIRY_DAYS) as ExpiryChoice)
  const [customDate, setCustomDate] = useState('')
  const [touched, setTouched] = useState(false)
  const [pickedDestinations, setPickedDestinations] = useState<string[]>(() => destinations.map(d => d.key))
  const scopes = destinations.length > 0 ? SCOPES : SCOPES.filter(s => s !== 'destination')
  const firstField = useRef<HTMLTextAreaElement>(null)

  const restricted = expiryRestricted(scope, reasonCategory)
  useEffect(() => {
    if (restricted && expiryChoice === 'none') setExpiryChoice(String(DEFAULT_EXPIRY_DAYS) as ExpiryChoice)
  }, [restricted, expiryChoice])

  useEffect(() => {
    // 범위·대상을 먼저 보게 창을 맨 위에 둔 채로 사유 칸에 커서만 둔다.
    firstField.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const expiresAt = expiryFromChoice(expiryChoice, customDate, now)
  const draft: ExceptionDraft = {
    scope,
    subjectKeys: scope === 'destination' ? pickedDestinations : [],
    ...(scope === 'destination' ? { destinationLabels: Object.fromEntries(destinations.map(d => [d.key, d.name])) } : {}),
    reasonCategory,
    reason,
    reference,
    actor,
    approver,
    expiresAt: expiresAt === '' ? null : expiresAt,
  }
  const needsApprover = approverRequired(scope, reasonCategory)

  const errors: string[] = []
  if (scope === 'destination' && pickedDestinations.length === 0) errors.push('목적지 한 곳 이상 선택 필요')
  if (reason.trim().length < MIN_REASON_LENGTH) errors.push(`사유 ${MIN_REASON_LENGTH}자 이상 필요`)
  if (!actor.trim()) errors.push('처리자 이름 필요')
  else {
    const approval = approverProblem(scope, reasonCategory, actor, approver)
    if (approval) errors.push(approval)
  }
  if (expiresAt === '') errors.push('만료일 선택 필요')
  else {
    const expiryError = validateExpiry(draft.expiresAt, scope, reasonCategory, now)
    if (expiryError) errors.push(expiryError)
  }

  // 적용하면 어떻게 되는지 미리 계산한다 — 실제 적용과 같은 함수를 쓴다.
  const preview = useMemo(() => {
    if (scope === 'destination') {
      if (pickedDestinations.length === 0 || !countHidden) return null
      const drafts = buildExceptions(finding, { ...draft, reason: 'preview', actor: 'preview' }, dataset, now)
      const hidden = countHidden(drafts)
      return hidden > 0
        ? { tone: 'hide', text: `적용하면 이 목적지로 가는 위협 ${hidden}개를 목록, 개요, 그래프에서 제외` }
        : { tone: 'partial', text: '이 목적지로 가는 위협에 다른 유형이나 다른 목적지가 섞여 지금 제외되는 위협 없음' }
    }
    const drafts = buildExceptions(finding, { ...draft, reason: draft.reason || 'preview', actor: draft.actor || 'preview' }, dataset, now)
    const result = applyExceptions([finding], [...view.applied, ...drafts], now).views[0]
    return result.state === 'excepted' ? { tone: 'hide', text: '적용하면 이 위협을 목록, 개요, 그래프에서 제외' } : null
    // draft 는 매 렌더 새 객체라 값으로 비교한다
  }, [scope, pickedDestinations.join('|'), finding, view, dataset, now, countHidden])

  const hasInferred = (finding.checks ?? []).some(c => c.state === 'inferred')
  const tag = scenarioTag(findingTagKey(finding))

  const submit = () => {
    setTouched(true)
    if (errors.length === 0) onSubmit(draft)
  }

  return (
    <div className="ex-backdrop" onMouseDown={event => event.target === event.currentTarget && onCancel()}>
      <section className="ex-dialog" role="dialog" aria-modal="true" aria-labelledby="ex-dialog-title">
        <header className="ex-dialog-head">
          <span className="ex-dialog-icon" aria-hidden="true"><ShieldOff size={16} strokeWidth={2} /></span>
          <div className="ex-dialog-title">
            <h2 id="ex-dialog-title">예외 처리</h2>
            <span className="ex-dialog-tags">
              <b className={`fn-severity-badge ${severityClass(view.finding.severity)}`}>{severityLabel(view.finding.severity)}</b>
              <span className={`scenario-tag-badge ${tagClass(findingTagKey(finding))}`}>{tag.label}</span>
              <small>{finding.id}</small>
            </span>
            <p>{finding.title}</p>
          </div>
          <button type="button" className="ex-icon-btn" aria-label="닫기" onClick={onCancel}>
            <X size={16} strokeWidth={2} />
          </button>
        </header>

        <div className="ex-dialog-body">
          <fieldset className="ex-field">
            <legend>범위</legend>
            <div className="ex-radio-list">
              {scopes.map(value => (
                <label key={value} className={`ex-radio ${scope === value ? 'on' : ''} ${isWideScope(value) ? 'strong' : ''}`}>
                  <input
                    type="radio"
                    name="ex-scope"
                    checked={scope === value}
                    onChange={() => setScope(value)}
                  />
                  <span>
                    <b>{SCOPE_LABELS[value]}{value === defaultScope && <em className="ex-default">기본</em>}</b>
                    <small>{SCOPE_HINTS[value]}</small>
                  </span>
                </label>
              ))}
            </div>
            {scope === 'finding' && (
              <p className="ex-warn">이 구성 {finding.ruleId}에 앞으로 들어오는 사람까지 가리므로 만료일 필수</p>
            )}
            {scope === 'destination' && (
              <p className="ex-warn">가장 넓은 범위. 다른 위협이라도 이 목적지로 가는 데이터 반출이면 함께 제외</p>
            )}
          </fieldset>

          {scope === 'destination' && (
            <fieldset className="ex-field">
              <legend>조직 밖 목적지</legend>
              <ul className="ex-subject-list">
                {destinations.map(dest => (
                  <li key={dest.key}>
                    <label className="ex-subject">
                      <input
                        type="checkbox"
                        checked={pickedDestinations.includes(dest.key)}
                        onChange={() => setPickedDestinations(prev => (prev.includes(dest.key) ? prev.filter(k => k !== dest.key) : [...prev, dest.key]))}
                      />
                      <span className="ex-subject-main">
                        <b>{dest.name}</b>
                        <small>{[dest.kindLabel, dest.data].filter(Boolean).join(', ')}</small>
                      </span>
                      <span className="ex-subject-meta">
                        <em className="ex-chip">위협 {dest.findingIds.length}</em>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          <fieldset className="ex-field">
            <legend>사유 분류</legend>
            <div className="ex-reason-grid">
              {(Object.keys(REASON_LABELS) as ExceptionReasonCategory[]).map(value => (
                <label key={value} className={`ex-reason ${reasonCategory === value ? 'on' : ''}`} title={REASON_HINTS[value]}>
                  <input type="radio" name="ex-reason" checked={reasonCategory === value} onChange={() => setReasonCategory(value)} />
                  <span>{REASON_LABELS[value]}</span>
                </label>
              ))}
            </div>
            <small className="ex-field-hint">
              {REASON_HINTS[reasonCategory]}
              {reasonCategory === 'false_positive' && hasInferred && ' 이 판정에 추정 근거 포함'}
            </small>
          </fieldset>

          <label className="ex-field">
            <span className="ex-label">사유 <em>필수, {MIN_REASON_LENGTH}자 이상</em></span>
            <textarea
              ref={firstField}
              className="ex-input"
              rows={3}
              value={reason}
              placeholder="예: 사용자 A 는 헬프데스크 온콜 로테이션 인원이며 Okta 권한 신청 중, 티켓 ITSM-45"
              onChange={event => setReason(event.target.value)}
            />
          </label>

          <div className="ex-two">
            <label className="ex-field">
              <span className="ex-label">참조 링크 <em>선택</em></span>
              <input className="ex-input" value={reference} placeholder="티켓, 문서 주소" onChange={event => setReference(event.target.value)} />
            </label>
            <label className="ex-field">
              <span className="ex-label">처리자 <em>필수</em></span>
              <input className="ex-input" value={actor} placeholder="이름" onChange={event => setActor(event.target.value)} />
            </label>
          </div>

          <label className="ex-field">
            <span className="ex-label">승인자 <em>{needsApprover ? '필수, 처리자와 다른 사람' : '선택'}</em></span>
            <input className="ex-input" value={approver} placeholder="이름" onChange={event => setApprover(event.target.value)} />
          </label>

          <div className="ex-field">
            <span className="ex-label">만료</span>
            <ExpiryPicker
              choice={expiryChoice}
              customDate={customDate}
              restricted={restricted}
              now={now}
              onChange={(choice, date) => {
                setExpiryChoice(choice)
                setCustomDate(date)
              }}
            />
          </div>

          {preview && <p className={`ex-preview ${preview.tone}`}>{preview.text}</p>}
          {touched && errors.length > 0 && (
            <ul className="ex-errors" role="alert">
              {errors.map(error => <li key={error}>{error}</li>)}
            </ul>
          )}
        </div>

        <footer className="ex-dialog-foot">
          <button type="button" className="ex-btn" onClick={onCancel}>취소</button>
          <button type="button" className="ex-btn primary" onClick={submit} disabled={touched && errors.length > 0}>
            예외 처리
          </button>
        </footer>
      </section>
    </div>
  )
}
