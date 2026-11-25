import type { GraphStoreV2 } from '../model/graph'
import type { AccessEngine } from '../detection/v2/engine'
import { OBS_PREFIX } from '../detection/v2/engine'
import type { Edge } from '../detection/v2/engine/types'
import { NEED_LEVEL, accessRows, accountsOf, hasAccessTable, levelName, pointOf, reaches, type AccessLevel, type Need } from '../data/accessTableStore'
import { objectLabel, objectTypeLabel } from '../blast-radius/blastLabels'
import { providerName } from '../findings/providers'

/**
 * 시나리오 만들기 (PoC). 진입점을 고르고, 홉(자동화 하나를 건너는 단위)을 하나씩 펼쳐 사람이 경로를 고르게 한다 (결정 0016 진입점 → 홉 → 영향).
 * 홉의 경계는 호출(T) 간선이고, 홉 안의 실행 신원(A)과 동작(F, E)은 노드로 펼치지 않고 홉 칸으로 보인다.
 * 간선은 엔진이 저장된 사실(관계, Link, 관측)에서 만든 것을 그대로 쓰고, 엔진 방향(권한, 소속, 실행이 흐르는 방향)으로만 잇는다.
 * 경로, 노드 키, 시나리오 이름은 코드에 두지 않는다. 사람 판정은 엔진이 게시한 접근 표에서 고른 경로의 끝 노드 줄을 읽는다.
 */

/** 묶음 순서: 연동, 권한, 소속, 범위 */
const KIND_ORDER = ['T', 'A', 'F', 'E', 'G', 'M', 'U']
/** 간선 종류 이름. 결정 0016 근거 칸의 이름(호출 T, 실행 신원 A, 사본 이동 F, 권한 G). E, M, U 는 팀이 정한 이름이 없다 */
const KIND_NAME: Record<string, string> = { T: '호출', A: '실행 신원', F: '사본 이동', G: '권한' }
export const kindName = (k: string) => KIND_NAME[k] ?? `${k}, 이름 미정`
/** Interface 이름을 고를 때의 우선 순서 */
const INTERFACE_ORDER = ['Principal', 'Automation', 'Credential', 'Integration', 'Endpoint', 'Resource', 'Assignment', 'Policy', 'Tenant']

/** 두 노드 사이 엔진 간선 묶음 (같은 쌍에 A와 F가 함께 있는 것처럼 여럿일 수 있다) */
export interface Hop {
  from: string
  to: string
  edgeIds: string[]
  kinds: string[]
  /** 간선을 만든 관계 이름. 관계가 아니면 출처 종류(observation, link 등) */
  rels: string[]
  /** 엔진 설명 */
  verbs: string[]
}

/** 경로의 한 칸에서 다음 칸까지의 엔진 간선 줄. 그 사이에 지나간 객체(채널, 자원, 자격증명)는 hops 의 중간 끝점이다 */
export interface Leg {
  from: string
  to: string
  hops: Hop[]
}

export interface PathStep {
  key: string
  /** 앞 노드에서 이 노드로 오는 길. 첫 노드는 없다 */
  via?: Leg
}

/** 진입점에서 첫 홉까지 소속, 권한 간선을 몇 번까지 지나갈지 */
const PASS_LIMIT = 3

export const hopSig = (h: Hop) => `${h.rels.join(', ')} (${h.kinds.map(kindName).join(', ')})`

export class ScenarioGraph {
  private readonly pairs = new Map<string, Hop>()
  private readonly outOf = new Map<string, Hop[]>()
  private readonly inOf = new Map<string, Hop[]>()

