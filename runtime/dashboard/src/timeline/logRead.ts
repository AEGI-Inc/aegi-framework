/**
 * Splunk 로그 캐시 읽기(server/logEvents.ts). Connector에 조회를 맡기고 진행을 물으며, 끝난 SaaS부터 D1에서 읽는다.
 * 화면(loadTimeline.ts)과 시험이 함께 쓴다. 가상 모듈을 들이지 않아 node 시험에서 바로 부른다.
 */
import { providerName } from '../findings/providers'
import type { TimelineEvent } from './timelineAnalysis'
import type { EventLink } from './timelineAnalysis'

/** 캐시 확인 → Splunk 검색 → 저장(이벤트 연결) → 읽기 */
export type LoadPhase = 'cache' | 'search' | 'store' | 'read'
export interface ProviderLoad {
  provider: string
  state: 'waiting' | 'searching' | 'complete' | 'failed'
  /** Splunk를 검색하지 않고 저장된 결과를 썼다 */
  cached: boolean
  /** 읽은 이벤트 수. 다 읽기 전에는 늘어난다 */
  count: number
  /** 서버 전체 이벤트 수(첫 페이지에서 받음) */
  total?: number
  /** 실패 코드(server/logEvents.ts LOG_ERRORS) */
  error?: string
}
export interface LoadProgress { phase: LoadPhase; providers: ProviderLoad[] }

/** 화면 문구. 코드는 server/logEvents.ts 의 8종과 요청 오류 */
export const LOG_ERROR_TEXT: Record<string, string> = {
  connector_unreachable: '조회 서버에 연결할 수 없습니다',
  splunk_failed: 'Splunk 검색이 실패했습니다',
  timeout: '시간 안에 검색이 끝나지 않았습니다. 기간을 줄여 다시 조회하세요',
  spl_rejected: '허용하지 않는 검색 명령이 들어 있습니다',
  too_many_results: '결과가 너무 많습니다. 기간이나 SaaS를 줄여 다시 조회하세요',
  d1_write_failed: '검색 결과를 저장하지 못했습니다. 다시 조회하세요',
  d1_read_failed: '저장된 결과를 읽지 못했습니다. 다시 조회하세요',
  graph_snapshot_changed: '조회 중 그래프가 바뀌었습니다. 다시 조회하세요',
  search_budget_exceeded: 'Splunk 검색 횟수 한도인 10분당 30회에 도달했습니다. 잠시 뒤 다시 조회하세요',
  concurrency_limit: '동시에 진행 중인 조회가 많습니다. 잠시 뒤 다시 조회하세요',
  capacity_limit: '조회 서버 요청이 많습니다. 잠시 뒤 다시 조회하세요',
  job_not_found: '조회 서버에서 이 조회를 찾을 수 없습니다. 다시 조회하세요',
  login_required: '로그인이 필요합니다',
  connector_outdated: '조회 서버가 화면보다 오래된 버전이라 결과를 읽을 수 없습니다',
  still_running: '조회가 아직 끝나지 않았습니다. 잠시 뒤 다시 조회하세요',
}
const errorText = (code: string | undefined) => LOG_ERROR_TEXT[code ?? ''] ?? `조회 실패${code ? ` (${code})` : ''}`

export class LogLoadError extends Error {
  constructor(public code: string) { super(errorText(code)) }
}

/** 한 번에 읽는 SaaS 수. 페이지는 SaaS 안에서 차례로 읽는다 */
const READ_CONCURRENCY = 4
const POLL_MS = 1000
/** Connector 실행 상한(120초)에 연결 계산과 읽기를 더한 화면 쪽 상한 */
const DEADLINE_MS = 180_000
export const MAX_EVENTS = 20_000
export const MAX_LINKS = 60_000
const SAFE_MAX_PAGES = 1000

