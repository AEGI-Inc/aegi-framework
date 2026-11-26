import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useHovered, type HoverStore } from './hoverStore'
import type { CurvePoint, HoverDetails } from './hoverDetails'

/** 화면 배율과 무관한 공통 설명 상자. 포인터와 키보드 초점 모두 지원한다. */
export default function HoverTooltip({ store, canvasRef, tip, anchor, width, height, kind }: {
  store: HoverStore; canvasRef: { current: HTMLDivElement | null }; tip: HoverDetails | null
  anchor?: CurvePoint; width: number; height: number; kind: 'node' | 'edge' | 'effective-access'
}) {
  const hovered = useHovered(store)
  const [pointer, setPointer] = useState<CurvePoint | null>(null)
  const [dragging, setDragging] = useState(false)
  const elementRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 320, height: 160 })
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let last: CurvePoint | null = null
    const move = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      last = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      if (store.get()) setPointer(last)
    }
    const down = () => setDragging(true)
    const up = () => setDragging(false)
    const leave = () => { store.set(null); last = null; setPointer(null); setDragging(false) }
    const unsubscribe = store.subscribe(() => setPointer(store.get() ? last : null))
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointerleave', leave)
    window.addEventListener('pointerup', up)
    window.addEventListener('blur', leave)
    return () => {
      unsubscribe(); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointerleave', leave); window.removeEventListener('pointerup', up); window.removeEventListener('blur', leave)
    }
  }, [canvasRef, store])
  useLayoutEffect(() => {
    if (!elementRef.current) return
    const rect = elementRef.current.getBoundingClientRect()
    setSize(previous => previous.width === rect.width && previous.height === rect.height ? previous : { width: rect.width, height: rect.height })
  }, [tip, width, height, hovered, dragging])
  const point = pointer ?? anchor
  if (!hovered || !tip || !point || dragging) return null
  const x = point.x + 16 + size.width > width - 8 ? point.x - size.width - 12 : point.x + 16
  const y = point.y + 18 + size.height > height - 8 ? point.y - size.height - 12 : point.y + 18
  return <div ref={elementRef} className="gx-edge-tip" role="tooltip" data-tooltip-kind={kind}
    style={{ left: Math.max(8, Math.min(x, width - size.width - 8)), top: Math.max(8, Math.min(y, height - size.height - 8)),
      width: Math.min(320, Math.max(160, width - 16)), maxHeight: Math.max(80, height - 16), overflow: 'hidden' }}>
    <b>{tip.title}</b>{tip.direction && <span className="gx-edge-tip-dir">{tip.direction}</span>}<p>{tip.summary}</p>
    {!!tip.stats?.length && (
      <div className="gx-edge-tip-stats">
        {tip.stats.map(stat => <span key={stat.label} className={stat.alert ? 'is-alert' : undefined}>{stat.label} <strong>{stat.value}</strong></span>)}
      </div>
    )}
    {!!tip.facts?.length && (
      <dl className="gx-edge-tip-facts">
        {tip.facts.map(f => <Fragment key={`${f.label}-${f.value}`}><dt>{f.label}</dt><dd>{f.value}</dd></Fragment>)}
      </dl>
    )}
    {tip.notes.map(note => <span key={note.kind} className={`gx-edge-tip-note is-${note.kind}`}>{note.text}</span>)}
  </div>
}
