import { providerName } from '../findings/providers'
import type { Hop, PathStep, ScenarioGraph } from './scenarioGraph'

/**
 * SaaS 연결 보기의 계산 (PoC). 화면 없이 ScenarioGraph 와 엔진 격차만 본다.
 * SaaS 하나를 고르면 그 SaaS 와 다른 SaaS 를 직접 잇는 간선을 연결 방식(LinkMethod)으로 묶고, 방식마다 상대 SaaS 로 다시 묶는다.
 */
export interface SaasPair { a: string; b: string; hops: Hop[] }
export interface HopEntry { provider: string; entry: string; path: PathStep[] }

/** 연결 방식. 간선 하나는 아래 판정 순서에서 처음 맞는 방식 하나에만 든다 */
export type LinkMethod = 'oauth_app' | 'automation' | 'credential' | 'sso' | 'other'
/** 화면에 놓는 순서 */
export const METHOD_ORDER: LinkMethod[] = ['oauth_app', 'automation', 'credential', 'sso', 'other']
export const METHOD_LABEL: Record<LinkMethod, string> = {
  oauth_app: 'OAuth 앱',
  automation: 'AI 에이전트/자동화',
  credential: 'API 토큰/키',
  sso: 'SSO나 계정 연결',
  other: '기타',
}
export interface MethodGroup { method: LinkMethod; peers: SaasPair[] }

/** 이어 갈 수 없는 방식. OAuth 앱은 상대 SaaS 쪽에 도착 객체가 없고, SSO 는 도착점이 조직이라 그 안의 자동화를 실행시키지 않는다.
 *  토큰 줄은 토큰이 자기 SaaS 안에서 닿는 곳을 적은 줄이라 앞 구간의 도착 객체에서 이어지지 않는다 */
const DEAD_END: LinkMethod[] = ['oauth_app', 'sso', 'credential']

/** 그 방식으로 상대를 고른 뒤 상대 SaaS 에서 다시 펼칠 방식. 이어 갈 수 없는 방식이나 회사 밖, 상대 미확인이면 없고, 그 밖에는 이어 갈 수 없는 방식을 뺀 나머지다 */
export function nextMethods(method: LinkMethod, peer: string): LinkMethod[] {
  return peer === EXTERNAL || peer === UNKNOWN_PEER || DEAD_END.includes(method) ? [] : METHOD_ORDER.filter(m => !DEAD_END.includes(m))
}

/** 호출, 실행 신원, 사본 이동, 동작 간선. 자동화가 하는 일이다 */
const ACTION_KINDS = new Set(['T', 'A', 'F', 'E'])
/** Okta 앱 signOnMode 가운데 사람 로그인을 넘기는 것. OPENID_CONNECT 는 서비스 앱도 쓰므로 넣지 않는다 */
const SSO_SIGN_ON = new Set(['SAML_2_0', 'SAML_1_1', 'WS_FEDERATION', 'AUTO_LOGIN', 'BROWSER_PLUGIN', 'SECURE_PASSWORD_STORE', 'BASIC_AUTH'])
const SSO_RELATIONS = new Set(['same_person', 'trusts'])

/**
 * 간선 하나의 연결 방식. 양 끝 객체가 무엇인지를 간선 종류보다 먼저 본다. 판정 순서:
 * AI 에이전트나 양 끝에 자동화 객체(둘 다 「AI 에이전트/자동화」) → Okta 사람 로그인 방식(SAML 등)의 SSO → API 토큰, 키(Credential) → OAuth 앱(Integration) →
 * 동일인, 신뢰 관계의 SSO → 간선 종류만 실행 계열(호출, 실행 신원, 사본 이동, 동작)인 자동화 → 기타.
 * 전에는 간선 종류가 실행 계열이기만 해도 자동화로 먼저 빠져, Actions 비밀값이나 Named Credential, OAuth 앱 간선까지 자동화에 들어갔다.
 * AI 에이전트는 온톨로지에 Interface 가 없어 객체 타입 이름에 agent 가 들어가는지로만 본다(임시 기준).
 */
