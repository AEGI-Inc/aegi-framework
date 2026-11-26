/**
 * Event Timeline 이벤트를 D1 로그 캐시(log_*)에서 읽는다. Splunk 검색과 D1 쓰기는 adapter-engine Connector가 하고
 * (engine scripts/stream/splunk/query/events.ts, logStore.ts), 여기는 Connector에 조회를 맡기고 진행을 묻고 D1을 SELECT만 한다.
 *
 *   GET /api/measured/graph/events?from=&to=&object=&provider=[&queryId=]
 *     → { queryId, state, from, to, providers: [{ provider, state, cached, reason? }], partialReasons, graphSnapshotId, source: 'splunk' }
 *     queryId 가 없으면 조회를 시작하고, 있으면 그 조회의 진행을 돌려준다.
 *   GET /api/measured/graph/events/read?queryId=&provider=&page=N
 *     → { items, provider, page, nextPage }  끝난(complete) SaaS 하나의 이벤트 한 페이지, 최신순
 *   GET /api/measured/graph/events/links?queryId=&page=N
 *     → { links, page, nextPage }  조회 전체가 끝난 뒤 이벤트 연결 한 페이지
 *
 * - 읽을 범위(기간, SaaS, 객체, 이벤트 종류)는 브라우저가 아니라 Connector의 조회 상태에서 가져온다. 그래서 다른 세션의 조회는 읽지 못한다.
 * - 끝나지 않았거나 실패한 SaaS는 읽지 않는다. 반쯤 쓴 결과를 보여 주지 않고, 다른 경로의 데이터로 대신 채우지 않는다.
 * - 오류는 설계 문서(aegi-knowledge docs/architecture/splunk-d1-cache-design.md)의 8종 코드로 돌려준다.
 */
import type { D1Like } from './exceptions'
import type { RelayReply, RelayRequest, RelayScope } from './splunkRelay'
import type { SplunkTransport } from './splunkTransport'

export const LOG_PAGE_SIZE = 500
export const LINK_PAGE_SIZE = 1000
/** 기간을 주지 않으면 지금까지 7일, 끝은 5분 단위로 올린다. 기간 상한은 없다. */
export const DEFAULT_RANGE_MS = 7 * 86400_000
const ROUND_MS = 5 * 60_000
const RELAY_TIMEOUT_MS = 20_000
/** 시작 요청은 Connector가 이만큼 기다려 캐시만으로 끝나는 조회를 한 번에 돌려준다. */
const START_WAIT_S = 3
const MAX_PAGES = 1000
/** adapter-engine events.ts PROVIDERS 와 같다. 이 밖의 값은 Splunk 소스가 없어 보내지 않는다. */
export const LOG_PROVIDERS = ['okta', 'gws', 'github', 'slack', 'salesforce', 'atlassian', 'microsoft', 'onepassword', 'snowflake', 'gcp']

/** 화면과 AI가 구분해 보여 주는 오류 코드 8종 */
export const LOG_ERRORS = ['connector_unreachable', 'splunk_failed', 'timeout', 'spl_rejected', 'too_many_results', 'd1_write_failed', 'd1_read_failed', 'graph_snapshot_changed'] as const
/** 8종으로 옮기지 않고 그대로 두는 요청 오류. 화면이 따로 문구를 둔다. */
const REQUEST_ERRORS = ['search_budget_exceeded', 'concurrency_limit', 'capacity_limit', 'job_not_found', 'invalid_event_query', 'login_required', 'results_not_ready', 'provider_not_ready']

/** Connector가 남긴 사유(`timeout:okta-main`, `search_failed` 등)를 8종 가운데 하나로 */
export function logError(reason: string): string {
  const code = reason.split(':')[0] ?? ''
  if ((LOG_ERRORS as readonly string[]).includes(code) || REQUEST_ERRORS.includes(code)) return code
  if (code === 'gateway_failed' || code === 'splunk_connector_unavailable' || code === 'splunk_reply_too_large') return 'connector_unreachable'
  return 'splunk_failed'
}

