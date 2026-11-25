import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, CirclePlay } from 'lucide-react'
import type { Page } from '../appRouting'
import { getConversation, useConversations } from '../assistant/conversationStore'
import type { FindingV2 } from '../model/findingV2'
import { LANDING_SAAS, LANDING_SLOTS, landingSlotById, tourUseCaseById, useCaseById, type LandingSlot, type StepScreen, type TutorialPrompt } from './useCases'
import { TUTORIAL_STORAGE_KEY as STORAGE_KEY } from './tutorialStorage'
import type { ProviderId } from '../providerOverviewData'
import { LANDING_EVENT, requestTour } from '../ui/tourRequest'
import DemoTour, { wait, waitFor, type TourStep } from '../ui/DemoTour'
import { gapViews, markOf, outsideKeys, type StepMark, type TutorialView } from './tutorialSteps'

/**
 * 공개 데모 체험 안내. 그래프 화면에서 체험(설정이 있는 UC, 자유 탐색)을 고른다. 공개 데모 빌드(isPublicDemo)에서만 그린다.
 * UC1~UC4 는 데모 시연(DemoTour)으로 「다음」마다 시연이 단계 설정의 화면(위협 상세, 그래프, Event Board)을 열고 추천 질문을 AI 에 보낸다. 답변은 실제 AI 답 그대로다.
 * UC2-2 는 Compliance 화면의 데모 시연으로 옮겨 시작한다.
 */

type Mode = 'landing' | 'run' | 'done' | 'free'
interface TutorialState { mode: Mode; useCase: string; step: number; marks: Record<number, StepMark> }

const initial: TutorialState = { mode: 'landing', useCase: '', step: 1, marks: {} }

/* 새로고침해도 같은 탭에서는 보던 단계를 이어 간다. 저장소를 못 쓰거나 설정이 없어진 체험이면 데모 선택부터 */
function readState(): TutorialState {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null') as TutorialState | null
    if (parsed && ['landing', 'free'].includes(parsed.mode)) return { ...initial, mode: parsed.mode }
    const saved = parsed ? useCaseById(parsed.useCase) : undefined
    if (parsed && saved && ['run', 'done'].includes(parsed.mode) && parsed.step >= 1 && parsed.step <= saved.steps.length) return parsed
  } catch { /* 처음부터 */ }
  return initial
}

