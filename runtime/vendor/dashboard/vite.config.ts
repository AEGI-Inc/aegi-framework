import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** 개발 서버는 로컬 실측 파일을 읽고, 배포본은 팀 로그인 뒤 Query API(D1)에서 받는다. */
const ROOT = path.dirname(fileURLToPath(import.meta.url))
/** 실측 v2 (aegi-adapter-engine 의 `npm run normalize` 결과를 복사해 둔 폴더). dev 서버에서만, 로컬 파일이 있을 때만. 배포본에는 없다 */
const MEASURED_V2_DIR = path.join(ROOT, 'src/data/aegi_inc_measured_v2').replace(/\\/g, '/')
/** 실측에서 사람을 알아볼 수 있는 값을 가명으로 바꾼 데이터셋(scripts/makeCiDataset.mjs). 실측 파일이 없을 때와 CI 기능 테스트가 쓴다 */
const CI_DATASET_DIR = path.join(ROOT, 'fixtures/ci_dataset_v2')
/** 범용 정규화가 쓰는 파일 */
const DATASET_FILES = ['manifest', 'objects', 'relations', 'links', 'observations', 'evidence_links']
/** 있으면 싣는 파일 (Effective Access 등. aegi-adapter-engine 의 정규화가 쓴다) */
const OPTIONAL_FILES = ['effective_access', 'coverage', 'events', 'event_links', 'standard_results', 'display_text', 'derived']
const VIRTUAL_V2_ID = 'virtual:aegi-measured-v2'
const VIRTUAL_IM_ID = 'virtual:aegi-measured-im'
const MEASURED_IM_DIR = path.join(ROOT, 'src/data/aegi_inc_measured_im').replace(/\\/g, '/')

function measuredDatasetPlugin(enabled: boolean, virtualId = VIRTUAL_V2_ID, dir = MEASURED_V2_DIR): Plugin {
  return {
    name: `aegi-measured-dataset:${virtualId}`,
    resolveId(id) {
      return id === virtualId ? `\0${virtualId}` : undefined
    },
    load(id) {
      if (id !== `\0${virtualId}`) return undefined
      if (!enabled) return 'export default null'
      const files = [...DATASET_FILES, ...OPTIONAL_FILES.filter(f => fs.existsSync(path.join(dir, `${f}.json`)))]
      const imports = files.map((f, i) => `import d${i} from ${JSON.stringify(`${dir}/${f}.json`)}`).join('\n')
      const fields = files.map((f, i) => `${JSON.stringify(f)}: d${i}`).join(', ')
      return `${imports}\nexport default { ${fields} }`
    },
  }
}

/**
 * 수집 자격증명 준비 상태 (#credentials, dev 서버 전용). 수집기는 aegi-adapter-engine 에 있으므로, 그 클론
 * (`AEGI_ADAPTER_DIR`, 없으면 옆 폴더 `../aegi-adapter-engine`)의 `scripts/collect/credentialStatus.ts` 가 그 PC 의
 * `.env.collector`, 수집 설정, 실행 기록을 읽어 자격증명마다 채워졌는지(참, 거짓)와 마지막 실행 결과만 낸다. 값은 내보내지 않는다.
 * 클론이 없으면 404 를 내고 화면은 준비 상태 칸을 숨긴다. 빌드에는 없다 (배포본 화면은 대장만 보인다).
 */
