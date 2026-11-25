/**
 * Control-plane side of the Splunk connector. The connector inside the customer network opens every
 * connection outbound: it long-polls for scoped query requests and posts replies. Free SPL is validated by the query service.
 * ConnectorBroker keeps state in memory, so one process must own it (the local dev server).
 * D1Relay keeps the same queue in D1 so stateless Pages Functions can share it (production).
 */
import type { D1Like } from './exceptions'

export interface RelayScope { workspace: string; principal: string; policyVersion: string }
export interface RelayRequest { action: string; scope: RelayScope; plan?: unknown; queryId?: unknown; pageToken?: unknown; events?: unknown; waitSeconds?: number; reuse?: boolean }
export interface RelayReply { status: number; body: Record<string, unknown> }
export interface RelayItem { id: string; request: RelayRequest }

/** Bounds control replies; event and AI search results are read from log_*. D1 rows hold up to 2 MB. */
export const RELAY_REPLY_LIMIT = 1_000_000
const BATCH = 4

/** What the Splunk proxy and the connector endpoints need from a queue. */
export interface Relay {
  request(request: RelayRequest, timeoutMs: number): Promise<RelayReply>
  poll(waitMs: number, signal?: AbortSignal): Promise<RelayItem[]>
  respond(id: string, reply: RelayReply): boolean | Promise<boolean>
  requeue(items: RelayItem[]): void | Promise<void>
}

export class ConnectorBroker implements Relay {
  private queue: RelayItem[] = []
  private readonly waiting = new Map<string, (reply: RelayReply) => void>()
  private pollers: Array<(items: RelayItem[]) => void> = []
  lastPoll = 0
  constructor(private readonly now = Date.now) {}

  /** Resolves with the connector reply, or 503 when no connector answers in time. Never rejects. */
  request(request: RelayRequest, timeoutMs: number): Promise<RelayReply> {
    const id = crypto.randomUUID()
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        this.queue = this.queue.filter(item => item.id !== id)
        resolve({ status: 503, body: { error: 'splunk_connector_unavailable' } })
      }, timeoutMs)
      this.waiting.set(id, reply => { clearTimeout(timer); resolve(reply) })
      this.queue.push({ id, request })
      this.flush()
    })
  }

  /** A poll whose connection closed (signal aborted) never takes requests: they stay queued for the next poll. */
  poll(waitMs: number, signal?: AbortSignal): Promise<RelayItem[]> {
    this.lastPoll = this.now()
    if (signal?.aborted) return Promise.resolve([])
    if (this.queue.length) return Promise.resolve(this.queue.splice(0, BATCH))
    return new Promise(resolve => {
      const done = (items: RelayItem[]) => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort)
        this.pollers = this.pollers.filter(p => p !== poller)
        resolve(items)
      }
      const poller = (items: RelayItem[]) => done(items)
      const abort = () => done([])
      const timer = setTimeout(abort, waitMs)
      signal?.addEventListener('abort', abort, { once: true })
      this.pollers.push(poller)
    })
  }

  /** Puts undelivered requests back at the front, unless they already timed out. */
  requeue(items: RelayItem[]) {
    this.queue.unshift(...items.filter(item => this.waiting.has(item.id)))
    this.flush()
  }

  /** False when the request already timed out or never existed. */
  respond(id: string, reply: RelayReply): boolean {
    const resolve = this.waiting.get(id)
    if (!resolve) return false
    this.waiting.delete(id)
    resolve(reply)
    return true
  }

  private flush() {
    while (this.pollers.length && this.queue.length) this.pollers.shift()!(this.queue.splice(0, BATCH))
  }
}

const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))

