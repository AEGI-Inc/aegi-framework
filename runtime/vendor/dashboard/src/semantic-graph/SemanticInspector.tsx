import GraphEventList from '../assistant/GraphEventList'
import type { AssistantEventNode } from '../assistant/types'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import ProviderLogo from '../ProviderLogo'
import type { ProviderId } from '../providerOverviewData'
import type { GraphStore, GraphStoreV2 } from '../model/graph'
import type { SemanticNode, SemanticEdge, SemanticLevel } from './types'
import { SEMANTIC_LEVEL_LABELS } from './types'
import type { FindingV2 } from '../model/findingV2'
import type { EffectiveAccessRow } from '../detection/v2/effectiveAccess/types'
import { SEVERITY_RANK } from '../findings/severity'
import SeverityDot from '../findings/SeverityDot'
import { ArrowRight, Box, Building2, ChevronDown, ChevronRight, Compass, FolderDown, History, KeyRound, Link2, Plug, Share2, Shield, ShieldCheck, User, Webhook, Workflow, X, Zap, type LucideIcon } from 'lucide-react'
import { useRelatedEventCount } from '../timeline/relatedEvents'
import EdgeInspector from './EdgeInspector'
import { tenantObjectKey } from './hierarchy'
import EaInspector from './EaInspector'
import { EaBrief, groupEa } from '../findings/EaPath'
import { EA_RULE_LABEL, explainEaRow } from '../findings/eaExplain'
import NodeStandardFindings from '../config-findings/NodeStandardFindings'
import EaCard from './EaCard'
import AiAskButton from '../assistant/AiAskButton'
import BlastSummary from '../blast-radius/BlastSummary'
import { relationLabel } from './edgeExplain'
import { shownKind, typeNoun } from '../utils/objectPhrase'
import { formatKst, utcTitle } from '../utils/time'
import { COLLECTION_STATE_LABEL, daysAgoText, type ProviderCollection } from '../model/collectionFreshness'
import {
  INTERFACE_COPY, providerProfile, SCOPE_KIND_LABEL,
  connectionsOf, describeObject, outsideLinks, providerLabel, securityFor,
  type ConnectionItem,
  type EaNote,
  type SecuritySummary,
} from './nodeInsight'

export interface SemanticInspectorProps {
  eventEvidence?: AssistantEventNode[]
  onOpenEvent?: (key: string, objects?: string[], at?: string | null) => void
  onAskEvent?: (key: string) => void
  /** SaaS별 마지막 수집과 상태. SaaS 요약의 보안 요약에 함께 적어, 0이 수집이 안 된 탓인지 가린다 */
  collection?: Map<string, ProviderCollection>
  /** Evidence subgraphs cannot establish the absence of access or other security facts. */
  evidenceOnly?: boolean
  selectedNode: SemanticNode | null
  selectedEdge: SemanticEdge | null
  /** 고른 Effective Access 결론 (EA 선을 누르거나 상세 패널에서 고름) */
  selectedEaRows?: EffectiveAccessRow[] | null
  /** 선택한 엣지의 양 끝 노드 (이름·소속 객체를 보여 주려고) */
  sourceNode?: SemanticNode | null
  targetNode?: SemanticNode | null
  activeGraph: GraphStore | GraphStoreV2
  currentLevel: SemanticLevel
  onClose: () => void
  v2Findings?: FindingV2[]
  /** Effective Access 결론 (denied 제외) */
  eaRows?: EffectiveAccessRow[]
  /** 지금 화면의 선 (묶음 칸의 「연결」 탭이 쓴다) */
  visibleEdges?: SemanticEdge[]
  nodesById?: ReadonlyMap<string, SemanticNode>
  onSelectEdge?: (edgeId: string) => void
  onOpenThreat?: (findingId: string) => void
  onDrillToEvidence?: (targetObjectKey: string) => void
  /** 개별 객체에서 「Explorer 에서 탐색」 — 그 객체에서 시작하는 검색 · 구조 쿼리 · 경로 */
  onOpenExplorer?: (fixtureKey: string) => void
  /** 개별 객체에서 「관련 이벤트 n건」: 그 객체의 최근 7일 조회를 추가한 Event Board 를 연다 */
  onOpenEvents?: (fixtureKey: string) => void
  onOpenEa?: (rowIds: string[]) => void
  /** 자격증명을 골랐을 때 「피해범위 상세」 — Credentials 상세로 간다 */
  onOpenBlastRadius?: (credentialKey: string) => void
  onDrillDownLevel?: (node: SemanticNode) => void
  onExpandNeighbors?: (objectKey: string) => void
  /** 그 객체에 펼칠 연결이 있는지. 없으면 「연결된 항목 펼치기」를 끈다 */
  hasNeighbors?: (objectKey: string) => boolean
  /** 이 객체를 경로의 시작이나 도착으로 정한다. 둘 다 정하면 그래프가 그 사이 경로를 강조한다 */
  onPathEnd?: (objectKey: string, end: 'start' | 'end') => void
  /** 지금 정해 둔 경로의 시작과 도착 */
  pathEnds?: { start: string; end: string }
  remainingCandidateCount?: number
  /** 캔버스가 좁아 도구 막대와 겹치면 참 — 패널을 도구 막대 아래로 내린다 */
  belowToolbar?: boolean
  onAskSelection?: () => void
}

type InspectorTab = 'overview' | 'data' | 'relations' | 'findings'

/* 상세에서 보던 탭. 다른 화면에 다녀와 같은 칸이 다시 열리면 그 탭으로 연다(탭 세션). 다른 칸을 고르면 개요부터 */
const TAB_KEY = 'aegi:graph-inspector-tab'
const INSPECTOR_TABS: InspectorTab[] = ['overview', 'data', 'relations', 'findings']

