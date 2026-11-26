// Profile 기반 정규화 실행기: im-profile-binding/profiles(+overlays)의 binding 으로 수집 원본에서 객체와 관계를 직접 뽑는다.
// 손코드 정규화기(engine normalize-v2)를 쓰지 않는다. 출력은 대시보드 RawDataset 형식이다.
// 실측 값이 들어가므로 out/ 은 로컬 전용이다. 공개 저장소나 문서로 옮기지 않는다.
//
//   npm run normalize -- --raw <collection> --run <collection-run> --out <dataset>
//
// 입력: profiles/<p>/*.yaml, overlays/<p>/*.yaml(보정. 깊은 병합, 배열 통째 교체, null 은 키 삭제, new-*.yaml 은 새 Profile),
//       IM 모델의 실측 연결·타입 판정·관계 어휘, runtime-config.json, 수집 원본 envelope
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { parseOptions } from './options.mjs'
import { loadCohort, linkOperations, profileRoutes, envelopeRoutes, approvedApiList, payloadStats } from './input.mjs'
import { verifyDataset } from './verify-output.mjs'
import { runProfileRules } from './profile-runtime.mjs'
import { applyReviewedReferenceRules } from './reviewed-reference-rules.mjs'
import { enrichDataset } from './enrich-dataset.mjs'
import { writeJson } from './json-stream.mjs'
import { dashProvider } from './provider-map.mjs'
import YAML from 'yaml'

const ROOT = path.resolve(import.meta.dirname, '..')
const ENGINE_ROOT = path.resolve(ROOT, '../../..')
export async function normalizeProfiles(options) {
const V31 = options.model
const COHORT = { root: options.raw, run: options.run, without: options.without }
const { tsImport } = await import('tsx/esm/api')
const { evalExpr, evalCond, getPath, present } = await tsImport('../../shared/expr.ts', import.meta.url)
const RUN_ID = options.run
const OUT = options.out
const cohortData = await loadCohort(COHORT, tsImport)
const memlog = label => { if (!process.env.AEGI_NORMALIZE_MEMLOG) return; globalThis.gc?.(); console.error(`[mem] ${label} heap ${(process.memoryUsage().heapUsed / 1e9).toFixed(2)}GB at ${Math.round(process.uptime())}s, payload reads ${payloadStats.reads} (${(payloadStats.bytes / 1e9).toFixed(2)}GB)`) }
memlog('loadCohort')
const runtimeConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'runtime-config.json'), 'utf8'))

// 대시보드 provider 는 provider-map.mjs dashProvider 하나로 정한다(저장과 찾기가 같은 규칙. 표에 없으면 원래 이름)
// 화면 이름. 공통 이름 필드가 없으면 provider 의 이름 필드(runtime-config.json display_fields)를 순서대로 보고, 그래도 없으면 식별자 끝값을 쓴다
// 예: Salesforce 는 Label, MasterLabel, Name 처럼 대문자 필드에 이름이 있어 공통 필드만 보면 레코드 Id 가 이름이 된다
const displayNameOf = (P, props, comps) => String(props.name ?? props.displayName ?? props.display_name ?? props.login ?? props.title ?? props.key
  ?? (runtimeConfig.providers?.[dashProvider(P.research_provider)]?.display_fields ?? []).map(f => props[f]).find(v => present(v) && typeof v !== 'object')
  ?? comps[comps.length - 1])

const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const readJsonl = p => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x)
// 배열에 stable 값이 같은 원소가 없을 때만 넣는다. 배열마다 stable 문자열 집합을 기억해 매번 전체를 비교하지 않는다(n² → n).
// 다른 곳에서 배열 길이가 바뀌었으면 집합을 다시 만든다
const stableSeen = new WeakMap()
function pushUnique(arr, x) {
  let seen = stableSeen.get(arr)
  if (!seen || seen.n !== arr.length) { seen = { n: arr.length, set: new Set(arr.map(stable)) }; stableSeen.set(arr, seen) }
  const s = stable(x)
  if (seen.set.has(s)) return false
  arr.push(x); seen.set.add(s); seen.n = arr.length
  return true
}

// ---------- Profile 읽기와 보정 병합 ----------
function deepMerge(base, over) {
  if (over === null) return undefined
  if (Array.isArray(over) || typeof over !== 'object' || typeof base !== 'object' || base === null || Array.isArray(base)) return over
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) { const m = deepMerge(base[k], v); if (m === undefined) delete out[k]; else out[k] = m }
  return out
}
function loadProfiles() {
  // 보정 폴더. --overlays로 다른 폴더를 줄 수 있다
  const out = [], overlays = options.overlays
  for (const p of fs.readdirSync(path.join(ROOT, 'profiles')).sort()) {
    for (const f of fs.readdirSync(path.join(ROOT, 'profiles', p)).filter(f => f.endsWith('.yaml')).sort()) {
      let prof = YAML.parse(fs.readFileSync(path.join(ROOT, 'profiles', p, f), 'utf8'))
      const ov = path.join(overlays, p, f)
      const overlaid = fs.existsSync(ov)
      let overlayData = null
      if (overlaid) {
        overlayData = YAML.parse(fs.readFileSync(ov, 'utf8')) ?? {}
        prof = deepMerge(prof, overlayData)
      }
      out.push({ file: `${p}/${f}`, research_provider: p, overlaid, overlayInterfaces: overlayData?.interfaces, prof, declared: declaredOf(prof) })
    }
  }
  if (fs.existsSync(overlays)) for (const p of fs.readdirSync(overlays)) for (const f of fs.readdirSync(path.join(overlays, p)).filter(f => /^new-.*\.yaml$/.test(f))) {
    const prof = YAML.parse(fs.readFileSync(path.join(overlays, p, f), 'utf8'))
    out.push({ file: `overlays/${p}/${f}`, research_provider: p, overlaid: true, added: true, overlayInterfaces: prof.interfaces, prof, declared: declaredOf(prof) })
  }
  return out
}

// ---------- Profile 이 읽는 레코드 키 ----------
// 「버린 필드」는 이 집합 밖의 응답 키다. Profile 전체(fields, identity, references, vars, runtime_rules 의 모든 칸)에서
// 레코드를 읽는 식을 모아 최상위 키로 센다. prefix_fields(from), true_keys(prefix)는 접두어, 레코드 통째(omit_keys 등)는 모든 키다.
// 개인정보·비밀값 규칙이 지운 키도 일부러 지운 것이라 버린 필드가 아니다
const WHOLE_RECORD = new Set(['.', '', 'r', '$item.r'])
// 식 객체에서 레코드 경로가 아닌 값을 담는 칸
const LITERAL_KEYS = new Set(['op', 'prefix', 'from', 'to', 'sep', 'table', 'name', 'field', 'values', 'eq', 'ne', 'in', 'not_in', 'contains',
  'matches', 'type', 'present', 'defined', 'truthy', 'is_array', 'keys', 'pattern', 'flags', 'with', 'start', 'end', 'mode', 'as', 'const',
  'empty_as', 'keep_other', 'keep_empty', 'trim', 'source', 'prop', 'key_template', 'kind', 'lookup', 'ci', 'rule', 'exists', 'sources', 'obs', 'basis', 'group'])
