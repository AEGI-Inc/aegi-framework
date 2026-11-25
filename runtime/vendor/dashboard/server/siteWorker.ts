// Cloudflare Worker — 정적 자산과 API(/api/measured/*, /api/connector/*) 단일 진입점
import { handleConnector, type ConnectorEnv } from './connector'
import { handleMeasured, type MeasuredEnv } from './measured'

export type SiteEnv = MeasuredEnv & ConnectorEnv & {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export interface SiteHandlers {
  measured?: (request: Request, env: MeasuredEnv) => Promise<Response> | Response
  connector?: (request: Request, env: ConnectorEnv) => Promise<Response> | Response
}

export function handleSiteWorker(request: Request, env: SiteEnv, handlers: SiteHandlers = {}): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (pathname.startsWith('/api/measured/')) {
    return Promise.resolve((handlers.measured ?? handleMeasured)(request, env))
  }
  if (pathname.startsWith('/api/connector/')) {
    return Promise.resolve((handlers.connector ?? handleConnector)(request, env))
  }
  return env.ASSETS.fetch(request)
}

export function createSiteWorker(handlers: SiteHandlers = {}) {
  return {
    fetch(request: Request, env: SiteEnv): Promise<Response> {
      return handleSiteWorker(request, env, handlers)
    },
  }
}

export default createSiteWorker()
