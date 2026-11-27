import type { AssistantEventGraph } from './assistant/types'
import type { Provider } from './model/object'
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { loadStandardHistory, useStandardHistory, useStandardResults } from './config-findings/standardResultsStore'
import { configRows as toConfigRows, findConfigFinding, sortRows as sortThreatRows } from './findings/threatRows'
import './styles.css'
import { loadAegiIncData } from './data/datasetStore'
import { providerLogoId, providerName, sortProviders, SUPPORTED_PROVIDERS } from './findings/providers'
import { withPathProviders } from './findings/findingPath'
import type { FindingV2 } from './model/findingV2'
import ProviderLogo from './ProviderLogo'
import ThreatIndex, { chooseThreatList } from './findings/ThreatIndex'
import AccessGapsPage from './findings/AccessGapsPage'
import ExceptionDialog from './exceptions/ExceptionDialog'
import type { ProviderId } from './providerOverviewData'
import { House, Waypoints, ShieldAlert, Plug, BookOpen, LogOut, Search as SearchIcon, NotebookPen, ShieldCheck, Zap } from 'lucide-react'
import LiveCollectionModal from './credentials/LiveCollectionModal'
import AiLogo from './assistant/AiLogo'
import AiLauncher, { focusAiLauncher } from './assistant/AiLauncher'
import { AssistantBridge } from './assistant/AssistantBridge'
import { emptySelection, hasGuide, type AssistantNavigation, type AssistantSeed, type AssistantSelection } from './assistant/workspace'
import { useHandling } from './handling/useHandling'
import { useRemediationProgress } from './handling/useRemediationProgress'
import { destinationsByFinding, outsideDestinations } from './findings/outsideDestinations'
import { formatKst } from './utils/time'
import { tenantKindLabel } from './semantic-graph/circleLevels'
import { COLLECTION_STATE_LABEL, collectionState, latestCollectedByProvider, type ProviderCollection } from './model/collectionFreshness'
import HandlingEditor from './handling/HandlingEditor'
import NotFound from './ui/NotFound'
import { blastRadii, seedBlastRadii } from './blast-radius/useBlastRadii'
import HomeDashboard from './home/HomeDashboard'
import { activeDataset, measuredImAvailable, measuredV2Source, switchDataset, logoutMeasured, type DatasetKind } from './data/datasetBootstrap'
import {
  PAGE_HASH,
  getInitialGraphTarget,
  getInitialFindingId,
  getInitialPage,
  getInitialThreatDetail,
  getInitialThreatView,
  getInitialConfigThreat,
  configThreatHash,
  type ConfigThreatRef,
  type Page,
  PAGE_TITLE,
} from './appRouting'
import { hasLocalServer, hidesAccessGaps, hidesAdapters, isDemoMode } from './demoMode'
import { isPublicDemo } from './publicDemo'
import { opensOnLanding } from './tutorial/tutorialStorage'
import { applyExceptions, fingerprintOf } from './exceptions/applyExceptions'
import { buildExceptions, snapshotOf, useExceptions, type ExceptionDraft } from './exceptions/useExceptions'
import { falsePositiveHints, likeExceptionDraft } from './exceptions/falsePositiveHints'
import { saveActor } from './exceptions/store'
import Toast, { type ToastMessage } from './exceptions/Toast'
import { useCredentials } from './credentials/useCredentials'
import type { ThreatException } from './model/exception'
import { sortBySeverity } from './findings/severity'
import { backOr, isListHash, trackInAppHistory } from './ui/backNav'
import { readGraphSession } from './semantic-graph/graphSession'
import type { SemanticLevel } from './semantic-graph/types'
import type { InvestigationPath } from './semantic-graph/investigationQuery'
import { threatCsv } from './findings/threatCsv'
import { downloadText } from './utils/csv'

import { flushSync } from 'react-dom'
import ThreatViewSwitch, { type ThreatTab, type ThreatView } from './findings/ThreatViewSwitch'
import SaasConnect from './credentials/SaasConnect'
import DemoSettingsCards from './credentials/DemoSettingsCards'
import { adapterCardState } from './credentials/adapterCardState'
import { PageErrorBoundary } from './PageErrorBoundary'

/* 화면 단위 코드 분할. 15KB 넘는 화면만 나눈다(작은 모듈은 요청 왕복이 더 비싸다).
   그래프와 App 은 빌드 때 index.html 에 modulepreload 로 걸어 데이터와 함께 받는다(vite.config.ts appPreloadPlugin).
   나머지는 첫 화면이 뜬 뒤 한가할 때 미리 받아 화면을 처음 열 때 기다리지 않게 한다. */
const PAGE_LOADERS = {
  graph: () => import('./UnifiedFullGraph'),
  finding: () => import('./FindingDetail'),
  credentialRisk: () => import('./blast-radius/CredentialRiskPage'),
  manual: () => import('./manual/ManualPage'),
  exceptions: () => import('./exceptions/ExceptionsPage'),
  credentials: () => import('./credentials/CredentialsPage'),

  eventBoard: () => import('./event-board/EventBoardPage'),
  compliance: () => import('./compliance/ComplianceHub'),
  assistant: () => import('./assistant/AssistantPanel'),
  configDetail: () => import('./config-findings/ConfigFindingDetail'),
  scenarios: () => import('./scenario-builder/ScenarioBuilderPage'),
}
const UnifiedFullGraph = lazy(PAGE_LOADERS.graph)
const FindingDetail = lazy(PAGE_LOADERS.finding)
const CredentialRiskPage = lazy(PAGE_LOADERS.credentialRisk)
const ConfigFindingDetail = lazy(PAGE_LOADERS.configDetail)
const ScenarioBuilderPage = lazy(PAGE_LOADERS.scenarios)
const ManualPage = lazy(PAGE_LOADERS.manual)
const ExceptionsPage = lazy(PAGE_LOADERS.exceptions)
const CredentialsPage = lazy(PAGE_LOADERS.credentials)

const EventBoardPage = lazy(PAGE_LOADERS.eventBoard)
const CompliancePage = lazy(PAGE_LOADERS.compliance)
const AssistantPanel = lazy(PAGE_LOADERS.assistant)
// 공개 데모 빌드에서만 내려받는다. 운영과 기업 데모 화면에는 없다
const DemoTutorial = lazy(() => import('./tutorial/PublicDemoTutorial'))
const OrbsDemoPage = lazy(() => import('./demo/OrbsDemoPage'))

/** 화면 청크를 한가할 때 받는다. AI 패널 청크를 받으면 onAssistantReady 를 부른다 */
function prefetchPages(onAssistantReady: () => void): () => void {
  const run = () => {
    for (const load of Object.values(PAGE_LOADERS)) void load().catch(() => undefined)
    void PAGE_LOADERS.assistant().then(onAssistantReady, () => undefined)
  }
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 3000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(run, 1500)
  return () => window.clearTimeout(id)
}

type GraphEntryContext = {
  eventEvidence?: AssistantEventGraph
  key: number
  objectKey?: string
  findingIds?: string[]
  provider?: 'all' | Provider
  level?: SemanticLevel
  /** 다른 화면에서 넘긴 사슬. 그래프의 선택 경로로 강조한다 */
  path?: InvestigationPath
  /** 위협 상세, 조치 상세에서 들어왔다. 위협의 객체만 보이는 범위로 연다 */
  evidenceOnly?: boolean
  /** 근거만 보기여도 배율 하한 없이 화면에 맞춰 연다 */
  fit?: boolean
  /** 함께 그릴 객체 사이 선(수집된 관계에 없는 연결) */
  links?: Array<{ from: string; to: string; relationTypes: string[] }>
  spreadKeys?: string[]
}

const aegiData = loadAegiIncData()
/**
 * 판정 결과. 위협은 엔진(aegi-adapter-engine 위협 판정 V2)이 계산한 derived 만 읽는다: 배포본은 D1 스냅샷 번들,
 * 로컬 개발과 기능 테스트는 데이터셋 폴더의 derived.json(aegi-adapter-engine npm run derived:write). 화면은 위협을 판정하지 않으므로 derived 가 없으면 위협이 없다.
 */
const derived = aegiData.derived
const detectedFindings = derived?.findings ?? []
/** D1 스냅샷 번호. 서버 도구(AI 그래프, 이벤트 조회)와 컴플라이언스 검사가 쓴다. 로컬 데이터셋의 derived.json 은 D1 에 없어 넘기지 않는다 */
const snapshotId = measuredV2Source === 'remote' ? derived?.snapshotId : undefined
/** 자격증명 피해 범위도 엔진 결과를 쓴다. 같은 그래프로 다시 묻는 화면(Graph 상세 패널)도 계산하지 않게 미리 넣어 둔다 */
if (derived) seedBlastRadii(aegiData.graph, derived.blast)
/** 위협의 SaaS 는 탐지 경로 그림의 SaaS 와 같게 맞춘다 */
const evaluatedFindings = withPathProviders(detectedFindings, aegiData.graph, aegiData.evidenceStore)
/* 위협 판정 V2 위협이 닿는 조직 밖 목적지. 예외 처리 창의 「목적지 전체」가 위협마다 꺼내 쓰므로 한 번만 모은다 */
const destinationsOfFinding = destinationsByFinding(outsideDestinations(evaluatedFindings.filter(f => f.threatPath), aegiData.graph))

