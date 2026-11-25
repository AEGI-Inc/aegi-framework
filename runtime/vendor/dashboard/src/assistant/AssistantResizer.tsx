import { useEffect, useState } from 'react'

/**
 * AI 창 폭. 600px 고정이면 노트북(1536px)에서 본문이 725px로 줄어 화면마다 글자가 넘쳤다.
 * 기본은 480px로 두고, 창 왼쪽 가장자리를 끌거나 화살표 키로 바꾼다. 바꾼 폭은 이 브라우저에 기억한다.
 * 폭은 문서 루트의 --assistant-width로 내보내고, 창을 싣는 자리(assistant.css)가 그 값을 쓴다.
 */
const STORAGE_KEY = 'aegi.assistantWidth'
export const ASSISTANT_WIDTH_DEFAULT = 480
const MIN = 380
const STEP = 24
const maxWidth = () => Math.max(MIN, Math.min(900, Math.round(window.innerWidth * 0.5)))
const clamp = (value: number) => Math.min(maxWidth(), Math.max(MIN, Math.round(value)))

function readStored(): number {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY))
    return Number.isFinite(value) && value > 0 ? value : ASSISTANT_WIDTH_DEFAULT
  } catch {
    return ASSISTANT_WIDTH_DEFAULT
  }
}

export default function AssistantResizer() {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? ASSISTANT_WIDTH_DEFAULT : clamp(readStored())))

  useEffect(() => {
    document.documentElement.style.setProperty('--assistant-width', `${width}px`)
    try { window.localStorage.setItem(STORAGE_KEY, String(width)) } catch { /* 저장소를 못 쓰면 이번 창에서만 쓴다 */ }
  }, [width])

  useEffect(() => {
    const onResize = () => setWidth(previous => clamp(previous))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return <div className="assistant-resizer" role="separator" aria-orientation="vertical" aria-label="AI 창 폭 조절"
    aria-valuemin={MIN} aria-valuemax={typeof window === 'undefined' ? 900 : maxWidth()} aria-valuenow={width} tabIndex={0}
    title="AI 창 폭 조절"
    onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault()
      // 창 오른쪽 끝에서 커서까지가 새 폭이다. 끄는 동안 커서가 본문 위로 가도 놓치지 않게 window에서 받는다.
      const right = event.currentTarget.closest('.aegi-assistant')?.getBoundingClientRect().right ?? window.innerWidth
      const move = (e: PointerEvent) => setWidth(clamp(right - e.clientX))
      const stop = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', stop)
        window.removeEventListener('pointercancel', stop)
        document.body.classList.remove('assistant-resizing')
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', stop)
      window.addEventListener('pointercancel', stop)
      document.body.classList.add('assistant-resizing')
    }}
    onDoubleClick={() => setWidth(clamp(ASSISTANT_WIDTH_DEFAULT))}
    onKeyDown={event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); setWidth(previous => clamp(previous + STEP)) }
      else if (event.key === 'ArrowRight') { event.preventDefault(); setWidth(previous => clamp(previous - STEP)) }
      else if (event.key === 'Home') { event.preventDefault(); setWidth(clamp(ASSISTANT_WIDTH_DEFAULT)) }
    }} />
}