export interface ProviderProgress { provider: string; state: 'waiting' | 'searching' | 'complete' | 'failed'; cached: boolean; reason?: string }
interface Status {
  queryId: string; state: string; from: string; to: string; graphSnapshotId: string | null; partialReasons: string[]
  filters: { providers: string[]; objectKeys: string[]; eventTypes: string[] }; providers?: ProviderProgress[]
}
export interface LogEventsDeps { transport: SplunkTransport; db: D1Like; scope: RelayScope; graphSnapshotId?: string; now?: () => number }
type Result = { status: number; body: Record<string, unknown> }
const fail = (status: number, code: string, extra: Record<string, unknown> = {}): Result => ({ status, body: { error: code, ...extra } })
const isoMinute = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

export interface LogQuery { from: string; to: string; objectKeys: string[]; providers: string[] }
export function readLogQuery(url: URL, now: number): LogQuery | null {
  const keys = [...url.searchParams.getAll('actor'), ...url.searchParams.getAll('object')]
  let from = url.searchParams.get('from'), to = url.searchParams.get('to')
  if (!from && !to) { const end = Math.ceil(now / ROUND_MS) * ROUND_MS; to = isoMinute(end); from = isoMinute(end - DEFAULT_RANGE_MS) }
  if (!from || !to || !/Z$/.test(from) || !/Z$/.test(to)) return null
  const start = Date.parse(from), end = Date.parse(to)
  if (!(start < end)) return null
  if (keys.length > 20 || keys.some(k => !k || k.length > 200)) return null
  const providers = [...new Set(url.searchParams.getAll('provider'))].filter(p => LOG_PROVIDERS.includes(p)).sort()
  // The connector takes whole seconds in ISO form.
  return { from: isoMinute(start), to: isoMinute(end), objectKeys: [...new Set(keys)].sort(), providers }
}

/** The connector's job status, or the failure to answer with. */
async function ask(deps: LogEventsDeps, request: Omit<RelayRequest, 'scope'>): Promise<{ status: Status } | { failure: Result }> {
  try {
    const reply: RelayReply = await deps.transport.request({ ...request, scope: deps.scope }, RELAY_TIMEOUT_MS)
    if (reply.status === 200) return { status: reply.body as unknown as Status }
    const code = typeof reply.body.error === 'string' && /^[a-z_]{1,80}$/.test(reply.body.error) ? reply.body.error : 'connector_unreachable'
    return { failure: fail(reply.status === 400 ? 400 : 503, logError(code)) }
  } catch { return { failure: fail(503, 'connector_unreachable') } }
}

function statusBody(s: Status) {
  const providers = (s.providers ?? []).map(p => ({ provider: p.provider, state: p.state, cached: p.cached, ...(p.reason ? { reason: p.state === 'failed' ? logError(p.reason) : p.reason } : {}) }))
  const failed = s.state === 'failed' || s.state === 'cancelled'
  return { queryId: s.queryId, state: s.state, from: s.from, to: s.to, providers, partialReasons: s.partialReasons, graphSnapshotId: s.graphSnapshotId, source: 'splunk',
    ...(failed ? { error: logError(s.partialReasons.find(r => !r.startsWith('graph_index_unavailable')) ?? 'splunk_failed') } : {}) }
}

/** 조회 시작 또는 진행 */
export async function logEventsStatus(url: URL, deps: LogEventsDeps): Promise<Result> {
  const queryId = url.searchParams.get('queryId')
  if (queryId) {
    if (!/^[0-9a-f-]{36}$/.test(queryId)) return fail(400, 'invalid_event_query')
    const reply = await ask(deps, { action: 'events_status', queryId })
    return 'failure' in reply ? reply.failure : { status: 200, body: statusBody(reply.status) }
  }
  const q = readLogQuery(url, (deps.now ?? Date.now)())
  if (!q) return fail(400, 'invalid_event_query')
  const events = { from: q.from, to: q.to, ...(q.objectKeys.length ? { objectKeys: q.objectKeys } : {}), ...(q.providers.length ? { providers: q.providers } : {}),
    ...(deps.graphSnapshotId ? { graphSnapshotId: deps.graphSnapshotId } : {}) }
  const reply = await ask(deps, { action: 'events', waitSeconds: START_WAIT_S, reuse: true, events })
  return 'failure' in reply ? reply.failure : { status: 200, body: statusBody(reply.status) }
}

