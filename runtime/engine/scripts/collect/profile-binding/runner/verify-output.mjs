// 실행기 출력 검사: 형식, 관계 끝점, 비밀값 남김, 키 중복, 거부·미해결 집계
//   node runner/verify-output.mjs [--run <id>]
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

// 관계 어휘와 끝 쌍: 엔진 사전 사본 ontology/relation_types.yaml(src/ontology/generated.ts RELATION_TYPES 를 만드는 원본)의 이름과 branches.
// 17종을 여기 다시 적지 않는다. 사본을 새로 받으면 이 검사도 따라간다
const ENGINE_ONTOLOGY = path.resolve(import.meta.dirname, '../../../../ontology')
export function loadRelationDeclarations(file = path.join(ENGINE_ONTOLOGY, 'relation_types.yaml')) {
  const doc = YAML.parse(fs.readFileSync(file, 'utf8'))
  return new Map(doc.relation_types.map(t => [t.name, t.branches.map(b => ({ from: b.from, to: b.to }))]))
}
let defaultDeclarations
const relationDeclarations = () => (defaultDeclarations ??= loadRelationDeclarations())

// 한 관계 행의 끝 interface 쌍이 선언 branches 중 하나 안인가. 끝 객체가 interface 를 여럿 가지면 하나라도 맞으면 된다. any 는 아무것이나
export function pairDeclared(branches, sourceIfaces = [], targetIfaces = []) {
  return branches.some(b => (b.from.includes('any') || sourceIfaces.some(i => b.from.includes(i)))
    && (b.to.includes('any') || targetIfaces.some(i => b.to.includes(i))))
}

// 선언 밖 쌍(엔진이 간선을 내지 않는 칸) 중 이미 알고 고칠 곳이 정해진 것. 기준선은 경고로만 남고 정규화를 멈추지 않는다.
// 열쇠는 「provider 관계 출발>도착」(객체 키가 아니라 종류만). 고친 브랜치가 머지되면 그 줄을 지운다
export const RELATION_PAIR_BASELINE = new Map([
  // overlays/aws/new-access-key.yaml: 키 owned_by IAM 사용자, 키 authenticates_with 계정. 로컬 fix/aws-access-key-relations 가 선언 칸으로 고침
  ['aws owned_by Credential>Principal', 'overlays/aws/new-access-key.yaml'],
  ['aws authenticates_with Credential>Tenant', 'overlays/aws/new-access-key.yaml'],
  // overlays/gws/new-member.yaml: Member(Assignment)를 거치지 않고 사용자·그룹 → 그룹 has_role_on
  ['gws has_role_on Principal>Principal', 'overlays/gws/new-member.yaml'],
  // overlays/gws/gws-project-7fc925.yaml: Apps Script 프로젝트(Automation) owned_by 작성자. 선언은 Resource>Principal 만
  ['gws owned_by Automation>Principal', 'overlays/gws/gws-project-7fc925.yaml'],
  // 봇 토큰 credential-row:oauth:xoxb 가 모델 v3.2 에서 Policy 라 owned_by 앱이 Policy>Integration. 로컬 relation/slack-bot-token-credential 이 Credential 로 박음
  ['slack owned_by Policy>Integration', 'profiles/slack/slack-credential-row_oauth_xoxb-66d1ab.yaml'],
])

export function matchRelationTemplate(template, sourceIfaces = [], targetIfaces = []) {
  if (!template || template.trim() === 'any --> any') return true
  const branches = template.split(';').map(b => b.trim())
  for (const b of branches) {
    const m = /^(.*?)\s*--(?:(?:\[.*?\]--)?)>\s*(.*)$/.exec(b)
    if (!m) continue
    const srcAllowed = m[1].split('|').map(s => s.trim())
    const dstAllowed = m[2].split('|').map(s => s.trim())
    const srcOk = srcAllowed.includes('any') || sourceIfaces.some(i => srcAllowed.includes(i))
    const dstOk = dstAllowed.includes('any') || targetIfaces.some(i => dstAllowed.includes(i))
    if (srcOk && dstOk) return true
  }
  return false
}

