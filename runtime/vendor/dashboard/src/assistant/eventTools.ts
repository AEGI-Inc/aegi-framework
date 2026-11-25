import type { TimelineEvent, EventLink } from '../timeline/timelineAnalysis'
import { BASIS_LABEL, matchedOnText, relationMatchText, slotLabel } from '../timeline/timelineAnalysis'
import type { KgCall, KgFact, ToolArgs } from './chatProtocol'
import { parseToolArgs } from './chatProtocol'
import { emptyKgResult, finishKgExecution, type KgContext, type KgExecution } from './kgTools'
import { eventGraphFromFacts } from './eventGraph'

export const EVENT_KG_TOOLS: ReadonlySet<string> = new Set(['search_events', 'event_connections'])
export interface EventCounts {
  total: number; failures: number; suspicious: number; unknown: number; untimed: number
  from: string | null; to: string | null; providers: Array<{ provider: string; count: number }>; providersTruncated: boolean
}
export interface EventQueryResult {
  events: TimelineEvent[]; links: EventLink[] | null; total: number; counts?: EventCounts
  available: boolean; problem?: string
  range?: { from: string; to: string }; partial?: boolean; partialReasons?: string[]; graphSnapshotId?: string | null
  coverage?: { sourceCollection: string; searchExecution: string }; sources?: unknown; executedSpl?: string
}
export type EventReader = (name: string, args: ToolArgs, signal?: AbortSignal) => Promise<EventQueryResult>
const clip = (value: string | null | undefined, size = 240) => value == null ? null : value.slice(0, size)
const page = (args: ToolArgs) => ({ offset: Number(args.offset ?? 0), limit: Number(args.limit ?? 10) })
const time = (e: TimelineEvent) => e.occurred_at && Number.isFinite(Date.parse(e.occurred_at)) ? Date.parse(e.occurred_at) : null
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
export const sortEvents = (a: TimelineEvent, b: TimelineEvent) => (time(b) ?? -Infinity) - (time(a) ?? -Infinity) || compare(a.origin_key, b.origin_key)

/** Only normalized, explicitly allowed fields are searched. */
export function matchesEvent(e: TimelineEvent, args: ToolArgs): boolean {
  const t = time(e)
  if (args.from && (t === null || t < Date.parse(String(args.from)) || t >= Date.parse(String(args.to)))) return false
  if (args.provider && e.provider !== args.provider || args.category && e.category !== args.category || args.outcome && e.outcome !== args.outcome) return false
  if (args.suspicious !== undefined && (e.signal?.kind === 'suspicious') !== args.suspicious) return false
  if (args.eventKey && e.origin_key !== args.eventKey || args.actorKey && e.actor?.object_key !== args.actorKey || args.eventType && e.event_type !== args.eventType) return false
  if (args.clientIp && e.correlation.client_ip !== args.clientIp || args.sessionId && e.correlation.session_id !== args.sessionId) return false
  const objectKeys = args.objectKeys
  if (Array.isArray(objectKeys) && ![e.actor?.object_key, ...e.targets.map(t => t.object_key)].some(key => key && objectKeys.includes(key))) return false
  const text = String(args.text ?? '').trim().toLowerCase()
  return !text || [e.event_type, e.title, e.actor?.display, e.actor?.native_id, ...e.targets.flatMap(t => [t.display, t.native_id]), e.correlation.client_ip].some(v => v?.toLowerCase().includes(text))
}

export function countEvents(events: TimelineEvent[]): EventCounts {
  const providers = new Map<string, number>()
  const times = events.filter(e => time(e) !== null).sort(sortEvents)
  events.forEach(e => providers.set(e.provider, (providers.get(e.provider) ?? 0) + 1))
  return { total: events.length, failures: events.filter(e => e.outcome === 'failure').length, suspicious: events.filter(e => e.signal?.kind === 'suspicious').length,
    unknown: events.filter(e => e.outcome === 'unknown').length, untimed: events.length - times.length,
    from: times[times.length - 1]?.occurred_at ?? null, to: times[0]?.occurred_at ?? null,
    providers: [...providers].sort(([a, n], [b, m]) => m - n || compare(a, b)).slice(0, 20).map(([provider, count]) => ({ provider: provider.slice(0, 80), count })), providersTruncated: providers.size > 20 }
}

