import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/*
 * 안내 레이어: 배경을 어둡게 하고 대상 자리만 뚫어(SVG even-odd) 보이게 하고, 안내 카드를 그 옆에 둔다.
 * 데모 시연(DemoTour)과 공개 데모 UC1 안내(src/tutorial/DemoTutorial.tsx)가 같이 쓴다. 스타일은 src/ui/demoTour.css(쓰는 쪽에서 불러온다.
 * 데모 선택 단위 시험이 node 에서 그리므로 여기서는 CSS 를 불러오지 않는다).
 * 참고: docs/demo-tour-reference.md. 대상 자리는 매 프레임 다시 읽어 굴리거나 화면이 바뀌어도 따라가고, 단계가 바뀌면 이전 자리에서 0.4초 동안 옮겨 간다.
 * 어두운 부분은 클릭을 막기만 하고 끝내지 않는다. 구멍 안은 그대로 누를 수 있다. 대상이 없으면 어둡게 하지 않고 카드를 화면 아래에 둔다.
 * 움직임 줄이기 설정이면 옮겨 가는 애니메이션을 끈다. 모서리는 이 저장소 규칙대로 각지게 둔다
 */
export type Box = { x: number; y: number; w: number; h: number }
const MOVE_MS = 400, PAD = 8, GAP = 14, EDGE = 16

/** 안내 카드 뒤의 어두운 배경과 강조 구멍 */
export function GuideOverlay({ boxes }: { boxes: readonly Box[] }) {
  if (typeof window === 'undefined' || !boxes.length) return null
  const vw = window.innerWidth, vh = window.innerHeight
  const holes = boxes.map(box => ({ x: box.x - PAD, y: box.y - PAD, w: box.w + PAD * 2, h: box.h + PAD * 2 }))
  return <svg className="demo-tour-overlay" width={vw} height={vh} viewBox={`0 0 ${vw} ${vh}`} aria-hidden="true">
    <path className="demo-tour-dim" fillRule="evenodd" d={`M0 0H${vw}V${vh}H0Z${holes.map(o => `M${o.x} ${o.y}h${o.w}v${o.h}h${-o.w}Z`).join('')}`} />
    {holes.map((o, i) => <rect key={i} className="demo-tour-hole" x={o.x} y={o.y} width={o.w} height={o.h} />)}
  </svg>
}

/* 선택자 가운데 크기가 있는(숨지 않은) 첫 요소 */
export const visibleTarget = (selectors: readonly string[]) => {
  for (const s of selectors) { const el = document.querySelector<HTMLElement>(s); if (el && el.getBoundingClientRect().width > 0) return el }
  return null
}

