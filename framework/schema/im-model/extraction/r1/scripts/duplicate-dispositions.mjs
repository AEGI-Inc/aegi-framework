// 기존 중복 판단 323쌍(재생성본 기준)을 결정 출처·근거에 연결한다. 재판정은 하지 않는다.
// 출처: user_decision(사람·v2), stated_source(원문 locator), rule(규칙), model(Jev 점수만). r1 결정(R1-D09, D10)은 덧씌운다.
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG, OUT, readJsonl, writeJson, writeJsonl } from './lib.mjs'

const R = path.join(OUT, 'regenerated-same-entity')
const r1Splits = readJsonl(path.join(OUT, 'space-splits.jsonl')).filter(s => s.decision_ref?.startsWith('R1-'))
const r1Ev = readJsonl(path.join(OUT, 'identity-evidence.jsonl')).filter(e => e.decision_ref === 'R1-D10')
const key = pair => [...pair].sort().join('|')
const rows = []
for (const f of fs.readdirSync(R).filter(f => f.endsWith('.json') && f !== 'diff-vs-pinned.json').sort()) {
  const p = f.replace('.json', ''), se = JSON.parse(fs.readFileSync(path.join(R, f), 'utf8'))
  for (const x of se.pairs) {
    const src = x.basis === 'human' ? 'user_decision' : x.basis === 'stated' ? 'stated_source' : x.basis === 'rule' ? 'rule' : 'model'
    let decision = x.decision, decision_ref = x.v2_decision ?? null, status = src === 'model' && decision === 'same' ? 'model_only_merge' : 'kept'
    const sp = r1Splits.find(s => s.provider === p && s.pair && key(s.pair) === key(x.pair))
    if (sp) { decision = 'different'; decision_ref = sp.decision_ref; status = 'changed_by_r1' }
    const ev = r1Ev.find(e => key([e.left.split(':')[1], e.right.split(':')[1]]) === key(x.pair) && e.left.startsWith(`${p}:`))
    if (ev) { decision_ref = ev.decision_ref; status = ev.basis_strength === 'stated' ? 'basis_upgraded_stated' : 'basis_upgraded_example' }
    rows.push({
      im_revision: CONFIG.revision, provider: p, pair: x.pair, decision, previous_decision: x.decision === decision ? null : x.decision,
      decision_source: src, basis: x.basis ?? null, decision_ref, source_evidence: x.source_evidence ? { source: x.source_evidence.source, locator: x.source_evidence.locator } : null,
      merges_spaces: decision === 'same', status,
      note: status === 'model_only_merge' ? 'Jev 점수만으로 같은 대상이라고 판정했다. 원문 근거나 사용자 결정이 없다' : null,
    })
  }
}
const summary = { revision: CONFIG.revision, pairs: rows.length, by_source: {}, by_status: {}, merges: rows.filter(r => r.merges_spaces).length }
for (const r of rows) { summary.by_source[r.decision_source] = (summary.by_source[r.decision_source] ?? 0) + 1; summary.by_status[r.status] = (summary.by_status[r.status] ?? 0) + 1 }
summary.note = 'model_only_merge 는 V3 에서 병합을 유지하되 근거 등급을 model 로 표시한다. 다른 판정(different, view_or_variant)은 병합하지 않으므로 model 근거여도 위험이 낮다'
writeJsonl(path.join(OUT, 'duplicate-dispositions.jsonl'), rows)
writeJson(path.join(OUT, 'duplicate-dispositions-summary.json'), summary)
console.log(JSON.stringify(summary, null, 1))
