/**
 * 시나리오 봇 Worker 의 D1 로그 (Slack·GitHub API 가 아니라 우리 Worker 의 GET /api/logs/<table>).
 *
 *   SL-12  slash-requests   /devbot·/mfa-reset 요청자(Slack user_id)·채널·결과. 슬래시 명령은 Slack 감사 로그에 안 남는다
 *   GH-18  github-webhooks  조직 웹훅 (push·PAT 요청·member 등). DevBot 커밋은 감사 로그에 안 남아 이것이 주 증거다 (V-08)
 *   D-21   oauth-callbacks  Customer Intake Sync 설치 응답 (웹훅 채널 id, URL 지문)
 *
 * 자격증명: CRED-WK-01 (Worker Secret COLLECTOR_API_TOKEN 과 같은 값, 읽기 전용 API).
 * D1 의 JSON 문자열 열(payload·result_data·raw_response)은 풀어서 정리한다. 명령 인자(text)·커밋 메시지는 지문만,
 * correlation_id 열은 정답 라벨로 옮겨진다.
 */
import { buildUrl, type CallDef } from '../lib/runner'
import { bearerAuth } from '../lib/auth'
import { missingCredential } from '../config'
import type { ProviderContext } from './common'
import { summarizeWorkerSettings, summarizeWorkerSource } from '../lib/worker-definition'

const TABLES: Record<string, { callId: string; title: string }> = {
  'slash-requests': { callId: 'SL-12', title: '봇 슬래시 명령 요청 로그 (D1)' },
  'github-webhooks': { callId: 'GH-18', title: 'GitHub 조직 웹훅 수신 로그 (D1)' },
  'oauth-callbacks': { callId: 'D-21', title: 'Customer Intake Sync 설치 응답 (D1)' },
}

const JSON_COLUMNS = ['payload', 'result_data', 'raw_response']

export function expandJsonColumns(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row }
  for (const col of JSON_COLUMNS) {
    const v = out[col]
    if (typeof v !== 'string') continue
    try { out[col] = JSON.parse(v) } catch { /* JSON 이 아니면 문자열 그대로 (비밀 패턴은 정리 단계가 지운다) */ }
  }
  return out
}

export function workerCalls(ctx: ProviderContext): CallDef[] {
  const { config, creds } = ctx
  const calls: CallDef[] = []
  const cf = config.worker.cloudflare
  if (cf) calls.push({
    id: 'WK-01', provider: 'worker', title: '배포된 Worker 설정·확인된 수신 경로', credential: 'CRED-CF-01',
    unavailable: () => missingCredential(creds, 'CRED-CF-01') ?? (!/^[a-f0-9]{32}$/i.test(cf.accountId) || !/^[A-Za-z0-9_-]{1,63}$/.test(cf.scriptName) ? 'config_invalid:worker.cloudflare' : null),
    run: async api => {
      const auth = bearerAuth('CRED-CF-01', creds.get('CLOUDFLARE_API_TOKEN')!)
      const account = `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/workers`
      const script = `${account}/scripts/${encodeURIComponent(cf.scriptName)}`
      const subdomain: any = await api.get({ url: account + '/subdomain', auth, params: { account: cf.accountId, script: cf.scriptName, kind: 'worker_subdomain' } })
      const enabled: any = await api.get({ url: script + '/subdomain', auth, params: { account: cf.accountId, script: cf.scriptName, kind: 'worker_availability' } })
      let verified = false
      try { const url = new URL(config.worker.baseUrl); verified = url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname === '/' && url.hostname === `${cf.scriptName}.${subdomain?.result?.subdomain}.workers.dev` && enabled?.result?.enabled === true } catch { /* invalid configured URL */ }
      const params = { account: cf.accountId, script: cf.scriptName, base_url: verified ? config.worker.baseUrl : null, ingress_host_verified: verified }
      await api.get({ url: script + '/settings', auth, params: { ...params, kind: 'worker_settings' }, transform: summarizeWorkerSettings })
      if (!verified) { api.partial('worker_ingress_host_unverified'); return }
      const source: any = await api.get({ url: script + '/content/v2', auth, params: { ...params, kind: 'worker_source' }, transform: body => summarizeWorkerSource(body, config.worker.baseUrl) })
      if (source?.status !== 'parsed_literal_routes' || !source?.routes?.length) api.partial('worker_literal_routes_unresolved')
    },
  })
  return [...calls, ...config.worker.tables.map(table => {
    const meta = TABLES[table] ?? { callId: `WK-${table}`, title: `Worker 로그 ${table}` }
    return {
      id: meta.callId,
      provider: 'worker' as const,
      title: meta.title,
      credential: 'CRED-WK-01',
      unavailable: () => missingCredential(creds, 'CRED-WK-01') ?? (config.worker.baseUrl ? null : 'config_missing:worker.baseUrl'),
      run: async api => {
        const stream = `worker.${table}`
        const sinceId = api.cursor(stream)?.cursor ?? '0'
        const rows = await api.list({
          url: buildUrl(`${config.worker.baseUrl.replace(/\/$/, '')}/api/logs/${table}`, { since_id: sinceId, limit: 500 }),
          auth: bearerAuth('CRED-WK-01', creds.get('WORKER_COLLECTOR_TOKEN')!),
          paginate: { kind: 'd1' },
          items: b => b?.results ?? [],
          transform: (b: any) => (b && Array.isArray(b.results) ? { ...b, results: b.results.map(expandJsonColumns) } : b),
          params: { table, since_id: sinceId },
        })
        const lastId = rows.length ? String(rows[rows.length - 1].id) : sinceId
        const lastAt = rows.length ? String(rows[rows.length - 1].created_at ?? rows[rows.length - 1].received_at ?? '') || null : api.cursor(stream)?.last_event_at ?? null
        api.setCursor(stream, { cursor: lastId, last_event_at: lastAt })
      },
    }
  })]
}
