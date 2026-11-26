/**
 * 수집 → 정규화 → 판정·게시. 감사 로그는 기업 Splunk 에서 조회 때 읽는다(src/logs.ts). 수집은 엔진 CLI 를 자식 프로세스로, 정규화는 엔진 함수를 같은 프로세스에서 돌린다.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { collectorConfig, missingIdentifiers } from './collectorConfig.ts'
import type { LocalDb } from './db.ts'
import { clearLogCache } from './logs.ts'
import { COLLECTED_DIR, DATA_DIR, DATASETS_DIR, ENGINE_DIR, ENV_FILE, HOME, IM_MODEL_DIR, SAMPLE_DIR } from './paths.ts'
import { publishDataset, type PublishResult } from './publish.ts'
import { judgeStandards } from './standards.ts'
import { readRuns } from './status.ts'
import { listGitHubOrganizations, resolveGithubAppPem, resolveSlackTeamId } from './oauth.ts'
import { saveEnvValues } from './env.ts'
import type { RunRecord } from '../engine/scripts/collect/lib/store.ts'
// @ts-expect-error 엔진 정규화기는 JS(.mjs)라 타입이 없다
import { normalizeProfiles } from '../engine/scripts/collect/profile-binding/runner/normalize.mjs'
// @ts-expect-error 위와 같다
import { parseOptions } from '../engine/scripts/collect/profile-binding/runner/options.mjs'

type Log = (line: string) => void

/** 수집은 엔진 CLI 를 자식 프로세스로 돌린다. 배포 zip 에는 미리 묶은 dist/collect.mjs 가 있고, 저장소에서는 engine 원본을 tsx 로 돌린다 */
async function runCollector(args: string[], log: Log, extraEnv: Record<string, string> = {}): Promise<void> {
  const bundled = path.join(HOME, 'dist', 'collect.mjs')
  const source = path.join(ENGINE_DIR, 'scripts', 'collect', 'run.ts')
  const argv = fs.existsSync(bundled) ? [bundled, ...args] : ['--import', 'tsx', source, ...args]
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, argv, { stdio: ['ignore', 'pipe', 'pipe'], cwd: HOME, env: { ...process.env, ...extraEnv, AEGI_HOME: HOME } })
    const rlOut = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
    rlOut.on('line', line => log(line))
    const rlErr = readline.createInterface({ input: child.stderr, crlfDelay: Infinity })
    rlErr.on('line', line => log(line))

    child.on('error', err => { rlOut.close(); rlErr.close(); reject(err) })
    child.on('close', code => {
      // 종료 코드 1 은 일부 호출 실패다. 받은 것만으로 계속하고, 받은 것이 없으면 아래에서 멈춘다
      if (code !== 0 && code !== 1) reject(new Error(`수집이 실패했다 (종료 코드 ${code})`))
      else resolve()
    })
  })
}

