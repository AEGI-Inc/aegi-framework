// 차단 지점 (docs/spec/AEGI_THREAT_JUDGMENT_V2.md 8절 cuts[])
//
// 차단 지점은 지웠을 때 위협이 실제로 닫히는 간선이다. 경로 그림의 간선에서 고르지 않고, 다시 판정해서 찾는다.
//  1. 후보: 그 위협의 사람에서 접근이 퍼지는 방향으로 닿고, 대상까지 이어지는 노드 사이의 간선 전부(사람이 바뀔 수 있는 모든 경로)
//  2. 후보를 묶음으로 지우고 같은 연결 요소를 다시 판정한다. 같은 사람이 같은 대상에서 같은 접근을 다시 얻으면 그 사람은 열림.
//     같은 접근은 데이터 반출이면 데이터 반출, 그 밖은 같은 차원(읽기, 쓰기 이상)이다. 기준선이 바뀌어 비인가 접근이 권한 상승으로 바뀌어도 열림
//     간선을 지우면 접근은 줄기만 하므로, 묶음을 지워도 열린 사람은 묶음 안 어느 간선 하나를 지워도 열려 있다. 닫힌 사람이 있는 묶음만 반으로 나눠 다시 본다.
//     끝에 남는 간선 하나는 그 간선만 지운 판정이라 정확하다(닫힌 사람 수 closes)
//  3. 설정으로 회수할 수 있는 간선(revocable, 명세 8절)과 자동화 연결(호출, 데이터 흐름, 효과)만 차단 지점으로 낸다.
//     자동화 연결은 트리거, 전달, 동작 설정이라 바꿀 수 있다(11-12 결정). 본인 메일함, 작성자, 범위처럼 회수할 설정이 없는 간선은 닫혀도 내지 않는다
//  4. 하나로 다 안 닫히면, 가장 많이 닫는 간선을 지운 그래프에서 남은 사람을 닫는 간선을 다시 찾아 최대 3개까지 함께 지우는 조합을 찾는다.
//     함께 지운 판정으로 모두 닫힐 때만 낸다
// 조치는 간선 종류로만 정한다(SaaS 이름 없음). 화면은 action 코드와 객체 키로 문장을 만든다.
import type { ThreatCutV2, ThreatHop, ThreatV2 } from './contract'
import { Index, judge, others, sortEdges, type JudgeEdge, type JudgeGraph, type JudgedThreat } from './judge'
import { THREAT_TYPES } from '../../ontology/generated'
import { headcountOf } from './threatGap'

const EXFIL: string = THREAT_TYPES.find(t => t.id === 'data_exfiltration')!.name
/** 판정 줄이 연 접근. 데이터 반출은 그 유형, 그 밖은 차원(읽기 r, 쓰기 이상 w). 유형 이름만으로는 읽기와 쓰기를 못 가른다 */
const opensOf = (x: JudgedThreat): string[] => x.types.flatMap(ty => (ty === EXFIL ? ['x'] : x.dim === 'rw' ? ['r', 'w'] : [x.dim]))

export type CutAction =
  | 'limit-callers'      // 호출: 연동 지점을 부를 수 있는 사람을 줄임
  | 'remove-member'      // 소속: 그룹, 채널 구성원에서 뺌
  | 'reduce-grant'       // 권한: 실행 신원이나 사람의 대상 권한을 줄임
  | 'caller-identity'    // 실행 신원: 고정 신원 대신 호출자 권한으로 실행
  | 'stop-flow'          // 데이터 흐름: 전달을 멈추거나 받는 곳을 줄임
  | 'remove-credential'  // 자원 안 자격증명(자격증명의 범위, 실행 신원): 자격증명을 빼고 교체
  | 'limit-effect'       // 효과: 자동 반영을 멈춤

export interface ThreatCut extends ThreatCutV2 {
  action: CutAction
  with?: { at: ThreatHop; action: CutAction }[]
}

const ACTION: Record<string, CutAction> = {
  호출: 'limit-callers', 소속: 'remove-member', 권한: 'reduce-grant', '실행 신원': 'caller-identity',
  '데이터 흐름': 'stop-flow', 효과: 'limit-effect',
}

