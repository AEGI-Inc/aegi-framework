/**
 * 이벤트 카드에 마우스 오버(300ms) 또는 키보드 포커스 시 뜨는 호버 설명 상자.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TimelineEvent } from '../timeline/timelineAnalysis'
import { formatTime, OUTCOME_LABEL } from '../timeline/timelineAnalysis'
import { providerName, providerLogoId } from '../findings/providers'
import ProviderLogo from '../ProviderLogo'
import type { BoardLink } from './boardLinks'

export interface EventHoverCardProps {
  id?: string
  event: TimelineEvent
  repeatCount?: number
  links: BoardLink[]
  /** 행위자, 대상 이름. 그래프 객체 이름을 쓰게 화면에서 넘긴다 */
  labelOf?: (ref: NonNullable<TimelineEvent['actor']>) => string
  anchorRect: { top: number; left: number; right: number; bottom: number; width: number; height: number }
}

export function EventHoverCard({
  id = 'eb-hover-card',
  event,
  repeatCount = 1,
  links,
  labelOf,
  anchorRect,
}: EventHoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: anchorRect.top,
    left: anchorRect.right + 8,
  })

  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vpW = window.innerWidth
    const vpH = window.innerHeight

    let left = anchorRect.right + 8
    if (left + rect.width > vpW - 8) {
      left = anchorRect.left - 8 - rect.width
    }
    left = Math.max(8, Math.min(vpW - rect.width - 8, left))

    let top = anchorRect.top
    top = Math.max(8, Math.min(vpH - rect.height - 8, top))

    setPos({ top, left })
  }, [anchorRect])

  // 1. 행동 제목과 KST 발생 시각
  const title = event.title || event.event_type
  const timeStr = event.occurred_at
    ? `${formatTime(Date.parse(event.occurred_at))} KST`
    : '시각 없음'

  // 2. 행위자와 대상 (대상은 2개까지, 그 이상은 그 밖 N개)
  const nameOf = (ref: TimelineEvent['actor']) => (ref ? (labelOf ? labelOf(ref) : ref.display || ref.native_id) : '알 수 없음')
  const targetNames = event.targets.map(t => nameOf(t)).filter(Boolean)
  const targetsStr = targetNames.length === 0
    ? '없음'
    : targetNames.length <= 2
      ? targetNames.join(', ')
      : `${targetNames.slice(0, 2).join(', ')}, 그 밖 ${targetNames.length - 2}개`

  // 3. 결과와 의심
  const isSuspicious = event.signal?.kind === 'suspicious'

  // 4. 앞뒤로 이어진 이벤트 수
  const prevCount = new Set(links.filter(l => l.to === event.origin_key).map(l => l.from)).size
  const nextCount = new Set(links.filter(l => l.from === event.origin_key).map(l => l.to)).size

  // 5. 묶음 카드: 같은 행동 N번 (10분 안)
  const isGrouped = repeatCount > 1

  return createPortal(
    <div
      ref={cardRef}
      id={id}
      role="tooltip"
      className="eb-hover-card"
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="eb-hover-meta">
        <span className="eb-hover-logo"><ProviderLogo provider={providerLogoId(event.provider)} /></span>
        <span className="eb-hover-saas">{providerName(event.provider)}</span>
        <span className={`tl-badge eb-hover-outcome outcome-${event.outcome} ${event.outcome === 'failure' ? 'is-failure' : ''}`}>
          {OUTCOME_LABEL[event.outcome]}
        </span>
        {isSuspicious && <span className="tl-badge is-failure">의심</span>}
      </div>
      <div className="eb-hover-title">{title}</div>
      <div className="eb-hover-time">{timeStr}</div>
      <dl className="eb-hover-facts">
        <dt>행위자</dt>
        <dd>{nameOf(event.actor)}</dd>
        <dt>대상</dt>
        <dd>{targetsStr}</dd>
        <dt>연결</dt>
        <dd>{prevCount + nextCount === 0 ? '없음' : `앞 ${prevCount}건, 뒤 ${nextCount}건`}</dd>
      </dl>
      {isGrouped && (
        <div className="eb-hover-group">10분 안에 같은 행동 {repeatCount}번</div>
      )}
    </div>,
    document.body
  )
}
