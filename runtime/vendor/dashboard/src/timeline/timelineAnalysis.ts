/**
 * Event Timeline 분석. Splunk 에서 읽어 D1 에 적재한 정규 이벤트(adapter-engine scripts/stream/splunk)를
 * 시간순으로 거른다. 이벤트와 연결을 새로 만들지 않는다.
 */

/** SaaS 코드(okta, gws, github, slack, salesforce …). 새 SaaS 이벤트가 들어와도 타입을 고치지 않게 문자열로 둔다 */
export type EventProvider = string
export type EventCategory = 'auth' | 'admin' | 'membership' | 'policy' | 'token' | 'data' | 'mail' | 'other'

/** 엔진이 객체 키를 찾은 근거. 무엇과 무엇이 같았는지만 적는다(엔진 scripts/stream/splunk/types.ts MatchedOn) */
export interface MatchedOn {
  /** 원본 이벤트의 칸 */
  event_field: string
  /** 객체 쪽 식별자 칸. 옛 키가 그대로 있었으면 object_key */
  identifier: string
  same: 'exact' | 'casefold'
}

export type Unmatched = 'not_in_graph' | 'ambiguous' | 'name_only'

export const UNMATCHED_LABEL: Record<Unmatched, string> = {
  not_in_graph: '스냅샷에 그 값을 가진 객체 없음',
  ambiguous: '같은 값을 가진 객체가 여럿',
  name_only: '원본에 이름만 있음',
}

export interface EntityRef {
  native_id: string
  type: string
  display: string | null
  object_key: string | null
  matched_on?: MatchedOn
  unmatched?: Unmatched
}

/** 이벤트의 칸: 행위자, 또는 targets 의 몇 번째 */
export type EventSlot = 'actor' | { target: number }

/**
 * 이벤트에서 찾은 객체 둘이 그래프 관계 하나의 두 끝과 같았다는 사실(엔진 RelationMatch).
 * 이벤트가 그 관계를 만들거나 썼다는 뜻이 아니다. 화면과 AI 는 같았다는 사실만 보인다.
 */
export interface RelationMatch {
  relation_id: string
  relation_type: string
  source: EventSlot
  target: EventSlot
  role?: EventSlot
}

export const slotLabel = (s: EventSlot) => (s === 'actor' ? '행위자' : `대상 ${s.target + 1}`)

/** 「target[].id = id」처럼 원본 칸과 객체 식별자 칸 */
export const matchedOnText = (m: MatchedOn) => `${m.event_field} = ${m.identifier}${m.same === 'casefold' ? ' (대소문자 무시)' : ''}`

/** 「has_role_on: 행위자 → 대상 2」 */
export const relationMatchText = (m: RelationMatch) => `${m.relation_type}: ${slotLabel(m.source)} → ${slotLabel(m.target)}${m.role ? `, 역할 ${slotLabel(m.role)}` : ''}`

export interface TimelineEvent {
  origin_key: string
  provider: EventProvider
  event_type: string
  category: EventCategory
  title: string
  occurred_at: string | null
  indexed_at: string | null
  received_at: string
  outcome: 'success' | 'failure' | 'unknown'
  outcome_reason: string | null
  signal: { kind: 'suspicious'; source: string; value: string | boolean | number } | null
  actor: EntityRef | null
  targets: EntityRef[]
  correlation: { session_id: string | null; transaction_id: string | null; caused_by: EntityRef[]; client_ip: string | null }
  attributes: Record<string, string | number | boolean>
  transport_ref: { index: string; sourcetype: string; sid: string; offset: number }
  /** 두 끝이 행위자·대상과 같았던 그래프 관계. 엔진이 그래프 관계를 받지 못했으면 없다. 비어 있어도 관계가 없다는 뜻은 아니다 */
  relation_matches?: RelationMatch[]
  /** 대조한 그래프 스냅샷과 그 데이터셋을 만든 시각 */
  matched_snapshot?: { id: string; collected_at: string | null }
  mapping_version: string
  raw_sha256: string
}

export interface TimedEvent extends TimelineEvent {
  t: number
}

