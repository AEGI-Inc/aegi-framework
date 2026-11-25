import { useEffect, useState } from 'react'
import { HANDLING_LABEL, HANDLING_STATES, MAX_HANDLING_ACTOR, MAX_HANDLING_NOTE, MAX_HANDLING_OWNER, type HandlingChange, type HandlingState, type ThreatHandling } from '../model/handling'
import { loadActor, saveActor } from '../exceptions/store'
import { formatKst, utcTitle } from '../utils/time'
import HandlingBadge from './HandlingBadge'

/**
 * 위협 상세의 처리 칸. 상태(New, 확인됨, 진행 중, 해결됨), 담당자, 메모를 바꾸고 이력을 본다.
 * 해결됨을 고르면 처리자 칸이 검증자 칸이 된다(검증자 이름 필수).
 */
export default function HandlingEditor({ fingerprint, findingId, title, record, onSave }: {
  fingerprint: string
  findingId: string
  title: string
  record?: ThreatHandling
  onSave: (change: HandlingChange) => Promise<boolean>
}) {
  const current: HandlingState = record?.state ?? 'new'
  const [state, setState] = useState<HandlingState>(current)
  const [owner, setOwner] = useState(record?.owner ?? '')
  const [note, setNote] = useState(record?.note ?? '')
  const [actor, setActor] = useState(loadActor)
  const [busy, setBusy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // 다른 사람이 바꾼 기록을 받으면 칸을 그 값으로 맞춘다
  useEffect(() => {
    setState(record?.state ?? 'new')
    setOwner(record?.owner ?? '')
    setNote(record?.note ?? '')
  }, [record?.updatedAt, record?.state, record?.owner, record?.note])

  const changed = state !== current || owner.trim() !== (record?.owner ?? '') || note.trim() !== (record?.note ?? '')
  const ready = changed && actor.trim().length > 0 && !busy

  const submit = async () => {
    if (!ready) return
    setBusy(true)
    saveActor(actor.trim())
    await onSave({
      fingerprint,
      findingId,
      title,
      state,
      owner: owner.trim() || undefined,
      note: note.trim() || undefined,
      actor: actor.trim(),
      expectedUpdatedAt: record?.updatedAt,
    })
    setBusy(false)
  }

  const last = record?.history[record.history.length - 1]
  return (
    <section className="hd-editor" aria-label="처리 상태">
      <div className="hd-row">
        <span className="hd-label">처리 상태</span>
        <div className="hd-states" role="radiogroup" aria-label="처리 상태">
          {HANDLING_STATES.map(value => (
            <button
              type="button"
              key={value}
              role="radio"
              aria-checked={state === value}
              className={`hd-state ${state === value ? 'on' : ''}`}
              onClick={() => setState(value)}
            >
              {HANDLING_LABEL[value]}
            </button>
          ))}
        </div>
        <label className="hd-field">
          <span>담당자</span>
          <input id="hd-owner" value={owner} maxLength={MAX_HANDLING_OWNER} onChange={e => setOwner(e.target.value)} placeholder="이름" />
        </label>
        <label className="hd-field hd-note">
          <span>메모</span>
          <input id="hd-note" value={note} maxLength={MAX_HANDLING_NOTE} onChange={e => setNote(e.target.value)} placeholder="한 줄" />
        </label>
        <label className="hd-field">
          <span>{state === 'done' ? '검증자' : '처리자'}<b aria-hidden="true">필수</b></span>
          <input id="hd-actor" value={actor} maxLength={MAX_HANDLING_ACTOR} onChange={e => setActor(e.target.value)} placeholder="이름" required aria-required="true" />
        </label>
        <button type="button" className="hd-save" disabled={!ready} onClick={submit}>{busy ? '저장 중' : '저장'}</button>
      </div>
      {record && last && (
        <div className="hd-meta">
          <HandlingBadge state={record.state} />
          <span title={utcTitle(record.updatedAt)}>
            {last.actor ?? '처리자 없음'}, {formatKst(record.updatedAt)}
            {record.state === 'done' && record.verifiedBy ? `, 검증 ${record.verifiedBy}` : ''}
          </span>
          {record.history.length > 1 && (
            <button type="button" className="hd-history-toggle" aria-expanded={showHistory} onClick={() => setShowHistory(v => !v)}>
              이력 {record.history.length}건
            </button>
          )}
        </div>
      )}
      {showHistory && record && (
        <ol className="hd-history">
          {[...record.history].reverse().map((h, index) => (
            <li key={`${h.at}-${index}`}>
              <HandlingBadge state={h.state} />
              <span title={utcTitle(h.at)}>{formatKst(h.at)}</span>
              <span>{h.actor ?? '처리자 없음'}</span>
              {h.owner && <span>담당 {h.owner}</span>}
              {h.note && <span className="hd-history-note">{h.note}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
