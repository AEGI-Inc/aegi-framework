/**
 * 이벤트 연결 (docs/spec/AEGI_EVENT_LINKS_V1.md).
 *
 * Splunk 정규 이벤트(graph_events)를 앞뒤로 잇는다. 이벤트를 새로 만들지 않고, 원본에 있는 값과 동일인 연결(links.json)만 근거로 쓴다.
 * 한 이벤트는 근거마다 가장 가까운 앞 이벤트 하나에만 잇는다. 그래서 연결 수는 이벤트 수에 비례한다.
 *
 * 강도
 *  - confirmed: 원본 값이 직접 잇는다 (원인 명시, 같은 세션, 강한 동일인 판단 위의 Okta SSO 인계)
 *  - review   : 같은 사람이나 같은 객체와 시간 근접으로 이었거나, SSO 인계인데 같은 사람 판단이 약하다. 사람이 원본을 확인해야 한다
 *
 * 같은 사람은 두 계정마다 EA 와 같은 규칙(effectiveAccess/common.ts identityVias)으로 판단한다. 동일인 연결을 이어 붙여
 * 한 사람으로 합치지 않는다(aegi-knowledge identity.yaml transitive, Link_Schema_v3 「두 계정 사이의 단계」).
 * 방향은 하나다: 동일인 연결 → 이벤트 연결. 이벤트 연결은 동일인 연결의 근거로 쓰지 않는다.
 */
import crypto from 'crypto'
import { buildGraphStoreV2 } from '../data/datasetStore'
import { identityVias } from '../detection/v2/effectiveAccess/common'
import { levelGrade, type IdentityGrade } from '../detection/v2/identity'
import type { IdentityLink } from '../model/link'
import type { FixtureObject } from '../model/object'
import type { FixtureRelation } from '../model/relation'

/**
 * 규칙 판. 뜻이 바뀌면 올린다 (D1 의 연결 행이 모두 다시 쓰인다).
 * 2: 동일인 연결을 이어 붙이지 않고 두 계정마다 identityVias 로 판단. SSO 인계 강도는 그 판단의 세기를 넘지 않음(identity_grade).
 *    SSO 앱의 SaaS 는 앱 이름이 아니라 registered_in 관계로(ssoAppProviders). 반복 횟수(repeat)
 * 3: 그래프 관계로 이어진 두 객체를 짧은 시간 안에 차례로 건드린 이벤트를 잇는다 (graph_relation).
 * 4: Okta 가 세션을 모를 때 넣는 'unknown' 을 세션 id 로 보지 않는다 (같은 세션 묶음에서 뺌).
 * 5: 허브(이벤트가 많이 닿은 객체)를 받은 이벤트 전체가 아니라 그 이벤트의 UTC 하루(hubWindowMs) 안에서 센다.
 *    조회 기간을 늘려 다른 날 이벤트가 더해져도 이미 맺은 연결이 사라지지 않는다.
 */
export const EVENT_LINK_RULE_VERSION = 'event-links/5'

export interface EventRef {
  native_id: string
  type: string
  display: string | null
  object_key: string | null
}

/** 연결 계산에 쓰는 이벤트 칸. Splunk 정규 이벤트(scripts/stream/splunk/types.ts NormalizedEvent)의 일부다 */
export interface LinkableEvent {
  origin_key: string
  provider: string
  event_type: string
  occurred_at: string | null
  actor: EventRef | null
  targets: EventRef[]
  correlation: { session_id: string | null; transaction_id: string | null; caused_by: EventRef[]; client_ip: string | null }
}

export type EventLinkBasis = 'caused_by' | 'session' | 'sso_handoff' | 'same_person_ip' | 'same_person_time' | 'shared_object' | 'graph_relation'
export type EventLinkStrength = 'confirmed' | 'review'

export const BASIS_STRENGTH: Record<EventLinkBasis, EventLinkStrength> = {
  caused_by: 'confirmed',
  session: 'confirmed',
  sso_handoff: 'confirmed',
  same_person_ip: 'review',
  same_person_time: 'review',
  shared_object: 'review',
  graph_relation: 'review',
}

