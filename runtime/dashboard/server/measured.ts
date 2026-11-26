/**
 * 실측 데이터셋 API (계획서 D-15 재개정, 2026-09-27). Pages Function `functions/api/measured/[[path]].ts` 가 부른다.
 *
 *   POST /api/measured/login    {"password": "..."} → 맞으면 서명한 세션 쿠키(12시간)
 *   POST /api/measured/logout   세션 쿠키 지우기
 *   GET  /api/measured/dataset  세션 쿠키가 있을 때만 실측 번들(JSON)
 *   GET  /api/measured/dataset-v2  같은 조건으로 실측 v2 번들(aegi-adapter-engine의 IM Profile 실행기가 만들고 D1에 게시한다)
 *   GET·POST /api/measured/exceptions…  같은 세션으로 실측 데이터셋의 위협 예외(D1 `EXCEPTIONS_DB`) — server/exceptions.ts
 *   GET·POST /api/measured/credentials…  같은 세션으로 수집 자격증명·계정 대장(같은 D1, 비밀값 없음) — server/credentials.ts
 *   GET·POST /api/measured/handling  같은 세션으로 위협 처리 상태(같은 D1) — server/handling.ts
 *   GET·POST /api/measured/remediation-progress  같은 세션으로 조치 진행 상태(같은 D1) — server/remediationProgress.ts
 *   GET·POST /api/measured/compliance-exceptions  같은 세션으로 컴플라이언스 예외(같은 D1) — server/complianceExceptions.ts
 *   GET·POST /api/measured/investigations  같은 세션으로 조사 보드(같은 D1) — server/investigations.ts
 *   GET  /api/measured/graph/…  같은 세션으로 D1 그래프와 Splunk Connector 이벤트 조회 — server/graph.ts
 *
 * 공개 번들에는 실측 데이터가 없다. 팀 공용 비밀번호를 KV(`auth/v1`)의 PBKDF2 해시와 대조한다 — 원문은 어디에도
 * 저장하지 않는다. 세션 쿠키는 KV 의 세션 비밀키로 HMAC 서명하고, 비밀번호와 세션 키를 함께 교체하면(docs/operations/measured-admin.md)
 * 비밀키도 바뀌어 기존 세션이 모두 끊긴다. KV 바인딩이나 인증 정보가 없으면 503 으로 닫힌다.
 * 무작위 비밀번호(스크립트가 만든다)를 전제로 시도 횟수 제한은 두지 않는다. Workers 무료 플랜 CPU 한도(10ms) 때문에
 * PBKDF2 반복은 로그인 때만, 번들은 파싱하지 않고 텍스트 그대로 내보낸다.
 */
import { handleCredentials } from './credentials'
import { handleHandling } from './handling'
import { handleComplianceExceptions } from './complianceExceptions'
import { handleRemediationProgress } from './remediationProgress'
import { handleInvestigations } from './investigations'
import { handleAssistantPlan } from './assistant/handler'
import { handleAssistantChat } from './assistant/chat'
import { timedD1, type D1Stat } from './d1Timing'
import type { AssistantEnv, PlannerDeps } from './assistant/planner'
import { handleExceptions, type D1Like } from './exceptions'
import { handleGraphRequest } from './graph'
import { bundleTextForSnapshot } from './snapshotBundle'
import { acceptsBrotli, readDatasetBrotli } from './datasetBrotli'
import { createSplunkTransport, splunkMode, usesSplunk, type SplunkEnv } from './splunkTransport'
import { D1Relay, type Relay } from './splunkRelay'
import { logEventLinks, logEventsRead, logEventsStatus, logEventTool } from './logEvents'
import type { LogToolDeps } from './assistant/logTools'
import { currentSnapshotId, withSnapshotPin } from './snapshotGraph'
import { standardHistory } from './standardHistory'
import { readBoundedText } from './assistant/planner'
import { compliance } from './compliance'

export const DATASET_KEY = 'dataset/v1'
export const AUTH_KEY = 'auth/v1'
export const SESSION_COOKIE = 'aegi_measured'
export const SESSION_TTL_S = 12 * 60 * 60

export interface KvLike {
  get(key: string, type: 'text'): Promise<string | null>
}

