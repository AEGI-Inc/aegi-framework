import path from 'node:path'
import type { NormalizedEvent } from '../types.ts'
import type { EventLink } from '../../../../src/events/eventLinks.ts'
import { applyMigrations, insertStatements, D1_MAX_PARAMS, type SqlExecutor } from '../../../loader/sql.ts'
import { ROOT } from '../../../loader/target.ts'
import { LOG_MIGRATIONS } from './logMigrations.ts'

/**
 * D1 cache of Splunk event lookups (migrations/splunk-log). Splunk stays the source; rows here expire.
 * Events are kept per provider and one-hour bucket of event time, so lookups for other objects or overlapping
 * periods reuse what was already read. A bucket is reused only while unexpired and read with the same graph snapshot.
 *
 * Writes are kept low for D1's daily row limit: a bucket that may still receive late events is checked again only for
 * events indexed after its watermark, and a stored event or link is rewritten only when its graph snapshot changed
 * (a link also when its rule_version changed, so a new link rule replaces rows written under the old one).
 * Event rows therefore keep their first expiry; cleanup keeps them while a live bucket or AI result still covers them.
 */
export const LOG_MIGRATIONS_DIR = path.join(ROOT, 'migrations', 'splunk-log')
export const BUCKET_MS = 3600_000
/** A bucket that ended less than this long ago may still receive late events, so it is cached only briefly. */
export const SETTLE_MS = 2 * 3600_000
export const RECENT_TTL_MS = 60_000
/** A re-check reads events indexed from this long before the previous search started, for events not yet searchable then. */
export const INDEX_MARGIN_MS = 5 * 60_000
/** Expired rows stay this long, so a finished lookup can still read its pages. */
const READ_GRACE_MS = 3600_000

export interface SplResult { resultId: string; kind: 'rows' | 'events'; columns: string[]; rowCount: number; reasons: string[]; expiresAt: number }
/** Result rows per stored chunk, well under D1's 2 MB row with redacted, shortened values. */
const ROWS_PER_CHUNK = 500

export interface EventFilter { providers: string[]; fromMs: number; toMs: number; objectKeys: string[]; eventTypes: string[] }
/** Buckets to search as one period. indexEarliestMs: only events indexed from then (a re-check of buckets read before). */
export interface ReadRange { fromMs: number; toMs: number; buckets: number[]; indexEarliestMs?: number }
/** What one provider needs from Splunk for a period: nothing (both null), whole buckets, and/or late events of read buckets. */
export interface ReadPlan { full: ReadRange | null; incremental: ReadRange | null }

export const bucketStart = (ms: number) => Math.floor(ms / BUCKET_MS) * BUCKET_MS
/** Bucket starts covering [fromMs, toMs). */
export function bucketsOf(fromMs: number, toMs: number) {
  const out: number[] = []
  for (let b = bucketStart(fromMs); b < toMs; b += BUCKET_MS) out.push(b)
  return out
}
/** Event time for buckets and order: occurred, else indexed, else received (the first that parses). */
export const eventTime = (e: NormalizedEvent) => [e.occurred_at, e.indexed_at, e.received_at].map(v => v ? Date.parse(v) : NaN).find(Number.isFinite) ?? 0
const range = (buckets: number[]) => buckets.length ? { fromMs: buckets[0]!, toMs: buckets.at(-1)! + BUCKET_MS, buckets } : null
const objectKeys = (e: NormalizedEvent) => [...new Set([e.actor?.object_key, ...e.targets.map(t => t.object_key)].filter((k): k is string => !!k))].sort()

export class LogStore {
  constructor(private readonly exec: SqlExecutor, private readonly ttlMs = 24 * 3600_000, private readonly now = Date.now) {}

  /** The embedded copy (logMigrations.ts), so the connector bundle needs no migrations folder. */
  migrate() { return applyMigrations(this.exec, 'splunk-log', LOG_MIGRATIONS) }

