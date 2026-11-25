import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { SearchTransport } from '../transport.ts'
import { describeWorkspace, QueryError, checkRange, type Source, type Workspace } from './workspace.ts'
import { compileSpl } from './spl.ts'
import { bucketStart, type LogStore } from './logStore.ts'
import { resolverOf, type GraphIndex } from './events.ts'
import { mapRow } from '../mapper.ts'
import { EntityResolver } from '../resolver.ts'
import type { NormalizedEvent } from '../types.ts'
import type { SourceCatalog } from './catalog.ts'

export interface Scope { workspace: string; principal: string; policyVersion: string }
type State = 'queued' | 'running' | 'fetching' | 'complete' | 'partial' | 'failed' | 'cancelled'
interface Job {
  id: string; owner: string; workspace: string; policyVersion: string; created: number; expires: number
  state: State; sid?: string; executedSpl: string; queryHash: string; mode: string; sourceRef: string
  /** Sources of a free SPL search (sourceRef is the first one) */
  sourceRefs?: string[]
  /** Named sources left out because they do not record the matched outcome */
  notRecordedSources?: string[]
  from: string; to: string; columns: string[]; resultCount: number | null
  /** The stored result in the D1 log cache: rows, or normalized events when a free SPL search returned raw events */
  resultId: string | null; kind: 'rows' | 'events'; storedCount: number
  reasons: string[]; warnings: string[]; searchComplete: boolean
}
/**
 * maxResults: Splunk results one search may read, a guard for D1 writes (too_many_results). Rows are not cut otherwise.
 * jobs: searches kept for status lookups. Only active ones count against it (capacity_limit); when it is full, the
 * oldest finished searches are dropped early. Their results stay in the D1 log cache.
 */
export const QUERY_LIMITS = { maxResults: 100_000, jobs: 1000 }
/** Splunk's internal fields are not result columns; _time is. _raw is the whole event and never a column (spl.ts refuses it too). */
const resultColumn = (k: string) => !k.startsWith('_') || k === '_time'
const uuid = /^[0-9a-f-]{36}$/
const active = (j: Job) => ['queued', 'running', 'fetching'].includes(j.state)
/**
 * Credential shapes blanked in result rows before they reach D1 and the AI. Audit logs rarely hold secrets, but a request
 * URL or a free-text field can: credential headers, the token formats of the collected SaaS, JWT, private keys and
 * name-value pairs whose name says secret. This guards what a search shows; it cannot stop a pipeline that reshapes a
 * value on purpose (substr, rename), so the AI never gets a write or send path either.
 */