interface StatusBody {
  queryId?: string; state?: string; from?: string; to?: string; error?: string; source?: string
  providers?: Array<{ provider: string; state: ProviderLoad['state']; cached: boolean; reason?: string }>; partialReasons?: string[]
  /** D1 그래프 이벤트(Splunk 없음)의 응답 */
  items?: TimelineEvent[]; links?: EventLink[] | null; truncated?: boolean; serverTime?: string; fetchedAt?: string
}
export interface ReadOptions {
  signal?: AbortSignal
  fetch?: typeof fetch
  pollMs?: number
  onProgress?: (progress: LoadProgress) => void
  onPage?: (partial: { events: TimelineEvent[]; range: { from: string; to: string } | null; progress: { done: number; total: number } }) => void
  onPageIntervalMs?: number
  now?: () => number
}
export interface LogRead {
  events: TimelineEvent[]
  links: EventLink[] | null
  origin: 'splunk' | 'd1'
  range: { from: string; to: string } | null
  generatedAt: string | null
  problem: string | null
  providers: ProviderLoad[]
  truncated: { total: number | null; loaded: number } | null
}

async function getJson<T>(url: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<{ status: number; body: T & { error?: string } }> {
  const res = await request(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal })
  return { status: res.status, body: await res.json().catch(() => ({})) as T & { error?: string } }
}
const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
  const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error('aborted')) }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
})

/**
 * 조회 하나를 끝까지 읽는다. Connector에 조회를 맡기고 1초마다 진행을 물으며, 끝난 SaaS는 바로 D1에서 페이지로 읽는다.
 * 실패한 SaaS는 읽지 않고 코드를 남긴다. 모든 SaaS가 끝나면 이벤트 연결을 읽는다.
 */
