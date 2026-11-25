// 같은 종류 안에서 갈리는 태그를 제공자가 정한 값(gws 설정 이름, okta 정책 유형 등)마다 Jev 에 묻는다(2026-11-10).
// 사용: node jev_value_tags.mjs values|plan|send|scores|build [--concurrency N]
//   values: AEGI_DATASET_DIR(objects.json 이 있는 데이터셋 폴더)에서 FIELDS 의 값을 모아 values.jsonl 에 쓴다(값과 하위 키 이름만)
//   build : value-tag-scores.jsonl → value-tags.jsonl(게시와 화면이 읽는 표)
// 키는 출력하지 않는다. 캐시는 cache.jsonl(값 설명과 응답만, 비밀값 없음, 저장소에 넣지 않는다).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const B = path.join(HERE, '..')
const KEY_FILE = process.env.JEV_KEY_FILE // TYPESAFE_API_KEY= 줄이 있는 파일. 환경 변수 TYPESAFE_API_KEY 가 있으면 그걸 쓴다
const URL_ = 'https://api.typesafe.ai/v1/systemone'
const CACHE = path.join(HERE, 'cache.jsonl')
const BATCH = 11
const THRESHOLD = 0.6
const rd = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const wr = (f, rows) => fs.writeFileSync(f, rows.map(r => JSON.stringify(r)).join('\n') + '\n')

const PROVIDER = { gws: 'Google Workspace', okta: 'Okta', atlassian: 'Atlassian organization admin' }

// 값으로 태그가 갈리는 (종류, 필드). field 는 canonical.properties 아래 점 경로. keys 는 값마다 하위 키 이름을 모을 필드(Jev 설명용).
const FIELDS = [
  { type_key: 'gws:Policy', field: 'setting_type', keys: 'setting_value', about: 'The Cloud Identity Policy API setting type: it names which Admin console setting this policy object holds.' },
  { type_key: 'okta:Policy', field: 'type', keys: 'conditions', about: 'The Okta policy type: it names what kind of policy this object is.' },
  { type_key: 'okta:PolicyRule', field: 'type', keys: 'actions', about: 'The Okta policy rule type: it names the kind of policy this rule belongs to.' },
  { type_key: 'atlassian:Policy', field: 'attributes.type', keys: 'attributes', about: 'The Atlassian organization policy type: it names what this organization policy controls.' },
]

