import type { Finding, Item, StandardResults } from '../config-findings/standardResultsStore'
import { LABEL, Legend, type Match, ResultBar, unique } from './complianceOverviewShared'
import AdminAuthCheck from '../config-findings/AdminAuthCheck'
import AdminPrivilegeAlertCheck from '../config-findings/AdminPrivilegeAlertCheck'
import type { GraphStoreV2 } from '../model/graph'
import CustomCriteriaPanel, { useCustomCriteria } from './CustomCriteriaPanel'
import { CHECK_STATUS_LABEL, describeCondition, evaluateCheck } from './customCriteria'
import ComplianceDemoTour from './ComplianceDemoTour'
import { isDemoMode } from '../demoMode'
import { requirementMatches } from './controlStatus'
import { buildFramework } from './frameworkModel'
import FrameworkView from './FrameworkView'
import type { ComplianceExceptionsApi } from './useComplianceExceptions'

function CriteriaCompare({ criterion, ms, graph }: { criterion: string; ms: Match[]; graph: GraphStoreV2 }) {
  const list = useCustomCriteria().filter(c => c.criterion === criterion)
  if (!list.length) return null
  const keyOf = (finding: string, standard: string, item: string) => `${finding}:${standard}:${item}`
  const pairs = list.flatMap(c => c.checks.map(check => {
    const r = evaluateCheck(graph, check), rep = check.replaces
    const before = rep ? ms.find(m => keyOf(m.f.id, m.item.standard, m.item.item_id) === keyOf(rep.finding, rep.standard, rep.item)) : undefined
    return { c, check, r, before }
  }))
  const replaced = new Set(pairs.flatMap(p => p.check.replaces ? [keyOf(p.check.replaces.finding, p.check.replaces.standard, p.check.replaces.item)] : []))
  const added: Match[] = pairs.map(p => ({ key: `custom:${p.check.id}`, f: { id: p.check.id, provider: p.check.provider, text: p.check.question } as Finding,
    item: { status: p.r.status, standard: p.c.name, item_id: '' } as Item, limit: '' }))
  const after = [...ms.filter(m => !replaced.has(keyOf(m.f.id, m.item.standard, m.item.item_id))), ...added]
  const side = (title: string, sub: string, xs: Match[]) => <section className="comp-related comp-compare-col">
    <header><h5>{title}</h5><span className="comp-compare-sub">{sub}</span><Legend ms={xs} /></header>
    <div className="comp-related-bar"><ResultBar ms={xs} size="lg" /></div>
  </section>
  const badge = (status: string, label: string) => <span className={`cfg-status tl-badge${status === 'fail' ? ' is-failure' : ''}`}>{label}</span>
  return <section className="comp-requirement comp-compare" aria-label="기준 비교">
    <div className="comp-req-head"><b>기준 비교</b>{list.some(c => c.status === 'draft') && <span className="comp-state is-draft"><b>AI 초안</b><span>포함</span></span>}</div>
    <div className="comp-compare-grid">
      {side('현행 기준', `연결된 공개 기준 점검 ${ms.length}개`, ms)}
      {side('추가 기준 적용 후', `바뀐 점검 ${replaced.size}개, 새 점검 ${pairs.length - replaced.size}개`, after)}
    </div>
    <section className="comp-related comp-compare-changes">
      <header><h5>바뀐 점검 {pairs.length}개</h5></header>
      <div className="comp-compare-row is-head"><span>현행 기준</span><span>추가 기준 적용 후</span></div>
      <ol className="comp-compare-rows">{pairs.map(p => <li key={p.check.id} className="comp-compare-row">
        <span>{p.check.replaces
          ? <>{badge(p.before?.item.status ?? '', p.before ? LABEL[p.before.item.status] : '결과 없음')}<strong>{p.before?.f.text ?? p.check.replaces.finding}</strong>
            <small>{p.check.replaces.standard} {p.check.replaces.item}, 요구 {p.check.replaces.condition || '없음'}</small></>
          : <small>현행 기준에 없는 새 점검</small>}</span>
        <span>{badge(p.r.status, CHECK_STATUS_LABEL[p.r.status])}<strong>{p.check.question}</strong>
          <small>요구 {describeCondition(p.check)}, 대상 {p.r.targets.length}개 중 충족 {p.r.targets.filter(t => t.passed).length}개</small></span>
      </li>)}</ol>
    </section>
  </section>
}

export function IsmsOverview({ results, graph, snapshotId, onOpenObject, exceptions }: { results: StandardResults | undefined; graph: GraphStoreV2; snapshotId?: string; onOpenObject?: (key: string) => void; exceptions?: ComplianceExceptionsApi }) {
  const custom = useCustomCriteria()
  return <FrameworkView
    framework={buildFramework('isms-p')}
    results={results}
    graph={graph}
    onOpenObject={onOpenObject}
    exceptions={exceptions}
    head={isDemoMode() ? <ComplianceDemoTour graph={graph} /> : undefined}
    rowExtras={control => {
      const mine = custom.filter(c => c.criterion === control.id)
      return mine.length ? <span className={`comp-state ${mine.some(c => c.status === 'draft') ? 'is-draft' : 'is-ready'}`}><b>추가 기준</b><span>{mine.length}개{mine.some(c => c.status === 'draft') ? ', 초안' : ''}</span></span> : null
    }}
    requirementExtras={req => <>
      {req.id === '2.10.2-03' && <AdminAuthCheck graph={graph} snapshotId={snapshotId} />}
      {req.id === '2.11.3-01' && <AdminPrivilegeAlertCheck graph={graph} snapshotId={snapshotId} />}
    </>}
    controlExtras={control => <>
      <CriteriaCompare criterion={control.id} ms={unique(control.requirements.flatMap(r => requirementMatches(results, r)))} graph={graph} />
      <CustomCriteriaPanel criterion={control.id} graph={graph} onOpenObject={onOpenObject} />
    </>}
  />
}
