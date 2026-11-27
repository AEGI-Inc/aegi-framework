import type { InvestigationPath } from '../semantic-graph/investigationQuery'
import { useEffect, useMemo, useRef, useState } from 'react'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId, providerName } from '../findings/providers'
import type { PathStep, ScenarioGraph } from './scenarioGraph'
import { chainsAcross, EXTERNAL, methodsOf, nextMethods, METHOD_LABEL, METHOD_ORDER, peerName, saasCounts, UNKNOWN_PEER, type LinkMethod, type MethodGroup } from './saasLinks'
import OrbGraph, { type OrbItem } from './OrbGraph'
import LinkResults, { type Found } from './LinkResults'

/**
 * SaaS 연결 (PoC). 처음에는 그래프의 SaaS 를 로고 원으로 둥글게 띄운다. 하나를 누르면 그 SaaS 가 가운데로 오고 오른쪽으로 가지를 펼친다.
 * 가지를 누르면 그 노드가 가운데로 오며 다시 가지를 펼친다. 단계는 SaaS → 연결 방식 → 상대이고, 상대 SaaS 에서 다시 연결 방식 → 다음 SaaS 로 이어 간다.
 * 이 탭은 경로가 아니라 SaaS 사이 연결 방식의 지도라서, 구간끼리 같은 객체로 이어지는지는 따지지 않는다(그건 경로 만들기). 지나온 SaaS 는 다시 나오지 않고, 외부에서는 더 뻗지 않는다.
 * 방향을 지킨다: SaaS 를 고르면 그 SaaS 에서 나가는 연결만 센다(Slack → GitHub 와 GitHub → Slack 은 다른 묶음). 회사 밖에서 들어오는 연결만 예외로 받는 SaaS 에 둔다.
 * 아래 목록(LinkResults)은 고른 단계에 따라 바로 바뀐다. 아무것도 고르지 않으면 모든 SaaS 의 연결, 고르면 지나온 구간마다(마지막 구간은 고른 데까지) 간선이다.
 * 위 상자의 검색창에 이름을 넣으면 그 이름이 든 줄만 남긴다.
 * 구간이 둘 이상이면 앞 구간 간선이 도착한 객체에서 다음 구간 간선이 이어지는 사슬을 「이어지는 연결」로 먼저 보인다.
 * 원 아래에 간선 수는 적지 않는다(멘토 의견 2026-11-10). 간선이 없어도 빼지 않는다. 연결 방식은 여섯 가지를, 방식 아래 상대는 다른 SaaS 전부와 외부를 늘 띄우고, 간선이 없는 것은 흐리게 0 으로 둔다.
 * SaaS 가 없는 노드(누구나, 익명 호출자)와 회사·제3자가 호스팅하는 Endpoint 는 늘 상대 「외부」로 넣는다.
 */
/** 이름 검색 글을 치다 멈춘 뒤 목록에 적용하기까지 (ms) */
const SEARCH_DELAY = 300

type Level =
  | { kind: 'saas'; saas: string }
  | { kind: 'method'; saas: string; method: LinkMethod }
  | { kind: 'peer'; saas: string; method: LinkMethod; peer: string }

const levelId = (l: Level): string =>
  l.kind === 'saas' ? `s:${l.saas}`
    : l.kind === 'method' ? `m:${l.saas}:${l.method}`
      : `p:${l.saas}:${l.method}:${l.peer}`

/** 연결 방식 원 안에 넣는 짧은 글 */
export const METHOD_SHORT: Record<LinkMethod, string> = { oauth_app: 'OAuth', automation: '자동화', credential: '토큰', sso: 'SSO', other: '기타' }

interface Props {
  sg: ScenarioGraph
  onSelectObject: (k: string, path?: InvestigationPath) => void
  onOpenPath: (provider: string, path: PathStep[]) => void
}

export function SaasIcon({ p }: { p: string }) {
  if (p === EXTERNAL) return <span className="scb-orb-glyph">외부</span>
  if (p === UNKNOWN_PEER) return <span className="scb-orb-glyph">미확인</span>
  return <ProviderLogo provider={providerLogoId(p)} />
}

