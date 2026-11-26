/**
 * 적재 대상(환경)과 데이터셋을 명시적으로 고른다. publish, snapshots, rollback, d1:verify 가 함께 쓴다.
 *
 * - `--env preview|production|demo` 와 `--dataset <폴더>` 는 필수다. 기본값으로 아무 DB, 아무 데이터셋에 쓰지 않는다 (2026-10-21 사고).
 * - 지금 그 환경 D1 현재 스냅샷에 올라간 데이터셋보다 오래된 데이터셋(manifest.created_at)은 거절한다. 일부러 되돌릴 때만 `--allow-older`.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getCfToken } from '../vault/kv.ts'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? 'a5921c69fa5ebeb3a79c15ac2e4a38fd'

/**
 * Pages 프로젝트 aegi-dashboard-new 의 production, preview 바인딩(EXCEPTIONS_DB, MEASURED_KV)과 같아야 한다.
 * demo 는 공개 데모 Worker aegi-site-demo(대시보드 wrangler.site.jsonc env.demo)의 바인딩이다. 데모는 AEGI_GRAPH_SNAPSHOT_ID 로 고정한 스냅샷을 읽는다
 */
export const TARGETS = {
  preview: { d1Name: 'aegi-dashboard-exceptions-preview', kvNamespaceId: '54e7b55c5bff491aa1b80d12bbca020e' },
  production: { d1Name: 'aegi-dashboard-exceptions', kvNamespaceId: '9af8ddd7235b43b197c077c559c7c18e' },
  demo: { d1Name: 'aegi-demo-data', kvNamespaceId: 'b80d69f5ec3e4a1f8e07baa0353995a7' },
} as const
export type TargetEnv = keyof typeof TARGETS

export interface LoadTarget {
  env: TargetEnv
  d1Name: string
  kvNamespaceId: string
  datasetDir: string
  flags: Set<string>
  /** --to 같은 값 있는 옵션 */
  options: Map<string, string>
}

const USAGE = '--env preview|production|demo (--dataset <데이터셋 폴더> | --from-current) [--allow-older] [--allow-degraded] [--standard-results <standard_results.json>]'
const FLAGS = ['--allow-older', '--from-current', '--allow-degraded', '--skip-compliance-scope']
const VALUE_OPTIONS = ['--to', '--standard-results', '--id', '--reason', '--knowledge']

export function parseTarget(argv: string[] = process.argv.slice(2), { requireDataset = true } = {}): LoadTarget {
  const value = (name: string) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined
  }
  const env = value('--env')
  if (!env || !(env in TARGETS)) throw new Error(`--env 가 없거나 잘못됐다 (preview | production | demo). 사용: ${USAGE}`)
  const dataset = value('--dataset')
  const fromCurrent = argv.includes('--from-current')
  if (dataset && fromCurrent) throw new Error(`--dataset 과 --from-current 는 함께 쓰지 않는다. 사용: ${USAGE}`)
  if (!dataset && !fromCurrent && requireDataset) throw new Error(`--dataset 이 없다. 기본 데이터셋은 없다. 사용: ${USAGE}`)
  const datasetDir = dataset ? path.resolve(ROOT, dataset) : ''
  if (dataset && !fs.existsSync(path.join(datasetDir, 'manifest.json'))) throw new Error(`데이터셋이 아니다 (manifest.json 없음): ${datasetDir}`)
  const t = TARGETS[env as TargetEnv]
  const options = new Map(VALUE_OPTIONS.flatMap(name => (value(name) ? [[name, value(name)!] as [string, string]] : [])))
  return { env: env as TargetEnv, ...t, datasetDir, flags: new Set(argv.filter(a => FLAGS.includes(a))), options }
}

export interface DatasetSummary {
  createdAt: string | null
  providers: string[]
  objects: number
  relations: number
  events: number
}

export function readDatasetSummary(dir: string): DatasetSummary {
  const read = (f: string) => {
    const file = path.join(dir, f)
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  }
  const manifest = read('manifest.json') ?? {}
  const len = (v: any) => (Array.isArray(v) ? v.length : 0)
  return {
    createdAt: manifest.created_at ?? null,
    providers: manifest.providers ?? [],
    objects: len(read('objects.json')),
    relations: len(read('relations.json')),
    events: len(read('events.json')?.events),
  }
}

export function describeTarget(t: LoadTarget, s: DatasetSummary): string {
  return [
    `대상: ${t.env} (D1 ${t.d1Name}, KV ${t.kvNamespaceId})`,
    `데이터셋: ${path.relative(ROOT, t.datasetDir) || t.datasetDir}`,
    `  생성 ${s.createdAt ?? '알 수 없음'} | SaaS ${s.providers.join(', ') || '알 수 없음'}`,
    `  객체 ${s.objects}, 관계 ${s.relations}, 이벤트 ${s.events}`,
  ].join('\n')
}

