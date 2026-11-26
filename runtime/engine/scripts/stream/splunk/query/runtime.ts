import { once } from 'node:events'
import { createGateway } from './gateway.ts'
import { runConnector } from './connectorLoop.ts'
import { createDispatcher } from './dispatch.ts'
import { servicesFromEnv, loadConnectorEnv, graphIndexFromEnv, controlBase } from './services.ts'

export function runtimeMode(value: string | undefined, fallback: 'gateway' | 'connector') {
  const mode = value ?? fallback
  if (!['gateway', 'connector', 'both'].includes(mode)) throw new Error('invalid_service_mode')
  return mode as 'gateway' | 'connector' | 'both'
}

/** One owner, one set of jobs, optionally two transports during migration. */
export async function startRuntime(fallback: 'gateway' | 'connector', env: NodeJS.ProcessEnv = process.env) {
  await loadConnectorEnv(env)
  const mode = runtimeMode(env.AEGI_SPLUNK_SERVICE_MODE, fallback)
  const outbound = mode !== 'gateway', gateway = mode !== 'connector'
  const controlUrl = env.AEGI_CONNECTOR_URL, key = env.AEGI_CONNECTOR_KEY, secret = env.AEGI_SPLUNK_GATEWAY_TOKEN
  if (outbound && (!controlUrl || !key || key.length < 32)) throw new Error('connector_configuration_required')
  if (gateway && (!secret || secret.length < 32)) throw new Error('gateway_secret_too_short')
  if (outbound) controlBase(controlUrl!)
  const port = Number(env.AEGI_SPLUNK_PORT ?? 8090)
  if (gateway && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('invalid_gateway_port')
  const services = servicesFromEnv(env, graphIndexFromEnv(env)), dispatch = createDispatcher(services)
  const migrated = await services.store.migrate()
  if (migrated.length) console.log(`[splunk] log cache migrations applied: ${migrated.join(', ')}`)
  const controller = new AbortController()
  const server = gateway ? createGateway(services.query, secret!, services.events, dispatch) : null
  const stop = () => { controller.abort(); server?.close() }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  // Source data list for AI searches: one search at a time in the background; the schema says pending until it is built.
  void services.query.catalog?.run(controller.signal).catch(e => console.log(`[splunk] catalog stopped: ${(e as Error).message}`))
  try {
    if (server) {
      server.listen(port, '127.0.0.1'); await once(server, 'listening')
      console.log(`[splunk] mode=${mode} gateway listening on loopback`)
    }
    if (outbound) await runConnector({ controlUrl: controlUrl!, key: key!, service: services.query, events: services.events, dispatch,
      signal: controller.signal, log: line => console.log(`[connector] ${line}`) })
    else if (!controller.signal.aborted) await once(controller.signal, 'abort')
  } finally {
    stop(); server?.closeAllConnections()
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
  }
}
