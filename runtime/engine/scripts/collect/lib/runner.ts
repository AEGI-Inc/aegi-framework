/**
 * 호출 실행기. 호출 하나(GH-01 등)가 응답 페이지를 받아 정리하고 원본으로 쓰고 실행 기록을 남긴다.
 *
 * 오류 처리 (계획서 7.2절):
 * - 401 (Slack invalid_auth·token_revoked 포함): 자격증명이 죽은 것이다. 그 SaaS 의 남은 호출을 모두 멈춘다.
 * - 403 (Slack missing_scope 등): 그 호출을 멈추고 failed 로 적는다. 다른 호출은 계속한다
 *   (V-xx 확인 작업처럼 권한이 없을 수 있는 호출이 섞여 있어서다). 실행 끝의 종료 코드는 1.
 * - 404: 기록만 하고 넘어간다 (예: 보호 규칙이 없는 브랜치).
 * - 못 본 것(봇이 채널에 없음 등)은 partial 과 사유로 남긴다. 0건으로 적지 않는다.
 */
import { Sanitizer, DEFAULT_RULES, mergeRules, sha256Hex, type LabelHit } from './sanitize'
import { bodyText, parseNextLink, rateLimitRemaining, shortError, type Auth, type HttpLayer, type HttpRequest, type HttpResponse, type ReadOnlyPostKind } from './http'
import { ScopedAuthError, TokenError } from './auth'
import type { CallRecord, CollectStore, Completeness, CursorState, EnvelopeOperation, LabelEntry, Provider, RunRecord } from './store'

export const COLLECTOR_VERSION = 'aegi-collector/0.1.0'

export type ErrorKind = 'auth' | 'forbidden' | 'not_found' | 'partial' | 'api'

/** 응답이 설정의 테넌트(조직·워크스페이스)와 다르다. 그 SaaS 의 남은 호출을 모두 건너뛴다 */
export class TenantMismatchError extends Error {
  name = 'TenantMismatchError'
}

export class CallError extends Error {
  constructor(public kind: ErrorKind, public status: number, public code: string, message: string) {
    super(message)
  }
}

/** 응답을 보고 오류 종류를 정한다. null 이면 정상 */
export type Classifier = (res: HttpResponse) => { kind: ErrorKind; code: string } | null

export const httpClassifier: Classifier = res => {
  if (res.status >= 200 && res.status < 300) return null
  if (res.status === 401) return { kind: 'auth', code: 'http_401' }
  if (res.status === 403) return { kind: 'forbidden', code: 'http_403' }
  if (res.status === 404) return { kind: 'not_found', code: 'http_404' }
  return { kind: 'api', code: `http_${res.status}` }
}

export interface RuleOverrides {
  contentKeys?: string[]
  dropKeys?: string[]
  keepKeys?: string[]
}

export interface GetOptions {
  url: string
  auth: Auth | null
  /** 원본 봉투의 request_params (예: 어느 저장소의 목록인지) */
  params?: Record<string, unknown>
  classify?: Classifier
  /** 정리 전에 적용할 변환 (예: 웹훅 URL → host·지문, D1 의 JSON 문자열 열 풀기) */
  transform?: (body: any) => any
  rules?: RuleOverrides
  method?: 'GET' | 'POST'
  body?: string
  headers?: Record<string, string>
  readOnlyPost?: ReadOnlyPostKind
  /** 수집 API 목록 호출이 실행한 IR operation. 원본 봉투에 그대로 남는다 */
  operation?: EnvelopeOperation
  /** 저장 전에 응답이 설정의 테넌트인지 본다. 사유를 돌려주면 저장하지 않고 TenantMismatchError 로 멈춘다 */
  verify?: (body: any) => string | null
}