export interface MeasuredEnv extends AssistantEnv, SplunkEnv {
  AEGI_COMPLIANCE_WORKSPACE?: string
  MEASURED_KV?: KvLike
  /** 위협 예외 · 수집 자격증명 대장 저장소 (docs/operations/measured-admin.md에서 생성과 바인딩을 설명한다). 없으면 해당 DB 기능은 503 */
  EXCEPTIONS_DB?: D1Like
  /** 그래프를 graph_head current 대신 이 스냅샷에서 읽는다(공개 데모). 없으면 current. server/snapshotGraph.ts withSnapshotPin */
  AEGI_GRAPH_SNAPSHOT_ID?: string
}

export interface HandlerDeps {
  now?: number
  assistant?: PlannerDeps
  /** Tests inject a relay with short intervals; production builds a D1Relay over EXCEPTIONS_DB. */
  splunkRelay?: Relay
}

/** KV `auth/v1` — docs/operations/measured-admin.md의 인증 레코드 관리 절차를 따른다 */
export interface AuthRecord {
  password: { alg: 'PBKDF2-SHA256'; iterations: number; salt: string; hash: string }
  session_secret: string
  updated_at?: string
  /** 발표용 공개 시각(ISO). 이 시각 전에는 로그인 없이 연다. 관리자가 open_until을 설정/제거한다(관리 절차 참고) */
  open_until?: string
}

const enc = new TextEncoder()

function b64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256))
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64ToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage])
}

export async function issueSession(secret: string, now: number): Promise<string> {
  const payload = `v1.${Math.floor(now / 1000) + SESSION_TTL_S}`
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(payload)))
  return `${payload}.${bytesToB64url(sig)}`
}

export async function verifySession(value: string | null, secret: string, now: number): Promise<boolean> {
  const m = value ? /^(v1\.(\d{1,12}))\.([A-Za-z0-9_-]{43})$/.exec(value) : null
  if (!m || Number(m[2]) * 1000 <= now) return false
  return crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), b64ToBytes(m[3]), enc.encode(m[1]))
}

