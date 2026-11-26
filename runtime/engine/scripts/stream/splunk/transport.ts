/**
 * Splunk 검색 전송 (SPLUNK_SPEC.md 1절 searchTransport). 허용한 경로와 메서드만 보낸다.
 * 수집기 HttpLayer 의 읽기 전용 제한은 풀지 않고 이 모듈을 따로 둔다.
 */
import crypto from 'crypto'
import https from 'https'
import type { SplunkConnection } from './types'

export interface WireRequest {
  method: 'GET' | 'POST' | 'DELETE'
  url: string
  headers: Record<string, string>
  body?: string
}
export interface WireResponse { status: number; body: string }
export type Wire = (req: WireRequest) => Promise<WireResponse>

export class TransportError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

const SID = '[A-Za-z0-9_.\\-]+'
/** 허용 경로. 이 밖의 요청은 보내기 전에 거절한다 */
const ALLOWED: Array<{ method: WireRequest['method']; path: RegExp; base: 'search' | 'hec' }> = [
  { method: 'POST', path: /^\/services\/search\/jobs$/, base: 'search' },
  { method: 'GET', path: new RegExp(`^/services/search/jobs/${SID}$`), base: 'search' },
  { method: 'GET', path: new RegExp(`^/services/search/v2/jobs/${SID}/results$`), base: 'search' },
  { method: 'DELETE', path: new RegExp(`^/services/search/jobs/${SID}$`), base: 'search' },
  { method: 'POST', path: /^\/services\/collector\/event$/, base: 'hec' },
]

const normFingerprint = (fp: string) => fp.replace(/[^A-Fa-f0-9]/g, '').toUpperCase()

/**
 * 인증서 지문을 고정한 HTTPS. 자체 서명 인증서라 체인 검증 대신 지문을 비교하고,
 * 지문을 확인한 뒤에만 본문을 보낸다 (소켓을 재사용하지 않는다).
 */
export function pinnedHttpsWire(tlsSha256: string | undefined, timeoutMs = 30_000, maxResponseBytes = 10_000_000): Wire {
  if (!tlsSha256) throw new TransportError('SPLUNK_TLS_SHA256 이 없다. 인증서 지문 없이 연결하지 않는다')
  const expected = normFingerprint(tlsSha256)
  return req => new Promise((resolve, reject) => {
    const url = new URL(req.url)
    const r = https.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: req.method,
      headers: { ...req.headers, ...(req.body !== undefined ? { 'Content-Length': String(Buffer.byteLength(req.body)) } : {}) },
      agent: false, rejectUnauthorized: false, timeout: timeoutMs,
    }, res => {
      let data = ''
      res.setEncoding('utf8')
      let bytes = 0
      res.on('data', c => { bytes += Buffer.byteLength(c); if (bytes > maxResponseBytes) { r.destroy(new TransportError('응답 크기 한도 초과')); return }; data += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
    })
    r.on('timeout', () => r.destroy(new TransportError(`시간 초과 ${timeoutMs}ms`)))
    r.on('error', reject)
    r.on('socket', socket => {
      socket.once('secureConnect', () => {
        const got = normFingerprint((socket as import('tls').TLSSocket).getPeerCertificate().fingerprint256 ?? '')
        if (got !== expected) { r.destroy(new TransportError(`인증서 지문 불일치 (${got.slice(0, 16)}…)`)); return }
        r.end(req.body)
      })
    })
  })
}

export class SearchTransport {
  constructor(private readonly conn: SplunkConnection, private readonly wire: Wire) {}