export function hopMethod(sg: ScenarioGraph, h: Hop): LinkMethod {
  // 토큰 줄은 맨 앞에서 자격으로 정한다(수신 웹훅은 Endpoint 이기도 해서 다른 분기로 새지 않게)
  if (tokenIndex(sg).has(h)) return 'credential'
  const ends = [h.from, h.to]
  const has = (iface: string) => ends.some(k => (sg.engine.ix.node(k).interfaces as readonly string[]).includes(iface))
  if (ends.some(k => /agent/i.test(sg.objectType(k)))) return 'automation'
  if (has('Automation')) return 'automation'
  const signOn = (k: string) => String(sg.graph.objectsByKey.get(k)?.canonical.properties.signOnMode ?? '')
  if (ends.some(k => SSO_SIGN_ON.has(signOn(k)))) return 'sso'
  if (has('Credential')) return 'credential'
  if (has('Integration')) return 'oauth_app'
  if (h.rels.some(r => SSO_RELATIONS.has(r))) return 'sso'
  if (h.kinds.some(k => ACTION_KINDS.has(k))) return 'automation'
  return 'other'
}

/** 상대 SaaS 자리에 놓는 회사 밖. SaaS 가 없는 노드(누구나, 익명 호출자), 회사나 제3자가 호스팅하는 Endpoint,
 *  SaaS 이름이 external 인 노드(시나리오 가짜 데이터의 사외 Worker 가 이렇게 들어 있다) */
export const EXTERNAL = '__external__'
const EXTERNAL_PROVIDER = 'external'
const EXTERNAL_OWNERS = new Set(['customer_hosted', 'third_party_hosted'])
/** 상대 SaaS 자리에 놓는 상대 미확인. 앱 규칙 줄에서 앱 종류 값으로 상대를 못 가린 앱이다. 회사 밖이 아니라 상대를 모르는 것이다 */
export const UNKNOWN_PEER = '__unknown__'
export const peerName = (p: string) => (p === EXTERNAL ? '외부 (회사 밖)' : p === UNKNOWN_PEER ? '상대 미확인' : providerName(p))

export function isExternal(sg: ScenarioGraph, key: string): boolean {
  const p = sg.provider(key)
  if (!p || p === EXTERNAL_PROVIDER) return true
  return EXTERNAL_OWNERS.has(String(sg.graph.objectsByKey.get(key)?.canonical.judged?.endpoint_owner ?? ''))
}

/**
 * 간선이 그 SaaS 에서 어디로 나가나. 방향을 지킨다: 간선이 그 SaaS 에서 시작해 다른 SaaS 나 회사 밖(EXTERNAL)으로 갈 때만 센다.
 * 다른 SaaS 에서 들어오는 간선은 그 SaaS 를 골랐을 때 나온다. 회사 밖은 고를 수 없으므로 회사 밖에서 들어오는 간선은 여기서 센다.
 * 같은 SaaS 안이면 ''
 */
/** 설치된 앱(OAuth 앱) 객체 타입. 앱은 그 SaaS 에서 읽은 객체라 SaaS 값이 설치된 쪽이지만, 앱 자체가 다른 SaaS 나 회사 밖과의 연결이다 */
const APP_TYPES = new Set(['installation', 'Application', 'defs_app_id', 'ConnectedApplication', 'ExternalClientApplication'])
/** 앱의 상대 SaaS 를 가리는 글자. 앱 종류 값(Okta Application 의 name, GitHub app_slug)에서만 찾는다. 앱 이름은 보지 않는다 */
const APP_VENDORS: Array<[string, RegExp]> = [
  ['slack', /slack/i], ['github', /github|ghec/i], ['atlassian', /atlassian|jira|confluence/i],
  ['gws', /google|gmail/i], ['okta', /okta/i], ['salesforce', /salesforce/i],
]
/** 앱 줄의 상대를 무엇으로 정했나. 'type' 앱 종류 값(GitHub app_slug, Okta properties.name) / 'none' 못 가려 상대 미확인 / null 앱 규칙으로 만든 줄이 아니다 */
export type AppPeerSource = 'type' | 'none' | null
interface AppPeer { peer: string; source: Exclude<AppPeerSource, null> }
const appPeers = new WeakMap<object, Map<Hop, AppPeer>>()

/**
 * 앱마다 그 앱과 같은 SaaS 테넌트를 잇는 간선 하나를 골라 상대(다른 SaaS 나 UNKNOWN_PEER)를 붙인다.
 * 이미 다른 SaaS 로 가는 간선이 있는 앱은 뺀다(그 간선이 그대로 나온다). 상대는 앱 종류 값에서 APP_VENDORS 중 자기 SaaS 를 뺀 첫 일치, 없으면 상대 미확인.
 * 연동이 아닌 앱도 뺀다: Okta 북마크 앱(signOnMode BOOKMARK, 링크 바로가기)과, 승인 사용자도 실행 신원도 없는 Salesforce 연결 앱(자체 클라이언트)
 */
