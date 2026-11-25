/**
 * 판정 표 대조 (aegi-knowledge docs/architecture/ai-log-investigation.md D1 「수동 대조」).
 * 같은 Splunk 데이터를 AI 검색의 SPL 판정(aegi_category, aegi_outcome)과 mapper 판정으로 각각 세어 비교한다.
 *
 *   npm run splunk:classes:check -- spl <config.json> <from> <to>   # 소스마다 실행할 SPL 두 개(집계, 원본)를 줄마다 출력
 *   npm run splunk:classes:check -- compare <counts.csv> <raw.json> # 집계 CSV 와 원본 export(JSON lines)를 비교
 *
 * 집계 CSV 는 sourcetype, aegi_category, aegi_outcome, count 열, 원본은 Splunk export(output_mode=json)의 줄이다.
 * 원본 이벤트는 출력하지 않는다. 건수와 차이만 쓴다.
 */
import fs from 'node:fs'
import { validateWorkspace } from './query/workspace.ts'
import { baseSearch, DEDUP_EVENTS } from './query/spl.ts'
import { tenantScope } from './query/workspace.ts'
import { mapRow } from './mapper.ts'
import { EntityResolver } from './resolver.ts'

const [mode, a, b, c] = process.argv.slice(2)
if (mode === 'spl') {
  const config = JSON.parse(fs.readFileSync(a!, 'utf8'))
  for (const w of config.workspaces.map(validateWorkspace)) for (const s of w.sources) {
    console.log(`${baseSearch(s, b!, c!)} | ${DEDUP_EVENTS} | stats count by sourcetype aegi_category aegi_outcome`)
    console.log([`search index=${s.index} sourcetype="${s.sourcetype}" earliest=${Date.parse(b!) / 1000} latest=${Date.parse(c!) / 1000}`, ...tenantScope(s), 'eval aegi_indextime=_indextime', 'fields _raw index sourcetype aegi_indextime'].join(' | '))
  }
} else if (mode === 'compare') {
  const key = (st: string, cat: string, out: string) => `${st}\t${cat}\t${out}`
  const spl = new Map<string, number>()
  const [head, ...lines] = fs.readFileSync(a!, 'utf8').trim().split(/\r?\n/)
  const cols = head!.split(',').map(h => h.replace(/"/g, ''))
  for (const line of lines) {
    const v = line.split(',').map(x => x.replace(/"/g, ''))
    const row = Object.fromEntries(cols.map((h, i) => [h, v[i] ?? '']))
    // SPL 은 결과를 기록하지 않는 소스에 not_recorded 를 쓰고, mapper 는 unknown 을 쓴다
    spl.set(key(row.sourcetype!, row.aegi_category!, row.aegi_outcome === 'not_recorded' ? 'unknown' : row.aegi_outcome!), Number(row.count))
  }
  const mapped = new Map<string, number>(), resolver = new EntityResolver([])
  let dropped = 0
  for (const line of fs.readFileSync(b!, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    const r = (JSON.parse(line) as { result?: Record<string, string> }).result
    if (!r?._raw) continue
    const out = mapRow(r as never, { index: r.index!, sourcetype: r.sourcetype!, sid: 'check', offset: 0, tenant: r.index!, receivedAt: '' }, resolver)
    if (out.error) { dropped++; continue }
    for (const e of out.events) mapped.set(key(r.sourcetype!, e.category, e.outcome), (mapped.get(key(r.sourcetype!, e.category, e.outcome)) ?? 0) + 1)
  }
  let diff = 0
  for (const k of [...new Set([...spl.keys(), ...mapped.keys()])].sort()) {
    const s = spl.get(k) ?? 0, m = mapped.get(k) ?? 0
    if (s !== m) diff++
    console.log(`${s === m ? 'same' : 'DIFF'}\t${k}\tspl=${s}\tmapper=${m}`)
  }
  console.log(`groups ${spl.size}/${mapped.size}, differences ${diff}, records the mapper refused ${dropped}`)
  process.exitCode = diff ? 1 : 0
} else {
  console.error('usage: spl <config.json> <from> <to> | compare <counts.csv> <raw.json>')
  process.exitCode = 2
}
