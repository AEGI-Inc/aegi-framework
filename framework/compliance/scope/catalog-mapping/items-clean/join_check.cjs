// 항목 태그 × 종류 태그 = (항목, 종류) 매핑. 지난 인스턴스 판정(type-decisions.draft)과 비교한다.
// 비교는 Jev·사람이 실제로 판정한 묶음만(규칙으로 걸러진 out 은 판정이 아니라 뺀다). PIPA 는 항목 키가 바뀌어 뺀다.
const fs = require('fs')
const path = require('path')
const B = path.join(__dirname, '..')
const rd = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const itemTags = new Map(fs.readFileSync(path.join(__dirname, 'item-tags.v2.tsv'), 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => { const [k, t] = l.split('\t'); const a = t.trim().split(/\s+/); return [k, { obj: a.includes('@obj'), typeUnit: a.filter(x => x.startsWith('@type=')).map(x => x.slice(6)), tags: a.filter(x => !x.startsWith('@')) }] }))
const types = rd(path.join(B, 'type-tags/type-tags.jsonl'))
const typeTags = new Map(types.map(t => [t.type_key, Object.keys(t.tags)]))
// 매핑
const map = []
for (const [ik, it] of itemTags) for (const [tk, tt] of typeTags) { const hit = it.tags.filter(t => tt.includes(t)); if (hit.length) map.push({ item_key: ik, type_key: tk, via: hit, unit: hit.every(t => it.typeUnit.includes(t)) ? 'type' : 'object' }) }
fs.writeFileSync(path.join(__dirname, 'item-type-map.jsonl'), map.map(r => JSON.stringify(r)).join('\n') + '\n')
const perItem = {}
for (const m of map) perItem[m.item_key] = (perItem[m.item_key] || 0) + 1
const zero = [...itemTags.keys()].filter(k => !perItem[k])
const sorted = Object.entries(perItem).sort((a, b) => b[1] - a[1])
console.log({ pairs: map.length, items: itemTags.size, items_without_types: zero.length, types_mapped: new Set(map.map(m => m.type_key)).size })
console.log('종류가 많은 항목:', sorted.slice(0, 6).map(([k, c]) => `${k}:${c}`).join(' '))
console.log('종류가 적은 항목:', sorted.slice(-6).map(([k, c]) => `${k}:${c}`).join(' '))
if (zero.length) console.log('종류 없는 항목:', zero.join(' '))
// 지난 판정과 비교
const mapped = new Set(map.map(m => `${m.item_key}|${m.type_key}`))
const td = rd(path.join(__dirname, 'type-decisions.draft.jsonl')).filter(d => d.type_key.startsWith('O|') && !d.item_key.startsWith('PIPA') && itemTags.has(d.item_key) && (d.sources.model || d.sources.human) && (d.decision === 'in' || d.decision === 'out'))
let tp = 0, fp = 0, fn = 0, tn = 0, unknownType = 0
const fnEx = [], fpEx = []
for (const d of td) {
  const [, prov, ...rest] = d.type_key.split('|'); const tk = `${prov}:${rest.join('|')}`
  if (!typeTags.has(tk)) { unknownType++; continue }
  const m = mapped.has(`${d.item_key}|${tk}`), y = d.decision === 'in'
  if (y && m) tp++; else if (y) { fn++; fnEx.push(`${d.item_key} ${tk} 종류태그:[${typeTags.get(tk).join(' ')}] 항목태그:[${itemTags.get(d.item_key).tags.join(' ')}]`) } else if (m) { fp++; fpEx.push(`${d.item_key} ${tk}`) } else tn++
}
console.log(`지난 판정(Jev·사람, ISO·ISMS-P, 객체) ${td.length} 묶음, profile 없는 종류 ${unknownType}`)
console.log(`in 을 잡음 ${tp}, in 을 놓침 ${fn}, out 인데 잡음 ${fp}, out 을 뺌 ${tn} → 재현 ${(tp / (tp + fn)).toFixed(2)} 정밀 ${(tp / (tp + fp)).toFixed(2)}`)
fs.writeFileSync(path.join(__dirname, 'join-check-fn.txt'), fnEx.join('\n') + '\n')
fs.writeFileSync(path.join(__dirname, 'join-check-fp.txt'), fpEx.join('\n') + '\n')