function appPeerIndex(sg: ScenarioGraph): Map<Hop, AppPeer> {
  const cached = appPeers.get(sg)
  if (cached) return cached
  const hops = sg.allHops()
  const isTenant = (k: string) => (sg.engine.ix.node(k).interfaces as readonly string[]).includes('Tenant')
  const notLink = (k: string) => {
    const type = sg.objectType(k)
    if (type === 'Application' && sg.provider(k) === 'okta') return sg.graph.objectsByKey.get(k)?.canonical.properties.signOnMode === 'BOOKMARK'
    // Google Workspace 의 Application 은 데이터 이전 API 가 돌려주는 Google 자체 서비스(Calendar, Drive 등)라 연동이 아니다
    if (type === 'Application' && sg.provider(k) === 'gws') return true
    if (type !== 'ConnectedApplication' || sg.provider(k) !== 'salesforce') return false
    // 승인 사용자는 linkContext 의 users 와 같은 기준(사람·그룹 계정, 조직 제외)이다
    const users = sg.grantees(k).filter(u => linkRole(sg, u) === 'person' && !isTenant(u))
    return !users.length && !sg.hopCard(k).identities.length
  }
  const isApp = (k: string) => APP_TYPES.has(sg.objectType(k)) && (sg.engine.ix.node(k).interfaces as readonly string[]).includes('Integration') && !notLink(k)
  const crossed = new Set<string>()
  for (const h of hops) if (sg.provider(h.from) !== sg.provider(h.to)) { crossed.add(h.from); crossed.add(h.to) }
  const chosen = new Map<string, Hop>()
  for (const h of hops) {
    for (const [app, other] of [[h.from, h.to], [h.to, h.from]]) {
      if (!isApp(app) || crossed.has(app) || !isTenant(other) || sg.provider(app) !== sg.provider(other)) continue
      const prev = chosen.get(app)
      if (!prev || (prev.from !== app && h.from === app)) chosen.set(app, h)
    }
  }
  const out = new Map<Hop, AppPeer>()
  for (const [app, h] of chosen) {
    const props = sg.graph.objectsByKey.get(app)?.canonical.properties ?? {}
    const own = sg.provider(app)
    // 앱 종류 값만 본다: GitHub app_slug, Okta Application 의 name. Slack·Salesforce 의 name, Name 과 표시 이름은 앱 이름이라 보지 않는다
    const typeText = [props.app_slug, own === 'okta' && sg.objectType(app) === 'Application' ? props.name : undefined].filter(Boolean).join(' ')
    const vendor = APP_VENDORS.find(([p, re]) => p !== own && re.test(typeText))
    out.set(h, vendor ? { peer: vendor[0], source: 'type' } : { peer: UNKNOWN_PEER, source: 'none' })
  }
  appPeers.set(sg, out)
  return out
}

/** 앱 규칙으로 만든 줄이면 상대를 무엇으로 정했는지, 아니면 null */
export function appPeerSource(sg: ScenarioGraph, hop: Hop): AppPeerSource {
  return appPeerIndex(sg).get(hop)?.source ?? null
}

/** 토큰 줄로 내는 자격증명 객체 타입(provider|objectType). 대상 객체는 interface 에 Credential 이 있어야 한다 */
const TOKEN_TYPES = new Set(['okta|ApiToken', 'slack|credential-row:oauth:url', 'github|deploy-key'])
interface TokenHop { peer: string; token: string }
const tokenHops = new WeakMap<object, Map<Hop, TokenHop>>()

/**
 * 토큰마다 줄로 쓸 홉 하나를 골라 상대를 붙인다. 홉은 토큰에서 같은 SaaS 객체로 나가는 것 가운데 도착이 Resource 인 것, 없으면 Tenant 인 것(둘 다 없으면 줄 없음).
 * 상대는 다른 SaaS 객체에서 토큰으로 들어오는 홉 가운데 rels 에 runs_as 가 든 것의 출발 SaaS(여럿이면 이름 순 처음), 없으면 상대 미확인.
 * 실행·전송 기록에서 온 홉(rels 가 observation 뿐)은 runs_as 가 없어 쓰지 않는다
 */
