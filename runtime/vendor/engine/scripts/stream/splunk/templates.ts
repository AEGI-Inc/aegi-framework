/**
 * 승인된 검색 템플릿 (SPLUNK_SPEC.md 3절). 사용자가 쓴 SPL 은 받지 않는다.
 * 넣을 수 있는 값은 승인 index, 승인 sourcetype, 정수 시각뿐이다.
 */
import type { Approved } from './types'

export interface IndexWindow { indexEarliest: number; indexLatest: number }

/** 발생 시각이 색인 시각보다 이만큼 뒤여도 받는다 (시계 오차). 넘으면 gap 으로 본다 */
export const FUTURE_SKEW_SEC = 3600

function assertEpoch(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 0) throw new Error(`${name} 는 0 이상의 정수 초여야 한다: ${v}`)
}

export function assertApproved(approved: Approved, index: string, sourcetype: string): void {
  if (!approved[index]?.includes(sourcetype)) throw new Error(`승인되지 않은 검색 대상: index=${index} sourcetype=${sourcetype}`)
}

/** 색인 시각 고정 구간 검색. 발생 시각은 earliest=0 으로 열어 늦게 색인된 과거 이벤트도 받는다 */
export function windowSearch(approved: Approved, index: string, sourcetype: string, w: IndexWindow): string {
  assertApproved(approved, index, sourcetype)
  assertEpoch('indexEarliest', w.indexEarliest)
  assertEpoch('indexLatest', w.indexLatest)
  if (w.indexLatest <= w.indexEarliest) throw new Error('빈 구간')
  return [
    `search index=${index} sourcetype="${sourcetype}"`,
    `earliest=0 latest=${w.indexLatest + FUTURE_SKEW_SEC}`,
    `_index_earliest=${w.indexEarliest} _index_latest=${w.indexLatest}`,
    '| eval aegi_indextime=_indextime',
    '| fields _time aegi_indextime index sourcetype _raw',
  ].join(' ')
}
