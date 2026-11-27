import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 원 노드 그래프 (경로 만들기, SaaS 연결 공용). 고른 노드가 없으면 ring 을 둥글게 띄우고,
 * 고른 노드(focus)는 가운데, 그 앞에 지나온 노드(past)는 왼쪽에 작게, 다음 후보(kids)는 오른쪽으로 펼친다.
 * 같은 id 의 원은 자리만 옮기므로, 가지를 누르면 그 원이 가운데로 미끄러져 온다. 무엇을 띄울지는 쓰는 쪽이 정한다.
 */
export interface OrbItem {
  id: string
  icon: ReactNode
  name: string
  title: string
  /** 간선이나 후보가 없는 것. 흐리게 */
  empty?: boolean
  /** 원에 덧붙일 class (예: scb-risk-High) */
  tone?: string
  /** 원 오른쪽 위 작은 표 (예: 위험 등급) */
  badge?: string
}

const W = 860
const MIN_H = 440
/** 넓은 화면에서 키우는 상한과, 키울 때 넘지 않을 화면 높이 비율. 그래프 아래 목록 첫 줄이 첫 화면에 보이게 화면 높이의 절반까지만 키운다 */
const MAX_SCALE = 1.5
const HEIGHT_SHARE = 0.5
/** 원 지름: 처음 둘레, 가운데, 가지, 지나온 노드 */
const D_RING = 64
const D_FOCUS = 84
const D_CHILD = 54
const D_PAST = 44
/** 처음 화면에서 원을 놓는 타원 반지름 */
const RING_RX = 270
const RING_RY = 150
/** 가운데 원의 중심 x. 지나온 노드는 STEP 씩 왼쪽에 놓고, 그래프 왼쪽 밖으로 밀린 것은 감춘다 */
const FOCUS_CX = 320
const STEP = 120
/** 가지는 가운데에서 BRANCH_R 만큼 오른쪽, 위아래 ROW 간격. 가운데에서 멀수록 조금 왼쪽으로 휘게 둔다 */
const BRANCH_R = 230
const ROW = 66

interface Props {
  label: string
  ring: OrbItem[]
  past: OrbItem[]
  focus: OrbItem | null
  kids: OrbItem[]
  onRing: (id: string) => void
  onPast: (i: number) => void
  onKid: (id: string) => void
  /** 가운데 원을 눌렀을 때. 없으면 눌러도 아무 일 없음 */
  onFocus?: () => void
  focusHint?: string
  /** 가운데 원이 켜진 상태(예: 분석 열림) */
  focusOn?: boolean
  /** 있으면 고른 노드가 있을 때 그래프 왼쪽 위에 「처음으로」(둘레 화면)와, 두 단계 이상 들어갔으면 「한 단계 뒤로」 단추를 둔다 */
  onReset?: () => void
}

