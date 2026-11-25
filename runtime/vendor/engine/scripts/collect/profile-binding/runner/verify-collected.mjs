// Source-based regression checks for the collected cohort. Uses local files only.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const ROOT=path.resolve(import.meta.dirname,'..'),ENGINE_ROOT=path.resolve(ROOT,'../../..')
// Historical 2026-10-23 cohort assertions (fixed expected counts), not the general pipeline gate.
const arg = name => { const i=process.argv.indexOf(name); if(i<0 || !process.argv[i+1] || process.argv[i+1].startsWith('--')) throw new Error('Required: '+name); return process.argv[i+1] }
const id=arg('--run'),cohortRoot=path.resolve(arg('--raw')),cohortRun=id
const OUT=path.resolve(arg('--dataset')),rawDir=path.join(cohortRoot,'raw',cohortRun)
const read=f=>JSON.parse(fs.readFileSync(path.join(OUT,`${f}.json`),'utf8'))
const objects=read('objects'),relations=read('relations'),report=read('runner-report'),manifest=read('manifest')
const runtimeConfig=JSON.parse(fs.readFileSync(path.join(ROOT,'runtime-config.json'),'utf8'))
const raw=[]
for(const p of fs.readdirSync(rawDir))for(const f of fs.readdirSync(path.join(rawDir,p)).filter(f=>f.endsWith('.json')))raw.push(JSON.parse(fs.readFileSync(path.join(rawDir,p,f),'utf8')))
const pages=(p,c)=>raw.filter(x=>x.provider===p&&x.call_id===c)
const rows=(p,c,k)=>pages(p,c).flatMap(e=>Array.isArray(e.payload)?e.payload:Array.isArray(e.payload?.[k])?e.payload[k]:[])
const outType=(p,t)=>objects.filter(o=>o.canonical.provider===p&&o.canonical.object_type===t)
const checks=[]
function test(name,fn){try{fn();checks.push({name,ok:true})}catch(e){checks.push({name,ok:false,error:e.message})}}
const ordered=x=>[...x].sort()
test('all_identity_expressions_resolved',()=>assert.equal(report.counts.rejected_identity,0))
test('all_profile_rule_constructs_supported',()=>assert.deepEqual(report.relation_rules.unsupported,[]))
test('drive_permission_pairs_match_raw_file_scopes',()=>{
  const expected=new Set(pages('gws','GW-07').filter(e=>e.request_params.file).flatMap(e=>(e.payload.permissions??[]).map(r=>`${e.request_params.file}:${r.id}`)))
  assert.equal(expected.size,7)
  const actual=outType('gws','Permission').map(o=>o.fixture_meta.im_profile.runtime_id)
  assert.deepEqual(ordered(actual),ordered(expected))
})
test('drive_owner_decision_keeps_assignment_evidence_without_duplicate_grant',()=>{
  const owners=relations.filter(r=>r.canonical.provider==='gws'&&r.canonical.relation_type==='owned_by'&&r.canonical.properties.via_assignment)
  assert.equal(owners.length,6)
  for(const r of owners){const a=r.canonical.references.source.value,b=r.canonical.references.target.value
    assert(!relations.some(x=>x.canonical.relation_type==='has_role_on'&&x.canonical.references.role?.value==='owner'&&x.canonical.references.source.value===b&&x.canonical.references.target.value===a))
    assert(objects.some(o=>o.fixture_key===r.canonical.properties.via_assignment&&o.canonical.object_type==='Permission'))
  }
})
test('workflow_collaborators_are_expanded_as_assignment_rows',()=>{
  const expected=rows('slack','SL-17','workflows').flatMap(w=>(w.collaborators??[]).map(u=>`${w.id}|${u}`))
  const actual=outType('slack','workflow-collaborator').map(o=>o.canonical.identifiers.primary.map(n=>o.canonical.identifiers[n].value).join('|'))
  assert.equal(expected.length,1);assert.deepEqual(ordered(actual),ordered(expected))
  assert(relations.some(r=>r.canonical.relation_type==='has_role_on'&&r.canonical.references.role?.value==='collaborator'))
})
test('space_permission_grouping_preserves_all_principal_space_pairs',()=>{
  const expected=new Set(pages('atlassian','CF-02').flatMap(e=>(Array.isArray(e.payload)?e.payload:e.payload.results??e.payload.values??[]).filter(r=>r.principal?.id).map(r=>`${e.request_params.space}|${r.principal.type}|${r.principal.id}`)))
  const actual=outType('atlassian','SpacePermission')
  assert.equal(actual.length,28)
  assert.equal(actual.length,expected.size)
  assert.equal(outType('atlassian','SpecialPrincipal').length,2)
})
test('token_dependency_is_resolved_after_users',()=>assert.equal(outType('gws','Token').length,8))
test('later_integration_logs_do_not_erase_oauth_callback_fields',()=>{
  const callbacks=rows('worker','D-21','results').filter(r=>r.raw_response?.app_id&&r.raw_response?.incoming_webhook?.channel_id&&r.webhook_url_fingerprint)
  assert(callbacks.length>0)
  const firstByScope=new Map()
  for(const r of callbacks){const scope=`${r.raw_response.app_id}:${r.raw_response.incoming_webhook.channel_id}`;if(!firstByScope.has(scope))firstByScope.set(scope,r)}
  assert.equal(firstByScope.size,6)
  for(const r of firstByScope.values()){
    const hook=r.raw_response.incoming_webhook
    const o=outType('slack',runtimeConfig.aliases['slack:incoming-webhook']).find(o=>o.fixture_meta.im_profile.runtime_id===`${r.raw_response.app_id}:${hook.channel_id}`)
    assert(o)
    assert.equal(o.canonical.properties.webhook_url_sha256,r.webhook_url_fingerprint)
    assert.equal(o.canonical.properties.configuration_url,hook.configuration_url)
    assert(o.canonical.properties.installed_at)
  }
})
test('empty_chromeos_list_does_not_become_a_device',()=>{
  const env=pages('gws','GW-90').find(e=>e.request_params.probe==='ChromeOsDevice')
  assert(env);assert.equal((env.payload.chromeosdevices??[]).length,0)
  assert.equal(outType('gws','ChromeOsDevice').length,0)
})
test('shared_empty_shapes_do_not_bind_commit_authors_as_actions_variables',()=>{
  assert.equal(outType('github','actions-variable').length,0)
  assert.equal(outType('github','branches').length,1)
})
test('resource_set_rows_with_null_id_keep_their_orn',()=>{
  const records=rows('okta','OK-05','resources')
  const expected=records.filter(r=>r.id||r.orn)
  assert.equal(expected.length,10)
  const actual=outType('okta','ResourceSetResource')
  assert.equal(actual.length,expected.length)
  for(const r of expected)assert(actual.some(o=>o.canonical.identifiers.resource.value===(r.id||r.orn)))
})
test('salesforce_ids_are_normalized_to_18_characters',()=>{
  for(const o of objects.filter(o=>o.canonical.provider==='salesforce'))for(const p of o.canonical.identifiers.primary)assert.equal(String(o.canonical.identifiers[p].value).length,18)
})
test('all_collected_commit_sha_fields_preserve_the_native_digest',()=>{
  const commits=pages('github','GH-11').filter(e=>e.payload?.sha).map(e=>e.payload)
  assert.equal(commits.length,11)
  const actual=outType('github','commit')
  for(const r of commits){const o=actual.find(o=>o.fixture_meta.im_profile.runtime_id===r.sha);assert(o);if(o.canonical.properties.sha!==undefined)assert.equal(o.canonical.properties.sha,r.sha)}
  const sourceDigests=pages('worker','SL-12').flatMap(e=>e.payload.results??[]).map(r=>typeof r.result_data==='string'?JSON.parse(r.result_data):r.result_data).map(r=>r?.commit_sha).filter(Boolean)
  const zeroPrefix=sourceDigests.filter(s=>/^00[0-9a-f]{38}$/.test(s))
  assert(zeroPrefix.length>0)
  for(const sha of zeroPrefix)assert(read('observations').some(o=>o.attributes?.correlated_commit_sha===sha))
})
test('remaining_bot_references_have_no_collected_bot_record',()=>{
  const botIds=new Set(pages('slack','SL-07').map(e=>e.payload?.bot?.id).filter(Boolean))
  let count=0
  for(const o of objects)for(const ref of Object.values(o.canonical.references??{}))for(const t of ref.targets??[]){
    if(t.status==='unresolved'){count++;assert.equal(t.object_type,'200.bot');assert(!botIds.has(t.value))}
  }
  assert.equal(count,20)
})
test('unresolved_role_and_org_unit_targets_are_absent_from_source_lists',()=>{
  const sf=pages('salesforce','SF-03').flatMap(e=>e.payload.records??[]),user=pages('salesforce','SF-02').flatMap(e=>e.payload.records??[]).filter(r=>r.attributes?.type==='User')
  const profiles=new Set(sf.filter(r=>r.attributes?.type==='Profile').map(r=>String(r.Id).slice(0,15)))
  assert.equal(user.filter(r=>r.ProfileId&&!profiles.has(String(r.ProfileId).slice(0,15))).length,2)
  const ou=new Set(rows('gws','GW-20','organizationUnits').map(r=>r.orgUnitPath))
  const missing=rows('gws','GW-03','users').filter(r=>r.orgUnitPath&&!ou.has(r.orgUnitPath))
  assert.equal(missing.length,1)
  assert.equal(report.counts.relations_unresolved,3)
})
test('identity_and_evidence_processing_is_complete_for_the_collected_cohort',()=>{
  assert.equal(read('links').length,9);assert.equal(read('observations').length,306);assert.equal(read('evidence_links').length,47)
})
test('every_output_object_has_measured_source_provenance',()=>{
  const apis=new Set(raw.map(e=>e.endpoint))
  for(const o of objects)assert(o.canonical.source.observations.some(x=>apis.has(x.api)))
})
// Consumer checks are asynchronous, and validate the real loader and engine.
try{
  const{tsImport}=await import(pathToFileURL(path.join(ENGINE_ROOT,'node_modules/tsx/dist/esm/api/index.mjs')).href)
  const{buildGraphStoreV2,buildEvidenceStore}=await tsImport(pathToFileURL(path.join(ENGINE_ROOT,'src/data/datasetStore.ts')).href,import.meta.url)
  const{datasetEffectiveAccess}=await tsImport(pathToFileURL(path.join(ENGINE_ROOT,'scripts/accessRules/production.ts')).href,import.meta.url)
  const graph=buildGraphStoreV2(objects,relations,read('links')),evidence=buildEvidenceStore(read('observations'),read('evidence_links'))
  // EA is recomputed by the one function the normalizer and publish use (lint and computed_at included), then compared with the stored file
  const ea=datasetEffectiveAccess({manifest,objects,relations,links:read('links'),observations:read('observations'),evidence_links:read('evidence_links')})
  assert.equal(graph.objectsByKey.size,objects.length);assert.equal(graph.relationsByKey.size,relations.length)
  assert.deepEqual(read('effective_access').rows,ea.rows)
  checks.push({name:'dashboard_graph_evidence_and_effective_access_accept_the_dataset',ok:true})
}catch(e){checks.push({name:'dashboard_graph_evidence_and_effective_access_accept_the_dataset',ok:false,error:e.message})}
const result={run:id,status:checks.every(c=>c.ok)?'passed':'failed',checks}
fs.writeFileSync(path.join(OUT,'collected-verification.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({status:result.status,checks:checks.length,failed:checks.filter(c=>!c.ok)},null,1))
process.exitCode=result.status==='passed'?0:1