/** 발생 시각이 없거나 읽을 수 없는 이벤트는 시간축에 놓지 않는다 */
/** 발생 시각이 있는 이벤트(시간순)와 없는 이벤트. 없는 것은 시간축에 못 놓아 따로 보인다 */
export function withTime(events: TimelineEvent[]): { timed: TimedEvent[]; untimed: TimelineEvent[] } {
  const timed: TimedEvent[] = []
  const untimed: TimelineEvent[] = []
  for (const e of events) {
    const t = e.occurred_at ? Date.parse(e.occurred_at) : NaN
    if (Number.isNaN(t)) untimed.push(e)
    else timed.push({ ...e, t })
  }
  timed.sort((a, b) => a.t - b.t || a.origin_key.localeCompare(b.origin_key))
  return { timed, untimed }
}

/** 결과로 거르기. 지금은 실패만 고른다(의심 같은 위험 신호는 엔진이 내려 주면 더한다) */
export type EventOutcomeFilter = 'failure' | 'suspicious'

/**
 * 거르기 조건. 칩 묶음(providers, categories, outcomes)은 Threat Analysis 와 같은 뜻이다:
 * 아무것도 고르지 않으면 전부, 고르면 고른 것만. 처음부터 숨기는 유형은 없다(로그인 실패도 증거다).
 */
export interface TimelineFilter {
  providers: Set<EventProvider>
  categories: Set<EventCategory>
  outcomes: Set<EventOutcomeFilter>
  range: [number, number] | null
  linkedOnly: boolean
  text: string
  /** 값으로 거르기(행위자, 대상, IP, 객체) */
  pins: Pin[]
  /** AEGI 수집기 활동 보이기 */
  showSelf: boolean
}

export const emptyFilter = (): TimelineFilter => ({ providers: new Set(), categories: new Set(), outcomes: new Set(), range: null, linkedOnly: false, text: '', pins: [], showSelf: false })

/** 이벤트가 닿은 그래프 객체 키 (행위자, 대상, 원인) */
export function eventObjectKeys(e: TimelineEvent): string[] {
  const keys = [e.actor?.object_key, ...e.targets.map(t => t.object_key), ...e.correlation.caused_by.map(c => c.object_key)]
  return [...new Set(keys.filter((k): k is string => !!k))]
}

const picks = <K,>(set: Set<K>, key: K) => set.size === 0 || set.has(key)

/** 발생 시각이 없는 이벤트도 거른다. 그때는 구간을 보지 않는다 */
export function filterEvents<T extends TimelineEvent & { t?: number }>(events: T[], f: TimelineFilter): T[] {
  const text = f.text.trim().toLowerCase()
  return events.filter(e => {
    if (!f.showSelf && e.attributes?.aegi_self === true) return false
    if (!picks(f.providers, e.provider) || !picks(f.categories, e.category)) return false
    if (f.outcomes.size && !((e.outcome === 'failure' && f.outcomes.has('failure')) || (e.signal?.kind === 'suspicious' && f.outcomes.has('suspicious')))) return false
    if (f.range && e.t !== undefined && (e.t < f.range[0] || e.t > f.range[1])) return false
    if (f.linkedOnly && eventObjectKeys(e).length === 0) return false
    if (f.pins.length && !pinsMatch(e, f.pins)) return false
    if (text) {
      const hay = [e.event_type, e.title, e.actor?.display, e.actor?.native_id, ...e.targets.flatMap(t => [t.display, t.native_id]), e.correlation.client_ip].join(' ').toLowerCase()
      if (!hay.includes(text)) return false
    }
    return true
  })
}

/**
 * 이벤트 연결. adapter-engine 이 계산한다(aegi-adapter-engine docs/spec/AEGI_EVENT_LINKS_V1.md,
 * src/events/eventLinks.ts). 화면은 연결을 새로 계산하지 않고 읽어서 묶기만 한다.
 */
export type EventLinkBasis = 'caused_by' | 'session' | 'sso_handoff' | 'same_person_ip' | 'same_person_time' | 'shared_object' | 'graph_relation'
export type EventLinkStrength = 'confirmed' | 'review'

export interface EventLink {
  id: string
  from: string
  to: string
  basis: EventLinkBasis
  bases: EventLinkBasis[]
  strength: EventLinkStrength
  cross_saas: boolean
  from_provider: string
  to_provider: string
  occurred_at: string
  delta_ms: number
  identity_link_id: string | null
  via: { objects?: string[]; relations?: string[]; session_id?: string; client_ip?: string; app?: string }
  rule_version: string
}

/** 사슬의 선후 근거 = 엔진 연결 근거 */
export type PrecedenceBasis = EventLinkBasis

