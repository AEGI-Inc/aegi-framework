/**
 * AI 도구 서버 실행 — POST /api/measured/graph/tools (server/measured.ts 가 실측 로그인과 같은 출처를 확인한 뒤 부른다).
 *
 * D1 current 스냅샷에서 고르고 세는 일은 질의로 하고, 필요한 행만 읽어 만든 작은 그래프 위에서
 * 브라우저와 같은 도구 코드(src/assistant/kgTools.ts)로 결과를 만든다. 그래서 모델이 받는 사실과 화면 근거가 브라우저 실행과 같다.
 * 대상 도구는 SERVER_KG_TOOLS. 그래프 전체가 필요하거나 화면 상태에 묶인 도구는 브라우저에서 실행한다.
 * 화면이 플랫폼 기본 객체를 숨기면(hideDefaults) 서버도 같은 규칙으로 뺀다.
 */
import type { D1Like } from './exceptions'
import { currentSnapshotId, hiddenObject, linkIdsOf, loadSubgraph, objectExists, rowsById, visibleObject, visibleRelation } from './snapshotGraph'
import { countEntries, emptyKgResult, executeKgTool, finishKgExecution, HIDDEN_NOTE_NAMES, hiddenSearchNote, identityLinksBySaas, LEVEL_TEXT, objectTypeCounts, principalCounts, propertyNote, rankCredentials, relationListSummary, roleLevelCode, SERVER_KG_TOOLS, typeNote, type KgContext, type KgExecution, type PrecomputedBlast } from '../src/assistant/kgTools'
import { parseKgCall, parseToolArgs, type KgCall, type ToolArgs } from '../src/assistant/chatProtocol'
import { EvidenceBuilder } from '../src/assistant/extendedQuery'
import { identityEvidenceEdges } from '../src/assistant/lookup'
import { buildEvidenceStore, buildGraphStoreV2 } from '../src/data/datasetStore'
import type { BlastRadius } from '../src/detection/v2/blastRadius'
import type { FixtureObject } from '../src/model/object'
import type { IdentityEvidenceEdge } from '../src/assistant/types'
import { EVENT_KG_TOOLS, eventExecution, type EventQueryResult } from '../src/assistant/eventTools'
import type { RelayReply } from './splunkRelay'

export interface ToolRequest {
  call: KgCall
  index: number
  /** 화면이 받은 번들의 스냅샷. 그사이 새 스냅샷이 게시됐으면 409 로 알려 브라우저가 직접 실행하게 한다 */
  snapshotId?: string
  /** 화면에 보이는 탐지 수 (예외 반영). kg_schema 가 쓴다 */
  visibleFindings?: number
  /** 화면이 아무도 쓰지 않는 플랫폼 기본 객체를 숨겼는가 (기본 보기) */
  hideDefaults?: boolean
}

export type ToolResponse =
  | { status: 200; execution: KgExecution }
  | { status: 202 | 400 | 404 | 409 | 503; error: string; snapshotId?: string }
export type SplunkToolReader = (name: string, args: ToolArgs) => Promise<RelayReply>

/** A context with no graph: tool code that needs none (failed arguments, log outputs) runs on it */
export const emptyKgContext = (): KgContext => ({ graph: buildGraphStoreV2([], [], []), evidence: buildEvidenceStore([], []), findings: [] })
/**
 * 이벤트 도구 결과가 가리키는 객체와, 엔진이 두 끝이 같다고 적은 관계(relation_matches)만 담은 부분 그래프.
 * 결과의 graph.objectKeys, relationKeys 는 이 그래프에 있는 것만 남는다. 빈 그래프로 돌리면 화면에 아무것도 걸리지 않는다.
 */
