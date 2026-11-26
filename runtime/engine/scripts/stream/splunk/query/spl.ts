import { QueryError, tenantScope, type Source, type Workspace } from './workspace.ts'
import { commonFieldPipes, EVENT_CATEGORIES, MATCH_OUTCOMES, matchPipe } from '../eventClasses.ts'
import { fieldShapeSourcetype } from '../types.ts'

/**
 * AI search with free SPL. The AI names the approved sources and writes the pipeline after them; this service writes the
 * base search (index, sourcetype, period and tenant scope) itself, so tenant scope cannot be skipped. Commands that write,
 * send data out, read other data or run code are refused before Splunk sees the search (spl_rejected).
 * The Splunk role is the second guard (no collect, rest, saved objects; srchMaxTime).
 */
export const SPL_LIMITS = { maxPipelineLength: 4000, maxSources: 8 }

/**
 * Commands refused anywhere in the pipeline. Writing or sending: collect … sendalert. Reading data outside the base
 * search: append … savedsearch (they could skip the tenant scope). Running code or other searches: map, script, run.
 */
export const BLOCKED_COMMANDS = [
  'collect', 'mcollect', 'meventcollect', 'tscollect', 'outputlookup', 'outputcsv', 'outputtext', 'sendemail', 'sendalert', 'delete', 'dbxoutput',
  'append', 'appendcols', 'join', 'union', 'multisearch', 'set', 'inputlookup', 'inputcsv', 'inputintermediate', 'tstats', 'mstats', 'metadata',
  'metasearch', 'eventcount', 'dbinspect', 'datamodel', 'from', 'pivot', 'loadjob', 'savedsearch', 'rest', 'dbxquery', 'map', 'script', 'run',
  'runshellscript', 'makeresults', 'gentimes', 'summaryindex', 'sichart', 'sirare', 'sistats', 'sitimechart', 'sitop',
  // lookup reads lookup tables outside the base search; dump and outputtelemetry write results out.
  'lookup', 'dump', 'outputtelemetry',
  // These read the whole original event (_raw) or turn every field into values, see RAW_DEFAULT.
  'extract', 'kv', 'erex', 'xmlkv', 'multikv', 'kvform', 'abstract', 'transpose', 'untable', 'fieldsummary',
]
/**
 * _raw is the whole original event. As a result column it skips the per-field limits, so the pipeline may not name it
 * (even quoted), reach it through a wildcard (_r*, _*, *aw, values(*)), or run a command whose input defaults to it
 * without naming another field. Raw events still come back when the pipeline keeps them: they are stored as normalized events.
 * Search terms (search "*x*", searchmatch) still test _raw; only a Splunk-side change can close that.
 */
const RAW_DEFAULT: Record<string, RegExp> = { rex: /(?:^|\s)field\s*=/i, spath: /(?:^|\s)input\s*=/i, xpath: /(?:^|\s)field\s*=/i, regex: /^regex\s+[\w.{}]+\s*!?=/i }
/**
 * Field wildcards that can match internal fields: _-prefixed (_r*), * as a function argument (values(*)), a leading * in
 * table, fields or foreach, and a leading * on the source side of rename (rename *aw AS q*; rename aegi_* AS * is fine).
 */
const WILDCARD_FIELDS = /(?:^|[^\w.])_\w*\*|\(\s*\*|^(?:table|fields|foreach)\b.*(?:^|[\s,])\*|^rename\b.*(?:^|[\s,])\*[^\s,]*\s+as\b/i
const iso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v))

/** Command names and the unquoted text of each command, split at | outside quoted strings. */
interface Scan { commands: string[]; segments: string[] }
/**
 * Reads a pipeline outside quoted strings. Subsearches, macros and a backslash outside quotes (Splunk may read it as an
 * escape) are refused. singleQuotes also treats '…' as quoted, a reading Splunk's parser may take; null when that
 * reading leaves a quote open.
 */
function scan(pipeline: string, singleQuotes: boolean): Scan | null {
  const commands: string[] = [], segments: string[] = []
  let quote = '', expectCommand = true, bare = ''
  for (let i = 0; i < pipeline.length; i++) {
    const c = pipeline[i]!
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue }
    if (c === '"' || singleQuotes && c === "'") { quote = c; expectCommand = false; bare += ' '; continue }
    if (c === '[' || c === ']' || c === '`' || c === '\\') throw new QueryError('spl_rejected')
    if (c === '|') { segments.push(bare.trim()); bare = ''; expectCommand = true; continue }
    if (expectCommand && /\S/.test(c)) {
      const word = /^[A-Za-z_][\w-]*/.exec(pipeline.slice(i))?.[0]
      if (!word) throw new QueryError('spl_rejected')
      commands.push(word.toLowerCase()); bare += word; i += word.length - 1; expectCommand = false
      continue
    }
    bare += c
  }
  if (quote) return null
  segments.push(bare.trim())
  return { commands, segments: segments.filter(Boolean) }
}

/** Command names of a pipeline, read outside double-quoted strings. */
export function pipelineCommands(pipeline: string) {
  const strict = scan(pipeline, false)
  if (!strict) throw new QueryError('spl_rejected')
  return strict.commands
}