/** 같은 사람에 기댄 근거. 강도는 두 행위자를 같은 사람으로 본 판단의 세기를 넘지 않는다 — 약하면 review */
export const PERSON_BASES: ReadonlySet<EventLinkBasis> = new Set(['sso_handoff', 'same_person_ip', 'same_person_time'])

/** 강한 근거부터. 한 쌍에 근거가 여럿이면 앞의 것이 대표 근거다 */
export const BASIS_ORDER: EventLinkBasis[] = ['caused_by', 'session', 'sso_handoff', 'same_person_ip', 'same_person_time', 'shared_object', 'graph_relation']

export interface EventLink {
  /** from, to 로 만든 고정 id */
  id: string
  /** 앞 이벤트 origin_key */
  from: string
  /** 뒤 이벤트 origin_key */
  to: string
  basis: EventLinkBasis
  /** 이 쌍에 맞은 근거 전부 (대표 근거 포함, 강한 순) */
  bases: EventLinkBasis[]
  strength: EventLinkStrength
  cross_saas: boolean
  from_provider: string
  to_provider: string
  /** 뒤 이벤트의 발생 시각 (조회 구간에 쓴다) */
  occurred_at: string
  delta_ms: number
  /** 두 이벤트의 행위자가 든 동일인 연결 */
  identity_link_id: string | null
  /** 두 행위자를 같은 사람으로 본 판단의 세기 (같은 계정이면 strong). 같은 사람으로 보지 않으면 null */
  identity_grade: IdentityGrade | null
  via: {
    objects?: string[]
    relations?: string[]
    session_id?: string
    client_ip?: string
    /** SSO 인계에서 Okta 가 넘긴 앱 */
    app?: string
  }
  /**
   * 같은 대표 근거로 같은 두 끝(두 행위자 계정, 없으면 SaaS. 그리고 SSO 앱 객체, 근거 객체)을 이은 연결이 계산에 넣은 이벤트 안에서
   * 이 연결까지(발생 시각 순) 몇 번(이 연결 포함), 며칠(UTC 날짜)에 나왔나. 세기만 하고 강도를 바꾸지 않는다
   */
  repeat: { count: number; days: number }
  rule_version: string
}

export interface EventLinkOptions {
  /** 같은 세션, 트랜잭션의 앞뒤 이벤트를 잇는 최대 간격 */
  sessionGapMs?: number
  /** Okta SSO 뒤 그 앱의 첫 이벤트까지 최대 간격 */
  ssoGapMs?: number
  /** 같은 사람의 다른 SaaS 이벤트로 넘어갈 때 잇는 최대 간격 */
  personGapMs?: number
  /** 같은 객체를 공유하는 두 이벤트를 잇는 최대 간격 */
  objectGapMs?: number
  /** 원인 객체를 찾아 거슬러 올라가는 최대 간격 */
  causeGapMs?: number
  /** 관계로 이어진 두 객체를 차례로 건드렸을 때 잇는 최대 간격 */
  relationGapMs?: number
  /**
   * 한 창(hubWindowMs) 안에서 이 수보다 많은 이벤트가 닿은 객체(조직, 관리 콘솔 등)는 그 창의 이벤트에서 잇는 근거로 쓰지 않는다.
   * 받은 이벤트 전체에서 세면 조회 기간이 길수록 허브가 늘어, 같은 두 이벤트의 연결이 조회에 따라 생기고 사라진다
   */
  hubLimit?: number
  /** hubLimit 을 세는 창. 발생 시각을 이 길이로 나눈 칸(1970-01-01 UTC 부터)마다 센다. 기본은 UTC 하루 */
  hubWindowMs?: number
  /** 관계로 이웃이 이 수를 넘는 객체(조직, 워크스페이스 등)는 관계의 끝으로 쓰지 않는다 */
  relationHubLimit?: number
  /**
   * Okta 앱 객체 키 → 그 앱이 붙은 SaaS (ssoAppProviders, ssoAppsFrom). 여기 없는 앱의 SSO 는 어느 SaaS 로 넘어갔는지 몰라 SSO 인계로 잇지 않는다.
   * 공통 조회 서비스는 graph-index 의 appTenants 로 만든다. 그 칸이 없는 graph-index 면 이 표가 비고, 그 경로의 SSO 인계는 맺지 않는다.
   */
  ssoApps?: ReadonlyMap<string, string>
  /**
   * 그래프 관계 줄. 짧은 시간 안에 한 관계의 두 끝을 차례로 건드린 이벤트를 잇는 데(graph_relation) 쓴다.
   */
  relations?: ReadonlyArray<{ id: string; type: string; from: string; to: string }>
}

