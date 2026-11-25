// R1-D05: pinned out2 를 덮어쓰지 않고 사본에서 dup_audit.py 를 캐시만으로 다시 돌린다(--send 없음, API 호출 없음).
// 결과 same_entity 와 pinned 대비 차이를 r1-pilot/regenerated-same-entity/ 에 둔다. 작업 사본은 private/ 아래다.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { CONFIG, OUT, PRIVATE, fileSha, writeJson } from './lib.mjs'

const CODE = '<LOCAL_WORKSPACE_PATH>'
const WORK = path.join(PRIVATE, 'regen-ir2')
const DEST = path.join(OUT, 'regenerated-same-entity')
const providers = ['okta', 'github', 'gws', 'jira', 'confluence', 'slack', 'atlassian', 'salesforce']

fs.rmSync(WORK, { recursive: true, force: true })
fs.cpSync(CODE, WORK, { recursive: true })
fs.cpSync(CONFIG.ir_root, path.join(WORK, 'out2'), { recursive: true })
fs.mkdirSync(DEST, { recursive: true })

const key = x => JSON.stringify([...x.pair].sort())
const groupsOf = se => se.groups.map(g => [...g.members].sort()).map(g => JSON.stringify(g)).sort()
const report = { revision: CONFIG.revision, decision: 'R1-D05', code_dir: CODE, dup_audit_sha256: fileSha(path.join(CODE, 'dup_audit.py')), overrides_sha256: fileSha(path.join(CODE, 'v2/research_overrides_v2.json')), providers: {} }
for (const p of providers) {
  const pinnedPath = path.join(CONFIG.ir_root, p, 'map', 'same_entity.json')
  const stdout = execFileSync('python', ['dup_audit.py', p], { cwd: WORK, encoding: 'utf8', maxBuffer: 1 << 26 })
  const run = JSON.parse(stdout.trim().split('\n').at(-1))
  if (run.sent !== 0) throw new Error(`${p}: dup_audit sent ${run.sent} requests`)
  const regenPath = path.join(WORK, 'out2', p, 'map', 'same_entity.json')
  const a = JSON.parse(fs.readFileSync(pinnedPath, 'utf8')), b = JSON.parse(fs.readFileSync(regenPath, 'utf8'))
  const A = new Map(a.pairs.map(x => [key(x), x])), B = new Map(b.pairs.map(x => [key(x), x]))
  const changed = []
  for (const [k, x] of A) { const y = B.get(k); if (!y) changed.push({ pair: JSON.parse(k), pinned: x.decision, regenerated: null }); else if (x.decision !== y.decision) changed.push({ pair: JSON.parse(k), pinned: x.decision, regenerated: y.decision, basis: y.basis ?? null }) }
  for (const [k, y] of B) if (!A.has(k)) changed.push({ pair: JSON.parse(k), pinned: null, regenerated: y.decision })
  const ga = new Set(groupsOf(a)), gb = new Set(groupsOf(b))
  fs.copyFileSync(regenPath, path.join(DEST, `${p}.json`))
  report.providers[p] = {
    run, pinned_sha256: fileSha(pinnedPath), regenerated_sha256: fileSha(regenPath),
    changed_pairs: changed, groups_removed: [...ga].filter(g => !gb.has(g)).map(g => JSON.parse(g)), groups_added: [...gb].filter(g => !ga.has(g)).map(g => JSON.parse(g)),
    polymorphic: b.polymorphic ?? [],
  }
}
writeJson(path.join(DEST, 'diff-vs-pinned.json'), report)
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.providers).map(([p, r]) => [p, r.changed_pairs.map(c => `${c.pair.join('/')}: ${c.pinned}->${c.regenerated}`)]))))
