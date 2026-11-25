// 단계 B 파일럿: bridge 가 연결한 record 로 기존 동일성 결정을 실측 대조한다.
// 대상: Drive Permission, GitHub simple-user 다형성·list/detail, Okta Application/OAuth2Client·identity-source User.
// 실제 ID·이메일은 산출물에 쓰지 않는다(lib.token). 병합을 실행하지 않고 근거·반례·한계만 기록한다.
import path from 'node:path'
import { CONFIG, OUT, ROOT, loadEnvelopes, readJson, readJsonl, writeJson, writeJsonl } from './lib.mjs'

const KNOW = '<LOCAL_WORKSPACE_PATH>'
const overrides = readJson(path.join(KNOW, 'research_overrides_v2.json'))
const links = new Map(readJsonl(path.join(OUT, 'observation-operation-links.jsonl')).map(l => [l.id, l]))
const sameEntity = p => readJson(path.join(CONFIG.ir_root, p, 'map', 'same_entity.json'))
// R1-D05: v2 가 반영된 재생성본 (scripts/regenerate-same-entity.mjs)
const regenEntity = p => readJson(path.join(OUT, 'regenerated-same-entity', `${p}.json`))
const spaces = p => readJson(path.join(CONFIG.ir_root, p, 'map', 'info_map.json')).spaces

// record 단위로 펼친다. 각 record 는 observation id·JSON pointer·요청 scope 를 갖는다
const records = []
for (const { rel, env } of loadEnvelopes()) {
  const id = `obs:${CONFIG.cohort.run}:${rel.replace(/\.json$/, '').replace('/', ':')}`
  const l = links.get(id), op = l?.operation
  if (!op?.record_selector) continue
  const sel = op.record_selector
  let rows
  if (sel === '$') rows = env.payload == null ? [] : [[env.payload, '']]
  else if (sel === '$[*]') rows = env.payload.map((r, i) => [r, `/${i}`])
  else { const k = sel.slice(2, -3); rows = (env.payload?.[k] ?? []).map((r, i) => [r, `/${k}/${i}`]) }
  for (const [r, ptr] of rows) records.push({ obs: id, ptr, op: op.ir_operation_id, shape: op.record_shape_id, call: env.call_id, rp: env.request_params ?? {}, bindings: op.parameter_bindings, r })
}
const by = suffix => records.filter(x => x.op.endsWith(suffix))
const count = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m }, {})
const uniq = xs => [...new Set(xs.filter(v => v != null))]
const locators = xs => uniq(xs.map(x => x.obs)).sort()
const inter = (a, b) => { const s = new Set(b); return uniq(a).filter(v => s.has(v)) }

const evidence = [], aliases = [], splits = [], conflicts = [], objects = [], bindings = [], replay = {}
const decisionDate = overrides.decided_on
const D = readJson(path.join(ROOT, 'config/decisions.json'))
const dec = code => D.decisions.find(d => d.code === code)
const additions = []

