import type { Provider } from './model/object'
import type { ProviderCollection } from './model/collectionFreshness'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from 'react'
import ProviderLogo from './ProviderLogo'
import type { ProviderId } from './providerOverviewData'
import type { GraphStore, GraphStoreV2 } from './model/graph'
import type { FindingV2 } from './model/findingV2'
import {
  type SemanticLevel,
  type SemanticEdge,
  type SemanticNode,
  type ProjectedGraphData,
  SEMANTIC_LEVEL_ORDER,
  type ExtraLinkEdge,
} from './semantic-graph/types'
import { projectSemanticGraph } from './semantic-graph/projectGraph'
import { layoutGraphNodes } from './semantic-graph/layoutHybrid'
import { findInvestigationPath, neighbors, type InvestigationPath } from './semantic-graph/investigationQuery'
import {
  RELATION_LENS_HINTS, RELATION_LENS_LABELS, RELATION_VIEW_GROUPS, allRelationViewsSelected, isFlowRelation,
  normalizeRelationLenses, relationLensSummary, relationMatchesAnyLens, relationViewGroup,
  type RelationLensGroup, type RelationViewGroup,
} from './semantic-graph/relationLens'
import { EDGE_COLORS } from './semantic-graph/edgeColors'
import { explainEdge, relationLabel } from './semantic-graph/edgeExplain'
import type { EffectiveAccessFile, EffectiveAccessRow } from './detection/v2/effectiveAccess/types'
import GraphQueryPanel from './semantic-graph/GraphQueryPanel'
import {
  calculateInvestigationScope,
  restrictToInvestigationScope,
} from './semantic-graph/investigationScope'
import './semantic-graph/graphWorkspace.css'
import './semantic-graph/graphPanel.css'
import { readGraphSession, writeGraphSession, type GraphSession } from './semantic-graph/graphSession'
import AssistantPanel, { type AssistantContext } from './assistant/AssistantPanel'
import AiLauncher, { focusAiLauncher } from './assistant/AiLauncher'
import { useAssistantBridge } from './assistant/AssistantBridge'
import { emptySelection, SELECTION_LIMIT, type AssistantSelection } from './assistant/workspace'
import { eventsForObjects, matchEventsToObjects } from './assistant/eventGraph'
import GraphEventBadge from './semantic-graph/GraphEventBadge'
import type { AssistantEventGraph, IdentityEvidenceEdge } from './assistant/types'
import { createHoverStore, useHovered, type HoverStore } from './semantic-graph/hoverStore'
import { computeFitToView, SEMANTIC_NODE_BOX, ZOOM_STEPS, type ViewportSize } from './semantic-graph/viewport'
import { CLUSTER_HEADER } from './semantic-graph/layoutAnchors'
import { BASE_PROVIDERS, providerLogoId, providerName, sortProviders } from './findings/providers'
import { ecosystemEdgeGeometry, ecosystemEdgeKind } from './semantic-graph/EcosystemParts'
import GraphSummaryCard, { GraphProviderHub } from './semantic-graph/GraphSummaryCard'
import { circleRadius, HUB_RADIUS, isCircleLevel, layoutCircleLevel, providerLinks, type CircleLayout } from './semantic-graph/circleLevels'
import HoverTooltip from './semantic-graph/HoverTooltip'
import { NodeHoverTooltip, EaHoverTooltip } from './semantic-graph/HoverDescriptions'
import { accessCurve } from './semantic-graph/hoverDetails'
import { objectGlyph } from './semantic-graph/nodeGlyphs'
import { leafSlotWidth, objectCircleFrames, OBJECT_CIRCLE_R, OBJECT_CIRCLE_LABEL, OBJECT_CIRCLE_LABEL_GAP, RING_LEGEND_H, RING_TITLE, SAAS_LEGEND_H, type CircleFrame } from './semantic-graph/objectCircles'
import { GRAPH_FONT_FAMILY, measureLabel, fitLabel, fitLabelMiddle } from './semantic-graph/labelFit'
import {
  objectShortNames, objectDisplayName,
  findingBadgeWidth, OBJECT_LABEL_SIZE,
} from './semantic-graph/objectChip'
import { easeInOutCubic, relatedCentroid } from './semantic-graph/cameraMath'
import { separateDots } from './semantic-graph/dotLayout'
import { placeReadableLabels, type LabelRect } from './semantic-graph/readableLabels'
import {
  buildContainment, membershipNested, visibleContainment,
} from './semantic-graph/containment'
import SemanticInspector from './semantic-graph/SemanticInspector'
import FindingSummary from './semantic-graph/FindingSummary'
import SemanticZoomSlider from './semantic-graph/SemanticZoomSlider'
import './semantic-graph/semanticZoomSlider.css'
import FindingNavigator from './findings/FindingNavigator'
import GraphSideDock, { readSideLayout, readSideWidth, saveSideLayout, SIDE_RAIL_WIDTH, type SideTab } from './semantic-graph/GraphSideDock'
import { ChevronDown, ArrowLeft, ArrowRight, ChevronRight, ListFilter, Maximize2, Minus, Plus, Search } from 'lucide-react'
import { setShowPlatformDefaults, showPlatformDefaults } from './model/platformDefaults'
import { hasLocalServer } from './demoMode'

export interface UnifiedFullGraphProps {
  eventEvidence?: AssistantEventGraph
  onOpenEvent?: (key: string, objects?: string[], at?: string | null) => void
  onAskEvent?: (key: string) => void
  onClearEvents?: () => void
  onOpenAdapters?: () => void
  evidenceMode?: boolean
  identityEdges?: IdentityEvidenceEdge[]
  inspectorFindings?: FindingV2[]
  assistantContext?: AssistantContext
  initialAssistantOpen?: boolean
  currentGraph: GraphStore | GraphStoreV2
  findings?: FindingV2[]
  /** 예외 처리로 가린 위협 수. Findings 패널 바닥에 안내한다 */
  exceptedFindingCount?: number
  /** 기본 보기에서 뺀, 미사용 플랫폼 기본 객체 수 (판단표 G4-Q05) */
  platformDefaultsHidden?: number
  initialSelectedFindingIds?: string[]
  initialFocusObjectKey?: string
  initialProviderFilter?: 'all' | Provider
  /** 주소(#graph?level=)로 연 표시 수준. 조사 대상이 있으면 개별 객체 단계가 앞선다 */
  initialLevel?: SemanticLevel
  /** 다른 화면(Access Gaps, Credentials)에서 넘긴 사슬. 선택 경로로 강조한 채 연다 */
  initialPath?: InvestigationPath
  /** 위협 상세에서 들어왔다. 위협의 객체만 보이는 범위로 열고, 배율이 60%보다 작으면 고른 객체를 가운데 두고 60%로 연다 */
  initialEvidenceOnly?: boolean
  /** 근거만 보기로 열어도 배율 하한 없이 화면에 맞춘다 (Explorer 의 한 연결처럼 객체가 적을 때) */
  initialFit?: boolean
  /** 이 화면을 열 때 함께 그릴 객체 사이 선(Explorer 의 연결처럼 수집된 관계에 없는 간선). 다시 열기 전까지 유지한다 */
  initialExtraLinks?: ExtraLinkEdge[]
  initialQueryObjectKeys?: string[]
  onOpenThreat?: (findingId: string) => void
  /** SaaS별 마지막 수집과 상태. SaaS 요약 상세에 보인다 */
  collection?: Map<string, ProviderCollection>
  /** 계산된 Effective Access 결과 (effective_access.json). 있으면 「Effective Access」 선을 겹쳐 그릴 수 있다 */
  effectiveAccess?: EffectiveAccessFile
  /** 상세 패널(개별 항목)의 「Explorer 에서 탐색」. 객체 키를 넘긴다 */
  onOpenExplorer?: (fixtureKey: string) => void
  /** 상세 패널(개별 항목)의 「관련 이벤트 n건」. 객체 키를 넘긴다 */
  onOpenEvents?: (fixtureKey: string) => void
  /** 자격증명 상세 패널의 「피해범위 상세」 */
  onOpenBlastRadius?: (credentialKey: string) => void
}

type Point = { x: number; y: number }

/* 화면 맞춤 여백.
   캔버스 위에 실제로 "떠 있는" 요소만 잡는다. Findings 패널은 도킹돼
   있으므로 캔버스 크기에서 이미 빠져 여기서 또 빼면 안 된다. */
const FIT_INSET_EDGE = 20
/* 도구 막대가 한 줄일 때 아래 끝(캔버스 위에서 12px + 막대 48px), 화면 맞춤이 그 아래로 더 비우는 높이 */
const TOOLBAR_BOTTOM_ONE_LINE = 60
const FIT_BELOW_TOOLBAR = 62
const FIT_INSET_BOTTOM = 20
/** initialFit 으로 열 때 크기가 바뀐 뒤 다시 맞추기까지 기다리는 시간과, 다시 맞추는 기간 (ms) */
const ENTRY_FIT_DELAY = 300
const ENTRY_FIT_WINDOW = 2000
/* 떠 있는 상세 패널의 자리 (styles.css .sz-inspector-float: 오른쪽 14px, 폭 380px). */
const INSPECTOR_FLOAT_WIDTH = 380
const INSPECTOR_FLOAT_RIGHT = 14
/* 도구 막대 오른쪽 끝과 이만큼 떨어지지 않으면 패널을 도구 막대 아래로 내린다 */
const INSPECTOR_TOOLBAR_GAP = 8
/* 화면 맞춤이 패널 자리로 비우는 폭 = 패널 + 오른쪽 여백 + 패널과 그래프 사이 20px.
   전에는 360 이었다 — 패널이 330px 이던 때의 값이 폭을 380px 로 넓힌 뒤에도 남아(09-22),
   패널을 연 채 맞추면 오른쪽 34px 가 패널 밑으로 들어갔다 */
const FIT_INSET_INSPECTOR = INSPECTOR_FLOAT_WIDTH + INSPECTOR_FLOAT_RIGHT + FIT_INSET_EDGE
/* 범례는 도구 막대 오른쪽 같은 줄에 둔다(graphWorkspace.css .gx-visual-legend). 캔버스 오른쪽 여백,
   도구 막대와 상세 패널에서 띄우는 간격이다 */
const LEGEND_EDGE = 16
const LEGEND_GAP = 12
/* 범례가 「현재 위치」 줄로 내려와도 그 줄에 이만큼은 남긴다. 모자라면 범례를 한 줄 더 아래로 내린다 */
const VIEW_LOCATION_MIN = 200
const TRANSITION_MS = 280
const CAMERA_MIN_ZOOM = 0.001
const CAMERA_MAX_ZOOM = 32
/** z 이하에서 가장 큰 단계. 화면 맞춤이 내용을 다 담도록 아래로 맞춘다 */
function snapZoomDown(z: number): number {
  let best = ZOOM_STEPS[0]
  for (const step of ZOOM_STEPS) if (step <= z * 1.0001) best = step
  return best
}
/** 확대, 축소 단추와 휠은 1% 단위로 맞춘다. 반올림으로 그대로면 1%를 더 움직인다 */
function zoomBy(z: number, factor: number): number {
  let next = Math.round(z * factor * 100) / 100
  if (next === Math.round(z * 100) / 100) next += factor > 1 ? 0.01 : -0.01
  return Math.min(Math.max(next, 0.01), CAMERA_MAX_ZOOM)
}

/* L4 칸의 이름 크기(월드 좌표)는 OBJECT_LABEL_SIZE(23)가 확대하기 전 기본값이자
   위쪽 한계다. 이보다 커지지 않는다(objectChip.ts). */

/* 칸 안 이름은 sm 토큰의 화면 크기를 유지한다. 월드 폭에 그 크기를 담을 수
   없는 축소 범위에서는 점과 화면 좌표 이름표로 바꾼다. */
const OBJECT_LABEL_TARGET_SCREEN_PX = typeof document === 'undefined' ? 13 :
  Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size-sm')) || 13
const OBJECT_LABEL_MIN_SIZE = 9
const BADGE_SCREEN_PX = typeof document === 'undefined' ? 11 :
  Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size-xs')) || 11

/* 포함 테두리 제목은 md 토큰. */
const NEST_TITLE_TARGET_SCREEN_PX = typeof document === 'undefined' ? 15 :
  Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size-md')) || 15
/* 테두리 선. 바깥(테넌트)일수록 굵고 짙게. */
const NEST_STROKE = { outer: '#94a6bb', inner: '#b3c0cf' }

/* 다른 SaaS 이정표가 붙는 화면 가장자리 안쪽 여백(px). 위는 도구 막대와
   '현재 위치' 줄 아래, 아래는 범례·조사 범위 안내 위. */
const BEACON_INSET = { top: 112, bottom: 80, side: 86 }


/* SaaS 머리글(29 월드)과 개수(22 월드)가 각각 sm, xs 화면 크기를 유지해야 한다. */
const CLUSTER_LABEL_ZOOM = Math.max(OBJECT_LABEL_TARGET_SCREEN_PX / 29, BADGE_SCREEN_PX / 22)

/* 이 배율 아래의 개별 항목은 칸 대신 점으로 그리고, 몇 칸에만 이름표를 단다. */
// Below this scale a 23px world label cannot reach the 13px reading size.
const DOT_ZOOM = OBJECT_LABEL_TARGET_SCREEN_PX / OBJECT_LABEL_SIZE

/* 점 모드 동그라미의 반지름(월드). 안에 종류 그림을 넣으므로 화면에서 7px 남짓이
   되게 키운다(맨 처음에는 배율 0.2에서 4px). 세로로 이웃한 칸의 중심 간격(칸 44 + 틈 18 =
   62)을 조금 넘어도 되게 40에서 멈춘다. 이웃 동그라미가 살짝 닿을 수는 있다. */
const dotRadius = (zoom: number) => Math.min(40, Math.max(32, 7.2 / Math.max(zoom, 0.001)))

/* 동그라미 안 그림은 화면에서 이 반지름(px)보다 작으면 알아볼 수 없어 그리지 않는다. */
const DOT_GLYPH_MIN_SCREEN_RADIUS = 4.5

/* 점 모드에서 동그라미끼리 떼어 놓을 크기를 재는 배율. 전체 객체를 화면에 맞추면 이 언저리다.
   이보다 더 줄이면 동그라미가 다시 조금 닿을 수 있다. */
const DOT_REFERENCE_ZOOM = 0.2

/* 커서 이름표(화면 px). 점 모드와, 칸 이름이 잘린 칸에 뜬다.
   폭은 실제 글자에 맞추고, 이보다 길 때만 자른다. */
const DOT_LABEL_HEIGHT = 26
const DOT_LABEL_MAX_WIDTH = 300
const DOT_LABEL_PAD_X = 8

/* 멀리서 본(점 모드) 칸 이름표 · '현재 위치' 줄 · Effective Access 선에 쓰는 모양 */
type ViewLocation = { provider?: string; providers: string[]; trail: Array<{ id: string; label: string; kind?: string }> }
type EaEdge = { id: string; sourceNodeId: string; targetNodeId: string; rows: EffectiveAccessRow[]; settled: boolean }
type EaOverlay = { edges: EaEdge[]; drawnRows: number; sameNode: number; hidden: number }
/* 선의 두 끝 (UnifiedFullGraph 의 edgeEnds) */
type EdgeEnds = (src: SemanticNode, tgt: SemanticNode) => [Point, Point]
type EaGeometry = (src: SemanticNode, tgt: SemanticNode) => ReturnType<typeof accessCurve>

/* 관계선 하나의, 커서와 상관없는 상태. 선 그리기 · 관계선 메뉴의 수 · 범례의 수 · 선 설명이 같은 값을 쓴다 */
type EdgeFlags = {
  isSelected: boolean
  isResolution: boolean
  isPolicyAssignment: boolean
  hasSelectedFinding: boolean
  hasAnyFinding: boolean
  /** 고른 Finding 이 있는데 이 선은 그 증거가 아니다 */
  isDimmed: boolean
  onPath: boolean
  onQuery: boolean
  /** 관계선 메뉴에서 고른 묶음에 든다 (아니면 흐리게) */
  matchesLens: boolean
  /** 동일인 연결을 껐다 */
  isLinkHidden: boolean
  /** 포함 테두리가 이미 말해 선을 그리지 않는다 */
  framed: boolean
}

/* 테두리로 대신해 그리지 않는 선. 고른 선 · 탐지 증거 · 경로 · 검색 결과면 그린다 */
function edgeNotDrawn(flags: EdgeFlags): boolean {
  return flags.framed && !flags.isSelected && !flags.hasAnyFinding && !flags.onPath && !flags.onQuery
}

/* 관계선 메뉴의 칸: 전체, 보기 묶음 셋, 조사 프리셋, Effective Access, 동일인 연결 */
type LensMenuKey = 'all' | RelationLensGroup | 'ea' | 'identity'

/* 관계선 메뉴의 묶음 한 칸에 적는 수. 지금 화면(표시 수준 · 조사 범위)에 있는 관계만 센다 */
type LensCount = { total: number; framed: number; types: Map<string, number> }

/* 화살표 머리(끝 b 에 뾰족한 끝). 뒤가 안으로 파인 날렵한 모양이다. neck 은 선을 끊을 자리로,
   파인 곳 안쪽이라 선 끝이 머리 밖으로 보이지 않는다 */
function arrowHead(a: Point, b: Point, size: number): { points: string; neck: Point } {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const ux = (b.x - a.x) / length
  const uy = (b.y - a.y) / length
  const base = { x: b.x - ux * size, y: b.y - uy * size }
  const half = size * 0.4
  const notch = { x: b.x - ux * size * 0.68, y: b.y - uy * size * 0.68 }
  const left = `${base.x - uy * half},${base.y + ux * half}`
  const right = `${base.x + uy * half},${base.y - ux * half}`
  return { points: `${b.x},${b.y} ${left} ${notch.x},${notch.y} ${right}`, neck: { x: b.x - ux * size * 0.6, y: b.y - uy * size * 0.6 } }
}

/* 관계선 메뉴의 종류 풀이: 「멤버십 44, 소유 5」 */
function lensBreakdown(count: LensCount): string {
  return [...count.types.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, n]) => `${relationLabel(type)} ${n}`)
    .join(', ')
}

const EA_LEGEND_HINT = '같은 그룹 안의 Effective Access 결과는 고리로 표시. 실제 두 항목 사이의 연결은 더 자세한 보기 단위에서 확인'

/* Effective Access 범례 글. 결론 수와 선 수가 다르면 왜 다른지 적는다 —
   여러 결론을 한 선으로 묶음 · 두 끝이 한 칸 안 · 끝 칸이 지금 안 보임(SaaS 필터 등). */
function eaLegendText(overlay: EaOverlay): string {
  const notes: string[] = []
  if (overlay.drawnRows > overlay.edges.length) notes.push(`${overlay.drawnRows}건을 선 ${overlay.edges.length}개로`)
  if (overlay.sameNode) notes.push(`같은 항목 안 ${overlay.sameNode}건`)
  if (overlay.hidden) notes.push(`화면 밖 ${overlay.hidden}건`)
  return notes.length ? `Effective Access (${notes.join(', ')})` : 'Effective Access'
}

