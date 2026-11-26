import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Waypoints } from 'lucide-react'
import type { GraphStoreV2 } from '../model/graph'
import type { Provider } from '../model/object'
import { blastLevelRank, blastPathTo, type BlastHop, type BlastMode, type BlastRadius } from '../detection/v2/blastRadius'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId, providerName } from '../findings/providers'
import { ChipGroup, DetailHead, Hero, LiveCount, Segmented, readListMemory, scrollBox, writeListMemory } from '../ui/ListScreen'
import BlastRadiusGraph from './BlastRadiusGraph'
import { credentialDetailHash } from '../appRouting'
import {
  CERTAINTY_LABEL, LEVEL_LABEL, MODE_LABEL, NO_REACH_LABEL, levelLabel, viaKind, headline, hopEnds, hopKindLabel, hopSentence, noteSentence,
  objectIdLabel, objectLabel, objectTypeLabel, providerRank, reachLabel, reachedNodes,
} from './blastLabels'
import type { CredentialBlast } from './useBlastRadii'
import { backOr, isListHash } from '../ui/backNav'
import { hopsPath } from '../semantic-graph/chainPath'
import type { InvestigationPath } from '../semantic-graph/investigationQuery'
import NodeStandardFindings from '../config-findings/NodeStandardFindings'

/** CredentialRiskPage 는 자체 Block 틀이 없어, 「참고」 절과 같은 lst-section 모양으로 맞춘다 */
function FindingsBlock({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="lst-section br-findings" aria-label="설정 기준">
      <h3 className="lst-h2">{title}</h3>
      {children}
    </section>
  )
}

/* 주소: 목록은 #credentials, 상세는 #credentials?cred=<객체 키>&mode=token|account.
   객체 키는 대소문자를 가리므로 공용 detailIdFromHash(대문자로 바꾼다)를 쓰지 않는다. */
export const CREDENTIALS_HASH = '#credentials'

/* 주소 만들기는 appRouting 한 곳에 둔다. App 이 이 화면을 lazy 로 불러도 주소 함수 때문에 화면 청크를 끌어오지 않게 하려는 것이다 */
export { credentialDetailHash }

function readHash(): { key: string; mode: BlastMode } {
  if (typeof window === 'undefined') return { key: '', mode: 'token' }
  const hash = window.location.hash
  if (!hash.toLowerCase().startsWith(CREDENTIALS_HASH)) return { key: '', mode: 'token' }
  const params = new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
  const key = hash.includes('?') ? params.get('cred') ?? '' : ''
  return { key, mode: params.get('mode') === 'account' ? 'account' : 'token' }
}

const MEMORY_KEY = 'aegi.credentialRisk.list'
type View = 'all' | 'cross' | 'admin'
type ListMemory = { scrollTop?: number; lastId?: string; view?: View; providers?: Provider[] }

/** 목록 순서: 토큰만으로 센 권한, 다른 SaaS 로 넘어감, 계정 장악의 권한, 닿는 수 */
function score(r: BlastRadius): number {
  const top = r.highest
  return (top ? (blastLevelRank(top.level) + 1) * 100 + (top.tenantWide ? 50 : 0) + (top.certainty === 'confirmed' ? 10 : 0) : 0) + (r.crossProvider ? 5 : 0)
}

function sortKey(c: CredentialBlast): number[] {
  return [score(c.token), score(c.account), reachedNodes(c.token).length, reachedNodes(c.account).length]
}

function compare(a: CredentialBlast, b: CredentialBlast): number {
  const ka = sortKey(a)
  const kb = sortKey(b)
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i]
  return a.key.localeCompare(b.key)
}

