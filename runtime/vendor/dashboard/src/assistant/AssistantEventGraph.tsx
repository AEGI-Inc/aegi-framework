import { useMemo } from 'react'
import type { GraphStoreV2 } from '../model/graph'
import type { AssistantEventGraph as EventGraph } from './types'
import { matchEventsToObjects } from './eventGraph'
import { objectLabel } from './query'
import GraphEventList from './GraphEventList'
import './eventGraph.css'

export default function AssistantEventGraph({ graph, objects, selectedId, onSelect, onAsk, onOpen, onShowGraph, disabled = false }: {
  graph: EventGraph; objects: GraphStoreV2; selectedId: string; onSelect: (id: string) => void
  onAsk: (key: string) => void; onOpen: (key: string) => void; disabled?: boolean
  onShowGraph?: (objectKey?: string) => void
}) {
  const matched = useMemo(() => matchEventsToObjects(graph, objects.objectsByKey), [graph, objects])
  return <div className="assistant-event-graph">
    <p className="assistant-event-counts">조회한 이벤트 {graph.nodes.length}개, 매칭 노드 {matched.byObject.size}개, 미매칭 이벤트 {matched.unmatched.length}개</p>
    {onShowGraph && !!matched.byObject.size && <button type="button" onClick={() => onShowGraph(matched.byObject.keys().next().value)}>Cross-SaaS Graph로 이동</button>}
    {[...matched.byObject].map(([key, events]) => <details key={key} className="assistant-event-object" open={events.some(e => e.evidenceIds.includes(selectedId))}>
      <summary>{objectLabel(objects, key)}: 이벤트 {events.length}개</summary>
      {onShowGraph && <button type="button" onClick={() => onShowGraph(key)}>이 노드에서 보기</button>}
      <GraphEventList events={events} objectKeys={[key]} selectedId={selectedId} onSelect={onSelect} onAsk={onAsk} onOpen={onOpen} disabled={disabled} />
    </details>)}
    {!!matched.unmatched.length && <details className="assistant-event-unmatched"><summary>미매칭 이벤트 {matched.unmatched.length}개</summary>
      <GraphEventList events={matched.unmatched} selectedId={selectedId} onSelect={onSelect} onAsk={onAsk} onOpen={onOpen} disabled={disabled} />
    </details>}
    {!!matched.partial.length && <p>이벤트 {matched.partial.length}개의 일부 참여 객체가 미조회 또는 미매칭입니다.</p>}
    {!graph.nodes.length && <p>{graph.scopes.some(s => !s.available) ? '이벤트를 조회하지 못했습니다.' : '조회된 개별 이벤트가 없습니다.'}</p>}
    {!!graph.edges.length && <details><summary>게시된 이벤트 연결 {graph.edges.length}개</summary>{graph.edges.map(edge => <p key={edge.key}>
      <button type="button" onClick={() => onSelect(edge.evidenceIds[0])}>{edge.evidenceIds.join(', ')}</button> {edge.detail}
      {edge.missingEndpoints.length ? ', 끝점 이벤트 미조회' : ''}</p>)}</details>}
    <details className="assistant-event-scope"><summary>조회 범위와 한계</summary>{graph.scopes.map(scope => <div key={scope.evidenceId}>
      <button type="button" onClick={() => onSelect(scope.evidenceId)}>{scope.evidenceId}</button><p>{scope.detail}</p>
      {scope.truncated && <p>추가 조회 결과가 있습니다.</p>}
    </div>)}</details>
  </div>
}