export async function readLogEvents(apiBase: string, query: URLSearchParams, options: ReadOptions = {}): Promise<LogRead> {
  const deadline = Date.now() + DEADLINE_MS
  const report = (phase: LoadPhase) => options.onProgress?.({ phase, providers: [...loads.values()].map(p => ({ ...p })) })
  const loads = new Map<string, ProviderLoad>()
  report('cache')
  let { status, body } = await getJson<StatusBody>(`${apiBase}/events?${query}`, options.signal, options.fetch)
  if (status !== 200) throw new LogLoadError(body.error ?? `http_${status}`)
  // A server without Splunk answers with D1 graph events at once.
  if (!body.queryId) {
    return {
      events: body.items ?? [],
      links: body.links ?? null,
      origin: 'd1',
      range: null,
      generatedAt: body.serverTime ?? body.fetchedAt ?? null,
      problem: body.truncated ? '조회 상한 10,000건에 도달했습니다. 기간을 줄여 다시 조사하세요.' : null,
      providers: [],
      truncated: body.truncated ? { total: null, loaded: body.items?.length ?? 0 } : null,
    }
  }
  const queryId = body.queryId, range = body.from && body.to ? { from: body.from, to: body.to } : null
  let events: TimelineEvent[] = []
  const reads = new Map<string, Promise<void>>()
  let reading = 0
  const queue: string[] = []
  let truncatedByCap = false
  let hasRemainingEvents = false
  /**
   * 모든 SaaS 를 합친 최근 MAX_EVENTS 건의 가장 오래된 시각. 상한에 닿기 전에는 null.
   * SaaS 는 각자 최신순으로 읽으므로, 이 시각보다 오래된 행에 이른 SaaS 는 더 읽어도 남지 않는다.
   */
  let cutoffMs: number | null = null
  const timeOf = (e: TimelineEvent) => (e.occurred_at ? Date.parse(e.occurred_at) : 0)
  const newestFirst = (a: TimelineEvent, b: TimelineEvent) => (timeOf(b) - timeOf(a)) || a.origin_key.localeCompare(b.origin_key)
  /** 상한을 넘으면 최근 MAX_EVENTS 건만 남기고 기준 시각을 다시 잡는다 */
  const trimToCap = () => {
    if (events.length <= MAX_EVENTS) return
    events.sort(newestFirst)
    events = events.slice(0, MAX_EVENTS)
    cutoffMs = timeOf(events[events.length - 1]!)
    truncatedByCap = true
  }

  const pump = () => {
    while (reading < READ_CONCURRENCY && queue.length) {
      const provider = queue.shift()!
      reading++
      reads.set(provider, readProvider(provider).finally(() => { reading--; pump() }))
    }
  }
  const donePages = new Set<string>()
  const progress = () => ({ done: donePages.size + [...loads.values()].filter(p => p.state === 'failed' && !donePages.has(p.provider)).length, total: loads.size })

  let lastEmitTime = 0
  const emitPage = (force = false) => {
    const now = (options.now ?? Date.now)()
    const interval = options.onPageIntervalMs ?? 1000
    if (force || now - lastEmitTime >= interval) {
      lastEmitTime = now
      options.onPage?.({ events: [...events], range, progress: progress() })
    }
  }

  const readProvider = async (provider: string) => {
    const load = loads.get(provider)!
    let nextCursor: string | null | undefined = undefined
    let useCursor: boolean | null = null

    for (let page = 0; page < SAFE_MAX_PAGES; page++) {
      const readUrl: string = useCursor === false
        ? `${apiBase}/events/read?queryId=${queryId}&provider=${encodeURIComponent(provider)}&page=${page}`
        : nextCursor
          ? `${apiBase}/events/read?queryId=${queryId}&provider=${encodeURIComponent(provider)}&cursor=${encodeURIComponent(nextCursor)}`
          : `${apiBase}/events/read?queryId=${queryId}&provider=${encodeURIComponent(provider)}&cursor=&page=${page}`

      const r = await getJson<{ items?: TimelineEvent[]; nextPage?: number | null; nextCursor?: string | null; total?: number }>(readUrl, options.signal, options.fetch)
      if (r.status !== 200) {
        Object.assign(load, { state: 'failed', error: r.body.error ?? 'd1_read_failed' })
        report(phaseOf())
        return
      }

      if (typeof r.body.total === 'number') {
        load.total = r.body.total
      }

      const items = r.body.items ?? []
      for (const e of items) events.push(e)
      load.count += items.length
      // 상한을 넘으면 바로 잘라 기준 시각을 잡는다. 그 뒤로 오래된 행에 이른 SaaS 는 읽기를 멈춘다
      trimToCap()
      /** 이 페이지의 가장 오래된 행이 기준 시각보다 오래됐으면 이 SaaS 의 나머지는 남지 않는다 */
      const pastCutoff = cutoffMs !== null && items.length > 0 && timeOf(items[items.length - 1]!) < cutoffMs

      emitPage(false)
      report(phaseOf())

      if (useCursor === null) {
        useCursor = r.body.nextCursor !== undefined
      }

      if (useCursor) {
        nextCursor = r.body.nextCursor
        if (!nextCursor) break
      } else {
        if (typeof r.body.nextPage !== 'number') break
      }

      if (pastCutoff) {
        truncatedByCap = true
        break
      }
      if (page === SAFE_MAX_PAGES - 1) {
        hasRemainingEvents = true
      }
    }
    donePages.add(provider)
    emitPage(true)
  }

  let jobState = body.state ?? 'running'
  const phaseOf = (): LoadPhase => [...loads.values()].some(p => p.state === 'waiting' || p.state === 'searching') ? 'search'
    : jobState === 'queued' || jobState === 'running' ? 'store' : 'read'
  for (;;) {
    for (const p of body.providers ?? []) {
      const load = loads.get(p.provider) ?? { provider: p.provider, state: p.state, cached: p.cached, count: 0 }
      loads.set(p.provider, load)
      // A provider read here keeps the state of its own reading; others follow the connector.
      if (!reads.has(p.provider) && !queue.includes(p.provider)) Object.assign(load, { state: p.state, cached: p.cached, ...(p.state === 'failed' ? { error: p.reason ?? 'splunk_failed' } : {}) })
      if (p.state === 'complete' && !reads.has(p.provider) && !queue.includes(p.provider)) { load.state = 'complete'; queue.push(p.provider) }
    }
    jobState = body.state ?? jobState
    pump()
    report(phaseOf())
    if (jobState !== 'queued' && jobState !== 'running') break
    if (Date.now() >= deadline) throw new LogLoadError('still_running')
    await wait(options.pollMs ?? POLL_MS, options.signal)
    ;({ status, body } = await getJson<StatusBody>(`${apiBase}/events?queryId=${queryId}`, options.signal, options.fetch))
    if (status !== 200) throw new LogLoadError(body.error ?? `http_${status}`)
  }
  // A connector older than per-provider progress reports none; its results cannot be read here.
  if (!loads.size) throw new LogLoadError('connector_outdated')
  // Every provider that ended complete is being read; wait for the queue to drain.
  while (queue.length || reading) await Promise.all([...reads.values()])
  trimToCap()

  const failedJob = jobState === 'failed' || jobState === 'cancelled'
  if (failedJob && !events.length) throw new LogLoadError(body.error ?? 'splunk_failed')

  let links: EventLink[] | null = null
  if (!failedJob) {
    report('read')
    links = []
    const keptKeys = new Set(events.map(e => e.origin_key))
    let nextLinkCursor: string | null | undefined = undefined
    let useLinkCursor: boolean | null = null

    // 상한에 닿았으면 남긴 이벤트의 가장 오래된 시각을 넘겨 그보다 새로운 이벤트 사이의 연결만 받는다(옛 서버는 무시한다)
    const since = cutoffMs !== null ? `&since=${cutoffMs}` : ''
    for (let page = 0; page < SAFE_MAX_PAGES; page++) {
      if (links.length >= MAX_LINKS) break
      const linkUrl: string = useLinkCursor === false
        ? `${apiBase}/events/links?queryId=${queryId}&page=${page}${since}`
        : nextLinkCursor
          ? `${apiBase}/events/links?queryId=${queryId}&cursor=${encodeURIComponent(nextLinkCursor)}${since}`
          : `${apiBase}/events/links?queryId=${queryId}&cursor=&page=${page}${since}`

      const r = await getJson<{ links?: EventLink[]; nextPage?: number | null; nextCursor?: string | null }>(linkUrl, options.signal, options.fetch)
      if (r.status !== 200) { links = null; break }

      if (useLinkCursor === null) {
        useLinkCursor = r.body.nextCursor !== undefined
      }

      const rawLinks = r.body.links ?? []
      const matching = rawLinks.filter((l: EventLink) => (!l.from || keptKeys.has(l.from)) && (!l.to || keptKeys.has(l.to)))
      links.push(...matching)

      if (links.length >= MAX_LINKS) {
        links = links.slice(0, MAX_LINKS)
        break
      }

      if (useLinkCursor) {
        nextLinkCursor = r.body.nextCursor
        if (!nextLinkCursor) break
      } else {
        if (typeof r.body.nextPage !== 'number') break
      }
    }
  }

  emitPage(true)

  const providers = [...loads.values()]
  const completedProviders = providers.filter(p => p.state === 'complete')
  const allCompletedHaveTotal = completedProviders.length > 0 && completedProviders.every(p => typeof p.total === 'number')
  const sumTotal = allCompletedHaveTotal ? completedProviders.reduce((sum, p) => sum + (p.total ?? 0), 0) : null
  const isTruncated = truncatedByCap || hasRemainingEvents || (sumTotal !== null ? sumTotal > events.length : events.length >= MAX_EVENTS)

  let truncProblem: string | null = null
  let truncatedInfo: { total: number | null; loaded: number } | null = null
  if (isTruncated) {
    const m = events.length.toLocaleString('ko-KR')
    const n = sumTotal !== null ? `${sumTotal.toLocaleString('ko-KR')}건` : `${m}건 넘게`
    truncProblem = `전체 ${n} 중 최근 ${m}건만 불러왔습니다. 기간이나 SaaS를 좁혀 다시 조회하세요.`
    truncatedInfo = { total: sumTotal, loaded: events.length }
  }

  const failed = providers.filter(p => p.state === 'failed')
  const problems = [
    truncProblem,
    ...failed.map(p => `${providerName(p.provider)}: ${errorText(p.error)}.`),
    (body.partialReasons ?? []).includes('graph_index_unavailable') ? '그래프와 잇지 못해 이벤트의 계정과 객체 연결이 비어 있습니다.' : null,
    links === null && !failedJob ? '이벤트 연결을 읽지 못했습니다.' : null,
  ].filter((p): p is string => !!p)
  return { events, links, origin: 'splunk', range, generatedAt: new Date().toISOString(), problem: problems.length ? problems.join(' ') : null, providers, truncated: truncatedInfo }
}
