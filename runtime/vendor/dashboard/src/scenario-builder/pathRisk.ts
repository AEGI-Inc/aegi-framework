import { EVERYONE } from '../detection/v2/engine'
import { assetScore, kindOf, scorePath, TYPE_ORDER } from './riskScore'
import type { ThreatTypeName } from '../ontology/generated'
import { peopleAt, type Leg, type PathStep, type PersonAccess, type ScenarioGraph } from './scenarioGraph'
import { accountsOf, personOf } from '../data/accessTableStore'

/**
 * 경로 만들기의 미리보기 위험 (PoC, 제안값). 점수는 도착에서만 매기고(riskScore.scorePath), 가는 길에서는
 * 「이 후보로 가면 앞으로 닿을 수 있는 가장 큰 종류 × 자산」과 「실행 신원이 출발한 사람에서 바뀌는 홉」만 보여 준다.
 * 미리보기와 도착 모두 출발 범위(첫 홉을 누가 부를 수 있나)를 곱하고 같은 등급 경계를 쓴다. 사용자 판단 2026-11-03.
 */

export type Grade = 'High' | 'Medium' | 'Low'

/** 영향 칸의 종류 점수. 쓰기(E, G) 5, 사본 이동(F) 4. riskScore 의 KIND 와 같은 값 */
function legKind(leg: Leg): number {
  const last = leg.hops[leg.hops.length - 1]
  if (!last) return 0
  return last.kinds.some(k => k === 'E' || k === 'G') ? 5 : last.kinds.includes('F') ? 4 : 0
}

export const impactPreview = (sg: ScenarioGraph, leg: Leg): number => legKind(leg) * assetScore(sg, leg.to).score

/** 이 홉에서 앞으로 몇 홉 안에 닿을 수 있는 영향 가운데 가장 큰 종류 × 자산. 진입점 격차는 따지지 않은 최대값이다 */
export function lookAhead(sg: ScenarioGraph, hop: string, exclude: Set<string>, depth = 3, memo = new Map<string, number>()): number {
  const cached = memo.get(hop)
  if (cached !== undefined) return cached
  memo.set(hop, 0)
  const seen = new Set([...exclude, hop])
  const next = sg.nextFromHop(hop, seen)
  let best = Math.max(0, ...next.impacts.map(l => impactPreview(sg, l)))
  if (depth > 1) for (const l of next.hops) best = Math.max(best, lookAhead(sg, l.to, seen, depth - 1, memo))
  memo.set(hop, best)
  return best
}

/** 출발 범위: 이 홉을 부를 수 있는 진입점 가운데 가장 넓은 것. 누구나 3, 조직·그룹·채널 또는 여러 사람 2, 한 사람 1.
 *  고른 진입점이 아니라 홉을 부를 수 있는 쪽 전체로 센다 (같은 /mfa-reset 이면 누가 골라도 같다) */
const scopeMemo = new WeakMap<ScenarioGraph, Map<string, { score: 1 | 2 | 3; text: string }>>()
export function scopeOf(sg: ScenarioGraph, hop: string): { score: 1 | 2 | 3; text: string } {
  const memo = scopeMemo.get(sg) ?? new Map()
  scopeMemo.set(sg, memo)
  const hit = memo.get(hop)
  if (hit) return hit
  const ix = sg.engine.ix
  const entries = [...sg.entries().values()].flatMap(e => [...e.people, ...e.groups, ...e.bots])
  const reach = entries.filter(e => sg.firstHops(e, new Set([e])).some(l => l.to === hop))
  const people = reach.filter(k => ix.isPerson(k))
  const out: { score: 1 | 2 | 3; text: string } = reach.includes(EVERYONE) ? { score: 3, text: '누구나' }
    : reach.some(k => ix.isTenant(k)) ? { score: 2, text: '조직 누구나' }
    : reach.some(k => ix.isGroupLike(k)) ? { score: 2, text: '그룹' }
    : people.length > 1 ? { score: 2, text: `${people.length}명` }
    : { score: 1, text: people[0] ? sg.name(people[0]) : '한 사람' }
  memo.set(hop, out)
  return out
}

/** 등급 경계 (제안값). 출발 범위 1~3 × 종류 4~5 × 자산 1~3 = 4~45. 미리보기와 도착이 같은 잣대를 쓴다 */
export const finalGrade = (s: number): Grade => (s >= 24 ? 'High' : s >= 12 ? 'Medium' : 'Low')

/** 도착에서의 점수: 출발 범위 × riskScore 의 종류 × 자산. 엔진이 진입점의 격차를 확인하지 못하면 점수 없음 */
export function finalScore(sg: ScenarioGraph, path: PathStep[]): { scope: ReturnType<typeof scopeOf>; base: number; total: number; grade: Grade } | null {
  // 진입점 격차 점수(riskScore)가 없어도 원본을 못 보는 사람이 사본을 보면 읽기 4 × 원본 자산 점수
  const base = scorePath(sg, path).total || Math.max(0, ...exposures(sg, path).map(x => 4 * assetScore(sg, x.origin).score))
  if (!base) return null
  const scope = scopeOf(sg, path[1].key)
  const total = scope.score * base
  return { scope, base, total, grade: finalGrade(total) }
}

/** 대상 종류별 「무엇을 하게 되나」 */
function writeText(sg: ScenarioGraph, key: string): string {
  const type = `${sg.provider(key)}|${sg.objectType(key)}`
  if (type === 'slack|conversation') return '채널 게시'
  if (type === 'github|Repository' || sg.objectType(key) === 'commit') return '코드 변경'
  if (sg.engine.ix.isPerson(key)) return '계정 변경'
  if (sg.engine.ix.isTenant(key)) return '관리 작업'
  return '내용 변경'
}

