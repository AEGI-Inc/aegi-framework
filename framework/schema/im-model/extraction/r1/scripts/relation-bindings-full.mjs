// 단계 D: Relation binding 확대.
// 1) 기존 결정(Q01~Q11, G4-Q01/Q02)과 현행 정규화기 구현을 binding 으로 옮긴다
// 2) typed reference 5,293개마다 의미 처리(disposition)를 붙이고 원문 근거(ref_decl)를 연결한다
// 3) v1 어휘·템플릿과 현행 Relation_Schema_v3 를 대조한다
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG, OUT, ir, readJson, readJsonl, writeJson, writeJsonl } from './lib.mjs'

const KNOW = '<LOCAL_WORKSPACE_PATH>'
const NV2 = 'aegi-adapter-engine-v3-readiness/scripts/collect/normalize-v2'
const decisions = readJson(path.join(KNOW, 'im-model/extraction/ir2/v2/relation_decisions_v2.json'))
const find = (o, f, a = []) => { if (o && typeof o === 'object') { if (f(o)) a.push(o); for (const v of Object.values(o)) find(v, f, a) } return a }
const Q = code => find(decisions, o => o.code === code)[0]
const v1 = readJson(path.join(CONFIG.ir_root, 'v1', 'relation_types.json'))
const objects = new Map(readJsonl(path.join(OUT, 'object-decisions-full.jsonl')).map(o => [o.space, o]))
const byTypeId = new Map([...objects.values()].filter(o => o.object_type_id).map(o => [o.object_type_id, o]))
const memberOf = new Map()
for (const o of objects.values()) for (const m of o.members ?? []) memberOf.set(`${o.provider}:${m}`, o)
const pilot = readJsonl(path.join(OUT, 'relation-bindings.jsonl'))

