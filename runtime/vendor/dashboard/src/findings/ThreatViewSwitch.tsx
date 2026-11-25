/**
 * Threat Analysis 제목 줄의 보기 바꾸기: 위협 목록, 예외 목록.
 *
 * 예외는 메뉴 없이 이 보기로만 연다. 조치 목록(옛 #remediation)은 없앴다. 위협 판정 V2 의 권장 조치는
 * 위협 상세의 차단 지점이라 조치 목록이 늘 비었다.
 * 주소는 #threat, #threat?view=exceptions 다.
 */
export type ThreatView = 'threats' | 'exceptions'

export default function ThreatViewSwitch({
  view,
  threatCount,
  exceptionCount = 0,
  exceptionReview = 0,
  onChange,
}: {
  view: ThreatView
  threatCount: number
  exceptionCount?: number
  /** 재검토가 필요한 예외 수. 있으면 「예외」에 점을 붙인다 */
  exceptionReview?: number
  onChange: (view: ThreatView) => void
}) {
  return (
    <div className="ti-view-switch" role="tablist" aria-label="Threat 보기">
      <button type="button" role="tab" aria-selected={view === 'threats'} className={view === 'threats' ? 'on' : ''} onClick={() => onChange('threats')}>
        위협 <b>{threatCount}</b>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'exceptions'}
        aria-label={exceptionReview > 0 ? `예외 ${exceptionCount}건, 재검토 ${exceptionReview}건` : `예외 ${exceptionCount}건`}
        title={exceptionReview > 0 ? `재검토가 필요한 예외 ${exceptionReview}건` : undefined}
        className={view === 'exceptions' ? 'on' : ''}
        onClick={() => onChange('exceptions')}
      >
        예외 <b>{exceptionCount}</b>
        {exceptionReview > 0 && <i className="ti-view-alert" aria-hidden="true" />}
      </button>
    </div>
  )
}
