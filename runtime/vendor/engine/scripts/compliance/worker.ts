/** Single-workspace D1 queue worker. No SaaS collection is performed here. */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { openConnection } from '../loader/connect.ts'
import { ROOT, TARGETS, type TargetEnv } from '../loader/target.ts'
import type { SqlExecutor } from '../loader/sql.ts'

type Job = {id:string; workspace:string; check_id:string; snapshot_id:string; policy:string}
const workspacePattern = /^[a-zA-Z0-9_-]{1,80}$/
export async function processOne(db: SqlExecutor, workspace: string, evaluate: (check:string, objects:unknown[], policy:unknown) => Promise<unknown>, now = new Date()): Promise<boolean> {
  if (!workspacePattern.test(workspace)) throw new Error('workspace_not_configured')
  const stamp = now.toISOString(), leaseUntil = new Date(now.getTime() + 5 * 60_000).toISOString(), token = randomUUID()
  const [job] = await db.query<Job>(`UPDATE compliance_runs SET status='running', updated_at=?, lease_token=?, lease_until=? WHERE id=(SELECT id FROM compliance_runs WHERE workspace=? AND (status='pending' OR (status='running' AND lease_until < ?)) ORDER BY created_at LIMIT 1) RETURNING id, workspace, check_id, snapshot_id, policy`, [stamp, token, leaseUntil, workspace, stamp])
  if (!job) return false
  try {
    const [snapshot] = await db.query<{id:string}>('SELECT id FROM graph_snapshots WHERE id = ?', [job.snapshot_id])
    if (!snapshot) throw new Error('snapshot_not_found')
    const objects: unknown[] = []
    for (let offset = 0; ; offset += 100) {
      const rows = await db.query<{detail:string}>('SELECT detail FROM snap_objects WHERE snapshot_id = ? ORDER BY ord LIMIT 100 OFFSET ?', [job.snapshot_id, offset])
      objects.push(...rows.map(r => JSON.parse(r.detail)))
      if (rows.length < 100) break
    }
    const output = await evaluate(job.check_id, objects, JSON.parse(job.policy))
    const completed = new Date().toISOString()
    await db.query("UPDATE compliance_runs SET status='completed', result=?, error=NULL, updated_at=?, lease_token=NULL, lease_until=NULL WHERE id=? AND workspace=? AND lease_token=? RETURNING id", [JSON.stringify(output), completed, job.id, workspace, token])
  } catch {
    // Do not store exception messages which could contain collected data or credentials.
    await db.query("UPDATE compliance_runs SET status='failed', error='evaluation_failed', updated_at=?, lease_token=NULL, lease_until=NULL WHERE id=? AND workspace=? AND lease_token=? RETURNING id", [new Date().toISOString(), job.id, workspace, token])
  }
  return true
}
export async function pythonEvaluate(check:string, objects:unknown[], policy:unknown): Promise<unknown> {
  const proc = spawnSync(process.env.AEGI_PYTHON || 'python', [process.env.AEGI_COMPLIANCE_CHECKS_PATH || path.join(ROOT, 'scripts/compliance/checks.py')], {input:JSON.stringify({check,objects,policy}), encoding:'utf8', env:{...process.env, PYTHONUTF8:'1'}, maxBuffer:20*1024*1024, timeout:120_000, windowsHide:true})
  if (proc.status !== 0 || proc.error) throw new Error('evaluation_failed')
  const parsed = JSON.parse(proc.stdout) as {check_version:string;result:unknown}
  return {...(parsed.result as object), check_version:parsed.check_version}
}
async function main() {
  const env = process.argv[2] as TargetEnv, workspace = process.env.AEGI_COMPLIANCE_WORKSPACE || ''
  if (!(env in TARGETS) || !workspacePattern.test(workspace)) throw new Error('usage: worker.ts preview|production; set AEGI_COMPLIANCE_WORKSPACE')
  const db = await openConnection(TARGETS[env])
  const continuous = process.argv.includes('--watch')
  do {
    try {
      const processed = await processOne(db, workspace, pythonEvaluate)
      if (!continuous) console.log(processed ? '검사 요청 처리 완료' : '처리할 검사 요청 없음')
      if (continuous && !processed) await new Promise(resolve => setTimeout(resolve, 5000))
    } catch (error) {
      if (!continuous) throw error
      console.error('검사 대기열에 연결하지 못했습니다. 다시 시도합니다.')
      await new Promise(resolve => setTimeout(resolve, 10000))
    }
  } while (continuous)
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(() => { console.error('검사 작업을 처리하지 못했습니다.'); process.exitCode = 1 })
