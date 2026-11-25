// 카탈로그 전체 점수 요약: 태그별 0.7 이상 / 0.4~0.7 종류 수, 태그 없는 종류 수, 관측 종류 중 점수 없는 것
const fs = require('fs')
const path = require('path')
const rd = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const S = rd(path.join(__dirname, 'type-tag-scores.jsonl'))
const tags = Object.keys(S[0].p)
const hi = {}, mid = {}
let none = 0, onlyMid = 0
const byProv = {}
for (const r of S) {
  const h = tags.filter(t => r.p[t] >= 0.7), m = tags.filter(t => r.p[t] >= 0.4 && r.p[t] < 0.7)
  for (const t of h) hi[t] = (hi[t] || 0) + 1
  for (const t of m) mid[t] = (mid[t] || 0) + 1
  const b = (byProv[r.provider] ||= { types: 0, tagged: 0, none: 0, midOnly: 0 })
  b.types++
  if (h.length) b.tagged++; else if (m.length) { b.midOnly++; onlyMid++ } else { b.none++; none++ }
}
console.log('종류', S.length, '0.7 이상 태그 있음', S.length - none - onlyMid, '0.4~0.7 만', onlyMid, '없음', none)
console.log(byProv)
console.log(tags.map(t => `${t}:${hi[t] || 0}/${mid[t] || 0}`).join('  '))
const obs = new Set(rd(path.join(__dirname, '../items-clean/observed-types.jsonl')).map(t => `${t.provider}:${t.object_type}`))
const have = new Set(S.map(r => r.type_key))
console.log('관측됐는데 점수 없는 종류:', [...obs].filter(k => !have.has(k)).join(', '))
