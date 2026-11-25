import type { GraphStoreV2 } from './graph'
import type { CoverageCall } from '../detection/v2/engine/types'
import { daysAgo } from '../utils/time'

/**
 * SaaS마다 마지막 수집 시각과 상태(정상, 갱신 지연, 미수집).
 * 수집 기록이 있으면 정상(7일 초과 시 갱신 지연), 덜 받은 호출(missedCalls)은 따로 센다.
 */

/** 마지막 수집이 이 날수보다 오래되면 오래됨 */
export const STALE_DAYS = 7

export type CollectionState = 'ok' | 'stale' | 'none'

export const COLLECTION_STATE_LABEL: Record<CollectionState, string> = {
  ok: '정상',
  stale: '갱신 지연',
  none: '미수집',
}

export interface CallStats {
  total: number
  full: number
  partial: number
  failed: number
}

export interface ProviderCollection {
  /** 가장 늦은 수집 시각 (ISO). 없으면 빈 문자열 */
  latest: string
  /** 오늘이면 0 */
  daysAgo: number | null
  state: CollectionState
  missedCalls: { callId: string; completeness: 'failed' | 'partial' | 'best_effort'; reasons: string[] }[]
  callStats?: CallStats
}

/** SaaS별 가장 늦은 수집 시각 */
export function latestCollectedByProvider(graph: GraphStoreV2): Map<string, string> {
  const latest = new Map<string, string>()
  const bump = (provider: string | undefined, at: string | undefined) => {
    if (!provider || !at) return
    if (at > (latest.get(provider) ?? '')) latest.set(provider, at)
  }
  for (const object of graph.objectsByKey.values()) {
    for (const observation of object.canonical.source?.observations ?? []) bump(object.canonical.provider, observation.collected_at)
    bump(object.canonical.provider, object.canonical.source?.collected_at)
  }
  for (const relation of graph.relationsByKey.values()) bump(relation.provider, relation.source?.collected_at)
  return latest
}

/** 수집 기록이 있으면 정상, 7일 넘으면 갱신 지연, 없으면 미수집. 완결성은 상태에 쓰지 않는다. */
export function collectionState(latest: string, now: Date, calls: CoverageCall[] = []): ProviderCollection {
  const days = daysAgo(latest, now)
  let state: CollectionState
  if (!latest) state = 'none'
  else if (days !== null && days > STALE_DAYS) state = 'stale'
  else state = 'ok'

  let fullCount = 0
  let partialCount = 0
  let failedCount = 0
  const missedCalls: ProviderCollection['missedCalls'] = []
  for (const call of calls) {
    if (call.completeness === 'full') {
      fullCount++
    } else if (call.completeness === 'failed') {
      failedCount++
      missedCalls.push({
        callId: call.call_id,
        completeness: call.completeness,
        reasons: call.reasons ?? [],
      })
    } else if (call.completeness === 'partial' || call.completeness === 'best_effort') {
      partialCount++
      missedCalls.push({
        callId: call.call_id,
        completeness: call.completeness,
        reasons: call.reasons ?? [],
      })
    }
  }
  missedCalls.sort((a, b) => {
    const aFail = a.completeness === 'failed' ? 0 : 1
    const bFail = b.completeness === 'failed' ? 0 : 1
    if (aFail !== bFail) return aFail - bFail
    return a.callId.localeCompare(b.callId)
  })

  const callStats: CallStats = {
    total: calls.length,
    full: fullCount,
    partial: partialCount,
    failed: failedCount,
  }

  return { latest, daysAgo: days, state, missedCalls, callStats }
}

/** 「28일 전」, 오늘이면 「오늘」 */
export function daysAgoText(days: number | null): string {
  if (days === null) return ''
  return days === 0 ? '오늘' : `${days}일 전`
}
