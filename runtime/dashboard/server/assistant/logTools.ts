/**
 * AI 로그 도구 search_logs, read_logs 를 AI Worker 안에서 실행한다. 브라우저가 대신 실행하지 않는다.
 * Connector(adapter-engine service.ts)가 SPL을 검사하고 Splunk를 검색해 결과를 D1 로그 캐시에 쓰고, 여기는 완료를 기다린 뒤
 * D1에서 결과를 읽어 모델에 줄 근거로 만든다. 실패는 코드로 돌려주고 다른 경로의 데이터로 대신 채우지 않는다.
 */
import { EVENT_CATEGORIES, isRecord, modelToolJson, parseToolArgs, type KgFact, type LogToolOutput } from '../../src/assistant/chatProtocol'
import { eventFact } from '../../src/assistant/eventTools'
import type { TimelineEvent } from '../../src/timeline/timelineAnalysis'
import type { D1Like } from '../exceptions'
import { logError, selectResultEvents, selectResultRows } from '../logEvents'
import type { RelayReply, RelayRequest, RelayScope } from '../splunkRelay'
import type { SplunkTransport } from '../splunkTransport'

/** 첫 페이지와 read_logs 기본 크기 */
export const LOG_TOOL_PAGE = 20
/** Connector 실행 상한 120초에 결과 저장 여유를 더한다 */
const SEARCH_WAIT_MS = 130_000
const RELAY_TIMEOUT_MS = 20_000
/** 모델 컨텍스트에 넣는 근거 크기. finishKgExecution 의 출력 상한 안에 둔다 */
const FACT_BYTES = 13_000

export interface LogToolDeps {
  transport: SplunkTransport; db: D1Like; scope: RelayScope
  now?: () => number; sleep?: (ms: number) => Promise<void>
}
type Fact = Omit<KgFact, 'id'>
interface QueryView {
  queryId: string; state: string; kind?: 'rows' | 'events'; executedSpl?: string; sourceRefs?: string[]; from?: string; to?: string
  resultCount?: number | null; storedCount?: number; resultId?: string | null; partialReasons?: string[]; warnings?: string[]
  /** Named sources the connector left out because they do not record the matched outcome */
  notRecordedSources?: string[]
}
/** What the AI asked for: its own pipeline and match filters, shown instead of the long server-written base search */
interface Asked { spl?: string; matchCategories?: string[]; matchOutcomes?: string[] }
/** Connector schema of one log source (engine workspace.ts describeWorkspace) */
interface SourceSchema {
  ref: string; provider: string; fields?: string[]; fieldPaths?: Record<string, string>; note?: string
  classes?: { unit: string; outcome: string; commonFields: string[]; notRecorded: string[] }
  catalog?: { state: string; window?: { from: string; to: string; days: number }; total?: number; first?: string | null; last?: string | null; perDay?: number
    eventTypes?: Array<{ value: string; count: number; outcomes?: Record<string, number> }>; omittedEventTypes?: number; fields?: string[]; parameters?: Record<string, string[]>
    classCounts?: Array<{ category: string; outcome: string; count: number }> }
}

const ERROR_TEXT: Record<string, string> = {
  connector_unreachable: '조회 서버에 연결하지 못했습니다', splunk_failed: 'Splunk 검색이 실패했습니다', timeout: '120초 안에 검색이 끝나지 않았습니다. 기간이나 조건을 좁혀 다시 검색하세요',
  spl_rejected: '허용하지 않는 명령이 든 SPL입니다', too_many_results: '결과가 너무 많습니다. 기간이나 조건을 좁히거나 집계하세요', d1_write_failed: '검색 결과를 저장하지 못했습니다',
  d1_read_failed: '저장된 결과를 읽지 못했습니다', graph_snapshot_changed: '검색 중 그래프가 바뀌었습니다', search_budget_exceeded: '검색 횟수 한도에 도달했습니다',
  concurrency_limit: '동시에 진행 중인 검색이 많습니다', job_not_found: '이 검색 결과를 찾지 못했습니다. 다시 검색하세요', login_required: '로그인한 세션에서만 로그를 검색할 수 있습니다',
  not_recorded: '고른 소스는 이 결과(성공, 실패)를 기록하지 않아 검색하지 않았습니다. 0건이 아니라 기록 없음입니다',
}
/** engine 이 돌려주는 입력 오류와 기록 없음은 그대로 둔다. 모델이 고쳐 다시 부르거나 기록 없음으로 답할 수 있게 */
const INPUT_ERRORS = ['source_not_allowed', 'invalid_source', 'invalid_spl', 'absolute_utc_range_required', 'range_exceeded', 'unsupported_property', 'invalid_plan', 'invalid_match', 'not_recorded']

