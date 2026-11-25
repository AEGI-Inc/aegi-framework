/**
 * Slack 설정 토큰(SLACK_CONFIG_TOKEN) 자동 갱신.
 *
 * 12시간마다 만료되는 설정 토큰을 SLACK_CONFIG_REFRESH_TOKEN 으로 갱신한다.
 * 갱신 토큰은 1회용이므로, 새 갱신 토큰과 새 설정 토큰을 한 번에 저장해야 한다.
 * 토큰 값은 로그, 오류 메시지, 반환 객체에 남기지 않는다.
 */
import type { Credentials } from '../config'
import type { HttpResponse, Transport } from './http'

export interface SlackConfigTokenResult {
  status: 'valid' | 'rotated' | 'no_refresh_token' | 'rotate_failed' | 'persist_failed'
  error?: string
  expiresAt?: string
}

const SECRET_RE = /xox[a-z]-[A-Za-z0-9-]+|xoxe(?:\.xox[a-z])?-[A-Za-z0-9-]+|Bearer\s+[A-Za-z0-9._-]+/gi

export function redact(text: string): string {
  return text.replace(SECRET_RE, '[REDACTED]')
}

function redactTokens(text: string, tokens: Array<string | undefined>): string {
  let out = redact(text)
  for (const t of tokens) {
    if (t && t.length > 5) {
      out = out.split(t).join('[REDACTED]')
    }
  }
  return out
}

/**
 * Slack 설정 토큰이 유효한지 확인하고, 필요하면 갱신 토큰으로 갱신하여 creds 에 저장한다.
 */
export async function ensureSlackConfigToken(creds: Credentials, transport: Transport): Promise<SlackConfigTokenResult> {
  const configToken = creds.get('SLACK_CONFIG_TOKEN')
  const refreshToken = creds.get('SLACK_CONFIG_REFRESH_TOKEN')

  if (!configToken && !refreshToken) {
    return { status: 'no_refresh_token' }
  }

  // 1. 설정 토큰이 있으면 auth.test 로 유효성 검사
  if (configToken) {
    let authError: string | undefined
    try {
      const res = await transport({
        method: 'POST',
        url: 'https://slack.com/api/auth.test',
        headers: {
          Authorization: `Bearer ${configToken}`,
          Accept: 'application/json',
        },
      })
      const body = (typeof res.body === 'object' && res.body !== null ? res.body : {}) as { ok?: boolean; error?: string }
      if (res.status === 200 && body.ok === true) {
        return { status: 'valid' }
      }
      authError = body.error ?? (res.status !== 200 ? `http_${res.status}` : 'unknown')
    } catch (err: any) {
      authError = redactTokens(err instanceof Error ? err.message : String(err), [configToken, refreshToken])
    }

    if (!refreshToken) {
      return { status: 'no_refresh_token', error: authError }
    }
  }

  // 2. 만료/인증 실패이거나 설정 토큰이 없고 갱신 토큰이 있으면 tooling.tokens.rotate 로 갱신
  if (!refreshToken) {
    return { status: 'no_refresh_token' }
  }

  let rotateRes: HttpResponse
  try {
    rotateRes = await transport({
      method: 'POST',
      url: 'https://slack.com/api/tooling.tokens.rotate',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: `refresh_token=${encodeURIComponent(refreshToken)}`,
    })
  } catch (err: any) {
    return {
      status: 'rotate_failed',
      error: redactTokens(err instanceof Error ? err.message : String(err), [configToken, refreshToken]),
    }
  }

  const rotateBody = (typeof rotateRes.body === 'object' && rotateRes.body !== null ? rotateRes.body : {}) as {
    ok?: boolean
    error?: string
    token?: string
    refresh_token?: string
    exp?: number
  }

  if (rotateRes.status !== 200 || !rotateBody.ok || !rotateBody.token || !rotateBody.refresh_token) {
    return {
      status: 'rotate_failed',
      error: rotateBody.error ?? (rotateRes.status !== 200 ? `http_${rotateRes.status}` : 'unknown'),
    }
  }

  const nextToken = rotateBody.token
  const nextRefreshToken = rotateBody.refresh_token
  const expiresAt = typeof rotateBody.exp === 'number' ? new Date(rotateBody.exp * 1000).toISOString() : undefined

  // 3. 새 갱신 토큰과 새 설정 토큰을 한 번에 저장. 키를 하나씩 쓰는 저장소를 위해 갱신 토큰을 먼저 둔다(잃으면 사람이 다시 발급)
  const updates: Record<string, string> = {
    SLACK_CONFIG_REFRESH_TOKEN: nextRefreshToken,
    SLACK_CONFIG_TOKEN: nextToken,
  }

  try {
    await creds.setMany(updates, { expiresAt })
  } catch (err: any) {
    return {
      status: 'persist_failed',
      error: redactTokens(err instanceof Error ? err.message : String(err), [configToken, refreshToken, nextToken, nextRefreshToken]),
      expiresAt,
    }
  }

  return {
    status: 'rotated',
    expiresAt,
  }
}