  /** Whether a bucket is past the wait for late events, so a read now is final. */
  private settled(bucket: number) { return bucket + BUCKET_MS <= this.now() - SETTLE_MS }

  /** Expiry of a bucket read now: short while it may still change, the cache TTL once settled. */
  expiresFor(bucket: number) {
    return this.now() + (this.settled(bucket) ? this.ttlMs : RECENT_TTL_MS)
  }

  /**
   * Drops expired rows. An event row keeps its first expiry (it is not rewritten), so it stays while a live bucket
   * of its provider and hour or a live AI result still covers it. Buckets and results go after the events they cover.
   */
  async cleanup() {
    const before = this.now() - READ_GRACE_MS
    await this.exec.batch([
      { sql: `DELETE FROM log_event WHERE expires_at < ?
        AND NOT EXISTS (SELECT 1 FROM log_bucket b WHERE b.provider = log_event.provider AND b.bucket_start = log_event.at_ms - log_event.at_ms % ${BUCKET_MS} AND b.expires_at >= ?)
        AND NOT EXISTS (SELECT 1 FROM log_query_event q WHERE q.origin_key = log_event.origin_key AND q.expires_at >= ?)`, params: [before, before, before] },
      ...['log_bucket', 'log_event_link', 'log_query', 'log_spl_result', 'log_query_event'].map(t => ({ sql: `DELETE FROM ${t} WHERE expires_at < ?`, params: [before] })),
    ])
  }

  /**
   * What to search for one provider and period. A bucket is skipped while unexpired and read with this snapshot.
   * An expired bucket that was not final is checked again only for events indexed after its watermark.
   * A bucket never read, read with another snapshot, or final and expired is searched whole.
   */
  async plan(provider: string, fromMs: number, toMs: number, snapshotId: string): Promise<ReadPlan> {
    const want = bucketsOf(fromMs, toMs)
    const rows = await this.exec.query<{ bucket_start: number; graph_snapshot_id: string; expires_at: number; index_watermark: number; final: number }>(
      'SELECT bucket_start, graph_snapshot_id, expires_at, index_watermark, final FROM log_bucket WHERE provider = ? AND bucket_start >= ? AND bucket_start < ?',
      [provider, want[0] ?? 0, toMs])
    const read = new Map(rows.map(r => [Number(r.bucket_start), r]))
    const now = this.now(), full: number[] = [], incremental: number[] = []
    let watermark = Infinity
    for (const b of want) {
      const r = read.get(b)
      const same = r?.graph_snapshot_id === snapshotId
      if (same && Number(r!.expires_at) > now) continue
      if (same && !Number(r!.final) && Number(r!.index_watermark) > 0) { incremental.push(b); watermark = Math.min(watermark, Number(r!.index_watermark)); continue }
      full.push(b)
    }
    const late = range(incremental)
    return { full: range(full), incremental: late && { ...late, indexEarliestMs: watermark } }
  }

  /** Stores events. A row already stored with the same graph snapshot is left as it is (no write). */
  async writeEvents(events: NormalizedEvent[], snapshotId: string) {
    if (!events.length) return
    const rows = events.map(e => {
      const at = eventTime(e)
      return [e.origin_key, e.provider, e.event_type, at, JSON.stringify(objectKeys(e)), JSON.stringify(e), snapshotId, this.expiresFor(bucketStart(at))]
    })
    await this.exec.batch(newOrRegraphed('log_event', 'origin_key', ['origin_key', 'provider', 'event_type', 'at_ms', 'object_keys', 'body', 'graph_snapshot_id', 'expires_at'], rows))
  }

  /**
   * Marks buckets as read. Called only after every source of the provider succeeded.
   * watermarkMs: every event indexed before it was read (the search start, less INDEX_MARGIN_MS).
   */
  async markRead(provider: string, buckets: number[], snapshotId: string, watermarkMs: number) {
    const now = this.now()
    const rows = buckets.map(b => [provider, b, snapshotId, now, this.expiresFor(b), watermarkMs, this.settled(b) ? 1 : 0])
    await this.exec.batch(upserts('log_bucket', ['provider', 'bucket_start', 'graph_snapshot_id', 'fetched_at', 'expires_at', 'index_watermark', 'final'], rows))
  }

