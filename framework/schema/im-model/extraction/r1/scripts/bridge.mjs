// 단계 A: 고정한 run 의 raw envelope -> 고정 IR 의 operation·response shape·record selector·요청 scope.
// 수집 call ID 는 operation 이 아니다. 실제 method·endpoint·request_params·payload 로 연결한다.
// 후보가 여럿이면 ambiguous 로 남기고 첫 후보를 고르지 않는다. 원본 IR 과 raw 는 읽기만 한다.
import path from 'node:path'
import { CONFIG, OUT, PRIVATE, ir, shape, loadEnvelopes, readJson, writeJson, writeJsonl } from './lib.mjs'

const segs = p => p.split('?')[0].split('/').filter(Boolean)
const isVar = s => s.startsWith('{') && s.endsWith('}')

// REST 경로 틀: 원문 선언(ext.servicePath + ext.raw_path)과 선언된 서버 base
const restIndex = new Map()
function restOps(provider) {
  if (!restIndex.has(provider)) {
    const rows = []
    for (const o of ir(provider, 'operation')) {
      if (o.surface !== 'rest' || !o.method || o.ext?.raw_path == null) continue
      const tmpl = segs(`${o.ext.servicePath ?? ''}/${o.ext.raw_path}`)
      for (const base of ['', ...(CONFIG.server_bases[o.src.source] ?? [])]) rows.push({ o, provider, base: segs(base), tmpl })
    }
    restIndex.set(provider, rows)
  }
  return restIndex.get(provider)
}

// 기존 tenant_log.match 와 같은 규칙: 조각 수가 같고, 글자 조각이 가장 많이 맞는 동작. 동률이면 ambiguous
function matchRest(providers, method, actual) {
  const cands = []
  for (const p of providers) for (const r of restOps(p)) {
    if (r.o.method !== method || r.base.length + r.tmpl.length !== actual.length) continue
    if (!r.base.every((b, i) => b === actual[i])) continue
    const rest = actual.slice(r.base.length), vals = {}
    let lit = 0, ok = true
    for (let i = 0; i < r.tmpl.length; i++) {
      const t = r.tmpl[i]
      if (isVar(t)) vals[t.slice(1, -1)] = rest[i]
      else if (t === rest[i]) lit++
      else { ok = false; break }
    }
    if (ok) cands.push({ ...r, lit, vals })
  }
  if (!cands.length) return { status: 'unmapped', reason: 'no_operation_template_matches_path', candidates: [] }
  const top = Math.max(...cands.map(c => c.lit)), tops = cands.filter(c => c.lit === top)
  const ids = [...new Set(tops.map(c => c.o.id))]
  if (ids.length > 1) return { status: 'ambiguous', reason: 'several_templates_match_equally', candidates: ids.sort() }
  return { status: 'matched', hit: tops[0] }
}

function responseShape(o, status) {
  const r = (o.responses ?? []).find(x => x.status === String(status)) ?? (o.responses ?? []).find(x => x.status === '200')
  return r?.shape ?? null
}

// 같은 메서드의 여러 문서 view 중 대표는 실제 payload 최상위 키를 가장 많이 선언한 응답 shape 로 고른다.
// 같으면 src.rank, 그다음 설정 순서. 고른 근거와 나머지 view 를 남긴다.
function rpcFit(o, payload) {
  const s = shape('slack', responseShape(o, 200))
  const props = new Set((s?.props ?? []).map(p => p.name))
  return Object.keys(payload ?? {}).filter(k => props.has(k)).length
}
function matchRpc(method, payload) {
  const srcOrder = CONFIG.rpc.slack_source_order
  const c = ir('slack', 'operation').filter(o => o.surface === 'rpc' && o.name === method)
  if (!c.length) return { status: 'unmapped', reason: 'rpc_method_not_in_ir', candidates: [] }
  const fit = new Map(c.map(o => [o.id, rpcFit(o, payload)]))
  c.sort((a, b) => (fit.get(b.id) - fit.get(a.id)) || (a.src.rank - b.src.rank) || (srcOrder.indexOf(a.src.source) - srcOrder.indexOf(b.src.source)))
  return {
    status: 'matched', hit: { o: c[0], provider: 'slack', vals: {} }, alternates: c.slice(1).map(o => o.id),
    selection_basis: c.length > 1 ? { rule: 'payload_key_fit_then_rank', fit: Object.fromEntries(fit) } : null,
  }
}

const arrayItems = s => s?.kind === 'array' ? s.items?.shape ?? null : null

