// PR 및 main 머지 시 코드 변경에 따른 문서 정합성과 수정 필요 문서를 자동 분석·보정하는 스크립트.
// 사용:
//   node scripts/check-docs-sync.mjs
//   node scripts/check-docs-sync.mjs --base origin/main --head HEAD --markdown-out doc-sync.md
//   node scripts/check-docs-sync.mjs --base HEAD~1 --head HEAD --fix --markdown-out doc-sync.md
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SKIP_DIRS = new Set(['.git', 'node_modules', path.join('runtime', 'engine'), path.join('runtime', 'dashboard')])

const args = process.argv.slice(2)
const opt = name => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}
const baseRef = opt('--base')
const headRef = opt('--head') ?? 'HEAD'
const markdownOut = opt('--markdown-out')
const doFix = args.includes('--fix')

function collectMarkdown(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const rel = path.relative(ROOT, full)
      if (!SKIP_DIRS.has(entry.name) && !SKIP_DIRS.has(rel)) collectMarkdown(full, out)
    } else if (entry.name.endsWith('.md')) {
      out.push(path.relative(ROOT, full).replace(/\\/g, '/'))
    }
  }
  return out
}

function getRepoMetrics() {
  const rulesDir = path.join(ROOT, 'framework', 'connection-rules', 'rules')
  const ruleFiles = fs.readdirSync(rulesDir).filter(f => f.endsWith('.yaml') && f !== 'legend.yaml')
  let connectionMethods = 0
  for (const f of ruleFiles) {
    const txt = fs.readFileSync(path.join(rulesDir, f), 'utf8')
    connectionMethods += (txt.match(/^\s*- id:/gm) ?? []).length
  }
  const tmDir = path.join(ROOT, 'framework', 'threat-mapping')
  const threatMappingProviders = fs
    .readdirSync(tmDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'scenarios-backlog').length
  const freeze = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'framework', 'schema', 'im-model', 'model', 'v3.2', 'FREEZE.json'), 'utf8'),
  )
  return {
    connectionPairs: ruleFiles.length,
    connectionMethods,
    threatMappingProviders,
    freezeFiles: freeze.files.length,
  }
}

/** 변경 파일 패턴 → 함께 검토·수정이 필요한 문서 매핑 */
const IMPACT_RULES = [
  {
    match: /^runtime\/(src\/(oauth|env|collectorConfig|status|aiTest|splunk)\.ts|bin\/aegi\.ts|\.env\.example|start\.(sh|cmd)|collect\.(sh|cmd))$/,
    docs: [
      'runtime/README.md',
      'docs/03-enterprise-adoption/adoption-guide.md',
      'runtime/docs/saas-collection-guide.md',
      'runtime/docs/saas-collection-summary.md',
      'runtime/docs/saas-adapter-scopes.md',
    ],
    reason: '런타임 CLI·환경변수·OAuth·자격증명 설정 변경',
  },
  {
    match: /^runtime\/src\/(server|tls|db|logs|pipeline|publish|standards)\.ts$/,
    docs: [
      'runtime/README.md',
      'docs/03-enterprise-adoption/security-and-privacy.md',
      'docs/01-overview/architecture.md',
    ],
    reason: '로컬 서버·보안 경계·파이프라인 동작 변경',
  },
  {
    match: /^runtime\/engine\/scripts\/collect\/profile-binding\//,
    docs: [
      'docs/02-methodology/04-profile-and-normalization.md',
      'specs/IM_PROFILE_PIPELINE.md',
      'docs/03-enterprise-adoption/adding-new-saas.md',
    ],
    reason: 'IM Profile/Overlay 정규화 파이프라인 변경',
  },
  {
    match: /^runtime\/engine\/scripts\/collect\/providers\//,
    docs: [
      'README.md',
      'runtime/README.md',
      'docs/02-methodology/01-metadata-collection.md',
      'runtime/docs/saas-adapter-scopes.md',
    ],
    reason: 'SaaS 수집기(Provider) API 호출 또는 지원 범위 변경',
  },
  {
    match: /^runtime\/engine\/src\/detection\//,
    docs: [
      'docs/02-methodology/05-threat-and-compliance.md',
      'specs/AEGI_THREAT_JUDGMENT_V2.md',
      'specs/AEGI_GENERIC_ACCESS_ENGINE_V1.md',
      'specs/AEGI_BLAST_RADIUS_V1.md',
    ],
    reason: '위협 판정·접근 엔진·피해 범위 로직 변경',
  },
  {
    match: /^framework\/connection-rules\/rules\//,
    docs: [
      'README.md',
      'docs/01-overview/architecture.md',
      'docs/01-overview/pipeline.md',
      'docs/02-methodology/05-threat-and-compliance.md',
      'framework/connection-rules/docs/methods.md',
      'framework/connection-rules/docs/how-to-read.md',
    ],
    reason: 'Cross-SaaS 연결 확인 규칙(YAML) 변경',
  },
  {
    match: /^framework\/threat-mapping\/[^/]+\/(threats|objects|scenarios)\.csv$/,
    docs: [
      'README.md',
      'docs/02-methodology/05-threat-and-compliance.md',
      'framework/threat-mapping/README.md',
    ],
    reason: 'SaaS 위협 매핑 CSV 변경',
  },
  {
    match: /^framework\/compliance\/(scope|guidance)\//,
    docs: [
      'framework/compliance/scope/README.md',
      'framework/compliance/guidance/README.md',
      'docs/02-methodology/05-threat-and-compliance.md',
    ],
    reason: '컴플라이언스 판정 범위 또는 근거 카드 변경',
  },
  {
    match: /^framework\/schema\/ontology\/.*\.yaml$/,
    docs: [
      'framework/schema/README.md',
      'docs/02-methodology/03-im-object-modeling.md',
    ],
    reason: '온톨로지(YAML) 어휘·규칙 변경',
  },
  {
    match: /^scripts\/check-public-safety\.mjs$/,
    docs: [
      'docs/03-enterprise-adoption/security-and-privacy.md',
      'README.md',
    ],
    reason: '외부 공개 안전성 검사 항목 변경',
  },
  {
    match: /^runtime\/scripts\/release\.mjs$/,
    docs: [
      'runtime/README.md',
    ],
    reason: '배포 번들(release) 구성 변경',
  },
]

