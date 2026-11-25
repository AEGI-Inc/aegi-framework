// v3: v2 에서 0.4~0.7 인 (종류, 태그) 쌍만 「점검 담당자가 봐야 하는가」로 다시 묻는다.
// 사용: node jev_mid_v3.mjs plan|send|scores [--concurrency N]
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const KEY_FILE = process.env.JEV_KEY_FILE // TYPESAFE_API_KEY= 줄이 있는 파일. 환경 변수 TYPESAFE_API_KEY 가 있으면 그걸 쓴다
const URL_ = 'https://api.typesafe.ai/v1/systemone'
const CACHE = path.join(HERE, 'cache-v3.jsonl')
const rd = f => fs.readFileSync(path.join(HERE, f), 'utf8').split('\n').filter(Boolean).map(JSON.parse)

// 태그별 점검 영역(영어)
const AREA = {
  account: 'user and service account management (unique IDs, shared accounts, default accounts)',
  group: 'group and organizational unit membership management',
  provisioning: 'automated account provisioning and deprovisioning (SCIM, directory sync, JIT)',
  access_role: 'role and permission design (what each role or permission set allows, least privilege, segregation of duties)',
  access_grant: 'who has been granted access (role assignments, memberships, ACL entries) and timely revocation',
  admin_access: 'administrator and privileged access',
  sharing: 'external or public sharing of data',
  authentication: 'sign-in security (MFA, SSO, sign-on policies, authenticators)',
  password_policy: 'password rules and account lockout',
  session_policy: 'session timeout and concurrent session limits',
  network_policy: 'network location restrictions (IP allowlists, network zones, trusted origins)',
  device: 'end-user device security and device management',
  credential: 'secrets and tokens (API tokens, keys, client secrets) and their lifecycle',
  encryption: 'encryption and cryptographic key management',
  integration: 'third-party applications connected to the tenant and the access users granted them',
  automation: 'automations running inside the tenant (workflows, flows, scripts, bots, scheduled jobs)',
  data_flow: 'data transfer channels into and out of the tenant (webhooks, forwarding, remote endpoints)',
  data_resource: 'inventory and protection of business data and documents',
  data_classification: 'data classification and labeling',
  dlp: 'data loss prevention and masking',
  data_region: 'data residency and cross-border transfer',
  retention_backup: 'data retention, deletion and backup',
  monitoring: 'audit logging, alerting and threat detection configuration',
  code_repo: 'source code repositories',
  code_access: 'access to source code repositories',
  code_security: 'code security scanning',
  change_control: 'change control on code and configuration (branch protection, approvals)',
  tenant: 'the inventory of SaaS tenants and their domains',
  tenant_policy: 'tenant-wide security configuration review',
  malware: 'malware and phishing protection settings',
  ownership: 'asset ownership assignment',
}
const CRITERIA = {
  true: 'Objects of this type directly hold the settings, records or permissions that this review examines, so the reviewer must look at them.',
  false: 'Objects of this type would not be examined in this review: they are business data or metadata only loosely related to the area, display or UI configuration, reference data, or a different area.',
}
const canon = v => v === null || typeof v !== 'object' ? JSON.stringify(v) ?? 'null' : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
const ckey = b => crypto.createHash('sha256').update(canon(b)).digest('hex')

function plan() {
  const types = new Map(rd('types-v2.jsonl').map(t => [t.type_key, t]))
  const reqs = []
  for (const r of rd('type-tag-scores-v2.jsonl')) {
    const t = types.get(r.type_key)
    if (!t) continue
    const sure = Object.entries(r.p).filter(([, p]) => p >= 0.7).map(([k]) => k)
    const mid = Object.entries(r.p).filter(([, p]) => p >= 0.4 && p < 0.7).map(([k]) => k)
    if (!mid.length) continue
    const state = t.state + (sure.length ? ` Already known to be: ${sure.join(', ')}.` : '')
    for (let i = 0; i < mid.length; i += 11) {
      const chunk = mid.slice(i, i + 11)
      const questions = {}
      for (const tag of chunk) questions[tag] = { type: 'noul', instructions: `A security reviewer is checking ${AREA[tag]} in this SaaS tenant. Would the reviewer need to examine objects of the type described in the state as part of this check?`, criteria: CRITERIA }
      const body = { state, model: 'jev-latest', questions }
      reqs.push({ type_key: r.type_key, tags: chunk, body, key: ckey(body) })
    }
  }
  return reqs
}
const loadCache = () => { const m = new Map(); if (fs.existsSync(CACHE)) for (const l of fs.readFileSync(CACHE, 'utf8').split('\n')) { if (l.trim()) try { const e = JSON.parse(l); m.set(e.key, e) } catch {} } return m }
const readKey = () => { if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY.trim(); for (const l of fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)) if (l.trim().startsWith('TYPESAFE_API_KEY=')) return l.trim().slice(17).trim(); throw new Error('키 없음') }

async function send(reqs, cache, conc) {
  const todo = reqs.filter(r => !cache.has(r.key))
  console.log(`보낼 요청 ${todo.length}`)
  if (!todo.length) return
  const key = readKey()
  const fd = fs.openSync(CACHE, 'a')
  let cur = 0, ok = 0, fail = 0
  const t0 = Date.now()
  async function worker() {
    while (cur < todo.length) {
      const req = todo[cur++]
      let done = false
      for (let a = 0; a < 5 && !done; a++) {
        try {
          const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) })
          if (r.ok) { fs.writeSync(fd, JSON.stringify({ key: req.key, type_key: req.type_key, tags: req.tags, response: await r.json() }) + '\n'); ok++; done = true }
          else if (r.status === 429 || r.status >= 500) await new Promise(s => setTimeout(s, 1500 * 2 ** a))
          else break
        } catch { await new Promise(s => setTimeout(s, 1500 * 2 ** a)) }
      }
      if (!done) fail++
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, todo.length) }, worker))
  fs.closeSync(fd)
  console.log(`끝: 성공 ${ok} 실패 ${fail} ${((Date.now() - t0) / 1000).toFixed(0)}s`)
}

function scores(reqs, cache) {
  const out = []
  for (const r of reqs) {
    const e = cache.get(r.key)
    for (const tag of r.tags) {
      const a = e?.response?.answers?.[tag]
      out.push({ type_key: r.type_key, tag, p3: typeof a?.noul === 'number' ? a.noul : null })
    }
  }
  fs.writeFileSync(path.join(HERE, 'mid-v3-scores.jsonl'), out.map(r => JSON.stringify(r)).join('\n') + '\n')
  console.log(`쌍 ${out.length}, 응답 없음 ${out.filter(r => r.p3 === null).length}`)
}

const [cmd] = process.argv.slice(2)
const ci = process.argv.indexOf('--concurrency')
const reqs = plan()
const cache = loadCache()
if (cmd === 'plan') console.log({ requests: reqs.length, pairs: reqs.reduce((s, r) => s + r.tags.length, 0), cached: reqs.filter(r => cache.has(r.key)).length }, reqs[0].body.state)
else if (cmd === 'send') await send(reqs, cache, ci > 0 ? Number(process.argv[ci + 1]) : 16)
else if (cmd === 'scores') scores(reqs, cache)
