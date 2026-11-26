/**
 * Event Board 데이터 모델 (v3).
 * 세로는 SaaS 줄, 가로는 시간인 타임라인 보드.
 * 출처, 표시한 이벤트, 조사 대상 띠 카드, 분석가 연결과 보기를 순수 함수로 다룬다.
 */
import type {
  EventSnapshot,
  UserLink,
  QueryScope,
  QueryNeighbors,
  ThreatSource,
  Card,
  BoardV2,
} from './boardModel'
import { parseBoard } from './boardModel'

export type LinkKind =
  | 'same_actor'
  | 'target_to_actor'
  | 'actor_to_target'
  | 'same_target'
  | 'same_person'
  | 'session_ip_cause'
  | 'graph_relation'
  | 'analyst'

export const DEFAULT_LINK_KINDS: LinkKind[] = [
  'same_actor',
  'target_to_actor',
  'actor_to_target',
  'same_person',
  'session_ip_cause',
  'graph_relation',
  'analyst',
]

export interface BoardPin {
  kind: 'actor' | 'target' | 'ip' | 'object' | 'person'
  value: string
  label: string
}

export interface BoardFilters {
  providers: string[]
  categories: string[]
  outcomes: string[]
  text: string
  pins: BoardPin[]
}

export interface BoardView {
  mode: 'gaps' | 'linear' | 'ordinal'
  linkKinds: LinkKind[]
  hiddenSources: string[]
  showSelf: boolean
  filters: BoardFilters
  zoom?: number
  timeRange?: [number, number] | null
}

export type SubjectCard =
  | {
      id: string
      kind: 'threat'
      source: ThreatSource
      refId: string
      title: string
      severity?: string
      objectKeys: string[]
      relationKeys: string[]
      outsidePeople: string[]
      createdAt: string
    }
  | {
      id: string
      kind: 'object'
      objectKey: string
      label: string
      createdAt: string
    }
  | {
      id: string
      kind: 'note'
      text: string
      eventKey?: string
      createdAt: string
    }

export type Source =
  | {
      id: string
      kind: 'query'
      title: string
      scope: QueryScope
      neighbors?: QueryNeighbors
      createdAt: string
    }
  | {
      id: string
      kind: 'ai'
      title: string
      question: string
      eventKeys: string[]
      events?: EventSnapshot[]
      createdAt: string
    }

export interface BoardV3 {
  version: 3
  id?: string
  title: string
  sources: Source[]
  marked: Record<string, EventSnapshot>
  subjects: SubjectCard[]
  userLinks: UserLink[]
  view: BoardView
  createdAt: string
  updatedAt: string
}

export const MAX_V3_SOURCES = 50
export const MAX_V3_SUBJECTS = 200
export const MAX_V3_USER_LINKS = 500
export const MAX_V3_MARKED = 500
export const MAX_V3_AI_EVENTS_PER_SOURCE = 300
export const MAX_V3_TITLE_CHARS = 200

/** 기본 보기 설정 */
export function defaultBoardView(): BoardView {
  return {
    mode: 'gaps',
    linkKinds: [...DEFAULT_LINK_KINDS],
    hiddenSources: [],
    showSelf: false,
    filters: {
      providers: [],
      categories: [],
      outcomes: [],
      text: '',
      pins: [],
    },
  }
}

/** 새 V3 빈 보드 생성 */
export function emptyBoardV3(now = new Date().toISOString(), title = '새 이벤트 조사'): BoardV3 {
  return {
    version: 3,
    title,
    sources: [],
    marked: {},
    subjects: [],
    userLinks: [],
    view: defaultBoardView(),
    createdAt: now,
    updatedAt: now,
  }
}

/** 보드 직렬화 */
export function serializeBoard(b: BoardV3): string {
  return JSON.stringify(b, null, 2)
}

function cardTitle(card: Card | undefined): string {
  if (!card) return '알 수 없는 카드'
  if (card.kind === 'threat' || card.kind === 'query') return card.title
  if (card.kind === 'event') return card.event.title || card.event.origin_key
  if (card.kind === 'object') return card.label || card.objectKey
  if (card.kind === 'note') return card.text.slice(0, 20) || '메모'
  return ''
}

