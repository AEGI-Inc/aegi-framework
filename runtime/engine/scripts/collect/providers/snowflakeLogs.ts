/**
 * Snowflake 감사 로그 수집 (SNOW-90, SNOW-91, SNOW-92).
 *
 * SQL API v2 (POST /api/v2/statements) 로 snowflake.account_usage 의 고정 SELECT 문만 실행한다.
 * 인증은 키 쌍 JWT (RS256, node:crypto 만 사용).
 */
import crypto from 'node:crypto'
import { missingCredential, type CollectorConfig } from '../config'
import type { Auth } from '../lib/http'
import type { CallApi, CallDef } from '../lib/runner'
import { SNOWFLAKE_SQL } from '../lib/snowflakeStatements'
import type { ProviderContext } from './common'

const ACCOUNT_USAGE_LOOKBACK_MS = 3 * 3600_000
const LIMIT = 10_000
const MAX_ASYNC_POLLS = 5

export interface SnowflakeColumn {
  name: string
  type?: string
}

export interface SnowflakeStatementResponse {
  statementHandle?: string
  code?: string
  message?: string
  resultSetMetaData?: {
    rowType?: SnowflakeColumn[]
    partitionInfo?: unknown[]
  }
  data?: unknown[][]
}

export function snowflakeKeyPairAuth(
  accountIdentifier: string,
  user: string,
  privateKeyPem: string,
  now: () => number = Date.now,
): Auth {
  const accountUpper = accountIdentifier.trim().toUpperCase()
  const userUpper = user.trim().toUpperCase()
  const privKey = crypto.createPrivateKey(privateKeyPem)
  const pubDer = crypto.createPublicKey(privKey).export({ type: 'spki', format: 'der' })
  const fp = crypto.createHash('sha256').update(pubDer).digest('base64')
  const qualifiedUser = `${accountUpper}.${userUpper}`
  const iss = `${qualifiedUser}.SHA256:${fp}`

  return {
    ref: 'CRED-SNOW-01',
    async headers() {
      const iat = Math.floor(now() / 1000)
      const exp = iat + 30 * 60
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ iss, sub: qualifiedUser, iat, exp })).toString('base64url')
      const signingInput = `${header}.${payload}`
      const sig = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privKey).toString('base64url')
      return {
        Authorization: `Bearer ${signingInput}.${sig}`,
        'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
      }
    },
  }
}

export function rowsToRecords(rowType: SnowflakeColumn[], data: unknown[][]): Record<string, unknown>[] {
  return data.map(row => {
    const rec: Record<string, unknown> = {}
    for (let i = 0; i < rowType.length; i++) {
      rec[rowType[i]!.name] = row[i] ?? null
    }
    return rec
  })
}

function windowStart(api: CallApi, stream: string): string {
  const c = api.cursor(stream)
  if (c?.last_event_at) {
    const ms = Date.parse(c.last_event_at)
    if (Number.isFinite(ms)) {
      return new Date(ms - ACCOUNT_USAGE_LOOKBACK_MS).toISOString()
    }
  }
  return api.period.since
}

function maxTimestamp(records: Record<string, unknown>[], keys: string[]): string | null {
  let bestMs = -Infinity
  let bestIso: string | null = null
  for (const r of records) {
    for (const k of keys) {
      const v = r[k]
      if (typeof v !== 'string' || !v) continue
      const ms = Date.parse(v)
      if (Number.isFinite(ms) && ms > bestMs) {
        bestMs = ms
        bestIso = v
      }
    }
  }
  return bestIso
}