/** 자격증명에서 나가는 범위(자원에 담김)와 실행 신원(그 신원으로 인증)은 자격증명을 빼고 교체해 끊는다 */
const actionOf = (g: JudgeGraph, h: ThreatHop): CutAction =>
  g.nodes[h.from]?.credential && (h.kind === '범위' || h.kind === '실행 신원') ? 'remove-credential' : ACTION[h.kind] ?? 'reduce-grant'

/** 자동화 연결. 트리거, 전달, 동작 설정으로 바꿀 수 있어 basis 와 상관없이 차단 지점 후보(11-12 결정) */
const AUTOMATION_WIRING = new Set(['호출', '데이터 흐름', '효과'])
const cuttable = (e: JudgeEdge) => !!e.revocable || AUTOMATION_WIRING.has(e.kind)

/** 직접 권한(judge.ts Index.direct, directAccess.ts)이 읽는 간선 종류 */
const DIRECT_KINDS: ReadonlySet<string> = new Set(['소속', '권한', '범위'])

/** 조합에 넣는 간선 수 상한 */
const MAX_WITH = 3

/** 점에서 무방향으로 닿는 노드만 남긴 그래프. 판정은 연결 요소마다 따로라 결과가 같다 */
function componentOf(g: JudgeGraph, start: string, adj: Map<string, string[]>): JudgeGraph {
  const seen = new Set([start])
  const st = [start]
  while (st.length) for (const y of adj.get(st.pop()!) ?? []) if (!seen.has(y)) { seen.add(y); st.push(y) }
  const nodes: JudgeGraph['nodes'] = {}
  for (const k of seen) if (g.nodes[k]) nodes[k] = g.nodes[k]
  // 판정이 볼 간선 순서로 한 번 둔다. 지운 그래프는 이 순서를 지켜 다시 판정할 때 다시 정렬하지 않는다
  return { nodes, edges: sortEdges(g.edges.filter(e => seen.has(e.from))), ...(g.direct ? { direct: g.direct } : {}) }
}

function adjacency(g: JudgeGraph): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  const link = (a: string, b: string) => { push(adj, a, b); push(adj, b, a) }
  for (const e of g.edges) { link(e.from, e.to); if (e.via) link(e.from, e.via); for (const p of e.gate ?? []) link(e.from, p) }
  for (const [k, n] of Object.entries(g.nodes)) for (const q of [...others(n.same), ...others(n.weak)]) link(k, q)
  return adj
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const l = m.get(k)
  if (l) l.push(v)
  else m.set(k, [v])
}

/** 간선 하나가 접근을 옮기는 방향. 데이터 흐름은 받는 쪽에서 보내는 쪽으로(읽기가 거슬러 감), 범위는 위에서 아래로 */
const ends = (e: JudgeEdge): [string, string] => (e.kind === '데이터 흐름' || e.kind === '범위' ? [e.to, e.from] : [e.from, e.to])

/** 같은 종류, 같은 양 끝 간선은 한 차단 지점(한 관계를 회수하면 같은 두 객체 사이 같은 종류 부여를 함께 본다) */
const hopKey = (e: { kind: string; from: string; to: string }) => `${e.kind}\u0000${e.from}\u0000${e.to}`

/**
 * 접근이 퍼지는 방향의 이웃. 판정 규칙에서 닿을 수 있는 쪽을 빠짐없이 넣는다(넓게 잡아도 후보가 늘 뿐 결과는 같다).
 *  데이터 흐름을 옮기는 자동화: 받는 쪽에서 그 자동화로(자동화의 실행 신원이 보내는 쪽을 읽어야 흐른다)
 *  접속자 권한 자동화: 그 자동화에서 호출자 계정으로(고친 사람이 호출자의 직접 접근을 빌린다)
 */