export type Paginate =
  | { kind: 'none' }
  | { kind: 'link' }
  | { kind: 'slack'; param?: string }
  | { kind: 'google' }
  | { kind: 'd1' }
  /** Salesforce SOQL: 본문의 nextRecordsUrl(상대 경로) */
  | { kind: 'salesforce' }
  /** Jira: startAt/maxResults (또는 offset/limit). 배열 본문은 꽉 찬 쪽이면 다음, 객체 본문은 isLast·total 로 */
  | { kind: 'offset'; pageSize: number; offsetParam?: string; limitParam?: string }
  /**
   * Confluence REST v1(감사 기록 /wiki/rest/api/audit): start/limit 이고 isLast·total 이 없다. 본문의 _links.next 를 따른다.
   * 다음 쪽이 있는데 못 따라가면(쪽이 꽉 찼는데 next 없음, 다른 경로, start 가 안 늘어남) partial
   */
  | { kind: 'confluence-v1'; pageSize: number }
  /** Confluence v2: 본문의 _links.next(상대 경로, 커서 포함) */
  | { kind: 'confluence' }
  /**
   * Atlassian Admin API: 본문의 links.next. 같은 주소와 경로가 아니면 실패한다.
   * next 에는 cursor 만 있고 from/to 가 빠지므로(2026-10-30 실측) 지금 요청의 from/to 를 이어 붙인다.
   * v2 API 는 next 에 커서 값만 준다. 그때는 지금 주소에 cursor 로 붙인다
   */
  | { kind: 'atlassian-admin' }
  | { kind: 'aws'; style: 'iam' | 'ec2' | 'rds' | 'lambda' }
  | { kind: 'graph' }
  | { kind: 'o365-mgmt' }

export interface ListOptions extends GetOptions {
  paginate: Paginate
  /** 페이지 응답에서 항목 배열을 꺼낸다 */
  items: (body: any) => any[]
  maxPages?: number
}

export interface CallApi {
  readonly runId: string
  readonly period: { since: string; until: string }
  /** 한 페이지. not_found·partial 이면 null */
  get<T = any>(opts: GetOptions): Promise<T | null>
  /** 여러 페이지를 이어 받아 항목을 모은다 (정리된 항목) */
  list<T = any>(opts: ListOptions): Promise<T[]>
  /** HTTP 가 아닌 출처(CLI·SDK 읽기 명령)의 결과 하나를 get 과 같은 정리 규칙으로 원본 봉투에 남긴다. 1Password 가 쓴다 */
  record<T = any>(opts: RecordOptions): T
  partial(reason: string): void
  /** 부가 조회: 403·API 오류면 호출 전체를 실패시키지 않고 partial(사유)로 남긴다. 401 은 그대로 올린다 */
  optional<T>(label: string, fn: () => Promise<T>): Promise<T | null>
  note(text: string): void
  cursor(stream: string): CursorState | undefined
  setCursor(stream: string, state: Omit<CursorState, 'last_success_at'>): void
  /** 이번 실행에서 앞서 끝난 호출이 저장한 페이지 (정리된 payload). 수집 API 목록 호출의 fanout 이 부모 ID 를 여기서 읽는다 */
  collected(provider: Provider, callId: string): CollectedPage[]
}

export interface RecordOptions {
  /** 원본 봉투의 endpoint. 실행한 읽기 명령을 적는다 (예: op user list) */
  endpoint: string
  body: unknown
  params?: Record<string, unknown>
  transform?: (body: any) => any
  rules?: RuleOverrides
  credentialRef?: string
}

export interface CollectedPage {
  /** 요청 주소 (부모 경로와 맞는 페이지만 고를 때 쓴다) */
  url: string
  request_params: Record<string, unknown>
  payload: unknown
}

export interface CallDef {
  id: string
  provider: Provider
  title: string
  /** 이 호출이 쓰는 자격증명 ID. 원본 봉투에 남는다 */
  credential: string
  /** 실행할 수 없으면 사유 (자격증명 없음, 선행 호출 실패 등) */
  unavailable?: () => string | null
  run(api: CallApi): Promise<void>
}

export interface RunnerOptions {
  store: CollectStore
  http: HttpLayer
  period: { since: string; until: string }
  /** true 면 로그 스트림 커서를 무시하고 since 부터 다시 받는다 (최종 전체 수집, T-41). 새 커서는 저장한다 */
  ignoreCursors?: boolean
  now?: () => Date
  log?: (line: string) => void
}

export class Runner {
  private cursors: Record<string, CursorState>
  private pendingCursors: Record<string, CursorState> = {}
  private aborted = new Map<Provider, string>()
  private pagesByCall = new Map<string, CollectedPage[]>()
  labels: LabelEntry[] = []

  constructor(private opts: RunnerOptions) {
    this.cursors = opts.ignoreCursors ? {} : opts.store.readCursors()
  }

  private now(): string {
    return (this.opts.now?.() ?? new Date()).toISOString()
  }

