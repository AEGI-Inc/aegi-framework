import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { SearchTransport } from '../transport.ts'
import { mapRow } from '../mapper.ts'
import { EntityResolver } from '../resolver.ts'
import { SOURCETYPE_PROVIDER, type GraphRelationRef, type NormalizedEvent } from '../types.ts'
import { computeEventLinks, ssoAppsFrom, type AppTenant, type EventLink } from '../../../../src/events/eventLinks.ts'
import type { IdentityLink } from '../../../../src/model/link.ts'
import { QueryError, tenantScope, checkRange, type Source, type Workspace } from './workspace.ts'
import type { Scope } from './service.ts'
import { BUCKET_MS, INDEX_MARGIN_MS, bucketStart, bucketsOf, type LogStore, type ReadPlan, type ReadRange } from './logStore.ts'

/**
 * Standard event lookup for screens and AI: the dashboard asks for a period, and the normalized events (the same mapper
 * `splunk pull` used) and the links between them are written to the D1 log cache, where the dashboard reads them.
 * Events are read from Splunk into the D1 log cache (logStore.ts) per provider and hour, and reused while fresh.
 * Recent hours are checked again only for events indexed since the last read, so unchanged events are not written again.
 * Each provider is marked readable (providers[]) as soon as its sources end, so a caller reads finished providers from
 * the log cache while others still search. Links are computed over the whole result at the end.
 * A job keeps only its event keys, links and status in this private directory, for one hour.
 *
 * Object keys come from the control plane's current graph index (identifiers, identity links, relations and the SaaS each
 * Okta app is registered in), so mapping events to graph objects and linking them stays engine code.
 */
export interface GraphIndex {
  snapshotId: string
  objects: Array<{ fixture_key: string; canonical?: { provider?: string; identifiers?: Record<string, unknown> } }>
  links: IdentityLink[]
  /**
   * Okta app → the other SaaS tenant it is registered in (registered_in), one per relation. SSO hand-offs need it to know
   * which SaaS an Okta sign-in went to. A control plane that leaves it out gets no SSO hand-offs.
   */
  appTenants?: AppTenant[]
  /**
   * The snapshot's relations. An event whose actor and target (or two targets) are the two ends of one gets a relation
   * match: only the fact that the keys were equal (resolver.ts relationMatches). A control plane that leaves it out gets none.
   */
  relations?: GraphRelationRef[]
  /** When the snapshot's dataset was made (graph_snapshots.dataset_created_at), stored with each event's matches */
  collectedAt?: string | null
}

/** The resolver for one graph index: identifiers, relations and the snapshot the matches are against */
export function resolverOf(index: GraphIndex | null): EntityResolver {
  const selfClientIds = (process.env.AEGI_GWS_SELF_CLIENT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return new EntityResolver(index?.objects ?? [], [], {
    snapshotId: index?.snapshotId,
    collectedAt: index?.collectedAt ?? null,
    relations: Array.isArray(index?.relations) ? index.relations : undefined,
    selfClientIds,
  })
}
type State = 'queued' | 'running' | 'complete' | 'partial' | 'failed' | 'cancelled'
interface EventJob {
  id: string; owner: string; created: number; expires: number; state: State
  request: ReturnType<typeof validateEventRequest>; sids: string[]; snapshotId: string | null
  /**
   * cached: the provider's buckets were fresh in the log cache, so this source was not searched.
   * incremental: only events indexed since earlier reads were searched (for some or all buckets).
   */
  sources: Array<{ ref: string; provider: string; resultCount: number | null; mapped: number; errors: number; cached?: boolean; incremental?: boolean }>
  /** Progress per provider (jobs saved before this field have none). See ProviderProgress. */
  providers?: ProviderProgress[]
  /** Keys of the matching events, newest first. The events themselves are in the log cache. */
  keys: string[]; links: EventLink[]; reasons: string[]
}

/**
 * One provider of a lookup. complete: its events for the period are in the log cache and can be read there now, before
 * the other providers finish (reason: a note such as mapping_errors, the events read are still there). failed: its events
 * must not be read; reason is the error code. cached: its buckets were fresh, so it was not searched.
 */
export interface ProviderProgress { provider: string; state: 'waiting' | 'searching' | 'complete' | 'failed'; cached: boolean; reason?: string }

/** Splunk searches one event lookup runs at once (one per source). */
const SOURCE_PARALLEL = 4
/**
 * maxResults: Splunk results one lookup may read in total, a guard for D1 writes (too_many_results). There is no period limit.
 * jobs: lookups kept for status lookups. Only active ones count against it (capacity_limit); when it is full, the oldest
 * finished lookups are dropped early. Their events stay in the D1 log cache.
 */
export const EVENT_LIMITS = { maxResults: 100_000, runtimeSeconds: 120, concurrency: 2, searchesPerTenMinutes: 30, jobs: 1000 }
const PROVIDERS = ['okta', 'gws', 'github', 'slack', 'salesforce', 'atlassian']
const uuid = /^[0-9a-f-]{36}$/
const active = (j: EventJob) => j.state === 'queued' || j.state === 'running'
const iso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v))
const strings = (v: unknown, max: number, len: number) => v === undefined ? [] : Array.isArray(v) && v.length <= max && v.every(x => typeof x === 'string' && x.length > 0 && x.length <= len && !/[\x00-\x1f]/.test(x)) ? v as string[] : null

