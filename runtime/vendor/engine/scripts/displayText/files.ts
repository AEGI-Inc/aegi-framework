/**
 * 화면 설명 문구의 정본(display-text/)과 AI 생성 캐시(.cache/display-text.json)를 읽고 쓴다.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parse, stringify } from 'yaml'
import type { ProviderText, TypeText } from '../../src/model/displayText.ts'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const DISPLAY_TEXT_DIR = path.join(ROOT, 'display-text')
/** AI 생성 캐시. 데모 배포판처럼 코드 폴더에 쓸 수 없으면 AEGI_DISPLAY_TEXT_CACHE 로 다른 파일을 준다 */
export const CACHE_FILE = process.env.AEGI_DISPLAY_TEXT_CACHE ? path.resolve(process.env.AEGI_DISPLAY_TEXT_CACHE) : path.join(ROOT, '.cache', 'display-text.json')

export type DraftKind = 'type' | 'provider'

export interface Canonical {
  providers: Record<string, Omit<ProviderText, 'source'>>
  /** `provider:object_type`(소문자) → 뜻 */
  types: Record<string, string>
}

const yamlFiles = (dir: string) => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).sort().map(f => path.join(dir, f)) : []

export function loadCanonical(dir = DISPLAY_TEXT_DIR): Canonical {
  const out: Canonical = { providers: {}, types: {} }
  for (const file of yamlFiles(path.join(dir, 'types'))) {
    const doc = parse(fs.readFileSync(file, 'utf8')) as { provider: string; name?: string; profile?: { role: string; points: string[] }; types?: Record<string, { meaning: string }> }
    out.providers[doc.provider] = { ...(doc.name ? { name: doc.name } : {}), ...(doc.profile ?? {}) }
    for (const [type, v] of Object.entries(doc.types ?? {})) out.types[`${doc.provider}:${type.toLowerCase()}`] = v.meaning
  }
  return out
}

export function loadPrompt(name: DraftKind | 'polish', dir = DISPLAY_TEXT_DIR): string {
  return fs.readFileSync(path.join(dir, 'prompts', `${name}.md`), 'utf8').replace(/\r\n/g, '\n')
}

export function loadFormat(kind: DraftKind, dir = DISPLAY_TEXT_DIR): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, 'formats', `${kind}.json`), 'utf8'))
}

/** 프롬프트 판: 초안, 윤문 프롬프트와 출력 형식의 해시. 셋 중 하나를 고치면 캐시가 새로 만들어진다 */
export function promptVersion(kind: DraftKind, dir = DISPLAY_TEXT_DIR): string {
  const hash = crypto.createHash('sha256')
  hash.update(loadPrompt(kind, dir)).update(loadPrompt('polish', dir)).update(JSON.stringify(loadFormat(kind, dir)))
  return hash.digest('hex').slice(0, 12)
}

export interface CacheEntry {
  kind: DraftKind
  /** type: `provider:object_type`, provider: provider id */
  subject: string
  model: string
  prompt_version: string
  generated_at: string
  value: TypeText | ProviderText
}

export type Cache = Record<string, CacheEntry>

export function readCache(file = CACHE_FILE): Cache {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as Cache : {}
}

export function writeCache(cache: Cache, file = CACHE_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)))
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n')
}

/** 캐시 키: 종류, 입력, 프롬프트 판의 해시 */
export function cacheKey(kind: DraftKind, input: unknown, version: string): string {
  return `${kind}:${crypto.createHash('sha256').update(JSON.stringify(input)).update(version).digest('hex').slice(0, 16)}`
}

/** 생성분을 검토용 YAML 로 쓴다. 정본 파일과 같은 모양이라 고쳐서 그대로 옮길 수 있다 */
export function writeReviewDrafts(cache: Cache, outDir: string): string[] {
  const written: string[] = []
  const byProvider = new Map<string, { name?: string; profile?: unknown; types: Record<string, { meaning: string }> }>()
  const slot = (p: string) => byProvider.get(p) ?? byProvider.set(p, { types: {} }).get(p)!
  for (const e of Object.values(cache)) {
    if (e.kind === 'type') {
      const [p, type] = [e.subject.slice(0, e.subject.indexOf(':')), e.subject.slice(e.subject.indexOf(':') + 1)]
      slot(p).types[type] = { meaning: (e.value as TypeText).meaning }
    } else if (e.kind === 'provider') {
      const v = e.value as ProviderText
      Object.assign(slot(e.subject), { name: v.name, profile: { role: v.role, points: v.points } })
    }
  }
  for (const [p, v] of byProvider) {
    fs.mkdirSync(path.join(outDir, 'types'), { recursive: true })
    const file = path.join(outDir, 'types', `${p}.yaml`)
    const doc = { provider: p, format: 'aegi-display-text/v1', ...(v.name ? { name: v.name } : {}), ...(v.profile ? { profile: v.profile } : {}), types: v.types }
    fs.writeFileSync(file, '# AI 생성 초안. 검토하고 고친 뒤 display-text/types/ 의 같은 파일에 합친다\n' + stringify(doc, { lineWidth: 0 }))
    written.push(file)
  }
  return written
}