async function eventContext(db: D1Like, snapshotId: string, result: EventQueryResult, hide: boolean): Promise<KgContext> {
  const objectKeys = new Set<string>(), relationKeys = new Set<string>()
  for (const e of result.events) {
    for (const r of [e.actor, ...e.targets]) if (r?.object_key && objectKeys.size < 80) objectKeys.add(r.object_key)
    for (const m of e.relation_matches ?? []) if (relationKeys.size < 80) relationKeys.add(m.relation_id)
  }
  if (!objectKeys.size && !relationKeys.size) return emptyKgContext()
  // 부분 그래프는 결과를 그래프에 거는 데만 쓴다. 읽지 못하면 이벤트 결과는 그대로 두고 그래프에 걸지 않는다
  try {
    const sub = await loadSubgraph(db, snapshotId, { objectKeys, relationKeys }, hide)
    return { graph: sub.graph, evidence: sub.evidence, findings: [] }
  } catch { return emptyKgContext() }
}

const NO_OBJECT = '현재 KG에 해당 객체 키가 없습니다. search_objects로 실제 키를 조회하세요.'

export function parseToolRequest(body: unknown): ToolRequest | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const call = parseKgCall(b.call)
  if (!call || !SERVER_KG_TOOLS.has(call.function.name)) return null
  if (!Number.isInteger(b.index) || (b.index as number) < 1 || (b.index as number) > 1000) return null
  if (b.snapshotId !== undefined && (typeof b.snapshotId !== 'string' || b.snapshotId.length > 100)) return null
  if (b.visibleFindings !== undefined && (!Number.isInteger(b.visibleFindings) || (b.visibleFindings as number) < 0)) return null
  if (b.hideDefaults !== undefined && typeof b.hideDefaults !== 'boolean') return null
  return { call, index: b.index as number, snapshotId: b.snapshotId as string | undefined, visibleFindings: b.visibleFindings as number | undefined, hideDefaults: b.hideDefaults as boolean | undefined }
}

export async function runServerTool(db: D1Like, req: ToolRequest, readSplunk?: SplunkToolReader): Promise<ToolResponse> {
  // 브라우저가 스냅샷을 알려 주면 현재 스냅샷 확인과 도구 질의를 함께 보낸다(D1 왕복 하나 절약).
  // 스냅샷이 바뀌었거나 없으면 도구 결과와 오류는 버리고 예전과 같은 응답을 돌린다
  const [current, early] = await Promise.all([
    currentSnapshotId(db),
    req.snapshotId ? runOnSnapshot(db, req.snapshotId, req, readSplunk).then(value => ({ value }), error => ({ error })) : null,
  ])
  if (!current) return { status: 404, error: 'not_published' }
  if (req.snapshotId && req.snapshotId !== current) return { status: 409, error: 'snapshot_changed', snapshotId: current }
  if (!early) return runOnSnapshot(db, current, req, readSplunk)
  if ('error' in early) throw early.error
  return early.value
}

async function runOnSnapshot(db: D1Like, snapshotId: string, req: ToolRequest, readSplunk?: SplunkToolReader): Promise<ToolResponse> {
  const { call, index } = req
  const hide = req.hideDefaults ?? true
  let args: ToolArgs | null = null
  try { args = parseToolArgs(call.function.name, JSON.parse(call.function.arguments)) } catch { /* 브라우저와 같은 실패 응답 */ }
  if (!args) return { status: 200, execution: executeKgTool(emptyKgContext(), call, index) }
  if (EVENT_KG_TOOLS.has(call.function.name)) {
    if (!readSplunk) return { status: 503, error: 'splunk_unavailable' }
    try {
      const reply = await readSplunk(call.function.name, args)
      if (reply.status === 202) return { status: 202, error: 'events_pending' }
      const result = reply.body.result as EventQueryResult | undefined
      if (reply.status !== 200 || !result || !Array.isArray(result.events) || !result.available) return { status: 503, error: 'splunk_unavailable' }
      return { status: 200, execution: eventExecution(await eventContext(db, snapshotId, result, hide), call, index, result) }
    } catch { return { status: 503, error: 'splunk_unavailable' } }
  }

  const s: Scope = { db, snapshotId, hide }
  switch (call.function.name) {
    case 'search_objects': return { status: 200, execution: await searchObjects(s, args, index) }
    case 'neighbors': return { status: 200, execution: await neighbors(s, args, index) }
    case 'kg_schema': return { status: 200, execution: await kgSchema(s, args, index, req.visibleFindings ?? 0) }
    case 'identity_links': return { status: 200, execution: await identityLinks(s, call, index) }
    case 'relations': return { status: 200, execution: await relations(s, args, index) }
    case 'accounts': return { status: 200, execution: await accounts(s, call, index) }
    case 'credential_blast': return { status: 200, execution: await credentialBlast(s, call, index, args) }
  }
  return { status: 400, error: 'unsupported_tool' }
}

