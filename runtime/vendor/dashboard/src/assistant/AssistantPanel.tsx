import type { CollectionContext, InvestigationContext } from './supportTools'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Copy, CornerDownRight, ImagePlus, ListTree, Plus, Square, X } from 'lucide-react'
import AiLogo from './AiLogo'
import { setAiLauncherHidden, useAiLauncherHidden } from './AiLauncher'
import AssistantThinking from './AssistantThinking'
import type { ToolProgress } from './toolProgress'
import AnswerBody from './AnswerBody'
import { citedEvidence } from './answerText'
import { shouldCollapseCode } from './collapse'
import AssistantResizer from './AssistantResizer'
import CitedEvidence from './CitedEvidence'
import AssistantEventGraph from './AssistantEventGraph'
import { citedEventGraph } from './eventGraph'
import type { GraphStoreV2 } from '../model/graph'
import type { EvidenceStore } from '../model/evidence'
import type { FindingV2 } from '../model/findingV2'
import type { FixtureObject } from '../model/object'
import UnifiedFullGraph from '../UnifiedFullGraph'
import { assistantCandidates, identityEvidenceEdges, objectLabel, providerLabel, runAssistantQuery } from './query'
import { buildEvidenceGraph, evidenceGraphPages } from './evidenceGraph'
import { selectorCandidates } from './extendedQuery'
import { relationLabel } from '../semantic-graph/edgeExplain'
import { HISTORY_LIMIT, QUESTION_LIMIT, type AssistantFocus, type AssistantPlan } from './plan'
import { ChatFailure, runKgConversation } from './chatClient'
import type { AssistantResult } from './types'
import type { EffectiveAccessRow } from '../detection/v2/effectiveAccess/types'
import { ASSET_ACCESS_QUESTION, DASHBOARD_GUIDES, emptySelection, hasGuide, type AssistantNavigation, type AssistantSeed, type AssistantSelection, type WorkspaceContext } from './workspace'
import { IMAGE_LIMIT, prepareAssistantImage, type AssistantImage } from './images'
import { getConversation, openConversation, setActiveTurnId, startNewConversation, updateTurns, useConversations, type ConversationTurn } from './conversationStore'
import { showPlatformDefaults } from '../model/platformDefaults'
import './assistant.css'

const ERRORS: Record<string, string> = {
  login_required: '로그인이 만료되었습니다. 다시 로그인한 뒤 질문해 주세요.',
  not_configured: '질문 해석 모델이 설정되지 않았습니다. 기존 검색과 탐색을 사용할 수 있습니다.',
  bad_question: '질문 요청을 처리할 수 없습니다. 다시 질문해 주세요.',
  rate_limited: '요청이 많습니다. 잠시 후 다시 질문해 주세요.',
  model_timeout: '질문 해석 시간이 초과되었습니다. 다시 질문해 주세요.',
  invalid_plan: '질문 해석 결과를 확인할 수 없습니다. 다시 질문해 주세요.',
  model_unavailable: '질문 해석 모델에 연결할 수 없습니다. 다시 질문해 주세요.',
}

export interface AssistantContext {
  collection?: CollectionContext
  investigation?: InvestigationContext
  evidenceStore: EvidenceStore
  effectiveAccess?: readonly EffectiveAccessRow[]
  /** Explicitly opened Finding detail may include an excepted Finding. Lists use visibleFindings. */
  currentFinding?: FindingV2
  currentFindingState?: string
  workspace?: WorkspaceContext
  seed?: AssistantSeed
  exceptionCounts?: { exceptedFindings: number; review: number }
  hiddenDefaults?: readonly FixtureObject[]
  onNavigate?: (navigation: AssistantNavigation) => void
  onSelectEvent?: (key: string) => void
  onAddEvents?: (events: NonNullable<AssistantResult['eventGraph']>, evidence: AssistantResult['evidence'], question: string) => void
  onFocusEvents?: (keys: string[]) => void
  onShowEventGraph?: (events: NonNullable<AssistantResult['eventGraph']>, objectKey?: string) => void
  onShowEvidenceGraph?: (objectKey?: string, findingIds?: string[]) => void
}


/* 쓰다 만 질문. 창을 닫거나 새로고침해도 같은 탭에서는 남는다. 보내거나 새 대화를 열면 지운다 */
const DRAFT_KEY = 'aegi:assistant-draft'
function readDraft(): string {
  try { return window.sessionStorage.getItem(DRAFT_KEY) ?? '' } catch { return '' }
}
function saveDraft(text: string) {
  try {
    if (text) window.sessionStorage.setItem(DRAFT_KEY, text)
    else window.sessionStorage.removeItem(DRAFT_KEY)
  } catch { /* 기억하지 못해도 입력은 그대로 쓴다 */ }
}

/* 오늘 대화는 시각만, 그 전 대화는 월-일과 시각 */
function conversationTime(at: number) {
  const date = new Date(at), pad = (n: number) => String(n).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return date.toDateString() === new Date().toDateString() ? `오늘 ${time}` : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
}

function AssistantSplBlock({
  splText,
  turnId,
  copyNotice,
  onCopy,
}: {
  splText: string
  turnId: number
  copyNotice?: { id: number; text: string }
  onCopy: (text: string, id: number) => void
}) {
  const collapsible = shouldCollapseCode(splText)
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="assistant-spl-block" aria-label="실행된 Splunk SPL 쿼리">
      <div className="assistant-spl-block-head">
        <span className="assistant-spl-label">실행된 Splunk SPL 쿼리</span>
        <div className="assistant-spl-actions">
          {collapsible && (
            <button
              type="button"
              className="assistant-spl-toggle"
              title={expanded ? '쿼리 접기' : '쿼리 전체 보기'}
              onClick={() => setExpanded(prev => !prev)}
            >
              {expanded ? '쿼리 접기' : '쿼리 펼치기'}
            </button>
          )}
          <button
            type="button"
            className="assistant-spl-copy"
            title="쿼리 복사"
            onClick={() => onCopy(splText, turnId)}
          >
            <Copy size={12} aria-hidden="true" />
            {copyNotice?.id === turnId ? copyNotice.text : '쿼리 복사'}
          </button>
        </div>
      </div>
      <pre className={`assistant-spl-code${collapsible && !expanded ? ' is-collapsed' : ''}`}>
        <code>{splText}</code>
      </pre>
    </div>
  )
}