export const BASIS_LABEL: Record<PrecedenceBasis, string> = {
  caused_by: '원본이 원인 명시',
  session: '같은 세션',
  sso_handoff: 'Okta SSO로 앱 접속',
  same_person_ip: '동일인 계정, 같은 IP',
  same_person_time: '동일인 계정, 시간 근접',
  shared_object: '같은 객체, 시간 근접',
  graph_relation: '그래프 관계로 이어진 객체, 시간 근접',
}

export function formatDelta(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}초`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m}분 ${s % 60}초` : `${m}분`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`
}

/** 화면 시각은 한국 시간으로 쓴다 */
export function formatTime(t: number, withDate = true): string {
  const d = new Date(t + 9 * 3600_000)
  const iso = d.toISOString()
  return withDate ? `${iso.slice(5, 10)} ${iso.slice(11, 19)}` : iso.slice(11, 19)
}

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  auth: '로그인, 인증',
  admin: '계정, 그룹 관리',
  membership: '멤버십',
  policy: '정책, 규칙',
  token: '토큰, 앱 인가',
  data: '파일 접근',
  mail: '메일 전달',
  other: '기타',
}

/** 결과 글자. 「모름」은 용어 결정(#54)대로 「미확인」 */
export const OUTCOME_LABEL: Record<TimelineEvent['outcome'], string> = { success: '성공', failure: '실패', unknown: '미확인' }

/** 원본 로그와 대조하고 밖으로 보고할 때 쓰는 UTC 시각 */
export function formatUtc(t: number): string {
  const iso = new Date(t).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`
}

/** 사슬 이름: 첫 이벤트와 나머지 건수 */
/** 같은 일 반복 묶기의 한 줄. 반복이 아니면 이벤트 하나 */
export interface RepeatGroup { id: string; events: TimedEvent[] }

const refKey = (ref: EntityRef | null) => (ref ? ref.object_key ?? `${ref.type}:${ref.native_id}` : '')

/**
 * 같은 SaaS, 원본 이름, 행위자, 대상, 결과의 이벤트가 gapMs 안에 이어지면 한 줄로 묶는다(예: 같은 앱 인가 수십 건).
 * 실패는 묶지 않는다. 하나하나가 따로 볼 신호다. 입력은 시간순, 줄은 마지막 이벤트 시각순
 */
export function groupRepeats(events: TimedEvent[], gapMs = 30 * 60_000): RepeatGroup[] {
  const open = new Map<string, RepeatGroup>()
  const groups: RepeatGroup[] = []
  for (const e of events) {
    if (e.outcome === 'failure' || e.signal?.kind === 'suspicious') { groups.push({ id: e.origin_key, events: [e] }); continue }
    const key = [e.provider, e.event_type, refKey(e.actor), ...e.targets.map(refKey).sort(), e.outcome].join('\u0000')
    const group = open.get(key)
    if (group && e.t - group.events[group.events.length - 1]!.t <= gapMs) { group.events.push(e); continue }
    const next = { id: e.origin_key, events: [e] }
    open.set(key, next)
    groups.push(next)
  }
  const lastAt = (g: RepeatGroup) => g.events[g.events.length - 1]!.t
  return groups.sort((a, b) => lastAt(a) - lastAt(b))
}

/** 많이 나온 값부터 [값, 건수]. 건수가 같으면 먼저 나온 값이 앞 */
export function countBy<T>(items: T[], key: (item: T) => string): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}

/**
 * 상세의 「원본 필드」. 원본 이름 그대로, 값은 글자로. 자르지 않는다(보고와 Splunk 대조에 쓴다).
 * 수집 지연은 발생 시각에서 받은 시각까지.
 */