  private async send(base: 'search' | 'hec', method: WireRequest['method'], path: string, opts: { query?: Record<string, string>; form?: Record<string, string>; body?: string } = {}): Promise<WireResponse> {
    const rule = ALLOWED.find(a => a.base === base && a.method === method && a.path.test(path))
    if (!rule) throw new TransportError(`허용하지 않은 요청: ${method} ${path}`)
    const root = base === 'search' ? this.conn.searchBase : this.conn.hecBase
    if (!root) throw new TransportError(`${base} 주소가 없다`)
    const url = new URL(path, root)
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v)
    const headers: Record<string, string> = base === 'search'
      ? { Authorization: `Bearer ${this.conn.token}` }
      : { Authorization: `Splunk ${this.conn.hecToken ?? ''}` }
    let body = opts.body
    if (opts.form) { body = new URLSearchParams(opts.form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded' }
    else if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await this.wire({ method, url: url.toString(), headers, body })
    if (res.status === 401 || res.status === 403) throw new TransportError(`인증 거절 ${res.status}`, res.status)
    return res
  }

  async createJob(spl: string, maxTimeSeconds?: number): Promise<string> {
    const res = await this.send('search', 'POST', '/services/search/jobs', { form: { search: spl, output_mode: 'json', exec_mode: 'normal', ...(maxTimeSeconds ? { max_time: String(maxTimeSeconds) } : {}) } })
    if (res.status !== 201 && res.status !== 200) throw new TransportError(`검색 작업 생성 실패 ${res.status}: ${res.body.slice(0, 200)}`, res.status)
    const sid = (JSON.parse(res.body) as { sid?: string }).sid
    if (!sid) throw new TransportError('검색 작업 응답에 SID 가 없다')
    return sid
  }

  async jobStatus(sid: string): Promise<JobContent> {
    const res = await this.send('search', 'GET', `/services/search/jobs/${sid}`, { query: { output_mode: 'json' } })
    if (res.status === 404) return { dispatchState: 'EXPIRED', isDone: false, isFailed: true, resultCount: 0, messages: ['작업 만료'] }
    if (res.status !== 200) throw new TransportError(`작업 상태 조회 실패 ${res.status}`, res.status)
    const c = (JSON.parse(res.body) as { entry?: Array<{ content?: Record<string, unknown> }> }).entry?.[0]?.content ?? {}
    const msgs = (c.messages as Array<{ type?: string; text?: string }> | undefined) ?? []
    return {
      dispatchState: String(c.dispatchState ?? 'UNKNOWN'),
      isDone: c.isDone === true || c.isDone === '1',
      isFailed: c.isFailed === true || c.isFailed === '1',
      resultCount: Number(c.resultCount ?? 0),
      truncated: c.isFinalized === true || c.isFinalized === '1' || c.eventIsTruncated === true || c.eventIsTruncated === '1' || Number(c.dropCount ?? 0) > 0,
      messages: msgs.map(m => `${m.type ?? ''} ${m.text ?? ''}`.trim()),
      messageLevels: msgs.map(m => String(m.type ?? 'UNKNOWN').toUpperCase()),
    }
  }

  async results(sid: string, offset: number, count: number): Promise<{ preview: boolean; rows: Array<Record<string, string>> }> {
    const res = await this.send('search', 'GET', `/services/search/v2/jobs/${sid}/results`, { query: { output_mode: 'json', offset: String(offset), count: String(count) } })
    if (res.status !== 200) throw new TransportError(`결과 조회 실패 ${res.status}`, res.status)
    const j = JSON.parse(res.body) as { preview?: boolean; results?: Array<Record<string, string>> }
    return { preview: j.preview === true, rows: j.results ?? [] }
  }

  async cancel(sid: string): Promise<void> {
    await this.send('search', 'DELETE', `/services/search/jobs/${sid}`)
  }

  /** HEC 전송. 여러 이벤트를 한 요청에 이어 붙인다 */
  async hecSend(events: object[]): Promise<void> {
    if (!events.length) return
    const res = await this.send('hec', 'POST', '/services/collector/event', { body: events.map(e => JSON.stringify(e)).join('\n') })
    if (res.status !== 200) throw new TransportError(`HEC 전송 실패 ${res.status}: ${res.body.slice(0, 200)}`, res.status)
  }
}

export interface JobContent {
  truncated?: boolean
  messageLevels?: string[]
  dispatchState: string
  isDone: boolean
  isFailed: boolean
  resultCount: number
  messages: string[]
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