  async runAll(calls: CallDef[], args: Record<string, unknown>): Promise<RunRecord> {
    const run: RunRecord = {
      run_id: this.opts.store.runId,
      collector_version: COLLECTOR_VERSION,
      started_at: this.now(),
      args,
      period: this.opts.period,
      calls: [],
    }
    for (const call of calls) {
      const rec = await this.runOne(call)
      run.calls.push(rec)
      this.opts.log?.(formatCall(rec))
      this.opts.store.writeRun(run)
    }
    run.finished_at = this.now()
    this.opts.store.writeRun(run)
    this.opts.store.writeCursors({ ...this.opts.store.readCursors(), ...this.pendingCursors })
    this.opts.store.appendLabels(this.labels)
    return run
  }

  async runOne(call: CallDef): Promise<CallRecord> {
    const rec: CallRecord = {
      run_id: this.opts.store.runId,
      call_id: call.id,
      provider: call.provider,
      title: call.title,
      started_at: this.now(),
      pages: 0,
      record_count: 0,
      completeness: 'full',
      reasons: [],
      notes: [],
    }
    const abortedBy = this.aborted.get(call.provider)
    const unavailable = abortedBy ? `aborted_after:${abortedBy}` : call.unavailable?.() ?? null
    if (unavailable) {
      rec.completeness = 'skipped'
      rec.reasons.push(unavailable)
      rec.finished_at = this.now()
      return rec
    }

    const cursorUpdates: Record<string, CursorState> = {}
    const api = this.api(call, rec, cursorUpdates)
    try {
      await call.run(api)
      Object.assign(this.pendingCursors, cursorUpdates)
    } catch (err) {
      rec.completeness = 'failed'
      if (err instanceof CallError) {
        rec.http_status = err.status
        rec.error_code = err.code
        rec.reasons.push(err.message)
        if (err.kind === 'auth') this.aborted.set(call.provider, call.id)
      } else if (err instanceof TenantMismatchError) {
        rec.error_code = 'tenant_mismatch'
        rec.reasons.push(`tenant_mismatch:${err.message}`)
        this.aborted.set(call.provider, call.id)
      } else if (err instanceof ScopedAuthError) {
        rec.error_code = 'scoped_auth'
        rec.reasons.push(err.message)
      } else if (err instanceof TokenError) {
        rec.error_code = 'token_error'
        rec.reasons.push(err.message)
        this.aborted.set(call.provider, call.id)
      } else {
        rec.error_code = 'exception'
        rec.reasons.push(err instanceof Error ? err.message : String(err))
      }
    }
    rec.finished_at = this.now()
    return rec
  }