/* 운영에서 닫은 Access Gaps 의 주소(#access-gaps?gap=<위협 번호>)를 위협 상세 주소로 바꾼다. 그 위협이 없으면 위협 목록이다.
   옛 연동 경로 id 주소도 위협 목록으로 간다. 공개 데모는 Access Gaps 를 연다 */
function redirectGapHash(): void {
  if (typeof window === 'undefined' || !hidesAccessGaps()) return
  const match = /^#access-gaps\?(.*)$/i.exec(window.location.hash)
  const gapId = match ? new URLSearchParams(match[1]).get('gap') : null
  if (!gapId) return
  const finding = evaluatedFindings.find(f => f.id === gapId)
  window.history.replaceState(window.history.state, '', finding ? `#threat?finding=${finding.id}` : '#threat')
}
redirectGapHash()

/**
 * 연동된 SaaS 한 줄.
 *
 * 수집된 그래프에 있는 SaaS 를 그대로 늘어놓는다(sortProviders). tenant 키를 코드에 적지 않는다:
 * 배포 환경이나 연결 SaaS 가 바뀌면 틀린 키가 남기 때문이다. tenant 는 그 SaaS 의 Tenant 객체에서 찾고,
 * 이름, 유형, 객체 수, 관계 수, Finding 수는 전부 그래프에서 센다. 화면마다 따로 세면 같은 환경을 두고
 * 홈은 135, 그래프는 174라고 말하는 일이 다시 생긴다.
 */
const ALL_PROVIDERS = sortProviders(new Set([...SUPPORTED_PROVIDERS, ...aegiData.graph.objectsByProvider.keys()]))

const PROVIDER_ROWS: Array<{ name: string; tenantKey: string; provider: string; logo: ProviderId }> = ALL_PROVIDERS.map(provider => {
  const objects = aegiData.graph.objectsByProvider.get(provider) ?? []
  const tenant = objects.find(obj => obj.canonical.interfaces.includes('Tenant'))
  return { name: providerName(provider), tenantKey: tenant?.fixture_key ?? '', provider, logo: providerLogoId(provider) }
})


/**
 * 배포본의 예외는 팀 공용 D1, 개발 서버의 로컬 파일에서는 이 브라우저에 저장한다.
 */
const EXCEPTION_BACKEND =
  measuredV2Source === 'remote'
    ? 'remote'
    : 'local'

/**
 * 수집 자격증명 대장을 어디에 두나. 배포본은 늘 팀 공용 D1(server/credentials.ts, 팀 비밀번호 세션 필요) — 데이터셋과 상관없이
 * 실측 수집 하나의 대장이다. dev 서버는 이 브라우저.
 */
const CREDENTIAL_BACKEND = measuredV2Source === 'remote' ? 'remote' : 'local'

