import { useMemo, useCallback, useState, useRef, useEffect } from 'react'
import type { SemanticLevel } from './types'

interface ZoomStep {
  id: SemanticLevel
  label: string
  shortLabel: string
  description: string
}

const ZOOM_STEPS: readonly ZoomStep[] = [
  { id: 'ecosystem', label: 'SaaS 요약', shortLabel: 'SaaS', description: '연결된 SaaS의 서비스별 요약' },
  { id: 'tenant', label: '조직, 워크스페이스', shortLabel: '조직', description: '각 SaaS의 조직, 워크스페이스 단위 묶음' },
  { id: 'scope', label: '그룹, 리소스', shortLabel: '그룹', description: '그룹, 채널, 저장소, 역할 단위 묶음' },
  { id: 'object', label: '개별 객체', shortLabel: '객체', description: '사용자, 파일, 앱 등 수집한 객체 전체' },
] as const

interface SemanticZoomSliderProps {
  currentLevel: SemanticLevel
  onChangeLevel: (level: SemanticLevel) => void
  disabled?: boolean
}

export default function SemanticZoomSlider({
  currentLevel,
  onChangeLevel,
  disabled = false,
}: SemanticZoomSliderProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragPercent, setDragPercent] = useState<number | null>(null)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [isMenuHovered, setIsMenuHovered] = useState(false)

  useEffect(() => {
    const menuEl = rootRef.current?.closest('.gx-slider-menu')
    if (!menuEl) return
    const handleEnter = () => setIsMenuHovered(true)
    const handleLeave = () => {
      setIsMenuHovered(false)
      setHoveredIndex(null)
    }
    menuEl.addEventListener('mouseenter', handleEnter)
    menuEl.addEventListener('mouseleave', handleLeave)
    return () => {
      menuEl.removeEventListener('mouseenter', handleEnter)
      menuEl.removeEventListener('mouseleave', handleLeave)
    }
  }, [])

  const currentIndex = useMemo(() => {
    const idx = ZOOM_STEPS.findIndex(step => step.id === currentLevel)
    return idx === -1 ? 3 : idx
  }, [currentLevel])

  const shownIndex = isDragging && previewIndex !== null ? previewIndex : currentIndex
  const shownStep = ZOOM_STEPS[shownIndex] ?? ZOOM_STEPS[3]
  const activeTooltipIndex = isDragging && previewIndex !== null
    ? previewIndex
    : hoveredIndex !== null
      ? hoveredIndex
      : isMenuHovered
        ? shownIndex
        : null
  const tooltipStep = activeTooltipIndex !== null ? (ZOOM_STEPS[activeTooltipIndex] ?? shownStep) : null

  const staticPercent = (currentIndex / (ZOOM_STEPS.length - 1)) * 100
  const thumbPercent = isDragging && dragPercent !== null ? dragPercent : staticPercent

  const getStepFromClientX = useCallback((clientX: number): { index: number; percent: number } => {
    if (!trackRef.current) return { index: currentIndex, percent: staticPercent }
    const rect = trackRef.current.getBoundingClientRect()
    if (rect.width <= 0) return { index: currentIndex, percent: staticPercent }
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const maxIdx = ZOOM_STEPS.length - 1
    const nearestIndex = Math.round(ratio * maxIdx)
    const snapPoint = (nearestIndex / maxIdx) * 100
    const rawPercent = ratio * 100
    const snappedPercent = Math.abs(rawPercent - snapPoint) <= 4 ? snapPoint : rawPercent
    return {
      index: nearestIndex,
      percent: snappedPercent,
    }
  }, [currentIndex, staticPercent])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
    const { index, percent } = getStepFromClientX(e.clientX)
    setIsDragging(true)
    setDragPercent(percent)
    setPreviewIndex(index)
    setHoveredIndex(index)
    if (ZOOM_STEPS[index].id !== currentLevel) {
      onChangeLevel(ZOOM_STEPS[index].id)
    }
  }, [disabled, getStepFromClientX, currentLevel, onChangeLevel])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    const { index, percent } = getStepFromClientX(e.clientX)
    setHoveredIndex(index)
    if (!isDragging) return
    e.preventDefault()
    setDragPercent(percent)
    setPreviewIndex(index)
    if (ZOOM_STEPS[index].id !== currentLevel) {
      onChangeLevel(ZOOM_STEPS[index].id)
    }
  }, [isDragging, disabled, getStepFromClientX, currentLevel, onChangeLevel])

  const finishPointerDrag = useCallback((e: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!isDragging) return
    e.preventDefault()
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch {}
    const { index } = getStepFromClientX(e.clientX)
    setIsDragging(false)
    setDragPercent(null)
    setPreviewIndex(null)
    if (commit && ZOOM_STEPS[index].id !== currentLevel) {
      onChangeLevel(ZOOM_STEPS[index].id)
    }
  }, [isDragging, getStepFromClientX, currentLevel, onChangeLevel])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (disabled) return
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (currentIndex < ZOOM_STEPS.length - 1) {
          onChangeLevel(ZOOM_STEPS[currentIndex + 1].id)
        }
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault()
        if (currentIndex > 0) {
          onChangeLevel(ZOOM_STEPS[currentIndex - 1].id)
        }
      } else if (event.key === 'Home') {
        event.preventDefault()
        onChangeLevel(ZOOM_STEPS[0].id)
      } else if (event.key === 'End') {
        event.preventDefault()
        onChangeLevel(ZOOM_STEPS[ZOOM_STEPS.length - 1].id)
      }
    },
    [currentIndex, disabled, onChangeLevel]
  )

  return (
    <div
      ref={rootRef}
      className="sz-inline-slider"
      role="region"
      aria-label="보기 단위 조절"
      aria-describedby={tooltipStep ? 'sz-slider-tooltip' : undefined}
    >
      <div
        ref={trackRef}
        className={`sz-slider-track-wrap${isDragging ? ' is-dragging' : ''}`}
        role="slider"
        aria-label="보기 단위 슬라이더"
        aria-valuemin={0}
        aria-valuemax={ZOOM_STEPS.length - 1}
        aria-valuenow={shownIndex}
        aria-valuetext={`${shownStep.label} (${shownStep.description})`}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => { if (!isDragging) setHoveredIndex(null) }}
        onPointerUp={e => finishPointerDrag(e, true)}
        onPointerCancel={e => finishPointerDrag(e, false)}
      >
        <div className="sz-slider-rail" />
        <div
          className="sz-slider-fill"
          style={{ width: `${thumbPercent}%` }}
        />

        <div className="sz-slider-ticks" aria-hidden="true">
          {ZOOM_STEPS.map((step, index) => {
            const stepPercent = (index / (ZOOM_STEPS.length - 1)) * 100
            const isPassed = stepPercent <= thumbPercent + 0.5
            const isHovered = hoveredIndex === index
            return (
              <span
                key={step.id}
                className={`sz-slider-tick${isPassed ? ' is-passed' : ''}${isHovered ? ' is-hovered' : ''}`}
                style={{ left: `${stepPercent}%` }}
              />
            )
          })}
        </div>

        <div
          className={`sz-slider-thumb${isDragging ? ' is-dragging' : ''}`}
          style={{ left: `${thumbPercent}%` }}
          aria-hidden="true"
        />
      </div>

      <div className="sz-slider-labels">
        {ZOOM_STEPS.map((step, index) => {
          const isSelected = index === shownIndex
          const isHovered = hoveredIndex === index
          const stepPercent = (index / (ZOOM_STEPS.length - 1)) * 100

          return (
            <button
              type="button"
              key={`label-${step.id}`}
              data-level={step.id}
              className={`sz-slider-label-btn${isSelected ? ' is-selected' : ''}${isHovered ? ' is-hovered' : ''}`}
              style={{ left: `${stepPercent}%` }}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(prev => (prev === index ? null : prev))}
              onFocus={() => setHoveredIndex(index)}
              onBlur={() => setHoveredIndex(prev => (prev === index ? null : prev))}
              onClick={e => {
                e.stopPropagation()
                if (!disabled) {
                  onChangeLevel(step.id)
                }
              }}
              disabled={disabled}
            >
              <span>{step.shortLabel}</span>
            </button>
          )
        })}
      </div>

      {tooltipStep && (
        <div id="sz-slider-tooltip" className="sz-slider-tooltip" role="tooltip">
          <strong className="sz-slider-tooltip-title">{tooltipStep.label}</strong>
          <p className="sz-slider-tooltip-desc">{tooltipStep.description}</p>
        </div>
      )}
    </div>
  )
}
