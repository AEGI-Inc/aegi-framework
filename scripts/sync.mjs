// AEGI 내부 정본 저장소(aegi-knowledge, aegi-adapter-engine, aegi-solution/aegi-demo)에서
// 외부 기업 제공 가능한 허용 목록(allowlist) 경로만 추출하고 비식별화해 동기화한다.
//
// 사용법:
//   node scripts/sync.mjs
//   node scripts/sync.mjs --knowledge <ref> --engine <ref> --solution <ref>
//   node scripts/sync.mjs --local   (origin/main 대신 현재 로컬 HEAD 사용)
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WORKSPACE = path.resolve(process.env.AEGI_WORKSPACE ?? path.join(ROOT, '..'))
const args = process.argv.slice(2)
const useLocal = args.includes('--local')
const arg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const git = (repo, ...a) =>
  execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function resolveRepoDir(candidates) {
  for (const name of candidates) {
    const dir = path.join(WORKSPACE, name)
    if (fs.existsSync(path.join(dir, '.git'))) return { name, dir }
  }
  throw new Error(`저장소를 찾지 못했다: ${candidates.join(' 또는 ')} (WORKSPACE=${WORKSPACE})`)
}

function resolveRef(repoDir, explicitRef) {
  if (explicitRef) {
    if (explicitRef.startsWith('origin/')) git(repoDir, 'fetch', '-q', 'origin')
    return { ref: explicitRef, commit: git(repoDir, 'rev-parse', `${explicitRef}^{commit}`) }
  }
  if (useLocal) {
    return { ref: 'HEAD', commit: git(repoDir, 'rev-parse', 'HEAD') }
  }
  try {
    git(repoDir, 'fetch', '-q', 'origin')
    return { ref: 'origin/main', commit: git(repoDir, 'rev-parse', 'origin/main^{commit}') }
  } catch {
    return { ref: 'HEAD', commit: git(repoDir, 'rev-parse', 'HEAD') }
  }
}

function archiveTo(repoDir, commit, repoPaths, destDir, excludeRes = []) {
  fs.rmSync(destDir, { recursive: true, force: true })
  fs.mkdirSync(destDir, { recursive: true })
  const tmpIndex = path.join(ROOT, `.tmp-git-index-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex }
  try {
    const readTree = spawnSync(
      'git',
      ['--git-dir', path.join(repoDir, '.git'), 'read-tree', commit],
      { env, encoding: 'utf8' },
    )
    if (readTree.status !== 0) {
      throw new Error(`git read-tree 실패 (${repoDir}): ${readTree.stderr}`)
    }
    const ls = spawnSync(
      'git',
      ['--git-dir', path.join(repoDir, '.git'), '-c', 'core.quotepath=false', 'ls-tree', '-r', '-z', '--name-only', commit, '--', ...repoPaths],
      { env, maxBuffer: 1 << 30 },
    )
    if (ls.status !== 0) {
      throw new Error(`git ls-tree 실패 (${repoDir}): ${ls.stderr?.toString('utf8')}`)
    }
    const files = ls.stdout
      .toString('utf8')
      .split('\0')
      .filter((f) => f && !excludeRes.some((re) => re.test(f)))
    if (files.length === 0) return
    const prefix = destDir.endsWith(path.sep) ? destDir : destDir + path.sep
    const co = spawnSync(
      'git',
      [
        '--git-dir',
        path.join(repoDir, '.git'),
        '-c',
        'core.autocrlf=false',
        '-c',
        'core.quotepath=false',
        'checkout-index',
        '-f',
        '--prefix=' + prefix,
        '-z',
        '--stdin',
      ],
      { env, input: Buffer.from(files.join('\0') + '\0', 'utf8'), maxBuffer: 1 << 30 },
    )
    if (co.status !== 0) {
      throw new Error(`git checkout-index 실패 (${repoDir}): ${co.stderr?.toString('utf8')}`)
    }
  } finally {
    fs.rmSync(tmpIndex, { force: true })
  }
}

function sanitizeLocalPaths(dir) {
  const patterns = [
    [/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`<>|]+[\\/]+[^\s"'`<>|,)\\\]}]+/g, '<LOCAL_WORKSPACE_PATH>'],
    [/\/Users\/[^/\s"'`<>|]+\/[^\s"'`<>|,)\\\]}]+/g, '<LOCAL_WORKSPACE_PATH>'],
  ]
  const textExts = new Set(['.json', '.md', '.txt', '.yaml', '.yml', '.py', '.mjs', '.js', '.ts', '.html'])
  let sanitizedCount = 0

  function walk(cur) {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!textExts.has(path.extname(entry.name).toLowerCase())) continue
      const orig = fs.readFileSync(full, 'utf8')
      let next = orig
      for (const [re, replacement] of patterns) {
        next = next.replace(re, replacement)
      }
      if (next !== orig) {
        fs.writeFileSync(full, next, 'utf8')
        sanitizedCount++
      }
    }
  }

  walk(dir)
  return sanitizedCount
}

// 1. aegi-knowledge (외부 제공 가능 정선 자산만 allowlist로 추출)
//    제외: environments/(registry, trial), architecture/*.yaml(내부 인프라),
//          groundtruth/test-environment/, groundtruth/environments/, groundtruth/golden-datasets/,
//          groundtruth/docs/connection-inventory.*, groundtruth/docs/measure-v3.md, AGENTS.md, WORKRULE.md
const knowledgeRepo = resolveRepoDir(['aegi-knowledge'])
const knowledgeRef = resolveRef(knowledgeRepo.dir, arg('--knowledge'))

