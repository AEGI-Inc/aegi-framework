import { Fragment, useMemo, useState } from 'react'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId, providerName } from '../findings/providers'
import type { Hop, PathStep, ScenarioGraph } from './scenarioGraph'
import { appPeerSource, EXTERNAL, isTokenRow, linkContext, linkRole, METHOD_LABEL, peerName, UNKNOWN_PEER, type AppPeerSource, type LinkContext, type LinkMethod } from './saasLinks'
import { hopWord } from './plainText'
import { nameOf, officialName } from './officialNames'
import { useAssistantBridge } from '../assistant/AssistantBridge'
import { emptySelection, SELECTION_LIMIT, type AssistantSelection } from '../assistant/workspace'
import { chainPath } from '../semantic-graph/chainPath'
import type { InvestigationPath } from '../semantic-graph/investigationQuery'

/**
 * 검색 결과 목록 (SaaS 연결, 자산 공용). 결과를 기준 SaaS ↔ 상대 묶음으로 나눠 많은 순으로 둔다.
 * 줄 앞에는 그 연결을 시작할 수 있는 사람 계정이나 그룹을 하나씩 붙이고(여럿이면 계정마다 줄을 나눈다), 뒤에는 연동이 동작으로 닿는 리소스를 붙인다.
 * OAuth 앱, SSO 줄에서 앱에 권한 간선(G)으로 이어진 승인 사용자가 있으면 그 계정들을 「승인, 배정」으로 맨 앞에 한 칸으로 붙이고, 시작 계정 칸은 두지 않으며 줄도 나누지 않는다.
 * 연동 객체의 실행 신원은 가운데 흐름에서 연동 객체를 그린 칸 바로 뒤에 「실행 신원」으로 붙인다(linkContext). 그 칸이 없으면 가운데 흐름 뒤, 닿는 리소스 앞이다.
 * 앱 규칙 줄(appPeerSource 가 null 이 아닌 줄)은 가운데에 앱 하나만 그리고 자기 조직 칸은 그리지 않는다. 앱 종류 값으로 상대 SaaS 를 정했으면 실행 신원 뒤(없으면 앱 뒤)에
 * 「연결」 화살표와 상대 SaaS 칸(「조직 미확인」)을 둔다. 상대를 못 가렸으면 상대 칸을 두지 않는다.
 * 토큰 줄(isTokenRow)은 토큰의 주인이 있으면 맨 앞에 「소유」로 붙이고(시작 계정 칸은 두지 않고 줄도 나누지 않는다), 토큰을 쓰는 자동화가 있으면 줄 끝에 「사용」으로 붙인다.
 * 봇과 서비스 계정은 연동이 남의 SaaS 에서 쓰는 신원이라 시작 계정에 넣지 않는다.
 * 같은 자동화가 낸 조각 줄은 한 줄로 합친다(mergeAutomations). 객체 이름이 id 뿐이면 수집 속성의 이름을 쓴다(nameOf).
 * 가운데 연동이 둘 이상 이어지면 첫 연동 하나로 접어 「외 N개」를 붙인다(foldMiddle). 뒤에 리소스가 없는 줄의 마지막 객체는 접지 않는다.
 * 줄에는 객체를 흐름 순서로 로고, 객체 이름 아래 공식 이름(officialName, 예: Okta Workflows, Google Workspace 계정)과 사이 간선 종류(화살표)로 잇는다.
 * 겉보기가 같은 줄(이름이 같은 다른 객체)은 한 줄로 합쳐 ×개수를 붙이고, 누르면 한 칸에 모아 보인다.
 * 줄을 누르면 단추 셋(AI에게 묻기, 그래프에서 조사하기, Event Board에서 이벤트 보기)이 나온다(FoundDetail).
 * hops 는 흐름 순서다. SaaS 연결은 홉 하나, 자산은 다른 SaaS 와 잇는 홉과 같은 SaaS 안의 홉(수단–자산) 두 칸일 수 있다.
 */
/** 「Event Board에서 이벤트 보기」로 넘기는 기간 (일) */
const EVENT_BOARD_DAYS = 7

/** anchor: 이 줄의 기준 SaaS (방향과 수단을 이 SaaS 기준으로 적는다). 없으면 목록의 saas */
export interface Found {
  hops: Hop[]; method: LinkMethod; peer: string; anchor?: string; meta?: string
  /** 같은 자동화의 조각을 합친 줄(mergeAutomations)에서: 자동화를 시작시키는 리소스, 사슬 밖에서 닿는 리소스, 합친 조각의 홉 */
  trigger?: string; extraResources?: string[]; mergedHops?: Hop[]
}