  private api(call: CallDef, rec: CallRecord, cursorUpdates: Record<string, CursorState>): CallApi {
    const self = this
    const markPartial = (reason: string) => {
      if (rec.completeness === 'full') rec.completeness = 'partial'
      if (!rec.reasons.includes(reason)) rec.reasons.push(reason)
    }

    async function fetchPage(opts: GetOptions): Promise<{ res: HttpResponse; payload: unknown } | null> {
      const res = await self.opts.http.send(opts.url, opts.auth, {
        method: opts.method,
        body: opts.body,
        headers: opts.headers,
        readOnlyPost: opts.method === 'POST' ? (opts.readOnlyPost ?? 'graphql') : undefined,
        onResponse: (req, res) =>
          collectApiWarnings(
            call.provider,
            req,
            res,
            rec,
            typeof res.body === 'object' && res.body !== null ? res.body : undefined,
          ),
      })
      rec.http_status = res.status
      rec.rate_limit_remaining = rateLimitRemaining(res)
      const verdict = (opts.classify ?? httpClassifier)(res)
      if (verdict) {
        const where = `${opts.method ?? 'GET'} ${stripQuery(opts.url)}`
        if (verdict.kind === 'not_found') {
          rec.notes.push(`${verdict.code} ${where}${paramsText(opts.params)}`)
          return null
        }
        if (verdict.kind === 'partial') {
          markPartial(verdict.code)
          rec.notes.push(`${verdict.code} ${where}${paramsText(opts.params)}`)
          return null
        }
        throw new CallError(verdict.kind, res.status, verdict.code, `${verdict.code} ${where}: ${shortError(res)}`)
      }
      const mismatch = opts.verify?.(res.body)
      if (mismatch) throw new TenantMismatchError(mismatch)
      const payload = savePage({
        endpoint: opts.url, method: opts.method ?? 'GET', params: opts.params, status: res.status, original: bodyText(res),
        body: res.body, transform: opts.transform, rules: opts.rules, credentialRef: opts.auth?.ref, operation: opts.operation,
      })
      return { res, payload }
    }

    /** 응답 하나를 정리해 원본 봉투로 저장한다. HTTP(get·list)와 HTTP 가 아닌 출처(record)가 같이 쓴다 */
    function savePage(p: {
      endpoint: string; method: string; params?: Record<string, unknown>; status: number; original: string; body: unknown
      transform?: (body: any) => any; rules?: RuleOverrides; credentialRef?: string; operation?: EnvelopeOperation
    }): unknown {
      const transformed = p.transform ? p.transform(p.body) : p.body
      const sanitizer = new Sanitizer(mergeRules(DEFAULT_RULES, p.rules))
      const payload = sanitizer.value(transformed)
      const page = self.opts.store.nextPage(call.provider, call.id)
      const file = self.opts.store.writeRaw({
        provider: call.provider,
        call_id: call.id,
        page,
        method: p.method,
        endpoint: p.endpoint,
        request_params: p.params ?? {},
        collected_at: self.now(),
        http_status: p.status,
        response_sha256: sha256Hex(p.original),
        payload_sha256: sha256Hex(JSON.stringify(payload)),
        collector_version: COLLECTOR_VERSION,
        credential_ref: p.credentialRef ?? call.credential,
        sanitization: sanitizer.stats,
        ...(p.operation ? { operation: p.operation } : {}),
        payload,
      })
      rec.pages++
      const key = `${call.provider}/${call.id}`
      if (!self.pagesByCall.has(key)) self.pagesByCall.set(key, [])
      self.pagesByCall.get(key)!.push({ url: p.endpoint, request_params: p.params ?? {}, payload })
      self.labels.push(...sanitizer.labels.map((l: LabelHit) => ({ ...l, run_id: self.opts.store.runId, provider: call.provider, call_id: call.id, file })))
      return payload
    }

    return {
      runId: this.opts.store.runId,
      period: this.opts.period,
      async get(opts) {
        const r = await fetchPage(opts)
        if (!r) return null
        rec.record_count++
        return r.payload as any
      },
      async list(opts) {
        const out: any[] = []
        let url: string | undefined = opts.url
        let pages = 0
        while (url) {
          const r = await fetchPage({ ...opts, url })
          if (!r) {
            // 앞 쪽이 가리킨 다음 쪽을 못 받았다(404 등). 받은 만큼만 남으니 full 로 두지 않는다
            if (pages > 0) markPartial('next_page_unavailable')
            break
          }
          const items = opts.items(r.payload) ?? []
          out.push(...items)
          rec.record_count += items.length
          pages++
          const next = nextUrl(opts.paginate, url, r.res, r.payload, items.length, markPartial)
          rec.next_cursor = next ?? null
          if (next && opts.maxPages && pages >= opts.maxPages) {
            markPartial(`max_pages:${opts.maxPages}`)
            break
          }
          url = next
        }
        return out
      },
      record(opts) {
        const original = JSON.stringify(opts.body ?? null)
        const payload = savePage({
          endpoint: opts.endpoint, method: 'GET', params: opts.params, status: 200, original,
          body: opts.body, transform: opts.transform, rules: opts.rules, credentialRef: opts.credentialRef,
        })
        rec.record_count++
        return payload as any
      },
      partial: markPartial,
      async optional(label, fn) {
        try {
          return await fn()
        } catch (err) {
          if (!(err instanceof CallError) || err.kind === 'auth') throw err
          markPartial(`${label}:${err.code}`)
          rec.notes.push(err.message)
          return null
        }
      },
      note(text) {
        rec.notes.push(text)
      },
      cursor(stream) {
        return self.pendingCursors[stream] ?? self.cursors[stream]
      },
      setCursor(stream, state) {
        cursorUpdates[stream] = { ...state, last_success_at: self.now() }
      },
      collected(provider, callId) {
        return [...(self.pagesByCall.get(`${provider}/${callId}`) ?? [])]
      },
    }
  }
}

