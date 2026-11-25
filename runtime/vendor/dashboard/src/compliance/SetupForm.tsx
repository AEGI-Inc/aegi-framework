import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { GraphStoreV2 } from '../model/graph'
import { objectLabel, objectTypeLabel } from '../blast-radius/blastLabels'
import { providerName } from '../findings/providers'
import type { OfficialItem } from './catalog'
import type { ComplianceDraft } from './complianceClient'

export default function SetupForm({graph,snapshotId,localData,draft,items,onChange,onOpenObject}:{graph:GraphStoreV2;snapshotId?:string;localData:boolean;draft:ComplianceDraft;items:OfficialItem[];onChange:(patch:Partial<ComplianceDraft>)=>void;onOpenObject:(key:string)=>void}) {
  const [search,setSearch]=useState(''),[provider,setProvider]=useState('')
  const objects=useMemo(()=>[...graph.objectsByKey.values()].sort((a,b)=>objectLabel(a.fixture_key,graph).localeCompare(objectLabel(b.fixture_key,graph),'ko')),[graph])
  const tenants=objects.filter(o=>o.canonical.interfaces.includes('Tenant'))
  const targets=objects.filter(o=>(!provider||o.canonical.provider===provider)&&(!search||`${objectLabel(o.fixture_key,graph)} ${o.fixture_key}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())))
  return <div className="cp-setup">
    <section className="cp-panel"><header><h2>검사 대상</h2><span className="cp-status tl-badge">{localData?'로컬 데이터, 운영 검사 아님':'현재 수집 데이터'}</span></header><div className="cp-panel-body">
      <div className="cp-form-grid"><label>회사명<input value={draft.company} maxLength={200} onChange={e=>onChange({company:e.target.value})}/></label><label>검사할 조직<select value={draft.tenantKey} onChange={e=>onChange({tenantKey:e.target.value})}><option value="">조직 선택</option>{tenants.map(o=><option key={o.fixture_key} value={o.fixture_key}>{providerName(o.canonical.provider)} / {objectLabel(o.fixture_key,graph)}</option>)}</select></label><label>검사 기준일<input type="date" value={draft.asOf} onChange={e=>onChange({asOf:e.target.value})}/></label><label>수집 시점 ID<input value={snapshotId??draft.snapshotId} readOnly={!!snapshotId} placeholder="검사 서버가 확정할 수집 시점 ID" maxLength={240} onChange={e=>onChange({snapshotId:e.target.value})}/></label></div>
      <h3>객체 직접 선택</h3><div className="cp-filters"><label className="cp-search"><Search size={16}/><input aria-label="검사 대상 검색" placeholder="객체 이름이나 식별자 검색" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="대상 SaaS 선택" value={provider} onChange={e=>setProvider(e.target.value)}><option value="">전체 SaaS</option>{[...new Set(objects.map(o=>o.canonical.provider))].map(p=><option key={p} value={p}>{providerName(p)}</option>)}</select></div>
      {draft.targetKeys.length>0&&<div className="cp-picked-targets"><h4>선택 대상 {draft.targetKeys.length}개</h4>{draft.targetKeys.map(key=><div key={key}><button className="cp-text-button" disabled={!graph.objectsByKey.has(key)} onClick={()=>onOpenObject(key)}>{graph.objectsByKey.has(key)?objectLabel(key,graph):`${key}, 현재 데이터에 없음`}</button><button className="cp-icon-button" aria-label={`${key} 대상 선택 해제`} onClick={()=>onChange({targetKeys:draft.targetKeys.filter(k=>k!==key)})}><X size={15}/></button></div>)}</div>}
      <div className="cp-targets">{targets.slice(0,40).map(o=><label key={o.fixture_key}><input type="checkbox" checked={draft.targetKeys.includes(o.fixture_key)} onChange={()=>onChange({targetKeys:draft.targetKeys.includes(o.fixture_key)?draft.targetKeys.filter(k=>k!==o.fixture_key):[...draft.targetKeys,o.fixture_key]})}/><span><strong>{objectLabel(o.fixture_key,graph)}</strong><span>{objectTypeLabel(o.fixture_key,graph)}</span></span></label>)}{!targets.length&&<p>조건에 맞는 객체가 없습니다.</p>}</div>{targets.length>40&&<p>검색 결과 {targets.length}개 중 40개를 표시합니다. 검색어나 SaaS로 범위를 좁히세요.</p>}
    </div></section>
    <section className="cp-panel"><header><h2>회사 기준과 적용 근거</h2></header><div className="cp-panel-body">{items.map(item=><section className="cp-input-item" key={item.id}><h3>{item.number} {item.title}</h3>{item.questions.filter(q=>draft.questionIds.includes(q.id)).map(q=><div className="cp-input-question" key={q.id}><label htmlFor={`input-${q.id}`}><strong>{q.location}</strong><span className="cp-question-prompt">{q.question}</span></label><details><summary>입력할 정보 확인</summary><ul>{q.inputs.map((text,i)=><li key={i}>{text}</li>)}</ul></details><textarea id={`input-${q.id}`} rows={3} maxLength={6000} value={draft.companyInputs[q.id]??''} placeholder="검사할 범위, 회사 기준, 적용 근거와 유효기간, 해당하는 예외를 작성하세요." onChange={e=>onChange({companyInputs:{...draft.companyInputs,[q.id]:e.target.value}})}/></div>)}</section>)}</div></section>
  </div>
}
