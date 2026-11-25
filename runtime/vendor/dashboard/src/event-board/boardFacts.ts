/**
 * 보드 사실 계산 및 요약.
 * 출처 범위와 집계, 표시한 이벤트, 분석가 연결.
 * 판단을 내리지 않고 키 일치 사실과 집계만 다룬다.
 */
import type { TimelineEvent } from '../timeline/timelineAnalysis'
import { BASIS_LABEL, MAX_SCOPE_OBJECTS, type Unmatched } from '../timeline/timelineAnalysis'
import type { BoardWorkspace } from '../assistant/workspace'
import type { BoardV3, SubjectCard, Source } from './boardV3'
import type { BoardV2, EventCard, ObjectCard, QueryCard, ThreatCard, EventSnapshot } from './boardModel'

export interface SystemLink {
  from: string
  to: string
  kind: 'published' | 'same_object' | 'relation' | 'origin'
  label: string
  strength?: 'confirmed' | 'review'
}

/** 카드 사이 사실 선 계산 (게시된 연결, 같은 객체, 위협 관계 일치, 질의 출발) */
export function systemLinks(
  board: BoardV2,
  published: Array<{ from: string; to: string; basis: string; strength?: 'confirmed' | 'review' }> = [],
): SystemLink[] {
  const links: SystemLink[] = []
  const cardById = new Map(board.cards.map(c => [c.id, c]))
  const eventCards = board.cards.filter((c): c is EventCard => c.kind === 'event')
  const eventCardByOriginKey = new Map(eventCards.map(c => [c.event.origin_key, c]))
  const threatCards = board.cards.filter((c): c is ThreatCard => c.kind === 'threat')
  const objectCards = board.cards.filter((c): c is ObjectCard => c.kind === 'object')
  const queryCards = board.cards.filter((c): c is QueryCard => c.kind === 'query')

  // 1. published
  const combinedPublished: Array<{ from: string; to: string; basis: string; strength?: 'confirmed' | 'review' }> = []
  const seenPublished = new Set<string>()
  for (const p of [...published, ...(board.published ?? [])]) {
    const key = `${p.from}|${p.to}|${p.basis}`
    if (!seenPublished.has(key)) {
      seenPublished.add(key)
      combinedPublished.push(p)
    }
  }
  for (const link of combinedPublished) {
    const fromCard = eventCardByOriginKey.get(link.from)
    const toCard = eventCardByOriginKey.get(link.to)
    if (fromCard && toCard && fromCard.id !== toCard.id) {
      links.push({
        from: fromCard.id,
        to: toCard.id,
        kind: 'published',
        label: (BASIS_LABEL as Record<string, string>)[link.basis] ?? link.basis,
        strength: link.strength,
      })
    }
  }

  // 2. same_object
  for (const ec of eventCards) {
    const eventObjKeys = [
      ec.event.actor?.object_key,
      ...ec.event.targets.map(t => t.object_key),
    ].filter((k): k is string => Boolean(k))
    if (!eventObjKeys.length) continue

    for (const oc of objectCards) {
      if (eventObjKeys.includes(oc.objectKey)) {
        links.push({
          from: ec.id,
          to: oc.id,
          kind: 'same_object',
          label: '같은 객체',
        })
      }
    }

    for (const tc of threatCards) {
      if (eventObjKeys.some(k => tc.objectKeys.includes(k))) {
        links.push({
          from: ec.id,
          to: tc.id,
          kind: 'same_object',
          label: '같은 객체',
        })
      }
    }
  }

  // 3. relation
  for (const ec of eventCards) {
    if (!ec.event.relation_matches?.length) continue
    for (const tc of threatCards) {
      const tcRelSet = new Set(tc.relationKeys)
      if (ec.event.relation_matches.some(rm => tcRelSet.has(rm.relation_id))) {
        links.push({
          from: ec.id,
          to: tc.id,
          kind: 'relation',
          label: '위협 관계와 두 끝이 같음',
        })
      }
    }
  }

  // 4. origin
  for (const qc of queryCards) {
    if (qc.originId && cardById.has(qc.originId) && qc.originId !== qc.id) {
      links.push({
        from: qc.originId,
        to: qc.id,
        kind: 'origin',
        label: '질의의 출발',
      })
    }
  }

  return links
}

export interface EventSummaryContext {
  from: string
  to: string
  objectKeys: string[]
  relationKeys: string[]
  outsidePeople: string[]
}

export interface ByTimeBucket {
  start: string
  end: string
  counts: Record<string, number>
  total: number
}