/**
 * Refuses a blocked command or a read of _raw under either quote reading (spl_rejected). A pipeline whose single-quote
 * reading leaves a quote open is refused too: Splunk could mix both readings.
 */
function refuseUnsafe(pipeline: string) {
  const strict = scan(pipeline, false), single = scan(pipeline, true)
  if (!strict || !single) throw new QueryError('spl_rejected')
  const readsRaw = (segment: string) => {
    const name = /^[A-Za-z_][\w-]*/.exec(segment)?.[0].toLowerCase() ?? ''
    return !!RAW_DEFAULT[name] && !RAW_DEFAULT[name].test(segment)
  }
  for (const s of [strict, single]) {
    // eval lookup() reads lookup tables like the lookup command.
    if (s.commands.some(c => BLOCKED_COMMANDS.includes(c)) || s.segments.some(s => readsRaw(s) || WILDCARD_FIELDS.test(s) || /\blookup\s*\(/i.test(s))) throw new QueryError('spl_rejected')
  }
  if (/_raw/i.test(pipeline)) throw new QueryError('spl_rejected')
  return strict.commands
}

/**
 * The base search of one source: its index, sourcetype, period and tenant scope, then the common fields of the event
 * class table (aegi_event_type, aegi_category, aegi_outcome, aegi_actor_*, aegi_target_*; GWS and Guard counted per child
 * event) and the AI's match filter. Raw fields stay for the pipeline.
 */
/** 같은 이벤트가 두 번 들어온 레코드를 한 번만 센다. aegi_event_id 는 mapper 의 origin_key 와 같은 식이다(Timeline 과 같은 단위).
 * multisearch 안에는 스트리밍 명령만 들어가므로 소스를 합친 뒤에 둔다. ID 가 없는 이벤트는 지우지 않는다 */
export const DEDUP_EVENTS = 'dedup keepempty=true aegi_event_id'

export function baseSearch(source: Source, from: string, to: string, match = '') {
  return [`search index=${source.index} sourcetype="${source.sourcetype}" earliest=${Date.parse(from) / 1000} latest=${Date.parse(to) / 1000}`,
    ...tenantScope(source), 'eval aegi_indextime=_indextime', ...commonFieldPipes(fieldShapeSourcetype(source.sourcetype)), ...(match ? [match] : [])].join(' | ')
}

/** matchCategories, matchOutcomes: distinct values of a closed list, or absent */
function matchList(v: unknown, allowed: readonly string[]): string[] {
  if (v === undefined) return []
  if (!Array.isArray(v) || !v.length || v.length > allowed.length || v.some(x => typeof x !== 'string' || !allowed.includes(x)) || new Set(v).size !== v.length) throw new QueryError('invalid_match')
  return v as string[]
}

export function compileSpl(input: unknown, workspace: Workspace) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new QueryError('invalid_plan')
  const r = input as Record<string, unknown>
  if (Object.keys(r).some(k => !['spl', 'sourceRefs', 'from', 'to', 'matchCategories', 'matchOutcomes'].includes(k))) throw new QueryError('unsupported_property')
  const categories = matchList(r.matchCategories, EVENT_CATEGORIES), outcomes = matchList(r.matchOutcomes, MATCH_OUTCOMES)
  if (!iso(r.from) || !iso(r.to)) throw new QueryError('absolute_utc_range_required')
  const from = r.from, to = r.to
  if (Date.parse(to) <= Date.parse(from)) throw new QueryError('range_exceeded')
  if (typeof r.spl !== 'string' || r.spl.length > SPL_LIMITS.maxPipelineLength || /[\x00-\x08\x0b-\x1f]/.test(r.spl)) throw new QueryError('invalid_spl')
  const refs = r.sourceRefs
  if (!Array.isArray(refs) || !refs.length || refs.length > SPL_LIMITS.maxSources || refs.some(x => typeof x !== 'string')) throw new QueryError('invalid_source')
  const named = [...new Set(refs as string[])].map(ref => workspace.sources.find(s => s.ref === ref) ?? (() => { throw new QueryError('source_not_allowed') })())
  const pipeline = r.spl.replace(/\s+/g, ' ').trim()
  if (pipeline && !pipeline.startsWith('|')) throw new QueryError('invalid_spl')
  const commands = refuseUnsafe(pipeline)
  // A source that does not record the matched outcome is not searched and is reported, so "no record" never reads as zero.
  const matched = named.map(s => ({ s, match: matchPipe(fieldShapeSourcetype(s.sourcetype), categories, outcomes) }))
  const sources = matched.filter(m => m.match !== null).map(m => m.s)
  const notRecordedSources = matched.filter(m => m.match === null).map(m => m.s.ref)
  if (!sources.length) throw new QueryError('not_recorded')
  const base = sources.length === 1 ? baseSearch(sources[0]!, from, to, matched.find(m => m.s === sources[0])!.match!)
    : `| multisearch ${matched.filter(m => m.match !== null).map(m => `[${baseSearch(m.s, from, to, m.match!)}]`).join(' ')}`
  const unique = `${base} | ${DEDUP_EVENTS}`
  return { spl: pipeline ? `${unique} ${pipeline}` : unique, sources, notRecordedSources, from, to, commands }
}
