/**
 * SQL 실행 계층. 운영은 D1 REST API, 테스트는 node:sqlite 가 같은 인터페이스를 구현한다.
 *
 * D1 REST 제약 (2026-10-21 미리보기 D1 에서 확인):
 * - 한 문장의 바인딩은 100개까지
 * - 여러 문장을 한 sql 문자열에 넣으면 params 를 쓸 수 없다. params 가 있으면 `{ batch: [{ sql, params }] }` 로 묶는다
 * - 문장 길이 한도(100KB)는 SQL 텍스트에만 걸린다. 바인딩 값은 세지 않는다
 *   (2026-10-30 미리보기 D1 에서 128KB, 500KB, 1.9MB, 2.1MB 값 한 행을 query 와 batch 로 넣고 읽어 같음을 확인)
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { cfApi } from './target.ts'

export interface Statement {
  sql: string
  params: unknown[]
}

export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** 문장들을 순서대로 실행한다. 큰 묶음은 batchStatements 로 나눠 부른다 */
  batch(statements: Statement[]): Promise<void>
}

export const D1_MAX_PARAMS = 100
/** 한 문장의 SQL 텍스트 상한. D1 문장 길이 한도(100KB) 아래로 둔다 */
const MAX_SQL_BYTES = 90_000
/** 한 행의 바인딩 값 크기 합의 상한. D1 행 크기 한도(2MB) 아래로 둔다 */
const MAX_ROW_BYTES = 1_000_000
/** 한 HTTP 요청에 싣는 문장 수와 크기. 여러 행 문장 하나의 바인딩 값 합도 이 크기 안으로 나눈다 */
const MAX_BATCH_STATEMENTS = 40
const MAX_BATCH_BYTES = 900_000

export function d1Executor(dbUuid: string): SqlExecutor {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await cfApi<Array<{ results: T[] }>>('POST', `/d1/database/${dbUuid}/query`, { sql, params })
      return res[0]?.results ?? []
    },
    async batch(statements: Statement[]) {
      for (const group of batchStatements(statements)) {
        await cfApi('POST', `/d1/database/${dbUuid}/query`, { batch: group.map(s => ({ sql: s.sql, params: s.params })) })
      }
    },
  }
}

const sizeOf = (v: unknown) => (typeof v === 'string' ? Buffer.byteLength(v) : 16)

/**
 * 여러 행을 넣는 INSERT 문장들. 바인딩 수, SQL 텍스트 길이, 바인딩 값 크기 합에 맞춰 나눈다.
 * tail 은 VALUES 뒤에 붙는 절(ON CONFLICT 등)이다
 */
export function insertStatements(table: string, columns: string[], rows: unknown[][], maxParams = D1_MAX_PARAMS, verb: 'INSERT' | 'INSERT OR REPLACE' = 'INSERT', tail = ''): Statement[] {
  if (columns.length > maxParams) throw new Error(`${table}: 열 ${columns.length}개가 바인딩 한도 ${maxParams} 를 넘는다`)
  const perRow = `(${columns.map(() => '?').join(', ')})`
  const head = `${verb} INTO ${table} (${columns.join(', ')}) VALUES `
  const baseSql = Buffer.byteLength(head) + Buffer.byteLength(tail) + 1
  const out: Statement[] = []
  let chunk: unknown[][] = []
  let sqlBytes = baseSql
  let valueBytes = 0
  const flush = () => {
    if (!chunk.length) return
    out.push({ sql: head + chunk.map(() => perRow).join(', ') + (tail ? ` ${tail}` : ''), params: chunk.flat() })
    chunk = []
    sqlBytes = baseSql
    valueBytes = 0
  }
  for (const row of rows) {
    if (row.length !== columns.length) throw new Error(`${table}: 열 ${columns.length}개인데 값이 ${row.length}개다`)
    const rowSql = perRow.length + 2
    const rowValues = row.reduce<number>((n, v) => n + sizeOf(v), 0)
    if (rowValues > MAX_ROW_BYTES) throw new Error(`${table}: 한 행의 값이 ${rowValues}바이트로 행 한도 ${MAX_ROW_BYTES}를 넘는다`)
    if ((chunk.length + 1) * columns.length > maxParams || sqlBytes + rowSql > MAX_SQL_BYTES || valueBytes + rowValues > MAX_BATCH_BYTES) flush()
    chunk.push(row)
    sqlBytes += rowSql
    valueBytes += rowValues
  }
  flush()
  return out
}