export function validateEventRequest(v: unknown) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new QueryError('invalid_event_request')
  const r = v as Record<string, unknown>
  if (Object.keys(r).some(k => !['from', 'to', 'providers', 'objectKeys', 'eventTypes', 'graphSnapshotId'].includes(k))) throw new QueryError('unsupported_property')
  if (r.graphSnapshotId !== undefined && (typeof r.graphSnapshotId !== 'string' || !r.graphSnapshotId || r.graphSnapshotId.length > 100)) throw new QueryError('invalid_value')
  if (!iso(r.from) || !iso(r.to)) throw new QueryError('absolute_utc_range_required')
  if (Date.parse(r.to) <= Date.parse(r.from)) throw new QueryError('range_exceeded')
  const providers = strings(r.providers, PROVIDERS.length, 20), objectKeys = strings(r.objectKeys, 50, 200), eventTypes = strings(r.eventTypes, 20, 120)
  if (!providers || providers.some(p => !PROVIDERS.includes(p)) || !objectKeys || !eventTypes) throw new QueryError('invalid_value')
  return { from: r.from, to: r.to, providers: [...new Set(providers)].sort(), objectKeys: [...new Set(objectKeys)].sort(), eventTypes: [...new Set(eventTypes)].sort(), ...(r.graphSnapshotId ? { graphSnapshotId: r.graphSnapshotId as string } : {}) }
}

/** Raw events of one approved source and period (only those indexed from indexEarliestMs, if given). Tenant scope is applied before anything else. */
export function eventSearch(source: Source, from: string, to: string, indexEarliestMs?: number) {
  const indexed = indexEarliestMs === undefined ? '' : ` _index_earliest=${Math.floor(indexEarliestMs / 1000)}`
  const pipes = [`search index=${source.index} sourcetype="${source.sourcetype}" earliest=${Date.parse(from) / 1000} latest=${Date.parse(to) / 1000}${indexed}`]
  pipes.push(...tenantScope(source))
  pipes.push('eval aegi_indextime=_indextime', 'fields _time aegi_indextime _raw')
  return pipes.join(' | ')
}