async function readableStatus(url: URL, deps: LogEventsDeps): Promise<Status | Result> {
  const queryId = url.searchParams.get('queryId')
  if (!queryId || !/^[0-9a-f-]{36}$/.test(queryId)) return fail(400, 'invalid_event_query')
  const reply = await ask(deps, { action: 'events_status', queryId })
  return 'failure' in reply ? reply.failure : reply.status
}
function pageOf(url: URL) {
  const page = Number(url.searchParams.get('page') ?? 0)
  return Number.isInteger(page) && page >= 0 && page < MAX_PAGES ? page : null
}

function encodeCursor(atMs: number, keyOrId: string | number): string {
  const json = JSON.stringify([atMs, keyOrId])
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(json, 'utf8').toString('base64url')
  }
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeCursor(cursor: string): [number, string | number] | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null
  try {
    let json: string
    if (typeof Buffer !== 'undefined') {
      json = Buffer.from(cursor, 'base64url').toString('utf8')
    } else {
      const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(cursor.length / 4) * 4, '=')
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      json = new TextDecoder().decode(bytes)
    }
    const val = JSON.parse(json)
    if (Array.isArray(val) && val.length === 2 && typeof val[0] === 'number' && Number.isFinite(val[0]) && (typeof val[1] === 'string' || typeof val[1] === 'number')) {
      if (typeof val[1] === 'string' && val[1].length === 0) return null
      return [val[0], val[1]]
    }
    return null
  } catch {
    return null
  }
}

interface EventRow {
  at_ms: number
  origin_key: string
  body: string
}

interface LinkRow {
  id: string
  at_ms: number
  body: string
}

/** 끝난 SaaS 하나의 이벤트 한 페이지 */
export async function logEventsRead(url: URL, deps: LogEventsDeps): Promise<Result> {
  const page = pageOf(url), provider = url.searchParams.get('provider') ?? ''
  if (page === null || !LOG_PROVIDERS.includes(provider)) return fail(400, 'invalid_event_query')
  const cursorParam = url.searchParams.get('cursor')
  let cursor: [number, string] | null = null
  if (cursorParam !== null && cursorParam !== '') {
    const decoded = decodeCursor(cursorParam)
    if (!decoded || typeof decoded[1] !== 'string') return fail(400, 'invalid_event_query')
    cursor = [decoded[0], decoded[1]]
  }
  const isFirstCall = (!cursorParam || cursorParam === '') && (page === 0 || page === null)
  const s = await readableStatus(url, deps)
  if ('body' in s) return s
  const progress = (s.providers ?? []).find(p => p.provider === provider)
  if (!progress) return fail(400, 'invalid_event_query')
  if (progress.state === 'failed') return fail(503, logError(progress.reason ?? 'splunk_failed'))
  if (progress.state !== 'complete') return fail(409, 'provider_not_ready')
  try {
    const filter = filterOf(s, [provider])
    const rows = await selectEventRows(deps.db, filter, LOG_PAGE_SIZE + 1, page * LOG_PAGE_SIZE, cursor)
    const items = rows.slice(0, LOG_PAGE_SIZE)
    const hasNext = rows.length > LOG_PAGE_SIZE
    const last = items.length ? items[items.length - 1] : null
    const nextCursor = hasNext && last ? encodeCursor(last.at_ms, last.origin_key) : null
    let total: number | undefined
    if (isFirstCall) {
      const { where, params } = filterSql(filter, 'e')
      const countRow = await deps.db.prepare(`SELECT COUNT(*) AS n FROM log_event e WHERE ${where}`).bind(...params).first<{ n: number }>()
      total = countRow?.n ?? 0
    }
    return {
      status: 200,
      body: {
        items: items.map(r => JSON.parse(r.body)),
        provider,
        page,
        nextPage: hasNext ? page + 1 : null,
        nextCursor,
        ...(total !== undefined ? { total } : {}),
      },
    }
  } catch { return fail(503, 'd1_read_failed') }
}