export async function cfApi<T>(method: string, apiPath: string, body?: unknown, retries = 4): Promise<T> {
  const isForm = body instanceof FormData
  const init: RequestInit = {
    method,
    headers: isForm ? { Authorization: `Bearer ${getCfToken()}` } : { Authorization: `Bearer ${getCfToken()}`, 'Content-Type': 'application/json' },
  }
  if (body !== undefined) init.body = isForm || typeof body === 'string' ? (body as FormData | string) : JSON.stringify(body)

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${apiPath}`, init)
      const json = await res.json().catch(() => ({})) as { success: boolean; result: T; errors?: Array<{ code: number; message: string }> }
      if (!res.ok || json.success === false) {
        const msg = (json.errors ?? []).map(e => `${e.code} ${e.message}`).join('; ')
        if (attempt < retries && (res.status >= 500 || res.status === 429)) {
          await new Promise(r => setTimeout(r, 600 * Math.pow(2, attempt)))
          continue
        }
        const err = new Error(`Cloudflare API 오류 [${method} ${apiPath}] ${res.status}: ${msg}`) as Error & { status?: number }
        err.status = res.status
        throw err
      }
      return json.result
    } catch (err) {
      if ((err as { status?: number }).status === 404 || attempt >= retries) throw err
      await new Promise(r => setTimeout(r, 600 * Math.pow(2, attempt)))
    }
  }
  throw new Error('Cloudflare API 최대 재시도 초과')
}

export async function getD1Uuid(d1Name: string): Promise<string> {
  const list = await cfApi<Array<{ uuid: string; name: string }>>('GET', `/d1/database?name=${encodeURIComponent(d1Name)}&per_page=100`)
  const found = list.find(db => db.name === d1Name)
  if (!found) throw new Error(`D1 데이터베이스 [${d1Name}]를 찾을 수 없습니다.`)
  return found.uuid
}

export async function queryD1<T>(dbUuid: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await cfApi<Array<{ results: T[] }>>('POST', `/d1/database/${dbUuid}/query`, { sql, params })
  return res[0]?.results ?? []
}

/** 순수 판단: 올리려는 데이터셋이 지금 올라간 것보다 오래됐으면 이유를 돌려준다 */
export function olderDatasetReason(datasetCreatedAt: string | null, publishedCreatedAt: string | null | undefined): string | null {
  if (!publishedCreatedAt) return null
  if (!datasetCreatedAt) return `데이터셋 manifest.created_at 이 없어 지금 올라간 데이터셋(${publishedCreatedAt})과 비교할 수 없다`
  if (Date.parse(datasetCreatedAt) < Date.parse(publishedCreatedAt)) return `데이터셋(${datasetCreatedAt})이 지금 올라간 데이터셋(${publishedCreatedAt})보다 오래됐다`
  return null
}

/**
 * 정규화 출력 검사(verify.json)의 식별 실패 경고. 레코드 몇 개가 빠진 것(no_identity_rejections)은 알리기만 하고,
 * Profile 하나의 객체가 크게 빠진 것(identity_rejections_not_systemic, 정규화는 멈추지 않고 경고로 남긴다)은 이유를 돌려준다.
 * verify.json 이 없거나 경고가 없으면 block 은 null, notes 는 빈 목록
 */
export function degradedDatasetReason(dir: string): { block: string | null; notes: string[] } {
  const file = path.join(dir, 'verify.json')
  if (!fs.existsSync(file)) return { block: null, notes: [] }
  const warnings: { name: string; detail?: unknown }[] = JSON.parse(fs.readFileSync(file, 'utf8')).warnings ?? []
  const detail = (w?: { detail?: unknown }) => (Array.isArray(w?.detail) ? w!.detail.join(', ') : '')
  const systemic = warnings.find(w => w.name === 'identity_rejections_not_systemic')
  const few = warnings.find(w => w.name === 'no_identity_rejections')
  return {
    block: systemic ? `정규화에서 Profile 객체가 크게 빠졌다(식별 실패): ${detail(systemic)}` : null,
    notes: few && !systemic ? [`정규화에서 식별 못 한 레코드를 뺐다: ${detail(few)}`] : [],
  }
}

/** 크게 빠진 데이터셋은 멈춘다. 그래도 올릴 것이면 --allow-degraded */
export function assertNotDegraded(t: LoadTarget, dir: string): void {
  const { block, notes } = degradedDatasetReason(dir)
  for (const n of notes) console.warn(`[주의] ${n}`)
  if (!block) return
  if (t.flags.has('--allow-degraded')) {
    console.warn(`[주의] ${block}. --allow-degraded 로 계속한다`)
    return
  }
  throw new Error(`${block}. 수집이나 Profile 을 확인하고, 알고 올리는 것이면 --allow-degraded 를 붙인다`)
}

/**
 * 올리려는 데이터셋이 그 환경에 지금 올라간 것보다 오래됐으면 멈춘다.
 * 기준은 D1 현재 스냅샷의 데이터셋 생성 시각이고, 현재 스냅샷 시각이 없으면 비교 기준은 null이다(KV fallback 없음).
 */
export async function assertNotOlder(t: LoadTarget, s: DatasetSummary, currentCreatedAt?: string | null): Promise<void> {
  const reference = currentCreatedAt !== undefined && currentCreatedAt !== null ? currentCreatedAt : null
  const reason = olderDatasetReason(s.createdAt, reference)
  if (!reason) return
  if (t.flags.has('--allow-older')) {
    console.warn(`! ${reason}. --allow-older 로 계속한다`)
    return
  }
  throw new Error(`${reason}. 일부러 되돌리는 것이면 --allow-older 를 붙인다`)
}
