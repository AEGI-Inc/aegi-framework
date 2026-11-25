// 고정본 검증: FREEZE.json 의 모든 파일이 있고 해시가 같은지, 목록에 없는 모델 파일이 생기지 않았는지 확인한다.
// 실행: node im-object-model-v3.2/verify-freeze.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const freeze = JSON.parse(fs.readFileSync(path.join(DIR, 'FREEZE.json'), 'utf8'))
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const bad = []
for (const f of freeze.files) {
  const p = path.join(DIR, f.path)
  if (!fs.existsSync(p)) bad.push({ path: f.path, problem: 'missing' })
  else if (sha(p) !== f.sha256) bad.push({ path: f.path, problem: 'hash_changed' })
}
const listed = new Set(freeze.files.map(f => f.path.split('/').join(path.sep)))
const extra = fs.readdirSync(DIR, { recursive: true }).filter(f => fs.statSync(path.join(DIR, f)).isFile() && !listed.has(f) && !['FREEZE.json', 'README.md', 'verify-freeze.mjs', '.gitattributes'].includes(f))
for (const f of extra) bad.push({ path: f, problem: 'not_in_freeze' })
console.log(JSON.stringify({ version: freeze.version, frozen_on: freeze.frozen_on, files: freeze.files.length, status: bad.length ? 'changed' : 'intact', problems: bad }, null, 1))
process.exit(bad.length ? 1 : 0)
