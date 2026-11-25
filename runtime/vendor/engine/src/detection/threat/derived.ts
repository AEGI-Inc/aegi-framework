// 파생 접근: 사람이 자동화, 실행 신원, 자격증명, 데이터 흐름, 효과, 접속자 권한 차용을 거쳐 닿는 곳 (docs/spec/AEGI_THREAT_JUDGMENT_V2.md 4절)
//
// 사람마다 직접 권한에서 출발해 파생 간선을 따라 수준이 더 안 오를 때까지 편다. 대상마다 그 수준을 준 경로의 이유와 연동 지점을 남긴다.
// 표는 둘이다. 전체 표는 모름 경로까지 따른 수준, 확정 표는 모름 사유가 하나도 없는 경로만 따른 수준.
// 모름은 아래로 번진다: 단계에 들어가는 조건이 확정 표에서 서지 않으면 그 조건을 준 경로의 모름 사유를 단계 결과에 붙인다(2026-11-16 결정).
// 판정(judge.ts)이 두 표로 유형을 붙이고(확정 표로 서는 유형은 확정), 추적성 상실이 호출자와 실행 신원 권한을 다시 쓴다.
// 경로: 대상마다 그 수준을 준 마지막 단계(Step)를 이유 묶음에 붙여 둔다. 판정이 경로를 물으면 반복이 끝난 표에서 앞 단계를 이어 붙인다(lead).
//
// 연산량(#405): 파생 간선이 걸린 노드(호출 출발, 자동화, 자격증명을 담은 자원, 데이터 흐름 도착, 효과 출발)만 작업 목록으로 본다.
// 노드는 처음 닿을 때, 수준이나 이유가 바뀔 때, 그 사람이 호출하게 될 때, 데이터 흐름으로 읽게 될 때만 다시 본다.
// 호출 조건은 그 사람의 수준과 소속만 보므로 한 사람은 한 번에 끝난다. 다른 사람이 필요한 것은 접속자 권한 차용뿐이라,
// 빌린 수준을 넣은 사람만 작업 목록을 다시 돈다.
// 실행 신원 권한은 사람과 상관없어 간선마다 한 번 센다. 같은 이유 묶음은 판정 한 번 안에서 한 벌을 같이 쓴다
import type { Hop, Index, JudgeEdge, JudgeGraph } from './judge'
import { L, Z, eq, get, mn, mx, type Acc, type AccMap } from './access'

export const CALLERS_UNKNOWN = '호출자 모름'
export const RESULT_UNKNOWN = '결과 반환 모름'
export const CAP_UNKNOWN = '능력 범위 모름'
export const ID_LEVEL_UNKNOWN = '실행 신원 수준 모름'
/** 실행 신원 사슬이 약한 자동화 연결, 같은 범위로만 이은 자격증명 사용 같은 불확실 간선으로만 이어짐(판정 그래프 chainUnsure) */
export const CHAIN_UNSURE = '실행 신원 연결 추정'
export const POST_ONLY = '게시 전용'
/** 모름 사유. 경로 안에 하나라도 있으면 그 경로는 미확정. 실행 기록 없음, 게시 전용은 확정으로 둔다 */
const UNSURE = new Set([CALLERS_UNKNOWN, RESULT_UNKNOWN, CAP_UNKNOWN, ID_LEVEL_UNKNOWN, CHAIN_UNSURE])
/** 받은 권한이 읽기 없는 쓰기(게시)뿐이면 게시 전용 표시. 같은 신원의 게시와 읽기가 따로 있으면 수준이 쓰기와 같아 표시하지 않는다 */
const isPost = (l: Acc) => l[0] === 0 && l[1] === 2
/** 이 사유가 붙은 판정은 미확정 */
export const unsure = (f: Iterable<string>) => { for (const x of f) if (UNSURE.has(x)) return true; return false }

export const isFixed = (e: JudgeEdge) => (e.mode ?? 'fixed') === 'fixed'

/** 대상마다 판정 이유와 연동 지점(@키). r 은 읽기, w 는 쓰기 이상을 준 경로 */
export interface FlagMaps { r: Map<string, Set<string>>; w: Map<string, Set<string>> }

/**
 * 파생 단계 하나. 대상에 그 수준을 준 마지막 단계다. 판정 이유 묶음에 붙어 다니고, 반복이 끝난 뒤 경로 복원(lead)이 앞 단계를 이어 붙인다.
 * point: 연동 지점. at: 사람이 서야 하는 객체(데이터 흐름은 사본 쪽, 그 밖은 연동 지점).
 * need: at 에 서는 조건. call 은 at 자동화를 부름, flow 는 at 을 데이터 흐름으로 읽음, 그 밖은 at 의 차원 d 가 lim 이상
 */
export interface Step {
  kind: '실행 신원' | '자동화 편집' | '자격 보관' | '데이터 흐름' | '효과' | '접속자 권한 차용'
  point: string
  at: string
  need: 'call' | 'flow' | { d: 0 | 1; lim: number }
  /** 실행 신원 간선(실행 신원, 자동화 편집), 데이터 흐름 간선, 효과 간선 */
  edge?: JudgeEdge
  /** 실행 신원, 자동화 편집, 자격 보관이 대상에 닿는 신원 */
  identity?: string
  /** 자격 보관의 자격증명 */
  cred?: string
  /** 같은 수준, 같은 이유 묶음에서 단계를 가르는 키. 작은 키가 남는다 */
  id: string
}

const NONE: readonly string[] = Object.freeze([])
/** 모름 사유 묶음. 겹침을 없애고 정렬해 같은 묶음은 같은 모양. 빈 묶음은 하나를 같이 쓴다 */
function reasons(...parts: (readonly string[] | undefined)[]): readonly string[] {
  let out: Set<string> | undefined
  for (const p of parts) if (p?.length) for (const x of p) (out ??= new Set()).add(x)
  return out ? [...out].sort() : NONE
}
const CHAIN: readonly string[] = Object.freeze([CHAIN_UNSURE])
/** 실행 신원 간선의 사슬 모름. 그 간선을 거쳐 얻은 접근은 경로 종류(호출, 자동화 편집, 자격 보관, 데이터 흐름, 차용)와 상관없이 미확정 */
const chainWhy = (r: JudgeEdge): readonly string[] => (r.chainUnsure?.length ? CHAIN : NONE)
/**
 * 모름 사유 묶음의 순서. 빈 묶음(확정)이 가장 앞, 사유가 적은 쪽, 같은 수면 이름 순.
 * 사유를 더 붙인 묶음은 늘 뒤로 가서, 모름 경로가 먼저 퍼져도 나중에 온 덜 모르는 경로가 이긴다
 */
const reasonCmp = (a: readonly string[], b: readonly string[]): number => {
  if (a.length !== b.length) return a.length - b.length
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}
const better = (a: readonly string[], b: readonly string[] | undefined) => !b || reasonCmp(a, b) < 0

/** 이유 묶음의 비교 값. uns: 묶음 안의 모름 사유. step: 이 묶음으로 수준을 준 단계 */
interface FlagMeta { unsure: boolean; post: boolean; point: string; key: string; uns: readonly string[]; step?: Step }
const metaOf = new WeakMap<Set<string>, FlagMeta>()
/** 묶음 안의 모름 사유. 이 모듈이 만든 묶음이 아니면 직접 고른다 */
const unsureIn = (f: Set<string> | undefined): readonly string[] => (f ? metaOf.get(f)?.uns ?? reasons([...f].filter(x => UNSURE.has(x))) : NONE)
/** 묶음 안의 모름 사유(이름 순) */
export const unsureReasons = (f: Set<string> | undefined): string[] => [...unsureIn(f)]
/** 그 이유 묶음으로 수준을 준 단계. 이 모듈이 만든 묶음만 안다 */
export const stepOf = (f: Set<string> | undefined): Step | undefined => (f ? metaOf.get(f)?.step : undefined)

/**
 * 이유, 연동 지점, 단계로 묶음을 찾거나 만든다. 판정 한 번마다 하나.
 * 묶음은 여러 사람, 여러 대상이 같이 쓰므로 읽기만 한다(판정은 새 Set 을 만들어 이유를 더한다).
 * 이유 이름이 같아도 단계(실행 신원 간선, 자격증명)가 다르면 다른 묶음이다. 같은 수준이면 키가 작은 단계가 남아 계산 차례와 상관없다
 */
type FlagSets = (flags: readonly string[], point: string, step?: Step) => Set<string>
function flagSets(): FlagSets {
  const interned = new Map<string, Set<string>>()
  return (flags, point, step) => {
    const key = `${[...flags].sort().join('\u0001')}\u0002${point}\u0003${step?.id ?? ''}`
    let s = interned.get(key)
    if (!s) {
      s = new Set([...flags, `@${point}`])
      const uns = reasons(flags.filter(x => UNSURE.has(x)))
      metaOf.set(s, { unsure: uns.length > 0, post: flags.includes(POST_ONLY), point, key, uns, ...(step ? { step } : {}) })
      interned.set(key, s)
    }
    return s
  }
}

