import type { GraphStoreV2 } from '../model/graph'
import { evaluateAdminAuth, evaluateAdminPrivilegeAlert, type CompanyPolicy } from './browserChecks'

/**
 * 공개 데모(demo.aegi.site)의 Compliance 검사 API 흉내. 데모에는 검사 서버(server/compliance.ts 의 요청 대기열과 그것을 집어 가는 엔진 실행기)가 없고
 * 공개 접근으로는 회사 기준을 읽고 쓸 수도 없다. 그래서 검사 화면(AdminAuthCheck, AdminPrivilegeAlertCheck)이 부르는 경로를 그대로 받아
 * 같은 검사를 지금 그래프로 바로 돌리고, 회사 기준과 검사 기록은 이 브라우저(localStorage)에만 둔다. 팀 저장소에는 아무것도 쓰지 않는다.
 */
const STORAGE_KEY = 'aegi.compliance.demo-checks.v1'
type Run = { id: string; check_id: string; created_at: string; snapshot: string; status: 'completed'; policy: CompanyPolicy; result: unknown }
type Store = { policies: Record<string, CompanyPolicy>; runs: Run[] }
const CHECKS: Record<string, (objects: Parameters<typeof evaluateAdminAuth>[0], policy: CompanyPolicy) => unknown> = { admin_auth: evaluateAdminAuth, admin_privilege_alert: evaluateAdminPrivilegeAlert }

function load(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Store | null
    if (s && typeof s === 'object' && Array.isArray(s.runs) && s.policies && typeof s.policies === 'object') return s
  } catch { /* 처음부터 */ }
  return { policies: {}, runs: [] }
}
function save(s: Store) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* 저장 못 해도 이 화면에서는 보인다 */ } }

/** 검사 화면의 api(path, body) 와 같은 경로: GET /policy, POST /policy, GET /runs[?check=], POST /runs, GET /runs/:id */
export async function demoComplianceApi<T>(path: string, body: object | undefined, graph: GraphStoreV2, snapshotId?: string): Promise<T> {
  const [route, query] = path.split('?')
  const check = new URLSearchParams(query ?? '').get('check') ?? 'admin_auth'
  const store = load()
  if (route === '/policy') {
    if (body) { store.policies[check] = body as CompanyPolicy; save(store) }
    return { policy: store.policies[check] ?? {} } as T
  }
  if (route === '/runs' && body) {
    const { check: id = 'admin_auth', policy } = body as { check?: string; policy?: CompanyPolicy }
    const evaluate = CHECKS[id]
    if (!evaluate) throw new Error('unknown check')
    const used = policy ?? store.policies[id] ?? {}
    const run: Run = { id: `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, check_id: id, created_at: new Date().toISOString(), snapshot: snapshotId ?? '',
      status: 'completed', policy: used, result: evaluate([...graph.objectsByKey.values()], used) }
    store.runs = [run, ...store.runs].slice(0, 60)
    save(store)
    return run as T
  }
  if (route === '/runs') return { runs: store.runs.filter(r => r.check_id === check).slice(0, 30).map(({ id, created_at, snapshot, status }) => ({ id, created_at, snapshot, status })) } as T
  const one = /^\/runs\/(.+)$/.exec(route)
  if (one) {
    const run = store.runs.find(r => r.id === decodeURIComponent(one[1]))
    if (!run) throw new Error('not_found')
    return run as T
  }
  throw new Error('unknown path')
}
