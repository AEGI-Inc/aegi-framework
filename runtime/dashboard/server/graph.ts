/**
 * D1 Graph Store API — 저장소 2(Cloudflare D1)의 보안 지식 그래프 데이터를 대시보드에 제공합니다.
 * 실측 데이터라 server/measured.ts 가 실측 로그인 세션을 확인한 뒤에만 부른다.
 *
 *   GET /api/measured/graph/bundle             → { objects, relations, findings, effectiveAccess } (화면 초기 로딩용)
 *   GET /api/measured/graph/objects            → { items: FixtureObject[] } (provider, iface 쿼리 필터 지원)
 *   GET /api/measured/graph/objects/:id/expand → { center: FixtureObject, neighbors: FixtureObject[], edges: FixtureRelation[] }
 *   GET /api/measured/graph/findings           → { items: FindingV2[] }
 *   GET /api/measured/graph/blast-radius       → { items: CredentialBlast[] } (자격증명 피해 범위)
 *   GET /api/measured/graph/aggregates         → { items: Array<{ id, kind, detail }> } (화면 집계)
 *   GET /api/measured/graph/summary            → { snapshotId, datasetName, datasetCreatedAt, loadedAt, counts, aggregates } (current 스냅샷 요약)
 *   GET /api/measured/graph/search             → { total, items } (q, provider, interface, offset, limit 최대 200. defaults=shown 이면 플랫폼 기본 객체 포함)
 *   GET /api/measured/graph/links?key=          → { items: IdentityLink[] } (그 객체가 들어간 계정 연결)
 *   GET /api/measured/graph/paths?from=&to=     → { found, hops, objectKeys, relationKeys } (최단 구조 경로, maxHops 기본 6 최대 12)
 *   POST /api/measured/graph/tools              → { execution } (AI 도구 서버 실행, server/graphTools.ts)
 */
import type { D1Like } from './exceptions'
import { currentSnapshotId, linkIdsOf, pinnedSnapshotIdOf, rowsById } from './snapshotGraph'
import { parseToolRequest, runServerTool, searchObjectKeys, type SplunkToolReader } from './graphTools'

type Json = (status: number, body: Record<string, unknown>) => Response

interface Row {
  id: string
  detail: string
}

type GraphView = 'objects' | 'relations' | 'findings' | 'effective_access'

/**
 * graph_* 뷰는 graph_head current 만 보여 고정 스냅샷(공개 데모 AEGI_GRAPH_SNAPSHOT_ID)을 따르지 않는다.
 * 고정이 있으면 그 스냅샷의 snap_* 표를 읽고, 없으면 지금처럼 뷰를 읽는다. 조건은 where 로 이어 붙인다
 */
async function graphSource(db: D1Like, view: GraphView): Promise<{ from: string; where: string[]; params: unknown[] }> {
  if (!pinnedSnapshotIdOf(db)) return { from: `graph_${view}`, where: [], params: [] }
  return { from: `snap_${view}`, where: ['snapshot_id = ?'], params: [await currentSnapshotId(db)] }
}

async function selectRows<T = Row>(db: D1Like, cols: string, view: GraphView, where: string[] = [], params: unknown[] = [], tail = '') {
  const src = await graphSource(db, view)
  const conds = [...src.where, ...where]
  const sql = `SELECT ${cols} FROM ${src.from}${conds.length ? ` WHERE ${conds.join(' AND ')}` : ''}${tail}`
  const all = [...src.params, ...params]
  return all.length ? db.prepare(sql).bind(...all) : db.prepare(sql)
}

