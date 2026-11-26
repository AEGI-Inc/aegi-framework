// Access Gap: 위협마다 직접 권한 원과 파생 접근 원 (2026-11-17 결정, 2026-11-18 Access Gap 먼저)
//
// 판정은 사람, 대상마다 Access Gap(기준선과 가진 접근)을 먼저 세고 유형은 그 줄만 읽어 가른다(judge.ts gapsOf, typesOf).
// 판정 행은 그 Access Gap 값(기준선, 벤에 보이는 직접 수준, 가진 접근, 조직 밖 직접 공유)을 싣고 벤은 그 값을 모은다.
// 위협 하나(연동 지점과 대상)가 벤 하나다. 비인가 접근, 권한 상승, 데이터 반출 위협의 사람을 넣는다.
// 조직 밖 직접 공유(연동 지점이 대상 자신)도 기준선 밖이라 넣는다. 추적성 상실과 누구나 노드의 판정은 넣지 않는다.
// 관리자 신뢰, 승인으로 위협에서 빠진 사람은 파생 접근 원 안에 제외 이유를 달아 두고 수에서 뺀다.
import { Z, mx, type Acc } from './access'
import type { AccessLevel, ThreatAccessGap, ThreatGapPerson, ThreatHeadcount } from './contract'
import type { JudgedReach, JudgedThreat } from './judge'
import { THREAT_TYPES } from '../../ontology/generated'

/** Access Gap 벤에 넣는 위협 유형. 기준선을 보지 않는 추적성 상실만 뺀다(threat_types.yaml baseline) */
export const GAP_TYPES: ReadonlySet<string> = new Set(THREAT_TYPES.filter(t => t.id !== 'accountability_loss').map(t => t.name))
/** 직접 권한만 있는 사람은 수준 높은 순으로 이만큼만 싣는다(넓게 공유된 대상이면 원이 조직 전체가 된다). 수는 전부 센다 */
export const DIRECT_LIMIT = 50
const EVERYONE = '@everyone'

/** 화면에 보이는 인원. 누구나는 수에 넣지 않고 everyone 으로 따로 둔다 */
export function headcountOf(persons: Iterable<string>): ThreatHeadcount {
  const all = new Set(persons)
  return { people: all.size - (all.has(EVERYONE) ? 1 : 0), everyone: all.has(EVERYONE) }
}

export const levelName = (l: Acc | undefined): AccessLevel | null => (!l ? null : l[1] >= 3 ? '관리' : l[1] >= 2 ? '쓰기' : l[0] >= 1 ? '읽기' : null)
const RANK: Record<AccessLevel, number> = { 읽기: 1, 쓰기: 2, 관리: 3 }

/** 기준선보다 높아진 수준(새로 생긴 권한). 조직 안 기준선은 직접 권한 */
export const gainedOf = (direct: Acc, derived: Acc): AccessLevel[] => [
  ...(derived[0] >= 1 && direct[0] < 1 ? ['읽기' as const] : []),
  ...(derived[1] >= 2 && direct[1] < 2 ? ['쓰기' as const] : []),
  ...(derived[1] >= 3 && direct[1] < 3 ? ['관리' as const] : []),
]

/** base: 기준선, share: 조직 밖 직접 공유. only: 위협 행 없이 닿기만 하는 사람(새로 생긴 권한 없음, 수에 넣지 않음) */
/** sure: 확정 판정 줄의 파생 수준(미확정 줄에서만 얻은 수준을 가른다) */
interface Member { direct: Acc; base: Acc; derived: Acc; sure: Acc; share: Acc; certainty: '확정' | '미확정'; excluded?: '관리자' | '승인됨'; only?: boolean; via: Set<string> }

/** 판정 행의 사람이 대상에 닿기 시작한 계정. 파생 접근은 lead 첫 간선(제외 행은 via), 직접 공유는 공유받은 계정(권한 간선 시작) */
const viaOf = (t: JudgedThreat): string | undefined => t.lead?.[0]?.from ?? t.via ?? (t.flags.includes('직접 공유') ? t.hops[0]?.from : undefined)

/**
 * 한 위협의 벤.
 * rows: 그 위협으로 묶인 판정 행(사람마다 여러 행일 수 있다). excluded: 같은 위협으로 묶이는 제외 행.
 * targets: 위협이 묶은 대상. holders: 대상의 사람마다 직접 권한(누구나 공유는 뺀 확정 직접 권한).
 * reach: 대상에 이 연동 지점으로 새로 생긴 권한 없이 파생 접근이 닿는 사람. holderAccounts: 직접 권한을 받은 계정. 모두 판정이 물을 때 센다(JudgeResult)
 */
