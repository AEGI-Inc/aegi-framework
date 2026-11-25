import { Fragment, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { StandardResults } from '../config-findings/standardResultsStore'
import {
  COMPLIANCE_EXCEPTION_REASON_LABEL,
  COMPLIANCE_EXCEPTION_SCOPE_LABEL,
  MAX_CE_ACTOR,
  MAX_CE_REASON,
  type ComplianceException,
} from '../model/complianceException'
import { formatDate, formatDateTime } from '../exceptions/format'
import { loadActor, saveActor } from '../exceptions/store'
import { complianceForFinding, complianceHash } from './findingCompliance'
import { verdictFor } from './verdicts'
import {
  EXCEPTION_STATE_LABEL,
  effectiveVerdict,
  exceptionState,
  exceptionTargetFailing,
  isActiveException,
} from './exceptionStatus'
import type { ComplianceExceptionsApi } from './useComplianceExceptions'
import ComplianceExceptionDialog from './ComplianceExceptionDialog'

type StatusFilter = 'all' | 'active' | 'expired' | 'revoked'

const FRAMEWORK_PREFIX: Record<string, string> = {
  'ISMS-P': 'isms-p',
  ISO27001: 'iso27001',
  PIPA: 'pipa',
}

function itemCriterionHash(target: string): string | null {
  const idx = target.indexOf(':')
  if (idx <= 0) return null
  const prefix = target.slice(0, idx)
  const criterion = target.slice(idx + 1)
  const fw = FRAMEWORK_PREFIX[prefix]
  if (!fw || !criterion) return null
  return `#compliance?${new URLSearchParams({ framework: fw, criterion })}`
}

function RevokeForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void
  onSubmit: (reason: string, actor: string) => Promise<boolean>
}) {
  const [reason, setReason] = useState('')
  const [actor, setActor] = useState(loadActor)
  const [busy, setBusy] = useState(false)
  const ready = Boolean(reason.trim() && actor.trim() && !busy)

  const submit = async () => {
    if (!ready) return
    setBusy(true)
    const ok = await onSubmit(reason.trim(), actor.trim())
    setBusy(false)
    if (ok) {
      saveActor(actor.trim())
      onCancel()
    }
  }

  return (
    <div className="ex-inline-form comp-ex-revoke-form" onClick={e => e.stopPropagation()}>
      <input
        className="ex-input"
        value={reason}
        placeholder="취소 사유"
        aria-label="취소 사유"
        autoFocus
        maxLength={MAX_CE_REASON}
        onChange={e => setReason(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') void submit() }}
      />
      <input
        className="ex-input ex-actor"
        value={actor}
        placeholder="처리자"
        aria-label="처리자"
        maxLength={MAX_CE_ACTOR}
        onChange={e => setActor(e.target.value)}
      />
      <button type="button" className="ex-btn" onClick={onCancel}>닫기</button>
      <button type="button" className="ex-btn primary" disabled={!ready} onClick={() => void submit()}>취소 확인</button>
    </div>
  )
}

export default function ComplianceExceptions({
  api,
  results,
}: {
  api: ComplianceExceptionsApi
  results: StandardResults | undefined
}) {
  const [filter, setFilter] = useState<StatusFilter>('active')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<ComplianceException | null>(null)
  const now = new Date()

  const counts = useMemo(() => {
    const c = { all: api.items.length, active: 0, expired: 0, revoked: 0 }
    for (const item of api.items) {
      const st = exceptionState(item, now)
      if (st === 'active' || st === 'expiring') c.active++
      else if (st === 'expired') c.expired++
      else c.revoked++
    }
    return c
  }, [api.items, now])

  const sorted = useMemo(() => {
    const filtered = api.items.filter(item => {
      if (filter === 'all') return true
      const st = exceptionState(item, now)
      if (filter === 'active') return st === 'active' || st === 'expiring'
      return st === filter
    })
    return [...filtered].sort((a, b) => {
      const aActive = isActiveException(a, now) ? 0 : 1
      const bActive = isActiveException(b, now) ? 0 : 1
      if (aActive !== bActive) return aActive - bActive
      return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()
    })
  }, [api.items, filter, now])

  const filterButtons: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: '전체', count: counts.all },
    { key: 'active', label: '적용 중', count: counts.active },
    { key: 'expired', label: '만료', count: counts.expired },
    { key: 'revoked', label: '취소', count: counts.revoked },
  ]

  return (
    <section className="comp-ex-page" aria-label="컴플라이언스 예외 목록">
      <div className="comp-toolbar">
        <div className="comp-filter-group" role="group" aria-label="예외 상태">
          {filterButtons.map(b => (
            <button
              key={b.key}
              type="button"
              className={`comp-filter-btn ${filter === b.key ? 'is-selected' : ''}`}
              aria-pressed={filter === b.key}
              onClick={() => setFilter(b.key)}
            >
              {b.label} {b.count}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="lst-empty">등록된 예외가 없습니다.</p>
      ) : (
        <section className="lst-section comp-ex-table">
          <div className="lst-head comp-ex-grid">
            <span />
            <span>상태</span>
            <span>범위</span>
            <span>대상</span>
            <span>사유 분류</span>
            <span>예외 처리 근거</span>
            <span>증빙</span>
            <span>처리자</span>
            <span>등록일</span>
            <span>만료일</span>
            <span>동작</span>
          </div>
          <div className="lst-list">
            {sorted.map(e => {
              const st = exceptionState(e, now)
              const active = isActiveException(e, now)
              const failing = active ? exceptionTargetFailing(e, results) : true
              const ev = active && e.scope === 'item' ? effectiveVerdict(verdictFor(results, e.target), api.items, now) : undefined
              const newUncovered = ev && ev.status === 'fail' ? ev.uncovered.length : 0
              const itemHref = e.scope === 'item' ? itemCriterionHash(e.target) : null
              const checkRefs = e.scope === 'check' ? complianceForFinding(e.target) : []
              const expanded = expandedId === e.id
              const revoking = revokingId === e.id

              return (
                <Fragment key={e.id}>
                  <div className="lst-row is-static comp-ex-grid">
                    <button
                      type="button"
                      className="lst-icon-btn"
                      aria-expanded={expanded}
                      aria-label={`${e.label} 이력 보기`}
                      onClick={() => setExpandedId(expanded ? null : e.id)}
                    >
                      <ChevronRight size={16} strokeWidth={2} className={expanded ? 'is-open' : ''} />
                    </button>
                    <span className="comp-ex-status-cell">
                      <span className="cfg-status tl-badge">{EXCEPTION_STATE_LABEL[st]}</span>
                      {active && !failing && <small className="comp-ex-sub">지금 위반 아님</small>}
                      {newUncovered > 0 && <small className="comp-ex-sub is-fail">새 위반 점검 {newUncovered}개</small>}
                    </span>
                    <span>{COMPLIANCE_EXCEPTION_SCOPE_LABEL[e.scope]}</span>
                    <span className="comp-ex-target">
                      {itemHref ? (
                        <button
                          type="button"
                          className="cfg-link"
                          onClick={() => { window.location.hash = itemHref }}
                        >
                          {e.label}
                        </button>
                      ) : (
                        <strong>{e.label}</strong>
                      )}
                      {checkRefs.length > 0 && (
                        <span className="comp-ex-links">
                          {checkRefs.map(ref => (
                            <button
                              key={`${ref.framework}:${ref.controlId}`}
                              type="button"
                              className="cfg-link"
                              onClick={() => { window.location.hash = complianceHash(ref) }}
                            >
                              {ref.label} {ref.controlId}
                            </button>
                          ))}
                        </span>
                      )}
                    </span>
                    <span>{COMPLIANCE_EXCEPTION_REASON_LABEL[e.reasonCategory]}</span>
                    <span className="lst-clip" title={e.reason}>{e.reason}</span>
                    <span className="lst-clip" title={e.reference ?? ''}>
                      {e.reference ? (
                        e.reference.startsWith('https://') ? (
                          <a href={e.reference} target="_blank" rel="noreferrer" className="cfg-link">{e.reference}</a>
                        ) : (
                          e.reference
                        )
                      ) : '—'}
                    </span>
                    <span>{e.updatedBy}</span>
                    <span>{formatDate(e.createdAt)}</span>
                    <span>{formatDate(e.expiresAt)}</span>
                    <span className="comp-ex-actions">
                      {active ? (
                        <>
                          <button type="button" className="ex-btn" onClick={() => setEditing(e)}>수정</button>
                          <button type="button" className="ex-btn" onClick={() => setRevokingId(revoking ? null : e.id)}>취소</button>
                        </>
                      ) : (
                        <button type="button" className="ex-btn" onClick={() => setEditing(e)}>다시 등록</button>
                      )}
                    </span>
                  </div>
                  {revoking && (
                    <div className="comp-ex-below">
                      <RevokeForm
                        onCancel={() => setRevokingId(null)}
                        onSubmit={(reason, actor) =>
                          api.save({
                            scope: e.scope,
                            target: e.target,
                            label: e.label,
                            reasonCategory: e.reasonCategory,
                            expiresAt: e.expiresAt,
                            failFindings: e.failFindings,
                            reason,
                            actor,
                            expectedUpdatedAt: e.updatedAt,
                            revoke: true,
                          })
                        }
                      />
                    </div>
                  )}
                  {expanded && (
                    <div className="comp-ex-below">
                      <h3 className="comp-ex-h3">이력</h3>
                      <ol className="comp-ex-history">
                        {e.history.map((h, i) => (
                          <li key={i}>
                            <time>{formatDateTime(h.at)}</time>
                            <span>{h.actor}</span>
                            <span>{h.action === 'revoke' ? '취소' : '등록'}</span>
                            <span>{h.reason}</span>
                            {h.expiresAt && <span>만료 {formatDate(h.expiresAt)}</span>}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </Fragment>
              )
            })}
          </div>
        </section>
      )}

      {editing && (
        <ComplianceExceptionDialog
          scope={editing.scope}
          target={editing.target}
          label={editing.label}
          failFindings={editing.scope === 'item' && verdictFor(results, editing.target)?.status === 'fail' ? verdictFor(results, editing.target)!.fail_findings : editing.failFindings}
          existing={editing}
          linkedCount={editing.scope === 'check' ? complianceForFinding(editing.target).length : undefined}
          onSubmit={api.save}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}
