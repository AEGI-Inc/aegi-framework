// 위협 묶기 (docs/spec/AEGI_THREAT_JUDGMENT_V2.md 5절 규칙 10, 11, 12)
//
// 사람과 대상마다 나온 판정을 연동 지점과 대상 한 쌍에 한 건으로 묶는다. 유형은 키에서 뺀다.
// 대표 유형은 aegi-knowledge threat_types.yaml order 순서(데이터 반출, 권한 상승, 비인가 접근, 추적성 상실)의 첫 유형. 추적성 상실은 고정 실행 신원마다 한 건.
import type { Extent, JudgeEdge, JudgeGraph, JudgeNode, JudgeResult, JudgedThreat, JudgedTrace, Hop, Likelihood, Spot } from './judge'
import { HIDDEN, nodeClass } from './judge'
import { THREAT_TYPES, THREAT_TYPE_ORDER } from '../../ontology/generated'
import { gainedOf, gapOf, headcountOf } from './threatGap'
import type { AccessLevel, HopRef, ThreatHop, ThreatSeverity, ThreatSubject, ThreatType, ThreatV2 } from './contract'
import type { BlastRadius } from '../v2/blastRadius'

/** 키 구분자. 객체 키에 「|」가 들어 있어 쓰지 않는 제어 문자를 쓴다 */
const SEP = ''

/** 대표 유형 순서(aegi-knowledge threat_types.yaml order) */
const ORDER: ThreatType[] = THREAT_TYPE_ORDER.map(id => THREAT_TYPES.find(t => t.id === id)!.name)

const LEVELS: AccessLevel[] = ['읽기', '쓰기', '관리']
/** 판정 줄이 새로 얻은 수준. 「아래 내용 읽기」는 읽기로 센다(2026-11-19 결정). Access Gap 값이 없으면 수준으로 본다 */
function levelsOf(t: JudgedThreat): Set<AccessLevel> {
  const a = t.access
  const out = new Set<AccessLevel>(a ? gainedOf(a.base, a.derived) : t.level === 'read' ? ['읽기'] : t.level === 'admin' ? ['쓰기', '관리'] : ['쓰기'])
  if (t.flags.includes(HIDDEN)) out.add('읽기')
  return out
}
/** 줄 묶음이 얻은 수준. sure 면 확정 줄만 */
const levelsIn = (rows: JudgedThreat[], sure: boolean): Set<AccessLevel> => new Set(rows.filter(r => !sure || r.certainty === '확정').flatMap(r => [...levelsOf(r)]))
/** all 가운데 sure 에 없는 수준(수준 순서) */
const minus = (all: Set<AccessLevel>, sure: Set<AccessLevel>): AccessLevel[] => LEVELS.filter(l => all.has(l) && !sure.has(l))

/** 짧고 안정된 문자열 해시 */
export function threatHash(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

const sortTypes = (ts: Iterable<ThreatType>) => [...new Set(ts)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))

/** 범위 위로 올라가는 사슬(자신 포함) */
function ancestors(parents: Map<string, string[]>, k: string): string[] {
  const out = [k]
  const seen = new Set(out)
  for (let i = 0; i < out.length; i++) for (const p of parents.get(out[i]) ?? []) if (!seen.has(p)) { seen.add(p); out.push(p) }
  return out
}

/**
 * 같은 연동 지점에서 같은 사람들이 같은 유형과 차원(읽기, 쓰기 이상)을 여러 대상에 얻으면 그 대상들의 공통 상위 범위 하나로 묶는다.
 * 규칙 10 「직접 공유는 가장 위의 공유 지점 하나」를 연동 경로에도 쓴 것. 공통 범위가 없으면 대상마다 한 건
 */