function exprKeys(e, out) {
  if (e == null || typeof e === 'number' || typeof e === 'boolean') return
  if (typeof e === 'string') {
    const s = e.trim()
    // $item.r.x(묶음 행), $item.x(펼친 항목이나 행), $vars.<이름>.r.x 는 레코드 키로 센다. 나머지 $문맥(req, parent, ctx 등)은 레코드가 아니다
    const m = /^\$(?:item|vars\.[A-Za-z0-9_]+)\.(?:r\.)?(.+)$/.exec(s)
    const p = m ? m[1] : s.startsWith('$') || s.startsWith('@') || (s.startsWith("'") && s.endsWith("'")) ? undefined : s.startsWith('r.') ? s.slice(2) : s
    const top = p && splitPath(p)[0]
    if (top && !WHOLE_RECORD.has(top)) out.keys.add(top)
    return
  }
  if (Array.isArray(e)) { for (const x of e) exprKeys(x, out); return }
  if (typeof e !== 'object') return
  if (typeof e.template === 'string') for (const m of e.template.matchAll(/\{([^{}]+)\}/g)) for (const alt of m[1].split('|')) exprKeys(alt, out)
  if (typeof e.of === 'string' && WHOLE_RECORD.has(e.of.trim())) {
    if (e.op === 'prefix_fields' && typeof e.from === 'string') out.prefixes.push(e.from)
    else if (e.op === 'true_keys') out.prefixes.push(e.prefix ?? '')
    else if (e.op === 'omit_keys' || e.op === 'keys' || e.op === 'entries_map') out.prefixes.push('')
  }
  for (const [k, v] of Object.entries(e)) if (k !== 'template' && !LITERAL_KEYS.has(k)) exprKeys(v, out)
}
function declaredOf(prof) {
  const out = { keys: new Set(), prefixes: [] }
  for (const [name, f] of Object.entries(prof.fields ?? {})) {
    if (name !== '...') out.keys.add(name)
    if (f?.path) exprKeys(Array.isArray(f.path) ? f.path.join('.') : f.path, out)
    if (f?.expr !== undefined) exprKeys(f.expr, out)
  }
  for (const k of prof.identity?.primary ?? []) exprKeys(k?.expr, out)
  for (const r of prof.references ?? []) {
    if (r?.field) exprKeys(r.field, out)
    if (r?.expr !== undefined) exprKeys(r.expr, out)
  }
  exprKeys(prof.vars, out)
  for (const rule of prof.runtime_rules ?? []) {
    if (!rule || typeof rule !== 'object') continue
    for (const k of Object.keys(rule.properties ?? {})) if (k !== '...') out.keys.add(k)
    // 규칙 id 는 규칙 이름이다. 나머지 칸(where, require, id_expr, display, parent, relations, vars, properties, set, merge, append 등)은 식이다
    for (const [k, v] of Object.entries(rule)) if (k !== 'id') exprKeys(v, out)
  }
  const pv = prof.privacy ?? {}
  for (const k of [...(pv.secret_leaf_names ?? []), ...(pv.object_rules ?? []).flatMap(r => r?.fields ?? [])]) out.keys.add(k)
  for (const p of [...(pv.secret_paths ?? []), ...(pv.write_only_paths ?? [])]) { const top = splitPath(p)[0]; if (top) out.keys.add(top) }
  return out
}
const declaredTest = P => {
  const { keys, prefixes } = P.declared ?? declaredOf(P.prof)
  return k => keys.has(k) || prefixes.some(p => k.startsWith(p))
}

// ---------- 값 꺼내기 ----------
// 경로: 'a.b', 'a[*].b', 배열 ['a', '*', 'b']. '*' 는 배열을 펼친다. 결과는 값 목록
function walk(v, segs) {
  let cur = [{ v, chain: [] }]
  for (const s of segs) {
    const next = []
    for (const c of cur) {
      if (c.v == null) continue
      if (s === '*') { if (Array.isArray(c.v)) for (const x of c.v) next.push({ v: x, chain: [...c.chain, c.v] }); else if (typeof c.v === 'object') for (const x of Object.values(c.v)) next.push({ v: x, chain: [...c.chain, c.v] }) }
      else if (Array.isArray(c.v) && !/^\d+$/.test(s)) { for (const x of c.v) if (x && typeof x === 'object' && s in x) next.push({ v: x[s], chain: [...c.chain, c.v, x] }) }
      else if (typeof c.v === 'object' && s in c.v) next.push({ v: c.v[s], chain: [...c.chain, c.v] })
    }
    cur = next
  }
  return cur
}
const splitPath = p => Array.isArray(p) ? p.map(String) : String(p).replace(/\[\*\]/g, '.*').split('.').filter(Boolean)
const getAll = (rec, p) => walk(rec, splitPath(p)).map(x => x.v).filter(x => x !== undefined)
const getOne = (rec, p) => { const v = getAll(rec, p); return v.length ? v[0] : undefined }

// Salesforce 15자 ID → 18자
function sfId18(id) {
  if (typeof id !== 'string' || id.length !== 15) return id
  const map = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'
  let suffix = ''
  for (let i = 0; i < 3; i++) { let flags = 0; for (let j = 0; j < 5; j++) { const c = id[i * 5 + j]; if (c >= 'A' && c <= 'Z') flags |= 1 << j } suffix += map[flags] }
  return id + suffix
}

// 요청 경로 변수: envelope URL 을 수집 연결의 path_template 과 오른쪽 끝부터 맞춘다
function pathParams(endpoint, template) {
  if (!endpoint || !template) return {}
  const urlPath = endpoint.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
  const u = urlPath.split('/').filter(Boolean).map(decodeURIComponent), t = template.split('?')[0].split('/').filter(Boolean)
  const out = {}
  for (let i = 1; i <= t.length && i <= u.length; i++) {
    const ts = t[t.length - i], us = u[u.length - i]
    const m = /^\{([^}]+)\}$/.exec(ts)
    if (m) out[m[1]] = us
    else if (ts !== us && !ts.includes('{')) break
  }
  return out
}
// 부모 ID: 목록 경로(/orgs/{org}/repos)는 마지막 경로 변수, 단건 경로(/x/{a}/y/{b})는 끝에서 두 번째
function parentParam(template, params) {
  const t = (template ?? '').split('?')[0].split('/').filter(Boolean)
  const vars = t.map((s, i) => [s, i]).filter(([s]) => /^\{[^}]+\}$/.test(s))
  if (!vars.length) return undefined
  const lastIsVar = /^\{[^}]+\}$/.test(t[t.length - 1] ?? '')
  const pick = lastIsVar ? vars[vars.length - 2] : vars[vars.length - 1]
  return pick ? params[pick[0].slice(1, -1)] : undefined
}

// ---------- 비밀값 제거 ----------
function scrub(value, privacy, stats, prefix = '') {
  if (value == null) return value
  const leaf = new Set(privacy?.secret_leaf_names ?? [])
  const dropPaths = new Set([...(privacy?.secret_paths ?? []), ...(privacy?.write_only_paths ?? [])])
  const tokens = (privacy?.token_patterns ?? []).map(p => new RegExp(p))
  const rules = privacy?.object_rules ?? []
  const fieldPath = Array.isArray(prefix) ? prefix.join('.') : prefix
  if (fieldPath && (leaf.has(fieldPath.split('.').at(-1)) || dropPaths.has(fieldPath))) {
    stats.secrets++
    return undefined
  }
  const rec = (v, p) => {
    if (typeof v === 'string') {
      const digest = /(?:^|[._])(?:sha|sha1|sha256|fingerprint)(?:$|_)/i.test(p) && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(v)
      if (!digest && tokens.some(r => r.test(v))) { stats.secrets++; return '[redacted:token]' }
      return v
    }
    if (Array.isArray(v)) return v.map(x => rec(x, p))
    if (v && typeof v === 'object') {
      const drop = new Set(rules.filter(r => r.when_key in v).flatMap(r => r.fields))
      const o = {}
      for (const [k, x] of Object.entries(v)) {
        const kp = p ? `${p}.${k}` : k
        if (leaf.has(k) || dropPaths.has(kp) || drop.has(k)) { stats.secrets++; continue }
        o[k] = rec(x, kp)
      }
      return o
    }
    return v
  }
  return rec(value, prefix)
}