function nextUrl(p: Paginate, current: string, res: HttpResponse, payload: any, count: number, partial: (reason: string) => void): string | undefined {
  switch (p.kind) {
    case 'none':
      return undefined
    case 'link':
      return parseNextLink(res.headers['link'])
    case 'slack': {
      const cursor = (res.body as any)?.response_metadata?.next_cursor
      return cursor ? withParam(current, p.param ?? 'cursor', cursor) : undefined
    }
    case 'google': {
      const token = (res.body as any)?.nextPageToken
      return token ? withParam(current, 'pageToken', token) : undefined
    }
    case 'd1': {
      const next = payload?.next_since_id
      const limit = Number(new URL(current).searchParams.get('limit') ?? 500)
      return count >= limit && next ? withParam(current, 'since_id', String(next)) : undefined
    }
    case 'salesforce': {
      const next = (res.body as any)?.nextRecordsUrl
      return typeof next === 'string' && next && (res.body as any)?.done === false ? new URL(next, current).toString() : undefined
    }
    case 'offset': {
      const body = res.body as any
      const offsetKey = p.offsetParam ?? 'startAt'
      const limitKey = p.limitParam ?? 'maxResults'
      const startAt = Number(new URL(current).searchParams.get(offsetKey) ?? 0)
      const more = Array.isArray(body) ? count >= p.pageSize
        : body?.isLast === false || (body?.isLast === undefined && typeof body?.total === 'number' && startAt + count < body.total)
      return more && count > 0 ? withParam(withParam(current, offsetKey, String(startAt + count)), limitKey, String(p.pageSize)) : undefined
    }
    case 'confluence': {
      const next = (res.body as any)?._links?.next
      return typeof next === 'string' && next ? new URL(next, current).toString() : undefined
    }
    case 'confluence-v1': {
      // _links.next 는 /wiki 를 뺀 상대 경로라 그대로 이으면 주소가 틀린다(OAuth 게이트웨이 주소도).
      // next 의 start·limit 만 지금 주소에 옮긴다. startDate·endDate 같은 조건은 지금 주소의 것이 남는다
      const next = (res.body as any)?._links?.next
      if (typeof next !== 'string' || !next) {
        // 다음 쪽 표시가 없는데 쪽이 꽉 찼다. 더 있는지 모르니 full 로 두지 않는다
        if (count >= p.pageSize) partial('confluence_page_full_without_next')
        return undefined
      }
      let to: URL
      try { to = new URL(next, 'https://confluence.invalid') } catch { partial('confluence_next_invalid'); return undefined }
      const now = new URL(current)
      const start = to.searchParams.get('start') ?? ''
      if (to.origin !== 'https://confluence.invalid' && to.origin !== now.origin) { partial('confluence_next_outside_collection'); return undefined }
      if (!now.pathname.endsWith(to.pathname)) { partial('confluence_next_outside_collection'); return undefined }
      if (!/^\d+$/.test(start) || Number(start) <= Number(now.searchParams.get('start') ?? 0)) { partial('confluence_next_not_advancing'); return undefined }
      const limit = to.searchParams.get('limit')
      return withParam(withParam(current, 'start', start), 'limit', limit && /^\d+$/.test(limit) ? limit : String(p.pageSize))
    }
    case 'aws': {
      const pld = payload as any
      switch (p.style) {
        case 'iam': {
          const isTruncated = pld?.IsTruncated === true || pld?.IsTruncated === 'true'
          const marker = pld?.Marker
          return isTruncated && typeof marker === 'string' && marker ? withParam(current, 'Marker', marker) : undefined
        }
        case 'ec2': {
          const token = pld?.NextToken ?? pld?.nextToken
          return typeof token === 'string' && token ? withParam(current, 'NextToken', token) : undefined
        }
        case 'rds': {
          const marker = pld?.Marker ?? pld?.marker
          return typeof marker === 'string' && marker ? withParam(current, 'Marker', marker) : undefined
        }
        case 'lambda': {
          const marker = (res.body as any)?.NextMarker ?? pld?.NextMarker
          return typeof marker === 'string' && marker ? withParam(current, 'Marker', marker) : undefined
        }
      }
      return undefined
    }
    case 'atlassian-admin': {
      const next = (res.body as any)?.links?.next
      if (typeof next !== 'string' || !next) return undefined
      // v2 조직 API(디렉터리·사용자·그룹)는 links.next 에 주소가 아니라 커서 값만 준다(공식 문서 예시 "kloHX1ZQVasDAkx_P48NYQ"). 그 값을 cursor 로 붙인다
      if (/^[A-Za-z0-9_=-]+$/.test(next)) return withParam(current, 'cursor', next)
      const now = new URL(current), to = new URL(next, current)
      if (to.origin !== now.origin || to.pathname !== now.pathname || to.username || to.password) throw new Error('atlassian_admin_next_outside_collection')
      // limit 도 다시 붙인다: links.next 는 cursor 만 주고, 빠지면 둘째 쪽부터 기본 30건이 된다(2026-11-19 AT-90 실측)
      for (const k of ['from', 'to', 'limit']) { const v = now.searchParams.get(k); if (v !== null && !to.searchParams.has(k)) to.searchParams.set(k, v) }
      return to.toString()
    }
    case 'graph': {
      const next = (res.body as any)?.['@odata.nextLink']
      if (typeof next !== 'string' || !next) return undefined
      try {
        const u = new URL(next)
        return u.protocol === 'https:' && u.hostname === 'graph.microsoft.com' ? u.toString() : undefined
      } catch {
        return undefined
      }
    }
    case 'o365-mgmt': {
      const next = res.headers['nextpageuri'] ?? res.headers['NextPageUri']
      if (typeof next !== 'string' || !next) return undefined
      try {
        const u = new URL(next)
        return u.protocol === 'https:' && u.hostname === 'manage.office.com' ? u.toString() : undefined
      } catch {
        return undefined
      }
    }
  }
}