/** 조회가 끝난 뒤 이벤트 연결 한 페이지. 두 끝 이벤트가 모두 이 조회의 결과인 연결만 */
export async function logEventLinks(url: URL, deps: LogEventsDeps): Promise<Result> {
  const page = pageOf(url)
  if (page === null) return fail(400, 'invalid_event_query')
  // cursor 칸이 있으면(빈 값은 처음부터) 연결 id 순서로 읽는다. 없으면 옛 화면처럼 page 로 읽는다
  const cursorParam = url.searchParams.get('cursor')
  const byId = cursorParam !== null
  let afterId: string | null = null
  if (cursorParam) {
    const decoded = decodeCursor(cursorParam)
    if (!decoded || typeof decoded[1] !== 'string') return fail(400, 'invalid_event_query')
    afterId = decoded[1]
  }
  const isFirstCall = (!cursorParam || cursorParam === '') && (page === 0 || page === null)
  const s = await readableStatus(url, deps)
  if ('body' in s) return s
  if (s.state !== 'complete' && s.state !== 'partial') return fail(409, 'results_not_ready')
  const readable = (s.providers ?? []).filter(p => p.state === 'complete').map(p => p.provider)
  if (!readable.length) {
    return { status: 200, body: { links: [], page, nextPage: null, nextCursor: null, ...(isFirstCall ? { total: 0 } : {}) } }
  }
  try {
    const filter = filterOf(s, readable)
    // since: 화면이 상한에 닿아 남긴 이벤트의 가장 오래된 시각. 그보다 새로운 이벤트 사이의 연결만 읽는다
    const since = Number(url.searchParams.get('since') ?? '')
    if (url.searchParams.has('since') && (!Number.isSafeInteger(since) || since < 0)) return fail(400, 'invalid_event_query')
    if (url.searchParams.has('since')) filter.fromMs = Math.max(filter.fromMs, since)
    const snapshotId = s.graphSnapshotId ?? ''
    const rows = byId ? await selectLinkRowsById(deps.db, filter, snapshotId, LINK_PAGE_SIZE + 1, afterId)
      : await selectLinkRows(deps.db, filter, snapshotId, LINK_PAGE_SIZE + 1, page * LINK_PAGE_SIZE)
    const items = rows.slice(0, LINK_PAGE_SIZE)
    const hasNext = rows.length > LINK_PAGE_SIZE
    const last = items.length ? items[items.length - 1] : null
    const nextCursor = hasNext && last ? encodeCursor(last.at_ms, last.id) : null
    let total: number | undefined
    if (isFirstCall) {
      const to = filterSql(filter, 'e'), from = filterSql(filter, 'p')
      const countRow = await deps.db.prepare(`SELECT COUNT(*) AS n FROM log_event_link l JOIN log_event e ON e.origin_key = l.to_key
        WHERE l.graph_snapshot_id = ? AND ${to.where} AND EXISTS (SELECT 1 FROM log_event p WHERE p.origin_key = l.from_key AND ${from.where})`)
        .bind(snapshotId, ...to.params, ...from.params).first<{ n: number }>()
      total = countRow?.n ?? 0
    }
    return {
      status: 200,
      body: {
        links: items.map(r => JSON.parse(r.body)),
        page,
        nextPage: hasNext ? page + 1 : null,
        nextCursor,
        ...(total !== undefined ? { total } : {}),
      },
    }
  } catch { return fail(503, 'd1_read_failed') }
}

export interface LogFilter { providers: string[]; fromMs: number; toMs: number; objectKeys: string[]; eventTypes: string[] }
const filterOf = (s: Status, providers: string[]): LogFilter => ({ providers, fromMs: Date.parse(s.from), toMs: Date.parse(s.to), objectKeys: s.filters?.objectKeys ?? [], eventTypes: s.filters?.eventTypes ?? [] })

