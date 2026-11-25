/** 로컬 수집 기록·원본·정규화 coverage를 대조한다. 인증, SaaS 요청, D1 쓰기는 하지 않는다. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Credentials, loadConfig } from './config'
import { RawSet, type RawRun } from './shared/raw'
import { selectCalls } from './run'
import { sha256Hex } from './lib/sanitize'
import { fetchTransport } from './lib/http'
import type { CallDef } from './lib/runner'
import type { CallRecord, Completeness } from './lib/store'

type ExpectedCall = Pick<CallDef, 'id' | 'provider'>
interface CoverageCall { provider: string; call_id: string; completeness: string; run_id?: string; reasons: string[] }
export interface VerificationIssue {
  code: 'no_runs' | 'unfinished_run' | 'unfinished_call' | 'invalid_timestamp' | 'duplicate_record' | 'missing_call' | 'requested_call_missing' | 'non_full_call' | 'page_count' | 'page_sequence' | 'payload_hash' | 'coverage_record' | 'manifest_runs'
  provider?: string
  call_id?: string
  run_id?: string
}
export interface CollectionVerification {
  format: 'aegi-collection-verification/v1'
  scope: 'configured_calls_only'
  scenario_coverage: 'not_verified'
  configured_calls_complete: boolean
  counts: Record<Completeness | 'missing', number>
  calls: Array<{ provider: string; call_id: string; completeness: string; run_id: string | null }>
  issues: VerificationIssue[]
}
const keyOf = (provider: string, id: string) => `${provider}|${id}`
const sameSet = (a: string[], b: string[]) => {
  const sortedB = [...b].sort()
  return a.length === b.length && new Set(a).size === a.length && [...a].sort().every((v, i) => v === sortedB[i])
}

/** 과거 성공으로 대체하지 않고 최신 실행을 검사한다. 응답 본문과 오류에 든 개인정보는 출력하지 않는다. */
export function verifyCollection(input: {
  runs: RawRun[]
  expected: ExpectedCall[]
  coverage: { calls: CoverageCall[] }
  manifest: { source_runs?: string[] }
}): CollectionVerification {
  const issues: VerificationIssue[] = []
  // run_id는 초 단위 시각+무작위 suffix다. 같은 초 안의 실제 순서는 started_at으로 판단한다.
  const runs = [...input.runs].sort((a, b) => (Date.parse(a.record.started_at) - Date.parse(b.record.started_at)) || a.record.run_id.localeCompare(b.record.run_id))
  const latest = new Map<string, CallRecord>()
  const expected = new Map(input.expected.map(c => [keyOf(c.provider, c.id), c]))
  if (!runs.length) issues.push({ code: 'no_runs' })
  if (!sameSet(input.manifest.source_runs ?? [], runs.map(r => r.record.run_id))) issues.push({ code: 'manifest_runs' })
  for (const run of runs) {
    if (!run.record.finished_at) issues.push({ code: 'unfinished_run', run_id: run.record.run_id })
    if (!Number.isFinite(Date.parse(run.record.started_at)) || (run.record.finished_at && !Number.isFinite(Date.parse(run.record.finished_at)))) issues.push({ code: 'invalid_timestamp', run_id: run.record.run_id })
    const seen = new Set<string>()
    for (const call of run.record.calls) {
      const key = keyOf(call.provider, call.call_id)
      if (!expected.has(key)) continue
      const identity = { provider: call.provider, call_id: call.call_id, run_id: run.record.run_id }
      if (!call.finished_at) issues.push({ code: 'unfinished_call', ...identity })
      if (!Number.isFinite(Date.parse(call.started_at)) || (call.finished_at && !Number.isFinite(Date.parse(call.finished_at)))) issues.push({ code: 'invalid_timestamp', ...identity })
      if (seen.has(key) || call.run_id !== run.record.run_id) issues.push({ code: 'duplicate_record', ...identity })
      seen.add(key)
      latest.set(key, call)
      const pages = run.pages.filter(p => p.provider === call.provider && p.call_id === call.call_id)
      if (pages.length !== call.pages) issues.push({ code: 'page_count', ...identity })
      const numbers = pages.map(p => p.page).sort((a, b) => a - b)
      if (numbers.some((n, i) => n !== i + 1)) issues.push({ code: 'page_sequence', ...identity })
      if (pages.some(p => p.payload_sha256 !== sha256Hex(JSON.stringify(p.payload)))) issues.push({ code: 'payload_hash', ...identity })
    }
    // 호출 기록이 통째로 유실되어도 과거 성공만으로 통과시키지 않는다. 다른 SaaS만 재수집한 경우는 제외한다.
    const only = run.record.args.only
    const selected = run.record.args.calls
    for (const [key, call] of expected) {
      if (Array.isArray(only) && only.length && !only.includes(call.provider)) continue
      if (Array.isArray(selected) && selected.length && !selected.some(id => typeof id === 'string' && id.toUpperCase() === call.id.toUpperCase())) continue
      if (!seen.has(key)) issues.push({ code: 'requested_call_missing', provider: call.provider, call_id: call.id, run_id: run.record.run_id })
    }
  }
  const counts: CollectionVerification['counts'] = { full: 0, partial: 0, best_effort: 0, failed: 0, skipped: 0, missing: 0 }
  const calls: CollectionVerification['calls'] = []
  for (const [key, expectedCall] of expected) {
    const call = latest.get(key)
    const identity = { provider: expectedCall.provider, call_id: expectedCall.id }
    calls.push({ ...identity, completeness: call?.completeness ?? 'missing', run_id: call?.run_id ?? null })
    if (!call) {
      counts.missing++
      issues.push({ code: 'missing_call', ...identity })
      continue
    }
    counts[call.completeness]++
    if (call.completeness !== 'full') issues.push({ code: 'non_full_call', ...identity, run_id: call.run_id })
    const coverage = input.coverage.calls.filter(c => keyOf(c.provider, c.call_id) === key)
    if (coverage.length !== 1 || coverage[0].run_id !== call.run_id || coverage[0].completeness !== call.completeness || JSON.stringify(coverage[0].reasons) !== JSON.stringify(call.reasons)) {
      issues.push({ code: 'coverage_record', ...identity, run_id: call.run_id })
    }
  }
  return { format: 'aegi-collection-verification/v1', scope: 'configured_calls_only', scenario_coverage: 'not_verified', configured_calls_complete: expected.size > 0 && issues.length === 0, counts, calls, issues }
}

