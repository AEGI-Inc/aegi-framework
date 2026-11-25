import { useCallback, useEffect, useRef, useState } from 'react'
import type { GraphStoreV2 } from '../model/graph'
import { objectLabel } from '../blast-radius/blastLabels'
import { utcTitle } from '../utils/time'
import { checkTime, connectionLabel, labelOf, rememberFocus, statusBadge } from './adminCheckParts'
import { isPublicDemo } from '../publicDemo'
import { demoComplianceApi } from '../compliance/browserCheckRuns'

type Condition = {name:string; status:string; value:string | boolean | null; expected:string | boolean}
type Entry = {target?:string; status:string; observed_at?:string | null; conditions:Condition[]; common_status?:string; common_conditions?:Condition[]; message?:string; references?:{source:string;status:string;scope:string;conditions:Condition[]}[]}
type Result = {criterion:string; source:string; scope:string; gws:Entry[]; other_saas:string; other_providers?:{name:string;status:string;reason:string}[]}
type Run = {id:string; created_at:string; snapshot:string; status?:string; result:Result | null}
type History = {id:string; created_at:string}[]
const check = 'admin_privilege_alert'
const COMMON = '규칙 활성화와 수신 대상 존재'
const val = (v:string|boolean|null) => v === null ? '값 확인 불가' : typeof v === 'boolean' ? v ? '예' : '아니요' : v
/* 공개 데모(demo.aegi.site)는 검사 서버가 없어 같은 검사를 브라우저에서 돌린다(src/compliance/browserCheckRuns.ts). 화면이 그려질 때 그래프를 건넨다 */
let demoGraph: { graph: GraphStoreV2; snapshotId?: string } | null = null
async function api<T>(path:string, body?:object):Promise<T> {
  if (demoGraph) return demoComplianceApi<T>(path, body, demoGraph.graph, demoGraph.snapshotId)
  const response=await fetch(`${import.meta.env.DEV ? '/api/compliance' : '/api/measured/compliance'}${path}`,body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : undefined)
  if(!response.ok) throw new Error('request failed')
  return response.json() as Promise<T>
}
/* 같은 탭에서 다른 화면에 다녀와도 고른 검사 기록을 잇는다 */
let lastRunId = ''

