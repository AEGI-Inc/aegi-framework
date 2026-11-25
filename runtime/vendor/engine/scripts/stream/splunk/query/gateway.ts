import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { QueryService } from './service.ts'
import type { EventService } from './events.ts'
import { QueryError } from './workspace.ts'
import { createDispatcher, type Dispatch } from './dispatch.ts'

/** The request handler lives in handler.ts so the connector bundle does not carry this Gateway's start-up. */
export { handleRequest } from './handler.ts'
export const GATEWAY_VERSION = '2'

export function createGateway(service: QueryService, secret: string, events?: EventService, dispatch: Dispatch = createDispatcher({ query: service, events })) {
  if (secret.length < 32) throw new Error('gateway_secret_too_short')
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store')
    const send = (status: number, data: unknown) => {
      let body = JSON.stringify(data)
      if (Buffer.byteLength(body) > 1_000_000) { status = 503; body = JSON.stringify({ error: 'splunk_reply_too_large' }) }
      res.writeHead(status); res.end(body)
    }
    const authorization = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${secret}`)
    if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) return send(401, { error: 'unauthorized' })
    if (req.method === 'GET' && req.url === '/health') return send(200, { version: GATEWAY_VERSION, events: !!events })
    if (req.method !== 'POST' || req.url !== '/query' || req.headers['content-type'] !== 'application/json') return send(404, { error: 'not_found' })
    try {
      const chunks: Buffer[] = []; let bytes = 0
      for await (const c of req) { bytes += c.length; if (bytes > 20000) return send(413, { error: 'body_limit' }); chunks.push(c) }
      let value
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new QueryError('invalid_json') }
      const reply = await dispatch(value)
      return send(reply.status, reply.body)
    } catch (e) { return send(e instanceof QueryError ? 400 : 500, { error: e instanceof QueryError ? e.code : 'gateway_failed' }) }
  })
  server.requestTimeout = 20000; server.headersTimeout = 10000
  return server
}