// ---------- 입력 ----------
const profiles = loadProfiles()
// 타입 판정: 연구 타입 ID 로 찾고, ID 가 없는 실행 판정 행(V3.2 record_projection 등)은 runtime_type_id 로 찾는다
const typeRows = readJsonl(path.join(V31, 'objects/object-types.jsonl'))
const byTypeId = new Map(typeRows.filter(r => r.object_type_id).map(r => [r.object_type_id, r]))
const byRuntimeId = new Map(typeRows.filter(r => r.runtime_type_id).map(r => [r.runtime_type_id, r]))
const disposition = { get: model => model?.research_type ? byTypeId.get(model.research_type) : model?.runtime_type_id ? byRuntimeId.get(model.runtime_type_id) : undefined }
const vocab = new Map(JSON.parse(fs.readFileSync(path.join(V31, 'relations/vocabulary.json'), 'utf8')).relation_types.map(r => [r.relation_type, r.template]))
const operationRoutes = readJsonl(path.join(V31, 'evidence/observation-operation-links.jsonl')).filter(l => l.operation?.status === 'matched')
const links = linkOperations(cohortData.pages, [...operationRoutes, ...profileRoutes(profiles), ...envelopeRoutes(cohortData.pages, approvedApiList(path.join(ROOT, '../api-list/api-list.jsonl')))])

// operation → 이 operation 을 읽는 Profile 들
const byOp = new Map()
const addUse = (op, use) => { if (!op) return; if (!byOp.has(op)) byOp.set(op, []); byOp.get(op).push(use) }
const skipped = { non_object: 0, no_binding: 0 }
for (const P of profiles) {
  const b = P.prof.binding ?? {}
  if (P.prof.runtime_rules) continue
  if (b.status === 'non_object' || disposition.get(P.prof.model)?.disposition === 'non_object') { skipped.non_object++; continue }
  if (!b.operation_id) { skipped.no_binding++; continue }
  addUse(b.operation_id, { P, role: 'primary', path: b.paths?.[0]?.path ?? [], each: b.each })
  for (const s of b.sources ?? []) addUse(s.operation_id, { P, role: 'source', path: s.path ?? [] })
  for (const s of b.observed_sources ?? []) addUse(s.operation_id, { P, role: 'observed', path: s.path ?? [], partial: true })
}

// ---------- 정규화 ----------
const objects = new Map()          // key -> FixtureObject
const pending = []                 // 참조·관계는 모든 객체를 만든 뒤 푼다
const stats = new Map()            // profile file -> 집계
const report = { pages: 0, pages_used: 0, records: 0, objects_new: 0, objects_merged: 0, rejected_identity: [], quarantined_fields: {}, secrets_removed: 0, unresolved_references: 0, relations: 0, relations_unresolved: [], membership_enforced_conflicts: [] }
const st = f => stats.get(f) ?? stats.set(f, { records: 0, objects: new Set(), rejected: 0, roles: {} }).get(f)

// ---------- 같은 실체 합치기 ----------
// 기준 모델 identity/same-entity/<p>.json 의 그룹에서 키로 같은 실체를 가리키는 형태(key_only, model_key, global, promoted_key)는
// 대표(canonical) 타입의 키로 합친다. 값으로만 맞춘 형태(value_identity), 범위 안 ID(local), write_addressed 는 합치지 않는다.
// 보정 키: emit: reference_only (객체를 만들지 않음), emit: { merge_into: <같은 provider 의 object_type> } (그 타입 키로 합침)
const MERGE_FORMS = new Set(['key_only', 'model_key', 'global', 'promoted_key'])
const canonOf = new Map()   // `${research provider}|${member type}` -> { type, basis }
{
  const dir = path.join(V31, 'identity/same-entity')
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('diff'))) {
    const p = f.replace(/\.json$/, '')
    for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).groups ?? []) {
      if (!MERGE_FORMS.has(g.forms?.[g.canonical])) continue
      for (const m of g.members ?? []) if (m !== g.canonical && MERGE_FORMS.has(g.forms?.[m])) canonOf.set(`${p}|${m}`, { type: g.canonical, basis: `same_entity:${p}:${g.canonical}` })
    }
  }
}
const profileOfType = new Map(profiles.map(P => [`${P.research_provider}|${P.prof.object_type}`, P]))
function canonType(P) {
  const into = P.prof.emit?.merge_into
  if (into) return { type: into, basis: 'overlay:emit.merge_into' }
  return canonOf.get(`${P.research_provider}|${P.prof.object_type}`) ?? { type: P.prof.object_type, basis: null }
}
function objectKey(P, comps) {
  return `im:${P.research_provider}:${canonType(P).type}:${comps.map(c => encodeURIComponent(String(c))).join('|')}`
}
// $req.<이름>: envelope request_params(수집기 이름). $path.<이름>: endpoint URL 을 path_template 으로 푼 값(IR 이름)
function ctxValue(ctx, expr) {
  if (expr === '$req.parent_id') return ctx.parent_id
  if (expr.startsWith('$path.')) return ctx.params[expr.slice(6)]
  const n = expr.slice(5)
  return ctx.request[n] ?? ctx.params[n]
}
// spec:5 식 문맥: $req(수집기 이름 우선, 없으면 URL 경로 변수), $parent(펼치기 전 레코드), $ctx.path, $vars(Profile vars, 적은 순서대로)
// 객체를 만드는 단계의 참조 식({ ref, prop }): 이미 만든 객체에서 찾는다. RefSpec { type, id, parts } | { type, lookup, value, ci } | { key } | { switch, cases, default }
function refObjects(P, type) { return (keysByTypeProvider.get(`${dashProvider(P.research_provider)}|${type}`) ?? []).map(k => objects.get(k)) }
function resolveRefGlobal(P, spec, sc) {
  if (!spec || typeof spec !== 'object') return undefined
  if (spec.switch !== undefined) { const v = evalExpr(spec.switch, sc); return resolveRefGlobal(P, spec.cases && present(v) && String(v) in spec.cases ? spec.cases[String(v)] : spec.default, sc) }
  if (spec.key !== undefined) { const k = evalExpr(spec.key, sc); return present(k) && objects.has(String(k)) ? String(k) : undefined }
  if (spec.lookup !== undefined) {
    const value = evalExpr(spec.value, sc)
    if (!present(value)) return undefined
    const eq = x => x != null && (spec.ci ? String(x).toLowerCase() === String(value).toLowerCase() : String(x) === String(value))
    for (const f of Array.isArray(spec.lookup) ? spec.lookup : [spec.lookup]) for (const o of refObjects(P, spec.type)) {
      const pv = o.canonical.properties[f]
      if (eq(o.canonical.identifiers[f]?.value) || (Array.isArray(pv) ? pv.some(eq) : eq(pv))) return o.fixture_key
    }
    return undefined
  }
  const id = evalExpr(spec.id, sc)
  if (!present(id)) return undefined
  const parts = Object.fromEntries(Object.entries(spec.parts ?? {}).map(([k, x]) => [k, evalExpr(x, sc)]))
  for (const Q of profiles.filter(Q => dashProvider(Q.research_provider) === dashProvider(P.research_provider) && Q.prof.object_type === spec.type)) {
    const prim = Q.prof.identity?.primary ?? []
    const comps = prim.length === 1 ? [id] : prim.map(k => parts[k.name] ?? (k.name === 'id' ? id : undefined))
    if (comps.some(c => !present(c))) continue
    const k = objectKey(Q, comps.map((c, i) => (prim[i]?.normalization ?? []).includes('to_18_char') ? sfId18(c) : c))
    if (objects.has(k)) return k
  }
  return undefined
}
function exprScope(P, rec, ctx) {
  if (ctx.scope) return ctx.scope
  const sc = { r: rec, parent: ctx.parent, req: { ...(ctx.params ?? {}), ...(ctx.request ?? {}) }, endpoint: ctx.endpoint ?? '', ctx: { path: ctx.params ?? {} }, vars: {} }
  sc.propOf = (ref, prop, s2) => {
    const k = resolveRefGlobal(P, ref, s2)
    if (!k) return undefined
    if (prop === '$key') return k
    const o = objects.get(k)
    if (prop === '$id') return o.canonical.identifiers[o.canonical.identifiers.primary?.[0]]?.value
    if (prop === '$display') return o.fixture_meta?.display_name
    if (prop.startsWith('identifiers.')) return o.canonical.identifiers[prop.slice(12)]?.value
    return getPath(o.canonical.properties, prop)
  }
  sc.has = (ref, s2) => !!resolveRefGlobal(P, ref, s2)
  sc.objects = type => refObjects(P, type).map(o => ({ key: o.fixture_key, properties: o.canonical.properties }))
  for (const [k, x] of Object.entries(P.prof.vars ?? {})) sc.vars[k] = evalExpr(x, sc)
  return sc
}
const isEngineExpr = e => (e && typeof e === 'object') || (typeof e === 'string' && e.startsWith('$') && !/^\$(req|path)\./.test(e) && e !== '$record_hash')
function identityOf(P, rec, ctx) {
  const comps = [], ids = {}
  let sc
  for (const k of P.prof.identity?.primary ?? []) {
    let v
    if (k.expr === '$record_hash') v = sha(stable(rec)).slice(0, 16)
    else if (k.expr === '$req.parent_id') v = ctx.parent_id
    else if (typeof k.expr === 'string' && /^\$(req|path)\./.test(k.expr)) v = ctxValue(ctx, k.expr)
    else if (isEngineExpr(k.expr)) v = evalExpr(k.expr, sc ??= exprScope(P, rec, ctx))
    else v = getOne(rec, k.expr)
    if (v != null && (k.normalization ?? []).includes('to_18_char')) v = sfId18(v)
    if (v == null || v === '' || typeof v === 'object') return null
    comps.push(v); ids[k.name] = { value: v, stability: k.stability ?? 'stable' }
  }
  return comps.length ? { comps, ids, names: (P.prof.identity.primary).map(k => k.name) } : null
}

