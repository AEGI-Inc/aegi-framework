// 연구 정보 고아 4,669항목 전부에 귀속 결과 또는 미결 사유를 붙인다. 원본 map 항목은 지우지 않는다.
// 자동 규칙은 하나다: 관측 operation 의 응답 root 가 고아 shape 이고 bridge 가 record 배열을 정했다면,
// 그 배열 밖의 속성은 목록 wrapper 메타데이터(O1, envelope_or_view)다. record 내용은 판정 표(config/orphan-judgments.json)를 따른다.
// 판정 표에 없고 record 공간도 없으면 unresolved 로 남긴다.
import path from 'node:path'
import { CONFIG, OUT, ROOT, ir, shape, readJson, readJsonl, writeJson, writeJsonl } from './lib.mjs'
import { graph, recordArrays, ancestors } from './lib-shape-graph.mjs'

// ---------- 관측이 없는 항목의 원문 기반 규칙 (config/source-rules.json, R1-D11) ----------
const SR = readJson(path.join(ROOT, 'config/source-rules.json'))
const auditOps = new Set(SR.audit_operations.ops)
const keyedCache = new Map()
function keyed(p, sid) {
  if (!keyedCache.has(p)) {
    const k = new Set(ir(p, 'key_decl').map(x => x.shape))
    for (const f of ir(p, 'id_format')) for (const a of f.applies ?? []) if (a.prop && !a.prop.includes('[')) k.add(`${a.shape}|${a.prop}`)
    keyedCache.set(p, k)
  }
  const k = keyedCache.get(p)
  if (k.has(sid)) return true
  return (shape(p, sid)?.props ?? []).some(x => k.has(`${sid}|${x.name}`) && x.name === 'id')
}
const posCache = new Map()
function positionSpace(p) {
  if (!posCache.has(p)) { const g = graph(p), m = new Map(); for (const [k, v] of Object.entries(g.spaces)) for (const pos of v.positions ?? []) if (!m.has(pos)) m.set(pos, k); posCache.set(p, m) }
  return posCache.get(p)
}
// 요청 경로에서 가장 긴 공간 위치 접두를 부모로 본다 (전체 경로 포함)
function pathParent(p, opId) {
  const o = ir(p, 'operation').find(x => x.id === opId)
  const t = o?.path?.template
  if (!t) return null
  const segs = t.split('/').map(x => (x.startsWith('{') && x.endsWith('}') ? '{}' : x)), pm = positionSpace(p)
  for (let n = segs.length; n > 0; n--) { const pos = segs.slice(0, n).join('/'); if (pm.has(pos) && segs[n - 1] === '{}') return { space: `${p}:${pm.get(pos)}`, position: pos, suffix: segs.slice(n).filter(x => x !== '{}').join('.') } }
  return null
}
function classifyRecord(p, recShape, ops, rel) {
  const g = graph(p)
  if (g.spaceOf.has(recShape)) return { disposition: 'bound_to_space', rule: 'S-E2', destination: { space: `${p}:${g.spaceOf.get(recShape)}`, relative_path: rel }, basis: 'record shape 가 pinned map 공간이다' }
  const aud = ops.filter(o => auditOps.has(o))
  if (aud.length) return { disposition: 'observation_only', rule: 'O3', source_rule: 'S-A', basis: '감사·이력 operation 의 record 다 (config/source-rules.json audit_operations)', operations: aud }
  if (keyed(p, recShape)) return { disposition: 'unresolved', unresolved_reason: 'keyed_record_without_space', basis: '원문이 key(key_decl 또는 id 형식)를 선언했지만 map 공간이 없다. Object 판정 대상', record_shape: recShape, operations: ops.slice(0, 5) }
  const views = ops.filter(o => SR.view_operation_prefixes.prefixes.some(x => o.startsWith(x)))
  if (views.length && views.length === ops.length) return { disposition: 'envelope_or_view', rule: 'O2', source_rule: 'S-V', basis: '검색 operation 의 결과 보기다 (config/source-rules.json view_operation_prefixes)', operations: views.slice(0, 5) }
  const parents = ops.map(o => pathParent(p, o)).filter(Boolean)
  const spacesP = [...new Set(parents.map(x => x.space))]
  if (spacesP.length) return { disposition: 'parent_property', rule: 'O4', source_rule: 'S-P', destination: { space_candidates: spacesP, relative_path: [parents[0].suffix, rel].filter(Boolean).join('.') }, basis: '자기 key 가 없는 record 다. 요청 경로의 부모 공간에 딸린 정보로 본다', operations: ops.slice(0, 5) }
  // S-T: 경로 변수가 없는 REST 읽기의 record. 범위는 provider 별 선언을 따른다
  const opsRow = ops.map(o => ir(p, 'operation').find(x => x.id === o)).filter(Boolean)
  const rootOnly = opsRow.length && opsRow.every(o => o.path?.template && !o.path.template.includes('{'))
  if (rootOnly) {
    const first = opsRow[0].path.template.split('/')[0], scope = SR.path_root_scope.first_segment_overrides[p]?.[first] ?? SR.path_root_scope.scope[p], single = opsRow.every(o => o.kind === 'read_one')
    if (scope === 'vendor_global') return { disposition: 'vendor_catalog', rule: 'O5', source_rule: 'S-T', basis: '벤더 전역 경로 root 의 정보다 (path_root_scope)', operations: ops.slice(0, 5) }
    if (single && scope === 'tenant') return { disposition: 'parent_property', rule: 'O6', source_rule: 'S-T', destination: { space_candidates: [`${p}:Tenant`], relative_path: rel }, basis: '테넌트 경로 root 의 단건 정보다. 조직에 하나뿐인 값은 테넌트 속성이다', operations: ops.slice(0, 5) }
    if (single && scope === 'token_principal') return { disposition: 'parent_property', rule: 'O4', source_rule: 'S-T', destination: { space_candidates: [`${p}:token principal (User 또는 Customer)`], relative_path: rel }, basis: '호출 주체 범위 경로 root 의 단건 정보다', operations: ops.slice(0, 5) }
    return { disposition: 'unresolved', unresolved_reason: 'root_scoped_keyless_list', basis: `범위(${scope}) root 의 key 없는 목록이다. 독립 대상인지 보기인지 원문 판정이 필요하다`, record_shape: recShape, operations: ops.slice(0, 5) }
  }
  return { disposition: 'unresolved', unresolved_reason: ops.some(o => !ir(p, 'operation').find(x => x.id === o)?.path) ? 'rpc_parent_not_declared' : 'no_parent_space', basis: 'record 공간·key·경로 부모를 원문에서 찾지 못했다', record_shape: recShape, operations: ops.slice(0, 5) }
}
function sourceBased(p, i) {
  const g = graph(p), sid = i.det.slice('orphan:'.length), head = i.rel.split('.')[0]
  const asRoot = (root, rel) => {
    const ops = g.responseOf.get(root) ?? [], kinds = ops.map(o => g.opKind.get(o)), unknownKind = ops.some(o => g.opRead.get(o) === 'kind_unknown')
    if (p === 'slack' && CONFIG.rpc.envelope_props.props.includes(rel.split('.')[0])) return { disposition: 'envelope_or_view', rule: 'O1', source_rule: 'S-E1', basis: 'Slack Web API 공통 응답 envelope 필드다', operations: ops.slice(0, 5) }
    if (kinds.length && kinds.every(k => k === 'read_one')) return classifyRecord(p, root, ops, rel)
    const arr = recordArrays(p, root)
    if (arr.length > 1) return { disposition: 'unresolved', unresolved_reason: 'several_record_arrays', basis: `응답에 객체 배열이 여럿이다: ${arr.map(a => a.name).join(', ')}`, operations: ops.slice(0, 5) }
    if (arr.length === 1) {
      const h = rel.split('.')[0]
      if (h !== arr[0].name) return { disposition: 'envelope_or_view', rule: 'O1', source_rule: 'S-E1', basis: `목록 응답 wrapper 의 속성이다. record 는 ${arr[0].name}[*]`, operations: ops.slice(0, 5) }
      if (rel === arr[0].name) return { disposition: 'envelope_or_view', rule: 'O1', source_rule: 'S-E1', basis: 'record 배열 자체다', record_shape: arr[0].items }
      return classifyRecord(p, arr[0].items, ops, rel.slice(arr[0].name.length + 1))
    }
    return classifyRecord(p, root, ops, rel)
  }
  if (g.responseOf.has(sid)) return asRoot(sid, i.rel)
  const a = ancestors(g, sid)
  if (a.spaces.length) return { disposition: 'parent_property', rule: 'O4', source_rule: 'S-N', destination: { space_candidates: a.spaces.map(x => `${p}:${x.space}`), relative_path: [a.spaces[0].rel, i.rel].filter(Boolean).join('.') }, basis: '공간 record 안에 중첩된 shape 다' }
  if (a.roots.length) { const r = asRoot(a.roots[0], i.rel); return { ...r, basis: `응답 root 에 중첩된 shape 다. ${r.basis}`, via_root: a.roots[0] } }
  if (a.writeRoots.length || g.writeResponseOf.has(sid)) return { disposition: 'action_result', rule: null, source_rule: 'S-W', basis: '쓰기·동작 operation 의 응답에만 나오는 정보다. GET 수집으로 얻는 상태가 아니다', operations: (g.writeResponseOf.get(sid) ?? []).slice(0, 5) }
  return { disposition: 'unresolved', unresolved_reason: 'no_ancestor_in_ir', basis: 'shape 그래프에서 부모·응답 root 를 찾지 못했다' }
}

