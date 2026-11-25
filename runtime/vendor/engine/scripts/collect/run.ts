/**
 * 실측 원본 수집 (계획서 5·7절, T-21). 읽기 전용.
 *
 *   npm run collect                              설정된 SaaS 전부, 로그 스트림은 커서부터
 *   npm run collect -- --only github,worker      일부 SaaS 만
 *   npm run collect -- --calls GH-13,GH-17       일부 호출만 (선행 호출이 필요하면 skipped 로 남는다)
 *   npm run collect -- --full                    커서 무시, since 부터 다시 (최종 수집 T-41)
 *   npm run collect -- --list                    호출 목록과 자격증명 준비 상태만 보여 준다 (네트워크 없음)
 *   npm run collect -- --no-api-list             수집 API 목록 호출(RG-…) 없이 손코드 호출만
 *
 * 결과: collected/raw/<run_id>/..., collected/runs/<run_id>.json, collected/cursors.json, collected/labels/correlation.json
 * 자격증명: .env.collector, 설정: scripts/collect/collector.config.json (둘 다 git 제외).
 * 정규화(→ src/data/aegi_inc_measured_v1)는 이 원본만 읽는 별도 단계다 (T-22).
 */
import path from 'path'
import { fileURLToPath } from 'url'
import { Credentials, loadConfig, loadEnv } from './config'
import { fetchTransport, HttpLayer } from './lib/http'
import { CollectStore } from './lib/store'
import { Runner, type CallDef } from './lib/runner'
import type { ProviderContext } from './providers/common'
import { apiListCalls } from './providers/apiList'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export { PROVIDERS, newRunId } from './calls'
import { newRunId, selectCalls as selectProviderCalls } from './calls'

export function selectCalls(ctx: ProviderContext, only?: string[], callIds?: string[], opts: { apiList?: boolean } = {}): CallDef[] {
  const wantsApiList = opts.apiList || (callIds ?? []).some(c => /^RG-/i.test(c))
  return selectProviderCalls(ctx, only, callIds, wantsApiList ? apiListCalls : undefined)
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const only = argValue(args, '--only')?.split(',').map(s => s.trim()).filter(Boolean)
  const callIds = argValue(args, '--calls')?.split(',').map(s => s.trim()).filter(Boolean)
  const configFile = path.resolve(ROOT, argValue(args, '--config') ?? 'scripts/collect/collector.config.json')
  const envFile = path.resolve(ROOT, argValue(args, '--env') ?? '.env.collector')
  const outDir = path.resolve(ROOT, argValue(args, '--out') ?? 'collected')

  const config = loadConfig(configFile)
  // `_FILE` 경로는 .env 파일이 있는 폴더 기준이다 (다른 체크아웃의 .env.collector 를 가리켜도 열쇠 파일을 찾는다)
  // 갱신한 토큰(Slack 설정 토큰 등)은 이 env 파일에 원자 갱신으로 다시 쓴다
  const creds = new Credentials(loadEnv(envFile), path.dirname(envFile), undefined, envFile)
  const ctx: ProviderContext = { config, creds, transport: fetchTransport }
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
  const store = new CollectStore(outDir, runId)
  const runner = new Runner({
    store,
    http: new HttpLayer({ transport: fetchTransport, retryDelayMs: 1000 }),
    period: { since: config.since, until: now.toISOString() },
    ignoreCursors: args.includes('--full'),
    log: line => console.log(line),
  })
  console.log(`수집 시작 run_id=${runId}, 기간 ${config.since} ~ ${now.toISOString()}${args.includes('--full') ? ' (커서 무시)' : ''}\n`)
  const run = await runner.runAll(calls, { only: only ?? null, calls: callIds ?? null, full: args.includes('--full'), registry: apiList })

  const count = (c: string) => run.calls.filter(r => r.completeness === c).length
  const pages = run.calls.reduce((n, r) => n + r.pages, 0)
  console.log(`\n완료: full ${count('full')} · partial ${count('partial')} · failed ${count('failed')} · skipped ${count('skipped')} · 원본 ${pages}쪽 · 라벨 ${runner.labels.length}건`)
  console.log(`실행 기록: ${path.relative(ROOT, path.join(outDir, 'runs', `${runId}.json`))}`)
  if (count('failed')) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
