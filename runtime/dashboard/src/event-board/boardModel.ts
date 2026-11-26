/**
 * Event Board 데이터 모델 (v2).
 * 위협, 질의, 핀한 이벤트, 객체, 메모 카드를 담고 순수 함수로 상태를 갱신한다.
 */
import type { EntityRef, EventCategory, RelationMatch, TimelineEvent, Unmatched } from '../timeline/timelineAnalysis'
import type { AssistantEventGraph, AssistantEventNode, AssistantEvidence } from '../assistant/types'
import type { PathStep } from './graphNeighbors'

export type CardKind = 'threat' | 'query' | 'event' | 'object' | 'note'

export interface CardBase {
  id: string
  kind: CardKind
  x: number
  y: number
  createdAt: string
}

/** gap 은 옛 다리 단위 Access Gap 카드. 새로 만들지 않고 저장된 보드를 그대로 읽으려고 둔다 */
export type ThreatSource = 'finding' | 'gap' | 'config'

export interface ThreatCard extends CardBase {
  kind: 'threat'
  source: ThreatSource
  refId: string
  title: string
  severity?: string
  objectKeys: string[]
  relationKeys: string[]
  outsidePeople: string[] // Access Gap 의 정상 대상 밖 사람 계정 키
}

export interface QueryScope {
  from: string
  to: string
  objectKeys: string[]
  providers?: string[]
}

export interface QueryNeighbors {
  seeds: string[]
  hops: 1 | 2
  relationTypes: string[]
  anchorAt?: string
  anchorEvent?: string
  paths: Record<string, PathStep[]>
  dropped: string[]
}

export interface QueryCard extends CardBase {
  kind: 'query'
  title: string
  scope: QueryScope
  droppedObjects: number
  originId?: string
  view: 'time' | 'actors' | 'types' | 'objects' | 'list' | 'path'
  neighbors?: QueryNeighbors
}

export interface EventSnapshot {
  origin_key: string
  provider: string
  event_type: string
  title: string
  occurred_at: string | null
  outcome: string
  actor: EntityRef | null
  targets: EntityRef[]
  relation_matches?: RelationMatch[]
  aegi_self?: boolean
  category?: EventCategory
  correlation?: { session_id: string | null; transaction_id: string | null; client_ip: string | null }
}

export interface EventCard extends CardBase {
  kind: 'event'
  event: EventSnapshot
}

export interface ObjectCard extends CardBase {
  kind: 'object'
  objectKey: string
  label: string
}

export interface NoteCard extends CardBase {
  kind: 'note'
  text: string
}

export type Card = ThreatCard | QueryCard | EventCard | ObjectCard | NoteCard

export interface UserLink {
  id: string
  from: string
  to: string
  note: string
}

export interface BoardPublishedLink {
  from: string
  to: string
  basis: string
  strength: 'confirmed' | 'review'
}

export interface BoardV2 {
  version: 2
  id?: string
  title: string
  cards: Card[]
  links: UserLink[]
  published?: BoardPublishedLink[]
  createdAt: string
  updatedAt: string
}

export type CardInput =
  | Card
  | (Omit<ThreatCard, 'id' | 'createdAt' | 'x' | 'y'> & { id?: string; createdAt?: string; x?: number; y?: number })
  | (Omit<QueryCard, 'id' | 'createdAt' | 'x' | 'y'> & { id?: string; createdAt?: string; x?: number; y?: number })
  | (Omit<EventCard, 'id' | 'createdAt' | 'x' | 'y'> & { id?: string; createdAt?: string; x?: number; y?: number })
  | (Omit<ObjectCard, 'id' | 'createdAt' | 'x' | 'y'> & { id?: string; createdAt?: string; x?: number; y?: number })
  | (Omit<NoteCard, 'id' | 'createdAt' | 'x' | 'y'> & { id?: string; createdAt?: string; x?: number; y?: number })

export const CARD_WIDTH = 280
export const CARD_HEIGHT = 200
export const GRID_GAP_X = 20
export const GRID_GAP_Y = 20
export const GRID_COLS = 3

/** 겹치지 않는 격자 위치 계산 (카드 폭 280, 높이 200) */
export function nextPosition(board: { cards: Array<{ x: number; y: number }> }): { x: number; y: number } {
  const strideX = CARD_WIDTH + GRID_GAP_X
  const strideY = CARD_HEIGHT + GRID_GAP_Y
  for (let i = 0; ; i++) {
    const col = i % GRID_COLS
    const row = Math.floor(i / GRID_COLS)
    const x = col * strideX + GRID_GAP_X
    const y = row * strideY + GRID_GAP_Y
    const overlaps = board.cards.some(c => Math.abs(c.x - x) < CARD_WIDTH && Math.abs(c.y - y) < CARD_HEIGHT)
    if (!overlaps) return { x, y }
  }
}

