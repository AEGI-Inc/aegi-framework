import { createHash, createPrivateKey, createSign, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { atomicUpdateEnvFile } from '../engine/scripts/collect/config.ts'
import {
  atlassianBasicAuth,
  awsSigV4Auth,
  bearerAuth,
  githubAppAuth,
  googleDwdAuthFactory,
  normalizeAtlassianSiteUrl,
  normalizeOktaOrgUrl,
  normalizeSalesforceUrl,
  oauthRefreshTokenAuth,
  oktaDpopAuth,
  oktaSswsAuth,
  salesforceClientCredentialsAuth,
  type GoogleKey,
} from '../engine/scripts/collect/lib/auth.ts'
import { fetchTransport, type Transport } from '../engine/scripts/collect/lib/http.ts'
import { sha256Hex } from '../engine/scripts/collect/lib/sanitize.ts'
import { DEFAULT_OKTA_SCOPES } from './collectorConfig.ts'
import { saveEnvValues } from './env.ts'
import { DATA_DIR, ENV_FILE, HOME } from './paths.ts'

export type OAuthProvider = 'okta' | 'salesforce' | 'gws' | 'slack' | 'github' | 'atlassian' | 'gcp'

export interface PendingOAuthState {
  provider: OAuthProvider
  orgUrl?: string
  clientId: string
  clientSecret?: string
  scopes: string[]
  redirectUri: string
  codeVerifier: string
  createdAt: number
}

const STATE_TTL_MS = 10 * 60 * 1000
const pendingStates = new Map<string, PendingOAuthState>()

/** 테스트용: 만료된 state 정리 또는 초기화 */
/**
 * GitHub App Manifest 생성과 App 설치는 일반 OAuth 가 아니라서 pendingStates 를 쓰지 않는다.
 * 그래도 콜백은 GET 이라 다른 사이트가 링크나 이미지로 부를 수 있으므로, 서버가 만든 일회용 state 가 있을 때만 .env 를 바꾼다.
 */
export type GithubSetupKind = 'manifest' | 'install'
const githubSetupStates = new Map<string, { kind: GithubSetupKind; createdAt: number }>()

export function issueGithubSetupState(kind: GithubSetupKind, now = Date.now()): string {
  for (const [k, v] of githubSetupStates.entries()) if (now - v.createdAt > STATE_TTL_MS) githubSetupStates.delete(k)
  const state = randomBytes(24).toString('base64url')
  githubSetupStates.set(state, { kind, createdAt: now })
  return state
}

/** 맞는 종류의 살아 있는 state 면 소모하고 true. 다른 종류의 state 는 건드리지 않는다 */
function takeGithubSetupState(state: string, kind: GithubSetupKind, now: number): boolean {
  const entry = state ? githubSetupStates.get(state) : undefined
  if (!entry || entry.kind !== kind) return false
  githubSetupStates.delete(state)
  return now - entry.createdAt <= STATE_TTL_MS
}

export function clearPendingOAuthStates(): void {
  pendingStates.clear()
  githubSetupStates.clear()
}

function pruneExpiredStates(now = Date.now()): void {
  for (const [k, v] of pendingStates.entries()) {
    if (now - v.createdAt > STATE_TTL_MS) pendingStates.delete(k)
  }
}

export function pkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

function isValidBaseUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:') return true
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return true
    return false
  } catch {
    return false
  }
}

export interface StartOAuthInput {
  provider?: unknown
  orgUrl?: unknown
  clientId?: unknown
  clientSecret?: unknown
  scopes?: unknown
}

export interface StartOAuthOptions {
  port: number
  env: Record<string, string>
  now?: number
}

export const BUILTIN_SF_CLIENT_ID = '3MVG9XgkMlifdwVC2KGgsPx_jmaIdSrBFcz1YMZaHv3UTHiVVJS6nic1njLHq669vVQ43ynEHTbNe9oydrXbk'
const SF_LOGIN_URL = 'https://login.salesforce.com'

export function startOAuth(input: StartOAuthInput, opts: StartOAuthOptions): { authorizeUrl: string; state: string; redirectUri: string } {
  pruneExpiredStates(opts.now)
  const provider = input.provider
  if (
    provider !== 'okta' &&
    provider !== 'salesforce' &&
    provider !== 'gws' &&
    provider !== 'slack' &&
    provider !== 'github' &&
    provider !== 'atlassian' &&
    provider !== 'gcp'
  ) {
    throw Object.assign(new Error('지원하지 않는 OAuth 출처입니다.'), { status: 400, code: 'unsupported_provider' })
  }

  const rawScopes = Array.isArray(input.scopes) ? input.scopes.map(s => String(s).trim()).filter(Boolean) : []
  if (rawScopes.length === 0) {
    throw Object.assign(new Error('최소 1개 이상의 권한 범위(scopes)를 선택해야 합니다.'), { status: 400, code: 'scopes_required' })
  }

  const { codeVerifier, codeChallenge } = pkcePair()
  const state = randomBytes(24).toString('base64url')
  const now = opts.now ?? Date.now()

  if (provider === 'okta') {
    // Okta 는 조직마다 Admin Console 에서 앱 등록을 만들어 조직 주소와 Client ID 를 넣는다
    const rawOrgUrl = (typeof input.orgUrl === 'string' && input.orgUrl.trim()) || opts.env.OKTA_ORG_URL || ''
    const normOrg = normalizeOktaOrgUrl(rawOrgUrl)
    if (!normOrg || !isValidBaseUrl(normOrg)) {
      throw Object.assign(new Error('올바른 Okta 조직 주소(https://<org>.okta.com)를 입력해 주세요.'), { status: 400, code: 'invalid_org_url' })
    }
    const clientId = ((typeof input.clientId === 'string' && input.clientId.trim()) || opts.env.OKTA_COLLECTOR_CLIENT_ID || '').trim()
    if (!clientId) {
      throw Object.assign(new Error('Okta 앱 등록의 Client ID를 입력해 주세요.'), { status: 400, code: 'client_id_required' })
    }
    const clientSecret = ((typeof input.clientSecret === 'string' && input.clientSecret.trim()) || opts.env.OKTA_COLLECTOR_CLIENT_SECRET || '').trim() || undefined
    const redirectUri = `http://127.0.0.1:${opts.port}/__aegi/oauth/callback`
    const fullScopes = [...new Set(['openid', 'offline_access', ...rawScopes])]

    pendingStates.set(state, {
      provider,
      orgUrl: normOrg,
      clientId,
      clientSecret,
      scopes: rawScopes,
      redirectUri,
      codeVerifier,
      createdAt: now,
    })

    const authorizeUrl = `${normOrg}/oauth2/v1/authorize?${new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: fullScopes.join(' '),
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'login consent',
    }).toString()}`

    return { authorizeUrl, state, redirectUri }
  }

  if (provider === 'salesforce') {
    // 주소를 안 넣으면 공통 로그인 주소로 보내 사용자가 로그인한 조직에서 동의받는다. 조직 주소는 콜백에서 토큰 응답의 instance_url 로 저장한다.
    // 저장된 SALESFORCE_INSTANCE_URL 은 쓰지 않는다(다른 조직으로 다시 연결할 때 이전 조직 로그인 화면으로 가지 않게)
    const rawInstanceUrl = (typeof input.orgUrl === 'string' && input.orgUrl.trim()) || SF_LOGIN_URL
    const normInstance = normalizeSalesforceUrl(rawInstanceUrl)
    if (!normInstance || !isValidBaseUrl(normInstance)) {
      throw Object.assign(new Error('올바른 Salesforce My Domain 주소(https://<domain>.my.salesforce.com)를 입력해 주세요.'), { status: 400, code: 'invalid_instance_url' })
    }
    const clientId = ((typeof input.clientId === 'string' && input.clientId.trim()) || opts.env.SALESFORCE_COLLECTOR_CLIENT_ID || BUILTIN_SF_CLIENT_ID).trim()
    if (!clientId) {
      throw Object.assign(new Error('Salesforce 앱 등록의 Consumer Key(Client ID)를 입력해 주세요.'), { status: 400, code: 'client_id_required' })
    }
    const clientSecret = ((typeof input.clientSecret === 'string' && input.clientSecret.trim()) || opts.env.SALESFORCE_COLLECTOR_CLIENT_SECRET || '').trim() || undefined
    // Salesforce External Client App 은 비-HTTPS 루프백 콜백으로 http://localhost 만 허용한다 (http://127.0.0.1 거부)
    const redirectUri = `http://localhost:${opts.port}/__aegi/oauth/callback`
    const fullScopes = [...new Set(['api', 'refresh_token', ...rawScopes])]

    pendingStates.set(state, {
      provider,
      orgUrl: normInstance,
      clientId,
      clientSecret,
      scopes: rawScopes,
      redirectUri,
      codeVerifier,
      createdAt: now,
    })

    const authorizeUrl = `${normInstance}/services/oauth2/authorize?${new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: fullScopes.join(' '),
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'login consent',
    }).toString()}`

    return { authorizeUrl, state, redirectUri }
  }

  if (provider === 'slack') {
    // teamId는 사용자가 명시적으로 입력한 경우에만 Slack authorize 파라미터(team)에 전달합니다.
    // team 파라미터를 생략하면 Slack 인증 화면 우측 상단에서 샌드박스 등 원하는 워크스페이스를 자유롭게 선택할 수 있습니다.
    const teamId = (typeof input.orgUrl === 'string' && input.orgUrl.trim()) ? input.orgUrl.trim() : undefined
    const clientId = ((typeof input.clientId === 'string' && input.clientId.trim()) || opts.env.SLACK_CLIENT_ID || '').trim()
    if (!clientId) {
      throw Object.assign(new Error('Slack 앱 등록의 Client ID를 입력해 주세요.'), { status: 400, code: 'client_id_required' })
    }
    const clientSecret = ((typeof input.clientSecret === 'string' && input.clientSecret.trim()) || opts.env.SLACK_CLIENT_SECRET || '').trim()
    if (!clientSecret) {
      throw Object.assign(new Error('Slack 앱 등록의 Client Secret을 입력해 주세요.'), { status: 400, code: 'client_secret_required' })
    }
    // Slack 앱은 https:// Redirect URI 만 허용하므로 로컬 TLS/HTTP 멀티플렉서를 통해 https://127.0.0.1 로 받는다.
    const redirectUri = `https://127.0.0.1:${opts.port}/__aegi/oauth/callback`
    const botScopes = rawScopes.filter(s => s.startsWith('bot:')).map(s => s.slice(4))
    const userScopes = rawScopes.filter(s => !s.startsWith('bot:'))

    pendingStates.set(state, {
      provider,
      orgUrl: teamId,
      clientId,
      clientSecret,
      scopes: rawScopes,
      redirectUri,
      codeVerifier,
      createdAt: now,
    })

    const params: Record<string, string> = {
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    }
    if (botScopes.length) params.scope = botScopes.join(',')
    if (userScopes.length) params.user_scope = userScopes.join(',')
    if (teamId) params.team = teamId

    const slackAuthBase = opts.env.AEGI_SLACK_AUTH_URL || 'https://slack.com/oauth/v2/authorize'
    const authorizeUrl = `${slackAuthBase}?${new URLSearchParams(params).toString()}`
    return { authorizeUrl, state, redirectUri }
  }

  if (provider === 'github') {
    const orgSlug = ((typeof input.orgUrl === 'string' && input.orgUrl.trim()) || opts.env.GITHUB_ORG || '').trim() || undefined
    const clientId = ((typeof input.clientId === 'string' && input.clientId.trim()) || opts.env.GITHUB_OAUTH_CLIENT_ID || '').trim()
    if (!clientId) {
      throw Object.assign(new Error('GitHub OAuth App(또는 GitHub App)의 Client ID를 입력해 주세요.'), { status: 400, code: 'client_id_required' })
    }
    const clientSecret = ((typeof input.clientSecret === 'string' && input.clientSecret.trim()) || opts.env.GITHUB_OAUTH_CLIENT_SECRET || '').trim()
    if (!clientSecret) {
      throw Object.assign(new Error('GitHub OAuth App(또는 GitHub App)의 Client Secret을 입력해 주세요.'), { status: 400, code: 'client_secret_required' })
    }
    const redirectUri = `http://127.0.0.1:${opts.port}/__aegi/oauth/callback`

    pendingStates.set(state, {
      provider,
      orgUrl: orgSlug,
      clientId,
      clientSecret,
      scopes: rawScopes,
      redirectUri,
      codeVerifier,
      createdAt: now,
    })

    const ghAuthBase = opts.env.AEGI_GITHUB_AUTH_URL || 'https://github.com/login/oauth/authorize'
    const authorizeUrl = `${ghAuthBase}?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: rawScopes.join(' '),
      state,
    }).toString()}`
    return { authorizeUrl, state, redirectUri }
  }

  if (provider === 'atlassian') {
    const rawSiteUrl = ((typeof input.orgUrl === 'string' && input.orgUrl.trim()) || opts.env.ATLASSIAN_SITE_URL || '').trim()
    const normSite = rawSiteUrl ? normalizeAtlassianSiteUrl(rawSiteUrl) : undefined
    const clientId = ((typeof input.clientId === 'string' && input.clientId.trim()) || opts.env.ATLASSIAN_COLLECTOR_CLIENT_ID || '').trim()
    if (!clientId) {
      throw Object.assign(new Error('Atlassian OAuth 2.0 (3LO) 앱 등록의 Client ID를 입력해 주세요.'), { status: 400, code: 'client_id_required' })
    }
    const clientSecret = ((typeof input.clientSecret === 'string' && input.clientSecret.trim()) || opts.env.ATLASSIAN_COLLECTOR_CLIENT_SECRET || '').trim()
    if (!clientSecret) {
      throw Object.assign(new Error('Atlassian OAuth 2.0 (3LO) 앱 등록의 Secret을 입력해 주세요.'), { status: 400, code: 'client_secret_required' })
    }
    const redirectUri = `http://127.0.0.1:${opts.port}/__aegi/oauth/callback`
    const fullScopes = [...new Set(['offline_access', ...rawScopes])]

    pendingStates.set(state, {
      provider,
      orgUrl: normSite,
      clientId,
      clientSecret,
      scopes: rawScopes,
      redirectUri,
      codeVerifier,
      createdAt: now,
    })

    const atAuthBase = opts.env.AEGI_ATLASSIAN_AUTH_URL || 'https://auth.atlassian.com/authorize'
    const authorizeUrl = `${atAuthBase}?${new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: clientId,
      scope: fullScopes.join(' '),
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      prompt: 'consent',
    }).toString()}`
    return { authorizeUrl, state, redirectUri }
  }

  if (provider === 'gcp') {
    const clientId = ((typeof input.clientId === 'string' && input.clientId.trim()) || opts.env.GCP_COLLECTOR_CLIENT_ID || '').trim()
    if (!clientId) {
      throw Object.assign(new Error('GCP OAuth 2.0 Client ID를 입력해 주세요.'), { status: 400, code: 'client_id_required' })
    }
    const clientSecret = ((typeof input.clientSecret === 'string' && input.clientSecret.trim()) || opts.env.GCP_COLLECTOR_CLIENT_SECRET || '').trim()
    if (!clientSecret) {
      throw Object.assign(new Error('GCP 데스크톱 OAuth 클라이언트는 Client Secret이 필수입니다. Client Secret을 입력해 주세요.'), { status: 400, code: 'client_secret_required' })
    }
    const redirectUri = `http://127.0.0.1:${opts.port}/__aegi/oauth/callback`
    const gcpAuthBase = opts.env.AEGI_GCP_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth'

    pendingStates.set(state, {
      provider,
      clientId,
      clientSecret,
      scopes: rawScopes,
      redirectUri,
      codeVerifier,
      createdAt: now,
    })

    const authorizeUrl = `${gcpAuthBase}?${new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: rawScopes.join(' '),
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    }).toString()}`

    return { authorizeUrl, state, redirectUri }
  }

  // Google Workspace (gws)
  const clientId = ((typeof input.clientId === 'string' && input.clientId.trim()) || opts.env.GWS_COLLECTOR_CLIENT_ID || '').trim()
  if (!clientId) {
    throw Object.assign(new Error('Google Cloud OAuth 2.0 Client ID를 입력해 주세요.'), { status: 400, code: 'client_id_required' })
  }
  const clientSecret = ((typeof input.clientSecret === 'string' && input.clientSecret.trim()) || opts.env.GWS_COLLECTOR_CLIENT_SECRET || '').trim() || undefined
  const redirectUri = `http://127.0.0.1:${opts.port}/__aegi/oauth/callback`
  const gwsAuthBase = opts.env.AEGI_GWS_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth'

  pendingStates.set(state, {
    provider,
    clientId,
    clientSecret,
    scopes: rawScopes,
    redirectUri,
    codeVerifier,
    createdAt: now,
  })

  const authorizeUrl = `${gwsAuthBase}?${new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: rawScopes.join(' '),
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  }).toString()}`

  return { authorizeUrl, state, redirectUri }
}

