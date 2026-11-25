/**
 * Approved Splunk sources of a workspace and their tenant scope. Searches never name an index, sourcetype or tenant
 * themselves: the event lookup (events.ts) and free SPL (spl.ts) write the base search from these sources.
 */
import { CATEGORY_DESCRIPTIONS, classSummary } from '../eventClasses.ts'
import type { CatalogEntry } from './catalog.ts'

export interface Source {
  ref: string; provider: string; index: string; sourcetype: string
  /**
   * Explicit isolation: a dedicated tenant index, or an enforced JSON tenant predicate. `values` lists several IDs of
   * one tenant (Slack audit entries carry either the enterprise or the workspace ID as their location).
   */
  isolation: { dedicated: true } | { field: string; value: string } | { field: string; values: string[] }
  fields: Record<string, string>
}
export interface Workspace { id: string; policyVersion: string; limits?: { maxRangeDays: number }; sources: Source[] }
export class QueryError extends Error { constructor(readonly code: string) { super(code) } }
function fail(code: string): never { throw new QueryError(code) }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const identifier = /^[A-Za-z][A-Za-z0-9_:-]{0,79}$/
const fieldName = /^[a-z][a-z0-9_]{0,39}$/
const jsonPath = /^[A-Za-z0-9_@{}.-]{1,120}$/
const text = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 200 && !/[\x00-\x1f\x7f`]/.test(s)
const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export function validateWorkspace(v: unknown): Workspace {
  if (!record(v) || !identifier.test(String(v.id)) || !identifier.test(String(v.policyVersion)) || !Array.isArray(v.sources) || !v.sources.length || v.sources.length > 12) fail('invalid_workspace')
  if (v.limits !== undefined) {
    if (!record(v.limits) || Object.keys(v.limits).length !== 1 || !('maxRangeDays' in v.limits)) fail('invalid_limits')
    const m = v.limits.maxRangeDays
    if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > 90) fail('invalid_limits')
  }
  const refs = new Set<string>()
  for (const s of v.sources as unknown[]) {
    if (!record(s) || !identifier.test(String(s.ref)) || !identifier.test(String(s.provider)) || !identifier.test(String(s.index)) || !identifier.test(String(s.sourcetype)) || refs.has(String(s.ref))) fail('invalid_source')
    refs.add(String(s.ref))
    if (!record(s.fields) || !Object.keys(s.fields).length || Object.keys(s.fields).length > 16 || Object.entries(s.fields).some(([k, p]) => !fieldName.test(k) || typeof p !== 'string' || !jsonPath.test(p) || /password|secret|cookie|assertion|token_value/i.test(k + p))) fail('invalid_fields')
    const i = s.isolation
    const values = record(i) && Array.isArray(i.values) && i.values.length >= 1 && i.values.length <= 10 && i.values.every(text)
    if (!record(i) || !(i.dedicated === true && Object.keys(i).length === 1) && !(text(i.field) && jsonPath.test(i.field) && (text(i.value) || values) && Object.keys(i).length === 2)) fail('tenant_isolation_required')
  }
  return v as unknown as Workspace
}

/** Tenant scope pipes, applied before any user predicate. */
export function tenantScope(source: Source): string[] {
  const i = source.isolation
  if (!('field' in i)) return []
  const values = 'values' in i ? i.values : [i.value]
  return [`spath path=${i.field} output=aegi_tenant`, values.length === 1 ? `where aegi_tenant=${quote(values[0])}` : `where in(aegi_tenant,${values.map(quote).join(',')})`]
}

/**
 * The log sources an AI search may name (the `schema` action). fieldPaths: the raw Splunk field of each alias.
 * classes: the common fields and outcome the event class table gives the source. catalog: what the data holds
 * (catalog.ts), or pending until it is built.
 */
export function describeWorkspace(w: Workspace, catalog?: (ref: string) => CatalogEntry | undefined) {
  return { policyVersion: w.policyVersion, limits: { runtimeSeconds: 120, concurrency: 2, ...(w.limits ? { maxRangeDays: w.limits.maxRangeDays } : {}) }, categories: CATEGORY_DESCRIPTIONS,
    sources: w.sources.map(s => {
      const classes = classSummary(s.sourcetype)
      return { ref: s.ref, provider: s.provider, fields: Object.keys(s.fields), fieldPaths: s.fields,
        countUnit: classes?.unit.startsWith('child') ? 'child_events' : 'source_records', collectionCoverage: 'unknown',
        ...(classes ? { classes } : {}), catalog: catalog?.(s.ref) ?? { state: 'pending' },
        ...(s.provider === 'gws' ? { note: 'One activity record holds events{}; AI searches count each child event (aegi_event_type is application:name). Parameters are name/value pairs in events{}.parameters{}.' } : {}),
        ...(s.provider === 'salesforce' ? { note: 'Salesforce ids in aegi_actor_id and aegi_target_id are the 15-character form; match an 18-character id by its first 15 characters. Users, permission sets and flows named in Display are targets.' } : {}) }
    }) }
}

export function checkRange(w: Workspace, fromIso: string, toIso: string): void {
  if (w.limits && (Date.parse(toIso) - Date.parse(fromIso)) > w.limits.maxRangeDays * 86_400_000) {
    fail('range_exceeded')
  }
}