function readInspectorTab(nodeId: string | undefined): InspectorTab {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(TAB_KEY) ?? '{}') as { node?: unknown; tab?: unknown }
    return nodeId && saved.node === nodeId && INSPECTOR_TABS.includes(saved.tab as InspectorTab) ? (saved.tab as InspectorTab) : 'overview'
  } catch {
    return 'overview'
  }
}

const toLogo = (p: string): ProviderId => (p.toLowerCase() === 'gws' ? 'google-workspace' : (p.toLowerCase() as ProviderId))

/** 관계 묶음 안의 항목을 종류(「Slack 계정」)별로 나눈다. 종류는 줄마다 적지 않고 소제목으로 한 번만 적는다. */
function itemsByType(items: ConnectionItem[], limit: number): Array<{ label: string; total: number; items: ConnectionItem[] }> {
  const types = new Map<string, ConnectionItem[]>()
  for (const item of items) {
    const label = `${providerLabel(item.obj.provider)} ${item.obj.type}`.trim()
    types.set(label, [...(types.get(label) ?? []), item])
  }
  const out: Array<{ label: string; total: number; items: ConnectionItem[] }> = []
  let left = limit
  for (const [label, list] of types) {
    if (left <= 0) break
    out.push({ label, total: list.length, items: list.slice(0, left) })
    left -= list.length
  }
  return out
}

/** 개별 객체에서 이 항목이 결론의 어디에 있나 */
const EA_WHERE: Record<EaNote['where'], string> = { source: '출발', target: '도착', via: '경유' }

/**
 * 개별 객체의 Effective Access. 보안 요약의 한 줄 목록이 아니라 선 상세와 같은 카드(판정, 질문, 경로 그림)를
 * 그대로 보인다. 카드마다 그래프에 그 선을 켜고 선 상세를 여는 단추가 있다.
 */
function EaObjectSection({ notes, eaRows, activeGraph, v2Findings, onOpenThreat, onFocusObject, onOpenEa }: {
  notes: EaNote[]
  eaRows: EffectiveAccessRow[]
  activeGraph: GraphStore | GraphStoreV2
  v2Findings: FindingV2[]
  onOpenThreat?: (findingId: string) => void
  onFocusObject?: (objectKey: string) => void
  onOpenEa?: (rowIds: string[]) => void
}) {
  const cards = useMemo(() => notes.flatMap(note => {
    const row = eaRows.find(r => r.id === note.rowId)
    return row ? [{ note, x: explainEaRow(activeGraph, row) }] : []
  }), [notes, eaRows, activeGraph])
  const [openId, setOpenId] = useState<string | null>(null)
  if (!cards.length) return null
  return (
    <Block title="Effective Access 결과" aside={<span className="szi-block-count">{cards.length}건</span>} className="szi-ea-sec">
      {/* 처음에는 판정, 종류, 출발 → 도착 한 줄씩만 보이고, 누른 줄만 질문과 경로 그림 카드가 펼쳐진다 */}
      {cards.map(({ note, x }, i) => {
        const open = openId === note.rowId
        return (
          <div key={note.rowId} className={`szi-ea-item ${open ? 'is-open' : ''}`}>
            <button type="button" className="szi-sec-row is-ea" aria-expanded={open} onClick={() => setOpenId(open ? null : note.rowId)}>
              <Zap size={13} strokeWidth={2} aria-hidden="true" />
              <span className="szi-ea-row">
                <span className="ea-card-top">
                  <em className={`ea-level ${x.row.level}`}>{x.levelLabel}</em>
                  <span>{EA_RULE_LABEL[x.row.source.rule]}</span>
                  <span className="szi-ea-where">{EA_WHERE[note.where]}</span>
                </span>
                <EaBrief chain={x.chain} sources={[x.source.name]} paths={1} />
              </span>
              <ChevronDown size={13} aria-hidden="true" className="szi-ea-chevron" />
            </button>
            {open && (
              <EaCard x={x} label={`Effective Access ${i + 1}`}
                finding={v2Findings.find(f => f.ruleId === x.row.x_asked_by.rule_id)} onOpenThreat={onOpenThreat} onFocusObject={onFocusObject}
                footer={onOpenEa && (
                  <button type="button" className="szi-ea-show" onClick={() => onOpenEa([note.rowId])}>
                    <Zap size={13} strokeWidth={2} aria-hidden="true" /> 그래프에서 이 선 보기
                  </button>
                )} />
            )}
          </div>
        )
      })}
    </Block>
  )
}

/** 심각도별 Finding 수(높은 것부터) */
function severityCounts(findings: FindingV2[]): Array<[FindingV2['severity'], number]> {
  const counts = new Map<FindingV2['severity'], number>()
  for (const f of findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1)
  return [...counts].sort((a, b) => SEVERITY_RANK[b[0]] - SEVERITY_RANK[a[0]])
}

/* 구성 유형마다 그림. 위험에 가까운 유형부터 늘어놓는다(자격증명, 연동, 자동화가 먼저) */
const IFACE_ORDER = ['Credential', 'Integration', 'Automation', 'Endpoint', 'Policy', 'Principal', 'Resource', 'Assignment', 'Tenant']
const IFACE_ICON: Record<string, LucideIcon> = {
  Credential: KeyRound, Integration: Plug, Automation: Workflow, Endpoint: Webhook, Policy: Shield,
  Principal: User, Resource: Box, Assignment: Link2, Tenant: Building2,
}

function IfaceIcon({ iface }: { iface: string }) {
  const Icon = IFACE_ICON[iface] ?? Box
  return <Icon className="szi-iface-icon" size={14} strokeWidth={2} aria-hidden="true" />
}