function collapseTargets(g: JudgeGraph, threats: JudgedThreat[]): Map<string, string> {
  const parents = new Map<string, string[]>()
  for (const e of g.edges) if (e.kind === '범위') { const l = parents.get(e.from); if (l) l.push(e.to); else parents.set(e.from, [e.to]) }
  const byTarget = new Map<string, Set<string>>()
  for (const t of threats) {
    const k = `${t.point}${SEP}${t.target}`
    if (!byTarget.has(k)) byTarget.set(k, new Set())
    byTarget.get(k)!.add(`${t.person}:${[...t.types].sort().join('+')}:${t.certainty}:${t.dim}`)
  }
  const sameShape = new Map<string, string[]>()
  for (const [k, v] of byTarget) {
    const [point, target] = [k.slice(0, k.indexOf(SEP)), k.slice(k.indexOf(SEP) + 1)]
    const shape = `${point}${SEP}${[...v].sort().join(',')}`
    const same = sameShape.get(shape)
    if (same) same.push(target)
    else sameShape.set(shape, [target])
  }
  const rep = new Map<string, string>()
  // 같은 연동 지점에서 한 테넌트의 다른 사람 계정 여럿을 대상으로 얻으면 테넌트 하나로 묶는다.
  // 사람마다 자기 계정은 대상에서 빠져 모양이 달라지므로 모양과 상관없이 묶는다
  const tenantOf = (t: string) => g.nodes[t]?.kind === 'person' ? g.edges.find(e => e.kind === '소속' && e.from === t && g.nodes[e.to]?.kind === 'tenant')?.to : undefined
  const people = new Map<string, string[]>()
  for (const k of byTarget.keys()) {
    const [point, target] = [k.slice(0, k.indexOf(SEP)), k.slice(k.indexOf(SEP) + 1)]
    const tenant = tenantOf(target)
    if (!tenant) continue
    const key = `${point}${SEP}${tenant}`
    const l = people.get(key); if (l) l.push(target); else people.set(key, [target])
  }
  for (const [key, targets] of people) if (targets.length > 1) for (const t of targets) rep.set(`${key.slice(0, key.indexOf(SEP))}${SEP}${t}`, key.slice(key.indexOf(SEP) + 1))
  for (const [shape, targets] of sameShape) {
    const point = shape.slice(0, shape.indexOf(SEP))
    let root = targets[0]
    if (targets.length > 1) {
      const chains = targets.map(t => ancestors(parents, t))
      root = chains[0].find(a => chains.every(c => c.includes(a))) ?? ''
    }
    for (const t of targets) if (!rep.has(`${point}${SEP}${t}`)) rep.set(`${point}${SEP}${t}`, root || t)
  }
  return rep
}

/** 대표 대상까지 경로. 묶인 대상의 경로를 쓰면 끝을 공통 범위로 바꾼다.
 * 간선마다 그 간선을 만든 그래프 간선의 근거를 붙인다(edgesFor). 묶인 대상이면 대상마다 찾아 합친다 */
function pathTo(g: JudgeGraph, parents: Map<string, string[]>, outOf: Map<string, JudgeEdge[]>, byEnds: Map<string, JudgeEdge[]>, list: JudgedThreat[], rows: JudgedThreat[], target: string, members: Set<string>): ThreatV2['path']['hops'] {
  const src = list.find(t => t.target === target) ?? list[0]
  // 새 쓰기나 새 관리를 얻은 판정 줄이 있으면 쓰기 이상 권한 간선이, 아니면 읽기 권한 간선이 근거
  const need: Need = rows.some(t => gainsWrite(t).newW || gainsWrite(t).newA) ? 'w' : 'r'
  const swap = (k: string) => (k === src.target ? target : k)
  return src.hops.map(h => {
    const tos = h.to === src.target ? [...new Set([src.target, ...members])] : [h.to]
    const refs = refsOf(tos.flatMap(to => edgesFor(g, parents, outOf, byEnds, h, to, need)))
    return { kind: h.kind, from: swap(h.from), to: swap(h.to), ...(refs.length ? { refs } : {}) }
  })
}

/** 그래프 간선들의 근거. 같은 근거는 한 번, 종류와 id 차례 */
function refsOf(edges: JudgeEdge[]): HopRef[] {
  const all = edges.flatMap(e => e.refs ?? [])
  return [...new Map(all.map(r => [`${r.type}${SEP}${r.id}`, r])).values()].sort((a, b) => (a.type + a.id).localeCompare(b.type + b.id))
}

/** 사람 계정에서 연동 지점까지 길(판정 lead). 간선마다 근거를 붙인다. 권한 간선은 판정이 단 필요한 수준을 주는 간선을 먼저 찾는다(없으면 읽기) */
function leadOf(g: JudgeGraph, parents: Map<string, string[]>, outOf: Map<string, JudgeEdge[]>, byEnds: Map<string, JudgeEdge[]>, lead: readonly Hop[]): ThreatHop[] {
  return lead.map(h => {
    const refs = refsOf(edgesFor(g, parents, outOf, byEnds, h, h.to, h.need ?? 'r'))
    return { kind: h.kind, from: h.from, to: h.to, ...(refs.length ? { refs } : {}) }
  })
}