export function gapOf(
  rows: JudgedThreat[], excluded: JudgedThreat[], targets: string[],
  holders?: (t: string) => ReadonlyMap<string, Acc> | undefined, reach?: (t: string, point: string) => readonly JudgedReach[] | undefined, point?: string,
  holderAccounts?: (p: string, t: string) => string[],
): ThreatAccessGap | undefined {
  const m = new Map<string, Member>()
  const add = (t: JudgedThreat) => {
    if (!t.access || t.person === EVERYONE || !t.types.some(x => GAP_TYPES.has(x))) return
    const cur = m.get(t.person)
    const a = t.access
    if (!cur) {
      const v = viaOf(t)
      m.set(t.person, { direct: a.direct, base: a.base, derived: a.derived, sure: t.certainty === '확정' ? a.derived : Z, share: a.share ?? Z, certainty: t.certainty, ...(t.excluded ? { excluded: t.excluded } : {}), via: new Set(v ? [v] : []) })
      return
    }
    // 위협 행이 하나라도 있는 사람은 제외가 아니다. 제외 행에서 온 계정은 위협 행 계정으로 바꾼다
    if (cur.excluded && !t.excluded) { delete cur.excluded; cur.via.clear() }
    if (!cur.excluded && t.excluded) return
    const v = viaOf(t)
    if (v) cur.via.add(v)
    cur.direct = mx(cur.direct, a.direct)
    cur.base = mx(cur.base, a.base)
    cur.derived = mx(cur.derived, a.derived)
    cur.share = mx(cur.share, a.share ?? Z)
    if (t.certainty === '확정') { cur.certainty = '확정'; cur.sure = mx(cur.sure, a.derived) }
  }
  for (const t of rows) add(t)
  for (const t of excluded) add(t)
  if (![...m.values()].some(x => !x.excluded)) return undefined
  if (point !== undefined) for (const t of targets) for (const r of reach?.(t, point) ?? []) {
    if (r.point !== point || r.person === EVERYONE) continue
    const cur = m.get(r.person)
    if (!cur) m.set(r.person, { direct: r.direct, base: r.direct, derived: r.derived, sure: Z, share: Z, certainty: r.certainty, only: true, via: new Set(r.accounts) })
    else if (cur.only) { cur.direct = mx(cur.direct, r.direct); cur.derived = mx(cur.derived, r.derived); if (r.certainty === '확정') cur.certainty = '확정'; for (const k of r.accounts ?? []) cur.via.add(k) }
  }

  // 직접 권한 원: 묶인 대상 가운데 하나라도 기준선 안 직접 권한(누구나 공유 뺌)이 있는 사람. 파생 접근 원 사람의 직접 수준은 판정이 본 수준(누구나 공유 포함)을 쓴다
  const direct = new Map<string, Acc>()
  const heldAt = new Map<string, string[]>()
  for (const t of targets) for (const [p, l] of holders?.(t) ?? []) if (p !== EVERYONE) { direct.set(p, mx(direct.get(p) ?? Z, l)); heldAt.get(p)?.push(t) ?? heldAt.set(p, [t]) }
  // 벤에 싣는 사람만 계정을 묻는다(직접 권한만 있는 사람 전부를 묻지 않게)
  const directVia = (p: string): string[] => [...new Set((heldAt.get(p) ?? []).flatMap(t => holderAccounts?.(p, t) ?? []))].sort()
  const people: ThreatGapPerson[] = []
  let unauthorized = 0
  let excess = 0
  for (const [person, x] of [...m].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const d = levelName(x.direct)
    const gained = x.only ? [] : gainedOf(x.base, x.derived)
    // 확정 사람이어도 미확정 줄에서만 얻은 수준
    const sureGained = gainedOf(x.base, x.sure)
    const unconfirmedGained = x.certainty === '확정' ? gained.filter(l => !sureGained.includes(l)) : []
    if (!x.excluded && gained.length) { if (d) excess++; else unauthorized++ }
    // 직접 수준이 누구나 공유에서만 오면 직접 권한 원 밖이다
    const publicOnly = !!d && !direct.has(person)
    const share = levelName(x.share)
    const directAccounts = direct.has(person) ? directVia(person) : []
    people.push({ person, direct: d, derived: levelName(x.derived), gained, certainty: x.certainty, ...(unconfirmedGained.length ? { unconfirmedGained } : {}), ...(x.excluded ? { excluded: x.excluded } : {}), ...(publicOnly ? { publicOnly: true as const } : {}), ...(share ? { share } : {}), ...(directAccounts.length ? { directAccounts } : {}), ...(x.via.size ? { derivedAccounts: [...x.via].sort() } : {}) })
  }
  const only = [...direct].filter(([p, l]) => !m.has(p) && levelName(l)).map(([p, l]) => ({ person: p, level: levelName(l)! }))
  only.sort((a, b) => RANK[b.level] - RANK[a.level] || (a.person < b.person ? -1 : a.person > b.person ? 1 : 0))
  for (const { person, level } of only.slice(0, DIRECT_LIMIT)) {
    const directAccounts = directVia(person)
    people.push({ person, direct: level, derived: null, gained: [], ...(directAccounts.length ? { directAccounts } : {}) })
  }
  return {
    directCount: only.length + [...m.keys()].filter(p => direct.has(p)).length,
    derivedCount: m.size,
    unauthorized,
    excess,
    people,
  }
}

/** 게시 집계 threat_access_gap(명세 8절 「Access Gap」). 화면 첫 칸 숫자 */
export interface ThreatGapSummary {
  /** 새로 생긴 권한이 있고 제외되지 않은 사람. 위협을 건너 중복 없이 */
  people: number
  /** 그 가운데 한 위협에서라도 확정인 사람 */
  peopleConfirmed: number
  /** 미확정에서만 나온 사람 */
  peopleUnconfirmed: number
  /** 그런 사람이 한 명 이상인 위협 수 */
  threats: number
}

export function gapSummary(threats: ReadonlyArray<{ accessGap?: ThreatAccessGap }>): ThreatGapSummary {
  const all = new Set<string>()
  const sure = new Set<string>()
  let n = 0
  for (const t of threats) {
    let hit = false
    for (const p of t.accessGap?.people ?? []) {
      if (!p.gained.length || p.excluded) continue
      hit = true
      all.add(p.person)
      if (p.certainty !== '미확정') sure.add(p.person)
    }
    if (hit) n++
  }
  return { people: all.size, peopleConfirmed: sure.size, peopleUnconfirmed: all.size - sure.size, threats: n }
}
