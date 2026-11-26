import path from 'path'
import { applyMigrations, d1Executor, pendingMigrations, type SqlExecutor } from './sql.ts'
import { getD1Uuid, ROOT } from './target.ts'

export const MIGRATIONS_DIR = path.join(ROOT, 'migrations', 'graph')

/** 연결만 연다. 스키마와 적용 기록을 만들지 않는다 (게시 사전검사). */
export async function openConnection(t: { d1Name: string }): Promise<SqlExecutor> {
  return d1Executor(await getD1Uuid(t.d1Name))
}

/**
 * 그 환경 D1 에 붙는다.
 * migrate 가 true 일 때만(publish) 아직 적용하지 않은 그래프 마이그레이션을 적용한다.
 * 읽기 전용 명령(verify, snapshots)은 스키마를 바꾸지 않고, 적용 안 된 마이그레이션이 있으면 멈춘다.
 */
export async function connect(t: { d1Name: string }, { migrate = false } = {}): Promise<SqlExecutor> {
  const exec = await openConnection(t)
  if (migrate) {
    const ran = await applyMigrations(exec, 'graph', MIGRATIONS_DIR)
    if (ran.length) console.log(`마이그레이션 적용 (${t.d1Name}): ${ran.join(', ')}`)
    return exec
  }
  const pending = await pendingMigrations(exec, 'graph', MIGRATIONS_DIR)
  if (pending.length) throw new Error(`${t.d1Name} 에 적용 안 된 마이그레이션이 있다: ${pending.join(', ')}. 이 명령은 스키마를 바꾸지 않는다 (npm run publish 가 적용한다)`)
  return exec
}