function collectorStatusPlugin(): Plugin {
  return {
    name: 'aegi-collector-status',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__aegi/collector-status', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'GET') return send(405, { error: 'method_not_allowed' })
        try {
          const adapterRoot = path.resolve(ROOT, process.env.AEGI_ADAPTER_DIR ?? '../aegi-adapter-engine')
          const statusFile = path.join(adapterRoot, 'scripts/collect/credentialStatus.ts')
          if (!fs.existsSync(statusFile)) return send(404, { error: 'adapter_not_found' })
          const mod = (await server.ssrLoadModule(statusFile.replace(/\\/g, '/'))) as { collectorStatus(root: string): unknown }
          send(200, mod.collectorStatus(adapterRoot))
        } catch (err) {
          send(500, { error: 'status_failed', message: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  }
}

/**
 * 이 dev 서버가 어느 작업 폴더에서 떴는지 알려 준다 (dev 서버 전용). 기능 테스트(scripts/runFunctionalTests.mjs)가
 * 다른 worktree의 dev 서버를 시험하지 않게 시작할 때 확인한다. 빌드에는 없다.
 */
function workspacePlugin(): Plugin {
  return {
    name: 'aegi-workspace',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__aegi/workspace', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify({ root: ROOT }))
      })
    },
  }
}

/** Local-only assessment fixture; production always uses authenticated D1 history. */
function standardHistoryDevPlugin(): Plugin {
  return {
    name: 'aegi-standard-history-dev', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/measured/standard-results', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'private, no-store')
        if (req.method !== 'GET') { res.statusCode = 405; res.end('{}'); return }
        const file = process.env.AEGI_STANDARD_RESULTS_FILE
        const list = (req.url ?? '').startsWith('/history')
        if (!file || !fs.existsSync(file)) { res.statusCode = list ? 200 : 404; res.end(JSON.stringify(list ? { current_id: null, items: [] } : { error: 'not_published' })); return }
        try {
          const results = JSON.parse(fs.readFileSync(file, 'utf8'))
          const run = { id: `std-${'0'.repeat(64)}`, generated_at: results.generated_at, published_at: results.generated_at, source_snapshot_id: null, standards_count: results.standards.length, findings_count: results.findings.length }
          res.end(JSON.stringify(list ? { current_id: run.id, items: [run] } : { run, results }))
        } catch { res.statusCode = 503; res.end('{"error":"assessment_unavailable"}') }
      })
    },
  }
}

/**
 * Dev graph index for the connector: identifiers, identity links and Okta app tenants of the local dataset (the same shape the
 * production route reads from the current D1 snapshot, server/connector.ts graphIndex).
 */
function devGraphIndex() {
  const dir = [MEASURED_IM_DIR, MEASURED_V2_DIR, CI_DATASET_DIR].find(d => fs.existsSync(path.join(d, 'objects.json')))!
  const read = (name: string) => { const file = path.join(dir, `${name}.json`); if (!fs.existsSync(file)) return []; const v = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(v) ? v : v[name] ?? [] }
  const ids = ['id', 'login', 'email', 'primaryEmail', 'full_name', 'key']
  const all: Array<{ fixture_key: string; canonical?: { provider?: string; object_type?: string; identifiers?: Record<string, { value?: unknown }> } }> = read('objects')
  const objects = all.map(o => ({ fixture_key: o.fixture_key,
    canonical: { provider: o.canonical?.provider, identifiers: Object.fromEntries(ids.flatMap(f => typeof o.canonical?.identifiers?.[f]?.value === 'string' ? [[f, { value: o.canonical.identifiers[f]!.value }]] : [])) } }))
  // Okta Application → 다른 SaaS 객체 registered_in 하나마다 앱 키와 끝 객체의 SaaS (server/connector.ts appTenants 와 같다)
  const byKey = new Map(all.map(o => [o.fixture_key, o.canonical]))
  const appTenants = (read('relations') as Array<{ canonical?: { relation_type?: string; references?: { source?: { value?: unknown }; target?: { value?: unknown } } } }>).flatMap(r => {
    const app = String(r.canonical?.references?.source?.value), source = byKey.get(app), tenant = byKey.get(String(r.canonical?.references?.target?.value))
    return r.canonical?.relation_type === 'registered_in' && source?.provider === 'okta' && source.object_type === 'Application' && tenant?.provider && tenant.provider !== 'okta'
      ? [{ app, provider: tenant.provider }] : []
  })
  return { snapshotId: `dev:${path.basename(dir)}`, objects, links: read('links'), appTenants }
}

