/**
 * 로컬 SQLite 파일 하나(data/aegi.sqlite)가 운영의 Cloudflare D1 자리를 맡는다.
 * - 대시보드 서버는 D1Like(prepare/bind/first/all/run/batch)를 쓴다
 * - 엔진 적재기와 로그 캐시는 SqlExecutor(query/batch)를 쓴다
 * 둘 다 같은 연결을 쓰고, 마이그레이션도 운영과 같은 파일(엔진 graph, splunk-log, standards, 대시보드 server/migrations)을 적용한다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { D1Like, D1Statement } from '../vendor/dashboard/server/exceptions.ts'
import { applyDashboardMigrations } from '../vendor/dashboard/server/migrate.ts'
import { applyMigrations, type SqlExecutor, type Statement } from '../vendor/engine/scripts/loader/sql.ts'
import { LOG_MIGRATIONS } from '../vendor/engine/scripts/stream/splunk/query/logMigrations.ts'
import { VENDOR } from './paths.ts'

export interface LocalDb { db: DatabaseSync; d1: D1Like; exec: SqlExecutor; close(): void }

/** D1 처럼 undefined 는 NULL, 참거짓은 1/0 으로 넣는다 */
const value = (v: unknown): SQLInputValue => {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint' || v instanceof Uint8Array) return v
  return JSON.stringify(v)
}

/** node:sqlite 는 ?1 같은 번호 매개변수를 위치 값으로 묶지 못한다. D1 처럼 ?N 을 N 번째 값으로 풀어 ? 로 넘긴다 */
export function positional(sql: string, values: unknown[]): { sql: string; params: SQLInputValue[] } {
  const numbered: unknown[] = []
  const plain = sql.replace(/\?(\d+)/g, (_, n: string) => { numbered.push(values[Number(n) - 1]); return '?' })
  return { sql: plain, params: (plain === sql ? values : numbered).map(value) }
}

export function openDb(file: string): LocalDb {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

  const run = (sql: string, values: unknown[]) => { const p = positional(sql, values); return db.prepare(p.sql).run(...p.params) }
  const all = <T>(sql: string, values: unknown[]) => { const p = positional(sql, values); return db.prepare(p.sql).all(...p.params) as T[] }
  /** 여러 문장을 한 트랜잭션으로. D1 batch 도 하나라도 실패하면 모두 되돌린다 */
  const transaction = <T>(work: () => T): T => {
    if (db.isTransaction) return work()
    db.exec('BEGIN')
    try { const out = work(); db.exec('COMMIT'); return out } catch (e) { db.exec('ROLLBACK'); throw e }
  }

  const statement = (sql: string, values: unknown[] = []): D1Statement & { exec(): { meta: { changes: number } } } => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() => (all<T>(sql, values)[0] ?? null),
    all: async <T>() => ({ results: all<T>(sql, values) }),
    run: async () => ({ meta: { changes: Number(run(sql, values).changes) } }),
    exec: () => ({ meta: { changes: Number(run(sql, values).changes) } }),
  })
  const d1: D1Like = {
    prepare: sql => statement(sql),
    batch: async statements => transaction(() => statements.map(s => (s as ReturnType<typeof statement>).exec())),
  }
  const exec: SqlExecutor = {
    query: async <T>(sql: string, params: unknown[] = []) => all<T>(sql, params),
    batch: async (statements: Statement[]) => {
      transaction(() => { for (const s of statements) s.params.length ? run(s.sql, s.params) : db.exec(s.sql) })
    },
  }
  return { db, d1, exec, close: () => db.close() }
}

/** 운영과 같은 네 묶음의 마이그레이션. 이미 적용한 것은 건너뛴다 */
export async function migrate(local: LocalDb): Promise<string[]> {
  const ran = [
    ...(await applyMigrations(local.exec, 'graph', path.join(VENDOR, 'engine', 'migrations', 'graph'))).map(f => `graph/${f}`),
    ...(await applyMigrations(local.exec, 'splunk-log', LOG_MIGRATIONS)).map(f => `splunk-log/${f}`),
    ...(await applyMigrations(local.exec, 'standards', path.join(VENDOR, 'engine', 'migrations', 'standards'))).map(f => `standards/${f}`),
    ...(await applyDashboardMigrations(local.d1, path.join(VENDOR, 'dashboard', 'server', 'migrations'))).map(f => `dashboard/${f}`),
  ]
  return ran
}
