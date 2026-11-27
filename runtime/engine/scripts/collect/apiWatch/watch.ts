/**
 * api-watch CLI: 스펙 기준선 생성(`baseline`) 및 최신 스펙·변경 공지·API 자체 신호 비교(`check`).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import type { ApiListEntry } from '../api-list/build'
import { loadConfig, type CollectorConfig } from '../config'
import { sha256Hex } from '../lib/sanitize'
import { loadApiList } from '../providers/apiList'
import { main as runDiffMain, type RunDiffItem, type RunDiffReport } from '../runDiff'
import { runFixtures } from './fixtures'
import { impactOfOperation, isEmptyImpact, type Impact } from './impact'
import { diffSurface, type SpecDiffItem } from './specDiff'
import {
  decodeHtmlEntities,
  extractGraphqlSurface,
  extractSlackDocSurface,
  extractSurface,
  type SourceSurface,
} from './surface'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const DEFAULT_SOURCES_FILE = path.join(HERE, 'sources.yaml')
const DEFAULT_STATE_FILE = path.join(ROOT, 'collected/api-watch/state.json')
const DEFAULT_LATEST_DIR = path.join(ROOT, 'collected/api-watch/latest')
const DEFAULT_COLLECTOR_CONFIG = path.join(ROOT, 'scripts/collect/collector.config.json')
const GITHUB_TS_FILE = path.join(ROOT, 'scripts/collect/providers/github.ts')
const GH_ISSUE_REPO = 'AEGI-Inc/aegi-adapter-engine'
const CHANGELOG_FIRST_RUN_DAYS = 14
const CHANGELOG_MAX_SEEN_IDS = 200
const SLACK_DOC_DELAY_MS = 300
const SUNSET_SOON_DAYS = 183
const LATEST_MAX_AGE_MS = 7 * 86400_000

export interface WatchSource {
  id: string
  provider: string | null
  format: 'openapi' | 'discovery' | 'graphql' | 'slack_doc' | 'sf_object_reference'
  watch: 'repo' | 'spec_url' | 'doc_page' | 'live' | 'none'
  repo?: string
  path?: string
  url: string | null
  baseline: string
  snapshot_file: string | null
  pinned: string | null
  sunset: string | null
}

export interface ChangelogSource {
  id: string
  provider: string
  feed: string
  keywords: string[]
}

export interface LiveSource {
  id: string
  provider: string
  url?: string
  pinned?: string
  url_from_config?: string
  pinned_from_config?: string
}

export interface WatchStateEntry {
  checked_at: string
  commit_sha?: string
  commit_date?: string
  sha256?: string
  revision?: string
  version?: string
  last_seen?: string
  seen_ids?: string[]
}

export interface BaselineFile extends SourceSurface {
  snapshot_sha256: string
  made_at: string
  unmatched: string[]
}

export interface WatchReport {
  format: 'aegi-api-watch/v1'
  checked_at: string
  summary: { break: number; soon: number; added: number; info: number; unchanged: number; skipped: number }
  sources: Array<{
    id: string
    status: 'changed' | 'unchanged' | 'skipped' | 'error'
    commit_sha?: string
    error?: string
  }>
  items: SpecDiffItem[]
  warnings: string[]
}

export interface LatestSurfaceFile extends SourceSurface {
  fetched_at: string
  commit_sha?: string
}

export interface WatchDeps {
  apiList?: ApiListEntry[]
  sources?: WatchSource[]
  changelogs?: ChangelogSource[]
  live?: LiveSource[]
  fetch?: typeof globalThis.fetch
  now?: () => Date
  baseDir?: string
  latestDir?: string
  rootDir?: string
  afterCollectOutDir?: string
  usedGraphqlFields?: Set<string>
  collectorConfig?: Partial<CollectorConfig> | null
  execFileSync?: typeof execFileSync
  sleepMs?: (ms: number) => Promise<void>
  complianceChecksByObjectType?: Map<string, string[]> | Record<string, string[]>
}

interface FeedEntry {
  id: string
  title: string
  link: string
  dateMs: number
  dateIso?: string
  summary: string
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k])
    }
    return out
  }
  return value
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + '\n'
}

export function loadSourcesFile(file = DEFAULT_SOURCES_FILE): {
  sources: WatchSource[]
  changelogs: ChangelogSource[]
  live: LiveSource[]
} {
  const doc = YAML.parse(fs.readFileSync(file, 'utf8')) as {
    sources?: WatchSource[]
    changelogs?: ChangelogSource[]
    live?: LiveSource[]
  }
  return {
    sources: Array.isArray(doc?.sources) ? doc.sources : [],
    changelogs: Array.isArray(doc?.changelogs) ? doc.changelogs : [],
    live: Array.isArray(doc?.live) ? doc.live : [],
  }
}

export function loadSources(file = DEFAULT_SOURCES_FILE): WatchSource[] {
  return loadSourcesFile(file).sources
}

export function extractUsedGraphqlFields(file = GITHUB_TS_FILE): Set<string> {
  if (!fs.existsSync(file)) return new Set()
  const text = fs.readFileSync(file, 'utf8')
  const fields = new Set<string>()
  const queryRe = /['"`]\s*(?:query|mutation|subscription)\b[^'"`]*['"`]/g
  for (const match of text.matchAll(queryRe)) {
    const body = match[0].replace(/\$[A-Za-z0-9_]+/g, ' ')
    for (const id of body.matchAll(/\b[a-z][A-Za-z0-9_]*\b/g)) {
      if (id[0] !== 'query' && id[0] !== 'mutation' && id[0] !== 'subscription') {
        fields.add(id[0])
      }
    }
  }
  return fields
}

function parseSpecText(format: string, text: string): unknown {
  if (format === 'graphql') return text
  const trimmed = text.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(text)
  }
  return YAML.parse(text)
}

function formatUtcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function readOfflineSpec(dir: string, id: string): string | null {
  for (const ext of ['.json', '.yaml', '.yml', '.graphql']) {
    const candidate = path.join(dir, `${id}${ext}`)
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8')
    }
  }
  return null
}

function extractXmlTagRaw(block: string, tagName: string): string {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i')
  const m = block.match(re)
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : ''
}

function extractXmlTag(block: string, tagName: string): string {
  return decodeHtmlEntities(extractXmlTagRaw(block, tagName)).trim()
}

function cleanFeedText(raw: string): string {
  return decodeHtmlEntities(raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function extractAtomLink(block: string): string {
  const alt = block.match(/<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i)
    ?? block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']alternate["'][^>]*>/i)
  if (alt) return decodeHtmlEntities(alt[1]).trim()
  const anyHref = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i)
  if (anyHref) return decodeHtmlEntities(anyHref[1]).trim()
  return extractXmlTag(block, 'link')
}

export function parseFeed(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = []
  const rssItems = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
  if (rssItems.length > 0) {
    for (const m of rssItems) {
      const block = m[1]
      const title = cleanFeedText(extractXmlTagRaw(block, 'title'))
      const link = extractXmlTag(block, 'link')
      const id = extractXmlTag(block, 'guid') || link || title
      const rawDate = extractXmlTag(block, 'pubDate') || extractXmlTag(block, 'dc:date') || extractXmlTag(block, 'updated')
      const dateMs = rawDate ? Date.parse(rawDate) : NaN
      const rawDesc = extractXmlTagRaw(block, 'description') || extractXmlTagRaw(block, 'content:encoded') || extractXmlTagRaw(block, 'summary')
      const summary = cleanFeedText(rawDesc).slice(0, 1000)
      entries.push({
        id,
        title,
        link,
        dateMs,
        ...(Number.isFinite(dateMs) ? { dateIso: new Date(dateMs).toISOString() } : {}),
        summary,
      })
    }
    return entries
  }

  for (const m of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const block = m[1]
    const title = cleanFeedText(extractXmlTagRaw(block, 'title'))
    const link = extractAtomLink(block)
    const id = extractXmlTag(block, 'id') || link || title
    const rawDate = extractXmlTag(block, 'updated') || extractXmlTag(block, 'published')
    const dateMs = rawDate ? Date.parse(rawDate) : NaN
    const rawSummary = extractXmlTagRaw(block, 'summary') || extractXmlTagRaw(block, 'content')
    const summary = cleanFeedText(rawSummary).slice(0, 1000)
    entries.push({
      id,
      title,
      link,
      dateMs,
      ...(Number.isFinite(dateMs) ? { dateIso: new Date(dateMs).toISOString() } : {}),
      summary,
    })
  }
  return entries
}

function compareVersionStrings(a: string, b: string): number {
  const pa = a.split('.').map(n => Number(n))
  const pb = b.split('.').map(n => Number(n))
  if (pa.every(Number.isFinite) && pb.every(Number.isFinite)) {
    const len = Math.max(pa.length, pb.length)
    for (let i = 0; i < len; i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
      if (diff !== 0) return diff
    }
    return 0
  }
  return a < b ? -1 : a > b ? 1 : 0
}

function opNameFromOperationId(operationId: string): string {
  const parts = operationId.split(':')
  return parts.length >= 3 ? parts.slice(2).join(':') : operationId
}

function runBaseline(argv: string[], deps: WatchDeps): number {
  const valueFlags = new Set(['--source', '--file', '--out'])
  const args = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!valueFlags.has(arg) || args.has(arg) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      console.error('인자가 잘못되었다. --help 로 사용법을 확인한다.')
      return 1
    }
    args.set(arg, argv[++i])
  }

  const sourceId = args.get('--source')
  const specFile = args.get('--file')
  if (!sourceId || !specFile) {
    console.error('--source <id> 와 --file <경로> 가 필요하다.')
    return 1
  }

  const sources = deps.sources ?? loadSources()
  const src = sources.find(s => s.id === sourceId)
  if (!src) {
    console.error(`sources.yaml 에서 출처를 찾지 못했다: ${sourceId}`)
    return 1
  }
  if (src.format !== 'openapi' && src.format !== 'discovery' && src.format !== 'graphql' && src.format !== 'slack_doc') {
    console.error(`지원하지 않는 형식이다: ${src.format}`)
    return 1
  }

  const apiList = (deps.apiList ?? loadApiList()).filter(
    e => (e.status === 'approved' || e.status === 'legacy') && e.source === sourceId,
  )

  let surface: SourceSurface
  let unmatched: string[]
  let snapshotHash: string

  if (src.format === 'slack_doc') {
    const folder = path.resolve(ROOT, specFile)
    const pages = new Map<string, string>()
    const hashParts: string[] = []
    for (const entry of apiList) {
      const methodName = opNameFromOperationId(entry.operation_id)
      const htmlPath = path.join(folder, `reference__methods__${methodName}.html`)
      if (fs.existsSync(htmlPath)) {
        const html = fs.readFileSync(htmlPath, 'utf8')
        pages.set(methodName, html)
        hashParts.push(`${methodName}\0${html}`)
      }
    }
    const extracted = extractSlackDocSurface(pages, apiList)
    surface = extracted.surface
    surface.source = sourceId
    unmatched = extracted.unmatched
    snapshotHash = sha256Hex(hashParts.sort().join('\n'))
  } else {
    const rawText = fs.readFileSync(path.resolve(ROOT, specFile), 'utf8')
    snapshotHash = sha256Hex(rawText)
    const parsed = parseSpecText(src.format, rawText)
    if (src.format === 'graphql') {
      const used = deps.usedGraphqlFields ?? extractUsedGraphqlFields()
      surface = extractGraphqlSurface(String(parsed), used)
      surface.source = sourceId
      unmatched = []
    } else {
      const extracted = extractSurface(src.format, parsed, apiList)
      surface = extracted.surface
      surface.source = sourceId
      unmatched = extracted.unmatched
    }
  }

  const now = (deps.now ?? (() => new Date()))()
  const baselineDoc: BaselineFile = {
    ...surface,
    snapshot_sha256: snapshotHash,
    made_at: now.toISOString(),
    unmatched,
  }

  const baseDir = deps.baseDir ?? HERE
  const outFile = args.has('--out')
    ? path.resolve(ROOT, args.get('--out')!)
    : path.resolve(baseDir, src.baseline)
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, stableJson(baselineDoc), 'utf8')

  if (unmatched.length > 0) {
    console.log(`unmatched (${unmatched.length}): ${unmatched.join(', ')}`)
  }
  console.log(`baseline written: ${outFile} (${Object.keys(surface.ops).length} ops)`)
  return 0
}

const STEM_KEYWORDS = new Set(['deprecat'])

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function matchesChangelogKeyword(haystack: string, keyword: string): boolean {
  if (!keyword) return false
  const escaped = escapeRegex(keyword)
  if (keyword.endsWith('.') || STEM_KEYWORDS.has(keyword.toLowerCase())) {
    return new RegExp(`\\b${escaped}`, 'i').test(haystack)
  }
  const isUpperAcronym = /^[A-Z0-9]{2,}$/.test(keyword)
  return new RegExp(`\\b${escaped}\\b`, isUpperAcronym ? '' : 'i').test(haystack)
}

function writeLatestSurface(
  latestDir: string,
  sourceId: string,
  surface: SourceSurface,
  fetchedAt: string,
  commitSha?: string,
): void {
  const doc: LatestSurfaceFile = {
    ...surface,
    fetched_at: fetchedAt,
    ...(commitSha ? { commit_sha: commitSha } : {}),
  }
  fs.mkdirSync(latestDir, { recursive: true })
  fs.writeFileSync(path.join(latestDir, `${sourceId}.json`), stableJson(doc), 'utf8')
}

function itemIssueKey(item: SpecDiffItem): string {
  return `${item.kind} ${item.op} ${item.field ?? ''}`.trim()
}

function formatImpactCell(impact?: Impact): string {
  if (!impact) return '-'
  const objs = impact.object_types.slice(0, 5).join(', ') || '-'
  return `Profile ${impact.profiles.length}, 객체 ${objs}, 판정 ${impact.compliance_checks.length}`
}

function formatIssueItemsTable(items: SpecDiffItem[]): string {
  const lines = [
    '| 심각도 | kind | op | field | 이전 | 이번 | 메모 | 영향 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const item of items) {
    const cells = [
      item.severity,
      item.kind,
      item.op || '-',
      item.field || '-',
      item.previous || '-',
      item.current || '-',
      item.note || '-',
      formatImpactCell(item.impact),
    ].map(c => c.replace(/\|/g, '\\|').replace(/\r?\n/g, ' '))
    lines.push(`| ${cells.join(' | ')} |`)
  }
  lines.push('')
  lines.push('<!-- 항목 키:')
  for (const item of items) {
    lines.push(itemIssueKey(item))
  }
  lines.push('-->')
  return lines.join('\n')
}

function upsertGitHubIssue(
  title: string,
  label: 'bug' | 'enhancement',
  itemKeys: string[],
  renderBody: (selectedKeys: Set<string>) => string,
  footerLines: string[],
  execFn: typeof execFileSync,
  warnings: string[],
  errContext: string,
): void {
  try {
    const listJson = execFn(
      'gh',
      ['issue', 'list', '-R', GH_ISSUE_REPO, '--state', 'open', '--search', title, '--json', 'number,title,body'],
      { encoding: 'utf8' },
    )
    const existing = (JSON.parse(listJson) as Array<{ number: number; title: string; body?: string }>).find(
      iss => iss.title === title,
    )

    if (!existing) {
      const body = [renderBody(new Set(itemKeys)), '', ...footerLines].join('\n')
      execFn(
        'gh',
        ['issue', 'create', '-R', GH_ISSUE_REPO, '--title', title, '--label', label, '--body', body],
        { encoding: 'utf8' },
      )
      return
    }

    const viewJson = execFn(
      'gh',
      ['issue', 'view', String(existing.number), '-R', GH_ISSUE_REPO, '--json', 'body,comments'],
      { encoding: 'utf8' },
    )
    const viewData = JSON.parse(viewJson) as { body?: string; comments?: Array<{ body?: string }> }
    const existingText = [
      viewData.body ?? existing.body ?? '',
      ...(viewData.comments ?? []).map(c => c.body ?? ''),
    ].join('\n')

    const newKeys = itemKeys.filter(k => !existingText.includes(k))
    if (newKeys.length === 0) return

    const commentBody = [renderBody(new Set(newKeys)), '', footerLines[0]].filter(Boolean).join('\n')
    execFn(
      'gh',
      ['issue', 'comment', String(existing.number), '-R', GH_ISSUE_REPO, '--body', commentBody],
      { encoding: 'utf8' },
    )
  } catch (err) {
    warnings.push(`이슈 알림 실패(${errContext}): ${err instanceof Error ? err.message : String(err)}`)
  }
}

function openOrUpdateIssues(
  items: SpecDiffItem[],
  outFile: string,
  execFn: typeof execFileSync,
  warnings: string[],
): void {
  const actionable = items.filter(i => i.severity === 'break' || i.severity === 'soon')
  if (actionable.length === 0) return

  const bySource = new Map<string, SpecDiffItem[]>()
  for (const item of actionable) {
    const list = bySource.get(item.source) ?? []
    list.push(item)
    bySource.set(item.source, list)
  }

  const reportName = path.basename(outFile)
  for (const [sourceId, srcItems] of bySource) {
    const title = `API 변경 감지: ${sourceId}`
    const label = srcItems.some(i => i.severity === 'break') ? 'bug' : 'enhancement'
    const keys = srcItems.map(itemIssueKey)
    upsertGitHubIssue(
      title,
      label,
      keys,
      selected => formatIssueItemsTable(srcItems.filter(it => selected.has(itemIssueKey(it)))),
      [`보고서: \`${reportName}\``, '기준선 갱신은 Profile·api-list 를 고친 PR 안에서 같이 한다'],
      execFn,
      warnings,
      sourceId,
    )
  }
}

async function runCheck(argv: string[], deps: WatchDeps): Promise<number> {
  const valueFlags = new Set(['--state', '--out', '--offline-latest'])
  const selectedSources: string[] = []
  const args = new Map<string, string>()
  let force = false
  let failOnBreak = false
  let noChangelog = false
  let noLive = false
  let openIssues = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--force') {
      force = true
      continue
    }
    if (arg === '--fail-on-break') {
      failOnBreak = true
      continue
    }
    if (arg === '--no-changelog') {
      noChangelog = true
      continue
    }
    if (arg === '--no-live') {
      noLive = true
      continue
    }
    if (arg === '--open-issues') {
      openIssues = true
      continue
    }
    if (arg === '--source') {
      const val = argv[++i]
      if (!val || val.startsWith('--')) {
        console.error('--source 값이 필요하다.')
        return 1
      }
      for (const part of val.split(',')) {
        if (part.trim()) selectedSources.push(part.trim())
      }
      continue
    }
    if (!valueFlags.has(arg) || args.has(arg) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      console.error('인자가 잘못되었다. --help 로 사용법을 확인한다.')
      return 1
    }
    args.set(arg, argv[++i])
  }

  const now = (deps.now ?? (() => new Date()))()
  const checkedAt = now.toISOString()
  const baseDir = deps.baseDir ?? HERE
  const latestDir = deps.latestDir ?? DEFAULT_LATEST_DIR
  const stateFile = args.has('--state') ? path.resolve(ROOT, args.get('--state')!) : DEFAULT_STATE_FILE
  const outFile = args.has('--out')
    ? path.resolve(ROOT, args.get('--out')!)
    : path.join(ROOT, `collected/api-watch/report-${formatUtcStamp(now)}.json`)
  const offlineDir = args.has('--offline-latest') ? path.resolve(ROOT, args.get('--offline-latest')!) : null
  const fetchFn = deps.fetch ?? globalThis.fetch
  const sleepFn = deps.sleepMs ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))

  let state: Record<string, WatchStateEntry> = {}
  if (fs.existsSync(stateFile)) {
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, WatchStateEntry>
    } catch {
      state = {}
    }
  }

  const hasInjectedLists = deps.sources !== undefined || deps.changelogs !== undefined || deps.live !== undefined
  const loadedFile = hasInjectedLists ? null : loadSourcesFile()
  const allSources = deps.sources ?? loadedFile?.sources ?? []
  const allChangelogs = deps.changelogs ?? loadedFile?.changelogs ?? []
  const allLive = deps.live ?? loadedFile?.live ?? []

  const targetSources = allSources.filter(s => {
    if (selectedSources.length > 0 && !selectedSources.includes(s.id)) return false
    return s.watch === 'repo' || s.watch === 'spec_url' || s.watch === 'doc_page'
  })

  const apiList = deps.apiList ?? loadApiList()
  const usedGraphqlFields = deps.usedGraphqlFields ?? extractUsedGraphqlFields()

  const reportSources: WatchReport['sources'] = []
  const items: SpecDiffItem[] = []
  const warnings: string[] = []
  let unchangedCount = 0
  let skippedCount = 0

  for (const src of targetSources) {
    const baselinePath = path.resolve(baseDir, src.baseline)
    if (!fs.existsSync(baselinePath)) {
      warnings.push(`기준선 없음: ${src.id}`)
      reportSources.push({ id: src.id, status: 'skipped' })
      skippedCount++
      continue
    }

    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as BaselineFile
    const prevState = state[src.id]
    let rawSpec: string | null = null
    let commitSha: string | undefined
    let commitDate: string | undefined

    try {
      if (src.watch === 'doc_page') {
        const sourceOps = apiList.filter(
          e => (e.status === 'approved' || e.status === 'legacy') && e.source === src.id,
        )
        const pages = new Map<string, string>()
        const hashParts: string[] = []
        const methods = sourceOps.length > 0
          ? sourceOps.map(e => opNameFromOperationId(e.operation_id))
          : Object.values(baseline.ops).map(o => o.path)

        for (let idx = 0; idx < methods.length; idx++) {
          const methodName = methods[idx]
          let html: string | null = null
          if (offlineDir) {
            const direct = path.join(offlineDir, `reference__methods__${methodName}.html`)
            const nested = path.join(offlineDir, src.id, `reference__methods__${methodName}.html`)
            if (fs.existsSync(direct)) html = fs.readFileSync(direct, 'utf8')
            else if (fs.existsSync(nested)) html = fs.readFileSync(nested, 'utf8')
          } else {
            if (idx > 0) await sleepFn(SLACK_DOC_DELAY_MS)
            const res = await fetchFn(`https://docs.slack.dev/reference/methods/${methodName}`, {
              headers: { 'User-Agent': 'aegi-api-watch' },
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            html = await res.text()
          }
          if (html !== null) {
            pages.set(methodName, html)
            hashParts.push(`${methodName}\0${html}`)
          }
        }

        if (pages.size === 0 && offlineDir) {
          warnings.push(`오프라인 스펙 없음: ${src.id}`)
          reportSources.push({ id: src.id, status: 'skipped' })
          skippedCount++
          continue
        }

        const specHash = sha256Hex(hashParts.sort().join('\n'))
        if (!force && prevState?.sha256 === specHash) {
          state[src.id] = { ...prevState, checked_at: checkedAt }
          reportSources.push({ id: src.id, status: 'unchanged' })
          unchangedCount++
          continue
        }

        const extracted = extractSlackDocSurface(pages, sourceOps)
        const latestSurface = extracted.surface
        latestSurface.source = src.id
        writeLatestSurface(latestDir, src.id, latestSurface, checkedAt)
        const diffs = diffSurface(baseline, latestSurface)
        items.push(...diffs)

        state[src.id] = { checked_at: checkedAt, sha256: specHash }
        if (diffs.length === 0) {
          reportSources.push({ id: src.id, status: 'unchanged' })
          unchangedCount++
        } else {
          reportSources.push({ id: src.id, status: 'changed' })
        }
        continue
      }

      if (offlineDir) {
        rawSpec = readOfflineSpec(offlineDir, src.id)
        if (rawSpec === null) {
          warnings.push(`오프라인 스펙 없음: ${src.id}`)
          reportSources.push({ id: src.id, status: 'skipped' })
          skippedCount++
          continue
        }
      } else if (src.watch === 'repo') {
        if (!src.repo || !src.path) {
          reportSources.push({ id: src.id, status: 'error', error: 'missing_repo_or_path' })
          continue
        }
        const commitUrl = `https://api.github.com/repos/${src.repo}/commits?path=${encodeURIComponent(src.path)}&per_page=1`
        const commitRes = await fetchFn(commitUrl, {
          headers: { 'User-Agent': 'aegi-api-watch', Accept: 'application/vnd.github+json' },
        })
        if (!commitRes.ok) {
          reportSources.push({ id: src.id, status: 'error', error: `HTTP ${commitRes.status}` })
          continue
        }
        const commits = (await commitRes.json()) as Array<{ sha?: string; commit?: { committer?: { date?: string }; author?: { date?: string } } }>
        commitSha = commits?.[0]?.sha
        commitDate = commits?.[0]?.commit?.committer?.date ?? commits?.[0]?.commit?.author?.date

        if (!force && commitSha && prevState?.commit_sha === commitSha) {
          state[src.id] = { ...prevState, checked_at: checkedAt }
          reportSources.push({ id: src.id, status: 'unchanged', commit_sha: commitSha })
          unchangedCount++
          continue
        }
        if (!src.url) {
          reportSources.push({ id: src.id, status: 'error', error: 'missing_url' })
          continue
        }
        const specRes = await fetchFn(src.url, { headers: { 'User-Agent': 'aegi-api-watch' } })
        if (!specRes.ok) {
          reportSources.push({ id: src.id, status: 'error', error: `HTTP ${specRes.status}` })
          continue
        }
        rawSpec = await specRes.text()
      } else {
        if (!src.url) {
          reportSources.push({ id: src.id, status: 'error', error: 'missing_url' })
          continue
        }
        const specRes = await fetchFn(src.url, { headers: { 'User-Agent': 'aegi-api-watch' } })
        if (!specRes.ok) {
          reportSources.push({ id: src.id, status: 'error', error: `HTTP ${specRes.status}` })
          continue
        }
        rawSpec = await specRes.text()
        const specHash = sha256Hex(rawSpec)
        if (!force && prevState?.sha256 === specHash) {
          state[src.id] = { ...prevState, checked_at: checkedAt }
          reportSources.push({ id: src.id, status: 'unchanged' })
          unchangedCount++
          continue
        }
      }

      const specHash = sha256Hex(rawSpec)
      const parsed = parseSpecText(src.format, rawSpec)
      let latestSurface: SourceSurface
      if (src.format === 'graphql') {
        latestSurface = extractGraphqlSurface(String(parsed), usedGraphqlFields)
        latestSurface.source = src.id
      } else if (src.format === 'openapi' || src.format === 'discovery') {
        const sourceOps = apiList.filter(
          e => (e.status === 'approved' || e.status === 'legacy') && e.source === src.id,
        )
        const extracted = extractSurface(src.format, parsed, sourceOps)
        latestSurface = extracted.surface
        latestSurface.source = src.id
      } else {
        reportSources.push({ id: src.id, status: 'skipped' })
        skippedCount++
        continue
      }

      writeLatestSurface(latestDir, src.id, latestSurface, checkedAt, commitSha)

      const diffs = diffSurface(baseline, latestSurface)
      items.push(...diffs)

      state[src.id] = {
        checked_at: checkedAt,
        ...(commitSha ? { commit_sha: commitSha } : {}),
        ...(commitDate ? { commit_date: commitDate } : {}),
        sha256: specHash,
        ...(latestSurface.revision ? { revision: latestSurface.revision } : {}),
        ...(latestSurface.version ? { version: latestSurface.version } : {}),
      }

      if (diffs.length === 0) {
        reportSources.push({ id: src.id, status: 'unchanged', ...(commitSha ? { commit_sha: commitSha } : {}) })
        unchangedCount++
      } else {
        reportSources.push({ id: src.id, status: 'changed', ...(commitSha ? { commit_sha: commitSha } : {}) })
      }
    } catch (err) {
      reportSources.push({
        id: src.id,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 2. 변경 공지 (changelog)
  if (!noChangelog) {
    const targetChangelogs = allChangelogs.filter(
      cl => selectedSources.length === 0 || selectedSources.includes(cl.id),
    )
    const opNames = [
      ...new Set(
        apiList
          .filter(e => e.status === 'approved' || e.status === 'legacy')
          .map(e => opNameFromOperationId(e.operation_id))
          .filter(name => name.includes('.') || name.includes('/')),
      ),
    ]

    for (const cl of targetChangelogs) {
      try {
        const res = await fetchFn(cl.feed, { headers: { 'User-Agent': 'aegi-api-watch' } })
        if (!res.ok) {
          reportSources.push({ id: cl.id, status: 'error', error: `HTTP ${res.status}` })
          continue
        }
        const xml = await res.text()
        const parsedEntries = parseFeed(xml)
        const prevState = state[cl.id]
        const isFirstRun = !prevState || (!prevState.last_seen && (!prevState.seen_ids || prevState.seen_ids.length === 0))
        const cutoffMs = now.getTime() - CHANGELOG_FIRST_RUN_DAYS * 86400_000
        const prevSeenSet = new Set(prevState?.seen_ids ?? [])
        const prevLastSeenMs = prevState?.last_seen ? Date.parse(prevState.last_seen) : NaN

        const freshEntries = parsedEntries.filter(entry => {
          if (isFirstRun) {
            return Number.isFinite(entry.dateMs) && entry.dateMs >= cutoffMs
          }
          if (prevSeenSet.has(entry.id)) return false
          if (Number.isFinite(prevLastSeenMs) && Number.isFinite(entry.dateMs) && entry.dateMs < prevLastSeenMs) {
            return false
          }
          return true
        })

        let matchedCount = 0
        for (const entry of freshEntries) {
          const haystack = `${entry.title} ${entry.summary}`
          const matchedKeyword = cl.keywords.find(kw => matchesChangelogKeyword(haystack, kw)) ?? ''
          const matchedOp = opNames.find(op => haystack.includes(op)) ?? ''
          if (!matchedKeyword && !matchedOp) continue

          matchedCount++
          const isSoon = /deprecat|sunset|breaking|remov|retire|end of life|EOL/i.test(haystack)
          items.push({
            severity: isSoon ? 'soon' : 'info',
            kind: 'changelog',
            source: cl.id,
            op: matchedOp,
            field: matchedKeyword,
            current: entry.title,
            note: entry.link,
          })
        }

        let maxDateMs = Number.isFinite(prevLastSeenMs) ? prevLastSeenMs : NaN
        for (const e of parsedEntries) {
          if (Number.isFinite(e.dateMs) && (!Number.isFinite(maxDateMs) || e.dateMs > maxDateMs)) {
            maxDateMs = e.dateMs
          }
        }
        const seenIds = [...new Set([...freshEntries.map(e => e.id), ...(prevState?.seen_ids ?? [])])].slice(
          0,
          CHANGELOG_MAX_SEEN_IDS,
        )
        state[cl.id] = {
          checked_at: checkedAt,
          ...(Number.isFinite(maxDateMs) ? { last_seen: new Date(maxDateMs).toISOString() } : {}),
          seen_ids: seenIds,
        }

        if (matchedCount > 0) {
          reportSources.push({ id: cl.id, status: 'changed' })
        } else {
          reportSources.push({ id: cl.id, status: 'unchanged' })
          unchangedCount++
        }
      } catch (err) {
        reportSources.push({
          id: cl.id,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  // 3. API 자체 신호 (live) & sunset
  if (!noLive) {
    let loadedCollectorConfig: Partial<CollectorConfig> | null | undefined = deps.collectorConfig
    if (loadedCollectorConfig === undefined) {
      loadedCollectorConfig = fs.existsSync(DEFAULT_COLLECTOR_CONFIG) ? loadConfig(DEFAULT_COLLECTOR_CONFIG) : null
    }

    const targetLive = allLive.filter(
      lv => selectedSources.length === 0 || selectedSources.includes(lv.id),
    )

    for (const lv of targetLive) {
      try {
        let liveItemsCount = 0
        if (lv.provider === 'github' && lv.url) {
          const res = await fetchFn(lv.url, {
            headers: { 'User-Agent': 'aegi-api-watch', Accept: 'application/vnd.github+json' },
          })
          if (!res.ok) {
            reportSources.push({ id: lv.id, status: 'error', error: `HTTP ${res.status}` })
            continue
          }
          const versions = ((await res.json()) as unknown[])
            .filter((v): v is string => typeof v === 'string')
            .sort(compareVersionStrings)
          const pinned = lv.pinned ?? ''
          if (pinned && !versions.includes(pinned)) {
            items.push({
              severity: 'break',
              kind: 'pinned_version_unsupported',
              source: lv.id,
              op: '',
              previous: pinned,
            })
            liveItemsCount++
          }
          const newest = versions.at(-1)
          if (newest && pinned && compareVersionStrings(newest, pinned) > 0) {
            items.push({
              severity: 'info',
              kind: 'newer_version_available',
              source: lv.id,
              op: '',
              previous: pinned,
              current: newest,
            })
            liveItemsCount++
          }
        } else if (lv.provider === 'salesforce') {
          const instanceHost = loadedCollectorConfig?.salesforce?.instanceHost?.trim()
          if (!instanceHost) {
            warnings.push(`Salesforce instanceHost 없음: ${lv.id}`)
            reportSources.push({ id: lv.id, status: 'skipped' })
            skippedCount++
            continue
          }
          const pinned = loadedCollectorConfig?.salesforce?.apiVersion?.trim() ?? ''
          const cleanHost = instanceHost.replace(/^https?:\/\//, '').replace(/\/+$/, '')
          const res = await fetchFn(`https://${cleanHost}/services/data/`, {
            headers: { 'User-Agent': 'aegi-api-watch', Accept: 'application/json' },
          })
          if (!res.ok) {
            reportSources.push({ id: lv.id, status: 'error', error: `HTTP ${res.status}` })
            continue
          }
          const body = (await res.json()) as Array<{ version?: unknown }>
          const versions = body
            .map(v => (typeof v?.version === 'string' || typeof v?.version === 'number' ? String(v.version) : ''))
            .filter(Boolean)
            .sort(compareVersionStrings)

          if (pinned && !versions.includes(pinned)) {
            items.push({
              severity: 'break',
              kind: 'pinned_version_unsupported',
              source: lv.id,
              op: '',
              previous: pinned,
            })
            liveItemsCount++
          }
          const newest = versions.at(-1)
          if (newest && pinned) {
            const newerCount = versions.filter(v => compareVersionStrings(v, pinned) > 0).length
            if (newerCount >= 6) {
              items.push({
                severity: 'soon',
                kind: 'pinned_version_far_behind',
                source: lv.id,
                op: '',
                previous: pinned,
                current: newest,
              })
              liveItemsCount++
            }
            if (compareVersionStrings(newest, pinned) > 0) {
              items.push({
                severity: 'info',
                kind: 'newer_version_available',
                source: lv.id,
                op: '',
                previous: pinned,
                current: newest,
              })
              liveItemsCount++
            }
          }
        }

        if (liveItemsCount > 0) {
          reportSources.push({ id: lv.id, status: 'changed' })
        } else {
          reportSources.push({ id: lv.id, status: 'unchanged' })
          unchangedCount++
        }
      } catch (err) {
        reportSources.push({
          id: lv.id,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // 지원 종료일 (sunset)
    for (const src of allSources) {
      if (selectedSources.length > 0 && !selectedSources.includes(src.id)) continue
      if (!src.sunset) continue
      const sunsetMs = Date.parse(src.sunset)
      if (!Number.isFinite(sunsetMs)) continue
      const daysLeft = (sunsetMs - now.getTime()) / 86400_000
      if (daysLeft < 0) {
        items.push({
          severity: 'break',
          kind: 'sunset_passed',
          source: src.id,
          op: '',
          current: src.sunset,
        })
      } else if (daysLeft <= SUNSET_SOON_DAYS) {
        items.push({
          severity: 'soon',
          kind: 'sunset_within_6_months',
          source: src.id,
          op: '',
          current: src.sunset,
        })
      }
    }
  }

  for (const item of items) {
    if ((item.severity === 'break' || item.severity === 'soon') && item.op) {
      const impact = impactOfOperation(item.op, {
        apiList,
        complianceChecksByObjectType: deps.complianceChecksByObjectType,
      })
      if (!isEmptyImpact(impact)) {
        item.impact = impact
      }
    }
  }

  if (openIssues) {
    openOrUpdateIssues(items, outFile, deps.execFileSync ?? execFileSync, warnings)
  }

  const summary = {
    break: items.filter(i => i.severity === 'break').length,
    soon: items.filter(i => i.severity === 'soon').length,
    added: items.filter(i => i.severity === 'added').length,
    info: items.filter(i => i.severity === 'info').length,
    unchanged: unchangedCount,
    skipped: skippedCount,
  }

  const report: WatchReport = {
    format: 'aegi-api-watch/v1',
    checked_at: checkedAt,
    summary,
    sources: reportSources,
    items,
    warnings,
  }

  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8')

  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n', 'utf8')

  console.log(
    `api-watch: 깨짐 ${summary.break}, 곧 깨짐 ${summary.soon}, 추가 ${summary.added}, 안 바뀜 ${summary.unchanged}, 건너뜀 ${summary.skipped}`,
  )
  for (const item of items) {
    if (item.severity !== 'break' && item.severity !== 'soon') continue
    const label = item.severity === 'break' ? '깨짐' : '곧 깨짐'
    console.log(`${label} ${item.source} ${item.op} ${item.kind}${item.field ? ' ' + item.field : ''}`)
  }

  if (failOnBreak && summary.break > 0) return 2
  return 0
}

async function runRefreshLatest(argv: string[], deps: WatchDeps): Promise<number> {
  const selectedSources: string[] = []
  let offlineDir: string | null = null

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--source') {
      const val = argv[++i]
      if (!val || val.startsWith('--')) {
        console.error('--source 값이 필요하다.')
        return 1
      }
      for (const part of val.split(',')) {
        if (part.trim()) selectedSources.push(part.trim())
      }
      continue
    }
    if (arg === '--offline-latest') {
      const val = argv[++i]
      if (!val || val.startsWith('--')) {
        console.error('--offline-latest 값이 필요하다.')
        return 1
      }
      offlineDir = path.resolve(ROOT, val)
      continue
    }
    console.error('인자가 잘못되었다. --help 로 사용법을 확인한다.')
    return 1
  }

  const now = (deps.now ?? (() => new Date()))()
  const fetchedAt = now.toISOString()
  const latestDir = deps.latestDir ?? DEFAULT_LATEST_DIR
  const fetchFn = deps.fetch ?? globalThis.fetch
  const sleepFn = deps.sleepMs ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const allSources = deps.sources ?? loadSources()
  const targetSources = allSources.filter(s => {
    if (selectedSources.length > 0 && !selectedSources.includes(s.id)) return false
    return s.watch === 'repo' || s.watch === 'spec_url' || s.watch === 'doc_page'
  })

  const apiList = deps.apiList ?? loadApiList()
  const usedGraphqlFields = deps.usedGraphqlFields ?? extractUsedGraphqlFields()
  let updated = 0
  let failed = 0

  for (const src of targetSources) {
    try {
      if (src.watch === 'doc_page') {
        const sourceOps = apiList.filter(
          e => (e.status === 'approved' || e.status === 'legacy') && e.source === src.id,
        )
        const pages = new Map<string, string>()
        const methods = sourceOps.map(e => opNameFromOperationId(e.operation_id))
        for (let idx = 0; idx < methods.length; idx++) {
          const methodName = methods[idx]
          let html: string | null = null
          if (offlineDir) {
            const direct = path.join(offlineDir, `reference__methods__${methodName}.html`)
            const nested = path.join(offlineDir, src.id, `reference__methods__${methodName}.html`)
            if (fs.existsSync(direct)) html = fs.readFileSync(direct, 'utf8')
            else if (fs.existsSync(nested)) html = fs.readFileSync(nested, 'utf8')
          } else {
            if (idx > 0) await sleepFn(SLACK_DOC_DELAY_MS)
            const res = await fetchFn(`https://docs.slack.dev/reference/methods/${methodName}`, {
              headers: { 'User-Agent': 'aegi-api-watch' },
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            html = await res.text()
          }
          if (html !== null) pages.set(methodName, html)
        }
        const extracted = extractSlackDocSurface(pages, sourceOps)
        const latestSurface = extracted.surface
        latestSurface.source = src.id
        writeLatestSurface(latestDir, src.id, latestSurface, fetchedAt)
        updated++
        continue
      }

      let rawSpec: string | null = null
      let commitSha: string | undefined
      if (offlineDir) {
        rawSpec = readOfflineSpec(offlineDir, src.id)
        if (rawSpec === null) {
          failed++
          continue
        }
      } else {
        if (src.watch === 'repo' && src.repo && src.path) {
          try {
            const commitUrl = `https://api.github.com/repos/${src.repo}/commits?path=${encodeURIComponent(src.path)}&per_page=1`
            const commitRes = await fetchFn(commitUrl, {
              headers: { 'User-Agent': 'aegi-api-watch', Accept: 'application/vnd.github+json' },
            })
            if (commitRes.ok) {
              const commits = (await commitRes.json()) as Array<{ sha?: string }>
              commitSha = commits?.[0]?.sha
            }
          } catch {
            // commit_sha 조회 실패해도 스펙 URL 받기는 계속한다
          }
        }
        if (!src.url) {
          console.error(`refresh-latest: ${src.id} url 없음`)
          failed++
          continue
        }
        const specRes = await fetchFn(src.url, { headers: { 'User-Agent': 'aegi-api-watch' } })
        if (!specRes.ok) {
          console.error(`refresh-latest: ${src.id} HTTP ${specRes.status}`)
          failed++
          continue
        }
        rawSpec = await specRes.text()
      }

      const parsed = parseSpecText(src.format, rawSpec)
      let latestSurface: SourceSurface
      if (src.format === 'graphql') {
        latestSurface = extractGraphqlSurface(String(parsed), usedGraphqlFields)
        latestSurface.source = src.id
      } else if (src.format === 'openapi' || src.format === 'discovery') {
        const sourceOps = apiList.filter(
          e => (e.status === 'approved' || e.status === 'legacy') && e.source === src.id,
        )
        const extracted = extractSurface(src.format, parsed, sourceOps)
        latestSurface = extracted.surface
        latestSurface.source = src.id
      } else {
        continue
      }

      writeLatestSurface(latestDir, src.id, latestSurface, fetchedAt, commitSha)
      updated++
    } catch (err) {
      console.error(`refresh-latest: ${src.id} 실패 (${err instanceof Error ? err.message : String(err)})`)
      failed++
    }
  }

  console.log(`refresh-latest: 갱신 ${updated}, 실패 ${failed}`)
  return 0
}

function isLatestStaleOrMissing(latestDir: string, now: Date): boolean {
  if (!fs.existsSync(latestDir)) return true
  let files: string[]
  try {
    files = fs.readdirSync(latestDir).filter(f => f.endsWith('.json'))
  } catch {
    return true
  }
  if (files.length === 0) return true
  for (const f of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(latestDir, f), 'utf8')) as { fetched_at?: unknown }
      const ms = typeof parsed.fetched_at === 'string' ? Date.parse(parsed.fetched_at) : NaN
      if (!Number.isFinite(ms) || now.getTime() - ms > LATEST_MAX_AGE_MS) {
        return true
      }
    } catch {
      return true
    }
  }
  return false
}

function runDiffItemIssueKey(item: RunDiffItem): string {
  return `${item.kind} ${item.call_id ?? item.profile ?? ''} ${item.field ?? ''}`.trim()
}

function formatRunDiffIssuesTable(items: RunDiffItem[]): string {
  const lines = [
    '| 심각도 | kind | call_id | profile | field | 스펙 판정 | 영향 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const item of items) {
    const cells = [
      item.severity,
      item.kind,
      item.call_id || '-',
      item.profile || '-',
      item.field || '-',
      item.spec?.status || '-',
      formatImpactCell(item.impact),
    ].map(c => c.replace(/\|/g, '\\|').replace(/\r?\n/g, ' '))
    lines.push(`| ${cells.join(' | ')} |`)
  }
  lines.push('')
  lines.push('<!-- 항목 키:')
  for (const item of items) {
    lines.push(runDiffItemIssueKey(item))
  }
  lines.push('-->')
  return lines.join('\n')
}

async function runAfterCollect(argv: string[], deps: WatchDeps): Promise<number> {
  const valueFlags = new Set(['--current', '--norm-current', '--norm-previous', '--root'])
  const args = new Map<string, string>()
  let openIssues = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--open-issues') {
      openIssues = true
      continue
    }
    if (!valueFlags.has(arg) || args.has(arg) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      console.error('인자가 잘못되었다. --help 로 사용법을 확인한다.')
      return 1
    }
    args.set(arg, argv[++i])
  }

  const currentId = args.get('--current')
  if (!currentId) {
    console.error('--current <run_id> 가 필요하다.')
    return 1
  }

  const now = (deps.now ?? (() => new Date()))()
  const latestDir = deps.latestDir ?? DEFAULT_LATEST_DIR
  if (isLatestStaleOrMissing(latestDir, now)) {
    await runRefreshLatest([], deps)
  }

  const outDir = deps.afterCollectOutDir ?? path.join(ROOT, 'collected/api-watch')
  const outFile = path.join(outDir, `run-diff-${currentId}.json`)
  const diffArgv = ['--current', currentId, '--spec-dir', latestDir, '--out', outFile]
  const rootOpt = args.get('--root') ?? deps.rootDir
  if (rootOpt) diffArgv.push('--root', rootOpt)
  if (args.has('--norm-current')) diffArgv.push('--norm-current', args.get('--norm-current')!)
  if (args.has('--norm-previous')) diffArgv.push('--norm-previous', args.get('--norm-previous')!)

  const exitCode = runDiffMain(diffArgv)

  if (openIssues && fs.existsSync(outFile)) {
    try {
      const report = JSON.parse(fs.readFileSync(outFile, 'utf8')) as RunDiffReport
      const breaks = report.items.filter(i => i.severity === 'break')
      if (breaks.length > 0) {
        const byProvider = new Map<string, RunDiffItem[]>()
        for (const item of breaks) {
          const prov = item.provider ?? 'unknown'
          const list = byProvider.get(prov) ?? []
          list.push(item)
          byProvider.set(prov, list)
        }
        const execFn = deps.execFileSync ?? execFileSync
        const issueWarnings: string[] = []
        const reportName = path.basename(outFile)
        for (const [provider, provItems] of byProvider) {
          const title = `수집 run 깨짐: ${provider}`
          const keys = provItems.map(runDiffItemIssueKey)
          upsertGitHubIssue(
            title,
            'bug',
            keys,
            selected => formatRunDiffIssuesTable(provItems.filter(it => selected.has(runDiffItemIssueKey(it)))),
            [`보고서: \`${reportName}\``],
            execFn,
            issueWarnings,
            provider,
          )
        }
        for (const w of issueWarnings) console.error(w)
      }
    } catch (err) {
      console.error(`after-collect 이슈 알림 실패: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return exitCode
}

const PINNED_CODE_LOCATIONS: Record<string, string> = {
  github_api_versions: 'scripts/collect/lib/auth.ts:44,54',
  salesforce_api_versions:
    'scripts/collect/providers/salesforce.ts:49; scripts/collect/providers/apiList.ts:176,228; scripts/collect/collector.config.json:126',
  jira_openapi_v3: 'scripts/collect/providers/atlassian.ts:178',
  confluence_openapi_v1: 'scripts/collect/providers/atlassian.ts:233,240',
  confluence_openapi_v2: 'scripts/collect/providers/atlassian.ts:226,229',
  gws_calendar: 'scripts/collect/providers/gws.ts:330',
  gws_drive: 'scripts/collect/providers/gws.ts:171,179,307,311',
  gws_directory: 'scripts/collect/providers/gws.ts:51',
  gws_cloudidentity: 'scripts/collect/providers/gws.ts:52',
  gws_gmail: 'scripts/collect/providers/gws.ts:260',
  gws_groupssettings: 'scripts/collect/providers/gws.ts:323',
  gws_script: 'scripts/collect/providers/gws.ts:192',
}

function readLatestVersion(latestDir: string, id: string): string | undefined {
  const file = path.join(latestDir, `${id}.json`)
  if (!fs.existsSync(file)) return undefined
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : undefined
  } catch {
    return undefined
  }
}

export interface VersionRow {
  id: string
  pinned: string
  codeLocation: string
  latest: string
  sunset: string
}

function readStateFile(stateFile: string): Record<string, WatchStateEntry> {
  if (!fs.existsSync(stateFile)) return {}
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, WatchStateEntry>
  } catch {
    return {}
  }
}

export function collectVersionRows(deps: WatchDeps = {}, stateFile = DEFAULT_STATE_FILE): VersionRow[] {
  const loaded = loadSourcesFile()
  const sources = deps.sources ?? loaded.sources
  const live = deps.live ?? loaded.live
  const latestDir = deps.latestDir ?? DEFAULT_LATEST_DIR
  const cfg =
    deps.collectorConfig !== undefined
      ? deps.collectorConfig
      : fs.existsSync(DEFAULT_COLLECTOR_CONFIG)
        ? loadConfig(DEFAULT_COLLECTOR_CONFIG)
        : null
  const state = readStateFile(stateFile)
  const rows: VersionRow[] = []

  for (const s of sources) {
    if (!s.pinned && !s.sunset) continue
    const latest = readLatestVersion(latestDir, s.id) ?? state[s.id]?.version ?? '-'
    rows.push({
      id: s.id,
      pinned: s.pinned ?? '-',
      codeLocation: PINNED_CODE_LOCATIONS[s.id] ?? '-',
      latest,
      sunset: s.sunset ?? '-',
    })
  }

  for (const lv of live) {
    let pinned = lv.pinned ?? ''
    if (!pinned && lv.pinned_from_config === 'salesforce.apiVersion') {
      pinned = cfg?.salesforce?.apiVersion?.trim() ?? ''
    }
    const latest = readLatestVersion(latestDir, lv.id) ?? state[lv.id]?.version ?? '-'
    rows.push({
      id: lv.id,
      pinned: pinned || '-',
      codeLocation: PINNED_CODE_LOCATIONS[lv.id] ?? '-',
      latest,
      sunset: '-',
    })
  }

  return rows
}

function runVersions(argv: string[], deps: WatchDeps): number {
  let stateFile = DEFAULT_STATE_FILE
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--state' && argv[i + 1]) {
      stateFile = path.resolve(argv[++i])
    } else {
      console.error(`알 수 없는 인자: ${argv[i]}`)
      return 1
    }
  }
  const rows = collectVersionRows(deps, stateFile)
  console.log('| 출처 / live id | 고정 값 | 코드에서 쓰는 곳 | 최신 사용 가능 | 지원 종료일 |')
  console.log('| --- | --- | --- | --- | --- |')
  for (const r of rows) {
    console.log(`| ${r.id} | ${r.pinned} | ${r.codeLocation} | ${r.latest} | ${r.sunset} |`)
  }
  return 0
}

export async function main(argv = process.argv.slice(2), deps: WatchDeps = {}): Promise<number> {
  if (argv.length === 0 || argv.includes('--help')) {
    console.log(
      'api-watch baseline --source <id> --file <스펙 파일 또는 폴더 경로> [--out <file>]\n' +
        'api-watch check [--source <id>...] [--force] [--no-changelog] [--no-live] [--open-issues] [--state <file>] [--out <file>] [--fail-on-break] [--offline-latest <dir>]\n' +
        'api-watch refresh-latest [--source <id>...]\n' +
        'api-watch after-collect --current <run_id> [--norm-current <dir>] [--norm-previous <dir>] [--open-issues]\n' +
        'api-watch versions [--state <file>]\n' +
        'api-watch fixtures --run <run_id> [--root collected] [--out scripts/collect/apiWatch/fixtures] [--per-op 2]',
    )
    return 0
  }

  const [sub, ...rest] = argv
  if (sub === 'baseline') return runBaseline(rest, deps)
  if (sub === 'check') return runCheck(rest, deps)
  if (sub === 'refresh-latest') return runRefreshLatest(rest, deps)
  if (sub === 'after-collect') return runAfterCollect(rest, deps)
  if (sub === 'versions') return runVersions(rest, deps)
  if (sub === 'fixtures') return runFixtures(rest, deps)

  console.error(`알 수 없는 하위 명령: ${sub}`)
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => {
    process.exitCode = code
  })
}
