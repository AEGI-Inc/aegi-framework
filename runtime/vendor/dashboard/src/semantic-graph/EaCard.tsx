import type { ReactNode } from 'react'
import type { FindingV2 } from '../model/findingV2'
import { EA_LEVEL_HINT, EA_RULE_LABEL, type EaExplanation } from '../findings/eaExplain'
import EaPath from '../findings/EaPath'

/**
 * 그래프 오른쪽 패널의 Effective Access 결론 한 장. 선 상세(EaInspector)와 항목 상세(개별 항목의 개요)가 같이 쓴다.
 * 판정 배지와 닿는 방식, 물은 질문, 답 한 줄, 경로 그림, 이 질문을 물은 Finding 순서다.
 */
export default function EaCard({ x, label, head, finding, onOpenThreat, onFocusObject, footer }: {
  x: EaExplanation
  label?: string
  /** 카드 위 회색 제목 칸 (여러 장일 때 번호 등) */
  head?: ReactNode
  finding?: FindingV2
  onOpenThreat?: (findingId: string) => void
  onFocusObject?: (objectKey: string) => void
  /** 맨 아래 덧붙일 단추 */
  footer?: ReactNode
}) {
  return (
    <section className={`ea-card ${head ? 'has-head' : ''}`} aria-label={label}>
      {head && <div className="ea-card-head">{head}</div>}
      <div className="ea-card-top">
        <span className={`ea-level ${x.row.level}`} title={EA_LEVEL_HINT[x.row.level]}>{x.levelLabel}</span>
        <span>{EA_RULE_LABEL[x.row.source.rule]}</span>
      </div>
      <p className="ea-card-q">{x.question}</p>
      <p className="ea-card-a">{x.how}.</p>
      {x.verdict && <p className={`ea-card-verdict ${x.row.level}`}>{x.verdict}</p>}

      <div className="ea-card-sec">
        <b>경로 <small>{x.saasTrail.length > 1 ? x.saasTrail.join(' → ') : `${x.saasTrail[0] ?? ''} 안`}</small></b>
        <EaPath path={x.path} onFocus={onFocusObject} />
      </div>

      {finding && (
        <button type="button" className="ea-finding-link" onClick={() => onOpenThreat?.(finding.id)} title="이 접근을 판정한 위협 보기">
          <b>{finding.id}</b>
          <span>{finding.title}</span>
        </button>
      )}
      {footer}
    </section>
  )
}