// 태그 정의는 type-tags/jev_type_tags_v2.mjs 와 같은 뜻이다. 여기서는 「이 값의 객체가 그것을 설정하거나 그것인가」를 묻는다.
const TAGS = {
  account: ['an identity that signs in or acts: a user account, service account or bot user', 'user, service account, bot', 'settings about users'],
  group: ['a named set of user accounts: a group, team, or organizational unit', 'group, team, OU', 'settings that merely apply to an OU'],
  provisioning: ['automatic account lifecycle plumbing between systems', 'SCIM or directory sync, JIT provisioning, profile enrollment / self-service registration, attribute mapping', 'manual admin actions'],
  access_role: ['a definition of what holders may do', 'role, permission set, permission scheme', 'settings that turn a feature on or off'],
  access_grant: ['a record that gives a specific principal access', 'role assignment, membership, file permission', 'settings'],
  admin_access: ['administrator or highest privilege', 'admin roles, super admin account recovery, admin action approvals, admin API access', 'ordinary user features'],
  sharing: ['access opened outside the organization or to anyone', 'external sharing, external file warning, external chat or spaces, external meeting participants, public links, sharing with other organizations', 'internal-only features'],
  authentication: ['how users sign in', 'sign-on policy, MFA or 2-step verification, passkeys, login challenges, SSO, identity provider discovery, authenticator enrollment, app sign-in (access) policy', 'password complexity alone, session length alone, service on/off switches'],
  password_policy: ['password rules or lockout after failed sign-in', 'password length and strength, expiration, reuse, lockout, password recovery', 'MFA alone, session length'],
  session_policy: ['session lifetime, idle timeout or re-authentication interval', 'session duration, idle session timeout, periodic re-authentication', 'sign-in methods alone'],
  network_policy: ['network location restrictions', 'IP allowlist, network zones, trusted networks in access rules, context-aware access', 'outbound data channels'],
  device: ['end-user devices or device management', 'mobile device management, iOS or Android settings, device trust in access rules, mobile app security', 'servers, API clients'],
  credential: ['a secret-bearing object that authenticates', 'API token, client secret, signing key', 'settings'],
  encryption: ['encryption settings or encryption keys', 'S/MIME, TLS enforcement, confidential mode, client-side encryption, key management', 'tokens used only for authentication'],
  integration: ['third-party or external applications connected to the tenant, or control over their access', 'third-party app access, OAuth app approval, API access controls, marketplace allowlist, chat apps, AI apps that act on tenant data', 'built-in first-party services'],
  automation: ['logic that runs inside the tenant without a person', 'workflow, script, bot, AI agent definition', 'settings'],
  data_flow: ['a channel that moves data into or out of the tenant', 'data export (Takeout), mail forwarding or upload, third-party archiving, migration, sync to desktop or other services', 'internal records'],
  data_resource: ['business content stored in the SaaS', 'file, mailbox, message, page, record', 'configuration or settings'],
  data_classification: ['data sensitivity classification', 'sensitivity labels, classification-based rules, regulated-data settings such as HIPAA', 'ordinary feature settings'],
  dlp: ['data loss prevention', 'DLP rules, download/copy/print restriction, content detectors that block or warn on sensitive data', 'ordinary permissions'],
  data_region: ['data residency', 'data region for data at rest or processing, data residency policy', 'a time zone or locale'],
  retention_backup: ['data lifecycle', 'retention, deletion, legal hold, archive, history on/off, backup, recording or transcript storage', 'a deleted-item record'],
  monitoring: ['logging and detection configuration', 'audit log settings, alert rules, admin notifications, content reporting, security alerts', 'business records'],
  code_repo: ['source code storage', 'repository', 'issues'],
  code_access: ['access to source repositories', 'repository collaborator', 'org members in general'],
  code_security: ['code security scanning', 'code scanning, secret scanning', 'general CI workflows'],
  change_control: ['controls on changes', 'multi-party approval of admin changes, required reviews, branch protection', 'the changed object itself'],
  tenant: ['the tenant itself', 'organization, workspace, customer', 'settings inside the tenant'],
  tenant_policy: ['a tenant-wide security or administration setting', 'security, sharing, access, data, device or admin configuration', 'only turning a consumer or marketing product on or off, cosmetic or productivity feature settings'],
  malware: ['malware or phishing defense settings', 'attachment safety, link and external image protection, spoofing and authentication protection, pre-delivery scanning', 'threat detection on sign-in'],
  ownership: ['a record that assigns an owner or responsible person to an asset', 'owner assignment', 'objects that merely have an owner field'],
}
const CRITERIA = {
  true: 'Objects whose field has this value configure, or are, this kind of thing, like the yes examples.',
  false: 'Objects whose field has this value do not configure this kind of thing: like the negative examples, only loosely related, or unrelated.',
}
const canon = v => v === null || typeof v !== 'object' ? JSON.stringify(v) ?? 'null' : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
const ckey = b => crypto.createHash('sha256').update(canon(b)).digest('hex')
const getPath = (o, p) => p.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o)
const lc = s => s.toLowerCase()
// 하위 키 이름을 점 경로로 depth 단계까지 모은다(값은 넣지 않는다). 배열은 원소의 키를 [] 로 묶는다.
const keyPaths = (v, pre, depth) => {
  if (Array.isArray(v)) return v.flatMap(x => keyPaths(x, pre + '[]', depth))
  if (!v || typeof v !== 'object' || depth === 0) return pre ? [pre] : []
  const ks = Object.keys(v).filter(k => k !== '_links')
  if (!ks.length) return pre ? [pre] : []
  return ks.flatMap(k => keyPaths(v[k], pre ? `${pre}.${k}` : k, depth - 1))
}