/** engine logStore.ts filterSql 과 같은 조건. 객체 키와 이벤트 종류는 JSON 매개변수 하나로 넘겨 D1 바인딩 100개 안에 둔다. */
function filterSql(f: LogFilter, t: string) {
  // SaaS 가 하나면 = 로 건다. IN (json_each) 이면 색인 (provider, at_ms) 의 순서를 못 써 페이지마다 해당 행 전체를 정렬한다
  const one = f.providers.length === 1
  const parts = [one ? `${t}.provider = ?` : `${t}.provider IN (SELECT value FROM json_each(?))`, `${t}.at_ms >= ?`, `${t}.at_ms < ?`]
  const params: unknown[] = [one ? f.providers[0] : JSON.stringify(f.providers), f.fromMs, f.toMs]
  if (f.eventTypes.length) { parts.push(`${t}.event_type IN (SELECT value FROM json_each(?))`); params.push(JSON.stringify(f.eventTypes)) }
  if (f.objectKeys.length) { parts.push(`EXISTS (SELECT 1 FROM json_each(${t}.object_keys) k WHERE k.value IN (SELECT value FROM json_each(?)))`); params.push(JSON.stringify(f.objectKeys)) }
  return { where: parts.join(' AND '), params }
}

export async function selectEvents(db: D1Like, f: LogFilter, limit: number, offset: number, cursor?: [number, string] | null): Promise<unknown[]> {
  const rows = await selectEventRows(db, f, limit, offset, cursor)
  return rows.map(r => JSON.parse(r.body))
}

