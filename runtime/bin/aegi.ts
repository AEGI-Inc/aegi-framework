/**
 * AEGI 로컬 설치판 명령.
 *
 *   aegi start [--port 5199] [--host 127.0.0.1] [--no-open]   대시보드를 연다. 게시된 데이터가 없으면 내장 샘플을 먼저 올린다
 *   aegi collect [--only github,okta] [--serve]                .env 의 SaaS 를 수집 → 정규화 → 판정 → 게시 (→ 대시보드)
 *   aegi import --raw <수집 폴더> [--run <id>] [--serve]          다른 PC 에서 수집한 원본을 정규화 → 판정 → 게시
 *   aegi doctor                                                 Node, Python, .env, AI 키, 수집 자격증명, 데이터, Splunk 연결을 점검
 *   aegi splunk                                                 Splunk 연결과 출처별 최근 7일 이벤트 수만 점검
 *   aegi sample                                                 내장 샘플을 다시 올리고 current 로
 *   aegi reset --yes                                            data/ 를 지운다(수집 원본, 데이터셋, SQLite)
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getHead, getSnapshot } from '../vendor/engine/scripts/loader/snapshot.ts'
import { missingIdentifiers } from '../src/collectorConfig.ts'
import { migrate, openDb, type LocalDb } from '../src/db.ts'
import { accessPassword, assistantEnv, loadEnv } from '../src/env.ts'
import { createLogServices } from '../src/logs.ts'
import { checkSplunk, tlsLabel } from '../src/splunk.ts'
import { DATA_DIR, DB_FILE, ENV_FILE, WEB_DIR } from '../src/paths.ts'
import { collectAndPublish, importCollection, publishEmpty, publishSample } from '../src/pipeline.ts'
import { buildPortWarning, startServer } from '../src/server.ts'
import { collectorStatus } from '../src/status.ts'
import { readVersions } from '../src/versions.ts'
import { findPython } from '../src/standards.ts'

const args = process.argv.slice(2)
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'start'
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const log = (line: string) => console.log(`  ${line}`)

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major! < 22 || (major === 22 && minor! < 13)) throw new Error(`Node ${process.versions.node} 이다. Node 22.13 이상(권장 24 LTS)이 필요하다`)
}

async function open(): Promise<LocalDb> {
  const local = openDb(DB_FILE)
  const ran = await migrate(local)
  if (ran.length) log(`DB 준비: ${DB_FILE} (마이그레이션 ${ran.length}개)`)
  return local
}

async function current(local: LocalDb) {
  const head = await getHead(local.exec)
  return head ? await getSnapshot(local.exec, head.snapshot_id) : null
}

async function serve(local: LocalDb, env: Record<string, string>) {
  if (!fs.existsSync(WEB_DIR)) throw new Error(`화면 빌드가 없다: ${WEB_DIR}`)
  const host = option('--host') ?? env.AEGI_HOST ?? '127.0.0.1'
  const port = Number(option('--port') ?? env.AEGI_PORT ?? 5199)
  if (host !== '127.0.0.1' && host !== 'localhost' && !accessPassword(env)) throw new Error('127.0.0.1 밖으로 열려면 .env 에 AEGI_PASSWORD 를 둔다')
  // Splunk 설정이 틀려도(출처 설정 파일 없음 등) 서버는 띄우고 로그 기능만 끈다. 화면의 Splunk 카드에서 고친다
  let logs: ReturnType<typeof createLogServices> = null
  try { logs = createLogServices(local, env) } catch (err) { console.log(`[주의] Splunk 를 켜지 못했다: ${err instanceof Error ? err.message : err}`) }
  await startServer({ host, port, env, local, logs })
  const snap = await current(local)
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/`
  console.log(`\nAEGI: ${url}`)
  const snapLabel = snap ? (snap.dataset_name === 'empty' ? '연결 전(빈 데이터)' : snap.dataset_name) : '없음'
  console.log(`  데이터: ${snapLabel} (${snap?.id ?? '-'})`)
  console.log(`  Splunk: ${logs ? `${logs.settings.searchBase}, 출처 ${logs.workspace.sources.length}개 (점검: aegi splunk)` : '꺼짐 (.env 에 SPLUNK_URL, SPLUNK_TOKEN 을 넣으면 Timeline 과 AI 로그 검색이 켜진다)'}`)
  console.log(`  AI: ${assistantEnv(env).AEGI_ASSISTANT_API_KEY ? `${assistantEnv(env).AEGI_ASSISTANT_PROVIDER ?? 'anthropic'} / ${assistantEnv(env).AEGI_ASSISTANT_MODEL}` : '꺼짐 (.env 에 ANTHROPIC_API_KEY 등을 넣는다)'}`)
  console.log(`  로그인: ${accessPassword(env) ? '비밀번호(AEGI_PASSWORD)' : '생략 (이 PC 에서만 열림)'}`)
  const portWarn = buildPortWarning(port)
  if (portWarn) console.log(`  [주의] ${portWarn}`)
  console.log('  끝내려면 Ctrl+C\n')
  if (!args.includes('--no-open') && env.AEGI_NO_BROWSER !== '1') {
    const [cmd, cmdArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
    execFile(cmd as string, cmdArgs as string[], () => undefined)
  }
}

async function doctor(local: LocalDb, env: Record<string, string>) {
  const ok = (b: boolean) => (b ? '✓' : '✗')
  const versions = readVersions()
  console.log(`AEGI 점검`)
  console.log(`  ${ok(true)} Node ${process.versions.node}`)
  const python = findPython()
  console.log(`  ${ok(!!python)} Python 3: ${python ?? '없음 (컴플라이언스 「관리자 인증 보호」 검사와 기준별 설정 판정을 건너뛴다)'}`)
  console.log(`  ${ok(!!versions)} 코드: ${versions ? Object.entries(versions.sources).map(([k, v]) => `${k} ${v.commit.slice(0, 7)}`).join(', ') : 'vendor/VERSIONS.json 없음'}`)
  for (const u of versions?.updates ?? []) console.log(`      + ${u.date} ${u.what}`)
  console.log(`  ${ok(fs.existsSync(ENV_FILE))} 설정 파일: ${ENV_FILE}${fs.existsSync(ENV_FILE) ? '' : ' (없음. .env.example 을 복사한다)'}`)
  const ai = assistantEnv(env)
  console.log(`  ${ok(!!ai.AEGI_ASSISTANT_API_KEY)} AI: ${ai.AEGI_ASSISTANT_API_KEY ? `${ai.AEGI_ASSISTANT_PROVIDER ?? 'anthropic'} / ${ai.AEGI_ASSISTANT_MODEL}` : '키 없음 (AI 질문 기능이 꺼진다)'}`)
  const status = collectorStatus(env)
  console.log(`\n수집 자격증명`)
  for (const c of status.credentials) {
    const filled = c.keys.filter(k => k.set).length
    if (!filled) { console.log(`  · ${c.id}: 없음`); continue }
    const callable = c.calls.filter(x => !x.unavailable).length
    console.log(`  ${ok(c.ready)} ${c.id}: ${c.ready ? `준비됨 (호출 ${callable}/${c.calls.length} 가능)` : `빠짐 ${c.keys.filter(k => !k.set).map(k => k.name).join(', ')}`}`)
  }
  for (const m of missingIdentifiers(env)) console.log(`  ✗ 식별값 없음: ${m}`)
  if (status.callsProblem) console.log(`  ✗ ${status.callsProblem}`)
  const snap = await current(local)
  console.log(`\n데이터`)
  const currentLabel = snap
    ? (snap.dataset_name === 'empty' ? `연결 전(빈 데이터) (${snap.id})` : `${snap.dataset_name} (${snap.id})`)
    : '없음 (aegi start 가 빈 데이터셋을 올린다)'
  console.log(`  ${ok(!!snap)} current: ${currentLabel}`)
  console.log(`  수집 실행 ${status.runs}회${status.lastRun ? `, 마지막 ${status.lastRun.runId}` : ''}`)
  await splunk(local, env)
}

/** Splunk 연결 점검: 설정, 인증, 인증서, 출처별 최근 7일 이벤트 수 */
async function splunk(local: LocalDb, env: Record<string, string>) {
  const ok = (b: boolean) => (b ? '✓' : '✗')
  console.log(`\nSplunk`)
  let logs: ReturnType<typeof createLogServices>
  // 점검은 켜져 있는 서버의 작업 폴더(data/jobs)를 건드리지 않게 따로 쓴다
  try { logs = createLogServices(local, env, { jobDir: path.join(DATA_DIR, 'jobs-check') }) } catch (err) { console.log(`  ✗ ${err instanceof Error ? err.message : err}`); return false }
  if (!logs) { console.log('  · 연결 안 함 (.env 에 SPLUNK_URL, SPLUNK_TOKEN 이 없다. Timeline 과 AI 로그 검색이 꺼진다)'); return true }
  console.log(`  주소: ${logs.settings.searchBase}, 인증서: ${tlsLabel(logs.settings)}`)
  console.log(`  출처 설정: ${logs.settings.sourcesFile} (${logs.workspace.sources.length}개)`)
  const r = await checkSplunk(logs.transport, logs.workspace)
  if (!r.ok) { console.log(`  ✗ ${r.error}`); return false }
  console.log(`  ${ok(true)} 검색 인증 성공`)
  for (const s of r.sources) {
    const note = s.tenantFiltered ? ' (index 전체 수, 조회 때 tenant 로 거른다)' : ''
    console.log(`  ${ok(s.events > 0)} ${s.ref}: index=${s.index} sourcetype=${s.sourcetype} → 최근 7일 ${s.events}건${s.latest ? `, 마지막 ${s.latest}` : ''}${note}`)
  }
  if (r.sources.every(s => !s.events)) console.log('  ✗ 모든 출처가 0건이다. splunk.sources.json 의 index, sourcetype 이 기업 Splunk 와 맞는지 확인한다')
  return true
}