/** 목록 줄에 적을 연결 수단 객체를 고르는 순서 (Interface) */
const MECHANISM_ORDER = ['Automation', 'Integration', 'Credential', 'Endpoint']

/** 간선이 어떤 수단으로 이어지나: 연결 수단 객체(없으면 고른 SaaS 쪽 끝)와 고른 SaaS 에서 나가는지 */
function mechanism(sg: ScenarioGraph, saas: string, hop: Hop): { via: string; out: boolean } {
  const ends = [hop.from, hop.to]
  const ifaces = (k: string) => sg.engine.ix.node(k).interfaces as readonly string[]
  const via = MECHANISM_ORDER.map(i => ends.find(k => ifaces(k).includes(i))).find(Boolean)
    ?? ends.find(k => sg.provider(k) === saas) ?? hop.from
  return { via, out: sg.provider(hop.from) === saas }
}

function Logo({ sg, k }: { sg: ScenarioGraph; k: string }) {
  const p = sg.provider(k)
  return p ? <span className="scb-logo"><ProviderLogo provider={providerLogoId(p)} /></span> : null
}

/** 홉을 흐름 순서로 이은 객체 줄. via 는 앞 객체와 잇는 홉과 방향(back 이면 이 객체에서 앞 객체로). 앞 객체와 끝이 안 닿으면 홉 시작부터 새로 적는다.
 *  첫 홉의 시작에서 다음 홉이 나가면(부품 → 자동화, 부품 → 상대) 첫 홉을 거꾸로 적어 자동화 → 부품 → 상대로 잇는다 */
function flowOf(hops: Hop[]): Array<{ key: string; via?: { hop: Hop; back: boolean } }> {
  const out: Array<{ key: string; via?: { hop: Hop; back: boolean } }> = []
  for (const [i, h] of hops.entries()) {
    const last = out[out.length - 1]?.key
    if (last === h.from) out.push({ key: h.to, via: { hop: h, back: false } })
    else if (last === h.to) out.push({ key: h.from, via: { hop: h, back: true } })
    else if (i === 0 && hops[1]?.from === h.from) out.push({ key: h.to }, { key: h.from, via: { hop: h, back: true } })
    else out.push({ key: h.from }, { key: h.to, via: { hop: h, back: false } })
  }
  return out
}

/** 사슬에서 SaaS 경계를 넘는 홉 (없으면 첫 홉) */
const crossOf = (sg: ScenarioGraph, f: Found) => f.hops.find(h => sg.provider(h.from) !== sg.provider(h.to)) ?? f.hops[0]

/**
 * account: 이 줄을 시작하는 계정(없으면 null), resources: 연동이 닿는 리소스.
 * 단추 셋은 모두 다른 화면으로 넘어가 더 보는 것이다: 「이 연결 AI에게 묻기」(이 연결의 객체와 관계를 고른 채 AI 창에 질문을 넣는다),
 * 「그래프에서 조사하기」(이 연결의 객체와 사이 경로만 보이게 Cross-SaaS Graph 를 연다),
 * 「Event Board에서 이벤트 보기」(이 연결의 객체로 Event Board 조사를 연다. 이 화면에서는 이벤트를 불러오지 않는다).
 */
function FoundDetail({ sg, items, account, trigger, resources, ctx, onSelectObject }: { sg: ScenarioGraph; items: Found[]; account: string | null; trigger: string | null; resources: string[]; ctx: LinkContext; onSelectObject: (k: string, path?: InvestigationPath) => void }) {
  // 겉보기가 같아 합친 줄(×개수)도 칸은 하나다. 객체, 관계, 이벤트는 합친 연결 전부에서 모은다
  const hops = items.flatMap(f => f.mergedHops ?? f.hops)
  const keys = [...new Set(hops.flatMap(h => [h.from, h.to]))]
  const all = [...new Set([...(account ? [account] : []), ...(trigger ? [trigger] : []), ...keys, ...resources])]
  const flowKeys = flowOf(items[0].hops).map(s => s.key)
  const bridge = useAssistantBridge()
  return (
    <section className="scb-analysis scb-found-detail" aria-label="연결 설명">
      <div className="scb-found-actions">
        {bridge && (
          <button type="button" className="ex-btn primary" onClick={() => bridge.ask(selectionOf(sg, all, hops), askQuestion(sg, account, flowKeys, resources), undefined, true)}
            title="이 연결의 객체와 관계를 고른 채 오른쪽 AI 창에 묻는다">이 연결 AI에게 묻기</button>
        )}
        <button type="button" className="ex-btn" onClick={() => onSelectObject(account ?? keys[0], linkPath(sg, account, items, resources, ctx))} title="이 연결의 객체와 사이 경로를 Cross-SaaS Graph 에서 연다. 거기서 이웃을 펼치거나 다른 경로를 찾는다">그래프에서 조사하기</button>
        <button type="button" className="ex-btn" onClick={() => { window.location.hash = `#event-board?objects=${encodeURIComponent(all.join(','))}&days=${EVENT_BOARD_DAYS}` }} title="이 연결의 객체가 든 최근 7일 이벤트를 Event Board 에서 조사한다">Event Board에서 이벤트 보기</button>
      </div>
    </section>
  )
}

