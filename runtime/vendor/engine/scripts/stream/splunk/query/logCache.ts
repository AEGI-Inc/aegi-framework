import { parseArgs } from 'node:util'
import { LogStore } from './logStore.ts'
import { d1Executor } from '../../../loader/sql.ts'

/**
 * Log cache upkeep, run by a person (it writes the D1 log cache).
 *   npm run splunk:log-cache -- invalidate --from <ISO> --to <ISO> [--providers okta,gws]
 * invalidate: after Splunk input for a period was recovered (e.g. a sync outage backfilled), forget that its hour
 * buckets were read, so the next lookup searches them whole and stores the events that arrived late.
 * Needs AEGI_LOG_D1_ID and CLOUDFLARE_API_TOKEN, like the connector.
 */
const { positionals, values } = parseArgs({ allowPositionals: true, options: { from: { type: 'string' }, to: { type: 'string' }, providers: { type: 'string' } } })
const [command] = positionals
if (command !== 'invalidate') throw new Error('usage: splunk:log-cache -- invalidate --from <ISO> --to <ISO> [--providers okta,gws]')
const fromMs = Date.parse(values.from ?? ''), toMs = Date.parse(values.to ?? '')
if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) throw new Error('--from and --to must be ISO times, from before to')
const id = process.env.AEGI_LOG_D1_ID
if (!id) throw new Error('AEGI_LOG_D1_ID_required')
const providers = (values.providers ?? '').split(',').map(p => p.trim()).filter(Boolean)
await new LogStore(d1Executor(id)).invalidate(fromMs, toMs, providers)
console.log(`log cache: buckets ${new Date(fromMs).toISOString()} .. ${new Date(toMs).toISOString()} (${providers.join(', ') || 'all providers'}) will be searched whole again`)