/** 메인 저장소의 env 파일 위치 (worktree 에 .env.local/.env.setup 이 없을 때 대체로 읽는다. 값은 출력하지 않는다) */
const MAIN_REPO_ROOT = path.resolve(ROOT, '../../aegi-dashboard-new')

function readEnvMap(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {}
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    out[match[1]] = match[2].trim().replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b)
  }
  return out
}

function resolveAssistantEnv(mode: string): Record<string, string> {
  const fromMain = MAIN_REPO_ROOT !== ROOT && fs.existsSync(MAIN_REPO_ROOT)
    ? { ...readEnvMap(path.join(MAIN_REPO_ROOT, '.env.setup')), ...readEnvMap(path.join(MAIN_REPO_ROOT, '.env.local')) }
    : {}
  const fromRoot = { ...readEnvMap(path.join(ROOT, '.env.setup')), ...loadEnv(mode, ROOT, '') }
  const merged: Record<string, string> = { ...fromMain, ...fromRoot }
  for (const key of Object.keys(process.env)) {
    const value = process.env[key]
    if (value !== undefined && (key.startsWith('AEGI_') || key === 'CF_TOKEN' || key === 'CLOUDFLARE_API_TOKEN' || key === 'CLOUDFLARE_ACCOUNT_ID')) {
      merged[key] = value
    }
  }
  const geminiKey = merged.AEGI_GEMINI_API_KEY
  if (!merged.AEGI_ASSISTANT_API_KEY && geminiKey) {
    merged.AEGI_ASSISTANT_API_KEY = geminiKey
    merged.AEGI_ASSISTANT_PROVIDER = 'gemini'
    if (!merged.AEGI_ASSISTANT_MODEL || merged.AEGI_ASSISTANT_MODEL.startsWith('gpt-')) {
      merged.AEGI_ASSISTANT_MODEL = 'gemini-3.6-flash'
    }
  }
  if (merged.AEGI_SPLUNK_GATEWAY_TOKEN && !merged.AEGI_SPLUNK_TRANSPORT) merged.AEGI_SPLUNK_TRANSPORT = 'gateway'
  if (merged.AEGI_SPLUNK_GATEWAY_TOKEN && !merged.AEGI_SPLUNK_GATEWAY_URL) merged.AEGI_SPLUNK_GATEWAY_URL = 'https://splunk-query.aegi.site/query'
  if (!merged.AEGI_SPLUNK_WORKSPACE) merged.AEGI_SPLUNK_WORKSPACE = 'team'
  if (!merged.AEGI_SPLUNK_POLICY_VERSION) merged.AEGI_SPLUNK_POLICY_VERSION = 'v1'
  if (!merged.AEGI_SPLUNK_CACHE_VERSION) merged.AEGI_SPLUNK_CACHE_VERSION = 'direct-prod-20261029-v3'
  if (!merged.CF_TOKEN && merged.CLOUDFLARE_API_TOKEN) merged.CF_TOKEN = merged.CLOUDFLARE_API_TOKEN
  if (!merged.CLOUDFLARE_ACCOUNT_ID) merged.CLOUDFLARE_ACCOUNT_ID = 'a5921c69fa5ebeb3a79c15ac2e4a38fd'
  if (!merged.AEGI_LOG_D1_ID) merged.AEGI_LOG_D1_ID = '24f27725-f15b-4d0e-9b1e-e80f0a180368'
  return Object.fromEntries(Object.entries(merged).filter(([k]) =>
    k.startsWith('AEGI_ASSISTANT_') || k.startsWith('AEGI_SPLUNK_') || k.startsWith('AEGI_GRAPH_')
    || ['CF_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'AEGI_LOG_D1_ID', 'AEGI_REMOTE_D1'].includes(k)))
}

/** Dev-only API: no fixture interpretation or auth bypass is shipped in the Pages Function. */
function assistantDevPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'aegi-assistant-dev', apply: 'serve',
    configureServer(server) {
      // One broker for the dev process: the connector (npm run splunk:connector in aegi-adapter-engine) polls it over loopback.
      let broker: object | undefined
      let cachedD1: unknown | undefined
      let datasetCache: { snapshotId: string; bundle: string } | null = null
      const relay = async () => broker ??= new (await server.ssrLoadModule('/server/splunkRelay.ts')).ConnectorBroker()
      const loopback = (address?: string) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '')
      const sendJson = (res: import('http').ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) => {
        res.statusCode = status
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'private, no-store')
        Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v))
        res.end(JSON.stringify(value))
      }
      const forwardResponse = async (res: import('http').ServerResponse, response: Response) => {
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'private, no-store')
        const contentType = response.headers.get('content-type') ?? ''
        if (response.body && contentType.includes('ndjson')) {
          const reader = response.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            res.write(value)
          }
          res.end()
          return
        }
        res.end(await response.text())
      }
      const getD1 = async () => {
        if (cachedD1 !== undefined) return cachedD1
        if (!env.CF_TOKEN || !env.AEGI_LOG_D1_ID) { cachedD1 = null; return null }
        const [{ httpD1 }, { withSnapshotPin }] = await Promise.all([
          server.ssrLoadModule('/scripts/assistant-eval/cloud.ts'),
          server.ssrLoadModule('/server/snapshotGraph.ts'),
        ])
        cachedD1 = withSnapshotPin(httpD1(env.CLOUDFLARE_ACCOUNT_ID, env.AEGI_LOG_D1_ID, env.CF_TOKEN), env.AEGI_GRAPH_SNAPSHOT_ID)
        return cachedD1
      }
      const getLogs = async () => {
        if (!env.AEGI_SPLUNK_GATEWAY_TOKEN || !env.AEGI_SPLUNK_GATEWAY_URL || !env.CF_TOKEN || !env.AEGI_LOG_D1_ID) return undefined
        const [{ createSplunkTransport }, db] = await Promise.all([
          server.ssrLoadModule('/server/splunkTransport.ts'),
          getD1(),
        ])
        if (!db) return undefined
        return {
          transport: createSplunkTransport(env),
          db,
          scope: { workspace: env.AEGI_SPLUNK_WORKSPACE, principal: '0'.repeat(64), policyVersion: env.AEGI_SPLUNK_POLICY_VERSION },
        }
      }
      server.middlewares.use('/api/connector', async (req, res) => {
        const send = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)) }
        const route = (req.url ?? '').replace(/^\//, '').replace(/\?.*$/, '')
        if (!loopback(req.socket.remoteAddress) || req.method !== 'POST' || !['poll', 'respond', 'graph-index'].includes(route)) return send(404, { error: 'not_found' })
        const mod = await server.ssrLoadModule('/server/splunkRelay.ts')
        const key = route === 'graph-index' ? env.AEGI_GRAPH_INDEX_KEY ?? env.AEGI_SPLUNK_CONNECTOR_KEY : env.AEGI_SPLUNK_CONNECTOR_KEY
        if (!(await mod.connectorAuthorized(req.headers.authorization, key))) return send(401, { error: 'unauthorized' })
        if (route === 'graph-index') return send(200, devGraphIndex())
        try {
          const chunks: Buffer[] = []; let bytes = 0
          for await (const chunk of req) { bytes += chunk.length; if (bytes > 1_200_000) return send(413, { error: 'body_limit' }); chunks.push(chunk) }
          const text = Buffer.concat(chunks).toString('utf8')
          // A connector that hangs up mid long-poll must not take queued requests with it.
          const gone = new AbortController()
          res.on('close', () => { if (!res.writableFinished) gone.abort() })
          const result = await mod.connectorRoute(route, text ? JSON.parse(text) : {}, await relay(), undefined, gone.signal)
          if (gone.signal.aborted) return
          return send(result.status, result.body)
        } catch { return send(400, { error: 'invalid_body' }) }
      })
      server.middlewares.use('/api/measured/dataset-v2', async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' })
        if (env.AEGI_REMOTE_D1 !== '1') return sendJson(res, 404, { error: 'not_published' })
        try {
          const db = await getD1()
          if (!db) return sendJson(res, 503, { error: 'database_not_configured' })
          const [{ currentSnapshotId }, { bundleTextForSnapshot }] = await Promise.all([
            server.ssrLoadModule('/server/snapshotGraph.ts'),
            server.ssrLoadModule('/server/snapshotBundle.ts'),
          ])
          const snapshotId = await currentSnapshotId(db)
          if (!snapshotId) return sendJson(res, 404, { error: 'not_published' })
          if (!datasetCache || datasetCache.snapshotId !== snapshotId) {
            const bundle = await bundleTextForSnapshot(db, snapshotId)
            if (!bundle) return sendJson(res, 404, { error: 'not_published' })
            datasetCache = { snapshotId, bundle }
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'private, no-store')
          res.setHeader('X-Dataset-Chars', String(datasetCache.bundle.length))
          res.end(datasetCache.bundle)
        } catch (error) {
          return sendJson(res, 503, { error: 'dataset_unavailable', message: error instanceof Error ? error.message : String(error) })
        }
      })
      server.middlewares.use('/api/measured/graph', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://aegi.local')
        const subPath = url.pathname.replace(/^\/+/, '').replace(/\/$/, '')
        try {
          if (subPath === 'events' || subPath === 'events/read' || subPath === 'events/links') {
            if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' })
            const logs = await getLogs()
            if (!logs) return sendJson(res, 503, { error: 'splunk_not_configured' })
            const [{ logEventsStatus, logEventsRead, logEventLinks }, { currentSnapshotId }] = await Promise.all([
              server.ssrLoadModule('/server/logEvents.ts'),
              server.ssrLoadModule('/server/snapshotGraph.ts'),
            ])
            const graphSnapshotId = env.AEGI_REMOTE_D1 === '1' ? (await currentSnapshotId(logs.db)) ?? undefined : undefined
            const deps = { ...logs, graphSnapshotId, now: () => Date.now() }
            const result = subPath === 'events/read'
              ? await logEventsRead(url, deps)
              : subPath === 'events/links'
                ? await logEventLinks(url, deps)
                : await logEventsStatus(url, deps)
            return sendJson(res, result.status, result.body)
          }
          if (env.AEGI_REMOTE_D1 === '1' && (subPath === 'tools' || subPath === 'summary')) {
            if (subPath === 'tools' && req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' })
            if (subPath === 'summary' && req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' })
            const db = await getD1()
            if (!db) return sendJson(res, 503, { error: 'graph_not_configured' })
            let body = ''
            if (req.method === 'POST') {
              let bytes = 0
              for await (const chunk of req) {
                bytes += Buffer.byteLength(chunk)
                if (bytes > 1_200_000) return sendJson(res, 413, { error: 'body_limit' })
                body += chunk
              }
            }
            const [{ handleGraphRequest }, { logEventTool }, { currentSnapshotId }] = await Promise.all([
              server.ssrLoadModule('/server/graph.ts'),
              server.ssrLoadModule('/server/logEvents.ts'),
              server.ssrLoadModule('/server/snapshotGraph.ts'),
            ])
            const logs = await getLogs()
            const reqUrl = `http://aegi.local/api/measured/graph/${subPath}${url.search}`
            const webReq = new Request(reqUrl, {
              method: req.method,
              headers: { 'Content-Type': String(req.headers['content-type'] ?? 'application/json') },
              ...(req.method === 'POST' ? { body } : {}),
            })
            const jsonReply = (status: number, payload: Record<string, unknown>) =>
              new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
            const readSplunk = logs
              ? async (name: string, args: unknown) => logEventTool(name, args, {
                ...logs,
                graphSnapshotId: (await currentSnapshotId(logs.db)) ?? undefined,
                now: () => Date.now(),
              })
              : undefined
            const response = await handleGraphRequest(webReq, db, subPath, jsonReply, { ...(readSplunk ? { readSplunk } : {}) })
            return await forwardResponse(res, response)
          }
          return sendJson(res, 404, { error: 'not_found' })
        } catch (error) {
          return sendJson(res, 503, { error: 'graph_unavailable', message: error instanceof Error ? error.message : String(error) })
        }
      })
      for (const store of ['exceptions', 'investigations', 'credentials', 'handling', 'remediation-progress', 'compliance-exceptions']) {
        server.middlewares.use(`/api/measured/${store}`, (_req, res) => sendJson(res, 503, { error: 'not_configured' }))
      }
      server.middlewares.use('/api/measured/assistant/chat', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' })
        try {
          if (!String(req.headers['content-type'] || '').startsWith('application/json') ||
            (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) return sendJson(res, 403, { error: 'bad_request_origin' })
          const protocol = await server.ssrLoadModule('/src/assistant/chatProtocol.ts')
          let body = '', bytes = 0
          for await (const chunk of req) {
            bytes += Buffer.byteLength(chunk)
            if (bytes > protocol.CHAT_BODY_LIMIT) return sendJson(res, 413, { error: 'bad_question' })
            body += chunk
          }
          const parsed = JSON.parse(body)
          if (!protocol.parseKgRequest(parsed)) return sendJson(res, 400, { error: 'bad_question' })
          if (env.AEGI_ASSISTANT_LOCAL_FIXTURE === '1') {
            const mod = await server.ssrLoadModule('/server/assistant/planner.ts')
            return sendJson(res, 200, { plan: mod.createLocalFixturePlan(parsed.question, { history: [], focus: { source: !!parsed.focus.sourceKey, target: !!parsed.focus.targetKey, finding: !!parsed.focus.findingId } }), mode: 'fixture' })
          }
          const [mod, logs, graph] = await Promise.all([
            server.ssrLoadModule('/server/assistant/chat.ts'),
            getLogs(),
            env.AEGI_REMOTE_D1 === '1' ? getD1() : Promise.resolve(undefined),
          ])
          const response = await mod.handleAssistantChat(
            new Request('http://aegi.local/api/measured/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
            env,
            (status: number, value: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers }),
            req.socket.remoteAddress || 'local',
            Date.now(),
            { ...(logs ? { logs } : {}), ...(graph ? { graph } : {}) },
          )
          return await forwardResponse(res, response)
        } catch (error) { const known = error as { status?: number; code?: string }; return sendJson(res, known.status || 400, { error: known.code || 'bad_question' }) }
      })
      server.middlewares.use('/api/measured/assistant/plan', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' })
        try {
          if (!String(req.headers['content-type'] || '').startsWith('application/json') ||
            (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) return sendJson(res, 403, { error: 'bad_request_origin' })
          const planModule = await server.ssrLoadModule('/src/assistant/plan.ts')
          let body = '', bytes = 0
          for await (const chunk of req) {
            bytes += Buffer.byteLength(chunk)
            if (bytes > planModule.BODY_LIMIT) return sendJson(res, 413, { error: 'bad_question' })
            body += chunk
          }
          const parsed = JSON.parse(body)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).some(key => !['question', 'context'].includes(key))) return sendJson(res, 400, { error: 'bad_question' })
          const context = parsed.context === undefined ? planModule.emptyConversation() : planModule.parseConversation(parsed.context)
          if (!context) return sendJson(res, 400, { error: 'bad_question' })
          const mod = await server.ssrLoadModule('/server/assistant/planner.ts')
          if (env.AEGI_ASSISTANT_LOCAL_FIXTURE === '1') return sendJson(res, 200, { plan: mod.createLocalFixturePlan(parsed.question, context), mode: 'fixture' })
          return sendJson(res, 200, { plan: await mod.createAssistantPlan(parsed.question, env, {}, context), mode: 'model' })
        } catch (error) {
          const known = error as { status?: number; code?: string }
          return sendJson(res, known.status || 400, { error: known.code || 'bad_question' })
        }
      })
    },
  }
}