/**
 * 경로 간선 하나의 근거가 되는 그래프 간선. 같은 종류, 같은 출발에서 도착이나 그 상위 범위로 가는 간선 중 가장 가까운 범위의 것.
 * 권한은 수준이 있는 간선만(수준 없는 역할은 판정에 안 씀), 상위 범위 간선은 appliesTo 가 대상 종류를 덮을 때만.
 * 출발에 직접 없으면 소속을 따라 올라간 그룹(권한), 자동화 자신을 가리키는 접속자 권한 실행 신원, 자동화를 거치는 데이터 흐름(via)
 */
type Need = NonNullable<Hop['need']>
/** 권한 간선 수준이 판정에 필요한 수준(읽기, 쓰기 이상, 관리)을 주는가 */
const LEVEL_GIVES: Record<string, Need[]> = { read: ['r'], write: ['r', 'w'], admin: ['r', 'w', 'a'], post: ['w'] }

function edgesFor(g: JudgeGraph, parents: Map<string, string[]>, outOf: Map<string, JudgeEdge[]>, byEnds: Map<string, JudgeEdge[]>, h: { kind: string; from: string; to: string }, to: string, need: Need): JudgeEdge[] {
  const chain = ancestors(parents, to)
  const fits = (e: JudgeEdge, at: string, strict: boolean) => e.kind === h.kind && e.to === at &&
    (e.kind !== '권한' || (!!e.level && (!strict || LEVEL_GIVES[e.level]?.includes(need)) &&
      (at === to || !e.appliesTo || e.appliesTo.includes(g.nodes[to]?.type ?? ''))))
  const hitBy = (strict: boolean) => (k: string) => {
    for (const at of chain) {
      const found = (byEnds.get(`${k}${SEP}${h.kind}${SEP}${at}`) ?? []).filter(e => fits(e, at, strict))
      if (found.length) return found
    }
    return []
  }
  // 필요한 수준을 주는 간선을 출발, 소속 그룹 순으로 먼저 찾고, 없으면 수준과 상관없이 찾는다
  let used: JudgeEdge[] = []
  for (const strict of h.kind === '권한' ? [true, false] : [false]) {
    const hit = hitBy(strict)
    used = hit(h.from)
    if (!used.length && h.kind === '권한') used = viaMembership(h.from, hit, outOf)
    if (used.length) break
  }
  // 접속자 권한 차용은 경로를 자동화에서 대상으로 그리지만 간선은 자동화 자신을 가리킨다
  if (!used.length && h.kind === '실행 신원') used = (outOf.get(h.from) ?? []).filter(e => e.kind === '실행 신원' && e.to === h.from && e.mode === 'caller')
  // 자동화를 거치는 데이터 흐름은 경로를 원본에서 자동화로 그리지만 간선은 원본에서 받는 곳으로 간다
  if (!used.length && h.kind === '데이터 흐름') used = (outOf.get(h.from) ?? []).filter(e => e.kind === '데이터 흐름' && e.via === h.to)
  return used
}

/**
 * 판정 경로 간선 하나를 만든 그래프 간선(게시 근거 찾기와 같은 규칙, edgesFor). 사건 기록 대조(v2/engine/usage.ts)가 근거 간선을 찾을 때 쓴다.
 * 권한 간선은 hop.need(없으면 읽기) 수준을 주는 간선을 먼저 찾는다
 */
export function hopEdges(g: JudgeGraph): (h: Hop) => JudgeEdge[] {
  const parents = new Map<string, string[]>()
  const outOf = new Map<string, JudgeEdge[]>()
  const byEnds = new Map<string, JudgeEdge[]>()
  const push = (m: Map<string, JudgeEdge[]>, k: string, e: JudgeEdge) => { const l = m.get(k); if (l) l.push(e); else m.set(k, [e]) }
  for (const e of g.edges) {
    if (e.kind === '범위') { const l = parents.get(e.from); if (l) l.push(e.to); else parents.set(e.from, [e.to]) }
    push(outOf, e.from, e)
    push(byEnds, `${e.from}${SEP}${e.kind}${SEP}${e.to}`, e)
  }
  return h => edgesFor(g, parents, outOf, byEnds, h, h.to, h.need ?? 'r')
}

