// 단계 A 마무리: bridge 가 연결한 record 를 pinned IR 의 instance 형식(grade observed)으로 만든다.
// instance 는 실제 값을 담으므로 private/ 에만 쓴다. 공개 산출물에는 operation 별 대조와 shape 적합성(필드 이름만)을 둔다.
import path from 'node:path'
import { CONFIG, OUT, PRIVATE, ir, shape, loadEnvelopes, readJsonl, writeJson, writeJsonl } from './lib.mjs'

const links = new Map(readJsonl(path.join(OUT, 'observation-operation-links.jsonl')).map(l => [l.id, l]))
const instances = [], perOp = new Map(), conflicts = []
// union(oneOf 등) shape 는 대안 shape 들의 속성을 합친다
const declared = (p, sid, seen = new Set()) => {
  const out = new Set(), sh = sid && !seen.has(sid) ? shape(p, sid) : null
  if (!sh) return out
  seen.add(sid)
  for (const x of sh.props ?? []) out.add(x.name)
  for (const alt of sh.alts ?? []) for (const n of declared(p, alt, seen)) out.add(n)
  return out
}

for (const { rel, env } of loadEnvelopes()) {
  const id = `obs:${CONFIG.cohort.run}:${rel.replace(/\.json$/, '').replace('/', ':')}`
  const op = links.get(id)?.operation
  if (!op?.ir_operation_id) continue
  const p = op.research_provider
  const o = perOp.get(op.ir_operation_id) ?? { im_revision: CONFIG.revision, provider: p, ir_operation_id: op.ir_operation_id, record_shape_id: op.record_shape_id, pages: 0, records: 0, pinned_observed_instances: 0, undeclared_fields: new Map(), declared_fields: [], declared_seen: new Set(), statuses: new Set() }
  perOp.set(op.ir_operation_id, o)
  o.pages++; o.statuses.add(op.status)
  if (op.status === 'matched_operation_only') {
    conflicts.push({ im_revision: CONFIG.revision, kind: 'declared_shape_vs_observed_payload', observation: id, ir_operation_id: op.ir_operation_id, response_shape_id: op.response_shape_id, reason: op.selector_reason, payload_kind: Array.isArray(env.payload) ? 'array' : typeof env.payload, payload_top_keys: Array.isArray(env.payload) ? [] : Object.keys(env.payload ?? {}).sort(), status: 'recorded', note: '원문 선언과 실제 응답 모양이 다르다. IR 은 바꾸지 않았다' })
    continue
  }
  const sel = op.record_selector
  const rows = sel === '$' ? (env.payload == null ? [] : [[env.payload, '']]) : sel === '$[*]' ? env.payload.map((r, i) => [r, `/${i}`]) : (env.payload?.[sel.slice(2, -3)] ?? []).map((r, i) => [r, `/${sel.slice(2, -3)}/${i}`])
  const dec = declared(p, op.record_shape_id)
  o.declared_fields = [...dec]
  for (const [r, ptr] of rows) {
    o.records++
    if (r && typeof r === 'object' && !Array.isArray(r)) for (const k of Object.keys(r)) { if (dec.has(k)) o.declared_seen.add(k); else o.undeclared_fields.set(k, (o.undeclared_fields.get(k) ?? 0) + 1) }
    instances.push({
      id: `in:operation=${op.ir_operation_id}|status=${env.http_status}#${CONFIG.cohort.run}:${rel}${ptr}`,
      of: { operation: op.ir_operation_id, status: String(env.http_status), shape: op.record_shape_id }, value: r, grade: 'observed',
      src: { source: `tenant_${CONFIG.cohort.run}`, locator: `${rel}#${ptr || '/'}`, snapshot: env.collected_at },
      life: { state: 'active' }, ext: { request: { params: env.request_params, bindings: op.parameter_bindings }, observation: id },
    })
  }
}
for (const [opId, o] of perOp) o.pinned_observed_instances = ir(o.provider, 'instance').filter(i => i.grade === 'observed' && i.of?.operation === opId).length

const rows = [...perOp.values()].map(o => ({
  im_revision: o.im_revision, provider: o.provider, ir_operation_id: o.ir_operation_id, record_shape_id: o.record_shape_id, pages: o.pages, records: o.records,
  pinned_observed_instances: o.pinned_observed_instances, evidence: o.pinned_observed_instances ? 'adds_to_pinned' : 'new_to_pinned',
  declared_fields: o.declared_fields.length, declared_fields_seen: o.declared_seen.size,
  undeclared_fields: [...o.undeclared_fields].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, records: n })),
  statuses: [...o.statuses].sort(),
})).sort((a, b) => a.ir_operation_id.localeCompare(b.ir_operation_id))

const summary = {
  revision: CONFIG.revision, cohort: CONFIG.cohort.run, operations: rows.length, observed_instances: instances.length,
  new_to_pinned: rows.filter(r => r.evidence === 'new_to_pinned').length, adds_to_pinned: rows.filter(r => r.evidence === 'adds_to_pinned').length,
  operations_with_undeclared_fields: rows.filter(r => r.undeclared_fields.length).length, shape_conflicts: conflicts.length,
  note: 'instance 값은 private/observed-instances.jsonl 에만 있다. undeclared_fields 는 원문 shape 에 없는 실제 응답 필드 이름이다(값 없음)',
}
writeJsonl(path.join(PRIVATE, 'observed-instances.jsonl'), instances)
writeJsonl(path.join(OUT, 'observed-ir-comparison.jsonl'), rows)
writeJsonl(path.join(OUT, 'shape-conflicts.jsonl'), conflicts)
writeJson(path.join(OUT, 'observed-ir-summary.json'), summary)
console.log(JSON.stringify(summary, null, 1))
