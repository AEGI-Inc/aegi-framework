import React from 'react'
import { Filter, Waypoints } from 'lucide-react'
import type { GraphStoreV2 } from '../model/graph'
import { objectLabel } from '../blast-radius/blastLabels'
import { UNMATCHED_LABEL, matchedOnText, pinFor, relationMatchText, slotLabel, type EntityRef, type Pin, type TimedEvent } from './timelineAnalysis'

/**
 * 엔진이 적은 「같음」 사실: 무엇이 같아서 객체를 찾았는지, 이벤트의 두 칸이 어느 그래프 관계의 두 끝과 같았는지.
 * 해석하지 않는다. 관계 일치는 이벤트가 그 관계를 만들거나 썼다는 뜻이 아니다.
 */
export function MatchFacts({ event }: { event: TimedEvent }): React.ReactElement | null {
  const refs = [['actor', event.actor] as const, ...event.targets.map((t, i) => [{ target: i }, t] as const)]
    .filter((r): r is readonly [Parameters<typeof slotLabel>[0], EntityRef] => !!r[1]?.matched_on)
  const unmatched = [['actor', event.actor] as const, ...event.targets.map((t, i) => [{ target: i }, t] as const)]
    .filter((r): r is readonly [Parameters<typeof slotLabel>[0], EntityRef] => !r[1]?.object_key && !!r[1]?.unmatched)
  const relations = event.relation_matches ?? []
  if (!refs.length && !relations.length && !unmatched.length) return null
  return <>
    {refs.length > 0 && <>
      <dt>일치한 값</dt>
      <dd>{refs.map(([slot, ref]) => <div key={slotLabel(slot)}>{slotLabel(slot)}: {matchedOnText(ref.matched_on!)}</div>)}</dd>
    </>}
    {relations.length > 0 && <>
      <dt>두 끝이 같은 관계</dt>
      <dd>
        {relations.map(m => <div key={m.relation_id} title={m.relation_id}>{relationMatchText(m)}</div>)}
        {event.matched_snapshot && <div className="tl-note">대조한 그래프: {event.matched_snapshot.collected_at ?? event.matched_snapshot.id}</div>}
      </dd>
    </>}
    {unmatched.length > 0 && <>
      <dt>미일치</dt>
      <dd>{unmatched.map(([slot, ref]) => <div key={slotLabel(slot)}>{`${slotLabel(slot)}: ${UNMATCHED_LABEL[ref.unmatched!]}`}</div>)}</dd>
    </>}
  </>
}

export function entityLabel(ref: EntityRef | null, graph: GraphStoreV2): string {
  if (!ref) return '알 수 없음'
  if (ref.object_key && graph.objectsByKey.has(ref.object_key)) return objectLabel(ref.object_key, graph)
  return ref.display ?? ref.native_id
}

/** 이름, 그 값으로 거르는 단추, 그래프 객체에 연결돼 있으면 그래프에서 여는 단추 */
export function Entity({ entity, graph, onOpenObject, pin, onPin }: {
  entity: EntityRef | null; graph: GraphStoreV2; onOpenObject: (key: string) => void; pin?: 'actor' | 'target'; onPin?: (pin: Pin) => void
}) {
  const key = entity?.object_key && graph.objectsByKey.has(entity.object_key) ? entity.object_key : null
  return (
    <span className="tl-entity">
      {entityLabel(entity, graph)}
      {entity && pin && onPin && (
        <button
          type="button"
          className="tl-link tl-filter-btn"
          title={pin === 'actor' ? '이 행위자의 이벤트만 보기' : '이 대상의 이벤트만 보기'}
          aria-label={pin === 'actor' ? '이 행위자의 이벤트만 보기' : '이 대상의 이벤트만 보기'}
          onClick={() => onPin(pinFor(pin, entity, entityLabel(entity, graph)))}
        >
          <Filter size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      {key && (
        <button type="button" className="tl-link" title="그래프에서 이 객체 열기" onClick={() => onOpenObject(key)}>
          <Waypoints size={13} strokeWidth={1.75} aria-hidden="true" />그래프에서 보기
        </button>
      )}
    </span>
  )
}