/** 새 보드 생성 */
export function newBoard(title = '새 이벤트 조사', now?: string | number): BoardV2 {
  const time = typeof now === 'number' ? new Date(now).toISOString() : typeof now === 'string' ? now : new Date().toISOString()
  return {
    version: 2,
    title,
    cards: [],
    links: [],
    createdAt: time,
    updatedAt: time,
  }
}

/** 카드 추가. 같은 것이 있으면 넣지 않고 기존 카드 id 반환 */
export function addCard(board: BoardV2, card: CardInput): { board: BoardV2; id: string } {
  if (card.kind === 'event') {
    const existing = board.cards.find(c => c.kind === 'event' && c.event.origin_key === card.event.origin_key)
    if (existing) return { board, id: existing.id }
  } else if (card.kind === 'object') {
    const existing = board.cards.find(c => c.kind === 'object' && c.objectKey === card.objectKey)
    if (existing) return { board, id: existing.id }
  } else if (card.kind === 'threat') {
    const existing = board.cards.find(c => c.kind === 'threat' && c.source === card.source && c.refId === card.refId)
    if (existing) return { board, id: existing.id }
  }

  const pos = (typeof card.x === 'number' && typeof card.y === 'number')
    ? { x: card.x, y: card.y }
    : nextPosition(board)
  const id = card.id || `card-${card.kind}-${board.cards.length + 1}-${Math.random().toString(36).slice(2, 8)}`
  const createdAt = card.createdAt || new Date().toISOString()
  const created: Card = {
    ...card,
    id,
    x: pos.x,
    y: pos.y,
    createdAt,
  } as Card

  return {
    board: {
      ...board,
      cards: [...board.cards, created],
      updatedAt: createdAt,
    },
    id,
  }
}

/** TimelineEvent 를 화면용 작은 사본으로 변환 */
export function toEventSnapshot(e: TimelineEvent): EventSnapshot {
  return {
    origin_key: e.origin_key,
    provider: e.provider,
    event_type: e.event_type,
    title: e.title,
    occurred_at: e.occurred_at,
    outcome: e.outcome,
    actor: e.actor,
    targets: e.targets,
    relation_matches: e.relation_matches,
    aegi_self: Boolean(e.attributes?.aegi_self),
    ...(e.category ? { category: e.category } : {}),
    ...(e.correlation ? { correlation: e.correlation } : {}),
  }
}

const UNMATCHED_VALUES = new Set<Unmatched>(['not_in_graph', 'ambiguous', 'name_only'])

function entityRefFromFact(raw: unknown): EntityRef | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const objectKey = typeof r.objectKey === 'string' ? r.objectKey : null
  const display = typeof r.display === 'string' ? r.display : null
  const nativeId = typeof r.nativeId === 'string' ? r.nativeId : (objectKey ?? display ?? '')
  const type = typeof r.type === 'string' ? r.type : 'unknown'
  const matched = r.matchedOn && typeof r.matchedOn === 'object' ? r.matchedOn as Record<string, unknown> : null
  const matched_on = matched
    && typeof matched.eventField === 'string'
    && typeof matched.identifier === 'string'
    && (matched.same === 'exact' || matched.same === 'casefold')
    ? { event_field: matched.eventField, identifier: matched.identifier, same: matched.same as 'exact' | 'casefold' }
    : undefined
  const unmatched = typeof r.unmatched === 'string' && UNMATCHED_VALUES.has(r.unmatched as Unmatched)
    ? r.unmatched as Unmatched
    : undefined
  if (!nativeId && !objectKey && !display) return null
  return {
    native_id: nativeId,
    type,
    display,
    object_key: objectKey,
    ...(matched_on ? { matched_on } : {}),
    ...(unmatched ? { unmatched } : {}),
  }
}

