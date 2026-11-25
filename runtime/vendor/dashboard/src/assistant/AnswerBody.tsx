import { useMemo } from 'react'
import ProviderLogo from '../ProviderLogo'
import type { GraphStoreV2 } from '../model/graph'
import { providerLogoId, providerName } from '../findings/providers'
import AssistantMarkdown from './AssistantMarkdown'
import { citationNumbers, citedEvidence, splitLead } from './answerText'
import AnswerGraph from './AnswerGraph'
import { answerGraphLayout, citedProviders } from './answerGraphLayout'
import type { AssistantEvidence } from './types'

/**
 * 답변 말풍선 본문. 굵은 결론 한 줄, 근거 수와 SaaS 줄, 연결 그래프, 나머지 본문 차례로 보인다.
 * 결론 줄이 없는 답(인사, 짧은 답)은 본문 아래에 근거 줄과 그래프를 둔다.
 */
export default function AnswerBody({ answer, evidence, graph, disabled, onCitation, onOpenEvidence, onOpenGraph }: {
  answer: string
  evidence: readonly AssistantEvidence[]
  graph: GraphStoreV2
  disabled?: boolean
  onCitation: (id: string) => void
  onOpenEvidence?: () => void
  onOpenGraph?: () => void
}) {
  const ids = useMemo(() => evidence.map(e => e.id), [evidence])
  const numbers = useMemo(() => citationNumbers(answer, ids), [answer, ids])
  const cited = useMemo(() => citedEvidence(answer, evidence), [answer, evidence])
  const layout = useMemo(() => answerGraphLayout(graph, cited), [graph, cited])
  const providers = useMemo(() => citedProviders(graph, cited), [graph, cited])
  const split = splitLead(answer)
  const md = (text: string, lead = false) => <AssistantMarkdown text={text} evidenceIds={ids} numbers={numbers} disabled={disabled} onCitation={onCitation} lead={lead} />
  const extra = <>
    {!!cited.length && <div className="assistant-answer-meta">
      <button type="button" disabled={disabled} onClick={onOpenEvidence}>근거 {cited.length}개</button>
      {!!providers.length && <span>{providers.map(p => <span key={p} className="assistant-saas"><ProviderLogo provider={providerLogoId(p)} />{providerName(p)}</span>)}</span>}
    </div>}
    {layout && <AnswerGraph graph={graph} layout={layout} onOpen={onOpenGraph} disabled={disabled} />}
  </>
  return <div className="assistant-answer-body">{split ? <>{md(split.lead, true)}{extra}{split.rest && md(split.rest)}</> : <>{md(answer)}{extra}</>}</div>
}
