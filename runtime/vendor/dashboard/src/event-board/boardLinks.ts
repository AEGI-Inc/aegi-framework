/**
 * Event Board 이벤트 연결선 계산.
 * 행위자 일치, 대상→행위자 사슬, 대상 일치, 엔진 연결, 원본 원인, 분석가 연결 계산 및 흐름 탐색.
 */
import type { TimelineEvent, EventLink } from '../timeline/timelineAnalysis'
import type { UserLink } from './boardModel'
import type { LinkKind } from './boardV3'

export const LINK_KIND_LABELS: Record<LinkKind, string> = {
  same_actor: '같은 행위자',
  target_to_actor: '대상이 다음 행위자',
  actor_to_target: '행위자가 다음 대상',
  same_target: '같은 대상',
  same_person: '동일인 다른 계정',
  session_ip_cause: '세션, IP, 원본 원인',
  graph_relation: '그래프 관계',
  analyst: '분석가 연결',
}
export interface BoardLink {
  id: string
  from: string
  to: string
  kind: LinkKind
  source: 'board' | 'engine' | 'analyst' | 'raw'
  objectKey?: string
  basis?: string
  strength?: 'confirmed' | 'review'
  note?: string
  extraCount?: number
}

/**
 * 보드 내 이벤트 연결선 추적용 식별자.
 * 그래프 객체 키가 있으면 우선 사용하고, 미매칭 엔티티(object_key=null)도
 * 이메일 주소(대소문자 무시, SaaS 간 동일 계정 연결) 또는 공급자 내 native_id 로 이어 준다.
 */
function entityTrackKey(ref: TimelineEvent['actor'], provider: string): string | undefined {
  if (!ref) return undefined
  if (ref.object_key) return ref.object_key
  const emailCandidate = ref.display?.includes('@') ? ref.display : ref.native_id?.includes('@') ? ref.native_id : undefined
  if (emailCandidate) return `email:${emailCandidate.trim().toLowerCase()}`
  if (ref.native_id) return `native:${provider}:${ref.native_id}`
  return undefined
}

