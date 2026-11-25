// IM Object Model V3 고정: 검증을 통과한 r1 개정 산출물을 im-object-model-v3/ 에 모으고 파일별 해시를 FREEZE.json 에 남긴다.
// 이미 고정본이 있으면 덮어쓰지 않는다(새 버전은 새 디렉터리로).
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG, OUT, ROOT, fileSha, readJson, writeJson } from './lib.mjs'

const DEST = '<LOCAL_WORKSPACE_PATH>'
const ver = readJson(path.join(ROOT, 'verification.json'))
if (ver.status !== 'passed') throw new Error('verification.json 이 passed 가 아니다. 고정하지 않는다')
if (fs.existsSync(path.join(DEST, 'FREEZE.json'))) throw new Error(`${DEST} 에 이미 고정본이 있다`)

const layout = {
  'decisions/decisions.json': 'config/decisions.json',
  'decisions/source-rules.json': 'config/source-rules.json',
  'decisions/orphan-judgments.json': 'config/orphan-judgments.json',
  'decisions/graph-orphan-rules.json': 'config/graph-orphan-rules.json',
  'decisions/bridge-config.json': 'config/bridge-config.json',
  'objects/object-types.jsonl': `${CONFIG.revision}/object-decisions-full.jsonl`,
  'objects/object-coverage.json': `${CONFIG.revision}/object-rule-coverage.json`,
  'objects/decision-conflicts.jsonl': `${CONFIG.revision}/decision-conflicts.jsonl`,
  'identity/space-aliases.jsonl': `${CONFIG.revision}/space-aliases.jsonl`,
  'identity/space-splits.jsonl': `${CONFIG.revision}/space-splits.jsonl`,
  'identity/space-additions.jsonl': `${CONFIG.revision}/space-additions.jsonl`,
  'identity/identity-evidence.jsonl': `${CONFIG.revision}/identity-evidence.jsonl`,
  'identity/identity-conflicts.jsonl': `${CONFIG.revision}/identity-conflicts.jsonl`,
  'identity/duplicate-dispositions.jsonl': `${CONFIG.revision}/duplicate-dispositions.jsonl`,
  'identity/same-entity-diff-vs-pinned.json': `${CONFIG.revision}/regenerated-same-entity/diff-vs-pinned.json`,
  'relations/relation-bindings.jsonl': `${CONFIG.revision}/relation-bindings-full.jsonl`,
  'relations/reference-dispositions.jsonl': `${CONFIG.revision}/reference-dispositions.jsonl`,
  'relations/relation-coverage.json': `${CONFIG.revision}/relation-coverage.json`,
  'relations/version-conflicts.jsonl': `${CONFIG.revision}/version-conflicts.jsonl`,
  'information/information-disposition.jsonl': `${CONFIG.revision}/information-disposition.jsonl`,
  'information/information-disposition-summary.json': `${CONFIG.revision}/information-disposition-summary.json`,
  'information/orphan-observation.jsonl': `${CONFIG.revision}/orphan-observation.jsonl`,
  'evidence/observation-operation-links.jsonl': `${CONFIG.revision}/observation-operation-links.jsonl`,
  'evidence/bridge-coverage.json': `${CONFIG.revision}/bridge-coverage.json`,
  'evidence/observed-ir-comparison.jsonl': `${CONFIG.revision}/observed-ir-comparison.jsonl`,
  'evidence/observed-ir-summary.json': `${CONFIG.revision}/observed-ir-summary.json`,
  'evidence/shape-conflicts.jsonl': `${CONFIG.revision}/shape-conflicts.jsonl`,
  'evidence/pilot-replay.json': `${CONFIG.revision}/pilot-replay.json`,
  'graph/graph-orphans.jsonl': `${CONFIG.revision}/graph-orphans.jsonl`,
  'graph/graph-orphans-summary.json': `${CONFIG.revision}/graph-orphans-summary.json`,
  'verification.json': 'verification.json',
}
for (const f of fs.readdirSync(path.join(OUT, 'regenerated-same-entity')).filter(f => f.endsWith('.json') && f !== 'diff-vs-pinned.json')) layout[`identity/same-entity/${f}`] = `${CONFIG.revision}/regenerated-same-entity/${f}`

