/**
 * 대시보드 D1 마이그레이션 러너 (docs/spec/AEGI_D1_SNAPSHOT_STORE_V1.md 2단계).
 * schema_migrations 테이블에 적용 이력(owner: 'dashboard:team')을 남겨 한 번씩만 적용하고 변조를 감지한다.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { D1Like, D1Statement } from './exceptions'

export const DASHBOARD_SCHEMA_OWNER = 'dashboard:team'

/** SQL 텍스트를 개별 실행 문장으로 분리 */
export function splitSql(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter(line => !/^\s*--/.test(line))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map(stmt => stmt.trim())
    .filter(Boolean)
}

/** 아직 적용되지 않은 마이그레이션 파일 목록 */
export async function pendingDashboardMigrations(db: D1Like, migrationsDir: string): Promise<string[]> {
  const files = fs.readdirSync(migrationsDir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()
  try {
    const appliedRows = await db
      .prepare('SELECT name FROM schema_migrations WHERE owner = ?')
      .bind(DASHBOARD_SCHEMA_OWNER)
      .all<{ name: string }>()
    const applied = new Set(appliedRows.results.map(r => r.name))
    return files.filter(f => !applied.has(f))
  } catch {
    // schema_migrations 테이블이 없으면 전체가 미적용 상태
    return files
  }
}

/**
 * server/migrations/*.sql 마이그레이션을 순서대로 적용하고 schema_migrations 에 기록한다.
 */
export async function applyDashboardMigrations(
  db: D1Like,
  migrationsDir: string,
  now = new Date().toISOString()
): Promise<string[]> {
  // schema_migrations 테이블 확인 및 생성
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (owner, name)
      )`
    )
    .run()

  const appliedRows = await db
    .prepare('SELECT name, sha256 FROM schema_migrations WHERE owner = ?')
    .bind(DASHBOARD_SCHEMA_OWNER)
    .all<{ name: string; sha256: string }>()
  const applied = new Map(appliedRows.results.map(r => [r.name, r.sha256]))

  const files = fs.readdirSync(migrationsDir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()
  const appliedNow: string[] = []

  for (const file of files) {
    const text = fs.readFileSync(path.join(migrationsDir, file), 'utf8').replace(/\r\n/g, '\n')
    const sha = crypto.createHash('sha256').update(text).digest('hex')
    const prevSha = applied.get(file)

    if (prevSha) {
      if (prevSha !== sha) {
        throw new Error(`이미 적용한 마이그레이션 ${DASHBOARD_SCHEMA_OWNER}/${file} 의 내용이 바뀌었다. 적용된 파일은 고치지 않고 새 파일을 더한다`)
      }
      continue
    }

    const statements: D1Statement[] = splitSql(text).map(sql => db.prepare(sql))
    statements.push(
      db
        .prepare('INSERT INTO schema_migrations (owner, name, sha256, applied_at) VALUES (?, ?, ?, ?)')
        .bind(DASHBOARD_SCHEMA_OWNER, file, sha, now)
    )

    await db.batch(statements)
    appliedNow.push(file)
  }

  return appliedNow
}
