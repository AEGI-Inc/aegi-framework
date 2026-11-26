import type { D1Like } from './exceptions'
import { currentSnapshotId } from './snapshotGraph'

type Json = (status: number, body: Record<string, unknown>) => Response
const CHECKS = new Set(['admin_auth', 'admin_privilege_alert'])
const ID = /^[a-zA-Z0-9_-]{1,80}$/
function validatePolicy(value: unknown): value is { require_mfa?: boolean } {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => k === 'require_mfa') && (!('require_mfa' in value) || typeof (value as {require_mfa?:unknown}).require_mfa === 'boolean')
}
export async function compliance(request: Request, route: string, db: D1Like, workspace: string, json: Json, now: number): Promise<Response> {
  const path = route.split('/').slice(1)
  const stamp = new Date(now).toISOString()
  if (!ID.test(workspace)) return json(503, {error:'workspace_not_configured'})
  if (path[0] === 'policy' && path.length === 1) {
    const check = new URL(request.url).searchParams.get('check') ?? 'admin_auth'
    if (!CHECKS.has(check)) return json(400, {error:'invalid_check'})
    if (request.method === 'GET') {
      const row = await db.prepare('SELECT policy, updated_at FROM compliance_policies WHERE workspace = ? AND check_id = ?').bind(workspace, check).first<{policy:string;updated_at:string}>()
      return json(200, {policy:row ? JSON.parse(row.policy) : {}, updated_at:row?.updated_at ?? null})
    }
    if (request.method === 'POST') {
      let body: unknown
      try { body = await request.json() } catch { return json(400, {error:'invalid_body'}) }
      if (!validatePolicy(body) || (check === 'admin_privilege_alert' && Object.keys(body).length)) return json(400, {error:'invalid_policy'})
      await db.prepare('INSERT INTO compliance_policies(workspace, check_id, policy, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace, check_id) DO UPDATE SET policy=excluded.policy, updated_at=excluded.updated_at').bind(workspace, check, JSON.stringify(body), stamp).run()
      return json(200, {policy:body, updated_at:stamp})
    }
  }
  if (path[0] === 'runs') {
    if (request.method === 'GET' && path.length === 1) {
      const check = new URL(request.url).searchParams.get('check') ?? 'admin_auth'
      if (!CHECKS.has(check)) return json(400, {error:'invalid_check'})
      const rows = await db.prepare('SELECT id, created_at, snapshot_id AS snapshot, status FROM compliance_runs WHERE workspace = ? AND check_id = ? ORDER BY created_at DESC LIMIT 30').bind(workspace, check).all()
      return json(200, {runs:rows.results})
    }
    if (request.method === 'GET' && path.length === 2 && ID.test(path[1])) {
      const row = await db.prepare('SELECT id, created_at, snapshot_id AS snapshot, status, policy, result, error FROM compliance_runs WHERE workspace = ? AND id = ?').bind(workspace, path[1]).first<{id:string;policy:string;result:string|null}>()
      return row ? json(200, {...row, policy:JSON.parse(row.policy), result:row.result ? JSON.parse(row.result) : null}) : json(404, {error:'not_found'})
    }
    if (request.method === 'POST' && path.length === 1) {
      let body: unknown
      try { body = await request.json() } catch { return json(400, {error:'invalid_body'}) }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['check', 'policy'].includes(k)) || !CHECKS.has((body as {check:string}).check) || !validatePolicy((body as {policy:unknown}).policy)) return json(400, {error:'invalid_check'})
      const id = crypto.randomUUID(), check = (body as {check:string}).check, policy = (body as {policy:unknown}).policy
      if (check === 'admin_privilege_alert' && Object.keys(policy as object).length) return json(400, {error:'invalid_policy'})
      // Record the snapshot this deployment reads (graph_head current, or its pinned snapshot) with the policy in the queued request.
      const snapshotId = await currentSnapshotId(db)
      if (!snapshotId) return json(409, {error:'snapshot_not_available'})
      const created = await db.prepare("INSERT INTO compliance_runs(id, workspace, check_id, status, created_at, updated_at, snapshot_id, policy) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?) RETURNING id, created_at, snapshot_id AS snapshot, status").bind(id, workspace, check, stamp, stamp, snapshotId, JSON.stringify(policy)).first()
      return created ? json(202, created) : json(409, {error:'snapshot_not_available'})
    }
  }
  return json(404, {error:'not_found'})
}