function tokenIndex(sg: ScenarioGraph): Map<Hop, TokenHop> {
  const cached = tokenHops.get(sg)
  if (cached) return cached
  const ifaces = (k: string) => sg.engine.ix.node(k).interfaces as readonly string[]
  const isToken = (k: string) => TOKEN_TYPES.has(`${sg.provider(k)}|${sg.objectType(k)}`) && ifaces(k).includes('Credential')
  const picked = new Map<string, { resource?: Hop; tenant?: Hop }>()
  const runsAs = new Map<string, Set<string>>()
  for (const h of sg.allHops?.() ?? []) {
    if (isToken(h.from) && sg.provider(h.to) === sg.provider(h.from)) {
      const p = picked.get(h.from) ?? {}
      if (!p.resource && ifaces(h.to).includes('Resource')) p.resource = h
      else if (!p.tenant && ifaces(h.to).includes('Tenant')) p.tenant = h
      picked.set(h.from, p)
    }
    if (isToken(h.to) && sg.provider(h.from) !== sg.provider(h.to) && !isExternal(sg, h.from) && h.rels.includes('runs_as')) {
      runsAs.set(h.to, (runsAs.get(h.to) ?? new Set()).add(sg.provider(h.from)))
    }
  }
  const out = new Map<Hop, TokenHop>()
  for (const [token, p] of picked) {
    const h = p.resource ?? p.tenant
    if (!h) continue
    out.set(h, { peer: [...(runsAs.get(token) ?? [])].sort()[0] ?? UNKNOWN_PEER, token })
  }
  tokenHops.set(sg, out)
  return out
}

/** 토큰 규칙으로 만든 줄의 홉인가 */
export function isTokenRow(sg: ScenarioGraph, hop: Hop): boolean {
  return tokenIndex(sg).has(hop)
}

function peerOf(sg: ScenarioGraph, saas: string, h: Hop, external: boolean): string {
  const app = appPeerIndex(sg).get(h)?.peer
  // 상대 미확인은 회사 밖이 아니라서 회사 밖 포함과 상관없이 돌려준다
  if (app && sg.provider(h.from) === saas) return app
  // 토큰 줄도 앱과 같이 상대 미확인을 회사 밖 포함과 상관없이 돌려준다
  const token = tokenIndex(sg).get(h)?.peer
  if (token && sg.provider(h.from) === saas) return token
  if (sg.provider(h.from) === saas && !isExternal(sg, h.from)) {
    if (isExternal(sg, h.to)) return external ? EXTERNAL : ''
    const p = sg.provider(h.to)
    return p !== saas ? p : ''
  }
  if (sg.provider(h.to) === saas && !isExternal(sg, h.to) && isExternal(sg, h.from)) return external ? EXTERNAL : ''
  return ''
}

/** 고른 SaaS 에서 나가는 간선(peerOf)을 연결 방식별로, 방식 안에서는 상대 SaaS 별로 묶는다. external 이면 회사 밖과의 간선도 상대 「외부」로 넣는다.
 *  간선 없는 방식은 뺀다. 상대는 간선 많은 것부터, 같으면 이름 순 */
export function methodsOf(sg: ScenarioGraph, saas: string, external = false): MethodGroup[] {
  const byMethod = new Map<LinkMethod, Map<string, Hop[]>>()
  for (const h of sg.allHops()) {
    const peer = peerOf(sg, saas, h, external)
    if (!peer) continue
    const m = hopMethod(sg, h)
    const peers = byMethod.get(m) ?? new Map<string, Hop[]>()
    peers.set(peer, [...(peers.get(peer) ?? []), h])
    byMethod.set(m, peers)
  }
  const sortHops = (hops: Hop[]) => hops.sort((x, y) => sg.name(x.from).localeCompare(sg.name(y.from)))
  return METHOD_ORDER.filter(m => byMethod.has(m)).map(method => ({
    method,
    peers: [...byMethod.get(method)!].map(([b, hops]) => ({ a: saas, b, hops: sortHops(hops) }))
      .sort((x, y) => y.hops.length - x.hops.length || peerName(x.b).localeCompare(peerName(y.b))),
  }))
}

/** 그래프에 있는 SaaS 마다 이어진 간선 수(methodsOf 와 같은 기준). 간선이 없는 SaaS 도 0 으로 둔다. 회사 밖(external)은 SaaS 로 세지 않는다 */
export function saasCounts(sg: ScenarioGraph, external = false): Map<string, number> {
  const providers = [...sg.graph.objectsByProvider.keys()].filter(p => p && p !== EXTERNAL_PROVIDER).sort()
  return new Map(providers.map(p => [p, methodsOf(sg, p, external).reduce((n, g) => n + g.peers.reduce((m, x) => m + x.hops.length, 0), 0)]))
}

