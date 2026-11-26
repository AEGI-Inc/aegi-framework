import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronRight, FileSearch, X } from 'lucide-react'
import type { GraphStoreV2 } from '../model/graph'
import { downloadText } from '../utils/csv'
import { catalog, catalogDate, catalogRevision, type OfficialItem, type Standard } from './catalog'
import { complianceClient, type ComplianceDraft } from './complianceClient'
import ItemBrowser from './ItemBrowser'
import SetupForm from './SetupForm'
import './compliance.css'

const STORAGE_KEY='aegi.compliance.selection-drafts.v1'
const emptyDraft=(standard:Standard):ComplianceDraft=>({schemaVersion:1,standard,catalogRevision,questionIds:[],targetKeys:[],company:'',tenantKey:'',asOf:'',snapshotId:'',companyInputs:{}})
function loadDrafts():Record<Standard,ComplianceDraft> {
  const result={'ISMS-P':emptyDraft('ISMS-P'),PIPA:emptyDraft('PIPA')}
  try {
    const stored=JSON.parse(localStorage.getItem(STORAGE_KEY)??'null')
    for(const standard of ['ISMS-P','PIPA'] as const) {
      const d=stored?.[standard],ids=new Set(catalog.filter(i=>i.standard===standard).flatMap(i=>i.questions.map(q=>q.id)))
      if(d?.schemaVersion===1&&d.catalogRevision===catalogRevision&&d.standard===standard&&Array.isArray(d.questionIds)&&Array.isArray(d.targetKeys)&&d.targetKeys.every((x:unknown)=>typeof x==='string')&&['company','tenantKey','asOf','snapshotId'].every(k=>typeof d[k]==='string')&&d.companyInputs&&typeof d.companyInputs==='object'&&!Array.isArray(d.companyInputs)&&Object.values(d.companyInputs).every(x=>typeof x==='string')) result[standard]={...emptyDraft(standard),...d,questionIds:d.questionIds.filter((id:unknown)=>typeof id==='string'&&ids.has(id))}
    }
  } catch { /* Invalid browser drafts do not block catalog browsing. */ }
  return result
}
function route() {
  const p=new URLSearchParams(window.location.hash.split('?')[1])
  return {standard:(p.get('standard')==='pipa'?'PIPA':'ISMS-P') as Standard,view:p.get('view')==='runs'?'runs':'new',step:['targets','review'].includes(p.get('step')??'')?p.get('step')!:'items',item:p.get('item')??''}
}
const initialItem=(standard:Standard)=>catalog.find(i=>i.standard===standard&&(standard==='ISMS-P'?i.number==='2.5.1':i.id.includes('admin-73493:article-5')))??catalog.find(i=>i.standard===standard&&i.questions.length)!
// 같은 탭에서 다른 화면에 다녀와도 저장 전 선택과 입력을 잇는다. 새로고침하면 비어 마지막 초안 저장본을 읽는다
let workingDrafts:Record<Standard,ComplianceDraft>|null=null