export function snowflakeLogCalls(ctx: ProviderContext, now: () => number = Date.now): CallDef[] {
  const { config, creds } = ctx
  const account = config.snowflake?.accountIdentifier?.trim()
  let cachedAuth: Auth | null = null
  const auth = (): Auth => (cachedAuth ??= snowflakeKeyPairAuth(
    account!,
    creds.require('SNOWFLAKE_COLLECTOR_USER'),
    creds.require('SNOWFLAKE_COLLECTOR_PRIVATE_KEY'),
    now,
  ))

  const unavailable = () =>
    missingCredential(creds, 'CRED-SNOW-01') ?? (account ? null : 'config_missing:snowflake.accountIdentifier')

  const runStatement = async (
    api: CallApi,
    stream: string,
    statement: string,
    bindings: Record<string, { type: string; value: string }>,
    tsKeys: string[],
  ) => {
    const baseUrl = `https://${account!.toLowerCase()}.snowflakecomputing.com/api/v2/statements`
    let rowType: SnowflakeColumn[] = []
    let handle: string | undefined
    let partitionCount = 1
    let isPending = false
    const allRecords: Record<string, unknown>[] = []

    const toEnvelope = (body: SnowflakeStatementResponse) => {
      if (body?.statementHandle) handle = body.statementHandle
      if (body?.resultSetMetaData?.rowType?.length) rowType = body.resultSetMetaData.rowType
      if (Array.isArray(body?.resultSetMetaData?.partitionInfo)) {
        partitionCount = body.resultSetMetaData.partitionInfo.length || 1
      }
      if (!body?.resultSetMetaData?.rowType && !Array.isArray(body?.data)) {
        isPending = true
        return { records: [] }
      }
      isPending = false
      const records = rowsToRecords(rowType, Array.isArray(body.data) ? body.data : [])
      allRecords.push(...records)
      return { records }
    }

    await api.get({
      url: baseUrl,
      auth: auth(),
      method: 'POST',
      readOnlyPost: 'snowflake-log',
      body: JSON.stringify({ statement, timeout: 60, bindings }),
      params: { stream },
      transform: toEnvelope,
    })

    for (let poll = 0; isPending && handle && poll < MAX_ASYNC_POLLS; poll++) {
      await api.get({
        url: `${baseUrl}/${encodeURIComponent(handle)}`,
        auth: auth(),
        params: { stream, poll: poll + 1 },
        transform: toEnvelope,
      })
    }
    if (isPending) {
      api.partial('snowflake_async_timeout')
      return
    }

    if (handle && partitionCount > 1) {
      for (let p = 1; p < partitionCount; p++) {
        await api.get({
          url: `${baseUrl}/${encodeURIComponent(handle)}?partition=${p}`,
          auth: auth(),
          params: { stream, partition: p },
          transform: toEnvelope,
        })
      }
    }

    if (allRecords.length >= LIMIT) {
      api.partial(`limit_${LIMIT}`)
    }
    const last = maxTimestamp(allRecords, tsKeys)
    if (last) api.setCursor(stream, { cursor: null, last_event_at: last })
  }

  const call = (id: string, title: string, stream: string, statement: string, fourBindings: boolean, tsKeys: string[]): CallDef => ({
    id,
    provider: 'snowflake',
    title,
    credential: 'CRED-SNOW-01',
    unavailable,
    async run(api) {
      const since = windowStart(api, stream)
      const until = api.period.until
      const bindings: Record<string, { type: string; value: string }> = {
        '1': { type: 'TEXT', value: since },
        '2': { type: 'TEXT', value: until },
        ...(fourBindings ? { '3': { type: 'TEXT', value: since }, '4': { type: 'TEXT', value: until } } : {}),
      }
      await runStatement(api, stream, statement, bindings, tsKeys)
    },
  })

  return [
    call('SNOW-90', 'Snowflake 로그인 이력 (account_usage.login_history)', 'snowflake:login_history', SNOWFLAKE_SQL.loginHistory, false, ['EVENT_TIMESTAMP']),
    call('SNOW-91', 'Snowflake 쿼리 이력 (account_usage.query_history)', 'snowflake:query_history', SNOWFLAKE_SQL.queryHistory, false, ['START_TIME']),
    call('SNOW-92', 'Snowflake 역할 부여·회수 이력 (account_usage.grants_to_users)', 'snowflake:grants_to_users', SNOWFLAKE_SQL.grantsToUsers, true, ['DELETED_ON', 'CREATED_ON']),
  ]
}
