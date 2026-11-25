import fs from 'node:fs'
import path from 'node:path'
import { dashProvider } from './provider-map.mjs'

export async function loadCohort(cohort, tsImport) {
  const { RawSet } = await tsImport('../../shared/raw.ts', import.meta.url)
  const { isRovoUiEnvelope } = await tsImport('../../imports/rovo.ts', import.meta.url)
  const recordFile = path.join(cohort.root, 'runs', cohort.run + '.json')
  if (!fs.existsSync(recordFile)) throw new Error(`Collection run record missing: ${recordFile}`)
  let record = JSON.parse(fs.readFileSync(recordFile, 'utf8'))
  if (record.run_id !== cohort.run || !Array.isArray(record.calls) || !record.finished_at) throw new Error('Collection run must be completed and match --run')
  // --without: 그 SaaS(provider) 또는 그 호출(provider:call)이 없던 것처럼 읽는다. 수집 기록의 호출 목록에서도 뺀다
  const without = cohort.without ?? []
  const dropped = (provider, call) => without.includes(provider) || without.includes(`${provider}:${call}`)
  if (without.length) record = { ...record, calls: record.calls.filter(c => !dropped(c.provider, c.call_id)) }
  const dir = path.join(cohort.root, 'raw', cohort.run), pages = []
  if (!fs.existsSync(dir)) throw new Error('Collection run has no raw directory')
  const calls = new Set(record.calls.map(c => `${c.provider}\0${c.call_id}`))
  const payloads = payloadCache(Number(process.env.AEGI_NORMALIZE_PAYLOAD_CACHE_MB ?? 256) * 1e6)
  for (const provider of fs.readdirSync(dir).sort()) {
    const providerDir = path.join(dir, provider)
    if (!fs.statSync(providerDir).isDirectory() || without.includes(provider)) continue
    for (const file of fs.readdirSync(providerDir).filter(f => f.endsWith('.json')).sort()) {
      const full = path.join(providerDir, file)
      const env = JSON.parse(fs.readFileSync(full, 'utf8'))
      if (env.provider === provider && dropped(provider, env.call_id)) continue
      if (env.provider !== provider || !calls.has(`${provider}\0${env.call_id}`)) throw new Error(`Raw page does not match run record: ${provider}/${file}`)
      if (env.http_status < 200 || env.http_status >= 300 || !Number.isInteger(env.http_status)) {
        if (!isRovoUiEnvelope(env)) continue
      }
      // 내용(payload)은 메모리에 두지 않는다. 읽을 때 파일에서 다시 불러오고 크기 한도 안에서만 기억한다(원본 전체가 힙에 올라가 2,000명에서 죽었다)
      const { payload, ...head } = env
      const page = { ...head, __file: `${provider}/${file}` }
      Object.defineProperty(page, 'payload', { enumerable: true, get: () => payloads.get(full) })
      pages.push(page)
    }
  }
  if (!pages.length) throw new Error('Collection run has no successful raw pages')
  // Evidence and coverage must use exactly the same run as Profile extraction.
  return { pages, raw: new RawSet([{ record, pages }]) }
}

/** 원본 파일의 payload 를 읽어 최근에 쓴 것부터 budget 바이트(파일 크기 기준)까지 기억한다 */
/** 원본 내용을 파일에서 읽은 횟수와 바이트(AEGI_NORMALIZE_MEMLOG 기록용) */
export const payloadStats = { reads: 0, bytes: 0 }
function payloadCache(budget) {
  const cache = new Map()
  let size = 0
  return {
    get(file) {
      const hit = cache.get(file)
      if (hit) { cache.delete(file); cache.set(file, hit); return hit.payload }
      const text = fs.readFileSync(file, 'utf8')
      payloadStats.reads++; payloadStats.bytes += text.length
      const entry = { payload: JSON.parse(text).payload, bytes: text.length }
      cache.set(file, entry); size += entry.bytes
      for (const [k, v] of cache) { if (size <= budget || cache.size === 1) break; cache.delete(k); size -= v.bytes }
      return entry.payload
    },
  }
}

const templateRegex = new Map()
function matches(endpoint, template) {
  const route = String(template ?? '').split('?')[0]
  if (!route) return false
  if (!templateRegex.has(route)) {
    const normalized = route.startsWith('/') ? route : '/' + route
    const escaped = normalized.split('/').map(s => /^\{[^}]+\}$/.test(s) ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/')
    templateRegex.set(route, new RegExp(escaped.replace(/\/$/, '') + '$'))
  }
  const pathname = new URL(endpoint).pathname.replace(/\/$/, '')
  return templateRegex.get(route).test(pathname)
}