export default function CompliancePage({graph,snapshotId,localData,onOpenObject,onBack}:{graph:GraphStoreV2;snapshotId?:string;localData:boolean;onOpenObject:(key:string)=>void;onBack?:()=>void}) {
  const [location,setLocation]=useState(route),[drafts,setDrafts]=useState(()=>workingDrafts??loadDrafts()),[notice,setNotice]=useState(''),[history,setHistory]=useState(''),[excluded,setExcluded]=useState<OfficialItem[]>([])
  const standard=location.standard,draft=drafts[standard],selected=new Set(draft.questionIds)
  const items=[...catalog,...excluded].filter(i=>i.standard===standard),current=items.find(i=>i.id===location.item)??initialItem(standard)
  const pickedItems=items.filter(i=>i.questions.some(q=>selected.has(q.id))),pickedQuestions=pickedItems.flatMap(i=>i.questions.filter(q=>selected.has(q.id)))
  const pickedCount=(s:Standard)=>{const ids=new Set(drafts[s].questionIds);return [...catalog,...excluded].filter(i=>i.standard===s&&i.questions.some(q=>ids.has(q.id))).length}
  const setDraft=(patch:Partial<ComplianceDraft>)=>setDrafts(previous=>({...previous,[standard]:{...previous[standard],...patch}}))
  const go=(patch:Partial<ReturnType<typeof route>>)=>{
    const next={...location,...patch},p=new URLSearchParams({standard:next.standard==='PIPA'?'pipa':'isms-p'})
    if(next.view==='runs')p.set('view','runs');else if(next.step!=='items')p.set('step',next.step)
    if(next.item)p.set('item',next.item)
    // 항목이나 기준 체계만 바뀌면 기록을 쌓지 않는다. history.state 를 넘겨 backNav 표시를 지키고, hashchange 가 없으니 직접 맞춘다
    if(next.view===location.view&&next.step===location.step){window.history.replaceState(window.history.state,'',`#compliance?${p}`);setLocation(route())}
    else window.location.hash=`#compliance?${p}`
  }
  useEffect(()=>{workingDrafts=drafts},[drafts])
  // 단계나 보기가 바뀌면 그 패널 첫 제목으로 포커스를 옮긴다. 처음 열 때는 옮기지 않는다
  const stepShown=useRef(`${location.view}:${location.step}`)
  useEffect(()=>{const key=`${location.view}:${location.step}`;if(stepShown.current===key)return;stepShown.current=key;const h=document.querySelector<HTMLElement>('.cp-content .cp-browser h2,.cp-content .cp-setup h2,.cp-content .cp-review h2,.cp-content .cp-empty h2');if(h){h.tabIndex=-1;h.focus({preventScroll:true})}},[location.view,location.step])
  useEffect(()=>{const sync=()=>setLocation(route());window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync)},[])
  useEffect(()=>{
    if(location.view!=='runs')return
    let active=true;setHistory('검사 기록을 확인하고 있습니다.')
    complianceClient.listRuns().then(value=>{if(active)setHistory(value.state==='not_connected'?value.message:value.runs.length?`${value.runs.length}개 기록`:'실행한 검사가 없습니다.')}).catch(()=>{if(active)setHistory('검사 기록을 불러오지 못했습니다. 기록이 없는 것으로 해석하지 마세요.')})
    return()=>{active=false}
  },[location.view])
  const toggleItem=(item:OfficialItem)=>{const ids=item.questions.map(q=>q.id),next=new Set(selected);if(ids.every(id=>next.has(id)))ids.forEach(id=>next.delete(id));else ids.forEach(id=>next.add(id));setDraft({questionIds:[...next]})}
  const save=()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(drafts));setNotice('이 브라우저에 초안을 저장했습니다. 검사를 실행한 기록은 아닙니다.')}catch{setNotice('초안을 저장하지 못했습니다. 저장 공간이나 브라우저 설정을 확인하세요.')}}
  const gaps=[!draft.company.trim()&&'회사명',!draft.tenantKey&&'검사할 조직',!draft.asOf&&'검사 기준일',!(snapshotId||draft.snapshotId.trim())&&'수집 시점 ID',!draft.targetKeys.length&&'검사 대상',draft.targetKeys.some(k=>!graph.objectsByKey.has(k))&&'현재 데이터에 없는 대상',!pickedQuestions.length&&'세부 질문',pickedQuestions.some(q=>!draft.companyInputs[q.id]?.trim())&&'질문별 회사 기준과 적용 근거'].filter(Boolean) as string[]
  const exportDraft=()=>downloadText('compliance-draft.json',JSON.stringify({...draft,snapshotId:snapshotId??draft.snapshotId,kind:'configuration_draft_not_execution',datasetSource:localData?'local':'remote',selections:pickedItems.map(i=>({officialItemId:i.id,selectedParts:i.questions.filter(q=>selected.has(q.id)).map(q=>({questionId:q.id,sourcePositionId:q.positionId,sourceNodeId:q.sourceNodeId}))}))},null,2),'application/json')

  return <main className="compliance-page">
    <header className="compliance-heading page-title-bar"><h1>Compliance</h1><div className="page-head-actions">{onBack&&<button type="button" className="fd-back-btn" onClick={onBack}>← 기준 선택</button>}<span className="cp-status tl-badge">검사 서버 연결 전</span></div></header>
    <div className="cp-content">
      <nav className="cp-view-tabs" aria-label="컴플라이언스 보기"><button className={location.view==='new'?'is-active':''} aria-pressed={location.view==='new'} onClick={()=>go({view:'new'})}>새 검사</button><button className={location.view==='runs'?'is-active':''} aria-pressed={location.view==='runs'} onClick={()=>go({view:'runs'})}>검사 기록</button></nav>
      {location.view==='runs'?<section className="cp-empty"><FileSearch size={28}/><h2>검사 기록</h2><p role="status">{history}</p><button className="cp-button" onClick={()=>go({view:'new',step:'items'})}>새 검사 설정</button></section>:<>
        <div className="cp-progress"><ol aria-label="검사 설정 단계">{[['items','항목 선택'],['targets','대상과 기준'],['review','실행 확인']].map(([key,label],index)=><li key={key} aria-current={location.step===key?'step':undefined}><button disabled={index>0&&!pickedQuestions.length} onClick={()=>go({step:key})}><span>{index+1}</span>{label}</button>{index<2&&<ChevronRight size={15}/>}</li>)}</ol><span>자료 기준 {catalogDate}</span></div>
        {notice&&<div className="cp-notice" role="status">{notice}<button aria-label="알림 닫기" onClick={()=>setNotice('')}><X size={16}/></button></div>}
        {location.step==='items'?<>
          <div className="cp-standard-tabs" role="group" aria-label="기준 체계">{(['ISMS-P','PIPA'] as const).map(s=><button key={s} className={s===standard?'is-active':''} aria-pressed={s===standard} onClick={()=>go({standard:s,item:initialItem(s).id})}><strong>{s}</strong><span>{s==='ISMS-P'?'정보보호 및 개인정보보호 관리체계':'개인정보 보호법과 관련 법령, 고시'}</span>{pickedCount(s)>0&&<span className="cp-standard-count tl-badge">공식 항목 {pickedCount(s)}개 선택</span>}</button>)}</div>
          <ItemBrowser key={standard} standard={standard} items={items} current={current} selected={selected} onLoadExcluded={async()=>{if(!excluded.length){const data=await import('./excluded.snapshot.json');setExcluded(data.default.items as OfficialItem[])}}} onInspect={id=>go({item:id})} onToggleItem={toggleItem} onToggleQuestion={id=>setDraft({questionIds:selected.has(id)?draft.questionIds.filter(q=>q!==id):[...draft.questionIds,id]})}/>
        </>:location.step==='targets'?<SetupForm graph={graph} snapshotId={snapshotId} localData={localData} draft={draft} items={pickedItems} onChange={setDraft} onOpenObject={key=>{save();onOpenObject(key)}}/>:<section className="cp-review cp-panel"><header><h2>실행 전 확인</h2><span className="cp-status tl-badge">미실행</span></header><div className="cp-panel-body">
          <div className="cp-review-meta"><div><span>체계</span><strong>{standard}</strong></div><div><span>공식 항목</span><strong>{pickedItems.length}개</strong></div><div><span>세부 질문</span><strong>{pickedQuestions.length}개</strong></div><div><span>선택 대상</span><strong>{draft.targetKeys.length}개</strong></div></div>
          <div className="cp-connection"><h3>검사 서버 연결 전</h3>{gaps.length>0&&<p className="cp-gaps"><strong>입력 미작성 또는 재확인</strong>{gaps.map(g=><span key={g} className="tl-badge">{g}</span>)}</p>}</div>
          <div className="cp-table-wrap"><table><thead><tr><th>공식 항목</th><th>선택 세부 질문</th><th>회사 입력</th><th>실행 상태</th></tr></thead><tbody>{pickedItems.map(item=><tr key={item.id}><td><strong>{item.number} {item.title}</strong>{standard==='PIPA'&&<span>{item.document}</span>}</td><td>{item.questions.filter(q=>selected.has(q.id)).length}개</td><td>{item.questions.filter(q=>selected.has(q.id)).every(q=>draft.companyInputs[q.id]?.trim())?'초안 작성':'입력 필요'}</td><td>미실행</td></tr>)}</tbody></table></div>
          <details className="cp-disclosure"><summary>결과에서 구분할 상태</summary><p>관측 사실, 기준 차이, 판정 불가, 비적용, 범위 밖, 미실행을 구분합니다. 입력 부족과 수집 실패는 별도 사유로 표시하며 항목 전체 충족이나 전체 준수율로 합산하지 않습니다.</p></details>
        </div></section>}
        <footer className="cp-footer"><div><strong>{standard} 공식 항목 {pickedItems.length}개 선택</strong><span>세부 질문 {pickedQuestions.length}개</span></div><div className="cp-footer-actions"><button className="cp-button" onClick={save}>초안 저장</button>{location.step==='review'&&<button className="cp-button" onClick={exportDraft}>설정 초안 내보내기</button>}{location.step!=='items'&&<button className="cp-button" onClick={()=>go({step:location.step==='review'?'targets':'items'})}><ArrowLeft size={15}/>이전</button>}{location.step==='items'?<button className="cp-button cp-primary" disabled={!pickedQuestions.length} onClick={()=>go({step:'targets'})}>대상과 기준 설정 <ArrowRight size={15}/></button>:location.step==='targets'?<button className="cp-button cp-primary" disabled={!pickedQuestions.length} onClick={()=>go({step:'review'})}>실행 전 확인 <ArrowRight size={15}/></button>:<><span className="cp-status tl-badge">검사 서버 연결 전</span><button className="cp-button cp-primary" disabled title="검사 서버 연결 후 실행할 수 있습니다.">검사 실행</button></>}</div></footer>
      </>}
    </div>
  </main>
}
