// 종류 태그 초안: v2 ≥ 0.7 은 붙임, v2 0.4~0.7 은 v1 ≥ 0.5 일 때 붙임. 출처를 함께 남긴다.
const fs = require('fs')
const path = require('path')
const rd = f => fs.readFileSync(path.join(__dirname, f), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const v1 = new Map(rd('type-tag-scores.jsonl').map(r => [r.type_key, r.p]))
const rows = []
const cnt = {}
let none = 0
for (const r of rd('type-tag-scores-v2.jsonl')) {
  const tags = {}
  for (const [t, p] of Object.entries(r.p)) {
    const p1 = v1.get(r.type_key)?.[t] ?? 0
    if (p >= 0.7) tags[t] = { src: 'jev-v2', p2: p, p1 }
    else if (p >= 0.4 && p1 >= 0.5) tags[t] = { src: 'jev-v2mid+v1', p2: p, p1 }
  }
  for (const t of Object.keys(tags)) cnt[t] = (cnt[t] || 0) + 1
  if (!Object.keys(tags).length) none++
  rows.push({ type_key: r.type_key, provider: r.provider, object_type: r.object_type, interfaces: r.interfaces, profile: r.profile, research_type: r.research_type, tags })
}
fs.writeFileSync(path.join(__dirname, 'type-tags.draft.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
console.log({ types: rows.length, untagged: none, pairs: Object.values(cnt).reduce((a, b) => a + b, 0) })
console.log(Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}:${c}`).join(' '))