/** Booleans and none say whether something is set, not what it is. */
const flagValue = (value: string) => /^\\?["']?(?:true|false|null|none|\[redacted\])?\\?["']?$/i.test(value.trim())
const SECRET_PATTERNS: Array<[RegExp, string | ((match: string, ...groups: string[]) => string)]> = [
  [/(\b(?:Authorization|Proxy-Authorization|X-Api-Key|X-Auth-Token|Cookie|Set-Cookie)\\?["']?\s*[:=]\s*\\?["']?)([^\r\n"'\\,}]+)/gi,
    (match, name, value) => flagValue(value) ? match : `${name}[redacted]`],
  [/\b(?:[Bb]earer|SSWS)\s+[\w.~+/=-]{16,}/g, '[redacted]'],
  [/\bBasic\s+(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]{12,}={0,2}/g, '[redacted]'],
  [/\b(?:xox[a-z](?:\.xox[a-z])?|xapp)-[\w-]+/g, '[redacted]'], // Slack
  [/(hooks\.slack\.com\/)(?:services|workflows|triggers)\/[\w/-]+/g, '$1[redacted]'], // Slack webhook
  [/\b(?:gh[pousr]_|github_pat_)\w+/g, '[redacted]'], // GitHub
  [/\b(token\s+)[0-9a-f]{40}\b/gi, '$1[redacted]'], // GitHub "Authorization: token <hex>"
  [/(?<![\w:.-])00(?=[\w-]*[A-Z])(?=[\w-]*[a-z])[\w-]{40}(?![\w-])/g, '[redacted]'], // Okta API token
  [/\bya29\.[\w-]+|(?<![\w/])1\/\/0[\w-]{20,}|\bAIza[\w-]{35}|\bGOCSPX-[\w-]+/g, '[redacted]'], // Google
  [/\bAT[A-Z]TT[\w=+/-]{20,}/g, '[redacted]'], // Atlassian
  [/\b00D\w{12,15}![\w.]+/g, '[redacted]'], // Salesforce session ID
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted]'], // AWS access key
  [/\beyJ[\w-]{10,}\.[\w-]*(?:\.[\w-]*)?/g, '[redacted]'], // JWT
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted]'],
  [/([?&](?:code|sig)=)[^&\s"'#]+/gi, '$1[redacted]'], // OAuth code and URL signatures
]
/** Names that say the value is a secret, in snake_case or camelCase (sessionToken, aws_secret_access_key, secretKey). */
const SECRET_NAME = '[A-Za-z0-9_-]*?(?:token|secret|secret[_-]?key|password|passwd|pwd|passphrase|passcode|otp|api[_-]?key|access[_-]?key|private[_-]?key|signature|assertion|samlresponse|credential)'
/**
 * name=value, name: value, "name": "value", JSON-escaped and URL-encoded (%3D). A name starts after a character that is
 * not part of a name or a dotted event type (user.account.reset_password stays), so each name is read once.
 */
const SECRET_PAIR = new RegExp(`((?<![A-Za-z0-9_.-])${SECRET_NAME}\\\\?["']?\\s*(?:[=:]|%3D)\\s*)`
  + `(\\\\"(?:[^"\\\\]|\\\\[^"])*\\\\"|"(?:[^"\\\\]|\\\\.)*"|'[^']*'|[^&\\s"'\\\\,;}]+)`, 'gi')
const pairValue = (match: string, name: string, value: string) => {
  if (flagValue(value)) return match
  const quote = /^(\\?["'])/.exec(value)?.[1] ?? ''
  return `${name}${quote}[redacted]${quote}`
}
/** A column whose name says it holds a secret is blanked, unless its value is a count or a flag (chart columns named after event types). */
const SECRET_COLUMN = new RegExp(`(?:^|[^A-Za-z0-9])${SECRET_NAME}$|cookie$`, 'i')
const secretCell = (k: string, v: unknown) => SECRET_COLUMN.test(k)
  && (Array.isArray(v) ? v : [v]).some(x => typeof x === 'string' && !/^-?\d+(?:\.\d+)?$/.test(x) && !flagValue(x))
/** Redacts before shortening, so a secret cut at the length limit is still recognized. Reads at most 2000 characters. */
export const redactSecrets = (s: string) => SECRET_PATTERNS.reduce((t, [p, to]) => t.replace(p, to as string), s.slice(0, 2000)).replace(SECRET_PAIR, pairValue)
const safeValue = (v: unknown): unknown => {
  if (typeof v === 'number' && Number.isFinite(v) || typeof v === 'boolean' || v === null) return v
  if (Array.isArray(v)) return v.slice(0, 3).map(x => typeof x === 'string' ? redactSecrets(x).slice(0, 120) : null)
  if (typeof v !== 'string') return null
  return redactSecrets(v).slice(0, 400)
}
/** Redacted column names, numbered when two become the same so no column overwrites another. */
export const columnNames = (columns: string[]) => {
  const taken = new Set<string>()
  return columns.map(k => {
    const base = redactSecrets(k)
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base} ${n}`
    taken.add(name)
    return name
  })
}

/** One process owns this private directory. Restarted in-flight jobs are never reported complete. */
export class QueryService {
  private readonly jobs = new Map<string, Job>()
  private readonly tasks = new Map<string, Promise<void>>()
  get activeCount() { return this.tasks.size }
  constructor(private readonly transport: SearchTransport, private readonly workspaces: Workspace[], private readonly dir: string,
    private readonly store: LogStore,
    private readonly graphIndex: () => Promise<GraphIndex | null> = async () => null,
    private readonly now = Date.now, private readonly sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    for (const file of fs.readdirSync(dir).filter(f => uuid.test(f.replace(/\.json$/, '')) && f.endsWith('.json'))) {
      const j: Job = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (!uuid.test(j.id) || file !== `${j.id}.json`) throw new Error('invalid_job_file')
      // A job written before the log cache held its rows itself; it cannot be paged any more.
      if (!('storedCount' in j)) { fs.rmSync(path.join(dir, file), { force: true }); continue }
      if (active(j)) { j.state = 'failed'; j.reasons.push('gateway_restarted'); if (j.sid) void transport.cancel(j.sid).catch(() => undefined) }
      this.jobs.set(j.id, j)
      this.save(j)
    }
    this.prune()
  }
  private save(j: Job) {
    const file = path.join(this.dir, `${j.id}.json`)
    fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(j), { mode: 0o600 })
    fs.renameSync(`${file}.${process.pid}.tmp`, file)
  }
  private prune() {
    for (const [id, job] of this.jobs) if (job.expires <= this.now() && !active(job)) this.drop(id)
  }
  private drop(id: string) { fs.unlinkSync(path.join(this.dir, `${id}.json`)); this.jobs.delete(id) }
  /** Makes room for one more search: finished searches never refuse a new one. */
  private admit() {
    const jobs = [...this.jobs.values()]
    if (jobs.filter(active).length >= QUERY_LIMITS.jobs) throw new QueryError('capacity_limit')
    const finished = jobs.filter(j => !active(j)).sort((a, b) => a.created - b.created)
    for (const j of finished.slice(0, Math.max(0, jobs.length + 1 - QUERY_LIMITS.jobs))) this.drop(j.id)
  }
  private workspace(s: Scope) {
    if (!s || typeof s.principal !== 'string' || !/^[a-f0-9]{64}$/.test(s.principal)) throw new QueryError('invalid_principal')
    const w = this.workspaces.find(w => w.id === s.workspace && w.policyVersion === s.policyVersion)
    if (!w) throw new QueryError('scope_not_allowed')
    return w
  }
  private owner(s: Scope) { return createHash('sha256').update(`${s.workspace}\n${s.principal}\n${s.policyVersion}`).digest('hex') }
  private job(s: Scope, id: string): Job {
    this.workspace(s); this.prune()
    const j = this.jobs.get(id)
    if (!j || j.owner !== this.owner(s) || j.expires <= this.now()) throw new QueryError('job_not_found')
    return j
  }
  /** Source data list for the schema (catalog.ts); without one every source says pending */
  catalog?: SourceCatalog
  schema(s: Scope) { const w = this.workspace(s); return describeWorkspace(w, ref => this.catalog?.get(w.id, ref)) }
  /** Free SPL ({ spl, sourceRefs, from, to }); spl.ts writes the base search and refuses blocked commands. */
  private compile(plan: unknown, w: Workspace) {
    const c = compileSpl(plan, w)
    return { spl: c.spl, mode: 'spl', sourceRefs: c.sources.map(x => x.ref), notRecordedSources: c.notRecordedSources, columns: [] as string[], from: c.from, to: c.to }
  }
  start(s: Scope, plan: unknown) {
    const w = this.workspace(s), c = this.compile(plan, w)
    checkRange(w, c.from, c.to)
    this.prune()
    const owner = this.owner(s), own = [...this.jobs.values()].filter(j => j.owner === owner)
    if (own.filter(active).length >= 2 || this.tasks.size >= 8) throw new QueryError('concurrency_limit')
    this.admit()
    const j: Job = { id: randomUUID(), owner, workspace: s.workspace, policyVersion: s.policyVersion,
      created: this.now(), expires: this.now() + 3600_000, state: 'queued', executedSpl: c.spl,
      queryHash: createHash('sha256').update(c.spl).digest('hex'), mode: c.mode, sourceRef: c.sourceRefs[0]!, sourceRefs: c.sourceRefs, notRecordedSources: c.notRecordedSources,
      from: c.from, to: c.to, columns: c.columns, resultCount: null, resultId: null, kind: 'rows', storedCount: 0, reasons: [], warnings: [], searchComplete: false }
    this.save(j); this.jobs.set(j.id, j)
    // Defer dispatch so the caller receives a stable queued state.
    const task = Promise.resolve().then(() => this.run(j)).catch(() => {
      j.state = 'failed'; j.reasons.push('job_storage_failed')
      if (j.sid) void this.transport.cancel(j.sid).catch(() => undefined)
    }).finally(() => this.tasks.delete(j.id))
    this.tasks.set(j.id, task)
    return this.view(j)
  }
  status(s: Scope, id: string) { return this.view(this.job(s, id)) }
  private view(j: Job) {
    return { queryId: j.id, state: j.state, source: 'splunk', sourceRef: j.sourceRef, sourceRefs: j.sourceRefs ?? [j.sourceRef], notRecordedSources: j.notRecordedSources ?? [], mode: j.mode, kind: j.kind,
      executedSpl: j.executedSpl, queryHash: j.queryHash, from: j.from, to: j.to, countUnit: 'source_records',
      searchComplete: j.searchComplete, resultCount: j.resultCount, storedCount: j.storedCount,
      // Where the stored result is in the D1 log cache (log_spl_result or log_query_event), so a caller can read it there.
      resultId: j.state === 'complete' || j.state === 'partial' ? j.resultId : null,
      truncated: j.state === 'partial', partialReasons: j.reasons, warnings: j.warnings,
      coverage: { sourceCollection: 'unknown', searchExecution: j.searchComplete ? 'complete' : j.state,
        resultRetrieval: j.state === 'complete' ? 'complete' : j.state, normalization: 'selected_fields_only' },
      expiresAt: new Date(j.expires).toISOString() }
  }
  private resolver = new EntityResolver([])
  private resultHash(j: Job, snapshot: string) { return createHash('sha256').update(`${j.executedSpl}\n${snapshot}`).digest('hex') }

  /**
   * Writes a finished search to the D1 log cache. Free SPL that returned raw events of approved sources is stored as
   * normalized events (shared with Timeline); anything else as rows with redacted, shortened values.
   */
  private async storeResult(j: Job, raw: Record<string, unknown>[], snapshot: string) {
    const sources = this.workspaces.find(w => w.id === j.workspace)?.sources ?? []
    const sourceOf = (row: Record<string, unknown>) => sources.find(s => s.index === row.index && s.sourcetype === row.sourcetype)
    const asEvents = j.mode === 'spl' && raw.length > 0 && raw.every(row => typeof row._raw === 'string' && sourceOf(row))
    const resultId = randomUUID(), expiresAt = this.store.expiresFor(bucketStart(Date.parse(j.to) - 1))
    try {
      if (asEvents) {
        const byKey = new Map<string, NormalizedEvent>(), receivedAt = new Date(this.now()).toISOString()
        raw.forEach((row, i) => {
          const source = sourceOf(row) as Source
          const mapped = mapRow(row as never, { index: source.index, sourcetype: source.sourcetype, sid: j.sid ?? '', offset: i,
            tenant: 'value' in source.isolation ? source.isolation.value : source.index, receivedAt }, this.resolver)
          if (mapped.error) { if (!j.reasons.includes('mapping_errors')) j.reasons.push('mapping_errors'); return }
          // A row of an expanded source (GWS events{}, Guard data{}) is one child event: keep only that child of its record.
          const child = typeof row.aegi_child_index === 'string' && /^\d+$/.test(row.aegi_child_index) ? Number(row.aegi_child_index) : null
          const events = child === null ? mapped.events : mapped.events.slice(child, child + 1)
          // The same record can come back once per child; the first row's event (its offset) stays.
          for (const e of events) if (!byKey.has(e.origin_key)) byKey.set(e.origin_key, e)
        })
        const events = [...byKey.values()]
        await this.store.writeEvents(events, snapshot)
        const keys = events.map(e => e.origin_key)
        Object.assign(j, { kind: 'events', columns: [], storedCount: keys.length })
        await this.store.saveResult(this.resultHash(j, snapshot), { resultId, kind: 'events', columns: [], rowCount: keys.length, reasons: j.reasons, expiresAt }, { keys })
      } else {
        const columns = j.columns.length ? j.columns : [...new Set(raw.flatMap(row => Object.keys(row)))].filter(resultColumn).sort()
        // chart, xyseries and transpose turn field values into column names, so names are redacted like values.
        const names = columnNames(columns)
        const rows = raw.map(row => {
          const long = columns.some(k => typeof row[k] === 'string' && (row[k] as string).length > 400
            || Array.isArray(row[k]) && ((row[k] as unknown[]).length > 3 || (row[k] as unknown[]).some(v => typeof v === 'string' && v.length > 120)))
          if (long && !j.reasons.includes('field_value_truncated')) j.reasons.push('field_value_truncated')
          return Object.fromEntries(columns.map((k, i) => [names[i], secretCell(k, row[k]) ? '[redacted]' : safeValue(row[k])]))
        })
        Object.assign(j, { kind: 'rows', columns: names, storedCount: rows.length })
        await this.store.saveResult(this.resultHash(j, snapshot), { resultId, kind: 'rows', columns: names, rowCount: rows.length, reasons: j.reasons, expiresAt }, { rows })
      }
    } catch { j.storedCount = 0; throw new QueryError('d1_write_failed') }
    j.resultId = resultId
  }

  /** Used by tests and graceful process shutdown. */
  async settled(id: string) { await this.tasks.get(id) }
  private async run(j: Job) {
    const deadline = this.now() + 120_000
    try {
      if (!active(j)) return
      j.state = 'running'; this.save(j)
      // Free SPL may return raw events, mapped to graph objects; their stored result belongs to one graph snapshot.
      let snapshot = '', index: GraphIndex | null = null
      if (j.mode === 'spl') { index = await this.graphIndex().catch(() => null); snapshot = index?.snapshotId ?? '' }
      this.resolver = resolverOf(index)
      const cached = await this.store.findResult(this.resultHash(j, snapshot)).catch(() => null)
      if (cached) {
        Object.assign(j, { resultId: cached.resultId, kind: cached.kind, columns: cached.columns, storedCount: cached.rowCount, resultCount: cached.rowCount,
          searchComplete: true, reasons: cached.reasons, warnings: ['served_from_log_cache'] })
        j.state = j.reasons.length ? 'partial' : 'complete'; this.save(j); return
      }
      j.sid = await this.transport.createJob(j.executedSpl, 120)
      if (!active(j)) { await this.transport.cancel(j.sid).catch(() => { j.warnings.push('remote_cancel_unconfirmed'); this.save(j) }); return }
      let status = await this.transport.jobStatus(j.sid)
      while (!status.isDone && !status.isFailed) {
        if (!active(j)) return
        if (this.now() >= deadline) throw new QueryError('timeout')
        await this.sleep(1000); status = await this.transport.jobStatus(j.sid)
      }
      if (!active(j)) return
      if (status.isFailed || ['FAILED', 'EXPIRED'].includes(status.dispatchState)) throw new QueryError('search_failed')
      j.searchComplete = !status.truncated
      if (!Number.isSafeInteger(status.resultCount) || status.resultCount < 0) throw new QueryError('invalid_result_count')
      j.resultCount = status.resultCount
      // Never return server messages containing searches or data; preserve warning presence.
      j.warnings = status.messages.length ? ['splunk_reported_messages'] : []
      if (status.resultCount > QUERY_LIMITS.maxResults) throw new QueryError('too_many_results')
      j.state = 'fetching'; this.save(j)
      const raw: Record<string, unknown>[] = []
      while (raw.length < status.resultCount) {
        if (!active(j)) return
        if (this.now() >= deadline) throw new QueryError('timeout')
        const want = Math.min(1000, status.resultCount - raw.length)
        const page = await this.transport.results(j.sid, raw.length, want)
        if (!active(j)) return
        if (page.preview || !page.rows.length) { j.reasons.push(page.preview ? 'preview' : 'page_missing'); break }
        if (page.rows.length > want) throw new QueryError('invalid_page_size')
        raw.push(...page.rows)
      }
      if (!active(j)) return
      if (status.truncated) j.reasons.push('splunk_truncated')
      if (status.messages.length && (!status.messageLevels || status.messageLevels.some(level => !['INFO', 'DEBUG'].includes(level)))) j.reasons.push('splunk_messages_require_review')
      if (raw.length !== status.resultCount && !j.reasons.length) j.reasons.push('page_missing')
      await this.storeResult(j, raw, snapshot)
      j.state = j.reasons.length ? 'partial' : 'complete'; this.save(j)
    } catch (error) {
      if (!active(j)) return
      j.state = j.storedCount ? 'partial' : 'failed'
      j.reasons.push(error instanceof QueryError ? error.code : 'splunk_unavailable')
      this.save(j)
      if (j.sid) await this.transport.cancel(j.sid).catch(() => undefined)
    }
  }
}
