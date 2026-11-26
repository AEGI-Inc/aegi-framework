/**
 * 여러 수집 실행을 정규화기가 읽는 실행 하나로 합친다. 네트워크 없음, 원본 페이지는 바꾸지 않고 복사한다.
 *
 *   npm run collect:merge -- --runs <run1,run2,...> [--out-run <새 run ID>] [--out collected]
 *
 * 왜: 정규화기(npm run normalize)는 실행 하나만 읽는다. 수집 API 목록 호출만 다시 돌린 실행, 일부 SaaS 만 다시 돈 실행을
 * 이전 실행과 함께 쓰려면 한 실행으로 묶어야 한다.
 *
 * 규칙
 * - 호출(provider, call_id)마다 실행 하나만 고른다. 서로 다른 실행의 같은 호출 페이지를 섞지 않는다.
 * - 고르는 기준은 shared/raw.ts RawSet 과 같다: full·partial 로 끝난 가장 최근 실행, 없으면 가장 최근 기록.
 *   로그 스트림 호출도 가장 최근 실행 하나만 쓴다(여러 실행을 이어 붙이지 않는다).
 * - 호출 기록(CallRecord)의 run_id 는 합친 실행 ID 로 바꾼다(collect:verify 가 실행과 호출 기록의 run_id 를 맞춰 본다).
 *   어느 실행에서 왔는지는 실행 기록의 args.merge.chosen 에 남기고, 원본 봉투는 원래 run_id 그대로다.
 * - 이미 있는 run ID 에는 쓰지 않는다.
 * - 앞 호출이 모은 값을 받아 쓰는 호출(CALL_FEEDS)을 그 앞 호출과 다른 실행에서 고르면 경고를 찍고 args.merge.warnings 에 남긴다.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { CallRecord, Completeness, Envelope, RunRecord } from './lib/store'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SAFE_RUN = /^[\w.-]+$/

export interface MergeResult {
  record: RunRecord
  /** provider/call_id → 고른 실행 */
  chosen: Record<string, string>
  pages: number
  /** 같은 실행에서 골라야 할 호출을 서로 다른 실행에서 고른 것 (CALL_FEEDS) */
  warnings: string[]
}

/**
 * 같은 실행 안에서 앞 호출이 모은 값을 받아 쓰는 호출 → 값을 주는 호출.
 * 둘을 서로 다른 실행에서 고르면, 받는 호출의 실행에 없던 값이 빠진다. 합치기는 그대로 하고 경고만 남긴다.
 * - gcp/GCP-02 는 GCP-01(프로젝트 IAM 명단)과 GCP-03(Gemini 에이전트 IAM)에 나온 역할의 정의만 받는다(providers/gcp.ts noteRoles).
 *   4회차 합친 실행은 GCP-03 을 13:34 실행에서, GCP-02 를 13:30 실행에서 골라 agentOwner 역할 정의가 빠졌다.
 */
export const CALL_FEEDS: Record<string, string[]> = {
  'gcp/GCP-02': ['gcp/GCP-01', 'gcp/GCP-03'],
}

const usable = (c: Completeness) => c === 'full' || c === 'partial'