export interface HandleCallbackOptions {
  port: number
  env: Record<string, string>
  envFile?: string
  transport?: Transport
  now?: number
}

export interface CallbackOutcome {
  status: number
  ok: boolean
  provider?: OAuthProvider
  fingerprint?: string
  error?: string
  html: string
}

function formatOAuthError(provider: OAuthProvider, errCode: string, errDesc: string): string {
  const detail = errDesc ? `${errCode}: ${errDesc}` : errCode
  if (errCode === 'invalid_scope') {
    if (provider === 'okta') {
      return `요청한 권한 범위(scope)가 Okta 앱 등록의 'Okta API Scopes' 탭에서 Grant되지 않았습니다 (${detail}). Super Admin 계정으로 Okta API Scopes 탭에서 필요한 okta.*.read 항목을 먼저 Grant한 뒤 다시 시도하세요.`
    }
    return `요청한 권한 범위(scope)가 앱 등록에 허용되지 않았습니다 (${detail}).`
  }
  if (errCode === 'invalid_client') {
    if (provider === 'salesforce') {
      return `Salesforce 앱 등록이 아직 설치(Install)되지 않았거나 Consumer Key 전파 대기 중이거나 Secret 설정이 맞지 않습니다 (${detail}).`
    }
    return `앱 등록의 Client ID 또는 Client Secret 설정이 올바르지 않습니다 (${detail}).`
  }
  if (errCode === 'access_denied') {
    return `사용자가 동의 화면에서 승인을 거부했거나 앱 등록에 배정(Assign)되지 않았습니다 (${detail}).`
  }
  return `OAuth 인증 실패 (${detail})`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

export function renderCallbackHtml(port: number, payload: { ok: boolean; provider?: OAuthProvider; fingerprint?: string; error?: string }): string {
  const targetOrigin = `http://127.0.0.1:${port}`
  const safeTitle = payload.ok ? 'OAuth 연결 완료' : 'OAuth 연결 실패'
  const safeMsg = payload.ok
    ? `동의 및 갱신 토큰 저장이 완료되었습니다${payload.fingerprint ? ` (토큰 지문: ${payload.fingerprint})` : ''}. 이 창은 자동으로 닫힙니다.`
    : payload.error || 'OAuth 연결 중 오류가 발생했습니다.'
  const msgJson = safeJsonForScript({ type: 'aegi-oauth-done', ...payload })
  const originJson = safeJsonForScript(targetOrigin)
  const doneQuery = new URLSearchParams({
    ok: payload.ok ? '1' : '0',
    ...(payload.provider ? { provider: payload.provider } : {}),
    ...(payload.fingerprint ? { fingerprint: payload.fingerprint } : {}),
    ...(payload.error ? { error: payload.error } : {}),
  }).toString()
  const httpDoneUrlJson = safeJsonForScript(`${targetOrigin}/__aegi/oauth/done?${doneQuery}`)
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>${safeTitle} — AEGI</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 32px; background: #f8fafc; color: #0f172a; }
    .card { max-width: 520px; margin: 24px auto; padding: 24px; background: #fff; border: 1px solid #cbd5e1; }
    h1 { font-size: 18px; margin: 0 0 12px; color: ${payload.ok ? '#15803d' : '#b91c1c'}; }
    p { font-size: 14px; line-height: 1.5; margin: 0 0 16px; word-break: keep-all; }
    button { padding: 8px 14px; border: 1px solid #94a3b8; background: #fff; cursor: pointer; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${safeTitle}</h1>
    <p>${escapeHtml(safeMsg)}</p>
    <button type="button" onclick="window.close()">창 닫기</button>
  </div>
  <script>
    (function () {
      var msg = ${msgJson};
      var primaryOrigin = ${originJson};
      var altOrigin = primaryOrigin.replace('127.0.0.1', 'localhost');
      var httpsPrimary = primaryOrigin.replace('http://', 'https://');
      var httpsAlt = altOrigin.replace('http://', 'https://');
      try {
        if (window.opener) {
          window.opener.postMessage(msg, primaryOrigin);
          window.opener.postMessage(msg, altOrigin);
          window.opener.postMessage(msg, httpsPrimary);
          window.opener.postMessage(msg, httpsAlt);
        }
      } catch (e) {}
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          var bc = new BroadcastChannel('aegi-oauth');
          bc.postMessage(msg);
          bc.close();
        }
      } catch (e) {}
      if (window.location.protocol === 'https:') {
        setTimeout(function () {
          try { window.location.replace(${httpDoneUrlJson}); } catch (e) {}
        }, 120);
        return;
      }
      if (msg.ok) {
        setTimeout(function () { try { window.close(); } catch (e) {} }, 900);
      }
    })();
  </script>
</body>
</html>`
}

export function resolveGwsSaKey(env?: Record<string, string>): string {
  const currentEnv = env ?? process.env
  if (currentEnv.GWS_COLLECTOR_SA_KEY?.trim()) {
    return currentEnv.GWS_COLLECTOR_SA_KEY.trim()
  }
  if (currentEnv.GWS_COLLECTOR_SA_KEY_FILE?.trim()) {
    const rawPath = currentEnv.GWS_COLLECTOR_SA_KEY_FILE.trim()
    const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(HOME, rawPath)
    if (fs.existsSync(resolvedPath)) {
      try {
        return fs.readFileSync(resolvedPath, 'utf8')
      } catch {
        // pass
      }
    }
  }
  return ''
}

function githubAppPemPath(): string {
  const p = path.join(DATA_DIR, 'setup-output', 'secrets', 'github-app-collector.pem')
  if (!fs.existsSync(p)) {
    const rootP = path.join(HOME, 'setup-output', 'secrets', 'github-app-collector.pem')
    if (fs.existsSync(rootP) && (!process.env.AEGI_DATA_DIR || process.env.AEGI_DATA_DIR === path.join(HOME, 'data'))) {
      return rootP
    }
  }
  return p
}

export function resolveGithubAppPem(env?: Record<string, string>): string {
  const currentEnv = env ?? process.env
  if (currentEnv.GITHUB_APP_PRIVATE_KEY?.trim()) {
    return currentEnv.GITHUB_APP_PRIVATE_KEY.trim().replace(/\\n/g, '\n')
  }
  if (currentEnv.GITHUB_APP_PRIVATE_KEY_FILE?.trim()) {
    const rawPath = currentEnv.GITHUB_APP_PRIVATE_KEY_FILE.trim()
    const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(HOME, rawPath)
    if (fs.existsSync(resolvedPath)) {
      try {
        return fs.readFileSync(resolvedPath, 'utf8')
      } catch {
        // pass
      }
    }
  }
  const localPem = githubAppPemPath()
  if (fs.existsSync(localPem)) {
    try {
      return fs.readFileSync(localPem, 'utf8')
    } catch {
      // pass
    }
  }
  return ''
}

/** GitHub App API의 설치 조회는 설치 토큰이 아닌 App JWT를 요구한다. */
function githubAppJwt(appId: string, privateKeyPem: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 60, exp: now + 540, iss: appId })}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  return `${unsigned}.${signer.sign(privateKeyPem).toString('base64url')}`
}

export interface SlackTeamLookupResult {
  teamId?: string
  source?: 'admin.teams.list' | 'auth.test'
  reason?: string
}

/**
 * Slack 사용자/봇 토큰으로 워크스페이스 ID(T...)를 조회한다.
 * Enterprise Grid 는 admin.teams.list, 일반 워크스페이스는 auth.test 를 시도하며
 * E... 로 시작하는 Enterprise ID 는 워크스페이스 ID 로 채택하지 않는다.
 */
export async function lookupSlackWorkspaceTeamId(
  userToken: string,
  botToken: string,
  transport: Transport = fetchTransport,
): Promise<SlackTeamLookupResult> {
  const failures: string[] = []
  const parseBody = (raw: unknown): Record<string, any> => {
    if (raw && typeof raw === 'object') return raw as Record<string, any>
    if (typeof raw === 'string' && raw.trim()) {
      try { return JSON.parse(raw) as Record<string, any> } catch { return {} }
    }
    return {}
  }

  if (userToken) {
    try {
      const res = await transport({
        method: 'GET',
        url: 'https://slack.com/api/admin.teams.list?limit=1',
        headers: { Authorization: `Bearer ${userToken}`, Accept: 'application/json' },
      })
      const json = parseBody(res.body)
      const firstId = typeof json.teams?.[0]?.id === 'string' ? json.teams[0].id.trim() : ''
      if (res.status === 200 && json.ok && firstId.startsWith('T')) {
        return { teamId: firstId, source: 'admin.teams.list' }
      }
      failures.push(`admin.teams.list HTTP ${res.status}${json.error ? ` (${json.error})` : firstId ? ` (non-T id: ${firstId})` : ' (empty teams)'}`)
    } catch (err: any) {
      failures.push(`admin.teams.list 예외: ${err?.message || String(err)}`)
    }
  }

  for (const [label, tok] of [['user', userToken], ['bot', botToken]] as const) {
    if (!tok) continue
    try {
      const res = await transport({
        method: 'GET',
        url: 'https://slack.com/api/auth.test',
        headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' },
      })
      const json = parseBody(res.body)
      const tid = typeof json.team_id === 'string' ? json.team_id.trim() : ''
      if (res.status === 200 && json.ok && tid.startsWith('T')) {
        return { teamId: tid, source: 'auth.test' }
      }
      failures.push(`auth.test(${label}) HTTP ${res.status}${json.error ? ` (${json.error})` : tid ? ` (non-T id: ${tid})` : ''}`)
    } catch (err: any) {
      failures.push(`auth.test(${label}) 예외: ${err?.message || String(err)}`)
    }
  }

  return { reason: failures.join('; ') || '사용 가능한 Slack 토큰 없음' }
}

/** 수집 직전 SLACK_TEAM_ID 가 비어 있으면 조회해 .env 에 저장한다 */
export async function resolveSlackTeamId(
  env: Record<string, string>,
  envFile = ENV_FILE,
  transport: Transport = fetchTransport,
): Promise<{ ok: boolean; teamId?: string; source?: string; reason?: string }> {
  const existing = (env.SLACK_TEAM_ID ?? '').trim()
  if (existing.startsWith('T')) return { ok: true, teamId: existing, source: 'env' }
  const userToken = (env.SLACK_COLLECTOR_USER_TOKEN ?? '').trim()
  const botToken = (env.SLACK_COLLECTOR_BOT_TOKEN ?? '').trim()
  if (!userToken && !botToken) return { ok: false, reason: '워크스페이스 id 없음 (Slack 토큰 없음)' }
  const resolved = await lookupSlackWorkspaceTeamId(userToken, botToken, transport)
  if (resolved.teamId) {
    saveEnvValues({ SLACK_TEAM_ID: resolved.teamId }, env, envFile)
    return { ok: true, teamId: resolved.teamId, source: resolved.source }
  }
  return { ok: false, reason: `워크스페이스 id 없음 (${resolved.reason ?? '알 수 없는 오류'})` }
}

export async function handleOAuthCallback(query: URLSearchParams, opts: HandleCallbackOptions): Promise<CallbackOutcome> {
  const now = opts.now ?? Date.now()
  pruneExpiredStates(now)

  // GitHub App 설치 흐름 처리 (GitHub 가 installation_id 와 setup_action=install 로 콜백)
  const installationId = query.get('installation_id')
  if (installationId) {
    // 서버가 설치 링크에 붙인 state 가 없으면 저장하지 않는다(다른 사이트가 설치 ID 를 바꿔 넣지 못하게).
    // GitHub 화면에서 바로 설치한 경우는 Adapters 의 「감지된 설치 대상」에서 골라 저장한다.
    if (!takeGithubSetupState(query.get('state') ?? '', 'install', now)) {
      const error = 'GitHub App 설치를 받았지만 이 화면에서 시작한 설치인지 확인하지 못해 자동으로 저장하지 않았습니다. Adapters의 GitHub 연결에서 감지된 설치 대상을 골라 [설정 저장]을 눌러 주세요.'
      return { status: 400, ok: false, provider: 'github', error, html: renderCallbackHtml(opts.port, { ok: false, provider: 'github', error }) }
    }
    const pemContent = resolveGithubAppPem(opts.env)
    const appId = (opts.env.GITHUB_APP_ID ?? '').trim()
    const updates: Record<string, string> = {}
    if (appId) updates.GITHUB_APP_ID = appId
    if (pemContent) updates.GITHUB_APP_PRIVATE_KEY = pemContent
    let orgLookupError: string | undefined
    if (pemContent && appId) {
      try {
        const transport = opts.transport ?? fetchTransport
        const url = `https://api.github.com/app/installations/${encodeURIComponent(installationId)}`
        const jwt = githubAppJwt(appId, pemContent.replace(/\\n/g, '\n'))
        const res = await transport({
          method: 'GET',
          url,
          headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'aegi-collector-setup',
          },
        })
        const body = (res.body && typeof res.body === 'object' ? res.body : {}) as {
          target_type?: string
          account?: { login?: string; slug?: string }
        }
        if (res.status === 200 && body) {
          if (body.target_type === 'Enterprise' || body.target_type === 'Business') {
            updates.GITHUB_APP_ENTERPRISE_INSTALLATION_ID = installationId
            const entSlug = body.account?.slug || body.account?.login
            if (entSlug) updates.GITHUB_ENTERPRISE = entSlug
          } else {
            updates.GITHUB_APP_INSTALLATION_ID = installationId
            const orgLogin = body.account?.login
            if (orgLogin) updates.GITHUB_ORG = orgLogin
          }
        } else {
          orgLookupError = 'GitHub 조직 또는 엔터프라이즈를 확인하지 못했습니다. GITHUB_ORG 또는 GITHUB_ENTERPRISE를 입력해 주세요.'
        }
      } catch {
        orgLookupError = 'GitHub 조직 또는 엔터프라이즈를 확인하지 못했습니다. GITHUB_ORG 또는 GITHUB_ENTERPRISE를 입력해 주세요.'
      }
    } else {
      orgLookupError = 'GitHub App ID와 개인키(GITHUB_APP_PRIVATE_KEY)가 설정되지 않아 조직을 확인하지 못했습니다. Adapters 화면에서 새 GitHub App을 생성(Manifest)하거나 .env에 키를 설정한 뒤 GITHUB_ORG를 입력해 주세요.'
    }

    if (!updates.GITHUB_APP_INSTALLATION_ID && !updates.GITHUB_APP_ENTERPRISE_INSTALLATION_ID) {
      updates.GITHUB_APP_INSTALLATION_ID = installationId
    }
    saveEnvValues(updates, opts.env, opts.envFile ?? ENV_FILE)
    const fingerprint = sha256Hex(installationId).slice(0, 12)
    return {
      status: 200,
      ok: !orgLookupError,
      provider: 'github',
      fingerprint,
      error: orgLookupError,
      html: orgLookupError
        ? renderCallbackHtml(opts.port, { ok: false, provider: 'github', error: orgLookupError })
        : renderCallbackHtml(opts.port, { ok: true, provider: 'github', fingerprint }),
    }
  }

  const state = query.get('state') ?? ''
  const code = query.get('code') ?? ''

  // GitHub App Manifest 생성 플로우: 화면이 받아 간 manifest state 와 함께 돌아온 code 만 변환한다
  const manifestState = Boolean(state && code) && takeGithubSetupState(state, 'manifest', now)
  if (code && !state) {
    const error = 'GitHub App Manifest 요청(state)이 없어 처리하지 않았습니다. Adapters에서 [새 GitHub App 생성 (Manifest)]를 다시 눌러 주세요.'
    return { status: 400, ok: false, provider: 'github', error, html: renderCallbackHtml(opts.port, { ok: false, provider: 'github', error }) }
  }
  if (manifestState) {
    try {
      const manifestRes = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'aegi-collector-setup',
        },
      })
      if (manifestRes.ok) {
        const manifestData = (await manifestRes.json()) as {
          id: number
          slug: string
          client_id: string
          pem: string
          html_url: string
        }
        const pemPath = githubAppPemPath()
        const pemDir = path.dirname(pemPath)
        fs.mkdirSync(pemDir, { recursive: true })
        // Existing files can have inherited permissive modes, so enforce this
        // after writing as well as requesting the mode for a newly-created file.
        fs.writeFileSync(pemPath, manifestData.pem, { encoding: 'utf-8', mode: 0o600 })
        fs.chmodSync(pemPath, 0o600)
        const updates: Record<string, string> = {
          GITHUB_APP_ID: String(manifestData.id),
          GITHUB_APP_PRIVATE_KEY: manifestData.pem,
        }
        saveEnvValues(updates, opts.env, opts.envFile ?? ENV_FILE)
        const installUrl = escapeHtml(`${manifestData.html_url || `https://github.com/apps/${encodeURIComponent(manifestData.slug)}`}/installations/new?state=${issueGithubSetupState('install', now)}`)
        const safeSlug = escapeHtml(manifestData.slug)
        return {
          status: 200,
          ok: true,
          provider: 'github',
          html: `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>GitHub App 생성 완료 — AEGI</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 32px; background: #f8fafc; color: #0f172a; }
    .card { max-width: 520px; margin: 24px auto; padding: 24px; background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; }
    h1 { font-size: 18px; margin: 0 0 12px; color: #15803d; }
    p { font-size: 14px; line-height: 1.6; margin: 0 0 16px; word-break: keep-all; }
    .btn { display: inline-block; padding: 10px 18px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>GitHub App 생성 완료</h1>
    <p>GitHub App(<strong>${safeSlug}</strong>, ID: ${manifestData.id})이 등록되고 보안 키가 로컬에 안전하게 저장되었습니다.</p>
    <p>이제 아래 버튼을 눌러 대상 조직(Organization)에 앱을 설치하시면 연동이 완료됩니다.</p>
    <a href="${installUrl}" class="btn">조직에 앱 설치하기 ↗</a>
  </div>
</body>
</html>`,
        }
      }
    } catch {
      // API 변환 시도 실패 시 아래 기존 앱 등록 확인으로 계속 진행
    }

    // 이미 변환된 코드이거나 앱이 이미 등록되어 있는 경우 안내
    const pemPath = githubAppPemPath()
    if (fs.existsSync(pemPath)) {
      const installUrl = 'https://github.com/settings/apps'
      return {
        status: 200,
        ok: true,
        provider: 'github',
        html: `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>GitHub App 준비 완료 — AEGI</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 32px; background: #f8fafc; color: #0f172a; }
    .card { max-width: 520px; margin: 24px auto; padding: 24px; background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; }
    h1 { font-size: 18px; margin: 0 0 12px; color: #15803d; }
    p { font-size: 14px; line-height: 1.6; margin: 0 0 16px; word-break: keep-all; }
    .btn { display: inline-block; padding: 10px 18px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>GitHub App 준비 완료</h1>
    <p>GitHub App 등록 및 로컬 비밀 키 설정이 이미 완료되어 있습니다.</p>
    <p>아래 버튼을 눌러 고객사 조직(Organization)에 앱을 설치하시면 즉시 연동됩니다.</p>
    <a href="${installUrl}" class="btn">GitHub 조직에 앱 설치하기 ↗</a>
  </div>
</body>
</html>`,
      }
    }

    const error = '유효하지 않거나 만료된 일회용 인증 코드입니다. 대시보드에서 [연결]을 다시 눌러 주세요.'
    return {
      status: 400,
      ok: false,
      error,
      html: renderCallbackHtml(opts.port, { ok: false, error }),
    }
  }
  const entry = state ? pendingStates.get(state) : undefined
  // state 는 조회 즉시 소모(단일 사용)하여 재사용을 원천 차단한다
  if (state) pendingStates.delete(state)

  if (!entry || now - entry.createdAt > STATE_TTL_MS) {
    const error = 'OAuth 요청(state)이 유효하지 않거나 만료되었습니다. 서버를 다시 시작했거나 OAuth 시작 후 10분이 지났을 수 있습니다. 대시보드에서 [OAuth로 연결 시작]을 다시 눌러 주세요.'
    return {
      status: 400,
      ok: false,
      error,
      html: renderCallbackHtml(opts.port, { ok: false, error }),
    }
  }

  const errParam = query.get('error')
  if (errParam) {
    const errDesc = query.get('error_description') ?? ''
    const error = formatOAuthError(entry.provider, errParam, errDesc)
    return {
      status: 400,
      ok: false,
      provider: entry.provider,
      error,
      html: renderCallbackHtml(opts.port, { ok: false, provider: entry.provider, error }),
    }
  }

  if (!code) {
    const error = '인가 코드(code)가 전달되지 않았습니다.'
    return {
      status: 400,
      ok: false,
      provider: entry.provider,
      error,
      html: renderCallbackHtml(opts.port, { ok: false, provider: entry.provider, error }),
    }
  }

  const transport = opts.transport ?? fetchTransport
  const tokenUrl =
    entry.provider === 'okta'
      ? `${entry.orgUrl}/oauth2/v1/token`
      : entry.provider === 'salesforce'
        ? `${entry.orgUrl}/services/oauth2/token`
        : entry.provider === 'slack'
          ? (opts.env.AEGI_SLACK_TOKEN_URL || 'https://slack.com/api/oauth.v2.access')
          : entry.provider === 'github'
            ? (opts.env.AEGI_GITHUB_TOKEN_URL || 'https://github.com/login/oauth/access_token')
            : entry.provider === 'atlassian'
              ? (opts.env.AEGI_ATLASSIAN_TOKEN_URL || 'https://auth.atlassian.com/oauth/token')
              : entry.provider === 'gcp'
                ? (opts.env.AEGI_GCP_TOKEN_URL || 'https://oauth2.googleapis.com/token')
                : (opts.env.AEGI_GWS_TOKEN_URL || 'https://oauth2.googleapis.com/token')

  const form: Record<string, string> = {
    grant_type: 'authorization_code',
    client_id: entry.clientId,
    redirect_uri: entry.redirectUri,
    code,
  }
  if (entry.provider === 'okta' || entry.provider === 'salesforce' || entry.provider === 'gws' || entry.provider === 'gcp') {
    form.code_verifier = entry.codeVerifier
  }
  if (entry.clientSecret) form.client_secret = entry.clientSecret

  const res = await transport({
    method: 'POST',
    url: tokenUrl,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
  })

  const body = (res.body && typeof res.body === 'object' ? res.body : {}) as Record<string, unknown>

  // Slack OAuth v2 응답 처리 (HTTP 200 + { ok: true, access_token?: "xoxb-...", authed_user?: { access_token?: "xoxp-..." }, team?: { id } })
  if (entry.provider === 'slack') {
    const authedUser = (body.authed_user && typeof body.authed_user === 'object' ? body.authed_user : {}) as Record<string, unknown>
    const botToken = typeof body.access_token === 'string' ? body.access_token : ''
    const userToken = typeof authedUser.access_token === 'string' ? authedUser.access_token : ''
    if (res.status !== 200 || body.ok === false || (!botToken && !userToken)) {
      const errCode = typeof body.error === 'string' ? body.error : `http_${res.status}`
      const error = formatOAuthError('slack', errCode, '')
      return {
        status: 400,
        ok: false,
        provider: 'slack',
        error,
        html: renderCallbackHtml(opts.port, { ok: false, provider: 'slack', error }),
      }
    }
    const updates: Record<string, string> = {
      SLACK_CLIENT_ID: entry.clientId,
      SLACK_OAUTH_SCOPES: entry.scopes.join(','),
    }
    if (entry.clientSecret) updates.SLACK_CLIENT_SECRET = entry.clientSecret
    if (botToken) updates.SLACK_COLLECTOR_BOT_TOKEN = botToken
    if (userToken) updates.SLACK_COLLECTOR_USER_TOKEN = userToken
    const teamObj = (body.team && typeof body.team === 'object' ? body.team : {}) as Record<string, unknown>
    const enterpriseObj = (body.enterprise && typeof body.enterprise === 'object' ? body.enterprise : {}) as Record<string, unknown>
    const rawTeamId = (typeof teamObj.id === 'string' && teamObj.id) || entry.orgUrl || ''
    let teamId = rawTeamId.startsWith('T') ? rawTeamId : ''
    if (typeof enterpriseObj.id === 'string' && enterpriseObj.id) updates.SLACK_ENTERPRISE_ID = enterpriseObj.id

    // Enterprise Grid 설치 시 body.team이 비어있을 수 있으므로, admin.teams.list / auth.test로 워크스페이스 ID(T...)를 자동 감지한다
    let teamLookupWarning = ''
    if (!teamId && (userToken || botToken)) {
      const resolved = await lookupSlackWorkspaceTeamId(userToken, botToken, transport)
      if (resolved.teamId) {
        teamId = resolved.teamId
      } else if (resolved.reason) {
        teamLookupWarning = resolved.reason
        console.warn(`[OAuth slack] 워크스페이스 ID(T...) 자동 감지 실패: ${resolved.reason}`)
      }
    }
    if (teamId) updates.SLACK_TEAM_ID = teamId

    saveEnvValues(updates, opts.env, opts.envFile ?? ENV_FILE)
    const fingerprint = sha256Hex(userToken || botToken).slice(0, 12)
    return {
      status: 200,
      ok: true,
      provider: 'slack',
      fingerprint,
      ...(teamLookupWarning ? { warning: `워크스페이스 id 없음 (${teamLookupWarning})` } : {}),
      html: renderCallbackHtml(opts.port, { ok: true, provider: 'slack', fingerprint }),
    }
  }

  // GitHub OAuth 응답 처리 ({ access_token: "gho_..." | "ghu_...", refresh_token?: "ghr_...", scope: "..." })
  if (entry.provider === 'github') {
    const accessToken = typeof body.access_token === 'string' ? body.access_token : ''
    if (res.status !== 200 || !accessToken) {
      const errCode = typeof body.error === 'string' ? body.error : `http_${res.status}`
      const errDesc = typeof body.error_description === 'string' ? body.error_description : ''
      const error = formatOAuthError('github', errCode, errDesc)
      return {
        status: 400,
        ok: false,
        provider: 'github',
        error,
        html: renderCallbackHtml(opts.port, { ok: false, provider: 'github', error }),
      }
    }
    const updates: Record<string, string> = {
      GITHUB_OAUTH_CLIENT_ID: entry.clientId,
      GITHUB_COLLECTOR_OAUTH_TOKEN: accessToken,
      GITHUB_OWNER_TOKEN: accessToken,
      GITHUB_OAUTH_SCOPES: typeof body.scope === 'string' && body.scope ? body.scope : entry.scopes.join(','),
    }
    if (entry.clientSecret) updates.GITHUB_OAUTH_CLIENT_SECRET = entry.clientSecret
    if (entry.orgUrl) updates.GITHUB_ORG = entry.orgUrl
    if (typeof body.refresh_token === 'string' && body.refresh_token) {
      updates.GITHUB_COLLECTOR_REFRESH_TOKEN = body.refresh_token
    } else if (opts.env.GITHUB_COLLECTOR_REFRESH_TOKEN) {
      delete opts.env.GITHUB_COLLECTOR_REFRESH_TOKEN
      atomicUpdateEnvFile(opts.envFile ?? ENV_FILE, { GITHUB_COLLECTOR_REFRESH_TOKEN: '' })
    }

    saveEnvValues(updates, opts.env, opts.envFile ?? ENV_FILE)
    const fingerprint = sha256Hex(accessToken).slice(0, 12)
    return {
      status: 200,
      ok: true,
      provider: 'github',
      fingerprint,
      html: renderCallbackHtml(opts.port, { ok: true, provider: 'github', fingerprint }),
    }
  }

  if (res.status !== 200 || typeof body.access_token !== 'string') {
    const errCode = typeof body.error === 'string' ? body.error : `http_${res.status}`
    const errDesc = typeof body.error_description === 'string' ? body.error_description : ''
    const error = formatOAuthError(entry.provider, errCode, errDesc)
    return {
      status: 400,
      ok: false,
      provider: entry.provider,
      error,
      html: renderCallbackHtml(opts.port, { ok: false, provider: entry.provider, error }),
    }
  }

  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : ''
  if (!refreshToken) {
    const error = '응답에 갱신 토큰(refresh_token)이 없습니다. 앱 등록에서 Refresh Token(offline_access) 권한이 켜져 있는지 확인하세요.'
    return {
      status: 400,
      ok: false,
      provider: entry.provider,
      error,
      html: renderCallbackHtml(opts.port, { ok: false, provider: entry.provider, error }),
    }
  }

  const fingerprint = sha256Hex(refreshToken).slice(0, 12)
  const grantedScopeStr = typeof body.scope === 'string' ? body.scope : entry.scopes.join(' ')
  const updates: Record<string, string> = {}

  if (entry.provider === 'okta') {
    updates.OKTA_ORG_URL = entry.orgUrl!
    updates.OKTA_COLLECTOR_CLIENT_ID = entry.clientId
    if (entry.clientSecret) updates.OKTA_COLLECTOR_CLIENT_SECRET = entry.clientSecret
    updates.OKTA_COLLECTOR_REFRESH_TOKEN = refreshToken
    const oktaScopes = grantedScopeStr
      .split(/[\s,]+/)
      .filter(s => s.startsWith('okta.') || s.startsWith('ssf.'))
    updates.OKTA_SCOPES = (oktaScopes.length ? oktaScopes : entry.scopes).join(',')
  } else if (entry.provider === 'salesforce') {
    const instanceUrl = typeof body.instance_url === 'string' && body.instance_url
      ? normalizeSalesforceUrl(body.instance_url)
      : entry.orgUrl!
    updates.SALESFORCE_INSTANCE_URL = instanceUrl
    updates.SALESFORCE_COLLECTOR_CLIENT_ID = entry.clientId
    if (entry.clientSecret) updates.SALESFORCE_COLLECTOR_CLIENT_SECRET = entry.clientSecret
    updates.SALESFORCE_COLLECTOR_REFRESH_TOKEN = refreshToken
  } else if (entry.provider === 'atlassian') {
    updates.ATLASSIAN_COLLECTOR_CLIENT_ID = entry.clientId
    if (entry.clientSecret) updates.ATLASSIAN_COLLECTOR_CLIENT_SECRET = entry.clientSecret
    updates.ATLASSIAN_COLLECTOR_REFRESH_TOKEN = refreshToken
    updates.ATLASSIAN_OAUTH_SCOPES = grantedScopeStr
    if (entry.orgUrl) updates.ATLASSIAN_SITE_URL = entry.orgUrl
    // accessible-resources 조회로 cloudId 및 사이트 URL 자동 발견
    try {
      const resourcesUrl = opts.env.AEGI_ATLASSIAN_RESOURCES_URL || 'https://api.atlassian.com/oauth/token/accessible-resources'
      const rRes = await transport({
        method: 'GET',
        url: resourcesUrl,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${body.access_token as string}`,
        },
      })
      if (rRes.status === 200 && Array.isArray(rRes.body) && rRes.body.length > 0) {
        const list = rRes.body as Array<{ id?: string; url?: string }>
        const matched = (entry.orgUrl ? list.find(item => item.url && normalizeAtlassianSiteUrl(item.url) === entry.orgUrl) : undefined) ?? list[0]
        if (matched?.id) updates.ATLASSIAN_CLOUD_ID = matched.id
        if (!updates.ATLASSIAN_SITE_URL && matched?.url) updates.ATLASSIAN_SITE_URL = normalizeAtlassianSiteUrl(matched.url)
      }
    } catch {
      // ignore discovery error; user can still set ATLASSIAN_CLOUD_ID manually if needed
    }
  } else if (entry.provider === 'gcp') {
    updates.GCP_COLLECTOR_CLIENT_ID = entry.clientId
    if (entry.clientSecret) updates.GCP_COLLECTOR_CLIENT_SECRET = entry.clientSecret
    updates.GCP_COLLECTOR_REFRESH_TOKEN = refreshToken
  } else {
    updates.GWS_COLLECTOR_CLIENT_ID = entry.clientId
    if (entry.clientSecret) updates.GWS_COLLECTOR_CLIENT_SECRET = entry.clientSecret
    updates.GWS_COLLECTOR_REFRESH_TOKEN = refreshToken
    const gwsScopes = grantedScopeStr
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(s => s.replace('https://www.googleapis.com/auth/', ''))
    updates.GWS_GRANTED_SCOPES = (gwsScopes.length ? gwsScopes : entry.scopes.map(s => s.replace('https://www.googleapis.com/auth/', ''))).join(',')
  }

  saveEnvValues(updates, opts.env, opts.envFile ?? ENV_FILE)

  return {
    status: 200,
    ok: true,
    provider: entry.provider,
    fingerprint,
    html: renderCallbackHtml(opts.port, { ok: true, provider: entry.provider, fingerprint }),
  }
}

/** 대시보드 [연결 확인] 요청 처리 (저장된 .env 값과 화면의 임시 입력값을 합쳐 읽기 전용 API 1회 점검) */
export interface CredentialTestResult {
  ok: boolean
  detail: string
  ssoUrl?: string
  org?: string
  orgId?: string
  sites?: Array<{ url: string; name?: string }>
}

interface EndpointProbe {
  label: string
  url: string
  /** 권한 부족(401/403)이 아닌 미지원/비활성 기능으로 간주할 HTTP 상태 코드 */
  optionalStatuses?: number[]
}

async function runPermissionProbes(
  probes: EndpointProbe[],
  getHeaders: (url: string) => Promise<Record<string, string>>,
  transport: Transport,
  accept = 'application/json',
): Promise<{ okList: string[]; deniedList: string[]; skippedList: string[] }> {
  const results = await Promise.all(
    probes.map(async (p) => {
      try {
        const headers = await getHeaders(p.url)
        const res = await transport({ method: 'GET', url: p.url, headers: { Accept: accept, ...headers } })
        if (res.status >= 200 && res.status < 300) return { label: p.label, kind: 'ok' as const }
        if (p.optionalStatuses?.includes(res.status)) return { label: p.label, kind: 'skipped' as const }
        if (res.status === 401 || res.status === 403) return { label: `${p.label}(${res.status})`, kind: 'denied' as const }
        return { label: `${p.label}(${res.status})`, kind: 'skipped' as const }
      } catch {
        return { label: `${p.label}(err)`, kind: 'denied' as const }
      }
    }),
  )
  return {
    okList: results.filter(r => r.kind === 'ok').map(r => r.label),
    deniedList: results.filter(r => r.kind === 'denied').map(r => r.label),
    skippedList: results.filter(r => r.kind === 'skipped').map(r => r.label),
  }
}

export async function testCredentialConnection(
  credentialId: string,
  draftValues: Record<string, string>,
  env: Record<string, string>,
  envFile = ENV_FILE,
  transport: Transport = fetchTransport,
  authMode?: 'oauth' | 'manual',
): Promise<CredentialTestResult> {
  const merged: Record<string, string> = { ...env }
  for (const [k, v] of Object.entries(draftValues)) {
    if (typeof v === 'string' && v.trim()) merged[k] = v.trim()
  }

  try {
    if (credentialId === 'CRED-OK-01') {
      const orgUrl = normalizeOktaOrgUrl(merged.OKTA_ORG_URL ?? '')
      if (!orgUrl) return { ok: false, detail: 'OKTA_ORG_URL이 필요합니다.' }
      const oktaProbes: EndpointProbe[] = [
        { label: 'users', url: `${orgUrl}/api/v1/users?limit=1` },
        { label: 'groups', url: `${orgUrl}/api/v1/groups?limit=1` },
        { label: 'apps', url: `${orgUrl}/api/v1/apps?limit=1` },
        { label: 'policies', url: `${orgUrl}/api/v1/policies?type=OKTA_SIGN_ON&limit=1` },
        { label: 'logs', url: `${orgUrl}/api/v1/logs?limit=1` },
        { label: 'roles', url: `${orgUrl}/api/v1/iam/roles?limit=1`, optionalStatuses: [404, 501] },
      ]
      if (authMode !== 'oauth' && merged.OKTA_API_TOKEN) {
        const auth = oktaSswsAuth('CRED-OK-01', merged.OKTA_API_TOKEN)
        const headers = await auth.headers('GET', `${orgUrl}/api/v1/org`)
        const res = await transport({ method: 'GET', url: `${orgUrl}/api/v1/org`, headers: { Accept: 'application/json', ...headers } })
        if (res.status !== 200) return { ok: false, detail: `Okta 응답 HTTP ${res.status}` }
        const { okList, deniedList, skippedList } = await runPermissionProbes(oktaProbes, u => auth.headers('GET', u), transport)
        if (deniedList.length > 0) {
          return {
            ok: false,
            detail: `연결은 되었으나 Okta 수집 권한이 부족합니다 — 정상: ${['org', ...okList].join(', ')} / 권한 부족: ${deniedList.join(', ')}`,
          }
        }
        const extra = skippedList.length ? ` (미지원 제외: ${skippedList.join(', ')})` : ''
        return { ok: true, detail: `연결 및 권한 확인 완료 (Okta API 토큰: ${['org', ...okList].join(', ')} 정상${extra})` }
      }
      const clientId = merged.OKTA_COLLECTOR_CLIENT_ID
      if (!clientId) return { ok: false, detail: 'OKTA_API_TOKEN 또는 OKTA_COLLECTOR_CLIENT_ID가 필요합니다.' }
      const oktaScopes = merged.OKTA_SCOPES ? merged.OKTA_SCOPES.split(/[\s,]+/).filter(Boolean) : [...DEFAULT_OKTA_SCOPES]
      const auth = (authMode !== 'oauth' && merged.OKTA_COLLECTOR_PRIVATE_KEY)
        ? oktaDpopAuth({
            ref: 'CRED-OK-01',
            orgUrl,
            clientId,
            keyId: merged.OKTA_COLLECTOR_KEY_ID ?? '',
            privateKeyPem: merged.OKTA_COLLECTOR_PRIVATE_KEY,
            scopes: oktaScopes,
            transport,
          })
        : merged.OKTA_COLLECTOR_REFRESH_TOKEN
          ? oauthRefreshTokenAuth({
              ref: 'CRED-OK-01',
              tokenUrl: `${orgUrl}/oauth2/v1/token`,
              clientId,
              clientSecret: merged.OKTA_COLLECTOR_CLIENT_SECRET,
              refreshToken: merged.OKTA_COLLECTOR_REFRESH_TOKEN,
              transport,
              onRotate: ({ refreshToken, scope }) => {
                saveEnvValues(
                  { OKTA_COLLECTOR_REFRESH_TOKEN: refreshToken, ...(scope ? { OKTA_SCOPES: scope } : {}) },
                  env,
                  envFile,
                )
              },
            })
          : null
      if (!auth) return { ok: false, detail: 'API 토큰, OAuth 갱신 토큰 또는 개인키가 설정되지 않았습니다.' }
      const headers = await auth.headers('GET', `${orgUrl}/api/v1/org`)
      const res = await transport({ method: 'GET', url: `${orgUrl}/api/v1/org`, headers: { Accept: 'application/json', ...headers } })
      if (res.status !== 200) return { ok: false, detail: `Okta 응답 HTTP ${res.status}` }
      const { okList, deniedList, skippedList } = await runPermissionProbes(oktaProbes, u => auth.headers('GET', u), transport)
      if (deniedList.length > 0) {
        return {
          ok: false,
          detail: `연결은 되었으나 Okta 수집 권한이 부족합니다 — 정상: ${['org', ...okList].join(', ')} / 권한 부족: ${deniedList.join(', ')}`,
        }
      }
      const extra = skippedList.length ? ` (미지원 제외: ${skippedList.join(', ')})` : ''
      return { ok: true, detail: `연결 및 권한 확인 완료 (Okta: ${['org', ...okList].join(', ')} 정상${extra})` }
    }

    if (credentialId === 'CRED-SF-01') {
      const instanceUrl = normalizeSalesforceUrl(merged.SALESFORCE_INSTANCE_URL ?? '')
      const clientId = merged.SALESFORCE_COLLECTOR_CLIENT_ID
      if (!instanceUrl || !clientId) return { ok: false, detail: 'SALESFORCE_INSTANCE_URL 및 Consumer Key가 필요합니다.' }
      const auth = merged.SALESFORCE_COLLECTOR_REFRESH_TOKEN
        ? oauthRefreshTokenAuth({
            ref: 'CRED-SF-01',
            tokenUrl: `${instanceUrl}/services/oauth2/token`,
            clientId,
            clientSecret: merged.SALESFORCE_COLLECTOR_CLIENT_SECRET,
            refreshToken: merged.SALESFORCE_COLLECTOR_REFRESH_TOKEN,
            transport,
            onRotate: ({ refreshToken }) => saveEnvValues({ SALESFORCE_COLLECTOR_REFRESH_TOKEN: refreshToken }, env, envFile),
          })
        : merged.SALESFORCE_COLLECTOR_CLIENT_SECRET
          ? salesforceClientCredentialsAuth({
              ref: 'CRED-SF-01',
              instanceUrl,
              clientId,
              clientSecret: merged.SALESFORCE_COLLECTOR_CLIENT_SECRET,
              transport,
            })
          : null
      if (!auth) return { ok: false, detail: 'OAuth 갱신 토큰 또는 Consumer Secret이 설정되지 않았습니다.' }
      const url = `${instanceUrl}/services/data/v61.0/query?q=${encodeURIComponent('SELECT Id, Name FROM Organization LIMIT 1')}`
      const headers = await auth.headers('GET', url)
      const res = await transport({ method: 'GET', url, headers: { Accept: 'application/json', ...headers } })
      if (res.status !== 200) return { ok: false, detail: `Salesforce 응답 HTTP ${res.status}` }
      const { okList, deniedList } = await runPermissionProbes(
        [
          { label: 'User', url: `${instanceUrl}/services/data/v61.0/query?q=${encodeURIComponent('SELECT Id FROM User LIMIT 1')}` },
          { label: 'PermissionSet', url: `${instanceUrl}/services/data/v61.0/query?q=${encodeURIComponent('SELECT Id FROM PermissionSet LIMIT 1')}` },
        ],
        u => auth.headers('GET', u),
        transport,
      )
      if (deniedList.length > 0) {
        return {
          ok: false,
          detail: `Salesforce 연결은 되었으나 조회 권한이 부족합니다 — 정상: ${['Organization', ...okList].join(', ')} / 권한 부족: ${deniedList.join(', ')}`,
        }
      }
      return { ok: true, detail: `연결 및 권한 확인 완료 (Salesforce: ${['Organization', ...okList].join(', ')} 정상)` }
    }

    if (credentialId === 'CRED-GW-01') {
      let gKey: GoogleKey | null = null
      if (authMode !== 'oauth') {
        const rawSaKey = merged.GWS_COLLECTOR_SA_KEY || (merged.GWS_ADMIN_SUBJECT ? resolveGwsSaKey(merged) : '')
        if (rawSaKey) {
          try {
            gKey = JSON.parse(rawSaKey) as GoogleKey
          } catch {
            try {
              let insideString = false
              let escaped = false
              let cleaned = ''
              for (let i = 0; i < rawSaKey.length; i++) {
                const c = rawSaKey[i]
                if (escaped) { cleaned += c; escaped = false; continue }
                if (c === '\\') {
                  if (rawSaKey[i + 1] === 'n') {
                    cleaned += insideString ? '\\n' : ' '
                    i++
                    continue
                  }
                  cleaned += c
                  escaped = true
                  continue
                }
                if (c === '"') insideString = !insideString
                cleaned += c
              }
              gKey = JSON.parse(cleaned) as GoogleKey
            } catch {
              return { ok: false, detail: 'Google Workspace 서비스 계정 JSON 형식이 올바르지 않습니다.' }
            }
          }
        }
      }
      const gwsSubject = authMode !== 'oauth'
        ? (merged.GWS_ADMIN_SUBJECT || ((gKey as { admin_subject?: string } | null)?.admin_subject) || '').trim()
        : ''
      if (gKey && !gwsSubject) {
        return { ok: false, detail: 'Google Workspace 최고 관리자 이메일(GWS_ADMIN_SUBJECT)을 입력해 주세요.' }
      }
      const gwsClientSecret = merged.GWS_COLLECTOR_CLIENT_SECRET || undefined
      const auth = gKey
        ? googleDwdAuthFactory({
            ref: 'CRED-GW-01',
            key: gKey,
            transport,
          })(gwsSubject, ['https://www.googleapis.com/auth/admin.directory.customer.readonly'])
        : merged.GWS_COLLECTOR_REFRESH_TOKEN && merged.GWS_COLLECTOR_CLIENT_ID
          ? oauthRefreshTokenAuth({
              ref: 'CRED-GW-01',
              tokenUrl: merged.AEGI_GWS_TOKEN_URL || 'https://oauth2.googleapis.com/token',
              clientId: merged.GWS_COLLECTOR_CLIENT_ID,
              clientSecret: gwsClientSecret,
              refreshToken: merged.GWS_COLLECTOR_REFRESH_TOKEN,
              transport,
              onRotate: ({ refreshToken }) => saveEnvValues({ GWS_COLLECTOR_REFRESH_TOKEN: refreshToken }, env, envFile),
            })
          : null
      if (!auth) return { ok: false, detail: 'Google Workspace OAuth 갱신 토큰 또는 서비스 계정 키가 설정되지 않았습니다.' }
      const url = 'https://admin.googleapis.com/admin/directory/v1/customers/my_customer'
      try {
        const headers = await auth.headers('GET', url)
        const res = await transport({ method: 'GET', url, headers: { Accept: 'application/json', ...headers } })
        if (res.status === 200) {
          const gwsProbes = [
            { label: 'users', scope: 'https://www.googleapis.com/auth/admin.directory.user.readonly', url: 'https://admin.googleapis.com/admin/directory/v1/users?customer=my_customer&maxResults=1' },
            { label: 'groups', scope: 'https://www.googleapis.com/auth/admin.directory.group.readonly', url: 'https://admin.googleapis.com/admin/directory/v1/groups?customer=my_customer&maxResults=1' },
            { label: 'reports(login)', scope: 'https://www.googleapis.com/auth/admin.reports.audit.readonly', url: 'https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/login?maxResults=1' },
          ]
          const okList = ['customer']
          const deniedList: string[] = []
          await Promise.all(
            gwsProbes.map(async (gp) => {
              try {
                const probeAuth = gKey
                  ? googleDwdAuthFactory({ ref: 'CRED-GW-01', key: gKey, transport })(gwsSubject, [gp.scope])
                  : auth
                const pHeaders = await probeAuth.headers('GET', gp.url)
                const pRes = await transport({ method: 'GET', url: gp.url, headers: { Accept: 'application/json', ...pHeaders } })
                if (pRes.status >= 200 && pRes.status < 300) okList.push(gp.label)
                else if (pRes.status === 401 || pRes.status === 403) deniedList.push(`${gp.label}(${pRes.status})`)
              } catch {
                deniedList.push(`${gp.label}(권한 미위임)`)
              }
            }),
          )
          if (deniedList.length > 0) {
            return {
              ok: false,
              detail: `Google Workspace 연결은 되었으나 일부 수집 권한이 부족합니다 — 정상: ${okList.join(', ')} / 권한 부족: ${deniedList.join(', ')}`,
            }
          }
          if (gKey) {
            const dwdAllScopes = [
              'https://www.googleapis.com/auth/admin.directory.customer.readonly',
              'https://www.googleapis.com/auth/admin.directory.domain.readonly',
              'https://www.googleapis.com/auth/admin.directory.user.readonly',
              'https://www.googleapis.com/auth/admin.directory.group.readonly',
              'https://www.googleapis.com/auth/admin.directory.group.member.readonly',
              'https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly',
              'https://www.googleapis.com/auth/admin.directory.user.security',
              'https://www.googleapis.com/auth/admin.reports.audit.readonly',
              'https://www.googleapis.com/auth/drive.metadata.readonly',
              'https://www.googleapis.com/auth/drive.readonly',
              'https://www.googleapis.com/auth/forms.body.readonly',
              'https://www.googleapis.com/auth/script.projects.readonly',
              'https://www.googleapis.com/auth/script.processes',
              'https://www.googleapis.com/auth/script.deployments.readonly',
              'https://www.googleapis.com/auth/gmail.settings.basic',
              'https://www.googleapis.com/auth/cloud-identity.inboundsso.readonly',
              'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
              'https://www.googleapis.com/auth/apps.groups.settings',
              'https://www.googleapis.com/auth/calendar.acls.readonly',
              'https://www.googleapis.com/auth/cloud-identity.allowlisteddomains.readonly',
              'https://www.googleapis.com/auth/cloud-identity.policies.readonly',
              'https://www.googleapis.com/auth/admin.datatransfer.readonly',
              'https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly',
              'https://www.googleapis.com/auth/admin.directory.device.mobile.readonly',
              'https://www.googleapis.com/auth/admin.directory.resource.calendar.readonly',
              'https://www.googleapis.com/auth/apps.alerts',
              'https://www.googleapis.com/auth/calendar.readonly',
              'https://www.googleapis.com/auth/chrome.management.appdetails.readonly',
              'https://www.googleapis.com/auth/chrome.management.profiles.readonly',
              'https://www.googleapis.com/auth/chrome.management.reports.readonly',
              'https://www.googleapis.com/auth/chrome.management.telemetry.readonly',
              'https://www.googleapis.com/auth/cloud-identity.devices.readonly',
              'https://www.googleapis.com/auth/drive.labels.readonly',
              'https://www.googleapis.com/auth/ediscovery.readonly',
              'https://www.googleapis.com/auth/apps.licensing',
              'https://www.googleapis.com/auth/gmail.labels',
              'https://www.googleapis.com/auth/drive.apps.readonly',
              'https://www.googleapis.com/auth/admin.chrome.printers.readonly',
              'https://www.googleapis.com/auth/chrome.management.connectors.readonly',
              'https://www.googleapis.com/auth/admin.directory.device.chromeos.readonly',
            ]
            const dwdProbes = [
              'https://www.googleapis.com/auth/drive.readonly',
              'https://www.googleapis.com/auth/forms.body.readonly',
              'https://www.googleapis.com/auth/script.projects.readonly',
              'https://www.googleapis.com/auth/script.processes',
              'https://www.googleapis.com/auth/script.deployments.readonly',
              'https://www.googleapis.com/auth/gmail.settings.basic',
              'https://www.googleapis.com/auth/apps.groups.settings',
              'https://www.googleapis.com/auth/calendar.acls.readonly',
              'https://www.googleapis.com/auth/admin.datatransfer.readonly',
              'https://www.googleapis.com/auth/admin.directory.device.chromebrowsers.readonly',
              'https://www.googleapis.com/auth/admin.directory.device.mobile.readonly',
              'https://www.googleapis.com/auth/admin.directory.resource.calendar.readonly',
              'https://www.googleapis.com/auth/apps.alerts',
              'https://www.googleapis.com/auth/calendar.readonly',
              'https://www.googleapis.com/auth/chrome.management.appdetails.readonly',
              'https://www.googleapis.com/auth/chrome.management.profiles.readonly',
              'https://www.googleapis.com/auth/chrome.management.reports.readonly',
              'https://www.googleapis.com/auth/chrome.management.telemetry.readonly',
              'https://www.googleapis.com/auth/cloud-identity.devices.readonly',
              'https://www.googleapis.com/auth/drive.labels.readonly',
              'https://www.googleapis.com/auth/ediscovery.readonly',
              'https://www.googleapis.com/auth/apps.licensing',
              'https://www.googleapis.com/auth/gmail.labels',
              'https://www.googleapis.com/auth/drive.apps.readonly',
              'https://www.googleapis.com/auth/admin.chrome.printers.readonly',
              'https://www.googleapis.com/auth/chrome.management.connectors.readonly',
              'https://www.googleapis.com/auth/admin.directory.device.chromeos.readonly',
            ]
            const dwdFactory = googleDwdAuthFactory({ ref: 'CRED-GW-01', key: gKey, transport })
            const ungrantedDwd: string[] = []
            await Promise.all(
              dwdProbes.map(async (scopeUrl) => {
                try {
                  await dwdFactory(gwsSubject, [scopeUrl]).headers('GET', 'https://www.googleapis.com/oauth2/v1/tokeninfo')
                } catch {
                  ungrantedDwd.push(scopeUrl)
                }
              }),
            )
            const ungrantedSet = new Set(ungrantedDwd)
            const verifiedDwdScopes = dwdAllScopes.filter(s => !ungrantedSet.has(s))
            saveEnvValues({ GWS_GRANTED_SCOPES: verifiedDwdScopes.join(' ') }, env, envFile)
            const missingNote = ungrantedDwd.length
              ? ` · DWD 미위임: ${ungrantedDwd.map(s => s.replace('https://www.googleapis.com/auth/', '')).join(', ')}`
              : ''
            return {
              ok: true,
              detail: `연결 및 권한 확인 완료 (Google Workspace DWD: ${okList.join(', ')} 정상 · ${verifiedDwdScopes.length}개 DWD 스코프 반영${missingNote})`,
            }
          }
          return { ok: true, detail: `연결 및 권한 확인 완료 (Google Workspace: ${okList.join(', ')} 정상)` }
        }
        let msg = ''
        if (typeof res.body === 'object' && res.body !== null) {
          const b = res.body as any
          if (b.error?.message) msg = `: ${b.error.message}`
          else if (b.error_description) msg = `: ${b.error_description}`
          else if (typeof b.error === 'string') msg = `: ${b.error}`
        } else if (typeof res.body === 'string' && res.body.trim()) {
          msg = `: ${res.body.slice(0, 150)}`
        }
        return { ok: false, detail: `Google Workspace 응답 HTTP ${res.status}${msg}` }
      } catch (err: any) {
        return { ok: false, detail: `Google Workspace 인증 오류: ${err?.message || '토큰 발급 실패'}` }
      }
    }

    if (credentialId === 'CRED-GH-00' || credentialId === 'CRED-GH-01') {
      if (authMode !== 'oauth' && !merged.GITHUB_APP_PRIVATE_KEY && merged.GITHUB_OWNER_TOKEN) {
        const auth = bearerAuth('CRED-GH-00', merged.GITHUB_OWNER_TOKEN)
        const targetOrg = merged.GITHUB_ORG
        const url = targetOrg ? `https://api.github.com/orgs/${encodeURIComponent(targetOrg)}` : 'https://api.github.com/user'
        const headers = await auth.headers('GET', url)
        const res = await transport({ method: 'GET', url, headers: { Accept: 'application/vnd.github+json', ...headers } })
        if (res.status === 403 && res.headers['x-github-sso']) {
          const ssoMatch = res.headers['x-github-sso'].match(/url=([^;\s]+)/)
          const ssoUrl = ssoMatch ? ssoMatch[1] : undefined
          return {
            ok: false,
            detail: `조직 [${targetOrg || 'GitHub'}]의 SAML SSO 승인이 필요합니다. 승인 후 다시 확인해 주세요.`,
            ssoUrl,
            org: targetOrg,
          }
        }
        const targetSuffix = targetOrg ? ` (조직: ${targetOrg})` : ''
        return res.status === 200 ? { ok: true, detail: `연결 확인 완료 (GitHub 소유자 PAT 연동 확인 성공${targetSuffix})` } : { ok: false, detail: `GitHub 응답 HTTP ${res.status}` }
      }
      if (!merged.GITHUB_APP_PRIVATE_KEY && merged.GITHUB_COLLECTOR_OAUTH_TOKEN) {
        const auth = bearerAuth('CRED-GH-01', merged.GITHUB_COLLECTOR_OAUTH_TOKEN)
        const url = 'https://api.github.com/user'
        const headers = await auth.headers('GET', url)
        const res = await transport({ method: 'GET', url, headers: { Accept: 'application/vnd.github+json', ...headers } })
        return res.status === 200 ? { ok: true, detail: '연결 확인 완료 (GitHub OAuth 토큰 확인 성공)' } : { ok: false, detail: `GitHub 응답 HTTP ${res.status}` }
      }
      const pem = resolveGithubAppPem(merged)
      const appId = (merged.GITHUB_APP_ID ?? '').trim()
      const installationId = merged.GITHUB_APP_INSTALLATION_ID || merged.GITHUB_APP_ENTERPRISE_INSTALLATION_ID
      if (!appId || !installationId || !pem) {
        return { ok: false, detail: 'GitHub App(ID, Installation ID, Private Key) 설정이 필요합니다. 대시보드에서 [새 GitHub App 생성 (Manifest)]을 진행하거나 직접 입력해 주세요.' }
      }
      const auth = githubAppAuth({
        ref: 'CRED-GH-01',
        appId,
        installationId,
        privateKeyPem: pem.replace(/\\n/g, '\n'),
        transport,
      })
      const url = 'https://api.github.com/installation/repositories?per_page=1'
      const headers = await auth.headers('GET', url)
      const res = await transport({ method: 'GET', url, headers: { Accept: 'application/vnd.github+json', ...headers } })
      if (res.status !== 200) return { ok: false, detail: `GitHub 응답 HTTP ${res.status}` }
      const targetOrg = (merged.GITHUB_ORG ?? '').trim()
      if (targetOrg) {
        const encOrg = encodeURIComponent(targetOrg)
        const { okList, deniedList, skippedList } = await runPermissionProbes(
          [
            { label: 'org', url: `https://api.github.com/orgs/${encOrg}` },
            { label: 'members', url: `https://api.github.com/orgs/${encOrg}/members?per_page=1` },
            { label: 'teams', url: `https://api.github.com/orgs/${encOrg}/teams?per_page=1` },
            { label: 'audit-log', url: `https://api.github.com/orgs/${encOrg}/audit-log?per_page=1`, optionalStatuses: [404] },
          ],
          u => auth.headers('GET', u),
          transport,
          'application/vnd.github+json',
        )
        const coreDenied = deniedList.filter(d => !d.startsWith('audit-log('))
        if (coreDenied.length > 0) {
          return {
            ok: false,
            detail: `GitHub App은 설치되었으나 조직(${targetOrg}) 수집 권한이 부족합니다 — 정상: ${['repositories', ...okList].join(', ')} / 권한 부족: ${coreDenied.join(', ')}`,
          }
        }
        const auditNote = deniedList.find(d => d.startsWith('audit-log('))
          ? ' (참고: audit-log는 Enterprise Cloud 플랜 전용)'
          : skippedList.includes('audit-log')
            ? ' (audit-log 미지원 플랜)'
            : ''
        return {
          ok: true,
          detail: `연결 및 권한 확인 완료 (GitHub App 조직 ${targetOrg}: ${['repositories', ...okList].join(', ')} 정상${auditNote})`,
        }
      }
      const entSuffix = merged.GITHUB_ENTERPRISE ? ` (엔터프라이즈: ${merged.GITHUB_ENTERPRISE})` : ''
      return { ok: true, detail: `연결 확인 완료 (GitHub App 설치 토큰 발급 및 연동 확인 성공${entSuffix})` }
    }

    if (credentialId === 'CRED-GH-02') {
      if (!merged.GITHUB_OWNER_TOKEN) return { ok: false, detail: 'GITHUB_OWNER_TOKEN이 필요합니다.' }
      const auth = bearerAuth('CRED-GH-02', merged.GITHUB_OWNER_TOKEN)
      const explicitOrgs = (merged.GITHUB_ORGS || merged.GITHUB_ORG || '')
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean)
      let orgList = [...explicitOrgs]

      // 조직 목록이 비어 있으면 사용자의 소속 조직을 직접 조회하여 검사
      if (!orgList.length) {
        try {
          const userOrgsRes = await transport({
            method: 'GET',
            url: 'https://api.github.com/user/orgs?per_page=100',
            headers: { Accept: 'application/vnd.github+json', ...(await auth.headers('GET', 'https://api.github.com/user/orgs')) },
          })
          if (userOrgsRes.status === 200 && Array.isArray(userOrgsRes.body)) {
            orgList = userOrgsRes.body.map((o: any) => o.login).filter(Boolean)
          }
        } catch {
          // pass
        }
      }

      // 1. 조직들의 SAML SSO 인가 상태 검사 (명시 선택된 경우 선택 조직만, 미선택 시 접근 가능한 조직이 있으면 통과)
      const okOrgs: string[] = []
      let firstSso: { detail: string; ssoUrl?: string; org: string } | null = null
      for (const org of orgList) {
        const url = `https://api.github.com/orgs/${encodeURIComponent(org)}`
        const headers = await auth.headers('GET', url)
        const res = await transport({ method: 'GET', url, headers: { Accept: 'application/vnd.github+json', ...headers } })
        if (res.status === 403 && res.headers['x-github-sso']) {
          const ssoMatch = res.headers['x-github-sso'].match(/url=([^;\s]+)/)
          const ssoUrl = ssoMatch ? ssoMatch[1] : undefined
          const isEnterprise = ssoUrl?.includes('/enterprises/')
          const entName = isEnterprise ? (ssoUrl?.match(/\/enterprises\/([^/?;\s]+)/)?.[1] || org) : org
          const ssoInfo = {
            detail: `${isEnterprise ? `엔터프라이즈 [${entName}]` : `조직 [${org}]`}의 SAML SSO 인증이 필요합니다. 아래 [SAML SSO 1회 승인] 버튼을 눌러 승인을 완료해 주세요.`,
            ssoUrl,
            org: entName || org,
          }
          if (explicitOrgs.length > 0) {
            return { ok: false, ...ssoInfo }
          }
          if (!firstSso) firstSso = ssoInfo
          continue
        }
        if (res.status === 200) {
          okOrgs.push(org)
        }
      }
      if (explicitOrgs.length === 0 && orgList.length > 0 && okOrgs.length === 0 && firstSso) {
        return { ok: false, ...firstSso }
      }

      // 2. 엔터프라이즈 슬러그가 있는 경우 엔터프라이즈 SAML 상태 검사
      if (merged.GITHUB_ENTERPRISE?.trim()) {
        const ent = merged.GITHUB_ENTERPRISE.trim()
        const entUrl = `https://api.github.com/enterprises/${encodeURIComponent(ent)}/audit-log?per_page=1`
        const entHeaders = await auth.headers('GET', entUrl)
        const entRes = await transport({ method: 'GET', url: entUrl, headers: { Accept: 'application/vnd.github+json', ...entHeaders } })
        if (entRes.status === 403 && entRes.headers['x-github-sso']) {
          const ssoMatch = entRes.headers['x-github-sso'].match(/url=([^;\s]+)/)
          const ssoUrl = ssoMatch ? ssoMatch[1] : undefined
          return {
            ok: false,
            detail: `엔터프라이즈 [${ent}]의 SAML SSO 인증이 필요합니다. 아래 [SAML SSO 1회 승인] 버튼을 눌러 승인을 완료해 주세요.`,
            ssoUrl,
            org: ent,
          }
        }
      }

      // 3. 조직이 전혀 없는 개인 계정인 경우 사용자 프로필 검사
      if (!orgList.length) {
        const userUrl = 'https://api.github.com/user'
        const userHeaders = await auth.headers('GET', userUrl)
        const userRes = await transport({ method: 'GET', url: userUrl, headers: { Accept: 'application/vnd.github+json', ...userHeaders } })
        return userRes.status === 200
          ? { ok: true, detail: '연결 확인 완료 (GitHub 사용자 계정 확인)' }
          : { ok: false, detail: `GitHub 응답 HTTP ${userRes.status}` }
      }

      const targetSuffix = ` (조직: ${orgList.join(', ')})`
      return { ok: true, detail: `연결 확인 완료 (SAML SSO 인증 및 조직 접근 정상 확인됨${targetSuffix})` }
    }

    if (credentialId === 'CRED-SL-01' || credentialId === 'CRED-SL-02' || credentialId === 'CRED-SL-03') {
      const tok =
        credentialId === 'CRED-SL-01'
          ? merged.SLACK_COLLECTOR_USER_TOKEN
          : credentialId === 'CRED-SL-02'
            ? merged.SLACK_COLLECTOR_BOT_TOKEN
            : merged.SLACK_CONFIG_TOKEN
      if (!tok) return { ok: false, detail: 'Slack 토큰을 입력해 주세요.' }
      const res = await transport({ method: 'GET', url: 'https://slack.com/api/auth.test', headers: { Authorization: `Bearer ${tok}` } })
      const b = res.body as { ok?: boolean; error?: string; team?: string } | undefined
      if (!b?.ok) return { ok: false, detail: `Slack 오류: ${b?.error ?? `HTTP ${res.status}`}` }
      const scopeHeader = (res.headers['x-oauth-scopes'] ?? '').trim()
      if (scopeHeader && credentialId !== 'CRED-SL-03') {
        const granted = new Set(scopeHeader.split(',').map(s => s.trim()).filter(Boolean))
        if (credentialId === 'CRED-SL-01') {
          const coreScopes = ['users:read', 'channels:read', 'groups:read', 'usergroups:read', 'team:read']
          const entScopes = ['admin', 'admin.users:read', 'admin.conversations:read', 'admin.teams:read', 'admin.usergroups:read', 'admin.apps:read', 'admin.roles:read', 'admin.workflows:read', 'admin.barriers:read', 'auditlogs:read']
          const missingCore = coreScopes.filter(s => !granted.has(s))
          const missingEnt = entScopes.filter(s => !granted.has(s))
          if (missingCore.length > 0) {
            return { ok: false, detail: `Slack 연결은 되었으나 필수 User 권한이 부족합니다 (누락: ${missingCore.join(', ')})` }
          }
          if (merged.SLACK_COLLECTOR_BOT_TOKEN) {
            const teamRes = await transport({
              method: 'GET',
              url: 'https://slack.com/api/team.info',
              headers: { Authorization: `Bearer ${merged.SLACK_COLLECTOR_BOT_TOKEN}` },
            })
            const tb = teamRes.body as { ok?: boolean; error?: string } | undefined
            if (tb && tb.ok === false && tb.error === 'team_access_not_granted') {
              return {
                ok: false,
                detail:
                  'Slack OAuth는 연결되었으나 Enterprise Grid 조직 앱이 대상 워크스페이스에 추가되지 않았습니다 (team_access_not_granted). Slack 조직 관리(Manage organization > Integrations > Installed apps > AEGI Collector)에서 "Add to more workspaces"로 수집할 워크스페이스를 추가한 뒤 다시 점검하세요.',
              }
            }
          }
          if (missingEnt.length > 0) {
            return { ok: true, detail: `연결 확인 완료 (Slack: ${b.team ?? '확인됨'}, 기본 User 권한 정상 / 미포함 Enterprise 권한: ${missingEnt.join(', ')})` }
          }
          return { ok: true, detail: `연결 및 권한 확인 완료 (Slack: ${b.team ?? '확인됨'}, User·Enterprise 스코프 ${granted.size}개 정상)` }
        }
        const botScopes = ['users:read', 'channels:read', 'groups:read', 'channels:history', 'groups:history', 'team:read', 'usergroups:read']
        const missingBot = botScopes.filter(s => !granted.has(s))
        if (missingBot.length > 0) {
          return { ok: false, detail: `Slack 연결되었으나 Bot 권한이 부족합니다 (누락: ${missingBot.join(', ')})` }
        }
        if (credentialId === 'CRED-SL-02') {
          const teamRes = await transport({
            method: 'GET',
            url: 'https://slack.com/api/team.info',
            headers: { Authorization: `Bearer ${tok}` },
          })
          const tb = teamRes.body as { ok?: boolean; error?: string } | undefined
          if (tb && tb.ok === false && tb.error === 'team_access_not_granted') {
            return {
              ok: false,
              detail:
                'Slack Bot 토큰은 유효하나 Enterprise Grid 조직 앱이 대상 워크스페이스에 추가되지 않았습니다 (team_access_not_granted). Slack 조직 관리(Manage organization > Integrations > Installed apps > AEGI Collector)에서 "Add to more workspaces"로 워크스페이스를 추가하세요.',
            }
          }
        }
        return { ok: true, detail: `연결 및 권한 확인 완료 (Slack: ${b.team ?? '확인됨'}, Bot 스코프 ${botScopes.length}개 정상)` }
      }
      return { ok: true, detail: `연결 확인 완료 (Slack 워크스페이스: ${b.team ?? '확인됨'})` }
    }

    if (credentialId === 'CRED-AT-01') {
      const atClientSecret = merged.ATLASSIAN_COLLECTOR_CLIENT_SECRET || ''
      if ((authMode === 'oauth' || !merged.ATLASSIAN_COLLECTOR_API_TOKEN) && merged.ATLASSIAN_COLLECTOR_REFRESH_TOKEN && merged.ATLASSIAN_COLLECTOR_CLIENT_ID && atClientSecret) {
        const auth = oauthRefreshTokenAuth({
          ref: 'CRED-AT-01',
          tokenUrl: merged.AEGI_ATLASSIAN_TOKEN_URL || 'https://auth.atlassian.com/oauth/token',
          clientId: merged.ATLASSIAN_COLLECTOR_CLIENT_ID,
          clientSecret: atClientSecret,
          refreshToken: merged.ATLASSIAN_COLLECTOR_REFRESH_TOKEN,
          transport,
          onRotate: ({ refreshToken }) => saveEnvValues({ ATLASSIAN_COLLECTOR_REFRESH_TOKEN: refreshToken }, env, envFile),
        })
        const cloudId = merged.ATLASSIAN_CLOUD_ID
        const url = cloudId
          ? `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`
          : 'https://api.atlassian.com/oauth/token/accessible-resources'
        const headers = await auth.headers('GET', url)
        const res = await transport({ method: 'GET', url, headers: { Accept: 'application/json', ...headers } })
        return res.status === 200 ? { ok: true, detail: '연결 확인 완료 (Atlassian OAuth 3LO 확인 성공)' } : { ok: false, detail: `Atlassian 응답 HTTP ${res.status}` }
      }
      if (authMode === 'oauth') {
        return { ok: false, detail: 'Atlassian OAuth 2.0 (3LO) 갱신 토큰이 설정되지 않았습니다.' }
      }
      let rawSite = (merged.ATLASSIAN_SITE_URL ?? '').trim().replace(/\/+$/, '').replace(/\/(wiki|jira)$/, '')
      if (rawSite && !/^https?:\/\//i.test(rawSite)) {
        rawSite = rawSite.includes('.') ? `https://${rawSite}` : `https://${rawSite}.atlassian.net`
      }
      const site = normalizeAtlassianSiteUrl(rawSite)
      if (!site || !merged.ATLASSIAN_COLLECTOR_EMAIL || !merged.ATLASSIAN_COLLECTOR_API_TOKEN) {
        return { ok: false, detail: 'Atlassian OAuth 토큰 또는 (사이트 주소, 이메일, API 토큰) 설정이 필요합니다.' }
      }
      if (rawSite && rawSite !== merged.ATLASSIAN_SITE_URL) {
        saveEnvValues({ ATLASSIAN_SITE_URL: site }, env, envFile)
      }
      const auth = atlassianBasicAuth('CRED-AT-01', merged.ATLASSIAN_COLLECTOR_EMAIL, merged.ATLASSIAN_COLLECTOR_API_TOKEN)
      const url = `${site}/rest/api/3/myself`
      const headers = await auth.headers('GET', url)
      const res = await transport({ method: 'GET', url, headers: { Accept: 'application/json', ...headers } })
      if (res.status === 200) {
        const body = res.body as { displayName?: string; emailAddress?: string } | undefined
        const name = body?.displayName || body?.emailAddress || '확인됨'
        const { okList, deniedList } = await runPermissionProbes(
          [
            { label: 'Jira 사용자', url: `${site}/rest/api/3/users/search?maxResults=1` },
            { label: 'Confluence 스페이스', url: `${site}/wiki/api/v2/spaces?limit=1`, optionalStatuses: [404] },
          ],
          u => auth.headers('GET', u),
          transport,
        )
        if (deniedList.length > 0) {
          return {
            ok: false,
            detail: `Atlassian(${name}) 연결은 되었으나 수집 권한이 부족합니다 — 정상: ${['myself', ...okList].join(', ')} / 권한 부족: ${deniedList.join(', ')}`,
          }
        }
        if (draftValues && (draftValues.ATLASSIAN_SITE_URL || draftValues.ATLASSIAN_COLLECTOR_EMAIL || draftValues.ATLASSIAN_COLLECTOR_API_TOKEN)) {
          saveEnvValues(
            {
              ATLASSIAN_SITE_URL: site,
              ATLASSIAN_COLLECTOR_EMAIL: merged.ATLASSIAN_COLLECTOR_EMAIL,
              ATLASSIAN_COLLECTOR_API_TOKEN: merged.ATLASSIAN_COLLECTOR_API_TOKEN,
            },
            env,
            envFile,
          )
        }
        return { ok: true, detail: `연결 및 권한 확인 완료 (Jira/Confluence 관리자: ${name}, ${['myself', ...okList].join(', ')} 정상)` }
      }
      return { ok: false, detail: `Atlassian 응답 HTTP ${res.status}${res.status === 401 ? ' (이메일 또는 API 토큰 불일치)' : res.status === 403 ? ' (관리자 권한 부족)' : ''}` }
    }

    if (credentialId === 'CRED-AT-ORG-01' || credentialId === 'CRED-AT-ORG-02') {
      const orgKey = merged.ATLASSIAN_ORG_AUDIT_API_KEY || merged.ATLASSIAN_COLLECTOR_ORG_API_KEY
      let orgId = (merged.ATLASSIAN_ORG_ID ?? '').trim()
      if (!orgKey) return { ok: false, detail: 'Atlassian 조직 API 키를 입력해 주세요.' }
      const url = orgId
        ? `https://api.atlassian.com/admin/v1/orgs/${encodeURIComponent(orgId)}`
        : 'https://api.atlassian.com/admin/v1/orgs'
      const auth = bearerAuth('CRED-AT-ORG-02', orgKey)
      const headers = await auth.headers('GET', url)
      const res = await transport({ method: 'GET', url, headers: { Accept: 'application/json', ...headers } })
      if (res.status === 200) {
        if (draftValues && (draftValues.ATLASSIAN_ORG_AUDIT_API_KEY || draftValues.ATLASSIAN_COLLECTOR_ORG_API_KEY)) {
          saveEnvValues(
            { ATLASSIAN_ORG_AUDIT_API_KEY: orgKey, ATLASSIAN_COLLECTOR_ORG_API_KEY: orgKey },
            env,
            envFile,
          )
        }
        const bodyData = (res.body as any)?.data
        let orgName = ''
        if (Array.isArray(bodyData) && bodyData.length > 0) {
          const firstOrg = bodyData[0]
          if (firstOrg?.id) {
            orgId = firstOrg.id
            orgName = firstOrg.attributes?.name || ''
            saveEnvValues({ ATLASSIAN_ORG_ID: orgId }, env, envFile)
          }
        } else if (bodyData?.id) {
          orgId = bodyData.id
          orgName = bodyData.attributes?.name || ''
          saveEnvValues({ ATLASSIAN_ORG_ID: orgId }, env, envFile)
        }
        const discoveredSites: Array<{ url: string; name?: string }> = []
        if (orgId) {
          try {
            const wsUrl = `https://api.atlassian.com/admin/v2/orgs/${encodeURIComponent(orgId)}/workspaces`
            const wsHeaders = await auth.headers('POST', wsUrl)
            const wsRes = await transport({
              method: 'POST',
              url: wsUrl,
              headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...wsHeaders },
              body: JSON.stringify({ limit: 100 }),
            })
            if (wsRes.status === 200) {
              const wsItems = Array.isArray((wsRes.body as any)?.data) ? (wsRes.body as any).data : []
              const seen = new Set<string>()
              for (const item of wsItems) {
                const rawUrl = String(item?.attributes?.hostUrl || item?.attributes?.url || item?.attributes?.workspaceUrl || '').trim()
                if (!rawUrl) continue
                let origin = ''
                try {
                  const u = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
                  if (!u.hostname.toLowerCase().endsWith('.atlassian.net')) continue
                  origin = u.origin.toLowerCase()
                } catch {
                  continue
                }
                const normalized = normalizeAtlassianSiteUrl(origin)
                if (!normalized || seen.has(normalized)) continue
                seen.add(normalized)
                const name = typeof item?.attributes?.name === 'string' ? item.attributes.name.trim() : undefined
                discoveredSites.push({ url: normalized, ...(name ? { name } : {}) })
              }
              if (discoveredSites.length > 0) {
                const allUrls = discoveredSites.map(s => s.url).join(',')
                const currentSite = (merged.ATLASSIAN_SITE_URL ?? '').trim()
                const looksBroken = !currentSite || !/^https:\/\/[^/]+\.atlassian\.net$/i.test(currentSite)
                if (looksBroken || discoveredSites.length === 1) {
                  saveEnvValues({ ATLASSIAN_SITE_URL: discoveredSites[0]!.url, ATLASSIAN_SITE_URLS: allUrls }, env, envFile)
                }
              }
            }
          } catch {
            // workspaces 조회 실패 시에도 조직 연결 확인 자체는 유지
          }
        }
        const siteSuffix = discoveredSites.length > 0
          ? `, 사이트 ${discoveredSites.length}개 감지${discoveredSites.length === 1 && !merged.ATLASSIAN_SITE_URL ? ` (${discoveredSites[0]!.url} 자동 입력됨)` : ''}`
          : ''
        return {
          ok: true,
          detail: orgId
            ? `연결 확인 완료 (Guard 조직: ${orgName || '확인됨'}, ID: ${orgId}${!merged.ATLASSIAN_ORG_ID ? ' 자동 저장됨' : ''}${siteSuffix})`
            : '연결 확인 완료 (Atlassian Organization Admin API 200 OK)',
          ...(orgId ? { orgId } : {}),
          ...(discoveredSites.length > 0 ? { sites: discoveredSites } : {}),
        }
      }
      return { ok: false, detail: `Atlassian 조직 API 응답 HTTP ${res.status}${res.status === 401 ? ' (조직 API 키 불일치)' : res.status === 403 ? ' (조직 관리자 권한 부족)' : ''}` }
    }

    if (credentialId === 'CRED-GCP-01') {
      const clientId = (merged.GCP_COLLECTOR_CLIENT_ID ?? '').trim()
      const refreshToken = (merged.GCP_COLLECTOR_REFRESH_TOKEN ?? '').trim()
      if (!clientId || !refreshToken) {
        return { ok: false, detail: 'GCP OAuth Client ID와 Refresh Token을 입력하거나 OAuth 연결을 먼저 진행해 주세요.' }
      }
      const auth = oauthRefreshTokenAuth({
        ref: 'CRED-GCP-01',
        tokenUrl: merged.AEGI_GCP_TOKEN_URL || 'https://oauth2.googleapis.com/token',
        clientId,
        clientSecret: merged.GCP_COLLECTOR_CLIENT_SECRET?.trim() || undefined,
        refreshToken,
        transport,
        onRotate: ({ refreshToken: nextToken }) => saveEnvValues({ GCP_COLLECTOR_REFRESH_TOKEN: nextToken }, env, envFile),
      })
      const url = 'https://cloudresourcemanager.googleapis.com/v3/projects:search?pageSize=5'
      const headers = await auth.headers('GET', url)
      const res = await transport({ method: 'GET', url, headers: { Accept: 'application/json', ...headers } })
      if (res.status === 200) {
        const count = Array.isArray((res.body as any)?.projects) ? (res.body as any).projects.length : 0
        return { ok: true, detail: `연결 확인 완료 (GCP Resource Manager 200 OK · 조회 가능 프로젝트 ${count}개 이상)` }
      }
      return { ok: false, detail: `GCP Resource Manager 응답 HTTP ${res.status}` }
    }

    if (credentialId === 'CRED-OP-01') {
      const token = (merged.ONEPASSWORD_SERVICE_ACCOUNT_TOKEN ?? '').trim()
      if (!token) return { ok: false, detail: '1Password Service Account Token(ONEPASSWORD_SERVICE_ACCOUNT_TOKEN)을 입력해 주세요.' }
      const ver = spawnSync('op', ['--version'], { encoding: 'utf8', timeout: 2000, windowsHide: true })
      if (ver.status !== 0) {
        return { ok: false, detail: '로컬 PC에 1Password CLI(op)가 설치되어 있지 않습니다. CLI를 설치한 뒤 다시 확인해 주세요.' }
      }
      const who = spawnSync('op', ['whoami', '--format', 'json'], {
        env: { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: token },
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
      })
      if (who.status === 0 && who.stdout.trim()) {
        try {
          const info = JSON.parse(who.stdout) as { account_uuid?: string; url?: string }
          return { ok: true, detail: `연결 확인 완료 (1Password CLI ${ver.stdout.trim()} · 계정 ${info.account_uuid || '확인됨'})` }
        } catch {
          return { ok: true, detail: `연결 확인 완료 (1Password CLI ${ver.stdout.trim()})` }
        }
      }
      return { ok: false, detail: `1Password op whoami 실패: ${(who.stderr || who.stdout || '').split(/\r?\n/)[0].slice(0, 160)}` }
    }

    if (credentialId === 'CRED-OP-02') {
      const token = (merged.ONEPASSWORD_EVENTS_TOKEN ?? '').trim()
      if (!token) return { ok: false, detail: '1Password Events Reporting Token(ONEPASSWORD_EVENTS_TOKEN)을 입력해 주세요.' }
      const host = (merged.ONEPASSWORD_EVENTS_HOST || 'https://events.1password.com').replace(/\/+$/, '')
      const url = `${host}/api/v3/auditevents?max_page_size=1`
      const headers = await bearerAuth('CRED-OP-02', token).headers('GET', url)
      const res = await transport({ method: 'GET', url, headers: { Accept: 'application/json', ...headers } })
      if (res.status === 200) return { ok: true, detail: '연결 확인 완료 (1Password Events API v3 200 OK)' }
      return { ok: false, detail: `1Password Events API 응답 HTTP ${res.status}` }
    }

    if (credentialId === 'CRED-M365-01') {
      const tenantId = (merged.M365_TENANT_ID ?? '').trim()
      const clientId = (merged.M365_CLIENT_ID ?? '').trim()
      const clientSecret = (merged.M365_CLIENT_SECRET ?? '').trim()
      if (!tenantId || !clientId || !clientSecret) {
        return { ok: false, detail: 'Microsoft 365 Tenant ID, Client ID, Client Secret을 모두 입력해 주세요.' }
      }
      const tokenRes = await transport({
        method: 'POST',
        url: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
        }).toString(),
      })
      const accessToken = typeof (tokenRes.body as any)?.access_token === 'string' ? (tokenRes.body as any).access_token : ''
      if (tokenRes.status !== 200 || !accessToken) {
        const desc = (tokenRes.body as any)?.error_description || (tokenRes.body as any)?.error || `HTTP ${tokenRes.status}`
        return { ok: false, detail: `Microsoft 365 토큰 발급 실패: ${String(desc).slice(0, 160)}` }
      }
      const orgRes = await transport({
        method: 'GET',
        url: 'https://graph.microsoft.com/v1.0/organization',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      })
      if (orgRes.status === 200) {
        const orgName = (orgRes.body as any)?.value?.[0]?.displayName || tenantId
        return { ok: true, detail: `연결 확인 완료 (Microsoft Graph 200 OK · 조직: ${orgName})` }
      }
      return { ok: false, detail: `Microsoft Graph /organization 응답 HTTP ${orgRes.status} (Admin Consent 및 Organization.Read.All 권한 확인 필요)` }
    }

    if (credentialId === 'CRED-SNOW-01') {
      const account = (merged.SNOWFLAKE_ACCOUNT ?? '').trim()
      const user = (merged.SNOWFLAKE_COLLECTOR_USER ?? '').trim()
      const pem = (merged.SNOWFLAKE_COLLECTOR_PRIVATE_KEY ?? '').trim()
      if (!account || !user || !pem) {
        return { ok: false, detail: 'Snowflake Account, Collector User, Private Key(PEM)를 모두 입력해 주세요.' }
      }
      try {
        createPrivateKey(pem.replace(/\\n/g, '\n'))
      } catch {
        return { ok: false, detail: 'Snowflake Private Key가 올바른 RSA PEM 형식이 아닙니다.' }
      }
      return {
        ok: true,
        detail: `키 형식 확인 완료 (계정: ${account}, 사용자: ${user} — 엔진 Snowflake 수집기 머지 후 실수집이 활성화됩니다)`,
      }
    }

    if (credentialId === 'CRED-AWS-01') {
      const accessKeyId = (merged.AWS_ACCESS_KEY_ID ?? '').trim()
      const secretAccessKey = (merged.AWS_SECRET_ACCESS_KEY ?? '').trim()
      if (!accessKeyId || !secretAccessKey) {
        return { ok: false, detail: 'AWS Access Key ID와 Secret Access Key를 모두 입력해 주세요.' }
      }
      if (!/^(AKIA|ASIA)[A-Z0-9]{16}$/.test(accessKeyId)) {
        return { ok: false, detail: 'AWS_ACCESS_KEY_ID 형식이 올바르지 않습니다 (AKIA... 또는 ASIA... 20자리).' }
      }
      const region = (merged.AWS_REGION ?? '').trim() || 'ap-northeast-2'
      const sessionToken = (merged.AWS_SESSION_TOKEN ?? '').trim() || undefined
      const auth = awsSigV4Auth({ ref: 'CRED-AWS-01', accessKeyId, secretAccessKey, sessionToken, region, service: 'sts' })
      const url = `https://sts.${region}.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15`
      const headers = await auth.headers('GET', url)
      const res = await transport({ method: 'GET', url, headers: { Accept: 'application/json', ...headers } })
      const body = res.body as {
        GetCallerIdentityResponse?: { GetCallerIdentityResult?: { Account?: string; Arn?: string } }
        ErrorResponse?: { Error?: { Message?: string; Code?: string } }
      } | undefined
      if (res.status !== 200) {
        const errMsg = body?.ErrorResponse?.Error?.Message || body?.ErrorResponse?.Error?.Code || `HTTP ${res.status}`
        return { ok: false, detail: `AWS STS GetCallerIdentity 실패: ${errMsg}` }
      }
      const result = body?.GetCallerIdentityResponse?.GetCallerIdentityResult
      const account = result?.Account ?? '확인됨'
      const arn = result?.Arn ?? ''
      return { ok: true, detail: `연결 확인 완료 (AWS 계정: ${account}${arn ? `, ${arn}` : ''}, 리전: ${region})` }
    }

    return { ok: false, detail: `지원하지 않는 자격증명 ID: ${credentialId}` }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