export default function AdminPrivilegeAlertCheck({graph,snapshotId}:{graph:GraphStoreV2;snapshotId?:string}) {
  demoGraph = isPublicDemo() ? { graph, snapshotId } : null
  const [history,setHistory]=useState<History>([]),[selected,setSelected]=useState<Run|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[connected,setConnected]=useState(true),[error,setError]=useState(''),[act,setAct]=useState('')
  const control=useRef<HTMLElement|null>(null)
  const load=useCallback(async()=>{const h=await api<{runs:History}>(`/runs?check=${check}`);setHistory(h.runs);const pick=h.runs.find(r=>r.id===lastRunId)??h.runs[0];if(pick)setSelected(await api<Run>(`/runs/${encodeURIComponent(pick.id)}`))},[])
  useEffect(()=>{void load().catch(()=>setConnected(false)).finally(()=>setLoading(false))},[load])
  useEffect(()=>{if(selected)lastRunId=selected.id},[selected])
  useEffect(()=>{if(!busy)rememberFocus(control)},[busy])
  const start=(target:HTMLElement,label:string)=>{control.current=target;setAct(label);setBusy(true);setError('');setConnected(true)}
  async function execute(target:HTMLElement){start(target,'검사 요청 중');try{const queued=await api<Run>('/runs',import.meta.env.DEV?{check}:{check,policy:{}});setSelected(queued.status==='pending'?await api<Run>(`/runs/${encodeURIComponent(queued.id)}`):queued);const h=await api<{runs:History}>(`/runs?check=${check}`);setHistory(h.runs)}catch{setError('검사를 실행하지 못했습니다.')}finally{setBusy(false)}}
  async function select(id:string,target:HTMLElement){if(!id)return;start(target,'불러오는 중');try{setSelected(await api<Run>(`/runs/${encodeURIComponent(id)}`))}catch{setError('검사 기록을 불러오지 못했습니다.')}finally{setBusy(false)}}
  const running=selected?.status==='pending'||selected?.status==='running'
  const result=selected?.result
  return <section className="cfg-admin-check" aria-label="관리자 권한 부여 경고 검사" aria-busy={busy||loading}>
    <div className="cfg-admin-head"><h3>관리자 권한 부여 경고 설정</h3>{!connected && <span className="tl-badge">{connectionLabel()}</span>}</div>
    <p>관리자 권한이 부여될 때 경고하도록 설정되어 있는지 확인합니다.</p>
    <div className="cfg-admin-actions"><div /><div>
      {(busy||loading) && <span className="cfg-admin-busy" role="status">{busy?act:'불러오는 중'}</span>}
      {error && <span className="cfg-admin-error" role="alert">{error}</span>}
      {history.length>0 && <label>검사 기록 <select className="ex-select" value={selected?.id??''} onChange={e=>void select(e.target.value,e.currentTarget)} disabled={busy}>{history.map(r=><option key={r.id} value={r.id}>{checkTime(r.created_at)}</option>)}</select></label>}
      {selected && <button type="button" className="ex-btn" onClick={e=>void select(selected.id,e.currentTarget)} disabled={busy}>결과 새로고침</button>}
      <button type="button" className="ex-btn cfg-admin-primary" onClick={e=>void execute(e.currentTarget)} disabled={busy}>검사 실행</button>
    </div></div>
    {selected && <p className="cfg-admin-meta">{running && <span className="tl-badge">진행 중</span>}{selected.status==='failed' && <span className="tl-badge">실패</span>}<span>검사 시각 <b title={utcTitle(selected.created_at)}>{checkTime(selected.created_at)}</b></span>{result && <span>공통 기준 <b>{COMMON}</b></span>}</p>}
    {running && <p role="status">검사 진행 중. 결과 새로고침을 눌러 확인하세요.</p>}
    {selected?.status==='failed' && <p role="alert">검사를 완료하지 못했습니다. 다시 실행해 주세요.</p>}
    {result && <div className="cfg-admin-summary">
      <div className="cfg-admin-summary-header"><h4>Google Workspace 경고 설정</h4></div>
      <div className="cfg-admin-provider-list">
        <div className="cfg-admin-list-head"><span>SaaS</span><span>결과</span><span /></div>
        {result.gws.map((entry,i)=><details className="cfg-admin-provider" key={entry.target??i} open><summary><strong>Google Workspace</strong><span className="cfg-admin-badges">{statusBadge(labelOf(entry.common_status ?? entry.status))}</span><span /></summary><div className="cfg-admin-provider-body">
          {entry.message && <p>{entry.message}</p>}
          {entry.target && <p>대상: {snapshotId===selected!.snapshot&&graph.objectsByKey.has(entry.target)?objectLabel(entry.target,graph):'관리자 권한 부여 경고 규칙'}</p>}
          <p>수집 시각: <span title={utcTitle(entry.observed_at)}>{checkTime(entry.observed_at)}</span></p>
          <p>공통 기준: {COMMON}</p>
          <div className="cfg-table-wrap"><table className="cfg-table cfg-alert-conditions"><thead><tr><th>확인 조건</th><th>실제 설정</th><th>기준</th><th>결과</th></tr></thead><tbody>{(entry.common_conditions ?? entry.conditions).map(c=><tr key={c.name}><td>{c.name}</td><td>{val(c.value)}</td><td>{val(c.expected)}</td><td>{statusBadge(labelOf(c.status))}</td></tr>)}</tbody></table></div>
          <p className="cfg-admin-source"><strong>{result.source}</strong>{statusBadge(labelOf(entry.status))}<span>포함 조건: 심각도와 전체 최고 관리자 수신</span></p>
          {entry.references?.map(reference=><div key={reference.source}><p className="cfg-admin-source"><strong>{reference.source}</strong>{statusBadge(labelOf(reference.status))}</p><p>{reference.scope}</p></div>)}
        </div></details>)}
      </div>
      <p>{result.scope}</p><p>{result.other_saas}</p>
      {result.other_providers?.length ? <div className="cfg-admin-provider-list">{result.other_providers.map(provider=><details className="cfg-admin-provider" key={provider.name}><summary><strong>{provider.name}</strong><span className="cfg-admin-badges"><span className="tl-badge">검사 경로 확인 필요</span></span><span /></summary><div className="cfg-admin-provider-body"><p>{provider.reason}</p></div></details>)}</div> : null}
      <details className="cfg-admin-more"><summary>수집 시점 ID</summary><p>{selected!.snapshot}</p></details>
    </div>}
  </section>
}
