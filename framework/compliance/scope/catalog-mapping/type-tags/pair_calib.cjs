// 쌍 점수를 지난 판정(type-decisions.draft)과 맞춘다. 사람 판정 묶음만 / Jev+사람 묶음.
const fs = require('fs')
const path = require('path')
const B = path.join(__dirname, '..')
const rd = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const sc = new Map(rd(path.join(__dirname, 'pair-scores.jsonl')).map(r => [`${r.item_key}|${r.type_key}`, r.p]))
const items167 = new Set(rd(path.join(B, 'items-clean/saas-items.jsonl')).map(r => r.item_key))
const td = rd(path.join(B, 'items-clean/type-decisions.draft.jsonl')).filter(d => d.type_key.startsWith('O|') && !d.item_key.startsWith('PIPA') && items167.has(d.item_key) && (d.decision === 'in' || d.decision === 'out'))
const tk = d => { const [, p, ...r] = d.type_key.split('|'); return `${p}:${r.join('|')}` }
for (const [name, f] of [['사람', d => d.sources.human], ['Jev+사람', d => d.sources.human || d.sources.model]]) {
  const g = td.filter(f)
  const inMap = g.filter(d => sc.has(`${d.item_key}|${tk(d)}`))
  const inOut = g.filter(d => d.decision === 'in')
  console.log(`== ${name}: 묶음 ${g.length} (in ${inOut.length}), 매핑에 있는 것 ${inMap.length}, 매핑에 없는 in ${inOut.filter(d => !sc.has(`${d.item_key}|${tk(d)}`)).length}`)
  for (const T of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    let tp = 0, fp = 0, fn = 0, tn = 0
    for (const d of inMap) { const y = d.decision === 'in', p = sc.get(`${d.item_key}|${tk(d)}`) >= T; if (y && p) tp++; else if (p) fp++; else if (y) fn++; else tn++ }
    console.log(`  T=${T}: in 잡음 ${tp} in 놓침 ${fn} out 인데 붙임 ${fp} out 뺌 ${tn} | 정밀 ${(tp / (tp + fp)).toFixed(2)} 재현(매핑 안) ${(tp / (tp + fn)).toFixed(2)}`)
  }
}
const all = rd(path.join(__dirname, 'pair-scores.jsonl'))
for (const T of [0.4, 0.5, 0.6]) console.log(`T=${T} 이면 확정 쌍 ${all.filter(r => r.p >= T).length} / ${all.length}`)
