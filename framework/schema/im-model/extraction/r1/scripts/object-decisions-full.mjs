// 단계 C: 전체 Object 판정. 동결 v1 object_types(1,973행)를 기준선으로 이번 개정의 결정을 덧씌운다.
// 축을 나눈다: disposition(object/non_object/unresolved), 결정 근거, 실측 관측(이번 run), 계약 검증(v1 contract_status 유지).
import path from 'node:path'
import { CONFIG, OUT, readJson, readJsonl, writeJson, writeJsonl } from './lib.mjs'

const v1 = readJson(path.join(CONFIG.ir_root, 'v1', 'object_types.json'))
const pilot = new Map(readJsonl(path.join(OUT, 'object-decisions.jsonl')).map(o => [o.space, o]))
const splits = readJsonl(path.join(OUT, 'space-splits.jsonl')).filter(s => s.pair && s.action?.startsWith('split'))
const aliasKeys = readJsonl(path.join(OUT, 'space-aliases.jsonl'))
const polySpaces = new Set(readJsonl(path.join(OUT, 'space-splits.jsonl')).filter(x => x.kind === 'conditional_target').map(x => `${x.provider}:${x.space}`))
const additions = readJsonl(path.join(OUT, 'space-additions.jsonl')).filter(a => a.space)
const links = readJsonl(path.join(OUT, 'observation-operation-links.jsonl'))
const observedShapes = new Map()
for (const l of links) if (l.operation.record_shape_id && l.operation.record_count) observedShapes.set(l.operation.record_shape_id, (observedShapes.get(l.operation.record_shape_id) ?? 0) + l.operation.record_count)
// G4-Q02: 권한 체계 내용 행은 Assignment 가 아니라 Policy 속성 (Jira PermissionScheme.permissions[] 의 PermissionGrant)
const G4Q02 = new Set(['jira:PermissionGrant'])

