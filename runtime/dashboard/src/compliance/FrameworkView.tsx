import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { StandardResults } from '../config-findings/standardResultsStore'
import type { GraphStoreV2 } from '../model/graph'
import { objectLabel } from '../blast-radius/blastLabels'
import { Legend, type Match, AutoResultDonut, ResultBar, ScopeCoverageDonut, countOf, unique } from './complianceOverviewShared'
import { type ControlState, DEDICATED, STATE_LABEL, controlState, requirementMatches, requirementState } from './controlStatus'
import type { Control, Framework, FrameworkId, Requirement } from './frameworkModel'
import TypeScopeTargets, { UnifiedBar } from './TypeScopeTargets'
import { aggregateUniqueObjectCounts, type UnifiedStatus } from './typeScope'
import ExcludedItems from './ExcludedItems'
import { verdictFor } from './verdicts'
import { EFFECTIVE_LABEL, effectiveVerdict, worstEffective } from './exceptionStatus'
import { COMPLIANCE_EXCEPTION_REASON_LABEL, complianceExceptionKey, type ComplianceException, type ComplianceExceptionScope } from '../model/complianceException'
import type { ComplianceExceptionsApi } from './useComplianceExceptions'
import ComplianceExceptionDialog from './ComplianceExceptionDialog'
import { complianceForFinding } from './findingCompliance'
import { formatDate } from '../exceptions/format'
import { remediationFor } from './remediations'
import { configThreatHash } from '../appRouting'
import GuidanceSections from './GuidanceSections'

const FRAMEWORK_LABEL: Record<FrameworkId, string> = {
  'isms-p': 'ISMS-P',
  iso27001: 'ISO 27001',
  pipa: 'PIPA',
}

const overviewMemory: Record<FrameworkId, { selected: string | null; scroll: number }> = {
  'isms-p': { selected: null, scroll: 0 },
  iso27001: { selected: null, scroll: 0 },
  pipa: { selected: null, scroll: 0 },
}

function criterionInHash(frameworkId: FrameworkId): string | null {
  const params = new URLSearchParams(window.location.hash.split('?')[1])
  const fw = params.get('framework')
  if (fw && fw !== frameworkId) return null
  return params.get('criterion')
}

const ROW_BAR_KINDS: { key: UnifiedStatus; label: string; barClass: string }[] = [
  { key: 'pass', label: '충족', barClass: 'is-pass' },
  { key: 'fail', label: '위반', barClass: 'is-fail' },
  { key: 'unknown', label: '판정 불가', barClass: 'is-unknown' },
  { key: 'person', label: '직접 확인', barClass: 'is-person' },
  { key: 'uninspected', label: '미점검', barClass: 'is-not_collected' },
]

function StateBadge({ state, dedicated }: { state: ControlState; dedicated?: string }) {
  if (state === 'auto') {
    if (dedicated) return <span className="comp-state">{dedicated}</span>
    return null
  }
  if (state === 'manual') return <span className="comp-state is-pending">{STATE_LABEL.manual}</span>
  return <span className="comp-state">{STATE_LABEL.out}</span>
}

function controlKey(control: Control): string {
  return `${control.group}:${control.id}`
}

function findControl(framework: Framework, sel: string | null): Control | undefined {
  if (!sel) return undefined
  return (
    framework.controls.find(c => controlKey(c) === sel) ??
    framework.controls.find(c => c.id === sel) ??
    framework.controls.find(c => c.requirements.some(r => r.key === sel || r.id === sel))
  )
}

type FilterKey = 'all' | 'fail' | 'partial' | 'pass' | 'unknown' | 'manual' | 'no_check' | 'excepted'

