/**
 * 범용 접근 엔진의 브라우저 사본 — 진입점. 설계는 docs/spec/AEGI_GENERIC_ACCESS_ENGINE_V1.md.
 *
 * 화면은 간선(EdgeIndex)으로 Explorer 경로와 확산 범위를 그린다. 접근은 계산하지 않는다.
 * 위협, Access Gap, 사람의 직접 권한과 파생 접근은 엔진이 게시한 결과(derived)를 읽는다. 옛 격차 판정(policies.ts),
 * 원인 질의(cause, know), 직접 권한 질의(can, askCan, actsCan)는 2026-11-18 지웠다.
 */
import type { EvidenceStore } from '../../../model/evidence'
import type { GraphStoreV2 } from '../../../model/graph'
import { EdgeIndex } from './edges'
import type { CoverageFile, EngineOverrides } from './types'

export * from './types'
export { EVERYONE, OBS_PREFIX, EdgeIndex } from './edges'
export { REASON_LABELS, reasonLabel, MODEL_VERSION, RANK } from './accessModel'

export interface EngineInput {
  graph: GraphStoreV2
  evidence: EvidenceStore
  coverage?: CoverageFile
  overrides?: EngineOverrides
}

export class AccessEngine {
  readonly ix: EdgeIndex

  constructor(readonly input: EngineInput) {
    this.ix = new EdgeIndex(input.graph, input.evidence, { coverage: input.coverage, overrides: input.overrides })
  }
}