/** 그래프 관계 키: 홉 간선(엔진 간선)이 가리키는 relation */
const relationsOf = (sg: ScenarioGraph, hops: Hop[]) => hops.flatMap(h => h.edgeIds.flatMap(id => sg.engine.ix.edges.get(id)?.refs.filter(r => r.type === 'relation').map(r => r.id) ?? []))

/** 엔진 간선 근거 종류. 관계 이름이 아니다 */
const REF_KINDS = new Set(['observation', 'evidence', 'evidence_link', 'link', 'relation'])

/**
 * 「전체 그래프 보기」로 넘기는 사슬: 승인 사용자, 시작 계정 → 흐름 객체 → 실행 신원 → 닿는 리소스와 그 사이 관계.
 * 시작 계정에서 첫 객체까지(firstHops), 승인 사용자에서 연동 객체까지(G), 연동 객체에서 실행 신원까지(hopCard identities), 리소스까지(hopCard actions)의 간선도 넣는다
 */
function linkPath(sg: ScenarioGraph, account: string | null, items: Found[], resources: string[], ctx: LinkContext): InvestigationPath {
  const flow = flowOf(items[0].hops).map(s => s.key)
  const hops = items.flatMap(f => f.hops)
  if (account) hops.push(...(sg.firstHops(account, new Set([account])).find(l => l.to === flow[0])?.hops ?? []))
  if (ctx.link && ctx.users.length) hops.push(...sg.allHops().filter(h => h.to === ctx.link && h.kinds.includes('G') && ctx.users.includes(h.from)))
  if (ctx.link) hops.push(...sg.hopCard(ctx.link).identities.filter(h => ctx.identities.includes(h.to)))
  // 토큰 줄: 주인과 쓰는 쪽을 토큰과 잇는 간선
  if (ctx.link && (ctx.owners.length || ctx.usedBy.length)) {
    hops.push(...sg.allHops().filter(h => (h.to === ctx.link && [...ctx.owners, ...ctx.usedBy].includes(h.from)) || (h.from === ctx.link && ctx.owners.includes(h.to))))
  }
  for (const r of resources) hops.push(...(flow.map(k => sg.hopCard(k).actions.find(l => l.to === r)).find(Boolean)?.hops ?? []))
  const path = chainPath(sg.graph, [...ctx.owners, ...ctx.users, ...(account ? [account] : []), ...flow, ...ctx.identities, ...resources, ...ctx.usedBy], [...new Set(relationsOf(sg, hops))])
  // 수집된 관계로 못 이은 홉(엔진이 관측, 규칙으로 만든 간선)도 그래프가 선으로 그리게 넘긴다. 선 이름은 관계 이름, 없으면 간선 종류 말
  const seen = new Set<string>()
  const links = hops.filter(h => { const id = `${h.from}|${h.to}`; if (seen.has(id)) return false; seen.add(id); return true })
    .map(h => {
      // 관계가 없는 간선은 rels 에 근거 종류(observation, evidence)가 들어 있어 선 이름으로 쓰지 않는다
      const rels = h.rels.filter(r => !REF_KINDS.has(r))
      return { from: h.from, to: h.to, relationTypes: rels.length ? rels : [hopWord(h)] }
    })
  return { ...path, links }
}

/** AI 창에 넘길 선택: 줄의 객체와, 홉 간선이 가리키는 그래프 관계 (각각 SELECTION_LIMIT 까지) */
function selectionOf(sg: ScenarioGraph, objects: string[], hops: Hop[]): AssistantSelection {
  const relations = [...new Set(relationsOf(sg, hops))]
  return { ...emptySelection(), objectKeys: objects.slice(0, SELECTION_LIMIT), relationKeys: relations.slice(0, SELECTION_LIMIT) }
}

