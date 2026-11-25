/**
 * 로컬 런타임 시험: Splunk 연결 설정, 출처 설정 검사, Splunk 검색 REST 요청 모양, 샘플 게시, Timeline·AI 검색 서비스, 대시보드 API.
 * Splunk 는 REST 응답을 흉내 내는 Wire 로 대신한다(요청 경로, 토큰 헤더, SPL 을 확인). 실제 Splunk 연결은 `aegi splunk` 로 본다.
 * 시험은 임시 폴더의 데이터만 쓴다.
 */
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

process.env.AEGI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-solution-test-'))
process.env.AEGI_ENV_FILE = path.join(process.env.AEGI_DATA_DIR, '.env')
const SOURCES = path.join(process.env.AEGI_DATA_DIR, 'splunk.sources.json')
fs.copyFileSync(path.join(import.meta.dirname, '..', 'splunk.sources.example.json'), SOURCES)

const { openDb, migrate } = await import('../src/db.ts')
const { publishEmpty, publishSample } = await import('../src/pipeline.ts')
const { createLogServices, WORKSPACE_ID } = await import('../src/logs.ts')
const { splunkSettings, loadWorkspace, checkSplunk } = await import('../src/splunk.ts')
const { startServer } = await import('../src/server.ts')
const { handleOAuthCallback, startOAuth, testCredentialConnection } = await import('../src/oauth.ts')
const { collectorConfig, missingIdentifiers } = await import('../src/collectorConfig.ts')
const { failedDetectors, findPython, judgeStandards } = await import('../src/standards.ts')
const { logCatalog, runLogTool } = await import('../vendor/dashboard/server/assistant/logTools.ts')
type Wire = import('../vendor/engine/scripts/stream/splunk/transport.ts').Wire
type WireRequest = import('../vendor/engine/scripts/stream/splunk/transport.ts').WireRequest

const ENV = { SPLUNK_URL: 'https://splunk.example.com:8089', SPLUNK_TOKEN: 'search-token' }

/**
 * Splunk 검색 REST 흉내. 검색 작업을 만들면 SPL 의 index·sourcetype 으로 이벤트를 고르고, 결과 조회에 돌려준다.
 * 이벤트 조회(fields _time aegi_indextime _raw)는 원문 행을, tstats 는 출처별 수를, 그 밖(AI 집계)은 정해 둔 집계 행을 준다.
 */
function fakeSplunk(events: Array<{ index: string; sourcetype: string; time: number; raw: object }>) {
  const requests: WireRequest[] = []
  const jobs = new Map<string, Array<Record<string, string>>>()
  const wire: Wire = async req => {
    requests.push(req)
    const url = new URL(req.url)
    if (req.method === 'POST' && url.pathname === '/services/search/jobs') {
      const spl = new URLSearchParams(req.body).get('search') ?? ''
      const sid = `sid${jobs.size + 1}`
      if (spl.startsWith('| tstats')) {
        jobs.set(sid, [{ index: 'aegi_okta', sourcetype: 'okta:im2:log', count: String(events.filter(e => e.index === 'aegi_okta').length), latest: String(Math.max(...events.map(e => e.time))) }])
      } else if (spl.includes('fields _time aegi_indextime _raw')) {
        const index = /index=(\S+)/.exec(spl)?.[1], sourcetype = /sourcetype="([^"]+)"/.exec(spl)?.[1]
        jobs.set(sid, events.filter(e => e.index === index && e.sourcetype === sourcetype).map(e => ({ _time: String(e.time), aegi_indextime: String(e.time + 5), _raw: JSON.stringify(e.raw) })))
      } else {
        jobs.set(sid, [{ eventType: 'user.mfa.factor.reset_all', 'actor.id': 'OKTA-CLIENT-MFARESET', count: '1' }])
      }
      return { status: 201, body: JSON.stringify({ sid }) }
    }
    const sid = /jobs\/([^/]+)/.exec(url.pathname)?.[1] ?? ''
    if (req.method === 'GET' && url.pathname.endsWith('/results')) {
      const rows = jobs.get(sid) ?? []
      const offset = Number(url.searchParams.get('offset')), count = Number(url.searchParams.get('count'))
      return { status: 200, body: JSON.stringify({ preview: false, results: rows.slice(offset, offset + count) }) }
    }
    if (req.method === 'GET') return { status: 200, body: JSON.stringify({ entry: [{ content: { dispatchState: 'DONE', isDone: true, isFailed: false, resultCount: (jobs.get(sid) ?? []).length } }] }) }
    if (req.method === 'DELETE') return { status: 200, body: '{}' }
    return { status: 400, body: 'unexpected' }
  }
  return { wire, requests }
}

test('Splunk 연결 설정: 없으면 끄고, https 와 토큰을 요구하고, 인증서 확인 방법을 고른다', () => {
  assert.equal(splunkSettings({}), null)
  assert.throws(() => splunkSettings({ SPLUNK_URL: 'http://splunk:8089', SPLUNK_TOKEN: 'x' }), /https/)
  assert.throws(() => splunkSettings({ SPLUNK_URL: 'https://splunk:8089' }), /SPLUNK_TOKEN/)
  const s = splunkSettings({ ...ENV, SPLUNK_URL: 'https://splunk.example.com:8089/ignored/path' })!
  assert.equal(s.searchBase, 'https://splunk.example.com:8089')
  assert.equal(s.tls.kind, 'system')
  assert.equal(s.sourcesFile, SOURCES)
  assert.equal(splunkSettings({ ...ENV, SPLUNK_TLS_SHA256: 'AB:CD' })!.tls.kind, 'fingerprint')
  assert.equal(splunkSettings({ ...ENV, SPLUNK_CA_FILE: 'ca.pem' })!.tls.kind, 'ca')
})

test('출처 설정: 예시 파일과 엔진 Connector 형식을 읽고, tenant 격리 없는 출처는 거절한다', () => {
  assert.equal(loadWorkspace(SOURCES).sources.length, 8)
  const dir = process.env.AEGI_DATA_DIR!
  const engineForm = path.join(dir, 'engine-form.json')
  fs.writeFileSync(engineForm, JSON.stringify({ workspaces: [{ id: 'team', policyVersion: 'v7', sources: [{ ref: 'okta', provider: 'okta', index: 'sec_okta', sourcetype: 'OktaIM2:log', isolation: { field: 'tenant', value: 'acme' }, fields: { event_type: 'eventType' } }] }] }))
  const w = loadWorkspace(engineForm)
  assert.equal(w.id, WORKSPACE_ID)
  assert.equal(w.policyVersion, 'v7')
  const bad = path.join(dir, 'bad.json')
  fs.writeFileSync(bad, JSON.stringify({ sources: [{ ref: 'okta', provider: 'okta', index: 'sec_okta', sourcetype: 'x', isolation: {}, fields: { event_type: 'eventType' } }] }))
  assert.throws(() => loadWorkspace(bad), /tenant_isolation_required/)
  assert.throws(() => loadWorkspace(path.join(dir, 'none.json')), /출처 설정이 없다/)
})

test('수집 설정: .env 식별값으로 만든다', () => {
  const c = collectorConfig({ GITHUB_ORG: 'acme', OKTA_ORG_URL: 'https://acme.okta.com', SALESFORCE_INSTANCE_URL: 'https://acme.my.salesforce.com' }, new Date('2026-11-01T00:00:00Z'))
  assert.equal(c.github.org, 'acme')
  assert.equal(c.okta.orgHost, 'acme.okta.com')
  assert.equal(c.salesforce?.instanceHost, 'acme.my.salesforce.com')
  assert.equal(c.since, '2026-10-02T00:00:00Z')
  assert.equal(c.atlassian, undefined)
  assert.deepEqual(missingIdentifiers({ GITHUB_OWNER_TOKEN: 'x' }), ['GITHUB_ORG (GitHub 조직 login)'])

  // GWS DWD 선택 scope: SA 키가 있고 GWS_GRANTED_SCOPES 가 비어 있으면 16개 기본값 (3개 + 확장 13개)
  const gwsDefaultScopes = [
    'script.deployments.readonly',
    'gmail.settings.basic',
    'apps.groups.settings',
    'admin.datatransfer.readonly',
    'admin.directory.device.chromebrowsers.readonly',
    'admin.directory.device.mobile.readonly',
    'admin.directory.resource.calendar.readonly',
    'apps.alerts',
    'calendar.readonly',
    'chrome.management.appdetails.readonly',
    'chrome.management.profiles.readonly',
    'chrome.management.reports.readonly',
    'chrome.management.telemetry.readonly',
    'cloud-identity.devices.readonly',
    'drive.labels.readonly',
    'ediscovery.readonly',
    'apps.licensing',
    'gmail.labels',
    'drive.apps.readonly',
    'drive.readonly',
    'admin.chrome.printers.readonly',
    'chrome.management.connectors.readonly',
    'admin.directory.device.chromeos.readonly',
  ]
  const cGwsKey = collectorConfig({ GWS_COLLECTOR_SA_KEY: '{"type":"service_account"}' })
  assert.deepEqual(cGwsKey.gws?.grantedScopes, gwsDefaultScopes)
  const cGwsKeyFile = collectorConfig({ GWS_COLLECTOR_SA_KEY_FILE: 'gws-sa.json' })
  assert.deepEqual(cGwsKeyFile.gws?.grantedScopes, gwsDefaultScopes)
  assert.equal(c.okta.policyTypes.length, 8)
  assert.ok(c.okta.policyTypes.includes('IDP_DISCOVERY'))
  assert.ok(c.okta.policyTypes.includes('PROFILE_ENROLLMENT'))

  // GWS_GRANTED_SCOPES 가 명시되어 있으면 그것을 쓴다
  const cGwsCustom = collectorConfig({
    GWS_COLLECTOR_SA_KEY: '{"type":"service_account"}',
    GWS_GRANTED_SCOPES: 'https://www.googleapis.com/auth/admin.directory.user.readonly, apps.groups.settings',
  })
  assert.deepEqual(cGwsCustom.gws?.grantedScopes, ['admin.directory.user.readonly', 'apps.groups.settings'])

  // SA 키도 없고 GWS_GRANTED_SCOPES 도 없으면 빈 배열
  const cGwsNone = collectorConfig({})
  assert.deepEqual(cGwsNone.gws?.grantedScopes, [])
})

