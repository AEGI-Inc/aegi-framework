import { useEffect, useRef, useState } from 'react'
import type { GraphStoreV2 } from '../model/graph'
import type { ExceptionDataset } from '../model/exception'
import type { TeamBackend } from '../handling/teamStore'
import { IsmsOverview } from './IsmsOverview'
import { IsoOverview } from './IsoOverview'
import { PipaOverview } from './PipaOverview'
import { CheckCatalog } from './CheckCatalog'
import ComplianceExceptions from './ComplianceExceptions'
import { useComplianceExceptions } from './useComplianceExceptions'
import { isActiveException } from './exceptionStatus'
import { useStandardResults } from '../config-findings/standardResultsStore'
import { backOr } from '../ui/backNav'
import CompliancePage from './CompliancePage'
import '../config-findings/configFindings.css'
import './complianceHub.css'
import { complianceFrameworks, type Framework } from './frameworks'

type HubView = 'frameworks' | 'checks' | 'exceptions'

function selectedFramework(): Framework | null {
  const frameworks = complianceFrameworks()
  const id = new URLSearchParams(window.location.hash.split('?')[1]).get('framework')
  return frameworks.some(f => f.id === id) ? id as Framework : null
}
function viewInHash(): HubView {
  const v = new URLSearchParams(window.location.hash.split('?')[1]).get('view')
  if (v === 'checks') return 'checks'
  if (v === 'exceptions') return 'exceptions'
  return 'frameworks'
}
/** 기존 초안 화면은 주소의 standard 로 연다. 뒤로 가기, 새로고침, 새 탭이 같은 화면을 보인다 */
const legacyInHash = () => /[?&]standard=/.test(window.location.hash)

export default function ComplianceHub(props: {graph: GraphStoreV2; snapshotId?: string; localData: boolean; dataset: ExceptionDataset; backend: TeamBackend; onOpenObject: (key: string) => void}) {
  const frameworks = complianceFrameworks()
  const [selected, setSelected] = useState<Framework | null>(selectedFramework)
  const [view, setView] = useState<HubView>(viewInHash)
  const [legacy, setLegacy] = useState(legacyInHash)
  const results = useStandardResults()
  const exceptionsApi = useComplianceExceptions(props.dataset, props.backend)
  const activeExceptionCount = exceptionsApi.items.filter(e => isActiveException(e, new Date())).length
  const shown = useRef(legacy)
  useEffect(() => {
    const sync = () => { setSelected(selectedFramework()); setView(viewInHash()); setLegacy(legacyInHash()) }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  /* 기준 선택과 기존 초안 사이를 오가면 새 화면 제목으로 포커스를 옮긴다 */
  useEffect(() => {
    if (shown.current === legacy) return
    shown.current = legacy
    const h1 = document.querySelector<HTMLElement>(legacy ? '.compliance-heading h1' : '.comp-hub h1')
    if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }) }
  }, [legacy])
  const choose = (id: Framework | null) => {
    setSelected(id)
    setView('frameworks')
    window.location.hash = id ? `#compliance?framework=${id}` : '#compliance'
  }
  const chooseView = (next: HubView) => {
    setView(next)
    if (next === 'checks' || next === 'exceptions') {
      window.location.hash = selected ? `#compliance?framework=${selected}&view=${next}` : `#compliance?view=${next}`
    } else {
      window.location.hash = selected ? `#compliance?framework=${selected}` : '#compliance'
    }
  }
  if (legacy) return <CompliancePage {...props} onBack={() => backOr(h => /^#compliance\?framework=pipa/i.test(h), () => choose('pipa'))} />
  const current = frameworks.find(f => f.id === selected)
  return <main className="page lst-page cfg-page comp-hub">
    <header className="page-title-bar page-title-bar-inset"><h1>Compliance</h1></header>
    <section className="comp-intro"><h2>컴플라이언스 선택</h2><p>확인할 기준을 선택하세요.</p></section>
    <div className="comp-frameworks" role="group" aria-label="컴플라이언스 기준">
      {frameworks.map(f => (
        <button key={f.id} type="button" className={`comp-framework ${selected === f.id ? 'is-selected' : ''}`} aria-pressed={selected === f.id} onClick={() => choose(f.id)}>
          <strong>{f.label}</strong><span className="comp-fw-sub"><span>{f.description}</span></span>
        </button>
      ))}
    </div>
    <nav className="cp-view-tabs" aria-label="컴플라이언스 보기">
      <button type="button" className={view === 'frameworks' ? 'is-active' : ''} aria-pressed={view === 'frameworks'} onClick={() => chooseView('frameworks')}>기준별</button>
      <button type="button" className={view === 'checks' ? 'is-active' : ''} aria-pressed={view === 'checks'} onClick={() => chooseView('checks')}>자동 검사 목록</button>
      <button type="button" className={view === 'exceptions' ? 'is-active' : ''} aria-pressed={view === 'exceptions'} onClick={() => chooseView('exceptions')}>예외 {activeExceptionCount}</button>
    </nav>
    {exceptionsApi.notice && <p role="status" className="comp-notice">{exceptionsApi.notice.text}</p>}
    {view === 'checks' ? <CheckCatalog results={results} /> : view === 'exceptions' ? <ComplianceExceptions api={exceptionsApi} results={results} /> : current && (selected === 'isms-p' ? <IsmsOverview results={results} graph={props.graph} snapshotId={props.snapshotId} onOpenObject={props.onOpenObject} exceptions={exceptionsApi} /> : selected === 'iso27001' ? <IsoOverview results={results} graph={props.graph} onOpenObject={props.onOpenObject} exceptions={exceptionsApi} /> : <PipaOverview results={results} graph={props.graph} onOpenObject={props.onOpenObject} exceptions={exceptionsApi} />)}
  </main>
}
