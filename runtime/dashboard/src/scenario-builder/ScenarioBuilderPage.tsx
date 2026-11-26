import type { InvestigationPath } from '../semantic-graph/investigationQuery'
import { useMemo, useState } from 'react'
import type { GraphStoreV2 } from '../model/graph'
import type { EvidenceStore } from '../model/evidence'
import type { CoverageFile } from '../detection/v2/engine/types'
import { AccessEngine } from '../detection/v2/engine'
import { reasonLabel } from '../detection/v2/engine/accessModel'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId } from '../findings/providers'
import { downloadText } from '../utils/csv'
import { ScenarioGraph, kindName, peopleAt, scenarioDocument, type Need, type PathStep } from './scenarioGraph'
import ScenarioCanvas from './ScenarioCanvas'
import SaasLinksView from './SaasLinksView'
import AssetView from './AssetView'
import { named } from './plainText'
import { scorePath } from './riskScore'
import './scenarioBuilder.css'

/**
 * 시나리오 만들기 (PoC). 한 화면에서 SaaS → 진입점 → 홉을 옆으로 펼쳐 경로를 만든다 (결정 0016 경로: 진입점 → 홉 → 영향).
 * 고른 노드의 「분석」을 누르면 그 노드로 들어온 홉의 근거, 속성, 그 노드를 영향으로 본 차집합과 교집합이 아래에 나온다.
 * 사람별 직접 권한과 파생 접근은 엔진이 게시한 접근 표(derived.access_table)를 읽는다.
 */
export interface ScenarioBuilderPageProps {
  graph: GraphStoreV2
  evidence: EvidenceStore
  coverage?: CoverageFile
  /** path 가 있으면 그 사슬의 객체만 보이게 연다 */
  onSelectObject: (objectKey: string, path?: InvestigationPath) => void
}

/** 사람 묶음 이름. 괄호 안은 Access Gaps 화면의 이름(차집합, 교집합, 권한 부여) */
const SIDE_LABEL = {
  gap: '직접 권한이 없는데 이 경로로 되는 사람 (차집합)',
  gap_inferred: '직접 권한이 없는데 이 경로로 되는 것으로 보이는 사람 (차집합, 추정)',
  both: '직접 권한도 있는 사람 (교집합)',
  native_only: '직접 권한은 있고 이 경로로는 닿지 않는 사람 (권한 부여만)',
} as const
const NEED_LABEL: Record<Need, string> = { read: '읽기', write: '쓰기', admin: '관리' }
const NEED_VERB: Record<Need, string> = { read: '읽을', write: '바꿀', admin: '관리할' }
const PROPERTY_LIMIT = 20

function Tabs<K extends string>({ label, items, value, onChange }: { label: string; items: Array<{ key: K; label: string }>; value: K; onChange: (k: K) => void }) {
  return (
    <div className="lst-seg" role="group" aria-label={label}>
      {items.map(item => (
        <button type="button" key={item.key} className={value === item.key ? 'is-on' : ''} aria-pressed={value === item.key} onClick={() => onChange(item.key)}>{item.label}</button>
      ))}
    </div>
  )
}