/** 한 HTTP 요청에 실을 문장 묶음으로 나눈다 */
export function batchStatements(statements: Statement[], maxStatements = MAX_BATCH_STATEMENTS, maxBytes = MAX_BATCH_BYTES): Statement[][] {
  const groups: Statement[][] = []
  let group: Statement[] = []
  let bytes = 0
  for (const s of statements) {
    const size = Buffer.byteLength(s.sql) + s.params.reduce<number>((n, v) => n + sizeOf(v), 0)
    if (group.length && (group.length >= maxStatements || bytes + size > maxBytes)) {
      groups.push(group)
      group = []
      bytes = 0
    }
    group.push(s)
    bytes += size
  }
  if (group.length) groups.push(group)
  return groups
}

export function splitSqlStatements(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter(line => !/^\s*--/.test(line))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map(stmt => stmt.trim())
    .filter(Boolean)
}

/** 아직 적용하지 않은 마이그레이션 파일 이름. 스키마를 바꾸지 않는다 (기록 표가 없으면 전부) */
export async function pendingMigrations(exec: SqlExecutor, owner: string, dir: string): Promise<string[]> {
  const files = fs.readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()
  const hasTable = (await exec.query<{ n: number }>(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`))[0]?.n
  if (!hasTable) return files
  const applied = new Set((await exec.query<{ name: string }>('SELECT name FROM schema_migrations WHERE owner = ?', [owner])).map(r => r.name))
  return files.filter(f => !applied.has(f))
}

/**
 * 마이그레이션을 한 번씩만 적용하고 schema_migrations 에 남긴다.
 * 이미 적용한 파일의 내용이 바뀌었으면 멈춘다 (적용된 마이그레이션은 고치지 않고 새 파일을 더한다).
 * source 는 폴더이거나, 단일 파일 bundle 처럼 폴더가 없을 때 넣어 둔 {name, text} 목록이다
 */
export async function applyMigrations(exec: SqlExecutor, owner: string, source: string | Array<{ name: string; text: string }>, now = new Date().toISOString()): Promise<string[]> {
  await exec.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    owner TEXT NOT NULL, name TEXT NOT NULL, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY (owner, name))`)
  const applied = new Map((await exec.query<{ name: string; sha256: string }>('SELECT name, sha256 FROM schema_migrations WHERE owner = ?', [owner])).map(r => [r.name, r.sha256]))
  const entries = typeof source === 'string'
    ? fs.readdirSync(source).filter(f => /^\d{4}_.*\.sql$/.test(f)).map(name => ({ name, text: fs.readFileSync(path.join(source, name), 'utf8') }))
    : source.filter(m => /^\d{4}_.*\.sql$/.test(m.name))
  const ran: string[] = []
  for (const { name: file, text: raw } of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const text = raw.replace(/\r\n/g, '\n')
    const sha = crypto.createHash('sha256').update(text).digest('hex')
    const prev = applied.get(file)
    if (prev) {
      if (prev !== sha) throw new Error(`이미 적용한 마이그레이션 ${owner}/${file} 의 내용이 바뀌었다. 적용된 파일은 고치지 않고 새 파일을 더한다`)
      continue
    }
    await exec.batch([
      ...splitSqlStatements(text).map(sql => ({ sql, params: [] })),
      { sql: 'INSERT INTO schema_migrations (owner, name, sha256, applied_at) VALUES (?, ?, ?, ?)', params: [owner, file, sha, now] },
    ])
    ran.push(file)
  }
  return ran
}