/** 화면에 들어올 때만 대장을 불러온다 */
function AdaptersScreen({ now, rows, collection }: { now: Date; rows: ProviderStat[]; collection: Map<string, ProviderCollection> }) {
  const api = useCredentials(CREDENTIAL_BACKEND)
  const [connections, setConnections] = useState<Record<string, boolean>>({})
  const [datasetName, setDatasetName] = useState<string | undefined>()
  const onConnectionChange = useCallback((provider: string, connected: boolean) => {
    setConnections(previous => previous[provider] === connected ? previous : { ...previous, [provider]: connected })
  }, [])
  useEffect(() => {
    if (!hasLocalServer()) return
    let current = true
    void fetch('/api/measured/graph/summary', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(async response => {
        if (!response.ok) return undefined
        const body = await response.json() as { datasetName?: unknown }
        return typeof body.datasetName === 'string' ? body.datasetName : undefined
      })
      .then(name => { if (current) setDatasetName(name) })
      .catch(() => undefined)
    return () => { current = false }
  }, [])
  return <CredentialsPage api={api} now={now} onLogin={() => window.location.reload()} header={<AdaptersHead rows={rows} collection={collection} connections={connections} onConnectionChange={onConnectionChange} datasetName={datasetName} />} />
}

/** 예외로 가린 Finding 은 세지 않는다 — 그래서 탐지 결과를 받아 센다. */
type ProviderStat = ReturnType<typeof buildProviderStats>[number]
const buildProviderStats = (findings: FindingV2[]) => PROVIDER_ROWS.map(item => {
  const tenant = (item.tenantKey ? aegiData.graph.objectsByKey.get(item.tenantKey) : undefined)
    ?? Array.from(aegiData.graph.objectsByProvider.get(item.provider) ?? []).find(obj =>
      ['tenant', 'organization', 'Organization', 'org', 'workspace', 'Customer', 'site'].includes(obj.canonical.object_type)
    )
  let relations = 0
  for (const relation of aegiData.graph.relationsByKey.values()) {
    if (relation.provider === item.provider) relations += 1
  }
  return {
    ...item,
    displayName: (tenant?.fixture_meta?.display_name as string) ?? tenant?.canonical.properties?.name ?? tenant?.canonical.properties?.companyName ?? item.name,
    term: tenant?.canonical.object_type ?? '',
    objects: aegiData.graph.objectsByProvider.get(item.provider)?.length ?? 0,
    relations,
    findings: findings.filter(finding =>
      finding.providerSet.includes(item.provider as FindingV2['providerSet'][number])
    ).length,
  }
})

/** 판정에 쓰인 수집 기록을 소스별로 센다. */
const evidenceSummary = (() => {
  const bySource = new Map<string, { sourceRef: string; record: string; count: number }>()
  let measured = 0
  for (const observation of aegiData.evidenceStore.observationsById.values()) {
    if (observation.provenance.record === 'measured') measured += 1
    const key = observation.provenance.sourceRef
    const row = bySource.get(key)
    if (row) row.count += 1
    else bySource.set(key, { sourceRef: key, record: observation.provenance.record, count: 1 })
  }
  const total = aegiData.evidenceStore.observationsById.size
  return {
    total,
    measured,
    synthetic: total - measured,
    sources: bySource.size,
    bySource: [...bySource.values()].sort((a, b) => b.count - a.count),
  }
})()

/**
 * 이 환경이 언제까지 수집된 것인가.
 *
 * 손으로 적지 않고 객체·관계에 찍힌 수집 시각 중 가장 늦은 것을 쓴다.
 * 화면에는 다른 시각과 같이 KST 로 적는다(utils/time).
 */
const latestByProvider = latestCollectedByProvider(aegiData.graph)
const collectedAt = [...latestByProvider.values()].reduce((latest, at) => (at > latest ? at : latest), '')



const SIDEBAR_KEY = 'aegi:sidebar'

export default function App() {
  useEffect(() => { void loadStandardHistory() }, [])
  /* 최신 기준별 판정의 위반을 위협 목록에 같이 올린다 (#222). 판정이 없으면 null */
  const standardResults = useStandardResults()
  const threatConfigRows = useMemo(() => (standardResults ? toConfigRows(standardResults) : null), [standardResults])
  const standardHistory = useStandardHistory()
  const [page, setPage] = useState<Page>(getInitialPage)
  const [selectedFindingId, setSelectedFindingId] = useState<string>(getInitialFindingId)
  const [threatDetailOpen, setThreatDetailOpen] = useState<boolean>(getInitialThreatDetail)
  const [threatView, setThreatView] = useState<ThreatView>(getInitialThreatView)
  /* Threat 목록의 설정 행에서 연 설정 위반 상세(#threat?config=<SaaS>:<finding id>) */
  const [configThreat, setConfigThreat] = useState<ConfigThreatRef | null>(() => getInitialConfigThreat())
  // 상세에서 뒤로 가기가 어디로 돌아갈지. 목록에서 열었으면 목록으로,
  // 그래프에서 열었으면 그래프로 돌아가야 한다.
  const [threatEntry, setThreatEntry] = useState<'list' | 'graph'>('list')
  /* 그래프 주소(#graph?object=&level=)로 처음 열면 그 객체와 표시 수준으로 연다.
     이 탭에서 조사하던 그래프가 있으면(새로고침) 그것을 되살린다 */
  const [graphEntry, setGraphEntry] = useState<GraphEntryContext>(() => {
    if (Object.keys(readGraphSession()).length > 0) return { key: 0 }
    const target = getInitialGraphTarget()
    return {
      key: 0,
      objectKey: target.objectKey && aegiData.graph.objectsByKey.has(target.objectKey) ? target.objectKey : undefined,
      level: target.level,
    }
  })
  /* 진입 문맥(누른 객체, 위협, SaaS)은 그 진입에서 처음 한 번만 쓴다. 다른 화면에 갔다가 뒤로 가기로
     돌아오면 진입 문맥으로 덮지 않고 보던 조사(카메라, 선택)를 되살린다 */
  const usedGraphEntry = useRef(-1)
  const freshGraphEntry = graphEntry.key !== usedGraphEntry.current
  useEffect(() => {
    if (page === 'Graph') usedGraphEntry.current = graphEntry.key
  }, [page, graphEntry.key])
  const [assistantOpen, setAssistantOpen] = useState(false)
  // AI 패널은 첫 화면 뒤 한가할 때 청크를 받으면 마운트한다(그 전에 열면 그때). 처음부터 숨긴 채 그리면
  // 패널이 쓰는 그래프 청크까지 첫 화면에서 받아야 했다
  const [assistantMounted, setAssistantMounted] = useState(false)
  useEffect(() => { if (assistantOpen) setAssistantMounted(true) }, [assistantOpen])
  useEffect(() => prefetchPages(() => setAssistantMounted(true)), [])
  // AI 창은 사용자가 열 때만 연다(AI 단추, Ctrl+K, 화면의 AI 질문 단추). 탭을 눌렀다고 저절로 열지 않는다
  const [assistantSeed, setAssistantSeed] = useState<AssistantSeed>()
  const askAssistant = useCallback((selection?: AssistantSelection, question?: string, eventKey?: string, submit?: boolean) => {
    // Event Board는 보드와 이어진 자기 AI 창을 쓴다. 메뉴의 AI 질문과 Ctrl+K는 그 창을 연다
    if (page === 'EventBoard') { window.dispatchEvent(new CustomEvent('aegi:event-board-ai', { detail: submit && question ? { question } : undefined })); return }
    let selected = selection
    if (!selected && submit && question) selected = emptySelection()
    if (!selected && page === 'Threat' && threatDetailOpen) selected = { ...emptySelection(), findingIds: [selectedFindingId] }
    if (!selected && page === 'Credentials') {
      const credentialKey = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('cred')
      if (credentialKey && aegiData.graph.objectsByKey.get(credentialKey)?.canonical.interfaces.includes('Credential')) selected = { ...emptySelection(), objectKeys: [credentialKey] }
    }
    if (!selected && page === 'Gaps') {
      // Access Gaps 상세 주소의 gap 은 위협 번호다
      const gapId = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('gap')
      if (gapId && evaluatedFindings.some(f => f.id === gapId)) selected = { ...emptySelection(), findingIds: [gapId] }
    }
    setAssistantOpen(true)
    if (selected) setAssistantSeed(previous => ({ eventKey, submit, id: (previous?.id ?? 0) + 1, selection: selected!, question: question ?? (selected!.findingIds.length ? '이 탐지의 근거와 위험, 필요한 조치를 설명해줘.' : '선택한 항목의 연결 구조와 보안상 의미를 설명해줘.') }))
  }, [page, threatDetailOpen, selectedFindingId])

  /* 본문 폭 단계. 화면 배치는 브라우저 폭(media query)으로 바뀌어, AI 창이 오른쪽 폭을 가져가도
     넓은 화면 배치를 그대로 써서 표 머리글과 수치 줄이 겹쳤다. 본문 폭을 재서 단계 이름을 붙이고,
     contentFit.css가 그 이름으로 좁은 화면 배치를 쓴다. 기준은 메뉴(196px)를 뺀 media query 값이다. */
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = contentRef.current
    if (!element) return
    const steps = [1000, 900, 800, 640, 560]
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      for (const step of steps) element.classList.toggle(`cw-lt-${step}`, width < step)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Ctrl+K(Mac은 Cmd+K)로 어느 화면에서나 AI 창을 열고, 이미 열려 있으면 입력칸으로 간다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      if (assistantOpen) document.querySelector<HTMLTextAreaElement>('#assistant-question')?.focus()
      else askAssistant()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [assistantOpen, askAssistant])

  /**
   * 예외 적용. 탐지 결과(evaluatedFindings)는 그대로 두고 여기서 한 번 거른다.
   * 목록·개요·그래프·Adapters·Explorer 는 visibleFindings 를 받고,
   * Finding 상세와 조치 상세는 예외된 Finding 의 주소로도 열리도록 원본에서 찾는다.
   * now 는 1분마다 갱신한다 — 화면을 연 채로 만료 시각이 지나도 위협이 다시 뜨게.
   */
  const [now, setNow] = useState(() => new Date())
  /* 인쇄 머리글의 출력 시각. 인쇄 창이 뜨기 직전에 맞춘다 */
  const [printedAt, setPrintedAt] = useState(() => new Date())
  useEffect(() => {
    const onBeforePrint = () => flushSync(() => setPrintedAt(new Date()))
    window.addEventListener('beforeprint', onBeforePrint)
    return () => window.removeEventListener('beforeprint', onBeforePrint)
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const exceptionsApi = useExceptions(activeDataset, EXCEPTION_BACKEND)
  const exceptionResult = useMemo(
    () => applyExceptions(evaluatedFindings, exceptionsApi.exceptions, now),
    [exceptionsApi.exceptions, now]
  )
  const visibleFindings = exceptionResult.visibleFindings
  /* 위협 처리 상태. 배포본의 실측은 팀 공용 D1, 그 밖에는 이 브라우저에 둔다(예외와 같은 곳) */
  const handlingApi = useHandling(activeDataset, EXCEPTION_BACKEND)
  const handlingNotice = handlingApi.notice
  /* 전에 오탐으로 처리한 위협과 원인이 비슷한 열린 위협. 표시만 하고 가리지 않는다 */
  const fpHints = useMemo(
    () => falsePositiveHints(exceptionResult.views, exceptionsApi.exceptions, fp => handlingApi.byFingerprint.get(fp)?.state),
    [exceptionResult, exceptionsApi.exceptions, handlingApi.byFingerprint],
  )
  useEffect(() => {
    if (handlingNotice) setToast({ id: handlingNotice.id, text: handlingNotice.text })
  }, [handlingNotice])
  /* 조치 진행 상태. 위협(지문)과 조치의 짝마다 같은 저장소에 둔다 */
  const progressApi = useRemediationProgress(activeDataset, EXCEPTION_BACKEND)
  const progressNotice = progressApi.notice
  useEffect(() => {
    if (progressNotice) setToast({ id: progressNotice.id, text: progressNotice.text })
  }, [progressNotice])
  /* 처리하던 위협 중 이번 수집에서 사라진 것. 다음 수집에서 사라지면 해결됨으로 본다 */
  const goneHandling = useMemo(() => {
    const current = new Set(evaluatedFindings.map(fingerprintOf))
    return handlingApi.items.filter(h => h.state !== 'new' && !current.has(h.fingerprint))
  }, [handlingApi.items])
  const threatCount = visibleFindings.length
  const highThreats = visibleFindings.filter(f => f.severity === 'high' || f.severity === 'critical').length
  const providerStats = useMemo(() => buildProviderStats(visibleFindings), [visibleFindings])
  /* SaaS별 마지막 수집과 상태. 날이 바뀌면 오래됨이 되므로 now 를 따른다 */
  const collection = useMemo(() => {
    const result = new Map<string, ProviderCollection>()
    for (const provider of new Set([...PROVIDER_ROWS.map(row => row.provider), ...aegiData.graph.objectsByProvider.keys()])) {
      result.set(provider, collectionState(latestByProvider.get(provider) ?? '', now, aegiData.coverage?.calls.filter(call => call.provider === provider)))
    }
    return result
  }, [now])
  const [exceptionTarget, setExceptionTarget] = useState<{ findingId: string; like?: ThreatException } | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  // 서버 저장이 실패하면(충돌·로그인 만료 등) 이유를 알림으로 띄운다
  const exceptionNotice = exceptionsApi.notice
  useEffect(() => {
    if (exceptionNotice) setToast({ id: exceptionNotice.id, text: exceptionNotice.text })
  }, [exceptionNotice])
  const closeToast = useCallback(() => setToast(null), [])
  const closeExceptionDialog = useCallback(() => setExceptionTarget(null), [])

  /* 앱 안에서 생긴 방문 기록마다 직전 주소를 적어 둔다. 화면 안 「←」가 이것으로 뒤로 가기를 고른다 */
  useEffect(() => trackInAppHistory(), [])

  useEffect(() => {
    const handleHash = () => {
      redirectGapHash()
      setPage(getInitialPage())
      const fid = getInitialFindingId()
      if (fid) setSelectedFindingId(fid)
      setThreatDetailOpen(getInitialThreatDetail())
      setThreatView(getInitialThreatView())
      setConfigThreat(previous => {
        const next = getInitialConfigThreat()
        return next && previous && next.provider === previous.provider && next.findingId === previous.findingId ? previous : next
      })
    }
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  /**
   * 화면을 바꿀 때 주소도 같이 바꾼다.
   *
   * 전에는 Threat Analysis만 주소를 적었다. 거기 한 번 들렀다가 Home으로
   * 돌아와도 주소에는 #threat이 남고, 그 주소를 다시 열면 첫 화면이
   * Threat Analysis였다. 처음 들어온 사람이 Home을 못 보던 이유다.
   */
  /**
   * 다른 화면이나 다른 상세로 옮길 때는 맨 위부터 연다. 전에는 이전 화면의 스크롤 자리를 이어받아,
   * 조치 상세가 1574px 아래에서 열려 제목과 상태 고르기가 화면 밖에 있었다.
   * 목록 화면은 렌더 뒤 자기 useLayoutEffect 에서 보던 자리를 되살리므로 여기서 먼저 올려도 된다.
   */
  const toTop = () => {
    window.scrollTo(0, 0)
    if (contentRef.current) contentRef.current.scrollTop = 0
  }

  const goPage = (next: Page) => {
    toTop()
    let target = next
    /* Access Gaps 와 Config Findings 는 없앤 화면이다. 위협 목록으로 보낸다(공개 데모는 Access Gaps 를 연다) */
    if ((next === 'Gaps' && hidesAccessGaps()) || next === 'ConfigFindings' || next === 'Remediation') target = 'Threat'
    else if (isDemoMode()) {
      if (next === 'Home' || next === 'Explorer' || next === 'Credentials' || next === 'Manual' || (next === 'Adapters' && hidesAdapters())) target = 'Graph'
    }
    if (window.location.hash !== PAGE_HASH[target]) window.location.hash = PAGE_HASH[target]
    setPage(target)
  }

  /* 그 객체들의 최근 7일 조회를 추가한 Event Board 로 간다. 주소에 남겨 뒤로 가기로 돌아온다 */
  const goRelatedEvents = (objectKeys: readonly string[]) => {
    toTop()
    const q = new URLSearchParams()
    if (objectKeys.length) q.set('objects', objectKeys.join(','))
    q.set('days', '7')
    window.location.hash = `${PAGE_HASH.EventBoard}?${q}`
    setPage('EventBoard')
  }

  /* 위협이나 접근 경로의 객체를 조사 대상으로 Event Board 를 연다 */
  const goEventBoard = (objectKeys: readonly string[], findingId?: string) => {
    toTop()
    const q = new URLSearchParams()
    if (objectKeys.length) q.set('object', objectKeys.join(','))
    if (findingId) q.set('finding', findingId)
    window.location.hash = PAGE_HASH.EventBoard + (q.toString() ? `?${q}` : '')
    setPage('EventBoard')
  }

  /*
   * Access Gap 열기(AI 답의 이동 단추). id 는 위협 번호다. 그 위협에 벤이 있고 화면이 열려 있으면 그 위협의 Access Gaps 상세로,
   * 아니면 위협 상세로, 그런 위협이 없으면 위협 목록으로
   */
  const openAccessGap = (gapId: string) => {
    const finding = evaluatedFindings.find(f => f.id === gapId)
    if (!hidesAccessGaps() && finding?.threatAccessGap) {
      window.location.hash = `${PAGE_HASH.Gaps}?gap=${encodeURIComponent(finding.id)}`
      setPage('Gaps')
      return
    }
    if (finding) goThreatFinding(finding.id)
    else goPage('Threat')
  }

  const goEventBoardConfig = (findingId: string, itemId: string) => {
    toTop()
    window.location.hash = PAGE_HASH.EventBoard + `?config=${encodeURIComponent(`${findingId}:${itemId}`)}`
    setPage('EventBoard')
  }

  const openGraph = (context: Omit<GraphEntryContext, 'key'> = {}) => {
    toTop()
    setGraphEntry(previous => ({ ...context, key: previous.key + 1 }))
    if (window.location.hash !== PAGE_HASH.Graph) window.location.hash = PAGE_HASH.Graph
    setPage('Graph')
  }

  /* 메뉴를 접어 둔 사람은 새로고침해도 접힌 채로 본다. 저장소를 못 쓰면 펼친 채로 시작한다 */
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return window.localStorage.getItem(SIDEBAR_KEY) !== 'collapsed' } catch { return true }
  })
  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? 'open' : 'collapsed') } catch { /* 기억하지 못해도 메뉴는 그대로 쓴다 */ }
  }, [sidebarOpen])

  // 예외된 Finding 도 주소로 열린다 (상세에 예외 배너가 뜬다). 찾지 못하면 열린 위협 중 첫 번째, 그것도 없으면 목록을 보인다.
  const currentView = useMemo(() => {
    const found =
      evaluatedFindings.find(f => f.id === selectedFindingId) ??
      visibleFindings[0] ??
      evaluatedFindings[0]
    return found ? exceptionResult.viewsById.get(found.id) : undefined
  }, [selectedFindingId, exceptionResult, visibleFindings])
  const currentFinding = currentView?.finding
  /* 설정 위반 상세가 볼 finding. 판정 이력을 받는 중이면 undefined 이고 아직 「찾을 수 없음」을 띄우지 않는다 */
  const currentConfigFinding = useMemo(() => (configThreat ? findConfigFinding(standardResults, configThreat) : undefined), [configThreat, standardResults])
  /* 주소가 가리킨 위협이 지금 데이터에 없다. 다른 위협을 대신 보이지 않고 안내한다 */
  /* 브라우저 탭 제목. 전에는 모든 화면이 「AEGI Security Analysis」라 탭, 방문 기록, 북마크에서 화면을 가를 수 없었다 */
  useEffect(() => {
    let name = PAGE_TITLE[page]
    if (page === 'Threat' && configThreat) name = currentConfigFinding ? `${currentConfigFinding.id} 상세` : '설정 위반 상세'
    else if (page === 'Threat' && threatDetailOpen && currentFinding) name = `${currentFinding.id} 상세`
    else if (page === 'Threat') name = `Threat (${visibleFindings.length})`
    document.title = `${name} | AEGI`
  }, [page, configThreat, currentConfigFinding, threatDetailOpen, currentFinding, visibleFindings.length])

  const configDetailOpen = page === 'Threat' && configThreat !== null && threatView === 'threats'
  const configMissing = configDetailOpen && !currentConfigFinding && !standardHistory.loading && (standardResults !== undefined || standardHistory.error !== '')
  const findingMissing = page === 'Threat' && threatDetailOpen &&
    !evaluatedFindings.some(f => f.id === selectedFindingId)

  const submitException = (draft: ExceptionDraft) => {
    const view = exceptionTarget ? exceptionResult.viewsById.get(exceptionTarget.findingId) : undefined
    if (!view) return
    const at = new Date()
    const items = buildExceptions(view.original, draft, activeDataset, at)
    if (items.length === 0) return
    saveActor(draft.actor.trim())
    exceptionsApi.add(items)
    setExceptionTarget(null)
    const undo = { label: '되돌리기', run: () => exceptionsApi.remove(items.map(i => i.id)) }
    if (draft.scope === 'destination') {
      const hidden = countNewlyHidden(items)
      setToast({ id: Date.now(), text: `목적지 ${items.length}곳 예외 처리 완료. 위협 ${hidden}개 제외`, action: undo })
      return
    }
    setToast({ id: Date.now(), text: `${view.original.id} 예외 처리 완료. 목록, 개요, 그래프에서 제외`, action: undo })
  }

  /* 예외를 더하면 새로 가려지는 위협 수. 목적지 전체는 다른 위협까지 가리므로 모든 위협으로 센다.
     예외 처리 창이 목적지를 고를 때만 부르고, 창의 미리보기가 같은 함수를 계속 받게 묶어 둔다 */
  const countNewlyHidden = useCallback(
    (drafts: ThreatException[]) =>
      applyExceptions(evaluatedFindings, [...exceptionsApi.exceptions, ...drafts], now).summary.exceptedFindings - exceptionResult.summary.exceptedFindings,
    [exceptionsApi.exceptions, now, exceptionResult]
  )

  const revokeExceptions = (ids: string[], actor: string, note?: string) => {
    if (ids.length === 0) return
    saveActor(actor)
    exceptionsApi.revoke(ids, actor, note)
    const findingId = exceptionResult.info.get(ids[0])?.findingId
    setToast({
      id: Date.now(),
      text: `예외 ${ids.length}건 취소. 해당 위협 다시 탐지`,
      action: findingId ? { label: '위협 보기', run: () => goThreatFinding(findingId) } : undefined,
    })
  }

  const reapplyException = (id: string, reason: string, expiresAt: string | null, actor: string, approver?: string) => {
    saveActor(actor)
    const findingId = exceptionResult.info.get(id)?.findingId
    const view = findingId ? exceptionResult.viewsById.get(findingId) : undefined
    const fresh = exceptionsApi.reapply(id, { reason, expiresAt, snapshot: view ? snapshotOf(view.original) : undefined, approver }, actor)
    if (fresh) setToast({ id: Date.now(), text: `${id}를 ${fresh.id}에 다시 적용` })
  }

  const importExceptions = (items: ThreatException[]) => {
    exceptionsApi.importItems(items)
    setToast({ id: Date.now(), text: `예외 ${items.length}건 가져오기 완료` })
  }

  /* Threat Analysis 제목 줄의 위협, 설정 점검, 예외 탭. 위협 목록 화면은 목록 종류 바꾸기(onList)를 넘기고,
     예외 화면에서 위협이나 설정 점검을 고르면 그 목록으로 간다 */
  const threatViewSwitch = (tab: ThreatTab, onList?: (config: boolean) => void) => (
    <ThreatViewSwitch
      tab={tab}
      threatCount={visibleFindings.length}
      configCount={threatConfigRows?.length ?? 0}
      exceptionCount={exceptionResult.summary.active}
      exceptionReview={exceptionResult.summary.review}
      onChange={next => {
        if (next === tab) return
        if (next === 'exceptions') goThreatExceptions()
        else if (onList) onList(next === 'config')
        else { chooseThreatList(next === 'config'); goThreatFinding() }
      }}
    />
  )

  const goThreatFinding = (findingId?: string, entry: 'list' | 'graph' = 'list') => {
    toTop()
    setConfigThreat(null)
    if (findingId) {
      const found = evaluatedFindings.find(f => f.id === findingId)
      if (found) setSelectedFindingId(found.id)
      setThreatEntry(entry)
      setThreatDetailOpen(true)
    } else {
      setThreatDetailOpen(false)
    }
    window.location.hash = findingId ? `#threat?finding=${findingId}` : '#threat'
    setPage('Threat')
    setThreatView('threats')
  }

  /* 설정 행의 상세는 Threat 안에서 연다. 운영과 데모가 같다 */
  const goThreatConfig = (ref: ConfigThreatRef) => {
    toTop()
    setThreatDetailOpen(false)
    setConfigThreat(ref)
    window.location.hash = configThreatHash(ref.provider, ref.findingId)
    setPage('Threat')
    setThreatView('threats')
  }

  const goThreatExceptions = (exceptionId?: string) => {
    toTop()
    setConfigThreat(null)
    setThreatDetailOpen(false)
    setThreatView('exceptions')
    const hash = exceptionId ? `#threat?view=exceptions&id=${encodeURIComponent(exceptionId)}` : '#threat?view=exceptions'
    if (window.location.hash !== hash) window.location.hash = hash
    setPage('Threat')
  }

  return (
    <AssistantBridge.Provider value={{ ask: askAssistant, isOpen: assistantOpen }}>
    <div className={`app light-theme app-shell ${sidebarOpen ? 'sidebar-open' : 'sidebar-collapsed'}`}>
      {/* 키보드로 메뉴 13개를 건너뛰고 본문으로. Tab 을 처음 누르면 보인다. 주소(#)는 화면 이동에 쓰므로 링크 대신 초점을 옮긴다 */}
      <button type="button" className="skip-link" onClick={() => contentRef.current?.focus()}>본문으로 건너뛰기</button>
      <aside className={`sidebar-nav ${sidebarOpen ? 'expanded' : 'collapsed'}`}>
        <div className="sidebar-top">
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={sidebarOpen ? '메뉴 접기' : '메뉴 펼치기'}
            title={sidebarOpen ? '메뉴 접기' : '메뉴 펼치기'}
            onClick={() => setSidebarOpen(prev => !prev)}
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
          <button type="button" className="sidebar-brand" onClick={() => (isDemoMode() ? openGraph() : goPage('Home'))}>
            AEGI
          </button>
        </div>
        <nav className="sidebar-menu" aria-label="주 메뉴">
          {/* 한 층에 두고 묶음 셋(첫 화면 / 그래프와 분석 / 예외, 자격증명, 설정, 도움말) 사이는 선으로만 가른다.
              접힌 메뉴에서는 이름이 숨으므로 title 과 aria-label 로 이름을 남긴다. */}
          {!isDemoMode() && (
            <>
              <button onClick={() => goPage('Home')} className={page === 'Home' ? 'active' : ''} title="Overview" aria-label="Overview">
                <span className="nav-icon"><House size={18} strokeWidth={1.75} /></span>
                <span className="nav-label">Overview</span>
              </button>
              <i className="nav-sep" aria-hidden="true" />
            </>
          )}
          <button onClick={() => openGraph()} className={page === 'Graph' ? 'active' : ''} title="Cross-SaaS Graph" aria-label="Cross-SaaS Graph">
            <span className="nav-icon"><Waypoints size={18} strokeWidth={1.75} /></span>
            <span className="nav-label">Cross-SaaS Graph</span>
          </button>
          {!isDemoMode() && (
            <button onClick={() => goPage('Explorer')} className={page === 'Explorer' ? 'active' : ''} title="Explorer" aria-label="Explorer">
              <span className="nav-icon"><SearchIcon size={18} strokeWidth={1.75} /></span>
              <span className="nav-label">Explorer</span>
            </button>
          )}

          <button onClick={() => goThreatFinding()} className={page === 'Threat' ? 'active' : ''} title="Threat" aria-label={threatCount > 0 ? (highThreats > 0 ? `Threat, 위협 ${threatCount}건, HIGH 이상 ${highThreats}건` : `Threat, 위협 ${threatCount}건`) : 'Threat'}>
            <span className="nav-icon">
              <ShieldAlert size={18} strokeWidth={1.75} />
              {threatCount > 0 && <i className={`nav-alert-dot${highThreats > 0 ? ' is-high' : ''}`} aria-hidden="true" />}
            </span>
            <span className="nav-label">Threat</span>
            {threatCount > 0 && <span className={`nav-label nav-count${highThreats > 0 ? ' is-high' : ''}`} title={highThreats > 0 ? `위협 ${threatCount}건, HIGH 이상 ${highThreats}건` : `위협 ${threatCount}건`}>{threatCount}</span>}
          </button>
          <button onClick={() => goPage('EventBoard')} className={page === 'EventBoard' ? 'active' : ''} title="Event Board" aria-label="Event Board">
            <span className="nav-icon"><NotebookPen size={18} strokeWidth={1.75} /></span>
            <span className="nav-label">Event Board</span>
          </button>
          <i className="nav-sep" aria-hidden="true" />
          <button onClick={() => goPage('Compliance')} className={page === 'Compliance' ? 'active' : ''} title="Compliance" aria-label="Compliance">
            <span className="nav-icon"><ShieldCheck size={18} strokeWidth={1.75} /></span>
            <span className="nav-label">Compliance</span>
          </button>
          {!hidesAdapters() && (
            <button onClick={() => goPage('Adapters')} className={page === 'Adapters' ? 'active' : ''} title="Adapters" aria-label="Adapters">
              <span className="nav-icon"><Plug size={18} strokeWidth={1.75} /></span>
              <span className="nav-label">Adapters</span>
            </button>
          )}
          {!isDemoMode() && (
            <button onClick={() => goPage('Manual')} className={page === 'Manual' ? 'active' : ''} title="Manual" aria-label="Manual">
              <span className="nav-icon"><BookOpen size={18} strokeWidth={1.75} /></span>
              <span className="nav-label">Manual</span>
            </button>
          )}
        </nav>
        {/* AI 진입은 Manual 아래에 두고, 접힌 메뉴에서는 다른 메뉴와 같은 흰 선 아이콘으로 표시한다. */}
        <div className="sidebar-ai">
          <button type="button" className="sidebar-ai-call" aria-label="AEGI AI에게 질문" title="Ctrl+K로 AEGI AI에게 질문" aria-controls="aegi-ai-panel" aria-expanded={assistantOpen} onClick={() => askAssistant()}>
            <span className="nav-icon"><AiLogo size={24} /></span><span className="nav-label">AEGI AI에게 질문</span>
          </button>
        </div>
        {/* 공개 데모의 「데모 시나리오 선택」 단추 자리. DemoTutorial 이 portal 로 채운다. 로그아웃보다 앞에 두어 Tab 순서도 화면 순서와 같게 한다 */}
        {isPublicDemo() && <div className="demo-tutorial-reopen-wrap" />}
        <DatasetToggle />
        {measuredV2Source === 'remote' && <LogoutButton />}
      </aside>

      <div className="app-content" ref={contentRef} tabIndex={-1}>
        {/* 인쇄할 때만 보이는 머리글 (print.css) */}
        <p className="print-head">AEGI {PAGE_TITLE[page]}, 출력 {formatKst(printedAt.toISOString())}, 수집 {formatKst(collectedAt)}</p>
        <PageErrorBoundary resetKey={page}>
        <Suspense fallback={<div className="page-loading" role="status">불러오는 중</div>}>
        {page === 'Compliance' && <CompliancePage graph={aegiData.graph} snapshotId={snapshotId} localData={measuredV2Source === 'local'} dataset={activeDataset} backend={EXCEPTION_BACKEND} onOpenObject={key => openGraph({ objectKey: key })} />}
        {page === 'Home' && (
          <HomeDashboard
            findings={visibleFindings}
            graph={aegiData.graph}
            collectedAt={collectedAt}
            collection={collection}
            now={now}
            onOpenThreat={() => goThreatFinding()}
            onOpenFinding={id => goThreatFinding(id)}
            onOpenAdapters={() => goPage('Adapters')}
            onOpenGraph={context => {
              if (context?.sourceProvider && context?.targetProvider) {
                openGraph({ provider: 'all', findingIds: context.findingIds ?? [] })
              } else {
                openGraph({ provider: context?.provider ?? context?.sourceProvider, findingIds: context?.findingIds ?? [] })
              }
            }}
          />
        )}

        {page === 'Graph' && (
          <UnifiedFullGraph
            key={graphEntry.key}
            onOpenAdapters={() => goPage('Adapters')}
            eventEvidence={graphEntry.eventEvidence}
            onOpenEvent={(eventKey, objects, at) => {
              const q = new URLSearchParams()
              q.set('event', eventKey)
              if (objects && objects.length) q.set('objects', objects.join(','))
              if (at) q.set('at', at)
              window.location.hash = `${PAGE_HASH.EventBoard}?${q}`
              setPage('EventBoard')
            }}
            onAskEvent={eventKey => askAssistant(emptySelection(), '이 이벤트의 행위자와 대상 노드, 앞뒤 활동을 조회해서 설명해줘.', eventKey)}
            onClearEvents={() => setGraphEntry(previous => ({ ...previous, eventEvidence: undefined }))}
            currentGraph={aegiData.graph}
            findings={visibleFindings}
            exceptedFindingCount={exceptionResult.summary.exceptedFindings}
            platformDefaultsHidden={aegiData.platformDefaultsHidden}
            effectiveAccess={aegiData.effectiveAccess}
            initialFocusObjectKey={freshGraphEntry ? graphEntry.objectKey : undefined}
            initialSelectedFindingIds={freshGraphEntry ? graphEntry.findingIds : undefined}
            initialProviderFilter={freshGraphEntry ? graphEntry.provider : undefined}
            initialQueryObjectKeys={freshGraphEntry ? graphEntry.spreadKeys : undefined}
            initialLevel={freshGraphEntry ? graphEntry.level : undefined}
            initialPath={freshGraphEntry ? graphEntry.path : undefined}
            initialEvidenceOnly={freshGraphEntry ? graphEntry.evidenceOnly : undefined}
            initialFit={freshGraphEntry ? graphEntry.fit : undefined}
            initialExtraLinks={freshGraphEntry ? graphEntry.links : undefined}
            onOpenThreat={findingId => goThreatFinding(findingId, 'graph')}
            collection={collection}
            onOpenEvents={objectKey => goRelatedEvents([objectKey])}
          />
        )}

        {findingMissing && (
          <NotFound
            title="위협 상세"
            heading="위협을 찾을 수 없음"
            id={selectedFindingId}
            backLabel="위협 목록 열기"
            onBack={() => goThreatFinding()}
          />
        )}

        {page === 'Threat' && !findingMissing && (!threatDetailOpen || !currentFinding) && threatView === 'exceptions' && (
          <ExceptionsPage
            key={activeDataset}
            exceptions={exceptionsApi.exceptions}
            result={exceptionResult}
            dataset={activeDataset}
            now={now}
            warning={exceptionsApi.warning}
            storage={exceptionsApi.storage}
            loading={exceptionsApi.loading}
            localPending={exceptionsApi.localPending}
            onUploadLocal={() => void exceptionsApi.uploadLocal()}
            onRefresh={exceptionsApi.refresh}
            onOpenFinding={id => goThreatFinding(id)}
            onRevoke={revokeExceptions}
            onExtend={(id, expiresAt, actor) => {
              saveActor(actor)
              exceptionsApi.extend(id, expiresAt, actor)
            }}
            onEdit={(id, patch, actor) => {
              saveActor(actor)
              exceptionsApi.edit(id, patch, actor)
            }}
            onReapply={reapplyException}
            onImport={importExceptions}
            viewSwitch={threatViewSwitch('exceptions')}
          />
        )}

        {configMissing && configThreat && (
          <NotFound
            title="설정 위반 상세"
            heading="설정 위반을 찾을 수 없음"
            id={`${configThreat.provider}:${configThreat.findingId}`}
            backLabel="위협 목록 열기"
            onBack={() => goThreatFinding()}
          />
        )}

        {configDetailOpen && currentConfigFinding && (
          <ConfigFindingDetail
            key={`${currentConfigFinding.provider}:${currentConfigFinding.id}`}
            finding={currentConfigFinding}
            graph={aegiData.graph}
            severity={threatConfigRows?.find(r => r.config?.provider === currentConfigFinding.provider && r.config.findingId === currentConfigFinding.id)?.severity}
            generatedAt={standardResults?.generated_at}
            pager={(() => {
              // 설정 위반끼리 차례로 넘긴다. 순서는 위협 목록 설정 행과 같은 심각도순이다
              const order = sortThreatRows(threatConfigRows ?? []).flatMap(r => (r.config ? [r.config] : []))
              const at = order.findIndex(c => c.provider === currentConfigFinding.provider && c.findingId === currentConfigFinding.id)
              if (at < 0) return undefined
              const go = (ref: ConfigThreatRef) => {
                toTop()
                window.history.replaceState(window.history.state, '', configThreatHash(ref.provider, ref.findingId))
                setConfigThreat(ref)
              }
              return {
                index: at + 1,
                total: order.length,
                onPrev: at > 0 ? () => go(order[at - 1]) : undefined,
                onNext: at < order.length - 1 ? () => go(order[at + 1]) : undefined,
              }
            })()}
            handlingSlot={(() => {
              const fingerprint = `cfg|${currentConfigFinding.provider}|${currentConfigFinding.id}`
              return (
                <HandlingEditor
                  fingerprint={fingerprint}
                  findingId={currentConfigFinding.id}
                  title={currentConfigFinding.text}
                  record={handlingApi.byFingerprint.get(fingerprint)}
                  onSave={handlingApi.save}
                />
              )
            })()}
            backLabel="Threat"
            onBack={() => backOr(isListHash(PAGE_HASH.Threat, 'config'), () => goThreatFinding())}
            onSelectObject={objectKey => openGraph({ objectKey })}
            onOpenEvents={goEventBoardConfig}
          />
        )}

        {page === 'Threat' && !findingMissing && !configDetailOpen && (!threatDetailOpen || !currentFinding) && threatView !== 'exceptions' && (
          <ThreatIndex
            findings={visibleFindings}
            graph={aegiData.graph}
            evidenceStore={aegiData.evidenceStore}
            views={exceptionResult.views}
            exceptedCount={exceptionResult.summary.exceptedFindings}
            onOpenFinding={id => goThreatFinding(id)}
            onException={findingId => setExceptionTarget({ findingId })}
            onOpenExceptions={() => goThreatExceptions()}
            handling={handlingApi.byFingerprint}
            fpHints={fpHints}
            syntheticOf={finding => finding.evidenceObservationIds.filter(id => aegiData.evidenceStore.observationsById.get(id)?.provenance.record === 'synthetic').length}
            viewSwitch={list => threatViewSwitch(list.config ? 'config' : 'threats', list.onList)}
            configRows={threatConfigRows}
            onOpenConfig={row => { if (row.config) goThreatConfig({ provider: row.config.provider, findingId: row.config.findingId }) }}
            onExport={list => downloadText(`aegi-threats-${new Date().toISOString().slice(0, 10)}.csv`, threatCsv(list, {
              handling: handlingApi.byFingerprint,
              exceptionOf: finding => {
                const view = exceptionResult.viewsById.get(finding.id)
                return view?.state === 'excepted' ? '예외 처리됨' : ''
              },
              collectedAt,
              configCollectedAt: standardResults?.generated_at,
            }))}
            gone={goneHandling}
          />
        )}

        {page === 'Gaps' && (
          <AccessGapsPage
            graph={aegiData.graph}
            findings={evaluatedFindings}
            onOpenFinding={id => goThreatFinding(id)}
            onOpenEvents={findingId => goEventBoard([], findingId)}
          />
        )}



        {page === 'EventBoard' && (
          <EventBoardPage dataset={activeDataset} backend={EXCEPTION_BACKEND} graph={aegiData.graph} findings={visibleFindings} evidenceStore={aegiData.evidenceStore} snapshotId={snapshotId} onOpenObject={objectKey => openGraph({ objectKey })} onShowEventGraph={(eventEvidence, objectKey) => openGraph({ eventEvidence, objectKey, level: 'object' })} />
        )}

        {page === 'Credentials' && (
          <CredentialRiskPage
            credentials={blastRadii(aegiData.graph, aegiData.effectiveAccess?.rows)}
            graph={aegiData.graph}
            onSelectObject={(objectKey, path) => openGraph({ objectKey, path })}
          />
        )}

        {page === 'Threat' && !findingMissing && threatDetailOpen && currentFinding && currentView && (
          <FindingDetail
            key={currentFinding.id}
            finding={currentFinding}
            view={currentView}
            now={now}
            onException={() => setExceptionTarget({ findingId: currentFinding.id })}
            onRevokeExceptions={revokeExceptions}
            onOpenException={id => goThreatExceptions(id)}
            fpHint={fpHints.get(currentFinding.id)}
            onExceptionLike={like => setExceptionTarget({ findingId: currentFinding.id, like })}
            graph={aegiData.graph}
            evidenceStore={aegiData.evidenceStore}
            onOpenEvents={goRelatedEvents}
            onOpenEventBoard={keys => goEventBoard(keys, currentFinding.id)}
            effectiveAccess={aegiData.effectiveAccess}
            backLabel={threatEntry === 'graph' ? 'Cross-SaaS Graph' : 'Threat'}
            onBack={() => {
              /* 그 화면에서 바로 왔으면 브라우저 뒤로 가기로 돌아가 기록을 쌓지 않는다 */
              if (threatEntry === 'graph') {
                backOr(hash => hash.toLowerCase().startsWith(PAGE_HASH.Graph), () => openGraph())
                return
              }
              backOr(isListHash(PAGE_HASH.Threat, 'finding'), () => {
                window.location.hash = PAGE_HASH.Threat
                setThreatDetailOpen(false)
              })
            }}
            onSelectObjectInGraph={objectKey => openGraph({ objectKey, findingIds: [currentFinding.id], evidenceOnly: true })}
            onOpenThreatSpread={(originKey: string, spreadKeys: string[]) => openGraph({ objectKey: originKey, spreadKeys, level: 'object' })}
            onSelectFinding={id => goThreatFinding(id)}
            allFindings={visibleFindings}
            collectedAt={collectedAt}
            pager={(() => {
              /* 위협 목록과 같은 순서(심각도 순). 예외로 가린 위협을 열었으면 그 위협만 */
              const order = sortBySeverity(visibleFindings).map(f => f.id)
              const at = order.indexOf(currentFinding.id)
              if (at < 0) return undefined
              const go = (id: string) => {
                toTop()
                window.history.replaceState(window.history.state, '', `#threat?finding=${id}`)
                setSelectedFindingId(id)
              }
              return {
                index: at + 1,
                total: order.length,
                onPrev: at > 0 ? () => go(order[at - 1]) : undefined,
                onNext: at < order.length - 1 ? () => go(order[at + 1]) : undefined,
              }
            })()}
            handlingSlot={
              <HandlingEditor
                fingerprint={fingerprintOf(currentFinding)}
                findingId={currentFinding.id}
                title={currentFinding.title}
                record={handlingApi.byFingerprint.get(fingerprintOf(currentFinding))}
                onSave={handlingApi.save}
              />
            }
          />
        )}

        {page === 'Adapters' && <AdaptersScreen now={now} rows={providerStats} collection={collection} />}

        {page === 'Manual' && (
          <ManualPage
            onOpen={target => {
              if (target === 'Graph') openGraph()
              else if (target === 'Threat') goThreatFinding()
              else if (target === 'ThreatExceptions') goThreatExceptions()
              else goPage(target)
            }}
          />
        )}

        {page === 'Orbs' && <OrbsDemoPage />}

        {page === 'Explorer' && (
          <ScenarioBuilderPage graph={aegiData.graph} evidence={aegiData.evidenceStore} coverage={aegiData.coverage} onSelectObject={(objectKey, path) => openGraph(path ? { path: path.steps.length ? path : undefined, spreadKeys: path.objects, links: path.links, evidenceOnly: true, fit: true, level: 'object' } : { objectKey })} />
        )}
        </Suspense>
        </PageErrorBoundary>
      </div>

      {/* 공개 데모 안내는 늦게 불러온다. 첫 화면(데모 선택)이 열릴 자리면 안내가 올 때까지 같은 남색으로 덮어 앱 화면이 먼저 보이지 않게 한다 */}
      {isPublicDemo() && <Suspense fallback={page === 'Graph' && opensOnLanding() ? <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'var(--color-chrome-bg)' }} aria-hidden="true" /> : null}><DemoTutorial page={page} graphEntry={graphEntry} findings={evaluatedFindings} logo={provider => <ProviderLogo provider={provider} />}
        onAsk={(question, objectKeys) => askAssistant(objectKeys ? { ...emptySelection(), objectKeys } : undefined, question, undefined, true)}
        onOpenGraph={() => goPage('Graph')} onOpenGraphObject={objectKey => openGraph({ objectKey })} onOpenEventBoard={() => goPage('EventBoard')} onOpenThreat={findingId => goThreatFinding(findingId)} /></Suspense>}
      {page !== 'Graph' && page !== 'EventBoard' && !assistantOpen && <AiLauncher onClick={() => askAssistant()} />}
      <div className="assistant-global-mount" hidden={!assistantOpen || page === 'EventBoard'}>
        {assistantMounted && page !== 'EventBoard' && <Suspense fallback={null}>
        <AssistantPanel graph={aegiData.graph} findings={visibleFindings} isOpen={assistantOpen} snapshotId={snapshotId} onClose={() => { setAssistantOpen(false); focusAiLauncher() }} onOpenThreat={findingId => goThreatFinding(findingId)}
          context={{ evidenceStore: aegiData.evidenceStore, effectiveAccess: aegiData.effectiveAccess?.rows, hiddenDefaults: aegiData.hiddenDefaults,
            collection: { source: EXCEPTION_BACKEND === 'remote' ? 'snapshot' : 'local', snapshotId, createdAt: aegiData.manifest.created_at, providers: aegiData.manifest.providers, coverage: aegiData.coverage },
            investigation: { dataset: activeDataset, backend: EXCEPTION_BACKEND, findings: evaluatedFindings, handling: handlingApi.items, remediation: progressApi.items, exceptions: exceptionsApi.exceptions },
            exceptionCounts: { exceptedFindings: exceptionResult.summary.exceptedFindings, review: exceptionResult.summary.review },
            workspace: { page, selection: emptySelection() }, seed: assistantSeed,
            currentFinding: exceptionResult.viewsById.get(assistantSeed?.selection.findingIds[0] ?? '')?.finding,
            currentFindingState: (() => { const view = exceptionResult.viewsById.get(assistantSeed?.selection.findingIds[0] ?? ''); return view ? ({ open: '활성', excepted: '예외 처리됨' })[view.state] : undefined })(),
            onShowEventGraph: (eventEvidence, objectKey) => openGraph({ eventEvidence, objectKey, level: 'object' }),
            onShowEvidenceGraph: (objectKey, findingIds) => openGraph({ objectKey, findingIds }),
            onNavigate: (item: AssistantNavigation) => {
              if (item.page === 'Timeline' || item.page === 'EventBoard') {
                if (item.eventKey) {
                  window.location.hash = `${PAGE_HASH.EventBoard}?event=${encodeURIComponent(item.eventKey)}`
                  setPage('EventBoard')
                  return
                }
                goPage('EventBoard')
                return
              }
              if (!hasGuide(item.page)) return
              if (item.page === 'Compliance' && item.criterion) {
                window.location.hash = `${PAGE_HASH.Compliance}?framework=isms-p&criterion=${encodeURIComponent(item.criterion)}`
                setPage('Compliance')
                return
              }

              if (item.objectKey) { if (aegiData.graph.objectsByKey.has(item.objectKey)) openGraph({ objectKey: item.objectKey }); return }
              if (item.findingId) { if (evaluatedFindings.some(f => f.id === item.findingId)) goThreatFinding(item.findingId); return }
              if (item.gapId) { openAccessGap(item.gapId); return }
              goPage(item.page)
            },
          }} />
        </Suspense>}
      </div>

      {exceptionTarget && exceptionResult.viewsById.get(exceptionTarget.findingId) && (
        <ExceptionDialog
          view={exceptionResult.viewsById.get(exceptionTarget.findingId)!}
          dataset={activeDataset}
          now={now}
          onCancel={closeExceptionDialog}
          onSubmit={submitException}
          destinations={destinationsOfFinding.get(exceptionTarget.findingId)}
          countHidden={countNewlyHidden}
          initial={exceptionTarget.like ? likeExceptionDraft(exceptionTarget.like) : undefined}
        />
      )}
      {toast && <Toast key={toast.id} toast={toast} onClose={closeToast} />}
    </div>
    </AssistantBridge.Provider>
  )
}

