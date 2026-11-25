import { Fragment, useState, useMemo, useEffect, type ReactNode } from 'react'
import type { FindingV2, ThreatCutView } from './model/findingV2'
import { cutOutcome, cutVia } from './findings/threatV2'
import { subjectParticle } from './findings/headcount'
import type { GraphStoreV2 } from './model/graph'
import type { EvidenceStore, EvidenceObservation, FindingEvidenceLink } from './model/evidence'
import ProviderLogo from './ProviderLogo'
import { Activity, ArrowRight, Check, Copy, ShieldOff, Waypoints } from 'lucide-react'
import { DetailButton, DetailCrumb, DetailGroup, DetailPager } from './ui/DetailBar'
import { useRelatedEventCount } from './timeline/relatedEvents'
import { scenarioTag, findingTagKey, tagClass } from './findings/scenarioTags'
import { severityClass, severityLabel } from './findings/severity'
import { providerLogoId, providerName } from './findings/providers'
import { evidenceFieldLabel, evidenceFieldValue, groupEvidence, type EvidenceGroup } from './findings/evidenceGroups'
import ThreatPathGraph from './findings/ThreatPathGraph'
import { findingEvidenceLinks, findingPathLayout } from './findings/findingPath'
import { sortByPriority } from './findings/remediationMeta'
import ThreatAccessGapPanel from './findings/ThreatAccessGapPanel'
import type { FindingView } from './exceptions/applyExceptions'
import { RevokeForm } from './exceptions/ExceptionsPage'
import { expiryText } from './exceptions/format'
import { REASON_LABELS, SCOPE_LABELS } from './model/exception'
import { formatKst, utcTitle } from './utils/time'
import { reportSentence } from './findings/reportSentence'
import EffectiveAccessPanel, { EffectiveAccessDetail } from './findings/EffectiveAccessPanel'
import type { EffectiveAccessFile } from './detection/v2/effectiveAccess/types'
import { observationKindLabel } from './findings/observationKind'
import type { ResolvedRelation } from './model/relation'
import { objectLabel } from './blast-radius/blastLabels'
import { relationLabel } from './semantic-graph/edgeExplain'
import { findingSpread } from './findings/threatSpread'
import { similarThreats } from './findings/similarThreats'
import { hasLocalServer } from './demoMode'
import { isCollectorStatusConfigured } from './credentials/store'
import { getThreatRecheckProviders, postCollectThreat, fetchCollectStatus } from './findings/threatRecheck'

export interface FindingDetailProps {
  finding: FindingV2
  graph: GraphStoreV2
  evidenceStore: EvidenceStore
  /** 계산된 접근 결론 (관계와 다른 저장소). 데이터셋에 파일이 없으면 undefined */
  effectiveAccess?: EffectiveAccessFile
  /** 뒤로 가기가 돌아갈 화면. 목록에서 열렸는지 그래프에서 열렸는지에 따라 다르다. */
  onBack: () => void
  backLabel: string
  onSelectObjectInGraph?: (objectKey: string) => void
  /** 「관련 이벤트 n건」: 이 위협에 든 객체의 최근 7일 조회를 추가한 Event Board 를 연다 */
  onOpenEvents?: (objectKeys: string[]) => void
  /** 「이벤트로 조사」: 이 위협을 조사 대상으로 Event Board 를 연다 */
  onOpenEventBoard?: (objectKeys: string[]) => void
  /** 예외 적용 결과. 없으면 예외 기능 없이 그린다 */
  view?: FindingView
  now?: Date
  /** 예외 처리 창 열기 */
  onException?: () => void
  onRevokeExceptions?: (ids: string[], actor: string, note?: string) => void
  onOpenException?: (exceptionId: string) => void
  /** 제목 칸 바로 아래에 둘 처리 칸 (처리 상태, 담당자, 메모) */
  handlingSlot?: ReactNode
  /** 위협 목록 순서의 이전, 다음. 기록을 쌓지 않고 옮긴다 */
  pager?: { index: number; total: number; onPrev?: () => void; onNext?: () => void }
  /** 이 데이터의 수집 시각 (ISO) */
  collectedAt?: string
  onOpenThreatSpread?: (originKey: string, spreadKeys: string[]) => void
  allFindings?: readonly FindingV2[]
  onSelectFinding?: (findingId: string) => void
}

/** 판정 근거 표의 행 순서 */
const CHECK_GROUPS: { key: NonNullable<FindingV2['checks']>[number]['group']; title: string }[] = [
  { key: 'route', title: '권한을 얻는 경로' },
  { key: 'level', title: '얻는 권한 수준' },
  { key: 'unknown', title: '미수집' },
  { key: 'inferred', title: '추정' },
]

