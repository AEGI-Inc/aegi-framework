/**
 * 데이터셋 폴더의 Splunk 정규 이벤트(events.json, npm run splunk -- pull)를 읽는다. 이벤트 연결 계산(npm run events:link)이 쓴다.
 * 화면과 AI 는 D1 로그 캐시(log_*)에서 읽는다.
 */
import fs from 'fs'
import path from 'path'

export function readEvents(datasetDir: string): any[] {
  const file = path.join(datasetDir, 'events.json')
  if (!fs.existsSync(file)) return []
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { events?: any[] }).events ?? []
}