  /** Forgets that buckets were read, e.g. after Splunk input for the period was recovered. Their events are searched whole again. */
  async invalidate(fromMs: number, toMs: number, providers: string[] = []) {
    const only = providers.length ? ` AND provider IN (SELECT value FROM json_each(?))` : ''
    await this.exec.batch([{ sql: `DELETE FROM log_bucket WHERE bucket_start >= ? AND bucket_start < ?${only}`,
      params: [bucketStart(fromMs), toMs, ...(providers.length ? [JSON.stringify(providers)] : [])] }])
  }

  /**
   * Stores links. A link already stored with the same graph snapshot and the same rule_version (eventLinks.ts
   * EVENT_LINK_RULE_VERSION, in the body) is left as it is (no write). A new rule version rewrites the row at once,
   * not after the TTL.
   */
  async writeLinks(links: EventLink[], snapshotId: string) {
    if (!links.length) return
    const expires = this.now() + this.ttlMs
    const rows = links.map(l => [l.id, l.from, l.to, JSON.stringify(l), snapshotId, expires])
    await this.exec.batch(newOrRegraphed('log_event_link', 'id', ['id', 'from_key', 'to_key', 'body', 'graph_snapshot_id', 'expires_at'], rows,
      `json_extract(log_event_link.body, '$.rule_version') IS NOT json_extract(excluded.body, '$.rule_version')`))
  }

  /** An unexpired stored result of the same search (SPL with its period), if any. */
  async findResult(queryHash: string): Promise<SplResult | null> {
    const r = (await this.exec.query<{ result_id: string; kind: 'rows' | 'events'; columns: string; row_count: number; reasons: string; expires_at: number }>(
      'SELECT result_id, kind, columns, row_count, reasons, expires_at FROM log_query WHERE query_hash = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
      [queryHash, this.now()]))[0]
    return r ? { resultId: r.result_id, kind: r.kind, columns: JSON.parse(r.columns), rowCount: Number(r.row_count), reasons: JSON.parse(r.reasons), expiresAt: Number(r.expires_at) } : null
  }

  /** Stores a finished search: rows in chunks, or event keys in order (the events go through writeEvents). The cache record goes last. */
  async saveResult(queryHash: string, r: SplResult, content: { rows?: Record<string, unknown>[]; keys?: string[] }) {
    const statements = []
    if (r.kind === 'rows') {
      const rows = content.rows ?? [], chunks = []
      for (let i = 0; i < rows.length; i += ROWS_PER_CHUNK) chunks.push([r.resultId, i / ROWS_PER_CHUNK, i, JSON.stringify(rows.slice(i, i + ROWS_PER_CHUNK)), r.expiresAt])
      statements.push(...upserts('log_spl_result', ['result_id', 'seq', 'first_row', 'rows', 'expires_at'], chunks))
    } else {
      statements.push(...upserts('log_query_event', ['result_id', 'seq', 'origin_key', 'expires_at'], (content.keys ?? []).map((k, i) => [r.resultId, i, k, r.expiresAt])))
    }
    await this.exec.batch(statements)
    // Only a complete result is offered to later searches; a partial one is kept for its own pages only.
    if (r.reasons.length) return
    await this.exec.batch(upserts('log_query', ['result_id', 'query_hash', 'kind', 'columns', 'row_count', 'reasons', 'created_at', 'expires_at'],
      [[r.resultId, queryHash, r.kind, JSON.stringify(r.columns), r.rowCount, JSON.stringify(r.reasons), this.now(), r.expiresAt]]))
  }

