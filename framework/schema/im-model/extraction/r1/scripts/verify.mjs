// r1-pilot 검증: 입력 보존, 분모 일치, 파일럿 재현값, 원본 값 비유출, 입력 해시 기록.
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG, OUT, ROOT, cohortDir, fileSha, ir, loadEnvelopes, readJson, readJsonl, writeJson } from './lib.mjs'

const checks = [], fail = []
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); if (!ok) fail.push(name) }

// 1. bridge: envelope 마다 link 하나, 상태 합계, operation 실재
const envs = loadEnvelopes(), links = readJsonl(path.join(OUT, 'observation-operation-links.jsonl'))
check('bridge_one_link_per_envelope', links.length === envs.length && new Set(links.map(l => l.id)).size === envs.length, { envelopes: envs.length, links: links.length })
const cov = readJson(path.join(OUT, 'bridge-coverage.json'))
check('bridge_page_totals', Object.values(cov.pages).reduce((a, b) => a + b, 0) === envs.length, cov.pages)
const opIds = new Map()
for (const l of links.filter(l => l.operation.ir_operation_id)) {
  const p = l.operation.research_provider
  if (!opIds.has(p)) opIds.set(p, new Set(ir(p, 'operation').map(o => o.id)))
  if (!opIds.get(p).has(l.operation.ir_operation_id)) fail.push(`missing_op:${l.operation.ir_operation_id}`)
}
check('bridge_operations_exist_in_pinned_ir', !fail.some(f => f.startsWith('missing_op')), { matched_pages: links.filter(l => l.operation.ir_operation_id).length })
check('bridge_file_hashes_match_raw', links.every(l => fileSha(path.join(cohortDir(), l.source.raw_file)) === l.source.file_sha256), { files: links.length })
check('bridge_no_first_candidate_pick', links.filter(l => l.operation.status === 'ambiguous').every(l => !l.operation.ir_operation_id), {})

// 2. 파일럿 재현값 (조사 패키지 measured-probes 와 같은 run)
const rp = readJson(path.join(OUT, 'pilot-replay.json')), mp = readJson('<LOCAL_WORKSPACE_PATH>')
check('drive_replay_matches_investigation', rp.drive.unique_files === mp.drive_permission.unique_file_ids && rp.drive.permission_records === mp.drive_permission.permission_occurrences && rp.drive.unique_permission_ids === mp.drive_permission.unique_permission_ids && rp.drive.permission_ids_on_several_files === mp.drive_permission.permission_ids_observed_on_multiple_file_ids, rp.drive)
check('drive_scoped_identity_no_collision', rp.drive.unique_file_permission_pairs === rp.drive.permission_records, {})
check('drive_permission_id_grantee_bijection', rp.drive.permission_id_to_grantee_functional && rp.drive.grantee_to_permission_id_functional, {})
check('github_list_detail_replay', rp.github.member_detail_shared_ids === mp.github_user_list_detail.shared_ids, rp.github)
check('okta_client_replay', rp.okta.clients_matching_declared === mp.okta_client_application.clients_matching_declared_oauth_client_id, rp.okta)

// 3. 고아 보존: map 의 고아 항목 전부가 정확히 한 번씩 귀속 결과 또는 미결 사유를 갖는다
const disp = readJsonl(path.join(OUT, 'information-disposition.jsonl'))
const mapKeys = []
for (const p of ['github', 'okta', 'slack', 'gws', 'jira', 'confluence', 'atlassian', 'salesforce']) for (const i of readJson(path.join(CONFIG.ir_root, p, 'map', 'info_map.json')).items) if (i.det.startsWith('orphan:')) mapKeys.push(`${p}|${i.key}`)
const dKeys = disp.map(d => `${d.provider}|${d.information_item_key}`)
check('orphan_items_preserved', dKeys.length === mapKeys.length && new Set(dKeys).size === dKeys.length && mapKeys.every(k => new Set(dKeys).has(k)), { map: mapKeys.length, dispositions: dKeys.length })
check('orphan_unresolved_have_reason', disp.filter(d => d.disposition === 'unresolved').every(d => d.unresolved_reason), {})
check('orphan_resolved_have_basis', disp.filter(d => d.disposition !== 'unresolved').every(d => d.basis), {})