// 레코드 하나를 Profile 로 객체로 만든다(있으면 합친다). use.role: primary | source | observed | created
const keysByTypeProvider = new Map()
function withRuleIdentity(P, rule) {
  return rule?.identity ? { ...P, prof: { ...P.prof, identity: { ...P.prof.identity, ...rule.identity } } } : P
}
function emitRecord(P, rec, ctx, obs, use) {
  const s = st(P.file)
  report.records++; s.records++
  const id = identityOf(P, rec, ctx)
  if (!id) { s.rejected++; if (report.rejected_identity.length < 200) report.rejected_identity.push({ profile: P.file, role: use.role, call: obs.params?.call_id, missing: (P.prof.identity?.primary ?? []).map(k => k.expr) }); return null }
  if (P.prof.emit === 'reference_only') { s.reference_only = (s.reference_only ?? 0) + 1; return null }
  const key = objectKey(P, id.comps)
  s.objects.add(key)
  // 선언 필드만 properties 로. 선언 밖 최상위 키는 이름만 격리 목록에 둔다(unknown_fields: quarantine_record)
  const fields = P.prof.fields ?? {}
  const scr = { secrets: 0 }
  const props = {}
  // 필드 값: expr(spec:5 식)이 있으면 그것, 없으면 path
  let fsc
  for (const [name, f] of Object.entries(fields)) {
    const v = f.expr !== undefined ? evalExpr(f.expr, fsc ??= exprScope(P, rec, ctx)) : getOne(rec, f.path ?? name)
    if (v !== undefined) props[name] = scrub(v, P.prof.privacy, scr, f.path ?? name)
  }
  const isDeclared = declaredTest(P)
  const quarantined = rec && typeof rec === 'object' ? Object.keys(rec).filter(k => !isDeclared(k)) : []
  const qs = report.quarantined_fields[P.file] ??= { records: 0, fields: {} }
  qs.records++
  for (const q of quarantined) qs.fields[q] = (qs.fields[q] ?? 0) + 1
  report.secrets_removed += scr.secrets
  const judged = Object.fromEntries(Object.entries(P.prof.row_contracts ?? {}).filter(([, v]) => v && typeof v === 'object' && 'const' in v).map(([k, v]) => [k, v.const]))
  const constants = Object.fromEntries(Object.entries(P.prof.constants ?? {}).filter(([, v]) => v && typeof v === 'object' && 'const' in v).map(([k, v]) => [k, v.const]))
  const existing = objects.get(key)
  if (existing) {
    report.objects_merged++
    const c = existing.canonical
    pushUnique(c.source.observations, obs)
    // 대표 출처가 이긴다. 박힌 사본(partial)은 빈 값만 채운다
    const firstReviewed = use.role === 'rule' && !existing.fixture_meta.im_profile.roles.includes('rule')
    for (const [k, v] of Object.entries(props)) if (c.properties[k] === undefined || (c.properties[k] === null && v !== null) || firstReviewed || (use.role === 'primary' && existing.fixture_meta.im_profile.partial)) c.properties[k] = v
    if (use.role !== 'observed') existing.fixture_meta.im_profile.partial = false
    existing.fixture_meta.im_profile.roles = [...new Set([...existing.fixture_meta.im_profile.roles, use.role])]
    if (!existing.fixture_meta.im_profile.files.includes(P.file)) existing.fixture_meta.im_profile.files.push(P.file)
    // 버린 필드 목록도 합친다. 이 Profile 이 읽은 키와, 앞선 Profile 이 이미 속성으로 담은 키는 버린 것이 아니다
    const prevQ = existing.fixture_meta.im_profile.quarantined_fields ?? []
    const readNow = k => rec && typeof rec === 'object' && k in rec && isDeclared(k)
    existing.fixture_meta.im_profile.quarantined_fields = [...new Set([...prevQ, ...quarantined])].filter(k => !readNow(k) && !(k in c.properties))
  } else {
    report.objects_new++
    // 인터페이스는 기준 모델의 타입 판정을 따른다(V3.2 R3-D02 등). 판정이 없으면 Profile 값
    // 합친 타입이면 대표 타입 Profile 의 판정을 쓴다
    const ct = canonType(P), CP = ct.basis ? (profileOfType.get(`${P.research_provider}|${ct.type}`) ?? P) : P
    const ifaces = CP.overlayInterfaces ?? disposition.get(CP.prof.model)?.interfaces ?? CP.prof.interfaces
    const ifaceOverride = JSON.stringify(ifaces) !== JSON.stringify(CP.prof.interfaces) ? { profile_interfaces: CP.prof.interfaces } : {}
    objects.set(key, {
      fixture_key: key,
      catalog_ref: { id: CP.prof.model?.research_type ?? CP.file, provider_term: ct.type, interface: ifaces },
      canonical: {
        provider: dashProvider(P.research_provider),
        ...(P.research_provider !== dashProvider(P.research_provider) ? { service: P.research_provider } : P.prof.service ? { service: P.prof.service } : {}),
        object_type: ct.type,
        interfaces: ifaces,
        identifiers: { primary: id.names, ...id.ids },
        references: {},
        properties: props,
        judged,
        source: { schema_version: 4, observations: [obs] },
      },
      fixture_meta: {
        display_name: displayNameOf(P, props, id.comps),
        normal: true,
        im_profile: { file: P.file, files: [P.file], research_type: CP.prof.model?.research_type ?? null, overlaid: P.overlaid, ...ifaceOverride, ...(ct.basis ? { merged_by: ct.basis, member_type: P.prof.object_type } : {}), roles: [use.role], partial: use.role === 'observed', profile_constants: constants, quarantined_fields: quarantined },
      },
    })
    const tk = `${objects.get(key).canonical.provider}|${ct.type}`
    if (!keysByTypeProvider.has(tk)) keysByTypeProvider.set(tk, [])
    keysByTypeProvider.get(tk).push(key)
  }
  const item = { P, key, rec, ctx, obs }
  if (obs.params?.probe && rec && typeof rec === 'object' && !Array.isArray(rec)) {
    const idField = ['id','key','name','slug','orgUnitId','deviceId','resourceId','codeId','client_id'].find(f => ['string','number'].includes(typeof rec[f]))
    const native = idField ? String(rec[idField]) : sha(JSON.stringify(rec)).slice(0,16)
    const prefix = {github:'GH',okta:'OKTA',slack:'SLK',gws:'GWS'}[dashProvider(P.research_provider)]
    const type = String(obs.params.probe).replace(/[^A-Za-z0-9]+/g,'').toUpperCase().slice(0,16)
    const repo = /^\/repos\/[^/]+\/([^/]+)\//.exec(String(obs.params.path ?? ''))?.[1]
    const probeKey = `${prefix}-X${type}-${repo ? `${repo}-` : ''}${native}`.replace(/[^A-Za-z0-9._-]/g,'_')
    const meta = objects.get(key).fixture_meta.im_profile
    meta.legacy_keys = [...new Set([...(meta.legacy_keys ?? []),probeKey])]
  }
  pending.push(item)
  return item
}

