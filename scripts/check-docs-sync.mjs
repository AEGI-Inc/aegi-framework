// PR 및 main 머지 시 코드 변경에 따른 문서 정합성과 수정 필요 문서를 자동 분석·보정하는 스크립트.
// 사용:
//   node scripts/check-docs-sync.mjs
//   node scripts/check-docs-sync.mjs --base origin/main --head HEAD --ai --markdown-out doc-sync.md
//   node scripts/check-docs-sync.mjs --base HEAD~1 --head HEAD --ai --fix --markdown-out doc-sync.md
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SKIP_DIRS = new Set(['.git', 'node_modules', path.join('runtime', 'engine'), path.join('runtime', 'dashboard')])
const FROZEN_PREFIX = 'framework/schema/im-model/model/v3.2/'
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1/interactions'
const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen'
const MAX_DIFF_CHARS = 50_000
const MAX_DOCS_CHARS = 100_000
const MAX_CANDIDATE_DOCS = 12

const args = process.argv.slice(2)
const opt = name => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}
const baseRef = opt('--base')
const headRef = opt('--head') ?? 'HEAD'
const markdownOut = opt('--markdown-out')
const doFix = args.includes('--fix')
const useAi = args.includes('--ai')

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

function gitDiffPatch(base, head) {
  if (!base || /^0+$/.test(base)) return ''
  try {
    const raw = execFileSync(
      'git',
      [
        'diff',
        '--unified=3',
        `${base}..${head}`,
        '--',
        '.',
        ':(exclude)package-lock.json',
        ':(exclude)runtime/package-lock.json',
        ':(exclude)runtime/dashboard/package-lock.json',
        `:(exclude)${FROZEN_PREFIX}**`,
      ],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
    )
    if (raw.length <= MAX_DIFF_CHARS) return raw
    return `${raw.slice(0, MAX_DIFF_CHARS)}\n\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...`
  } catch {
    return ''
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

/** AI 대조에 제공할 후보 문서 목록 선택 */
function selectDocsForAi(changes, impacted, mdFiles) {
  const mdSet = new Set(mdFiles)
  const ordered = []
  const add = rel => {
    if (rel && mdSet.has(rel) && !ordered.includes(rel) && !rel.startsWith(FROZEN_PREFIX)) {
      ordered.push(rel)
    }
  }

  // 1) IMPACT_RULES로 매핑된 문서 (미수정 문서 우선)
  for (const item of impacted) add(item.doc)

  // 2) 변경 파일의 같은/상위 디렉터리에 있는 README.md
  for (const c of changes) {
    if (!c.path) continue
    let dir = path.posix.dirname(c.path)
    while (dir && dir !== '.') {
      add(`${dir}/README.md`)
      dir = path.posix.dirname(dir)
    }
  }

  // 3) PR에 이미 포함된 문서도 함께 넣어 중복 지적 방지
  for (const c of changes) {
    if (c.path && c.path.endsWith('.md')) add(c.path)
  }

  // 4) 매핑된 문서가 부족하면 핵심 진입 문서 포함
  if (ordered.length === 0) {
    add('README.md')
    add('runtime/README.md')
    add('docs/01-overview/architecture.md')
  }

  const selected = []
  let totalChars = 0
  for (const rel of ordered) {
    if (selected.length >= MAX_CANDIDATE_DOCS) break
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    if (totalChars + content.length > MAX_DOCS_CHARS && selected.length > 0) continue
    selected.push({ path: rel, content })
    totalChars += content.length
  }
  return selected
}

function buildDocCatalog(mdFiles) {
  return mdFiles
    .filter(rel => !rel.startsWith(FROZEN_PREFIX))
    .map(rel => {
      const firstLine = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).find(l => l.startsWith('#')) ?? ''
      return `- ${rel}${firstLine ? ` (${firstLine.replace(/^#+\s*/, '').trim()})` : ''}`
    })
    .join('\n')
}

function extractInteractionText(interaction) {
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : []
  const chunks = []
  for (const step of steps) {
    if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue
    for (const part of step.content) {
      if (part?.type === 'text' && typeof part.text === 'string') chunks.push(part.text)
    }
  }
  return chunks.join('')
}

/** Gemini Interactions API로 실제 PR diff와 문서 본문을 의미 대조 */
async function runGeminiReview({ changes, impacted, mdFiles, metrics, requestEdits }) {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    return { status: 'skipped', reason: '`GEMINI_API_KEY` 시크릿이 설정되지 않아 규칙 기반 점검만 수행했습니다.' }
  }

  const nonDocChanges = changes.filter(c => c.path && !c.path.endsWith('.md'))
  if (nonDocChanges.length === 0) {
    return { status: 'skipped', reason: '코드·규칙 파일 변경이 없어 AI 코드-문서 대조를 생략했습니다.' }
  }

  const diff = gitDiffPatch(baseRef, headRef)
  if (!diff.trim()) {
    return { status: 'skipped', reason: '비교할 diff 내용이 없어 AI 대조를 생략했습니다.' }
  }

  const docs = selectDocsForAi(changes, impacted, mdFiles)
  const catalog = buildDocCatalog(mdFiles)
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL

  const responseSchema = {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'PR 변경 사항과 문서 정합성에 대한 한국어 1~2문장 요약.',
      },
      no_doc_update_needed: {
        type: 'boolean',
        description: '문서 수정이 전혀 필요 없으면 true, 하나라도 수정이 필요하면 false.',
      },
      findings: {
        type: 'array',
        description: '코드 변경으로 인해 사실과 달라진 문서 내용 목록. 추측이나 문체 다듬기 금지.',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string', description: '저장소 루트 기준 문서 상대 경로 (.md)' },
            severity: { type: 'string', enum: ['high', 'medium', 'low'] },
            current_quote: { type: 'string', description: '문서에 현재 적혀 있는 핵심 문장/구절' },
            issue: { type: 'string', description: 'PR diff와 무엇이 어떻게 불일치하는지 한국어로 구체적 설명' },
            suggestion: { type: 'string', description: '어떻게 수정해야 하는지 한국어로 구체적 제안' },
          },
          required: ['file', 'severity', 'current_quote', 'issue', 'suggestion'],
        },
      },
      ...(requestEdits
        ? {
            edits: {
              type: 'array',
              description:
                '제공된 후보 문서 본문에 바로 적용할 수 있는 정확한 문자열 치환 목록. old_text는 문서 원문과 공백·줄바꿈까지 100% 일치하고 문서 내 정확히 1회만 등장해야 한다.',
              items: {
                type: 'object',
                properties: {
                  file: { type: 'string', description: '수정할 문서 상대 경로 (.md)' },
                  old_text: { type: 'string', description: '문서에서 정확히 1회 등장하는 기존 원문' },
                  new_text: { type: 'string', description: '코드 변경에 맞춰 갱신한 새 텍스트' },
                  reason: { type: 'string', description: '수정 이유 (한국어 한 줄)' },
                },
                required: ['file', 'old_text', 'new_text', 'reason'],
              },
            },
          }
        : {}),
    },
    required: requestEdits ? ['summary', 'no_doc_update_needed', 'findings', 'edits'] : ['summary', 'no_doc_update_needed', 'findings'],
  }

  const systemInstruction = [
    '당신은 AEGI 프레임워크 저장소의 기술 문서 정합성 검증 봇입니다.',
    'PR의 실제 코드/설정/규칙 diff와 현재 저장소의 마크다운 문서 본문을 대조하여, 코드 변경으로 인해 사실과 달라지거나 누락된 문서 내용만 정확히 찾아냅니다.',
    '원칙:',
    '1. 실제로 diff에서 바뀐 내용(CLI 옵션, 환경변수, 기본값, 파일 경로, API/엔드포인트, 보안 경계, 지원 SaaS, 동작 방식, 수치 등) 때문에 문서가 틀어지거나 빠진 경우만 지적합니다.',
    '2. 단순 내부 리팩토링, 주석 수정, 테스트 추가 등 문서에 적힌 내용과 무관한 변경이면 findings를 빈 배열([])로, no_doc_update_needed를 true로 반환합니다.',
    '3. 문체 다듬기, 번역 개선, diff와 무관한 기존 문서 개선 제안은 절대 포함하지 마세요.',
    '4. PR diff 안에서 이미 문서가 함께 수정되었다면 그 항목은 중복 지적하지 마세요.',
    `5. ${FROZEN_PREFIX} 아래의 동결 파일은 절대 수정 대상으로 제안하지 마세요.`,
    '6. 모든 설명은 간결한 한국어로 작성하세요.',
    requestEdits
      ? '7. edits에는 확실히 수정해야 하는 항목만 포함하고, old_text는 제공된 문서 원문에서 공백과 줄바꿈까지 정확히 일치하는 고유 블록으로 작성하세요. 확실하지 않으면 edits에 넣지 말고 findings에만 남기세요.'
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  const docsBlock = docs
    .map(d => `===== DOC: ${d.path} =====\n${d.content}\n===== END DOC: ${d.path} =====`)
    .join('\n\n')

  const prompt = [
    `## 저장소 기준 수치`,
    `- 연결 규칙: ${metrics.connectionPairs}개 쌍, ${metrics.connectionMethods}개 방법`,
    `- 위협 매핑 SaaS: ${metrics.threatMappingProviders}개`,
    `- IM V3.2 고정 파일: ${metrics.freezeFiles}개`,
    '',
    `## 변경 파일 목록`,
    changes.map(c => `- ${c.status}${c.oldPath ? ` ${c.oldPath} ->` : ''} ${c.path}`).join('\n'),
    '',
    `## Git Diff`,
    '```diff',
    diff,
    '```',
    '',
    `## 전체 문서 카탈로그 (참고용)`,
    catalog,
    '',
    `## 대조 대상 문서 본문`,
    docsBlock,
  ].join('\n')

  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model,
        store: false,
        system_instruction: systemInstruction,
        input: prompt,
        generation_config: {
          temperature: 0.1,
        },
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: responseSchema,
        },
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return {
        status: 'error',
        model,
        reason: `Gemini API 호출 실패 (HTTP ${res.status}): ${errText.slice(0, 300)}`,
      }
    }

    const interaction = await res.json()
    const rawText = extractInteractionText(interaction)
    if (!rawText) {
      return {
        status: 'error',
        model,
        reason: `Gemini 응답에서 텍스트를 추출하지 못했습니다 (status=${interaction?.status ?? 'unknown'}).`,
      }
    }

    const parsed = JSON.parse(rawText)
    return {
      status: 'ok',
      model,
      analyzedDocs: docs.map(d => d.path),
      data: parsed,
    }
  } catch (err) {
    return {
      status: 'error',
      model,
      reason: `Gemini 분석 중 예외 발생: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** AI가 제안한 exact-match edits를 안전하게 검증 후 적용 */
function applyAiEdits(edits, mdFiles) {
  const mdSet = new Set(mdFiles)
  const applied = []
  const skipped = []

  if (!Array.isArray(edits)) return { applied, skipped }

  for (const edit of edits) {
    const rel = typeof edit?.file === 'string' ? edit.file.replace(/\\/g, '/').replace(/^\.\//, '') : ''
    const oldText = typeof edit?.old_text === 'string' ? edit.old_text : ''
    const newText = typeof edit?.new_text === 'string' ? edit.new_text : ''
    const reason = typeof edit?.reason === 'string' ? edit.reason : ''

    if (!rel || !rel.endsWith('.md') || !mdSet.has(rel) || rel.startsWith(FROZEN_PREFIX)) {
      skipped.push({ file: rel || '(unknown)', reason: '허용되지 않거나 존재하지 않는 문서 경로' })
      continue
    }
    if (!oldText || oldText === newText) {
      skipped.push({ file: rel, reason: '변경 내용이 비어 있거나 동일함' })
      continue
    }

    const full = path.join(ROOT, rel)
    const content = fs.readFileSync(full, 'utf8')
    const firstIdx = content.indexOf(oldText)
    if (firstIdx === -1) {
      skipped.push({ file: rel, reason: `원문 일치 실패 (수동 확인 필요): ${reason}` })
      continue
    }
    if (content.indexOf(oldText, firstIdx + 1) !== -1) {
      skipped.push({ file: rel, reason: `원문이 문서 내 2회 이상 등장해 자동 치환 생략: ${reason}` })
      continue
    }

    const updated = content.slice(0, firstIdx) + newText + content.slice(firstIdx + oldText.length)
    fs.writeFileSync(full, updated, 'utf8')
    applied.push({ file: rel, reason })
  }

  return { applied, skipped }
}

function buildMarkdownReport({ metrics, impacted, allIssues, fixedFiles, aiResult, aiEditsResult }) {
  const missingDocs = impacted.filter(i => !i.updated)
  const updatedDocs = impacted.filter(i => i.updated)
  const aiFindings = aiResult?.status === 'ok' && Array.isArray(aiResult.data?.findings) ? aiResult.data.findings : []
  const lines = ['<!-- aegi-doc-sync-bot -->', '## AEGI 문서 정합성 점검 리포트', '']

  // 1) AI 의미 대조 결과 섹션
  if (aiResult) {
    if (aiResult.status === 'ok') {
      lines.push(`### 🤖 AI 코드-문서 의미 대조 (\`${aiResult.model}\`)`)
      lines.push('')
      if (aiResult.data?.summary) {
        lines.push(`> ${aiResult.data.summary}`)
        lines.push('')
      }
      if (aiFindings.length === 0) {
        lines.push('✅ **코드 변경 대비 문서 본문 불일치 없음**')
        lines.push('')
      } else {
        const badge = { high: '🔴 HIGH', medium: '🟡 MEDIUM', low: '🔵 LOW' }
        for (const f of aiFindings) {
          lines.push(`- **${badge[f.severity] ?? f.severity}** \`${f.file}\``)
          lines.push(`  - **불일치**: ${f.issue}`)
          if (f.current_quote) lines.push(`  - **현재 문서**: \`${f.current_quote.replace(/\r?\n/g, ' ').slice(0, 160)}\``)
          lines.push(`  - **수정 제안**: ${f.suggestion}`)
        }
        lines.push('')
      }
    } else if (aiResult.status === 'skipped') {
      lines.push(`> ℹ️ AI 대조 생략: ${aiResult.reason}`)
      lines.push('')
    } else if (aiResult.status === 'error') {
      lines.push(`> ⚠️ AI 대조 실패 (규칙 기반 결과만 표시): ${aiResult.reason}`)
      lines.push('')
    }
  }

  // 2) 규칙 기반 정합성 점검 결과
  if (allIssues.length === 0 && missingDocs.length === 0 && aiFindings.length === 0) {
    lines.push('✅ **규칙 기반 정합성 이상 없음** — 수치·경로·삭제 파일 참조가 모두 일치합니다.')
    lines.push('')
  } else {
    if (allIssues.length > 0) {
      lines.push(`### ⚠️ 규칙 기반 불일치 (${allIssues.length}건)`)
      lines.push('')
      for (const issue of allIssues) {
        const loc = issue.line ? `\`${issue.file}:${issue.line}\`` : `\`${issue.file}\``
        lines.push(`- ${loc}: ${issue.detail}`)
      }
      lines.push('')
    }

    if (missingDocs.length > 0) {
      lines.push(`### 📝 변경 경로 기준 연관 문서 체크리스트 (${missingDocs.length}건)`)
      lines.push('')
      for (const item of missingDocs) {
        lines.push(`- [ ] \`${item.doc}\` — ${item.reasons.join(', ')}`)
      }
      lines.push('')
    }

    if (updatedDocs.length > 0) {
      lines.push(`### ✅ 이번 PR에 이미 반영된 연관 문서 (${updatedDocs.length}건)`)
      lines.push('')
      for (const item of updatedDocs) {
        lines.push(`- [x] \`${item.doc}\` — ${item.reasons.join(', ')}`)
      }
      lines.push('')
    }
  }

  // 3) 자동 보정 결과 (post-merge --fix)
  const totalAppliedAi = aiEditsResult?.applied?.length ?? 0
  if (fixedFiles.size > 0 || totalAppliedAi > 0) {
    lines.push(`### 🔧 자동 수정된 파일`)
    lines.push('')
    for (const f of fixedFiles) lines.push(`- \`${f}\` (규칙 기반 수치/경로 보정)`)
    for (const e of aiEditsResult?.applied ?? []) lines.push(`- \`${e.file}\` (AI 자동 반영: ${e.reason})`)
    lines.push('')
  }

  if ((aiEditsResult?.skipped?.length ?? 0) > 0) {
    lines.push(`### ⚠️ 자동 적용 생략 (수동 확인 필요)`)
    lines.push('')
    for (const s of aiEditsResult.skipped) lines.push(`- \`${s.file}\`: ${s.reason}`)
    lines.push('')
  }

  const analyzedList =
    aiResult?.status === 'ok' && aiResult.analyzedDocs?.length
      ? `\n- AI 대조 문서 (${aiResult.analyzedDocs.length}개): ${aiResult.analyzedDocs.map(d => `\`${d}\``).join(', ')}`
      : ''

  lines.push(
    `<details><summary>기준 수치 및 점검 범위</summary>\n\n` +
      `- 연결 규칙: ${metrics.connectionPairs}개 쌍, ${metrics.connectionMethods}개 방법\n` +
      `- 위협 매핑 SaaS: ${metrics.threatMappingProviders}개\n` +
      `- IM V3.2 고정 파일: ${metrics.freezeFiles}개${analyzedList}\n` +
      `</details>`,
  )
  return lines.join('\n') + '\n'
}

async function main() {
  const mdFiles = collectMarkdown(ROOT)
  const metrics = getRepoMetrics()
  const changes = baseRef ? gitDiffNameStatus(baseRef, headRef) : []

  const metricRes = checkAndFixMetrics(metrics)
  const vendorRes = checkStaleVendorRefs(mdFiles)
  const deletedIssues = checkDeletedFileRefs(changes, mdFiles)
  const impacted = computeImpactedDocs(changes)

  let aiResult = null
  let aiEditsResult = { applied: [], skipped: [] }

  if (useAi && baseRef) {
    aiResult = await runGeminiReview({
      changes,
      impacted,
      mdFiles,
      metrics,
      requestEdits: doFix,
    })
    if (doFix && aiResult.status === 'ok' && Array.isArray(aiResult.data?.edits)) {
      aiEditsResult = applyAiEdits(aiResult.data.edits, mdFiles)
    }
  }

  const allIssues = [...metricRes.issues, ...vendorRes.issues, ...deletedIssues]
  const fixedFiles = new Set([...metricRes.fixedFiles, ...vendorRes.fixedFiles])
  const report = buildMarkdownReport({ metrics, impacted, allIssues, fixedFiles, aiResult, aiEditsResult })

  if (markdownOut) {
    fs.writeFileSync(markdownOut, report, 'utf8')
  }

  if (allIssues.length > 0 && fixedFiles.size === 0) {
    console.error(`FAIL: 문서 정합성 불일치 ${allIssues.length}건 발견:`)
    for (const i of allIssues) console.error(`  - ${i.file}${i.line ? `:${i.line}` : ''}: ${i.detail}`)
    process.exit(1)
  }

  const aiSummary = aiResult
    ? `, AI=${aiResult.status}${aiResult.status === 'ok' ? `(지적 ${aiResult.data?.findings?.length ?? 0}건, 수정 ${aiEditsResult.applied.length}건)` : ''}`
    : ''
  console.log(
    `PASS: 문서 정합성 검사 완료 (문서 ${mdFiles.length}개, 불일치 ${allIssues.length}건, 규칙보정 ${fixedFiles.size}건, 연관문서 ${impacted.length}건${aiSummary})`,
  )
}

await main()