function gitDiffNameStatus(base, head) {
  if (!base || /^0+$/.test(base)) return []
  try {
    const raw = execFileSync('git', ['diff', '--name-status', '-M', `${base}..${head}`], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        const parts = line.split('\t')
        const status = parts[0]
        if (status.startsWith('R')) return { status: 'R', oldPath: parts[1], path: parts[2] }
        return { status, path: parts[1] }
      })
  } catch {
    return []
  }
}

/** 자동 보정 가능한 문서 수치/구 경로 규칙 */
function checkAndFixMetrics(metrics) {
  const issues = []
  const fixedFiles = new Set()

  const metricChecks = [
    {
      file: 'README.md',
      rules: [
        { label: '연결 규칙 수', re: /(연결 규칙\s*)(\d+)(개)/g, expected: metrics.connectionMethods },
        { label: 'SaaS 쌍 수', re: /(SaaS 쌍\s*)(\d+)(개)/g, expected: metrics.connectionPairs },
        { label: 'V3.2 고정 파일 수', re: /(고정본\s*)(\d+)(개 파일)/g, expected: metrics.freezeFiles },
      ],
    },
    {
      file: 'docs/01-overview/architecture.md',
      rules: [
        { label: 'Connection Rules 수', re: /(Connection Rules \()(\d+)(\))/g, expected: metrics.connectionMethods },
      ],
    },
    {
      file: 'docs/01-overview/pipeline.md',
      rules: [
        { label: '연결 규칙 수', re: /(연결 규칙\()(\d+)(\))/g, expected: metrics.connectionMethods },
      ],
    },
    {
      file: 'docs/02-methodology/03-im-object-modeling.md',
      rules: [
        { label: 'V3.2 고정 파일 수', re: /(model\/v3\.2\/`의\s*)(\d+)(개 파일)/g, expected: metrics.freezeFiles },
      ],
    },
    {
      file: 'docs/02-methodology/05-threat-and-compliance.md',
      rules: [
        { label: 'SaaS 쌍 수', re: /(연결 확인 규칙:\s*)(\d+)(개 쌍)/g, expected: metrics.connectionPairs },
        { label: '연결 방법 수', re: /(\d+개 쌍,\s*)(\d+)(개 방법)/g, expected: metrics.connectionMethods },
        { label: '연결 규칙 수', re: /(연결 검증 규칙\s*)(\d+)(개)/g, expected: metrics.connectionMethods },
        { label: '포함 SaaS 수', re: /(포함 SaaS\s*)(\d+)(개)/g, expected: metrics.threatMappingProviders },
      ],
    },
    {
      file: 'docs/03-enterprise-adoption/adoption-guide.md',
      rules: [
        { label: '연결 규칙 수', re: /(rules\/\*\.yaml`의\s*)(\d+)(개 연결)/g, expected: metrics.connectionMethods },
      ],
    },
    {
      file: 'framework/connection-rules/docs/how-to-read.md',
      rules: [
        { label: 'SaaS 쌍 수', re: /(총\s*)(\d+)(개 쌍)/g, expected: metrics.connectionPairs },
        { label: '연결 방법 수', re: /(\d+개 쌍,\s*)(\d+)(개 방법)/g, expected: metrics.connectionMethods },
      ],
    },
    {
      file: 'framework/schema/README.md',
      rules: [
        { label: 'V3.2 고정 파일 수', re: /(고정본\()(\d+)(개 파일\))/g, expected: metrics.freezeFiles },
      ],
    },
  ]

  for (const target of metricChecks) {
    const full = path.join(ROOT, target.file)
    if (!fs.existsSync(full)) continue
    let text = fs.readFileSync(full, 'utf8')
    let changed = false
    for (const rule of target.rules) {
      text = text.replace(rule.re, (m, pre, num, post) => {
        if (Number(num) === rule.expected) return m
        issues.push({
          kind: 'metric_mismatch',
          file: target.file,
          detail: `${rule.label}: 문서 ${num} ≠ 실제 ${rule.expected}`,
          autoFixable: true,
        })
        if (doFix) {
          changed = true
          return `${pre}${rule.expected}${post}`
        }
        return m
      })
    }
    if (changed) {
      fs.writeFileSync(full, text, 'utf8')
      fixedFiles.add(target.file)
    }
  }

  return { issues, fixedFiles }
}

