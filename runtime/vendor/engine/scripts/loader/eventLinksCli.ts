/**
 * 데이터셋 폴더의 이벤트와 동일인 연결, 객체와 관계로 이벤트 연결을 계산해 event_links.json 으로 쓴다.
 * 대시보드 dev 서버가 이 파일을 읽는다. 게시(npm run publish)는 이벤트와 이벤트 연결을 D1 에 올리지 않는다(2026-11-01).
 *
 *   npm run events:link -- --dataset collected/<데이터셋>
 */
import fs from 'fs'
import path from 'path'
import { computeEventLinks, EVENT_LINK_RULE_VERSION, ssoAppProviders } from '../../src/events/eventLinks.ts'
import { datasetRelations } from '../stream/splunk/matchReport.ts'
import { readEvents } from './events.ts'
import { ROOT } from './target.ts'

const args = process.argv.slice(2)
const i = args.indexOf('--dataset')
if (i < 0 || !args[i + 1]) {
  console.error('사용법: npm run events:link -- --dataset collected/<데이터셋>')
  process.exit(1)
}
const dir = path.resolve(ROOT, args[i + 1]!)
const events = readEvents(dir)
if (!events.length) {
  console.error(`${dir} 에 events.json 이 없거나 비었다 (npm run splunk -- pull)`)
  process.exit(1)
}
const readList = (name: string) => (fs.existsSync(path.join(dir, name)) ? JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) : [])
const relations = fs.existsSync(path.join(dir, 'relations.json')) ? datasetRelations(dir) : undefined
const links = computeEventLinks(events, readList('links.json'), { ssoApps: ssoAppProviders(readList('objects.json'), readList('relations.json')), relations })
fs.writeFileSync(path.join(dir, 'event_links.json'), JSON.stringify({ rule_version: EVENT_LINK_RULE_VERSION, generated_at: new Date().toISOString(), links }, null, 2) + '\n')
const counts = links.reduce<Record<string, number>>((acc, l) => { acc[l.basis] = (acc[l.basis] ?? 0) + 1; return acc }, {})
console.log(`이벤트 ${events.length}건 → 연결 ${links.length}개 ${JSON.stringify(counts)} (${path.relative(ROOT, path.join(dir, 'event_links.json'))})`)
