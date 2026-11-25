import type { Ref } from 'react'
import { ArrowRight, Link2 } from 'lucide-react'
import ProviderLogo from '../ProviderLogo'
import type { ProviderId } from '../providerOverviewData'
import type { GraphStoreV2 } from '../model/graph'
import type { AssistantEvidence } from './types'
import { objectLabel } from './lookup'
import { relationLabel } from '../semantic-graph/edgeExplain'

const logoOf = (provider: string): ProviderId => (provider === 'gws' ? 'google-workspace' : provider) as ProviderId
const STATE = { confirmed: '확인', inferred: '추정', unknown: '미확인' } as const

function Obj({ graph, objectKey }: { graph: GraphStoreV2; objectKey: string }) {
  const object = graph.objectsByKey.get(objectKey)
  return (
    <span className="assistant-chain-obj" title={objectKey}>
      {object && <ProviderLogo provider={logoOf(object.canonical.provider)} />}
      <b>{objectLabel(graph, objectKey)}</b>
    </span>
  )
}

/** 관계 근거는 「출발 → 관계 → 도착」 줄로, 객체 근거는 로고와 이름으로, 나머지는 근거 이름으로 보인다. */
function Row({ graph, item }: { graph: GraphStoreV2; item: AssistantEvidence }) {
  const rel = item.kind === 'relation' ? graph.relationsByKey.get(item.ref) : undefined
  if (rel) return <>
    <Obj graph={graph} objectKey={rel.sourceKey} />
    <span className="assistant-chain-rel"><ArrowRight size={13} aria-hidden="true" />{relationLabel(rel.relationType)}{rel.roleName ? ` (${rel.roleName})` : ''}</span>
    <Obj graph={graph} objectKey={rel.targetKey} />
  </>
  if (item.kind === 'identity_link') return <span className="assistant-chain-rel is-link"><Link2 size={13} aria-hidden="true" />{item.label}</span>
  if (item.kind === 'object' && graph.objectsByKey.has(item.ref)) return <Obj graph={graph} objectKey={item.ref} />
  return <b className="assistant-cited-label">{item.label}</b>
}

/** 답변에 인용한 근거만 줄로 편다. 줄을 펼치면 원본 키와 상세가 보인다. */
export default function CitedEvidence({ graph, items, openId, openRef, onOpenFinding }: {
  graph: GraphStoreV2
  items: readonly AssistantEvidence[]
  openId?: string
  openRef?: Ref<HTMLDetailsElement>
  onOpenFinding?: (findingId: string) => void
}) {
  return (
    <div className="assistant-chain assistant-cited"><ol>
      {items.map((item, index) => (
        <li key={item.id}>
          <details ref={item.id === openId ? openRef : undefined} open={item.id === openId ? true : undefined}>
            <summary>
              <span className="assistant-cited-id" title={item.id}>{index + 1}</span>
              <Row graph={graph} item={item} />
              {item.state && <span className="assistant-state">{STATE[item.state]}</span>}
            </summary>
            <code>{item.ref}</code><p>{item.detail}</p>
            {item.kind === 'finding' && onOpenFinding && <button type="button" onClick={() => onOpenFinding(item.ref)}>탐지 상세 보기</button>}
          </details>
        </li>
      ))}
    </ol></div>
  )
}