const hasRef = x => x && typeof x === 'object' && (Array.isArray(x) ? x.some(hasRef) : ('ref' in x && 'prop' in x) || Object.values(x).some(hasRef))
const deferredProfiles = new Set(profiles.filter(P => hasRef(P.prof.vars) || hasRef((P.prof.identity?.primary ?? []).map(k => k.expr)) || hasRef(Object.values(P.prof.fields ?? {}).map(f => f.expr))))
const deferred = []
const genericUsedPages = new Set()
for (const l of links) {
  report.pages++
  // 같은 페이지의 다른 원문 view(alternates)를 binding 한 Profile 도 이 페이지를 읽는다
  const uses = [l.operation.ir_operation_id, ...(l.operation.alternates ?? [])].flatMap(op => byOp.get(op) ?? [])
  if (!uses.length) continue
  const file = path.join(COHORT.root, 'raw', COHORT.run, l.source.raw_file)
  if (!fs.existsSync(file)) continue
  const env = JSON.parse(fs.readFileSync(file, 'utf8'))
  report.pages_used++
  genericUsedPages.add(l.source.raw_file)
  const query = env.endpoint?.includes('?') ? Object.fromEntries(new URL(env.endpoint).searchParams.entries()) : {}
  const params = { ...query, ...pathParams(env.endpoint, l.operation.path_template) }
  const ctx = { request: { ...query, ...(env.request_params ?? {}) }, params, parent_id: parentParam(l.operation.path_template, params), endpoint: env.endpoint, path_template: l.operation.path_template }
  const obs = { api: env.endpoint, params: { call_id: env.call_id, ...(env.request_params ?? {}) }, record: 'measured', collected_at: env.collected_at }
  for (const use of uses) {
    const { P } = use, s = st(P.file)
    s.roles[use.role] = (s.roles[use.role] ?? 0) + 1
    for (const { v: rec, chain } of walk(env.payload, splitPath(use.path))) {
      if (rec == null || typeof rec !== 'object' || Array.isArray(rec)) continue
      // binding.each: 레코드 안 배열의 각 원소를 레코드로 읽는다(원소가 문자열이어도 된다). $parent 는 펼치기 전 레코드다 (spec:5 sources.each 와 같다)
      if (use.each) {
        for (const sub of [getPath(rec, use.each)].flat().filter(x => x != null)) {
          if (deferredProfiles.has(P)) deferred.push({ P, rec: sub, ctx: { ...ctx, parent: rec }, obs, use })
          else emitRecord(P, sub, { ...ctx, parent: rec }, obs, use)
        }
        continue
      }
      const parent = [...chain].reverse().find(x => x && typeof x === 'object' && !Array.isArray(x))
      // 다른 객체를 참조하는 식(vars·식별자·필드의 ref)을 쓰는 Profile 은 두 번째 패스에서 만든다(engine run.order 에서 대상 타입을 먼저 만드는 것과 같다)
      if (deferredProfiles.has(P)) deferred.push({ P, rec, ctx: { ...ctx, parent }, obs, use })
      else emitRecord(P, rec, { ...ctx, parent }, obs, use)
    }
  }
}
// 두 번째 패스. 참조하는 Profile 끼리는 한 번 더 돌려 앞 패스에서 못 푼 것을 푼다
for (let pass = 0; pass < 2 && deferred.length; pass++) {
  const retry = []
  for (const d of deferred) {
    const before = st(d.P.file).rejected
    const item = emitRecord(d.P, d.rec, d.ctx, d.obs, d.use)
    if (!item && pass === 0 && st(d.P.file).rejected > before) { st(d.P.file).rejected--; report.records--; st(d.P.file).records--; report.rejected_identity.pop(); retry.push(d) }
  }
  deferred.length = 0
  deferred.push(...retry)
}

// ---------- 참조와 관계 ----------
// 대상 찾기: 같은 연구 provider(없으면 같은 대시보드 provider)의 object_type 이 같은 Profile 로 키를 만든다.
// 대상 Profile 의 primary 가 하나일 때만 값으로 키를 만들 수 있다(복합 키는 값 하나로 풀 수 없다)
const profilesByType = new Map()
for (const P of profiles) { const k = `${P.research_provider}|${P.prof.object_type}`; if (!profilesByType.has(k)) profilesByType.set(k, []); profilesByType.get(k).push(P) }
const spaceTypes = new Map()
for(const P of profiles){const row=disposition.get(P.prof.model);for(const name of [row?.space?.split(':').slice(1).join(':'),...(row?.members??[])].filter(Boolean))spaceTypes.set(`${P.research_provider}|${name}`,P.prof.object_type)}
const targetTypeOf=(P,t)=>spaceTypes.get(`${P.research_provider}|${t}`)??t

// lookup: 대상 primary 가 아닌 식별자·속성으로 찾는다(references[].lookup: 이름 또는 이름 목록, lookup_ci: 대소문자 무시)
// 합친 타입(emit.merge_into, same-entity)을 가리키는 lookup 은 대표 타입 객체에서 찾는다. 객체는 대표 타입으로만 색인된다
const mergedTypeOf=(P,t)=>{const Q=profileOfType.get(`${P.research_provider}|${t}`);return Q?canonType(Q).type:t}
function lookupKeys(P, targetType, fields, value, ci) {
  targetType=mergedTypeOf(P,targetTypeOf(P,targetType))
  const out = new Set()
  for (const k of keysByTypeProvider.get(`${dashProvider(P.research_provider)}|${targetType}`) ?? []) {
    const o = objects.get(k)
    for (const f of fields) {
      const idv = o.canonical.identifiers[f]?.value, pv = o.canonical.properties[f]
      const eq = x => x != null && (ci ? String(x).toLowerCase() === String(value).toLowerCase() : String(x) === String(value))
      if (eq(idv) || (Array.isArray(pv) ? pv.some(eq) : eq(pv))) { out.add(k); break }
    }
  }
  return [...out]
}
function resolveTarget(P, targetType, value, lookup, ci) {
  targetType=targetTypeOf(P,targetType)
  if (lookup) {
    const ks = lookupKeys(P, targetType, Array.isArray(lookup) ? lookup : [lookup], value, ci)
    return ks.length === 1 ? { status: 'resolved', key: ks[0] } : ks.length ? { status: 'ambiguous', keys: ks } : { status: 'unresolved' }
  }
  const cands = [...(profilesByType.get(`${P.research_provider}|${targetType}`) ?? []),
    ...profiles.filter(Q => Q.research_provider !== P.research_provider && dashProvider(Q.research_provider) === dashProvider(P.research_provider) && Q.prof.object_type === targetType)]
  const keys = []
  for (const Q of cands) {
    if ((Q.prof.identity?.primary ?? []).length !== 1) continue
    let v = value
    if ((Q.prof.identity.primary[0].normalization ?? []).includes('to_18_char')) v = sfId18(v)
    const k = objectKey(Q, [v])
    if (objects.has(k)) keys.push(k)
  }
  const uniq = [...new Set(keys)]
  // 같은 값이 여러 대상 타입으로 풀리면 테넌트 범위가 모호하다. 연결하지 않고 보고한다
  if (uniq.length === 1) return { status: 'resolved', key: uniq[0] }
  if (uniq.length > 1) return { status: 'ambiguous', keys: uniq }
  return { status: 'unresolved' }
}