export default function FindingDetail({
  finding,
  graph,
  evidenceStore,
  effectiveAccess,
  onBack,
  backLabel,
  onSelectObjectInGraph,
  onOpenEvents,
  onOpenEventBoard,
  view,
  now = new Date(),
  onException,
  onRevokeExceptions,
  onOpenException,
  handlingSlot,
  pager,
  collectedAt,
  onOpenThreatSpread,
  allFindings,
  onSelectFinding,
}: FindingDetailProps) {
  const [revoking, setRevoking] = useState(false)
  /** 차단 지점 목록에서 고른 번호. 「차단 지점 보기」는 우선 조치인 차단 1을 고르고 목록 상자를 잠깐 빨갛게 두른다 */
  const [hotCut, setHotCut] = useState<number | null>(null)
  const [cutFlash, setCutFlash] = useState(false)
  useEffect(() => { setHotCut(null); setCutFlash(false) }, [finding.id])
  useEffect(() => {
    if (!cutFlash) return
    const timer = window.setTimeout(() => setCutFlash(false), 2400)
    return () => window.clearTimeout(timer)
  }, [cutFlash])
  const relatedEvents = useRelatedEventCount(onOpenEvents ? finding.involvedObjectKeys : [])
  const spread = useMemo(
    () => findingSpread(finding, graph, evidenceStore),
    [finding, graph, evidenceStore],
  )
  const similar = useMemo(
    () => (allFindings ? similarThreats(finding, allFindings, graph, evidenceStore) : []),
    [finding, allFindings, graph, evidenceStore],
  )
  const exceptionState = view?.state ?? 'open'
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  /**
   * 탐지 경로를 어느 면으로 볼지.
   *
   * 'observed'(관측 경로)는 증적과 수집 기록으로 확인된 길이고,
   * 'possible'(잠재 경로)은 그 위에 구조상 가능한 길을 더한 것이다. 먼저
   * 보는 건 "무슨 일이 있었나"이므로 관측 경로를 기본으로 둔다.
   */
  const [pathView, setPathView] = useState<'observed' | 'possible'>('observed')
  /** 열어 둔 Effective Access 상세 (주소 `&ea=<id>` 로도 연다) */
  const [eaDetailId, setEaDetailIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const match = window.location.hash.match(/[?&]ea=([^&]+)/i)
    return match ? decodeURIComponent(match[1]) : null
  })
  const setEaDetailId = (id: string | null) => {
    setEaDetailIdState(id)
    if (typeof window !== 'undefined') {
      // hashchange 를 일으키지 않게 replaceState 로 주소만 맞춘다 (뒤로 가기 · 공유용)
      const base = window.location.hash.replace(/[?&]ea=[^&]*/i, '')
      const hash = id ? `${base}${base.includes('?') ? '&' : '?'}ea=${encodeURIComponent(id)}` : base
      window.history.replaceState(window.history.state, '', hash || '#threat')
      window.scrollTo?.({ top: 0 })
    }
  }

  useEffect(() => {
    setSelectedElementId(null)
    // 증적 연결이 없는 Finding(설정만으로 성립하는 위협)은 관측 경로가 비어 잠재 경로를 먼저 보인다.
    // 위협 판정 V2 위협은 증적이 있어도 엔진 경로(사람과 차단 지점)를 그린 잠재 경로를 먼저 보인다
    setPathView(finding.ruleId !== 'threat-v2' && finding.evidenceLinkIds.length ? 'observed' : 'possible')
  }, [finding.id, finding.ruleId, finding.evidenceLinkIds.length])

  // Gather involved observations
  const observations: EvidenceObservation[] = useMemo(() => {
    return finding.evidenceObservationIds
      .map(id => evidenceStore.observationsById.get(id))
      .filter((obs): obs is EvidenceObservation => Boolean(obs))
  }, [finding, evidenceStore])

  // Gather involved evidence links
  const evidenceLinks: FindingEvidenceLink[] = useMemo(() => findingEvidenceLinks(finding, evidenceStore), [finding, evidenceStore])

  /**
   * 판정에 쓴 관계의 증적. 피해범위처럼 설정만으로 성립하는 판정은 활동 증적(observation)이
   * 하나도 없어, 증적 칸이 비고 「실측 0건」만 남았다. 그 판정의 근거는 관계(권한, 소유, 멤버십)이고,
   * 관계마다 어느 API에서 언제 모았는지가 붙어 있다. 그것을 증적으로 같이 보인다.
   */
  const relationRecords: ResolvedRelation[] = useMemo(() => {
    const seen = new Set<string>()
    return (finding.involvedRelationKeys ?? [])
      .filter(key => !seen.has(key) && (seen.add(key), true))
      .map(key => graph.relationsByKey.get(key))
      .filter((relation): relation is ResolvedRelation => !!relation)
  }, [finding.involvedRelationKeys, graph])

  // 조치는 급한 것부터 위로 올린다. 목록 자체는 하나도 빠지지 않는다.
  const orderedRemediation = useMemo(() => sortByPriority(finding.remediation), [finding.remediation])

  const checks = finding.checks ?? []
  const measuredCount = observations.filter(obs => obs.provenance.record === 'measured').length
  const checkGroups = CHECK_GROUPS.map(g => ({ title: g.title, list: checks.filter(c => c.group === g.key) })).filter(g => g.list.length)


  /**
   * 탐지 경로 배치. 두 보기 모두 SaaS 상자 × 시작, 경유, 대상 칸의 같은 판이다(threatPathModel).
   */
  const layout = useMemo(
    () => findingPathLayout(pathView, finding, graph, evidenceStore, evidenceLinks),
    [pathView, evidenceLinks, graph, evidenceStore, finding]
  )

  /**
   * 위협 판정 V2 차단 지점. 번호는 권장 조치 순서와 같다. 그림에 그 간선이 있으면 선 이름표에 번호를 단다.
   * 호출 제한(from *)은 사람마다 선이 있어 「호출」 이름이 붙은 선 하나에만 단다
   */
  const cuts = useMemo(() => finding.threatCuts ?? [], [finding])
  const [cutMarks, nodeCutMarks] = useMemo(() => {
    if (!cuts.length) return [undefined, undefined]
    const marks = new Map<string, number[]>()
    const nodeMarks = new Map<string, number[]>()
    // 함께 끊는 조합은 간선마다 같은 번호를 단다
    cuts.forEach((c, i) => [c.at, ...(c.with ?? [])].forEach(at => {
      // 실행 신원을 호출자 권한으로 바꾸는 조치처럼 간선이 자기 자신이면 선이 없어 그 노드에 단다
      if (at.from === at.to) {
        const node = layout.nodes.find(n => n.id === at.from) ?? layout.nodes.find(n => n.refId === at.from)
        if (node) nodeMarks.set(node.id, [...(nodeMarks.get(node.id) ?? []), i + 1])
        return
      }
      const edge = layout.edges.find(e => e.id === `${at.from}|${at.to}`)
      if (edge) marks.set(edge.id, [...(marks.get(edge.id) ?? []), i + 1])
    }))
    return [marks, nodeMarks]
  }, [cuts, layout])
  /** 새 위협의 권장 조치가 차단 지점뿐이면 오른쪽 권장 조치 칸을 숨긴다. 같은 조치가 그래프 옆 목록에 있다 */
  const actionsInCuts = finding.ruleId === 'threat-v2' && cuts.length > 0 && finding.remediation.every(step => step.id.startsWith('cut-'))

  const selectedNodeDetail = useMemo(() => {
    if (!selectedElementId) return null
    if (graph.objectsByKey.has(selectedElementId)) {
      const obj = graph.objectsByKey.get(selectedElementId)!
      return {
        type: 'object',
        title: (obj.fixture_meta?.display_name as string) || (obj.canonical.properties.name as string) || obj.fixture_key,
        subtitle: `${providerName(obj.canonical.provider)}, ${obj.canonical.object_type}`,
        properties: obj.canonical.properties,
        id: obj.fixture_key,
      }
    }
    if (evidenceStore.observationsById.has(selectedElementId)) {
      const obs = evidenceStore.observationsById.get(selectedElementId)!
      return {
        type: 'observation',
        title: obs.title || obs.id,
        subtitle: `증적, ${observationKindLabel(obs.kind)}`,
        properties: obs.attributes,
        id: obs.id,
      }
    }
    // 그래프의 선을 눌렀을 때도 같은 자리에서 내용을 보여준다.
    if (graph.relationsByKey.has(selectedElementId)) {
      const relation = graph.relationsByKey.get(selectedElementId)!
      return {
        type: 'relation',
        title: relation.relationType,
        subtitle: `관계, ${relation.sourceKey} → ${relation.targetKey}`,
        properties: relation.properties,
        id: relation.relationKey,
      }
    }
    if (evidenceStore.evidenceLinksById.has(selectedElementId)) {
      const link = evidenceStore.evidenceLinksById.get(selectedElementId)!
      return {
        type: 'evidence',
        title: link.label || link.evidenceType,
        subtitle: `증적, ${link.from.id} → ${link.to.id}`,
        properties: link.attributes || { evidenceType: link.evidenceType },
        id: link.id,
      }
    }
    return null
  }, [selectedElementId, graph, evidenceStore])

  type RecheckState =
    | { state: 'idle' }
    | { state: 'running'; step?: string; elapsed: number }
    | { state: 'done' }
    | { state: 'failed'; error: string }
    | { state: 'conflict' }

  const [recheck, setRecheck] = useState<RecheckState>({ state: 'idle' })
  const [activeJob, setActiveJob] = useState<{ jobId: string; startTime: number } | null>(null)

  useEffect(() => {
    setRecheck({ state: 'idle' })
    setActiveJob(null)
  }, [finding.id])

  const showRecheck = hasLocalServer() && isCollectorStatusConfigured()
  const recheckProviders = useMemo(() => {
    if (!showRecheck) return []
    return getThreatRecheckProviders(finding, graph, evidenceStore)
  }, [showRecheck, finding, graph, evidenceStore])

  useEffect(() => {
    if (!activeJob) return
    const interval = setInterval(async () => {
      const elapsed = Math.floor((Date.now() - activeJob.startTime) / 1000)
      const status = await fetchCollectStatus()
      if (!status) {
        setRecheck(prev => (prev.state === 'running' ? { ...prev, elapsed } : prev))
        return
      }
      if (status.jobId && status.jobId !== activeJob.jobId) {
        setRecheck(prev => (prev.state === 'running' ? { ...prev, elapsed } : prev))
        return
      }
      if (status.state === 'done') {
        setActiveJob(null)
        setRecheck({ state: 'done' })
      } else if (status.state === 'failed') {
        setActiveJob(null)
        setRecheck({ state: 'failed', error: status.error || '수집에 실패했습니다.' })
      } else {
        setRecheck({ state: 'running', step: status.step, elapsed })
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [activeJob])

  const handleRecheckClick = async () => {
    if (recheckProviders.length === 0 || recheck.state === 'running') return
    const res = await postCollectThreat(recheckProviders)
    if ('conflict' in res) {
      setRecheck({ state: 'conflict' })
      return
    }
    if (res.success) {
      setRecheck({ state: 'running', elapsed: 0 })
      setActiveJob({ jobId: res.jobId, startTime: Date.now() })
      return
    }
    setRecheck({ state: 'failed', error: res.error || '수집 요청에 실패했습니다.' })
  }

  if (eaDetailId) {
    const detail = (
      <EffectiveAccessDetail
        finding={finding}
        graph={graph}
        effectiveAccess={effectiveAccess}
        rowId={eaDetailId}
        onSelectRow={setEaDetailId}
        onBack={() => setEaDetailId(null)}
      />
    )
    // 결론을 못 찾으면(다른 데이터셋의 주소 등) Finding 상세로 돌아간다
    if (effectiveAccess?.rows.some(row => row.id === eaDetailId && row.x_asked_by.rule_id === finding.ruleId)) return detail
  }

  return (
    <main className="finding-detail-workbench">
      {/* 화면 이름 줄. 다른 화면과 같은 꼴이다. 되돌아가기 · 그래프 이동은 여기에 둔다. */}
      <div className="page-title-bar page-title-bar-inset">
        <DetailCrumb back={backLabel} onBack={onBack} title="위협 상세" meta={finding.id} />
        <div className="page-head-actions">
          {/* 위협을 차례로 볼 때 목록에 돌아가지 않는다. Access Gaps, Exceptions 상세와 같은 이전, 다음이다 */}
          {pager && pager.total > 1 && <DetailPager index={pager.index} total={pager.total} unit="위협" onPrev={pager.onPrev} onNext={pager.onNext} />}
          {(() => {
            // 그래프 단추 하나: 확산 경로가 있으면 그 경로를, 없으면 위협의 첫 객체를 연다
            const openGraph = spread && onOpenThreatSpread
              ? () => onOpenThreatSpread(spread.origin, [spread.origin, ...spread.hops.map(h => h.key)])
              : onSelectObjectInGraph && finding.involvedObjectKeys[0] ? () => onSelectObjectInGraph(finding.involvedObjectKeys[0]) : null
            // Event Board 단추 하나: 이 위협을 조사 대상으로 연다. 숫자는 관련 이벤트(최근 7일) 수
            const keys = finding.involvedObjectKeys
            const openBoard = keys.length === 0 ? null : onOpenEventBoard ? () => onOpenEventBoard(keys) : onOpenEvents ? () => onOpenEvents(keys) : null
            const showException = onException && exceptionState !== 'excepted'
            if (!showException && !openGraph && !openBoard) return null
            return (
              <DetailGroup label="위협 작업">
                {showException && <DetailButton iconOnly label="이 위협을 예외 처리" icon={<ShieldOff size={15} strokeWidth={2} aria-hidden="true" />} onClick={onException} />}
                {openGraph && <DetailButton label="Cross-SaaS Graph" icon={<Waypoints size={15} strokeWidth={2} aria-hidden="true" />} onClick={openGraph} />}
                {openBoard && <DetailButton label="Event Board" count={relatedEvents} icon={<Activity size={15} strokeWidth={2} aria-hidden="true" />} onClick={openBoard} />}
              </DetailGroup>
            )
          })()}
          {showRecheck && recheckProviders.length > 0 && (
            <span className="fd-recheck-wrap">
              <button
                type="button"
                className="fd-back-btn"
                disabled={recheck.state === 'running'}
                onClick={() => void handleRecheckClick()}
              >
                이 위협 다시 확인
              </button>
              {recheck.state === 'running' && (
                <span className="fd-recheck-status" role="status">
                  {recheck.step ? `${recheck.step} ` : ''}({recheck.elapsed}초)
                </span>
              )}
              {recheck.state === 'done' && (
                <span className="fd-recheck-status" role="status">
                  다시 확인했습니다. 새로고침하면 반영됩니다
                  <button type="button" className="fd-back-btn" style={{ marginLeft: 6 }} onClick={() => window.location.reload()}>
                    새로고침
                  </button>
                </span>
              )}
              {recheck.state === 'failed' && (
                <span className="fd-recheck-status is-error" role="status">
                  {recheck.error}
                </span>
              )}
              {recheck.state === 'conflict' && (
                <span className="fd-recheck-status is-error" role="status">
                  다른 수집이 실행 중입니다
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      <header className="finding-detail-header">

        <div className="fd-header-meta">
          <div className="fd-tags-row">
            {/* 심각도는 늘 분류 앞에 둔다 */}
            <span className={`fn-severity-badge ${severityClass(finding.severity)}`}>{severityLabel(finding.severity)}</span>
            <span className={`scenario-tag-badge lg ${tagClass(findingTagKey(finding))}`} title={scenarioTag(findingTagKey(finding)).description}>
              {scenarioTag(findingTagKey(finding)).label}
            </span>
            {/* 상태는 예외로 가렸을 때만 적는다. 열린 상태가 기본이라 「열림」은 적지 않는다. */}
            {exceptionState === 'excepted' && (
              <span className={`fd-status-badge is-${exceptionState}`}>
                <ShieldOff size={12} strokeWidth={2.2} aria-hidden="true" />
                예외 처리됨
              </span>
            )}
            {/* SaaS 는 목록과 같이 로고만 흐름 순서로. 이름은 툴팁과 읽기 도구로. */}
            <div className="fd-provider-list" aria-label={finding.providerSet.map(providerName).join(' → ')}>
              {finding.providerSet.map((p, index) => (
                <Fragment key={p}>
                  {index > 0 && <ArrowRight className="fd-provider-arrow" size={13} strokeWidth={2.2} aria-hidden="true" />}
                  <span className="fd-provider-chip" title={providerName(p)}>
                    <ProviderLogo provider={providerLogoId(p)} />
                  </span>
                </Fragment>
              ))}
            </div>
          </div>

          <h2 className="fd-title">
            {finding.title}
            {finding.threatCertainty === '미확정' && (
              <i className="fd-record-badge inferred" title="판정에 필요한 값 일부를 수집하지 못함">추정</i>
            )}
          </h2>
          {finding.threatHeadline ? (
            <p className="fd-summary fd-headline">
              <b>{finding.threatHeadline.count}</b>{subjectParticle(finding.threatHeadline.count)} <b>{finding.threatHeadline.point}</b>을 거쳐 <b>{finding.threatHeadline.target}</b>에
              {finding.threatHeadline.types.map(type => <em key={type}>{type}</em>)}
            </p>
          ) : (
            <p className="fd-summary">{finding.summary}</p>
          )}
          {/* 새 위협은 사람, 경유, 대상을 엔진이 정한다. 3단계 확산 탐색의 객체 수는 그 판정과 달라 적지 않는다 */}
          {spread && finding.ruleId !== 'threat-v2' && (
            <p className="fd-spread-sentence">
              {spread.objectCount > 0
                ? `이 위협에서 ${spread.providers.length}개 SaaS, ${spread.objectCount}개${spread.truncated ? ' 이상의' : ''} 객체까지 접근할 수 있습니다`
                : '추가 확산 경로를 찾지 못했습니다'}
            </p>
          )}
        </div>

        {/* 예외가 걸려 있으면 무엇이 왜 가려졌는지 헤더 바로 아래에 보인다. */}
        {view && view.applied.length > 0 && (
          <div className={`fd-exception-banner is-${exceptionState}`} role="status">
            <div className="fd-exception-banner-head">
              <ShieldOff size={14} strokeWidth={2} />
              <b>예외 처리된 위협. 목록, 개요, 그래프에서 제외</b>
            </div>
            <ul className="fd-exception-list">
              {view.applied.map(exc => (
                <li key={exc.id}>
                  <span className="fd-exception-what">
                    <em className={`ex-reason-chip r-${exc.reasonCategory}`}>{REASON_LABELS[exc.reasonCategory]}</em>
                    <small>
                      {SCOPE_LABELS[exc.scope]}
                      {exc.subjectLabel && `, ${exc.subjectLabel}`}, {exc.actor}, 만료 {expiryText(exc.expiresAt, now)}
                    </small>
                  </span>
                  <span className="fd-exception-reason">“{exc.reason}”</span>
                  {onOpenException && (
                    <button type="button" className="ex-link" onClick={() => onOpenException(exc.id)}>
                      예외 관리에서 보기
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {onRevokeExceptions && (
              <div className="fd-exception-actions">
                {revoking ? (
                  <RevokeForm
                    count={view.applied.length}
                    onCancel={() => setRevoking(false)}
                    onConfirm={(actor, note) => {
                      onRevokeExceptions(view.applied.map(e => e.id), actor, note)
                      setRevoking(false)
                    }}
                  />
                ) : (
                  <button type="button" className="ex-btn danger" onClick={() => setRevoking(true)}>
                    예외 취소{view.applied.length > 1 ? ` (${view.applied.length}건)` : ''}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      {/* 할 일을 위로. 권장 조치가 화면 2장 아래(약 1,020px)에 있어, 무엇을 해야 하는지 보려면 내려야 했다 */}
      {(() => {
        const first = orderedRemediation[0]
        const synthetic = observations.length - measuredCount
        return (
          <section className="fd-summary-line" aria-label="요약">
            {first && (
              <div className="fd-summary-cell fd-summary-main">
                <span>우선 조치</span>
                <b>{first.title}</b>
                {/* 권장 조치 칸을 뺐다. 차단 지점이면 그래프 옆 목록으로 간다. 아니면 단추를 두지 않는다 */}
                {actionsInCuts && (
                  <button
                    type="button"
                    className="fd-summary-btn"
                    onClick={() => {
                      document.querySelector('.fd-cut-side')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                      setHotCut(1)
                      setCutFlash(true)
                    }}
                  >
                    차단 지점 보기
                  </button>
                )}
              </div>
            )}
            <div className="fd-summary-cell">
              <span>근거</span>
              <b>{observations.length > 0 ? `활동 증적 ${observations.length}건` : relationRecords.length > 0 ? `관계 증적 ${relationRecords.length}건` : '증적 없음'}</b>
              {measuredCount > 0 && <i className="fd-record-badge measured">실측 {measuredCount}</i>}
              {synthetic > 0 && <i className="fd-record-badge synthetic">합성 {synthetic}</i>}
            </div>
            {collectedAt && (
              <div className="fd-summary-cell">
                <span>수집</span>
                <b title={utcTitle(collectedAt)}>{formatKst(collectedAt)}</b>
              </div>
            )}
          </section>
        )
      })()}

      {handlingSlot}

      {/* 탐지 경로 그래프는 화면 폭을 다 쓴다. 객체가 10개를 넘으면
          1fr 칸(약 460px)에서는 노드가 서로 겹친다. */}
      <section className="fd-focus-graph-panel fd-graph-full" aria-label="탐지 경로 그래프">
            <div className="fd-panel-head fd-graph-head">
              <h3>탐지 경로 그래프</h3>

              <div className="fd-path-views" role="group" aria-label="경로 보기 전환">
                {([
                  { key: 'observed', label: '관측 경로', hint: '증적으로 확인된 실제 발생 순서' },
                  { key: 'possible', label: '잠재 경로', hint: '권한과 동일인 연결이 구조상 허용하는 경로' },
                ] as const).map(item => (
                  <button
                    type="button"
                    key={item.key}
                    title={item.hint}
                    aria-pressed={pathView === item.key}
                    className={pathView === item.key ? 'active' : ''}
                    onClick={() => {
                      setPathView(item.key)
                      setSelectedElementId(null)
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="fd-graph-legend">
                {/* 그림에 있는 선만 적는다 */}
                {([
                  ['observed', '관측된 경로'],
                  ['possible', '가능한 경로'],
                  ['relation', '관계'],
                  ['identity', '동일인 연결'],
                ] as const).filter(([kind]) => layout.edges.some(edge => edge.kind === kind)).map(([kind, label]) => (
                  <span key={kind}><i className={`tpg-key-${kind}`} /> {label}</span>
                ))}
              </div>
            </div>

            <div className={cuts.length || finding.ruleId === 'threat-v2' ? 'fd-graph-split' : undefined}>
              {layout.nodes.length ? (
                <ThreatPathGraph
                  layout={layout}
                  selectedId={selectedElementId}
                  onSelect={setSelectedElementId}
                  onClearSelection={() => {
                    setSelectedElementId(null)
                    setHotCut(null)
                  }}
                  cutMarks={cutMarks}
                  nodeCutMarks={nodeCutMarks}
                  hotCut={hotCut}
                />
              ) : (
                <p className="tpg-empty">{pathView === 'observed' ? '관측된 경로 없음' : '경로 없음'}</p>
              )}
              {(cuts.length > 0 || finding.ruleId === 'threat-v2') && (
                <aside className={`fd-cut-side ${cutFlash ? 'is-flash' : ''}`} aria-label="차단 지점">
                  <CutTable cuts={cuts} hotCut={hotCut} setHotCut={setHotCut} />
                </aside>
              )}
            </div>

            {selectedNodeDetail && (
              <div className="fd-selected-inspector">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{selectedNodeDetail.title}</strong>
                    <span style={{ fontSize: '11px', color: '#0f172a', marginLeft: '6px' }}>({selectedNodeDetail.subtitle})</span>
                  </div>
                  <button type="button" onClick={() => setSelectedElementId(null)} style={{ background: 'none', border: 0, cursor: 'pointer' }}>×</button>
                </div>
                <pre className="fd-ev-json fd-selected-json">
                  {JSON.stringify(selectedNodeDetail.properties, null, 2)}
                </pre>
              </div>
            )}
      </section>

      {/* 위협마다 Access Gap 벤(엔진 accessGap). 벤이 없는 위협은 칸이 없다 */}
      {finding.threatAccessGap && finding.threatPath ? (
        <ThreatAccessGapPanel finding={finding} graph={graph} embedded />
      ) : null}

      {/* 무엇이 왜 일어났나(판정 근거, Effective Access, 증적). 전체 폭을 쓴다 */}
      <div className="finding-detail-grid is-single">
        <div className="fd-left-column">
          {/* Detailed Narrative Sections */}
          <section className="fd-narrative-panel">
            {/* 판정 근거 — 규칙이 무엇을 확인했는가 */}
            <section className="fd-rail-panel" aria-label="판정 근거">
              <div className="fd-panel-head">
                <h3>판정 근거</h3>
              </div>

              {/* 규칙이 따진 조건을 행으로 나눈 표: 권한을 얻는 경로, 얻는 권한 수준, 미수집, 추정. 빈 행은 그리지 않는다 */}
              {checkGroups.length > 0 && (
                <table className="fd-check-table">
                  <tbody>
                    {checkGroups.map(g => (
                      <tr key={g.title}>
                        <th scope="row">{g.title}</th>
                        <td>
                          <ul className="fd-check-list">
                            {g.list.map(check => (
                              <li key={check.id} className={`fd-check-row ${check.state}`}>
                                <span className="fd-check-mark" aria-hidden="true">
                                  {check.state === 'confirmed' ? <Check size={12} strokeWidth={3} /> : check.state === 'inferred' ? '≈' : '?'}
                                </span>
                                <span className="fd-check-label">{check.label}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* 규칙에 딸린 산문 설명. 위의 조건 목록과 같은 이야기라 접어
                  두고, 보고서에 옮겨 적을 때만 펴 보게 한다. */}
              {/* 보고서에 그대로 붙이는 한 줄: 심각도, 분류, 제목, 근거, 권장 조치, 수집 시각 */}
              <details className="fd-rail-note">
                <summary>보고서용 문장</summary>
                <p className="fd-report-text">{reportSentence(finding, evidenceStore, collectedAt)}</p>
                <CopyTextButton text={reportSentence(finding, evidenceStore, collectedAt)} title="보고서용 문장 복사" />
              </details>
            </section>

            {/* Effective Access — 판정 근거(룰이 확인한 조건)와 다른 것: 룰이 물은 접근 질문의 결론. 요약만 두고 누르면 상세 화면. 결론이 없으면 그리지 않는다 */}
            <EffectiveAccessPanel finding={finding} graph={graph} effectiveAccess={effectiveAccess} onOpenDetail={setEaDetailId} />

            {/* 증적. 예전 「증적 요약」의 건수는 머리에 두고, 같은 종류 기록은 한 묶음으로 모아 공통 값은 한 번만 쓴다 */}
            <EvidenceSection observations={observations} relations={relationRecords} graph={graph} />
          </section>


        </div>
      </div>

      {similar.length > 0 && (
        <section className="fd-similar-threats" aria-label={`비슷한 위협 ${similar.length}건`}>
          <div className="fd-panel-head">
            <h3>비슷한 위협 {similar.length}건</h3>
          </div>
          <ul className="fd-similar-list">
            {similar.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  className="fd-similar-btn"
                  onClick={() => onSelectFinding?.(item.id)}
                >
                  <span className={`fn-severity-badge ${severityClass(item.severity)}`}>
                    {severityLabel(item.severity)}
                  </span>
                  <span className="fd-similar-title">{item.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

/**
 * 판정에 쓴 관계의 증적. 원본 로그가 아니라 수집한 설정(권한, 소유, 멤버십)이라 어두운 원본 카드 대신
 * 한 줄씩 적는다. 관계, 수집한 API, 실측 여부, 수집 시각이다. 많으면 처음 12건만 보이고 나머지는 펼친다.
 */
function RelationRecordList({ relations, graph }: { relations: ResolvedRelation[]; graph: GraphStoreV2 }) {
  const [all, setAll] = useState(false)
  const shown = all ? relations : relations.slice(0, 12)
  return (
    <div className="fd-relation-records">
      <h4>관계 증적 {relations.length}건</h4>
      <ul>
        {shown.map(relation => (
          <li key={relation.relationKey}>
            <b>
              {objectLabel(relation.sourceKey, graph)} → {relationLabel(relation.relationType)}
              {relation.roleName ? ` (${relation.roleName})` : relation.roleKey ? ` (${objectLabel(relation.roleKey, graph)})` : ''} → {objectLabel(relation.targetKey, graph)}
            </b>
            <small>
              <code>{relation.source.api}</code>, {relation.source.record === 'measured' ? '실측' : '합성'}
              {relation.source.collected_at && `, 수집 ${formatKst(relation.source.collected_at)}`}
            </small>
          </li>
        ))}
      </ul>
      {relations.length > 12 && (
        <button type="button" className="fd-relation-more" onClick={() => setAll(v => !v)}>
          {all ? '처음 12건만 보기' : `나머지 ${relations.length - 12}건 보기`}
        </button>
      )}
    </div>
  )
}

/** 흰 바탕 글을 그대로 복사하는 단추. 누르면 잠깐 「복사됨」으로 바뀐다 */
function CopyTextButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // 클립보드를 막아 둔 브라우저는 아무 일도 없던 것처럼 둔다
    }
  }
  return (
    <button type="button" className={`fd-note-copy ${copied ? 'done' : ''}`} title={title} onClick={copy}>
      {copied ? <Check size={12} strokeWidth={3} /> : <Copy size={12} strokeWidth={2} />}
      {copied ? '복사됨' : '복사'}
    </button>
  )
}

/**
 * 증적 칸. 머리에 활동, 관계, 실측, 합성 건수를 두고(예전 「증적 요약」), 아래에 같은 종류 기록을 묶어 보인다.
 * 묶음 안에서 값이 같은 칸은 한 번만, 달라지는 칸은 줄마다 쓴다. 줄을 누르면 그 아래에 수집 원문이 펼쳐진다.
 * 예전에는 거의 같은 원문 카드를 건마다 그대로 쌓아, 무엇이 다른지 찾으려면 JSON을 한 줄씩 비교해야 했다.
 */
function EvidenceSection({ observations, relations, graph }: { observations: EvidenceObservation[]; relations: ResolvedRelation[]; graph: GraphStoreV2 }) {
  const groups = useMemo(() => groupEvidence(observations), [observations])
  const measured = observations.filter(obs => obs.provenance.record === 'measured').length + relations.filter(r => r.source.record === 'measured').length
  const total = observations.length + relations.length
  return (
    <section className="fd-rail-panel fd-evidence-panel" aria-label="증적">
      <div className="fd-panel-head">
        <h3>증적</h3>
        {total > 0 && (
          <div className="fd-evidence-facts">
            <span><b>{observations.length}</b>활동</span>
            <span><b>{relations.length}</b>관계</span>
            <span><b>{measured}</b>실측</span>
            <span><b>{total - measured}</b>합성</span>
          </div>
        )}
      </div>
      {total === 0 && <p className="fd-evidence-none">이 탐지에 연결된 증적 없음</p>}
      {groups.map(group => <EvidenceGroupBlock key={group.key} group={group} />)}
      {relations.length > 0 && <RelationRecordList relations={relations} graph={graph} />}
    </section>
  )
}

/** 표에 줄마다 쓰는 칸은 셋까지. 나머지는 펼친 원문에서 본다 */
const EVIDENCE_ROW_FIELDS = 3

function EvidenceGroupBlock({ group }: { group: EvidenceGroup }) {
  const [open, setOpen] = useState<string | null>(null)
  const varying = group.varying.slice(0, EVIDENCE_ROW_FIELDS)
  const toggle = (id: string) => setOpen(prev => (prev === id ? null : id))
  const single = group.items.length === 1
  return (
    <div className="fd-evidence-group">
      <div className="fd-evidence-group-head">
        <span className="fd-evidence-kind">{group.kindLabel}</span>
        <b>{group.title}</b>
      </div>
      {(group.common.length > 0 || single) && (
        <dl className="fd-evidence-fields">
          {group.common.map(field => (
            <div key={field}>
              <dt>{evidenceFieldLabel(field)}</dt>
              <dd><code>{evidenceFieldValue(group.items[0].attributes[field])}</code></dd>
            </div>
          ))}
          {single && (
            <div>
              <dt>기록</dt>
              <dd>{group.items[0].provenance.record === 'measured' ? '실측' : '합성'}</dd>
            </div>
          )}
        </dl>
      )}
      {/* 한 건짜리 묶음은 표 줄이 머리 제목과 같은 말이라 표를 두지 않고 원문 단추만 둔다 */}
      {single ? (
        <>
          <button type="button" className="fd-evidence-rawbtn" aria-expanded={open !== null} onClick={() => toggle(group.items[0].id)}>
            {open ? '원문 닫기' : '원문 보기'}
          </button>
          {open && <EvidenceRaw observation={group.items[0]} />}
        </>
      ) : (
      <table className="fd-evidence-table">
        <thead>
          <tr>
            <th>#</th>
            <th>내용</th>
            {varying.map(field => <th key={field}>{evidenceFieldLabel(field)}</th>)}
            <th>기록</th>
            <th aria-label="원문" />
          </tr>
        </thead>
        <tbody>
          {group.items.map((obs, index) => (
            <Fragment key={obs.id}>
              <tr
                className={open === obs.id ? 'is-open' : ''}
                onClick={() => toggle(obs.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    toggle(obs.id)
                  }
                }}
                tabIndex={0}
                aria-expanded={open === obs.id}
              >
                <td>{index + 1}</td>
                <td><b>{obs.title || obs.id}</b></td>
                {varying.map(field => <td key={field}><code>{evidenceFieldValue(obs.attributes[field])}</code></td>)}
                <td>{obs.provenance.record === 'measured' ? '실측' : '합성'}</td>
                <td className="fd-evidence-toggle">{open === obs.id ? '원문 닫기' : '원문'}</td>
              </tr>
              {open === obs.id && (
                <tr className="fd-evidence-raw-row">
                  <td colSpan={4 + varying.length}><EvidenceRaw observation={obs} /></td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      )}
    </div>
  )
}

/** 수집 원문. 어두운 상자와 복사 단추는 예전 증적 카드 그대로다 */
function EvidenceRaw({ observation }: { observation: EvidenceObservation }) {
  const [copied, setCopied] = useState(false)
  const body = JSON.stringify(observation.attributes, null, 2)

  // 되돌리기 타이머는 원문이 닫히면 같이 정리한다.
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body)
      setCopied(true)
    } catch {
      // 클립보드를 막아 둔 브라우저가 있다. 이때는 아무 일도 없던 것처럼 둔다.
    }
  }

  return (
    <div className="fd-evidence-raw">
      <button type="button" className={`fd-ev-copy ${copied ? 'done' : ''}`} title="증적 원본을 복사" onClick={copy}>
        {copied ? <Check size={12} strokeWidth={3} /> : <Copy size={12} strokeWidth={2} />}
        {copied ? '복사됨' : '복사'}
      </button>
      <pre className="fd-ev-json">
        <span className="fd-ev-source">
          # 출처: {observation.provenance.sourceRef} ({observation.provenance.record})
        </span>
        {body}
      </pre>
    </div>
  )
}

/**
 * 차단 지점 표. 머리에 전원 차단, 일부 차단 건수를 두고, 줄마다 번호, 조치, 조치할 곳, 범위, 차단 인원을 칸으로 나눈다.
 * 예전에는 「X의 Y 권한 축소」 한 문장에 긴 계정 이름이 섞여 세 칸 격자에서 줄이 들쭉날쭉했고, 일부 차단은 접혀 있었다.
 * 번호는 그래프의 「차단 N」과 같다. 줄을 누르면 그 차단 지점만 그래프에 빨갛게 남는다.
 */
function CutTable({ cuts, hotCut, setHotCut }: { cuts: ThreatCutView[]; hotCut: number | null; setHotCut: (f: (prev: number | null) => number | null) => void }) {
  const full = cuts.filter(c => c.verified).length
  const toggle = (no: number) => setHotCut(prev => (prev === no ? null : no))
  return (
    <>
      <div className="fd-cut-head">
        <h4>차단 지점</h4>
        <span><b>{full}</b>전원 차단</span>
        <span><b>{cuts.length - full}</b>일부 차단</span>
      </div>
      {cuts.length === 0 ? (
        <p className="fd-cut-none">차단 가능 지점 없음</p>
      ) : (
        <table className="fd-cut-table">
          <thead>
            <tr>
              <th>번호</th>
              <th>조치</th>
              <th>조치할 곳</th>
              <th>범위</th>
              <th>차단 인원</th>
            </tr>
          </thead>
          <tbody>
            {cuts.map((c, i) => {
              const no = i + 1
              return (
                <tr
                  key={no}
                  className={hotCut === no ? 'is-hot' : ''}
                  onClick={() => toggle(no)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      toggle(no)
                    }
                  }}
                  tabIndex={0}
                  aria-pressed={hotCut === no}
                  aria-label={`차단 ${no}, ${c.title}${cutOutcome(c) ? `, ${cutOutcome(c)}` : ''}`}
                >
                  <td><i className="tpg-cut-no">차단 {no}</i></td>
                  <td><b>{c.action ?? c.title}</b></td>
                  <td>
                    <span className="fd-cut-name" title={c.target}>{c.target ?? ''}</span>
                    {c.withTitles?.map(t => <small key={t} className="fd-cut-sub">+ {t}</small>)}
                    {cutVia(c) && <small className="fd-cut-sub">{cutVia(c)}</small>}
                  </td>
                  <td><span className="fd-cut-name" title={c.scope}>{c.scope ?? ''}</span></td>
                  <td className="fd-cut-count">
                    {c.closes === undefined ? (
                      '-'
                    ) : (
                      <>
                        <span className="fd-cut-bar" aria-hidden="true"><span style={{ width: `${c.of ? (c.closes / c.of) * 100 : 0}%` }} /></span>
                        <b>{c.closedText ?? c.closes}</b> / {c.ofText ?? `${c.of}명`}
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}
