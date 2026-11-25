import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getD1Uuid, TARGETS } from '../loader/target.ts'
import { applyMigrations, d1Executor } from '../loader/sql.ts'
import { assessmentDocument, publishAssessment, TitleRuleError } from './history.ts'

async function main() {
  const args = process.argv.slice(2)
  const allowed = new Set(['--env', '--file', '--source-snapshot'])
  const options = new Map<string, string>()
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options.has(args[i])) throw new Error('사용법: npm run standards:publish -- --env preview|production --file <standard_results.json> [--source-snapshot <원본 그래프 ID>]')
    options.set(args[i], args[i + 1])
  }
  const env = options.get('--env')
  const file = options.get('--file')
  if ((env !== 'production' && env !== 'preview') || !file) throw new Error('--env preview|production 과 --file 을 명시하세요')
  const source = options.get('--source-snapshot') ?? null
  if (source && !/^[A-Za-z0-9_-]{1,160}$/.test(source)) throw new Error('출처 스냅샷 ID 형식이 맞지 않습니다')
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
  assessmentDocument(value)
  const exec = d1Executor(await getD1Uuid(TARGETS[env].d1Name))
  const migrations = fileURLToPath(new URL('../../migrations/standards/', import.meta.url))
  await applyMigrations(exec, 'standards', migrations)
  const before = await exec.query("SELECT snapshot_id, previous_snapshot_id FROM graph_head WHERE name='current'")
  const result = await publishAssessment(exec, value, source)
  const after = await exec.query("SELECT snapshot_id, previous_snapshot_id FROM graph_head WHERE name='current'")
  console.log(JSON.stringify({ env, ...result, graphHeadUnchanged: JSON.stringify(before) === JSON.stringify(after) }))
}
main().catch(e => { console.error(e instanceof TitleRuleError ? e.message : '기준별 판정 게시 실패. 입력 형식, 권한, 이력 또는 동시 변경을 확인하세요 (원본 내용 출력 안 함)'); process.exitCode = 1 })
