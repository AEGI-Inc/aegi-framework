import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SqlExecutor } from '../../../loader/sql.ts'
import { LogStore, LOG_MIGRATIONS_DIR } from './logStore.ts'

/** Tests only: an in-memory D1 stand-in with the log cache schema applied. failWrites makes every insert throw. */
export function testLogStore(now: () => number = Date.now, o: { failWrites?: boolean; migrate?: boolean } = {}) {
  const db = new DatabaseSync(':memory:')
  if (o.migrate !== false) for (const f of fs.readdirSync(LOG_MIGRATIONS_DIR).sort()) db.exec(fs.readFileSync(path.join(LOG_MIGRATIONS_DIR, f), 'utf8'))
  const exec: SqlExecutor = {
    async query<T>(sql: string, params: unknown[] = []) { return db.prepare(sql).all(...(params as never[])) as T[] },
    async batch(statements) {
      if (o.failWrites && statements.some(s => /^INSERT/.test(s.sql))) throw new Error('d1 down')
      db.exec('BEGIN')
      try { for (const s of statements) db.prepare(s.sql).run(...(s.params as never[])); db.exec('COMMIT') } catch (err) { db.exec('ROLLBACK'); throw err }
    },
  }
  return { store: new LogStore(exec, 24 * 3600_000, now), db, exec }
}
