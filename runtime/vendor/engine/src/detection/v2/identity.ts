import type { GraphStoreV2 } from '../../model/graph'
import type { IdentityLink } from '../../model/link'
import type { FixtureObject } from '../../model/object'
import type { ResolvedRelation } from '../../model/relation'
import * as onto from '../../ontology/generated'

/** 사람 링크 → 자동화 링크 → 그룹 링크 순서로 고른다 */
const LINK_KIND_ORDER: Record<string, number> = { person: 0, automation: 1, group: 2 }

function linkKindRank(link: IdentityLink): number {
  const kind = typeof link.meta?.kind === 'string' ? link.meta.kind : 'person'
  return LINK_KIND_ORDER[kind] ?? 0
}

/**
 * 계정이 속한 링크 중 신원 묶음으로 쓸 하나.
 * 한 계정이 여러 링크에 있으면 사람 링크를 먼저 쓴다(그룹 링크는 '같은 그룹'이지 같은 사람이 아니다).
 * level 이 different 인 링크는 '같은 주체가 아니다'라는 판정이라 묶음으로 쓰지 않는다.
 */
export function identityLinkOf(objectKey: string, graph: GraphStoreV2): IdentityLink | undefined {
  const links = (graph.linkIdsByObject.get(objectKey) ?? [])
    .map(id => graph.linksById.get(id))
    .filter((link): link is IdentityLink => !!link && link.level !== 'different')
  if (!links.length) return undefined
  return links.reduce((best, link) => (linkKindRank(link) < linkKindRank(best) ? link : best), links[0])
}

/**
 * 측정 도구 계정(수집 봇 등)의 멤버십인지. 실측 v2 는 이 관계를 저장하고 표시만 한다(aegi-schema 「저장은 전부 편다」) —
 * 멤버 집합을 세는 룰이 뺀다. v1·합성 데이터에는 이 표시가 없다.
 */
export function isMeasurementMembership(rel: ResolvedRelation): boolean {
  return rel.properties?.measurement_principal === true
}

// ============================================================================
// 신원 판단의 세기 (Link_Schema_v3)
//
// 룰은 SaaS 를 건너 "이 Slack 계정과 저 Okta 계정이 같은 사람인가"를 Identity Link 로 판단한다.
// 그 판단이 벤더가 준 연결이나 결정적 규칙(이메일 칸끼리 같은 주소 포함, crosswalk.yaml email_match 2026-11-03)에 기대면 strong,
// 연결 기록이 추정 단계(possibly_same 등, 예: 로그 상관)이면 weak 다. 연결 기록이 없을 때의 판단도 weak 다.
// weak 에 기댄 판정 근거는 confirmed 가 아니라 inferred(추정)로 올린다. 격차·귀속 계산 자체는 바꾸지 않는다.
// ============================================================================

export type IdentityGrade = 'strong' | 'weak'

/** 벤더가 준 연결(disclosed_relation)과 결정적 규칙·사람이 쓴 표(resolved)만 강하다 */
const STRONG_LEVELS = new Set<string>(onto.STRONG_LINK_LEVELS) // 개념 사전 identity.yaml 의 engine_level_grades 가 strong 인 것

/** 링크 level → 세기. different 는 묶음이 아니라 null. 모르는 값은 약한 쪽으로 본다 */
export function levelGrade(level: string | undefined): IdentityGrade | null {
  if (level === 'different') return null
  return level && STRONG_LEVELS.has(level) ? 'strong' : 'weak'
}

interface LinkEdge {
  a: string
  b: string
  level: string
  /** 공용 주소 의심(주소 앞부분이 공용 주소 표의 이름). 정규화 crosswalk.ts 가 단다 */
  shared_mailbox_suspected?: boolean
}

/** 실측 v2 는 간선마다 level 을 meta.edges 에 남긴다. v1·합성에는 없다 */
function edgesOf(link: IdentityLink): LinkEdge[] {
  const raw = link.meta?.edges
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (e): e is LinkEdge => !!e && typeof e.a === 'string' && typeof e.b === 'string' && typeof e.level === 'string'
  )
}