/**
 * 한 수준(읽기 또는 쓰기)의 이유를 고친다. 더 높은 수준을 준 경로가 이긴다.
 * 같은 수준이면 확인된 쪽, 모름 사유가 덜한 쪽(reasonCmp), 게시 전용이 아닌 쪽(읽기도 되는 쓰기), 연동 지점이 작은 쪽, 이유 이름이 작은 쪽 순으로 남긴다.
 * 이 순서가 전부를 가르므로 경로를 어떤 차례로 보든 확정 여부가 같다. 바뀌었으면 true
 */
function setFlags(m: Map<string, Set<string>>, t: string, old: number, lv: number, next: Set<string>, nm: FlagMeta): boolean {
  if (lv <= 0 || lv < old) return false
  const cur = m.get(t)
  if (lv > old || !cur) { m.set(t, next); return cur !== next }
  if (cur === next) return false
  const win = winsMeta(metaOf.get(cur)!, nm)
  if (win) m.set(t, next)
  return win
}
/** 같은 수준에서 새 이유가 지금 이유를 이기는가(setFlags 순서). a: 지금 이유의 비교 값, b: 새 이유의 비교 값 */
function winsMeta(a: FlagMeta, b: FlagMeta): boolean {
  const c = reasonCmp(b.uns, a.uns)
  if (a.unsure !== b.unsure) return a.unsure
  if (c !== 0) return c < 0
  if (a.post !== b.post) return a.post
  if (b.point !== a.point) return b.point < a.point
  return b.key < a.key
}
/** 대상 하나의 전체 표 칸(수준과 읽기, 쓰기 이유) */
export interface FullCell { v0: number; v1: number; r?: Set<string>; w?: Set<string> }
/** 접는 동안 이유의 비교 값을 같이 쥔다 */
interface FoldCell extends FullCell { rm?: FlagMeta; wm?: FlagMeta }
/** putInto 의 전체 표 쪽과 같은 규칙으로 접는다. m: flags 의 비교 값 */
function foldFull(c: FoldCell, l0: number, l1: number, flags: Set<string>, m: FlagMeta) {
  if (l0 > 0 && l0 >= c.v0 && (l0 > c.v0 || !c.r || (c.r !== flags && winsMeta(c.rm!, m)))) { c.r = flags; c.rm = m }
  if (l1 > 0 && l1 >= c.v1 && (l1 > c.v1 || !c.w || (c.w !== flags && winsMeta(c.wm!, m)))) { c.w = flags; c.wm = m }
  if (l0 > c.v0) c.v0 = l0
  if (l1 > c.v1) c.v1 = l1
}

/** 사람 한 명의 표. dv, fl: 전체(모름 경로 포함), dvs, fls: 확정 경로만 */
export interface Tables { dv: AccMap; dvs: AccMap; fl: FlagMaps; fls: FlagMaps }
const newTables = (): Tables => ({ dv: new Map(), dvs: new Map(), fl: { r: new Map(), w: new Map() }, fls: { r: new Map(), w: new Map() } })

/**
 * 수준과 이유 하나를 표에 넣는다. 수준은 높은 쪽, 같은 수준의 이유는 setFlags 순서로 남겨 넣는 차례와 상관없이 결과가 같다.
 * rose: 전체 표(sure 면 확정 표)의 수준이 old 에서 올랐을 때. 바뀌었으면 true(확정 표 이유만 바뀐 것은 셈하지 않는다)
 */
function putInto(tb: Tables, t: string, l: Acc, flags: Set<string>, rose?: (t: string, old: Acc, l: Acc, meta: FlagMeta, sure: boolean) => void): boolean {
  let chg = false
  const meta = metaOf.get(flags)!
  const old = tb.dv.get(t) ?? Z
  if (l[0] > 0 && l[0] >= old[0] && setFlags(tb.fl.r, t, old[0], l[0], flags, meta)) chg = true
  if (l[1] > 0 && l[1] >= old[1] && setFlags(tb.fl.w, t, old[1], l[1], flags, meta)) chg = true
  if (l[0] > old[0] || l[1] > old[1]) {
    tb.dv.set(t, [Math.max(old[0], l[0]), Math.max(old[1], l[1])])
    rose?.(t, old, l, meta, false)
    chg = true
  }
  if (!meta.unsure) {
    const olds = tb.dvs.get(t) ?? Z
    if (l[0] > 0 && l[0] >= olds[0]) setFlags(tb.fls.r, t, olds[0], l[0], flags, meta)
    if (l[1] > 0 && l[1] >= olds[1]) setFlags(tb.fls.w, t, olds[1], l[1], flags, meta)
    if (l[0] > olds[0] || l[1] > olds[1]) {
      tb.dvs.set(t, [Math.max(olds[0], l[0]), Math.max(olds[1], l[1])])
      rose?.(t, olds, l, meta, true)
      chg = true
    }
  }
  return chg
}

/** 묶음이 넣는 수준은 읽기 0~1, 쓰기 0~3 이라 같은 값은 한 배열을 같이 쓴다(수준 배열은 고치지 않고 새로 만든다) */
const ACC: Acc[][] = [0, 1, 2, 3].map(a => [0, 1, 2, 3].map(b => [a, b] as Acc))
const acc = (a: number, b: number): Acc => ACC[a]?.[b] ?? [a, b]

/**
 * 실행 신원 권한 표 하나를 같은 이유로 넣은 것(묶음). 사람마다 대상마다 넣지 않고 표 참조로 쥔다(2026-11-18, #443 설계 2b).
 * writeOnly: 쓰기 차원만(호출로 얻는 실행 신원 권한). mp: fp 의 비교 값(접을 때 다시 찾지 않게)
 */
interface GrantBundle { gr: AccMap; fp: { plain: Set<string>; post: Set<string> }; writeOnly: boolean; mp: { plain: FlagMeta; post: FlagMeta } }
/** 묶음이 대상 하나에 넣는 수준과 이유. 넣지 않으면 undefined */
type Put = [Acc, Set<string>]
const contribution = (b: GrantBundle, l: Acc): Put | undefined =>
  b.writeOnly ? (l[1] ? [l[0] ? acc(0, l[1]) : l, isPost(l) ? b.fp.post : b.fp.plain] : undefined) : [l, isPost(l) ? b.fp.post : b.fp.plain]

/** 빌려 줄 수준의 대상 한 칸: 읽기, 쓰기 차원별로 가장 높은 수준, 그 수준을 준 호출자(하나뿐일 때만 뜻이 있다), 그 수준을 준 호출자 수, 그다음 수준 */
type Top = { b1: number; who: string; n: number; b2: number }
/** 빌려 줄 수준 표를 그때 호출자 그대로 굳힌 것. 같은 때 받은 사람끼리 같이 쓴다. live: 그 가운데 live 대상 */
interface LendSnap { top: Map<string, [Top, Top]>; live: [string, [Top, Top]][] }
/** 접속자 권한 차용 한 번(묶음). 받는 사람 p 는 자기 몫을 뺀 수준을 같은 이유로 받는다. meta: flags 의 비교 값 */
interface LendBundle { snap: LendSnap; p: string; flags: Set<string>; meta: FlagMeta }
const lendAt = (b: LendBundle, tt: [Top, Top]): Put | undefined => {
  const r = tt[0].who === b.p && tt[0].n === 1 ? tt[0].b2 : tt[0].b1
  const w = tt[1].who === b.p && tt[1].n === 1 ? tt[1].b2 : tt[1].b1
  return r || w ? [acc(r, w), b.flags] : undefined
}
type TableRef = GrantBundle | LendBundle
/** 묶음이 대상 t 에 넣는 것 */
const refAt = (b: TableRef, t: string): Put | undefined => {
  if ('gr' in b) { const l = b.gr.get(t); return l && contribution(b, l) }
  const tt = b.snap.top.get(t)
  return tt && lendAt(b, tt)
}
/** 묶음이 넣는 것을 넣던 차례대로(contribution, lendAt 과 같다). 넣지 않는 대상은 건너뛴다 */
function eachPut(b: TableRef, f: (t: string, l: Acc, flags: Set<string>) => void) {
  if ('gr' in b) {
    for (const [t, l] of b.gr) {
      const flags = isPost(l) ? b.fp.post : b.fp.plain
      if (!b.writeOnly) f(t, l, flags)
      else if (l[1]) f(t, l[0] ? acc(0, l[1]) : l, flags)
    }
  } else {
    for (const [t, tt] of b.snap.top) {
      const r = tt[0].who === b.p && tt[0].n === 1 ? tt[0].b2 : tt[0].b1
      const w = tt[1].who === b.p && tt[1].n === 1 ? tt[1].b2 : tt[1].b1
      if (r || w) f(t, acc(r, w), b.flags)
    }
  }
}

