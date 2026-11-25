import type { InvestigationPath } from '../semantic-graph/investigationQuery'
import { useMemo, useState } from 'react'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId, providerName } from '../findings/providers'
import type { PathStep, ScenarioGraph } from './scenarioGraph'
import { EXTERNAL, METHOD_LABEL, METHOD_ORDER, peerName, saasCounts, type LinkMethod } from './saasLinks'
import { assetsOf, hopIndex, reachCount, reachOf, type ReachGroup } from './assetLinks'
import OrbGraph, { type OrbItem } from './OrbGraph'
import LinkResults, { type Found } from './LinkResults'
import { METHOD_SHORT, SaasIcon } from './SaasLinksView'

/**
 * 자산 (PoC). SaaS 연결과 같은 원 그래프로 SaaS → 자산 종류 → 자산 → 연결 방식 → 상대 순서로 고른다.
 * 자산은 Resource Interface 가 있는 객체이고, 자산에 닿는 연결은 assetLinks.reachOf 가 센다(바로 이어진 다른 SaaS 홉과, 같은 SaaS 연결 수단을 한 번 거친 홉).
 * 간선이 없어도 빼지 않는다. 후보가 많으면 앞의 KID_LIMIT 개와 「더 보기」를 둔다. 「검색」은 고른 데까지의 조건으로 연결을 아래 목록에 늘어놓는다.
 */
type Level =
  | { kind: 'saas'; saas: string }
  | { kind: 'type'; saas: string; type: string }
  | { kind: 'asset'; saas: string; type: string; asset: string }
  | { kind: 'method'; saas: string; type: string; asset: string; method: LinkMethod }
  | { kind: 'peer'; saas: string; type: string; asset: string; method: LinkMethod; peer: string }

const levelId = (l: Level): string =>
  l.kind === 'saas' ? `s:${l.saas}`
    : l.kind === 'type' ? `t:${l.saas}:${l.type}`
      : l.kind === 'asset' ? `a:${l.asset}`
        : l.kind === 'method' ? `m:${l.asset}:${l.method}`
          : `p:${l.asset}:${l.method}:${l.peer}`

const KID_LIMIT = 10
const MORE_ID = '__more'

interface Props {
  sg: ScenarioGraph
  onSelectObject: (k: string, path?: InvestigationPath) => void
  onOpenPath: (provider: string, path: PathStep[]) => void
}