interface Scope { db: D1Like; snapshotId: string; hide: boolean }

const page = (args: ToolArgs, defaultLimit = 20) => ({ offset: Number(args.offset ?? 0), limit: Number(args.limit ?? defaultLimit) })

/** src/semantic-graph/investigationQuery.ts searchObjects 와 같은 칸을 본다 (대소문자는 ASCII 만 접는다) */
const SEARCH_FIELDS = ['o.id', "json_extract(o.detail, '$.fixture_meta.display_name')", 'o.provider', "json_extract(o.detail, '$.canonical.object_type')",
  "json_extract(o.detail, '$.canonical.properties.name')", "json_extract(o.detail, '$.canonical.properties.email')", "json_extract(o.detail, '$.canonical.properties.login')"]

export interface ObjectSearch { text?: string; provider?: string; iface?: string; type?: string; property?: string; value?: string; offset: number; limit: number; hideDefaults?: boolean }

/**
 * 객체 검색. 정확한 객체 키면 그 하나, 아니면 이름, 이메일, 로그인, 유형 등에 글자가 들어간 객체를 원래 순서로.
 * property 는 그 속성이 value(기본 true)인 객체만 (브라우저 propertyMatch 와 같다). 속성이 없는 객체는 missing 에 센다.
 * 숨긴 기본 객체 중 조건에 맞는 것은 hidden 에 센다
 */
export async function searchObjectKeys(db: D1Like, snapshotId: string, q: ObjectSearch): Promise<{ total: number; keys: string[]; only?: string; missing: number; hidden: { total: number; keys: string[] } }> {
  const hide = q.hideDefaults ?? true
  const text = q.text ?? ''
  const needle = text.trim().toLocaleLowerCase()
  const where = ['o.snapshot_id = ?1']
  const params: unknown[] = [snapshotId]
  const exact = !!text && await objectExists(db, snapshotId, text, hide)
  if (exact) { params.push(text); where.push(`o.id = ?${params.length}`) }
  else if (needle) { params.push(needle); where.push(`(${SEARCH_FIELDS.map(f => `instr(lower(${f}), ?${params.length}) > 0`).join(' OR ')})`) }
  if (q.provider) { params.push(q.provider); where.push(`o.provider = ?${params.length}`) }
  if (q.iface) { params.push(`,${q.iface},`); where.push(`instr(',' || o.interfaces || ',', ?${params.length}) > 0`) }
  if (q.type) { params.push(q.type); where.push(`json_extract(o.detail, '$.canonical.object_type') = ?${params.length}`) }
  // 속성이 없는 객체 수는 값 인자 없이 센다. 쓰지 않는 바인딩이 있으면 SQLite 가 거절한다
  let missing: { clause: string; params: unknown[] } | null = null
  if (q.property) {
    params.push(`$.canonical.properties.${q.property}`)
    const t = `json_type(o.detail, ?${params.length})`, x = `json_extract(o.detail, ?${params.length})`
    const want = (q.value ?? 'true').toLowerCase()
    missing = { clause: [...where, `(${t} IS NULL OR ${t} = 'null')`, visibleObject('o', hide)].join(' AND '), params: [...params] }
    if (want === 'true') where.push(`(${t} = 'true' OR (${t} = 'text' AND ${x} = 'true') OR (${t} IN ('integer', 'real') AND ${x} = 1))`)
    else if (want === 'false') where.push(`(${t} = 'false' OR (${t} = 'text' AND ${x} = 'false') OR (${t} IN ('integer', 'real') AND ${x} = 0))`)
    else { params.push(want); where.push(`(${t} = 'text' AND lower(${x}) = ?${params.length})`) }
  }
  const clause = [...where, visibleObject('o', hide)].join(' AND ')
  const count = async (condition: string, values: unknown[]) => (await db.prepare(`SELECT COUNT(*) AS n FROM snap_objects o WHERE ${condition}`).bind(...values).first<{ n: number }>())?.n ?? 0
  const idsOf = async (condition: string, tail: string) => (await db.prepare(`SELECT o.id FROM snap_objects o WHERE ${condition} ORDER BY o.ord ${tail}`).bind(...params).all<{ id: string }>()).results.map(r => r.id)
  // 정확한 키로 찾았으면 숨긴 객체와 겹칠 수 없다
  const hiddenClause = hide && !exact ? [...where, hiddenObject('o')].join(' AND ') : null
  // 수, 페이지, 숨긴 객체, 속성 없는 객체는 서로 기다리지 않는다
  const [total, keys, hiddenTotal, hiddenKeys, unknown] = await Promise.all([
    count(clause, params),
    idsOf(clause, `LIMIT ${Math.max(0, Math.trunc(q.limit))} OFFSET ${Math.max(0, Math.trunc(q.offset))}`),
    hiddenClause ? count(hiddenClause, params) : 0,
    hiddenClause ? idsOf(hiddenClause, `LIMIT ${HIDDEN_NOTE_NAMES}`) : [],
    missing ? count(missing.clause, missing.params) : 0,
  ])
  const only = total === 1 ? (keys[0] ?? (await idsOf(clause, 'LIMIT 1'))[0]) : undefined
  return { total, keys, only, missing: unknown, hidden: { total: hiddenTotal, keys: hiddenKeys } }
}

