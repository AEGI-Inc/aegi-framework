import type { QueryService } from './service.ts'
import { handleRequest } from './handler.ts'
import type { EventService } from './events.ts'
import { controlBase } from './services.ts'
import type { Dispatch } from './dispatch.ts'

/**
 * Outbound connector: runs next to the customer's Splunk and only opens connections to the control plane.
 * It long-polls for requests in the Gateway API shape (JSON plans, never SPL), answers them with the same
 * QueryService the loopback Gateway uses, and posts each reply back. No inbound port is opened.
 */
export const CONNECTOR_VERSION = '1'
const MAX_INFLIGHT = 8
export interface ConnectorOptions {
  controlUrl: string; key: string; service: QueryService; events?: EventService; dispatch?: Dispatch
  fetch?: typeof fetch; signal?: AbortSignal; log?: (line: string) => void
  sleep?: (ms: number) => Promise<void>; maxBackoffMs?: number
}
interface Item { id: string; request: unknown }

export async function runConnector(o: ConnectorOptions) {
  if (o.key.length < 32) throw new Error('connector_key_too_short')
  const base = controlBase(o.controlUrl), request = o.fetch ?? fetch, log = o.log ?? (() => undefined)
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const headers = { Authorization: `Bearer ${o.key}`, 'Content-Type': 'application/json' }
  let backoff = 0, connected = false
  // Requests are answered in the background so a slow one (a remote cancel) never holds up the next poll.
  const inflight = new Set<Promise<void>>()
  const answer = async (item: Item) => {
    const reply = await (o.dispatch ? o.dispatch(item.request) : handleRequest(o.service, item.request, o.events))
    const posted = await request(`${base}/api/connector/respond`, { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ id: item.id, status: reply.status, body: reply.body }) }).catch(() => null)
    if (!posted?.ok) log(`reply not accepted: ${posted?.status ?? 'network'}`)
  }
  while (!o.signal?.aborted) {
    while (inflight.size >= MAX_INFLIGHT) await Promise.race(inflight)
    try {
      const res = await request(`${base}/api/connector/poll`, { method: 'POST', headers, redirect: 'error', body: JSON.stringify({ version: CONNECTOR_VERSION }),
        signal: o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(40_000)]) : AbortSignal.timeout(40_000) })
      // A rejected key will not fix itself: stop instead of hammering the control plane.
      if (res.status === 401) throw Object.assign(new Error('connector_unauthorized'), { fatal: true })
      if (!res.ok) throw new Error(`poll_http_${res.status}`)
      const { requests } = await res.json() as { requests?: Item[] }
      if (!connected) { log('connected to control plane'); connected = true }
      backoff = 0
      for (const item of Array.isArray(requests) ? requests.slice(0, 4) : []) {
        if (!item || typeof item.id !== 'string') continue
        while (inflight.size >= MAX_INFLIGHT) await Promise.race(inflight)
        const task: Promise<void> = answer(item).catch(() => undefined).finally(() => inflight.delete(task))
        inflight.add(task)
      }
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal) throw e
      if (o.signal?.aborted) break
      if (connected) { log('control plane unreachable, retrying'); connected = false }
      backoff = Math.min(backoff ? backoff * 2 : 1000, o.maxBackoffMs ?? 30_000)
      await sleep(backoff)
    }
  }
  await Promise.allSettled(inflight)
}