/** 세션 쿠키가 맞거나, 발표용 공개 시간 안이면 통과 */
async function signedIn(request: Request, auth: AuthRecord, now: number): Promise<boolean> {
  if (auth.open_until && Date.parse(auth.open_until) > now) return true
  return verifySession(readCookie(request, SESSION_COOKIE), auth.session_secret, now)
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

function sessionCookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/api/measured; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`
}

const BASE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' }

function json(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra } })
}

async function readAuth(kv: KvLike): Promise<AuthRecord | null> {
  try {
    const raw = await kv.get(AUTH_KEY, 'text')
    const rec = raw ? (JSON.parse(raw) as AuthRecord) : null
    return rec?.password?.alg === 'PBKDF2-SHA256' && rec.password.hash && rec.password.salt && rec.session_secret ? rec : null
  } catch {
    return null
  }
}

/** 다른 사이트에서 보낸 요청(폼 CSRF)을 막는다: JSON 본문 + 같은 출처 */
function sameOriginJson(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) return false
  return (request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')
}

export async function handleMeasured(request: Request, env: MeasuredEnv, deps: HandlerDeps = {}): Promise<Response> {
  env = { ...env, EXCEPTIONS_DB: withSnapshotPin(env.EXCEPTIONS_DB, env.AEGI_GRAPH_SNAPSHOT_ID) }
  const now = deps.now ?? Date.now()
  const url = new URL(request.url)
  const route = url.pathname.replace(/^\/api\/measured\/?/, '').replace(/\/$/, '')
  const allowed: Record<string, string> = { login: 'POST', logout: 'POST', dataset: 'GET', 'dataset-v2': 'GET', 'standard-results': 'GET', 'standard-results/history': 'GET' }
  if (route === 'compliance' || route.startsWith('compliance/')) {
    if (request.method !== 'GET' && request.method !== 'POST') return json(405, {error:'method_not_allowed'})
    const auth = env.MEASURED_KV ? await readAuth(env.MEASURED_KV) : null
    if (!auth || !env.EXCEPTIONS_DB || !env.AEGI_COMPLIANCE_WORKSPACE) return json(503, {error:'not_configured'})
    // Public demo access is not authorization to read or change company policy.
    if (!(await verifySession(readCookie(request, SESSION_COOKIE), auth.session_secret, now))) return json(401, {error:'login_required'})
    if (request.method === 'POST' && !sameOriginJson(request, url)) return json(403, {error:'bad_request_origin'})
    try { return await compliance(request, route, env.EXCEPTIONS_DB, env.AEGI_COMPLIANCE_WORKSPACE, json, now) }
    catch { return json(503, {error:'compliance_unavailable'}) }
  }
  if (route === 'exceptions' || route.startsWith('exceptions/')) return teamDbRoute(request, url, route, env, now, 'exceptions')
  if (route === 'credentials' || route.startsWith('credentials/')) return teamDbRoute(request, url, route, env, now, 'credentials')
  if (route === 'handling') return teamDbRoute(request, url, route, env, now, 'handling')
  if (route === 'remediation-progress') return teamDbRoute(request, url, route, env, now, 'remediation-progress')
  if (route === 'compliance-exceptions') return teamDbRoute(request, url, route, env, now, 'compliance-exceptions')
  if (route === 'investigations') return teamDbRoute(request, url, route, env, now, 'investigations')
  if (route === 'graph' || route.startsWith('graph/')) return graphRoute(request, url, route.slice('graph'.length).replace(/^\/+/, ''), env, now, deps)
  if (route === 'assistant/plan' || route === 'assistant/chat') {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'POST' })
    const auth = env.MEASURED_KV ? await readAuth(env.MEASURED_KV) : null
    if (!auth) return json(503, { error: 'not_configured' })
    if (!(await signedIn(request, auth, now))) return json(401, { error: 'login_required' })
    if (!sameOriginJson(request, url)) return json(403, { error: 'bad_request_origin' })
    const client = request.headers.get('CF-Connecting-IP') || 'team'
    if (route === 'assistant/plan') return handleAssistantPlan(request, env, json, client, now, deps.assistant)
    // graph: chat steps run graph tools next to D1 when the browser sends its snapshot (runAssistantSteps).
    return handleAssistantChat(request, env, json, client, now, { ...deps.assistant, logs: await assistantLogs(request, env, auth, now, deps), graph: env.EXCEPTIONS_DB })
  }
  if (!allowed[route]) return json(404, { error: 'not_found' })
  if (request.method !== allowed[route]) return json(405, { error: 'method_not_allowed' }, { Allow: allowed[route] })

  if (route === 'logout') return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) })

  const kv = env.MEASURED_KV
  const auth = kv ? await readAuth(kv) : null
  if (!kv || !auth) return json(503, { error: 'not_configured' })

  if (route === 'login') {
    if (!sameOriginJson(request, url)) return json(403, { error: 'bad_request_origin' })
    let password: unknown
    try {
      password = ((await request.json()) as { password?: unknown }).password
    } catch {
      return json(400, { error: 'bad_request' })
    }
    if (typeof password !== 'string' || !password || password.length > 256) return json(400, { error: 'bad_request' })
    const { iterations, salt, hash } = auth.password
    const ok = sameBytes(await pbkdf2(password, b64ToBytes(salt), iterations), b64ToBytes(hash))
    if (!ok) return json(401, { error: 'wrong_password' })
    return json(200, { ok: true, expires_in: SESSION_TTL_S }, { 'Set-Cookie': sessionCookie(await issueSession(auth.session_secret, now), SESSION_TTL_S) })
  }

  // dataset · dataset-v2
  if (!(await signedIn(request, auth, now))) return json(401, { error: 'login_required' })
  if (route === 'standard-results' || route === 'standard-results/history') {
    if (!env.EXCEPTIONS_DB) return json(503, { error: 'database_not_configured' })
    return standardHistory(request, env.EXCEPTIONS_DB)
  }
  if (route === 'dataset-v2') {
    if (!env.EXCEPTIONS_DB) return json(503, { error: 'database_not_configured' })
    let snapshotId: string | null = null
    try { snapshotId = await currentSnapshotId(env.EXCEPTIONS_DB) } catch { /* 스냅샷 표가 아직 없는 DB */ }
    if (!snapshotId) return json(404, { error: 'not_published' })
    const headers = { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding' }
    // 미리 최고 압축해 둔 것이 있으면 그대로 보낸다(server/datasetBrotli.ts). Cloudflare 가 다시 압축하지 않게 manual
    const brotli = acceptsBrotli(request) ? await readDatasetBrotli(kv, snapshotId) : null
    // X-Dataset-Chars: 번들 글자 수. 공개 데모 첫 화면이 받기 진행률을 센다(main 의 src/data/datasetSession.ts)
    if (brotli) return new Response(brotli.bytes, { status: 200, headers: { ...headers, 'Content-Encoding': 'br', ...(brotli.chars ? { 'X-Dataset-Chars': String(brotli.chars) } : {}) }, encodeBody: 'manual' } as ResponseInit)
    const bundle = await bundleTextForSnapshot(env.EXCEPTIONS_DB, snapshotId)
    if (!bundle) return json(404, { error: 'not_published' })
    return new Response(bundle, { status: 200, headers: { ...headers, 'X-Dataset-Chars': String(bundle.length) } })
  }
  const body = await kv.get(DATASET_KEY, 'text')
  if (!body) return json(404, { error: 'not_published' })
  return new Response(body, { status: 200, headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } })
}

/** Search principal: the signed session's hash, or for public demo access a hash of the client IP. null means no search. */
async function logPrincipal(request: Request, env: MeasuredEnv, auth: AuthRecord, now: number): Promise<string | null> {
  const session = readCookie(request, SESSION_COOKIE)
  if (session && (await verifySession(session, auth.session_secret, now))) {
    const hash = await crypto.subtle.digest('SHA-256', enc.encode(session))
    return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')
  }
  // Public demo access may search only the demo workspace (its own Gateway, token and index). Production never sets the flag.
  if (env.AEGI_PUBLIC_LOG_SEARCH === 'demo' && env.AEGI_SPLUNK_WORKSPACE === 'demo' && auth.open_until && Date.parse(auth.open_until) > now) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
    const hash = await crypto.subtle.digest('SHA-256', enc.encode(`public:${ip}`))
    return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')
  }
  return null
}

/**
 * AI 로그 도구(search_logs, read_logs)를 실행할 Connector와 D1. 발표용 공개 접속은 데모 워크스페이스를 제외하면 로그를 검색하지 못한다.
 * Splunk나 D1이 설정되지 않았으면 undefined 이고, 도구는 조회 서버에 닿지 못한 것으로 답한다.
 */
async function assistantLogs(request: Request, env: MeasuredEnv, auth: AuthRecord, now: number, deps: HandlerDeps): Promise<LogToolDeps | 'login_required' | undefined> {
  if (!usesSplunk(env) || !env.EXCEPTIONS_DB) return undefined
  const principal = await logPrincipal(request, env, auth, now)
  if (!principal) return 'login_required'
  try {
    const mode = splunkMode(env)
    const transport = createSplunkTransport(env, mode === 'connector' ? deps.splunkRelay ?? new D1Relay(env.EXCEPTIONS_DB) : undefined, deps.assistant?.fetch)
    return { transport, db: env.EXCEPTIONS_DB, scope: { workspace: env.AEGI_SPLUNK_WORKSPACE!, principal, policyVersion: env.AEGI_SPLUNK_POLICY_VERSION! } }
  } catch { return undefined }
}

/** D1 그래프 저장소 — 실측 데이터라 실측 번들과 같은 세션이 있어야 한다. 읽기만 한다 (tools 는 POST 지만 질의만 한다) */
async function graphRoute(request: Request, url: URL, subPath: string, env: MeasuredEnv, now: number, deps: HandlerDeps = {}): Promise<Response> {
  const method = subPath === 'tools' ? 'POST' : 'GET'
  if (request.method !== method) return json(405, { error: 'method_not_allowed' }, { Allow: method })
  const kv = env.MEASURED_KV
  const auth = kv ? await readAuth(kv) : null
  if (!kv || !auth) return json(503, { error: 'not_configured' })
  if (!(await signedIn(request, auth, now))) return json(401, { error: 'login_required' })
  if (method === 'POST' && !sameOriginJson(request, url)) return json(403, { error: 'bad_request_origin' })
  if (!env.EXCEPTIONS_DB) return json(503, { error: 'graph_not_configured' })
  // Either Splunk transport selects live events; incomplete configuration must never select old D1 events.
  const logRoute = subPath === 'events' || subPath === 'events/read' || subPath === 'events/links'
  if ((logRoute || subPath === 'tools') && usesSplunk(env)) {
    // Presentation (open) access never starts searches on the customer's Splunk, except the demo workspace.
    const principal = await logPrincipal(request, env, auth, now)
    const canSearch = principal !== null
    if (logRoute && !canSearch) return json(401, { error: 'login_required' })
    try {
      // Resolve only when an event tool actually runs: graph tools remain available without live Splunk.
      // The connector searches and writes the D1 log cache; Timeline and event_context read finished providers from D1.
      const eventDeps = async () => {
        if (!canSearch) throw new Error('login_required')
        const mode = splunkMode(env)
        const transport = createSplunkTransport(env, mode === 'connector' ? deps.splunkRelay ?? new D1Relay(env.EXCEPTIONS_DB!) : undefined, deps.assistant?.fetch)
        const graphSnapshotId = await currentSnapshotId(env.EXCEPTIONS_DB!)
        return { transport, db: env.EXCEPTIONS_DB!, graphSnapshotId: graphSnapshotId ?? undefined, now: () => now,
          scope: { workspace: env.AEGI_SPLUNK_WORKSPACE!, principal: principal!, policyVersion: env.AEGI_SPLUNK_POLICY_VERSION! } }
      }
      if (subPath === 'tools') return await timedTools(now, stat => handleGraphRequest(request, timedD1(env.EXCEPTIONS_DB!, stat), subPath, json, { readSplunk: async (name, args) => canSearch ? logEventTool(name, args, await eventDeps()) : { status: 401, body: { error: 'login_required' } } }))
      const logDeps = await eventDeps()
      const result = subPath === 'events/read' ? await logEventsRead(url, logDeps) : subPath === 'events/links' ? await logEventLinks(url, logDeps) : await logEventsStatus(url, logDeps)
      return json(result.status, result.body)
    } catch {
      return json(503, { error: 'connector_unreachable' })
    }
  }
  try {
    // Without a Splunk transport there is no event source: the old D1 graph_events path is gone.
    if (logRoute) return json(503, { error: 'splunk_not_configured' })
    if (subPath === 'tools') return await timedTools(now, stat => handleGraphRequest(request, timedD1(env.EXCEPTIONS_DB!, stat), subPath, json))
    return await handleGraphRequest(request, env.EXCEPTIONS_DB, subPath, json)
  } catch {
    return json(500, { error: 'graph_failed' })
  }
}

/** AI graph tool timing: session checks before the tool, D1 wait and query count, total. Durations only. */
async function timedTools(now: number, run: (stat: D1Stat) => Promise<Response>): Promise<Response> {
  const stat: D1Stat = { queries: 0, ms: 0 }, auth = Date.now() - now
  const response = await run(stat)
  response.headers.set('Server-Timing', `auth;dur=${auth}, d1;dur=${stat.ms};desc="${stat.queries} queries", total;dur=${Date.now() - now}`)
  return response
}

/** 위협 예외 · 수집 자격증명 대장 — 실측 번들과 같은 세션이 있어야 한다. 쓰는 요청은 같은 출처의 JSON 만 받는다 */
async function teamDbRoute(request: Request, url: URL, route: string, env: MeasuredEnv, now: number, kind: 'exceptions' | 'credentials' | 'handling' | 'remediation-progress' | 'compliance-exceptions' | 'investigations'): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'GET, POST' })
  const kv = env.MEASURED_KV
  const auth = kv ? await readAuth(kv) : null
  if (!kv || !auth) return json(503, { error: 'not_configured' })
  // 대장은 공개 접속(open_until)으로 열지 않는다.
  if (kind === 'credentials' ? !(await verifySession(readCookie(request, SESSION_COOKIE), auth.session_secret, now)) : !(await signedIn(request, auth, now))) return json(401, { error: 'login_required' })
  if (request.method === 'POST' && !sameOriginJson(request, url)) return json(403, { error: 'bad_request_origin' })
  if (!env.EXCEPTIONS_DB) return json(503, { error: `${kind}_not_configured` })
  try {
    if (kind === 'exceptions') return await handleExceptions(request, route, env.EXCEPTIONS_DB, json, now)
    if (kind === 'handling') return await handleHandling(request, route, env.EXCEPTIONS_DB, json, now)
    if (kind === 'remediation-progress') return await handleRemediationProgress(request, route, env.EXCEPTIONS_DB, json, now)
    if (kind === 'compliance-exceptions') return await handleComplianceExceptions(request, route, env.EXCEPTIONS_DB, json, now)
    if (kind === 'investigations') return await handleInvestigations(request, route, env.EXCEPTIONS_DB, json, now)
    return await handleCredentials(request, route, env.EXCEPTIONS_DB, json, now)
  } catch (err) {
    // 테이블이 아직 없을 때(마이그레이션 전) 등. 원인 문장은 로그에만 남긴다
    console.error(`${kind} api`, err)
    return json(503, { error: `${kind}_unavailable` })
  }
}