export default function DemoTutorial({ page, graphEntry, findings, onAsk, onOpenGraph, onOpenGraphObject, onOpenEventBoard, onOpenThreat, logo }: {
  page: Page
  graphEntry: { key: number; objectKey?: string }
  /** 위협 판정 V2 위협. Access Gap 벤(threatAccessGap)이 있는 위협이 체험 단계 판정에 쓰인다 */
  findings: readonly FindingV2[]
  onAsk: (question: string, objectKeys?: string[]) => void
  onOpenGraph: () => void
  /** 그래프를 그 객체에 맞춰 연다(UC1 1단계의 자산) */
  onOpenGraphObject: (objectKey: string) => void
  onOpenEventBoard: () => void
  /** 체험의 위협 상세를 연다(Threat 상세 주소의 finding) */
  onOpenThreat?: (findingId: string) => void
  /** 데모 선택의 SaaS 로고(연결 그림, 시나리오 범위). App 이 ProviderLogo 를 넘긴다(로고 그림 파일을 node 단위 시험이 읽지 못해 밖에서 받는다) */
  logo?: (provider: ProviderId) => ReactNode
}) {
  const [state, setState] = useState(readState)
  useEffect(() => {
    try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* 기억하지 못해도 안내는 그대로 쓴다 */ }
  }, [state])
  // 「데모 시나리오 선택」 단추는 왼쪽 메뉴 맨 아래에 붙인다. 메뉴는 App 이 그리므로 App 이 둔 빈 자리(.demo-tutorial-reopen-wrap)를 찾아 portal 로 넣는다
  const [menuSlot, setMenuSlot] = useState<Element | null>(null)
  useEffect(() => { setMenuSlot(document.querySelector('.sidebar-nav .demo-tutorial-reopen-wrap')) }, [])
  const { current: conversation } = useConversations()
  const gaps = useMemo(() => gapViews(findings), [findings])
  const view: TutorialView = useMemo(() => ({ page, graphEntry, conversationId: conversation.id, turns: conversation.turns, gaps }),
    [page, graphEntry, conversation, gaps])
  const useCase = useCaseById(state.useCase)

  const start = (id: string) => setState({ mode: 'run', useCase: id, step: 1, marks: { 1: markOf(view) } })
  const toLanding = () => { setState(initial); onOpenGraph() }
  // 화면을 움직이는 체험(UC2-2)을 마치거나 끝내면 데모 선택로 돌아온다(src/ui/tourRequest.ts)
  const toLandingRef = useRef(toLanding)
  toLandingRef.current = toLanding
  useEffect(() => {
    const listener = () => toLandingRef.current()
    window.addEventListener(LANDING_EVENT, listener)
    return () => window.removeEventListener(LANDING_EVENT, listener)
  }, [])

  if (state.mode === 'landing') {
    if (page !== 'Graph') return null
    // 첫 화면은 앱 화면 전체를 덮는다. 고르기 전에는 그래프, 메뉴, 탐지 결과가 보이지 않는다.
    // 왼쪽 남색 칸에 SaaS 여섯 개가 AEGI 에 이어진 그림과 소개, 오른쪽 흰 칸에 시나리오 목록
    const row = (slot: LandingSlot) => {
      const item = useCaseById(slot.id), tour = tourUseCaseById(slot.id)
      // 화면을 움직이는 시연은 그 화면으로 옮겨 시작하고, 안내 카드 대신 「데모 선택」 단추만 남긴다
      const open = item ? () => start(item.id) : tour ? () => { setState({ ...initial, mode: 'free' }); requestTour(tour.id, tour.hash) } : undefined
      const summary = item?.summary ?? tour?.summary ?? '준비 중'
      return <button type="button" key={slot.id} className="demo-landing-card" onClick={open} disabled={!open}
        aria-label={item?.title ?? tour?.title ?? slot.label} aria-describedby={`demo-landing-summary-${slot.id}`}>
        <span className="demo-landing-meta">
          <span className={`demo-landing-badge is-${slot.tone}`}>{slot.badge}</span>
          {slot.scope.providers ? <span className="demo-landing-logos" aria-hidden="true">{slot.scope.providers.map(p => <span key={p}>{logo?.(p)}</span>)}</span>
            : <span>{slot.scope.text}</span>}
        </span>
        <b className="demo-landing-name">{slot.name}</b>
        <span className="demo-landing-summary" id={`demo-landing-summary-${slot.id}`}>{summary}</span>
        <span className="demo-landing-go">{open ? '시연 시작' : '준비 중'}</span>
      </button>
    }
    return <section className="demo-tutorial-landing" role="dialog" aria-modal="true" aria-labelledby="demo-tutorial-landing-title">
      <div className="demo-landing-intro">
        <b className="demo-landing-brand">AEGI</b>
        <span className="demo-landing-graph" aria-hidden="true">
          <svg viewBox="0 0 460 460">
            {HEX.map(([x, y], i) => { const [nx, ny] = HEX[(i + 1) % HEX.length]; return <line key={`r${i}`} className="demo-landing-ring" x1={x} y1={y} x2={nx} y2={ny} /> })}
            {HEX.map(([x, y], i) => <line key={`s${i}`} x1={230} y1={230} x2={x} y2={y} />)}
          </svg>
          {LANDING_SAAS.map((p, i) => <span key={p} className="demo-landing-saas" style={{ left: `${HEX[i][0] / 4.6}%`, top: `${HEX[i][1] / 4.6}%` }}>{logo?.(p)}</span>)}
          <span className="demo-landing-core">AEGI</span>
        </span>
        <p className="demo-landing-tagline">기업 환경의 Cross-SaaS{' '}<br />위협 분석 프레임워크</p>
      </div>
      <div className="demo-landing-main">
        <h2 id="demo-tutorial-landing-title">데모 시나리오 선택</h2>
        <div className="demo-tutorial-options">{LANDING_SLOTS.map(row)}</div>
        <button type="button" className="demo-landing-free" onClick={() => setState({ ...initial, mode: 'free' })} aria-describedby="demo-landing-free-text">직접 둘러보기</button>
        <span id="demo-landing-free-text" className="demo-tutorial-sr">안내 없이 그래프, 위협, Event Board를 직접 둘러봅니다.</span>
      </div>
    </section>
  }
  if (state.mode === 'free' || !useCase) {
    const label = '데모 시나리오 선택'
    if (!menuSlot) return null
    return createPortal(<button type="button" className="demo-tutorial-reopen" title={label} aria-label={label} onClick={toLanding}>
      <CirclePlay size={18} strokeWidth={1.75} aria-hidden="true" /><span className="nav-label">{label}</span><ChevronRight className="demo-tutorial-reopen-go" size={18} strokeWidth={1.75} aria-hidden="true" />
    </button>, menuSlot)
  }

  // 체험도 데모 시연(src/ui/DemoTour.tsx)처럼 「다음」을 누르면 시연이 단계의 화면을 열고, AI 에게 묻고 답을 기다린다.
  // 질문 문구와 대상 키는 useCases.ts 설정 그대로. 마치거나 끝내면 데모 선택로 돌아온다(LANDING_EVENT)
  const keysFor = (prompt: TutorialPrompt) => prompt.select === 'asset' ? useCase.targets.assetKeys.slice(0, 1) : prompt.select === 'outside' ? outsideKeys(view, useCase).slice(0, 1) : []
  // onBoard: Event Board 에서는 보드의 AI 창으로 보낸다(App askAssistant 와 같은 사건). 단계 함수는 화면을 옮기기 전 렌더의 onAsk 를 쥐고 있어 직접 보낸다
  const askAndWait = async (prompt: TutorialPrompt, onBoard = false) => {
    const before = getConversation(), last = Math.max(0, ...before.turns.map(t => t.id))
    const keys = keysFor(prompt)
    if (onBoard) window.dispatchEvent(new CustomEvent('aegi:event-board-ai', { detail: { question: prompt.question } }))
    else onAsk(prompt.question, keys.length ? keys : undefined)
    for (let t = 0; t < ANSWER_WAIT_MS; t += 500) {
      const now = getConversation()
      if (now.turns.some(turn => (now.id !== before.id || turn.id > last) && (turn.answer || turn.error))) return
      await wait(500)
    }
  }
  const aiOrGraph = ['#aegi-ai-panel', '.unified-graph-canvas']
  // 단계마다 지금 있는 화면: 그 단계가 연 화면, 없으면 앞 단계의 화면
  const screens = useCase.steps.reduce<StepScreen[]>((acc, step) => [...acc, step.open ?? acc[acc.length - 1] ?? 'graph'], [])
  const steps: TourStep[] = useCase.steps.map((step, index) => {
    const screen = screens[index]
    return {
      title: step.title,
      text: step.auto ?? step.guide,
      ai: !!step.prompts[0] && step.ask !== false,
      // 위협 상세는 상세 머리를, Event Board 는 보드를 강조하고 보드에 보낸 질문의 답이 보이게 AI 창도 밝혀 둔다
      target: screen === 'threat' ? ['.finding-detail-header', '.finding-detail-workbench'] : screen === 'board' ? ['.event-investigation', ...aiOrGraph] : aiOrGraph,
      also: screen === 'board' ? ['#aegi-ai-panel'] : undefined,
      enter: async () => {
        if (step.open === 'threat') { onOpenThreat?.(useCase.findingId); await waitFor('.finding-detail-header') }
        if (step.open === 'graph' && useCase.targets.assetKeys[0]) onOpenGraphObject(useCase.targets.assetKeys[0])
        if (step.open === 'board') { onOpenEventBoard(); await waitFor('.event-investigation'); await wait(800) }
        const prompt = step.prompts[0]
        if (prompt && step.ask !== false) await askAndWait(prompt, screen === 'board')
      },
    }
  })
  return <DemoTour key={useCase.id} label={useCase.title} tag={landingSlotById(useCase.id)?.badge} steps={steps} tip={useCase.tip} done={useCase.done} autoStart showButton={false} />
}

/** 첫 화면 SaaS 연결 그림의 육각형 꼭짓점(460 칸 기준, 위부터 시계 방향). 공개 데모 로딩 화면(src/tutorial/demoBoot.html)과 같은 자리 */
const HEX: readonly (readonly [number, number])[] = [[230, 40], [394.5, 135], [394.5, 325], [230, 420], [65.5, 325], [65.5, 135]]

/** AI 답을 기다리는 가장 긴 시간. 로그 검색이 낀 답은 수십 초 걸린다 */
const ANSWER_WAIT_MS = 180_000