/** 구 경로(runtime/vendor/, vendor/VERSIONS.json) 재유입 검사 */
function checkStaleVendorRefs(mdFiles) {
  const issues = []
  const fixedFiles = new Set()
  const staleRe = /\bruntime\/vendor\/(engine|dashboard|web)\b|\bvendor\/VERSIONS\.json\b/g

  for (const rel of mdFiles) {
    const full = path.join(ROOT, rel)
    const text = fs.readFileSync(full, 'utf8')
    const matches = [...text.matchAll(staleRe)]
    if (!matches.length) continue
    for (const m of matches) {
      issues.push({
        kind: 'stale_vendor_path',
        file: rel,
        detail: `제거된 벤더 경로 참조: \`${m[0]}\``,
        autoFixable: m[0].startsWith('runtime/vendor/'),
      })
    }
    if (doFix) {
      const next = text.replace(/\bruntime\/vendor\/(engine|dashboard|web)\b/g, 'runtime/$1')
      if (next !== text) {
        fs.writeFileSync(full, next, 'utf8')
        fixedFiles.add(rel)
      }
    }
  }
  return { issues, fixedFiles }
}

/** PR/커밋에서 삭제·이동된 파일이 문서 본문에 남아 있는지 탐지 */
function checkDeletedFileRefs(changes, mdFiles) {
  const removed = changes
    .filter(c => c.status === 'D' || c.status === 'R')
    .map(c => (c.status === 'R' ? c.oldPath : c.path))
    .filter(p => p && !p.startsWith('runtime/vendor/'))
  if (!removed.length) return []

  const issues = []
  for (const rel of mdFiles) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    const lines = text.split(/\r?\n/)
    for (const oldPath of removed) {
      const base = path.basename(oldPath)
      // README.md 같은 흔한 파일명은 전체 경로로만 검사, 고유 스크립트/문서명은 파일명도 검사
      const generic = /^(README\.md|index\.\w+|package\.json|tsconfig\.json|\.gitattributes)$/i.test(base)
      const needle = generic ? oldPath : base
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(oldPath) || (!generic && lines[i].includes(`\`${needle}\``))) {
          issues.push({
            kind: 'deleted_ref',
            file: rel,
            line: i + 1,
            detail: `삭제/이동된 파일 참조: \`${oldPath}\``,
            autoFixable: false,
          })
          break
        }
      }
    }
  }
  return issues
}

/** 변경 파일에 따라 함께 점검해야 할 문서 목록 계산 */
function computeImpactedDocs(changes) {
  const touchedDocs = new Set(changes.map(c => c.path).filter(p => p && p.endsWith('.md')))
  const impactMap = new Map() // doc -> Set<reason>

  for (const c of changes) {
    if (!c.path || c.path.endsWith('.md')) continue
    for (const rule of IMPACT_RULES) {
      if (!rule.match.test(c.path)) continue
      for (const doc of rule.docs) {
        if (!fs.existsSync(path.join(ROOT, doc))) continue
        if (!impactMap.has(doc)) impactMap.set(doc, new Set())
        impactMap.get(doc).add(rule.reason)
      }
    }
  }

  return [...impactMap.entries()]
    .map(([doc, reasons]) => ({
      doc,
      updated: touchedDocs.has(doc),
      reasons: [...reasons],
    }))
    .sort((a, b) => Number(a.updated) - Number(b.updated) || a.doc.localeCompare(b.doc))
}