async function searchObjects({ db, snapshotId, hide }: Scope, args: ToolArgs, index: number): Promise<KgExecution> {
  const { offset, limit } = page(args)
  const property = args.property ? String(args.property) : undefined, value = String(args.value ?? 'true')
  const type = args.type ? String(args.type) : undefined
  const { total, keys, only, missing, hidden } = await searchObjectKeys(db, snapshotId, { text: String(args.text ?? ''), provider: args.provider ? String(args.provider) : undefined, iface: args.interface ? String(args.interface) : undefined, type, property, value, offset, limit, hideDefaults: hide })
  const [sub, hiddenObjects] = await Promise.all([
    loadSubgraph(db, snapshotId, { objectKeys: only ? [...keys, only] : keys }, hide),
    rowsById(db, snapshotId, 'snap_objects', hidden.keys).then(rows => rows.map(r => JSON.parse(r.detail) as FixtureObject)),
  ])
  const builder = new EvidenceBuilder(sub.graph, sub.evidence)
  keys.forEach(key => builder.object(key))
  const truncated = offset + limit < total
  const result = builder.result(`검색 ${total}개, 표시 ${Math.min(limit, Math.max(0, total - offset))}개, offset ${offset}.${truncated ? ' 다음 페이지가 있습니다.' : ''}${typeNote(type, total)}${propertyNote(property, value, missing)}${hiddenSearchNote(hiddenObjects, hidden.total)}`, only ? { sourceKey: only } : undefined)
  return finishKgExecution({ graph: sub.graph, evidence: sub.evidence, findings: [] }, 'search_objects', args, index, result, undefined, truncated)
}

