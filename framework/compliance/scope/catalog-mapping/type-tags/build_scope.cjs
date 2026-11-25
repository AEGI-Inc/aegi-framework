// 카탈로그 종류 ↔ 항목 확정 매핑(2026-11-09). p ≥ 0.6 확정, 0.4~0.6 애매함, 0.4 미만 뺌.
const fs = require('fs')
const path = require('path')
const B = path.join(__dirname, '..')
const rd = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const map = new Map(rd(path.join(B, 'items-clean/item-type-map.jsonl')).map(m => [`${m.item_key}|${m.type_key}`, m]))
const out = []
const cnt = { confirmed: 0, ambiguous: 0 }
const perItem = {}
for (const s of rd(path.join(__dirname, 'pair-scores.jsonl'))) {
  if (s.p < 0.4) continue
  const m = map.get(`${s.item_key}|${s.type_key}`)
  const status = s.p >= 0.6 ? 'confirmed' : 'ambiguous'
  cnt[status]++
  perItem[s.item_key] = (perItem[s.item_key] || 0) + 1
  out.push({ item_key: s.item_key, type_key: s.type_key, status, p: s.p, via: m.via, unit: m.unit })
}
fs.writeFileSync(path.join(B, 'items-clean/item-type-scope.jsonl'), out.map(r => JSON.stringify(r)).join('\n') + '\n')
const items = rd(path.join(B, 'items-clean/saas-items.jsonl')).map(r => r.item_key)
const empty = items.filter(k => !perItem[k])
const sorted = Object.entries(perItem).sort((a, b) => b[1] - a[1])
console.log({ pairs: out.length, ...cnt, types: new Set(out.map(r => r.type_key)).size, items_without_types: empty.length })
console.log('많은 항목:', sorted.slice(0, 5).map(([k, c]) => `${k}:${c}`).join(' '))
console.log('적은 항목:', sorted.slice(-5).map(([k, c]) => `${k}:${c}`).join(' '))
if (empty.length) console.log('종류 없는 항목:', empty.join(' '))
