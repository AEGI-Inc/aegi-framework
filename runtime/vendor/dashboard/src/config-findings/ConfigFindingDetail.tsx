import { Waypoints } from 'lucide-react'
import { DetailButton, DetailCrumb, DetailGroup, DetailPager } from '../ui/DetailBar'
import type { ReactNode } from 'react'
import type { GraphStoreV2 } from '../model/graph'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId, providerName } from '../findings/providers'
import { scenarioTag, tagClass } from '../findings/scenarioTags'
import { severityClass, severityLabel } from '../findings/severity'
import type { Severity } from '../findings/severity'
import { objectLabel } from '../blast-radius/blastLabels'
import { complianceForFinding, complianceHash } from '../compliance/findingCompliance'
import { remediationFor } from '../compliance/remediations'
import RemediationCardBody from './RemediationCardBody'
import { STATUS_LABEL, statusClass, uniqueTargets } from './standardItem'
import type { Finding, Item, ItemStatus } from './standardResultsStore'
import './configFindings.css'

/** 값 표시. 목록은 쉼표로 잇고 그 밖은 JSON 그대로 */
const show = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) && v.every(x => typeof x === 'string') ? v.join(', ') : JSON.stringify(v))
const isItemStatus = (s: string): s is ItemStatus => s in STATUS_LABEL
const ruleKey = (i: Item) => JSON.stringify([i.rule.source, i.rule.field, i.rule.condition, i.rule.combine])

/** 대상 한 줄. 기준마다 같은 대상의 값과 판정을 모은다 */
interface TargetRow {
  key: string
  name: string
  status: ItemStatus | string
  values: { standard: string; value: string; fail?: boolean }[]
  thresholds: { standard: string; value: string }[]
}

/** 기준마다 같으면 값 하나, 다르면 기준 이름을 붙여 줄마다 */
function PerStandard({ list }: { list: { standard: string; value: string; fail?: boolean }[] }) {
  if (list.length === 0) return null
  if (new Set(list.map(v => v.value)).size === 1) return <span className={list.some(v => v.fail) ? 'is-fail' : undefined}>{list[0].value}</span>
  return <>{list.map(v => <span key={v.standard} className={`cfgd-per-std ${v.fail ? 'is-fail' : ''}`}><b>{v.standard}</b> {v.value}</span>)}</>
}

function targetRows(items: Item[]): TargetRow[] {
  const rows = new Map<string, TargetRow & { statuses: string[] }>()
  for (const item of items) for (const t of item.targets) {
    const row = rows.get(t.key) ?? { key: t.key, name: t.name, status: t.status, values: [], thresholds: [], statuses: [] }
    row.values.push({ standard: item.standard, value: show(t.value), fail: t.status === 'fail' })
    if (item.threshold) row.thresholds.push({ standard: item.standard, value: item.threshold })
    row.statuses.push(t.status)
    rows.set(t.key, row)
  }
  /* 기준 하나라도 위반이면 위반, 모두 충족이면 충족. 그 밖은 첫 판정 */
  const list = [...rows.values()].map(({ statuses, ...row }) => ({
    ...row,
    status: statuses.includes('fail') ? 'fail' : statuses.every(s => s === 'pass') ? 'pass' : statuses[0],
  }))
  return list.sort((a, b) => Number(b.status === 'fail') - Number(a.status === 'fail'))
}

function StatusBadge({ status }: { status: string }) {
  return isItemStatus(status) ? <span className={statusClass(status)}>{STATUS_LABEL[status]}</span> : <span className="cfg-status tl-badge">{status}</span>
}

/**
 * Threat 목록의 설정 행 상세. 기준별 판정 이력의 finding 을 그대로 읽어 보인다. 판정은 하지 않는다.
 * 순서: 머리(심각도, 분류, 요약), 처리 상태, 현재 값과 기준(대상별), 기준별 판정, 판정 근거, ISMS-P.
 */
