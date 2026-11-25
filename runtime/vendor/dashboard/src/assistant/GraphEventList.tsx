import type { AssistantEventNode } from './types'
import { formatKst } from '../utils/time'
import './eventGraph.css'

export default function GraphEventList({ events, objectKeys, selectedId, onSelect, onAsk, onOpen, disabled = false }: {
  events: AssistantEventNode[]; objectKeys?: readonly string[]; selectedId?: string; onSelect?: (id: string) => void
  onAsk?: (key: string) => void; onOpen?: (key: string, objects?: string[], at?: string | null) => void; disabled?: boolean
}) {
  return <div className="graph-event-list">{events.map(event => {
    const roles = [...new Set(event.participants.filter(p => !objectKeys || objectKeys.includes(p.objectKey)).map(p => p.role === 'actor' ? '행위자' : '대상'))]
    return <details key={event.key} data-event-key={event.key} open={selectedId ? event.evidenceIds.includes(selectedId) : undefined}>
      <summary>{event.label}<span>{formatKst(event.occurredAt)}{roles.length ? `, ${roles.join(', ')}` : ''}</span></summary>
      <p>{event.detail}</p>
      <p>{event.outcome === 'success' ? '성공' : event.outcome === 'failure' ? '실패' : '결과 미확인'}{event.suspicious ? ', 의심 신호' : ''}</p>
      <div className="assistant-event-actions">{event.evidenceIds.map(id => onSelect ? <button key={id} type="button" onClick={() => onSelect(id)}>{id}</button> : <span key={id}>{id}</span>)}</div>
      <div className="assistant-event-actions">
        {onOpen && <button type="button" disabled={disabled} onClick={() => onOpen(event.key, event.participants.map(p => p.objectKey).filter(Boolean), event.occurredAt)}>이벤트 상세 열기</button>}
        {onAsk && <button type="button" disabled={disabled} onClick={() => onAsk(event.key)}>이 이벤트 이어서 조사</button>}
      </div>
    </details>
  })}</div>
}