export default function UnifiedFullGraph({
  currentGraph,
  eventEvidence, onOpenEvent, onAskEvent, onClearEvents,
  findings = [],
  exceptedFindingCount = 0,
  platformDefaultsHidden = 0,
  initialSelectedFindingIds,
  initialFocusObjectKey,
  initialProviderFilter,
  initialLevel,
  initialPath,
  initialEvidenceOnly = false,
  initialFit = false,
  initialExtraLinks,
  initialQueryObjectKeys,
  onOpenThreat,
  onOpenAdapters,
  collection,
  onOpenExplorer,
  onOpenEvents,
  effectiveAccess,
  onOpenBlastRadius,
  evidenceMode = false,
  identityEdges,
  inspectorFindings,
  assistantContext,
  initialAssistantOpen = false,
}: UnifiedFullGraphProps) {
  const eventMatches = useMemo(() => eventEvidence ? matchEventsToObjects(eventEvidence, currentGraph.objectsByKey) : null, [eventEvidence, currentGraph])
  const restored = useMemo<Partial<GraphSession>>(() => evidenceMode ? {} : readGraphSession(), [evidenceMode])
  const [assistantOpen, setAssistantOpen] = useState(initialAssistantOpen)
  const assistantBridge = useAssistantBridge()
  const [selectionNotice, setSelectionNotice] = useState('')
  const hasExplicitTarget = Boolean(
    initialFocusObjectKey ||
    (initialSelectedFindingIds && initialSelectedFindingIds.length > 0) ||
    (initialQueryObjectKeys && initialQueryObjectKeys.length > 0)
  )
  const hasExplicitProvider = Boolean(initialProviderFilter && initialProviderFilter !== 'all')
  const hasEntryContext = hasExplicitTarget || hasExplicitProvider
  // Semantic Zoom Level: 명시적 조사 대상이 있으면 object, 없으면 저장된 세션, 세션도 없으면 L1 ecosystem(기본 환경 요약)
  const [semanticLevel, setSemanticLevel] = useState<SemanticLevel>(
    // 답변 근거 그래프는 단계 바꾸는 도구 막대가 없으므로 근거 객체가 바로 보이는 개별 객체 단계로 연다
    hasExplicitTarget || evidenceMode ? 'object' : (initialLevel ?? restored.level ?? 'ecosystem')
  )

  // Selected Finding Overlays
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>(initialSelectedFindingIds !== undefined
    ? initialSelectedFindingIds.filter(id => findings.some(finding => finding.id === id))
    : (restored.findingIds ?? []).filter(id => findings.some(finding => finding.id === id)))
  const [showFindingEvidence, setShowFindingEvidence] = useState(true)
  // 탐지 결과 줄을 눌러 상세 탭에 요약을 띄운 위협. 칸, 선, Effective Access 결과를 고르면 그쪽 상세로 바뀐다
  const [focusedFindingId, setFocusedFindingId] = useState<string | null>(null)
  const focusedFinding = focusedFindingId ? findings.find(f => f.id === focusedFindingId) ?? null : null

  // Filters
  // 데이터에 있는 SaaS 전부. 새 SaaS(Atlassian 등)가 들어오면 고르기 메뉴와 묶음에 바로 나온다
  const GRAPH_PROVIDERS = useMemo(() => sortProviders([...currentGraph.objectsByProvider.entries()].filter(([,objects])=>objects.some(o=>o.canonical.properties.presentation_role!=='intermediary')).map(([provider])=>provider)), [currentGraph])
  type GraphProvider = Provider
  const [selectedProviders, setSelectedProviders] = useState<ReadonlySet<GraphProvider>>(() => {
    if (initialFocusObjectKey) return new Set(GRAPH_PROVIDERS)
    if (initialProviderFilter && initialProviderFilter !== 'all') return new Set([initialProviderFilter])
    if (Array.isArray(restored.providers)) {
      const valid = restored.providers.filter((p): p is GraphProvider => GRAPH_PROVIDERS.includes(p))
      // 예전 기본 네 SaaS를 모두 고른 저장 상태는 「전체」였으므로 새로 들어온 SaaS도 넣는다.
      // 지금 데이터에 맞는 SaaS가 하나도 없으면(빈 데이터일 때 저장한 선택 뒤 샘플·첫 수집) 「전체」로 연다
      return new Set(valid.length === 0 || BASE_PROVIDERS.every(p => valid.includes(p) || !GRAPH_PROVIDERS.includes(p)) ? GRAPH_PROVIDERS : valid)
    }
    if (restored.provider && restored.provider !== 'all') return new Set([restored.provider])
    return new Set(GRAPH_PROVIDERS)
  })
  const toggleProvider = (provider: GraphProvider) => setSelectedProviders(current => {
    const next = new Set(current)
    if (next.has(provider)) next.delete(provider)
    else next.add(provider)
    return next
  })
  const providerFilter: 'all' | GraphProvider = selectedProviders.size === 1 ? [...selectedProviders][0] : 'all'
  const [saasFilterMenuOpen, setSaasFilterMenuOpen] = useState(false)
  const [saasSearchQuery, setSaasSearchQuery] = useState('')
  const saasFilterMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!saasFilterMenuOpen) setSaasSearchQuery('') }, [saasFilterMenuOpen])

  // 관계선은 스키마의 세 보기 묶음을 체크박스로 함께 고르거나, 조사 프리셋 「실행, 전달만」 하나를 고른다.
  // 옛 세션(한 개만 고르던 lens, flow 를 나란히 체크하던 lenses)도 읽는다
  const [relationLenses, setRelationLenses] = useState<ReadonlySet<RelationLensGroup>>(() => {
    const saved: unknown[] = Array.isArray(restored.lenses)
      ? restored.lenses
      : restored.lens && restored.lens !== 'all' ? [restored.lens] : RELATION_VIEW_GROUPS
    // 세션 값은 다른 판이 저장했거나 깨졌을 수 있다. 아는 묶음만 남긴다 (모르는 값이 섞이면 「전체」 체크가 틀린다)
    return normalizeRelationLenses(saved)
  })
  // 보기 묶음을 고르면 프리셋은 풀린다
  const toggleRelationLens = (lens: RelationViewGroup) => setRelationLenses(current => {
    const next = new Set<RelationLensGroup>([...current].filter(item => item !== 'flow'))
    if (next.has(lens)) next.delete(lens)
    else next.add(lens)
    return next
  })
  const eaRows = useMemo(() => (effectiveAccess?.rows ?? []).filter(row => row.level !== 'denied'), [effectiveAccess])
  const [showEffectiveAccess, setShowEffectiveAccess] = useState<boolean>(restored.showEffectiveAccess ?? false)
  // Explorer 의 한 연결(initialExtraLinks)로 열면 그 연결의 객체만 보이게 동일인 계정을 끌어오지 않는다. 도구 막대에서 다시 켤 수 있다
  const [includeIdentityLinks, setIncludeIdentityLinks] = useState(initialExtraLinks?.length ? false : restored.includeLinks ?? true)
  // 위협에서 들어오면 기준 객체의 이웃을 더하지 않는다(위협의 객체만). 고른 객체는 아래 선택으로 남는다
  const [focusObjectKey, setFocusObjectKey] = useState(initialEvidenceOnly ? '' : initialFocusObjectKey && currentGraph.objectsByKey.has(initialFocusObjectKey) ? initialFocusObjectKey : restored.focus && currentGraph.objectsByKey.has(restored.focus) ? restored.focus : '')
  const [targetObjectKey, setTargetObjectKey] = useState(hasEntryContext ? '' : restored.target && currentGraph.objectsByKey.has(restored.target) ? restored.target : '')
  const [expandedObjectKeys, setExpandedObjectKeys] = useState<string[]>(hasEntryContext ? [] : (restored.expanded ?? []).filter(key => currentGraph.objectsByKey.has(key)))
  const [queryObjectKeys, setQueryObjectKeys] = useState<string[]>(() => {
    if (initialQueryObjectKeys && initialQueryObjectKeys.length > 0) {
      return initialQueryObjectKeys.filter(key => currentGraph.objectsByKey.has(key))
    }
    return hasEntryContext ? [] : (restored.queryObjects ?? []).filter(key => currentGraph.objectsByKey.has(key))
  })
  const [queryRelationKeys, setQueryRelationKeys] = useState<string[]>(hasEntryContext ? [] : (restored.queryRelations ?? []).filter(key => currentGraph.relationsByKey.has(key)))
  const [queryLinkIds, setQueryLinkIds] = useState<string[]>(hasEntryContext ? [] : (restored.queryLinks ?? []).filter(key => currentGraph.linksById?.has(key)))
  const [queryPath, setQueryPath] = useState<ReturnType<typeof findInvestigationPath>>(hasEntryContext ? (initialPath?.steps.length ? initialPath : null) : (restored.queryPath ?? null))
  // 경로 찾기 옵션. 바꾸는 단추가 없어 세션에 남은 값(없으면 기본값)을 그대로 쓴다
  const [pathMaxHops] = useState(restored.pathHops ?? 6)
  const [pathDirected] = useState(restored.pathDirected ?? false)
  const [showAllObjects, setShowAllObjects] = useState<boolean>(() => {
    if (evidenceMode) return true
    if (hasEntryContext) return false
    if (typeof restored.showAll === 'boolean') return restored.showAll
    if (restored.focus || restored.target || (restored.expanded && restored.expanded.length > 0)) return false
    return true
  })
  const [queryExecuted, setQueryExecuted] = useState(
    hasEntryContext ? Boolean(initialQueryObjectKeys && initialQueryObjectKeys.length > 0) : restored.queryExecuted ?? false
  )
  const [investigationOpen, setInvestigationOpen] = useState(false)
  const [sampleLoading, setSampleLoading] = useState(false)
  const [sampleError, setSampleError] = useState('')
  const revealNodeRef = useRef<string | null>(null)
  const [relationMenuOpen, setRelationMenuOpen] = useState(false)
  const relationMenuRef = useRef<HTMLDivElement>(null)
  // 관계선 메뉴에서 커서를 올린(또는 키보드로 옮겨 간) 칸과 그 칸의 위쪽 자리(px). 설명 칸을 그 높이에 띄운다
  const [lensHover, setLensHover] = useState<{ key: LensMenuKey; top: number } | null>(null)
  useEffect(() => { if (!relationMenuOpen) setLensHover(null) }, [relationMenuOpen])
  const lensHoverProps = (key: LensMenuKey) => {
    const show = (element: HTMLElement) => setLensHover({ key, top: element.offsetTop })
    return {
      onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => show(event.currentTarget),
      onFocus: (event: FocusEvent<HTMLElement>) => show(event.currentTarget),
      'aria-describedby': lensHover?.key === key ? 'gx-lens-detail' : undefined,
    }
  }

  /* 도구 막대 메뉴(SaaS 필터, 관계선)는 바깥을 누르거나 Esc 를 누르면 닫는다. SaaS 필터와 관계선은 여러 개를 고르는
     체크 목록이라 고를 때는 닫지 않는다. 그래프 빈 곳을 누르면 캔버스가 끌기를 시작하므로 캡처 단계에서 본다. */
  useEffect(() => {
    if (!saasFilterMenuOpen && !relationMenuOpen) return
    const insideMenu = (target: EventTarget | null) =>
      target instanceof Node && [saasFilterMenuRef.current, relationMenuRef.current].some(menu => menu?.contains(target))
    const close = () => {
      setSaasFilterMenuOpen(false)
      setRelationMenuOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!insideMenu(event.target)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // 다른 곳(대화 상자 등)이 이미 처리한 Esc 는 건드리지 않는다
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const activeRef = saasFilterMenuOpen ? saasFilterMenuRef.current : relationMenuRef.current
      const trigger = activeRef?.querySelector<HTMLButtonElement>(':scope > button')
      close()
      trigger?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [saasFilterMenuOpen, relationMenuOpen])
  /* 오른쪽 패널 한 칸(GraphSideDock). 탐지 결과와 상세가 탭을 나눠 쓴다. 닫으면 얇은 띠로 접힌다 */
  const [savedSide] = useState(() => (evidenceMode ? {} : readSideLayout()))
  const [sideOpen, setSideOpen] = useState(() => !evidenceMode && !initialAssistantOpen && (savedSide.open ?? (typeof window === 'undefined' || window.innerWidth > 960)))
  const [sideTab, setSideTab] = useState<SideTab>(savedSide.tab ?? 'findings')
  useEffect(() => { if (!evidenceMode) saveSideLayout(sideOpen, sideTab) }, [evidenceMode, sideOpen, sideTab])
  /* Esc 한 번에 떠 있는 칸 하나만 닫는다: 검색, 경로 칸이 열려 있으면 그것, 아니면 오른쪽 패널.
     메뉴가 열려 있으면 위의 메뉴 닫기가 맡고, AI 창이나 대화 상자가 먼저 처리한 Esc는 건드리지 않는다 */
  useEffect(() => {
    if (evidenceMode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      if (saasFilterMenuOpen || relationMenuOpen) return
      if (event.target instanceof Element && event.target.closest('#aegi-ai-panel, [role="dialog"]')) return
      if (investigationOpen) {
        event.preventDefault()
        setInvestigationOpen(false)
      } else if (sideOpen) {
        event.preventDefault()
        setSideOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [evidenceMode, saasFilterMenuOpen, relationMenuOpen, investigationOpen, sideOpen])
  const [sideWidth, setSideWidth] = useState(readSideWidth)
  const showDetail = () => { setSideTab('detail'); setSideOpen(true) }

  // Selection state
  interface InvestigationHistoryItem {
    level: SemanticLevel
    focusKey: string
    targetKey: string
    selectedNodeId: string | null
    selectedObjectKey: string | null
    selectedEdgeId: string | null
    expandedKeys: string[]
    queryObjectKeys: string[]
    queryRelationKeys: string[]
    queryLinkIds: string[]
    queryExecuted: boolean
    queryPath: ReturnType<typeof findInvestigationPath>
    selectedFindingIds: string[]
    relationLenses: ReadonlySet<RelationLensGroup>
    showEffectiveAccess: boolean
    includeIdentityLinks: boolean
    selectedProviders: ReadonlySet<GraphProvider>
    pathMaxHops: number
    pathDirected: boolean
    showAllObjects: boolean
    camera: { zoom: number; pan: Point }
  }
  const [investigationHistory, setInvestigationHistory] = useState<InvestigationHistoryItem[]>([])
  /* 「이전」으로 되돌린 조사 위치. 「다음」이 다시 연다. 새로 조사하면 비운다 */
  const [forwardHistory, setForwardHistory] = useState<InvestigationHistoryItem[]>([])
  const [selectedSemanticNodeId, setSelectedSemanticNodeId] = useState<string | null>(initialFocusObjectKey && currentGraph.objectsByKey.has(initialFocusObjectKey) ? initialFocusObjectKey : hasEntryContext ? null : restored.selectedNode ?? null)
  const [selectedObjectKey, setSelectedObjectKey] = useState<string | null>(hasEntryContext ? (initialFocusObjectKey ?? null) : (restored.selectedObject ?? null))
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(hasEntryContext ? null : restored.selectedEdge ?? null)
  // 고른 Effective Access 결론 (EA 선을 누르거나 상세 패널의 보안 요약에서 고름). 표시 수준과 상관없는 행 id 들이다
  const [selectedEaRowIds, setSelectedEaRowIds] = useState<string[] | null>(null)
  // 커서를 올린 칸 · Effective Access 선. 상태가 아니라 작은 저장소에 둔다 — 바뀔 때 그래프 전체를 다시 그리지 않게 (hoverStore.ts).
  // 커서를 받는 곳('현재 위치' 줄 · 커서 이름표 · EA 선 · 관계선 강조)만 다시 그린다
  const [hoverStore] = useState(createHoverStore)
  const [eaHoverStore] = useState(createHoverStore)
  // 커서를 올린 관계선. 그 선을 진하게 하고 화살표와 한 줄 설명(EdgeTooltip)을 띄운다
  const [edgeHoverStore] = useState(createHoverStore)
  useEffect(() => {
    const stores = [hoverStore, edgeHoverStore, eaHoverStore]
    const unsubscribe = stores.map(store => store.subscribe(() => {
      if (store.get()) stores.filter(other => other !== store).forEach(other => other.set(null))
    }))
    return () => unsubscribe.forEach(stop => stop())
  }, [hoverStore, edgeHoverStore, eaHoverStore])
  // 표시 수준을 바꾸면 커서 아래 칸이 사라져 mouseleave 가 오지 않는다. 남은 커서 자리를 지운다
  useEffect(() => {
    hoverStore.set(null)
    eaHoverStore.set(null)
    edgeHoverStore.set(null)
  }, [semanticLevel, selectedProviders, showEffectiveAccess, hoverStore, eaHoverStore, edgeHoverStore])

  // Camera state
  const [zoom, setZoom] = useState<number>(hasEntryContext ? 1 : restored.camera?.zoom ?? 1)
  const [pan, setPan] = useState<Point>(hasEntryContext ? { x: 0, y: 0 } : restored.camera?.pan ?? { x: 0, y: 0 })
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 })

  // Transition state
  const [transitionFrom, setTransitionFrom] = useState<ProjectedGraphData | null>(null)
  const [transitionProgress, setTransitionProgress] = useState<number>(1)
  const semanticTransitionRaf = useRef<number | null>(null)
  const cameraAnimationRaf = useRef<number | null>(null)
  const zoomRef = useRef<number>(hasEntryContext ? 1 : restored.camera?.zoom ?? 1)
  const panRef = useRef<Point>(hasEntryContext ? { x: 0, y: 0 } : restored.camera?.pan ?? { x: 0, y: 0 })
  /* 드래그 중에는 pan 상태를 바꾸지 않는다. 상태가 바뀌면 객체 1,357개를 모두 다시 그려 한 번에 25~50ms 가 걸렸다.
     드래그를 시작할 때의 pan 을 기억해 두고, data-pan-follow 요소(그래프 SVG, 묶음 이름표, 점 이름표)에 CSS translate 로
     차이만 걸었다가, 손을 떼면 pan 상태를 한 번 바꾸고 translate 를 지운다. */
  const dragBasePan = useRef<Point | null>(null)
  const dragCommitted = useRef(false)
  const panFollowers = () => (canvasRef.current ? [...canvasRef.current.querySelectorAll<HTMLElement | SVGElement>('[data-pan-follow]')] : [])
  const applyDragOffset = () => {
    const base = dragBasePan.current
    if (!base) return
    const offset = `${panRef.current.x - base.x}px ${panRef.current.y - base.y}px`
    for (const el of panFollowers()) el.style.translate = offset
  }
  const clearDragOffset = () => { for (const el of panFollowers()) el.style.translate = '' }
  const commitDragPan = () => {
    const base = dragBasePan.current
    if (!base) return
    dragBasePan.current = null
    if (base.x === panRef.current.x && base.y === panRef.current.y) { clearDragOffset(); return }
    dragCommitted.current = true
    setPan(panRef.current)
  }

  const pointerMode = useRef<{
    kind: 'pan' | 'node'
    pointerId: number
    start: Point
    origin: Point
    nodeId?: string
  } | null>(null)
  const semanticWheelDelta = useRef(0)
  const zoomWheelRaw = useRef<number | null>(null)
  const lastSemanticStepAt = useRef(-Infinity)
  const cancelPointerGesture = useCallback(() => {
    commitDragPan()
    pointerMode.current = null
    semanticWheelDelta.current = 0
  }, [])
  useEffect(() => {
    window.addEventListener('blur', cancelPointerGesture)
    return () => window.removeEventListener('blur', cancelPointerGesture)
  }, [cancelPointerGesture])
  const canvasRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!dragCommitted.current) return
    dragCommitted.current = false
    clearDragOffset()
  }, [pan])
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  /* 도구 막대 오른쪽 끝(캔버스 영역 기준 px). 상세 패널(오른쪽에 떠 있음)이 이보다 왼쪽까지 오면
     패널을 도구 막대 아래로 내린다 — 전에는 패널이 「검색·경로」 · 「탐지 결과」 단추를 덮어
     탐지 결과 패널을 닫을 수 없었다(탐지 결과 패널을 연 채 항목을 고르면). */
  const [toolbarRight, setToolbarRight] = useState(0)
  /* 도구 막대 아래 끝. 막대가 두 줄로 넘어가면 화면 맞춤이 그만큼 위를 더 비운다 */
  const [toolbarBottom, setToolbarBottom] = useState(TOOLBAR_BOTTOM_ONE_LINE)
  useEffect(() => {
    const element = toolbarRef.current
    if (!element) return
    // 도구 막대 아래 끝도 내보낸다. AI 창을 열어 캔버스가 좁아지면 막대가 두 줄로 접히는데,
    // 그 아래 「보는 중」 표시가 고정 자리(top 66px)에 있어 막대 밑에 가려졌다.
    const update = () => {
      setToolbarRight(Math.round(element.offsetLeft + element.offsetWidth))
      const bottom = Math.round(element.offsetTop + element.offsetHeight)
      setToolbarBottom(bottom)
      element.parentElement?.style.setProperty('--gx-toolbar-bottom', `${bottom}px`)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  /* 범례 폭. 막대 옆에 범례가 들어갈 자리가 있는지 재는 데 쓴다. 범례는 보일 선이 없으면 그리지 않아
     ref 콜백으로 붙었다 떨어질 때마다 다시 잰다 */
  const [legendWidth, setLegendWidth] = useState(0)
  const legendObserver = useRef<ResizeObserver | null>(null)
  const legendRef = useCallback((element: HTMLDivElement | null) => {
    legendObserver.current?.disconnect()
    legendObserver.current = null
    if (!element) { setLegendWidth(0); return }
    const update = () => setLegendWidth(Math.round(element.offsetWidth))
    update()
    legendObserver.current = new ResizeObserver(update)
    legendObserver.current.observe(element)
  }, [])

  useEffect(() => {
    if (evidenceMode) return
    writeGraphSession({ level: semanticLevel, focus: focusObjectKey, target: targetObjectKey,
      expanded: expandedObjectKeys, queryObjects: queryObjectKeys,
      queryRelations: queryRelationKeys, queryLinks: queryLinkIds,
      queryExecuted, queryPath, findingIds: selectedFindingIds, lenses: [...relationLenses], showEffectiveAccess,
      includeLinks: includeIdentityLinks, provider: providerFilter, providers: [...selectedProviders],
      pathHops: pathMaxHops, pathDirected, showAll: showAllObjects,
      selectedNode: selectedSemanticNodeId, selectedObject: selectedObjectKey, selectedEdge: selectedEdgeId,
      camera: { zoom, pan },
    })
    /* 보던 객체와 표시 수준을 주소에도 남긴다(기록은 쌓지 않음). 링크를 받은 동료가 SaaS 요약 대신 같은 객체를 연다 */
    const hash = window.location.hash
    if (hash.toLowerCase().startsWith('#graph')) {
      const params = new URLSearchParams()
      const objectKey = selectedObjectKey ?? focusObjectKey
      if (objectKey) params.set('object', objectKey)
      if (semanticLevel !== 'ecosystem' && !objectKey) params.set('level', semanticLevel)
      const query = params.toString()
      const next = query ? `#graph?${query}` : '#graph'
      if (hash !== next) window.history.replaceState(window.history.state, '', next)
    }
  }, [semanticLevel, focusObjectKey, targetObjectKey, expandedObjectKeys,
    queryObjectKeys, queryRelationKeys, queryLinkIds, queryExecuted, queryPath, selectedFindingIds,
    relationLenses, showEffectiveAccess, includeIdentityLinks, providerFilter, selectedProviders, pathMaxHops,
    pathDirected, showAllObjects, selectedSemanticNodeId, selectedObjectKey, selectedEdgeId, zoom, pan, evidenceMode])

  const structuralPath = useMemo(() => focusObjectKey && targetObjectKey ? findInvestigationPath(currentGraph, focusObjectKey, targetObjectKey, { maxHops: pathMaxHops, directed: pathDirected, includeIdentityLinks }) : null, [currentGraph, focusObjectKey, targetObjectKey, pathMaxHops, pathDirected, includeIdentityLinks])
  const activePath = queryPath ?? structuralPath
  const pathEdgeKeys = useMemo(() => new Set(activePath?.steps.map(step => step.edgeId) ?? []), [activePath])
  const queryEdgeKeys = useMemo(() => new Set([...queryRelationKeys, ...queryLinkIds]), [queryRelationKeys, queryLinkIds])

  const scopeResult = useMemo(() => calculateInvestigationScope(currentGraph, {
    findings,
    selectedFindingIds,
    focus: focusObjectKey,
    target: targetObjectKey,
    expanded: expandedObjectKeys,
    queryObjects: queryObjectKeys,
    pathObjects: activePath?.objects ?? [],
    includeLinks: includeIdentityLinks,
    selectedProviders,
    relationLenses,
    selectedObjectKey: selectedObjectKey && currentGraph.objectsByKey.has(selectedObjectKey) ? selectedObjectKey : undefined,
  }), [currentGraph, findings, selectedFindingIds, focusObjectKey, targetObjectKey, expandedObjectKeys, queryObjectKeys, activePath, includeIdentityLinks, selectedProviders, relationLenses, selectedObjectKey])

  const baseScopedObjects = scopeResult.visible
  const remainingCandidateCount = scopeResult.remainingCandidateCount
  const excludedEvidenceCount = scopeResult.excludedEvidenceCount

  // Effective Access 선을 켜면 조사 모드에서는 현재 조사와 관련된 결론(양 끝점 중 하나 이상이 포함된 것)의 끝점을 포함한다
  const scopedObjects = useMemo<ReadonlySet<string>>(() => {
    if (!showEffectiveAccess || !eaRows.length) return baseScopedObjects
    const next = new Set(baseScopedObjects)
    for (const row of eaRows) {
      if (showAllObjects) {
        if (currentGraph.objectsByKey.has(row.references.source)) next.add(row.references.source)
        if (currentGraph.objectsByKey.has(row.references.target)) next.add(row.references.target)
      } else {
        const isSourceRelevant = baseScopedObjects.has(row.references.source)
        const isTargetRelevant = baseScopedObjects.has(row.references.target)
        if (isSourceRelevant || isTargetRelevant) {
          if (currentGraph.objectsByKey.has(row.references.source)) next.add(row.references.source)
          if (currentGraph.objectsByKey.has(row.references.target)) next.add(row.references.target)
        }
      }
    }
    return next
  }, [baseScopedObjects, showEffectiveAccess, eaRows, currentGraph, showAllObjects])

  const containment = useMemo(() => buildContainment(currentGraph), [currentGraph])

  /* 원 단계 자리를 잡을 때 쓰는 그래프 칸 크기. 화면 맞춤(getFitCamera)과 같은 여백을 뺀다.
     창 크기가 조금 바뀔 때마다 다시 배치하지 않게 20px 단위로 내린다 */
  const fitTop = Math.max(122, toolbarBottom + FIT_BELOW_TOOLBAR)
  const layoutView = useMemo(() => ({
    width: Math.floor(Math.max(viewportSize.width - FIT_INSET_EDGE * 2, 320) / 20) * 20,
    height: Math.floor(Math.max(viewportSize.height - fitTop - FIT_INSET_BOTTOM, 240) / 20) * 20,
  }), [viewportSize.width, viewportSize.height, fitTop])

  /* SaaS 사이 연결. SaaS 단계 선에서 뽑아, 조직, 그룹, 객체 단계도 같은 SaaS 자리 계획(circleLevels)을 쓴다 */
  const ecosystemLinks = useMemo(() => {
    const eco = projectSemanticGraph(currentGraph, findings, 'ecosystem', {
      provider: providerFilter, providers: selectedProviders, relationLens: 'all', includeIdentityLinks: true,
      identityEdges: evidenceMode ? identityEdges ?? [] : undefined,
    })
    return providerLinks(eco.nodes, eco.edges)
  }, [currentGraph, findings, providerFilter, selectedProviders, evidenceMode, identityEdges])

  const [extraLinks] = useState(initialExtraLinks)
  // Project graph dynamically
  const projected = useMemo(() => {
    const full = projectSemanticGraph(currentGraph, findings, semanticLevel, {
      provider: providerFilter, providers: selectedProviders, selectedFindingIds,
      relationLens: 'all', includeIdentityLinks: true,
      identityEdges: evidenceMode ? identityEdges ?? [] : undefined,
      extraLinks,
    })
    // L1·L2 have only a handful of nodes; without a focus or query they show everything
    // (L2 still narrows to a selected Finding).
    const unscoped = !focusObjectKey && !queryObjectKeys.length
    const scope = restrictToInvestigationScope(full, scopedObjects, showAllObjects ||
      (semanticLevel === 'ecosystem' && unscoped) || (semanticLevel === 'tenant' && unscoped && !selectedFindingIds.length))
    const nesting = semanticLevel === 'object'
      ? visibleContainment(containment, new Set(scope.nodes.map(node => node.id)))
      : undefined
    if (isCircleLevel(semanticLevel)) {
      const laid = layoutCircleLevel(scope.nodes, semanticLevel, ecosystemLinks, layoutView)
      return { ...scope, nodes: laid.nodes, hubs: laid.hubs, circle: laid as CircleLayout | null }
    }
    return { ...scope, nodes: layoutGraphNodes(scope.nodes, scope.edges, semanticLevel, nesting, ecosystemLinks), hubs: [] as CircleLayout['hubs'], circle: null }
  }, [extraLinks, currentGraph, findings, semanticLevel, providerFilter, selectedProviders, selectedFindingIds, scopedObjects, showAllObjects, focusObjectKey, queryObjectKeys, queryExecuted, containment, evidenceMode, identityEdges, ecosystemLinks, layoutView])

  /* 화면 맞춤이 원과 이름표, 조직, 그룹 단계의 SaaS 가운데 원까지 담게(자리를 잡을 때 같이 잰다) */
  const circleFrames = useMemo(() => projected.circle?.frames ?? [], [projected])

  /* L4 의 포함 테두리. 워크스페이스 ⊃ 채널 ⊃ 메시지, Okta 그룹 ⊃ 사용자처럼
     상위 객체의 칸이 자기 테두리 왼쪽 위에 앉고 안에 든 칸이 그 아래에 모인다.
     소속(member_of)이 두 곳 이상이면 테두리가 아니라 선으로 남는다(containment.ts). */
  const nestParents = useMemo(() => semanticLevel === 'object'
    ? visibleContainment(containment, new Set(projected.nodes.map(node => node.id)))
    : new Map<string, string>(), [semanticLevel, containment, projected.nodes])
  // 소속으로 그룹 테두리에 들어간 칸. 그 그룹이 조사 범위 밖이라 더 바깥에 놓였으면 뺀다.
  const memberChildren = useMemo(() => {
    const nested = membershipNested(currentGraph)
    return new Set([...nestParents.keys()].filter(key => nested.has(key) && containment.get(key) === nestParents.get(key)))
  }, [currentGraph, containment, nestParents])
  /* L4 칸의 짧은 이름과 칸 크기. 폭은 이름에 맞춘다(배치도 같은 값을 쓴다). */
  const objectNames = useMemo(() => semanticLevel === 'object'
    ? objectShortNames(projected.nodes) : new Map<string, string>(), [semanticLevel, projected.nodes])
  /* 객체 단계 원(objectCircles): 상위 객체 원과 SaaS 원. 배치와 같은 원 채우기로 다시 잰다 */
  const objectCircles = useMemo(() => semanticLevel === 'object'
    ? objectCircleFrames(projected.nodes, nestParents, memberChildren)
    : { frames: [] as CircleFrame[], providers: [] }, [semanticLevel, projected.nodes, nestParents, memberChildren])
  /* 칸 크기: 개별 객체는 원, 상위 객체는 테두리 맨 위 이름표 */
  const objectBoxes = useMemo(() => {
    const boxes = new Map<string, { width: number; height: number }>()
    if (semanticLevel !== 'object') return boxes
    for (const node of projected.nodes) boxes.set(node.id, { width: OBJECT_CIRCLE_R * 2, height: OBJECT_CIRCLE_R * 2 })
    for (const frame of objectCircles.frames) boxes.set(frame.id, { width: frame.legend, height: RING_LEGEND_H })
    return boxes
  }, [semanticLevel, projected.nodes, objectCircles])
  const objectBoxOf = (id: string) => objectBoxes.get(id) ?? SEMANTIC_NODE_BOX.object

  const nestFrames = objectCircles.frames
  const nestFrameById = useMemo(() => new Map(nestFrames.map(frame => [frame.id, frame])), [nestFrames])

  const edgeFlags = useMemo(() => {
    const flags = new Map<string, EdgeFlags>()
    for (const edge of projected.edges) {
      const { isResolution, isPolicyAssignment } = ecosystemEdgeKind(edge)
      const hasSelectedFinding = showFindingEvidence && selectedFindingIds.length > 0 && (edge.selectedFindingCount ?? 0) > 0
      const hasAnyFinding = showFindingEvidence && edge.findingCount > 0
      flags.set(edge.id, {
        isSelected: selectedEdgeId === edge.id,
        isResolution,
        isPolicyAssignment,
        hasSelectedFinding,
        hasAnyFinding,
        isDimmed: showFindingEvidence && selectedFindingIds.length > 0 && !hasSelectedFinding,
        onPath: edge.relationKeys.some(key => pathEdgeKeys.has(key)) || edge.resolutionIds.some(key => pathEdgeKeys.has(key)),
        onQuery: edge.relationKeys.some(key => queryEdgeKeys.has(key)) || edge.resolutionIds.some(key => queryEdgeKeys.has(key)),
        matchesLens: (isPolicyAssignment && (relationLenses.has('authority') || allRelationViewsSelected(relationLenses))) ||
          (!isPolicyAssignment && edge.relationTypes.some(type => relationMatchesAnyLens(type, relationLenses))) ||
          (includeIdentityLinks && edge.resolutionIds.length > 0),
        isLinkHidden: !includeIdentityLinks && edge.resolutionCount > 0 && edge.relationCount === 0,
        // 테두리가 이미 말하는 포함·소속선(메시지 → 채널, 사용자 → 그룹)
        framed: nestParents.size > 0 && edge.resolutionCount === 0 &&
          edge.relationTypes.every(type => type === 'contained_in' || type === 'member_of') &&
          (nestParents.get(edge.sourceSemanticNodeId) === edge.targetSemanticNodeId ||
            nestParents.get(edge.targetSemanticNodeId) === edge.sourceSemanticNodeId),
      })
    }
    return flags
  }, [projected.edges, showFindingEvidence, selectedFindingIds, selectedEdgeId, pathEdgeKeys, queryEdgeKeys, relationLenses, includeIdentityLinks, nestParents])

  /* 관계선 메뉴에 적을 수: 묶음마다 지금 화면에 있는 관계 수, 종류별 수, 그중 테두리로 대신한 수 */
  /* 관계선 메뉴의 수는 「이 화면 n / 전체 m」. 전에는 이 화면 수만 있어, 0인 묶음이 데이터에 없는지 이 범위에서만 안 보이는지 알 수 없었다 */
  const lensTotals = useMemo(() => {
    const groups: Record<RelationLensGroup, number> = { structure: 0, authority: 0, trust: 0, flow: 0 }
    for (const relation of currentGraph.relationsByKey?.values() ?? []) {
      const view = relationViewGroup(relation.relationType)
      if (view) groups[view] += 1
      if (isFlowRelation(relation.relationType)) groups.flow += 1
    }
    return { groups, total: currentGraph.relationsByKey?.size ?? 0 }
  }, [currentGraph])
  const identityOnScreen = useMemo(() => new Set(projected.edges.flatMap(edge => edge.resolutionIds)).size, [projected.edges])
  const eaOnScreen = useMemo(() => {
    const keys = new Set(projected.nodes.flatMap(node => node.memberObjectKeys))
    return eaRows.filter(row => keys.has(row.references.source) && keys.has(row.references.target)).length
  }, [projected.nodes, eaRows])
  const lensCount = (shown: number, total: number) => (
    <em className="gx-lens-count" title={`이 화면 ${shown}개, 전체 ${total}개`}>{shown}<small> / {total}</small></em>
  )

  const lensCounts = useMemo(() => {
    const empty = (): LensCount => ({ total: 0, framed: 0, types: new Map() })
    const counts: Record<RelationLensGroup, LensCount> = { structure: empty(), authority: empty(), trust: empty(), flow: empty() }
    const seen = new Set<string>()
    for (const edge of projected.edges) {
      // 역할 부여 선은 has_role_on 을 역할 칸 쪽으로 한 번 더 그린 것이라 세지 않는다
      if (edge.kind === 'policy_assignment') continue
      const flags = edgeFlags.get(edge.id)
      const framed = flags ? edgeNotDrawn(flags) : false
      for (const key of edge.relationKeys) {
        if (seen.has(key)) continue
        seen.add(key)
        const type = currentGraph.relationsByKey?.get(key)?.relationType ?? edge.relationTypes[0] ?? ''
        const groups: RelationLensGroup[] = []
        const view = relationViewGroup(type)
        if (view) groups.push(view)
        if (isFlowRelation(type)) groups.push('flow')
        for (const group of groups) {
          const count = counts[group]
          count.total += 1
          if (framed) count.framed += 1
          count.types.set(type, (count.types.get(type) ?? 0) + 1)
        }
      }
    }
    return { groups: counts, total: seen.size }
  }, [projected.edges, edgeFlags, currentGraph])

  /* 관계선 메뉴 설명 칸의 글. 칸에는 이름과 수만 두고, 뜻과 종류별 수는 여기서 만든다 */
  const lensDetail = (key: LensMenuKey): { title: string; lines: string[] } => {
    if (key === 'all') return { title: `${RELATION_LENS_LABELS.all} ${lensCounts.total}`, lines: ['수집된 모든 관계선. 숫자는 지금 화면에 있는 관계 수, 고르지 않은 선은 흐리게 표시'] }
    if (key === 'identity') {
      const allLinks = [...(currentGraph.linksById?.values() ?? [])]
      const totalCount = allLinks.length
      const confirmed = allLinks.filter(l => l.level === 'resolved' || l.level === 'disclosed_relation').length
      const inferred = totalCount - confirmed
      return {
        title: `동일인 연결 ${totalCount}`,
        lines: [
          '같은 사람으로 확인된 서로 다른 SaaS 계정의 연결',
          '같은 자동화와 Group Push 그룹 복제 포함, SaaS 사이를 잇는 유일한 저장 관계',
          `동일인 연결 ${totalCount}건, 확인 ${confirmed}건, 추정 ${inferred}건`,
        ],
      }
    }
    if (key === 'ea') {
      return {
        title: `Effective Access ${eaRows.length}`,
        lines: eaRows.length
          ? [`계산된 Effective Access 결과 ${eaRows.length}건`, '저장된 관계가 아닌 여러 단계를 이어 계산한 결과라 파란 선으로 따로 표시. 점선은 미확정']
          : ['이 데이터셋에 Effective Access 결과 없음'],
      }
    }
    const count = lensCounts.groups[key]
    const title = key === 'flow' ? `${RELATION_LENS_LABELS.flow}만 ${count.total}` : `${RELATION_LENS_LABELS[key]} ${count.total}`
    const lines = [RELATION_LENS_HINTS[key], count.total ? lensBreakdown(count) : '이 화면에 없음']
    if (count.framed > 0) lines.push(`그중 ${count.framed}개는 선 대신 테두리로 표시`)
    if (key === 'flow') lines.push('신뢰, 인증 가운데 이 관계만 강조. 관계가 있어도 실제 실행, 전달 기록은 아님')
    return { title, lines }
  }

  /* 범례에 적을 수: 지금 그려진 선만 센다. 화면에 없는 것은 범례에서 뺀다 */
  const legendCounts = useMemo(() => {
    const counts = { relation: 0, identity: 0, policy: 0, finding: 0, query: 0 }
    for (const edge of projected.edges) {
      const flags = edgeFlags.get(edge.id)
      if (!flags || edgeNotDrawn(flags) || flags.isLinkHidden) continue
      if (flags.isPolicyAssignment) counts.policy += 1
      else if (flags.isResolution) counts.identity += 1
      else counts.relation += 1
      if (selectedFindingIds.length ? flags.hasSelectedFinding : flags.hasAnyFinding) counts.finding += 1
      if (flags.onQuery) counts.query += 1
    }
    return counts
  }, [projected.edges, edgeFlags, selectedFindingIds])
  /* 점 모드의 동그라미 자리. 칸 자리 그대로면 한 줄로 쌓인 칸의 동그라미가 서로 덮여, 겹친 것만
     떼어 놓는다(dotLayout). 테두리 주인은 둘레의 옅은 고리까지 잰다. */
  const dotPositions = useMemo(() => {
    if (semanticLevel !== 'object') return new Map<string, Point>()
    const scale = 1 / DOT_REFERENCE_ZOOM
    const core = dotRadius(DOT_REFERENCE_ZOOM) + 1.6 * scale / 2
    const halo = dotRadius(DOT_REFERENCE_ZOOM) + 8 * scale
    return separateDots(projected.nodes, node => nestFrameById.has(node.id) ? halo : core, 2 * scale)
  }, [semanticLevel, projected.nodes, nestFrameById])
  const dotMode = semanticLevel === 'object' && zoom < DOT_ZOOM
  /* 칸의 반폭 · 반높이(월드). 선을 칸 테두리에서 끊는 데 쓴다. 점 모드는 동그라미 반지름. */
  const nodeHalfSize = (node: SemanticNode): { hw: number; hh: number; round?: boolean } => {
    if (semanticLevel === 'object') {
      if (zoom < DOT_ZOOM) {
        const r = dotRadius(zoom) + (membershipHubIds.has(node.id) ? 2 / Math.max(zoom, CAMERA_MIN_ZOOM) : 0)
        return { hw: r, hh: r, round: true }
      }
      const frame = nestFrameById.get(node.id)
      if (frame) return { hw: frame.legend / 2, hh: RING_LEGEND_H / 2 }
      return { hw: OBJECT_CIRCLE_R, hh: OBJECT_CIRCLE_R, round: true }
    }
    if (isCircleLevel(semanticLevel)) {
      const r = circleRadius(node)
      return { hw: r, hh: r, round: true }
    }
    const level = SEMANTIC_NODE_BOX[semanticLevel]
    return { hw: level.width / 2, hh: level.height / 2 }
  }
  /* from 칸 가운데에서 to 쪽으로 나가다 from 칸 테두리와 만나는 점 */
  const clipToNode = (from: SemanticNode, to: { x: number; y: number }) => {
    const size = nodeHalfSize(from)
    const dx = to.x - from.x
    const dy = to.y - from.y
    if (!dx && !dy) return { x: from.x, y: from.y }
    const t = size.round
      ? size.hw / Math.hypot(dx, dy)
      : Math.min(dx ? size.hw / Math.abs(dx) : Infinity, dy ? size.hh / Math.abs(dy) : Infinity)
    return t >= 1 ? { x: from.x, y: from.y } : { x: from.x + dx * t, y: from.y + dy * t }
  }
  /* 두 칸을 잇는 선의 두 끝(칸 테두리). 두 칸이 겹쳐 끊은 끝이 뒤집히면 가운데끼리 잇는다.
     관계선과 Effective Access 선(EaHitLayer · EaLines)이 같이 쓴다. */
  const edgeEnds: EdgeEnds = (src, tgt) => {
    const a = clipToNode(src, tgt)
    const b = clipToNode(tgt, src)
    if ((b.x - a.x) * (tgt.x - src.x) + (b.y - a.y) * (tgt.y - src.y) <= 0) return [{ x: src.x, y: src.y }, { x: tgt.x, y: tgt.y }]
    return [a, b]
  }
  const eaGeometry: EaGeometry = (src, tgt) => {
    const [a, b] = edgeEnds(src, tgt)
    return accessCurve(a, b, zoom, src.id === tgt.id ? nodeHalfSize(src) : undefined)
  }

  /* 선택한 칸과 직접 연결된 이웃 노드 (1-hop 연결 끝점) */
  const selectedNeighbors = useMemo(() => {
    if (!selectedSemanticNodeId) return new Set<string>()
    const neighbors = new Set<string>()
    for (const edge of projected.edges) {
      if (edge.sourceSemanticNodeId === selectedSemanticNodeId) neighbors.add(edge.targetSemanticNodeId)
      else if (edge.targetSemanticNodeId === selectedSemanticNodeId) neighbors.add(edge.sourceSemanticNodeId)
    }
    return neighbors
  }, [selectedSemanticNodeId, projected.edges])

  /* 선을 진하게 그릴 칸: 커서를 올린 칸과 고른 칸 */
  const edgeFocusOf = (hoveredNodeId: string | null): ReadonlySet<string> => new Set([hoveredNodeId, selectedSemanticNodeId]
    .filter((id): id is string => Boolean(id)))

  const inspectorOpen = !assistantOpen && Boolean(selectedSemanticNodeId || selectedEdgeId || selectedEaRowIds?.length || focusedFinding)
  const inspectorFloating = inspectorOpen && evidenceMode
  const inspectorRightInset = inspectorFloating && viewportSize.width >= 720 ? FIT_INSET_INSPECTOR : 0
  const inspectorBottomInset = inspectorFloating && viewportSize.width < 720 ? viewportSize.height * 0.48 + FIT_INSET_EDGE : 0
  const hasSelection = Boolean(selectedSemanticNodeId || selectedEdgeId || selectedEaRowIds?.length || focusedFinding)
  // 선택을 풀면 상세 탭 자리에 탐지 결과를 보인다
  useEffect(() => { if (!hasSelection && sideTab === 'detail') setSideTab('findings') }, [hasSelection, sideTab])
  // 칸, 선, Effective Access 결과를 새로 고르면 상세 탭을 연다. 지난 조사에서 되살린 선택은 닫아 둔 패널을 열지 않는다
  const restoredSelection = useRef<string | null>(hasEntryContext ? null : `${selectedSemanticNodeId}|${selectedEdgeId}|${selectedEaRowIds?.join(',')}`)
  useEffect(() => {
    const now = `${selectedSemanticNodeId}|${selectedEdgeId}|${selectedEaRowIds?.join(',')}`
    if (now === restoredSelection.current) return
    restoredSelection.current = null
    if (selectedSemanticNodeId || selectedEdgeId || selectedEaRowIds?.length) { setFocusedFindingId(null); setSideTab('detail'); setSideOpen(true) }
  }, [selectedSemanticNodeId, selectedEdgeId, selectedEaRowIds])

  /* 상세 단계의 SaaS 묶음 테두리.
     L3·L4에는 칸에 SaaS 표시가 없다(전에는 왼쪽 색 띠 하나였다).
     묶음을 그려 놓고 머리글에 로고와 이름을 한 번만 적으면, 칸마다
     색을 칠하는 것보다 어느 SaaS인지가 훨씬 또렷하다.
     자리는 보이는 칸에서 직접 잰다. 필터로 몇 칸만 남아도 테두리가
     남은 칸에 붙는다. */
  const clusterFrames = useMemo(() => {
    if (semanticLevel !== 'object') return []
    // SaaS 원과 둘러싼 사각(화면 맞춤, 멀리서 본 이름표 자리). 이름표는 원 맨 위에 걸친다
    return objectCircles.providers.map(circle => ({
      provider: circle.provider as ProviderId | 'gws',
      label: providerName(circle.provider),
      count: circle.count,
      x: circle.cx - circle.r,
      y: circle.cy - circle.r - SAAS_LEGEND_H / 2,
      width: circle.r * 2,
      height: circle.r * 2 + SAAS_LEGEND_H / 2,
      cx: circle.cx,
      cy: circle.cy,
      r: circle.r,
      legend: circle.legend,
    }))
  }, [semanticLevel, objectCircles])

  useEffect(() => {
    zoomRef.current = zoom
    panRef.current = pan
  }, [zoom, pan])

  const animateCameraTo = useCallback((nextZoom: number, nextPan: Point, duration = 260) => {
    if (cameraAnimationRaf.current !== null) cancelAnimationFrame(cameraAnimationRaf.current)
    const startZoom = zoomRef.current
    const startPan = panRef.current
    const startedAt = performance.now()

    const tick = (now: number) => {
      const raw = Math.min((now - startedAt) / duration, 1)
      const eased = easeInOutCubic(raw)
      const frameZoom = startZoom + (nextZoom - startZoom) * eased
      const framePan = {
        x: startPan.x + (nextPan.x - startPan.x) * eased,
        y: startPan.y + (nextPan.y - startPan.y) * eased,
      }
      zoomRef.current = frameZoom
      panRef.current = framePan
      setZoom(frameZoom)
      setPan(framePan)
      if (raw < 1) cameraAnimationRaf.current = requestAnimationFrame(tick)
      else cameraAnimationRaf.current = null
    }

    cameraAnimationRaf.current = requestAnimationFrame(tick)
  }, [])

  const getFitCamera = useCallback((): { zoom: number; pan: Point } | null => {
    if (!viewportSize.width || !viewportSize.height) return null
    const insets = {
      // 도구 막대 아래. SaaS 묶음이 있으면 윗줄 묶음 위로 늘어나는 이름표 자리(화면 약 36px)를 더 비운다.
      top: evidenceMode ? 36 : Math.max(122, toolbarBottom + FIT_BELOW_TOOLBAR + (showEffectiveAccess ? 40 : 0)) + (clusterFrames.length ? 36 : 0),
      right: !evidenceMode && inspectorRightInset ? inspectorRightInset : FIT_INSET_EDGE,
      bottom: Math.max(FIT_INSET_BOTTOM, inspectorBottomInset),
      left: FIT_INSET_EDGE,
    }
    const fit = computeFitToView(projected.nodes, viewportSize, insets, { frames: [...clusterFrames, ...circleFrames], nodeBox: !circleFrames.length })
    if (!fit) return fit
    // 계산한 배율을 단계 값으로 내리고, 보이는 영역 가운데가 같은 곳을 가리키게 이동을 다시 맞춘다
    const zoom = snapZoomDown(fit.zoom)
    const cx = insets.left + (viewportSize.width - insets.left - insets.right) / 2
    const cy = insets.top + (viewportSize.height - insets.top - insets.bottom) / 2
    const wx = (cx - fit.pan.x) / fit.zoom, wy = (cy - fit.pan.y) / fit.zoom
    return { zoom, pan: { x: cx - wx * zoom, y: cy - wy * zoom } }
  }, [viewportSize, projected.nodes, inspectorRightInset, inspectorBottomInset, clusterFrames, circleFrames, evidenceMode, toolbarBottom, showEffectiveAccess])

  const fitToView = useCallback((animated = true) => {
    revealNodeRef.current = null
    const camera = getFitCamera()
    if (!camera) return
    if (animated) animateCameraTo(camera.zoom, camera.pan, 260)
    else {
      setZoom(camera.zoom)
      setPan(camera.pan)
    }
  }, [getFitCamera, animateCameraTo])

  const getCurrentHistoryState = useCallback((): InvestigationHistoryItem => ({
    level: semanticLevel,
    focusKey: focusObjectKey,
    targetKey: targetObjectKey,
    selectedNodeId: selectedSemanticNodeId,
    selectedObjectKey,
    selectedEdgeId,
    expandedKeys: expandedObjectKeys,
    queryObjectKeys,
    queryRelationKeys,
    queryLinkIds,
    queryExecuted,
    queryPath,
    selectedFindingIds,
    relationLenses,
    showEffectiveAccess,
    includeIdentityLinks,
    selectedProviders,
    pathMaxHops,
    pathDirected,
    showAllObjects,
    camera: { zoom: zoomRef.current, pan: { ...panRef.current } },
  }), [semanticLevel, focusObjectKey, targetObjectKey, selectedSemanticNodeId, selectedObjectKey, selectedEdgeId, expandedObjectKeys, queryObjectKeys, queryRelationKeys, queryLinkIds, queryExecuted, queryPath, selectedFindingIds, relationLenses, showEffectiveAccess, includeIdentityLinks, selectedProviders, pathMaxHops, pathDirected, showAllObjects])

  const pushHistory = useCallback((item?: InvestigationHistoryItem) => {
    entryZoomFloor.current = 0
    const toPush = item ?? getCurrentHistoryState()
    setInvestigationHistory(prev => [...prev.slice(-19), toPush])
    setForwardHistory([])
  }, [getCurrentHistoryState])

  /** 저장해 둔 조사 위치(표시 수준, 선택, 검색, 카메라)로 돌아간다 */
  const applyHistoryItem = useCallback((item: InvestigationHistoryItem) => {
    setSemanticLevel(item.level)
    setFocusObjectKey(item.focusKey)
    setTargetObjectKey(item.targetKey)
    setSelectedSemanticNodeId(item.selectedNodeId)
    setSelectedObjectKey(item.selectedObjectKey)
    setSelectedEdgeId(item.selectedEdgeId)
    setExpandedObjectKeys(item.expandedKeys)
    setQueryObjectKeys(item.queryObjectKeys)
    setQueryRelationKeys(item.queryRelationKeys)
    setQueryLinkIds(item.queryLinkIds)
    setQueryExecuted(item.queryExecuted)
    setQueryPath(item.queryPath)
    setSelectedFindingIds(item.selectedFindingIds)
    setRelationLenses(item.relationLenses)
    setShowEffectiveAccess(item.showEffectiveAccess)
    setIncludeIdentityLinks(item.includeIdentityLinks)
    setSelectedProviders(item.selectedProviders)
    setShowAllObjects(item.showAllObjects)
    if (item.camera) {
      animateCameraTo(item.camera.zoom, item.camera.pan)
    }
  }, [animateCameraTo])

  const handleGoBack = useCallback(() => {
    const last = investigationHistory[investigationHistory.length - 1]
    if (!last) return
    setForwardHistory(prev => [...prev.slice(-19), getCurrentHistoryState()])
    setInvestigationHistory(prev => prev.slice(0, -1))
    applyHistoryItem(last)
  }, [investigationHistory, getCurrentHistoryState, applyHistoryItem])

  const handleGoForward = useCallback(() => {
    const next = forwardHistory[forwardHistory.length - 1]
    if (!next) return
    setInvestigationHistory(prev => [...prev.slice(-19), getCurrentHistoryState()])
    setForwardHistory(prev => prev.slice(0, -1))
    applyHistoryItem(next)
  }, [forwardHistory, getCurrentHistoryState, applyHistoryItem])

  /* 상세 패널의 「연결된 항목 펼치기」가 기준 객체를 따로 주지 않았을 때 펼칠 객체 */
  const defaultExpandRoot = selectedObjectKey && currentGraph.objectsByKey.has(selectedObjectKey) ? selectedObjectKey : focusObjectKey
  /* 펼칠 연결이 하나도 없으면 「연결된 항목 펼치기」를 끈다. 누른 뒤 아무것도 안 나오는 단추를 두지 않는다 */
  const hasNeighbors = useCallback((key: string) => neighbors(currentGraph, key, { includeIdentityLinks }).length > 0, [currentGraph, includeIdentityLinks])

  const expandNextCandidates = useCallback((rootKey?: string) => {
    const root = rootKey && currentGraph.objectsByKey.has(rootKey) ? rootKey : defaultExpandRoot
    if (!root) return

    pushHistory(getCurrentHistoryState())
    const direct = neighbors(currentGraph, root, { includeIdentityLinks })
    setExpandedObjectKeys(prev => [...new Set([...prev, root, ...direct.map(item => item.to)])])
    setShowAllObjects(false)
  }, [currentGraph, defaultExpandRoot, pushHistory, getCurrentHistoryState, includeIdentityLinks])

  const handleExpandNeighbors = useCallback((key: string) => {
    expandNextCandidates(key)
  }, [expandNextCandidates])

  // Track viewport size
  useEffect(() => {
    if (!canvasRef.current) return
    const element = canvasRef.current
    const update = () => {
      const rect = element.getBoundingClientRect()
      setViewportSize({ width: rect.width, height: rect.height })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Keep the restored camera until the user changes scope or requests Fit.
  const skipInitialFit = useRef(Boolean(restored.camera) && !hasEntryContext)
  /* 위협에서 들어왔을 때의 배율 하한. 전에는 객체 58개를 한 화면에 맞춰 25%의 점 덩어리로 열렸다.
     패널이 열려 다시 맞출 때도 지키고, 사람이 조사를 바꾸거나 화면 맞춤을 누르면 푼다 */
  const entryZoomFloor = useRef(initialEvidenceOnly && !initialFit ? 0.6 : 0)
  // initialFit 으로 열면(Explorer 의 한 연결) 연 뒤 ENTRY_FIT_WINDOW 동안은 객체 수, 그래프 칸 크기, 옆 칸 폭이 바뀔 때마다 다시 화면에 맞춘다.
  // 첫 맞춤은 칸이 자리 잡기 전 크기로 계산돼 확대된 채 열렸다. fitToView 는 자주 새로 만들어져 의존값으로 두지 않고 ref 로 부른다
  const fitUntil = useRef(initialFit ? Date.now() + ENTRY_FIT_WINDOW : 0)
  const fitRef = useRef(fitToView)
  fitRef.current = fitToView
  useEffect(() => {
    if (Date.now() > fitUntil.current || !projected.nodes.length) return
    const t = window.setTimeout(() => fitRef.current(true), ENTRY_FIT_DELAY)
    return () => window.clearTimeout(t)
  }, [projected.nodes.length, viewportSize.width, viewportSize.height, inspectorRightInset])
  // Auto fit on changes
  useEffect(() => {
    if (!viewportSize.width || !viewportSize.height) return
    if (skipInitialFit.current) { skipInitialFit.current = false; return }
    const raf = requestAnimationFrame(() => {
      const floor = entryZoomFloor.current
      const start = floor && selectedObjectKey ? projected.nodes.find(item => item.memberObjectKeys.includes(selectedObjectKey)) : undefined
      const fit = start ? getFitCamera() : null
      if (start && fit) {
        if (fit.zoom < floor) {
          const right = inspectorRightInset || 100
          animateCameraTo(floor, {
            x: Math.max(80, (viewportSize.width - right) / 2) - start.x * floor,
            y: Math.max(toolbarBottom + 64, (toolbarBottom + 48 + viewportSize.height - inspectorBottomInset) / 2) - start.y * floor,
          }, 160)
          return
        }
      }
      const node = projected.nodes.find(item => item.id === revealNodeRef.current)
      if (node) {
        const scale = Math.max(zoomRef.current, 0.8)
        const right = !evidenceMode && inspectorRightInset ? inspectorRightInset : 100
        animateCameraTo(scale, {
          x: Math.max(80, (viewportSize.width - right) / 2) - node.x * scale,
          y: Math.max(toolbarBottom + 64, (toolbarBottom + 48 + viewportSize.height - inspectorBottomInset) / 2) - node.y * scale,
        }, 160)
      } else fitToView(true)
    })
    return () => cancelAnimationFrame(raf)
  }, [
    semanticLevel,
    providerFilter,
    selectedProviders,
    viewportSize.width,
    viewportSize.height,
    inspectorOpen,
    projected.nodes.length,
    fitToView,
    animateCameraTo,
    inspectorRightInset,
    inspectorBottomInset,
    toolbarBottom,
  ])

  // Semantic transition animation
  useEffect(() => {
    if (!transitionFrom || transitionFrom.level === semanticLevel) return
    if (semanticTransitionRaf.current !== null) cancelAnimationFrame(semanticTransitionRaf.current)
    const startedAt = performance.now()
    setTransitionProgress(0)

    const tick = (now: number) => {
      const raw = Math.min((now - startedAt) / TRANSITION_MS, 1)
      setTransitionProgress(raw)
      if (raw < 1) semanticTransitionRaf.current = requestAnimationFrame(tick)
      else {
        semanticTransitionRaf.current = null
        setTransitionFrom(null)
        setTransitionProgress(1)
      }
    }

    semanticTransitionRaf.current = requestAnimationFrame(tick)
    return () => {
      if (semanticTransitionRaf.current !== null) cancelAnimationFrame(semanticTransitionRaf.current)
    }
  }, [semanticLevel, transitionFrom])

  const transitionNodeState = useMemo(() => {
    const state = new Map<string, { x: number; y: number; scale: number; opacity: number }>()
    const eased = easeInOutCubic(transitionProgress)

    for (const node of projected.nodes) {
      const at = (dotMode && dotPositions.get(node.id)) || node
      if (!transitionFrom) {
        state.set(node.id, { x: at.x, y: at.y, scale: 1, opacity: 1 })
        continue
      }
      const start = relatedCentroid(node, transitionFrom)
      state.set(node.id, {
        x: start.x + (at.x - start.x) * eased,
        y: start.y + (at.y - start.y) * eased,
        scale: 0.85 + 0.15 * eased,
        opacity: 0.3 + 0.7 * eased,
      })
    }
    return state
  }, [projected.nodes, transitionFrom, transitionProgress, dotMode, dotPositions])

  const changeSemanticLevel = (nextLevel: SemanticLevel) => {
    revealNodeRef.current = null
    if (nextLevel === semanticLevel) return
    setTransitionFrom(projected)
    setTransitionProgress(0)
    setSemanticLevel(nextLevel)
  }

  // Toggle Finding overlay
  const handleToggleFinding = (findingId: string) => {
    revealNodeRef.current = null
    setSelectedFindingIds(prev =>
      prev.includes(findingId) ? prev.filter(id => id !== findingId) : [...prev, findingId]
    )
  }

  const handleClearFindings = () => {
    revealNodeRef.current = null
    setSelectedFindingIds([])
  }

  // Pointer & Wheel Handlers
  const handleCanvasPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    const isBg = target === e.currentTarget || target.matches('svg.unified-graph-svg') ||
      Boolean(target.closest('.fg-cluster, .fg-nest-frame'))
    if (!isBg) return
    revealNodeRef.current = null

    pointerMode.current = {
      kind: 'pan',
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      origin: { ...panRef.current },
    }
    dragBasePan.current = { ...panRef.current }
    e.currentTarget.setPointerCapture(e.pointerId)
    semanticWheelDelta.current = 0
    lastSemanticStepAt.current = -Infinity
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointerMode.current || pointerMode.current.pointerId !== e.pointerId) return
    const dx = e.clientX - pointerMode.current.start.x
    const dy = e.clientY - pointerMode.current.start.y

    if (pointerMode.current.kind === 'pan') {
      if (!dx && !dy) return
      if (cameraAnimationRaf.current !== null) {
        cancelAnimationFrame(cameraAnimationRaf.current)
        cameraAnimationRaf.current = null
      }
      const nextPan = { x: panRef.current.x + dx, y: panRef.current.y + dy }
      panRef.current = nextPan
      pointerMode.current.start = { x: e.clientX, y: e.clientY }
      pointerMode.current.origin = nextPan
      // translate 쓰기는 React 렌더가 없어 가볍고, 브라우저가 프레임마다 묶어 그린다
      applyDragOffset()
    }
  }

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerMode.current && pointerMode.current.pointerId === e.pointerId) {
      commitDragPan()
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      pointerMode.current = null
      semanticWheelDelta.current = 0
    }
  }

  /* 배경을 누른 채 휠을 돌리면 표시 수준을, 그 외에는 카메라 배율을 바꾼다.
     기존 조작의 80px 누적과 300ms 간격을 유지해 관성 입력으로 여러 단계가 넘어가지 않게 한다. */
  const handleWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    revealNodeRef.current = null
    e.preventDefault()
    if (!canvasRef.current) return
    if (pointerMode.current?.kind === 'pan') {
      // 한 번 굴림에 한 단계만 옮기고 그 뒤 300ms 안의 휠은 버린다. 300ms는 입력이 들어온 시각(e.timeStamp)으로 잰다.
      // 처리하는 시각으로 재면, 단계를 바꾸느라 화면을 다시 그리는 동안 밀린 입력이 300ms 뒤에 처리되어 느린 기기에서 한 칸 더 움직였다(#26)
      const now = e.timeStamp || performance.now()
      if (now - lastSemanticStepAt.current < 300) {
        semanticWheelDelta.current = 0
        return
      }
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvasRef.current.clientHeight : 1)
      if (!Number.isFinite(delta) || !delta) return
      if (semanticWheelDelta.current && Math.sign(semanticWheelDelta.current) !== Math.sign(delta)) semanticWheelDelta.current = 0
      semanticWheelDelta.current += delta
      if (Math.abs(semanticWheelDelta.current) >= 80) {
        const index = SEMANTIC_LEVEL_ORDER.indexOf(semanticLevel)
        const next = Math.max(0, Math.min(SEMANTIC_LEVEL_ORDER.length - 1, index + (delta < 0 ? 1 : -1)))
        semanticWheelDelta.current = 0
        if (next !== index) {
          lastSemanticStepAt.current = now
          changeSemanticLevel(SEMANTIC_LEVEL_ORDER[next])
        }
        pointerMode.current.start = { x: e.clientX, y: e.clientY }
        pointerMode.current.origin = { ...panRef.current }
      }
      return
    }
    if (cameraAnimationRaf.current !== null) {
      cancelAnimationFrame(cameraAnimationRaf.current)
      cameraAnimationRaf.current = null
    }
    const rect = canvasRef.current.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const worldX = (screenX - panRef.current.x) / zoomRef.current
    const worldY = (screenY - panRef.current.y) / zoomRef.current
    // 휠 배율은 1% 단위로 맞춘다. 10% 미만은 0.1% 단위로 맞춰, 객체가 많아 맞춤 배율이 작은 화면에서도 휠 한 칸에 움직인다.
    // 터치패드의 잔 입력은 반올림 전 값에 쌓아 두어 한 단위가 모이면 움직인다
    const roundZoom = (value: number) => value < 0.1 ? Math.round(value * 1000) / 1000 : Math.round(value * 100) / 100
    const zoomFactor = Math.exp(-Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 160) * 0.0018)
    const pending = zoomWheelRaw.current
    const base = pending !== null && Math.abs(roundZoom(pending) - zoomRef.current) < 1e-9 ? pending : zoomRef.current
    const raw = Math.min(Math.max(base * zoomFactor, 0.01), CAMERA_MAX_ZOOM)
    zoomWheelRaw.current = raw
    const nextZoom = Math.max(0.01, roundZoom(raw))
    if (nextZoom === zoomRef.current) return

    const nextPan = {
      x: Math.round(screenX - worldX * nextZoom),
      y: Math.round(screenY - worldY * nextZoom),
    }
    zoomRef.current = nextZoom
    panRef.current = nextPan
    setZoom(nextZoom)
    setPan(nextPan)
  }

  const zoomAtCenter = useCallback((factor: number) => {
    revealNodeRef.current = null
    if (!viewportSize.width || !viewportSize.height) return
    const screenX = viewportSize.width / 2
    const screenY = viewportSize.height / 2
    const currentZoom = zoomRef.current
    const currentPan = panRef.current
    const nextZoom = zoomBy(currentZoom, factor)
    const worldX = (screenX - currentPan.x) / currentZoom
    const worldY = (screenY - currentPan.y) / currentZoom
    const nextPan = { x: screenX - worldX * nextZoom, y: screenY - worldY * nextZoom }
    zoomRef.current = nextZoom
    panRef.current = nextPan
    setZoom(nextZoom)
    setPan(nextPan)
  }, [viewportSize])



  /* 지금 보고 있는 곳 — 화면 가운데 기준. 가운데가 든 SaaS 묶음과 그 안의 포함 테두리를
     바깥부터 적는다. 가운데가 어느 묶음에도 들지 않고 여러 SaaS 가 보이면 보이는 SaaS 로고만
     나란히 둔다(「여러 SaaS」 글자는 로고가 이미 말해 뺐다). 칸에 커서를 올렸을 때의 자리는
     ViewLocationBar 가 따로 계산한다 — 커서가 움직일 때 그래프 전체를 다시 그리지 않게. */
  const viewLocationEnabled = semanticLevel !== 'ecosystem' && viewportSize.width > 0 && viewportSize.height > 0
  const centerLocation = useMemo<ViewLocation | null>(() => {
    if (!viewLocationEnabled) return null
    const rightEdge = viewportSize.width - inspectorRightInset
    const center = {
      x: (rightEdge / 2 - pan.x) / zoom,
      y: ((viewportSize.height + BEACON_INSET.top - BEACON_INSET.bottom) / 2 - pan.y) / zoom,
    }
    const contains = (rect: { x: number; y: number; width: number; height: number }) =>
      center.x >= rect.x && center.x <= rect.x + rect.width && center.y >= rect.y && center.y <= rect.y + rect.height
    const onScreen: string[] = []
    for (const node of projected.nodes) {
      const sx = node.x * zoom + pan.x
      const sy = node.y * zoom + pan.y
      if (sx >= 0 && sx <= rightEdge && sy >= 0 && sy <= viewportSize.height && !onScreen.includes(node.provider)) {
        onScreen.push(node.provider)
      }
    }
    // 여러 SaaS 가 한눈에 보일 만큼 멀면, 가운데가 우연히 든 묶음 하나를 '보는 중' 으로 적지 않는다.
    const centerFrame = clusterFrames.find(contains)
    const zoomedIntoFrame = centerFrame !== undefined && (onScreen.length === 1 ||
      centerFrame.width * zoom >= rightEdge * 0.5 || centerFrame.height * zoom >= viewportSize.height * 0.5)
    const provider = (zoomedIntoFrame ? centerFrame?.provider : undefined) ?? (onScreen.length === 1 ? onScreen[0] : undefined)
    if (!provider) return onScreen.length ? { provider: undefined, providers: sortProviders(onScreen), trail: [] } : null
    const trail = nestFrames
      .filter(frame => frame.provider === provider && contains(frame))
      .sort((a, b) => a.depth - b.depth)
      .map(frame => ({ id: frame.id, label: frame.label, kind: frame.objectType }))
    return { provider, providers: [provider], trail: trail.slice(-3) }
  }, [viewLocationEnabled, viewportSize, inspectorRightInset, pan, zoom, projected.nodes, clusterFrames, nestFrames])

  const focusProvider = useCallback((world: Point) => {
    const nextZoom = Math.max(zoomRef.current, 0.4)
    animateCameraTo(nextZoom, {
      x: viewportSize.width / 2 - world.x * nextZoom,
      y: viewportSize.height / 2 - world.y * nextZoom,
    }, 320)
  }, [animateCameraTo, viewportSize])

  // Selected Entities for Inspector
  const selectedNode = useMemo(() => {
    return projected.nodes.find(n => n.id === selectedSemanticNodeId) || null
  }, [projected.nodes, selectedSemanticNodeId])

  const selectedEdge = useMemo(() => {
    return projected.edges.find(e => e.id === selectedEdgeId) || null
  }, [projected.edges, selectedEdgeId])

  const nodesById = useMemo(() => {
    const map = new Map<string, SemanticNode>()
    for (const node of projected.nodes) {
      const display = transitionNodeState.get(node.id)
      map.set(node.id, display ? { ...node, x: display.x, y: display.y } : node)
    }
    return map
  }, [projected.nodes, transitionNodeState])

  // Effective Access 줄 → 지금 보이는 칸 사이의 선. 같은 칸 쌍의 줄은 하나로 묶는다.
  // 같은 요약 칸 안의 결론은 고리로 남긴다. 화면 밖 항목의 결론만 제외하고 범례에서 센다.
  const eaOverlay = useMemo<EaOverlay>(() => {
    const overlay: EaOverlay = { edges: [], drawnRows: 0, sameNode: 0, hidden: 0 }
    if (!showEffectiveAccess || !eaRows.length) return overlay
    const nodeOf = new Map<string, string>()
    for (const node of projected.nodes) for (const key of node.memberObjectKeys) if (!nodeOf.has(key)) nodeOf.set(key, node.id)
    const pairs = new Map<string, { id: string; sourceNodeId: string; targetNodeId: string; rows: EffectiveAccessRow[] }>()
    for (const row of eaRows) {
      const a = nodeOf.get(row.references.source)
      const b = nodeOf.get(row.references.target)
      if (!a || !b) {
        overlay.hidden += 1
        continue
      }
      if (a === b) overlay.sameNode += 1
      const id = `ea:${a}->${b}`
      const pair = pairs.get(id) ?? { id, sourceNodeId: a, targetNodeId: b, rows: [] }
      pair.rows.push(row)
      pairs.set(id, pair)
      overlay.drawnRows += 1
    }
    overlay.edges = [...pairs.values()].map(pair => ({
      ...pair,
      // 하나라도 판정 보류면 점선
      settled: pair.rows.every(row => row.level !== 'indeterminate'),
    }))
    return overlay
  }, [showEffectiveAccess, eaRows, projected.nodes])

  const membershipHubIds = useMemo(() => {
    // 포함 테두리가 있으면 멀리서 이름표를 다는 칸은 테두리의 주인이다. 이름표는 화면에서
    // 늘 같은 크기(약 104x22px)라, 큰 테두리부터 달고 이미 단 이름표와 겹치면 건너뛴다.
    if (nestFrames.length) {
      const nodes = new Map(projected.nodes.map(node => [node.id, node]))
      const placed: Array<{ x: number; y: number }> = []
      const chosen = new Set<string>()
      for (const frame of [...nestFrames].sort((a, b) => b.width * b.height - a.width * a.height || a.id.localeCompare(b.id))) {
        const node = nodes.get(frame.id)
        if (!node) continue
        const x = node.x * zoom
        const y = node.y * zoom
        if (placed.some(other => Math.abs(other.x - x) < 140 && Math.abs(other.y - y) < 26)) continue
        placed.push({ x, y })
        chosen.add(frame.id)
      }
      return chosen
    }
    const memberCount = new Map<string, number>()
    for (const edge of projected.edges) {
      if (!edge.relationTypes.some(type => type === 'member_of' || type === 'contained_in')) continue
      memberCount.set(edge.targetSemanticNodeId, (memberCount.get(edge.targetSemanticNodeId) ?? 0) + 1)
    }
    const nodes = new Map(projected.nodes.map(node => [node.id, node]))
    const byProvider = new Map<string, Array<[string, number]>>()
    for (const entry of memberCount.entries()) {
      const provider = nodes.get(entry[0])?.provider
      if (!provider || entry[1] < 3) continue
      byProvider.set(provider, [...(byProvider.get(provider) ?? []), entry])
    }
    return new Set([...byProvider.values()].flatMap(entries => entries
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([id]) => id)))
  }, [projected.edges, projected.nodes, nestFrames, zoom])

  /* 멀리서 본 SaaS 이름표(「Okta 37」)를 앉힐 윗부분 높이(월드).
     이름표는 화면에서 24px로 고정인데 묶음 테두리 윗부분 여백(CLUSTER_HEADER, 월드 58)은
     배율을 따라 줄어, 0.2에서 12px 남짓이라 이름표가 맨 윗줄 칸을 덮었다. 이름표가
     보이는 배율(0.42 아래)에서는 테두리 윗부분을 이름표 높이 + 위아래 6px(화면 36px)만큼
     위로 늘려 그린다. 바로 위 묶음과의 틈보다는 늘리지 않는다(아주 작게 축소하면 이름표가
     윗줄 칸에 조금 걸칠 수 있다). 칸 자리와 화면 맞춤 계산은 그대로다. */
  const clusterLabelStrips = useMemo(() => {
    const strips = new Map<string, number>()
    const scale = Math.max(zoom, CAMERA_MIN_ZOOM)
    const wanted = semanticLevel !== 'ecosystem' && zoom < CLUSTER_LABEL_ZOOM ? Math.max(CLUSTER_HEADER, 36 / scale) : CLUSTER_HEADER
    for (const frame of clusterFrames) {
      const gapAbove = Math.min(Infinity, ...clusterFrames
        .filter(other => other !== frame && other.x < frame.x + frame.width && frame.x < other.x + other.width &&
          other.y + other.height <= frame.y)
        .map(other => frame.y - (other.y + other.height)))
      strips.set(frame.provider, Math.max(CLUSTER_HEADER, Math.min(wanted, CLUSTER_HEADER + gapAbove - 6 / scale)))
    }
    return strips
  }, [clusterFrames, zoom, semanticLevel])
  const clusterLabelStrip = (provider: string) => clusterLabelStrips.get(provider) ?? CLUSTER_HEADER
  /* 멀리서 본 SaaS 묶음 이름표 중 그릴 것. 축소하면 묶음 테두리는 작아지는데 이름표는 화면에서 같은 크기라,
     아주 작게 줄이면 이름표끼리 포개져 글자가 겹쳤다. 먼저 놓인 이름표와 겹치는 이름표는 그리지 않는다
     (화면 맞춤이나 확대로 묶음이 커지면 다시 보인다). 폭은 그림 15px, 틈, 안쪽 여백에 이름과 개수 글자 폭이다. */
  const visibleClusterLabels = useMemo(() => {
    if (semanticLevel === 'ecosystem' || zoom >= CLUSTER_LABEL_ZOOM) return []
    const placed: Array<{ left: number; top: number; right: number; bottom: number }> = []
    return clusterFrames.filter(frame => {
      const left = frame.x * zoom + pan.x + 6
      const top = (frame.y + CLUSTER_HEADER - (clusterLabelStrips.get(frame.provider) ?? CLUSTER_HEADER)) * zoom + pan.y + 6
      const width = 46 + measureLabel(frame.label, 12) * 1.08 + measureLabel(String(frame.count), 12)
      const rect = { left, top, right: left + width, bottom: top + 26 }
      if (placed.some(p => rect.left < p.right + 4 && p.left < rect.right + 4 && rect.top < p.bottom + 4 && p.top < rect.bottom + 4)) return false
      placed.push(rect)
      return true
    })
  }, [clusterFrames, clusterLabelStrips, zoom, pan, semanticLevel])

  /* 칸 모드에서 칸 안에 이름을 다 적었는가. 테두리 제목 줄은 이름을 다 적는다. 다 적었으면 커서 이름표를 띄우지 않는다 */
  /* 개별 객체 원 아래 이름. 화면 글자 크기를 대략 일정하게 두되 배치가 자리 폭을 잰 크기(OBJECT_CIRCLE_LABEL)보다 키우지 않고,
     자리 폭(leafSlotWidth)을 넘으면 가운데를 줄인다 */
  const leafLabel = (node: SemanticNode) => {
    const size = Math.min(OBJECT_CIRCLE_LABEL, Math.max(OBJECT_LABEL_MIN_SIZE, OBJECT_LABEL_TARGET_SCREEN_PX / Math.max(zoom, CAMERA_MIN_ZOOM)))
    return { size, text: fitLabelMiddle(objectNames.get(node.id) ?? node.label, leafSlotWidth(node.label), size) }
  }
  const chipShowsFullName = (node: SemanticNode) => nestFrameById.has(node.id) || leafLabel(node).text === node.label

  const drillDownNode = useCallback((node: SemanticNode) => {
    pushHistory()
    if (node.level === 'ecosystem') {
      setSemanticLevel('tenant')
      setSelectedSemanticNodeId(null)
      setSelectedObjectKey(null)
    } else if (node.level === 'tenant') {
      setSemanticLevel('scope')
      setSelectedSemanticNodeId(null)
      setSelectedObjectKey(null)
    } else if (node.level === 'scope') {
      setSemanticLevel('object')
      const targetKey = node.scopeAnchorObjectKey || node.memberObjectKeys[0] || ''
      setFocusObjectKey(targetKey)
      setSelectedObjectKey(targetKey)
      setExpandedObjectKeys(prev => [...new Set([...prev, ...node.memberObjectKeys])])
      setSelectedSemanticNodeId(targetKey || null)
    }
  }, [pushHistory])

  const activateNode = (node: SemanticNode) => {
    if (selectedSemanticNodeId !== node.id) {
      pushHistory()
    }
    revealNodeRef.current = null
    setSelectionNotice('')
    setSelectedSemanticNodeId(node.id)
    setSelectedObjectKey(node.memberObjectKeys[0] ?? node.id)
    setSelectedEdgeId(null)
    setSelectedEaRowIds(null)
    showDetail()
  }

  const revealNode = (node: SemanticNode) => {
    activateNode(node)
    revealNodeRef.current = node.id
    setInvestigationOpen(false)
    const scale = Math.max(zoomRef.current, 0.8)
    const right = !evidenceMode ? (viewportSize.width >= 720 ? (sideOpen ? 0 : sideWidth - SIDE_RAIL_WIDTH) + FIT_INSET_EDGE : 100) : FIT_INSET_EDGE
    const bottom = viewportSize.width < 720 ? viewportSize.height * 0.48 + FIT_INSET_EDGE : FIT_INSET_BOTTOM
    animateCameraTo(scale, {
      x: Math.max(80, (viewportSize.width - right) / 2) - node.x * scale,
      y: Math.max(toolbarBottom + 64, (toolbarBottom + 48 + viewportSize.height - bottom) / 2) - node.y * scale,
    })
  }

  const revealObject = (key: string) => {
    pushHistory()
    setSemanticLevel('object')
    setSelectedObjectKey(key)
    setSelectedEdgeId(null)
    setSelectedEaRowIds(null)
    setInvestigationOpen(false)
    showDetail()
    const node = projected.nodes.find(item => item.memberObjectKeys.includes(key) && item.level === 'object')
    if (node) revealNode(node)
    else {
      revealNodeRef.current = key
      setSelectedProviders(new Set(GRAPH_PROVIDERS))
      setSelectedSemanticNodeId(key)
      if (!showAllObjects) {
        setExpandedObjectKeys(prev => prev.includes(key) ? prev : [...prev, key])
      }
    }
  }

  const targetNodes = projected.nodes.filter(node => selectedSemanticNodeId === node.id ||
    selectedEdge?.sourceSemanticNodeId === node.id || selectedEdge?.targetSemanticNodeId === node.id ||
    (showFindingEvidence && selectedFindingIds.length > 0 && (node.selectedFindingCount ?? 0) > 0) ||
    node.memberObjectKeys.some(key => queryObjectKeys.includes(key) || activePath?.objects.includes(key)))

  const pathName = (key: string) => {
    const object = currentGraph.objectsByKey.get(key)
    return object ? objectDisplayName(object) : key
  }

  /* Effective Access 결론을 상세 패널에 연다. 선이 꺼져 있으면 켠다 */
  const openEffectiveAccess = (rowIds: string[]) => {
    if (!rowIds.length) return
    setShowEffectiveAccess(true)
    setSelectedEaRowIds(rowIds)
    setSelectedSemanticNodeId(null)
    setSelectedEdgeId(null)
    showDetail()
  }
  const selectedEaRows = useMemo(() => selectedEaRowIds?.length
    ? eaRows.filter(row => selectedEaRowIds.includes(row.id)) : null, [selectedEaRowIds, eaRows])
  useEffect(() => { if (selectedEdgeId || selectedEaRowIds?.length) setSelectionNotice('') }, [selectedEdgeId, selectedEaRowIds])

  const askGraphSelection = () => {
    if (!assistantBridge) return
    const keys = selectedNode?.memberObjectKeys ?? []
    if (keys.length > SELECTION_LIMIT) { setSelectionNotice(`객체 ${keys.length}개 포함, 보기 단위를 바꿔 ${SELECTION_LIMIT}개 이하로 축소 필요`); return }
    const selection: AssistantSelection = { ...emptySelection(), objectKeys: keys,
      relationKeys: (selectedEdge?.relationKeys ?? []).slice(0, SELECTION_LIMIT),
      linkIds: (selectedEdge?.resolutionIds ?? []).slice(0, SELECTION_LIMIT), eaRowIds: (selectedEaRowIds ?? []).slice(0, SELECTION_LIMIT),
    }
    const hasSelection = Object.values(selection).some(keys => keys.length > 0)
    if (!hasSelection) { assistantBridge.ask(); return }
    assistantBridge.ask(selection, selection.eaRowIds.length ? '선택한 Effective Access 결과의 근거와 한계, 점검할 조치를 설명해줘.' : '선택한 객체와 연결의 구조, 권한상 위험과 확인할 사항을 설명해줘.')
  }

  const focusOnObject = (key: string) => {
    revealNodeRef.current = null
    if (!key || !currentGraph.objectsByKey.has(key)) return
    pushHistory()
    setFocusObjectKey(key)
    setTargetObjectKey('')
    setExpandedObjectKeys([])
    setQueryObjectKeys([])
    setQueryRelationKeys([])
    setQueryLinkIds([])
    setQueryPath(null)
    setQueryExecuted(false)
    setShowAllObjects(false)
    setSemanticLevel('object')
    setSelectedSemanticNodeId(key)
    setSelectedObjectKey(key)
  }

  const returnToAllObjects = () => {
    pushHistory()
    revealNodeRef.current = null
    setFocusObjectKey('')
    setTargetObjectKey('')
    setExpandedObjectKeys([])
    setQueryObjectKeys([])
    setQueryRelationKeys([])
    setQueryLinkIds([])
    setQueryPath(null)
    setQueryExecuted(false)
    setShowAllObjects(true)
    setSelectedSemanticNodeId(null)
    setSelectedObjectKey(null)
    setSelectedEdgeId(null)
    setSelectedEaRowIds(null)
    // 전체 객체만 보도록 오른쪽 패널(탐지 결과, 상세)과 검색 패널을 접는다
    setSideOpen(false)
    setInvestigationOpen(false)
  }

  /* 범례 자리. 전에는 캔버스 오른쪽 아래에 떠 있어 그래프와 겹쳤다. 화면 맞춤은 위쪽을 도구 막대 몫으로
     비워 두므로, 도구 막대 오른쪽 같은 줄에 두면 그래프와 겹치지 않는다. 상세 패널이 열리면 패널 왼쪽으로
     비키고, 막대 옆에 범례 폭만큼 자리가 없으면 막대 아래 줄(「현재 위치」 줄의 오른쪽)로 내린다.
     그러면 「현재 위치」 줄이 너무 좁아지는 화면(탐지 결과와 상세 패널을 같이 연 1280px)에서는 그 아래 줄로 내린다.
     패널 왼쪽에 들어갈 자리조차 없으면 전처럼 캔버스 오른쪽에 둔다 */
  const legendBesideInspector = inspectorFloating && viewportSize.width - INSPECTOR_FLOAT_WIDTH - INSPECTOR_FLOAT_RIGHT - LEGEND_GAP - legendWidth >= LEGEND_EDGE
  const legendRight = legendBesideInspector ? INSPECTOR_FLOAT_WIDTH + INSPECTOR_FLOAT_RIGHT + LEGEND_GAP : LEGEND_EDGE
  const legendBelowToolbar = !evidenceMode && legendWidth > 0 && toolbarRight + LEGEND_GAP + legendWidth > viewportSize.width - legendRight
  const legendBelowLocation = legendBelowToolbar && viewportSize.width - LEGEND_EDGE - (legendRight + legendWidth + LEGEND_GAP) < VIEW_LOCATION_MIN
  /* 범례가 「현재 위치」 줄로 내려오면 그 줄은 범례 왼쪽까지만 쓴다 */
  const viewLocationReserve = legendBelowToolbar && !legendBelowLocation ? legendRight + legendWidth + LEGEND_GAP : 0
  const saasQueryNormalized = saasSearchQuery.trim().toLowerCase()
  const filteredProviders = GRAPH_PROVIDERS.filter(p => {
    if (!saasQueryNormalized) return true
    const display = providerName(p).toLowerCase()
    return p.includes(saasQueryNormalized) || display.includes(saasQueryNormalized)
  })
  const saasButtonLabel = selectedProviders.size === GRAPH_PROVIDERS.length
    ? `전체 SaaS (${GRAPH_PROVIDERS.length})`
    : selectedProviders.size === 0
      ? 'SaaS 선택 없음'
      : selectedProviders.size === 1
        ? providerName([...selectedProviders][0])
        : `SaaS ${selectedProviders.size}개 선택`

  /* 상세 패널의 「경로 시작」, 「경로 도착」. 전에는 두 대상 사이 경로를 보려면 검색 패널의 조건을 열어 13번쯤 눌러야 했다.
     기준 객체(시작)와 도착을 정하면 그 사이 구조 경로를 선택 경로로 강조한다 */
  const setPathEnd = (objectKey: string, end: 'start' | 'end') => {
    pushHistory()
    setQueryPath(null)
    if (end === 'start') setFocusObjectKey(objectKey)
    else setTargetObjectKey(objectKey)
    const start = end === 'start' ? objectKey : focusObjectKey
    const finish = end === 'end' ? objectKey : targetObjectKey
    const name = (key: string) => objectDisplayName(currentGraph.objectsByKey.get(key)!)
    if (start && finish && start !== finish) {
      const found = findInvestigationPath(currentGraph, start, finish, { maxHops: pathMaxHops, directed: pathDirected, includeIdentityLinks })
      setSelectionNotice(found ? `${name(start)}에서 ${name(finish)}까지 경로 ${found.steps.length}홉` : `${pathMaxHops}홉 안에 경로 없음`)
    } else {
      setSelectionNotice(end === 'start' ? `경로 시작: ${name(objectKey)}` : `경로 도착: ${name(objectKey)}`)
    }
    window.setTimeout(() => setSelectionNotice(''), 3200)
  }

  /* 선택한 칸, 선, Effective Access 결과의 상세. 근거 그래프에서는 캔버스 위에 뜨고, 그 밖에서는 오른쪽 패널의 상세 탭이다 */
  const inspectorPanel = !inspectorOpen ? null : focusedFinding && !(selectedSemanticNodeId || selectedEdgeId || selectedEaRowIds?.length) ? (
      <FindingSummary finding={focusedFinding} onClose={() => setFocusedFindingId(null)} onOpenThreat={onOpenThreat} />
  ) : (
      <SemanticInspector
        onDrillDownLevel={drillDownNode}
        onExpandNeighbors={handleExpandNeighbors}
        hasNeighbors={hasNeighbors}
        onPathEnd={evidenceMode ? undefined : setPathEnd}
        pathEnds={{ start: focusObjectKey, end: targetObjectKey }}
        remainingCandidateCount={remainingCandidateCount}
        evidenceOnly={evidenceMode}
        belowToolbar={evidenceMode && toolbarRight + INSPECTOR_TOOLBAR_GAP > viewportSize.width - INSPECTOR_FLOAT_WIDTH - INSPECTOR_FLOAT_RIGHT}
        eventEvidence={eventMatches && selectedNode ? eventsForObjects(eventMatches.byObject, selectedNode.memberObjectKeys) : undefined}
        onOpenEvent={onOpenEvent} onAskEvent={onAskEvent}
        selectedNode={selectedNode}
        selectedEdge={selectedEdge}
        selectedEaRows={selectedEaRows}
        eaRows={eaRows}
        visibleEdges={projected.edges}
        nodesById={nodesById}
        onSelectEdge={edgeId => {
          setSelectedEdgeId(edgeId)
          setSelectedSemanticNodeId(null)
          setSelectedEaRowIds(null)
        }}
        onOpenEa={openEffectiveAccess}
        onOpenBlastRadius={onOpenBlastRadius}
        sourceNode={selectedEdge ? nodesById.get(selectedEdge.sourceSemanticNodeId) ?? null : null}
        targetNode={selectedEdge ? nodesById.get(selectedEdge.targetSemanticNodeId) ?? null : null}
        activeGraph={currentGraph}
        currentLevel={semanticLevel}
        onClose={() => {
          revealNodeRef.current = null
          setSelectedSemanticNodeId(null)
          setSelectedEdgeId(null)
          setSelectedEaRowIds(null)
        }}
        v2Findings={inspectorFindings ?? findings}
        onOpenThreat={findingId => onOpenThreat?.(findingId)}
        onDrillToEvidence={key => {
          if (evidenceMode) { setSelectedSemanticNodeId(key); setSelectedEdgeId(null); return }
          setSemanticLevel('object')
          setFocusObjectKey(key)
          setSelectedSemanticNodeId(key)
          setSelectedEdgeId(null)
          setSelectedEaRowIds(null)
          setShowAllObjects(false)
        }}
        onOpenExplorer={onOpenExplorer}
        onOpenEvents={onOpenEvents}
        collection={evidenceMode ? undefined : collection}
        onAskSelection={!evidenceMode && assistantBridge ? askGraphSelection : undefined}
      />
  )

  return (
    <div className={`unified-full-graph-root${evidenceMode ? ' evidence-graph' : ''}`} aria-label={evidenceMode ? '답변 근거 그래프' : undefined}>
      {/* Top Header */}
      <header className="full-graph-top-header">
        {!evidenceMode && <div className="fg-header-title-area">
          <h1 className="fg-page-title">Cross-SaaS Graph</h1>
        </div>}

        {/* Filters */}
        <div className="fg-header-controls">
          <button
            type="button"
            className="fg-fit-view-btn"
            onClick={() => { entryZoomFloor.current = 0; fitToView(true) }}
            title="화면 맞춤"
          >
            화면 맞춤 <Maximize2 size={13} strokeWidth={2} className="fg-inline-icon" />
          </button>
          <div className="fg-camera-controls" aria-label="Graph zoom controls">
            <button type="button" onClick={() => zoomAtCenter(0.72)} title="축소" aria-label="축소"><Minus size={15}/></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => zoomAtCenter(1.4)} title="확대" aria-label="확대"><Plus size={15}/></button>
          </div>
        </div>
      </header>

      {/* 본문: 왼쪽 캔버스 영역 + 오른쪽에 도킹된 Findings 패널.
          줌 바와 인스펙터는 캔버스 영역을 기준으로 떠 있다. */}
      <div className="fg-graph-body">
      <aside hidden={!investigationOpen} className="gx-investigation-toolbar gx-query-dock" aria-label="검색, 경로 패널">
        <div className="gx-query-head"><span><strong>검색, 경로</strong></span>
          <button type="button" onClick={() => setInvestigationOpen(false)}>접기</button></div>
        <GraphQueryPanel
          graph={currentGraph}
          effectiveAccess={effectiveAccess}
          onSelectObject={revealObject}
          showHeading={false}
          focused={!showAllObjects}
          onFocusScope={() => setShowAllObjects(value => !value)}
          onQuery={({ objectKeys, relationKeys, linkIds, path, isNameSearch }) => {
            pushHistory()
            setQueryRelationKeys(relationKeys)
            setQueryLinkIds(linkIds)
            setQueryPath(path ?? null)
            /* 이름 검색은 결과를 왼쪽 목록에만 두고 그래프를 좁히지 않는다. 「맞는 구조 없음」이 결과와 같이 뜨지 않게 구조 검색으로 세지 않는다 */
            setQueryExecuted(!isNameSearch)
            if (isNameSearch) {
              setQueryObjectKeys([])
            } else {
              setQueryObjectKeys(objectKeys)
              if (objectKeys.length) setSemanticLevel('object')
            }
          }}
          onReset={() => {
            pushHistory()
            setQueryObjectKeys([]); setQueryRelationKeys([]); setQueryLinkIds([]); setQueryPath(null)
            setQueryExecuted(false); setShowAllObjects(true)
          }}
        />
        {queryExecuted && <div className="gx-query-hint" role="status">
          {queryObjectKeys.length ? `검색 결과: 객체 ${queryObjectKeys.length}개` :
            '맞는 구조 없음. 수집이 끝나지 않았다면 실제로 없다는 뜻은 아님'}
        </div>}
        {activePath && <details className="gx-path-summary">
          <summary>구조 경로 자세히</summary>
          <ol>
            {activePath.steps.map((step, index) => <li key={`${step.edgeId}-${index}`}>
              <span title={step.from}>{pathName(step.from)}</span>
              <b>{step.kind === 'identity_link' ? '동일인 연결' : `${step.forward === false ? '←' : '→'} ${relationLabel(step.relationType || '')}`}</b>
              <span title={step.to}>{pathName(step.to)}</span>
            </li>)}
          </ol>
          <small>구조 경로는 실제 접근 권한, 관측된 활동, 공격 성공의 증적이 아님</small>
        </details>}
      </aside>
      <div className="fg-canvas-area">
        {currentGraph.objectsByKey.size === 0 && (
          <div className="gx-empty-overlay">
            <div className="gx-empty-card" role="region" aria-label="빈 데이터셋 안내">
              <h2>아직 수집한 데이터가 없습니다</h2>
              <p>SaaS 를 연결하고 수집하면 그래프가 그려집니다.</p>
              <div className="gx-empty-card-actions">
                <button
                  type="button"
                  className="gx-empty-btn primary"
                  onClick={() => {
                    window.location.hash = '#adapters'
                    onOpenAdapters?.()
                  }}
                >
                  SaaS 연결하기
                </button>
                {hasLocalServer() && (
                  <button
                    type="button"
                    className="gx-empty-btn"
                    disabled={sampleLoading}
                    onClick={async () => {
                      setSampleLoading(true)
                      setSampleError('')
                      try {
                        const res = await fetch('/__aegi/sample', {
                          method: 'POST',
                          credentials: 'same-origin',
                        })
                        if (res.ok) {
                          window.location.reload()
                        } else {
                          setSampleError('샘플을 올리지 못했습니다')
                        }
                      } catch {
                        setSampleError('샘플을 올리지 못했습니다')
                      } finally {
                        setSampleLoading(false)
                      }
                    }}
                  >
                    샘플로 둘러보기
                  </button>
                )}
              </div>
              {sampleError && (
                <p className="gx-empty-error" role="alert">
                  {sampleError}
                </p>
              )}
            </div>
          </div>
        )}
      {!evidenceMode && (assistantBridge ? !assistantBridge.isOpen : assistantContext && !assistantOpen) && <AiLauncher graph
        selected={!!(selectedNode || selectedEdge || selectedEaRowIds?.length)}
        onClick={assistantBridge ? askGraphSelection : () => { setAssistantOpen(true); setSideOpen(false); setInvestigationOpen(false) }} />}
      {!evidenceMode && <div ref={toolbarRef} className="gx-graph-toolbar" aria-label="Graph controls">
        <div className="gx-control-menu gx-slider-menu">
          <span className="gx-slider-kicker">보기 단위</span>
          <SemanticZoomSlider
            currentLevel={semanticLevel}
            onChangeLevel={changeSemanticLevel}
          />
        </div>

        <div className="gx-control-menu gx-saas-filter-menu" ref={saasFilterMenuRef}>
          <button
            type="button"
            className={saasFilterMenuOpen ? 'active' : ''}
            aria-label="SaaS 필터"
            aria-expanded={saasFilterMenuOpen}
            onClick={() => { setSaasFilterMenuOpen(value => !value); setRelationMenuOpen(false) }}
          >
            <b className="gx-saas-btn-value">
              {selectedProviders.size === 1 && (() => {
                const only = [...selectedProviders][0]
                return <span className="gx-saas-btn-logo" aria-hidden="true"><ProviderLogo provider={providerLogoId(only)} /></span>
              })()}
              {saasButtonLabel}
            </b>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {saasFilterMenuOpen && <div className="gx-control-popover saas gx-lens-checklist" role="group" aria-label="SaaS 고르기">
            <div className="gx-saas-search">
              <Search size={13} aria-hidden="true" />
              <input
                type="search"
                value={saasSearchQuery}
                onChange={e => setSaasSearchQuery(e.target.value)}
                placeholder="SaaS 검색"
                aria-label="SaaS 검색"
              />
            </div>
            {!saasQueryNormalized && (
              <label className="gx-lens-option gx-lens-all" data-provider="all">
                <input
                  type="checkbox"
                  checked={selectedProviders.size === GRAPH_PROVIDERS.length}
                  ref={el => {
                    if (el) el.indeterminate = selectedProviders.size > 0 && selectedProviders.size < GRAPH_PROVIDERS.length
                  }}
                  onChange={e => setSelectedProviders(new Set(e.target.checked ? GRAPH_PROVIDERS : []))}
                />
                <span>전체 SaaS ({GRAPH_PROVIDERS.length})</span>
                <em className="gx-lens-count">{currentGraph.objectsByKey.size}</em>
              </label>
            )}
            {filteredProviders.map(provider => {
              const count = currentGraph.objectsByProvider.get(provider)?.length ?? 0
              return (
                <label key={provider} className="gx-lens-option gx-saas-option" data-provider={provider}>
                  <input
                    type="checkbox"
                    checked={selectedProviders.has(provider)}
                    onChange={() => toggleProvider(provider)}
                  />
                  <span>
                    <i className="gx-saas-option-logo" aria-hidden="true">
                      <ProviderLogo provider={providerLogoId(provider)} />
                    </i>
                    {providerName(provider)}
                  </span>
                  <em className="gx-lens-count">{count}</em>
                </label>
              )
            })}
            {filteredProviders.length === 0 && (
              <div className="gx-saas-empty">일치하는 SaaS 없음</div>
            )}
          </div>}
        </div>

        <div className="gx-control-menu gx-relation-menu" ref={relationMenuRef}>
          <button type="button" className={relationMenuOpen ? 'active' : ''} aria-expanded={relationMenuOpen}
            onClick={() => { setRelationMenuOpen(value => !value); setSaasFilterMenuOpen(false) }}>
            <span>관계선</span><b>{relationLensSummary(relationLenses)}{!includeIdentityLinks ? ', 동일인 제외' : ''}{showEffectiveAccess && eaRows.length ? ' + EA' : ''}</b><ChevronDown size={13} aria-hidden="true" />
          </button>
          {/* 칸마다 체크박스, 이름, 이 화면의 관계 수만 한 줄로 둔다. 뜻, 종류별 수, 테두리로 대신한 수는
              커서를 올리거나 키보드로 옮겨 가면 메뉴 오른쪽 설명 칸(lensDetail)에 뜬다. 전에는 칸마다 서너 줄이라 메뉴가 길었다 */}
          {relationMenuOpen && <div className="gx-control-popover relation gx-lens-checklist" role="group" aria-label="관계선 고르기"
            onMouseLeave={() => setLensHover(null)}>
            <label className="gx-lens-option gx-lens-all" {...lensHoverProps('all')}>
              <input
                type="checkbox"
                checked={allRelationViewsSelected(relationLenses)}
                ref={el => {
                  if (el) el.indeterminate = !relationLenses.has('flow') && relationLenses.size > 0 && !allRelationViewsSelected(relationLenses)
                }}
                onChange={e => setRelationLenses(new Set(e.target.checked ? RELATION_VIEW_GROUPS : []))}
              />
              <span><i className="gx-lens-swatch relation" aria-hidden="true" />{RELATION_LENS_LABELS.all}</span>
              {lensCount(lensCounts.total, lensTotals.total)}
            </label>
            {/* 스키마의 세 보기 묶음. 서로 겹치지 않는다 */}
            {RELATION_VIEW_GROUPS.map(lens => (
              <label key={lens} className="gx-lens-option" {...lensHoverProps(lens)}>
                <input type="checkbox" checked={relationLenses.has(lens)} onChange={() => toggleRelationLens(lens)} />
                <span><i className="gx-lens-swatch relation" aria-hidden="true" />{RELATION_LENS_LABELS[lens]}</span>
                {lensCount(lensCounts.groups[lens].total, lensTotals.groups[lens])}
              </label>
            ))}
            {/* 동일인 연결 옵션 */}
            <label className="gx-lens-option gx-lens-identity" {...lensHoverProps('identity')}>
              <input
                type="checkbox"
                checked={includeIdentityLinks}
                onChange={e => setIncludeIdentityLinks(e.target.checked)}
              />
              <span><i className="gx-lens-swatch identity" aria-hidden="true" />동일인 연결</span>
              {lensCount(identityOnScreen, currentGraph.linksById?.size ?? 0)}
            </label>
            {/* 조사 프리셋. 보기 묶음이 아니라 신뢰, 인증의 일부만 골라 보는 것이라 따로 둔다 */}
            <div className="gx-lens-section">조사 프리셋</div>
            <label className="gx-lens-option gx-lens-preset" {...lensHoverProps('flow')}>
              <input type="checkbox" checked={relationLenses.has('flow')}
                onChange={e => setRelationLenses(new Set<RelationLensGroup>(e.target.checked ? ['flow'] : RELATION_VIEW_GROUPS))} />
              <span><i className="gx-lens-swatch relation" aria-hidden="true" />{RELATION_LENS_LABELS.flow}만</span>
              {lensCount(lensCounts.groups.flow.total, lensTotals.groups.flow)}
            </label>
            <label className={`gx-lens-option gx-lens-ea ${eaRows.length ? '' : 'is-disabled'}`} {...lensHoverProps('ea')}>
              <input type="checkbox" checked={showEffectiveAccess && eaRows.length > 0} disabled={!eaRows.length} onChange={e => setShowEffectiveAccess(e.target.checked)} />
              <span><i className="gx-lens-swatch ea" aria-hidden="true" />Effective Access</span>
              {lensCount(eaOnScreen, eaRows.length)}
            </label>
            {lensHover && (() => {
              const detail = lensDetail(lensHover.key)
              return (
                <div id="gx-lens-detail" className="gx-lens-detail" role="tooltip" style={{ top: lensHover.top }}>
                  <b>{detail.title}</b>
                  {detail.lines.map(line => <p key={line}>{line}</p>)}
                </div>
              )
            })()}
          </div>}
        </div>
        <label className="gx-toolbar-check gx-scope-toggle"
          title={showAllObjects
            ? `수집한 객체 ${currentGraph.objectsByKey.size}개 전체 표시. 끄면 선택, 검색 주변만 표시`
            : `조사 범위 객체 ${scopedObjects.size}개만 표시. 켜면 수집한 객체 ${currentGraph.objectsByKey.size}개 전체 표시`}>
          <input type="checkbox" aria-label="Show all objects" checked={showAllObjects} onChange={e => {
            pushHistory()
            setShowAllObjects(e.target.checked)
          }} /> 전체 객체
          {!showAllObjects && (semanticLevel === 'object' || semanticLevel === 'scope') && scopedObjects.size < currentGraph.objectsByKey.size &&
            <small className="gx-scope-count">{scopedObjects.size}/{currentGraph.objectsByKey.size}</small>}
        </label>
        {(platformDefaultsHidden > 0 || showPlatformDefaults()) && (
          <label className="gx-toolbar-check"
            title={showPlatformDefaults() ? '미사용 플랫폼 기본 객체까지 표시. 끄면 숨김' : `미사용 플랫폼 기본 객체 ${platformDefaultsHidden}개 숨김. 켜면 표시`}>
            {/* 데이터는 처음 불러올 때 한 번 거르므로 바꾸면 다시 불러온다 */}
            <input type="checkbox" aria-label="Show unused platform defaults" checked={showPlatformDefaults()} onChange={e => {
              setShowPlatformDefaults(e.target.checked)
              window.location.reload()
            }} /> 기본 객체
          </label>
        )}
        {!showAllObjects && !evidenceMode && (
          <div className="gx-scope-stats" aria-label="조사 범위 통계">
            <span>객체 {projected.nodes.length}개</span>
            <span>연결 {projected.edges.length}개</span>
            {excludedEvidenceCount > 0 && (
              <span className="gx-excluded-warning" title="SaaS나 관계선 필터로 화면에서 빠진 근거">
                필터 제외 근거 {excludedEvidenceCount}개
              </span>
            )}
          </div>
        )}
        <div className="gx-toolbar-actions" aria-label="Graph tools">
        <button type="button" className={`gx-query-toggle ${investigationOpen ? 'active' : ''}`}
          aria-expanded={investigationOpen} onClick={() => { setInvestigationOpen(value => !value); setSideOpen(false) }}>
          <Search size={13} aria-hidden="true" /> 검색, 경로{focusObjectKey ? ' (1)' : ''}
        </button>
        <button type="button" className={`gx-findings-toggle ${sideOpen && sideTab === 'findings' ? 'active' : ''}`}
          aria-expanded={sideOpen && sideTab === 'findings'} onClick={() => {
            const showing = sideOpen && sideTab === 'findings'
            setSideTab('findings'); setSideOpen(!showing); setInvestigationOpen(false)
          }}>
          <ListFilter size={13} aria-hidden="true" /><span>탐지 결과</span><b>{findings.length}</b>
        </button>

        </div>
      </div>

      }


      {/* Graph Canvas */}
      <div
        ref={canvasRef}
        className="unified-graph-canvas"
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={cancelPointerGesture}
        onLostPointerCapture={cancelPointerGesture}
        onWheel={handleWheel}
      >
        {selectionNotice && <div className="assistant-selection-notice" role="status">{selectionNotice}</div>}
        {!evidenceMode && !investigationOpen && (
          <ViewLocationBar
        canGoBack={investigationHistory.length > 0}
        onGoBack={handleGoBack}
        canGoForward={forwardHistory.length > 0}
        onGoForward={handleGoForward}
            narrow={Boolean(inspectorRightInset)}
            canvasWidth={viewportSize.width}
            reserveRight={viewLocationReserve}
            hoverStore={hoverStore}
            center={centerLocation}
            enabled={viewLocationEnabled}
            level={semanticLevel}
            nodesById={nodesById}
            containment={containment}
            graph={currentGraph}
          />
        )}
        {/* 멀리서 본 SaaS 묶음 이름. 묶음 머리글은 월드 크기라 축소하면 글자가 사라진다.
            그럴 때는 화면에서 늘 같은 크기의 이름표를 묶음 왼쪽 위 모서리에 붙인다. */}
        {visibleClusterLabels.map(frame => (
          <button
            type="button"
            key={`cluster-label-${frame.provider}`}
            className={`gx-provider-beacon gx-cluster-label provider-${frame.provider}`}
            data-pan-follow=""
            style={{
              left: frame.x * zoom + pan.x + 6,
              top: (frame.y + CLUSTER_HEADER - clusterLabelStrip(frame.provider)) * zoom + pan.y + 6,
            }}
            onClick={() => focusProvider({ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 })}
            title={`${frame.label}, ${semanticLevel === 'scope' ? '그룹, 리소스' : '항목'} ${frame.count}개 — 누르면 해당 위치로 이동`}
          >
            {/* 이름 옆에 개수만 적는다. 「37개 항목」 두 줄은 이름표를 키우기만 했다. */}
            <ProviderLogo provider={frame.provider === 'gws' ? 'google-workspace' : (frame.provider as ProviderId)} />
            <b>{frame.label}</b>
            <small className="gx-cluster-count">{frame.count}</small>
          </button>
        ))}
        {/* 범례. 위 줄은 선 종류, 아래 줄은 지금 켜진 강조와 그 수. 화면에 없는 것은 적지 않는다 —
            전에는 경로 · 검색이 없어도 「선택 경로」 · 「검색 결과」가 늘 떠 있었고, 정작 가장 많은 회색 관계선은 없었다 */}
        {(() => {
          const kinds = [
            legendCounts.relation > 0 && <span key="relation"><i className="relation" /> 관계</span>,
            legendCounts.identity > 0 && <span key="identity"><i className="identity" /> 동일인 연결</span>,
            legendCounts.policy > 0 && <span key="policy"><i className="policy" /> 역할 부여</span>,
            showEffectiveAccess && eaRows.length > 0 && <span key="ea" title={EA_LEGEND_HINT}><i className="ea" /> {eaLegendText(eaOverlay)}</span>,
            nestFrames.length > 0 && zoom >= DOT_ZOOM && <span key="nest"><i className="nest" /> 테두리: 포함, 소속</span>,
          ].filter(Boolean)
          const highlights = [
            legendCounts.finding > 0 && <span key="finding"><i className="finding" /> 탐지 경로 <em>{legendCounts.finding}</em></span>,
            activePath && <span key="path"><i className="path" /> 선택 경로 <em>{activePath.steps.length}홉</em></span>,
            (legendCounts.query > 0 || (queryExecuted && queryObjectKeys.length > 0)) &&
              <span key="query"><i className="query" /> 검색 결과{legendCounts.query > 0 && <> <em>{legendCounts.query}</em></>}</span>,
          ].filter(Boolean)
          if (!kinds.length && !highlights.length) return null
          return (
            <div
              ref={legendRef}
              className={`gx-visual-legend${legendBelowLocation ? ' below-location' : legendBelowToolbar ? ' below-toolbar' : ''}`}
              style={evidenceMode ? undefined : { right: legendRight, ...(showEffectiveAccess ? { top: toolbarBottom + 12, bottom: 'auto', maxWidth: 'min(560px, calc(100% - 200px))' } : {}) }}
              aria-label="그래프 범례"
            >
              {kinds.length > 0 && <div className="gx-legend-row"><b>선</b>{kinds}</div>}
              {highlights.length > 0 && <div className="gx-legend-row"><b>강조</b>{highlights}</div>}
            </div>
          )
        })()}
        {!showAllObjects && semanticLevel === 'object' && scopedObjects.size < currentGraph.objectsByKey.size && (
          <div className="gx-scope-hint">
            <span>
              <b>조사 범위</b> 객체 {currentGraph.objectsByKey.size}개 중 {scopedObjects.size}개
              {focusObjectKey && <small> 기준 {focusObjectKey}</small>}
            </span>
            <button type="button" onClick={returnToAllObjects}>전체 객체 보기</button>
          </div>
        )}
        {!evidenceMode && showAllObjects && semanticLevel === 'object' && selectedNode && selectedNode.memberObjectKeys[0] && (
          <div className="gx-selection-actions">
            <span><b>선택</b><small>{selectedNode.label}</small></span>
            <button type="button" onClick={() => focusOnObject(selectedNode.memberObjectKeys[0])}>연결된 항목 보기</button>
            <button type="button" onClick={() => { setSelectedSemanticNodeId(null); setSelectedEdgeId(null) }}>선택 해제</button>
          </div>
        )}
        <svg
          className="unified-graph-svg"
          data-pan-follow=""
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {/* SVG Definitions for Markers & Filters */}
          <defs>
            <filter id="edge-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#dc2626" floodOpacity="0.6" />
            </filter>
            <filter id="card-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#0f172a" floodOpacity="0.08" />
            </filter>
            {/* 방향 화살표는 marker 가 아니라 선마다 그린다(arrowHead) — marker 는 선 굵기를 따라 커져
                가는 선에서 보이지 않고, 선 색마다 따로 만들어야 했다 */}
          </defs>

          {/* SaaS 묶음. 칸보다 먼저 그려 뒤에 깔린다.
              배율 0.42 아래에서는 화면에 떠 있는 이름표(「Slack 63개 항목」)가 SaaS
              이름을 맡는다. 그때 묶음 머리글(로고 · 이름 · 개수와 구분선)은 읽을 수 없을
              만큼 작아 이름만 두 번 보였으므로 숨기고 테두리만 남긴다. */}
          {clusterFrames.map(frame => (
            <g key={`cluster-${frame.provider}`} className="fg-cluster" style={{ opacity: transitionProgress }}>
              <circle cx={frame.cx} cy={frame.cy} r={frame.r} fill="#ffffff" stroke={`var(--color-provider-${frame.provider})`} strokeWidth={3} />
              {zoom >= CLUSTER_LABEL_ZOOM && <foreignObject
                x={frame.cx - frame.legend / 2}
                y={frame.cy - frame.r - SAAS_LEGEND_H / 2}
                width={frame.legend}
                height={SAAS_LEGEND_H}
              >
                <div className="fg-cluster-head fg-cluster-legend" style={{ borderColor: `var(--color-provider-${frame.provider})` }}>
                  <span className="fg-cluster-logo">
                    <ProviderLogo
                      provider={frame.provider === 'gws' ? 'google-workspace' : (frame.provider as ProviderId)}
                    />
                  </span>
                  <b>{frame.label}</b>
                  <span>
                    {semanticLevel === 'scope' ? '그룹, 리소스' : '항목'} {frame.count}
                  </span>
                </div>
              </foreignObject>}
            </g>
          ))}

          {/* 포함 테두리. 상위 객체는 테두리 맨 위 제목 줄이다(칸 그리기에서 그린다).
              바깥 테두리를 먼저 그려 안쪽이 위에 온다. 끌기가 캔버스로 가도록 누름을 받지 않는다. */}
          {/* 점 모드에서는 그리지 않는다. 제목 줄도 이 배율에서는 동그라미로 그려,
              점보다 큰 빈 상자만 흩어져 보였다. 동그라미는 포함 배치 자리 그대로라
              묶임은 간격으로 보인다. */}
          {zoom >= DOT_ZOOM && nestFrames.map(frame => (
            <g key={`nest-${frame.id}`} className="fg-nest-frame" style={{ opacity: transitionProgress }}>
              <circle cx={frame.cx} cy={frame.cy} r={frame.r} fill="#ffffff"
                stroke={frame.depth === 0 ? NEST_STROKE.outer : NEST_STROKE.inner} strokeWidth={frame.depth === 0 ? 2.6 : 1.8} />
            </g>
          ))}

          {/* Effective Access 선의 커서 자리. 관계선보다 먼저(아래에) 깔아, 겹친 자리에서는 관계선이 누름을 받는다 */}
          {showEffectiveAccess && <EaHitLayer edges={eaOverlay.edges} nodesById={nodesById} zoom={zoom} hoverStore={eaHoverStore} geometry={eaGeometry} onSelect={ea => openEffectiveAccess(ea.rows.map(row => row.id))} />}

          {/* Render Edges */}
          {/* 평소 선은 옅고 가늘게, 커서를 올린 칸 · 고른 칸 · 고른 선 · 커서를 올린 선에 닿은 선만 진하게 그린다.
              전에는 Finding 에 닿는 선이 모두 진한 빨강 + 번짐이라(보이는 선 55개 중 49개) 강조가
              기본 색이 되어 무엇도 강조되지 않았다. Finding 을 고르면 전처럼 그 Finding 선만 진하다.
              진하게 그리는 선에는 끝 쪽에 화살표를 달아 방향(관계의 시작 → 끝)을 보인다. 모든 선에 달면 화면이 어지럽다.
              커서 칸 · 커서 선은 HoverSlot 이 받아 관계선만 다시 그린다(칸은 다시 그리지 않는다). */}
          <HoverSlot store={hoverStore} edgeStore={edgeHoverStore} eaStore={eaHoverStore}>{(hoveredNodeId, hoveredEdgeId, hoveredEaId) => {
          const edgeFocusIds = edgeFocusOf(hoveredNodeId)
          const screenScale = 1 / Math.max(zoom, CAMERA_MIN_ZOOM)
          const pairMap = new Map<string, SemanticEdge[]>()
          for (const e of projected.edges) {
            const f = edgeFlags.get(e.id)
            if (!f || edgeNotDrawn(f)) continue
            const key = [e.sourceSemanticNodeId, e.targetSemanticNodeId].sort().join('::')
            const list = pairMap.get(key) ?? []
            list.push(e)
            pairMap.set(key, list)
          }
          // DOM 순서를 동적으로 재정렬하지 않고 안정적인 키 순서를 유지해 마우스리브/엔터 깜빡임 루프를 차단한다
          return projected.edges.map(edge => {
            const src = nodesById.get(edge.sourceSemanticNodeId)
            const tgt = nodesById.get(edge.targetSemanticNodeId)
            const flags = edgeFlags.get(edge.id)
            if (!src || !tgt || !flags) return null
            // 테두리가 이미 말하는 포함·소속선(메시지 → 채널, 사용자 → 그룹)은 그리지 않는다. 강조될 때만 남긴다.
            if (edgeNotDrawn(flags)) return null
            const {
              isSelected, hasSelectedFinding, hasAnyFinding, isResolution, isPolicyAssignment,
              isDimmed, onPath, onQuery, matchesLens, isLinkHidden,
            } = flags
            const isHovered = hoveredEdgeId === edge.id

            // 이 선이 지금 보는 칸에 닿는가(L1은 선이 적어 늘 진하게 둔다)
            const touchesFocus = edgeFocusIds.has(edge.sourceSemanticNodeId) || edgeFocusIds.has(edge.targetSemanticNodeId)
            const pointed = isHovered || touchesFocus
            const inspecting = Boolean(hoveredEdgeId || hoveredNodeId || hoveredEaId)
            const focused = evidenceMode || (semanticLevel === 'ecosystem' && !inspecting) || isSelected || pointed
            // 고른 Finding 이 없을 때, 보는 칸이 있으면 나머지 선은 더 물러난다
            const faded = !focused && selectedFindingIds.length === 0
            const fadeLevel = (hasAnyFinding ? 0.5 : 0.3) * (inspecting ? 0.35 : 1)

            let strokeColor: string = EDGE_COLORS.relation
            if (hasSelectedFinding) strokeColor = EDGE_COLORS.finding
            else if (onPath) strokeColor = EDGE_COLORS.path
            else if (selectedFindingIds.length === 0 && hasAnyFinding) strokeColor = EDGE_COLORS.finding
            else if (onQuery) strokeColor = EDGE_COLORS.query
            else if (isResolution) strokeColor = EDGE_COLORS.identity
            else if (isPolicyAssignment) strokeColor = EDGE_COLORS.policy
            if (pointed && strokeColor === EDGE_COLORS.relation) strokeColor = 'var(--color-text-primary)'

            const isEcosystem = semanticLevel === 'ecosystem'
            const strokeWidth = evidenceMode ? 2.4 : hasSelectedFinding
              ? 3.4
              : onPath
              ? 3.1
              : hasAnyFinding && faded
              ? 1.6
              : hasAnyFinding
              ? 2.8
              : onQuery
              ? 2.4
              : isSelected || isHovered
              ? 2.4
              : isEcosystem
              ? 2.0
              : isResolution
              ? 1.4
              : isPolicyAssignment
              ? 1.3
              : 1.0

            // 고른 선 · 커서를 올린 선은 다른 강조에 밀려 흐려지지 않는다(상세 패널이 그 선을 말하고 있다)
            const opacity = isLinkHidden ? 0.035
              : isSelected || isHovered ? 1
              : hasSelectedFinding ? 1
              : isDimmed ? 0.1
              : onPath ? 1
              : activePath ? 0.12
              : onQuery ? 0.95
              : queryEdgeKeys.size > 0 ? 0.22
              : !matchesLens ? 0.08
              : faded ? fadeLevel
              : hasAnyFinding ? 0.95
              : isEcosystem
              ? 0.75
              : isPolicyAssignment
              ? 0.75
              : 0.65
            const lowZoomObjects = semanticLevel === 'object' && zoom < DOT_ZOOM
            const baseStrokeWidth = lowZoomObjects ? Math.max(strokeWidth, 0.8 * screenScale) : strokeWidth
            const visibleStrokeWidth = isSelected ? Math.max(baseStrokeWidth * 2.2, 4 * screenScale)
              : pointed ? Math.max(baseStrokeWidth, (isHovered ? 3.2 : 2.6) * screenScale) : baseStrokeWidth
            const visibleOpacity = lowZoomObjects && matchesLens && !isDimmed && !faded
              ? Math.max(opacity, isResolution ? 0.5 : 0.62)
              : opacity
            // 고른 선과 마우스를 올린 선은 번지는 빛 없이 단색으로 굵게 그린다(빛이 겹치면 빨강이 주황, 분홍으로 보였다)
            const glow = !isSelected && !isHovered && !faded && (hasSelectedFinding || (selectedFindingIds.length === 0 && hasAnyFinding))
            const select = (e: ReactMouseEvent) => {
              e.stopPropagation()
              setSelectedEdgeId(edge.id)
              setSelectedSemanticNodeId(null)
              setSelectedEaRowIds(null)
            }

            const inferredIdentity = evidenceMode && isResolution && !['resolved', 'disclosed_relation'].includes(edge.identityLevel ?? '')
            // 동일인 연결은 둥근 점을 고르게 찍은 점선, 역할 부여는 끝이 각진 짧은 대시다.
            // 점은 화면에서 2px 아래로 작아지면 안 보이므로 굵기를 그만큼 받쳐 준다. 추정 연결은 점 사이를 더 띄운다.
            // 위협 선(빨강)은 관계 종류와 상관없이 실선이다. 점선이면 위협 경로가 끊겨 보였다
            const threatLine = strokeColor === EDGE_COLORS.finding
            const lineWidth = isResolution ? Math.max(visibleStrokeWidth, 2 * screenScale) : visibleStrokeWidth
            const dashArray = threatLine ? undefined : isResolution
              ? `0.001 ${lineWidth * (inferredIdentity ? 3.6 : 2.4)}`
              : isPolicyAssignment
                ? `${lineWidth * 4} ${lineWidth * 2.5}`
                : undefined
            const lineCap = isPolicyAssignment && !threatLine ? 'butt' : 'round'

            // Compute curved path for ecosystem L1 level
            if (isEcosystem) {
              const [a, b] = edgeEnds(src, tgt)
              // 같은 두 SaaS 사이 선이 여럿이면 휘는 쪽을 나눈다. 방향이 반대인 선도 같은 기준으로 나누게 이름 순 방향으로 잰다
              const lanes = pairMap.get([edge.sourceSemanticNodeId, edge.targetSemanticNodeId].sort().join('::')) ?? [edge]
              const lane = lanes.indexOf(edge) - (lanes.length - 1) / 2
              const forward = edge.sourceSemanticNodeId <= edge.targetSemanticNodeId
              const { control } = forward ? ecosystemEdgeGeometry(a, b, lane) : ecosystemEdgeGeometry(b, a, lane)
              const pathD = `M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}`
              const arrow = pointed && !isResolution && !isPolicyAssignment ? arrowHead(control, b, 11 * screenScale) : null

              return (
                <g
                  key={edge.id}
                  className={`graph-edge-group l1-edge-group ${isSelected ? 'selected' : ''}${isHovered ? ' is-hovered' : ''}`}
                  data-edge-id={edge.id} role="button" tabIndex={-1} aria-label={`${src.label} 연결 ${tgt.label}`}
                  onFocus={() => edgeHoverStore.set(edge.id)} onBlur={() => edgeHoverStore.clear(edge.id)}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedEdgeId(edge.id); setSelectedSemanticNodeId(null); setSelectedEaRowIds(null) } }}
                  onClick={select}
                  onMouseEnter={() => edgeHoverStore.set(edge.id)}
                  onMouseLeave={() => edgeHoverStore.clear(edge.id)}
                >
                  {pointed && <path className="gx-edge-separator" d={pathD} fill="none" stroke="var(--color-surface)" strokeWidth={visibleStrokeWidth + 4 * screenScale} />}
                  <path
                    className="gx-edge-core"
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={lineWidth}
                    strokeDasharray={dashArray}
                    style={{ strokeLinecap: lineCap }}
                    strokeOpacity={visibleOpacity}
                    filter={glow ? 'url(#edge-glow)' : undefined}
                  />
                  {/* Invisible wider hit area for easy hover/clicking */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14 * screenScale}
                  />
                  {arrow && <polygon points={arrow.points} fill={strokeColor} />}
                </g>
              )
            }

            // 선은 칸 가운데가 아니라 칸 테두리에서 시작하고 끝난다. 전에는 끝이 칸 밑에 숨어
            // 어느 칸에서 나온 선인지 안 보였다. 시작 끝에는 작은 점을 찍는다.
            // 진하게 그리는 선은 끝 쪽에 화살표를 단다. 동일인 연결은 방향이 없고, 역할 부여는 저장된 관계의
            // 방향이 아니라 그림으로 이은 것이라 달지 않는다.
            const [a, b] = edgeEnds(src, tgt)
            const pairKey = [edge.sourceSemanticNodeId, edge.targetSemanticNodeId].sort().join('::')
            const pairEdges = pairMap.get(pairKey) ?? [edge]
            const pairIndex = pairEdges.indexOf(edge)
            const pairTotal = pairEdges.length
            const isCurved = pairTotal > 1 || src.provider !== tgt.provider
            let ctrl: Point | null = null
            if (isCurved) {
              const dx = b.x - a.x
              const dy = b.y - a.y
              const dist = Math.hypot(dx, dy)
              if (dist > 1) {
                const nx = -dy / dist
                const ny = dx / dist
                const sign = edge.sourceSemanticNodeId <= edge.targetSemanticNodeId ? 1 : -1
                const offset = pairTotal > 1
                  ? (pairIndex - (pairTotal - 1) / 2) * (20 * screenScale)
                  : sign * Math.min(64 * screenScale, dist * 0.16)
                ctrl = { x: (a.x + b.x) / 2 + nx * offset, y: (a.y + b.y) / 2 + ny * offset }
              }
            }
            // 끝 점은 선보다 조금 굵은 정도로 작게 둔다. 점선(동일인 연결, 역할 부여)에는 찍지 않는다
            const endDot = isResolution || isPolicyAssignment ? 0 : Math.max(visibleStrokeWidth * 1.05, 2.2 * screenScale)
            const directed = !isResolution && !isPolicyAssignment
            const arrowSize = Math.max(visibleStrokeWidth * 4.6, 14 * screenScale)
            const arrow = directed && !isLinkHidden && (evidenceMode || isSelected || isHovered || touchesFocus || onPath || hasSelectedFinding) &&
              Math.hypot(b.x - a.x, b.y - a.y) > arrowSize * 2.2
              ? arrowHead(ctrl ?? a, b, arrowSize)
              : null
            const lineEnd = arrow ? arrow.neck : b
            const identityLabel = edge.identityLevel === 'different' ? '다른 주체' : edge.identityLevel === 'possibly_related' ? '약한 연관' : inferredIdentity ? '추정' : '확인'
            const hitDx = b.x - a.x
            const hitDy = b.y - a.y
            const hitLen = Math.hypot(hitDx, hitDy)
            const hitInset = Math.min(8 * screenScale, hitLen * 0.25)
            const hitA = hitLen > hitInset * 2 ? { x: a.x + (hitDx / hitLen) * hitInset, y: a.y + (hitDy / hitLen) * hitInset } : a
            const hitB = hitLen > hitInset * 2 ? { x: b.x - (hitDx / hitLen) * hitInset, y: b.y - (hitDy / hitLen) * hitInset } : b

            return (
              <g
                key={edge.id}
                className={`graph-edge-group ${isSelected ? 'selected' : ''}${isHovered ? ' is-hovered' : ''}`}
                data-edge-id={edge.id}
                data-identity-level={edge.identityLevel}
                role="button"
                tabIndex={0}
                aria-label={`${src.label} 연결 ${tgt.label}${isResolution ? `, ${identityLabel}` : ''}`}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedEdgeId(edge.id); setSelectedSemanticNodeId(null) } }}
                onClick={select}
                onFocus={() => edgeHoverStore.set(edge.id)}
                onBlur={() => edgeHoverStore.clear(edge.id)}
                onMouseEnter={() => edgeHoverStore.set(edge.id)}
                onMouseLeave={() => edgeHoverStore.clear(edge.id)}
              >
                {pointed && (ctrl ? <path className="gx-edge-separator" d={`M ${a.x} ${a.y} Q ${ctrl.x} ${ctrl.y} ${b.x} ${b.y}`} fill="none" stroke="var(--color-surface)" strokeWidth={visibleStrokeWidth + 4 * screenScale} style={{ pointerEvents: 'none' }} /> : <line className="gx-edge-separator" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-surface)" strokeWidth={visibleStrokeWidth + 4 * screenScale} style={{ pointerEvents: 'none' }} />)}
                {ctrl ? (
                  <path
                    className="gx-edge-core"
                    d={`M ${a.x} ${a.y} Q ${ctrl.x} ${ctrl.y} ${lineEnd.x} ${lineEnd.y}`}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={lineWidth}
                    strokeDasharray={dashArray}
                    style={{ strokeLinecap: lineCap }}
                    strokeOpacity={visibleOpacity}
                    filter={glow ? 'url(#edge-glow)' : undefined}
                  />
                ) : (
                  <line
                    className="gx-edge-core"
                    x1={a.x}
                    y1={a.y}
                    x2={lineEnd.x}
                    y2={lineEnd.y}
                    stroke={strokeColor}
                    strokeWidth={lineWidth}
                    strokeDasharray={dashArray}
                    style={{ strokeLinecap: lineCap }}
                    strokeOpacity={visibleOpacity}
                    filter={glow ? 'url(#edge-glow)' : undefined}
                  />
                )}
                {endDot > 0 && <circle cx={a.x} cy={a.y} r={endDot} fill={strokeColor} fillOpacity={visibleOpacity} />}
                {arrow
                  ? <polygon points={arrow.points} fill={strokeColor} fillOpacity={visibleOpacity} stroke={strokeColor} strokeOpacity={visibleOpacity} strokeWidth={arrowSize * 0.08} strokeLinejoin="round" />
                  : endDot > 0 && <circle cx={b.x} cy={b.y} r={endDot} fill={strokeColor} fillOpacity={visibleOpacity} />}
                {/* 노드 경계와 겹치지 않도록 안쪽으로 여백을 둔 보이지 않는 간선 호버 영역 */}
                {ctrl ? (
                  <path
                    d={`M ${hitA.x} ${hitA.y} Q ${ctrl.x} ${ctrl.y} ${hitB.x} ${hitB.y}`}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14 * screenScale}
                  />
                ) : (
                  <line
                    x1={hitA.x}
                    y1={hitA.y}
                    x2={hitB.x}
                    y2={hitB.y}
                    stroke="transparent"
                    strokeWidth={14 * screenScale}
                  />
                )}
              </g>
            )
          })
          }}</HoverSlot>

          {/* Effective Access — 저장된 관계가 아니라 계산한 결론이라 파란 빛 · 깜빡임으로 따로 그린다 (EA 규격: 저장 관계와 섞지 않는다).
              선은 관계선 위에 그리지만 누름은 받지 않는다. 커서는 관계선 아래에 깐 EaHitLayer 가 받는다.
              다른 선과 같이 칸 테두리에서 끊는다(edgeEnds) */}
          {showEffectiveAccess && <EaLines edges={eaOverlay.edges} nodesById={nodesById} zoom={zoom} hoverStore={eaHoverStore} nodeStore={hoverStore} edgeStore={edgeHoverStore} geometry={eaGeometry} selectedRowIds={selectedEaRowIds} />}

          {/* 조직, 그룹 단계: SaaS 가운데 원과 그 SaaS 조직이나 그룹으로 가는 가는 선. 칸보다 먼저 그려 뒤에 깔린다 */}
          {projected.hubs.length > 0 && <g className="fg-provider-hubs" style={{ opacity: transitionProgress }}>
            {projected.nodes.map(node => {
              const hub = projected.hubs.find(item => item.provider === node.provider)
              if (!hub) return null
              const dx = node.x - hub.x, dy = node.y - hub.y, d = Math.hypot(dx, dy) || 1
              const r = circleRadius(node)
              const hubR = projected.circle?.hubRadius ?? HUB_RADIUS
              return <line key={`spoke-${node.id}`} x1={hub.x + (dx / d) * hubR} y1={hub.y + (dy / d) * hubR}
                x2={node.x - (dx / d) * r} y2={node.y - (dy / d) * r} stroke="var(--color-border)" strokeWidth={2 / Math.max(zoom, 0.05)} />
            })}
            {projected.hubs.map(hub => <g key={`hub-${hub.provider}`} transform={`translate(${hub.x}, ${hub.y})`}>
              <GraphProviderHub provider={hub.provider} radius={projected.circle?.hubRadius ?? HUB_RADIUS} zoom={zoom} onClick={() => focusProvider({ x: hub.x, y: hub.y })} />
            </g>)}
          </g>}

          {/* Render Nodes */}
          {projected.nodes.map(node => {
            const eventCount = eventMatches ? eventsForObjects(eventMatches.byObject, node.memberObjectKeys).length : 0
            const display = transitionNodeState.get(node.id) || node
            const isSelected = selectedSemanticNodeId === node.id
            const hasSelectedFinding = showFindingEvidence && selectedFindingIds.length > 0 && node.selectedFindingCount && node.selectedFindingCount > 0
            const hasAnyFinding = showFindingEvidence && node.findingCount > 0
            const onPath = node.memberObjectKeys.some(key => activePath?.objects.includes(key))
            const onQuery = node.memberObjectKeys.some(key => queryObjectKeys.includes(key))

            const providerColors: Record<string, string> = {
              slack: 'var(--color-provider-slack)',
              github: 'var(--color-provider-github)',
              okta: 'var(--color-provider-okta)',
              gws: 'var(--color-provider-gws)',
              atlassian: 'var(--color-provider-atlassian)',
              salesforce: 'var(--color-provider-salesforce)',
            }

            const pColor = providerColors[node.provider] || '#2563eb'
            const selectFill = `var(--color-provider-${node.provider}-fill, var(--color-select-fill))`
            // Text keeps full contrast. Only relationship strokes recede behind the investigation.
            const opacity = 1

            if (semanticLevel !== 'object') {
              return (
                <g key={node.id} className={'graph-node-group semantic-card-group ' + (isSelected ? 'selected' : '')}
                  data-provider={node.provider} role="button" tabIndex={isSelected || (!selectedSemanticNodeId && projected.nodes[0]?.id === node.id) ? 0 : -1} aria-label={node.label}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateNode(node) } }}
                  transform={'translate(' + display.x + ', ' + display.y + ')'}
                  onClick={e => { e.stopPropagation(); activateNode(node) }}
                  onFocus={() => hoverStore.set(node.id)} onBlur={() => hoverStore.clear(node.id)}
                  onMouseEnter={() => hoverStore.set(node.id)} onMouseLeave={() => hoverStore.clear(node.id)}
                  style={{ opacity }}>
                  <g className="fg-node-body">
                    <GraphSummaryCard node={node} color={pColor} side={projected.circle?.sides.get(node.id) ?? 'below'} angle={projected.circle?.angles.get(node.id)}
                      selected={isSelected} neighbor={selectedNeighbors.has(node.id)} finding={Boolean(hasSelectedFinding)}
                      showBadge={hasAnyFinding} query={onQuery} path={Boolean(onPath)} zoom={zoom} />
                    <GraphEventBadge count={eventCount} zoom={zoom} x={0} y={-circleRadius(node)} />
                  </g>
                </g>
              )
            }

            // L4(개별 객체): 174칸이 한 화면에 들어가는 자리라 카드를 쓰지
            // 않는다. 한 칸에 허락된 폭이 좁아, 유형을 한 줄 더 적는 대신
            // 그림 하나와 이름 하나만 둔다. 그림은 이게 사람인지 저장소인지
            // 토큰인지를 글자보다 먼저 말한다.
            const isNeighbor = selectedNeighbors.has(node.id) && !isSelected
            const strokeColor = hasSelectedFinding ? '#b42318' : onQuery ? 'var(--color-graph-query)' : onPath ? EDGE_COLORS.path : isSelected ? 'var(--color-select)' : isNeighbor ? 'var(--color-text-primary)' : pColor
            if (zoom < DOT_ZOOM) {
              // 멀리서도 이게 사람인지 채널인지 저장소인지 보이게, 흰 동그라미에 SaaS 색
              // 테두리를 두르고 그 안에 칸에서 쓰는 것과 같은 종류 그림을 SaaS 색으로 넣는다.
              // (색 동그라미에 흰 그림은 그림이 가늘어 잘 안 보였다.) 그림을 못 그릴 만큼
              // 작으면 전처럼 색으로 채운 점이다.
              const radius = dotRadius(zoom)
              const membershipHub = membershipHubIds.has(node.id)
              const screenScale = 1 / Math.max(zoom, CAMERA_MIN_ZOOM)
              const dotR = membershipHub ? radius + 2 * screenScale : radius
              const DotGlyph = objectGlyph(node.objectType, node.interfaces)
              const glyphSize = dotR * 1.28
              const showGlyph = dotR * Math.max(zoom, CAMERA_MIN_ZOOM) >= DOT_GLYPH_MIN_SCREEN_RADIUS
              return (
                <g key={node.id} className={`graph-node-group graph-node-dot${isSelected ? ' selected' : ''}${selectedNeighbors.has(node.id) ? ' is-neighbor' : ''}`} data-object-key={node.id} data-provider={node.provider}
                  role="button" tabIndex={isSelected || (!selectedSemanticNodeId && projected.nodes[0]?.id === node.id) ? 0 : -1} aria-label={node.label}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateNode(node) } }}
                  transform={`translate(${display.x}, ${display.y})`}
                  onClick={e => { e.stopPropagation(); activateNode(node) }}
                  onFocus={() => hoverStore.set(node.id)}
                  onBlur={() => hoverStore.clear(node.id)}
                  onMouseEnter={() => hoverStore.set(node.id)}
                  onMouseLeave={() => hoverStore.clear(node.id)}
                  style={{ opacity }}>
                  <GraphEventBadge count={eventCount} zoom={zoom} x={0} y={-dotR} />
                  {/* 스케일 트랜지션 시 경계 진동을 방지하는 고정 투명 히트 영역 */}
                  <circle r={dotR + 2 * screenScale} fill="transparent" stroke="none" />
                  <g className="fg-node-body fg-node-dot">
                    {selectedNeighbors.has(node.id) && !isSelected && <circle r={dotR + 3 * screenScale} fill="none" stroke="var(--color-text-primary)" strokeWidth={2 * screenScale} />}
                    {/* 고른 점은 색을 뒤집는다: SaaS 색 바탕에 흰 그림. 그림을 못 그릴 만큼 작으면 원래 SaaS 색 점이라 같은 색 고리를 두른다. */}
                    {isSelected && !showGlyph && <circle r={dotR + 4 * screenScale} fill="none" stroke={pColor} strokeWidth={2 * screenScale} />}
                    {hasSelectedFinding && <circle r={radius + 8} fill="#fee2e2" stroke="#dc2626" strokeWidth={4} />}
                    {(onQuery || onPath) && <circle r={radius + 6 * screenScale} fill="none" stroke={onQuery ? EDGE_COLORS.query : EDGE_COLORS.path} strokeWidth={3 * screenScale} strokeDasharray={onPath && !onQuery ? `${5 * screenScale} ${3 * screenScale}` : undefined} />}
                    {membershipHub && <circle r={radius + 7 * screenScale} fill="none" stroke={pColor} strokeWidth={2 * screenScale} strokeOpacity={0.3} />}
                    {showGlyph
                      ? <circle r={dotR} fill={isSelected ? selectFill : '#ffffff'} stroke={isSelected ? selectFill : pColor} strokeWidth={1.6 * screenScale} />
                      : <circle r={dotR} fill={pColor} stroke="#ffffff" strokeWidth={Math.max(3, 1.2 / zoom)} />}
                    {showGlyph && <DotGlyph x={-glyphSize / 2} y={-glyphSize / 2} width={glyphSize} height={glyphSize}
                      color={isSelected ? '#ffffff' : pColor} strokeWidth={2.4} aria-hidden="true" />}
                  </g>
                </g>
              )
            }

            // 상위 객체: 자기 테두리 맨 위 제목 줄. 그림 칸 · 전체 이름 · Finding 수.
            const headerFrame = nestFrameById.get(node.id)
            if (headerFrame) {
              const HeaderGlyph = objectGlyph(node.objectType, node.interfaces)
              // 원 테두리 맨 위에 걸친 이름표: 흰 바탕, 종류 그림, 이름, 위협 수
              const hw = headerFrame.legend / 2
              const hh = RING_LEGEND_H / 2
              const outer = headerFrame.depth === 0
              const headerStroke = strokeColor === pColor ? (outer ? NEST_STROKE.outer : NEST_STROKE.inner) : strokeColor
              const headerStrokeWidth = hasSelectedFinding || isSelected ? 3 : outer ? 2.2 : 1.8
              const titleSize = Math.min(RING_TITLE,
                Math.max(OBJECT_LABEL_MIN_SIZE, NEST_TITLE_TARGET_SCREEN_PX / Math.max(zoom, CAMERA_MIN_ZOOM)))
              const headerGlyph = 22
              const titleX = -hw + 12 + headerGlyph + 10
              const headerBadgeW = findingBadgeWidth(node.findingCount)
              const titleRight = hw - 12 - (hasAnyFinding ? headerBadgeW + 10 : 0)
              return (
                <g
                  key={node.id}
                  className={`graph-node-group fg-nest-header ${isSelected ? 'selected' : ''}${selectedNeighbors.has(node.id) ? ' is-neighbor' : ''}`}
                  data-object-key={node.id} data-provider={node.provider}
                  role="button"
                  tabIndex={isSelected || (!selectedSemanticNodeId && projected.nodes[0]?.id === node.id) ? 0 : -1}
                  aria-label={node.label}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateNode(node) } }}
                  transform={`translate(${display.x}, ${display.y})`}
                  onClick={e => { e.stopPropagation(); activateNode(node) }}
                  onFocus={() => hoverStore.set(node.id)}
                  onBlur={() => hoverStore.clear(node.id)}
                  onMouseEnter={() => hoverStore.set(node.id)}
                  onMouseLeave={() => hoverStore.clear(node.id)}
                  style={{ opacity }}
                >
                  <GraphEventBadge count={eventCount} zoom={zoom} x={0} y={-hh} />
                  <g className="fg-node-body fg-node-header">
                    <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2}
                      fill={isSelected ? selectFill : '#ffffff'} stroke={headerStroke} strokeWidth={headerStrokeWidth} />
                    <HeaderGlyph x={-hw + 12} y={-headerGlyph / 2} width={headerGlyph} height={headerGlyph}
                      color={isSelected ? '#ffffff' : pColor} strokeWidth={2.4} />
                    <text x={titleX} y={titleSize / 2.875} fontFamily={GRAPH_FONT_FAMILY} fontSize={titleSize} fontWeight="700" fill={isSelected ? '#ffffff' : '#0f172a'}>
                      {fitLabelMiddle(node.label, titleRight - titleX, titleSize)}
                    </text>
                    {hasAnyFinding && (
                      <g transform={`translate(${hw - 12 - headerBadgeW}, -11)`}>
                        <rect width={headerBadgeW} height={22} fill="#b42318" />
                        <text x={headerBadgeW / 2} y={11 + BADGE_SCREEN_PX / zoom / 2.875} textAnchor="middle" fontSize={BADGE_SCREEN_PX / zoom} fontWeight="700" fill="#ffffff"
                          fontFamily={GRAPH_FONT_FAMILY}>{node.findingCount}</text>
                      </g>
                    )}
                  </g>
                </g>
              )
            }

            const ObjectGlyph = objectGlyph(node.objectType, node.interfaces)
            const strokeWidth = hasSelectedFinding ? 3.4 : isSelected ? 3.4 : isNeighbor ? 2.8 : 2.2
            const R = OBJECT_CIRCLE_R
            const glyphSize = 26
            const badgeW = findingBadgeWidth(node.findingCount)
            const statusSize = BADGE_SCREEN_PX / zoom
            const statusText = onQuery ? '검색' : '경로'
            const statusWidth = measureLabel(statusText, statusSize) + 10
            // 이름은 원 아래 한 줄(leafLabel)
            const { size: objectLabelSize, text: objectLabelText } = leafLabel(node)

            return (
              <g
                key={node.id}
                className={`graph-node-group ${isSelected ? 'selected' : ''}${selectedNeighbors.has(node.id) ? ' is-neighbor' : ''}`}
                data-object-key={node.id} data-provider={node.provider}
                role="button"
                tabIndex={isSelected || (!selectedSemanticNodeId && projected.nodes[0]?.id === node.id) ? 0 : -1}
                aria-label={node.label}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateNode(node) } }}
                transform={`translate(${display.x}, ${display.y})`}
                onClick={e => { e.stopPropagation(); activateNode(node) }}
                onFocus={() => hoverStore.set(node.id)}
                onBlur={() => hoverStore.clear(node.id)}
                onMouseEnter={() => hoverStore.set(node.id)}
                onMouseLeave={() => hoverStore.clear(node.id)}
                style={{ opacity }}
              >
                <g className="fg-node-body">
                  <GraphEventBadge count={eventCount} zoom={zoom} x={-R} y={-R} />
                  <circle r={R} fill={isSelected ? selectFill : '#ffffff'} stroke={strokeColor} strokeWidth={strokeWidth} />
                  <ObjectGlyph x={-glyphSize / 2} y={-glyphSize / 2} width={glyphSize} height={glyphSize}
                    color={isSelected ? '#ffffff' : pColor} strokeWidth={2.4} />
                  <text x={0} y={R + OBJECT_CIRCLE_LABEL_GAP * objectLabelSize / 13} textAnchor="middle" fontFamily={GRAPH_FONT_FAMILY}
                    fontSize={objectLabelSize} fontWeight="600" fill="#0f172a" stroke="#ffffff" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">
                    {objectLabelText}
                  </text>
                  {(onQuery || onPath) && <g transform={`translate(${-statusWidth / 2}, ${-R - statusSize - 10})`}>
                    <rect width={statusWidth} height={statusSize + 6} fill="var(--color-surface)" stroke={onQuery ? EDGE_COLORS.query : EDGE_COLORS.path} />
                    <text x={statusWidth / 2} y={statusSize * 0.76 + 3} textAnchor="middle" fontSize={statusSize} fontWeight="var(--font-weight-medium)" fill="var(--color-text-primary)" fontFamily="var(--font-family-base)">{statusText}</text>
                  </g>}
                  {/* 위협 수는 원 오른쪽 위 */}
                  {hasAnyFinding && (
                    <g transform={`translate(${R * 0.55}, ${-R - 8})`}>
                      <rect width={badgeW} height={22} fill="#b42318" />
                      <text x={badgeW / 2} y={11 + BADGE_SCREEN_PX / zoom / 2.875} textAnchor="middle" fontSize={BADGE_SCREEN_PX / zoom}
                        fontWeight="700" fill="#ffffff" fontFamily={GRAPH_FONT_FAMILY}>{node.findingCount}</text>
                    </g>
                  )}
                </g>
              </g>
            )
          })}
        </svg>
        <DotLabels
          hoverStore={hoverStore}
          selectedId={selectedSemanticNodeId}
          priorityIds={new Set([...targetNodes.map(node => node.id), ...selectedNeighbors])}
          height={viewportSize.height - inspectorBottomInset}
          topInset={Math.max(122, toolbarBottom + 48)}
          reservedLabels={(semanticLevel !== 'ecosystem' && zoom < CLUSTER_LABEL_ZOOM ? clusterFrames.map(frame => ({
            x: frame.x * zoom + pan.x + 3,
            y: (frame.y + CLUSTER_HEADER - clusterLabelStrip(frame.provider)) * zoom + pan.y + 3,
            width: measureLabel(frame.label, OBJECT_LABEL_TARGET_SCREEN_PX) + 66, height: 32,
          })) : [])}
          active={semanticLevel === 'object'}
          boxMode={zoom >= DOT_ZOOM}
          boxWidth={id => objectBoxOf(id).width}
          showsFullName={chipShowsFullName}
          zoom={zoom}
          pan={pan}
          rightEdge={viewportSize.width - inspectorRightInset}
          membershipHubIds={membershipHubIds}
          nodesById={nodesById}
        />
        <NodeHoverTooltip store={hoverStore} canvasRef={canvasRef} graph={currentGraph} rows={eaRows}
          nodesById={nodesById} zoom={zoom} pan={pan} width={viewportSize.width - inspectorRightInset} height={viewportSize.height - inspectorBottomInset} />
        {showEffectiveAccess && <EaHoverTooltip store={eaHoverStore} canvasRef={canvasRef} graph={currentGraph} edges={eaOverlay.edges} geometry={eaGeometry}
          nodesById={nodesById} zoom={zoom} pan={pan} width={viewportSize.width - inspectorRightInset} height={viewportSize.height - inspectorBottomInset} />}
        <EdgeTooltip
          store={edgeHoverStore}
          canvasRef={canvasRef}
          edges={projected.edges}
          nodesById={nodesById}
          flags={edgeFlags}
          graph={currentGraph}
          findings={findings}
          zoom={zoom} pan={pan}
          width={viewportSize.width - inspectorRightInset}
          height={viewportSize.height - inspectorBottomInset}
        />
      </div>

      {eventEvidence && <div className="graph-event-overlay" role="status">AI 조회 이벤트 {eventEvidence.nodes.length}개, 매칭 노드 {eventMatches?.byObject.size ?? 0}개, 미매칭 {eventMatches?.unmatched.length ?? 0}개
        <select aria-label="이벤트 매칭 노드" value={selectedSemanticNodeId && eventMatches?.byObject.has(selectedSemanticNodeId) ? selectedSemanticNodeId : ''} onChange={e => { if (e.target.value) focusOnObject(e.target.value) }}>
          <option value="">노드 선택</option>{[...(eventMatches?.byObject ?? [])].map(([key, events]) => <option key={key} value={key}>{objectDisplayName(currentGraph.objectsByKey.get(key)!)}: {events.length}건</option>)}
        </select>
        {onClearEvents && <button type="button" onClick={onClearEvents}>이벤트 표시 해제</button>}
      </div>}
      {evidenceMode && inspectorPanel}
      </div>

      {/* 오른쪽에 도킹되는 Findings 패널 */}
      {assistantContext && !evidenceMode && <div className="assistant-mount" hidden={!assistantOpen}>
        <AssistantPanel graph={currentGraph as GraphStoreV2} findings={findings} context={assistantContext} isOpen={assistantOpen}
          onClose={() => { setAssistantOpen(false); focusAiLauncher() }} onOpenThreat={onOpenThreat} />
      </div>}
      {!evidenceMode && !assistantOpen && <GraphSideDock
        open={sideOpen}
        tab={sideTab}
        width={sideWidth}
        findingCount={findings.length}
        hasDetail={inspectorOpen}
        detailLabel={selectedNode?.label ?? focusedFinding?.title}
        onTab={setSideTab}
        onOpenChange={setSideOpen}
        onWidth={setSideWidth}
        detail={inspectorPanel}
        findings={<FindingNavigator
        embedded
        providers={GRAPH_PROVIDERS}
        findings={findings}
        selectedFindingIds={selectedFindingIds}
        onToggleFinding={handleToggleFinding}
        onClearSelection={handleClearFindings}
        onOpenFindingDetail={findingId => {
          // 화면을 옮기지 않는다. 그래프에서 이 위협 경로만 강조하고 상세 탭에 요약을 띄운다. Threat Analysis는 요약의 단추로 연다
          revealNodeRef.current = null
          setShowFindingEvidence(true)
          setSelectedFindingIds([findingId])
          setSelectedSemanticNodeId(null)
          setSelectedEdgeId(null)
          setSelectedEaRowIds(null)
          setFocusedFindingId(findingId)
          setSideTab('detail')
          setSideOpen(true)
        }}
        showEvidence={showFindingEvidence}
        onToggleEvidence={() => setShowFindingEvidence(value => !value)}
        isOpen
        onToggleOpen={() => setSideOpen(false)}
        exceptedCount={exceptedFindingCount}
      />} />}
      </div>
    </div>
  )
}

