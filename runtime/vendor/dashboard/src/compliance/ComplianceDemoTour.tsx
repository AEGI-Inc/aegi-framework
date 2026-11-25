import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import AssistantThinking from '../assistant/AssistantThinking'
import type { ToolProgress } from '../assistant/toolProgress'
import type { GraphStoreV2 } from '../model/graph'
import { useAssistantBridge } from '../assistant/AssistantBridge'
import { guidelineCriterion } from '../assistant/complianceTools'
import { getConversation, updateTurns } from '../assistant/conversationStore'
import { buildEvidenceStore } from '../data/datasetStore'
import '../ui/demoTour.css'
import DemoTour, { wait, waitFor, type TourStep } from '../ui/DemoTour'
import { isPublicDemo } from '../publicDemo'
import { landingSlotById, tourUseCaseById } from '../tutorial/useCases'
import { criteriaFor, removeCriterion, saveCriterion } from './customCriteria'
import { DEMO_CRITERION, DEMO_NAME, DEMO_QUESTION, GUIDELINES } from './demoTour'

/** React가 관리하는 입력칸에 값을 넣는다(onChange 가 불리게) */
function setInput(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const demoDraft = () => criteriaFor(DEMO_CRITERION).find(c => c.name === DEMO_NAME)

/*
 * Compliance 시연: 바뀐 기준을 AI 에게 보내고, AI 가 만든 추가 기준 초안을 현행 기준과 비교한다.
 * 가이드라인은 등록된 문서(GUIDELINES)라 AI 는 guideline_criterion 으로 정해 둔 검사를 붙인다(언제 물어도 같다).
 * AI 가 답했는데 초안이 없으면(모델 연결이 없거나 도구를 부르지 않음) 잠시 기다렸다가 같은 도구를 화면에서 불러 붙이고 넘어간다
 */
/** AI 답을 기다리는 가장 긴 시간 */
const ANSWER_WAIT_MS = 180_000
/** 답이 온 뒤 AI 초안이 붙기를 기다리는 시간 */
const DRAFT_WAIT_MS = 5_000

export default function ComplianceDemoTour({ graph }: { graph: GraphStoreV2 }) {
  const assistant = useAssistantBridge()
  const typing = useRef<{ done: boolean }>({ done: true })
  // AI 호출이 API 오류로 실패하면 그 답 자리에 채팅 창과 같은 생각하는 과정을 3초 보이고 넘어간다
  const failed = useRef(false)
  const [thinking, setThinking] = useState<{ el: HTMLElement; tools: ToolProgress[] } | null>(null)

  const steps: TourStep[] = [
    { target: '.comp-detail .comp-related', title: '바뀌는 인증기준', text: 'ISMS-P 2.5.3 사용자 인증 항목입니다. 지금은 DISA STIG, CIS, 벤더 가이드 같은 공개 기준으로 점검한 결과로 판정하고 있습니다.',
      enter: async () => { window.location.hash = `#compliance?framework=isms-p&criterion=${DEMO_CRITERION}`; await waitFor('.comp-detail .comp-related') } },
    { target: ['#aegi-ai-panel', '#assistant-question'], title: 'AI에게 새 기준 전달', text: '예상 강화 기준을 적은 시연용 가이드라인을 AEGI AI에게 보내 이 기준으로 다시 검사해 달라고 요청합니다. AI 답변이 끝나면 「다음」을 눌러 주세요.', ai: true,
      enter: async () => {
        assistant?.ask()
        const el = await waitFor('#assistant-question') as HTMLTextAreaElement | null
        if (!el) return
        const run = { done: false }; typing.current = run
        // 글자마다 AI 창이 다시 그려져 느리다. 시간으로 몇 글자까지 칠지 정해 약 2.5초에 끝낸다
        const began = performance.now()
        for (let shown = 0; shown < DEMO_QUESTION.length && !run.done;) {
          shown = Math.max(shown + 1, Math.round(DEMO_QUESTION.length * (performance.now() - began) / 2500))
          setInput(el, DEMO_QUESTION.slice(0, shown)); await wait(30)
        }
        setInput(el, DEMO_QUESTION); run.done = true
        // 보내고 답(또는 오류)이 올 때까지 기다린다
        const before = getConversation(), last = Math.max(0, ...before.turns.map(t => t.id))
        assistant?.ask(undefined, DEMO_QUESTION, undefined, true)
        failed.current = false
        let turn: ReturnType<typeof getConversation>['turns'][number] | undefined
        for (let t = 0; t < ANSWER_WAIT_MS && !turn; t += 500) {
          const now = getConversation()
          turn = now.turns.find(x => (now.id !== before.id || x.id > last) && (x.answer || x.error))
          if (!turn) await wait(500)
        }
        if (turn?.error && !turn.answer) {
          failed.current = true
          const id = turn.id
          updateTurns(turns => turns.map(x => x.id === id ? { ...x, error: undefined } : x))
          await wait(100)
          const bubbles = document.querySelectorAll<HTMLElement>('#aegi-ai-panel .assistant-turn .assistant-bubble')
          const el = bubbles[bubbles.length - 1]
          if (el) {
            setThinking({ el, tools: [{ id: 't1', name: 'compliance_item', status: 'running' }] })
            await wait(1500)
            setThinking({ el, tools: [{ id: 't1', name: 'compliance_item', status: 'complete' }, { id: 't2', name: 'guideline_criterion', status: 'running' }] })
            await wait(1500)
            setThinking(null)
          }
        }
      } },
    { target: '.comp-custom-check', title: 'AI가 만든 검사', text: 'AI가 가이드라인을 읽고 기존 점검 가운데 기준이 달라지는 것을 찾아 검사 초안 2개를 만들었습니다. 검사마다 확인할 데이터, 필드, 요구값이 들어 있고, 요구값은 가이드라인에 적힌 값만 씁니다.', ai: true,
      enter: async () => {
        typing.current.done = true
        // AI 초안이 늦게 붙을 수 있어 잠시 기다린다. 기다리는 동안 채팅 창(AI 가 생각하는 과정)을 열어 두고, 그래도 없으면 같은 검사를 붙이고 넘어간다
        if (!failed.current) for (let t = 0; t < DRAFT_WAIT_MS && !demoDraft()?.checks.length; t += 250) await wait(250)
        document.querySelector<HTMLButtonElement>('.assistant-close')?.click()
        if (!demoDraft()?.checks.length) {
          const context = { graph, evidence: buildEvidenceStore([], []), findings: [] }
          guidelineCriterion(context, { id: 'demo-guideline', type: 'function', function: { name: 'guideline_criterion', arguments: JSON.stringify({ criterion: DEMO_CRITERION, guideline: GUIDELINES[0].id }) } }, 1)
        }
        await waitFor('.comp-custom-check')
      } },
    { target: '.comp-compare', title: '현행 기준과 비교', text: '왼쪽은 현행 기준, 오른쪽은 새 기준으로 판정한 결과입니다. 현행 기준에서는 충족이거나 판정할 수 없던 점검이 새 기준에서는 위반으로 나옵니다.' },
    { target: '.comp-custom .comp-custom-actions', title: '회사 기준으로 저장', text: '초안을 저장하면 회사 기준으로 등록됩니다. 그 뒤로는 이 인증기준을 열 때마다 현재 설정으로 다시 판정합니다. 「마치기」를 누르면 저장됩니다.',
      leave: () => { const d = demoDraft(); if (d?.status === 'draft') saveCriterion(d.id) } },
  ]
  return <>{thinking && createPortal(<AssistantThinking tools={thinking.tools} />, thinking.el)}<DemoTour id="uc2-2" label="기준 변경 시연"
    title={isPublicDemo() ? tourUseCaseById('uc2-2')?.title : undefined} tag={landingSlotById('uc2-2')?.badge} steps={steps}
    tip="상황: 2026년 4월 발표된 ISMS-P 인증제 실효성 강화방안에 따라 강화 인증기준 20개가 새로 생깁니다. 세부 기준은 아직 공개되지 않아, 사용자 인증 항목의 예상 기준으로 지금 설정을 미리 점검하려고 합니다."
    done="현행 기준에서는 충족이던 인증 설정이 예상 강화 기준에서는 위반이라는 것을 미리 찾았고, 그 기준을 회사 기준으로 저장했습니다." onStart={() => { const d = demoDraft(); if (d) removeCriterion(d.id) }} onEnd={() => {
      // 중간에 끝내면 시연이 친 글을 지우고 AI 창을 닫는다
      typing.current.done = true
      const el = document.querySelector<HTMLTextAreaElement>('#assistant-question')
      if (el && el.value && DEMO_QUESTION.startsWith(el.value)) { setInput(el, ''); document.querySelector<HTMLButtonElement>('.assistant-close')?.click() }
    }} /></>
}
