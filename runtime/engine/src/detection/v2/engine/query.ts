/**
 * 질의 — 원래 권한(can)과 그룹 펴기(members). 설계서 §2-3.
 *
 * 간선 종류 위의 경로 질의다. 확실한 간선 비용 0, 불확실한 간선 비용 1 인 최단 경로(0-1 BFS, 버킷 큐)라
 * 가장 덜 불확실한 경로가 곧 근거(witness)다. 비용 0 으로 닿으면 yes, 비용이 있으면 unknown,
 * 못 닿으면 — 지나온 목록이 모두 닫혀 있을 때만 — no.
 *
 *   can   (원래)  : M* · G[능력] · U⁻¹*               — 연동 간선을 절대 타지 않는다
 *
 * 파생 접근은 위협 판정(src/detection/threat/derived.ts)이 낸다.
 * QueryContext 는 끊어 볼 간선(excluded)을 받는다 — 회수 지점을 반사실로 잰다 (설계서 §2-6).
 */
import { inheritCap } from './accessModel'
import { CONTENT_REACH_PROVIDERS, objectClass, tenantLimit } from './directAccess'
import { EVERYONE, type EdgeIndex } from './edges'
import { underCeiling, type Need } from './semantic/ceiling'
import { NATIVE_KINDS, type Edge, type EdgeView, type Hit, type SetResult, type Verdict, type Witness } from './types'

export const EMPTY_HIT: Hit = { cost: 0, path: [], reasons: [], observed: false }

export function better(a: Hit | undefined, b: Hit): boolean {
  return !a || b.cost < a.cost || (b.cost === a.cost && b.path.length < a.path.length)
}

function step(h: Hit, e: Edge, where: 'prepend' | 'append'): Hit {
  const reasons = e.uncertain.length ? [...new Set([...h.reasons, ...e.uncertain])] : h.reasons
  return {
    cost: h.cost + (e.uncertain.length ? 1 : 0),
    path: where === 'prepend' ? [e.id, ...h.path] : [...h.path, e.id],
    reasons,
    observed: h.observed || (!NATIVE_KINDS.has(e.kind) && e.observed),
  }
}

/** 두 경로를 잇는다 (a 다음 b) */
export function join(a: Hit, b: Hit, extra: string[] = []): Hit {
  return {
    cost: a.cost + b.cost + (extra.length ? 1 : 0),
    path: [...a.path, ...b.path],
    reasons: [...new Set([...a.reasons, ...b.reasons, ...extra])],
    observed: a.observed || b.observed,
  }
}

export function verdictOf(h: Hit | undefined, open: string[] = []): Verdict {
  if (h) return h.cost === 0 ? 'yes' : 'unknown'
  return open.length ? 'unknown' : 'no'
}

function setHit(m: Map<string, Hit>, k: string, h: Hit): void {
  if (better(m.get(k), h)) m.set(k, h)
}

function addOpen(list: string[], reasons: string[]): void {
  for (const r of reasons) if (!list.includes(r)) list.push(r)
}

/** 비용 버킷 큐 — 비용이 작은 것부터, 같은 비용이면 넣은 순서대로 */
class Buckets<T> {
  private b: T[][] = []
  private cursor = 0
  push(cost: number, item: T): void {
    ;(this.b[cost] ??= []).push(item)
    if (cost < this.cursor) this.cursor = cost
  }
  pop(): T | undefined {
    while (this.cursor < this.b.length) {
      const list = this.b[this.cursor]
      if (list?.length) return list.shift()
      this.cursor++
    }
    return undefined
  }
}

export class QueryContext {
  private canMemo = new Map<string, SetResult>()

  /**
   * @param excluded 끊어 볼 간선
   * @param base 끊기 전 문맥. 주면 관측된 효과(E)는 그 효과를 가능하게 한 실행 신원 경로가 남아 있을 때만 인정한다 —
   *             회수하면 자동화가 다시는 그 일을 못 한다. 끊기 전에도 실행 신원 경로가 없었으면(무엇으로 했는지 모름) 그대로 둔다
   */
  constructor(readonly ix: EdgeIndex, readonly excluded: ReadonlySet<string> = new Set(), readonly base?: QueryContext, readonly configOnly = false) {}

  private configCtx?: QueryContext
  /** 관측으로만 안 권한(받아들여진 쓰기 G)을 빼고 설정 사실로만 푸는 문맥 — 회수 지점은 설정에 있다 */
  config(): QueryContext {
    if (this.configOnly) return this
    return (this.configCtx ??= new QueryContext(this.ix, this.excluded, undefined, true))
  }