const DEFAULTS: Required<EventLinkOptions> = {
  sessionGapMs: 8 * 3600_000,
  ssoGapMs: 5 * 60_000,
  personGapMs: 30 * 60_000,
  objectGapMs: 10 * 60_000,
  causeGapMs: 7 * 86400_000,
  relationGapMs: 30 * 60_000,
  hubLimit: 40,
  hubWindowMs: 86400_000,
  relationHubLimit: 40,
  ssoApps: new Map(),
  relations: [],
}

/** Okta 앱이 등록된 다른 SaaS 하나. registered_in 관계 하나마다 하나다 */
export interface AppTenant {
  /** Okta Application 객체 키 */
  app: string
  /** 관계 끝 객체의 SaaS */
  provider: string
}

/**
 * crosswalk tenant_pointer 가 만든 registered_in(Okta 앱 → 다른 SaaS 의 테넌트, aegi-knowledge crosswalk.yaml tenant_pointer) 중
 * 출발이 Okta Application, 끝이 Okta 아닌 객체인 것. SaaS 는 관계 끝 객체의 provider 다. 정규화는 SaaS 를 넘는 관계의
 * references 양끝에도 관계의 provider 를 적어서(scripts/collect/shared/dataset.ts relations) references.target.provider 로는 고를 수 없다.
 * 대시보드 graph-index(aegi-dashboard-new server/connector.ts)도 D1 스냅샷에서 같은 짝을 뽑아 공통 조회 서비스에 준다.
 */
export function appTenants(objects: FixtureObject[], relations: FixtureRelation[]): AppTenant[] {
  const byKey = new Map(objects.map(o => [o.fixture_key, o.canonical]))
  const out: AppTenant[] = []
  for (const r of relations) {
    const c = r.canonical
    if (c?.relation_type !== 'registered_in') continue
    const app = String(c.references?.source?.value), tenant = byKey.get(String(c.references?.target?.value))
    const source = byKey.get(app)
    if (source?.provider !== 'okta' || source.object_type !== 'Application' || !tenant?.provider || tenant.provider === 'okta') continue
    out.push({ app, provider: tenant.provider })
  }
  return out
}

/**
 * Okta 앱 객체 키 → 그 앱이 붙은 SaaS. 앱 이름 글자로 고르지 않는다.
 * 짝이 없거나 한 앱이 서로 다른 SaaS 둘을 가리키면 모른다 — 넣지 않고, 그 앱의 SSO 인계는 맺지 않는다. 모양이 틀린 짝은 건너뛴다.
 * tenant_pointer 가 Okta 앱에서 가리키는 곳은 지금 GitHub, Slack, GWS 뿐이라 Salesforce, Atlassian 앱은 늘 모른다.
 */
export function ssoAppsFrom(pairs: ReadonlyArray<AppTenant>): Map<string, string> {
  const found = new Map<string, Set<string>>()
  for (const p of pairs) {
    if (typeof p?.app !== 'string' || !p.app || typeof p.provider !== 'string' || !p.provider || p.provider === 'okta') continue
    found.set(p.app, (found.get(p.app) ?? new Set<string>()).add(p.provider))
  }
  return new Map([...found].filter(([, providers]) => providers.size === 1).map(([app, providers]) => [app, [...providers][0]!]))
}

