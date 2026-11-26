/**
 * 컴플라이언스 예외 API — 실측 데이터셋의 컴플라이언스 예외를 팀이 함께 쓰는 D1 에 둔다 (src/model/complianceException.ts).
 * server/measured.ts 가 `/api/measured/compliance-exceptions` 를 이리로 넘긴다. 실측 번들과 같은 팀 비밀번호 세션이 있어야 한다.
 *
 *   GET  /api/measured/compliance-exceptions?dataset=measured|measured-v2   → { items, serverTime }
 *   POST /api/measured/compliance-exceptions   { dataset, change: ComplianceExceptionChange }   → { item }
 *
 * 처리 상태 API(server/handling.ts)와 같은 규칙이다: 합성은 받지 않고, 시각은 서버가 찍고,
 * 화면이 본 updatedAt 이 지금 값과 다르면 409 로 거절하며, 행과 이력은 batch 로 함께 쓴다.
 */
import {
  applyComplianceExceptionChange,
  complianceExceptionChangeProblem,
  complianceExceptionKey,
  type ComplianceException,
  type ComplianceExceptionChange,
} from '../src/model/complianceException'
import { SERVER_DATASETS, type D1Like } from './exceptions'

type ServerDataset = (typeof SERVER_DATASETS)[number]
type Json = (status: number, body: Record<string, unknown>) => Response

interface Row {
  dataset: ServerDataset
  id: string
  scope: ComplianceException['scope']
  target: string
  label: string
  reason_category: ComplianceException['reasonCategory']
  reason: string
  reference: string | null
  expires_at: string
  fail_findings: string
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string
  revoked_at: string | null
  revoked_by: string | null
}

interface EventRow {
  id: string
  at: string
  actor: string
  action: 'register' | 'revoke'
  reason: string
  expires_at: string | null
}

function parseFindings(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function toRecord(row: Row, events: EventRow[]): ComplianceException {
  return {
    dataset: row.dataset,
    id: row.id,
    scope: row.scope,
    target: row.target,
    label: row.label,
    reasonCategory: row.reason_category,
    reason: row.reason,
    ...(row.reference ? { reference: row.reference } : {}),
    expiresAt: row.expires_at,
    failFindings: parseFindings(row.fail_findings),
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    ...(row.revoked_at ? { revokedAt: row.revoked_at, revokedBy: row.revoked_by ?? '' } : {}),
    history: events.map(e => ({
      at: e.at,
      actor: e.actor,
      action: e.action,
      reason: e.reason,
      ...(e.expires_at ? { expiresAt: e.expires_at } : {}),
    })),
  }
}

async function readAll(db: D1Like, dataset: ServerDataset): Promise<ComplianceException[]> {
  const [{ results: rows }, { results: events }] = await Promise.all([
    db.prepare('SELECT * FROM compliance_exceptions WHERE dataset = ? ORDER BY created_at, id').bind(dataset).all<Row>(),
    db.prepare('SELECT id, at, actor, action, reason, expires_at FROM compliance_exception_events WHERE dataset = ? ORDER BY seq').bind(dataset).all<EventRow>(),
  ])
  const byId = new Map<string, EventRow[]>()
  for (const e of events) byId.set(e.id, [...(byId.get(e.id) ?? []), e])
  return rows.map(row => toRecord(row, byId.get(row.id) ?? []))
}

async function readOne(db: D1Like, dataset: ServerDataset, id: string): Promise<ComplianceException | null> {
  const row = await db.prepare('SELECT * FROM compliance_exceptions WHERE dataset = ? AND id = ?').bind(dataset, id).first<Row>()
  if (!row) return null
  const { results } = await db
    .prepare('SELECT id, at, actor, action, reason, expires_at FROM compliance_exception_events WHERE dataset = ? AND id = ? ORDER BY seq')
    .bind(dataset, id)
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

export async function handleComplianceExceptions(request: Request, route: string, db: D1Like, json: Json, nowMs: number): Promise<Response> {
  if (route !== 'compliance-exceptions') return json(404, { error: 'not_found' })
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
  const problem = complianceExceptionChangeProblem(body.change, new Date(nowMs))
  if (problem) return json(400, { error: 'rejected', message: problem })
  const change = body.change as ComplianceExceptionChange
  const id = complianceExceptionKey(change.scope, change.target)

  const previous = await readOne(db, dataset, id)
  if ((previous?.updatedAt ?? undefined) !== (change.expectedUpdatedAt ?? undefined)) {
    return json(409, { error: 'conflict', item: previous })
  }
  if (change.revoke && !previous) return json(400, { error: 'rejected', message: '없는 예외는 취소할 수 없음' })
  const next = applyComplianceExceptionChange(previous ?? undefined, change, dataset, stamp)
  const upsert = previous
    ? db
        .prepare(
          'UPDATE compliance_exceptions SET label = ?, reason_category = ?, reason = ?, reference = ?, expires_at = ?, fail_findings = ?, updated_at = ?, updated_by = ?, revoked_at = ?, revoked_by = ? WHERE dataset = ? AND id = ? AND updated_at = ?'
        )
        .bind(
          next.label,
          next.reasonCategory,
          next.reason,
          next.reference ?? null,
          next.expiresAt,
          JSON.stringify(next.failFindings),
          stamp,
          next.updatedBy,
          next.revokedAt ?? null,
          next.revokedBy ?? null,
          dataset,
          id,
          previous.updatedAt,
        )
    : db
        .prepare(
          `INSERT INTO compliance_exceptions (dataset, id, scope, target, label, reason_category, reason, reference, expires_at, fail_findings, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          dataset,
          id,
          next.scope,
          next.target,
          next.label,
          next.reasonCategory,
          next.reason,
          next.reference ?? null,
          next.expiresAt,
          JSON.stringify(next.failFindings),
          stamp,
          next.createdBy,
          stamp,
          next.updatedBy,
        )
  const event = db
    .prepare('INSERT INTO compliance_exception_events (dataset, id, at, actor, action, reason, expires_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0')
    .bind(dataset, id, stamp, next.updatedBy, change.revoke ? 'revoke' : 'register', change.reason.trim(), change.revoke ? null : next.expiresAt)
  const [result] = await db.batch([upsert, event])
  if ((result?.meta?.changes ?? 0) === 0) return json(409, { error: 'conflict', item: await readOne(db, dataset, id) })
  return json(200, { item: await readOne(db, dataset, id) })
}
