/**
 * 위협 예외 API — 실측 데이터셋의 예외를 팀이 함께 쓰는 D1 에 둔다 (docs/spec/AEGI_THREAT_EXCEPTION_PLAN_V1.md 5.2절).
 * server/measured.ts 가 `/api/measured/exceptions…` 를 이리로 넘긴다. 실측 번들과 같은 팀 비밀번호 세션이 있어야 한다.
 *
 *   GET  /api/measured/exceptions?dataset=measured|measured-v2   → { items, serverTime }
 *   POST /api/measured/exceptions            { dataset, mode: 'create' | 'import', items }   → { inserted, skipped, items }
 *   POST /api/measured/exceptions/:id/revoke  { dataset, actor, note? }                      → { item }
 *   POST /api/measured/exceptions/:id/extend  { dataset, actor, expiresAt, updatedAt }        → { item }
 *   POST /api/measured/exceptions/:id/edit    { dataset, actor, reasonCategory, reason, reference?, updatedAt } → { item }
 *   POST /api/measured/exceptions/:id/reapply { dataset, actor, item }                        → { item, old }
 *   POST /api/measured/exceptions/:id/undo    { dataset }   등록 직후 되돌리기 — 이력이 등록 하나뿐이고 10분 안일 때만 지운다
 *
 * - 합성 데이터셋은 받지 않는다(400). 공개 사이트라 누구나 쓸 수 있게 되기 때문이다 — 합성은 브라우저에만 저장한다.
 * - 이력 시각과 등록 시각은 서버가 찍는다. 처리자 이름은 로그인이 없어 사람이 적은 그대로다.
 * - 두 사람이 같은 예외를 동시에 고치면: 연장·수정은 본 적 있는 updatedAt 이 지금 값과 달라 409 로 거절하고,
 *   취소는 이미 취소됐으면 409 다. 거절된 쪽 화면은 최신 목록을 다시 받는다.
 * - 한 번에 여러 문장을 쓰는 동작(등록 + 이력, 다시 적용)은 D1 batch 로 묶어 한꺼번에 반영된다.
 */
import {
  MAX_ACTOR_LENGTH,
  MAX_REASON_LENGTH,
  MAX_REFERENCE_LENGTH,
  MIN_REASON_LENGTH,
  REASON_CATEGORIES,
  approverProblem,
  exceptionProblem,
  validateExpiry,
  type ExceptionHistoryEntry,
  type ExceptionReasonCategory,
  type ThreatException,
} from '../src/model/exception'

/** D1 중 이 파일이 쓰는 부분 (Cloudflare D1Database 와 모양이 같다) */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<{ meta?: { changes?: number } }>
}
export interface D1Like {
  prepare(sql: string): D1Statement
  batch(statements: D1Statement[]): Promise<Array<{ meta?: { changes?: number } }>>
}

export const SERVER_DATASETS = ['measured', 'measured-v2'] as const
type ServerDataset = (typeof SERVER_DATASETS)[number]

export const MAX_BATCH = 500
export const UNDO_WINDOW_MS = 10 * 60 * 1000
const ID_PATTERN = /^EXC-[A-Z0-9]{4,32}$/

type Json = (status: number, body: Record<string, unknown>) => Response

interface Row {
  id: string
  dataset: ServerDataset
  scope: ThreatException['scope']
  rule_id: string
  scenario_key: string
  fingerprint: string
  subject_key: string | null
  subject_label: string | null
  reason_category: ExceptionReasonCategory
  reason: string
  reference: string | null
  actor: string
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  revoked_by: string | null
  revoke_reason: string | null
  updated_at: string
  detail: string
}

interface EventRow {
  exception_id: string
  at: string
  action: ExceptionHistoryEntry['action']
  actor: string | null
  note: string | null
}