/** 원본 읽기: 경로가 읽는 원본(F 로 들어오는 자원)마다, 그 원본을 이 경로의 연동 지점으로 새로 읽게 되는 사람 수(접근 표 새 권한).
 *  원본 기준으로 묻는다 (도착 채널은 멤버가 원래 읽으니 채널 기준으로는 격차가 안 나온다) */
export function exposures(sg: ScenarioGraph, path: PathStep[]): Array<{ origin: string; people: number }> {
  const onPath = new Set(path.map(p => p.key))
  const origins = new Set<string>()
  for (const e of sg.engine.ix.edges.values()) {
    if (e.kind === 'F' && onPath.has(e.to) && !onPath.has(e.from) && sg.engine.ix.has(e.from, 'Resource')) origins.add(e.from)
  }
  return [...origins].map(origin => {
    const a = peopleAt(sg, [...path, { key: origin }], 'read')
    const people = a.people.filter(p => isGap(p) && !!p.point && onPath.has(p.point)).length
    return { origin, people }
  }).filter(x => x.people > 0)
}

const isGap = (p: PersonAccess) => p.side === 'gap' || p.side === 'gap_inferred'

/** 직접 권한과 파생 접근을 한 줄로 */
function nativeText(p: PersonAccess): string {
  const why = p.reasons.join(', ')
  return `직접 권한 ${p.direct ?? '없음'}, 파생 접근 ${p.derived ?? '없음'}${p.side === 'gap_inferred' ? `, 엔진 추정${why ? ` (${why})` : ''}` : ''}`
}

/** 경로의 엔진 간선 줄. 접근 표는 사람마다 연동 지점만 싣으므로 근거 간선은 사람이 만든 이 경로의 간선이다 */
export interface PathEdge { id: string; kind: string; fromName: string; toName: string; label: string }
function pathEdges(sg: ScenarioGraph, path: PathStep[]): PathEdge[] {
  return path.flatMap(s => s.via?.hops.flatMap(h => h.edgeIds) ?? []).map(id => sg.engine.ix.edges.get(id)).filter((e): e is NonNullable<typeof e> => !!e)
    .map(e => ({ id: e.id, kind: e.kind, fromName: sg.name(e.from), toName: sg.name(e.to), label: e.label }))
}

export interface EffectDetail {
  /** 위협 유형 이름. 그 사람들 직접 권한으로 가른다(riskScore kindOf) */
  kind: ThreatTypeName
  /** 쓰기: 도착 대상을 바꿈. 읽기: 도착으로 옮겨진 원본 내용을 봄 */
  effect: 'write' | 'read'
  /** 무엇이 일어나나 */
  what: string
  /** 쓰기에서 하게 되는 일 (예: 코드 변경) */
  action?: string
  /** 누구에게 (쓰기는 시작한 사람, 읽기는 원본을 못 보는데 사본을 보게 되는 사람). key 는 접근 표 사람 키(대표 계정 키) */
  people: Array<{ name: string; inferred: boolean; key?: string }>
  /** 읽기의 원본 */
  origin?: string
  /** 대표 한 사람의 직접 권한과 파생 접근 */
  native: string
  /** 이 경로의 엔진 간선 줄 */
  chain: PathEdge[]
}

/** 사람을 유형마다 나눈다(유형 순서대로) */
function byKind(list: PersonAccess[]): Array<[ThreatTypeName, PersonAccess[]]> {
  return TYPE_ORDER.map(k => [k, list.filter(p => kindOf(p) === k)] as [ThreatTypeName, PersonAccess[]]).filter(([, l]) => l.length > 0)
}

/** 영향 근거: 영향과 유형마다 누구에게, 왜(직접 권한과 파생 접근, 경로 간선) */
export function effectDetails(sg: ScenarioGraph, path: PathStep[]): EffectDetail[] {
  const entry = path[0].key
  const dest = path[path.length - 1].key
  const onPath = new Set(path.map(p => p.key))
  const touches = (p: PersonAccess) => (!!p.point && onPath.has(p.point)) || accountsOf(p.key).some(k => onPath.has(k))
  const chain = pathEdges(sg, path)
  const out: EffectDetail[] = []
  const w = peopleAt(sg, path, 'write')
  const wGap = w.people.filter(p => isGap(p) && touches(p))
  const person = personOf(entry)
  const me = w.people.find(p => p.key === person)
  const lead = me && isGap(me) ? me : sg.engine.ix.isPerson(entry) ? undefined : wGap[0]
  if (lead) for (const [kind, list] of byKind(me && isGap(me) ? [me] : wGap)) out.push({
    kind, effect: 'write', what: `${sg.name(dest)}: ${writeText(sg, dest)}`, action: writeText(sg, dest),
    people: list.map(p => ({ name: p.name, inferred: p.side === 'gap_inferred' })),
    native: nativeText(list[0]), chain,
  })
  for (const x of exposures(sg, path)) {
    const a = peopleAt(sg, [...path, { key: x.origin }], 'read')
    for (const [kind, list] of byKind(a.people.filter(p => isGap(p) && touches(p)))) out.push({
      kind, effect: 'read', what: `${sg.name(x.origin)} 내용이 ${sg.name(dest)}로 전달`,
      people: list.map(p => ({ name: p.name, inferred: p.side === 'gap_inferred', key: p.key })),
      origin: x.origin,
      native: nativeText(list[0]), chain,
    })
  }
  return out
}
