/**
 * 범용 접근 엔진 — 진입점. 설계·검증 절차는 docs/spec/AEGI_GENERIC_ACCESS_ENGINE_V1.md.
 *
 * 간선 색인(EdgeIndex)과 원래 권한 질의(can)를 낸다. 위협 판정(src/detection/threat)이 이 간선을 읽는다.
 * 검증 스크립트(npm run engine:verify)가 EA 줄과 대조한다 (parity.ts).
 */
import type { EvidenceStore } from '../../../model/evidence'
import type { GraphStoreV2 } from '../../../model/graph'
import { MODEL_VERSION } from './accessModel'
import { EdgeIndex } from './edges'
import { QueryContext, better, join, verdictOf, EMPTY_HIT } from './query'
import { needOf, type Need } from './semantic/ceiling'
import type { CoverageFile, EdgeKind, EngineOverrides, EngineResult, Hit, SetResult, Verdict, Witness } from './types'

export * from './types'
export { EVERYONE, OBS_PREFIX, EdgeIndex } from './edges'
export { QueryContext, representative } from './query'
export { REASON_LABELS, reasonLabel, MODEL_VERSION, RANK } from './accessModel'
export { NEED_CAPS, needOf, type Need } from './semantic/ceiling'

export interface EngineInput {
  graph: GraphStoreV2
  evidence: EvidenceStore
  coverage?: CoverageFile
  overrides?: EngineOverrides
  dataset?: EngineResult['dataset']
}

export interface PointAnswer {
  verdict: Verdict
  witness?: Witness
  open: string[]
}

export class AccessEngine {
  readonly ix: EdgeIndex
  readonly ctx: QueryContext

  constructor(readonly input: EngineInput) {
    this.ix = new EdgeIndex(input.graph, input.evidence, { coverage: input.coverage, overrides: input.overrides })
    this.ctx = new QueryContext(this.ix)
  }

  /** 간선 수, 수집 완결성, 경고 요약 */
  run(): EngineResult {
    const ix = this.ix
    const edges = { M: z(), U: z(), G: z(), T: z(), A: z(), F: z(), E: z() } as Record<EdgeKind, { certain: number; uncertain: number }>
    for (const e of ix.edges.values()) edges[e.kind][e.uncertain.length ? 'uncertain' : 'certain']++
    const warnings = [...ix.warnings]
    if (ix.coverageSource === 'none') warnings.unshift({ code: 'coverage_missing', message: '수집 완결성(coverage.json)이 없어 모든 목록을 닫힌 것으로 봤다 — 실측이면 normalize:v2 를 다시 돌려 coverage.json 을 만든다' })
    return {
      format: 'aegi-access-engine/v1',
      model_version: MODEL_VERSION,
      dataset: this.input.dataset ?? {},
      coverage: { source: ix.coverageSource, open: ix.coverageSummary() },
      overrides: { source: this.input.overrides ? 'file' : 'none', entries: countOverrides(this.input.overrides) },
      edges,
      warnings,
    }
  }

  // ---- 한 쌍 질의 (검증 스크립트 --ask, EA 줄 대조) ----

  private point(set: SetResult, account: string): PointAnswer {
    const h = set.hits.get(account) ?? set.everyone
    return { verdict: verdictOf(h, set.open), witness: h ? this.ctx.witness(h) : undefined, open: h ? [] : set.open }
  }

  /** 이 계정이 x 에 cap 이상을 스스로 가지는가 (원래 권한) */
  askCan(account: string, cap: 'read' | 'write' | 'admin', x: string): PointAnswer {
    return this.point(this.ctx.can(needOf(cap), x), account)
  }

  /**
   * 능력 이름으로 묻는다(관계 의미 층). caps 가운데 하나라도 있으면 맞음 — 「만들기는 되고 읽기는 안 됨」을 가른다.
   * 세기(숫자)를 주면 끈 길과 같은 비교용 질의다
   */
  askCanDo(account: string, caps: string | readonly string[] | number, x: string): PointAnswer {
    const need: Need = typeof caps === 'string' ? [caps] : caps
    return this.point(this.ctx.can(need, x), account)
  }

  /** 자동화(행위자)가 실행 신원으로 x 에 cap 을 가지는가 — runs_as_inherits 와 같은 질문 */
  actsCan(actor: string, cap: 'read' | 'write' | 'admin', x: string): PointAnswer {
    const ix = this.ix
    const holders = this.ctx.can(needOf(cap), x)
    let best: Hit | undefined
    const seen = new Map<string, Hit>([[actor, EMPTY_HIT]])
    let frontier = [actor]
    for (let d = 0; d < 6 && frontier.length; d++) {
      const next: string[] = []
      for (const k of frontier) {
        for (const a of ix.outOf(k, 'A')) {
          const h = join(seen.get(k)!, { cost: a.uncertain.length ? 1 : 0, path: [a.id], reasons: a.uncertain, observed: a.observed })
          if (seen.has(a.to) && !better(seen.get(a.to), h)) continue
          seen.set(a.to, h)
          next.push(a.to)
          const g = holders.hits.get(a.to)
          if (g) {
            const total = join(h, g)
            if (better(best, total)) best = total
          }
        }
      }
      frontier = next
    }
    return { verdict: verdictOf(best, best ? [] : holders.open), witness: best ? this.ctx.witness(best) : undefined, open: best ? [] : holders.open }
  }
}

function z() {
  return { certain: 0, uncertain: 0 }
}

function countOverrides(o?: EngineOverrides): number {
  if (!o) return 0
  return Object.keys(o.entry_point_gates ?? {}).length + Object.keys(o.role_capabilities ?? {}).length + (o.confirmed_resource_sets?.length ?? 0)
}

export function runAccessEngine(input: EngineInput): { engine: AccessEngine; result: EngineResult } {
  const engine = new AccessEngine(input)
  return { engine, result: engine.run() }
}