export function withParam(url: string, key: string, value: string): string {
  const u = new URL(url)
  u.searchParams.set(key, value)
  return u.toString()
}

export function buildUrl(base: string, query: Record<string, string | number | boolean | undefined> = {}): string {
  const u = new URL(base)
  for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, String(v))
  return u.toString()
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target && typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function collectApiWarnings(
  provider: Provider,
  req: HttpRequest,
  res: HttpResponse,
  rec: CallRecord,
  parsedPayload?: unknown,
): void {
  const found: string[] = []
  for (const h of ['deprecation', 'sunset', 'warning'] as const) {
    const val = findHeader(res.headers, h)
    if (val) found.push(`header:${h}=${val.slice(0, 200)}`)
  }
  const requestedGhVer = findHeader(req.headers, 'x-github-api-version')
  const selectedGhVer = findHeader(res.headers, 'x-github-api-version-selected')
  if (requestedGhVer && selectedGhVer && selectedGhVer !== requestedGhVer) {
    found.push(`header:x-github-api-version-selected=${selectedGhVer.slice(0, 200)}`)
  }
  if (provider === 'slack') {
    let body: any = parsedPayload !== undefined ? parsedPayload : res.body
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch { body = null }
    }
    if (body && typeof body === 'object') {
      if (typeof body.warning === 'string' && body.warning.trim()) {
        for (const part of body.warning.split(',')) {
          const code = part.trim()
          if (code) found.push(`slack:${code}`)
        }
      }
      const metaWarnings = body.response_metadata?.warnings
      if (Array.isArray(metaWarnings)) {
        for (const w of metaWarnings) {
          if (typeof w === 'string' && w.trim()) found.push(`slack:${w.trim()}`)
        }
      }
    }
  }
  if (found.length === 0) return
  const merged = new Set([...(rec.api_warnings ?? []), ...found])
  rec.api_warnings = [...merged].sort().slice(0, 20)
}

function stripQuery(url: string): string {
  return url.split('?')[0]
}

function paramsText(params?: Record<string, unknown>): string {
  return params && Object.keys(params).length ? ` ${JSON.stringify(params)}` : ''
}

const ICON: Record<Completeness, string> = { full: '✓', partial: '◐', best_effort: '◐', failed: '✗', skipped: '–' }

export function formatCall(r: CallRecord): string {
  const head = `${ICON[r.completeness]} [${r.provider}] ${r.call_id} — ${r.title}: ${r.completeness}, ${r.record_count}건 / ${r.pages}쪽`
  const lines = [head]
  for (const reason of r.reasons) lines.push(`    사유: ${reason}`)
  if (r.notes.length) lines.push(`    기록 ${r.notes.length}건 (예: ${r.notes[0]})`)
  return lines.join('\n')
}
