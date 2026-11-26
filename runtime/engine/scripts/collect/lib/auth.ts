/**
 * 수집 자격증명 (계획서 4.1절). 토큰 교환만 POST 로 전송 계층을 직접 부른다.
 * 토큰·키는 메모리에만 두고 원본·로그에는 자격증명 ID(ref)만 남긴다.
 */
import crypto from 'crypto'
import type { Auth, HttpResponse, Transport } from './http'

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url')

function signRs256(header: object, claims: object, privateKeyPem: string): string {
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKeyPem)
  return `${unsigned}.${b64url(sig)}`
}

export class TokenError extends Error {
  name = 'TokenError'
}

/** 한 호출의 권한·위임 범위 문제 (자격증명 자체는 살아 있다) */
export class ScopedAuthError extends Error {
  name = 'ScopedAuthError'
}

/** 고정 토큰 (Slack xoxp/xoxb, Worker 로그 API, GitHub classic PAT) */
export function bearerAuth(ref: string, token: string): Auth {
  return { ref, headers: async () => ({ Authorization: `Bearer ${token}` }) }
}

// ---------------------------------------------------------------------------
// GitHub App (CRED-GH-01): App JWT → 설치 토큰 (1시간)
// ---------------------------------------------------------------------------

export function githubAppAuth(opts: { ref: string; appId: string; installationId: string; privateKeyPem: string; transport: Transport; now?: () => number }): Auth {
  let cached: { token: string; exp: number } | null = null
  const now = opts.now ?? (() => Date.now())
  async function token(): Promise<string> {
    if (cached && cached.exp > now() + 5 * 60_000) return cached.token
    const iat = Math.floor(now() / 1000) - 60
    const jwt = signRs256({ alg: 'RS256', typ: 'JWT' }, { iat, exp: iat + 540, iss: opts.appId }, opts.privateKeyPem)
    const res = await opts.transport({
      method: 'POST',
      url: `https://api.github.com/app/installations/${opts.installationId}/access_tokens`,
      headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    })
    const body = res.body as { token?: string; expires_at?: string; message?: string }
    if (res.status !== 201 || !body?.token) throw new TokenError(`GitHub App 설치 토큰 발급 실패 (${res.status} ${body?.message ?? ''})`)
    cached = { token: body.token, exp: body.expires_at ? Date.parse(body.expires_at) : now() + 3_600_000 }
    return cached.token
  }
  return { ref: opts.ref, headers: async () => ({ Authorization: `Bearer ${await token()}` }) }
}

export const GITHUB_HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }

// ---------------------------------------------------------------------------
// Salesforce Connected App (CRED-SF-01): OAuth 2.0 Client Credentials 흐름.
// 토큰은 Connected App 에 지정한 실행 사용자(읽기 전용 통합 사용자) 권한으로 나온다.
// ---------------------------------------------------------------------------

export function normalizeSalesforceUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function salesforceClientCredentialsAuth(opts: { ref: string; instanceUrl: string; clientId: string; clientSecret: string; transport: Transport; now?: () => number }): Auth {
  let cached: { token: string; exp: number } | null = null
  const now = opts.now ?? (() => Date.now())
  async function token(): Promise<string> {
    if (cached && cached.exp > now()) return cached.token
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: opts.clientId, client_secret: opts.clientSecret }).toString()
    const res = await opts.transport({ method: 'POST', url: `${normalizeSalesforceUrl(opts.instanceUrl)}/services/oauth2/token`, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body })
    const b = res.body as { access_token?: string; error?: string; error_description?: string }
    if (res.status !== 200 || !b?.access_token) throw new TokenError(`Salesforce 토큰 발급 실패 (${res.status} ${b?.error ?? ''})`)
    // 응답에 만료가 없다. 세션 정책 최소값(15분)보다 짧게 다시 받는다
    cached = { token: b.access_token, exp: now() + 10 * 60_000 }
    return cached.token
  }
  return { ref: opts.ref, headers: async () => ({ Authorization: `Bearer ${await token()}` }) }
}

// ---------------------------------------------------------------------------
// Microsoft 365 / Entra ID (CRED-M365-01): OAuth 2.0 Client Credentials 흐름.
// ---------------------------------------------------------------------------