/* 최고 권한 단계. 센 순서대로 조직 관리(조직 전체의 관리 권한), 관리, 쓰기, 읽기, 사용(권한 수준을 말할 수 없는 단계), 영향 없음 */
type Tier = 'org' | 'admin' | 'write' | 'read' | 'use' | 'none'
const TIERS: Tier[] = ['org', 'admin', 'write', 'read', 'use', 'none']
const TIER_LABEL: Record<Tier, string> = { org: '조직 관리', admin: LEVEL_LABEL.admin, write: LEVEL_LABEL.write, read: LEVEL_LABEL.read, use: LEVEL_LABEL.use, none: NO_REACH_LABEL }

function tierOf(r: BlastRadius): Tier {
  const h = r.highest
  if (h?.level === 'admin') return h.tenantWide ? 'org' : 'admin'
  if (h?.level === 'write' || h?.level === 'read') return h.level
  return reachedNodes(r).length ? 'use' : 'none'
}

/** 목록은 토큰 유출 최고 권한으로 묶는다. 묶음 안은 compare 순서 그대로이고, 상세의 이전, 다음도 이 순서를 따른다 */
function byTokenTier(list: CredentialBlast[]): CredentialBlast[] {
  return TIERS.flatMap(t => list.filter(c => tierOf(c.token) === t))
}

function tierCounts(list: CredentialBlast[], pick: (c: CredentialBlast) => BlastRadius): Record<Tier, number> {
  const counts: Record<Tier, number> = { org: 0, admin: 0, write: 0, read: 0, use: 0, none: 0 }
  list.forEach(c => { counts[tierOf(pick(c))]++ })
  return counts
}

function TierSquare({ tier }: { tier: Tier }) {
  return <i className={`br-sq br-tier-${tier}`} aria-hidden="true" />
}

/* 두 가정마다 한 줄: 이름, 단계별 분포 막대, 단계별 수 */
function TierDistribution({ credentials, shown }: { credentials: CredentialBlast[]; shown: Tier[] }) {
  return (
    <div className="br-dist">
      {(['token', 'account'] as const).map(mode => {
        const counts = tierCounts(credentials, c => c[mode])
        return (
          <Fragment key={mode}>
            <span className="br-dist-label">{MODE_LABEL[mode]}</span>
            <span className="br-bar" role="img" aria-label={`${MODE_LABEL[mode]} ${shown.map(t => `${TIER_LABEL[t]} ${counts[t]}`).join(', ')}`}>
              {TIERS.map(t => counts[t] ? <i key={t} className={`br-tier-${t}`} style={{ flexGrow: counts[t] }} /> : null)}
            </span>
            <span className="br-legend">
              {shown.map(t => <span key={t} className={counts[t] ? 'has' : ''}><TierSquare tier={t} />{TIER_LABEL[t]} <b>{counts[t]}</b></span>)}
            </span>
          </Fragment>
        )
      })}
    </div>
  )
}

function expiresAt(c: CredentialBlast, graph: GraphStoreV2): string | undefined {
  const o = graph.objectsByKey.get(c.key)
  const v = o?.canonical.properties.expiresAt ?? o?.canonical.properties.expires_at ?? o?.canonical.judged?.expires_at
  return typeof v === 'string' && v ? v.slice(0, 10) : undefined
}

function Logo({ provider }: { provider: Provider }) {
  return (
    <span className="lst-logo" title={providerName(provider)}>
      <ProviderLogo provider={providerLogoId(provider)} />
    </span>
  )
}

/* 최고 권한 한 칸: 단계 색 네모와 권한 글자, 추정 배지. 아래 줄은 영향 SaaS 로고와 영향 대상 수 */
function ReachCell({ radius, graph }: { radius: BlastRadius; graph: GraphStoreV2 }) {
  const reached = reachedNodes(radius)
  if (!reached.length) return <span className="br-reach"><span className="br-reach-top"><TierSquare tier="none" /><span className="br-none">{NO_REACH_LABEL}</span></span></span>
  const providers = [...new Set(reached.map(n => n.provider))].sort((a, b) => providerRank(a) - providerRank(b))
  return (
    <span className="br-reach">
      <span className="br-reach-top">
        <TierSquare tier={tierOf(radius)} />
        <b className={radius.highest?.level === 'admin' ? 'is-admin' : ''}>{headline(radius, graph)}</b>
        {radius.highest && radius.certainty === 'inferred' && <em className="br-certainty">{CERTAINTY_LABEL.inferred}</em>}
      </span>
      <span className="br-reach-sub">
        {providers.map(p => <Logo key={p} provider={p} />)}
        <span>{reached.length}개</span>
      </span>
    </span>
  )
}