/** V2 보드를 V3 타임라인 보드로 변환 */
export function migrateV2toV3(b: BoardV2): BoardV3 {
  const sources: Source[] = []
  const marked: Record<string, EventSnapshot> = {}
  const subjects: SubjectCard[] = []
  const userLinks: UserLink[] = []

  const cardMap = new Map<string, Card>()
  for (const c of b.cards) {
    cardMap.set(c.id, c)
    if (c.kind === 'query') {
      sources.push({
        id: c.id,
        kind: 'query',
        title: c.title,
        scope: c.scope,
        ...(c.neighbors ? { neighbors: c.neighbors } : {}),
        createdAt: c.createdAt,
      })
    } else if (c.kind === 'event') {
      marked[c.event.origin_key] = c.event
    } else if (c.kind === 'threat') {
      subjects.push({
        id: c.id,
        kind: 'threat',
        source: c.source,
        refId: c.refId,
        title: c.title,
        ...(c.severity ? { severity: c.severity } : {}),
        objectKeys: c.objectKeys,
        relationKeys: c.relationKeys,
        outsidePeople: c.outsidePeople,
        createdAt: c.createdAt,
      })
    } else if (c.kind === 'object') {
      subjects.push({
        id: c.id,
        kind: 'object',
        objectKey: c.objectKey,
        label: c.label,
        createdAt: c.createdAt,
      })
    } else if (c.kind === 'note') {
      subjects.push({
        id: c.id,
        kind: 'note',
        text: c.text,
        createdAt: c.createdAt,
      })
    }
  }

  for (const l of b.links) {
    const fromCard = cardMap.get(l.from)
    const toCard = cardMap.get(l.to)
    if (fromCard?.kind === 'event' && toCard?.kind === 'event') {
      userLinks.push({
        id: l.id,
        from: fromCard.event.origin_key,
        to: toCard.event.origin_key,
        note: l.note,
      })
    } else {
      const fromTitle = cardTitle(fromCard)
      const toTitle = cardTitle(toCard)
      const notePart = l.note ? `, ${l.note}` : ''
      subjects.push({
        id: `migrated-link-${l.id}`,
        kind: 'note',
        text: `연결했던 카드: ${fromTitle} - ${toTitle}${notePart}`,
        createdAt: b.updatedAt || b.createdAt,
      })
    }
  }

  return {
    version: 3,
    ...(b.id ? { id: b.id } : {}),
    title: b.title,
    sources,
    marked,
    subjects,
    userLinks,
    view: defaultBoardView(),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }
}

/** 저장 크기 줄이기: 오래된 AI 출처 이벤트 본문부터 제거 */
export function shrinkToFit(b: BoardV3, maxBytes = 900_000): BoardV3 {
  let str = serializeBoard(b)
  if (str.length <= maxBytes) return b

  const aiIndices = b.sources
    .map((s, idx) => ({ s, idx }))
    .filter((item): item is { s: Extract<Source, { kind: 'ai' }>; idx: number } => item.s.kind === 'ai' && Boolean(item.s.events && item.s.events.length > 0))
    .sort((a, bItem) => a.s.createdAt.localeCompare(bItem.s.createdAt))

  if (!aiIndices.length) return b

  const nextSources = [...b.sources]
  let current: BoardV3 = { ...b, sources: nextSources }

  for (const item of aiIndices) {
    const copy = { ...item.s }
    delete copy.events
    nextSources[item.idx] = copy
    current = { ...b, sources: [...nextSources] }
    if (serializeBoard(current).length <= maxBytes) {
      return current
    }
  }

  return current
}

function isValidEventSnapshot(e: unknown): e is EventSnapshot {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false
  const r = e as Record<string, unknown>
  if (typeof r.origin_key !== 'string' || !r.origin_key) return false
  if (typeof r.provider !== 'string' || typeof r.event_type !== 'string' || typeof r.title !== 'string') return false
  if (typeof r.outcome !== 'string') return false
  if (!Array.isArray(r.targets)) return false
  return true
}