// ---------- Drive ----------
{
  const files = by(':drive.files.list'), perms = by(':drive.permissions.list')
  const fileOf = p => p.bindings.fileId === 'request_params.file' ? p.rp.file : null
  const grantee = p => p.r.emailAddress ? String(p.r.emailAddress).toLowerCase() : null
  // permission.id -> grantee, grantee -> permission.id 가 각각 하나인지 (원문: id 는 grantee 의 고유 ID)
  const idToG = new Map(), gToId = new Map()
  for (const p of perms) {
    if (!grantee(p)) continue
    ;(idToG.get(p.r.id) ?? idToG.set(p.r.id, new Set()).get(p.r.id)).add(grantee(p))
    ;(gToId.get(grantee(p)) ?? gToId.set(grantee(p), new Set()).get(grantee(p))).add(p.r.id)
  }
  const idFunctional = [...idToG.values()].every(s => s.size === 1), gFunctional = [...gToId.values()].every(s => s.size === 1)
  const pairs = perms.map(p => `${fileOf(p)}|${p.r.id}`)
  const fileIdsInPerm = uniq(perms.map(fileOf)), reused = [...new Map(perms.map(p => [p.r.id, uniq(perms.filter(q => q.r.id === p.r.id).map(fileOf)).length])).values()].filter(n => n > 1).length
  const ownersOf = new Map(files.map(f => [f.r.id, (f.r.owners ?? []).map(o => String(o.emailAddress).toLowerCase())]))
  const ownerPerms = perms.filter(p => p.r.role === 'owner')
  const ownerOverlap = ownerPerms.filter(p => (ownersOf.get(fileOf(p)) ?? []).includes(grantee(p))).length
  // R1-D01: owner 권한이 같은 파일의 File.owners 와 같은 사람이면 has_role_on 대신 owned_by 의 근거가 된다
  const foldedToOwnedBy = p => p.r.role === 'owner' && (ownersOf.get(fileOf(p)) ?? []).includes(grantee(p))
  const ownedByFacts = files.flatMap(f => (f.r.owners ?? []).map(o => ({ f, owner: String(o.emailAddress).toLowerCase() })))
  const dirUsers = new Set(by(':directory.users.list').map(u => String(u.r.primaryEmail).toLowerCase()))
  const resolvable = perms.filter(p => p.r.type === 'user' && dirUsers.has(grantee(p))).length

  replay.drive = {
    file_records: files.length, unique_files: uniq(files.map(f => f.r.id)).length,
    permission_records: perms.length, permission_files: fileIdsInPerm.length, unique_permission_ids: uniq(perms.map(p => p.r.id)).length,
    permission_ids_on_several_files: reused, unique_file_permission_pairs: uniq(pairs).length,
    permission_id_to_grantee_functional: idFunctional, grantee_to_permission_id_functional: gFunctional,
    roles: count(perms, p => p.r.role), grantee_types: count(perms, p => p.r.type),
    owner_permissions: ownerPerms.length, owner_permissions_matching_file_owners: ownerOverlap,
    user_grantees_resolvable_to_directory_user_by_email: resolvable,
    after_R1_D01: {
      has_role_on: perms.filter(p => (p.r.type === 'user' || p.r.type === 'group') && !foldedToOwnedBy(p)).length,
      has_role_on_source_resolvable: perms.filter(p => p.r.type === 'user' && !foldedToOwnedBy(p) && dirUsers.has(grantee(p))).length,
      owned_by: ownedByFacts.length,
      owned_by_with_via_assignment: ownedByFacts.filter(({ f, owner }) => perms.some(p => fileOf(p) === f.r.id && grantee(p) === owner && p.r.role === 'owner')).length,
      owner_permissions_kept_as_has_role_on: ownerPerms.filter(p => !foldedToOwnedBy(p)).length,
      before: { has_role_on: perms.filter(p => p.r.type === 'user' || p.r.type === 'group').length, owned_by: ownedByFacts.length },
    },
  }
  const spD = spaces('gws')
  evidence.push({
    id: 'identity-evidence:gws-drive-permission-scope', im_revision: CONFIG.revision, claim: 'scoped_local_identity',
    space: 'gws:Permission', parent_space: 'gws:File', status: 'corroborated_existing_ir',
    existing_ir: { form: spD.Permission.form, parent_positions: spD.Permission.parent_positions },
    comparison: { key: ['request_params.file -> File', 'record.id'], required_scope: ['provider', 'tenant', 'file'] },
    empirical_support: { records: perms.length, unique_pairs: uniq(pairs).length, duplicate_pairs: perms.length - uniq(pairs).length },
    observations: locators(perms),
    limitations: ['권한 목록은 수집기가 소유자 사용자로 가장할 때만 받는다(GW-07). 공유받은 파일의 권한은 소유자 쪽에서 한 번 받는다', 'Shared drive 권한(GW-19)은 이번 run 에 페이지가 없다'],
  })
  evidence.push({
    id: 'identity-evidence:gws-drive-permission-id-is-grantee', im_revision: CONFIG.revision, claim: 'reference_to_principal_space',
    left: 'gws:Permission.id', right: 'gws_drive:User.permissionId (About.user)', status: 'decided_reference', decision_ref: 'R1-D02',
    basis: { source: 'Google Drive API v3 Permission.id 설명: 받는 사람(grantee)의 고유 ID이며 User 리소스에 permissionId 로 게시된다', locator: 'https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions#Permission.FIELDS.id', checked_on: '2026-10-25' },
    empirical_support: { permission_id_to_grantee_functional: idFunctional, grantee_to_permission_id_functional: gFunctional, ids_on_several_files: reused },
    counter_evidence: idFunctional && gFunctional ? [] : ['같은 permission.id 가 서로 다른 grantee 에 나왔다'],
    observations: locators(perms),
    limitations: ['About.user.permissionId 를 이번 run 이 수집하지 않아 User 쪽 값은 미관측', 'permission.id 공간은 Directory User.id 와 다르다. Directory User 해소는 기존 resolver(type=user/group, emailAddress)를 쓴다', 'domain·anyone 권한은 이번 run 에 없다'],
    applied: dec('R1-D02').choice,
  })
  additions.push({
    im_revision: CONFIG.revision, space: 'gws:DriveGrantee', decision_ref: 'R1-D02', form: 'global',
    identity: { kind: 'native', key: 'User.permissionId (gws_drive:User, About.user)', scope: ['provider', 'tenant'] },
    referenced_by: [{ space: 'gws:Permission', field: 'id', relation: 'reference (grantee)', note: '권한 행 identity 의 grantee 부분' }],
    resolution_to_principal: { target: 'gws:User | gws:Group (Directory)', via: 'Permission.emailAddress / About.user.emailAddress', merge: false },
    object_disposition: 'non_object', non_object_destination: 'Principal 해소용 참조 공간. Directory User/Group 이 Object 다',
    shapes: ['sh:gws_drive:User'], observation: { permission_side: 'observed (Permission.id)', user_side: 'not_observed (About 미수집)' },
  })
  conflicts.push({
    id: 'conflict:gws-drive-owner-double-relation', im_revision: CONFIG.revision, kind: 'possible_duplicate_fact', status: 'decided', decision_ref: 'R1-D01', resolution: dec('R1-D01').choice,
    runtime_migration: 'normalize-v2/gws.ts 는 아직 두 Relation 을 모두 만든다. Profile/정규화기 반영 시 has_role_on guard 를 바꾸고 owned_by 에 via_assignment 를 붙여야 한다(이 세션은 운영 코드를 바꾸지 않았다)',
    facts: ['owned_by: File -> Principal (File.owners, Relation_Schema_v3 owned_by Resource --> Principal 근거)', 'has_role_on[owner]: Principal -> File (Permission role=owner, Interface Assignment)'],
    empirical: { owner_permissions: ownerPerms.length, matching_file_owners: ownerOverlap },
    current_runtime: 'aegi-adapter-engine-v3-readiness normalize-v2/gws.ts 가 둘 다 만든다 (234-250행 owned_by, 254-263행 has_role_on)',
    spec_refs: ['aegi-knowledge/schema/specs/Relation_Schema_v3.md:654 소유와 has_role_on 은 별개 관계'],
    question: 'Drive owner 권한 행이 File.owners 와 같은 사실일 때 두 Relation 을 모두 둘지, 하나를 via_assignment 근거로 접을지. 규격에서 공존 규칙을 찾지 못했다',
  })
  objects.push(
    { space: 'gws:File', disposition: 'object', interfaces: ['Resource'], identity: { kind: 'native', form: spD.File.form }, existing_decision_refs: ['pinned IR map form=global'], collection_status: 'observed', observations: files.length, contract_validation: 'pending' },
    { space: 'gws:Permission', disposition: 'object', interfaces: ['Assignment'], identity: { kind: 'composite', parts: ['tenant', 'gws:File', 'permission.id (grantee ID)'], form: spD.Permission.form }, existing_decision_refs: ['pinned IR map form=local parent=File', 'normalize-v2 gwsKey.permission(fileId, p.id)'], collection_status: 'observed_partial_surface', observations: perms.length, contract_validation: 'pending', notes: 'Assignment 는 Relation 끝점이 아니다. has_role_on 의 via_assignment 로 남는다(rulebook R2)' },
  )
  bindings.push({
    id: 'relation-binding:gws-drive-permission-has-role-on', im_revision: CONFIG.revision, status: 'decided_binding',
    input: { operation_ref: 'op:gws_drive:drive.permissions.list', record_selector: '$.permissions[*]', guard: "record.type in ['user','group'] and record.emailAddress present and not (record.role == 'owner' and record.emailAddress in File(request_params.file).owners[].emailAddress)" },
    semantic_disposition: 'relation', relation_type: 'has_role_on',
    slots: {
      source: { space: 'gws:User | gws:Group', identity_from: 'record.emailAddress -> type=user: Directory User.primaryEmail, type=group: Directory Group.email', resolver_ref: 'normalize-v2/gws.ts userOf / groupByEmail' },
      target: { space: 'gws:File', identity_from: 'request_params.file', binding: 'parameter_bindings.fileId' },
      role: { space: 'NamedRole(Policy)', identity_from: 'record.role', scope: ['provider', 'tenant', 'target object_type'], rule_ref: 'rulebook R1, model-v1/project.ts NamedRole' },
    },
    context: { assignment_ref: 'gws:Permission (tenant, file, permission.id)' },
    evidence: ['op:gws_drive:drive.permissions.list', 'rulebook R1, R2', ...locators(perms)],
    on_unresolved_target: 'preserve_reference_and_report_reason',
    decision_refs: ['R1-D01', 'R1-D02'],
    template_validation: 'pending_current_schema',
    replay: { records: perms.length, source_resolvable_by_email: resolvable, emitted_after_R1_D01: replay.drive.after_R1_D01.has_role_on },
  }, {
    id: 'relation-binding:gws-drive-file-owned-by', im_revision: CONFIG.revision, status: 'decided_binding', decision_refs: ['R1-D01'],
    input: { operation_ref: 'op:gws_drive:drive.files.list', record_selector: '$.files[*]', guard: 'record.owners[] 각 원소' },
    semantic_disposition: 'relation', relation_type: 'owned_by',
    slots: {
      source: { space: 'gws:File', identity_from: 'record.id' },
      target: { space: 'gws:User', identity_from: 'record.owners[].emailAddress -> Directory User.primaryEmail', resolver_ref: 'normalize-v2/gws.ts userOf' },
    },
    context: { assignment_ref: '같은 (파일, 사람)의 role=owner Permission 이 있으면 via_assignment 로 둔다 (선택)' },
    evidence: ['Relation_Schema_v3.md:218, 654', 'normalize-v2/gws.ts:234-250', ...locators(files)],
    on_unresolved_target: 'preserve_reference_and_report_reason',
    template_validation: 'pending_current_schema',
    replay: { emitted: replay.drive.after_R1_D01.owned_by, with_via_assignment: replay.drive.after_R1_D01.owned_by_with_via_assignment },
    runtime_comparison: { cohort_normalized: 'v3-refresh-20261023/relations.json', before_decision: { 'has_role_on[owner]': 6, owned_by: 6 }, note: '현행 정규화 출력은 같은 (사람, 파일)에 두 관계를 모두 갖는다. R1-D01 적용 시 has_role_on[owner] 6건이 빠진다' },
  }, {
    id: 'relation-binding:gws-drive-permission-shared-with', im_revision: CONFIG.revision, status: 'proposed_binding_for_existing_semantics',
    input: { operation_ref: 'op:gws_drive:drive.permissions.list', record_selector: '$.permissions[*]', guard: "record.type in ['domain','anyone']" },
    semantic_disposition: 'relation', relation_type: 'shared_with',
    slots: { source: { space: 'gws:File', identity_from: 'request_params.file' }, target: { space: 'gws:Customer', identity_from: 'tenant scope' } },
    evidence: ['normalize-v2/gws.ts 261행'], template_validation: 'pending_current_schema',
    replay: { records: perms.filter(p => p.r.type === 'domain' || p.r.type === 'anyone').length, note: '이번 run 에 해당 record 가 없어 실측 미검증' },
  })
}

