// 관측된 종류에 옛 종류 태그 규칙(이름 조건 없는 것만)을 적용해 정답으로 삼고 Jev 점수와 맞춘다.
const fs = require('fs')
const path = require('path')
const B = path.join(__dirname, '..')
const rd = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const kind = JSON.parse(fs.readFileSync(path.join(B, 'items-clean/prev/kind-tags.json'), 'utf8'))
const O2N = { access_policy: 'access_role', privileged_role: 'admin_access', admin_grant: 'admin_access', admin_credential: 'credential', auth_policy: 'authentication', auth_factor: 'authentication', encryption_setting: 'encryption', crypto_key: 'encryption', oauth_grant: 'integration', app_identity: 'integration', external_endpoint: 'data_flow', inbound_endpoint: 'data_flow', org_structure: null, record: null, misc: null, capacity: null }
const nt = t => (t in O2N ? O2N[t] : t)
const TAGS = Object.keys(JSON.parse(fs.readFileSync(path.join(B, 'items-clean/tags.json'), 'utf8')).tags.reduce((a, t) => (a[t.tag] = 1, a), {}))

const observed = new Set(rd(path.join(B, 'items-clean/observed-types.jsonl')).map(t => `${t.provider}:${t.object_type}`))
const SCORE_FILE = process.argv[3] || 'type-tag-scores.jsonl'
const WITH_MIXED = process.argv[4] === 'mixed' // 이름 조건 규칙 태그도 「있을 수 있음」 정답으로 넣는다
const scores = new Map(rd(path.join(__dirname, SCORE_FILE)).map(r => [r.type_key, r]))
const gold = new Map()
const mixed = new Set()
for (const tk of observed) {
  const [prov, ...rest] = tk.split(':'); const typ = rest.join(':')
  const g = `O|${prov}|${typ}`
  const tags = new Set()
  for (const [gre, nre, ts] of kind.objects) {
    if (!new RegExp(gre).test(g)) continue
    if (nre) { mixed.add(tk); if (!WITH_MIXED) continue }
    for (const t of ts) { const n = nt(t); if (n) tags.add(n) }
  }
  gold.set(tk, tags)
}
const usable = [...gold.keys()].filter(k => scores.has(k) && Object.keys(scores.get(k).p).length === TAGS.length && (WITH_MIXED || !mixed.has(k)))
console.log({ observed: observed.size, with_scores: [...gold.keys()].filter(k => scores.has(k)).length, mixed: mixed.size, usable: usable.length, tagged_in_gold: usable.filter(k => gold.get(k).size).length })
for (const th of [0.5, 0.6, 0.7, 0.8]) {
  let tp = 0, fp = 0, fn = 0
  for (const k of usable) for (const t of TAGS) {
    const y = gold.get(k).has(t), p = scores.get(k).p[t] >= th
    if (y && p) tp++; else if (p) fp++; else if (y) fn++
  }
  console.log(`기준 ${th}: 맞춤 ${tp} 더 붙임 ${fp} 놓침 ${fn} 정밀 ${(tp / (tp + fp)).toFixed(2)} 재현 ${(tp / (tp + fn)).toFixed(2)}`)
}
const TH = Number(process.argv[2] || 0.7)
const out = []
for (const k of usable) {
  const s = scores.get(k).p
  const pred = TAGS.filter(t => s[t] >= TH)
  const g = [...gold.get(k)]
  const add = pred.filter(t => !g.includes(t)), miss = g.filter(t => !pred.includes(t))
  if (add.length || miss.length) out.push(`${k}  옛:[${g.join(' ')}]  +${add.map(t => `${t}(${s[t]})`).join(' ')}  -${miss.map(t => `${t}(${s[t]})`).join(' ')}`)
}
fs.writeFileSync(path.join(__dirname, SCORE_FILE.replace('type-tag-scores', 'calib-diff').replace('.jsonl', '.txt')), out.join('\n') + '\n')
console.log(`기준 ${TH} 에서 다른 종류 ${out.length} → calib-diff.txt`)