/** 타임라인 보드에 표시할 이벤트 연결선 계산 */
export function boardLinks(
  events: TimelineEvent[],
  engineLinks: EventLink[],
  userLinks: UserLink[],
  kinds: LinkKind[],
): BoardLink[] {
  const allowedKinds = new Set(kinds)

  // 발생 시각이 유효한 이벤트만 맵과 정렬 목록에 포함
  const eventMap = new Map<string, TimelineEvent>()
  const eventTimes = new Map<string, number>()
  const timedEvents: TimelineEvent[] = []

  for (const e of events) {
    if (!e.occurred_at) continue
    const t = Date.parse(e.occurred_at)
    if (!Number.isNaN(t)) {
      eventMap.set(e.origin_key, e)
      eventTimes.set(e.origin_key, t)
      timedEvents.push(e)
    }
  }

  timedEvents.sort((a, b) => {
    const ta = eventTimes.get(a.origin_key)!
    const tb = eventTimes.get(b.origin_key)!
    return ta - tb || a.origin_key.localeCompare(b.origin_key)
  })

  const rawCandidates: BoardLink[] = []

  // 객체 키 기반 보드 추적 맵
  const lastEventByActor = new Map<string, TimelineEvent>()
  const lastEventByTarget = new Map<string, TimelineEvent>()

  for (const e of timedEvents) {
    const actorKey = entityTrackKey(e.actor, e.provider)

    // 1. same_actor: 같은 행위자 직전 이벤트
    if (actorKey) {
      const prev = lastEventByActor.get(actorKey)
      if (prev && prev.origin_key !== e.origin_key) {
        rawCandidates.push({
          id: `board:same_actor:${prev.origin_key}:${e.origin_key}`,
          from: prev.origin_key,
          to: e.origin_key,
          kind: 'same_actor',
          source: 'board',
          objectKey: actorKey,
        })
      }
    }

    // 2. target_to_actor: 대상이 다음 행위자가 된 직전 이벤트
    if (actorKey) {
      const prev = lastEventByTarget.get(actorKey)
      if (prev && prev.origin_key !== e.origin_key) {
        rawCandidates.push({
          id: `board:target_to_actor:${prev.origin_key}:${e.origin_key}`,
          from: prev.origin_key,
          to: e.origin_key,
          kind: 'target_to_actor',
          source: 'board',
          objectKey: actorKey,
        })
      }
    }

    // 2-1. actor_to_target: 앞 이벤트의 행위자가 뒤 이벤트의 대상 (가장 최근 것 하나)
    let bestActorToTargetPrev: TimelineEvent | null = null
    let bestActorToTargetKey: string | undefined
    let bestActorToTargetTime = -Infinity

    for (const tgt of e.targets) {
      const tgtKey = entityTrackKey(tgt, e.provider)
      if (!tgtKey) continue
      const prev = lastEventByActor.get(tgtKey)
      if (prev && prev.origin_key !== e.origin_key) {
        const prevT = eventTimes.get(prev.origin_key)!
        if (prevT > bestActorToTargetTime || (prevT === bestActorToTargetTime && prev.origin_key.localeCompare(bestActorToTargetPrev?.origin_key ?? '') > 0)) {
          bestActorToTargetTime = prevT
          bestActorToTargetPrev = prev
          bestActorToTargetKey = tgtKey
        }
      }
    }

    if (bestActorToTargetPrev && bestActorToTargetKey) {
      rawCandidates.push({
        id: `board:actor_to_target:${bestActorToTargetPrev.origin_key}:${e.origin_key}`,
        from: bestActorToTargetPrev.origin_key,
        to: e.origin_key,
        kind: 'actor_to_target',
        source: 'board',
        objectKey: bestActorToTargetKey,
      })
    }

    // 3. same_target: 같은 대상을 가진 직전 이벤트 (가장 최근 것 하나)
    let bestTargetPrev: TimelineEvent | null = null
    let bestTargetKey: string | undefined
    let bestTargetTime = -Infinity

    for (const tgt of e.targets) {
      const tgtKey = entityTrackKey(tgt, e.provider)
      if (!tgtKey) continue
      const prev = lastEventByTarget.get(tgtKey)
      if (prev && prev.origin_key !== e.origin_key) {
        const prevT = eventTimes.get(prev.origin_key)!
        if (prevT > bestTargetTime || (prevT === bestTargetTime && prev.origin_key.localeCompare(bestTargetPrev?.origin_key ?? '') > 0)) {
          bestTargetTime = prevT
          bestTargetPrev = prev
          bestTargetKey = tgtKey
        }
      }
    }

    if (bestTargetPrev && bestTargetKey) {
      rawCandidates.push({
        id: `board:same_target:${bestTargetPrev.origin_key}:${e.origin_key}`,
        from: bestTargetPrev.origin_key,
        to: e.origin_key,
        kind: 'same_target',
        source: 'board',
        objectKey: bestTargetKey,
      })
    }

    // 4. raw cause: correlation.caused_by 의 객체 키와 행위자가 일치하는 직전 이벤트
    let bestCausePrev: TimelineEvent | null = null
    let bestCauseKey: string | undefined
    let bestCauseTime = -Infinity

    for (const c of e.correlation?.caused_by ?? []) {
      const cKey = entityTrackKey(c, e.provider)
      if (!cKey) continue
      const prev = lastEventByActor.get(cKey)
      if (prev && prev.origin_key !== e.origin_key) {
        const prevT = eventTimes.get(prev.origin_key)!
        if (prevT > bestCauseTime || (prevT === bestCauseTime && prev.origin_key.localeCompare(bestCausePrev?.origin_key ?? '') > 0)) {
          bestCauseTime = prevT
          bestCausePrev = prev
          bestCauseKey = cKey
        }
      }
    }

    if (bestCausePrev && bestCauseKey) {
      rawCandidates.push({
        id: `raw:session_ip_cause:${bestCausePrev.origin_key}:${e.origin_key}`,
        from: bestCausePrev.origin_key,
        to: e.origin_key,
        kind: 'session_ip_cause',
        source: 'raw',
        objectKey: bestCauseKey,
        basis: 'caused_by',
      })
    }

    // 다음 이벤트를 위해 맵 갱신
    if (actorKey) {
      lastEventByActor.set(actorKey, e)
    }
    for (const tgt of e.targets) {
      const tgtKey = entityTrackKey(tgt, e.provider)
      if (tgtKey) {
        lastEventByTarget.set(tgtKey, e)
      }
    }
  }

  // 5. 엔진 연결
  for (const el of engineLinks) {
    const fromEv = eventMap.get(el.from)
    const toEv = eventMap.get(el.to)
    if (!fromEv || !toEv) continue

    const tFrom = eventTimes.get(el.from)!
    const tTo = eventTimes.get(el.to)!

    let earlierKey = el.from
    let laterKey = el.to
    let earlierEv = fromEv
    let laterEv = toEv

    if (tFrom > tTo || (tFrom === tTo && el.from.localeCompare(el.to) > 0)) {
      earlierKey = el.to
      laterKey = el.from
      earlierEv = toEv
      laterEv = fromEv
    }

    let kind: LinkKind | null = null
    if (el.basis === 'same_person_time' || el.basis === 'same_person_ip') {
      kind = 'same_person'
    } else if (el.basis === 'session' || el.basis === 'caused_by' || el.basis === 'sso_handoff') {
      kind = 'session_ip_cause'
    } else if (el.basis === 'graph_relation') {
      kind = 'graph_relation'
    } else if (el.basis === 'shared_object') {
      const viaObj = el.via?.objects?.[0]
      const isFromActor = Boolean(viaObj && earlierEv.actor?.object_key === viaObj)
      const isToActor = Boolean(viaObj && laterEv.actor?.object_key === viaObj)
      const isFromTarget = Boolean(viaObj && earlierEv.targets.some(t => t.object_key === viaObj))
      const isToTarget = Boolean(viaObj && laterEv.targets.some(t => t.object_key === viaObj))

      if (isFromActor && isToActor) {
        kind = 'same_actor'
      } else if (isFromTarget && isToActor) {
        kind = 'target_to_actor'
      } else if (isFromActor && isToTarget) {
        kind = 'actor_to_target'
      } else {
        kind = 'same_target'
      }
    }

    if (!kind) continue

    rawCandidates.push({
      id: el.id || `engine:${earlierKey}:${laterKey}:${kind}`,
      from: earlierKey,
      to: laterKey,
      kind,
      source: 'engine',
      objectKey: el.via?.objects?.[0],
      basis: el.basis,
      strength: el.strength,
    })
  }

  // kinds 필터 적용
  const filteredCandidates = rawCandidates.filter(c => allowedKinds.has(c.kind))

  // 중복 정리: (from, to, kind) 당 하나 유지 (engine > board > raw)
  const sourceRank = (s: BoardLink['source']): number => {
    if (s === 'engine') return 3
    if (s === 'board') return 2
    return 1
  }

  const byPairAndKind = new Map<string, BoardLink>()
  for (const c of filteredCandidates) {
    const key = `${c.from}|${c.to}|${c.kind}`
    const existing = byPairAndKind.get(key)
    if (!existing || sourceRank(c.source) > sourceRank(existing.source)) {
      byPairAndKind.set(key, c)
    }
  }

  // (to, kind) 당 가장 가까운 from(시각이 가장 늦은 것)만 유지하고 나머지는 extraCount 에 합산
  const byToAndKind = new Map<string, BoardLink[]>()
  for (const c of byPairAndKind.values()) {
    const key = `${c.to}|${c.kind}`
    let list = byToAndKind.get(key)
    if (!list) {
      list = []
      byToAndKind.set(key, list)
    }
    list.push(c)
  }

  const result: BoardLink[] = []

  for (const candidates of byToAndKind.values()) {
    candidates.sort((a, b) => {
      const ta = eventTimes.get(a.from) ?? 0
      const tb = eventTimes.get(b.from) ?? 0
      return tb - ta || a.from.localeCompare(b.from)
    })

    const kept = { ...candidates[0]! }
    if (candidates.length > 1) {
      kept.extraCount = candidates.length - 1
    }
    result.push(kept)
  }

  // 6. 분석가 연결 (userLinks)
  if (allowedKinds.has('analyst')) {
    for (const ul of userLinks) {
      const fromEv = eventMap.get(ul.from)
      const toEv = eventMap.get(ul.to)
      if (!fromEv || !toEv) continue

      const tFrom = eventTimes.get(ul.from)!
      const tTo = eventTimes.get(ul.to)!

      const [earlier, later] = (tFrom <= tTo) ? [ul.from, ul.to] : [ul.to, ul.from]

      result.push({
        id: ul.id,
        from: earlier,
        to: later,
        kind: 'analyst',
        source: 'analyst',
        note: ul.note,
      })
    }
  }

  // 결과 정렬 (시작 시각, 끝 시각, 종류)
  result.sort((a, b) => {
    const taFrom = eventTimes.get(a.from) ?? 0
    const tbFrom = eventTimes.get(b.from) ?? 0
    if (taFrom !== tbFrom) return taFrom - tbFrom
    const taTo = eventTimes.get(a.to) ?? 0
    const tbTo = eventTimes.get(b.to) ?? 0
    if (taTo !== tbTo) return taTo - tbTo
    return a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)
  })

  return result
}

