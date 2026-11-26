/**
 * 닿음 핵심의 질의면 (2026-11-03, 구조 개편 2단계).
 *
 * 위협 엔진의 간선(EdgeIndex: 관계 효과 표, 객체 참조, 관측으로 만든 간선 7종) 위에서 한 걸음씩 묻는다. 위협 질의(query.ts)는 이 간선으로 길을
 * 닫고, EA 거름(접근 규칙 실행기 scripts/accessRules/executor.ts)은 같은 간선 위에서 규칙 파일이 적은 길 모양만 고른다. 관계 행 하나의 뜻을
 * 읽는 곳은 효과 표 읽기(relationEffects.ts) 하나다.
 *
 * 걸음은 출처마다 따로다. 간선은 같은 두 끝, 종류, 세기면 출처를 합치지만 EA 는 관계 행 하나가 한 길이라, 걸음은 간선의 출처(관계 행)마다
 * 하나씩 돌려주고 사유도 그 출처가 낸 것(EdgeIndex.refUncertain)이다.
 * 층: 설정(관계, 참조, 모델, 링크, overrides 출처) / 관측(관측, 증거 출처). 한 간선이 두 층의 출처를 같이 가질 수 있다.
 */
import type { ResolvedRelation } from '../../../model/relation'
import type { EdgeIndex } from './edges'
import type { RelationEffects } from '../../../ontology/generated'
import { NARROWING_ENDS, RelationEffectReader } from './relationEffects'
import type { Edge, EdgeKind, EdgeRef } from './types'

export type ReachLayer = 'config' | 'observed'

export const layerOf = (ref: EdgeRef): ReachLayer => (ref.type === 'observation' || ref.type === 'evidence' ? 'observed' : 'config')

/** 걸음 하나: 간선 하나의 출처 하나 */
export interface ReachHop {
  edge: Edge
  to: string
  ref: EdgeRef
  layer: ReachLayer
  /** 출처가 관계 행이면 그 행 */
  relation?: ResolvedRelation
  /** 이 출처가 이 간선에 단 사유 */
  uncertain: string[]
}

/** 관계 홉 하나가 서는지와 그 사유. 칸(출발 interface>도착 interface)은 홉이 가리키는 쪽만 본다 */
export interface RelationStand {
  stands: boolean
  uncertain: string[]
  /**
   * 맞은 갈래가 관계 도착 대신 펼친 대상(효과 표 끝 resource_set, resource_set_unexpanded)을 적었으면 그 도착들과 그 간선의 사유.
   * 없으면 관계 도착 그대로다. 비어 있으면 홉은 서지만 갈 곳이 없다(세트가 아무것도 덮지 않음)
   */
  targets?: Array<{ to: string; uncertain: string[] }>
}

export class ReachCore {
  readonly reader: RelationEffectReader

  /** semantics 는 관계 홉이 서는지 볼 효과 표(시험이 사전을 바꿔 넣을 때). 간선과 그 사유는 언제나 엔진 생성 표(RELATION_EFFECTS)로 만든다 */
  constructor(readonly ix: EdgeIndex, semantics?: Record<string, RelationEffects>) {
    this.reader = new RelationEffectReader(ix.graph, semantics, ix.options.overrides)
  }

  private hop(edge: Edge, ref: EdgeRef): ReachHop {
    const relation = ref.type === 'relation' ? this.ix.graph.relationsByKey.get(ref.id) : undefined
    return { edge, to: edge.to, ref, layer: layerOf(ref), relation, uncertain: this.ix.refUncertain.get(`${edge.id}|${ref.type}:${ref.id}`) ?? edge.uncertain }
  }

  /** from 에서 나가는 kind 간선의 걸음(출처마다). layer 를 주면 그 층 출처만 */
  out(from: string, kind: EdgeKind, layer?: ReachLayer): ReachHop[] {
    return this.ix.outOf(from, kind).flatMap(e => e.refs.filter(r => !layer || layerOf(r) === layer).map(r => this.hop(e, r)))
  }

  /**
   * 관계 행 하나가 홉으로 서나. 효과 표 칸 가운데 홉이 가리키는 칸(srcWant, tgtWant 가 없으면 아무 칸)이 막히지 않았으면 선다.
   * 효과 표가 이 행의 칸을 하나도 적지 않았으면 관계 행이 있는 것으로 선다(applies_to 처럼 효과가 없는 관계). 위협 간선이 건너뛴 행
   * (측정 도구 계정이 출발이거나 측정 도구 소속)은 서지 않는다. 사유는 선 칸이 낸 간선마다 그 출처(이 행)가 단 것이다
   */
  relation(rel: ResolvedRelation, srcWant?: string, tgtWant?: string): RelationStand {
    if (this.ix.skippedRelations.has(rel.relationKey)) return { stands: false, uncertain: [] }
    const all = this.reader.cells(rel)
    const known = all.some(c => c.defined) ? all.filter(c => c.defined) : all
    const cells = known.filter(c => (!srcWant || c.pair.split('>')[0] === srcWant) && (!tgtWant || c.pair.split('>')[1] === tgtWant) && !c.blocked)
    if (!cells.length) return { stands: false, uncertain: [] }
    const uncertain = new Set<string>()
    const reasonsOf = (e: (typeof cells)[number]['emits'][number]) => {
      const edge = this.ix.outOf(e.from, e.emit.kind as EdgeKind).find(x => x.to === e.to && x.refs.some(r => r.type === 'relation' && r.id === rel.relationKey))
      return edge ? this.hop(edge, { type: 'relation', id: rel.relationKey }).uncertain : [...(e.emit.uncertain ?? [])]
    }
    for (const c of cells) for (const e of c.emits) for (const u of reasonsOf(e)) uncertain.add(u)
    if (!cells.some(c => c.narrowed)) return { stands: true, uncertain: [...uncertain] }
    const targets = new Map<string, Set<string>>()
    for (const c of cells) {
      for (const e of c.emits) {
        if (!NARROWING_ENDS.has(e.emit.to)) continue
        // 같은 끝으로 가는 다른 간선과 합쳐진 간선은 사유를 하나만 남기므로(edges.ts add), 이 끝을 낸 효과 표 줄의 사유도 더한다
        const at = targets.get(e.to) ?? new Set<string>()
        for (const u of [...reasonsOf(e), ...(e.emit.uncertain ?? [])]) at.add(u)
        targets.set(e.to, at)
      }
    }
    return { stands: true, uncertain: [...uncertain], targets: [...targets].map(([to, u]) => ({ to, uncertain: [...u] })) }
  }
}