async function main() {
  checkNode()
  const env = loadEnv()
  if (command === 'reset') {
    if (!args.includes('--yes')) throw new Error(`${DATA_DIR} 를 지운다. 정말 지우려면 aegi reset --yes`)
    fs.rmSync(DATA_DIR, { recursive: true, force: true })
    console.log(`지웠다: ${DATA_DIR}`)
    return
  }
  const local = await open()
  if (command === 'doctor') return doctor(local, env)
  if (command === 'splunk') { if (!(await splunk(local, env))) process.exitCode = 1; return }
  if (command === 'sample') { console.log('샘플 게시'); await publishSample(local, log); return }
  if (command === 'collect') {
    console.log('수집과 게시')
    const r = await collectAndPublish(local, env, log, { only: option('--only') })
    console.log(`완료: 위협 ${r.findings}, 권한 차집합 ${r.accessGaps}, 피해 범위 ${r.blast}`)
    if (args.includes('--serve')) await serve(local, env)
    return
  }
  if (command === 'import') {
    const raw = option('--raw')
    if (!raw) throw new Error('aegi import --raw <수집 폴더> [--run <run id>]')
    console.log('수집 원본 가져오기')
    const r = await importCollection(local, path.resolve(raw), option('--run'), log)
    console.log(`완료: 위협 ${r.findings}, 권한 차집합 ${r.accessGaps}, 피해 범위 ${r.blast}`)
    if (args.includes('--serve')) await serve(local, env)
    return
  }
  if (command === 'start') {
    if (!(await current(local))) {
      console.log('아직 데이터가 없다. 화면의 Adapters 에서 SaaS 를 연결하고 수집한다. 샘플을 보려면 aegi sample')
      await publishEmpty(local, log)
    }
    await serve(local, env)
    return
  }
  throw new Error(`모르는 명령 ${command}. start | collect | import | doctor | splunk | sample | reset`)
}

main().catch(err => {
  console.error(`\n[오류] ${err instanceof Error ? err.message : err}`)
  if (process.env.AEGI_DEBUG) console.error(err)
  process.exit(1)
})
