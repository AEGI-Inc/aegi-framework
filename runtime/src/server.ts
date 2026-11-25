/**
 * 로컬 서버 하나가 Cloudflare Pages(정적 화면 + /api/measured/* Function)와 지역 AI Worker 자리를 맡는다.
 * API 는 대시보드 server/measured.ts 의 handleMeasured 를 그대로 부르고, 바인딩만 로컬 것으로 준다:
 *   EXCEPTIONS_DB → SQLite, MEASURED_KV → 메모리(로그인 기록), Splunk relay → 같은 프로세스의 로그 서비스(기업 Splunk 검색 REST).
 * 기본은 127.0.0.1 에서만 열고 로그인을 생략한다(서버가 세션을 붙인다). AEGI_PASSWORD 를 주면 운영처럼 비밀번호로 연다.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { AUTH_KEY, handleMeasured, issueSession, pbkdf2, SESSION_COOKIE, SESSION_TTL_S, type KvLike, type MeasuredEnv } from '../vendor/dashboard/server/measured.ts'
import type { Transport } from '../vendor/engine/scripts/collect/lib/http.ts'
import { processOne } from '../vendor/engine/scripts/compliance/worker.ts'
import type { LocalDb } from './db.ts'
import { accessPassword, assistantEnv, localTokenStatus, reloadEnvFromDisk, saveEnvValues, type AiTestRecord } from './env.ts'
import { fetchAiModels, runAiTest } from './aiTest.ts'
import { WORKSPACE_ID, createLogServices, type LogServices } from './logs.ts'
import { handleOAuthCallback, listGitHubOrganizations, renderCallbackHtml, revokeAndDisconnectProvider, startOAuth, testCredentialConnection, type OAuthProvider } from './oauth.ts'
import { VENDOR, WEB_DIR } from './paths.ts'
import { collectAndPublish, publishSample } from './pipeline.ts'
import { findPython } from './standards.ts'
import { collectorStatus } from './status.ts'
import { checkSplunk, ensureSplunkSourcesFile } from './splunk.ts'
import { attachHttpAndHttpsMultiplexer, ensureLocalTls } from './tls.ts'
import type { Wire } from '../vendor/engine/scripts/stream/splunk/transport.ts'
import type { Relay } from '../vendor/dashboard/server/splunkRelay.ts'

export const DEFAULT_PORT = 5199

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.map': 'application/json',
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

/** KV auth/v1 기록. 비밀번호가 없으면 아무도 모르는 임의 비밀번호를 둔다(로그인은 아래 세션 주입으로 대신한다) */
async function authRecord(password: string | undefined) {
  const salt = randomBytes(16), iterations = 100_000
  const hash = await pbkdf2(password || randomBytes(24).toString('hex'), new Uint8Array(salt), iterations)
  const sessionSecret = b64(randomBytes(32))
  return { text: JSON.stringify({ password: { alg: 'PBKDF2-SHA256', iterations, salt: b64(salt), hash: b64(hash) }, session_secret: sessionSecret }), sessionSecret }
}

/**
 * 비밀번호 없는 로컬 모드의 세션. 운영의 공개 접속(open_until)은 로그 검색을 막으므로, 대신 서버가 서명한 세션 하나를
 * 모든 API 요청에 붙인다. 로그 조회 작업은 세션 해시로 주인을 가리므로 만료 전까지 같은 세션을 쓴다.
 */
function localSession(secret: string) {
  let current: { value: string; until: number } | null = null
  return async (now = Date.now()) => {
    if (!current || current.until - now < 3600_000) current = { value: await issueSession(secret, now), until: now + SESSION_TTL_S * 1000 }
    return current.value
  }
}

export interface ServerOptions {
  host: string
  port: number
  env: Record<string, string>
  local: LocalDb
  logs: LogServices | null
  /** 테스트 주입용 OAuth/자격증명 점검 HTTP 전송 계층 */
  oauthTransport?: Transport
  /** 테스트 주입용 수집 실행기 */
  collectRunner?: (provider?: string, log?: (line: string) => void) => Promise<unknown>
  /** 테스트 주입용 Splunk wire */
  splunkWire?: Wire
  /** 테스트 주입용 AI fetch */
  aiFetch?: typeof fetch
}