/** Adapters 화면 위쪽: 화면 이름, SaaS 연결 카드. 아래쪽 수집 자격증명 대장은 CredentialsPage가 그린다 */
function AdaptersHead({ rows, collection, connections, onConnectionChange, datasetName }: {
  rows: ProviderStat[]
  collection: Map<string, ProviderCollection>
  connections: Record<string, boolean>
  onConnectionChange: (provider: string, connected: boolean) => void
  datasetName: string | undefined
}) {
  const demo = isDemoMode()
  const localCollectEnabled = !demo && import.meta.env.VITE_AEGI_COLLECTOR_STATUS !== 'off'
  const connectedCount = rows.filter(row => connections[row.provider]).length

  const [liveCollectOpen, setLiveCollectOpen] = useState(false)
  const [liveCollectProvider, setLiveCollectProvider] = useState<string | null>(null)
  const [liveCollectAutoStart, setLiveCollectAutoStart] = useState(false)
  const [isCollectingGlobal, setIsCollectingGlobal] = useState(false)
  const wasCollectingRef = useRef(false)

  useEffect(() => {
    if (!localCollectEnabled) return
    let active = true
    const checkStatus = async () => {
      try {
        const res = await fetch('/__aegi/collect-status', { cache: 'no-store' })
        if (!res.ok || !active) return
        const d = await res.json()
        const running = d.state === 'running'
        setIsCollectingGlobal(running)
        if (wasCollectingRef.current && d.state === 'done') {
          wasCollectingRef.current = false
          window.setTimeout(() => window.location.reload(), 800)
          return
        }
        wasCollectingRef.current = running
      } catch {
        // ignore
      }
    }
    void checkStatus()
    const timer = window.setInterval(checkStatus, 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [localCollectEnabled])

  return (
    <>
      <div className="page-head page-title-bar page-title-bar-inset">
        <h1>Adapters</h1>
        <span className="page-head-meta">
          연동 <b>{demo ? connectedCount : rows.filter(r => r.objects > 0).length}</b>, 객체 <b>{aegiData.graph.objectsByKey.size}</b>, 관계{' '}
          <b>{aegiData.graph.relationsByKey.size}</b>, 동일인 연결 <b>{aegiData.graph.linksById.size}</b>, 증적{' '}
          <b>{evidenceSummary.total}</b>, 실측 {evidenceSummary.measured}
        </span>
      </div>

      <section className="adapters-section integrations-page" aria-label="SaaS 연결">
        <div className="adapters-header-row">
          <h2 className="adapters-section-title">SaaS 연결</h2>
          {localCollectEnabled && (
            <div className="adapters-head-actions">
              <button
                type="button"
                className={`btn-collect-all ${isCollectingGlobal ? 'is-running' : ''}`}
                onClick={() => {
                  setLiveCollectProvider(null)
                  setLiveCollectAutoStart(false)
                  setLiveCollectOpen(true)
                }}
                title="각 SaaS별 수집 현황을 확인하고 수집을 실행합니다"
              >
                {isCollectingGlobal ? (
                  <>
                    <span className="sc-stepper-spinner" aria-hidden="true" />
                    수집 진행 중 (프로세스 로그 보기)
                  </>
                ) : (
                  <>
                    <Zap size={15} strokeWidth={2.5} />
                    수집
                  </>
                )}
              </button>
            </div>
          )}
        </div>
        <div className="integration-cards">
          {rows.map(item => {
            const collected = collection.get(item.provider)
            const state = collected?.state ?? 'none'
            const card = adapterCardState({
              demo,
              datasetName,
              connected: Boolean(connections[item.provider]),
              hasPreviousCollection: Boolean(collected?.latest),
            })
            return (
            <article key={item.name} className="integration-card">
              <div className="integration-card-head">
                <span className="integration-card-logo">
                  <ProviderLogo provider={item.logo} />
                </span>
                <span className="integration-card-name" title={item.tenantKey}>
                  <b>{item.name}</b>
                  <small>
                    {item.term ? `${item.displayName}, ${tenantKindLabel(item.provider, item.term)}` : (item.displayName !== item.name ? item.displayName : '미연동')}
                  </small>
                </span>
                {card.sample
                  ? <b className="collect-badge is-sample">샘플</b>
                  : <b className={`collect-badge is-${state}`}>{ADAPTER_STATE_LABEL[state]}</b>}
              </div>
              {card.showCollection && (
                <p className="integration-card-collect">
                  <span>호출 현황:</span>
                  <b>
                    {collected?.callStats && collected.callStats.total > 0 ? (
                      <>
                        <span className="collect-stat is-full">전체 수집 {collected.callStats.full}</span>
                        {', '}
                        <span className="collect-stat is-partial">부분 수집 {collected.callStats.partial}</span>
                        {', '}
                        <span className="collect-stat is-fail">실패 {collected.callStats.failed}</span>
                      </>
                    ) : (
                      '기록 없음'
                    )}
                  </b>
                </p>
              )}
              <dl className="integration-card-stats">
                <div>
                  <dt>객체</dt>
                  <dd>{item.objects}</dd>
                </div>
                <div>
                  <dt>관계</dt>
                  <dd>{item.relations}</dd>
                </div>
                <div>
                  <dt>위협</dt>
                  <dd className={item.findings > 0 ? 'has-finding' : ''}>{item.findings}</dd>
                </div>
              </dl>
              <SaasConnect
                provider={item.provider}
                name={item.name}
                onConnectionChange={onConnectionChange}
                onStartCollect={prov => {
                  setLiveCollectProvider(prov)
                  setLiveCollectAutoStart(true)
                  setLiveCollectOpen(true)
                }}
              />
            </article>
            )
          })}
        </div>
        <DemoSettingsCards />

        {localCollectEnabled && (
          <LiveCollectionModal
            open={liveCollectOpen}
            onClose={() => setLiveCollectOpen(false)}
            targetProvider={liveCollectProvider}
            autoStart={liveCollectAutoStart}
          />
        )}
      </section>

      <h2 className="adapters-section-title">수집 자격증명</h2>
    </>
  )
}

/** Adapters 카드 배지. 카드 아래 「연결 안 됨」(이 콘솔의 실시간 수집 연결)과 헷갈리지 않게 수집 상태임을 밝힌다 */
const ADAPTER_STATE_LABEL: Record<keyof typeof COLLECTION_STATE_LABEL, string> = { ...COLLECTION_STATE_LABEL, ok: `수집 ${COLLECTION_STATE_LABEL.ok}` }

/** 팀 로그인 세션을 끝낸다. */
function LogoutButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return <div className="sidebar-dataset">
    <button type="button" className="sidebar-logout" aria-label="로그아웃" title="로그아웃" disabled={busy} onClick={() => {
      setBusy(true)
      setError(null)
      void logoutMeasured().catch(() => { setBusy(false); setError("로그아웃 실패") })
    }}><LogOut size={18} aria-hidden="true" /><span className="sidebar-logout-label">{busy ? "로그아웃 중…" : "로그아웃"}</span></button>
    {error && <span role="alert">{error}</span>}
  </div>
}

/** 로컬 실측 데이터셋(최신 실측 / ver IM) 전환 토글. */
function DatasetToggle() {
  if (!measuredImAvailable) return null
  const options: Array<{ kind: DatasetKind; label: string; title: string }> = [
    { kind: 'measured-v2', label: '최신 v3-refresh', title: '2026-10-23 최신 실측 베이스라인 v3-refresh-20261023, 객체 694개' },
    { kind: 'measured-im', label: 'ver IM', title: '1,977개 IM Object Profile 카탈로그 기반 투영 데이터셋, 객체 704개, 관계 655개' },
  ]
  return (
    <div className={`sidebar-dataset is-${activeDataset}`} role="group" aria-label="데이터셋 버전">
      <span className="sidebar-dataset-label nav-label">데이터셋 버전</span>
      <div className="sidebar-dataset-switch nav-label">
        {options.map(o => (
          <button
            key={o.kind}
            type="button"
            className={activeDataset === o.kind ? 'active' : ''}
            aria-pressed={activeDataset === o.kind}
            title={o.title}
            onClick={() => switchDataset(o.kind)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