const relations = new Map()
function addRelation(P, type, src, dst, obs, extra = {}) {
  const so = objects.get(src), to = objects.get(dst)
  const ref = (o, kind) => ({ provider: o.canonical.provider, object_type: o.canonical.object_type, identifier_type: 'primary', value: o.fixture_key, kind })
  const roleTag = extra.role ? ('key' in extra.role ? extra.role.key : `name:${extra.role.name}`) : ''
  const fk = ['R', type, src, dst, roleTag].filter(Boolean).join('|')
  if (relations.has(fk)) {
    const existing = relations.get(fk).canonical
    const nextBasis = extra.basis ?? 'stated'
    const rank = {stated:2,computed:1,flag:0}
    if(rank[nextBasis]>=rank[existing.properties.basis])existing.properties = { ...(extra.properties ?? {}), ...existing.properties }
    if(rank[nextBasis]>rank[existing.properties.basis])existing.properties.basis = nextBasis
    // 집행 표시는 basis 순위와 따로 합친다: 순위가 낮은 선언이 나중에 와도 값을 잃지 않는다. 두 선언이 다르게 적으면 출력 검사가 멈춘다
    const enforced = extra.properties?.membership_enforced
    if (enforced !== undefined) {
      if (existing.properties.membership_enforced === undefined) existing.properties.membership_enforced = enforced
      else if (existing.properties.membership_enforced !== enforced && !report.membership_enforced_conflicts.some(c => c.relation === fk)) {
        // 관계 키는 실측 이름이 들 수 있어 실패 문구에는 Profile 과 값만 낸다(verify-output membership_enforced_consistent)
        const profiles = [...new Set([...(existing.source.produced_by ?? []), `im-profile-runner:${P.file}`].map(x => String(x).replace(/^im-profile-runner:/, '').replace(/#.*$/, '')))]
        report.membership_enforced_conflicts.push({ relation: fk, profiles, values: [existing.properties.membership_enforced, enforced] })
      }
    }
    const produced = `im-profile-runner:${P.file}${extra.rule ? `#${extra.rule}` : ''}`
    existing.source.produced_by = [...new Set([...(existing.source.produced_by ?? []), produced])]
    return
  }
  relations.set(fk, {
    fixture_key: fk,
    canonical: {
      provider: so.canonical.provider, relation_type: type, template: vocab.get(type) ?? null,
      references: {
        source: ref(so, 'source'),
        ...(extra.role && 'key' in extra.role && objects.get(extra.role.key) ? { role: { ...ref(objects.get(extra.role.key), 'role'), status: 'confirmed' } } : {}),
        ...(extra.role && 'name' in extra.role ? { role: { provider: so.canonical.provider, object_type: 'NamedRole', identifier_type: 'native', value: String(extra.role.name), kind: 'role', status: 'named' } } : {}),
        target: ref(to, 'target'),
      },
      properties: { basis: extra.basis ?? 'stated', ...(extra.properties ?? {}) },
      source: { api: obs.api, params: obs.params, record: 'measured', schema_version: 4, collected_at: obs.collected_at, produced_by: [`im-profile-runner:${P.file}${extra.rule ? `#${extra.rule}` : ''}`] },
    },
  })
  report.relations++
}

// 집행 표시(knowledge Profile_Schema_v4.2 「membership_enforced」): 관계 선언의 true, false 를 basis 처럼 관계 행 속성으로 옮긴다.
// 생략은 모름이라 싣지 않는다. 값 검사는 verify-output 의 membership_enforced_on_grants, 같은 관계의 값이 어긋나면 membership_enforced_consistent
const enforcedOf = decl => decl.membership_enforced === undefined ? {} : { membership_enforced: decl.membership_enforced }

// 테넌트: tenant_binding.type 과 같은 타입의 객체가 그 provider 에 하나면 그것이다
const tenantOf = new Map()
function tenantKey(P) {
  const tb = P.prof.tenant_binding
  if (!tb?.type) return null
  const k = `${dashProvider(P.research_provider)}|${tb.type}`
  const ks = keysByTypeProvider.get(k) ?? []
  return ks.length === 1 ? ks[0] : null
}

const FALLBACK_LOOKUP = ['login', 'name', 'full_name', 'slug', 'email', 'primaryEmail', 'key']
report.reference_lookup_fallback = new Map()
report.reference_outcomes = []
// A reused response shape does not inherit the parent type of some other API route.
function scopeTarget(P, r, ctx) {
  r={...r,target:targetTypeOf(P,r.target)}
  if(P.research_provider==='slack'&&r.target==='external_target'&&/(creator|user_id|owner)/.test(r.field))return{...r,target:'200.members[*]'}
  if (r.field !== '$req.parent_id') return r
  const segs = (ctx.path_template ?? '').split('?')[0].split('/').filter(Boolean)
  const vars = segs.map((s,i)=>({s,i})).filter(x=>/^\{[^}]+\}$/.test(x.s))
  const lastIsVariable = /^\{[^}]+\}$/.test(segs.at(-1) ?? '')
  const parent = lastIsVariable ? vars.at(-2) : vars.at(-1)
  const segment = parent?.s==='{repo}' ? 'repos' : parent && segs[parent.i-1]
  const provider = dashProvider(P.research_provider)
  const types = provider==='okta' ? {users:'User',groups:'Group',apps:'Application',policies:'Policy','resource-sets':'ResourceSet',roles:'CustomRole',authorizationServers:'AuthorizationServer'}
    : provider==='github' ? {repos:'Repository',orgs:'organization-full',users:'public-user',hooks:'org-hook',rulesets:'repository-ruleset'}
    : provider==='gws' ? {users:'User',groups:'Group',customer:'Customer',customers:'Customer',files:'File',projects:'Project',forms:'Form'} : {}
  if(provider==='okta')types.clients='OAuth2Client'
  const target=types[segment]
  return target ? {...r,target} : r
}
function processPending({ P, key, rec, ctx, obs }) {
  const o = objects.get(key)
  const refs = o.canonical.references
  const t = tenantKey(P)
  if (t && t !== key && !refs.tenant) refs.tenant = { kind: 'tenant', targets: [{ provider: o.canonical.provider, object_type: objects.get(t).canonical.object_type, identifier_type: 'primary', value: t }] }
  const resolvedRefs = {}
  let rsc
  for (const originalRef of P.prof.references ?? []) {
    const r = scopeTarget(P, originalRef, ctx)
    if (r.when && !evalCond(r.when, rsc ??= exprScope(P, rec, ctx))) continue
    const refExpr = r.expr !== undefined ? r.expr : r.field
    let raw
    if (r.expr !== undefined || isEngineExpr(r.field)) {
      raw = [evalExpr(refExpr, rsc ??= exprScope(P, rec, ctx))]
    } else if (/^\$(req|path)\./.test(String(r.field))) {
      raw = [ctxValue(ctx, r.field)]
    } else {
      raw = getAll(rec, r.field)
    }
    const vals = raw.flat().filter(v => v != null && v !== '' && typeof v !== 'object')
    if (!vals.length) continue
    const targets = []
    for (const v of vals) {
      const selfLocator = /(?:^|_)(?:links_)?self_href$/.test(r.name) || /(?:^|\.)_?links\.self\.href$/.test(typeof r.field === 'string' ? r.field : '')
        || (r.target===P.prof.object_type && ['id','node_id','client_id','html_url','url','self'].includes(r.field))
      const collectionLocator = /links_(metadata|users)_href$/.test(r.name)
      if(collectionLocator){targets.push({provider:o.canonical.provider,object_type:'external_target',identifier_type:'url',value:v,status:'external',reason:'api_endpoint_not_object_id'});continue}
      let res = selfLocator ? {status:'resolved',key} : resolveTarget(P, r.target, v, r.lookup, r.lookup_ci)
      if (res.status === 'unresolved' && !r.lookup) {
        for (const f of FALLBACK_LOOKUP) {
          const ks = lookupKeys(P, r.target, [f], v, f.toLowerCase().includes('email'))
          if (ks.length === 1) {
            res = { status: 'resolved', key: ks[0] }
            const fk = `${P.file}|${r.name}|${r.target}|${f}`
            report.reference_lookup_fallback.set(fk, (report.reference_lookup_fallback.get(fk) ?? 0) + 1)
            break
          }
        }
      }
      if (res.status === 'unresolved' && r.stub) {
        const tt = targetTypeOf(P, r.target)
        const cands = [...(profilesByType.get(P.research_provider + '|' + tt) ?? []),
          ...profiles.filter(Q => Q.research_provider !== P.research_provider && dashProvider(Q.research_provider) === dashProvider(P.research_provider) && Q.prof.object_type === tt)]
        const Q = cands.find(q => q.prof.runtime_stub && (q.prof.identity?.primary ?? []).length === 1)
        if (Q) {
          const primName = Q.prof.identity.primary[0].name
          const stubP = { ...Q, prof: { ...Q.prof, identity: { ...Q.prof.identity, primary: [{ name: primName, expr: primName }] }, fields: {}, vars: {}, references: [], relation_plans: [] } }
          const stubItem = emitRecord(stubP, { [primName]: v }, { request: {}, params: {}, parent_id: null }, obs, { role: 'stub' })
          if (stubItem) {
            const o = objects.get(stubItem.key)
            if (!stubItem.existing) {
              o.fixture_meta.stub = true
              o.fixture_meta.stub_via = 'reference in collected response'
              report.relation_rules.stubs = (report.relation_rules.stubs ?? 0) + 1
            }
            res = { status: 'resolved', key: stubItem.key }
          }
        }
      }
      if (res.status === 'resolved') targets.push({ provider: objects.get(res.key).canonical.provider, object_type: objects.get(res.key).canonical.object_type, identifier_type: 'primary', value: res.key })
      else {
        report.unresolved_references++
        // 그 종류 객체가 하나라도 있는지만 본다. 종류별 키 목록으로 센다(참조마다 전체를 훑지 않는다)
        const available = (keysByTypeProvider.get(`${o.canonical.provider}|${mergedTypeOf(P,r.target)}`) ?? []).length
        const classification = res.status === 'ambiguous' ? 'ambiguous_target' : available ? 'target_value_not_collected' : 'target_type_not_collected'
        report.reference_outcomes.push({profile:P.file,ref:r.name,target_type:r.target,classification,call:obs.params?.call_id,path_template:ctx.path_template})
        targets.push({ provider: o.canonical.provider, object_type: r.target, identifier_type: 'native', value: v, status: res.status, reason: classification })
      }
      if (res.status === 'resolved') (resolvedRefs[r.name] ??= []).push(res.key)
    }
    refs[r.name] = { kind: 'direct_id', targets: [...new Map([...(refs[r.name]?.targets ?? []),...targets].map(x=>[stable(x),x])).values()] }
  }
  for (const plan of P.prof.relation_plans ?? []) {
    const end = e => e === '$self' ? [key] : e === '$tenant' ? (t ? [t] : []) : String(e).startsWith('$refs.') ? (resolvedRefs[e.slice(6)] ?? []) : []
    const srcs = end(plan.source), dsts = end(plan.target), roles = plan.role ? end(plan.role) : [null]
    if (!srcs.length || !dsts.length || !roles.length) { if (report.relations_unresolved.length < 500) report.relations_unresolved.push({ profile: P.file, type: plan.type, source: plan.source, target: plan.target, missing: !srcs.length ? 'source' : !dsts.length ? 'target' : 'role' }); continue }
    // role: 역할 객체($refs.<이름>), properties: 고정 값 또는 $self(이 행 객체 키, 예: via_assignment)
    const properties = { ...Object.fromEntries(Object.entries(plan.properties ?? {}).map(([k, v]) => [k, v === '$self' ? key : v])), ...enforcedOf(plan) }
    for (const s of srcs) for (const d of dsts) for (const r of roles) if (s !== d) addRelation(P, plan.type, s, d, obs, { basis: plan.basis ?? 'stated', properties, ...(r ? { role: { key: r } } : {}) })
  }
}

memlog('generic')
// ---------- reviewed rules embedded in the new Profiles ----------
const runtime = runProfileRules({ root: ROOT, pages: cohortData.pages, profiles, config: runtimeConfig,
  objects, pending, report, evalExpr, evalCond, present, getPath, emitRecord, objectKey,
  identityOf, canonType, resolveTarget, addRelation, enforcedOf, scrub, sha, stable, sfId18, keysByTypeProvider, pushUnique })
for (const item of pending.splice(0)) processPending(item)
// Apply approved Q05 user-list bindings before the existing enrichment path.
// Bindings are read from Knowledge; unreviewed references never emit relations.
const modelBindings = readJsonl(path.join(V31, 'relations/relation-bindings.jsonl'))
applyReviewedReferenceRules({ bindings: modelBindings, objects, addRelation })
memlog('runtime')
const enriched = await enrichDataset({ tsImport, raw: cohortData.raw, objects, relations, profiles, config: runtimeConfig })
memlog('enrich')
relations.clear()
for (const r of enriched.relations) relations.set(r.fixture_key, r)
// R1-D01: retain the permission as ownership evidence instead of a second owner grant.
report.model_decisions = { owner_permission_coalesced: 0 }
if (modelBindings.some(b=>b.id==='relation-binding:gws-drive-file-owned-by'&&b.decision_refs?.includes('R1-D01'))) {
  // (파일, 사용자) → 처음 나온 owned_by. 관계마다 전체를 훑지 않는다(owned_by 는 이 반복에서 지우지 않는다)
  const ownedBy = new Map()
  for (const x of relations.values()) {
    if (x.canonical.relation_type !== 'owned_by') continue
    const k = `${x.canonical.references.source.value}\0${x.canonical.references.target.value}`
    if (!ownedBy.has(k)) ownedBy.set(k, x)
  }
  for (const [key,r] of relations) {
    const c=r.canonical
    if(c.provider!=='gws'||c.relation_type!=='has_role_on'||c.references.role?.value!=='owner')continue
    const user=c.references.source.value,file=c.references.target.value
    const ownership=ownedBy.get(`${file}\0${user}`)
    if(!ownership)continue
    if(c.properties.via_assignment)ownership.canonical.properties.via_assignment=c.properties.via_assignment
    relations.delete(key);report.model_decisions.owner_permission_coalesced++
  }
}
// ---------- 합치지 않은 같은 값 후보 ----------
// 같은 대시보드 provider 에서 단일 primary 값이 다른 타입 객체에 함께 나오면 같은 실체일 수 있다. 판정 근거가 없으니 합치지 않고 목록만 남긴다
const collisions = new Map()
{
  const byVal = new Map()
  for (const o of objects.values()) {
    const prim = o.canonical.identifiers.primary
    if (prim.length !== 1) continue
    const v = o.canonical.identifiers[prim[0]].value
    const k = `${o.canonical.provider}|${v}`
    if (!byVal.has(k)) byVal.set(k, new Set())
    byVal.get(k).add(o.canonical.object_type)
  }
  for (const [k, types] of byVal) if (types.size > 1) { const t = `${k.split('|')[0]}: ${[...types].sort().join(' = ')}`; collisions.set(t, (collisions.get(t) ?? 0) + 1) }
}
report.same_value_other_type = [...collisions.entries()].sort((a, b) => b[1] - a[1]).map(([types, values]) => ({ types, values }))
report.merged_types = [...new Set([...objects.values()].filter(o => o.fixture_meta.im_profile.merged_by).map(o => `${o.fixture_meta.im_profile.member_type} -> ${o.canonical.object_type} (${o.fixture_meta.im_profile.merged_by})`))]

// ---------- 출력 ----------
// Validate all products before touching the output directory.
const objs = [...objects.values()].sort((a, b) => a.fixture_key.localeCompare(b.fixture_key))
const rels = [...relations.values()].sort((a, b) => a.fixture_key.localeCompare(b.fixture_key))
memlog('sorted')
const {attachMediatedServicePaths,attachInvokerGates}=await tsImport('../../shared/mediatedServicePaths.ts',import.meta.url)
const mediatedPaths=attachMediatedServicePaths(objs,rels)
const invokerGates=attachInvokerGates(objs,rels)
const byProvider = {}, byType = {}
for (const o of objs) { byProvider[o.canonical.provider] = (byProvider[o.canonical.provider] ?? 0) + 1; const k = `${o.canonical.provider}:${o.canonical.object_type}`; byType[k] = (byType[k] ?? 0) + 1 }
const relByType = {}
for (const r of rels) relByType[r.canonical.relation_type] = (relByType[r.canonical.relation_type] ?? 0) + 1
const manifest = {
  version: '2.0.0', environment_id: 'AEGI-Inc', name: 'AEGI-Inc Measured SaaS Graph (IM Profile runner)', record: 'measured',
  created_at: new Date().toISOString(), source_runs: [COHORT.run], providers: Object.keys(byProvider).sort(),
  adapter: 'im-profile-runner', description: 'im-profile-binding Profile(binding 포함)으로 수집 원본을 직접 정규화한 데이터셋. 손코드 정규화기를 쓰지 않았다.',
  object_model: { version: JSON.parse(fs.readFileSync(path.join(V31, 'FREEZE.json'), 'utf8')).version, input: path.relative(ENGINE_ROOT,V31).replaceAll('\\','/'), profiles_loaded: profiles.length, overlays: profiles.filter(P => P.overlaid).length },
}
const write = (n, v) => writeJson(path.join(OUT, `${n}.json`), v)
const perProfile = [...stats.entries()].map(([f, s]) => ({ profile: f, records: s.records, objects: s.objects.size, rejected: s.rejected, ...(s.reference_only ? { reference_only: s.reference_only } : {}), roles: s.roles })).sort((a, b) => b.objects - a.objects)
const runnerReport = {
  mediated_service_paths: mediatedPaths,
  invoker_gates: invokerGates,
  run: RUN_ID, created_at: manifest.created_at, skipped_profiles: skipped,
  enrich_notes: enriched.notes,
  relation_rules: report.relation_rules,
  model_decisions: report.model_decisions,
  input: { raw: path.relative(ENGINE_ROOT, COHORT.root), run: COHORT.run, pages: cohortData.pages.length, unused_pages: cohortData.pages.filter(e => !genericUsedPages.has(e.__file) && !runtime.usedPages.includes(e.__file)).map(e => ({ file: e.__file, call_id: e.call_id, provider: e.provider })) },
  reference_outcomes: report.reference_outcomes,
  relation_outcomes: report.relation_outcomes,
  rule_source_units: runtime.outcomes,
  counts: { pages: runtime.totalPages, operation_linked_pages: new Set(links.map(l => l.source.raw_file)).size, pages_used: new Set([...genericUsedPages,...runtime.usedPages]).size, records: report.records, objects: objs.length, objects_merged: report.objects_merged, relations: rels.length, links: enriched.links.length, observations: enriched.observations.length, evidence_links: enriched.evidenceLinks.length, profiles_producing: perProfile.filter(p => p.objects).length, types: Object.keys(byType).length, secrets_removed: report.secrets_removed, unresolved_references: report.unresolved_references, rejected_identity: perProfile.reduce((a, p) => a + p.rejected, 0), relations_unresolved: report.relations_unresolved.length },
  objects_by_provider: byProvider, relations_by_type: relByType, objects_by_type: byType,
  reference_lookup_fallback: [...report.reference_lookup_fallback.entries()].map(([k, count]) => { const [profile, ref, target_type, matched_field] = k.split('|'); return { profile, ref, target_type, matched_field, count } }).sort((a, b) => b.count - a.count),
  merged_types: report.merged_types, same_value_other_type: report.same_value_other_type,
  per_profile: perProfile, rejected_identity_samples: report.rejected_identity.slice(0, 50), relations_unresolved: report.relations_unresolved,
  membership_enforced_conflicts: report.membership_enforced_conflicts,
  // Profile 마다 선언 밖이라 버린 최상위 필드 전부(자르지 않는다)
  quarantined_fields: Object.fromEntries(Object.entries(report.quarantined_fields).sort(([a], [b]) => a.localeCompare(b))
    .map(([file, q]) => [file, { records: q.records, fields: Object.fromEntries(Object.entries(q.fields).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) }])),
}
const files = { manifest, objects: objs, relations: rels, links: enriched.links, observations: enriched.observations, evidence_links: enriched.evidenceLinks }
const verification = verifyDataset({ ...files, report: runnerReport, modelDir: V31, strict: Boolean(options.strict) })
// 집행 표시 충돌은 어느 Profile 인지, 타입 검사는 어느 타입인지 실패 문구에 낸다(그 칸은 Profile 이름과 값, 타입 이름만 담는다). 다른 검사의 detail 은 객체 키라 내지 않는다
const DETAIL_IN_ERROR = new Set(['membership_enforced_consistent', 'relation_pairs_declared', 'no_api_path_object_types', 'no_property_less_types', 'no_identifier_only_types', 'no_dropped_field_bundles', 'identity_rejections_not_systemic'])
// 경고(식별 실패 몇 개 등)는 멈추지 않고 보고서와 화면에 남긴다. detail 은 Profile 이름과 수뿐이다
runnerReport.verification_warnings = verification.warnings ?? []
for (const w of runnerReport.verification_warnings) console.warn(`verify warning: ${w.name} ${JSON.stringify(w.detail ?? '')}`)
if (verification.status !== 'passed') throw new Error('IM Profile validation failed: ' + verification.checks.filter(c => !c.ok).map(c => (DETAIL_IN_ERROR.has(c.name) ? `${c.name} ${JSON.stringify(c.detail)}` : c.name)).join(', '))
const { buildProducts, writeProducts, identityLinkPairs, cutActionsShadow } = await tsImport('./products.ts', import.meta.url)
memlog('verify')
const products = buildProducts(files, cohortData.raw)
memlog('products')
// 동일인 링크 쌍: 약한 간선 둘 이상이라 EA 가 잇지 않은 쌍 수(C2 다시 볼 조건, 0 이 아니면 다시 본다)
runnerReport.identity_link_pairs = identityLinkPairs(files)
if (runnerReport.identity_link_pairs.status === 'error') console.warn('identity link pair count failed: ' + runnerReport.identity_link_pairs.error)
// 조치 동사 그림자(4층): 사전의 닫은 동사를 끊는 곳에 붙여 본 수. 운영 EA 와 위협 문장은 그대로다
runnerReport.cut_actions_shadow = cutActionsShadow(files, products)
if (runnerReport.cut_actions_shadow.status === 'error') console.warn('cut actions shadow failed: ' + runnerReport.cut_actions_shadow.error)
// 사건 기록(Activity): 로그 사건을 사건 사전으로 한 모양으로. 보관만 한다(files 와 products 밖이라 판정에 들지 않는다)
const { buildActivities } = await tsImport('../../shared/activities.ts', import.meta.url)
const activities = buildActivities(cohortData.raw, objs, { selfClientIds: (process.env.AEGI_GWS_SELF_CLIENT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean) })
runnerReport.activities = activities.summary
if (!options.check) {
  fs.mkdirSync(OUT, { recursive: true })
  write('manifest', manifest)
write('objects', objs)
write('relations', rels)
write('links', enriched.links)
write('observations', enriched.observations)
write('evidence_links', enriched.evidenceLinks)
write('activities', activities.records)

  write('runner-report', runnerReport)
  write('verify', verification)
  writeProducts(OUT, products)
}
return { files, report: runnerReport, verification, products }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    const options = parseOptions(process.argv.slice(2))
    if (options) {
      const result = await normalizeProfiles(options)
      console.log(JSON.stringify({ check: options.check, out: options.out, ...result.report.counts, link_pairs_blocked: result.report.identity_link_pairs.blocked ?? null }, null, 2))
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