// ---------- GitHub ----------
{
  const orgs = by(':orgs/get'), members = by(':orgs/list-members'), detail = by(':users/get-by-username'), collab = by(':repos/list-collaborators')
  const repos = [...by(':repos/list-for-org'), ...by(':repos/get')]
  const orgIds = orgs.map(o => o.r.id)
  const ownerTypes = count(repos, r => r.r.owner?.type), ownerIsOrg = repos.filter(r => r.r.owner?.type === 'Organization' && orgIds.includes(r.r.owner.id)).length
  const memberTypes = count(members, m => m.r.type), detailTypes = count(detail, d => d.r.type), collabTypes = count(collab, c => c.r.type)
  const shared = inter(members.map(m => m.r.id), detail.map(d => d.r.id))
  const loginToId = new Map(), conflictsLogin = []
  for (const x of [...members, ...detail, ...collab]) { const k = String(x.r.login).toLowerCase(); if (loginToId.has(k) && loginToId.get(k) !== x.r.id) conflictsLogin.push(k); loginToId.set(k, x.r.id) }
  replay.github = { repo_owner_types: ownerTypes, repo_owner_org_matches_orgs_get: ownerIsOrg, member_types: memberTypes, detail_types: detailTypes, collaborator_types: collabTypes, member_ids: uniq(members.map(m => m.r.id)).length, detail_ids: uniq(detail.map(d => d.r.id)).length, member_detail_shared_ids: shared.length, collaborator_ids_in_members: inter(collab.map(c => c.r.id), members.map(m => m.r.id)).length, login_id_conflicts: conflictsLogin.length }
  const poly = overrides.same_entity.github.polymorphic[0]
  evidence.push({
    id: 'identity-evidence:github-simple-user-polymorphic', im_revision: CONFIG.revision, claim: 'conditional_target', space: 'github:simple-user', status: 'corroborated_existing_decision', decision_ref: 'V2-S4',
    discriminator: { field: poly.field, cases: poly.cases },
    empirical_support: { observed_cases: uniq([...Object.keys(ownerTypes), ...Object.keys(memberTypes), ...Object.keys(detailTypes), ...Object.keys(collabTypes)]), organization_owner_matches_org_record: ownerIsOrg },
    unobserved_cases: Object.keys(poly.cases).filter(c => ![ownerTypes, memberTypes, detailTypes, collabTypes].some(t => t[c])),
    observations: locators([...repos, ...members, ...detail, ...collab]),
    limitations: ['미관측 분기는 검증 완료가 아니라 미검증이다'],
  })
  evidence.push({
    id: 'identity-evidence:github-user-list-detail', im_revision: CONFIG.revision, claim: 'view_of', left: 'github:simple-user (type=User, orgs/list-members)', right: 'github:public-user (users/get-by-username)', status: 'corroborated_existing_decision', decision_ref: 'V2-S4 polymorphic case User -> public-user',
    comparison: { key: 'record.id', required_scope: ['provider', 'github.com instance'], cohort_policy: 'same_pinned_cohort' },
    empirical_support: { list_ids: replay.github.member_ids, detail_ids: replay.github.detail_ids, shared_ids: shared.length, login_id_conflicts: conflictsLogin.length },
    observations: locators([...members, ...detail]),
    limitations: ['한 org·한 run 의 관측이다. 전체 API 의 유일성 증명이 아니다'],
  })
  objects.push(
    { space: 'github:public-user', disposition: 'object', interfaces: ['Principal'], identity: { kind: 'native', form: 'global' }, existing_decision_refs: ['V2-S4 case User|Bot'], collection_status: 'observed', observations: detail.length, contract_validation: 'pending' },
    { space: 'github:organization-full', disposition: 'object', interfaces: ['Tenant'], identity: { kind: 'native', form: 'global' }, existing_decision_refs: ['V2-S4 case Organization'], collection_status: 'observed', observations: orgs.length, contract_validation: 'pending' },
  )
  objects.push({ space: 'github:simple-user', disposition: 'non_object', non_object_destination: 'conditional reference: type=User|Bot -> public-user, type=Organization -> organization-full (V2-S4)', existing_decision_refs: ['V2-S4'], collection_status: 'observed', observations: members.length + repos.length, contract_validation: 'n/a' })
}