export default function SaasLinksView({ sg, onSelectObject, onOpenPath }: Props) {
  // 회사 밖(누구나, 익명 호출자, 회사나 제3자가 호스팅하는 주소)은 늘 상대 「외부」로 넣는다
  const external = true
  const counts = useMemo(() => saasCounts(sg, external), [sg, external])
  const groupsOf = useMemo(() => {
    const cache = new Map<string, MethodGroup[]>()
    return (saas: string) => {
      if (!cache.has(saas)) cache.set(saas, methodsOf(sg, saas, external))
      return cache.get(saas)!
    }
  }, [sg, external])
  /** 빈 경로는 처음 화면(SaaS 둘레) */
  const [path, setPath] = useState<Level[]>([])
  /** 이름 검색 글. 고른 조건이 없으면 모든 SaaS 의 연결에서, 있으면 그 결과 안에서 찾는다. 치다 멈추면 SEARCH_DELAY 뒤에, 검색 단추나 Enter 면 바로 적용한다 */
  const [query, setQuery] = useState('')
  const [applied, setApplied] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setApplied(query.trim()), SEARCH_DELAY)
    return () => clearTimeout(t)
  }, [query])

  const providers = [...counts.keys()].sort((a, b) => providerName(a).localeCompare(providerName(b)))
  /** 고른 조건이 없을 때 보이는 전체 연결. 같은 간선이 양쪽 SaaS 에서 두 번 나오므로 처음 것만 둔다 */
  const allResults = useMemo(() => {
    const seen = new Set<string>()
    const found = providers.flatMap(saas => groupsOf(saas).flatMap(g => g.peers.flatMap(p => p.hops.map(hop => ({ hops: [hop], method: g.method, peer: p.b, anchor: saas })))))
      .filter(f => { const id = `${f.hops[0].from}|${f.hops[0].to}`; if (seen.has(id)) return false; seen.add(id); return true })
    return { saas: providers[0] ?? '', label: '전체 SaaS', found, chains: undefined as Found[] | undefined, query: '' }
    // providers 는 counts 에서 나온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, groupsOf])
  const groupOf = (saas: string, method: LinkMethod) => groupsOf(saas).find(g => g.method === method)
  const hopsOf = (saas: string, method: LinkMethod, peer: string) => groupOf(saas, method)?.peers.find(p => p.b === peer)?.hops ?? []

  const orbOf = (l: Level): OrbItem => {
    const id = levelId(l)
    switch (l.kind) {
      case 'saas': {
        const n = counts.get(l.saas) ?? 0
        return { id, icon: <SaasIcon p={l.saas} />, name: providerName(l.saas), title: providerName(l.saas), empty: n === 0 }
      }
      case 'method': {
        const g = groupOf(l.saas, l.method)
        const n = g?.peers.reduce((s, p) => s + p.hops.length, 0) ?? 0
        return { id, icon: <span className="scb-orb-glyph">{METHOD_SHORT[l.method]}</span>, name: METHOD_LABEL[l.method], title: `${providerName(l.saas)} 의 ${METHOD_LABEL[l.method]}`, empty: n === 0 }
      }
      case 'peer': {
        const n = hopsOf(l.saas, l.method, l.peer).length
        return { id, icon: <SaasIcon p={l.peer} />, name: peerName(l.peer), title: `${providerName(l.saas)} ↔ ${peerName(l.peer)}, ${METHOD_LABEL[l.method]}`, empty: n === 0 }
      }
    }
  }

  const childrenOf = (l: Level): Level[] => {
    switch (l.kind) {
      case 'saas':
        return METHOD_ORDER.map(method => ({ kind: 'method', saas: l.saas, method }))
      case 'method': {
        // 간선 있는 상대(간선 많은 순)를 먼저, 그 뒤에 간선 없는 SaaS 와 외부를 이름 순으로. 지나온 SaaS 는 뺀다. 상대 미확인은 간선 있을 때만 나온다
        const visited = new Set(path.flatMap(x => (x.kind === 'peer' ? [x.saas, x.peer] : [x.saas])))
        const linked = (groupOf(l.saas, l.method)?.peers ?? []).map(p => p.b).filter(p => !visited.has(p))
        const rest = [...providers, ...(external ? [EXTERNAL] : [])].filter(p => !visited.has(p) && !linked.includes(p))
        return [...linked, ...rest].map(peer => ({ kind: 'peer', saas: l.saas, method: l.method, peer }))
      }
      case 'peer':
        // 상대 SaaS 에서 다시 연결 방식을 펼친다. 회사 밖과 이어 갈 수 없는 방식(OAuth 앱, SSO)은 더 뻗지 않는다(nextMethods)
        return nextMethods(l.method, l.peer).map(method => ({ kind: 'method', saas: l.peer, method }))
    }
  }

  const focus = path.length ? path[path.length - 1] : null
  const kidLevels = focus ? childrenOf(focus) : []

  // 같은 노드를 빠르게 두 번 누르면 같은 단계가 두 번 쌓이지 않게 한다
  const enter = (l: Level) => setPath(p => (p.length && levelId(p[p.length - 1]) === levelId(l) ? p : [...p, l]))
  const goTo = (i: number) => setPath(p => p.slice(0, i + 1))

  /* 검색 단추나 Enter 로 찾으면 그래프 아래 결과 목록을 화면 위쪽으로 올린다 */
  const resultsRef = useRef<HTMLDivElement>(null)
  const search = () => {
    setApplied(query.trim())
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }

  // 결과는 고른 단계와 이름 검색 글이 바뀌면 바로 다시 만든다
  const shown = useMemo(() => {
    const q = applied
    const at = path.length ? path[path.length - 1] : null
    if (!at) return q ? { ...allResults, label: `「${q}」`, query: q } : allResults
    // 구간: 지나온 상대마다 (SaaS, 방식, 상대). 마지막이 방식이면 그 방식의 모든 상대, 처음 SaaS 만 골랐으면 모든 방식과 상대
    const segments: Array<{ saas: string; method?: LinkMethod; peer?: string }> = path.flatMap(l => (l.kind === 'peer' ? [{ saas: l.saas, method: l.method, peer: l.peer }] : []))
    if (at.kind === 'method') segments.push({ saas: at.saas, method: at.method })
    if (at.kind === 'saas') segments.push({ saas: at.saas })
    const perSegment = segments.map(seg => groupsOf(seg.saas)
      .filter(g => !seg.method || g.method === seg.method)
      .flatMap(g => g.peers
        .filter(p => !seg.peer || p.b === seg.peer)
        .flatMap(p => p.hops.map(hop => ({ hops: [hop], method: g.method, peer: p.b, anchor: seg.saas })))))
    const found = perSegment.flat()
    let chains: Found[] | undefined
    if (segments.length > 1) {
      const meta = segments.map(seg => `${providerName(seg.saas)} → ${seg.peer ? peerName(seg.peer) : '?'}${seg.method ? ` ${METHOD_LABEL[seg.method]}` : ''}`).join(', ')
      const last = segments[segments.length - 1]
      chains = chainsAcross(sg, segments.map((seg, i) => ({ hops: perSegment[i].map(f => f.hops[0]), peer: seg.peer })))
        .map(hops => ({ hops, method: last.method ?? segments[0].method!, peer: last.peer ?? '', anchor: segments[0].saas, meta }))
    }
    return { saas: path[0].saas, label: [...path.map(l => orbOf(l).name), ...(q ? [`「${q}」`] : [])].join(', '), found, chains, query: q }
    // orbOf 는 counts, groupsOf 에서 나온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sg, path, applied, allResults, groupsOf])

  return (
    <div className="scb-inset scb-pair">
      <div className="scb-links-bar">
        <div className="scb-links-bar-row">
          <label className="scb-links-bar-label" htmlFor="scb-links-query">검색 조건</label>
          <input
            id="scb-links-query"
            type="search"
            className="scb-links-query"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search() }}
            placeholder="계정, 앱, 채널 이름으로 찾기 (예: dev.person38, /devbot, Okta Workflows)"
          />
          <button type="button" className="ex-btn primary scb-links-search" onClick={search} title="치는 대로 아래 목록이 바뀐다. 누르면 기다리지 않고 바로 찾는다">검색</button>
        </div>
        <nav className="scb-tree-trail" aria-label="지나온 단계">
          <button type="button" className="scb-link" aria-current={path.length === 0 ? 'step' : undefined} onClick={() => setPath([])}>전체 SaaS</button>
          {path.map((l, i) => (
            <button type="button" key={levelId(l)} className="scb-link" aria-current={i === path.length - 1 ? 'step' : undefined} onClick={() => goTo(i)}>{orbOf(l).name}</button>
          ))}
        </nav>
      </div>
      <OrbGraph
        label="SaaS 연결 그래프"
        ring={providers.map(p => orbOf({ kind: 'saas', saas: p }))}
        past={path.slice(0, -1).map(orbOf)}
        focus={focus && orbOf(focus)}
        kids={kidLevels.map(orbOf)}
        onRing={id => { const p = providers.find(x => levelId({ kind: 'saas', saas: x }) === id); if (p) enter({ kind: 'saas', saas: p }) }}
        onPast={goTo}
        onReset={() => setPath([])}
        onKid={id => { const l = kidLevels.find(k => levelId(k) === id); if (l) enter(l) }}
      />
      <div ref={resultsRef} className="scb-results-anchor" aria-hidden="true" />
      {shown.chains && <LinkResults key={`chains:${shown.label}`} title="이어지는 연결" empty="앞 구간이 도착한 객체에서 다음 구간이 이어지는 연결은 없음" sg={sg} saas={shown.saas} label={shown.label} found={shown.chains} query={shown.query} directed onSelectObject={onSelectObject} onOpenPath={onOpenPath} />}
      <LinkResults key={shown.label} title={shown.chains ? '구간별 연결' : path.length || applied ? '검색 결과' : '전체 연결'} sg={sg} saas={shown.saas} label={shown.label} found={shown.found} query={shown.query} directed onSelectObject={onSelectObject} onOpenPath={onOpenPath} />
    </div>
  )
}