export default function ConfigFindingDetail({ finding, graph, severity, generatedAt, pager, handlingSlot, backLabel, onBack, onSelectObject, onOpenEvents }: {
  finding: Finding
  graph: GraphStoreV2
  /** 위협 목록 설정 행과 같은 심각도(threatRows.configRows) */
  severity?: Severity
  /** 판정 시각(기준별 판정 이력의 generated_at) */
  generatedAt?: string
  pager?: { index: number; total: number; onPrev?: () => void; onNext?: () => void }
  handlingSlot?: ReactNode
  backLabel: string
  onBack: () => void
  onSelectObject: (objectKey: string) => void
  onOpenEvents: (findingId: string, itemId: string) => void
}) {
  const failItems = finding.items.filter(i => i.status === 'fail')
  /* 그래프로는 위반 대상부터 연다 */
  const targets = uniqueTargets(finding.items)
  const graphTarget = uniqueTargets(failItems).find(t => graph.objectsByKey.has(t.key)) ?? targets.find(t => graph.objectsByKey.has(t.key))
  const rows = targetRows(finding.items)
  const failTargets = rows.filter(r => r.status === 'fail').length
  const compliance = complianceForFinding(finding.id)
  const remediation = remediationFor(finding.id)
  const tag = scenarioTag('config_gap')
  /* 판정 근거는 기준끼리 규칙이 같으면 한 줄로 */
  const sameRule = new Set(finding.items.map(ruleKey)).size === 1
  const ruleRows = sameRule ? [{ standards: finding.items.map(i => i.standard), item: finding.items[0] }] : finding.items.map(i => ({ standards: [i.standard], item: i }))
  const notes = finding.items.filter(i => i.note)
  const sameNote = new Set(notes.map(i => i.note)).size === 1
  const layer = [finding.layer, finding.group].filter(Boolean).join(', ')

  return (
    <main className="finding-detail-workbench cfg-detail">
      <div className="page-title-bar page-title-bar-inset">
        <DetailCrumb back={backLabel} onBack={onBack} title="설정 위반 상세" meta={finding.id} />
        <div className="page-head-actions">
          {pager && pager.total > 1 && <DetailPager index={pager.index} total={pager.total} unit="설정 위반" onPrev={pager.onPrev} onNext={pager.onNext} />}
          {graphTarget && (
            <DetailGroup label="설정 위반 작업">
              <DetailButton label="Cross-SaaS Graph" icon={<Waypoints size={15} strokeWidth={2} aria-hidden="true" />} onClick={() => onSelectObject(graphTarget.key)} />
            </DetailGroup>
          )}
        </div>
      </div>

      <header className="finding-detail-header">
        <div className="fd-header-meta">
          <div className="fd-tags-row">
            {/* 심각도는 늘 분류 앞에 둔다 */}
            {severity && <span className={`fn-severity-badge ${severityClass(severity)}`}>{severityLabel(severity)}</span>}
            <span className={`scenario-tag-badge lg ${tagClass('config_gap')}`} title={tag.description}>{tag.label}</span>
          </div>
          <h2 className="fd-title cfgd-title">
            <ProviderLogo provider={providerLogoId(finding.provider)} />
            {finding.text}
          </h2>
          <dl className="cfgd-facts">
            <div><dt>SaaS</dt><dd>{providerName(finding.provider)}</dd></div>
            {layer && <div><dt>분류</dt><dd>{layer}</dd></div>}
            <div><dt>위반 기준</dt><dd>{failItems.length} / {finding.items.length}</dd></div>
            {rows.length > 0 && <div><dt>위반 대상</dt><dd>{failTargets} / {rows.length}</dd></div>}
            {generatedAt && <div><dt>판정</dt><dd>{generatedAt.slice(0, 10)}</dd></div>}
          </dl>
        </div>
      </header>

      {handlingSlot}

      {rows.length > 0 && (
        <section className="cfgd-card" aria-label="현재 값과 기준">
          <div className="cfgd-head"><h3>현재 값과 기준</h3><span>위반 대상 {failTargets} / {rows.length}</span></div>
          <div className="cfgd-scroll"><table className="cfgd-table">
            <thead><tr><th className="cfgd-col-target">대상</th><th className="cfgd-col-value">현재 값</th><th>기준값</th><th className="cfgd-col-status">판정</th><th className="cfgd-col-act">조사</th></tr></thead>
            <tbody>
              {rows.map(r => {
                const inGraph = graph.objectsByKey.has(r.key)
                return (
                  <tr key={r.key}>
                    <td className="cfgd-target" title={r.key}>{inGraph ? objectLabel(r.key, graph) : r.name}</td>
                    <td className="cfgd-value">
                      <PerStandard list={r.values} />
                    </td>
                    <td><PerStandard list={r.thresholds} /></td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>{inGraph ? <button type="button" className="cfgd-link" onClick={() => onSelectObject(r.key)}>그래프에서 보기</button> : '그래프에 없음'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table></div>
        </section>
      )}

      <section className="cfgd-card" aria-label="기준별 판정">
        <div className="cfgd-head"><h3>기준별 판정</h3><span>위반 {failItems.length} / {finding.items.length}</span></div>
        <div className="cfgd-scroll"><table className="cfgd-table">
          <thead><tr><th className="cfgd-col-status">판정</th><th>기준</th><th>항목</th><th>요구 사항</th><th>기준값</th><th className="cfgd-col-act">조사</th></tr></thead>
          <tbody>
            {finding.items.map(i => (
              <tr key={`${i.standard}:${i.item_id}`}>
                <td><StatusBadge status={i.status} /></td>
                <td><b>{i.standard}</b></td>
                <td>{i.item_id}</td>
                <td>{i.title}</td>
                <td>{i.threshold}</td>
                <td>
                  {i.targets.some(t => t.in_graph && graph.objectsByKey.has(t.key)) && (
                    <button type="button" className="cfgd-link" onClick={() => onOpenEvents(finding.id, i.item_id)}>이벤트로 조사</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>

      <section className="cfgd-card" aria-label="판정 근거">
        <div className="cfgd-head"><h3>판정 근거</h3></div>
        <div className="cfgd-scroll"><table className="cfgd-table">
          <thead><tr><th>기준</th><th>수집 호출</th><th>필드</th><th>조건</th><th>결합 방식</th></tr></thead>
          <tbody>
            {ruleRows.map(({ standards, item }) => (
              <tr key={standards.join('|')}>
                <td>{standards.map(s => <b key={s} className="cfgd-std">{s}</b>)}</td>
                <td>{item.rule.source}</td>
                <td>{item.rule.field}</td>
                <td>{item.rule.condition}</td>
                <td>{item.rule.combine}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {notes.length > 0 && (
          <ul className="cfgd-notes">
            {sameNote
              ? <li>{notes[0].note}</li>
              : notes.map(i => <li key={`${i.standard}:${i.item_id}`}><b>{i.standard}</b> {i.note}</li>)}
          </ul>
        )}
      </section>

      {remediation && (
        <section className="cfgd-card" aria-label="조치 방법">
          <div className="cfgd-head">
            <h3>조치 방법</h3>
            <span className="cfg-status tl-badge">{remediation.review}</span>
          </div>
          <RemediationCardBody remediation={remediation} />
        </section>
      )}

      {compliance.length > 0 && (
        <section className="cfgd-card" aria-label="관련 컴플라이언스 항목">
          <div className="cfgd-head"><h3>관련 컴플라이언스 항목</h3><span>{compliance.length}개</span></div>
          <ul className="cfgd-compliance">
            {compliance.map(r => (
              <li key={`${r.framework}:${r.controlId}`}>
                <b>{r.label}</b>
                <button type="button" className="cfg-link" onClick={() => { window.location.hash = complianceHash(r) }}>{r.controlId} {r.title}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