// record 위치를 원문 shape 로 정한다.
// - read_one(경로 끝이 파라미터인 GET) 응답은 그 자체가 한 record 다. 안의 배열은 record 의 속성이다.
// - 목록 wrapper 는 원문 shape 가 선언한 객체 원소 배열 속성이 하나일 때 그것이다. payload 에 키가 없으면 빈 페이지로 센다.
function recordSelector(provider, shapeId, payload, opKind) {
  const s = shape(provider, shapeId)
  if (!s) return { selector: null, record_shape: null, reason: 'response_shape_not_in_ir' }
  if (s.kind === 'array') return Array.isArray(payload) ? { selector: '$[*]', record_shape: s.items?.shape ?? null, count: payload.length } : { selector: null, record_shape: null, reason: 'shape_array_payload_not_array' }
  if (Array.isArray(payload)) return { selector: null, record_shape: null, reason: 'payload_array_shape_not_array' }
  if (opKind === 'read_one') return { selector: '$', record_shape: shapeId, count: payload == null ? 0 : 1 }
  const arrays = []
  for (const p of s.props ?? []) {
    const items = p.items?.shape ?? arrayItems(shape(provider, p.shape))
    const is = items && shape(provider, items)
    if (is && is.kind !== 'array' && is.kind !== 'scalar') arrays.push({ name: p.name, items })
  }
  const present = arrays.filter(a => Array.isArray(payload?.[a.name]))
  const pick = arrays.length === 1 ? arrays[0] : present.length === 1 ? present[0] : null
  if (pick) {
    const v = payload?.[pick.name]
    return { selector: `$.${pick.name}[*]`, record_shape: pick.items, count: Array.isArray(v) ? v.length : 0, empty_reason: Array.isArray(v) ? null : 'record_array_absent_in_payload' }
  }
  if (arrays.length > 1) return { selector: null, record_shape: null, reason: 'several_record_arrays', candidates: arrays.map(a => a.name) }
  return { selector: '$', record_shape: shapeId, count: payload == null ? 0 : 1 }
}

// 경로 변수 값이 어느 request_params 에서 왔는지 이름만 남긴다 (값은 쓰지 않는다). 같은 값이 둘 이상이면 고르지 않는다
function paramBindings(vals, rp) {
  const out = {}
  for (const [k, v] of Object.entries(vals)) {
    const hits = Object.entries(rp ?? {}).filter(([, x]) => String(x) === v).map(([n]) => `request_params.${n}`)
    out[k] = hits.length === 1 ? hits[0] : hits.length ? { ambiguous: hits } : 'path_only'
  }
  return out
}

const runRec = readJson(path.join(CONFIG.cohort.root, 'runs', `${CONFIG.cohort.run}.json`))
const callStatus = new Map(runRec.calls.map(c => [c.call_id, c.completeness]))
const existingObserved = new Map()
function observedOps(p) {
  if (!existingObserved.has(p)) existingObserved.set(p, new Set(ir(p, 'instance').filter(i => i.grade === 'observed' && i.of?.operation).map(i => i.of.operation)))
  return existingObserved.get(p)
}