/** Constant-time over fixed-length digests, so key length does not leak through timing. */
export async function connectorAuthorized(header: string | null | undefined, key: string | undefined) {
  if (!key || key.length < 32 || !header) return false
  const [a, b] = await Promise.all([digest(header), digest(`Bearer ${key}`)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Connector endpoints: POST poll and POST respond. The caller has already authorized the connector. */
export async function connectorRoute(route: 'poll' | 'respond', body: unknown, broker: Relay, waitMs = 25_000, signal?: AbortSignal): Promise<RelayReply> {
  if (route === 'poll') {
    const requests = await broker.poll(waitMs, signal)
    // The connector hung up while these were being handed over: keep them for its next poll.
    if (signal?.aborted && requests.length) { await broker.requeue(requests); return { status: 499, body: { error: 'connector_gone' } } }
    return { status: 200, body: { requests } }
  }
  const v = body as { id?: unknown; status?: unknown; body?: unknown } | null
  if (!v || typeof v.id !== 'string' || !Number.isInteger(v.status) || !v.body || typeof v.body !== 'object' || Array.isArray(v.body)) return { status: 400, body: { error: 'invalid_reply' } }
  const reply = JSON.stringify(v.body).length > RELAY_REPLY_LIMIT
    ? { status: 503, body: { error: 'splunk_reply_too_large' } }
    : { status: v.status as number, body: v.body as Record<string, unknown> }
  return await broker.respond(v.id, reply) ? { status: 200, body: { ok: true } } : { status: 410, body: { error: 'request_expired' } }
}

type Row = { id: string; request: string }
const sleepFor = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * The same queue in D1, for stateless Pages Functions. Each side waits by re-reading its row:
 * the requester every 0.2 s for the first 2 s then every 1 s, the connector poll every 0.25 s.
 * Short checks avoid adding seconds to quick status replies; later 1 s checks keep a long wait bounded.
 * Claiming is one UPDATE ... RETURNING, so two polls never take the same request.
 */
export class D1Relay implements Relay {
  constructor(private readonly db: D1Like, private readonly now = Date.now, private readonly sleep = sleepFor,
    private readonly replyEveryMs = 200, private readonly pollEveryMs = 250, private readonly quickReplyMs = 2000) {}

  async request(request: RelayRequest, timeoutMs: number): Promise<RelayReply> {
    const id = crypto.randomUUID(), start = this.now()
    await this.db.prepare('DELETE FROM splunk_relay WHERE expires_at < ?').bind(start - 60_000).run()
    await this.db.prepare("INSERT INTO splunk_relay (id, request, state, created_at, expires_at) VALUES (?, ?, 'queued', ?, ?)")
      .bind(id, JSON.stringify(request), start, start + timeoutMs).run()
    // Short waits answer quickly; longer ones back off to 1 s so one request stays within D1's per-invocation query budget.
    while (this.now() - start < timeoutMs) {
      await this.sleep(this.now() - start < this.quickReplyMs ? this.replyEveryMs : Math.max(this.replyEveryMs, 1000))
      const row = await this.db.prepare("SELECT reply_status, reply_body FROM splunk_relay WHERE id = ? AND state = 'answered'").bind(id)
        .first<{ reply_status: number; reply_body: string }>()
      if (row) {
        await this.db.prepare('DELETE FROM splunk_relay WHERE id = ?').bind(id).run()
        return { status: row.reply_status, body: JSON.parse(row.reply_body) as Record<string, unknown> }
      }
    }
    await this.db.prepare('DELETE FROM splunk_relay WHERE id = ?').bind(id).run()
    return { status: 503, body: { error: 'splunk_connector_unavailable' } }
  }

  async poll(waitMs: number, signal?: AbortSignal): Promise<RelayItem[]> {
    const start = this.now()
    while (!signal?.aborted) {
      const now = this.now()
      const { results } = await this.db.prepare(`UPDATE splunk_relay SET state = 'taken' WHERE id IN (
        SELECT id FROM splunk_relay WHERE state = 'queued' AND expires_at > ? ORDER BY created_at LIMIT ${BATCH}) RETURNING id, request`).bind(now).all<Row>()
      if (results.length) return results.map(r => ({ id: r.id, request: JSON.parse(r.request) as RelayRequest }))
      if (now - start + this.pollEveryMs >= waitMs) return []
      await this.sleep(this.pollEveryMs)
    }
    return []
  }

  async respond(id: string, reply: RelayReply) {
    const { meta } = await this.db.prepare("UPDATE splunk_relay SET state = 'answered', reply_status = ?, reply_body = ? WHERE id = ? AND state = 'taken' AND expires_at > ?")
      .bind(reply.status, JSON.stringify(reply.body), id, this.now()).run()
    return (meta?.changes ?? 0) === 1
  }

  async requeue(items: RelayItem[]) {
    for (const item of items) await this.db.prepare("UPDATE splunk_relay SET state = 'queued' WHERE id = ? AND state = 'taken'").bind(item.id).run()
  }
}
