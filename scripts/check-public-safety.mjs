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
  'runtime/engine/env-automation',
  'runtime/engine/adapter-auto-setup',
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
  { name: 'Google API Key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Google OAuth Client Secret', re: /\bGOCSPX-[0-9A-Za-z_-]{20,}/ },
  { name: '1Password 서비스 계정 토큰', re: /\bops_[A-Za-z0-9]{40,}/ },
  { name: 'Google Drive·Docs 링크', re: /\b(?:drive|docs)\.google\.com\/(?:drive\/folders|file\/d|document\/d|spreadsheets\/d|presentation\/d)\/[A-Za-z0-9_-]{10,}/ },
  { name: '운영 대시보드 주소(dash.aegi.site)', re: /\bdash\.aegi\.site\b/i },
  { name: '팀 Cloudflare Pages·Workers 주소', re: /\baegi-[a-z0-9-]+\.(?:pages|workers)\.dev\b/i },
  { name: '개인 메일 주소', re: /[A-Za-z0-9._%+-]+@(?:gmail|naver|daum|hanmail|kakao|nate|outlook|hotmail|icloud)\.(?:com|net)\b/i },
  { name: '내부 시험 도메인(aegi.men)', re: /\baegi\.men\b/i },
  { name: '내부 시험 계정(junsik)', re: /\b(?:dev\.)?junsik\b/i },
]

const SKIP_DIRS = new Set(['.git', 'node_modules', 'data', 'release', 'web'])
const TEXT_EXTS = new Set(['.md', '.json', '.jsonl', '.yaml', '.yml', '.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.py', '.sh', '.cmd', '.txt', '.csv', '.tsv', '.sql', '.html'])

// data·web·release 는 실행이 만드는 출력 경로(SKIP_PATHS)에서만 건너뛴다.
// runtime/engine 안의 data/(데이터셋)와 runtime/web/(미리 빌드한 화면)은 배포에 실리므로 검사한다.
const OUTPUT_DIR_NAMES = new Set(['data', 'release', 'web'])
const SKIP_PATHS = new Set(['runtime/data', 'runtime/release'])
// TEXT_EXTS 에 없는 텍스트 확장자(패치, 표, 줄 단위 JSON, 설정 예시, 서비스 정의)
const EXTRA_TEXT_EXTS = new Set(['.patch', '.diff', '.csv', '.tsv', '.jsonl', '.example', '.service', '.toml', '.cjs', '.ini', '.cfg'])
// 저장소의 가장 큰 텍스트 파일은 5MB 를 조금 넘는다. 크기로 건너뛰지 않도록 넉넉히 둔다.
const MAX_SCAN_BYTES = 64 * 1024 * 1024

function walk(dir, relBase = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) && (!OUTPUT_DIR_NAMES.has(entry.name) || SKIP_PATHS.has(rel))) continue
      if (FORBIDDEN_DIR_NAMES.has(entry.name)) {
        errors.push(`금지 디렉터리 존재: ${rel}`)
        continue
      }
      walk(full, rel)
      continue
    }

    if (rel === 'scripts/check-public-safety.mjs') continue
    const ext = path.extname(entry.name).toLowerCase()
    if (!TEXT_EXTS.has(ext) && !EXTRA_TEXT_EXTS.has(ext)) continue

    const stat = fs.statSync(full)
    if (stat.size > MAX_SCAN_BYTES) continue

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