function matchesOperation(env, route) {
  const operation = route.operation
  if (operation.method && operation.method !== env.method) return false
  const request = { ...(route.request ?? {}) }
  const soql = /^op:sf_object_reference:([^.]+)\.query$/.exec(operation.ir_operation_id)
  if (soql) request.soql_object ??= soql[1]
  for (const [key, expected] of Object.entries(request)) {
    const value = env.request_params?.[key]
    if (expected === 'present' ? value == null : expected === 'absent' ? value != null : Array.isArray(expected) ? !expected.includes(value) : value !== expected) return false
  }
  // SOQL 다음 쪽은 nextRecordsUrl(/query/<커서>) 이다. 같은 질의의 이어지는 쪽이므로 /query 와 같게 본다
  if (soql && /\/query$/.test(String(operation.path_template ?? '').split('?')[0])) return /\/(tooling\/)?query(\/[^/]+)?$/.test(new URL(env.endpoint).pathname.replace(/\/$/, ''))
  const rpc = /^op:slack_docs_methods:(.+)$/.exec(operation.ir_operation_id)
  if (rpc && env.request_params?.method) return env.request_params.method === rpc[1]
  return matches(env.endpoint, operation.path_template ?? rpc?.[1])
}

export function linkOperations(pages, routes) {
  const links = []
  // 페이지마다 경로 전체를 거르지 않게 (provider, 호출 ID) 로 묶어 둔다. 묶음 안 순서는 routes 순서 그대로
  const byCall = new Map()
  for (const r of routes) {
    const k = `${r.collection.provider}\0${r.collection.call_id}`
    if (!byCall.has(k)) byCall.set(k, [])
    byCall.get(k).push(r)
  }
  for (const env of pages) {
    // The model's observation links define reviewed routes, never the current page names.
    const candidates = (byCall.get(`${env.provider}\0${env.call_id}`) ?? []).filter(r => matchesOperation(env, r))
    const unique = new Map()
    for (const candidate of candidates) {
      const id = candidate.operation.ir_operation_id, previous = unique.get(id)
      unique.set(id, { ...candidate, operation: { ...candidate.operation, alternates: [...new Set([...(previous?.operation.alternates ?? []), ...(candidate.operation.alternates ?? [])])] } })
    }
    for (const route of unique.values()) links.push({ ...route, source: { raw_file: env.__file }, envelope: env })
  }
  return links
}

/**
 * API list pages (scripts/collect/api-list) declare the IR operation they executed.
 * A declared operation is trusted only for that exact page and still passes matchesOperation
 * (method, path template, Slack method, Salesforce object), so a wrong declaration links nothing.
 * approved: Map(API list call ID → operation ID) of entries approved in the current API list.
 */
export function approvedApiList(file) {
  if (!fs.existsSync(file)) return new Map()
  return new Map(fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)).filter(e => e.status === 'approved').map(e => [e.id, e.operation_id]))
}
export function envelopeRoutes(pages, approved) {
  const seen = new Set(), out = []
  for (const env of pages) {
    const op = env.operation
    if (!op?.id || typeof op.path_template !== 'string') continue
    // 지금 수집 API 목록에서 승인된 (호출 ID, operation) 만 믿는다. 수집 뒤 거절된 operation 의 원본은 연결하지 않는다
    if (approved && approved.get(env.call_id) !== op.id) continue
    const key = `${env.provider}|${env.call_id}|${op.id}|${op.path_template}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ collection: { provider: env.provider, call_id: env.call_id }, request: {}, operation: { status: 'matched', method: env.method, path_template: op.path_template, ir_operation_id: op.id } })
  }
  return out
}

export function profileRoutes(profiles) {
  return profiles.flatMap(({ prof, research_provider }) => {
    const binding = prof.binding ?? {}
    const provider = dashProvider(research_provider)
    return [binding, ...(binding.sources ?? []), ...(binding.observed_sources ?? [])]
      .filter(b => b.call && b.operation_id && (b.method || binding.surface === 'rpc') && b.endpoint_template)
      .map(b => ({ collection: { provider, call_id: b.call }, request: b.request, operation: { status: 'matched', method: b.method, path_template: b.endpoint_template, ir_operation_id: b.operation_id } }))
  })
}