/** Assistant 노드를 화면용 작은 사본으로 변환 (근거가 있으면 미매칭 행위자/대상 이름도 보존) */
export function snapshotFromAssistantNode(node: AssistantEventNode, evidence?: readonly AssistantEvidence[]): EventSnapshot {
  const ev = evidence?.find(e => e.kind === 'event' && (node.evidenceIds.includes(e.id) || e.ref === node.key))
  const data = ev?.data && typeof ev.data === 'object' ? ev.data as Record<string, unknown> : undefined
  const dataActor = data ? entityRefFromFact(data.actor) : null
  const dataTargets = data && Array.isArray(data.targets)
    ? data.targets.map(entityRefFromFact).filter((t): t is EntityRef => Boolean(t))
    : []
  const actor = node.participants.find(p => p.role === 'actor')
  const targets = node.participants.filter(p => p.role === 'target')
  const fallbackActor: EntityRef | null = actor ? { native_id: actor.objectKey, type: 'unknown', display: null, object_key: actor.objectKey } : null
  const fallbackTargets: EntityRef[] = targets.map(p => ({ native_id: p.objectKey, type: 'unknown', display: null, object_key: p.objectKey }))
  const corr = data?.correlation && typeof data.correlation === 'object' ? data.correlation as Record<string, unknown> : null
  const category = typeof data?.category === 'string' && ['auth', 'admin', 'membership', 'policy', 'token', 'data', 'mail', 'other'].includes(data.category)
    ? data.category as EventCategory
    : undefined

  return {
    origin_key: node.key,
    provider: node.provider,
    event_type: typeof data?.eventType === 'string' ? data.eventType : node.label,
    title: node.label,
    occurred_at: node.occurredAt,
    outcome: node.outcome,
    actor: dataActor ?? fallbackActor,
    targets: dataTargets.length > 0 ? dataTargets : fallbackTargets,
    relation_matches: undefined,
    aegi_self: data?.aegiSelf === true,
    ...(category ? { category } : {}),
    ...(corr ? {
      correlation: {
        session_id: typeof corr.sessionId === 'string' ? corr.sessionId : null,
        transaction_id: typeof corr.transactionId === 'string' ? corr.transactionId : null,
        client_ip: typeof corr.clientIp === 'string' ? corr.clientIp : null,
      },
    } : {}),
  }
}

/**
 * AI 결과와 표시한 이벤트는 요약만 저장한다. 보드는 조회 이벤트와 같은 모양으로 읽으므로 빠진 칸을 빈 값으로 채운다.
 * 빈 값은 「모름」이다. 원본에 값이 없었다는 뜻이 아니다
 */
export function boardEventFromSnapshot(s: EventSnapshot | TimelineEvent): TimelineEvent {
  const e = s as Partial<TimelineEvent> & EventSnapshot
  const outcome = e.outcome === 'success' || e.outcome === 'failure' ? e.outcome : 'unknown'
  return {
    ...e,
    provider: e.provider as TimelineEvent['provider'],
    category: e.category ?? 'other',
    indexed_at: e.indexed_at ?? null,
    received_at: e.received_at ?? '',
    outcome,
    outcome_reason: e.outcome_reason ?? null,
    signal: e.signal ?? null,
    targets: e.targets ?? [],
    correlation: { session_id: null, transaction_id: null, client_ip: null, ...e.correlation, caused_by: e.correlation?.caused_by ?? [] },
    attributes: e.attributes ?? (e.aegi_self ? { aegi_self: true } : {}),
    transport_ref: e.transport_ref ?? { index: '', sourcetype: '', sid: '', offset: 0 },
    mapping_version: e.mapping_version ?? '',
    raw_sha256: e.raw_sha256 ?? '',
  }
}

export interface V1Board {
  graph: AssistantEventGraph
  evidence?: unknown[]
  title?: string
}

/** 옛 형식 보드를 v2 이벤트 카드 보드로 변환 */
export function migrateV1(v1: V1Board, now?: string | number): BoardV2 {
  const time = typeof now === 'number' ? new Date(now).toISOString() : typeof now === 'string' ? now : new Date().toISOString()
  const cards: Card[] = []

  for (const node of v1.graph.nodes ?? []) {
    const id = `event-${node.key}`
    cards.push({
      id,
      kind: 'event',
      x: 0,
      y: 0,
      createdAt: time,
      event: snapshotFromAssistantNode(node),
    })
  }

  const positionedCards: Card[] = []
  for (const c of cards) {
    const pos = nextPosition({ cards: positionedCards })
    positionedCards.push({ ...c, ...pos })
  }

  const published: BoardPublishedLink[] = []
  for (const edge of v1.graph.edges ?? []) {
    if (edge.from && edge.to && edge.from !== edge.to) {
      const basis = edge.basis || 'session'
      const strength: 'confirmed' | 'review' = edge.strength === 'review' ? 'review' : 'confirmed'
      const exists = published.some(p => p.from === edge.from && p.to === edge.to && p.basis === basis)
      if (!exists) {
        published.push({
          from: edge.from,
          to: edge.to,
          basis,
          strength,
        })
      }
    }
  }

  return {
    version: 2,
    title: v1.title || '새 이벤트 조사',
    cards: positionedCards,
    links: [],
    published: published.length > 0 ? published : undefined,
    createdAt: time,
    updatedAt: time,
  }
}

/** 보드 직렬화 */
export function serializeBoard(board: BoardV2): string {
  return JSON.stringify(board, null, 2)
}