test('샘플 게시, Splunk REST 로 Timeline·AI 검색·연결 점검, 대시보드 API', async () => {
  const local = openDb(path.join(process.env.AEGI_DATA_DIR!, 'aegi.sqlite'))
  await migrate(local)
  const published = await publishSample(local, () => undefined)
  assert.ok(published.findings > 0)

  // Splunk 설정이 없으면 서비스를 만들지 않고, 대시보드는 로그 기능을 끈다
  assert.equal(createLogServices(local, {}), null)
  const off = await startServer({ host: '127.0.0.1', port: 0, env: {}, local, logs: null })
  try {
    const port = (off.address() as { port: number }).port
    const timeline = await fetch(`http://127.0.0.1:${port}/api/measured/graph/events?from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z`)
    assert.equal(timeline.status, 503)
    assert.equal((await timeline.json() as { error: string }).error, 'splunk_not_configured')
  } finally { off.close() }

  const now = Math.floor(Date.now() / 1000)
  const okta = (time: number, eventType: string, target: string) => ({ index: 'aegi_okta', sourcetype: 'okta:im2:log', time,
    raw: { uuid: `u-${time}`, published: new Date(time * 1000).toISOString(), eventType, actor: { id: 'OKTA-U-UA', type: 'User', alternateId: 'user-a@aegi.site' }, outcome: { result: 'SUCCESS' }, target: [{ id: target, type: 'User' }] } })
  const fake = fakeSplunk([okta(now - 3600, 'user.mfa.factor.reset_all', 'OKTA-U-TESTTARGET'), okta(now - 7200, 'user.session.start', 'OKTA-U-UB'),
    { index: 'aegi_github', sourcetype: 'github:cloud:audit', time: now - 1800, raw: { _document_id: 'g1', '@timestamp': (now - 1800) * 1000, action: 'git.push', actor: 'user-a', actor_id: 'GH-U-UA', org: 'aegi-inc' } }])
  const logs = createLogServices(local, ENV, { wire: fake.wire })!
  assert.ok(logs)

  // 모든 요청이 설정한 주소의 검색 REST 로, 검색 토큰을 달고 나간다
  const sentTo = () => {
    for (const r of fake.requests) {
      assert.ok(r.url.startsWith('https://splunk.example.com:8089/services/search/'), r.url)
      assert.equal(r.headers.Authorization, 'Bearer search-token')
    }
  }

  const check = await checkSplunk(logs.transport, logs.workspace)
  assert.equal(check.ok, true, check.error)
  assert.equal(check.sources.find(s => s.ref === 'okta-main')?.events, 2)
  assert.equal(check.sources.find(s => s.ref === 'github-main')?.events, 0)
  assert.match(new URLSearchParams(fake.requests[0]!.body).get('search')!, /index="aegi_okta" sourcetype="okta:im2:log"/)

  const scope = { workspace: WORKSPACE_ID, principal: 'a'.repeat(64), policyVersion: logs.workspace.policyVersion }
  const to = new Date(Math.ceil(Date.now() / 300_000) * 300_000).toISOString(), from = new Date(Date.now() - 7 * 86400_000).toISOString()

  // Timeline: 엔진 EventService 가 출처마다 Splunk 검색 작업을 만들고 로그 캐시에 쓴다
  const started = await logs.relay.request({ action: 'events', scope, waitSeconds: 10, events: { from, to } }, 20_000)
  assert.equal(started.status, 200, JSON.stringify(started.body))
  assert.equal(started.body.state, 'complete', JSON.stringify(started.body))
  const searched = fake.requests.filter(r => r.method === 'POST').map(r => new URLSearchParams(r.body).get('search')!)
  assert.ok(searched.some(s => s.startsWith('search index=aegi_slack sourcetype="slack:audit"')), '출처 설정의 index·sourcetype 으로 검색한다')
  const rows = local.db.prepare('SELECT provider, COUNT(*) AS n FROM log_event GROUP BY provider').all() as Array<{ provider: string; n: number }>
  assert.deepEqual(rows.map(r => `${r.provider}:${r.n}`).sort(), ['github:1', 'okta:2'])
  const resolved = local.db.prepare(`SELECT COUNT(*) AS n FROM log_event WHERE object_keys LIKE '%OKTA-U-TESTTARGET%'`).get() as { n: number }
  assert.ok(resolved.n >= 1, 'Splunk 이벤트가 그래프 객체로 이어진다')

  // AI 로그 도구(대시보드 logTools → 엔진 QueryService): 출처 목록, 집계, 금지 명령
  const toolDeps = { transport: { namespace: 'local', request: (r: never, ms: number) => logs.relay.request(r, ms) }, db: local.d1, scope }
  assert.match(String(await logCatalog(toolDeps)), /okta-main/)
  const counted = await runLogTool('search_logs', { sourceRefs: ['okta-main'], spl: '| where eventType="user.mfa.factor.reset_all" | stats count by actor.id', from, to }, toolDeps)
  assert.equal(counted.facts[0]?.data?.error, undefined, JSON.stringify(counted.facts[0]))
  assert.match(JSON.stringify(counted.facts), /OKTA-CLIENT-MFARESET/)
  const lastSearch = fake.requests.filter(r => r.method === 'POST').map(r => new URLSearchParams(r.body).get('search')!).at(-1)!
  assert.match(lastSearch, /index=aegi_okta sourcetype="okta:im2:log".*where eventType="user\.mfa\.factor\.reset_all"/)
  const rejected = await runLogTool('search_logs', { sourceRefs: ['okta-main'], spl: '| collect index=x', from, to }, toolDeps)
  assert.equal(rejected.facts[0]?.data?.error, 'spl_rejected')
  sentTo()

  // 대시보드 API: 로그인 없이 데이터셋, Timeline(로그 캐시)
  const server = await startServer({ host: '127.0.0.1', port: 0, env: ENV, local, logs })
  const port = (server.address() as { port: number }).port
  try {
    const dataset = await fetch(`http://127.0.0.1:${port}/api/measured/dataset-v2`)
    assert.equal(dataset.status, 200)
    const timeline = await fetch(`http://127.0.0.1:${port}/api/measured/graph/events?from=${from}&to=${to}`)
    const body = await timeline.json() as { state: string }
    assert.equal(timeline.status, 200, JSON.stringify(body))
    assert.equal(body.state, 'complete')
    const index = await fetch(`http://127.0.0.1:${port}/graph`)
    assert.match(await index.text(), /<div id="root">/)
  } finally {
    server.close()
    local.close()
  }
})