// 4. 원본 값 비유출: 파일럿 record 의 실제 ID·이메일이 공개 산출물에 없다
const secrets = new Set()
// 식별자형 값만 본다: 숫자나 @ 가 들어 있고 6자 이상. 'github', 'groups' 같은 일반 단어 요청값은 제외한다
const idLike = x => typeof x === 'string' && x.length >= 6 && /[0-9@]/.test(x)
const collect = v => { if (v == null) return; if (typeof v === 'object') { for (const [k, x] of Object.entries(v)) { if (idLike(x) && /(^|_)(id|email|emailAddress|login|client_id|primaryEmail|sha)$/i.test(k)) secrets.add(x); collect(x) } } }
for (const { env } of envs) { collect(env.payload); for (const x of Object.values(env.request_params ?? {})) if (idLike(x)) secrets.add(x) }
const outFiles = fs.readdirSync(OUT, { recursive: true }).map(f => path.join(OUT, f)).filter(f => fs.statSync(f).isFile())
const leaks = []
for (const f of outFiles) {
  const t = fs.readFileSync(f, 'utf8')
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test(t)) leaks.push({ file: path.basename(f), kind: 'email_pattern' })
  // 다른 값의 일부로 들어간 경우(문서 예시 '1298393284' 안의 '393284' 등)는 세지 않는다. 앞뒤가 영숫자가 아닐 때만 일치다
  const bounded = (t, s) => { let i = t.indexOf(s); while (i >= 0) { const b = t[i - 1] ?? '', e = t[i + s.length] ?? ''; if (!/[A-Za-z0-9]/.test(b) && !/[A-Za-z0-9]/.test(e)) return true; i = t.indexOf(s, i + 1) } return false }
  const hit = [...secrets].filter(s => bounded(t, s))
  if (hit.length) leaks.push({ file: path.basename(f), kind: 'raw_value', count: hit.length, lengths: hit.map(s => s.length).slice(0, 5) })
}
// 수집 run ID·call ID·벤더 제품 이름처럼 비밀이 아닌 값은 secrets 에 들어가지 않도록 길이·키 이름으로 거른다
check('no_raw_values_in_outputs', leaks.length === 0, { candidates_checked: secrets.size, leaks })

// 5. 사용자 결정 R1-D01~D05 반영
const conflicts = readJsonl(path.join(OUT, 'identity-conflicts.jsonl'))
check('no_open_conflicts', conflicts.every(c => c.status !== 'open' && c.status !== 'regeneration_disagrees'), conflicts.map(c => `${c.id}:${c.status}`))
const a1 = rp.drive.after_R1_D01
check('R1_D01_owner_folded', a1.owner_permissions_kept_as_has_role_on === 0 && a1.owned_by_with_via_assignment === rp.drive.owner_permissions_matching_file_owners && a1.has_role_on === rp.drive.permission_records - rp.drive.owner_permissions_matching_file_owners, a1)
const adds = readJsonl(path.join(OUT, 'space-additions.jsonl'))
check('R1_D02_D03_D04_spaces_added', ['gws:DriveGrantee', 'slack:SlashCommandRequestEndpoint', 'confluence:SpacePermission'].every(sp => adds.some(a => a.space === sp)) && adds.some(a => a.decision_ref === 'R1-D04'), adds.map(a => a.space ?? a.kind))
// 같은 run 의 현행 정규화 출력과 composite 공간 개수가 같은지
const norm = readJson(path.join(CONFIG.cohort.root, 'objects.json')), nt = t => norm.filter(o => o.canonical?.object_type === t).length
check('R1_D03_matches_runtime_counts', rp.r1_spaces.space_permission_bundles === nt('SpacePermission') && rp.r1_spaces.slash_command_unique_keys === nt('Slash Command Request Endpoint'), { im: rp.r1_spaces, runtime: { SpacePermission: nt('SpacePermission'), 'Slash Command Request Endpoint': nt('Slash Command Request Endpoint') } })
const regen = readJson(path.join(OUT, 'regenerated-same-entity', 'diff-vs-pinned.json'))
const regenSplits = Object.entries(regen.providers).flatMap(([p, r]) => r.changed_pairs.filter(c => c.regenerated === 'different').map(c => `${p}:${[...c.pair].sort().join('|')}`)).sort()
const overlaySplits = readJsonl(path.join(OUT, 'space-splits.jsonl')).filter(x => x.pair && x.action === 'split_from_pinned_group').map(x => `${x.provider}:${[...x.pair].sort().join('|')}`).sort()
check('R1_D05_regeneration_equals_overlay', JSON.stringify(regenSplits) === JSON.stringify(overlaySplits) && Object.values(regen.providers).every(r => r.run.sent === 0), { regenSplits, overlaySplits })