  /** Rows [offset, offset + limit) of a stored rows result. */
  async readRows(resultId: string, offset: number, limit: number): Promise<Record<string, unknown>[]> {
    const first = Math.floor(offset / ROWS_PER_CHUNK), last = Math.floor((offset + limit - 1) / ROWS_PER_CHUNK)
    const chunks = await this.exec.query<{ first_row: number; rows: string }>(
      'SELECT first_row, rows FROM log_spl_result WHERE result_id = ? AND seq BETWEEN ? AND ? ORDER BY seq', [resultId, first, last])
    const rows = chunks.flatMap(c => JSON.parse(c.rows) as Record<string, unknown>[])
    const start = offset - (chunks.length ? Number(chunks[0]!.first_row) : offset)
    return rows.slice(start, start + limit)
  }

  /** Events [offset, offset + limit) of a stored events result, in result order. */
  async readResultEvents(resultId: string, offset: number, limit: number): Promise<NormalizedEvent[]> {
    const keys = (await this.exec.query<{ origin_key: string }>(
      'SELECT origin_key FROM log_query_event WHERE result_id = ? AND seq >= ? AND seq < ? ORDER BY seq', [resultId, offset, offset + limit])).map(r => r.origin_key)
    return this.readByKeys(keys)
  }

  /** Matching events, newest first. */
  async readEvents(f: EventFilter): Promise<NormalizedEvent[]> {
    const { where, params } = filterSql(f)
    const rows = await this.exec.query<{ body: string }>(`SELECT body FROM log_event WHERE ${where} ORDER BY at_ms DESC, origin_key ASC`, params)
    return rows.map(r => JSON.parse(r.body) as NormalizedEvent)
  }

  /** Events by key, in the given order. Keys travel as one JSON parameter to stay under D1's 100 bindings. */
  async readByKeys(keys: string[]): Promise<NormalizedEvent[]> {
    if (!keys.length) return []
    const rows = await this.exec.query<{ origin_key: string; body: string }>(
      'SELECT origin_key, body FROM log_event WHERE origin_key IN (SELECT value FROM json_each(?))', [JSON.stringify(keys)])
    const byKey = new Map(rows.map(r => [r.origin_key, JSON.parse(r.body) as NormalizedEvent]))
    if (byKey.size !== new Set(keys).size) throw new Error('log_rows_missing')
    return keys.map(k => byKey.get(k)!)
  }
}

function filterSql(f: EventFilter) {
  const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ')
  const parts = [`provider IN (${marks(f.providers.length)})`, 'at_ms >= ?', 'at_ms < ?']
  const params: unknown[] = [...f.providers, f.fromMs, f.toMs]
  if (f.eventTypes.length) { parts.push(`event_type IN (${marks(f.eventTypes.length)})`); params.push(...f.eventTypes) }
  if (f.objectKeys.length) { parts.push(`EXISTS (SELECT 1 FROM json_each(log_event.object_keys) WHERE value IN (${marks(f.objectKeys.length)}))`); params.push(...f.objectKeys) }
  return { where: parts.join(' AND '), params }
}

const upserts = (table: string, columns: string[], rows: unknown[][]) => insertStatements(table, columns, rows, D1_MAX_PARAMS, 'INSERT OR REPLACE')
/**
 * Inserts new rows and rewrites a stored row only when it was written with another graph snapshot, or when `orWhen`
 * (an SQL condition on the stored row and `excluded`) holds. D1 counts no write for the rest.
 */
const newOrRegraphed = (table: string, key: string, columns: string[], rows: unknown[][], orWhen?: string) => insertStatements(table, columns, rows, D1_MAX_PARAMS, 'INSERT',
  `ON CONFLICT(${key}) DO UPDATE SET ${columns.filter(c => c !== key).map(c => `${c} = excluded.${c}`).join(', ')} WHERE ${table}.graph_snapshot_id IS NOT excluded.graph_snapshot_id${orWhen ? ` OR ${orWhen}` : ''}`)
