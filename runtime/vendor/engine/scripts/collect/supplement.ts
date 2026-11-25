/**
 * 수집 앱이 읽지 못하는 Okta 호출을 기존 세팅 자격증명(.env.setup 의 OKTA_API_TOKEN, 슈퍼 관리자)으로 명시적으로 보충한다. GET 만 한다.
 *
 * 보충 호출은 OK-05, 06, 14, 15, 17, 19, 21 이다(사용자 지시. OK-05, 06 은 3회차 조직에서 수집 앱으로 403). 이유: Okta 사용자 정의 관리자 역할에는 스키마·API 서비스
 * 통합 등을 읽는 권한이 없고 읽기 전용 관리자로도 403 이라(Aside 로 콘솔 권한 목록 확인, 2026-10-27), 수집 앱 역할을 올리지 않고 읽는다.
 * 호출 주소·비밀 가리기·params 는 providers/okta.ts 와 같게 둔다 — 정규화가 호출 번호와 params 로 원본을 찾는다.
 *
 * 정규화(npm run normalize, profile-binding)는 `--run` 으로 준 **실행 하나**만 읽는다(runner/input.mjs loadCohort: 증거와 커버리지가 Profile 추출과
 * 같은 실행이어야 한다). 보충 실행을 따로 두면 정규화에 반영되지 않는다. 그래서 `--merge-into <수집 실행 id>` 를 주면 그 실행의 사본에
 * 이 보충의 호출들을 바꿔 넣은 새 실행(`<id>-sup`)을 만든다. 원본 실행은 건드리지 않는다. 호출 전체(목록과 항목)를 다시 읽는 이유다.
 *
 *   npm run collect
 *   npx tsx scripts/collect/supplement.ts --config scripts/collect/collector.config.json --out collected --merge-into <방금 수집 실행 id>
 *   npm run normalize -- --raw collected --run <방금 수집 실행 id>-sup --out <dataset>
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Credentials, loadConfig, loadEnv } from './config'
import { HttpLayer, fetchTransport } from './lib/http'
import { normalizeOktaOrgUrl } from './lib/auth'
import { CollectStore } from './lib/store'
import { Runner, buildUrl, type CallApi, type CallDef } from './lib/runner'
import { sha256Hex } from './lib/sanitize'
import { newRunId } from './run'

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const args = process.argv.slice(2)
  const arg = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1]! : fallback
  const config = loadConfig(path.resolve(root, arg('--config', 'scripts/collect/collector.config.g2.json')))
  const creds = new Credentials(loadEnv(path.resolve(root, '.env.setup')), root)
  const token = creds.get('OKTA_API_TOKEN')
  const org = creds.get('OKTA_ORG_URL')
  if (!token || !org) throw new Error('기존 Okta 세팅 자격증명이 없어 보충할 수 없습니다.')
  const outDir = arg('--out', 'collected-g2')
  const store = new CollectStore(path.resolve(root, outDir), newRunId())
  const runner = new Runner({ store, http: new HttpLayer({ transport: fetchTransport, retryDelayMs: 1000 }), period: { since: config.since, until: new Date().toISOString() }, log: console.log })

  const auth = { ref: 'CRED-OK-SETUP', headers: async () => ({ Authorization: `SSWS ${token}` }) }
  const url = (p: string, query?: Record<string, string | number | undefined>) => buildUrl(normalizeOktaOrgUrl(org) + p, query)
  const get = (api: CallApi, p: string, params: Record<string, unknown> = {}, extra: object = {}) => api.get({ ...extra, url: url(p), auth, params: { ...params, supplemental: true } })
  const list = (api: CallApi, p: string, query: Record<string, string | number | undefined> = {}, params: Record<string, unknown> = {}, items: (b: any) => any[] = b => (Array.isArray(b) ? b : []), extra: object = {}) =>
    api.list({ ...extra, url: url(p, query), auth, paginate: { kind: 'link' }, items, params: { ...params, supplemental: true } })
  const call = (id: string, title: string, run: (api: CallApi) => Promise<void>): CallDef => ({ id, provider: 'okta', title: `${title} (기존 관리자 보충 조회)`, credential: 'CRED-OK-SETUP', run })

  // OK-05·06 보충. 3회차 조직에서 수집 앱(Read-only Administrator + okta.roles.read)으로 IAM 역할·역할 배정이 403 이었다.
  // 호출 주소·params 는 providers/okta.ts 의 OK-05·06 과 같게 둔다. OK-06 이 도는 데 필요한 사용자·그룹·서비스 앱 id 는 기록하지 않고 조회만 한다
  const ids = async (p: string, pick: (x: any) => string | undefined): Promise<string[]> => {
    const out: string[] = []
    let next: string | undefined = url(p, { limit: 200 })
    while (next) {
      const res = await fetch(next, { headers: { Authorization: `SSWS ${token}`, Accept: 'application/json' } })
      if (!res.ok) throw new Error(`${p} ${res.status}`)
      for (const x of (await res.json()) as any[]) { const v = pick(x); if (v) out.push(v) }
      next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1]
    }
    return out
  }
  const calls: CallDef[] = [
    call('OK-05', 'IAM 역할·리소스 세트', async api => {
      await api.optional('iam_roles', () => get(api, '/api/v1/iam/roles'))
      const sets = await api.optional('iam_resource_sets', () => get(api, '/api/v1/iam/resource-sets'))
      for (const st of sets?.['resource-sets'] ?? []) {
        await api.optional('iam_resource_set_resources', () => get(api, `/api/v1/iam/resource-sets/${st.id}/resources`, { resource_set: st.id }))
        await api.optional('iam_resource_set_bindings', () => get(api, `/api/v1/iam/resource-sets/${st.id}/bindings`, { resource_set: st.id }))
      }
    }),
    call('OK-06', '관리자 역할 배정 (사용자·그룹·서비스 앱)과 대상 범위', async api => {
      const assignees = await api.optional('iam_assignees', () => get(api, '/api/v1/iam/assignees/users'))
      const userIds = assignees ? (assignees.value ?? []).map((u: any) => u.id) : await ids('/api/v1/users', u => u?.id)
      for (const id of userIds) {
        for (const r of (await api.optional('user_roles', () => list(api, `/api/v1/users/${id}/roles`, {}, { user: id }))) ?? []) {
          if (r.type !== 'CUSTOM') await api.optional('user_role_targets', () => list(api, `/api/v1/users/${id}/roles/${r.id}/targets/groups`, {}, { user: id, role: r.id }))
        }
      }
      for (const gid of await ids('/api/v1/groups', g => g?.id)) {
        for (const r of (await api.optional('group_roles', () => list(api, `/api/v1/groups/${gid}/roles`, {}, { group: gid }))) ?? []) {
          if (r.type !== 'CUSTOM') await api.optional('group_role_targets', () => list(api, `/api/v1/groups/${gid}/roles/${r.id}/targets/groups`, {}, { group: gid, role: r.id }))
        }
      }
      const clients = await ids('/api/v1/apps', a => (a?.settings?.oauthClient?.application_type === 'service' || a?.credentials?.oauthClient?.token_endpoint_auth_method === 'private_key_jwt') ? a?.credentials?.oauthClient?.client_id : undefined)
      for (const cid of clients) await api.optional('client_roles', () => list(api, `/oauth2/v1/clients/${cid}/roles`, {}, { client: cid }))
    }),
    call('OK-14', '사용자 프로필 스키마', async api => {
      await get(api, '/api/v1/meta/schemas/user/default', { kind: 'user_schema' })
    }),
    call('OK-15', 'API 서비스 통합 인스턴스, 비밀값', async api => {
      const mask = { transform: (b: any) => (Array.isArray(b) ? b.map(({ clientSecret, secret, ...k }: any) => ({ ...k, secret_sha256: (clientSecret || secret) ? sha256Hex(String(clientSecret || secret)) : undefined })) : b) }
      const instances = await list(api, '/integrations/api/v1/api-services', { limit: 200 })
      for (const inst of instances) {
        await api.optional(`api_service_secrets:${inst.id}`, () => list(api, `/integrations/api/v1/api-services/${inst.id}/secrets`, {}, { instance_id: inst.id }, b => (Array.isArray(b) ? b : []), mask))
      }
    }),
    call('OK-17', '이벤트 훅, 인라인 훅, 로그 스트림', async api => {
      await api.optional('event_hooks', () => list(api, '/api/v1/eventHooks', { limit: 200 }, { kind: 'event_hooks' }))
      await api.optional('inline_hooks', () => list(api, '/api/v1/inlineHooks', { limit: 200 }, { kind: 'inline_hooks' }))
      await api.optional('log_streams', () => list(api, '/api/v1/logStreams', { limit: 200 }, { kind: 'log_streams' }))
    }),
    call('OK-19', '프로필 매핑 (식)', async api => {
      const mappings = await list(api, '/api/v1/mappings', { limit: 200 }, { kind: 'list' })
      for (const m of mappings) if (m?.id) await api.optional(`mapping:${m.id}`, () => get(api, `/api/v1/mappings/${m.id}`, { mapping: m.id }))
    }),
    call('OK-21', '보안 이벤트 수신, SSF 송신 스트림, 메일 서버', async api => {
      await api.optional('security_events_providers', () => list(api, '/api/v1/security-events-providers', {}, { kind: 'security_events_providers' }))
      // ssf_streams(/api/v1/ssf/stream)는 OAuth 토큰만 받아 SSWS 로는 401 이고, 일반 수집도 범위 ssf.read 가 설정에 없어 부르지 않는다
      await api.optional('email_servers', () => get(api, '/api/v1/email-servers', { kind: 'email_servers' }, { transform: (b: any) => (Array.isArray(b?.['email-servers']) ? { ...b, 'email-servers': b['email-servers'].map(({ password, ...s }: any) => s) } : b) }))
    }),
  ]

  const run = await runner.runAll(calls, { supplemental: true, source: '.env.setup', calls: calls.map(c => c.id) })
  console.log(`실행 기록: ${outDir}/runs/${run.run_id}.json`)
  const base = arg('--merge-into', '')
  if (base) {
    const out = path.resolve(root, outDir)
    const merged = `${base}-sup`
    const baseRecord = JSON.parse(fs.readFileSync(path.join(out, 'runs', `${base}.json`), 'utf8'))
    if (fs.existsSync(path.join(out, 'runs', `${merged}.json`))) throw new Error(`${merged} 가 이미 있다. 지우고 다시 하거나 다른 수집 실행을 고른다`)
    if (run.calls.some(c => c.completeness === 'failed')) throw new Error('보충에 실패한 호출이 있어 합치지 않는다')
    const swap = new Set(run.calls.map(c => c.call_id))
    // 원본 실행의 raw 를 사본으로 복사하고, 보충하는 호출의 페이지만 보충 실행의 것으로 바꾼다
    fs.cpSync(path.join(out, 'raw', base), path.join(out, 'raw', merged), { recursive: true })
    for (const f of fs.readdirSync(path.join(out, 'raw', merged, 'okta'))) if (swap.has(f.replace(/-\d+\.json$/, ''))) fs.rmSync(path.join(out, 'raw', merged, 'okta', f))
    for (const f of fs.readdirSync(path.join(out, 'raw', run.run_id, 'okta'))) fs.copyFileSync(path.join(out, 'raw', run.run_id, 'okta', f), path.join(out, 'raw', merged, 'okta', f))
    const calls = [...baseRecord.calls.filter((c: any) => !(c.provider === 'okta' && swap.has(c.call_id))), ...run.calls].map((c: any) => ({ ...c, run_id: merged }))
    fs.writeFileSync(path.join(out, 'runs', `${merged}.json`), JSON.stringify({ ...baseRecord, run_id: merged, calls, supplemented_from: { base, supplement: run.run_id, calls: [...swap] } }, null, 2))
    console.log(`합친 실행: ${outDir}/runs/${merged}.json (원본 ${base}, 보충 ${run.run_id}, 바꾼 호출 ${[...swap].join(', ')})`)
  }
  if (run.calls.some(c => c.completeness === 'failed')) process.exitCode = 1
}
main().catch(() => { console.error('Okta 보충 조회 실패, 실행 기록의 사유를 확인하세요.'); process.exitCode = 1 })