// ---------- Okta ----------
{
  const apps = by(':listApplications'), clients = by(':listClients'), userClients = by(':listUserClients')
  const declared = apps.filter(a => a.r.credentials?.oauthClient?.client_id)
  const appCid = declared.map(a => a.r.credentials.oauthClient.client_id), appIds = apps.map(a => a.r.id)
  const cIds = clients.map(c => c.r.client_id), ucIds = userClients.map(c => c.r.client_id)
  replay.okta = {
    applications: apps.length, applications_with_declared_client_id: declared.length,
    clients_listClients: uniq(cIds).length, clients_matching_declared: inter(cIds, appCid).length, clients_matching_app_id_only: inter(cIds, appIds).filter(v => !appCid.includes(v)).length,
    user_client_records: userClients.length, user_client_ids: uniq(ucIds).length, user_clients_matching_declared: inter(ucIds, appCid).length, user_clients_unmatched: uniq(ucIds).filter(v => !appCid.includes(v)).length,
    user_clients_unmatched_in_listClients: inter(uniq(ucIds).filter(v => !appCid.includes(v)), cIds).length,
    user_clients_unmatched_names: uniq(userClients.filter(c => !appCid.includes(c.r.client_id)).map(c => c.r.client_name)).sort(),
    declared_client_id_equals_app_id: declared.filter(a => a.r.credentials.oauthClient.client_id === a.r.id).length,
    identity_source_user_records: records.filter(x => /identity-source/i.test(x.op)).length,
  }
  evidence.push({
    id: 'identity-evidence:okta-application-oauth2client', im_revision: CONFIG.revision, claim: 'same_entity', left: 'okta:Application', right: 'okta:OAuth2Client', status: inter(ucIds, appCid).length ? 'corroborated_existing_decision' : 'decision_kept_no_pair_in_cohort', decision_ref: 'V2-D05',
    comparison: { left: 'record.credentials.oauthClient.client_id', right: 'record.client_id', required_scope: ['provider', 'tenant'], cohort_policy: 'same_pinned_cohort' },
    empirical_support: { user_client_ids: replay.okta.user_client_ids, matched: replay.okta.user_clients_matching_declared, unmatched: replay.okta.user_clients_unmatched, declared_client_id_equals_app_id: replay.okta.declared_client_id_equals_app_id },
    counter_evidence: [], observations: locators([...apps, ...userClients]),
    interpretation: '이번 run 의 OAuth2Client 는 Okta 자체 클라이언트(이름만 표시)라 Application 목록에 없다. V2-D05 의 "짝이 없는 클라이언트는 Integration" 분기에 해당하며 반례가 아니다. 짝이 있는 분기의 실측은 이번 run 에 없다',
    unmatched_client_names: replay.okta.user_clients_unmatched_names,
    limitations: ['V2-D05: 짝이 없는 클라이언트는 별도 Integration 으로 남는다', 'OAuth2Client 는 사용자별 목록(OK-09)으로만 관측된다. 사용자가 없는 클라이언트는 이 경로로 보이지 않는다'],
  })
  evidence.push({
    id: 'identity-evidence:okta-application-client', im_revision: CONFIG.revision, claim: 'view_of', left: 'okta:Application', right: 'okta:Client (oauth2/v1/clients)', status: 'corroborated_existing_ir', decision_ref: 'pinned out2 same_entity view_or_variant',
    comparison: { left: 'record.credentials.oauthClient.client_id', right: 'record.client_id', required_scope: ['provider', 'tenant'] },
    empirical_support: { clients: replay.okta.clients_listClients, matched: replay.okta.clients_matching_declared, matched_by_app_id_only: replay.okta.clients_matching_app_id_only },
    observations: locators([...apps, ...clients]),
    limitations: ['짝이 없는 Client 는 미수집 App 인지 별개 대상인지 이번 run 으로 판정할 수 없다'],
  })
  objects.push(
    { space: 'okta:Application', disposition: 'object', interfaces: ['Integration'], identity: { kind: 'native', form: 'global' }, existing_decision_refs: ['V2-D05'], collection_status: 'observed', observations: apps.length, contract_validation: 'pending' },
    { space: 'okta:OAuth2Client', disposition: 'object', interfaces: ['Integration'], identity: { kind: 'conditional_alias', alias_of: 'okta:Application', condition: 'credentials.oauthClient.client_id 일치', else: '별도 Integration' }, existing_decision_refs: ['V2-D05'], collection_status: 'observed_partial_surface', observations: userClients.length, contract_validation: 'pending', notes: '이번 run 의 2건은 짝 없음(Okta 자체 클라이언트) -> 별도 Integration 분기' },
    { space: 'okta:Client', disposition: 'non_object', non_object_destination: 'okta:Application 의 view (client_id 일치 시). 짝 없는 Client 는 unresolved', existing_decision_refs: ['pinned out2 same_entity view_or_variant'], collection_status: 'observed', observations: clients.length, contract_validation: 'n/a' },
    { space: 'okta:UserResponseSchema', disposition: 'non_object', non_object_destination: '신원 Link 재료 (identity source 의 사용자. rulebook O7 LINK_ONLY)', existing_decision_refs: ['V2-S3', 'rulebook O7'], collection_status: 'not_observed', observations: 0, contract_validation: 'n/a' },
  )
  evidence.push({
    id: 'identity-evidence:okta-identity-source-user', im_revision: CONFIG.revision, claim: 'different_entity', left: 'okta:UserGetSingleton', right: 'okta:UserResponseSchema', status: 'decision_kept_not_observed', decision_ref: 'V2-S3',
    empirical_support: { identity_source_records: 0 }, observations: [],
    limitations: ['이번 run 은 identity-sources 계열 operation 을 수집하지 않았다. negative control 은 결정으로 유지하고 실측 검증 미완료로 둔다'],
  })
}