/* 커서 칸 · 커서 선을 받아 children(관계선)만 다시 그린다. 그래프 본체는 커서가 움직여도 다시 그리지 않는다 */
function HoverSlot({ store, edgeStore, eaStore, children }: {
  store: HoverStore
  edgeStore: HoverStore
  eaStore: HoverStore
  children: (hoveredId: string | null, hoveredEdgeId: string | null, hoveredEaId: string | null) => ReactNode
}) {
  const hoveredId = useHovered(store)
  const hoveredEdgeId = useHovered(edgeStore)
  const hoveredEaId = useHovered(eaStore)
  return <>{children(hoveredId, hoveredEdgeId, hoveredEaId)}</>
}

/* 관계선에 커서를 올리면 뜨는 한 줄 설명. 전에는 선이 무슨 관계인지 눌러야만 알 수 있었다.
   무슨 관계인지(이름, 방향, 문장)와 지금 왜 그 색 · 진하기인지(탐지 증거, 경로, 검색, 관계선 메뉴)를 적는다.
   글은 선 상세(EdgeInspector)와 같은 explainEdge 로 만든다. 커서를 따라가고, 누름은 받지 않는다. */
function EdgeTooltip({ store, canvasRef, edges, nodesById, flags, graph, findings, width, height, zoom, pan }: {
  store: HoverStore
  canvasRef: { current: HTMLDivElement | null }
  edges: ProjectedGraphData['edges']
  nodesById: ReadonlyMap<string, SemanticNode>
  flags: ReadonlyMap<string, EdgeFlags>
  graph: GraphStore | GraphStoreV2
  findings: FindingV2[]
  width: number
  height: number
  zoom: number
  pan: Point
}) {
  const hoveredId = useHovered(store)
  const tip = useMemo(() => {
    const edge = hoveredId ? edges.find(item => item.id === hoveredId) : undefined
    const state = edge ? flags.get(edge.id) : undefined
    if (!edge || !state) return null
    const source = nodesById.get(edge.sourceSemanticNodeId)
    const target = nodesById.get(edge.targetSemanticNodeId)
    const explanation = explainEdge(graph, edge, { source, target }, findings)
    const onlyGroup = explanation.relationGroups.length === 1 && !explanation.links.length ? explanation.relationGroups[0] : null
    const relationCount = explanation.relationGroups.reduce((n, group) => n + group.items.length, 0)
    const title = onlyGroup && onlyGroup.items.length === 1
      ? onlyGroup.label
      : onlyGroup ? `${onlyGroup.label} ${onlyGroup.items.length}개`
        : relationCount > 1 && !explanation.links.length ? `${explanation.title} ${relationCount}개` : explanation.title
    const evidence = [...new Set([
      ...explanation.relationGroups.flatMap(group => group.items.flatMap(item => item.findingIds)),
      ...explanation.links.flatMap(link => link.findingIds),
    ])]
    const notes: Array<{ kind: string; text: string }> = []
    if (state.hasAnyFinding && evidence.length) {
      notes.push({ kind: 'finding', text: `탐지 경로: ${evidence.slice(0, 3).join(', ')}${evidence.length > 3 ? ` 외 ${evidence.length - 3}건` : ''}` })
    }
    if (state.onPath) notes.push({ kind: 'path', text: '선택 경로의 한 단계' })
    if (state.onQuery) notes.push({ kind: 'query', text: '검색 결과에 든 관계' })
    if (!state.matchesLens && !state.isLinkHidden) notes.push({ kind: 'lens', text: '관계선 메뉴에서 고르지 않은 종류, 흐리게 표시' })
    const arrow = state.isResolution ? '↔' : '→'
    return {
      title,
      direction: `${source?.label ?? edge.sourceSemanticNodeId} ${arrow} ${target?.label ?? edge.targetSemanticNodeId}`,
      summary: explanation.summary,
      notes,
    }
  }, [hoveredId, edges, flags, nodesById, graph, findings])

  const edge = edges.find(item => item.id === hoveredId)
  const source = edge && nodesById.get(edge.sourceSemanticNodeId), target = edge && nodesById.get(edge.targetSemanticNodeId)
  const anchor = source && target ? { x: (source.x + target.x) / 2 * zoom + pan.x, y: (source.y + target.y) / 2 * zoom + pan.y } : undefined
  return <HoverTooltip store={store} canvasRef={canvasRef} tip={tip} anchor={anchor} width={width} height={height} kind="edge" />
}
/* '현재 위치' 줄. 칸에 커서를 올리면 그 칸이 든 곳을 바깥부터 적는다(예: Slack › AEGI-Inc Workspace ›
   #general › Slack User Normal 1). 커서가 칸을 떠나면 화면 가운데 기준(center)을 쓴다.
   커서 자리는 hoverStore 에서 받아, 커서가 움직여도 그래프 전체가 아니라 이 줄만 다시 그린다. */
