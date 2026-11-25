import type { QueryService, Scope } from './service.ts'
import { QueryError } from './workspace.ts'
import type { EventService } from './events.ts'

/** One request in the Gateway API shape. Shared by the loopback Gateway and the outbound connector. */
export async function handleRequest(service: QueryService, value: unknown, events?: EventService): Promise<{ status: number; body: unknown }> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QueryError('invalid_request')
    const v = value as { action?: unknown; scope?: unknown; plan?: unknown; queryId?: unknown; events?: unknown; reuse?: unknown }
    const scope = v.scope as Scope
    // Standard event lookup (events.ts). Callers read finished providers from the D1 log cache, never through this service.
    // A Gateway without an event service refuses it like any unknown action.
    if (typeof v.action === 'string' && v.action.startsWith('events') && events) {
      switch (v.action) {
        case 'events': {
          // A caller behind a relay may ask to wait (up to 15 s) so it does not have to poll the status.
          const wait = Number((value as { waitSeconds?: unknown }).waitSeconds ?? 0)
          if (!Number.isInteger(wait) || wait < 0 || wait > 15) throw new QueryError('invalid_wait')
          const started = events.start(scope, v.events, v.reuse === true)
          if (wait) {
            let timer: ReturnType<typeof setTimeout> | undefined
            try { await Promise.race([events.settled(started.queryId), new Promise(r => { timer = setTimeout(r, wait * 1000) })]) }
            finally { clearTimeout(timer) }
          }
          return { status: 200, body: wait ? events.status(scope, started.queryId) : started }
        }
        case 'events_status': return { status: 200, body: events.status(scope, v.queryId) }
        case 'events_cancel': return { status: 200, body: await events.cancel(scope, v.queryId) }
      }
    }
    switch (v.action) {
      case 'schema': return { status: 200, body: service.schema(scope) }
      case 'search': return { status: 200, body: service.start(scope, v.plan) }
      case 'status': return { status: 200, body: service.status(scope, v.queryId as string) }
      default: return { status: 400, body: { error: 'unsupported_action' } }
    }
  } catch (e) { return { status: e instanceof QueryError ? 400 : 500, body: { error: e instanceof QueryError ? e.code : 'gateway_failed' } } }
}
