// 그래프 고아 분류: 정규화 스냅샷에서 Relation 끝점이 아닌 Object 를 기존 결정에 대응시킨다.
// 상태: referenced_indirectly / valid_unlinked / invalid_object_projection / missing_binding / unresolved
import path from 'node:path'
import { CONFIG, OUT, ROOT, readJson, token, writeJson, writeJsonl } from './lib.mjs'

const C = readJson(path.join(ROOT, 'config/graph-orphan-rules.json'))
const objects = readJson(path.join(C.snapshot, 'objects.json')), relations = readJson(path.join(C.snapshot, 'relations.json'))
const byKey = new Map(objects.map(o => [o.fixture_key, o]))
const ends = new Set(), via = new Set(), refBy = new Set()
for (const f of relations) {
  const r = f.canonical
  for (const s of ['source', 'target', 'role']) if (r.references?.[s]?.value) ends.add(r.references[s].value)
  for (const v of Object.values(r.properties ?? {})) for (const x of [].concat(v)) if (typeof x === 'string' && byKey.has(x)) via.add(x)
}
for (const o of objects) for (const ref of Object.values(o.canonical.references ?? {})) for (const t of ref.targets ?? []) if (byKey.has(t.value)) refBy.add(t.value)

const rows = []
for (const o of objects.filter(x => !ends.has(x.fixture_key))) {
  const c = o.canonical, type = `${c.provider}.${c.object_type}`, t = C.by_type[type]
  let r
  if (t?.applies_even_if_referenced) r = t
  else if ((c.interfaces ?? []).includes('Assignment') && via.has(o.fixture_key)) r = C.general[0]
  else if (refBy.has(o.fixture_key)) r = C.general[1]
  else if (t) r = t
  else r = { status: 'unresolved', decision_refs: [], basis: '대응하는 기존 결정이 없다' }
  rows.push({ im_revision: CONFIG.revision, object: token('obj', o.fixture_key), provider: c.provider, object_type: c.object_type, interfaces: c.interfaces ?? [], referenced_via_relation_property: via.has(o.fixture_key), referenced_by_object: refBy.has(o.fixture_key), status: r.status, decision_refs: r.decision_refs, basis: r.basis })
}
const summary = { revision: CONFIG.revision, snapshot: C.snapshot, objects: objects.length, relations: relations.length, graph_orphans: rows.length, by_status: {}, by_type: {} }
for (const r of rows) {
  summary.by_status[r.status] = (summary.by_status[r.status] ?? 0) + 1
  const k = `${r.provider}.${r.object_type}`; (summary.by_type[k] ??= {})[r.status] = (summary.by_type[k][r.status] ?? 0) + 1
}
summary.note = 'invalid_object_projection 과 missing_binding 은 스냅샷이 이후 결정(G4-Q01/Q02, Q04, Q05)을 반영하지 않은 결과다. 스냅샷은 수정하지 않았다'
writeJsonl(path.join(OUT, 'graph-orphans.jsonl'), rows)
writeJson(path.join(OUT, 'graph-orphans-summary.json'), summary)
console.log(JSON.stringify({ graph_orphans: rows.length, by_status: summary.by_status, unresolved: Object.entries(summary.by_type).filter(([, v]) => v.unresolved).map(([k, v]) => `${k}:${v.unresolved}`) }, null, 1))