/** 소속을 너비 우선으로 올라가 권한 간선이 있는 가장 가까운 그룹들. 그 소속 사슬 간선과 권한 간선 */
function viaMembership(start: string, hit: (k: string) => JudgeEdge[], outOf: Map<string, JudgeEdge[]>): JudgeEdge[] {
  const prev = new Map<string, JudgeEdge | null>([[start, null]])
  let frontier = [start]
  while (frontier.length) {
    const next: string[] = []
    for (const x of frontier) for (const e of outOf.get(x) ?? []) {
      if (e.kind !== '소속' || prev.has(e.to)) continue
      prev.set(e.to, e)
      next.push(e.to)
    }
    const found = next.filter(k => hit(k).length)
    if (found.length) {
      const out: JudgeEdge[] = []
      for (const k of found) {
        out.push(...hit(k))
        for (let e = prev.get(k); e; e = prev.get(e.from)) out.push(e)
      }
      return out
    }
    frontier = next
  }
  return []
}

/*
 * 심각도 (명세 「심각도」, 2026-11-18 결정). OWASP Risk Rating Methodology(https://community.owasp.org/OWASP_Risk_Rating_Methodology):
 * 위험 = 가능성 x 영향. 요소마다 0~9 점을 매겨 평균하고 3 미만 LOW, 6 미만 MEDIUM, 그 밖 HIGH 로 나눈 뒤 원문 표로 엮는다(Note 칸은 low).
 * 가능성은 신호가 있는 요소(규모, 기회, 공격 쉬움, 침입 탐지)만, 영향은 그 판정에 해당하는 요소만 평균한다. 확실성은 쓰지 않는다
 */
/** 규모: 관리자만 2, 특정 채널이나 그룹 구성원 4, 조직 전원 6, 누구나 9. 조직 밖 사람은 특정 자리로 들어와도 5 */
const SIZE: Record<Spot, number> = { admin: 2, member: 4, org: 6, anyone: 9 }
const OUTSIDE_SIZE = 5
/** 기회: 들어가는 자리에 필요한 수준. 관리 0, 쓰기 4, 읽기나 호출 7, 계정 없이(조직 밖 직접 공유, 누구나) 9 */
const OPPORTUNITY: Record<Likelihood['need'], number> = { admin: 0, write: 4, read: 7, none: 9 }
/** 공격 쉬움: 평소대로(사본 읽기, 봇 호출, 폼 제출) 9, 자원 안 자격증명 꺼내 쓰기 5, 자동화를 일부러 고침 3 */
const EXPLOIT: Record<Likelihood['effort'], number> = { usual: 9, extract: 5, edit: 3 }
/** 침입 탐지: AEGI 가 감사 로그를 수집함 3(기록되고 검토됨), 감사 로그에 사람이 남음 8, 고정 신원 이름만 남거나 모름 9 */
const DETECTION = { logged: 3, recorded: 8, hidden: 9 }
/** 기밀성(새 읽기). 내용과 자격증명은 민감. 계정 프로필과 설정은 민감하지 않음(OWASP 원문 소량 2, 대량 6, 전부 9) */
const CONFIDENTIALITY: Record<Extent, number> = { some: 5, mid: 5, wide: 7, all: 9 }
const CONFIDENTIALITY_PLAIN: Record<Extent, number> = { some: 2, mid: 4, wide: 6, all: 9 }
/** 조직 밖 사람이 읽는 기밀성. 밖으로 간 데이터는 되돌릴 수 없어 민감도와 상관없이 이 표 */
const CONFIDENTIALITY_OUT: Record<Extent, number> = { some: 7, mid: 8, wide: 9, all: 9 }
/** 대상이 민감하지 않은가: 계정 프로필이나 설정이고 자격증명이 아니다 */
const plain = (n: JudgeNode | undefined): boolean => !!n && !n.credential && (nodeClass(n) === 'account' || nodeClass(n) === 'config')
/** 무결성(새 쓰기). 쓰기와 관리는 심각한 훼손(조금은 원문 3을 2로 낮춤, 2026-11-19), 게시 전용은 가벼운 훼손 */
const INTEGRITY: Record<Extent, number> = { some: 2, mid: 5, wide: 7, all: 9 }
const INTEGRITY_POST: Record<Extent, number> = { some: 1, mid: 3, wide: 5, all: 9 }
/** 가용성(새 관리) */
const AVAILABILITY: Record<Extent, number> = { some: 5, mid: 5, wide: 7, all: 9 }
/** 책임 추적성: 사람이 남음 1, 고정 신원만 남고 부르는 사람이 특정 채널이나 그룹 7, 조직 전원이나 누구나 9 */
const accountability = (l: Likelihood): number => (l.recorded ? 1 : l.spot === 'org' || l.spot === 'anyone' ? 9 : 7)
/** 원문 표. 행은 영향(LOW, MEDIUM, HIGH), 칸은 가능성(LOW, MEDIUM, HIGH) */
const MATRIX: ThreatSeverity[][] = [['low', 'low', 'medium'], ['low', 'medium', 'high'], ['medium', 'high', 'critical']]
const RANK: Record<ThreatSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 }
const band = (x: number): 0 | 1 | 2 => (x < 3 ? 0 : x < 6 ? 1 : 2)
/** 평균. 점수는 소수 둘째 자리까지 싣는다(등급은 반올림 전 값으로 나눈다) */
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
const round2 = (x: number): number => Math.round(x * 100) / 100
const EXTENT_RANK: Record<Extent, number> = { some: 0, mid: 1, wide: 2, all: 3 }
const widest = (a: Extent, b: Extent | undefined): Extent => (b && EXTENT_RANK[b] > EXTENT_RANK[a] ? b : a)

