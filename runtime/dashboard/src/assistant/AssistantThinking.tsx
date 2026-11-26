import { useEffect, useRef, useState } from 'react'
import { ThinkingOrb, type OrbState } from 'thinking-orbs'
import { TOOL_LABELS, type ToolProgress } from './toolProgress'

export const THINKING_ORB_STATES: OrbState[] = ['solving', 'listening']

export default function AssistantThinking({ tools }: { tools: ToolProgress[] }) {
  const [variation, setVariation] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const startedAt = Date.now()
    const secTimer = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    }, 250)
    return () => clearInterval(secTimer)
  }, [])

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timer: ReturnType<typeof setInterval> | undefined
    const update = () => {
      clearInterval(timer)
      if (!motion.matches && THINKING_ORB_STATES.length > 1) {
        timer = setInterval(() => {
          if (!document.hidden && container.current?.getClientRects().length) {
            setVariation(value => (value + 1) % THINKING_ORB_STATES.length)
          }
        }, 6000)
      }
    }
    update()
    motion.addEventListener('change', update)
    return () => {
      clearInterval(timer)
      motion.removeEventListener('change', update)
    }
  }, [])

  const currentState = THINKING_ORB_STATES[variation % THINKING_ORB_STATES.length]

  return (
    <div className="assistant-loading" ref={container}>
      <div className="assistant-thinking-orb" aria-hidden="true">
        <ThinkingOrb state={currentState} size={32} theme="light" />
      </div>
      <div className="assistant-thinking-copy" role="status" aria-live="polite">
        <span className="assistant-thinking-headline">
          분석 중 <em className="assistant-thinking-seconds">{elapsedSeconds}초</em>
        </span>
        {tools.length > 0 && <ol className="assistant-tool-progress" aria-label="도구 실행 과정">
          {tools.slice(-5).map(tool => <li key={tool.id} data-status={tool.status}>
            <span className="assistant-tool-label">{TOOL_LABELS[tool.name]} <code>{tool.name}</code></span>
            <span className="assistant-tool-state">{tool.status === 'running' ? '실행 중' : tool.status === 'complete' ? '실행 완료' : '실행 실패'}</span>
          </li>)}
        </ol>}
      </div>
    </div>
  )
}