  private ok = (e: Edge) => !this.excluded.has(e.id)

  // ---------------------------------------------------------------------------
  // can — 원래 권한
  // ---------------------------------------------------------------------------

  /** x 에 need 이상을 스스로 가진 계정. asType 은 권한이 닿는 객체 종류(역할 적용 범위)를 x 대신 쓸 때 */
  can(need: Need, x: string, asType?: string): SetResult {
    const key = `${needKey(need)}|${x}|${asType ?? ''}`
    const memo = this.canMemo.get(key)
    if (memo) return memo
    const ix = this.ix
    const t = asType ?? ix.type(x)
    // 테넌트 권한이 이 대상까지 내려오나: 권한 출처 종류와 대상 객체 종류(내용, 설정, 계정)로 정한다 (directAccess.ts tenantLimit, providers.yaml tenant_scope)
    const xClass = asType && ix.isTenant(x) ? 'content' : objectClass(ix, x)
    const result: SetResult = { hits: new Map(), open: [] }
    type State = { node: string; mode: 'scope' | 'principal'; hit: Hit; cap: number; role?: string }
    const q = new Buckets<State>()
    const best = new Map<string, number>()
    const visit = (s: State) => {
      const k = `${s.mode}|${s.node}|${s.cap}`
      const prev = best.get(k)
      if (prev !== undefined && prev <= s.hit.cost) return
      best.set(k, s.hit.cost)
      q.push(s.hit.cost, s)
    }
    visit({ node: x, mode: 'scope', hit: EMPTY_HIT, cap: Infinity })
    for (let s = q.pop(); s; s = q.pop()) {
      if (best.get(`${s.mode}|${s.node}|${s.cap}`)! < s.hit.cost) continue
      if (s.mode === 'scope') {
        const y = s.node
        const inherited = y !== x
        const provider = ix.provider(y)
        const viaTenant = inherited && ix.isTenant(y)
        // 테넌트 권한이 내용으로 내려갈 수 없는 SaaS 면 그 테넌트 권한 목록이 덜 모였다는 사유를 내용 대상에 붙이지 않는다
        if (!viaTenant || xClass !== 'content' || CONTENT_REACH_PROVIDERS.has(provider ?? '')) addOpen(result.open, ix.openReasons('grants', y))
        for (const e of ix.inOf(y, 'G')) {
          if (!this.ok(e) || (this.configOnly && e.grantSource === 'observed')) continue
          const lim = viaTenant ? Math.min(s.cap, tenantLimit(ix, e, x, asType)) : s.cap
          if (lim <= 0) continue
          // 세기 또는 능력 이름. 의미 층을 켜면 상한(보유자 권한 ∩ scope)도 여기서 건다 (semantic/ceiling.ts)
          const got = underCeiling(ix, ix.ceilings, e, x, asType, need, lim)
          if (!got) continue
          // 역할 적용 범위: 상위에서 내려오거나 종류를 정해 물을 때만 본다. 그 객체에 직접 걸린 역할을 그 객체 자체로 물으면 권한이다
          if (e.appliesTo?.length && t && (inherited || asType) && !e.appliesTo.includes(t)) continue
          const hit = step(s.hit, e, 'prepend')
          visit({ node: e.from, mode: 'principal', hit: got.reasons.length ? join(hit, EMPTY_HIT, got.reasons) : hit, cap: Infinity, role: e.roleKey })
        }
        for (const e of ix.outOf(y, 'U')) {
          // 하위 테넌트에는 상위 테넌트 권한이 내려가지 않는다 (providers.yaml tenant_scope)
          if (!this.ok(e) || ix.provider(e.to) !== provider || (ix.isTenant(y) && ix.isTenant(e.to))) continue
          visit({ node: e.to, mode: 'scope', hit: step(s.hit, e, 'prepend'), cap: Math.min(s.cap, inheritCap(provider, ix.type(e.to), ix.type(y))) })
        }
        // 주체가 대상이면 그 주체의 테넌트가 범위다 (Okta 사용자 → org)
        if (ix.has(y, 'Principal') && !ix.isGroupLike(y)) {
          for (const e of ix.outOf(y, 'M')) {
            if (this.ok(e) && ix.isTenant(e.to)) visit({ node: e.to, mode: 'scope', hit: step(s.hit, e, 'prepend'), cap: s.cap })
          }
        }
      } else {
        const p = s.node
        if (p === EVERYONE) {
          if (better(result.everyone, s.hit)) result.everyone = s.hit
        } else if (ix.isGroupLike(p)) {
          addOpen(result.open, ix.openReasons('members', p))
          for (const e of ix.inOf(p, 'M')) {
            if (!this.ok(e)) continue
            if (s.role && ix.roleExcludes.get(s.role)?.has(e.from)) continue
            visit({ node: e.from, mode: 'principal', hit: step(s.hit, e, 'prepend'), cap: Infinity, role: s.role })
          }
        } else {
          setHit(result.hits, p, s.hit)
        }
      }
    }
    // 끊어 본 문맥: 설정으로 권한이 있던 계정이 설정을 잃으면, 관측된 쓰기 기록은 과거일 뿐이라 권한으로 치지 않는다
    if (this.base && !this.configOnly) {
      const before = this.base.config().can(need, x, asType)
      const now = this.config().can(need, x, asType)
      for (const k of [...result.hits.keys()]) if (before.hits.has(k) && !now.hits.has(k)) result.hits.delete(k)
    }
    this.canMemo.set(key, result)
    return result
  }