function toException(row: Row, events: EventRow[]): ThreatException {
  const detail = JSON.parse(row.detail) as Pick<ThreatException, 'subjectAccountKeys' | 'observationIds' | 'snapshot' | 'approver' | 'decisionId'>
  const item: ThreatException = {
    id: row.id,
    dataset: row.dataset,
    scope: row.scope,
    ruleId: row.rule_id,
    scenarioKey: row.scenario_key as ThreatException['scenarioKey'],
    fingerprint: row.fingerprint,
    reasonCategory: row.reason_category,
    reason: row.reason,
    actor: row.actor,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    snapshot: detail.snapshot,
    history: events.map(e => ({ at: e.at, action: e.action, ...(e.actor ? { actor: e.actor } : {}), ...(e.note ? { note: e.note } : {}) })),
  }
  if (row.subject_key) item.subjectKey = row.subject_key
  if (row.subject_label) item.subjectLabel = row.subject_label
  if (detail.subjectAccountKeys) item.subjectAccountKeys = detail.subjectAccountKeys
  if (detail.observationIds) item.observationIds = detail.observationIds
  if (detail.approver) item.approver = detail.approver
  if (detail.decisionId) item.decisionId = detail.decisionId
  if (row.reference) item.reference = row.reference
  if (row.revoked_at) item.revokedAt = row.revoked_at
  if (row.revoked_by) item.revokedBy = row.revoked_by
  if (row.revoke_reason) item.revokeReason = row.revoke_reason
  return item
}

async function readOne(db: D1Like, dataset: ServerDataset, id: string): Promise<ThreatException | null> {
  const row = await db.prepare('SELECT * FROM threat_exceptions WHERE id = ? AND dataset = ?').bind(id, dataset).first<Row>()
  if (!row) return null
  const { results } = await db
    .prepare('SELECT exception_id, at, action, actor, note FROM threat_exception_events WHERE exception_id = ? ORDER BY seq')
    .bind(id)
    .all<EventRow>()
  return toException(row, results)
}

async function readAll(db: D1Like, dataset: ServerDataset): Promise<ThreatException[]> {
  const [{ results: rows }, { results: events }] = await Promise.all([
    db.prepare('SELECT * FROM threat_exceptions WHERE dataset = ? ORDER BY created_at, id').bind(dataset).all<Row>(),
    db
      .prepare(
        'SELECT e.exception_id, e.at, e.action, e.actor, e.note FROM threat_exception_events e JOIN threat_exceptions x ON x.id = e.exception_id WHERE x.dataset = ? ORDER BY e.seq'
      )
      .bind(dataset)
      .all<EventRow>(),
  ])
  const byId = new Map<string, EventRow[]>()
  for (const e of events) {
    const list = byId.get(e.exception_id) ?? []
    list.push(e)
    byId.set(e.exception_id, list)
  }
  return rows.map(row => toException(row, byId.get(row.id) ?? []))
}

/** 바로 앞 문장이 행을 바꿨을 때만 넣는 꼬리. batch 안에서 앞 문장이 조건에 걸리면 뒤가 줄줄이 빠진다 */
const CHAINED = 'WHERE changes() > 0'

/**
 * 예외 한 건과 그 이력을 넣는 문장들. chained 면 모든 문장이 바로 앞 문장의 결과에 걸린다 —
 * 다시 적용처럼 앞의 조건부 UPDATE 가 실패하면 아무것도 들어가지 않게 할 때 쓴다.
 */
function insertStatements(db: D1Like, item: ThreatException, now: string, chained = false): D1Statement[] {
  // 승인자와 결정 ID 는 등록 때 정해지고 바뀌지 않아 detail 에 둔다 (열을 더하지 않아 D1 마이그레이션이 없다)
  const detail = JSON.stringify({
    subjectAccountKeys: item.subjectAccountKeys,
    observationIds: item.observationIds,
    snapshot: item.snapshot,
    approver: item.approver?.trim() || undefined,
    decisionId: item.decisionId,
  })
  const values = (n: number) => (chained ? `SELECT ${Array(n).fill('?').join(', ')} ${CHAINED}` : `VALUES (${Array(n).fill('?').join(', ')})`)
  const statements = [
    db
      .prepare(
        `INSERT INTO threat_exceptions (id, dataset, scope, rule_id, scenario_key, fingerprint, subject_key, subject_label, reason_category, reason,
           reference, actor, created_at, expires_at, revoked_at, revoked_by, revoke_reason, updated_at, detail)
         ${values(19)}`
      )
      .bind(
        item.id,
        item.dataset,
        item.scope,
        item.ruleId,
        item.scenarioKey,
        item.fingerprint,
        item.subjectKey ?? null,
        item.subjectLabel ?? null,
        item.reasonCategory,
        item.reason.trim(),
        item.reference?.trim() || null,
        item.actor.trim(),
        item.createdAt,
        item.expiresAt,
        item.revokedAt ?? null,
        item.revokedBy ?? null,
        item.revokeReason ?? null,
        now,
        detail
      ),
  ]
  for (const h of item.history) statements.push(eventStatement(db, item.id, h.at, h.action, h.actor, h.note, chained))
  return statements
}