export async function handleGraphRequest(
  request: Request,
  db: D1Like,
  subPath: string,
  json: Json,
  /** Event tools run only through the Splunk log cache; without a reader they answer splunk_unavailable. */
  options: { readSplunk?: SplunkToolReader } = {}
): Promise<Response> {
  const url = new URL(request.url)

  // 1. 전체 그래프 번들 조회 (초기 로딩 및 호환용)
  if (subPath === '' || subPath === 'bundle') {
    const [objs, rels, finds, ea] = await Promise.all([
      (await selectRows(db, 'detail', 'objects')).all<Row>(),
      (await selectRows(db, 'detail', 'relations')).all<Row>(),
      (await selectRows(db, 'detail', 'findings')).all<Row>(),
      (await selectRows(db, 'detail', 'effective_access')).all<Row>(),
    ])

    return json(200, {
      objects: objs.results.map(r => JSON.parse(r.detail)),
      relations: rels.results.map(r => JSON.parse(r.detail)),
      findings: finds.results.map(r => JSON.parse(r.detail)),
      effectiveAccess: ea.results.map(r => JSON.parse(r.detail)),
      serverTime: new Date().toISOString(),
    })
  }

  // 2. 객체 목록 조회 (필터링 지원)
  if (subPath === 'objects') {
    const provider = url.searchParams.get('provider')
    const stmt = await selectRows(db, 'detail', 'objects', provider ? ['provider = ?'] : [], provider ? [provider] : [], ' LIMIT 1000')
    const { results } = await stmt.all<Row>()
    return json(200, {
      items: results.map(r => JSON.parse(r.detail)),
      total: results.length,
    })
  }

  // 3. 특정 객체의 1-hop 이웃 탐색 (Explorer 심층 조사 캔버스용)
  const expandMatch = subPath.match(/^objects\/([^/]+)\/expand$/)
  if (expandMatch) {
    const centerId = decodeURIComponent(expandMatch[1])
    const centerRow = await (await selectRows(db, 'detail', 'objects', ['id = ?'], [centerId])).first<Row>()
    if (!centerRow) return json(404, { error: '객체를 찾을 수 없습니다' })

    const edgeRows = await (await selectRows(db, 'detail, from_key, to_key', 'relations', ['(from_key = ? OR to_key = ?)'], [centerId, centerId]))
      .all<Row & { from_key: string; to_key: string }>()

    const neighborIds = new Set<string>()
    for (const e of edgeRows.results) {
      if (e.from_key !== centerId) neighborIds.add(e.from_key)
      if (e.to_key !== centerId) neighborIds.add(e.to_key)
    }

    const neighborRows: Row[] = []
    if (neighborIds.size > 0) {
      // SQLite IN 절 파라미터 바인딩
      const idArray = Array.from(neighborIds)
      const placeholders = idArray.map(() => '?').join(',')
      const res = await (await selectRows(db, 'detail', 'objects', [`id IN (${placeholders})`], idArray)).all<Row>()
      neighborRows.push(...res.results)
    }

    return json(200, {
      center: JSON.parse(centerRow.detail),
      neighbors: neighborRows.map(r => JSON.parse(r.detail)),
      edges: edgeRows.results.map(r => JSON.parse(r.detail)),
    })
  }

  // 4. 위협 탐지 목록
  if (subPath === 'findings') {
    const { results } = await (await selectRows(db, 'detail', 'findings')).all<Row>()
    return json(200, {
      items: results.map(r => JSON.parse(r.detail)),
      total: results.length,
    })
  }

  // 7. 자격증명 피해 범위 (Credential Blast Radius)
  if (subPath === 'blast-radius') {
    try {
      const { results } = await db.prepare(
        "SELECT detail FROM snap_blast_radius WHERE snapshot_id = ? ORDER BY ord"
      ).bind(await currentSnapshotId(db)).all<Row>()
      return json(200, {
        items: results.map(r => JSON.parse(r.detail)),
        total: results.length,
      })
    } catch {
      return json(200, { items: [], total: 0 })
    }
  }

  // 8. 화면 집계 (Aggregates)
  if (subPath === 'aggregates') {
    try {
      const { results } = await db.prepare(
        "SELECT id, kind, detail FROM snap_aggregates WHERE snapshot_id = ? ORDER BY ord"
      ).bind(await currentSnapshotId(db)).all<{ id: string; kind: string; detail: string }>()
      return json(200, {
        items: results.map(r => ({ id: r.id, kind: r.kind, detail: JSON.parse(r.detail) })),
        total: results.length,
      })
    } catch {
      return json(200, { items: [], total: 0 })
    }
  }

  // 9. 요약 (current 스냅샷 정보와 화면 집계)
  if (subPath === 'summary') {
    const snapshotId = await currentSnapshotId(db)
    if (!snapshotId) return json(404, { error: 'not_published' })
    const snap = await db.prepare('SELECT id, dataset_created_at, dataset_name, counts, loaded_at, engine_version, knowledge_version FROM graph_snapshots WHERE id = ?').bind(snapshotId)
      .first<{ id: string; dataset_created_at: string | null; dataset_name: string | null; counts: string; loaded_at: string | null; engine_version: string | null; knowledge_version: string | null }>()
    const aggregates = (await db.prepare('SELECT id, kind, detail FROM snap_aggregates WHERE snapshot_id = ? ORDER BY ord').bind(snapshotId).all<{ id: string; kind: string; detail: string }>()).results
    return json(200, {
      snapshotId,
      datasetName: snap?.dataset_name ?? null,
      datasetCreatedAt: snap?.dataset_created_at ?? null,
      loadedAt: snap?.loaded_at ?? null,
      engineVersion: snap?.engine_version ?? null,
      knowledgeVersion: snap?.knowledge_version ?? null,
      counts: snap ? JSON.parse(snap.counts) : {},
      aggregates: Object.fromEntries(aggregates.map(a => [a.id, JSON.parse(a.detail)])),
    })
  }

  // 10. 객체 검색 (q, provider, interface, offset, limit)
  if (subPath === 'search') {
    const snapshotId = await currentSnapshotId(db)
    if (!snapshotId) return json(404, { error: 'not_published' })
    const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100_000)
    const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200)
    const found = await searchObjectKeys(db, snapshotId, { text: url.searchParams.get('q') ?? '', provider: url.searchParams.get('provider') ?? undefined, iface: url.searchParams.get('interface') ?? undefined, offset, limit, hideDefaults: url.searchParams.get('defaults') !== 'shown' })
    const rows = await rowsById(db, snapshotId, 'snap_objects', found.keys)
    return json(200, { total: found.total, offset, limit, items: rows.map(r => JSON.parse(r.detail)) })
  }

  // 11. 계정 연결 (key 가 들어간 연결)
  if (subPath === 'links') {
    const snapshotId = await currentSnapshotId(db)
    if (!snapshotId) return json(404, { error: 'not_published' })
    const key = url.searchParams.get('key')
    if (!key) return json(400, { error: 'key_required' })
    const rows = await rowsById(db, snapshotId, 'snap_links', await linkIdsOf(db, snapshotId, key))
    return json(200, { items: rows.map(r => JSON.parse(r.detail)), total: rows.length })
  }

  // 12. 최단 경로 (from, to, maxHops 기본 6 최대 12, directed=1 이면 관계 방향만)
  if (subPath === 'paths') {
    const snapshotId = await currentSnapshotId(db)
    if (!snapshotId) return json(404, { error: 'not_published' })
    const from = url.searchParams.get('from'), to = url.searchParams.get('to')
    if (!from || !to) return json(400, { error: 'from_to_required' })
    const result = await shortestPath(db, snapshotId, from, to, clampInt(url.searchParams.get('maxHops'), 6, 1, 12), url.searchParams.get('directed') === '1')
    return json(200, { ...result })
  }

  // 13. AI 도구 서버 실행 (POST, server/graphTools.ts)
  if (subPath === 'tools') {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    let body: unknown
    try { body = await request.json() } catch { return json(400, { error: 'bad_request' }) }
    const req = parseToolRequest(body)
    if (!req) return json(400, { error: 'bad_request' })
    const res = await runServerTool(db, req, options.readSplunk)
    return res.status === 200 ? json(200, { execution: res.execution }) : json(res.status, { error: res.error, ...(res.snapshotId ? { snapshotId: res.snapshotId } : {}) })
  }

  return json(404, { error: `알 수 없는 Graph API 엔드포인트: ${subPath}` })
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw === null ? fallback : Number(raw)
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** 탐색 객체 상한. 넘으면 찾지 못한 것으로 멈춘다 (explored 로 알린다) */
const PATH_VISIT_LIMIT = 5000