export function logToolFailure(code: string, scope: Record<string, unknown> = {}): LogToolOutput {
  return failure(code, scope)
}
function failure(code: string, scope: Record<string, unknown> = {}): LogToolOutput {
  const text = ERROR_TEXT[code] ?? (INPUT_ERRORS.includes(code) ? `검색 요청이 잘못되었습니다(${code})` : `로그를 검색하지 못했습니다(${code})`)
  if (code === 'not_recorded') return { summary: `${text}.`, truncated: false,
    facts: [{ kind: 'reference', ref: 'logs:not_recorded', label: '기록하지 않는 판정', state: 'unknown', detail: `${text}. 이 소스로는 이 질문에 답할 수 없다고 답하세요.`, data: { error: code, ...scope } }] }
  return { summary: `${text}. 다른 저장소의 결과로 대신하지 않았습니다.`, truncated: false,
    facts: [{ kind: 'reference', ref: `logs:error:${code}`, label: '로그 검색 실패', state: 'unknown', detail: `${text}. 결과 없음으로 해석하지 마세요. 답에 로그를 검색하지 못했다고 밝히고, 관측 시각을 권한이 생기거나 바뀐 때로 말하지 마세요.`, data: { error: code, ...scope } }] }
}

/** 소스마다 Splunk 에 있는 데이터 기간. 데이터 목록이 없으면 준비 중으로 둔다 */
function coverageLine(sources: SourceSchema[] | null, refs: string[]): string {
  const lines = refs.map(ref => {
    const c = sources?.find(s => s.ref === ref)?.catalog
    if (!c || c.state !== 'ready' || !c.window) return `${ref}: 데이터 목록 준비 중`
    return `${ref}: 최근 ${c.window.days}일 ${c.total ?? 0}건(하루 평균 ${c.perDay ?? 0}건), 가장 이른 ${c.first ?? '없음'}, 가장 늦은 ${c.last ?? '없음'}`
  })
  return `Splunk에 있는 데이터(데이터 목록 기준):\n${lines.join('\n')}\nSaaS 원본과 비교한 수집 완전성은 확인하지 않았습니다.`
}

/** 0건일 때 같은 판정 필터가 데이터 목록(최근 30일)에서 찾는 건수. 기간이 달라 정답이 아니라 비교할 사실이다 */
function filterCounts(sources: SourceSchema[] | null, refs: string[], asked: Asked): string {
  const cats = asked.matchCategories ?? [], outs = asked.matchOutcomes ?? []
  if (!cats.length && !outs.length) return ''
  const parts = refs.flatMap(ref => {
    const c = sources?.find(s => s.ref === ref)?.catalog
    if (c?.state !== 'ready' || !c.classCounts) return []
    const n = c.classCounts.filter(x => (!cats.length || cats.includes(x.category)) && (!outs.length || outs.includes(x.outcome))).reduce((sum, x) => sum + x.count, 0)
    return [`${ref} ${n}건`]
  })
  return parts.length ? ` 같은 판정 필터가 데이터 목록(최근 30일)에서 찾는 이벤트: ${parts.join(', ')}.` : ''
}

/** 결과가 비었는지: 행이 없거나, 집계 한 줄의 수가 모두 0 */
function emptyResult(v: QueryView, rows: Array<Record<string, unknown>> | null): boolean {
  if ((v.storedCount ?? 0) === 0) return true
  if (v.kind === 'events' || !rows || rows.length !== 1) return false
  const values = Object.values(rows[0]!)
  return values.length > 0 && values.every(x => x === '0' || x === 0)
}

async function ask(deps: LogToolDeps, request: Omit<RelayRequest, 'scope'>): Promise<{ ok: true; body: QueryView } | { ok: false; code: string }> {
  let reply: RelayReply
  try { reply = await deps.transport.request({ ...request, scope: deps.scope }, RELAY_TIMEOUT_MS) } catch { return { ok: false, code: 'connector_unreachable' } }
  if (reply.status === 200) return { ok: true, body: reply.body as unknown as QueryView }
  const code = typeof reply.body.error === 'string' && /^[a-z_]{1,80}$/.test(reply.body.error) ? reply.body.error : 'connector_unreachable'
  return { ok: false, code: INPUT_ERRORS.includes(code) ? code : logError(code) }
}