/** 판정 줄이 새로 얻은 쓰기(게시 전용 포함), 관리. Access Gap 값이 없으면 수준으로 본다 */
function gainsWrite(t: JudgedThreat): { newW: boolean; newA: boolean } {
  const a = t.access
  return { newW: a ? a.base[1] < 2 && a.derived[1] >= 2 : t.level !== 'read', newA: a ? a.base[1] < 3 && a.derived[1] >= 3 : t.level === 'admin' }
}

type Factors = ThreatV2['severityFactors']
type Scored = { severity: ThreatSeverity; likelihood: Factors['likelihood']; impact: Factors['impact']; sum: number }

function likelihoodOf(l: Likelihood): { f: Factors['likelihood']; raw: number } {
  const f = { size: l.outside ? Math.max(OUTSIDE_SIZE, SIZE[l.spot]) : SIZE[l.spot], opportunity: OPPORTUNITY[l.need], exploit: EXPLOIT[l.effort], detection: l.logged ? DETECTION.logged : l.recorded ? DETECTION.recorded : DETECTION.hidden }
  const raw = mean([f.size, f.opportunity, f.exploit, f.detection])
  return { f: { ...f, score: round2(raw) }, raw }
}

/** 해당하는 영향 요소만 평균한다. 책임 추적성은 추적성 상실(trace)에만 든다 */
function scoreOf(l: Likelihood, impact: Omit<Factors['impact'], 'score' | 'accountability'>, trace = false): Scored {
  const L = likelihoodOf(l)
  const i = trace ? { ...impact, accountability: accountability(l) } : impact
  if (!Object.keys(i).length) throw new Error('영향 요소가 없는 판정 줄')
  const raw = mean(Object.values(i))
  return { severity: MATRIX[band(raw)][band(L.raw)], likelihood: L.f, impact: { ...i, score: round2(raw) }, sum: L.raw + raw }
}

const better = (a: Scored | undefined, b: Scored): boolean => !a || RANK[b.severity] > RANK[a.severity] || (RANK[b.severity] === RANK[a.severity] && b.sum > a.sum)

/**
 * 판정 줄 하나의 심각도. 영향은 그 줄이 새로 얻은 것: 새 읽기, 데이터 반출, 아래 내용 읽기면 기밀성(조직 밖 사람이면 반출 표, 프로필과 설정이면 민감하지 않은 표),
 * 새 쓰기면 무결성(게시 전용은 가벼운 훼손), 새 관리면 가용성.
 * 범위는 판정이 정한 것(extent)이고 대상이 자격증명이면 피해 범위(credentialExtent)와 견줘 넓은 쪽. 길이 둘이면 등급이 높은 길
 */