// ---------- 기존 결정과 pinned out2 동일성 출력의 충돌 ----------
// pinned out2 same_entity 는 v2 overrides(같은 날 결정) 이전 판정을 담고 있다. revision 은 v2 사용자 결정을 적용한다.
for (const [prov, ov] of Object.entries(overrides.same_entity)) {
  const se = sameEntity(prov)
  for (const d of ov.different ?? []) {
    const g = se.groups.find(g => d.pair.every(m => g.members.includes(m)))
    const p = se.pairs.find(x => d.pair.every(m => x.pair.includes(m)))
    splits.push({ im_revision: CONFIG.revision, provider: prov, pair: d.pair, decision_ref: d.code, why: d.why, pinned_out2: g ? `same group ${g.canonical}` : p ? p.decision : 'absent', action: g || (p && p.decision !== 'different') ? 'split_from_pinned_group' : 'already_separate' })
    const rp = regenEntity(prov).pairs.find(x => d.pair.every(m => x.pair.includes(m))), rg = regenEntity(prov).groups.find(g => d.pair.every(m => g.members.includes(m)))
    const regenerated = { pair_decision: rp?.decision ?? 'absent', still_grouped: !!rg }
    if (g || (p && p.decision !== 'different')) conflicts.push({ id: `conflict:${prov}-${d.pair.join('-')}`, im_revision: CONFIG.revision, kind: 'pinned_output_vs_user_decision', status: regenerated.pair_decision === 'different' && !rg ? 'resolved_by_regeneration' : 'regeneration_disagrees', decision_ref: d.code, decided_on: decisionDate, resolution_decision: 'R1-D05', pinned_out2: g ? { group: g.canonical, members: g.members } : { pair_decision: p.decision }, regenerated, resolution: 'v2 사용자 결정을 반영한 재생성본(r1-pilot/regenerated-same-entity)을 동일성 입력으로 쓴다. pinned out2 는 수정하지 않는다' })
  }
  for (const pm of ov.polymorphic ?? []) splits.push({ im_revision: CONFIG.revision, provider: prov, space: pm.space, kind: 'conditional_target', discriminator: pm.field, cases: pm.cases, decision_ref: pm.code })
}
{
  const se = sameEntity('okta'), p = se.pairs.find(x => x.pair.includes('Application') && x.pair.includes('OAuth2Client'))
  aliases.push({ im_revision: CONFIG.revision, provider: 'okta', canonical: 'Application', alias: 'OAuth2Client', kind: 'conditional_alias', condition: 'Application.credentials.oauthClient.client_id = OAuth2Client.client_id (same tenant)', unmatched: 'OAuth2Client 는 Integration 으로 남는다', decision_ref: 'V2-D05', pinned_out2: p?.decision ?? 'absent' })
  if (p && p.decision === 'different') conflicts.push({ id: 'conflict:okta-Application-OAuth2Client', im_revision: CONFIG.revision, kind: 'pinned_output_vs_user_decision', status: 'resolved_by_existing_decision', decision_ref: 'V2-D05', decided_on: '2026-10-19', pinned_out2: { pair_decision: p.decision }, resolution: '짝이 있는 경우만 조건부 alias. 무조건 병합하지 않는다. V2-D05 는 research override 가 아닌 런타임 alias 결정이라 재생성본에도 different 로 남으므로 r1 alias overlay 로 유지한다', regenerated: { pair_decision: regenEntity('okta').pairs.find(x => x.pair.includes('Application') && x.pair.includes('OAuth2Client'))?.decision ?? 'absent' } })
  aliases.push({ im_revision: CONFIG.revision, provider: 'github', canonical: 'public-user', alias: 'simple-user[type=User|Bot]', kind: 'conditional_alias', decision_ref: 'V2-S4' })
  aliases.push({ im_revision: CONFIG.revision, provider: 'github', canonical: 'organization-full', alias: 'simple-user[type=Organization]', kind: 'conditional_alias', decision_ref: 'V2-S4' })
}

