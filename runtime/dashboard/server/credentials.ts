/**
 * 수집 자격증명·계정 대장 API — 팀이 함께 쓰는 D1(위협 예외와 같은 `EXCEPTIONS_DB`, 테이블 `collection_credentials`).
 * server/measured.ts 가 `/api/measured/credentials…` 를 이리로 넘긴다. 실측 번들과 같은 팀 비밀번호 세션이 있어야 한다.
 *
 *   GET  /api/measured/credentials                         → { items, serverTime }
 *   POST /api/measured/credentials        { mode: 'create', actor, item }    새 항목 하나 (등록 시각·이력은 서버가 찍는다)
 *   POST /api/measured/credentials        { mode: 'import', items }          없는 ID 만 넣는다 (기본 목록 · 내보낸 파일)
 *   POST /api/measured/credentials/:id/change  { actor, updatedAt, change }  수정 · 발급 · 교체 · 폐기 · 다시 사용
 *   POST /api/measured/credentials/:id/delete  { updatedAt }                 발급 전 항목만 지운다 (나머지는 폐기로 남긴다)
 *
 * - **비밀값은 받지 않는다.** 모든 글자 칸을 `secretProblem()` 으로 검사해 토큰·키처럼 보이면 400 이다.
 *   알려진 칸만 저장한다 — 등록은 고칠 수 있는 칸만 골라 새로 만들고(`newCredential`), 가져오기는 모르는 칸을 뺀 뒤
 *   검사한다(`toCredential`). 요청에 칸을 덧붙여 비밀값을 D1 에 넣을 수 없다.
 * - 변경 규칙은 화면과 같은 `applyChange()` (src/model/collectionCredential.ts) 를 서버 시각으로 돌린다.
 * - 동시 수정: 본 적 있는 updatedAt 이 지금 값과 다르면 409 와 최신 항목을 돌려준다.
 */
import {
  actorProblem,
  applyChange,
  credentialProblem,
  GENERATED_PROBLEM,
  ID_PATTERN,
  isGenerated,
  newCredential,
  pickFields,
  toCredential,
  type CollectionCredential,
  type CredentialChange,
  type CredentialFields,
  type CredentialStatus,
} from '../src/model/collectionCredential'
import type { D1Like } from './exceptions'

type Json = (status: number, body: Record<string, unknown>) => Response

export const MAX_IMPORT = 200

interface Row {
  id: string
  detail: string
}

const parse = (row: Row): CollectionCredential => JSON.parse(row.detail) as CollectionCredential

async function readOne(db: D1Like, id: string): Promise<CollectionCredential | null> {
  const row = await db.prepare('SELECT id, detail FROM collection_credentials WHERE id = ?').bind(id).first<Row>()
  return row ? parse(row) : null
}

async function readAll(db: D1Like): Promise<CollectionCredential[]> {
  const { results } = await db.prepare('SELECT id, detail FROM collection_credentials ORDER BY id').all<Row>()
  return results.map(parse)
}

function insert(db: D1Like, item: CollectionCredential) {
  return db
    .prepare('INSERT OR IGNORE INTO collection_credentials (id, provider, category, status, created_at, updated_at, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(item.id, item.provider, item.category, item.status, item.createdAt, item.updatedAt, JSON.stringify(item))
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get('Content-Length') ?? 0) > 500_000) return null
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const STATUSES: CredentialStatus[] = ['planned', 'active', 'revoked']