function rowScore(g: JudgeGraph, t: JudgedThreat, credentialExtent?: ReadonlyMap<string, Extent>): Scored {
  const extent = widest(t.extent ?? 'some', g.nodes[t.target]?.credential ? credentialExtent?.get(t.target) : undefined)
  const a = t.access
  const { newW, newA } = gainsWrite(t)
  const reads = (a ? a.base[0] < 1 && a.derived[0] >= 1 : t.level === 'read') || t.types.includes('데이터 반출') || t.flags.includes(HIDDEN)
  const outside = !!t.external || t.types.includes('데이터 반출')
  const conf = outside ? CONFIDENTIALITY_OUT : plain(g.nodes[t.target]) ? CONFIDENTIALITY_PLAIN : CONFIDENTIALITY
  const impact = {
    ...(reads ? { confidentiality: conf[extent] } : {}),
    ...(newW ? { integrity: (t.flags.includes('게시 전용') ? INTEGRITY_POST : INTEGRITY)[extent] } : {}),
    ...(newA ? { availability: AVAILABILITY[extent] } : {}),
  }
  let best: Scored | undefined
  for (const l of t.likelihood) { const s = scoreOf(l, impact); if (better(best, s)) best = s }
  if (!best) throw new Error(`가능성 신호가 없는 판정 줄: ${t.person} ${t.target}`)
  return best
}

/**
 * 추적성 상실 한 건의 심각도. 영향은 책임 추적성 하나(그 신원으로 사람이 얻는 접근은 비인가 접근, 권한 상승 판정이 사람마다 매긴다).
 * 등급은 medium 을 넘지 않는다(추적이 어려운 관리 문제이지 피해 자체가 아니다). 길이 여럿이면 등급이 높은 길
 */
const TRACE_CAP: ThreatSeverity = 'medium'
function traceScore(tr: JudgedTrace): Scored {
  let best: Scored | undefined
  for (const w of tr.ways) {
    const s = scoreOf(w.likelihood, {}, true)
    if (better(best, s)) best = s
  }
  if (!best) throw new Error(`길이 없는 추적성 상실: ${tr.identity}`)
  return RANK[best.severity] > RANK[TRACE_CAP] ? { ...best, severity: TRACE_CAP } : best
}

/**
 * 자격증명 피해 범위(blastRadius, 토큰 권한만 가정)의 손실 범위. 조직 단위 권한에 닿거나 SaaS 둘 이상으로 퍼지면 전부,
 * 권한(읽기, 쓰기, 관리)을 얻는 객체가 여럿이면 넓게, 그 밖은 조금
 */
export function blastExtent(b: BlastRadius): Extent {
  if (b.crossProvider || b.providers.length >= 2 || b.nodes.some(n => n.tenantWide)) return 'all'
  const reached = b.nodes.filter(n => n.via !== null && (n.level === 'read' || n.level === 'write' || n.level === 'admin'))
  return reached.length >= 2 ? 'wide' : 'some'
}

/** 위협 등급은 사람마다 매긴 등급 중 가장 높은 것. 사람 수는 등급에 쓰지 않고 같은 등급 안의 정렬에 쓴다 */
function severityOf(g: JudgeGraph, list: JudgedThreat[], people: number, credentialExtent?: ReadonlyMap<string, Extent>): Pick<ThreatV2, 'severity' | 'severityFactors'> {
  let best: Scored | undefined
  for (const t of list) { const s = rowScore(g, t, credentialExtent); if (better(best, s)) best = s }
  return { severity: best!.severity, severityFactors: { people, likelihood: best!.likelihood, impact: best!.impact } }
}

/**
 * 사건 기록이 쓰임을 확인한 판정 행의 열쇠(assemble 의 observed). 사람(대표 키)이 이 연동 지점으로 얻은 파생 접근으로 그 대상에 한 일.
 * 추적성 상실은 열쇠가 신원 키 하나다(자동화가 고정 실행 신원으로 한 일)
 */
export const usedKey = (point: string, person: string, target: string): string => `${point}${SEP}${person}${SEP}${target}`

/**
 * observed: 사건 기록이 쓰임을 확인한 열쇠(usedKey, 추적성 상실은 신원 키). 위협의 판정 행 하나라도 들어 있거나 데이터 반출 판정 행에 전송 기록(sent)이 있으면 「발생」(명세 5절 규칙 12).
 * gap: 판정의 제외 행, 직접 권한과 그 계정, 닿기만 하는 사람(JudgeResult.excluded, holders, holderAccounts, reach). 주면 Access Gap 벤에 넣는다.
 * credentialExtent: 자격증명마다 피해 범위의 손실 범위(blastExtent). 대상이 자격증명인 판정의 심각도 범위에 쓴다
 */