function eventStatement(db: D1Like, id: string, at: string, action: ExceptionHistoryEntry['action'], actor?: string, note?: string, chained = false): D1Statement {
  return db
    .prepare(`INSERT INTO threat_exception_events (exception_id, at, action, actor, note) ${chained ? `SELECT ?, ?, ?, ?, ? ${CHAINED}` : 'VALUES (?, ?, ?, ?, ?)'}`)
    .bind(id, at, action, actor ?? null, note ?? null)
}

/**
 * 조건부 UPDATE 와 그 이력을 한 batch(한 트랜잭션)로 쓴다. 이력은 바로 앞 UPDATE 가 행을 바꿨을 때만 남는다 (`changes()`).
 * 조건이 안 맞으면(이미 취소됨 · 그사이 다른 사람이 고침) 아무것도 쓰지 않고 false.
 */
async function guardedUpdate(db: D1Like, update: D1Statement, id: string, at: string, action: ExceptionHistoryEntry['action'], actor: string, note?: string): Promise<boolean> {
  const [result] = await db.batch([update, eventStatement(db, id, at, action, actor, note, true)])
  return (result?.meta?.changes ?? 0) > 0
}

const clean = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

function readActor(body: Record<string, unknown>): string | null {
  const actor = clean(body.actor, MAX_ACTOR_LENGTH + 1)
  return actor && actor.length <= MAX_ACTOR_LENGTH ? actor : null
}

/**
 * 등록할 레코드를 서버 기준으로 맞춘다.
 * - create: 등록 시각·이력을 서버 시각으로 새로 찍고, 만료 규칙(기본 90일 · 위험 수용·구성 전체는 무기한 금지·최대 180일)을 검사한다.
 * - import: 다른 브라우저에 있던 기록을 옮기는 것이라 시각·이력·만료를 그대로 둔다.
 */
function prepareInsert(value: unknown, dataset: ServerDataset, mode: 'create' | 'import', now: Date): { item?: ThreatException; problem?: string } {
  const problem = exceptionProblem(value)
  if (problem) return { problem: `형식 오류 (${problem})` }
  const item = { ...(value as ThreatException) }
  if (item.dataset !== dataset) return { problem: `다른 데이터셋 ${item.dataset}의 예외` }
  if (mode === 'create') {
    if (item.revokedAt) return { problem: '취소된 예외는 새로 등록할 수 없음' }
    const expiry = validateExpiry(item.expiresAt, item.scope, item.reasonCategory, now)
    if (expiry) return { problem: expiry }
    const approval = approverProblem(item.scope, item.reasonCategory, item.actor, item.approver)
    if (approval) return { problem: approval }
    const at = now.toISOString()
    item.createdAt = at
    item.history = [{ at, action: 'created', actor: item.actor.trim(), ...(item.history[0]?.note ? { note: item.history[0].note } : {}) }]
  }
  return { item }
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('Content-Length') ?? 0)
  if (length > 1_000_000) return null
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function datasetOf(value: unknown): ServerDataset | null {
  return SERVER_DATASETS.includes(value as ServerDataset) ? (value as ServerDataset) : null
}