/** 데이터셋의 객체와 관계로 Okta 앱 객체 키 → 그 앱이 붙은 SaaS (appTenants, ssoAppsFrom) */
export function ssoAppProviders(objects: FixtureObject[], relations: FixtureRelation[]): Map<string, string> {
  return ssoAppsFrom(appTenants(objects, relations))
}

/** 두 계정을 같은 사람으로 본 판단. 그 근거가 된 동일인 연결과 경로의 세기 */
export interface SamePerson {
  link_id: string
  grade: IdentityGrade
}

/**
 * 계정 키 → 같은 사람으로 보는 다른 계정들. 두 계정이 한 동일인 연결 안에서 identityVias 로 이어질 때만 든다 —
 * 「다른 사람」과 그룹 연결은 쓰지 않고, 약한 간선 둘 이상을 거쳐야 하면 잇지 않는다(EA 와 같다).
 * 한 계정이 연결 둘에 들어도 두 연결의 다른 계정끼리는 같은 사람이 되지 않는다.
 */
export function personPartners(links: IdentityLink[]): Map<string, Map<string, SamePerson>> {
  // 계정 목록이 없거나 계정 키가 빠진 연결은 건너뛴다 (graph-index 처럼 밖에서 받은 연결 하나가 계산 전체를 멈추지 않게)
  const graph = buildGraphStoreV2([], [], links.filter(l => Array.isArray(l?.set) && l.set.every(m => typeof m?.object_key === 'string')))
  const out = new Map<string, Map<string, SamePerson>>()
  for (const [key, ids] of graph.linkIdsByObject) {
    const partners = new Map<string, SamePerson>()
    for (const id of ids) {
      for (const m of graph.linksById.get(id)?.set ?? []) {
        if (m.object_key === key || partners.has(m.object_key)) continue
        // 어느 쪽에서 물어도 같은 답이 나오게 키 순으로 묻는다
        const [a, b] = key < m.object_key ? [key, m.object_key] : [m.object_key, key]
        const vias = identityVias(a, b, graph)
        if (vias.length) partners.set(m.object_key, { link_id: vias[0]!.ref, grade: vias.some(v => levelGrade(v.level) !== 'strong') ? 'weak' : 'strong' })
      }
    }
    if (partners.size) out.set(key, partners)
  }
  return out
}

/** 한 동일인 연결 안에 같이 들었지만 같은 사람으로 보지 않는 두 계정 (키 순) */
export interface ApartPair {
  link_id: string
  a: string
  b: string
}

/**
 * 사람 연결(「다른 사람」, 그룹 연결 빼고) 안의 계정 쌍 가운데 personPartners 가 잇지 않는 것. 약한 간선 둘 이상을 거쳐야 하거나
 * 간선으로 이어지지 않는 쌍이다. 대시보드 행위 흐름은 연결의 계정을 한 사람 줄에 놓으므로 이 쌍을 따로 표시한다
 * (게시 집계 identity_pairs_apart, scripts/loader/engine.ts aggregatesOf). 객체 키만 담는다.
 */
export function apartPairs(links: IdentityLink[]): ApartPair[] {
  const partners = personPartners(links)
  const out: ApartPair[] = []
  for (const link of links) {
    if (link.level === 'different' || link.meta?.kind === 'group' || !Array.isArray(link.set) || !link.set.every(m => typeof m?.object_key === 'string')) continue
    const keys = [...new Set(link.set.map(m => m.object_key))].sort()
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) if (!partners.get(keys[i]!)?.has(keys[j]!)) out.push({ link_id: link.link_id, a: keys[i]!, b: keys[j]! })
    }
  }
  return out
}

const linkId =(from: string, to: string) => `EL-${crypto.createHash('sha256').update(`${from}\n${to}`).digest('hex').slice(0, 20)}`

interface Timed extends LinkableEvent { t: number }

/**
 * 이벤트 연결을 계산한다. 입력 순서와 상관없이 같은 결과가 나온다 (발생 시각, origin_key 순으로 정렬).
 * 발생 시각이 없는 이벤트는 잇지 않는다.
 */
