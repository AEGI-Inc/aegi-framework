// 외부 기업 제공용 안전성 검사기.
// 내부 전용 폴더(registry, trial, env-automation, test-environment 등)와
// 개인 로컬 경로, 비밀값/토큰 패턴이 포함되지 않았는지 자동 검증한다.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const errors = []

// 1. 금지 경로 검사 (내부 운영/시험 환경/어사이드 자동화/레지스트리)
const FORBIDDEN_PATHS = [
  'framework/environments',
  'framework/architecture',
  'framework/groundtruth',
  'framework/connection-rules/test-environment',
  'framework/connection-rules/golden-datasets',
  'framework/connection-rules/docs/connection-inventory.md',
  'framework/connection-rules/docs/connection-inventory.csv',
  'framework/connection-rules/docs/measure-v3.md',
  'runtime/vendor/engine/env-automation',
  'runtime/vendor/engine/adapter-auto-setup',
  'runtime/.env',
]

for (const rel of FORBIDDEN_PATHS) {
  if (fs.existsSync(path.join(ROOT, rel))) {
    errors.push(`금지 경로 존재: ${rel}`)
  }
}

// 2. 금지 파일명/디렉터리명 패턴 검사
const FORBIDDEN_DIR_NAMES = new Set([
  'registry',
  'env-automation',
  'adapter-auto-setup',
  'test-environment',
  'golden-datasets',
])

// 3. 텍스트 파일 내용 검사 (개인 PC 경로, 실제 시크릿 패턴)
const CONTENT_CHECKS = [
  { name: 'Windows 개인 경로', re: /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`<>|]+/ },
  { name: 'macOS 개인 경로', re: /\/Users\/(?!example|your-user|username)[A-Za-z0-9._-]+\// },
  { name: 'GitHub PAT', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'Slack Token', re: /\bxox[baprs]-[0-9]{10,}-[0-9A-Za-z-]{20,}\b/ },
  { name: 'AWS Access Key', re: /\bAKIA(?!IOSFODNN7EXAMPLE)[0-9A-Z]{16}\b/ },
  { name: 'Anthropic Key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Private Key Block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]{40,}/ },
]

const SKIP_DIRS = new Set(['.git', 'node_modules', 'data', 'release', 'web'])
const TEXT_EXTS = new Set(['.md', '.json', '.yaml', '.yml', '.ts', '.tsx', '.js', '.mjs', '.py', '.sh', '.cmd', '.txt'])

function walk(dir, relBase = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      if (FORBIDDEN_DIR_NAMES.has(entry.name)) {
        errors.push(`금지 디렉터리 존재: ${rel}`)
        continue
      }
      walk(full, rel)
      continue
    }

    if (rel === 'scripts/check-public-safety.mjs') continue
    if (!TEXT_EXTS.has(path.extname(entry.name).toLowerCase())) continue

    const stat = fs.statSync(full)
    if (stat.size > 5 * 1024 * 1024) continue

    const text = fs.readFileSync(full, 'utf8')
    for (const check of CONTENT_CHECKS) {
      if (check.re.test(text)) {
        errors.push(`금지 패턴 감지 [${check.name}]: ${rel}`)
      }
    }
  }
}

walk(ROOT)

if (errors.length > 0) {
  console.error(`FAIL: 외부 공개 안전성 검사에서 ${errors.length}건 발견:`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

console.log('PASS: 외부 공개 안전성 검사 통과 (금지 경로·개인 경로·시크릿 0건)')