// ---------- 1. 결정 기반 binding ----------
const b = (id, o) => ({ id: `relation-binding:${id}`, im_revision: CONFIG.revision, on_unresolved_target: 'preserve_reference_and_report_reason', template_validation: 'pending_current_schema', ...o })
const bindings = [...pilot,
  b('okta-grouprule-applies-to-group', { status: 'decided_binding', decision_refs: ['Q01'], relation_type: Q('Q01').effect.relation_type, template_case: Q('Q01').effect.template_case, basis: Q('Q01').effect.basis,
    input: { operation_ref: 'op:okta_management_openapi:listGroupRules', record_selector: '$[*]' },
    slots: { source: { space: 'okta:GroupRule', identity_from: 'record.id' }, target: { space: 'okta:Group', identity_from: 'record.actions.assignUserToGroups.groupIds[]' } },
    evidence: ['sh:okta_management_openapi:GroupRuleAction.assignUserToGroups', 'sh:okta_management_openapi:GroupRuleGroupAssignment.groupIds'], note: Q('Q01').note }),
  b('github-organization-contained-in-enterprise', { status: 'decided_semantics_input_pending', decision_refs: ['Q03'], relation_type: Q('Q03').effect.relation_type, template_case: Q('Q03').effect.template_case, basis: Q('Q03').effect.basis,
    input: { operation_ref: null, reason: '조직의 상위 enterprise 를 주는 읽기 operation 이 이번 수집 계획에 없다(enterprises/{enterprise}/... 경로 부모 또는 GraphQL Enterprise.organizations)' },
    slots: { source: { space: 'github:organization-full', identity_from: 'record.id' }, target: { space: 'github:enterprise', identity_from: 'request path enterprise' } }, note: Q('Q03').note }),
  b('github-webhook-owned-by-organization', { status: 'decided_binding', decision_refs: ['Q04'], relation_type: Q('Q04').effect.relation_type, template_case: Q('Q04').effect.template_case, basis: Q('Q04').effect.basis,
    input: { operation_ref: 'op:gh_rest_ghec_next_2026_03_10_latest:orgs/list-webhooks', record_selector: '$[*]' },
    slots: { source: { space: 'github:org-hook', identity_from: 'record.id' }, target: { space: 'github:organization-full', identity_from: 'path parameter org (parameter_bindings.org)' } }, note: Q('Q04').note }),
  ...[['gws', 'op:gws_directory:directory.users.list', '$.users[*]', 'gws:User', 'gws:Customer'], ['okta', 'op:okta_management_openapi:listUsers', '$[*]', 'okta:UserGetSingleton', 'okta:Org'],
      ['jira', 'op:jira_openapi_v3:getAllUsers', '$[*]', 'jira:User', 'atlassian:site'], ['salesforce', 'op:sf_object_reference:User.query', '$.records[*]', 'salesforce:User', 'salesforce:Organization']].map(([p, op, sel, src, tgt]) =>
    b(`${p}-user-member-of-tenant`, { status: ['gws', 'okta'].includes(p) ? 'decided_binding' : 'decided_binding_extended', decision_refs: ['Q05'], relation_type: Q('Q05').effect.relation_type, template_case: Q('Q05').effect.template_case, basis: Q('Q05').effect.basis,
      input: { operation_ref: op, record_selector: sel }, slots: { source: { space: src, identity_from: 'record id' }, target: { space: tgt, identity_from: 'tenant scope of the request' } },
      note: ['gws', 'okta'].includes(p) ? Q('Q05').note : 'Q05 문구("SaaS 상관없이")를 이 provider 에도 적용한다. 그래프 고아의 missing_binding 이 근거다' })),
  b('okta-role-scope-resource-set', { status: 'schema_proposal', decision_refs: ['Q02'], relation_type: null, note: Q('Q02').note, input: null, slots: null }),
  b('confluence-space-permission-has-role-on', { status: 'decided_binding', decision_refs: ['G4-Q01', 'R1-D03'], relation_type: 'has_role_on',
    input: { operation_ref: 'op:confluence_openapi_v2:getSpacePermissionsAssignments', record_selector: '$.results[*]', grouping: '(request_params.space, record.principal.type, record.principal.id)' },
    slots: { source: { space: 'confluence:User | confluence:Group | SpecialPrincipal', identity_from: 'record.principal.{type,id}' }, target: { space: 'confluence:Space', identity_from: 'request_params.space' }, role: { space: 'NamedRole(Policy)', identity_from: "고정 이름 'space_permissions'", scope: ['provider', 'site'] } },
    context: { assignment_ref: 'confluence:SpacePermission', properties: { permissions: '묶음 안 operation.key:targetType 목록' } }, evidence: [`${NV2}/atlassian.ts:184-210`] }),
  b('jira-project-role-has-role-on-project', { status: 'decided_binding', decision_refs: ['G4-Q02'], relation_type: 'has_role_on',
    input: { operation_ref: 'op:jira_openapi_v3:getProjectRole', record_selector: '$', guard: 'record.actors[*]' },
    slots: { source: { space: 'jira:User | jira:Group', identity_from: 'record.actors[].actorUser.accountId | actorGroup.groupId' }, target: { space: 'jira:Project', identity_from: 'request_params.project' }, role: { space: 'jira:ProjectRole', identity_from: 'request_params.role' } },
    context: { properties: { permissions: '그 프로젝트 권한 스킴에서 이 역할이 받은 권한 키 (G4-Q02, 스킴 줄은 Policy 속성)' } }, evidence: [`${NV2}/atlassian.ts:7-9, 91-139`] }),
]