function AnalysisPanel({ sg, path, i, need, setNeed, onSelectObject }: { sg: ScenarioGraph; path: PathStep[]; i: number; need: Need; setNeed: (n: Need) => void; onSelectObject: (k: string) => void }) {
  const step = path[i]
  const upTo = useMemo(() => path.slice(0, i + 1), [path, i])
  const answer = useMemo(() => peopleAt(sg, upTo, need), [sg, upTo, need])
  const props = sg.properties(step.key)
  return (
    <section className="scb-analysis" aria-label="분석">
      <h2>
        <span className="scb-logo"><ProviderLogo provider={providerLogoId(sg.provider(step.key))} /></span>
        {sg.name(step.key)} <span className="scb-type">{sg.typeLabel(step.key)}</span>
        <button type="button" className="ex-btn" onClick={() => onSelectObject(step.key)}>그래프에서 보기</button>
      </h2>

      <p className="scb-effect-line">
        이 경로로 {named(sg.name(step.key), '을', '를')} {NEED_VERB[need]} 수 있게 되는 사람 가운데, 직접 권한이 없는 사람은 <b>{answer.people.filter(p => p.side === 'gap' || p.side === 'gap_inferred').length}명</b>이다.
      </p>
      {answer.missing && <p className="scb-note">이 데이터셋에는 엔진 접근 표가 없어 사람별 판정을 보이지 않음</p>}
      <Tabs label="권한" value={need} onChange={setNeed} items={(['read', 'write', 'admin'] as const).map(n => ({ key: n, label: NEED_LABEL[n] }))} />
      {answer.everyone && <p><span className="tl-badge is-failure">누구나 실제 접근 가능</span></p>}
      {(['gap', 'gap_inferred', 'both', 'native_only'] as const).map(side => {
        const list = answer.people.filter(p => p.side === side)
        const items = list.length > 0 && (
          <ul>
            {list.map(p => (
              <li key={p.key}>
                <button type="button" className="scb-link" onClick={() => sg.graph.objectsByKey.has(p.account) && onSelectObject(p.account)}>{p.name}</button>
                {p.onPath && <span className="tl-badge scb-tag">이 경로 경유</span>}
                {p.share && <span className="tl-badge scb-tag">직접 공유, 조직 밖</span>}
                {p.side === 'gap_inferred' && p.reasons.length > 0 && <span className="tl-badge scb-tag">{p.reasons.join(', ')}</span>}
              </li>
            ))}
          </ul>
        )
        // 직접 권한이 없는 사람은 펼쳐 두고, 직접 권한이 있는 쪽은 접어 둔다
        if (side === 'both' || side === 'native_only') {
          return <details key={side} className="scb-side scb-props"><summary>{SIDE_LABEL[side]} {list.length}</summary>{items}</details>
        }
        return (
          <section key={side} className="scb-side">
            <h4>{SIDE_LABEL[side]} {list.length}</h4>
            {items}
          </section>
        )
      })}
      <details className="scb-props">
        <summary>기술 정보</summary>
        {step.via && (
          <>
            <h3>들어온 홉: {sg.name(path[i - 1].key)} <code>{sg.legText(step.via)}</code></h3>
            <ul className="scb-edges">
              {sg.evidenceOf(step.via).map((e, j) => (
                <li key={j}>
                  {e.from} → {e.to}, {kindName(e.kind)}: {e.label}
                  {e.observed && <span className="tl-badge scb-tag">실행 기록 있음</span>}
                  {e.uncertain.length > 0 && <span className="tl-badge is-failure scb-tag">불확실: {e.uncertain.map(reasonLabel).join(', ')}</span>}
                  {e.facts.map((facts, f) => (
                    <dl key={f} className="scb-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
                  ))}
                </li>
              ))}
            </ul>
          </>
        )}

        {props.length > 0 && (
          <details className="scb-props">
            <summary>속성 {props.length}</summary>
            <dl className="scb-facts">{props.slice(0, PROPERTY_LIMIT).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </details>
        )}

      </details>
    </section>
  )
}

interface Saved { provider: string; path: PathStep[] }

export default function ScenarioBuilderPage({ graph, evidence, coverage, onSelectObject }: ScenarioBuilderPageProps) {
  const sg = useMemo(() => new ScenarioGraph(graph, new AccessEngine({ graph, evidence, coverage: coverage ?? { format: 'aegi-coverage/v1', calls: [] } })), [graph, evidence, coverage])
  const [provider, setProvider] = useState('')
  const [path, setPathState] = useState<PathStep[]>([])
  const [analyzed, setAnalyzed] = useState<number | null>(null)
  const [need, setNeed] = useState<Need>('write')
  const [saved, setSaved] = useState<Saved[]>([])
  const [view, setView] = useState<'path' | 'links' | 'assets'>('links')

  const setPath = (p: PathStep[]) => {
    setPathState(p)
    if (analyzed !== null && analyzed >= p.length) setAnalyzed(null)
  }
  const pathLabel = (p: PathStep[]) => p.map(s => sg.name(s.key)).join(' → ')
  const score = useMemo(() => (path.length > 1 ? scorePath(sg, path) : null), [sg, path])
  const download = () => {
    const doc = { ...scenarioDocument(sg, pathLabel(path), path, peopleAt(sg, path, need)), score: scorePath(sg, path) }
    downloadText(`scenario-${Date.now()}.json`, JSON.stringify(doc, null, 2), 'application/json')
  }

  return (
    <main className="page lst-page scb-page">
      <header className="page-title-bar page-title-bar-inset">
        <h1>Explorer</h1>
        <div className="ti-view-switch" role="group" aria-label="보기">
          {([['links', 'SaaS 연결'], ['path', '경로 만들기'], ['assets', '자산']] as const).map(([k, label]) => (
            <button type="button" key={k} className={view === k ? 'on' : ''} aria-pressed={view === k} onClick={() => setView(k)}>{label}</button>
          ))}
        </div>
      </header>

      {view === 'assets' && (
        <AssetView
          sg={sg}
          onSelectObject={onSelectObject}
          onOpenPath={(p, steps) => { setProvider(p); setPath(steps); setAnalyzed(null); setView('path') }}
        />
      )}
      {view === 'links' && (
        <SaasLinksView
          sg={sg}
          onSelectObject={onSelectObject}
          onOpenPath={(p, steps) => { setProvider(p); setPath(steps); setAnalyzed(null); setView('path') }}
        />
      )}

      {view === 'path' && (<>
      <div className="lst-actionbar">
        <div className="lst-actionbar-row">
          <span className="scb-bar-label">경로</span>
          {path.length ? (
            <ol className="scb-path">
              {path.map((s, n) => (
                <li key={n}>
                  {s.via && <code>{sg.legText(s.via)} →</code>}
                  <span className="scb-logo"><ProviderLogo provider={providerLogoId(sg.provider(s.key))} /></span>{sg.name(s.key)}
                </li>
              ))}
            </ol>
          ) : null}
          <div className="lst-actionbar-end">
            <button type="button" className="ex-btn" disabled={path.length < 2} onClick={() => setSaved(s => [...s, { provider, path }])}>경로 추가</button>
            <button type="button" className="ex-btn" disabled={path.length < 2} onClick={download}>JSON 내려받기</button>
          </div>
        </div>
        {score && (
          <div className="lst-actionbar-row scb-score" aria-label="위험 점수">
            {score.kind
              ? <><b className={`tl-badge${score.grade === 'Low' ? '' : ' is-failure'}`}>{score.grade} {score.total}</b> {score.kind.label} {score.kind.score} × 자산 {score.asset.score} ({score.asset.reason}){score.inferred && <span> 추정: {score.doubt}</span>}</>
              : <><b className="tl-badge">점수 없음</b> {score.why}. 자산 {score.asset.score} ({score.asset.reason})</>}
            {score.asset.note && <span> {score.asset.note}</span>}
          </div>
        )}
      </div>

      <ScenarioCanvas sg={sg} provider={provider} setProvider={p => { setProvider(p); setPath([]) }} path={path} setPath={setPath} analyzed={analyzed} onAnalyze={i => setAnalyzed(analyzed === i ? null : i)} />

      <div className="scb-below">
        {analyzed !== null && analyzed < path.length && (
          <AnalysisPanel sg={sg} path={path} i={analyzed} need={need} setNeed={setNeed} onSelectObject={onSelectObject} />
        )}
        {saved.length > 0 && (
          <div className="scb-saved">
            <h2>추가한 경로 {saved.length}</h2>
            <ul>
              {saved.map((sc, n) => (
                <li key={n}>
                  <button type="button" className="scb-link" onClick={() => { setProvider(sc.provider); setPath(sc.path) }}>{pathLabel(sc.path)}</button>
                  <button type="button" className="ex-btn" onClick={() => setSaved(s => s.filter((_, j) => j !== n))}>제외</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      </>)}
    </main>
  )
}