// ---------- R1-D03 / R1-D04: 정규화기에만 있던 공간과 Slack 승인 record ----------
{
  const manifests = by(':apps.manifest.export'), cmds = manifests.flatMap(m => (m.r.manifest?.features?.slash_commands ?? []).map(c => ({ m, c })))
  const cmdKeys = cmds.map(({ m, c }) => `${m.rp.app_id}|${c.command}`)
  additions.push({
    im_revision: CONFIG.revision, space: 'slack:SlashCommandRequestEndpoint', decision_ref: 'R1-D03', form: 'composite_key',
    identity: { kind: 'composite', parts: ['request_params.app_id (apps.manifest.export)', 'manifest.features.slash_commands[].command'], scope: ['provider', 'tenant'] },
    source: { operation_ref: 'op:slack_docs_methods:apps.manifest.export', record_selector: '$.manifest.features.slash_commands[*]' },
    parent: { space: 'slack App (app_id)', relation: 'owned_by', runtime_ref: 'normalize-v2/slack.ts:212-222 owned_by AppInstall' },
    object_disposition: 'object', interfaces: ['Endpoint'],
    observation: { manifests: manifests.length, commands: cmds.length, unique_keys: uniq(cmdKeys).length },
  })
  const sp = by(':getSpacePermissionsAssignments')
  const bundleKey = x => `${x.rp.space}|${x.r.principal?.type}|${x.r.principal?.id}`
  additions.push({
    im_revision: CONFIG.revision, space: 'confluence:SpacePermission', decision_ref: 'R1-D03', existing_decision_refs: ['G4-Q01'], form: 'composite_key',
    identity: { kind: 'composite', parts: ['request_params.space', 'record.principal.type', 'record.principal.id'], scope: ['provider', 'site'] },
    source: { operation_ref: 'op:confluence_openapi_v2:getSpacePermissionsAssignments', record_selector: '$.results[*]', grouping: '같은 (스페이스, 주체) 행을 한 건으로 묶고 operation.key:targetType 목록을 permissions 속성으로 둔다. 원본 행 id 는 provenance 로 보존' },
    parent: { space: 'confluence Space', identity_from: 'request_params.space' },
    object_disposition: 'object', interfaces: ['Assignment'],
    observation: { source_rows: sp.length, bundles: uniq(sp.map(bundleKey)).length },
    runtime_ref: 'normalize-v2/atlassian.ts:184-204',
  })
  const appr = [...by(':admin.apps.approved.list'), ...by(':admin.apps.restricted.list')]
  additions.push({
    im_revision: CONFIG.revision, space: null, kind: 'parent_property_binding', decision_ref: 'R1-D04',
    source: { operation_refs: ['op:slack_docs_methods:admin.apps.approved.list', 'op:slack_docs_methods:admin.apps.restricted.list'], record_selectors: ['$.approved_apps[*]', '$.restricted_apps[*]'] },
    parent: { space_candidates: ['slack:200.approved_apps[*].app', 'slack:200.restricted_apps[*].app'], identity: ['request_params.team_id | request_params.enterprise_id', 'record.app.id'] },
    properties: { approval: 'approved_apps -> approved, restricted_apps -> restricted', date_updated: 'record.date_updated', last_resolved_by: 'record.last_resolved_by{actor_id, actor_type}', scopes: 'record.scopes[]{name, is_sensitive, token_type, description}' },
    object_disposition: 'non_object', rule: 'O4',
    observation: { records: appr.length, note: appr.length ? null : '이번 run 의 두 목록이 비어 있다. 규칙 적용, 실측 미검증' },
    runtime_ref: 'normalize-v2/slack.ts:186-196 (approval, date_updated 만 사용)',
  })
  objects.push(
    { space: 'slack:SlashCommandRequestEndpoint', disposition: 'object', interfaces: ['Endpoint'], identity: { kind: 'composite' }, existing_decision_refs: ['R1-D03'], collection_status: cmds.length ? 'observed' : 'not_observed', observations: cmds.length, contract_validation: 'pending' },
    { space: 'confluence:SpacePermission', disposition: 'object', interfaces: ['Assignment'], identity: { kind: 'composite' }, existing_decision_refs: ['G4-Q01', 'R1-D03'], collection_status: 'observed', observations: uniq(sp.map(bundleKey)).length, contract_validation: 'pending' },
    { space: 'gws:DriveGrantee', disposition: 'non_object', non_object_destination: 'Principal 해소용 참조 공간 (R1-D02)', existing_decision_refs: ['R1-D02'], collection_status: 'observed_partial_surface', observations: 0, contract_validation: 'n/a' },
  )
  replay.r1_spaces = { slash_commands: cmds.length, slash_command_unique_keys: uniq(cmdKeys).length, space_permission_rows: sp.length, space_permission_bundles: uniq(sp.map(bundleKey)).length, slack_approval_records: appr.length }
}