async function neighbors({ db, snapshotId, hide }: Scope, args: ToolArgs, index: number): Promise<KgExecution> {
  const key = String(args.key)
  if (!(await objectExists(db, snapshotId, key, hide))) return finishKgExecution(emptyKgContext(), 'neighbors', args, index, emptyKgResult(NO_OBJECT), undefined, false)
  const { offset, limit } = page(args)
  const ROLE = "json_extract(r.detail, '$.canonical.references.role.value')"
  const edges = async (column: string) =>
    (await db.prepare(`SELECT r.id, r.type, ${ROLE} AS role FROM snap_relations r WHERE r.snapshot_id = ? AND ${column} = ? AND ${visibleRelation('r', hide)} ORDER BY r.ord`).bind(snapshotId, key).all<{ id: string; type: string; role: unknown }>()).results
  // 브라우저와 같은 순서: 나가는 관계, 들어오는 관계, 이 객체를 역할로 쓰는 관계(중복 제외), 그다음 계정 연결
  // 나가는 관계, 들어오는 관계, 역할로 쓰는 관계, 계정 연결은 서로 기다리지 않는다
  const [outgoing, incoming, asRoleEdges, linkIds] = await Promise.all([
    args.direction === 'in' ? [] : edges('r.from_key'),
    args.direction === 'out' ? [] : edges('r.to_key'),
    args.direction === 'out' ? [] : edges(ROLE),
    args.relationType ? [] : linkIdsOf(db, snapshotId, key),
  ])
  const relations = [...new Map([...outgoing, ...incoming, ...asRoleEdges].map(r => [r.id, r])).values()]
    .filter(r => !args.relationType || r.type === args.relationType)
  const asRole = relations.filter(r => r.role === key).length
  const linkGraph = (await loadSubgraph(db, snapshotId, { objectKeys: [key], linkIds }, hide)).graph
  const identities = [...linkGraph.linksById.values()].flatMap(l => identityEvidenceEdges(linkGraph, l, 'all')).filter(e => e.from === key || e.to === key)
  const packets: Array<{ relation: string } | { identity: IdentityEvidenceEdge }> = [...relations.map(r => ({ relation: r.id })), ...identities.map(identity => ({ identity }))]
  const shown = packets.slice(offset, offset + limit)
  const sub = await loadSubgraph(db, snapshotId, { objectKeys: [key], relationKeys: shown.flatMap(p => 'relation' in p ? [p.relation] : []), linkIds }, hide)
  const builder = new EvidenceBuilder(sub.graph, sub.evidence)
  builder.object(key)
  shown.forEach(p => 'relation' in p ? builder.relation(p.relation) : builder.identity(p.identity))
  const truncated = offset + limit < packets.length
  const result = builder.result(`관계와 연결 ${packets.length}개${asRole ? `(이 객체를 역할로 쓰는 관계 ${asRole}개 포함)` : ''}, offset ${offset}, 최대 ${limit}개 표시.${truncated ? ' 다음 페이지가 있습니다.' : ''}`, { sourceKey: key })
  return finishKgExecution({ graph: sub.graph, evidence: sub.evidence, findings: [] }, 'neighbors', args, index, result, undefined, truncated)
}