export function verifyDataset({ objects, relations, report, links, observations, evidence_links: evidenceLinks, manifest, modelDir, strict = false, declarations = relationDeclarations(), pairBaseline = RELATION_PAIR_BASELINE }) {
const checks = []
const check = (name, ok, detail) => checks.push({ name, ok, ...(detail !== undefined ? { detail } : {}) })
// 경고: 결과에 남지만 status 를 실패로 만들지 않는다. 데이터 일부만 빠진 것이라 나머지로 계속 계산하는 검사다
const warnings = []
const warn = (name, ok, detail) => { if (!ok) warnings.push({ name, ...(detail !== undefined ? { detail } : {}) }) }

// 형식: 대시보드 RawDataset 파일과 필수 자리

const badObj = objects.filter(o => !o.fixture_key || !o.canonical?.provider || !o.canonical?.object_type || !Array.isArray(o.canonical?.interfaces) || !o.canonical?.identifiers?.primary?.length || !o.canonical?.source?.observations?.length)
check('object_shape', badObj.length === 0, badObj.slice(0, 5).map(o => o.fixture_key))
const primaryOk = objects.filter(o => o.canonical.identifiers.primary.some(n => o.canonical.identifiers[n]?.value == null))
check('primary_components_present', primaryOk.length === 0, primaryOk.slice(0, 5).map(o => o.fixture_key))
check('unique_object_keys', new Set(objects.map(o => o.fixture_key)).size === objects.length)
// 타입 이름이 API 경로 조각이다(parent:user/{} 같은 생성기 경로 공간). 객체 타입이 아니라 경로 변수 자리다
const typeName = o => `${o.canonical.provider}:${o.canonical.object_type}`
const pathTypes = [...new Set(objects.filter(o => o.canonical.object_type.includes('parent:') && o.canonical.object_type.includes('{}')).map(typeName))]
check('no_api_path_object_types', pathTypes.length === 0, pathTypes.slice(0, 10))
// 속성이 하나도 없는 타입: 그 타입 객체가 모두 properties 가 비었다. 참조로만 만든 스텁(fixture_meta.stub)은 원래 속성이 없으므로 세지 않는다.
// 스텁만 있는 타입도 통과한다. 수집 레코드로 만든 객체가 하나라도 속성을 가지면 통과한다
const propsByType = new Map()
for (const o of objects) {
  if (o.fixture_meta?.stub) continue
  const t = typeName(o), r = propsByType.get(t) ?? { objects: 0, empty: 0 }
  r.objects++
  if (!o.canonical.properties || Object.keys(o.canonical.properties).length === 0) r.empty++
  propsByType.set(t, r)
}
const emptyTypes = [...propsByType].filter(([, r]) => r.empty === r.objects).map(([t, r]) => `${t} (${r.objects})`)
check('no_property_less_types', emptyTypes.length === 0, emptyTypes.slice(0, 10))

// 버린 필드: 객체마다 fixture_meta.im_profile.quarantined_fields(그 객체를 만든 Profile 전부를 합친 것)를 본다.
// 공통 기록 필드(생성·수정 기록, 링크, 응답 껍데기)는 어느 타입에나 있어 빼고 센다
const COMMON_FIELDS = {
  salesforce: /^(attributes|IsDeleted|CreatedDate|CreatedById|LastModifiedDate|LastModifiedById|SystemModstamp|LastViewedDate|LastReferencedDate)$/,
  okta: /^(_links|_embedded)$/,
  github: /(^|_)url$|^node_id$|^gravatar_id$/,
  atlassian: /^(self|expand|_links|_expandable)$/,
  gws: /^(kind|etag)$/,
  slack: /^(ok|response_metadata)$/,
}
const droppedByType = new Map()
for (const o of objects) {
  if (o.fixture_meta?.stub) continue
  const t = typeName(o), r = droppedByType.get(t) ?? { objects: 0, idOnly: 0, fields: new Set() }
  r.objects++
  const ks = Object.keys(o.canonical.properties ?? {})
  if (ks.length > 0 && ks.every(k => /^(id|Id|key)$/.test(k))) r.idOnly++
  const common = COMMON_FIELDS[o.canonical.provider] ?? /^$/
  for (const f of o.fixture_meta?.im_profile?.quarantined_fields ?? []) if (!common.test(f)) r.fields.add(f)
  droppedByType.set(t, r)
}
// 식별자(id, Id, key)만 남았는데 응답의 다른 필드를 버린 타입. 속성이 하나라도 있으면 no_property_less_types 는 통과하므로 따로 본다.
// Profile 선언이 응답과 다른 스키마를 가리키면 식별자만 맞고 나머지가 모두 버려진다(2026-11-01 Salesforce ExtlClntApp* 3종).
// 응답에 원래 식별자뿐인 타입은 버린 필드가 없으니 통과한다
const idOnlyTypes = [...droppedByType].filter(([, r]) => r.idOnly === r.objects && r.fields.size).map(([t, r]) => `${t} (${r.objects})`)
check('no_identifier_only_types', idOnlyTypes.length === 0, idOnlyTypes.slice(0, 10))
// 같은 머리말(CamelCase 첫 낱말)로 시작하는 버린 필드가 한 타입에 20개 넘게 몰린 경우. 문서가 동적 필드 묶음(Permissions*,
// MaximumPermissions* 등)을 한 줄로 설명해 선언이 빠지면 다른 속성이 남아 있어도 권한 묶음이 통째로 사라진다
const BUNDLE_MIN = 20
const bundles = []
for (const [t, r] of droppedByType) {
  const heads = new Map()
  for (const f of r.fields) { const h = /^[A-Z][a-z]+/.exec(f)?.[0]; if (h) heads.set(h, (heads.get(h) ?? 0) + 1) }
  for (const [h, n] of heads) if (n > BUNDLE_MIN) bundles.push(`${t} ${h}* (${n})`)
}
check('no_dropped_field_bundles', bundles.length === 0, bundles.slice(0, 10))

// 관계: 끝점이 모두 객체로 있고, 어휘 안의 타입이고, basis 가 있다
const keys = new Set(objects.map(o => o.fixture_key))
const VOCAB = new Set(declarations.keys())
const dangling = relations.filter(r => !keys.has(r.canonical.references.source.value) || !keys.has(r.canonical.references.target.value))
check('relation_endpoints_exist', dangling.length === 0, dangling.slice(0, 5).map(r => r.fixture_key))
check('relation_vocabulary_closed', relations.every(r => VOCAB.has(r.canonical.relation_type)), [...new Set(relations.map(r => r.canonical.relation_type).filter(t => !VOCAB.has(t)))])
// 끝 쌍: 관계 행의 출발·도착 interface 가 그 관계 선언 branches 안이다. 밖이면 엔진 효과 표에 그 칸이 없어 간선이 0 이 된다
// (2026-11-17 감사: aws 접근 키, gws Member·Apps Script, Slack 봇 토큰). 기준선에 있는 쌍은 경고, 새 쌍은 strict 면 실패, 아니면 경고.
// detail 은 「provider 관계 출발>도착 (행 수)」만 낸다(객체 키는 실측 이름이 들 수 있다)
const objectOf = new Map(objects.map(o => [o.fixture_key, o]))
const outside = new Map()
for (const r of relations) {
  const c = r.canonical, branches = declarations.get(c.relation_type)
  const s = objectOf.get(c.references.source.value), t = objectOf.get(c.references.target.value)
  if (!branches || !s || !t) continue // 어휘 밖, 끝점 없음은 위 검사가 본다
  const si = s.canonical.interfaces ?? [], ti = t.canonical.interfaces ?? []
  if (pairDeclared(branches, si, ti)) continue
  const k = `${c.provider} ${c.relation_type} ${si.join('|') || '-'}>${ti.join('|') || '-'}`
  outside.set(k, (outside.get(k) ?? 0) + 1)
}
const known = [...outside].filter(([k]) => pairBaseline.has(k)).map(([k, n]) => `${k} (${n}) → ${pairBaseline.get(k)}`).sort()
const fresh = [...outside].filter(([k]) => !pairBaseline.has(k)).map(([k, n]) => `${k} (${n})`).sort()
warn('relation_pairs_declared_baseline', known.length === 0, known)
;(strict ? check : warn)('relation_pairs_declared', fresh.length === 0, fresh)
check('relation_basis_present', relations.every(r => ['stated', 'computed', 'flag'].includes(r.canonical.properties?.basis)))
// 집행 표시(knowledge Profile_Schema_v4.2 「membership_enforced」)는 참, 거짓만이다. 부여 관계에 적는 값이라 소속(member_of)에 있으면 오류.
// 다른 관계 종류는 막지 않는다(명세가 오류로 정한 것은 member_of 뿐)
const badEnforced = relations.filter(r => r.canonical.properties && 'membership_enforced' in r.canonical.properties && (typeof r.canonical.properties.membership_enforced !== 'boolean' || r.canonical.relation_type === 'member_of'))
check('membership_enforced_on_grants', badEnforced.length === 0, badEnforced.slice(0, 5).map(r => r.fixture_key))
// 같은 관계를 두 선언이 다른 집행 표시로 만들었다(정규화 addRelation 이 적는다). detail 은 Profile 과 두 값만(관계 키는 내지 않는다)
const enforcedConflicts = report.membership_enforced_conflicts ?? []
check('membership_enforced_consistent', enforcedConflicts.length === 0, enforcedConflicts.slice(0, 5).map(c => `${(c.profiles ?? []).join(' + ')}: ${(c.values ?? []).join(' / ')}`))
// 식별 실패: 정규화가 그 레코드만 빼고(객체를 만들지 않는다) 나머지는 그대로 만든다. 레코드 몇 개가 이상한 것은 경고로 남기고,
// Profile 하나에서 식별 실패가 많으면(IDENTITY_REJECT_MIN 개 이상이고 그 Profile 레코드의 IDENTITY_REJECT_RATIO 넘게) 식별 식이나 API 모양이 바뀐 것이다.
// 그 Profile 의 객체가 빠진 채(degraded) 나머지로 계속하고 경고로 남긴다. strict(정규화 --strict, 개발과 시험)면 멈춘다.
// Profile 별 수(per_profile)가 없는 옛 보고서는 하나라도 있으면 그렇게 본다
const IDENTITY_REJECT_MIN = 5, IDENTITY_REJECT_RATIO = 0.2
const rejectedProfiles = (report.per_profile ?? []).filter(p => p.rejected > 0)
const systemic = report.per_profile
  ? rejectedProfiles.filter(p => p.rejected >= IDENTITY_REJECT_MIN && p.rejected > IDENTITY_REJECT_RATIO * (p.records ?? 0))
  : (report.counts.rejected_identity > 0 ? [{ profile: '(per_profile 없음)', rejected: report.counts.rejected_identity, records: '?' }] : [])
;(strict ? check : warn)('identity_rejections_not_systemic', systemic.length === 0, systemic.slice(0, 5).map(p => `${p.profile}: ${p.rejected}/${p.records}`))
warn('no_identity_rejections', report.counts.rejected_identity === 0, rejectedProfiles.slice(0, 10).map(p => `${p.profile}: ${p.rejected}/${p.records}`))

check('no_unsupported_profile_rules', report.relation_rules.unsupported.length===0)
const objectByKey=new Map(objects.map(o=>[o.fixture_key,o]))

const typedRefs=[]
for(const o of objects)for(const r of Object.values(o.canonical.references??{}))for(const t of r.targets??[])if(t.identifier_type==='primary'){
  const target=objectByKey.get(t.value)
  if(!target||target.canonical.provider!==t.provider||target.canonical.object_type!==t.object_type)typedRefs.push(o.fixture_key)
}
check('resolved_reference_types_and_targets',typedRefs.length===0,typedRefs.slice(0,5))
check('link_endpoints_exist',links.every(l=>(l.set??[]).every(m=>keys.has(m.object_key))))
check('observation_object_keys_exist',observations.every(o=>(o.objectKeys??[]).every(k=>keys.has(k))))
const observationKeys=new Set(observations.map(o=>o.id))
const evidenceEnd=e=>e.kind==='object'?keys.has(e.id):observationKeys.has(e.id)
check('evidence_endpoints_exist',evidenceLinks.every(e=>evidenceEnd(e.from)&&evidenceEnd(e.to)))
check('unique_observation_ids',observationKeys.size===observations.length)
check('unique_evidence_ids',new Set(evidenceLinks.map(e=>e.id)).size===evidenceLinks.length)
const modelFreeze=JSON.parse(fs.readFileSync(path.join(modelDir,'FREEZE.json'),'utf8'))
check('model_version_matches_input',manifest.object_model.version===modelFreeze.version)

// 비밀값: 토큰 모양 문자열과 비밀 잎 이름이 properties 에 남지 않았다
// Okta API 토큰(00 + base64url 40자)이 16진수 글자만으로 될 확률은 약 3e-19 다. 「00」으로 시작하는 git SHA 같은 16진수 값은 칸 이름과 상관없이 토큰으로 보지 않는다
const TOKEN = [/^xox[abposr]-/, /hooks\.slack\.com\/services\//, /^gh[pousr]_[A-Za-z0-9]{20,}/, /^00(?![0-9A-Fa-f]+$)[A-Za-z0-9_-]{38,}$/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/]
const SECRET_LEAF = new Set(['access_token', 'refresh_token', 'client_secret', 'signing_secret', 'verification_token', 'bot_access_token', 'app_token', 'api_token', 'sharedSecret', 'privateKeyData', 'password', 'passwordHash', 'passwordSalt'])
const leaks = []
const scan = (v, where) => {
  if (typeof v === 'string') {
    const digest = /(?:^|[._])(?:sha|sha1|sha256|fingerprint)(?:$|_)/i.test(where) && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(v)
    // 2026-11-08: JWKS·JsonWebKey 객체의 공개키 성분(n·e·x·y)은 비밀이 아니다. RSA 모듈러스가 「00」으로 시작하면 Okta 토큰 모양에 걸렸다(3회차 Okta 수집 앱 키, OK-07·08)
    const jwkPublic = /(?:\.jwks\.keys\[\d+\]|WebKey:[^.]+)\.(?:n|e|x|y)$/.test(where)
    if (!digest && !jwkPublic && TOKEN.some(r => r.test(v))) leaks.push(where)
  }
  else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${where}[${i}]`))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (SECRET_LEAF.has(k) && x != null && x !== '') leaks.push(`${where}.${k}`); scan(x, `${where}.${k}`) }
}
for (const o of objects) scan(o.canonical.properties, o.fixture_key)
scan(relations,'relations');scan(links,'links');scan(observations,'observations');scan(evidenceLinks,'evidence_links')
check('no_secret_values', leaks.length === 0, leaks.slice(0, 10))

const summary = {
  run: manifest.source_runs[0], status: checks.every(c => c.ok) ? 'passed' : 'failed', warnings,
  counts: { objects: objects.length, relations: relations.length, types: new Set(objects.map(o => `${o.canonical.provider}:${o.canonical.object_type}`)).size, partial_only_objects: objects.filter(o => o.fixture_meta?.im_profile?.partial).length },
  report_counts: report.counts, relation_rules: report.relation_rules,
  checks,
}
return summary
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
 try {
  const args = process.argv.slice(2), i = args.indexOf('--dataset')
  if (i < 0 || !args[i+1]) throw new Error('Usage: node verify-output.mjs --dataset <directory>')
  const dir = path.resolve(args[i+1])
  const read = n => JSON.parse(fs.readFileSync(path.join(dir, n+'.json'), 'utf8'))
  const manifest = read('manifest')
  const engine = path.resolve(import.meta.dirname, '../../../..')
  const result = verifyDataset({ manifest, objects: read('objects'), relations: read('relations'), report: read('runner-report'), links: read('links'), observations: read('observations'), evidence_links: read('evidence_links'), modelDir: path.resolve(engine, manifest.object_model.input) })
  console.log(JSON.stringify(result, null, 2))
  process.exitCode = result.status === 'passed' ? 0 : 1
 } catch (error) { console.error(error.message); process.exitCode = 1 }
}