function scopeFact(v: QueryView, shown: number, offset: number, asked: Asked, sources: SourceSchema[] | null, empty: boolean): Fact {
  const stored = v.storedCount ?? 0, reasons = v.partialReasons ?? [], notRecorded = v.notRecordedSources ?? []
  const state: Record<string, string> = { complete: '완료', partial: '일부 결과', failed: '실패', cancelled: '취소' }
  const filters = [asked.matchCategories?.length ? `범주 ${asked.matchCategories.join(', ')}` : '', asked.matchOutcomes?.length ? `결과 ${asked.matchOutcomes.join(', ')}` : ''].filter(Boolean).join(', ')
  return { kind: 'reference', ref: `logs:${v.queryId}`, label: 'Splunk 로그 검색 범위와 실행 기록', state: 'unknown',
    detail: [`검색 상태: ${state[v.state] ?? v.state}`, v.from ? `기간(UTC): ${v.from} ~ ${v.to}` : '', `검색한 소스: ${(v.sourceRefs ?? []).join(', ')}`,
      notRecorded.length ? `기록하지 않아 검색하지 않은 소스: ${notRecorded.join(', ')}. 이 소스는 0건이 아니라 기록 없음입니다.` : '',
      // read_logs 는 처음 검색의 인자를 모른다. 처음 검색(search_logs)에서만 적는다
      asked.spl === undefined ? '' : `판정 필터: ${filters || '없음'}`, asked.spl === undefined ? '' : `AI가 쓴 파이프라인: ${asked.spl.trim() || '없음(원본 이벤트)'}`,
      `결과 종류: ${v.kind === 'events' ? '정규화 이벤트' : '결과 행'}`, `저장된 결과: ${stored}건, 이번에 보인 것: ${shown ? `${offset + 1}~${offset + shown}번째` : '없음'}`,
      offset + shown < stored ? `남은 결과가 있습니다. read_logs(queryId=${v.queryId}, offset=${offset + shown})로 이어 읽으세요.` : '',
      reasons.length ? `제한 사유: ${reasons.join(', ')}` : '', (v.warnings ?? []).includes('served_from_log_cache') ? '같은 검색의 저장된 결과를 다시 썼습니다.' : '',
      empty ? `조건에 맞는 결과가 0건입니다.${filterCounts(sources, v.sourceRefs ?? [], asked)}` : '',
      coverageLine(sources, v.sourceRefs ?? [])].filter(Boolean).join('\n'),
    data: { queryId: v.queryId, state: v.state, kind: v.kind, from: v.from, to: v.to, sourceRefs: v.sourceRefs, notRecordedSources: notRecorded, storedCount: stored, offset, shown,
      partialReasons: reasons, collectionCoverage: 'unknown', source: 'splunk', pipeline: asked.spl ?? '', matchCategories: asked.matchCategories ?? [], matchOutcomes: asked.matchOutcomes ?? [],
      executedSpl: v.executedSpl } }
}

const TALLY_VALUES = 8, TALLY_COLUMNS = 4
/**
 * 원본 행 목록(table)의 칸별 행 수. 모델이 행을 직접 세다 틀리지 않게 코드가 센다.
 * 이미 집계한 결과(count 칸)는 세지 않는다. 값 종류가 적고 겹치는 칸만, aegi_ 공통 필드부터
 */