async function kgSchema({ db, snapshotId, hide }: Scope, args: ToolArgs, index: number, visibleFindings: number): Promise<KgExecution> {
  const one = async (sql: string) => (await db.prepare(sql).bind(snapshotId).first<{ n: number }>())?.n ?? 0
  const ordered = async (sql: string) => (await db.prepare(sql).bind(snapshotId).all<{ v: string }>()).results.map(r => r.v)
  const counted = async (sql: string) => Object.fromEntries((await db.prepare(sql).bind(snapshotId).all<{ v: string; n: number }>()).results.map(r => [r.v, r.n]))
  const visibleMembers = `(SELECT COUNT(*) FROM json_each(l.detail, '$.set') m WHERE ${hide
    ? `NOT EXISTS (SELECT 1 FROM snap_objects h WHERE h.snapshot_id = l.snapshot_id AND h.id = json_extract(m.value, '$.object_key') AND ${hiddenObject('h')})`
    : '1'})`
  // 서로 기다릴 필요 없는 집계라 함께 보낸다. 결과 칸과 순서는 차례로 읽을 때와 같다
  const [providers, objects, relations, identityLinks, objectsBySaas, typeRows, interfaces, relationTypes, crossProviderRelations, principalRows, links] = await Promise.all([
    ordered(`SELECT o.provider AS v FROM snap_objects o WHERE o.snapshot_id = ? AND ${visibleObject('o', hide)} GROUP BY o.provider ORDER BY MIN(o.ord)`),
    one(`SELECT COUNT(*) AS n FROM snap_objects o WHERE o.snapshot_id = ? AND ${visibleObject('o', hide)}`),
    one(`SELECT COUNT(*) AS n FROM snap_relations r WHERE r.snapshot_id = ? AND ${visibleRelation('r', hide)}`),
    one(`SELECT COUNT(*) AS n FROM snap_links l WHERE l.snapshot_id = ? AND ${hide ? `${visibleMembers} > 1` : '1'}`),
    // 브라우저 objectsBySaas 와 같은 순서: 수 내림차순, 이름순
    counted(`SELECT o.provider AS v, COUNT(*) AS n FROM snap_objects o WHERE o.snapshot_id = ? AND ${visibleObject('o', hide)} GROUP BY o.provider ORDER BY n DESC, v`),
    db.prepare(`SELECT o.provider AS provider, json_extract(o.detail, '$.canonical.object_type') AS type, COUNT(*) AS n FROM snap_objects o
      WHERE o.snapshot_id = ? AND ${visibleObject('o', hide)} GROUP BY o.provider, type`).bind(snapshotId).all<{ provider: string; type: string; n: number }>(),
    ordered(`SELECT i.value AS v FROM snap_objects o, json_each(o.detail, '$.canonical.interfaces') i WHERE o.snapshot_id = ? AND ${visibleObject('o', hide)} GROUP BY i.value ORDER BY MIN(o.ord * 1000 + i.key)`),
    counted(`SELECT r.type AS v, COUNT(*) AS n FROM snap_relations r WHERE r.snapshot_id = ? AND ${visibleRelation('r', hide)} GROUP BY r.type ORDER BY MIN(r.ord)`),
    // 브라우저 crossProviderRelations 와 같은 순서: 수 내림차순, 이름순
    counted(`SELECT a.provider || '>' || b.provider AS v, COUNT(*) AS n FROM snap_relations r
      JOIN snap_objects a ON a.snapshot_id = r.snapshot_id AND a.id = r.from_key JOIN snap_objects b ON b.snapshot_id = r.snapshot_id AND b.id = r.to_key
      WHERE r.snapshot_id = ? AND a.provider <> b.provider AND ${visibleRelation('r', hide)} GROUP BY v ORDER BY n DESC, v`),
    // 계정 판정은 코드(principalKind)라 Principal 객체를 읽어 브라우저와 같은 함수로 센다
    db.prepare(`SELECT o.detail FROM snap_objects o WHERE o.snapshot_id = ? AND ${visibleObject('o', hide)}
      AND EXISTS (SELECT 1 FROM json_each(o.detail, '$.canonical.interfaces') i WHERE i.value = 'Principal') ORDER BY o.ord`).bind(snapshotId).all<{ detail: string }>(),
    linkGraph(db, snapshotId, hide),
  ])
  const data = {
    objects, relations, identityLinks, providers, objectsBySaas,
    objectsByType: objectTypeCounts(typeRows.results),
    interfaces, relationTypes, crossProviderRelations,
    principalsBySaas: principalCounts(principalRows.results.map(r => JSON.parse(r.detail) as FixtureObject)),
    // 연결과 구성원만 읽은 그래프로 브라우저와 같은 함수를 부른다. 연결 없는 SaaS 도 0건으로 넣는다
    identityLinksBySaas: identityLinksBySaas(links, providers),
    visibleFindings,
  }
  return finishKgExecution(emptyKgContext(), 'kg_schema', args, index, emptyKgResult('현재 데이터의 그래프 구조입니다.'),
    [{ kind: 'schema', ref: 'current-kg', label: '현재 KG 구조', data }], false)
}

/** 모든 동일인 연결과 그 구성원만 읽은 그래프 */
const linkGraph = async (db: D1Like, snapshotId: string, hide: boolean) =>
  (await loadSubgraph(db, snapshotId, { linkIds: (await db.prepare('SELECT id FROM snap_links WHERE snapshot_id = ? ORDER BY ord').bind(snapshotId).all<{ id: string }>()).results.map(r => r.id) }, hide)).graph