function buildMarkdownReport({ metrics, impacted, allIssues, fixedFiles }) {
  const missingDocs = impacted.filter(i => !i.updated)
  const updatedDocs = impacted.filter(i => i.updated)
  const lines = [
    '<!-- aegi-doc-sync-bot -->',
    '## AEGI 문서 정합성 점검 리포트',
    '',
  ]

  if (allIssues.length === 0 && missingDocs.length === 0) {
    lines.push('✅ **문서 정합성 이상 없음** — 수치·경로·삭제 파일 참조 및 관련 문서가 모두 일치합니다.')
  } else {
    if (allIssues.length > 0) {
      lines.push(`### ⚠️ 문서 정합성 불일치 (${allIssues.length}건)`)
      lines.push('')
      for (const issue of allIssues) {
        const loc = issue.line ? `\`${issue.file}:${issue.line}\`` : `\`${issue.file}\``
        lines.push(`- ${loc}: ${issue.detail}`)
      }
      lines.push('')
    }

    if (missingDocs.length > 0) {
      lines.push(`### 📝 함께 검토·수정이 필요해 보이는 문서 (${missingDocs.length}건)`)
      lines.push('')
      lines.push('이 PR의 코드 변경과 연관된 문서입니다. 동작·권한·설정이 바뀌었다면 아래 문서도 함께 반영해 주세요.')
      lines.push('')
      for (const item of missingDocs) {
        lines.push(`- [ ] \`${item.doc}\` — ${item.reasons.join(', ')}`)
      }
      lines.push('')
    }

    if (updatedDocs.length > 0) {
      lines.push(`### ✅ 이번 PR에 이미 반영된 관련 문서 (${updatedDocs.length}건)`)
      lines.push('')
      for (const item of updatedDocs) {
        lines.push(`- [x] \`${item.doc}\` — ${item.reasons.join(', ')}`)
      }
      lines.push('')
    }
  }

  if (fixedFiles.size > 0) {
    lines.push(`### 🔧 자동 보정된 파일 (${fixedFiles.size}건)`)
    lines.push('')
    for (const f of fixedFiles) lines.push(`- \`${f}\``)
    lines.push('')
  }

  lines.push(
    `<details><summary>기준 수치 (자동 측정)</summary>\n\n` +
      `- 연결 규칙: ${metrics.connectionPairs}개 쌍, ${metrics.connectionMethods}개 방법\n` +
      `- 위협 매핑 SaaS: ${metrics.threatMappingProviders}개\n` +
      `- IM V3.2 고정 파일: ${metrics.freezeFiles}개\n` +
      `</details>`,
  )
  return lines.join('\n') + '\n'
}

const mdFiles = collectMarkdown(ROOT)
const metrics = getRepoMetrics()
const changes = baseRef ? gitDiffNameStatus(baseRef, headRef) : []

const metricRes = checkAndFixMetrics(metrics)
const vendorRes = checkStaleVendorRefs(mdFiles)
const deletedIssues = checkDeletedFileRefs(changes, mdFiles)
const impacted = computeImpactedDocs(changes)

const allIssues = [...metricRes.issues, ...vendorRes.issues, ...deletedIssues]
const fixedFiles = new Set([...metricRes.fixedFiles, ...vendorRes.fixedFiles])
const report = buildMarkdownReport({ metrics, impacted, allIssues, fixedFiles })

if (markdownOut) {
  fs.writeFileSync(markdownOut, report, 'utf8')
}

if (allIssues.length > 0 && fixedFiles.size === 0) {
  console.error(`FAIL: 문서 정합성 불일치 ${allIssues.length}건 발견:`)
  for (const i of allIssues) console.error(`  - ${i.file}${i.line ? `:${i.line}` : ''}: ${i.detail}`)
  process.exit(1)
}

console.log(
  `PASS: 문서 정합성 검사 완료 (문서 ${mdFiles.length}개, 불일치 ${allIssues.length}건, 자동보정 ${fixedFiles.size}건, 관련문서 ${impacted.length}건)`,
)
