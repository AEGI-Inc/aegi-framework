import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronRight, ExternalLink, Search, X } from 'lucide-react'
import { researchAreas, type OfficialItem, type Standard } from './catalog'

type ListView={search:string;group:string;outside:boolean;onlySelected:boolean;scrollTop:number}
// 기준 체계별 목록 조건과 스크롤. 같은 탭에서 다른 화면이나 체계에 다녀와도 그대로 연다
const listViews:Partial<Record<Standard,ListView>>={}

export default function ItemBrowser({standard,items,current,selected,onLoadExcluded,onInspect,onToggleItem,onToggleQuestion}:{standard:Standard;items:OfficialItem[];current:OfficialItem;selected:Set<string>;onLoadExcluded:()=>Promise<void>;onInspect:(id:string)=>void;onToggleItem:(item:OfficialItem)=>void;onToggleQuestion:(id:string)=>void}) {
  const [saved]=useState(()=>listViews[standard])
  const [search,setSearch]=useState(saved?.search??''),[group,setGroup]=useState(saved?.group??''),[outside,setOutside]=useState(false),[onlySelected,setOnlySelected]=useState(saved?.onlySelected??false)
  const detailRef=useRef<HTMLElement>(null),listRef=useRef<HTMLDivElement>(null),restoreScroll=useRef(saved?.scrollTop??null)
  const [loading,setLoading]=useState(false),[loadError,setLoadError]=useState('')
  const showOutside=async(checked:boolean)=>{if(!checked){setOutside(false);return}setLoading(true);setLoadError('');try{await onLoadExcluded();setOutside(true)}catch{setLoadError('범위 밖 항목을 불러오지 못했습니다. 다시 선택해 주세요.')}finally{setLoading(false)}}
  // 범위 밖 포함은 항목을 불러와야 켜진다
  useEffect(()=>{if(saved?.outside)void showOutside(true)},[])
  useEffect(()=>{listViews[standard]={scrollTop:0,...listViews[standard],search,group,outside,onlySelected}},[standard,search,group,outside,onlySelected])
  // 저장한 스크롤은 범위 밖 항목까지 그린 뒤에 되돌린다
  useLayoutEffect(()=>{
    const list=listRef.current
    if(!list||restoreScroll.current===null||(saved?.outside&&!outside&&!loadError))return
    list.scrollTop=restoreScroll.current;restoreScroll.current=null
  },[saved,outside,loadError])
  // 현재 항목이 목록 밖에 있으면 문서는 두고 목록만 가장 가까운 위치로 움직인다
  useLayoutEffect(()=>{
    const list=listRef.current,row=list?.querySelector<HTMLElement>('.cp-item.is-current')
    if(!list||!row)return
    const top=row.getBoundingClientRect().top-list.getBoundingClientRect().top+list.scrollTop,bottom=top+row.offsetHeight
    if(top<list.scrollTop)list.scrollTop=top
    else if(bottom>list.scrollTop+list.clientHeight)list.scrollTop=Math.min(top,bottom-list.clientHeight)
  },[current.id])
  const groups=[...new Set(items.filter(i=>outside||i.questions.length).map(i=>i.group))]
  const visible=items.filter(i=>(outside||i.questions.length)&&(!group||i.group===group)&&(!onlySelected||i.questions.some(q=>selected.has(q.id)))&&(!search||`${i.number} ${i.title} ${i.document} ${i.questions.map(q=>q.question).join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())))
  const inspect=(id:string)=>{onInspect(id);if(window.matchMedia('(max-width: 1000px)').matches)requestAnimationFrame(()=>detailRef.current?.scrollIntoView({behavior:'smooth',block:'start'}))}
  return <>
    <section className="cp-browser-tools" aria-label="항목 탐색 조건">
      <div className="cp-filters"><label className="cp-search"><Search size={17}/><input aria-label="공식 항목 검색" value={search} onChange={e=>setSearch(e.target.value)} placeholder="번호, 항목명, 검사할 내용 검색"/>{search&&<button aria-label="검색어 지우기" onClick={()=>setSearch('')}><X size={15}/></button>}</label><select aria-label={standard==='ISMS-P'?'영역 선택':'공식 문서 선택'} value={group} onChange={e=>setGroup(e.target.value)}><option value="">{standard==='ISMS-P'?'전체 영역':'전체 문서'}</option>{groups.map(g=><option key={g}>{g}</option>)}</select><label className="cp-check"><input type="checkbox" checked={outside} disabled={loading} onChange={e=>void showOutside(e.target.checked)}/>범위 밖 포함</label></div>
      {loading&&<p role="status">범위 밖 항목을 불러오는 중</p>}{loadError&&<p role="alert">{loadError}</p>}
    </section>
    <div className="cp-browser">
      <section className="cp-list-panel" aria-label="공식 항목 목록"><header><h2>공식 항목 <span>{visible.length}개</span></h2><label className="cp-check"><input type="checkbox" checked={onlySelected} onChange={e=>setOnlySelected(e.target.checked)}/>선택만 보기</label></header>
        <div className="cp-list" ref={listRef} onScroll={e=>{const view=listViews[standard];if(view)view.scrollTop=e.currentTarget.scrollTop}} role="group" aria-label={`${standard} 공식 항목`}>
          {!visible.length&&<div className="cp-list-empty"><p>조건에 맞는 항목이 없습니다.</p><button className="cp-button" onClick={()=>{setSearch('');setGroup('');setOnlySelected(false)}}>검색 조건 초기화</button></div>}
          {visible.map(item=>{const count=item.questions.filter(q=>selected.has(q.id)).length;return <div key={item.id} className={`cp-item ${current.id===item.id?'is-current':''}`}>
            <label className="cp-item-check"><input type="checkbox" aria-label={`${item.number} ${item.title} 검사 선택`} checked={item.questions.length>0&&count===item.questions.length} ref={el=>{if(el)el.indeterminate=count>0&&count<item.questions.length}} disabled={!item.questions.length} onChange={()=>onToggleItem(item)}/></label>
            <button className="cp-item-title" aria-current={current.id===item.id?'true':undefined} onClick={()=>inspect(item.id)}><span className="cp-item-location">{standard==='PIPA'?item.document:item.group}</span><strong>{item.number} {item.title}</strong><span className="cp-item-meta">{item.questions.length?`선정 세부 질문 ${item.questions.length}개`:'분석 범위 밖'}{count>0&&<b><Check size={12}/>{count}개 선택</b>}</span></button><ChevronRight className="cp-item-arrow" size={16}/>
          </div>})}
        </div>
      </section>
      <section className="cp-detail" ref={detailRef} aria-label="공식 항목 상세" tabIndex={-1} key={current.id}>
        <header className="cp-detail-head"><div className="cp-eyebrow">{current.document}</div><h2>{current.number} {current.title}</h2><div className="cp-detail-meta"><span>자료 판 {current.edition}</span><a href={current.sourceUrl} target="_blank" rel="noreferrer">원문과 선별 근거 <ExternalLink size={13}/></a></div></header>
        <div className="cp-detail-body">
          <div className="cp-scope-line"><strong>{current.questions.length?'선정 범위의 일부 기술 검사':'AEGI 분석 범위 밖'}</strong></div>
          {standard==='PIPA'&&<p>발령 또는 공포 {current.issuedDate} / 시행 {current.effectiveDate}. 부분별 시행유예와 적용 조건은 별도로 확인해야 합니다.</p>}
          {current.notes.length>0&&<section className="cp-conditions"><h3>시행 시점 확인</h3>{current.notes.map(n=><p key={n}>{n}</p>)}</section>}
          {standard==='ISMS-P'&&<details className="cp-disclosure"><summary>공식 기준 내용</summary><p>{current.text}</p></details>}
          <section><div className="cp-section-title"><h3>검사할 세부 부분</h3>{current.questions.length>0&&<button className="cp-text-button" onClick={()=>onToggleItem(current)}>{current.questions.every(q=>selected.has(q.id))?'이 항목 선택 해제':'이 항목 모두 선택'}</button>}</div>
            {!current.questions.length&&<p>기존 선별에서 제외된 항목입니다. 아래 사유를 확인하세요.</p>}
            {current.questions.map(q=><article className={`cp-question ${selected.has(q.id)?'is-picked':''}`} key={q.id}><label className="cp-question-title"><input type="checkbox" checked={selected.has(q.id)} onChange={()=>onToggleQuestion(q.id)}/><strong>{q.location}</strong></label><p className="cp-question-prompt">{q.question}</p><p>{q.scope}</p>
              <details className="cp-question-details"><summary>원문, 적용 조건과 필요한 정보</summary><blockquote>{q.sourceText}</blockquote>{q.subject&&<p><strong>적용 주체</strong> {q.subject}</p>}{q.applicability&&<p><strong>적용 조건</strong> {q.applicability}</p>}<h4>필요한 정보</h4><ul>{q.inputs.map((text,i)=><li key={i}>{text}</li>)}</ul><h4>제공할 내용</h4><p>{q.output}</p><h4>이 부분의 범위 밖</h4><p>{q.outside}</p></details>
            </article>)}
          </section>
          <details className="cp-disclosure"><summary>필요한 분석과 현재 연결 상태</summary><ul>{(researchAreas(current.questions).length?researchAreas(current.questions):['현황과 관측 근거 조회']).map(area=><li key={area}>{area}</li>)}</ul></details>
          <details className="cp-disclosure" open={!current.questions.length}><summary>범위 밖과 제외 사유 {current.exclusions.length?`(${current.exclusions.length})`:''}</summary>{current.exclusions.length?current.exclusions.map((e,i)=><div key={i}><h4>{e.location}</h4>{e.text&&e.text!==e.reason&&<p>{e.text}</p>}<p>{e.reason}</p></div>):null}<p>AEGI의 분석 범위 밖이라는 뜻이며 회사에 의무가 없다는 뜻은 아닙니다.</p></details>
        </div>
      </section>
    </div>
  </>
}
