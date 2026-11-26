/**
 * 감사 로그 주기 적재 (예약 작업용). 감사 로그 호출만 이어 받아(스트림 커서) Splunk HEC 로 보낸다.
 * 대시보드와 AI 는 Splunk 를 그때그때 조회하므로(커넥터 events 조회), 이 명령이 돌면 새 로그가 몇 분 안에 화면에 보인다.
 *
 *   npm run splunk:sync                                   collected/splunk-sync 에 받고 보낸다
 *   npm run splunk:sync -- --since 2026-10-22T11:00:00Z   스트림 커서가 아직 없을 때의 시작 시각(처음 한 번)
 *   npm run splunk:sync -- --dry-run                      수집만 하고 보내지 않는다
 *
 * 경로는 실행한 폴더 기준이다. 수집과 Splunk 자격증명은 Secret Vault 에서 메모리로만 읽는다(.env.vault, .env.setup).
 * 고객 환경에서는 고객 Splunk 에 로그가 이미 들어오므로 이 명령은 시험 환경의 고객 입력 대역이다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Credentials, credentialLoadNames, loadConfig, loadEnv } from '../../collect/config'
import { fetchTransport, HttpLayer } from '../../collect/lib/http'
import { CollectStore } from '../../collect/lib/store'
import { Runner } from '../../collect/lib/runner'
import { newRunId, selectCalls } from '../../collect/calls'
import type { ProviderContext } from '../../collect/providers/common'
import { connectionFromEnv } from './config'
import { shipToSplunk, STREAM_SOURCES } from './ship'
import { pinnedHttpsWire, SearchTransport } from './transport'

/** The audit-log calls ship knows how to send; nothing else is collected. */
export const AUDIT_CALLS = [...new Set(STREAM_SOURCES.map(s => s.callId))]
const SNOWFLAKE_CALLS = new Set(['SNOW-90', 'SNOW-91', 'SNOW-92'])
export const SNOWFLAKE_SYNC_INTERVAL_MS = 55 * 60_000
const SNOWFLAKE_SYNC_FILE = 'snowflake-last-sync.json'
const COLLECT_CREDENTIALS = ['CRED-GH-01', 'CRED-OK-01', 'CRED-SL-01', 'CRED-SL-02', 'CRED-GW-01', 'CRED-SF-01', 'CRED-AT-01', 'CRED-AT-ORG-02', 'CRED-M365-01', 'CRED-OP-02', 'CRED-SNOW-01', 'CRED-GCP-01'] as const
export const SYNC_CREDENTIAL_KEY_NAMES = credentialLoadNames(COLLECT_CREDENTIALS)
const SPLUNK_KEYS = ['SPLUNK_URL', 'SPLUNK_TOKEN', 'SPLUNK_HEC_TOKEN', 'SPLUNK_TLS_SHA256', 'SPLUNK_OKTA_TENANT', 'SPLUNK_GWS_TENANT', 'SPLUNK_HEC_URL']
const LOCK_STALE_MS = 30 * 60_000

export function shouldRunSnowflakeSync(lastSuccessAt: string | null | undefined, nowMs: number): boolean {
  if (!lastSuccessAt) return true
  const prevMs = Date.parse(lastSuccessAt)
  if (!Number.isFinite(prevMs)) return true
  return nowMs - prevMs >= SNOWFLAKE_SYNC_INTERVAL_MS
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' } }

/**
 * One run at a time: a schedule firing while the last run is still going skips instead of doubling HEC sends.
 * A lock whose process is gone (killed by the OS, a sleep or a power change) is taken over at once.
 */
export function acquireLock(dir: string, now = Date.now(), isAlive = alive): (() => void) | null {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'sync.lock')
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: now }), { flag: 'wx' })
  } catch {
    const held = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: number; at?: number } } catch { return {} } })()
    const running = typeof held.pid !== 'number' || held.pid === process.pid || isAlive(held.pid)
    if (running && typeof held.at === 'number' && now - held.at < LOCK_STALE_MS) return null
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: now }))
  }
  return () => fs.rmSync(file, { force: true })
}