/** 사슬에서 같은 SaaS 안을 따라가는 간선 종류(실행, 실행 신원, 복사, 동작)와 따라가는 칸 수 */
const INNER_KINDS = new Set(['T', 'A', 'F', 'E'])
const INNER_STEPS = 2

/**
 * 여러 구간을 이은 사슬. 구간마다 간선 목록과 그 구간의 상대(다음 SaaS)가 주어지면, 앞 구간 간선이 상대 쪽에 닿은 객체에서 출발해
 * 다음 구간 간선으로 이어지는 것만 잇는다. 도착한 객체에서 다음 구간 간선이 바로 나가지 않으면, 같은 SaaS 안의 실행·실행 신원·복사·동작 간선을
 * 방향대로 INNER_STEPS 칸까지 따라가 거기서 나가는 것도 잇고, 따라간 칸은 사슬에 넣는다(예: SEC 프로젝트 → 규칙 → Slack).
 * 마지막 구간은 상대가 없어도 된다. limit 개까지
 */
export function chainsAcross(sg: ScenarioGraph, segments: Array<{ hops: Hop[]; peer?: string }>, limit = 200): Hop[][] {
  const side = (k: string) => (isExternal(sg, k) ? EXTERNAL : sg.provider(k))
  const outOf = new Map<string, Hop[]>()
  for (const h of sg.allHops?.() ?? []) {
    if (side(h.from) !== side(h.to) || !h.kinds.some(k => INNER_KINDS.has(k))) continue
    outOf.set(h.from, [...(outOf.get(h.from) ?? []), h])
  }
  // 도착 객체에서 같은 SaaS 안으로 따라가 닿는 객체와 거쳐 온 칸들 (자기 자신은 빈 칸)
  const reachFrom = (start: string): Array<{ at: string; inner: Hop[] }> => {
    const found: Array<{ at: string; inner: Hop[] }> = [{ at: start, inner: [] }]
    let frontier = found
    for (let step = 0; step < INNER_STEPS; step++) {
      const next: Array<{ at: string; inner: Hop[] }> = []
      for (const { at, inner } of frontier) {
        for (const h of outOf.get(at) ?? []) {
          if (found.some(f => f.at === h.to) || next.some(f => f.at === h.to)) continue
          next.push({ at: h.to, inner: [...inner, h] })
        }
      }
      found.push(...next)
      frontier = next
    }
    return found
  }
  const out: Hop[][] = []
  const walk = (i: number, chain: Hop[], at?: string) => {
    if (out.length >= limit) return
    if (i === segments.length) { out.push(chain); return }
    const starts = at ? reachFrom(at) : [{ at: '', inner: [] as Hop[] }]
    for (const s of starts) {
      for (const h of segments[i].hops) {
        if (s.at && h.from !== s.at && h.to !== s.at) continue
        if (chain.includes(h)) continue
        const peer = segments[i].peer
        const next = peer ? [h.from, h.to].find(k => side(k) === peer) : undefined
        if (i < segments.length - 1 && !next) continue
        walk(i + 1, [...chain, ...s.inner, h], next)
      }
    }
  }
  walk(0, [])
  return out
}

/** 검색 결과 설명에서 객체를 묶는 역할 */
export type LinkRole = 'person' | 'automation' | 'connector' | 'resource' | 'other'

/**
 * 객체의 역할. 판정 순서: Automation 이면 자동화 → Integration, Credential, Endpoint, Policy, Assignment 면 연동·자격 →
 * 사람 계정이나 그룹(누구나, 테넌트 포함)이면 사람 → 그 밖의 주체(서비스 계정, 봇)는 자동화 → Resource 면 리소스 → 기타
 */
export function linkRole(sg: Pick<ScenarioGraph, 'engine'>, key: string): LinkRole {
  const ix = sg.engine.ix
  const ifaces = ix.node(key).interfaces as readonly string[]
  if (ifaces.includes('Automation')) return 'automation'
  if (['Integration', 'Credential', 'Endpoint', 'Policy', 'Assignment'].some(i => ifaces.includes(i))) return 'connector'
  if (ix.isPerson(key) || ix.isGroupLike(key)) return 'person'
  if (ifaces.includes('Principal')) return 'automation'
  if (ifaces.includes('Resource')) return 'resource'
  return 'other'
}