export interface EventSummary {
  total: number
  failures: number
  self: number
  firstSeen: string | null
  lastSeen: string | null
  byTime: {
    unit: 'hour' | 'day'
    stepMs: number
    buckets: ByTimeBucket[]
  }
  actors: Array<{
    key: string
    objectKey: string | null
    label: string
    count: number
    failures: number
    outside: boolean
    unmatched?: Unmatched
  }>
  eventTypes: Array<{
    type: string
    provider: string
    count: number
  }>
  touched: Array<{
    objectKey: string
    asActor: number
    asTarget: number
    first: string | null
    last: string | null
  }>
  relationCoverage: Array<{
    relationId: string
    hits: number
  }>
  relationHits: Array<{
    eventKey: string
    relationIds: string[]
  }>
  unmatched: Record<string, number>
}

/** 이벤트 목록 집계 및 사실 요약 */
export function summarize(events: TimelineEvent[], ctx: EventSummaryContext): EventSummary {
  let failures = 0
  let self = 0
  let firstSeen: string | null = null
  let lastSeen: string | null = null

  for (const e of events) {
    if (e.outcome === 'failure') failures++
    if (e.attributes?.aegi_self === true) self++
    if (e.occurred_at) {
      if (!firstSeen || e.occurred_at < firstSeen) firstSeen = e.occurred_at
      if (!lastSeen || e.occurred_at > lastSeen) lastSeen = e.occurred_at
    }
  }

  // 시간축 버킷 (48시간 이하면 hour, 초과면 day)
  const fromMs = Date.parse(ctx.from)
  const toMs = Date.parse(ctx.to)
  const spanMs = Math.max(0, toMs - fromMs)
  const isHour = spanMs <= 48 * 3600_000
  const unit: 'hour' | 'day' = isHour ? 'hour' : 'day'
  const stepMs = isHour ? 3600_000 : 86400_000

  const KST_OFFSET = 9 * 3600_000
  const startMs = Math.floor((fromMs + KST_OFFSET) / stepMs) * stepMs - KST_OFFSET
  const numBuckets = Math.max(1, Math.ceil((toMs - startMs) / stepMs))

  const buckets: ByTimeBucket[] = []
  for (let i = 0; i < numBuckets; i++) {
    const bStart = startMs + i * stepMs
    const bEnd = bStart + stepMs
    buckets.push({
      start: new Date(bStart).toISOString(),
      end: new Date(bEnd).toISOString(),
      counts: {},
      total: 0,
    })
  }

  for (const e of events) {
    if (!e.occurred_at) continue
    const t = Date.parse(e.occurred_at)
    if (Number.isNaN(t) || t < startMs || t >= startMs + numBuckets * stepMs) continue
    const idx = Math.floor((t - startMs) / stepMs)
    if (idx >= 0 && idx < buckets.length) {
      const b = buckets[idx]!
      b.counts[e.provider] = (b.counts[e.provider] ?? 0) + 1
      b.total++
    }
  }

  // 행위자 순위 (상위 20)
  const actorMap = new Map<string, { key: string; objectKey: string | null; label: string; count: number; failures: number; outside: boolean; unmatched?: Unmatched }>()
  for (const e of events) {
    if (!e.actor) continue
    const key = e.actor.object_key ?? `native:${e.actor.native_id}`
    const item = actorMap.get(key)
    if (!item) {
      const objKey = e.actor.object_key ?? null
      const label = e.actor.display || e.actor.native_id || e.actor.object_key || '미확인'
      const outside = Boolean(
        (objKey && ctx.outsidePeople.includes(objKey)) ||
        (e.actor.native_id && ctx.outsidePeople.includes(e.actor.native_id)),
      )
      const newItem = { key, objectKey: objKey, label, count: 1, failures: e.outcome === 'failure' ? 1 : 0, outside, unmatched: e.actor.unmatched }
      actorMap.set(key, newItem)
    } else {
      item.count++
      if (e.outcome === 'failure') item.failures++
      if (!item.unmatched && e.actor.unmatched) {
        item.unmatched = e.actor.unmatched
      }
    }
  }
  const actors = [...actorMap.values()]
    .sort((a, b) => b.count - a.count || b.failures - a.failures || a.key.localeCompare(b.key))
    .slice(0, 20)

  // 이벤트 종류 순위 (상위 20)
  const typeMap = new Map<string, { type: string; provider: string; count: number }>()
  for (const e of events) {
    const compound = `${e.provider}:${e.event_type}`
    let item = typeMap.get(compound)
    if (!item) {
      item = { type: e.event_type, provider: e.provider, count: 0 }
      typeMap.set(compound, item)
    }
    item.count++
  }
  const eventTypes = [...typeMap.values()]
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    .slice(0, 20)

  // 위협 객체 건드림 (0건 포함)
  const touched = ctx.objectKeys.map(objectKey => {
    let asActor = 0
    let asTarget = 0
    let first: string | null = null
    let last: string | null = null

    for (const e of events) {
      const isActor = e.actor?.object_key === objectKey
      const isTarget = e.targets.some(t => t.object_key === objectKey)
      if (isActor) asActor++
      if (isTarget) asTarget++
      if (isActor || isTarget) {
        if (e.occurred_at) {
          if (!first || e.occurred_at < first) first = e.occurred_at
          if (!last || e.occurred_at > last) last = e.occurred_at
        }
      }
    }
    return { objectKey, asActor, asTarget, first, last }
  })

  // 위협 관계 일치 및 전수 도달 집계
  const relationCoverage = ctx.relationKeys.map(relationId => {
    let hits = 0
    for (const e of events) {
      if (e.relation_matches?.some(rm => rm.relation_id === relationId)) hits++
    }
    return { relationId, hits }
  })
  const relationHits: Array<{ eventKey: string; relationIds: string[] }> = []
  const relationKeySet = new Set(ctx.relationKeys)
  if (relationKeySet.size > 0) {
    for (const e of events) {
      if (!e.relation_matches?.length) continue
      const hits = [...new Set(e.relation_matches
        .filter(rm => relationKeySet.has(rm.relation_id))
        .map(rm => rm.relation_id))]
      if (hits.length > 0) {
        relationHits.push({ eventKey: e.origin_key, relationIds: hits })
      }
    }
  }

  // 못 찾은 사유별 집계
  const unmatched: Record<string, number> = {
    not_in_graph: 0,
    ambiguous: 0,
    name_only: 0,
  }
  for (const e of events) {
    if (e.actor?.unmatched) {
      unmatched[e.actor.unmatched] = (unmatched[e.actor.unmatched] ?? 0) + 1
    }
    for (const t of e.targets) {
      if (t.unmatched) {
        unmatched[t.unmatched] = (unmatched[t.unmatched] ?? 0) + 1
      }
    }
  }

  return {
    total: events.length,
    failures,
    self,
    firstSeen,
    lastSeen,
    byTime: {
      unit,
      stepMs,
      buckets,
    },
    actors,
    eventTypes,
    touched,
    relationHits,
    relationCoverage,
    unmatched,
  }
}