  /** 그룹·테넌트를 멤버 계정으로 편다. 시작이 계정이면 그 계정 하나 */
  members(start: string, base: Hit): SetResult {
    const ix = this.ix
    const result: SetResult = { hits: new Map(), open: [] }
    const q = new Buckets<{ node: string; hit: Hit }>()
    const best = new Map<string, number>()
    const visit = (node: string, hit: Hit) => {
      const prev = best.get(node)
      if (prev !== undefined && prev <= hit.cost) return
      best.set(node, hit.cost)
      q.push(hit.cost, { node, hit })
    }
    visit(start, base)
    for (let s = q.pop(); s; s = q.pop()) {
      if (s.node === EVERYONE) {
        if (better(result.everyone, s.hit)) result.everyone = s.hit
      } else if (ix.isGroupLike(s.node)) {
        addOpen(result.open, ix.openReasons('members', s.node))
        for (const e of ix.inOf(s.node, 'M')) if (this.ok(e)) visit(e.from, step(s.hit, e, 'prepend'))
      } else {
        setHit(result.hits, s.node, s.hit)
      }
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // 보기
  // ---------------------------------------------------------------------------

  edgeView(id: string): EdgeView {
    const e = this.ix.edges.get(id)!
    return { id, kind: e.kind, from: e.from, fromName: this.ix.name(e.from), to: e.to, toName: this.ix.name(e.to), label: e.label, uncertain: e.uncertain, revocable: e.revocable, refs: e.refs }
  }

  witness(h: Hit): Witness {
    const edges = h.path.map(id => this.edgeView(id))
    const providers = new Set<string>()
    for (const e of edges) for (const k of [e.from, e.to]) {
      const p = this.ix.provider(k)
      if (p) providers.add(p)
    }
    const level = h.cost > 0 ? 'indeterminate' : providers.size > 1 ? 'computed_cross' : 'computed'
    return { level, shape: edges.map(e => e.kind).join(', '), cost: h.cost, reasons: h.reasons, edges }
  }
}

/** 메모 열쇠: 세기는 숫자 그대로(끈 길과 같은 열쇠), 능력 이름은 + 로 잇는다 */
function needKey(need: Need): string {
  return typeof need === 'number' ? String(need) : need.join('+')
}

/**
 * 대표 범위 — 보고서가 결과를 묶는 자리.
 * 자기 권한 설정(config·model G)이 있는 첫 객체 → 없으면 가장 위의 테넌트 아닌 자원 → 없으면 테넌트 → 자기 자신.
 * 메시지 → 채널, 커밋 → 저장소, Okta 사용자·인증 수단 → Okta 조직.
 */
export function representative(ix: EdgeIndex, key: string): string {
  const chain = [key]
  for (let cur = key, d = 0; d < 8; d++) {
    const parents = [...ix.outOf(cur, 'U').map(e => e.to), ...(ix.has(cur, 'Principal') ? ix.outOf(cur, 'M').filter(e => ix.isTenant(e.to)).map(e => e.to) : [])]
    const next = parents.find(p => !ix.isTenant(p)) ?? parents[0]
    if (!next || chain.includes(next)) break
    chain.push(next)
    cur = next
  }
  const own = (k: string) => ix.inOf(k, 'G').some(e => e.grantSource === 'config' || e.grantSource === 'model')
  const configured = chain.find(k => !ix.isTenant(k) && (k === key || ix.has(k, 'Resource')) && own(k))
  if (configured) return configured
  const resources = chain.filter(k => !ix.isTenant(k) && ix.has(k, 'Resource'))
  if (resources.length) return resources[resources.length - 1]
  return chain.find(k => ix.isTenant(k)) ?? key
}
