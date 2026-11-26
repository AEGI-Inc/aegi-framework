// 저장소 안 모든 마크다운(runtime/engine, runtime/dashboard, node_modules 제외)의 상대 링크가 실제 파일/폴더를 가리키는지 검사한다.
// 코드 블록과 인라인 코드 안의 [..](..) 는 링크가 아니라서 건너뛴다.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SKIP = new Set(['.git', 'node_modules', path.join('runtime', 'engine'), path.join('runtime', 'dashboard')])
const targets = []

function collectMarkdown(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name) && !SKIP.has(path.relative(ROOT, full))) collectMarkdown(full)
    } else if (entry.name.endsWith('.md')) targets.push(full)
  }
}

collectMarkdown(ROOT)

const linkRe = /\[[^\]]*\]\(([^)]+)\)/g
const broken = []

for (const file of targets) {
  if (!fs.existsSync(file)) continue
  const text = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
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