function rowTally(rows: Array<Record<string, unknown>>): string[] {
  if (rows.length < 2 || rows.some(r => 'count' in r)) return []
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => !k.startsWith('_'))
    .sort((a, b) => Number(b.startsWith('aegi_')) - Number(a.startsWith('aegi_')))
  const lines: string[] = []
  for (const key of keys) {
    const counts = new Map<string, number>()
    for (const r of rows) {
      const v = r[key] === undefined || r[key] === null || r[key] === '' ? '(빈 값)' : String(r[key])
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    if (counts.size > TALLY_VALUES || counts.size === rows.length) continue
    lines.push(`${key}: ${[...counts].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} ${n}`).join(', ')}`)
    if (lines.length >= TALLY_COLUMNS) break
  }
  return lines
}

/** D1 에서 [offset, offset + limit) 를 읽어 근거로 만든다. 컨텍스트에 들지 않는 행은 넣지 않고 그 사실을 적는다 */
async function pageOutput(deps: LogToolDeps, v: QueryView, offset: number, limit: number, asked: Asked = {}): Promise<LogToolOutput> {
  if (!v.resultId) return failure(v.state === 'failed' ? logError(v.partialReasons?.[0] ?? 'splunk_failed') : 'job_not_found', { queryId: v.queryId })
  let items: Fact[], rows: Array<Record<string, unknown>> | null = null
  try {
    if (v.kind === 'events') items = (await selectResultEvents(deps.db, v.resultId, offset, limit) as TimelineEvent[]).map(eventFact)
    else {
      rows = await selectResultRows(deps.db, v.resultId, offset, limit)
      items = rows.map((row, i) => ({ kind: 'reference', ref: `logs:${v.queryId}:${offset + i}`, label: 'Splunk 검색 결과 행',
        state: 'confirmed', detail: JSON.stringify(row).slice(0, 1200), data: { row, queryId: v.queryId, source: 'splunk' } }))
    }
  } catch { return failure('d1_read_failed', { queryId: v.queryId }) }
  const sources = (await loadCatalog(deps))?.sources ?? null, empty = offset === 0 && emptyResult(v, rows)
  const facts: Fact[] = [scopeFact(v, items.length, offset, asked, sources, empty)]
  let shown = 0
  for (const item of items) {
    if (modelToolJson([...facts, item]).length > FACT_BYTES) break
    facts.push(item); shown++
  }
  facts[0] = scopeFact(v, shown, offset, asked, sources, empty)
  if (shown < items.length) facts[0].detail += `\n이 페이지의 ${items.length - shown}건은 AI 컨텍스트 한도로 넣지 못했습니다. read_logs(offset=${offset + shown})로 이어 읽거나 조건을 좁히세요.`
  // 결과 전체가 이 페이지에 보일 때만 센다. 일부만 센 수를 전체처럼 쓰지 않게
  const tally = rows && offset === 0 && shown === rows.length && shown === (v.storedCount ?? 0) ? rowTally(rows) : []
  const masked = facts.slice(1).filter(f => /\[redacted\]|\[secret:/.test(f.detail ?? '')).length
  const extra = [tally.length ? `칸별 행 수(코드로 셈, 결과 ${shown}행 전체): ${tally.join('; ')}` : '',
    masked ? `가려진 값이 든 결과: ${masked}건. gateway가 값을 가려 그 내용은 이 결과로 알 수 없습니다.` : ''].filter(Boolean).join('\n')
  // 근거 크기 한도 안에서만 붙인다
  if (extra && modelToolJson([{ ...facts[0], detail: `${facts[0].detail}\n${extra}` }, ...facts.slice(1)]).length <= FACT_BYTES) facts[0].detail += `\n${extra}`
  const stored = v.storedCount ?? 0, notRecorded = v.notRecordedSources ?? []
  const summary = `Splunk 로그 검색 ${v.state === 'complete' ? '완료' : '일부 결과'}: 저장된 결과 ${stored}건 중 ${shown}건을 보였습니다.`
    + (notRecorded.length ? ` ${notRecorded.join(', ')}는 이 결과를 기록하지 않아 검색하지 않았습니다.` : '')
  return { summary, facts, truncated: offset + shown < stored || (v.partialReasons ?? []).length > 0 }
}

export async function runLogTool(name: string, rawArgs: unknown, deps: LogToolDeps): Promise<LogToolOutput> {
  const args = parseToolArgs(name, rawArgs)
  if (!args) return failure('invalid_plan')
  const now = deps.now ?? Date.now, sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  if (name === 'read_logs') {
    const status = await ask(deps, { action: 'status', queryId: args.queryId })
    if (!status.ok) return failure(status.code, { queryId: args.queryId })
    if (status.body.state !== 'complete' && status.body.state !== 'partial') return failure(status.body.state === 'failed' ? logError(status.body.partialReasons?.[0] ?? 'splunk_failed') : 'job_not_found', { queryId: args.queryId })
    return pageOutput(deps, status.body, Number(args.offset ?? 0), Number(args.limit ?? LOG_TOOL_PAGE))
  }
  if (name !== 'search_logs') return failure('invalid_plan')
  const asked: Asked = { spl: typeof args.spl === 'string' ? args.spl : '',
    ...(Array.isArray(args.matchCategories) ? { matchCategories: args.matchCategories } : {}), ...(Array.isArray(args.matchOutcomes) ? { matchOutcomes: args.matchOutcomes } : {}) }
  const plan = { ...asked, sourceRefs: args.sourceRefs, from: args.from, to: args.to }
  const started = await ask(deps, { action: 'search', plan })
  if (!started.ok) return failure(started.code, { from: args.from, to: args.to, sourceRefs: args.sourceRefs, ...asked })
  let view = started.body
  const deadline = now() + SEARCH_WAIT_MS
  for (let polls = 0; ['queued', 'running', 'fetching'].includes(view.state); polls++) {
    if (now() >= deadline) return failure('timeout', { queryId: view.queryId })
    await sleep(polls < 4 ? 500 : 1000)
    const next = await ask(deps, { action: 'status', queryId: view.queryId })
    if (!next.ok) return failure(next.code, { queryId: view.queryId })
    view = next.body
  }
  if (view.state !== 'complete' && view.state !== 'partial') return failure(logError(view.partialReasons?.[0] ?? 'splunk_failed'), { queryId: view.queryId, executedSpl: view.executedSpl })
  return pageOutput(deps, view, 0, LOG_TOOL_PAGE, asked)
}

/** 소스 하나를 모델에 알리는 글: 원본 필드, 공통 필드와 판정, 데이터 목록(이벤트 종류, 필드 경로, 기간) */
function describeSource(s: SourceSchema): string {
  // A connector before fieldPaths names only the aliases; the model then reads raw fields from returned events.
  const lines = [`${s.ref} (${s.provider}): raw fields ${s.fieldPaths ? Object.entries(s.fieldPaths).map(([alias, raw]) => `${alias}=${raw}`).join(', ') : (s.fields ?? []).join(', ')}${s.note ? `. ${s.note}` : ''}`]
  if (s.classes) lines.push(`  counts ${s.classes.unit}; outcome ${s.classes.outcome}; common fields not recorded: ${s.classes.notRecorded.join(', ') || 'none'}`)
  const c = s.catalog
  if (!c || c.state === 'pending') lines.push('  data list: pending')
  else if (c.state !== 'ready') lines.push('  data list: unavailable')
  else {
    lines.push(`  data ${c.window?.from} to ${c.window?.to}: ${c.total} events, ${c.perDay}/day, first ${c.first ?? 'none'}, last ${c.last ?? 'none'}`)
    const types = (c.eventTypes ?? []).map(t => `${t.value} ${t.count}${t.outcomes ? ` (${Object.entries(t.outcomes).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}`)
    if (types.length) lines.push(`  aegi_event_type values (count): ${types.join('; ')}${c.omittedEventTypes ? `; ${c.omittedEventTypes} rarer types omitted` : ''}`)
    if (c.fields?.length) lines.push(`  raw field paths: ${c.fields.join(', ')}`)
    for (const [app, names] of Object.entries(c.parameters ?? {})) lines.push(`  ${app} parameter names: ${names.join(', ')}`)
  }
  return lines.join('\n')
}

