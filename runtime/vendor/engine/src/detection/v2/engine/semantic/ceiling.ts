/**
 * 관계 의미 층 — 상한(ceiling)과 능력 이름 질의 (명세 aegi-knowledge Relation_Semantic_Layer_v1 「칸 ceiling」).
 *
 * 상한  배정 자리 표의 ceiling 칸이 낸 conditions(requires) 사실(facts.ts convertRecords). 실효 능력 = 보유자 권한 ∩ 상한.
 *       scope 는 기본이 상한이다 — 권한을 더하지 않고 깎기만 한다.
 *       보유자가 연동(Integration, 앱 신원)이면 토큰으로만 동작하므로 그 보유자의 같은 SaaS 권한 전부에 건다(Okta 관리 API = 앱 관리자 역할 ∩ 동의한 scope).
 *       사람이면 그 배정 객체가 낸 권한에만 건다(GitHub 조직 SSO 로 인가된 PAT 의 scope 는 사람의 웹 권한을 깎지 않는다).
 *       토큰 받기(authenticate)는 상한 밖이다(배정 자체가 주는 것).
 * 대상  scope 표(TOKEN_SCOPES)의 자원 object_types 로 가린다. 테넌트 자체는 object_types 가 빈 자원(orgs · policies · schemas …)이 덮는다.
 *       표가 아는 종류가 아니면(어느 scope 가 덮는지 모름) 막지 않고 모름(scope_ceiling_unknown)으로 둔다. 읽지 못한 scope 가 하나라도 있어도 같다.
 * 질의  능력 이름으로 묻는다(Need = 능력 이름 목록, 하나라도 있으면 맞음). 꺼짐 경로와 비교용으로 세기(rank, 숫자)도 그대로 받는다.
 * 깎기  설정 조건 표가 막은 능력(conditions exclude 사실, settings.ts)은 상한과 같은 자리에서 뺀다. 상한은 「이것만 남긴다」, 깎기는 「이것만 뺀다」.
 *       보유자 = 그 사람. 그 사람의 같은 SaaS 권한 간선 가운데 대상(사실의 targets)에 걸린 것, 또는 그 대상을 물을 때 내려오는 것에서 그 능력을 뺀다.
 *       그룹 · 테넌트가 받은 권한(간선 출발이 그룹)은 깎지 않는다 — 막음은 지금 어느 수집본에도 없다(설정 칸 미수집, 기본값 허용)
 */
import { CAPABILITY_LEVELS, CAPABILITY_VOCABULARY, TOKEN_SCOPES } from '../../../../ontology/generated'
import { RANK } from '../accessModel'
import type { Edge } from '../types'
import { capsOfRank, rankOf } from './capability'
import { semanticMode, type SemanticFact } from './facts'

/** 질의가 묻는 능력: 세기(숫자, 꺼짐 경로) 또는 능력 이름 목록(하나라도 있으면 맞음) */
export type Need = number | readonly string[]

/**
 * 질의 이름 → 능력 이름. 능력 수준 표(capabilities.yaml capability_levels)에서 그 수준인 능력 전부(2026-11-16 직접 권한).
 * 쓰기는 고치기, 만들기, 지우기, 공유, 보내기, 실행. 관리는 설정 바꾸기. 권한 주기와 로그인은 수준이 아니다
 */
export const NEED_CAPS: Record<'read' | 'write' | 'admin', readonly string[]> = {
  read: Object.keys(CAPABILITY_LEVELS).filter(c => CAPABILITY_LEVELS[c] === 'read'),
  write: Object.keys(CAPABILITY_LEVELS).filter(c => CAPABILITY_LEVELS[c] === 'write'),
  admin: Object.keys(CAPABILITY_LEVELS).filter(c => CAPABILITY_LEVELS[c] === 'admin'),
}