function connected(edges: LinkEdge[], from: string, to: string): boolean {
  const seen = new Set<string>([from])
  const queue = [from]
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === to) return true
    for (const e of edges) {
      const next = e.a === cur ? e.b : e.b === cur ? e.a : undefined
      if (next && !seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return false
}

/**
 * 한 링크 안에서 두 계정을 같은 주체로 보는 근거의 세기.
 * 간선마다 level 이 있으면 두 계정을 잇는 경로를 본다 — 강한 간선만으로 이어지면 strong,
 * 약한 간선을 하나라도 거쳐야 하면 weak (Link_Schema_v3 「단계를 섞어서 닫지 않는다」).
 * 공용 주소 의심 간선(shared_mailbox_suspected)은 단계가 resolved 여도 약한 근거로 본다. 엮고 표시만 하는 연결이라(동일인 정책 11-13)
 * 판정이 그 연결로 직접 권한을 합치거나 관리자 신뢰로 위협을 지우지 않게 한다(2026-11-18 Relation 결정).
 * 간선이 없으면(v1·합성) 집합의 level 을 쓴다. 집합이 different 면 null.
 */
export function linkPairGrade(link: IdentityLink, keyA: string, keyB: string): IdentityGrade | null {
  if (keyA === keyB) return 'strong'
  const setGrade = levelGrade(link.level)
  const edges = edgesOf(link).filter(e => e.level !== 'different')
  if (!edges.length) return setGrade
  if (connected(edges.filter(e => levelGrade(e.level) === 'strong' && !e.shared_mailbox_suspected), keyA, keyB)) return 'strong'
  if (connected(edges, keyA, keyB)) return 'weak'
  return setGrade === null ? null : 'weak'
}

const completeTableCache = new WeakMap<GraphStoreV2, boolean>()

/**
 * 링크가 전부 사람이 쓴 표(Link_Schema_v3 M5, source.method = manual_fixture)면 사람 표가 완결됐다고 본다 — 합성 데이터셋.
 * 그러면 링크가 없거나 링크에 그 SaaS 계정이 없는 사람은 "그 SaaS 계정이 없는 사람"으로 확정할 수 있다.
 * 규칙으로 맞춘 실측 링크에서는 연결이 없는 것이 없다는 뜻이 아니다.
 */
export function isCompletePersonTable(graph: GraphStoreV2): boolean {
  let complete = completeTableCache.get(graph)
  if (complete === undefined) {
    const links = [...graph.linksById.values()]
    complete = links.length > 0 && links.every(l => l.source?.method === 'manual_fixture')
    completeTableCache.set(graph, complete)
  }
  return complete
}

const SERVICE_TYPES = new Set(['oauth2client', 'bot', 'application', 'app', 'serviceaccount', 'service account'])
const HUMAN_TYPES = new Set(['user', 'user account', 'member'])

/** 사람인지 자동화인지 (Interface_Spec_v3 Principal.principal_kind 에 해당). 가를 수 없으면 unknown */
export function principalKind(obj: FixtureObject | undefined): 'human' | 'service' | 'unknown' {
  if (!obj) return 'unknown'
  const c = obj.canonical
  // 정규화기가 Interface_Spec_v3 계약값을 적었으면 그것을 따른다 (실측 v2). group 은 사람도 자동화도 아니다
  const judged = c.judged?.principal_kind
  if (judged === 'human' || judged === 'service') return judged
  if (judged === 'group') return 'unknown'
  const type = c.object_type.toLowerCase()
  const p = c.properties ?? {}
  // 수집 호출 번호가 붙은 종류 이름(예: 200.bot)은 번호와 목록 표시를 떼고 본다
  const base = type.replace(/^\d+\./, '').replace(/\[\*\]$/, '')
  if (SERVICE_TYPES.has(type) || SERVICE_TYPES.has(base) || p.is_bot === true || p.bot_id || (c.provider === 'slack' && type === 'user' && p.app_id)) return 'service'
  if (!c.interfaces.includes('Principal') && (c.interfaces.includes('Integration') || c.interfaces.includes('Automation'))) return 'service'
  return HUMAN_TYPES.has(type) ? 'human' : 'unknown'
}

export interface IdentityJudgement {
  same: boolean
  grade: IdentityGrade
  /** 무엇으로 판단했나 */
  basis: 'same_object' | 'link' | 'different_record' | 'principal_kind' | 'provider_account' | 'person_table' | 'no_link'
}

/**
 * 두 계정이 서로 다른 사람 링크에 있고, 두 링크가 같은 SaaS 에 서로 다른 계정을 가지고 있으면 다른 사람이다.
 * 한 사람은 한 SaaS 에 계정 하나라는 가정(규칙 3)을 두 링크가 함께 가진 SaaS 로 넓힌 것이다.
 * 예: GitHub 계정의 링크와 Jira 계정의 링크가 각자 다른 Okta 계정을 가지면 둘은 다른 사람이다.
 * 세기는 두 계정이 각자 그 SaaS 계정과 강하게 이어질 때만 strong. 자동화, 그룹 링크와 두 링크가 계정을 함께 가진 경우는 보지 않는다
 */
function otherPersonLinkGrade(linkA: IdentityLink | undefined, keyA: string, linkB: IdentityLink | undefined, keyB: string): IdentityGrade | null {
  if (!linkA || !linkB || linkA.link_id === linkB.link_id) return null
  if (linkKindRank(linkA) !== LINK_KIND_ORDER.person || linkKindRank(linkB) !== LINK_KIND_ORDER.person) return null
  const keysA = new Set(linkA.set.map(m => m.object_key))
  if (linkB.set.some(m => keysA.has(m.object_key))) return null
  let grade: IdentityGrade | null = null
  for (const provider of new Set(linkA.set.map(m => m.provider))) {
    const inA = linkA.set.filter(m => m.provider === provider && m.object_key !== keyA)
    const inB = linkB.set.filter(m => m.provider === provider && m.object_key !== keyB)
    if (!inA.length || !inB.length) continue
    const strongA = inA.some(m => linkPairGrade(linkA, keyA, m.object_key) === 'strong')
    const strongB = inB.some(m => linkPairGrade(linkB, keyB, m.object_key) === 'strong')
    if (strongA && strongB) return 'strong'
    grade = 'weak'
  }
  return grade
}

function hasDifferentRecord(keyA: string, keyB: string, graph: GraphStoreV2): boolean {
  for (const id of graph.linkIdsByObject.get(keyA) ?? []) {
    const link = graph.linksById.get(id)
    if (!link) continue
    if (link.level === 'different' && link.set.some(m => m.object_key === keyB)) return true
    if (edgesOf(link).some(e => e.level === 'different' && ((e.a === keyA && e.b === keyB) || (e.a === keyB && e.b === keyA)))) return true
  }
  return false
}

/**
 * 두 계정이 같은 사람(주체)인지와 그 판단의 세기.
 * 1. 같은 계정이거나 같은 링크에 있으면 같은 사람. 세기는 두 계정을 잇는 경로(linkPairGrade)
 * 2. different 기록이 있거나, 한쪽은 사람이고 다른 쪽은 자동화면 다른 주체 (strong)
 * 3. 한쪽 링크가 상대 SaaS 의 계정을 이미 가지고 있으면 다른 사람이다 — 한 사람은 한 SaaS 에 계정 하나
 *    (IdP 허브 가정, Link_Schema_v3). 세기는 그 계정과의 연결 중 강한 쪽
 * 4. 두 계정이 서로 다른 사람 링크에 있고 두 링크가 같은 SaaS 에 서로 다른 계정을 가지면 다른 사람이다 (otherPersonLinkGrade)
 * 5. 그래도 모르면: 사람 표가 완결이면 strong(M5), 아니면 weak
 */
export function judgeSamePerson(keyA: string, keyB: string, graph: GraphStoreV2): IdentityJudgement {
  if (keyA === keyB) return { same: true, grade: 'strong', basis: 'same_object' }
  if (hasDifferentRecord(keyA, keyB, graph)) return { same: false, grade: 'strong', basis: 'different_record' }

  const linkA = identityLinkOf(keyA, graph)
  if (linkA?.set.some(m => m.object_key === keyB)) return { same: true, grade: linkPairGrade(linkA, keyA, keyB) ?? 'weak', basis: 'link' }
  const linkB = identityLinkOf(keyB, graph)
  if (linkB?.set.some(m => m.object_key === keyA)) return { same: true, grade: linkPairGrade(linkB, keyB, keyA) ?? 'weak', basis: 'link' }

  const objA = graph.objectsByKey.get(keyA)
  const objB = graph.objectsByKey.get(keyB)
  const kinds = [principalKind(objA), principalKind(objB)].sort().join('|')
  if (kinds === 'human|service') return { same: false, grade: 'strong', basis: 'principal_kind' }

  const viaAccount = (link: IdentityLink | undefined, anchor: string, provider: string | undefined): IdentityGrade | null => {
    if (!link || !provider) return null
    const accounts = link.set.filter(m => m.provider === provider && m.object_key !== anchor)
    if (!accounts.length) return null
    return accounts.some(m => linkPairGrade(link, anchor, m.object_key) === 'strong') ? 'strong' : 'weak'
  }
  const gradeA = viaAccount(linkA, keyA, objB?.canonical.provider)
  const gradeB = viaAccount(linkB, keyB, objA?.canonical.provider)
  if (gradeA || gradeB) return { same: false, grade: gradeA === 'strong' || gradeB === 'strong' ? 'strong' : 'weak', basis: 'provider_account' }
  const apart = otherPersonLinkGrade(linkA, keyA, linkB, keyB)
  if (apart) return { same: false, grade: apart, basis: 'provider_account' }

  return isCompletePersonTable(graph)
    ? { same: false, grade: 'strong', basis: 'person_table' }
    : { same: false, grade: 'weak', basis: 'no_link' }
}