fs.mkdirSync(DEST, { recursive: true })
const files = []
for (const [dst, src] of Object.entries(layout)) {
  const s = path.join(ROOT, src), d = path.join(DEST, dst)
  fs.mkdirSync(path.dirname(d), { recursive: true })
  // same_entity 신호의 실측 예시 값(실측 N>0)은 tenant 값이므로 가린다. 문서 예시 값(실측 0)은 원문 값이라 둔다
  if (dst.startsWith('identity/same-entity/')) fs.writeFileSync(d, fs.readFileSync(s, 'utf8').replace(/(실측 [1-9][0-9]*\) 예 )\[[^\]]*\]/g, "$1['<observed value redacted>']"))
  else fs.copyFileSync(s, d)
  files.push({ path: dst, from: `im-model-revision/${src}`, sha256: fileSha(d), bytes: fs.statSync(d).size, ...(dst.startsWith('identity/same-entity/') && fileSha(d) !== fileSha(s) ? { transform: 'observed_example_values_redacted' } : {}) })
}

// 어휘: 현행 Relation_Schema_v3 표 (R1-D14)
const spec = fs.readFileSync('<LOCAL_WORKSPACE_PATH>', 'utf8').split('\n')
const vocab = []
for (const l of spec) {
  const cells = l.split('\\|').join('\u0001').split('|').map(c => c.split('\u0001').join('|').trim())
  let m
  if (/^\d+$/.test(cells[1] ?? '') && /^[a-z_]+$/.test(cells[2] ?? '')) vocab.push({ no: Number(cells[1]), relation_type: cells[2], template: cells[3], examples: cells[4] ?? null })
  else if ((m = /^(\d+)\s+([a-z_]+)$/.exec(cells[1] ?? ''))) vocab.push({ no: Number(m[1]), relation_type: m[2], template: cells[2], examples: cells[3] ?? null })
}
const vocabFile = { source: 'aegi-knowledge/schema/specs/Relation_Schema_v3.md', source_sha256: fileSha('<LOCAL_WORKSPACE_PATH>'), relation_types: vocab.sort((a, b) => a.no - b.no) }
writeJson(path.join(DEST, 'relations/vocabulary.json'), vocabFile)
files.push({ path: 'relations/vocabulary.json', from: vocabFile.source, sha256: fileSha(path.join(DEST, 'relations/vocabulary.json')), bytes: fs.statSync(path.join(DEST, 'relations/vocabulary.json')).size })

const cnt = f => fs.readFileSync(path.join(DEST, f), 'utf8').split('\n').filter(Boolean).length
const decisions = readJson(path.join(DEST, 'decisions/decisions.json')).decisions
const freeze = {
  model: 'AEGI IM Object Model', version: 'V3', frozen_on: '2026-10-25', frozen_by: 'user request ("다 끝나면 IM object model V3로 고정하자")',
  built_from: { revision: CONFIG.revision, workspace: '<LOCAL_WORKSPACE_PATH>', cohort: CONFIG.cohort, pinned_ir: CONFIG.ir_root, predecessor: 'IM v1 (2026-10-19 고정) + v2 결정(research_overrides_v2, relation_decisions_v2, rulebook)' },
  inputs: ver.inputs, verification: { status: ver.status, checks: ver.checks.length, file: 'verification.json' },
  counts: {
    object_types: cnt('objects/object-types.jsonl'), relation_types: vocab.length, relation_bindings: cnt('relations/relation-bindings.jsonl'), typed_references: cnt('relations/reference-dispositions.jsonl'),
    information_items_orphan: cnt('information/information-disposition.jsonl'), duplicate_pairs: cnt('identity/duplicate-dispositions.jsonl'), graph_orphans: cnt('graph/graph-orphans.jsonl'), observation_pages: cnt('evidence/observation-operation-links.jsonl'),
  },
  decisions: decisions.map(d => ({ code: d.code, decided_by: d.decided_by ?? 'user' })),
  files,
}
writeJson(path.join(DEST, 'FREEZE.json'), freeze)
console.log(JSON.stringify({ dest: DEST, files: files.length, counts: freeze.counts, vocab: vocab.map(v => v.relation_type).join(',') }, null, 1))