/** 능력 하나가 상위 범위 문턱(inheritCap, 테넌트 범위)을 넘는 데 드는 세기. 수준 표의 수준(읽기 1, 쓰기 3, 관리 5), 표에 없으면 능력 어휘의 세기 */
const LEVEL_RANK: Record<string, number> = { read: 1, write: 3, admin: 5 }
export function capRank(c: string): number {
  const l = CAPABILITY_LEVELS[c]
  return l && l !== 'none' ? LEVEL_RANK[l] : CAPABILITY_VOCABULARY[c]?.rank ?? 5
}

/** 켜면 능력 이름, 끄면 세기 */
export function needOf(cap: 'read' | 'write' | 'admin'): Need {
  return semanticMode() ? NEED_CAPS[cap] : RANK[cap]
}


/** 이 능력을 묻는 데 필요한 가장 낮은 세기(상위 범위 상속 문턱 inheritCap 과 견줄 때) */
export function needRank(need: Need): number {
  return typeof need === 'number' ? need : Math.min(...need.map(capRank))
}

/** 간선의 능력 목록. 의미 층 간선은 caps, 아니면 세기에서 편다. 모르면 undefined */
export function edgeCaps(e: Pick<Edge, 'caps' | 'rank'>): string[] | undefined {
  return e.caps ?? (e.rank !== undefined ? capsOfRank(e.rank) : undefined)
}

/** 아래 객체를 물을 때의 간선: 능력을 below 와 겹치는 것만 남긴다 */
function belowEdge(e: Edge): Edge {
  const caps = (edgeCaps(e) ?? []).filter(c => e.capsBelow!.includes(c))
  return { ...e, caps, rank: rankOf(caps) }
}

/** 능력 목록이 need 를 채우나. limit 는 상위 범위에서 내려올 때의 세기 문턱 */
export function allows(caps: readonly string[] | undefined, rank: number | undefined, need: Need, limit = Infinity): boolean {
  if (typeof need === 'number') return rank !== undefined ? Math.min(rank, limit) >= need : limit >= need
  if (!caps) return limit >= needRank(need)
  return need.some(c => caps.includes(c) && capRank(c) <= limit)
}

/** anyType: 능력은 아는데 닿는 객체 종류를 모름 — 넘는 부분을 막지 않고 모름으로 */
interface Entry { caps: string[]; appliesTo?: string[]; anyType?: boolean }

/** 보유자 하나의 상한 */
export interface Ceiling {
  provider: string
  /** 사람 보유자면 이 배정 객체가 낸 간선에만 */
  record?: string
  entries: Entry[]
  /** 읽지 못한 scope 가 있다 */
  unknown: boolean
  /** 근거 배정 객체 */
  sources: string[]
  /** 설정이 막은 능력(conditions exclude). 있으면 이 줄은 상한이 아니라 깎기다 */
  excludes?: Array<{ caps: string[]; targets: string[] }>
}

interface IxLike {
  has(k: string, iface: string): boolean
  provider(k: string): string | undefined
  type(k: string): string | undefined
  isTenant(k: string): boolean
}

/** conditions(requires) 사실 → 보유자 → 상한 */
export function buildCeilings(ix: IxLike, facts: readonly SemanticFact[]): Map<string, Ceiling[]> {
  const out = new Map<string, Ceiling[]>()
  for (const f of facts) {
    if (f.p === 'conditions' && f.polarity === 'exclude' && f.caps?.length) {
      const provider = ix.provider(f.from)
      if (!provider) continue
      const list = out.get(f.to) ?? []
      let c = list.find(x => x.provider === provider && x.excludes)
      if (!c) list.push((c = { provider, entries: [], unknown: false, sources: [], excludes: [] }))
      c.excludes!.push({ caps: f.caps, targets: f.targets ?? [] })
      c.sources.push(f.from)
      out.set(f.to, list)
      continue
    }
    if (f.p !== 'conditions' || f.polarity !== 'requires') continue
    const holder = f.to
    const provider = ix.provider(f.from) ?? ix.provider(holder)
    if (!provider) continue
    const record = ix.has(holder, 'Integration') ? undefined : f.from
    const list = out.get(holder) ?? []
    let c = list.find(x => x.provider === provider && x.record === record)
    if (!c) list.push((c = { provider, record, entries: [], unknown: false, sources: [] }))
    if (f.caps) c.entries.push({ caps: f.caps, appliesTo: f.appliesTo })
    else c.unknown = true
    if (f.capsUnresolved?.length) c.entries.push({ caps: f.capsUnresolved, anyType: true })
    c.sources.push(f.from)
    out.set(holder, list)
  }
  return out
}