function arcs(g: JudgeGraph, callers: Map<string, Set<string>>): { fwd: Map<string, string[]>; bwd: Map<string, string[]> } {
  const fwd = new Map<string, string[]>()
  const bwd = new Map<string, string[]>()
  const arc = (a: string, b: string) => { push(fwd, a, b); push(bwd, b, a) }
  for (const e of g.edges) {
    const [a, b] = ends(e)
    arc(a, b)
    if (e.via) arc(e.to, e.via)
  }
  for (const [a, qs] of callers) for (const q of qs) for (const k of [q, ...others(g.nodes[q]?.same)]) arc(a, k)
  return { fwd, bwd }
}

function reach(starts: Iterable<string>, m: Map<string, string[]>): Set<string> {
  const seen = new Set(starts)
  const st = [...seen]
  while (st.length) for (const y of m.get(st.pop()!) ?? []) if (!seen.has(y)) { seen.add(y); st.push(y) }
  return seen
}

const toHop = (e: JudgeEdge): ThreatHop => ({ kind: e.kind, from: e.from, to: e.to })

export interface CutOptions {
  verify?: boolean
  /** 앞선 전체 판정의 접속자 권한 자동화 호출자. 없으면 여기서 한 번 판정한다 */
  callers?: Map<string, Set<string>>
}

