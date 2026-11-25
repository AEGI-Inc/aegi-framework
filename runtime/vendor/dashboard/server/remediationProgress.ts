/**
 * 조치 진행 상태 API — 실측 데이터셋의 조치 진행을 팀이 함께 쓰는 D1 에 둔다 (src/model/remediationProgress.ts).
 * server/measured.ts 가 `/api/measured/remediation-progress` 를 이리로 넘긴다. 실측 번들과 같은 팀 비밀번호 세션이 있어야 한다.
 *
 *   GET  /api/measured/remediation-progress?dataset=measured|measured-v2   → { items, serverTime }
 *   POST /api/measured/remediation-progress   { dataset, change: RemediationProgressChange }   → { item }
 *
 * 처리 상태 API(server/handling.ts)와 같은 규칙이다: 합성은 받지 않고, 시각은 서버가 찍고,
 * 화면이 본 updatedAt 이 지금 값과 다르면 409 로 거절하며, 행과 이력은 batch 로 함께 쓴다.
 */
import {
  applyProgressChange,
  progressChangeProblem,
  type RemediationProgressChange,
  type RemediationProgressEvent,
  type RemediationProgressRecord,
} from '../src/model/remediationProgress'
import { SERVER_DATASETS, type D1Like } from './exceptions'

type ServerDataset = (typeof SERVER_DATASETS)[number]
type Json = (status: number, body: Record<string, unknown>) => Response

interface Row {
  dataset: ServerDataset
  fingerprint: string
  remediation_id: string
  finding_id: string
  title: string
  status: RemediationProgressRecord['status']
  owner: string | null
  due: string | null
  completed_steps: string
  verified_by: string | null
  verified_at: string | null
  updated_at: string
  updated_by: string | null
}

interface EventRow {
  fingerprint: string
  remediation_id: string
  at: string
  status: RemediationProgressEvent['status']
  actor: string | null
  owner: string | null
  due: string | null
}

const keyOf = (fingerprint: string, remediationId: string) => `${fingerprint}#${remediationId}`

function toRecord(row: Row, events: EventRow[]): RemediationProgressRecord {
  let steps: string[] = []
  try {
    const parsed = JSON.parse(row.completed_steps) as unknown
    if (Array.isArray(parsed)) steps = parsed.filter((s): s is string => typeof s === 'string')
  } catch {
    steps = []
  }
  const item: RemediationProgressRecord = {
    dataset: row.dataset,
    fingerprint: row.fingerprint,
    remediationId: row.remediation_id,
    findingId: row.finding_id,
    title: row.title,
    status: row.status,
    completedSteps: steps,
    updatedAt: row.updated_at,
    history: events.map(e => ({
      at: e.at,
      status: e.status,
      ...(e.actor ? { actor: e.actor } : {}),
      ...(e.owner ? { owner: e.owner } : {}),
      ...(e.due ? { due: e.due } : {}),
    })),
  }
  if (row.owner) item.owner = row.owner
  if (row.due) item.due = row.due
  if (row.verified_by) item.verifiedBy = row.verified_by
  if (row.verified_at) item.verifiedAt = row.verified_at
  if (row.updated_by) item.updatedBy = row.updated_by
  return item
}

async function readAll(db: D1Like, dataset: ServerDataset): Promise<RemediationProgressRecord[]> {
  const [{ results: rows }, { results: events }] = await Promise.all([
    db.prepare('SELECT * FROM remediation_progress WHERE dataset = ? ORDER BY updated_at, fingerprint, remediation_id').bind(dataset).all<Row>(),
    db
      .prepare('SELECT fingerprint, remediation_id, at, status, actor, owner, due FROM remediation_progress_events WHERE dataset = ? ORDER BY seq')
      .bind(dataset)
      .all<EventRow>(),
  ])
  const byKey = new Map<string, EventRow[]>()
  for (const e of events) {
    const key = keyOf(e.fingerprint, e.remediation_id)
    const list = byKey.get(key) ?? []
    list.push(e)
    byKey.set(key, list)
  }
  return rows.map(row => toRecord(row, byKey.get(keyOf(row.fingerprint, row.remediation_id)) ?? []))
}

async function readOne(db: D1Like, dataset: ServerDataset, fingerprint: string, remediationId: string): Promise<RemediationProgressRecord | null> {
  const row = await db
    .prepare('SELECT * FROM remediation_progress WHERE dataset = ? AND fingerprint = ? AND remediation_id = ?')
    .bind(dataset, fingerprint, remediationId)
    .first<Row>()
  if (!row) return null
  const { results } = await db
    .prepare('SELECT fingerprint, remediation_id, at, status, actor, owner, due FROM remediation_progress_events WHERE dataset = ? AND fingerprint = ? AND remediation_id = ? ORDER BY seq')
    .bind(dataset, fingerprint, remediationId)
    .all<EventRow>()
  return toRecord(row, results)
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

export async function handleRemediationProgress(request: Request, route: string, db: D1Like, json: Json, nowMs: number): Promise<Response> {
  if (route !== 'remediation-progress') return json(404, { error: 'not_found' })
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
  const problem = progressChangeProblem(body.change)
  if (problem) return json(400, { error: 'rejected', message: problem })
  const change = body.change as RemediationProgressChange

  const previous = await readOne(db, dataset, change.fingerprint, change.remediationId)
  if ((previous?.updatedAt ?? undefined) !== (change.expectedUpdatedAt ?? undefined)) {
    return json(409, { error: 'conflict', item: previous })
  }
  const next = applyProgressChange(previous ?? undefined, change, dataset, stamp)
  const last = next.history[next.history.length - 1]
  const steps = JSON.stringify(next.completedSteps)
  const upsert = previous
    ? db
        .prepare(
          `UPDATE remediation_progress SET finding_id = ?, title = ?, status = ?, owner = ?, due = ?, completed_steps = ?, verified_by = ?, verified_at = ?, updated_at = ?, updated_by = ?
           WHERE dataset = ? AND fingerprint = ? AND remediation_id = ? AND updated_at = ?`
        )
        .bind(next.findingId, next.title, next.status, next.owner ?? null, next.due ?? null, steps, next.verifiedBy ?? null, next.verifiedAt ?? null, stamp, next.updatedBy ?? null, dataset, next.fingerprint, next.remediationId, previous.updatedAt)
    : db
        .prepare(
          `INSERT INTO remediation_progress (dataset, fingerprint, remediation_id, finding_id, title, status, owner, due, completed_steps, verified_by, verified_at, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(dataset, next.fingerprint, next.remediationId, next.findingId, next.title, next.status, next.owner ?? null, next.due ?? null, steps, next.verifiedBy ?? null, next.verifiedAt ?? null, stamp, next.updatedBy ?? null)
  const event = db
    .prepare('INSERT INTO remediation_progress_events (dataset, fingerprint, remediation_id, at, status, actor, owner, due) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0')
    .bind(dataset, next.fingerprint, next.remediationId, stamp, last.status, last.actor ?? null, last.owner ?? null, last.due ?? null)
  const [result] = await db.batch([upsert, event])
  if ((result?.meta?.changes ?? 0) === 0) return json(409, { error: 'conflict', item: await readOne(db, dataset, change.fingerprint, change.remediationId) })
  return json(200, { item: await readOne(db, dataset, change.fingerprint, change.remediationId) })
}