// ---------- 2. 반례(negative control)와 관계를 만들지 않는 결정 ----------
const controls = [
  { id: 'control:slack-channel-creator', provider: 'slack', field: 'creator', match: r => r.provider === 'slack' && r.field === 'creator', disposition: 'property', decision_refs: ['Relation_Schema_v3.md:658', 'rulebook R6'], basis: 'Slack 채널 creator 는 만든 사람 기록일 뿐 권한이 아니다. 관계를 만들지 않는다' },
  { id: 'control:author', provider: 'github,slack', field: 'author', match: r => ['github', 'slack'].includes(r.provider) && /(^|_)author(_id)?$/.test(r.field), disposition: 'object_reference', decision_refs: ['Q09'], basis: Q('Q09').choice },
  { id: 'control:form-linked-sheet', provider: 'gws', field: 'linked_sheet', match: r => r.provider === 'gws' && /linkedSheetId|linked_sheet/.test(r.field), disposition: 'object_reference', decision_refs: ['Q10'], basis: Q('Q10').choice },
]

// ---------- 3. typed reference 처리 ----------
const refDecl = new Map()
for (const p of ['github', 'okta', 'slack', 'gws', 'jira', 'confluence', 'atlassian', 'salesforce']) for (const d of ir(p, 'ref_decl')) refDecl.set(`${d.from?.shape}|${d.from?.prop}`, d)
const decided = [
  { test: r => r.provider === 'okta' && /GroupRule/.test(r.source.space) && /^Group/.test(r.target.space) && /groupIds/.test(r.field), binding: 'relation-binding:okta-grouprule-applies-to-group', ref: 'Q01' },
  { test: r => r.provider === 'github' && /hook/.test(r.source.space) && /organization/.test(r.target.space), binding: 'relation-binding:github-webhook-owned-by-organization', ref: 'Q04' },
]
const refs = v1.references.map(r => {
  const ev = r.origin_slots.map(([s, p]) => refDecl.get(`${s}|${p}`)).filter(Boolean)
  const srcO = memberOf.get(`${r.provider}:${r.source.space}`) ?? byTypeId.get(r.source.object_type_id)
  const tgtO = memberOf.get(`${r.provider}:${r.target?.space}`) ?? byTypeId.get(r.target?.object_type_id)
  const out = { im_revision: CONFIG.revision, id: r.id, provider: r.provider, field: r.field, source_space: r.source.space, target_space: r.target?.space ?? null, key_kind: r.key_kind,
    source_evidence: ev.map(d => ({ ref_decl: d.id, locator: d.src?.locator, source: d.src?.source, grade: d.grade })), v1_semantic_status: r.semantic_status }
  const c = controls.find(c => c.match(r))
  if (c) return { ...out, disposition: c.disposition, decision_refs: c.decision_refs, basis: c.basis, control: c.id }
  // R1-D02: Drive 의 permissionId 는 권한 행(Permission)이 아니라 받는 사람(gws:DriveGrantee)의 ID 다
  if (r.provider === 'gws' && /(^|\.)permissionId$/.test(r.field)) return { ...out, disposition: 'object_reference', retargeted: { from: r.target?.space ?? null, to: 'DriveGrantee' }, decision_refs: ['R1-D02'], basis: 'permissionId 는 Drive grantee ID 다. v1 대상(Permission)을 DriveGrantee 참조로 바꾼다', target_space: 'DriveGrantee' }
  const d = decided.find(d => d.test(r))
  if (d) return { ...out, disposition: 'relation', binding: d.binding, decision_refs: [d.ref] }
  if (tgtO?.disposition === 'non_object') return { ...out, disposition: 'object_reference', target_note: tgtO.non_object_destination, decision_refs: tgtO.decision_refs, basis: '대상 공간이 Object 가 아니다(조건부 대상·참조 공간)' }
  // v1 이 한쪽 끝을 Object 가 아니라고 판정했으면 Relation 이 될 수 없다. 참조 값은 그쪽 정보의 속성으로 남는다
  const nonObj = st => ['not_object', 'not_an_object_candidate'].includes(st)
  if (!srcO || !tgtO) {
    if (nonObj(r.source.status) || nonObj(r.target?.status)) return { ...out, disposition: 'property', basis: 'v1 이 한쪽 끝을 Object 가 아니라고 판정했다. Relation 끝점이 될 수 없어 속성 값으로 둔다', v1_endpoint_status: { source: r.source.status, target: r.target?.status ?? null } }
    return { ...out, disposition: 'unresolved', unresolved_reason: r.target?.status === 'target_unknown' ? 'target_unknown' : 'endpoint_undecided_in_v1', v1_endpoint_status: { source: r.source.status, target: r.target?.status ?? null } }
  }
  return { ...out, disposition: 'object_reference', review_status: 'unreviewed_v1_auto', basis: 'v1 이 공간 사이 참조로 찾았고 Relation 매핑을 정하지 않았다(relation_type null). 참조로 유지한다' }
})