const links = [], privateLocators = []
for (const { rel, file_sha256, env } of loadEnvelopes()) {
  const id = `obs:${CONFIG.cohort.run}:${rel.replace(/\.json$/, '').replace('/', ':')}`
  let host = '', actual = []
  try { const u = new URL(env.endpoint); host = u.host; actual = segs(u.pathname).map(decodeURIComponent) } catch {}
  const base = {
    id, im_revision: CONFIG.revision, cohort: CONFIG.cohort.run,
    source: { raw_file: rel, file_sha256, response_sha256: env.response_sha256 ?? null, payload_sha256: env.payload_sha256 ?? null, collected_at: env.collected_at, http_status: env.http_status, collector_version: env.collector_version, call_completeness: callStatus.get(env.call_id) ?? null, credential_ref: env.credential_ref ?? null },
    collection: { provider: env.provider, call_id: env.call_id, page: env.page, method: env.method, request_param_names: Object.keys(env.request_params ?? {}).sort() },
  }
  privateLocators.push({ id, endpoint: env.endpoint, request_params: env.request_params })
  const providers = CONFIG.collection_to_research_providers[env.provider]
  let m
  if (!providers) m = { status: 'out_of_scope', reason: CONFIG.out_of_scope_collection_providers[env.provider] ?? 'no_research_provider' }
  else if (env.http_status !== 200 || env.payload === undefined) m = { status: 'unusable', reason: env.http_status === 204 ? 'http_204_no_content' : `http_${env.http_status}` }
  else if (host === 'api.github.com' && actual.join('/') === 'graphql') m = { status: 'unmapped', reason: CONFIG.unmapped_reasons.graphql }
  else if (env.provider === 'slack' && actual[0] === 'api' && actual.length === 2) m = matchRpc(actual[1], env.payload)
  else if (env.provider === 'salesforce' && actual.at(-1) === 'query') {
    const oid = CONFIG.salesforce.record_operation_template.replace('{soql_object}', env.request_params?.soql_object)
    const o = ir('salesforce', 'operation').find(x => x.id === oid)
    m = o ? { status: 'matched', hit: { o, provider: 'salesforce', vals: {} }, transport: CONFIG.salesforce.transport_operation } : { status: 'unmapped', reason: 'soql_object_operation_not_in_ir' }
  } else m = matchRest(providers, env.method, actual)

  const row = { ...base, operation: { status: m.status, reason: m.reason ?? null, candidates: m.candidates ?? [] } }
  if (m.status === 'matched') {
    const { o, provider, vals } = m.hit
    const rs = responseShape(o, env.http_status)
    const sel = rs ? recordSelector(provider, rs, env.payload, o.kind) : { selector: null, record_shape: null, reason: 'response_shape_unstated' }
    Object.assign(row.operation, {
      research_provider: provider, ir_operation_id: o.id, ir_source: o.src.source, ir_kind: o.kind, method: o.method ?? env.method,
      path_template: o.ext?.raw_path ?? o.path?.template ?? null, alternates: m.alternates ?? [], selection_basis: m.selection_basis ?? null,
      transport_operation: m.transport ?? null,
      response_shape_id: rs, record_selector: sel.selector, record_shape_id: sel.record_shape, record_count: sel.count ?? null,
      selector_reason: sel.reason ?? null, selector_candidates: sel.candidates ?? [], empty_reason: sel.empty_reason ?? null,
      parameter_bindings: paramBindings(vals, env.request_params),
      pinned_ir_had_observed: observedOps(provider).has(o.id),
    })
    if (!sel.selector) row.operation.status = 'matched_operation_only'
  }
  links.push(row)
}

// 집계: 분모를 호출·페이지·record 로 나눈다
const cov = { revision: CONFIG.revision, cohort: CONFIG.cohort.run, pages: {}, records_by_status: {}, by_provider: {}, by_call: {}, run_calls: {} }
const opsSeen = new Map()
for (const l of links) {
  const s = l.operation.status, p = l.collection.provider, c = l.collection.call_id
  cov.pages[s] = (cov.pages[s] ?? 0) + 1
  ;(cov.by_provider[p] ??= {})[s] = (cov.by_provider[p][s] ?? 0) + 1
  ;(cov.by_call[c] ??= { provider: p, completeness: l.source.call_completeness, pages: {}, operations: [] }).pages[s] = (cov.by_call[c].pages[s] ?? 0) + 1
  if (l.operation.ir_operation_id) {
    if (!cov.by_call[c].operations.includes(l.operation.ir_operation_id)) cov.by_call[c].operations.push(l.operation.ir_operation_id)
    opsSeen.set(l.operation.ir_operation_id, l.operation.pinned_ir_had_observed)
  }
  if (l.operation.record_count != null) cov.records_by_status[s] = (cov.records_by_status[s] ?? 0) + l.operation.record_count
}
for (const c of runRec.calls) cov.run_calls[c.completeness] = (cov.run_calls[c.completeness] ?? 0) + 1
cov.calls_total = runRec.calls.length
cov.calls_with_pages = Object.keys(cov.by_call).length
cov.calls_without_pages = runRec.calls.filter(c => !cov.by_call[c.call_id]).map(c => ({ call_id: c.call_id, completeness: c.completeness }))
cov.empty_pages = links.filter(l => l.operation.record_count === 0).length
cov.operations_matched = opsSeen.size
cov.operations_new_to_pinned_ir = [...opsSeen.values()].filter(v => !v).length
cov.note = 'pages: envelope 파일 수. records: record selector 가 정해진 페이지의 record 수. call completeness 는 수집기 보고값이며 SaaS 전수조사가 아니다. 빈 배열·없는 키는 대상 없음의 증거가 아니다.'

writeJsonl(path.join(OUT, 'observation-operation-links.jsonl'), links)
writeJson(path.join(OUT, 'bridge-coverage.json'), cov)
writeJsonl(path.join(PRIVATE, 'observation-locators.jsonl'), privateLocators)
console.log(JSON.stringify({ pages: cov.pages, records: cov.records_by_status, operations_matched: cov.operations_matched, new_to_pinned_ir: cov.operations_new_to_pinned_ir, empty_pages: cov.empty_pages }))