export interface CredentialRiskPageProps {
  credentials: CredentialBlast[]
  graph: GraphStoreV2
  /** Cross-SaaS Graph 에서 그 객체를 고른다. 자격증명에서 그 객체까지의 경로를 같이 넘겨 강조한 채 연다 */
  onSelectObject: (objectKey: string, path?: InvestigationPath) => void
}

/**
 * Credentials — 그래프에 있는 자격증명마다 새었을 때의 피해범위 (src/detection/v2/blastRadius.ts).
 * Access Gaps 처럼 목록과 상세가 나뉜다. 상세는 토큰 권한만, 소유 계정 탈취 두 가정을 바꿔 보며
 * 노드끼리 어떻게 이어져 퍼지는지 그림과 근거로 보인다.
 */
export default function CredentialRiskPage({ credentials, graph, onSelectObject }: CredentialRiskPageProps) {
  const [{ key: openKey, mode }, setRoute] = useState(readHash)
  const memory = readListMemory<ListMemory>(MEMORY_KEY)
  const [view, setView] = useState<View>(memory.view ?? 'all')
  const [providers, setProviders] = useState<Provider[]>(memory.providers ?? [])
  const [lastId, setLastId] = useState(memory.lastId ?? '')
  const pageRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const sorted = useMemo(() => byTokenTier([...credentials].sort(compare)), [credentials])
  const isCross = (c: CredentialBlast) => c.token.crossProvider
  const isAdmin = (c: CredentialBlast) => c.token.tenantAdmins.length > 0
  const visible = sorted.filter(c =>
    (view === 'all' || (view === 'cross' ? isCross(c) : isAdmin(c))) &&
    (!providers.length || providers.includes(c.provider)))
  const opened = openKey ? credentials.find(c => c.key === openKey) : undefined

  useLayoutEffect(() => {
    if (opened) {
      scrollBox(pageRef.current).scrollTop = 0
      return
    }
    const box = scrollBox(pageRef.current)
    box.scrollTop = readListMemory<ListMemory>(MEMORY_KEY).scrollTop ?? 0
    const target: HTMLElement | Window = box === document.scrollingElement ? window : box
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => writeListMemory<ListMemory>(MEMORY_KEY, { scrollTop: box.scrollTop }))
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      target.removeEventListener('scroll', onScroll)
    }
  }, [Boolean(opened), openKey])

  const open = (key: string, nextMode: BlastMode = 'token', replace = false) => {
    if (!opened) writeListMemory<ListMemory>(MEMORY_KEY, { scrollTop: scrollBox(pageRef.current).scrollTop })
    writeListMemory<ListMemory>(MEMORY_KEY, { lastId: key })
    setLastId(key)
    setRoute({ key, mode: nextMode })
    const hash = credentialDetailHash(key, nextMode)
    if (replace) window.history.replaceState(window.history.state, '', hash)
    else window.location.hash = hash
  }

  /* 목록에서 열었으면 브라우저 뒤로 가기로 돌아가 기록을 쌓지 않는다 */
  const back = () => {
    backOr(isListHash(CREDENTIALS_HASH, 'cred'), () => {
      setRoute({ key: '', mode: 'token' })
      window.location.hash = CREDENTIALS_HASH
    })
  }

  if (opened) {
    const order = visible.some(c => c.key === opened.key) ? visible : sorted
    const index = order.findIndex(c => c.key === opened.key)
    const prev = order[index - 1]
    const next = order[index + 1]
    return (
      <main className="page lst-page br-page is-detail" ref={pageRef}>
        <DetailHead
          title="Credentials 상세"
          index={index + 1}
          total={order.length}
          back="Credentials"
          unit="자격증명"
          onBack={back}
          onPrev={prev ? () => open(prev.key, mode, true) : undefined}
          onNext={next ? () => open(next.key, mode, true) : undefined}
        />
        <BlastDetail
          key={`${opened.key}-${mode}`}
          credential={opened}
          mode={mode}
          graph={graph}
          onMode={m => open(opened.key, m, true)}
          onSelectObject={onSelectObject}
        />
      </main>
    )
  }

  const providerList = [...new Set(credentials.map(c => c.provider))].sort((a, b) => providerRank(a) - providerRank(b))
  const providerCount = (p: Provider) => credentials.filter(c => c.provider === p).length
  const providerItems = providerList
    .map(p => ({ key: p, label: <><Logo provider={p} />{providerName(p)}</>, count: providerCount(p), title: providerName(p) }))
  const adminCount = credentials.filter(isAdmin).length
  /* 분포 범례는 두 가정 어디에든 있는 단계만 */
  const shownTiers = TIERS.filter(t => credentials.some(c => tierOf(c.token) === t || tierOf(c.account) === t))
  const groups = TIERS.map(tier => ({ tier, rows: visible.filter(c => tierOf(c.token) === tier) })).filter(g => g.rows.length)

  const changeView = (v: View) => {
    setView(v)
    writeListMemory<ListMemory>(MEMORY_KEY, { view: v })
  }
  const toggleProvider = (p: Provider) => {
    const nextProviders = providers.includes(p) ? providers.filter(x => x !== p) : [...providers, p]
    setProviders(nextProviders)
    writeListMemory<ListMemory>(MEMORY_KEY, { providers: nextProviders })
  }

  return (
    <main className="page lst-page br-page br-list" ref={pageRef}>
      <header className="page-title-bar page-title-bar-inset">
        <h1>Credentials</h1>
      </header>

      {credentials.length === 0 ? (
        <p className="lst-empty">자격증명이 없습니다.</p>
      ) : (
        <>
          <div className="lst-toolbar">
            <Segmented<View>
              label="목록 보기"
              value={view}
              onChange={changeView}
              items={[
                { key: 'all', label: '전체', count: credentials.length },
                { key: 'cross', label: '다른 SaaS 영향', count: credentials.filter(isCross).length },
                { key: 'admin', label: '관리자 권한 노출', count: adminCount },
              ]}
            />
            <ChipGroup<Provider> legend="SaaS" items={providerItems} isOn={p => providers.includes(p)} onToggle={toggleProvider} />
          </div>

          {/* 전체 현황: 거르기와 상관없이 전체 자격증명을 센다 */}
          <section className="br-overview" aria-label="전체 현황">
            <div className="br-overview-head">
              <h2>전체 현황</h2>
              <span><b>{credentials.length}</b>자격증명</span>
              {providerList.map(p => <span key={p} className="br-overview-saas"><Logo provider={p} /><b>{providerCount(p)}</b>{providerName(p)}</span>)}
              <span className="br-overview-hero">
                <Hero label="관리자 권한 노출" count={adminCount} unit="개" onClick={() => changeView('admin')} none="관리자 권한 노출 자격증명 없음" />
              </span>
            </div>
            <TierDistribution credentials={credentials} shown={shownTiers} />
          </section>

          <LiveCount count={visible.length} noun="자격증명" unit="개" />
          <div className="lst-list br-table">
            <div className="lst-head br-grid" aria-hidden="true">
              <span>자격증명</span>
              <span>소유자</span>
              <span>{MODE_LABEL.token}</span>
              <span>{MODE_LABEL.account}</span>
              <span>만료</span>
              <span />
            </div>
            {visible.length === 0 && <p className="lst-empty">조건에 맞는 자격증명이 없습니다.</p>}
            {groups.map((g, i) => (
              <section key={g.tier} className="br-group" aria-label={`${MODE_LABEL.token} 시 ${TIER_LABEL[g.tier]}`}>
                <h3 className="br-group-head">
                  <span className="br-no">{i + 1}</span>
                  <TierSquare tier={g.tier} />
                  {MODE_LABEL.token} 시 {TIER_LABEL[g.tier]}
                  <em>{g.rows.length}개</em>
                </h3>
                {g.rows.map(c => (
                  <button
                    type="button"
                    key={c.key}
                    data-cred={c.key}
                    className={`lst-row br-grid ${c.key === lastId ? 'is-recent' : ''}`}
                    onClick={() => open(c.key)}
                  >
                    <span className="br-cred">
                      <Logo provider={c.provider} />
                      <span className="lst-main">
                        <b className="lst-clip" title={objectLabel(c.key, graph)}>{objectLabel(c.key, graph)}</b>
                        <span className="lst-text lst-clip" title={objectIdLabel(c.key, graph)}>{objectTypeLabel(c.key, graph)} <code>{objectIdLabel(c.key, graph)}</code></span>
                      </span>
                    </span>
                    <span className="lst-text lst-clip" data-label="소유자" title={c.token.ownerKey ? objectLabel(c.token.ownerKey, graph) : ''}>
                      {c.token.ownerKey ? objectLabel(c.token.ownerKey, graph) : '—'}
                    </span>
                    <span data-label={MODE_LABEL.token}><ReachCell radius={c.token} graph={graph} /></span>
                    <span data-label={MODE_LABEL.account}><ReachCell radius={c.account} graph={graph} /></span>
                    <span className="lst-num" data-label="만료">{expiresAt(c, graph) ?? '—'}</span>
                    <ChevronRight className="lst-row-go" size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                ))}
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  )
}

/** 경로 한 단계: 두 끝은 굵게, 역할이나 권한은 괄호에. 문장(hopSentence)은 커서를 올리면 뜬다 */
function HopLine({ hop, graph }: { hop: BlastHop; graph: GraphStoreV2 }) {
  const ends = hopEnds(hop, graph)
  return (
    <p className="br-path-ends" title={hopSentence(hop, graph)}>
      <b>{ends.from}</b> → <b>{ends.to}</b>{ends.note && <span> ({ends.note})</span>}
    </p>
  )
}

function BlastDetail({ credential, mode, graph, onMode, onSelectObject }: {
  credential: CredentialBlast
  mode: BlastMode
  graph: GraphStoreV2
  onMode: (mode: BlastMode) => void
  onSelectObject: (objectKey: string, path?: InvestigationPath) => void
}) {
  const radius = mode === 'token' ? credential.token : credential.account
  const notes = [...new Set(radius.notes.map(n => noteSentence(n, graph)).filter(Boolean))]
  const reached = reachedNodes(radius)
  const [selected, setSelected] = useState(radius.highest?.key ?? reached[0]?.key ?? credential.key)
  const path = blastPathTo(radius, selected)
  const selectedNode = radius.nodes.find(n => n.key === selected)
  const obj = graph.objectsByKey.get(credential.key)
  const scopes = obj?.canonical.properties.scopes
  const providers = [...new Set(reached.map(n => n.provider))].sort((a, b) => providerRank(a) - providerRank(b))

  return (
    <section className="lst-panel br-panel">
      <div className="lst-dhead">
        <div className="lst-dhead-main">
          <h2 className="lst-name">
            <Logo provider={credential.provider} />
            {objectLabel(credential.key, graph)}
          </h2>
          <dl className="lst-meta">
            <div><dt>유형</dt><dd>{objectTypeLabel(credential.key, graph)}</dd></div>
            <div><dt>ID</dt><dd><code>{objectIdLabel(credential.key, graph)}</code></dd></div>
            <div><dt>소유자</dt><dd>{radius.ownerKey ? objectLabel(radius.ownerKey, graph) : '—'}</dd></div>
            {expiresAt(credential, graph) && <div><dt>만료</dt><dd>{expiresAt(credential, graph)}</dd></div>}
          </dl>
          {Array.isArray(scopes) && scopes.length > 0 && (
            <p className="br-scopes"><span>scope</span> <code>{scopes.map(String).join(' ')}</code></p>
          )}
        </div>
        <div className="lst-dside">
          <Segmented<BlastMode>
            label="탈취 시나리오"
            value={mode}
            onChange={onMode}
            items={[
              { key: 'token', label: MODE_LABEL.token, count: reachedNodes(credential.token).length },
              { key: 'account', label: MODE_LABEL.account, count: reachedNodes(credential.account).length },
            ]}
          />
        </div>
      </div>

      <dl className="br-stats">
        <div>
          <dt>최고 권한</dt>
          <dd>
            <b className={radius.highest?.level === 'admin' ? 'is-admin' : ''}>{headline(radius, graph)}</b>
            {radius.highest && <em className={`br-badge ${radius.certainty === 'inferred' ? 'is-inferred' : ''}`}>{CERTAINTY_LABEL[radius.certainty]}</em>}
          </dd>
        </div>
        <div>
          <dt>영향 대상</dt>
          <dd><b>{reached.length}</b>개</dd>
        </div>
        <div>
          <dt>영향 SaaS</dt>
          <dd className="br-stat-logos">{providers.length ? providers.map(p => <Logo key={p} provider={p} />) : '—'}</dd>
        </div>
        <div>
          <dt>조직 관리 권한</dt>
          <dd>
            {radius.tenantAdmins.length
              ? radius.tenantAdmins.map(n => (
                <button type="button" key={n.key} className="br-link" onClick={() => setSelected(n.key)}>
                  {providerName(n.provider)}{n.certainty === 'inferred' ? ` (${CERTAINTY_LABEL.inferred})` : ''}
                </button>
              ))
              : '없음'}
          </dd>
        </div>
      </dl>

      <NodeStandardFindings nodeKey={credential.key} Block={FindingsBlock} />

      {reached.length === 0 ? (
        <p className="lst-empty">영향 대상이 없습니다.</p>
      ) : (
        <div className="br-body">
          <BlastRadiusGraph radius={radius} graph={graph} selectedKey={selected} onSelect={setSelected} />
          <aside className="br-path" aria-label="고른 객체까지의 경로">
            <h3 className="lst-h2">{selectedNode ? reachLabel(selectedNode, graph) : objectLabel(selected, graph)}</h3>
            <ol className="br-path-list">
              {path.map(hop => (
                <li key={hop.id} className={hop.certainty === 'inferred' ? 'is-inferred' : ''}>
                  <span className="br-path-kind">
                    {hopKindLabel(hop.kind)}
                    <em className={`br-badge ${hop.certainty === 'inferred' ? 'is-inferred' : ''}`}>{CERTAINTY_LABEL[hop.certainty]}</em>
                  </span>
                  <HopLine hop={hop} graph={graph} />
                </li>
              ))}
            </ol>
            {selectedNode && selectedNode.level && (
              <p className="br-path-level">획득 권한: <b>{levelLabel(selectedNode.level, viaKind(selectedNode))}</b>{selectedNode.roleName ? ` (${selectedNode.roleName})` : ''}</p>
            )}
            <button type="button" className="ex-btn" onClick={() => onSelectObject(selected, hopsPath(graph, path))}>
              <Waypoints size={14} strokeWidth={2} /> 그래프에서 보기
            </button>
          </aside>
        </div>
      )}

      {notes.length > 0 && (
        <section className="lst-section br-notes" aria-label="참고">
          <h3 className="lst-h2">참고</h3>
          <ul>
            {notes.map(text => <li key={text}>{text}</li>)}
          </ul>
        </section>
      )}
    </section>
  )
}