export function rawFields(e: TimedEvent): Array<[string, string]> {
  const ref = (r: EntityRef) => [r.type, r.display, r.native_id, r.object_key ? `객체 ${r.object_key}` : null].filter(Boolean).join(', ')
  const received = Date.parse(e.received_at)
  const out: Array<[string, string]> = [
    ['event_type', e.event_type],
    ['origin_key', e.origin_key],
    ['occurred_at', e.occurred_at ?? ''],
    ['indexed_at', e.indexed_at ?? ''],
    ['received_at', Number.isNaN(received) ? e.received_at : `${e.received_at}, ${formatDelta(Math.max(0, received - e.t))} 뒤 수집`],
    ['outcome', e.outcome],
    ['outcome_reason', e.outcome_reason ?? ''],
    ['signal', e.signal ? JSON.stringify(e.signal) : ''],
    ['actor', e.actor ? ref(e.actor) : ''],
    ...e.targets.map((t, i): [string, string] => [`targets[${i}]`, ref(t)]),
    ['client_ip', e.correlation.client_ip ?? ''],
    ['session_id', e.correlation.session_id ?? ''],
    ['transaction_id', e.correlation.transaction_id ?? ''],
    ...e.correlation.caused_by.map((c, i): [string, string] => [`caused_by[${i}]`, ref(c)]),
    ...Object.entries(e.attributes).map(([k, v]): [string, string] => [k, String(v)]),
    // AI 결과와 표시한 이벤트는 Splunk 위치를 저장하지 않는다
    ['splunk', !e.transport_ref.sid ? '' : `index ${e.transport_ref.index}, ${e.transport_ref.sourcetype}, SID ${e.transport_ref.sid}, offset ${e.transport_ref.offset}`],
    ['mapping_version', e.mapping_version],
    ['raw_sha256', e.raw_sha256],
  ]
  return out.filter(([, v]) => v !== '')
}

/** 값으로 거르기. 상세에서 행위자, 대상, IP를 누르거나 다른 화면에서 객체를 넘겨 건다 */
export type PinKind = 'actor' | 'target' | 'ip' | 'object'
export interface Pin { kind: PinKind; value: string; label: string }

const refIs = (ref: EntityRef | null | undefined, value: string) => Boolean(ref && (ref.native_id === value || ref.object_key === value))

export function pinMatches(e: TimelineEvent, pin: Pick<Pin, 'kind' | 'value'>): boolean {
  if (pin.kind === 'actor') return refIs(e.actor, pin.value)
  if (pin.kind === 'target') return e.targets.some(t => refIs(t, pin.value))
  if (pin.kind === 'ip') return e.correlation.client_ip === pin.value
  return refIs(e.actor, pin.value) || e.targets.some(t => refIs(t, pin.value)) || e.correlation.caused_by.some(c => refIs(c, pin.value))
}

/** 같은 종류의 값은 하나라도 맞으면, 다른 종류끼리는 모두 맞아야 남는다 */
export function pinsMatch(e: TimelineEvent, pins: Pin[]): boolean {
  const kinds = new Set(pins.map(p => p.kind))
  for (const kind of kinds) if (!pins.some(p => p.kind === kind && pinMatches(e, p))) return false
  return true
}

/** 거를 때 쓸 값: 그래프 객체 키가 있으면 키, 없으면 원본 ID */
export const pinFor = (kind: 'actor' | 'target', ref: EntityRef, label: string): Pin => ({ kind, value: ref.object_key ?? ref.native_id, label })

/** 한국 시간 전체 표기 */
export function formatKstFull(t: number): string {
  const iso = new Date(t + 9 * 3600_000).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`
}

/**
 * 주소에 남기는 상태(#timeline?…). 링크를 받은 사람도, 다른 화면에 갔다가 뒤로 와도 같은 화면을 연다.
 * 값은 값만 남기고 이름은 열 때 데이터에서 다시 찾는다(pinLabel).
 */

/**
 * 서버에 물을 기간(UTC)과, 있으면 좁힐 그래프 객체(서버 한도 20개)와 SaaS.
 * SaaS 를 주면 서버가 그 SaaS 의 Splunk 출처만 검색한다. 안 주면 모든 SaaS 를 검색한다. 한 조회가 읽는 Splunk 결과는 10만 건까지다(Connector 안전 한도)
 */
export interface EventScope { from: string; to: string; objectKeys: string[]; providers?: string[] }
export const MAX_SCOPE_OBJECTS = 20

/** 주소로 받은 값의 이름: 그래프 객체 이름, 이벤트 속 행위자나 대상의 이름, 없으면 값 그대로 */
export function pinLabel(events: TimelineEvent[], pin: Pick<Pin, 'kind' | 'value'>, objectName: (key: string) => string | null): string {
  if (pin.kind === 'ip') return pin.value
  const named = objectName(pin.value)
  if (named) return named
  for (const e of events) {
    for (const ref of [e.actor, ...e.targets]) if (refIs(ref, pin.value) && ref?.display) return ref.display
  }
  return pin.value
}