export function assemble(g: JudgeGraph, threats: JudgedThreat[], traces: JudgedTrace[], observed: ReadonlySet<string> = new Set(), gap?: Partial<Pick<JudgeResult, 'excluded' | 'holders' | 'holderAccounts' | 'reach'>>, credentialExtent?: ReadonlyMap<string, Extent>): ThreatV2[] {
  const rep = collapseTargets(g, threats)
  const parents = new Map<string, string[]>()
  for (const e of g.edges) if (e.kind === '범위') { const l = parents.get(e.from); if (l) l.push(e.to); else parents.set(e.from, [e.to]) }
  const outOf = new Map<string, JudgeEdge[]>()
  /** 출발, 종류, 도착으로 찾는 간선 색인. 근거 찾기가 출발 노드의 간선 수에 비례하지 않게 */
  const byEnds = new Map<string, JudgeEdge[]>()
  const push = (m: Map<string, JudgeEdge[]>, k: string, e: JudgeEdge) => { const l = m.get(k); if (l) l.push(e); else m.set(k, [e]) }
  for (const e of g.edges) {
    push(outOf, e.from, e)
    push(byEnds, `${e.from}${SEP}${e.kind}${SEP}${e.to}`, e)
  }
  const groups = new Map<string, JudgedThreat[]>()
  const members = new Map<string, Set<string>>()
  /** 사람마다 미확정 판정에서만 나온 유형. 확정 판정과 합쳐질 때 확정으로 올리지 않으려고 따로 센다 */
  const unsureOnly = new Map<JudgedThreat, Set<string>>()
  /** 사람마다 합치기 전 판정 줄. 심각도는 줄마다 매긴 등급 중 가장 높은 것. Access Gap 벤의 사람별 수준도 이 줄로 본다 */
  const rowsOf = new Map<JudgedThreat, JudgedThreat[]>()
  /** 판정은 같은 사람, 같은 단계의 lead 를 한 배열로 돌려준다. 근거는 배열마다 한 번만 찾는다 */
  const leadMemo = new Map<readonly Hop[], ThreatHop[]>()
  const leadHops = (lead: readonly Hop[]): ThreatHop[] => {
    let hops = leadMemo.get(lead)
    if (!hops) leadMemo.set(lead, (hops = leadOf(g, parents, outOf, byEnds, lead)))
    return hops
  }
  const groupKey = (t: JudgedThreat) => `${t.point}${SEP}${rep.get(`${t.point}${SEP}${t.target}`) ?? t.target}`
  for (const t0 of threats) {
    const t = { ...t0, types: [...t0.types], flags: [...t0.flags] }
    const key = groupKey(t)
    if (!members.has(key)) members.set(key, new Set())
    members.get(key)!.add(t.target)
    const same = groups.get(key)?.find(x => x.person === t.person)
    if (same) {
      // 공통 범위로 묶인 대상, 읽기와 쓰기 경로처럼 같은 사람의 판정이 겹치면 유형과 확실성을 합친다.
      // 확정과 미확정이 섞이면 사람은 확정이고, 미확정 판정에서만 나온 유형은 따로 남긴다
      const uc = unsureOnly.get(same) ?? new Set<string>()
      if (same.certainty === '확정' && t.certainty === '미확정') for (const ty of t.types) { if (!same.types.includes(ty)) uc.add(ty) }
      else if (same.certainty === '미확정' && t.certainty === '확정') { for (const ty of same.types) if (!t.types.includes(ty)) uc.add(ty); for (const ty of t.types) uc.delete(ty) }
      else if (t.certainty === '확정') for (const ty of t.types) uc.delete(ty)
      unsureOnly.set(same, uc)
      rowsOf.get(same)!.push(t0)
      same.types = [...new Set([...same.types, ...t.types])]
      if (t.certainty === '확정') same.certainty = '확정'
      same.flags = [...new Set([...same.flags, ...t.flags])]
      continue
    }
    rowsOf.set(t, [t0])
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }
  // 제외 행은 같은 연동 지점과 대상의 위협이 있을 때만 그 벤에 들어간다(Access Gap 은 위협을 따른다)
  const exRows = new Map<string, JudgedThreat[]>()
  for (const t of gap?.excluded ?? []) {
    const key = groupKey(t)
    if (!groups.has(key)) continue
    const l = exRows.get(key)
    if (l) l.push(t)
    else exRows.set(key, [t])
  }
  const out: ThreatV2[] = []
  for (const [key, list] of groups) {
    const point = list[0].point
    const target = key.slice(point.length + 1)
    const subjects: ThreatSubject[] = list.map(t => {
      const uc = t.certainty === '확정' ? [...(unsureOnly.get(t) ?? [])] as ThreatType[] : []
      const own = rowsOf.get(t)!
      const all = levelsIn(own, false)
      const ul = t.certainty === '확정' ? minus(all, levelsIn(own, true)) : []
      return {
        person: t.person, types: sortTypes(t.types as ThreatType[]), certainty: t.certainty,
        levels: LEVELS.filter(l => all.has(l)),
        ...(uc.length ? { unconfirmedTypes: sortTypes(uc) } : {}),
        ...(ul.length ? { unconfirmedLevels: ul } : {}),
        // 조직 밖 표시는 사람 기준(threat_types.yaml outside, 2026-11-19 결정). 조직 안 사람이 조직 밖 상자로 받는 데이터 반출에는 붙이지 않는다
        outside: !!t.external, ...(t.entry ? { entry: t.entry.kind } : {}),
        ...(t.lead?.length ? { lead: leadHops(t.lead) } : {}),
      }
    })
    const types = sortTypes(subjects.flatMap(s => s.types))
    const certain = subjects.some(s => s.certainty === '확정')
    // 확정 위협이면 어느 사람에게서든 확정된 유형만 대표가 될 수 있다
    const sure = new Set(subjects.filter(s => s.certainty === '확정').flatMap(s => s.types.filter(ty => !s.unconfirmedTypes?.includes(ty))))
    const unconfirmedTypes = certain ? types.filter(ty => !sure.has(ty)) : []
    // 수준도 같다: 어느 확정 사람의 확정 줄에서도 얻지 않은 수준
    const sureLevels = new Set(list.filter(t => t.certainty === '확정').flatMap(t => [...levelsIn(rowsOf.get(t)!, true)]))
    const unconfirmedLevels = certain ? minus(new Set(list.flatMap(t => [...levelsIn(rowsOf.get(t)!, false)])), sureLevels) : []
    const primary = certain ? types.find(ty => sure.has(ty)) ?? types[0] : types[0]
    const reasons = [...new Set(list.flatMap(t => t.flags))].sort()
    const fingerprint = threatHash(`${point}|${target}`)
    const rows = list.flatMap(t => rowsOf.get(t)!)
    const accessGap = gapOf(rows, exRows.get(key) ?? [], [...members.get(key)!], gap?.holders, gap?.reach, point, gap?.holderAccounts)
    out.push({
      id: `threat:${fingerprint}`, fingerprint, point, target, targets: [...members.get(key)!].sort(),
      primaryType: primary, types,
      ...(unconfirmedTypes.length ? { unconfirmedTypes } : {}),
      ...(unconfirmedLevels.length ? { unconfirmedLevels } : {}),
      // 사건 기록이 쓰임을 확인했거나 데이터 반출의 조직 밖 전송 기록이 있으면 발생
      occurrence: rows.some(r => r.sent || observed.has(usedKey(point, r.person, r.target))) ? '발생' : '발생 가능',
      certainty: certain ? '확정' : '미확정',
      reasons,
      path: { hops: pathTo(g, parents, outOf, byEnds, list, rows, target, members.get(key)!) },
      subjects,
      headcount: headcountOf(list.map(t => t.person)),
      ...(accessGap ? { accessGap } : {}),
      ...severityOf(g, rows, list.reduce((n, t) => n + (g.nodes[t.person]?.multi ?? 1), 0), credentialExtent),
    })
  }
  for (const tr of traces) {
    const fingerprint = threatHash(`${tr.identity}|추적성 상실`)
    // 대상 감사 로그로 호출자 미전달을 확인하기 전에는 미확정 (6절). 약하게 이어진 계정을 합치면 사라지는 건도 미확정(5절 규칙 12)
    const sure = g.nodes[tr.identity]?.audit === 'caller_missing' && !tr.unsure
    const sc = traceScore(tr)
    out.push({
      id: `threat:${fingerprint}`, fingerprint, point: tr.identity, target: tr.identity, targets: [tr.identity],
      primaryType: '추적성 상실', types: ['추적성 상실'],
      occurrence: observed.has(tr.identity) ? '발생' : '발생 가능',
      certainty: sure ? '확정' : '미확정',
      reasons: tr.severity === 'high' ? ['쓰기 이상'] : ['읽기'],
      path: { hops: [] },
      subjects: [],
      // 확실성은 등급에 쓰지 않는다(명세 「심각도」)
      severity: sc.severity,
      severityFactors: { people: 0, likelihood: sc.likelihood, impact: sc.impact },
    })
  }
  return out
}