export interface QueryCandidate {
  id: string
  kind: 'threat_objects' | 'outside_person' | 'pinned_event_object' | 'object_card' | 'neighbor_rest'
  objectKeys: string[]
  sourceCardId: string
}

export function nextQueryCandidates(board: BoardV3, boardEvents: TimelineEvent[] = []): QueryCandidate[] {
  const covered = new Set<string>()
  for (const s of board.sources) {
    if (s.kind === 'query') {
      for (const k of s.scope.objectKeys) {
        if (k) covered.add(k)
      }
    }
  }

  const rawCandidates: QueryCandidate[] = []

  // 1. 위협 객체 & 정상 밖 사람
  for (const s of board.subjects) {
    if (s.kind === 'threat') {
      const uncovered = s.objectKeys.filter(k => k && !covered.has(k))
      if (uncovered.length > 0) {
        const slice = uncovered.slice(0, MAX_SCOPE_OBJECTS)
        rawCandidates.push({
          id: `threat_objects:${s.id}:${slice[0]}`,
          kind: 'threat_objects',
          objectKeys: slice,
          sourceCardId: s.id,
        })
      }
      for (const k of s.outsidePeople) {
        if (k && !covered.has(k)) {
          rawCandidates.push({
            id: `outside_person:${s.id}:${k}`,
            kind: 'outside_person',
            objectKeys: [k],
            sourceCardId: s.id,
          })
        }
      }
    }
  }

  // 2. 이벤트 행위자 / 대상 객체
  const allEvents: Array<EventSnapshot | TimelineEvent> = [
    ...Object.values(board.marked),
    ...boardEvents,
  ]
  for (const ev of allEvents) {
    const actorKey = ev.actor?.object_key
    if (actorKey && !covered.has(actorKey)) {
      rawCandidates.push({
        id: `pinned_event_object:${ev.origin_key}:${actorKey}`,
        kind: 'pinned_event_object',
        objectKeys: [actorKey],
        sourceCardId: ev.origin_key,
      })
    }
    for (const t of ev.targets) {
      if (t.object_key && !covered.has(t.object_key)) {
        rawCandidates.push({
          id: `pinned_event_object:${ev.origin_key}:${t.object_key}`,
          kind: 'pinned_event_object',
          objectKeys: [t.object_key],
          sourceCardId: ev.origin_key,
        })
      }
    }
  }

  // 3. 단독 객체 카드
  for (const s of board.subjects) {
    if (s.kind === 'object') {
      if (s.objectKey && !covered.has(s.objectKey)) {
        rawCandidates.push({
          id: `object_card:${s.id}:${s.objectKey}`,
          kind: 'object_card',
          objectKeys: [s.objectKey],
          sourceCardId: s.id,
        })
      }
    }
  }

  // 4. 이웃 질의에서 상한으로 빠진 객체
  for (const s of board.sources) {
    if (s.kind === 'query' && s.neighbors && Array.isArray(s.neighbors.dropped) && s.neighbors.dropped.length > 0) {
      const uncovered = s.neighbors.dropped.filter(k => k && !covered.has(k))
      if (uncovered.length > 0) {
        const slice = uncovered.slice(0, MAX_SCOPE_OBJECTS)
        rawCandidates.push({
          id: `neighbor_rest:${s.id}:${slice[0]}`,
          kind: 'neighbor_rest',
          objectKeys: slice,
          sourceCardId: s.id,
        })
      }
    }
  }

  // 중복 제거 (정렬된 objectKeys 시그니처 기준)
  const seenSignatures = new Set<string>()
  const deduped: QueryCandidate[] = []
  for (const cand of rawCandidates) {
    if (!cand.objectKeys.length) continue
    const sig = cand.objectKeys.slice().sort().join('\0')
    if (seenSignatures.has(sig)) continue
    seenSignatures.add(sig)
    deduped.push(cand)
    if (deduped.length >= 12) break
  }

  return deduped
}