export interface DerivedInput {
  g: JudgeGraph
  ix: Index
  /** 파생 접근을 계산할 사람 */
  PJ: string[]
  autos: string[]
  accountsOf(p: string): string[]
  isMember(p: string, k: string): boolean
  /** 누구나 공유를 뺀 직접 권한(확정 근거만). 차단 지점 확인은 물을 때 센다 */
  Dself: Pick<ReadonlyMap<string, AccMap>, 'get'>
  /** 접속자 권한으로 도는 자동화마다 앞선 전체 판정의 호출자(judge opts.callers) */
  callers?: Map<string, Set<string>>
}

export interface Derived {
  /**
   * 사람 한 명의 네 표 전체: 파생 수준과 대상의 판정 이유, 연동 지점(dv, fl 은 모름 경로 포함, dvs, fls 는 확정 경로만).
   * 대상을 도는 차례는 처음 들어간 차례. 물을 때 묶음을 합친다(마지막 한 사람만 남긴다). 파생을 계산하지 않은 사람은 undefined
   */
  tables(p: string): Tables | undefined
  /** 사람 p 의 대상 t 하나의 네 표(그 대상 칸만 뜻이 있다). 파생을 계산하지 않은 사람은 undefined. 다음 부르기 전까지 쓴다 */
  cellOf(p: string, t: string): Tables | undefined
  /** 대상 t 의 사람마다 파생 수준(모름 경로 포함). 파생을 계산하지 않았거나 수준이 없으면 undefined */
  dvAt(t: string): (p: string) => Acc | undefined
  /** 대상 t 하나의 사람마다 파생 수준(모름 경로 포함, v0 읽기, v1 쓰기)과 읽기, 쓰기 판정 이유. 수준이 없으면 undefined. 돌려준 칸은 다음 부르기 전까지만 쓴다 */
  column(t: string): (p: string) => Readonly<FullCell> | undefined
  /** 자동화마다 호출하는 사람 */
  inv: Map<string, Set<string>>
  /** 실행 신원 간선이 주는 수준. capped 면 동작 범위로 자르고, 범위를 모르면 표시. scope 가 있으면 그 대상만 */
  idgrant(r: JudgeEdge, capped: boolean, scope?: string[]): [AccMap, string[]]
  /**
   * 사람 p 가 단계 s 의 서는 자리(s.at)까지 간 간선. 사람 계정에서 시작하고 마지막 간선이 그 자리에 닿는다.
   * sure 면 확정 경로만 따른다. 앞 단계가 고리로 돌아오면 그 자리에서 사람 계정의 권한 간선으로 끊는다
   */
  lead(p: string, s: Step, sure: boolean): Hop[]
  /** lead 와 같은 길의 단계와 첫 자리(심각도 가능성 신호) */
  chain(p: string, s: Step, sure: boolean): Chain
  /** 단계 s 가 연동 지점에서 대상 t 까지 가는 간선 */
  stepHops(s: Step, t: string): Hop[]
}

/**
 * 사람이 자기 권한으로 처음 서는 자리(lead 의 시작). 심각도 가능성 요소 규모, 기회가 이 자리로 정해진다(명세 「심각도」).
 * level: at 에 차원 d 가 lim 이상인 직접 권한으로 선다. call: at(사람 계정, 소속 주체, 직접 권한이 닿는 객체)에서 자동화를 부른다.
 * cut: 자취가 없거나 고리라 사람 계정의 권한 간선으로 끊은 자리(생기지 않아야 한다). to: call 만, 부르는 자동화
 */
export interface Opening { how: 'level' | 'call' | 'cut'; at: string; d: 0 | 1; lim: number; to?: string }
/**
 * lead 를 이은 단계. steps: 판정 행의 단계부터 사람이 처음 서는 자리까지 거꾸로(첫 칸이 판정 행의 단계).
 * relayed: 자동화를 부른 것이 사람이 아니라 다른 자동화이거나, 사람이 파생으로 선 자리(그 자리에 선 신원)인 단계(호출자 기록이 그 사람을 남기지 않는다)
 */
export interface Chain { steps: Step[]; open: Opening; relayed: ReadonlySet<Step> }

/**
 * 신원 권한을 확정 수준과 그보다 높은 모름 수준으로 가른 것. other 는 신원과 다른 SaaS 의 주체가 받은 권한으로만 닿는 대상이다(Index.foreignOnly).
 * 자동화, 보관된 자격증명은 그 신원의 토큰으로 동작하는데, 토큰 범위 표(capabilities.yaml token_scopes)는 신원의 SaaS API 범위만 적는다.
 * 다른 SaaS 그룹에 소속돼 생긴 권한을 그 토큰으로 쓸 수 있는지는 표에 없어 모른다(principles.unknown_without_table). 동작 범위(cap)가 그 대상을 적었으면 그대로 본다
 */
interface Split { sure: AccMap; more: AccMap; other: AccMap }

/**
 * 사람이 자동화를 부르게 된 호출 자리. from 은 호출 간선 출발.
 * mem: 출발이 사람 계정이나 그 소속. call: 출발이 사람이 부르는 자동화. level: 출발에 차원 d 가 lim 이상
 */
interface CallVia { from: string; how: 'mem' | 'call' | 'level'; d: 0 | 1; lim: number }

/**
 * 경로 복원용 자취. 사람마다, 파생 간선이 걸린 노드(live)만.
 * 노드마다 그 조건(읽기, 쓰기, 관리)을 처음 세운 단계, 자동화를 처음 부르게 된 호출 자리, 데이터 흐름으로 처음 읽게 된 단계를 남긴다.
 * 처음 세운 것은 그때 이미 앞 조건이 서 있었으므로 앞 단계를 따라가면 시간이 거꾸로만 가서 고리가 없다.
 * 판정 이유는 같은 수준에서 더 나은 경로로 바뀌므로(setFlags) 이유를 준 단계를 따라가면 서로를 가리키는 고리가 생길 수 있다.
 * sure 쪽은 모름 사유 없이 처음 선 것(확정 경로)
 */
interface Trail {
  /** 읽기 1, 쓰기 2, 관리 3 을 처음 세운 단계 */
  level: [Map<string, Step>, Map<string, Step>, Map<string, Step>]
  levelSure: [Map<string, Step>, Map<string, Step>, Map<string, Step>]
  call: Map<string, CallVia>
  callSure: Map<string, CallVia>
  flow: Map<string, Step>
  flowSure: Map<string, Step>
  /** 복원한 lead 와 단계. 같은 사람의 같은 단계는 판정 행이 여럿이어도 한 벌을 같이 쓴다(읽기만 한다) */
  leads: Map<string, { hops: Hop[]; chain: Chain }>
}
/** 조건(차원, 수준)의 자취 칸 */
const slot = (d: 0 | 1, lim: number) => (d === 0 ? 0 : lim >= 3 ? 2 : 1)
/** 그 자리에 필요한 수준(Hop.need) */
const needOf = (d: 0 | 1, lim: number): NonNullable<Hop['need']> => (d === 0 ? 'r' : lim >= 3 ? 'a' : 'w')

