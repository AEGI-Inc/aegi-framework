/**
 * 수집기 HTTP 계층. 읽기 전용을 코드로 강제한다 (계획서 2절 원칙 1).
 *
 * - 데이터 호출은 GET 만. 예외는 GitHub GraphQL 조회(query) 하나이고 mutation 은 막는다.
 * - 토큰 교환(POST)은 auth/ 모듈이 전송 계층을 직접 부른다. 데이터를 바꾸는 호출이 아니다.
 * - 오류 처리 (7.2절): 429 는 Retry-After 만큼(없으면 x-rate-limit-reset 시각까지) 기다려 다시, 5xx 는 최대 3회 다시.
 *   401·403·404 의 판단은 호출 실행기(runner.ts)가 한다.
 */
import { fetchTransport, parseNextLink, redact, sleep, type HttpRequest, type HttpResponse, type Transport } from '../../setup/core'
import { SNOWFLAKE_LOG_STATEMENTS } from './snowflakeStatements'

export { fetchTransport, parseNextLink, redact, type HttpRequest, type HttpResponse, type Transport }

export interface Auth {
  /** 자격증명 ID (CRED-GH-01 등). 원본 봉투에 이것만 남긴다 */
  ref: string
  headers(method: string, url: string): Promise<Record<string, string>>
  /** 응답을 보고 한 번 더 보내야 하면 true (Okta DPoP nonce 갱신) */
  retryAfterResponse?(res: HttpResponse): boolean
}

export class ReadOnlyViolation extends Error {}

export type ReadOnlyPostKind = 'graphql' | 'snowflake-log' | 'gcp-log'

export interface SendOptions {
  method?: 'GET' | 'POST'
  body?: string
  headers?: Record<string, string>
  /** POST 를 허용하는 읽기 호출의 종류 */
  readOnlyPost?: ReadOnlyPostKind
  /** 최종 응답을 받았을 때 호출되는 콜백 */
  onResponse?: (req: HttpRequest, res: HttpResponse) => void
}

export interface HttpLayerOptions {
  transport: Transport
  /** 대기 배수 (테스트에서는 0) */
  retryDelayMs: number
  maxRetry429?: number
  /** 지금 시각(ms). x-rate-limit-reset 까지 남은 시간을 잴 때 쓴다 (테스트에서 고정) */
  now?: () => number
  /** 모든 최종 응답에 대해 호출되는 콜백 */
  onResponse?: (req: HttpRequest, res: HttpResponse) => void
}

/** x-rate-limit-reset 을 따라 기다리는 가장 긴 시간(초). Okta 한도 창은 1분이라, 시계가 어긋나도 이보다 오래 멈추지 않는다 */
export const RATE_RESET_WAIT_MAX_SECONDS = 120

/**
 * 429 뒤 다시 보내기 전에 기다릴 초.
 * - Retry-After(초)가 있으면 그만큼. 값이 이상하면 1초.
 * - 없고 x-rate-limit-reset(한도가 풀리는 시각, epoch 초)이 있으면 그 시각 1초 뒤까지 (#436, Okta 는 Retry-After 를 주지 않는다).
 * - 둘 다 없으면(Atlassian Admin API 등) 1, 2, 4, 8, 16 배로 늘린다.
 */
export function rateLimitWaitSeconds(res: HttpResponse, attempt: number, nowMs: number): number {
  const retryAfter = res.headers['retry-after']
  if (retryAfter !== undefined) {
    const after = Number(retryAfter)
    return Number.isFinite(after) && after > 0 ? after : 1
  }
  const resetHeader = res.headers['x-rate-limit-reset']
  const reset = resetHeader === undefined ? NaN : Number(resetHeader)
  if (Number.isFinite(reset)) {
    const wait = Math.ceil(reset - nowMs / 1000) + 1
    return Math.min(Math.max(wait, 1), RATE_RESET_WAIT_MAX_SECONDS)
  }
  return 2 ** (attempt - 1)
}

export class HttpLayer {
  constructor(private opts: HttpLayerOptions) {}

