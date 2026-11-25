import type { Hop, ScenarioGraph } from './scenarioGraph'
import { EXTERNAL, hopMethod, isExternal, METHOD_ORDER, peerName, type LinkMethod } from './saasLinks'

/**
 * 자산 보기의 계산 (PoC). 자산은 Resource Interface 가 있는 객체다(회사 밖 노드는 빼고).
 * 자산에 닿는 연결은 두 가지를 센다.
 *  1. 자산과 바로 이어진 홉의 상대 끝이 다른 SaaS 나 회사 밖이면 그 홉 하나.
 *  2. 상대 끝이 같은 SaaS 의 연결 수단(Automation, Integration, Credential, Endpoint)이면, 그 수단이 다른 SaaS 나 회사 밖과 이어진 홉과
 *     수단–자산 홉의 두 칸 사슬. 수단을 한 번만 거슬러 올라간다. 사슬은 흐름 순서로 둔다(자산이 시작이면 자산 쪽 홉이 앞).
 * 연결 방식은 다른 SaaS 와 잇는 홉으로 정한다.
 */
export interface ReachPeer { b: string; chains: Hop[][] }
export interface ReachGroup { method: LinkMethod; peers: ReachPeer[] }

const CONNECTORS = ['Automation', 'Integration', 'Credential', 'Endpoint']

const interfacesOf = (sg: ScenarioGraph, k: string) => sg.engine.ix.node(k).interfaces as readonly string[]

/** 그 SaaS 의 자산을 객체 타입별로. 자산이 많은 타입부터, 같으면 타입 이름 순 */
export function assetsOf(sg: ScenarioGraph, saas: string): Array<{ type: string; keys: string[] }> {
  const byType = new Map<string, string[]>()
  for (const o of sg.graph.objectsByProvider.get(saas) ?? []) {
    if (!o.canonical.interfaces.includes('Resource')) continue
    const key = o.fixture_key
    if (isExternal(sg, key)) continue
    const type = o.canonical.object_type
    byType.set(type, [...(byType.get(type) ?? []), key])
  }
  return [...byType].map(([type, keys]) => ({ type, keys }))
    .sort((x, y) => y.keys.length - x.keys.length || x.type.localeCompare(y.type))
}

/** 노드마다 닿는 홉 (양쪽 끝) */
export function hopIndex(sg: ScenarioGraph): Map<string, Hop[]> {
  const idx = new Map<string, Hop[]>()
  for (const h of sg.allHops()) {
    for (const k of [h.from, h.to]) idx.set(k, [...(idx.get(k) ?? []), h])
  }
  return idx
}

const otherEnd = (h: Hop, k: string) => (h.from === k ? h.to : h.from)

/** 자산에 닿는 연결을 연결 방식별, 상대(다른 SaaS 또는 회사 밖)별로. external 이 아니면 회사 밖은 뺀다. 간선 없는 방식은 뺀다 */
export function reachOf(sg: ScenarioGraph, idx: Map<string, Hop[]>, asset: string, external = false): ReachGroup[] {
  const saas = sg.provider(asset)
  const sideOf = (k: string) => (isExternal(sg, k) ? EXTERNAL : sg.provider(k))
  const groups = new Map<LinkMethod, Map<string, Hop[][]>>()
  const seen = new Set<string>()
  const add = (peer: string, chain: Hop[], cross: Hop) => {
    if (peer === EXTERNAL && !external) return
    const id = chain.map(h => `${h.from}>${h.to}`).join('|')
    if (seen.has(id)) return
    seen.add(id)
    const m = hopMethod(sg, cross)
    const peers = groups.get(m) ?? new Map<string, Hop[][]>()
    peers.set(peer, [...(peers.get(peer) ?? []), chain])
    groups.set(m, peers)
  }
  for (const h of idx.get(asset) ?? []) {
    const other = otherEnd(h, asset)
    const side = sideOf(other)
    if (side !== saas) { add(side, [h], h); continue }
    if (!CONNECTORS.some(i => interfacesOf(sg, other).includes(i))) continue
    for (const h2 of idx.get(other) ?? []) {
      if (h2 === h) continue
      const side2 = sideOf(otherEnd(h2, other))
      if (side2 !== saas) add(side2, h.from === asset ? [h, h2] : [h2, h], h2)
    }
  }
  return METHOD_ORDER.filter(m => groups.has(m)).map(method => ({
    method,
    peers: [...groups.get(method)!].map(([b, chains]) => ({ b, chains }))
      .sort((x, y) => y.chains.length - x.chains.length || peerName(x.b).localeCompare(peerName(y.b))),
  }))
}

/** 자산에 닿는 연결 수 */
export const reachCount = (groups: ReachGroup[]) => groups.reduce((n, g) => n + g.peers.reduce((m, p) => m + p.chains.length, 0), 0)
