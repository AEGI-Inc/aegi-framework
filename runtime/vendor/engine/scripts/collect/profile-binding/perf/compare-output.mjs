// 두 정규화 출력 폴더를 비교한다. 실행마다 바뀌는 값(시각, 실행 시간)은 IGNORE 로 뺀다.
// node scripts/collect/profile-binding/perf/compare-output.mjs <dirA> <dirB>
import fs from 'node:fs'
import path from 'node:path'
const [a, b] = process.argv.slice(2)
const IGNORE = /^(generated_at|created_at|normalized_at|started_at|finished_at|duration_ms|elapsed_ms|ms|timing|timings|built_at|run_at|computed_at|eventTime|source_sha256)$/
const clean = v => Array.isArray(v) ? v.map(clean) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([k]) => !IGNORE.test(k)).map(([k, x]) => [k, clean(x)])) : v
function firstDiff(x, y, p = '') {
  if (JSON.stringify(x) === JSON.stringify(y)) return null
  if (x && y && typeof x === 'object' && typeof y === 'object') {
    if (Array.isArray(x) && Array.isArray(y) && x.length !== y.length) return `${p} length ${x.length} != ${y.length}`
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) { const d = firstDiff(x[k], y[k], `${p}/${k}`); if (d) return d }
  }
  return `${p}: ${JSON.stringify(x)?.slice(0, 160)} != ${JSON.stringify(y)?.slice(0, 160)}`
}
let bad = 0
for (const f of fs.readdirSync(a).filter(f => f.endsWith('.json')).sort()) {
  const x = clean(JSON.parse(fs.readFileSync(path.join(a, f), 'utf8'))), y = clean(JSON.parse(fs.readFileSync(path.join(b, f), 'utf8')))
  const d = firstDiff(x, y)
  if (d) bad++
  console.log(`${d ? 'DIFF' : 'same'} ${f}${d ? '  ' + d : ''}`)
}
process.exitCode = bad ? 1 : 0