export interface LinkContext {
  /** 줄의 연동 객체: 홉의 끝 중 Automation, Integration, Credential 순으로 처음 맞는 것. 없으면 null */
  link: string | null
  /** 연동 객체의 실행 신원(hopCard(link).identities 의 도착). 줄의 홉에 이미 든 객체는 뺀다. SSO 줄은 빈 배열 */
  identities: string[]
  /** OAuth 앱, SSO 줄(method 'oauth_app', 'sso')에서 앱에 권한 간선(G)으로 이어진 사람·그룹 계정. 조직(Tenant)은 뺀다. 다른 방식은 빈 배열 */
  users: string[]
  /** 토큰 줄에서 토큰의 주인: 같은 SaaS 에서 authenticates_with 로 들어오는 주체, owned_by 로 나가는 Integration. 다른 줄은 빈 배열 */
  owners: string[]
  /** 토큰 줄에서 토큰을 쓰는 쪽: 다른 SaaS 에서 runs_as 로 들어오는 출발 객체. 다른 줄은 빈 배열 */
  usedBy: string[]
}

/** 줄의 연동 객체와 그 실행 신원, OAuth 앱·SSO 줄의 승인 사용자, 토큰 줄의 주인과 쓰는 쪽 */
export function linkContext(sg: ScenarioGraph, hops: Hop[], method: LinkMethod): LinkContext {
  const ends = [...new Set(hops.flatMap(h => [h.from, h.to]))]
  const ifaces = (k: string) => sg.engine.ix.node(k).interfaces as readonly string[]
  const tokenRow = hops.length === 1 && isTokenRow(sg, hops[0])
  const kind = ['Automation', 'Integration', 'Credential'].find(i => ends.some(k => ifaces(k).includes(i)))
  // 토큰 줄의 연동 객체는 토큰이다
  const link = tokenRow ? hops[0].from : kind ? ends.find(k => ifaces(k).includes(kind))! : null
  if (!link) return { link, identities: [], users: [], owners: [], usedBy: [] }
  // SSO 는 실행 신원이 없는 방식이라 앱에서 나가는 A 간선(배정 그룹 등)을 실행 신원으로 보이지 않는다
  // 토큰 줄에서 토큰이 그 사람으로 동작한다는 A 간선(authenticates_with)은 주인 칸에 보이므로 실행 신원으로 다시 보이지 않는다
  const identities = method === 'sso' || tokenRow ? [] : [...new Set(sg.hopCard(link).identities.map(h => h.to))].filter(k => !ends.includes(k))
  const users = method === 'oauth_app' || method === 'sso' ? [...new Set(sg.grantees(link))].filter(k => linkRole(sg, k) === 'person' && !ifaces(k).includes('Tenant')) : []
  const all = tokenRow ? sg.allHops() : []
  // 주인: 토큰과 authenticates_with 로 이어진 같은 SaaS 의 계정(간선 방향 무관), 토큰이 owned_by 로 속한 연동(간선이 없으면 관계에서 찾는다)
  const other = (h: Hop) => (h.from === link ? h.to : h.from)
  const touching = all.filter(h => (h.from === link || h.to === link) && sg.provider(other(h)) === sg.provider(link))
  const owners = [...new Set([
    ...touching.filter(h => h.rels.includes('authenticates_with') && ifaces(other(h)).includes('Principal')).map(other),
    ...touching.filter(h => h.rels.includes('owned_by') && ifaces(other(h)).includes('Integration')).map(other),
    ...(tokenRow ? sg.graph?.outgoingRelationsByObject?.get(link) ?? [] : []).filter(r => r.relationType === 'owned_by' && ifaces(r.targetKey).includes('Integration')).map(r => r.targetKey),
  ])]
  const usedBy = [...new Set(all.filter(h => h.to === link && sg.provider(h.from) !== sg.provider(link) && !isExternal(sg, h.from) && h.rels.includes('runs_as')).map(h => h.from))]
  return { link, identities, users, owners, usedBy }
}

/** 그 키를 첫 홉으로 부를 수 있는 진입점과, 경로 만들기에 넣을 [진입점, 홉] 경로. 같은 진입점은 처음 만난 SaaS 로 한 번만 */
export function entriesForHop(sg: Pick<ScenarioGraph, 'entries' | 'firstHops'>, key: string): HopEntry[] {
  const out: HopEntry[] = []
  for (const [provider, e] of sg.entries()) {
    for (const entry of [...e.people, ...e.bots, ...e.groups]) {
      if (out.some(o => o.entry === entry)) continue
      const leg = sg.firstHops(entry, new Set([entry])).find(l => l.to === key)
      if (leg) out.push({ provider, entry, path: [{ key: entry }, { key, via: leg }] })
    }
  }
  return out
}
