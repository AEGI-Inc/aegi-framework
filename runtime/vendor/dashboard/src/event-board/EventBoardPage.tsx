/**
 * Event Board (v3) 타임라인 보드 화면.
 * 세로는 SaaS 줄, 가로는 시간(접힌 생략 구간 포함)인 타임라인 보드.
 * 조회, AI 결과, 이웃 조회 결과가 모두 보드에 오르며, 종류별 연결선으로 사실을 잇는다.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, Fragment } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Database,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Plus,
  RotateCw,
  Star,
  X,
} from 'lucide-react'
import type { GraphStoreV2 } from '../model/graph'
import type { EvidenceStore } from '../model/evidence'
import type { FindingV2 } from '../model/findingV2'
import type { ExceptionDataset } from '../model/exception'
import type { TeamBackend } from '../handling/teamStore'
import {
  INVESTIGATION_STATES,
  INVESTIGATION_STATE_LABEL,
  MAX_INVESTIGATION_ACTOR,
  MAX_INVESTIGATION_OWNER,
  MAX_INVESTIGATION_CONCLUSION,
  type InvestigationState,
  type InvestigationRecord,
} from '../model/investigation'
import { useInvestigations } from './useInvestigations'
import {
  emptyBoardV3,
  serializeBoard,
  shrinkToFit,
  parseBoardAny,
  aiSourceTitle,
  isDuplicateAiSource,
  type BoardV3,
  type Source,
  type SubjectCard,
  type LinkKind,
  type BoardPin,
} from './boardV3'
import {
  buildAxis,
  kstTimeStr,
  formatGapDuration,
  type Axis,
} from './timeAxis'
import {
  groupRepeats,
  layoutBoard,
  type EventGroup,
  type Placed,
} from './boardLayout'
import {
  boardLinks,
  flowOf,
  linkPath,
  LINK_KIND_LABELS,
  type BoardLink,
} from './boardLinks'
import { EventHoverCard } from './EventHoverCard'
import {
  summarize,
  nextQueryCandidates,
  boardWorkspace,
  type QueryCandidate,
} from './boardFacts'
import { threatFromFinding, threatFromConfigItem, scopeFor } from './threatCards'
import { expandNeighbors, neighborScope } from './graphNeighbors'
import { objectLabel } from '../blast-radius/blastLabels'
import { loadTimelineEvents } from '../timeline/loadTimeline'
import {
  MAX_SCOPE_OBJECTS,
  type TimelineEvent,
  type EventLink,
  type Pin,
  type TimedEvent,
  rawFields,
  CATEGORY_LABEL,
  OUTCOME_LABEL,
  formatTime,
  formatKstFull,
  formatUtc,
  formatDelta,
  BASIS_LABEL,
} from '../timeline/timelineAnalysis'

/**
 * 연결 근거를 사람이 읽는 말로. 표의 한 줄(앞 또는 뒤 이벤트)이 기준 이벤트와 무엇으로 이어졌는지 쓴다.
 * 주어는 그 줄의 이벤트다. 행위자, 대상 이름은 같은 줄의 칸에 있어 다시 쓰지 않는다.
 */
function linkReason(l: BoardLink, dir: 'prev' | 'next'): string {
  const basis = l.basis ? (BASIS_LABEL as Record<string, string>)[l.basis] ?? '' : ''
  switch (l.kind) {
    case 'same_actor': return '같은 행위자'
    case 'same_target': return '같은 대상'
    case 'target_to_actor': return dir === 'prev' ? '대상이 기준 이벤트의 행위자' : '기준 이벤트의 대상이 행위자'
    case 'actor_to_target': return dir === 'prev' ? '행위자가 기준 이벤트의 대상' : '기준 이벤트의 행위자가 대상'
    case 'same_person': return basis || '같은 사람의 다른 계정'
    case 'session_ip_cause': return basis || '같은 세션, IP 또는 원본 원인'
    case 'graph_relation': return basis || '그래프 관계로 이어진 객체'
    case 'analyst': return l.note ? `분석가 연결, ${l.note}` : '분석가 연결'
    default: return LINK_KIND_LABELS[l.kind]
  }
}

/** 보드 위 연결선 호버·클릭 설명 문구 */
function describeBoardLink(
  l: BoardLink,
  graph: GraphStoreV2,
): string {
  const objName = l.objectKey
    ? (graph.objectsByKey.has(l.objectKey) ? objectLabel(l.objectKey, graph) : l.objectKey)
    : null
  const basis = l.basis ? (BASIS_LABEL as Record<string, string>)[l.basis] ?? '' : ''
  let text = ''
  switch (l.kind) {
    case 'same_actor':
      text = objName ? `두 이벤트의 행위자가 같습니다 (${objName})` : '두 이벤트의 행위자가 같습니다'
      break
    case 'same_target':
      text = objName ? `두 이벤트의 대상이 같습니다 (${objName})` : '두 이벤트의 대상이 같습니다'
      break
    case 'target_to_actor':
      text = objName ? `앞 이벤트의 대상(${objName})이 뒤 이벤트의 행위자입니다` : '앞 이벤트의 대상이 뒤 이벤트의 행위자입니다'
      break
    case 'actor_to_target':
      text = objName ? `앞 이벤트의 행위자(${objName})가 뒤 이벤트의 대상입니다` : '앞 이벤트의 행위자가 뒤 이벤트의 대상입니다'
      break
    case 'same_person':
      text = `${basis || '동일인의 다른 SaaS 계정 활동'}${objName ? ` (${objName})` : ''}`
      break
    case 'session_ip_cause':
      text = `${basis || '같은 세션, IP 또는 원본 원인'}${objName ? ` (${objName})` : ''}`
      break
    case 'graph_relation':
      text = `${basis || '그래프 관계로 이어진 객체'}${objName ? ` (${objName})` : ''}`
      break
    case 'analyst':
      text = l.note ? `분석가 메모: ${l.note}` : '분석가가 직접 연결한 이벤트'
      break
    default:
      text = LINK_KIND_LABELS[l.kind]
  }
  if (l.extraCount) text += `, 앞선 같은 종류 연결 ${l.extraCount}건 더 있음`
  return text
}

type SideTab = 'detail' | 'sources' | 'subjects'
/** 오른쪽 칸 탭. 이름의 수는 화면에서 붙인다 */
const SIDE_TABS: Array<{ key: SideTab; title: string; icon: typeof FileText }> = [
  { key: 'detail', title: '선택한 이벤트 상세', icon: FileText },
  { key: 'sources', title: '보드에 올린 출처', icon: Database },
  { key: 'subjects', title: '조사 대상과 메모', icon: Crosshair },
]

/** 메일 주소는 @ 앞에서 줄을 바꿀 수 있게 한다. 좁은 칸에서 주소 끝 글자만 다음 줄로 넘어가지 않게 */
function breakAtMail(label: string): React.ReactNode {
  const i = label.indexOf('@')
  return i > 0 ? <>{label.slice(0, i)}<wbr />{label.slice(i)}</> : label
}

/** 앞뒤 흐름의 시간차. 1분 아래는 초까지 쓴다 */
function flowGap(ms: number): string {
  return ms < 60_000 ? formatDelta(ms) : formatGapDuration(ms)
}
import { MatchFacts, Entity, entityLabel } from '../timeline/TimelineDetail'
import { providerLogoId, providerName } from '../findings/providers'
import ProviderLogo from '../ProviderLogo'
import { ChipGroup } from '../ui/ListScreen'
import { formatKst, utcTitle } from '../utils/time'
import AssistantPanel, { type AssistantContext } from '../assistant/AssistantPanel'
import AiLauncher, { focusAiLauncher } from '../assistant/AiLauncher'
import AiLogo from '../assistant/AiLogo'
import { emptySelection, type AssistantSeed } from '../assistant/workspace'
import { boardEventFromSnapshot, snapshotFromAssistantNode, toEventSnapshot, type QueryScope } from './boardModel'
import { getStandardResults } from '../config-findings/standardResultsStore'
import './event-board.css'

export interface EventBoardPageProps {
  dataset: ExceptionDataset
  backend: TeamBackend
  graph: GraphStoreV2
  findings: FindingV2[]
  evidenceStore: EvidenceStore
  snapshotId?: string
  onOpenObject: (key: string) => void
  /** AI 답변의 이벤트를 Cross-SaaS Graph 노드 위에 표시한다(App 의 기본 AI 창과 같은 동작) */
  onShowEventGraph?: AssistantContext['onShowEventGraph']
}

interface SourceResult {
  loading: boolean
  events: TimelineEvent[]
  links?: EventLink[]
  problem: string | null
  progress: { done: number; total: number } | null
}

interface Kept {
  board: BoardV3
  sourceResults: Record<string, SourceResult>
  selectedEventKey: string | null
  state: InvestigationState
  owner: string
  conclusion: string
  hash: string
}

const kept = new Map<string, Kept>()
const DRAFT_PREFIX = 'aegi:event-board-draft:'
const MAX_DRAFT_CHARS = 2_000_000

/** 새로고침하면 메모리의 보드가 사라지므로 이 탭의 sessionStorage 에 둔다. 조회 결과는 저장하지 않고 다시 조회한다 */
function writeDraft(storageKey: string, k: Kept): void {
  try {
    const text = JSON.stringify({ board: k.board, selectedEventKey: k.selectedEventKey, state: k.state, owner: k.owner, conclusion: k.conclusion, hash: k.hash })
    if (text.length <= MAX_DRAFT_CHARS) sessionStorage.setItem(DRAFT_PREFIX + storageKey, text)
    else sessionStorage.removeItem(DRAFT_PREFIX + storageKey)
  } catch { /* 저장소를 못 쓰면 메모리 보존만 한다 */ }
}

function readDraft(storageKey: string): Kept | undefined {
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + storageKey)
    if (!raw) return undefined
    const v = JSON.parse(raw) as Record<string, unknown>
    const board = parseBoardAny(v.board)
    if (!board) return undefined
    const text = (x: unknown) => (typeof x === 'string' ? x : '')
    const state = v.state === 'doing' || v.state === 'closed' ? v.state : 'open'
    return { board, sourceResults: {}, selectedEventKey: typeof v.selectedEventKey === 'string' ? v.selectedEventKey : null,
      state, owner: text(v.owner), conclusion: text(v.conclusion), hash: text(v.hash) }
  } catch {
    return undefined
  }
}
const ACTOR_STORAGE_KEY = 'aegi.event-investigations.actor'
const SIDE_WIDTH_STORAGE_KEY = 'aegi.eventBoardSideWidth'
const SIDE_WIDTH_DEFAULT = 440
const SIDE_WIDTH_MIN = 280
const SIDE_WIDTH_STEP = 24
const maxSideWidth = () => (typeof window === 'undefined' ? 840 : Math.max(SIDE_WIDTH_MIN, Math.min(840, Math.round(window.innerWidth * 0.6))))
const clampSideWidth = (value: number) => Math.min(maxSideWidth(), Math.max(SIDE_WIDTH_MIN, Math.round(value)))
const MIN_ZOOM = 0.5
const MAX_ZOOM = 40

export { LINK_KIND_LABELS } from './boardLinks'

const ALL_LINK_KINDS: LinkKind[] = [
  'same_actor',
  'target_to_actor',
  'actor_to_target',
  'same_target',
  'same_person',
  'session_ip_cause',
  'graph_relation',
  'analyst',
]

const CANDIDATE_TITLE: Record<QueryCandidate['kind'], string> = {
  threat_objects: '위협 객체',
  outside_person: 'Access Gap 인원',
  pinned_event_object: '표시한 이벤트 객체',
  object_card: '객체',
  neighbor_rest: '이웃 객체',
}

function candidateReason(c: QueryCandidate): string {
  if (c.kind === 'threat_objects') return `위협 객체 중 아직 조회하지 않은 ${c.objectKeys.length}개`
  if (c.kind === 'neighbor_rest') return `이웃 객체 중 상한으로 빠지고 아직 조회하지 않은 ${c.objectKeys.length}개`
  return `${CANDIDATE_TITLE[c.kind]}, 아직 조회하지 않음`
}

/** 그래프에서 같은 사람으로 묶인 모든 객체 키 반환 */
function getSamePersonKeys(key: string, graph: GraphStoreV2): Set<string> {
  const result = new Set<string>([key])
  if (!graph.linksById) return result
  for (const link of graph.linksById.values()) {
    if (link.set.some(m => m.object_key === key)) {
      for (const m of link.set) {
        result.add(m.object_key)
      }
    }
  }
  return result
}

/** 이벤트가 핀 조건에 맞는지 확인 */
function eventMatchesPin(e: TimelineEvent, pin: BoardPin, graph: GraphStoreV2): boolean {
  if (pin.kind === 'actor') {
    return e.actor?.object_key === pin.value || e.actor?.native_id === pin.value
  }
  if (pin.kind === 'target') {
    return e.targets.some(t => t.object_key === pin.value || t.native_id === pin.value)
  }
  if (pin.kind === 'ip') {
    return e.correlation?.client_ip === pin.value
  }
  if (pin.kind === 'object') {
    if (e.actor?.object_key === pin.value || e.actor?.native_id === pin.value) return true
    return e.targets.some(t => t.object_key === pin.value || t.native_id === pin.value)
  }
  if (pin.kind === 'person') {
    const personKeys = getSamePersonKeys(pin.value, graph)
    return Boolean(e.actor?.object_key && personKeys.has(e.actor.object_key))
  }
  return false
}