const J = readJson(path.join(ROOT, 'config/orphan-judgments.json')).judgments
const obs = new Map(readJsonl(path.join(OUT, 'orphan-observation.jsonl')).map(r => [`${r.provider}|${r.determinant}`, r]))
const links = readJsonl(path.join(OUT, 'observation-operation-links.jsonl'))
const opInfo = new Map()
for (const l of links) if (l.operation.response_shape_id && !opInfo.has(l.operation.ir_operation_id)) opInfo.set(l.operation.ir_operation_id, l.operation)
const providers = ['github', 'okta', 'slack', 'gws', 'jira', 'confluence', 'atlassian', 'salesforce']

const rows = []
for (const p of providers) {
  const map = readJson(path.join(CONFIG.ir_root, p, 'map', 'info_map.json'))
  const spaceByShape = new Map()
  for (const [k, v] of Object.entries(map.spaces)) for (const s of v.shapes) if (!spaceByShape.has(s)) spaceByShape.set(s, `${p}:${k}`)
  for (const i of map.items.filter(x => x.det.startsWith('orphan:'))) {
    const o = obs.get(`${p}|${i.det}`), sid = i.det.slice('orphan:'.length)
    const base = { im_revision: CONFIG.revision, information_item_key: i.key, provider: p, original_determinant: i.det, kind: i.kind, rel: i.rel, cohort_observation: o?.observation ?? 'not_in_observed_responses' }
    const observed = o && (o.observation === 'value_observed' || o.observation === 'shape_observed_no_item_value')
    if (!observed) { const r = sourceBased(p, i); rows.push({ ...base, ...r, decision_refs: ['R1-D11'], evidence_kind: 'source_only', judgment_status: r.disposition === 'unresolved' ? null : (['S-P', 'S-T', 'S-N'].includes(r.source_rule) ? 'rule_applied_coarse' : 'rule_applied') }); continue }
    // 응답 root 인지와 record 배열 이름
    const roots = (o.root_operations ?? []).map(id => opInfo.get(id)).filter(x => x?.response_shape_id === sid)
    const recordProps = [...new Set(roots.map(r => r.record_selector).filter(s => s && s.startsWith('$.')).map(s => s.slice(2, -3)))]
    const head = i.rel.split('.')[0]
    const j = J[i.det]
    if (p === 'slack' && CONFIG.rpc.envelope_props.props.includes(head) && roots.length) { rows.push({ ...base, disposition: 'envelope_or_view', rule: 'O1', basis: 'Slack Web API 공통 응답 envelope 필드다 (config rpc.envelope_props)', operations: roots.map(r => r.ir_operation_id) }); continue }
    if (recordProps.length && !recordProps.includes(head)) { rows.push({ ...base, disposition: 'envelope_or_view', rule: 'O1', basis: `목록 응답 wrapper 의 속성이다. record 는 $.${recordProps.join('|')}[*] (bridge record selector)`, operations: roots.map(r => r.ir_operation_id) }); continue }
    if (recordProps.includes(i.rel)) {
      const rec = roots.find(r => r.record_selector === `$.${i.rel}[*]`)?.record_shape_id
      rows.push({ ...base, disposition: 'envelope_or_view', rule: 'O1', basis: 'record 배열 자체다. record 는 record shape 로 귀속한다', record_shape: rec ?? null, record_space: spaceByShape.get(rec) ?? null }); continue
    }
    if (j) {
      const ex = (j.exceptions ?? []).find(e => i.rel.startsWith(e.rel_prefix))
      if (ex) { rows.push({ ...base, disposition: ex.disposition, ...(ex.disposition === 'unresolved' ? { unresolved_reason: ex.reason } : {}), basis: ex.detail, destination: ex.destination ?? null, decision_refs: ex.decision_ref ? [ex.decision_ref] : [], judgment_status: ex.decision_ref ? 'decided' : j.status, runtime_refs: j.runtime_refs }); continue }
      rows.push({ ...base, disposition: j.disposition, rule: j.rule, ...(j.disposition === 'unresolved' ? { unresolved_reason: j.reason } : {}), basis: j.detail ?? j.reason, destination: j.destination ?? null, decision_refs: j.decision_refs ?? [], judgment_status: j.status, runtime_refs: j.runtime_refs })
      continue
    }
    // 이미 대상 공간이 정해진 참조·embed 항목은 그 공간을 가리키는 위치다
    if (['embedded_ref', 'ref', 'embedded_local'].includes(i.kind) && i.target && map.spaces[i.target]) { rows.push({ ...base, disposition: 'bound_to_space', destination: { space: `${p}:${i.target}`, relative_path: i.rel }, basis: 'map 항목이 대상 공간을 이미 가리킨다(target)', rule: null }); continue }
    // record 내용인데 판정 표가 없다: record shape 가 공간이면 그 공간으로, 아니면 미결
    const rec = roots.map(r => r.record_shape_id).find(Boolean), sp = rec && spaceByShape.get(rec)
    if (sp && recordProps.includes(head)) rows.push({ ...base, disposition: 'bound_to_space', destination: { space: sp, relative_path: i.rel.slice(head.length + 1) }, basis: 'bridge record selector 의 record shape 가 pinned map 공간이다', rule: null })
    else rows.push({ ...base, disposition: 'unresolved', unresolved_reason: 'record_without_space_or_judgment', basis: '값은 관측됐지만 record shape 가 pinned map 공간이 아니고 판정 표도 없다' })
  }
}

const summary = { revision: CONFIG.revision, items: rows.length, groups: new Set(rows.map(r => `${r.provider}|${r.original_determinant}`)).size, by_disposition: {}, unresolved_reasons: {}, observed_cohort_items: rows.filter(r => r.cohort_observation !== 'not_in_observed_responses' && r.cohort_observation !== 'reachable_from_observed_response_no_value').length }
for (const r of rows) {
  summary.by_disposition[r.disposition] = (summary.by_disposition[r.disposition] ?? 0) + 1
  if (r.unresolved_reason) summary.unresolved_reasons[r.unresolved_reason] = (summary.unresolved_reasons[r.unresolved_reason] ?? 0) + 1
}
summary.note = '원본 map 항목은 그대로다. unresolved 는 미결 사유가 있는 상태이며 고아가 정상이라는 판정이 아니다. rule 적용 결과는 사용자 검토 전이다'
writeJsonl(path.join(OUT, 'information-disposition.jsonl'), rows)
writeJson(path.join(OUT, 'information-disposition-summary.json'), summary)
console.log(JSON.stringify(summary, null, 1))