export function m365ClientCredentialsAuth(opts: {
  ref: string
  tenantId: string
  clientId: string
  clientSecret: string
  transport: Transport
  now?: () => number
}): Auth {
  let cached: { token: string; exp: number } | null = null
  const now = opts.now ?? (() => Date.now())
  async function token(): Promise<string> {
    if (cached && cached.exp > now() + 60_000) return cached.token
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }).toString()
    const res = await opts.transport({
      method: 'POST',
      url: `https://login.microsoftonline.com/${encodeURIComponent(opts.tenantId)}/oauth2/v2.0/token`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    })
    const b = res.body as { access_token?: string; expires_in?: number; error?: string }
    if (res.status !== 200 || !b?.access_token) {
      throw new TokenError(`M365 토큰 발급 실패 (${res.status} ${b?.error ?? ''})`.trim())
    }
    cached = { token: b.access_token, exp: now() + (b.expires_in ?? 3600) * 1000 }
    return cached.token
  }
  return { ref: opts.ref, headers: async () => ({ Authorization: `Bearer ${await token()}` }) }
}

// ---------------------------------------------------------------------------
// Atlassian Cloud (CRED-AT-01): 수집 전용 계정 이메일 + API 토큰 (Basic). Jira, Confluence 공통
// ---------------------------------------------------------------------------

export function atlassianBasicAuth(ref: string, email: string, apiToken: string): Auth {
  const value = Buffer.from(`${email}:${apiToken}`).toString('base64')
  return { ref, headers: async () => ({ Authorization: `Basic ${value}` }) }
}

export function normalizeAtlassianSiteUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/(wiki|jira)$/, '')
}

// ---------------------------------------------------------------------------
// Okta API Service 앱 (CRED-OK-01): private_key_jwt + DPoP
// workers/src/okta.ts 와 같은 흐름을 Node crypto 로. 토큰 주소는 -admin 이 아닌 조직 주소.
// ---------------------------------------------------------------------------

export interface OktaAppConfig {
  ref: string
  orgUrl: string
  clientId: string
  keyId: string
  privateKeyPem: string
  scopes: string[]
  transport: Transport
}

export function normalizeOktaOrgUrl(url: string): string {
  return url.replace(/\/$/, '').replace(/-admin\.okta(preview)?\.com$/, '.okta$1.com')
}

/** Okta SSWS API 토큰 (Security > API > Tokens). 발급한 관리자의 읽기 범위로 동작한다 */
export function oktaSswsAuth(ref: string, apiToken: string): Auth {
  return { ref, headers: async () => ({ Authorization: `SSWS ${apiToken}` }) }
}

export function oktaDpopAuth(cfg: OktaAppConfig): Auth & { grantedScopes(): Promise<string[]> } {
  const orgUrl = normalizeOktaOrgUrl(cfg.orgUrl)
  const { privateKey: dpopKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const { kty, crv, x, y } = publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string; y: string }
  let nonce: string | undefined
  let access: { token: string; exp: number; scopes: string[] } | null = null

  function proof(method: string, url: string, accessToken?: string): string {
    const claims: Record<string, unknown> = { htm: method, htu: url.split('?')[0], iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID() }
    if (nonce) claims.nonce = nonce
    if (accessToken) claims.ath = b64url(crypto.createHash('sha256').update(accessToken).digest())
    const unsigned = `${b64url(JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk: { kty, crv, x, y } }))}.${b64url(JSON.stringify(claims))}`
    const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: dpopKey, dsaEncoding: 'ieee-p1363' })
    return `${unsigned}.${b64url(sig)}`
  }

  async function token(): Promise<{ token: string; scopes: string[] }> {
    if (access && access.exp > Date.now() + 60_000) return access
    const tokenUrl = `${orgUrl}/oauth2/v1/token`
    for (let attempt = 0; attempt < 2; attempt++) {
      const now = Math.floor(Date.now() / 1000)
      const assertion = signRs256({ alg: 'RS256', kid: cfg.keyId }, { iss: cfg.clientId, sub: cfg.clientId, aud: tokenUrl, iat: now, exp: now + 300, jti: crypto.randomUUID() }, cfg.privateKeyPem)
      const res = await cfg.transport({
        method: 'POST',
        url: tokenUrl,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', DPoP: proof('POST', tokenUrl) },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          scope: cfg.scopes.join(' '),
          client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: assertion,
        }).toString(),
      })
      if (res.headers['dpop-nonce']) nonce = res.headers['dpop-nonce']
      const body = (res.body ?? {}) as { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }
      if (res.status === 200 && body.access_token) {
        access = { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000, scopes: (body.scope ?? cfg.scopes.join(' ')).split(' ') }
        return access
      }
      if (body.error === 'use_dpop_nonce' && attempt === 0) continue
      throw new TokenError(`Okta 토큰 발급 실패 (${res.status} ${body.error ?? ''} ${body.error_description ?? ''})`.trim())
    }
    throw new TokenError('Okta 토큰 발급 실패 (DPoP nonce 재시도 후)')
  }

  return {
    ref: cfg.ref,
    async headers(method, url) {
      const t = await token()
      return { Authorization: `DPoP ${t.token}`, DPoP: proof(method, url, t.token) }
    },
    retryAfterResponse(res: HttpResponse) {
      const n = res.headers['dpop-nonce']
      if (res.status === 401 && n && n !== nonce) {
        nonce = n
        return true
      }
      return false
    },
    async grantedScopes() {
      return (await token()).scopes
    },
  }
}