export function mergeRuns(dir: string, runs: string[], outRun: string, now = new Date()): MergeResult {
  if (runs.length < 2) throw new Error('--runs 에 실행을 둘 이상 적는다')
  for (const r of [...runs, outRun]) if (!SAFE_RUN.test(r)) throw new Error(`run ID 형식이 아니다: ${r}`)
  if (new Set(runs).size !== runs.length) throw new Error('--runs 에 같은 실행이 두 번 있다')
  if (runs.includes(outRun)) throw new Error('합친 실행 ID 가 입력 실행과 같다')
  const outRecord = path.join(dir, 'runs', `${outRun}.json`)
  const outRaw = path.join(dir, 'raw', outRun)
  if (fs.existsSync(outRecord) || fs.existsSync(outRaw)) throw new Error(`이미 있는 실행이다: ${outRun}`)

  // run ID 는 시작 시각으로 시작해 사전 순서가 시간 순서다 (RawSet 과 같은 정렬)
  const records = runs.map(run => {
    const file = path.join(dir, 'runs', `${run}.json`)
    if (!fs.existsSync(file)) throw new Error(`실행 기록이 없다: ${file}`)
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as RunRecord
    if (record.run_id !== run || !record.finished_at) throw new Error(`끝나지 않았거나 ID 가 다른 실행: ${run}`)
    return record
  }).sort((a, b) => a.run_id.localeCompare(b.run_id))

  const chosen = new Map<string, { record: RunRecord; call: CallRecord }>()
  for (const record of records) {
    for (const call of record.calls) {
      const key = `${call.provider}/${call.call_id}`
      const prev = chosen.get(key)
      // 뒤 실행이 덮되, 쓸 만한 결과를 실패·건너뜀으로 덮지 않는다
      if (!prev || usable(call.completeness) || !usable(prev.call.completeness)) chosen.set(key, { record, call })
    }
  }

  let pages = 0
  const copy: Array<[string, string]> = []
  for (const [key, { record, call }] of chosen) {
    const srcDir = path.join(dir, 'raw', record.run_id, call.provider)
    if (!fs.existsSync(srcDir)) continue
    for (const f of fs.readdirSync(srcDir).filter(f => f.endsWith('.json')).sort()) {
      const env = JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8')) as Envelope
      if (`${env.provider}/${env.call_id}` !== key) continue
      copy.push([path.join(srcDir, f), path.join(outRaw, call.provider, f)])
    }
  }
  for (const [from, to] of copy) {
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL)
    pages++
  }

  const chosenRuns = Object.fromEntries([...chosen].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.record.run_id]))
  const warnings: string[] = []
  for (const [to, froms] of Object.entries(CALL_FEEDS)) {
    const toRun = chosenRuns[to]
    if (!toRun) continue
    for (const from of froms) {
      const fromRun = chosenRuns[from]
      if (fromRun && fromRun !== toRun) {
        warnings.push(`${to} 는 ${toRun} 에서, 그 값을 주는 ${from} 는 ${fromRun} 에서 골랐다. ${from} 에 새로 나온 값이 ${to} 에 빠질 수 있다. 두 호출을 한 실행에서 함께 받는다`)
      }
    }
  }
  const latest = records[records.length - 1]
  const record: RunRecord = {
    run_id: outRun,
    collector_version: latest.collector_version,
    started_at: records.map(r => r.started_at).sort()[0],
    finished_at: now.toISOString(),
    args: { merge: { runs: records.map(r => r.run_id), chosen: chosenRuns, ...(warnings.length ? { warnings } : {}) } },
    period: { since: records.map(r => r.period.since).sort()[0], until: records.map(r => r.period.until).sort().at(-1)! },
    calls: [...chosen.values()].map(v => ({ ...v.call, run_id: outRun })),
  }
  fs.mkdirSync(path.dirname(outRecord), { recursive: true })
  fs.writeFileSync(outRecord, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  return { record, chosen: chosenRuns, pages, warnings }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const value = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined)
  const runs = (value('--runs') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const dir = path.resolve(ROOT, value('--out') ?? 'collected')
  const outRun = value('--out-run') ?? `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-merged`
  try {
    const r = mergeRuns(dir, runs, outRun)
    const perRun = Object.values(r.chosen).reduce<Record<string, number>>((a, run) => { a[run] = (a[run] ?? 0) + 1; return a }, {})
    console.log(`합친 실행: ${outRun} (호출 ${r.record.calls.length}개, 페이지 ${r.pages}개)`)
    for (const [run, n] of Object.entries(perRun)) console.log(`  ${run}: 호출 ${n}개`)
    for (const w of r.warnings) console.warn(`경고: ${w}`)
    console.log(`정규화: npm run normalize -- --raw ${path.relative(ROOT, dir) || '.'} --run ${outRun} --out <폴더>`)
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
  }
}