async function vaultEnv(names: string[]) {
  const { deriveKey, decrypt } = await import('../../vault/crypto.ts')
  const { getVaultSecret } = await import('../../vault/kv.ts')
  const env = loadEnv('.env.vault')
  const master = process.env.AEGI_VAULT_KEY ?? env.AEGI_VAULT_KEY
  if (!master) throw new Error('AEGI_VAULT_KEY 가 없다 (.env.vault)')
  const key = deriveKey(master)
  for (const name of names) {
    const payload = await getVaultSecret(name)
    if (payload) env[name] = decrypt(payload, key)
  }
  return env
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) { console.log('splunk:sync [--out directory] [--config file] [--since ISO] [--dry-run]\nAudit calls: ' + AUDIT_CALLS.join(', ')); return }
  const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  const outDir = path.resolve(arg('--out') ?? 'collected/splunk-sync')
  const release = acquireLock(outDir)
  if (!release) { console.log(`${new Date().toISOString()} 이전 실행이 아직 돌고 있어 건너뛴다`); return }
  try {
    const names = SYNC_CREDENTIAL_KEY_NAMES
    const env = await vaultEnv([...names, ...SPLUNK_KEYS])
    const config = loadConfig(path.resolve(arg('--config') ?? 'scripts/collect/collector.config.json'))
    const since = arg('--since')
    if (since !== undefined && !Number.isFinite(Date.parse(since))) throw new Error('--since 는 ISO 시각이어야 한다')
    if (since) config.since = since
    const now = new Date(), runId = newRunId(now)
    const snowMarkerPath = path.join(outDir, SNOWFLAKE_SYNC_FILE)
    const lastSnowAt = (() => {
      try { return (JSON.parse(fs.readFileSync(snowMarkerPath, 'utf8')) as { last_success_at?: string }).last_success_at ?? null } catch { return null }
    })()
    const runSnow = shouldRunSnowflakeSync(lastSnowAt, now.getTime())
    const callIds = runSnow ? AUDIT_CALLS : AUDIT_CALLS.filter(id => !SNOWFLAKE_CALLS.has(id))
    const ctx: ProviderContext = { config, creds: new Credentials(env, process.cwd()), transport: fetchTransport }
    const calls = selectCalls(ctx, undefined, callIds)
    const runner = new Runner({ store: new CollectStore(outDir, runId), http: new HttpLayer({ transport: fetchTransport, retryDelayMs: 1000 }),
      period: { since: config.since, until: now.toISOString() }, ignoreCursors: false, log: () => undefined })
    const run = await runner.runAll(calls, { only: null, calls: callIds, full: false })
    if (runSnow) {
      const snowCalls = run.calls.filter(c => c.provider === 'snowflake')
      if (snowCalls.some(c => c.completeness === 'full' || c.completeness === 'partial') && snowCalls.every(c => c.completeness !== 'failed')) {
        fs.writeFileSync(snowMarkerPath, JSON.stringify({ last_success_at: now.toISOString() }) + '\n')
      }
    }
    const summary = run.calls.map(c => `${c.call_id}:${c.completeness}${c.record_count ? `(${c.record_count})` : ''}`).join(' ')
    console.log(`${now.toISOString()} 수집 run=${runId} ${summary}`)
    if (args.includes('--dry-run')) return
    const conn = connectionFromEnv({ ...process.env, ...env,
      ...(process.env.AEGI_SYNC_SPLUNK_URL ? { SPLUNK_URL: process.env.AEGI_SYNC_SPLUNK_URL } : {}),
      ...(process.env.AEGI_SYNC_HEC_URL ? { SPLUNK_HEC_URL: process.env.AEGI_SYNC_HEC_URL } : {}) })
    if (!conn.hecToken) throw new Error('SPLUNK_HEC_TOKEN 이 Vault 에 없다')
    const shipped = await shipToSplunk(new SearchTransport(conn, pinnedHttpsWire(conn.tlsSha256)), outDir)
    const failed = Object.entries(shipped.failed)
    console.log(`${new Date().toISOString()} HEC 전송 ${shipped.sent}건 ${JSON.stringify(shipped.byIndex)}${failed.length ? ` 실패 ${failed.map(([i]) => i).join(',')}` : ''}`)
    if (failed.length || run.calls.some(c => c.completeness === 'failed')) process.exitCode = 1
  } finally {
    release()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(`${new Date().toISOString()} [오류] ${(e as Error).message}`); process.exitCode = 1 })
}