export function boardWorkspace(board: BoardV3, candidates: QueryCandidate[] = []): BoardWorkspace {
  const querySources = board.sources.filter((s): s is Extract<Source, { kind: 'query' }> => s.kind === 'query')
  const threatSubjects = board.subjects.filter((s): s is Extract<SubjectCard, { kind: 'threat' }> => s.kind === 'threat')
  const objectSubjects = board.subjects.filter((s): s is Extract<SubjectCard, { kind: 'object' }> => s.kind === 'object')
  const noteSubjects = board.subjects.filter((s): s is Extract<SubjectCard, { kind: 'note' }> => s.kind === 'note')

  const validKey = (k: string) => typeof k === 'string' && k.trim().length > 0 && k.length <= 512

  const threats = threatSubjects.slice(0, 6).map(t => ({
    source: t.source,
    refId: (t.refId ?? '').slice(0, 512),
    title: (t.title ?? '').slice(0, 120),
    objectKeys: (t.objectKeys ?? []).filter(validKey).slice(0, 20),
    relationKeys: (t.relationKeys ?? []).filter(validKey).slice(0, 20),
    outsidePeople: (t.outsidePeople ?? []).filter(validKey).slice(0, 20),
  }))

  const queries = querySources.slice(0, 8).map(q => ({
    from: q.scope.from.slice(0, 512),
    to: q.scope.to.slice(0, 512),
    objectKeys: q.scope.objectKeys.filter(validKey).slice(0, 20),
    providers: (q.scope.providers ?? []).map(p => p.slice(0, 512)).slice(0, 20),
  }))

  const pinnedEvents = Object.keys(board.marked).filter(validKey).slice(0, 40)
  const pinnedObjects = objectSubjects.map(s => s.objectKey).filter(validKey).slice(0, 40)

  const links: Array<{ from: string; to: string; note: string }> = []
  for (const l of board.userLinks) {
    links.push({
      from: l.from.slice(0, 512),
      to: l.to.slice(0, 512),
      note: l.note.slice(0, 300),
    })
  }
  const slicedLinks = links.slice(0, 30)

  const notes = noteSubjects.map(n => n.text.slice(0, 500)).slice(0, 10)

  const candidateList = candidates.slice(0, 12).map(c => ({
    kind: c.kind.slice(0, 512),
    objectKeys: c.objectKeys.filter(validKey).slice(0, 20),
  }))

  const bw: BoardWorkspace = {
    title: board.title.slice(0, 120),
    threats,
    queries,
    pinnedEvents,
    pinnedObjects,
    links: slicedLinks,
    notes,
    candidates: candidateList,
  }

  while (JSON.stringify(bw).length > 30_000 && bw.pinnedEvents.length > 5) {
    bw.pinnedEvents.pop()
  }
  while (JSON.stringify(bw).length > 30_000 && bw.pinnedObjects.length > 5) {
    bw.pinnedObjects.pop()
  }
  while (JSON.stringify(bw).length > 30_000 && bw.links.length > 5) {
    bw.links.pop()
  }
  while (JSON.stringify(bw).length > 30_000 && bw.notes.length > 1) {
    bw.notes.pop()
  }
  for (let keep = 10; JSON.stringify(bw).length > 30_000 && keep >= 0; keep -= 5) {
    for (const t of bw.threats) { t.objectKeys = t.objectKeys.slice(0, keep); t.relationKeys = t.relationKeys.slice(0, keep); t.outsidePeople = t.outsidePeople.slice(0, keep) }
    for (const q of bw.queries) q.objectKeys = q.objectKeys.slice(0, keep)
    bw.candidates = bw.candidates.slice(0, keep)
  }

  return bw
}