/** Local datasets only. Production reads the D1 log cache, never the UI's 10,000-event cache. */
export function queryLocalEvents(events: TimelineEvent[], links: EventLink[] | null, name: string, args: ToolArgs): EventQueryResult {
  const { offset, limit } = page(args)
  if (name === 'event_connections') {
    const seed = events.find(e => e.origin_key === args.eventKey)
    if (!seed) return { events: [], links: links === null ? null : [], total: 0, available: true }
    const found = (links ?? []).filter(l => args.direction === 'in' ? l.to === args.eventKey : args.direction === 'out' ? l.from === args.eventKey : l.from === args.eventKey || l.to === args.eventKey)
      .sort((a, b) => compare(a.occurred_at, b.occurred_at) || compare(a.id, b.id))
    const shown = found.slice(offset, offset + limit), keys = new Set(shown.flatMap(l => [l.from, l.to]))
    return { events: [seed, ...events.filter(e => e !== seed && keys.has(e.origin_key))], links: links === null ? null : shown, total: found.length, available: true }
  }
  const found = events.filter(e => matchesEvent(e, args)).sort(sortEvents)
  return { events: found.slice(offset, offset + limit), links: null, total: found.length, counts: countEvents(found), available: true }
}

type Fact = Omit<KgFact, 'id'>
/** One event as a model fact. Also used for log search results (server/assistant/logTools.ts). */
/** 이벤트 하나에 싣는 관계 일치 수. 넘으면 실은 수와 전체 수를 함께 적는다 */
const RELATION_MATCHES_SHOWN = 6

export function eventFact(e: TimelineEvent): Fact {
  const entity = (v: TimelineEvent['actor']) => v ? { objectKey: clip(v.object_key, 512), display: clip(v.display, 120), type: clip(v.type, 80), nativeId: clip(v.native_id, 120),
    ...(v.matched_on ? { matchedOn: { eventField: clip(v.matched_on.event_field, 120), identifier: clip(v.matched_on.identifier, 80), same: v.matched_on.same } } : {}),
    ...(v.unmatched ? { unmatched: v.unmatched } : {}) } : null
  const matches = e.relation_matches
  const data = { provider: clip(e.provider, 80), eventType: clip(e.event_type), category: e.category, occurredAt: clip(e.occurred_at, 64), outcome: e.outcome, outcomeReason: clip(e.outcome_reason),
    signal: e.signal ? { kind: e.signal.kind, source: clip(e.signal.source, 80), value: typeof e.signal.value === 'string' ? clip(e.signal.value, 160) : e.signal.value } : null,
    suspicious: e.signal?.kind === 'suspicious', actor: entity(e.actor), targets: e.targets.slice(0, 4).map(entity), targetsTruncated: e.targets.length > 4,
    correlation: { sessionId: clip(e.correlation.session_id, 128), transactionId: clip(e.correlation.transaction_id, 128), clientIp: clip(e.correlation.client_ip, 80) },
    ...(e.attributes?.aegi_self === true ? { aegiSelf: true } : {}),
    // 그래프 관계를 받지 못한 엔진이면 relationMatches 가 null 이다. 빈 배열은 같았던 관계가 없었다는 사실일 뿐이다
    relationMatches: matches ? matches.slice(0, RELATION_MATCHES_SHOWN).map(m => ({ relationId: clip(m.relation_id, 512), relationType: clip(m.relation_type, 80),
      source: slotLabel(m.source), target: slotLabel(m.target), ...(m.role ? { role: slotLabel(m.role) } : {}) })) : null,
    relationMatchesTotal: matches ? matches.length : null,
    matchedSnapshot: e.matched_snapshot ? { id: clip(e.matched_snapshot.id, 120), collectedAt: clip(e.matched_snapshot.collected_at, 64) } : null }
  const label = clip(e.title, 160) || e.origin_key
  const refs = [['행위자', e.actor] as const, ...e.targets.slice(0, 4).map((t, i) => [slotLabel({ target: i }), t] as const)].filter(([, r]) => r?.matched_on)
  const matchLines = [
    ...(refs.length ? [`같았던 값: ${refs.map(([slot, r]) => `${slot} ${matchedOnText(r!.matched_on!)}`).join('; ')}`] : []),
    ...(matches?.length ? [`두 끝이 같은 관계 ${matches.length}개: ${matches.slice(0, RELATION_MATCHES_SHOWN).map(relationMatchText).join('; ')}${matches.length > RELATION_MATCHES_SHOWN ? ` (처음 ${RELATION_MATCHES_SHOWN}개만 실음)` : ''}`] : []),
    ...(matches?.length && e.matched_snapshot ? [`대조한 그래프: ${e.matched_snapshot.collected_at ?? e.matched_snapshot.id}`] : []),
  ]
  return { kind: 'event', ref: e.origin_key, label, data,
    detail: `${label}\n${data.occurredAt ?? '발생 시각 미확인'}\nSaaS: ${data.provider}\n결과: ${{ success: '성공', failure: '실패', unknown: '미확인' }[e.outcome]}${data.suspicious ? ', 의심 신호 있음' : ''}\n행위자: ${data.actor?.display ?? data.actor?.objectKey ?? '미확인'}\n대상: ${data.targets.map(t => t?.display ?? t?.objectKey ?? '미확인').join(', ')}${data.targetsTruncated ? '\n대상은 처음 4개만 표시했습니다.' : ''}${matchLines.map(l => `\n${l}`).join('')}` }
}
function linkFact(l: EventLink, events: Map<string, TimelineEvent>): Fact {
  const state = l.strength === 'confirmed' ? 'confirmed' : 'inferred'
  const bases = [...new Set([l.basis, ...(l.bases ?? [])])].slice(0, 6)
  const label = `${clip(events.get(l.from)?.title, 90) ?? l.from} → ${clip(events.get(l.to)?.title, 90) ?? l.to}`
  return { kind: 'event_link', ref: l.id, label: label.slice(0, 512), state,
    detail: `${bases.map(b => BASIS_LABEL[b] ?? '미확인 근거').join(', ')}\n${state === 'confirmed' ? '엔진이 확인한 연결' : '확인 필요한 추정 연결'}\n시간 차이: ${l.delta_ms}ms\n세션: ${clip(l.via.session_id, 128) ?? '미확인'}\nIP: ${clip(l.via.client_ip, 80) ?? '미확인'}\n앱: ${clip(l.via.app, 128) ?? '미확인'}\n규칙 버전: ${clip(l.rule_version, 80)}\n연결은 실제 권한이나 공격 성공을 증명하지 않습니다.`,
    data: { from: l.from, to: l.to, basis: l.basis, bases, strength: l.strength, crossSaas: l.cross_saas, deltaMs: l.delta_ms, identityLinkId: clip(l.identity_link_id, 512), ruleVersion: clip(l.rule_version, 80),
      via: { sessionId: clip(l.via.session_id, 128), clientIp: clip(l.via.client_ip, 80), app: clip(l.via.app, 128), objects: l.via.objects?.slice(0, 4).map(k => clip(k, 512)) }, missingEndpoints: [l.from, l.to].filter(k => !events.has(k)) } }
}