export async function collectAndPublish(local: LocalDb, env: Record<string, string>, log: Log, opts: { only?: string } = {}): Promise<PublishResult> {
  const onlySet = opts.only ? new Set(opts.only.split(',').map(s => s.trim()).filter(Boolean)) : null
  // GitHub 토큰은 있는데 조직이 비어 있으면 소속 조직 자동 감지 및 채움
  if ((!onlySet || onlySet.has('github')) && (env.GITHUB_OWNER_TOKEN || env.GITHUB_COLLECTOR_OAUTH_TOKEN)) {
    if (!env.GITHUB_ORG && !env.GITHUB_ORGS) {
      try {
        const res = await listGitHubOrganizations(env)
        if (res.ok && res.orgs.length > 0) {
          const orgLogins = res.orgs.map(o => o.login).join(',')
          saveEnvValues({ GITHUB_ORG: orgLogins, GITHUB_ORGS: orgLogins }, env)
          log(`GitHub 소속 조직 자동 감지 및 설정: ${orgLogins}`)
        }
      } catch {
        // pass
      }
    }
    // 엔터프라이즈 환경 자동 감지 (SAML SSO URL 또는 조직 엔터프라이즈 헤더에서 slug 추출)
    if (!env.GITHUB_ENTERPRISE) {
      try {
        const targetOrg = (env.GITHUB_ORGS || env.GITHUB_ORG || '').split(',')[0]?.trim()
        if (targetOrg) {
          const token = env.GITHUB_OWNER_TOKEN || env.GITHUB_COLLECTOR_OAUTH_TOKEN
          const res = await fetch(`https://api.github.com/orgs/${encodeURIComponent(targetOrg)}`, {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'aegi-collector', Accept: 'application/vnd.github+json' },
          })
          const ssoUrl = res.headers.get('x-github-sso') || ''
          const entMatch = ssoUrl.match(/\/enterprises\/([^/?;\s]+)/)
          if (entMatch?.[1]) {
            saveEnvValues({ GITHUB_ENTERPRISE: entMatch[1] }, env)
            log(`GitHub 엔터프라이즈 자동 감지 및 설정: ${entMatch[1]}`)
          }
        }
      } catch {
        // pass
      }
    }
  }

  const wantsSlack = !onlySet || onlySet.has('slack')
  if (wantsSlack && !env.SLACK_TEAM_ID && (env.SLACK_COLLECTOR_USER_TOKEN || env.SLACK_COLLECTOR_BOT_TOKEN)) {
    const resolved = await resolveSlackTeamId(env, ENV_FILE)
    if (resolved.ok && resolved.teamId) {
      log(`Slack 워크스페이스 ID 자동 감지 및 저장 (${resolved.source}): ${resolved.teamId}`)
    } else if (resolved.reason) {
      log(`경고: ${resolved.reason}`)
    }
  }

  const missing = missingIdentifiers(env, opts.only)
  if (missing.length) throw new Error(`.env 에 식별값이 없다: ${missing.join(', ')}`)
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const configFile = path.join(DATA_DIR, 'collector.config.json')
  fs.writeFileSync(configFile, JSON.stringify(collectorConfig(env), null, 2))

  log('1/4 수집 (읽기 전용 API 호출)')
  const before = new Set(readRuns().map(r => r.run_id))
  const extraEnv: Record<string, string> = {}
  if (!env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_APP_ID && (env.GITHUB_APP_INSTALLATION_ID || env.GITHUB_APP_ENTERPRISE_INSTALLATION_ID)) {
    const localGhPem = resolveGithubAppPem(env)
    if (localGhPem) extraEnv.GITHUB_APP_PRIVATE_KEY = localGhPem
  }
  await runCollector(['--config', configFile, '--env', ENV_FILE, '--out', COLLECTED_DIR, '--full', ...(opts.only ? ['--only', opts.only] : [])], log, extraEnv)
  const run = readRuns().filter(r => !before.has(r.run_id)).at(-1)
  if (!run) throw new Error('수집 실행 기록이 없다')
  const done = run.calls.filter(c => c.completeness !== 'skipped' && c.completeness !== 'failed').length
  if (!done) throw new Error('받은 호출이 없다. `aegi doctor` 로 자격증명과 식별값을 확인한다')

  // SaaS 하나만 수집했으면 다른 SaaS 의 최근 원본을 붙여 게시한다. 붙이지 않으면 current 가 이번 SaaS 만으로 바뀐다
  const merged = opts.only ? mergeLatestRuns(COLLECTED_DIR, run, path.join(DATA_DIR, 'merged')) : null
  if (merged) {
    log(`다른 SaaS 최근 수집을 함께 게시: ${merged.added.map(a => `${a.provider}(${a.runId})`).join(', ')}`)
    return normalizeAndPublish(local, merged.root, merged.runId, log, 2)
  }
  return normalizeAndPublish(local, COLLECTED_DIR, run.run_id, log, 2)
}

/**
 * 이번 실행에 없는 SaaS 마다 가장 최근에 받은 것이 있는 실행을 골라, 이번 실행과 한 실행으로 합친다.
 * 정규화기는 실행 하나만 읽으므로 합친 실행을 mergedDir 에 새로 만든다(runs/<id>.json, raw/<id>/<provider>/).
 * collectedDir 는 읽기만 한다. 호출 기록의 run_id 는 원래 실행 그대로 둔다. 붙일 것이 없으면 null.
 */
