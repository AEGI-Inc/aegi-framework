import { readBoundedText } from './assistant/planner'
import type { Relay, RelayReply, RelayRequest } from './splunkRelay'

export interface SplunkEnv {
  AEGI_GRAPH_INDEX_KEY?: string
  AEGI_SPLUNK_TRANSPORT?: string
  AEGI_SPLUNK_GATEWAY_URL?: string
  AEGI_SPLUNK_GATEWAY_TOKEN?: string
  AEGI_SPLUNK_CONNECTOR_KEY?: string
  AEGI_SPLUNK_WORKSPACE?: string
  AEGI_SPLUNK_POLICY_VERSION?: string
  /** Bump on a service replacement or rollback; never a credential. */
  AEGI_SPLUNK_CACHE_VERSION?: string
  /** Set to 'demo' to permit log search on public demo access without a session. */
  AEGI_PUBLIC_LOG_SEARCH?: string
}
export interface SplunkTransport {
  readonly namespace: string
  request(request: RelayRequest, timeoutMs: number): Promise<RelayReply>
}

export function splunkMode(env: SplunkEnv): 'gateway' | 'connector' | null {
  if (env.AEGI_SPLUNK_TRANSPORT !== undefined) {
    if (!['gateway', 'connector'].includes(env.AEGI_SPLUNK_TRANSPORT)) throw new Error('invalid_splunk_transport')
    return env.AEGI_SPLUNK_TRANSPORT as 'gateway' | 'connector'
  }
  // Compatibility for deployments that predate the explicit switch.
  if (env.AEGI_SPLUNK_CONNECTOR_KEY) return 'connector'
  return env.AEGI_SPLUNK_GATEWAY_URL || env.AEGI_SPLUNK_GATEWAY_TOKEN ? 'gateway' : null
}

/** Intent, including incomplete/invalid explicit config, must not select old D1 events. */
export function usesSplunk(env: SplunkEnv) {
  return env.AEGI_SPLUNK_TRANSPORT !== undefined || !!(env.AEGI_SPLUNK_CONNECTOR_KEY || env.AEGI_SPLUNK_GATEWAY_URL || env.AEGI_SPLUNK_GATEWAY_TOKEN)
}

export function createSplunkTransport(env: SplunkEnv, relay?: Pick<Relay, 'request'>, request: typeof fetch = fetch, allowLoopback = false): SplunkTransport {
  const mode = splunkMode(env)
  if (!mode || !env.AEGI_SPLUNK_WORKSPACE || !env.AEGI_SPLUNK_POLICY_VERSION) throw new Error('splunk_not_configured')
  const namespace = JSON.stringify([mode, mode === 'gateway' ? env.AEGI_SPLUNK_GATEWAY_URL : '', env.AEGI_SPLUNK_CACHE_VERSION ?? '1'])
  if (mode === 'connector') {
    if (!env.AEGI_SPLUNK_CONNECTOR_KEY || !relay) throw new Error('splunk_not_configured')
    return { namespace, request: (r, ms) => relay.request(r, ms) }
  }
  if (!env.AEGI_SPLUNK_GATEWAY_URL || !env.AEGI_SPLUNK_GATEWAY_TOKEN) throw new Error('splunk_not_configured')
  const url = new URL(env.AEGI_SPLUNK_GATEWAY_URL)
  if ((url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.username || url.password || url.search || url.hash) throw new Error('invalid_url')
  return { namespace, async request(value, timeoutMs) {
    let response: Response
    try {
      response = await request(url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AEGI_SPLUNK_GATEWAY_TOKEN}` }, body: JSON.stringify(value) })
    } catch (err: any) {
      throw new Error(`fetch_failed: ${err?.message || err}`)
    }
    if (response.status >= 300 && response.status < 400) throw new Error('redirect_not_allowed')
    const text = await readBoundedText(response.body, 1_000_000)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error(`gateway_parse_failed: status=${response.status}, text=${text.slice(0, 100)}`)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_gateway_reply')
    return { status: response.status, body: body as Record<string, unknown> }
  } }
}