function ViewLocationBar({ canGoBack = false, onGoBack, canGoForward = false, onGoForward, narrow, canvasWidth, reserveRight = 0, hoverStore, center, enabled, level, nodesById, containment, graph }: {
  canGoBack?: boolean
  onGoBack?: () => void
  canGoForward?: boolean
  onGoForward?: () => void
  /** 상세 패널이 열려 있으면 그 자리를 비운다 (긴 경로가 패널 밑으로 들어가지 않게) */
  narrow: boolean
  /** 캔버스 폭(px). 줄이 쓸 수 있는 폭 = 이것 − 32 (패널이 열려 있으면 − 426, graphWorkspace.css 와 같다) */
  canvasWidth: number
  /** 같은 줄 오른쪽에 범례가 있으면 그 자리(px, 범례 폭과 오른쪽 여백). 줄은 범례 왼쪽까지만 쓴다 */
  reserveRight?: number
  hoverStore: HoverStore
  center: ViewLocation | null
  enabled: boolean
  level: SemanticLevel
  nodesById: ReadonlyMap<string, SemanticNode>
  containment: ReadonlyMap<string, string>
  graph: GraphStore | GraphStoreV2
}) {
  const hoveredId = useHovered(hoverStore)
  const hovered = useMemo<ViewLocation | null>(() => {
    const node = enabled && hoveredId ? nodesById.get(hoveredId) : undefined
    if (!node) return null
    const trail: ViewLocation['trail'] = []
    if (level === 'object') {
      // 개별 항목은 포함 관계(채널 → 워크스페이스 → …)를 거슬러 올라간다. 지금 화면에
      // 그려지지 않은 상위 객체도 이름을 적는다.
      const chain: string[] = []
      for (let key = containment.get(node.id); key && chain.length < 8; key = containment.get(key)) chain.unshift(key)
      for (const key of chain) {
        const object = graph.objectsByKey.get(key)
        const name = nodesById.get(key)?.label ?? object?.fixture_meta?.display_name ?? object?.canonical.properties?.name ?? key
        trail.push({ id: key, label: String(name), kind: object?.canonical.object_type })
      }
    }
    trail.push({ id: node.id, label: node.label, kind: level === 'object' ? node.objectType : level === 'scope' ? node.scopeKind : undefined })
    return { provider: node.provider, providers: [node.provider], trail: trail.slice(-4) }
  }, [enabled, hoveredId, nodesById, level, containment, graph])
  const location = hovered ?? center
  const maxWidth = Math.min(narrow ? canvasWidth - 426 : canvasWidth - 32, reserveRight > 0 ? canvasWidth - 16 - reserveRight : Infinity)
  const shown = useMemo(() => (location ? foldTrail(location, maxWidth) : null), [location, maxWidth])
  if (!location || !shown) return null
  const fullPath = [location.provider ? providerName(location.provider) : '여러 SaaS', ...location.trail.map(step => step.label)].join(' › ')
  return (
    <div className={`gx-view-location ${narrow ? 'inspector-open' : ''}`} style={reserveRight > 0 ? { maxWidth } : undefined} aria-live="polite" aria-label={`현재 위치: ${fullPath}`} title={fullPath}>
      {canGoBack && onGoBack && (
        <button type="button" className="gx-view-back-btn" onClick={onGoBack} aria-label="이전 조사 위치로 돌아가기" title="이전 조사 위치로 돌아가기">
          <ArrowLeft size={12} strokeWidth={2.4} aria-hidden="true" />
          <b>이전</b>
        </button>
      )}
      {canGoForward && onGoForward && (
        <button type="button" className="gx-view-back-btn" onClick={onGoForward} aria-label="되돌린 조사 위치 다시 열기" title="되돌린 조사 위치 다시 열기">
          <b>다음</b>
          <ArrowRight size={12} strokeWidth={2.4} aria-hidden="true" />
        </button>
      )}
      <span className="gx-view-location-label">현재 위치</span>
      {location.provider ? (
        <span className={`gx-view-location-saas provider-${location.provider}`}>
          <ProviderLogo provider={location.provider === 'gws' ? 'google-workspace' : (location.provider as ProviderId)} />
          <b>{providerName(location.provider)}</b>
        </span>
      ) : (
        <span className="gx-view-location-saas multi" aria-label="여러 SaaS">
          {location.providers.map(provider => (
            <ProviderLogo key={provider} provider={provider === 'gws' ? 'google-workspace' : (provider as ProviderId)} />
          ))}
        </span>
      )}
      {shown.folded > 0 && (
        <span className="gx-view-location-step is-folded" aria-hidden="true">
          <ChevronRight size={12} aria-hidden="true" />
          <b>…</b>
        </span>
      )}
      {shown.steps.map(step => (
        <span key={step.id} className="gx-view-location-step">
          <ChevronRight size={12} aria-hidden="true" />
          {step.kind && <small>{step.kind}</small>}
          <b>{step.label}</b>
        </span>
      ))}
    </div>
  )
}

