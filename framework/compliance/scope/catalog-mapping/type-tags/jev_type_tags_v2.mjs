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
const CACHE = path.join(HERE, 'cache-v2.jsonl')
const BATCH = 11

const PROVIDER = { gws: 'Google Workspace', okta: 'Okta', github: 'GitHub', salesforce: 'Salesforce', slack: 'Slack', jira: 'Jira (Atlassian)', confluence: 'Confluence (Atlassian)', atlassian: 'Atlassian organization admin' }

// v2 태그 질문. is = 종류 자체가 그것인가, can = 이 종류의 객체 중 그것이 있을 수 있는가(같은 종류 안에서 갈리는 태그).
// [mode, 정의, 맞는 예, 아닌 예]
const TAGS = {
  account: ['is', 'an identity that signs in or acts: a user account, service account or bot user', 'Okta User, Google Workspace User, Salesforce User, Slack member or bot, GitHub user, Atlassian SCIM user', 'groups, teams, organizations, roles, user types/schemas, user settings or preferences, contact or lead records about people'],
  group: ['is', 'a named set of user accounts used to manage members together: a group, team, or organizational unit (OU)', 'Okta Group, Salesforce public Group, Atlassian group, Google Workspace OrgUnit, GitHub team', 'the tenant/organization/workspace/enterprise itself, a membership record, a role, a channel or project'],
  provisioning: ['is', 'automatic account lifecycle plumbing between systems', 'SCIM or directory sync connection, AD/LDAP agent sync, JIT provisioning config, profile/attribute mapping, group push mapping, rule that auto-assigns users to groups, user provisioning config', 'the user or group itself, a manual role assignment'],
  access_role: ['is', 'a definition of what holders may do (the definition, not who holds it)', 'role, custom role, permission set, profile, permission set group, permission scheme, project role, resource set, entitlement bundle', 'a role assignment or membership record, a user, a group'],
  access_grant: ['is', 'a record that gives a specific principal access', 'role assignment, group membership, permission set assignment, app user assignment, file/folder permission or ACL entry, record share, team member on a record, OAuth scope consent', 'a role definition, the user itself, the shared resource itself'],
  admin_access: ['can', 'administrator or highest privilege', 'admin role definitions or admin role assignments (role and role-assignment types usually include admin ones), admin API tokens, super admin flags', 'non-permission objects, business records'],
  sharing: ['can', 'access opened outside the organization or to anyone', 'file or drive permissions (can be anyone-with-link or external), share links, guest or external user access, public sites or pages, external sharing policy settings', 'internal-only role definitions, user accounts'],
  authentication: ['is', 'how users sign in', 'sign-on or MFA policy and rules, authenticators, enrolled user factors, SSO/SAML/OIDC identity provider configuration, auth provider, login security settings', 'API tokens alone, password rules alone, session lifetime alone'],
  password_policy: ['can', 'password rules or lockout after failed sign-in', 'password policy and rules, lockout settings, a generic security policy or settings object that may contain password rules', 'a password reset event, a credential value'],
  session_policy: ['can', 'session lifetime, idle timeout or concurrent session limits', 'sign-on policy rules with session lifetime, session control settings, a generic security policy or settings object that may contain session settings', 'a session record, a login event'],
  network_policy: ['can', 'network location restrictions', 'IP allowlist, network zone, trusted origin, CORS/CSP trusted site, login IP ranges, a security settings object that may contain IP restrictions', 'webhooks or remote endpoints that send data out'],
  device: ['is', 'end-user devices or device management', 'enrolled or managed device, device user, device telemetry, mobile or endpoint management settings', 'servers, API clients'],
  credential: ['is', 'a secret-bearing object that authenticates', 'API token, personal access token, OAuth refresh/access token, client secret, deploy key, actions or codespaces secret, named credential, signing key, certificate', 'OAuth app definition without secret, policy settings'],
  encryption: ['can', 'encryption settings or encryption/signing keys', 'encryption key, JSON web key, deploy/SSH key, key management (BYOK/EKM) configuration, S/MIME or confidential mail settings, a security settings object that may contain encryption settings', 'tokens used only for authentication'],
  integration: ['is', 'a third-party or external application connected to the tenant, or its authorization', 'installed app, connected app, OAuth client, external client application, app installation, OAuth token or consent a user granted to an app, app access control setting, authorization server for apps', 'internal workflows or scripts, the tenant itself'],
  automation: ['is', 'logic that runs inside the tenant without a person', 'workflow, flow or flow version, automation rule, Apex class, script, scheduled or cron job, bot or bot version, AI agent or planner/function definition, CI workflow', 'third-party apps, data records'],
  data_flow: ['is', 'a channel that moves data into or out of the tenant', 'webhook, event or inline hook, remote site, external host, mail forwarding, inbound email service or address, web-to-lead form, outbound message or sync mapping', 'internal records, permissions'],
  data_resource: ['is', 'business content stored in the SaaS', 'file, document, mailbox, message, channel, page, space, project, issue, comment, repository, CRM record (account, contact, lead, opportunity, case, order), report', 'configuration or settings, metadata definitions, layouts, picklists, schemas, licenses, permissions, technical/system records'],
  data_classification: ['can', 'data sensitivity classification', 'sensitivity label, data classification on fields, security level scheme, Drive labels', 'ordinary tags or categories for organizing work'],
  dlp: ['can', 'data loss prevention', 'DLP rule, data masking, field hiding, download/copy/print restriction, a security settings object that may contain DLP rules', 'ordinary permissions'],
  data_region: ['can', 'data residency', 'data region setting, a tenant settings object that may contain data region settings', 'a time zone or locale'],
  retention_backup: ['can', 'data lifecycle', 'retention policy, deletion or purge setting, vault or legal hold, archive, backup or export setting, immutable release setting, a settings object that may contain retention settings', 'a deleted-item record'],
  monitoring: ['can', 'logging and detection configuration', 'audit log setting, alert rule, alert, anomaly or threat detection setting, behavior detection rule, log streaming, event hook to a SIEM', 'business records'],
  code_repo: ['is', 'source code storage', 'repository, branch, commit, git tree', 'issues, discussions, pull request comments'],
  code_access: ['is', 'access to source repositories', 'repository collaborator, repository team permission, deploy key', 'org members in general'],
  code_security: ['is', 'code security scanning', 'code scanning alert or setup, secret scanning, dependabot alert, code security configuration', 'general CI workflows'],
  change_control: ['is', 'controls on changes', 'branch protection, ruleset, rule suite, required reviews, bypass allowance, multi-party approval, immutable releases', 'the branch or commit itself'],
  tenant: ['is', 'the tenant itself', 'organization, workspace, enterprise, Google Workspace customer, Salesforce organization, Slack team, Okta org, a domain owned by the tenant', 'groups, teams inside the tenant, OUs'],
  tenant_policy: ['can', 'a tenant-wide settings object (organization-level security or admin configuration)', 'org settings, security policy object, generic policy/settings list, workspace settings, customer settings', 'per-repository rulesets, permission set groups, per-user records, business records'],
  malware: ['can', 'malware or phishing defense settings', 'attachment scanning, link protection, spoofing protection, a mail security settings object that may contain these', 'threat detection on sign-in'],
  ownership: ['is', 'a record that assigns an owner or responsible person to an asset', 'owner assignment, data steward or owner record', 'any object that merely has an owner field'],
}
const CRITERIA = {
  is: { true: 'Objects of this type are themselves this kind of thing, like the positive examples.', false: 'Objects of this type are not this kind of thing: like the negative examples, or only in a related product area, or vendor metadata, catalog/reference data or UI configuration.' },
  can: { true: 'At least some objects of this type are, or contain, this kind of thing, like the positive examples.', false: 'No object of this type would be this kind of thing: like the negative examples, or unrelated.' },
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
    for (const n of chunk) {
      const [mode, def, yes, no] = TAGS[n]
      const q = mode === 'is' ? 'Is the SaaS object type described in the state this kind of thing?' : 'Can objects of the SaaS object type described in the state be (or contain) this kind of thing?'
      questions[n] = { type: 'noul', instructions: `Tag "${n}": ${def}. Yes examples: ${yes}. Not: ${no}. ${q}`, criteria: CRITERIA[mode] }
    }
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
  fs.writeFileSync(path.join(HERE, 'type-tag-scores-v2.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
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
  fs.writeFileSync(path.join(HERE, 'types-v2.jsonl'), types.map(t => JSON.stringify(t)).join('\n') + '\n')
  const avg = types.reduce((s, t) => s + t.state.length, 0) / types.length
  console.log({ types: types.length, dup_type_keys: dup, requests: reqs.length, cached: reqs.filter(r => cache.has(r.key)).length, avg_state: Math.round(avg) })
  console.log(types[0].state)
} else if (cmd === 'send') await send(reqs, cache, opt('--limit') ?? -1, opt('--concurrency') ?? 8)
else if (cmd === 'scores') scores(types, reqs, cache)
else console.log('plan|send|scores')
