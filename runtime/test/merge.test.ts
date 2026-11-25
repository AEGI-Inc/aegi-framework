/**
 * SaaS 하나만 수집했을 때 다른 SaaS 의 최근 실행을 붙여 한 실행으로 합치는지(mergeLatestRuns) 시험한다.
 * 임시 폴더에 실행 기록과 원본 쪽을 만들어 쓴다.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

process.env.AEGI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-solution-merge-'))
const { mergeLatestRuns } = await import('../src/pipeline.ts')

const root = process.env.AEGI_DATA_DIR
const collected = path.join(root, 'collected')
type Call = { provider: string; call_id: string; completeness: string; run_id: string }

function run(id: string, startedAt: string, calls: Array<[string, string, string]>) {
  const record = { run_id: id, started_at: startedAt, finished_at: startedAt, calls: calls.map(([provider, call_id, completeness]): Call => ({ provider, call_id, completeness, run_id: id })) }
  fs.mkdirSync(path.join(collected, 'runs'), { recursive: true })
  fs.writeFileSync(path.join(collected, 'runs', `${id}.json`), JSON.stringify(record))
  for (const [provider, call_id, completeness] of calls) {
    if (completeness === 'skipped' || completeness === 'failed') continue
    const dir = path.join(collected, 'raw', id, provider)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${call_id}-0001.json`), JSON.stringify({ provider, call_id, http_status: 200 }))
  }
  return record as any
}

test('SaaS 하나 수집: 다른 SaaS 는 각자 가장 최근에 받은 실행을 붙이고, 받은 것 없는 실행은 건너뛴다', () => {
  run('r1', '2026-11-04T10:00:00Z', [['slack', 'SL-01', 'full'], ['okta', 'OK-01', 'full']])
  run('r2', '2026-11-04T11:00:00Z', [['okta', 'OK-01', 'partial']])
  run('r3', '2026-11-04T11:30:00Z', [['slack', 'SL-01', 'failed']])
  const latest = run('r4', '2026-11-04T12:00:00Z', [['github', 'GH-01', 'full']])

  const merged = mergeLatestRuns(collected, latest, path.join(root, 'merged'))
  assert.ok(merged)
  assert.equal(merged.runId, 'r4-merged')
  assert.deepEqual(merged.added.sort((a, b) => a.provider.localeCompare(b.provider)), [{ provider: 'okta', runId: 'r2' }, { provider: 'slack', runId: 'r1' }])

  const record = JSON.parse(fs.readFileSync(path.join(merged.root, 'runs', 'r4-merged.json'), 'utf8'))
  assert.equal(record.run_id, 'r4-merged')
  assert.deepEqual(record.calls.map((c: Call) => `${c.provider}/${c.run_id}`).sort(), ['github/r4', 'okta/r2', 'slack/r1'])
  assert.deepEqual(fs.readdirSync(path.join(merged.root, 'raw', 'r4-merged')).sort(), ['github', 'okta', 'slack'])
  // 수집 폴더는 그대로다
  assert.deepEqual(fs.readdirSync(path.join(collected, 'runs')).sort(), ['r1.json', 'r2.json', 'r3.json', 'r4.json'])
})

test('붙일 다른 SaaS 가 없으면 null', () => {
  const only = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-solution-merge-only-'))
  const record = { run_id: 'x1', started_at: '2026-11-04T12:00:00Z', finished_at: '2026-11-04T12:00:00Z', calls: [{ provider: 'github', call_id: 'GH-01', completeness: 'full', run_id: 'x1' }] }
  fs.mkdirSync(path.join(only, 'runs'), { recursive: true })
  fs.writeFileSync(path.join(only, 'runs', 'x1.json'), JSON.stringify(record))
  assert.equal(mergeLatestRuns(only, record as any, path.join(only, 'merged')), null)
})