async function identityLinks({ db, snapshotId, hide }: Scope, call: KgCall, index: number): Promise<KgExecution> {
  return executeKgTool({ ...emptyKgContext(), graph: await linkGraph(db, snapshotId, hide) }, call, index)
}

/**
 * 구조 관계 목록 (브라우저 relationList 와 같은 조건, 같은 순서). 고르고 세는 일은 SQL 로 하고,
 * 역할 관계의 권한 수준은 코드(roleRelationCapability)라 맞는 역할 관계만 읽어 브라우저와 같은 함수로 정한다
 */
async function relations({ db, snapshotId, hide }: Scope, args: ToolArgs, index: number): Promise<KgExecution> {
  const { offset, limit } = page(args)
  const FROM = 'snap_relations r LEFT JOIN snap_objects a ON a.snapshot_id = r.snapshot_id AND a.id = r.from_key LEFT JOIN snap_objects b ON b.snapshot_id = r.snapshot_id AND b.id = r.to_key'
  const PAIR = "ifnull(a.provider, '미확인') || '>' || ifnull(b.provider, '미확인')"
  const where = ['r.snapshot_id = ?1', visibleRelation('r', hide)]
  const params: unknown[] = [snapshotId]
  if (args.relationType) { params.push(String(args.relationType)); where.push(`r.type = ?${params.length}`) }
  if (args.fromProvider) { params.push(String(args.fromProvider)); where.push(`a.provider = ?${params.length}`) }
  if (args.toProvider) { params.push(String(args.toProvider)); where.push(`b.provider = ?${params.length}`) }
  const clause = where.join(' AND ')
  const ids = async (extra = '', tail = '') => (await db.prepare(`SELECT r.id FROM ${FROM} WHERE ${clause}${extra} ORDER BY r.ord${tail}`).bind(...params).all<{ id: string }>()).results.map(r => r.id)
  const counted = async (expr: string) => (await db.prepare(`SELECT ${expr} AS v, COUNT(*) AS n FROM ${FROM} WHERE ${clause} GROUP BY v ORDER BY n DESC, v`).bind(...params).all<{ v: string; n: number }>()).results.map(r => [r.v, r.n] as [string, number])
  // 역할 관계의 권한 수준은 역할 그래프를 읽어야 정해진다. 수준 조건이 없으면 목록과 집계 질의를 그와 함께 보낸다
  const roleLevels = ids(" AND r.type = 'has_role_on'").then(async roleIds => {
    const roleGraph = (await loadSubgraph(db, snapshotId, { relationKeys: roleIds }, hide)).graph
    const levels = new Map(roleIds.flatMap(id => { const r = roleGraph.relationsByKey.get(id); return r ? [[id, roleLevelCode(roleGraph, r)] as const] : [] }))
    return { roleIds, roleGraph, levels }
  })
  let total: number, keys: string[], byType: Array<[string, number]>, byPair: Array<[string, number]>, byLevel: Array<[string, number]>
  if (args.level) {
    const { roleIds, roleGraph, levels } = await roleLevels
    const matched = roleIds.filter(id => levels.get(id) === args.level)
    const provider = (key: string) => roleGraph.objectsByKey.get(key)?.canonical.provider ?? '미확인'
    total = matched.length
    keys = matched.slice(offset, offset + limit)
    byType = countEntries(matched.map(() => 'has_role_on'))
    byPair = countEntries(matched.map(id => { const r = roleGraph.relationsByKey.get(id)!; return `${provider(r.sourceKey)}>${provider(r.targetKey)}` }))
    byLevel = countEntries(matched.map(id => LEVEL_TEXT[levels.get(id)!]))
  } else {
    const [{ levels }, count, pageKeys, types, pairs] = await Promise.all([
      roleLevels,
      db.prepare(`SELECT COUNT(*) AS n FROM ${FROM} WHERE ${clause}`).bind(...params).first<{ n: number }>(),
      ids('', ` LIMIT ${Math.max(0, Math.trunc(limit))} OFFSET ${Math.max(0, Math.trunc(offset))}`),
      counted('r.type'),
      counted(PAIR),
    ])
    total = count?.n ?? 0
    keys = pageKeys
    byType = types
    byPair = pairs
    byLevel = countEntries([...levels.values()].map(code => LEVEL_TEXT[code]))
  }
  const sub = await loadSubgraph(db, snapshotId, { relationKeys: keys }, hide)
  const builder = new EvidenceBuilder(sub.graph, sub.evidence)
  keys.forEach(key => builder.relation(key))
  const result = builder.result(relationListSummary(total, offset, limit, byType, byPair, byLevel))
  return finishKgExecution({ graph: sub.graph, evidence: sub.evidence, findings: [] }, 'relations', args, index, result, undefined, offset + limit < total)
}

