import { useCallback, useEffect, useRef, useState } from 'react'
import type { GraphStoreV2 } from '../model/graph'
import { objectLabel } from '../blast-radius/blastLabels'
import { utcTitle } from '../utils/time'
import { checkTime, connectionLabel, labelOf, rememberFocus, statusBadge } from './adminCheckParts'
import { isPublicDemo } from '../publicDemo'
import { demoComplianceApi } from '../compliance/browserCheckRuns'

type Entry = { status?: string; message?: string; scope?: string; target?: string; enforced?: boolean | null; organization_2fa_required?: boolean | null; observed_at?: string | null; company_status?: string; basis?: string; sources?: string[] }
type Result = { gws: Entry[]; gws_coverage: string; okta: Entry; github: Entry[]; slack: Entry; salesforce: Entry; atlassian: Entry }
type Run = { id: string; created_at: string; snapshot: string; status?: 'pending' | 'running' | 'completed' | 'failed'; policy: { require_mfa?: boolean }; result: Result | null }
type HistoryEntry = Pick<Run, 'id' | 'created_at' | 'snapshot' | 'status'>
type Policy = 'default' | 'required' | 'not_required'
const policyLabel = (requireMfa?: boolean) => requireMfa === undefined ? '공개 기준' : requireMfa ? '관리자 MFA 필수' : '관리자 MFA 필수 아님'
/* 공개 데모(demo.aegi.site)는 검사 서버가 없어 같은 검사를 브라우저에서 돌린다(src/compliance/browserCheckRuns.ts). 화면이 그려질 때 그래프를 건넨다 */
let demoGraph: { graph: GraphStoreV2; snapshotId?: string } | null = null
async function api<T>(path: string, body?: object): Promise<T> {
  if (demoGraph) return demoComplianceApi<T>(path, body, demoGraph.graph, demoGraph.snapshotId)
  const response = await fetch(`${import.meta.env.DEV ? '/api/compliance' : '/api/measured/compliance'}${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  if (!response.ok) throw new Error('검사 서비스를 사용할 수 없습니다.')
  return response.json() as Promise<T>
}
/* 같은 탭에서 다른 화면에 다녀와도 고른 검사 기록을 잇는다 */
let lastRunId = ''

export default function AdminAuthCheck({ graph, snapshotId }: { graph: GraphStoreV2; snapshotId?: string }) {
  demoGraph = isPublicDemo() ? { graph, snapshotId } : null
  const [policy, setPolicy] = useState<Policy>('default')
  const [runs, setRuns] = useState<HistoryEntry[]>([])
  const [selected, setSelected] = useState<Run | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [act, setAct] = useState('')
  const [connected, setConnected] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const control = useRef<HTMLElement | null>(null)
  const refresh = useCallback(async () => {
    const [p, h] = await Promise.all([api<{ policy: { require_mfa?: boolean } }>('/policy'), api<{ runs: HistoryEntry[] }>('/runs')])
    setPolicy(p.policy.require_mfa === undefined ? 'default' : p.policy.require_mfa ? 'required' : 'not_required')
    setRuns(h.runs)
    const pick = h.runs.find(run => run.id === lastRunId) ?? h.runs[0]
    if (pick) setSelected(await api<Run>(`/runs/${encodeURIComponent(pick.id)}`))
  }, [])
  useEffect(() => { void refresh().catch(() => setConnected(false)).finally(() => setLoading(false)) }, [refresh])
  useEffect(() => { if (selected) lastRunId = selected.id }, [selected])
  useEffect(() => { if (!busy) rememberFocus(control) }, [busy])
  const start = (label: string, target: HTMLElement) => { control.current = target; setAct(label); setBusy(true); setError(''); setConnected(true) }
  async function savePolicy(target: HTMLElement) {
    start('저장 중', target); setNotice('')
    try {
      await api('/policy', policy === 'default' ? {} : { require_mfa: policy === 'required' })
      setNotice('회사 기준을 저장했습니다. 검사 실행 시 적용됩니다.')
    } catch { setError('회사 기준을 저장하지 못했습니다.') } finally { setBusy(false) }
  }
  async function runCheck(target: HTMLElement) {
    start('검사 요청 중', target); setNotice('')
    try {
      await api('/policy', policy === 'default' ? {} : { require_mfa: policy === 'required' })
      const queued = await api<Run>('/runs', import.meta.env.DEV ? { check: 'admin_auth' } : { check: 'admin_auth', policy: policy === 'default' ? {} : { require_mfa: policy === 'required' } })
      if (queued.status === 'pending' || queued.status === 'running') setSelected(await api<Run>(`/runs/${encodeURIComponent(queued.id)}`))
      else setSelected(queued)
      const history = await api<{ runs: HistoryEntry[] }>('/runs')
      setRuns(history.runs)
    } catch { setError('검사를 실행하지 못했습니다.') } finally { setBusy(false) }
  }
  async function chooseRun(id: string, target: HTMLElement) {
    if (!id) return
    start('불러오는 중', target)
    try { const run = await api<Run>(`/runs/${encodeURIComponent(id)}`); setSelected(run); if (run.result || run.status === 'failed') setNotice('') } catch { setError('검사 기록을 불러오지 못했습니다.') } finally { setBusy(false) }
  }
  const result = selected?.result
  const running = selected?.status === 'pending' || selected?.status === 'running'
  const groups: { name: string; entries: Entry[] }[] = result ? [
    { name: 'Google Workspace', entries: result.gws.length ? result.gws : [{ status: 'unknown', scope: result.gws_coverage }] },
    { name: 'Okta', entries: [result.okta] },
    { name: 'GitHub', entries: result.github.length ? result.github : [{ status: 'unknown' }] },
    { name: 'Slack', entries: [result.slack] },
    { name: 'Salesforce', entries: [result.salesforce] },
    { name: 'Atlassian', entries: [result.atlassian] },
  ] : []
  const exceptions = groups.reduce((n, group) => n + group.entries.filter(entry => entry.status === 'fail' || entry.status === 'noncompliant').length, 0)
  const companyUnknown = (group: string) => selected?.policy.require_mfa !== undefined && group !== 'Google Workspace'
  const incomplete = groups.some(group => group.entries.some(entry => !entry.status || ['unknown', 'not_collected'].includes(entry.status)) || companyUnknown(group.name))
  const summaryTitle = exceptions ? '위반 있음' : incomplete ? '일부 판정 불가' : '확인 범위 위반 없음'
  function targetLabel(key: string) {
    return snapshotId && selected?.snapshot === snapshotId && graph.objectsByKey.has(key) ? objectLabel(key, graph) : '이름 없음'
  }
  return <section className="cfg-admin-check" aria-label="관리자 인증 보호 검사" aria-busy={busy || loading}>
    <div className="cfg-admin-head"><h3>관리자 인증 보호</h3>{!connected && <span className="tl-badge">{connectionLabel()}</span>}</div>
    <div className="cfg-admin-actions">
      <div>
        <label>회사 기준 <select className="ex-select" value={policy} onChange={e => setPolicy(e.target.value as Policy)} disabled={busy}>
          <option value="default">공개 기준</option><option value="required">관리자 MFA 필수</option><option value="not_required">관리자 MFA 필수 아님</option>
        </select></label>
        <button type="button" className="ex-btn" onClick={e => void savePolicy(e.currentTarget)} disabled={busy}>회사 기준 저장</button>
      </div>
      <div>
        {(busy || loading) && <span className="cfg-admin-busy" role="status">{busy ? act : '불러오는 중'}</span>}
        {error && <span className="cfg-admin-error" role="alert">{error}</span>}
        {runs.length > 0 && <label>검사 기록 <select className="ex-select" value={selected?.id ?? ''} onChange={e => void chooseRun(e.target.value, e.currentTarget)} disabled={busy}>
          {runs.map(run => <option key={run.id} value={run.id}>{checkTime(run.created_at)}{run.status === 'pending' || run.status === 'running' ? ', 진행 중' : run.status === 'failed' ? ', 실패' : ''}</option>)}
        </select></label>}
        {selected && <button type="button" className="ex-btn" onClick={e => void chooseRun(selected.id, e.currentTarget)} disabled={busy}>결과 새로고침</button>}
        <button type="button" className="ex-btn cfg-admin-primary" onClick={e => void runCheck(e.currentTarget)} disabled={busy}>검사 실행</button>
      </div>
    </div>
    {selected && <p className="cfg-admin-meta">{running && <span className="tl-badge">진행 중</span>}{selected.status === 'failed' && <span className="tl-badge">실패</span>}<span>검사 시각 <b title={utcTitle(selected.created_at)}>{checkTime(selected.created_at)}</b></span><span>회사 기준 <b>{policyLabel(selected.policy.require_mfa)}</b></span></p>}
    {notice && <p className="cfg-admin-notice" role="status">{notice}</p>}
    {running && <p role="status">검사 진행 중. 결과 새로고침을 눌러 확인하세요.</p>}
    {selected?.status === 'failed' && <p role="alert">검사를 완료하지 못했습니다. 다시 실행해 주세요.</p>}
    {result && <div className="cfg-admin-summary">
      <div className="cfg-admin-summary-header"><h4>{summaryTitle}</h4>{exceptions > 0 && <span className="tl-badge is-failure">위반 결과 {exceptions}건</span>}</div>
      <p>수집된 설정의 일부를 확인한 결과입니다. ISMS-P 항목 전체의 이행 여부는 확인하지 않습니다.</p>
      <div className="cfg-admin-provider-list">
        <div className="cfg-admin-list-head"><span>SaaS</span><span>결과</span><span /></div>
        {groups.map(group => {
          const counts = new Map<string, number>()
          for (const entry of group.entries) { const label = labelOf(entry.status); counts.set(label, (counts.get(label) ?? 0) + 1) }
          return <details className="cfg-admin-provider" key={group.name}>
            <summary><strong>{group.name}</strong><span className="cfg-admin-badges">{[...counts].map(([label, count]) => statusBadge(label, ` ${count}건`))}</span><span>근거 보기</span></summary>
            <div className="cfg-table-wrap"><table className="cfg-table cfg-admin-evidence"><thead><tr><th>결과</th><th>대상</th><th>내용</th><th>확인 범위</th><th>수집 시각</th><th>판단 기준</th></tr></thead><tbody>{group.entries.map((entry, i) => <tr key={`${entry.target ?? 'item'}-${i}`}>
              <td>{statusBadge(labelOf(entry.status))}</td>
              <td>{entry.target && <>{targetLabel(entry.target)}<details><summary>대상 식별자</summary><code>{entry.target}</code></details></>}</td>
              <td>{entry.message ?? (entry.scope ? '' : '판정 불가')}{companyUnknown(group.name) && <div>회사 기준 적용 여부: 확인 불가</div>}</td>
              <td>{entry.scope}</td>
              <td title={utcTitle(entry.observed_at)}>{checkTime(entry.observed_at)}</td>
              <td>{[entry.basis, ...(entry.sources ?? [])].filter(Boolean).join(', ')}</td>
            </tr>)}</tbody></table></div>
          </details>
        })}
      </div>
      {incomplete && <p>일부 SaaS는 필요한 값이나 회사 기준 적용 여부를 확인하지 못했습니다. 각 SaaS의 근거에서 확인 범위를 볼 수 있습니다.</p>}
      <details className="cfg-admin-more"><summary>수집 시점 ID</summary><p>{selected.snapshot}</p></details>
    </div>}
  </section>
}
