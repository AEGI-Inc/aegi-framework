import fs from 'node:fs'
import path from 'node:path'
import { SearchTransport, pinnedHttpsWire } from '../transport.ts'
import { QueryService } from './service.ts'
import { validateWorkspace } from './workspace.ts'
import { EventService, type GraphIndex } from './events.ts'
import { LogStore } from './logStore.ts'
import { SourceCatalog } from './catalog.ts'
import { d1Executor } from '../../../loader/sql.ts'

/** HTTPS only; plain HTTP is allowed for a control plane on this machine (the local dev server). */
export function controlBase(value: string) {
  const url = new URL(value)
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) throw new Error('invalid_control_url')
  return url.href.replace(/\/$/, '')
}

const processAlive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' } }

/**
 * One process per job directory. A starting service marks the jobs it finds there as failed (they belonged to a run
 * that stopped), so a second connector sharing the directory would fail the first one's searches. It refuses instead.
 */
export function claimJobDir(dir: string, pid = process.pid, isAlive = processAlive) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, 'owner.pid')
  const held = Number(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : NaN)
  if (Number.isInteger(held) && held !== pid && isAlive(held)) throw new Error(`job_dir_in_use: AEGI_SPLUNK_JOB_DIR 를 다른 프로세스(${held})가 쓰고 있다. 커넥터마다 다른 폴더를 준다`)
  fs.writeFileSync(file, String(pid), { mode: 0o600 })
}

/** Builds the search services from the same environment the loopback Gateway reads. */
export function servicesFromEnv(env: NodeJS.ProcessEnv = process.env, graphIndex?: (expectedSnapshotId?: string) => Promise<GraphIndex | null>) {
  const required = (name: string) => { const v = env[name]; if (!v) throw new Error(`${name}_required`); return v }
  const config = JSON.parse(fs.readFileSync(required('AEGI_SPLUNK_CONFIG'), 'utf8'))
  if (!Array.isArray(config.workspaces)) throw new Error('invalid_workspaces')
  const workspaces = config.workspaces.map(validateWorkspace)
  if (new Set(workspaces.map((w: { id: string }) => w.id)).size !== workspaces.length) throw new Error('duplicate_workspace')
  const searchBase = new URL(required('SPLUNK_URL'))
  if (searchBase.protocol !== 'https:' || searchBase.username || searchBase.password) throw new Error('invalid_splunk_url')
  const transport = new SearchTransport({ searchBase: searchBase.origin, token: required('SPLUNK_TOKEN'), approved: {}, tenants: {} }, pinnedHttpsWire(required('SPLUNK_TLS_SHA256'), 15000, 20_000_000))
  const dir = required('AEGI_SPLUNK_JOB_DIR')
  claimJobDir(dir)
  // Event results go to the D1 log cache (migrations/splunk-log). The Cloudflare token comes from CLOUDFLARE_API_TOKEN.
  const hours = Number(env.AEGI_LOG_CACHE_HOURS ?? 24)
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) throw new Error('invalid_log_cache_hours')
  const store = new LogStore(d1Executor(required('AEGI_LOG_D1_ID')), hours * 3600_000)
  const query = new QueryService(transport, workspaces, dir, store, graphIndex ? () => graphIndex() : undefined)
  // The source data list is built by the runtime in the background (catalog.run), never on a request.
  query.catalog = new SourceCatalog(transport, workspaces, Date.now, undefined, line => console.log(`[splunk] ${line}`))
  return { query, events: new EventService(transport, workspaces, path.join(dir, 'events'), store, graphIndex), store }
}
export const serviceFromEnv = (env: NodeJS.ProcessEnv = process.env) => servicesFromEnv(env).query

/**
 * The control plane's current graph index (object identifiers, identity links and Okta app tenants), cached until the
 * snapshot may have changed. Used only to resolve native IDs to graph object keys for events and to link them.
 */
export function graphIndexFrom(controlUrl: string, key: string, request: typeof fetch = fetch, ttlMs = 10 * 60_000, now = Date.now) {
  const base = controlBase(controlUrl)
  let cached: { at: number; index: GraphIndex } | null = null
  return async (expectedSnapshotId?: string): Promise<GraphIndex | null> => {
    const compatible = () => cached && (!expectedSnapshotId || cached.index.snapshotId === expectedSnapshotId) ? cached.index : null
    if (compatible() && cached && now() - cached.at < ttlMs) return cached.index
    const res = await request(`${base}/api/connector/graph-index`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}' })
    if (!res.ok) return compatible()
    const index = await res.json() as GraphIndex
    if (typeof index?.snapshotId !== 'string' || !Array.isArray(index.objects) || !Array.isArray(index.links)) return compatible()
    cached = { at: now(), index }
    return compatible()
  }
}

/** KEY=value lines; values already in the process environment win. */
export function readEnvFile(file: string, env: NodeJS.ProcessEnv = process.env) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b)
  }
}

/** AEGI environment only: Splunk credentials stay in the Secret Vault and are decrypted into memory, never printed or written. */
async function splunkFromVault(env: NodeJS.ProcessEnv) {
  const { deriveKey, decrypt } = await import('../../../vault/crypto.ts')
  const { getVaultSecret } = await import('../../../vault/kv.ts')
  readEnvFile('.env.vault', env)
  if (!env.AEGI_VAULT_KEY) throw new Error('AEGI_VAULT_KEY_required')
  const key = deriveKey(env.AEGI_VAULT_KEY)
  for (const name of ['SPLUNK_URL', 'SPLUNK_TOKEN', 'SPLUNK_TLS_SHA256']) {
    if (env[name]) continue
    const payload = await getVaultSecret(name)
    if (!payload) throw new Error(`${name}_missing_in_vault`)
    env[name] = decrypt(payload, key)
  }
}

/** .env.connector, then Splunk credentials from the Vault when AEGI_CONNECTOR_VAULT=1. */
export async function loadConnectorEnv(env: NodeJS.ProcessEnv = process.env) {
  readEnvFile(env.AEGI_CONNECTOR_ENV_FILE ?? '.env.connector', env)
  if (env.AEGI_CONNECTOR_VAULT === '1') await splunkFromVault(env)
}


/** Dedicated graph credentials are independent of the outbound transport. */
export function graphIndexFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const base = env.AEGI_GRAPH_INDEX_URL, key = env.AEGI_GRAPH_INDEX_KEY
  if (base || key) {
    if (!base || !key || key.length < 32) throw new Error('graph_index_configuration_required')
    return graphIndexFrom(base, key)
  }
  if (env.AEGI_CONNECTOR_URL && env.AEGI_CONNECTOR_KEY) return graphIndexFrom(env.AEGI_CONNECTOR_URL, env.AEGI_CONNECTOR_KEY)
  return undefined
}