/* '현재 위치' 줄에 들어갈 만큼만 단계를 남긴다. 좁으면 앞(바깥) 단계부터 「…」 하나로 접고, 마지막(지금 칸)은 늘 남긴다.
   전에는 모든 단계의 이름을 똑같이 줄여, 상세 패널을 연 1280px 화면에서 「A…」 · 「#」만 남아 읽을 수 없었다.
   폭은 CSS 와 같은 글씨 크기로 어림한다(패딩 · 틈 · 화살표 포함). 전체 경로는 줄의 title · aria-label 에 있다. */
const VIEW_BAR_CHROME = 8 + 12 + 2 // 왼쪽 · 오른쪽 안쪽 여백, 테두리
const VIEW_BAR_GAP = 6
const VIEW_STEP_ARROW = 12 + 4
function foldTrail(location: ViewLocation, maxWidth: number): { steps: ViewLocation['trail']; folded: number } {
  const trail = location.trail
  if (trail.length <= 1 || maxWidth <= 0) return { steps: trail, folded: 0 }
  const budget = maxWidth - 12 // 어림 오차(글꼴 · 반올림)로 마지막 이름이 눌리지 않게 남기는 폭
  const labelWidth = measureLabel('현재 위치', 11) * 1.1
  const saasWidth = location.provider
    ? 16 + 6 + 16 + measureLabel(providerName(location.provider), 13) * 1.08
    : location.providers.length * 21 + 12
  const stepWidth = (step: ViewLocation['trail'][number]) =>
    VIEW_STEP_ARROW + (step.kind ? measureLabel(step.kind, 11) + 4 : 0) + Math.min(220, measureLabel(step.label, 12) * 1.04)
  const fixed = VIEW_BAR_CHROME + labelWidth + VIEW_BAR_GAP + saasWidth
  const widths = trail.map(stepWidth)
  const total = (from: number) => fixed + widths.slice(from).reduce((sum, w) => sum + VIEW_BAR_GAP + w, 0)
  if (total(0) <= budget) return { steps: trail, folded: 0 }
  const ellipsis = VIEW_BAR_GAP + VIEW_STEP_ARROW + measureLabel('…', 12)
  let from = 1
  while (from < trail.length - 1 && total(from) + ellipsis > budget) from += 1
  const steps = trail.slice(from)
  // 마지막 단계만 남았는데도 넘치면, 이름보다 덜 중요한 형태 글자(conversation 등)를 뺀다
  const last = steps[steps.length - 1]
  if (steps.length === 1 && last.kind && total(from) + ellipsis > budget) {
    return { steps: [{ ...last, kind: undefined }], folded: from }
  }
  return { steps, folded: from }
}