// 6. 확대 단계 보존·분모
const dup = readJsonl(path.join(OUT, 'duplicate-dispositions.jsonl'))
check('duplicates_all_323_linked', dup.length === 323 && dup.every(d => d.decision_source && d.status), { pairs: dup.length })
const go = readJsonl(path.join(OUT, 'graph-orphans.jsonl')), gos = readJson(path.join(OUT, 'graph-orphans-summary.json'))
check('graph_orphans_all_classified', go.length === 1081 && go.every(g => g.status) && Object.values(gos.by_status).reduce((a, b) => a + b, 0) === 1081, gos.by_status)
const v1types = readJson(path.join(CONFIG.ir_root, 'v1', 'object_types.json')), full = readJsonl(path.join(OUT, 'object-decisions-full.jsonl'))
check('objects_cover_all_v1_types', v1types.every(t => full.some(r => r.object_type_id === t.id)) && full.every(r => ['object', 'non_object', 'unresolved'].includes(r.disposition)), { v1: v1types.length, rows: full.length })
const refsD = readJsonl(path.join(OUT, 'reference-dispositions.jsonl'))
check('typed_references_all_disposed', refsD.length === 5293 && new Set(refsD.map(r => r.id)).size === 5293 && refsD.every(r => r.disposition && (r.disposition !== 'unresolved' || r.unresolved_reason)), { refs: refsD.length })
const dc = readJsonl(path.join(OUT, 'decision-conflicts.jsonl')), vc = readJsonl(path.join(OUT, 'version-conflicts.jsonl'))
check('no_open_decision_or_version_conflicts', dc.every(c => c.status.startsWith('resolved')) && vc.every(c => c.status?.startsWith('resolved')), { decision_conflicts: dc.length, version_conflicts: vc.length })
const decs = readJson(path.join(ROOT, 'config/decisions.json')).decisions.map(d => d.code)
const usedRefs = new Set([...readJsonl(path.join(OUT, 'information-disposition.jsonl')).flatMap(d => d.decision_refs ?? []), ...full.flatMap(r => r.decision_refs ?? [])].filter(x => /^R1-Dd+$/.test(x)))
check('all_r1_refs_declared', [...usedRefs].every(x => decs.includes(x)), { used: [...usedRefs].sort(), declared: decs })

// 7. 입력 해시
const inputs = {
  config: ['config/bridge-config.json', 'config/orphan-judgments.json', 'config/decisions.json'].map(p => ({ path: p, sha256: fileSha(path.join(ROOT, p)) })),
  knowledge: ['research_overrides_v2.json', 'relation_decisions_v2.json', 'rulebook/rules.json'].map(p => { const f = `<LOCAL_WORKSPACE_PATH>}`; return { path: f, sha256: fileSha(f) } }),
  pinned_ir: ['github', 'okta', 'slack', 'gws', 'jira', 'confluence', 'atlassian', 'salesforce'].flatMap(p => ['ir/operation.jsonl', 'ir/shape.jsonl', 'ir/instance.jsonl', 'map/info_map.json', 'map/same_entity.json'].map(x => { const f = path.join(CONFIG.ir_root, p, x); return { path: `${p}/${x}`, sha256: fileSha(f) } })),
  run_record: { path: `runs/${CONFIG.cohort.run}.json`, sha256: fileSha(path.join(CONFIG.cohort.root, 'runs', `${CONFIG.cohort.run}.json`)) },
  raw_pages: envs.length,
}
// 조사 패키지의 source-manifest 와 겹치는 knowledge 파일이 그때와 같은지
const sm = readJson('<LOCAL_WORKSPACE_PATH>')
const smRows = (sm.sources ?? sm.files ?? sm).filter?.(x => x.path && x.sha256) ?? []
const changed = smRows.filter(x => fs.existsSync(x.path) && fileSha(x.path) !== x.sha256).map(x => x.path)
check('investigation_sources_unchanged', changed.length === 0, { compared: smRows.length, changed })

const out = { revision: CONFIG.revision, status: fail.length ? 'failed' : 'passed', checks, failures: fail, inputs, scope: '파일럿 산출물의 보존·분모·재현·비유출 검사. 의미 판정의 정답 검증이 아니며 Profile·운영 계약 검증을 포함하지 않는다' }
writeJson(path.join(ROOT, 'verification.json'), out)
console.log(JSON.stringify({ status: out.status, failures: fail, checks: checks.map(c => `${c.ok ? 'ok ' : 'NG '} ${c.name}`) }, null, 1))
process.exit(fail.length ? 1 : 0)