function isValidSource(s: unknown): s is Source {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false
  const r = s as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return false
  if (typeof r.title !== 'string' || typeof r.createdAt !== 'string') return false
  if (r.kind === 'query') {
    if (!r.scope || typeof r.scope !== 'object' || Array.isArray(r.scope)) return false
    const scope = r.scope as Record<string, unknown>
    if (typeof scope.from !== 'string' || typeof scope.to !== 'string' || !Array.isArray(scope.objectKeys)) return false
    if (!scope.objectKeys.every(k => typeof k === 'string')) return false
    if (scope.providers !== undefined && (!Array.isArray(scope.providers) || !scope.providers.every(p => typeof p === 'string'))) return false
    if (r.neighbors !== undefined) {
      if (!r.neighbors || typeof r.neighbors !== 'object' || Array.isArray(r.neighbors)) return false
      const n = r.neighbors as Record<string, unknown>
      if (!Array.isArray(n.seeds) || n.seeds.length > 20 || !n.seeds.every(seed => typeof seed === 'string')) return false
      if (n.hops !== 1 && n.hops !== 2) return false
      if (!Array.isArray(n.relationTypes) || n.relationTypes.length > 40 || !n.relationTypes.every(t => typeof t === 'string')) return false
      if (n.anchorAt !== undefined && typeof n.anchorAt !== 'string') return false
      if (n.anchorEvent !== undefined && typeof n.anchorEvent !== 'string') return false
      if (!Array.isArray(n.dropped) || n.dropped.length > 500 || !n.dropped.every(d => typeof d === 'string')) return false
      if (!n.paths || typeof n.paths !== 'object' || Array.isArray(n.paths)) return false
      for (const steps of Object.values(n.paths as Record<string, unknown>)) {
        if (!Array.isArray(steps)) return false
        for (const step of steps) {
          if (!step || typeof step !== 'object' || Array.isArray(step)) return false
          const st = step as Record<string, unknown>
          if (typeof st.relationKey !== 'string' || typeof st.type !== 'string' || typeof st.from !== 'string' || typeof st.to !== 'string') return false
        }
      }
    }
    return true
  } else if (r.kind === 'ai') {
    if (typeof r.question !== 'string' || !Array.isArray(r.eventKeys) || !r.eventKeys.every(k => typeof k === 'string')) return false
    if (r.events !== undefined) {
      if (!Array.isArray(r.events) || r.events.length > MAX_V3_AI_EVENTS_PER_SOURCE) return false
      if (!r.events.every(isValidEventSnapshot)) return false
    }
    return true
  }
  return false
}

function isValidSubject(s: unknown): s is SubjectCard {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false
  const r = s as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id || typeof r.createdAt !== 'string') return false
  if (r.kind === 'threat') {
    if (!['finding', 'gap', 'config'].includes(r.source as string)) return false
    if (typeof r.refId !== 'string' || typeof r.title !== 'string') return false
    if (r.severity !== undefined && typeof r.severity !== 'string') return false
    if (!Array.isArray(r.objectKeys) || !r.objectKeys.every(k => typeof k === 'string')) return false
    if (!Array.isArray(r.relationKeys) || !r.relationKeys.every(k => typeof k === 'string')) return false
    if (!Array.isArray(r.outsidePeople) || !r.outsidePeople.every(p => typeof p === 'string')) return false
    return true
  } else if (r.kind === 'object') {
    return typeof r.objectKey === 'string' && typeof r.label === 'string'
  } else if (r.kind === 'note') {
    return typeof r.text === 'string' && (r.eventKey === undefined || typeof r.eventKey === 'string')
  }
  return false
}

function isValidUserLink(l: unknown): l is UserLink {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return false
  const r = l as Record<string, unknown>
  return typeof r.id === 'string' && Boolean(r.id) && typeof r.from === 'string' && typeof r.to === 'string' && typeof r.note === 'string'
}