/** 판정 범주의 뜻(engine eventClasses.ts CATEGORY_DESCRIPTIONS). 도구가 받는 범주와 다르면 그 사실도 알린다 */
function categoryLine(categories: Record<string, string> | null): string {
  if (!categories) return 'matchCategories meanings: not provided by this connector'
  const ids = Object.keys(categories), accepted: readonly string[] = EVENT_CATEGORIES
  const lines = [`matchCategories meanings: ${ids.map(id => `${id} = ${categories[id]}`).join('; ')}`]
  if (ids.length !== accepted.length || ids.some(id => !accepted.includes(id)))
    lines.push(`The connector table has categories ${ids.join(', ')} but matchCategories accepts ${accepted.join(', ')}; filter any other category with aegi_category in the pipeline.`)
  return lines.join('\n')
}

/** 모델에 알려 줄 로그 소스 목록. Connector 의 schema 를 Worker 안에서 10분 둔다 */
const catalogCache = new Map<string, { at: number; text: string; sources: SourceSchema[] }>()
async function loadCatalog(deps: LogToolDeps): Promise<{ text: string; sources: SourceSchema[] } | null> {
  const key = `${deps.transport.namespace}\n${deps.scope.workspace}\n${deps.scope.policyVersion}`, now = (deps.now ?? Date.now)()
  const hit = catalogCache.get(key)
  if (hit && now - hit.at < 600_000) return hit
  let reply: RelayReply
  try { reply = await deps.transport.request({ action: 'schema', scope: deps.scope }, RELAY_TIMEOUT_MS) } catch { return null }
  const sources = reply.status === 200 && Array.isArray(reply.body.sources) ? reply.body.sources as SourceSchema[] : null
  if (!sources) return null
  const categories = isRecord(reply.body.categories) ? reply.body.categories as Record<string, string> : null
  const entry = { at: now, text: [categoryLine(categories), ...sources.map(describeSource)].join('\n'), sources }
  // A list still being built is fetched again on the next question instead of being kept for ten minutes.
  if (sources.every(s => s.catalog?.state !== 'pending')) catalogCache.set(key, entry)
  return entry
}
export async function logCatalog(deps: LogToolDeps): Promise<string | null> {
  return (await loadCatalog(deps))?.text ?? null
}