/** scope 표가 아는 객체 종류(소문자) */
function knownTypes(provider: string): Set<string> {
  return new Set(Object.values(TOKEN_SCOPES[provider]?.resources ?? {}).flatMap(r => r.object_types.map(t => t.toLowerCase())))
}

/**
 * 상한을 건 간선 e 가 x 에 need 를 주나. 상한이 없으면 { caps, rank } 그대로.
 * 돌려주는 값: 맞으면 { reasons }(모름이면 scope_ceiling_unknown), 상한에 막히면 undefined
 */
export function underCeiling(ix: IxLike, ceilings: ReadonlyMap<string, Ceiling[]> | undefined, e0: Edge, x: string, asType: string | undefined, need: Need, limit: number): { reasons: string[] } | undefined {
  // 아래 객체(간선 도착이 아닌 곳)를 물으면 역할 능력표 below 만큼만 내려간다. 도착 자체에는 능력 전부
  const e = e0.capsBelow && x !== e0.to ? belowEdge(e0) : e0
  const all = ceilings?.get(e.from)
  const list = all?.filter(c => !c.excludes)
  // 깎기: 설정이 막은 능력을 먼저 뺀다(대상 = 간선이 걸린 객체나 묻는 객체)
  const cut = new Set(all?.filter(c => c.excludes && c.provider === ix.provider(e.to)).flatMap(c => c.excludes!).filter(en => !en.targets.length || en.targets.includes(e.to) || en.targets.includes(x)).flatMap(en => en.caps))
  const left = cut.size ? edgeCaps(e)?.filter(c => !cut.has(c)) : undefined
  const caps = left ?? (typeof need === 'number' && !list?.length ? undefined : edgeCaps(e))
  const rank = left ? rankOf(left) : e.rank
  const plain = allows(caps, rank, need, limit)
  if (!list?.length || !caps) return plain ? { reasons: [] } : undefined
  const provider = ix.provider(e.to)
  const apply = list.filter(c => c.provider === provider && (!c.record || e.refs.every(r => r.type === 'reference' && r.id === c.record)))
  if (!apply.length) return plain ? { reasons: [] } : undefined
  if (!plain) return undefined
  const t = asType ?? ix.type(x)
  const tenant = !asType && ix.isTenant(x)
  // 상한이 여럿이면(같은 SaaS 의 보유자 전체 + 배정 하나) 모두를 넘지 못한다
  let inside = caps.filter(c => c !== 'authenticate')
  // 모를 때 넘을 수도 있는 능력: 읽지 못한 scope 가 있거나 표가 모르는 종류면 전부, 종류를 모르는 scope 면 그 능력만
  let maybe = caps.filter(c => c !== 'authenticate')
  for (const c of apply) {
    const typeKnown = tenant || (!!t && knownTypes(c.provider).has(t))
    const covering = c.entries.filter(en => !en.anyType && (tenant ? !en.appliesTo?.length : !!t && !!en.appliesTo?.includes(t)))
    const allowed = new Set(covering.flatMap(en => en.caps))
    const loose = !typeKnown || c.unknown ? undefined : new Set([...allowed, ...c.entries.filter(en => en.anyType).flatMap(en => en.caps)])
    inside = inside.filter(x => allowed.has(x))
    maybe = loose ? maybe.filter(x => loose.has(x)) : maybe
  }
  const effective = [...caps.filter(c => c === 'authenticate'), ...inside]
  if (allows(effective, rankOf(effective), need, limit)) return { reasons: [] }
  const possible = [...caps.filter(c => c === 'authenticate'), ...maybe]
  return allows(possible, rankOf(possible), need, limit) ? { reasons: ['scope_ceiling_unknown'] } : undefined
}