export default function FrameworkView({
  framework,
  results,
  graph,
  onOpenObject,
  exceptions,
  head,
  requirementExtras,
  controlExtras,
  rowExtras,
}: {
  framework: Framework
  results: StandardResults | undefined
  graph: GraphStoreV2
  onOpenObject?: (key: string) => void
  exceptions?: ComplianceExceptionsApi
  head?: ReactNode
  requirementExtras?: (req: Requirement) => ReactNode
  controlExtras?: (control: Control) => ReactNode
  rowExtras?: (control: Control) => ReactNode
}) {
  const now = new Date()
  const excItems = exceptions?.items ?? []
  const [dialog, setDialog] = useState<{
    scope: ComplianceExceptionScope
    target: string
    label: string
    failFindings: string[]
    existing?: ComplianceException
    linkedCount?: number
  } | null>(null)
  const mem = overviewMemory[framework.id]
  const [selected, setSelected] = useState<string | null>(() => criterionInHash(framework.id) ?? mem.selected)
  const [reqIdx, setReqIdx] = useState(0)
  const [query, setQuery] = useState('')
  const [stateFilter, setStateFilter] = useState<FilterKey>('all')
  const [showExcluded, setShowExcluded] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const detailRef = useRef<HTMLHeadingElement>(null)
  const returnTo = useRef<string | null>(null)

  useEffect(() => {
    const sync = () => {
      const c = criterionInHash(framework.id)
      if (c) setSelected(c)
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [framework.id])

  const current = findControl(framework, selected)

  useEffect(() => {
    const scroller = document.scrollingElement
    if (scroller && mem.scroll) scroller.scrollTop = mem.scroll
    const remember = () => { mem.scroll = scroller?.scrollTop ?? 0 }
    window.addEventListener('scroll', remember, { passive: true })
    return () => window.removeEventListener('scroll', remember)
  }, [mem])

  useEffect(() => {
    mem.selected = selected
    if (current) {
      detailRef.current?.focus({ preventScroll: true })
      const row = document.querySelector<HTMLElement>(`[data-criterion="${current.id}"]`)
      const list = row?.closest<HTMLElement>('.comp-list')
      if (row && list) list.scrollTop = Math.max(0, row.offsetTop - 48)
    } else if (returnTo.current) {
      document.querySelector<HTMLElement>(`[data-criterion="${returnTo.current}"]`)?.focus({ preventScroll: true })
    }
  }, [selected, current, mem])

  const open = (control: Control) => {
    returnTo.current = control.id
    const hasDupId = framework.controls.filter(c => c.id === control.id).length > 1
    setSelected(hasDupId ? controlKey(control) : control.id)
    setReqIdx(0)
  }

  const { matchesByReq, objectDistributions, groupDistributions, totalTargets } = useMemo(() => {
    const byReq = new Map<string, Match[]>()
    for (const c of framework.controls) {
      for (const r of c.requirements) {
        byReq.set(r.key, requirementMatches(results, r))
      }
    }
    const distMap = new Map<string, { counts: Record<UnifiedStatus, number>; total: number }>()
    for (const c of framework.controls) {
      distMap.set(
        controlKey(c),
        aggregateUniqueObjectCounts(c.requirements, graph, byReq, key => objectLabel(key, graph)),
      )
    }
    const groupMap = new Map<string, { counts: Record<UnifiedStatus, number>; total: number }>()
    for (const g of framework.groups) {
      const gReqs = framework.controls.filter(c => c.group === g.no).flatMap(c => c.requirements)
      groupMap.set(
        g.no,
        aggregateUniqueObjectCounts(gReqs, graph, byReq, key => objectLabel(key, graph)),
      )
    }
    const allReqs = framework.controls.flatMap(c => c.requirements)
    const total = aggregateUniqueObjectCounts(allReqs, graph, byReq, key => objectLabel(key, graph)).total
    return { matchesByReq: byReq, objectDistributions: distMap, groupDistributions: groupMap, totalTargets: total }
  }, [framework, results, graph])
  const matchesOf = (c: Control) => unique(c.requirements.flatMap(r => matchesByReq.get(r.key) ?? []))
  const stateOf = (c: Control) => controlState(c)

  const allMatches = unique(framework.controls.flatMap(matchesOf))
  const totalCounts = countOf(allMatches)
  const verdictCounts = { fail: 0, pass: 0, partial: 0, unknown: 0, manual: 0, no_check: 0, excepted: 0 }
  const controlEffective = (c: Control) =>
    worstEffective(c.requirements.map(r => effectiveVerdict(verdictFor(results, r.key), excItems, now)))
  if (results?.compliance) {
    for (const c of framework.controls) {
      const v = controlEffective(c)
      if (v) verdictCounts[v]++
    }
  }
  const isManualControl = (c: Control) => stateOf(c) === 'manual' || controlEffective(c) === 'manual'
  const manualCount = framework.controls.filter(isManualControl).length
  // 확인사항 하나라도 예외 상태인 항목. 다른 확인사항이 일부 확인이면 행 배지는 그쪽을 따른다
  const hasExcepted = (c: Control) =>
    Boolean(results?.compliance) && c.requirements.some(r => effectiveVerdict(verdictFor(results, r.key), excItems, now)?.status === 'excepted')
  const isFailingControl = (c: Control) =>
    countOf(matchesOf(c)).fail > 0 && !(hasExcepted(c) && controlEffective(c) !== 'fail')
  const failControlCount = framework.controls.filter(isFailingControl).length
  const exceptedControlCount = framework.controls.filter(hasExcepted).length
  const targets = totalTargets

  const q = query.trim().toLowerCase()
  const filterControl = (c: Control): boolean => {
    const cv = controlEffective(c)
    if (stateFilter === 'manual' && !isManualControl(c)) return false
    if (stateFilter === 'fail' && !(results?.compliance ? cv === 'fail' : isFailingControl(c))) return false
    if (stateFilter === 'partial' && cv !== 'partial') return false
    if (stateFilter === 'pass' && cv !== 'pass') return false
    if (stateFilter === 'unknown' && cv !== 'unknown') return false
    if (stateFilter === 'no_check' && cv !== 'no_check') return false
    if (stateFilter === 'excepted' && !hasExcepted(c)) return false
    if (!q) return true
    return (
      c.id.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.subtitle.toLowerCase().includes(q) ||
      c.requirements.some(r => r.id.toLowerCase().includes(q) || r.text.toLowerCase().includes(q))
    )
  }

  const filteredGroups = framework.groups
    .map(g => ({ ...g, rows: framework.controls.filter(c => c.group === g.no && filterControl(c)) }))
    .filter(g => g.rows.length > 0)

  const failFilterCount = results?.compliance ? verdictCounts.fail : failControlCount
  const filterButtons: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: '전체', count: framework.controls.length },
    { key: 'fail', label: '위반', count: failFilterCount },
    ...(verdictCounts.partial > 0 ? [{ key: 'partial' as const, label: '일부 확인', count: verdictCounts.partial }] : []),
    { key: 'pass', label: '충족', count: verdictCounts.pass },
    { key: 'unknown', label: '판정 불가', count: verdictCounts.unknown },
    { key: 'manual', label: '직접 확인 필요', count: manualCount },
    ...(verdictCounts.no_check > 0 ? [{ key: 'no_check' as const, label: '점검 없음', count: verdictCounts.no_check }] : []),
    ...(exceptedControlCount > 0 ? [{ key: 'excepted' as const, label: '예외', count: exceptedControlCount }] : []),
  ]

  const fwClass = framework.id === 'iso27001' ? 'comp-iso' : `comp-${framework.id}`
  const currentGroup = current ? framework.groups.find(g => g.no === current.group) : undefined
  const currentGroupLabel = current
    ? (currentGroup ? (framework.id === 'isms-p' ? `${currentGroup.no}. ${currentGroup.name}` : currentGroup.name) : current.group)
    : ''

  if (showExcluded) {
    return <section className={`comp-isms ${fwClass}`}>
      <div className="comp-isms-head">
        <h2>{framework.label} 제외 항목</h2>
        <button type="button" className="ex-btn" onClick={() => setShowExcluded(false)}>검사 항목으로 돌아가기</button>
      </div>
      <ExcludedItems framework={framework.id} />
    </section>
  }

  return <section className={`comp-isms ${fwClass} ${current ? 'is-split' : ''}`}>
    <div className="comp-isms-head">
      <h2>{framework.label} {framework.unit} {framework.controls.length}개</h2>
      {head}
      <button type="button" className="ex-btn" onClick={() => { setSelected(null); setShowExcluded(true) }}>제외 항목 보기</button>
    </div>
    <section className="comp-summary" aria-label="전체 현황">
      <div className="comp-summary-head">
        <div className="comp-summary-main-row">
          <h3>전체 현황</h3>
          <span><b>{framework.controls.length}</b>{framework.unit}</span>
          {results?.compliance && (
            <>
              <span className={verdictCounts.fail ? 'is-fail' : ''}><b>{verdictCounts.fail}</b>위반 항목</span>
              {exceptedControlCount > 0 && <span><b>{exceptedControlCount}</b>예외 항목</span>}
            </>
          )}
          <span className={totalCounts.fail ? 'is-fail' : ''}>
            <b>{totalCounts.fail} / {allMatches.length}</b>위반 점검 / 관련 점검
          </span>
          <button
            type="button"
            className="ex-btn comp-summary-toggle"
            aria-expanded={showDetail}
            onClick={() => setShowDetail(v => !v)}
          >
            {showDetail ? '접기' : '자세히'}
          </button>
        </div>
        {showDetail && (
          <div className="comp-summary-detail-row">
            {results?.compliance && (
              <>
                <span><b>{verdictCounts.pass}</b>충족 항목</span>
                <span><b>{verdictCounts.partial}</b>일부 확인 항목</span>
                <span><b>{verdictCounts.unknown}</b>판정 불가 항목</span>
                <span><b>{verdictCounts.no_check}</b>점검 없음 항목</span>
              </>
            )}
            <span><b>{manualCount}</b>직접 확인 필요</span>
            <span><b>{targets}</b>대상 객체</span>
            <Legend ms={allMatches} />
          </div>
        )}
      </div>
      {/* 대분류 수만큼 칸을 나눈다(최대 셋). 셋보다 적어 카드가 넓으면 두 도넛 칸 폭을 440px 로 막아 옆으로 놓는다 */}
      <div className="comp-summary-cards" style={{ '--comp-summary-cols': Math.min(3, framework.groups.length), '--comp-summary-main-max': framework.groups.length < 3 ? '440px' : '1fr' } as CSSProperties}>{framework.groups.map(g => {
        const gDist = groupDistributions.get(g.no) ?? {
          counts: { fail: 0, pass: 0, unknown: 0, person: 0, uninspected: 0 },
          total: 0,
        }
        const gc = gDist.counts
        const auto = gc.fail + gc.unknown + gc.pass
        return <div key={g.no} className="comp-summary-card">
          <div className="comp-summary-title">{framework.id !== 'pipa' && <span className="comp-group-no">{g.no}</span>}<b>{g.name}</b></div>
          <div className="comp-summary-main">
            <div className="comp-summary-block">
              <ScopeCoverageDonut counts={gc} total={gDist.total} />
              <dl>
                <div className="is-total"><dt>대상 객체</dt><dd>{gDist.total}</dd></div>
                <div className="is-auto"><dt><i />자동 판정</dt><dd>{auto}</dd></div>
                <div className="is-person"><dt><i />직접 확인</dt><dd>{gc.person}</dd></div>
                {gc.uninspected > 0 && <div className="is-uninspected"><dt><i />미점검</dt><dd>{gc.uninspected}</dd></div>}
              </dl>
            </div>
            <div className="comp-summary-block">
              <AutoResultDonut counts={gc} />
              <dl>
                <div className="is-pass"><dt><i />충족</dt><dd>{gc.pass}</dd></div>
                <div className="is-fail"><dt><i />위반</dt><dd>{gc.fail}</dd></div>
                <div className="is-unknown"><dt><i />판정 불가</dt><dd>{gc.unknown}</dd></div>
              </dl>
            </div>
          </div>
        </div>
      })}</div>
    </section>
    <div className="comp-toolbar">
      <input
        type="search"
        className="comp-search"
        aria-label="항목 검색"
        placeholder="번호, 이름, 확인사항 검색"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div className="comp-filter-group" role="group" aria-label="상태">
        {filterButtons.map(b => (
          <button
            key={b.key}
            type="button"
            className={`comp-filter-btn ${stateFilter === b.key ? 'is-selected' : ''}`}
            aria-pressed={stateFilter === b.key}
            onClick={() => setStateFilter(b.key)}
          >
            {b.label} {b.count}
          </button>
        ))}
      </div>
    </div>
    <div className="comp-browse">
      <nav className="comp-list" aria-label={`${framework.label} ${framework.unit}`}>
        {filteredGroups.length === 0 ? (
          <p className="comp-list-empty">조건에 맞는 항목이 없습니다.</p>
        ) : (
          filteredGroups.map(g => <section key={g.no} className="comp-group">
            <h3 className="comp-group-head">{framework.id !== 'pipa' && <span className="comp-group-no">{g.no}</span>}{g.name}<em>{g.rows.length}</em></h3>
            {g.rows.map(control => {
              const matches = matchesOf(control)
              const c = countOf(matches)
              const objDist = objectDistributions.get(controlKey(control))
              const n = objDist?.total ?? 0
              const st = stateOf(control)
              const dedicated = control.requirements.map(r => DEDICATED[r.key]).filter(Boolean).join(', ') || undefined
              const on = current === control
              const controlVerdict = controlEffective(control)
              const hasState = Boolean(controlVerdict || (st !== 'auto' || dedicated) || rowExtras?.(control))
              return <button
                key={controlKey(control)}
                type="button"
                data-criterion={control.id}
                className={`cfg-isms-overview-item comp-row ${on ? 'is-current' : ''}`}
                aria-pressed={on}
                onClick={() => on ? setSelected(null) : open(control)}
              >
                <strong>{control.id} {control.title}{control.subtitle && control.subtitle !== g.name ? <small>{control.subtitle}</small> : null}</strong>
                <span className="comp-row-reqs">확인사항 {control.requirements.length}개{n ? <><br />대상 객체 {n}개</> : null}</span>
                {hasState && (
                  <span className="comp-row-state">
                    {controlVerdict && (
                      <span className={`cfg-status tl-badge${controlVerdict === 'fail' ? ' is-failure' : ''}`}>
                        {controlVerdict === 'fail' && c.fail ? `위반 점검 ${c.fail}` : EFFECTIVE_LABEL[controlVerdict]}
                      </span>
                    )}
                    {controlVerdict !== 'excepted' && hasExcepted(control) && <span className="cfg-status tl-badge">{EFFECTIVE_LABEL.excepted}</span>}
                    <StateBadge state={st} dedicated={dedicated} />
                    {rowExtras?.(control)}
                  </span>
                )}
                <span className="comp-row-result">
                  {objDist && objDist.total > 0 ? (
                    <UnifiedBar counts={objDist.counts} total={objDist.total} kinds={ROW_BAR_KINDS} size="sm" />
                  ) : (
                    <ResultBar ms={matches} size="sm" />
                  )}
                </span>
              </button>
            })}
          </section>)
        )}
      </nav>
      {current && <article className="comp-detail" aria-label={`${current.id} ${current.title}`}>
        <header>
          <div>
            <span className="comp-detail-group">{currentGroupLabel}</span>
            <h3 ref={detailRef} tabIndex={-1}>{current.id} {current.title}</h3>
            {current.subtitle && <p className="comp-iso-title">{current.subtitle}</p>}
          </div>
          <button type="button" className="ex-btn" onClick={() => setSelected(null)}>전체 보기</button>
        </header>
        <div className="comp-detail-body">
          {(() => {
            const reqs = current.requirements
            const multi = reqs.length > 1
            const safeIdx = reqIdx < reqs.length ? reqIdx : 0
            const visibleReqs = multi ? [reqs[safeIdx]] : reqs
            return <>
              {multi && (
                <div className="comp-req-pager" role="navigation" aria-label="세부 확인사항 페이지">
                  <div className="comp-req-tabs">
                    {reqs.map((item, i) => (
                        <button
                          key={item.key}
                          type="button"
                          className={`comp-filter-btn ${i === safeIdx ? 'is-selected' : ''}`}
                          aria-pressed={i === safeIdx}
                          onClick={() => setReqIdx(i)}
                        >
                          확인사항 {i + 1}
                        </button>
                    ))}
                  </div>
                  <div className="comp-req-nav">
                    <button
                      type="button"
                      className="ex-btn"
                      disabled={safeIdx === 0}
                      onClick={() => setReqIdx(Math.max(0, safeIdx - 1))}
                    >
                      이전
                    </button>
                    <span className="comp-req-page-num">{safeIdx + 1} / {reqs.length}</span>
                    <button
                      type="button"
                      className="ex-btn"
                      disabled={safeIdx >= reqs.length - 1}
                      onClick={() => setReqIdx(Math.min(reqs.length - 1, safeIdx + 1))}
                    >
                      다음
                    </button>
                  </div>
                </div>
              )}
              {visibleReqs.map(r => {
                const reqNumber = multi ? safeIdx + 1 : 1
                const reqSt = requirementState(r, current.inScope)
                const reqDedicated = DEDICATED[r.key]
                const reqMatches = matchesByReq.get(r.key) ?? []
                const reqVerdict = verdictFor(results, r.key)
                const reqEffective = effectiveVerdict(reqVerdict, excItems, now)
                return <section key={r.key} className="comp-requirement">
                  <p className={r.text ? "comp-req-text" : "comp-req-text comp-scope-empty"}>{r.text || '설명 없음'}</p>
                  <div className="comp-req-head">
                    <b>{multi ? `확인사항 ${reqNumber} / ${reqs.length}` : '확인사항'}</b>
                {reqEffective && (
                  <span className={`cfg-status tl-badge${reqEffective.status === 'fail' ? ' is-failure' : ''}`}>
                    {EFFECTIVE_LABEL[reqEffective.status]}
                  </span>
                )}
                <StateBadge state={reqSt} dedicated={reqDedicated} />
                {reqVerdict?.status === 'fail' && exceptions && (
                  <button
                    type="button"
                    className="ex-btn comp-req-except-btn"
                    onClick={() =>
                      setDialog({
                        scope: 'item',
                        target: r.key,
                        label: `${framework.label} ${current.requirements.length > 1 ? r.id : current.id} ${current.title}`,
                        failFindings: reqVerdict.fail_findings,
                        existing: exceptions.byKey.get(complianceExceptionKey('item', r.key)),
                      })
                    }
                  >
                    {reqEffective?.itemException ? '예외 수정' : '예외 처리'}
                  </button>
                )}
              </div>
              {reqEffective?.status === 'excepted' && (
                <p className="comp-exception-note">
                  <span>
                    {reqEffective.itemException
                      ? `예외: ${COMPLIANCE_EXCEPTION_REASON_LABEL[reqEffective.itemException.reasonCategory]}, ${reqEffective.itemException.updatedBy}, 만료 ${formatDate(reqEffective.itemException.expiresAt)}`
                      : `위반 점검 ${reqEffective.covered.length}개 모두 예외`}
                  </span>
                  <button type="button" className="cfg-link" onClick={() => { window.location.hash = '#compliance?view=exceptions' }}>
                    예외 목록에서 보기
                  </button>
                </p>
              )}
              {reqEffective?.itemException && reqEffective.status === 'fail' && (
                <p className="comp-exception-note is-fail">
                  <span>예외 등록 뒤 새 위반 점검 {reqEffective.uncovered.length}개</span>
                </p>
              )}
              {r.tier === 'evidence' && r.tierReason && <p className="comp-scope-type-note">근거 제공: {r.tierReason}</p>}
              {requirementExtras?.(r)}
              {r.tier !== 'exclude' && (
                <TypeScopeTargets
                  itemKey={r.key}
                  graph={graph}
                  ms={reqMatches}
                  onOpenObject={onOpenObject}
                  exceptedFindings={exceptions ? new Set(reqEffective?.covered ?? []) : undefined}
                  onExceptCheck={exceptions ? f => setDialog({
                    scope: 'check',
                    target: f.id,
                    label: f.text,
                    failFindings: [f.id],
                    existing: exceptions.byKey.get(complianceExceptionKey('check', f.id)),
                    linkedCount: complianceForFinding(f.id).length,
                  }) : undefined}
                />
              )}
              {r.tier !== 'exclude' && r.companyInput.length > 0 && (
                <section className="comp-related">
                  <header><h5>회사 확인 필요</h5></header>
                  <ul className="comp-related-list">
                    {r.companyInput.map(inp => <li key={inp}>{inp}</li>)}
                  </ul>
                </section>
              )}
              {r.tier !== 'exclude' && <GuidanceSections itemKey={r.key} />}
              {(() => {
                const reqFixes = results?.compliance?.fixes?.filter(f => f.items.includes(r.key)) ?? []
                if (reqFixes.length === 0) return null
                return (
                  <section className="comp-fixes" aria-label="조치 순서">
                    <header><h5>조치 순서 {reqFixes.length}건</h5></header>
                    <ol className="comp-fixes-list">
                      {reqFixes.map(fix => {
                        const fObj = results?.findings.find(f => f.id === fix.finding)
                        const rem = remediationFor(fix.finding)
                        const title = fObj ? fObj.text : fix.finding
                        const provider = fObj?.provider ?? fix.finding.split('-')[0]
                        const otherItems = fix.items.length > 1 ? fix.items.length - 1 : 0
                        return (
                          <li key={fix.finding} className="comp-fix-row">
                            <div className="comp-fix-main">
                              <span className="comp-fix-title">{title}</span>
                              {rem?.summary ? <span className="comp-fix-summary">{rem.summary}</span> : null}
                              {otherItems > 0 ? <span className="comp-fix-others">같이 풀리는 항목 {otherItems}개</span> : null}
                            </div>
                            <button
                              type="button"
                              className="cfg-link comp-fix-link"
                              onClick={() => { window.location.hash = configThreatHash(provider, fix.finding) }}
                            >
                              설정 위반 상세 보기
                            </button>
                          </li>
                        )
                      })}
                    </ol>
                  </section>
                )
              })()}
              </section>
              })}
            </>
          })()}
          <section className="comp-requirement">
            <div className="comp-req-head"><b>연결 기준</b></div>
            {current.related.length > 0 ? (
              <ul className="comp-iso-requirements">
                {current.related.map(rel => (
                  <li key={`${rel.framework}:${rel.id}`}>
                    <button
                      type="button"
                      className="cfg-link"
                      onClick={() => { window.location.hash = `#compliance?framework=${rel.framework}&criterion=${rel.id}` }}
                    >
                      {FRAMEWORK_LABEL[rel.framework]} {rel.id}
                    </button>
                    <span>{rel.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="comp-scope-empty">연결된 다른 기준 없음</p>
            )}
          </section>
          {controlExtras?.(current)}
        </div>
      </article>}
    </div>
    {dialog && exceptions && (
      <ComplianceExceptionDialog
        scope={dialog.scope}
        target={dialog.target}
        label={dialog.label}
        failFindings={dialog.failFindings}
        existing={dialog.existing}
        linkedCount={dialog.linkedCount}
        onSubmit={exceptions.save}
        onClose={() => setDialog(null)}
      />
    )}
  </section>
}