/**
 * 관계를 따라가는 최단 경로 (너비 우선). 홉마다 질의 하나로 다음 객체들을 읽는다.
 * 구조 경로일 뿐 권한이나 실행을 증명하지 않는다.
 */
export async function shortestPath(db: D1Like, snapshotId: string, from: string, to: string, maxHops: number, directed: boolean):
  Promise<{ found: boolean; hops: number; objectKeys: string[]; relationKeys: string[]; explored: number; limited: boolean }> {
  const prev = new Map<string, { node: string; rel: string } | null>([[from, null]])
  let frontier = [from]
  let reached = from === to
  let limited = false
  for (let hop = 1; hop <= maxHops && !reached && frontier.length && !limited; hop++) {
    const inFrontier = new Set(frontier)
    const next: string[] = []
    for (let i = 0; i < frontier.length && !reached && !limited; i += 45) {
      const chunk = frontier.slice(i, i + 45)
      const marks = chunk.map(() => '?').join(', ')
      const sql = `SELECT id, from_key, to_key FROM snap_relations WHERE snapshot_id = ? AND (from_key IN (${marks})${directed ? '' : ` OR to_key IN (${marks})`}) ORDER BY ord`
      const rows = (await db.prepare(sql).bind(snapshotId, ...chunk, ...(directed ? [] : chunk)).all<{ id: string; from_key: string; to_key: string }>()).results
      for (const r of rows) {
        const steps: Array<[string, string]> = []
        if (inFrontier.has(r.from_key)) steps.push([r.from_key, r.to_key])
        if (!directed && inFrontier.has(r.to_key)) steps.push([r.to_key, r.from_key])
        for (const [a, b] of steps) {
          if (prev.has(b)) continue
          prev.set(b, { node: a, rel: r.id })
          next.push(b)
          if (b === to) { reached = true; break }
          if (prev.size >= PATH_VISIT_LIMIT) { limited = true; break }
        }
        if (reached || limited) break
      }
    }
    frontier = next
  }
  if (!reached) return { found: false, hops: 0, objectKeys: [], relationKeys: [], explored: prev.size, limited }
  const objectKeys = [to], relationKeys: string[] = []
  for (let step = prev.get(to); step; step = prev.get(step.node)) { relationKeys.unshift(step.rel); objectKeys.unshift(step.node) }
  return { found: true, hops: relationKeys.length, objectKeys, relationKeys, explored: prev.size, limited }
}