export function verifyCollectionFiles(options: { raw: string; dataset: string; config: string; only?: string[]; calls?: string[] }): CollectionVerification {
  const config = loadConfig(options.config)
  // 호출 정의만 사용한다. 자격증명은 읽지 않고 transport를 호출하지 않는다.
  const expected = selectCalls({ config, creds: new Credentials({}, path.dirname(options.config)), transport: fetchTransport }, options.only, options.calls)
  const raw = RawSet.load(options.raw)
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(options.dataset, `${name}.json`), 'utf8'))
  return verifyCollection({ runs: raw.runs, expected, coverage: read('coverage'), manifest: read('manifest') })
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export function main(argv = process.argv.slice(2)): number {
  if (argv.includes('--help')) {
    console.log('collect:verify --raw <수집 폴더> --dataset <정규화 폴더> --config <수집 설정> [--only github,slack] [--calls GH-15,SL-10] [--out <JSON 파일>]')
    console.log('설정된 호출의 최신 상태와 원본 무결성만 검증한다. CM 시나리오·수집기 밖 데이터의 완전성은 별도로 확인해야 한다.')
    return 0
  }
  try {
    const args = new Map<string, string>()
    for (let i = 0; i < argv.length; i += 2) {
      if (!['--raw', '--dataset', '--config', '--only', '--calls', '--out'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--') || args.has(argv[i])) throw new Error('arguments')
      args.set(argv[i], argv[i + 1])
    }
    for (const name of ['--raw', '--dataset', '--config']) if (!args.has(name)) throw new Error('arguments')
    const resolve = (name: string) => path.resolve(ROOT, args.get(name)!)
    const list = (name: string) => args.get(name)?.split(',').map(v => v.trim()).filter(Boolean)
    const report = verifyCollectionFiles({ raw: resolve('--raw'), dataset: resolve('--dataset'), config: resolve('--config'), only: list('--only'), calls: list('--calls') })
    const json = JSON.stringify(report, null, 2) + '\n'
    if (args.has('--out')) fs.writeFileSync(resolve('--out'), json)
    console.log(json.trimEnd())
    return report.configured_calls_complete ? 0 : 1
  } catch {
    console.error('수집 검증 입력을 읽지 못했다. --help로 필수 인자와 로컬 JSON 파일을 확인한다.')
    return 2
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main()