/** 「user@example.com」이 「/devbot」을 거쳐 「저장소」에 무엇을 할 수 있는지 묻는 질문 */
function askQuestion(sg: ScenarioGraph, account: string | null, keys: string[], resources: string[]): string {
  const q = (k: string) => `「${nameOf(sg, k)}」`
  // 닿는 리소스가 없으면 흐름의 마지막 객체가 끝이다
  const end = resources.length ? resources : keys.slice(-1)
  const via = (resources.length ? keys : keys.slice(0, -1)).map(q).join(' → ')
  const to = end.map(q).join(', ')
  if (account) return `${q(account)} 계정이 ${via ? `${via} 를 거쳐 ` : ''}${to}에 무엇을 할 수 있는지, 원래 권한과 비교해서 설명해줘.`
  return `${via ? `${via} 연결이 ` : ''}${to}에 무엇을 할 수 있고 누가 이 연결을 시작할 수 있는지 설명해줘.`
}

export default function LinkResults({ sg, saas, label, found, query = '', directed = false, onSelectObject, onOpenPath, title = '검색 결과', empty = '이 조건에 맞는 연결이 없음' }: {
  sg: ScenarioGraph
  title?: string
  empty?: string
  /** 고른 SaaS (방향과 수단을 이 SaaS 기준으로 적는다) */
  saas: string
  label: string
  found: Found[]
  /** 이름 검색 글. 있으면 시작 계정, 승인 사용자, 흐름 객체, 실행 신원, 닿는 리소스의 이름이나 공식 이름에 이 글이 든 줄만 남긴다 */
  query?: string
  /** 결과가 기준 SaaS 에서 상대로 나가는 간선뿐이다 (SaaS 연결 탭) */
  directed?: boolean
  onSelectObject: (k: string, path?: InvestigationPath) => void
  onOpenPath: (provider: string, path: PathStep[]) => void
}) {
  const [chosen, setChosen] = useState('')
  // 방향 있는 목록(SaaS 연결)은 묶음 머리를 「A → B」로 적는다. 회사 밖은 양쪽 방향이 한 묶음이라 ↔. 상대 미확인(UNKNOWN_PEER)은 앱에서 나가는 줄이라 →
  const arrowOf = (peer: string) => (directed && peer !== EXTERNAL ? '→' : '↔')
  const metaOf = (f: Found) => {
    const anchor = f.anchor ?? saas
    const { via, out } = mechanism(sg, anchor, crossOf(sg, f))
    return f.meta ?? `${METHOD_LABEL[f.method]}, ${sg.typeLabel(via)}, ${providerName(anchor)} ↔ ${peerName(f.peer)} ${out ? '나감' : '들어옴'}`
  }
  // 진입점 찾기(entriesForHop)가 무거워 줄을 펼치고 접을 때마다 다시 하지 않는다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const merged = useMemo(() => mergeAutomations(sg, found), [sg, found])
  const groups = useMemo(() => filterRows(sg, groupFound(sg, saas, merged, metaOf), query), [sg, saas, merged, query])
  const shown = groups.reduce((n, g) => n + g.rows.length, 0)
  return (
    <section className="scb-links-results" aria-label={title}>
      <h2>{title} {query ? shown : merged.length} <small>{label}</small></h2>
      {shown === 0
        ? <p className="scb-empty">{empty}</p>
        : groups.map(g => (
          <section key={g.id} className="scb-links-group" aria-label={`${providerName(g.anchor)} ${arrowOf(g.peer)} ${peerName(g.peer)}`}>
            <h3><SaasMark p={g.anchor} />{providerName(g.anchor)} {arrowOf(g.peer)} <SaasMark p={g.peer} />{peerName(g.peer)}<small>{query ? g.rows.length : g.count}</small></h3>
            <ul>
              {g.rows.map(r => {
                const on = chosen === r.id
                // 앱 규칙 줄은 앱 하나만 그린다(자기 조직 칸과 그 앞 화살표는 그리지 않는다)
                const cells = r.peerSource !== null && r.ctx.link
                  ? [{ step: { key: r.ctx.link }, folded: [] as string[] }]
                  : foldMiddle(sg, flowOf(r.items[0].hops), r.ends.resources.length === 0)
                // 실행 신원과 상대 칸은 연동 객체(ctx.link)를 그린 칸 바로 뒤에 둔다. 그린 칸이 없으면 가운데 흐름 뒤
                const linkAt = r.ctx.link ? cells.findIndex(c => c.step.key === r.ctx.link || c.folded.includes(r.ctx.link!)) : -1
                const afterLink = (
                  <>
                    {r.ctx.identities.length > 0 && <span className="scb-links-step"><Edge label="실행 신원" /><EndNode sg={sg} keys={r.ctx.identities} what="계정" /></span>}
                    {r.peerSource === 'type' && (
                      <span className="scb-links-step">
                        <Edge label="연결" />
                        <span className="scb-links-node" title="앱 종류 값으로 상대 SaaS 는 알지만, 그 SaaS 의 어느 조직과 이어졌는지는 수집된 값이 없다">
                          <SaasMark p={g.peer} /><b>{peerName(g.peer)}</b><small>조직 미확인</small>
                        </span>
                      </span>
                    )}
                  </>
                )
                return (
                  <li key={r.id}>
                    <button type="button" className={`scb-links-row${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setChosen(on ? '' : r.id)}>
                      <span className="scb-links-chain">
                        {r.ctx.owners.length > 0 && <span className="scb-links-step"><EndNode sg={sg} keys={r.ctx.owners} what="주인" /><Edge label="소유" /></span>}
                        {r.ctx.users.length > 0 && <span className="scb-links-step"><EndNode sg={sg} keys={r.ctx.users} what="계정" /><Edge label="승인, 배정" /></span>}
                        {r.account && <span className="scb-links-step"><EndNode sg={sg} keys={[r.account]} what="계정" /><Edge label="시작" /></span>}
                        {r.trigger && <span className="scb-links-step"><EndNode sg={sg} keys={[r.trigger]} what="리소스" /><Edge label="실행" /></span>}
                        {cells.map(({ step: s, folded }, i) => (
                          <Fragment key={`${i}:${s.key}`}>
                            <span className="scb-links-step">
                              {s.via && <Edge label={hopWord(s.via.hop)} back={s.via.back} />}
                              <span className="scb-links-node" title={[s.key, ...folded].map(k => `${officialName(sg, k)}: ${nameOf(sg, k)}`).join(', ')}>
                                <Logo sg={sg} k={s.key} /><b>{nameOf(sg, s.key)}</b><small>{officialName(sg, s.key)}{folded.length > 0 && <em className="scb-links-fold"> 외 {folded.length}개</em>}</small>
                              </span>
                            </span>
                            {i === linkAt && afterLink}
                          </Fragment>
                        ))}
                        {linkAt < 0 && afterLink}
                        {r.ends.resources.length > 0 && <span className="scb-links-step"><Edge label="닿음" /><EndNode sg={sg} keys={r.ends.resources} what="리소스" /></span>}
                        {r.ctx.usedBy.length > 0 && <span className="scb-links-step"><Edge label="사용" back /><EndNode sg={sg} keys={r.ctx.usedBy} what="자동화" /></span>}
                        {dupCount(r) > 1 && <span className="scb-links-dup" title="이름과 연결이 같은 객체가 여럿 있다. 누르면 한 칸에 모아 보인다">×{dupCount(r)}</span>}
                      </span>
                    </button>
                    {on && <FoundDetail sg={sg} items={r.items} account={r.account} trigger={r.trigger} resources={r.ends.resources} ctx={r.ctx} onSelectObject={onSelectObject} />}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
    </section>
  )
}

/** 결과 줄 양 끝의 종류. 사람 계정과 그룹은 계정, 리소스는 리소스, 그 밖(자동화, 봇과 서비스 계정, 연동, 자격)은 연동 */
type End = 'account' | 'link' | 'resource'
const endOf = (sg: ScenarioGraph, k: string): End => {
  const r = linkRole(sg, k)
  return r === 'person' ? 'account' : r === 'resource' ? 'resource' : 'link'
}
/**
 * 객체마다 그 객체를 첫 홉으로 부를 수 있는 진입점(entriesForHop 과 같은 기준). 이름 검색은 모든 SaaS 의 연결을 한 번에 보므로
 * 줄마다 진입점을 다시 찾지 않고 그래프마다 한 번 만든다
 */
const STARTERS = new WeakMap<ScenarioGraph, Map<string, string[]>>()
function startersOf(sg: ScenarioGraph): Map<string, string[]> {
  let index = STARTERS.get(sg)
  if (index) return index
  index = new Map()
  for (const e of sg.entries().values()) {
    for (const entry of [...e.people, ...e.bots, ...e.groups]) {
      for (const leg of sg.firstHops(entry, new Set([entry]))) {
        const list = index.get(leg.to) ?? []
        if (!list.includes(entry)) index.set(leg.to, [...list, entry])
      }
    }
  }
  STARTERS.set(sg, index)
  return index
}

/**
 * 같은 자동화가 낸 조각 줄을 한 줄로 합친다. 자동화(Flow, 규칙)가 자격(Named Credential 등)으로 상대 SaaS 에 닿으면 SaaS 를 건너는 간선이
 * 「자동화 → 상대 계정」, 「자동화 → 리소스」, 「자격 → 상대 계정」, 「자격 → 리소스」처럼 여럿 나오는데 모두 같은 일이다.
 * 묶는 기준은 수집된 관계뿐이다: 간선이 자동화에서 시작하거나, 같은 SaaS 의 자동화 하나만 실행 신원(A)으로 쓰는 자격에서 시작할 때.
 * 자격을 쓰는 자동화가 둘 이상이면 어느 것의 조각인지 알 수 없어 묶지 않는다. 묶은 줄은 자동화 → 자격 → 상대 계정(없으면 리소스) 순서이고,
 * 사슬 밖 리소스는 extraResources, 자동화를 시작시키는 리소스(T 간선)는 trigger 로 둔다. 홉이 여럿인 줄(이어지는 연결)은 그대로 둔다.
 * 간선이 자동화 안의 부품(요청 주소, Flow 의 Slack 동작)에서 시작하면 부품이 contained_in 으로 속한 같은 SaaS 의 자동화 하나로 올려 자동화 → 부품 → 상대로 둔다.
 * 속한 자동화가 둘 이상이거나 자동화와 부품을 잇는 홉이 없으면 올리지 않는다. 앱 규칙 줄(appPeerSource)과 토큰 줄(isTokenRow)은 자동화 쪽으로 합치지 않는다
 */
function mergeAutomations(sg: ScenarioGraph, found: Found[]): Found[] {
  const isAuto = (k: string) => (sg.engine.ix.node(k).interfaces as readonly string[]).includes('Automation')
  const inside = (a: string, b: string) => (sg.graph.outgoingRelationsByObject.get(a) ?? []).some(r => r.relationType === 'contained_in' && r.targetKey === b)
  const runner = new Map<string, string | null>()
  for (const h of sg.allHops()) {
    if (!isAuto(h.from) || isAuto(h.to) || !h.kinds.includes('A') || sg.provider(h.from) !== sg.provider(h.to)) continue
    const prev = runner.get(h.to)
    // 한 자격을 자동화 둘이 쓰는데 한쪽이 다른 쪽에 담긴 것(Flow 와 그 Flow 의 Apex 동작)이면 담는 쪽 하나로 본다
    runner.set(h.to, !runner.has(h.to) || prev === h.from ? h.from : prev && inside(h.from, prev) ? prev : prev && inside(prev, h.from) ? h.from : null)
  }
  // 부품을 올린 자동화와, 자동화와 부품을 잇는 홉(방향 무관)
  const partLink = new Map<string, Hop>()
  const ownerOf = (k: string): string | null => {
    const owners = [...new Set((sg.graph.outgoingRelationsByObject.get(k) ?? [])
      .filter(r => r.relationType === 'contained_in' && isAuto(r.targetKey) && sg.provider(r.targetKey) === sg.provider(k)).map(r => r.targetKey))]
    if (owners.length !== 1) return null
    const link = sg.allHops().find(h => (h.from === owners[0] && h.to === k) || (h.from === k && h.to === owners[0]))
    if (!link) return null
    partLink.set(k, link)
    return owners[0]
  }
  const autoOf = (f: Found) => (f.hops.length !== 1 || appPeerSource(sg, f.hops[0]) !== null || isTokenRow(sg, f.hops[0]) ? null
    : isAuto(f.hops[0].from) ? f.hops[0].from : runner.get(f.hops[0].from) ?? ownerOf(f.hops[0].from))
  const buckets = new Map<string, { auto: string; items: Found[] }>()
  const order: Array<Found | string> = []
  for (const f of found) {
    const auto = autoOf(f)
    if (!auto) { order.push(f); continue }
    const id = `${f.anchor ?? ''}|${f.peer}|${auto}`
    if (!buckets.has(id)) { buckets.set(id, { auto, items: [] }); order.push(id) }
    buckets.get(id)!.items.push(f)
  }
  return order.map(x => {
    if (typeof x !== 'string') return x
    const { auto, items } = buckets.get(x)!
    const all = items.map(f => f.hops[0])
    const cred = all.find(h => h.from !== auto)?.from
    const inner = cred ? sg.hopCard(auto).identities.find(h => h.to === cred) ?? partLink.get(cred) : undefined
    const fromCred = all.filter(h => h.from === cred)
    const pick = fromCred.find(h => endOf(sg, h.to) !== 'resource') ?? fromCred[0]
    const fromAuto = all.filter(h => h.from === auto)
    const hops = inner && pick ? [inner, pick] : [fromAuto.find(h => endOf(sg, h.to) !== 'resource') ?? fromAuto[0] ?? all[0]]
    const chain = new Set(hops.flatMap(h => [h.from, h.to]))
    const first = items.find(f => f.hops[0].from === auto) ?? items[0]
    return {
      ...first, hops,
      extraResources: [...new Set(all.map(h => h.to).filter(k => !chain.has(k) && endOf(sg, k) === 'resource'))],
      trigger: sg.hopCard(auto).triggers.map(h => h.from).find(k => !chain.has(k) && endOf(sg, k) === 'resource'),
      mergedHops: [...all, ...(inner ? [inner] : [])],
    }
  })
}

/** 연결 앞뒤로 붙이는 끝: 이 연결을 시작할 수 있는 계정(사람, 그룹)과 연동이 닿는 리소스 */
interface Ends { accounts: string[]; resources: string[] }

/**
 * 줄 양 끝을 계정, 리소스까지 내린다. 첫 객체가 계정이 아니면 그 객체를 부를 수 있는 진입점 중 사람과 그룹(entriesForHop)을,
 * 마지막 객체가 리소스가 아니면 사슬의 자동화가 동작(F, E)으로 닿는 리소스(hopCard actions)를 붙인다.
 */
function endsOf(sg: ScenarioGraph, f: Found): Ends {
  const keys = flowOf(f.hops).map(s => s.key)
  const first = keys[0], last = keys[keys.length - 1]
  const accounts = endOf(sg, first) === 'account' ? []
    : (startersOf(sg).get(first) ?? []).filter(k => !keys.includes(k) && endOf(sg, k) === 'account')
  const resources = endOf(sg, last) === 'resource' ? []
    : [...new Set(keys.flatMap(k => sg.hopCard(k).actions.map(l => l.to)))].filter(k => !keys.includes(k) && endOf(sg, k) === 'resource')
  return { accounts, resources: [...new Set([...resources, ...(f.extraResources ?? []).filter(k => !keys.includes(k))])] }
}

/**
 * 줄에서 가운데 연동(계정도 리소스도 아닌 객체)이 둘 이상 이어지면 첫 연동 하나로 접는다. 접힌 객체는 folded 로 돌려 「외 N개」와 마우스 글로 보인다.
 * 접힌 뒤 다음 칸의 화살표는 마지막 연동에서 오는 간선이다. 전체 흐름은 펼친 칸의 「그래프 보기」에서 본다.
 * keepLast(뒤에 붙는 리소스가 없는 줄)면 마지막 객체는 접지 않는다. 그 객체가 상대 SaaS 쪽 끝이라 접으면 어디에 닿는지 안 보인다
 */
function foldMiddle(sg: ScenarioGraph, flow: ReturnType<typeof flowOf>, keepLast: boolean): Array<{ step: ReturnType<typeof flowOf>[number]; folded: string[] }> {
  const out: Array<{ step: ReturnType<typeof flowOf>[number]; folded: string[] }> = []
  for (const [i, step] of flow.entries()) {
    const last = out[out.length - 1]
    const isEnd = keepLast && i === flow.length - 1
    if (last && !isEnd && endOf(sg, last.step.key) === 'link' && endOf(sg, step.key) === 'link') last.folded.push(step.key)
    else out.push({ step, folded: [] })
  }
  return out
}

/** 줄 안의 관계: 위에 작은 관계 이름, 아래에 화살표 (back 이면 ←) */
function Edge({ label, back }: { label: string; back?: boolean }) {
  return <span className="scb-links-edge"><small>{label}</small><i aria-hidden="true">{back ? '←' : '→'}</i></span>
}

/** 붙인 끝 하나: 첫 이름과 나머지 개수, 마우스를 올리면 전부 */
function EndNode({ sg, keys, what }: { sg: ScenarioGraph; keys: string[]; what: string }) {
  if (!keys.length) return null
  return (
    <span className="scb-links-node is-end" title={keys.map(k => nameOf(sg, k)).join(', ')}>
      <Logo sg={sg} k={keys[0]} /><b>{nameOf(sg, keys[0])}{keys.length > 1 ? ` 외 ${keys.length - 1}${what === '계정' ? '명' : '개'}` : ''}</b><small>{officialName(sg, keys[0])}</small>
    </span>
  )
}

/** 합친 줄에 든 서로 다른 객체 묶음 수. 방향만 다른 같은 두 객체(A → B, B → A)는 하나로 센다 */
const dupCount = (r: Row) => new Set(r.items.map(f => [...new Set(f.hops.flatMap(h => [h.from, h.to]))].sort().join('|'))).size

/** 묶음 머리의 SaaS 로고 (외부, 상대 미확인은 로고 없이 이름만) */
function SaasMark({ p }: { p: string }) {
  return p && p !== EXTERNAL && p !== UNKNOWN_PEER ? <span className="scb-logo"><ProviderLogo provider={providerLogoId(p)} /></span> : null
}

/** account: 이 줄을 시작하는 계정 하나 (시작 계정이 여럿이면 계정마다 줄을 나눈다. 승인 사용자가 있으면 null) */
/** trigger: 시작 계정이 없을 때 앞에 붙이는, 자동화를 시작시키는 리소스 */
/** ctx: 줄의 연동 객체, 실행 신원, 승인 사용자(linkContext). peerSource: 앱 줄의 상대를 무엇으로 정했나(appPeerSource). 둘 다 줄의 첫 연결 기준 */
interface Row { id: string; items: Found[]; meta: string; account: string | null; trigger: string | null; ends: Ends; ctx: LinkContext; peerSource: AppPeerSource }
interface Group { id: string; anchor: string; peer: string; count: number; rows: Row[] }

/**
 * 결과를 (기준 SaaS, 상대) 묶음으로 나누고, 연결마다 시작 계정 하나씩 줄을 만든다(시작 계정이 없거나 승인 사용자가 있으면 한 줄).
 * 묶음 안에서 겉보기(시작 계정, 이은 객체 이름, 간선 종류, 아래 작은 글, 승인 사용자와 실행 신원 이름)가 같은 줄은 한 줄로 합친다.
 * 묶음은 결과가 많은 순(같으면 상대 이름 순), 줄은 처음 나온 순
 */
function groupFound(sg: ScenarioGraph, saas: string, found: Found[], metaOf: (f: Found) => string): Group[] {
  const groups = new Map<string, Group>()
  for (const f of found) {
    const anchor = f.anchor ?? saas
    const gid = `${anchor}|${f.peer}`
    if (!groups.has(gid)) groups.set(gid, { id: gid, anchor, peer: f.peer, count: 0, rows: [] })
    const g = groups.get(gid)!
    g.count++
    const ends = endsOf(sg, f)
    const meta = metaOf(f)
    // 시작 계정도 닿는 리소스도 없는 홉 하나짜리 줄은 같은 두 객체를 방향만 바꿔 이은 것(A → B, B → A)을 한 줄로 합친다
    const pairOnly = f.hops.length === 1 && !ends.accounts.length && !ends.resources.length
    const look = pairOnly
      ? `pair:${[f.hops[0].from, f.hops[0].to].sort().join('|')}`
      : `${flowOf(f.hops).map(s => `${s.via ? `${s.via.back ? '<' : '>'}${hopWord(s.via.hop)}` : ''}${nameOf(sg, s.key)}`).join('|')}|${meta}`
    const ctx = linkContext(sg, f.mergedHops ?? f.hops, f.method)
    const peerSource = f.hops.length === 1 ? appPeerSource(sg, f.hops[0]) : null
    const around = [ctx.users, ctx.identities, ctx.owners, ctx.usedBy].map(ks => ks.map(k => nameOf(sg, k)).join(',')).join('|')
    // 승인 사용자나 토큰 주인이 있으면 같은 사람을 시작 계정으로 다시 보이지 않고 한 줄로 둔다
    for (const account of !ctx.users.length && !ctx.owners.length && ends.accounts.length ? ends.accounts : [null]) {
      const id = `${account ? nameOf(sg, account) : ''}|${look}|${around}`
      const row = g.rows.find(r => r.id === id)
      if (row) row.items.push(f)
      else g.rows.push({ id, items: [f], meta, account, trigger: account ? null : f.trigger ?? null, ends, ctx, peerSource })
    }
  }
  // 상대 SaaS 까지 이어진 묶음을 먼저 보인다. 그 아래에 회사 밖 묶음, 맨 아래에 상대 미확인 묶음을 둔다
  const rank = (g: Group) => (g.peer === UNKNOWN_PEER ? 2 : g.peer === EXTERNAL ? 1 : 0)
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || b.count - a.count || peerName(a.peer).localeCompare(peerName(b.peer)))
}

/** 이름 검색: 줄의 시작 계정, 승인 사용자, 흐름 객체, 실행 신원, 닿는 리소스, 토큰 주인과 쓰는 쪽 중 하나의 이름이나 공식 이름에 글이 들면 남긴다(대소문자 무시). 빈 묶음은 뺀다 */
function filterRows(sg: ScenarioGraph, groups: Group[], query: string): Group[] {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  const hit = (k: string) => nameOf(sg, k).toLowerCase().includes(q) || officialName(sg, k).toLowerCase().includes(q)
  return groups
    .map(g => ({ ...g, rows: g.rows.filter(r => [...(r.account ? [r.account] : []), ...r.ctx.users, ...flowOf(r.items[0].hops).map(s => s.key), ...r.ctx.identities, ...r.ends.resources, ...r.ctx.owners, ...r.ctx.usedBy].some(hit)) }))
    .filter(g => g.rows.length > 0)
}