const FRAMEWORK_DIR = path.join(ROOT, 'framework')
fs.rmSync(FRAMEWORK_DIR, { recursive: true, force: true })
fs.mkdirSync(FRAMEWORK_DIR, { recursive: true })

// 1a. schema (specs, ontology, im-model), threat-mapping, compliance
const knowledgeCorePaths = [
  'schema/README.md',
  'schema/specs',
  'schema/ontology',
  'schema/im-model',
  'threat-mapping',
  'compliance',
]
archiveTo(knowledgeRepo.dir, knowledgeRef.commit, knowledgeCorePaths, FRAMEWORK_DIR, [
  /\.test\./,
  /(^|\/)test_[^/]+\.py$/,
  /^schema\/im-model\/model\/v3\/(?!README\.md$)/,
])

// 1b. groundtruth 중 회사 무관 일반 규칙(28개 쌍 297개 연결 방법)만 connection-rules/로 배치
const gtStage = path.join(ROOT, '.sync-tmp-gt')
const gtSafePaths = [
  'groundtruth/connection-rules',
  'groundtruth/docs/methods.md',
  'groundtruth/docs/connection-map.html',
  'groundtruth/docs/process.md',
  'groundtruth/docs/how-to-read.md',
]
archiveTo(knowledgeRepo.dir, knowledgeRef.commit, gtSafePaths, gtStage)
const connDest = path.join(FRAMEWORK_DIR, 'connection-rules')
fs.mkdirSync(connDest, { recursive: true })
fs.cpSync(path.join(gtStage, 'groundtruth', 'connection-rules'), path.join(connDest, 'rules'), { recursive: true })
fs.cpSync(path.join(gtStage, 'groundtruth', 'docs'), path.join(connDest, 'docs'), { recursive: true })
fs.rmSync(gtStage, { recursive: true, force: true })

const sanitizedKnowledge = sanitizeLocalPaths(FRAMEWORK_DIR)
console.log(`framework (aegi-knowledge): ${knowledgeRef.ref} = ${knowledgeRef.commit.slice(0, 12)} (sanitized ${sanitizedKnowledge} files)`)

// 2. aegi-adapter-engine 핵심 기술 명세 정선본
const engineRepo = resolveRepoDir(['aegi-adapter-engine'])
const engineRef = resolveRef(engineRepo.dir, arg('--engine'))

const SPECS_DIR = path.join(ROOT, 'specs')
const engineSpecStage = path.join(ROOT, '.sync-tmp-specs')
const engineSpecPaths = [
  'docs/IM_PROFILE_PIPELINE.md',
  'docs/TOTAL_COLLECTOR.md',
  'docs/COLLECTOR_V3_CREDENTIAL_REQUIREMENTS.md',
  'docs/spec/AEGI_THREAT_JUDGMENT_V2.md',
  'docs/spec/AEGI_GENERIC_ACCESS_ENGINE_V1.md',
  'docs/spec/AEGI_BLAST_RADIUS_V1.md',
  'docs/spec/AEGI_LINEAGE_V1.md',
]
archiveTo(engineRepo.dir, engineRef.commit, engineSpecPaths, engineSpecStage)
fs.rmSync(SPECS_DIR, { recursive: true, force: true })
fs.mkdirSync(SPECS_DIR, { recursive: true })
for (const rel of engineSpecPaths) {
  const srcFile = path.join(engineSpecStage, rel)
  const destFile = path.join(SPECS_DIR, path.basename(rel))
  fs.copyFileSync(srcFile, destFile)
}
fs.rmSync(engineSpecStage, { recursive: true, force: true })
const sanitizedSpecs = sanitizeLocalPaths(SPECS_DIR)
console.log(`specs (aegi-adapter-engine): ${engineRef.ref} = ${engineRef.commit.slice(0, 12)} (sanitized ${sanitizedSpecs} files)`)

// 3. aegi-solution (로컬 폴더명 aegi-solution 또는 aegi-demo) 런타임 통합
const solutionRepo = resolveRepoDir(['aegi-solution', 'aegi-demo'])
const solutionRef = resolveRef(solutionRepo.dir, arg('--solution'))

const RUNTIME_DIR = path.join(ROOT, 'runtime')
archiveTo(solutionRepo.dir, solutionRef.commit, ['.'], RUNTIME_DIR, [
  /^\.gitattributes$/,
  /^\.gitignore$/,
])
console.log(`runtime (${solutionRepo.name}): ${solutionRef.ref} = ${solutionRef.commit.slice(0, 12)}`)

// 4. VERSIONS.json 기록
const versions = {
  synced_at: new Date().toISOString(),
  sources: {
    knowledge: {
      repo: 'AEGI-Inc/aegi-knowledge',
      ref: knowledgeRef.ref,
      commit: knowledgeRef.commit,
      paths: [...knowledgeCorePaths, ...gtSafePaths],
    },
    engine_specs: {
      repo: 'AEGI-Inc/aegi-adapter-engine',
      ref: engineRef.ref,
      commit: engineRef.commit,
      paths: engineSpecPaths,
    },
    runtime: {
      repo: 'AEGI-Inc/aegi-solution',
      ref: solutionRef.ref,
      commit: solutionRef.commit,
    },
  },
}
fs.writeFileSync(path.join(ROOT, 'VERSIONS.json'), JSON.stringify(versions, null, 2) + '\n', 'utf8')
console.log('VERSIONS.json updated.')