  constructor(readonly graph: GraphStoreV2, readonly engine: AccessEngine) {
    for (const e of engine.ix.edges.values()) {
      if (e.from === e.to) continue
      const id = `${e.from}|${e.to}`
      let h = this.pairs.get(id)
      if (!h) {
        h = { from: e.from, to: e.to, edgeIds: [], kinds: [], rels: [], verbs: [] }
        this.pairs.set(id, h)
        this.outOf.set(e.from, [...(this.outOf.get(e.from) ?? []), h])
        this.inOf.set(e.to, [...(this.inOf.get(e.to) ?? []), h])
      }
      h.edgeIds.push(e.id)
      if (!h.kinds.includes(e.kind)) h.kinds.push(e.kind)
      for (const r of this.relNames(e)) if (!h.rels.includes(r)) h.rels.push(r)
      if (!h.verbs.includes(e.label)) h.verbs.push(e.label)
    }
    for (const h of this.pairs.values()) h.kinds.sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b))
  }

  private relNames(e: Edge): string[] {
    const rels = e.refs.filter(r => r.type === 'relation').map(r => this.graph.relationsByKey.get(r.id)?.relationType).filter((x): x is NonNullable<typeof x> => !!x)
    return rels.length ? [...new Set(rels)] : [...new Set(e.refs.map(r => r.type))]
  }

  name(key: string): string {
    const label = this.graph.objectsByKey.has(key) ? objectLabel(key, this.graph) : this.engine.ix.node(key).name
    return label.trim() || `${this.objectType(key)} ${key.split(':').pop()}`
  }

  /** 객체의 SaaS. 관측으로 만든 노드(obs:)는 객체가 아니라 SaaS 가 없으므로 그 관측이 가리키는 첫 객체의 SaaS 를 쓴다 */
  provider(key: string): string {
    const seen = key.startsWith(OBS_PREFIX) ? this.engine.ix.observation(key.slice(OBS_PREFIX.length))?.objectKeys[0] : undefined
    return this.engine.ix.provider(seen ?? key) ?? ''
  }

  objectType(key: string): string {
    return this.engine.ix.node(key).type ?? ''
  }

  primaryInterface(key: string): string {
    const list = this.engine.ix.node(key).interfaces
    return INTERFACE_ORDER.find(i => list.includes(i as never)) ?? [...list].sort()[0] ?? ''
  }

  /** 길 이름표: 관계 이름과 간선 종류, 건너간 객체 이름 */
  legText(l: Leg): string {
    return l.hops.map((h, i) => (i === 0 ? hopSig(h) : `${this.name(h.from)} → ${hopSig(h)}`)).join(' → ')
  }

  /** 홉(결정 0016 「SaaS나 자동화를 한 번 건너는 단위」)의 칸. 트리거는 들어오는 호출(T), 실행 신원은 나가는 A, 동작은 나가는 F, E 와 실행 신원이 하는 F, E */
  hopCard(key: string): { triggers: Hop[]; identities: Hop[]; actions: Leg[] } {
    const out = this.outOf.get(key) ?? []
    const isAction = (h: Hop) => h.kinds.some(k => k === 'F' || k === 'E')
    const identities = out.filter(h => h.kinds.includes('A'))
    const actions = new Map<string, Leg>()
    // runs_as 처럼 실행 신원(A)과 사본 이동(F)을 함께 만드는 간선은 실행 신원 칸에만 둔다
    for (const h of out) if (isAction(h) && !h.kinds.includes('A')) actions.set(h.to, { from: key, to: h.to, hops: [h] })
    for (const a of identities) for (const h of this.outOf.get(a.to) ?? []) if (isAction(h) && h.to !== key && !actions.has(h.to)) actions.set(h.to, { from: key, to: h.to, hops: [a, h] })
    return { triggers: (this.inOf.get(key) ?? []).filter(h => h.kinds.includes('T')), identities, actions: [...actions.values()] }
  }

  /** 이 객체에 권한 간선(G)으로 이어진 출발 객체. 같은 SaaS 안만 */
  grantees(key: string): string[] {
    return (this.inOf.get(key) ?? []).filter(h => h.kinds.includes('G') && this.provider(h.from) === this.provider(key)).map(h => h.from)
  }

  /** 진입점에서 처음 부를 수 있는 홉. 소속(M), 권한(G)으로 닿는 곳을 지나 호출(T)까지. 테넌트는 지나지 않는다 */
  firstHops(entry: string, exclude: Set<string>): Leg[] {
    const legs = new Map<string, Leg>()
    const seen = new Set([entry])
    const queue: Array<{ at: string; hops: Hop[] }> = [{ at: entry, hops: [] }]
    while (queue.length) {
      const { at, hops } = queue.shift()!
      for (const h of this.outOf.get(at) ?? []) {
        if (h.kinds.includes('T')) {
          if (!exclude.has(h.to) && !legs.has(h.to)) legs.set(h.to, { from: entry, to: h.to, hops: [...hops, h] })
          continue
        }
        if (seen.has(h.to) || this.engine.ix.isTenant(h.to) || !h.kinds.some(k => k === 'M' || k === 'G') || hops.length >= PASS_LIMIT) continue
        seen.add(h.to)
        queue.push({ at: h.to, hops: [...hops, h] })
      }
    }
    return this.byName([...legs.values()])
  }

  /** 홉 다음 후보: 이 홉이나 이 홉의 동작이 닿은 곳이 호출(T)로 시작시키는 홉, 그리고 동작이 닿은 곳(영향) */
  nextFromHop(key: string, exclude: Set<string>): { hops: Leg[]; impacts: Leg[] } {
    const { actions } = this.hopCard(key)
    const hops = new Map<string, Leg>()
    for (const from of [{ from: key, to: key, hops: [] as Hop[] }, ...actions]) {
      for (const h of this.outOf.get(from.to) ?? []) {
        if (h.kinds.includes('T') && h.to !== key && !exclude.has(h.to) && !hops.has(h.to)) hops.set(h.to, { from: key, to: h.to, hops: [...from.hops, h] })
      }
    }
    return { hops: this.byName([...hops.values()]), impacts: this.byName(actions.filter(l => !exclude.has(l.to))) }
  }

  /** 모든 노드 쌍의 간선 묶음 */
  allHops(): Hop[] {
    return [...this.pairs.values()]
  }

  /** 두 SaaS 를 잇는 엔진 간선 (양쪽 방향) */
  edgesBetween(a: string, b: string): Hop[] {
    return [...this.pairs.values()].filter(h => {
      const p = this.provider(h.from), q = this.provider(h.to)
      return (p === a && q === b) || (p === b && q === a)
    }).sort((x, y) => this.name(x.from).localeCompare(this.name(y.from)))
  }

  private byName(legs: Leg[]): Leg[] {
    return legs.sort((a, b) => this.name(a.to).localeCompare(this.name(b.to)))
  }

  /**
   * 사람이 읽는 타입 이름 (예: Slack 채널). 대시보드 카탈로그에 이름이 없으면 SaaS 이름과 수집 타입 원문(예: GitHub commit).
   * 원문도 없을 때만 Interface 를 쓴다
   */
  typeLabel(key: string): string {
    const label = this.graph.objectsByKey.has(key) ? objectTypeLabel(key, this.graph) : ''
    if (label && label !== this.objectType(key)) return label
    const kind = this.objectType(key) || this.primaryInterface(key)
    return this.provider(key) ? `${providerName(this.provider(key))} ${kind}`.trim() : kind
  }

  /**
   * 진입점 후보 (결정 0016 「경로를 시작시킬 수 있는 주체나 입력」). SaaS별로 사람, 그룹(누구나, 테넌트 포함)으로 나눈다.
   * 호출(T) 간선을 일으키는 노드에서 소속(M), 권한(G) 간선을 거꾸로 따라가 닿는 주체를 모은다.
   * 주체가 아닌 노드(채널 등)는 경로 중간에 나온다. SaaS 가 없는 노드(누구나)는 처음 만난 호출 노드의 SaaS 로 묶는다.
   * 테넌트는 진입점으로는 넣되 거꾸로 따라가지 않는다 (경로 중간에 테넌트를 쓰지 않는 것과 같은 기준).
   */
  entries(): Map<string, { people: string[]; bots: string[]; groups: string[] }> {
    const ix = this.engine.ix
    const origin = new Map<string, string>()
    const queue: string[] = []
    for (const h of this.pairs.values()) {
      if (!h.kinds.includes('T') || origin.has(h.from)) continue
      origin.set(h.from, this.provider(h.from) || this.provider(h.to))
      if (!ix.isTenant(h.from)) queue.push(h.from)
    }
    while (queue.length) {
      const k = queue.shift()!
      for (const h of this.inOf.get(k) ?? []) {
        if (origin.has(h.from) || !h.kinds.some(kind => kind === 'M' || kind === 'G')) continue
        origin.set(h.from, this.provider(h.from) || origin.get(k)!)
        if (!ix.isTenant(h.from)) queue.push(h.from)
      }
    }
    // 앱(Integration)이 실행 신원(A)으로 쓰는 주체는 사람이 아니라 자동화 신원이다 (앱의 봇 계정).
    // 자동화가 사람 권한으로 도는 runs_as 는 앱이 아니라 자동화에서 나오므로 그 사람은 사람으로 남는다
    const actedAs = new Set([...this.pairs.values()].filter(h => h.kinds.includes('A') && ix.has(h.from, 'Integration')).map(h => h.to))
    const out = new Map<string, { people: string[]; bots: string[]; groups: string[] }>()
    for (const [k, p] of origin) {
      const person = ix.isPerson(k)
      if (!person && !ix.isGroupLike(k)) continue
      const slot = out.get(p) ?? { people: [], bots: [], groups: [] }
      ;(!person ? slot.groups : actedAs.has(k) ? slot.bots : slot.people).push(k)
      out.set(p, slot)
    }
    for (const slot of out.values()) for (const list of [slot.people, slot.bots, slot.groups]) list.sort((a, b) => this.name(a).localeCompare(this.name(b)))
    return out
  }

  /** 노드 속성 가운데 글자, 숫자, 참거짓 값만 */
  properties(key: string): Array<[string, string]> {
    const props = this.graph.objectsByKey.get(key)?.canonical.properties ?? {}
    return Object.entries(props).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, String(v)])
  }

  /** 길 하나의 근거: 엔진 간선마다 설명, 불확실 사유, 그리고 간선을 만든 저장된 사실 */
  evidenceOf(leg: Leg) {
    return leg.hops.flatMap(h => h.edgeIds).map(id => this.engine.ix.edges.get(id)!).map(e => ({
      from: this.name(e.from),
      to: this.name(e.to),
      kind: e.kind,
      label: e.label,
      uncertain: e.uncertain,
      observed: e.observed,
      facts: e.refs.map(r => this.refFacts(r.type, r.id)),
    }))
  }

  private refFacts(type: string, id: string): Array<[string, string]> {
    if (type === 'relation') {
      const r = this.graph.relationsByKey.get(id)
      if (!r) return [['관계', id]]
      const facts: Array<[string, string]> = [['관계', r.relationType], ['근거 종류', r.properties.basis]]
      if (r.properties.lifecycle) facts.push(['상태', String(r.properties.lifecycle)])
      if (r.roleName) facts.push(['역할', r.roleName])
      if (r.roleKey) facts.push(['역할 객체', this.name(r.roleKey)])
      // 수집 출처가 없는 관계도 있다 (손으로 넣은 데이터 등)
      if (r.source) facts.push(['수집 API', r.source.api], ['수집 시각', r.source.collected_at])
      if (r.properties.doc) facts.push(['근거 문서', String(r.properties.doc)])
      facts.push(['관계 키', r.relationKey])
      return facts
    }
    if (type === 'link') {
      const l = this.graph.linksById.get(id)
      if (!l) return [['Link', id]]
      return [['Link 등급', l.level], ['판단 방법', l.source.method], ['판단 근거', l.source.basis], ['Link id', l.link_id]]
    }
    return [[type, id]]
  }
}