  async send(url: string, auth: Auth | null, options: SendOptions = {}): Promise<HttpResponse> {
    const method = options.method ?? 'GET'
    if (method !== 'GET' && !isAllowedReadOnlyPost(url, options.body, options.readOnlyPost)) {
      throw new ReadOnlyViolation(`수집기는 쓰기 요청을 보내지 않는다: ${method} ${url}`)
    }
    let serverRetries = 0
    let rateRetries = 0
    let authRetried = false
    for (;;) {
      const headers: Record<string, string> = { Accept: 'application/json', ...(options.headers ?? {}), ...(auth ? await auth.headers(method, url) : {}) }
      if (options.body !== undefined) headers['Content-Type'] = 'application/json'
      const req: HttpRequest = { method, url, headers, body: options.body }
      const res = await this.opts.transport(req)
      if (res.status === 429 && rateRetries < (this.opts.maxRetry429 ?? 5)) {
        rateRetries++
        await sleep(rateLimitWaitSeconds(res, rateRetries, (this.opts.now ?? Date.now)()) * this.opts.retryDelayMs)
        continue
      }
      if (res.status >= 500 && serverRetries < 3) {
        serverRetries++
        await sleep(serverRetries * this.opts.retryDelayMs)
        continue
      }
      if (!authRetried && auth?.retryAfterResponse?.(res)) {
        authRetried = true
        continue
      }
      options.onResponse?.(req, res)
      this.opts.onResponse?.(req, res)
      return res
    }
  }
}

const GCP_LOG_BODY_KEYS = new Set(['resourceNames', 'filter', 'orderBy', 'pageSize', 'pageToken'])
const SNOWFLAKE_LOG_BODY_KEYS = new Set(['statement', 'timeout', 'bindings'])

function parseJsonObject(body: string | undefined): Record<string, unknown> | null {
  if (!body) return null
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return parsed as Record<string, unknown>
}

export function isGcpLogListRequest(url: string, body: string | undefined): boolean {
  if (url !== 'https://logging.googleapis.com/v2/entries:list') return false
  const obj = parseJsonObject(body)
  if (!obj) return false
  return Object.keys(obj).every(k => GCP_LOG_BODY_KEYS.has(k))
}

export function isSnowflakeLogStatementRequest(url: string, body: string | undefined): boolean {
  if (url.includes('?')) return false
  let u: URL
  try { u = new URL(url) } catch { return false }
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.snowflakecomputing.com') || u.hostname.length <= '.snowflakecomputing.com'.length) return false
  if (u.pathname !== '/api/v2/statements' || u.search !== '') return false
  const obj = parseJsonObject(body)
  if (!obj) return false
  if (!Object.keys(obj).every(k => SNOWFLAKE_LOG_BODY_KEYS.has(k))) return false
  return typeof obj.statement === 'string' && SNOWFLAKE_LOG_STATEMENTS.includes(obj.statement)
}

export function isAllowedReadOnlyPost(url: string, body: string | undefined, kind: ReadOnlyPostKind | undefined): boolean {
  if (kind === 'graphql') return isGraphqlQuery(body)
  if (kind === 'gcp-log') return isGcpLogListRequest(url, body)
  if (kind === 'snowflake-log') return isSnowflakeLogStatementRequest(url, body)
  return false
}

/** 익명 조회(`{ ... }`)나 `query` 연산만 허용. mutation·subscription 은 거부 */
export function isGraphqlQuery(body: string | undefined): boolean {
  if (!body) return false
  let query: unknown
  try { query = (JSON.parse(body) as { query?: unknown }).query } catch { return false }
  if (typeof query !== 'string') return false
  const q = query.replace(/#[^\n]*/g, '').trim()
  return (q.startsWith('{') || /^query\b/.test(q)) && !/\b(mutation|subscription)\b/.test(q)
}

export function rateLimitRemaining(res: HttpResponse): number | null {
  const v = res.headers['x-ratelimit-remaining'] ?? res.headers['x-rate-limit-remaining']
  return v === undefined ? null : Number(v)
}

export function bodyText(res: HttpResponse): string {
  return typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? null)
}

export function shortError(res: HttpResponse): string {
  const b = res.body as { message?: string; error?: string | { message?: string; status?: string }; errorSummary?: string; error_description?: string } | string | null
  // Google 은 { error: { code, message, status } } 로 준다
  const nested = b && typeof b === 'object' && b.error && typeof b.error === 'object' ? `${b.error.status ?? ''} ${b.error.message ?? ''}`.trim() : undefined
  const text = typeof b === 'string' ? b : b?.message ?? nested ?? b?.errorSummary ?? b?.error_description ?? (typeof b?.error === 'string' ? b.error : undefined) ?? JSON.stringify(b)
  return redact(String(text)).slice(0, 200)
}
