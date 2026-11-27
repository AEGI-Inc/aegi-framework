import { useRef, type ReactNode } from 'react'
import { Info, PanelRightClose, PanelRightOpen, TriangleAlert } from 'lucide-react'

export type SideTab = 'findings' | 'detail'

export const SIDE_MIN_WIDTH = 300
export const SIDE_MAX_WIDTH = 640
export const SIDE_DEFAULT_WIDTH = 380
export const SIDE_RAIL_WIDTH = 44
const WIDTH_KEY = 'aegi:graph-side-width'

export const clampSideWidth = (width: number) => Math.round(Math.min(SIDE_MAX_WIDTH, Math.max(SIDE_MIN_WIDTH, width)))

export function readSideWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(WIDTH_KEY))
    return saved ? clampSideWidth(saved) : SIDE_DEFAULT_WIDTH
  } catch {
    return SIDE_DEFAULT_WIDTH
  }
}

export function saveSideWidth(width: number) {
  try { window.localStorage.setItem(WIDTH_KEY, String(width)) } catch { /* 저장 못 해도 폭은 이번 화면에서만 쓴다 */ }
}

/* 패널을 닫아 두었는지, 어느 탭을 보던지. 폭처럼 사람 취향이라 이 브라우저에 둔다.
   전에는 다른 화면에 다녀오면 닫아 둔 패널이 다시 열리고 탭도 처음으로 돌아갔다 */
const LAYOUT_KEY = 'aegi:graph-side-layout'

export function readSideLayout(): { open?: boolean; tab?: SideTab } {
  try {
    const saved = JSON.parse(window.localStorage.getItem(LAYOUT_KEY) ?? '{}') as { open?: unknown; tab?: unknown }
    return {
      open: typeof saved.open === 'boolean' ? saved.open : undefined,
      tab: saved.tab === 'findings' || saved.tab === 'detail' ? saved.tab : undefined,
    }
  } catch {
    return {}
  }
}

export function saveSideLayout(open: boolean, tab: SideTab) {
  try { window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ open, tab })) } catch { /* 저장 못 해도 이번 화면에서는 그대로 쓴다 */ }
}

interface GraphSideDockProps {
  open: boolean
  tab: SideTab
  width: number
  findingCount: number
  hasDetail: boolean
  detailLabel?: string
  onTab: (tab: SideTab) => void
  onOpenChange: (open: boolean) => void
  onWidth: (width: number) => void
  findings: ReactNode
  detail: ReactNode
}

/**
 * 그래프 오른쪽 패널 한 칸. 탐지 결과와 선택한 칸의 상세를 탭으로 나눠, 둘을 같이 열어도
 * 그래프는 패널 하나 폭만 내준다. 전에는 탐지 결과(360px) 옆에 상세(380px)가 그래프 위에 떠
 * 그래프가 화면의 1/3로 줄었다. 왼쪽 끝을 끌어 폭을 바꾸고, 접으면 얇은 띠로 남는다.
 */
export default function GraphSideDock({
  open, tab, width, findingCount, hasDetail, detailLabel, onTab, onOpenChange, onWidth, findings, detail,
}: GraphSideDockProps) {
  const drag = useRef<{ x: number; width: number; last: number } | null>(null)
  const show = (next: SideTab) => { onTab(next); onOpenChange(true) }
  /* 보이는 탭. 고른 탭(tab)은 그대로 두고, 보일 상세가 없는 동안만 탐지 결과를 보인다. 같은 칸을 다시 고르면 상세로 돌아온다 */
  const shown: SideTab = tab === 'detail' && hasDetail ? 'detail' : 'findings'

  if (!open) {
    return (
      <aside className="gx-side-rail" aria-label="오른쪽 패널 접힘">
        <button type="button" className="gx-side-rail-open" onClick={() => onOpenChange(true)} aria-label="패널 펼치기" title="패널 펼치기">
          <PanelRightOpen size={18} aria-hidden="true" />
        </button>
        <button type="button" className={shown === 'findings' ? 'is-active' : ''} onClick={() => show('findings')} aria-label={`탐지 결과 ${findingCount}개`} title="탐지 결과">
          <TriangleAlert size={18} aria-hidden="true" />
          <b>{findingCount}</b>
        </button>
        {hasDetail && (
          <button type="button" className={shown === 'detail' ? 'is-active' : ''} onClick={() => show('detail')} aria-label="상세" title={detailLabel ? `상세: ${detailLabel}` : '상세'}>
            <Info size={18} aria-hidden="true" />
          </button>
        )}
      </aside>
    )
  }

  return (
    <aside className="gx-side-dock" style={{ flexBasis: width, width }} aria-label="오른쪽 패널">
      <div
        className="gx-side-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="패널 폭"
        aria-valuemin={SIDE_MIN_WIDTH}
        aria-valuemax={SIDE_MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        title="끌어서 폭 조절"
        onPointerDown={event => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { x: event.clientX, width, last: width }
        }}
        onPointerMove={event => {
          if (!drag.current) return
          drag.current.last = clampSideWidth(drag.current.width + drag.current.x - event.clientX)
          onWidth(drag.current.last)
        }}
        onPointerUp={() => { if (drag.current) saveSideWidth(drag.current.last); drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const next = clampSideWidth(width + (event.key === 'ArrowLeft' ? 24 : -24))
          onWidth(next)
          saveSideWidth(next)
        }}
      />
      <div className="gx-side-tabs" role="tablist" aria-label="오른쪽 패널 내용">
        <button type="button" role="tab" aria-selected={shown === 'findings'} onClick={() => onTab('findings')}>
          탐지 결과 <span className="fn-count-tag">{findingCount}</span>
        </button>
        {hasDetail && (
          <button type="button" role="tab" aria-selected={shown === 'detail'} onClick={() => onTab('detail')} title={detailLabel}>
            상세
          </button>
        )}
        <button type="button" className="gx-side-collapse" onClick={() => onOpenChange(false)} aria-label="패널 접기" title="패널 접기">
          <PanelRightClose size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="gx-side-body" role="tabpanel">
        {shown === 'detail' ? detail : findings}
      </div>
    </aside>
  )
}