export type { Need }

/** 차집합(확정), 차집합(미확정), 교집합, 직접 권한만 */
export type Side = 'gap' | 'gap_inferred' | 'both' | 'native_only'

export interface PersonAccess {
  /** 접근 표의 사람 키(같은 사람 계정 묶음의 대표 계정 키). 누구나는 '@everyone' */
  key: string
  /** 보이는 계정. 그 사람의 계정이 경로에 있으면 그 계정, 없으면 대표 계정(묶음은 엔진 접근 표 accounts) */
  account: string
  /** 보이는 계정의 이름 */
  name: string
  side: Side
  /** 직접 권한 수준(권한 간선, 모름 근거 포함) */
  direct: AccessLevel | null
  /** 파생 접근 수준 */
  derived: AccessLevel | null
  /** 새로 생긴 권한이 미확정이면 그 이유 */
  reasons: string[]
  /** 그 수준을 준 연동 지점 */
  point?: string
  /** 연동 지점이나 그 사람의 계정이 이 경로의 노드인가 */
  onPath: boolean
  /** 새로 생긴 권한이 조직 밖 직접 공유로 섰다(접근 표 gained share) */
  share?: true
}

export interface PeopleAnswer {
  need: Need
  people: PersonAccess[]
  /** 누구나에게 새로 생긴 권한이 있다 */
  everyone: boolean
  /** 접근 표가 없는 데이터셋(derived 없음). 사람 판정을 보이지 않는다 */
  missing: boolean
}