export function buildPortWarning(port: number): string | null {
  if (port === DEFAULT_PORT) return null
  return `현재 포트(${port})가 기본 포트(${DEFAULT_PORT})와 다릅니다. 내장 OAuth 앱을 쓰면 기본 포트로 다시 실행하세요. 직접 등록한 앱은 Redirect URI에 실제 콜백 경로 http://127.0.0.1:${port}/__aegi/oauth/callback 를 등록하세요.`
}

async function readJsonBody(req: http.IncomingMessage, limitBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > limitBytes) {
      throw Object.assign(new Error('요청 본문이 너무 큽니다.'), { status: 413, code: 'payload_too_large' })
    }
    chunks.push(buf)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('JSON 객체가 필요합니다.'), { status: 400, code: 'invalid_json' })
  }
  return parsed as Record<string, unknown>
}

export function maskSecrets(line: string): string {
  return line
    .replace(/(xox[abp]-)[^\s,;'"]+/gi, '$1***')
    .replace(/(ghp_)[^\s,;'"]+/gi, '$1***')
    .replace(/(gho_)[^\s,;'"]+/gi, '$1***')
    .replace(/(Bearer\s+)[^\s,;'"]+/gi, '$1***')
    .replace(/-----BEGIN[^\r\n]*/gi, '-----BEGIN***')
}

export interface CollectStatus {
  state: 'idle' | 'running' | 'done' | 'failed'
  jobId: string | null
  provider: string | null
  startedAt: string | null
  finishedAt: string | null
  step: string | null
  lines: string[]
  result: unknown
  error: string | null
}

export async function startServer(o: ServerOptions): Promise<http.Server> {
  // 서버 기동마다 새 값이다. 화면은 이전 서버의 연결 상태를 현재 서버 것으로 오인하지 않는다.
  const serverBootId = randomBytes(16).toString('hex')
  const auth = await authRecord(accessPassword(o.env) || undefined)
  const kv: KvLike = { get: async key => (key === AUTH_KEY ? auth.text : null) }
  const session = accessPassword(o.env) ? null : localSession(auth.sessionSecret)
  let currentLogs: LogServices | null = o.logs
  const env: MeasuredEnv = {
    MEASURED_KV: kv, EXCEPTIONS_DB: o.local.d1, AEGI_COMPLIANCE_WORKSPACE: WORKSPACE_ID, ...assistantEnv(o.env),
    // Splunk 설정이 없으면 대시보드가 Timeline, AI 로그 검색을 splunk_not_configured 로 끈다
    ...(currentLogs ? { AEGI_SPLUNK_TRANSPORT: 'connector', AEGI_SPLUNK_CONNECTOR_KEY: 'local', AEGI_SPLUNK_WORKSPACE: WORKSPACE_ID, AEGI_SPLUNK_POLICY_VERSION: currentLogs.workspace.policyVersion } : {}),
  }
  const deps: { splunkRelay?: Relay } = currentLogs ? { splunkRelay: currentLogs.relay } : {}

  // 엔진 pythonEvaluate 와 같은 일을 하되, Python 은 설치판의 findPython(AEGI_PYTHON 우선)으로 찾는다
  const CHECKS_PY = path.join(VENDOR, 'engine', 'scripts', 'compliance', 'checks.py')

  const evaluate = async (check: string, objects: unknown[], policy: unknown): Promise<unknown> => {
    const python = findPython({ ...process.env, ...o.env })
    if (!python) {
      console.log('Python 3을 찾을 수 없어 Compliance 검사를 실패 처리합니다.')
      throw new Error('evaluation_failed')
    }
    const proc = spawnSync(python, [CHECKS_PY], {
      input: JSON.stringify({ check, objects, policy }),
      encoding: 'utf8',
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 20 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
    })
    if (proc.status !== 0 || proc.error) throw new Error('evaluation_failed')
    const parsed = JSON.parse(proc.stdout) as { check_version: string; result: unknown }
    return { ...(parsed.result as object), check_version: parsed.check_version }
  }

  let complianceRunning = false
  let complianceRerunRequested = false

  const drainComplianceQueue = async () => {
    if (complianceRunning) {
      complianceRerunRequested = true
      return
    }
    complianceRunning = true
    try {
      do {
        complianceRerunRequested = false
        while (await processOne(o.local.exec, WORKSPACE_ID, evaluate)) {
          // pending 요청이 없을 때까지 처리
        }
      } while (complianceRerunRequested)
    } catch (err) {
      console.error('[Compliance worker error]', err)
    } finally {
      complianceRunning = false
    }
  }

  const refreshLogs = () => {
    try {
      currentLogs = createLogServices(o.local, o.env, o.splunkWire ? { wire: o.splunkWire } : undefined)
    } catch {
      currentLogs = null
    }
    if (currentLogs) {
      env.AEGI_SPLUNK_TRANSPORT = 'connector'
      env.AEGI_SPLUNK_CONNECTOR_KEY = 'local'
      env.AEGI_SPLUNK_WORKSPACE = WORKSPACE_ID
      env.AEGI_SPLUNK_POLICY_VERSION = currentLogs.workspace.policyVersion
      deps.splunkRelay = currentLogs.relay
    } else {
      delete env.AEGI_SPLUNK_TRANSPORT
      delete env.AEGI_SPLUNK_CONNECTOR_KEY
      delete env.AEGI_SPLUNK_WORKSPACE
      delete env.AEGI_SPLUNK_POLICY_VERSION
      delete deps.splunkRelay
    }
  }

  let collecting = false
  let lastAiTest: AiTestRecord | null = null
  const collectStatus: CollectStatus = {
    state: 'idle',
    jobId: null,
    provider: null,
    startedAt: null,
    finishedAt: null,
    step: null,
    lines: [],
    result: null,
    error: null,
  }

  const actualPort = (): number => {
    const addr = server.address()
    return (addr && typeof addr === 'object' && typeof addr.port === 'number') ? addr.port : o.port
  }

  const detectOpCli = (): { installed: boolean; version?: string } => {
    try {
      const r = spawnSync('op', ['--version'], { encoding: 'utf8', timeout: 1500, windowsHide: true })
      if (r.status === 0 && r.stdout.trim()) return { installed: true, version: r.stdout.trim().split(/\r?\n/)[0] }
      return { installed: false }
    } catch {
      return { installed: false }
    }
  }
  const opCli = detectOpCli()

  const buildLocalTokenPayload = () => {
    const port = actualPort()
    return {
      ...localTokenStatus(o.env, lastAiTest),
      port,
      defaultPort: DEFAULT_PORT,
      server_boot_id: serverBootId,
      redirectUri: `http://127.0.0.1:${port}/__aegi/oauth/callback`,
      portWarning: buildPortWarning(port),
      collecting,
      opCli,
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${o.host}:${o.port}`}`)
      if (url.pathname.startsWith('/api/measured/')) return await api(req, res, url)

      if (url.pathname === '/__aegi/collector-status') {
        const port = actualPort()
        const statusPayload = {
          ...collectorStatus(o.env),
          port,
          defaultPort: DEFAULT_PORT,
          redirectUri: `http://127.0.0.1:${port}/__aegi/oauth/callback`,
          portWarning: buildPortWarning(port),
          collecting,
        }
        return send(res, 200, JSON.stringify(statusPayload), TYPES['.json']!)
      }

      if (url.pathname === '/__aegi/local-token') {
        if (!isLoopbackAddress(req.socket.remoteAddress)) return send(res, 403, '{"error":"loopback_only"}', TYPES['.json']!)
        if (req.method === 'GET') {
          return send(res, 200, JSON.stringify(buildLocalTokenPayload()), TYPES['.json']!)
        }
        if (req.method === 'POST') {
          if (!isAllowedOrigin(req)) return send(res, 403, '{"error":"bad_origin"}', TYPES['.json']!)
          if (collecting) {
            return send(res, 409, JSON.stringify({ error: 'collection_in_progress', detail: '수집 실행 중에는 자격증명을 바꿀 수 없습니다.' }), TYPES['.json']!)
          }
          const body = await readJsonBody(req)
          const values = (body.values && typeof body.values === 'object' && !Array.isArray(body.values))
            ? (body.values as Record<string, string>)
            : null
          if (!values) return send(res, 400, '{"error":"values_required"}', TYPES['.json']!)
          try {
            if (body.disconnect === true && typeof body.provider === 'string') {
              const disconnectOutcome = await revokeAndDisconnectProvider(body.provider, values, o.env, undefined, o.oauthTransport)
              Object.assign(env, assistantEnv(o.env))
              return send(res, 200, JSON.stringify({ ...buildLocalTokenPayload(), disconnectOutcome }), TYPES['.json']!)
            }
            saveEnvValues(values, o.env)
            Object.assign(env, assistantEnv(o.env))
            if (Object.keys(values).some(k => k.startsWith('AEGI_ASSISTANT_') || k.endsWith('_API_KEY'))) {
              lastAiTest = null
            }
            if (Object.keys(values).some(k => k.startsWith('SPLUNK_'))) {
              refreshLogs()
            }
            return send(res, 200, JSON.stringify(buildLocalTokenPayload()), TYPES['.json']!)
          } catch (err) {
            const e = err as Error & { code?: string }
            return send(res, 400, JSON.stringify({ error: e.code || 'invalid_env_key', detail: e.message }), TYPES['.json']!)
          }
        }
        return send(res, 405, '{"error":"method_not_allowed"}', TYPES['.json']!)
      }

      if (url.pathname === '/__aegi/local-token-test') {
        if (!isLoopbackAddress(req.socket.remoteAddress)) return send(res, 403, '{"error":"loopback_only"}', TYPES['.json']!)
        if (req.method !== 'POST') return send(res, 405, '{"error":"method_not_allowed"}', TYPES['.json']!)
        if (!isAllowedOrigin(req)) return send(res, 403, '{"error":"bad_origin"}', TYPES['.json']!)
        const body = await readJsonBody(req)
        const credentialId = typeof body.credentialId === 'string' ? body.credentialId : ''
        const authMode = body.mode === 'oauth' || body.mode === 'manual' ? body.mode : undefined
        const values = (body.values && typeof body.values === 'object' && !Array.isArray(body.values))
          ? (body.values as Record<string, string>)
          : {}
        const result = await testCredentialConnection(credentialId, values, o.env, undefined, o.oauthTransport, authMode)
        return send(res, 200, JSON.stringify(result), TYPES['.json']!)
      }

      if (url.pathname === '/__aegi/oauth/start') {
        if (!isLoopbackAddress(req.socket.remoteAddress)) return send(res, 403, '{"error":"loopback_only"}', TYPES['.json']!)
        if (req.method !== 'POST') return send(res, 405, '{"error":"method_not_allowed"}', TYPES['.json']!)
        if (!isAllowedOrigin(req)) return send(res, 403, '{"error":"bad_origin"}', TYPES['.json']!)
        if (collecting) {
          return send(res, 409, JSON.stringify({ error: 'collection_in_progress', detail: '수집 실행 중에는 자격증명을 바꿀 수 없습니다.' }), TYPES['.json']!)
        }
        const body = await readJsonBody(req)
        try {
          const started = startOAuth(body, { port: actualPort(), env: o.env })
          console.log(`[OAuth start] provider=${String(body.provider ?? '')} state=${started.state}`)
          return send(res, 200, JSON.stringify(started), TYPES['.json']!)
        } catch (err) {
          const e = err as Error & { status?: number; code?: string }
          console.error(`[OAuth start error] provider=${String(body.provider ?? '')} code=${e.code ?? ''} msg=${e.message}`)
          return send(res, e.status || 400, JSON.stringify({ error: e.code || 'oauth_start_failed', detail: e.message }), TYPES['.json']!)
        }
      }

      if (url.pathname === '/__aegi/oauth/callback' || url.pathname === '/callback') {
        if (!isLoopbackAddress(req.socket.remoteAddress)) return send(res, 403, 'forbidden', TYPES['.txt']!)
        if (req.method !== 'GET') return send(res, 405, 'method not allowed', TYPES['.txt']!)
        if (collecting) {
          return send(res, 409, JSON.stringify({ error: 'collection_in_progress', detail: '수집 실행 중에는 자격증명을 바꿀 수 없습니다.' }), TYPES['.json']!)
        }
        const outcome = await handleOAuthCallback(url.searchParams, {
          port: actualPort(),
          env: o.env,
          transport: o.oauthTransport,
        })
        console.log(`[OAuth callback] provider=${outcome.provider ?? 'unknown'} ok=${outcome.ok} status=${outcome.status}${outcome.error ? ` error=${outcome.error}` : ''}`)
        return send(res, outcome.status, outcome.html, TYPES['.html']!)
      }

      
      if (url.pathname === '/__aegi/github/orgs') {
        if (!isLoopbackAddress(req.socket.remoteAddress)) return send(res, 403, '{"error":"loopback_only"}', TYPES['.json']!)
        if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, '{"error":"method_not_allowed"}', TYPES['.json']!)
        if (!isAllowedOrigin(req)) return send(res, 403, '{"error":"bad_origin"}', TYPES['.json']!)
        let queryEnv = o.env
        if (req.method === 'POST') {
          const body = await readJsonBody(req).catch(() => ({}))
          if (body && typeof body.token === 'string' && body.token.trim()) {
            queryEnv = { ...o.env, GITHUB_OWNER_TOKEN: body.token.trim() }
          }
        }
        const result = await listGitHubOrganizations(queryEnv, o.oauthTransport)
        return send(res, 200, JSON.stringify(result), TYPES['.json']!)
      }
      if (url.pathname === '/__aegi/oauth/done') {
        if (!isLoopbackAddress(req.socket.remoteAddress)) return send(res, 403, 'forbidden', TYPES['.txt']!)
        if (req.method !== 'GET') return send(res, 405, 'method not allowed', TYPES['.txt']!)
        const ok = url.searchParams.get('ok') === '1'
        const provider = (url.searchParams.get('provider') || undefined) as OAuthProvider | undefined
        const fingerprint = url.searchParams.get('fingerprint') || undefined
        const error = url.searchParams.get('error') || undefined
        const html = renderCallbackHtml(actualPort(), { ok, provider, fingerprint, error })
        return send(res, ok ? 200 : 400, html, TYPES['.html']!)
      }

      if (url.pathname === '/__aegi/collect-status') {
        if (!isLoopbackAddress(req.socket.remoteAddress)) return send(res, 403, '{"error":"loopback_only"}', TYPES['.json']!)
        if (req.method !== 'GET') return send(res, 405, '{"error":"method_not_allowed"}', TYPES['.json']!)
        return send(res, 200, JSON.stringify(collectStatus), TYPES['.json']!)
      }

      if (url.pathname === '/__aegi/sample') {
        if (!isLoopbackAddress(req.socket.remoteAddress)) return send(res, 403, '{"error":"loopback_only"}', TYPES['.json']!)
        if (req.method !== 'POST') return send(res, 405, '{"error":"method_not_allowed"}', TYPES['.json']!)
        if (!isAllowedOrigin(req)) return send(res, 403, '{"error":"bad_origin"}', TYPES['.json']!)
        if (collecting) {
          return send(res, 409, JSON.stringify({ error: 'collection_in_progress', detail: '수집 실행 중에는 샘플을 게시할 수 없습니다.' }), TYPES['.json']!)
        }
        try {
          await publishSample(o.local, () => undefined)
          return send(res, 200, '{"ok":true}', TYPES['.json']!)
        } catch (err) {
          return send(res, 500, JSON.stringify({ ok: false, error: 'publish_sample_failed', detail: err instanceof Error ? err.message : String(err) }), TYPES['.json']!)
        }
      }

      if (url.pathname === '/__aegi/splunk-test') {
        if (!isLoopbackAddress(req.socket.remoteAddress)) return send(res, 403, '{"error":"loopback_only"}', TYPES['.json']!)
        if (req.method !== 'POST') return send(res, 405, '{"error":"method_not_allowed"}', TYPES['.json']!)
        if (!isAllowedOrigin(req)) return send(res, 403, '{"error":"bad_origin"}', TYPES['.json']!)
        const body = await readJsonBody(req)
        if (body.initSources) {
          const r = ensureSplunkSourcesFile(o.env)
          return send(res, 200, JSON.stringify({ ok: true, created: r.created, path: r.path }), TYPES['.json']!)
        }
        if (o.env.SPLUNK_URL && o.env.SPLUNK_TOKEN) ensureSplunkSourcesFile(o.env)
        try {
          const testLogs = createLogServices(o.local, o.env, o.splunkWire ? { wire: o.splunkWire } : undefined)
          if (!testLogs) {
            return send(res, 200, JSON.stringify({ ok: false, error: 'SPLUNK_URL 과 SPLUNK_TOKEN 이 설정되지 않았습니다.' }), TYPES['.json']!)
          }
          const result = await checkSplunk(testLogs.transport, testLogs.workspace)
          if (result.ok) {
            currentLogs = testLogs
            env.AEGI_SPLUNK_TRANSPORT = 'connector'
            env.AEGI_SPLUNK_CONNECTOR_KEY = 'local'
            env.AEGI_SPLUNK_WORKSPACE = WORKSPACE_ID
            env.AEGI_SPLUNK_POLICY_VERSION = testLogs.workspace.policyVersion
            deps.splunkRelay = testLogs.relay
          }
          return send(res, 200, JSON.stringify({
            ok: result.ok,
            error: result.error,
            sources: result.sources.map(s => ({ ref: s.ref, events: s.events, latest: s.latest, index: s.index, sourcetype: s.sourcetype }))
          }), TYPES['.json']!)
        } catch (err) {
          return send(res, 200, JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }), TYPES['.json']!)
        }
      }

      if (url.pathname === '/__aegi/ai-test') {
        if (!isLoopbackAddress(req.socket.remoteAddress)) return send(res, 403, '{"error":"loopback_only"}', TYPES['.json']!)
        if (req.method !== 'POST') return send(res, 405, '{"error":"method_not_allowed"}', TYPES['.json']!)
        if (!isAllowedOrigin(req)) return send(res, 403, '{"error":"bad_origin"}', TYPES['.json']!)
        const body = await readJsonBody(req)
        const { result, record } = await runAiTest(body, o.env, o.aiFetch)
        lastAiTest = record
        return send(res, 200, JSON.stringify(result), TYPES['.json']!)
      }

      if (url.pathname === '/__aegi/ai-models') {
        if (!isLoopbackAddress(req.socket.remoteAddress)) return send(res, 403, '{"error":"loopback_only"}', TYPES['.json']!)
        if (req.method !== 'POST') return send(res, 405, '{"error":"method_not_allowed"}', TYPES['.json']!)
        if (!isAllowedOrigin(req)) return send(res, 403, '{"error":"bad_origin"}', TYPES['.json']!)
        const body = await readJsonBody(req)
        const result = await fetchAiModels(body, o.env, o.aiFetch)
        return send(res, 200, JSON.stringify(result), TYPES['.json']!)
      }

      if (url.pathname === '/__aegi/collect') {
        if (!isLoopbackAddress(req.socket.remoteAddress)) return send(res, 403, '{"error":"loopback_only"}', TYPES['.json']!)
        if (req.method !== 'POST') return send(res, 405, '{"error":"method_not_allowed"}', TYPES['.json']!)
        if (!isAllowedOrigin(req)) return send(res, 403, '{"error":"bad_origin"}', TYPES['.json']!)
        if (collecting) {
          return send(res, 409, JSON.stringify({ error: 'collection_in_progress', detail: '이미 수집이 실행 중입니다.' }), TYPES['.json']!)
        }
        const body = await readJsonBody(req)
        const provider = typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim() : undefined
        const jobId = randomBytes(8).toString('hex')
        collecting = true
        collectStatus.state = 'running'
        collectStatus.jobId = jobId
        collectStatus.provider = provider ?? null
        collectStatus.startedAt = new Date().toISOString()
        collectStatus.finishedAt = null
        collectStatus.step = null
        collectStatus.lines = []
        collectStatus.result = null
        collectStatus.error = null

        const onLog = (rawLine: string) => {
          const parts = String(rawLine).split(/\r?\n/)
          for (const p of parts) {
            const masked = maskSecrets(p)
            collectStatus.lines.push(masked)
            if (collectStatus.lines.length > 200) collectStatus.lines.shift()
            if (/^\s*\d+\/\d+/.test(masked)) {
              collectStatus.step = masked.trim()
            }
          }
        }

        const runFn = o.collectRunner ?? (async (only?: string, log?: (line: string) => void) => collectAndPublish(o.local, o.env, log ?? (() => undefined), { only }))

        void Promise.resolve()
          .then(() => runFn(provider, onLog))
          .then(result => {
            collectStatus.state = 'done'
            collectStatus.finishedAt = new Date().toISOString()
            collectStatus.result = result ?? null
          })
          .catch(err => {
            collectStatus.state = 'failed'
            collectStatus.finishedAt = new Date().toISOString()
            collectStatus.error = err instanceof Error ? err.message : String(err)
          })
          .finally(() => {
            reloadEnvFromDisk(o.env)
            collecting = false
          })

        return send(res, 202, JSON.stringify({ ok: true, jobId }), TYPES['.json']!)
      }

      if (url.pathname.startsWith('/api/')) return send(res, 404, '{"error":"not_found"}', TYPES['.json']!)
      return serveStatic(res, url.pathname)
    } catch (err) {
      console.error(`[서버] ${req.method} ${req.url}: ${err instanceof Error ? err.stack : err}`)
      if (!res.headersSent) send(res, 500, '{"error":"local_server_failed"}', TYPES['.json']!)
      else res.end()
    }
  })

  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
    // 운영의 Cloudflare 와 같이 클라이언트 주소를 넘긴다(요청 한도 계산용)
    headers.set('CF-Connecting-IP', req.socket.remoteAddress ?? '127.0.0.1')
    if (session) headers.set('Cookie', `${SESSION_COOKIE}=${await session()}`)
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks)
    const response = await handleMeasured(new Request(url, { method: req.method, headers, body }), env, deps)
    // 검사(Python, 동기 실행)는 응답을 보낸 뒤 돌린다
    const runQueued = req.method === 'POST' && url.pathname.replace(/\/$/, '') === '/api/measured/compliance/runs' && response.ok
    const out: Record<string, string | string[]> = {}
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v })
    const cookies = response.headers.getSetCookie()
    // http://localhost 에서는 Secure 쿠키를 브라우저가 받는다. 다른 주소로 열면 Secure 를 뺀다
    if (cookies.length) out['set-cookie'] = isLoopback(url.hostname) ? cookies : cookies.map(c => c.replace(/;\s*Secure/i, ''))
    res.writeHead(response.status, out)
    res.end(Buffer.from(await response.arrayBuffer()))
    if (runQueued) setImmediate(() => { void drainComplianceQueue() })
  }

  function serveStatic(res: http.ServerResponse, pathname: string) {
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '')
    let file = path.resolve(WEB_DIR, rel)
    if (!file.startsWith(WEB_DIR)) return send(res, 403, 'forbidden', TYPES['.txt']!)
    if (!rel || !existsSync(file) || statSync(file).isDirectory()) {
      // 화면 주소(#graph 등)는 index.html 이 받는다. 확장자가 있는 없는 파일은 404
      if (path.extname(rel)) return send(res, 404, 'not found', TYPES['.txt']!)
      file = path.join(WEB_DIR, 'index.html')
    }
    const immutable = rel.startsWith('assets/')
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' })
    createReadStream(file).pipe(res)
  }

  attachHttpAndHttpsMultiplexer(server, ensureLocalTls().secureContext)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(o.port, o.host, resolve) })
  void drainComplianceQueue()
  return server
}

const isLoopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host)
const isLoopbackAddress = (addr?: string) => !addr || ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr)

function isAllowedOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const u = new URL(origin)
    return isLoopback(u.hostname)
  } catch {
    return false
  }
}

function send(res: http.ServerResponse, status: number, body: string, type: string) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}
