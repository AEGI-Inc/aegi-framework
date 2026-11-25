/**
 * 조사 보드 API — 실측 데이터셋의 조사 내용을 팀이 함께 쓰는 D1 에 둔다 (src/model/investigation.ts).
 * server/measured.ts 가 `/api/measured/investigations` 를 이리로 넘긴다. 실측 번들과 같은 팀 비밀번호 세션이 있어야 한다.
 *
 *   GET  /api/measured/investigations?dataset=measured|measured-v2   → { items, serverTime }
 *   POST /api/measured/investigations   { dataset, change: InvestigationChange }   → { item }
 *
 * - 합성 데이터셋은 받지 않는다(400). 합성은 브라우저에만 저장한다.
 * - 시각은 서버가 찍는다.
 * - 두 사람이 같은 조사를 동시에 바꾸면: 요청이 본 updatedAt 이 지금 값과 다르면 409 로 거절한다.
 * - 행과 이력은 D1 batch 로 묶어 반영된다.
 */
import {
  applyInvestigationChange,
  investigationChangeProblem,
  type InvestigationChange,
  type InvestigationEvent,
  type InvestigationRecord,
} from '../src/model/investigation'
import { SERVER_DATASETS, type D1Like } from './exceptions'

type ServerDataset = (typeof SERVER_DATASETS)[number]
type Json = (status: number, body: Record<string, unknown>) => Response

interface Row {
  dataset: ServerDataset
  id: string
  title: string
  state: InvestigationRecord['state']
  owner: string | null
  conclusion: string | null
  board: string
  created_at: string
  updated_at: string
  updated_by: string | null
}

interface EventRow {
  id: string
  at: string
  state: InvestigationEvent['state']
  actor: string | null
  owner: string | null
  note: string | null
}

function toInvestigation(row: Row, events: EventRow[]): InvestigationRecord {
  const item: InvestigationRecord = {
    dataset: row.dataset,
    id: row.id,
    title: row.title,
    state: row.state,
    board: row.board,
    createdAt: row.created_at,
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
  if (row.conclusion) item.conclusion = row.conclusion
  if (row.updated_by) item.updatedBy = row.updated_by
  return item
}

async function readAll(db: D1Like, dataset: ServerDataset): Promise<InvestigationRecord[]> {
  const [{ results: rows }, { results: events }] = await Promise.all([
    db.prepare('SELECT * FROM event_investigations WHERE dataset = ? ORDER BY updated_at DESC, id').bind(dataset).all<Row>(),
    db
      .prepare('SELECT id, at, state, actor, owner, note FROM event_investigation_events WHERE dataset = ? ORDER BY seq')
      .bind(dataset)
      .all<EventRow>(),
  ])
  const byId = new Map<string, EventRow[]>()
  for (const e of events) {
    const list = byId.get(e.id) ?? []
    list.push(e)
    byId.set(e.id, list)
  }
  return rows.map(row => toInvestigation(row, byId.get(row.id) ?? []))
}

async function readOne(db: D1Like, dataset: ServerDataset, id: string): Promise<InvestigationRecord | null> {
  const row = await db.prepare('SELECT * FROM event_investigations WHERE dataset = ? AND id = ?').bind(dataset, id).first<Row>()
  if (!row) return null
  const { results } = await db
    .prepare('SELECT id, at, state, actor, owner, note FROM event_investigation_events WHERE dataset = ? AND id = ? ORDER BY seq')
    .bind(dataset, id)
    .all<EventRow>()
  return toInvestigation(row, results)
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('Content-Length') ?? 0)
  if (length > MAX_BODY) return null
  try {
    const raw = await request.text()
    if (raw.length > MAX_BODY) return null
    const body = JSON.parse(raw) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// 보드는 200,000자까지다. 한글이면 UTF-8 로 세 배까지 커진다
const MAX_BODY = 1_000_000

const datasetOf = (value: unknown): ServerDataset | null =>
  SERVER_DATASETS.includes(value as ServerDataset) ? (value as ServerDataset) : null

/** `route` 는 `/api/measured/` 뒤의 경로 (`investigations`) */
export async function handleInvestigations(
  request: Request,
  route: string,
  db: D1Like,
  json: Json,
  nowMs: number,
): Promise<Response> {
  if (route !== 'investigations') return json(404, { error: 'not_found' })
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
  const problem = investigationChangeProblem(body.change)
  if (problem) return json(400, { error: 'rejected', message: problem })
  const change = body.change as InvestigationChange

  const previous = await readOne(db, dataset, change.id)
  // 화면이 본 기록과 지금 기록이 다르면 그사이 다른 사람이 바꾼 것이다
  if ((previous?.updatedAt ?? undefined) !== (change.expectedUpdatedAt ?? undefined)) {
    return json(409, { error: 'conflict', item: previous })
  }
  const next = applyInvestigationChange(previous ?? undefined, change, dataset, stamp)

  const upsert = previous
    ? db
        .prepare(
          `UPDATE event_investigations SET title = ?, state = ?, owner = ?, conclusion = ?, board = ?, updated_at = ?, updated_by = ?
           WHERE dataset = ? AND id = ? AND updated_at = ?`
        )
        .bind(
          next.title,
          next.state,
          next.owner ?? null,
          next.conclusion ?? null,
          next.board,
          stamp,
          next.updatedBy ?? null,
          dataset,
          next.id,
          previous.updatedAt,
        )
    : db
        .prepare(
          `INSERT INTO event_investigations (dataset, id, title, state, owner, conclusion, board, created_at, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          dataset,
          next.id,
          next.title,
          next.state,
          next.owner ?? null,
          next.conclusion ?? null,
          next.board,
          stamp,
          stamp,
          next.updatedBy ?? null,
        )

  const statements = [upsert]
  // 이력 규칙은 applyInvestigationChange 가 정한다(상태나 담당자가 바뀔 때만)
  if (next.history.length > (previous?.history.length ?? 0)) {
    const last = next.history[next.history.length - 1]
    const event = db
      .prepare('INSERT INTO event_investigation_events (dataset, id, at, state, actor, owner, note) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0')
      .bind(dataset, next.id, stamp, last.state, last.actor ?? null, last.owner ?? null, last.note ?? null)
    statements.push(event)
  }

  const [result] = await db.batch(statements)
  if ((result?.meta?.changes ?? 0) === 0) return json(409, { error: 'conflict', item: await readOne(db, dataset, change.id) })
  return json(200, { item: await readOne(db, dataset, change.id) })
}