test('OAuth PKCE 연결·취소 시 .env 무오염·state 단일 소모·허용 키 화이트리스트·비밀값 비노출', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-oauth-flow-'))
  const envFile = process.env.AEGI_ENV_FILE!
  fs.writeFileSync(envFile, 'OKTA_ORG_URL=https://initial.okta.com\n', 'utf8')
  const env: Record<string, string> = { OKTA_ORG_URL: 'https://initial.okta.com' }
  const local = openDb(path.join(dir, 'oauth.sqlite'))
  await migrate(local)

  const fakeRefreshToken = ['rt', 'secret', 'okta', '99999'].join('-')
  const rotatedRefreshToken = ['rt', 'rotated', 'okta', '88888'].join('-')
  let tokenCallCount = 0

  const oauthTransport = async (req: { method: string; url: string; headers: Record<string, string>; body?: string }) => {
    const u = new URL(req.url)
    if (req.method === 'POST' && u.pathname === '/oauth2/v1/token') {
      tokenCallCount++
      const params = new URLSearchParams(req.body ?? '')
      if (params.get('grant_type') === 'authorization_code') {
        assert.ok(params.get('code_verifier'), 'PKCE code_verifier 가 포함되어야 한다')
        return {
          status: 200,
          headers: {},
          body: {
            access_token: 'acc-tok-1',
            refresh_token: fakeRefreshToken,
            expires_in: 3600,
            scope: 'openid offline_access okta.orgs.read okta.users.read',
          },
        }
      }
      if (params.get('grant_type') === 'refresh_token') {
        assert.equal(params.get('refresh_token'), fakeRefreshToken)
        return {
          status: 200,
          headers: {},
          body: {
            access_token: 'acc-tok-2',
            refresh_token: rotatedRefreshToken,
            expires_in: 3600,
            scope: 'okta.orgs.read okta.users.read',
          },
        }
      }
    }
    if (req.method === 'GET' && u.pathname === '/api/v1/org') {
      return { status: 200, headers: {}, body: { id: '00o1', subdomain: 'trial' } }
    }
    return { status: 404, headers: {}, body: { error: 'not_found' } }
  }

  let releaseCollect!: () => void
  const collectGate = new Promise<void>(resolve => { releaseCollect = resolve })

  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    env,
    local,
    logs: null,
    oauthTransport,
    collectRunner: async () => {
      await collectGate
      // 자식 프로세스가 수집 중 갱신 토큰을 회전시켜 디스크 .env 에 기록한 상황 모사
      fs.writeFileSync(
        envFile,
        fs.readFileSync(envFile, 'utf8').replace(rotatedRefreshToken, 'rt-child-rotated-77777'),
        'utf8',
      )
      return { findings: 1 }
    },
  })
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`

  try {
    // 1. 포트 변경 감지 시험 (5199가 아닌 임의 포트)
    const tokStatus1 = await (await fetch(`${base}/__aegi/local-token`)).json() as {
      configured: Record<string, boolean>
      hints: Record<string, string>
      port: number
      server_boot_id: string
      redirectUri: string
      portWarning: string | null
    }
    assert.equal(tokStatus1.port, port)
    assert.match(tokStatus1.server_boot_id, /^[0-9a-f]{32}$/)
    assert.equal(tokStatus1.redirectUri, `http://127.0.0.1:${port}/__aegi/oauth/callback`)
    assert.match(tokStatus1.portWarning ?? '', new RegExp(`현재 포트\\(${port}\\)`))

    // 2. ALLOWED_ENV_KEYS 화이트리스트 시험: AEGI_HOST, AEGI_PASSWORD 등 시스템 키 거부
    const badKeyRes = await fetch(`${base}/__aegi/local-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { AEGI_HOST: '0.0.0.0', AEGI_PASSWORD: 'hacked', AEGI_DEMO_PASSWORD: 'hacked' } }),
    })
    assert.equal(badKeyRes.status, 400)
    const badKeyBody = await badKeyRes.json() as { error: string }
    assert.match(badKeyBody.error, /^key_not_allowed:AEGI_/)
    assert.equal(env.AEGI_HOST, undefined)

    // 3. OAuth 시작 시 동의 완료 전에는 .env 를 오염시키지 않는지 확인
    const start1 = await fetch(`${base}/__aegi/oauth/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'okta',
        orgUrl: 'https://unverified-draft.okta.com',
        clientId: 'okta-test-client-id',
        scopes: ['okta.orgs.read', 'okta.users.read'],
      }),
    })
    assert.equal(start1.status, 200)
    const start1Body = await start1.json() as { authorizeUrl: string; state: string; redirectUri: string }
    assert.equal(start1Body.redirectUri, `http://127.0.0.1:${port}/__aegi/oauth/callback`, '표준 /__aegi/oauth/callback 경로를 쓴다')
    assert.equal(env.OKTA_ORG_URL, 'https://initial.okta.com', '동의 완료 전에는 기존 .env 값을 덮어쓰지 않는다')
    assert.ok(!fs.readFileSync(envFile, 'utf8').includes('unverified-draft.okta.com'))

    // 4. 범위 미부여 오류(invalid_scope) 시험 + 실패 시에도 state 즉시 소모 확인
    const scopeErrRes = await fetch(`${base}/__aegi/oauth/callback?state=${encodeURIComponent(start1Body.state)}&error=invalid_scope&error_description=The+requested+scope+is+invalid`)
    assert.equal(scopeErrRes.status, 400)
    const scopeErrHtml = await scopeErrRes.text()
    assert.match(scopeErrHtml, /Okta API Scopes/)
    assert.equal(env.OKTA_ORG_URL, 'https://initial.okta.com', '오류 콜백 시에도 .env 가 오염되지 않는다')

    // 같은 state 재시도 시 이미 소모되어 거부됨
    const replayAfterErr = await fetch(`${base}/__aegi/oauth/callback?state=${encodeURIComponent(start1Body.state)}&code=any-code`)
    assert.equal(replayAfterErr.status, 400)
    assert.match(await replayAfterErr.text(), /OAuth 요청\(state\)이 유효하지 않거나 만료/)

    // 5. 정상 OAuth 동의 및 토큰 교환 + state 재전송 차단 + 비밀값 비노출 확인
    const start2 = await fetch(`${base}/__aegi/oauth/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'okta',
        orgUrl: 'https://trial-0000004.okta.com',
        clientId: 'okta-test-client-id',
        scopes: ['okta.orgs.read', 'okta.users.read'],
      }),
    })
    const start2Body = await start2.json() as { state: string }
    const okCb = await fetch(`${base}/__aegi/oauth/callback?state=${encodeURIComponent(start2Body.state)}&code=valid-auth-code`)
    assert.equal(okCb.status, 200)
    const okCbHtml = await okCb.text()
    assert.match(okCbHtml, /OAuth 연결 완료/)
    assert.ok(okCbHtml.includes( `http://127.0.0.1:${port}`), 'postMessage targetOrigin 은 정확한 로컬 origin 이어야 한다')
    assert.ok(!okCbHtml.includes(fakeRefreshToken), '콜백 HTML 에도 토큰 원문이 노출되면 안 된다')

    // 성공한 state 재사용 차단 확인
    const replayAfterOk = await fetch(`${base}/callback?state=${encodeURIComponent(start2Body.state)}&code=valid-auth-code`)
    assert.equal(replayAfterOk.status, 400)

    // GET /__aegi/local-token 과 /__aegi/collector-status 에 토큰 원문이 절대 포함되지 않고 ready: true 인지 확인
    const tokStatus2Res = await fetch(`${base}/__aegi/local-token`)
    const tokStatus2Text = await tokStatus2Res.text()
    assert.ok(!tokStatus2Text.includes(fakeRefreshToken), 'local-token 응답에 토큰 원문이 나가면 안 된다')
    const tokStatus2 = JSON.parse(tokStatus2Text) as { configured: Record<string, boolean> }
    assert.equal(tokStatus2.configured.OKTA_COLLECTOR_REFRESH_TOKEN, true)
    assert.equal(tokStatus2.hints.OKTA_SCOPES, 'okta.orgs.read,okta.users.read')

    const colStatusRes = await fetch(`${base}/__aegi/collector-status`)
    const colStatusText = await colStatusRes.text()
    assert.ok(!colStatusText.includes(fakeRefreshToken), 'collector-status 응답에 토큰 원문이 나가면 안 된다')
    const colStatus = JSON.parse(colStatusText) as { credentials: Array<{ id: string; ready: boolean }> }
    assert.equal(colStatus.credentials.find(c => c.id === 'CRED-OK-01')?.ready, true)

    // 6. 갱신 토큰 회전(Refresh Token Rotation) 시험: 연결 확인 호출 시 refresh_token 교환 + 새 토큰 원자적 저장
    const checkRes = await fetch(`${base}/__aegi/local-token-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentialId: 'CRED-OK-01', values: {} }),
    })
    assert.equal(checkRes.status, 200)
    const checkBody = await checkRes.json() as { ok: boolean; detail: string }
    assert.equal(checkBody.ok, true, checkBody.detail)
    assert.equal(tokenCallCount, 2)
    assert.equal(env.OKTA_COLLECTOR_REFRESH_TOKEN, rotatedRefreshToken)
    assert.ok(fs.readFileSync(envFile, 'utf8').includes(rotatedRefreshToken))

    // 7. 수집 중 재연결·토큰 덮어쓰기 차단(409 Conflict) 및 수집 종료 후 디스크 .env 재동기화 시험
    const collectPromise = fetch(`${base}/__aegi/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'okta' }),
    })
    // 수집이 시작될 때까지 잠시 대기
    await new Promise(r => setTimeout(r, 30))

    const concurrentOAuth = await fetch(`${base}/__aegi/oauth/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'okta', orgUrl: 'https://trial.okta.com', clientId: 'c', scopes: ['okta.orgs.read'] }),
    })
    assert.equal(concurrentOAuth.status, 409)

    const concurrentWrite = await fetch(`${base}/__aegi/local-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { OKTA_ORG_URL: 'https://other.okta.com' } }),
    })
    assert.equal(concurrentWrite.status, 409)

    const concurrentCollect = await fetch(`${base}/__aegi/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'okta' }),
    })
    assert.equal(concurrentCollect.status, 409)

    releaseCollect()
    const collectDone = await collectPromise
    assert.equal(collectDone.status, 202)
    for (let i = 0; i < 50; i++) {
      const st = await (await fetch(`${base}/__aegi/collect-status`)).json() as { state: string }
      if (st.state === 'done') break
      await new Promise(r => setTimeout(r, 20))
    }
    assert.equal(env.OKTA_COLLECTOR_REFRESH_TOKEN, 'rt-child-rotated-77777', '자식 수집 프로세스가 회전시킨 토큰이 부모 서버 메모리에 반영되어야 한다')
  } finally {
    server.close()
    local.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Salesforce OAuth 는 주소 없이 시작하면 login.salesforce.com 으로 보내고 토큰 응답의 instance_url 을 조직 주소로 저장한다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-sf-oauth-'))
  const env: Record<string, string> = { SALESFORCE_INSTANCE_URL: 'https://previous.my.salesforce.com' }
  const started = startOAuth({ provider: 'salesforce', scopes: ['api', 'refresh_token'] }, { port: 5199, env })
  const authorize = new URL(started.authorizeUrl)
  assert.equal(authorize.origin, 'https://login.salesforce.com', '저장된 이전 조직 주소가 아니라 공통 로그인 주소로 간다')
  assert.equal(authorize.pathname, '/services/oauth2/authorize')

  const tokenUrls: string[] = []
  const outcome = await handleOAuthCallback(new URLSearchParams({ state: started.state, code: 'sf-code' }), {
    port: 5199,
    env,
    envFile: path.join(dir, '.env'),
    transport: async request => {
      tokenUrls.push(request.url)
      return { status: 200, headers: {}, body: { access_token: 'sf-access', refresh_token: 'sf-refresh', instance_url: 'https://acme.my.salesforce.com/' } }
    },
  })
  assert.equal(outcome.ok, true)
  assert.deepEqual(tokenUrls, ['https://login.salesforce.com/services/oauth2/token'])
  assert.equal(env.SALESFORCE_INSTANCE_URL, 'https://acme.my.salesforce.com')

  const explicit = startOAuth({ provider: 'salesforce', orgUrl: 'https://test.salesforce.com', scopes: ['api'] }, { port: 5199, env })
  assert.equal(new URL(explicit.authorizeUrl).origin, 'https://test.salesforce.com', '주소를 넣으면 그 주소(Sandbox 등)로 간다')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('Atlassian OAuth 는 고객 앱 Client ID·Secret 으로 토큰 교환을 성공한다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-at-oauth-'))
  const env: Record<string, string> = {}
  assert.throws(
    () => startOAuth({ provider: 'atlassian', scopes: ['read:jira-user', 'offline_access'] }, { port: 5199, env }),
    { code: 'client_id_required' },
  )
  const started = startOAuth(
    {
      provider: 'atlassian',
      clientId: 'at-custom-client-id',
      clientSecret: 'at-custom-client-secret',
      scopes: ['read:jira-user', 'offline_access'],
    },
    { port: 5199, env },
  )
  const authorize = new URL(started.authorizeUrl)
  assert.equal(authorize.origin, 'https://auth.atlassian.com')
  assert.equal(authorize.searchParams.get('client_id'), 'at-custom-client-id')

  const recordedBodies: string[] = []
  const outcome = await handleOAuthCallback(new URLSearchParams({ state: started.state, code: 'at-code' }), {
    port: 5199,
    env,
    envFile: path.join(dir, '.env'),
    transport: async request => {
      recordedBodies.push(String(request.body || ''))
      if (request.method === 'POST') {
        return {
          status: 200,
          headers: {},
          body: { access_token: 'at-access', refresh_token: 'at-refresh' },
        }
      }
      return {
        status: 200,
        headers: {},
        body: [{ id: 'cloud-123', url: 'https://demo.atlassian.net' }],
      }
    },
  })
  assert.equal(outcome.ok, true)
  assert.match(recordedBodies[0], /client_secret=at-custom-client-secret/)
  assert.equal(env.ATLASSIAN_COLLECTOR_REFRESH_TOKEN, 'at-refresh')
  assert.equal(env.ATLASSIAN_CLOUD_ID, 'cloud-123')
  assert.equal(env.ATLASSIAN_SITE_URL, 'https://demo.atlassian.net')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('GitHub App 설치 콜백은 설치 조직 login을 저장하고 개인키가 없으면 GITHUB_ORG 입력을 안내한다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-github-install-'))
  const envFile = path.join(dir, '.env')
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
  const env: Record<string, string> = { GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: privateKeyPem }
  const requests: string[] = []
  const outcome = await handleOAuthCallback(new URLSearchParams({ installation_id: '67890' }), {
    port: 5199,
    env,
    envFile,
    transport: async request => {
      requests.push(request.url)
      return { status: 200, headers: {}, body: { account: { login: 'aegi-inc' } } }
    },
  })
  assert.equal(outcome.ok, true)
  assert.equal(env.GITHUB_ORG, 'aegi-inc')
  assert.ok(requests.includes('https://api.github.com/app/installations/67890'))
  assert.ok(!outcome.html.includes(privateKeyPem), '개인키는 콜백 응답에 포함하면 안 된다')

  const noKeyEnv: Record<string, string> = { GITHUB_APP_ID: '12345' }
  const noKey = await handleOAuthCallback(new URLSearchParams({ installation_id: '67891' }), {
    port: 5199,
    env: noKeyEnv,
    envFile: path.join(dir, 'no-key.env'),
  })
  assert.equal(noKey.ok, false)
  assert.match(noKey.error ?? '', /GITHUB_ORG/)
  assert.match(noKey.html, /GITHUB_ORG/)

  const expiredState = await handleOAuthCallback(new URLSearchParams({ state: 'missing-state', code: 'code' }), {
    port: 5199,
    env: {},
    envFile: path.join(dir, 'expired-state.env'),
  })
  assert.match(expiredState.error ?? '', /서버를 다시 시작했거나/)
  assert.match(expiredState.error ?? '', /10분/)

  // Manifest 변환은 이미 존재하던 키 파일도 소유자 전용으로 다시 제한한다.
  const pemPath = path.join(process.env.AEGI_DATA_DIR!, 'setup-output', 'secrets', 'github-app-collector.pem')
  fs.mkdirSync(path.dirname(pemPath), { recursive: true })
  fs.writeFileSync(pemPath, 'old key', { mode: 0o644 })
  fs.chmodSync(pemPath, 0o644)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async input => {
    assert.match(String(input), /app-manifests\/manifest-code\/conversions/)
    return new Response(JSON.stringify({ id: 54321, slug: 'aegi-test', client_id: 'client', pem: 'new private key', html_url: 'https://github.com/apps/aegi-test' }), { status: 200 })
  }
  try {
    const manifest = await handleOAuthCallback(new URLSearchParams({ code: 'manifest-code' }), {
      port: 5199,
      env: {},
      envFile: path.join(dir, 'manifest.env'),
    })
    assert.equal(manifest.ok, true)
    assert.equal(fs.readFileSync(pemPath, 'utf8'), 'new private key')
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(pemPath).mode & 0o777, 0o600)
    }
  } finally {
    globalThis.fetch = originalFetch
    fs.rmSync(pemPath, { force: true })
  }
})

test('기준별 판정 실패 판정기 목록은 새 엔진 결과에서 읽고 옛 vendor 결과도 허용한다', () => {
  assert.deepEqual(failedDetectors({ failed_detectors: ['github_cis', 'okta_stig'] }), ['github_cis', 'okta_stig'])
  assert.deepEqual(failedDetectors({ generated_at: '2026-11-05', standards: [], findings: [] }), [])
})

test('기준별 판정은 결과 파일이 있으면 비정상 종료도 게시하고, 옛 vendor 결과도 게시한다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-standards-'))
  const local = openDb(path.join(dir, 'aegi.sqlite'))
  await migrate(local)
  const document = (extra: object = {}) => JSON.stringify({ generated_at: '2026-11-05', note: 'test', standards: [], findings: [], ...extra })
  const run = (result: string, status: number) => (_python: string, args: string[]) => {
    const out = args[args.indexOf('--out') + 1]!
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, 'standard_results.json'), result)
    return { status, stdout: 'broken_detector FAIL\n' }
  }
  try {
    const partialLogs: string[] = []
    const partial = await judgeStandards(local, dir, 'partial', dir, null, line => partialLogs.push(line), {
      python: 'test-python', run: run(document({ failed_detectors: ['broken_detector'] }), 1),
    })
    assert.equal(partial.state, 'published')
    assert.ok(partialLogs.some(line => line.includes('broken_detector')))

    const oldLogs: string[] = []
    const old = await judgeStandards(local, dir, 'old-vendor', dir, null, line => oldLogs.push(line), {
      python: 'test-python', run: run(document(), 0),
    })
    assert.equal(old.state, 'published')
    assert.ok(!oldLogs.some(line => line.includes('일부 실패')))
  } finally {
    local.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('비동기 수집: 202 즉시 반환, 진행 상태 API, 중복 실행 차단(409), 수집 중 서버 응답, 비밀값 마스킹', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-async-collect-'))
  const envFile = process.env.AEGI_ENV_FILE!
  fs.writeFileSync(envFile, 'OKTA_ORG_URL=https://initial.okta.com\n', 'utf8')
  const env: Record<string, string> = { OKTA_ORG_URL: 'https://initial.okta.com' }
  const local = openDb(path.join(dir, 'async-collect.sqlite'))
  await migrate(local)

  let releaseRunner!: () => void
  const runnerGate = new Promise<void>(resolve => { releaseRunner = resolve })

  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    env,
    local,
    logs: null,
    collectRunner: async (_provider, log) => {
      log?.('1/4 수집 (읽기 전용 API 호출)')
      log?.('비밀값 출력: xoxb-TESTONLY-123')
      log?.('비밀값 토큰: ghp_SECRETTOKEN999')
      log?.('비밀값 헤더: Bearer my-secret-token')
      log?.('인증서: -----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----')
      log?.('2/4 정규화')
      await runnerGate
      return { findings: 3 }
    },
  })
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`

  try {
    // 1. 초기 상태: idle
    const initStatus = await (await fetch(`${base}/__aegi/collect-status`)).json() as { state: string; lines: string[] }
    assert.equal(initStatus.state, 'idle')

    // 2. 수집 요청: 즉시 202 와 jobId 반환
    const startRes = await fetch(`${base}/__aegi/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'okta' }),
    })
    assert.equal(startRes.status, 202)
    const startBody = await startRes.json() as { ok: boolean; jobId: string }
    assert.equal(startBody.ok, true)
    assert.ok(typeof startBody.jobId === 'string' && startBody.jobId.length > 0)

    // 약간 대기하여 runner 가 로그를 찍고 gate 에 도달하게 함
    await new Promise(r => setTimeout(r, 40))

    // 3. 실행 중 상태 검사: running, step, lines, 비밀값 마스킹
    const runningStatus = await (await fetch(`${base}/__aegi/collect-status`)).json() as {
      state: string
      jobId: string
      provider: string
      step: string
      lines: string[]
    }
    assert.equal(runningStatus.state, 'running')
    assert.equal(runningStatus.jobId, startBody.jobId)
    assert.equal(runningStatus.provider, 'okta')
    assert.equal(runningStatus.step, '2/4 정규화')

    // 비밀값 검사: status.lines 에 원문이 없고 마스킹되어야 함
    const allLines = runningStatus.lines.join('\n')
    assert.ok(!allLines.includes('xoxb-TESTONLY-123'), 'Slack bot 토큰 원문이 노출되면 안 됨')
    assert.ok(allLines.includes('xoxb-***'), 'Slack bot 토큰이 마스킹되어야 함')
    assert.ok(!allLines.includes('ghp_SECRETTOKEN999'), 'GitHub PAT 원문이 노출되면 안 됨')
    assert.ok(allLines.includes('ghp_***'), 'GitHub PAT 가 마스킹되어야 함')
    assert.ok(!allLines.includes('my-secret-token'), 'Bearer 토큰 원문이 노출되면 안 됨')
    assert.ok(allLines.includes('Bearer ***'), 'Bearer 토큰이 마스킹되어야 함')
    assert.ok(!allLines.includes('-----BEGIN CERTIFICATE-----'), '인증서 BEGIN 헤더가 마스킹되어야 함')

    // 4. 실행 중 중복 수집 요청은 409
    const dupRes = await fetch(`${base}/__aegi/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'okta' }),
    })
    assert.equal(dupRes.status, 409)

    // 5. 수집이 도는 동안 서버의 다른 요청(/graph)이 정상 응답(이벤트 루프 차단 없음)
    const graphRes = await fetch(`${base}/graph`)
    assert.equal(graphRes.status, 200)

    // 6. runner 완료 후 status: done
    releaseRunner()
    for (let i = 0; i < 50; i++) {
      const st = await (await fetch(`${base}/__aegi/collect-status`)).json() as { state: string; result?: { findings: number } }
      if (st.state === 'done') {
        assert.equal(st.result?.findings, 3)
        break
      }
      await new Promise(r => setTimeout(r, 20))
    }

    const doneStatus = await (await fetch(`${base}/__aegi/collect-status`)).json() as { state: string; error: string | null }
    assert.equal(doneStatus.state, 'done')
    assert.equal(doneStatus.error, null)
  } finally {
    server.close()
    local.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('빈 시작 데이터셋, POST /__aegi/sample 전환, Splunk/AI 설정 저장 및 Splunk 연결 점검', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-empty-settings-'))
  const envFile = process.env.AEGI_ENV_FILE!
  fs.writeFileSync(envFile, '', 'utf8')

  const local = openDb(path.join(dir, 'empty.sqlite'))
  await migrate(local)
  await publishEmpty(local, () => undefined)

  const env: Record<string, string> = {
    SPLUNK_SOURCES_FILE: path.join(dir, 'test.sources.json'),
  }
  const fake = fakeSplunk([
    { index: 'aegi_okta', sourcetype: 'okta:im2:log', time: 1000, raw: {} },
  ])

  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    env,
    local,
    logs: null,
    splunkWire: fake.wire,
  })
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`

  try {
    // 1. 빈 데이터셋 확인: GET /api/measured/dataset-v2
    const ds1Res = await fetch(`${base}/api/measured/dataset-v2`)
    assert.equal(ds1Res.status, 200)
    const ds1 = await ds1Res.json() as { objects: unknown[] }
    assert.equal(ds1.objects.length, 0, '빈 시작 시 objects 는 0개여야 한다')

    // 2. splunk-test initSources 확인: 파일 복사 생성
    const initRes = await fetch(`${base}/__aegi/splunk-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initSources: true }),
    })
    assert.equal(initRes.status, 200)
    const initBody = await initRes.json() as { ok: boolean; path: string; created: boolean }
    assert.equal(initBody.ok, true)
    assert.equal(initBody.created, true)
    assert.ok(fs.existsSync(initBody.path))

    // 3. Splunk 미설정 시 splunk-test 실패 확인
    const splunkTestRes1 = await fetch(`${base}/__aegi/splunk-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(splunkTestRes1.status, 200)
    const splunkTest1 = await splunkTestRes1.json() as { ok: boolean; error?: string }
    assert.equal(splunkTest1.ok, false)
    assert.match(splunkTest1.error ?? '', /SPLUNK_URL/)

    // 4. Splunk 및 AI 설정 저장 (POST /__aegi/local-token)
    const saveRes = await fetch(`${base}/__aegi/local-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: {
          SPLUNK_URL: 'https://splunk.example.com:8089',
          SPLUNK_TOKEN: 'secret-splunk-token-12345',
          ANTHROPIC_API_KEY: 'sk-ant-secret-key-67890',
        },
      }),
    })
    assert.equal(saveRes.status, 200)

    // GET /__aegi/local-token 으로 확인 (비밀값 비노출, configured/aiReady 확인)
    const tokRes = await fetch(`${base}/__aegi/local-token`)
    assert.equal(tokRes.status, 200)
    const tokBody = await tokRes.json() as { configured: Record<string, boolean>; aiReady: boolean; hints: Record<string, string> }
    assert.equal(tokBody.configured.SPLUNK_URL, true)
    assert.equal(tokBody.configured.SPLUNK_TOKEN, true)
    assert.equal(tokBody.configured.ANTHROPIC_API_KEY, true)
    assert.equal(tokBody.aiReady, true)
    const tokJson = JSON.stringify(tokBody)
    assert.ok(!tokJson.includes('secret-splunk-token-12345'), '토큰 원문이 노출되지 않아야 한다')
    assert.ok(!tokJson.includes('sk-ant-secret-key-67890'), 'AI API 키 원문이 노출되지 않아야 한다')

    // 5. 설정 저장 후 splunk-test 성공 확인 (mock Splunk wire)
    const splunkTestRes2 = await fetch(`${base}/__aegi/splunk-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(splunkTestRes2.status, 200)
    const splunkTest2 = await splunkTestRes2.json() as { ok: boolean; sources: Array<{ ref: string; events: number }> }
    assert.equal(splunkTest2.ok, true)
    assert.ok(Array.isArray(splunkTest2.sources))
    assert.ok(!JSON.stringify(splunkTest2).includes('secret-splunk-token-12345'))

    // 6. POST /__aegi/sample 전환 확인
    const sampleRes = await fetch(`${base}/__aegi/sample`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(sampleRes.status, 200)
    const sampleBody = await sampleRes.json() as { ok: boolean }
    assert.equal(sampleBody.ok, true)

    // 샘플 게시 후 dataset-v2 재조회: objects > 0
    const ds2Res = await fetch(`${base}/api/measured/dataset-v2`)
    assert.equal(ds2Res.status, 200)
    const ds2 = await ds2Res.json() as { objects: unknown[] }
    assert.ok(ds2.objects.length > 0, '샘플 게시 후 objects 가 존재해야 한다')
  } finally {
    server.close()
    local.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Compliance 「관리자 인증 보호」 검사: 정책 저장, 검사 실행 큐 비동기 처리, 실행 이력 및 결과 조회', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-compliance-'))
  const envFile = process.env.AEGI_ENV_FILE!
  fs.writeFileSync(envFile, '', 'utf8')

  const local = openDb(path.join(dir, 'compliance.sqlite'))
  await migrate(local)
  await publishEmpty(local, () => undefined)

  const env: Record<string, string> = {}
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    env,
    local,
    logs: null,
  })
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`

  try {
    // 1. 샘플 데이터셋으로 전환 (스냅샷 객체 및 current snapshot 생성)
    const sampleRes = await fetch(`${base}/__aegi/sample`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(sampleRes.status, 200)

    // 2. GET /api/measured/compliance/runs -> 200 (503/401 아님)
    const listRes = await fetch(`${base}/api/measured/compliance/runs`)
    assert.equal(listRes.status, 200)
    const listBody = await listRes.json() as { runs: unknown[] }
    assert.ok(Array.isArray(listBody.runs))

    // 3. POST /api/measured/compliance/policy?check=admin_auth 로 {require_mfa:true} 저장
    const policyRes = await fetch(`${base}/api/measured/compliance/policy?check=admin_auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ require_mfa: true }),
    })
    assert.equal(policyRes.status, 200)
    const policyBody = await policyRes.json() as { policy: { require_mfa?: boolean } }
    assert.equal(policyBody.policy?.require_mfa, true)

    // 4. POST /api/measured/compliance/runs (same-origin JSON 조건 준수) -> 2xx (202)
    const runRes = await fetch(`${base}/api/measured/compliance/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ check: 'admin_auth', policy: { require_mfa: true } }),
    })
    assert.equal(runRes.status, 202)
    const runBody = await runRes.json() as { id: string; status: string }
    assert.ok(runBody.id)
    assert.equal(runBody.status, 'pending')

    // 5. GET /api/measured/compliance/runs/<id> polling -> completed 또는 failed 로 변경 확인
    let finalRun: { status: string; result?: unknown; error?: string } | null = null
    for (let i = 0; i < 100; i++) {
      const getRes = await fetch(`${base}/api/measured/compliance/runs/${runBody.id}`)
      assert.equal(getRes.status, 200)
      const cur = await getRes.json() as { status: string; result?: unknown; error?: string }
      if (cur.status === 'completed' || cur.status === 'failed') {
        finalRun = cur
        break
      }
      await new Promise(r => setTimeout(r, 50))
    }
    assert.ok(finalRun, '검사가 pending 에 머무르지 않고 completed 또는 failed 로 끝나야 한다')
    const pythonAvailable = Boolean(findPython(env))
    if (pythonAvailable) {
      assert.equal(finalRun.status, 'completed')
      assert.ok(typeof finalRun.result === 'object' && finalRun.result !== null, 'result 가 객체여야 한다')
    } else {
      assert.equal(finalRun.status, 'failed')
    }

    // 6. Python 없는 환경(또는 평가 실패) 모사: status 가 failed (error: evaluation_failed) 로 종료
    env.AEGI_PYTHON = 'non_existent_python_binary_for_test'
    const failRunRes = await fetch(`${base}/api/measured/compliance/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ check: 'admin_auth', policy: { require_mfa: true } }),
    })
    assert.equal(failRunRes.status, 202)
    const failRunBody = await failRunRes.json() as { id: string }
    let failFinal: { status: string; error?: string } | null = null
    for (let i = 0; i < 100; i++) {
      const getRes = await fetch(`${base}/api/measured/compliance/runs/${failRunBody.id}`)
      assert.equal(getRes.status, 200)
      const cur = await getRes.json() as { status: string; error?: string }
      if (cur.status === 'failed') {
        failFinal = cur
        break
      }
      await new Promise(r => setTimeout(r, 50))
    }
    assert.ok(failFinal)
    assert.equal(failFinal.status, 'failed')
    assert.equal(failFinal.error, 'evaluation_failed')
    delete env.AEGI_PYTHON

    // 7. 서버 재시작 시 잔여 pending 처리 검증
    const stamp = new Date().toISOString()
    const headRow = await local.d1.prepare("SELECT snapshot_id FROM graph_head WHERE name = 'current'").first<{ snapshot_id: string }>()
    assert.ok(headRow?.snapshot_id)
    const startupRunId = 'startup-pending-test-1'
    await local.d1.prepare("INSERT INTO compliance_runs(id, workspace, check_id, status, created_at, updated_at, snapshot_id, policy) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)").bind(startupRunId, 'local', 'admin_auth', stamp, stamp, headRow.snapshot_id, JSON.stringify({ require_mfa: true })).run()

    server.close()

    // 새 서버 기동: 기동 시 pending 작업 자동 처리
    const server2 = await startServer({ host: '127.0.0.1', port: 0, env, local, logs: null })
    const port2 = (server2.address() as { port: number }).port
    const base2 = `http://127.0.0.1:${port2}`

    try {
      let startupFinal: { status: string } | null = null
      for (let i = 0; i < 100; i++) {
        const getRes = await fetch(`${base2}/api/measured/compliance/runs/${startupRunId}`)
        assert.equal(getRes.status, 200)
        const cur = await getRes.json() as { status: string }
        if (cur.status === 'completed' || cur.status === 'failed') {
          startupFinal = cur
          break
        }
        await new Promise(r => setTimeout(r, 50))
      }
      assert.ok(startupFinal)
      assert.equal(startupFinal.status, pythonAvailable ? 'completed' : 'failed')
    } finally {
      server2.close()
    }

    // 8. AEGI_PASSWORD 가 있을 때는 세션 없이 접근 시 401 login_required 확인
    const authEnv: Record<string, string> = { AEGI_PASSWORD: 'local-secret-pass' }
    const authServer = await startServer({ host: '127.0.0.1', port: 0, env: authEnv, local, logs: null })
    const authPort = (authServer.address() as { port: number }).port
    try {
      const unauthRes = await fetch(`http://127.0.0.1:${authPort}/api/measured/compliance/runs`)
      assert.equal(unauthRes.status, 401)
      assert.equal((await unauthRes.json() as { error: string }).error, 'login_required')
    } finally {
      authServer.close()
    }
  } finally {
    server.close()
    local.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Slack OAuth: 단일 포트 HTTP+HTTPS 멀티플렉서 및 명시 Secret 우선 정합성', async () => {
  const https = await import('node:https')
  const { ensureLocalTls } = await import('../src/tls.ts')
  const testSlackClientId = '1111111111.2222222222'
  const testSlackClientSecret = 'slack-custom-secret-abc'

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-slack-https-'))
  const envFile = process.env.AEGI_ENV_FILE!
  fs.writeFileSync(envFile, 'SLACK_CLIENT_SECRET=stale-wrong-secret\n', 'utf8')
  const env: Record<string, string> = { SLACK_CLIENT_SECRET: 'stale-wrong-secret' }
  const local = openDb(path.join(dir, 'slack.sqlite'))
  await migrate(local)

  let receivedClientId = ''
  let receivedClientSecret = ''
  let receivedRedirectUri = ''

  const oauthTransport = async (req: { method: string; url: string; headers: Record<string, string>; body?: string }) => {
    if (req.url === 'https://slack.com/api/oauth.v2.access') {
      const params = new URLSearchParams(req.body ?? '')
      receivedClientId = params.get('client_id') ?? ''
      receivedClientSecret = params.get('client_secret') ?? ''
      receivedRedirectUri = params.get('redirect_uri') ?? ''
      return {
        status: 200,
        headers: {},
        body: {
          ok: true,
          access_token: 'xoxb-test-bot-token-111',
          authed_user: { access_token: 'xoxp-test-user-token-222' },
          team: { id: 'T0EXAMPLE04', name: 'AEGI Company' },
          enterprise: { id: 'E0EXAMPLE02', name: 'AEGI Company' },
        },
      }
    }
    return { status: 404, headers: {}, body: { ok: false, error: 'not_found' } }
  }

  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    env,
    local,
    logs: null,
    oauthTransport,
  })
  const port = (server.address() as { port: number }).port
  const httpBase = `http://127.0.0.1:${port}`

  try {
    // 1. 평문 HTTP 로 Slack OAuth 시작 호출
    const startRes = await fetch(`${httpBase}/__aegi/oauth/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'slack',
        clientId: testSlackClientId,
        clientSecret: testSlackClientSecret,
        scopes: ['bot:users:read', 'users:read'],
      }),
    })
    assert.equal(startRes.status, 200)
    const startBody = await startRes.json() as { authorizeUrl: string; state: string; redirectUri: string }
    assert.equal(startBody.redirectUri, `https://127.0.0.1:${port}/__aegi/oauth/callback`)

    // 2. 동일 포트로 HTTPS 콜백 호출 (로컬 Root CA 로 검증)
    const tlsBundle = ensureLocalTls()
    const httpsRes = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = https.get(
        `https://127.0.0.1:${port}/__aegi/oauth/callback?state=${encodeURIComponent(startBody.state)}&code=slack-code-123`,
        { ca: tlsBundle.caCertPem },
        res => {
          let data = ''
          res.setEncoding('utf8')
          res.on('data', chunk => { data += chunk })
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
        },
      )
      req.on('error', reject)
    })

    assert.equal(httpsRes.status, 200)
    assert.match(httpsRes.body, /OAuth 연결 완료/)
    assert.equal(receivedClientId, testSlackClientId)
    assert.equal(receivedClientSecret, testSlackClientSecret, '이전 .env 의 stale secret 대신 입력한 secret 이 전달되어야 한다')
    assert.equal(receivedRedirectUri, `https://127.0.0.1:${port}/__aegi/oauth/callback`)
    assert.equal(env.SLACK_COLLECTOR_BOT_TOKEN, 'xoxb-test-bot-token-111')
    assert.equal(env.SLACK_COLLECTOR_USER_TOKEN, 'xoxp-test-user-token-222')
    assert.equal(env.SLACK_TEAM_ID, 'T0EXAMPLE04')
  } finally {
    server.close()
    local.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('AI 모델 고르기와 연결 시험: 점검, tools 포함, 공급자 400 원인 메시지, 키 마스킹, 모델 목록 필터링, 저장 시 aiTest 초기화', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-ai-test-'))
  const envFile = path.join(dir, '.env')
  fs.writeFileSync(envFile, 'OPENAI_API_KEY=sk-test-saved\nAEGI_ASSISTANT_PROVIDER=openai\nAEGI_ASSISTANT_MODEL=gpt-5\n')
  const local = openDb(path.join(dir, 'local.db'))
  await migrate(local)

  const env: Record<string, string> = {
    OPENAI_API_KEY: 'sk-test-saved',
    AEGI_ASSISTANT_PROVIDER: 'openai',
    AEGI_ASSISTANT_MODEL: 'gpt-5',
  }

  const capturedRequests: Array<{ url: string; method: string; headers: Headers; body: unknown }> = []
  const fakeAiFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? 'GET'
    let parsedBody: unknown = undefined
    if (init?.body && typeof init.body === 'string') {
      try { parsedBody = JSON.parse(init.body) } catch { parsedBody = init.body }
    }
    const headers = new Headers(init?.headers)
    capturedRequests.push({ url, method, headers, body: parsedBody })

    // Models endpoint
    if (url.includes('/models')) {
      if (url.includes('generativelanguage.googleapis.com')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'models/gemini-2.5-pro' },
            { id: 'models/text-embedding-004' },
            { id: 'models/imagen-3.0' },
            { id: 'models/aqa' },
            { id: 'models/gemini-2.5-flash' },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        object: 'list',
        data: [
          { id: 'text-embedding-3-small' },
          { id: 'tts-1' },
          { id: 'whisper-1' },
          { id: 'dall-e-3' },
          { id: 'gpt-5.5' },
          { id: 'gpt-5' },
          { id: 'gpt-6-luna' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    // Chat completions endpoint
    if (url.includes('/chat/completions')) {
      const model = (parsedBody as { model?: string })?.model
      if (model === 'gpt-6-luna') {
        return new Response(JSON.stringify({
          error: {
            message: 'Function tools with reasoning_effort are not supported for gpt-6-luna in /v1/chat/completions',
            type: 'invalid_request_error',
          },
        }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
      if (model === 'gpt-leak-key') {
        return new Response(JSON.stringify({
          error: {
            message: 'Invalid key sk-test-secret provided for model gpt-leak-key',
          },
        }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        id: 'chatcmpl-test',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
        model: model || 'gpt-5',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    // Claude Messages API: 실제 API 처럼 빈 글 블록과 빈 system 을 400 으로 거절한다
    if (url.includes('/v1/messages')) {
      const b = parsedBody as { model?: string; system?: unknown; messages?: Array<{ content: unknown }> }
      const blocks = (b.messages ?? []).flatMap(m => Array.isArray(m.content) ? m.content as Array<{ type: string; text?: string }> : [])
      if (blocks.some(x => x.type === 'text' && !x.text) || b.system === '') {
        return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'messages: text content blocks must be non-empty' } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    return new Response('not found', { status: 404 })
  }

  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    env,
    local,
    logs: null,
    aiFetch: fakeAiFetch,
  })
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`

  try {
    // (a) 공급자가 400 과 error.message 를 주면 /__aegi/ai-test 가 ok:false, status 400, message 에 그 문장을 준다
    const resA = await fetch(`${base}/__aegi/ai-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-6-luna', apiKey: 'sk-test-0000' }),
    })
    assert.equal(resA.status, 200)
    const bodyA = await resA.json() as { ok: boolean; error?: { status?: number; message?: string; code?: string } }
    assert.equal(bodyA.ok, false)
    assert.equal(bodyA.error?.status, 400)
    assert.match(bodyA.error?.message ?? '', /Function tools with reasoning_effort are not supported/)

    // (b) 요청 본문에 tools 가 들어 있다 (실제 채팅과 같은 조건)
    const lastChatReq = capturedRequests.find(r => r.url.includes('/chat/completions'))
    assert.ok(lastChatReq, 'chat/completions 요청이 발생해야 한다')
    const chatBody = lastChatReq.body as { tools?: unknown[]; reasoning_effort?: string }
    assert.ok(Array.isArray(chatBody.tools), '본문에 tools 배열이 있어야 한다')
    assert.ok(chatBody.tools.length > 0, 'tools 가 비어 있지 않아야 한다')
    assert.equal(chatBody.reasoning_effort, 'none', '저장값 없이 openai + gpt-6-luna 시험 -> 요청 본문 reasoning_effort: none')

    // body effort 'medium' + gpt-5 -> 본문 'medium'
    capturedRequests.length = 0
    const resMedium = await fetch(`${base}/__aegi/ai-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-5', apiKey: 'sk-test-0000', effort: 'medium' }),
    })
    assert.equal(resMedium.status, 200)
    const bodyMedium = await resMedium.json() as { ok: boolean; effort?: string | null }
    assert.equal(bodyMedium.ok, true)
    assert.equal(bodyMedium.effort, 'medium')
    assert.equal((capturedRequests[0]?.body as { reasoning_effort?: string })?.reasoning_effort, 'medium')

    // effort 'high' + gpt-6-luna -> 본문 'none' (목록 밖이라 자동)
    capturedRequests.length = 0
    const resHighLuna = await fetch(`${base}/__aegi/ai-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-6-luna', apiKey: 'sk-test-0000', effort: 'high' }),
    })
    assert.equal(resHighLuna.status, 200)
    const bodyHighLuna = await resHighLuna.json() as { ok: boolean; effort?: string | null }
    assert.equal(bodyHighLuna.effort, 'none')
    assert.equal((capturedRequests[0]?.body as { reasoning_effort?: string })?.reasoning_effort, 'none')

    // gpt-4.1 -> 본문에 reasoning_effort 없음, 응답 effort null
    capturedRequests.length = 0
    const resGpt4 = await fetch(`${base}/__aegi/ai-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-4.1', apiKey: 'sk-test-0000' }),
    })
    assert.equal(resGpt4.status, 200)
    const bodyGpt4 = await resGpt4.json() as { ok: boolean; effort?: string | null }
    assert.equal(bodyGpt4.ok, true)
    assert.equal(bodyGpt4.effort, null)
    assert.equal('reasoning_effort' in (capturedRequests[0]?.body as Record<string, unknown>), false)

    // (c) body 가 비면 저장된 .env 값(provider, model)으로 부른다. body 의 model 이 있으면 그것을 쓴다.
    capturedRequests.length = 0
    const resC1 = await fetch(`${base}/__aegi/ai-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(resC1.status, 200)
    const bodyC1 = await resC1.json() as { ok: boolean; provider: string; model: string }
    assert.equal(bodyC1.ok, true)
    assert.equal(bodyC1.provider, 'openai')
    assert.equal(bodyC1.model, 'gpt-5')
    assert.equal((capturedRequests[0]?.body as { model?: string })?.model, 'gpt-5')

    capturedRequests.length = 0
    const resC2 = await fetch(`${base}/__aegi/ai-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.5' }),
    })
    assert.equal(resC2.status, 200)
    const bodyC2 = await resC2.json() as { ok: boolean; model: string }
    assert.equal(bodyC2.ok, true)
    assert.equal(bodyC2.model, 'gpt-5.5')
    assert.equal((capturedRequests[0]?.body as { model?: string })?.model, 'gpt-5.5')

    // (d) 오류 메시지에 키가 들어 있어도 응답에는 키 문자열이 없다.
    const resD = await fetch(`${base}/__aegi/ai-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-leak-key', apiKey: 'sk-test-secret' }),
    })
    const bodyDText = await resD.text()
    assert.equal(bodyDText.includes('sk-test-secret'), false, '응답 본문에 키 문자열이 노출되지 않아야 한다')
    const bodyD = JSON.parse(bodyDText) as { ok: boolean; error?: { message?: string } }
    assert.equal(bodyD.ok, false)
    assert.match(bodyD.error?.message ?? '', /\*\*\*/)

    // (e) /__aegi/ai-models 가 embedding, tts 모델을 빼고 정렬해 준다.
    const resE = await fetch(`${base}/__aegi/ai-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', apiKey: 'sk-test-0000' }),
    })
    assert.equal(resE.status, 200)
    const bodyE = await resE.json() as { ok: boolean; models: string[]; defaultModel: string }
    assert.equal(bodyE.ok, true)
    assert.deepEqual(bodyE.models, ['gpt-5', 'gpt-5.5', 'gpt-6-luna'])
    assert.equal(bodyE.defaultModel, 'gpt-5.5')

    const resE2 = await fetch(`${base}/__aegi/ai-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', apiKey: 'sk-test-0000' }),
    })
    assert.equal(resE2.status, 200)
    const bodyE2 = await resE2.json() as { ok: boolean; models: string[]; defaultModel: string }
    assert.equal(bodyE2.ok, true)
    assert.deepEqual(bodyE2.models, ['gemini-2.5-flash', 'gemini-2.5-pro'])
    assert.equal(bodyE2.defaultModel, 'gemini-3.6-flash')

    // (g) 저장된 키(openai)는 다른 공급자(gemini) 시험과 모델 목록에 보내지 않는다.
    capturedRequests.length = 0
    const resG1 = await fetch(`${base}/__aegi/ai-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini' }),
    })
    const bodyG1 = await resG1.json() as { ok: boolean; error?: string }
    assert.equal(bodyG1.ok, false)
    assert.match(bodyG1.error ?? '', /gemini API 키를 입력하세요/)
    const resG2 = await fetch(`${base}/__aegi/ai-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini' }),
    })
    const bodyG2 = await resG2.json() as { ok: boolean; error?: { code?: string } }
    assert.equal(bodyG2.ok, false)
    assert.equal(bodyG2.error?.code, 'key_required')
    assert.equal(capturedRequests.length, 0, '저장된 키를 다른 공급자로 보내지 않는다')

    // (h) Claude 연결 시험은 빈 글 블록 없이 보낸다(실제 API 는 400 으로 거절)
    const resH = await fetch(`${base}/__aegi/ai-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', apiKey: 'sk-ant-test-0000' }),
    })
    const bodyH = await resH.json() as { ok: boolean; model: string; effort: string | null; error?: { message?: string } }
    assert.equal(bodyH.ok, true, bodyH.error?.message)
    assert.equal(bodyH.model, 'claude-sonnet-5-5')
    assert.equal(bodyH.effort, 'low')

    // (f) AI 설정을 저장하면 aiTest 가 null 로 돌아간다.
    const tokenBefore = await fetch(`${base}/__aegi/local-token`)
    const tokenBeforeBody = await tokenBefore.json() as { aiTest?: unknown }
    assert.ok(tokenBeforeBody.aiTest !== null, '시험 후 aiTest 가 메모리에 있어야 한다')

    const saveRes = await fetch(`${base}/__aegi/local-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { AEGI_ASSISTANT_MODEL: 'gpt-5' } }),
    })
    assert.equal(saveRes.status, 200)
    const saveBody = await saveRes.json() as { aiTest?: unknown }
    assert.equal(saveBody.aiTest, null, 'AI 설정 저장 후 aiTest 가 null 이어야 한다')

    const tokenAfter = await fetch(`${base}/__aegi/local-token`)
    const tokenAfterBody = await tokenAfter.json() as { aiTest?: unknown }
    assert.equal(tokenAfterBody.aiTest, null, 'GET /__aegi/local-token 의 aiTest 도 null 이어야 한다')

    // local-token 이 aiEffort, aiEffortSetting 을 준다. AEGI_ASSISTANT_REASONING_EFFORT 저장이 허용된다.
    const tokenCheck1 = await fetch(`${base}/__aegi/local-token`)
    const token1 = await tokenCheck1.json() as { aiEffort: unknown; aiEffortSetting: unknown }
    assert.equal(token1.aiEffort, 'low')
    assert.equal(token1.aiEffortSetting, '')

    const saveEffortRes = await fetch(`${base}/__aegi/local-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { AEGI_ASSISTANT_REASONING_EFFORT: 'high' } }),
    })
    assert.equal(saveEffortRes.status, 200)

    const tokenCheck2 = await fetch(`${base}/__aegi/local-token`)
    const token2 = await tokenCheck2.json() as { aiEffort: unknown; aiEffortSetting: unknown; hints?: Record<string, string> }
    assert.equal(token2.aiEffort, 'high')
    assert.equal(token2.aiEffortSetting, 'high')
    assert.equal(token2.hints?.AEGI_ASSISTANT_REASONING_EFFORT, 'high')
  } finally {
    server.close()
    local.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('GET /__aegi/github/orgs: 설치된 조직 또는 엔터프라이즈 산하 조직 목록 반환', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-gh-orgs-'))
  const envFile = path.join(dir, '.env')
  fs.writeFileSync(envFile, 'GITHUB_OWNER_TOKEN=ghp_dummy\nGITHUB_ENTERPRISE=aegi-ent\n')
  const local = openDb(path.join(dir, 'local.sqlite'))
  await migrate(local)
  const mockTransport: Transport = async req => {
    if (req.url.includes('/enterprises/aegi-ent/orgs')) {
      return { status: 200, headers: {}, body: [{ login: 'example-org', name: 'Example Org', description: 'Test Org' }] }
    }
    return { status: 404, headers: {}, body: {} }
  }

  const server = await startServer({
    port: 0,
    openBrowser: false,
    local,
    envFile,
    env: { GITHUB_OWNER_TOKEN: 'ghp_dummy', GITHUB_ENTERPRISE: 'aegi-ent' },
    oauthTransport: mockTransport,
  })
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`

  try {
    const res = await fetch(`${base}/__aegi/github/orgs`)
    assert.equal(res.status, 200)
    const body = await res.json() as { ok: boolean; orgs: Array<{ login: string; name?: string }> }
    assert.equal(body.ok, true)
    assert.equal(body.orgs.length, 1)
    assert.equal(body.orgs[0]?.login, 'example-org')
  } finally {
    server.close()
    local.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('testCredentialConnection: Okta 세부 엔드포인트 권한 점검 및 부족 권한 리포트', async () => {
  const partialTransport = async (req: { url: string }) => {
    if (req.url.endsWith('/api/v1/org')) return { status: 200, headers: {}, body: { id: 'org1' } }
    if (req.url.includes('/api/v1/users')) return { status: 200, headers: {}, body: [] }
    if (req.url.includes('/api/v1/groups')) return { status: 200, headers: {}, body: [] }
    if (req.url.includes('/api/v1/apps')) return { status: 200, headers: {}, body: [] }
    if (req.url.includes('/api/v1/policies')) return { status: 403, headers: {}, body: { errorCode: 'E0000006' } }
    if (req.url.includes('/api/v1/logs')) return { status: 403, headers: {}, body: { errorCode: 'E0000006' } }
    if (req.url.includes('/api/v1/iam/roles')) return { status: 404, headers: {}, body: {} }
    return { status: 404, headers: {}, body: {} }
  }
  const partial = await testCredentialConnection(
    'CRED-OK-01',
    { OKTA_ORG_URL: 'https://demo.okta.com', OKTA_API_TOKEN: 'ssws-token' },
    {},
    undefined,
    partialTransport,
  )
  assert.equal(partial.ok, false)
  assert.match(partial.detail, /policies\(403\)/)
  assert.match(partial.detail, /logs\(403\)/)

  const fullTransport = async () => ({ status: 200, headers: {}, body: {} })
  const full = await testCredentialConnection(
    'CRED-OK-01',
    { OKTA_ORG_URL: 'https://demo.okta.com', OKTA_API_TOKEN: 'ssws-token' },
    {},
    undefined,
    fullTransport,
  )
  assert.equal(full.ok, true)
  assert.match(full.detail, /users, groups, apps, policies, logs, roles 정상/)
})

test('testCredentialConnection: Slack x-oauth-scopes 헤더 기반 권한 점검', async () => {
  const missingCoreTransport = async () => ({
    status: 200,
    headers: { 'x-oauth-scopes': 'users:read,team:read' },
    body: { ok: true, team: 'BoB Sandbox' },
  })
  const missingCore = await testCredentialConnection(
    'CRED-SL-01',
    { SLACK_COLLECTOR_USER_TOKEN: 'xoxp-test' },
    {},
    undefined,
    missingCoreTransport,
  )
  assert.equal(missingCore.ok, false)
  assert.match(missingCore.detail, /channels:read/)

  const workspaceOnlyTransport = async () => ({
    status: 200,
    headers: { 'x-oauth-scopes': 'users:read,channels:read,groups:read,usergroups:read,team:read' },
    body: { ok: true, team: 'BoB Sandbox' },
  })
  const workspaceOnly = await testCredentialConnection(
    'CRED-SL-01',
    { SLACK_COLLECTOR_USER_TOKEN: 'xoxp-test' },
    {},
    undefined,
    workspaceOnlyTransport,
  )
  assert.equal(workspaceOnly.ok, true)
  assert.match(workspaceOnly.detail, /미포함 Enterprise 권한: .*auditlogs:read/)
})

test('testCredentialConnection(CRED-GW-01 DWD): 21개 DWD 스코프를 점검해 .env GWS_GRANTED_SCOPES 에 반영하고 미위임 스코프는 제외한다', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const saKey = JSON.stringify({
    type: 'service_account',
    client_email: 'aegi-collector@demo.iam.gserviceaccount.com',
    private_key: privateKeyPem,
  })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-gws-dwd-'))
  try {
    const envFileFull = path.join(dir, 'full.env')
    fs.writeFileSync(
      envFileFull,
      'GWS_GRANTED_SCOPES=https://www.googleapis.com/auth/admin.directory.user.readonly https://www.googleapis.com/auth/drive.metadata.readonly\n',
    )
    const envFull: Record<string, string> = {
      GWS_ADMIN_SUBJECT: 'admin@aegi.site',
      GWS_COLLECTOR_SA_KEY: saKey,
      GWS_GRANTED_SCOPES: 'https://www.googleapis.com/auth/admin.directory.user.readonly https://www.googleapis.com/auth/drive.metadata.readonly',
    }
    const resFull = await testCredentialConnection('CRED-GW-01', {}, envFull, envFileFull, async req => {
      if (req.url === 'https://oauth2.googleapis.com/token') {
        return { status: 200, headers: {}, body: { access_token: 'tok', expires_in: 3600 } }
      }
      return { status: 200, headers: {}, body: {} }
    })
    assert.equal(resFull.ok, true)
    assert.match(resFull.detail, /40개 DWD 스코프 반영/)
    assert.match(envFull.GWS_GRANTED_SCOPES, /script\.deployments\.readonly/)
    assert.match(envFull.GWS_GRANTED_SCOPES, /gmail\.settings\.basic/)
    assert.match(envFull.GWS_GRANTED_SCOPES, /forms\.body\.readonly/)
    assert.match(envFull.GWS_GRANTED_SCOPES, /calendar\.acls\.readonly/)
    assert.match(envFull.GWS_GRANTED_SCOPES, /ediscovery\.readonly/)
    assert.match(envFull.GWS_GRANTED_SCOPES, /gmail\.labels/)
    assert.match(envFull.GWS_GRANTED_SCOPES, /chrome\.management\.connectors\.readonly/)

    const envFilePartial = path.join(dir, 'partial.env')
    const envPartial: Record<string, string> = {
      GWS_ADMIN_SUBJECT: 'admin@aegi.site',
      GWS_COLLECTOR_SA_KEY: saKey,
    }
    const resPartial = await testCredentialConnection('CRED-GW-01', {}, envPartial, envFilePartial, async req => {
      if (req.url === 'https://oauth2.googleapis.com/token') {
        const params = new URLSearchParams(req.body ?? '')
        const jwt = params.get('assertion') ?? ''
        const payloadJson = Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')
        if (payloadJson.includes('gmail.settings.basic')) {
          return { status: 400, headers: {}, body: { error: 'unauthorized_client' } }
        }
        return { status: 200, headers: {}, body: { access_token: 'tok', expires_in: 3600 } }
      }
      return { status: 200, headers: {}, body: {} }
    })
    assert.equal(resPartial.ok, true)
    assert.match(resPartial.detail, /39개 DWD 스코프 반영/)
    assert.match(resPartial.detail, /DWD 미위임: gmail\.settings\.basic/)
    assert.doesNotMatch(envPartial.GWS_GRANTED_SCOPES, /gmail\.settings\.basic/)
    assert.match(envPartial.GWS_GRANTED_SCOPES, /script\.deployments\.readonly/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('collectorConfig Okta 기본 scope 와 CRED-AT-ORG-01 키 폴백', async () => {
  const { Credentials, credentialKeyNames } = await import('../vendor/engine/scripts/collect/config.ts')
  const c = collectorConfig({ OKTA_ORG_URL: 'https://demo.okta.com' })
  assert.ok(c.okta.scopes.includes('okta.securityEventsProviders.read'))
  assert.ok(c.okta.scopes.includes('ssf.read'))
  assert.ok(c.okta.scopes.includes('okta.emailServers.read'))
  assert.ok(c.okta.scopes.includes('okta.devices.read'))
  assert.ok(c.okta.scopes.includes('okta.governance.admin.read'))
  assert.equal(c.okta.scopes.length, 59)

  const creds = new Credentials({ ATLASSIAN_ORG_AUDIT_API_KEY: 'org-key-only' }, process.cwd())
  assert.deepEqual(credentialKeyNames(creds, 'CRED-AT-ORG-01'), ['ATLASSIAN_ORG_AUDIT_API_KEY'])
})

test('testCredentialConnection authMode=oauth 는 수동 키가 있어도 OAuth 경로로 검증한다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-oauth-mode-'))
  try {
    const envFile = path.join(dir, '.env')
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const saKey = JSON.stringify({
      type: 'service_account',
      client_email: 'sa@proj.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    })

    // GWS: SA 키가 있어도 authMode='oauth' 면 refresh_token 으로 검증하고 DWD 21 스코프를 덮어쓰지 않는다
    const gwsEnv: Record<string, string> = {
      GWS_ADMIN_SUBJECT: 'admin@example.com',
      GWS_COLLECTOR_SA_KEY: saKey,
      GWS_COLLECTOR_CLIENT_ID: 'gws-test-client-id.apps.googleusercontent.com',
      GWS_COLLECTOR_CLIENT_SECRET: 'gws-test-client-secret',
      GWS_COLLECTOR_REFRESH_TOKEN: 'gws-rt-1',
    }
    const gwsRes = await testCredentialConnection(
      'CRED-GW-01',
      {},
      gwsEnv,
      envFile,
      async req => {
        if (req.url === 'https://oauth2.googleapis.com/token') {
          assert.ok(String(req.body ?? '').includes('grant_type=refresh_token'))
          return { status: 200, headers: {}, body: { access_token: 'gws-at', expires_in: 3600 } }
        }
        return { status: 200, headers: {}, body: {} }
      },
      'oauth',
    )
    assert.equal(gwsRes.ok, true)
    assert.match(gwsRes.detail, /Google Workspace: customer/)
    assert.doesNotMatch(gwsRes.detail, /DWD 스코프/)

    // Okta: OKTA_API_TOKEN 이 있어도 authMode='oauth' 면 OAuth refresh_token 으로 검증한다
    const oktaEnv: Record<string, string> = {
      OKTA_ORG_URL: 'https://demo.okta.com',
      OKTA_API_TOKEN: 'stale-ssws-token',
      OKTA_COLLECTOR_CLIENT_ID: 'okta-cid',
      OKTA_COLLECTOR_REFRESH_TOKEN: 'okta-rt',
    }
    let oktaOauthCalled = false
    const oktaRes = await testCredentialConnection(
      'CRED-OK-01',
      {},
      oktaEnv,
      envFile,
      async req => {
        if (req.url.endsWith('/oauth2/v1/token')) {
          oktaOauthCalled = true
          return { status: 200, headers: {}, body: { access_token: 'okta-at', expires_in: 3600 } }
        }
        return { status: 200, headers: {}, body: {} }
      },
      'oauth',
    )
    assert.equal(oktaRes.ok, true)
    assert.equal(oktaOauthCalled, true)
    assert.match(oktaRes.detail, /\(Okta: org,/)
    assert.doesNotMatch(oktaRes.detail, /API 토큰/)

    // Atlassian: API 토큰이 있어도 authMode='oauth' 면 OAuth 3LO 로 검증한다
    const atEnv: Record<string, string> = {
      ATLASSIAN_SITE_URL: 'https://demo.atlassian.net',
      ATLASSIAN_COLLECTOR_EMAIL: 'admin@example.com',
      ATLASSIAN_COLLECTOR_API_TOKEN: 'stale-api-token',
      ATLASSIAN_COLLECTOR_CLIENT_ID: 'at-test-client-id',
      ATLASSIAN_COLLECTOR_CLIENT_SECRET: 'at-test-client-secret',
      ATLASSIAN_COLLECTOR_REFRESH_TOKEN: 'at-rt',
    }
    const atRes = await testCredentialConnection(
      'CRED-AT-01',
      {},
      atEnv,
      envFile,
      async req => {
        if (req.url === 'https://auth.atlassian.com/oauth/token') {
          return { status: 200, headers: {}, body: { access_token: 'at-at', expires_in: 3600 } }
        }
        return { status: 200, headers: {}, body: [] }
      },
      'oauth',
    )
    assert.equal(atRes.ok, true)
    assert.match(atRes.detail, /Atlassian OAuth 3LO/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('gwsCalls OAuth 전용 자격증명(SA 키 없음)에서도 크래시 없이 실행되고 DWD 전용 스코프는 건너뛴다', async () => {
  const { Credentials } = await import('../vendor/engine/scripts/collect/config.ts')
  const { gwsCalls } = await import('../vendor/engine/scripts/collect/providers/gws.ts')
  const creds = new Credentials(
    {
      GWS_COLLECTOR_CLIENT_ID: 'gws-cid',
      GWS_COLLECTOR_REFRESH_TOKEN: 'gws-rt',
    },
    process.cwd(),
  )
  const cfg = collectorConfig({ GWS_GRANTED_SCOPES: 'https://www.googleapis.com/auth/admin.directory.customer.readonly' })
  const seenUrls: string[] = []
  const calls = gwsCalls({
    config: cfg,
    creds,
    transport: async req => {
      seenUrls.push(req.url)
      if (req.url === 'https://oauth2.googleapis.com/token') {
        return { status: 200, headers: {}, body: { access_token: 'oauth-access', expires_in: 3600 } }
      }
      return { status: 200, headers: {}, body: { id: 'C01' } }
    },
  })
  const gw01 = calls.find(c => c.id === 'GW-01')!
  const gw08 = calls.find(c => c.id === 'GW-08')!
  const gw22 = calls.find(c => c.id === 'GW-22')!
  assert.equal(gw01.unavailable(), null)
  assert.equal(gw08.unavailable(), 'scope_not_granted:forms.body.readonly')
  assert.equal(gw22.unavailable(), 'scope_not_granted:calendar.acls.readonly')
  await gw01.run({
    period: { since: cfg.since, until: '2026-11-15T00:00:00Z' },
    cursor: () => undefined,
    setCursor: () => {},
    note: () => {},
    optional: async (_label, fn) => fn(),
    get: async opts => {
      const headers = await opts.auth.headers('GET', opts.url)
      assert.equal(headers.Authorization, 'Bearer oauth-access')
      return {}
    },
    list: async () => [],
  })
  assert.ok(seenUrls.includes('https://oauth2.googleapis.com/token'))
})


test('GW-07 소유 파일 권한 요청을 최대 8개 동시 워커로 실행하고 모든 원본 페이지를 손실 없이 저장한다', async () => {
  const { Credentials } = await import('../vendor/engine/scripts/collect/config.ts')
  const { gwsCalls } = await import('../vendor/engine/scripts/collect/providers/gws.ts')
  const { HttpLayer } = await import('../vendor/engine/scripts/collect/lib/http.ts')
  const { CollectStore } = await import('../vendor/engine/scripts/collect/lib/store.ts')
  const { Runner } = await import('../vendor/engine/scripts/collect/lib/runner.ts')

  const creds = new Credentials(
    {
      GWS_COLLECTOR_CLIENT_ID: 'gws-cid',
      GWS_COLLECTOR_REFRESH_TOKEN: 'gws-rt',
    },
    process.cwd(),
  )
  const cfg = collectorConfig({ GWS_DRIVE_USERS: 'alice@example.com' })
  const ownedFiles = Array.from({ length: 20 }, (_, i) => ({
    id: `file-${i + 1}`,
    name: `doc-${i + 1}`,
    mimeType: 'application/vnd.google-apps.document',
    owners: [{ emailAddress: 'alice@example.com', permissionId: 'p0' }],
  }))

  let inFlight = 0
  let maxInFlight = 0
  const transport: Wire = async req => {
    if (req.url === 'https://oauth2.googleapis.com/token') {
      return { status: 200, headers: {}, body: { access_token: 'oauth-access', expires_in: 3600 } }
    }
    if (req.url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
      return { status: 200, headers: {}, body: { files: ownedFiles } }
    }
    if (req.url.includes('/permissions?')) {
      inFlight++
      if (inFlight > maxInFlight) maxInFlight = inFlight
      await new Promise(r => setTimeout(r, 15))
      inFlight--
      const fid = /\/files\/([^/]+)\/permissions/.exec(req.url)?.[1] ?? 'unknown'
      return {
        status: 200,
        headers: {},
        body: { permissions: [{ id: `perm-${fid}`, type: 'user', role: 'owner', emailAddress: 'alice@example.com' }] },
      }
    }
    return { status: 404, headers: {}, body: {} }
  }

  const calls = gwsCalls({ config: cfg, creds, transport })
  const gw07 = calls.find(c => c.id === 'GW-07')!
  const store = new CollectStore(null, 'test-gw07-conc')
  const runner = new Runner({
    store,
    http: new HttpLayer({ transport, retryDelayMs: 0 }),
    period: { since: cfg.since, until: '2026-11-16T00:00:00Z' },
    ignoreCursors: true,
  })
  const rec = await runner.runOne(gw07)

  assert.equal(rec.completeness, 'full')
  assert.equal(rec.pages, 21)
  assert.equal(rec.record_count, 40)
  assert.ok(maxInFlight > 1 && maxInFlight <= 8, `expected 1 < maxInFlight <= 8, got ${maxInFlight}`)

  const rawFiles = [...store.memory.keys()].filter(k => k.startsWith('raw/test-gw07-conc/gws/GW-07-'))
  assert.equal(rawFiles.length, 21)
})

test('rateLimitWaitSeconds: Retry-After 우선, 없으면 x-rate-limit-reset, 둘 다 없으면 지수 백오프', async () => {
  const { rateLimitWaitSeconds } = await import('../vendor/engine/scripts/collect/lib/http.ts')
  const nowMs = 1_700_000_000_500
  assert.equal(
    rateLimitWaitSeconds({ status: 429, headers: { 'retry-after': '12', 'x-rate-limit-reset': '1700000050' }, body: {} }, 1, nowMs),
    12,
  )
  assert.equal(
    rateLimitWaitSeconds({ status: 429, headers: { 'x-rate-limit-reset': '1700000047' }, body: {} }, 1, nowMs),
    48,
  )
  assert.equal(
    rateLimitWaitSeconds({ status: 429, headers: {}, body: {} }, 3, nowMs),
    4,
  )
})

test('Slack OAuth: team 이 비고 admin.teams.list 실패 시 SLACK_TEAM_ID 를 Enterprise id 로 채우지 않으며 resolveSlackTeamId 로 재조회한다', async () => {
  const { startOAuth, handleOAuthCallback, resolveSlackTeamId } = await import('../src/oauth.ts')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-slack-team-'))
  try {
    const envFile = path.join(dir, '.env')
    const env: Record<string, string> = {}
    const started = startOAuth(
      {
        provider: 'slack',
        clientId: '1111111111.2222222222',
        clientSecret: 'slack-test-secret',
        scopes: ['users:read', 'admin.teams:read'],
      },
      { port: 5199, env },
    )
    const state = new URL(started.authorizeUrl).searchParams.get('state')!

    // team 비어 있고 enterprise 만 있으며 admin.teams.list / auth.test 모두 실패하는 콜백
    const outcome = await handleOAuthCallback(
      new URLSearchParams({ code: 'slack-code', state }),
      {
        port: 5199,
        env,
        envFile,
        transport: async req => {
          if (req.url.includes('oauth.v2.access')) {
            return {
              status: 200,
              headers: {},
              body: {
                ok: true,
                authed_user: { access_token: 'xoxp-test-user' },
                enterprise: { id: 'E0TESTENT01', name: 'Test Org' },
                team: null,
              },
            }
          }
          if (req.url.includes('admin.teams.list')) {
            return { status: 200, headers: {}, body: { ok: false, error: 'missing_scope' } }
          }
          if (req.url.includes('auth.test')) {
            return { status: 200, headers: {}, body: { ok: true, team_id: 'E0TESTENT01' } }
          }
          return { status: 404, headers: {}, body: {} }
        },
      },
    )
    assert.equal(outcome.ok, true)
    assert.equal(env.SLACK_ENTERPRISE_ID, 'E0TESTENT01')
    assert.equal(env.SLACK_TEAM_ID, undefined)
    assert.equal(collectorConfig(env).slack.teamId, '')
    assert.ok(missingIdentifiers(env, 'slack').some(m => m.includes('SLACK_TEAM_ID')))

    // 수집 직전 resolveSlackTeamId: 실패 시 사유 반환
    const failed = await resolveSlackTeamId(env, envFile, async () => ({
      status: 200,
      headers: {},
      body: { ok: false, error: 'missing_scope' },
    }))
    assert.equal(failed.ok, false)
    assert.match(failed.reason ?? '', /워크스페이스 id 없음/)
    assert.equal(env.SLACK_TEAM_ID, undefined)

    // 수집 직전 resolveSlackTeamId: admin.teams.list 성공 시 T... 저장
    const resolved = await resolveSlackTeamId(env, envFile, async req => {
      if (req.url.includes('admin.teams.list')) {
        return { status: 200, headers: {}, body: { ok: true, teams: [{ id: 'T0EXAMPLE03' }] } }
      }
      return { status: 404, headers: {}, body: {} }
    })
    assert.equal(resolved.ok, true)
    assert.equal(resolved.teamId, 'T0EXAMPLE03')
    assert.equal(env.SLACK_TEAM_ID, 'T0EXAMPLE03')
    assert.equal(collectorConfig(env).slack.teamId, 'T0EXAMPLE03')
    assert.deepEqual(missingIdentifiers(env, 'slack'), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('신규 4종(GCP·1Password·M365·Snowflake): collectorConfig 생성, ALLOWED_ENV_KEYS, GCP OAuth 시작', async () => {
  const { ALLOWED_ENV_KEYS } = await import('../src/env.ts')
  const { startOAuth } = await import('../src/oauth.ts')
  for (const k of [
    'GCP_COLLECTOR_CLIENT_ID',
    'GCP_COLLECTOR_REFRESH_TOKEN',
    'GCP_PROJECTS',
    'ONEPASSWORD_SERVICE_ACCOUNT_TOKEN',
    'ONEPASSWORD_EVENTS_TOKEN',
    'M365_TENANT_ID',
    'M365_CLIENT_ID',
    'M365_CLIENT_SECRET',
    'SNOWFLAKE_ACCOUNT',
    'SNOWFLAKE_COLLECTOR_USER',
    'SNOWFLAKE_COLLECTOR_PRIVATE_KEY',
  ]) {
    assert.ok(ALLOWED_ENV_KEYS.has(k), `ALLOWED_ENV_KEYS missing ${k}`)
  }
  const c = collectorConfig({
    GCP_PROJECTS: 'proj-a, proj-b',
    GCP_DISCOVERY_LOCATIONS: 'global, us',
    ONEPASSWORD_SERVICE_ACCOUNT_TOKEN: 'ops_dummy',
    ONEPASSWORD_ACCOUNT_ID: 'acc-123',
    M365_TENANT_ID: '00000000-0000-0000-0000-000000000001',
  })
  assert.deepEqual(c.gcp?.projects, ['proj-a', 'proj-b'])
  assert.deepEqual(c.gcp?.discoveryLocations, ['global', 'us'])
  assert.equal(c.onepassword?.accountId, 'acc-123')
  assert.equal(c.microsoft?.tenantId, '00000000-0000-0000-0000-000000000001')

  assert.throws(
    () =>
      startOAuth(
        { provider: 'gcp', clientId: 'gcp-cid.apps.googleusercontent.com', scopes: ['https://www.googleapis.com/auth/cloud-platform'] },
        { port: 5199, env: {} },
      ),
    (err: unknown) => (err as { code?: string; status?: number })?.code === 'client_secret_required' && (err as { status?: number })?.status === 400,
  )

  const gcpStart = startOAuth(
    { provider: 'gcp', clientId: 'gcp-cid.apps.googleusercontent.com', clientSecret: 'GOCSPX-test', scopes: ['https://www.googleapis.com/auth/cloud-platform'] },
    { port: 5199, env: {} },
  )
  assert.match(gcpStart.authorizeUrl, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/)
  assert.match(gcpStart.authorizeUrl, /cloud-platform/)
})

test('PR #45 리뷰 수정: GITHUB_APP_PRIVATE_KEY env 폴백 + ENV_FILE 회전 토큰 보존, CRED-SL-01 team.info 우선, salesforceAuth 공유, CRED-AWS-01 STS 확인', async () => {
  // 1. Credentials env 폴백 + ENV_FILE 회전 토큰 기록
  const { Credentials, loadEnv } = await import('../vendor/engine/scripts/collect/config.ts')
  const { salesforceAuth } = await import('../vendor/engine/scripts/collect/providers/salesforce.ts')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-pr45-'))
  const prevKey = process.env.GITHUB_APP_PRIVATE_KEY
  try {
    const envFile = path.join(dir, '.env')
    fs.writeFileSync(envFile, 'ATLASSIAN_COLLECTOR_REFRESH_TOKEN=old-rt\n', 'utf8')
    process.env.GITHUB_APP_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\nFAKE\n-----END RSA PRIVATE KEY-----'
    const creds = new Credentials(loadEnv(envFile), dir, undefined, envFile)
    assert.match(creds.get('GITHUB_APP_PRIVATE_KEY') ?? '', /BEGIN RSA PRIVATE KEY/)
    await creds.setMany({ ATLASSIAN_COLLECTOR_REFRESH_TOKEN: 'rotated-rt' })
    const saved = loadEnv(envFile)
    assert.equal(saved.ATLASSIAN_COLLECTOR_REFRESH_TOKEN, 'rotated-rt')
    assert.equal(saved.GITHUB_APP_PRIVATE_KEY, undefined)

    // 2. salesforceAuth 는 같은 creds 에 대해 Auth 인스턴스를 공유
    const sfCreds = new Credentials(
      {
        SALESFORCE_INSTANCE_URL: 'https://demo.my.salesforce.com',
        SALESFORCE_COLLECTOR_CLIENT_ID: '3MVG9_TEST',
        SALESFORCE_COLLECTOR_REFRESH_TOKEN: 'sf-rt',
      },
      dir,
    )
    const fakeTransport = async () => ({ status: 200, headers: {}, body: {} })
    const a1 = salesforceAuth({ creds: sfCreds, transport: fakeTransport })
    const a2 = salesforceAuth({ creds: sfCreds, transport: fakeTransport })
    assert.equal(a1, a2)
  } finally {
    if (prevKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY
    else process.env.GITHUB_APP_PRIVATE_KEY = prevKey
    fs.rmSync(dir, { recursive: true, force: true })
  }

  // 3. CRED-SL-01: Enterprise 권한 일부 누락이어도 team_access_not_granted 면 ok:false
  const slFail = await testCredentialConnection(
    'CRED-SL-01',
    { SLACK_COLLECTOR_USER_TOKEN: 'xoxp-test', SLACK_COLLECTOR_BOT_TOKEN: 'xoxb-test' },
    {},
    undefined,
    async req => {
      if (req.url.endsWith('/auth.test')) {
        return {
          status: 200,
          headers: { 'x-oauth-scopes': 'users:read,channels:read,groups:read,usergroups:read,team:read,admin' },
          body: { ok: true, team: 'AEGI Company' },
        }
      }
      if (req.url.endsWith('/team.info')) {
        return { status: 200, headers: {}, body: { ok: false, error: 'team_access_not_granted' } }
      }
      throw new Error(`unexpected ${req.url}`)
    },
  )
  assert.equal(slFail.ok, false)
  assert.match(slFail.detail, /team_access_not_granted/)

  // 4. CRED-AWS-01: STS GetCallerIdentity SigV4 호출 검증
  const awsOk = await testCredentialConnection(
    'CRED-AWS-01',
    { AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE', AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
    {},
    undefined,
    async req => {
      assert.match(req.url, /^https:\/\/sts\.ap-northeast-2\.amazonaws\.com\/\?Action=GetCallerIdentity/)
      assert.ok(String(req.headers?.Authorization ?? '').startsWith('AWS4-HMAC-SHA256 '))
      return {
        status: 200,
        headers: {},
        body: { GetCallerIdentityResponse: { GetCallerIdentityResult: { Account: '123456789012', Arn: 'arn:aws:iam::123456789012:user/aegi' } } },
      }
    },
  )
  assert.equal(awsOk.ok, true)
  assert.match(awsOk.detail, /123456789012/)

  const awsFail = await testCredentialConnection(
    'CRED-AWS-01',
    { AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE', AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
    {},
    undefined,
    async () => ({ status: 403, headers: {}, body: { ErrorResponse: { Error: { Code: 'InvalidClientTokenId', Message: 'The security token included in the request is invalid.' } } } }),
  )
  assert.equal(awsFail.ok, false)
  assert.match(awsFail.detail, /invalid/i)
})