const rows = [], conflicts = []
for (const t of v1) {
  const key = `${t.provider}:${t.canonical_space}`
  const obs = (t.source_shapes ?? []).reduce((n, s) => n + (observedShapes.get(s) ?? 0), 0)
  const row = {
    im_revision: CONFIG.revision, object_type_id: t.id, provider: t.provider, space: key, members: t.members, interfaces: t.interfaces,
    v1_status: t.status, disposition: t.status === 'demoted_by_user_decision' ? 'non_object' : 'object', decision_refs: t.status === 'demoted_by_user_decision' ? ['v1 user decision'] : ['v1 candidate'],
    observation: obs ? { status: 'observed', records: obs } : { status: 'not_observed' }, contract_validation: t.contract_status,
  }
  const p = pilot.get(key)
  if (p) {
    if (p.disposition !== row.disposition) conflicts.push({ im_revision: CONFIG.revision, space: key, kind: 'v1_vs_r1', v1: row.disposition, r1: p.disposition, decision_refs: p.existing_decision_refs, status: 'resolved_by_r1' })
    Object.assign(row, { disposition: p.disposition, decision_refs: p.existing_decision_refs, non_object_destination: p.non_object_destination ?? null, r1_interfaces: p.interfaces ?? null })
  }
  if (G4Q02.has(key)) { conflicts.push({ im_revision: CONFIG.revision, space: key, kind: 'v1_vs_existing_decision', v1: row.disposition, r1: 'non_object', decision_refs: ['G4-Q02'], status: 'resolved_by_existing_decision' }); Object.assign(row, { disposition: 'non_object', decision_refs: ['G4-Q02'], non_object_destination: 'jira:PermissionScheme 의 permissions[] 속성(Policy 내용)' }) }
  // split 으로 떨어진 member 는 이 타입에서 빠진다. 대표 공간이 non_object 면 남는 Object 공간으로 대표를 옮긴다(anchor)
  const inType = splits.filter(sp => sp.provider === t.provider && sp.pair.every(m => t.members.includes(m)))
  if (inType.length) {
    const pilotOf = m => pilot.get(`${t.provider}:${m}`)
    const anchor = pilotOf(t.canonical_space)?.disposition === 'non_object' ? (t.members.find(m => pilotOf(m)?.disposition === 'object') ?? t.members.find(m => m !== t.canonical_space && pilotOf(m)?.disposition !== 'non_object') ?? t.canonical_space) : t.canonical_space
    const keepAlias = new Set(aliasKeys.filter(a => a.provider === t.provider && a.canonical === anchor).map(a => a.alias))
    const removed = [...new Set(inType.flatMap(sp => sp.pair).filter(m => m !== anchor && !keepAlias.has(m)))]
    row.space = `${t.provider}:${anchor}`; row.canonical_changed_from = anchor === t.canonical_space ? null : t.canonical_space
    row.members = t.members.filter(m => !removed.includes(m)); row.split_out_members = removed
    if (anchor !== t.canonical_space) { const ap = pilotOf(anchor); Object.assign(row, ap ? { disposition: ap.disposition, decision_refs: ap.existing_decision_refs, non_object_destination: null, r1_interfaces: ap.interfaces ?? null } : { disposition: 'object', decision_refs: ['v1 candidate', ...new Set(inType.map(sp => sp.decision_ref))], non_object_destination: null }) }
    conflicts.push({ im_revision: CONFIG.revision, space: key, kind: 'members_split', anchor, removed, decision_refs: [...new Set(inType.map(sp => sp.decision_ref))], status: 'resolved_by_existing_decision' })
    for (const m of removed) {
      const pm = pilotOf(m), poly = polySpaces.has(`${t.provider}:${m}`)
      rows.push({ im_revision: CONFIG.revision, object_type_id: null, provider: t.provider, space: `${t.provider}:${m}`, members: [m], interfaces: pm?.interfaces ?? [], v1_status: 'member_of_' + t.canonical_space,
        disposition: pm?.disposition ?? (poly ? 'non_object' : 'unresolved'), decision_refs: pm?.existing_decision_refs ?? [...new Set(inType.map(sp => sp.decision_ref))],
        non_object_destination: pm?.non_object_destination ?? (poly ? '판별 필드별 대상 공간을 가리키는 다형 참조' : null), unresolved_reason: pm || poly ? null : 'split_out_needs_object_judgment',
        observation: { status: pm?.collection_status ?? 'unknown' }, contract_validation: pm?.contract_validation ?? 'n/a' })
      pilot.delete(`${t.provider}:${m}`)
    }
  }
  rows.push(row)
}
for (const a of additions) if (!rows.some(r => r.space === a.space)) {
  const p = pilot.get(a.space)
  rows.push({ im_revision: CONFIG.revision, object_type_id: null, provider: a.space.split(':')[0], space: a.space, members: [a.space.split(':')[1]], interfaces: a.interfaces ?? p?.interfaces ?? [], v1_status: 'added_in_r1', disposition: a.object_disposition, decision_refs: [a.decision_ref, ...(a.existing_decision_refs ?? [])], non_object_destination: a.non_object_destination ?? null, observation: { status: p?.observations ? 'observed' : 'not_observed', records: p?.observations ?? 0 }, contract_validation: 'requires_projected_row' })
}
// pilot 판정 중 v1 에 없는 공간 (예: split 된 jira:{}_2)
for (const [k, p] of pilot) if (!rows.some(r => r.space === k)) rows.push({ im_revision: CONFIG.revision, object_type_id: null, provider: k.split(':')[0], space: k, members: [k.split(':').slice(1).join(':')], interfaces: p.interfaces ?? [], v1_status: 'not_in_v1', disposition: p.disposition, decision_refs: p.existing_decision_refs, non_object_destination: p.non_object_destination ?? null, observation: { status: p.collection_status ?? 'unknown' }, contract_validation: p.contract_validation })

const cov = { revision: CONFIG.revision, v1_rows: v1.length, rows: rows.length, by_disposition: {}, by_provider: {}, observed: rows.filter(r => r.observation.status === 'observed').length, by_interface: {}, contract: {}, conflicts: conflicts.length }
for (const r of rows) {
  cov.by_disposition[r.disposition] = (cov.by_disposition[r.disposition] ?? 0) + 1
  const bp = cov.by_provider[r.provider] ??= { object: 0, non_object: 0, unresolved: 0, observed: 0 }
  bp[r.disposition]++; if (r.observation.status === 'observed') bp.observed++
  if (r.disposition === 'object') for (const i of r.interfaces ?? []) cov.by_interface[i] = (cov.by_interface[i] ?? 0) + 1
  cov.contract[r.contract_validation] = (cov.contract[r.contract_validation] ?? 0) + 1
}
cov.note = 'object 는 v1 후보를 이어받은 판정이며 계약 검증(requires_projected_row)은 끝나지 않았다. observed 는 이번 run 에서 그 타입의 record 가 1건 이상 나왔다는 뜻이다'
writeJsonl(path.join(OUT, 'object-decisions-full.jsonl'), rows)
writeJsonl(path.join(OUT, 'decision-conflicts.jsonl'), conflicts)
writeJson(path.join(OUT, 'object-rule-coverage.json'), cov)
console.log(JSON.stringify({ rows: rows.length, by_disposition: cov.by_disposition, observed: cov.observed, conflicts: conflicts.map(c => `${c.space}:${c.kind}`) }, null, 1))