function collectValues() {
  const dir = process.env.AEGI_DATASET_DIR
  if (!dir) throw new Error('AEGI_DATASET_DIR 환경 변수가 필요하다(objects.json 이 있는 폴더)')
  const objs = JSON.parse(fs.readFileSync(path.join(dir, 'objects.json'), 'utf8'))
  const old = fs.existsSync(path.join(HERE, 'values.jsonl')) ? rd(path.join(HERE, 'values.jsonl')) : []
  const byKey = new Map(old.map(v => [`${v.type_key}\t${v.field}\t${v.value}`, v]))
  for (const o of objs) {
    const tk = `${o.canonical.provider}:${o.canonical.object_type}`
    const f = FIELDS.find(x => lc(x.type_key) === lc(tk))
    if (!f) continue
    const value = getPath(o.canonical.properties, f.field)
    if (typeof value !== 'string' || !value) continue
    const k = `${f.type_key}\t${f.field}\t${value}`
    const e = byKey.get(k) || { type_key: f.type_key, field: f.field, value, keys: [] }
    e.keys = [...new Set([...e.keys, ...keyPaths(getPath(o.canonical.properties, f.keys), '', 3)])].sort()
    byKey.set(k, e)
  }
  const rows = [...byKey.values()].sort((a, b) => (a.type_key + a.value).localeCompare(b.type_key + b.value))
  wr(path.join(HERE, 'values.jsonl'), rows)
  const per = {}
  for (const r of rows) per[r.type_key] = (per[r.type_key] || 0) + 1
  console.log({ values: rows.length, per })
}

function stateOf(v) {
  const f = FIELDS.find(x => x.type_key === v.type_key)
  const [prov, type] = v.type_key.split(':')
  let s = `A SaaS object. Provider: ${PROVIDER[prov] || prov}. Object type: ${type}. Field ${v.field} = "${v.value}". ${f.about}`
  if (v.keys.length) s += ` Key paths inside ${f.keys}: ${v.keys.join(', ').slice(0, 900)}.`
  return s
}

function plan() {
  const names = Object.keys(TAGS)
  const reqs = []
  for (const v of rd(path.join(HERE, 'values.jsonl'))) {
    const state = stateOf(v)
    for (let i = 0; i < names.length; i += BATCH) {
      const chunk = names.slice(i, i + BATCH)
      const questions = {}
      for (const n of chunk) {
        const [def, yes, no] = TAGS[n]
        questions[n] = { type: 'noul', instructions: `Tag "${n}": ${def}. Yes examples: ${yes}. Not: ${no}. Does an object whose field has the value in the state configure (or is it) this kind of thing?`, criteria: CRITERIA }
      }
      const body = { state, model: 'jev-latest', questions }
      reqs.push({ v, tags: chunk, body, key: ckey(body) })
    }
  }
  return reqs
}

function loadCache() {
  const m = new Map()
  if (!fs.existsSync(CACHE)) return m
  for (const l of fs.readFileSync(CACHE, 'utf8').split('\n')) { if (!l.trim()) continue; try { const e = JSON.parse(l); m.set(e.key, e) } catch {} }
  return m
}

function readKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY.trim()
  if (KEY_FILE) for (const l of fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)) if (l.trim().startsWith('TYPESAFE_API_KEY=')) return l.trim().slice(17).trim()
  throw new Error('TYPESAFE_API_KEY 없음')
}

async function sendOne(req, key) {
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) })
      if (r.ok) return { ok: true, data: await r.json() }
      if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 1500 * 2 ** a)); continue }
      return { ok: false, reason: `HTTP ${r.status}` }
    } catch { await new Promise(s => setTimeout(s, 1500 * 2 ** a)) }
  }
  return { ok: false, reason: 'retries' }
}