/** 이름 속 가운뎃점은 「›」로, 「(목록에 없음)」은 앞에 「미수집」을 붙여 적는다 */
const plainName = (name: string) => name.replace(/\s*·\s*/g, ' › ').replace(/^(.*) \(목록에 없음\)$/, '미수집 $1')

/** 구역 하나. 머리는 Overview 카드와 같은 옅은 띠로 내용과 가른다 */
export function Block({ title, aside, children, className = '', id }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`szi-block ${className}`}>
      <header className="szi-block-head"><h4>{title}</h4>{aside}</header>
      <div className="szi-block-body">{children}</div>
    </section>
  )
}

/**
 * 보안 요약 구역. 칸을 고르면 먼저 궁금한 것(위협, Effective Access, 다른 SaaS 연결)을 수로 맨 위에 둔다.
 * 0은 「없음」이 아니라 이 데이터에서 찾은 수다.
 */
function SecurityBlock({ summary, findings, single, outside, collection, onOpenEa, onShowFindings }: {
  summary: SecuritySummary
  /** SaaS 요약에서만. Adapters 카드와 같은 마지막 수집, 수집 상태 */
  collection?: ProviderCollection
  findings: FindingV2[]
  single: boolean
  /** 묶음 칸의 밖으로 나가는 연결 수. 개별 객체는 없음 */
  outside?: { label: string; count: number }
  onOpenEa?: (rowIds: string[]) => void
  onShowFindings: () => void
}) {
  return (
    <Block title="보안 요약" className="szi-security">
      {collection && (
        <p className="szi-collect">
          <span>마지막 수집</span>
          <b title={utcTitle(collection.latest)}>{collection.latest ? formatKst(collection.latest) : '기록 없음'}</b>
          {collection.latest && <span>{daysAgoText(collection.daysAgo)}</span>}
          <b className={`collect-badge is-${collection.state}`}>{COLLECTION_STATE_LABEL[collection.state]}</b>
        </p>
      )}
      <dl className={`szi-stat-grid ${outside ? 'is-three' : ''}`}>
        <div className={findings.length ? 'is-alert' : ''}>
          <dt>위협</dt>
          <dd>
            {findings.length ? (
              <button type="button" className="szi-stat-link" onClick={onShowFindings} title={findings.map(f => f.title).join('\n')}>
                <b>{findings.length}</b>건
                {/* 심각도가 한 가지면 점만, 여러 가지면 심각도별 수 */}
                <span className="szi-stat-sev">
                  {severityCounts(findings).map(([severity, count], _i, all) => <SeverityDot key={severity} severity={severity} count={all.length > 1 ? count : undefined} />)}
                </span>
              </button>
            ) : <span className="is-zero"><b>0</b>건</span>}
          </dd>
        </div>
        <div>
          <dt>Effective Access</dt>
          <dd className={summary.ea.length ? '' : 'is-zero'}><b>{summary.ea.length}</b>건</dd>
        </div>
        {outside && (
          <div>
            <dt>{outside.label}</dt>
            <dd className={outside.count ? '' : 'is-zero'}><b>{outside.count}</b>건</dd>
          </div>
        )}
      </dl>
      <SecurityCard summary={summary} single={single} onOpenEa={onOpenEa} />
    </Block>
  )
}

/** 보안 요약의 행 목록(Effective Access). 수는 위 칸에 있어 행만 둔다 */
function SecurityCard({ summary, single, onOpenEa }: {
  summary: SecuritySummary
  single: boolean
  onOpenEa?: (rowIds: string[]) => void
}) {
  const ea = single ? [] : summary.ea
  const eaGroups = groupEa(ea.map(e => ({ ...e, rule: e.ruleLabel })))
  if (!ea.length) return null
  return (
    <div className="szi-sec">
      {eaGroups.length > 0 && (
        <div className="szi-sec-group">
          <div className="szi-sec-label">Effective Access 결과</div>
          {/* 같은 판정, 같은 대상은 한 칸으로 묶고, 경로는 출발 → 도착과 거쳐 가는 곳만 적는다 */}
          {eaGroups.slice(0, 4).map(group => (
            <button key={group[0].rowId} type="button" className="szi-sec-row is-ea" onClick={() => onOpenEa?.(group.map(e => e.rowId))} title="그래프에 Effective Access 선을 켜고 상세 보기">
              <Zap size={13} strokeWidth={2} aria-hidden="true" />
              <span className="szi-ea-row">
                <span className="ea-card-top"><em className={`ea-level ${group[0].level}`}>{group[0].levelLabel}</em><span>{group[0].ruleLabel}</span></span>
                <EaBrief chain={group[0].chain} sources={[...new Set(group.map(e => e.chain[0]?.name ?? ''))]} paths={group.length} />
              </span>
              <ChevronRight size={13} aria-hidden="true" />
            </button>
          ))}
          {eaGroups.length > 4 && <div className="szi-more-note">외 {eaGroups.slice(4).reduce((n, group) => n + group.length, 0)}건</div>}
        </div>
      )}
    </div>
  )
}

function FindingList({ findings, onOpenThreat, single }: { findings: FindingV2[]; onOpenThreat?: (findingId: string) => void; single: boolean }) {
  if (!findings.length) {
    return (
      <div className="szi-empty">
        <div className="szi-empty-icon"><ShieldCheck size={20} strokeWidth={1.75} /></div>
        <div className="szi-empty-title">활성 위협 없음</div>
      </div>
    )
  }
  return (
    <>
      {findings.map(f => <FindingRow key={f.id} f={f} onOpenThreat={onOpenThreat} />)}
    </>
  )
}

