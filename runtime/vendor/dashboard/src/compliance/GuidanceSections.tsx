import {
  type GuidanceCard,
  type GuidanceSentence,
  formatSourceLabel,
  guidanceFor,
} from './guidance'

function SentenceWithSrc({ item }: { item: GuidanceSentence }) {
  return (
    <li>
      <span>{item.text}</span>
      {item.src.length > 0 && (
        <sup className="comp-guidance-fn">
          {item.src.map(idx => `[${idx + 1}]`).join(' ')}
        </sup>
      )}
    </li>
  )
}

function GuidanceCardSection({ card }: { card: GuidanceCard }) {
  const blocks: Array<{ key: string; title: string; badge?: string; items: GuidanceSentence[] }> = [
    { key: 'requirement', title: '요구사항', items: card.requirement },
    { key: 'auditor_checks', title: '심사에서 보는 것', items: card.auditor_checks },
    { key: 'evidence_examples', title: '증적 예시', items: card.evidence_examples },
    { key: 'common_gaps', title: '흔한 결함', items: card.common_gaps },
    { key: 'saas_controls', title: 'SaaS 통제', badge: 'AEGI 해석', items: card.saas_controls },
  ]
  const visibleBlocks = blocks.filter(b => b.items.length > 0)
  if (visibleBlocks.length === 0) return null

  return (
    <details className="comp-related comp-guidance">
      <summary className="comp-guidance-summary">
        <h5>기준 근거</h5>
        <span className="comp-guidance-meta">
          {card.location}, 출처 {card.sources.length}건
        </span>
      </summary>
      <div className="comp-guidance-body">
        {visibleBlocks.map(block => (
          <div key={block.key} className="comp-guidance-block">
            <h6 className="comp-guidance-heading">
              {block.title}
              {block.badge && <span className="comp-state">{block.badge}</span>}
            </h6>
            <ul className="comp-guidance-list">
              {block.items.map((item, i) => (
                <SentenceWithSrc key={`${block.key}-${i}`} item={item} />
              ))}
            </ul>
          </div>
        ))}
        {card.sources.length > 0 && (
          <div className="comp-guidance-block">
            <h6 className="comp-guidance-heading">출처</h6>
            <ol className="comp-guidance-refs">
              {card.sources.map((src, i) => (
                <li key={`${src.url}-${i}`}>
                  <span>
                    {formatSourceLabel(src)}
                  </span>{' '}
                  {src.url && (
                    <a href={src.url} target="_blank" rel="noopener noreferrer">
                      원문
                    </a>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </details>
  )
}

export default function GuidanceSections({ itemKey }: { itemKey: string }) {
  const card = guidanceFor(itemKey)
  if (!card) return null

  return <GuidanceCardSection card={card} />
}