export interface ManualCleanupLink {
  label: string
  url: string
}

export interface DisconnectOutcome {
  ok: boolean
  revoked: string[]
  warnings: string[]
  manualCleanup: ManualCleanupLink[]
}

/**
 * [연결 해제] 시 로컬 .env 에서 키를 지우기 전에 각 SaaS 서버의 토큰 폐기(Revoke) 또는
 * 앱 설치 제거(Uninstall) API 를 호출하여 원격 세션/설치 상태까지 함께 정리한다.
 */
export async function revokeAndDisconnectProvider(
  provider: string,
  keysToWipe: Record<string, string>,
  env: Record<string, string>,
  envFile = ENV_FILE,
  transport: Transport = fetchTransport,
): Promise<DisconnectOutcome> {
  const revoked: string[] = []
  const warnings: string[] = []
  const manualCleanup: ManualCleanupLink[] = []

  try {
    if (provider === 'github') {
      const pem = resolveGithubAppPem(env)
      const appId = (env.GITHUB_APP_ID ?? '').trim()
      const installIds = [
        { label: 'Organization App 설치', id: env.GITHUB_APP_INSTALLATION_ID },
        { label: 'Enterprise App 설치', id: env.GITHUB_APP_ENTERPRISE_INSTALLATION_ID },
      ].filter((x): x is { label: string; id: string } => Boolean(x.id && x.id.trim()))

      if (installIds.length > 0 && pem && appId) {
        try {
          const jwt = githubAppJwt(appId, pem.replace(/\\n/g, '\n'))

          for (const item of installIds) {
            const res = await transport({
              method: 'DELETE',
              url: `https://api.github.com/app/installations/${encodeURIComponent(item.id)}`,
              headers: {
                Authorization: `Bearer ${jwt}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'aegi-collector-setup',
              },
            })
            if (res.status === 204 || res.status === 404) {
              revoked.push(`GitHub ${item.label}(ID: ${item.id}) 제거 완료`)
            } else {
              warnings.push(`GitHub ${item.label} 제거 응답 HTTP ${res.status}`)
            }
          }
        } catch (err) {
          warnings.push(`GitHub App 제거 중 오류: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      if (env.GITHUB_COLLECTOR_OAUTH_TOKEN && env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET) {
        try {
          const basic = Buffer.from(`${env.GITHUB_OAUTH_CLIENT_ID}:${env.GITHUB_OAUTH_CLIENT_SECRET}`).toString('base64')
          const res = await transport({
            method: 'DELETE',
            url: `https://api.github.com/applications/${encodeURIComponent(env.GITHUB_OAUTH_CLIENT_ID)}/grant`,
            headers: {
              Authorization: `Basic ${basic}`,
              Accept: 'application/vnd.github+json',
              'Content-Type': 'application/json',
              'User-Agent': 'aegi-collector-setup',
            },
            body: JSON.stringify({ access_token: env.GITHUB_COLLECTOR_OAUTH_TOKEN }),
          })
          if (res.status === 204 || res.status === 404) {
            revoked.push('GitHub OAuth 승인 폐기 완료')
          }
        } catch {
          // ignore
        }
      }
    } else if (provider === 'gws' || provider === 'gcp') {
      const token = provider === 'gcp' ? env.GCP_COLLECTOR_REFRESH_TOKEN : env.GWS_COLLECTOR_REFRESH_TOKEN
      if (token) {
        const res = await transport({
          method: 'POST',
          url: 'https://oauth2.googleapis.com/revoke',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }).toString(),
        })
        if (res.status === 200) {
          revoked.push(`${provider === 'gcp' ? 'GCP' : 'Google'} OAuth 갱신 토큰 서버 폐기 완료`)
        } else {
          warnings.push(`${provider === 'gcp' ? 'GCP' : 'Google'} 토큰 폐기 응답 HTTP ${res.status}`)
        }
      }
    } else if (provider === 'slack') {
      const tokens = [
        { label: 'Bot 토큰', val: env.SLACK_COLLECTOR_BOT_TOKEN },
        { label: 'User 토큰', val: env.SLACK_COLLECTOR_USER_TOKEN },
        { label: 'Config 토큰', val: env.SLACK_CONFIG_TOKEN },
      ].filter((x): x is { label: string; val: string } => Boolean(x.val && x.val.trim()))

      for (const t of tokens) {
        const res = await transport({
          method: 'POST',
          url: 'https://slack.com/api/auth.revoke',
          headers: {
            Authorization: `Bearer ${t.val}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: '',
        })
        const b = res.body as { ok?: boolean; error?: string } | undefined
        if (res.status === 200 && (b?.ok || b?.error === 'token_revoked' || b?.error === 'invalid_auth')) {
          revoked.push(`Slack ${t.label} 서버 폐기 완료`)
        } else {
          warnings.push(`Slack ${t.label} 폐기 응답: ${b?.error || `HTTP ${res.status}`}`)
        }
      }
    } else if (provider === 'okta') {
      const orgUrl = normalizeOktaOrgUrl(env.OKTA_ORG_URL ?? '')
      const apiToken = env.OKTA_API_TOKEN
      if (orgUrl && apiToken) {
        const res = await transport({
          method: 'DELETE',
          url: `${orgUrl}/api/v1/api-tokens/current`,
          headers: {
            Accept: 'application/json',
            Authorization: `SSWS ${apiToken}`,
          },
        })
        if (res.status === 204 || res.status === 200) {
          revoked.push('Okta API 토큰 서버 폐기 완료')
        } else {
          warnings.push(`Okta API 토큰 폐기 응답 HTTP ${res.status}`)
        }
      }
      const refresh = env.OKTA_COLLECTOR_REFRESH_TOKEN
      const clientId = env.OKTA_COLLECTOR_CLIENT_ID
      if (orgUrl && refresh && clientId) {
        const params: Record<string, string> = {
          token: refresh,
          token_type_hint: 'refresh_token',
          client_id: clientId,
        }
        if (env.OKTA_COLLECTOR_CLIENT_SECRET) {
          params.client_secret = env.OKTA_COLLECTOR_CLIENT_SECRET
        }
        const res = await transport({
          method: 'POST',
          url: `${orgUrl}/oauth2/v1/revoke`,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams(params).toString(),
        })
        if (res.status === 200) {
          revoked.push('Okta OAuth 갱신 토큰 서버 폐기 완료')
        } else {
          warnings.push(`Okta 토큰 폐기 응답 HTTP ${res.status}`)
        }
      }
    } else if (provider === 'salesforce') {
      const instanceUrl = normalizeSalesforceUrl(env.SALESFORCE_INSTANCE_URL ?? '')
      const refresh = env.SALESFORCE_COLLECTOR_REFRESH_TOKEN
      if (instanceUrl && refresh) {
        const res = await transport({
          method: 'POST',
          url: `${instanceUrl}/services/oauth2/revoke`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refresh }).toString(),
        })
        if (res.status === 200) {
          revoked.push('Salesforce OAuth 갱신 토큰 서버 폐기 완료')
        } else {
          warnings.push(`Salesforce 토큰 폐기 응답 HTTP ${res.status}`)
        }
      }
    }
  } catch (err) {
    warnings.push(`원격 토큰 폐기 요청 실패: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 원격에서 자동 삭제되지 않는 토큰/앱에 대한 콘솔 바로가기 링크
  if (provider === 'github') {
    if (env.GITHUB_OWNER_TOKEN) {
      manualCleanup.push({ label: 'GitHub PAT 폐기 ↗', url: 'https://github.com/settings/tokens' })
    }
    const hadInstall = Boolean(env.GITHUB_APP_INSTALLATION_ID || env.GITHUB_APP_ENTERPRISE_INSTALLATION_ID)
    const appRemoved = revoked.some(r => r.includes('제거 완료'))
    if (hadInstall && !appRemoved) {
      manualCleanup.push({
        label: 'GitHub 앱 설치 제거 ↗',
        url: env.GITHUB_ORG
          ? `https://github.com/organizations/${encodeURIComponent(env.GITHUB_ORG)}/settings/installations`
          : 'https://github.com/settings/installations',
      })
    }
  } else if (provider === 'gws') {
    if (env.GWS_COLLECTOR_SA_KEY) {
      manualCleanup.push(
        { label: 'GWS DWD 위임 삭제 ↗', url: 'https://admin.google.com/ac/owl/domainwidedelegation' },
        { label: 'GCP SA 정리 ↗', url: 'https://console.cloud.google.com/iam-admin/serviceaccounts' },
      )
    }
  } else if (provider === 'slack') {
    if (env.SLACK_COLLECTOR_BOT_TOKEN || env.SLACK_COLLECTOR_USER_TOKEN) {
      manualCleanup.push({ label: 'Slack 앱 목록 확인 ↗', url: 'https://slack.com/apps/manage' })
    }
  } else if (provider === 'okta') {
    if (env.OKTA_COLLECTOR_REFRESH_TOKEN || env.OKTA_COLLECTOR_PRIVATE_KEY) {
      const orgUrl = normalizeOktaOrgUrl(env.OKTA_ORG_URL ?? '')
      manualCleanup.push({ label: 'Okta 앱 설정 확인 ↗', url: orgUrl || 'https://login.okta.com' })
    }
  } else if (provider === 'atlassian') {
    if (env.ATLASSIAN_COLLECTOR_API_TOKEN) {
      manualCleanup.push({ label: 'Atlassian API 토큰 폐기 ↗', url: 'https://id.atlassian.com/manage-profile/security/api-tokens' })
    }
    if (env.ATLASSIAN_COLLECTOR_REFRESH_TOKEN) {
      manualCleanup.push({ label: 'Atlassian 연결 앱 해제 ↗', url: 'https://id.atlassian.com/manage-profile/apps' })
    }
    if (env.ATLASSIAN_ORG_AUDIT_API_KEY || env.ATLASSIAN_COLLECTOR_ORG_API_KEY) {
      manualCleanup.push({ label: 'Atlassian Org 키 폐기 ↗', url: 'https://admin.atlassian.com' })
    }
  }

  // 원격 폐기 성공 여부와 무관하게 로컬 .env 자격증명은 항상 삭제한다
  const emptyUpdates: Record<string, string> = {}
  for (const k of Object.keys(keysToWipe)) {
    emptyUpdates[k] = ''
  }
  saveEnvValues(emptyUpdates, env, envFile)
  const fileKeyByProvider: Record<string, string> = {
    github: 'GITHUB_APP_PRIVATE_KEY_FILE',
    okta: 'OKTA_COLLECTOR_PRIVATE_KEY_FILE',
    gws: 'GWS_COLLECTOR_SA_KEY_FILE',
  }
  const fileKey = fileKeyByProvider[provider]
  if (fileKey) {
    atomicUpdateEnvFile(envFile, { [fileKey]: '' })
    delete env[fileKey]
  }

  return { ok: true, revoked, warnings, manualCleanup }
}

export interface GitHubOrgItem {
  login: string
  name?: string
  description?: string
  avatarUrl?: string
  installationId?: string
  targetType?: 'Organization' | 'Enterprise' | 'User'
}

export async function listGitHubOrganizations(
  env: Record<string, string>,
  transport: Transport = fetchTransport,
): Promise<{ ok: boolean; orgs: GitHubOrgItem[]; error?: string }> {
  const pemContent = resolveGithubAppPem(env)
  const appId = (env.GITHUB_APP_ID ?? '').trim()
  const orgMap = new Map<string, GitHubOrgItem>()

  // 1. App 설치 목록을 통해 설치된 조직/엔터프라이즈 조회
  if (appId && pemContent) {
    try {
      const jwt = githubAppJwt(appId, pemContent.replace(/\\n/g, '\n'))
      const res = await transport({
        method: 'GET',
        url: 'https://api.github.com/app/installations?per_page=100',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'aegi-collector-setup',
        },
      })
      if (res.status === 200 && Array.isArray(res.body)) {
        for (const item of res.body) {
          const targetType = (item.target_type as 'Organization' | 'Enterprise' | 'User') || 'Organization'
          const login = item.account?.login || item.account?.slug
          if (login) {
            orgMap.set(login.toLowerCase(), {
              login,
              installationId: String(item.id),
              targetType,
              avatarUrl: item.account?.avatar_url,
            })
          }
        }
      }
    } catch {
      // pass
    }
  }

  // 2. PAT가 있는 경우 (Enterprise 산하 조직 또는 소속 조직 조회)
  const token = env.GITHUB_OWNER_TOKEN || env.GITHUB_COLLECTOR_OAUTH_TOKEN
  if (token) {
    // 2-1. Enterprise slug가 있으면 해당 엔터프라이즈 산하 조직 조회 시도
    if (env.GITHUB_ENTERPRISE?.trim()) {
      try {
        const ent = env.GITHUB_ENTERPRISE.trim()
        const res = await transport({
          method: 'GET',
          url: `https://api.github.com/enterprises/${encodeURIComponent(ent)}/orgs?per_page=100`,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'aegi-collector-setup',
          },
        })
        if (res.status === 200 && Array.isArray(res.body)) {
          for (const item of res.body) {
            const login = item.login
            if (login && !orgMap.has(login.toLowerCase())) {
              orgMap.set(login.toLowerCase(), {
                login,
                name: item.name,
                description: item.description,
                avatarUrl: item.avatar_url,
                targetType: 'Organization',
              })
            }
          }
        }
      } catch {
        // pass
      }
    }

    // 2-2. 토큰 소유자의 소속 조직 목록 조회
    try {
      const res = await transport({
        method: 'GET',
        url: 'https://api.github.com/user/orgs?per_page=100',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'aegi-collector-setup',
        },
      })
      if (res.status === 200 && Array.isArray(res.body)) {
        for (const item of res.body) {
          const login = item.login
          if (login && !orgMap.has(login.toLowerCase())) {
            orgMap.set(login.toLowerCase(), {
              login,
              description: item.description,
              avatarUrl: item.avatar_url,
              targetType: 'Organization',
            })
          }
        }
      }
    } catch {
      // pass
    }
  }

  const orgs = Array.from(orgMap.values())
  return { ok: true, orgs }
}

