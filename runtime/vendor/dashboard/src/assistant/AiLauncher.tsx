import { useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import AiLogo from './AiLogo'
import './assistant.css'

export function focusAiLauncher() {
  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-ai-launcher]')?.focus())
}

/**
 * 우측 하단 AI 버튼 숨기기. 화면 구석을 계속 가려 거슬린다는 사람을 위해 단추의 ×로 끄고,
 * AI 창 머리의 「하단 단추 보이기」로 다시 켠다. 끈 상태는 이 브라우저에 기억한다.
 * AI는 꺼도 메뉴의 「AEGI AI에게 질문」과 Ctrl+K로 연다.
 */
const HIDDEN_KEY = 'aegi.aiLauncherHidden'
const listeners = new Set<() => void>()
let hidden = (() => {
  try { return typeof window !== 'undefined' && window.localStorage.getItem(HIDDEN_KEY) === '1' } catch { return false }
})()

export function setAiLauncherHidden(next: boolean) {
  hidden = next
  try {
    if (next) window.localStorage.setItem(HIDDEN_KEY, '1')
    else window.localStorage.removeItem(HIDDEN_KEY)
  } catch { /* 저장소를 못 쓰면 이번 창에서만 숨긴다 */ }
  listeners.forEach(listener => listener())
}

export function useAiLauncherHidden() {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => hidden,
    () => false,
  )
}

export default function AiLauncher({ onClick, selected = false, graph = false }: {
  onClick: () => void
  selected?: boolean
  graph?: boolean
}) {
  const isHidden = useAiLauncherHidden()
  if (isHidden) return null
  return (
    <div className={`assistant-launcher-wrap${graph ? ' is-graph' : ''}`}>
      <button
        type="button"
        className={`assistant-launcher${graph ? ' assistant-launcher-graph' : ''}`}
        data-ai-launcher
        aria-label={selected ? '선택 항목 AEGI AI 질문' : 'AEGI AI 열기'}
        aria-expanded={false}
        aria-controls="aegi-ai-panel"
        title="Ctrl+K로 AEGI AI 열기"
        onClick={onClick}
      >
        <AiLogo size={44} />
      </button>
      <button
        type="button"
        className="assistant-launcher-hide"
        aria-label="하단 AI 버튼 숨기기"
        title="하단 AI 버튼 숨기기"
        onClick={() => setAiLauncherHidden(true)}
      >
        <X size={12} strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>
  )
}
