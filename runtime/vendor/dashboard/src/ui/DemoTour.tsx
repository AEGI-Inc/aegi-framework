import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import GuideLayer from './GuideLayer'
import { requestLanding, takePendingTour, TOUR_EVENT } from './tourRequest'
import { isPublicDemo } from '../publicDemo'
// 스타일(./demoTour.css)은 쓰는 쪽에서 불러온다. 공개 데모 체험 안내(src/tutorial/DemoTutorial.tsx)가 node 단위 시험에서도 그려지기 때문

/** 시연 한 단계: 강조할 곳(선택자. 여럿이면 화면에 보이는 첫 것), 같이 밝혀 둘 곳, 안내 글, 들어갈 때 할 일, 「다음」을 눌러 나갈 때 할 일.
 * ai 는 들어갈 때 할 일이 AI 답을 기다리는지. 기다리는 동안 「다음」 단추에 「AI 답변 대기 중」을 띄운다 */
export type TourStep = { target: string | string[]; also?: string[]; title: string; text: string; enter?: () => void | Promise<void>; leave?: () => void; ai?: boolean }

export const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
/** 시연을 시작할 때 경보 창(상황)만 보여 주는 시간 */
export const INTRO_MS = 2500
/** 시연의 상황 문장(「상황: …」, 「제보: …」)을 띠 이름과 본문으로 나눈다. 앞머리가 없으면 「상황」 */
export function splitTip(tip: string): { name: string; text: string } {
  const m = /^([^\s:]{1,6}):\s*([\s\S]*)$/.exec(tip.trim())
  return m ? { name: m[1], text: m[2] } : { name: '상황', text: tip.trim() }
}

export async function waitFor(selector: string, ms = 3000): Promise<HTMLElement | null> {
  for (let t = 0; t < ms; t += 100) { const el = document.querySelector<HTMLElement>(selector); if (el) return el; await wait(100) }
  return null
}

/*
 * 데모 시연(데모 모드). 「데모 시연」 단추로 시작해 「다음」마다 화면 한 곳을 강조하고 안내 카드를 띄운다.
 * 강조와 카드 배치는 안내 레이어(GuideLayer, docs/demo-tour-reference.md 참고)가 한다. 공개 데모 UC1 안내도 같은 레이어를 쓴다.
 * 「이전」, 「다음」, Esc 끝내기와 좌우 화살표. done 은 마지막 단계 뒤 완료 문장(UC1 과 같은 흐름)
 * tip(체험의 상황)은 시연 내내 화면 맨 위 경보 창에 크게 둔다. 「제보」는 위협 경보(빨강), 그 밖(「상황」)은 보안 점검(남색).
 * 경보 창 제목줄에 분류(tag), 시연 이름과 단계 번호, 아래 칸에 상황 문장. 단계 설명은 강조 자리를 가리키는 큰 말풍선에 둔다.
 * 경보 창이 앱을 덮지 않게 그 높이만큼 앱을 아래로 내린다(html 의 has-demo-tour-banner, --demo-tour-banner. demoTour.css)
 */