export function eventExecution(context: KgContext, call: KgCall, index: number, query: EventQueryResult): KgExecution {
  const args = parseToolArgs(call.function.name, JSON.parse(call.function.arguments))!
  const name = call.function.name, { offset } = page(args)
  const facts: Fact[] = []
  const meta: Fact = { kind: 'reference', ref: `events:${name}`, label: '이벤트 조회 범위와 수집 한계', state: query.available ? undefined : 'unknown',
    detail: query.available ? '수집된 이벤트만 조회했습니다. 수집 범위는 미확인입니다. 결과 없음은 실제 행위가 없었다는 증거가 아닙니다.' : '이벤트 저장소를 조회하지 못했습니다. 빈 결과로 해석하지 마세요.',
    data: { available: query.available, collectionCoverage: 'unknown', eventKey: args.eventKey, direction: args.direction, filterFields: Object.keys(args), total: query.available ? query.total : null, counts: query.counts,
      ...(query.range ? { range: query.range, graphSnapshotId: query.graphSnapshotId, partial: query.partial === true, partialReasons: query.partialReasons ?? [], coverage: query.coverage, totalIsExact: !query.partial } : {}) } }
  if (query.executedSpl) { (meta.data as Record<string, unknown>).executedSpl = query.executedSpl; meta.detail += `\n실행 검색식:\n${query.executedSpl}` }
  facts.push(meta)
  const events = new Map(query.events.map(e => [e.origin_key, e]))
  let returned = 0
  // Leave room for metadata and citation IDs before finishKgExecution's strict output cap.
  const append = (packet: Fact[]) => {
    if (JSON.stringify([...facts, ...packet]).length > 13_000) return false
    facts.push(...packet); return true
  }
  if (query.available && name === 'event_connections') {
    const seed = events.get(String(args.eventKey))
    if (seed) facts.push(eventFact(seed))
    const seen = new Set([String(args.eventKey)])
    for (const link of query.links ?? []) {
      const endpoints = [...new Set([link.from, link.to])].filter(k => !seen.has(k) && events.has(k))
      if (!append([linkFact(link, events), ...endpoints.map(k => eventFact(events.get(k)!))])) break
      endpoints.forEach(k => seen.add(k)); returned++
    }
    meta.data = { ...meta.data, eventFound: !!seed, linksAvailable: query.links !== null, total: query.links === null ? null : query.total }
    meta.detail += query.links === null ? '\n이벤트 연결이 게시되지 않았거나 연결 저장소를 조회하지 못했습니다.' : '\n엔진이 게시한 직접 연결만 조회했습니다. 추가 단계는 반환된 이벤트 키로 조회하세요.'
  } else if (query.available && name === 'search_events') {
    for (const event of query.events) { if (!append([eventFact(event)])) break; returned++ }
  }
  const pageTruncated = query.available && offset + returned < query.total
  const truncated = pageTruncated || query.partial === true
  meta.data = { ...meta.data, offset, returned, nextOffset: pageTruncated ? offset + returned : null }
  const counts = query.counts
  const summary = !query.available ? '이벤트 저장소를 조회할 수 없습니다.' : name === 'event_connections' && query.links === null ? '이벤트 연결을 조회할 수 없습니다.' : `조건에 맞는 ${name === 'event_connections' ? '직접 이벤트 연결' : '이벤트'} ${query.total}건 중 ${returned}건을 조회했습니다.${truncated ? ` 다음 offset: ${offset + returned}.` : ''}`
  meta.detail = `${query.partial ? '일부 조회 결과의 집계이며 전체 건수는 미확인입니다.\n' : ''}${summary}\n${meta.detail}${query.range ? `\n조회 기간: ${query.range.from} ~ ${query.range.to}` : ''}${query.partial ? `\n조회 한계: ${(query.partialReasons ?? []).join(', ')}` : ''}${counts ? `\n수집된 발생 시각: ${counts.from ?? '미확인'} ~ ${counts.to ?? '미확인'}\n결과 미확인: ${counts.unknown}건, 발생 시각 미확인: ${counts.untimed}건\n${counts.providers.map(p => `${p.provider}: ${p.count}건`).join(', ')}${counts.providersTruncated ? '\nSaaS 집계는 상위 20개입니다.' : ''}` : ''}`
  const result = emptyKgResult(meta.detail)
  result.navigation = [{ page: 'EventBoard', label: args.eventKey ? '이벤트 상세 열기' : 'Event Board 열기', ...(args.eventKey ? { eventKey: String(args.eventKey) } : {}) }]
  result.graph.objectKeys = [...new Set(query.events.flatMap(e => [e.actor?.object_key, ...e.targets.map(t => t.object_key)]).filter((k): k is string => !!k && context.graph.objectsByKey.has(k)))].slice(0, 40)
  result.graph.relationKeys = [...new Set(query.events.flatMap(e => (e.relation_matches ?? []).map(m => m.relation_id)).filter(k => context.graph.relationsByKey.has(k)))].slice(0, 40)
  if (args.eventKey && events.has(String(args.eventKey))) result.focus = { eventKey: String(args.eventKey) }
  const execution = finishKgExecution(context, name, args, index, result, facts, truncated)
  execution.result.eventGraph = eventGraphFromFacts(execution.output.facts, execution.output.truncated)
  return execution
}

export async function executeEventTool(context: KgContext, call: KgCall, index: number, reader: EventReader, signal?: AbortSignal): Promise<KgExecution> {
  const args = parseToolArgs(call.function.name, JSON.parse(call.function.arguments))
  if (!args) return finishKgExecution(context, call.function.name, null, index, emptyKgResult('조회 조건이 올바르지 않습니다.'), [], false)
  let result: EventQueryResult
  try { result = await reader(call.function.name, args, signal) }
  catch (error) { if (signal?.aborted) throw error; result = { events: [], links: null, total: 0, available: false } }
  return eventExecution(context, call, index, result)
}