/** 그래프 이웃 이벤트 대화창 */
function NeighborTimelineDialog({
  seeds,
  anchorAt,
  anchorEvent,
  sourceTitle,
  graph,
  onClose,
  onCreate,
}: {
  seeds: string[]
  anchorAt?: string | null
  anchorEvent?: string
  sourceTitle: string
  graph: GraphStoreV2
  onClose: () => void
  onCreate: (source: Extract<Source, { kind: 'query' }>) => void
}) {
  const [hops, setHops] = useState<1 | 2>(1)
  const initialExp = useMemo(() => expandNeighbors(graph, seeds, { hops: 1 }), [graph, seeds])
  const allRelTypes = useMemo(() => Object.keys(initialExp.typeCounts), [initialExp])
  const [selectedRelTypes, setSelectedRelTypes] = useState<Set<string>>(() => new Set(allRelTypes))

  const isEventSeed = Boolean(anchorAt && !Number.isNaN(Date.parse(anchorAt)))
  const [eventWindow, setEventWindow] = useState<'1h' | '6h' | '24h'>('6h')
  const [normalWindow, setNormalWindow] = useState<'24h' | '7d'>('7d')

  const exp = useMemo(() => {
    return expandNeighbors(graph, seeds, {
      hops,
      relationTypes: [...selectedRelTypes],
    })
  }, [graph, seeds, hops, selectedRelTypes])

  const scopeRes = useMemo(() => {
    return neighborScope(exp, MAX_SCOPE_OBJECTS)
  }, [exp])

  const handleCreate = () => {
    let from: string
    let to: string
    if (isEventSeed) {
      const anchorMs = Date.parse(anchorAt!)
      const deltaMs = eventWindow === '1h' ? 3600_000 : eventWindow === '6h' ? 6 * 3600_000 : 24 * 3600_000
      const start = anchorMs - deltaMs
      const rawEnd = anchorMs + deltaMs
      const end = Math.ceil(rawEnd / (5 * 60_000)) * (5 * 60_000)
      from = new Date(Math.floor(start / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
      to = new Date(Math.floor(end / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    } else {
      const now = Date.now()
      const periodMs = normalWindow === '24h' ? 86400_000 : 7 * 86400_000
      const end = Math.ceil(now / (5 * 60_000)) * (5 * 60_000)
      const start = end - periodMs
      from = new Date(Math.floor(start / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
      to = new Date(Math.floor(end / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    }

    const title = `${sourceTitle} 이웃 타임라인`
    onCreate({
      id: crypto.randomUUID(),
      kind: 'query',
      title,
      scope: {
        from,
        to,
        objectKeys: scopeRes.objectKeys,
      },
      neighbors: {
        seeds,
        hops,
        relationTypes: [...selectedRelTypes],
        anchorAt: isEventSeed ? anchorAt! : undefined,
        anchorEvent,
        paths: Object.fromEntries(
          exp.objects
            .filter(o => scopeRes.objectKeys.includes(o.key))
            .map(o => [o.key, o.path]),
        ),
        dropped: scopeRes.dropped,
      },
      createdAt: new Date().toISOString(),
    })
  }

  return (
    <div className="eb-dialog-backdrop" role="dialog" aria-label="그래프 이웃 이벤트">
      <div className="eb-neighbor-dialog">
        <div className="eb-neighbor-dialog-head">
          <h2>그래프 이웃 이벤트</h2>
          <button type="button" className="ex-icon-btn" aria-label="닫기" title="대화창 닫기" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="eb-neighbor-dialog-body">
          <div className="eb-dialog-field">
            <span className="eb-dialog-label">시작 객체</span>
            <div className="eb-dialog-seeds-list">
              {seeds.map(s => (
                <span key={s} className="eb-dialog-seed-pill" title={s}>
                  {objectLabel(s, graph)}
                </span>
              ))}
            </div>
          </div>

          <div className="eb-dialog-field">
            <span className="eb-dialog-label">홉</span>
            <div className="eb-dialog-hops">
              <label title="관계 1홉 객체까지 보기">
                <input
                  type="radio"
                  name="eb-neighbor-hops"
                  value={1}
                  checked={hops === 1}
                  onChange={() => setHops(1)}
                  title="관계 1홉 객체까지 보기"
                />
                1홉
              </label>
              <label title="관계 2홉 객체까지 보기">
                <input
                  type="radio"
                  name="eb-neighbor-hops"
                  value={2}
                  checked={hops === 2}
                  onChange={() => setHops(2)}
                  title="관계 2홉 객체까지 보기"
                />
                2홉
              </label>
            </div>
          </div>

          <div className="eb-dialog-field">
            <span className="eb-dialog-label">관계 종류</span>
            <div className="eb-dialog-types-list">
              {allRelTypes.length === 0 ? (
                <span className="eb-empty-hint">주변 관계 없음</span>
              ) : (
                allRelTypes.map(t => (
                  <label key={t} className="eb-type-checkbox" title={`${t} 관계 탐색`}>
                    <input
                      type="checkbox"
                      checked={selectedRelTypes.has(t)}
                      title={`${t} 관계 탐색`}
                      onChange={e => {
                        const next = new Set(selectedRelTypes)
                        if (e.target.checked) next.add(t)
                        else next.delete(t)
                        setSelectedRelTypes(next)
                      }}
                    />
                    <span>{t} ({initialExp.typeCounts[t]})</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="eb-dialog-field">
            <label className="eb-dialog-label" htmlFor="eb-neighbor-window-sel">시간 창</label>
            {isEventSeed ? (
              <select
                id="eb-neighbor-window-sel"
                className="eb-select"
                value={eventWindow}
                onChange={e => setEventWindow(e.target.value as '1h' | '6h' | '24h')}
                title="조회할 시간 범위 선택"
              >
                <option value="1h">발생 시각 앞뒤 1시간</option>
                <option value="6h">발생 시각 앞뒤 6시간</option>
                <option value="24h">발생 시각 앞뒤 24시간</option>
              </select>
            ) : (
              <select
                id="eb-neighbor-window-sel"
                className="eb-select"
                value={normalWindow}
                onChange={e => setNormalWindow(e.target.value as '24h' | '7d')}
                title="조회할 시간 범위 선택"
              >
                <option value="24h">최근 24시간</option>
                <option value="7d">최근 7일</option>
              </select>
            )}
          </div>

          <div className="eb-dialog-preview">
            <div>
              미리보기: 이웃 <b>{exp.objects.length}</b>개, 조회 <b>{scopeRes.objectKeys.length}</b>개, 빠짐 <b>{scopeRes.dropped.length}</b>개
            </div>
            {exp.hubsSkipped.length > 0 && (
              <div className="eb-dialog-hubs-skipped">
                거쳐 가지 않은 허브: {exp.hubsSkipped.map(k => objectLabel(k, graph)).join(', ')}
              </div>
            )}
          </div>
        </div>

        <div className="eb-dialog-btns">
          <button type="button" className="eb-btn eb-btn-primary" onClick={handleCreate} title="선택한 조건으로 이웃 타임라인 조회 만들기">
            타임라인 만들기
          </button>
          <button type="button" className="eb-btn" onClick={onClose} title="대화창 닫기">
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

/** 새 조회 추가 대화창 */
function AddQueryDialog({
  subjects,
  graph,
  onClose,
  onCreate,
}: {
  subjects: SubjectCard[]
  graph: GraphStoreV2
  onClose: () => void
  onCreate: (source: Extract<Source, { kind: 'query' }>) => void
}) {
  const [period, setPeriod] = useState<'24h' | '7d' | 'custom'>('7d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [providers, setProviders] = useState<Set<string>>(() => new Set(['slack', 'github', 'okta', 'gws', 'salesforce', 'atlassian', 'microsoft', 'onepassword', 'snowflake', 'gcp']))
  const [selectedObjects, setSelectedObjects] = useState<Set<string>>(new Set())

  const availableObjects = useMemo(() => {
    const keys = new Set<string>()
    for (const s of subjects) {
      if (s.kind === 'object') keys.add(s.objectKey)
      if (s.kind === 'threat') {
        for (const k of s.objectKeys) keys.add(k)
      }
    }
    return Array.from(keys).filter(k => graph.objectsByKey.has(k))
  }, [subjects, graph])

  const handleCreate = () => {
    let from: string
    let to: string
    const now = Date.now()
    if (period === '24h') {
      const end = Math.ceil(now / (5 * 60_000)) * (5 * 60_000)
      const start = end - 86400_000
      from = new Date(Math.floor(start / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
      to = new Date(Math.floor(end / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    } else if (period === '7d') {
      const end = Math.ceil(now / (5 * 60_000)) * (5 * 60_000)
      const start = end - 7 * 86400_000
      from = new Date(Math.floor(start / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
      to = new Date(Math.floor(end / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    } else {
      const fMs = Date.parse(customFrom)
      const tMs = Date.parse(customTo)
      if (Number.isNaN(fMs) || Number.isNaN(tMs) || fMs >= tMs) return
      const maxMs = 7 * 86400_000
      const actualEnd = Math.min(tMs, fMs + maxMs)
      from = new Date(fMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
      to = new Date(actualEnd).toISOString().replace(/\.\d{3}Z$/, 'Z')
    }

    const objKeys = Array.from(selectedObjects).slice(0, MAX_SCOPE_OBJECTS)
    const provs = providers.size < 8 ? Array.from(providers) : undefined
    const title = objKeys.length > 0
      ? `${objKeys.map(k => objectLabel(k, graph)).slice(0, 2).join(', ')}${objKeys.length > 2 ? ` 외 ${objKeys.length - 2}개` : ''} 조회`
      : '기간 조회'

    onCreate({
      id: crypto.randomUUID(),
      kind: 'query',
      title,
      scope: {
        from,
        to,
        objectKeys: objKeys,
        ...(provs ? { providers: provs } : {}),
      },
      createdAt: new Date().toISOString(),
    })
  }

  return (
    <div className="eb-dialog-backdrop" role="dialog" aria-label="조회 추가">
      <div className="eb-dialog eb-add-query-dialog">
        <div className="eb-dialog-head">
          <h2>새 이벤트 조회 추가</h2>
          <button type="button" className="ex-icon-btn" aria-label="닫기" title="대화창 닫기" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="eb-dialog-body">
          <div className="eb-dialog-field">
            <span className="eb-dialog-label">조회 기간</span>
            <div className="eb-dialog-radios">
              <label title="최근 24시간 조회">
                <input type="radio" name="eb-aq-period" checked={period === '24h'} onChange={() => setPeriod('24h')} title="최근 24시간 조회" />
                24시간
              </label>
              <label title="최근 7일 조회">
                <input type="radio" name="eb-aq-period" checked={period === '7d'} onChange={() => setPeriod('7d')} title="최근 7일 조회" />
                7일
              </label>
              <label title="최대 7일 기간 직접 입력">
                <input type="radio" name="eb-aq-period" checked={period === 'custom'} onChange={() => setPeriod('custom')} title="최대 7일 기간 직접 입력" />
                최대 7일 직접 입력
              </label>
            </div>
            {period === 'custom' && (
              <div className="eb-dialog-custom-time">
                <input
                  type="datetime-local"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  aria-label="시작 시각"
                  title="시작 시각 입력"
                />
                <span>~</span>
                <input
                  type="datetime-local"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  aria-label="종료 시각"
                  title="종료 시각 입력"
                />
              </div>
            )}
          </div>

          <div className="eb-dialog-field">
            <span className="eb-dialog-label">SaaS 선택</span>
            <div className="eb-dialog-checkbox-group">
              {(['slack', 'github', 'okta', 'gws', 'salesforce', 'atlassian', 'microsoft', 'onepassword', 'snowflake', 'gcp'] as const).map(p => (
                <label key={p} className="eb-dialog-checkbox-item" title={`${providerName(p)} 포함`}>
                  <input
                    type="checkbox"
                    checked={providers.has(p)}
                    title={`${providerName(p)} 포함`}
                    onChange={e => {
                      const next = new Set(providers)
                      if (e.target.checked) next.add(p)
                      else next.delete(p)
                      setProviders(next)
                    }}
                  />
                  <span>{providerName(p)}</span>
                </label>
              ))}
            </div>
          </div>

          {availableObjects.length > 0 && (
            <div className="eb-dialog-field">
              <span className="eb-dialog-label">조사 대상 객체 선택, 생략 가능</span>
              <div className="eb-dialog-objects-list">
                {availableObjects.map(k => (
                  <label key={k} className="eb-dialog-checkbox-item" title={objectLabel(k, graph)}>
                    <input
                      type="checkbox"
                      checked={selectedObjects.has(k)}
                      title={objectLabel(k, graph)}
                      onChange={e => {
                        const next = new Set(selectedObjects)
                        if (e.target.checked) next.add(k)
                        else next.delete(k)
                        setSelectedObjects(next)
                      }}
                    />
                    <span>{objectLabel(k, graph)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="eb-dialog-btns">
          <button type="button" className="eb-btn eb-btn-primary" onClick={handleCreate} title="새 이벤트 조회 실행">
            조회 만들기
          </button>
          <button type="button" className="eb-btn" onClick={onClose} title="대화창 닫기">
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

/** 전체 기간 미니맵 개요 띠 */
function OverviewStrip({
  events,
  axis,
  scrollLeft,
  viewportWidth,
  newRange,
  onScrollTo,
  onSelectRange,
}: {
  events: TimelineEvent[]
  axis: Axis
  scrollLeft: number
  viewportWidth: number
  newRange: { start: number; end: number; until: number } | null
  onScrollTo: (x: number) => void
  onSelectRange: (range: [number, number]) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ frac: number; t: number } | null>(null)
  const [drag, setDrag] = useState<{ startFrac: number; curFrac: number; moved: boolean } | null>(null)
  const dragRef = useRef<{ startPx: number; startFrac: number; curFrac: number; moved: boolean } | null>(null)

  const timedEvents = useMemo(() => {
    return events
      .filter(e => Boolean(e.occurred_at && !Number.isNaN(Date.parse(e.occurred_at))))
      .map(e => ({
        origin_key: e.origin_key,
        t: Date.parse(e.occurred_at!),
        provider: e.provider,
      }))
  }, [events])

  const totalBoardWidth = axis.width
  const contentLeft = LANE_HEADER_PX
  const contentSpan = Math.max(1, totalBoardWidth - contentLeft)
  const toFrac = (x: number) => Math.max(0, Math.min(1, (x - contentLeft) / contentSpan))
  const visibleStartFrac = toFrac(scrollLeft + contentLeft)
  const visibleEndFrac = toFrac(scrollLeft + viewportWidth)

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      const tr = trackRef.current
      if (!d || !tr) return
      const rect = tr.getBoundingClientRect()
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)))
      const moved = d.moved || Math.abs(e.clientX - d.startPx) > 6
      dragRef.current = { ...d, curFrac: frac, moved }
      setDrag({ startFrac: d.startFrac, curFrac: frac, moved })
    }
    const onUp = () => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d) return
      if (d.moved) {
        const f0 = Math.min(d.startFrac, d.curFrac)
        const f1 = Math.max(d.startFrac, d.curFrac)
        const tA = axis.invert(contentLeft + f0 * contentSpan)
        const tB = axis.invert(contentLeft + f1 * contentSpan)
        if (tA !== null && tB !== null) {
          let minT = Math.min(tA, tB)
          let maxT = Math.max(tA, tB)
          if (maxT - minT < 1000) {
            const mid = (minT + maxT) / 2
            minT = mid - 500
            maxT = mid + 500
          }
          onSelectRange([Math.floor(minT), Math.ceil(maxT)])
        }
      } else {
        const targetScroll = d.startFrac * contentSpan - Math.max(0, viewportWidth - contentLeft) / 2
        onScrollTo(Math.max(0, targetScroll))
      }
    }
    const onCancel = () => {
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [axis, contentLeft, contentSpan, onScrollTo, onSelectRange, viewportWidth])

  const showNewRange = Boolean(newRange && Date.now() < newRange.until)

  return (
    <div
      className="eb-overview-strip"
      role="region"
      aria-label="전체 기간 미니맵"
      title="클릭하면 이동하고, 드래그하면 해당 시간 구간으로 확대합니다"
    >
      <div className="eb-overview-corner">전체 기간</div>
      <div
        ref={trackRef}
        className="eb-overview-track"
        onPointerDown={e => {
          if (e.button !== 0 || !trackRef.current) return
          const rect = trackRef.current.getBoundingClientRect()
          const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)))
          dragRef.current = { startPx: e.clientX, startFrac: frac, curFrac: frac, moved: false }
          setDrag({ startFrac: frac, curFrac: frac, moved: false })
        }}
        onPointerMove={e => {
          if (!trackRef.current) return
          const rect = trackRef.current.getBoundingClientRect()
          const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)))
          const t = axis.invert(contentLeft + frac * contentSpan)
          setHover(t !== null ? { frac, t } : null)
        }}
        onPointerLeave={() => setHover(null)}
      >
        {/* 점 밀도 */}
        <div className="eb-overview-dots" aria-hidden="true">
          {timedEvents.slice(0, 1000).map(e => {
            const frac = toFrac(axis.x(e.t))
            return (
              <span
                key={e.origin_key}
                className={`eb-overview-dot prov-${e.provider}`}
                style={{ left: `${frac * 100}%` }}
              />
            )
          })}
        </div>

        {/* 접힌 구간 표시 */}
        {axis.gaps.map(g => {
          const xFrac = toFrac(g.x0)
          const wFrac = Math.max(0, toFrac(g.x1) - xFrac)
          return (
            <div
              key={g.index}
              className="eb-overview-gap"
              style={{ left: `${xFrac * 100}%`, width: `${Math.max(wFrac * 100, 1)}%` }}
              title={`생략: ${g.label}`}
            >
              ≈
            </div>
          )
        })}

        {/* 새 범위 강조 (3초간) */}
        {showNewRange && newRange && (
          <div
            className="eb-overview-new-range"
            style={{
              left: `${toFrac(axis.x(newRange.start)) * 100}%`,
              width: `${Math.max(2, (toFrac(axis.x(newRange.end)) - toFrac(axis.x(newRange.start))) * 100)}%`,
            }}
            title="새로 추가된 이벤트 범위"
          />
        )}

        {/* 현재 보이는 스크롤 범위 상자 */}
        {totalBoardWidth > viewportWidth + 1 && (
          <div
            className="eb-overview-viewport"
            style={{
              left: `${visibleStartFrac * 100}%`,
              width: `${Math.max(1, (visibleEndFrac - visibleStartFrac) * 100)}%`,
            }}
            title="현재 보이는 범위"
          />
        )}

        {/* 드래그 구간 선택 표시 */}
        {drag?.moved && (
          <div
            className="eb-overview-brush"
            style={{
              left: `${Math.min(drag.startFrac, drag.curFrac) * 100}%`,
              width: `${Math.max(0.5, Math.abs(drag.curFrac - drag.startFrac) * 100)}%`,
            }}
          />
        )}

        {/* 호버 시각 배지 */}
        {hover && (
          <div className="eb-axis-hover-badge" style={{ left: `${hover.frac * 100}%` }}>
            {formatKstFull(Math.round(hover.t))} KST
          </div>
        )}
      </div>
    </div>
  )
}

/** 연결선 호버 또는 클릭 시 뜨는 연결 설명 상자 */
function LinkPopover({
  link,
  fromEv,
  toEv,
  graph,
  anchorX,
  anchorY,
  pinned,
  onClose,
  onSelectEvent,
  onEditAnalyst,
}: {
  link: BoardLink
  fromEv?: TimelineEvent
  toEv?: TimelineEvent
  graph: GraphStoreV2
  anchorX: number
  anchorY: number
  pinned: boolean
  onClose: () => void
  onSelectEvent: (key: string) => void
  onEditAnalyst?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: anchorY + 12,
    left: anchorX + 12,
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vpW = window.innerWidth
    const vpH = window.innerHeight
    let left = anchorX + 12
    if (left + rect.width > vpW - 8) left = anchorX - 12 - rect.width
    left = Math.max(8, Math.min(vpW - rect.width - 8, left))
    let top = anchorY + 12
    if (top + rect.height > vpH - 8) top = anchorY - 12 - rect.height
    top = Math.max(8, Math.min(vpH - rect.height - 8, top))
    setPos({ top, left })
  }, [anchorX, anchorY, link.id, pinned])

  const fromT = fromEv?.occurred_at ? Date.parse(fromEv.occurred_at) : NaN
  const toT = toEv?.occurred_at ? Date.parse(toEv.occurred_at) : NaN
  const gapStr = !Number.isNaN(fromT) && !Number.isNaN(toT) ? flowGap(Math.abs(toT - fromT)) : null

  return createPortal(
    <div
      ref={ref}
      role={pinned ? 'dialog' : 'tooltip'}
      aria-label="연결 설명"
      className={`eb-link-popover ${pinned ? 'is-pinned' : 'is-hover-only'}`}
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="eb-link-popover-head">
        <svg width="24" height="8" aria-hidden="true" className="eb-link-sample">
          <line x1="0" y1="4" x2="24" y2="4" className={`eb-link-path is-selected-link kind-${link.kind}`} />
        </svg>
        <strong>{LINK_KIND_LABELS[link.kind]}</strong>
        {link.strength === 'review' && <span className="tl-badge eb-reason-review">추가 확인</span>}
        {pinned && (
          <button
            type="button"
            className="ex-icon-btn eb-link-popover-close"
            aria-label="연결 설명 닫기"
            title="닫기"
            onClick={onClose}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="eb-link-popover-desc">{describeBoardLink(link, graph)}</p>
      <dl className="eb-link-popover-endpoints">
        <dt>출발</dt>
        <dd>{fromEv ? `[${providerName(fromEv.provider)}] ${fromEv.title || fromEv.event_type}${!Number.isNaN(fromT) ? ` (${formatTime(fromT)})` : ''}` : link.from}</dd>
        <dt>도착</dt>
        <dd>{toEv ? `[${providerName(toEv.provider)}] ${toEv.title || toEv.event_type}${!Number.isNaN(toT) ? ` (${formatTime(toT)})` : ''}` : link.to}</dd>
        {gapStr && (
          <>
            <dt>시간차</dt>
            <dd>{gapStr}</dd>
          </>
        )}
      </dl>
      {pinned && (
        <div className="eb-link-popover-actions">
          <button type="button" className="eb-btn eb-btn-xs" onClick={() => onSelectEvent(link.from)}>
            출발 이벤트 선택
          </button>
          <button type="button" className="eb-btn eb-btn-xs" onClick={() => onSelectEvent(link.to)}>
            도착 이벤트 선택
          </button>
          {link.kind === 'analyst' && onEditAnalyst && (
            <button type="button" className="eb-btn eb-btn-xs eb-btn-primary" onClick={onEditAnalyst}>
              연결 수정
            </button>
          )}
        </div>
      )}
    </div>,
    document.body,
  )
}

/** 줄 머리(SaaS 이름) 폭. event-board.css 의 .eb-lane-header 와 같다 */
const LANE_HEADER_PX = 112

export default function EventBoardPage({
  dataset,
  backend,
  graph,
  findings,
  evidenceStore,
  snapshotId,
  onOpenObject,
  onShowEventGraph,
}: EventBoardPageProps) {
  const storageKey = `aegi:event-board:${dataset}:${snapshotId ?? 'local'}`

  // 화면 전환 시 보존된 상태 복원
  const [restored] = useState(() => {
    // 다른 화면에 다녀오거나 새로고침해도 보드를 잇는다. 주소에 새 진입 조건이 있으면 그 조회를 이 보드에 더한다
    return kept.get(storageKey) ?? readDraft(storageKey)
  })

  // 1. 보드 상태 및 조사 메타데이터
  const [board, setBoard] = useState<BoardV3>(() => restored?.board ?? emptyBoardV3())
  const [state, setState] = useState<InvestigationState>(() => restored?.state ?? 'open')
  const [owner, setOwner] = useState<string>(() => restored?.owner ?? '')
  const [conclusion, setConclusion] = useState<string>(() => restored?.conclusion ?? '')
  const [notice, setNotice] = useState('')
  // 알림은 8초 뒤 저절로 닫는다
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 8000)
    return () => clearTimeout(t)
  }, [notice])
  const [generation, setGeneration] = useState(0)

  // 2. 출처별 질의 결과
  const [sourceResults, setSourceResults] = useState<Record<string, SourceResult>>(() => restored?.sourceResults ?? {})
  const [extraEngineLinks, setExtraEngineLinks] = useState<EventLink[]>([])

  // 3. UI 뷰 상태
  const [sidePanelOpen, setSidePanelOpen] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 1500 : true)
  const [sideWidth, setSideWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return SIDE_WIDTH_DEFAULT
    try {
      const stored = Number(window.localStorage.getItem(SIDE_WIDTH_STORAGE_KEY))
      return Number.isFinite(stored) && stored > 0 ? clampSideWidth(stored) : SIDE_WIDTH_DEFAULT
    } catch {
      return SIDE_WIDTH_DEFAULT
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDE_WIDTH_STORAGE_KEY, String(sideWidth))
    } catch { /* 저장소를 못 쓰면 이번 창에서만 쓴다 */ }
  }, [sideWidth])
  useEffect(() => {
    const onResize = () => setSideWidth(prev => clampSideWidth(prev))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const handleSideResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !sidePanelOpen) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sideWidth
    document.body.classList.add('eb-side-resizing')
    const onMove = (ev: PointerEvent) => {
      setSideWidth(clampSideWidth(startWidth + (startX - ev.clientX)))
    }
    const onUp = () => {
      document.body.classList.remove('eb-side-resizing')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  const handleSideResizeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setSideWidth(prev => clampSideWidth(prev + SIDE_WIDTH_STEP))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setSideWidth(prev => clampSideWidth(prev - SIDE_WIDTH_STEP))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setSideWidth(clampSideWidth(SIDE_WIDTH_DEFAULT))
    }
  }
  const [sideTab, setSideTab] = useState<SideTab>(() => (restored?.selectedEventKey ? 'detail' : 'sources'))
  const [selectedEventKey, setSelectedEventKey] = useState<string | null>(() => restored?.selectedEventKey ?? null)
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null)
  const [hoveredLink, setHoveredLink] = useState<{ id: string; x: number; y: number } | null>(null)
  const [selectedLink, setSelectedLink] = useState<{ id: string; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!selectedLink) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (!t?.closest?.('.eb-link-popover, .eb-link-group')) setSelectedLink(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [selectedLink])
  // 이벤트를 고르면 오른쪽 칸을 펴고 상세 탭으로, 고른 것을 풀면 상세 탭 대신 출처 탭으로
  useEffect(() => {
    if (selectedEventKey) {
      setSideTab('detail')
      setSidePanelOpen(true)
    } else {
      setSideTab(t => (t === 'detail' ? 'sources' : t))
    }
  }, [selectedEventKey])

  // 동적 메인 레이아웃 높이 계산
  const mainLayoutRef = useRef<HTMLDivElement>(null)
  const [mainLayoutHeight, setMainLayoutHeight] = useState<number>(600)

  const updateMainLayoutHeight = useCallback(() => {
    const el = mainLayoutRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const layoutTop = rect.top + window.scrollY
    const h = Math.round(Math.max(480, window.innerHeight - layoutTop - 16))
    setMainLayoutHeight(prev => (prev === h ? prev : h))
  }, [])

  // 위쪽 줄(알림, 거르기, 범례)이 렌더마다 높이가 바뀔 수 있어 그릴 때마다 다시 잰다. 값이 같으면 다시 그리지 않는다
  useLayoutEffect(() => {
    updateMainLayoutHeight()
  })

  useEffect(() => {
    updateMainLayoutHeight()
    window.addEventListener('resize', updateMainLayoutHeight)
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && mainLayoutRef.current) {
      ro = new ResizeObserver(() => {
        updateMainLayoutHeight()
      })
      let prev = mainLayoutRef.current.previousElementSibling
      while (prev) {
        ro.observe(prev)
        prev = prev.previousElementSibling
      }
    }
    return () => {
      window.removeEventListener('resize', updateMainLayoutHeight)
      if (ro) ro.disconnect()
    }
  }, [updateMainLayoutHeight])

  // 이벤트 카드 호버 상자 상태
  const [hoveredCard, setHoveredCard] = useState<{
    eventKey: string
    anchorRect: { top: number; left: number; right: number; bottom: number; width: number; height: number }
    repeatCount: number
  } | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHover = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHoveredCard(null)
  }, [])

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [])
  const [showFlowOnly, setShowFlowOnly] = useState(false)
  const [zoom, setZoom] = useState(() => board.view.zoom ?? 1.0)
  const [timeRange, setTimeRange] = useState<[number, number] | null>(() => board.view.timeRange ?? null)
  const [brushDrag, setBrushDrag] = useState<{ startX: number; curX: number } | null>(null)
  const [hoverAxisTime, setHoverAxisTime] = useState<{ x: number; t: number } | null>(null)
  const [expandedGaps, setExpandedGaps] = useState<number[]>([])
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set())
  const [newRange, setNewRange] = useState<{ start: number; end: number; until: number } | null>(null)

  // 4. 모달 상태
  const [showSavedList, setShowSavedList] = useState(false)
  const [showCandidates, setShowCandidates] = useState(false)
  const [showAddQuery, setShowAddQuery] = useState(false)
  const [showInfoMenu, setShowInfoMenu] = useState(false)
  const [showAddMenu, setShowAddMenu] = useState(false)
  // 추가 메뉴도 메뉴 밖을 누르면 닫는다
  useEffect(() => {
    if (!showAddMenu) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (!t?.closest?.('.eb-add-menu-wrapper')) setShowAddMenu(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [showAddMenu])
  // 펼친 메뉴는 메뉴 밖을 누르면 닫는다
  useEffect(() => {
    if (!showInfoMenu) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (!t?.closest?.('.eb-info-menu-wrapper')) setShowInfoMenu(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [showInfoMenu])
  const [neighborDialog, setNeighborDialog] = useState<{
    seeds: string[]
    anchorAt?: string | null
    anchorEvent?: string
    title: string
  } | null>(null)
  const [linkingFromKey, setLinkingFromKey] = useState<string | null>(null)
  const [linkingPending, setLinkingPending] = useState<{ from: string; to: string } | null>(null)
  const [linkingNote, setLinkingNote] = useState('')
  const [editingUserLink, setEditingUserLink] = useState<{ id: string; note: string } | null>(null)

  // 5. 스크롤 및 뷰포트
  const boardScrollRef = useRef<HTMLDivElement>(null)
  const boardTimelineRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(1000)
  const [scrollLeft, setScrollLeft] = useState(0)
  const lastProcessedHashRef = useRef<string>(restored ? restored.hash : '')
  const allBoardEventsRef = useRef<TimelineEvent[]>([])

  // 6. 처리자 (localStorage 연동)
  const [actor, setActor] = useState(() => {
    try {
      return localStorage.getItem(ACTOR_STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const handleActorChange = (val: string) => {
    setActor(val)
    try {
      localStorage.setItem(ACTOR_STORAGE_KEY, val)
    } catch {}
  }

  // 7. 팀 저장소 연동
  const investigationsStore = useInvestigations(dataset, backend)
  useEffect(() => {
    if (investigationsStore.notice?.text) {
      setNotice(investigationsStore.notice.text)
    }
  }, [investigationsStore.notice])

  // 8. AI 연동
  const [aiOpen, setAiOpen] = useState(false)
  const [seed, setSeed] = useState<AssistantSeed>()
  const [shell] = useState(() => document.querySelector<HTMLElement>('.app-shell'))
  const openAiForAdd = useCallback(() => {
    setShowAddMenu(false)
    setShowAddQuery(false)
    setAiOpen(true)
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.ei-assistant #assistant-question')?.focus())
  }, [])
  useEffect(() => {
    // detail.question 이 있으면 그 질문을 바로 보낸다(공개 데모 단계 안내의 추천 질문)
    const open = (event: Event) => {
      setAiOpen(true)
      const question = (event as CustomEvent<{ question?: string } | undefined>).detail?.question
      if (question) { setSeed(previous => ({ id: (previous?.id ?? 0) + 1, selection: emptySelection(), question, submit: true })); return }
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.ei-assistant #assistant-question')?.focus())
    }
    window.addEventListener('aegi:event-board-ai', open)
    return () => window.removeEventListener('aegi:event-board-ai', open)
  }, [])
  useEffect(() => { if (seed) setAiOpen(true) }, [seed])

  // 화면 전환 시 상태 보존
  useEffect(() => {
    const viewWithZoom: BoardV3['view'] = {
      ...board.view,
      ...(zoom !== 1 ? { zoom } : { zoom: undefined }),
      ...(timeRange ? { timeRange } : { timeRange: undefined }),
    }
    const k = {
      board: { ...board, view: viewWithZoom },
      sourceResults,
      selectedEventKey,
      state,
      owner,
      conclusion,
      hash: lastProcessedHashRef.current || location.hash,
    }
    kept.set(storageKey, k)
    writeDraft(storageKey, k)
  }, [storageKey, board, zoom, timeRange, sourceResults, selectedEventKey, state, owner, conclusion])

  // 뷰포트 크기 감지
  useEffect(() => {
    const updateSize = () => {
      if (boardScrollRef.current) {
        setViewportWidth(boardScrollRef.current.clientWidth)
      }
    }
    updateSize()
    // 보드가 빈 상태에서 처음 그려지면 ref 가 늦게 붙으므로 크기 변화를 따로 본다
    const observer = typeof ResizeObserver !== 'undefined' && boardScrollRef.current ? new ResizeObserver(updateSize) : null
    if (observer && boardScrollRef.current) observer.observe(boardScrollRef.current)
    window.addEventListener('resize', updateSize)
    return () => { observer?.disconnect(); window.removeEventListener('resize', updateSize) }
  }, [])

  // Escape 키로 선택 해제 및 모달 닫기
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (linkingFromKey) {
          setLinkingFromKey(null)
        } else if (linkingPending) {
          setLinkingPending(null)
        } else if (editingUserLink) {
          setEditingUserLink(null)
        } else if (showSavedList) {
          setShowSavedList(false)
        } else if (showCandidates) {
          setShowCandidates(false)
        } else if (showAddQuery) {
          setShowAddQuery(false)
        } else if (showInfoMenu) {
          setShowInfoMenu(false)
        } else if (showAddMenu) {
          setShowAddMenu(false)
        } else if (neighborDialog) {
          setNeighborDialog(null)
        } else if (selectedLink) {
          setSelectedLink(null)
        } else if (selectedEventKey) {
          setSelectedEventKey(null)
          setShowFlowOnly(false)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [linkingFromKey, linkingPending, editingUserLink, showSavedList, showCandidates, showAddQuery, showInfoMenu, showAddMenu, neighborDialog, selectedLink, selectedEventKey])

  // --------------------------------------------------------------------------
  // 질의 실행 함수
  // --------------------------------------------------------------------------
  const runQuerySource = useCallback((sourceId: string, scope: QueryScope) => {
    setSourceResults(prev => ({
      ...prev,
      [sourceId]: { loading: true, events: [], problem: null, progress: null },
    }))

    void loadTimelineEvents(
      '/api/measured/graph',
      scope,
      partial => {
        setSourceResults(prev => ({
          ...prev,
          [sourceId]: {
            loading: true,
            events: partial.events,
            problem: partial.problem ?? null,
            progress: partial.progress ?? null,
          },
        }))
      },
    ).then(source => {
      const events = source.events

      setSourceResults(prev => ({
        ...prev,
        [sourceId]: {
          loading: false,
          events,
          links: source.links ?? undefined,
          problem: source.problem ?? null,
          progress: null,
        },
      }))

      if (events.length > 0) {
        const times = events
          .map(e => (e.occurred_at ? Date.parse(e.occurred_at) : NaN))
          .filter(t => !Number.isNaN(t))
        if (times.length > 0) {
          let minT = times[0]!
          let maxT = times[0]!
          for (let i = 1; i < times.length; i++) {
            const t = times[i]!
            if (t < minT) minT = t
            if (t > maxT) maxT = t
          }
          setNewRange({ start: minT, end: maxT, until: Date.now() + 3000 })
        }
      }
    })
  }, [])

  // 조사를 처음 열 때 저장된 쿼리 출처 자동 재실행
  const executedSourcesRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const s of board.sources) {
      if (s.kind === 'query' && !executedSourcesRef.current.has(s.id) && !sourceResults[s.id]?.events?.length && !sourceResults[s.id]?.loading) {
        executedSourcesRef.current.add(s.id)
        runQuerySource(s.id, s.scope)
      }
    }
  }, [board.sources, runQuerySource, sourceResults])

  // --------------------------------------------------------------------------
  // 해시 진입점 처리
  // --------------------------------------------------------------------------
  useEffect(() => {
    const handleHash = () => {
      const currentHash = location.hash
      if (!/^#event-board/i.test(currentHash)) return
      if (lastProcessedHashRef.current === currentHash) return
      lastProcessedHashRef.current = currentHash
      const q = new URLSearchParams(currentHash.split('?')[1] ?? '')

      const neighborsParam = q.get('neighbors')
      const findingId = q.get('finding')
      const configParam = q.get('config')
      const objectParam = q.get('objects') || q.get('object')
      const eventParam = q.get('event')
      const atParam = q.get('at')
      const daysParam = q.get('days')

      if (neighborsParam) {
        const rawSeeds = neighborsParam.split(',').map(s => s.trim()).filter(Boolean)
        const seeds = rawSeeds.filter(k => graph.objectsByKey.has(k))
        if (seeds.length > 0) {
          const at = q.get('at')
          const eventKey = q.get('event') ?? undefined
          const atMs = at ? Date.parse(at) : NaN

          let from: string
          let to: string
          if (!Number.isNaN(atMs)) {
            const deltaMs = 6 * 3600_000
            const start = atMs - deltaMs
            const rawEnd = atMs + deltaMs
            const end = Math.ceil(rawEnd / (5 * 60_000)) * (5 * 60_000)
            from = new Date(Math.floor(start / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
            to = new Date(Math.floor(end / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
          } else {
            const now = Date.now()
            const end = Math.ceil(now / (5 * 60_000)) * (5 * 60_000)
            const start = end - 7 * 86400_000
            from = new Date(Math.floor(start / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
            to = new Date(Math.floor(end / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
          }

          const exp = expandNeighbors(graph, seeds, { hops: 1 })
          const scopeRes = neighborScope(exp, MAX_SCOPE_OBJECTS)

          const newSubjects: SubjectCard[] = seeds.map(s => ({
            id: crypto.randomUUID(),
            kind: 'object',
            objectKey: s,
            label: objectLabel(s, graph),
            createdAt: new Date().toISOString(),
          }))

          const title = seeds.length === 1
            ? `${objectLabel(seeds[0]!, graph)} 이웃 타임라인`
            : `그래프 이웃 타임라인 (${seeds.length}개 객체)`

          const newSource: Source = {
            id: crypto.randomUUID(),
            kind: 'query',
            title,
            scope: {
              from,
              to,
              objectKeys: scopeRes.objectKeys,
            },
            neighbors: {
              seeds,
              hops: 1,
              relationTypes: Object.keys(exp.typeCounts),
              anchorAt: !Number.isNaN(atMs) ? at! : undefined,
              anchorEvent: eventKey,
              paths: Object.fromEntries(
                exp.objects
                  .filter(o => scopeRes.objectKeys.includes(o.key))
                  .map(o => [o.key, o.path]),
              ),
              dropped: scopeRes.dropped,
            },
            createdAt: new Date().toISOString(),
          }

          setBoard(b => ({
            ...b,
            subjects: [...b.subjects, ...newSubjects],
            sources: [...b.sources, newSource],
          }))
          executedSourcesRef.current.add(newSource.id)
          runQuerySource(newSource.id, newSource.scope)
          if (eventKey) {
            setSelectedEventKey(eventKey)
          }
          setNotice('그래프 이웃 이벤트 조사를 시작했습니다.')
        }
      } else if (findingId) {
        const finding = findings.find(f => f.id === findingId)
        if (finding) {
          const tc = threatFromFinding(finding)
          const threatSubj: SubjectCard = {
            id: crypto.randomUUID(),
            kind: 'threat',
            source: 'finding',
            refId: finding.id,
            title: tc.title,
            severity: tc.severity,
            objectKeys: tc.objectKeys,
            relationKeys: tc.relationKeys,
            outsidePeople: tc.outsidePeople,
            createdAt: new Date().toISOString(),
          }
          const { scope } = scopeFor(tc.objectKeys, '7d')
          const newSource: Source = {
            id: crypto.randomUUID(),
            kind: 'query',
            title: `${tc.title}, 최근 7일`,
            scope,
            createdAt: new Date().toISOString(),
          }
          setBoard(b => ({
            ...b,
            subjects: [...b.subjects, threatSubj],
            sources: [...b.sources, newSource],
          }))
          executedSourcesRef.current.add(newSource.id)
          runQuerySource(newSource.id, scope)
          setNotice(`위협 "${finding.title}" 조사를 시작했습니다.`)
        }
      } else if (configParam) {
        const [fId, iId] = configParam.split(':')
        const results = getStandardResults()
        const sf = results?.findings.find(f => f.id === fId)
        const item = sf?.items.find(i => i.item_id === iId)
        if (sf && item) {
          const built = threatFromConfigItem(sf, item)
          const validKeys = built.objectKeys.filter(k => graph.objectsByKey.has(k))
          const threatSubj: SubjectCard = {
            id: crypto.randomUUID(),
            kind: 'threat',
            source: 'config',
            refId: `${fId}:${iId}`,
            title: built.title,
            severity: built.severity,
            objectKeys: validKeys,
            relationKeys: built.relationKeys,
            outsidePeople: built.outsidePeople,
            createdAt: new Date().toISOString(),
          }
          const { scope } = scopeFor(validKeys, '7d')
          const newSource: Source = {
            id: crypto.randomUUID(),
            kind: 'query',
            title: `${built.title}, 최근 7일`,
            scope,
            createdAt: new Date().toISOString(),
          }
          setBoard(b => ({
            ...b,
            subjects: [...b.subjects, threatSubj],
            sources: [...b.sources, newSource],
          }))
          executedSourcesRef.current.add(newSource.id)
          runQuerySource(newSource.id, scope)
          setNotice(`설정 위반 항목 "${item.title}" 조사를 시작했습니다.`)
        }
      } else if (eventParam && objectParam && atParam) {
        const atMs = Date.parse(atParam)
        if (!Number.isNaN(atMs)) {
          const deltaMs = 6 * 3600_000
          const start = atMs - deltaMs
          const rawEnd = atMs + deltaMs
          const end = Math.ceil(rawEnd / (5 * 60_000)) * (5 * 60_000)
          const from = new Date(Math.floor(start / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
          const to = new Date(Math.floor(end / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
          const keys = objectParam.split(',').map(s => s.trim()).filter(k => graph.objectsByKey.has(k)).slice(0, MAX_SCOPE_OBJECTS)
          const newSubjects: SubjectCard[] = keys.map(k => ({
            id: crypto.randomUUID(),
            kind: 'object',
            objectKey: k,
            label: objectLabel(k, graph),
            createdAt: new Date().toISOString(),
          }))
          const newSource: Source = {
            id: crypto.randomUUID(),
            kind: 'query',
            title: `이벤트 조사, 앞뒤 6시간`,
            scope: {
              from,
              to,
              objectKeys: keys,
            },
            createdAt: new Date().toISOString(),
          }
          setBoard(b => ({
            ...b,
            subjects: [...b.subjects, ...newSubjects],
            sources: [...b.sources, newSource],
          }))
          executedSourcesRef.current.add(newSource.id)
          runQuerySource(newSource.id, newSource.scope)
          setSelectedEventKey(eventParam)
          setNotice('이벤트 조사를 시작했습니다.')
        }
      } else if (eventParam && !objectParam && !atParam) {
        const exists = allBoardEventsRef.current.some(e => e.origin_key === eventParam)
        if (exists) {
          setSelectedEventKey(eventParam)
        } else {
          // 보드에 없어도 고른 이벤트로 둔다. AI 창이 이 키로 그 이벤트를 직접 조회한다
          setSelectedEventKey(eventParam)
          setNotice('이 이벤트를 찾을 조회 범위가 없습니다. 「추가」의 「기간으로 이벤트 추가하기」로 기간을 정하세요')
        }
      } else if (objectParam) {
        const keys = objectParam.split(',').map(s => s.trim()).filter(k => graph.objectsByKey.has(k))
        if (keys.length > 0) {
          const days = Number(daysParam) || 7
          const newSubjects: SubjectCard[] = keys.map(k => ({
            id: crypto.randomUUID(),
            kind: 'object',
            objectKey: k,
            label: objectLabel(k, graph),
            createdAt: new Date().toISOString(),
          }))
          const { scope } = scopeFor(keys, days === 1 ? '24h' : days === 30 ? '30d' : '7d')
          const newSource: Source = {
            id: crypto.randomUUID(),
            kind: 'query',
            title: `${keys.map(k => objectLabel(k, graph)).slice(0, 2).join(', ')}, 최근 ${days}일`,
            scope,
            createdAt: new Date().toISOString(),
          }
          setBoard(b => ({
            ...b,
            subjects: [...b.subjects, ...newSubjects],
            sources: [...b.sources, newSource],
          }))
          executedSourcesRef.current.add(newSource.id)
          runQuerySource(newSource.id, scope)
          setNotice('객체 관련 조사를 시작했습니다.')
        }
      }
    }

    handleHash()
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [findings, graph, runQuerySource])

  // --------------------------------------------------------------------------
  // 보드 이벤트 수집 및 거르기
  // --------------------------------------------------------------------------
  const allBoardEvents = useMemo(() => {
    const map = new Map<string, TimelineEvent>()
    for (const s of board.sources) {
      if (board.view.hiddenSources.includes(s.id)) continue
      if (s.kind === 'query') {
        const res = sourceResults[s.id]
        if (res && res.events) {
          for (const ev of res.events) {
            map.set(ev.origin_key, ev)
          }
        }
      } else if (s.kind === 'ai') {
        if (s.events) {
          for (const ev of s.events) {
            map.set(ev.origin_key, boardEventFromSnapshot(ev))
          }
        }
      }
    }
    for (const [key, ev] of Object.entries(board.marked)) {
      if (!map.has(key)) {
        map.set(key, boardEventFromSnapshot(ev))
      }
    }
    return Array.from(map.values())
  }, [board.sources, board.view.hiddenSources, board.marked, sourceResults])
  allBoardEventsRef.current = allBoardEvents

  const allEngineLinks = useMemo(() => {
    const map = new Map<string, EventLink>()
    for (const s of board.sources) {
      if (board.view.hiddenSources.includes(s.id) || s.kind !== 'query') continue
      for (const l of sourceResults[s.id]?.links ?? []) {
        map.set(`${l.from}|${l.to}|${l.basis}`, l)
      }
    }
    for (const l of extraEngineLinks) {
      map.set(`${l.from}|${l.to}|${l.basis}`, l)
    }
    return Array.from(map.values())
  }, [board.sources, board.view.hiddenSources, sourceResults, extraEngineLinks])

  // 전체 연결선 계산 (모든 보드 이벤트 기준)
  const links = useMemo(() => {
    return boardLinks(
      allBoardEvents,
      allEngineLinks,
      board.userLinks,
      board.view.linkKinds,
    )
  }, [allBoardEvents, allEngineLinks, board.userLinks, board.view.linkKinds])

  // 범례 및 통계용: 보드 위의 모든 연결선 종류별 개수
  const allKindsLinks = useMemo(() => {
    return boardLinks(
      allBoardEvents,
      allEngineLinks,
      board.userLinks,
      ALL_LINK_KINDS,
    )
  }, [allBoardEvents, allEngineLinks, board.userLinks])

  const linkCountsByKind = useMemo(() => {
    const counts = new Map<LinkKind, number>()
    for (const l of allKindsLinks) {
      counts.set(l.kind, (counts.get(l.kind) ?? 0) + 1)
    }
    return counts
  }, [allKindsLinks])

  const legendKinds = useMemo(() => {
    return ALL_LINK_KINDS.filter(
      // 보드에 하나도 없는 종류는 켜도 보일 선이 없어 범례에서 뺀다
      kind => (linkCountsByKind.get(kind) ?? 0) > 0
    )
  }, [board.view.linkKinds, linkCountsByKind])

  // 선택한 이벤트의 연결 흐름 탐색 (이 흐름만 보기에 사용)
  const activeFlow = useMemo(() => {
    return selectedEventKey ? flowOf(selectedEventKey, links) : null
  }, [selectedEventKey, links])

  // 선택 이벤트에 직접 이어진 이벤트 키 집합 (1홉 및 자기 자신)
  const directlyConnectedKeys = useMemo(() => {
    if (!selectedEventKey) return null
    const set = new Set<string>()
    set.add(selectedEventKey)
    for (const l of links) {
      if (l.from === selectedEventKey) set.add(l.to)
      if (l.to === selectedEventKey) set.add(l.from)
    }
    return set
  }, [selectedEventKey, links])

  const isHighClutter = links.length > 300
  const renderedLinks = useMemo(() => {
    if (selectedEventKey) {
      return links.filter(l => l.from === selectedEventKey || l.to === selectedEventKey)
    }
    if (isHighClutter) {
      return []
    }
    return links
  }, [selectedEventKey, isHighClutter, links])

  // 거르기 적용 (providers, outcomes, text, pins, showSelf, showFlowOnly)
  const visibleEvents = useMemo(() => {
    const f = board.view.filters
    const textLower = f.text.trim().toLowerCase()

    return allBoardEvents.filter(e => {
      if (!board.view.showSelf && e.attributes?.aegi_self === true) return false
      if (f.providers.length > 0 && !f.providers.includes(e.provider)) return false
      if (f.outcomes.length > 0) {
        const matchesOutcome =
          (f.outcomes.includes('failure') && e.outcome === 'failure') ||
          (f.outcomes.includes('suspicious') && e.signal?.kind === 'suspicious')
        if (!matchesOutcome) return false
      }
      if (textLower) {
        const hay = [
          e.event_type,
          e.title,
          e.actor?.display,
          e.actor?.native_id,
          ...e.targets.flatMap(t => [t.display, t.native_id]),
          e.correlation?.client_ip,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(textLower)) return false
      }
      if (f.pins.length > 0) {
        for (const pin of f.pins) {
          if (!eventMatchesPin(e, pin, graph)) return false
        }
      }
      if (showFlowOnly && activeFlow && !activeFlow.has(e.origin_key)) return false
      if (timeRange) {
        const t = e.occurred_at ? Date.parse(e.occurred_at) : NaN
        if (Number.isNaN(t) || t < timeRange[0] || t > timeRange[1]) return false
      }
      return true
    })
  }, [allBoardEvents, board.view.filters, board.view.showSelf, showFlowOnly, activeFlow, graph, timeRange])

  // --------------------------------------------------------------------------
  // 축 및 레이아웃 계산
  // --------------------------------------------------------------------------
  const { axis, boardLayout, finalGroups, anchorEventKeys, groupCounts } = useMemo(() => {
    const times = visibleEvents
      .map(e => (e.occurred_at ? Date.parse(e.occurred_at) : NaN))
      .filter(t => !Number.isNaN(t))

    const repeatsRes = groupRepeats(visibleEvents, 10 * 60_000)
    const groupCount = repeatsRes.groups.length
    const cardW = groupCount <= 60 ? 184 : 136
    // 화면 폭에 다 넣지 않는다. 묶음 수만큼 카드가 세 줄 안에 들어갈 폭을 먼저 잡고, 넘치면 가로로 스크롤한다
    const effectiveWidth = Math.max(viewportWidth, (groupCount * (cardW + 6)) / 3 + LANE_HEADER_PX) * zoom
    const computedAxis = buildAxis(times, board.view.mode, effectiveWidth, {
      tailPx: cardW,
      padPx: LANE_HEADER_PX + 16,
      expanded: expandedGaps,
      domainRange: timeRange ?? undefined,
    })

    const finalGroups: EventGroup[] = []

    for (const g of repeatsRes.groups) {
      if (g.count > 1 && expandedGroupKeys.has(g.key)) {
        for (const ev of g.events) {
          const t = ev.occurred_at ? Date.parse(ev.occurred_at) : g.t
          finalGroups.push({
            key: `item:${ev.origin_key}`,
            events: [ev],
            provider: ev.provider,
            t: Number.isNaN(t) ? g.t : t,
            tEnd: Number.isNaN(t) ? g.t : t,
            title: ev.title || ev.event_type,
            count: 1,
          })
        }
      } else {
        finalGroups.push(g)
      }
    }

    const layout = layoutBoard(finalGroups, computedAxis, { cardWidth: cardW, minLaneHeight: 92 })
    const groupCounts = new Map(finalGroups.map(g => [g.key, g.count]))

    const anchorKeys = new Set<string>()
    for (const s of board.sources) {
      if (s.kind === 'query' && s.neighbors?.anchorEvent) {
        anchorKeys.add(s.neighbors.anchorEvent)
      }
    }

    return {
      axis: computedAxis,
      boardLayout: layout,
      finalGroups,
      anchorEventKeys: anchorKeys,
      groupCounts,
    }
  }, [visibleEvents, board.view.mode, viewportWidth, zoom, expandedGaps, expandedGroupKeys, board.sources, timeRange])

  // 보드 스크롤, 타임라인 구간 드래그 확대 및 휠 줌.
  // 평소 휠은 브라우저 기본 보드 스크롤(세로/가로)로 동작한다.
  // 마우스를 클릭하고 잡고 있는 상태에서 휠을 굴리면 시간선 줌이 동작하고, 시간축/빈 영역을 드래그하면 해당 구간으로 확대한다.
  const isMouseDownRef = useRef(false)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const axisWidthRef = useRef(axis.width)
  axisWidthRef.current = axis.width
  const axisRef = useRef(axis)
  axisRef.current = axis
  const brushDragRef = useRef<{ startX: number; curX: number } | null>(null)
  useEffect(() => {
    const el = boardScrollRef.current
    if (!el) return

    const toBoardX = (clientX: number): number | null => {
      const tl = boardTimelineRef.current
      if (!tl) return null
      const rect = tl.getBoundingClientRect()
      const maxX = Math.max(LANE_HEADER_PX + 1, axisWidthRef.current)
      return Math.max(LANE_HEADER_PX, Math.min(maxX, clientX - rect.left))
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      isMouseDownRef.current = true
      const target = e.target as Element | null
      // 보드 본문 공간이 아니라 상단 시간축 눈금 줄(.eb-axis-ticks)에서만 구간 드래그를 시작한다
      if (!target?.closest?.('.eb-axis-ticks') || target?.closest?.('.eb-axis-corner')) {
        return
      }
      const x = toBoardX(e.clientX)
      if (x === null || x < LANE_HEADER_PX) return
      const next = { startX: x, curX: x }
      brushDragRef.current = next
      setBrushDrag(next)
    }

    const onPointerMove = (e: PointerEvent) => {
      const drag = brushDragRef.current
      if (!drag) return
      const x = toBoardX(e.clientX)
      if (x === null) return
      const next = { startX: drag.startX, curX: x }
      brushDragRef.current = next
      setBrushDrag(next)
    }

    const clearBrush = (applyZoom: boolean) => {
      isMouseDownRef.current = false
      const drag = brushDragRef.current
      brushDragRef.current = null
      setBrushDrag(null)
      if (!applyZoom || !drag) return
      if (Math.abs(drag.curX - drag.startX) <= 10) return
      const x0 = Math.min(drag.startX, drag.curX)
      const x1 = Math.max(drag.startX, drag.curX)
      const tA = axisRef.current.invert(x0)
      const tB = axisRef.current.invert(x1)
      if (tA === null || tB === null) return
      let minT = Math.min(tA, tB)
      let maxT = Math.max(tA, tB)
      if (maxT - minT < 1000) {
        const mid = (minT + maxT) / 2
        minT = mid - 500
        maxT = mid + 500
      }
      setTimeRange([Math.floor(minT), Math.ceil(maxT)])
      setZoom(1.0)
      setHoverAxisTime(null)
      clearHover()
      requestAnimationFrame(() => {
        el.scrollLeft = 0
      })
    }

    const onPointerUp = () => clearBrush(true)
    const onPointerCancel = () => clearBrush(false)

    const onWheel = (e: WheelEvent) => {
      // 마우스를 클릭하고 잡고 있는 상태가 아니면 브라우저 기본 스크롤(위아래/좌우)을 수행한다
      if (!isMouseDownRef.current) return

      if (brushDragRef.current) {
        brushDragRef.current = null
        setBrushDrag(null)
      }
      e.preventDefault()
      const currentZoom = zoomRef.current
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentZoom * Math.exp(-e.deltaY * 0.002)))
      if (nextZoom === currentZoom) return
      const rect = el.getBoundingClientRect()
      const ratio = axisWidthRef.current > 0 ? (e.clientX - rect.left + el.scrollLeft) / axisWidthRef.current : 0
      zoomRef.current = nextZoom
      setZoom(nextZoom)
      requestAnimationFrame(() => {
        el.scrollLeft = ratio * axisWidthRef.current * (nextZoom / currentZoom) - (e.clientX - rect.left)
      })
    }

    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('blur', onPointerCancel)
    el.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('blur', onPointerCancel)
      el.removeEventListener('wheel', onWheel)
    }
  }, [clearHover])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft)
    clearHover()
    setHoverAxisTime(null)
    setHoveredLink(null)
    setHoveredLinkId(null)
  }

  // --------------------------------------------------------------------------
  // 상단 바 동작 (저장, 리셋, 엔진 연결 다시 받기)
  // --------------------------------------------------------------------------
  const saveBoard = async () => {
    const trimmedActor = actor.trim()
    if (!trimmedActor) {
      setNotice('처리자를 입력하세요.')
      return
    }
    if (state === 'closed' && !conclusion.trim()) {
      setNotice('종결 상태는 결론이 필요합니다.')
      return
    }

    let currentId = board.id
    if (!currentId) {
      currentId = crypto.randomUUID()
      setBoard(b => ({ ...b, id: currentId }))
    }

    const existingItem = investigationsStore.items.find(i => i.id === currentId)
    const expectedUpdatedAt = existingItem?.updatedAt

    const boardToSave: BoardV3 = {
      ...board,
      id: currentId,
      view: {
        ...board.view,
        ...(zoom !== 1 ? { zoom } : { zoom: undefined }),
        ...(timeRange ? { timeRange } : { timeRange: undefined }),
      },
    }
    const shrunk = shrinkToFit(boardToSave, 750_000)
    const ok = await investigationsStore.save({
      id: currentId,
      title: board.title.trim() || '이벤트 조사',
      state,
      owner: owner.trim() || undefined,
      conclusion: conclusion.trim() || undefined,
      board: serializeBoard({ ...shrunk, id: currentId }),
      actor: trimmedActor,
      expectedUpdatedAt,
    })
    if (ok) {
      setNotice('조사를 저장했습니다.')
    }
  }

  const handleOpenInvestigation = (item: InvestigationRecord) => {
    const parsed = parseBoardAny(item.board)
    if (parsed) {
      setBoard(parsed)
      setState(item.state)
      setOwner(item.owner ?? '')
      setConclusion(item.conclusion ?? '')
      setSelectedEventKey(null)
      setSelectedLink(null)
      setTimeRange(parsed.view.timeRange ?? null)
      setZoom(parsed.view.zoom ?? 1.0)
      setLinkingFromKey(null)
      setSourceResults({})
      setExtraEngineLinks([])
      executedSourcesRef.current.clear()
      setShowSavedList(false)
      setNotice(`"${item.title}" 조사를 불러왔습니다.`)
    } else {
      setNotice('조사 보드 데이터를 불러올 수 없습니다.')
    }
  }

  const resetNewBoard = () => {
    lastProcessedHashRef.current = '#event-board'
    location.hash = '#event-board'
    setSeed(undefined)
    setGeneration(n => n + 1)
    setBoard(emptyBoardV3())
    setState('open')
    setOwner('')
    setConclusion('')
    setSelectedEventKey(null)
    setSelectedLink(null)
    setExtraEngineLinks([])
    setTimeRange(null)
    setZoom(1.0)
    setLinkingFromKey(null)
    setSourceResults({})
    executedSourcesRef.current.clear()
    setNotice('새 조사를 시작했습니다. 저장한 조사는 유지됩니다.')
  }

  /** 엔진 연결 보충: 보드 이벤트 객체 키 상위 20개와 전체 기간으로 loadTimelineEvents 호출 */
  const refetchEngineLinks = async () => {
    if (visibleEvents.length === 0) {
      setNotice('보드에 이벤트가 없습니다.')
      return
    }

    const objCounts = new Map<string, number>()
    for (const e of visibleEvents) {
      if (e.actor?.object_key && graph.objectsByKey.has(e.actor.object_key)) {
        objCounts.set(e.actor.object_key, (objCounts.get(e.actor.object_key) ?? 0) + 1)
      }
      for (const t of e.targets) {
        if (t.object_key && graph.objectsByKey.has(t.object_key)) {
          objCounts.set(t.object_key, (objCounts.get(t.object_key) ?? 0) + 1)
        }
      }
    }

    const sortedKeys = Array.from(objCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(e => e[0])
      .slice(0, MAX_SCOPE_OBJECTS)

    const times = visibleEvents
      .map(e => (e.occurred_at ? Date.parse(e.occurred_at) : NaN))
      .filter(t => !Number.isNaN(t))
    if (!times.length || !sortedKeys.length) {
      setNotice('연결을 보충할 객체나 시각이 충분하지 않습니다.')
      return
    }

    const minT = Math.min(...times)
    const maxT = Math.max(...times)
    const from = new Date(minT).toISOString().replace(/\.\d{3}Z$/, 'Z')
    const to = new Date(maxT).toISOString().replace(/\.\d{3}Z$/, 'Z')

    setNotice('엔진 연결을 새로 받는 중...')
    const res = await loadTimelineEvents('/api/measured/graph', { from, to, objectKeys: sortedKeys })
    if (res.links && res.links.length > 0) {
      setExtraEngineLinks(prev => [...prev, ...res.links!])
      setNotice(`엔진 연결 ${res.links.length}건을 새로 받았습니다.`)
    } else {
      setNotice('새로 발견된 엔진 연결이 없습니다.')
    }
  }

  // --------------------------------------------------------------------------
  // 이벤트 및 분석가 연결 핸들러
  // --------------------------------------------------------------------------
  const handleEventClick = (eventKey: string) => {
    clearHover()
    if (linkingFromKey && linkingFromKey !== eventKey) {
      setLinkingPending({ from: linkingFromKey, to: eventKey })
      setLinkingNote('')
      setLinkingFromKey(null)
      return
    }
    setSelectedLink(null)
    setSelectedEventKey(prev => (prev === eventKey ? null : eventKey))
    setShowFlowOnly(false)
  }

  const confirmAnalystLink = () => {
    if (!linkingPending) return
    const newLink = {
      id: crypto.randomUUID(),
      from: linkingPending.from,
      to: linkingPending.to,
      note: linkingNote.trim(),
    }
    setBoard(b => ({
      ...b,
      userLinks: [...b.userLinks, newLink],
    }))
    setLinkingPending(null)
    setLinkingNote('')
    setNotice('분석가 연결을 추가했습니다.')
  }

  const toggleMarked = (event: TimelineEvent) => {
    setBoard(b => {
      const nextMarked = { ...b.marked }
      if (nextMarked[event.origin_key]) {
        delete nextMarked[event.origin_key]
        return { ...b, marked: nextMarked }
      }
      nextMarked[event.origin_key] = toEventSnapshot(event)
      return { ...b, marked: nextMarked }
    })
  }

  const addNoteSubjectForEvent = (eventKey: string) => {
    const newNote: SubjectCard = {
      id: crypto.randomUUID(),
      kind: 'note',
      text: '새 메모',
      eventKey,
      createdAt: new Date().toISOString(),
    }
    setBoard(b => ({
      ...b,
      subjects: [...b.subjects, newNote],
    }))
    setSideTab('subjects')
    setSidePanelOpen(true)
    setNotice('이벤트에 메모를 추가했습니다.')
  }

  const addPin = (pin: Pin) => {
    const boardPin: BoardPin = {
      kind: pin.kind as BoardPin['kind'],
      value: pin.value,
      label: pin.label,
    }
    setBoard(b => {
      if (b.view.filters.pins.some(p => p.kind === boardPin.kind && p.value === boardPin.value)) return b
      return {
        ...b,
        view: {
          ...b.view,
          filters: {
            ...b.view.filters,
            pins: [...b.view.filters.pins, boardPin],
          },
        },
      }
    })
    setNotice(`필터에 "${pin.label}" 핀을 추가했습니다.`)
  }

  const removePin = (pinIndex: number) => {
    setBoard(b => ({
      ...b,
      view: {
        ...b.view,
        filters: {
          ...b.view.filters,
          pins: b.view.filters.pins.filter((_, idx) => idx !== pinIndex),
        },
      },
    }))
  }

  // 다음 조회 후보 계산
  const candidates = useMemo(() => nextQueryCandidates(board), [board])

  const selectedEvent = useMemo(() => {
    if (!selectedEventKey) return null
    return allBoardEvents.find(e => e.origin_key === selectedEventKey) ?? null
  }, [selectedEventKey, allBoardEvents])

  const timedSelectedEvent = useMemo<TimedEvent | null>(() => {
    if (!selectedEvent) return null
    const t = selectedEvent.occurred_at ? Date.parse(selectedEvent.occurred_at) : Date.now()
    return { ...selectedEvent, t: Number.isNaN(t) ? Date.now() : t }
  }, [selectedEvent])

  // 선택한 이벤트의 앞뒤 흐름. 같은 이벤트로 이어진 연결은 한 줄로 묶는다
  const selectedFlow = useMemo(() => {
    if (!selectedEvent) return null
    const selT = selectedEvent.occurred_at ? Date.parse(selectedEvent.occurred_at) : NaN
    const groups = new Map<string, { dir: 'prev' | 'next'; key: string; links: BoardLink[] }>()
    for (const l of links) {
      const dir = l.to === selectedEvent.origin_key ? 'prev' : l.from === selectedEvent.origin_key ? 'next' : null
      if (!dir) continue
      const key = dir === 'prev' ? l.from : l.to
      const id = `${dir}:${key}`
      const g = groups.get(id) ?? { dir, key, links: [] }
      g.links.push(l)
      groups.set(id, g)
    }
    const items = [...groups.values()].map(g => {
      const ev = allBoardEvents.find(e => e.origin_key === g.key)
      const t = ev?.occurred_at ? Date.parse(ev.occurred_at) : NaN
      return { ...g, title: ev ? (ev.title || ev.event_type) : g.key, t }
    })
    const byTime = (a: { t: number }, b: { t: number }) =>
      (Number.isNaN(a.t) ? Infinity : a.t) - (Number.isNaN(b.t) ? Infinity : b.t)
    return {
      selT,
      prev: items.filter(i => i.dir === 'prev').sort(byTime),
      next: items.filter(i => i.dir === 'next').sort(byTime),
    }
  }, [selectedEvent, links, allBoardEvents])

  // 거르기 칩 데이터 계산
  const saasCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of allBoardEvents) {
      map.set(e.provider, (map.get(e.provider) ?? 0) + 1)
    }
    return map
  }, [allBoardEvents])

  const failureCount = useMemo(() => {
    return allBoardEvents.filter(e => e.outcome === 'failure').length
  }, [allBoardEvents])

  const suspiciousCount = useMemo(() => {
    return allBoardEvents.filter(e => e.signal?.kind === 'suspicious').length
  }, [allBoardEvents])

  const selfCount = useMemo(() => {
    return allBoardEvents.filter(e => e.attributes?.aegi_self === true).length
  }, [allBoardEvents])

  // 위치 맵 생성 (Placed 배치 정보)
  const placedMap = useMemo(() => {
    const map = new Map<string, Placed>()
    for (const p of boardLayout.placed) {
      map.set(p.key, p)
    }
    return map
  }, [boardLayout.placed])

  // 이벤트 키에서 속한 그룹/카드 배치 찾기 (묶음 카드 ×N 안의 모든 이벤트도 포함)
  const eventToGroupMap = useMemo(() => {
    const groupByKey = new Map(finalGroups.map(fg => [fg.key, fg]))
    const map = new Map<string, Placed>()
    for (const g of boardLayout.placed) {
      const fg = groupByKey.get(g.key)
      if (fg) {
        for (const ev of fg.events) {
          map.set(ev.origin_key, g)
        }
      } else if (g.key.startsWith('group:')) {
        map.set(g.key.replace('group:', ''), g)
      } else if (g.key.startsWith('item:')) {
        map.set(g.key.replace('item:', ''), g)
      }
    }
    return map
  }, [boardLayout.placed, finalGroups])

  return (
    <main className="page event-investigation">
      {/* 1. 상단 제목 줄 */}
      <header className="ei-header page-title-bar page-title-bar-inset">
        <h1>Event Board</h1>
      </header>

      {/* 2. 도구 모음 줄: 조사 이름과 상태, 조회, 보기, 조사 */}
      <div className="lst-actionbar ei-actionbar">
        <div className="lst-actionbar-row">
          <div className="ei-identity">
            <label className="ei-name">
              <input
                aria-label="조사 이름"
                placeholder="조사 이름"
                className="ex-input"
                value={board.title}
                title="조사 이름 입력"
                onChange={e => setBoard(b => ({ ...b, title: e.target.value }))}
              />
            </label>
            <div className="eb-info-menu-wrapper">
              <button
                type="button"
                className={`ei-state-btn state-${state}`}
                onClick={() => setShowInfoMenu(v => !v)}
                aria-expanded={showInfoMenu}
                title="조사 상태, 담당자, 처리자, 저장한 조사 열기, 새로 만들기"
              >
                {INVESTIGATION_STATE_LABEL[state]}
                {owner.trim() && <span className="ei-state-owner">{owner.trim()}</span>}
                <ChevronDown size={14} aria-hidden="true" className="ei-caret" />
              </button>
              {showInfoMenu && (
                <div className="eb-info-menu">
                  <div className="ei-status-grid">
                    <label className="ei-status-field">
                      상태
                      <select
                        value={state}
                        aria-label="조사 상태"
                        onChange={e => setState(e.target.value as InvestigationState)}
                        title="조사 진행 상태 변경"
                      >
                        {INVESTIGATION_STATES.map(s => (
                          <option key={s} value={s}>{INVESTIGATION_STATE_LABEL[s]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="ei-status-field">
                      담당자
                      <input
                        type="text"
                        placeholder="담당자 이름"
                        aria-label="담당자"
                        value={owner}
                        onChange={e => setOwner(e.target.value)}
                        maxLength={MAX_INVESTIGATION_OWNER}
                        title="조사 담당자 입력"
                      />
                    </label>
                    <label className="ei-status-field">
                      처리자
                      <input
                        type="text"
                        placeholder="처리자 이름"
                        aria-label="처리자"
                        value={actor}
                        onChange={e => handleActorChange(e.target.value)}
                        maxLength={MAX_INVESTIGATION_ACTOR}
                        title="조사 처리자 입력"
                      />
                    </label>
                    <span className="ei-status-field">
                      저장 위치
                      <span className="tl-badge" title="저장소">
                        {investigationsStore.storage === 'remote' ? '팀 공용 저장소' : '이 브라우저'}
                      </span>
                    </span>
                  </div>
                  {(state === 'closed' || conclusion.trim().length > 0) && (
                    <label className="ei-conclusion-field">
                      <span>종결 결론{state === 'closed' && ', 필수'}</span>
                      <textarea
                        className="ei-conclusion-textarea"
                        placeholder="조사 결론과 근거"
                        aria-label="종결 결론"
                        value={conclusion}
                        onChange={e => setConclusion(e.target.value)}
                        maxLength={MAX_INVESTIGATION_CONCLUSION}
                        title="조사 종결 결론과 근거 입력"
                      />
                    </label>
                  )}
                  <div className="eb-info-menu-items">
                    <button
                      type="button"
                      className="ex-btn"
                      onClick={() => { setShowInfoMenu(false); setShowSavedList(true) }}
                      title="저장된 조사 목록 열기"
                    >
                      저장한 조사 열기
                    </button>
                    <button
                      type="button"
                      className="ex-btn"
                      onClick={() => { setShowInfoMenu(false); resetNewBoard() }}
                      title="보드를 비우고 새로 만들기"
                    >
                      새로 만들기
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="eb-add-menu-wrapper">
            <button
              type="button"
              className="ex-btn eb-add-btn"
              aria-expanded={showAddMenu}
              onClick={() => setShowAddMenu(v => !v)}
              title="기간 또는 AI로 이벤트 추가"
            >
              <Plus size={14} aria-hidden="true" />
              추가
              <ChevronDown size={14} aria-hidden="true" className="ei-caret" />
            </button>
            {showAddMenu && (
              <div className="eb-menu" role="menu" aria-label="추가">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setShowAddMenu(false); setShowAddQuery(true) }}
                  title="기간으로 이벤트 추가하기"
                >
                  기간으로 이벤트 추가하기
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={openAiForAdd}
                  title="AI로 이벤트 추가하기"
                >
                  <AiLogo size={14} />
                  AI로 이벤트 추가하기
                </button>
              </div>
            )}
          </div>

          <span className="ei-divider" aria-hidden="true" />

        <ChipGroup
          legend="SaaS"
          items={Array.from(saasCounts.keys()).map(p => ({
            key: p,
            label: <ProviderLogo provider={providerLogoId(p)} />,
            logo: true,
            count: saasCounts.get(p) ?? 0,
            title: board.view.filters.providers.includes(p) ? `${providerName(p)} 필터 해제` : `${providerName(p)}만 보기`,
            ariaLabel: providerName(p),
          }))}
          isOn={p => board.view.filters.providers.includes(p)}
          onToggle={p => {
            const cur = board.view.filters.providers
            const next = cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p]
            setBoard(b => ({
              ...b,
              view: { ...b.view, filters: { ...b.view.filters, providers: next } },
            }))
          }}
        />

        <ChipGroup
          legend="결과"
          items={[
            {
              key: 'failure',
              label: '실패',
              count: failureCount,
              alert: true,
              title: board.view.filters.outcomes.includes('failure') ? '실패 필터 해제' : '실패 이벤트만 보기',
            },
            {
              key: 'suspicious',
              label: '의심',
              count: suspiciousCount,
              alert: true,
              title: board.view.filters.outcomes.includes('suspicious') ? '의심 필터 해제' : '의심 이벤트만 보기',
            },
          ]}
          isOn={k => board.view.filters.outcomes.includes(k)}
          onToggle={k => {
            const cur = board.view.filters.outcomes
            const next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]
            setBoard(b => ({
              ...b,
              view: { ...b.view, filters: { ...b.view.filters, outcomes: next } },
            }))
          }}
        />

        <div className="eb-search-field">
          <input
            type="search"
            className="ex-input eb-search-input"
            placeholder="이벤트, 행위자, 대상, IP 검색"
            value={board.view.filters.text}
            title="이벤트 검색어 입력"
            onChange={e => {
              const text = e.target.value
              setBoard(b => ({
                ...b,
                view: { ...b.view, filters: { ...b.view.filters, text } },
              }))
            }}
          />
        </div>

        {(board.view.filters.pins.length > 0 || timeRange !== null) && (
          <div className="eb-pins-list">
            {board.view.filters.pins.map((pin, idx) => (
              <span key={`${pin.kind}:${pin.value}`} className="eb-pin-chip">
                <span>{pin.label}</span>
                <button
                  type="button"
                  className="eb-pin-remove"
                  onClick={() => removePin(idx)}
                  title={`${pin.label} 핀 제거`}
                  aria-label={`${pin.label} 핀 제거`}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            {timeRange && (
              <>
                <span className="eb-pin-chip eb-time-range-chip">
                  <span>구간: {formatTime(timeRange[0])} ~ {formatTime(timeRange[1])}</span>
                  <button
                    type="button"
                    className="eb-pin-remove"
                    onClick={() => { setTimeRange(null); setZoom(1.0) }}
                    title="구간 확대 해제"
                    aria-label="구간 확대 해제"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
                <button
                  type="button"
                  className="ex-btn eb-range-reset-btn"
                  onClick={() => { setTimeRange(null); setZoom(1.0) }}
                  title="선택한 시간 구간 확대를 해제하고 전체 기간 보기"
                >
                  전체 기간
                </button>
              </>
            )}
          </div>
        )}

        <button
          type="button"
          className={`eb-self-toggle ${board.view.showSelf ? 'is-active' : ''}`}
          onClick={() => setBoard(b => ({
            ...b,
            view: { ...b.view, showSelf: !b.view.showSelf },
          }))}
          title={board.view.showSelf ? 'AEGI 수집기 활동 숨기기' : 'AEGI 수집기 활동 보이기'}
        >
          AEGI 수집기 활동 {selfCount}건 {board.view.showSelf ? '숨기기' : '보기'}
        </button>

          <div className="ei-end">
            <label className="eb-view-mode-label">
              보기
              <select
                className="eb-select"
                value={board.view.mode}
                aria-label="보기 방식"
                title="시간축 보기 방식 선택"
                onChange={e => setBoard(b => ({
                  ...b,
                  view: { ...b.view, mode: e.target.value as 'gaps' | 'linear' | 'ordinal' },
                }))}
              >
                <option value="gaps">생략 있음</option>
                <option value="linear">시간 비례</option>
                <option value="ordinal">순서대로</option>
              </select>
            </label>
            <button
              type="button"
              className="ex-btn ei-save"
              onClick={saveBoard}
              title="현재 조사를 저장소에 저장"
            >
              조사 저장
            </button>
          </div>
        </div>
      </div>

      {/* 4. 알림. 보드 자리를 차지하지 않게 화면 아래에 잠깐 띄운다 */}
      {notice && (
        <div className="ei-notice is-on">
          <p role="status">{notice}</p>
          <button
            type="button"
            className="ex-icon-btn"
            aria-label="알림 닫기"
            title="알림 닫기"
            onClick={() => setNotice('')}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 8. 메인 타임라인 보드 레이아웃 (보드 열, 오른쪽 탭 칸) */}
      <div className="eb-main-layout" ref={mainLayoutRef} style={{ height: mainLayoutHeight }}>
        {/* 보드 열: 보드와 아래 연결선 범례 */}
        <div className="eb-board-column">
        {/* 6. 상단 개요 띠 (전체 기간 점 분포 + 드래그 확대) */}
        {visibleEvents.length > 0 && <OverviewStrip
          events={visibleEvents}
          axis={axis}
          scrollLeft={scrollLeft}
          viewportWidth={viewportWidth}
          newRange={newRange}
          onScrollTo={x => {
            if (boardScrollRef.current) {
              boardScrollRef.current.scrollLeft = x
            }
          }}
          onSelectRange={range => {
            setTimeRange(range)
            setZoom(1.0)
            setHoverAxisTime(null)
            clearHover()
            requestAnimationFrame(() => {
              if (boardScrollRef.current) boardScrollRef.current.scrollLeft = 0
            })
          }}
        />}
        {/* 보드 영역 (시간축, 레인, SVG 연결선, 이벤트 카드) */}
        <section
          className="ei-board eb-board-container"
          ref={boardScrollRef}
          onScroll={handleScroll}
          aria-label="조사 보드 타임라인"
        >
          {visibleEvents.length === 0 ? (
            <div className="eb-empty-board">
              <p>보드에 표시할 이벤트가 없습니다.</p>
              <span className="eb-empty-hint">출처를 추가하거나 필터 조건을 변경하세요.</span>
              {timeRange && (
                <button
                  type="button"
                  className="ex-btn"
                  onClick={() => { setTimeRange(null); setZoom(1.0) }}
                >
                  전체 기간 보기
                </button>
              )}
            </div>
          ) : (
            <div
              ref={boardTimelineRef}
              className={`eb-timeline-board ${brushDrag && Math.abs(brushDrag.curX - brushDrag.startX) > 6 ? 'is-brushing' : ''}`}
              style={{ width: Math.max(axis.width, viewportWidth), height: boardLayout.height }}
            >
              {isHighClutter && !selectedEventKey && (
                <div className="eb-link-clutter-notice" role="status">
                  연결선 {links.length}개는 이벤트를 고르면 보입니다
                </div>
              )}

              {/* 상단 스티키 눈금 줄 */}
              <div
                className="eb-axis-ticks"
                title="시간축에 마우스를 올리면 정확한 시각을 표시하고, 드래그하면 구간을 확대합니다"
                onPointerMove={e => {
                  const tl = boardTimelineRef.current
                  if (!tl) return
                  const x = e.clientX - tl.getBoundingClientRect().left
                  if (x < LANE_HEADER_PX) {
                    setHoverAxisTime(null)
                    return
                  }
                  const t = axis.invert(x)
                  setHoverAxisTime(t !== null ? { x, t } : null)
                }}
                onPointerLeave={() => setHoverAxisTime(null)}
                onDoubleClick={() => {
                  if (timeRange || zoom !== 1) {
                    setTimeRange(null)
                    setZoom(1.0)
                  }
                }}
              >
                <div className="eb-axis-corner" aria-hidden="true" />
                {axis.ticks.map(tick => (
                  <div
                    key={`${tick.t}:${tick.x}`}
                    className="eb-tick"
                    style={{ left: tick.x }}
                    title={`${formatKstFull(tick.t)} KST (${formatUtc(tick.t)})`}
                  >
                    <span className="eb-tick-line" />
                    <span className="eb-tick-label">{tick.label}</span>
                  </div>
                ))}
                {hoverAxisTime && (
                  <div className="eb-axis-hover-badge" style={{ left: hoverAxisTime.x }}>
                    {formatKstFull(Math.round(hoverAxisTime.t))} KST
                  </div>
                )}
                {brushDrag && Math.abs(brushDrag.curX - brushDrag.startX) > 6 && (() => {
                  const left = Math.min(brushDrag.startX, brushDrag.curX)
                  const width = Math.abs(brushDrag.curX - brushDrag.startX)
                  const t0 = axis.invert(left)
                  const t1 = axis.invert(left + width)
                  return (
                    <div className="eb-brush-selection" style={{ left, width }}>
                      {t0 !== null && t1 !== null && (
                        <span className="eb-brush-label">{formatTime(Math.min(t0, t1))} ~ {formatTime(Math.max(t0, t1))}</span>
                      )}
                    </div>
                  )
                })()}
              </div>

              {/* 접힌 구간 (Folded gaps) 세로 띠 */}
              {axis.gaps.map(gap => (
                <div
                  key={gap.index}
                  className="eb-folded-gap-band"
                  style={{ left: gap.x0, width: gap.x1 - gap.x0, height: Math.max(0, boardLayout.height - 28) }}
                  onClick={() => {
                    setExpandedGaps(prev =>
                      prev.includes(gap.index) ? prev.filter(i => i !== gap.index) : [...prev, gap.index]
                    )
                  }}
                  title={`생략 구간 ${gap.label} ${expandedGaps.includes(gap.index) ? '접기' : '펼치기'}`}
                  role="button"
                >
                  <svg className="eb-gap-wavy-svg" width="100%" height="100%" aria-hidden="true">
                    <defs>
                      <pattern id={`gap-wave-${gap.index}`} width="28" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 6 0 Q 3 5 6 10 T 6 20 M 22 0 Q 19 5 22 10 T 22 20" fill="none" stroke="var(--color-border)" strokeWidth="1" />
                      </pattern>
                    </defs>
                    <rect x="0" y="0" width="100%" height="100%" fill={`url(#gap-wave-${gap.index})`} />
                  </svg>
                  <div className="eb-gap-label-box">
                    <span className="eb-gap-duration">≈{gap.label}≈</span>
                    {gap.dayChange && <span className="eb-gap-daychange">{gap.dayChange}</span>}
                  </div>
                </div>
              ))}

              {/* SVG 연결선 레이어 */}
              <svg className="eb-svg-layer" width="100%" height="100%">
                <defs>
                  <marker
                    id="eb-arrow-select"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--color-select)" />
                  </marker>
                  <marker
                    id="eb-arrow-teal"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--color-provider-salesforce-fill)" />
                  </marker>
                </defs>

                {renderedLinks.map(l => {
                  const fromPlaced = placedMap.get(l.from) || eventToGroupMap.get(l.from)
                  const toPlaced = placedMap.get(l.to) || eventToGroupMap.get(l.to)
                  if (!fromPlaced || !toPlaced || fromPlaced.key === toPlaced.key) return null

                  const { d } = linkPath(fromPlaced, toPlaced)
                  const isSelectedEventActive = Boolean(selectedEventKey)
                  const isHovered = l.id === hoveredLinkId || selectedLink?.id === l.id

                  const x1 = fromPlaced.x + fromPlaced.w
                  const y1 = fromPlaced.y + fromPlaced.h / 2
                  const x2 = toPlaced.x
                  const y2 = toPlaced.y + toPlaced.h / 2

                  // 생략 구간을 건너는지 확인
                  const crossesGaps = axis.gaps.filter(g => g.x0 < x2 && g.x1 > x1)

                  return (
                    <g
                      key={l.id}
                      className={`eb-link-group ${l.strength === 'review' ? 'is-review' : ''}`}
                      onMouseEnter={e => {
                        setHoveredLinkId(l.id)
                        setHoveredLink({ id: l.id, x: e.clientX, y: e.clientY })
                      }}
                      onMouseMove={e => {
                        setHoveredLink({ id: l.id, x: e.clientX, y: e.clientY })
                      }}
                      onMouseLeave={() => {
                        setHoveredLinkId(prev => (prev === l.id ? null : prev))
                        setHoveredLink(prev => (prev?.id === l.id ? null : prev))
                      }}
                      onClick={e => {
                        e.stopPropagation()
                        setSelectedLink(prev => (prev?.id === l.id ? null : { id: l.id, x: e.clientX, y: e.clientY }))
                      }}
                    >
                      <path d={d} className="eb-link-hit" />
                      <path
                        d={d}
                        className={`eb-link-path kind-${l.kind} ${isSelectedEventActive ? 'is-selected-link' : ''} ${isHovered ? 'is-hovered' : ''}`}
                      >
                        <title>{`${LINK_KIND_LABELS[l.kind]}: ${describeBoardLink(l, graph)}`}</title>
                      </path>
                      {crossesGaps.map(cg => {
                        const midX_gap = (cg.x0 + cg.x1) / 2
                        const gapY = (x2 - x1 >= 24) ? (midX_gap < (x1 + x2) / 2 ? y1 : y2) : ((y1 + y2) / 2)
                        return (
                          <g key={cg.index} className="eb-link-break-mark">
                            <line x1={midX_gap - 3} y1={gapY - 5} x2={midX_gap + 3} y2={gapY + 5} stroke="var(--color-surface)" strokeWidth="3" />
                            <line x1={midX_gap - 2} y1={gapY - 5} x2={midX_gap + 4} y2={gapY + 5} stroke="var(--color-icon)" strokeWidth="1.5" />
                          </g>
                        )
                      })}
                    </g>
                  )
                })}
              </svg>

              {/* SaaS 레인 및 이벤트 배치 */}
              {boardLayout.lanes.map(lane => (
                <div
                  key={lane.provider}
                  className="eb-lane"
                  style={{ top: lane.y + 28, height: lane.height }}
                >
                  {/* 스티키 레인 머리 (위아래로 로고 + 이름 + 건수) */}
                  <div className="eb-lane-header" style={{ height: lane.height }}>
                    <div className="eb-lane-header-inner">
                      <span className="eb-lane-logo">
                        <ProviderLogo provider={providerLogoId(lane.provider)} />
                      </span>
                      <span className="eb-lane-name">{providerName(lane.provider)}</span>
                      <span className="eb-lane-count">
                        {saasCounts.get(lane.provider) ?? 0}건
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {/* 이벤트 그룹/카드 렌더링 */}
              {boardLayout.placed.map(p => {
                const isGroup = p.key.startsWith('group:')
                const groupOriginKey = isGroup ? p.key.replace('group:', '') : p.key.replace('item:', '')
                const representativeEvent = allBoardEvents.find(e => e.origin_key === groupOriginKey)
                if (!representativeEvent) return null

                const isSelected = selectedEventKey === representativeEvent.origin_key
                const isAnchor = anchorEventKeys.has(representativeEvent.origin_key)
                const isMarked = Boolean(board.marked[representativeEvent.origin_key])
                const isFailure = representativeEvent.outcome === 'failure'
                const isDimmed = Boolean(selectedEventKey && directlyConnectedKeys && !directlyConnectedKeys.has(representativeEvent.origin_key))
                const isRelated = Boolean(selectedEventKey && !isSelected && directlyConnectedKeys?.has(representativeEvent.origin_key))

                const repeatCount = groupCounts.get(p.key) ?? 1
                const evTimeMs = representativeEvent.occurred_at ? Date.parse(representativeEvent.occurred_at) : NaN
                const evTimeTitle = !Number.isNaN(evTimeMs) ? `${formatKstFull(evTimeMs)} KST (${formatUtc(evTimeMs)})` : undefined

                return (
                  <div
                    key={p.key}
                    className={`eb-event-placed density-${boardLayout.density} ${isSelected ? 'is-selected' : ''} ${isFailure ? 'is-failure' : ''} ${isAnchor ? 'is-anchor' : ''} ${isDimmed ? 'is-dimmed' : ''} ${isRelated ? 'is-related' : ''}`}
                    style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
                    onClick={() => handleEventClick(representativeEvent.origin_key)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleEventClick(representativeEvent.origin_key)
                      }
                    }}
                    onMouseEnter={e => {
                      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
                      const rect = e.currentTarget.getBoundingClientRect()
                      hoverTimerRef.current = setTimeout(() => {
                        setHoveredCard({
                          eventKey: representativeEvent.origin_key,
                          anchorRect: rect,
                          repeatCount,
                        })
                      }, 300)
                    }}
                    onMouseLeave={clearHover}
                    onFocus={e => {
                      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
                      const rect = e.currentTarget.getBoundingClientRect()
                      setHoveredCard({
                        eventKey: representativeEvent.origin_key,
                        anchorRect: rect,
                        repeatCount,
                      })
                    }}
                    onBlur={clearHover}
                    aria-label={`${representativeEvent.title || representativeEvent.event_type} (${formatTime(representativeEvent.occurred_at ? Date.parse(representativeEvent.occurred_at) : 0)})`}
                    aria-describedby={hoveredCard?.eventKey === representativeEvent.origin_key ? 'eb-hover-card' : undefined}
                    role="button"
                    tabIndex={0}
                  >
                    {isAnchor && <span className="eb-anchor-tag">시작</span>}

                    {boardLayout.density === 'card' && (
                      <div className="eb-card-content">
                        <span className="eb-card-logo" title={providerName(representativeEvent.provider)}>
                          <ProviderLogo provider={providerLogoId(representativeEvent.provider)} />
                        </span>
                        <div className="eb-card-text">
                        <div className="eb-card-top-line">
                          <span className="eb-card-time" title={evTimeTitle}>
                            {!Number.isNaN(evTimeMs) ? formatTime(evTimeMs) : ''}
                          </span>
                          <span className="eb-card-title">{representativeEvent.title || representativeEvent.event_type}</span>
                          {isMarked && <Star size={12} className="eb-card-star" fill="currentColor" aria-hidden="true" />}
                        </div>
                        <div className="eb-card-actors">
                          <span>{entityLabel(representativeEvent.actor, graph)}</span>
                          {representativeEvent.targets.length > 0 && (
                            <>
                              <span className="eb-card-arrow">→</span>
                              <span>{representativeEvent.targets.map(t => entityLabel(t, graph)).join(', ')}</span>
                            </>
                          )}
                        </div>
                        </div>
                      </div>
                    )}

                    {boardLayout.density === 'mini' && (
                      <div className="eb-mini-content">
                        <span className="eb-card-logo is-mini" title={providerName(representativeEvent.provider)}>
                          <ProviderLogo provider={providerLogoId(representativeEvent.provider)} />
                        </span>
                        {!Number.isNaN(evTimeMs) && (
                          <span className="eb-card-time is-mini" title={evTimeTitle}>{kstTimeStr(evTimeMs)}</span>
                        )}
                        <span className="eb-mini-title">{representativeEvent.title || representativeEvent.event_type}</span>
                        {isMarked && <Star size={10} className="eb-card-star" fill="currentColor" aria-hidden="true" />}
                      </div>
                    )}

                    {repeatCount > 1 && (
                      <button
                        type="button"
                        className="eb-repeat-badge"
                        onClick={e => {
                          e.stopPropagation()
                          setExpandedGroupKeys(prev => {
                            const next = new Set(prev)
                            if (next.has(p.key)) next.delete(p.key)
                            else next.add(p.key)
                            return next
                          })
                        }}
                        title={`반복 이벤트 ${repeatCount}건 ${expandedGroupKeys.has(p.key) ? '접기' : '펼치기'}`}
                      >
                        ×{repeatCount}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
          {/* 선택한 이벤트와 연결 근거 표 */}
          {selectedEvent && selectedFlow && (
            <section className="eb-reason-panel" aria-label="선택한 이벤트와 연결 근거">
              <div className="eb-reason-head">
                <h3>선택한 이벤트와 연결 근거</h3>
                <span>앞 {selectedFlow.prev.length}건, 뒤 {selectedFlow.next.length}건</span>
              </div>
              <div className="eb-reason-scroll">
                <table className="eb-reason-table">
                  <thead>
                    <tr>
                      <th scope="col">시간</th>
                      <th scope="col">SaaS</th>
                      <th scope="col">행위</th>
                      <th scope="col">행위자</th>
                      <th scope="col">대상</th>
                      <th scope="col">연결 근거</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...selectedFlow.prev, null, ...selectedFlow.next].map(item => {
                      const ev = item ? allBoardEvents.find(e => e.origin_key === item.key) : selectedEvent
                      const t = item ? item.t : selectedFlow.selT
                      const gap = !item || Number.isNaN(t) || Number.isNaN(selectedFlow.selT)
                        ? ''
                        : `${t < selectedFlow.selT ? '-' : '+'}${flowGap(Math.abs(t - selectedFlow.selT))}`
                      return (
                        <tr
                          key={item ? `${item.dir}:${item.key}` : 'current'}
                          className={item ? '' : 'is-current'}
                          onClick={item ? () => setSelectedEventKey(item.key) : undefined}
                          title={item ? `${item.title} 이벤트 선택` : undefined}
                        >
                          <td className="eb-reason-time">
                            <span title={!Number.isNaN(t) ? `${formatKstFull(t)} KST (${formatUtc(t)})` : undefined}>
                              {Number.isNaN(t) ? '시각 없음' : formatTime(t).slice(0, 11)}
                            </span>
                            {gap && <span className="eb-reason-gap">{gap}</span>}
                          </td>
                          <td>
                            {ev ? (
                              <span className="eb-reason-saas">
                                <span className="eb-reason-logo" title={providerName(ev.provider)}><ProviderLogo provider={providerLogoId(ev.provider)} /></span>
                                <span className="eb-reason-saas-name">{providerName(ev.provider)}</span>
                              </span>
                            ) : ''}
                          </td>
                          <td className="eb-reason-action">
                            {item ? (
                              <button
                                type="button"
                                className="eb-reason-link"
                                onClick={e => { e.stopPropagation(); setSelectedEventKey(item.key) }}
                              >
                                {item.title}
                              </button>
                            ) : (
                              <strong>{selectedEvent.title}</strong>
                            )}
                          </td>
                          <td className="eb-reason-who">{ev ? breakAtMail(entityLabel(ev.actor, graph)) : ''}</td>
                          <td className="eb-reason-who">{ev ? (ev.targets.length ? breakAtMail(ev.targets.map(x => entityLabel(x, graph)).join(', ')) : '없음') : ''}</td>
                          <td>
                            {item ? (
                              <ul className="eb-reason-list">
                                {item.links.map(l => {
                                  return (
                                    <li
                                      key={l.id}
                                      tabIndex={0}
                                      onMouseEnter={() => setHoveredLinkId(l.id)}
                                      onMouseLeave={() => setHoveredLinkId(null)}
                                      onFocus={() => setHoveredLinkId(l.id)}
                                      onBlur={() => setHoveredLinkId(null)}
                                    >
                                      <svg width="24" height="8" aria-hidden="true" className="eb-link-sample">
                                        <line x1="0" y1="4" x2="24" y2="4" className={`eb-link-path is-selected-link kind-${l.kind}`} />
                                      </svg>
                                      <span>{linkReason(l, item.dir)}</span>
                                      {l.strength === 'review' && <span className="tl-badge eb-reason-review">추가 확인</span>}
                                    </li>
                                  )
                                })}
                              </ul>
                            ) : (
                              <span className="eb-reason-self">기준 이벤트</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        <div className="eb-legend-row" role="toolbar" aria-label="연결선 범례">
          {legendKinds.map(kind => {
            const isEnabled = board.view.linkKinds.includes(kind)
            const count = linkCountsByKind.get(kind) ?? 0
            const label = LINK_KIND_LABELS[kind]
            return (
              <button
                key={kind}
                type="button"
                className={`eb-legend-item ${isEnabled ? 'is-enabled' : 'is-disabled'}`}
                onClick={() => {
                  setBoard(b => ({
                    ...b,
                    view: {
                      ...b.view,
                      linkKinds: isEnabled
                        ? b.view.linkKinds.filter(k => k !== kind)
                        : [...b.view.linkKinds, kind],
                    },
                  }))
                }}
                title={isEnabled ? `${label} 연결선 끄기` : `${label} 연결선 켜기`}
              >
                <svg width="24" height="8" aria-hidden="true" className="eb-legend-sample">
                  <line
                    x1="0"
                    y1="4"
                    x2="24"
                    y2="4"
                    className={`eb-link-path kind-${kind} ${isEnabled ? '' : 'is-disabled-sample'}`}
                  />
                </svg>
                <span className="eb-legend-label">{label}</span>
                <span className="eb-legend-count">{count}</span>
              </button>
            )
          })}
          <button
            type="button"
            className="eb-btn eb-btn-xs"
            onClick={refetchEngineLinks}
            title="보드 이벤트 사이의 엔진 연결 다시 받기"
          >
            연결 다시 받기
          </button>
        </div>
        </div>

        {/* 9. 오른쪽 칸: 이벤트 상세, 출처, 조사 대상 탭. 접거나 폭을 조절할 수 있다 */}
        <aside
          className={`eb-detail-panel eb-side-panel ${sidePanelOpen ? 'is-open' : 'is-collapsed'}`}
          style={sidePanelOpen ? ({ '--eb-side-width': `${sideWidth}px` } as React.CSSProperties) : undefined}
          aria-label="이벤트 상세, 출처, 조사 대상"
        >
          {sidePanelOpen && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="오른쪽 칸 크기 조절"
              aria-valuenow={sideWidth}
              aria-valuemin={SIDE_WIDTH_MIN}
              aria-valuemax={maxSideWidth()}
              tabIndex={0}
              className="eb-side-resizer"
              title="드래그하여 오른쪽 칸 폭 조절 (더블클릭 초기화)"
              onPointerDown={handleSideResizeStart}
              onKeyDown={handleSideResizeKeyDown}
              onDoubleClick={() => setSideWidth(clampSideWidth(SIDE_WIDTH_DEFAULT))}
            />
          )}
          <div className="eb-side-tabs" role="tablist" aria-label="오른쪽 칸">
            {SIDE_TABS.map(t => {
              const label = t.key === 'detail' ? '이벤트 상세' : t.key === 'sources' ? `출처 ${board.sources.length}` : `조사 대상 ${board.subjects.length}`
              const isActive = sidePanelOpen && sideTab === t.key
              const TabIcon = t.icon
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`eb-side-tab ${isActive ? 'is-active' : ''}`}
                  onClick={() => { setSideTab(t.key); setSidePanelOpen(true) }}
                  title={`${label} 보기`}
                >
                  <TabIcon size={15} className="eb-side-tab-icon" aria-hidden="true" />
                  <span className="eb-side-tab-label">{label}</span>
                </button>
              )
            })}
            <button
              type="button"
              className="eb-side-toggle"
              onClick={() => setSidePanelOpen(v => !v)}
              title={sidePanelOpen ? '오른쪽 칸 접기' : '오른쪽 칸 펼치기'}
              aria-label={sidePanelOpen ? '오른쪽 칸 접기' : '오른쪽 칸 펼치기'}
            >
              {sidePanelOpen ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronLeft size={16} aria-hidden="true" />}
            </button>
          </div>

          {/* 이벤트 상세 */}
          <div role="tabpanel" aria-label="이벤트 상세" className="eb-side-body" hidden={!sidePanelOpen || sideTab !== 'detail'}>
            {selectedEvent ? (
              <>
                <div className="eb-dp-head">
                  <div className="eb-dp-meta">
                    <ProviderLogo provider={providerLogoId(selectedEvent.provider)} />
                    <span className="eb-dp-provider">{providerName(selectedEvent.provider)}</span>
                    <span className="eb-dp-sep" aria-hidden="true" />
                    <span>{CATEGORY_LABEL[selectedEvent.category]}</span>
                    <span className={`tl-badge eb-dp-outcome outcome-${selectedEvent.outcome} ${selectedEvent.outcome === 'failure' ? 'is-failure' : ''}`}>
                      결과 {OUTCOME_LABEL[selectedEvent.outcome]}
                    </span>
                    <button
                      type="button"
                      className="ex-icon-btn eb-detail-panel-close"
                      aria-label="닫기"
                      title="상세 닫기"
                      onClick={() => {
                        setSelectedEventKey(null)
                        setShowFlowOnly(false)
                      }}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <strong className="eb-dp-title">{selectedEvent.title}</strong>
                  <div className="eb-dp-time">
                    {selectedEvent.occurred_at ? (
                      <>
                        {formatTime(Date.parse(selectedEvent.occurred_at))} KST
                        <span className="eb-dp-utc">{formatUtc(Date.parse(selectedEvent.occurred_at))}</span>
                      </>
                    ) : '시각 기록 없음'}
                  </div>
                </div>

                <div className="eb-detail-panel-actions">
                    <div className="eb-btn-group" role="group" aria-label="보기">
                      <button
                        type="button"
                        className={`eb-btn eb-btn-sm ${showFlowOnly ? 'is-active' : ''}`}
                        onClick={() => setShowFlowOnly(s => !s)}
                        title={showFlowOnly ? '전체 이벤트 보이기' : '선택한 흐름만 보기'}
                      >
                        {showFlowOnly ? '전체 이벤트 보기' : '이 흐름만 보기'}
                      </button>
                      <button
                        type="button"
                        className="eb-btn eb-btn-sm"
                        onClick={() => toggleMarked(selectedEvent)}
                        title={board.marked[selectedEvent.origin_key] ? '이벤트 표시 해제' : '이벤트 표시'}
                      >
                        <Star size={13} fill={board.marked[selectedEvent.origin_key] ? 'currentColor' : 'none'} aria-hidden="true" />
                        <span>{board.marked[selectedEvent.origin_key] ? '표시 해제' : '표시'}</span>
                      </button>
                    </div>
                    <div className="eb-btn-group" role="group" aria-label="이벤트 작업">
                      <button
                        type="button"
                        className="eb-btn eb-btn-sm"
                        onClick={() => {
                          const objKeys = [selectedEvent.actor?.object_key, ...selectedEvent.targets.map(t => t.object_key)]
                            .filter((k): k is string => Boolean(k && graph.objectsByKey.has(k)))
                          if (objKeys.length > 0) {
                            setNeighborDialog({
                              seeds: objKeys,
                              anchorAt: selectedEvent.occurred_at,
                              anchorEvent: selectedEvent.origin_key,
                              title: selectedEvent.title,
                            })
                          }
                        }}
                        title="이벤트 객체의 그래프 이웃 찾기"
                      >
                        이웃 이벤트 찾기
                      </button>
                      <button
                        type="button"
                        className="eb-btn eb-btn-sm"
                        onClick={() => {
                          setLinkingFromKey(selectedEvent.origin_key)
                          setNotice('연결할 다른 이벤트를 누르세요. 취소하려면 ESC 키를 누르세요.')
                        }}
                        title="다른 이벤트와 분석가 연결 추가"
                      >
                        연결 추가
                      </button>
                      <button
                        type="button"
                        className="eb-btn eb-btn-sm"
                        onClick={() => addNoteSubjectForEvent(selectedEvent.origin_key)}
                        title="이벤트에 메모 추가"
                      >
                        메모
                      </button>
                    </div>
                  </div>

                <div className="eb-detail-panel-body">
                  {/* 핵심 네 칸: 행위자, 대상, 결과, IP */}
                  <div className="eb-dp-grid">
                    <div className="eb-dp-cell">
                      <span className="eb-dp-label">행위자</span>
                      <div className="eb-dp-value">
                        <Entity
                          entity={selectedEvent.actor}
                          graph={graph}
                          onOpenObject={onOpenObject}
                          pin="actor"
                          onPin={addPin}
                        />
                      </div>
                    </div>
                    <div className="eb-dp-cell">
                      <span className="eb-dp-label">대상</span>
                      <div className="eb-dp-value">
                        {selectedEvent.targets.length > 0 ? (
                          selectedEvent.targets.map(t => (
                            <Entity
                              key={`${t.type}:${t.native_id}`}
                              entity={t}
                              graph={graph}
                              onOpenObject={onOpenObject}
                              pin="target"
                              onPin={addPin}
                            />
                          ))
                        ) : '없음'}
                      </div>
                    </div>
                    <div className="eb-dp-cell">
                      <span className="eb-dp-label">결과</span>
                      <div className="eb-dp-value is-plain">
                        {OUTCOME_LABEL[selectedEvent.outcome]}{selectedEvent.outcome_reason ? `, ${selectedEvent.outcome_reason}` : ''}
                      </div>
                    </div>
                    <div className="eb-dp-cell">
                      <span className="eb-dp-label">IP</span>
                      <div className="eb-dp-value is-plain">
                        {selectedEvent.correlation?.client_ip ? (
                          <span className="tl-entity">
                            <span className="tl-mono">{selectedEvent.correlation.client_ip}</span>
                            <button
                              type="button"
                              className="tl-link tl-filter-btn"
                              title="이 IP의 이벤트만 보기"
                              aria-label="이 IP의 이벤트만 보기"
                              onClick={() => addPin({ kind: 'ip', value: selectedEvent.correlation.client_ip!, label: selectedEvent.correlation.client_ip! })}
                            >
                              <Filter size={13} strokeWidth={1.75} aria-hidden="true" />
                            </button>
                          </span>
                        ) : '기록 없음'}
                      </div>
                    </div>
                  </div>

                  {/* 그래프와 일치한 값, 관계 */}
                  {timedSelectedEvent && (
                    <section className="eb-evidence" aria-label="그래프 대조">
                      <div className="eb-evidence-head">
                        <span className="eb-evidence-title">그래프 대조</span>
                      </div>
                      <dl className="tl-facts eb-dp-match">
                        <MatchFacts event={timedSelectedEvent} />
                      </dl>
                    </section>
                  )}

                  {/* 원본 필드 */}
                  {timedSelectedEvent && (
                    <details className="tl-raw eb-evidence">
                      <summary className="eb-evidence-head" title="원본 필드 접기 또는 펼치기">
                        <span className="eb-evidence-title">원본 필드</span>
                        <span className="eb-evidence-meta">{rawFields(timedSelectedEvent).length}개</span>
                      </summary>
                      <dl>
                        {rawFields(timedSelectedEvent).map(([name, value]) => (
                          <Fragment key={name}>
                            <dt>{name}</dt>
                            <dd>{value}</dd>
                          </Fragment>
                        ))}
                      </dl>
                      <div className="tl-raw-actions">
                        <button
                          type="button"
                          className="tl-btn"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(JSON.stringify(selectedEvent, null, 2))
                              setNotice('원본 로그를 복사했습니다.')
                            } catch {
                              setNotice('복사하지 못했습니다.')
                            }
                          }}
                          title="원본 로그를 클립보드에 복사"
                        >
                          원본 복사
                        </button>
                      </div>
                    </details>
                  )}
                </div>
              </>
            ) : (
              <div className="eb-empty-hint">고른 이벤트 없음. 보드에서 이벤트를 누르면 상세가 보입니다.</div>
            )}
          </div>

          {/* 출처: 조회, AI 검색, 이웃 조회 */}
          <div role="tabpanel" aria-label="출처" className="eb-side-body eb-sources-body" hidden={!sidePanelOpen || sideTab !== 'sources'}>
            {board.sources.length === 0 ? (
              <div className="eb-empty-hint">올려진 출처가 없습니다. 「추가」에서 「기간으로 이벤트 추가하기」나 「AI로 이벤트 추가하기」를 누르세요.</div>
            ) : (
              board.sources.map(s => {
                const isHidden = board.view.hiddenSources.includes(s.id)
                const res = s.kind === 'query' ? sourceResults[s.id] : null
                const count = s.kind === 'query' ? (res?.events?.length ?? 0) : (s.events?.length ?? s.eventKeys.length)
                const badgeLabel = s.kind === 'query' ? (s.neighbors ? '이웃' : '조회') : 'AI'

                return (
                  <div key={s.id} className={`eb-source-item ${isHidden ? 'is-hidden' : ''}`}>
                    <div className="eb-source-row-top">
                      <span className={`eb-source-badge kind-${badgeLabel}`}>{badgeLabel}</span>
                      <strong className="eb-source-title" title={s.title}>{s.title}</strong>
                      <span className="eb-source-count">{count}건</span>
                    </div>

                    {res?.loading && (
                      <div className="eb-source-loading" role="status">
                        <span>조회 중...</span>
                      </div>
                    )}

                    {res?.problem && (
                      <div className="eb-source-problem">{res.problem}</div>
                    )}

                    {s.kind === 'ai' && !s.events && (
                      <div className="eb-source-shrunk-hint">본문이 저장되지 않음</div>
                    )}

                    <div className="eb-source-actions">
                      <button
                        type="button"
                        className="eb-btn eb-btn-xs"
                        onClick={() => {
                          setBoard(b => ({
                            ...b,
                            view: {
                              ...b.view,
                              hiddenSources: isHidden
                                ? b.view.hiddenSources.filter(id => id !== s.id)
                                : [...b.view.hiddenSources, s.id],
                            },
                          }))
                        }}
                        title={isHidden ? '출처 이벤트 보이기' : '출처 이벤트 숨기기'}
                      >
                        {isHidden ? <Eye size={12} aria-hidden="true" /> : <EyeOff size={12} aria-hidden="true" />}
                        <span>{isHidden ? '보이기' : '숨기기'}</span>
                      </button>

                      {s.kind === 'query' && (
                        <button
                          type="button"
                          className="eb-btn eb-btn-xs"
                          onClick={() => runQuerySource(s.id, s.scope)}
                          title="출처 다시 조회"
                        >
                          <RotateCw size={12} aria-hidden="true" />
                          <span>다시 조회</span>
                        </button>
                      )}

                      <button
                        type="button"
                        className="eb-btn eb-btn-xs"
                        onClick={() => {
                          setBoard(b => ({
                            ...b,
                            sources: b.sources.filter(item => item.id !== s.id),
                          }))
                          setSourceResults(prev => {
                            const next = { ...prev }
                            delete next[s.id]
                            return next
                          })
                        }}
                        title="출처 빼기"
                      >
                        <X size={12} aria-hidden="true" />
                        <span>빼기</span>
                      </button>
                    </div>
                  </div>
                )
              })
            )}


            {/* 출처 요약 목록 */}
            <details className="eb-source-summary">
              <summary title="출처 요약 접기 또는 펼치기">출처 요약</summary>
              {(() => {
                const times = visibleEvents
                  .map(e => (e.occurred_at ? Date.parse(e.occurred_at) : NaN))
                  .filter(t => !Number.isNaN(t))
                const fromIso = times.length ? new Date(Math.min(...times)).toISOString() : new Date().toISOString()
                const toIso = times.length ? new Date(Math.max(...times)).toISOString() : new Date().toISOString()
                const sum = summarize(visibleEvents, {
                  from: fromIso,
                  to: toIso,
                  objectKeys: [],
                  relationKeys: [],
                  outsidePeople: [],
                })
                return (
                  <div className="eb-summary-lists">
                    <div className="eb-summary-block">
                      <span className="eb-summary-subhead">시간대별</span>
                      <ul>
                        {sum.byTime.buckets.slice(0, 5).map(b => (
                          <li key={b.start}>{kstTimeStr(Date.parse(b.start))}: {b.total}건</li>
                        ))}
                      </ul>
                    </div>
                    <div className="eb-summary-block">
                      <span className="eb-summary-subhead">주요 행위자</span>
                      <ul>
                        {sum.actors.slice(0, 5).map(a => (
                          <li key={a.key}>{a.label}: {a.count}건</li>
                        ))}
                      </ul>
                    </div>
                    <div className="eb-summary-block">
                      <span className="eb-summary-subhead">이벤트 종류</span>
                      <ul>
                        {sum.eventTypes.slice(0, 5).map(t => (
                          <li key={t.type}>{t.type}: {t.count}건</li>
                        ))}
                      </ul>
                    </div>
                    <div className="eb-summary-block">
                      <span className="eb-summary-subhead">주요 객체</span>
                      <ul>
                        {sum.touched.slice(0, 5).map(o => (
                          <li key={o.objectKey}>{objectLabel(o.objectKey, graph)}: {o.asActor + o.asTarget}건</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )
              })()}
            </details>
          </div>

          {/* 조사 대상: 위협, 객체, 메모 */}
          <div role="tabpanel" aria-label="조사 대상" className="eb-side-body" hidden={!sidePanelOpen || sideTab !== 'subjects'}>
            {/* 조사 대상: 위협, 객체, 메모 */}
            <section className="eb-side-section" aria-label="조사 대상">
              <h3 className="eb-side-title">조사 대상 ({board.subjects.length})</h3>
              {board.subjects.length === 0 ? (
                <div className="eb-empty-hint">없음</div>
              ) : (
              <div className="eb-subjects-list">
                {board.subjects.map(s => {
                  if (s.kind === 'threat') {
                    return (
                      <div key={s.id} className="eb-subject-item eb-subject-threat">
                        <span className="eb-subject-badge">위협</span>
                        <strong className="eb-subject-label" title={s.title}>{s.title}</strong>
                        <div className="eb-subject-actions">
                          <button
                            type="button"
                            className="eb-btn eb-btn-xs"
                            onClick={() => {
                              const { scope } = scopeFor(s.objectKeys, '7d')
                              const newSource: Source = {
                                id: crypto.randomUUID(),
                                kind: 'query',
                                title: `${s.title}, 최근 7일`,
                                scope,
                                createdAt: new Date().toISOString(),
                              }
                              setBoard(b => ({ ...b, sources: [...b.sources, newSource] }))
                              executedSourcesRef.current.add(newSource.id)
                              runQuerySource(newSource.id, scope)
                              setNotice(`위협 관련 7일 조회를 추가했습니다.`)
                            }}
                            title="위협 관련 이벤트 조회 실행"
                          >
                            이벤트 조회
                          </button>
                          <button
                            type="button"
                            className="eb-btn eb-btn-xs"
                            onClick={() => setNeighborDialog({
                              seeds: s.objectKeys.filter(k => graph.objectsByKey.has(k)),
                              title: s.title,
                            })}
                            title="위협 객체의 그래프 이웃 이벤트 찾기"
                          >
                            이웃 이벤트
                          </button>
                          <button
                            type="button"
                            className="eb-btn-close"
                            onClick={() => setBoard(b => ({
                              ...b,
                              subjects: b.subjects.filter(item => item.id !== s.id),
                            }))}
                            title="조사 대상에서 빼기"
                            aria-label="조사 대상에서 빼기"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    )
                  }
                  if (s.kind === 'object') {
                    return (
                      <div key={s.id} className="eb-subject-item eb-subject-object">
                        <span className="eb-subject-badge">객체</span>
                        <strong className="eb-subject-label" title={s.label}>{s.label}</strong>
                        <div className="eb-subject-actions">
                          <button
                            type="button"
                            className="eb-btn eb-btn-xs"
                            onClick={() => {
                              const { scope } = scopeFor([s.objectKey], '7d')
                              const newSource: Source = {
                                id: crypto.randomUUID(),
                                kind: 'query',
                                title: `${s.label}, 최근 7일`,
                                scope,
                                createdAt: new Date().toISOString(),
                              }
                              setBoard(b => ({ ...b, sources: [...b.sources, newSource] }))
                              executedSourcesRef.current.add(newSource.id)
                              runQuerySource(newSource.id, scope)
                              setNotice(`객체 관련 7일 조회를 추가했습니다.`)
                            }}
                            title="객체 관련 이벤트 조회 실행"
                          >
                            이벤트 조회
                          </button>
                          <button
                            type="button"
                            className="eb-btn eb-btn-xs"
                            onClick={() => setNeighborDialog({
                              seeds: [s.objectKey],
                              title: s.label,
                            })}
                            title="객체의 그래프 이웃 이벤트 찾기"
                          >
                            이웃 이벤트
                          </button>
                          <button
                            type="button"
                            className="eb-btn eb-btn-xs"
                            onClick={() => onOpenObject(s.objectKey)}
                            title="그래프에서 객체 열기"
                          >
                            그래프에서 보기
                          </button>
                          <button
                            type="button"
                            className="eb-btn-close"
                            onClick={() => setBoard(b => ({
                              ...b,
                              subjects: b.subjects.filter(item => item.id !== s.id),
                            }))}
                            title="조사 대상에서 빼기"
                            aria-label="조사 대상에서 빼기"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    )
                  }
                  return (
                    <div key={s.id} className="eb-subject-item eb-subject-note">
                      <span className="eb-subject-badge">메모</span>
                      <input
                        type="text"
                        className="eb-subject-note-input"
                        value={s.text}
                        title="메모 내용 입력"
                        onChange={e => {
                          const text = e.target.value
                          setBoard(b => ({
                            ...b,
                            subjects: b.subjects.map(item => item.id === s.id ? { ...item, text } : item),
                          }))
                        }}
                      />
                      {s.eventKey && (
                        <span className="eb-subject-event-ref" title="연결된 이벤트">
                          이벤트
                        </span>
                      )}
                      <button
                        type="button"
                        className="eb-btn-close"
                        onClick={() => setBoard(b => ({
                          ...b,
                          subjects: b.subjects.filter(item => item.id !== s.id),
                        }))}
                        title="메모 빼기"
                        aria-label="메모 빼기"
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
              )}
            </section>

          </div>
        </aside>
      </div>

      {/* 이벤트 카드 호버 상자 */}
      {hoveredCard && (() => {
        const ev = allBoardEvents.find(e => e.origin_key === hoveredCard.eventKey)
        if (!ev) return null
        return (
          <EventHoverCard
            event={ev}
            labelOf={ref => entityLabel(ref, graph)}
            repeatCount={hoveredCard.repeatCount}
            links={links}
            anchorRect={hoveredCard.anchorRect}
          />
        )
      })()}

      {/* 분석가 연결 이유 입력 팝오버 */}
      {linkingPending && (
        <div className="eb-dialog-backdrop" role="dialog" aria-label="카드 연결 이유 입력">
          <div className="eb-dialog">
            <h4>분석가 연결 이유</h4>
            <p>두 이벤트 사이의 판단 이유 입력, 생략 가능</p>
            <input
              type="text"
              className="eb-dialog-input"
              value={linkingNote}
              onChange={e => setLinkingNote(e.target.value)}
              placeholder="예: 시간 근접, 같은 로그인 세션 의심"
              title="분석가 연결 이유 입력"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') confirmAnalystLink() }}
            />
            <div className="eb-dialog-btns">
              <button type="button" className="eb-btn eb-btn-primary" onClick={confirmAnalystLink} title="두 이벤트 사이에 분석가 연결 추가">
                연결 추가
              </button>
              <button type="button" className="eb-btn" onClick={() => setLinkingPending(null)} title="연결 취소">
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 분석가 연결 수정/삭제 모달 */}
      {editingUserLink && (
        <div className="eb-dialog-backdrop" role="dialog" aria-label="분석가 연결 수정">
          <div className="eb-dialog">
            <h4>분석가 연결 수정</h4>
            <input
              type="text"
              className="eb-dialog-input"
              value={editingUserLink.note}
              onChange={e => setEditingUserLink({ ...editingUserLink, note: e.target.value })}
              placeholder="이유 입력"
              title="수정할 연결 이유 입력"
              autoFocus
            />
            <div className="eb-dialog-btns">
              <button
                type="button"
                className="eb-btn eb-btn-primary"
                onClick={() => {
                  setBoard(b => ({
                    ...b,
                    userLinks: b.userLinks.map(l => l.id === editingUserLink.id ? { ...l, note: editingUserLink.note.trim() } : l),
                  }))
                  setEditingUserLink(null)
                  setNotice('분석가 연결 이유를 저장했습니다.')
                }}
                title="수정한 연결 이유 저장"
              >
                이유 저장
              </button>
              <button
                type="button"
                className="eb-btn eb-btn-danger"
                onClick={() => {
                  setBoard(b => ({
                    ...b,
                    userLinks: b.userLinks.filter(l => l.id !== editingUserLink.id),
                  }))
                  setEditingUserLink(null)
                  setNotice('분석가 연결을 끊었습니다.')
                }}
                title="두 이벤트 사이의 분석가 연결 끊기"
              >
                연결 끊기
              </button>
              <button type="button" className="eb-btn" onClick={() => setEditingUserLink(null)} title="대화창 닫기">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 새 조회 추가 모달 */}
      {showAddQuery && (
        <AddQueryDialog
          subjects={board.subjects}
          graph={graph}
          onClose={() => setShowAddQuery(false)}
          onCreate={src => {
            setShowAddQuery(false)
            setBoard(b => ({ ...b, sources: [...b.sources, src] }))
            executedSourcesRef.current.add(src.id)
            runQuerySource(src.id, src.scope)
            setNotice('새 조회를 시작했습니다.')
          }}
        />
      )}

      {/* 연결선 설명 팝오버 */}
      {(() => {
        const activeLinkState = selectedLink ?? hoveredLink
        if (!activeLinkState) return null
        const link = renderedLinks.find(l => l.id === activeLinkState.id)
        if (!link) return null
        const fromEv = allBoardEvents.find(e => e.origin_key === link.from)
        const toEv = allBoardEvents.find(e => e.origin_key === link.to)
        return (
          <LinkPopover
            link={link}
            fromEv={fromEv}
            toEv={toEv}
            graph={graph}
            anchorX={activeLinkState.x}
            anchorY={activeLinkState.y}
            pinned={Boolean(selectedLink)}
            onClose={() => setSelectedLink(null)}
            onSelectEvent={key => {
              setSelectedLink(null)
              setSelectedEventKey(key)
              setShowFlowOnly(false)
            }}
            onEditAnalyst={
              link.kind === 'analyst'
                ? () => {
                    setSelectedLink(null)
                    setEditingUserLink({ id: link.id, note: link.note || '' })
                  }
                : undefined
            }
          />
        )
      })()}

      {/* 저장된 조사 목록 모달 */}
      {showSavedList && (
        <div className="eb-dialog-backdrop" role="dialog" aria-label="저장된 조사 목록">
          <div className="ei-saved-dialog">
            <div className="ei-saved-dialog-head">
              <h2>저장된 조사 목록</h2>
              <button
                type="button"
                className="ex-icon-btn"
                aria-label="닫기"
                title="대화창 닫기"
                onClick={() => setShowSavedList(false)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="ei-saved-list">
              {investigationsStore.items.length === 0 ? (
                <p className="eb-empty-hint">저장된 조사가 없습니다.</p>
              ) : (
                [...investigationsStore.items]
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .map(item => {
                    const parsed = parseBoardAny(item.board)
                    const sourceCount = parsed?.sources.length ?? 0
                    const markedCount = Object.keys(parsed?.marked ?? {}).length

                    return (
                      <div key={item.id} className="ei-saved-row">
                        <div className="ei-saved-info">
                          <div className="ei-saved-title-row">
                            <span className={`ei-state-badge state-${item.state}`}>
                              {INVESTIGATION_STATE_LABEL[item.state]}
                            </span>
                            <strong className="ei-saved-title">{item.title}</strong>
                          </div>
                          <div className="ei-saved-meta">
                            <span>담당: {item.owner || '미정'}</span>
                            <span title={utcTitle(item.updatedAt)}>수정: {formatKst(item.updatedAt)}</span>
                            <span>수정자: {item.updatedBy}</span>
                            <span>출처: {sourceCount}개, 표시: {markedCount}건</span>
                          </div>
                          {item.conclusion && (
                            <div className="ei-saved-conclusion">
                              결론: {item.conclusion}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="ex-btn"
                          onClick={() => handleOpenInvestigation(item)}
                          title={`${item.title} 조사 열기`}
                        >
                          열기
                        </button>
                      </div>
                    )
                  })
              )}
            </div>
            <div className="eb-dialog-btns">
              <button type="button" className="ex-btn" onClick={() => setShowSavedList(false)} title="저장된 조사 목록 닫기">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 다음 조회 후보 모달 */}
      {showCandidates && (
        <div className="eb-dialog-backdrop" role="dialog" aria-label="다음 조회 후보">
          <div className="ei-candidates-dialog">
            <div className="ei-candidates-dialog-head">
              <h2>다음 조회 후보 ({candidates.length})</h2>
              <button
                type="button"
                className="ex-icon-btn"
                aria-label="닫기"
                title="대화창 닫기"
                onClick={() => setShowCandidates(false)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="ei-candidates-list">
              {candidates.length === 0 ? (
                <p className="eb-empty-hint">아직 조회하지 않은 객체가 없습니다.</p>
              ) : (
                candidates.map(c => (
                  <div key={c.id} className="ei-candidate-row">
                    <div className="ei-candidate-info">
                      <span className="ei-candidate-reason">{candidateReason(c)}</span>
                      <div className="ei-candidate-objects">
                        {c.objectKeys.map(k => (
                          <span key={k} className="ei-candidate-pill" title={k}>
                            {objectLabel(k, graph)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="ei-candidate-actions">
                      <button
                        type="button"
                        className="ex-btn"
                        title="선택한 후보 객체로 조회 추가"
                        onClick={() => {
                          const { scope } = scopeFor(c.objectKeys, '7d')
                          const newSource: Source = {
                            id: crypto.randomUUID(),
                            kind: 'query',
                            title: `${CANDIDATE_TITLE[c.kind]}, 최근 7일`,
                            scope,
                            createdAt: new Date().toISOString(),
                          }
                          setBoard(b => ({ ...b, sources: [...b.sources, newSource] }))
                          executedSourcesRef.current.add(newSource.id)
                          runQuerySource(newSource.id, scope)
                          setShowCandidates(false)
                          setNotice('후보 범위 조사를 시작했습니다.')
                        }}
                      >
                        질의 만들기
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="eb-dialog-btns">
              <button type="button" className="ex-btn" onClick={() => setShowCandidates(false)} title="조회 후보 목록 닫기">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 이웃 이벤트 모달 */}
      {neighborDialog && (
        <NeighborTimelineDialog
          seeds={neighborDialog.seeds}
          anchorAt={neighborDialog.anchorAt}
          anchorEvent={neighborDialog.anchorEvent}
          sourceTitle={neighborDialog.title}
          graph={graph}
          onClose={() => setNeighborDialog(null)}
          onCreate={src => {
            setNeighborDialog(null)
            setBoard(b => ({ ...b, sources: [...b.sources, src] }))
            executedSourcesRef.current.add(src.id)
            runQuerySource(src.id, src.scope)
            setNotice('그래프 이웃 이벤트 조사를 시작했습니다.')
          }}
        />
      )}

      {!aiOpen && <AiLauncher onClick={() => setAiOpen(true)} />}

      {/* AI 패널 포털 */}
      {(() => {
        const aiMount = (
          <div className="assistant-global-mount ei-assistant" hidden={!aiOpen}>
            <AssistantPanel
              key={`${storageKey}:${generation}`}
              graph={graph}
              findings={findings}
              snapshotId={snapshotId}
              isOpen={aiOpen}
              onClose={() => { setAiOpen(false); focusAiLauncher() }}
              context={{
                evidenceStore,
                workspace: {
                  page: 'EventBoard',
                  selection: emptySelection(),
                  timeline: selectedEventKey ? { eventKey: selectedEventKey } : undefined,
                  board: boardWorkspace(board, candidates),
                },
                seed,
                onSelectEvent: key => {
                  setSelectedEventKey(key)
                },
                onShowEventGraph,
                onAddEvents: (events, evidence, question) => {
                  // 집계 검색은 이벤트가 아니라 결과 행만 돌려준다. 빈 출처는 만들지 않는다
                  if (!events.nodes.length) {
                    setNotice('이 답은 집계 결과라 보드에 올릴 이벤트가 없습니다. 「원본 이벤트 목록으로 찾아줘」처럼 다시 질문하세요.')
                    return
                  }
                  const keys = events.nodes.map(n => n.key)
                  const enriched = events.nodes.map(node => snapshotFromAssistantNode(node, evidence))
                  if (isDuplicateAiSource(board.sources, keys)) {
                    const keySet = new Set(keys)
                    const dup = board.sources.find(
                      (s): s is Extract<Source, { kind: 'ai' }> =>
                        s.kind === 'ai' && s.eventKeys.length === keySet.size && s.eventKeys.every(k => keySet.has(k)),
                    )
                    const needsEnrich = dup?.events?.some((ev, i) => !ev.actor?.display && Boolean(enriched[i]?.actor?.display))
                    if (dup && needsEnrich) {
                      setBoard(b => ({
                        ...b,
                        sources: b.sources.map(s => (s.id === dup.id ? { ...dup, events: enriched } : s)),
                      }))
                      setNotice('AI 이벤트 정보를 보드에 반영했습니다.')
                      return
                    }
                    setNotice('같은 AI 결과가 이미 보드에 있습니다.')
                    return
                  }
                  const newAiSource: Source = {
                    id: crypto.randomUUID(),
                    kind: 'ai',
                    title: aiSourceTitle(question, events.nodes.length),
                    question,
                    eventKeys: keys,
                    events: enriched,
                    createdAt: new Date().toISOString(),
                  }
                  if (events.edges && events.edges.length > 0) {
                    const added: EventLink[] = events.edges.map(edge => ({
                      from: edge.from,
                      to: edge.to,
                      basis: edge.basis || 'session',
                      strength: edge.strength === 'review' ? ('review' as const) : ('confirmed' as const),
                    } as unknown as EventLink))
                    setExtraEngineLinks(prev => [...prev, ...added])
                  }
                  const times = (newAiSource.events ?? [])
                    .map(e => (e.occurred_at ? Date.parse(e.occurred_at) : NaN))
                    .filter(t => !Number.isNaN(t))
                  if (times.length > 0) {
                    const minT = Math.min(...times)
                    const maxT = Math.max(...times)
                    setNewRange({ start: minT, end: maxT, until: Date.now() + 3000 })
                  }
                  setBoard(b => ({
                    ...b,
                    sources: [...b.sources, newAiSource],
                  }))
                  setNotice(`AI 결과 ${events.nodes.length}건을 보드에 올렸습니다.`)
                },
                onFocusEvents: keys => {
                  const matching = visibleEvents.filter(e => keys.includes(e.origin_key))
                  if (!matching.length) {
                    setNotice('이 이벤트들은 지금 보드에 보이지 않습니다. 필터나 숨긴 출처를 확인하세요.')
                    return
                  }
                  const sorted = [...matching].sort((a, b) => {
                    const ta = a.occurred_at ? Date.parse(a.occurred_at) : Infinity
                    const tb = b.occurred_at ? Date.parse(b.occurred_at) : Infinity
                    return ta - tb
                  })
                  const earliest = sorted[0]
                  setSelectedEventKey(earliest.origin_key)
                  const placed = placedMap.get(earliest.origin_key) || eventToGroupMap.get(earliest.origin_key)
                  const eventX = placed ? placed.x : (earliest.occurred_at ? axis.x(Date.parse(earliest.occurred_at)) : 0)
                  const targetScroll = Math.max(0, eventX - viewportWidth / 2)
                  if (boardScrollRef.current) {
                    boardScrollRef.current.scrollLeft = targetScroll
                  }
                },
                onNavigate: n => {
                  if (n.eventKey) {
                    setSelectedEventKey(n.eventKey)
                  } else if (n.objectKey) {
                    onOpenObject(n.objectKey)
                  }
                },
              }}
            />
          </div>
        )
        return shell ? createPortal(aiMount, shell) : aiMount
      })()}
    </main>
  )
}
