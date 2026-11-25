// 연구 정보 고아 692그룹이 이번 run 의 관측 응답에 실제로 나타나는지 계산한다.
// 관측 operation 응답 shape 에서 도달하는 shape 를 모으고(원문 shape 그래프), 고아 shape 가 그 안에 있으면
// payload 에서 그 위치에 실제 값이 있었는지까지 센다. 판정(귀속)이 아니라 판정에 쓸 실측 근거의 유무다.
import path from 'node:path'
import { CONFIG, OUT, ir, shape, loadEnvelopes, readJson, readJsonl, writeJson, writeJsonl } from './lib.mjs'

const links = new Map(readJsonl(path.join(OUT, 'observation-operation-links.jsonl')).map(l => [l.id, l]))
const providers = ['github', 'okta', 'slack', 'gws', 'jira', 'confluence', 'atlassian', 'salesforce']

// payload 를 shape 와 함께 걸으며 slot(shape|속성)별로 값이 있었던 횟수를 operation 별로 센다.
// 정보 항목은 slot 단위이므로 공통 shape(_links 등)가 그룹 전체를 관측된 것처럼 만들지 않는다
function walk(provider, sid, v, hits, opId, depth = 0) {
  if (v == null || !sid || depth > 12) return
  const s = shape(provider, sid)
  if (!s) return
  const vk = `shape:${sid}`, vs = hits.get(vk) ?? hits.set(vk, new Map()).get(vk)
  vs.set(opId, (vs.get(opId) ?? 0) + 1)
  if (s.kind === 'array' && Array.isArray(v)) { for (const x of v) walk(provider, s.items?.shape, x, hits, opId, depth + 1); return }
  if (s.kind === 'union') { for (const alt of s.alts ?? []) walk(provider, alt, v, hits, opId, depth + 1); return }
  if (typeof v !== 'object' || Array.isArray(v)) return
  for (const p of s.props ?? []) {
    if (!(p.name in v)) continue
    if (v[p.name] != null) { const k = `${sid}|${p.name}`, h = hits.get(k) ?? hits.set(k, new Map()).get(k); h.set(opId, (h.get(opId) ?? 0) + 1) }
    if (p.shape) walk(provider, p.shape, v[p.name], hits, opId, depth + 1)
    else if (p.items?.shape && Array.isArray(v[p.name])) for (const x of v[p.name]) walk(provider, p.items.shape, x, hits, opId, depth + 1)
  }
}
// 원문 shape 그래프에서 도달 가능한 shape (값 유무와 무관)
function reach(provider, sid, seen = new Set()) {
  if (!sid || seen.has(sid)) return seen
  seen.add(sid)
  const s = shape(provider, sid)
  if (!s) return seen
  if (s.items?.shape) reach(provider, s.items.shape, seen)
  for (const p of s.props ?? []) { if (p.shape) reach(provider, p.shape, seen); if (p.items?.shape) reach(provider, p.items.shape, seen) }
  for (const x of s.alts ?? []) reach(provider, x, seen)
  return seen
}

const valueHits = new Map(providers.map(p => [p, new Map()]))
const reachable = new Map(providers.map(p => [p, new Map()]))
for (const { rel, env } of loadEnvelopes()) {
  const l = links.get(`obs:${CONFIG.cohort.run}:${rel.replace(/\.json$/, '').replace('/', ':')}`), op = l?.operation
  if (!op?.response_shape_id) continue
  const p = op.research_provider
  walk(p, op.response_shape_id, env.payload, valueHits.get(p), op.ir_operation_id)
  for (const s of reach(p, op.response_shape_id)) {
    const r = reachable.get(p)
    if (!r.has(s)) r.set(s, new Set())
    r.get(s).add(op.ir_operation_id)
  }
}

const rows = []
for (const p of providers) {
  const items = readJson(path.join(CONFIG.ir_root, p, 'map', 'info_map.json')).items.filter(i => i.det.startsWith('orphan:'))
  for (const det of [...new Set(items.map(i => i.det))].sort()) {
    const sid = det.slice('orphan:'.length), group = items.filter(i => i.det === det)
    const slotShapes = [...new Set(group.flatMap(i => i.slots.map(s => s[0])))]
    // 고아 shape 자체가 payload 에 나타난 operation 의 값만 센다. 공통 shape(_links 등)는 다른 응답에서도 값을 가지므로 제외된다
    const rootOps = new Set(valueHits.get(p).get(`shape:${sid}`)?.keys() ?? [])
    const vh = new Map([...valueHits.get(p)].filter(([k]) => !k.startsWith('shape:')).map(([k, m]) => [k, new Map([...m].filter(([o]) => rootOps.has(o)))]).filter(([, m]) => m.size))
    const itemValued = group.filter(i => i.slots.some(([sh, pr]) => vh.has(`${sh}|${pr}`)))
    const valued = [...new Set(group.flatMap(i => i.slots.map(([sh, pr]) => `${sh}|${pr}`)).filter(k => vh.has(k)))]
    const reachOps = [...new Set(slotShapes.flatMap(s => [...(reachable.get(p).get(s) ?? [])]))].sort()
    rows.push({
      im_revision: CONFIG.revision, provider: p, determinant: det, information_items: group.length,
      observation: itemValued.length ? 'value_observed' : rootOps.size ? 'shape_observed_no_item_value' : reachOps.length ? 'reachable_from_observed_response_no_value' : 'not_in_observed_responses',
      items_with_values: itemValued.length, slots_with_values: valued.length, value_occurrences: valued.reduce((n, s) => n + [...vh.get(s).values()].reduce((a, b) => a + b, 0), 0),
      root_operations: [...rootOps].sort(),
      value_operations: [...new Set(valued.flatMap(s => [...vh.get(s).keys()]))].sort(),
      reachable_operations: reachOps.length, read_by_total: Math.max(...group.map(i => i.n_read_by)),
      via: [...new Set(group.flatMap(i => i.via ?? []))].sort(),
    })
  }
}
const summary = { revision: CONFIG.revision, cohort: CONFIG.cohort.run, groups: rows.length, items: rows.reduce((n, r) => n + r.information_items, 0), by_observation: {}, by_provider: {} }
for (const r of rows) {
  const o = summary.by_observation[r.observation] ??= { groups: 0, items: 0 }
  o.groups++; o.items += r.information_items; o.items_with_values = (o.items_with_values ?? 0) + (r.items_with_values ?? 0)
  const bp = (summary.by_provider[r.provider] ??= {})[r.observation] ??= { groups: 0, items: 0 }
  bp.groups++; bp.items += r.information_items
}
summary.note = 'value_observed 는 그룹의 정보 항목 중 하나 이상이 실제 payload 에서 값을 가졌다는 뜻이다(items_with_values 가 항목 수). 귀속 판정이 아니다. not_in_observed_responses 는 이번 run 이 그 operation 을 부르지 않았거나 응답 경로가 IR 과 연결되지 않은 경우이며, 고아가 정상이라는 뜻이 아니다'
writeJsonl(path.join(OUT, 'orphan-observation.jsonl'), rows)
writeJson(path.join(OUT, 'orphan-observation-summary.json'), summary)
console.log(JSON.stringify(summary, null, 1))