/* 커서 이름표 (L4). 점 모드에서는 커서를 올린 칸과 고른 칸에, 칸 모드에서는 이름이 칸에 다 들어가지
   않은 칸에 커서를 올렸을 때만 띄운다.
   전에는 이름표를 점과 같은 SVG 묶음 안에 그려 뒤에 그린 점이 글자를 덮었고
   (#ge●eral), 폭과 상관없이 15자에서 잘랐다. 그 뒤 점 위층에 늘 띄워 두었더니
   흰 이름표가 그래프를 덮었다. 실제 글자 폭을 재 300px까지는 이름 전체를 싣고,
   동그라미(칸) 오른쪽에 두되 화면을 넘으면 왼쪽에 둔다. 누름은 받지 않아 칸을 가리지 않는다.
   커서 자리는 hoverStore 에서 받는다. */
function DotLabels({ hoverStore, selectedId, priorityIds, height, topInset, reservedLabels, active, boxMode, boxWidth, showsFullName, zoom, pan, rightEdge, membershipHubIds, nodesById }: {
  hoverStore: HoverStore
  selectedId: string | null
  priorityIds: ReadonlySet<string>
  height: number
  topInset: number
  reservedLabels: readonly LabelRect[]
  active: boolean
  /** 칸으로 그리는 배율 (DOT_ZOOM 이상) */
  boxMode: boolean
  boxWidth: (id: string) => number
  /** 칸 안에 이름을 다 적었는가 (칸 모드에서만 본다) */
  showsFullName: (node: SemanticNode) => boolean
  zoom: number
  pan: Point
  rightEdge: number
  membershipHubIds: ReadonlySet<string>
  nodesById: ReadonlyMap<string, SemanticNode>
}) {
  const hoveredId = useHovered(hoverStore)
  const [fontSize] = useState(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size-sm')) || OBJECT_LABEL_TARGET_SCREEN_PX)
  const labels = useMemo(() => {
    if (!active) return []
    const scale = Math.max(zoom, CAMERA_MIN_ZOOM)
    const ids = [...new Set((boxMode ? [hoveredId, selectedId] : [hoveredId, selectedId, ...priorityIds])
      .filter((id): id is string => Boolean(id)))]
    const content = new Map<string, { text: string; provider: string }>()
    const obstacles: LabelRect[] = [...reservedLabels, ...(boxMode ? [] : [...nodesById.values()].map(node => {
      const radius = dotRadius(zoom) * scale + (membershipHubIds.has(node.id) ? 2 : 0)
      return { x: node.x * scale + pan.x - radius, y: node.y * scale + pan.y - radius, width: radius * 2, height: radius * 2 }
    }))]
    const candidates = ids.flatMap(id => {
      const node = nodesById.get(id)
      if (!node) return []
      if (boxMode && showsFullName(node)) return []
      const hub = membershipHubIds.has(id)
      const radius = boxMode
        ? boxWidth(id) / 2 * scale + 6
        : (dotRadius(zoom) + (hub ? 2 / scale : 0)) * scale + 6
      const maxWidth = Math.min(DOT_LABEL_MAX_WIDTH, Math.max(60, rightEdge - 24))
      const text = fitLabel(node.label, maxWidth - DOT_LABEL_PAD_X * 2, fontSize)
      // measureLabel은 600 굵기로 잰다. 700으로 그리고 테두리도 있으므로 넉넉히 둔다.
      const width = Math.min(maxWidth, Math.ceil(measureLabel(text, fontSize) * 1.08) + DOT_LABEL_PAD_X * 2 + 4)
      content.set(id, { text, provider: node.provider })
      return [{ id, x: node.x * scale + pan.x, y: node.y * scale + pan.y, radius: radius - 6,
        width, height: DOT_LABEL_HEIGHT, priority: id === hoveredId ? 4 : id === selectedId ? 3 : priorityIds.has(id) ? 2 : 1 }]
    })
    return placeReadableLabels(candidates, { x: 4, y: topInset, width: Math.max(0, rightEdge - 8), height: Math.max(0, height - topInset - 16) }, obstacles)
      .map(at => ({ ...at, ...content.get(at.id)! }))
  }, [active, boxMode, boxWidth, showsFullName, zoom, pan, rightEdge, hoveredId, selectedId, membershipHubIds, nodesById, priorityIds, height, topInset, reservedLabels, fontSize])
  if (!labels.length) return null
  return (
    <div className="gx-dot-labels" data-pan-follow="">
      {labels.map(label => (
        <span
          key={label.id}
          className={`gx-dot-label provider-${label.provider}`}
          data-label-for={label.id}
          style={{ transform: `translate(${label.x}px, ${label.y}px)`, width: label.width }}
        >
          {label.text}
        </span>
      ))}
    </div>
  )
}

/* Effective Access 선의 커서 자리 (투명한 굵은 선 + 툴팁). 관계선보다 아래에 깐다 —
   위에 두면 끝점이 같은 관계선(묶인 SaaS·그룹 사이 선)을 덮어 그 선을 누를 수 없었다. */
function EaHitLayer({ edges, nodesById, zoom, hoverStore, geometry, onSelect }: {
  edges: EaEdge[]; nodesById: ReadonlyMap<string, SemanticNode>; zoom: number
  hoverStore: HoverStore; geometry: EaGeometry; onSelect: (edge: EaEdge) => void
}) {
  return <g className="gx-ea-hits">{edges.map(ea => {
    const source = nodesById.get(ea.sourceNodeId), target = nodesById.get(ea.targetNodeId)
    if (!source || !target) return null
    const curve = geometry(source, target)
    return <g key={ea.id} className="gx-ea-hit" data-ea-id={ea.id} role="button" tabIndex={0}
      aria-label={'Effective Access 결과 ' + source.label + ' → ' + target.label + ', ' + ea.rows.length + '건'}
      onFocus={() => hoverStore.set(ea.id)} onBlur={() => hoverStore.clear(ea.id)}
      onMouseEnter={() => hoverStore.set(ea.id)} onMouseLeave={() => hoverStore.clear(ea.id)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(ea) } }}
      onClick={event => { event.stopPropagation(); onSelect(ea) }}>
      <path d={curve.d} fill="none" stroke="transparent" strokeWidth={14 / Math.max(zoom, CAMERA_MIN_ZOOM)} />
    </g>
  })}</g>
}

