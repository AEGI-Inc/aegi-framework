// 인스턴스 판정(scope-pairs-s6)을 (항목, 종류) 판정표 초안으로 올린다.
// node type_decisions.cjs  → type-decisions.draft.jsonl, type-decisions.mixed.jsonl, type-decisions.summary.json
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const B = path.resolve(__dirname, '..')
const K = path.resolve(B, '..', '..', 'aegi-knowledge')
const gs = p => execFileSync('git', ['-C', K, 'show', 'origin/main:' + p], { encoding: 'utf8', maxBuffer: 1e9 }).replace(/^﻿/, '')
const jl = s => s.split('\n').filter(l => l.trim()).map(JSON.parse)

// 대상 → 종류, 이름
// 관계 종류는 (SaaS, 관계, 출발 객체 종류, 도착 객체 종류)로 묶는다
const T = new Map()
const targetRows = jl(fs.readFileSync(path.join(B, 'work/targets.jsonl'), 'utf8'))
const objType = new Map(targetRows.filter(t => t.kind !== 'relation').map(t => [t.target_key, `${t.provider}:${t.object_type}`]))
const endType = key => objType.get(key) ?? (key ? key.split(':').slice(1, 3).join(':') + '?' : '?')
for (const t of targetRows) {
  const type = t.kind === 'relation'
    ? `R|${t.provider}|${t.relation_type}|${endType(t.source_key)}>${endType(t.target_ref_key)}`
    : `O|${t.provider}|${t.object_type}`
  T.set(t.target_key, { type, name: t.name ?? t.target_key })
}
// 종류 → 태그 (객체만. 관계는 끝 객체에서 물려받아 종류 하나로 정해지지 않는다)
const kt = JSON.parse(gs('compliance/scope/rules/kind-tags.json'))
const tagsOf = new Map()
for (const { type } of T.values()) {
  if (tagsOf.has(type) || type[0] !== 'O') continue
  const tags = new Set()
  for (const [re, nameRe, tg] of kt.objects) if (!nameRe && new RegExp(re).test(type)) tg.forEach(x => tags.add(x))
  const named = kt.objects.filter(([re, nameRe]) => nameRe && new RegExp(re).test(type)).length
  tagsOf.set(type, { tags: [...tags], name_rules: named })
}

const G = new Map()
for (const p of jl(fs.readFileSync(path.join(B, 'work/scope-pairs-s6.jsonl'), 'utf8'))) {
  const t = T.get(p.target_key)
  const k = p.item_key + '\t' + t.type
  let g = G.get(k)
  if (!g) G.set(k, g = { item: p.item_key, type: t.type, n: 0, d: { in: 0, out: 0, review: 0 }, s: {}, ps: [], ex: { in: [], out: [], review: [] } })
  g.n++
  g.d[p.decision]++
  g.s[p.source] = (g.s[p.source] || 0) + 1
  if (p.p != null) g.ps.push(p.p)
  if (g.ex[p.decision].length < 5) g.ex[p.decision].push(t.name)
}

// 갈린 묶음의 부류: 종류 태그로 나눈다
function mixedKind(type) {
  const info = tagsOf.get(type)
  const tags = info?.tags ?? []
  if (type[0] === 'R') return 'relation'
  if (info?.name_rules) return 'config_bundle'
  if (tags.some(t => ['data_resource', 'record', 'sharing', 'data_classification'].includes(t))) return 'data_resource'
  if (tags.some(t => ['privileged_role', 'admin_grant', 'access_policy', 'access_grant'].includes(t))) return 'role_permission'
  if (tags.some(t => ['tenant_policy', 'auth_policy', 'password_policy', 'session_policy', 'network_policy'].includes(t))) return 'config_bundle'
  if (tags.some(t => ['account', 'group', 'app_identity'].includes(t))) return 'principal'
  return 'other'
}

const rows = [], mixed = []
const sum = { groups: G.size, by_decision: {}, by_basis: {}, mixed_by_kind: {}, by_framework: {} }
for (const g of G.values()) {
  const ds = Object.entries(g.d).filter(([, v]) => v > 0).map(([k]) => k)
  const srcs = Object.keys(g.s)
  let decision, basis
  if (ds.length === 1) {
    decision = ds[0]
    if (srcs.length === 1 && srcs[0] === 'rule') basis = 'rule_type'
    else if (g.n === 1) basis = 'single_instance'
    else if (srcs.includes('human') && srcs.length === 1) basis = 'human_bundle'
    else basis = 'uniform'
  } else {
    decision = 'split'
    basis = 'mixed'
  }
  const majority = Math.max(g.d.in, g.d.out, g.d.review) / g.n
  const row = {
    item_key: g.item, type_key: g.type, decision, basis, n_instances: g.n, counts: g.d, sources: g.s,
    p_mean: g.ps.length ? +(g.ps.reduce((a, b) => a + b, 0) / g.ps.length).toFixed(3) : null,
  }
  if (decision === 'split') {
    row.majority_share = +majority.toFixed(2)
    row.mixed_kind = mixedKind(g.type)
    row.examples = g.ex
    mixed.push(row)
    sum.mixed_by_kind[row.mixed_kind] = (sum.mixed_by_kind[row.mixed_kind] || 0) + 1
  }
  rows.push(row)
  sum.by_decision[decision] = (sum.by_decision[decision] || 0) + 1
  sum.by_basis[basis] = (sum.by_basis[basis] || 0) + 1
  const fw = g.item.split(':')[0]
  const f = sum.by_framework[fw] ??= { in: 0, out: 0, review: 0, split: 0 }
  f[decision]++
}
rows.sort((a, b) => a.item_key.localeCompare(b.item_key, undefined, { numeric: true }) || a.type_key.localeCompare(b.type_key))
mixed.sort((a, b) => a.mixed_kind.localeCompare(b.mixed_kind) || a.type_key.localeCompare(b.type_key) || a.item_key.localeCompare(b.item_key, undefined, { numeric: true }))
sum.mixed_majority_ge_90 = mixed.filter(r => r.majority_share >= 0.9).length
sum.mixed_types = [...new Set(mixed.map(r => r.type_key))].length
const W = s => s.map(r => JSON.stringify(r)).join('\n') + '\n'
fs.writeFileSync(path.join(__dirname, 'type-decisions.draft.jsonl'), W(rows))
fs.writeFileSync(path.join(__dirname, 'type-decisions.mixed.jsonl'), W(mixed))
fs.writeFileSync(path.join(__dirname, 'type-decisions.summary.json'), JSON.stringify(sum, null, 1) + '\n')
console.log(JSON.stringify(sum, null, 1))
