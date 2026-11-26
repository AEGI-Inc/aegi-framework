/**
 * Splunk 이벤트 분석: 2026-11-26 에 더한 4개 SaaS(Microsoft 365, 1Password, Snowflake, Gemini Enterprise).
 * 합성 샘플에 그 SaaS 객체를 실제 정규화 결과와 같은 식별값 모양(M365 id·userPrincipalName·appId, 1Password id·email,
 * GCP IamMember id=user:<메일>·email)으로 더해 게시하고, 가짜 Splunk 의 8개 sourcetype 로그를 Timeline 조회 경로로 읽는다.
 * 확인: 출처마다 이벤트가 쌓이는지, 그래프 객체에 이어지는지, 표에 없는 sourcetype 은 Timeline 이 건너뛰는지, 깨진 원문이 조회를 멈추지 않는지.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

process.env.AEGI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-events-new-saas-'))
const SOURCES = path.join(process.env.AEGI_DATA_DIR, 'splunk.sources.json')

const { openDb, migrate } = await import('../src/db.ts')
const { publishDataset } = await import('../src/publish.ts')
const { createLogServices, WORKSPACE_ID } = await import('../src/logs.ts')
const { logCatalog, runLogTool } = await import('../vendor/dashboard/server/assistant/logTools.ts')
type Wire = import('../vendor/engine/scripts/stream/splunk/transport.ts').Wire

const ENV = { SPLUNK_URL: 'https://splunk.example.com:8089', SPLUNK_TOKEN: 'search-token', SPLUNK_SOURCES_FILE: SOURCES }

type Ev = { index: string; sourcetype: string; time: number; raw: object }
function fakeSplunk(events: Ev[]) {
  const searches: string[] = []
  const jobs = new Map<string, Array<Record<string, string>>>()
  const wire: Wire = async req => {
    const url = new URL(req.url)
    if (req.method === 'POST' && url.pathname === '/services/search/jobs') {
      const spl = new URLSearchParams(req.body).get('search') ?? ''
      searches.push(spl)
      const sid = `sid${jobs.size + 1}`
      if (spl.includes('fields _time aegi_indextime _raw')) {
        const index = /index=(\S+)/.exec(spl)?.[1], sourcetype = /sourcetype="([^"]+)"/.exec(spl)?.[1]
        jobs.set(sid, events.filter(e => e.index === index && e.sourcetype === sourcetype).map(e => ({ _time: String(e.time), aegi_indextime: String(e.time + 5), _raw: JSON.stringify(e.raw) })))
      } else {
        jobs.set(sid, [{ activityDisplayName: 'Add member to role', count: '1' }])
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
  return { wire, searches }
}

const obj = (provider: string, type: string, id: string, extra: Record<string, string> = {}) => ({
  fixture_key: `im:${provider}:${type}:${id}`,
  canonical: {
    provider, object_type: type, interfaces: [],
    identifiers: { primary: ['id'], id: { value: id, stability: 'stable' }, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { value: v, stability: 'mutable' }])) },
    references: {}, properties: {}, judged: {},
    source: { schema_version: 4, observations: [{ api: `fixture://events-test/${provider}/${id}`, record: 'synthetic', collected_at: '2026-11-26T00:00:00Z' }] },
  },
  fixture_meta: { display_name: id, normal: true },
})

const AGENT = 'projects/100/locations/global/collections/default_collection/engines/eng-1/assistants/default_assistant/agents/ag-1'
const NEW_OBJECTS = [
  obj('microsoft', 'User', 'u-0001', { userPrincipalName: 'alice@example.test', mail: 'alice@example.test' }),
  obj('microsoft', 'ServicePrincipal', 'sp-0001', { appId: 'app-0001' }),
  obj('onepassword', 'User', 'opu-0001', { email: 'alice@example.test' }),
  obj('onepassword', 'Vault', 'opv-0001'),
  obj('gcp', 'IamMember', 'user:alice@example.test', { email: 'alice@example.test' }),
  obj('gcp', 'Project', 'projects/100'),
  obj('gcp', 'Agent', AGENT),
]

test('새 4개 SaaS 감사 로그가 Timeline 조회로 쌓이고 그래프 객체에 이어진다', async () => {
  const dir = path.join(process.env.AEGI_DATA_DIR!, 'dataset')
  fs.cpSync(path.join(import.meta.dirname, '..', 'sample', 'dataset'), dir, { recursive: true })
  const objects = JSON.parse(fs.readFileSync(path.join(dir, 'objects.json'), 'utf8'))
  fs.writeFileSync(path.join(dir, 'objects.json'), JSON.stringify([...objects, ...NEW_OBJECTS]))

  // 출처는 16개까지라 예시에서 Guard 출처를 빼고, 표에 없는 sourcetype 출처 하나(AI 검색 전용이어야 한다)를 넣는다
  const example = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'splunk.sources.example.json'), 'utf8'))
  // 출처는 16개까지라 이 시험에서 쓰지 않는 Atlassian·Slack 출처를 빼고, 공식 애드온 이름 출처 3개를 넣는다
  example.sources = example.sources.filter((s: { ref: string }) => !['guard-main', 'jira-main', 'confluence-main', 'slack-main'].includes(s.ref))
  example.sources.push({ ref: 'm365-custom', provider: 'microsoft', index: 'sec_m365', sourcetype: 'ms:aad:signin', isolation: { dedicated: true }, fields: { actor_id: 'userId' } })
  example.sources.push({ ref: 'okta-addon', provider: 'okta', index: 'okta_addon', sourcetype: 'OktaIM2:log', isolation: { dedicated: true }, fields: { event_type: 'eventType' } })
  example.sources.push({ ref: 'gcp-pubsub', provider: 'gcp', index: 'gcp_pubsub', sourcetype: 'google:gcp:pubsub:message', isolation: { dedicated: true }, fields: { event_type: 'data.protoPayload.methodName' } })
  example.sources.push({ ref: 'aad-eventhub', provider: 'microsoft', index: 'aad_hub', sourcetype: 'azure:monitor:aad', isolation: { dedicated: true }, fields: { event_type: 'records{}.category' } })
  fs.writeFileSync(SOURCES, JSON.stringify(example))

  const local = openDb(path.join(process.env.AEGI_DATA_DIR!, 'aegi.sqlite'))
  await migrate(local)
  try {
    await publishDataset(local.exec, dir, { name: 'events-test' })

    const now = Math.floor(Date.now() / 1000)
    const iso = (t: number) => new Date(t * 1000).toISOString()
    const ev: Ev[] = [
      { index: 'aegi_microsoft', sourcetype: 'azure:aad:signin', time: now - 600, raw: { id: 'si-1', createdDateTime: iso(now - 600), userId: 'u-0001', userPrincipalName: 'alice@example.test', appId: 'app-0001', ipAddress: '203.0.113.10', status: { errorCode: 0 } } },
      { index: 'aegi_microsoft', sourcetype: 'azure:aad:audit', time: now - 700, raw: { id: 'au-1', activityDateTime: iso(now - 700), category: 'ApplicationManagement', activityDisplayName: 'Add app role assignment to service principal', result: 'success', initiatedBy: { user: { id: 'u-0001', userPrincipalName: 'alice@example.test' } }, targetResources: [{ id: 'sp-0001', type: 'ServicePrincipal', displayName: 'App' }] } },
      { index: 'aegi_microsoft', sourcetype: 'o365:management:activity', time: now - 800, raw: { Id: 'ual-1', CreationTime: iso(now - 800).replace(/\.\d+Z$/, ''), Workload: 'Exchange', Operation: 'MailItemsAccessed', ResultStatus: 'Succeeded', UserType: 0, UserKey: 'u-0001', UserId: 'alice@example.test', MailboxOwnerUPN: 'bob@example.test' } },
      { index: 'aegi_onepassword', sourcetype: 'onepassword:audit', time: now - 900, raw: { id: 'op-1', create_time: iso(now - 900), action: 'vault.access.grant', actor: { type: 'user', id: 'opu-0001', email: 'alice@example.test' }, targets: [{ type: 'vault', payload: { uuid: 'opv-0001', name: 'Eng' } }], outcome: { result: 'success' } } },
      { index: 'aegi_snowflake', sourcetype: 'snowflake:login', time: now - 1000, raw: { EVENT_ID: '100', EVENT_TIMESTAMP: iso(now - 1000), EVENT_TYPE: 'LOGIN', USER_NAME: 'USER_A', CLIENT_IP: '203.0.113.10', IS_SUCCESS: 'YES' } },
      { index: 'aegi_snowflake', sourcetype: 'snowflake:query', time: now - 1100, raw: { QUERY_ID: 'q-1', START_TIME: iso(now - 1100), QUERY_TYPE: 'UNLOAD', USER_NAME: 'USER_A', DATABASE_NAME: 'ANALYTICS', EXECUTION_STATUS: 'SUCCESS' } },
      { index: 'aegi_snowflake', sourcetype: 'snowflake:grant', time: now - 1200, raw: { ACTION: 'granted', EVENT_TIME: iso(now - 1200), GRANTEE_NAME: 'USER_A', ROLE: 'SYSADMIN', GRANTED_BY: 'ACCOUNTADMIN' } },
      { index: 'aegi_gcp', sourcetype: 'gcp:gemini:log', time: now - 1300, raw: { insertId: 'ins-1', timestamp: iso(now - 1300), logName: 'projects/100/logs/cloudaudit.googleapis.com%2Factivity', protoPayload: { methodName: 'google.cloud.discoveryengine.v1main.AgentService.SetIamPolicy', resourceName: AGENT, authenticationInfo: { principalEmail: 'alice@example.test' }, requestMetadata: { callerIp: '203.0.113.10' }, status: { code: 0 } } } },
      // 깨진 원문: 시각·행위자·대상이 없다. 빈 이벤트로 쌓지 않고 mapping_errors 로 세며, 다른 이벤트 조회는 멈추지 않는다
      { index: 'aegi_onepassword', sourcetype: 'onepassword:audit', time: now - 950, raw: { id: 'op-broken', action: 'vault.access.grant' } },
      // 공식 애드온 이름과 감싼 원문
      { index: 'okta_addon', sourcetype: 'OktaIM2:log', time: now - 400, raw: { uuid: 'ok-1', published: iso(now - 400), eventType: 'user.session.start', actor: { id: 'OKTA-U-ADDON', type: 'User', alternateId: 'alice@example.test' }, outcome: { result: 'SUCCESS' }, target: [] } },
      { index: 'gcp_pubsub', sourcetype: 'google:gcp:pubsub:message', time: now - 1400, raw: { data: { insertId: 'ins-2', timestamp: iso(now - 1400), logName: 'projects/100/logs/cloudaudit.googleapis.com%2Factivity', protoPayload: { methodName: 'google.cloud.discoveryengine.v1main.AgentService.UpdateAgent', resourceName: AGENT, authenticationInfo: { principalEmail: 'alice@example.test' } } }, attributes: {}, publish_time: iso(now - 1399) } },
      { index: 'aad_hub', sourcetype: 'azure:monitor:aad', time: now - 500, raw: { records: [
        { time: iso(now - 500), category: 'SignInLogs', properties: { id: 'si-2', createdDateTime: iso(now - 500), userId: 'u-0001', userPrincipalName: 'alice@example.test', status: { errorCode: 0 } } },
        { time: iso(now - 510), category: 'AuditLogs', properties: { id: 'au-2', activityDateTime: iso(now - 510), category: 'ApplicationManagement', activityDisplayName: 'Update service principal', result: 'success', initiatedBy: { user: { id: 'u-0001' } }, targetResources: [{ id: 'sp-0001', type: 'ServicePrincipal' }] } },
        { time: iso(now - 520), category: 'RiskyUsers', properties: { id: 'ru-1' } },
      ] } },
      // 표에 없는 sourcetype 의 출처: Timeline 은 이 index 를 검색하지 않아야 한다
      { index: 'sec_m365', sourcetype: 'ms:aad:signin', time: now - 600, raw: { id: 'custom-1', createdDateTime: iso(now - 600), userId: 'u-0001' } },
    ]
    const fake = fakeSplunk(ev)
    const logs = createLogServices(local, ENV, { wire: fake.wire })!
    const scope = { workspace: WORKSPACE_ID, principal: 'b'.repeat(64), policyVersion: logs.workspace.policyVersion }
    const to = new Date(Math.ceil(Date.now() / 300_000) * 300_000).toISOString(), from = new Date(Date.now() - 86400_000).toISOString()

    const r = await logs.relay.request({ action: 'events', scope, waitSeconds: 15, events: { from, to, providers: ['microsoft', 'onepassword', 'snowflake', 'gcp', 'okta'] } }, 30_000)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    // 깨진 1Password 원문 한 줄만 해석 실패로 드러나고, 나머지 SaaS 는 그대로 끝난다
    assert.equal(r.body.state, 'partial', JSON.stringify(r.body))
    const progress = r.body.providers as Array<{ provider: string; state: string; reason?: string }>
    assert.deepEqual(progress.filter(p => p.reason).map(p => `${p.provider}:${p.reason}`), ['onepassword:mapping_errors'])
    assert.ok(progress.every(p => p.state === 'complete'))
    for (const st of ['OktaIM2:log', 'google:gcp:pubsub:message', 'azure:monitor:aad']) {
      assert.ok(fake.searches.some(s => s.includes(`sourcetype="${st}"`)), `공식 애드온 이름 ${st} 를 그대로 검색한다`)
    }

    assert.ok(!fake.searches.some(s => s.includes('index=sec_m365')), '표에 없는 sourcetype 은 Timeline 이 검색하지 않는다')
    for (const st of ['azure:aad:signin', 'azure:aad:audit', 'o365:management:activity', 'onepassword:audit', 'snowflake:login', 'snowflake:query', 'snowflake:grant', 'gcp:gemini:log']) {
      assert.ok(fake.searches.some(s => s.includes(`sourcetype="${st}"`)), `${st} 를 검색한다`)
    }

    const rows = local.db.prepare('SELECT provider, event_type, object_keys FROM log_event').all() as Array<{ provider: string; event_type: string; object_keys: string }>
    const by = (p: string) => rows.filter(x => x.provider === p)
    assert.equal(by('microsoft').length, 5, JSON.stringify(rows))
    assert.equal(by('snowflake').length, 3)
    assert.equal(by('gcp').length, 2)
    assert.equal(by('onepassword').length, 1, '깨진 원문은 빈 이벤트로 쌓이지 않는다')
    assert.equal(by('okta').length, 1)
    assert.ok(by('gcp').some(x => x.event_type.endsWith('UpdateAgent') && String(x.object_keys).includes('im:gcp:IamMember:user:alice@example.test')), 'Pub/Sub data 안의 LogEntry 를 풀어 행위자까지 잇는다')
    assert.ok(by('microsoft').some(x => x.event_type === 'Update service principal' && String(x.object_keys).includes('im:microsoft:ServicePrincipal:sp-0001')), 'Event Hub AuditLogs 기록도 서비스 주체에 이어진다')
    assert.ok(!by('microsoft').some(x => String(x.event_type).includes('Risky')), '해석하지 않는 진단 category 는 버린다')
    assert.ok(!rows.some(x => x.object_keys?.includes('custom-1')))

    const linked = (p: string, key: string) => by(p).some(x => String(x.object_keys).includes(key))
    assert.ok(linked('microsoft', 'im:microsoft:User:u-0001'), 'M365 로그 행위자가 사용자 객체에 이어진다')
    assert.ok(linked('microsoft', 'im:microsoft:ServicePrincipal:sp-0001'), 'M365 감사 대상이 서비스 주체에 이어진다')
    assert.ok(linked('onepassword', 'im:onepassword:Vault:opv-0001'), '1Password 대상이 Vault 에 이어진다')
    assert.ok(linked('onepassword', 'im:onepassword:User:opu-0001'), '1Password 행위자가 사용자에 이어진다')
    assert.ok(linked('gcp', 'im:gcp:IamMember:user:alice@example.test'), 'Gemini 행위자가 메일로 IamMember 에 이어진다')
    assert.ok(linked('gcp', `im:gcp:Agent:${AGENT}`), 'Gemini 대상이 Agent 에 이어진다')
    assert.ok(!by('snowflake').some(x => String(x.object_keys).includes('im:snowflake:')), 'Snowflake 는 그래프에 객체가 없어 잇지 않는다')

    // AI 로그 도구: 새 출처가 목록에 있고, 검색이 그 index·sourcetype 으로 나간다
    const toolDeps = { transport: { namespace: 'local', request: (q: never, ms: number) => logs.relay.request(q, ms) }, db: local.d1, scope }
    const catalog = String(await logCatalog(toolDeps))
    for (const ref of ['m365-audit', 'onepassword-main', 'snowflake-query', 'gcp-gemini']) assert.match(catalog, new RegExp(ref))
    const counted = await runLogTool('search_logs', { sourceRefs: ['m365-audit'], spl: '| stats count by activityDisplayName', from, to }, toolDeps)
    assert.equal(counted.facts[0]?.data?.error, undefined, JSON.stringify(counted.facts[0]))
    assert.match(fake.searches.at(-1)!, /index=aegi_microsoft sourcetype="azure:aad:audit"/)
  } finally {
    local.close()
  }
})