export function derivedAccess(input: DerivedInput): Derived {
  const { g, ix, PJ, autos, isMember, accountsOf, Dself } = input
  const node = (k: string) => g.nodes[k]
  const inv = new Map<string, Set<string>>(autos.map(a => [a, new Set()]))
  /** 사람마다 경로 복원용 자취 */
  const TRAIL = new Map<string, Trail>()
  const fs = flagSets()
  /** 게시 전용 표시가 붙은 묶음과 안 붙은 묶음. 안쪽 반복에서 수준에 따라 고른다 */
  const pair = (base: readonly string[], point: string, step: Step) => ({ plain: fs(base, point, step), post: fs([...base, POST_ONLY], point, step) })
  /** 단계는 간선마다 하나. 사람과 상관없어 같이 쓴다 */
  const steps = new Map<string, Step>()
  const stepFor = (s: Omit<Step, 'id'>): Step => {
    const need = typeof s.need === 'string' ? s.need : `${s.need.d}:${s.need.lim}`
    const id = [s.kind, s.point, s.at, need, s.edge ? `${s.edge.kind}\u0001${s.edge.from}\u0001${s.edge.to}\u0001${s.edge.via ?? ''}` : '', s.identity ?? '', s.cred ?? ''].join('\u0002')
    let st = steps.get(id)
    if (!st) steps.set(id, (st = { ...s, id }))
    return st
  }

  // 실행 신원 간선이 주는 수준. 사람과 상관없어 간선과 범위마다 한 번만 센다
  const scopeSets = new Map<string[], Set<string>>()
  const within = (gr: AccMap, scope?: string[]): AccMap => {
    if (!scope) return gr
    let s = scopeSets.get(scope)
    if (!s) scopeSets.set(scope, (s = new Set(scope)))
    const out: AccMap = new Map()
    for (const [t, l] of gr) if (s.has(t)) out.set(t, l)
    return out
  }
  const grantMemo = new Map<JudgeEdge, Map<string, [AccMap, string[]]>>()
  const idgrant = (r: JudgeEdge, capped: boolean, scope?: string[]): [AccMap, string[]] => {
    const sk = scope === undefined ? 'n' : scope === r.callerScope ? 'c' : scope === r.editScope ? 'e' : ''
    const mk = `${capped ? 1 : 0}${sk}`
    const memo = sk ? grantMemo.get(r)?.get(mk) : undefined
    if (memo) return memo
    const gr = within(ix.identityGrant(r.to), scope)
    let res: [AccMap, string[]]
    if (capped && r.cap) {
      const out: AccMap = new Map()
      for (const [t, l] of gr) if (t in r.cap) out.set(t, mn(l, L[r.cap[t]]))
      res = [out, []]
    } else res = [gr, capped ? [CAP_UNKNOWN] : []]
    if (sk) {
      let m = grantMemo.get(r)
      if (!m) grantMemo.set(r, (m = new Map()))
      m.set(mk, res)
    }
    return res
  }
  /**
   * 신원 권한 표를 가른다. 확정: 신원의 확정 직접 권한(수준을 알고 불확실 근거가 없는 권한)으로 닿는 수준, 동작 범위가 있으면 그만큼.
   * 전체 표가 더 높은 대상은 모름 표에 전체 수준으로 둔다(실행 신원 수준 모름). 같은 표는 한 번만 가른다
   */
  const splitMemo = new Map<AccMap, Split>()
  const split = (gr: AccMap, identity: string, cap?: Record<string, string>): Split => {
    let r = splitMemo.get(gr)
    if (r) return r
    const sureD = ix.direct(identity).sure
    const sure: AccMap = new Map()
    const more: AccMap = new Map()
    const other: AccMap = new Map()
    const foreign = ix.foreignOnly(identity)
    for (const [t, l] of gr) {
      if (foreign.has(t) && !(cap && t in cap)) { other.set(t, l); continue }
      let ls = mn(get(sureD, t), l)
      if (cap) ls = t in cap ? mn(ls, L[cap[t] as keyof typeof L]) : Z
      if (ls[0] || ls[1]) sure.set(t, ls)
      if (ls[0] < l[0] || ls[1] < l[1]) more.set(t, l)
    }
    splitMemo.set(gr, (r = { sure, more, other }))
    return r
  }
  /** 실행 신원 간선 권한을 가른 것과 그 간선의 표시(능력 범위 모름) */
  const idsplit = (r: JudgeEdge, capped: boolean, scope?: string[]): Split & { f: string[] } => {
    const [gr, f] = idgrant(r, capped, scope)
    return { ...split(gr, r.to, capped ? r.cap : undefined), f }
  }
  /** 데이터 흐름을 옮기는 자동화의 고정 실행 신원이 원본을 읽는가. 확정 권한으로 읽으면 sure. 사람과 상관없다 */
  const viaMemo = new Map<JudgeEdge, { ok: boolean; why: readonly string[] }>()
  const viaReads = (e: JudgeEdge): { ok: boolean; why: readonly string[] } => {
    if (!e.via) return { ok: true, why: NONE }
    let v = viaMemo.get(e)
    if (!v) {
      const fx = ix.outOf('실행 신원', e.via).filter(isFixed)
      // 원본을 읽는 신원 가운데 모름 사유가 가장 덜한 것. 신원 수준이 확정이 아니면 실행 신원 수준 모름, 사슬이 약하면 실행 신원 연결 추정
      let why: readonly string[] | undefined
      for (const r of fx) {
        if (get(idgrant(r, false)[0], e.from)[0] < 1) continue
        const rs = reasons(chainWhy(r), get(ix.direct(r.to).sure, e.from)[0] >= 1 ? NONE : [ID_LEVEL_UNKNOWN])
        if (better(rs, why)) why = rs
      }
      v = { ok: why !== undefined, why: why ?? NONE }
      viaMemo.set(e, v)
    }
    return v
  }

  // 파생 간선이 걸린 노드. 여기서 나가는(데이터 흐름은 들어오는) 간선만 사람의 수준에 따라 결과가 달라진다
  const live = new Set<string>(autos)
  for (const e of ix.of('호출')) live.add(e.from)
  for (const e of ix.of('효과')) live.add(e.from)
  for (const e of ix.of('데이터 흐름')) live.add(e.to)
  for (const e of ix.of('범위')) if (ix.credentialsIn(e.to).length) live.add(e.to)
  /** 표에서 live 대상만. 표는 사람끼리 같이 쓰므로 표마다 한 번 고른다 */
  const liveMemo = new Map<AccMap, [string, Acc][]>()
  const liveOf = (gr: AccMap): [string, Acc][] => {
    let r = liveMemo.get(gr)
    if (!r) {
      r = []
      for (const e of gr) if (live.has(e[0])) r.push(e)
      liveMemo.set(gr, r)
    }
    return r
  }

  /** 사람마다 바로 넣은 표, 처음 들어간 차례, 묶음 */
  interface Held { tb: Tables; events: (string | TableRef)[]; bundles: TableRef[] }
  const STATE = new Map<string, Held>()
  /** 사람마다 바로 넣은 전체 수준 표(STATE 의 tb.dv). live 대상은 이것이 전체다 */
  const IMM = new Map<string, AccMap>()
  /**
   * 사람 한 명의 네 표 전체. 처음 들어간 차례대로 대상을 세우고, 바로 넣은 값 위에 묶음을 접는다.
   * 접는 차례가 달라도 수준은 최대, 이유는 setFlags 순서라 한 번에 넣은 것과 같다. live 대상은 이미 바로 넣었다
   */
  let lastTables: [string, Tables] | undefined
  const tables = (p: string): Tables | undefined => {
    if (lastTables?.[0] === p) return lastTables[1]
    const s = STATE.get(p)
    if (!s) return undefined
    let out = s.tb
    if (s.bundles.length) {
      out = newTables()
      for (const ev of s.events) {
        if (typeof ev === 'string') { if (!out.dv.has(ev)) out.dv.set(ev, Z) } else eachPut(ev, (t, l) => { if ((l[0] > 0 || l[1] > 0) && !out.dv.has(t)) out.dv.set(t, Z) })
      }
      for (const [t, l] of s.tb.dv) out.dv.set(t, l)
      for (const [t, l] of s.tb.dvs) out.dvs.set(t, l)
      for (const [t, f] of s.tb.fl.r) out.fl.r.set(t, f)
      for (const [t, f] of s.tb.fl.w) out.fl.w.set(t, f)
      for (const [t, f] of s.tb.fls.r) out.fls.r.set(t, f)
      for (const [t, f] of s.tb.fls.w) out.fls.w.set(t, f)
      for (const b of s.bundles) eachPut(b, (t, l, f) => { if (!live.has(t)) putInto(out, t, l, f) })
    }
    lastTables = [p, out]
    return out
  }
  /** 사람 한 명, 대상 하나의 네 표. 그 대상을 가진 묶음만 접는다(마지막 하나만 남긴다) */
  let lastCell: { p: string; t: string; tb: Tables } | undefined
  const cell = (p: string, t: string): Tables => {
    if (lastTables?.[0] === p) return lastTables[1]
    const s = STATE.get(p)!
    if (live.has(t) || !s.bundles.length) return s.tb
    if (lastCell?.p === p && lastCell.t === t) return lastCell.tb
    const tb = newTables()
    const seed = <V>(from: Map<string, V>, to: Map<string, V>) => { const v = from.get(t); if (v !== undefined) to.set(t, v) }
    seed(s.tb.dv, tb.dv); seed(s.tb.dvs, tb.dvs)
    seed(s.tb.fl.r, tb.fl.r); seed(s.tb.fl.w, tb.fl.w); seed(s.tb.fls.r, tb.fls.r); seed(s.tb.fls.w, tb.fls.w)
    for (const b of s.bundles) {
      const c = refAt(b, t)
      if (c) putInto(tb, t, c[0], c[1])
    }
    lastCell = { p, t, tb }
    return tb
  }
  /**
   * 표마다 대상 역색인: 표마다 그 표를 쥔 사람과 묶음, 대상마다 그 대상을 가진 표. 판정 뒤 처음 대상 하나를 사람 전원에게 물을 때 만든다.
   * 표는 사람끼리 같이 쓰므로 크기는 사람 수가 아니라 표 크기의 합이다
   */
  let holdersOf: Map<AccMap | LendSnap, [number, TableRef][]> | undefined
  let tablesWith: Map<string, (AccMap | LendSnap)[]> | undefined
  /** column 이 쓰는 사람 번호와 사람마다 칸. stamp 가 지금 차례(gen)인 칸만 이번 대상 것이다 */
  const pIdx = new Map<string, number>()
  const names: string[] = []
  const colCells: FoldCell[] = []
  let stamp = new Int32Array(0)
  let gen = 0
  let colT: string | undefined
  const scratch: FullCell = { v0: 0, v1: 0 }
  /**
   * 대상 t 의 사람마다 전체 표 칸(수준과 읽기, 쓰기 이유). 그 대상을 가진 표의 묶음만 접는다.
   * 수준이 없거나 파생을 계산하지 않은 사람은 undefined. 돌려준 칸은 다음 부르기 전까지만 쓴다(같은 칸을 다시 쓴다)
   */
  const column = (t: string): ((p: string) => Readonly<FullCell> | undefined) => {
    if (!holdersOf || !tablesWith) {
      holdersOf = new Map()
      tablesWith = new Map()
      for (const [p, s] of STATE) {
        const i = pIdx.size
        pIdx.set(p, i)
        names.push(p)
        colCells.push({ v0: 0, v1: 0 })
        for (const b of s.bundles) {
          const x = 'gr' in b ? b.gr : b.snap
          let a = holdersOf.get(x)
          if (!a) holdersOf.set(x, (a = []))
          a.push([i, b])
        }
      }
      stamp = new Int32Array(pIdx.size)
      for (const x of holdersOf.keys()) for (const k of x instanceof Map ? x.keys() : x.top.keys()) {
        let a = tablesWith.get(k)
        if (!a) tablesWith.set(k, (a = []))
        a.push(x)
      }
    }
    if (colT !== t) {
      colT = t
      gen++
      const at = (i: number): FoldCell => {
        const cl = colCells[i]
        if (stamp[i] !== gen) {
          stamp[i] = gen
          const tb = STATE.get(names[i])!.tb
          const v = tb.dv.get(t) ?? Z
          cl.v0 = v[0]; cl.v1 = v[1]; cl.r = tb.fl.r.get(t); cl.w = tb.fl.w.get(t)
          cl.rm = cl.r && metaOf.get(cl.r); cl.wm = cl.w && metaOf.get(cl.w)
        }
        return cl
      }
      // 묶음이 넣는 것은 contribution, lendAt 과 같다. 표의 대상 값은 표마다 한 번 꺼낸다
      if (!live.has(t)) for (const x of tablesWith.get(t) ?? []) {
        if (x instanceof Map) {
          const l = x.get(t)!
          const post = isPost(l)
          for (const [i, b] of holdersOf.get(x)!) {
            const g = b as GrantBundle
            const f = post ? g.fp.post : g.fp.plain
            const m = post ? g.mp.post : g.mp.plain
            if (!g.writeOnly) foldFull(at(i), l[0], l[1], f, m)
            else if (l[1]) foldFull(at(i), 0, l[1], f, m)
          }
        } else {
          const tt = x.top.get(t)!
          for (const [i, b] of holdersOf.get(x)!) {
            const lb = b as LendBundle
            const r = tt[0].who === lb.p && tt[0].n === 1 ? tt[0].b2 : tt[0].b1
            const w = tt[1].who === lb.p && tt[1].n === 1 ? tt[1].b2 : tt[1].b1
            if (r || w) foldFull(at(i), r, w, lb.flags, lb.meta)
          }
        }
      }
    }
    const g0 = gen
    return p => {
      const i = pIdx.get(p)
      if (i !== undefined && stamp[i] === g0) return colCells[i]
      const v = STATE.get(p)?.tb.dv.get(t)
      if (!v) return undefined
      const tb = STATE.get(p)!.tb
      scratch.v0 = v[0]; scratch.v1 = v[1]; scratch.r = tb.fl.r.get(t); scratch.w = tb.fl.w.get(t)
      return scratch
    }
  }
  const cellOf = (p: string, t: string): Tables | undefined => (STATE.has(p) ? cell(p, t) : undefined)
  /** 대상 t 의 사람마다 파생 수준(모름 경로 포함). 사람 전원에게 물을 때 대상 쪽 확인을 한 번만 한다 */
  const dvAt = (t: string): ((p: string) => Acc | undefined) =>
    live.has(t) ? p => IMM.get(p)?.get(t) : p => { const s = STATE.get(p); return s && (s.bundles.length ? cell(p, t) : s.tb).dv.get(t) }

  /**
   * 접속자 권한 차용 자동화마다 고칠 수 있는(쓰기 이상) 사람. 직접 권한과 파생 접근은 오르기만 하므로 더하기만 한다.
   * 차용 반복이 반복마다 자동화와 사람 전원을 짝지어 훑지 않게 둔다(#464). 열쇠는 차용 자동화를 모을 때 넣는다
   */
  const editors = new Map<string, Set<string>>()

  /** 한 사람의 파생 상태. 접속자 권한 차용이 수준을 더하면 그 사람의 작업 목록을 다시 돈다 */
  interface Person {
    dv: AccMap
    fl: FlagMaps
    /** 수준과 이유를 넣는다. 바뀌었으면 true, 그 노드를 작업 목록에 넣는다 */
    put(t: string, l: Acc, flags: Set<string>): boolean
    /** 빌린 수준 표를 같은 이유로 넣는다(묶음). live 대상이 바뀌었으면 true. 다른 대상은 반복에 쓰이지 않는다 */
    lend(snap: LendSnap, flags: Set<string>): boolean
    why(x: string, d: 0 | 1, need: number): readonly string[]
    /** 그 사람이 자동화 a 를 부르는 호출의 모름 사유. 부르지 않으면 undefined */
    callWhy(a: string): readonly string[] | undefined
    /** 작업 목록이 빌 때까지 편다 */
    run(): void
  }
  const person = (p: string): Person => {
    // 파생 접근은 자기 직접 권한에서 편다. 누구나 공유에서 시작하는 파생은 누구나 노드가 낸다(사람마다 같은 판정을 다시 내지 않게)
    const Dp = Dself.get(p)!
    const mem = ix.closure(accountsOf(p))
    // 바로 넣는 표: 파생 간선이 걸린 노드(live)와 하나씩 넣는 대상. 판정 이유와 연동 지점은 읽기와 쓰기 이상을 따로 둔다(두 수준이 다른 경로에서 오면 위협도 따로).
    // 실행 신원 권한 표와 빌린 수준 표는 묶음(GrantBundle, LendBundle)으로 쥐고 live 대상만 바로 넣는다. 전체는 판정이 물을 때 합친다(tables, cell, column)
    const tb = newTables()
    const { dv, dvs, fl } = tb
    /** 전체 표에 대상이 처음 들어간 차례: 하나씩 처음 넣은 대상(키)과 묶음. 판정이 대상을 도는 차례가 바뀌지 않게 남긴다 */
    const events: (string | TableRef)[] = []
    const bundles: TableRef[] = []
    /** 데이터 흐름으로 읽게 된 노드와 그 모름 사유. 자동화로 들어간 데이터를 볼 수 있는지 가를 때만 쓴다 */
    const flowRead = new Map<string, readonly string[]>()
    /** 그 사람이 부르는 자동화마다 호출의 모름 사유(호출자 모름, 호출하게 된 앞 단계의 모름). 빈 묶음이면 확정 */
    const callWhy = new Map<string, readonly string[]>()
    const trail: Trail = {
      level: [new Map(), new Map(), new Map()], levelSure: [new Map(), new Map(), new Map()],
      call: new Map(), callSure: new Map(), flow: new Map(), flowSure: new Map(), leads: new Map(),
    }
    TRAIL.set(p, trail)
    // 직접 권한으로 고칠 수 있는 차용 자동화. 둘 가운데 작은 쪽을 훑는다
    if (Dp.size < editors.size) { for (const [t, l] of Dp) if (l[1] >= 2) editors.get(t)?.add(p) }
    else for (const [a, who] of editors) if (get(Dp, a)[1] >= 2) who.add(p)
    /** 수준이 old 에서 l 로 오를 때 처음 넘은 조건마다 그 단계를 남긴다 */
    const mark = (to: [Map<string, Step>, Map<string, Step>, Map<string, Step>], t: string, old: Acc, l: Acc, st: Step) => {
      if (old[0] < 1 && l[0] >= 1) to[0].set(t, st)
      if (old[1] < 2 && l[1] >= 2) to[1].set(t, st)
      if (old[1] < 3 && l[1] >= 3) to[2].set(t, st)
    }
    const E = (t: string) => mx(get(Dp, t), get(dv, t))
    const ES = (t: string) => mx(get(Dp, t), get(dvs, t))
    const invoked = (a: string) => !!inv.get(a)?.has(p)
    /** x 의 차원 d(0 읽기, 1 쓰기 이상)가 need 이상인 것이 확정이면 빈 묶음, 아니면 그 수준을 준 경로의 모름 사유 */
    const why = (x: string, d: 0 | 1, need: number): readonly string[] => (ES(x)[d] >= need ? NONE : unsureIn((d ? fl.w : fl.r).get(x)))

    const queue: string[] = []
    const queued = new Set<string>()
    const touch = (x: string) => {
      if (live.has(x) && !queued.has(x)) { queued.add(x); queue.push(x) }
    }
    /** 수준이 오르면 live 노드에만 자취를 남긴다 */
    const rose = (t: string, old: Acc, l: Acc, meta: FlagMeta, sure: boolean) => {
      // 전체 표에서 쓰기 이상이 되면 그 차용 자동화를 고칠 수 있는 사람이 된다
      if (!sure && old[1] < 2 && l[1] >= 2) editors.get(t)?.add(p)
      if (meta.step && live.has(t)) mark(sure ? trail.levelSure : trail.level, t, old, l, meta.step)
    }
    /** flags 는 이유와 연동 지점(파생 간선이 처음 시작되는 객체) 묶음. 모름 사유가 없으면 확정 표에도 넣는다. 바뀌었으면 true */
    const put = (t: string, l: Acc, flags: Set<string>): boolean => {
      const fresh = !dv.has(t)
      const chg = putInto(tb, t, l, flags, rose)
      if (fresh && dv.has(t)) events.push(t)
      if (chg) touch(t)
      return chg
    }
    /**
     * 수준 표 하나를 같은 이유로 넣는다. 같은 사람에게 같은 표, 같은 이유는 한 번만(다시 넣어도 결과가 같다).
     * writeOnly: 쓰기 차원만(호출로 얻는 실행 신원 권한)
     */
    const applied = new Map<AccMap, Set<Set<string>>>()
    const apply = (gr: AccMap, fp: { plain: Set<string>; post: Set<string> }, writeOnly: boolean) => {
      let done = applied.get(gr)
      if (!done) applied.set(gr, (done = new Set()))
      if (done.has(fp.plain)) return
      done.add(fp.plain)
      // 표 전체는 묶음으로 쥐고, 반복을 움직이는 live 대상만 표의 차례대로 바로 넣는다(live 가 아닌 대상은 반복에 쓰이지 않는다)
      const b: GrantBundle = { gr, fp, writeOnly, mp: { plain: metaOf.get(fp.plain)!, post: metaOf.get(fp.post)! } }
      events.push(b)
      bundles.push(b)
      for (const [t, l] of liveOf(gr)) {
        const c = contribution(b, l)
        if (c) put(t, c[0], c[1])
      }
    }
    const lend = (snap: LendSnap, flags: Set<string>): boolean => {
      const b: LendBundle = { snap, p, flags, meta: metaOf.get(flags)! }
      events.push(b)
      bundles.push(b)
      let chg = false
      for (const [t, tt] of snap.live) {
        const c = lendAt(b, tt)
        if (c && put(t, c[0], c[1])) chg = true
      }
      return chg
    }
    /** 신원 권한을 확정 수준과 모름 수준(실행 신원 수준 모름)으로 나눠 넣는다 */
    const applyId = (sp: Split, base: readonly string[], point: string, writeOnly: boolean, step: Step) => {
      apply(sp.sure, pair(base, point, step), writeOnly)
      if (sp.more.size) apply(sp.more, pair([...base, ID_LEVEL_UNKNOWN], point, step), writeOnly)
      if (sp.other.size) apply(sp.other, pair(base.includes(CAP_UNKNOWN) ? base : [...base, CAP_UNKNOWN], point, step), writeOnly)
    }
    const readByFlow = (x: string, rs: readonly string[], step: Step) => {
      if (!trail.flow.has(x)) trail.flow.set(x, step)
      if (!rs.length && !trail.flowSure.has(x)) trail.flowSure.set(x, step)
      if (!better(rs, flowRead.get(x))) return
      flowRead.set(x, rs)
      if (node(x)?.kind === 'auto') touch(x)
    }

    /** 노드 x 에서 나가는(데이터 흐름은 들어오는) 파생 간선을 지금 수준으로 다시 본다. 같은 노드를 여러 번 봐도 결과가 같다 */
    const visit = (x: string) => {
      const kind = node(x)?.kind
      const auto = kind === 'auto'
      for (const e of ix.outOf('호출', x)) {
        const need = L[e.need ?? 'write']
        const d = need[1] >= 2 ? 1 : 0
        const lim = d ? 2 : need[0]
        const byLevel = kind !== 'person' && kind !== 'group' && kind !== 'tenant' && E(x)[d] >= lim
        if (!mem.has(x) && !(auto && invoked(x)) && !byLevel) continue
        if (e.gate && !e.gate.some(k => isMember(p, k))) continue
        // 호출하게 된 길 가운데 가장 확실한 것의 모름 사유. 허용 호출자를 확인 못 했으면 호출자 모름을 더한다
        let pre: readonly string[] = NONE
        let how: CallVia['how'] = 'mem'
        if (!mem.has(x)) {
          const a = auto && invoked(x) ? callWhy.get(x) : undefined
          const b = byLevel ? why(x, d as 0 | 1, lim) : undefined
          if (a !== undefined && (b === undefined || better(a, b))) { pre = a; how = 'call' } else { pre = b!; how = 'level' }
        }
        const rs = e.uncertain?.length ? reasons(pre, [CALLERS_UNKNOWN]) : pre
        const callers = inv.get(e.to)
        if (callers && !callers.has(p)) callers.add(p)
        if (!trail.call.has(e.to)) trail.call.set(e.to, { from: x, how, d: d as 0 | 1, lim })
        if (!rs.length && !trail.callSure.has(e.to)) trail.callSure.set(e.to, { from: x, how, d: d as 0 | 1, lim })
        if (better(rs, callWhy.get(e.to))) { callWhy.set(e.to, rs); touch(e.to) }
      }
      if (auto) {
        if (invoked(x)) {
          const cw = callWhy.get(x) ?? NONE
          for (const r of ix.outOf('실행 신원', x)) {
            if (!isFixed(r)) continue
            const sp = idsplit(r, true, r.callerScope)
            // 실행 신원이 읽기 없이 게시만 하면(웹훅 게시, 폼 제출) 표시만 단다. 쓰기로 세는 것은 같다(규칙 5 게시 전용)
            applyId(sp, [...sp.f, ...cw, ...chainWhy(r), '실행 신원'], x, true, stepFor({ kind: '실행 신원', point: x, at: x, need: 'call', edge: r, identity: r.to }))
          }
        }
        const ex = E(x)[1]
        if (ex >= 2) {
          for (const r of ix.outOf('실행 신원', x)) {
            // 쓰기 이상이어야 고친다고 본다. 편집 수준이 읽기여도 서는 조건은 쓰기(경로가 서는 조건을 그대로 따른다)
            const lim = Math.max(2, L[r.editLevel ?? 'write'][1])
            if (!isFixed(r) || ex < lim) continue
            applyId(idsplit(r, false, r.editScope), ['자동화 편집', ...why(x, 1, lim), ...chainWhy(r)], x, false,
              stepFor({ kind: '자동화 편집', point: x, at: x, need: { d: 1, lim }, edge: r, identity: r.to }))
          }
        }
      }
      // 자원 안에 든 자격증명(범위 간선): 자원을 읽을 수 있으면 꺼내 그 신원으로 동작한다. 연동 지점은 자원
      if (E(x)[0] >= 1) {
        const creds = ix.credentialsIn(x)
        if (creds.length) {
          const base = ['자격 보관', ...why(x, 0, 1)]
          for (const c of creds) for (const id of ix.credentialIdentities(c)) {
            // 자격증명에서 그 신원까지 실행 신원 사슬이 약하면 꺼내 쓰는 접근도 미확정
            const via = ix.outOf('실행 신원', c).filter(r => r.to === id)
            const cu = via.length && via.every(r => r.chainUnsure?.length) ? CHAIN : NONE
            applyId(split(ix.identityGrant(id), id), [...base, ...cu], x, false, stepFor({ kind: '자격 보관', point: x, at: x, need: { d: 0, lim: 1 }, cred: c, identity: id }))
          }
        }
      }
      // 자동화로 들어간 데이터는 자동화가 내보내는 곳을 볼 수 있는 사람이 본다. 하류 데이터 흐름으로 얻은 읽기만 센다(자동화 설정을 읽는 것으로는 못 봄).
      // 내보내는 흐름이 없으면 결과를 호출자에게 돌려주는 것으로 보고 호출자가 본다.
      // 내보내는 흐름이 있는데 호출자가 그 끝을 못 보면, 결과를 호출자에게도 돌려주는지는 수집하지 않아 미확정
      for (const e of ix.inOf('데이터 흐름', x)) {
        const via = viaReads(e)
        if (!via.ok) continue
        const point = e.via ?? e.to
        const reads = auto ? flowRead.has(x) : E(x)[0] >= 1
        let rsRead: readonly string[] | undefined
        if (reads) {
          rsRead = reasons(via.why, auto ? flowRead.get(x) : why(x, 0, 1))
          const st = stepFor({ kind: '데이터 흐름', point, at: x, need: auto ? 'flow' : { d: 0, lim: 1 }, edge: e })
          readByFlow(e.from, rsRead, st)
          put(e.from, [1, 0], fs(['데이터 흐름', ...rsRead], point, st))
        }
        // 읽어서 보는 길이 모름이면 호출해서 돌려받는 길도 본다
        if (auto && invoked(x) && (!rsRead || rsRead.length)) {
          const returns = !ix.outOf('데이터 흐름', x).length
          const rs = reasons(via.why, callWhy.get(x), returns ? NONE : [RESULT_UNKNOWN])
          const st = stepFor({ kind: '데이터 흐름', point, at: x, need: 'call', edge: e })
          if (returns) readByFlow(e.from, rs, st)
          put(e.from, [1, 0], fs(['데이터 흐름', ...rs], point, st))
        }
      }
      for (const e of ix.outOf('효과', x)) {
        const l = L[e.level ?? 'write']
        const post = e.level === 'post' ? [POST_ONLY] : NONE
        if (E(x)[1] >= 2) put(e.to, [0, l[1]], fs(['효과', ...post, ...why(x, 1, 2)], x, stepFor({ kind: '효과', point: x, at: x, need: { d: 1, lim: 2 }, edge: e })))
        // 자동화가 내는 효과는 호출자가 일으킨다. 호출이 모름이면 그 사유를 단다
        if (auto && invoked(x) && ES(x)[1] < 2) {
          put(e.to, [0, l[1]], fs(['효과', ...post, ...(callWhy.get(x) ?? NONE)], x, stepFor({ kind: '효과', point: x, at: x, need: 'call', edge: e })))
        }
      }
    }

    // 처음에 볼 노드: 계정이 소속으로 닿는 곳과 직접 권한이 닿는 곳 가운데 파생 간선이 걸린 것
    for (const x of mem) touch(x)
    if (Dp.size < live.size) { for (const x of Dp.keys()) touch(x) } else for (const x of live) if (Dp.has(x)) touch(x)
    const run = () => {
      while (queue.length) {
        const x = queue.pop()!
        queued.delete(x)
        visit(x)
      }
    }
    STATE.set(p, { tb, events, bundles })
    IMM.set(p, dv)
    return { dv, fl, put, lend, why, callWhy: a => callWhy.get(a), run }
  }

  // 접속자 권한 차용: 접속자 권한으로 도는 자동화를 고칠 수 있으면 다른 호출자의 직접 접근을 빌린다.
  // 고칠 수 있는 사람은 호출자 전원의 빌릴 수준에서 자기 몫을 뺀 합을 받는다(대상마다 가장 높은 수준과 그다음 수준을 둔다).
  // 빌린 수준도 파생 간선을 따라 다시 편다. 그래서 호출자나 고칠 수 있는 사람이 늘 수 있고, 늘면 다시 빌린다.
  // 수준과 이유는 오르기만 하므로 더 바뀌는 것이 없을 때 끝난다(2026-11-17, 빌리기를 반복 안으로).
  // 호출자가 그 자동화를 부르는 길이 모름이면 그 호출자에게서 빌린 수준도 그 사유를 단다. 호출자를 호출의 모름 사유 묶음으로 나눠 묶음마다 합친다
  /** 호출의 모름 사유가 같은 호출자들의 빌려 줄 수준 */
  interface Bundle {
    rs: readonly string[]
    /** 대상마다 읽기, 쓰기 차원별로 가장 높은 수준, 그 수준을 준 호출자(하나뿐일 때만 뜻이 있다), 그 수준을 준 호출자 수, 그다음 수준 */
    top: Map<string, [Top, Top]>
    /** 고칠 수 있는 사람마다 마지막으로 빌려 준 이유 묶음. 호출자가 그대로이고 묶음이 같으면 다시 넣어도 바뀌지 않는다 */
    given: Map<string, Set<string>>
    /** 지금 top 을 굳힌 것. 호출자가 늘면 버린다 */
    snap?: LendSnap
  }
  interface Lender {
    a: string
    lend(acc: AccMap): AccMap
    base: readonly string[]
    bundles: Map<string, Bundle>
    /** 호출자마다 넣은 묶음. 호출의 모름 사유가 줄면 새 묶음에 다시 넣는다. 옛 묶음 몫은 같은 수준에서 지므로 남겨 둔다 */
    seen: Map<string, string>
    /** 이 자동화로 빌린 수준의 단계 */
    step: Step
  }
  const lenders: Lender[] = []
  for (const a of autos) {
    const callerEdges = ix.outOf('실행 신원', a).filter(r => r.mode === 'caller')
    if (!callerEdges.length) continue
    const capped = callerEdges.every(r => r.borrowCap)
    const caps = callerEdges.flatMap(r => r.borrowCap ?? [])
    const adminOnly = !capped && callerEdges.every(r => r.borrowAdminOnly)
    /** 자동화가 받은 scope 로 자른 차용 수준. 맞는 상한이 없으면 Z */
    const capOf = (t: string, l: Acc): Acc => {
      if (!capped) return l
      if (node(t)?.provider !== node(a)?.provider) return Z
      const type = node(t)?.type?.toLowerCase()
      const hit = caps.filter(c => !c.types || (type !== undefined && c.types.includes(type)))
      return hit.length ? mn(l, hit.map(c => L[c.level]).reduce(mx, Z)) : Z
    }
    /**
     * 호출자 한 명이 빌려 주는 수준. scope 로 자른 차용은 테넌트에 준 권한을 그 테넌트 소속 계정과 그룹에도 펼친다.
     * 관리 콘솔 역할은 테넌트에 걸리고 사용자 계정은 범위가 아니라 소속으로 이어져, 펼치지 않으면 사용자 scope 가 빌릴 대상이 없다
     */
    const lend = (acc: AccMap): AccMap => {
      const out: AccMap = new Map()
      const add = (t: string, l0: Acc) => {
        const l = capOf(t, l0)
        if (eq(l, Z)) return
        // 관리 범위로 도는 자동화는 호출자의 관리 권한 중 제어 객체(설정, 계정, 그룹, 앱)만 빌린다
        if (adminOnly && (l[1] < 3 || node(t)?.cls !== 'control' || node(t)?.provider !== node(a)?.provider)) return
        out.set(t, mx(get(out, t), l))
      }
      for (const [t, l0] of acc) add(t, l0)
      if (capped) for (const [t, l0] of acc) if (node(t)?.kind === 'tenant') for (const { from: m } of ix.inOf('소속', t)) if (node(m)?.kind !== 'tenant') add(m, mx(get(acc, m), l0))
      return out
    }
    editors.set(a, new Set())
    lenders.push({
      a, lend, base: [...(node(a)?.obs_borrow ? NONE : ['실행 기록 없음']), ...(callerEdges.every(r => r.chainUnsure?.length) ? CHAIN : NONE)], bundles: new Map(), seen: new Map(),
      step: stepFor({ kind: '접속자 권한 차용', point: a, at: a, need: { d: 1, lim: 2 } }),
    })
  }

  // 사람마다 한 번 편다. 차용이 없으면 상태를 남기지 않는다
  const people = new Map<string, Person>()
  for (const p of PJ) {
    const s = person(p)
    s.run()
    if (lenders.length) people.set(p, s)
  }

  /**
   * 호출자 한 명의 빌려 줄 수준을 그 호출의 모름 사유 묶음에 더한다. 호출자는 늘기만 하므로 더하기만 한다.
   * 누구나 공유를 뺀 직접 권한(Dself)을 빌린다. 누구나 공유 읽기는 모든 사람에게 이미 있고, 거기서 시작하는 파생은 누구나 노드가 낸다(2026-11-17 결정)
   */
  const addCaller = (b: Lender, q: string, rs: readonly string[], key: string) => {
    b.seen.set(q, key)
    const own = Dself.get(q)
    if (!own) return
    let bd = b.bundles.get(key)
    if (!bd) b.bundles.set(key, (bd = { rs, top: new Map(), given: new Map() }))
    for (const [t, l] of b.lend(own)) {
      let tt = bd.top.get(t)
      if (!tt) bd.top.set(t, (tt = [{ b1: 0, who: '', n: 0, b2: 0 }, { b1: 0, who: '', n: 0, b2: 0 }]))
      for (let d = 0; d < 2; d++) {
        const v = l[d], x = tt[d]
        if (v > x.b1) { x.b2 = x.b1; x.b1 = v; x.who = q; x.n = 1 } else if (v === x.b1 && v > 0) x.n++
        else if (v > x.b2) x.b2 = v
      }
    }
    bd.given.clear()
    bd.snap = undefined
  }
  /** 호출자: 이번 판정에서 부르는 사람과 앞선 전체 판정이 준 호출자. 앞선 판정의 호출자는 이번에 계산하지 않았으면 확정으로 본다 */
  const syncCallers = (b: Lender) => {
    for (const q of [...inv.get(b.a)!, ...(input.callers?.get(b.a) ?? [])]) {
      const rs = people.get(q)?.callWhy(b.a) ?? NONE
      const key = rs.join('\u0001')
      if (b.seen.get(q) !== key) addCaller(b, q, rs, key)
    }
  }

  /** 빌려 줄 수준 표를 지금 호출자 그대로 굳힌다. 호출자가 늘 때까지 받는 사람끼리 같이 쓴다 */
  const snapOf = (bd: Bundle): LendSnap => {
    if (bd.snap) return bd.snap
    const top = new Map<string, [Top, Top]>()
    const lv: [string, [Top, Top]][] = []
    for (const [t, tt] of bd.top) {
      const c: [Top, Top] = [{ ...tt[0] }, { ...tt[1] }]
      top.set(t, c)
      if (live.has(t)) lv.push([t, c])
    }
    return (bd.snap = { top, live: lv })
  }

  let changed = lenders.length > 0
  while (changed) {
    changed = false
    for (const b of lenders) {
      syncCallers(b)
      // 고칠 수 있는 사람만. 사람마다 상태가 따로라 도는 차례는 결과에 상관없다
      for (const p of editors.get(b.a)!) {
        const s = people.get(p)!
        // 고칠 수 있게 된 길이 모름이면 빌린 수준도 그 사유를 단다
        const edit = s.why(b.a, 1, 2)
        for (const bd of b.bundles.values()) {
          const flags = fs([...b.base, ...edit, ...bd.rs], b.a, b.step)
          if (bd.given.get(p) === flags) continue
          bd.given.set(p, flags)
          if (s.lend(snapOf(bd), flags)) changed = true
        }
      }
    }
    if (changed) for (const s of people.values()) s.run()
  }

  /** 단계가 연동 지점에서 대상 t 까지 가는 간선. 신원과 자격증명은 그 수준을 준 단계에 남은 것 */
  const stepHops = (s: Step, t: string): Hop[] => {
    switch (s.kind) {
      case '실행 신원':
      case '자동화 편집':
        return [{ kind: '실행 신원', from: s.point, to: s.identity! }, { kind: '권한', from: s.identity!, to: t }]
      case '자격 보관':
        return [{ kind: '범위', from: s.cred!, to: s.point }, ...(s.identity !== s.cred ? [{ kind: '실행 신원', from: s.cred!, to: s.identity! }] : []), { kind: '권한', from: s.identity!, to: t }]
      case '데이터 흐름':
        return [{ kind: '데이터 흐름', from: t, to: s.point }]
      case '효과':
        return [{ kind: '효과', from: s.point, to: t }]
      case '접속자 권한 차용':
        return [{ kind: '실행 신원', from: s.point, to: t }]
    }
  }

  /**
   * 사람 계정에서 소속 주체 x 까지 소속 사슬. 너비 우선으로 가장 짧은 것, 계정과 간선은 키 차례.
   * 겹친 그룹이면 그룹마다 간선을 그린다(간선마다 근거와 차단 지점이 따로 있다). 닿지 않으면 undefined
   */
  const memberChain = (p: string, x: string): Hop[] | undefined => {
    const acct = accountsOf(p)
    const prev = new Map<string, string | null>(acct.map(k => [k, null]))
    let frontier = [...acct]
    while (frontier.length) {
      const next: string[] = []
      for (const y of frontier) for (const e of ix.outOf('소속', y)) {
        if (prev.has(e.to)) continue
        prev.set(e.to, y)
        if (e.to !== x) { next.push(e.to); continue }
        const hops: Hop[] = []
        let to = x
        for (let from: string | null = y; from !== null; to = from, from = prev.get(from) ?? null) hops.unshift({ kind: '소속', from, to })
        return hops
      }
      frontier = next
    }
    return undefined
  }
  /**
   * 직접 닿는 자리. 소속으로 닿으면 그 계정에서 소속 사슬, 아니면 필요한 수준을 가진 계정의 권한 간선.
   * 계정이 여럿이면 그 간선을 실제로 가진 계정이다(그 계정의 간선이 차단 지점이 된다).
   * 권한 간선에는 그 자리에 필요한 수준을 단다(게시 때 근거 간선을 고른다)
   */
  const directHop = (p: string, x: string, d: 0 | 1, lim: number): Hop[] => {
    const acct = accountsOf(p)
    if (acct.includes(x)) return [{ kind: '소속', from: x, to: x }]
    const m = memberChain(p, x)
    if (m) return m
    const k = acct.find(a => get(ix.identityGrant(a), x)[d] >= lim) ?? acct.find(a => !eq(get(ix.identityGrant(a), x), Z)) ?? p
    return [{ kind: '권한', from: k, to: x, need: needOf(d, lim) }]
  }
  /** 사람 계정에서 소속 주체 x 까지. x 가 계정이면 간선 없음 */
  const memberHops = (p: string, x: string): Hop[] => {
    const acct = accountsOf(p)
    if (acct.includes(x)) return []
    return memberChain(p, x) ?? [{ kind: '소속', from: acct[0] ?? p, to: x }]
  }

  /**
   * 반복이 끝난 뒤 자취를 따라 앞 단계를 이어 붙인다. 서는 조건마다 그 조건을 처음 세운 단계를 따른다(Trail).
   * 확정 경로로 선 조건은 확정 자취를 따른다(판정의 why 와 같은 규칙). 확정 행은 끝까지 확정 자취만 따른다.
   * 자취가 없거나 고리면 사람 계정의 권한 간선으로 끊는다. 처음 세운 단계만 따르므로 생기지 않아야 한다(시험이 센다)
   */
  const traced = (p: string, s: Step, sure: boolean) => {
    const tr = TRAIL.get(p)!
    const memo = `${sure ? 1 : 0}${s.id}`
    let done = tr.leads.get(memo)
    if (!done) tr.leads.set(memo, (done = leadOf(p, tr, s, sure)))
    return done
  }
  const lead = (p: string, s: Step, sure: boolean): Hop[] => traced(p, s, sure).hops
  const chain = (p: string, s: Step, sure: boolean): Chain => traced(p, s, sure).chain
  const leadOf = (p: string, tr: Trail, s: Step, sure: boolean): { hops: Hop[]; chain: Chain } => {
    const Dp = Dself.get(p)!
    const seen = new Set<string>()
    const steps: Step[] = []
    const relayed = new Set<Step>()
    let open: Opening | undefined
    const cut = (x: string): Hop[] => { open = { how: 'cut', at: x, d: 0, lim: 1 }; return [{ kind: '권한', from: accountsOf(p)[0] ?? p, to: x }] }
    const atLevel = (x: string, d: 0 | 1, lim: number, sure: boolean): Hop[] => {
      if (get(Dp, x)[d] >= lim) { open = { how: 'level', at: x, d, lim }; return directHop(p, x, d, lim) }
      const useSure = sure || get(cell(p, x).dvs, x)[d] >= lim
      const key = `L${useSure ? 1 : 0}${slot(d, lim)}\u0001${x}`
      if (seen.has(key)) return cut(x)
      seen.add(key)
      const st = (useSure ? tr.levelSure : tr.level)[slot(d, lim)].get(x)
      if (!st) return cut(x)
      // 이 자리에 선 단계의 권한 간선(신원에서 x)에도 필요한 수준을 단다
      const need = needOf(d, lim)
      return [...before(st, useSure), ...stepHops(st, x).map(h => (h.kind === '권한' && h.to === x ? { ...h, need } : h))]
    }
    /** owner: 이 호출로 서는 단계. 부른 것이 다른 자동화이거나 부르는 자리에 파생으로 서면 relayed */
    const atCall = (a: string, sure: boolean, owner?: Step): Hop[] => {
      const useSure = sure || tr.callSure.has(a)
      const key = `C${useSure ? 1 : 0}\u0001${a}`
      if (seen.has(key)) return cut(a)
      seen.add(key)
      const v = (useSure ? tr.callSure : tr.call).get(a)
      if (!v) return cut(a)
      const call: Hop = { kind: '호출', from: v.from, to: a }
      const callAt = () => { open = { how: 'call', at: v.from, d: v.d, lim: v.lim, to: a } }
      if (v.how === 'mem') { callAt(); return [...memberHops(p, v.from), call] }
      if (v.how === 'call') { if (owner) relayed.add(owner); return [...atCall(v.from, useSure), call] }
      const hops = [...atLevel(v.from, v.d, v.lim, useSure), call]
      // 호출 자리에 직접 권한으로 서면 처음 하는 일은 호출이다(그 자리에 쓰는 것이 아니라 자동화를 부른다).
      // 파생으로 서면 그 자리에서 부르는 것은 앞 단계 신원이라 호출자 기록에 그 사람이 남지 않는다
      if (get(Dp, v.from)[v.d] >= v.lim) callAt()
      else if (owner) relayed.add(owner)
      return hops
    }
    const atFlow = (x: string, sure: boolean): Hop[] => {
      const useSure = sure || tr.flowSure.has(x)
      const key = `F${useSure ? 1 : 0}\u0001${x}`
      if (seen.has(key)) return cut(x)
      seen.add(key)
      const st = (useSure ? tr.flowSure : tr.flow).get(x)
      return st ? [...before(st, useSure), ...stepHops(st, x)] : cut(x)
    }
    const before = (st: Step, sure: boolean): Hop[] => {
      steps.push(st)
      return st.need === 'call' ? atCall(st.at, sure, st) : st.need === 'flow' ? atFlow(st.at, sure) : atLevel(st.at, st.need.d, st.need.lim, sure)
    }
    const hops = before(s, sure)
    return { hops, chain: { steps, open: open!, relayed } }
  }

  return { tables, cellOf, dvAt, column, inv, idgrant, lead, chain, stepHops }
}