// ---------- 4. 어휘·템플릿 대조 ----------
const spec = fs.readFileSync(path.join(KNOW, 'specs/Relation_Schema_v3.md'), 'utf8').split('\n')
const specRows = new Map()
// 표 칸 안의 '\|' 는 구분자가 아니다
for (const l of spec) {
  const cells = l.split('\\|').join('\u0001').split('|').map(c => c.split('\u0001').join('|').trim())
  if (/^\d+$/.test(cells[1] ?? '') && /^[a-z_]+$/.test(cells[2] ?? '')) specRows.set(cells[2], cells[3])
}
const hasStructural = spec.some(l => /contained_in/.test(l))
const norm = t => t.replace(/\s+/g, ' ').replace(/ ?\| ?/g, '|').replace(/ ?-->? ?/g, '->').trim()
const versionConflicts = []
for (const [name, v] of Object.entries(v1.vocabulary)) {
  const s = specRows.get(name)
  if (!s && !(name === 'contained_in' && hasStructural)) versionConflicts.push({ im_revision: CONFIG.revision, relation_type: name, kind: 'missing_in_current_spec', v1_template: v.template })
  else if (s && norm(s) !== norm(v.template)) versionConflicts.push({ im_revision: CONFIG.revision, relation_type: name, kind: 'template_differs', v1_template: v.template, current_spec: s, status: 'resolved_adopt_current_spec', resolution: 'V3 는 현행 Relation_Schema_v3 템플릿을 따른다. v1 어휘는 갱신 전 표다' })
}
for (const name of specRows.keys()) if (!v1.vocabulary[name]) versionConflicts.push({ im_revision: CONFIG.revision, relation_type: name, kind: 'missing_in_v1' })

const cov = { revision: CONFIG.revision, bindings: bindings.length, bindings_by_status: {}, typed_references: refs.length, references_by_disposition: {}, references_with_source_evidence: refs.filter(r => r.source_evidence.length).length, v1_references_without_evidence: v1.references.filter(r => !r.source_evidence?.length).length, controls: Object.fromEntries(controls.map(c => [c.id, refs.filter(r => r.control === c.id).length])), unresolved_reasons: {}, version_conflicts: versionConflicts.length }
for (const x of bindings) cov.bindings_by_status[x.status] = (cov.bindings_by_status[x.status] ?? 0) + 1
for (const r of refs) { cov.references_by_disposition[r.disposition] = (cov.references_by_disposition[r.disposition] ?? 0) + 1; if (r.unresolved_reason) cov.unresolved_reasons[r.unresolved_reason] = (cov.unresolved_reasons[r.unresolved_reason] ?? 0) + 1 }
cov.note = 'object_reference(unreviewed_v1_auto) 는 v1 이 찾은 공간 사이 참조를 Relation 으로 올리지 않고 참조로 유지한 상태다. relation 은 승인된 결정이 있는 것만이다'
writeJsonl(path.join(OUT, 'relation-bindings-full.jsonl'), bindings)
writeJsonl(path.join(OUT, 'reference-dispositions.jsonl'), refs)
writeJsonl(path.join(OUT, 'version-conflicts.jsonl'), versionConflicts)
writeJson(path.join(OUT, 'relation-coverage.json'), cov)
console.log(JSON.stringify(cov, null, 1))