// ---------- R1-D08~D10: v2 미결 3건 ----------
{
  splits.push({ im_revision: CONFIG.revision, provider: 'github', pair: ['simple-user', 'team-membership.username'], decision_ref: 'R1-D09', why: dec('R1-D09').basis, pinned_out2: 'same group simple-user', action: 'split_from_regenerated_group' })
  aliases.push({ im_revision: CONFIG.revision, provider: 'github', canonical: 'public-user', alias: 'team-membership.username', kind: 'key_reference', key: 'login', decision_ref: 'R1-D09' })
  const reg = regenEntity('slack').pairs
  for (const [pair, basis, strength] of [[['200.file', 'objs_file'], 'stated_same_operation_slot', 'stated'], [['200.channel|1', 'objs_conversation|0'], 'stated_format_compatible', 'stated'], [['200.channel', 'objs_channel'], 'example_matches_stated_format', 'example']]) {
    const r = reg.find(x => pair.every(m => x.pair.includes(m)))
    evidence.push({ id: `identity-evidence:slack-${pair.join('-')}`, im_revision: CONFIG.revision, claim: 'same_entity', left: `slack:${pair[0]}`, right: `slack:${pair[1]}`, status: 'basis_upgraded', decision_ref: 'R1-D10', previous_basis: r?.basis ?? null, basis_kind: basis, basis_strength: strength, regenerated_decision: r?.decision ?? 'absent', limitations: strength === 'example' ? ['한쪽 형식은 문서 예시 값에서만 온다'] : [] })
  }
  objects.push({ space: 'jira:{}_2', disposition: 'non_object', non_object_destination: 'jira:RemoteIssueLink 의 대체 주소 키(globalId). /issue/{id}/remotelink?globalId', existing_decision_refs: ['V2-S6', 'R1-D08'], collection_status: 'not_observed', observations: 0, contract_validation: 'n/a' })
}

writeJsonl(path.join(OUT, 'identity-evidence.jsonl'), evidence)
writeJsonl(path.join(OUT, 'space-aliases.jsonl'), aliases)
writeJsonl(path.join(OUT, 'space-splits.jsonl'), splits)
writeJsonl(path.join(OUT, 'identity-conflicts.jsonl'), conflicts)
writeJsonl(path.join(OUT, 'object-decisions.jsonl'), objects.map(o => ({ im_revision: CONFIG.revision, ...o })))
writeJsonl(path.join(OUT, 'relation-bindings.jsonl'), bindings)
writeJsonl(path.join(OUT, 'space-additions.jsonl'), additions)
writeJson(path.join(OUT, 'pilot-replay.json'), { revision: CONFIG.revision, cohort: CONFIG.cohort.run, records_expanded: records.length, ...replay })
console.log(JSON.stringify(replay, null, 1))