// ---------------------------------------------------------------------------
// Google 서비스 계정 + DWD (CRED-GW-01): 가장 대상(subject)별 토큰
// ---------------------------------------------------------------------------

export interface GoogleKey {
  client_email: string
  private_key: string
}

export function googleDwdAuthFactory(opts: { ref: string; key: GoogleKey; transport: Transport }): (subject: string, scopes: string[]) => Auth {
  const cache = new Map<string, { token: string; exp: number }>()
  return (subject, scopes) => ({
    ref: opts.ref,
    async headers() {
      const cacheKey = `${subject}|${scopes.join(' ')}`
      const hit = cache.get(cacheKey)
      if (hit && hit.exp > Date.now() + 60_000) return { Authorization: `Bearer ${hit.token}` }
      const now = Math.floor(Date.now() / 1000)
      const assertion = signRs256(
        { alg: 'RS256', typ: 'JWT' },
        { iss: opts.key.client_email, sub: subject, scope: scopes.join(' '), aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 },
        opts.key.private_key,
      )
      const res = await opts.transport({
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      })
      const body = (res.body ?? {}) as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
      if (res.status !== 200 || !body.access_token) {
        const message = `Google 토큰 교환 실패 (${res.status} ${body.error ?? ''}: ${body.error_description ?? ''}) — ${subject} / DWD 에 ${scopes.join(', ')} 가 있는지 본다`
        // unauthorized_client·access_denied 는 그 가장 대상·범위만의 문제(위임 범위 누락 등)라 그 호출만 실패시킨다.
        // 키가 틀린 경우(invalid_grant·invalid_client 등)는 GWS 전체를 멈춘다
        if (body.error === 'unauthorized_client' || body.error === 'access_denied') throw new ScopedAuthError(message)
        throw new TokenError(message)
      }
      cache.set(cacheKey, { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 })
      return { Authorization: `Bearer ${body.access_token}` }
    },
  })
}


// ---------------------------------------------------------------------------
// OAuth 2.0 갱신 토큰 인증 (Okta PKCE, Salesforce PKCE, Google 관리자 OAuth 공통)
// 토큰 원문은 오류나 로그에 넣지 않는다. 서버가 새 refresh_token 을 주면(회전) onRotate 로 알린다.
// ---------------------------------------------------------------------------

export interface OAuthRefreshConfig {
  ref: string
  tokenUrl: string
  clientId: string
  clientSecret?: string
  refreshToken: string
  scopes?: string[]
  transport: Transport
  now?: () => number
  onRotate?: (rotated: { refreshToken: string; scope?: string }) => void
}