export async function selectEventRows(db: D1Like, f: LogFilter, limit: number, offset: number, cursor?: [number, string] | null): Promise<EventRow[]> {
  const { where, params } = filterSql(f, 'e')
  if (cursor) {
    const { results } = await db.prepare(`SELECT e.at_ms, e.origin_key, e.body FROM log_event e WHERE ${where} AND (e.at_ms < ? OR (e.at_ms = ? AND e.origin_key > ?)) ORDER BY e.at_ms DESC, e.origin_key ASC LIMIT ?`)
      .bind(...params, cursor[0], cursor[0], cursor[1], limit).all<EventRow>()
    return results
  }
  const { results } = await db.prepare(`SELECT e.at_ms, e.origin_key, e.body FROM log_event e WHERE ${where} ORDER BY e.at_ms DESC, e.origin_key ASC LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset).all<EventRow>()
  return results
}

/**
 * 커서로 읽을 때는 연결 id(기본 키) 순서로 읽는다. 나중 끝 이벤트 시각 순서로 읽으면 페이지마다 해당 연결 전체를 정렬한다.
 * 화면은 연결을 모두 모아 쓰므로 순서에 기대지 않는다. afterId 가 null 이면 처음부터
 */
export async function selectLinkRowsById(db: D1Like, f: LogFilter, snapshotId: string, limit: number, afterId: string | null): Promise<LinkRow[]> {
  const to = filterSql(f, 'e'), from = filterSql(f, 'p')
  const { results } = await db.prepare(`SELECT l.id, e.at_ms, l.body FROM log_event_link l JOIN log_event e ON e.origin_key = l.to_key
    WHERE l.graph_snapshot_id = ? AND l.id > ? AND ${to.where} AND EXISTS (SELECT 1 FROM log_event p WHERE p.origin_key = l.from_key AND ${from.where})
    ORDER BY l.id ASC LIMIT ?`).bind(snapshotId, afterId ?? '', ...to.params, ...from.params, limit).all<LinkRow>()
  return results
}

export async function selectLinkRows(db: D1Like, f: LogFilter, snapshotId: string, limit: number, offset: number): Promise<LinkRow[]> {
  const to = filterSql(f, 'e'), from = filterSql(f, 'p')
  const { results } = await db.prepare(`SELECT l.id, e.at_ms, l.body FROM log_event_link l JOIN log_event e ON e.origin_key = l.to_key
    WHERE l.graph_snapshot_id = ? AND ${to.where} AND EXISTS (SELECT 1 FROM log_event p WHERE p.origin_key = l.from_key AND ${from.where})
    ORDER BY e.at_ms DESC, l.id ASC LIMIT ? OFFSET ?`).bind(snapshotId, ...to.params, ...from.params, limit, offset).all<LinkRow>()
  return results
}

/**
 * AI event_context 의 하위 조회 두 가지(event_connections, search_events)를 Timeline 과 같은 로그 캐시에서 읽는다.
 * 모델은 두 도구를 직접 부르지 못한다(RETIRED_TOOLS). event_context 가 넘기는 인자만 받는다.
 * 조회가 끝나지 않았으면 202 로 답한다. 브라우저가 같은 요청을 다시 보내면 Connector 가 reuse 로 같은 조회를 이어 준다.
 * 끝난 SaaS 만 읽고, 실패한 SaaS 는 partialReasons 에 남긴다. 결과 모양은 src/assistant/eventTools.ts EventQueryResult 다.
 */
const TOOL_ARGS: Record<string, string[]> = { event_connections: ['eventKey', 'direction', 'offset', 'limit'], search_events: ['objectKeys', 'provider', 'from', 'to', 'offset', 'limit'] }
const DONE = ['complete', 'partial', 'failed', 'cancelled']

export async function logEventTool(name: string, args: Record<string, unknown>, deps: LogEventsDeps): Promise<Result> {
  const allowed = TOOL_ARGS[name]
  if (!allowed || Object.keys(args).some(k => !allowed.includes(k))) return fail(400, 'unsupported_property')
  const url = new URL('https://events.invalid')
  if (typeof args.from === 'string' && typeof args.to === 'string') {
    if (!Number.isFinite(Date.parse(args.from)) || !Number.isFinite(Date.parse(args.to))) return fail(400, 'invalid_event_query')
    // 초를 뺀 시각(03:15Z, 12:15+09:00)도 같은 순간의 UTC 표기로 바꾼다.
    url.searchParams.set('from', new Date(args.from).toISOString()); url.searchParams.set('to', new Date(args.to).toISOString())
  }
  if (typeof args.provider === 'string') url.searchParams.set('provider', args.provider)
  if (Array.isArray(args.objectKeys)) args.objectKeys.forEach(k => url.searchParams.append('object', String(k)))
  const q = readLogQuery(url, (deps.now ?? Date.now)())
  if (!q) return fail(400, 'invalid_event_query')
  const events = { from: q.from, to: q.to, ...(q.objectKeys.length ? { objectKeys: q.objectKeys } : {}), ...(q.providers.length ? { providers: q.providers } : {}),
    ...(deps.graphSnapshotId ? { graphSnapshotId: deps.graphSnapshotId } : {}) }
  const reply = await ask(deps, { action: 'events', waitSeconds: START_WAIT_S, reuse: true, events })
  if ('failure' in reply) return reply.failure
  const s = reply.status
  if (!DONE.includes(s.state)) return { status: 202, body: { queryId: s.queryId, state: s.state } }
  const providers = s.providers ?? []
  // A provider outside the log sources has no events here; it is not widened to the others.
  const readable = providers.filter(p => p.state === 'complete' && (typeof args.provider !== 'string' || p.provider === args.provider)).map(p => p.provider)
  if (!providers.some(p => p.state === 'complete')) return fail(503, statusBody(s).error ?? logError(s.partialReasons[0] ?? 'splunk_failed'))
  const reasons = [...s.partialReasons, ...providers.filter(p => p.state === 'failed').map(p => `${p.provider}:${logError(p.reason ?? 'splunk_failed')}`)]
  const base = { available: true, range: { from: s.from, to: s.to }, partial: s.state !== 'complete' || reasons.length > 0, partialReasons: reasons,
    graphSnapshotId: s.graphSnapshotId, coverage: { sourceCollection: 'unknown', searchExecution: s.state } }
  const f = filterOf(s, readable), offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 10)
  const ok = (result: Record<string, unknown>): Result => ({ status: 200, body: { result: { ...base, ...result } } })
  try {
    if (name === 'search_events') {
      const { where, params } = filterSql(f, 'e')
      const total = (await deps.db.prepare(`SELECT COUNT(*) AS n FROM log_event e WHERE ${where}`).bind(...params).first<{ n: number }>())?.n ?? 0
      return ok({ events: await selectEvents(deps.db, f, limit, offset), links: null, total })
    }
    const key = String(args.eventKey)
    const [seed] = await selectEventsByKey(deps.db, f, [key])
    if (!seed) return ok({ events: [], links: [], total: 0 })
    const { links, total } = await selectEventLinks(deps.db, f, s.graphSnapshotId ?? '', key, String(args.direction ?? 'both'), limit, offset)
    const ends = [...new Set((links as Array<{ from: string; to: string }>).flatMap(l => [l.from, l.to]))].filter(k => k !== key)
    return ok({ events: [seed, ...(ends.length ? await selectEventsByKey(deps.db, f, ends) : [])], links, total })
  } catch { return fail(503, 'd1_read_failed') }
}

async function selectEventsByKey(db: D1Like, f: LogFilter, keys: string[]): Promise<unknown[]> {
  const { where, params } = filterSql(f, 'e')
  const { results } = await db.prepare(`SELECT e.body FROM log_event e WHERE e.origin_key IN (SELECT value FROM json_each(?)) AND ${where} ORDER BY e.at_ms DESC, e.origin_key ASC`)
    .bind(JSON.stringify(keys), ...params).all<{ body: string }>()
  return results.map(r => JSON.parse(r.body))
}

/** 이벤트 하나에 붙은 연결 한 페이지와 전체 수. 두 끝이 모두 같은 조건에 드는 연결만, 시각 순서로. */
async function selectEventLinks(db: D1Like, f: LogFilter, snapshotId: string, key: string, direction: string, limit: number, offset: number) {
  const side = direction === 'in' ? 'l.to_key = ?' : direction === 'out' ? 'l.from_key = ?' : '(l.from_key = ? OR l.to_key = ?)'
  const a = filterSql(f, 'a'), b = filterSql(f, 'b')
  const where = `l.graph_snapshot_id = ? AND ${side} AND EXISTS (SELECT 1 FROM log_event a WHERE a.origin_key = l.from_key AND ${a.where})
    AND EXISTS (SELECT 1 FROM log_event b WHERE b.origin_key = l.to_key AND ${b.where})`
  const params = [snapshotId, ...(direction === 'in' || direction === 'out' ? [key] : [key, key]), ...a.params, ...b.params]
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM log_event_link l WHERE ${where}`).bind(...params).first<{ n: number }>())?.n ?? 0
  const { results } = await db.prepare(`SELECT l.body FROM log_event_link l WHERE ${where} ORDER BY json_extract(l.body, '$.occurred_at'), l.id LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset).all<{ body: string }>()
  return { links: results.map(r => JSON.parse(r.body)), total }
}

/** AI 검색 결과(engine service.ts): 행 묶음이나 이벤트 순서. resultId 는 Connector 상태에서 받은 값만 쓴다. */
export async function selectResultRows(db: D1Like, resultId: string, offset: number, limit: number): Promise<Record<string, unknown>[]> {
  const chunk = 500, first = Math.floor(offset / chunk), last = Math.floor((offset + limit - 1) / chunk)
  const { results } = await db.prepare('SELECT first_row, rows FROM log_spl_result WHERE result_id = ? AND seq BETWEEN ? AND ? ORDER BY seq').bind(resultId, first, last).all<{ first_row: number; rows: string }>()
  const rows = results.flatMap(c => JSON.parse(c.rows) as Record<string, unknown>[])
  const start = offset - (results.length ? Number(results[0]!.first_row) : offset)
  return rows.slice(start, start + limit)
}
export async function selectResultEvents(db: D1Like, resultId: string, offset: number, limit: number): Promise<unknown[]> {
  const { results } = await db.prepare(`SELECT e.body FROM log_query_event q JOIN log_event e ON e.origin_key = q.origin_key
    WHERE q.result_id = ? AND q.seq >= ? AND q.seq < ? ORDER BY q.seq`).bind(resultId, offset, offset + limit).all<{ body: string }>()
  return results.map(r => JSON.parse(r.body))
}
