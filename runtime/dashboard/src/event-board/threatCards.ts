/**
 * 위협(Finding, Config 항목)을 보드 위협 카드로 변환하고 조회 범위를 계산한다.
 */
import type { FindingV2 } from '../model/findingV2'
import type { Finding as StandardFinding, Item } from '../config-findings/standardResultsStore'
import { MAX_SCOPE_OBJECTS } from '../timeline/timelineAnalysis'
import type { QueryScope, ThreatCard } from './boardModel'

export type { StandardFinding, Item }

/** FindingV2 에서 위협 카드 생성 */
export function threatFromFinding(f: FindingV2, now?: string | number): ThreatCard {
  const createdAt = typeof now === 'number' ? new Date(now).toISOString() : typeof now === 'string' ? now : new Date().toISOString()
  return {
    id: `threat-finding-${f.id}`,
    kind: 'threat',
    source: 'finding',
    refId: f.id,
    title: f.title,
    severity: f.severity,
    objectKeys: [...new Set(f.involvedObjectKeys ?? [])],
    relationKeys: [...new Set(f.involvedRelationKeys ?? [])],
    outsidePeople: [],
    x: 0,
    y: 0,
    createdAt,
  }
}

/** Config 항목에서 위협 카드 생성 (그래프 안 객체만 대상) */
export function threatFromConfigItem(finding: StandardFinding, item: Item, now?: string | number): ThreatCard {
  const createdAt = typeof now === 'number' ? new Date(now).toISOString() : typeof now === 'string' ? now : new Date().toISOString()
  const inGraphKeys = (item.targets ?? []).filter(t => t.in_graph).map(t => t.key)
  return {
    id: `threat-config-${finding.id}:${item.item_id}`,
    kind: 'threat',
    source: 'config',
    refId: `${finding.id}:${item.item_id}`,
    title: item.title,
    severity: undefined,
    objectKeys: [...new Set(inGraphKeys)],
    relationKeys: [],
    outsidePeople: [],
    x: 0,
    y: 0,
    createdAt,
  }
}

const ROUND_MS = 5 * 60_000
const PERIOD_MS = {
  '24h': 86400_000,
  '7d': 7 * 86400_000,
  '30d': 30 * 86400_000,
} as const

const isoSecond = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * 위협 객체에 대한 조회 범위 계산.
 * 객체는 최대 20개까지 포함하고 초과분은 droppedObjects 로 반환한다.
 * 끝 시각은 다음 5분으로 올림 처리한다.
 */
export function scopeFor(
  objectKeys: readonly string[],
  period: '24h' | '7d' | '30d',
  now = Date.now(),
): { scope: QueryScope; droppedObjects: number } {
  const keys = objectKeys.slice(0, MAX_SCOPE_OBJECTS)
  const droppedObjects = Math.max(0, objectKeys.length - MAX_SCOPE_OBJECTS)
  const end = Math.ceil(now / ROUND_MS) * ROUND_MS
  const start = end - PERIOD_MS[period]
  return {
    scope: {
      from: isoSecond(start),
      to: isoSecond(end),
      objectKeys: keys,
    },
    droppedObjects,
  }
}
