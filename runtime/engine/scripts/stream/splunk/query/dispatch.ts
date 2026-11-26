import { handleRequest } from './handler.ts'
import type { QueryService } from './service.ts'
import type { EventService } from './events.ts'

export interface Services { query: QueryService; events?: EventService }
export type Dispatch = (value: unknown) => Promise<{ status: number; body: unknown }>

/** Both transports share admission and background-search budgets in one process. */
export function createDispatcher(services: Services, maxInflight = 8): Dispatch {
  let inflight = 0
  return async value => {
    const action = (value as { action?: unknown } | null)?.action
    if (inflight >= maxInflight || (action === 'search' || action === 'events') &&
      services.query.activeCount + (services.events?.activeCount ?? 0) >= 8) {
      return { status: 503, body: { error: 'concurrency_limit' } }
    }
    inflight++
    try { return await handleRequest(services.query, value, services.events) }
    finally { inflight-- }
  }
}