function EaLines({ edges, nodesById, zoom, hoverStore, nodeStore, edgeStore, geometry, selectedRowIds }: {
  edges: EaEdge[]; selectedRowIds: string[] | null; nodesById: ReadonlyMap<string, SemanticNode>; zoom: number
  hoverStore: HoverStore; nodeStore: HoverStore; edgeStore: HoverStore; geometry: EaGeometry
}) {
  const hovered = useHovered(hoverStore), node = useHovered(nodeStore)
  const relation = useHovered(edgeStore)
  const scale = 1 / Math.max(zoom, CAMERA_MIN_ZOOM)
  return <g className="gx-ea-lines">{edges.map(ea => {
    const source = nodesById.get(ea.sourceNodeId), target = nodesById.get(ea.targetNodeId)
    if (!source || !target) return null
    const curve = geometry(source, target)
    const active = hovered === ea.id || node === ea.sourceNodeId || node === ea.targetNodeId || ea.rows.some(row => selectedRowIds?.includes(row.id))
    const width = active ? 3.2 * scale : Math.max(2.2, 1.6 * scale)
    const arrow = active ? arrowHead(curve.tangent, curve.end, 10 * scale) : null
    return <g key={ea.id} data-ea-id={ea.id} style={{ opacity: !active && (hovered || node || relation) ? 0.2 : 1 }} className={'gx-ea-edge ' + (ea.settled ? 'is-settled' : 'is-pending') + (active ? ' is-hover' : '')}>
      {active && <path className="gx-ea-separator" d={curve.d} fill="none" stroke="var(--color-surface)" strokeWidth={width + 4 * scale} />}
      <path className="gx-ea-halo" d={curve.d} fill="none" strokeWidth={width * 3.2} />
      <path className="gx-ea-core" d={curve.d} fill="none" strokeWidth={width} strokeDasharray={ea.settled ? undefined : (width * 3) + ' ' + (width * 2)} />
      {arrow && <polygon className="gx-ea-arrow" points={arrow.points} fill="var(--color-select)" />}
    </g>
  })}</g>
}