export function addCuts(g: JudgeGraph, threats: ThreatV2[], opts: CutOptions = {}): void {
  if (!opts.verify) {
    for (const t of threats) t.cuts = []
    return
  }
  const callers = opts.callers ?? judge(g).callers
  const adj = adjacency(g)
  const comps = new Map<string, JudgeGraph>()
  const compOf = (k: string) => {
    let c = comps.get(k)
    if (!c) { c = componentOf(g, k, adj); for (const n of Object.keys(c.nodes)) comps.set(n, c) }
    return c
  }
  const { fwd, bwd } = arcs(g, callers)
  // 다시 판정 결과를 (연결 요소, 판정할 계정, 지운 간선)마다 한 번만 낸다. 한 간선만 지운 판정은 묶음 나누기 끝과 남은 연동 지점 확인이,
  // 같은 사람의 다른 위협은 처음 묶음이 같은 그래프를 다시 판정한다. 판정은 입력이 같으면 결과가 같다
  // 직접 권한이 읽는 간선을 지우지 않은 다시 판정은 연결 요소 전체 색인의 직접 권한 계산을 함께 쓴다(Index 의 direct)
  const rejudged = new Map<JudgeGraph, { no: Map<JudgeEdge, number>; rows: Map<string, JudgedThreat[]>; ix?: Index }>()
  const rejudge = (comp: JudgeGraph, accounts: Set<string>, removed: Set<JudgeEdge>): JudgedThreat[] => {
    let c = rejudged.get(comp)
    if (!c) rejudged.set(comp, (c = { no: new Map(comp.edges.map((e, i) => [e, i])), rows: new Map() }))
    const no = c.no
    const k = `${[...accounts].sort().join('\u0001')}\u0002${[...removed].map(e => no.get(e)!).sort((a, b) => a - b).join(',')}`
    let rows = c.rows.get(k)
    if (!rows) {
      const directFrom = [...removed].some(e => DIRECT_KINDS.has(e.kind)) ? undefined : (c.ix ??= new Index(comp))
      rows = judge({ ...comp, edges: removed.size ? comp.edges.filter(e => !removed.has(e)) : comp.edges }, { persons: accounts, keepAll: true, callers, threatsOnly: true, directFrom }).threats
      c.rows.set(k, rows)
    }
    return rows
  }

  for (const t of threats) {
    const comp = compOf(t.point)
    if (t.primaryType === '추적성 상실') { t.cuts = traceCuts(comp, t); continue }
    const persons = [...new Set(t.subjects.map(s => s.person))]
    const accounts = new Set(persons.flatMap(p => [p, ...others(g.nodes[p]?.same)]))
    const targets = new Set(t.targets)
    const of = persons.length

    // 1. 후보: 사람에서 퍼져 닿고 대상까지 이어지는 노드 사이의 간선, 같은 두 객체 사이 같은 종류는 한 묶음
    const F = reach(accounts, fwd)
    const B = reach(targets, bwd)
    const hops = new Map<string, JudgeEdge[]>()
    for (const e of comp.edges) {
      const [a, b] = ends(e)
      if (F.has(a) && B.has(b)) push(hops, hopKey(e), e)
    }

    // 이 위협이 연 접근(지우기 전 판정에서 이 연동 지점의 판정 줄)
    const opened = new Set(rejudge(comp, accounts, new Set()).filter(x => x.point === t.point && persons.includes(x.person) && targets.has(x.target)).flatMap(opensOf))
    /** 이 간선들을 지우고 다시 판정해 아직 열린 판정. 연동 지점과 상관없이 같은 사람, 같은 대상, 겹치는 접근이면 열림 */
    const openThreats = (removed: Set<JudgeEdge>, who: string[]) => {
      const w = new Set(who)
      return rejudge(comp, accounts, removed).filter(x => w.has(x.person) && targets.has(x.target) && opensOf(x).some(k => opened.has(k)))
    }
    const openAfter = (removed: Set<JudgeEdge>, who: string[]): Set<string> => new Set(openThreats(removed, who).map(x => x.person))

    /** 2. 묶음을 지워 닫힌 사람이 있으면 반으로 나눈다. 끝에 남은 묶음 하나가 닫는 사람 */
    const closers = (base: Set<JudgeEdge>, keys: string[], who: string[]): Map<string, Set<string>> => {
      const out = new Map<string, Set<string>>()
      const split = (ks: string[], ws: string[]) => {
        if (!ks.length || !ws.length) return
        const removed = new Set([...base, ...ks.flatMap(k => hops.get(k)!)])
        const open = openAfter(removed, ws)
        const closed = ws.filter(p => !open.has(p))
        if (!closed.length) return
        if (ks.length === 1) { out.set(ks[0], new Set(closed)); return }
        const h = ks.length >> 1
        split(ks.slice(0, h), closed)
        split(ks.slice(h), closed)
      }
      split(keys, who)
      return out
    }

    // 3. 설정으로 회수할 수 있는 간선과 자동화 연결만. 묶음의 간선이 모두 그래야 한다
    const revocable = [...hops.keys()].filter(k => hops.get(k)!.every(cuttable)).sort()
    const single = closers(new Set(), revocable, persons)
    const cut = (keys: string[], closed: ReadonlySet<string>): ThreatCut => {
      const closes = closed.size
      const [head, ...rest] = keys.map(k => toHop(hops.get(k)![0]))
      const act = (h: ThreatHop) => actionOf(g, h)
      // 다 안 닫히면 남은 사람이 어느 연동 지점으로 남는지 한 번 더 판정해 적는다
      const remain = closes < of
        ? [...new Set(openThreats(new Set(keys.flatMap(k => hops.get(k)!)), persons).map(x => x.point))].filter(p => p !== t.point).sort()
        : []
      return {
        at: head, action: act(head), ...(rest.length ? { with: rest.map(h => ({ at: h, action: act(h) })) } : {}), closes, of, closed: headcountOf(closed), verified: closes === of,
        ...(remain.length ? { remainVia: remain } : {}),
      }
    }
    const onPath = new Set(t.path.hops.map(hopKey))
    // 다 닫는 것, 많이 닫는 것, 경로 그림에 있는 것, 키 순
    const rank = (a: [string, Set<string>], b: [string, Set<string>]) =>
      b[1].size - a[1].size || Number(onPath.has(b[0])) - Number(onPath.has(a[0])) || (a[0] < b[0] ? -1 : 1)
    const sorted = [...single].sort(rank)
    const cuts = sorted.map(([k, c]) => cut([k], c))

    // 4. 하나로 다 안 닫히면 조합. 하나로 닫히는 사람이 아무도 없으면(모두 다른 길이 있음) 경로 그림의 간선을 먼저 끊어 보고 가장 많이 닫는 짝을 고른다
    let first: [string, Set<string>] | undefined = sorted[0]
    if (!first && revocable.length) {
      const entries = new Set(t.subjects.map(s => s.entry).filter(Boolean))
      const starts = revocable.filter(k => onPath.has(k) || (entries.has(hops.get(k)![0].kind) && hops.get(k)![0].to === t.point))
      let gain = 0
      for (const k of starts) {
        const best = [...closers(new Set(hops.get(k)!), revocable.filter(x => x !== k), persons)].sort(rank)[0]
        if (best && best[1].size > gain) { gain = best[1].size; first = [k, new Set()] }
      }
    }
    if (!cuts.some(c => c.verified) && first) {
      const head = first
      const chosen = [head[0]]
      let open = persons.filter(p => !head[1].has(p))
      while (open.length && chosen.length < MAX_WITH) {
        const base = new Set(chosen.flatMap(k => hops.get(k)!))
        const more = [...closers(base, revocable.filter(k => !chosen.includes(k)), open)].sort(rank)
        if (!more.length) break
        chosen.push(more[0][0])
        open = open.filter(p => !more[0][1].has(p))
      }
      if (chosen.length > 1) {
        const left = openAfter(new Set(chosen.flatMap(k => hops.get(k)!)), persons)
        // 조합은 모두 닫을 때만 낸다. 일부만 닫는 조합은 서로 상관없는 간선 묶음이 되기 쉬워 조치로 권하지 않는다
        if (!left.size) cuts.unshift(cut(chosen, new Set(persons)))
      }
    }
    t.cuts = cuts
  }
  // 같은 간선(조합)이 모두 닫는 다른 위협 수. 조치 하나로 함께 닫히는 위협을 보인다
  const sig = (c: ThreatCutV2) => [c.at, ...(c.with ?? []).map(w => w.at)].map(hopKey).sort().join('')
  const full = new Map<string, number>()
  for (const t of threats) for (const c of t.cuts ?? []) if (c.verified) full.set(sig(c), (full.get(sig(c)) ?? 0) + 1)
  for (const t of threats) for (const c of t.cuts ?? []) {
    const n = (full.get(sig(c)) ?? 0) - (c.verified ? 1 : 0)
    if (n > 0) c.alsoCloses = n
  }
}

