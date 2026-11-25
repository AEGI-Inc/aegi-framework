/**
 * 수집 자격증명 준비 상태. 엔진 credentialStatus.ts 와 같은 판단(collect --list)을 데모 경로(.env 하나, data/collected)로 한다.
 * 값은 내보내지 않는다. 채워졌는지와 마지막 실행 결과만.
 * 대시보드 수집 자격증명 화면(/__aegi/collector-status)과 `aegi doctor` 가 쓴다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { CREDENTIAL_KEYS, credentialKeyNames, Credentials, type CredentialId } from '../vendor/engine/scripts/collect/config.ts'
import type { CollectorStatus, CallState, KeyState } from '../vendor/engine/scripts/collect/credentialStatus.ts'
import { fetchTransport } from '../vendor/engine/scripts/collect/lib/http.ts'
import type { RunRecord } from '../vendor/engine/scripts/collect/lib/store.ts'
import { selectCalls } from '../vendor/engine/scripts/collect/run.ts'
import { collectorConfig } from './collectorConfig.ts'
import { COLLECTED_DIR, ENV_FILE } from './paths.ts'

function keyState(env: Record<string, string>, creds: Credentials, name: string): KeyState {
  if (env[name]) return { name, set: true, source: 'value' }
  if (env[`${name}_FILE`]) return creds.get(name) ? { name: `${name}_FILE`, set: true, source: 'file' } : { name: `${name}_FILE`, set: false, source: 'file_unreadable' }
  return { name, set: false, source: 'missing' }
}

export function readRuns(dir = path.join(COLLECTED_DIR, 'runs')): RunRecord[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).flatMap(f => {
    try { return [JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as RunRecord] } catch { return [] }
  }).sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''))
}

export function collectorStatus(env: Record<string, string>, now = new Date()): CollectorStatus {
  const creds = new Credentials(env, path.dirname(ENV_FILE))
  const runs = readRuns()
  const lastByCall = new Map<string, CallState['last']>()
  for (const run of runs) for (const c of run.calls ?? []) {
    lastByCall.set(c.call_id, { runId: run.run_id, at: c.finished_at ?? c.started_at ?? run.started_at, completeness: c.completeness, reasons: c.reasons ?? [] })
  }
  const callsByCred = new Map<string, CallState[]>()
  let callsProblem: string | null = null
  try {
    for (const call of selectCalls({ config: collectorConfig(env, now), creds, transport: fetchTransport })) {
      let unavailable: string | null = null
      try { unavailable = call.unavailable?.() ?? null } catch (err) { unavailable = err instanceof Error ? err.message : String(err) }
      const list = callsByCred.get(call.credential) ?? []
      list.push({ id: call.id, provider: call.provider, title: call.title, unavailable, last: lastByCall.get(call.id) })
      callsByCred.set(call.credential, list)
    }
  } catch (err) {
    callsProblem = `호출 목록을 만들지 못했습니다 (${err instanceof Error ? err.message : String(err)})`
  }
  const credentials = (Object.keys(CREDENTIAL_KEYS) as CredentialId[])
    // 시험 환경 전용 자격증명(시나리오 봇 Worker, Cloudflare)은 설치판에서 보이지 않는다
    .filter(id => !['CRED-WK-01', 'CRED-CF-01'].includes(id))
    .map(id => {
      const keys = credentialKeyNames(creds, id).map(name => keyState(env, creds, name))
      const calls = callsByCred.get(id) ?? []
      const used = calls.map(c => c.last).filter(l => l && l.completeness !== 'skipped').map(l => l!.at)
      return { id, keys, ready: keys.every(k => k.set), calls, lastUsedAt: used.sort().at(-1) ?? null }
    })
  const last = runs.at(-1)
  return { generatedAt: now.toISOString(), envFile: fs.existsSync(ENV_FILE), configFile: true, callsProblem, runs: runs.length,
    lastRun: last ? { runId: last.run_id, at: last.finished_at ?? last.started_at } : null, credentials }
}