/** 시작 이벤트로부터 양방향 연결선을 따라 도달 가능한 모든 이벤트 키 탐색 */
export function flowOf(start: string, links: BoardLink[]): Set<string> {
  const adj = new Map<string, string[]>()

  for (const l of links) {
    let fromList = adj.get(l.from)
    if (!fromList) {
      fromList = []
      adj.set(l.from, fromList)
    }
    fromList.push(l.to)

    let toList = adj.get(l.to)
    if (!toList) {
      toList = []
      adj.set(l.to, toList)
    }
    toList.push(l.from)
  }

  const visited = new Set<string>()
  const queue = [start]
  visited.add(start)

  while (queue.length > 0) {
    const cur = queue.shift()!
    const neighbors = adj.get(cur)
    if (!neighbors) continue
    for (const n of neighbors) {
      if (!visited.has(n)) {
        visited.add(n)
        queue.push(n)
      }
    }
  }

  return visited
}


/**
 * 두 배치 영역 사이를 잇는 꺾은선(직교) SVG 경로 계산.
 * x2 - x1 >= 24 이면 중간 세로선, 그렇지 않으면 우회 꺾은선을 생성한다.
 */
export function linkPath(
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number },
): { d: string; labelX: number; labelY: number } {
  const x1 = from.x + from.w
  const y1 = from.y + from.h / 2
  const x2 = to.x
  const y2 = to.y + to.h / 2

  if (x2 - x1 >= 24) {
    const midX = (x1 + x2) / 2
    const d = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`
    return {
      d,
      labelX: midX,
      labelY: (y1 + y2) / 2,
    }
  }

  const ym = (y1 + y2) / 2
  const d = `M ${x1} ${y1} H ${x1 + 12} V ${ym} H ${x2 - 12} V ${y2} H ${x2}`
  return {
    d,
    labelX: (x1 + x2) / 2,
    labelY: ym,
  }
}