/** `route` 는 `/api/measured/` 뒤의 경로 (`credentials`, `credentials/CRED-GH-01/change`) */
export async function handleCredentials(request: Request, route: string, db: D1Like, json: Json, nowMs: number): Promise<Response> {
  const stamp = new Date(nowMs).toISOString()
  const parts = route.split('/')

  if (parts.length === 1) {
    if (request.method === 'GET') return json(200, { items: await readAll(db), serverTime: stamp })
    const body = await readBody(request)
    if (!body) return json(400, { error: 'bad_request' })

    if (body.mode === 'create') {
      const value = body.item as { id?: unknown; status?: unknown } | undefined
      const actor = typeof body.actor === 'string' ? body.actor : ''
      if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !STATUSES.includes(value.status as CredentialStatus) || value.status === 'revoked') {
        return json(400, { error: 'bad_item' })
      }
      const who = actorProblem(actor)
      if (who) return json(400, { error: 'bad_actor', message: who })
      // 고칠 수 있는 칸만 골라 새로 만든다. 등록 시각 · 이력 · 상태 밖의 칸은 요청에 있어도 쓰지 않는다
      const fields = pickFields(value) as CredentialFields
      const item = newCredential({ ...fields, id: value.id, status: value.status as CredentialStatus }, actor, stamp)
      const problem = credentialProblem(item)
      if (problem) return json(400, { error: 'bad_item', message: problem })
      const [result] = await db.batch([insert(db, item)])
      if (!result?.meta?.changes) return json(409, { error: 'duplicate_id', item: await readOne(db, item.id) })
      return json(200, { item })
    }

    if (body.mode === 'import') {
      if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_IMPORT) return json(400, { error: 'bad_batch_size' })
      const skipped: Array<{ id?: string; reason: string }> = []
      const accepted: CollectionCredential[] = []
      const seen = new Set<string>()
      for (const value of body.items) {
        // 모르는 칸은 빼고 검사한다 (다른 판이 더한 칸이나 덧붙인 칸에 비밀값이 섞여 들어오지 않게)
        const normalized = toCredential(value)
        const rawId = (value as { id?: unknown } | null)?.id
        const id = typeof rawId === 'string' ? rawId.slice(0, 40) : undefined
        if ('problem' in normalized) skipped.push({ id, reason: `형식 오류 (${normalized.problem})` })
        else if (seen.has(normalized.item.id)) skipped.push({ id, reason: '같은 요청 안에서 ID 가 겹침' })
        else {
          seen.add(normalized.item.id)
          accepted.push(normalized.item)
        }
      }
      const results = accepted.length ? await db.batch(accepted.map(item => insert(db, item))) : []
      const inserted: string[] = []
      accepted.forEach((item, i) => {
        if (results[i]?.meta?.changes) inserted.push(item.id)
        else skipped.push({ id: item.id, reason: '이미 있는 ID' })
      })
      return json(200, { inserted, skipped, items: accepted.filter(item => inserted.includes(item.id)) })
    }
    return json(400, { error: 'bad_request' })
  }

  const [, id, action] = parts
  if (parts.length !== 3 || !ID_PATTERN.test(id ?? '')) return json(404, { error: 'not_found' })
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const body = await readBody(request)
  if (!body) return json(400, { error: 'bad_request' })
  const current = await readOne(db, id)
  if (!current) return json(404, { error: 'not_found' })
  if (typeof body.updatedAt !== 'string' || body.updatedAt !== current.updatedAt) return json(409, { error: 'conflict', item: current })
  // 환경 정의에서 만든 항목은 정의를 고친 뒤 engine env:ledger 로 다시 만든다. 여기서 고치거나 지우지 않는다
  if (isGenerated(current)) return json(409, { error: 'generated', message: GENERATED_PROBLEM, item: current })

  if (action === 'delete') {
    if (current.status !== 'planned') return json(409, { error: 'not_deletable', item: current })
    const result = await db.prepare('DELETE FROM collection_credentials WHERE id = ? AND updated_at = ?').bind(id, current.updatedAt).run()
    if (!result.meta?.changes) return json(409, { error: 'conflict', item: await readOne(db, id) })
    return json(200, { removed: id })
  }

  if (action === 'change') {
    const change = body.change as CredentialChange | undefined
    if (!change || typeof change !== 'object' || !['edit', 'activate', 'rotate', 'revoke', 'restore'].includes(change.type)) return json(400, { error: 'bad_change' })
    const outcome = applyChange(current, change, typeof body.actor === 'string' ? body.actor : '', stamp)
    if ('problem' in outcome) return json(400, { error: 'bad_change', message: outcome.problem })
    const next = outcome.item
    const problem = credentialProblem(next)
    if (problem) return json(400, { error: 'bad_change', message: problem })
    const result = await db
      .prepare('UPDATE collection_credentials SET provider = ?, category = ?, status = ?, updated_at = ?, detail = ? WHERE id = ? AND updated_at = ?')
      .bind(next.provider, next.category, next.status, next.updatedAt, JSON.stringify(next), id, current.updatedAt)
      .run()
    if (!result.meta?.changes) return json(409, { error: 'conflict', item: await readOne(db, id) })
    return json(200, { item: next })
  }

  return json(404, { error: 'not_found' })
}