export default function GuideLayer({ targets, also, stepKey, scroll = true, className = '', label, topInset = 0, children }: {
  /** 강조할 곳. 여럿이면 화면에 보이는 첫 것. null 이면 강조 없이 카드만 */
  targets: readonly string[] | null
  /** 강조할 곳과 함께 밝혀 둘 곳(보이는 것 모두). 카드는 여기를 가리지 않는 자리에 둔다 */
  also?: readonly string[]
  /** 단계가 바뀌면 바뀌는 값. 강조 자리가 이전 자리에서 새 자리로 옮겨 가고 카드가 다시 나타난다 */
  stepKey: string | number
  /** 대상을 처음 찾으면 화면 가운데로 굴린다 */
  scroll?: boolean
  className?: string
  label: string
  /** 화면 위를 덮는 띠(시연의 상황 띠)의 높이. 카드는 그 아래에만 둔다 */
  topInset?: number
  children: ReactNode
}) {
  const [shown, setShown] = useState<Box | null>(null)
  const [extra, setExtra] = useState<Box[]>([])
  const last = useRef<Box | null>(null)
  const selectorKey = `${targets?.join('|') ?? ''}#${also?.join('|') ?? ''}`
  useEffect(() => {
    if (!targets) { last.current = null; setShown(null); setExtra([]); return }
    let stop = false, frame = 0, scrolled = false, began = 0, restore = () => {}
    const from = last.current
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const follow = () => {
      if (stop) return
      const el = visibleTarget(targets)
      // 대상이 아직 없으면(단계에 들어가는 일을 하는 중) 지금 자리를 그대로 두고 기다린다
      if (!el) { frame = requestAnimationFrame(follow); return }
      if (!scrolled) {
        scrolled = true; began = performance.now()
        // 화면 위 상황 띠(DemoTour 가 --demo-tour-banner 로 높이를 둔다) 밑으로 들어가지 않게 굴린다. 화면보다 긴 대상은 위 끝을 띠 바로 아래에 맞춘다
        if (scroll) {
          const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--demo-tour-banner')) || 0
          const before = el.style.scrollMarginTop
          el.style.scrollMarginTop = `${inset + PAD + EDGE}px`
          restore = () => { el.style.scrollMarginTop = before }
          const tall = el.getBoundingClientRect().height + PAD * 2 > window.innerHeight - inset - EDGE * 2
          el.scrollIntoView({ block: tall ? 'start' : 'center', behavior: reduce ? 'auto' : 'smooth' })
        }
      }
      const r = el.getBoundingClientRect(), to = { x: r.left, y: r.top, w: r.width, h: r.height }
      const t = reduce || !from ? 1 : Math.min(1, (performance.now() - began) / MOVE_MS)
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      const box = from && t < 1 ? { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e } : to
      last.current = box
      setShown(prev => prev && prev.x === box.x && prev.y === box.y && prev.w === box.w && prev.h === box.h ? prev : box)
      const boxes = (also ?? []).map(s => document.querySelector<HTMLElement>(s)).filter((e): e is HTMLElement => !!e && e !== el && e.getBoundingClientRect().width > 0)
        .map(e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } })
      setExtra(prev => JSON.stringify(prev) === JSON.stringify(boxes) ? prev : boxes)
      frame = requestAnimationFrame(follow)
    }
    follow()
    return () => { stop = true; cancelAnimationFrame(frame); restore() }
  }, [stepKey, selectorKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // 카드는 강조 자리 아래, 위, 오른쪽, 왼쪽 순으로 빈 곳에 둔다. 다 안 되면 화면 아래. 카드의 꼬리(side)는 강조 자리 쪽을 가리킨다
  const card = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 360, h: 200 })
  useLayoutEffect(() => {
    const el = card.current
    if (el && (el.offsetWidth !== size.w || el.offsetHeight !== size.h)) setSize({ w: el.offsetWidth, h: el.offsetHeight })
  })
  if (typeof window === 'undefined') return null
  const vw = window.innerWidth, vh = window.innerHeight, m = EDGE, top = topInset + EDGE, { w: cw, h: ch } = size
  const hole = shown && { x: shown.x - PAD, y: shown.y - PAD, w: shown.w + PAD * 2, h: shown.h + PAD * 2 }
  const clampX = (v: number) => Math.min(Math.max(v, m), vw - cw - m), clampY = (v: number) => Math.min(Math.max(v, top), vh - ch - m)
  const holes = extra.map(b => ({ x: b.x - PAD, y: b.y - PAD, w: b.w + PAD * 2, h: b.h + PAD * 2 }))
  // 함께 밝힌 곳을 가리는 자리는 고르지 않는다. 빈 곳이 없으면 함께 밝힌 곳이 있을 때는 강조 자리 안 왼쪽 아래,
  // 없을 때(화면보다 긴 대상)는 강조 자리 왼쪽과 오른쪽 가운데 넓은 쪽 화면 아래에 둔다. 대상 가운데를 덮지 않는다
  const free = (p: { top: number; left: number }) => !holes.some(o => p.left < o.x + o.w && p.left + cw > o.x && p.top < o.y + o.h && p.top + ch > o.y)
  type Place = { top: number; left: number; side?: 'below' | 'above' | 'right' | 'left' }
  const candidates: (Place | false)[] = !hole ? [] : [
    hole.y + hole.h + GAP + ch <= vh - m && { top: Math.max(hole.y + hole.h + GAP, top), left: clampX(hole.x), side: 'below' },
    hole.y - GAP - ch >= top && { top: hole.y - GAP - ch, left: clampX(hole.x), side: 'above' },
    hole.x + hole.w + GAP + cw <= vw - m && { top: clampY(hole.y), left: hole.x + hole.w + GAP, side: 'right' },
    hole.x - GAP - cw >= m && { top: clampY(hole.y), left: hole.x - GAP - cw, side: 'left' },
  ]
  const options = candidates.filter((p): p is Place => !!p && free(p))
  const place: Place = !hole ? { top: vh - ch - 24, left: clampX((vw - cw) / 2) }
    : options[0] ?? (holes.length ? { top: clampY(hole.y + hole.h - ch - m), left: clampX(hole.x + m) }
      : { top: vh - ch - m, left: hole.x >= vw - hole.x - hole.w ? clampX(hole.x - GAP - cw) : clampX(hole.x + hole.w + GAP) })
  // 꼬리 위치: 위아래에 붙으면 강조 자리 가운데 x, 카드 모서리에서 28px 안쪽.
  // 옆에 붙으면 강조 자리 세로 범위 안에서 카드 위쪽(40px)에 가장 가깝게 둔다. 긴 대상의 가운데를 따라가면 꼬리가 아래 「다음」 단추 옆에 붙는다
  const sideArrow = (h: Box) => {
    const lo = Math.max(h.y - place.top, 28), hi = Math.min(h.y + h.h - place.top, ch - 28)
    return lo <= hi ? Math.min(Math.max(40, lo), hi) : Math.min(Math.max(h.y + h.h / 2 - place.top, 28), ch - 28)
  }
  const arrow = !hole || !place.side ? undefined : place.side === 'below' || place.side === 'above'
    ? Math.min(Math.max(hole.x + hole.w / 2 - place.left, 28), cw - 28)
    : sideArrow(hole)
  return <>
    {shown && <GuideOverlay boxes={[shown, ...extra]} />}
    <div key={stepKey} ref={card} className={`demo-tour-card ${className}`} data-side={place.side}
      style={{ top: place.top, left: place.left, ...(arrow === undefined ? {} : { '--arrow': `${arrow}px` }) } as CSSProperties} role="dialog" aria-label={label} aria-live="polite">{children}</div>
  </>
}
