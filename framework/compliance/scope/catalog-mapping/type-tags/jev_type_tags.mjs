// 카탈로그 객체 종류마다 태그 31개를 Jev 에 묻는다(2026-11-09).
// 사용: node jev_type_tags.mjs plan|send|scores [--limit N] [--concurrency N]
// 키는 출력하지 않는다. 캐시는 cache.jsonl(종류 설명과 응답만, 비밀값 없음).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const ENGINE = process.env.AEGI_ENGINE_DIR // engine checkout(yaml 패키지와 profile 을 읽는다)
if (!ENGINE) throw new Error('AEGI_ENGINE_DIR 환경 변수가 필요하다')
const require = createRequire(ENGINE + '/package.json')
const YAML = require('yaml')

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const PROFILES = ENGINE + '/scripts/collect/profile-binding/profiles'
const KEY_FILE = process.env.JEV_KEY_FILE // TYPESAFE_API_KEY= 줄이 있는 파일. 환경 변수 TYPESAFE_API_KEY 가 있으면 그걸 쓴다
const URL_ = 'https://api.typesafe.ai/v1/systemone'
const MODEL = 'jev-latest'
const CACHE = path.join(HERE, 'cache.jsonl')
const BATCH = 11

const PROVIDER = { gws: 'Google Workspace', okta: 'Okta', github: 'GitHub', salesforce: 'Salesforce', slack: 'Slack', jira: 'Jira (Atlassian)', confluence: 'Confluence (Atlassian)', atlassian: 'Atlassian organization admin' }

// 태그 정의(영어). 뜻은 items-clean/tags.json 과 같다.
const TAGS = {
  account: 'a user account, service account or bot account object itself (not a group, not a permission assignment)',
  group: 'a container of users: a group, team, or organizational unit (OU)',
  provisioning: 'automatic account lifecycle plumbing: SCIM or directory sync connections, JIT provisioning, profile/attribute mappings, rules that auto-assign users to groups',
  access_role: 'a definition of what can be done: a role, permission set, profile, permission scheme or permission bundle (the definition, not who holds it)',
  access_grant: 'a record of who has been given access: a role assignment, group membership, app assignment, or a permission/ACL entry on a file, space, project or record',
  admin_access: 'administrator or highest privilege: an admin role definition, an assignment of an admin role, or an admin API token',
  sharing: 'access opened outside the organization or to anyone: external or public sharing permissions, share links, guest access, or a sharing policy setting',
  authentication: 'how users sign in: sign-on or MFA policies and rules, authenticators, a user\'s enrolled factors, SSO or identity provider (SAML/OIDC) configuration',
  password_policy: 'password rules: length, complexity, expiry, reuse, and lockout after failed sign-in attempts',
  session_policy: 'session settings: session lifetime, idle timeout, concurrent session limits',
  network_policy: 'network location restrictions: IP allowlists, network zones, trusted origins, CORS or CSP allowlists',
  device: 'end-user devices: an enrolled or managed device, or a device management (MDM) setting',
  credential: 'a secret-bearing object: an API token, personal access token, client secret, deploy key, stored or named credential, certificate used to authenticate',
  encryption: 'encryption: an encryption setting, an encryption or signing key, key management (BYOK/EKM) configuration',
  integration: 'an external or third-party application connected to the tenant: installed app, connected app, OAuth client, an OAuth token or consent a user granted to an app, or app access control settings',
  automation: 'something that runs inside the tenant without a person: a workflow, automation rule, flow, script, scheduled job, bot definition, CI workflow',
  data_flow: 'a channel that moves data in or out of the tenant: webhook, external host or remote site, mail forwarding, event hook, inbound email address or web form, outbound message or sync mapping',
  data_resource: 'business content itself: a file, mailbox, channel or message, page or space, project, issue, repository, CRM record or report',
  data_classification: 'data sensitivity classification: sensitivity labels, field classification, security levels on data',
  dlp: 'data loss prevention: DLP rules, data masking or field hiding, download or copy restrictions',
  data_region: 'data residency: where data is stored (data region setting)',
  retention_backup: 'data lifecycle: retention period, deletion or purge settings, archive or legal hold (vault), backup or export settings',
  monitoring: 'logging and detection configuration: audit log settings or retention, alert rules and alerts, anomaly or threat detection, log streaming',
  code_repo: 'source code storage: a repository, branch or commit',
  code_access: 'access to source repositories: repository collaborator or team permissions, deploy keys',
  code_security: 'code security scanning: code scanning, secret scanning, dependency alerts, code security configuration',
  change_control: 'change control: branch protection, rulesets, required reviews or multi-party approval, immutable releases',
  tenant: 'the tenant itself: the organization, workspace, enterprise or account root object, or a domain owned by the tenant',
  tenant_policy: 'a tenant-wide configuration or settings object (any organization-level security or admin setting)',
  malware: 'malware and phishing defense settings: attachment scanning, link protection, spoofing protection',
  ownership: 'an owner or responsible-person record for an asset (an ownership object, not just any object that has an owner field)',
}
const CRITERIA = {
  true: 'Objects of this type are themselves the thing described by the tag.',
  false: 'Objects of this type are not that thing; they are only in a related product area, merely reference it, or are vendor metadata, catalog/reference data or UI configuration.',
}