/** 처음에는 심각도와 제목만 보이고, 누르면 요약과 상세 보기 단추가 펼쳐진다 */
function FindingRow({ f, onOpenThreat }: { f: FindingV2; onOpenThreat?: (findingId: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`szi-finding ${open ? 'is-open' : ''}`}>
      <button type="button" className="szi-finding-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <SeverityDot severity={f.severity} />
        <span className="szi-finding-title">{f.title}</span>
        <ChevronDown size={14} aria-hidden="true" className="szi-finding-chevron" />
      </button>
      {open && (
        <div className="szi-finding-body">
          <div className="szi-finding-id">{f.id}</div>
          <div className="szi-finding-summary">{f.summary}</div>
          <button type="button" onClick={() => onOpenThreat?.(f.id)} className="szi-finding-open">위협 상세 보기</button>
        </div>
      )}
    </div>
  )
}

function Tabs({ active, onChange, labels }: { active: InspectorTab; onChange: (t: InspectorTab) => void; labels: Record<InspectorTab, React.ReactNode> }) {
  return (
    <div className="sz-inspector-tabs szi-tabs" role="tablist">
      {(Object.keys(labels) as InspectorTab[]).map(tab => (
        <button key={tab} type="button" role="tab" aria-selected={active === tab} data-tab={tab}
          className={`sz-tab-btn ${active === tab ? 'active' : ''}`} onClick={() => onChange(tab)}>
          {labels[tab]}
        </button>
      ))}
    </div>
  )
}

export default function SemanticInspector(props: SemanticInspectorProps) {
  const {
    selectedNode, selectedEdge, selectedEaRows, sourceNode, targetNode, activeGraph, currentLevel, onClose,
    v2Findings = [], eaRows = [], visibleEdges = [], nodesById, onSelectEdge,
    onOpenThreat, onDrillToEvidence, onOpenEa, belowToolbar = false,
  } = props
  const nodeId = selectedNode?.id
  const [activeTab, setActiveTab] = useState<InspectorTab>(() => readInspectorTab(nodeId))
  const shownNode = useRef(nodeId)
  useEffect(() => {
    if (nodeId === shownNode.current) return
    shownNode.current = nodeId
    setActiveTab('overview')
  }, [nodeId])
  useEffect(() => {
    try { window.sessionStorage.setItem(TAB_KEY, JSON.stringify({ node: nodeId, tab: activeTab })) } catch { /* 기억하지 못해도 상세는 그대로 쓴다 */ }
  }, [nodeId, activeTab])

  const node = selectedNode
  const isObject = node?.level === 'object'
  const memberKeys = useMemo(() => node?.memberObjectKeys ?? [], [node])
  const involvedFindings = useMemo(
    () => v2Findings.filter(f => memberKeys.some(k => f.involvedObjectKeys.includes(k))),
    [v2Findings, memberKeys],
  )
  const security = useMemo(
    () => securityFor(activeGraph, memberKeys, { eaRows }),
    [activeGraph, memberKeys, eaRows],
  )

  const stopPanelEvent = (event: React.SyntheticEvent) => event.stopPropagation()
  const closePanel = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onClose()
  }

  // 1. Effective Access 선
  if (selectedEaRows && selectedEaRows.length) {
    return (
      <EaInspector rows={selectedEaRows} activeGraph={activeGraph} findings={v2Findings} onClose={closePanel} onStop={stopPanelEvent}
        onOpenThreat={onOpenThreat} onFocusObject={onDrillToEvidence} belowToolbar={belowToolbar} onAskSelection={props.onAskSelection} />
    )
  }

  // 2. 관계선 — 왜 두 칸이 이어져 있나
  if (selectedEdge) {
    const overlapping = eaRows.filter(row => {
      const s = sourceNode?.memberObjectKeys ?? []
      const t = targetNode?.memberObjectKeys ?? []
      const { source, target } = row.references
      return (s.includes(source) && t.includes(target)) || (s.includes(target) && t.includes(source))
    })
    return (
      <EdgeInspector
        edge={selectedEdge}
        sourceNode={sourceNode}
        targetNode={targetNode}
        activeGraph={activeGraph}
        currentLevel={currentLevel}
        v2Findings={v2Findings}
        onClose={closePanel}
        onStop={stopPanelEvent}
        onOpenThreat={onOpenThreat}
        onFocusObject={onDrillToEvidence}
        overlappingEa={overlapping}
        onOpenEa={onOpenEa}
        belowToolbar={belowToolbar}
        onAskSelection={props.onAskSelection}
      />
    )
  }

  if (!node) return null
  const showFindings = () => setActiveTab('findings')

  return (
    <div className={`sz-inspector-float szi-panel ${belowToolbar ? 'below-toolbar' : ''}`} onClick={stopPanelEvent} onPointerDown={stopPanelEvent} onWheel={stopPanelEvent}>
      <div className="sz-inspector-header">
        <div className="sz-inspector-title">
          <div className="szi-logo"><ProviderLogo provider={toLogo(node.provider)} /></div>
          <div className="szi-title-text">
            <h3 title={node.label}>{node.label}</h3>
            <small>{SEMANTIC_LEVEL_LABELS[currentLevel].name}{node.level === 'scope' && node.scopeKind ? `, ${SCOPE_KIND_LABEL[node.scopeKind] ?? node.scopeKind}` : ''}</small>
          </div>
        </div>
        <div className="szi-head-actions">
          {props.onAskSelection && <AiAskButton subject="항목" onClick={props.onAskSelection} />}
          <button type="button" onClick={closePanel} className="sz-close-btn" aria-label="닫기"><X size={16} strokeWidth={2} /></button>
        </div>
      </div>

      {!!props.eventEvidence?.length && <section className="graph-event-inspector"><h4>AI가 조회한 이벤트 {props.eventEvidence.length}건</h4>
        <GraphEventList key={node.id} events={props.eventEvidence} objectKeys={node.memberObjectKeys} onOpen={props.onOpenEvent} onAsk={props.onAskEvent} />
      </section>}
      {isObject
        ? <ObjectBody key={node.id} {...props} node={node} activeTab={activeTab} setActiveTab={setActiveTab} findings={involvedFindings}
            security={security} onShowFindings={showFindings} />
        : <GroupBody key={node.id} {...props} node={node} activeTab={activeTab} setActiveTab={setActiveTab} findings={involvedFindings}
            security={security} onShowFindings={showFindings} visibleEdges={visibleEdges} nodesById={nodesById} onSelectEdge={onSelectEdge} />}
    </div>
  )
}