/**
 * 끝 노드의 사람별 직접 권한과 파생 접근. 엔진이 게시한 접근 표(derived.access_table)를 읽기만 한다.
 * 차집합은 표의 새로 생긴 권한(gained, 위협 판정과 같은 셈), 교집합은 파생 접근이 닿지만 직접 권한으로도 되는 사람
 */
export function peopleAt(sg: ScenarioGraph, path: PathStep[], need: Need): PeopleAnswer {
  const x = path[path.length - 1].key
  const keys = new Set(path.map(s => s.key))
  const level = NEED_LEVEL[need]
  const people: PersonAccess[] = []
  let everyone = false
  for (const row of accessRows(x)) {
    const gain = row.gained?.[level]
    const side: Side | undefined = gain ? (gain.certainty === '확정' ? 'gap' : 'gap_inferred') : reaches(row.derived, need) ? 'both' : reaches(row.direct, need) ? 'native_only' : undefined
    if (!side) continue
    if (gain && row.person === '@everyone') everyone = true
    const point = side === 'native_only' ? undefined : pointOf(row, need)
    const own = accountsOf(row.person).find(k => keys.has(k))
    const account = own ?? row.person
    people.push({
      key: row.person, account, name: sg.name(account), side, direct: levelName(row.direct), derived: levelName(row.derived),
      reasons: gain?.reasons ?? [], ...(point ? { point } : {}), onPath: (!!point && keys.has(point)) || !!own, ...(gain?.share ? { share: true as const } : {}),
    })
  }
  return { need, people, everyone, missing: !hasAccessTable() }
}

/** 내려받을 시나리오 문서. 형식 이름은 PoC 것이다 */
export function scenarioDocument(sg: ScenarioGraph, title: string, path: PathStep[], people: PeopleAnswer | null) {
  const node = (k: string) => ({ key: k, provider: sg.provider(k), type: sg.objectType(k), interface: sg.primaryInterface(k), name: sg.name(k) })
  return {
    format: 'aegi-scenario-poc/v1',
    title,
    created_at: new Date().toISOString(),
    entry: node(path[0].key),
    impact: node(path[path.length - 1].key),
    steps: path.map(s => ({ ...node(s.key), via: s.via ? s.via.hops.map(h => ({ from: h.from, to: h.to, kinds: h.kinds, relations: h.rels, verbs: h.verbs, edges: h.edgeIds })) : null })),
    people: people && {
      need: people.need,
      everyone: people.everyone,
      by_side: Object.fromEntries(['gap', 'gap_inferred', 'both', 'native_only'].map(side => [side, people.people.filter(p => p.side === side).map(p => ({ name: p.name, account: p.account, on_path: p.onPath }))])),
    },
  }
}