export function oauthRefreshTokenAuth(cfg: OAuthRefreshConfig): Auth & { grantedScopes(): Promise<string[]> } {
  const now = cfg.now ?? (() => Date.now())
  let currentRefresh = cfg.refreshToken
  let cached: { token: string; exp: number; scopes: string[] } | null = null

  async function refresh(): Promise<{ token: string; scopes: string[] }> {
    if (cached && cached.exp > now() + 60_000) return cached
    const params: Record<string, string> = {
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      refresh_token: currentRefresh,
    }
    if (cfg.clientSecret) params.client_secret = cfg.clientSecret
    if (cfg.scopes?.length) params.scope = cfg.scopes.join(' ')
    const res = await cfg.transport({
      method: 'POST',
      url: cfg.tokenUrl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    })
    const body = (res.body ?? {}) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }
    if (res.status !== 200 || !body.access_token) {
      throw new TokenError(`${cfg.ref} 토큰 갱신 실패 (${res.status} ${body.error ?? ''} ${body.error_description ?? ''})`.trim())
    }
    if (typeof body.refresh_token === 'string' && body.refresh_token && body.refresh_token !== currentRefresh) {
      currentRefresh = body.refresh_token
      cfg.onRotate?.({ refreshToken: currentRefresh, scope: body.scope })
    }
    const ttlMs = (body.expires_in ?? 600) * 1000
    const scopes = body.scope ? body.scope.split(/\s+/).filter(Boolean) : (cfg.scopes ?? [])
    cached = { token: body.access_token, exp: now() + ttlMs, scopes }
    return cached
  }

  return {
    ref: cfg.ref,
    async headers() {
      const t = await refresh()
      return { Authorization: `Bearer ${t.token}` }
    },
    async grantedScopes() {
      return (await refresh()).scopes
    },
  }
}


// ---------------------------------------------------------------------------
// AWS SigV4 Auth (CRED-AWS-01): Node node:crypto 를 이용한 AWS Signature Version 4 구현
// ---------------------------------------------------------------------------

export interface AwsSigV4Options {
  ref: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
  service?: string
  now?: () => Date
}

export function awsSigV4Auth(opts: AwsSigV4Options): Auth {
  const encodeRfc3986 = (s: string) =>
    encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  const sha256Hex = (data: string | Buffer): string =>
    crypto.createHash('sha256').update(data).digest('hex')
  const hmac = (key: string | Buffer, data: string): Buffer =>
    crypto.createHmac('sha256', key).update(data).digest()
  const hmacHex = (key: string | Buffer, data: string): string =>
    crypto.createHmac('sha256', key).update(data).digest('hex')

  return {
    ref: opts.ref,
    async headers(method: string, url: string) {
      const u = new URL(url)
      const service = opts.service ?? u.hostname.split('.')[0]
      const signingRegion =
        service === 'iam' || u.hostname === 'iam.amazonaws.com' || u.hostname === 'sts.amazonaws.com'
          ? 'us-east-1'
          : opts.region

      const d = opts.now ? opts.now() : new Date()
      const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, '')
      const amzDate = iso
      const dateStamp = iso.slice(0, 8)

      const payloadHash = sha256Hex('')

      const rawPath = u.pathname || '/'
      const canonicalUri = rawPath.split('/').map(seg => encodeRfc3986(decodeURIComponent(seg))).join('/') || '/'

      const queryEntries: [string, string][] = []
      u.searchParams.forEach((val, key) => {
        queryEntries.push([encodeRfc3986(key), encodeRfc3986(val)])
      })
      queryEntries.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
      const canonicalQuery = queryEntries.map(([k, v]) => `${k}=${v}`).join('&')

      const headerMap: Record<string, string> = {
        host: u.host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
      }
      if (opts.sessionToken) {
        headerMap['x-amz-security-token'] = opts.sessionToken
      }

      const sortedHeaderKeys = Object.keys(headerMap).sort()
      const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${headerMap[k]}\n`).join('')
      const signedHeaders = sortedHeaderKeys.join(';')

      const canonicalRequest = [
        method.toUpperCase(),
        canonicalUri,
        canonicalQuery,
        canonicalHeaders,
        signedHeaders,
        payloadHash,
      ].join('\n')

      const credentialScope = `${dateStamp}/${signingRegion}/${service}/aws4_request`
      const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
      ].join('\n')

      const kDate = hmac('AWS4' + opts.secretAccessKey, dateStamp)
      const kRegion = hmac(kDate, signingRegion)
      const kService = hmac(kRegion, service)
      const signingKey = hmac(kService, 'aws4_request')
      const signature = hmacHex(signingKey, stringToSign)

      const ret: Record<string, string> = {
        Authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${dateStamp}/${signingRegion}/${service}/aws4_request, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'X-Amz-Date': amzDate,
        'X-Amz-Content-Sha256': payloadHash,
      }
      if (opts.sessionToken) {
        ret['X-Amz-Security-Token'] = opts.sessionToken
      }
      return ret
    },
  }
}
