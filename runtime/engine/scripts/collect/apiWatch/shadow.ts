/**
 * 그림자 수집(collect:shadow): 설정 사본에 `--set` 값을 덮어써 한 provider 만 수집 → 정규화 → 직전 run 과 비교한다.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, type CollectorConfig } from '../config'
import { main as runDiffMain } from '../runDiff'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const DEFAULT_CONFIG = path.join(ROOT, 'scripts/collect/collector.config.json')
const DEFAULT_LATEST_DIR = path.join(ROOT, 'collected/api-watch/latest')
const NORMALIZE_MJS = path.join(ROOT, 'scripts/collect/profile-binding/runner/normalize.mjs')
const COLLECT_TS = path.join(ROOT, 'scripts/collect/run.ts')
const TSX_BIN = path.join(ROOT, 'node_modules/.bin/tsx')

export interface ShadowDeps {
  configFile?: string
  latestDir?: string
  collectFn?: (opts: { provider: string; configFile: string; outDir: string }) => string | Promise<string>
  normalizeFn?: (opts: { rawDir: string; runId: string; outDir: string }) => void | Promise<void>
  diffFn?: (argv: string[]) => number
}

function parseSetValue(raw: string, existing: unknown): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  if (typeof existing === 'number' && /^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw)
  }
  return raw
}

export function applyConfigSet(config: Record<string, unknown>, keyPath: string, rawValue: string): void {
  const parts = keyPath.split('.').filter(Boolean)
  if (parts.length === 0) throw new Error(`잘못된 --set 키: ${keyPath}`)
  let cur: Record<string, unknown> = config
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    const next = cur[k]
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cur[k] = {}
    }
    cur = cur[k] as Record<string, unknown>
  }
  const leaf = parts[parts.length - 1]
  cur[leaf] = parseSetValue(rawValue, cur[leaf])
}

export function findLatestProviderRunId(runsDir: string, provider: string): string | undefined {
  if (!fs.existsSync(runsDir)) return undefined
  const files = fs
    .readdirSync(runsDir)
    .filter(f => f.endsWith('.json') && !f.endsWith('-logs.json'))
    .sort()
    .reverse()
  for (const f of files) {
    const id = f.slice(0, -'.json'.length)
    try {
      const data = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8')) as {
        calls?: Array<{ provider?: string }>
      }
      if (Array.isArray(data.calls) && data.calls.some(c => c.provider === provider)) {
        return id
      }
    } catch {
      // 손상된 run 파일은 건너뛴다
    }
  }
  return undefined
}

function findLatestShadowRunId(shadowDir: string): string {
  const runsDir = path.join(shadowDir, 'runs')
  if (!fs.existsSync(runsDir)) throw new Error(`그림자 수집 run 폴더가 없다: ${runsDir}`)
  const files = fs
    .readdirSync(runsDir)
    .filter(f => f.endsWith('.json') && !f.endsWith('-logs.json'))
    .sort()
    .reverse()
  if (files.length === 0) throw new Error(`그림자 수집 run 기록이 없다: ${runsDir}`)
  return files[0].slice(0, -'.json'.length)
}

export async function main(argv = process.argv.slice(2), deps: ShadowDeps = {}): Promise<number> {
  if (argv.includes('--help') || argv.length === 0) {
    console.log(
      'collect:shadow --provider <name> --set <config.key>=<값> [--set ...] --label <이름> [--previous-run <run_id>] [--root <dir>]',
    )
    return 0
  }

  let provider = ''
  let label = ''
  let previousRun = ''
  let rootOpt = 'collected'
  const sets: Array<{ key: string; value: string }> = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--set') {
      const kv = argv[++i]
      if (!kv || !kv.includes('=')) {
        console.error('--set 은 <config.key>=<값> 형식이어야 한다.')
        return 1
      }
      const eq = kv.indexOf('=')
      sets.push({ key: kv.slice(0, eq), value: kv.slice(eq + 1) })
      continue
    }
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      console.error(`인자 값이 빠졌다: ${arg}`)
      return 1
    }
    if (arg === '--provider') provider = next
    else if (arg === '--label') label = next
    else if (arg === '--previous-run') previousRun = next
    else if (arg === '--root') rootOpt = next
    else {
      console.error(`알 수 없는 인자: ${arg}`)
      return 1
    }
    i++
  }

  if (!provider || !label) {
    console.error('--provider 와 --label 이 필요하다.')
    return 1
  }

  const rootDir = path.resolve(ROOT, rootOpt)
  const shadowDir = path.join(rootDir, 'shadow', label)
  const shadowConfigFile = path.join(shadowDir, 'collector.config.json')
  const configFile = deps.configFile ?? DEFAULT_CONFIG

  const baseConfig = loadConfig(configFile) as unknown as Record<string, unknown>
  const copyConfig = JSON.parse(JSON.stringify(baseConfig)) as Record<string, unknown>
  for (const s of sets) {
    applyConfigSet(copyConfig, s.key, s.value)
  }

  fs.mkdirSync(shadowDir, { recursive: true })
  fs.writeFileSync(shadowConfigFile, JSON.stringify(copyConfig, null, 2) + '\n')

  const collectFn =
    deps.collectFn ??
    ((opts: { provider: string; configFile: string; outDir: string }) => {
      execFileSync(
        TSX_BIN,
        [COLLECT_TS, '--only', opts.provider, '--config', opts.configFile, '--out', opts.outDir],
        { stdio: 'inherit' },
      )
      return findLatestShadowRunId(opts.outDir)
    })

  const shadowRunId = await collectFn({ provider, configFile: shadowConfigFile, outDir: shadowDir })

  const normOutDir = path.join(shadowDir, 'norm')
  const normalizeFn =
    deps.normalizeFn ??
    ((opts: { rawDir: string; runId: string; outDir: string }) => {
      execFileSync(process.execPath, [NORMALIZE_MJS, '--raw', opts.rawDir, '--run', opts.runId, '--out', opts.outDir], {
        stdio: 'inherit',
      })
    })

  await normalizeFn({ rawDir: shadowDir, runId: shadowRunId, outDir: normOutDir })

  const prevId = previousRun || findLatestProviderRunId(path.join(rootDir, 'runs'), provider)
  if (!prevId) {
    console.error(`비교할 이전 ${provider} run 을 찾지 못했다 (${path.join(rootDir, 'runs')}).`)
    return 1
  }

  const diffOutFile = path.join(shadowDir, 'diff.json')
  const latestDir = deps.latestDir ?? DEFAULT_LATEST_DIR
  const normPrevDir = path.join(rootDir, 'norm')
  const diffArgv = [
    '--current',
    shadowRunId,
    '--previous',
    prevId,
    '--root',
    shadowDir,
    '--previous-root',
    rootDir,
    '--norm-previous',
    normPrevDir,
    '--norm-current',
    normOutDir,
    '--spec-dir',
    latestDir,
    '--out',
    diffOutFile,
  ]

  const diffFn = deps.diffFn ?? runDiffMain
  return diffFn(diffArgv)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => {
    process.exitCode = code
  })
}