interface BodyProps extends SemanticInspectorProps {
  node: SemanticNode
  activeTab: InspectorTab
  setActiveTab: (tab: InspectorTab) => void
  findings: FindingV2[]
  security: SecuritySummary
  onShowFindings: () => void
}

// ---------------------------------------------------------------------------
// L4 개별 객체
// ---------------------------------------------------------------------------

function ObjectBody({ node, activeTab, setActiveTab, activeGraph, findings, security, onShowFindings, v2Findings = [], eaRows = [], onOpenThreat, onDrillToEvidence, onOpenExplorer, onOpenEvents, onExpandNeighbors, hasNeighbors, remainingCandidateCount, onOpenEa, onOpenBlastRadius, onPathEnd, pathEnds, evidenceOnly = false }: BodyProps) {
  const rawObj = node.rawObject ?? activeGraph.objectsByKey.get(node.id)
  const key = rawObj?.fixture_key ?? node.id
  const relatedEvents = useRelatedEventCount(onOpenEvents ? [key] : [])
  const description = useMemo(() => describeObject(activeGraph, key), [activeGraph, key])
  const connections = useMemo(() => connectionsOf(activeGraph, key, v2Findings), [activeGraph, key, v2Findings])
  const connectionCount = connections.reduce((n, g) => n + g.items.length, 0)
  // service 원에 든 객체의 tenantKey 에는 service 표시가 붙어 있다. 조직 객체는 표시를 뗀 키로 찾는다
  const tenantObjKey = node.tenantKey ? tenantObjectKey(node.tenantKey) : undefined
  const tenantObj = tenantObjKey ? activeGraph.objectsByKey.get(tenantObjKey) : undefined
  const observation = rawObj?.canonical.source.observations?.[0]
  const api = observation?.api ?? rawObj?.canonical.source.api
  const collectedAt = observation?.collected_at ?? rawObj?.canonical.source.collected_at
  /* 설명이 「AppUser (배정)」처럼 SaaS 용어와 유형을 되풀이할 뿐인지 */
  const term = rawObj?.catalog_ref?.provider_term ?? node.objectType
  const repeatsType = !!description && node.interfaces.some(i => description.summary === `${term} (${INTERFACE_COPY[i]?.label ?? i})`)

  return (
    <>
      <Tabs active={activeTab} onChange={setActiveTab} labels={{ overview: '개요', data: '데이터', relations: <>관계 <b>{connectionCount}</b></>, findings: <>위협 <b>{findings.length}</b></> }} />

      {activeTab === 'overview' && (
        <div className="sz-tab-content sz-tab-overview szi-overview">
          {/* SaaS, 종류, 인터페이스를 한 줄에. 전에는 같은 말을 알약, 칩, 설명 상자로 세 번 적었다 */}
          <div className="szi-identity-line">
            <span className="szi-identity-saas"><ProviderLogo provider={toLogo(node.provider)} />{providerLabel(node.provider)}</span>
            <span className="szi-identity-type">{shownKind(rawObj) || rawObj?.catalog_ref?.provider_term || node.objectType}</span>
            {node.interfaces.map(i => (
              <span key={i} className="szi-interface-chip" title={INTERFACE_COPY[i]?.meaning}><IfaceIcon iface={i} />{INTERFACE_COPY[i]?.label ?? i}</span>
            ))}
          </div>
          {description && (description.facts.length > 0 || !repeatsType) && (
            <Block title="설명">
              {/* 설명이 「AppUser (배정)」처럼 종류를 되풀이할 뿐이면 적지 않는다 */}
              {!repeatsType && <p className="szi-block-text">{description.summary}</p>}
              {!evidenceOnly && description.facts.length > 0 && (
                <dl className="szi-facts">
                  {description.facts.map(f => (
                    <React.Fragment key={`${f.label}-${f.value}`}>
                      <dt>{f.label}</dt>
                      <dd>{f.value}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              )}
            </Block>
          )}
          {!evidenceOnly && rawObj?.canonical.interfaces.includes('Credential') && 'linksById' in activeGraph && activeGraph.linksById && (
            <Block title="탈취 시 피해범위" className="szi-blast">
              <BlastSummary credentialKey={key} graph={activeGraph as GraphStoreV2} eaRows={eaRows} onOpen={onOpenBlastRadius} />
            </Block>
          )}
          {!evidenceOnly && <SecurityBlock summary={security} findings={findings} single onOpenEa={onOpenEa} onShowFindings={onShowFindings} />}
          {!evidenceOnly && <NodeStandardFindings nodeKey={key} Block={Block} />}
          {!evidenceOnly && <EaObjectSection notes={security.ea} eaRows={eaRows} activeGraph={activeGraph} v2Findings={v2Findings}
            onOpenThreat={onOpenThreat} onFocusObject={onDrillToEvidence} onOpenEa={onOpenEa} />}
          {/* 조사 도구: 모양이 같은 단추 한 벌. 경로 시작과 도착은 붙인 두 칸 */}
          <div className="szi-actions">
            {onExpandNeighbors && (
              <button type="button" className="szi-action" disabled={hasNeighbors ? !hasNeighbors(key) : false} onClick={() => onExpandNeighbors(key)}>
                <Share2 size={14} strokeWidth={2} aria-hidden="true" />연결된 항목 펼치기
              </button>
            )}
            {onOpenExplorer && (
              <button type="button" className="szi-action" onClick={() => onOpenExplorer(key)}>
                <Compass size={14} strokeWidth={2} aria-hidden="true" />Explorer에서 탐색
              </button>
            )}
            {onOpenEvents && (
              <button type="button" className="szi-action" disabled={relatedEvents === 0} onClick={() => onOpenEvents(key)}>
                <History size={14} strokeWidth={2} aria-hidden="true" />관련 이벤트{relatedEvents !== null && ` ${relatedEvents.toLocaleString()}건`}
              </button>
            )}
            {onPathEnd && (
              <div className="szi-path-ends" role="group" aria-label="경로 찾기">
                <button type="button" className={`szi-path-btn ${pathEnds?.start === key ? 'on' : ''}`} aria-pressed={pathEnds?.start === key} onClick={() => onPathEnd(key, 'start')}>
                  경로 시작
                </button>
                <button type="button" className={`szi-path-btn ${pathEnds?.end === key ? 'on' : ''}`} aria-pressed={pathEnds?.end === key} onClick={() => onPathEnd(key, 'end')}>
                  경로 도착
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'data' && (
        <div className="sz-tab-content sz-tab-data szi-section-stack">
          <dl className="szi-kv">
            <dt>SaaS</dt><dd>{providerLabel(node.provider)}</dd>
            <dt>SaaS 용어</dt><dd>{rawObj?.catalog_ref?.provider_term ?? node.objectType ?? '—'}</dd>
            <dt>객체 키</dt><dd className="szi-mono">{key}</dd>
            <dt>카탈로그 ID</dt><dd className="szi-mono">{rawObj?.catalog_ref?.id ?? '—'}</dd>
            <dt>테넌트</dt><dd>{tenantObj ? `${tenantObj.fixture_meta?.display_name ?? tenantObj.canonical.properties?.name ?? tenantObjKey}` : tenantObjKey ?? '—'} {tenantObjKey && <small className="szi-mono">{tenantObjKey}</small>}</dd>
            {collectedAt && (<><dt>수집 시각</dt><dd title={utcTitle(collectedAt)}>{formatKst(collectedAt)}</dd></>)}
            {api && (<><dt>수집 API</dt><dd className="szi-mono szi-break">{api}</dd></>)}
          </dl>
          <div>
            <div className="szi-section-title">SaaS 속성</div>
            <pre className="szi-json szi-json-tall">{JSON.stringify(rawObj?.canonical.properties || {}, null, 2)}</pre>
          </div>
          <div>
            <div className="szi-section-title">AEGI 판정 값</div>
            <pre className="szi-json">{JSON.stringify(rawObj?.canonical.judged || {}, null, 2)}</pre>
          </div>
          <div>
            <div className="szi-section-title">수집 정보</div>
            <pre className="szi-json">{JSON.stringify(rawObj?.fixture_meta || {}, null, 2)}</pre>
          </div>
        </div>
      )}

      {activeTab === 'relations' && (
        <div className="sz-tab-content sz-tab-relations szi-section-stack">
          {connections.length === 0 ? (
            <div className="szi-empty-line">연결 없음</div>
          ) : (
            <>
              {connections.map(group => (
                <section key={group.id} className={`szi-conn-group dir-${group.direction} ${group.evidence ? 'is-evidence' : ''}`}>
                  <header>
                    {group.direction === 'link' ? <Link2 size={12} strokeWidth={2.2} aria-hidden="true" /> : <ArrowRight size={12} strokeWidth={2.2} className={group.direction === 'in' ? 'szi-flip' : ''} aria-hidden="true" />}
                    <strong>{group.label}</strong>
                    <span className="sz-edge-count">{group.items.length}</span>
                    <small title="저장된 관계 종류">{group.direction === 'link' ? '동일인 연결' : relationLabel(group.relationType)}</small>
                  </header>
                  {itemsByType(group.items, 12).map((type, _i, types) => (
                    <div key={type.label} className="szi-conn-type">
                      {type.label && (
                        <div className="szi-conn-type-label">
                          {type.label}
                          {types.length > 1 && <span className="sz-edge-count">{type.total}</span>}
                        </div>
                      )}
                      <ul>
                        {type.items.map(item => (
                          <li key={`${item.obj.key}-${item.note ?? ''}`}>
                            <button type="button" className={`szi-conn-item ${item.findingIds.length ? 'is-evidence' : ''}`} onClick={() => onDrillToEvidence?.(item.obj.key)} title={item.obj.key}>
                              <span className="szi-conn-logo"><ProviderLogo provider={toLogo(item.obj.provider)} /></span>
                              <span className="szi-conn-name">{item.obj.label}</span>
                              {item.note && <small>{item.note}</small>}
                              {item.crossSaas && <em className="szi-ea-tag cross">다른 SaaS</em>}
                              {item.findingIds.length > 0 && <em className="szi-ea-tag is-finding">탐지 경로</em>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {group.items.length > 12 && <div className="szi-more-note">외 {group.items.length - 12}개</div>}
                </section>
              ))}
            </>
          )}
        </div>
      )}

      {activeTab === 'findings' && (
        <div className="sz-tab-content sz-tab-findings szi-findings">
          <FindingList findings={findings} onOpenThreat={onOpenThreat} single />
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// L1 ~ L3 묶음 칸
// ---------------------------------------------------------------------------

const COMPOSE_PREVIEW = 8
const ifaceRank = (iface: string) => { const i = IFACE_ORDER.indexOf(iface); return i < 0 ? IFACE_ORDER.length : i }

function GroupBody({ node, activeTab, setActiveTab, activeGraph, findings, security, collection, onShowFindings, visibleEdges = [], nodesById, onSelectEdge, onOpenThreat, onDrillToEvidence, onOpenEa, onDrillDownLevel }: BodyProps) {
  const keys = node.memberObjectKeys
  const reach = useMemo(() => outsideLinks(activeGraph, keys), [activeGraph, keys])
  const edges = useMemo(() => visibleEdges
    .filter(e => e.sourceSemanticNodeId === node.id || e.targetSemanticNodeId === node.id)
    .sort((a, b) => b.findingCount - a.findingCount || (b.relationCount + b.resolutionCount) - (a.relationCount + a.resolutionCount)),
  [visibleEdges, node.id])
  const profile = providerProfile(node.provider)
  const anchor = node.level === 'scope' && node.scopeAnchorObjectKey ? describeObject(activeGraph, node.scopeAnchorObjectKey) : null
  const tenantObj = node.level === 'tenant' ? node.rawObject : undefined
  const saas = providerLabel(node.provider)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  /* 개요 막대와 구성 탭은 같은 유형 체계, 같은 순서(위험에 가까운 것부터)를 쓴다 */
  /* 항목마다 걸린 위협의 가장 높은 심각도 */
  const riskByKey = useMemo(() => {
    const out = new Map<string, FindingV2['severity']>()
    for (const f of findings) for (const k of f.involvedObjectKeys) {
      const prev = out.get(k)
      if (!prev || SEVERITY_RANK[f.severity] > SEVERITY_RANK[prev]) out.set(k, f.severity)
    }
    return out
  }, [findings])
  const composeGroups = useMemo(() => {
    const byIface = new Map<string, string[]>()
    for (const k of keys) {
      const iface = activeGraph.objectsByKey.get(k)?.canonical.interfaces[0] ?? 'Resource'
      byIface.set(iface, [...(byIface.get(iface) ?? []), k])
    }
    return [...byIface.entries()]
      .sort((a, b) => ifaceRank(a[0]) - ifaceRank(b[0]))
      .map(([iface, list]) => {
        const sorted = [...list].sort((a, b) => (riskByKey.has(b) ? SEVERITY_RANK[riskByKey.get(b)!] + 1 : 0) - (riskByKey.has(a) ? SEVERITY_RANK[riskByKey.get(a)!] + 1 : 0))
        return { iface, keys: sorted, risky: list.filter(k => riskByKey.has(k)).length }
      })
  }, [keys, activeGraph, riskByKey])
  const orderedInterfaces = composeGroups.map(g => ({ iface: g.iface, label: INTERFACE_COPY[g.iface]?.label ?? g.iface, meaning: INTERFACE_COPY[g.iface]?.meaning ?? '', count: g.keys.length }))
  /* 개요 막대를 누르면 구성 탭에서 그 유형을 펼쳐 보인다 */
  const [focusIface, setFocusIface] = useState<string | null>(null)
  const openComposeGroup = (iface: string) => {
    setExpandedGroups(prev => new Set(prev).add(iface))
    setFocusIface(iface)
    setActiveTab('data')
  }
  useEffect(() => {
    if (activeTab !== 'data' || !focusIface) return
    document.getElementById(`szi-comp-${focusIface}`)?.scrollIntoView({ block: 'start' })
    setFocusIface(null)
  }, [activeTab, focusIface])

  let lead: string
  if (node.level === 'ecosystem') lead = profile?.role ?? 'SaaS'
  // 항목 수는 바로 아래 「오브젝트」 칸에 있으므로 제목 줄은 종류만 명사형으로 적는다
  else if (node.level === 'tenant') lead = `${saas} 조직`
  else lead = `${saas} ${node.scopeKind ? SCOPE_KIND_LABEL[node.scopeKind] ?? node.scopeKind : ''} 묶음`.replace(/\s+/g, ' ')

  return (
    <>
      <Tabs active={activeTab} onChange={setActiveTab} labels={{ overview: '개요', data: <>구성 <b>{keys.length}</b></>, relations: <>연결 <b>{edges.length}</b></>, findings: <>위협 <b>{findings.length}</b></> }} />

      {activeTab === 'overview' && (
        <div className="sz-tab-content sz-tab-overview szi-overview">
          {/* 무엇인지(역할)를 먼저 읽고, 그다음 문제가 있는지(보안 요약)를 본다 */}
          <Block title={node.level === 'ecosystem' ? '역할' : '설명'}>
            <p className="szi-block-lead">{lead}</p>
            {node.level === 'ecosystem' && profile && <ul className="szi-block-list">{profile.points.map(point => <li key={point}>{point}</li>)}</ul>}
            {node.level === 'tenant' && tenantObj && <p className="szi-block-text">{describeObject(activeGraph, tenantObj.fixture_key)?.summary}</p>}
            {anchor && <p className="szi-block-text">{anchor.summary}</p>}
          </Block>
          <SecurityBlock summary={security} findings={findings} single={false}
            outside={{ label: node.level === 'ecosystem' ? '다른 SaaS 연결' : '외부 연결', count: reach.outsideRelations + reach.identityLinks }}
            collection={node.level === 'ecosystem' ? collection?.get(node.provider) : undefined}
            onOpenEa={onOpenEa} onShowFindings={onShowFindings} />
          {/* 그래프를 한 단계 더 펼치는 것이 다음 동작이라 보안 요약 바로 아래에 둔다 */}
          {onDrillDownLevel && (
            <div className="szi-actions">
              <button type="button" className="szi-action szi-action-wide" onClick={() => onDrillDownLevel?.(node)}>
                <FolderDown size={14} strokeWidth={2} aria-hidden="true" />
                {node.level === 'ecosystem' ? `${saas} 테넌트 펼치기` : node.level === 'tenant' ? `${node.label} 그룹, 채널 펼치기` : `${node.label} 안의 개별 객체 보기 (${keys.length}개)`}
              </button>
            </div>
          )}
          <Block title="유형별 구성">
            {orderedInterfaces.map(row => (
              <button type="button" key={row.iface} className="szi-bar-row" title={row.meaning} onClick={() => openComposeGroup(row.iface)}>
                <IfaceIcon iface={row.iface} />
                <span>{row.label}</span>
                <i><b style={{ width: `${(row.count / Math.max(1, keys.length)) * 100}%` }} /></i>
                <em>{row.count}</em>
              </button>
            ))}
          </Block>
        </div>
      )}

      {activeTab === 'data' && (
        <div className="sz-tab-content sz-tab-data szi-compose-list">
          {/* 내부 타입 이름(AppUser 등) 대신 개요와 같은 유형으로 묶고, 위험에 가까운 유형부터 둔다.
              위협에 걸린 항목은 심각도 점을 달고 유형 안에서 위로 올린다 */}
          {composeGroups.map(group => {
            const open = expandedGroups.has(group.iface)
            const shown = open ? group.keys : group.keys.slice(0, COMPOSE_PREVIEW)
            const types = new Set(group.keys.map(k => typeNoun(activeGraph.objectsByKey.get(k)) || ''))
            return (
              <Block key={group.iface} id={`szi-comp-${group.iface}`} title={<><IfaceIcon iface={group.iface} />{INTERFACE_COPY[group.iface]?.label ?? group.iface}</>}
                aside={<span className="szi-block-count">{group.keys.length}개{group.risky > 0 && <>, 위협 <b>{group.risky}</b></>}</span>}>
                <ul className="szi-comp-list">
                  {shown.map(k => {
                    const obj = activeGraph.objectsByKey.get(k)
                    const severity = riskByKey.get(k)
                    const name = plainName(String(obj?.fixture_meta?.display_name ?? obj?.canonical.properties?.name ?? k))
                    return (
                      <li key={k}>
                        <button type="button" className="szi-comp-item" onClick={() => onDrillToEvidence?.(k)} title={`${name}
${k}`}>
                          {/* 심각도는 늘 맨 앞. 위협이 없는 줄도 자리를 비워 이름 줄을 맞춘다 */}
                          <span className="szi-comp-sev">{severity && <SeverityDot severity={severity} />}</span>
                          <span className="szi-comp-name">{name}</span>
                          {types.size > 1 && <small>{shownKind(obj) || obj?.catalog_ref?.provider_term}</small>}
                          <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {group.keys.length > COMPOSE_PREVIEW && (
                  <button type="button" className="szi-more-btn" onClick={() => setExpandedGroups(prev => {
                    const next = new Set(prev)
                    if (next.has(group.iface)) next.delete(group.iface)
                    else next.add(group.iface)
                    return next
                  })}>
                    {open ? <>접기 <ChevronDown className="szi-more-icon is-open" size={14} strokeWidth={2} aria-hidden="true" /></> : <>{group.keys.length - COMPOSE_PREVIEW}개 더 보기 <ChevronDown className="szi-more-icon" size={14} strokeWidth={2} aria-hidden="true" /></>}
                  </button>
                )}
              </Block>
            )
          })}
        </div>
      )}

      {activeTab === 'relations' && (
        <div className="sz-tab-content sz-tab-relations szi-section-stack">
          {edges.length === 0 ? (
            <div className="szi-empty-line">현재 화면에 연결 없음</div>
          ) : (
            <>
              <ul className="szi-edge-list">
                {edges.map(edge => {
                  const otherId = edge.sourceSemanticNodeId === node.id ? edge.targetSemanticNodeId : edge.sourceSemanticNodeId
                  const other = nodesById?.get(otherId)
                  const counts = new Map<string, number>()
                  for (const rk of edge.relationKeys) {
                    const type = activeGraph.relationsByKey.get(rk)?.relationType
                    if (type) counts.set(type, (counts.get(type) ?? 0) + 1)
                  }
                  const breakdown = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${relationLabel(t)} ${n}`)
                  if(edge.servicePaths?.length)breakdown.push(`Worker 경유 ${edge.servicePaths.length}`)
                  if (edge.resolutionCount) breakdown.push(`동일인 연결 ${edge.resolutionCount}`)
                  return (
                    <li key={edge.id}>
                      <button type="button" className={`szi-conn-item ${edge.findingCount ? 'is-evidence' : ''}`} onClick={() => onSelectEdge?.(edge.id)}>
                        {other && <span className="szi-conn-logo"><ProviderLogo provider={toLogo(other.provider)} /></span>}
                        <span className="szi-conn-name">{other?.label ?? otherId}</span>
                        <small>{breakdown.join(', ')}</small>
                        {edge.findingCount > 0 && <em className="szi-ea-tag is-finding">위협 {edge.findingCount}</em>}
                        <ChevronRight size={13} aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {activeTab === 'findings' && (
        <div className="sz-tab-content sz-tab-findings szi-findings">
          <FindingList findings={findings} onOpenThreat={onOpenThreat} single={false} />
        </div>
      )}
    </>
  )
}