/**
 * 추적성 상실: 고정 실행 신원으로 도는 자동화를 호출자 권한으로 돌리거나(실행 신원), 자원 안 자격증명을 빼면(자격증명의 범위) 그 신원의 추적성 상실이 사라지는지 다시 판정한다.
 * 실행 신원 간선이나 자격증명의 범위 간선이 설정으로 회수 가능할 때만 낸다
 */
function traceCuts(comp: JudgeGraph, t: ThreatV2): ThreatCut[] {
  const id = t.point
  const still = (edges: JudgeEdge[]) => judge({ ...comp, edges }).trace.some(x => x.identity === id)
  const runAs = comp.edges.filter(e => e.kind === '실행 신원' && e.from === id && (e.mode ?? 'fixed') === 'fixed')
  if (runAs.length) {
    if (!runAs.every(e => e.revocable)) return []
    const closed = !still(comp.edges.map(e => (runAs.includes(e) ? { ...e, mode: 'caller' } : e)))
    return [{ at: { kind: '실행 신원', from: id, to: runAs[0].to }, action: 'caller-identity', closes: closed ? 1 : 0, of: 1, verified: closed }]
  }
  // 그 신원으로 인증하는 자격증명(또는 신원 자신이 자격증명)이 자원 안에 든 범위 간선
  const creds = new Set([id, ...comp.edges.filter(e => e.kind === '실행 신원' && e.to === id && comp.nodes[e.from]?.credential).map(e => e.from)])
  const held = comp.edges.filter(e => e.kind === '범위' && creds.has(e.from) && comp.nodes[e.from]?.credential && comp.nodes[e.to]?.kind === 'res')
  if (!held.length || !held.every(e => e.revocable)) return []
  const closed = !still(comp.edges.filter(e => !held.includes(e)))
  return [{ at: toHop(held[0]), action: 'remove-credential', ...(held.length > 1 ? { with: held.slice(1).map(e => ({ at: toHop(e), action: 'remove-credential' as const })) } : {}), closes: closed ? 1 : 0, of: 1, verified: closed }]
}
