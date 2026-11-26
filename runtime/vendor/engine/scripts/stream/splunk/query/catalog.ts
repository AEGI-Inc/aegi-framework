/**
 * Source data list for AI searches (aegi-knowledge docs/architecture/ai-log-investigation.md D3). For each approved
 * source it records what the data actually holds: event types with counts and outcomes, field paths, data period and
 * volume, and GWS parameter names. Fixed searches written here build it, never AI SPL. Only event type names, outcome
 * values, field names and counts are kept, never identities or addresses.
 *
 * It is built in the background, one search at a time, and refreshed hourly. Until it is built the schema says pending.
 */
import type { SearchTransport } from '../transport.ts'
import { baseSearch, DEDUP_EVENTS } from './spl.ts'
import { tenantScope, type Source, type Workspace } from './workspace.ts'
import { fieldShapeSourcetype } from '../types.ts'

export interface CatalogEntry {
  state: 'ready' | 'failed'
  builtAt: string
  /** Window the counts cover (UTC, to exclusive) */
  window: { from: string; to: string; days: number }
  /** Events in the window, in the source's counting unit (GWS, Guard: child events) */
  total: number
  first: string | null
  last: string | null
  perDay: number
  /** Most frequent aegi_event_type values; outcomes only where the source records them */
  eventTypes: Array<{ value: string; count: number; outcomes?: Record<string, number> }>
  /** Events per aegi_category and aegi_outcome: what a matchCategories, matchOutcomes filter finds in the window */
  classCounts?: Array<{ category: string; outcome: string; count: number }>
  /** Most frequent raw field paths */
  fields: string[]
  /** GWS: parameter names per application (events{}.parameters{}.name) */
  parameters?: Record<string, string[]>
  /** Event types left out to keep the entry within its size limit */
  omittedEventTypes?: number
}

/** entryBytes: about 2 KB per source, so eight sources stay near 16 KB of the AI prompt */
export const CATALOG_LIMITS = { windowDays: 30, refreshMs: 3600_000, searchSeconds: 90, entryBytes: 2000, fields: 40, parameters: 12 }
/** Splunk's own fields and the search's helper fields are not data the AI can use */
const internalField = (f: string) => f.startsWith('_') || f.startsWith('aegi_') || f.startsWith('date_') || f.startsWith('tag')
  || ['punct', 'linecount', 'splunk_server', 'splunk_server_group', 'timestartpos', 'timeendpos', 'host', 'source', 'sourcetype', 'index', 'eventtype'].includes(f)
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const time = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? iso(n * 1000) : null }

export class SourceCatalog {
  private readonly entries = new Map<string, CatalogEntry>()
  constructor(private readonly transport: SearchTransport, private readonly workspaces: Workspace[], private readonly now = Date.now,
    private readonly sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(r => { const t = setTimeout(r, ms); signal?.addEventListener('abort', () => { clearTimeout(t); r() }, { once: true }) }),
    private readonly log: (line: string) => void = () => undefined) {}

  get(workspace: string, ref: string): CatalogEntry | undefined { return this.entries.get(`${workspace}\n${ref}`) }