export function mergeLatestRuns(collectedDir: string, run: RunRecord, mergedDir: string): { root: string; runId: string; added: Array<{ provider: string; runId: string }> } | null {
  const got = (r: RunRecord, p: string) => r.calls.some(c => c.provider === p && (c.completeness === 'full' || c.completeness === 'partial'))
  const covered = new Set(run.calls.map(c => c.provider))
  const picked: Array<{ provider: string; run: RunRecord }> = []
  for (const older of readRuns(path.join(collectedDir, 'runs')).reverse()) {
    if (older.run_id === run.run_id) continue
    for (const provider of new Set(older.calls.map(c => c.provider))) {
      if (covered.has(provider) || !got(older, provider)) continue
      if (!fs.existsSync(path.join(collectedDir, 'raw', older.run_id, provider))) continue
      covered.add(provider)
      picked.push({ provider, run: older })
    }
  }
  if (!picked.length) return null

  const runId = `${run.run_id}-merged`
  fs.rmSync(mergedDir, { recursive: true, force: true })
  const rawOut = path.join(mergedDir, 'raw', runId)
  fs.mkdirSync(rawOut, { recursive: true })
  fs.mkdirSync(path.join(mergedDir, 'runs'), { recursive: true })
  const sources = [{ provider: null as string | null, run }, ...picked]
  for (const s of sources) {
    for (const provider of s.provider ? [s.provider] : [...new Set(run.calls.map(c => c.provider))]) {
      const from = path.join(collectedDir, 'raw', s.run.run_id, provider)
      if (fs.existsSync(from)) fs.cpSync(from, path.join(rawOut, provider), { recursive: true })
    }
  }
  const calls = [...run.calls, ...picked.flatMap(p => p.run.calls.filter(c => c.provider === p.provider))]
  fs.writeFileSync(path.join(mergedDir, 'runs', `${runId}.json`), JSON.stringify({ ...run, run_id: runId, calls }, null, 2))
  return { root: mergedDir, runId, added: picked.map(p => ({ provider: p.provider, runId: p.run.run_id })) }
}

/**
 * 이미 있는 수집 폴더(runs/, raw/ 가 든 폴더)의 한 실행을 정규화해 올린다. 수집 폴더는 읽기만 한다.
 * 다른 PC 에서 수집해 온 원본으로 시연할 때 쓴다.
 */
export async function importCollection(local: LocalDb, rawDir: string, runId: string | undefined, log: Log): Promise<PublishResult> {
  const runs = readRuns(path.join(rawDir, 'runs'))
  const run = runId ? runs.find(r => r.run_id === runId) : runs.at(-1)
  if (!run) throw new Error(`${rawDir} 에 수집 실행${runId ? ` ${runId}` : ''} 이 없다 (runs/*.json)`)
  return normalizeAndPublish(local, rawDir, run.run_id, log, 1)
}

async function normalizeAndPublish(local: LocalDb, rawDir: string, runId: string, log: Log, step: number): Promise<PublishResult> {
  const total = step + 1
  log(`${step}/${total} 정규화 (run ${runId})`)
  const out = path.join(DATASETS_DIR, runId)
  fs.rmSync(out, { recursive: true, force: true })
  // 엔진 정규화(IM Profile)를 같은 프로세스에서 부른다. CLI(npm run normalize)와 같은 옵션 검사를 거친다
  const options = parseOptions(['--raw', rawDir, '--run', runId, '--out', out, '--model', IM_MODEL_DIR])
  const normalized = await normalizeProfiles(options)
  const c = normalized.report.counts
  log(`객체 ${c.objects}, 관계 ${c.relations}, 동일인 연결 ${c.links}, 증거 ${c.observations} (원본 기록 ${c.records})`)

  log(`${step + 1}/${total} 판정과 게시`)
  const result = await publishDataset(local.exec, out, { name: `collected/${runId}`, log, computeEa: true })

  // 기준별 판정은 수집 원본을 읽는다. 실패해도 그래프 게시는 그대로 둔다
  const standards = await judgeStandards(local, rawDir, runId, out, result.snapshotId, log)
  if (standards.state === 'skipped') log(`기준별 판정 건너뜀: ${standards.reason}`)

  // 객체 키가 바뀌었으므로 이전 그래프로 연결한 로그 조회 결과를 버린다
  await clearLogCache(local)
  return result
}

/** 내장 샘플: 합성 데이터셋. 감사 로그는 싣지 않는다(Splunk 를 연결하면 그 로그를 본다) */
export async function publishSample(local: LocalDb, log: Log): Promise<PublishResult> {
  const dir = path.join(DATASETS_DIR, 'sample')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(DATASETS_DIR, { recursive: true })
  fs.cpSync(path.join(SAMPLE_DIR, 'dataset'), dir, { recursive: true })
  const result = await publishDataset(local.exec, dir, { name: 'sample', log })
  await clearLogCache(local)
  return result
}

/** 빈 데이터셋: SaaS 연결 전 초기 상태 */
export async function publishEmpty(local: LocalDb, log: Log): Promise<PublishResult> {
  const dir = path.join(DATASETS_DIR, 'empty')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(DATASETS_DIR, { recursive: true })
  fs.cpSync(path.join(SAMPLE_DIR, 'empty-dataset'), dir, { recursive: true })
  const result = await publishDataset(local.exec, dir, { name: 'empty', log })
  await clearLogCache(local)
  return result
}