export class EventService {
  private readonly jobs = new Map<string, EventJob>()
  private readonly tasks = new Map<string, Promise<void>>()
  get activeCount() { return this.tasks.size }
  constructor(private readonly transport: SearchTransport, private readonly workspaces: Workspace[], private readonly dir: string,
    private readonly store: LogStore,
    private readonly graphIndex: (expectedSnapshotId?: string) => Promise<GraphIndex | null> = async () => null,
    private readonly now = Date.now, private readonly sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json') && uuid.test(f.slice(0, -5)))) {
      const j: EventJob = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (file !== `${j.id}.json`) throw new Error('invalid_job_file')
      // A job written before the log cache held its events itself; it cannot be paged any more.
      if (!Array.isArray(j.keys)) { fs.rmSync(path.join(dir, file), { force: true }); continue }
      if (active(j)) { j.state = 'failed'; j.reasons.push('connector_restarted'); for (const sid of j.sids) void transport.cancel(sid).catch(() => undefined) }
      this.jobs.set(j.id, j); this.save(j)
    }
    this.prune()
  }
  private save(j: EventJob) {
    const file = path.join(this.dir, `${j.id}.json`)
    fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(j), { mode: 0o600 }); fs.renameSync(`${file}.${process.pid}.tmp`, file)
  }
  private prune() {
    for (const [id, j] of this.jobs) if (j.expires <= this.now() && !active(j)) this.drop(id)
  }
  private drop(id: string) { fs.rmSync(path.join(this.dir, `${id}.json`), { force: true }); this.jobs.delete(id) }
  /** Makes room for one more lookup: finished lookups never refuse a new one. */
  private admit() {
    const jobs = [...this.jobs.values()]
    if (jobs.filter(active).length >= EVENT_LIMITS.jobs) throw new QueryError('capacity_limit')
    const finished = jobs.filter(j => !active(j)).sort((a, b) => a.created - b.created)
    for (const j of finished.slice(0, Math.max(0, jobs.length + 1 - EVENT_LIMITS.jobs))) this.drop(j.id)
  }
  private workspace(s: Scope) {
    if (!s || typeof s.principal !== 'string' || !/^[a-f0-9]{64}$/.test(s.principal)) throw new QueryError('invalid_principal')
    const w = this.workspaces.find(w => w.id === s.workspace && w.policyVersion === s.policyVersion)
    if (!w) throw new QueryError('scope_not_allowed')
    return w
  }
  private owner(s: Scope) { return createHash('sha256').update(`events\n${s.workspace}\n${s.principal}\n${s.policyVersion}`).digest('hex') }
  private job(s: Scope, id: unknown) {
    this.workspace(s); this.prune()
    const j = typeof id === 'string' ? this.jobs.get(id) : undefined
    if (!j || j.owner !== this.owner(s)) throw new QueryError('job_not_found')
    return j
  }

  start(s: Scope, value: unknown, reuse = false) {
    const w = this.workspace(s), request = validateEventRequest(value)
    checkRange(w, request.from, request.to)
    this.prune()
    const owner = this.owner(s), own = [...this.jobs.values()].filter(j => j.owner === owner)
    // Only explicit callers opt in. Session ownership, graph version and all filters must match.
    if (reuse) {
      const same = own.find(j => JSON.stringify(j.request) === JSON.stringify(request) && (active(j) || j.state === 'complete' && j.created > this.now() - 60_000))
      if (same) return this.view(same)
    }
    if (own.filter(active).length >= EVENT_LIMITS.concurrency || this.tasks.size >= 8) throw new QueryError('concurrency_limit')
    if (own.filter(j => j.created > this.now() - 600_000).length >= EVENT_LIMITS.searchesPerTenMinutes) throw new QueryError('search_budget_exceeded')
    this.admit()
    const sources = w.sources.filter(src => SOURCETYPE_PROVIDER[src.sourcetype] && (!request.providers.length || request.providers.includes(SOURCETYPE_PROVIDER[src.sourcetype])))
    if (!sources.length) throw new QueryError('no_event_source')
    const j: EventJob = { id: randomUUID(), owner, created: this.now(), expires: this.now() + 3600_000, state: 'queued', request, sids: [], snapshotId: null,
      sources: sources.map(src => ({ ref: src.ref, provider: SOURCETYPE_PROVIDER[src.sourcetype], resultCount: null, mapped: 0, errors: 0 })),
      providers: [...new Set(sources.map(src => SOURCETYPE_PROVIDER[src.sourcetype]))].map(provider => ({ provider, state: 'waiting', cached: false })), keys: [], links: [], reasons: [] }
    this.jobs.set(j.id, j); this.save(j)
    const task = Promise.resolve().then(() => this.run(j, sources)).catch(() => { j.state = 'failed'; j.reasons.push('job_storage_failed') })
      .finally(() => { this.tasks.delete(j.id); this.save(j) })
    this.tasks.set(j.id, task)
    return this.view(j)
  }
  status(s: Scope, id: unknown) { return this.view(this.job(s, id)) }
  private view(j: EventJob) {
    return { queryId: j.id, state: j.state, source: 'splunk', from: j.request.from, to: j.request.to, filters: { providers: j.request.providers, objectKeys: j.request.objectKeys, eventTypes: j.request.eventTypes },
      sources: j.sources, providers: j.providers ?? [], eventCount: j.keys.length, linkCount: j.links.length, graphSnapshotId: j.snapshotId, partialReasons: j.reasons,
      coverage: { sourceCollection: 'unknown', searchExecution: j.state }, expiresAt: new Date(j.expires).toISOString() }
  }
  async cancel(s: Scope, id: unknown) {
    const j = this.job(s, id)
    if (active(j)) { j.state = 'cancelled'; this.save(j); await Promise.all(j.sids.map(sid => this.transport.cancel(sid).catch(() => undefined))) }
    return this.view(j)
  }
  async settled(id: string) { await this.tasks.get(id) }

  private async run(j: EventJob, sources: Source[]) {
    const deadline = this.now() + EVENT_LIMITS.runtimeSeconds * 1000
    j.state = 'running'; this.save(j)
    let index: GraphIndex | null = null
    try { index = await this.graphIndex(j.request.graphSnapshotId) } catch { /* events stay usable without object keys */ }
    if (j.request.graphSnapshotId && index?.snapshotId !== j.request.graphSnapshotId) {
      j.state = 'failed'; j.reasons.push('graph_snapshot_changed')
      for (const p of j.providers ?? []) Object.assign(p, { state: 'failed', reason: 'graph_snapshot_changed' })
      return
    }
    if (!index) j.reasons.push('graph_index_unavailable')
    j.snapshotId = index?.snapshotId ?? null
    // Cached buckets are keyed by snapshot; '' marks events read without a graph index, never reused once one exists.
    const snapshot = j.snapshotId ?? ''
    const resolver = resolverOf(index)
    const receivedAt = new Date(this.now()).toISOString()
    const fromMs = Date.parse(j.request.from), toMs = Date.parse(j.request.to)
    // Whole hour buckets are searched, so a read bucket is complete for any later lookup inside it.
    const span = { from: bucketStart(fromMs), to: bucketStart(toMs - 1) + BUCKET_MS }
    // Everything indexed before this was searchable when the searches below start; the next re-check reads from here.
    const watermark = this.now() - INDEX_MARGIN_MS
    await this.store.cleanup().catch(() => undefined)
    const providers = [...new Set(j.sources.map(src => src.provider))]
    const plans = new Map<string, ReadPlan>()
    for (const p of providers) plans.set(p, await this.store.plan(p, span.from, span.to, snapshot).catch(() => ({ full: { fromMs: span.from, toMs: span.to, buckets: [] }, incremental: null })))
    const ranges = (p: string) => [plans.get(p)!.full, plans.get(p)!.incremental].filter((r): r is ReadRange => !!r)
    j.sources.forEach(src => {
      const plan = plans.get(src.provider)!
      if (!plan.full && !plan.incremental) src.cached = true
      if (plan.incremental) src.incremental = true
    })
    const progress = new Map((j.providers ??= providers.map(provider => ({ provider, state: 'waiting' as const, cached: false }))).map(p => [p.provider, p]))
    // A provider whose buckets are all fresh is readable at once.
    for (const p of providers) if (j.sources.every(src => src.provider !== p || src.cached)) Object.assign(progress.get(p)!, { state: 'complete', cached: true })
    this.save(j)
    let budget = EVENT_LIMITS.maxResults
    const failed = new Set<string>()
    const left = new Map(providers.map(p => [p, j.sources.filter(src => src.provider === p && !src.cached).length]))
    /**
     * Called as each source ends. When the last source of a provider has ended, its buckets are marked read (only when
     * every source of it was read without errors) and the provider becomes readable, while the others still search.
     * Every bucket inside a searched period is complete up to the watermark, including fresh ones it spans.
     */
    const sourceDone = async (provider: string, error?: string) => {
      const p = progress.get(provider)! as ProviderProgress
      if (error) { failed.add(provider); p.reason ??= error }
      left.set(provider, left.get(provider)! - 1)
      if (left.get(provider)! > 0 || !active(j)) return
      if (failed.has(provider)) { p.state = 'failed'; this.save(j); return }
      const mappingErrors = j.sources.some(src => src.provider === provider && src.errors)
      const read = [...new Set(ranges(provider).flatMap(r => bucketsOf(r.fromMs, r.toMs)))]
      if (!mappingErrors && read.length) {
        try { await this.store.markRead(provider, read, snapshot, watermark) } catch {
          j.reasons.push(`d1_write_failed:${provider}`); Object.assign(p, { state: 'failed', reason: 'd1_write_failed' }); this.save(j); return
        }
      }
      Object.assign(p, { state: 'complete', ...(mappingErrors ? { reason: 'mapping_errors' } : {}) }); this.save(j)
    }
    const searchRange = async (stat: EventJob['sources'][number], source: Source, r: ReadRange) => {
      const spl = eventSearch(source, new Date(r.fromMs).toISOString(), new Date(r.toMs).toISOString(), r.indexEarliestMs)
      const sid = await this.transport.createJob(spl, EVENT_LIMITS.runtimeSeconds)
      j.sids.push(sid)
      let status = await this.transport.jobStatus(sid)
      // A small search finishes in well under a second; check quickly first, then every second.
      for (let checks = 0; !status.isDone && !status.isFailed; checks++) {
        if (!active(j)) return
        if (this.now() >= deadline) throw new QueryError('timeout')
        await this.sleep(checks < 8 ? 250 : 1000); status = await this.transport.jobStatus(sid)
      }
      if (status.isFailed || ['FAILED', 'EXPIRED'].includes(status.dispatchState)) throw new QueryError('search_failed')
      stat.resultCount = (stat.resultCount ?? 0) + status.resultCount
      if (status.resultCount > budget) throw new QueryError('too_many_results')
      budget -= status.resultCount
      if (status.truncated) j.reasons.push(`splunk_truncated:${source.ref}`)
      for (let offset = 0; offset < status.resultCount;) {
        if (!active(j)) return
        if (this.now() >= deadline) throw new QueryError('timeout')
        const page = await this.transport.results(sid, offset, Math.min(1000, status.resultCount - offset))
        if (page.preview || !page.rows.length) { j.reasons.push(`page_missing:${source.ref}`); stat.errors++; break }
        const batch: NormalizedEvent[] = []
        page.rows.forEach((row, i) => {
          const mapped = mapRow(row, { index: source.index, sourcetype: source.sourcetype, sid, offset: offset + i,
            tenant: 'value' in source.isolation ? source.isolation.value : source.index, receivedAt }, resolver)
          if (mapped.error) { stat.errors++; return }
          batch.push(...mapped.events)
        })
        try { await this.store.writeEvents(batch, snapshot) } catch { throw new QueryError('d1_write_failed') }
        stat.mapped += batch.length
        offset += page.rows.length
      }
    }
    const searchSource = async (n: number, source: Source) => {
      const stat = j.sources[n]!
      if (!active(j) || stat.cached) return
      const p = progress.get(stat.provider)!
      if (p.state === 'waiting') { p.state = 'searching'; this.save(j) }
      let code: string | undefined
      try {
        for (const r of ranges(stat.provider)) { if (!active(j)) return; await searchRange(stat, source, r) }
        if (stat.errors) j.reasons.push(`mapping_errors:${source.ref}`)
      } catch (error) {
        code = error instanceof QueryError ? error.code : 'splunk_unavailable'
        j.reasons.push(`${code}:${source.ref}`)
      }
      await sourceDone(stat.provider, code)
    }
    let next = 0
    await Promise.all(Array.from({ length: Math.min(SOURCE_PARALLEL, sources.length) }, async () => {
      while (next < sources.length) { const n = next++; await searchSource(n, sources[n]!) }
    }))
    // Reasons in source order, whichever search finished first.
    const order = new Map(sources.map((s, i) => [s.ref, i]))
    j.reasons.sort((a, b) => (order.get(a.split(':')[1] ?? '') ?? -1) - (order.get(b.split(':')[1] ?? '') ?? -1))
    if (!active(j)) return
    let events: NormalizedEvent[]
    try {
      events = await this.store.readEvents({ providers, fromMs, toMs, objectKeys: j.request.objectKeys, eventTypes: j.request.eventTypes })
    } catch { j.state = 'failed'; j.reasons.push('d1_read_failed'); return }
    j.keys = events.map(e => e.origin_key)
    j.links = computeEventLinks(events, index?.links ?? [], {
      ssoApps: ssoAppsFrom(Array.isArray(index?.appTenants) ? index.appTenants : []),
      relations: Array.isArray(index?.relations) ? index.relations : undefined,
    })
    await this.store.writeLinks(j.links, snapshot).catch(() => { j.reasons.push('d1_write_failed:links') })
    const failedAll = j.sources.every(src => src.resultCount === null && !src.cached)
    j.state = failedAll ? 'failed' : j.reasons.some(r => r !== 'graph_index_unavailable') ? 'partial' : 'complete'
  }
}