/** 보드 역직렬화 및 검증 (깨진 형식이나 끝없는 선은 null) */
export function parseBoard(text: string): BoardV2 | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null

  const raw = data as Record<string, unknown>
  if (!('version' in raw) || raw.version === 1) {
    if (raw.graph && typeof raw.graph === 'object' && Array.isArray((raw.graph as Record<string, unknown>).nodes)) {
      return migrateV1(raw as unknown as V1Board)
    }
    return null
  }

  if (raw.version !== 2) return null
  if (raw.id !== undefined && (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(raw.id))) return null
  if (typeof raw.title !== 'string') return null
  if (!Array.isArray(raw.cards) || !Array.isArray(raw.links)) return null
  if (typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string') return null

  const cardIds = new Set<string>()
  for (const c of raw.cards) {
    if (!c || typeof c !== 'object') return null
    if (typeof c.id !== 'string' || !c.id) return null
    if (cardIds.has(c.id)) return null
    cardIds.add(c.id)
    if (typeof c.kind !== 'string') return null
    if (typeof c.x !== 'number' || typeof c.y !== 'number') return null
    if (typeof c.createdAt !== 'string') return null

    if (c.kind === 'threat') {
      if (!['finding', 'gap', 'config'].includes(c.source)) return null
      if (typeof c.refId !== 'string' || typeof c.title !== 'string') return null
      if (!Array.isArray(c.objectKeys) || !Array.isArray(c.relationKeys) || !Array.isArray(c.outsidePeople)) return null
    } else if (c.kind === 'query') {
      if (typeof c.title !== 'string') return null
      if (!c.scope || typeof c.scope !== 'object') return null
      if (typeof c.scope.from !== 'string' || typeof c.scope.to !== 'string' || !Array.isArray(c.scope.objectKeys)) return null
      if (typeof c.droppedObjects !== 'number') return null
      if (!['time', 'actors', 'types', 'objects', 'list', 'path'].includes(c.view)) return null
      if (c.neighbors !== undefined) {
        if (!c.neighbors || typeof c.neighbors !== 'object' || Array.isArray(c.neighbors)) return null
        const n = c.neighbors as Record<string, unknown>
        if (!Array.isArray(n.seeds) || n.seeds.length > 20 || !n.seeds.every(s => typeof s === 'string')) return null
        if (n.hops !== 1 && n.hops !== 2) return null
        if (!Array.isArray(n.relationTypes) || n.relationTypes.length > 40 || !n.relationTypes.every(t => typeof t === 'string')) return null
        if (n.anchorAt !== undefined && typeof n.anchorAt !== 'string') return null
        if (n.anchorEvent !== undefined && typeof n.anchorEvent !== 'string') return null
        if (!Array.isArray(n.dropped) || n.dropped.length > 500 || !n.dropped.every(d => typeof d === 'string')) return null
        if (!n.paths || typeof n.paths !== 'object' || Array.isArray(n.paths)) return null
        const scopeKeySet = new Set(c.scope.objectKeys)
        for (const [k, steps] of Object.entries(n.paths as Record<string, unknown>)) {
          if (!scopeKeySet.has(k)) return null
          if (!Array.isArray(steps)) return null
          for (const step of steps) {
            if (!step || typeof step !== 'object' || Array.isArray(step)) return null
            const s = step as Record<string, unknown>
            if (typeof s.relationKey !== 'string' || typeof s.type !== 'string' || typeof s.from !== 'string' || typeof s.to !== 'string') return null
          }
        }
      }
    } else if (c.kind === 'event') {
      if (!c.event || typeof c.event !== 'object') return null
      if (typeof c.event.origin_key !== 'string' || typeof c.event.provider !== 'string') return null
      if (typeof c.event.event_type !== 'string' || typeof c.event.title !== 'string') return null
      if (typeof c.event.outcome !== 'string') return null
      if (!Array.isArray(c.event.targets)) return null
    } else if (c.kind === 'object') {
      if (typeof c.objectKey !== 'string' || typeof c.label !== 'string') return null
    } else if (c.kind === 'note') {
      if (typeof c.text !== 'string') return null
    } else {
      return null
    }
  }

  for (const l of raw.links) {
    if (!l || typeof l !== 'object') return null
    if (typeof l.id !== 'string' || !l.id) return null
    if (typeof l.from !== 'string' || typeof l.to !== 'string') return null
    if (typeof l.note !== 'string') return null
    if (!cardIds.has(l.from) || !cardIds.has(l.to)) return null
  }

  if (raw.published !== undefined) {
    if (!Array.isArray(raw.published)) return null
    for (const p of raw.published) {
      if (!p || typeof p !== 'object') return null
      const pl = p as Record<string, unknown>
      if (typeof pl.from !== 'string' || typeof pl.to !== 'string' || typeof pl.basis !== 'string') return null
      if (pl.strength !== 'confirmed' && pl.strength !== 'review') return null
    }
  }

  return raw as unknown as BoardV2
}
