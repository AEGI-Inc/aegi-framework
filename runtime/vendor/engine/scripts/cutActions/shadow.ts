/**
 * 조치 동사 그림자 (4층): 끊는 곳마다 조치 동사 사전의 동사를 붙여 본 수를 센다.
 * 끊는 곳은 EA 행의 cut 이다. 운영 결과는 바꾸지 않는다. 위협 판정 V2 의 차단 지점은 조치 동사를 쓰지 않아 세지 않는다.
 *
 * 동사 고르기는 조치 문장과 같은 함수(src/detection/cutActions.ts)다. 사전은 생성 표(CUT_ACTIONS)가 기본이고,
 * 다른 판의 사전으로 미리 잴 때는 그 폴더의 cut_actions.yaml 을 읽는다(loadCutActions).
 * 닫은 동사(status adopted)가 붙는 수(adopted), 열린 동사로만 짝지어지는 수(open), 짝이 없는 수(none)를 따로 센다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import type { GraphStoreV2 } from '../../src/model/graph'
import type { EffectiveAccessFile } from '../../src/detection/v2/effectiveAccess/types'
import { CUT_ACTIONS, verbForCut, verbForRelation, type CutActionVerb, type VerbMatch } from '../../src/detection/cutActions'
import { cutActionVerbs } from './table'

export { verbForCut, verbForRelation }
export type { CutActionVerb, VerbMatch }

/** 사전 폴더의 cut_actions.yaml 을 생성 표와 같은 모양으로 읽는다. 폴더가 없으면 생성 표 */
export function loadCutActions(dir?: string): ReadonlyArray<CutActionVerb> {
  if (!dir) return CUT_ACTIONS
  const doc = parse(fs.readFileSync(path.join(dir, 'cut_actions.yaml'), 'utf8')) as { verbs: any[] }
  return cutActionVerbs(doc.verbs)
}

type Tally = { total: number; adopted: number; open: number; none: number; by_verb: Record<string, number> }
const tally = (): Tally => ({ total: 0, adopted: 0, open: 0, none: 0, by_verb: {} })
function count(t: Tally, m: VerbMatch | undefined): void {
  t.total++
  if (!m) { t.none++; return }
  if (m.adopted) {
    t.adopted++
    t.by_verb[m.verb] = (t.by_verb[m.verb] ?? 0) + 1
  } else t.open++
}

/**
 * 그림자 요약: 끊는 곳마다 닫은 동사가 붙는 수(adopted), 열린 동사로만 짝지어지는 수(open), 짝이 없는 수(none). 키와 이름은 남기지 않는다
 */
export function cutActionsSummary(graph: GraphStoreV2, ea: EffectiveAccessFile, verbs: ReadonlyArray<CutActionVerb> = CUT_ACTIONS) {
  const eaCuts = tally()
  let rowsWithAdopted = 0
  for (const row of ea.rows) {
    let any = false
    for (const c of row.cut) {
      const v = row.via[c.via]
      const r = v?.kind === 'relation' ? graph.relationsByKey.get(v.ref) : undefined
      const m = r ? verbForRelation(r, graph, verbs) : undefined
      count(eaCuts, m)
      any ||= !!m?.adopted
    }
    if (any) rowsWithAdopted++
  }
  return {
    adopted_verbs: verbs.filter(v => v.status === 'adopted').map(v => v.id),
    ea: { rows: ea.rows.length, rows_with_adopted_verb: rowsWithAdopted, cuts: eaCuts },
  }
}