  /** Builds every source now, one search at a time, then again every hour until the signal aborts. */
  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      await this.refresh(signal)
      await this.sleep(CATALOG_LIMITS.refreshMs, signal)
    }
  }

  async refresh(signal?: AbortSignal) {
    for (const w of this.workspaces) for (const s of w.sources) {
      if (signal?.aborted) return
      const key = `${w.id}\n${s.ref}`
      try { this.entries.set(key, await this.build(s)) } catch (e) {
        this.log(`catalog ${s.ref} failed: ${(e as Error).message}`)
        // A failed refresh keeps the last good entry.
        if (!this.entries.has(key)) this.entries.set(key, { ...this.empty(), state: 'failed' })
      }
    }
  }

  private empty(): CatalogEntry {
    const to = Math.floor(this.now() / 3600_000) * 3600_000, from = to - CATALOG_LIMITS.windowDays * 86_400_000
    return { state: 'ready', builtAt: iso(this.now()), window: { from: iso(from), to: iso(to), days: CATALOG_LIMITS.windowDays }, total: 0, first: null, last: null, perDay: 0, eventTypes: [], fields: [] }
  }

  private async rows(spl: string): Promise<Array<Record<string, string>>> {
    const sid = await this.transport.createJob(spl, CATALOG_LIMITS.searchSeconds)
    const deadline = this.now() + (CATALOG_LIMITS.searchSeconds + 30) * 1000
    let status = await this.transport.jobStatus(sid)
    while (!status.isDone && !status.isFailed) {
      if (this.now() >= deadline) { await this.transport.cancel(sid).catch(() => undefined); throw new Error('timeout') }
      await this.sleep(1000); status = await this.transport.jobStatus(sid)
    }
    if (status.isFailed) throw new Error('search_failed')
    return (await this.transport.results(sid, 0, 500)).rows
  }

  async build(s: Source): Promise<CatalogEntry> {
    const entry = this.empty(), { from, to } = entry.window
    const common = `${baseSearch(s, from, to)} | ${DEDUP_EVENTS}`
    const raw = [`search index=${s.index} sourcetype="${s.sourcetype}" earliest=${Date.parse(from) / 1000} latest=${Date.parse(to) / 1000}`, ...tenantScope(s)].join(' | ')
    const [size] = await this.rows(`${common} | stats count min(_time) as first max(_time) as last`)
    entry.total = Number(size?.count ?? 0); entry.first = time(size?.first); entry.last = time(size?.last)
    entry.perDay = Math.round(entry.total / CATALOG_LIMITS.windowDays * 10) / 10
    const types = new Map<string, { value: string; count: number; outcomes: Record<string, number> }>()
    for (const row of await this.rows(`${common} | stats count by aegi_event_type aegi_outcome | sort - count | head 300`)) {
      const value = row.aegi_event_type, count = Number(row.count)
      if (!value || !Number.isFinite(count)) continue
      const t = types.get(value) ?? { value, count: 0, outcomes: {} }
      t.count += count
      if (row.aegi_outcome && row.aegi_outcome !== 'not_recorded') t.outcomes[row.aegi_outcome] = (t.outcomes[row.aegi_outcome] ?? 0) + count
      types.set(value, t)
    }
    entry.eventTypes = [...types.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .map(t => Object.keys(t.outcomes).length ? t : { value: t.value, count: t.count })
    entry.classCounts = (await this.rows(`${common} | stats count by aegi_category aegi_outcome`))
      .map(r => ({ category: String(r.aegi_category ?? ''), outcome: String(r.aegi_outcome ?? ''), count: Number(r.count) }))
      .filter(c => c.category && Number.isFinite(c.count)).sort((a, b) => b.count - a.count)
    entry.fields = (await this.rows(`${raw} | fieldsummary | fields field count | sort - count | head 120`))
      .map(r => r.field).filter((f): f is string => !!f && !internalField(f)).slice(0, CATALOG_LIMITS.fields)
    if (fieldShapeSourcetype(s.sourcetype) === 'gws:reports:activity') {
      const parameters: Record<string, string[]> = {}
      for (const row of await this.rows(`${raw} | spath path=events{}.parameters{}.name output=aegi_param | eval aegi_param=mvdedup(aegi_param) | mvexpand aegi_param | stats count by id.applicationName aegi_param | sort - count`)) {
        const app = row['id.applicationName'], p = row.aegi_param
        if (!app || !p) continue
        if ((parameters[app] ??= []).length < CATALOG_LIMITS.parameters) parameters[app].push(p)
      }
      entry.parameters = parameters
    }
    return fit(entry)
  }
}

/**
 * Fits an entry in its size limit: the least frequent event types go first down to 15, then the least frequent field
 * paths down to 15, then more event types.
 */
export function fit(entry: CatalogEntry): CatalogEntry {
  const out = { ...entry, eventTypes: [...entry.eventTypes], fields: [...entry.fields] }
  const over = () => JSON.stringify(out).length > CATALOG_LIMITS.entryBytes
  let omitted = 0
  while (over() && out.eventTypes.length > 15) { out.eventTypes.pop(); omitted++ }
  while (over() && out.fields.length > 15) out.fields.pop()
  while (over() && out.eventTypes.length) { out.eventTypes.pop(); omitted++ }
  if (omitted) out.omittedEventTypes = omitted
  return out
}