export function computeEventLinks(events: LinkableEvent[], links: IdentityLink[], options: EventLinkOptions = {}): EventLink[] {
  const o = { ...DEFAULTS, ...options }
  const timed: Timed[] = []
  for (const e of events) {
    const t = e.occurred_at ? Date.parse(e.occurred_at) : NaN
    if (!Number.isNaN(t)) timed.push({ ...e, t })
  }
  timed.sort((a, b) => a.t - b.t || a.origin_key.localeCompare(b.origin_key))
  const partners = personPartners(links)
  /** 두 행위자가 같은 사람인가. 같은 계정이면 strong 이고, 그 계정이 같은 사람으로 이어진 첫 연결을 적는다(없으면 null) */
  const samePerson = (a: LinkableEvent, b: LinkableEvent): { link_id: string | null; grade: IdentityGrade } | null => {
    const ka = a.actor?.object_key, kb = b.actor?.object_key
    if (!ka || !kb) return null
    const mates = partners.get(ka)
    if (ka !== kb) return mates?.get(kb) ?? null
    return { link_id: mates?.values().next().value?.link_id ?? null, grade: 'strong' }
  }

  const touched = (e: LinkableEvent) => [...new Set([e.actor?.object_key, ...e.targets.map(t => t.object_key)].filter((k): k is string => !!k))]
  // 허브는 객체와 창(기본 UTC 하루)마다 센다. 다른 창의 이벤트는 이 이벤트의 판단을 바꾸지 않는다
  const hubKey = (k: string, e: Timed) => `${k}\u0000${Math.floor(e.t / o.hubWindowMs)}`
  const keyCount = new Map<string, number>()
  for (const e of timed) for (const k of touched(e)) keyCount.set(hubKey(k, e), (keyCount.get(hubKey(k, e)) ?? 0) + 1)
  /** 이벤트 e 에서 객체 k 를 잇는 근거로 쓸 수 있나 (e 의 창 안에서 k 가 허브가 아님) */
  const usable = (k: string, e: Timed) => (keyCount.get(hubKey(k, e)) ?? 0) <= o.hubLimit

  // relations 전처리: 자기 자신을 잇는 관계 제외, 관계 이웃 수 계산
  const relNeighbors = new Map<string, Set<string>>()
  const validRels: Array<{ id: string; type: string; from: string; to: string }> = []
  for (const r of o.relations ?? []) {
    if (!r?.id || !r?.from || !r?.to || r.from === r.to) continue
    validRels.push(r)
    let nf = relNeighbors.get(r.from)
    if (!nf) { nf = new Set<string>(); relNeighbors.set(r.from, nf) }
    nf.add(r.to)
    let nt = relNeighbors.get(r.to)
    if (!nt) { nt = new Set<string>(); relNeighbors.set(r.to, nt) }
    nt.add(r.from)
  }
  const relUsable = (k: string) => (relNeighbors.get(k)?.size ?? 0) <= o.relationHubLimit

  // 객체별 관계 인덱스 (관계 이웃 허브는 제외. 이벤트 수 허브는 창마다 달라 잇을 때 본다)
  const relationsByObject = new Map<string, Array<{ id: string; other: string }>>()
  for (const r of validRels) {
    if (!relUsable(r.from) || !relUsable(r.to)) continue
    const fromList = relationsByObject.get(r.from) ?? []
    fromList.push({ id: r.id, other: r.to })
    relationsByObject.set(r.from, fromList)

    const toList = relationsByObject.get(r.to) ?? []
    toList.push({ id: r.id, other: r.from })
    relationsByObject.set(r.to, toList)
  }

  // 쌍마다 근거를 모은다
  const pairs = new Map<string, { j: number; i: number; bases: Set<EventLinkBasis>; via: EventLink['via'] }>()
  const add = (j: number, i: number, basis: EventLinkBasis, via: EventLink['via'] = {}) => {
    const key = `${j}:${i}`
    const pair = pairs.get(key) ?? { j, i, bases: new Set<EventLinkBasis>(), via: {} }
    pair.bases.add(basis)
    if (via.objects) pair.via.objects = [...new Set([...(pair.via.objects ?? []), ...via.objects])]
    if (via.relations) pair.via.relations = [...new Set([...(pair.via.relations ?? []), ...via.relations])]
    if (via.session_id) pair.via.session_id ??= via.session_id
    if (via.client_ip) pair.via.client_ip ??= via.client_ip
    if (via.app) pair.via.app ??= via.app
    pairs.set(key, pair)
  }

  const lastByObject = new Map<string, number>()
  const lastBySession = new Map<string, number>()
  const lastByActor = new Map<string, number>()
  /** Okta 계정별, SaaS별 아직 이어 받지 않은 SSO (앱 SaaS → SSO 이벤트 위치) */
  const pendingSso = new Map<string, Map<string, number>>()

  timed.forEach((e, i) => {
    // 원인 명시: 원인 객체가 앞 이벤트의 행위자나 대상
    for (const c of e.correlation.caused_by) {
      if (!c.object_key) continue
      for (let j = i - 1; j >= 0 && e.t - timed[j]!.t <= o.causeGapMs; j--) {
        if (touched(timed[j]!).includes(c.object_key)) { add(j, i, 'caused_by', { objects: [c.object_key] }); break }
      }
    }
    // 같은 세션, 트랜잭션: 그 세션의 바로 앞 이벤트
    // splunk-map/4 전에 담긴 Okta 이벤트는 모르는 세션을 'unknown' 으로 갖고 있다
    for (const sid of new Set([e.correlation.session_id, e.correlation.transaction_id].filter((s): s is string => !!s && s !== 'unknown'))) {
      const sessionKey = `${e.provider}\u0000${sid}`
      const j = lastBySession.get(sessionKey)
      if (j !== undefined && e.t - timed[j]!.t <= o.sessionGapMs) add(j, i, 'session', { session_id: sid })
      lastBySession.set(sessionKey, i)
    }
    // 같은 사람: SSO 인계, 다른 SaaS 로 넘어감. 이 계정과 같은 사람으로 보는 계정만 본다
    const who = e.actor?.object_key
    const mates = who ? partners.get(who) : undefined
    if (who && mates) {
      let sso: number | undefined, ssoBy: string | undefined
      for (const m of mates.keys()) {
        const at = pendingSso.get(m)?.get(e.provider)
        if (at !== undefined && (sso === undefined || at > sso)) { sso = at; ssoBy = m }
      }
      if (sso !== undefined && e.provider !== timed[sso]!.provider) {
        pendingSso.get(ssoBy!)!.delete(e.provider)
        if (e.t - timed[sso]!.t <= o.ssoGapMs) add(sso, i, 'sso_handoff', { app: timed[sso]!.targets.find(t => t.type === 'AppInstance')?.display ?? undefined })
      }
      let j: number | undefined
      for (const k of [who, ...mates.keys()]) {
        const at = lastByActor.get(k)
        if (at !== undefined && (j === undefined || at > j)) j = at
      }
      if (j !== undefined && timed[j]!.provider !== e.provider && e.t - timed[j]!.t <= o.personGapMs) {
        const ip = e.correlation.client_ip
        if (ip && ip === timed[j]!.correlation.client_ip) add(j, i, 'same_person_ip', { client_ip: ip })
        else add(j, i, 'same_person_time')
      }
    }
    if (who) {
      lastByActor.set(who, i)
      if (mates && e.provider === 'okta' && e.event_type === 'user.authentication.sso') {
        const appKey = e.targets.find(t => t.type === 'AppInstance')?.object_key
        const app = appKey ? o.ssoApps.get(appKey) : undefined
        if (app && app !== 'okta') {
          const byApp = pendingSso.get(who) ?? new Map<string, number>()
          byApp.set(app, i)
          pendingSso.set(who, byApp)
        }
      }
    }
    // 그래프 관계, 시간 근접
    if (relationsByObject.size > 0) {
      const eTouched = touched(e)
      const eTouchedSet = new Set(eTouched)
      for (const k of eTouched) {
        if (!usable(k, e) || !relUsable(k)) continue
        const rels = relationsByObject.get(k)
        if (!rels) continue
        for (const { id, other: n } of rels) {
          if (eTouchedSet.has(n)) continue
          const j = lastByObject.get(n)
          if (j === undefined) continue
          // 두 끝은 그 끝을 건드린 이벤트의 창에서 허브가 아니어야 한다
          if (!usable(n, timed[j]!)) continue
          if (e.t - timed[j]!.t > o.relationGapMs) continue
          if (touched(timed[j]!).includes(k)) continue
          add(j, i, 'graph_relation', { objects: [n, k], relations: [id] })
        }
      }
    }
    // 같은 객체, 시간 근접. 허브인 창의 이벤트도 「가장 가까운 앞 이벤트」로 적어 두고, 두 이벤트의 창 어느 쪽이든 허브면 잇지 않는다
    for (const k of touched(e)) {
      const j = lastByObject.get(k)
      if (j !== undefined && e.t - timed[j]!.t <= o.objectGapMs && usable(k, e) && usable(k, timed[j]!)) add(j, i, 'shared_object', { objects: [k] })
      lastByObject.set(k, i)
    }
  })

  const out: EventLink[] = []
  /** 반복을 세는 묶음(대표 근거, 두 행위자(없으면 SaaS), SSO 앱 객체, 근거 객체)과 두 이벤트의 정렬 위치 */
  const counted: Array<{ link: EventLink; key: string; i: number; j: number }> = []
  for (const { j, i, bases, via } of pairs.values()) {
    const a = timed[j]!, b = timed[i]!
    const ordered = BASIS_ORDER.filter(x => bases.has(x))
    const basis = ordered[0]!
    const same = samePerson(a, b)
    const app = bases.has('sso_handoff') ? a.targets.find(t => t.type === 'AppInstance')?.object_key ?? via.app ?? '' : ''
    const link: EventLink = {
      id: linkId(a.origin_key, b.origin_key),
      from: a.origin_key,
      to: b.origin_key,
      basis,
      bases: ordered,
      strength: PERSON_BASES.has(basis) && same?.grade !== 'strong' ? 'review' : BASIS_STRENGTH[basis],
      cross_saas: a.provider !== b.provider,
      from_provider: a.provider,
      to_provider: b.provider,
      occurred_at: new Date(b.t).toISOString(),
      delta_ms: b.t - a.t,
      identity_link_id: same?.link_id ?? null,
      identity_grade: same?.grade ?? null,
      via: Object.fromEntries(Object.entries(via).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as EventLink['via'],
      repeat: { count: 0, days: 0 },
      rule_version: EVENT_LINK_RULE_VERSION,
    }
    out.push(link)
    counted.push({ link, key: [basis, a.actor?.object_key ?? a.provider, b.actor?.object_key ?? b.provider, app, [...(via.objects ?? [])].sort().join('\u0001')].join('\u0000'), i, j })
  }
  // 반복은 이 연결까지 센다. 이벤트 정렬 위치(뒤 이벤트, 앞 이벤트) 순이라 뒤에 더해진 이벤트의 연결은 같은 초여도 뒤에 센다.
  // 그래서 앞 연결의 값이 그대로고 D1 행을 다시 쓰지 않는다
  const seen = new Map<string, { count: number; days: Set<string> }>()
  for (const { link, key } of counted.sort((x, y) => x.i - y.i || x.j - y.j)) {
    const group = seen.get(key) ?? { count: 0, days: new Set<string>() }
    group.count++
    group.days.add(link.occurred_at.slice(0, 10))
    seen.set(key, group)
    link.repeat = { count: group.count, days: group.days.size }
  }
  return out.sort((x, y) => x.occurred_at.localeCompare(y.occurred_at) || x.id.localeCompare(y.id))
}
