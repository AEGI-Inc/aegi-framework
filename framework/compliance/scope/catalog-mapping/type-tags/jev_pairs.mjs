// 1차 매핑(item-type-map.jsonl)의 (항목, 종류) 쌍을 모두 Jev 에 묻는다(2026-11-09).
// 요청 하나 = 종류 하나 + 항목 최대 12개. 사용: node jev_pairs.mjs plan|send|scores [--concurrency N]
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const B = path.join(HERE, '..')
const KEY_FILE = process.env.JEV_KEY_FILE // TYPESAFE_API_KEY= 줄이 있는 파일. 환경 변수 TYPESAFE_API_KEY 가 있으면 그걸 쓴다
const URL_ = 'https://api.typesafe.ai/v1/systemone'
const CACHE = path.join(HERE, 'cache-pairs.jsonl')
const rd = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const PROVIDER = { gws: 'Google Workspace', okta: 'Okta', github: 'GitHub', salesforce: 'Salesforce', slack: 'Slack', jira: 'Jira (Atlassian)', confluence: 'Confluence (Atlassian)', atlassian: 'Atlassian', external: 'external' }

const CRITERIA = {
  true: 'Objects of this type (all of them, or some of them such as particular settings or admin roles) are themselves accounts, permissions, settings, data stores, records, integrations, credentials, automations or channels that this requirement asks the organization to manage or control.',
  false: 'Objects of this type are not what this requirement governs: they are only in a related product area, merely reference such things, or are business content, metadata, UI or reference data outside the requirement.',
}
const canon = v => v === null || typeof v !== 'object' ? JSON.stringify(v) ?? 'null' : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
const ckey = b => crypto.createHash('sha256').update(canon(b)).digest('hex')
const qkey = k => k.replace(/[^a-zA-Z0-9]/g, '_')

function plan() {
  const stmt = new Map(fs.readFileSync(path.join(B, 'items-clean/item-statements-en.tsv'), 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t')))
  const map = rd(path.join(B, 'items-clean/item-type-map.jsonl'))
  const missing = [...new Set(map.map(m => m.item_key))].filter(k => !stmt.has(k))
  if (missing.length) throw new Error('영어 문장 없음: ' + missing.join(' '))
  const states = new Map(rd(path.join(HERE, 'types-v2.jsonl')).map(t => [t.type_key, t.state]))
  for (const t of rd(path.join(HERE, 'type-tags.jsonl'))) if (!states.has(t.type_key)) states.set(t.type_key, `SaaS object type. Provider: ${PROVIDER[t.provider] || t.provider}. Type name: ${t.object_type}. Model interfaces: ${(t.interfaces || []).join(', ') || 'none'}.`)
  const byType = new Map()
  for (const m of map) { if (!byType.has(m.type_key)) byType.set(m.type_key, []); byType.get(m.type_key).push(m.item_key) }
  const reqs = []
  for (const [tk, items] of byType) {
    items.sort()
    for (let i = 0; i < items.length; i += 12) {
      const chunk = items.slice(i, i + 12)
      const questions = {}
      for (const ik of chunk) questions[qkey(ik)] = { type: 'noul', instructions: `Compliance requirement ${ik}: ${stmt.get(ik)} Are objects of the SaaS object type described in the state (all or some of them) targets that this requirement asks the organization to manage or control?`, criteria: CRITERIA }
      const body = { state: states.get(tk), model: 'jev-latest', questions }
      reqs.push({ type_key: tk, items: chunk, body, key: ckey(body) })
    }
  }
  return { reqs, pairs: map.length }
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
          if (r.ok) { fs.writeSync(fd, JSON.stringify({ key: req.key, type_key: req.type_key, items: req.items, response: await r.json() }) + '\n'); ok++; done = true }
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
    for (const ik of r.items) {
      const a = e?.response?.answers?.[qkey(ik)]
      out.push({ item_key: ik, type_key: r.type_key, p: typeof a?.noul === 'number' ? a.noul : null })
    }
  }
  fs.writeFileSync(path.join(HERE, 'pair-scores.jsonl'), out.map(r => JSON.stringify(r)).join('\n') + '\n')
  const b = { lt4: 0, mid: 0, ge7: 0, nul: 0 }
  for (const r of out) r.p === null ? b.nul++ : r.p < 0.4 ? b.lt4++ : r.p < 0.7 ? b.mid++ : b.ge7++
  console.log(`쌍 ${out.length}`, b)
}

const [cmd] = process.argv.slice(2)
const ci = process.argv.indexOf('--concurrency')
const { reqs, pairs } = plan()
const cache = loadCache()
if (cmd === 'plan') console.log({ pairs, requests: reqs.length, cached: reqs.filter(r => cache.has(r.key)).length })
else if (cmd === 'send') await send(reqs, cache, ci > 0 ? Number(process.argv[ci + 1]) : 16)
else if (cmd === 'scores') scores(reqs, cache)
