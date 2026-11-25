// README.md 및 docs/ 내 마크다운 상대 링크가 실제 파일/폴더를 가리키는지 검사한다.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const targets = [path.join(ROOT, 'README.md')]

function collectMarkdown(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectMarkdown(full)
    else if (entry.name.endsWith('.md')) targets.push(full)
  }
}

collectMarkdown(path.join(ROOT, 'docs'))

const linkRe = /\[[^\]]*\]\(([^)]+)\)/g
const broken = []

for (const file of targets) {
  if (!fs.existsSync(file)) continue
  const text = fs.readFileSync(file, 'utf8')
  const dir = path.dirname(file)
  for (const match of text.matchAll(linkRe)) {
    const raw = match[1].trim()
    if (!raw || raw.startsWith('#') || /^[a-z]+:/i.test(raw)) continue
    const clean = decodeURIComponent(raw.split('#')[0].split('?')[0])
    if (!clean) continue
    const resolved = path.resolve(dir, clean)
    if (!fs.existsSync(resolved)) {
      broken.push(`${path.relative(ROOT, file)} -> ${raw}`)
    }
  }
}

if (broken.length > 0) {
  console.error(`FAIL: 깨진 마크다운 링크 ${broken.length}건:`)
  for (const b of broken) console.error(`  - ${b}`)
  process.exit(1)
}

console.log(`PASS: 마크다운 링크 검사 통과 (${targets.length}개 문서)`)