/** `route` 는 `/api/measured/` 뒤의 경로 (`exceptions`, `exceptions/EXC-…/revoke`) */
export async function handleExceptions(request: Request, route: string, db: D1Like, json: Json, nowMs: number): Promise<Response> {
  const now = new Date(nowMs)
  const stamp = now.toISOString()
  const url = new URL(request.url)
  const parts = route.split('/')

  if (parts.length === 1) {
    if (request.method === 'GET') {
      const dataset = datasetOf(url.searchParams.get('dataset'))
      if (!dataset) return json(400, { error: 'bad_dataset' })
      return json(200, { items: await readAll(db, dataset), serverTime: stamp })
    }
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    const body = await readBody(request)
    const dataset = datasetOf(body?.dataset)
    const mode = body?.mode === 'create' || body?.mode === 'import' ? body.mode : null
    if (!body || !dataset || !mode || !Array.isArray(body.items)) return json(400, { error: 'bad_request' })
    if (body.items.length === 0 || body.items.length > MAX_BATCH) return json(400, { error: 'bad_batch_size' })

    const skipped: Array<{ id?: string; reason: string }> = []
    const accepted: ThreatException[] = []
    const seen = new Set<string>()
    for (const value of body.items) {
      const { item, problem } = prepareInsert(value, dataset, mode, now)
      if (!item) {
        skipped.push({ id: (value as { id?: string })?.id, reason: problem ?? '형식 오류' })
        continue
      }
      if (seen.has(item.id)) {
        skipped.push({ id: item.id, reason: '같은 요청 안에서 ID 가 겹침' })
        continue
      }
      seen.add(item.id)
      accepted.push(item)
    }
    // 이미 있는 ID 는 건너뛴다 (가져오기를 두 번 해도 같다)
    const existing = new Set<string>()
    for (let i = 0; i < accepted.length; i += 50) {
      const chunk = accepted.slice(i, i + 50).map(item => item.id)
      const { results } = await db
        .prepare(`SELECT id FROM threat_exceptions WHERE id IN (${chunk.map(() => '?').join(', ')})`)
        .bind(...chunk)
        .all<{ id: string }>()
      for (const r of results) existing.add(r.id)
    }
    const fresh = accepted.filter(item => {
      if (!existing.has(item.id)) return true
      skipped.push({ id: item.id, reason: '이미 있는 ID' })
      return false
    })
    // 새 예외를 만드는 요청(create)에서 하나라도 거절되면 아무것도 넣지 않는다 — 창에서 고른 대상 일부만 들어가지 않게
    if (mode === 'create' && skipped.length > 0) return json(400, { error: 'rejected', skipped })
    if (fresh.length) await db.batch(fresh.flatMap(item => insertStatements(db, item, stamp)))
    const items: ThreatException[] = []
    for (const item of fresh) {
      const saved = await readOne(db, dataset, item.id)
      if (saved) items.push(saved)
    }
    return json(200, { inserted: fresh.map(i => i.id), skipped, items })
  }

  const [, id, action] = parts
  if (parts.length !== 3 || !ID_PATTERN.test(id ?? '')) return json(404, { error: 'not_found' })
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const body = await readBody(request)
  const dataset = datasetOf(body?.dataset)
  if (!body || !dataset) return json(400, { error: 'bad_request' })
  const current = await readOne(db, dataset, id)
  if (!current) return json(404, { error: 'not_found' })

  const conflict = () => json(409, { error: 'conflict', item: current })
  const staleUpdate = typeof body.updatedAt === 'string' && body.updatedAt !== current.updatedAt

  if (action === 'undo') {
    const onlyCreated = current.history.length === 1 && current.history[0].action === 'created'
    if (!onlyCreated || nowMs - new Date(current.createdAt).getTime() > UNDO_WINDOW_MS) return json(409, { error: 'undo_expired', item: current })
    await db.batch([
      db.prepare('DELETE FROM threat_exception_events WHERE exception_id = ?').bind(id),
      db.prepare('DELETE FROM threat_exceptions WHERE id = ? AND dataset = ?').bind(id, dataset),
    ])
    return json(200, { removed: id })
  }

  const actor = readActor(body)
  if (!actor) return json(400, { error: 'bad_actor' })

  if (action === 'revoke') {
    const note = clean(body.note, MAX_REASON_LENGTH)
    const update = db
      .prepare('UPDATE threat_exceptions SET revoked_at = ?, revoked_by = ?, revoke_reason = ?, updated_at = ? WHERE id = ? AND dataset = ? AND revoked_at IS NULL')
      .bind(stamp, actor, note ?? null, stamp, id, dataset)
    if (!(await guardedUpdate(db, update, id, stamp, 'revoked', actor, note))) return conflict()
    return json(200, { item: await readOne(db, dataset, id) })
  }

  if (action === 'extend') {
    if (current.revokedAt) return conflict()
    const expiresAt = body.expiresAt === null ? null : typeof body.expiresAt === 'string' ? body.expiresAt : undefined
    if (expiresAt === undefined) return json(400, { error: 'bad_expiry' })
    const problem = validateExpiry(expiresAt, current.scope, current.reasonCategory, now)
    if (problem) return json(400, { error: 'bad_expiry', message: problem })
    if (staleUpdate) return conflict()
    const update = db
      .prepare('UPDATE threat_exceptions SET expires_at = ?, updated_at = ? WHERE id = ? AND dataset = ? AND updated_at = ? AND revoked_at IS NULL')
      .bind(expiresAt, stamp, id, dataset, current.updatedAt)
    if (!(await guardedUpdate(db, update, id, stamp, 'extended', actor, expiresAt ? `만료 ${expiresAt.slice(0, 10)}` : '무기한'))) return conflict()
    return json(200, { item: await readOne(db, dataset, id) })
  }

  if (action === 'edit') {
    if (current.revokedAt) return conflict()
    const reasonCategory = REASON_CATEGORIES.includes(body.reasonCategory as ExceptionReasonCategory)
      ? (body.reasonCategory as ExceptionReasonCategory)
      : current.reasonCategory
    const reason = typeof body.reason === 'string' ? body.reason.trim() : current.reason
    if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) return json(400, { error: 'bad_reason' })
    const reference = typeof body.reference === 'string' ? body.reference.trim().slice(0, MAX_REFERENCE_LENGTH) || null : current.reference ?? null
    // 분류를 위험 수용으로 바꾸면 만료 규칙도 따라야 한다
    const problem = validateExpiry(current.expiresAt, current.scope, reasonCategory, now)
    if (problem && reasonCategory !== current.reasonCategory) return json(400, { error: 'bad_expiry', message: problem })
    if (staleUpdate) return conflict()
    const update = db
      .prepare(
        'UPDATE threat_exceptions SET reason_category = ?, reason = ?, reference = ?, updated_at = ? WHERE id = ? AND dataset = ? AND updated_at = ? AND revoked_at IS NULL'
      )
      .bind(reasonCategory, reason, reference, stamp, id, dataset, current.updatedAt)
    if (!(await guardedUpdate(db, update, id, stamp, 'edited', actor, '사유 수정'))) return conflict()
    return json(200, { item: await readOne(db, dataset, id) })
  }

  if (action === 'reapply') {
    const active = !current.revokedAt && (current.expiresAt === null || new Date(current.expiresAt).getTime() > nowMs)
    if (active) return json(409, { error: 'still_active', item: current })
    // 한 예외는 한 번만 다시 적용한다 — 같은 버튼을 두 번 눌러 같은 예외가 둘 생기지 않게. 새로 만든 쪽이 끝나면 그쪽을 다시 적용한다
    if (current.history.some(h => h.action === 'reapplied')) return json(409, { error: 'already_reapplied', item: current })
    const { item, problem } = prepareInsert(body.item, dataset, 'create', now)
    if (!item) return json(400, { error: 'bad_item', message: problem })
    if (item.fingerprint !== current.fingerprint || item.scope !== current.scope || (item.subjectKey ?? null) !== (current.subjectKey ?? null)) {
      return json(400, { error: 'bad_item', message: '다시 적용은 같은 위협, 범위, 대상이어야 합니다' })
    }
    if (await db.prepare('SELECT id FROM threat_exceptions WHERE id = ?').bind(item.id).first()) return json(409, { error: 'duplicate_id' })
    item.history = [{ at: stamp, action: 'created', actor: item.actor, note: `${id} 다시 적용` }]
    // 옛 예외를 먼저 조건부로 건드리고(그사이 누가 먼저 다시 적용했으면 0행), 새 예외·이력은 그 결과에 줄줄이 건다
    const [touched] = await db.batch([
      db.prepare('UPDATE threat_exceptions SET updated_at = ? WHERE id = ? AND dataset = ? AND updated_at = ?').bind(stamp, id, dataset, current.updatedAt),
      ...insertStatements(db, item, stamp, true),
      eventStatement(db, id, stamp, 'reapplied', actor, `${item.id} 로 다시 적용`, true),
    ])
    if (!touched?.meta?.changes) return conflict()
    return json(200, { item: await readOne(db, dataset, item.id), old: await readOne(db, dataset, id) })
  }

  return json(404, { error: 'not_found' })
}