export default function AssetView({ sg, onSelectObject, onOpenPath }: Props) {
  const [external, setExternal] = useState(true)
  const idx = useMemo(() => hopIndex(sg), [sg])
  const providers = useMemo(() => [...saasCounts(sg).keys()].sort((a, b) => providerName(a).localeCompare(providerName(b))), [sg])
  const typesOf = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof assetsOf>>()
    return (saas: string) => {
      if (!cache.has(saas)) cache.set(saas, assetsOf(sg, saas))
      return cache.get(saas)!
    }
  }, [sg])
  const reach = useMemo(() => {
    const cache = new Map<string, ReachGroup[]>()
    return (asset: string) => {
      if (!cache.has(asset)) cache.set(asset, reachOf(sg, idx, asset, external))
      return cache.get(asset)!
    }
  }, [sg, idx, external])
  const [path, setPath] = useState<Level[]>([])
  const [showAll, setShowAll] = useState(false)
  const [results, setResults] = useState<{ saas: string; label: string; found: Found[] } | null>(null)
  const toggleExternal = () => { setExternal(x => !x); setPath([]); setResults(null) }

  const keysOf = (saas: string, type: string) => typesOf(saas).find(t => t.type === type)?.keys ?? []
  /** 타입 이름: 대시보드 이름표(예: Slack 채널)에서 SaaS 이름을 뗀 것. 이름표가 없어 Interface 이름(Resource)만 남으면 객체 타입 그대로 */
  const typeName = (saas: string, type: string) => {
    const k = keysOf(saas, type)[0]
    const label = k ? sg.typeLabel(k) : type
    const name = label.startsWith(providerName(saas)) ? label.slice(providerName(saas).length).trim() : label
    return !name || (k && name === sg.primaryInterface(k)) ? type : name
  }
  const groupOf = (asset: string, method: LinkMethod) => reach(asset).find(g => g.method === method)

  const orbOf = (l: Level): OrbItem => {
    const id = levelId(l)
    switch (l.kind) {
      case 'saas': {
        const n = typesOf(l.saas).reduce((s, t) => s + t.keys.length, 0)
        return { id, icon: <SaasIcon p={l.saas} />, name: providerName(l.saas), title: providerName(l.saas), empty: n === 0 }
      }
      case 'type': {
        const name = typeName(l.saas, l.type)
        return { id, icon: <span className="scb-orb-glyph">{name.slice(0, 3)}</span>, name, title: `${providerName(l.saas)} ${name} (${l.type})` }
      }
      case 'asset': {
        const n = reachCount(reach(l.asset))
        return { id, icon: <ProviderLogo provider={providerLogoId(l.saas)} />, name: sg.name(l.asset), title: `${sg.typeLabel(l.asset)}\n${sg.name(l.asset)}`, empty: n === 0 }
      }
      case 'method': {
        const g = groupOf(l.asset, l.method)
        const n = g?.peers.reduce((s, p) => s + p.chains.length, 0) ?? 0
        return { id, icon: <span className="scb-orb-glyph">{METHOD_SHORT[l.method]}</span>, name: METHOD_LABEL[l.method], title: `${sg.name(l.asset)} 에 ${METHOD_LABEL[l.method]}(으)로 닿는 연결`, empty: n === 0 }
      }
      case 'peer': {
        const n = groupOf(l.asset, l.method)?.peers.find(p => p.b === l.peer)?.chains.length ?? 0
        return { id, icon: <SaasIcon p={l.peer} />, name: peerName(l.peer), title: `${peerName(l.peer)} → ${sg.name(l.asset)}, ${METHOD_LABEL[l.method]}`, empty: n === 0 }
      }
    }
  }

  const childrenOf = (l: Level): Level[] => {
    switch (l.kind) {
      case 'saas':
        return typesOf(l.saas).map(t => ({ kind: 'type', saas: l.saas, type: t.type }))
      case 'type':
        // 연결 많은 자산부터, 같으면 이름 순
        return [...keysOf(l.saas, l.type)]
          .sort((a, b) => reachCount(reach(b)) - reachCount(reach(a)) || sg.name(a).localeCompare(sg.name(b)))
          .map(asset => ({ kind: 'asset', saas: l.saas, type: l.type, asset }))
      case 'asset':
        return METHOD_ORDER.map(method => ({ kind: 'method', saas: l.saas, type: l.type, asset: l.asset, method }))
      case 'method': {
        const linked = (groupOf(l.asset, l.method)?.peers ?? []).map(p => p.b)
        const rest = [...providers, ...(external ? [EXTERNAL] : [])].filter(p => p !== l.saas && !linked.includes(p))
        return [...linked, ...rest].map(peer => ({ kind: 'peer', saas: l.saas, type: l.type, asset: l.asset, method: l.method, peer }))
      }
      case 'peer':
        return []
    }
  }

  const focus = path.length ? path[path.length - 1] : null
  const allKids = focus ? childrenOf(focus) : []
  const kidLevels = showAll ? allKids : allKids.slice(0, KID_LIMIT)
  const kids = kidLevels.map(orbOf)
  if (allKids.length > kidLevels.length) {
    const rest = allKids.length - kidLevels.length
    kids.push({ id: MORE_ID, icon: <span className="scb-orb-glyph">+{rest}</span>, name: `${rest}개 더 보기`, title: `${rest}개 더 보기` })
  }

  const enter = (l: Level) => { setShowAll(false); setPath(p => (p.length && levelId(p[p.length - 1]) === levelId(l) ? p : [...p, l])) }
  const goTo = (i: number) => { setShowAll(false); setPath(p => p.slice(0, i + 1)) }

  const search = () => {
    if (!focus) return
    const assets = focus.kind === 'saas' ? typesOf(focus.saas).flatMap(t => t.keys)
      : focus.kind === 'type' ? keysOf(focus.saas, focus.type) : [focus.asset]
    const found = assets.flatMap(asset => reach(asset)
      .filter(g => (focus.kind !== 'method' && focus.kind !== 'peer') || g.method === focus.method)
      .flatMap(g => g.peers
        .filter(p => focus.kind !== 'peer' || p.b === focus.peer)
        .flatMap(p => p.chains.map(hops => ({ hops, method: g.method, peer: p.b })))))
    setResults({ saas: focus.saas, label: path.map(l => orbOf(l).name).join(', '), found })
  }

  return (
    <div className="scb-inset scb-pair">
      <label className="scb-tree-toggle" title="누구나, 익명 호출자, 회사나 제3자가 호스팅하는 주소를 상대 「외부」로 넣는다">
        <input type="checkbox" checked={external} onChange={toggleExternal} /> 회사 밖 포함
      </label>
      <nav className="scb-tree-trail" aria-label="지나온 단계">
        <button type="button" className="scb-link" aria-current={path.length === 0 ? 'step' : undefined} onClick={() => goTo(-1)}>전체 SaaS</button>
        {path.map((l, i) => (
          <button type="button" key={levelId(l)} className="scb-link" aria-current={i === path.length - 1 ? 'step' : undefined} onClick={() => goTo(i)}>{orbOf(l).name}</button>
        ))}
        <button type="button" className="ex-btn primary scb-links-search" disabled={!focus} onClick={search} title={focus ? '지금 고른 조건에 맞는 연결을 아래에 늘어놓는다' : 'SaaS 를 먼저 고르세요'}>검색</button>
      </nav>
      <OrbGraph
        label="자산 그래프"
        ring={providers.map(p => orbOf({ kind: 'saas', saas: p }))}
        past={path.slice(0, -1).map(orbOf)}
        focus={focus && orbOf(focus)}
        kids={kids}
        onRing={id => { const p = providers.find(x => `s:${x}` === id); if (p) enter({ kind: 'saas', saas: p }) }}
        onPast={goTo}
        onReset={() => goTo(-1)}
        onKid={id => {
          if (id === MORE_ID) { setShowAll(true); return }
          const l = allKids.find(k => levelId(k) === id)
          if (l) enter(l)
        }}
      />
      {results && <LinkResults key={results.label} sg={sg} saas={results.saas} label={results.label} found={results.found} onSelectObject={onSelectObject} onOpenPath={onOpenPath} />}
    </div>
  )
}
