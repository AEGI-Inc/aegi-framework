/**
 * 위협 처리 상태 API — 실측 데이터셋의 처리 상태를 팀이 함께 쓰는 D1 에 둔다 (src/model/handling.ts).
 * server/measured.ts 가 `/api/measured/handling` 을 이리로 넘긴다. 실측 번들과 같은 팀 비밀번호 세션이 있어야 한다.
 *
 *   GET  /api/measured/handling?dataset=measured|measured-v2   → { items, serverTime }
 *   POST /api/measured/handling   { dataset, change: HandlingChange }   → { item }
 *
 * - 합성 데이터셋은 받지 않는다(400). 합성은 브라우저에만 저장한다.
 * - 시각은 서버가 찍는다. 처리자 이름은 로그인이 없어 사람이 적은 그대로다.
 * - 두 사람이 같은 위협을 동시에 바꾸면: 요청이 본 updatedAt 이 지금 값과 다르면 409 로 거절한다.
 * - 행과 이력은 D1 batch 로 묶어 한꺼번에 반영된다.
 */
import { applyHandlingChange, handlingChangeProblem, type HandlingChange, type HandlingEvent, type ThreatHandling } from '../src/model/handling'
import { SERVER_DATASETS, type D1Like } from './exceptions'

type ServerDataset = (typeof SERVER_DATASETS)[number]
type Json = (status: number, body: Record<string, unknown>) => Response

interface Row {
  dataset: ServerDataset
  fingerprint: string
  finding_id: string
  title: string
  state: ThreatHandling['state']
  owner: string | null
  note: string | null
  verified_by: string | null
  verified_at: string | null
  updated_at: string
  updated_by: string | null
}

interface EventRow {
  fingerprint: string
  at: string
  state: HandlingEvent['state']
  actor: string | null
  owner: string | null
  note: string | null
}

function toHandling(row: Row, events: EventRow[]): ThreatHandling {
  const item: ThreatHandling = {
    dataset: row.dataset,
    fingerprint: row.fingerprint,
    findingId: row.finding_id,
    title: row.title,
    state: row.state,
    updatedAt: row.updated_at,
    history: events.map(e => ({
      at: e.at,
      state: e.state,
      ...(e.actor ? { actor: e.actor } : {}),
      ...(e.owner ? { owner: e.owner } : {}),
      ...(e.note ? { note: e.note } : {}),
    })),
  }
  if (row.owner) item.owner = row.owner
  if (row.note) item.note = row.note
  if (row.verified_by) item.verifiedBy = row.verified_by
  if (row.verified_at) item.verifiedAt = row.verified_at
  if (row.updated_by) item.updatedBy = row.updated_by
  return item
}

async function readAll(db: D1Like, dataset: ServerDataset): Promise<ThreatHandling[]> {
  const [{ results: rows }, { results: events }] = await Promise.all([
    db.prepare('SELECT * FROM threat_handling WHERE dataset = ? ORDER BY updated_at, fingerprint').bind(dataset).all<Row>(),
    db
      .prepare('SELECT fingerprint, at, state, actor, owner, note FROM threat_handling_events WHERE dataset = ? ORDER BY seq')
      .bind(dataset)
      .all<EventRow>(),
  ])
  const byFingerprint = new Map<string, EventRow[]>()
  for (const e of events) {
    const list = byFingerprint.get(e.fingerprint) ?? []
    list.push(e)
    byFingerprint.set(e.fingerprint, list)
  }
  return rows.map(row => toHandling(row, byFingerprint.get(row.fingerprint) ?? []))
}

async function readOne(db: D1Like, dataset: ServerDataset, fingerprint: string): Promise<ThreatHandling | null> {
  const row = await db.prepare('SELECT * FROM threat_handling WHERE dataset = ? AND fingerprint = ?').bind(dataset, fingerprint).first<Row>()
  if (!row) return null
  const { results } = await db
    .prepare('SELECT fingerprint, at, state, actor, owner, note FROM threat_handling_events WHERE dataset = ? AND fingerprint = ? ORDER BY seq')
    .bind(dataset, fingerprint)
    .all<EventRow>()
  return toHandling(row, results)
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('Content-Length') ?? 0)
  if (length > 100_000) return null
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const datasetOf = (value: unknown): ServerDataset | null =>
  SERVER_DATASETS.includes(value as ServerDataset) ? (value as ServerDataset) : null

/** `route` 는 `/api/measured/` 뒤의 경로 (`handling`) */
export async function handleHandling(request: Request, route: string, db: D1Like, json: Json, nowMs: number): Promise<Response> {
  if (route !== 'handling') return json(404, { error: 'not_found' })
  const stamp = new Date(nowMs).toISOString()
  if (request.method === 'GET') {
    const dataset = datasetOf(new URL(request.url).searchParams.get('dataset'))
    if (!dataset) return json(400, { error: 'bad_dataset' })
    return json(200, { items: await readAll(db, dataset), serverTime: stamp })
  }
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const body = await readBody(request)
  const dataset = datasetOf(body?.dataset)
  if (!body || !dataset) return json(400, { error: 'bad_request' })
  const problem = handlingChangeProblem(body.change)
  if (problem) return json(400, { error: 'rejected', message: problem })
  const change = body.change as HandlingChange

  const previous = await readOne(db, dataset, change.fingerprint)
  // 화면이 본 기록과 지금 기록이 다르면 그사이 다른 사람이 바꾼 것이다
  if ((previous?.updatedAt ?? undefined) !== (change.expectedUpdatedAt ?? undefined)) {
    return json(409, { error: 'conflict', item: previous })
  }
  const next = applyHandlingChange(previous ?? undefined, change, dataset, stamp)
  const last = next.history[next.history.length - 1]
  const upsert = previous
    ? db
        .prepare(
          `UPDATE threat_handling SET finding_id = ?, title = ?, state = ?, owner = ?, note = ?, verified_by = ?, verified_at = ?, updated_at = ?, updated_by = ?
           WHERE dataset = ? AND fingerprint = ? AND updated_at = ?`
        )
        .bind(next.findingId, next.title, next.state, next.owner ?? null, next.note ?? null, next.verifiedBy ?? null, next.verifiedAt ?? null, stamp, next.updatedBy ?? null, dataset, next.fingerprint, previous.updatedAt)
    : db
        .prepare(
          `INSERT INTO threat_handling (dataset, fingerprint, finding_id, title, state, owner, note, verified_by, verified_at, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(dataset, next.fingerprint, next.findingId, next.title, next.state, next.owner ?? null, next.note ?? null, next.verifiedBy ?? null, next.verifiedAt ?? null, stamp, next.updatedBy ?? null)
  // 이력은 바로 앞 문장이 행을 바꿨을 때만 남긴다 (그사이 바뀌었으면 둘 다 빠진다)
  const event = db
    .prepare('INSERT INTO threat_handling_events (dataset, fingerprint, at, state, actor, owner, note) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0')
    .bind(dataset, next.fingerprint, stamp, last.state, last.actor ?? null, last.owner ?? null, last.note ?? null)
  const [result] = await db.batch([upsert, event])
  if ((result?.meta?.changes ?? 0) === 0) return json(409, { error: 'conflict', item: await readOne(db, dataset, change.fingerprint) })
  return json(200, { item: await readOne(db, dataset, change.fingerprint) })
}
