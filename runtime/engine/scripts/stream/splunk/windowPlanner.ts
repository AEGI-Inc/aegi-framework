/** 고정 색인 구간 (SPLUNK_SPEC.md 3절). window end 는 검색 전에 정한다 */
import type { IndexWindow } from './templates'

export interface WindowOptions {
  overlapSec?: number
  safetySec?: number
  /** cursor 가 없을 때 시작 색인 시각 */
  backfillFrom?: number
}

export const DEFAULT_WINDOW = { overlapSec: 300, safetySec: 60, backfillFrom: 0 }

export function planWindow(cursor: number | undefined, nowSec: number, opts: WindowOptions = {}): IndexWindow | null {
  const o = { ...DEFAULT_WINDOW, ...opts }
  const indexEarliest = Math.max(0, cursor === undefined ? o.backfillFrom : cursor - o.overlapSec)
  const indexLatest = Math.floor(nowSec) - o.safetySec
  return indexLatest > indexEarliest ? { indexEarliest, indexLatest } : null
}
