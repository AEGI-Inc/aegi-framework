/**
 * 고정 예시(fixtures) 생성 및 비식별 처리.
 * 원본 수집 페이지에서 approved/legacy operation 마다 레코드를 뽑아 비식별 JSON 으로 저장한다.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ApiListEntry } from '../api-list/build'
import { loadApiList } from '../providers/apiList'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const NORMALIZE_MJS = path.join(ROOT, 'scripts/collect/profile-binding/runner/normalize.mjs')
export const DEFAULT_FIXTURES_DIR = path.join(HERE, 'fixtures')

export interface FixtureFile {
  operation_id: string
  call_id: string
  provider: string
  profiles: string[]
  envelope: Record<string, unknown>
}

export interface ExpectedProfileResult {
  objects: number
  fields_with_value: string[]
}

export interface ExpectedOperationResult {
  profiles: Record<string, ExpectedProfileResult>
}

export type ExpectedSnapshot = Record<string, ExpectedOperationResult>

export interface Deidentifier {
  deidentifyValue: (val: unknown) => unknown
  deidentifyEndpoint: (rawUrl: string, fixedSegments?: Set<string>) => string
  originalStrings: Set<string>
  keptStructuralValues: Set<string>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE = /^https?:\/\/\S+$/i
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SHORT_CODE_RE = /^[A-Z0-9]{1,3}$/
const BOOL_NULL_STR_RE = /^(?:true|false|null)$/i
const NUMERIC_STR_RE = /^-?\d+(?:\.\d+)?$/
const API_VOCAB_SEGMENT_RE = /^[a-z0-9._-]+$/

export function extractFixedPathSegments(pathTemplate?: string): Set<string> | undefined {
  if (!pathTemplate) return undefined
  const segs = pathTemplate
    .split('/')
    .filter(s => s.length > 0 && !s.includes('{') && !s.includes('}'))
  return new Set(segs)
}

export function createDeidentifier(
  keepValues: Set<string> = new Set(),
  fixedPathSegments?: Set<string>,
): Deidentifier {
  const stringMap = new Map<string, string>()
  const numberMap = new Map<string, number>()
  const originalStrings = new Set<string>()
  const keptStructuralValues = new Set<string>()
  const counters = { email: 0, url: 0, date: 0, str: 0, num: 0 }

  function mapString(val: string): string {
    if (keepValues.has(val) || SHORT_CODE_RE.test(val) || BOOL_NULL_STR_RE.test(val)) {
      return val
    }
    const existing = stringMap.get(val)
    if (existing !== undefined) return existing

    if (val.length >= 4) originalStrings.add(val)

    let fake: string
    if (EMAIL_RE.test(val)) {
      counters.email++
      fake = `user-${counters.email}@example.test`
    } else if (URL_RE.test(val)) {
      counters.url++
      fake = `https://example.test/${counters.url}`
    } else if (ISO_DATETIME_RE.test(val)) {
      counters.date++
      const day = String(((counters.date - 1) % 28) + 1).padStart(2, '0')
      fake = `2026-01-${day}T00:00:00Z`
    } else if (ISO_DATE_RE.test(val)) {
      counters.date++
      const day = String(((counters.date - 1) % 28) + 1).padStart(2, '0')
      fake = `2026-01-${day}`
    } else {
      counters.str++
      fake = `str-${counters.str}`
    }
    stringMap.set(val, fake)
    return fake
  }

  function mapNumber(val: number): number {
    if (!Number.isFinite(val)) return 0
    const isInt = Number.isInteger(val)
    const key = `${isInt ? 'i' : 'f'}:${val}`
    const existing = numberMap.get(key)
    if (existing !== undefined) return existing

    counters.num++
    const sign = val < 0 ? -1 : 1
    const fake = isInt ? sign * counters.num : sign * (counters.num + 0.5)
    numberMap.set(key, fake)
    return fake
  }

  function isFixedSegment(decoded: string, activeFixedSegments?: Set<string>): boolean {
    if (activeFixedSegments !== undefined) {
      return activeFixedSegments.has(decoded)
    }
    if (/^\d{4,}$/.test(decoded) || /^[0-9a-f]{8,}$/i.test(decoded)) {
      return false
    }
    return API_VOCAB_SEGMENT_RE.test(decoded)
  }

  function deidentifyEndpoint(rawUrl: string, fixedSegmentsOverride?: Set<string>): string {
    const activeFixed = fixedSegmentsOverride ?? fixedPathSegments
    const isRelative = rawUrl.startsWith('/')
    try {
      const u = isRelative ? new URL(rawUrl, 'https://example.test') : new URL(rawUrl)
      if (!isRelative && u.hostname && u.hostname !== 'example.test' && u.hostname.length >= 4) {
        originalStrings.add(u.hostname)
      }
      u.protocol = 'https:'
      u.hostname = 'example.test'
      u.port = ''
      const segments = u.pathname.split('/').map(seg => {
        if (!seg) return seg
        let decoded = seg
        try {
          decoded = decodeURIComponent(seg)
        } catch {
          // 잘못된 퍼센트 인코딩은 원문 그대로 처리한다
        }
        if (isFixedSegment(decoded, activeFixed)) {
          return seg
        }
        const fake = mapString(decoded)
        return encodeURIComponent(fake)
      })
      u.pathname = segments.join('/')
      for (const [k, v] of [...u.searchParams.entries()]) {
        if (NUMERIC_STR_RE.test(v) && Number.isFinite(Number(v))) {
          u.searchParams.set(k, String(mapNumber(Number(v))))
        } else {
          u.searchParams.set(k, mapString(v))
        }
      }
      return isRelative ? `${u.pathname}${u.search}${u.hash}` : u.toString()
    } catch {
      return mapString(rawUrl)
    }
  }

  function deidentifyValueInner(val: unknown, parentKey?: string): unknown {
    if (val === null || val === undefined || typeof val === 'boolean') return val
    if (typeof val === 'string') return mapString(val)
    if (typeof val === 'number') return mapNumber(val)
    if (Array.isArray(val)) return val.map(item => deidentifyValueInner(item))
    if (typeof val === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (parentKey === 'attributes' && k === 'type' && typeof v === 'string') {
          out[k] = v
          keptStructuralValues.add(v)
        } else if (parentKey === 'attributes' && k === 'url' && typeof v === 'string') {
          out[k] = deidentifyEndpoint(v)
        } else {
          out[k] = deidentifyValueInner(v, k)
        }
      }
      return out
    }
    return val
  }

  function deidentifyValue(val: unknown): unknown {
    return deidentifyValueInner(val)
  }

  return { deidentifyValue, deidentifyEndpoint, originalStrings, keptStructuralValues }
}

function collectObjectKeys(val: unknown, out: Set<string>): void {
  if (!val || typeof val !== 'object') return
  if (Array.isArray(val)) {
    for (const item of val) collectObjectKeys(item, out)
    return
  }
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    out.add(k)
    collectObjectKeys(v, out)
  }
}

export function findLeakedOriginalStrings(
  originalStrings: Set<string>,
  outputText: string,
  structuralValues: Set<string> = new Set(),
): string[] {
  const leaked: string[] = []
  for (const s of originalStrings) {
    if (s.length <= 3 || structuralValues.has(s)) continue
    const encoded = encodeURIComponent(s)
    if (outputText.includes(s) || (encoded !== s && outputText.includes(encoded))) {
      leaked.push(s)
    }
  }
  return leaked
}

export function summarizeLeakedKinds(leaked: string[]): { email: number; url: number; other: number } {
  const counts = { email: 0, url: 0, other: 0 }
  for (const s of leaked) {
    if (EMAIL_RE.test(s)) counts.email++
    else if (URL_RE.test(s)) counts.url++
    else counts.other++
  }
  return counts
}

function slicePayloadRecords(payload: unknown, perOp: number, itemsPath?: string): unknown {
  if (Array.isArray(payload)) return payload.slice(0, perOp)
  if (!payload || typeof payload !== 'object') return payload
  const obj = payload as Record<string, unknown>
  if (itemsPath && Array.isArray(obj[itemsPath])) {
    return { ...obj, [itemsPath]: (obj[itemsPath] as unknown[]).slice(0, perOp) }
  }
  for (const key of ['records', 'items', 'data', 'results', 'value', 'users', 'groups']) {
    if (Array.isArray(obj[key])) {
      return { ...obj, [key]: (obj[key] as unknown[]).slice(0, perOp) }
    }
  }
  return payload
}

export function buildDeidentifiedFixture(
  entry: ApiListEntry,
  envelope: Record<string, unknown>,
  perOp: number,
  keepValues: Set<string>,
): { fixture: FixtureFile; text: string; leaked: string[] } {
  const fixedPathSegments = extractFixedPathSegments(entry.path_template)
  const deid = createDeidentifier(keepValues, fixedPathSegments)
  const cloned: Record<string, unknown> = { ...envelope }

  if ('payload' in cloned) {
    const sliced = slicePayloadRecords(cloned.payload, perOp, entry.items)
    cloned.payload = deid.deidentifyValue(sliced)
  }
  if (cloned.request_params && typeof cloned.request_params === 'object') {
    cloned.request_params = deid.deidentifyValue(cloned.request_params)
  }
  if (cloned.params && typeof cloned.params === 'object') {
    cloned.params = deid.deidentifyValue(cloned.params)
  }
  if (typeof cloned.endpoint === 'string') {
    cloned.endpoint = deid.deidentifyEndpoint(cloned.endpoint)
  }
  if (typeof cloned.url === 'string') {
    cloned.url = deid.deidentifyEndpoint(cloned.url)
  }

  const fixture: FixtureFile = {
    operation_id: entry.operation_id,
    call_id: String(cloned.call_id ?? entry.id),
    provider: String(cloned.provider ?? entry.provider),
    profiles: entry.profiles ?? [],
    envelope: cloned,
  }
  const text = JSON.stringify(fixture, null, 2) + '\n'

  const structuralValues = new Set<string>(keepValues)
  collectObjectKeys(fixture, structuralValues)
  structuralValues.add(fixture.operation_id)
  structuralValues.add(fixture.call_id)
  structuralValues.add(fixture.provider)
  if (fixedPathSegments) {
    for (const seg of fixedPathSegments) structuralValues.add(seg)
  }
  for (const v of deid.keptStructuralValues) structuralValues.add(v)

  const leaked = findLeakedOriginalStrings(deid.originalStrings, text, structuralValues)
  return { fixture, text, leaked }
}

export function collectFixtureFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFixtureFiles(full))
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.json') &&
      entry.name !== 'keep-values.json' &&
      entry.name !== 'expected.json'
    ) {
      files.push(full)
    }
  }
  return files.sort()
}

export function computeExpectedFromFixtures(fixturesDir: string): ExpectedSnapshot {
  const fixturePaths = collectFixtureFiles(fixturesDir)
  if (fixturePaths.length === 0) return {}

  const fixtures = fixturePaths.map(p => JSON.parse(fs.readFileSync(p, 'utf8')) as FixtureFile)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-fixtures-norm-'))
  try {
    const rawDir = path.join(tmp, 'raw')
    const outDir = path.join(tmp, 'dataset')
    const modelDir = path.join(tmp, 'model')
    const runId = 'fixtures-run'

    const write = (file: string, val: unknown) => {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, typeof val === 'string' ? val : JSON.stringify(val))
    }

    write(path.join(modelDir, 'FREEZE.json'), { version: 'test-v3.2' })
    write(path.join(modelDir, 'objects/object-types.jsonl'), '')
    write(path.join(modelDir, 'relations/vocabulary.json'), { relation_types: [] })
    write(path.join(modelDir, 'relations/relation-bindings.jsonl'), '')
    write(path.join(modelDir, 'evidence/observation-operation-links.jsonl'), '')

    const calls = fixtures.map((f, idx) => {
      write(path.join(rawDir, 'raw', runId, f.provider, `fixture-${idx}.json`), f.envelope)
      return {
        provider: f.provider,
        call_id: f.call_id,
        completeness: 'full',
        pages: 1,
      }
    })

    write(path.join(rawDir, 'runs', `${runId}.json`), {
      run_id: runId,
      started_at: '2026-01-01T00:00:00Z',
      finished_at: '2026-01-01T00:01:00Z',
      calls,
    })

    execFileSync(process.execPath, [NORMALIZE_MJS, '--raw', rawDir, '--run', runId, '--out', outDir, '--model', modelDir], {
      encoding: 'utf8',
    })

    const objects = JSON.parse(fs.readFileSync(path.join(outDir, 'objects.json'), 'utf8')) as Array<{
      canonical: {
        properties: Record<string, unknown>
        source?: { observations?: Array<{ params?: { call_id?: string } }> }
      }
      fixture_meta?: { im_profile?: { files?: string[] } }
    }>

    const result: ExpectedSnapshot = {}
    for (const f of [...fixtures].sort((a, b) => a.operation_id.localeCompare(b.operation_id))) {
      const profiles: Record<string, ExpectedProfileResult> = {}
      for (const profRel of [...f.profiles].sort()) {
        const matched = objects.filter(o => {
          const hasCall = o.canonical.source?.observations?.some(obs => obs.params?.call_id === f.call_id)
          const hasProf = o.fixture_meta?.im_profile?.files?.includes(profRel)
          return Boolean(hasCall && hasProf)
        })
        const fieldsSet = new Set<string>()
        for (const obj of matched) {
          for (const [k, v] of Object.entries(obj.canonical.properties ?? {})) {
            if (v !== undefined && v !== null) fieldsSet.add(k)
          }
        }
        profiles[profRel] = {
          objects: matched.length,
          fields_with_value: [...fieldsSet].sort(),
        }
      }
      result[f.operation_id] = { profiles }
    }
    return result
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

export function compareExpected(
  expected: ExpectedSnapshot,
  actual: ExpectedSnapshot,
): { failures: string[]; diagnostics: string[] } {
  const failures: string[] = []
  const diagnostics: string[] = []

  for (const [opId, expOp] of Object.entries(expected)) {
    for (const [prof, expProf] of Object.entries(expOp.profiles ?? {})) {
      const actProf = actual[opId]?.profiles?.[prof] ?? { objects: 0, fields_with_value: [] }
      if (actProf.objects < expProf.objects) {
        failures.push(
          `객체 수 감소: operation=${opId}, profile=${prof}, ${expProf.objects} → ${actProf.objects}`,
        )
      } else if (actProf.objects > expProf.objects) {
        diagnostics.push(
          `객체 수 증가: operation=${opId}, profile=${prof}, ${expProf.objects} → ${actProf.objects}`,
        )
      }

      const actualFields = new Set(actProf.fields_with_value)
      const expectedFields = new Set(expProf.fields_with_value)
      const missingFields = expProf.fields_with_value.filter(f => !actualFields.has(f))
      if (missingFields.length > 0) {
        failures.push(
          `빠진 필드: operation=${opId}, profile=${prof}, 빠진 필드=[${missingFields.join(', ')}]`,
        )
      }
      const addedFields = actProf.fields_with_value.filter(f => !expectedFields.has(f))
      if (addedFields.length > 0) {
        diagnostics.push(
          `늘어난 필드: operation=${opId}, profile=${prof}, 추가=[${addedFields.join(', ')}]`,
        )
      }
    }
  }

  for (const [opId, actOp] of Object.entries(actual)) {
    for (const [prof, actProf] of Object.entries(actOp.profiles ?? {})) {
      if (!expected[opId]?.profiles?.[prof] && (actProf.objects > 0 || actProf.fields_with_value.length > 0)) {
        diagnostics.push(
          `새 기대 결과: operation=${opId}, profile=${prof}, objects=${actProf.objects}, fields=${actProf.fields_with_value.length}`,
        )
      }
    }
  }

  return { failures, diagnostics }
}

export function loadKeepValues(fixturesDir: string): Set<string> {
  const file = path.join(fixturesDir, 'keep-values.json')
  if (!fs.existsSync(file)) return new Set()
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(raw)) return new Set()
  return new Set(raw.filter((v): v is string => typeof v === 'string'))
}

function opShortName(entry: ApiListEntry): string {
  const prefix = `op:${entry.source}:`
  const raw = entry.operation_id.startsWith(prefix) ? entry.operation_id.slice(prefix.length) : entry.operation_id
  return raw.replace(/[/:]/g, '_')
}

function readRawPagesForRun(rawRunDir: string): Record<string, unknown>[] {
  if (!fs.existsSync(rawRunDir)) return []
  const pages: Record<string, unknown>[] = []
  for (const entry of fs.readdirSync(rawRunDir, { withFileTypes: true })) {
    const full = path.join(rawRunDir, entry.name)
    if (entry.isDirectory()) {
      pages.push(...readRawPagesForRun(full))
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      try {
        const parsed = JSON.parse(fs.readFileSync(full, 'utf8'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          pages.push(parsed as Record<string, unknown>)
        }
      } catch {
        // 손상된 페이지 파일은 건너뛴다
      }
    }
  }
  return pages
}

export interface FixturesDeps {
  apiList?: ApiListEntry[]
}

export async function runFixtures(argv: string[], deps: FixturesDeps = {}): Promise<number> {
  let runId = ''
  let rootOpt = 'collected'
  let outOpt = DEFAULT_FIXTURES_DIR
  let perOp = 2

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      console.error(`인자 값이 빠졌다: ${arg}`)
      return 1
    }
    if (arg === '--run') runId = next
    else if (arg === '--root') rootOpt = next
    else if (arg === '--out') outOpt = next
    else if (arg === '--per-op') {
      const n = Number(next)
      if (!Number.isInteger(n) || n <= 0) {
        console.error('--per-op 는 양의 정수여야 한다.')
        return 1
      }
      perOp = n
    } else {
      console.error(`알 수 없는 인자: ${arg}`)
      return 1
    }
    i++
  }

  if (!runId) {
    console.error('--run <run_id> 가 필요하다.')
    return 1
  }

  const rootDir = path.resolve(ROOT, rootOpt)
  const outDir = path.resolve(ROOT, outOpt)
  const rawRunDir = path.join(rootDir, 'raw', runId)
  if (!fs.existsSync(rawRunDir)) {
    console.error(`원본 폴더가 없다: ${rawRunDir}`)
    return 1
  }

  fs.mkdirSync(outDir, { recursive: true })
  const keepFile = path.join(outDir, 'keep-values.json')
  if (!fs.existsSync(keepFile)) {
    fs.writeFileSync(keepFile, '[]\n')
  }
  const keepValues = loadKeepValues(outDir)

  const apiList = (deps.apiList ?? loadApiList()).filter(
    e => e.status === 'approved' || e.status === 'legacy',
  )
  const byCallId = new Map<string, ApiListEntry>()
  for (const e of apiList) {
    if (!byCallId.has(e.id)) byCallId.set(e.id, e)
  }

  const pages = readRawPagesForRun(rawRunDir)
  const seenOps = new Set<string>()
  let written = 0
  let skippedLeak = 0

  for (const page of pages) {
    const callId = typeof page.call_id === 'string' ? page.call_id : ''
    if (!callId) continue
    const entry = byCallId.get(callId)
    if (!entry || seenOps.has(entry.operation_id)) continue
    seenOps.add(entry.operation_id)

    const { fixture, text, leaked } = buildDeidentifiedFixture(entry, page, perOp, keepValues)
    if (leaked.length > 0) {
      const kinds = summarizeLeakedKinds(leaked)
      const parts: string[] = []
      if (kinds.email > 0) parts.push(`이메일 ${kinds.email}`)
      if (kinds.url > 0) parts.push(`URL ${kinds.url}`)
      if (kinds.other > 0) parts.push(`기타 ${kinds.other}`)
      console.warn(
        `fixtures 경고: 비식별 검사 실패로 쓰지 않음 (${entry.operation_id}): 남은 원래 값 ${leaked.length}개 (${parts.join(', ')})`,
      )
      skippedLeak++
      continue
    }

    const dest = path.join(outDir, fixture.provider, `${opShortName(entry)}.json`)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, text)
    written++
  }

  const expected = computeExpectedFromFixtures(outDir)
  fs.writeFileSync(path.join(outDir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n')

  console.log(`fixtures: 생성 ${written}, 비식별 경고 건너뜀 ${skippedLeak}`)
  return 0
}