function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
}
const ckey = b => crypto.createHash('sha256').update(canon(b)).digest('hex')

function loadTypes() {
  const out = []
  for (const prov of fs.readdirSync(PROFILES)) {
    for (const f of fs.readdirSync(path.join(PROFILES, prov))) {
      if (!f.endsWith('.yaml')) continue
      const p = YAML.parse(fs.readFileSync(path.join(PROFILES, prov, f), 'utf8'))
      const fields = Object.keys(p.fields || {})
      let state = `SaaS object type. Provider: ${PROVIDER[p.provider] || p.provider}${p.service ? ` (service ${p.service})` : ''}. Type name: ${p.object_type}. Model interfaces: ${(p.interfaces || []).join(', ') || 'none'}.`
      if (p.identity?.parent?.type) state += ` Child of: ${p.identity.parent.type}.`
      state += ` Fields: `
      const room = 1500 - state.length
      let fl = ''
      for (const n of fields) { if (fl.length + n.length + 2 > room) { fl += ', ...'; break } fl += (fl ? ', ' : '') + n }
      out.push({ type_key: `${p.provider}:${p.object_type}`, provider: p.provider, object_type: p.object_type, interfaces: p.interfaces || [], profile: `${prov}/${f}`, research_type: p.model?.research_type, state: state + (fl || 'none') + '.' })
    }
  }
  return out
}

function plan(types) {
  const names = Object.keys(TAGS)
  const reqs = []
  for (const t of types) for (let i = 0; i < names.length; i += BATCH) {
    const chunk = names.slice(i, i + BATCH)
    const questions = {}
    for (const n of chunk) questions[n] = { type: 'noul', instructions: `Tag "${n}" means: ${TAGS[n]}. Is the SaaS object type described in the state this kind of thing?`, criteria: CRITERIA }
    const body = { state: t.state, model: MODEL, questions }
    reqs.push({ type_key: t.type_key, tags: chunk, body, key: ckey(body) })
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
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY.trim(); for (const l of fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)) if (l.trim().startsWith('TYPESAFE_API_KEY=')) return l.trim().slice(17).trim()
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

async function send(reqs, cache, limit, conc) {
  let todo = reqs.filter(r => !cache.has(r.key))
  if (limit >= 0) todo = todo.slice(0, limit)
  console.log(`보낼 요청 ${todo.length}, 동시 ${conc}`)
  if (!todo.length) return
  const key = readKey()
  let cur = 0, ok = 0, fail = 0
  const fails = {}
  const t0 = Date.now()
  const fd = fs.openSync(CACHE, 'a')
  const tick = setInterval(() => console.log(`진행 ${ok + fail}/${todo.length} 성공 ${ok} 실패 ${fail} ${((Date.now() - t0) / 1000).toFixed(0)}s`), 30000)
  async function worker() {
    while (cur < todo.length) {
      const req = todo[cur++]
      const res = await sendOne(req, key)
      if (res.ok) { fs.writeSync(fd, JSON.stringify({ key: req.key, type_key: req.type_key, tags: req.tags, response: res.data }) + '\n'); ok++ }
      else { fail++; fails[res.reason] = (fails[res.reason] || 0) + 1 }
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, todo.length) }, worker))
  clearInterval(tick)
  fs.closeSync(fd)
  console.log(`끝: 성공 ${ok} 실패 ${fail} ${JSON.stringify(fails)} ${((Date.now() - t0) / 1000).toFixed(0)}s`)
}

function scores(types, reqs, cache) {
  const byType = new Map(types.map(t => [t.type_key, { ...t, p: {} }]))
  let miss = 0
  for (const r of reqs) {
    const e = cache.get(r.key)
    if (!e) { miss++; continue }
    for (const tag of r.tags) {
      const a = e.response?.answers?.[tag]
      const p = typeof a?.noul === 'number' ? a.noul : typeof a?.probability === 'number' ? a.probability : null
      byType.get(r.type_key).p[tag] = p
    }
  }
  const rows = [...byType.values()].map(({ state, ...t }) => t)
  fs.writeFileSync(path.join(HERE, 'type-tag-scores.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  console.log(`종류 ${rows.length}, 응답 없는 요청 ${miss}`)
}

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? Number(argv[i + 1]) : undefined }
const types = loadTypes()
const dup = types.length - new Set(types.map(t => t.type_key)).size
const reqs = plan(types)
const cache = loadCache()
if (cmd === 'plan') {
  fs.writeFileSync(path.join(HERE, 'types.jsonl'), types.map(t => JSON.stringify(t)).join('\n') + '\n')
  const avg = types.reduce((s, t) => s + t.state.length, 0) / types.length
  console.log({ types: types.length, dup_type_keys: dup, requests: reqs.length, cached: reqs.filter(r => cache.has(r.key)).length, avg_state: Math.round(avg) })
  console.log(types[0].state)
} else if (cmd === 'send') await send(reqs, cache, opt('--limit') ?? -1, opt('--concurrency') ?? 8)
else if (cmd === 'scores') scores(types, reqs, cache)
else console.log('plan|send|scores')