async function send(reqs, cache, conc) {
  const todo = reqs.filter(r => !cache.has(r.key))
  console.log(`보낼 요청 ${todo.length}, 동시 ${conc}`)
  if (!todo.length) return
  const key = readKey()
  let cur = 0, ok = 0, fail = 0
  const fails = {}
  const t0 = Date.now()
  const fd = fs.openSync(CACHE, 'a')
  async function worker() {
    while (cur < todo.length) {
      const req = todo[cur++]
      const res = await sendOne(req, key)
      if (res.ok) { fs.writeSync(fd, JSON.stringify({ key: req.key, type_key: req.v.type_key, value: req.v.value, tags: req.tags, response: res.data }) + '\n'); ok++ }
      else { fail++; fails[res.reason] = (fails[res.reason] || 0) + 1 }
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, todo.length) }, worker))
  fs.closeSync(fd)
  console.log(`끝: 성공 ${ok} 실패 ${fail} ${JSON.stringify(fails)} ${((Date.now() - t0) / 1000).toFixed(0)}s`)
}

function scores(reqs, cache) {
  const rows = new Map()
  let miss = 0
  for (const r of reqs) {
    const k = `${r.v.type_key}\t${r.v.field}\t${r.v.value}`
    if (!rows.has(k)) rows.set(k, { type_key: r.v.type_key, field: r.v.field, value: r.v.value, p: {} })
    const e = cache.get(r.key)
    if (!e) { miss++; continue }
    for (const tag of r.tags) {
      const a = e.response?.answers?.[tag]
      rows.get(k).p[tag] = typeof a?.noul === 'number' ? a.noul : typeof a?.probability === 'number' ? a.probability : null
    }
  }
  wr(path.join(HERE, 'value-tag-scores.jsonl'), [...rows.values()])
  console.log(`값 ${rows.size}, 응답 없는 요청 ${miss}`)
}

// 값 태그 = Jev p ≥ THRESHOLD 인 태그 중 그 종류의 태그(type-tags.jsonl)에 있는 것. 종류 태그에 없는 태그는 extra 로 남긴다(종류 태그 보완 후보).
function build() {
  const typeTags = new Map(rd(path.join(B, 'type-tags/type-tags.jsonl')).map(t => [t.type_key, new Set(Object.keys(t.tags))]))
  const out = []
  for (const s of rd(path.join(HERE, 'value-tag-scores.jsonl'))) {
    const own = typeTags.get(s.type_key)
    if (!own) throw new Error(`type-tags.jsonl 에 없는 종류: ${s.type_key}`)
    const hit = Object.entries(s.p).filter(([, p]) => typeof p === 'number' && p >= THRESHOLD).sort((a, b) => b[1] - a[1])
    out.push({ type_key: s.type_key, field: s.field, value: s.value, tags: hit.filter(([t]) => own.has(t)).map(([t]) => t), extra: hit.filter(([t]) => !own.has(t)).map(([t]) => t), p: Object.fromEntries(hit) })
  }
  wr(path.join(HERE, 'value-tags.jsonl'), out)
  const none = out.filter(r => !r.tags.length).length
  console.log({ values: out.length, without_tags: none, with_extra: out.filter(r => r.extra.length).length })
}

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? Number(argv[i + 1]) : undefined }
if (cmd === 'values') collectValues()
else if (cmd === 'build') build()
else {
  const reqs = plan()
  const cache = loadCache()
  if (cmd === 'plan') console.log({ requests: reqs.length, cached: reqs.filter(r => cache.has(r.key)).length, sample: reqs[0]?.body.state })
  else if (cmd === 'send') await send(reqs, cache, opt('--concurrency') ?? 16)
  else if (cmd === 'scores') scores(reqs, cache)
  else console.log('values|plan|send|scores|build')
}