export default function AssistantPanel({ graph, findings, context, onClose, onOpenThreat, isOpen = true, snapshotId }: {
  graph: GraphStoreV2; findings: FindingV2[]; context: AssistantContext
  onClose: () => void; onOpenThreat?: (findingId: string) => void
  isOpen?: boolean
  /** 배포본의 D1 스냅샷. 있으면 일부 도구를 서버에서 실행한다 (chatClient executeRemoteTool) */
  snapshotId?: string
}) {
  const [question, setQuestion] = useState(() => readDraft() || (context.currentFinding ? `${context.currentFinding.id}은 왜 탐지됐어?` : ''))
  const [selection, setSelection] = useState<AssistantSelection>(emptySelection)
  const [images, setImages] = useState<AssistantImage[]>([])
  const [imageBusy, setImageBusy] = useState(false)
  const [attachmentError, setAttachmentError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const consumedSeed = useRef(0)
  const attachmentGeneration = useRef(0)
  const cancelled = useRef<AbortController | null>(null)
  const [plan, setPlan] = useState<AssistantPlan | null>(null)
  const [chatResult, setChatResult] = useState<AssistantResult | null>(null)
  const [pathPlan, setPathPlan] = useState<AssistantPlan>()
  const [toolProgress, setToolProgress] = useState<ToolProgress[]>([])
  const [citedId, setCitedId] = useState('')
  const [citedFromGraph, setCitedFromGraph] = useState(false)
  // 근거 칸은 「근거 보기」나 인용 번호를 누른 답변에서만 연다
  const [evidenceTurn, setEvidenceTurn] = useState<number>()
  const citedElement = useRef<HTMLDetailsElement>(null)
  const [selectedKey, setSelectedKey] = useState<string>()
  const [targetKey, setTargetKey] = useState<string>()
  const [pathIndex, setPathIndex] = useState(0)
  const [credentialKey, setCredentialKey] = useState<string>()
  const { current: conversation, archived } = useConversations()
  const turns = conversation.turns, setTurns = updateTurns
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyArea = useRef<HTMLDivElement>(null)
  const focus = useRef<AssistantFocus>({ findingId: context.currentFinding?.id })
  const eventSelection = useRef<{ key: string; hash: string } | undefined>(undefined)
  useEffect(() => {
    const changed = () => { eventSelection.current = undefined }
    window.addEventListener('hashchange', changed); window.addEventListener('popstate', changed)
    return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('popstate', changed) }
  }, [])
  const focusRevision = useRef(0)
  const requestFocusRevision = useRef(0)
  const [activeFocus, setActiveFocus] = useState<AssistantFocus>(focus.current)
  const turnId = useRef(Math.max(0, ...getConversation().turns.map(t => t.id)))
  const [activeTurn, setActiveTurnState] = useState(() => getConversation().activeTurn)
  const setActiveTurn = (id: number) => { setActiveTurnState(id); setActiveTurnId(id) }
  const [busy, setBusy] = useState(false)
  const [seedQuestion, setSeedQuestion] = useState('')
  useEffect(() => {
    if (!context.seed || consumedSeed.current === context.seed.id || busy) return
    consumedSeed.current = context.seed.id
    const s = context.seed.selection
    // 선택 없이 바로 보내는 질문은 지금 대화의 대상(앞 답변의 객체)을 이어서 쓴다
    if (context.seed.submit && !Object.values(s).flat().length && !context.seed.eventKey) { setSeedQuestion(context.seed.question); return }
    ++focusRevision.current
    const r = s.relationKeys.length === 1 ? graph.relationsByKey.get(s.relationKeys[0]) : undefined
    setSelection(s); setQuestion(context.seed.question)
    focus.current = { ...(s.objectKeys.length === 1 ? { sourceKey: s.objectKeys[0] } : r ? { sourceKey: r.sourceKey, targetKey: r.targetKey } : {}), ...(s.findingIds.length === 1 ? { findingId: s.findingIds[0] } : {}) }
    if (context.seed.eventKey) {
      focus.current = { eventKey: context.seed.eventKey }
      eventSelection.current = { key: context.seed.eventKey, hash: window.location.hash }
    } else eventSelection.current = undefined
    setActiveFocus(focus.current)
    // 바로 보낼 질문은 선택과 대상이 화면에 반영된 다음 렌더에서 보낸다(아래 seedQuestion)
    if (context.seed.submit) { setSeedQuestion(context.seed.question); return }
    questionInput.current?.focus({ preventScroll: true })
  }, [context.seed, busy, graph])
  const [copyNotice, setCopyNotice] = useState<{ id: number; text: string }>()
  const [copySplNotice, setCopySplNotice] = useState<{ id: number; text: string }>()
  const questionInput = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (isOpen) questionInput.current?.focus({ preventScroll: true }) }, [isOpen])
  const latestMessage = useRef<HTMLElement>(null)
  const scrollArea = useRef<HTMLDivElement>(null)
  // 대화 칸 안에서만 스크롤한다. scrollIntoView 는 바깥 화면(문서)까지 끌어올려 화면 전체가 위로 밀린 채 멈췄다
  const scrollWithin = (element: Element | null | undefined, block: 'start' | 'end' | 'nearest') => {
    const area = scrollArea.current
    if (!area || !element) return
    const a = area.getBoundingClientRect(), r = element.getBoundingClientRect(), pad = 24
    if (block === 'start') area.scrollTop += r.top - a.top - pad
    else if (block === 'end') area.scrollTop += r.bottom - a.bottom + pad
    else if (r.top < a.top) area.scrollTop += r.top - a.top - pad
    else if (r.bottom > a.bottom) area.scrollTop += r.bottom - a.bottom + pad
  }
  useEffect(() => {
    scrollWithin(latestMessage.current, busy ? 'start' : 'end')
    if (!busy) questionInput.current?.focus({ preventScroll: true })
  }, [busy])
  const [fixture, setFixture] = useState(false)
  const [graphPage, setGraphPage] = useState(0)
  const [evidencePage, setEvidencePage] = useState(0)
  const [expandedGraph, setExpandedGraph] = useState(false)
  const graphDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (expandedGraph) graphDialog.current?.showModal() }, [expandedGraph])
  const request = useRef<AbortController | null>(null)
  // 화면을 옮겨 창이 내려가면 받던 응답을 중지로 남긴다. 대화 기록은 conversationStore 에 남는다
  useEffect(() => () => { cancelled.current = request.current; request.current?.abort() }, [])
  const scopedFindings = useMemo(() => context.currentFinding
    ? [...findings.filter(f => f.id !== context.currentFinding!.id), context.currentFinding]
    : findings, [findings, context.currentFinding])
  const candidates = useMemo(() => plan?.intent === 'credential_risk' && plan.entity ? selectorCandidates(graph, plan.entity, activeFocus)
    : plan ? assistantCandidates(graph, plan, activeFocus) : { keys: [], truncated: false }, [graph, plan, activeFocus])
  const targetCandidates = useMemo(() => plan && 'target' in plan && plan.target ? selectorCandidates(graph, plan.target, activeFocus) : { keys: [], truncated: false }, [graph, plan, activeFocus])
  const sourceChoice = !!plan && 'entity' in plan && (!selectedKey || !candidates.keys.includes(selectedKey)) && (candidates.keys.length > 1 || candidates.truncated)
  const targetChoice = !!plan && 'target' in plan && plan.target && (!targetKey || !targetCandidates.keys.includes(targetKey)) && (targetCandidates.keys.length > 1 || targetCandidates.truncated)
  const needsChoice = sourceChoice || targetChoice
  const result = useMemo(() => {
    if (chatResult) {
      if (pathPlan && pathIndex > 0) return { ...chatResult, graph: runAssistantQuery(graph, context.evidenceStore, scopedFindings, pathPlan, undefined, { focus: activeFocus, pathIndex }).graph }
      return chatResult
    }
    return plan && !needsChoice ? runAssistantQuery(graph, context.evidenceStore, scopedFindings, plan, selectedKey, { focus: activeFocus, targetKey, pathIndex, credentialKey }) : null
  }, [chatResult, pathPlan, graph, context.evidenceStore, scopedFindings, plan, selectedKey, targetKey, pathIndex, credentialKey, activeFocus, needsChoice])
  useEffect(() => {
    if (!result || !activeTurn) return
    if (result.focus && requestFocusRevision.current === focusRevision.current) {
      const next: AssistantFocus = result.focus.eventKey ? { eventKey: result.focus.eventKey } : { ...focus.current, ...result.focus }
      if (result.focus.eventKey) setSelection(emptySelection())
      if (result.focus.sourceKey && result.focus.sourceKey !== focus.current.sourceKey && !result.focus.targetKey) delete next.targetKey
      focus.current = next
    }
    setTurns(previous => previous.map(turn => turn.id === activeTurn ? { ...turn, answer: result.answer, focus: result.focus, credentialKey: result.credentialKey, result } : turn))
  }, [result, activeTurn])
  const pages = useMemo(() => result ? evidenceGraphPages(graph, result.graph) : [], [graph, result])
  const page = Math.min(graphPage, Math.max(pages.length - 1, 0))
  // 답변 본문 인용 번호와 같은 번호를 근거 목록에도 붙인다. 인용하지 않은 근거는 원래 번호(T1-E1)
  const subgraph = useMemo(() => pages[page] ? buildEvidenceGraph(graph, pages[page]) : null, [graph, pages, page])
  const visibleEvidencePage = Math.min(evidencePage, Math.max(Math.ceil((result?.evidence.length ?? 0) / 12) - 1, 0))
  useEffect(() => { if (citedId && !citedFromGraph) scrollWithin(citedElement.current, 'nearest') }, [activeTurn, citedId, visibleEvidencePage, citedFromGraph])
  const selectEvent = (key: string) => {
    eventSelection.current = { key, hash: window.location.hash }
    focus.current = { eventKey: key }; ++focusRevision.current
    setActiveFocus({ eventKey: key }); setSelection(emptySelection())
  }
  const selectEventEvidence = (id: string) => {
    setCitedId(id); setCitedFromGraph(true)
    const index = result?.evidence.findIndex(e => e.id === id) ?? -1
    if (index >= 0) { setEvidencePage(Math.floor(index / 12)); if (result!.evidence[index].kind === 'event') selectEvent(result!.evidence[index].ref) }
  }

  const copyAnswer = async (turn: ConversationTurn) => {
    try { await navigator.clipboard.writeText(turn.answer!); setCopyNotice({ id: turn.id, text: '답변을 복사했습니다.' }) }
    catch { setCopyNotice({ id: turn.id, text: '답변을 복사할 수 없습니다.' }) }
  }
  const copySpl = async (text: string, id: number) => {
    try { await navigator.clipboard.writeText(text); setCopySplNotice({ id, text: '복사 완료' }) }
    catch { setCopySplNotice({ id, text: '복사 실패' }) }
  }
  const attachImages = async (files: File[]) => {
    if (busy || imageBusy) return
    const generation = attachmentGeneration.current
    setImageBusy(true); setAttachmentError('')
    try {
      if (files.length + images.length > IMAGE_LIMIT) throw new Error('이미지는 최대 2장까지 첨부할 수 있습니다.')
      const prepared = await Promise.all(files.map(prepareAssistantImage))
      if (generation === attachmentGeneration.current) setImages(previous => [...previous, ...prepared].slice(0, IMAGE_LIMIT))
    } catch (error) { if (generation === attachmentGeneration.current) setAttachmentError(error instanceof Error ? error.message : '이미지를 읽을 수 없습니다.') }
    finally { if (generation === attachmentGeneration.current) setImageBusy(false) }
  }
  const submit = async (text: string, retry?: ConversationTurn, eventKeyOverride?: string) => {
    if (busy || imageBusy || !text.trim()) return
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    const snapshot: AssistantFocus = eventKeyOverride ? { eventKey: eventKeyOverride } : { ...(retry?.contextFocus ?? focus.current) }
    requestFocusRevision.current = focusRevision.current
    const submittedImages = retry?.images ?? images
    const timelineParams = new URLSearchParams(window.location.hash.split('?')[1])
    const selectedTimelineKey = context.workspace?.page === 'Timeline' ? timelineParams.get('event') ?? timelineParams.get('chain') : null
    const selectedGraphKey = eventSelection.current?.hash === window.location.hash ? eventSelection.current.key : undefined
    const eventKey = eventKeyOverride ?? (context.onAddEvents ? context.workspace?.timeline?.eventKey : selectedGraphKey ?? selectedTimelineKey ?? snapshot.eventKey)
    if (!retry && eventKey) { snapshot.eventKey = eventKey; delete snapshot.sourceKey; delete snapshot.targetKey; delete snapshot.findingId }
    const workspace: WorkspaceContext = retry?.workspace ?? { page: context.workspace?.page ?? 'Graph', selection: context.onAddEvents ? context.workspace!.selection : selection,
      ...((context.workspace?.page === 'Timeline' || context.workspace?.page === 'EventBoard') && eventKey ? { timeline: { eventKey } } : {}),
      ...(context.workspace?.board ? { board: context.workspace.board } : {}) }
    if (snapshot.sourceKey && !graph.objectsByKey.has(snapshot.sourceKey)) delete snapshot.sourceKey
    if (snapshot.targetKey && !graph.objectsByKey.has(snapshot.targetKey)) delete snapshot.targetKey
    if (snapshot.findingId && !scopedFindings.some(f => f.id === snapshot.findingId)) delete snapshot.findingId
    const history = turns.filter(t => t.id <= activeTurn && t.answer && !t.error).slice(-HISTORY_LIMIT).map(t => ({ question: t.question, answer: t.answer!.slice(0, 4000) }))
    const id = ++turnId.current
    setActiveTurn(id); setActiveFocus(snapshot)
    setBusy(true); setCopyNotice(undefined); setPlan(null); setChatResult(null); setPathPlan(undefined); setToolProgress([]); setCitedId(''); setCitedFromGraph(false); setSelectedKey(undefined); setTargetKey(undefined); setCredentialKey(undefined); setPathIndex(0); setGraphPage(0); setEvidencePage(0); setExpandedGraph(false)
    setQuestion(''); saveDraft(''); setImages([]); setAttachmentError('')
    setTurns(previous => [...previous, { id, question: text, plan: { intent: 'conversation' } as AssistantPlan, contextFocus: snapshot, images: submittedImages, workspace }].slice(-20))
    const timer = setTimeout(() => controller.abort(), 150_000)
    try {
      const reply = await runKgConversation(text, history, { collection: context.collection, investigation: context.investigation, graph, evidence: context.evidenceStore, findings: scopedFindings, eaRows: context.effectiveAccess, focus: snapshot, workspace, exceptionCounts: context.exceptionCounts, hiddenDefaults: context.hiddenDefaults }, controller.signal,
        { images: submittedImages, onToolProgress: progress => {
          if (request.current === controller && !controller.signal.aborted) setToolProgress(previous => {
            const found = previous.some(tool => tool.id === progress.id)
            return found ? previous.map(tool => tool.id === progress.id ? progress : tool) : [...previous, progress]
          })
        },
          remote: snapshotId ? { snapshotId, visibleFindings: scopedFindings.length, hideDefaults: !showPlatformDefaults() } : undefined })
      if (request.current === controller) {
        setPlan(reply.plan ?? null); setChatResult(reply.result ?? null); setPathPlan(reply.pathPlan); setFixture(reply.fixture)
        setTurns(previous => previous.map(turn => turn.id === id ? { ...turn, fixture: reply.fixture, plan: reply.plan ?? { intent: 'conversation' },
          ...(reply.result ? { answer: reply.result.answer, result: reply.result, focus: reply.result.focus, pathPlan: reply.pathPlan } : {}) } : turn))
        // 보드에서 연 AI 는 이벤트가 있는 답을 받은 그때 한 번만 보드에 올린다. 이전 대화를 다시 열 때는 올리지 않는다
        if (reply.result?.eventGraph?.nodes.length) {
          const citedIds = new Set(citedEvidence(reply.result.answer, reply.result.evidence).map(e => e.id))
          const boardGraph = citedEventGraph(reply.result.eventGraph, citedIds)
          if (boardGraph.nodes.length) context.onAddEvents?.(boardGraph, reply.result.evidence, text)
        }
      }
    } catch (failure) {
      if (request.current === controller) {
        const message = cancelled.current === controller ? '응답을 중지했습니다. 조회한 근거는 아래에서 확인할 수 있습니다.' : controller.signal.aborted ? ERRORS.model_timeout : failure instanceof ChatFailure ? ERRORS[failure.code] || ERRORS.model_unavailable : ERRORS.model_unavailable
        setTurns(previous => previous.map(turn => turn.id === id ? { ...turn, error: message } : turn))
        if (failure instanceof ChatFailure && failure.partial) setChatResult({ ...failure.partial, answer: '조회한 근거는 아래에서 확인할 수 있습니다. 모델의 답변 작성을 완료하지 못했습니다.' })
      }
    } finally { clearTimeout(timer); if (request.current === controller) { setBusy(false); setToolProgress([]) } }
  }
  useEffect(() => {
    if (!seedQuestion || busy) return
    setSeedQuestion('')
    void submit(seedQuestion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedQuestion, busy])
  const resetView = () => {
    eventSelection.current = undefined
    request.current?.abort(); request.current = null; ++turnId.current
    focus.current = { findingId: context.currentFinding?.id }
    ++focusRevision.current
    setActiveFocus(focus.current); setActiveTurnState(0); setPlan(null); setChatResult(null); setPathPlan(undefined); setCopyNotice(undefined); setBusy(false)
    setSelectedKey(undefined); setTargetKey(undefined); setCredentialKey(undefined); setPathIndex(0); setGraphPage(0); setEvidencePage(0); setExpandedGraph(false)
    setSelection(emptySelection()); setImages([]); setAttachmentError(''); ++attachmentGeneration.current; setImageBusy(false); setHistoryOpen(false)
  }
  // 새 대화를 열 때만 지금 대화를 이전 대화로 넘긴다. 닫기, 화면 이동, 새로고침은 대화를 그대로 둔다
  const newConversation = () => {
    resetView(); startNewConversation(); setQuestion(''); saveDraft('')
  }
  /** 근거 보기. 같은 답변에서 다시 누르면 닫는다 */
  const openEvidence = (turn: ConversationTurn) => {
    if (activeTurn === turn.id && evidenceTurn === turn.id) { setEvidenceTurn(undefined); return }
    restoreTurn(turn); setEvidenceTurn(turn.id); setCitedId('')
    window.requestAnimationFrame(() => scrollWithin(document.getElementById('assistant-evidence-grounding'), 'start'))
  }
  const restoreTurn = (turn: ConversationTurn) => {
    eventSelection.current = undefined
    focus.current = { ...(turn.focus ?? turn.contextFocus) }; ++focusRevision.current
    if (busy) return
    focus.current = { ...turn.contextFocus }
    ++focusRevision.current; requestFocusRevision.current = focusRevision.current
    setActiveTurn(turn.id); setActiveFocus(turn.focus ?? turn.contextFocus); setPlan(turn.plan)
    setChatResult(turn.fixture ? null : turn.result ?? null); setPathPlan(turn.pathPlan); setFixture(!!turn.fixture)
    setSelectedKey(turn.focus?.sourceKey); setTargetKey(turn.focus?.targetKey); setPathIndex(0)
    setCredentialKey(turn.credentialKey)
    setGraphPage(0); setEvidencePage(0); setExpandedGraph(false)
    setSelection(turn.workspace?.selection ?? emptySelection())
  }
  // 오류로 끝난 질문은 근거를 다시 계산하지 않는다. 다시 계산하면 오류 위에 빈 답이 붙는다
  const reopenTurn = (turn: ConversationTurn) => { if (turn.error) setActiveTurn(turn.id); else restoreTurn(turn) }
  const openPrevious = (id: string) => {
    if (busy) return
    resetView()
    const opened = openConversation(id)
    if (!opened) return
    turnId.current = Math.max(turnId.current, ...opened.turns.map(t => t.id))
    const last = opened.turns.find(t => t.id === opened.activeTurn) ?? opened.turns[opened.turns.length - 1]
    if (last) reopenTurn(last)
  }
  // 다시 열린 창은 이 탭의 대화를 이어 보여 준다. 새로고침으로 끊긴 응답은 중지로 남긴다
  useEffect(() => {
    const cut = (t: ConversationTurn) => t.fixture === undefined && !t.answer && !t.error
    setTurns(previous => previous.some(cut) ? previous.map(t => cut(t) ? { ...t, error: '응답을 중지했습니다.' } : t) : previous)
    const saved = getConversation(), last = saved.turns.find(t => t.id === saved.activeTurn)
    if (last) reopenTurn(last)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!historyOpen) return
    const away = (event: PointerEvent) => { if (!historyArea.current?.contains(event.target as Node)) setHistoryOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [historyOpen])
  const linkedKey = [...graph.linksById.values()].flatMap(link => identityEvidenceEdges(graph, link))[0]?.from
  const currentObject = linkedKey ? graph.objectsByKey.get(linkedKey) : [...graph.objectsByKey.values()].find(o => o.canonical.interfaces.includes('Principal') && o.canonical.judged?.principal_kind === 'human')
  // 예시 질문. 지금 보고 있는 화면에 맞는 질문을 앞에 두고, 어느 화면에서나 쓰는 질문을 뒤에 붙인다. 최대 다섯 개.
  const findingId = context.currentFinding?.id || scopedFindings[0]?.id
  const pageSamples: Partial<Record<string, { label: string; text: string }[]>> = {
    Home: [{ label: '우선 위협', text: '지금 가장 먼저 확인해야 할 위협이 뭐야? 심각도와 근거를 같이 알려줘.' }],
    Threat: findingId ? [{ label: `${findingId} 탐지 근거`, text: `${findingId}은 왜 탐지됐어?` }, { label: `${findingId} 조치 방법`, text: `${findingId}의 조치 추천해줘` }, { label: '담당자와 처리 이력', text: `${findingId}의 담당자, 조치 진행과 검증, 예외 사유와 만료를 조회해줘.` }] : [{ label: '재검토 필요 예외', text: '재검토가 필요한 예외가 있어? 사유와 만료를 같이 알려줘.' }],
    Gaps: [{ label: '비인가 접근 인원', text: '권한 없이 연동을 통해 실제로 접근할 수 있는 사람이 누구야? 경로와 근거를 같이 알려줘.' }],

    EventBoard: [
      { label: 'Slack 파일 Google Drive 외부 공유 추적', text: 'Slack에서 받은 파일을 Google Drive로 외부 공유한 정황이 있어?' },
      { label: '최근 로그인 실패 및 의심 인증 조회', text: '최근 로그인 실패나 의심스러운 인증 시도가 있었는지 확인해줘.' },
      ...((context.workspace?.board?.pinnedObjects?.length ?? 0) > 0 ? [{ label: '조사 대상의 최근 7일 행동', text: '조사 대상 객체가 최근 7일 동안 한 행동을 원본 이벤트 목록으로 찾아줘.' }] : []),
      { label: '다음 조회 범위 제안', text: '보드 상태를 근거로 아직 조회하지 않은 다음 조회 범위를 세 개까지 제안해줘. 각 제안에 이유를 붙여줘.' },
    ],
    Credentials: [{ label: '피해범위가 가장 큰 자격증명', text: '피해범위가 가장 큰 자격증명이 뭐야? 토큰 유출과 소유 계정 탈취를 나눠서 알려줘.' }],
    Adapters: [{ label: 'SaaS별 수집 현황', text: 'SaaS별 수집 현황과 수집하지 못한 범위를 알려줘.' }],
  }
  const launcherHidden = useAiLauncherHidden()
  const samples = [
    ...(pageSamples[context.workspace?.page ?? 'Graph'] ?? []),
    { label: '이 화면 사용법', text: '현재 화면에서 어떤 일을 할 수 있고 어떻게 사용하면 돼?' },
    { label: '보안 조사 시작점', text: '현재 환경의 위험을 조사하려면 어떤 순서로 확인하면 돼? 필요한 현황을 조회해서 알려줘.' },
    ...(currentObject ? [{ label: `${currentObject.fixture_key} 찾기`, text: `객체 ${currentObject.fixture_key} 찾아줘` }, { label: `${currentObject.fixture_key}의 다른 SaaS 계정`, text: `${currentObject.fixture_key}의 다른 SaaS 계정 보여줘` }] : []),
    ...(findingId ? [{ label: `${findingId} 탐지 근거`, text: `${findingId}은 왜 탐지됐어?` }] : []),
  ].filter((sample, index, all) => all.findIndex(other => other.text === sample.text) === index).slice(0, 5)

  // Esc로 창을 닫는다. 근거 그래프를 크게 본 창이 열려 있으면 그 창이 먼저 닫힌다.
  return <aside id="aegi-ai-panel" className="aegi-assistant" aria-label="AEGI AI 질문" onKeyDown={event => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || expandedGraph) return
    event.preventDefault()
    if (historyOpen) { setHistoryOpen(false); return }
    onClose()
  }}>
    <AssistantResizer />
    <header className="assistant-head assistant-topbar"><h2><AiLogo />AEGI AI</h2><div className="assistant-actions">{launcherHidden && <button type="button" onClick={() => setAiLauncherHidden(false)}>하단 단추 보이기</button>}<button type="button" onClick={newConversation}><Plus size={16} aria-hidden="true" />새 대화</button><div className="assistant-history" ref={historyArea}><button type="button" className="assistant-history-toggle" aria-expanded={historyOpen} aria-controls="assistant-history-list" disabled={busy} onClick={() => setHistoryOpen(open => !open)}>이전 대화</button>
      {historyOpen && <section id="assistant-history-list" className="assistant-history-list" aria-label="이전 대화"><h3>이전 대화</h3>
        {archived.length ? <ul>{archived.map(item => <li key={item.id}><button type="button" onClick={() => openPrevious(item.id)}><b>{item.turns[0]?.question}</b><span>{conversationTime(item.updatedAt)}</span><span>질문 {item.turns.length}개</span></button></li>)}</ul> : <p>이전 대화 없음</p>}
      </section>}</div><button type="button" className="assistant-close" aria-label="닫기" title="Esc로 닫기" onClick={onClose}><X size={20} aria-hidden="true" /></button></div></header>
    <div className="assistant-scroll" ref={scrollArea}>
    {!turns.length && <section className="assistant-empty"><h3>예시 질문</h3>
      <ul className="assistant-starters" aria-label="예시 질문">{samples.map(sample => <li key={sample.text}><button type="button" onClick={() => void submit(sample.text)}>{sample.label}</button></li>)}</ul>
    </section>}
    <div className="assistant-thread" role="log" aria-label="대화 기록" aria-relevant="additions text">{turns.map((turn, index) => <article className="assistant-turn" key={turn.id} ref={index === turns.length - 1 ? latestMessage : undefined}>
      <div className="assistant-user-message"><span className="assistant-speaker assistant-sr">나</span><p>{turn.question}</p></div>
      {!!turn.images?.length && <div className="assistant-attachments">{turn.images.map((image, i) => <img key={i} src={image.dataUrl} alt={image.name} />)}</div>}
      <div className="assistant-ai-message"><span className="assistant-speaker"><AiLogo size={28} /><span className="assistant-sr">AEGI AI</span></span>
        <div className="assistant-ai-body"><div className="assistant-bubble">
        {turn.answer && <AnswerBody answer={turn.answer} evidence={turn.result?.evidence ?? []} graph={graph} disabled={busy}
          onOpenEvidence={() => openEvidence(turn)}
          onOpenGraph={() => { restoreTurn(turn); setExpandedGraph(true) }}
          onCitation={id => {
          if (busy) return
          if (activeTurn !== turn.id) restoreTurn(turn)
          const item = turn.result?.evidence.findIndex(e => e.id === id) ?? -1
          if (item >= 0) {
            setEvidencePage(Math.floor(item / 12)); setCitedId(id)
            const isEvent = ['event', 'event_link'].includes(turn.result!.evidence[item].kind)
            setCitedFromGraph(isEvent)
            if (!isEvent) setEvidenceTurn(turn.id)
            if (turn.result!.evidence[item].kind === 'event') selectEvent(turn.result!.evidence[item].ref)
            if (turn.result!.evidence[item].kind === 'event') context.onSelectEvent?.(turn.result!.evidence[item].ref)
            if (isEvent) window.requestAnimationFrame(() => scrollWithin(document.getElementById('assistant-event-grounding'), 'start'))
          }
        }} />}
        {busy && turn.id === activeTurn && <AssistantThinking tools={toolProgress} />}
        {turn.error && <div><p role="alert">{turn.error}</p><button type="button" disabled={busy} onClick={() => void submit(turn.question, turn)}>다시 질문</button></div>}
        {!!turn.result?.navigation?.length && context.onNavigate && <div className="assistant-message-actions assistant-nav-actions" aria-label="관련 화면">{turn.result.navigation.map((item, i) => <button type="button" key={i} onClick={() => context.onNavigate?.(item)}>{item.label}</button>)}</div>}
        {(() => {
          const executedSpls = [...new Set((turn.result?.evidence ?? []).map(e => e.data && typeof (e.data as Record<string, unknown>).executedSpl === 'string' ? (e.data as Record<string, unknown>).executedSpl as string : null).filter((s): s is string => !!s))]
          if (!executedSpls.length) return null
          return <AssistantSplBlock key={turn.id} splText={executedSpls.join('\n\n')} turnId={turn.id} copyNotice={copySplNotice} onCopy={copySpl} />
        })()}
        </div>
        {turn.result?.eventGraph && context.onAddEvents && !turn.result.eventGraph.nodes.length && (
          <button
            type="button"
            disabled={busy}
            title="집계하지 않은 원본 이벤트로 같은 질문 다시 하기"
            onClick={() => void submit(`${turn.question}\n집계하지 말고 원본 이벤트 목록으로 찾아줘.`)}
          >
            원본 이벤트로 다시 찾기
          </button>
        )}
        {!!turn.result?.eventGraph?.nodes.length && context.onAddEvents && (
          <button
            type="button"
            disabled={busy}
            title="이 답의 이벤트를 보드에서 보기"
            onClick={() => {
              const r = turn.result!
              const citedIds = new Set(citedEvidence(r.answer, r.evidence).map(e => e.id))
              context.onFocusEvents?.(citedEventGraph(r.eventGraph!, citedIds).nodes.map(n => n.key))
            }}
          >
            보드에서 보기
          </button>
        )}
        {turn.answer && <div className="assistant-message-actions"><button type="button" onClick={() => void copyAnswer(turn)}><Copy size={14} aria-hidden="true" />복사</button>
          {!!turn.result?.eventGraph && <button type="button" disabled={busy} onClick={() => { restoreTurn(turn); window.requestAnimationFrame(() => scrollWithin(document.getElementById('assistant-event-grounding'), 'start')) }}>이벤트 그래프</button>}
          {!!turn.images?.length && <button type="button" disabled={busy || imageBusy} onClick={() => { restoreTurn(turn); setImages(turn.images!); questionInput.current?.focus({ preventScroll: true }) }}><ImagePlus size={14} aria-hidden="true" />이미지로 이어서</button>}
          {(!!turn.result?.evidence.length || !!turn.result?.graph.objectKeys.length) && <button type="button" disabled={busy} aria-pressed={activeTurn === turn.id && evidenceTurn === turn.id} onClick={() => openEvidence(turn)}><ListTree size={14} aria-hidden="true" />근거 보기</button>}
          <button type="button" disabled={busy} onClick={() => { restoreTurn(turn); questionInput.current?.focus({ preventScroll: true }) }}><CornerDownRight size={14} aria-hidden="true" />이어서 질문</button>
          {copyNotice?.id === turn.id && <span role="status">{copyNotice.text}</span>}
        </div>}
        </div>
      </div>
    </article>)}</div>
    {sourceChoice && <section><h3>{plan?.intent === 'path_lookup' || plan?.intent === 'access_analyze' ? '출발 객체 선택' : '객체 선택'}</h3>
      {candidates.truncated && <p>후보 중 20개를 표시합니다. 이름이나 SaaS로 검색을 좁혀 주세요.</p>}
      <ul className="assistant-candidates">{candidates.keys.map(key => <li key={key}><button type="button" onClick={() => { setSelectedKey(key); setPathIndex(0); setGraphPage(0); setEvidencePage(0) }}>
        <strong>{objectLabel(graph, key)}</strong><span>{providerLabel(graph.objectsByKey.get(key)!.canonical.provider)}</span><code>{key}</code>
      </button></li>)}</ul>
    </section>}
    {targetChoice && <section><h3>대상 객체 선택</h3>
      {targetCandidates.truncated && <p>후보 중 20개를 표시합니다. 이름이나 SaaS로 검색을 좁혀 주세요.</p>}
      <ul className="assistant-candidates">{targetCandidates.keys.map(key => <li key={key}><button type="button" onClick={() => { setTargetKey(key); setPathIndex(0); setGraphPage(0); setEvidencePage(0) }}>
        <strong>{objectLabel(graph, key)}</strong><span>{providerLabel(graph.objectsByKey.get(key)!.canonical.provider)}</span><code>{key}</code>
      </button></li>)}</ul>
    </section>}
    {result && <div id="assistant-grounding" className="assistant-result">
      {result.eventGraph && <section id="assistant-event-grounding"><div className="assistant-head"><h3>노드별 이벤트</h3></div>
        <AssistantEventGraph key={activeTurn} graph={result.eventGraph} objects={graph} onShowGraph={context.onShowEventGraph ? key => context.onShowEventGraph?.(result.eventGraph!, key) : undefined} selectedId={citedId} disabled={busy}
          onSelect={selectEventEvidence}
          onAsk={key => void submit('이 이벤트의 앞뒤 흐름과 연결 근거를 조회해서 그래프로 설명해줘.', undefined, key)}
          onOpen={key => context.onNavigate?.({ page: 'EventBoard', eventKey: key, label: '이벤트 상세 열기' })} />
      </section>}
      {result.focus?.findingId === context.currentFinding?.id && context.currentFindingState && <section><p>현재 상태: {context.currentFindingState}</p></section>}
      {!!result.credentials?.length && <section><h3>자격증명 선택</h3><div className="assistant-paths">{result.credentials.map(item =>
        <button type="button" key={item.key} aria-pressed={result.credentialKey === item.key} disabled={busy} onClick={() => { if (chatResult) void submit(`자격증명 ${item.key}의 토큰 유출과 소유 계정 탈취 피해범위를 비교하고 근거 경로를 보여줘`); else { setCredentialKey(item.key); setGraphPage(0); setEvidencePage(0) } }}>
          {item.label}<span>{item.summary}</span>
        </button>)}</div></section>}
      {!!result.paths && result.paths.length > 1 && <section><h3>경로 선택</h3><div className="assistant-paths">{result.paths.map((path, index) =>
        <button type="button" key={index} aria-pressed={pathIndex === index} onClick={() => { setPathIndex(index); setGraphPage(0); setEvidencePage(0) }}>
          경로 {index + 1}, {path.steps.length}홉: {path.objects.map(key => objectLabel(graph, key)).join(' → ')}
          <span>{path.steps.map(step => {
            if (step.kind === 'identity_link') return '동일인 연결'
            const role = graph.relationsByKey.get(step.edgeId)?.roleName
            return `${relationLabel(step.relationType ?? '관계')}${role ? ` ${role}` : ''}`
          }).join(' → ')}</span>
        </button>)}</div></section>}
      {evidenceTurn === activeTurn && (!!result.evidence.length || !!result.graph.objectKeys.length) && (() => {
        const cited = citedEvidence(result.answer, result.evidence)
        const citedIds = new Set(cited.map(item => item.id))
        const openFinding = (id: string) => { const finding = scopedFindings.find(f => f.id === id); if (finding) onOpenThreat?.(finding.id) }
        return <section id="assistant-evidence-grounding">
          {!!cited.length && <><h3>답변에 인용한 근거</h3>
            <CitedEvidence graph={graph} items={cited} openId={citedId} openRef={citedElement} onOpenFinding={openFinding} /></>}
          <div className="assistant-evidence-actions">
            {subgraph && <button type="button" className="assistant-graph-open" onClick={() => setExpandedGraph(true)}>근거 그래프 열기</button>}
            {context.onShowEvidenceGraph && !!result.graph.objectKeys.length && (
              <button type="button" className="assistant-graph-open" onClick={() => context.onShowEvidenceGraph?.(result.graph.objectKeys[0], result.focus?.findingId ? [result.focus.findingId] : undefined)}>
                Cross-SaaS Graph로 이동
              </button>
            )}
          </div>
          {!!result.evidence.length && <details className="assistant-evidence-all" open={!!citedId && !citedIds.has(citedId) && result.evidence.some(item => item.id === citedId) ? true : undefined}>
            <summary>전체 근거 {result.evidence.length}개</summary>
            <div className="assistant-evidence">{result.evidence.slice(visibleEvidencePage * 12, visibleEvidencePage * 12 + 12).map(item => <details key={item.id} ref={item.id === citedId && !citedIds.has(item.id) ? citedElement : undefined} open={item.id === citedId ? true : undefined}>
              <summary><span>{item.id}</span> {item.label}{item.state && <span className="assistant-state">{({ confirmed: '확인', inferred: '추정', unknown: '미확인' })[item.state]}</span>}</summary>
              <code>{item.ref}</code><p>{item.detail}</p>
              {item.kind === 'finding' && <button type="button" onClick={() => openFinding(item.ref)}>탐지 상세 보기</button>}
            </details>)}</div>
            {result.evidence.length > 12 && <div className="assistant-pager" aria-label="근거 목록 페이지"><button type="button" disabled={!visibleEvidencePage} onClick={() => setEvidencePage(visibleEvidencePage - 1)}>이전 근거</button>
              <span>{visibleEvidencePage + 1}/{Math.ceil(result.evidence.length / 12)}</span><button type="button" disabled={(visibleEvidencePage + 1) * 12 >= result.evidence.length} onClick={() => setEvidencePage(visibleEvidencePage + 1)}>다음 근거</button></div>}
          </details>}
        </section>
      })()}
      {expandedGraph && subgraph && <dialog ref={graphDialog} className="assistant-graph-dialog" aria-label="근거 그래프 크게 보기" onCancel={() => setExpandedGraph(false)}>
        <div className="assistant-head"><h2>근거 그래프{pages.length > 1 ? ` ${page + 1}/${pages.length}` : ''}</h2>
          {pages.length > 1 && <div className="assistant-pager" aria-label="근거 그래프 페이지">
            <button type="button" disabled={page === 0} onClick={() => setGraphPage(page - 1)}>이전 그래프</button><span>일부 근거 표시</span>
            <button type="button" disabled={page === pages.length - 1} onClick={() => setGraphPage(page + 1)}>다음 그래프</button></div>}
          <button type="button" className="assistant-close" aria-label="그래프 닫기" title="Esc로 닫기" onClick={() => setExpandedGraph(false)}><X size={20} aria-hidden="true" /></button></div>
        <UnifiedFullGraph currentGraph={subgraph} findings={[]} evidenceMode identityEdges={pages[page].identityEdges} inspectorFindings={scopedFindings} onOpenThreat={onOpenThreat} />
      </dialog>}
    </div>}
    </div>
    <form className="assistant-composer" onSubmit={event => { event.preventDefault(); void submit(question) }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void attachImages([...event.dataTransfer.files]) } }}>
      {/* 질문 도구. 답변 대상에 따라 권한 분석, 접근 가능한 사람, 연결 경로, 조치 추천 단추를 제공한다. */}
      {(() => {
        const ask = (text: string) => void submit(text)
        const focusInterfaces = result?.focus?.sourceKey ? graph.objectsByKey.get(result.focus.sourceKey)?.canonical.interfaces ?? [] : []
        const followUps = [
          ...(focusInterfaces.some(i => i === 'Principal' || i === 'Automation') ? [{ label: '권한 분석', text: '그 계정의 권한 분석해줘' }] : []),
          ...(focusInterfaces.includes('Resource') ? [{ label: '접근 가능한 사람', text: ASSET_ACCESS_QUESTION }] : []),
          ...(result?.focus?.sourceKey && result.focus.targetKey ? [{ label: '연결 경로', text: '그 계정에서 그 대상까지 경로 보여줘' }] : []),
          ...(result?.focus?.findingId ? [{ label: '조치 추천', text: '이 탐지의 조치 추천해줘' }] : []),
        ]
        if (!followUps.length) return null
        return <div className="assistant-tools" role="group" aria-label="질문 도구">
          {followUps.map(item => <button type="button" key={item.label} disabled={busy} onClick={() => ask(item.text)}>{item.label}</button>)}
        </div>
      })()}
      <div className="assistant-context">{(!context.workspace || hasGuide(context.workspace.page)) && <span>현재 화면 <b>{DASHBOARD_GUIDES.find(g => g.page === context.workspace?.page)?.title ?? 'Cross-SaaS Graph'}</b></span>}
        {activeFocus.eventKey && <span>이벤트 문맥: {result?.eventGraph?.nodes.find(n => n.key === activeFocus.eventKey)?.label ?? '선택한 이벤트'}</span>}
        {!!(Object.values(selection).flat().length || activeFocus.eventKey) && <>{!!Object.values(selection).flat().length && <span>선택 {Object.values(selection).flat().length}개</span>}<button type="button" disabled={busy} onClick={() => { setSelection(emptySelection()); focus.current = {}; eventSelection.current = undefined; setActiveFocus({}); ++focusRevision.current }}>선택 해제</button></>}
      </div>
      {!!selection.objectKeys.length && <div className="assistant-selected-names">{selection.objectKeys.slice(0, 3).map(key => objectLabel(graph, key)).join(', ')}{selection.objectKeys.length > 3 ? ` 외 ${selection.objectKeys.length - 3}개` : ''}</div>}
      {!!selection.relationKeys.length && <div className="assistant-selected-names">연결 {selection.relationKeys.length}개</div>}
      {!!images.length && <div className="assistant-attachments">{images.map((image, i) => <div key={i}><img src={image.dataUrl} alt={image.name} /><button type="button" aria-label={`${image.name} 삭제`} onClick={() => setImages(previous => previous.filter((_, index) => index !== i))}><X size={14} /></button></div>)}<span>첨부 이미지를 모델에 전송합니다.</span></div>}
      {attachmentError && <p role="alert">{attachmentError}</p>}
      <label htmlFor="assistant-question">질문</label>
      <div className="assistant-input">
      <textarea ref={questionInput} id="assistant-question" value={question} maxLength={QUESTION_LIMIT}
        onPaste={event => { const files = [...event.clipboardData.items].filter(item => item.kind === 'file' && item.type.startsWith('image/')).flatMap(item => { const file = item.getAsFile(); return file ? [file] : [] }); if (files.length) { event.preventDefault(); void attachImages(files) } }}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          event.preventDefault()
          event.currentTarget.form?.requestSubmit()
        }}
        onChange={event => { setQuestion(event.target.value); saveDraft(event.target.value) }} placeholder={turns.length ? "이어서 질문하세요" : "보안 환경에 대해 질문하세요"} rows={2} />
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { void attachImages([...event.target.files ?? []]); event.target.value = '' }} />
      <div className="assistant-actions"><button type="button" className="assistant-attach" aria-label={imageBusy ? '이미지 준비 중' : '이미지 첨부'} title="이미지 첨부" disabled={busy || imageBusy || images.length >= IMAGE_LIMIT} onClick={() => fileInput.current?.click()}><ImagePlus size={18} aria-hidden="true" />{imageBusy && '이미지 준비 중'}</button>
        {fixture && <span className="assistant-state">로컬 검증</span>}
        {busy ? <button type="button" onClick={() => { cancelled.current = request.current; request.current?.abort() }}><Square size={16} aria-hidden="true" />중지</button> : <button type="submit" className="assistant-send" disabled={imageBusy || !question.trim()} aria-label="질문하기" title="Enter로 질문하기"><ArrowUp size={18} aria-hidden="true" /></button>}</div>
      </div>
    </form>
  </aside>
}
