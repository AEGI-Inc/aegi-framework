/**
 * 수집 자격증명 준비 상태 (#adapters 화면의 수집 자격증명 대장용, dev 서버 전용 — vite.config.ts 의 `/__aegi/collector-status`).
 *
 * 이 PC 의 `.env.collector` · `scripts/collect/collector.config.json` · `collected/runs/*.json` 을 읽어
 * 자격증명 ID 마다 ① 환경 변수가 채워졌는지(참·거짓) ② 어느 수집 호출이 쓰는지 ③ 마지막 실행 결과를 낸다.
 *
 * **값은 내보내지 않는다.** 환경 변수는 채워졌는지와 어디서 왔는지(value · file)만, 실행 기록은 호출 ID·완결성·사유만
 * (실행 기록은 원래 비밀값을 남기지 않는다 — lib/store.ts). `npm run collect -- --list` 와 같은 판단을 쓴다.
 */
import fs from 'fs'
import path from 'path'
import { CREDENTIAL_KEYS, Credentials, loadConfig, loadEnv, type CredentialId } from './config'
import type { Completeness, RunRecord } from './lib/store'
import { fetchTransport } from './lib/http'
import { selectCalls } from './run'

export interface KeyState {
  name: string
  /** 값이 있다 (직접 또는 _FILE 로 읽은 파일 내용) */
  set: boolean
  source: 'value' | 'file' | 'file_unreadable' | 'missing'
}

export interface CallState {
  id: string
  provider: string
  title: string
  /** 지금 실행할 수 없는 사유 (collect --list 와 같다) */
  unavailable: string | null
  last?: { runId: string; at: string; completeness: Completeness; reasons: string[] }
}

export interface CredentialReadiness {
  id: string
  keys: KeyState[]
  ready: boolean
  calls: CallState[]
  /** 마지막으로 이 자격증명을 쓴 실행 시각 (skipped 가 아닌 호출 기준) */
  lastUsedAt: string | null
}

export interface CollectorStatus {
  generatedAt: string
  envFile: boolean
  configFile: boolean
  /** 설정이 없거나 깨져 호출 목록을 못 만든 이유 */
  callsProblem: string | null
  runs: number
  lastRun: { runId: string; at: string } | null
  credentials: CredentialReadiness[]
}

function keyState(env: Record<string, string>, creds: Credentials, name: string): KeyState {
  if (env[name]) return { name, set: true, source: 'value' }
  if (env[`${name}_FILE`]) return creds.get(name) ? { name: `${name}_FILE`, set: true, source: 'file' } : { name: `${name}_FILE`, set: false, source: 'file_unreadable' }
  return { name, set: false, source: 'missing' }
}

function readRuns(dir: string): RunRecord[] {
  if (!fs.existsSync(dir)) return []
  const runs: RunRecord[] = []
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    try {
      runs.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as RunRecord)
    } catch {
      // 깨진 실행 기록은 건너뛴다
    }
  }
  return runs.sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''))
}

export function collectorStatus(root: string, now = new Date()): CollectorStatus {
  const envPath = path.join(root, '.env.collector')
  const configPath = path.join(root, 'scripts/collect/collector.config.json')
  const env = loadEnv(envPath)
  const creds = new Credentials(env, root)
  const runs = readRuns(path.join(root, 'collected', 'runs'))

  // 호출마다 마지막 실행 결과 (나중 실행이 덮는다)
  const lastByCall = new Map<string, CallState['last']>()
  for (const run of runs) {
    for (const c of run.calls ?? []) {
      lastByCall.set(c.call_id, { runId: run.run_id, at: c.finished_at ?? c.started_at ?? run.started_at, completeness: c.completeness, reasons: c.reasons ?? [] })
    }
  }

  const callsByCred = new Map<string, CallState[]>()
  let callsProblem: string | null = null
  if (!fs.existsSync(configPath)) callsProblem = 'scripts/collect/collector.config.json 이 없어 호출 목록을 만들지 못했습니다'
  else {
    try {
      const config = loadConfig(configPath)
      for (const call of selectCalls({ config, creds, transport: fetchTransport })) {
        let unavailable: string | null = null
        try {
          unavailable = call.unavailable?.() ?? null
        } catch (err) {
          unavailable = err instanceof Error ? err.message : String(err)
        }
        const list = callsByCred.get(call.credential) ?? []
        list.push({ id: call.id, provider: call.provider, title: call.title, unavailable, last: lastByCall.get(call.id) })
        callsByCred.set(call.credential, list)
      }
    } catch (err) {
      callsProblem = `호출 목록을 만들지 못했습니다 (${err instanceof Error ? err.message : String(err)})`
    }
  }

  const credentials = (Object.keys(CREDENTIAL_KEYS) as CredentialId[]).map(id => {
    const keys = CREDENTIAL_KEYS[id].map(name => keyState(env, creds, name))
    const calls = callsByCred.get(id) ?? []
    const used = calls.map(c => c.last).filter(l => l && l.completeness !== 'skipped').map(l => l!.at)
    return { id, keys, ready: keys.every(k => k.set), calls, lastUsedAt: used.sort().at(-1) ?? null }
  })

  const last = runs.at(-1)
  return {
    generatedAt: now.toISOString(),
    envFile: fs.existsSync(envPath),
    configFile: fs.existsSync(configPath),
    callsProblem,
    runs: runs.length,
    lastRun: last ? { runId: last.run_id, at: last.finished_at ?? last.started_at } : null,
    credentials,
  }
}