function isValidBoardView(v: unknown): v is BoardView {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const r = v as Record<string, unknown>
  if (!['gaps', 'linear', 'ordinal'].includes(r.mode as string)) return false
  if (!Array.isArray(r.linkKinds) || !r.linkKinds.every(k => ['same_actor', 'target_to_actor', 'actor_to_target', 'same_target', 'same_person', 'session_ip_cause', 'graph_relation', 'analyst'].includes(k as string))) return false
  if (!Array.isArray(r.hiddenSources) || !r.hiddenSources.every(s => typeof s === 'string')) return false
  if (typeof r.showSelf !== 'boolean') return false
  if (!r.filters || typeof r.filters !== 'object' || Array.isArray(r.filters)) return false
  const f = r.filters as Record<string, unknown>
  if (!Array.isArray(f.providers) || !f.providers.every(p => typeof p === 'string')) return false
  if (!Array.isArray(f.categories) || !f.categories.every(c => typeof c === 'string')) return false
  if (!Array.isArray(f.outcomes) || !f.outcomes.every(o => typeof o === 'string')) return false
  if (typeof f.text !== 'string') return false
  if (!Array.isArray(f.pins)) return false
  for (const pin of f.pins) {
    if (!pin || typeof pin !== 'object' || Array.isArray(pin)) return false
    const p = pin as Record<string, unknown>
    if (!['actor', 'target', 'ip', 'object', 'person'].includes(p.kind as string)) return false
    if (typeof p.value !== 'string' || typeof p.label !== 'string') return false
  }
  if (r.zoom !== undefined && (typeof r.zoom !== 'number' || !Number.isFinite(r.zoom) || r.zoom < 1 || r.zoom > 100)) return false
  if (r.timeRange !== undefined && r.timeRange !== null) {
    if (!Array.isArray(r.timeRange) || r.timeRange.length !== 2 || !r.timeRange.every(n => typeof n === 'number' && Number.isFinite(n))) return false
  }
  return true
}

/** V3 보드 형식을 엄격하게 검증 */
function parseBoardV3(raw: Record<string, unknown>): BoardV3 | null {
  if (raw.version !== 3) return null
  if (raw.id !== undefined && (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(raw.id))) return null
  if (typeof raw.title !== 'string' || raw.title.length > MAX_V3_TITLE_CHARS) return null
  if (typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string') return null

  if (!Array.isArray(raw.sources) || raw.sources.length > MAX_V3_SOURCES) return null
  if (!raw.sources.every(isValidSource)) return null

  if (!raw.marked || typeof raw.marked !== 'object' || Array.isArray(raw.marked)) return null
  const markedEntries = Object.entries(raw.marked)
  if (markedEntries.length > MAX_V3_MARKED) return null
  for (const [, val] of markedEntries) {
    if (!isValidEventSnapshot(val)) return null
  }

  if (!Array.isArray(raw.subjects) || raw.subjects.length > MAX_V3_SUBJECTS) return null
  if (!raw.subjects.every(isValidSubject)) return null

  if (!Array.isArray(raw.userLinks) || raw.userLinks.length > MAX_V3_USER_LINKS) return null
  if (!raw.userLinks.every(isValidUserLink)) return null

  if (!isValidBoardView(raw.view)) return null

  return raw as unknown as BoardV3
}

/** V1/V2/V3 어떤 버전의 보드든 파싱하여 V3로 반환 */
export function parseBoardAny(raw: string | unknown): BoardV3 | null {
  let data = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null

  const record = data as Record<string, unknown>
  if (record.version === 3) {
    return parseBoardV3(record)
  }

  // V1/V2 형식은 기존 parseBoard로 검증 후 V3로 변환
  const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw)
  const v2 = parseBoard(serialized)
  if (!v2) return null
  return migrateV2toV3(v2)
}
/**
 * AI 검색 질문과 건수로 AI 출처 제목을 만든다.
 * 앞뒤 공백을 다듬고 줄바꿈은 공백으로 바꾼 뒤 앞 30자까지만 자르고 말줄임표(…)를 붙인다.
 */
export function aiSourceTitle(question: string, count: number): string {
  const normalized = question.replace(/[\r\n]+/g, ' ').trim()
  const snippet = normalized.length > 30 ? `${normalized.slice(0, 30)}…` : normalized
  return `AI: ${snippet} (${count}건)`
}

/**
 * 기존 AI 출처 중 정확히 같은 이벤트 키 집합을 가진 출처가 있는지 확인한다.
 */
export function isDuplicateAiSource(sources: Source[], eventKeys: string[]): boolean {
  if (eventKeys.length === 0) return false
  const targetSet = new Set(eventKeys)
  return sources.some(s => {
    if (s.kind !== 'ai' || !s.eventKeys) return false
    const sourceSet = new Set(s.eventKeys)
    if (sourceSet.size !== targetSet.size) return false
    for (const key of targetSet) {
      if (!sourceSet.has(key)) return false
    }
    return true
  })
}

