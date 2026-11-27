/**
 * 수집기를 로컬 암호화 저장소(setup-output/secrets-enc)의 자격증명으로 돌린다. 평문 .env.collector 를 만들지 않는다.
 * 수집 순서와 결과 위치는 scripts/collect/run.ts 와 같다. 값은 메모리에서만 푼다.
 *
 *   npm run collect:local -- --only okta,gws          (run.ts 와 같은 --only, --calls, --full, --list, --config, --out)
 *   npm run collect:local -- --kv                     로컬 저장소 대신 Cloudflare KV 금고에서 읽는다(역시 메모리에서만 푼다)
 *
 * 마스터 키는 AEGI_VAULT_KEY 또는 .env.vault (local.ts). 저장소에 없는 키는 비워 두어 그 호출이 credential_missing 으로 skipped 된다.
 */
import path from 'path'
import { fileURLToPath } from 'url'
import { CREDENTIAL_KEYS, Credentials, credentialLoadNames, loadConfig, type CredentialId } from '../collect/config'
import { fetchTransport, HttpLayer } from '../collect/lib/http'
import { CollectStore } from '../collect/lib/store'
import { Runner } from '../collect/lib/runner'
import { newRunId, selectCalls } from '../collect/run'
import type { ProviderContext } from '../collect/providers/common'
import { loadLocal, masterKey, saveLocal } from './local.ts'
import { decrypt, encrypt } from './crypto.ts'
import { getVaultMeta, getVaultSecret, putVaultSecret } from './kv.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const argValue = (args: string[], name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const only = argValue(args, '--only')?.split(',').map(s => s.trim()).filter(Boolean)
  const callIds = argValue(args, '--calls')?.split(',').map(s => s.trim()).filter(Boolean)
  const config = loadConfig(path.resolve(ROOT, argValue(args, '--config') ?? 'scripts/collect/collector.config.json'))
  const outDir = path.resolve(ROOT, argValue(args, '--out') ?? 'collected')

  const key = masterKey()
  const env: Record<string, string> = {}
  // 필수 키 말고, 있으면 쓰는 키(Slack 설정 토큰 갱신용)도 읽는다
  const names = [...new Set([...credentialLoadNames(Object.keys(CREDENTIAL_KEYS) as CredentialId[]), 'SLACK_CONFIG_REFRESH_TOKEN'])]
  const fromKv = args.includes('--kv')
  for (const name of names) {
    const payload = fromKv ? await getVaultSecret(name) : loadLocal(name)
    if (payload) env[name] = decrypt(payload, key)
  }
  console.log(`${fromKv ? 'KV 금고' : '로컬 저장소'}에서 ${Object.keys(env).length}/${names.length}개 자격증명을 메모리로 읽었다`)

  const persist = async (updates: Record<string, string>, meta?: { expiresAt?: string }) => {
    try {
      for (const [name, val] of Object.entries(updates)) {
        const payload = encrypt(val, key)
        if (fromKv) {
          const currentMeta = await getVaultMeta(name)
          const expires_at = name === 'SLACK_CONFIG_TOKEN' ? (meta?.expiresAt ?? null) : null
          await putVaultSecret(name, payload, { ...(currentMeta ?? {}), expires_at })
        } else {
          saveLocal(name, payload)
        }
      }
      console.log(`[자격증명 저장] ${fromKv ? 'KV 금고' : '로컬 암호화 저장소'}에 ${Object.keys(updates).join(', ')} 저장 완료`)
    } catch (err: any) {
      console.error(`[자격증명 저장] ${fromKv ? 'KV 금고' : '로컬 암호화 저장소'} 저장 실패: ${err.message}`)
      throw err
    }
  }

  const ctx: ProviderContext = { config, creds: new Credentials(env, ROOT, undefined, undefined, persist), transport: fetchTransport }
  const apiList = !args.includes('--no-api-list')
  const calls = selectCalls(ctx, only, callIds, { apiList })
  if (args.includes('--list')) {
    for (const c of calls) {
      const reason = c.unavailable?.()
      console.log(`${reason ? '–' : '•'} [${c.provider}] ${c.id} — ${c.title}${reason ? `  (${reason})` : ''}`)
    }
    return
  }

  const now = new Date()
  const runId = newRunId(now)
  const runner = new Runner({
    store: new CollectStore(outDir, runId),
    http: new HttpLayer({ transport: fetchTransport, retryDelayMs: 1000 }),
    period: { since: config.since, until: now.toISOString() },
    ignoreCursors: args.includes('--full'),
    log: line => console.log(line),
  })
  console.log(`수집 시작 run_id=${runId}, 기간 ${config.since} ~ ${now.toISOString()}${args.includes('--full') ? ' (커서 무시)' : ''}\n`)
  const run = await runner.runAll(calls, { only: only ?? null, calls: callIds ?? null, full: args.includes('--full'), registry: apiList })
  const count = (c: string) => run.calls.filter(r => r.completeness === c).length
  console.log(`\n완료: full ${count('full')} · partial ${count('partial')} · failed ${count('failed')} · skipped ${count('skipped')} · 원본 ${run.calls.reduce((n, r) => n + r.pages, 0)}쪽 · 라벨 ${runner.labels.length}건`)
  console.log(`실행 기록: ${path.relative(ROOT, path.join(outDir, 'runs', `${runId}.json`))}`)
  if (count('failed')) process.exitCode = 1
}

main().catch(err => {
  console.error(`[오류] ${(err as Error).message}`)
  process.exit(1)
})