export default function OrbGraph({ label, ring, past, focus, kids, onRing, onPast, onKid, onFocus, focusHint, focusOn, onReset }: Props) {
  const H = Math.max(MIN_H, kids.length * ROW + 80)
  const cy = H / 2

  // 그래프는 W 폭으로 그리고 화면 폭에 맞춘다. 좁으면 줄이고, 넓으면 MAX_SCALE 까지 키우되 화면 높이의 HEIGHT_SHARE 를 넘지 않게 한다
  const wrapRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: W, viewH: 0 })
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setBox({ width: e.contentRect.width, viewH: window.innerHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const grow = box.viewH ? Math.max(1, Math.min(MAX_SCALE, (box.viewH * HEIGHT_SHARE) / H)) : 1
  const scale = Math.min(box.width / W, grow)

  // 선은 원이 자리를 옮긴 뒤에 보이도록 단계가 바뀔 때마다 새로 그린다.
  // 원 단추와 형제라서 원 id 와 겹치지 않게 앞에 lines: 를 붙인다
  const linesKey = `lines:${[...past, ...(focus ? [focus] : [])].map(o => o.id).join('>')}`
  const pastX = (i: number) => FOCUS_CX - STEP * (past.length - i)
  const kidPos = (i: number) => {
    const dy = (i - (kids.length - 1) / 2) * ROW
    return { x: FOCUS_CX + BRANCH_R - (dy * dy) / (BRANCH_R * 3), y: cy + dy }
  }
  const ringPos = (i: number) => {
    const t = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, ring.length)
    return { x: W / 2 + RING_RX * Math.cos(t), y: H / 2 + RING_RY * Math.sin(t) }
  }

  const orb = (o: OrbItem, x: number, y: number, d: number, role: string, side: 'below' | 'right', onClick: (() => void) | undefined, hint: string) => (
    <button
      type="button"
      key={o.id}
      data-node={o.id}
      data-empty={o.empty ? 'true' : undefined}
      className={`scb-orb ${role} is-${side}${o.empty ? ' is-empty' : ''}${o.tone ? ` ${o.tone}` : ''}`}
      style={{ left: x, top: y, opacity: x < 0 ? 0 : undefined, pointerEvents: x < 0 ? 'none' : undefined }}
      title={hint ? `${o.title}\n${hint}` : o.title}
      aria-label={o.title}
      onClick={onClick}
    >
      <span className="scb-orb-dot" style={{ width: d, height: d }}>
        {o.icon}
        {o.badge && <span className="scb-orb-badge">{o.badge}</span>}
      </span>
      <span className="scb-orb-text" style={side === 'below' ? { top: d / 2 + 4 } : { left: d / 2 + 8 }}>
        <span className="scb-orb-name">{o.name}</span>
      </span>
    </button>
  )

  return (
    <div className="scb-tree-wrap" ref={wrapRef} style={{ height: H * scale }} aria-label={label}>
      {focus && onReset && (
        <div className="scb-tree-back">
          {past.length > 0 && <button type="button" className="ex-btn" onClick={() => onPast(past.length - 1)} title={`${past[past.length - 1].name} 단계로 돌아간다`}>← 한 단계 뒤로</button>}
          <button type="button" className="ex-btn" onClick={onReset} title="고른 것을 지우고 처음 둘레 화면으로">처음으로</button>
        </div>
      )}
      <div className="scb-tree" style={{ width: W, height: H, marginLeft: Math.max(0, (box.width - W * scale) / 2), transform: scale !== 1 ? `scale(${scale})` : undefined }}>
        <svg width={W} height={H} key={linesKey} className="scb-tree-lines" aria-hidden="true">
          {focus && past.map((_, i) => (
            <line key={i} x1={Math.max(0, pastX(i))} y1={cy} x2={i === past.length - 1 ? FOCUS_CX : pastX(i + 1)} y2={cy} />
          ))}
          {focus && kids.map((k, i) => {
            const p = kidPos(i)
            return <line key={k.id} className={k.empty ? 'is-empty' : undefined} x1={FOCUS_CX} y1={cy} x2={p.x} y2={p.y} />
          })}
        </svg>
        {!focus && ring.map((o, i) => {
          const p = ringPos(i)
          return orb(o, p.x, p.y, D_RING, 'is-ring', 'below', () => onRing(o.id), '누르면 가운데로 온다')
        })}
        {focus && past.map((o, i) => orb(o, pastX(i), cy, D_PAST, 'is-past', 'below', () => onPast(i), '누르면 이 단계로 돌아간다'))}
        {focus && orb(focus, FOCUS_CX, cy, D_FOCUS, `is-focus${focusOn ? ' is-on' : ''}`, 'below', onFocus, focusHint ?? '')}
        {focus && kids.map((k, i) => {
          const p = kidPos(i)
          return orb(k, p.x, p.y, D_CHILD, 'is-child', 'right', () => onKid(k.id), '누르면 가운데로 온다')
        })}
      </div>
    </div>
  )
}