export default function DemoTour({ id, steps, label = '데모 시연', title, tag, tip, done, onStart, onEnd, autoStart = false, showButton = true }: { id?: string; steps: TourStep[]; label?: string; tip?: string; done?: string; onStart?: () => void; onEnd?: () => void
  /** 경보 창에 쓰는 시연 이름. 없으면 label(시작 단추 글자) */
  title?: string
  /** 경보 창 제목줄의 분류(데모 선택 카드의 배지와 같은 말) */
  tag?: string
  /** 그려지자마자 시작한다(공개 데모 데모 선택에서 고른 UC1) */
  autoStart?: boolean
  /** 「데모 시연」 시작 단추를 그린다 */
  showButton?: boolean }) {
  const [index, setIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [finished, setFinished] = useState(false)
  // 상황이 있으면 경보 창만 먼저 띄우고 INTRO_MS 뒤에 첫 단계 안내(말풍선, 강조)를 시작한다
  const [intro, setIntro] = useState(false)
  const introTimer = useRef<number | undefined>(undefined)
  // 타이머를 정리 함수에서 지우면 개발 모드(StrictMode)가 effect 를 한 번 정리했다 다시 돌릴 때 시연 요청(한 번만 받음)이 사라진다.
  // 그래서 지우지 않고, 화면에서 빠졌으면 첫 단계로 넘어가지 않는다
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const begin = () => {
    setFinished(false); onStart?.()
    window.clearTimeout(introTimer.current)
    if (!tip) { void go(0); return }
    setIntro(true)
    introTimer.current = window.setTimeout(() => { if (!alive.current) return; setIntro(false); void go(0) }, INTRO_MS)
  }
  // 다른 화면(데모 선택)에서 요청한 시연이면 시작한다(src/ui/tourRequest.ts)
  const beginRef = useRef(begin)
  beginRef.current = begin
  useEffect(() => { if (autoStart) beginRef.current() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!id) return
    if (takePendingTour(id)) beginRef.current()
    const listener = (event: Event) => { if ((event as CustomEvent).detail === id && takePendingTour(id)) beginRef.current() }
    window.addEventListener(TOUR_EVENT, listener)
    return () => window.removeEventListener(TOUR_EVENT, listener)
  }, [id])

  const go = async (next: number | null) => {
    if (next === null || next >= steps.length) {
      onEnd?.(); setIndex(null)
      setFinished(next !== null && !!done)
      return
    }
    setIndex(next); setBusy(true)
    try { await steps[next].enter?.() } finally { setBusy(false) }
  }
  // 공개 데모에서는 끝내면 데모 선택로 돌아간다
  const stop = () => { void go(null); if (isPublicDemo()) requestLanding() }
  const next = () => { if (index === null || busy) return; steps[index].leave?.(); void go(index + 1) }
  const previous = () => { if (index === null || busy || index === 0) return; void go(index - 1) }

  // 키보드: Esc 끝내기, → 다음, ← 이전. 글을 쓰는 칸에 있으면 건드리지 않는다
  useEffect(() => {
    if (index === null) return
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (event.key === 'Escape') { event.preventDefault(); stop() }
      else if (event.key === 'ArrowRight') { event.preventDefault(); next() }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); previous() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const nextButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (index !== null && !busy) nextButton.current?.focus({ preventScroll: true }) }, [index, busy])

  const step = index === null ? null : steps[index]
  const targets = step ? (Array.isArray(step.target) ? step.target : [step.target]) : null
  // 경보 창 높이를 재서 앱을 그만큼 내리고 말풍선이 경보 창 밑으로 들어가지 않게 한다
  const banner = useRef<HTMLDivElement>(null)
  const [bannerHeight, setBannerHeight] = useState(0)
  const showBanner = !!tip && (step !== null || finished || intro)
  // 안내 레이어가 대상을 굴리기 전에 띠 높이를 알도록 그리기 직후(layout effect)에 잰다
  useLayoutEffect(() => {
    const el = banner.current
    if (!showBanner || !el) { setBannerHeight(0); return }
    // 앱(메뉴, 그래프, Event Board)과 화면 오른쪽에 붙는 AI 창(src/assistant/assistant.css)을 경보 창 아래로 내린다
    const root = document.documentElement
    const measure = () => { const h = el.getBoundingClientRect().height; setBannerHeight(h); root.style.setProperty('--demo-tour-banner', `${h}px`) }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    root.classList.add('has-demo-tour-banner'); observer?.observe(el); measure()
    return () => { observer?.disconnect(); root.classList.remove('has-demo-tour-banner'); root.style.removeProperty('--demo-tour-banner') }
  }, [showBanner])
  const situation = tip ? splitTip(tip) : null
  const threat = situation?.name === '제보'
  const name = title ?? label
  return <>
    {showButton && <button type="button" className="ex-btn demo-tour-start" onClick={begin} disabled={index !== null || intro}>{label}</button>}
    {showBanner && situation && <div ref={banner} className={`demo-tour-banner ${threat ? 'is-threat' : 'is-check'}`} role="note" aria-label={`${name} ${situation.name}`}>
      <div className="demo-tour-banner-head">
        {threat && <svg className="demo-tour-banner-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 1 21h22L12 2Z" /><path d="M11 9h2v6h-2zM11 16.5h2v2h-2z" /></svg>}
        <b>{threat ? '위협 경보' : '보안 점검'}</b>
        {tag && <span className="demo-tour-banner-tag">{tag}</span>}
        <span className="demo-tour-banner-count">{name}{(step || !intro) && <b>{step ? `${index! + 1} / ${steps.length}` : '완료'}</b>}</span>
      </div>
      <div className="demo-tour-banner-body">
        {threat && <span className="demo-tour-banner-mark" aria-hidden="true">!</span>}
        <span className="demo-tour-banner-name">{situation.name}</span>
        <p>{situation.text}</p>
      </div>
    </div>}
    {step && <GuideLayer targets={targets} also={step.also} stepKey={index!} label={`${label} ${index! + 1}단계`} topInset={bannerHeight}>
      {!tip && <span className="demo-tour-count">{label} {index! + 1} / {steps.length}</span>}
      <ol className="demo-tour-progress" aria-label={`${steps.length}단계 중 ${index! + 1}단계`}>
        {steps.map((_, i) => <li key={i} className={i < index! ? 'is-done' : i === index ? 'is-current' : undefined} />)}
      </ol>
      <b>{index! + 1}. {step.title}</b>
      <p>{step.text}</p>
      <div className="demo-tour-actions">
        <button type="button" className="ex-btn" onClick={stop}>끝내기</button>
        <span className="demo-tour-move">
          {index! > 0 && <button type="button" className="ex-btn" onClick={previous} disabled={busy}>이전</button>}
          <button type="button" ref={nextButton} className="ex-btn demo-tour-next" onClick={next} disabled={busy} aria-busy={busy}>
            {busy && <i className="demo-tour-spin" aria-hidden="true" />}{busy && step.ai ? 'AI 답변 대기 중' : index === steps.length - 1 ? '마치기' : '다음'}
          </button>
        </span>
      </div>
    </GuideLayer>}
    {finished && done && <GuideLayer targets={null} stepKey="done" label={`${label} 완료`} topInset={bannerHeight}>
      {!tip && <span className="demo-tour-count">{label} 완료</span>}
      <b>시연 완료</b>
      <p>{done}</p>
      <div className="demo-tour-actions">
        <button type="button" className="ex-btn" onClick={begin}>다시 시작</button>
        {isPublicDemo()
          ? <button type="button" className="ex-btn demo-tour-next" onClick={() => { setFinished(false); requestLanding() }}>데모 시나리오 선택</button>
          : <button type="button" className="ex-btn demo-tour-next" onClick={() => setFinished(false)}>닫기</button>}
      </div>
    </GuideLayer>}
  </>
}
