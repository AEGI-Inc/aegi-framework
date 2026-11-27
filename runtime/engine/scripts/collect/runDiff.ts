/**
 * 수집 run 간 API 응답 비교: 상태 변화, 응답 필드/타입 변화, 정규화 수 급감을 분류한다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import type { ApiListEntry } from './api-list/build'
import { impactOfOperation, impactOfProfile, isEmptyImpact, type Impact } from './apiWatch/impact'
import type { SourceSurface } from './apiWatch/surface'
import type { CallRecord, Envelope } from './lib/store'
import { loadApiList } from './providers/apiList'
import { loadRawRun, STREAM_CALLS, type RawRun } from './shared/raw'

export interface NormCounts {
  objects?: number
  relations?: number
}

export type DiffSeverity = 'break' | 'regression' | 'warning' | 'info' | 'added'
export type DiffKind =
  | 'status_change'
  | 'still_failing'
  | 'recovered'
  | 'call_removed'
  | 'call_added'
  | 'records_dropped_to_zero'
  | 'field_removed'
  | 'field_type_changed'
  | 'field_added'
  | 'normalize_drop'
  | 'field_coverage_drop'
  | 'field_value_type_changed'
  | 'api_warning_new'

export type SpecMatchStatus = 'op_missing' | 'field_missing' | 'present' | 'unknown'

export interface SpecVerdict {
  status: SpecMatchStatus
  source: string
  checked_at: string
}

export interface LatestSurfaceFile extends SourceSurface {
  fetched_at?: string
  commit_sha?: string
}

export interface FieldDeclaration {
  name: string
  required?: boolean
  scalar?: string
  path?: string
}

export interface RunDiffItem {
  severity: DiffSeverity
  kind: DiffKind
  provider?: string
  call_id?: string
  operation_id?: string
  previous?: { completeness?: string; http_status?: number; record_count?: number; cause?: string }
  current?: { completeness?: string; http_status?: number; record_count?: number; cause?: string }
  field?: string
  previous_types?: string[]
  current_types?: string[]
  profile_fields?: Array<{ profile: string; path: string }>
  profile?: string
  previous_coverage?: { objects: number; with_value: number }
  current_coverage?: { objects: number; with_value: number }
  declaration?: { required?: boolean; scalar?: string }
  truncated?: boolean
  spec?: SpecVerdict
  impact?: Impact
}

export interface RunDiffReport {
  format: 'aegi-collect-run-diff/v1'
  previous_run: string
  current_run: string
  summary: { break: number; regression: number; warning: number; still_failing: number; recovered: number; added: number }
  items: RunDiffItem[]
  warnings: string[]
}

const MAX_SHAPE_DEPTH = 8
const MAX_SHAPE_PATHS = 5000
const MIN_COVERAGE_OBJECTS = 3
const MIN_PREV_COVERAGE_RATE = 0.5
const COVERAGE_DROP_RATIO = 0.5
const SEVERITY_ORDER: Record<DiffSeverity, number> = { break: 0, regression: 1, warning: 2, info: 3, added: 4 }

const keyOf = (provider: string, callId: string) => `${provider}|${callId}`

function isCallOk(call: CallRecord): boolean {
  return (call.completeness === 'full' || call.completeness === 'best_effort') && (call.http_status === undefined || call.http_status < 400)
}

function classifyBadCause(call: CallRecord): string {
  const s = call.http_status
  if (s === 404 || s === 410) return 'api_change_suspected'
  if (s === 401 || s === 403) return 'permission'
  if (s !== undefined && s >= 400 && s < 600) return 'http_error'
  if (call.completeness === 'skipped' && s === undefined) return 'skipped'
  return 'other'
}

function callSnapshot(call: CallRecord, cause?: string): RunDiffItem['previous'] {
  return {
    completeness: call.completeness,
    ...(call.http_status !== undefined ? { http_status: call.http_status } : {}),
    record_count: call.record_count,
    ...(cause ? { cause } : {}),
  }
}

function normalizeKey(k: string): string {
  return /^\d+$/.test(k) || k.length > 64 ? '{key}' : k
}

function valueType(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'object') return 'object'
  if (typeof v === 'string') return 'string'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  return typeof v
}

function collectCallShape(pages: Envelope[]): { paths: Map<string, Set<string>>; truncated: boolean } {
  const paths = new Map<string, Set<string>>()
  let truncated = false

  const addType = (fieldPath: string, typeName: string): boolean => {
    const existing = paths.get(fieldPath)
    if (existing) {
      existing.add(typeName)
      return true
    }
    if (paths.size >= MAX_SHAPE_PATHS) {
      truncated = true
      return false
    }
    paths.set(fieldPath, new Set([typeName]))
    return true
  }

  const walk = (value: unknown, prefix: string, depth: number): void => {
    if (truncated) return
    const t = valueType(value)
    if (prefix && !addType(prefix, t)) return
    if (depth >= MAX_SHAPE_DEPTH) return

    if (t === 'array') {
      const elemPrefix = prefix ? `${prefix}[]` : '[]'
      for (const item of value as unknown[]) {
        if (truncated) break
        if (item === null || typeof item !== 'object') {
          addType(elemPrefix, valueType(item))
        } else if (Array.isArray(item)) {
          walk(item, elemPrefix, depth + 1)
        } else {
          for (const [k, v] of Object.entries(item)) {
            if (truncated) break
            walk(v, `${elemPrefix}.${normalizeKey(k)}`, depth + 1)
          }
        }
      }
    } else if (t === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (truncated) break
        const childPath = prefix ? `${prefix}.${normalizeKey(k)}` : normalizeKey(k)
        walk(v, childPath, depth + 1)
      }
    }
  }

  for (const page of pages) {
    if (truncated) break
    walk(page.payload, '', 0)
  }

  return { paths, truncated }
}

function matchesProfilePath(responseField: string, profilePath: string): boolean {
  const respParts = responseField.replace(/\[\]/g, '').split('.').filter(Boolean)
  const profParts = profilePath.split('.').filter(Boolean)
  if (profParts.length === 0 || respParts.length < profParts.length) return false
  const offset = respParts.length - profParts.length
  return profParts.every((p, i) => respParts[offset + i] === p)
}

function findMatchingProfileFields(
  field: string,
  entry: ApiListEntry | undefined,
  profileFieldPaths?: (profileRel: string) => string[],
): Array<{ profile: string; path: string }> {
  if (!entry?.profiles?.length || !profileFieldPaths) return []
  const matches: Array<{ profile: string; path: string }> = []
  for (const profile of entry.profiles) {
    for (const pPath of profileFieldPaths(profile)) {
      if (matchesProfilePath(field, pPath)) {
        matches.push({ profile, path: pPath })
      }
    }
  }
  return matches
}

function pagesByCall(run: RawRun): Map<string, Envelope[]> {
  const map = new Map<string, Envelope[]>()
  for (const page of run.pages) {
    const k = keyOf(page.provider, page.call_id)
    let list = map.get(k)
    if (!list) {
      list = []
      map.set(k, list)
    }
    list.push(page)
  }
  return map
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function fieldValueType(v: unknown): string {
  const t = valueType(v)
  if (t === 'object' && typeof v === 'object' && v !== null && ('$fp' in v || 'sha256' in v)) {
    return 'masked'
  }
  return t
}

export function fieldCoverage(
  objects: unknown[],
  declaredFields: (profileRel: string) => FieldDeclaration[],
): Map<string, { objects: number; fields: Map<string, { withValue: number; types: Set<string> }> }> {
  const result = new Map<string, { objects: number; fields: Map<string, { withValue: number; types: Set<string> }> }>()

  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue
    const rec = obj as {
      canonical?: { properties?: Record<string, unknown> }
      fixture_meta?: { im_profile?: { file?: unknown; files?: unknown; partial?: unknown } }
    }
    const imProfile = rec.fixture_meta?.im_profile
    if (!imProfile || typeof imProfile !== 'object') continue
    if (imProfile.partial === true) continue

    const rawFiles = Array.isArray(imProfile.files)
      ? imProfile.files
      : typeof imProfile.file === 'string'
        ? [imProfile.file]
        : []
    const files = [...new Set(rawFiles.filter((f): f is string => typeof f === 'string'))]
    const props = rec.canonical?.properties && typeof rec.canonical.properties === 'object' ? rec.canonical.properties : {}

    for (const profileRel of files) {
      const decls = declaredFields(profileRel)

      let entry = result.get(profileRel)
      if (!entry) {
        entry = { objects: 0, fields: new Map() }
        result.set(profileRel, entry)
      }
      entry.objects++

      const fieldNames = new Set<string>(decls.map(d => d.name))
      for (const key of Object.keys(props)) {
        fieldNames.add(key)
      }

      for (const fieldName of fieldNames) {
        let stat = entry.fields.get(fieldName)
        if (!stat) {
          stat = { withValue: 0, types: new Set() }
          entry.fields.set(fieldName, stat)
        }
        const val = props[fieldName]
        if (val !== undefined && val !== null) {
          stat.withValue++
          stat.types.add(fieldValueType(val))
        }
      }
    }
  }

  return result
}

export function diffFieldCoverage(
  previous: ReturnType<typeof fieldCoverage>,
  current: ReturnType<typeof fieldCoverage>,
  declaredFields: (profileRel: string) => FieldDeclaration[],
): RunDiffItem[] {
  const items: RunDiffItem[] = []

  for (const [profile, prevCov] of previous) {
    const curCov = current.get(profile)
    if (!curCov) continue

    const declByName = new Map<string, FieldDeclaration>()
    for (const decl of declaredFields(profile)) {
      declByName.set(decl.name, decl)
    }
    const fieldNames = new Set<string>([...prevCov.fields.keys(), ...curCov.fields.keys()])

    for (const fieldName of fieldNames) {
      const decl = declByName.get(fieldName)
      const prevField = prevCov.fields.get(fieldName)
      const curField = curCov.fields.get(fieldName)
      const prevWith = prevField?.withValue ?? 0
      const curWith = curField?.withValue ?? 0
      const declaration =
        decl && (decl.required !== undefined || decl.scalar !== undefined)
          ? {
              ...(decl.required !== undefined ? { required: decl.required } : {}),
              ...(decl.scalar !== undefined ? { scalar: decl.scalar } : {}),
            }
          : undefined

      if (prevCov.objects >= MIN_COVERAGE_OBJECTS && curCov.objects >= MIN_COVERAGE_OBJECTS) {
        const prevRate = prevWith / prevCov.objects
        const curRate = curWith / curCov.objects
        if (prevRate >= MIN_PREV_COVERAGE_RATE && curRate <= prevRate * COVERAGE_DROP_RATIO) {
          items.push({
            severity: curRate === 0 ? 'regression' : 'warning',
            kind: 'field_coverage_drop',
            profile,
            field: fieldName,
            previous_coverage: { objects: prevCov.objects, with_value: prevWith },
            current_coverage: { objects: curCov.objects, with_value: curWith },
            ...(declaration ? { declaration } : {}),
          })
        }
      }

      if (prevWith > 0 && curWith > 0 && prevField && curField) {
        const prevTypes = [...prevField.types].filter(t => t !== 'masked').sort()
        const curTypes = [...curField.types].filter(t => t !== 'masked').sort()
        if (prevTypes.length > 0 && curTypes.length > 0) {
          const curSet = new Set(curTypes)
          if (!prevTypes.some(t => curSet.has(t))) {
            items.push({
              severity: 'break',
              kind: 'field_value_type_changed',
              profile,
              field: fieldName,
              previous_types: prevTypes,
              current_types: curTypes,
              ...(declaration ? { declaration } : {}),
            })
          }
        }
      }
    }
  }

  return items
}

function sourceFromOpId(opId?: string): string {
  const parts = opId?.split(':') ?? []
  return parts.length >= 2 ? parts[1] : ''
}

function matchesSpecFieldPath(targetField: string, specField: string): boolean {
  if (targetField === specField) return true
  const tParts = targetField.replace(/\[\]/g, '').split('.').filter(Boolean)
  const sParts = specField.replace(/\[\]/g, '').split('.').filter(Boolean)
  if (tParts.length === 0 || sParts.length === 0) return false
  if (tParts.length >= sParts.length) {
    const off = tParts.length - sParts.length
    return sParts.every((p, i) => tParts[off + i] === p)
  }
  const off = sParts.length - tParts.length
  return tParts.every((p, i) => sParts[off + i] === p)
}

function isSpecTargetItem(item: RunDiffItem): boolean {
  if (item.kind === 'status_change' || item.kind === 'still_failing') {
    const s = item.current?.http_status
    return s === 404 || s === 405 || s === 410
  }
  return (
    item.kind === 'field_removed' ||
    item.kind === 'field_type_changed' ||
    item.kind === 'field_coverage_drop' ||
    item.kind === 'field_value_type_changed'
  )
}

function evaluateSpecForItem(
  item: RunDiffItem,
  latestSurfaces: Map<string, LatestSurfaceFile>,
  apiList: Map<string, ApiListEntry> | undefined,
  apiListValues: ApiListEntry[],
  declaredFields?: (profileRel: string) => FieldDeclaration[],
): SpecVerdict {
  if (item.kind === 'field_coverage_drop' || item.kind === 'field_value_type_changed') {
    if (!item.profile || !item.field) {
      return { status: 'unknown', source: '', checked_at: '' }
    }
    const fieldPath = declaredFields?.(item.profile).find(d => d.name === item.field)?.path
    const entries = apiListValues.filter(
      e => (e.status === 'approved' || e.status === 'legacy') && (e.profiles ?? []).includes(item.profile!),
    )
    if (entries.length === 0) {
      return { status: 'unknown', source: '', checked_at: '' }
    }

    const candidates: SpecVerdict[] = []
    for (const e of entries) {
      const latest = latestSurfaces.get(e.source)
      if (!latest) continue
      const checkedAt = latest.fetched_at ?? ''
      const opSurf = latest.ops[e.operation_id]
      if (!opSurf) {
        candidates.push({ status: 'op_missing', source: e.source, checked_at: checkedAt })
        continue
      }
      if (!fieldPath) {
        candidates.push({ status: 'unknown', source: e.source, checked_at: checkedAt })
        continue
      }
      const matched = Object.keys(opSurf.response).some(sf => matchesSpecFieldPath(fieldPath, sf))
      candidates.push({ status: matched ? 'present' : 'field_missing', source: e.source, checked_at: checkedAt })
    }

    if (candidates.length === 0) {
      return { status: 'unknown', source: entries[0].source, checked_at: '' }
    }
    const priority: Record<SpecMatchStatus, number> = { present: 0, field_missing: 1, op_missing: 2, unknown: 3 }
    candidates.sort((a, b) => priority[a.status] - priority[b.status])
    return candidates[0]
  }

  const entry = item.call_id ? apiList?.get(item.call_id) : undefined
  const opId = item.operation_id ?? entry?.operation_id
  const source = entry?.source ?? sourceFromOpId(opId)
  const latest = source ? latestSurfaces.get(source) : undefined
  const checkedAt = latest?.fetched_at ?? ''

  if (!opId || !latest) {
    return { status: 'unknown', source, checked_at: checkedAt }
  }
  const opSurf = latest.ops[opId]
  if (!opSurf) {
    return { status: 'op_missing', source, checked_at: checkedAt }
  }
  if (item.kind === 'status_change' || item.kind === 'still_failing') {
    return { status: 'present', source, checked_at: checkedAt }
  }
  if (!item.field) {
    return { status: 'unknown', source, checked_at: checkedAt }
  }
  const matched = Object.keys(opSurf.response).some(sf => matchesSpecFieldPath(item.field!, sf))
  return { status: matched ? 'present' : 'field_missing', source, checked_at: checkedAt }
}

export function diffRuns(input: {
  previous: RawRun
  current: RawRun
  apiList?: Map<string, ApiListEntry>
  profileFieldPaths?: (profileRel: string) => string[]
  normPrevious?: NormCounts
  normCurrent?: NormCounts
  coveragePrevious?: ReturnType<typeof fieldCoverage>
  coverageCurrent?: ReturnType<typeof fieldCoverage>
  declaredFields?: (profileRel: string) => FieldDeclaration[]
  latestSurfaces?: Map<string, LatestSurfaceFile>
  complianceChecksByObjectType?: Map<string, string[]> | Record<string, string[]>
}): RunDiffReport {
  const items: RunDiffItem[] = []
  const warnings: string[] = []

  const prevCalls = new Map(input.previous.record.calls.map(c => [keyOf(c.provider, c.call_id), c]))
  const curCalls = new Map(input.current.record.calls.map(c => [keyOf(c.provider, c.call_id), c]))
  const allKeys = new Set([...prevCalls.keys(), ...curCalls.keys()])

  const prevPages = pagesByCall(input.previous)
  const curPages = pagesByCall(input.current)

  for (const key of allKeys) {
    const prev = prevCalls.get(key)
    const cur = curCalls.get(key)
    const provider = cur?.provider ?? prev!.provider
    const callId = cur?.call_id ?? prev!.call_id
    const entry = input.apiList?.get(callId)
    const base = { provider, call_id: callId, ...(entry?.operation_id ? { operation_id: entry.operation_id } : {}) }

    if (prev && !cur) {
      items.push({ severity: 'warning', kind: 'call_removed', ...base, previous: callSnapshot(prev) })
      continue
    }
    if (!prev && cur) {
      items.push({ severity: 'info', kind: 'call_added', ...base, current: callSnapshot(cur) })
      continue
    }
    if (!prev || !cur) continue

    const prevApiWarnings = new Set(prev.api_warnings ?? [])
    for (const w of cur.api_warnings ?? []) {
      if (!prevApiWarnings.has(w)) {
        items.push({ severity: 'warning', kind: 'api_warning_new', ...base, field: w })
      }
    }

    const prevOk = isCallOk(prev)
    const curOk = isCallOk(cur)

    if (prevOk && !curOk) {
      const cause = classifyBadCause(cur)
      items.push({
        severity: cause === 'api_change_suspected' ? 'break' : 'regression',
        kind: 'status_change',
        ...base,
        previous: callSnapshot(prev),
        current: callSnapshot(cur, cause),
      })
      continue
    }
    if (!prevOk && !curOk) {
      items.push({
        severity: 'info',
        kind: 'still_failing',
        ...base,
        previous: callSnapshot(prev, classifyBadCause(prev)),
        current: callSnapshot(cur, classifyBadCause(cur)),
      })
      continue
    }
    if (!prevOk && curOk) {
      items.push({
        severity: 'info',
        kind: 'recovered',
        ...base,
        previous: callSnapshot(prev, classifyBadCause(prev)),
        current: callSnapshot(cur),
      })
      continue
    }

    if (prev.record_count > 0 && cur.record_count === 0) {
      items.push({
        severity: 'warning',
        kind: 'records_dropped_to_zero',
        ...base,
        previous: callSnapshot(prev),
        current: callSnapshot(cur),
      })
      continue
    }

    if (!STREAM_CALLS.has(callId) && prev.record_count > 0 && cur.record_count > 0) {
      const prevShape = collectCallShape(prevPages.get(key) ?? [])
      const curShape = collectCallShape(curPages.get(key) ?? [])
      const truncated = prevShape.truncated || curShape.truncated

      for (const field of prevShape.paths.keys()) {
        if (!curShape.paths.has(field)) {
          const profileFields = findMatchingProfileFields(field, entry, input.profileFieldPaths)
          items.push({
            severity: profileFields.length > 0 ? 'break' : 'warning',
            kind: 'field_removed',
            ...base,
            field,
            ...(profileFields.length > 0 ? { profile_fields: profileFields } : {}),
            ...(truncated ? { truncated: true } : {}),
          })
        } else {
          const prevNonNull = [...prevShape.paths.get(field)!].filter(t => t !== 'null').sort()
          const curNonNull = [...curShape.paths.get(field)!].filter(t => t !== 'null').sort()
          if (prevNonNull.length > 0 && curNonNull.length > 0) {
            const curSet = new Set(curNonNull)
            const overlaps = prevNonNull.some(t => curSet.has(t))
            if (!overlaps) {
              const profileFields = findMatchingProfileFields(field, entry, input.profileFieldPaths)
              items.push({
                severity: profileFields.length > 0 ? 'break' : 'warning',
                kind: 'field_type_changed',
                ...base,
                field,
                previous_types: prevNonNull,
                current_types: curNonNull,
                ...(profileFields.length > 0 ? { profile_fields: profileFields } : {}),
                ...(truncated ? { truncated: true } : {}),
              })
            }
          }
        }
      }

      for (const field of curShape.paths.keys()) {
        if (!prevShape.paths.has(field)) {
          items.push({
            severity: 'added',
            kind: 'field_added',
            ...base,
            field,
            ...(truncated ? { truncated: true } : {}),
          })
        }
      }
    }
  }

  if (input.normPrevious && input.normCurrent) {
    for (const metric of ['objects', 'relations'] as const) {
      const prevCount = input.normPrevious[metric]
      const curCount = input.normCurrent[metric]
      if (typeof prevCount === 'number' && typeof curCount === 'number' && prevCount > 0) {
        if ((prevCount - curCount) / prevCount > 0.2) {
          items.push({
            severity: 'break',
            kind: 'normalize_drop',
            field: metric,
            previous: { record_count: prevCount },
            current: { record_count: curCount },
          })
        }
      }
    }
  }

  if (input.coveragePrevious && input.coverageCurrent && input.declaredFields) {
    items.push(...diffFieldCoverage(input.coveragePrevious, input.coverageCurrent, input.declaredFields))
  }

  const apiListValues = input.apiList ? [...input.apiList.values()] : []
  if (input.latestSurfaces) {
    for (const item of items) {
      if (!isSpecTargetItem(item)) continue
      const verdict = evaluateSpecForItem(item, input.latestSurfaces, input.apiList, apiListValues, input.declaredFields)
      item.spec = verdict
      if (item.kind === 'status_change' && item.severity === 'regression' && verdict.status === 'op_missing') {
        item.severity = 'break'
      }
    }
  }

  if (input.apiList) {
    const impactDeps = {
      apiList: input.apiList,
      complianceChecksByObjectType: input.complianceChecksByObjectType,
    }
    for (const item of items) {
      if (item.severity !== 'break' && item.severity !== 'regression') continue
      const impact = item.operation_id
        ? impactOfOperation(item.operation_id, impactDeps)
        : item.profile
          ? impactOfProfile(item.profile, impactDeps)
          : null
      if (impact && !isEmptyImpact(impact)) {
        item.impact = impact
      }
    }
  }

  items.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) ||
    compareText(a.provider ?? '', b.provider ?? '') ||
    compareText(a.call_id ?? '', b.call_id ?? '') ||
    compareText(a.profile ?? '', b.profile ?? '') ||
    compareText(a.field ?? '', b.field ?? ''),
  )

  const summary = {
    break: items.filter(i => i.severity === 'break').length,
    regression: items.filter(i => i.severity === 'regression').length,
    warning: items.filter(i => i.severity === 'warning').length,
    still_failing: items.filter(i => i.kind === 'still_failing').length,
    recovered: items.filter(i => i.kind === 'recovered').length,
    added: items.filter(i => i.severity === 'added').length,
  }

  return {
    format: 'aegi-collect-run-diff/v1',
    previous_run: input.previous.record.run_id,
    current_run: input.current.record.run_id,
    summary,
    items,
    warnings,
  }
}

export function selectPreviousRunId(runsDir: string, currentRunId: string): string | null {
  if (!fs.existsSync(runsDir)) return null
  const candidates = fs
    .readdirSync(runsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5))
    .filter(id => !id.includes('-logs') && id < currentRunId)
    .sort(compareText)
  return candidates.length > 0 ? candidates[candidates.length - 1] : null
}

export function formatConsoleSummary(report: RunDiffReport): string {
  const s = report.summary
  const lines = [
    `run 비교 ${report.previous_run} → ${report.current_run}: 깨짐 ${s.break}, 나빠짐 ${s.regression}, 경고 ${s.warning}, 계속 실패 ${s.still_failing}, 회복 ${s.recovered}, 필드 추가 ${s.added}`,
  ]
  for (const item of report.items) {
    if (item.severity !== 'break' && item.severity !== 'regression') continue
    const label = item.severity === 'break' ? '깨짐' : '나빠짐'
    const pf = item.profile_fields?.length
      ? ` (Profile ${item.profile_fields.map(p => `${p.profile} ${p.path}`).join(', ')})`
      : ''
    const specSuffix =
      item.spec?.status === 'op_missing'
        ? ' [스펙에서도 빠짐]'
        : item.spec?.status === 'field_missing'
          ? ' [스펙에서도 필드 빠짐]'
          : item.spec?.status === 'present'
            ? ' [스펙은 그대로: 권한·테넌트 확인]'
            : ''
    if (item.kind === 'status_change') {
      const prevVal = `${item.previous?.completeness ?? '-'}/${item.previous?.http_status ?? '-'}`
      const curVal = `${item.current?.completeness ?? '-'}/${item.current?.http_status ?? '-'}`
      lines.push(`${label} ${item.provider} ${item.call_id} ${prevVal} → ${curVal} (${item.current?.cause ?? 'other'})${specSuffix}`)
    } else if (item.kind === 'field_removed') {
      lines.push(`${label} ${item.provider} ${item.call_id} ${item.field} 빠짐${pf}${specSuffix}`)
    } else if (item.kind === 'field_type_changed') {
      lines.push(`${label} ${item.provider} ${item.call_id} ${item.field} 타입 변경 (${item.previous_types?.join('|')} → ${item.current_types?.join('|')})${pf}${specSuffix}`)
    } else if (item.kind === 'normalize_drop') {
      lines.push(`${label} normalize ${item.field} ${item.previous?.record_count} → ${item.current?.record_count}${specSuffix}`)
    } else if (item.kind === 'field_coverage_drop') {
      lines.push(`${label} 정규화 ${item.profile} ${item.field} 채움 ${item.previous_coverage?.with_value}/${item.previous_coverage?.objects} → ${item.current_coverage?.with_value}/${item.current_coverage?.objects}${specSuffix}`)
    } else if (item.kind === 'field_value_type_changed') {
      const declPart = item.declaration?.scalar ? ` 선언 ${item.declaration.scalar}` : ''
      lines.push(`${label} 정규화 ${item.profile} ${item.field} 타입 변경 (${item.previous_types?.join('|')} → ${item.current_types?.join('|')})${declPart}${specSuffix}`)
    }
  }
  return lines.join('\n')
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

function loadProfileMetadata(
  profileBindingDir: string,
  warnings: string[],
): {
  fieldPaths: (profileRel: string) => string[]
  declaredFields: (profileRel: string) => FieldDeclaration[]
} {
  const cache = new Map<string, { paths: string[]; declarations: FieldDeclaration[] }>()
  const load = (profileRel: string): { paths: string[]; declarations: FieldDeclaration[] } => {
    const cached = cache.get(profileRel)
    if (cached) return cached
    const primaryFile = path.join(profileBindingDir, 'profiles', profileRel)
    const file = fs.existsSync(primaryFile) ? primaryFile : path.join(profileBindingDir, profileRel)
    const empty = { paths: [], declarations: [] }
    try {
      const doc = YAML.parse(fs.readFileSync(file, 'utf8'))
      if (!doc || typeof doc !== 'object') {
        warnings.push(`Profile fields 형식 오류로 건너뜀: ${profileRel}`)
        cache.set(profileRel, empty)
        return empty
      }
      if (doc.fields === undefined || doc.fields === null) {
        cache.set(profileRel, empty)
        return empty
      }
      if (typeof doc.fields !== 'object' || Array.isArray(doc.fields)) {
        warnings.push(`Profile fields 형식 오류로 건너뜀: ${profileRel}`)
        cache.set(profileRel, empty)
        return empty
      }
      const paths: string[] = []
      const declarations: FieldDeclaration[] = []
      for (const [name, val] of Object.entries(doc.fields as Record<string, unknown>)) {
        if (val && typeof val === 'object') {
          const v = val as { path?: unknown; declaration?: { required?: unknown; scalar?: unknown } }
          if (typeof v.path === 'string') {
            paths.push(v.path)
          }
          const decl = v.declaration && typeof v.declaration === 'object' ? v.declaration : undefined
          declarations.push({
            name,
            ...(typeof decl?.required === 'boolean' ? { required: decl.required } : {}),
            ...(typeof decl?.scalar === 'string' ? { scalar: decl.scalar } : {}),
            ...(typeof v.path === 'string' ? { path: v.path } : {}),
          })
        }
      }
      const entry = { paths, declarations }
      cache.set(profileRel, entry)
      return entry
    } catch {
      warnings.push(`Profile 읽기 실패로 건너뜀: ${profileRel}`)
      cache.set(profileRel, empty)
      return empty
    }
  }
  return {
    fieldPaths: (profileRel: string) => load(profileRel).paths,
    declaredFields: (profileRel: string) => load(profileRel).declarations,
  }
}

function readNormCounts(dir: string, warnings: string[]): NormCounts | undefined {
  const file = path.join(dir, 'verify.json')
  if (!fs.existsSync(file)) {
    warnings.push(`verify.json 없음: ${dir}`)
    return undefined
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { counts?: NormCounts }
    return {
      objects: typeof data?.counts?.objects === 'number' ? data.counts.objects : undefined,
      relations: typeof data?.counts?.relations === 'number' ? data.counts.relations : undefined,
    }
  } catch {
    warnings.push(`verify.json 읽기 실패: ${dir}`)
    return undefined
  }
}

function readNormObjects(dir: string, warnings: string[]): unknown[] | undefined {
  const file = path.join(dir, 'objects.json')
  if (!fs.existsSync(file)) {
    warnings.push(`objects.json 없음: ${dir}`)
    return undefined
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    if (Array.isArray(data)) return data
    if (data && typeof data === 'object' && Array.isArray((data as { objects?: unknown }).objects)) {
      return (data as { objects: unknown[] }).objects
    }
    warnings.push(`objects.json 형식 오류: ${dir}`)
    return undefined
  } catch {
    warnings.push(`objects.json 읽기 실패: ${dir}`)
    return undefined
  }
}

const SPEC_MAX_AGE_MS = 7 * 86400_000

function loadLatestSurfaces(
  specDir: string,
  warnings: string[],
): Map<string, LatestSurfaceFile> | undefined {
  if (!fs.existsSync(specDir)) {
    warnings.push(`스펙 대조 건너뜀: --spec-dir 폴더 없음 (${specDir})`)
    return undefined
  }
  const map = new Map<string, LatestSurfaceFile>()
  let staleOrMissing = false
  const nowMs = Date.now()
  const files = fs.readdirSync(specDir).filter(f => f.endsWith('.json'))
  if (files.length === 0) {
    staleOrMissing = true
  }
  for (const f of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(specDir, f), 'utf8')) as LatestSurfaceFile
      const srcId = parsed.source || f.slice(0, -5)
      map.set(srcId, parsed)
      const fetchedMs = typeof parsed.fetched_at === 'string' ? Date.parse(parsed.fetched_at) : NaN
      if (!Number.isFinite(fetchedMs) || nowMs - fetchedMs > SPEC_MAX_AGE_MS) {
        staleOrMissing = true
      }
    } catch {
      staleOrMissing = true
    }
  }
  if (staleOrMissing) {
    warnings.push('최신 스펙(latest)이 없거나 7일보다 오래됨: npm run api-watch -- refresh-latest 를 먼저 실행하세요')
  }
  return map
}

export function main(argv = process.argv.slice(2)): number {
  if (argv.includes('--help')) {
    console.log('collect:diff --current <run_id> [--previous <run_id>] [--root <dir>] [--previous-root <dir>] [--norm-current <dir>] [--norm-previous <dir>] [--spec-dir <dir>] [--out <file>] [--fail-on-break]')
    return 0
  }

  const valueFlags = new Set(['--current', '--previous', '--root', '--previous-root', '--norm-current', '--norm-previous', '--spec-dir', '--out'])
  const args = new Map<string, string>()
  let failOnBreak = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--fail-on-break') {
      failOnBreak = true
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

  const rootDir = path.resolve(ROOT, args.get('--root') ?? 'collected')
  const prevRootDir = args.get('--previous-root') ? path.resolve(ROOT, args.get('--previous-root')!) : rootDir
  const previousId = args.get('--previous') ?? selectPreviousRunId(path.join(prevRootDir, 'runs'), currentId)

  if (!previousId) {
    console.error(`비교할 이전 run 을 찾지 못했다 (current=${currentId}).`)
    return 1
  }

  let previous: RawRun
  let current: RawRun
  try {
    previous = loadRawRun(prevRootDir, previousId)
    current = loadRawRun(rootDir, currentId)
  } catch (err) {
    console.error(`run 파일을 읽지 못했다: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const mainWarnings: string[] = []
  const apiListEntries = loadApiList()
  const apiList = new Map(apiListEntries.map(e => [e.id, e]))
  const profileBindingDir = path.join(HERE, 'profile-binding')
  const { fieldPaths: profileFieldPaths, declaredFields } = loadProfileMetadata(profileBindingDir, mainWarnings)

  let normPrevious: NormCounts | undefined
  let normCurrent: NormCounts | undefined
  let coveragePrevious: ReturnType<typeof fieldCoverage> | undefined
  let coverageCurrent: ReturnType<typeof fieldCoverage> | undefined
  if (args.has('--norm-previous') && args.has('--norm-current')) {
    const prevNormDir = path.resolve(ROOT, args.get('--norm-previous')!)
    const curNormDir = path.resolve(ROOT, args.get('--norm-current')!)
    normPrevious = readNormCounts(prevNormDir, mainWarnings)
    normCurrent = readNormCounts(curNormDir, mainWarnings)
    const prevObjects = readNormObjects(prevNormDir, mainWarnings)
    const curObjects = readNormObjects(curNormDir, mainWarnings)
    if (prevObjects && curObjects) {
      coveragePrevious = fieldCoverage(prevObjects, declaredFields)
      coverageCurrent = fieldCoverage(curObjects, declaredFields)
    }
  }

  const specDir = path.resolve(ROOT, args.get('--spec-dir') ?? 'collected/api-watch/latest')
  const latestSurfaces = loadLatestSurfaces(specDir, mainWarnings)

  const report = diffRuns({
    previous,
    current,
    apiList,
    profileFieldPaths,
    ...(normPrevious && normCurrent ? { normPrevious, normCurrent } : {}),
    ...(coveragePrevious && coverageCurrent ? { coveragePrevious, coverageCurrent, declaredFields } : {}),
    ...(latestSurfaces ? { latestSurfaces } : {}),
  })
  report.warnings.push(...mainWarnings)

  console.log(formatConsoleSummary(report))

  if (args.has('--out')) {
    const outFile = path.resolve(ROOT, args.get('--out')!)
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n')
  }

  if (failOnBreak && report.summary.break > 0) return 2
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