/**
 * App 청크를 index.html 의 modulepreload 로 건다 (빌드 전용).
 * main.tsx 는 실측 데이터를 등록한 뒤에야 App 을 import 한다(App 모듈이 불러올 때 데이터를 읽는다).
 * 데이터 → App 순으로 받던 것을, 실행 순서는 그대로 두고 내려받기만 데이터와 함께 시작한다.
 * 그래프 청크는 주소가 #graph 일 때만 미리 받는다. 늘 받으면 다른 화면으로 들어올 때 데이터와 대역폭을 나눠 늦어졌다.
 */
/**
 * 공개 데모(VITE_AEGI_PUBLIC_DEMO=on) 빌드와 dev 서버는 index.html 의 첫 화면 틀(<!-- boot:start --> ~ <!-- boot:end -->)을
 * src/tutorial/demoBoot.html 로 바꾼다. 운영과 기업 데모는 기본 틀(「데이터 불러오는 중」) 그대로다.
 * 순서가 pre 라서 바꾼 틀의 로고 그림(src/assets/logos)도 Vite 가 다른 자산처럼 처리한다
 */
function publicDemoBootPlugin(enabled: boolean): Plugin {
  return {
    name: 'aegi-public-demo-boot',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // 앱 첫 화면(루트 index.html)만 바꾼다. dev 서버가 내주는 다른 html 은 그대로 둔다
        if (!enabled || path.resolve(ctx.filename) !== path.join(ROOT, 'index.html')) return html
        const boot = fs.readFileSync(path.join(ROOT, 'src/tutorial/demoBoot.html'), 'utf8')
        const next = html.replace(/<!-- boot:start[\s\S]*?<!-- boot:end -->\r?\n?/, () => boot)
        if (next === html) throw new Error('index.html 에 boot:start, boot:end 표시가 없다')
        return next
      },
    },
  }
}

