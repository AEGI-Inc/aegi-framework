// 최종 규칙 = v2 ≥ 0.7 ∪ (v2 0.4~0.7 이면서 v3 ≥ T). 정답(관측 종류, 이름 조건 포함)과 비교한다.
const fs = require('fs')
const path = require('path')
const B = path.join(__dirname, '..')
const rd = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const kind = JSON.parse(fs.readFileSync(path.join(B, 'items-clean/prev/kind-tags.json'), 'utf8'))
const O2N = { access_policy: 'access_role', privileged_role: 'admin_access', admin_grant: 'admin_access', admin_credential: 'credential', auth_policy: 'authentication', auth_factor: 'authentication', encryption_setting: 'encryption', crypto_key: 'encryption', oauth_grant: 'integration', app_identity: 'integration', external_endpoint: 'data_flow', inbound_endpoint: 'data_flow', org_structure: null, record: null, misc: null, capacity: null }
const nt = t => (t in O2N ? O2N[t] : t)
const v2 = new Map(rd(path.join(__dirname, 'type-tag-scores-v2.jsonl')).map(r => [r.type_key, r.p]))
const v3 = new Map(rd(path.join(__dirname, 'mid-v3-scores.jsonl')).map(r => [`${r.type_key}|${r.tag}`, r.p3]))
const TAGS = Object.keys(v2.values().next().value)
const obs = new Set(rd(path.join(B, 'items-clean/observed-types.jsonl')).map(t => `${t.provider}:${t.object_type}`))
const gold = new Map()
for (const tk of obs) {
  if (!v2.has(tk)) continue
  const [prov, ...rest] = tk.split(':'); const g = `O|${prov}|${rest.join(':')}`
  const s = new Set()
  for (const [gre, , ts] of kind.objects) if (new RegExp(gre).test(g)) for (const t of ts) { const n = nt(t); if (n) s.add(n) }
  gold.set(tk, s)
}
// 중간 구간 판단 점수: v3(기본), v1, 또는 v1·v3 평균
const v1 = new Map(rd(path.join(__dirname, 'type-tag-scores.jsonl')).map(r => [r.type_key, r.p]))
const MODE = process.argv[2] || 'v3'
const s3 = (tk, t) => MODE === 'v1' ? (v1.get(tk)?.[t] ?? 0) : MODE === 'avg13' ? ((v1.get(tk)?.[t] ?? 0) + (v3.get(`${tk}|${t}`) ?? 0)) / 2 : (v3.get(`${tk}|${t}`) ?? 0)
const decide = (tk, t, T) => { const p = v2.get(tk)[t]; if (p >= 0.7) return true; if (p < 0.4) return false; return s3(tk, t) >= T }
// 중간 구간만 따로: 정답 쌍에서 v3 의 분리력
let midPos = [], midNeg = []
for (const [tk, g] of gold) for (const t of TAGS) { const p = v2.get(tk)[t]; if (p >= 0.4 && p < 0.7) (g.has(t) ? midPos : midNeg).push(s3(tk, t)) }
const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)
console.log(`중간 구간 정답 쌍: 맞음 ${midPos.length}(v3 평균 ${avg(midPos)}) 아님 ${midNeg.length}(v3 평균 ${avg(midNeg)})`)
for (const T of [0.5, 0.6, 0.7, 0.8, 9]) {
  let tp = 0, fp = 0, fn = 0
  for (const [tk, g] of gold) for (const t of TAGS) { const y = g.has(t), p = decide(tk, t, T); if (y && p) tp++; else if (p) fp++; else if (y) fn++ }
  let pairs = 0
  for (const [tk] of v2) for (const t of TAGS) if (decide(tk, t, T)) pairs++
  console.log(`T=${T === 9 ? '(중간 버림)' : T}: 맞춤 ${tp} 더 붙임 ${fp} 놓침 ${fn} 정밀 ${(tp / (tp + fp)).toFixed(2)} 재현 ${(tp / (tp + fn)).toFixed(2)} | 카탈로그 전체 (종류,태그) ${pairs}`)
}
