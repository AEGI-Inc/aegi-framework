import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/*
 * 상세 화면 제목 줄 부품. 왼쪽은 「목록 › 상세 이름」 경로, 오른쪽은 흰 단추를 이어 붙인 묶음(툴바)이다.
 * 위협, Access Gaps, Exceptions, Credentials, 설정 위반, Effective Access, 조치 상세가 같이 쓴다. 스타일은 pageShell.css 의 dh-*
 */

/** 제목 칸: 돌아갈 목록 이름(누르면 목록으로) › 상세 이름, 옆에 ID 같은 한 줄 */
export function DetailCrumb({ back, onBack, title, meta }: { back: string; onBack: () => void; title: string; meta?: ReactNode }) {
  return (
    <div className="page-title-bar-name">
      <button type="button" className="dh-crumb" onClick={onBack}>{back}</button>
      <span className="dh-crumb-sep" aria-hidden="true">›</span>
      <h1>{title}</h1>
      {meta !== undefined && meta !== null && <span className="page-head-meta">{meta}</span>}
    </div>
  )
}

/** 단추 묶음. 안의 단추는 세로선으로 나뉜다 */
export function DetailGroup({ label, children }: { label: string; children: ReactNode }) {
  return <span className="dh-group" role="group" aria-label={label}>{children}</span>
}

/** 이전, 다음 화살표와 「n / m」. 방문 기록은 쌓지 않는다(부르는 쪽이 정한다) */
export function DetailPager({ index, total, unit, onPrev, onNext }: { index: number; total: number; unit: string; onPrev?: () => void; onNext?: () => void }) {
  return (
    <DetailGroup label={`${unit} 이동`}>
      <button type="button" className="dh-btn dh-ic" disabled={!onPrev} onClick={onPrev} aria-label={`이전 ${unit}`} title={`이전 ${unit}`}>
        <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <b className="dh-count" aria-label={`${unit} ${total}건 중 ${index}번째`}>{index} / {total}</b>
      <button type="button" className="dh-btn dh-ic" disabled={!onNext} onClick={onNext} aria-label={`다음 ${unit}`} title={`다음 ${unit}`}>
        <ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </DetailGroup>
  )
}

/** 묶음 안의 단추. 아이콘만 있으면 label 은 화면 읽기와 툴팁으로 간다. count 는 이름 뒤 굵은 숫자 */
export function DetailButton({ icon, label, count, onClick, disabled, iconOnly = false }: {
  icon?: ReactNode
  label: string
  count?: number | null
  onClick: () => void
  disabled?: boolean
  iconOnly?: boolean
}) {
  return (
    <button type="button" className={`dh-btn${iconOnly ? ' dh-ic' : ''}`} onClick={onClick} disabled={disabled}
      aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined}>
      {icon}
      {!iconOnly && label}
      {!iconOnly && count !== undefined && count !== null && <em>{count.toLocaleString()}</em>}
    </button>
  )
}