/** 계정 목록. Principal 객체만 읽은 그래프로 브라우저와 같은 함수(accountList)를 부른다. 그룹은 함수가 뺀다 */
async function accounts({ db, snapshotId, hide }: Scope, call: KgCall, index: number): Promise<KgExecution> {
  const keys = (await db.prepare(`SELECT o.id FROM snap_objects o WHERE o.snapshot_id = ? AND ${visibleObject('o', hide)}
    AND EXISTS (SELECT 1 FROM json_each(o.detail, '$.canonical.interfaces') i WHERE i.value = 'Principal') ORDER BY o.ord`).bind(snapshotId).all<{ id: string }>()).results.map(r => r.id)
  return executeKgTool({ ...emptyKgContext(), graph: (await loadSubgraph(db, snapshotId, { objectKeys: keys }, hide)).graph }, call, index)
}

async function credentialBlast({ db, snapshotId, hide }: Scope, call: KgCall, index: number, args: ToolArgs): Promise<KgExecution> {
  // 자격증명 종류(type)로 거르려고 객체 종류를 같이 읽는다
  const rows = (await db.prepare(`SELECT b.id, b.detail, json_extract(o.detail, '$.canonical.object_type') AS type FROM snap_blast_radius b
    LEFT JOIN snap_objects o ON o.snapshot_id = b.snapshot_id AND o.id = b.id WHERE b.snapshot_id = ? ORDER BY b.ord`).bind(snapshotId).all<{ id: string; detail: string; type: string | null }>()).results
  const blastRadii: PrecomputedBlast = new Map(rows.map(r => {
    const b = JSON.parse(r.detail) as { provider: string; token: BlastRadius; account: BlastRadius }
    return [r.id, { provider: b.provider, ...(r.type ? { type: r.type } : {}), token: b.token, account: b.account }]
  }))
  const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 10)
  const ranked = rankCredentials({ ...emptyKgContext(), blastRadii }, args)
  const shown = ranked.slice(offset, offset + limit)
  // 조회 전체 집계(종류별, 소유 계정별)는 자격증명과 소유 계정 객체가 있어야 해서 페이지 밖 것도 읽는다
  const objectKeys = new Set<string>([String(args.key ?? ''), String(args.targetKey ?? ''), ...ranked.flatMap(row => [row.key, ...row.radii.flatMap(r => r.ownerKey ? [r.ownerKey] : [])])])
  const relationKeys = new Set<string>()
  const linkIds = new Set<string>()
  for (const row of shown) {
    objectKeys.add(row.key)
    for (const r of row.radii) {
      if (r.ownerKey) objectKeys.add(r.ownerKey)
      for (const n of r.nodes) objectKeys.add(n.key)
      for (const hop of r.hops) {
        objectKeys.add(hop.from); objectKeys.add(hop.to)
        if (hop.throughKey) objectKeys.add(hop.throughKey)
        hop.relationKeys.forEach(k => relationKeys.add(k))
        if (hop.linkId) linkIds.add(hop.linkId)
      }
    }
  }
  const sub = await loadSubgraph(db, snapshotId, { objectKeys, relationKeys, linkIds }, hide)
  return executeKgTool({ graph: sub.graph, evidence: sub.evidence, findings: [], blastRadii }, call, index)
}
