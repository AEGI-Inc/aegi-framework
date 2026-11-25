// v1·v2 점수 합치는 방식 비교와 v2 구간 분포
const fs = require('fs')
const path = require('path')
const rd = f => fs.readFileSync(path.join(__dirname, f), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const v1 = new Map(rd('type-tag-scores.jsonl').map(r => [r.type_key, r.p]))
const v2 = rd('type-tag-scores-v2.jsonl')
const ens = { max: (a, b) => Math.max(a, b), avg: (a, b) => (a + b) / 2, v2: (a, b) => b }
for (const [name, f] of Object.entries(ens)) {
  const out = v2.map(r => ({ ...r, p: Object.fromEntries(Object.entries(r.p).map(([t, p]) => [t, Math.round(f(v1.get(r.type_key)?.[t] ?? 0, p) * 100) / 100])) }))
  fs.writeFileSync(path.join(__dirname, `type-tag-scores-${name}.jsonl`), out.map(r => JSON.stringify(r)).join('\n') + '\n')
}
let hi = 0, mid = 0, midDr = 0, midTypes = new Set()
for (const r of v2) for (const [t, p] of Object.entries(r.p)) { if (p >= 0.7) hi++; else if (p >= 0.4) { mid++; if (t === 'data_resource') midDr++; else midTypes.add(r.type_key) } }
console.log({ v2_hi_pairs: hi, v2_mid_pairs: mid, mid_data_resource: midDr, mid_other_types: midTypes.size })
