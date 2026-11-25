import fs from 'node:fs'
import path from 'node:path'
import labels from '../../../ontology/splunk-event-labels-v1.json' with { type: 'json' }

const at = process.argv.indexOf('--dataset')
const dataset = at >= 0 ? path.resolve(process.argv[at + 1] ?? '') : ''
if (!dataset) throw new Error('사용법: npm run splunk:labels:coverage -- --dataset <dataset>')
const file = JSON.parse(fs.readFileSync(path.join(dataset, 'events.json'), 'utf8')) as { events: Array<{ provider: string; event_type: string }> }
const events = file.events ?? []
const covered = events.reduce((n, e) => n + (Object.hasOwn(labels.labels, `${e.provider}|${e.event_type}`) ? 1 : 0), 0)
const percent = events.length ? covered / events.length * 100 : 100
console.log(`이름 사전 적용 ${covered}/${events.length} (${percent.toFixed(2)}%)`)
if (percent < 90) process.exitCode = 1