function appPreloadPlugin(): Plugin {
  return {
    name: 'aegi-app-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html
        const chunks = Object.values(ctx.bundle).flatMap(c => (c.type === 'chunk' ? [c] : []))
        const byFile = new Map(chunks.map(c => [c.fileName, c]))
        const already = new Set([...html.matchAll(/(?:src|href)="\/?([^"]+\.js)"/g)].map(m => m[1]))
        const closure = (entry: string, skip: Set<string>) => {
          const name = path.basename(entry, path.extname(entry))
          const start = chunks.find(c => c.facadeModuleId?.replace(/\\/g, '/').endsWith(entry)) ?? chunks.find(c => c.name === name)
          const files: string[] = []
          const visit = (file: string) => {
            if (skip.has(file) || files.includes(file)) return
            files.push(file)
            for (const dep of byFile.get(file)?.imports ?? []) visit(dep)
          }
          if (start) visit(start.fileName)
          return files
        }
        const appFiles = closure('src/App.tsx', already)
        const graphFiles = closure('src/UnifiedFullGraph.tsx', new Set([...already, ...appFiles]))
        const links = appFiles.map(file => `<link rel="modulepreload" crossorigin href="/${file}">`)
        if (graphFiles.length) {
          links.push(`<script>if(/^#(graph|fullgraph)/i.test(location.hash))${JSON.stringify(graphFiles)}.forEach(function(f){var l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href='/'+f;document.head.appendChild(l)})</script>`)
        }
        return links.length ? html.replace('</head>', `  ${links.join('\n    ')}\n  </head>`) : html
      },
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const assistantEnv = resolveAssistantEnv(mode)
  const remoteD1 = assistantEnv.AEGI_REMOTE_D1 === '1'
  // worktree마다 다른 포트를 .env.local 의 AEGI_DEV_PORT 로 준다. 이미 쓰는 포트면 다른 포트로 넘어가지 않고 멈춘다(기능 테스트가 같은 값을 읽는다)
  const devPort = Number(process.env.AEGI_DEV_PORT ?? loadEnv(mode, ROOT, 'AEGI_DEV_').AEGI_DEV_PORT) || 5180
  // 실측 파일은 git에 없다. 이 PC에 둔 실측(v2, 없으면 model v1)이 없으면 커밋된 가명 데이터셋을 쓴다(scripts/runFunctionalTests.mjs도 같은 순서)
  const defaultDir = [MEASURED_V2_DIR, path.join(ROOT, 'src/data/aegi_inc_measured_model_v1'), CI_DATASET_DIR]
    .find(dir => fs.existsSync(path.join(dir, 'objects.json'))) ?? CI_DATASET_DIR
  const selectedDir = process.env.AEGI_DATASET_DIR ? path.resolve(ROOT, process.env.AEGI_DATASET_DIR) : defaultDir
  if (!selectedDir.startsWith(ROOT+path.sep) && selectedDir !== MEASURED_V2_DIR) throw new Error('Dataset directory must be inside this workspace')
  const missingV2 = DATASET_FILES.filter(f => !fs.existsSync(path.join(selectedDir, `${f}.json`)))
  if (command === 'serve' && (mode === 'model-v1' || process.env.AEGI_DATASET_DIR) && missingV2.length) throw new Error(`Selected dataset is incomplete: ${missingV2.join(', ')} (aegi-adapter-engine 의 npm run normalize:model-v1 결과를 이 폴더에 둔다)`)
  const availableV2 = command === 'serve' && !remoteD1 && missingV2.length === 0
  const missingIm = DATASET_FILES.filter(f => !fs.existsSync(path.join(MEASURED_IM_DIR, `${f}.json`)))
  const availableIm = command === 'serve' && !remoteD1 && missingIm.length === 0
  if (remoteD1 && command === 'serve') console.info('[aegi] D1 원격 스냅샷 사용 (AEGI_REMOTE_D1=1)')
  else if (availableV2) console.info(`[aegi] ${selectedDir === CI_DATASET_DIR ? '가명' : '실측'} 데이터: ${path.relative(ROOT, selectedDir)}`)
  else if (command === 'serve') console.warn(`[aegi] 최신 실측 파일이 없습니다: ${missingV2.join(', ')} (aegi-adapter-engine 에서 npm run normalize 로 만든 파일을 src/data/aegi_inc_measured_v2/ 에 둔다)`)

  return {
    cacheDir: path.join(ROOT, '.vite', mode),
    plugins: [react(), publicDemoBootPlugin((process.env.VITE_AEGI_PUBLIC_DEMO ?? loadEnv(mode, ROOT, 'VITE_AEGI_PUBLIC_').VITE_AEGI_PUBLIC_DEMO) === 'on'), appPreloadPlugin(), collectorStatusPlugin(), workspacePlugin(), standardHistoryDevPlugin(), measuredDatasetPlugin(availableV2, VIRTUAL_V2_ID, selectedDir.replace(/\\/g, '/')), measuredDatasetPlugin(availableIm, VIRTUAL_IM_ID, MEASURED_IM_DIR), assistantDevPlugin(assistantEnv)],
    server: {
      port: devPort,
      strictPort: true,
      ...(process.env.AEGI_COMPLIANCE_LOCAL === '1' ? { proxy: { '/api/compliance': 'http://127.0.0.1:5197' } } : {}),
      watch: {
        ignored: ['**/references/**', '**/docs/**', '**/*.zip', '**/*_ExportBlock*/**', '**/.codex*/**', '**/key/**'],
      },
    },
  }
})
